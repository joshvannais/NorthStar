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
const ref = value => `ref_${crypto.createHash('sha256').update(`${sourceKey}:${value}`).digest('hex')}`;
const cursor = value => `cur_${crypto.createHash('sha256').update(`${sourceKey}:cursor:${value}`).digest('hex')}`;
const claim = (value, basis) => ({ status: 'recorded', value, basis });
const base = (recordType, externalRecordId) => ({
  externalRecordId: ref(externalRecordId), externalVersion: 1, state: 'active', recordType,
  customerReference: ref('customer-ext-1'), leadReference: ref('lead-ext-1'), jobReference: ref('job-ext-1'),
  appointmentReference: ref('appointment-ext-1'), estimateReference: ref('estimate-ext-1'), projectReference: ref('project-ext-1'),
  communicationReference: ref('communication-ext-1'),
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
      communicationReference: ref(`communication-max-${index}`), timeZone: index % 2 ? 'America/Chicago' : 'America/New_York' }));
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
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: cursor('bad'), expectedConsentRevision: null, expectedConsentDigest: null })), error => error.code === '22023');
    const invalidZone = base('communication','invalid-zone'); invalidZone.timeZone = 'EST';
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: cursor('bad'), records: [invalidZone] })), error => error.code === '22023');
    const invalidValue = base('communication','invalid-value'); invalidValue.intentClaim = claim('request_estimate', 'automated_sentiment');
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: cursor('bad'), records: [invalidValue] })), error => error.code === '22023');
    const crossPurpose = base('communication','cross-purpose'); crossPurpose.satisfactionClaim = claim('satisfied', 'explicit_customer_feedback');
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: cursor('bad'), records: [crossPurpose] })), error => error.code === '22023');
    const inferredSatisfaction = base('satisfaction','inferred-satisfaction'); inferredSatisfaction.satisfactionClaim = claim('satisfied', 'provider_classified');
    await assert.rejects(directBatch(batch({ mode: 'continuous_update', complete: false, cursorAfter: cursor('bad'), records: [inferredSatisfaction] })), error => error.code === '22023');
    const privacyAdversaries = {
      externalRecordId: 'alice@example.com', customerReference: '8605550101', leadReference: '+1 (202) 555-0123',
      jobReference: 'Alice_Smith', appointmentReference: 'Subject:Emergency', estimateReference: 'Transcript:Need_help',
      projectReference: 'Body:Please_call_me_now', communicationReference: 'Message:Call_me',
    };
    for (const [field, prohibited] of Object.entries(privacyAdversaries)) {
      const record = base('communication', `privacy-${field}`); record[field] = prohibited;
      const privacyBatch = batch({ mode: 'continuous_update', complete: false, cursorAfter: cursor(`privacy-${field}`), records: [record] });
      const apiRejected = await write('/batches', privacyBatch);
      assert.equal(apiRejected.status, 400, `${field} accepted by API: ${JSON.stringify(apiRejected.body)}`);
      await assert.rejects(directBatch(privacyBatch), error => error.code === '22023');
    }
    const databaseFields = { externalRecordId: 'external_record_id', customerReference: 'customer_reference',
      leadReference: 'lead_reference', jobReference: 'job_reference', appointmentReference: 'appointment_reference',
      estimateReference: 'estimate_reference', projectReference: 'project_reference', communicationReference: 'communication_reference' };
    for (const [field, prohibited] of Object.entries(privacyAdversaries)) {
      const override = { id: crypto.randomUUID(), external_record_id: ref(`direct-table-${field}`), revision: 999,
        previous_id: null, external_version: 999, [databaseFields[field]]: prohibited };
      await assert.rejects(fixture.ownerPool.query(`INSERT INTO public.canonical_external_communication_import_records
        SELECT (jsonb_populate_record(NULL::public.canonical_external_communication_import_records,
          to_jsonb(record) || $1::jsonb)).*
        FROM public.canonical_external_communication_import_records record
        WHERE record.organization_id=$2 AND record.source_key=$3 AND record.record_type='communication' LIMIT 1`,
      [JSON.stringify(override), fixture.org, sourceKey]),
      error => error.code === '23514');
    }
    ledger.cases.push('Node, guarded PostgreSQL entries and direct table constraints reject content-bearing values in every communication identity/reference field, including email, compact and formatted phone, customer-name, subject, transcript, body and message-like text.');
    const directTableRecord = (recordType, label, override) => fixture.ownerPool.query(`INSERT INTO public.canonical_external_communication_import_records
      SELECT (jsonb_populate_record(NULL::public.canonical_external_communication_import_records,
        to_jsonb(record) || $1::jsonb)).*
      FROM public.canonical_external_communication_import_records record
      WHERE record.organization_id=$2 AND record.source_key=$3 AND record.record_type=$4 LIMIT 1`, [JSON.stringify({
        id: crypto.randomUUID(), external_record_id: ref(`direct-semantic-${label}`), revision: 998,
        previous_id: null, external_version: 998, ...override,
      }), fixture.org, sourceKey, recordType]);
    const semanticPrivacyAdversaries = [
      ['communication','intent-extra', { intent_claim: { ...claim('request_estimate','customer_explicit'), subject: 'Alice needs an estimate' } }],
      ['communication','intent-nested', { intent_claim: { ...claim('request_estimate','customer_explicit'), details: { transcript: 'Call 8605550199' } } }],
      ['communication','intent-status-type', { intent_claim: { status: ['recorded'], value: 'request_estimate', basis: 'customer_explicit' } }],
      ['communication','intent-value-type', { intent_claim: { status: 'recorded', value: { body: 'alice@example.com' }, basis: 'customer_explicit' } }],
      ['satisfaction','satisfaction-extra', { satisfaction_claim: { ...claim('satisfied','explicit_customer_feedback'), customerName: 'Alice', message: 'Please call me' } }],
      ['satisfaction','satisfaction-nested', { satisfaction_claim: { ...claim('satisfied','explicit_customer_feedback'), details: { body: 'alice@example.com' } } }],
      ['satisfaction','satisfaction-basis-type', { satisfaction_claim: { status: 'recorded', value: 'satisfied', basis: { message: 'Call 8605550199' } } }],
      ['communication','time-zone-content', { time_zone: 'Body: call Alice at 8605550199' }],
      ['communication','time-zone-unknown', { time_zone: 'America/Not_A_Real_Zone' }],
    ];
    for (const [recordType, label, override] of semanticPrivacyAdversaries) {
      const record = base(recordType, `semantic-${label}`);
      if ('intent_claim' in override) record.intentClaim = override.intent_claim;
      if ('satisfaction_claim' in override) record.satisfactionClaim = override.satisfaction_claim;
      if ('time_zone' in override) record.timeZone = override.time_zone;
      const rejectedBatch = batch({ mode: 'continuous_update', complete: false, cursorAfter: cursor(`semantic-${label}`), records: [record] });
      const apiRejected = await write('/batches', rejectedBatch);
      assert.equal(apiRejected.status, 400, `${label} accepted by API: ${JSON.stringify(apiRejected.body)}`);
      await assert.rejects(directBatch(rejectedBatch), error => error.code === '22023');
      await assert.rejects(directTableRecord(recordType, label, override), error => ['23503','23514'].includes(error.code));
    }
    const validDirectClient = await fixture.ownerPool.connect();
    try {
      const selectionControl = await validDirectClient.query(`SELECT
        (SELECT array_agg(DISTINCT time_zone ORDER BY time_zone)
         FROM public.canonical_external_communication_import_records
         WHERE organization_id=$1 AND source_key='communications.admin-control') AS other_source_zones,
        (SELECT time_zone FROM public.canonical_external_communication_import_records
         WHERE organization_id=$1 AND source_key=$2 AND external_record_id=$3
         ORDER BY revision DESC LIMIT 1) AS selected_zone`, [fixture.org, sourceKey, ref('communication-1')]);
      assert.deepEqual(selectionControl.rows[0].other_source_zones, ['America/Chicago','America/New_York']);
      assert.equal(selectionControl.rows[0].selected_zone, 'America/New_York');
      await validDirectClient.query('BEGIN');
      const validDirect = await validDirectClient.query(`INSERT INTO public.canonical_external_communication_import_records
        SELECT (jsonb_populate_record(NULL::public.canonical_external_communication_import_records,
          to_jsonb(record) || $1::jsonb)).*
        FROM public.canonical_external_communication_import_records record
        WHERE record.organization_id=$2 AND record.source_key=$3 AND record.external_record_id=$4
        ORDER BY record.revision DESC LIMIT 1 RETURNING intent_claim,time_zone`,
      [JSON.stringify({ id: crypto.randomUUID(), external_record_id: ref('direct-semantic-valid'), revision: 997,
        previous_id: null, external_version: 997 }), fixture.org, sourceKey, ref('communication-1')]);
      assert.equal(validDirect.rows[0].intent_claim.value, 'request_estimate');
      assert.equal(validDirect.rows[0].time_zone, 'America/New_York');
    } finally { await validDirectClient.query('ROLLBACK').catch(() => {}); validDirectClient.release(); }
    ledger.cases.push('Exact claim shapes and the immutable known-time-zone catalog reject extra keys, nested private content, unexpected types, free-form text and unknown zones at every privacy layer while valid records remain accepted.');
    const duplicatePage = base('communication','duplicate-page');
    assert.equal((await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorAfter: cursor('stream-invalid'), records: [duplicatePage, duplicatePage] }))).status, 400);
    ledger.cases.push('Database and API boundaries reject missing consent pins, invalid time zones, unsupported intent bases, cross-purpose facts, inferred satisfaction labels, and ambiguous duplicate page identities.');

    const duplicateCursor = cursor('duplicate-1'); const streamOne = cursor('stream-1'); const streamTwo = cursor('stream-2');
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorAfter: duplicateCursor, records }));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.duplicateCount, 3);
    const staleCursor = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: cursor('wrong'), cursorAfter: cursor('wrong-2'), records: [base('communication','stale-cursor')] }));
    assert.equal(staleCursor.status, 409); assert.equal(staleCursor.body.error.code, 'M25_COMMUNICATION_IMPORT_CHANGED');
    const corrected = { ...base('communication','communication-1'), externalVersion: 2,
      intentClaim: { status: 'unavailable', value: null, basis: null },
      sourceUpdatedAt: '2026-09-15T18:00:00.000Z' };
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: duplicateCursor, cursorAfter: streamOne, records: [corrected] }));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.correctedCount, 1);
    source = await request(fixture.app).get(root).set(owner.session.headers);
    assert.equal(source.body.data.currentRecords.find(value => value.externalRecordId === ref('communication-1')).intentClaim.status, 'unavailable');
    const conflict = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: streamOne, cursorAfter: streamTwo, records: [{ ...corrected, direction: 'outbound' }] }));
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'M25_COMMUNICATION_IMPORT_RECORD_CONFLICT');
    const tombstone = Object.fromEntries(Object.keys(corrected).map(name => [name,
      ['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(name) ? corrected[name] : null]));
    Object.assign(tombstone, { externalVersion: 3, state: 'tombstone', sourceUpdatedAt: '2026-09-15T19:00:00.000Z' });
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: streamOne, cursorAfter: streamTwo, records: [tombstone] }));
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.tombstonedCount, 1);
    source = await request(fixture.app).get(root).set(owner.session.headers);
    const removed = source.body.data.currentRecords.find(value => value.externalRecordId === ref('communication-1'));
    assert.equal(removed.state, 'tombstone'); assert.equal(removed.communicationReference, null); assert.equal(removed.intentClaim, null); assert.equal(removed.reconciliationStatus, 'unavailable');
    ledger.cases.push('Distinct-request duplicates deduplicate deterministically; stale cursors and same-version conflicts fail closed; corrections preserve explicit unknowns and tombstones retain no business details.');

    const revoke = { action: 'revoke', expectedRevision: consent.revision, expectedDigest: consent.digest,
      reason: 'Stop using this communication source.', confirmed: true,
      confirmationVersion: 'm25-external-communication-import-consent-v1' };
    response = await write('/consent', revoke); assert.equal(response.status, 201); const revokedConsent = response.body.data.consent;
    source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.body.data.activeConsent, false);
    assert.deepEqual(source.body.data.currentRecords, []);
    response = await write('/batches', batch(), key); assert.equal(response.status, 409); assert.equal(response.headers['idempotency-replayed'], undefined); assert.equal(response.body.data, undefined);
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
      has_table_privilege($1,'canonical_external_communication_time_zones','SELECT') zone_read,
      has_table_privilege($1,'canonical_external_communication_time_zones','INSERT') zone_insert,
      has_table_privilege($1,'canonical_external_communication_time_zones','UPDATE') zone_update,
      has_table_privilege($1,'canonical_external_communication_time_zones','DELETE') zone_delete,
      has_function_privilege($1,'canonical_external_communication_record_projection(canonical_external_communication_import_records)','EXECUTE') helper,
      has_function_privilege($1,'canonical_external_communication_import_read(uuid,uuid,text,uuid,text)','EXECUTE') entry`, [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { table_read: false, zone_read: false, zone_insert: false,
      zone_update: false, zone_delete: false, helper: false, entry: true });
    await assert.rejects(fixture.runtimePool.query('SELECT name FROM canonical_external_communication_time_zones LIMIT 1'), error => error.code === '42501');
    await assert.rejects(fixture.runtimePool.query("INSERT INTO canonical_external_communication_time_zones(name) VALUES('America/Runtime_Test')"), error => error.code === '42501');
    await assert.rejects(fixture.runtimePool.query("UPDATE canonical_external_communication_time_zones SET name='America/Runtime_Test' WHERE name='UTC'"), error => error.code === '42501');
    await assert.rejects(fixture.runtimePool.query("DELETE FROM canonical_external_communication_time_zones WHERE name='UTC'"), error => error.code === '42501');
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
