'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const canonical = require('../../src/automation/canonicalJson');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '../..');
const TENANT = '00000000-0000-4000-8000-000000000028';
const OTHER = '00000000-0000-4000-8000-000000000029';
const POLICY = '00000000-0000-4000-8000-000000000100';
const SNAPSHOT = '00000000-0000-4000-8000-000000000300';
const POLICY_DIGEST = `sha256:${'1'.repeat(64)}`;
const SNAPSHOT_DIGEST = `sha256:${'2'.repeat(64)}`;
const SOURCE_DIGEST = `sha256:${'3'.repeat(64)}`;
const RLS_ROLE = `m28_part6a_rls_${process.pid}`;
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;

const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const digest = (namespace, value, excluded) => canonical.digest(`${namespace}\n`,
  excluded ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== excluded)) : value);

function unit(index = 0, suffix = 0) {
  const value = {
    unitId: uuid(700 + suffix), outboxId: uuid(800 + suffix), unitIndex: index,
    actionFamilyId: 'internal_read_digest_task', actionTemplateId: 'internal_fact_digest_v1',
    actionTemplateDigest: hash(`template-${suffix}`), recipientSetDigest: hash(`recipient-${suffix}`),
    channelId: 'in_app_passive', providerMode: 'provider_disabled', effectClass: 'internal_record_only',
    materialDigest: hash(`material-${suffix}`), idempotencyKeyDigest: hash(`idempotency-${suffix}`), unitDigest: '',
  };
  value.unitDigest = digest('mission28.action-unit.v1', value, 'unitDigest');
  return value;
}

function buildRequest(suffix = 0, units = [unit(0, suffix)]) {
  const sourceBinding = { tenantId: TENANT, sourceSetDigest: '', snapshotIds: [SNAPSHOT],
    snapshotDigests: [SNAPSHOT_DIGEST] };
  sourceBinding.sourceSetDigest = canonical.digest('mission28.action-source-set.v1\n', {
    tenantId: sourceBinding.tenantId, snapshotIds: sourceBinding.snapshotIds,
    snapshotDigests: sourceBinding.snapshotDigests,
  });
  const value = {
    schemaVersion: 'mission28.action-transaction.request.v1', tenantId: TENANT,
    transactionId: uuid(600 + suffix), runId: uuid(500 + suffix),
    policyBinding: { tenantId: TENANT, policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST },
    sourceBinding,
    decisionBinding: {
      evaluationId: uuid(400 + suffix), evaluationOutputDigest: hash(`evaluation-${suffix}`),
      previewId: uuid(410 + suffix), previewDigest: hash(`preview-${suffix}`),
      analysisId: uuid(420 + suffix), analysisOutputDigest: hash(`analysis-${suffix}`),
      candidateId: uuid(430 + suffix), collisionDecisionDigest: hash(`collision-${suffix}`),
      collisionResult: 'selected_no_effect', actionMaterialDigest: hash(`action-${suffix}`),
      actionUnitSetDigest: canonical.digest('mission28.action-unit-set.v1\n', units),
    },
    authorizationBinding: { authorizationId: uuid(440 + suffix), authorizationKind: 'per_run_approval',
      authorizationRecordDigest: hash(`authorization-${suffix}`),
      authorizationMaterialBindingDigest: hash(`authorization-material-${suffix}`) },
    currentnessBinding: { evaluationRevalidationId: uuid(450 + suffix),
      evaluationRevalidationDigest: hash(`evaluation-revalidation-${suffix}`),
      preEffectRevalidationId: uuid(460 + suffix),
      preEffectRevalidationDigest: hash(`pre-effect-revalidation-${suffix}`),
      acceptedState: 'current_contract_only_no_effect_authority' },
    actionUnits: units, requestDigest: '',
  };
  value.requestDigest = digest('mission28.action-transaction.request.v1', value, 'requestDigest');
  return value;
}

function trusted(request) {
  return {
    tenantId: request.tenantId, runId: request.runId, policyBinding: request.policyBinding,
    sourceBinding: request.sourceBinding, decisionBinding: request.decisionBinding,
    authorizationBinding: request.authorizationBinding, currentnessBinding: request.currentnessBinding,
  };
}

function reseal(request) {
  request.sourceBinding.sourceSetDigest = canonical.digest('mission28.action-source-set.v1\n', {
    tenantId: request.sourceBinding.tenantId, snapshotIds: request.sourceBinding.snapshotIds,
    snapshotDigests: request.sourceBinding.snapshotDigests,
  });
  request.decisionBinding.actionUnitSetDigest = canonical.digest('mission28.action-unit-set.v1\n', request.actionUnits);
  request.requestDigest = digest('mission28.action-transaction.request.v1', request, 'requestDigest');
  return request;
}

realPostgres('Mission 28 Part 6A PostgreSQL transactional outbox through migration 275', () => {
  let database;
  let pool;
  let migrations;
  let attackSequence = 20;

  async function enter(client, tenant = TENANT) {
    await client.query('SELECT public.canonical_automation_enter_tenant_v1($1)', [tenant]);
  }

  async function store(request, resolution = trusted(request), client = pool) {
    return (await client.query(
      'SELECT public.canonical_automation_store_action_transaction_v1($1,$2::jsonb) result',
      [canonical.canonicalize(request), JSON.stringify(resolution)])).rows[0].result;
  }

  async function counts(client = pool) {
    const result = await client.query(`SELECT
      (SELECT count(*)::integer FROM public.canonical_automation_action_transactions_v1) transactions,
      (SELECT count(*)::integer FROM public.canonical_automation_action_units_v1) units,
      (SELECT count(*)::integer FROM public.canonical_automation_action_outbox_v1) outbox`);
    return result.rows[0];
  }

  async function transactionCount() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await enter(client);
      const count = (await client.query(
        'SELECT count(*)::integer count FROM public.canonical_automation_action_transactions_v1')).rows[0].count;
      await client.query('COMMIT');
      return count;
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p6a-outbox');
    pool = new Pool({ connectionString: database.connectionString, max: 6 });
    migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p6a-through275-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 275)) {
      fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    }
    const db = require('../../src/db');
    await db.runMigrations({ pool, migrationsDirectory: migrations });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO public.organizations(id,name,email) VALUES
        ($1,'Mission 28 Part 6A tenant','m28-part6a@example.test'),
        ($2,'Mission 28 Part 6A other','m28-part6a-other@example.test')`, [TENANT, OTHER]);
      await enter(client);
      const policyDocument = { tenantId: TENANT, policyId: POLICY, version: 1,
        canonicalDigest: POLICY_DIGEST, previousVersionDigest: null };
      await client.query(`INSERT INTO public.canonical_automation_policy_versions_v1
        (organization_id,policy_id,version,previous_version_digest,canonical_digest,canonical_text,document,
         expires_at,source_origin,conversion_review_id,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
        VALUES($1,$2,1,NULL,$3,$4::text,$4::jsonb,NOW()+INTERVAL '1 day','mission28_native',NULL,
         'policy_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`,
      [TENANT, POLICY, POLICY_DIGEST, canonical.canonicalize(policyDocument)]);
      await client.query(`INSERT INTO public.canonical_automation_lifecycle_events_v1
        (organization_id,lifecycle_event_id,policy_id,policy_version,lifecycle_sequence,operation,from_state,to_state,
         predecessor_event_id,predecessor_event_digest,idempotency_digest,payload_digest,event_digest,source_set_digest,
         currentness_marker,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
        VALUES($1,$2,$3,1,1,'activate','previewed','active',NULL,NULL,$4,$5,$6,$7,
         'exact_current_not_runtime_revalidated','{}','{}','lifecycle_history',
         'postgresql_statement_timestamp_v1','UTC',statement_timestamp())`,
      [TENANT, uuid(200), POLICY, hash('lifecycle-idempotency'), hash('lifecycle-payload'),
        hash('lifecycle-event'), hash('lifecycle-source-set')]);
      const snapshotDocument = {
        tenantId: TENANT, snapshotId: SNAPSHOT, triggerId: 'm20.lead_contact_state',
        sourceClassId: 'mission20_business_contact_preferences', recordIdentityDigest: hash('record-identity'),
        canonicalDigest: SOURCE_DIGEST, sourceDigest: SOURCE_DIGEST,
        eventBinding: { eventKind: 'transcript_occurred', eventTime: '2026-10-28T12:00:00.000000Z' },
        currentness: { availability: 'available_exact_current', pinsDigest: hash('currentness-pins') },
        provenance: { kind: 'authenticated_event', provenanceDigest: hash('provenance') },
        lineage: { kind: 'original', sequence: 1 }, requestDigest: hash('snapshot-request'),
        snapshotDigest: SNAPSHOT_DIGEST, observedAt: '2026-10-28T12:00:01.000000Z',
      };
      await client.query(`INSERT INTO public.canonical_automation_trigger_snapshots_v1
        (organization_id,snapshot_id,trigger_id,source_class_id,record_identity_digest,canonical_digest,source_digest,
         event_kind,event_time,currentness_pins_digest,provenance_kind,provenance_digest,lineage_kind,lineage_sequence,
         predecessor_snapshot_id,predecessor_snapshot_digest,request_digest,snapshot_digest,request_text,canonical_text,
         document,retention_class,trusted_clock_contract,recorded_time_zone,observed_at)
        VALUES($1,$2,'m20.lead_contact_state','mission20_business_contact_preferences',$3,$4,$4,
         'transcript_occurred',$5,$6,'authenticated_event',$7,'original',1,NULL,NULL,$8,$9,$10::text,$10::text,$10::jsonb,
         'source_snapshot_history','postgresql_statement_timestamp_v1','UTC',$11)`,
      [TENANT, SNAPSHOT, hash('record-identity'), SOURCE_DIGEST, snapshotDocument.eventBinding.eventTime,
        hash('currentness-pins'), hash('provenance'), hash('snapshot-request'), SNAPSHOT_DIGEST,
        canonical.canonicalize(snapshotDocument), snapshotDocument.observedAt]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`CREATE ROLE ${quoteIdentifier(RLS_ROLE)} NOLOGIN`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_action_transactions_v1,
      public.canonical_automation_action_units_v1,public.canonical_automation_action_outbox_v1
      TO ${quoteIdentifier(RLS_ROLE)}`);
  }, 300000);

  afterAll(async () => {
    if (pool) {
      await pool.query(`REVOKE ALL ON public.canonical_automation_action_transactions_v1,
        public.canonical_automation_action_units_v1,public.canonical_automation_action_outbox_v1
        FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {});
      await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(RLS_ROLE)}`).catch(() => {});
    }
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('migration 275 is additive, tenant-private, immutable and exposes no publication authority', async () => {
    expect((await pool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0])
      .toEqual({ latest: 275, total: 271 });
    expect((await pool.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE relname IN('canonical_automation_action_transactions_v1','canonical_automation_action_units_v1',
      'canonical_automation_action_outbox_v1') ORDER BY relname`)).rows)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ relname: 'canonical_automation_action_transactions_v1', relrowsecurity: true, relforcerowsecurity: true }),
        expect.objectContaining({ relname: 'canonical_automation_action_units_v1', relrowsecurity: true, relforcerowsecurity: true }),
        expect.objectContaining({ relname: 'canonical_automation_action_outbox_v1', relrowsecurity: true, relforcerowsecurity: true }),
      ]));
    expect((await pool.query(`SELECT
      has_function_privilege('public','public.canonical_automation_store_action_transaction_v1(text,jsonb)','EXECUTE') public_execute,
      has_table_privilege('public','public.canonical_automation_action_outbox_v1','SELECT') public_read`)).rows[0])
      .toEqual({ public_execute: false, public_read: false });
    const migrationSource = fs.readFileSync(path.join(ROOT,
      'migrations', '275_canonical_automation_transactional_outbox_v1.sql'), 'utf8');
    expect(migrationSource).not.toMatch(/\bNOTIFY\b|pg_notify|recipient_address/i);
    expect(migrationSource).not.toMatch(/CREATE\s+(TRIGGER|FUNCTION)[^;]*queue_publish/is);
  }, 120000);

  test('keeps transaction, bounded action unit, and unpublished outbox invisible until one authoritative commit', async () => {
    const writer = await pool.connect();
    const observer = await pool.connect();
    const request = buildRequest(1);
    try {
      await writer.query('BEGIN');
      const stored = await store(request, trusted(request), writer);
      expect(stored).toMatchObject({ state: 'stored', replayed: false, transactionId: request.transactionId, unitCount: 1 });
      await observer.query('BEGIN');
      await enter(observer);
      expect(await counts(observer)).toEqual({ transactions: 0, units: 0, outbox: 0 });
      await observer.query('COMMIT');
      await writer.query('COMMIT');
      await observer.query('BEGIN');
      await enter(observer);
      expect(await counts(observer)).toEqual({ transactions: 1, units: 1, outbox: 1 });
      const row = (await observer.query(`SELECT state,queue_publication_id,queue_published_at,claim_id,lease_expires_at
        FROM public.canonical_automation_action_outbox_v1 WHERE organization_id=$1 AND transaction_id=$2`,
      [TENANT, request.transactionId])).rows[0];
      expect(row).toEqual({ state: 'committed_unpublished', queue_publication_id: null,
        queue_published_at: null, claim_id: null, lease_expires_at: null });
      await observer.query('COMMIT');
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      await observer.query('ROLLBACK').catch(() => {});
      writer.release(); observer.release();
    }
  }, 120000);

  test('rollback leaves no partial transaction, unit, or outbox record', async () => {
    const writer = await pool.connect();
    const request = buildRequest(2);
    try {
      await writer.query('BEGIN');
      await store(request, trusted(request), writer);
      await writer.query('ROLLBACK');
      await writer.query('BEGIN');
      await enter(writer);
      expect((await writer.query(`SELECT count(*)::integer count FROM public.canonical_automation_action_transactions_v1
        WHERE organization_id=$1 AND transaction_id=$2`, [TENANT, request.transactionId])).rows[0].count).toBe(0);
      expect((await writer.query(`SELECT count(*)::integer count FROM public.canonical_automation_action_outbox_v1
        WHERE organization_id=$1 AND transaction_id=$2`, [TENANT, request.transactionId])).rows[0].count).toBe(0);
      await writer.query('COMMIT');
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
    }
  }, 120000);

  test('replays the exact canonical request and rejects a conflicting transaction identity without residue', async () => {
    const request = buildRequest(3);
    const first = await store(request);
    expect(await store(request)).toEqual({ ...first, replayed: true });
    const conflict = reseal(copy(request));
    conflict.decisionBinding.previewDigest = hash('conflicting-preview');
    reseal(conflict);
    await expect(store(conflict, trusted(conflict))).rejects.toThrow(/conflicting action transaction identity/i);
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await enter(client);
      expect((await client.query(`SELECT count(*)::integer count FROM public.canonical_automation_action_units_v1
        WHERE organization_id=$1 AND transaction_id=$2`, [TENANT, request.transactionId])).rows[0].count).toBe(1);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }, 120000);

  test.each(['materialDigest', 'idempotencyKeyDigest'])(
    'rejects tenant-global cross-run reuse of %s and rolls the new transaction back without residue', async field => {
      const originalUnit = unit(0, 1);
      const suffix = field === 'materialDigest' ? 5 : 6;
      const replayUnit = unit(0, suffix);
      replayUnit[field] = originalUnit[field];
      replayUnit.unitDigest = digest('mission28.action-unit.v1', replayUnit, 'unitDigest');
      const replay = buildRequest(suffix, [replayUnit]);
      const before = await transactionCount();
      await expect(store(replay)).rejects.toThrow(/unique|duplicate/i);
      expect(await transactionCount()).toBe(before);
      const client = await pool.connect();
      try {
        await client.query('BEGIN'); await enter(client);
        expect((await client.query(`SELECT count(*)::integer count FROM public.canonical_automation_action_transactions_v1
          WHERE organization_id=$1 AND transaction_id=$2`, [TENANT, replay.transactionId])).rows[0].count).toBe(0);
        expect((await client.query(`SELECT count(*)::integer count FROM public.canonical_automation_action_units_v1
          WHERE organization_id=$1 AND unit_id=$2`, [TENANT, replayUnit.unitId])).rows[0].count).toBe(0);
        expect((await client.query(`SELECT count(*)::integer count FROM public.canonical_automation_action_outbox_v1
          WHERE organization_id=$1 AND outbox_id=$2`, [TENANT, replayUnit.outboxId])).rows[0].count).toBe(0);
        await client.query('COMMIT');
      } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    }, 120000);

  test('rejects separately trusted resolution substitution before storage', async () => {
    const request = buildRequest(4);
    const substituted = copy(trusted(request));
    substituted.runId = uuid(999);
    const before = await transactionCount();
    await expect(store(request, substituted)).rejects.toThrow(/trusted resolution mismatch/i);
    expect(await transactionCount()).toBe(before);
  }, 120000);

  test('forced RLS exposes no tenant action evidence to a granted non-owner role', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${quoteIdentifier(RLS_ROLE)}`);
      await client.query("SELECT set_config('northstar.automation_tenant_id',$1,TRUE)", [OTHER]);
      expect(await counts(client)).toEqual({ transactions: 0, units: 0, outbox: 0 });
      await client.query('COMMIT');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }, 120000);

  test.each([
    ['cross tenant', value => { value.tenantId = OTHER; value.policyBinding.tenantId = OTHER; value.sourceBinding.tenantId = OTHER; }],
    ['untrusted policy', value => { value.policyBinding.policyDigest = hash('wrong-policy'); }],
    ['untrusted source', value => { value.sourceBinding.snapshotDigests[0] = hash('wrong-snapshot'); }],
    ['duplicate source identity', value => {
      value.sourceBinding.snapshotIds.push(value.sourceBinding.snapshotIds[0]);
      value.sourceBinding.snapshotDigests.push(value.sourceBinding.snapshotDigests[0]);
    }],
    ['source-set alias digest', value => { value.sourceBinding.sourceSetDigest = hash('forged-source-set'); }],
    ['action-unit-set alias digest', value => { value.decisionBinding.actionUnitSetDigest = hash('forged-unit-set'); }],
    ['queue-capable channel', value => { value.actionUnits[0].channelId = 'email'; }],
    ['provider mode', value => { value.actionUnits[0].providerMode = 'live'; }],
    ['external effect', value => { value.actionUnits[0].effectClass = 'customer_communication'; }],
    ['extra field', value => { value.unexpected = true; }],
  ])('rejects %s before any durable residue', async (_name, mutate) => {
    const request = buildRequest(attackSequence++);
    mutate(request);
    if (!['source-set alias digest', 'action-unit-set alias digest'].includes(_name)) reseal(request);
    const before = await transactionCount();
    await expect(store(request, trusted(request))).rejects.toThrow();
    expect(await transactionCount()).toBe(before);
  }, 120000);

  test('rejects a snapshot that stops being the latest lineage head', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await enter(client);
      const original = (await client.query(`SELECT * FROM public.canonical_automation_trigger_snapshots_v1
        WHERE organization_id=$1 AND snapshot_id=$2`, [TENANT, SNAPSHOT])).rows[0];
      const correctionId = uuid(301);
      const correctionDocument = copy(original.document);
      correctionDocument.snapshotId = correctionId;
      correctionDocument.canonicalDigest = hash('corrected-source');
      correctionDocument.sourceDigest = hash('corrected-source');
      correctionDocument.lineage = { kind: 'correction', sequence: 2 };
      correctionDocument.requestDigest = hash('corrected-request');
      correctionDocument.snapshotDigest = hash('corrected-snapshot');
      correctionDocument.observedAt = '2026-10-28T12:00:02.000000Z';
      await client.query(`INSERT INTO public.canonical_automation_trigger_snapshots_v1
        (organization_id,snapshot_id,trigger_id,source_class_id,record_identity_digest,canonical_digest,source_digest,
         event_kind,event_time,currentness_pins_digest,provenance_kind,provenance_digest,lineage_kind,lineage_sequence,
         predecessor_snapshot_id,predecessor_snapshot_digest,request_digest,snapshot_digest,request_text,canonical_text,
         document,retention_class,trusted_clock_contract,recorded_time_zone,observed_at)
        VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,'correction',2,$12,$13,$14,$15,$16::text,$16::text,$16::jsonb,
         'source_snapshot_history','postgresql_statement_timestamp_v1','UTC',$17)`,
      [TENANT, correctionId, original.trigger_id, original.source_class_id, original.record_identity_digest,
        correctionDocument.sourceDigest, original.event_kind, original.event_time, original.currentness_pins_digest,
        original.provenance_kind, original.provenance_digest, SNAPSHOT, SNAPSHOT_DIGEST,
        correctionDocument.requestDigest, correctionDocument.snapshotDigest,
        canonical.canonicalize(correctionDocument), correctionDocument.observedAt]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    const stale = buildRequest(90);
    await expect(store(stale)).rejects.toThrow(/not latest lineage head/i);
  }, 120000);

  test('keeps all durable evidence append-only and rejects queue publication or mutation', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await enter(client);
      const transaction = (await client.query('SELECT transaction_id FROM public.canonical_automation_action_transactions_v1 LIMIT 1')).rows[0];
      await expect(client.query(`UPDATE public.canonical_automation_action_transactions_v1 SET unit_count=2
        WHERE organization_id=$1 AND transaction_id=$2`, [TENANT, transaction.transaction_id])).rejects.toThrow(/append-only|immutable/i);
      await client.query('ROLLBACK');
      await client.query('BEGIN'); await enter(client);
      const outbox = (await client.query('SELECT outbox_id FROM public.canonical_automation_action_outbox_v1 LIMIT 1')).rows[0];
      await expect(client.query(`UPDATE public.canonical_automation_action_outbox_v1 SET queue_publication_id='forbidden'
        WHERE organization_id=$1 AND outbox_id=$2`, [TENANT, outbox.outbox_id])).rejects.toThrow(/append-only|immutable/i);
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }, 120000);
});
