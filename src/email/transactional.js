'use strict';

const nodemailer = require('nodemailer');

const MAX_SUBJECT = 160;
const MAX_TEXT = 12000;
const TRANSACTIONAL_SENDER_NAME = 'NorthStar Notifications';
const CONTROL = /[\u0000-\u001f\u007f]/;
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function bounded(value, maximum, label, allowNewlines = false) {
  if (typeof value !== 'string' || !value || value.length > maximum || value.includes('\0') ||
      (!allowNewlines && /[\r\n]/.test(value))) {
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

function smtpIdentity(value) {
  if (typeof value !== 'string' || !value || value.length > 254 || value !== value.trim() ||
      CONTROL.test(value)) return null;
  return value;
}

function smtpPassword(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || CONTROL.test(value)) return null;
  return value;
}

function smtpPort(value) {
  if (value === '465' || value === 465) return 465;
  if (value === '587' || value === 587) return 587;
  return null;
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

function validatedProductionConfiguration(environment) {
  const env = environment || {};
  const origin = canonicalOrigin(env.PUBLIC_ORIGIN, true);
  const host = dnsHostname(env.SMTP_HOST);
  const port = smtpPort(env.SMTP_PORT);
  const user = smtpIdentity(env.SMTP_USER);
  const pass = smtpPassword(env.SMTP_PASS);
  const from = env.TRANSACTIONAL_EMAIL_FROM;
  if (!origin || !host || !port || !user || !pass || typeof from !== 'string') return null;
  try {
    return Object.freeze({
      origin, host, port, user,
      pass, from: emailAddress(from, 'sender'), secure: port === 465,
    });
  } catch (_error) {
    return null;
  }
}

function createNodemailerAdapter(configuration) {
  if (!configuration) return null;
  const transport = nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    requireTLS: !configuration.secure,
    auth: { user: configuration.user, pass: configuration.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return Object.freeze({
    async send(message) {
      const result = await transport.sendMail(message);
      return { accepted: Array.isArray(result.accepted) && result.accepted.length > 0 };
    },
  });
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

  async deliver(recipient, subject, text) {
    const message = Object.freeze({
      from: this.from,
      to: emailAddress(recipient, 'recipient'),
      subject: bounded(subject, MAX_SUBJECT, 'subject'),
      text: bounded(text, MAX_TEXT, 'body', true),
    });
    const result = await this.adapter.send(message);
    if (!result || result.accepted !== true) throw new Error('Transactional email was not accepted');
    return { delivered: true };
  }

  verification(recipient, rawToken) {
    const link = new URL('/verify-email', this.publicOrigin);
    link.searchParams.set('token', bounded(rawToken, 128, 'verification token'));
    return this.deliver(
      recipient,
      'Verify your NorthStar email',
      `Verify your email within 24 hours: ${link.toString()}\n\nYour 14-day trial begins only after verification.`
    );
  }

  passwordReset(recipient, rawToken) {
    const link = new URL('/reset-password', this.publicOrigin);
    link.searchParams.set('token', bounded(rawToken, 128, 'reset token'));
    return this.deliver(
      recipient,
      'Reset your NorthStar password',
      `Reset your password within 30 minutes: ${link.toString()}\n\nIf you did not request this, no action is required.`
    );
  }
}

function createProductionTransactionalEmail(environment) {
  const configuration = validatedProductionConfiguration(environment);
  if (!configuration) return null;
  return new TransactionalEmail({
    adapter: createNodemailerAdapter(configuration),
    publicOrigin: configuration.origin,
    from: configuration.from,
    production: true,
  });
}

module.exports = {
  TransactionalEmail,
  canonicalOrigin,
  createProductionTransactionalEmail,
  validatedProductionConfiguration,
};
