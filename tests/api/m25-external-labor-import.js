'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-external-labor-import-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-external-labor-import-result.json').slice(9);
assert.ok(!fs.existsSync(output));

const sourceKey = 'payroll.primary';
const baseRecord = { externalRecordId: 'shift-1', externalVersion: 1, state: 'active', workerReference: 'worker-7',
  jobReference: 'job-19', category: 'production', observedStart: '2026-09-15T13:00:00.000Z',
  observedEnd: '2026-09-15T17:00:00.000Z', sourceUpdatedAt: '2026-09-15T17:05:00.000Z' };

(async () => {
  let fixture;
  const ledger = { cases: [] };
  try {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const owner = fixture.actors.owner;
    const root = `/api/v1/learning/external-labor-sources/${sourceKey}`;
    const write = (path, body, key = crypto.randomUUID(), actor = owner) => request(fixture.app).post(root + path)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    let response = await request(fixture.app).get(root + '/consent').set(owner.session.headers);
    assert.equal(response.status, 200); assert.equal(response.body.data.active, false);
    const grant = { action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Import reviewed labor records from this source.',
      confirmed: true, confirmationVersion: 'm25-external-labor-import-consent-v1' };
    response = await write('/consent', grant); assert.equal(response.status, 201, JSON.stringify(response.body));
    const consent = response.body.data.consent;
    const workerConsent = await write('/consent', grant, crypto.randomUUID(), fixture.actors.member);
    assert.equal(workerConsent.status, 403); assert.equal(workerConsent.body.error.code, 'M25_IMPORT_FORBIDDEN');
    ledger.cases.push('A current owner explicitly enables one named external labor source; a worker cannot.');

    const batch = (overrides = {}) => ({ schemaVersion: 'm25-external-labor-time-v1', mode: 'historical_backfill',
      expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest, cursorBefore: null,
      cursorAfter: 'page-1', complete: false, records: [baseRecord], reason: 'Import one bounded reviewed source page.',
      confirmed: true, confirmationVersion: 'm25-external-labor-import-batch-v1', ...overrides });
    const firstKey = crypto.randomUUID();
    response = await write('/batches', batch(), firstKey); assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.run.insertedCount, 1); assert.equal(response.body.data.run.sequence, 1);
    const replay = await write('/batches', batch(), firstKey); assert.equal(replay.status, 200); assert.equal(replay.headers['idempotency-replayed'], 'true');
    const changedKey = await write('/batches', batch({ reason: 'Different request.' }), firstKey); assert.equal(changedKey.status, 409);
    const wrongCursor = await write('/batches', batch({ cursorBefore: 'wrong', cursorAfter: null, complete: true }));
    assert.equal(wrongCursor.status, 409); assert.equal(wrongCursor.body.error.code, 'M25_IMPORT_CHANGED');
    ledger.cases.push('Historical import is bounded, cursor-checked, replayable and rejects reused keys or stale cursors.');

    const secondRecord = { ...baseRecord, externalRecordId: 'shift-2', workerReference: 'worker-8' };
    response = await write('/batches', batch({ cursorBefore: 'page-1', cursorAfter: null, complete: true,
      records: [baseRecord, secondRecord] }));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.run.duplicateCount, 1); assert.equal(response.body.data.run.insertedCount, 1);
    assert.equal((await write('/batches', batch({ cursorBefore: null, cursorAfter: null, complete: true }))).status, 400);
    ledger.cases.push('Backfill deduplicates the same version and closes only with an explicit terminal page.');

    const corrected = { ...baseRecord, externalVersion: 2, observedEnd: '2026-09-15T18:00:00.000Z',
      sourceUpdatedAt: '2026-09-15T18:05:00.000Z' };
    const tombstone = { externalRecordId: 'shift-2', externalVersion: 2, state: 'tombstone', workerReference: null,
      jobReference: null, category: null, observedStart: null, observedEnd: null, sourceUpdatedAt: '2026-09-15T18:06:00.000Z' };
    response = await write('/batches', batch({ mode: 'continuous_update', cursorBefore: null, cursorAfter: 'stream-1',
      complete: false, records: [corrected, tombstone] }));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.run.correctedCount, 1); assert.equal(response.body.data.run.tombstonedCount, 1);
    const source = await request(fixture.app).get(root).set(owner.session.headers);
    assert.equal(source.status, 200); assert.equal(source.body.data.recordTotal, 2);
    const current = Object.fromEntries(source.body.data.currentRecords.map(record => [record.externalRecordId, record]));
    assert.equal(current['shift-1'].revision, 2);
    assert.equal(Date.parse(current['shift-1'].observedEnd), Date.parse('2026-09-15T18:00:00.000Z'));
    assert.equal(current['shift-2'].state, 'tombstone'); assert.equal(current['shift-2'].workerReference, null);
    assert.match(source.body.data.consumptionBoundary, /do not change operational labor/);
    ledger.cases.push('Higher source versions create immutable corrections; tombstones remove current work details without becoming operational facts.');

    const conflict = await write('/batches', batch({ mode: 'continuous_update', cursorBefore: 'stream-1', cursorAfter: 'stream-2',
      records: [{ ...corrected, observedEnd: '2026-09-15T19:00:00.000Z' }] }));
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'M25_IMPORT_RECORD_CONFLICT');
    const runsBefore = (await fixture.ownerPool.query('SELECT count(*)::int count FROM canonical_external_labor_import_runs')).rows[0].count;
    const direct = await fixture.runtimePool.connect(); let directError;
    try {
      await direct.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await direct.query('SELECT public.canonical_external_labor_import_batch($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken, crypto.randomUUID(), sourceKey,
          JSON.stringify({ ...batch({ mode: 'continuous_update', cursorBefore: 'stream-1', cursorAfter: 'stream-2', records: [corrected] }), confirmed: false })]);
    } catch (error) { directError = error; } finally { await direct.query('ROLLBACK').catch(() => {}); direct.release(); }
    assert.equal(directError && directError.code, '22023');
    assert.equal((await fixture.ownerPool.query('SELECT count(*)::int count FROM canonical_external_labor_import_runs')).rows[0].count, runsBefore);
    ledger.cases.push('Conflicting source versions and direct unconfirmed runtime calls fail closed without partial writes.');

    const revoke = { action: 'revoke', expectedRevision: consent.revision, expectedDigest: consent.digest,
      reason: 'Stop using this external labor source.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-consent-v1' };
    response = await write('/consent', revoke); assert.equal(response.status, 201); const revoked = response.body.data.consent;
    response = await request(fixture.app).get(root).set(owner.session.headers);
    assert.equal(response.status, 200); assert.equal(response.body.data.activeConsent, false); assert.deepEqual(response.body.data.currentRecords, []);
    assert.equal((await write('/batches', batch(), firstKey)).status, 409);
    assert.equal((await write('/batches', batch({ expectedConsentRevision: revoked.revision, expectedConsentDigest: revoked.digest,
      mode: 'continuous_update', cursorBefore: 'stream-1', cursorAfter: 'stream-2', records: [corrected] }))).status, 409);
    const other = await request(fixture.app).get(root).set(fixture.actors.otherOwner.session.headers);
    assert.equal(other.status, 200); assert.equal(other.body.data.recordTotal, 0);
    ledger.cases.push('Revocation hides imported source projections and blocks writes; another tenant receives no record signal.');

    const privileges = (await fixture.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_labor_import_runs','SELECT') run_table,
      has_table_privilege($1,'canonical_external_labor_import_records','INSERT') record_table,
      has_function_privilege($1,'canonical_external_labor_import_record_projection(canonical_external_labor_import_records)','EXECUTE') helper,
      has_function_privilege($1,'canonical_external_labor_import_read(uuid,uuid,text,uuid,text)','EXECUTE') entry`,
    [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { run_table: false, record_table: false, helper: false, entry: true });
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_labor_import_records'));
    const bytes = fs.readFileSync(require('node:path').join(__dirname, '../../migrations/084_canonical_external_labor_import_authority.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const migration = (await fixture.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='084_canonical_external_labor_import_authority.sql'")).rows;
    assert.deepEqual(migration, [{ checksum }]);
    ledger.cases.push('Runtime access is limited to guarded entries, histories are immutable, and the exact migration is recorded once.');
    ledger.pass = true;
  } catch (error) {
    ledger.error = error.stack; ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code,
      constraint: error.cause.constraint, detail: error.cause.detail }; process.exitCode = 1;
  } finally {
    if (fixture) await fixture.cleanup();
    fs.writeFileSync(output, JSON.stringify(ledger, null, 2));
    console.log(JSON.stringify(ledger));
  }
})();
