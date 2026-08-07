'use strict';

const crypto = require('crypto');

const MAX_SUBJECT = 160;
const MAX_TEXT = 12000;
const MAX_HTML = 16000;
const MAX_PROVIDER_RESPONSE = 16384;
// NorthStar's internal Authorization-header safety bound. This is not a
// provider key-format or provider key-length claim.
const MAX_API_KEY_HEADER_VALUE = 4096;
const RESEND_TIMEOUT_MS = 10000;
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const PRODUCTION_ORIGIN = 'https://www.northstar-os.ai';
const PRODUCTION_FROM = 'notifications@northstar-os.ai';
const TRANSACTIONAL_SENDER_NAME = 'NorthStar Notifications';
const CONTROL = /[\u0000-\u001f\u007f]/;
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,256}$/;

function bounded(value, maximum, label, allowBodyWhitespace = false) {
  const invalidControl = allowBodyWhitespace ? BODY_CONTROL : CONTROL;
  if (typeof value !== 'string' || !value || value.length > maximum || invalidControl.test(value)) {
    throw new Error(`Invalid transactional email ${label}`);
  }
  return value;
}

function dnsHostname(value) {
  if (typeof value !== 'string' || !value || value.length > 253 || value !== value.trim() ||
      CONTROL.test(value) || /[^\x21-\x7e]/.test(value)) return null;
  const labels = value.split('.');
  if (labels.length < 2 || labels.some(label => !DNS_LABEL.test(label))) return null;
  return labels.join('.').toLowerCase();
}

function emailAddress(value, label) {
  if (typeof value !== 'string' || !value || value.length > 254 || value !== value.trim() ||
      CONTROL.test(value) || /[^\x21-\x7e]/.test(value) || /[,;]/.test(value)) {
    throw new Error(`Invalid transactional email ${label}`);
  }
  const separator = value.lastIndexOf('@');
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  if (separator <= 0 || local.length > 64 || !LOCAL_PART.test(local) ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..') || !dnsHostname(domain)) {
    throw new Error(`Invalid transactional email ${label}`);
  }
  return `${local.toLowerCase()}@${dnsHostname(domain)}`;
}

function workforceInvitationEnvelope(recipient, invite = {}) {
  const rawName = invite.name || 'Team member';
  if (typeof rawName !== 'string' || !rawName.trim() ||
      Buffer.byteLength(rawName, 'utf8') > 480 || Array.from(rawName).length > 120 ||
      BODY_CONTROL.test(rawName)) {
    throw new Error('Invalid transactional email invited name');
  }
  return {
    recipient: emailAddress(recipient, 'recipient'),
    person: rawName,
  };
}

function canonicalOrigin(raw, production = true) {
  if (typeof raw !== 'string' || !raw || raw !== raw.trim() || CONTROL.test(raw) ||
      (production && /[^\x21-\x7e]/.test(raw))) return null;
  let parsed;
  try { parsed = new URL(raw); } catch (_error) { return null; }
  if (parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.pathname !== '/' || (production && parsed.protocol !== 'https:') ||
      (!production && !['http:', 'https:'].includes(parsed.protocol))) return null;
  if (production && !dnsHostname(parsed.hostname)) return null;
  return parsed.origin;
}

function resendApiKey(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_API_KEY_HEADER_VALUE ||
      !/^[\x21-\x7e]+$/.test(value)) return null;
  return value;
}

function validatedProductionConfiguration(environment) {
  const env = environment || {};
  const origin = canonicalOrigin(env.PUBLIC_ORIGIN, true);
  const apiKey = resendApiKey(env.RESEND_API_KEY);
  const from = env.TRANSACTIONAL_EMAIL_FROM;
  if (origin !== PRODUCTION_ORIGIN || !apiKey || typeof from !== 'string') return null;
  try {
    const normalizedFrom = emailAddress(from, 'sender');
    if (normalizedFrom !== PRODUCTION_FROM) return null;
    return Object.freeze({ origin, apiKey, from: normalizedFrom });
  } catch (_error) {
    return null;
  }
}

function safeRequestId(value) {
  return typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value)
    ? value
    : 'unavailable';
}

function attemptTimestamp(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

class TransactionalDeliveryError extends Error {
  constructor(category, details = {}) {
    super(`Transactional email delivery failed: ${category}`);
    this.name = 'TransactionalDeliveryError';
    this.provider = 'resend';
    this.accepted = false;
    this.category = category;
    this.code = `resend_${category}`;
    this.httpStatus = Number.isInteger(details.httpStatus) ? details.httpStatus : null;
    this.providerMessageIdPresent = false;
    this.attemptedAt = details.attemptedAt;
    this.requestId = safeRequestId(details.requestId);
  }
}

function deliveryError(category, details) {
  return new TransactionalDeliveryError(category, details);
}

async function cancelResponse(response) {
  if (response && response.body && typeof response.body.cancel === 'function') {
    try { await response.body.cancel(); } catch (_error) { /* bounded best effort */ }
  }
}

async function boundedResponseText(response) {
  const declared = Number(response.headers && response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE) {
    await cancelResponse(response);
    throw new Error('provider_response_too_large');
  }
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    let completed = false;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        total += item.value.byteLength;
        if (total > MAX_PROVIDER_RESPONSE) throw new Error('provider_response_too_large');
        chunks.push(item.value);
      }
      completed = true;
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder('utf-8', { fatal: true }).decode(merged);
    } finally {
      if (!completed && typeof reader.cancel === 'function') {
        try {
          await reader.cancel();
        } catch (_error) { /* preserve the authoritative read failure */ }
      }
      if (typeof reader.releaseLock === 'function') {
        try { reader.releaseLock(); } catch (_error) { /* bounded best effort */ }
      }
    }
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_PROVIDER_RESPONSE) throw new Error('provider_response_too_large');
  return text;
}

function categoryForStatus(status) {
  if (status === 400 || status === 422) return 'provider_request_rejected';
  if (status === 401 || status === 403) return 'provider_access_rejected';
  if (status === 409) return 'provider_conflict';
  if (status === 429) return 'provider_rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_rejection';
}

function structuredSender(message, configuration) {
  if (!message || !message.from || message.from.name !== TRANSACTIONAL_SENDER_NAME ||
      message.from.address !== configuration.from) {
    throw new Error('Invalid transactional email sender');
  }
  return `${TRANSACTIONAL_SENDER_NAME} <${configuration.from}>`;
}

function createResendAdapter(configuration, options = {}) {
  if (!configuration || !configuration.apiKey) return null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 && options.timeoutMs <= RESEND_TIMEOUT_MS
    ? options.timeoutMs
    : RESEND_TIMEOUT_MS;
  const now = typeof options.now === 'function' ? options.now : () => new Date();

  return Object.freeze({
    async send(message, context = {}) {
      const attemptedAt = attemptTimestamp(now);
      const requestId = safeRequestId(context.requestId);
      const controller = new AbortController();
      const deadline = Date.now() + timeoutMs;
      let deadlineAborted = false;
      const timeout = setTimeout(() => {
        deadlineAborted = true;
        controller.abort();
      }, timeoutMs);
      if (typeof timeout.unref === 'function') timeout.unref();
      try {
        if (typeof context.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(context.idempotencyKey)) {
          throw deliveryError('invalid_operation', { attemptedAt, requestId });
        }
        let payload;
        try {
          payload = {
            from: structuredSender(message, configuration),
            to: [emailAddress(message.to, 'recipient')],
            subject: bounded(message.subject, MAX_SUBJECT, 'subject'),
            text: bounded(message.text, MAX_TEXT, 'text body', true),
            html: bounded(message.html, MAX_HTML, 'HTML body', true),
          };
        } catch (_error) {
          throw deliveryError('invalid_message', { attemptedAt, requestId });
        }
        if (Date.now() >= deadline) throw deliveryError('timeout', { attemptedAt, requestId });

        const response = await fetchImpl(RESEND_ENDPOINT, {
            method: 'POST',
            redirect: 'manual',
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${configuration.apiKey}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': context.idempotencyKey,
            },
            body: JSON.stringify(payload),
          });

        const httpStatus = response && Number.isInteger(response.status) ? response.status : null;
        if (httpStatus !== null && httpStatus >= 300 && httpStatus < 400) {
          await cancelResponse(response);
          throw deliveryError('provider_redirect_rejected', { attemptedAt, requestId, httpStatus });
        }
        if (httpStatus === null || httpStatus < 200 || httpStatus >= 300) {
          await cancelResponse(response);
          throw deliveryError(categoryForStatus(httpStatus || 0), { attemptedAt, requestId, httpStatus });
        }

        let providerBody;
        try {
          const contentType = String(response.headers && response.headers.get('content-type') || '');
          if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw new Error('provider_content_type_invalid');
          const raw = await boundedResponseText(response);
          providerBody = JSON.parse(raw);
        } catch (_error) {
          throw deliveryError('malformed_provider_response', { attemptedAt, requestId, httpStatus });
        }
        if (!providerBody || typeof providerBody !== 'object' || Array.isArray(providerBody) ||
            !PROVIDER_ID.test(providerBody.id || '')) {
          throw deliveryError('malformed_provider_response', { attemptedAt, requestId, httpStatus });
        }
        if (deadlineAborted || Date.now() >= deadline) {
          throw deliveryError('timeout', { attemptedAt, requestId, httpStatus });
        }
        return Object.freeze({
          provider: 'resend',
          accepted: true,
          category: 'accepted',
          code: 'resend_accepted',
          httpStatus,
          providerMessageIdPresent: true,
          providerMessageId: providerBody.id,
          attemptedAt,
          requestId,
        });
      } catch (error) {
        if (deadlineAborted || Date.now() >= deadline) {
          throw deliveryError('timeout', {
            attemptedAt,
            requestId,
            httpStatus: error && error.httpStatus,
          });
        }
        if (error instanceof TransactionalDeliveryError) throw error;
        throw deliveryError('network_failure', { attemptedAt, requestId });
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

function idempotencyKey(purpose, deliveryId) {
  if (!['email-verification', 'password-reset', 'workforce-invitation'].includes(purpose) ||
      typeof deliveryId !== 'string' || !UUID.test(deliveryId)) {
    throw new Error('Transactional delivery operation is invalid');
  }
  const digest = crypto.createHash('sha256')
    .update(`northstar/resend/v1\0${purpose}\0${deliveryId}`, 'utf8')
    .digest('hex');
  return `northstar-b1-${purpose}-${digest}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

class TransactionalEmail {
  constructor(options) {
    if (!options || !options.adapter || typeof options.adapter.send !== 'function') {
      throw new Error('Transactional email adapter is unavailable');
    }
    const origin = canonicalOrigin(options.publicOrigin, options.production !== false);
    if (!origin) throw new Error('Canonical public origin is invalid');
    this.adapter = options.adapter;
    this.publicOrigin = origin;
    this.from = Object.freeze({
      name: TRANSACTIONAL_SENDER_NAME,
      address: emailAddress(options.from, 'sender'),
    });
  }

  async deliver(recipient, purpose, subject, text, html, context = {}) {
    const message = Object.freeze({
      from: this.from,
      to: emailAddress(recipient, 'recipient'),
      subject: bounded(subject, MAX_SUBJECT, 'subject'),
      text: bounded(text, MAX_TEXT, 'text body', true),
      html: bounded(html, MAX_HTML, 'HTML body', true),
    });
    const result = await this.adapter.send(message, {
      idempotencyKey: idempotencyKey(purpose, context.deliveryId),
      requestId: safeRequestId(context.requestId),
    });
    if (!result || result.accepted !== true) throw new Error('Transactional email was not accepted');
    return { delivered: true };
  }

  verification(recipient, rawToken, context) {
    const link = new URL('/verify-email', this.publicOrigin);
    link.searchParams.set('token', bounded(rawToken, 128, 'verification token'));
    const href = link.toString();
    return this.deliver(
      recipient,
      'email-verification',
      'Verify your NorthStar email',
      `Verify your email within 24 hours: ${href}\n\nYour 14-day trial begins only after verification.`,
      `<p>Verify your email within 24 hours: <a href="${escapeHtml(href)}">Verify your email</a></p>` +
        '<p>Your 14-day trial begins only after verification.</p>',
      context
    );
  }

  passwordReset(recipient, rawToken, context) {
    const link = new URL('/reset-password', this.publicOrigin);
    link.searchParams.set('token', bounded(rawToken, 128, 'reset token'));
    const href = link.toString();
    return this.deliver(
      recipient,
      'password-reset',
      'Reset your NorthStar password',
      `Reset your password within 30 minutes: ${href}\n\nIf you did not request this, no action is required.`,
      `<p>Reset your password within 30 minutes: <a href="${escapeHtml(href)}">Reset your password</a></p>` +
        '<p>If you did not request this, no action is required.</p>',
      context
    );
  }

  invitation(recipient, rawToken, context, invite = {}) {
    const link = new URL('/accept-invitation', this.publicOrigin);
    link.searchParams.set('token', bounded(rawToken, 128, 'invitation token'));
    const href = link.toString();
    const envelope = workforceInvitationEnvelope(recipient, invite);
    const person = envelope.person;
    const organization = bounded(invite.organizationName || 'your organization', 200, 'organization name');
    return this.deliver(
      envelope.recipient,
      'workforce-invitation',
      `Join ${organization} on NorthStar`,
      `${person}, you were invited to join ${organization} on NorthStar. Set your password within 72 hours: ${href}`,
      `<p>${escapeHtml(person)}, you were invited to join ${escapeHtml(organization)} on NorthStar.</p>` +
        `<p><a href="${escapeHtml(href)}">Set your password and accept the invitation</a> within 72 hours.</p>`,
      context
    );
  }
}

function createProductionTransactionalEmail(environment, options = {}) {
  const configuration = validatedProductionConfiguration(environment);
  if (!configuration) return null;
  const adapter = createResendAdapter(configuration, options);
  if (!adapter) return null;
  return new TransactionalEmail({
    adapter,
    publicOrigin: configuration.origin,
    from: configuration.from,
    production: true,
  });
}

module.exports = {
  TransactionalDeliveryError,
  TransactionalEmail,
  canonicalOrigin,
  createProductionTransactionalEmail,
  createResendAdapter,
  validatedProductionConfiguration,
  workforceInvitationEnvelope,
};
