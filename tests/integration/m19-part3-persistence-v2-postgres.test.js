'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { Pool } = require('pg');
const repository = require('../../src/persistence/v2/repository');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

const urls = {};
const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const migrationDir = path.resolve(__dirname, '../../migrations');
const currentMigrations = ['001_initial_schema.sql', '002_seed_data.sql', '003_voice_sessions.sql'];
const persistenceMigration = '004_canonical_persistence_v2.sql';
const authorityMigration = '005_canonical_organization_authority.sql';
const voiceMigration = '006_canonical_voice_sessions.sql';
const taxMigration = '007_canonical_tax_authority.sql';
const orgA = '00000000-0000-0000-0000-000000000001';
const orgB = '00000000-0000-0000-0000-000000000010';

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function apply(pool, filenames) {
  for (const filename of filenames) {
    await pool.query(fs.readFileSync(path.join(migrationDir, filename), 'utf8'));
  }
}

async function addOrganizationB(pool) {
  await pool.query(
    `INSERT INTO organizations (id, name, email)
     VALUES ($1, 'Organization B', 'org-b@m19.test')
     ON CONFLICT (id) DO NOTHING`,
    [orgB]
  );
}

realPostgres('Mission 19 Part 3 Persistence V2 on disposable PostgreSQL', () => {
  let fresh;
  let upgrade;
  let concurrencyA;
  let concurrencyB;
  let suiteDatabases = [];

  beforeAll(async () => {
    suiteDatabases.push(await createSuiteDatabase('persistence-fresh'));
    suiteDatabases.push(await createSuiteDatabase('persistence-upgrade'));
    suiteDatabases.push(await createSuiteDatabase('persistence-concurrency'));
    urls.fresh = suiteDatabases[0].connectionString;
    urls.upgrade = suiteDatabases[1].connectionString;
    urls.concurrency = suiteDatabases[2].connectionString;
    fresh = new Pool({ connectionString: urls.fresh, max: 8 });
    upgrade = new Pool({ connectionString: urls.upgrade, max: 8 });
    concurrencyA = new Pool({ connectionString: urls.concurrency, max: 24 });
    concurrencyB = new Pool({ connectionString: urls.concurrency, max: 24 });
    await apply(concurrencyA, [...currentMigrations, persistenceMigration, authorityMigration, voiceMigration, taxMigration]);
    await addOrganizationB(concurrencyA);
  });

  afterAll(async () => {
    try {
      await Promise.all([fresh, upgrade, concurrencyA, concurrencyB].filter(Boolean).map(pool => pool.end()));
    } finally {
      for (const database of suiteDatabases.reverse()) await database.cleanup();
    }
  });

  beforeEach(async () => {
    await concurrencyA.query('TRUNCATE TABLE canonical_operations CASCADE');
  });

  test('fresh migration creates only the complete Part 3 canonical schema and required constraints', async () => {
    await apply(fresh, [...currentMigrations, persistenceMigration, authorityMigration, voiceMigration, taxMigration]);
    const tables = await fresh.query(
      `SELECT tablename FROM pg_catalog.pg_tables
        WHERE schemaname = 'public' AND tablename LIKE 'canonical_%'
        ORDER BY tablename`
    );
    expect(tables.rows.map(row => row.tablename)).toEqual([
      'canonical_appointments',
      'canonical_business_profiles',
      'canonical_communications',
      'canonical_customer_identities',
      'canonical_customers',
      'canonical_estimates',
      'canonical_facts',
      'canonical_integration_ownership',
      'canonical_operations',
      'canonical_opportunities',
      'canonical_polaris_snapshots',
      'canonical_transcripts',
      'canonical_voice_session_events',
      'canonical_voice_sessions',
    ]);

    const constraints = await fresh.query(
      `SELECT conname FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace AND conname LIKE 'canonical_%'`
    );
    const constraintNames = new Set(constraints.rows.map(row => row.conname));
    for (const name of [
      'canonical_operations_key_unique',
      'canonical_operations_payload_hash_format',
      'canonical_customers_operation_fk',
      'canonical_transcripts_customer_fk',
      'canonical_facts_transcript_fk',
      'canonical_communications_customer_fk',
      'canonical_opportunities_customer_fk',
      'canonical_estimates_opportunity_fk',
      'canonical_appointments_opportunity_fk',
      'canonical_polaris_estimate_fk',
      'canonical_customer_identities_customer_fk',
      'canonical_polaris_profile_authority_fk',
      'canonical_voice_sessions_integration_fk',
      'canonical_voice_sessions_profile_fk',
      'canonical_voice_sessions_operation_fk',
      'canonical_voice_session_events_session_fk',
      'canonical_estimates_tax_rate_check',
      'canonical_estimates_tax_amount_check',
      'canonical_estimates_total_with_tax_check',
    ]) {
      expect(constraintNames.has(name)).toBe(true);
    }

    const triggers = await fresh.query(
      `SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal AND tgname LIKE 'canonical_%_immutable'
        ORDER BY tgname`
    );
    expect(triggers.rows.map(row => row.tgname)).toEqual([
      'canonical_estimates_immutable',
      'canonical_polaris_snapshots_immutable',
    ]);
  }, 30000);

  test('upgrade applies additively and leaves all existing tables and seed rows intact', async () => {
    await apply(upgrade, currentMigrations);
    const before = await upgrade.query(
      `SELECT
        (SELECT count(*)::int FROM organizations) AS organizations,
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM leads) AS leads,
        (SELECT count(*)::int FROM call_records) AS calls`
    );
    const legacyColumnsBefore = await upgrade.query(
      `SELECT table_name, column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('organizations', 'users', 'leads', 'call_records', 'audit_logs')
        ORDER BY table_name, ordinal_position`
    );

    await apply(upgrade, [persistenceMigration, authorityMigration, voiceMigration, taxMigration]);

    const after = await upgrade.query(
      `SELECT
        (SELECT count(*)::int FROM organizations) AS organizations,
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM leads) AS leads,
        (SELECT count(*)::int FROM call_records) AS calls`
    );
    const legacyColumnsAfter = await upgrade.query(
      `SELECT table_name, column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('organizations', 'users', 'leads', 'call_records', 'audit_logs')
        ORDER BY table_name, ordinal_position`
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(legacyColumnsAfter.rows).toEqual(legacyColumnsBefore.rows);
    expect(before.rows[0]).toEqual({ organizations: 1, users: 1, leads: 3, calls: 3 });
  }, 30000);

  test('tenant-safe foreign keys, singleton operation constraints, and external identifiers reject collisions', async () => {
    const claimA = await repository.claimOperation(concurrencyA, {
      organizationId: orgA,
      keyHash: digest('constraints-a'),
      payloadFingerprint: digest('constraints-payload-a'),
      leaseOwner: randomUUID(),
      leaseMs: 30000,
    });
    expect(claimA.kind).toBe('claimed');

    await expect(concurrencyA.query(
      `INSERT INTO canonical_customers (id, organization_id, operation_id, graph_id, name)
       VALUES ($1, $2, $3, $4, 'Cross tenant')`,
      [randomUUID(), orgB, claimA.operation.id, claimA.operation.graph_id]
    )).rejects.toMatchObject({ code: '23503' });

    const customerA = randomUUID();
    await concurrencyA.query(
      `INSERT INTO canonical_customers (id, organization_id, operation_id, graph_id, name)
       VALUES ($1, $2, $3, $4, 'Customer A')`,
      [customerA, orgA, claimA.operation.id, claimA.operation.graph_id]
    );
    await expect(concurrencyA.query(
      `INSERT INTO canonical_customers (id, organization_id, operation_id, graph_id, name)
       VALUES ($1, $2, $3, $4, 'Duplicate graph root')`,
      [randomUUID(), orgA, claimA.operation.id, claimA.operation.graph_id]
    )).rejects.toMatchObject({ code: '23505' });

    const transcriptA = randomUUID();
    await concurrencyA.query(
      `INSERT INTO canonical_transcripts
        (id, organization_id, operation_id, graph_id, customer_id, source, source_version,
         external_call_id, transcript_text, normalized_fingerprint)
       VALUES ($1, $2, $3, $4, $5, 'retell', 'v1', 'external-call-shared', 'hello', $6)`,
      [transcriptA, orgA, claimA.operation.id, claimA.operation.graph_id, customerA, digest('transcript-a')]
    );

    const claimB = await repository.claimOperation(concurrencyA, {
      organizationId: orgA,
      keyHash: digest('constraints-b'),
      payloadFingerprint: digest('constraints-payload-b'),
      leaseOwner: randomUUID(),
      leaseMs: 30000,
    });
    const customerB = randomUUID();
    await concurrencyA.query(
      `INSERT INTO canonical_customers (id, organization_id, operation_id, graph_id, name)
       VALUES ($1, $2, $3, $4, 'Customer B')`,
      [customerB, orgA, claimB.operation.id, claimB.operation.graph_id]
    );
    await expect(concurrencyA.query(
      `INSERT INTO canonical_transcripts
        (id, organization_id, operation_id, graph_id, customer_id, source, source_version,
         external_call_id, transcript_text, normalized_fingerprint)
       VALUES ($1, $2, $3, $4, $5, 'retell', 'v1', 'external-call-shared', 'hello again', $6)`,
      [randomUUID(), orgA, claimB.operation.id, claimB.operation.graph_id, customerB, digest('transcript-b')]
    )).rejects.toMatchObject({ code: '23505' });
  }, 30000);

  test('concurrent claims, fingerprint conflicts, leases, completion replay, and tenant isolation are durable', async () => {
    const keyHash = digest('concurrent-operation');
    const payloadFingerprint = digest('concurrent-payload');
    const owners = Array.from({ length: 16 }, () => randomUUID());
    const claims = await Promise.all(owners.map((leaseOwner, index) =>
      repository.claimOperation(index % 2 ? concurrencyA : concurrencyB, {
        organizationId: orgA,
        keyHash,
        payloadFingerprint,
        leaseOwner,
        leaseMs: 60000,
      })
    ));
    expect(claims.filter(claim => claim.kind === 'claimed')).toHaveLength(1);
    expect(claims.filter(claim => claim.kind === 'active')).toHaveLength(15);
    expect(new Set(claims.map(claim => claim.operation.id)).size).toBe(1);

    const conflict = await repository.claimOperation(concurrencyB, {
      organizationId: orgA,
      keyHash,
      payloadFingerprint: digest('different-payload'),
      leaseOwner: randomUUID(),
      leaseMs: 60000,
    });
    expect(conflict.kind).toBe('conflict');

    const active = claims.find(claim => claim.kind === 'claimed');
    await concurrencyA.query(
      `UPDATE canonical_operations SET lease_expires_at = NOW() - INTERVAL '1 second'
        WHERE organization_id = $1 AND id = $2`,
      [orgA, active.operation.id]
    );
    const takeoverOwner = randomUUID();
    const takeover = await repository.claimOperation(concurrencyB, {
      organizationId: orgA,
      keyHash,
      payloadFingerprint,
      leaseOwner: takeoverOwner,
      leaseMs: 60000,
    });
    expect(takeover).toMatchObject({ kind: 'claimed', takeover: true });
    expect(takeover.operation.attempt_count).toBe(2);

    await repository.withTransaction(concurrencyA, client => repository.completeOperation(client, {
      organizationId: orgA,
      operationId: takeover.operation.id,
      leaseOwner: takeoverOwner,
      resultStatus: 201,
      resultBody: { graphId: takeover.operation.graph_id },
    }));
    const replay = await repository.claimOperation(concurrencyB, {
      organizationId: orgA,
      keyHash,
      payloadFingerprint,
      leaseOwner: randomUUID(),
      leaseMs: 60000,
    });
    expect(replay.kind).toBe('replay');
    expect(replay.operation.result_body).toEqual({ graphId: takeover.operation.graph_id });

    const independent = await repository.claimOperation(concurrencyB, {
      organizationId: orgB,
      keyHash,
      payloadFingerprint,
      leaseOwner: randomUUID(),
      leaseMs: 60000,
    });
    expect(independent.kind).toBe('claimed');
    expect(independent.operation.id).not.toBe(takeover.operation.id);
    await expect(repository.getOperation(concurrencyA, orgB, takeover.operation.id)).resolves.toBeNull();
  }, 30000);

  test('retryable failures can be reclaimed, permanent failures replay safely, and transactions roll back', async () => {
    const retryOwner = randomUUID();
    const retryClaim = await repository.claimOperation(concurrencyA, {
      organizationId: orgA,
      keyHash: digest('retryable-key'),
      payloadFingerprint: digest('retryable-payload'),
      leaseOwner: retryOwner,
      leaseMs: 30000,
    });
    await repository.failOperation(concurrencyA, {
      organizationId: orgA,
      operationId: retryClaim.operation.id,
      leaseOwner: retryOwner,
      retryable: true,
      safeErrorCode: 'temporary_failure',
    });
    const reclaimed = await repository.claimOperation(concurrencyB, {
      organizationId: orgA,
      keyHash: digest('retryable-key'),
      payloadFingerprint: digest('retryable-payload'),
      leaseOwner: randomUUID(),
      leaseMs: 30000,
    });
    expect(reclaimed).toMatchObject({ kind: 'claimed', takeover: true });

    const permanentOwner = randomUUID();
    const permanentClaim = await repository.claimOperation(concurrencyA, {
      organizationId: orgA,
      keyHash: digest('permanent-key'),
      payloadFingerprint: digest('permanent-payload'),
      leaseOwner: permanentOwner,
      leaseMs: 30000,
    });
    await repository.failOperation(concurrencyA, {
      organizationId: orgA,
      operationId: permanentClaim.operation.id,
      leaseOwner: permanentOwner,
      retryable: false,
      safeErrorCode: 'invalid_scope',
    });
    const permanent = await repository.claimOperation(concurrencyB, {
      organizationId: orgA,
      keyHash: digest('permanent-key'),
      payloadFingerprint: digest('permanent-payload'),
      leaseOwner: randomUUID(),
      leaseMs: 30000,
    });
    expect(permanent.kind).toBe('permanent_failure');
    expect(permanent.operation.safe_error_code).toBe('invalid_scope');

    const rollbackOrg = randomUUID();
    await expect(repository.withTransaction(concurrencyA, async client => {
      await client.query(
        `INSERT INTO organizations (id, name, email) VALUES ($1, 'Rollback Org', $2)`,
        [rollbackOrg, `${rollbackOrg}@m19.test`]
      );
      throw new Error('injected rollback');
    })).rejects.toThrow('injected rollback');
    const rows = await concurrencyA.query('SELECT id FROM organizations WHERE id = $1', [rollbackOrg]);
    expect(rows.rows).toHaveLength(0);
  }, 30000);
});
