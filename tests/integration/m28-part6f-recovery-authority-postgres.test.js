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
const POLICY_DIGEST = `sha256:${'1'.repeat(64)}`;
const SNAPSHOT = '00000000-0000-4000-8000-000000000300';
const SNAPSHOT_DIGEST = `sha256:${'2'.repeat(64)}`;
const SOURCE_DIGEST = `sha256:${'3'.repeat(64)}`;
const SOURCE_SET_DIGEST = `sha256:${'4'.repeat(64)}`;
const RLS_ROLE = `m28_part6f_rls_${process.pid}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;

function resealRetry(value) {
  value.attemptObservation.observationDigest = canonical.digest('mission28.delivery-attempt-observation.v1\n', Object.fromEntries(Object.entries(value.attemptObservation).filter(([key]) => key !== 'observationDigest')));
  value.retryPolicy.retryPolicyDigest = canonical.digest('mission28.delivery-retry-policy.v1\n', Object.fromEntries(Object.entries(value.retryPolicy).filter(([key]) => key !== 'retryPolicyDigest')));
  value.requestDigest = canonical.digest('mission28.delivery-retry-decision.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
const trustedRetry = value => { const result = copy(value); delete result.schemaVersion; delete result.decisionId; delete result.requestDigest; return result; };
function resealControl(value) {
  value.requestDigest = canonical.digest('mission28.delivery-control-decision.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
const trustedControl = value => { const result = copy(value); delete result.schemaVersion; delete result.controlId; delete result.requestDigest; return result; };
function scopeControl(targetKind, suffix, requestedAt) {
  const targetBinding = { targetKind, policyId: null, policyVersion: null, policyDigest: null, scheduleId: null, transactionId: null, runId: null, unitId: null, outboxId: null, receiptId: null, unitDigest: null, providerRequestIdentity: null, providerRequestDigest: null };
  if (targetKind === 'policy_version') Object.assign(targetBinding, { policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST });
  return resealControl({ schemaVersion: 'mission28.delivery-control-decision.v1', tenantId: TENANT, controlId: uuid(700000 + suffix), operation: 'pause_scope', targetBinding,
    actorBinding: { actorId: ACTOR, sessionId: SESSION, membershipId: ACTOR, membershipRole: 'owner', requestedAt },
    successorBinding: { policyId: null, policyVersion: null, policyDigest: null },
    reviewBinding: { reviewId: null, reviewDigest: null, reviewOutcome: null, reviewedAt: null }, requestDigest: '' });
}

realPostgres('Mission 28 Part 6F PostgreSQL recovery authority through migration 280', () => {
  let database; let pool; let migrations;
  async function enter(client, tenant = TENANT) { await client.query('SELECT public.canonical_automation_enter_tenant_v1($1)', [tenant]); }
  async function tenantQuery(text, values = [], tenant = TENANT) {
    const client = await pool.connect(); try { await client.query('BEGIN'); await enter(client, tenant); const result = await client.query(text, values); await client.query('COMMIT'); return result; }
    finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }
  async function now() { return (await pool.query('SELECT public.canonical_automation_utc_v1(clock_timestamp()) value')).rows[0].value; }
  function trusted(value) { const result = copy(value); delete result.schemaVersion; delete result.recoveryId; delete result.requestDigest; return result; }
  function reseal(value) { value.requestDigest = canonical.digest('mission28.delivery-recovery-assessment.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest'))); return value; }
  function request(run, suffix, recoveryKind = 'process_restart', evidenceState = 'post_restart_database_available') {
    return reseal({ schemaVersion: 'mission28.delivery-recovery-assessment.v1', tenantId: TENANT, recoveryId: uuid(800000 + suffix), recoveryKind,
      incidentBinding: { incidentId: uuid(810000 + suffix), incidentDigest: hash(`incident-${suffix}`), evidenceState },
      transactionBinding: { transactionId: run.transactionId, runId: run.runId, policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST, sourceSetDigest: SOURCE_SET_DIGEST, unitCount: run.units.length },
      actorBinding: { actorId: ACTOR, sessionId: SESSION, membershipId: ACTOR, membershipRole: recoveryKind === 'disaster_restore' ? 'owner' : 'owner', requestedAt: null }, requestDigest: '' });
  }
  async function recover(value, resolution = null, client = pool) {
    if (value.actorBinding.requestedAt === null) value.actorBinding.requestedAt = await now();
    reseal(value);
    return (await client.query('SELECT public.canonical_automation_record_recovery_assessment_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(resolution || trusted(value))])).rows[0].result;
  }
  async function decide(value, client = pool) { return (await client.query('SELECT public.canonical_automation_record_retry_decision_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trustedRetry(value))])).rows[0].result; }
  async function applyControl(value, client = pool) { return (await client.query('SELECT public.canonical_automation_record_delivery_control_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(trustedControl(value))])).rows[0].result; }
  async function seedRun(suffix, unitCount = 2, scheduleIndexes = [0]) {
    const transactionId = uuid(10000 + suffix); const runId = uuid(11000 + suffix); const units = [];
    for (let index = 0; index < unitCount; index += 1) units.push({ index, unitId: uuid(12000 + suffix * 10 + index), outboxId: uuid(13000 + suffix * 10 + index), unitDigest: hash(`unit-${suffix}-${index}`) });
    const document = { tenantId: TENANT, transactionId, runId, policyBinding: { policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST }, sourceBinding: { sourceSetDigest: SOURCE_SET_DIGEST, snapshotIds: [SNAPSHOT], snapshotDigests: [SNAPSHOT_DIGEST] }, actionUnits: units.map(item => ({ unitId: item.unitId })), requestDigest: hash(`transaction-${suffix}`) };
    await tenantQuery(`INSERT INTO public.canonical_automation_action_transactions_v1
      (organization_id,transaction_id,run_id,policy_id,policy_version,policy_digest,source_set_digest,decision_digest,authorization_digest,currentness_digest,request_digest,unit_count,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
      VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,$12::text,$12::jsonb,'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`,
      [TENANT, transactionId, runId, POLICY, POLICY_DIGEST, SOURCE_SET_DIGEST, hash(`decision-${suffix}`), hash(`authorization-${suffix}`), hash(`currentness-${suffix}`), document.requestDigest, unitCount, canonical.canonicalize(document)]);
    for (const item of units) {
      await tenantQuery(`INSERT INTO public.canonical_automation_action_units_v1
       (organization_id,transaction_id,unit_id,run_id,unit_index,action_family_id,action_template_id,action_template_digest,recipient_set_digest,channel_id,provider_mode,effect_class,material_digest,idempotency_key_digest,unit_digest,state,recorded_at)
       VALUES($1,$2,$3,$4,$5,'internal_read_digest_task','internal_fact_digest_v1',$6,$7,'in_app_passive','provider_disabled','internal_record_only',$8,$9,$10,'committed_unpublished',statement_timestamp())`,
      [TENANT, transactionId, item.unitId, runId, item.index, hash(`template-${suffix}-${item.index}`), hash(`recipient-${suffix}-${item.index}`), hash(`material-${suffix}-${item.index}`), hash(`idempotency-${suffix}-${item.index}`), item.unitDigest]);
      await tenantQuery(`INSERT INTO public.canonical_automation_action_outbox_v1
       (organization_id,outbox_id,transaction_id,unit_id,unit_digest,state,recorded_at)
       VALUES($1,$2,$3,$4,$5,'committed_unpublished',statement_timestamp())`, [TENANT, item.outboxId, transactionId, item.unitId, item.unitDigest]);
      if (scheduleIndexes.includes(item.index)) {
        item.scheduleId = uuid(14000 + suffix * 10 + item.index); const due = await now(); const expires = (await pool.query("SELECT public.canonical_automation_utc_v1(clock_timestamp()+INTERVAL '30 days') value")).rows[0].value;
        const scheduleDocument = { tenantId: TENANT, scheduleId: item.scheduleId, transactionId, runId, unitBinding: { unitId: item.unitId, outboxId: item.outboxId, unitDigest: item.unitDigest }, policyBinding: { policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST }, sourceBinding: { sourceSetDigest: SOURCE_SET_DIGEST }, localSchedule: { tenantTimeZone: 'UTC', localDate: due.slice(0, 10), localTime: due.slice(11, 19), utcInstant: due, foldResolution: 'not_ambiguous' }, calendarBinding: { calendarId: uuid(15000 + suffix * 10 + item.index), calendarVersion: 1, calendarDigest: hash(`calendar-${suffix}-${item.index}`), calendarState: 'exact_current', tenantTimeZone: 'UTC' }, expirationBinding: { expiresAt: expires }, trustedClockBinding: { contract: 'postgresql_statement_timestamp_v1' }, scheduleBindingDigest: hash(`schedule-${suffix}-${item.index}`), requestDigest: hash(`schedule-request-${suffix}-${item.index}`) };
        await tenantQuery(`INSERT INTO public.canonical_automation_action_schedules_v1
         (organization_id,schedule_id,transaction_id,run_id,unit_id,outbox_id,unit_digest,policy_id,policy_version,policy_digest,source_set_digest,tenant_time_zone,local_date,local_time,utc_instant,fold_resolution,calendar_id,calendar_version,calendar_digest,schedule_binding_digest,expires_at,request_digest,state,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,'UTC',$11::date,$12::time,$13::timestamptz,'not_ambiguous',$14,1,$15,$16,$17::timestamptz,$18,'scheduled_unpublished',$19::text,$19::jsonb,'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`,
        [TENANT, item.scheduleId, transactionId, runId, item.unitId, item.outboxId, item.unitDigest, POLICY, POLICY_DIGEST, SOURCE_SET_DIGEST, due.slice(0, 10), due.slice(11, 19), due, scheduleDocument.calendarBinding.calendarId, scheduleDocument.calendarBinding.calendarDigest, scheduleDocument.scheduleBindingDigest, expires, scheduleDocument.requestDigest, canonical.canonicalize(scheduleDocument)]);
      }
    }
    return { transactionId, runId, units };
  }
  async function addLeaseAndReceipt(run, suffix, expiresInSeconds = 300) {
    const item = run.units[0]; const leaseRequestId = uuid(500000 + suffix); const leaseId = uuid(540000 + suffix); const fence = 1; const acquired = await now();
    const expires = (await pool.query("SELECT public.canonical_automation_utc_v1(clock_timestamp()+make_interval(secs=>$1::integer)) value", [expiresInSeconds])).rows[0].value;
    const workerDigest = hash(`worker-${suffix}`); const requestDigest = hash(`lease-request-${suffix}`);
    const doc = { tenantId: TENANT, leaseRequestId, scheduleBinding: { scheduleId: item.scheduleId, transactionId: run.transactionId, runId: run.runId, unitId: item.unitId, outboxId: item.outboxId }, leaseBinding: { leaseId }, requestDigest };
    await tenantQuery(`INSERT INTO public.canonical_automation_delivery_lease_events_v1
     (organization_id,lease_request_id,schedule_id,transaction_id,run_id,unit_id,outbox_id,unit_index,unit_count,lease_id,fence_token,worker_id,process_id,deployment_id,region_id,worker_identity_digest,request_digest,canonical_text,document,lease_acquired_at,lease_expires_at,retention_class,trusted_clock_contract,recorded_time_zone)
     VALUES($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,$12,$13,'us-east-1',$14,$15,$16::text,$16::jsonb,$17::timestamptz,$18::timestamptz,'decision_history','postgresql_statement_timestamp_v1','UTC')`,
     [TENANT, leaseRequestId, item.scheduleId, run.transactionId, run.runId, item.unitId, item.outboxId, run.units.length, leaseId, fence, uuid(510000 + suffix), uuid(520000 + suffix), uuid(530000 + suffix), workerDigest, requestDigest, canonical.canonicalize(doc), acquired, expires]);
    await tenantQuery(`INSERT INTO public.canonical_automation_delivery_lease_heads_v1 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamptz,'postgresql_statement_timestamp_v1','UTC')`,
      [TENANT, item.scheduleId, run.transactionId, run.runId, item.unitId, item.outboxId, fence, leaseId, workerDigest, acquired, expires]);
    const providerIdentity = `m28:${item.scheduleId}`; const providerDigest = hash(`provider-${suffix}`); const receiptDigest = hash(`receipt-${suffix}`);
    await tenantQuery(`INSERT INTO public.canonical_automation_provider_request_receipts_v1 VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'identity_reserved_no_provider_attempt_or_ack',statement_timestamp(),'decision_history','postgresql_statement_timestamp_v1','UTC')`,
      [TENANT, item.scheduleId, run.transactionId, run.runId, item.unitId, item.outboxId, leaseId, fence, providerIdentity, providerDigest, receiptDigest]);
    return { leaseId, fence, workerDigest, providerIdentity, providerDigest, receiptDigest };
  }
  async function addRetry(run, suffix) {
    const lease = await addLeaseAndReceipt(run, suffix); const item = run.units[0]; const occurredAt = await now();
    const value = resealRetry({ schemaVersion: 'mission28.delivery-retry-decision.v1', tenantId: TENANT, decisionId: uuid(600000 + suffix), decisionKind: 'classify_attempt',
      actionBinding: { scheduleId: item.scheduleId, transactionId: run.transactionId, runId: run.runId, unitId: item.unitId, outboxId: item.outboxId, receiptId: item.scheduleId, unitDigest: item.unitDigest, providerRequestIdentity: lease.providerIdentity, providerRequestDigest: lease.providerDigest, idempotencyReceiptDigest: lease.receiptDigest },
      leaseBinding: { leaseId: lease.leaseId, fenceToken: lease.fence },
      retryPolicy: { attemptCeiling: 3, baseDelaySeconds: 1, maximumDelaySeconds: 4, maximumRetryAfterSeconds: 4, maximumJitterSeconds: 0, retryPolicyDigest: '' },
      attemptObservation: { observationId: uuid(610000 + suffix), observationKind: 'provider_retryable_definite_no_acceptance', observationDigest: '', attemptOrdinal: 1, attemptLeaseId: lease.leaseId, attemptFenceToken: lease.fence, occurredAt, retryAfterSeconds: null, providerTimeoutSeconds: null },
      reconciliation: { state: 'not_performed', evidenceId: null, evidenceDigest: null, observedAt: null }, requestDigest: '' });
    await decide(value); return { lease, value };
  }

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p6f-recovery'); pool = new Pool({ connectionString: database.connectionString, max: 6 });
    migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p6f-through280-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 280)) fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    const db = require('../../src/db'); await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`INSERT INTO public.organizations(id,name,email) VALUES($1,'Part 6F tenant','part6f@example.test'),($2,'Part 6F other','part6f-other@example.test')`, [TENANT, OTHER]);
    await pool.query(`INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status) VALUES($1,$2,'Part 6F owner','part6f-owner@example.test','unused','owner','active')`, [ACTOR, TENANT]);
    await pool.query(`INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status) VALUES($1,$2,$1,'owner','active')`, [ACTOR, TENANT]);
    await pool.query(`INSERT INTO public.auth_sessions(id,user_id,organization_id,membership_id,status,access_expires_at,refresh_expires_at,csrf_token_hash) VALUES($1,$2,$3,$2,'active',NOW()+INTERVAL '1 hour',NOW()+INTERVAL '2 hours',$4)`, [SESSION, ACTOR, TENANT, '1'.repeat(64)]);
    const policyDocument = { tenantId: TENANT, policyId: POLICY, version: 1, canonicalDigest: POLICY_DIGEST, previousVersionDigest: null };
    await tenantQuery(`INSERT INTO public.canonical_automation_policy_versions_v1 (organization_id,policy_id,version,previous_version_digest,canonical_digest,canonical_text,document,expires_at,source_origin,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at) VALUES($1,$2,1,NULL,$3,$4::text,$4::jsonb,NOW()+INTERVAL '2 years','mission28_native','policy_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, POLICY, POLICY_DIGEST, canonical.canonicalize(policyDocument)]);
    await tenantQuery(`INSERT INTO public.canonical_automation_lifecycle_events_v1 (organization_id,lifecycle_event_id,policy_id,policy_version,lifecycle_sequence,operation,from_state,to_state,idempotency_digest,payload_digest,event_digest,source_set_digest,currentness_marker,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,recorded_at) VALUES($1,$2,$3,1,1,'activate','previewed','active',$4,$5,$6,$7,'exact_current_not_runtime_revalidated','{}','{}','lifecycle_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, uuid(200), POLICY, hash('life-id'), hash('life-payload'), hash('life-event'), hash('life-source')]);
    const snapshotDocument = { tenantId: TENANT, snapshotId: SNAPSHOT, triggerId: 'm20.lead_contact_state', sourceClassId: 'mission20_business_contact_preferences', recordIdentityDigest: hash('record-identity'), canonicalDigest: SOURCE_DIGEST, sourceDigest: SOURCE_DIGEST, eventBinding: { eventKind: 'transcript_occurred', eventTime: '2026-10-28T12:00:00.000000Z' }, currentness: { availability: 'available_exact_current', pinsDigest: hash('pins') }, provenance: { kind: 'authenticated_event', provenanceDigest: hash('provenance') }, lineage: { kind: 'original', sequence: 1 }, requestDigest: hash('snapshot-request'), snapshotDigest: SNAPSHOT_DIGEST, observedAt: '2026-10-28T12:00:01.000000Z' };
    await tenantQuery(`INSERT INTO public.canonical_automation_trigger_snapshots_v1 (organization_id,snapshot_id,trigger_id,source_class_id,record_identity_digest,canonical_digest,source_digest,event_kind,event_time,currentness_pins_digest,provenance_kind,provenance_digest,lineage_kind,lineage_sequence,request_digest,snapshot_digest,request_text,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,observed_at) VALUES($1,$2,'m20.lead_contact_state','mission20_business_contact_preferences',$3,$4,$4,'transcript_occurred','2026-10-28T12:00:00Z',$5,'authenticated_event',$6,'original',1,$7,$8,$9::text,$9::text,$9::jsonb,'source_snapshot_history','postgresql_statement_timestamp_v1','UTC','2026-10-28T12:00:01Z')`, [TENANT, SNAPSHOT, hash('record-identity'), SOURCE_DIGEST, hash('pins'), hash('provenance'), hash('snapshot-request'), SNAPSHOT_DIGEST, canonical.canonicalize(snapshotDocument)]);
    await pool.query(`CREATE ROLE ${quoteIdentifier(RLS_ROLE)} NOLOGIN`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_recovery_assessments_v1,public.canonical_automation_recovery_items_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
  }, 300000);

  afterAll(async () => {
    if (pool) { await pool.query(`REVOKE ALL ON public.canonical_automation_recovery_assessments_v1,public.canonical_automation_recovery_items_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.end(); }
    if (database) await database.cleanup(); if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('migration 280 is additive, forced-RLS, immutable and has no runtime grant', async () => {
    expect((await pool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0]).toEqual({ latest: 280, total: 276 });
    const rows = (await pool.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname`, [['canonical_automation_recovery_assessments_v1','canonical_automation_recovery_items_v1']])).rows;
    expect(rows).toHaveLength(2); expect(rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect((await pool.query(`SELECT has_function_privilege('public','public.canonical_automation_record_recovery_assessment_v1(text,jsonb)','EXECUTE') allowed`)).rows[0].allowed).toBe(false);
  });

  test('stores every closed incident/evidence pair without converting it into resend or effect authority', async () => {
    const run = await seedRun(9, 1, [0]);
    const kinds = [
      ['process_restart', 'post_restart_database_available'],
      ['migration_restart', 'post_migration_database_available'],
      ['worker_crash', 'worker_unavailable_database_available'],
      ['database_outage', 'database_recovered_observation_only'],
      ['provider_outage', 'provider_unavailable'],
      ['partial_callback', 'callback_partial_or_unverified'],
      ['deployment_restore', 'deployment_database_available'],
      ['disaster_restore', 'restore_drill_unavailable']
    ];
    for (let index = 0; index < kinds.length; index += 1) {
      const [kind, evidence] = kinds[index]; const value = request(run, 90 + index, kind, evidence); const result = await recover(value);
      const expected = kind === 'disaster_restore' ? 'disaster_restore_evidence_gap_no_authority'
        : ['provider_outage', 'partial_callback'].includes(kind) ? 'reconciliation_required_no_resend' : 'bounded_history_verified_no_effect';
      expect(result.resultState).toBe(expected);
      if (['provider_outage', 'partial_callback'].includes(kind)) {
        const stored = (await tenantQuery(`SELECT result_state,uncertain_count FROM public.canonical_automation_recovery_assessments_v1 WHERE organization_id=$1 AND recovery_id=$2`, [TENANT, value.recoveryId])).rows[0];
        expect(stored).toEqual({ result_state: 'reconciliation_required_no_resend', uncertain_count: 0 });
      }
    }
    expect((await tenantQuery(`SELECT count(*)::integer count FROM public.canonical_automation_recovery_assessments_v1 WHERE organization_id=$1 AND run_id=$2`, [TENANT, run.runId])).rows[0].count).toBe(8);
  });

  test('records every unit in a complete bounded run, replays immutably and mutates no Part 6A-6E row', async () => {
    const run = await seedRun(1, 2, [0]); const value = request(run, 1); const before = (await tenantQuery(`SELECT count(*)::integer units,(SELECT count(*)::integer FROM public.canonical_automation_action_outbox_v1 WHERE organization_id=$1) outbox,(SELECT count(*)::integer FROM public.canonical_automation_action_schedules_v1 WHERE organization_id=$1) schedules FROM public.canonical_automation_action_units_v1 WHERE organization_id=$1`, [TENANT])).rows[0];
    const first = await recover(value); expect(first).toEqual(expect.objectContaining({ resultState: 'bounded_history_verified_no_effect', unitCount: 2, replayed: false }));
    expect(await recover(copy(value))).toEqual(expect.objectContaining({ assessmentDigest: first.assessmentDigest, replayed: true }));
    const stored = (await tenantQuery(`SELECT item_state FROM public.canonical_automation_recovery_items_v1 WHERE organization_id=$1 AND recovery_id=$2 ORDER BY unit_index`, [TENANT, value.recoveryId])).rows.map(row => row.item_state);
    expect(stored).toEqual(['queued_unpublished_preserved', 'committed_unpublished_unscheduled']);
    const after = (await tenantQuery(`SELECT count(*)::integer units,(SELECT count(*)::integer FROM public.canonical_automation_action_outbox_v1 WHERE organization_id=$1) outbox,(SELECT count(*)::integer FROM public.canonical_automation_action_schedules_v1 WHERE organization_id=$1) schedules FROM public.canonical_automation_action_units_v1 WHERE organization_id=$1`, [TENANT])).rows[0]; expect(after).toEqual(before);
  });

  test('provider identity and partial callback stay reconciliation-required with no resend', async () => {
    const run = await seedRun(2, 1, [0]); await addLeaseAndReceipt(run, 2); const value = request(run, 2, 'partial_callback', 'callback_partial_or_unverified');
    expect(await recover(value)).toEqual(expect.objectContaining({ resultState: 'reconciliation_required_no_resend', replayed: false }));
    const item = (await tenantQuery(`SELECT item_state,provider_request_identity FROM public.canonical_automation_recovery_items_v1 WHERE organization_id=$1 AND recovery_id=$2`, [TENANT, value.recoveryId])).rows[0];
    expect(item.item_state).toBe('provider_identity_reserved_reconciliation_required_no_resend'); expect(item.provider_request_identity).toBe(`m28:${run.units[0].scheduleId}`);
  });

  test('detects orphaned head authority and rolls the whole assessment back', async () => {
    const run = await seedRun(3, 1, [0]); const lease = await addLeaseAndReceipt(run, 3); const value = request(run, 3, 'worker_crash', 'worker_unavailable_database_available'); const client = await pool.connect();
    try { await client.query('BEGIN'); await enter(client); await client.query(`UPDATE public.canonical_automation_delivery_lease_heads_v1 SET lease_expires_at=lease_expires_at+INTERVAL '1 second' WHERE organization_id=$1 AND schedule_id=$2`, [TENANT, run.units[0].scheduleId]); await expect(recover(value, null, client)).rejects.toThrow(/orphan lease authority/i); await client.query('ROLLBACK'); }
    finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    expect((await tenantQuery(`SELECT count(*)::integer count FROM public.canonical_automation_recovery_assessments_v1 WHERE organization_id=$1 AND recovery_id=$2`, [TENANT, value.recoveryId])).rows[0].count).toBe(0); expect(lease.workerDigest).toBe(hash('worker-3'));
  });

  test('rejects a retry head whose exact immutable sequence or state evidence was changed', async () => {
    const run = await seedRun(10, 1, [0]); await addRetry(run, 10); const value = request(run, 10); const client = await pool.connect();
    try {
      await client.query('BEGIN'); await enter(client);
      await client.query(`UPDATE public.canonical_automation_delivery_retry_heads_v1 SET last_decision_sequence=last_decision_sequence+1 WHERE organization_id=$1 AND schedule_id=$2`, [TENANT, run.units[0].scheduleId]);
      await expect(recover(value, null, client)).rejects.toThrow(/orphan retry authority/i); await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    expect((await tenantQuery(`SELECT count(*)::integer count FROM public.canonical_automation_recovery_assessments_v1 WHERE organization_id=$1 AND recovery_id=$2`, [TENANT, value.recoveryId])).rows[0].count).toBe(0);
  });

  test('records the unexercised disaster-restore gap without claiming restored authority', async () => {
    const run = await seedRun(4, 1, [0]); const value = request(run, 4, 'disaster_restore', 'restore_drill_unavailable');
    expect(await recover(value)).toEqual(expect.objectContaining({ resultState: 'disaster_restore_evidence_gap_no_authority', replayed: false }));
  });

  test('denies inactive actor, trusted substitution and cloned incident material with zero residue', async () => {
    const run = await seedRun(5, 1, [0]); const inactive = request(run, 5);
    await pool.query(`UPDATE public.users SET status='suspended' WHERE id=$1`, [ACTOR]);
    try { await expect(recover(inactive)).rejects.toThrow(/actor unavailable/i); }
    finally { await pool.query(`UPDATE public.users SET status='active' WHERE id=$1`, [ACTOR]); }
    const accepted = request(run, 6); await recover(accepted); const clone = copy(accepted); clone.recoveryId = uuid(899999); reseal(clone); await expect(recover(clone)).rejects.toThrow(/duplicate key|unique/i);
    const substituted = request(run, 7); substituted.actorBinding.requestedAt = await now(); reseal(substituted); const resolution = trusted(substituted); resolution.transactionBinding.runId = uuid(999999); await expect(recover(substituted, resolution)).rejects.toThrow(/trusted resolution/i);
    expect((await tenantQuery(`SELECT count(*)::integer count FROM public.canonical_automation_recovery_assessments_v1 WHERE organization_id=$1 AND recovery_id=ANY($2::uuid[])`, [TENANT, [inactive.recoveryId, clone.recoveryId, substituted.recoveryId]])).rows[0].count).toBe(0);
  });

  test('a concurrent source correction serializes before assessment and blocks authority increase', async () => {
    const correctionId = uuid(301); const correctionDigest = hash('snapshot-correction'); const sourceDigest = hash('corrected-source');
    const document = { tenantId: TENANT, snapshotId: correctionId, triggerId: 'm20.lead_contact_state', sourceClassId: 'mission20_business_contact_preferences', recordIdentityDigest: hash('record-identity'), canonicalDigest: sourceDigest, sourceDigest, eventBinding: { eventKind: 'transcript_occurred', eventTime: '2026-10-28T12:01:00.000000Z' }, currentness: { availability: 'available_exact_current', pinsDigest: hash('pins-2') }, provenance: { kind: 'authenticated_event', provenanceDigest: hash('provenance-2') }, lineage: { kind: 'correction', sequence: 2, predecessorSnapshotId: SNAPSHOT, predecessorSnapshotDigest: SNAPSHOT_DIGEST }, requestDigest: hash('snapshot-request-2'), snapshotDigest: correctionDigest, observedAt: '2026-10-28T12:01:01.000000Z' };
    const run = await seedRun(8, 1, [0]); const value = request(run, 8);
    const locker = await pool.connect();
    try {
      await locker.query('BEGIN'); await enter(locker);
      await locker.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text||':m28-source-lineage:m20.lead_contact_state:'||$2||':transcript_occurred',0))`, [TENANT, hash('record-identity')]);
      let settled = false; const pending = recover(value).then(result => { settled = true; return result; });
      await new Promise(resolve => setTimeout(resolve, 100)); expect(settled).toBe(false);
      await locker.query(`INSERT INTO public.canonical_automation_trigger_snapshots_v1 (organization_id,snapshot_id,trigger_id,source_class_id,record_identity_digest,canonical_digest,source_digest,event_kind,event_time,currentness_pins_digest,provenance_kind,provenance_digest,lineage_kind,lineage_sequence,predecessor_snapshot_id,predecessor_snapshot_digest,request_digest,snapshot_digest,request_text,canonical_text,document,retention_class,trusted_clock_contract,recorded_time_zone,observed_at) VALUES($1,$2,'m20.lead_contact_state','mission20_business_contact_preferences',$3,$4,$4,'transcript_occurred','2026-10-28T12:01:00Z',$5,'authenticated_event',$6,'correction',2,$7,$8,$9,$10,$11::text,$11::text,$11::jsonb,'source_snapshot_history','postgresql_statement_timestamp_v1','UTC','2026-10-28T12:01:01Z')`, [TENANT, correctionId, hash('record-identity'), sourceDigest, hash('pins-2'), hash('provenance-2'), SNAPSHOT, SNAPSHOT_DIGEST, hash('snapshot-request-2'), correctionDigest, canonical.canonicalize(document)]);
      await locker.query('COMMIT');
      expect(await pending).toEqual(expect.objectContaining({ resultState: 'blocked_source_not_latest_exact_current' }));
    } finally { await locker.query('ROLLBACK').catch(() => {}); locker.release(); }
  });

  test('preserves exact tenant then policy control evidence for committed unscheduled units', async () => {
    const tenantControl = scopeControl('tenant', 20, await now()); expect((await applyControl(tenantControl)).state).toBe('paused');
    const tenantRun = await seedRun(20, 1, []); const tenantValue = request(tenantRun, 20); expect((await recover(tenantValue)).resultState).toBe('blocked_source_not_latest_exact_current');
    const tenantDecisionDigest = (await tenantQuery(`SELECT decision_digest FROM public.canonical_automation_delivery_control_events_v1 WHERE organization_id=$1 AND control_id=$2`, [TENANT, tenantControl.controlId])).rows[0].decision_digest;
    expect((await tenantQuery(`SELECT schedule_id,item_state,control_id,control_decision_digest FROM public.canonical_automation_recovery_items_v1 WHERE organization_id=$1 AND recovery_id=$2`, [TENANT, tenantValue.recoveryId])).rows[0]).toEqual({ schedule_id: null, item_state: 'control_preserved_no_new_work', control_id: tenantControl.controlId, control_decision_digest: tenantDecisionDigest });
    const tenantCounts = (await tenantQuery(`SELECT controlled_count,unscheduled_count FROM public.canonical_automation_recovery_assessments_v1 WHERE organization_id=$1 AND recovery_id=$2`, [TENANT, tenantValue.recoveryId])).rows[0]; expect(tenantCounts).toEqual({ controlled_count: 1, unscheduled_count: 0 });

    const policyControl = scopeControl('policy_version', 21, await now()); expect((await applyControl(policyControl)).state).toBe('paused');
    const policyRun = await seedRun(21, 1, []); const policyValue = request(policyRun, 21); await recover(policyValue);
    const policyDecisionDigest = (await tenantQuery(`SELECT decision_digest FROM public.canonical_automation_delivery_control_events_v1 WHERE organization_id=$1 AND control_id=$2`, [TENANT, policyControl.controlId])).rows[0].decision_digest;
    const policyItem = (await tenantQuery(`SELECT schedule_id,item_state,control_id,control_decision_digest FROM public.canonical_automation_recovery_items_v1 WHERE organization_id=$1 AND recovery_id=$2`, [TENANT, policyValue.recoveryId])).rows[0];
    expect(policyItem).toEqual({ schedule_id: null, item_state: 'control_preserved_no_new_work', control_id: policyControl.controlId, control_decision_digest: policyDecisionDigest });
  });

  test('rejects a control head whose exact immutable sequence or count evidence was changed', async () => {
    const run = await seedRun(22, 1, []); const value = request(run, 22); const client = await pool.connect();
    try {
      await client.query('BEGIN'); await enter(client);
      const changed = await client.query(`UPDATE public.canonical_automation_delivery_control_heads_v1 SET queued_count=queued_count+1 WHERE organization_id=$1 AND target_kind='policy_version' AND policy_id=$2 AND policy_version=1`, [TENANT, POLICY]); expect(changed.rowCount).toBe(1);
      await expect(recover(value, null, client)).rejects.toThrow(/orphan control authority/i); await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    expect((await tenantQuery(`SELECT count(*)::integer count FROM public.canonical_automation_recovery_assessments_v1 WHERE organization_id=$1 AND recovery_id=$2`, [TENANT, value.recoveryId])).rows[0].count).toBe(0);
  });

  test('forced RLS hides both recovery tables from a role without entered tenant authority', async () => {
    const client = await pool.connect(); try { await client.query('BEGIN'); await client.query(`SET LOCAL ROLE ${quoteIdentifier(RLS_ROLE)}`); expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_recovery_assessments_v1')).rows[0].count).toBe(0); expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_recovery_items_v1')).rows[0].count).toBe(0); await client.query('ROLLBACK'); }
    finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });
});
