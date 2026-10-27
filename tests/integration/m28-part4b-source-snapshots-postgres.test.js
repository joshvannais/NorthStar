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
const ACTOR = '00000000-0000-4000-8000-000000000128';
const SESSION = '00000000-0000-4000-8000-000000000228';
const OTHER_ACTOR = '00000000-0000-4000-8000-000000000129';
const OTHER_SESSION = '00000000-0000-4000-8000-000000000229';
const RLS_ROLE = `m28_part4b_rls_${process.pid}`;
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;
const PART4A = JSON.parse(fs.readFileSync(path.join(ROOT,
  'docs/architecture/MISSION_28_PART4A_CLOSED_TRIGGER_CATALOG.json'), 'utf8'));

const copy = value => JSON.parse(JSON.stringify(value));
const digest = (namespace, value) => canonical.digest(`${namespace}\n`, value);

function sealProvenance(value) {
  const sealed = copy(value);
  const { provenanceDigest: _ignored, ...base } = sealed;
  sealed.provenanceDigest = digest('mission28.source-provenance.v1', base);
  return sealed;
}

function buildRequest(overrides = {}) {
  const eventKind = overrides.eventKind || 'transcript_occurred';
  const eventTime = overrides.eventTime || '2026-10-27T22:00:00.000000Z';
  const sourceField = overrides.sourceField || (eventKind === 'communication_occurred'
    ? 'timestamps.communicationOccurredAt' : 'timestamps.transcriptOccurredAt');
  const sourceStateSelector = overrides.sourceStateSelector || (eventKind === 'communication_occurred'
    ? 'ids.communication=present' : 'ids.transcript=present');
  const recordIdentity = overrides.recordIdentity || {
    tenantId: TENANT, canonicalGraphId: 'graph-m28-4b', customerId: 'customer-m28-4b', opportunityId: 'opportunity-m28-4b',
  };
  const pins = overrides.pins || {
    sourceType: 'canonical_graph', sourceVersion: overrides.version || 'version-1',
    projectionDigest: overrides.canonicalDigest || `sha256:${'1'.repeat(64)}`,
    opportunityStatus: 'qualified', eventKind, eventTime,
  };
  const provenance = overrides.provenance || sealProvenance({
    kind: 'actor', tenantId: recordIdentity.tenantId, actorId: ACTOR, sessionId: SESSION,
    membershipId: ACTOR, authenticatedEventId: null, authenticatedEventAuthority: null,
    authenticatedEventDigest: null, provenanceDigest: '',
  });
  const request = {
    schemaVersion: 'mission28.source-snapshot.request.v1', tenantId: recordIdentity.tenantId,
    snapshotId: overrides.snapshotId || '00000000-0000-4000-8000-000000000401',
    triggerId: 'm20.lead_contact_state', sourceClassId: 'mission20_business_contact_preferences',
    ownerMission: 'Mission 20', factKind: 'lead_contact_state', recordIdentity,
    recordIdentityDigest: digest('mission28.source-record-identity.v1', recordIdentity),
    sourceVersion: { kind: 'version', version: overrides.version || 'version-1', revision: null },
    canonicalDigest: overrides.canonicalDigest || `sha256:${'1'.repeat(64)}`,
    sourceDigest: overrides.sourceDigest || overrides.canonicalDigest || `sha256:${'1'.repeat(64)}`,
    eventBinding: { eventKind, eventTime, sourceField, sourceStateSelector },
    currentness: { availability: 'available_exact_current', pins,
      pinsDigest: digest('mission28.source-currentness-pins.v1', pins) },
    provenance,
    lineage: overrides.lineage || { kind: 'original', sequence: 1,
      predecessorSnapshotId: null, predecessorSnapshotDigest: null },
    requestDigest: '',
  };
  const { requestDigest: _ignored, ...base } = request;
  request.requestDigest = digest('mission28.source-snapshot.request.v1', base);
  return request;
}

function reseal(request) {
  request.recordIdentityDigest = digest('mission28.source-record-identity.v1', request.recordIdentity);
  request.currentness.pinsDigest = digest('mission28.source-currentness-pins.v1', request.currentness.pins);
  const { provenanceDigest: _ignoredProvenance, ...provenanceBase } = request.provenance;
  request.provenance.provenanceDigest = digest('mission28.source-provenance.v1', provenanceBase);
  const { requestDigest: _ignoredRequest, ...requestBase } = request;
  request.requestDigest = digest('mission28.source-snapshot.request.v1', requestBase);
  return request;
}

realPostgres('Mission 28 Part 4B PostgreSQL source snapshots through migration 274', () => {
  let database;
  let pool;
  let migrations;
  let original;

  async function store(request, trusted = request.provenance) {
    return (await pool.query('SELECT public.canonical_automation_store_trigger_snapshot_v1($1,$2::jsonb) result',
      [canonical.canonicalize(request), JSON.stringify(trusted)])).rows[0].result;
  }

  beforeAll(async () => {
    database = await createSuiteDatabase('m28-p4b-snapshots');
    pool = new Pool({ connectionString: database.connectionString, max: 4 });
    migrations = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m28-p4b-through273-'));
    for (const name of fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => /^\d+.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 273)) {
      fs.copyFileSync(path.join(ROOT, 'migrations', name), path.join(migrations, name));
    }
    const db = require('../../src/db');
    await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`INSERT INTO public.organizations(id,name,email) VALUES
      ($1,'Mission 28 Part 4B tenant','m28-part4b@example.test'),
      ($2,'Mission 28 Part 4B other','m28-part4b-other@example.test')`, [TENANT, OTHER]);
    await pool.query(`INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status) VALUES
      ($1,$2,'Part 4B owner','m28-part4b-owner@example.test','unused','owner','active'),
      ($3,$4,'Part 4B other','m28-part4b-other-owner@example.test','unused','owner','active')`,
    [ACTOR, TENANT, OTHER_ACTOR, OTHER]);
    await pool.query(`INSERT INTO public.organization_memberships(id,organization_id,user_id,role,status) VALUES
      ($1,$2,$1,'owner','active'),($3,$4,$3,'owner','active')`, [ACTOR, TENANT, OTHER_ACTOR, OTHER]);
    await pool.query(`INSERT INTO public.auth_sessions
      (id,user_id,organization_id,membership_id,status,access_expires_at,refresh_expires_at,csrf_token_hash)
      VALUES ($1,$2,$3,$2,'active',NOW()+INTERVAL '1 hour',NOW()+INTERVAL '2 hours',$4),
             ($5,$6,$7,$6,'active',NOW()+INTERVAL '1 hour',NOW()+INTERVAL '2 hours',$8)`,
    [SESSION, ACTOR, TENANT, '1'.repeat(64), OTHER_SESSION, OTHER_ACTOR, OTHER, '2'.repeat(64)]);
    fs.copyFileSync(path.join(ROOT, 'migrations', '274_canonical_automation_trigger_snapshots_v1.sql'),
      path.join(migrations, '274_canonical_automation_trigger_snapshots_v1.sql'));
    await db.runMigrations({ pool, migrationsDirectory: migrations });
    await db.runMigrations({ pool, migrationsDirectory: migrations });
    await pool.query(`CREATE ROLE ${quoteIdentifier(RLS_ROLE)} NOLOGIN`);
    await pool.query(`GRANT SELECT ON public.canonical_automation_trigger_snapshots_v1 TO ${quoteIdentifier(RLS_ROLE)}`);
  }, 300000);

  afterAll(async () => {
    if (pool) {
      await pool.query(`REVOKE ALL ON public.canonical_automation_trigger_snapshots_v1 FROM ${quoteIdentifier(RLS_ROLE)}`).catch(() => {});
      await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(RLS_ROLE)}`).catch(() => {});
    }
    if (pool) await pool.end();
    if (database) await database.cleanup();
    if (migrations && path.dirname(migrations) === os.tmpdir()) fs.rmSync(migrations, { recursive: true, force: true });
  }, 180000);

  test('upgrade is additive, closed, revoked and catalog-exact', async () => {
    expect((await pool.query('SELECT max(substring(filename,1,3)::integer) latest,count(*)::integer total FROM public._migrations')).rows[0])
      .toEqual({ latest: 274, total: 270 });
    expect((await pool.query('SELECT count(*)::integer count FROM public.canonical_automation_trigger_catalog_v1')).rows[0].count).toBe(19);
    expect((await pool.query(`SELECT count(*)::integer count
      FROM public.canonical_automation_trigger_catalog_v1 catalog
      CROSS JOIN LATERAL jsonb_object_keys(catalog.event_kinds)`)).rows[0].count).toBe(36);
    expect((await pool.query(`SELECT
      has_function_privilege('public','public.canonical_automation_store_trigger_snapshot_v1(text,jsonb)','EXECUTE') public_execute,
      has_table_privilege('public','public.canonical_automation_trigger_snapshots_v1','SELECT') public_read`)).rows[0])
      .toEqual({ public_execute: false, public_read: false });
    const rows = (await pool.query(`SELECT trigger_id,source_class_id,owner_mission,fact_kind,
      record_identity_keys,currentness_pin_keys,event_kinds,version_pin,revision_pin
      FROM public.canonical_automation_trigger_catalog_v1 ORDER BY trigger_id`)).rows;
    expect(rows).toHaveLength(PART4A.triggers.length);
    for (const trigger of PART4A.triggers) {
      const row = rows.find(candidate => candidate.trigger_id === trigger.id);
      expect(row).toMatchObject({ source_class_id: trigger.sourceClassId,
        owner_mission: `Mission ${trigger.ownerMission}`, fact_kind: trigger.factKind,
        record_identity_keys: trigger.grain, currentness_pin_keys: trigger.currentness.pins });
      expect(row.event_kinds).toEqual(Object.fromEntries(trigger.eventTime.kinds.map(kind => [kind.eventKind, {
        sourceField: kind.sourceField, sourceStateSelector: kind.sourceStateSelector,
      }])));
      expect(Number(row.version_pin !== null) + Number(row.revision_pin !== null)).toBe(1);
    }
  }, 120000);

  test('stores one exact snapshot, replays deterministically and captures trusted observedAt separately', async () => {
    original = buildRequest();
    const first = await store(original);
    expect(first).toMatchObject({ state: 'stored', replayed: false, snapshotId: original.snapshotId });
    expect(first.observedAt).not.toBe(original.eventBinding.eventTime);
    expect(await store(original)).toEqual({ ...first, replayed: true });
    const row = (await pool.query(`SELECT document,event_time,observed_at,source_digest,canonical_digest,lineage_sequence
      FROM public.canonical_automation_trigger_snapshots_v1 WHERE organization_id=$1 AND snapshot_id=$2`,
    [TENANT, original.snapshotId])).rows[0];
    expect(row.document.observedAt).toBe(first.observedAt);
    expect(row.document).not.toHaveProperty('upstreamPayload');
    expect(row.event_time.toISOString()).toBe('2026-10-27T22:00:00.000Z');
    expect(row.observed_at.getTime()).not.toBe(row.event_time.getTime());
    expect(row.lineage_sequence).toBe('1');
  }, 120000);

  test('appends one exact correction and rejects forks, nonadjacent lineage and no-op corrections', async () => {
    const correction = buildRequest({ snapshotId: '00000000-0000-4000-8000-000000000402',
      version: 'version-2', canonicalDigest: `sha256:${'2'.repeat(64)}`, lineage: {
        kind: 'correction', sequence: 2, predecessorSnapshotId: original.snapshotId,
        predecessorSnapshotDigest: (await store(original)).snapshotDigest,
      } });
    expect(await store(correction)).toMatchObject({ state: 'stored', replayed: false, snapshotId: correction.snapshotId });

    const fork = reseal({ ...copy(correction), snapshotId: '00000000-0000-4000-8000-000000000403' });
    await expect(store(fork)).rejects.toThrow(/correction predecessor|duplicate key/i);
    const noOp = buildRequest({ snapshotId: '00000000-0000-4000-8000-000000000404', lineage: {
      kind: 'correction', sequence: 2, predecessorSnapshotId: original.snapshotId,
      predecessorSnapshotDigest: (await store(original)).snapshotDigest,
    } });
    await expect(store(noOp)).rejects.toThrow(/correction predecessor/i);
    expect((await pool.query('SELECT count(*)::integer count FROM public.canonical_automation_trigger_snapshots_v1')).rows[0].count).toBe(2);
  }, 120000);

  test('keeps an independent immutable lineage for each explicit Part 4A event kind at one record grain', async () => {
    const communication = buildRequest({ snapshotId: '00000000-0000-4000-8000-000000000407',
      eventKind: 'communication_occurred', eventTime: '2026-10-27T22:00:03.000000Z' });
    await expect(store(communication)).resolves.toMatchObject({ state: 'stored', replayed: false,
      snapshotId: communication.snapshotId });
    expect((await pool.query(`SELECT count(*)::integer count
      FROM public.canonical_automation_trigger_snapshots_v1
      WHERE organization_id=$1 AND trigger_id=$2 AND record_identity_digest=$3`,
    [TENANT, communication.triggerId, communication.recordIdentityDigest])).rows[0].count).toBe(3);
  }, 120000);

  test.each([
    ['unknown trigger', value => { value.triggerId = 'm20.unknown'; }],
    ['source class substitution', value => { value.sourceClassId = 'mission21_knowledge_reference'; }],
    ['record identity unknown key', value => { value.recordIdentity.hidden = 'value'; }],
    ['record identity cross tenant', value => { value.recordIdentity.tenantId = OTHER; value.tenantId = OTHER; }],
    ['version pin mismatch', value => { value.currentness.pins.sourceVersion = 'version-9'; }],
    ['canonical digest mismatch', value => { value.canonicalDigest = `sha256:${'9'.repeat(64)}`; }],
    ['event kind substitution', value => { value.eventBinding.eventKind = 'unknown_event'; value.currentness.pins.eventKind = 'unknown_event'; }],
    ['event source field substitution', value => { value.eventBinding.sourceField = 'observedAt'; }],
    ['event time substitution', value => { value.eventBinding.eventTime = '2026-10-27T22:00:01.000000Z'; }],
    ['stale state', value => { value.currentness.availability = 'stale'; }],
    ['unsupported version and revision kind', value => {
      value.sourceVersion = { kind: 'version_revision', version: 'version-1', revision: 1 };
    }],
    ['unsupported tombstone lineage', value => { value.lineage.kind = 'tombstone'; }],
    ['candidate observedAt', value => { value.observedAt = '2026-10-27T22:00:02.000000Z'; }],
    ['actor substitution', value => { value.provenance.actorId = OTHER_ACTOR; }],
    ['session substitution', value => { value.provenance.sessionId = OTHER_SESSION; }],
    ['NULL record identity', value => { value.recordIdentity = null; }],
    ['NULL currentness', value => { value.currentness = null; }],
  ])('rejects %s before storage', async (_name, mutate) => {
    const attack = copy(buildRequest({ snapshotId: crypto.randomUUID() }));
    mutate(attack);
    if (attack.recordIdentity && attack.currentness && attack.provenance) reseal(attack);
    await expect(store(attack, attack.provenance)).rejects.toThrow();
  }, 120000);

  test('accepts only separately supplied exact authenticated-event provenance', async () => {
    const provenance = sealProvenance({ kind: 'authenticated_event', tenantId: TENANT,
      actorId: null, sessionId: null, membershipId: null,
      authenticatedEventId: 'm28-part4b-event-1',
      authenticatedEventAuthority: 'server_resolved_upstream_authenticated_event_v1',
      authenticatedEventDigest: `sha256:${'3'.repeat(64)}`, provenanceDigest: '' });
    const request = buildRequest({ snapshotId: '00000000-0000-4000-8000-000000000406', provenance,
      recordIdentity: { tenantId: TENANT, canonicalGraphId: 'graph-m28-4b-event',
        customerId: 'customer-m28-4b-event', opportunityId: 'opportunity-m28-4b-event' } });
    await expect(store(request, provenance)).resolves.toMatchObject({ state: 'stored', replayed: false });
    const substituted = sealProvenance({ ...provenance, authenticatedEventId: 'm28-part4b-event-2' });
    await expect(store(request, substituted)).rejects.toThrow(/provenance shape/i);
  }, 120000);

  test('requires separately supplied trusted provenance and exact active actor-session-membership binding', async () => {
    const request = buildRequest({ snapshotId: '00000000-0000-4000-8000-000000000405' });
    const substituted = copy(request.provenance);
    substituted.actorId = OTHER_ACTOR;
    const { provenanceDigest: _ignored, ...substitutedBase } = substituted;
    substituted.provenanceDigest = digest('mission28.source-provenance.v1', substitutedBase);
    await expect(store(request, substituted)).rejects.toThrow(/provenance shape/i);
    await pool.query('UPDATE public.auth_sessions SET status=$1,revoked_at=NOW(),revoke_reason=$2 WHERE id=$3',
      ['revoked', 'test', SESSION]);
    await expect(store(request)).rejects.toThrow(/provenance unavailable/i);
  }, 120000);

  test('forced RLS never exposes a second tenant and rows are immutable', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${quoteIdentifier(RLS_ROLE)}`);
      await client.query("SELECT set_config('northstar.automation_tenant_id',$1,TRUE)", [OTHER]);
      expect((await client.query('SELECT count(*)::integer count FROM public.canonical_automation_trigger_snapshots_v1')).rows[0].count).toBe(0);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    await expect(pool.query('UPDATE public.canonical_automation_trigger_snapshots_v1 SET event_kind=event_kind'))
      .rejects.toThrow(/append-only/i);
    await expect(pool.query('DELETE FROM public.canonical_automation_trigger_snapshots_v1'))
      .rejects.toThrow(/append-only/i);
  }, 120000);
});
