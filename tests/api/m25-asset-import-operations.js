'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-asset-import-operations-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-asset-import-operations-result.json').slice(9);
assert.ok(!fs.existsSync(output));

const consentBody = { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
  reason: 'Use reviewed fleet operations evidence.', confirmed: true,
  confirmationVersion: 'm25-external-asset-import-consent-v1' };
const record = (id, version = 1, date = '2026-01-10') => ({ externalRecordId: id, externalVersion: version,
  state: 'active', recordType: 'utilization', jobReference: `job-${id}`, assetReference: `equipment-${id}`,
  assetCategory: 'equipment', periodStartedAt: `${date}T13:00:00.000Z`, periodEndedAt: `${date}T14:00:00.000Z`,
  timeZone: 'America/New_York', utilization: { value: '1', unit: 'machine_hour', basis: 'provider_recorded' },
  cost: null, maintenance: null, downtime: null, evidenceClass: 'provider_recorded',
  providerEvidenceDigest: crypto.createHash('sha256').update(`${id}:${version}`).digest('hex'),
  sourceUpdatedAt: `${date}T14:05:00.000Z` });
const batch = (consent, records, cursorBefore = null, cursorAfter = null, mode = 'historical_backfill') => ({
  schemaVersion: 'm25-external-asset-actual-v1', mode, expectedConsentRevision: consent.revision,
  expectedConsentDigest: consent.digest, cursorBefore, cursorAfter, complete: mode === 'historical_backfill', records,
  reason: 'Stage reviewed vehicle and equipment records.', confirmed: true,
  confirmationVersion: 'm25-external-asset-import-batch-v1' });

(async () => {
  let fixture; const ledger = { cases: [] };
  try {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const owner = fixture.actors.owner;
    const source = key => {
      const root = `/api/v1/learning/external-asset-sources/${key}`;
      return { root, write: (suffix, body, requestKey = crypto.randomUUID(), actor = owner) => request(fixture.app)
        .post(root + suffix).set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken)
        .set('Idempotency-Key', requestKey).send(body) };
    };
    const directRuntimeReject = async (functionName, sourceKey, body) => {
      const client = await fixture.runtimePool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await assert.rejects(client.query(`SELECT public.${functionName}($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken,
            crypto.randomUUID(), sourceKey, JSON.stringify(body)]), error => error.code === '22023');
      } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    };

    const primary = source('fleet.operations');
    let response = await primary.write('/consent', consentBody);
    assert.equal(response.status, 201, JSON.stringify(response.body)); const consent = response.body.data.consent;
    await directRuntimeReject('canonical_external_asset_adapter_mutate', 'fleet.operations', {
      action: 'connect', adapterKind: 'provider_api', cadence: 'hourly', expectedRevision: null,
      expectedDigest: 'none', confirmed: true,
    });
    assert.equal((await fixture.ownerPool.query(`SELECT count(*)::integer total FROM canonical_external_asset_adapter_revisions
      WHERE organization_id=$1 AND source_key=$2`, [fixture.org, 'fleet.operations'])).rows[0].total, 0);
    const initialCancel = await primary.write('/deletion', { action: 'cancel', expectedRevision: 0,
      expectedDigest: 'none', confirmed: true });
    assert.equal(initialCancel.status, 400, JSON.stringify(initialCancel.body));
    response = await primary.write('/batches', batch(consent, [record('old-asset')]));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await request(fixture.app).get(primary.root + '/operations').set(owner.session.headers);
    assert.equal(response.status, 200); assert.equal(response.body.data.activeRecordTotal, 1);

    const adapterKey = crypto.randomUUID();
    const adapterBody = { action: 'connect', adapterKind: 'provider_api', cadence: 'hourly',
      expectedRevision: 0, expectedDigest: 'none', confirmed: true };
    const secret = await primary.write('/adapter', { ...adapterBody, credential: 'secret' });
    assert.equal(secret.status, 400); assert.doesNotMatch(JSON.stringify(secret.body), /credential.*secret/i);
    response = await primary.write('/adapter', adapterBody, adapterKey);
    assert.equal(response.status, 201, JSON.stringify(response.body)); const connected = response.body.data.adapter;
    response = await primary.write('/adapter', adapterBody, adapterKey);
    assert.equal(response.status, 200); assert.equal(response.headers['idempotency-replayed'], 'true');
    response = await primary.write('/adapter', { ...adapterBody, action: 'pause',
      expectedRevision: connected.revision, expectedDigest: connected.digest });
    assert.equal(response.status, 201); const paused = response.body.data.adapter;
    response = await primary.write('/adapter', { ...adapterBody, action: 'resume',
      expectedRevision: paused.revision, expectedDigest: paused.digest });
    assert.equal(response.status, 201); const resumed = response.body.data.adapter;
    response = await primary.write('/adapter', { ...adapterBody, action: 'disconnect',
      expectedRevision: resumed.revision, expectedDigest: resumed.digest });
    assert.equal(response.status, 201); assert.equal(response.body.data.adapter.action, 'disconnect');
    ledger.cases.push('Provider-neutral vehicle and equipment adapter lifecycle is revision pinned, idempotent and credential free.');

    response = await primary.write('/retention', { action: 'set', retentionDays: 30,
      expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const retention = response.body.data.retention;
    response = await request(fixture.app).get(primary.root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.retentionEligibleTotal, 1);
    await directRuntimeReject('canonical_external_asset_cleanup_execute', 'fleet.operations', {
      operation: 'retention', expectedRevision: null, expectedDigest: retention.digest,
      cursorBefore: null, limit: 100, confirmed: true,
    });
    assert.equal((await fixture.ownerPool.query(`SELECT count(*)::integer total FROM canonical_external_asset_cleanup_runs
      WHERE organization_id=$1 AND source_key=$2`, [fixture.org, 'fleet.operations'])).rows[0].total, 0);
    const retentionCleanup = { operation: 'retention', expectedRevision: retention.revision,
      expectedDigest: retention.digest, cursorBefore: null, limit: 100, confirmed: true };
    const retentionKey = crypto.randomUUID();
    response = await primary.write('/cleanup', retentionCleanup, retentionKey);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.run.tombstonedCount, 1); assert.equal(response.body.data.run.complete, true);
    const firstCleanup = response.body.data.run;
    response = await primary.write('/cleanup', retentionCleanup, retentionKey);
    assert.equal(response.status, 200); assert.equal(response.headers['idempotency-replayed'], 'true');
    assert.deepEqual(response.body.data.run, firstCleanup); assert.equal(Object.hasOwn(response.body.data.run, 'organization_id'), false);
    response = await primary.write('/cleanup', { ...retentionCleanup, limit: 99 }, retentionKey);
    assert.equal(response.status, 409);
    const zeroCleanupKey = crypto.randomUUID();
    response = await primary.write('/cleanup', retentionCleanup, zeroCleanupKey);
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.tombstonedCount, 0);
    const zeroCleanup = response.body.data.run;
    response = await primary.write('/cleanup', retentionCleanup, zeroCleanupKey);
    assert.equal(response.status, 200); assert.deepEqual(response.body.data.run, zeroCleanup);
    response = await primary.write('/cleanup', { ...retentionCleanup, limit: 99 }, zeroCleanupKey);
    assert.equal(response.status, 409);
    response = await request(fixture.app).get(primary.root).set(owner.session.headers);
    assert.equal(response.body.data.currentRecords[0].state, 'tombstone');
    assert.equal(response.body.data.currentRecords[0].jobReference, null);
    ledger.cases.push('Retention cleanup is bounded, direct-runtime pin checks fail closed and nonzero or zero-result retries are exact.');

    const deletionSource = source('fleet.deletion');
    response = await deletionSource.write('/consent', consentBody);
    assert.equal(response.status, 201); const deletionConsent = response.body.data.consent;
    response = await deletionSource.write('/batches', batch(deletionConsent, [record('delete-asset')], null, 'stream-1', 'continuous_update'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const outcomeConsentBody = { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use reviewed utilization and operating-cost outcomes.', confirmed: true,
      confirmationVersion: 'm25-imported-asset-utilization-cost-consent-v1' };
    response = await deletionSource.write('/imported-utilization-cost-consent', outcomeConsentBody);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const healthConsentBody = { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Summarize current maintenance and downtime for reviewed assets.', confirmed: true,
      confirmationVersion: 'm25-imported-asset-health-consent-v1' };
    response = await deletionSource.write('/imported-asset-health-consent', healthConsentBody);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const calibrationConsentBody = { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use a bounded current same-service sample for advisory calibration.', confirmed: true,
      confirmationVersion: 'm25-imported-asset-calibration-consent-v1' };
    response = await deletionSource.write('/imported-asset-calibration-consent', calibrationConsentBody);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await deletionSource.write('/deletion', { action: 'request', expectedRevision: 0,
      expectedDigest: 'none', confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const deletion = response.body.data.deletion;
    const consentAfter = await request(fixture.app).get(deletionSource.root + '/consent').set(owner.session.headers);
    assert.equal(consentAfter.body.data.current.action, 'revoke');
    const activeDeletionRegrant = await deletionSource.write('/consent', { ...consentBody,
      expectedRevision: consentAfter.body.data.current.revision, expectedDigest: consentAfter.body.data.current.digest,
      reason: 'This must remain blocked while deletion is active.' });
    assert.equal(activeDeletionRegrant.status, 409, JSON.stringify(activeDeletionRegrant.body));
    let sourceRead = await request(fixture.app).get(deletionSource.root).set(owner.session.headers);
    assert.equal(sourceRead.status, 200); assert.equal(sourceRead.body.data.activeConsent, false);
    assert.deepEqual(sourceRead.body.data.currentRecords, []);
    const estimateId = crypto.randomUUID();
    let outcomeRead = await request(fixture.app).get(`${deletionSource.root}/estimates/${estimateId}/imported-utilization-cost-outcomes`).set(owner.session.headers);
    assert.equal(outcomeRead.status, 200); assert.equal(outcomeRead.body.data.activeConsent, false);
    let healthRead = await request(fixture.app).get(`${deletionSource.root}/imported-asset-health-outcomes`)
      .query({ assetCategory: 'equipment', externalAssetReference: 'equipment-delete-asset' }).set(owner.session.headers);
    assert.equal(healthRead.status, 200); assert.equal(healthRead.body.data.activeConsent, false);
    let calibrationRead = await request(fixture.app).get(`${deletionSource.root}/imported-asset-calibrations/tree_service`).set(owner.session.headers);
    assert.equal(calibrationRead.status, 200); assert.equal(calibrationRead.body.data.activeConsent, false);
    const blocked = await deletionSource.write('/batches', batch(deletionConsent, [record('later-asset')], 'stream-1', 'stream-2', 'continuous_update'));
    assert.equal(blocked.status, 409);
    response = await deletionSource.write('/cleanup', { operation: 'deletion', expectedRevision: deletion.revision,
      expectedDigest: deletion.digest, cursorBefore: null, limit: 100, confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.tombstonedCount, 1);
    response = await request(fixture.app).get(deletionSource.root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.deletionComplete, true);
    response = await deletionSource.write('/deletion', { action: 'cancel', expectedRevision: deletion.revision,
      expectedDigest: deletion.digest, confirmed: true });
    assert.equal(response.status, 201); const consentBeforeRegrant = consentAfter.body.data.current;
    response = await deletionSource.write('/consent', { ...consentBody, expectedRevision: consentBeforeRegrant.revision,
      expectedDigest: consentBeforeRegrant.digest, reason: 'Start a new permission period after deletion cleanup.' });
    assert.equal(response.status, 201); assert.equal(response.body.data.consent.action, 'grant');
    sourceRead = await request(fixture.app).get(deletionSource.root).set(owner.session.headers);
    assert.equal(sourceRead.status, 200); assert.equal(sourceRead.body.data.currentRecords[0].state, 'tombstone');
    assert.equal(sourceRead.body.data.currentRecords[0].assetReference, null);
    outcomeRead = await request(fixture.app).get(`${deletionSource.root}/estimates/${estimateId}/imported-utilization-cost-outcomes`).set(owner.session.headers);
    assert.equal(outcomeRead.status, 200); assert.equal(outcomeRead.body.data.activeConsent, false);
    healthRead = await request(fixture.app).get(`${deletionSource.root}/imported-asset-health-outcomes`)
      .query({ assetCategory: 'equipment', externalAssetReference: 'equipment-delete-asset' }).set(owner.session.headers);
    assert.equal(healthRead.status, 200); assert.equal(healthRead.body.data.activeConsent, false);
    calibrationRead = await request(fixture.app).get(`${deletionSource.root}/imported-asset-calibrations/tree_service`).set(owner.session.headers);
    assert.equal(calibrationRead.status, 200); assert.equal(calibrationRead.body.data.activeConsent, false);
    response = await request(fixture.app).get(deletionSource.root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.activeRecordTotal, 0);
    ledger.cases.push('Active deletion blocks source re-grant and masks raw and downstream reads; cancellation plus a new source consent does not revive tombstones or prior learning consent.');

    const paged = source('fleet.paged');
    response = await paged.write('/consent', consentBody); const pagedConsent = response.body.data.consent;
    const records = Array.from({ length: 101 }, (_, index) => record(`asset-${String(index + 1).padStart(3, '0')}`, 1, '2026-09-15'));
    response = await paged.write('/batches', batch(pagedConsent, records.slice(0, 50), null, 'page-50', 'continuous_update'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await paged.write('/batches', batch(pagedConsent, records.slice(50, 100), 'page-50', 'page-100', 'continuous_update'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await paged.write('/batches', batch(pagedConsent, records.slice(100), 'page-100', 'page-101', 'continuous_update'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await paged.write('/deletion', { action: 'request', expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    const pagedDeletion = response.body.data.deletion;
    response = await paged.write('/cleanup', { operation: 'deletion', expectedRevision: pagedDeletion.revision,
      expectedDigest: pagedDeletion.digest, cursorBefore: null, limit: 100, confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.complete, false);
    assert.equal(response.body.data.run.tombstonedCount, 100); const cursor = response.body.data.run.cursorAfter;
    assert.equal(cursor, 'asset-100');
    response = await request(fixture.app).get(paged.root + '/operations').set(owner.session.headers);
    const checkpoint = response.body.data.checkpoints.find(item => item.mode === 'deletion_cleanup');
    assert.equal(checkpoint.complete, false); assert.equal(checkpoint.cursorAfter, cursor);
    response = await paged.write('/cleanup', { operation: 'deletion', expectedRevision: pagedDeletion.revision,
      expectedDigest: pagedDeletion.digest, cursorBefore: cursor, limit: 100, confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.complete, true);
    assert.equal(response.body.data.run.tombstonedCount, 1);
    ledger.cases.push('A 101-record deletion resumes from its exact checkpoint across two bounded cleanup runs.');

    const policy = source('fleet.policy-reset');
    response = await policy.write('/consent', consentBody); const policyConsent = response.body.data.consent;
    response = await policy.write('/batches', batch(policyConsent, [
      record('a-recent', 1, '2026-07-15'), record('b-old', 1, '2025-01-15'), record('c-old', 1, '2025-01-16'),
    ], null, 'policy-1', 'continuous_update'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await policy.write('/retention', { action: 'set', retentionDays: 365,
      expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    const firstPolicy = response.body.data.retention;
    response = await policy.write('/cleanup', { operation: 'retention', expectedRevision: firstPolicy.revision,
      expectedDigest: firstPolicy.digest, cursorBefore: null, limit: 1, confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.cursorAfter, 'b-old');
    response = await policy.write('/retention', { action: 'set', retentionDays: 30,
      expectedRevision: firstPolicy.revision, expectedDigest: firstPolicy.digest, confirmed: true });
    const secondPolicy = response.body.data.retention;
    response = await request(fixture.app).get(policy.root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.checkpoints.some(item => item.mode === 'retention_cleanup'), false);
    response = await policy.write('/cleanup', { operation: 'retention', expectedRevision: secondPolicy.revision,
      expectedDigest: secondPolicy.digest, cursorBefore: null, limit: 1, confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.cursorAfter, 'a-recent');
    const resetRun = (await fixture.ownerPool.query(`SELECT authority_revision,previous_run_id
      FROM canonical_external_asset_cleanup_runs WHERE organization_id=$1 AND source_key=$2 AND operation='retention'
      ORDER BY sequence DESC LIMIT 1`, [fixture.org, 'fleet.policy-reset'])).rows[0];
    assert.equal(Number(resetRun.authority_revision), secondPolicy.revision); assert.equal(resetRun.previous_run_id, null);
    ledger.cases.push('Changing retention authority starts a new cleanup chain at null so newly eligible records cannot be skipped.');

    const member = await request(fixture.app).get(primary.root + '/operations').set(fixture.actors.member.session.headers);
    assert.equal(member.status, 403);
    const other = await request(fixture.app).get(primary.root + '/operations').set(fixture.actors.otherOwner.session.headers);
    assert.equal(other.status, 200); assert.equal(other.body.data.activeRecordTotal, 0);
    const privileges = (await fixture.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_asset_cleanup_runs','SELECT') cleanup_table,
      has_function_privilege($1,'canonical_external_asset_operation_projection(text,jsonb)','EXECUTE') helper,
      has_function_privilege($1,'canonical_external_asset_cleanup_projection(canonical_external_asset_cleanup_runs)','EXECUTE') cleanup_helper,
      has_function_privilege($1,'canonical_external_asset_cleanup_execute(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE') entry`,
    [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { cleanup_table: false, helper: false, cleanup_helper: false, entry: true });
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_asset_cleanup_runs'));
    const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/102_canonical_external_asset_import_operations.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual((await fixture.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='102_canonical_external_asset_import_operations.sql'")).rows, [{ checksum }]);
    ledger.cases.push('Tenant isolation, entry-only runtime ACLs, immutability and exact migration provenance hold.');
    ledger.pass = true;
  } catch (error) {
    ledger.error = error.stack;
    ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code, constraint: error.cause.constraint };
    process.exitCode = 1;
  } finally {
    if (fixture) await fixture.cleanup();
    fs.writeFileSync(output, JSON.stringify(ledger, null, 2));
    console.log(JSON.stringify(ledger));
  }
})();
