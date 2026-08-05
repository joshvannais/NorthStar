'use strict';

const crypto = require('crypto');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const DAY = 86400000;
let sequence = 0;

function at(value) {
  return new Date(value).toISOString();
}

describe('durable trial reminder PostgreSQL authority', () => {
  let allocation;
  let db;
  let pool;
  let priorDatabaseUrl;
  let controlledNow;
  let TrialReminderRepository;
  let TrialReminderService;
  let TransactionalEmail;

  beforeAll(async () => {
    if (!process.env.M19_PG_ADMIN_URL) {
      throw new Error('Disposable PostgreSQL 18 identity is required for trial reminder evidence');
    }
    allocation = await createSuiteDatabase('trial reminder outbox');
    priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = allocation.connectionString;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    pool = db.getPool();
    ({ TrialReminderRepository } = require('../../src/accounts/trialReminderRepository'));
    ({ TrialReminderService } = require('../../src/accounts/trialReminderService'));
    ({ TransactionalEmail } = require('../../src/email/transactional'));
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE trial_reminder_outbox');
  });

  afterAll(async () => {
    if (db) await db.close();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (allocation) await allocation.cleanup();
  });

  async function seedTrial(options = {}) {
    sequence += 1;
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();
    const preferenceId = crypto.randomUUID();
    const suffix = `${sequence}-${organizationId.slice(0, 8)}`;
    const ownerEmail = `owner-${suffix}@example.test`;
    const status = options.status || 'trialing';
    const trialStart = status === 'trialing'
      ? new Date(options.trialStart || controlledNow)
      : null;
    const trialEnd = status === 'trialing'
      ? new Date(options.trialEnd || trialStart.getTime() + 14 * DAY)
      : null;
    const notificationEmail = Object.prototype.hasOwnProperty.call(options, 'notificationEmail')
      ? options.notificationEmail
      : ownerEmail;
    const userStatus = options.userStatus || (status === 'pending_verification' ? 'pending_verification' : 'active');
    const membershipStatus = options.membershipStatus || 'active';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO organizations (id, name, owner_name, email)
         VALUES ($1, $2, 'Owner', $3)`,
        [organizationId, `Trial Reminder ${suffix}`, ownerEmail]
      );
      await client.query(
        `INSERT INTO users (
           id, organization_id, name, email, email_normalized, password_hash, role, status
         ) VALUES ($1, $2, 'Owner', $3, $3, 'test-hash', 'owner', $4)`,
        [userId, organizationId, ownerEmail, userStatus]
      );
      await client.query(
        `INSERT INTO organization_memberships (id, organization_id, user_id, role, status)
         VALUES ($1, $2, $3, 'owner', $4)`,
        [membershipId, organizationId, userId, membershipStatus]
      );
      await client.query(
        `INSERT INTO subscriptions (
           id, organization_id, plan_type, status, trial_started_at, trial_ends_at
         ) VALUES ($1, $2, 'Trial', $3, $4, $5)`,
        [subscriptionId, organizationId, status, trialStart, trialEnd]
      );
      await client.query(
        `INSERT INTO notification_preferences (
           id, organization_id, email_new_lead, email_call_summary, email_appointment,
           sms_new_lead, sms_urgent, notification_email, notification_phone
         ) VALUES ($1, $2, FALSE, FALSE, FALSE, FALSE, FALSE, $3, '')`,
        [preferenceId, organizationId, notificationEmail]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return {
      membershipId,
      notificationEmail,
      organizationId,
      ownerEmail,
      subscriptionId,
      trialEnd,
      trialStart,
      userId,
    };
  }

  function captureDelivery(options = {}) {
    const calls = [];
    let failures = options.failures || 0;
    const email = new TransactionalEmail({
      adapter: {
        async send(message, context) {
          calls.push({ context: { ...context }, message: JSON.parse(JSON.stringify(message)) });
          if (failures > 0) {
            failures -= 1;
            const error = new Error('intercepted provider failure');
            error.provider = 'resend';
            error.code = 'resend_provider_unavailable';
            throw error;
          }
          return { accepted: true, providerMessageId: `capture_${calls.length}` };
        },
      },
      publicOrigin: 'https://trial-reminder.example.test',
      from: 'notifications@trial-reminder.example.test',
      production: false,
    });
    return { calls, email };
  }

  function repository() {
    return new TrialReminderRepository(pool, { testClock: () => controlledNow });
  }

  function service(delivery) {
    return new TrialReminderService(repository(), { transactionalEmail: delivery.email });
  }

  test('migration 014 is authentic, additive, and fixes exact UTC 7/3/1 schedules without recipient storage', async () => {
    const identity = await pool.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              host(inet_server_addr()) AS address`
    );
    expect(identity.rows[0].version).toMatch(/^18\.4(?:\s|$)/);
    expect(identity.rows[0].address).toBe('127.0.0.1');
    const migration = await pool.query(
      `SELECT filename, checksum FROM _migrations WHERE filename = '014_trial_reminder_outbox.sql'`
    );
    expect(migration.rows).toEqual([expect.objectContaining({
      filename: '014_trial_reminder_outbox.sql',
      checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
    })]);

    controlledNow = new Date('2026-11-01T05:30:00.000Z');
    const trial = await seedTrial();
    const result = await repository().reconcileAuthorities(
      require('../../src/email/transactional').normalizeTransactionalRecipient
    );
    expect(result.scheduled).toBe(3);
    const rows = await pool.query(
      `SELECT threshold_days, scheduled_for, recipient_sha256, status
         FROM trial_reminder_outbox WHERE organization_id = $1 ORDER BY threshold_days DESC`,
      [trial.organizationId]
    );
    expect(rows.rows.map(item => ({
      days: item.threshold_days,
      scheduled: item.scheduled_for.toISOString(),
      status: item.status,
    }))).toEqual([7, 3, 1].map(days => ({
      days,
      scheduled: new Date(trial.trialEnd.getTime() - days * DAY).toISOString(),
      status: 'pending',
    })));
    expect(rows.rows.every(item => /^[0-9a-f]{64}$/.test(item.recipient_sha256))).toBe(true);
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'trial_reminder_outbox'`
    );
    expect(columns.rows.map(item => item.column_name)).not.toContain('recipient_email');
  });

  test('pending verification and invalid destination or owner authority fail closed without delivery', async () => {
    controlledNow = new Date('2026-08-10T12:00:00.000Z');
    const pending = await seedTrial({ status: 'pending_verification' });
    const invalidDestination = await seedTrial({ notificationEmail: 'not-an-email' });
    const invalidOwner = await seedTrial({ userStatus: 'suspended' });
    const delivery = captureDelivery();
    const summary = await service(delivery).runOnce();
    expect(summary.sent).toBe(0);
    expect(delivery.calls).toHaveLength(0);
    const rows = await pool.query(
      `SELECT organization_id, count(*)::int AS reminders
         FROM trial_reminder_outbox
        WHERE organization_id = ANY($1::uuid[])
        GROUP BY organization_id`,
      [[pending.organizationId, invalidDestination.organizationId, invalidOwner.organizationId]]
    );
    expect(rows.rows).toEqual([]);
  });

  test('a delayed run sends only the latest due threshold and never bursts earlier reminders', async () => {
    controlledNow = new Date('2026-09-01T00:00:00.000Z');
    const trial = await seedTrial();
    controlledNow = new Date(trial.trialEnd.getTime() - 2 * DAY);
    const delivery = captureDelivery();
    const first = await service(delivery).runOnce();
    expect(first.sent).toBe(1);
    expect(delivery.calls).toHaveLength(1);
    expect(delivery.calls[0].message.text).toContain('scheduled 3-day reminder');

    controlledNow = new Date(trial.trialEnd.getTime() - 12 * 60 * 60 * 1000);
    const second = await service(delivery).runOnce();
    expect(second.sent).toBe(1);
    expect(delivery.calls).toHaveLength(2);
    expect(delivery.calls[1].message.text).toContain('scheduled 1-day reminder');
    const states = await pool.query(
      `SELECT threshold_days, status, terminal_code
         FROM trial_reminder_outbox WHERE organization_id = $1 ORDER BY threshold_days DESC`,
      [trial.organizationId]
    );
    expect(states.rows).toEqual([
      { threshold_days: 7, status: 'canceled', terminal_code: 'superseded_threshold' },
      { threshold_days: 3, status: 'sent', terminal_code: 'accepted' },
      { threshold_days: 1, status: 'sent', terminal_code: 'accepted' },
    ]);
  });

  test('parallel workers use SKIP LOCKED and deliver one logical reminder once', async () => {
    controlledNow = new Date('2026-10-01T00:00:00.000Z');
    const trial = await seedTrial();
    controlledNow = new Date(trial.trialEnd.getTime() - 7 * DAY);
    const delivery = captureDelivery();
    const summaries = await Promise.all([
      service(delivery).runOnce({ limit: 1 }),
      service(delivery).runOnce({ limit: 1 }),
    ]);
    expect(summaries.reduce((sum, item) => sum + item.sent, 0)).toBe(1);
    expect(delivery.calls).toHaveLength(1);
    const sent = await pool.query(
      `SELECT count(*)::int AS count FROM trial_reminder_outbox
        WHERE organization_id = $1 AND threshold_days = 7 AND status = 'sent'`,
      [trial.organizationId]
    );
    expect(sent.rows[0].count).toBe(1);
  });

  test('provider failure and expired-lease crash recovery retain one stable idempotency key', async () => {
    controlledNow = new Date('2026-12-01T00:00:00.000Z');
    const trial = await seedTrial();
    controlledNow = new Date(trial.trialEnd.getTime() - 7 * DAY);
    const failing = captureDelivery({ failures: 1 });
    const first = await service(failing).runOnce({ limit: 1 });
    expect(first.retried).toBe(1);
    expect(failing.calls).toHaveLength(1);
    controlledNow = new Date(controlledNow.getTime() + 5 * 60 * 1000);
    const second = await service(failing).runOnce({ limit: 1 });
    expect(second.sent).toBe(1);
    expect(failing.calls).toHaveLength(2);
    expect(failing.calls[1].context.idempotencyKey).toBe(failing.calls[0].context.idempotencyKey);

    const crashTrial = await seedTrial({ trialStart: controlledNow });
    controlledNow = new Date(crashTrial.trialEnd.getTime() - 7 * DAY);
    const claimed = await repository().reconcileAuthorities(
      require('../../src/email/transactional').normalizeTransactionalRecipient
    ).then(() => repository().claimNext());
    expect(claimed).not.toBeNull();
    controlledNow = new Date(controlledNow.getTime() + 121000);
    const recovered = captureDelivery();
    const summary = await service(recovered).runOnce({ limit: 1 });
    expect(summary.sent).toBe(1);
    const durable = await pool.query(
      `SELECT attempt_count, status FROM trial_reminder_outbox WHERE id = $1`,
      [claimed.id]
    );
    expect(durable.rows[0]).toEqual({ attempt_count: 2, status: 'sent' });
  });

  test('destination, ownership, subscription state, and end changes cancel stale reminders', async () => {
    controlledNow = new Date('2027-01-01T00:00:00.000Z');
    const destination = await seedTrial();
    const ownership = await seedTrial();
    const state = await seedTrial();
    const period = await seedTrial();
    const normalizer = require('../../src/email/transactional').normalizeTransactionalRecipient;
    await repository().reconcileAuthorities(normalizer);

    await pool.query(
      `UPDATE notification_preferences SET notification_email = $2 WHERE organization_id = $1`,
      [destination.organizationId, 'replacement@example.test']
    );
    await pool.query(
      `UPDATE organization_memberships SET status = 'suspended' WHERE id = $1`,
      [ownership.membershipId]
    );
    await pool.query(
      `UPDATE subscriptions SET status = 'expired' WHERE id = $1`,
      [state.subscriptionId]
    );
    const shiftedStart = new Date(period.trialStart.getTime() + DAY);
    const shiftedEnd = new Date(period.trialEnd.getTime() + DAY);
    await pool.query(
      `UPDATE subscriptions
          SET trial_started_at = $2, trial_ends_at = $3
        WHERE id = $1`,
      [period.subscriptionId, shiftedStart, shiftedEnd]
    );
    await repository().reconcileAuthorities(normalizer);

    const results = await pool.query(
      `SELECT organization_id, terminal_code, count(*)::int AS count
         FROM trial_reminder_outbox
        WHERE organization_id = ANY($1::uuid[]) AND status = 'canceled'
        GROUP BY organization_id, terminal_code`,
      [[destination.organizationId, ownership.organizationId, state.organizationId, period.organizationId]]
    );
    const byOrganization = new Map(results.rows.map(item => [item.organization_id, item.terminal_code]));
    expect(byOrganization.get(destination.organizationId)).toBe('destination_changed');
    expect(byOrganization.get(ownership.organizationId)).toBe('owner_authority_invalid');
    expect(byOrganization.get(state.organizationId)).toBe('subscription_authority_changed');
    expect(byOrganization.get(period.organizationId)).toBe('subscription_authority_changed');
  });

  test('bounded retry becomes terminal before a stale delivery can cross trial expiry', async () => {
    controlledNow = new Date('2027-02-01T00:00:00.000Z');
    const trialStart = new Date(controlledNow.getTime() - 14 * DAY + 2 * 60 * 1000);
    const trial = await seedTrial({ trialStart });
    expect(trial.trialEnd.getTime() - controlledNow.getTime()).toBe(2 * 60 * 1000);
    const delivery = captureDelivery({ failures: 1 });
    const summary = await service(delivery).runOnce({ limit: 1 });
    expect(summary.failed).toBe(1);
    expect(delivery.calls).toHaveLength(1);
    const durable = await pool.query(
      `SELECT status, terminal_code, failed_at, sent_at
         FROM trial_reminder_outbox
        WHERE organization_id = $1 AND threshold_days = 1`,
      [trial.organizationId]
    );
    expect(durable.rows[0]).toEqual(expect.objectContaining({
      status: 'failed',
      terminal_code: 'resend_provider_unavailable',
      sent_at: null,
    }));
    expect(durable.rows[0].failed_at).not.toBeNull();
  });

  test('provider retries stop after exactly four stable-key claims', async () => {
    controlledNow = new Date('2027-03-01T00:00:00.000Z');
    const trial = await seedTrial();
    controlledNow = new Date(trial.trialEnd.getTime() - 7 * DAY);
    const delivery = captureDelivery({ failures: 4 });

    const expectedBackoffMinutes = [5, 10, 20];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const summary = await service(delivery).runOnce({ limit: 1 });
      if (attempt < 3) {
        expect(summary.retried).toBe(1);
        controlledNow = new Date(
          controlledNow.getTime() + expectedBackoffMinutes[attempt] * 60 * 1000
        );
      } else {
        expect(summary.failed).toBe(1);
      }
    }

    expect(delivery.calls).toHaveLength(4);
    expect(new Set(delivery.calls.map(call => call.context.idempotencyKey)).size).toBe(1);
    controlledNow = new Date(controlledNow.getTime() + 60 * 60 * 1000);
    const terminal = await service(delivery).runOnce({ limit: 1 });
    expect(terminal.claimed).toBe(0);
    expect(delivery.calls).toHaveLength(4);
    const durable = await pool.query(
      `SELECT status, attempt_count, terminal_code
         FROM trial_reminder_outbox
        WHERE organization_id = $1 AND threshold_days = 7`,
      [trial.organizationId]
    );
    expect(durable.rows[0]).toEqual({
      status: 'failed',
      attempt_count: 4,
      terminal_code: 'resend_provider_unavailable',
    });
  });

  test('destination recovery replaces only unsent future authority and reports exact transitions', async () => {
    controlledNow = new Date('2027-04-01T00:00:00.000Z');
    const trial = await seedTrial();
    const normalizer = require('../../src/email/transactional').normalizeTransactionalRecipient;
    expect(await repository().reconcileAuthorities(normalizer)).toEqual(expect.objectContaining({
      canceled: 0,
      scheduled: 3,
    }));

    const replacement = 'replacement-owner@example.test';
    await pool.query(
      `UPDATE notification_preferences SET notification_email = $2 WHERE organization_id = $1`,
      [trial.organizationId, replacement]
    );
    expect(await repository().reconcileAuthorities(normalizer)).toEqual({
      canceled: 3,
      scheduled: 3,
      transitioned: 3,
    });

    controlledNow = new Date(trial.trialEnd.getTime() - 7 * DAY);
    const delivery = captureDelivery();
    const first = await service(delivery).runOnce({ limit: 1 });
    const second = await service(delivery).runOnce({ limit: 1 });
    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(delivery.calls).toHaveLength(1);
    expect(delivery.calls[0].message.to).toBe(replacement);
    expect(delivery.calls[0].message.to).not.toBe(trial.notificationEmail);
  });

  test('transient owner and destination invalidity recover future reminders once', async () => {
    controlledNow = new Date('2027-05-01T00:00:00.000Z');
    const ownerTrial = await seedTrial();
    const destinationTrial = await seedTrial();
    const normalizer = require('../../src/email/transactional').normalizeTransactionalRecipient;
    expect(await repository().reconcileAuthorities(normalizer)).toEqual({
      canceled: 0,
      scheduled: 6,
      transitioned: 0,
    });

    await pool.query(
      `UPDATE organization_memberships SET status = 'suspended' WHERE id = $1`,
      [ownerTrial.membershipId]
    );
    await pool.query(
      `UPDATE notification_preferences SET notification_email = 'not-an-email' WHERE organization_id = $1`,
      [destinationTrial.organizationId]
    );
    expect(await repository().reconcileAuthorities(normalizer)).toEqual({
      canceled: 6,
      scheduled: 0,
      transitioned: 6,
    });

    await pool.query(
      `UPDATE organization_memberships SET status = 'active' WHERE id = $1`,
      [ownerTrial.membershipId]
    );
    await pool.query(
      `UPDATE notification_preferences SET notification_email = $2 WHERE organization_id = $1`,
      [destinationTrial.organizationId, destinationTrial.notificationEmail]
    );
    expect(await repository().reconcileAuthorities(normalizer)).toEqual({
      canceled: 0,
      scheduled: 6,
      transitioned: 0,
    });

    controlledNow = new Date(ownerTrial.trialEnd.getTime() - 7 * DAY);
    const delivery = captureDelivery();
    const summary = await service(delivery).runOnce({ limit: 10 });
    const repeated = await service(delivery).runOnce({ limit: 10 });
    expect(summary.sent).toBe(2);
    expect(repeated.sent).toBe(0);
    expect(delivery.calls.map(call => call.message.to).sort()).toEqual([
      ownerTrial.notificationEmail,
      destinationTrial.notificationEmail,
    ].sort());
    const stored = await pool.query(
      `SELECT row_to_json(reminder)::text AS body
         FROM trial_reminder_outbox reminder
        WHERE organization_id = ANY($1::uuid[])`,
      [[ownerTrial.organizationId, destinationTrial.organizationId]]
    );
    expect(stored.rows).toHaveLength(6);
    expect(stored.rows.map(item => item.body).join('\n')).not.toContain(ownerTrial.notificationEmail);
    expect(stored.rows.map(item => item.body).join('\n')).not.toContain(destinationTrial.notificationEmail);
  });

  test('sent and possibly accepted thresholds remain terminal across destination changes', async () => {
    controlledNow = new Date('2027-06-01T00:00:00.000Z');
    const sentTrial = await seedTrial();
    const normalizer = require('../../src/email/transactional').normalizeTransactionalRecipient;
    await repository().reconcileAuthorities(normalizer);
    controlledNow = new Date(sentTrial.trialEnd.getTime() - 7 * DAY);
    const sentDelivery = captureDelivery();
    expect((await service(sentDelivery).runOnce({ limit: 1 })).sent).toBe(1);
    await pool.query(
      `UPDATE notification_preferences SET notification_email = $2 WHERE organization_id = $1`,
      [sentTrial.organizationId, 'sent-replacement@example.test']
    );
    expect(await repository().reconcileAuthorities(normalizer)).toEqual({
      canceled: 2,
      scheduled: 2,
      transitioned: 2,
    });
    expect((await service(sentDelivery).runOnce({ limit: 1 })).claimed).toBe(0);
    expect(sentDelivery.calls).toHaveLength(1);
    const sentEvidence = await pool.query(
      `SELECT id, status, attempt_count, recipient_sha256
         FROM trial_reminder_outbox
        WHERE organization_id = $1 AND threshold_days = 7`,
      [sentTrial.organizationId]
    );
    expect(sentEvidence.rows).toEqual([expect.objectContaining({
      status: 'sent',
      attempt_count: 1,
      recipient_sha256: require('../../src/accounts/trialReminderRepository')
        .recipientHash(sentTrial.notificationEmail),
    })]);

    controlledNow = new Date('2027-07-01T00:00:00.000Z');
    const possibleTrial = await seedTrial();
    await repository().reconcileAuthorities(normalizer);
    controlledNow = new Date(possibleTrial.trialEnd.getTime() - 7 * DAY);
    const possible = await repository().claimNext();
    expect(possible).toEqual(expect.objectContaining({ attempt_count: 1, status: 'leased' }));
    await pool.query(
      `UPDATE notification_preferences SET notification_email = $2 WHERE organization_id = $1`,
      [possibleTrial.organizationId, 'possible-replacement@example.test']
    );
    expect(await repository().reconcileAuthorities(normalizer)).toEqual({
      canceled: 2,
      scheduled: 2,
      transitioned: 2,
    });
    controlledNow = new Date(controlledNow.getTime() + 121000);
    expect(await repository().reconcileAuthorities(normalizer)).toEqual({
      canceled: 1,
      scheduled: 0,
      transitioned: 1,
    });
    expect(await repository().claimNext()).toBeNull();
    const possibleEvidence = await pool.query(
      `SELECT id, status, attempt_count, terminal_code, recipient_sha256
         FROM trial_reminder_outbox
        WHERE organization_id = $1 AND threshold_days = 7`,
      [possibleTrial.organizationId]
    );
    expect(possibleEvidence.rows).toEqual([{
      id: possible.id,
      status: 'canceled',
      attempt_count: 1,
      terminal_code: 'destination_changed',
      recipient_sha256: require('../../src/accounts/trialReminderRepository')
        .recipientHash(possibleTrial.notificationEmail),
    }]);
  });

  test('concurrent recovery creates one live generation and one current-authority delivery', async () => {
    controlledNow = new Date('2027-08-01T00:00:00.000Z');
    const trial = await seedTrial();
    const normalizer = require('../../src/email/transactional').normalizeTransactionalRecipient;
    await repository().reconcileAuthorities(normalizer);
    const replacement = 'parallel-replacement@example.test';
    await pool.query(
      `UPDATE notification_preferences SET notification_email = $2 WHERE organization_id = $1`,
      [trial.organizationId, replacement]
    );
    const reconciliations = await Promise.all([
      repository().reconcileAuthorities(normalizer),
      repository().reconcileAuthorities(normalizer),
      repository().reconcileAuthorities(normalizer),
      repository().reconcileAuthorities(normalizer),
    ]);
    expect(reconciliations.reduce((sum, item) => sum + item.transitioned, 0)).toBe(3);
    expect(reconciliations.reduce((sum, item) => sum + item.scheduled, 0)).toBe(3);

    controlledNow = new Date(trial.trialEnd.getTime() - 7 * DAY);
    const delivery = captureDelivery();
    const workers = await Promise.all(Array.from({ length: 4 }, () => (
      service(delivery).runOnce({ limit: 1 })
    )));
    expect(workers.reduce((sum, item) => sum + item.sent, 0)).toBe(1);
    expect(delivery.calls).toHaveLength(1);
    expect(delivery.calls[0].message.to).toBe(replacement);
    const generations = await pool.query(
      `SELECT threshold_days,
              count(*)::int AS generations,
              count(*) FILTER (WHERE status IN ('pending', 'leased', 'sent'))::int AS live,
              count(*) FILTER (WHERE status = 'sent')::int AS sent
         FROM trial_reminder_outbox
        WHERE organization_id = $1
        GROUP BY threshold_days
        ORDER BY threshold_days DESC`,
      [trial.organizationId]
    );
    expect(generations.rows).toEqual([
      { threshold_days: 7, generations: 2, live: 1, sent: 1 },
      { threshold_days: 3, generations: 2, live: 1, sent: 0 },
      { threshold_days: 1, generations: 2, live: 1, sent: 0 },
    ]);
  });
});
