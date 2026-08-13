'use strict';

const crypto = require('crypto');
const path = require('path');
const { fork } = require('child_process');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

function runClaimWorker(connectionString, batchSize = 4) {
  return new Promise((resolve, reject) => {
    const child = fork(path.resolve(__dirname, '../helpers/m20-phase7-lane2-outbox-worker.js'), [], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: connectionString, TZ: 'UTC' },
      silent: true,
    });
    let result = null;
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('message', value => { result = value; });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0 && result && result.type === 'result') return resolve(result);
      reject(new Error(`Lane 2 outbox worker failed: ${code}; ${stderr}`));
    });
    child.send({ action: 'claim', batchSize, leaseSeconds: 30 });
  });
}

describe('Mission 20 Phase 7 Lane 2 durable account email outbox', () => {
  let allocation;
  let priorDatabaseUrl;
  let db;
  let pool;
  let repository;
  let service;

  async function insertJob(purpose = 'email_verification') {
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const id = crypto.randomUUID();
    const recipient = `lane2-${id}@example.test`;
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
    await pool.query(
      "INSERT INTO organizations (id, name, email) VALUES ($1, 'Lane 2 Outbox', $2)",
      [organizationId, recipient]
    );
    await pool.query(
      `INSERT INTO users
         (id, organization_id, name, email, email_normalized, password_hash, role, status)
       VALUES ($1,$2,'Lane 2 User',$3,$3,'not-used','owner','active')`,
      [userId, organizationId, recipient]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$1,'owner','active')`,
      [userId, organizationId]
    );
    await pool.query(
      `INSERT INTO account_action_tokens
         (id, user_id, organization_id, purpose, token_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5,NOW() + INTERVAL '24 hours')`,
      [id, userId, organizationId, purpose, tokenHash]
    );
    await pool.query(
      `INSERT INTO account_email_outbox
         (id, user_id, organization_id, purpose, recipient, raw_token)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, userId, organizationId, purpose, recipient, rawToken]
    );
    return { id, userId, organizationId, recipient, rawToken };
  }

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Disposable PostgreSQL 18 identity is required for Phase 7 Lane 2 outbox tests');
    }
    allocation = await createSuiteDatabase('m20 phase7 lane2 outbox');
    priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = allocation.connectionString;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    const { AccountRepository } = require('../../src/accounts/repository');
    const { AccountService } = require('../../src/accounts/service');
    repository = new AccountRepository(pool);
    service = new AccountService(repository);
  }, 60000);

  afterAll(async () => {
    if (db) await db.close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (allocation) await allocation.cleanup();
  }, 60000);

  beforeEach(async () => {
    await pool.query('DELETE FROM account_email_outbox');
    await pool.query('DELETE FROM account_action_tokens');
  });

  test('provider absence leaves durable work unclaimed and unattempted', async () => {
    const job = await insertJob();
    const { AccountEmailOutboxWorker } = require('../../src/email/outbox');
    const worker = new AccountEmailOutboxWorker({ repository });
    await expect(worker.drainOnce()).resolves.toEqual({
      claimed: 0, delivered: 0, configurationUnavailable: true,
    });
    expect((await pool.query(
      'SELECT state, attempt_count, raw_token FROM account_email_outbox WHERE id = $1',
      [job.id]
    )).rows).toEqual([{ state: 'pending', attempt_count: 0, raw_token: job.rawToken }]);
  });

  test('providerless housekeeping expires secrets in bounded batches while valid work remains unclaimed', async () => {
    const expiredJobs = await Promise.all([
      insertJob(),
      insertJob('password_reset'),
      insertJob(),
    ]);
    const validJob = await insertJob('password_reset');
    await pool.query(
      `UPDATE account_action_tokens
          SET created_at = NOW() - INTERVAL '2 hours',
              expires_at = NOW() - INTERVAL '1 hour'
        WHERE id = ANY($1::uuid[])`,
      [expiredJobs.map(job => job.id)]
    );

    const { AccountEmailOutboxWorker } = require('../../src/email/outbox');
    const worker = new AccountEmailOutboxWorker({
      repository,
      batchSize: 2,
      intervalMs: 60000,
    });
    await expect(worker.drainOnce()).resolves.toEqual({
      claimed: 0, delivered: 0, configurationUnavailable: true,
    });
    expect((await pool.query(
      `SELECT state, count(*)::int AS count
         FROM account_email_outbox
        WHERE id = ANY($1::uuid[])
        GROUP BY state
        ORDER BY state`,
      [expiredJobs.map(job => job.id)]
    )).rows).toEqual([
      { state: 'dead', count: 2 },
      { state: 'pending', count: 1 },
    ]);

    await worker.drainOnce();
    expect((await pool.query(
      `SELECT state, count(*)::int AS count,
              count(raw_token)::int AS retained_tokens
         FROM account_email_outbox
        WHERE id = ANY($1::uuid[])
        GROUP BY state`,
      [expiredJobs.map(job => job.id)]
    )).rows).toEqual([{ state: 'dead', count: 3, retained_tokens: 0 }]);
    expect((await pool.query(
      `SELECT state, attempt_count, raw_token
         FROM account_email_outbox
        WHERE id = $1`,
      [validJob.id]
    )).rows).toEqual([{
      state: 'pending', attempt_count: 0, raw_token: validJob.rawToken,
    }]);

    expect(worker.start()).toBe(true);
    while (worker.running) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    worker.stop();
    expect((await pool.query(
      'SELECT state, attempt_count, raw_token FROM account_email_outbox WHERE id = $1',
      [validJob.id]
    )).rows).toEqual([{
      state: 'pending', attempt_count: 0, raw_token: validJob.rawToken,
    }]);
  });

  test('two independent processes claim each job once with disjoint lease ownership', async () => {
    const jobs = await Promise.all(Array.from({ length: 8 }, () => insertJob()));
    const outcomes = await Promise.all([
      runClaimWorker(allocation.connectionString, 4),
      runClaimWorker(allocation.connectionString, 4),
    ]);
    const claimed = outcomes.flatMap(outcome => outcome.jobs);
    expect(new Set(outcomes.map(outcome => outcome.processId)).size).toBe(2);
    expect(claimed).toHaveLength(8);
    expect(new Set(claimed.map(job => job.id)).size).toBe(8);
    expect(new Set(claimed.map(job => job.claimToken)).size).toBe(8);
    expect(claimed.every(job => job.attemptCount === 1)).toBe(true);
    expect(new Set(claimed.map(job => job.id))).toEqual(new Set(jobs.map(job => job.id)));
    expect((await pool.query(
      `SELECT count(*)::int AS count, min(attempt_count)::int AS minimum,
              max(attempt_count)::int AS maximum
         FROM account_email_outbox WHERE state = 'claimed'`
    )).rows).toEqual([{ count: 8, minimum: 1, maximum: 1 }]);
  }, 60000);

  test('a sequential worker claims and renews one job at a time without burning later work', async () => {
    const jobs = [await insertJob(), await insertJob()];
    await pool.query(
      `UPDATE account_email_outbox
          SET available_at = CASE id WHEN $1 THEN NOW() - INTERVAL '2 minutes'
                                     ELSE NOW() - INTERVAL '1 minute' END
        WHERE id = ANY($2::uuid[])`,
      [jobs[0].id, jobs.map(job => job.id)]
    );
    const deliveries = [];
    const leaseRemainingSeconds = [];
    let laterState = null;
    let secondClaim = null;
    const delivery = {
      async verification(recipient) {
        deliveries.push(recipient);
        leaseRemainingSeconds.push(Number((await pool.query(
          `SELECT extract(epoch FROM lease_expires_at - clock_timestamp())::double precision
                    AS remaining_seconds
             FROM account_email_outbox
            WHERE state = 'claimed' AND recipient = $1`,
          [recipient]
        )).rows[0].remaining_seconds));
        if (deliveries.length === 1) {
          laterState = (await pool.query(
            'SELECT state, attempt_count FROM account_email_outbox WHERE id = $1',
            [jobs[1].id]
          )).rows;
          secondClaim = (await repository.claimAccountEmailJobs({ batchSize: 1, leaseSeconds: 30 }))[0];
        }
        return { delivered: true };
      },
      async passwordReset() {
        throw new Error('unexpected password reset delivery');
      },
    };
    const { AccountEmailOutboxWorker } = require('../../src/email/outbox');
    const worker = new AccountEmailOutboxWorker({
      repository,
      transactionalEmail: delivery,
      leaseSeconds: 5,
    });
    expect(worker.batchSize).toBe(10);

    await expect(worker.drainOnce()).resolves.toEqual({
      claimed: 1, delivered: 1, configurationUnavailable: false,
    });
    expect(deliveries).toHaveLength(1);
    expect(leaseRemainingSeconds[0]).toBeGreaterThan(25);
    expect(laterState).toEqual([{ state: 'pending', attempt_count: 0 }]);
    expect(secondClaim).toMatchObject({ id: jobs[1].id, attempt_count: 1 });
    expect((await pool.query(
      `SELECT state, attempt_count, claim_token
         FROM account_email_outbox
        WHERE id = $1`,
      [secondClaim.id]
    )).rows).toEqual([{
      state: 'claimed', attempt_count: 1, claim_token: secondClaim.claim_token,
    }]);
  }, 60000);

  test('successful intercepted delivery erases the token and is not repeated', async () => {
    const job = await insertJob();
    const deliveries = [];
    const { TransactionalEmail } = require('../../src/email/transactional');
    const { AccountEmailOutboxWorker } = require('../../src/email/outbox');
    const transactionalEmail = new TransactionalEmail({
      adapter: {
        async send(message, context) {
          deliveries.push({ message, context });
          return { accepted: true };
        },
      },
      publicOrigin: 'https://lane2.example.test',
      from: 'security@lane2.example.test',
      production: false,
    });
    const worker = new AccountEmailOutboxWorker({ repository, transactionalEmail });
    await expect(worker.drainOnce()).resolves.toEqual({
      claimed: 1, delivered: 1, configurationUnavailable: false,
    });
    await expect(worker.drainOnce()).resolves.toEqual({
      claimed: 0, delivered: 0, configurationUnavailable: false,
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].message.to).toBe(job.recipient);
    expect(deliveries[0].message.text).toContain(encodeURIComponent(job.rawToken));
    expect(deliveries[0].context.idempotencyKey).toMatch(/^northstar-b1-email-verification-[0-9a-f]{64}$/);
    expect(JSON.stringify(deliveries[0].context)).not.toContain(job.recipient);
    expect(JSON.stringify(deliveries[0].context)).not.toContain(job.rawToken);
    expect((await pool.query(
      `SELECT state, attempt_count, raw_token, delivered_at IS NOT NULL AS delivered,
              claim_token IS NULL AS claim_cleared
         FROM account_email_outbox WHERE id = $1`,
      [job.id]
    )).rows).toEqual([{
      state: 'delivered', attempt_count: 1, raw_token: null, delivered: true, claim_cleared: true,
    }]);
  });

  test('provider acceptance followed by a crash retries with the same provider idempotency key', async () => {
    const job = await insertJob();
    const providerKeys = [];
    const { TransactionalEmail } = require('../../src/email/transactional');
    const { AccountEmailOutboxWorker } = require('../../src/email/outbox');
    const transactionalEmail = new TransactionalEmail({
      adapter: {
        async send(_message, context) {
          providerKeys.push(context.idempotencyKey);
          return { accepted: true };
        },
      },
      publicOrigin: 'https://lane2.example.test',
      from: 'security@lane2.example.test',
      production: false,
    });
    const firstClaim = (await repository.claimAccountEmailJobs({ batchSize: 1, leaseSeconds: 30 }))[0];
    await transactionalEmail.verification(firstClaim.recipient, firstClaim.raw_token, {
      deliveryId: firstClaim.id,
      requestId: `outbox-${firstClaim.id}`,
    });
    await pool.query(
      `UPDATE account_email_outbox
          SET claimed_at = NOW() - INTERVAL '2 minutes',
              lease_expires_at = NOW() - INTERVAL '1 minute'
        WHERE id = $1`,
      [job.id]
    );
    expect(await repository.claimAccountEmailJobs({ batchSize: 1, leaseSeconds: 30 })).toEqual([]);
    expect((await pool.query(
      'SELECT state, attempt_count, last_error_category FROM account_email_outbox WHERE id = $1',
      [job.id]
    )).rows).toEqual([{
      state: 'retry', attempt_count: 1, last_error_category: 'claim_expired',
    }]);
    await pool.query("UPDATE account_email_outbox SET available_at = NOW() - INTERVAL '1 second' WHERE id = $1", [job.id]);
    const retryClaim = (await repository.claimAccountEmailJobs({ batchSize: 1, leaseSeconds: 30 }))[0];
    expect(retryClaim.claim_token).not.toBe(firstClaim.claim_token);
    const worker = new AccountEmailOutboxWorker({ repository, transactionalEmail });
    await expect(worker.deliver(retryClaim)).resolves.toEqual({ delivered: true });
    expect(providerKeys).toHaveLength(2);
    expect(new Set(providerKeys).size).toBe(1);
    expect((await pool.query(
      'SELECT state, attempt_count, raw_token FROM account_email_outbox WHERE id = $1',
      [job.id]
    )).rows).toEqual([{ state: 'delivered', attempt_count: 2, raw_token: null }]);
  });

  test('retry backoff is bounded and the fifth failure dead-letters with redacted diagnostics', async () => {
    const job = await insertJob('password_reset');
    const { AccountEmailOutboxWorker } = require('../../src/email/outbox');
    const delivery = {
      async verification() { throw new Error('unexpected verification delivery'); },
      async passwordReset() {
        const error = new Error(`sensitive ${job.recipient} ${job.rawToken}`);
        error.category = 'provider_unavailable';
        throw error;
      },
    };
    const warnings = [];
    const warning = jest.spyOn(console, 'warn').mockImplementation((...args) => { warnings.push(args); });
    try {
      const worker = new AccountEmailOutboxWorker({ repository, transactionalEmail: delivery });
      for (const expected of [15, 60, 300, 900]) {
        await worker.drainOnce();
        const state = (await pool.query(
          `SELECT state, attempt_count,
                  round(extract(epoch FROM (available_at - updated_at)))::int AS backoff
             FROM account_email_outbox WHERE id = $1`,
          [job.id]
        )).rows[0];
        expect(state).toEqual({
          state: 'retry', attempt_count: [15, 60, 300, 900].indexOf(expected) + 1, backoff: expected,
        });
        await pool.query(
          "UPDATE account_email_outbox SET available_at = NOW() - INTERVAL '1 second' WHERE id = $1",
          [job.id]
        );
      }
      await worker.drainOnce();
    } finally {
      warning.mockRestore();
    }
    expect((await pool.query(
      `SELECT state, attempt_count, raw_token, dead_at IS NOT NULL AS dead,
              last_error_category
         FROM account_email_outbox WHERE id = $1`,
      [job.id]
    )).rows).toEqual([{
      state: 'dead', attempt_count: 5, raw_token: null, dead: true,
      last_error_category: 'provider_unavailable',
    }]);
    expect(warnings).toHaveLength(5);
    const diagnostics = JSON.stringify(warnings);
    expect(diagnostics).not.toContain(job.recipient);
    expect(diagnostics).not.toContain(job.rawToken);
    expect(diagnostics).not.toContain('sensitive');
  });

  test('stale claim ownership cannot finalize a recovered lease', async () => {
    const job = await insertJob();
    const stale = (await repository.claimAccountEmailJobs({ batchSize: 1, leaseSeconds: 30 }))[0];
    await pool.query(
      `UPDATE account_email_outbox
          SET claimed_at = NOW() - INTERVAL '2 minutes',
              lease_expires_at = NOW() - INTERVAL '1 minute'
        WHERE id = $1`,
      [job.id]
    );
    await repository.claimAccountEmailJobs({ batchSize: 1, leaseSeconds: 30 });
    await pool.query("UPDATE account_email_outbox SET available_at = NOW() - INTERVAL '1 second' WHERE id = $1", [job.id]);
    const current = (await repository.claimAccountEmailJobs({ batchSize: 1, leaseSeconds: 30 }))[0];
    await expect(repository.finalizeAccountEmailJob({
      id: job.id, claimToken: stale.claim_token, delivered: true,
    })).resolves.toBeNull();
    expect((await pool.query(
      'SELECT state, claim_token FROM account_email_outbox WHERE id = $1',
      [job.id]
    )).rows).toEqual([{ state: 'claimed', claim_token: current.claim_token }]);
    await expect(repository.finalizeAccountEmailJob({
      id: job.id, claimToken: current.claim_token, delivered: true,
    })).resolves.toMatchObject({ state: 'delivered', attempt_count: 2 });
  });

  test('supersession, consumption, and expiry terminalize queued secrets', async () => {
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const email = `reset-${userId}@example.test`;
    await pool.query(
      "INSERT INTO organizations (id, name, email) VALUES ($1, 'Lane 2 Reset', $2)",
      [organizationId, email]
    );
    await pool.query(
      `INSERT INTO users
         (id, organization_id, name, email, email_normalized, password_hash, role, status)
       VALUES ($1,$2,'Lane 2 Reset',$3,$3,'not-used','owner','active')`,
      [userId, organizationId, email]
    );
    await pool.query(
      `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
       VALUES ($1,$2,$1,'owner','active')`,
      [userId, organizationId]
    );
    await service.forgotPassword({ email }, '198.51.100.71');
    await service.forgotPassword({ email }, '198.51.100.71');
    const resetJobs = (await pool.query(
      `SELECT id, state, raw_token, last_error_category
         FROM account_email_outbox WHERE user_id = $1 ORDER BY created_at, id`,
      [userId]
    )).rows;
    expect(resetJobs).toHaveLength(2);
    expect(resetJobs[0]).toMatchObject({ state: 'dead', raw_token: null, last_error_category: 'token_superseded' });
    expect(resetJobs[1]).toMatchObject({ state: 'pending', last_error_category: null });
    const currentToken = resetJobs[1].raw_token;
    await service.resetPassword({ token: currentToken, password: 'Lane2-reset-password-123!' }, '198.51.100.72');
    expect((await pool.query(
      'SELECT state, raw_token, last_error_category FROM account_email_outbox WHERE id = $1',
      [resetJobs[1].id]
    )).rows).toEqual([{ state: 'dead', raw_token: null, last_error_category: 'token_consumed' }]);

    const expired = await insertJob();
    await pool.query(
      `UPDATE account_action_tokens
          SET created_at = NOW() - INTERVAL '2 hours',
              expires_at = NOW() - INTERVAL '1 hour'
        WHERE id = $1`,
      [expired.id]
    );
    expect(await repository.claimAccountEmailJobs({ batchSize: 1 })).toEqual([]);
    expect((await pool.query(
      'SELECT state, raw_token, last_error_category FROM account_email_outbox WHERE id = $1',
      [expired.id]
    )).rows).toEqual([{ state: 'dead', raw_token: null, last_error_category: 'token_unavailable' }]);
  }, 60000);
});
