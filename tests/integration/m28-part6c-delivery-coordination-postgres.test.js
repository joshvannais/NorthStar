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
const RLS_ROLE = `m28_part6c_rls_${process.pid}`;
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const hash = value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const copy = value => JSON.parse(JSON.stringify(value));
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;

function reseal(value) {
  value.workerBinding.workerIdentityDigest = canonical.digest('mission28.delivery-worker.v1\n', Object.fromEntries(Object.entries(value.workerBinding).filter(([key]) => key !== 'workerIdentityDigest')));
  value.requestDigest = canonical.digest('mission28.delivery-lease.request.v1\n', Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestDigest')));
  return value;
}
function claimRequest(action, suffix, expectedPriorFenceToken = 0) {
  return reseal({
    schemaVersion: 'mission28.delivery-lease.request.v1', tenantId: TENANT, leaseRequestId: uuid(50000 + suffix),
    scheduleBinding: { scheduleId: action.scheduleId, transactionId: action.transactionId, runId: action.runId,
      unitId: action.unitId, outboxId: action.outboxId, unitDigest: action.unitDigest, scheduleBindingDigest: action.scheduleBindingDigest },
    workerBinding: { workerId: uuid(51000 + suffix), processId: uuid(52000 + suffix), deploymentId: uuid(53000 + suffix), regionId: 'us-east-1', workerIdentityDigest: '' },
    leaseBinding: { leaseId: uuid(54000 + suffix), expectedPriorFenceToken, durationSeconds: 30 }, requestDigest: '',
  });
}
const trusted = value => ({ tenantId: value.tenantId, scheduleBinding: value.scheduleBinding, workerBinding: value.workerBinding });

realPostgres('Mission 28 Part 6C PostgreSQL delivery coordination through migration 277', () => {
  let database; let pool; let migrations;
  async function enter(client, tenant = TENANT) { await client.query('SELECT public.canonical_automation_enter_tenant_v1($1)', [tenant]); }
  async function claim(value, resolution = trusted(value), client = pool) {
    return (await client.query('SELECT public.canonical_automation_claim_scheduled_action_v1($1,$2::jsonb) result', [canonical.canonicalize(value), JSON.stringify(resolution)])).rows[0].result;
  }
  async function reserve(value, leaseId, fence, client = pool) {
    return (await client.query('SELECT public.canonical_automation_reserve_provider_request_identity_v1($1,$2,$3,$4) result', [TENANT, value.scheduleBinding.scheduleId, leaseId, fence])).rows[0].result;
  }
  async function tenantQuery(text, values = [], tenant = TENANT) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await enter(client, tenant); const result = await client.query(text, values); await client.query('COMMIT'); return result; }
    finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }
  async function seedTransaction(suffix, unitCount = 1) {
    const transactionId = uuid(10000 + suffix); const runId = uuid(11000 + suffix);
    const actionUnits = Array.from({ length: unitCount }, (_, unitIndex) => ({
      unitId: uuid(12000 + suffix * 32 + unitIndex), outboxId: uuid(200000 + suffix * 32 + unitIndex), unitIndex,
      unitDigest: hash(`unit-${suffix}-${unitIndex}`), materialDigest: hash(`material-${suffix}-${unitIndex}`),
      idempotencyKeyDigest: hash(`idempotency-${suffix}-${unitIndex}`), scheduleId: uuid(300000 + suffix * 32 + unitIndex),
      scheduleBindingDigest: hash(`schedule-${suffix}-${unitIndex}`),
    }));
    const document = { tenantId: TENANT, transactionId, runId, policyBinding: { policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST },
      sourceBinding: { sourceSetDigest: SOURCE_SET_DIGEST, snapshotIds: [SNAPSHOT], snapshotDigests: [SNAPSHOT_DIGEST] },
      actionUnits: actionUnits.map(item => ({ unitId: item.unitId })), requestDigest: hash(`transaction-${suffix}`) };
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await enter(client);
      await client.query(`INSERT INTO public.canonical_automation_action_transactions_v1
       (organization_id,transaction_id,run_id,policy_id,policy_version,policy_digest,source_set_digest,decision_digest,
        authorization_digest,currentness_digest,request_digest,unit_count,canonical_text,document,retention_class,
        trusted_clock_contract,recorded_time_zone,recorded_at)
       VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,$12::text,$12::jsonb,'decision_history',
        'postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, transactionId, runId, POLICY, POLICY_DIGEST,
        SOURCE_SET_DIGEST, hash(`decision-${suffix}`), hash(`authorization-${suffix}`), hash(`currentness-${suffix}`),
        document.requestDigest, unitCount, canonical.canonicalize(document)]);
      for (const item of actionUnits) {
        await client.query(`INSERT INTO public.canonical_automation_action_units_v1
         (organization_id,transaction_id,unit_id,run_id,unit_index,action_family_id,action_template_id,action_template_digest,
          recipient_set_digest,channel_id,provider_mode,effect_class,material_digest,idempotency_key_digest,unit_digest,state,recorded_at)
         VALUES($1,$2,$3,$4,$5,'internal_read_digest_task','internal_fact_digest_v1',$6,$7,'in_app_passive',
          'provider_disabled','internal_record_only',$8,$9,$10,'committed_unpublished',statement_timestamp())`,
        [TENANT, transactionId, item.unitId, runId, item.unitIndex, hash(`template-${suffix}-${item.unitIndex}`),
          hash(`recipient-${suffix}-${item.unitIndex}`), item.materialDigest, item.idempotencyKeyDigest, item.unitDigest]);
        await client.query(`INSERT INTO public.canonical_automation_action_outbox_v1
         (organization_id,outbox_id,transaction_id,unit_id,unit_digest,state,queue_publication_id,queue_published_at,claim_id,lease_expires_at,recorded_at)
         VALUES($1,$2,$3,$4,$5,'committed_unpublished',NULL,NULL,NULL,NULL,statement_timestamp())`,
        [TENANT, item.outboxId, transactionId, item.unitId, item.unitDigest]);
        const due = new Date(Date.now() - 60000); due.setUTCMilliseconds(0);
        const expiration = new Date(due.getTime() + 300 * 24 * 60 * 60 * 1000);
        const utcInstant = due.toISOString().replace('.000Z', '.000000Z');
        const expiresAt = expiration.toISOString().replace('.000Z', '.000000Z');
        const localDate = utcInstant.slice(0, 10); const localTime = utcInstant.slice(11, 19);
        const scheduleDocument = { tenantId: TENANT, scheduleId: item.scheduleId, transactionId, runId,
          unitBinding: { unitId: item.unitId, outboxId: item.outboxId, unitDigest: item.unitDigest },
          policyBinding: { policyId: POLICY, policyVersion: 1, policyDigest: POLICY_DIGEST }, sourceBinding: { sourceSetDigest: SOURCE_SET_DIGEST },
          localSchedule: { tenantTimeZone: 'UTC', localDate, localTime, utcInstant, foldResolution: 'not_ambiguous' },
          calendarBinding: { calendarId: uuid(400000 + suffix), calendarVersion: 1, calendarDigest: hash(`calendar-${suffix}`), calendarState: 'exact_current', tenantTimeZone: 'UTC' },
          expirationBinding: { expiresAt }, trustedClockBinding: { contract: 'postgresql_statement_timestamp_v1' },
          scheduleBindingDigest: item.scheduleBindingDigest, requestDigest: hash(`schedule-request-${suffix}-${item.unitIndex}`) };
        await client.query(`INSERT INTO public.canonical_automation_action_schedules_v1
         (organization_id,schedule_id,transaction_id,run_id,unit_id,outbox_id,unit_digest,policy_id,policy_version,policy_digest,
          source_set_digest,tenant_time_zone,local_date,local_time,utc_instant,fold_resolution,calendar_id,calendar_version,
          calendar_digest,schedule_binding_digest,expires_at,request_digest,state,canonical_text,document,retention_class,
          trusted_clock_contract,recorded_time_zone,recorded_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,'UTC',$11::date,$12::time,$13::timestamptz,
          'not_ambiguous',$14,1,$15,$16,$17::timestamptz,$18,'scheduled_unpublished',$19::text,$19::jsonb,
          'decision_history','postgresql_statement_timestamp_v1','UTC',statement_timestamp())`, [TENANT, item.scheduleId,
          transactionId, runId, item.unitId, item.outboxId, item.unitDigest, POLICY, POLICY_DIGEST, SOURCE_SET_DIGEST,
          localDate, localTime, utcInstant, scheduleDocument.calendarBinding.calendarId,
          scheduleDocument.calendarBinding.calendarDigest, item.scheduleBindingDigest, expiresAt,
          scheduleDocument.requestDigest, canonical.canonicalize(scheduleDocument)]);
      }
      await client.query('COMMIT'); return actionUnits.map(item => ({ ...item, transactionId, runId }));
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  }

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p6c-coordination'); pool = new Pool({ connectionString: database.connectionString, max: 8 });
    migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p6c-through277-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 277)) fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    const db = require('../../src/db'); await db.runMigrations({ pool, migrationsDirectory: migrations });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO public.organizations(id,name,email) VALUES
       ($1,'Mission 28 Part 6C tenant','m28-part6c@example.test'),($2,'Mission 28 Part 6C other','m28-part6c-other@example.test')`, [TENANT, OTHER]);
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
      const snapshotDocument = { tenantId: TENANT, snapshotId: SNAPSHOT, triggerId: 'm20.lead_contact_state',
        sourceClassId: 'mission20_business_contact_preferences', recordIdentityDigest: hash('record-identity'),
        canonicalDigest: SOURCE_DIGEST, sourceDigest: SOURCE_DIGEST,
        eventBinding: { eventKind: 'transcript_occurred', eventTime: '2026-10-28T12:00:00.000000Z' },
        currentness: { availability: 'available_exact_current', pinsDigest: hash('pins') },
        provenance: { kind: 'authenticated_event', provenanceDigest: hash('provenance') },
        lineage: { kind: 'original', sequence: 1 }, requestDigest: hash('snapshot-request'),
        snapshotDigest: SNAPSHOT_DIGEST, observedAt: '2026-10-28T12:00:01.000000Z' };
      await client.query(`INSERT INTO public.canonical_automation_trigger_snapshots_v1
       (organization_id,snapshot_id,trigger_id,source_class_id,record_identity_digest,canonical_digest,source_digest,event_kind,
        event_time,currentness_pins_digest,provenance_kind,provenance_digest,lineage_kind,lineage_sequence,predecessor_snapshot_id,
        predecessor_snapshot_digest,request_digest,snapshot_digest,request_text,canonical_text,document,retention_class,
        trusted_clock_contract,recorded_time_zone,observed_at)
       VALUES($1,$2,'m20.lead_contact_state','mission20_business_contact_preferences',$3,$4,$4,'transcript_occurred',
        '2026-10-28T12:00:00Z',$5,'authenticated_event',$6,'original',1,NULL,NULL,$7,$8,$9::text,$9::text,$9::jsonb,
        'source_snapshot_history','postgresql_statement_timestamp_v1','UTC','2026-10-28T12:00:01Z')`,
      [TENANT, SNAPSHOT, hash('record-identity'), SOURCE_DIGEST, hash('pins'), hash('provenance'), hash('snapshot-request'), SNAPSHOT_DIGEST, canonical.canonicalize(snapshotDocument)]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`CREATE ROLE ${quoteIdentifier(RLS_ROLE)} NOLOGIN`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_delivery_lease_events_v1,public.canonical_automation_provider_request_receipts_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
  }, 300000);

  afterAll(async () => {
    if (pool) { await pool.query(`REVOKE ALL ON public.canonical_automation_delivery_lease_events_v1,public.canonical_automation_provider_request_receipts_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(RLS_ROLE)}`).catch(() => {}); await pool.end(); }
    if (database) await database.cleanup();
    if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('migration 277 is additive, forced-RLS, owner-only and mounts no runtime effect path', async () => {
    expect((await pool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0]).toEqual({ latest: 277, total: 273 });
    const relations = (await pool.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname`,
      [['canonical_automation_delivery_lease_events_v1','canonical_automation_delivery_lease_heads_v1','canonical_automation_provider_request_receipts_v1']])).rows;
    expect(relations).toHaveLength(3); expect(relations.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect((await pool.query(`SELECT has_function_privilege('public','public.canonical_automation_claim_scheduled_action_v1(text,jsonb)','EXECUTE') allowed`)).rows[0].allowed).toBe(false);
    expect((await pool.query(`SELECT has_function_privilege('public','public.canonical_automation_reserve_provider_request_identity_v1(uuid,uuid,uuid,bigint)','EXECUTE') allowed`)).rows[0].allowed).toBe(false);
  });

  test('serializes complete fan-out in exact unit order and derives stable no-effect receipts', async () => {
    const [firstAction, secondAction] = await seedTransaction(1, 2); const second = claimRequest(secondAction, 2);
    await expect(claim(second)).rejects.toThrow(/order/i);
    const first = claimRequest(firstAction, 1); const firstLease = await claim(first);
    expect(firstLease).toEqual(expect.objectContaining({ replayed: false, fenceToken: 1, state: 'lease_acquired_no_effect' }));
    expect(await claim(copy(first))).toEqual(expect.objectContaining({ replayed: true, fenceToken: 1 }));
    const secondLease = await claim(second); expect(secondLease.fenceToken).toBe(1);
    const receipt = await reserve(first, first.leaseBinding.leaseId, 1);
    expect(receipt).toEqual(expect.objectContaining({ replayed: false, providerRequestIdentity: `m28:${firstAction.unitId}`, state: 'identity_reserved_no_provider_attempt_or_ack' }));
    expect(await reserve(first, first.leaseBinding.leaseId, 1)).toEqual(expect.objectContaining({ replayed: true, providerRequestDigest: receipt.providerRequestDigest }));
    await expect(reserve(first, uuid(999), 999)).rejects.toThrow(/fenced lease/i);
  }, 120000);

  test('concurrent claims permit one fence and reject the competing active lease', async () => {
    const [action] = await seedTransaction(2); const left = claimRequest(action, 10); const right = claimRequest(action, 11);
    const results = await Promise.allSettled([claim(left), claim(right)]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(item => item.status === 'rejected')).toHaveLength(1);
    expect((await tenantQuery('SELECT count(*)::integer count,max(fence_token)::bigint fence FROM public.canonical_automation_delivery_lease_events_v1 WHERE organization_id=$1 AND schedule_id=$2', [TENANT, action.scheduleId])).rows[0]).toEqual({ count: 1, fence: '1' });
  }, 120000);

  test('expired takeover requires the exact prior fence and increments once', async () => {
    const [action] = await seedTransaction(3); const first = claimRequest(action, 20); await claim(first);
    const originalReceipt = await reserve(first, first.leaseBinding.leaseId, 1);
    await tenantQuery(`UPDATE public.canonical_automation_delivery_lease_heads_v1
      SET lease_acquired_at=statement_timestamp()-INTERVAL '2 seconds',lease_expires_at=statement_timestamp()-INTERVAL '1 second'
      WHERE organization_id=$1 AND schedule_id=$2`, [TENANT, action.scheduleId]);
    const stale = claimRequest(action, 21, 0); await expect(claim(stale)).rejects.toThrow(/fence/i);
    const next = claimRequest(action, 22, 1); expect(await claim(next)).toEqual(expect.objectContaining({ fenceToken: 2 }));
    await expect(reserve(first, first.leaseBinding.leaseId, 1)).rejects.toThrow(/fence/i);
    expect(await reserve(next, next.leaseBinding.leaseId, 2)).toEqual(expect.objectContaining({
      replayed: true, providerRequestDigest: originalReceipt.providerRequestDigest,
    }));
  }, 120000);

  test('rejects trusted schedule or worker substitution and leaves zero lease residue', async () => {
    const [action] = await seedTransaction(4); const value = claimRequest(action, 30); const before = (await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_delivery_lease_events_v1')).rows[0].count;
    const resolution = copy(trusted(value)); resolution.workerBinding.regionId = 'other-region';
    await expect(claim(value, resolution)).rejects.toThrow(/trusted/i);
    const changed = copy(value); changed.scheduleBinding.unitDigest = hash('wrong'); reseal(changed); await expect(claim(changed, trusted(changed))).rejects.toThrow();
    const crossTenant = copy(value); crossTenant.tenantId = OTHER; reseal(crossTenant); await expect(claim(crossTenant, trusted(crossTenant))).rejects.toThrow(/unavailable/i);
    expect((await tenantQuery('SELECT count(*)::integer count FROM public.canonical_automation_delivery_lease_events_v1')).rows[0].count).toBe(before);
  }, 120000);

  test('forced RLS hides evidence, immutable rows reject mutation, and Part 6A/B state remains unchanged', async () => {
    const [action] = await seedTransaction(5); const value = claimRequest(action, 40); await claim(value); await reserve(value, value.leaseBinding.leaseId, 1);
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query('SET LOCAL ROLE ' + quoteIdentifier(RLS_ROLE)); await client.query("SELECT set_config('northstar.automation_tenant_id',$1,true)", [TENANT]);
      expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_delivery_lease_events_v1')).rows[0].count).toBe(0); await client.query('ROLLBACK');
      await client.query('BEGIN'); await enter(client); await expect(client.query('DELETE FROM public.canonical_automation_provider_request_receipts_v1 WHERE organization_id=$1 AND schedule_id=$2', [TENANT, action.scheduleId])).rejects.toThrow(); await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    const state = (await tenantQuery(`SELECT o.state outbox_state,o.queue_publication_id,o.claim_id,s.state schedule_state
      FROM public.canonical_automation_action_outbox_v1 o JOIN public.canonical_automation_action_schedules_v1 s USING(organization_id,outbox_id)
      WHERE o.organization_id=$1 AND o.outbox_id=$2`, [TENANT, action.outboxId])).rows[0];
    expect(state).toEqual({ outbox_state: 'committed_unpublished', queue_publication_id: null, claim_id: null, schedule_state: 'scheduled_unpublished' });
  }, 120000);
});
