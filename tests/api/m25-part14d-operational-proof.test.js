'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const expectedLaborImportChanges = new Set([
  'canonical_external_labor_import_consents',
  'canonical_external_labor_import_records',
  'canonical_external_labor_import_runs',
]);

function laborRecord(prefix, index) {
  const day = String((index % 27) + 1).padStart(2, '0');
  return {
    externalRecordId: `${prefix}-record-${String(index).padStart(3, '0')}`,
    externalVersion: 1,
    state: 'active',
    workerReference: `crew-${index % 5}`,
    jobReference: `${prefix}-job-${String(index).padStart(3, '0')}`,
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

  const actorPost = (sourceKey, secrets) => {
    const owner = fixture.actors.owner;
    const root = `/api/v1/learning/external-labor-sources/${sourceKey}`;
    return (suffix, body, key = crypto.randomUUID()) => {
      secrets.add(key);
      secrets.add('audit-smuggle-worker');
      secrets.add('audit-smuggle-record');
      const userAgent = `NorthStar/${key}; workerReference=audit-smuggle-worker; body={"records":["audit-smuggle-record"]}`;
      return request(fixture.app).post(root + suffix).set(owner.session.headers)
        .set('X-CSRF-Token', owner.csrfToken).set('Idempotency-Key', key)
        .set('User-Agent', userAgent).send(body);
    };
  };

  const grantBody = reason => ({
    action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason, confirmed: true,
    confirmationVersion: 'm25-external-labor-import-consent-v1',
  });

  const batchBody = (consent, records, cursorBefore, cursorAfter) => ({
    schemaVersion: 'm25-external-labor-time-v1', mode: 'continuous_update',
    expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest,
    cursorBefore, cursorAfter, complete: false, records,
    reason: 'Stage reviewed bounded labor evidence.', confirmed: true,
    confirmationVersion: 'm25-external-labor-import-batch-v1',
  });

  const auditRows = async () => (await fixture.ownerPool.query(
    'SELECT id::text,organization_id::text,user_id::text,action,entity_type,entity_id,details,ip_address FROM audit_logs ORDER BY created_at,id')).rows;

  const waitForAuditRows = async expected => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await auditRows();
      if (rows.length >= expected) return rows;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return auditRows();
  };

  const expectAuditDelta = async (beforeIds, sourceKey, expectedCount, actions, secrets) => {
    const rows = (await waitForAuditRows(beforeIds.size + expectedCount)).filter(row => !beforeIds.has(row.id));
    expect(rows).toHaveLength(expectedCount);
    const actualActions = rows.reduce((result, row) => {
      result[row.action] = (result[row.action] || 0) + 1;
      return result;
    }, {});
    expect(actualActions).toEqual(actions);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'action', 'details', 'entity_id', 'entity_type', 'id', 'ip_address', 'organization_id', 'user_id',
      ]);
      expect(row.organization_id).toBe(fixture.org);
      expect(row.user_id).toBe(fixture.actors.owner.actorUserId);
      expect(row.entity_type).toBe('api_request');
      expect(row.entity_id).toBe('');
      expect(row.ip_address).toBe('');
      expect(Object.keys(row.details).sort()).toEqual([
        'actorLabel', 'afterState', 'beforeState', 'correlationId', 'requestId', 'role',
      ]);
      expect(row.details).toMatchObject({
        actorLabel: 'authenticated', role: 'owner', beforeState: null,
        afterState: { method: 'POST', status: Number(row.action.split(' ')[1]) },
      });
      expect(Object.keys(row.details.afterState).sort()).toEqual(['duration', 'method', 'path', 'status']);
      expect(row.details.requestId).toMatch(uuidPattern);
      expect(row.details.correlationId).toBe(row.details.requestId);
      expect([
        '/api/v1/learning/external-labor-sources/:sourceKey/consent',
        '/api/v1/learning/external-labor-sources/:sourceKey/batches',
      ]).toContain(row.details.afterState.path);
      expect(Number.isSafeInteger(row.details.afterState.duration) && row.details.afterState.duration >= 0).toBe(true);
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain(sourceKey);
      for (const secret of secrets) expect(serialized).not.toContain(secret);
      expect(serialized).not.toMatch(/-record-|\"records\"|workerReference|jobReference|expectedConsent|sourceUpdatedAt|Idempotency/i);
    }
  };

  const overlapBehindSourceLock = async (sourceKey, operations) => {
    const holder = await fixture.ownerPool.connect();
    let inFlight;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`${fixture.org}:external-labor-import:${sourceKey}`]);
      inFlight = Promise.all(operations.map(operation => operation()));
      let waiters = 0;
      for (let attempt = 0; attempt < 100 && waiters < operations.length; attempt += 1) {
        waiters = (await holder.query("SELECT count(*)::integer count FROM pg_locks WHERE locktype='advisory' AND NOT granted")).rows[0].count;
        if (waiters < operations.length) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiters).toBeGreaterThanOrEqual(operations.length);
      await holder.query('ROLLBACK');
      holder.release();
      return await inFlight;
    } catch (error) {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
      if (inFlight) await inFlight.catch(() => {});
      throw error;
    }
  };

  test('makes identical replay and different-body key conflicts deterministic across repeated true overlaps', async () => {
    const sourceKey = 'part14d.concurrent-proof';
    const secrets = new Set();
    const post = actorPost(sourceKey, secrets);
    const auditBefore = new Set((await auditRows()).map(row => row.id));
    let response = await post('/consent', grantBody('Use reviewed labor records for concurrency proof.'));
    expect(response.status).toBe(201);
    const consent = response.body.data.consent;
    let cursor = null;
    let nextRecord = 0;

    for (let schedule = 0; schedule < 5; schedule += 1) {
      const key = crypto.randomUUID();
      const nextCursor = `same-${schedule}`;
      const body = batchBody(consent, [laborRecord('concurrent', nextRecord++)], cursor, nextCursor);
      const pair = await overlapBehindSourceLock(sourceKey, [
        () => post('/batches', body, key),
        () => post('/batches', body, key),
      ]);
      expect(pair.map(value => value.status).sort()).toEqual([201, 409]);
      expect(pair.find(value => value.status === 409).body.error).toMatchObject({
        code: 'M25_IMPORT_CHANGED',
        message: 'Import consent, cursor, or source history changed. Refresh before continuing.',
      });
      const created = pair.find(value => value.status === 201).body.data.run;
      response = await post('/batches', body, key);
      expect(response.status).toBe(200);
      expect(response.headers['idempotency-replayed']).toBe('true');
      expect(response.body.data.run).toEqual(created);
      cursor = nextCursor;
    }

    for (let schedule = 0; schedule < 5; schedule += 1) {
      const key = crypto.randomUUID();
      const bodies = [
        batchBody(consent, [laborRecord('concurrent', nextRecord++)], cursor, `different-${schedule}-north`),
        batchBody(consent, [laborRecord('concurrent', nextRecord++)], cursor, `different-${schedule}-south`),
      ];
      const pair = await overlapBehindSourceLock(sourceKey, bodies.map(body => () => post('/batches', body, key)));
      expect(pair.map(value => value.status).sort()).toEqual([201, 409]);
      expect(pair.find(value => value.status === 409).body.error).toEqual({
        code: 'M25_IMPORT_KEY_CONFLICT',
        message: 'That request key was already used for a different import.',
      });
      cursor = bodies[pair.findIndex(value => value.status === 201)].cursorAfter;
    }

    const totals = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::integer FROM canonical_external_labor_import_consents WHERE organization_id=$1 AND source_key=$2) consents,
      (SELECT count(*)::integer FROM canonical_external_labor_import_runs WHERE organization_id=$1 AND source_key=$2) runs,
      (SELECT count(*)::integer FROM canonical_external_labor_import_records WHERE organization_id=$1 AND source_key=$2) records`,
    [fixture.org, sourceKey])).rows[0];
    expect(totals).toEqual({ consents: 1, runs: 10, records: 10 });
    await expectAuditDelta(auditBefore, sourceKey, 26,
      { 'POST 200': 5, 'POST 201': 11, 'POST 409': 10 }, secrets);
  }, 120000);

  test('stores bounded audit facts without hostile client, address, entity or request metadata', async () => {
    const sourceKey = 'part14d.metadata-proof';
    const owner = fixture.actors.owner;
    const key = crypto.randomUUID();
    const secrets = new Set([
      sourceKey, key, 'audit-smuggle-worker', 'audit-smuggle-record',
      'private@example.test', '860-555-1212', '198.51.100.77',
    ]);
    const auditBefore = new Set((await auditRows()).map(row => row.id));
    const response = await request(fixture.app)
      .post(`/api/v1/learning/external-labor-sources/${sourceKey}/consent`)
      .set(owner.session.headers)
      .set('X-CSRF-Token', owner.csrfToken)
      .set('Idempotency-Key', key)
      .set('User-Agent', `${key} workerReference=audit-smuggle-worker records=audit-smuggle-record private@example.test 860-555-1212`)
      .set('X-Forwarded-For', '198.51.100.77')
      .send(grantBody('Use reviewed labor records for audit privacy proof.'));
    expect(response.status).toBe(201);
    await expectAuditDelta(auditBefore, sourceKey, 1, { 'POST 201': 1 }, secrets);
  }, 120000);

  test('bounds workload, recovers from backpressure and keeps all non-audit operating state byte-equivalent', async () => {
    const sourceKey = 'part14d.operational-proof';
    const root = `/api/v1/learning/external-labor-sources/${sourceKey}`;
    const secrets = new Set();
    const post = actorPost(sourceKey, secrets);
    const telemetry = [];
    const info = jest.spyOn(console, 'info').mockImplementation(value => {
      if (value && value.component === 'http' && value.event === 'request_completed') telemetry.push(value);
    });
    const catalog = (await fixture.ownerPool.query("SELECT class.relname name FROM pg_catalog.pg_class class JOIN pg_catalog.pg_namespace namespace ON namespace.oid=class.relnamespace WHERE namespace.nspname='public' AND class.relkind IN('r','p') ORDER BY class.relname")).rows;
    const unchangedTables = catalog.filter(entry => entry.name !== 'audit_logs' && !expectedLaborImportChanges.has(entry.name));
    expect(catalog.map(entry => entry.name)).toContain('audit_logs');
    expect(unchangedTables.length).toBe(catalog.length - 4);
    const digest = async entry => {
      expect(entry.name).toMatch(/^_?[a-z][a-z0-9_]*$/);
      return (await fixture.ownerPool.query(
        `SELECT count(*)::integer count,encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(subject) ORDER BY to_jsonb(subject)::text),'[]'::jsonb)::text,'UTF8')),'hex') digest FROM public.${entry.name} subject`)).rows[0];
    };
    const snapshot = async () => {
      const result = {};
      for (const entry of unchangedTables) result[entry.name] = await digest(entry);
      return result;
    };
    const before = await snapshot();
    const auditBefore = new Set((await auditRows()).map(row => row.id));
    let lockHolder;
    try {
      let response = await post('/consent', grantBody('Use reviewed labor records for bounded operational proof.'));
      expect(response.status).toBe(201);
      const consent = response.body.data.consent;
      const maximum = batchBody(consent,
        Array.from({ length: 100 }, (_, index) => laborRecord('bounded', index)), null, 'cursor-100');
      const maximumStart = Date.now();
      response = await post('/batches', maximum);
      const maximumMs = Date.now() - maximumStart;
      expect(response.status).toBe(201);
      expect(response.body.data.run).toMatchObject({ insertedCount: 100, sequence: 1 });
      expect(maximumMs).toBeLessThan(3500);

      response = await post('/batches', batchBody(consent,
        Array.from({ length: 101 }, (_, index) => laborRecord('rejected', index)), 'cursor-100', 'cursor-201'));
      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe('External labor import batch is invalid.');

      lockHolder = await fixture.ownerPool.connect();
      await lockHolder.query('BEGIN');
      await lockHolder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`${fixture.org}:external-labor-import:${sourceKey}`]);
      const recoveryKey = crypto.randomUUID();
      const recoveryBody = batchBody(consent, [laborRecord('bounded', 100)], 'cursor-100', 'cursor-recovered');
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

      const source = await request(fixture.app).get(root).set(fixture.actors.owner.session.headers);
      expect(source.status).toBe(200);
      expect(source.body.data).toMatchObject({ recordTotal: 101, recordsTruncated: true, runTotal: 2 });
      expect(source.body.data.currentRecords).toHaveLength(100);
      const intendedChanges = (await fixture.ownerPool.query(`SELECT
        (SELECT count(*)::integer FROM canonical_external_labor_import_consents WHERE organization_id=$1 AND source_key=$2) consents,
        (SELECT count(*)::integer FROM canonical_external_labor_import_runs WHERE organization_id=$1 AND source_key=$2) runs,
        (SELECT count(*)::integer FROM canonical_external_labor_import_records WHERE organization_id=$1 AND source_key=$2) records`,
      [fixture.org, sourceKey])).rows[0];
      expect(intendedChanges).toEqual({ consents: 1, runs: 2, records: 101 });

      await expectAuditDelta(auditBefore, sourceKey, 5,
        { 'POST 201': 3, 'POST 400': 1, 'POST 503': 1 }, secrets);
      expect(await snapshot()).toEqual(before);
      const statuses = new Set(telemetry.map(value => value.statusCode));
      for (const status of [200, 201, 400, 503]) expect(statuses.has(status)).toBe(true);
      for (const entry of telemetry) {
        expect(Object.keys(entry).sort()).toEqual(['component', 'durationMs', 'event', 'methodClass', 'requestId', 'statusCode']);
        expect(entry.requestId).toMatch(uuidPattern);
        expect(['GET', 'POST']).toContain(entry.methodClass);
        expect(Number.isSafeInteger(entry.durationMs) && entry.durationMs >= 0).toBe(true);
        const serialized = JSON.stringify(entry);
        expect(serialized).not.toContain(sourceKey);
        for (const secret of secrets) expect(serialized).not.toContain(secret);
        expect(serialized).not.toMatch(/-record-|\"records\"|crew-|expectedConsent|sourceUpdatedAt|Idempotency/i);
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
