'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-external-communication-local-disposable-secret';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-external-communication-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'communications.primary';
const evidenceDigest = crypto.createHash('sha256').update('opaque-communication-provider-evidence').digest('hex');
const claim = (value, basis) => ({ status: 'recorded', value, basis });
const base = (recordType, externalRecordId) => ({
  externalRecordId, externalVersion: 1, state: 'active', recordType,
  customerReference: 'customer-ext-1', leadReference: 'lead-ext-1', jobReference: 'job-ext-1',
  appointmentReference: 'appointment-ext-1', estimateReference: 'estimate-ext-1', projectReference: 'project-ext-1',
  communicationReference: 'communication-ext-1',
  channel: recordType === 'communication' ? 'phone' : null,
  direction: recordType === 'communication' ? 'inbound' : null,
  intentClaim: recordType === 'communication' ? claim('request_estimate', 'customer_explicit') : null,
  deliveryState: recordType === 'delivery' ? 'delivered' : null,
  satisfactionClaim: recordType === 'satisfaction' ? claim('satisfied', 'explicit_customer_feedback') : null,
  occurredAt: '2026-09-15T12:00:00.000Z',
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
    const root = `/api/v1/learning/external-communication-sources/${sourceKey}`;
    const write = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(fixture.app).post(root + suffix)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    const grant = { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use this reviewed communication source.', confirmed: true,
      confirmationVersion: 'm25-external-communication-import-consent-v1' };
    let response = await write('/consent', grant); assert.equal(response.status, 201, JSON.stringify(response.body));
    let consent = response.body.data.consent;
    assert.equal((await write('/consent', grant, crypto.randomUUID(), fixture.actors.member)).status, 403);
    assert.equal((await write('/consent', grant, crypto.randomUUID(), fixture.actors.viewer)).status, 403);
    const adminRoot = '/api/v1/learning/external-communication-sources/communications.admin-control';
    const adminGrant = await request(fixture.app).post(adminRoot + '/consent').set(fixture.actors.admin.session.headers)
      .set('X-CSRF-Token', fixture.actors.admin.csrfToken).set('Idempotency-Key', crypto.randomUUID()).send(grant);
    assert.equal(adminGrant.status, 201, JSON.stringify(adminGrant.body));
    const maximumRecords = Array.from({ length: 100 }, (_, index) => ({ ...base('communication', `communication-max-${index}`),
      communicationReference: `communication-max-${index}`, timeZone: index % 2 ? 'America/Chicago' : 'America/New_York' }));
    const maximumStarted = Date.now();
    const maximumPage = await request(fixture.app).post(adminRoot + '/batches').set(fixture.actors.admin.session.headers)
      .set('X-CSRF-Token', fixture.actors.admin.csrfToken).set('Idempotency-Key', crypto.randomUUID()).send({
        schemaVersion: 'm25-external-communication-evidence-v1', mode: 'historical_backfill',
        expectedConsentRevision: adminGrant.body.data.consent.revision, expectedConsentDigest: adminGrant.body.data.consent.digest,
        cursorBefore: null, cursorAfter: null, complete: true, records: maximumRecords,
        reason: 'Verify the maximum reviewed communication page.', confirmed: true,
        confirmationVersion: 'm25-external-communication-import-batch-v1',
      });
    assert.equal(maximumPage.status, 201, JSON.stringify(maximumPage.body));
    assert.equal(maximumPage.body.data.run.insertedCount, 100); assert.ok(Date.now() - maximumStarted < 4000);
    ledger.cases.push('Current owners and administrators can grant source-specific import permission; members and viewers cannot.');
    ledger.cases.push('A 100-record page with multiple valid time zones completes with headroom under the fixed five-second statement timeout.');

    const records = ['communication','delivery','satisfaction'].map(type => base(type, `${type}-1`));
    const batch = (changes = {}) => ({ schemaVersion: 'm25-external-communication-evidence-v1', mode: 'historical_backfill',
      expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest, cursorBefore: null, cursorAfter: null,
      complete: true, records, reason: 'Import one reviewed normalized communication page.', confirmed: true,
      confirmationVersion: 'm25-external-communication-import-batch-v1', ...changes });
    const key = crypto.randomUUID();
    const concurrent = await Promise.all([write('/batches', batch(), key), write('/batches', batch(), key)]);
    assert.deepEqual(concurrent.map(value => value.status).sort(), [200,201], concurrent.map(value => JSON.stringify(value.body)).join('\n'));
    response = concurrent.find(value => value.status === 201); assert.equal(response.body.data.run.insertedCount, 3);
    assert.equal(concurrent.find(value => value.status === 200).headers['idempotency-replayed'], 'true');
    ledger.cases.push('One bounded historical page stages separate communication, delivery, and explicit customer-feedback evidence; concurrent exact-key retry creates one immutable run.');

    let source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.status, 200, JSON.stringify(source.body));
    assert.equal(source.body.data.recordTotal, 3); assert.equal(source.body.data.currentRecords.every(value => value.reconciliationStatus === 'unmatched'), true);
    assert.equal(source.body.data.currentRecords.find(value => value.recordType === 'communication').intentClaim.value, 'request_estimate');
    assert.equal(source.body.data.currentRecords.find(value => value.recordType === 'delivery').deliveryState, 'delivered');
    assert.equal(source.body.data.currentRecords.find(value => value.recordType === 'satisfaction').satisfactionClaim.value, 'satisfied');
    assert.match(source.body.data.consumptionBoundary, /cannot change/);
    const administrator = await request(fixture.app).get(root).set(fixture.actors.admin.session.headers);
    assert.equal(administrator.status, 200); assert.equal(administrator.body.data.recordTotal, 3);
    const other = await request(fixture.app).get(root).set(fixture.actors.otherOwner.session.headers);
    assert.equal(other.status, 200); assert.equal(other.body.data.recordTotal, 0);
    ledger.cases.push('Reads expose explicit unmatched state, remain tenant-private, and state the no-mutation boundary.');

    const directBatch = async body => { const client = await fixture.runtimePool.connect(); try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query('SELECT public.canonical_external_communication_import_batch($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken, crypto.randomUUID(), sourceKey, JSON.stringify(body)]);
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); } };
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: 'bad', expectedConsentRevision: null, expectedConsentDigest: null })), error => error.code === '22023');
    const invalidZone = base('communication','invalid-zone'); invalidZone.timeZone = 'EST';
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: 'bad', records: [invalidZone] })), error => error.code === '22023');
    const invalidValue = base('communication','invalid-value'); invalidValue.intentClaim = claim('request_estimate', 'automated_sentiment');
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: 'bad', records: [invalidValue] })), error => error.code === '22023');
    const crossPurpose = base('communication','cross-purpose'); crossPurpose.satisfactionClaim = claim('satisfied', 'explicit_customer_feedback');
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: 'bad', records: [crossPurpose] })), error => error.code === '22023');
    const inferredSatisfaction = base('satisfaction','inferred-satisfaction'); inferredSatisfaction.satisfactionClaim = claim('satisfied', 'provider_classified');
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: 'bad', records: [inferredSatisfaction] })), error => error.code === '22023');
    const duplicatePage = base('communication','duplicate-page');
    assert.equal((await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorAfter: 'stream-invalid', records: [duplicatePage, duplicatePage] }))).status, 400);
    ledger.cases.push('Database and API boundaries reject missing consent pins, invalid time zones, unsupported intent bases, cross-purpose facts, inferred satisfaction labels, and ambiguous duplicate page identities.');

    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorAfter: 'duplicate-1', records }));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.duplicateCount, 3);
    const staleCursor = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: 'wrong', cursorAfter: 'wrong-2', records: [base('communication','stale-cursor')] }));
    assert.equal(staleCursor.status, 409); assert.equal(staleCursor.body.error.code, 'M25_COMMUNICATION_IMPORT_CHANGED');
    const corrected = { ...base('communication','communication-1'), externalVersion: 2,
      intentClaim: { status: 'unavailable', value: null, basis: null },
      sourceUpdatedAt: '2026-09-15T18:00:00.000Z' };
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: 'duplicate-1', cursorAfter: 'stream-1', records: [corrected] }));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.correctedCount, 1);
    source = await request(fixture.app).get(root).set(owner.session.headers);
    assert.equal(source.body.data.currentRecords.find(value => value.externalRecordId === 'communication-1').intentClaim.status, 'unavailable');
    const conflict = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: 'stream-1', cursorAfter: 'stream-2', records: [{ ...corrected, direction: 'outbound' }] }));
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'M25_COMMUNICATION_IMPORT_RECORD_CONFLICT');
    const tombstone = Object.fromEntries(Object.keys(corrected).map(name => [name,
      ['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(name) ? corrected[name] : null]));
    Object.assign(tombstone, { externalVersion: 3, state: 'tombstone', sourceUpdatedAt: '2026-09-15T19:00:00.000Z' });
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: 'stream-1', cursorAfter: 'stream-2', records: [tombstone] }));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.tombstonedCount, 1);
    source = await request(fixture.app).get(root).set(owner.session.headers);
    const removed = source.body.data.currentRecords.find(value => value.externalRecordId === 'communication-1');
    assert.equal(removed.state, 'tombstone'); assert.equal(removed.communicationReference, null); assert.equal(removed.intentClaim, null); assert.equal(removed.reconciliationStatus, 'unavailable');
    ledger.cases.push('Distinct-request duplicates deduplicate deterministically; stale cursors and same-version conflicts fail closed; corrections preserve explicit unknowns and tombstones retain no business details.');

    const revoke = { action: 'revoke', expectedRevision: consent.revision, expectedDigest: consent.digest,
      reason: 'Stop using this communication source.', confirmed: true,
      confirmationVersion: 'm25-external-communication-import-consent-v1' };
    response = await write('/consent', revoke); assert.equal(response.status, 201); const revokedConsent = response.body.data.consent;
    source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.body.data.activeConsent, false);
    assert.deepEqual(source.body.data.currentRecords, []);
    response = await write('/batches', batch(), key); assert.equal(response.status, 200); assert.equal(response.headers['idempotency-replayed'], 'true');
    response = await write('/batches', batch({ reason: 'Changed after revocation.' }), key); assert.equal(response.status, 409);
    response = await write('/consent', { ...grant, expectedRevision: revokedConsent.revision, expectedDigest: revokedConsent.digest,
      reason: 'Start a new reviewed permission period.' }); assert.equal(response.status, 201, JSON.stringify(response.body)); consent = response.body.data.consent;
    source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.body.data.activeConsent, true);
    assert.equal(source.body.data.recordTotal, 0); assert.deepEqual(source.body.data.currentRecords, []);
    response = await write('/batches', batch({ records: [base('communication','communication-1')], reason: 'Explicitly import current evidence into the new permission period.' }));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.insertedCount, 1);
    source = await request(fixture.app).get(root).set(owner.session.headers);
    assert.equal(source.body.data.recordTotal, 1); assert.equal(source.body.data.currentRecords[0].revision, 1);
    assert.equal(source.body.data.currentRecords[0].previousId, null); assert.equal(source.body.data.currentRecords[0].consentId, consent.id);
    ledger.cases.push('Revocation hides evidence; regrant starts an empty cursor and record lineage, and only an explicit new-period import can stage the same provider version.');

    const privileges = (await fixture.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_communication_import_records','SELECT') table_read,
      has_function_privilege($1,'canonical_external_communication_record_projection(canonical_external_communication_import_records)','EXECUTE') helper,
      has_function_privilege($1,'canonical_external_communication_import_read(uuid,uuid,text,uuid,text)','EXECUTE') entry`, [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { table_read: false, helper: false, entry: true });
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_communication_import_records'));
    const bytes = fs.readFileSync(path.join(__dirname,'../../migrations/115_canonical_external_communication_import_authority.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual((await fixture.ownerPool.query("SELECT trim(checksum) checksum,count(*) OVER()::int rows FROM _migrations WHERE filename='115_canonical_external_communication_import_authority.sql'")).rows, [{ checksum, rows: 1 }]);
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
