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
const SOURCE_SET_DIGEST = `sha256:${'4'.repeat(64)}`;
const RLS_ROLE = `m28_part6b_rls_${process.pid}`;
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const digest = (namespace, value, excluded) => canonical.digest(`${namespace}\n`,
  excluded ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== excluded)) : value);
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;

function actionUnit(suffix) {
  const value = { unitId: uuid(1000 + suffix), outboxId: uuid(2000 + suffix), unitIndex: 0,
    actionFamilyId: 'internal_read_digest_task', actionTemplateId: 'internal_fact_digest_v1',
    actionTemplateDigest: hash(`template-${suffix}`), recipientSetDigest: hash(`recipient-${suffix}`),
    channelId: 'in_app_passive', providerMode: 'provider_disabled', effectClass: 'internal_record_only',
    materialDigest: hash(`material-${suffix}`), idempotencyKeyDigest: hash(`idempotency-${suffix}`), unitDigest: '' };
  value.unitDigest = digest('mission28.action-unit.v1', value, 'unitDigest'); return value;
}

function actionRequest(suffix) {
  const unit = actionUnit(suffix);
  const sourceBinding = { tenantId: TENANT, sourceSetDigest: SOURCE_SET_DIGEST, snapshotIds: [SNAPSHOT], snapshotDigests: [SNAPSHOT_DIGEST] };
  const value = { schemaVersion: 'mission28.action-transaction.request.v1', tenantId: TENANT,
    transactionId: uuid(3000 + suffix), runId: uuid(4000 + suffix),
    policyBinding: { tenantId: TENANT, policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST }, sourceBinding,
    decisionBinding: { evaluationId: uuid(5000 + suffix), evaluationOutputDigest: hash(`evaluation-${suffix}`), previewId: uuid(6000 + suffix), previewDigest: hash(`preview-${suffix}`), analysisId: uuid(7000 + suffix), analysisOutputDigest: hash(`analysis-${suffix}`), candidateId: uuid(8000 + suffix), collisionDecisionDigest: hash(`collision-${suffix}`), collisionResult: 'selected_no_effect', actionMaterialDigest: hash(`action-${suffix}`), actionUnitSetDigest: canonical.digest('mission28.action-unit-set.v1\n', [unit]) },
    authorizationBinding: { authorizationId: uuid(9000 + suffix), authorizationKind: 'per_run_approval', authorizationRecordDigest: hash(`authorization-${suffix}`), authorizationMaterialBindingDigest: hash(`authorization-material-${suffix}`) },
    currentnessBinding: { evaluationRevalidationId: uuid(10000 + suffix), evaluationRevalidationDigest: hash(`evaluation-current-${suffix}`), preEffectRevalidationId: uuid(11000 + suffix), preEffectRevalidationDigest: hash(`effect-current-${suffix}`), acceptedState: 'current_contract_only_no_effect_authority' },
    actionUnits: [unit], requestDigest: '' };
  value.requestDigest = digest('mission28.action-transaction.request.v1', value, 'requestDigest'); return value;
}

function reseal(value) {
  const c = value.calendarBinding;
  c.calendarDigest = digest('mission28.business-calendar.v1', { tenantId: value.tenantId, calendarId: c.calendarId, calendarVersion: c.calendarVersion, calendarState: c.calendarState, tenantTimeZone: c.tenantTimeZone, allowedWeeklyWindows: c.allowedWeeklyWindows, quietWeeklyWindows: c.quietWeeklyWindows, holidayDates: c.holidayDates });
  value.scheduleBindingDigest = digest('mission28.action-schedule-binding.v1', { tenantId: value.tenantId, transactionId: value.transactionId, runId: value.runId, unitBinding: value.unitBinding, policyBinding: value.policyBinding, sourceBinding: value.sourceBinding, localSchedule: value.localSchedule, calendarBinding: value.calendarBinding, expirationBinding: value.expirationBinding, trustedClockBinding: value.trustedClockBinding });
  value.requestDigest = digest('mission28.action-schedule.request.v1', value, 'requestDigest'); return value;
}

function schedule(action, suffix = 0) {
  const unit = action.actionUnits[0];
  return reseal({ schemaVersion: 'mission28.action-schedule.request.v1', tenantId: TENANT,
    scheduleId: uuid(12000 + suffix), transactionId: action.transactionId, runId: action.runId,
    unitBinding: { unitId: unit.unitId, outboxId: unit.outboxId, unitDigest: unit.unitDigest },
    policyBinding: { policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST },
    sourceBinding: { sourceSetDigest: SOURCE_SET_DIGEST },
    localSchedule: { tenantTimeZone: 'America/New_York', localDate: '2027-01-07', localTime: '10:00:00', utcInstant: '2027-01-07T15:00:00.000000Z', foldResolution: 'not_ambiguous' },
    calendarBinding: { calendarId: uuid(13000), calendarVersion: 1, calendarDigest: '', calendarState: 'exact_current', tenantTimeZone: 'America/New_York', allowedWeeklyWindows: [{ dayId: 4, startMinuteInclusive: 540, endMinuteExclusive: 1020 }], quietWeeklyWindows: [{ dayId: 4, startMinuteInclusive: 720, endMinuteExclusive: 780 }], holidayDates: [] },
    expirationBinding: { expiresAt: '2027-01-08T15:00:00.000000Z' },
    trustedClockBinding: { contract: 'postgresql_statement_timestamp_v1' }, scheduleBindingDigest: '', requestDigest: '' });
}

function trusted(value) {
  return { tenantId: value.tenantId, transactionId: value.transactionId, runId: value.runId, unitBinding: value.unitBinding, policyBinding: value.policyBinding, sourceBinding: value.sourceBinding, localSchedule: value.localSchedule, calendarBinding: value.calendarBinding, expirationBinding: value.expirationBinding, trustedClockBinding: value.trustedClockBinding, scheduleBindingDigest: value.scheduleBindingDigest };
}

realPostgres('Mission 28 Part 6B PostgreSQL durable scheduler through migration 276', () => {
  let database; let pool; let migrations;

  async function enter(client, tenant = TENANT) { await client.query('SELECT public.canonical_automation_enter_tenant_v1($1)', [tenant]); }
  async function store(value, resolution = trusted(value), client = pool) {
    return (await client.query('SELECT public.canonical_automation_store_action_schedule_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(resolution)])).rows[0].result;
  }
  async function scheduleCount(client = pool) {
    const connection = await client.connect();
    try { await connection.query('BEGIN'); await enter(connection); const count = (await connection.query('SELECT count(*)::integer count FROM public.canonical_automation_action_schedules_v1')).rows[0].count; await connection.query('COMMIT'); return count; }
    finally { await connection.query('ROLLBACK').catch(() => {}); connection.release(); }
  }
  async function tenantQuery(text, values = []) {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN'); await enter(connection);
      const result = await connection.query(text, values); await connection.query('COMMIT'); return result;
    } finally { await connection.query('ROLLBACK').catch(() => {}); connection.release(); }
  }
  async function seedAction(suffix) {
    const request = actionRequest(suffix); const unit = request.actionUnits[0];
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await enter(client);
      await client.query(`INSERT INTO public.canonical_automation_action_transactions_v1
       (organization_id,transaction_id,run_id,policy_id,policy_version,policy_digest,source_set_digest,decision_digest,
        authorization_digest,currentness_digest,request_digest,unit_count,canonical_text,document,retention_class,
        trusted_clock_contract,recorded_time_zone,recorded_at)
       VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,1,$11::text,$11::jsonb,'decision_history',
        'postgresql_statement_timestamp_v1','UTC',statement_timestamp())`,
      [TENANT, request.transactionId, request.runId, POLICY, POLICY_DIGEST, SOURCE_SET_DIGEST,
        canonical.digest('mission28.accepted-decision-binding.v1\n', request.decisionBinding),
        canonical.digest('mission28.authorization-binding.v1\n', request.authorizationBinding),
        canonical.digest('mission28.currentness-binding.v1\n', request.currentnessBinding), request.requestDigest, canonical.canonicalize(request)]);
      await client.query(`INSERT INTO public.canonical_automation_action_units_v1
       (organization_id,transaction_id,unit_id,run_id,unit_index,action_family_id,action_template_id,action_template_digest,
        recipient_set_digest,channel_id,provider_mode,effect_class,material_digest,idempotency_key_digest,unit_digest,state,recorded_at)
       VALUES($1,$2,$3,$4,0,$5,$6,$7,$8,'in_app_passive','provider_disabled','internal_record_only',$9,$10,$11,
        'committed_unpublished',statement_timestamp())`, [TENANT, request.transactionId, unit.unitId, request.runId,
        unit.actionFamilyId, unit.actionTemplateId, unit.actionTemplateDigest, unit.recipientSetDigest,
        unit.materialDigest, unit.idempotencyKeyDigest, unit.unitDigest]);
      await client.query(`INSERT INTO public.canonical_automation_action_outbox_v1
       (organization_id,outbox_id,transaction_id,unit_id,unit_digest,state,queue_publication_id,queue_published_at,claim_id,lease_expires_at,recorded_at)
       VALUES($1,$2,$3,$4,$5,'committed_unpublished',NULL,NULL,NULL,NULL,statement_timestamp())`,
      [TENANT, unit.outboxId, request.transactionId, unit.unitId, unit.unitDigest]);
      await client.query('COMMIT'); return request;
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p6b-scheduler');
    pool = new Pool({ connectionString: database.connectionString, max: 8 });
    migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p6b-through276-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 276)) fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    const db = require('../../src/db'); await db.runMigrations({ pool, migrationsDirectory: migrations });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO public.organizations(id,name,email) VALUES
       ($1,'Mission 28 Part 6B tenant','m28-part6b@example.test'),($2,'Mission 28 Part 6B other','m28-part6b-other@example.test')`, [TENANT, OTHER]);
      await enter(client);
      const policyDocument = { tenantId: TENANT, policyId: POLICY, version: 1, canonicalDigest: POLICY_DIGEST, previousVersionDigest: null };
      await client.query(`INSERT INTO public.canonical_automation_policy_versions_v1
       (organization_id,policy_id,version,previous_version_digest,canonical_digest,canonical_text,document,expires_at,
        source_origin,conversion_review_id,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
       VALUES($1,$2,1,NULL,$3,$4::text,$4::jsonb,NOW()+INTERVAL '2 years','mission28_native',NULL,'policy_history',
        'postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, POLICY, POLICY_DIGEST, canonical.canonicalize(policyDocument)]);
      await client.query(`INSERT INTO public.canonical_automation_lifecycle_events_v1
       (organization_id,lifecycle_event_id,policy_id,policy_version,lifecycle_sequence,operation,from_state,to_state,
        predecessor_event_id,predecessor_event_digest,idempotency_digest,payload_digest,event_digest,source_set_digest,
        currentness_marker,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
       VALUES($1,$2,$3,1,1,'activate','previewed','active',NULL,NULL,$4,$5,$6,$7,
        'exact_current_not_runtime_revalidated','{}','{}','lifecycle_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`,
      [TENANT, uuid(200), POLICY, hash('lifecycle-idempotency'), hash('lifecycle-payload'), hash('lifecycle-event'), hash('lifecycle-source')]);
      const snapshotDocument = { tenantId: TENANT, snapshotId: SNAPSHOT, triggerId: 'm20.lead_contact_state', sourceClassId: 'mission20_business_contact_preferences', recordIdentityDigest: hash('record-identity'), canonicalDigest: SOURCE_DIGEST, sourceDigest: SOURCE_DIGEST, eventBinding: { eventKind: 'transcript_occurred', eventTime: '2026-10-28T12:00:00.000000Z' }, currentness: { availability: 'available_exact_current', pinsDigest: hash('pins') }, provenance: { kind: 'authenticated_event', provenanceDigest: hash('provenance') }, lineage: { kind: 'original', sequence: 1 }, requestDigest: hash('snapshot-request'), snapshotDigest: SNAPSHOT_DIGEST, observedAt: '2026-10-28T12:00:01.000000Z' };
      await client.query(`INSERT INTO public.canonical_automation_trigger_snapshots_v1
       (organization_id,snapshot_id,trigger_id,source_class_id,record_identity_digest,canonical_digest,source_digest,event_kind,
        event_time,currentness_pins_digest,provenance_kind,provenance_digest,lineage_kind,lineage_sequence,predecessor_snapshot_id,
        predecessor_snapshot_digest,request_digest,snapshot_digest,request_text,canonical_text,document,retention_class,
        trusted_clock_contract,recorded_time_zone,observed_at)
       VALUES($1,$2,'m20.lead_contact_state','mission20_business_contact_preferences',$3,$4,$4,'transcript_occurred',$5,$6,
        'authenticated_event',$7,'original',1,NULL,NULL,$8,$9,$10::text,$10::text,$10::jsonb,'source_snapshot_history',
        'postgresql_statement_timestamp_v1','UTC',$11)`, [TENANT, SNAPSHOT, hash('record-identity'), SOURCE_DIGEST,
        snapshotDocument.eventBinding.eventTime, hash('pins'), hash('provenance'), hash('snapshot-request'), SNAPSHOT_DIGEST,
        canonical.canonicalize(snapshotDocument), snapshotDocument.observedAt]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`CREATE ROLE ${quoteIdentifier(RLS_ROLE)} NOLOGIN`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_action_schedules_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
  }, 300000);

  afterAll(async () => {
    if (pool) { await pool.query(`REVOKE ALL ON public.canonical_automation_action_schedules_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.end(); }
    if (database) await database.cleanup();
    if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('migration 276 is additive, forced-RLS, immutable and grants no runtime schedule execution', async () => {
    expect((await pool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0]).toEqual({ latest: 276, total: 272 });
    expect((await pool.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='canonical_automation_action_schedules_v1'`)).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await pool.query(`SELECT has_function_privilege('public','public.canonical_automation_store_action_schedule_v1(text,jsonb)','EXECUTE') allowed`)).rows[0].allowed).toBe(false);
    expect((await pool.query(`SELECT count(*)::integer count FROM information_schema.routines WHERE routine_schema='public' AND routine_name LIKE 'canonical_automation%claim%'`)).rows[0].count).toBe(0);
  });

  test('stores an ordinary exact schedule, returns exact replay and leaves Part 6A outbox unpublished', async () => {
    const action = await seedAction(1); const value = schedule(action, 1);
    expect(await store(value)).toEqual(expect.objectContaining({ state: 'scheduled_unpublished', replayed: false, scheduleId: value.scheduleId, unitId: value.unitBinding.unitId }));
    expect(await store(copy(value))).toEqual(expect.objectContaining({ replayed: true, requestDigest: value.requestDigest }));
    const row = (await tenantQuery(`SELECT s.state,o.state outbox_state,o.queue_publication_id,o.claim_id FROM public.canonical_automation_action_schedules_v1 s JOIN public.canonical_automation_action_outbox_v1 o USING(organization_id,outbox_id) WHERE s.organization_id=$1 AND s.schedule_id=$2`, [TENANT, value.scheduleId])).rows[0];
    expect(row).toEqual({ state: 'scheduled_unpublished', outbox_state: 'committed_unpublished', queue_publication_id: null, claim_id: null });
  }, 120000);

  test.each([['earlier', '2026-11-01T05:30:00.000000Z'], ['later', '2026-11-01T06:30:00.000000Z']])('stores explicit DST fold %s evidence', async (foldResolution, instant) => {
    const suffix = foldResolution === 'earlier' ? 2 : 3; const action = await seedAction(suffix); const value = schedule(action, suffix);
    Object.assign(value.localSchedule, { localDate: '2026-11-01', localTime: '01:30:00', utcInstant: instant, foldResolution });
    value.calendarBinding.allowedWeeklyWindows = [{ dayId: 7, startMinuteInclusive: 0, endMinuteExclusive: 1440 }]; value.calendarBinding.quietWeeklyWindows = []; value.expirationBinding.expiresAt = '2026-11-02T12:00:00.000000Z'; reseal(value);
    await expect(store(value)).resolves.toEqual(expect.objectContaining({ replayed: false }));
  }, 120000);

  test.each([
    ['DST gap', 10, value => { Object.assign(value.localSchedule, { localDate: '2027-03-14', localTime: '02:30:00', utcInstant: '2027-03-14T07:30:00.000000Z' }); value.calendarBinding.allowedWeeklyWindows = [{ dayId: 7, startMinuteInclusive: 0, endMinuteExclusive: 1440 }]; value.calendarBinding.quietWeeklyWindows = []; value.expirationBinding.expiresAt = '2027-03-15T12:00:00.000000Z'; }],
    ['fold ambiguity', 11, value => { Object.assign(value.localSchedule, { localDate: '2026-11-01', localTime: '01:30:00', utcInstant: '2026-11-01T05:30:00.000000Z', foldResolution: 'not_ambiguous' }); value.calendarBinding.allowedWeeklyWindows = [{ dayId: 7, startMinuteInclusive: 0, endMinuteExclusive: 1440 }]; value.calendarBinding.quietWeeklyWindows = []; value.expirationBinding.expiresAt = '2026-11-02T12:00:00.000000Z'; }],
    ['wrong fold instant', 12, value => { Object.assign(value.localSchedule, { localDate: '2026-11-01', localTime: '01:30:00', utcInstant: '2026-11-01T06:30:00.000000Z', foldResolution: 'earlier' }); value.calendarBinding.allowedWeeklyWindows = [{ dayId: 7, startMinuteInclusive: 0, endMinuteExclusive: 1440 }]; value.calendarBinding.quietWeeklyWindows = []; value.expirationBinding.expiresAt = '2026-11-02T12:00:00.000000Z'; }],
  ])('rejects %s with zero schedule residue', async (_label, suffix, mutate) => {
    const action = await seedAction(suffix); const value = schedule(action, suffix); mutate(value); reseal(value); const before = await scheduleCount(); await expect(store(value)).rejects.toThrow(); expect(await scheduleCount()).toBe(before);
  }, 120000);

  test.each([
    ['closed time', 210, value => { value.localSchedule.localTime = '08:00:00'; value.localSchedule.utcInstant = '2027-01-07T13:00:00.000000Z'; }],
    ['quiet time', 211, value => { value.localSchedule.localTime = '12:30:00'; value.localSchedule.utcInstant = '2027-01-07T17:30:00.000000Z'; }],
    ['holiday', 212, value => { value.calendarBinding.holidayDates = ['2027-01-07']; }],
    ['overlap', 213, value => { value.calendarBinding.allowedWeeklyWindows = [{ dayId: 4, startMinuteInclusive: 500, endMinuteExclusive: 700 }, { dayId: 4, startMinuteInclusive: 600, endMinuteExclusive: 800 }]; }],
    ['alias zone', 214, value => { value.localSchedule.tenantTimeZone = 'US/Eastern'; value.calendarBinding.tenantTimeZone = 'US/Eastern'; }],
  ])('rejects %s calendar/time-zone material without residue', async (_label, suffix, mutate) => {
    const action = await seedAction(suffix); const value = schedule(action, suffix); mutate(value); reseal(value); const before = await scheduleCount(); await expect(store(value)).rejects.toThrow(); expect(await scheduleCount()).toBe(before);
  }, 120000);

  test('rejects trusted resolution, Part 6A identity and expiration substitution', async () => {
    const action = await seedAction(400); const value = schedule(action, 400); const before = await scheduleCount();
    const resolution = copy(trusted(value)); resolution.calendarBinding.calendarVersion = 2;
    await expect(store(value, resolution)).rejects.toThrow(/trusted/i);
    const wrong = copy(value); wrong.unitBinding.unitDigest = hash('wrong-unit'); reseal(wrong); await expect(store(wrong, trusted(wrong))).rejects.toThrow();
    const expired = copy(value); expired.scheduleId = uuid(12401); expired.expirationBinding.expiresAt = expired.localSchedule.utcInstant; reseal(expired); await expect(store(expired, trusted(expired))).rejects.toThrow();
    expect(await scheduleCount()).toBe(before);
  }, 120000);

  test('serializes two different schedule IDs for one unit and permits exactly one row', async () => {
    const action = await seedAction(500); const left = schedule(action, 500); const right = copy(left); right.scheduleId = uuid(12501); reseal(right);
    const results = await Promise.allSettled([store(left), store(right)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_action_schedules_v1 WHERE organization_id=$1 AND unit_id=$2', [TENANT, left.unitBinding.unitId])).rows[0].count).toBe(1);
  }, 120000);

  test('forced RLS hides tenant schedules from a nonowner role and immutability rejects updates', async () => {
    const action = await seedAction(600); const value = schedule(action, 600); await store(value);
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE ' + quoteIdentifier(RLS_ROLE)); await client.query("SELECT set_config('northstar.automation_tenant_id',$1,true)", [TENANT]);
      expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_action_schedules_v1')).rows[0].count).toBe(0); await client.query('ROLLBACK');
      await client.query('BEGIN'); await enter(client); await expect(client.query("UPDATE public.canonical_automation_action_schedules_v1 SET state='scheduled_unpublished' WHERE schedule_id=$1", [value.scheduleId])).rejects.toThrow(); await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }, 120000);
});
