'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

function publicBody(response) {
  const { requestId: _requestId, ...body } = response.body;
  return body;
}

describe('Mission 20 Phase 7 Lane 2 mounted account-authority safety', () => {
  let allocation;
  let db;
  let pool;
  let app;
  let repository;
  let loginDelays;
  let invitationDeliveries;
  let priorDatabaseUrl;

  async function ownerFixture(email, status = 'active') {
    const { hashPassword } = require('../../src/accounts/service');
    const { provisionDurableSession } = require('../helpers/account-session-fixture');
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const password = `Lane2-${crypto.randomUUID()}!`;
    await pool.query(
      'INSERT INTO organizations (id, name, owner_name, email, phone) VALUES ($1,$2,$3,$4,$5)',
      [organizationId, `Organization ${email}`, 'Lane 2 Owner', email, '']
    );
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email, email_normalized, password_hash, phone, role, status)
       VALUES ($1,$2,'Lane 2 Owner',$3,$3,$4,'','owner',$5)`,
      [userId, organizationId, email, await hashPassword(password), status]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId,
      userId,
      expectedVersion: null,
      profile: canonicalFenceProfile({ companyName: `Organization ${email}` }),
    });
    const session = await provisionDurableSession(pool, {
      organizationId,
      userId,
      role: 'owner',
      onboardingStatus: 'business_profile_required',
      subscriptionStatus: 'active',
    });
    return { organizationId, userId, password, headers: session.headers };
  }

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Disposable PostgreSQL 18 identity is required for Phase 7 Lane 2');
    }
    allocation = await createSuiteDatabase('m20 phase7 lane2 account authority');
    priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = allocation.connectionString;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();

    const { AccountRepository } = require('../../src/accounts/repository');
    const { AccountService } = require('../../src/accounts/service');
    const { createAuthRouter } = require('../../src/routes/auth');
    const { WorkforceService } = require('../../src/workforce/service');
    const { createWorkforceRouter } = require('../../src/routes/workforce');
    repository = new AccountRepository(pool);
    loginDelays = [];
    invitationDeliveries = [];
    const accountService = new AccountService(repository, {
      sleep: async milliseconds => { loginDelays.push(milliseconds); },
    });
    const workforceService = new WorkforceService(undefined, {
      accountRepository: repository,
      transactionalEmail: {
        async invitation(recipient, rawToken, context, invite) {
          invitationDeliveries.push({ recipient, rawToken, context, invite });
          return { delivered: true };
        },
      },
    });

    app = express();
    app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
    app.locals.accountRepository = repository;
    app.locals.workforceService = workforceService;
    app.use(express.json({ limit: '1mb' }));
    app.use('/api/auth', createAuthRouter({
      service: accountService,
      signup: accountService.signup.bind(accountService),
    }));
    app.use('/api/workforce', createWorkforceRouter());
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (allocation) await allocation.cleanup();
  }, 60000);

  beforeEach(async () => {
    loginDelays.length = 0;
    invitationDeliveries.length = 0;
    await pool.query('DELETE FROM auth_rate_limits');
  });

  test('pending-verification owner cannot issue or deliver an invitation while a verified owner retains the owner-only workflow', async () => {
    const pending = await ownerFixture(`pending-owner-${crypto.randomUUID()}@example.test`, 'pending_verification');
    const denied = await request(app).post('/api/workforce/invitations').set(pending.headers).send({
      name: 'Pending target',
      email: `pending-target-${crypto.randomUUID()}@example.test`,
      phone: '',
      accessRole: 'member',
      operationalRole: 'employee',
      homeLocationId: null,
      skillIds: [],
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('verification_required');
    expect(invitationDeliveries).toEqual([]);
    expect((await pool.query(
      'SELECT count(*)::int AS count FROM workforce_invitations WHERE organization_id = $1',
      [pending.organizationId]
    )).rows[0].count).toBe(0);

    const verified = await ownerFixture(`verified-owner-${crypto.randomUUID()}@example.test`, 'active');
    const accepted = await request(app).post('/api/workforce/invitations').set(verified.headers).send({
      name: 'Verified target',
      email: `verified-target-${crypto.randomUUID()}@example.test`,
      phone: '',
      accessRole: 'member',
      operationalRole: 'employee',
      homeLocationId: null,
      skillIds: [],
    });
    expect(accepted.status).toBe(202);
    expect(invitationDeliveries).toHaveLength(1);

    const invitationBeforeDeniedResend = (await pool.query(
      `SELECT token_hash, delivery_generation, updated_at
         FROM workforce_invitations
        WHERE organization_id = $1 AND id = $2`,
      [verified.organizationId, accepted.body.data.invitationId]
    )).rows[0];
    await pool.query("UPDATE users SET status = 'pending_verification' WHERE id = $1", [verified.userId]);
    const deniedResend = await request(app)
      .post(`/api/workforce/invitations/${accepted.body.data.invitationId}/resend`)
      .set(verified.headers)
      .send({});
    expect(deniedResend.status).toBe(403);
    expect(deniedResend.body.code).toBe('verification_required');
    expect(invitationDeliveries).toHaveLength(1);
    const invitationAfterDeniedResend = (await pool.query(
      `SELECT token_hash, delivery_generation, updated_at
         FROM workforce_invitations
        WHERE organization_id = $1 AND id = $2`,
      [verified.organizationId, accepted.body.data.invitationId]
    )).rows[0];
    expect(invitationAfterDeniedResend).toEqual(invitationBeforeDeniedResend);
  });

  test('failures from one source cannot block a correct credential from another and pair delays are progressive without a global email row', async () => {
    const account = await ownerFixture(`login-source-${crypto.randomUUID()}@example.test`, 'active');
    const email = (await pool.query('SELECT email FROM users WHERE id = $1', [account.userId])).rows[0].email;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const rejected = await request(app).post('/api/auth/login')
        .set('X-Forwarded-For', '198.51.100.10')
        .send({ email, password: 'wrong-password' });
      expect(rejected.status).toBe(401);
      expect(rejected.body).toMatchObject({ code: 'invalid_credentials', error: 'Invalid email or password' });
    }
    expect(loginDelays).toEqual([0, 0, 250, 500, 1000, 2000]);

    const correct = await request(app).post('/api/auth/login')
      .set('X-Forwarded-For', '198.51.100.11')
      .send({ email, password: account.password });
    expect(correct.status).toBe(200);
    const limits = await pool.query(
      `SELECT event_type, key_hash, attempt_count FROM auth_rate_limits
        WHERE event_type IN ('login_ip', 'login_email', 'login_source_email')
        ORDER BY event_type, key_hash`
    );
    expect(limits.rows.some(row => row.event_type === 'login_email')).toBe(false);
    expect(limits.rows.some(row => row.event_type === 'login_source_email' && row.attempt_count === 6)).toBe(true);
    expect(limits.rows.every(row => /^[0-9a-f]{64}$/.test(row.key_hash))).toBe(true);
    expect(JSON.stringify(limits.rows)).not.toContain(email);
  });

  test('valid signup and recovery responses are provider-independent and enqueue durable work without provider calls', async () => {
    const email = `uniform-signup-${crypto.randomUUID()}@example.test`;
    const payload = {
      name: 'Uniform Owner',
      businessName: 'Uniform Company',
      email,
      password: 'Uniform-password-123!',
      phone: '',
    };
    const created = await request(app).post('/api/auth/signup').send(payload);
    const duplicate = await request(app).post('/api/auth/signup').send(payload);
    expect(created.status).toBe(202);
    expect(duplicate.status).toBe(202);
    expect(publicBody(created)).toEqual(publicBody(duplicate));
    expect(publicBody(created)).toEqual({
      success: true,
      code: 'verification_required',
      message: 'If signup was accepted, check your email for a verification link.',
    });

    await pool.query("UPDATE users SET status = 'active' WHERE email_normalized = $1", [email]);
    const existing = await request(app).post('/api/auth/forgot-password').send({ email });
    const missing = await request(app).post('/api/auth/forgot-password').send({
      email: `missing-${crypto.randomUUID()}@example.test`,
    });
    expect(existing.status).toBe(202);
    expect(missing.status).toBe(202);
    expect(publicBody(existing)).toEqual(publicBody(missing));
    expect(publicBody(existing)).toEqual({
      success: true,
      code: 'recovery_requested',
      message: 'If the account is eligible and delivery succeeds, a reset link will be sent.',
    });

    const jobs = await pool.query(
      `SELECT purpose, state, attempt_count, octet_length(recipient) AS recipient_bytes,
              octet_length(raw_token) AS token_bytes
         FROM account_email_outbox
        WHERE recipient = $1
        ORDER BY created_at, id`,
      [email]
    );
    expect(jobs.rows).toEqual([
      expect.objectContaining({ purpose: 'email_verification', state: 'pending', attempt_count: 0 }),
      expect.objectContaining({ purpose: 'password_reset', state: 'pending', attempt_count: 0 }),
    ]);
    expect(jobs.rows.every(row => row.recipient_bytes <= 254 && row.token_bytes === 43)).toBe(true);
  });

  test('signup rejects adapter-undeliverable addresses before commit and preserves canonical normalization', async () => {
    const invalidAddresses = [
      `ü-${crypto.randomUUID()}@example.test`,
      `u\u0308-${crypto.randomUUID()}@example.test`,
      `comma-${crypto.randomUUID()},alias@example.test`,
      `semicolon-${crypto.randomUUID()};alias@example.test`,
      `.leading-${crypto.randomUUID()}@example.test`,
      `double..dot-${crypto.randomUUID()}@example.test`,
      `${'a'.repeat(65)}@example.test`,
      `user@${'b'.repeat(64)}.test`,
    ];
    const before = (await pool.query(
      `SELECT (SELECT count(*)::int FROM organizations) AS organizations,
              (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM account_action_tokens) AS tokens,
              (SELECT count(*)::int FROM account_email_outbox) AS outbox`
    )).rows[0];

    for (const email of invalidAddresses) {
      const response = await request(app).post('/api/auth/signup').send({
        name: 'Undeliverable Owner',
        businessName: 'Undeliverable Company',
        email,
        password: 'Undeliverable-password-123!',
        phone: '',
      });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        code: 'invalid_email',
        error: 'Enter a valid email address of at most 254 characters',
      });
    }
    const afterInvalid = (await pool.query(
      `SELECT (SELECT count(*)::int FROM organizations) AS organizations,
              (SELECT count(*)::int FROM users) AS users,
              (SELECT count(*)::int FROM account_action_tokens) AS tokens,
              (SELECT count(*)::int FROM account_email_outbox) AS outbox`
    )).rows[0];
    expect(afterInvalid).toEqual(before);
    expect((await pool.query(
      "SELECT count(*)::int AS count FROM auth_rate_limits WHERE event_type = 'signup_ip'"
    )).rows).toEqual([{ count: 0 }]);

    const suffix = crypto.randomUUID().replace(/-/g, '');
    const submitted = `  First.Last+${suffix}@Example.Test  `;
    const normalized = `first.last+${suffix}@example.test`;
    const accepted = await request(app).post('/api/auth/signup').send({
      name: 'Normalized Owner',
      businessName: 'Normalized Company',
      email: submitted,
      password: 'Normalized-password-123!',
      phone: '',
    });
    expect(accepted.status).toBe(202);
    expect(publicBody(accepted)).toEqual({
      success: true,
      code: 'verification_required',
      message: 'If signup was accepted, check your email for a verification link.',
    });
    expect((await pool.query(
      `SELECT u.email, u.email_normalized, outbox.recipient, outbox.state, outbox.attempt_count
         FROM users u
         JOIN account_email_outbox outbox ON outbox.user_id = u.id
        WHERE u.email_normalized = $1`,
      [normalized]
    )).rows).toEqual([{
      email: normalized,
      email_normalized: normalized,
      recipient: normalized,
      state: 'pending',
      attempt_count: 0,
    }]);
  });
});
