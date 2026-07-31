'use strict';

const nodemailer = require('nodemailer');

const MAX_SUBJECT = 160;
const MAX_TEXT = 12000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST = /^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/i;

function bounded(value, maximum, label, allowNewlines = false) {
  if (typeof value !== 'string' || !value || value.length > maximum || value.includes('\0') ||
      (!allowNewlines && /[\r\n]/.test(value))) {
    throw new Error(`Invalid transactional email ${label}`);
  }
  return value;
}

function emailAddress(value, label) {
  const normalized = bounded(String(value || '').trim().toLowerCase(), 254, label);
  if (!EMAIL.test(normalized)) throw new Error(`Invalid transactional email ${label}`);
  return normalized;
}

function canonicalOrigin(raw, production = true) {
  let parsed;
  try { parsed = new URL(String(raw || '')); } catch (_error) { return null; }
  if (parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.pathname !== '/' || (production && parsed.protocol !== 'https:') ||
      (!production && !['http:', 'https:'].includes(parsed.protocol))) return null;
  return parsed.origin;
}

function validatedProductionConfiguration(environment) {
  const env = environment || {};
  const origin = canonicalOrigin(env.PUBLIC_ORIGIN, true);
  const host = String(env.SMTP_HOST || '').trim();
  const port = Number(env.SMTP_PORT);
  const user = String(env.SMTP_USER || '').trim();
  const pass = String(env.SMTP_PASS || '');
  const from = String(env.TRANSACTIONAL_EMAIL_FROM || env.SMTP_USER || '').trim();
  if (!origin || !HOST.test(host) || ![465, 587].includes(port) ||
      !user || user.length > 254 || !pass || pass.length > 1024) return null;
  try {
    return Object.freeze({
      origin, host, port, user: bounded(user, 254, 'SMTP user'),
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
    this.from = emailAddress(options.from, 'sender');
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
