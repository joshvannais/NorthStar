'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

function laborRecord(externalRecordId, externalVersion, day) {
  return {
    externalRecordId, externalVersion, state: 'active', workerReference: 'crew-one',
    jobReference: 'job-' + externalRecordId, category: 'production',
    observedStart: `${day}T13:00:00.000Z`, observedEnd: `${day}T14:00:00.000Z`,
    sourceUpdatedAt: `${day}T14:05:00.000Z`,
  };
}

realPostgres('Mission 25 Part 14C migration and lifecycle recovery', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('survives zero-op restarts and resumes exact replay, correction, permission, retention and deletion state', async () => {
    const owner = fixture.actors.owner, sourceKey = 'part14c.recovery', root = `/api/v1/learning/external-labor-sources/${sourceKey}`;
    const post = (suffix, body, key = crypto.randomUUID()) => request(fixture.app).post(root + suffix)
      .set(owner.session.headers).set('X-CSRF-Token', owner.csrfToken).set('Idempotency-Key', key).send(body);
    const consentBody = (action, revision, digest, reason) => ({ action, expectedRevision: revision, expectedDigest: digest,
      reason, confirmed: true, confirmationVersion: 'm25-external-labor-import-consent-v1' });
    const batchBody = (consent, mode, records, cursorBefore, cursorAfter, complete) => ({
      schemaVersion: 'm25-external-labor-time-v1', mode, expectedConsentRevision: consent.revision,
      expectedConsentDigest: consent.digest, cursorBefore, cursorAfter, complete, records,
      reason: 'Stage reviewed recovery evidence.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-batch-v1',
    });
    const migrationLedger = async () => (await fixture.ownerPool.query(
      'SELECT filename,trim(checksum) checksum,applied_at::text applied_at FROM _migrations ORDER BY filename')).rows;
    const restart = async expectedLedger => {
      await fixture.db.close();
      expect(fixture.db.isAvailable()).toBe(false);
      expect(await fixture.db.initDatabase()).toBe(true);
      expect(fixture.db.readiness()).toEqual({ ready: true, failure: null });
      expect(await migrationLedger()).toEqual(expectedLedger);
    };
    const expectPublicCleanupRun = run => {
      expect(Object.keys(run).sort()).toEqual([
        'complete', 'cursorAfter', 'digest', 'id', 'operation', 'sequence', 'tombstonedCount',
      ]);
      expect(JSON.stringify(run)).not.toMatch(/organization_|actor_|membership_|auth_session_|request_|authority_|canonical_|cursor_after|tombstoned_count/);
    };

    const grantKey = crypto.randomUUID(), grantBody = consentBody('grant', 0, 'none', 'Start the reviewed recovery source.');
    let response = await post('/consent', grantBody, grantKey);
    expect(response.status).toBe(201); let consent = response.body.data.consent;
    const batchKey = crypto.randomUUID();
    const firstBatch = batchBody(consent, 'continuous_update', [laborRecord('restart-record', 1, '2026-08-01')], null, 'restart-1', false);
    response = await post('/batches', firstBatch, batchKey); expect(response.status).toBe(201);
    const adapterKey = crypto.randomUUID(), connectBody = { action: 'connect', adapterKind: 'provider_api', cadence: 'hourly', expectedRevision: 0, expectedDigest: 'none', confirmed: true };
    response = await post('/adapter', connectBody, adapterKey); expect(response.status).toBe(201); let adapter = response.body.data.adapter;
    response = await post('/adapter', { ...connectBody, action: 'pause', expectedRevision: adapter.revision, expectedDigest: adapter.digest });
    expect(response.status).toBe(201); adapter = response.body.data.adapter;

    const initialLedger = await migrationLedger(); expect(initialLedger).toHaveLength(133);
    for (const migration of ['134_canonical_external_labor_recovery.sql', '135_canonical_external_labor_cleanup_projection.sql']) {
      const checksum = crypto.createHash('sha256').update(fs.readFileSync(
        path.join(__dirname, '../../migrations', migration))).digest('hex');
      expect(initialLedger.find(row => row.filename === migration)).toMatchObject({ checksum });
    }
    expect((await fixture.ownerPool.query(`SELECT
      has_function_privilege($1,'canonical_external_labor_import_consent_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE') AS consent_entry,
      has_function_privilege($1,'canonical_external_labor_operation_mutate(uuid,uuid,text,uuid,text,text,text,text,jsonb)','EXECUTE') AS operation_helper,
      has_function_privilege($1,'canonical_external_labor_cleanup_projection(canonical_external_labor_cleanup_runs)','EXECUTE') AS cleanup_projection`,
    [fixture.roles.runtime])).rows[0]).toEqual({ consent_entry: true, operation_helper: false, cleanup_projection: false });
    await restart(initialLedger);
    for (const [suffix, body, key] of [['/consent', grantBody, grantKey], ['/batches', firstBatch, batchKey], ['/adapter', connectBody, adapterKey]]) {
      const replay = await post(suffix, body, key); expect(replay.status).toBe(200); expect(replay.headers['idempotency-replayed']).toBe('true');
    }
    response = await post('/adapter', { ...connectBody, action: 'resume', expectedRevision: adapter.revision, expectedDigest: adapter.digest });
    expect(response.status).toBe(201); expect(response.body.data.adapter.action).toBe('resume');

    response = await post('/batches', batchBody(consent, 'continuous_update', [laborRecord('restart-record', 2, '2026-08-02')], 'restart-1', 'restart-2', false));
    expect(response.status).toBe(201);
    let read = await request(fixture.app).get(root).set(owner.session.headers);
    expect(read.status).toBe(200); expect(read.body.data.currentRecords).toHaveLength(1);
    expect(read.body.data.currentRecords[0]).toMatchObject({ externalRecordId: 'restart-record', externalVersion: 2, state: 'active' });

    response = await post('/consent', consentBody('revoke', consent.revision, consent.digest, 'Stop the first reviewed recovery period.'));
    expect(response.status).toBe(201); const revoked = response.body.data.consent;
    const retiredReplayStatuses = [];
    for (const [suffix, body, key] of [['/consent', grantBody, grantKey], ['/batches', firstBatch, batchKey], ['/adapter', connectBody, adapterKey]]) {
      retiredReplayStatuses.push([suffix, (await post(suffix, body, key)).status]);
    }
    expect(retiredReplayStatuses).toEqual([['/consent', 409], ['/batches', 409], ['/adapter', 409]]);
    read = await request(fixture.app).get(root).set(owner.session.headers); expect(read.status).toBe(200); expect(read.body.data.recordTotal).toBe(0);
    response = await post('/consent', consentBody('grant', revoked.revision, revoked.digest, 'Start a new reviewed recovery period.'));
    expect(response.status).toBe(201); consent = response.body.data.consent;
    for (const [suffix, body, key] of [['/consent', grantBody, grantKey], ['/batches', firstBatch, batchKey], ['/adapter', connectBody, adapterKey]]) {
      expect((await post(suffix, body, key)).status).toBe(409);
    }
    read = await request(fixture.app).get(root).set(owner.session.headers);
    expect(read.body.data.recordTotal).toBe(1);
    expect(read.body.data.currentRecords[0]).toMatchObject({ externalRecordId: 'restart-record', externalVersion: 2 });

    response = await post('/batches', batchBody(consent, 'historical_backfill', [laborRecord('retention-old', 1, '2025-01-15')], null, null, true));
    expect(response.status).toBe(201);
    const retentionKey = crypto.randomUUID(), retentionBody = { action: 'set', retentionDays: 30, expectedRevision: 0, expectedDigest: 'none', confirmed: true };
    response = await post('/retention', retentionBody, retentionKey);
    expect(response.status).toBe(201); const retention = response.body.data.retention;
    response = await post('/cleanup', { operation: 'retention', expectedRevision: retention.revision, expectedDigest: retention.digest, cursorBefore: null, limit: 100, confirmed: true });
    expect(response.status).toBe(201); expect(response.body.data.run).toMatchObject({ tombstonedCount: 2, complete: true });

    const cleanupRecords = Array.from({ length: 101 }, (_, index) => laborRecord(`cleanup-${String(index).padStart(3, '0')}`, 1, '2026-09-15'));
    response = await post('/batches', batchBody(consent, 'continuous_update', cleanupRecords.slice(0, 100), 'restart-2', 'cleanup-page-100', false));
    expect(response.status).toBe(201);
    response = await post('/batches', batchBody(consent, 'continuous_update', cleanupRecords.slice(100), 'cleanup-page-100', 'cleanup-page-101', false));
    expect(response.status).toBe(201);
    const deletionKey = crypto.randomUUID(), deletionBody = { action: 'request', expectedRevision: 0, expectedDigest: 'none', confirmed: true };
    response = await post('/deletion', deletionBody, deletionKey);
    expect(response.status).toBe(201); const deletion = response.body.data.deletion;
    const deletionReplay = await post('/deletion', deletionBody, deletionKey);
    expect(deletionReplay.status).toBe(200); expect(deletionReplay.headers['idempotency-replayed']).toBe('true');
    expect((await post('/retention', retentionBody, retentionKey)).status).toBe(409);
    const firstCleanupKey = crypto.randomUUID(), firstCleanupBody = { operation: 'deletion', expectedRevision: deletion.revision,
      expectedDigest: deletion.digest, cursorBefore: null, limit: 100, confirmed: true };
    response = await post('/cleanup', firstCleanupBody, firstCleanupKey);
    expect(response.status).toBe(201); expect(response.body.data.run).toMatchObject({ tombstonedCount: 100, complete: false });
    const firstPublicData = response.body.data; const firstPublicRun = firstPublicData.run; expectPublicCleanupRun(firstPublicRun);
    const resumeCursor = firstPublicRun.cursorAfter; expect(typeof resumeCursor).toBe('string');

    await restart(initialLedger);
    const firstCleanupReplay = await post('/cleanup', firstCleanupBody, firstCleanupKey);
    expect(firstCleanupReplay.status).toBe(200); expect(firstCleanupReplay.headers['idempotency-replayed']).toBe('true');
    expect({ ...firstCleanupReplay.body.data, replayed: false }).toEqual(firstPublicData);
    expectPublicCleanupRun(firstCleanupReplay.body.data.run);
    read = await request(fixture.app).get(root + '/operations').set(owner.session.headers);
    expect(read.status).toBe(200);
    expect(read.body.data.checkpoints.find(value => value.mode === 'deletion_cleanup')).toMatchObject({ cursorAfter: resumeCursor, complete: false });
    const secondCleanupKey = crypto.randomUUID(), secondCleanupBody = { operation: 'deletion', expectedRevision: deletion.revision,
      expectedDigest: deletion.digest, cursorBefore: resumeCursor, limit: 100, confirmed: true };
    response = await post('/cleanup', secondCleanupBody, secondCleanupKey);
    expect(response.status).toBe(201); expect(response.body.data.run).toMatchObject({ tombstonedCount: 1, complete: true });
    const completedPublicData = response.body.data; const completedPublicRun = completedPublicData.run; expectPublicCleanupRun(completedPublicRun);
    await restart(initialLedger);
    const cleanupReplay = await post('/cleanup', secondCleanupBody, secondCleanupKey);
    expect(cleanupReplay.status).toBe(200); expect(cleanupReplay.headers['idempotency-replayed']).toBe('true');
    expect({ ...cleanupReplay.body.data, replayed: false }).toEqual(completedPublicData);
    expectPublicCleanupRun(cleanupReplay.body.data.run);
    read = await request(fixture.app).get(root + '/operations').set(owner.session.headers);
    expect(read.body.data).toMatchObject({ activeRecordTotal: 0, deletionComplete: true });
    expect(await migrationLedger()).toEqual(initialLedger);
  }, 120000);
});
