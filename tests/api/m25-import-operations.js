'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-import-operations-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-import-operations-result.json').slice(9);
assert.ok(!fs.existsSync(output));

(async () => {
  let fixture; const ledger = { cases: [] };
  try {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const owner = fixture.actors.owner, sourceKey = 'crewclock.primary';
    const root = `/api/v1/learning/external-labor-sources/${sourceKey}`;
    const write = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(fixture.app).post(root + suffix)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    let response = await write('/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use reviewed company labor history.', confirmed: true, confirmationVersion: 'm25-external-labor-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const consent = response.body.data.consent;

    const csv = [
      'externalRecordId,externalVersion,state,workerReference,jobReference,category,observedStart,observedEnd,sourceUpdatedAt',
      'shift-old,1,active,worker-1,job-1,production,2026-01-10T13:00:00.000Z,2026-01-10T17:00:00.000Z,2026-01-10T17:05:00.000Z',
    ].join('\n');
    response = await write('/csv-backfill', { cursorBefore: null, cursorAfter: null, complete: true, csvText: csv });
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.insertedCount, 1);
    const malformed = await write('/csv-backfill', { cursorBefore: null, cursorAfter: null, complete: true, csvText: 'bad,header\n1,2' });
    assert.equal(malformed.status, 400); assert.equal(malformed.body.error.code, 'M25_IMPORT_CSV_INVALID');
    ledger.cases.push('A reviewed exact-header CSV page becomes a bounded historical backfill; malformed CSV fails before persistence.');

    response = await request(fixture.app).get(root + '/operations').set(owner.session.headers);
    assert.equal(response.status, 200); assert.equal(response.body.data.activeRecordTotal, 1);
    const adapterKey = crypto.randomUUID();
    const adapterBody = { action: 'connect', adapterKind: 'provider_api', cadence: 'hourly', accountReference: 'tenant-account-42', expectedRevision: 0, expectedDigest: 'none', confirmed: true };
    response = await write('/adapter', adapterBody, adapterKey); assert.equal(response.status, 201, JSON.stringify(response.body));
    const adapter = response.body.data.adapter; assert.equal(adapter.action, 'connect');
    const replay = await write('/adapter', adapterBody, adapterKey); assert.equal(replay.status, 200); assert.equal(replay.headers['idempotency-replayed'], 'true');
    response = await write('/adapter', { ...adapterBody, action: 'pause', expectedRevision: adapter.revision, expectedDigest: adapter.digest });
    assert.equal(response.status, 201); assert.equal(response.body.data.adapter.action, 'pause');
    ledger.cases.push('Provider-neutral adapter lifecycle is transition checked, revision pinned and idempotent without storing credentials.');

    response = await write('/retention', { action: 'set', retentionDays: 30, expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const retention = response.body.data.retention;
    response = await request(fixture.app).get(root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.retentionEligibleTotal, 1);
    response = await write('/cleanup', { operation: 'retention', expectedRevision: retention.revision,
      expectedDigest: retention.digest, cursorBefore: null, limit: 100, confirmed: true });
    if (response.status !== 201) {
      const direct = await fixture.runtimePool.connect();
      try {
        await direct.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await direct.query('SELECT public.canonical_external_labor_cleanup_execute($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
          [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken,
            crypto.randomUUID(), sourceKey, JSON.stringify({ operation: 'retention', expectedRevision: retention.revision,
              expectedDigest: retention.digest, cursorBefore: null, limit: 100, confirmed: true })]);
      } finally { await direct.query('ROLLBACK').catch(() => {}); direct.release(); }
    }
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.tombstonedCount, 1);
    assert.equal(response.body.data.run.complete, true);
    response = await request(fixture.app).get(root).set(owner.session.headers);
    assert.equal(response.body.data.currentRecords[0].state, 'tombstone');
    ledger.cases.push('Retention computes eligible records and executes a bounded resumable tombstone cleanup with immutable lineage.');

    const newRecord = { externalRecordId: 'shift-new', externalVersion: 1, state: 'active', workerReference: 'worker-2',
      jobReference: 'job-2', category: 'production', observedStart: '2026-09-15T13:00:00.000Z',
      observedEnd: '2026-09-15T15:00:00.000Z', sourceUpdatedAt: '2026-09-15T15:05:00.000Z' };
    response = await write('/batches', { schemaVersion: 'm25-external-labor-time-v1', mode: 'continuous_update',
      expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest, cursorBefore: null, cursorAfter: 'stream-1',
      complete: false, records: [newRecord], reason: 'Stage one continuous update.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-batch-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await write('/deletion', { action: 'request', expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const deletion = response.body.data.deletion;
    const consentAfter = await request(fixture.app).get(root + '/consent').set(owner.session.headers);
    assert.equal(consentAfter.body.data.active, false);
    const blockedImport = await write('/batches', { schemaVersion: 'm25-external-labor-time-v1', mode: 'continuous_update',
      expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest, cursorBefore: 'stream-1', cursorAfter: 'stream-2',
      complete: false, records: [{ ...newRecord, externalVersion: 2 }], reason: 'Must be blocked.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-batch-v1' });
    assert.equal(blockedImport.status, 409);
    response = await write('/cleanup', { operation: 'deletion', expectedRevision: deletion.revision,
      expectedDigest: deletion.digest, cursorBefore: null, limit: 100, confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.tombstonedCount, 1);
    response = await request(fixture.app).get(root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.deletionComplete, true);
    ledger.cases.push('A deletion request immediately revokes source use, blocks new imports and completes through bounded tombstone execution.');

    const pagedSourceKey = 'crewclock.paged';
    const pagedRoot = `/api/v1/learning/external-labor-sources/${pagedSourceKey}`;
    const pagedWrite = (suffix, body, key = crypto.randomUUID()) => request(fixture.app).post(pagedRoot + suffix)
      .set(owner.session.headers).set('X-CSRF-Token', owner.csrfToken).set('Idempotency-Key', key).send(body);
    response = await pagedWrite('/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use reviewed company labor history.', confirmed: true, confirmationVersion: 'm25-external-labor-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const pagedConsent = response.body.data.consent;
    const pagedRecords = Array.from({ length: 101 }, (_, index) => ({
      externalRecordId: `paged-${String(index + 1).padStart(3, '0')}`, externalVersion: 1, state: 'active',
      workerReference: `worker-${(index % 4) + 1}`, jobReference: `job-${index + 1}`, category: 'production',
      observedStart: '2026-09-15T13:00:00.000Z', observedEnd: '2026-09-15T14:00:00.000Z',
      sourceUpdatedAt: '2026-09-15T14:05:00.000Z',
    }));
    const pagedBatch = (cursorBefore, cursorAfter, records) => ({ schemaVersion: 'm25-external-labor-time-v1', mode: 'continuous_update',
      expectedConsentRevision: pagedConsent.revision, expectedConsentDigest: pagedConsent.digest, cursorBefore, cursorAfter,
      complete: false, records, reason: 'Stage reviewed continuous records.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-batch-v1' });
    response = await pagedWrite('/batches', pagedBatch(null, 'bulk-100', pagedRecords.slice(0, 100)));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await pagedWrite('/batches', pagedBatch('bulk-100', 'bulk-101', pagedRecords.slice(100)));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await pagedWrite('/deletion', { action: 'request', expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const pagedDeletion = response.body.data.deletion;
    response = await pagedWrite('/cleanup', { operation: 'deletion', expectedRevision: pagedDeletion.revision,
      expectedDigest: pagedDeletion.digest, cursorBefore: null, limit: 100, confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.tombstonedCount, 100);
    assert.equal(response.body.data.run.complete, false); const resumeCursor = response.body.data.run.cursorAfter;
    assert.equal(resumeCursor, 'paged-100');
    response = await request(fixture.app).get(pagedRoot + '/operations').set(owner.session.headers);
    const checkpoint = response.body.data.checkpoints.find(item => item.mode === 'deletion_cleanup');
    assert.equal(checkpoint.complete, false); assert.equal(checkpoint.cursorAfter, resumeCursor);
    response = await pagedWrite('/cleanup', { operation: 'deletion', expectedRevision: pagedDeletion.revision,
      expectedDigest: pagedDeletion.digest, cursorBefore: resumeCursor, limit: 100, confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.tombstonedCount, 1);
    assert.equal(response.body.data.run.complete, true);
    response = await request(fixture.app).get(pagedRoot + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.activeRecordTotal, 0); assert.equal(response.body.data.deletionComplete, true);
    ledger.cases.push('A 101-record deletion resumes from its exact checkpoint across two bounded cleanup batches and reaches zero active records.');

    const member = await request(fixture.app).get(root + '/operations').set(fixture.actors.member.session.headers);
    assert.equal(member.status, 403);
    const other = await request(fixture.app).get(root + '/operations').set(fixture.actors.otherOwner.session.headers);
    assert.equal(other.status, 200); assert.equal(other.body.data.activeRecordTotal, 0);
    const privileges = (await fixture.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_labor_adapter_revisions','SELECT') adapter_table,
      has_table_privilege($1,'canonical_external_labor_cleanup_runs','INSERT') cleanup_table,
      has_function_privilege($1,'canonical_external_labor_operation_mutate(uuid,uuid,text,uuid,text,text,text,text,jsonb)','EXECUTE') helper,
      has_function_privilege($1,'canonical_external_labor_cleanup_execute(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE') entry`, [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { adapter_table: false, cleanup_table: false, helper: false, entry: true });
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_labor_cleanup_runs'));
    const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/089_canonical_external_labor_import_operations.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const migration = (await fixture.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='089_canonical_external_labor_import_operations.sql'")).rows;
    assert.deepEqual(migration, [{ checksum }]);
    ledger.cases.push('Tenant and role isolation, entry-only runtime ACLs, immutable cleanup receipts and exact migration provenance hold.');
    ledger.pass = true;
  } catch (error) { ledger.error = error.stack; ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code, constraint: error.cause.constraint }; process.exitCode = 1; }
  finally { if (fixture) await fixture.cleanup(); fs.writeFileSync(output, JSON.stringify(ledger, null, 2)); console.log(JSON.stringify(ledger)); }
})();
