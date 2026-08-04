'use strict';

const crypto = require('crypto');
const { TextDecoder } = require('util');

const STRIPE_API_ORIGIN = 'https://api.stripe.com';
const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024;
const MAX_WEBHOOK_BYTES = 1024 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;

class StripeProviderError extends Error {
  constructor(code, options = {}) {
    super('Stripe billing provider request failed');
    this.name = 'StripeProviderError';
    this.code = code;
    this.indeterminate = options.indeterminate === true;
  }
}

class BillingWebhookError extends Error {
  constructor(code = 'billing_webhook_invalid') {
    super('Billing webhook validation failed');
    this.name = 'BillingWebhookError';
    this.code = code;
  }
}

function validIdentifier(value, prefix) {
  return typeof value === 'string' && value.length <= 255 &&
    new RegExp('^' + prefix + '[A-Za-z0-9_]+$').test(value);
}

function secureEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function verifyStripeSignature(input) {
  const source = input && typeof input === 'object' ? input : {};
  const rawBody = source.rawBody;
  const header = source.signatureHeader;
  const secret = source.secret;
  const nowSeconds = source.nowSeconds === undefined
    ? Math.floor(Date.now() / 1000)
    : source.nowSeconds;
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 || rawBody.length > MAX_WEBHOOK_BYTES ||
      typeof header !== 'string' || header.length === 0 || header.length > 4096 ||
      typeof secret !== 'string' || secret.length === 0 || secret.length > 1024 ||
      !Number.isSafeInteger(nowSeconds)) throw new BillingWebhookError();

  const timestamps = [];
  const signatures = [];
  for (const item of header.split(',')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key === 't') timestamps.push(value);
    if (key === 'v1') signatures.push(value.toLowerCase());
  }
  if (timestamps.length !== 1 || signatures.length === 0 ||
      !/^\d{1,12}$/.test(timestamps[0]) ||
      signatures.some(value => !/^[a-f0-9]{64}$/.test(value))) {
    throw new BillingWebhookError();
  }
  const timestamp = Number(timestamps[0]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new BillingWebhookError();
  }
  const expected = crypto.createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(String(timestamp) + '.', 'utf8'), rawBody]))
    .digest('hex');
  if (!signatures.some(value => secureEqualHex(value, expected))) throw new BillingWebhookError();
  return Object.freeze({ timestamp });
}

function parseSignedEvent(input) {
  const verified = verifyStripeSignature(input);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody);
  } catch (_error) {
    throw new BillingWebhookError();
  }
  let event;
  try {
    event = JSON.parse(text);
  } catch (_error) {
    throw new BillingWebhookError();
  }
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
      !validIdentifier(event.id, 'evt_') || typeof event.type !== 'string' ||
      event.type.length > 128 || !/^[a-z][a-z0-9_.]+$/.test(event.type) ||
      !Number.isSafeInteger(event.created) || event.created <= 0 ||
      typeof event.api_version !== 'string' || event.api_version.length > 64 ||
      !event.data || typeof event.data !== 'object' || Array.isArray(event.data) ||
      !event.data.object || typeof event.data.object !== 'object' || Array.isArray(event.data.object)) {
    throw new BillingWebhookError('billing_webhook_unsupported_schema');
  }
  return Object.freeze({ event, signatureTimestamp: verified.timestamp });
}

async function readBounded(response) {
  const declared = response.headers && response.headers.get && response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_PROVIDER_RESPONSE_BYTES)) {
    try { if (response.body && response.body.cancel) await response.body.cancel(); } catch (_error) { /* bounded cleanup */ }
    throw new StripeProviderError('billing_provider_malformed_response', { indeterminate: true });
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new StripeProviderError('billing_provider_malformed_response', { indeterminate: true });
    }
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        complete = true;
        break;
      }
      const chunk = Buffer.from(result.value);
      size += chunk.length;
      if (size > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new StripeProviderError('billing_provider_malformed_response', { indeterminate: true });
      }
      chunks.push(chunk);
    }
  } finally {
    if (!complete && typeof reader.cancel === 'function') {
      try { await reader.cancel(); } catch (_error) { /* bounded cleanup */ }
    }
    try { reader.releaseLock(); } catch (_error) { /* bounded cleanup */ }
  }
  return Buffer.concat(chunks);
}

function providerStatusError(status) {
  if (status === 409) return new StripeProviderError('billing_provider_conflict');
  if (status === 429) return new StripeProviderError('billing_provider_rate_limited');
  if (status === 401 || status === 403) return new StripeProviderError('billing_provider_access_rejected');
  if (status === 400 || status === 404 || status === 422) {
    return new StripeProviderError('billing_provider_request_rejected');
  }
  if (status >= 500 && status <= 599) {
    return new StripeProviderError('billing_provider_unavailable', { indeterminate: true });
  }
  if (status >= 300 && status <= 399) return new StripeProviderError('billing_provider_redirect_rejected');
  return new StripeProviderError('billing_provider_unavailable', { indeterminate: true });
}

function safeJson(buffer) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid object');
    return value;
  } catch (_error) {
    throw new StripeProviderError('billing_provider_malformed_response', { indeterminate: true });
  }
}

class StripeProvider {
  constructor(configuration, options = {}) {
    if (!configuration || configuration.provider !== 'stripe' ||
        typeof configuration.secretKey !== 'string' || typeof configuration.webhookSecret !== 'string') {
      throw new TypeError('Complete billing configuration is required');
    }
    this.configuration = configuration;
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
      ? Math.min(options.timeoutMs, 30000)
      : 8000;
    this.now = typeof options.now === 'function' ? options.now : () => new Date();
    if (typeof this.fetchImpl !== 'function') throw new TypeError('Billing transport is unavailable');
  }

  parseWebhook(rawBody, signatureHeader, nowSeconds) {
    const parsed = parseSignedEvent({
      rawBody,
      signatureHeader,
      secret: this.configuration.webhookSecret,
      nowSeconds,
    });
    if (parsed.event.api_version !== this.configuration.apiVersion) {
      throw new BillingWebhookError('billing_webhook_version_unavailable');
    }
    return parsed.event;
  }

  async request(pathname, form, idempotencyKey) {
    const controller = new AbortController();
    let deadlineReached = false;
    const timer = setTimeout(() => {
      deadlineReached = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      try {
        const response = await this.fetchImpl(STRIPE_API_ORIGIN + pathname, {
          method: 'POST',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Authorization: 'Bearer ' + this.configuration.secretKey,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Idempotency-Key': idempotencyKey,
            'Stripe-Version': this.configuration.apiVersion,
          },
          body: form.toString(),
        });
        if (!response || !Number.isInteger(response.status)) {
          throw new StripeProviderError('billing_provider_malformed_response', { indeterminate: true });
        }
        if (response.status < 200 || response.status >= 300) {
          try { if (response.body && response.body.cancel) await response.body.cancel(); } catch (_error) { /* bounded cleanup */ }
          throw providerStatusError(response.status);
        }
        return safeJson(await readBounded(response));
      } catch (error) {
        if (error instanceof StripeProviderError) throw error;
        if (deadlineReached || (error && error.name === 'AbortError')) {
          throw new StripeProviderError('billing_provider_timeout', { indeterminate: true });
        }
        throw new StripeProviderError('billing_provider_network_failure', { indeterminate: true });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async createCheckout(input) {
    const plan = this.configuration.plans[input.planKey];
    if (!plan || !/^[0-9a-f-]{36}$/.test(input.organizationId) ||
        typeof input.email !== 'string' || input.email.length > 254 ||
        typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length > 96) {
      throw new StripeProviderError('billing_provider_request_rejected');
    }
    const now = this.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new StripeProviderError('billing_provider_unavailable');
    }
    const requestedExpiry = input.expiresAt === undefined ? null : new Date(input.expiresAt);
    const expiresAtSeconds = requestedExpiry && Number.isFinite(requestedExpiry.getTime())
      ? Math.floor(requestedExpiry.getTime() / 1000)
      : Math.floor(now.getTime() / 1000) + 1800;
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (expiresAtSeconds <= nowSeconds || expiresAtSeconds > nowSeconds + 1860) {
      throw new StripeProviderError('billing_provider_request_rejected');
    }
    const form = new URLSearchParams();
    form.set('mode', 'subscription');
    form.set('success_url', this.configuration.publicOrigin + '/dashboard/settings?billing=return');
    form.set('cancel_url', this.configuration.publicOrigin + '/dashboard/settings?billing=cancelled');
    form.set('line_items[0][price]', plan.priceId);
    form.set('line_items[0][quantity]', '1');
    form.set('client_reference_id', input.organizationId);
    if (input.customerId) form.set('customer', input.customerId);
    else form.set('customer_email', input.email);
    form.set('metadata[northstar_organization_id]', input.organizationId);
    form.set('metadata[northstar_plan_key]', plan.key);
    form.set('subscription_data[metadata][northstar_organization_id]', input.organizationId);
    form.set('subscription_data[metadata][northstar_plan_key]', plan.key);
    form.set('automatic_tax[enabled]', 'true');
    form.set('tax_id_collection[enabled]', 'true');
    form.set('billing_address_collection', 'required');
    form.set('payment_method_configuration', this.configuration.paymentMethodConfigurationId);
    form.set('expires_at', String(expiresAtSeconds));
    const response = await this.request('/v1/checkout/sessions', form, input.idempotencyKey);
    if (!validIdentifier(response.id, 'cs_') || !Number.isSafeInteger(response.expires_at) ||
        response.expires_at !== expiresAtSeconds) {
      throw new StripeProviderError('billing_provider_malformed_response', { indeterminate: true });
    }
    let url;
    try { url = new URL(response.url); } catch (_error) { url = null; }
    if (!url || url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' ||
        url.username || url.password || url.hash) {
      throw new StripeProviderError('billing_provider_malformed_response', { indeterminate: true });
    }
    return Object.freeze({
      id: response.id,
      url: url.toString(),
      expiresAt: new Date(response.expires_at * 1000).toISOString(),
    });
  }

  async createPortal(input) {
    if (!validIdentifier(input.customerId, 'cus_') ||
        typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length > 96) {
      throw new StripeProviderError('billing_provider_request_rejected');
    }
    const form = new URLSearchParams();
    form.set('customer', input.customerId);
    form.set('return_url', this.configuration.publicOrigin + '/dashboard/settings?billing=return');
    form.set('configuration', this.configuration.billingPortalConfigurationId);
    const response = await this.request('/v1/billing_portal/sessions', form, input.idempotencyKey);
    if (!validIdentifier(response.id, 'bps_')) {
      throw new StripeProviderError('billing_provider_malformed_response', { indeterminate: true });
    }
    let url;
    try { url = new URL(response.url); } catch (_error) { url = null; }
    if (!url || url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com' ||
        url.username || url.password || url.hash) {
      throw new StripeProviderError('billing_provider_malformed_response', { indeterminate: true });
    }
    return Object.freeze({ id: response.id, url: url.toString() });
  }

  async cancelAtPeriodEnd(input) {
    if (!validIdentifier(input.subscriptionId, 'sub_') ||
        typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length > 96) {
      throw new StripeProviderError('billing_provider_request_rejected');
    }
    const form = new URLSearchParams();
    form.set('cancel_at_period_end', 'true');
    const response = await this.request(
      '/v1/subscriptions/' + encodeURIComponent(input.subscriptionId),
      form,
      input.idempotencyKey
    );
    if (response.id !== input.subscriptionId || response.cancel_at_period_end !== true) {
      throw new StripeProviderError('billing_provider_malformed_response', { indeterminate: true });
    }
    return Object.freeze({ accepted: true });
  }
}

module.exports = {
  BillingWebhookError,
  StripeProvider,
  StripeProviderError,
  parseSignedEvent,
  verifyStripeSignature,
};
