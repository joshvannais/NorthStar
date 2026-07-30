'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { Client, Pool } = require('pg');
const { runMigrations, stripOuterTransaction } = require('../../src/db');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS_DIRECTORY = path.join(ROOT, 'migrations');
const MIGRATION_WORKER = path.join(ROOT, 'tests', 'helpers', 'account-migration-worker.js');
const MIGRATION_010 = '010_account_session_authority.sql';
const LEGACY_HASHES = Object.freeze({
  '001_initial_schema.sql': 'dbbcad4947474777a61a3b230aa8aca54b9a3ef4257301368e39731fa05307e9',
  '002_seed_data.sql': '4b124ac5713caaddc4f2316e8c055c6235eb17881c5b4ba5d0edef481a8a63ff',
  '003_voice_sessions.sql': 'd37d402df2792a015b6d1f9d3e0f72226298f9a4d9ec7551f629e52c677f41c2',
  '004_canonical_persistence_v2.sql': '946b1819dd4c5205637e9fae91f3b36c28c1688e401f1f2f5b67ffba7d2e1651',
  '005_canonical_organization_authority.sql': '4065d873dd204935cfbd8ea8abe45d2b0b44e80df38ef203359d2863d37c5379',
  '006_canonical_voice_sessions.sql': '236809d3b87367804bbd6c28ccaaca27408fa340020ab3d3b48e3e81da203ec2',
  '007_canonical_tax_authority.sql': 'a5f2c8c78fc339790f2993c997ea2cd50134a9ed97de93267cd470b18ea408a6',
  '008_canonical_demo_authority.sql': 'c157ac2c10f07bf933b4774ac14584ecc580f93108926b5e53acbfed28263ef2',
  '009_canonical_voice_provider_identity.sql': '6ec531dbb385607818c4a70ae69bab7f5d85ff98565d61ad8026c20ef68634fe',
});

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function waitForMessage(child, expectedType, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`migration worker timed out waiting for ${expectedType}`)), timeoutMs);
    function finish(error, value) {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error); else resolve(value);
    }
    function onMessage(message) {
      if (message && message.type === expectedType) finish(null, message);
      else if (message && message.type === 'error') finish(new Error(message.code));
    }
    function onExit(code) {
      finish(new Error(`migration worker exited before ${expectedType}: ${code}`));
    }
    child.on('message', onMessage);
    child.on('exit', onExit);
  });
}

function startMigrationWorker(connectionString, applicationName) {
  const child = fork(MIGRATION_WORKER, [], {
    cwd: ROOT,
    env: {
      ...process.env,
      M19_MIGRATION_DATABASE_URL: connectionString,
      M19_MIGRATION_APPLICATION_NAME: applicationName,
    },
    silent: true,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForExit(child, timeoutMs = 15000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('migration worker did not exit'));
    }, timeoutMs);
    function onExit() {
      clearTimeout(timeout);
      resolve();
    }
    child.once('exit', onExit);
  });
}

async function poll(probe, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function runProductionMigrations(connectionString, migrationsDirectory = MIGRATIONS_DIRECTORY) {
  const pool = new Pool({ connectionString, max: 2 });
  try {
    return await runMigrations({ pool, migrationsDirectory });
  } finally {
    await pool.end();
  }
}

async function queryWithClient(connectionString, work) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function schemaSnapshot(connectionString) {
  return queryWithClient(connectionString, async client => {
    const columns = await client.query(
      `SELECT table_name, ordinal_position, column_name, data_type, udt_name, is_nullable,
              COALESCE(column_default, '') AS column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name <> '_migrations'
        ORDER BY table_name, ordinal_position`
    );
    const constraints = await client.query(
      `SELECT conrelid::regclass::text AS table_name, conname, contype,
              pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace
          AND conrelid <> 'public._migrations'::regclass
        ORDER BY table_name, conname`
    );
    const indexes = await client.query(
      `SELECT tablename, indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'public' AND tablename <> '_migrations'
        ORDER BY tablename, indexname`
    );
    const triggers = await client.query(
      `SELECT event_object_table AS table_name, trigger_name, action_timing,
              event_manipulation, action_statement
         FROM information_schema.triggers
        WHERE trigger_schema = 'public'
        ORDER BY table_name, trigger_name, event_manipulation`
    );
    const functions = await client.query(
      `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
              pg_get_functiondef(p.oid) AS definition
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f'
        ORDER BY p.proname, arguments`
    );
    return {
      columns: columns.rows,
      constraints: constraints.rows,
      functions: functions.rows,
      indexes: indexes.rows,
      triggers: triggers.rows,
    };
  });
}

async function assertMigration010Absent(connectionString) {
  await queryWithClient(connectionString, async client => {
    const state = await client.query(
      `SELECT
         to_regclass('public.organization_memberships') AS memberships,
         to_regclass('public.auth_sessions') AS sessions,
         (SELECT count(*)::int FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email_normalized') AS normalized_column,
         (SELECT count(*)::int FROM _migrations WHERE filename = $1) AS ledger_rows`,
      [MIGRATION_010]
    );
    expect(state.rows[0]).toEqual({
      ledger_rows: 0,
      memberships: null,
      normalized_column: 0,
      sessions: null,
    });
  });
}

describe('production account migration authority on required PostgreSQL 18', () => {
  const allocations = [];
  const children = new Set();
  let legacyDirectory;

  beforeAll(() => {
    if (!process.env.M19_PG_ADMIN_URL || !process.env.M19_EXPECTED_PG_DATA_DIR ||
        !process.env.M19_EXPECTED_PG_PORT || !process.env.M19_TEST_RUN_ID) {
      throw new Error('Required disposable PostgreSQL 18 identity is missing');
    }
    legacyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-migrations-001-009-'));
    for (const file of Object.keys(LEGACY_HASHES)) {
      fs.copyFileSync(path.join(MIGRATIONS_DIRECTORY, file), path.join(legacyDirectory, file));
    }
  });

  afterAll(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await waitForExit(child).catch(() => {});
    }
    for (const allocation of allocations) await allocation.cleanup();
    if (legacyDirectory) fs.rmSync(legacyDirectory, { recursive: true, force: true });
  }, 120000);

  async function database(name) {
    const allocation = await createSuiteDatabase(name);
    allocations.push(allocation);
    return allocation;
  }

  async function applyLegacyMigrations(connectionString) {
    await runProductionMigrations(connectionString, legacyDirectory);
  }

  test('real lexer handles exact legacy envelopes and protected migrations 001-009 remain byte-identical', () => {
    for (const [file, expected] of Object.entries(LEGACY_HASHES)) {
      const contents = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, file));
      expect(sha256(contents)).toBe(expected);
      const prepared = stripOuterTransaction(contents.toString('utf8'));
      expect(prepared.hadOuterTransaction).toBe(true);
      expect(prepared.sql).not.toMatch(/^\s*BEGIN\s*;/i);
      expect(prepared.sql).not.toMatch(/COMMIT\s*;\s*$/i);
    }
    expect(stripOuterTransaction(fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, MIGRATION_010), 'utf8')).hadOuterTransaction).toBe(false);

    const variant = '\uFEFF\n-- leading line comment\n/* leading /* nested */ block */\nBEGIN -- owner\n;\n' +
      'DO $body$ BEGIN PERFORM 1; END; $body$;\nSELECT \'COMMIT; -- data\';\n' +
      'COMMIT /* trailing block */;\n-- trailing line comment\n';
    const parsed = stripOuterTransaction(variant);
    expect(parsed.hadOuterTransaction).toBe(true);
    expect(parsed.sql).toContain('DO $body$ BEGIN PERFORM 1; END; $body$;');
    expect(parsed.sql).toContain('-- trailing line comment');
    expect(() => stripOuterTransaction('BEGIN; SELECT 1;')).toThrow('incomplete outer transaction envelope');
    expect(() => stripOuterTransaction('SELECT 1; COMMIT;')).toThrow('incomplete outer transaction envelope');
    expect(() => stripOuterTransaction('SELECT 1; BEGIN; SELECT 2;')).toThrow('top-level transaction control');
  });

  test('fresh and legacy-ledger upgrade paths use the real runner, preserve data, and converge', async () => {
    const fresh = await database('migration-fresh');
    const upgrade = await database('migration-upgrade');
    await runProductionMigrations(fresh.connectionString);
    await applyLegacyMigrations(upgrade.connectionString);

    const organizationId = '72000000-0000-0000-0000-000000000001';
    const userId = '72000000-0000-0000-0000-000000000002';
    const leadId = '72000000-0000-0000-0000-000000000003';
    await queryWithClient(upgrade.connectionString, async client => {
      await client.query(
        `INSERT INTO organizations (id, name, owner_name, email, phone)
         VALUES ($1, 'Preserved Company', 'Preserved Owner', 'preserved-company@example.test', '+18605550111')`,
        [organizationId]
      );
      await client.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, phone, role, status)
         VALUES ($1, $2, 'Preserved Owner', 'preserved-owner@example.test', 'unchanged-hash', '+18605550112', 'owner', 'active')`,
        [userId, organizationId]
      );
      await client.query(
        `INSERT INTO leads (id, organization_id, caller_name, phone, service_type, notes)
         VALUES ($1, $2, 'Preserved Lead', '+18605550113', 'roofing', 'unchanged note')`,
        [leadId, organizationId]
      );
      await client.query(
        `INSERT INTO notification_preferences (
           organization_id, email_new_lead, email_call_summary,
           email_appointment, sms_new_lead, sms_urgent,
           notification_email, notification_phone
         ) VALUES ($1, TRUE, NULL, TRUE, TRUE, NULL, $2, $3)`,
        [organizationId, 'legacy-alerts@example.test', '+18605550114']
      );
      await client.query(`
        CREATE TABLE organization_account_preferences (
          organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
          preferences JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT organization_account_preferences_object_check
            CHECK (jsonb_typeof(preferences) = 'object')
        )
      `);
      await client.query(
        `INSERT INTO organization_account_preferences (organization_id, preferences)
         VALUES ($1, $2::jsonb)`,
        [organizationId, JSON.stringify({
          theme: 'dark',
          density: 'compact',
          emailEnabled: true,
          notifications: { smsUrgent: true },
        })]
      );
      await client.query('ALTER TABLE _migrations DROP COLUMN checksum');
    });

    await runProductionMigrations(upgrade.connectionString);
    expect(await schemaSnapshot(upgrade.connectionString)).toEqual(await schemaSnapshot(fresh.connectionString));
    await queryWithClient(upgrade.connectionString, async client => {
      const preserved = await client.query(
        `SELECT u.name, u.email, u.password_hash, u.phone, l.caller_name, l.service_type, l.notes
           FROM users u JOIN leads l ON l.organization_id = u.organization_id
          WHERE u.id = $1 AND l.id = $2`,
        [userId, leadId]
      );
      expect(preserved.rows).toEqual([{
        caller_name: 'Preserved Lead',
        email: 'preserved-owner@example.test',
        name: 'Preserved Owner',
        notes: 'unchanged note',
        password_hash: 'unchanged-hash',
        phone: '+18605550112',
        service_type: 'roofing',
      }]);
      const notification = await client.query(
        `SELECT email_new_lead, email_call_summary, email_appointment,
                sms_new_lead, sms_urgent, notification_email, notification_phone
           FROM notification_preferences
          WHERE organization_id = $1`,
        [organizationId]
      );
      expect(notification.rows).toEqual([{
        email_new_lead: false,
        email_call_summary: false,
        email_appointment: false,
        sms_new_lead: false,
        sms_urgent: false,
        notification_email: 'legacy-alerts@example.test',
        notification_phone: '+18605550114',
      }]);
      const generic = await client.query(
        'SELECT preferences FROM organization_account_preferences WHERE organization_id = $1',
        [organizationId]
      );
      expect(generic.rows).toEqual([{ preferences: { theme: 'dark', density: 'compact' } }]);
      await expect(client.query(
        `UPDATE organization_account_preferences
            SET preferences = preferences || '{"smsEnabled":true}'::jsonb
          WHERE organization_id = $1`,
        [organizationId]
      )).rejects.toMatchObject({ code: '23514' });

      const defaultOrganizationId = '72000000-0000-0000-0000-000000000004';
      await client.query(
        `INSERT INTO organizations (id, name, owner_name, email, phone)
         VALUES ($1, 'Default Preference Company', 'Default Owner',
                 'default-preference@example.test', '+18605550115')`,
        [defaultOrganizationId]
      );
      await client.query(
        'INSERT INTO notification_preferences (organization_id) VALUES ($1)',
        [defaultOrganizationId]
      );
      const defaults = await client.query(
        `SELECT email_new_lead, email_call_summary, email_appointment,
                sms_new_lead, sms_urgent, notification_email, notification_phone
           FROM notification_preferences
          WHERE organization_id = $1`,
        [defaultOrganizationId]
      );
      expect(defaults.rows).toEqual([{
        email_new_lead: false,
        email_call_summary: false,
        email_appointment: false,
        sms_new_lead: false,
        sms_urgent: false,
        notification_email: '',
        notification_phone: '',
      }]);
      const ledger = await client.query('SELECT filename, checksum FROM _migrations ORDER BY filename');
      expect(ledger.rows).toHaveLength(10);
      expect(ledger.rows.every(row => /^[0-9a-f]{64}$/.test(String(row.checksum).trim()))).toBe(true);
    });
  }, 120000);

  test('ledger checksums and uniqueness are durable and a mismatched applied checksum fails closed', async () => {
    const allocation = await database('migration-ledger');
    await runProductionMigrations(allocation.connectionString);
    const before = await queryWithClient(allocation.connectionString, client =>
      client.query('SELECT id, filename, checksum, applied_at FROM _migrations ORDER BY filename').then(result => result.rows)
    );
    expect(before).toHaveLength(10);
    for (const row of before) {
      expect(String(row.checksum).trim()).toBe(sha256(fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, row.filename))));
    }

    await runProductionMigrations(allocation.connectionString);
    const after = await queryWithClient(allocation.connectionString, client =>
      client.query('SELECT id, filename, checksum, applied_at FROM _migrations ORDER BY filename').then(result => result.rows)
    );
    expect(after).toEqual(before);

    await queryWithClient(allocation.connectionString, async client => {
      await expect(client.query(
        'INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)',
        [MIGRATION_010, '0'.repeat(64)]
      )).rejects.toMatchObject({ code: '23505' });
      await client.query('UPDATE _migrations SET checksum = $2 WHERE filename = $1', [MIGRATION_010, '0'.repeat(64)]);
    });
    await expect(runProductionMigrations(allocation.connectionString)).rejects.toThrow('checksum mismatch');
  }, 60000);

  test('ledger insertion failure rolls migration 010 schema back and a fault-free retry commits exactly once', async () => {
    const allocation = await database('migration-ledger-fault');
    await applyLegacyMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, client => client.query(`
      CREATE FUNCTION reject_account_migration_ledger() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.filename = '${MIGRATION_010}' THEN
          RAISE EXCEPTION 'injected migration ledger rejection';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_account_migration_ledger_trigger
        BEFORE INSERT ON _migrations
        FOR EACH ROW EXECUTE FUNCTION reject_account_migration_ledger();
    `));

    await expect(runProductionMigrations(allocation.connectionString)).rejects.toThrow('injected migration ledger rejection');
    await assertMigration010Absent(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      expect((await client.query('SELECT count(*)::int AS count FROM _migrations')).rows[0].count).toBe(9);
      await client.query('DROP TRIGGER reject_account_migration_ledger_trigger ON _migrations');
      await client.query('DROP FUNCTION reject_account_migration_ledger()');
    });

    await runProductionMigrations(allocation.connectionString);
    await runProductionMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      expect((await client.query('SELECT count(*)::int AS count FROM _migrations WHERE filename = $1', [MIGRATION_010])).rows[0].count).toBe(1);
      expect((await client.query("SELECT to_regclass('public.auth_sessions') AS table_name")).rows[0].table_name).toBe('auth_sessions');
    });
  }, 120000);

  test('two independent migration processes serialize on the advisory transaction lock', async () => {
    const allocation = await database('migration-concurrency');
    await applyLegacyMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, client => client.query(`
      CREATE FUNCTION delay_account_migration_ledger() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.filename = '${MIGRATION_010}' THEN PERFORM pg_sleep(5); END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER delay_account_migration_ledger_trigger
        BEFORE INSERT ON _migrations
        FOR EACH ROW EXECUTE FUNCTION delay_account_migration_ledger();
    `));

    const names = [`migration-concurrent-a-${process.pid}`, `migration-concurrent-b-${process.pid}`];
    const workers = names.map(name => startMigrationWorker(allocation.connectionString, name));
    workers.forEach(child => children.add(child));
    await Promise.all(workers.map(child => waitForMessage(child, 'ready')));
    const results = workers.map(child => waitForMessage(child, 'result', 30000));
    workers.forEach(child => child.send({ type: 'run' }));

    const locks = await queryWithClient(allocation.connectionString, client => poll(async () => {
      const result = await client.query(
        `SELECT a.application_name, l.granted
           FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE l.locktype = 'advisory' AND a.application_name = ANY($1::text[])
          ORDER BY a.application_name, l.granted`,
        [names]
      );
      return result.rows.some(row => row.granted === true) && result.rows.some(row => row.granted === false)
        ? result.rows : null;
    }, 'one granted and one waiting migration advisory lock'));
    expect(locks.filter(row => row.granted)).toHaveLength(1);
    expect(locks.filter(row => !row.granted)).toHaveLength(1);
    expect((await Promise.all(results)).map(result => result.outcome)).toEqual(['migrated', 'migrated']);
    await Promise.all(workers.map(child => waitForExit(child)));
    await queryWithClient(allocation.connectionString, async client => {
      expect((await client.query('SELECT count(*)::int AS count FROM _migrations WHERE filename = $1', [MIGRATION_010])).rows[0].count).toBe(1);
      await client.query('DROP TRIGGER delay_account_migration_ledger_trigger ON _migrations');
      await client.query('DROP FUNCTION delay_account_migration_ledger()');
    });
  }, 120000);

  test('terminating the owned migration backend before commit leaves neither schema nor ledger success', async () => {
    const allocation = await database('migration-process-death');
    await applyLegacyMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, client => client.query(`
      CREATE FUNCTION stall_account_migration_ledger() RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.filename = '${MIGRATION_010}' THEN PERFORM pg_sleep(30); END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER stall_account_migration_ledger_trigger
        BEFORE INSERT ON _migrations
        FOR EACH ROW EXECUTE FUNCTION stall_account_migration_ledger();
    `));

    const applicationName = `migration-terminated-${process.pid}`;
    const child = startMigrationWorker(allocation.connectionString, applicationName);
    children.add(child);
    await waitForMessage(child, 'ready');
    child.send({ type: 'run' });
    const activeBackend = await queryWithClient(allocation.connectionString, client => poll(async () => {
      const active = await client.query(
        `SELECT pid, application_name FROM pg_stat_activity
          WHERE application_name = $1 AND state = 'active'
            AND query LIKE 'INSERT INTO _migrations%' AND wait_event = 'PgSleep'`,
        [applicationName]
      );
      return active.rows[0] || null;
    }, 'migration ledger insert before backend termination'));
    expect(activeBackend.application_name).toBe(applicationName);
    await queryWithClient(allocation.connectionString, async client => {
      const ownership = await client.query(
        'SELECT application_name FROM pg_stat_activity WHERE pid = $1',
        [activeBackend.pid]
      );
      expect(ownership.rows).toEqual([{ application_name: applicationName }]);
      const terminated = await client.query('SELECT pg_terminate_backend($1) AS terminated', [activeBackend.pid]);
      expect(terminated.rows[0].terminated).toBe(true);
    });
    await waitForExit(child);
    await queryWithClient(allocation.connectionString, client => poll(async () => {
      const active = await client.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name = $1', [applicationName]);
      return active.rows[0].count === 0;
    }, 'terminated migration backend rollback'));
    await assertMigration010Absent(allocation.connectionString);

    await queryWithClient(allocation.connectionString, async client => {
      await client.query('DROP TRIGGER stall_account_migration_ledger_trigger ON _migrations');
      await client.query('DROP FUNCTION stall_account_migration_ledger()');
    });
    await runProductionMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      expect((await client.query('SELECT count(*)::int AS count FROM _migrations WHERE filename = $1', [MIGRATION_010])).rows[0].count).toBe(1);
    });
  }, 120000);

  test.each([
    ['blank identity', async (client, organizationId) => {
      await client.query(
        "INSERT INTO users (organization_id, name, email, password_hash, role, status) VALUES ($1, 'Blank', '', 'unused', 'owner', 'active')",
        [organizationId]
      );
    }, 'invalid normalized length'],
    ['duplicate normalized identity', async (client, organizationId) => {
      await client.query(
        `INSERT INTO users (organization_id, name, email, password_hash, role, status) VALUES
         ($1, 'First', 'Duplicate@Example.Test', 'unused', 'owner', 'active'),
         ($1, 'Second', 'duplicate@example.test', 'unused', 'member', 'active')`,
        [organizationId]
      );
    }, 'email normalization collision'],
  ])('%s aborts through the real runner without partial migration state', async (_name, arrange, diagnostic) => {
    const allocation = await database(`migration-${_name}`);
    await applyLegacyMigrations(allocation.connectionString);
    await queryWithClient(allocation.connectionString, async client => {
      const organizationId = crypto.randomUUID();
      await client.query(
        "INSERT INTO organizations (id, name, email) VALUES ($1, 'Invalid Identity Org', $2)",
        [organizationId, `${organizationId}@example.test`]
      );
      await arrange(client, organizationId);
    });
    await expect(runProductionMigrations(allocation.connectionString)).rejects.toThrow(diagnostic);
    await assertMigration010Absent(allocation.connectionString);
  }, 120000);
});
