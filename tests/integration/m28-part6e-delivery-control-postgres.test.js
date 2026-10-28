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
const ACTOR = '00000000-0000-4000-8000-000000000010';
const SESSION = '00000000-0000-4000-8000-000000000011';
const POLICY = '00000000-0000-4000-8000-000000000100';
const EMPTY_POLICY = '00000000-0000-4000-8000-000000000101';
const SUCCESSOR = '00000000-0000-4000-8000-000000000102';
const REVOKE_POLICY = '00000000-0000-4000-8000-000000000103';
const RESUME_RACE_POLICY = '00000000-0000-4000-8000-000000000104';
const RETRY_RACE_POLICY = '00000000-0000-4000-8000-000000000105';
const SCHEDULE_RACE_POLICY = '00000000-0000-4000-8000-000000000106';
const CLAIM_RACE_POLICY = '00000000-0000-4000-8000-000000000107';
const DECISION_RACE_POLICY = '00000000-0000-4000-8000-000000000108';
const SNAPSHOT = '00000000-0000-4000-8000-000000000300';
const POLICY_DIGEST = `sha256:${'1'.repeat(64)}`;
const EMPTY_POLICY_DIGEST = `sha256:${'5'.repeat(64)}`;
const SUCCESSOR_DIGEST = `sha256:${'6'.repeat(64)}`;
const REVOKE_POLICY_DIGEST = `sha256:${'7'.repeat(64)}`;
const RESUME_RACE_POLICY_DIGEST = `sha256:${'8'.repeat(64)}`;
const RETRY_RACE_POLICY_DIGEST = `sha256:${'9'.repeat(64)}`;
const SCHEDULE_RACE_POLICY_DIGEST = `sha256:${'a'.repeat(64)}`;
const CLAIM_RACE_POLICY_DIGEST = `sha256:${'b'.repeat(64)}`;
const DECISION_RACE_POLICY_DIGEST = `sha256:${'c'.repeat(64)}`;
const SNAPSHOT_DIGEST = `sha256:${'2'.repeat(64)}`;
const SOURCE_DIGEST = `sha256:${'3'.repeat(64)}`;
const SOURCE_SET_DIGEST = `sha256:${'4'.repeat(64)}`;
const RLS_ROLE = `m28_part6e_rls_${process.pid}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;

function resealLease(value) {
  value.workerBinding.workerIdentityDigest = canonical.digest('mission28.delivery-worker.v1\n', Object.fromEntries(Object.entries(value.workerBinding).filter(([key]) => key !== 'workerIdentityDigest')));
  value.requestDigest = canonical.digest('mission28.delivery-lease.request.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
function leaseRequest(action, suffix, expectedPriorFenceToken = 0, durationSeconds = 300) {
  return resealLease({ schemaVersion: 'mission28.delivery-lease.request.v1', tenantId: TENANT, leaseRequestId: uuid(500000 + suffix),
    scheduleBinding: { scheduleId: action.scheduleId, transactionId: action.transactionId, runId: action.runId, unitId: action.unitId, outboxId: action.outboxId, unitDigest: action.unitDigest, scheduleBindingDigest: action.scheduleBindingDigest },
    workerBinding: { workerId: uuid(510000 + suffix), processId: uuid(520000 + suffix), deploymentId: uuid(530000 + suffix), regionId: 'us-east-1', workerIdentityDigest: '' },
    leaseBinding: { leaseId: uuid(540000 + suffix), expectedPriorFenceToken, durationSeconds }, requestDigest: '' });
}
const trustedLease = value => ({ tenantId: value.tenantId, scheduleBinding: value.scheduleBinding, workerBinding: value.workerBinding });
function resealRetry(value) {
  value.attemptObservation.observationDigest = canonical.digest('mission28.delivery-attempt-observation.v1\n', Object.fromEntries(Object.entries(value.attemptObservation).filter(([key]) => key !== 'observationDigest')));
  value.retryPolicy.retryPolicyDigest = canonical.digest('mission28.delivery-retry-policy.v1\n', Object.fromEntries(Object.entries(value.retryPolicy).filter(([key]) => key !== 'retryPolicyDigest')));
  value.requestDigest = canonical.digest('mission28.delivery-retry-decision.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
const trustedRetry = value => { const result = copy(value); delete result.schemaVersion; delete result.decisionId; delete result.requestDigest; return result; };
function retryDecision(prepared, suffix, observationKind, attemptCeiling = 1) {
  return resealRetry({ schemaVersion: 'mission28.delivery-retry-decision.v1', tenantId: TENANT, decisionId: uuid(600000 + suffix), decisionKind: 'classify_attempt',
    actionBinding: { scheduleId: prepared.action.scheduleId, transactionId: prepared.action.transactionId, runId: prepared.action.runId, unitId: prepared.action.unitId, outboxId: prepared.action.outboxId, receiptId: prepared.receipt.receiptId, unitDigest: prepared.action.unitDigest, providerRequestIdentity: prepared.receipt.providerRequestIdentity, providerRequestDigest: prepared.receipt.providerRequestDigest, idempotencyReceiptDigest: prepared.receipt.idempotencyReceiptDigest },
    leaseBinding: { leaseId: prepared.lease.leaseId, fenceToken: prepared.lease.fenceToken },
    retryPolicy: { attemptCeiling, baseDelaySeconds: 1, maximumDelaySeconds: 4, maximumRetryAfterSeconds: 4, maximumJitterSeconds: 0, retryPolicyDigest: '' },
    attemptObservation: { observationId: uuid(610000 + suffix), observationKind, observationDigest: hash(`observation-${suffix}`), attemptOrdinal: 1, attemptLeaseId: prepared.lease.leaseId, attemptFenceToken: prepared.lease.fenceToken, occurredAt: prepared.now, retryAfterSeconds: null, providerTimeoutSeconds: observationKind.includes('uncertain') ? 30 : null },
    reconciliation: { state: 'not_performed', evidenceId: null, evidenceDigest: null, observedAt: null }, requestDigest: '' });
}
function resealControl(value) {
  value.requestDigest = canonical.digest('mission28.delivery-control-decision.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
const trustedControl = value => { const result = copy(value); delete result.schemaVersion; delete result.controlId; delete result.requestDigest; return result; };
function emptyTarget(targetKind) {
  return { targetKind, policyId: null, policyVersion: null, policyDigest: null, scheduleId: null, transactionId: null, runId: null, unitId: null, outboxId: null, receiptId: null, unitDigest: null, providerRequestIdentity: null, providerRequestDigest: null };
}
function control(operation, targetKind, suffix, requestedAt, options = {}) {
  const targetBinding = emptyTarget(targetKind);
  const policyId = options.policyId || POLICY; const policyDigest = options.policyDigest || POLICY_DIGEST;
  if (targetKind !== 'tenant') Object.assign(targetBinding, { policyId, policyVersion: 1, policyDigest });
  if (targetKind === 'action_schedule') Object.assign(targetBinding, {
    scheduleId: options.prepared.action.scheduleId, transactionId: options.prepared.action.transactionId, runId: options.prepared.action.runId,
    unitId: options.prepared.action.unitId, outboxId: options.prepared.action.outboxId, receiptId: options.prepared.receipt.receiptId,
    unitDigest: options.prepared.action.unitDigest, providerRequestIdentity: options.prepared.receipt.providerRequestIdentity,
    providerRequestDigest: options.prepared.receipt.providerRequestDigest,
  });
  const reviewed = ['dead_letter_action', 'owner_reviewed_retry'].includes(operation);
  const result = { schemaVersion: 'mission28.delivery-control-decision.v1', tenantId: TENANT, controlId: uuid(700000 + suffix), operation, targetBinding,
    actorBinding: { actorId: ACTOR, sessionId: SESSION, membershipId: ACTOR, membershipRole: 'owner', requestedAt },
    successorBinding: operation === 'supersede_policy' ? { policyId: SUCCESSOR, policyVersion: 1, policyDigest: SUCCESSOR_DIGEST } : { policyId: null, policyVersion: null, policyDigest: null },
    reviewBinding: reviewed ? { reviewId: uuid(710000 + suffix), reviewDigest: hash(`review-${suffix}`), reviewOutcome: operation === 'owner_reviewed_retry' ? 'new_action_required_no_reuse' : options.reviewOutcome || 'no_effect_terminal', reviewedAt: requestedAt }
      : { reviewId: null, reviewDigest: null, reviewOutcome: null, reviewedAt: null }, requestDigest: '' };
  return resealControl(result);
}

realPostgres('Mission 28 Part 6E PostgreSQL delivery controls through migration 279', () => {
  let database; let pool; let migrations; let bulkPending;
  async function enter(client, tenant = TENANT) { await client.query('SELECT public.canonical_automation_enter_tenant_v1($1)', [tenant]); }
  async function tenantQuery(text, values = [], tenant = TENANT) {
    const client = await pool.connect(); try { await client.query('BEGIN'); await enter(client, tenant); const result = await client.query(text, values); await client.query('COMMIT'); return result; }
    finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }
  async function now() { return (await pool.query('SELECT public.canonical_automation_utc_v1(clock_timestamp()) value')).rows[0].value; }
  async function claim(value, client = pool) { return (await client.query('SELECT public.canonical_automation_claim_scheduled_action_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trustedLease(value))])).rows[0].result; }
  async function reserve(value, lease, client = pool) { return (await client.query('SELECT public.canonical_automation_reserve_provider_request_identity_v1($1,$2,$3,$4) result', [TENANT, value.scheduleBinding.scheduleId, lease.leaseId, lease.fenceToken])).rows[0].result; }
  async function decide(value, client = pool) { return (await client.query('SELECT public.canonical_automation_record_retry_decision_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trustedRetry(value))])).rows[0].result; }
  async function applyControl(value, resolution = trustedControl(value), client = pool) { return (await client.query('SELECT public.canonical_automation_record_delivery_control_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(resolution)])).rows[0].result; }

  async function seedAction(suffix, policyId = POLICY, policyDigest = POLICY_DIGEST, expiresInSeconds = 25920000, source = {}, existingClient = null) {
    const transactionId = uuid(10000 + suffix); const runId = uuid(11000 + suffix); const unitId = uuid(12000 + suffix); const outboxId = uuid(13000 + suffix); const scheduleId = uuid(14000 + suffix);
    const unitDigest = hash(`unit-${suffix}`); const scheduleBindingDigest = hash(`schedule-${suffix}`);
    const snapshotId = source.snapshotId || SNAPSHOT; const snapshotDigest = source.snapshotDigest || SNAPSHOT_DIGEST;
    const sourceSetDigest = source.sourceSetDigest || SOURCE_SET_DIGEST;
    const clock = (await pool.query(`SELECT public.canonical_automation_utc_v1(statement_timestamp()-INTERVAL '1 minute') due_at,public.canonical_automation_utc_v1(statement_timestamp()+make_interval(secs=>$1::integer)) expires_at`, [expiresInSeconds])).rows[0];
    const transaction = { tenantId: TENANT, transactionId, runId, policyBinding: { policyId, policyVersion: 1, policyDigest }, sourceBinding: { sourceSetDigest, snapshotIds: [snapshotId], snapshotDigests: [snapshotDigest] }, actionUnits: [{ unitId }], requestDigest: hash(`transaction-${suffix}`) };
    const schedule = { tenantId: TENANT, scheduleId, transactionId, runId, unitBinding: { unitId, outboxId, unitDigest }, policyBinding: { policyId, policyVersion: 1, policyDigest }, sourceBinding: { sourceSetDigest }, localSchedule: { tenantTimeZone: 'UTC', localDate: clock.due_at.slice(0, 10), localTime: clock.due_at.slice(11, 19), utcInstant: clock.due_at, foldResolution: 'not_ambiguous' }, calendarBinding: { calendarId: uuid(15000 + suffix), calendarVersion: 1, calendarDigest: hash(`calendar-${suffix}`), calendarState: 'exact_current', tenantTimeZone: 'UTC' }, expirationBinding: { expiresAt: clock.expires_at }, trustedClockBinding: { contract: 'postgresql_statement_timestamp_v1' }, scheduleBindingDigest, requestDigest: hash(`schedule-request-${suffix}`) };
    const client = existingClient || await pool.connect(); const ownsTransaction = !existingClient; try {
      if (ownsTransaction) { await client.query('BEGIN'); await enter(client); }
      await client.query(`INSERT INTO public.canonical_automation_action_transactions_v1 (organization_id,transaction_id,run_id,policy_id,policy_version,policy_digest,source_set_digest,decision_digest,authorization_digest,currentness_digest,request_digest,unit_count,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,1,$11::text,$11::jsonb,'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, transactionId, runId, policyId, policyDigest, sourceSetDigest, hash(`decision-${suffix}`), hash(`authorization-${suffix}`), hash(`currentness-${suffix}`), transaction.requestDigest, canonical.canonicalize(transaction)]);
      await client.query(`INSERT INTO public.canonical_automation_action_units_v1 (organization_id,transaction_id,unit_id,run_id,unit_index,action_family_id,action_template_id,action_template_digest,recipient_set_digest,channel_id,provider_mode,effect_class,material_digest,idempotency_key_digest,unit_digest,state,recorded_at) VALUES($1,$2,$3,$4,0,'internal_read_digest_task','internal_fact_digest_v1',$5,$6,'in_app_passive','provider_disabled','internal_record_only',$7,$8,$9,'committed_unpublished',statement_timestamp())`, [TENANT, transactionId, unitId, runId, hash(`template-${suffix}`), hash(`recipient-${suffix}`), hash(`material-${suffix}`), hash(`idempotency-${suffix}`), unitDigest]);
      await client.query(`INSERT INTO public.canonical_automation_action_outbox_v1 (organization_id,outbox_id,transaction_id,unit_id,unit_digest,state,recorded_at) VALUES($1,$2,$3,$4,$5,'committed_unpublished',statement_timestamp())`, [TENANT, outboxId, transactionId, unitId, unitDigest]);
      await client.query(`INSERT INTO public.canonical_automation_action_schedules_v1 (organization_id,schedule_id,transaction_id,run_id,unit_id,outbox_id,unit_digest,policy_id,policy_version,policy_digest,source_set_digest,tenant_time_zone,local_date,local_time,utc_instant,fold_resolution,calendar_id,calendar_version,calendar_digest,schedule_binding_digest,expires_at,request_digest,state,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,'UTC',$11::date,$12::time,$13::timestamptz,'not_ambiguous',$14,1,$15,$16,$17::timestamptz,$18,'scheduled_unpublished',$19::text,$19::jsonb,'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, scheduleId, transactionId, runId, unitId, outboxId, unitDigest, policyId, policyDigest, sourceSetDigest, schedule.localSchedule.localDate, schedule.localSchedule.localTime, clock.due_at, schedule.calendarBinding.calendarId, schedule.calendarBinding.calendarDigest, scheduleBindingDigest, clock.expires_at, schedule.requestDigest, canonical.canonicalize(schedule)]);
      if (ownsTransaction) await client.query('COMMIT'); return { scheduleId, transactionId, runId, unitId, outboxId, unitDigest, scheduleBindingDigest };
    } finally { if (ownsTransaction) { await client.query('ROLLBACK').catch(() => {}); client.release(); } }
  }
  async function prepare(suffix, durationSeconds = 300, expiresInSeconds = 25920000, policyId = POLICY, policyDigest = POLICY_DIGEST, source = {}) {
    const action = await seedAction(suffix, policyId, policyDigest, expiresInSeconds, source); const request = leaseRequest(action, suffix, 0, durationSeconds); const lease = await claim(request); const receipt = await reserve(request, lease); return { action, request, lease, receipt, now: await now() };
  }

  async function seedPolicy(policyId, digest, lifecycleSuffix) {
    const document = { tenantId: TENANT, policyId, version: 1, canonicalDigest: digest, previousVersionDigest: null };
    await tenantQuery(`INSERT INTO public.canonical_automation_policy_versions_v1 (organization_id,policy_id,version,previous_version_digest,canonical_digest,canonical_text,document,expires_at,source_origin,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at) VALUES($1,$2,1,NULL,$3,$4::text,$4::jsonb,NOW()+INTERVAL '2 years','mission28_native','policy_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, policyId, digest, canonical.canonicalize(document)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_lifecycle_events_v1 (organization_id,lifecycle_event_id,policy_id,policy_version,lifecycle_sequence,operation,from_state,to_state,idempotency_digest,payload_digest,event_digest,source_set_digest,currentness_marker,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at) VALUES($1,$2,$3,1,1,'activate','previewed','active',$4,$5,$6,$7,'exact_current_not_runtime_revalidated','{}','{}','lifecycle_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, uuid(lifecycleSuffix), policyId, hash(`life-id-${lifecycleSuffix}`), hash(`life-payload-${lifecycleSuffix}`), hash(`life-event-${lifecycleSuffix}`), hash(`life-source-${lifecycleSuffix}`)]);
  }

  async function waitForLockWait(pids, minimum = pids.length) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const result = await pool.query(`SELECT count(*)::integer count FROM pg_stat_activity WHERE pid=ANY($1::integer[]) AND wait_event_type='Lock'`, [pids]);
      if (result.rows[0].count >= minimum) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`expected ${minimum} blocked PostgreSQL operation(s)`);
  }

  async function appendSnapshotCorrection(client, sequence, predecessorSnapshotId, predecessorSnapshotDigest) {
    const snapshotId = uuid(300 + sequence - 1); const snapshotDigest = hash(`snapshot-digest-${sequence}`);
    const sourceDigest = hash(`source-digest-${sequence}`); const sourceSetDigest = hash(`source-set-${sequence}`);
    const requestDigest = hash(`snapshot-request-${sequence}`);
    const document = { tenantId: TENANT, snapshotId, triggerId: 'm20.lead_contact_state', sourceClassId: 'mission20_business_contact_preferences', recordIdentityDigest: hash('record-identity'), canonicalDigest: sourceDigest, sourceDigest,
      eventBinding: { eventKind: 'transcript_occurred', eventTime: `2026-10-28T12:00:0${sequence}.000000Z` }, currentness: { availability: 'available_exact_current', pinsDigest: hash(`pins-${sequence}`) },
      provenance: { kind: 'authenticated_event', provenanceDigest: hash(`provenance-${sequence}`) }, lineage: { kind: 'correction', sequence, predecessorSnapshotId, predecessorSnapshotDigest },
      requestDigest, snapshotDigest, observedAt: `2026-10-28T12:00:1${sequence}.000000Z` };
    const canonicalText = canonical.canonicalize(document);
    await client.query(`INSERT INTO public.canonical_automation_trigger_snapshots_v1
      (organization_id,snapshot_id,trigger_id,source_class_id,record_identity_digest,canonical_digest,source_digest,event_kind,event_time,
       currentness_pins_digest,provenance_kind,provenance_digest,lineage_kind,lineage_sequence,predecessor_snapshot_id,
       predecessor_snapshot_digest,request_digest,snapshot_digest,request_text,canonical_text,document,retention_class,
       trusted_clock_contract,recorded_time_zone,observed_at)
      VALUES($1,$2,'m20.lead_contact_state','mission20_business_contact_preferences',$3,$4,$4,'transcript_occurred',$5::timestamptz,
       $6,'authenticated_event',$7,'correction',$8,$9,$10,$11,$12,$13::text,$13::text,$13::jsonb,'source_snapshot_history',
       'postgresql_statement_timestamp_v1','UTC',$14::timestamptz)`, [TENANT, snapshotId, hash('record-identity'), sourceDigest,
      document.eventBinding.eventTime, document.currentness.pinsDigest, document.provenance.provenanceDigest, sequence,
      predecessorSnapshotId, predecessorSnapshotDigest, requestDigest, snapshotDigest, canonicalText, document.observedAt]);
    return { snapshotId, snapshotDigest, sourceSetDigest };
  }

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p6e-controls'); pool = new Pool({ connectionString: database.connectionString, max: 8 });
    migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p6e-through279-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 279)) fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    const db = require('../../src/db'); await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`INSERT INTO public.organizations(id,name,email) VALUES($1,'Part 6E tenant','part6e@example.test'),($2,'Part 6E other','part6e-other@example.test')`, [TENANT, OTHER]);
    await pool.query(`INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status) VALUES($1,$2,'Part 6E owner','part6e-owner@example.test','unused','owner','active')`, [ACTOR, TENANT]);
    await pool.query(`INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$2,$1,'owner','active')`, [ACTOR, TENANT]);
    await pool.query(`INSERT INTO public.auth_sessions(id,user_id,organization_id,membership_id,status,access_expires_at,refresh_expires_at,csrf_token_hash) VALUES($1,$2,$3,$2,'active',NOW()+INTERVAL '1 hour',NOW()+INTERVAL '2 hours',$4)`, [SESSION, ACTOR, TENANT, '1'.repeat(64)]);
    await seedPolicy(POLICY, POLICY_DIGEST, 200); await seedPolicy(EMPTY_POLICY, EMPTY_POLICY_DIGEST, 201); await seedPolicy(SUCCESSOR, SUCCESSOR_DIGEST, 202); await seedPolicy(REVOKE_POLICY, REVOKE_POLICY_DIGEST, 203);
    await seedPolicy(RESUME_RACE_POLICY, RESUME_RACE_POLICY_DIGEST, 204); await seedPolicy(RETRY_RACE_POLICY, RETRY_RACE_POLICY_DIGEST, 205);
    await seedPolicy(SCHEDULE_RACE_POLICY, SCHEDULE_RACE_POLICY_DIGEST, 206); await seedPolicy(CLAIM_RACE_POLICY, CLAIM_RACE_POLICY_DIGEST, 207); await seedPolicy(DECISION_RACE_POLICY, DECISION_RACE_POLICY_DIGEST, 208);
    const snapshotDocument = { tenantId: TENANT, snapshotId: SNAPSHOT, triggerId: 'm20.lead_contact_state', sourceClassId: 'mission20_business_contact_preferences', recordIdentityDigest: hash('record-identity'), canonicalDigest: SOURCE_DIGEST, sourceDigest: SOURCE_DIGEST, eventBinding: { eventKind: 'transcript_occurred', eventTime: '2026-10-28T12:00:00.000000Z' }, currentness: { availability: 'available_exact_current', pinsDigest: hash('pins') }, provenance: { kind: 'authenticated_event', provenanceDigest: hash('provenance') }, lineage: { kind: 'original', sequence: 1 }, requestDigest: hash('snapshot-request'), snapshotDigest: SNAPSHOT_DIGEST, observedAt: '2026-10-28T12:00:01.000000Z' };
    await tenantQuery(`INSERT INTO public.canonical_automation_trigger_snapshots_v1 (organization_id,snapshot_id,trigger_id,source_class_id,record_identity_digest,canonical_digest,source_digest,event_kind,event_time,currentness_pins_digest,provenance_kind,provenance_digest,lineage_kind,lineage_sequence,request_digest,snapshot_digest,request_text,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,observed_at) VALUES($1,$2,'m20.lead_contact_state','mission20_business_contact_preferences',$3,$4,$4,'transcript_occurred','2026-10-28T12:00:00Z',$5,'authenticated_event',$6,'original',1,$7,$8,$9::text,$9::text,$9::jsonb,'source_snapshot_history','postgresql_statement_timestamp_v1','UTC','2026-10-28T12:00:01Z')`, [TENANT, SNAPSHOT, hash('record-identity'), SOURCE_DIGEST, hash('pins'), hash('provenance'), hash('snapshot-request'), SNAPSHOT_DIGEST, canonical.canonicalize(snapshotDocument)]);
    await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`CREATE ROLE ${quoteIdentifier(RLS_ROLE)} NOLOGIN`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_delivery_control_heads_v1,public.canonical_automation_delivery_control_events_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
  }, 300000);

  afterAll(async () => {
    if (pool) { await pool.query(`REVOKE ALL ON public.canonical_automation_delivery_control_heads_v1,public.canonical_automation_delivery_control_events_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.end(); }
    if (database) await database.cleanup(); if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('migration 279 is additive, owner-only, forced-RLS and has no runtime grant', async () => {
    expect((await pool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0]).toEqual({ latest: 279, total: 275 });
    const rows = (await pool.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname`, [['canonical_automation_delivery_control_events_v1','canonical_automation_delivery_control_heads_v1']])).rows;
    expect(rows).toHaveLength(2); expect(rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect((await pool.query(`SELECT has_function_privilege('public','public.canonical_automation_record_delivery_control_v1(text,jsonb)','EXECUTE') allowed`)).rows[0].allowed).toBe(false);
  });

  test('cancels only queued exact actions, replays historically and blocks later claims without upstream mutation', async () => {
    const prepared = await prepare(1, 5); await new Promise(resolve => setTimeout(resolve, 5250)); const value = control('cancel_action', 'action_schedule', 1, await now(), { prepared });
    const first = await applyControl(value); expect(first).toEqual(expect.objectContaining({ state: 'cancelled_terminal', executionPhase: 'queued', replayed: false }));
    expect(await applyControl(copy(value))).toEqual(expect.objectContaining({ state: 'cancelled_terminal', decisionDigest: first.decisionDigest, replayed: true }));
    await expect(claim(leaseRequest(prepared.action, 1001, 1))).rejects.toThrow(/control/i);
    const upstream = (await tenantQuery(`SELECT u.state unit_state,o.state outbox_state,s.state schedule_state,r.state receipt_state FROM public.canonical_automation_action_units_v1 u JOIN public.canonical_automation_action_outbox_v1 o USING(organization_id,unit_id) JOIN public.canonical_automation_action_schedules_v1 s USING(organization_id,outbox_id) JOIN public.canonical_automation_provider_request_receipts_v1 r USING(organization_id,schedule_id) WHERE u.organization_id=$1 AND u.unit_id=$2`, [TENANT, prepared.action.unitId])).rows[0];
    expect(upstream).toEqual({ unit_state: 'committed_unpublished', outbox_state: 'committed_unpublished', schedule_state: 'scheduled_unpublished', receipt_state: 'identity_reserved_no_provider_attempt_or_ack' });
  }, 120000);

  test('pause, drain and resume serialize exact policy authority and guard new schedules', async () => {
    const pause = control('pause_scope', 'policy_version', 10, await now(), { policyId: EMPTY_POLICY, policyDigest: EMPTY_POLICY_DIGEST });
    expect((await applyControl(pause)).state).toBe('paused');
    await expect(seedAction(10, EMPTY_POLICY, EMPTY_POLICY_DIGEST)).rejects.toThrow(/control/i);
    const drain = control('drain_scope', 'policy_version', 11, await now(), { policyId: EMPTY_POLICY, policyDigest: EMPTY_POLICY_DIGEST });
    expect((await applyControl(drain)).state).toBe('drained');
    const resume = control('resume_scope', 'policy_version', 12, await now(), { policyId: EMPTY_POLICY, policyDigest: EMPTY_POLICY_DIGEST });
    expect((await applyControl(resume)).state).toBe('active_resumed');
    expect((await seedAction(11, EMPTY_POLICY, EMPTY_POLICY_DIGEST)).scheduleId).toMatch(/^[0-9a-f-]{36}$/);
    const concurrent = await Promise.all([
      applyControl(control('pause_scope', 'policy_version', 13, await now(), { policyId: EMPTY_POLICY, policyDigest: EMPTY_POLICY_DIGEST })),
      applyControl(control('drain_scope', 'policy_version', 14, await now(), { policyId: EMPTY_POLICY, policyDigest: EMPTY_POLICY_DIGEST })),
    ]);
    expect(concurrent.map(item => item.controlSequence).sort((a, b) => a - b)).toEqual([4, 5]);
    expect(new Set(concurrent.map(item => item.state))).toEqual(new Set(['paused', 'drained']));
  }, 120000);

  test('schedule, claim and retry serialize lifecycle before reducing controls without a lock cycle', async () => {
    async function runRace(policyId, policyDigest, suffix, operation) {
      let action; let prepared; let request; let operationResult;
      if (operation === 'claim') { action = await seedAction(suffix, policyId, policyDigest); request = leaseRequest(action, suffix); }
      if (operation === 'retry') { prepared = await prepare(suffix, 300, 25920000, policyId, policyDigest); request = retryDecision(prepared, suffix, 'provider_retryable_definite_no_acceptance', 3); }
      const legacyClient = await pool.connect(); const controlClient = await pool.connect();
      try {
        await legacyClient.query('BEGIN'); await enter(legacyClient);
        await legacyClient.query("SET LOCAL deadlock_timeout='100ms'; SET LOCAL statement_timeout='10s'");
        await legacyClient.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${TENANT}:m28-lifecycle-policy:${policyId}`]);
        const pid = (await controlClient.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        await controlClient.query("SET statement_timeout='10s'");
        const reducing = control('pause_scope', 'policy_version', 720000 + suffix, await now(), { policyId, policyDigest });
        const controlPromise = applyControl(reducing, trustedControl(reducing), controlClient).then(value => ({ value }), error => ({ error }));
        await waitForLockWait([pid]);
        if (operation === 'schedule') operationResult = await seedAction(suffix, policyId, policyDigest, 25920000, {}, legacyClient);
        else if (operation === 'claim') operationResult = await claim(request, legacyClient);
        else operationResult = await decide(request, legacyClient);
        await legacyClient.query('COMMIT');
        const controlResult = await controlPromise;
        if (controlResult.error) throw controlResult.error;
        expect(controlResult.value).toEqual(expect.objectContaining({ state: 'paused', replayed: false }));
        return operationResult;
      } finally {
        await legacyClient.query('ROLLBACK').catch(() => {}); legacyClient.release();
        await controlClient.query('RESET statement_timeout').catch(() => {}); controlClient.release();
      }
    }
    expect((await runRace(SCHEDULE_RACE_POLICY, SCHEDULE_RACE_POLICY_DIGEST, 70, 'schedule')).scheduleId).toBe(uuid(14070));
    expect((await runRace(CLAIM_RACE_POLICY, CLAIM_RACE_POLICY_DIGEST, 71, 'claim')).state).toBe('lease_acquired_no_effect');
    expect((await runRace(DECISION_RACE_POLICY, DECISION_RACE_POLICY_DIGEST, 72, 'retry')).state).toBe('retry_scheduled_no_effect');
  }, 120000);

  test('expires only an exact queued action after trusted expiry and terminally revokes an exact policy', async () => {
    const prepared = await prepare(50, 5, 6);
    await expect(applyControl(control('expire_action', 'action_schedule', 50, await now(), { prepared }))).rejects.toThrow(/phase|expired/i);
    await new Promise(resolve => setTimeout(resolve, 6250));
    expect((await applyControl(control('expire_action', 'action_schedule', 51, await now(), { prepared }))).state).toBe('expired_terminal');
    const revoke = control('revoke_policy', 'policy_version', 52, await now(), { policyId: REVOKE_POLICY, policyDigest: REVOKE_POLICY_DIGEST });
    const revoked = await applyControl(revoke); expect(revoked.state).toBe('revoked_terminal');
    expect(await applyControl(copy(revoke))).toEqual(expect.objectContaining({ state: 'revoked_terminal', decisionDigest: revoked.decisionDigest, replayed: true }));
    await expect(seedAction(52, REVOKE_POLICY, REVOKE_POLICY_DIGEST)).rejects.toThrow(/control/i);
  }, 120000);

  test('terminal policy controls remain terminal and exact active successor is required', async () => {
    const supersede = control('supersede_policy', 'policy_version', 20, await now(), { policyId: EMPTY_POLICY, policyDigest: EMPTY_POLICY_DIGEST });
    expect((await applyControl(supersede)).state).toBe('superseded_terminal');
    await expect(applyControl(control('resume_scope', 'policy_version', 21, await now(), { policyId: EMPTY_POLICY, policyDigest: EMPTY_POLICY_DIGEST }))).rejects.toThrow(/resum|terminal/i);
    const bulk = control('bulk_stop', 'policy_version', 22, await now(), { policyId: SUCCESSOR, policyDigest: SUCCESSOR_DIGEST }); expect((await applyControl(bulk)).state).toBe('bulk_stopped_terminal');
    await expect(seedAction(22, SUCCESSOR, SUCCESSOR_DIGEST)).rejects.toThrow(/control/i);
  }, 120000);

  test('dead-letter preserves no-effect versus unresolved evidence and reviewed retry requires a new action identity', async () => {
    const prepared = await prepare(30, 5); const stop = retryDecision(prepared, 30, 'provider_retryable_definite_no_acceptance', 1); expect((await decide(stop)).state).toBe('permanent_stop_attempt_ceiling');
    const dead = control('dead_letter_action', 'action_schedule', 30, await now(), { prepared }); expect((await applyControl(dead)).state).toBe('dead_lettered_terminal');
    const review = control('owner_reviewed_retry', 'action_schedule', 31, await now(), { prepared }); expect((await applyControl(review)).state).toBe('reviewed_retry_new_action_required');
    await new Promise(resolve => setTimeout(resolve, 5250));
    await expect(claim(leaseRequest(prepared.action, 3030, 1))).rejects.toThrow(/control/i);
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_provider_request_receipts_v1 WHERE organization_id=$1 AND schedule_id=$2', [TENANT, prepared.action.scheduleId])).rows[0].count).toBe(1);
    const uncertain = await prepare(32); const uncertainDecision = retryDecision(uncertain, 32, 'provider_timeout_uncertain', 3);
    expect((await decide(uncertainDecision)).state).toBe('reconciliation_required_no_resend');
    const unresolved = control('dead_letter_action', 'action_schedule', 32, await now(), { prepared: uncertain, reviewOutcome: 'effect_or_unknown_unresolved' });
    expect((await applyControl(unresolved)).state).toBe('dead_lettered_terminal');
    await expect(applyControl(control('owner_reviewed_retry', 'action_schedule', 33, await now(), { prepared: uncertain }))).rejects.toThrow(/retry|unavailable/i);
  }, 120000);

  test('rejects malformed, stale actor, tenant, role, digest and target substitutions with zero residue', async () => {
    const base = control('pause_scope', 'policy_version', 40, await now());
    const attacks = [value => { value.extra = true; }, value => { value.operation = null; }, value => { value.tenantId = OTHER; }, value => { value.actorBinding.membershipRole = 'viewer'; }, value => { value.targetBinding.policyDigest = hash('other'); }, value => { value.requestDigest = hash('attacker'); }];
    for (const [index, mutate] of attacks.entries()) { const value = copy(base); value.controlId = uuid(780000 + index); mutate(value); if (index !== attacks.length - 1) resealControl(value); await expect(applyControl(value, trustedControl(value))).rejects.toThrow(); }
    await pool.query(`UPDATE public.users SET status='suspended' WHERE id=$1`, [ACTOR]); const inactive = control('pause_scope', 'policy_version', 49, await now());
    await expect(applyControl(inactive)).rejects.toThrow(/actor/i); await pool.query(`UPDATE public.users SET status='active' WHERE id=$1`, [ACTOR]);
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_delivery_control_events_v1 WHERE organization_id=$1 AND control_id=ANY($2::uuid[])', [TENANT, attacks.map((_, index) => uuid(780000 + index)).concat([inactive.controlId])])).rows[0].count).toBe(0);
  }, 120000);

  test('immutable evidence is tenant-private and no provider-attempt or delivery-outcome authority exists', async () => {
    const client = await pool.connect(); try {
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE ' + quoteIdentifier(RLS_ROLE)); await client.query("SELECT set_config('northstar.automation_tenant_id',$1,true)", [TENANT]);
      expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_delivery_control_events_v1')).rows[0].count).toBe(0); await client.query('ROLLBACK');
      await client.query('BEGIN'); await enter(client); await expect(client.query('DELETE FROM public.canonical_automation_delivery_control_events_v1 WHERE organization_id=$1', [TENANT])).rejects.toThrow(); await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    expect((await pool.query(`SELECT count(*)::integer count FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])`, [['canonical_automation_provider_attempts_v1','canonical_automation_delivery_outcomes_v1']])).rows[0].count).toBe(0);
  }, 120000);

  test('resume and owner-reviewed retry hold exact source-lineage authority through concurrent corrections', async () => {
    const originalSource = { snapshotId: SNAPSHOT, snapshotDigest: SNAPSHOT_DIGEST, sourceSetDigest: SOURCE_SET_DIGEST };
    await seedAction(80, RESUME_RACE_POLICY, RESUME_RACE_POLICY_DIGEST, 25920000, originalSource);
    expect((await applyControl(control('pause_scope', 'policy_version', 80, await now(), { policyId: RESUME_RACE_POLICY, policyDigest: RESUME_RACE_POLICY_DIGEST }))).state).toBe('paused');
    expect((await applyControl(control('drain_scope', 'policy_version', 81, await now(), { policyId: RESUME_RACE_POLICY, policyDigest: RESUME_RACE_POLICY_DIGEST }))).state).toBe('drained');

    const lineageKey = `${TENANT}:m28-source-lineage:m20.lead_contact_state:${hash('record-identity')}:transcript_occurred`;
    const correctionClient = await pool.connect(); const resumeClient = await pool.connect();
    let source2;
    try {
      await correctionClient.query('BEGIN'); await enter(correctionClient);
      await correctionClient.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lineageKey]);
      const resumePid = (await resumeClient.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await resumeClient.query("SET statement_timeout='10s'");
      const resume = control('resume_scope', 'policy_version', 82, await now(), { policyId: RESUME_RACE_POLICY, policyDigest: RESUME_RACE_POLICY_DIGEST });
      const pendingResume = applyControl(resume, trustedControl(resume), resumeClient).then(value => ({ value }), error => ({ error }));
      await waitForLockWait([resumePid]);
      source2 = await appendSnapshotCorrection(correctionClient, 2, SNAPSHOT, SNAPSHOT_DIGEST);
      await correctionClient.query('COMMIT');
      const outcome = await pendingResume; expect(outcome.error).toBeDefined(); expect(outcome.error.message).toMatch(/source stale/i);
      expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_delivery_control_events_v1 WHERE organization_id=$1 AND control_id=$2', [TENANT, resume.controlId])).rows[0].count).toBe(0);
    } finally {
      await correctionClient.query('ROLLBACK').catch(() => {}); correctionClient.release();
      await resumeClient.query('RESET statement_timeout').catch(() => {}); resumeClient.release();
    }

    const prepared = await prepare(83, 300, 25920000, RETRY_RACE_POLICY, RETRY_RACE_POLICY_DIGEST, source2);
    expect((await decide(retryDecision(prepared, 83, 'provider_retryable_definite_no_acceptance', 1))).state).toBe('permanent_stop_attempt_ceiling');
    const dead = control('dead_letter_action', 'action_schedule', 83, await now(), { prepared, policyId: RETRY_RACE_POLICY, policyDigest: RETRY_RACE_POLICY_DIGEST }); expect((await applyControl(dead)).state).toBe('dead_lettered_terminal');

    const correctionClient2 = await pool.connect(); const retryClient = await pool.connect();
    let source3;
    try {
      await correctionClient2.query('BEGIN'); await enter(correctionClient2);
      await correctionClient2.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lineageKey]);
      const retryPid = (await retryClient.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await retryClient.query("SET statement_timeout='10s'");
      const reviewed = control('owner_reviewed_retry', 'action_schedule', 84, await now(), { prepared, policyId: RETRY_RACE_POLICY, policyDigest: RETRY_RACE_POLICY_DIGEST });
      const pendingRetry = applyControl(reviewed, trustedControl(reviewed), retryClient).then(value => ({ value }), error => ({ error }));
      await waitForLockWait([retryPid]);
      source3 = await appendSnapshotCorrection(correctionClient2, 3, source2.snapshotId, source2.snapshotDigest);
      await correctionClient2.query('COMMIT');
      const outcome = await pendingRetry; expect(outcome.error).toBeDefined(); expect(outcome.error.message).toMatch(/source stale/i);
      expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_delivery_control_events_v1 WHERE organization_id=$1 AND control_id=$2', [TENANT, reviewed.controlId])).rows[0].count).toBe(0);
    } finally {
      await correctionClient2.query('ROLLBACK').catch(() => {}); correctionClient2.release();
      await retryClient.query('RESET statement_timeout').catch(() => {}); retryClient.release();
    }
    bulkPending = await seedAction(59, POLICY, POLICY_DIGEST, 25920000, source3);
  }, 120000);

  test('tenant bulk stop is terminal, bounded and blocks every later supported scheduling path', async () => {
    const bulk = control('bulk_stop', 'tenant', 60, await now()); const stopped = await applyControl(bulk);
    expect(stopped).toEqual(expect.objectContaining({ state: 'bulk_stopped_terminal', replayed: false }));
    await expect(claim(leaseRequest(bulkPending, 59))).rejects.toThrow(/control/i);
    await expect(seedAction(60, POLICY, POLICY_DIGEST, 25920000, { snapshotId: uuid(302), snapshotDigest: hash('snapshot-digest-3'), sourceSetDigest: hash('source-set-3') })).rejects.toThrow(/control/i);
    await expect(applyControl(control('pause_scope', 'tenant', 61, await now()))).rejects.toThrow(/terminal/i);
  }, 120000);
});
