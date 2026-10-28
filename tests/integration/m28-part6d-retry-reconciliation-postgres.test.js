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
const RLS_ROLE = `m28_part6d_rls_${process.pid}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;

function resealLease(value) {
  value.workerBinding.workerIdentityDigest = canonical.digest('mission28.delivery-worker.v1\n', Object.fromEntries(Object.entries(value.workerBinding).filter(([key]) => key !== 'workerIdentityDigest')));
  value.requestDigest = canonical.digest('mission28.delivery-lease.request.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest'))); return value;
}
function leaseRequest(action, suffix, expectedPriorFenceToken = 0) {
  return resealLease({ schemaVersion: 'mission28.delivery-lease.request.v1', tenantId: TENANT, leaseRequestId: uuid(500000 + suffix),
    scheduleBinding: { scheduleId: action.scheduleId, transactionId: action.transactionId, runId: action.runId, unitId: action.unitId, outboxId: action.outboxId, unitDigest: action.unitDigest, scheduleBindingDigest: action.scheduleBindingDigest },
    workerBinding: { workerId: uuid(510000 + suffix), processId: uuid(520000 + suffix), deploymentId: uuid(530000 + suffix), regionId: 'us-east-1', workerIdentityDigest: '' },
    leaseBinding: { leaseId: uuid(540000 + suffix), expectedPriorFenceToken, durationSeconds: 300 }, requestDigest: '' });
}
const trustedLease = value => ({ tenantId: value.tenantId, scheduleBinding: value.scheduleBinding, workerBinding: value.workerBinding });
function resealRetry(value) {
  value.attemptObservation.observationDigest = canonical.digest('mission28.delivery-attempt-observation.v1\n', Object.fromEntries(Object.entries(value.attemptObservation).filter(([key]) => key !== 'observationDigest')));
  value.retryPolicy.retryPolicyDigest = canonical.digest('mission28.delivery-retry-policy.v1\n', Object.fromEntries(Object.entries(value.retryPolicy).filter(([key]) => key !== 'retryPolicyDigest')));
  value.requestDigest = canonical.digest('mission28.delivery-retry-decision.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest'))); return value;
}
const trustedRetry = value => { const result = copy(value); delete result.schemaVersion; delete result.decisionId; delete result.requestDigest; return result; };
function retryDecision(prepared, suffix, kind, attemptOrdinal, occurredAt, options = {}) {
  const attemptLease = options.attemptLease || prepared.lease;
  const decisionLease = options.decisionLease || prepared.lease;
  const reconciliationState = options.reconciliationState || 'not_performed';
  return resealRetry({ schemaVersion: 'mission28.delivery-retry-decision.v1', tenantId: TENANT, decisionId: uuid(600000 + suffix), decisionKind: options.decisionKind || 'classify_attempt',
    actionBinding: { scheduleId: prepared.action.scheduleId, transactionId: prepared.action.transactionId, runId: prepared.action.runId, unitId: prepared.action.unitId, outboxId: prepared.action.outboxId, receiptId: prepared.action.scheduleId, unitDigest: prepared.action.unitDigest, providerRequestIdentity: prepared.receipt.providerRequestIdentity, providerRequestDigest: prepared.receipt.providerRequestDigest, idempotencyReceiptDigest: prepared.receipt.idempotencyReceiptDigest },
    leaseBinding: { leaseId: decisionLease.leaseId, fenceToken: decisionLease.fenceToken },
    retryPolicy: { attemptCeiling: options.attemptCeiling || 3, baseDelaySeconds: options.baseDelaySeconds || 1, maximumDelaySeconds: options.maximumDelaySeconds || 4, maximumRetryAfterSeconds: options.maximumRetryAfterSeconds || 4, maximumJitterSeconds: options.maximumJitterSeconds ?? 0, retryPolicyDigest: '' },
    attemptObservation: { observationId: options.observationId || uuid(610000 + suffix), observationKind: kind, observationDigest: options.observationDigest || hash(`observation-${suffix}`), attemptOrdinal, attemptLeaseId: attemptLease.leaseId, attemptFenceToken: attemptLease.fenceToken, occurredAt, retryAfterSeconds: kind === 'provider_rate_limited_definite_no_acceptance' ? (options.retryAfterSeconds || 2) : null, providerTimeoutSeconds: kind === 'provider_timeout_uncertain' ? 30 : null },
    reconciliation: reconciliationState === 'not_performed' ? { state: 'not_performed', evidenceId: null, evidenceDigest: null, observedAt: null }
      : { state: reconciliationState, evidenceId: uuid(620000 + suffix), evidenceDigest: hash(`reconciliation-${suffix}`), observedAt: options.reconciliationObservedAt },
    requestDigest: '' });
}

realPostgres('Mission 28 Part 6D PostgreSQL retry and reconciliation through migration 278', () => {
  let database; let pool; let migrations;
  async function enter(client, tenant = TENANT) { await client.query('SELECT public.canonical_automation_enter_tenant_v1($1)', [tenant]); }
  async function tenantQuery(text, values = [], tenant = TENANT) {
    const client = await pool.connect(); try { await client.query('BEGIN'); await enter(client, tenant); const result = await client.query(text, values); await client.query('COMMIT'); return result; }
    finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }
  async function claim(value, client = pool) { return (await client.query('SELECT public.canonical_automation_claim_scheduled_action_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trustedLease(value))])).rows[0].result; }
  async function reserve(value, lease, client = pool) { return (await client.query('SELECT public.canonical_automation_reserve_provider_request_identity_v1($1,$2,$3,$4) result', [TENANT, value.scheduleBinding.scheduleId, lease.leaseId, lease.fenceToken])).rows[0].result; }
  async function decide(value, resolution = trustedRetry(value), client = pool) { return (await client.query('SELECT public.canonical_automation_record_retry_decision_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(resolution)])).rows[0].result; }
  async function clock() { return (await pool.query('SELECT public.canonical_automation_utc_v1(clock_timestamp()) value')).rows[0].value; }
  async function seedTransaction(suffix) {
    const transactionId = uuid(10000 + suffix); const runId = uuid(11000 + suffix); const unitId = uuid(12000 + suffix); const outboxId = uuid(13000 + suffix); const scheduleId = uuid(14000 + suffix);
    const unitDigest = hash(`unit-${suffix}`); const materialDigest = hash(`material-${suffix}`); const idempotencyKeyDigest = hash(`idempotency-${suffix}`); const scheduleBindingDigest = hash(`schedule-${suffix}`);
    const scheduleClock = (await pool.query(`SELECT
      public.canonical_automation_utc_v1(statement_timestamp()-INTERVAL '1 minute') due_at,
      public.canonical_automation_utc_v1(statement_timestamp()+INTERVAL '300 days') expires_at`)).rows[0];
    const localDate = scheduleClock.due_at.slice(0, 10); const localTime = scheduleClock.due_at.slice(11, 19);
    const document = { tenantId: TENANT, transactionId, runId, policyBinding: { policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST }, sourceBinding: { sourceSetDigest: SOURCE_SET_DIGEST, snapshotIds: [SNAPSHOT], snapshotDigests: [SNAPSHOT_DIGEST] }, actionUnits: [{ unitId }], requestDigest: hash(`transaction-${suffix}`) };
    const scheduleDocument = { tenantId: TENANT, scheduleId, transactionId, runId, unitBinding: { unitId, outboxId, unitDigest }, policyBinding: { policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST }, sourceBinding: { sourceSetDigest: SOURCE_SET_DIGEST }, localSchedule: { tenantTimeZone: 'UTC', localDate, localTime, utcInstant: scheduleClock.due_at, foldResolution: 'not_ambiguous' }, calendarBinding: { calendarId: uuid(15000 + suffix), calendarVersion: 1, calendarDigest: hash(`calendar-${suffix}`), calendarState: 'exact_current', tenantTimeZone: 'UTC' }, expirationBinding: { expiresAt: scheduleClock.expires_at }, trustedClockBinding: { contract: 'postgresql_statement_timestamp_v1' }, scheduleBindingDigest, requestDigest: hash(`schedule-request-${suffix}`) };
    const client = await pool.connect(); try {
      await client.query('BEGIN'); await enter(client);
      await client.query(`INSERT INTO public.canonical_automation_action_transactions_v1
       (organization_id,transaction_id,run_id,policy_id,policy_version,policy_digest,source_set_digest,decision_digest,authorization_digest,currentness_digest,request_digest,unit_count,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
       VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,1,$11::text,$11::jsonb,'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, transactionId, runId, POLICY, POLICY_DIGEST, SOURCE_SET_DIGEST, hash(`decision-${suffix}`), hash(`authorization-${suffix}`), hash(`currentness-${suffix}`), document.requestDigest, canonical.canonicalize(document)]);
      await client.query(`INSERT INTO public.canonical_automation_action_units_v1
       (organization_id,transaction_id,unit_id,run_id,unit_index,action_family_id,action_template_id,action_template_digest,recipient_set_digest,channel_id,provider_mode,effect_class,material_digest,idempotency_key_digest,unit_digest,state,recorded_at)
       VALUES($1,$2,$3,$4,0,'internal_read_digest_task','internal_fact_digest_v1',$5,$6,'in_app_passive','provider_disabled','internal_record_only',$7,$8,$9,'committed_unpublished',statement_timestamp())`, [TENANT, transactionId, unitId, runId, hash(`template-${suffix}`), hash(`recipient-${suffix}`), materialDigest, idempotencyKeyDigest, unitDigest]);
      await client.query(`INSERT INTO public.canonical_automation_action_outbox_v1
       (organization_id,outbox_id,transaction_id,unit_id,unit_digest,state,queue_publication_id,queue_published_at,claim_id,lease_expires_at,recorded_at)
       VALUES($1,$2,$3,$4,$5,'committed_unpublished',NULL,NULL,NULL,NULL,statement_timestamp())`, [TENANT, outboxId, transactionId, unitId, unitDigest]);
      await client.query(`INSERT INTO public.canonical_automation_action_schedules_v1
       (organization_id,schedule_id,transaction_id,run_id,unit_id,outbox_id,unit_digest,policy_id,policy_version,policy_digest,source_set_digest,tenant_time_zone,local_date,local_time,utc_instant,fold_resolution,calendar_id,calendar_version,calendar_digest,schedule_binding_digest,expires_at,request_digest,state,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,'UTC',$11::date,$12::time,$13::timestamptz,'not_ambiguous',$14,1,$15,$16,$17::timestamptz,$18,'scheduled_unpublished',$19::text,$19::jsonb,'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, scheduleId, transactionId, runId, unitId, outboxId, unitDigest, POLICY, POLICY_DIGEST, SOURCE_SET_DIGEST, localDate, localTime, scheduleClock.due_at, scheduleDocument.calendarBinding.calendarId, scheduleDocument.calendarBinding.calendarDigest, scheduleBindingDigest, scheduleClock.expires_at, scheduleDocument.requestDigest, canonical.canonicalize(scheduleDocument)]);
      await client.query('COMMIT'); return { scheduleId, transactionId, runId, unitId, outboxId, unitDigest, scheduleBindingDigest };
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }
  async function prepare(suffix) { const action = await seedTransaction(suffix); const request = leaseRequest(action, suffix); const lease = await claim(request); const receipt = await reserve(request, lease); return { action, request, lease, receipt }; }

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p6d-retry'); pool = new Pool({ connectionString: database.connectionString, max: 8 });
    migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p6d-through278-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 278)) fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    const db = require('../../src/db'); await db.runMigrations({ pool, migrationsDirectory: migrations });
    const client = await pool.connect(); try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO public.organizations(id,name,email) VALUES ($1,'Mission 28 Part 6D tenant','m28-part6d@example.test'),($2,'Mission 28 Part 6D other','m28-part6d-other@example.test')`, [TENANT, OTHER]);
      await enter(client);
      const policyDocument = { tenantId: TENANT, policyId: POLICY, version: 1, canonicalDigest: POLICY_DIGEST, previousVersionDigest: null };
      await client.query(`INSERT INTO public.canonical_automation_policy_versions_v1 (organization_id,policy_id,version,previous_version_digest,canonical_digest,canonical_text,document,expires_at,source_origin,conversion_review_id,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
       VALUES($1,$2,1,NULL,$3,$4::text,$4::jsonb,NOW()+INTERVAL '2 years','mission28_native',NULL,'policy_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, POLICY, POLICY_DIGEST, canonical.canonicalize(policyDocument)]);
      await client.query(`INSERT INTO public.canonical_automation_lifecycle_events_v1 (organization_id,lifecycle_event_id,policy_id,policy_version,lifecycle_sequence,operation,from_state,to_state,predecessor_event_id,predecessor_event_digest,idempotency_digest,payload_digest,event_digest,source_set_digest,currentness_marker,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
       VALUES($1,$2,$3,1,1,'activate','previewed','active',NULL,NULL,$4,$5,$6,$7,'exact_current_not_runtime_revalidated','{}','{}','lifecycle_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, uuid(200), POLICY, hash('lifecycle-idempotency'), hash('lifecycle-payload'), hash('lifecycle-event'), hash('lifecycle-source')]);
      const snapshotDocument = { tenantId: TENANT, snapshotId: SNAPSHOT, triggerId: 'm20.lead_contact_state', sourceClassId: 'mission20_business_contact_preferences', recordIdentityDigest: hash('record-identity'), canonicalDigest: SOURCE_DIGEST, sourceDigest: SOURCE_DIGEST, eventBinding: { eventKind: 'transcript_occurred', eventTime: '2026-10-28T12:00:00.000000Z' }, currentness: { availability: 'available_exact_current', pinsDigest: hash('pins') }, provenance: { kind: 'authenticated_event', provenanceDigest: hash('provenance') }, lineage: { kind: 'original', sequence: 1 }, requestDigest: hash('snapshot-request'), snapshotDigest: SNAPSHOT_DIGEST, observedAt: '2026-10-28T12:00:01.000000Z' };
      await client.query(`INSERT INTO public.canonical_automation_trigger_snapshots_v1 (organization_id,snapshot_id,trigger_id,source_class_id,record_identity_digest,canonical_digest,source_digest,event_kind,event_time,currentness_pins_digest,provenance_kind,provenance_digest,lineage_kind,lineage_sequence,predecessor_snapshot_id,predecessor_snapshot_digest,request_digest,snapshot_digest,request_text,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,observed_at)
       VALUES($1,$2,'m20.lead_contact_state','mission20_business_contact_preferences',$3,$4,$4,'transcript_occurred','2026-10-28T12:00:00Z',$5,'authenticated_event',$6,'original',1,NULL,NULL,$7,$8,$9::text,$9::text,$9::jsonb,'source_snapshot_history','postgresql_statement_timestamp_v1','UTC','2026-10-28T12:00:01Z')`, [TENANT, SNAPSHOT, hash('record-identity'), SOURCE_DIGEST, hash('pins'), hash('provenance'), hash('snapshot-request'), SNAPSHOT_DIGEST, canonical.canonicalize(snapshotDocument)]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`CREATE ROLE ${quoteIdentifier(RLS_ROLE)} NOLOGIN`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_delivery_retry_events_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
  }, 300000);

  afterAll(async () => {
    if (pool) { await pool.query(`REVOKE ALL ON public.canonical_automation_delivery_retry_events_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.end(); }
    if (database) await database.cleanup(); if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('migration 278 is additive, forced-RLS and owner-only with no runtime grant', async () => {
    expect((await pool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0]).toEqual({ latest: 278, total: 274 });
    const rows = (await pool.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname`, [['canonical_automation_delivery_retry_events_v1','canonical_automation_delivery_retry_heads_v1']])).rows;
    expect(rows).toHaveLength(2); expect(rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect((await pool.query(`SELECT has_function_privilege('public','public.canonical_automation_record_retry_decision_v1(text,jsonb)','EXECUTE') allowed`)).rows[0].allowed).toBe(false);
  });

  test('stores deterministic bounded retry timing and exact historical replay without changing upstream state', async () => {
    const prepared = await prepare(1); const occurredAt = await clock(); const value = retryDecision(prepared, 1, 'provider_rate_limited_definite_no_acceptance', 1, occurredAt);
    const first = await decide(value); expect(first).toEqual(expect.objectContaining({ state: 'retry_scheduled_no_effect', replayed: false, attemptOrdinal: 1, backoffSeconds: 2, jitterSeconds: 0, providerRequestIdentity: prepared.receipt.providerRequestIdentity }));
    expect(await decide(copy(value))).toEqual(expect.objectContaining({ replayed: true, decisionDigest: first.decisionDigest, nextAttemptAt: first.nextAttemptAt }));
    const upstream = (await tenantQuery(`SELECT u.state unit_state,o.state outbox_state,o.queue_publication_id,s.state schedule_state,r.state receipt_state FROM public.canonical_automation_action_units_v1 u JOIN public.canonical_automation_action_outbox_v1 o USING(organization_id,unit_id) JOIN public.canonical_automation_action_schedules_v1 s USING(organization_id,outbox_id) JOIN public.canonical_automation_provider_request_receipts_v1 r USING(organization_id,schedule_id) WHERE u.organization_id=$1 AND u.unit_id=$2`, [TENANT, prepared.action.unitId])).rows[0];
    expect(upstream).toEqual({ unit_state: 'committed_unpublished', outbox_state: 'committed_unpublished', queue_publication_id: null, schedule_state: 'scheduled_unpublished', receipt_state: 'identity_reserved_no_provider_attempt_or_ack' });
  }, 120000);

  test('derives bounded deterministic jitter from the one stable provider request identity', async () => {
    const prepared = await prepare(11); const occurredAt = await clock();
    const value = retryDecision(prepared, 110, 'provider_retryable_definite_no_acceptance', 1, occurredAt,
      { baseDelaySeconds: 2, maximumDelaySeconds: 30, maximumRetryAfterSeconds: 30, maximumJitterSeconds: 20 });
    const first = await decide(value); const replay = await decide(copy(value));
    expect(first.state).toBe('retry_scheduled_no_effect'); expect(first.backoffSeconds).toBe(2);
    expect(first.jitterSeconds).toBeGreaterThanOrEqual(0); expect(first.jitterSeconds).toBeLessThanOrEqual(20);
    expect(replay).toEqual(expect.objectContaining({ replayed: true, jitterSeconds: first.jitterSeconds, nextAttemptAt: first.nextAttemptAt, providerRequestIdentity: prepared.receipt.providerRequestIdentity }));
  }, 120000);

  test('blocks uncertainty until exact no-effect reconciliation and reuses identity across fenced takeover', async () => {
    const prepared = await prepare(2); const occurredAt = await clock(); const uncertain = retryDecision(prepared, 2, 'provider_timeout_uncertain', 1, occurredAt);
    expect(await decide(uncertain)).toEqual(expect.objectContaining({ state: 'reconciliation_required_no_resend', providerRequestIdentity: prepared.receipt.providerRequestIdentity }));
    const premature = retryDecision(prepared, 3, 'provider_retryable_definite_no_acceptance', 2, await clock()); await expect(decide(premature)).rejects.toThrow(/sequence/i);
    await tenantQuery(`UPDATE public.canonical_automation_delivery_lease_heads_v1 SET lease_acquired_at=statement_timestamp()-INTERVAL '2 seconds',lease_expires_at=statement_timestamp()-INTERVAL '1 second' WHERE organization_id=$1 AND schedule_id=$2`, [TENANT, prepared.action.scheduleId]);
    const takeoverRequest = leaseRequest(prepared.action, 2002, 1); const takeover = await claim(takeoverRequest);
    expect((await decide(copy(uncertain))).replayed).toBe(true);
    const reconciliation = retryDecision(prepared, 4, 'provider_timeout_uncertain', 1, occurredAt, { decisionKind: 'record_reconciliation', reconciliationState: 'no_effect_confirmed', reconciliationObservedAt: await clock(), observationId: uncertain.attemptObservation.observationId, observationDigest: uncertain.attemptObservation.observationDigest, attemptLease: prepared.lease, decisionLease: takeover });
    expect(await decide(reconciliation)).toEqual(expect.objectContaining({ state: 'retry_scheduled_no_effect', providerRequestIdentity: prepared.receipt.providerRequestIdentity, attemptOrdinal: 1 }));
    expect((await tenantQuery('SELECT count(DISTINCT provider_request_identity)::integer identities,count(*)::integer receipts FROM public.canonical_automation_provider_request_receipts_v1 WHERE organization_id=$1 AND schedule_id=$2', [TENANT, prepared.action.scheduleId])).rows[0]).toEqual({ identities: 1, receipts: 1 });
  }, 120000);

  test('serializes concurrent classifications so one attempt ordinal wins once', async () => {
    const prepared = await prepare(3); const occurredAt = await clock(); const left = retryDecision(prepared, 30, 'provider_retryable_definite_no_acceptance', 1, occurredAt); const right = retryDecision(prepared, 31, 'provider_retryable_definite_no_acceptance', 1, occurredAt);
    const results = await Promise.allSettled([decide(left), decide(right)]); expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1); expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
    expect((await tenantQuery('SELECT count(*)::integer count,max(decision_sequence)::integer sequence FROM public.canonical_automation_delivery_retry_events_v1 WHERE organization_id=$1 AND schedule_id=$2', [TENANT, prepared.action.scheduleId])).rows[0]).toEqual({ count: 1, sequence: 1 });
  }, 120000);

  test('enforces ceiling and permanent terminal, effect-confirmed and unknown stops', async () => {
    for (const [suffix, kind, expected] of [[4, 'provider_retryable_definite_no_acceptance', 'permanent_stop_attempt_ceiling'], [5, 'provider_terminal_rejection', 'permanent_stop_terminal'], [6, 'unknown_or_unsafe_outcome', 'permanent_stop_unknown_or_unsafe']]) {
      const prepared = await prepare(suffix); const value = retryDecision(prepared, suffix * 10, kind, 1, await clock(), { attemptCeiling: 1 }); expect((await decide(value)).state).toBe(expected);
      const reopen = retryDecision(prepared, suffix * 10 + 1000, 'provider_retryable_definite_no_acceptance', 2, await clock(), { attemptCeiling: 1 });
      await expect(decide(reopen)).rejects.toThrow(/sequence|authority/i);
    }
    for (const [suffix, reconciliationState, expected] of [[7, 'effect_confirmed', 'permanent_stop_effect_confirmed'], [8, 'unknown_or_unsafe', 'permanent_stop_unknown_or_unsafe']]) {
      const prepared = await prepare(suffix); const occurredAt = await clock(); const uncertain = retryDecision(prepared, suffix * 10, 'provider_acknowledgement_uncertain', 1, occurredAt); await decide(uncertain);
      const resolution = retryDecision(prepared, suffix * 10 + 1, 'provider_acknowledgement_uncertain', 1, occurredAt, { decisionKind: 'record_reconciliation', reconciliationState, reconciliationObservedAt: await clock(), observationId: uncertain.attemptObservation.observationId, observationDigest: uncertain.attemptObservation.observationDigest });
      expect((await decide(resolution)).state).toBe(expected);
    }
  }, 120000);

  test('rejects null, extra, digest and cross-action observation aliases before durable residue', async () => {
    const prepared = await prepare(12); const base = retryDecision(prepared, 120, 'provider_retryable_definite_no_acceptance', 1, await clock());
    const redigested = [value => { value.decisionKind = null; }, value => { value.attemptObservation.observationKind = null; }, value => { value.reconciliation.state = null; }, value => { value.unexpected = 'denied'; }];
    for (const [index, mutate] of redigested.entries()) { const value = copy(base); value.decisionId = uuid(698100 + index); mutate(value); resealRetry(value); await expect(decide(value, trustedRetry(value))).rejects.toThrow(); }
    const tamperedDigest = copy(base); tamperedDigest.decisionId = uuid(698200); resealRetry(tamperedDigest); tamperedDigest.attemptObservation.observationDigest = hash('attacker-selected');
    await expect(decide(tamperedDigest, trustedRetry(tamperedDigest))).rejects.toThrow(/digest/i);
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_delivery_retry_events_v1 WHERE organization_id=$1 AND schedule_id=$2', [TENANT, prepared.action.scheduleId])).rows[0].count).toBe(0);

    const firstAction = await prepare(13); const secondAction = await prepare(14);
    const first = retryDecision(firstAction, 130, 'provider_retryable_definite_no_acceptance', 1, await clock()); await decide(first);
    const aliased = retryDecision(secondAction, 140, 'provider_retryable_definite_no_acceptance', 1, await clock(), { observationId: first.attemptObservation.observationId });
    await expect(decide(aliased)).rejects.toThrow();
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_delivery_retry_events_v1 WHERE organization_id=$1 AND schedule_id=$2', [TENANT, secondAction.action.scheduleId])).rows[0].count).toBe(0);
  }, 120000);

  test('rejects bounded-material, tenant, receipt, fence and reconciliation substitution with zero residue', async () => {
    const prepared = await prepare(9); const base = retryDecision(prepared, 90, 'provider_retryable_definite_no_acceptance', 1, await clock());
    const attacks = [value => { value.tenantId = OTHER; }, value => { value.actionBinding.providerRequestDigest = hash('other'); }, value => { value.leaseBinding.fenceToken += 1; }, value => { value.retryPolicy.maximumRetryAfterSeconds = 5; }, value => { value.attemptObservation.retryAfterSeconds = 9; }, value => { value.attemptObservation.providerTimeoutSeconds = 1; }];
    for (const mutate of attacks) { const value = copy(base); value.decisionId = uuid(699000 + attacks.indexOf(mutate)); mutate(value); resealRetry(value); await expect(decide(value, trustedRetry(value))).rejects.toThrow(); }
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_delivery_retry_events_v1 WHERE organization_id=$1 AND schedule_id=$2', [TENANT, prepared.action.scheduleId])).rows[0].count).toBe(0);
  }, 120000);

  test('forced RLS hides immutable evidence and no effect rows or provider attempts exist', async () => {
    const prepared = await prepare(10); await decide(retryDecision(prepared, 100, 'provider_terminal_rejection', 1, await clock()));
    const client = await pool.connect(); try {
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE ' + quoteIdentifier(RLS_ROLE)); await client.query("SELECT set_config('northstar.automation_tenant_id',$1,true)", [TENANT]);
      expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_delivery_retry_events_v1')).rows[0].count).toBe(0); await client.query('ROLLBACK');
      await client.query('BEGIN'); await enter(client); await expect(client.query('DELETE FROM public.canonical_automation_delivery_retry_events_v1 WHERE organization_id=$1 AND schedule_id=$2', [TENANT, prepared.action.scheduleId])).rejects.toThrow(); await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    const effectTables = (await pool.query(`SELECT count(*)::integer count FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])`, [['canonical_automation_provider_attempts_v1','canonical_automation_delivery_outcomes_v1']])).rows[0].count;
    expect(effectTables).toBe(0);
  }, 120000);
});
