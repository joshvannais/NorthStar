'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { operationalTableArea } = require('../helpers/m25-part14a-table-inventory');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isolatedDemoTables = new Set([
  'canonical_demo_authority', 'demo_command_center_admission_windows', 'demo_command_center_mutations',
  'demo_command_center_sessions', 'demo_customer_estimate_delivery_events', 'demo_customer_estimate_delivery_links',
  'demo_polaris_provider_requests', 'demo_polaris_provider_windows', 'homepage_demo_admission_windows',
  'homepage_demo_purge_operations',
]);
const expectedLaborImportChanges = new Set([
  'canonical_external_labor_import_consents',
  'canonical_external_labor_import_records',
  'canonical_external_labor_import_runs',
]);

function laborRecord(index, version = 1) {
  const day = String((index % 27) + 1).padStart(2, '0');
  return {
    externalRecordId: `bounded-record-${String(index).padStart(3, '0')}`,
    externalVersion: version,
    state: 'active',
    workerReference: `crew-${index % 5}`,
    jobReference: `bounded-job-${String(index).padStart(3, '0')}`,
    category: 'production',
    observedStart: `2026-07-${day}T13:00:00.000Z`,
    observedEnd: `2026-07-${day}T14:00:00.000Z`,
    sourceUpdatedAt: `2026-07-${day}T14:05:00.000Z`,
  };
}

realPostgres('Mission 25 Part 14D bounded operational proof', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 180000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('bounds workload, serializes races, recovers from backpressure and emits safe telemetry without operating-state mutation', async () => {
    const owner = fixture.actors.owner;
    const sourceKey = 'part14d.operational-proof';
    const root = `/api/v1/learning/external-labor-sources/${sourceKey}`;
    const secrets = new Set([sourceKey, fixture.org]);
    const telemetry = [];
    const info = jest.spyOn(console, 'info').mockImplementation(value => {
      if (value && value.component === 'http' && value.event === 'request_completed') telemetry.push(value);
    });
    const post = (suffix, body, key = crypto.randomUUID()) => {
      secrets.add(key);
      return request(fixture.app).post(root + suffix).set(owner.session.headers)
        .set('X-CSRF-Token', owner.csrfToken).set('Idempotency-Key', key).send(body);
    };
    const digest = async entry => {
      expect(entry.name).toMatch(/^[a-z][a-z0-9_]*$/);
      const where = entry.tenantOwned ? ' WHERE organization_id=$1' : '';
      return (await fixture.ownerPool.query(
        `SELECT count(*)::integer count,encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(subject) ORDER BY to_jsonb(subject)::text),'[]'::jsonb)::text,'UTF8')),'hex') digest FROM public.${entry.name} subject${where}`,
        entry.tenantOwned ? [fixture.org] : [])).rows[0];
    };
    const catalog = (await fixture.ownerPool.query("SELECT class.relname name,EXISTS(SELECT 1 FROM pg_catalog.pg_attribute attribute WHERE attribute.attrelid=class.oid AND attribute.attname='organization_id' AND attribute.attnum>0 AND NOT attribute.attisdropped) tenant_owned FROM pg_catalog.pg_class class JOIN pg_catalog.pg_namespace namespace ON namespace.oid=class.relnamespace WHERE namespace.nspname='public' AND class.relkind IN('r','p') ORDER BY class.relname")).rows;
    const guarded = catalog.filter(entry => {
      const area = operationalTableArea(entry.name);
      return (area && area !== 'externalSourceAuthority') || isolatedDemoTables.has(entry.name) ||
        (area === 'externalSourceAuthority' && !expectedLaborImportChanges.has(entry.name));
    }).map(entry => {
      const area = operationalTableArea(entry.name);
      return { name: entry.name, tenantOwned: entry.tenant_owned,
        area: area === 'externalSourceAuthority' ? 'otherExternalSourceAuthority' : (area || 'isolatedDemo') };
    });
    expect(new Set(guarded.map(entry => entry.area))).toEqual(new Set([
      'assets', 'companyState', 'customerAndPlans', 'financial', 'isolatedDemo', 'jobAndExecution',
      'otherExternalSourceAuthority', 'provider', 'schedule', 'sourceEvidence',
    ]));
    const snapshot = async () => {
      const result = {};
      for (const entry of guarded) result[entry.name] = await digest(entry);
      return result;
    };
    const before = await snapshot();
    const consentBody = {
      action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use reviewed labor records for bounded operational proof.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-consent-v1',
    };
    const batchBody = (consent, records, cursorBefore, cursorAfter) => ({
      schemaVersion: 'm25-external-labor-time-v1', mode: 'continuous_update',
      expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest,
      cursorBefore, cursorAfter, complete: false, records,
      reason: 'Stage reviewed bounded labor evidence.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-batch-v1',
    });
    let lockHolder;
    try {
      let response = await post('/consent', consentBody);
      expect(response.status).toBe(201);
      const consent = response.body.data.consent;

      const maximum = batchBody(consent, Array.from({ length: 100 }, (_, index) => laborRecord(index)), null, 'cursor-100');
      const maximumStart = Date.now();
      response = await post('/batches', maximum);
      const maximumMs = Date.now() - maximumStart;
      expect(response.status).toBe(201);
      expect(response.body.data.run).toMatchObject({ insertedCount: 100, correctedCount: 0, duplicateCount: 0, sequence: 1 });
      expect(maximumMs).toBeLessThan(3500);

      response = await post('/batches', batchBody(consent,
        Array.from({ length: 101 }, (_, index) => laborRecord(index + 200)), 'cursor-100', 'cursor-201'));
      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe('External labor import batch is invalid.');
      expect((await fixture.ownerPool.query('SELECT count(*)::integer count FROM canonical_external_labor_import_runs WHERE organization_id=$1 AND source_key=$2', [fixture.org, sourceKey])).rows[0].count).toBe(1);

      const replayKey = crypto.randomUUID();
      const replayBody = batchBody(consent, [laborRecord(100)], 'cursor-100', 'cursor-101');
      const replayRace = await Promise.all([post('/batches', replayBody, replayKey), post('/batches', replayBody, replayKey)]);
      expect(replayRace.map(value => value.status).sort()).toEqual([201, 409]);
      const createdRun = replayRace.find(value => value.status === 201).body.data.run;
      response = await post('/batches', replayBody, replayKey);
      expect(response.status).toBe(200);
      expect(response.headers['idempotency-replayed']).toBe('true');
      expect(response.body.data.run).toEqual(createdRun);

      const conflictKey = crypto.randomUUID();
      const conflictBodies = [
        batchBody(consent, [laborRecord(101)], 'cursor-101', 'cursor-102-a'),
        batchBody(consent, [laborRecord(102)], 'cursor-101', 'cursor-102-b'),
      ];
      const conflictRace = await Promise.all(conflictBodies.map(body => post('/batches', body, conflictKey)));
      expect(conflictRace.map(value => value.status).sort()).toEqual([201, 409]);
      expect(conflictRace.find(value => value.status === 409).body.error.message).toBe('That request key was already used for a different import.');
      const winner = conflictRace.findIndex(value => value.status === 201);
      const winnerCursor = conflictBodies[winner].cursorAfter;

      lockHolder = await fixture.ownerPool.connect();
      await lockHolder.query('BEGIN');
      await lockHolder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${fixture.org}:external-labor-import:${sourceKey}`]);
      const recoveryKey = crypto.randomUUID();
      const recoveryBody = batchBody(consent, [laborRecord(103)], winnerCursor, 'cursor-recovered');
      const blockedStart = Date.now();
      response = await post('/batches', recoveryBody, recoveryKey);
      const blockedMs = Date.now() - blockedStart;
      expect(response.status).toBe(503);
      expect(response.body.error).toMatchObject({ message: 'External labor imports are temporarily unavailable.' });
      expect(blockedMs).toBeGreaterThanOrEqual(1500);
      expect(blockedMs).toBeLessThan(4500);
      await lockHolder.query('ROLLBACK');
      lockHolder.release(); lockHolder = null;

      response = await post('/batches', recoveryBody, recoveryKey);
      expect(response.status).toBe(201);
      expect(response.headers['idempotency-replayed']).toBeUndefined();
      const source = await request(fixture.app).get(root).set(owner.session.headers);
      expect(source.status).toBe(200);
      expect(source.body.data).toMatchObject({ recordTotal: 103, recordsTruncated: true });
      expect(source.body.data.currentRecords).toHaveLength(100);
      expect(source.body.data.runs).toHaveLength(4);
      const intendedChanges = (await fixture.ownerPool.query(`SELECT
        (SELECT count(*)::integer FROM canonical_external_labor_import_consents WHERE organization_id=$1 AND source_key=$2) consents,
        (SELECT count(*)::integer FROM canonical_external_labor_import_runs WHERE organization_id=$1 AND source_key=$2) runs,
        (SELECT count(*)::integer FROM canonical_external_labor_import_records WHERE organization_id=$1 AND source_key=$2) records`,
      [fixture.org, sourceKey])).rows[0];
      expect(intendedChanges).toEqual({ consents: 1, runs: 4, records: 103 });

      expect(await snapshot()).toEqual(before);
      expect(telemetry.length).toBeGreaterThanOrEqual(10);
      const statuses = new Set(telemetry.map(value => value.statusCode));
      for (const status of [200, 201, 400, 409, 503]) expect(statuses.has(status)).toBe(true);
      for (const entry of telemetry) {
        expect(Object.keys(entry).sort()).toEqual(['component', 'durationMs', 'event', 'methodClass', 'requestId', 'statusCode']);
        expect(entry.requestId).toMatch(uuidPattern);
        expect(['GET', 'POST']).toContain(entry.methodClass);
        expect(Number.isSafeInteger(entry.durationMs) && entry.durationMs >= 0).toBe(true);
        const serialized = JSON.stringify(entry);
        for (const secret of secrets) expect(serialized).not.toContain(secret);
        expect(serialized).not.toMatch(/bounded-record|bounded-job|crew-|expectedConsent|sourceUpdatedAt|Idempotency/i);
      }
    } finally {
      if (lockHolder) {
        await lockHolder.query('ROLLBACK').catch(() => {});
        lockHolder.release();
      }
      info.mockRestore();
    }
  }, 120000);
});
