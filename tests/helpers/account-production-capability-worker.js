'use strict';

const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const tls = require('tls');
const request = require('supertest');

const CONFIGURATION_KEYS = [
  'PUBLIC_ORIGIN', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS',
  'TRANSACTIONAL_EMAIL_FROM', 'TRANSACTIONAL_EMAIL_FROM_NAME', 'ACCOUNT_SIGNUP_ENABLED',
  'ACCOUNT_VERIFICATION_DELIVERY_READY',
];

const RELATIONS = [
  'organizations', 'users', 'organization_memberships', 'notification_preferences',
  'organization_account_preferences', 'organization_onboarding', 'subscriptions',
  'account_action_tokens', 'account_email_outbox',
];

async function counts(pool) {
  const result = {};
  for (const relation of RELATIONS) {
    result[relation] = Number((await pool.query(`SELECT count(*)::int AS count FROM ${relation}`)).rows[0].count);
  }
  return result;
}

process.once('message', async message => {
  let db;
  let realFetch;
  const originals = Object.fromEntries(CONFIGURATION_KEYS.map(key => [key, process.env[key]]));
  try {
    for (const key of CONFIGURATION_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(message.configuration || {})) {
      if (value !== undefined && value !== null) process.env[key] = value;
    }
    process.env.AUTH_ACCESS_SECRET ||= crypto.randomBytes(48).toString('hex');

    db = require('../../src/db');
    if (await db.initDatabase() !== true) throw new Error('worker PostgreSQL initialization failed');
    const pool = db.getPool();
    const before = await counts(pool);

    let transportConstructions = 0;
    const nodemailer = require('nodemailer');
    nodemailer.createTransport = () => {
      transportConstructions += 1;
      throw new Error('Mounted B1 production attempted retired SMTP construction');
    };

    let providerRequests = 0;
    const requestEvidence = [];
    realFetch = global.fetch;
    global.fetch = async (url, options) => {
      providerRequests += 1;
      const body = JSON.parse(options.body);
      const authorization = String(options.headers.Authorization || '');
      const idempotency = String(options.headers['Idempotency-Key'] || '');
      requestEvidence.push({
        url: String(url), method: options.method, redirect: options.redirect,
        contentType: options.headers['Content-Type'],
        authorizationPresent: authorization === `Bearer ${process.env.RESEND_API_KEY}`,
        idempotencyPresent: /^northstar-b1-email-verification-[0-9a-f]{64}$/.test(idempotency),
        idempotencyLength: idempotency.length,
        from: body.from,
        normalizedRecipient: Array.isArray(body.to) && body.to.length === 1 && body.to[0] === email,
        subject: body.subject,
        hasCanonicalTextLink: typeof body.text === 'string' && body.text.includes('https://www.northstar-os.ai/verify-email?token='),
        hasCanonicalHtmlLink: typeof body.html === 'string' && body.html.includes('https://www.northstar-os.ai/verify-email?token='),
        forbiddenFieldsAbsent: ['reply_to', 'cc', 'bcc', 'headers'].every(key => !Object.hasOwn(body, key)),
        headerNames: Object.keys(options.headers).sort(),
      });
      const status = Number(message.providerStatus || 200);
      return new Response(JSON.stringify(status >= 200 && status < 300
        ? { id: 'mounted-provider-message-1' }
        : { message: 'bounded provider rejection' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    let dnsCalls = 0;
    let netCalls = 0;
    let tlsCalls = 0;
    const realLookup = dns.lookup;
    const realConnect = net.connect;
    const realTlsConnect = tls.connect;
    dns.lookup = function () { dnsCalls += 1; return realLookup.apply(this, arguments); };
    net.connect = function () { netCalls += 1; return realConnect.apply(this, arguments); };
    tls.connect = function () { tlsCalls += 1; return realTlsConnect.apply(this, arguments); };

    const { app } = require('../../src/server');
    const marker = message.marker || crypto.randomUUID();
    const email = `${marker}@example.test`;
    const response = await request(app)
      .post('/api/auth/signup?RESEND_API_KEY=attacker&upgrade=true')
      .set('X-Resend-Api-Key', 'attacker')
      .set('X-Upgrade-Available', 'true')
      .send({
        name: 'Capability Worker', businessName: 'Capability Worker', phone: '',
        email, password: 'Capability-worker-password-123!',
        RESEND_API_KEY: 'attacker', paid: true, upgradeAvailable: true,
      });
    const publicProviderRequests = providerRequests;
    const { AccountRepository } = require('../../src/accounts/repository');
    const { AccountEmailOutboxWorker } = require('../../src/email/outbox');
    const { createProductionTransactionalEmail } = require('../../src/email/transactional');
    const outboxTransactionalEmail = createProductionTransactionalEmail(process.env);
    const outboxWorker = new AccountEmailOutboxWorker({
      repository: new AccountRepository(pool),
      transactionalEmail: outboxTransactionalEmail,
      batchSize: 1,
    });
    const drain = await outboxWorker.drainOnce();
    const after = await counts(pool);
    const authorityResult = await pool.query(
      `SELECT s.status, s.trial_started_at, s.trial_ends_at,
              (SELECT count(*)::int FROM auth_sessions a WHERE a.user_id = u.id) AS session_count
         FROM users u
         JOIN organization_memberships m ON m.user_id = u.id
         JOIN subscriptions s ON s.organization_id = m.organization_id
        WHERE u.email_normalized = lower(trim($1))`,
      [email]
    );
    const authority = authorityResult.rowCount === 1 ? {
      state: authorityResult.rows[0].status,
      trialStarted: authorityResult.rows[0].trial_started_at !== null,
      trialEnds: authorityResult.rows[0].trial_ends_at !== null,
      sessionCount: Number(authorityResult.rows[0].session_count),
    } : null;
    const outbox = (await pool.query(
      `SELECT outbox.state, outbox.attempt_count, outbox.raw_token IS NULL AS token_erased
         FROM account_email_outbox outbox
         JOIN users account ON account.id = outbox.user_id
        WHERE account.email_normalized = lower(trim($1))`,
      [email]
    )).rows[0] || null;
    const disclosure = JSON.stringify({ body: response.body, headers: response.headers });
    if (!message.expectEnabled) {
      await pool.query(
        `UPDATE account_action_tokens token
            SET consumed_at = NOW()
           FROM users account
          WHERE account.id = token.user_id AND account.email_normalized = lower(trim($1))`,
        [email]
      );
    }

    dns.lookup = realLookup;
    net.connect = realConnect;
    tls.connect = realTlsConnect;
    global.fetch = realFetch;

    process.send({
      type: 'result', status: response.status, cookies: response.headers['set-cookie'] || [],
      before, after, transportConstructions, providerRequests, dnsCalls, netCalls, tlsCalls,
      publicProviderRequests, disclosure, requestEvidence, authority, outbox, drain,
      configurationAvailable: Boolean(outboxTransactionalEmail),
    });
  } catch (error) {
    process.send({ type: 'error', message: error && error.stack || String(error) });
  } finally {
    if (db) await db.close().catch(() => {});
    if (typeof realFetch === 'function') global.fetch = realFetch;
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    process.disconnect();
  }
});
