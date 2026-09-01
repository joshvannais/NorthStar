'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const {
  RESERVED_COST_NANO_USD,
  createProviderUsageLedger,
} = require('../../src/polaris/providerLedger');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const P6_MIGRATION = '037_polaris_provider_usage_authority.sql';
const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function roleConnectionString(connectionString, role) {
  const parsed = new URL(connectionString);
  parsed.username = role;
  parsed.password = '';
  return parsed.toString();
}

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
}

function copyMigrations(maximum) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-p6-ledger-'));
  for (const name of migrationFiles().filter(value => value <= maximum)) {
    fs.copyFileSync(path.join(MIGRATIONS, name), path.join(directory, name));
  }
  return directory;
}

async function provisionSeparatedRoles(database) {
  const suffix = `${process.pid}_${crypto.randomBytes(5).toString('hex')}`;
  const migrationRole = `northstar-p6-migration-${suffix}`.slice(0, 63);
  const runtimeRole = `northstar-p6-runtime-${suffix}`.slice(0, 63);
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${quoteIdentifier(migrationRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`ALTER DATABASE ${quoteIdentifier(database.databaseName)} OWNER TO ${quoteIdentifier(migrationRole)}`);
  } finally {
    await admin.end();
  }
  return {
    migrationRole,
    runtimeRole,
    migrationUrl: roleConnectionString(database.connectionString, migrationRole),
    runtimeUrl: roleConnectionString(database.connectionString, runtimeRole),
  };
}

async function dropSeparatedRoles(roles) {
  if (!roles) return;
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP ROLE ${quoteIdentifier(roles.runtimeRole)}`);
    await admin.query(`DROP ROLE ${quoteIdentifier(roles.migrationRole)}`);
  } finally {
    await admin.end();
  }
}

async function seedTenant(pool, organizationId, users, label) {
  await pool.query(
    `INSERT INTO organizations(id,name,email) VALUES($1,$2,$3)`,
    [organizationId, `P6 ${label}`, `p6-${label}@example.test`]
  );
  for (const [index, userId] of users.entries()) {
    const role = index === 0 ? 'owner' : 'member';
    await pool.query(
      `INSERT INTO users(id,organization_id,name,email,password_hash,role,status)
       VALUES($1,$2,$3,$4,'not-used',$5,'active')`,
      [userId, organizationId, `P6 user ${index}`, `p6-${label}-${index}@example.test`, role]
    );
    await pool.query(
      `INSERT INTO organization_memberships(id,organization_id,user_id,role,status)
       VALUES($1,$2,$1,$3,'active')`,
      [userId, organizationId, role]
    );
  }
  await pool.query(
    `INSERT INTO subscriptions(organization_id,plan_type,status,trial_ends_at)
     VALUES($1,'Complete','active',NULL)`,
    [organizationId]
  );
}

function requestInput(organizationId, userId, requestId = crypto.randomUUID()) {
  return {
    organizationId,
    userId,
    requestId,
    model: 'gpt-5.6-luna',
    schemaVersion: 'northstar.polaris.assistant-response.v1',
  };
}

function completedUsage(overrides = {}) {
  return Object.assign({
    inputTokens: 120,
    outputTokens: 80,
    costNanoUsd: 120000,
    latencyMs: 25,
    attemptCount: 1,
    outcomeClass: 'completed',
    providerRequestId: 'resp_p6_loopback_only',
  }, overrides);
}

realPostgres('Pre-Mission-23 P6 durable Polaris provider authority', () => {
  const ORG_A = 'c1000000-0000-4000-8000-000000000001';
  const ORG_B = 'c1000000-0000-4000-8000-000000000002';
  const USERS_A = [
    'c2000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000002',
    'c2000000-0000-4000-8000-000000000003',
    'c2000000-0000-4000-8000-000000000004',
    'c2000000-0000-4000-8000-000000000005',
  ];
  const USERS_B = ['c2000000-0000-4000-8000-000000000011'];
  let freshDatabase;
  let upgradeDatabase;
  let separatedDatabase;
  let freshPool;
  let upgradePool;
  let migrationPool;
  let runtimePool;
  let roles;
  let preP6Directory;
  let throughP6Directory;
  let db;

  beforeAll(async () => {
    preP6Directory = copyMigrations('036_support_case_authority.sql');
    throughP6Directory = copyMigrations(P6_MIGRATION);
    freshDatabase = await createSuiteDatabase('p6-ledger-fresh');
    upgradeDatabase = await createSuiteDatabase('p6-ledger-upgrade');
    separatedDatabase = await createSuiteDatabase('p6-ledger-separated');
    freshPool = new Pool({ connectionString: freshDatabase.connectionString, max: 3 });
    upgradePool = new Pool({ connectionString: upgradeDatabase.connectionString, max: 3 });
    roles = await provisionSeparatedRoles(separatedDatabase);
    migrationPool = new Pool({ connectionString: roles.migrationUrl, max: 3 });
    runtimePool = new Pool({ connectionString: roles.runtimeUrl, max: 8 });
    jest.resetModules();
    db = require('../../src/db');

    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: preP6Directory })).toBe(true);
    await seedTenant(upgradePool, ORG_A, USERS_A, 'upgrade-a');
    expect(await db.runMigrations({ pool: upgradePool, migrationsDirectory: throughP6Directory })).toBe(true);
    expect(await db.runMigrations({ pool: freshPool, migrationsDirectory: throughP6Directory })).toBe(true);
    expect(await db.runMigrations({
      pool: migrationPool,
      runtimePool,
      migrationsDirectory: throughP6Directory,
    })).toBe(true);
    await seedTenant(runtimePool, ORG_A, USERS_A, 'separated-a');
    await seedTenant(runtimePool, ORG_B, USERS_B, 'separated-b');
    await migrationPool.query(
      `INSERT INTO public.polaris_provider_monthly_usage(
         organization_id,month_start,collected_subscription_revenue_cents
       ) VALUES($1,date_trunc('month',clock_timestamp())::date,10000),
               ($2,date_trunc('month',clock_timestamp())::date,0)
       ON CONFLICT (organization_id,month_start) DO UPDATE
         SET collected_subscription_revenue_cents=EXCLUDED.collected_subscription_revenue_cents`,
      [ORG_A, ORG_B]
    );
  }, 120000);

  afterAll(async () => {
    try {
      if (runtimePool) await runtimePool.end();
      if (migrationPool) await migrationPool.end();
      if (freshPool) await freshPool.end();
      if (upgradePool) await upgradePool.end();
    } finally {
      for (const directory of [preP6Directory, throughP6Directory]) {
        if (directory && path.resolve(directory).startsWith(path.resolve(os.tmpdir()))) {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      }
      if (freshDatabase) await freshDatabase.cleanup();
      if (upgradeDatabase) await upgradeDatabase.cleanup();
      if (separatedDatabase) await separatedDatabase.cleanup();
      await dropSeparatedRoles(roles);
    }
  }, 90000);

  test('fresh and upgrade paths apply exact migration checksums and leave no invalid constraints', async () => {
    for (const pool of [freshPool, upgradePool, migrationPool]) {
      const ledger = await pool.query(
        `SELECT checksum FROM public._migrations WHERE filename=$1`,
        [P6_MIGRATION]
      );
      expect(ledger.rows).toHaveLength(1);
      expect(String(ledger.rows[0].checksum).trim()).toMatch(/^[0-9a-f]{64}$/);
      const invalid = await pool.query(
        `SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated`
      );
      expect(invalid.rows).toEqual([]);
    }
    expect((await upgradePool.query(
      `SELECT plan_type,status FROM subscriptions WHERE organization_id=$1`, [ORG_A]
    )).rows[0]).toEqual({ plan_type: 'Complete', status: 'active' });
  });

  test('runtime has only the three guarded functions and no direct provider-ledger access', async () => {
    const privileges = (await migrationPool.query(
      `SELECT
         has_table_privilege($1,'public.polaris_provider_requests','SELECT') AS request_select,
         has_table_privilege($1,'public.polaris_provider_requests','INSERT') AS request_insert,
         has_table_privilege($1,'public.polaris_provider_monthly_usage','UPDATE') AS monthly_update,
         has_table_privilege($1,'public.polaris_provider_security_events','SELECT') AS security_select,
         has_function_privilege($1,'public.polaris_provider_reserve_usage(uuid,uuid,uuid,text,text,bigint)','EXECUTE') AS reserve_execute,
         has_function_privilege($1,'public.polaris_provider_reconcile_usage(uuid,uuid,uuid,bigint,integer,integer,smallint,text,text)','EXECUTE') AS reconcile_execute,
         has_function_privilege($1,'public.polaris_provider_usage_policy_status(uuid,uuid)','EXECUTE') AS policy_status_execute`,
      [roles.runtimeRole]
    )).rows[0];
    expect(privileges).toEqual({
      request_select: false,
      request_insert: false,
      monthly_update: false,
      security_select: false,
      reserve_execute: true,
      reconcile_execute: true,
      policy_status_execute: true,
    });
    await expect(runtimePool.query('SELECT * FROM public.polaris_provider_requests')).rejects.toMatchObject({ code: '42501' });
  });

  test('reports durable tenant-isolated target, warning, hard-stop, and recovery states only to plan managers', async () => {
    const ledger = createProviderUsageLedger({ poolProvider: () => runtimePool });
    const original = (await migrationPool.query(
      `SELECT collected_subscription_revenue_cents,reserved_cost_nano_usd,reconciled_cost_nano_usd
         FROM public.polaris_provider_monthly_usage
        WHERE organization_id=$1 AND month_start=date_trunc('month',clock_timestamp())::date`,
      [ORG_A]
    )).rows[0];
    const setSpend = async function (spend) {
      await migrationPool.query(
        `UPDATE public.polaris_provider_monthly_usage
            SET collected_subscription_revenue_cents=10000,
                reserved_cost_nano_usd=0,
                reconciled_cost_nano_usd=$2,
                updated_at=transaction_timestamp()
          WHERE organization_id=$1 AND month_start=date_trunc('month',clock_timestamp())::date`,
        [ORG_A, spend]
      );
    };
    try {
      for (const [spend, state] of [
        ['4999999999', 'within_target'],
        ['5000000000', 'target'],
        ['10000000000', 'warning'],
        ['20000000000', 'limit'],
        ['4999999999', 'within_target'],
      ]) {
        await setSpend(spend);
        await expect(ledger.status({ organizationId: ORG_A, userId: USERS_A[0] }))
          .resolves.toEqual({ state });
      }
      await expect(ledger.status({ organizationId: ORG_A, userId: USERS_A[1] }))
        .rejects.toMatchObject({ code: 'POLARIS_CONVERSATION_UNAVAILABLE', statusCode: 403 });
      await expect(ledger.status({ organizationId: ORG_B, userId: USERS_A[0] }))
        .rejects.toMatchObject({ code: 'POLARIS_CONVERSATION_UNAVAILABLE', statusCode: 403 });
    } finally {
      await migrationPool.query(
        `UPDATE public.polaris_provider_monthly_usage
            SET collected_subscription_revenue_cents=$2,
                reserved_cost_nano_usd=$3,
                reconciled_cost_nano_usd=$4,
                updated_at=transaction_timestamp()
          WHERE organization_id=$1 AND month_start=date_trunc('month',clock_timestamp())::date`,
        [ORG_A, original.collected_subscription_revenue_cents,
          original.reserved_cost_nano_usd, original.reconciled_cost_nano_usd]
      );
    }
  });

  test('reserves atomically, reconciles actual usage, and persists content-free bounded metadata', async () => {
    const ledger = createProviderUsageLedger({ poolProvider: () => runtimePool });
    const requestId = crypto.randomUUID();
    const reservation = await ledger.reserve(requestInput(ORG_A, USERS_A[0], requestId));
    expect(reservation).toMatchObject({
      organizationId: ORG_A,
      userId: USERS_A[0],
      requestId,
      reservedCostNanoUsd: RESERVED_COST_NANO_USD,
      usagePolicyState: 'within_target',
    });
    await expect(ledger.reconcile(reservation, completedUsage())).resolves.toBe(true);
    const row = (await migrationPool.query(
      `SELECT state,reserved_cost_nano_usd,actual_cost_nano_usd,input_tokens,output_tokens,
              attempt_count,outcome_class,provider_request_id
         FROM public.polaris_provider_requests WHERE id=$1`,
      [reservation.id]
    )).rows[0];
    expect(row).toEqual({
      state: 'completed',
      reserved_cost_nano_usd: String(RESERVED_COST_NANO_USD),
      actual_cost_nano_usd: '120000',
      input_tokens: 120,
      output_tokens: 80,
      attempt_count: 1,
      outcome_class: 'completed',
      provider_request_id: 'resp_p6_loopback_only',
    });
    const columns = (await migrationPool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='polaris_provider_requests' ORDER BY column_name`
    )).rows.map(rowValue => rowValue.column_name);
    expect(columns).not.toEqual(expect.arrayContaining([
      'prompt', 'message', 'transcript', 'customer_context', 'provider_output', 'headers', 'secret',
    ]));
  });

  test('enforces user and tenant concurrency before transport with deterministic retry evidence', async () => {
    const ledger = createProviderUsageLedger({ poolProvider: () => runtimePool });
    const held = [];
    held.push(await ledger.reserve(requestInput(ORG_A, USERS_A[0])));
    await expect(ledger.reserve(requestInput(ORG_A, USERS_A[0]))).rejects.toMatchObject({
      code: 'POLARIS_RATE_LIMIT', statusCode: 429, retryAfterSeconds: 25,
    });
    held.push(await ledger.reserve(requestInput(ORG_A, USERS_A[1])));
    held.push(await ledger.reserve(requestInput(ORG_A, USERS_A[2])));
    held.push(await ledger.reserve(requestInput(ORG_A, USERS_A[3])));
    await expect(ledger.reserve(requestInput(ORG_A, USERS_A[4]))).rejects.toMatchObject({
      code: 'POLARIS_RATE_LIMIT', statusCode: 429, retryAfterSeconds: 25,
    });
    for (const reservation of held) {
      await ledger.reconcile(reservation, completedUsage({ inputTokens: 0, outputTokens: 0, costNanoUsd: 0 }));
    }
  });

  test('fails a zero-revenue tenant closed and keeps durable idempotency tenant/user scoped', async () => {
    const ledger = createProviderUsageLedger({ poolProvider: () => runtimePool });
    await expect(ledger.reserve(requestInput(ORG_B, USERS_B[0]))).rejects.toMatchObject({
      code: 'POLARIS_USAGE_LIMIT', statusCode: 429,
    });
    const exact = requestInput(ORG_A, USERS_A[0]);
    const reservation = await ledger.reserve(exact);
    const secondProcess = createProviderUsageLedger({ poolProvider: () => runtimePool });
    await expect(secondProcess.reserve(exact)).rejects.toMatchObject({
      code: 'POLARIS_IDEMPOTENCY_KEY_REUSED', statusCode: 409,
    });
    await ledger.reconcile(reservation, completedUsage({ inputTokens: 0, outputTokens: 0, costNanoUsd: 0 }));
  });

  test('enforces the exact per-user rolling minute threshold with Retry-After before provider work', async () => {
    const ledger = createProviderUsageLedger({ poolProvider: () => runtimePool });
    for (let index = 0; index < 12; index += 1) {
      const reservation = await ledger.reserve(requestInput(ORG_A, USERS_A[4]));
      await ledger.reconcile(reservation, completedUsage({
        inputTokens: 0,
        outputTokens: 0,
        costNanoUsd: 0,
        providerRequestId: `resp_rate_${index}`,
      }));
    }
    await expect(ledger.reserve(requestInput(ORG_A, USERS_A[4]))).rejects.toMatchObject({
      code: 'POLARIS_RATE_LIMIT', statusCode: 429, retryAfterSeconds: 60,
    });
  });

  test('conservatively charges an ambiguous expired reservation and retains monthly aggregate authority', async () => {
    const ledger = createProviderUsageLedger({ poolProvider: () => runtimePool });
    const ambiguous = await ledger.reserve(requestInput(ORG_A, USERS_A[0]));
    await migrationPool.query(
      `UPDATE public.polaris_provider_requests
          SET created_at=clock_timestamp()-INTERVAL '30 seconds',
              lease_expires_at=clock_timestamp()-INTERVAL '5 seconds'
        WHERE id=$1`,
      [ambiguous.id]
    );
    const next = await ledger.reserve(requestInput(ORG_A, USERS_A[1]));
    const expired = (await migrationPool.query(
      `SELECT state,actual_cost_nano_usd,outcome_class FROM public.polaris_provider_requests WHERE id=$1`,
      [ambiguous.id]
    )).rows[0];
    expect(expired).toEqual({
      state: 'failed',
      actual_cost_nano_usd: String(RESERVED_COST_NANO_USD),
      outcome_class: 'ambiguous_timeout',
    });
    const aggregate = (await migrationPool.query(
      `SELECT reserved_cost_nano_usd,reconciled_cost_nano_usd,failed_requests
         FROM public.polaris_provider_monthly_usage
        WHERE organization_id=$1 AND month_start=date_trunc('month',clock_timestamp())::date`,
      [ORG_A]
    )).rows[0];
    expect(Number(aggregate.reserved_cost_nano_usd)).toBeGreaterThanOrEqual(RESERVED_COST_NANO_USD);
    expect(Number(aggregate.reconciled_cost_nano_usd)).toBeGreaterThanOrEqual(RESERVED_COST_NANO_USD);
    expect(Number(aggregate.failed_requests)).toBeGreaterThanOrEqual(1);
    await ledger.reconcile(next, completedUsage({ inputTokens: 0, outputTokens: 0, costNanoUsd: 0 }));
  });
});
