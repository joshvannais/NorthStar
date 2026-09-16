'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-external-asset-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-external-asset-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'fleet.primary';
const evidenceDigest = crypto.createHash('sha256').update('opaque-provider-evidence').digest('hex');
const base = (recordType, externalRecordId) => ({
  externalRecordId, externalVersion: 1, state: 'active', recordType, jobReference: 'job-19', assetReference: 'machine-2', assetCategory: 'equipment',
  periodStartedAt: '2026-09-15T12:00:00.000Z', periodEndedAt: '2026-09-15T16:00:00.000Z', timeZone: 'America/New_York',
  utilization: recordType === 'utilization' ? { value: '4.0', unit: 'engine_hour', basis: 'telematics' } : null,
  cost: recordType === 'operating_cost' ? { amount: '86.42', currency: 'USD', costClass: 'fuel_energy', basis: 'fuel_card' } : null,
  maintenance: recordType === 'maintenance' ? { kind: 'preventive', status: 'completed', workOrderReference: 'wo-4', meter: { value: '840', unit: 'engine_hour', basis: 'meter' } } : null,
  downtime: recordType === 'downtime' ? { reasonClass: 'maintenance', scheduled: true } : null,
  evidenceClass: 'provider_recorded', providerEvidenceDigest: evidenceDigest, sourceUpdatedAt: '2026-09-15T17:00:00.000Z',
});

(async () => {
  let fixture; const ledger = { cases: [] };
  try {
    fixture = await createDatabaseFixture({ operationalSchedule: true }); const owner = fixture.actors.owner;
    const root = `/api/v1/learning/external-asset-sources/${sourceKey}`;
    const write = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(fixture.app).post(root + suffix).set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    const grant = { action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Use this reviewed source for vehicle and equipment evidence.', confirmed: true, confirmationVersion: 'm25-external-asset-import-consent-v1' };
    let response = await write('/consent', grant); assert.equal(response.status, 201, JSON.stringify(response.body)); const consent = response.body.data.consent;
    assert.equal((await write('/consent', grant, crypto.randomUUID(), fixture.actors.member)).status, 403);
    ledger.cases.push('Only a current owner or administrator can grant source-specific vehicle and equipment consent.');
    const records = [base('utilization', 'use-1'), base('operating_cost', 'cost-1'), base('maintenance', 'maint-1'), base('downtime', 'down-1')];
    const batch = (changes = {}) => ({ schemaVersion: 'm25-external-asset-actual-v1', mode: 'historical_backfill', expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest, cursorBefore: null, cursorAfter: null, complete: true, records, reason: 'Import one reviewed normalized vehicle and equipment page.', confirmed: true, confirmationVersion: 'm25-external-asset-import-batch-v1', ...changes });
    const key = crypto.randomUUID(); response = await write('/batches', batch(), key); assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.insertedCount, 4);
    response = await write('/batches', batch(), key); assert.equal(response.status, 200); assert.equal(response.headers['idempotency-replayed'], 'true');
    ledger.cases.push('A bounded historical page stages four distinct evidence classes and exact-key retry replays one immutable run.');
    const directBatch = async body => { const client = await fixture.runtimePool.connect(); try { await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); await client.query('SELECT public.canonical_external_asset_import_batch($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken, crypto.randomUUID(), sourceKey, JSON.stringify(body)]); } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); } };
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: 'bad', expectedConsentRevision: null, expectedConsentDigest: null })), error => error.code === '22023');
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: 'bad', records: [{ ...base('operating_cost', 'bad-cost'), cost: { amount: '86.42', currency: null, costClass: 'fuel_energy', basis: 'fuel_card' } }] })), error => error.code === '22023');
    ledger.cases.push('Restricted runtime calls reject null consent pins and cost evidence without explicit currency.');
    const corrected = { ...base('utilization', 'use-1'), externalVersion: 2, utilization: { value: '5.25', unit: 'engine_hour', basis: 'meter' }, sourceUpdatedAt: '2026-09-15T18:00:00.000Z' };
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorAfter: 'stream-1', records: [corrected] })); assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.correctedCount, 1);
    let source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.status, 200); const current = source.body.data.currentRecords.find(value => value.externalRecordId === 'use-1'); assert.equal(current.utilization.value, '5.25'); assert.equal(current.providerEvidenceDigest, evidenceDigest); assert.match(source.body.data.consumptionBoundary, /cannot alter/);
    const conflict = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: 'stream-1', cursorAfter: 'stream-2', records: [{ ...corrected, utilization: { value: '6', unit: 'engine_hour', basis: 'meter' } }] })); assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'M25_ASSET_IMPORT_RECORD_CONFLICT');
    const tombstone = Object.fromEntries(Object.keys(corrected).map(name => [name, ['externalRecordId', 'externalVersion', 'state', 'sourceUpdatedAt'].includes(name) ? corrected[name] : null])); Object.assign(tombstone, { externalVersion: 3, state: 'tombstone', sourceUpdatedAt: '2026-09-15T19:00:00.000Z' });
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: 'stream-1', cursorAfter: 'stream-2', records: [tombstone] })); assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.tombstonedCount, 1);
    ledger.cases.push('Higher-version corrections replace current evidence; same-version conflicts fail closed; tombstones retain no operational details.');
    const revoke = { action: 'revoke', expectedRevision: consent.revision, expectedDigest: consent.digest, reason: 'Stop using this fleet source.', confirmed: true, confirmationVersion: 'm25-external-asset-import-consent-v1' };
    response = await write('/consent', revoke); assert.equal(response.status, 201); source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.body.data.activeConsent, false); assert.deepEqual(source.body.data.currentRecords, []);
    response = await write('/batches', batch(), key); assert.equal(response.status, 200); assert.equal(response.headers['idempotency-replayed'], 'true');
    response = await write('/batches', batch({ reason: 'Changed after revocation.' }), key); assert.equal(response.status, 409); assert.equal(response.body.error.code, 'M25_ASSET_IMPORT_KEY_CONFLICT');
    const other = await request(fixture.app).get(root).set(fixture.actors.otherOwner.session.headers); assert.equal(other.status, 200); assert.equal(other.body.data.recordTotal, 0);
    ledger.cases.push('Revocation hides evidence and blocks new writes while exact delayed replay remains immutable and tenant-private.');
    const privileges = (await fixture.ownerPool.query(`SELECT has_table_privilege($1,'canonical_external_asset_import_records','SELECT') table_read,has_function_privilege($1,'canonical_external_asset_record_projection(canonical_external_asset_import_records)','EXECUTE') helper,has_function_privilege($1,'canonical_external_asset_import_read(uuid,uuid,text,uuid,text)','EXECUTE') entry`, [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { table_read: false, helper: false, entry: true }); await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_asset_import_records'));
    const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/097_canonical_external_asset_import_authority.sql')); const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual((await fixture.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='097_canonical_external_asset_import_authority.sql'")).rows, [{ checksum }]);
    ledger.cases.push('Runtime access is entry-only, histories are immutable, and migration provenance is exact.'); ledger.pass = true;
  } catch (error) { ledger.error = error.stack; ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code, constraint: error.cause.constraint, detail: error.cause.detail }; process.exitCode = 1; }
  finally { if (fixture) await fixture.cleanup(); fs.writeFileSync(output, JSON.stringify(ledger, null, 2)); console.log(JSON.stringify(ledger)); }
})();
