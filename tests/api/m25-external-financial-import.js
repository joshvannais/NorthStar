'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-external-financial-local-disposable-secret';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-external-financial-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'financial.primary';
const evidenceDigest = crypto.createHash('sha256').update('opaque-financial-provider-evidence').digest('hex');
const ref = value => `ref_${crypto.createHash('sha256').update(`${sourceKey}:${value}`).digest('hex')}`;
const cursor = value => `cur_${crypto.createHash('sha256').update(`${sourceKey}:cursor:${value}`).digest('hex')}`;
const amount = (value, basis) => ({ status: 'recorded', amount: value, currency: 'USD', basis });
const base = (recordType, label) => ({
  externalRecordId: ref(label), externalVersion: 1, state: 'active', recordType,
  customerReference: ref('customer-1'), jobReference: ref('job-1'), estimateReference: ref('estimate-1'),
  executionReference: ref('execution-1'), projectReference: ref('project-1'), changeOrderReference: ref('change-1'),
  invoiceReference: recordType === 'invoice' ? ref(`invoice-${label}`) : null,
  paymentReference: recordType === 'payment' ? ref(`payment-${label}`) : null,
  collectionReference: recordType === 'collection' ? ref(`collection-${label}`) : null,
  accountingReference: recordType === 'accounting_entry' ? ref(`accounting-${label}`) : null,
  recordState: { invoice: 'issued', payment: 'succeeded', collection: 'settled', accounting_entry: 'posted' }[recordType],
  amountClaim: amount('1250.25', { invoice: 'invoice_total', payment: 'payment_received', collection: 'amount_collected', accounting_entry: 'revenue' }[recordType]),
  occurredAt: '2026-09-15T12:00:00.000Z', timeZone: 'America/New_York', evidenceClass: 'provider_recorded',
  providerEvidenceDigest: evidenceDigest, sourceUpdatedAt: '2026-09-15T17:00:00.000Z',
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
      (SELECT count(*)::int FROM canonical_estimates) estimates,
      (SELECT count(*)::int FROM canonical_field_executions) executions`)).rows[0];
    const root = `/api/v1/learning/external-financial-sources/${sourceKey}`;
    const write = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(fixture.app).post(root + suffix)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    const grant = { action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Use this reviewed financial source.',
      confirmed: true, confirmationVersion: 'm25-external-financial-import-consent-v1' };
    let response = await write('/consent', grant); assert.equal(response.status, 201, JSON.stringify(response.body));
    let consent = response.body.data.consent;
    assert.equal((await write('/consent', grant, crypto.randomUUID(), fixture.actors.member)).status, 403);
    assert.equal((await write('/consent', grant, crypto.randomUUID(), fixture.actors.viewer)).status, 403);

    const adminRoot = '/api/v1/learning/external-financial-sources/financial.admin-control';
    const adminGrant = await request(fixture.app).post(adminRoot + '/consent').set(fixture.actors.admin.session.headers)
      .set('X-CSRF-Token', fixture.actors.admin.csrfToken).set('Idempotency-Key', crypto.randomUUID()).send(grant);
    assert.equal(adminGrant.status, 201, JSON.stringify(adminGrant.body));
    const maximumRecords = Array.from({ length: 100 }, (_, index) => ({ ...base('invoice', `maximum-${index}`),
      timeZone: index % 2 ? 'America/Chicago' : 'America/New_York' }));
    const maximumStarted = Date.now();
    const maximumPage = await request(fixture.app).post(adminRoot + '/batches').set(fixture.actors.admin.session.headers)
      .set('X-CSRF-Token', fixture.actors.admin.csrfToken).set('Idempotency-Key', crypto.randomUUID()).send({
        schemaVersion: 'm25-external-financial-evidence-v1', mode: 'historical_backfill',
        expectedConsentRevision: adminGrant.body.data.consent.revision, expectedConsentDigest: adminGrant.body.data.consent.digest,
        cursorBefore: null, cursorAfter: null, complete: true, records: maximumRecords,
        reason: 'Verify the maximum reviewed financial page.', confirmed: true,
        confirmationVersion: 'm25-external-financial-import-batch-v1',
      });
    assert.equal(maximumPage.status, 201, JSON.stringify(maximumPage.body));
    assert.equal(maximumPage.body.data.run.insertedCount, 100); assert.ok(Date.now() - maximumStarted < 4000);
    ledger.cases.push('Owner and administrator authority is separate from member and viewer access; a 100-record, multi-zone page finishes with headroom under five seconds.');

    const records = ['invoice','payment','collection','accounting_entry'].map(type => base(type, `${type}-1`));
    const batch = (changes = {}) => ({ schemaVersion: 'm25-external-financial-evidence-v1', mode: 'historical_backfill',
      expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest, cursorBefore: null, cursorAfter: null,
      complete: true, records, reason: 'Import one reviewed normalized financial page.', confirmed: true,
      confirmationVersion: 'm25-external-financial-import-batch-v1', ...changes });
    const key = crypto.randomUUID();
    const concurrent = await Promise.all([write('/batches', batch(), key), write('/batches', batch(), key)]);
    assert.deepEqual(concurrent.map(value => value.status).sort(), [200,201], concurrent.map(value => JSON.stringify(value.body)).join('\n'));
    assert.equal(concurrent.find(value => value.status === 201).body.data.run.insertedCount, 4);
    assert.equal(concurrent.find(value => value.status === 200).headers['idempotency-replayed'], 'true');
    let source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.status, 200, JSON.stringify(source.body));
    assert.equal(source.body.data.recordTotal, 4); assert.equal(source.body.data.currentRecords.every(value => value.reconciliationStatus === 'unmatched'), true);
    assert.deepEqual(source.body.data.currentRecords.map(value => value.recordType).sort(), ['accounting_entry','collection','invoice','payment']);
    assert.match(source.body.data.nativeAuthorityBoundary, /does not create NorthStar invoices/); assert.match(source.body.data.consumptionBoundary, /cannot change/);
    assert.equal((await request(fixture.app).get(root).set(fixture.actors.otherOwner.session.headers)).body.data.recordTotal, 0);
    ledger.cases.push('Four independent evidence types stage as unmatched, remain tenant-private, and expose the native Mission 27 boundary.');

    const directBatch = async body => { const client = await fixture.runtimePool.connect(); try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query('SELECT public.canonical_external_financial_import_batch($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken, crypto.randomUUID(), sourceKey, JSON.stringify(body)]);
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); } };
    const invalidRecords = [
      { ...base('invoice','bad-zone'), timeZone: 'EST' },
      { ...base('payment','wrong-basis'), amountClaim: amount('10', 'revenue') },
      { ...base('invoice','cross-type'), paymentReference: ref('payment-cross') },
      { ...base('collection','negative'), amountClaim: amount('-1', 'amount_collected') },
      { ...base('accounting_entry','extra-amount'), amountClaim: { ...amount('1', 'revenue'), memo: 'Call Alice' } },
      { ...base('invoice','content-ref'), invoiceReference: 'invoice for alice@example.com' },
    ];
    for (const [index, record] of invalidRecords.entries()) {
      const invalid = batch({ mode: 'continuous_update', complete: false, cursorAfter: cursor(`invalid-${index}`), records: [record] });
      assert.equal((await write('/batches', invalid)).status, 400);
      await assert.rejects(directBatch(invalid), error => error.code === '22023');
    }
    const directTableSql = `INSERT INTO public.canonical_external_financial_import_records
      SELECT (jsonb_populate_record(NULL::public.canonical_external_financial_import_records,to_jsonb(record) || $1::jsonb)).*
      FROM public.canonical_external_financial_import_records record
      WHERE record.organization_id=$2 AND record.source_key=$3 AND record.record_type=$4 LIMIT 1`;
    const directTable = (type, label, override, client = fixture.ownerPool) => client.query(directTableSql, [JSON.stringify({
        id: crypto.randomUUID(), external_record_id: ref(`direct-${label}`), revision: 999, previous_id: null, external_version: 999, ...override,
      }), fixture.org, sourceKey, type]);
    const directNullAndShapeAdversaries = [
      ['null-record-type', { record_type: null }],
      ['null-record-state', { record_state: null }],
      ['null-amount', { amount_claim: null }],
      ['null-evidence-class', { evidence_class: null }],
      ['null-evidence-digest', { provider_evidence_digest: null }],
      ['scalar-amount', { amount_claim: '100' }],
      ['array-amount', { amount_claim: [] }],
      ['empty-amount', { amount_claim: {} }],
      ['missing-amount-key', { amount_claim: { status: 'recorded', amount: '1', currency: 'USD' } }],
      ['extra-amount-key', { amount_claim: { ...amount('1','invoice_total'), memo: 'private' } }],
      ['wrong-amount-type', { amount_claim: { status: 'recorded', amount: 1, currency: 'USD', basis: 'invoice_total' } }],
      ['invalid-record-type', { record_type: 'receipt' }],
      ['invalid-record-state', { record_state: 'complete' }],
      ['invalid-evidence-class', { evidence_class: 'provider_guessed' }],
      ['invalid-evidence-digest', { provider_evidence_digest: 'not-a-digest' }],
    ];
    for (const [label, override] of directNullAndShapeAdversaries) {
      await assert.rejects(directTable('invoice', label, override), error => error.code === '23514', label);
    }
    await assert.rejects(directTable('invoice','extra-claim', { amount_claim: { ...amount('1','invoice_total'), accountNumber: '1234' } }), error => error.code === '23514');
    await assert.rejects(directTable('invoice','raw-ref', { invoice_reference: 'alice@example.com' }), error => error.code === '23514');
    await assert.rejects(directTable('invoice','unknown-zone', { time_zone: 'America/Not_A_Real_Zone' }), error => error.code === '23503');
    const ownerControl = await fixture.ownerPool.connect();
    try {
      await ownerControl.query('BEGIN');
      assert.equal((await directTable('invoice','valid-active-control', {}, ownerControl)).rowCount, 1);
      assert.equal((await directTable('invoice','valid-tombstone-control', {
        state: 'tombstone', record_type: null, customer_reference: null, job_reference: null,
        estimate_reference: null, execution_reference: null, project_reference: null, change_order_reference: null,
        invoice_reference: null, payment_reference: null, collection_reference: null, accounting_reference: null,
        record_state: null, amount_claim: null, occurred_at: null, time_zone: null, evidence_class: null,
        provider_evidence_digest: null,
      }, ownerControl)).rowCount, 1);
    } finally { await ownerControl.query('ROLLBACK').catch(() => {}); ownerControl.release(); }
    ledger.cases.push('Node, guarded entries, and direct-table constraints reject SQL nulls, malformed amount shapes, invalid classes, unknown zones, cross-type references, negative or ambiguous amounts, extra content, and raw identifiers while valid active and tombstone controls remain accepted.');

    const duplicateCursor = cursor('duplicate'); const correctionCursor = cursor('correction'); const tombstoneCursor = cursor('tombstone');
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorAfter: duplicateCursor }));
    assert.equal(response.status, 201); assert.equal(response.body.data.run.duplicateCount, 4);
    const corrected = { ...base('invoice','invoice-1'), externalVersion: 2,
      amountClaim: { status: 'unavailable', amount: null, currency: null, basis: null }, sourceUpdatedAt: '2026-09-15T18:00:00.000Z' };
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: duplicateCursor,
      cursorAfter: correctionCursor, records: [corrected] }));
    assert.equal(response.status, 201); assert.equal(response.body.data.run.correctedCount, 1);
    source = await request(fixture.app).get(root).set(owner.session.headers);
    assert.equal(source.body.data.currentRecords.find(value => value.externalRecordId === corrected.externalRecordId).amountClaim.status, 'unavailable');
    const conflict = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: correctionCursor,
      cursorAfter: tombstoneCursor, records: [{ ...corrected, recordState: 'paid' }] }));
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'M25_FINANCIAL_IMPORT_RECORD_CONFLICT');
    const tombstone = Object.fromEntries(Object.keys(corrected).map(name => [name,
      ['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(name) ? corrected[name] : null]));
    Object.assign(tombstone, { externalVersion: 3, state: 'tombstone', sourceUpdatedAt: '2026-09-15T19:00:00.000Z' });
    response = await write('/batches', batch({ mode: 'continuous_update', complete: false, cursorBefore: correctionCursor,
      cursorAfter: tombstoneCursor, records: [tombstone] }));
    assert.equal(response.status, 201); assert.equal(response.body.data.run.tombstonedCount, 1);
    source = await request(fixture.app).get(root).set(owner.session.headers);
    const removed = source.body.data.currentRecords.find(value => value.externalRecordId === corrected.externalRecordId);
    assert.equal(removed.state, 'tombstone'); assert.equal(removed.amountClaim, null); assert.equal(removed.invoiceReference, null);

    const revoke = { action: 'revoke', expectedRevision: consent.revision, expectedDigest: consent.digest,
      reason: 'Stop using this financial source.', confirmed: true, confirmationVersion: 'm25-external-financial-import-consent-v1' };
    response = await write('/consent', revoke); assert.equal(response.status, 201); const revoked = response.body.data.consent;
    source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.body.data.activeConsent, false); assert.deepEqual(source.body.data.currentRecords, []);
    response = await write('/consent', { ...grant, expectedRevision: revoked.revision, expectedDigest: revoked.digest,
      reason: 'Start a new reviewed permission period.' }); assert.equal(response.status, 201); consent = response.body.data.consent;
    source = await request(fixture.app).get(root).set(owner.session.headers); assert.equal(source.body.data.recordTotal, 0);
    response = await write('/batches', batch({ expectedConsentRevision: consent.revision, expectedConsentDigest: consent.digest,
      records: [base('invoice','invoice-1')], reason: 'Explicitly stage current evidence in the new permission period.' }));
    assert.equal(response.status, 201); source = await request(fixture.app).get(root).set(owner.session.headers);
    assert.equal(source.body.data.recordTotal, 1); assert.equal(source.body.data.currentRecords[0].revision, 1); assert.equal(source.body.data.currentRecords[0].previousId, null);
    ledger.cases.push('Corrections preserve unavailable facts, same-version conflicts fail closed, tombstones retain no financial details, and permission regrant cannot revive old records.');

    const privileges = (await fixture.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_financial_import_records','SELECT') table_read,
      has_table_privilege($1,'canonical_external_financial_time_zones','SELECT') zone_read,
      has_table_privilege($1,'canonical_external_financial_time_zones','INSERT') zone_insert,
      has_function_privilege($1,'canonical_external_financial_record_projection(canonical_external_financial_import_records)','EXECUTE') helper,
      has_function_privilege($1,'canonical_external_financial_import_read(uuid,uuid,text,uuid,text)','EXECUTE') entry`, [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { table_read: false, zone_read: false, zone_insert: false, helper: false, entry: true });
    await assert.rejects(fixture.runtimePool.query('SELECT name FROM canonical_external_financial_time_zones LIMIT 1'), error => error.code === '42501');
    await assert.rejects(fixture.runtimePool.query("INSERT INTO canonical_external_financial_time_zones(name) VALUES('America/Runtime_Test')"), error => error.code === '42501');
    await assert.rejects(fixture.runtimePool.query("UPDATE canonical_external_financial_time_zones SET name='America/Runtime_Test' WHERE name='UTC'"), error => error.code === '42501');
    await assert.rejects(fixture.runtimePool.query("DELETE FROM canonical_external_financial_time_zones WHERE name='UTC'"), error => error.code === '42501');
    await assert.rejects(fixture.runtimePool.query('INSERT INTO canonical_external_financial_import_consents DEFAULT VALUES'), error => error.code === '42501');
    await assert.rejects(fixture.runtimePool.query('UPDATE canonical_external_financial_import_consents SET reason=reason'), error => error.code === '42501');
    await assert.rejects(fixture.runtimePool.query('DELETE FROM canonical_external_financial_import_records'), error => error.code === '42501');
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_financial_import_records'));
    const bytes = fs.readFileSync(path.join(__dirname,'../../migrations/116_canonical_external_financial_import_authority.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual((await fixture.ownerPool.query("SELECT trim(checksum) checksum,count(*) OVER()::int rows FROM _migrations WHERE filename='116_canonical_external_financial_import_authority.sql'")).rows, [{ checksum, rows: 1 }]);
    const operationalAfter = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_customers) customers,
      (SELECT count(*)::int FROM canonical_opportunities) opportunities,
      (SELECT count(*)::int FROM canonical_appointments) appointments,
      (SELECT count(*)::int FROM canonical_estimates) estimates,
      (SELECT count(*)::int FROM canonical_field_executions) executions`)).rows[0];
    assert.deepEqual(operationalAfter, operationalBefore);
    ledger.cases.push('Runtime access is entry-only, histories are immutable, migration provenance is exact, and staging does not mutate operating records.');
    ledger.unavailable.push('No provider connection, credentials, production account, native Mission 27 financial record, physical device, or deployment was used.');
    ledger.pass = true;
  } catch (error) {
    ledger.error = error.stack; ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code,
      constraint: error.cause.constraint, detail: error.cause.detail }; process.exitCode = 1;
  } finally {
    if (fixture) await fixture.cleanup();
    fs.writeFileSync(output, JSON.stringify(ledger, null, 2)); console.log(JSON.stringify(ledger));
  }
})();
