'use strict';

const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const tls = require('tls');
const request = require('supertest');

const CONFIGURATION_KEYS = [
  'PUBLIC_ORIGIN', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS',
  'TRANSACTIONAL_EMAIL_FROM', 'ACCOUNT_SIGNUP_ENABLED',
  'ACCOUNT_VERIFICATION_DELIVERY_READY',
];

const RELATIONS = [
  'organizations', 'users', 'organization_memberships', 'notification_preferences',
  'organization_account_preferences', 'organization_onboarding', 'subscriptions',
  'account_action_tokens',
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
  let rawPool;
  const originals = Object.fromEntries(CONFIGURATION_KEYS.map(key => [key, process.env[key]]));
  try {
    for (const key of CONFIGURATION_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(message.configuration || {})) {
      if (value !== undefined && value !== null) process.env[key] = value;
    }
    process.env.AUTH_ACCESS_SECRET ||= crypto.randomBytes(48).toString('hex');

    let pool;
    if (message.expectEnabled) {
      db = require('../../src/db');
      if (await db.initDatabase() !== true) throw new Error('worker PostgreSQL initialization failed');
      pool = db.getPool();
    } else {
      const { Pool } = require('pg');
      rawPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      pool = rawPool;
    }
    const before = await counts(pool);

    let transportConstructions = 0;
    let sends = 0;
    const nodemailer = require('nodemailer');
    nodemailer.createTransport = () => {
      transportConstructions += 1;
      return {
        async sendMail() {
          sends += 1;
          return { accepted: ['mounted-positive@example.test'] };
        },
      };
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
      .post('/api/auth/signup?SMTP_HOST=attacker.invalid&upgrade=true')
      .set('X-SMTP-Host', 'attacker.invalid')
      .set('X-Upgrade-Available', 'true')
      .send({
        name: 'Capability Worker', businessName: 'Capability Worker', phone: '',
        email, password: 'Capability-worker-password-123!',
        SMTP_HOST: 'attacker.invalid', paid: true, upgradeAvailable: true,
      });
    const after = await counts(pool);
    const disclosure = JSON.stringify({ body: response.body, headers: response.headers });

    dns.lookup = realLookup;
    net.connect = realConnect;
    tls.connect = realTlsConnect;

    process.send({
      type: 'result', status: response.status, cookies: response.headers['set-cookie'] || [],
      before, after, transportConstructions, sends, dnsCalls, netCalls, tlsCalls,
      disclosure,
    });
  } catch (error) {
    process.send({ type: 'error', message: error && error.stack || String(error) });
  } finally {
    if (db) await db.close().catch(() => {});
    if (rawPool) await rawPool.end().catch(() => {});
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    process.disconnect();
  }
});
