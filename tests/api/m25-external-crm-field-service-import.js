'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-external-crm-field-service-local-disposable-secret';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-external-crm-field-service-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'field-service.primary';
const evidenceDigest = crypto.createHash('sha256').update('opaque-crm-field-service-provider-evidence').digest('hex');
const states = { customer: 'active', lead: 'qualified', job: 'completed', appointment: 'scheduled', issued_estimate: 'issued' };
const base = (recordType, externalRecordId) => ({
  externalRecordId, externalVersion: 1, state: 'active', recordType,
  customerReference: 'customer-ext-1', leadReference: recordType === 'customer' ? null : 'lead-ext-1',
  jobReference: ['job','appointment','issued_estimate'].includes(recordType) ? 'job-ext-1' : null,
  appointmentReference: recordType === 'appointment' ? 'appointment-ext-1' : null,
  estimateReference: recordType === 'issued_estimate' ? 'estimate-ext-1' : null,
  recordState: states[recordType], occurredAt: '2026-09-15T12:00:00.000Z', endedAt: null,
  timeZone: 'America/New_York', evidenceClass: 'provider_recorded', providerEvidenceDigest: evidenceDigest,
  sourceUpdatedAt: '2026-09-15T17:00:00.000Z',
});

(async () => {
  let fixture; const ledger = { cases: [], unavailable: [] };
  try {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const owner = fixture.actors.owner;
    const operationalBefore = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customers) customers,
      (SELECT count(*)::int FROM canonical_opportunities) opportunities,
      (SELECT count(*)::int FROM canonical_appointments) appointments,
      (SELECT count(*)::int FROM canonical_estimates) estimates`)).rows[0];
    const root = `/api/v1/learning/external-crm-field-service-sources/${sourceKey}`;
    const write = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(fixture.app).post(root + suffix)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    const grant = { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use this reviewed CRM and field-service source.', confirmed: true,
      confirmationVersion: 'm25-external-crm-field-service-import-consent-v1' };
    let response = await write('/consent', grant); assert.equal(response.status, 201, JSON.stringify(response.body));
    let consent = response.body.data.consent;
    assert.equal((await write('/consent', grant, crypto.randomUUID(), fixture.actors.member)).status, 403);
    assert.equal((await write('/consent', grant, crypto.randomUUID(), fixture.actors.viewer)).status, 403);
    const adminRoot = '/api/v1/learning/external-crm-field-service-sources/field-service.admin-control';
    const adminGrant = await request(fixture.app).post(adminRoot + '/consent').set(fixture.actors.admin.session.headers)
      .set('X-CSRF-Token', fixture.actors.admin.csrfToken).set('Idempotency-Key', crypto.randomUUID()).send(grant);
    assert.equal(adminGrant.status, 201, JSON.stringify(adminGrant.body));
    ledger.cases.push('Current owners and administrators can grant source-specific import permission; members and viewers cannot.');

    const records = ['customer','lead','job','appointment','issued_estimate'].map(type => base(type, `${type}-1`));
    const batch = (changes = {}) => ({ schemaVersion: 'm25-external-crm-field-service-v1', mode: 'historical_backfill',
      expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest, cursorBefore: null, cursorAfter: null,
      complete: true, records, reason: 'Import one reviewed normalized CRM and field-service page.', confirmed: true,
      confirmationVersion: 'm25-external-crm-field-service-import-batch-v1', ...changes });
    const key = crypto.randomUUID();
    const concurrent = await Promise.all([write('/batches', batch(), key), write('/batches', batch(), key)]);
    assert.deepEqual(concurrent.map(value => value.status).sort(), [200,201], concurrent.map(value => JSON.stringify(value.body)).join('\n'));
    response = concurrent.find(value => value.status === 201); assert.equal(response.body.data.run.insertedCount, 5);
    assert.equal(concurrent.find(value => value.status === 200).headers['idempotency-replayed'], 'true');
    ledger.cases.push('One bounded historical page stages all five record classes; concurrent exact-key retry creates one immutable run.');

    let source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.status, 200, JSON.stringify(source.body));
    assert.equal(source.body.data.recordTotal, 5); assert.equal(source.body.data.currentRecords.every(value => value.reconciliationStatus === 'unmatched'), true);
    assert.equal(source.body.data.currentRecords.find(value => value.recordType === 'job').recordState, 'completed');
    assert.match(source.body.data.consumptionBoundary, /cannot change/);
    const administrator = await request(fixture.app).get(root).set(fixture.actors.admin.session.headers);
    assert.equal(administrator.status, 200); assert.equal(administrator.body.data.recordTotal, 5);
    const other = await request(fixture.app).get(root).set(fixture.actors.otherOwner.session.headers);
    assert.equal(other.status, 200); assert.equal(other.body.data.recordTotal, 0);
    ledger.cases.push('Reads expose explicit unmatched state, remain tenant-private, and state the no-mutation boundary.');

    const directBatch = async body => { const client = await fixture.runtimePool.connect(); try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query('SELECT public.canonical_external_crm_field_service_import_batch($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken, crypto.randomUUID(), sourceKey, JSON.stringify(body)]);
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); } };
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: 'bad', expectedConsentRevision: null, expectedConsentDigest: null })), error => error.code === '22023');
    const invalidZone = base('job','invalid-zone'); invalidZone.timeZone = 'EST';
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: 'bad', records: [invalidZone] })), error => error.code === '22023');
    const duplicatePage = base('job','duplicate-page');
    assert.equal((await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorAfter: 'stream-invalid', records: [duplicatePage, duplicatePage] }))).status, 400);
    ledger.cases.push('Database and API boundaries reject missing consent pins, invalid time zones and ambiguous duplicate page identities.');

    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorAfter: 'duplicate-1', records }));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.duplicateCount, 5);
    const staleCursor = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: 'wrong', cursorAfter: 'wrong-2', records: [base('job','stale-cursor')] }));
    assert.equal(staleCursor.status, 409); assert.equal(staleCursor.body.error.code, 'M25_CRM_FIELD_SERVICE_IMPORT_CHANGED');
    const corrected = { ...base('job','job-1'), externalVersion: 2, recordState: 'unknown',
      sourceUpdatedAt: '2026-09-15T18:00:00.000Z' };
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: 'duplicate-1', cursorAfter: 'stream-1', records: [corrected] }));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.correctedCount, 1);
    source = await request(fixture.app).get(root).set(owner.session.headers);
    assert.equal(source.body.data.currentRecords.find(value => value.externalRecordId === 'job-1').recordState, 'unknown');
    const conflict = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: 'stream-1', cursorAfter: 'stream-2', records: [{ ...corrected, recordState: 'completed' }] }));
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'M25_CRM_FIELD_SERVICE_IMPORT_RECORD_CONFLICT');
    const tombstone = Object.fromEntries(Object.keys(corrected).map(name => [name,
      ['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(name) ? corrected[name] : null]));
    Object.assign(tombstone, { externalVersion: 3, state: 'tombstone', sourceUpdatedAt: '2026-09-15T19:00:00.000Z' });
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: 'stream-1', cursorAfter: 'stream-2', records: [tombstone] }));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.tombstonedCount, 1);
    source = await request(fixture.app).get(root).set(owner.session.headers);
    const removed = source.body.data.currentRecords.find(value => value.externalRecordId === 'job-1');
    assert.equal(removed.state, 'tombstone'); assert.equal(removed.jobReference, null); assert.equal(removed.reconciliationStatus, 'unavailable');
    ledger.cases.push('Distinct-request duplicates deduplicate deterministically; stale cursors and same-version conflicts fail closed; corrections preserve explicit unknowns and tombstones retain no business details.');

    const revoke = { action: 'revoke', expectedRevision: consent.revision, expectedDigest: consent.digest,
      reason: 'Stop using this CRM and field-service source.', confirmed: true,
      confirmationVersion: 'm25-external-crm-field-service-import-consent-v1' };
    response = await write('/consent', revoke); assert.equal(response.status, 201); const revokedConsent = response.body.data.consent;
    source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.body.data.activeConsent, false);
    assert.deepEqual(source.body.data.currentRecords, []);
    response = await write('/batches', batch(), key); assert.equal(response.status, 409); assert.equal(response.headers['idempotency-replayed'], undefined); assert.equal(response.body.data, undefined);
    response = await write('/batches', batch({ reason: 'Changed after revocation.' }), key); assert.equal(response.status, 409);
    response = await write('/consent', { ...grant, expectedRevision: revokedConsent.revision, expectedDigest: revokedConsent.digest,
      reason: 'Start a new reviewed permission period.' }); assert.equal(response.status, 201, JSON.stringify(response.body)); consent = response.body.data.consent;
    source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.body.data.activeConsent, true);
    assert.equal(source.body.data.recordTotal, 0); assert.deepEqual(source.body.data.currentRecords, []);
    response = await write('/batches', batch({ records: [base('job','job-1')], reason: 'Explicitly import current evidence into the new permission period.' }));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.insertedCount, 1);
    source = await request(fixture.app).get(root).set(owner.session.headers);
    assert.equal(source.body.data.recordTotal, 1); assert.equal(source.body.data.currentRecords[0].revision, 1);
    assert.equal(source.body.data.currentRecords[0].previousId, null); assert.equal(source.body.data.currentRecords[0].consentId, consent.id);
    ledger.cases.push('Revocation hides evidence; regrant starts an empty cursor and record lineage, and only an explicit new-period import can stage the same provider version.');

    const privileges = (await fixture.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_crm_field_service_import_records','SELECT') table_read,
      has_function_privilege($1,'canonical_external_crm_field_service_record_projection(canonical_external_crm_field_service_import_records)','EXECUTE') helper,
      has_function_privilege($1,'canonical_external_crm_field_service_import_read(uuid,uuid,text,uuid,text)','EXECUTE') entry`, [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { table_read: false, helper: false, entry: true });
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_crm_field_service_import_records'));
    const bytes = fs.readFileSync(path.join(__dirname,'../../migrations/113_canonical_external_crm_field_service_import_authority.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual((await fixture.ownerPool.query("SELECT trim(checksum) checksum,count(*) OVER()::int rows FROM _migrations WHERE filename='113_canonical_external_crm_field_service_import_authority.sql'")).rows, [{ checksum, rows: 1 }]);
    const operationalAfter = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customers) customers,
      (SELECT count(*)::int FROM canonical_opportunities) opportunities,
      (SELECT count(*)::int FROM canonical_appointments) appointments,
      (SELECT count(*)::int FROM canonical_estimates) estimates`)).rows[0];
    assert.deepEqual(operationalAfter, operationalBefore);
    ledger.cases.push('Runtime access is entry-only, histories are immutable, migration provenance is exact, and staging does not mutate operating records.');
    ledger.unavailable.push('No provider connection, credentials, production account, native financial record, physical device, or production deployment was used.');
    ledger.pass = true;
  } catch (error) {
    ledger.error = error.stack; ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code,
      constraint: error.cause.constraint, detail: error.cause.detail }; process.exitCode = 1;
  } finally {
    if (fixture) await fixture.cleanup();
    fs.writeFileSync(output, JSON.stringify(ledger, null, 2)); console.log(JSON.stringify(ledger));
  }
})();
