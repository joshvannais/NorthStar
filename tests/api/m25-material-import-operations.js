'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-material-import-operations-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-material-import-operations-result.json').slice(9);
assert.ok(!fs.existsSync(output));

const consentBody = { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
  reason: 'Use reviewed material operations evidence.', confirmed: true,
  confirmationVersion: 'm25-external-material-import-consent-v1' };
const record = (id, version = 1, date = '2026-01-10') => ({ externalRecordId: id, externalVersion: version,
  state: 'active', recordType: 'inventory_movement', jobReference: `job-${id}`, materialReference: `item-${id}`,
  vendorReference: null, locationReference: 'yard-primary', occurredAt: `${date}T13:00:00.000Z`,
  timeZone: 'America/New_York', movementKind: 'consumed',
  quantity: { value: '1', unit: 'ea', basis: 'provider_recorded' }, cost: null, evidenceClass: 'provider_recorded',
  providerEvidenceDigest: crypto.createHash('sha256').update(`${id}:${version}`).digest('hex'),
  sourceUpdatedAt: `${date}T14:05:00.000Z` });
const batch = (consent, records, cursorBefore = null, cursorAfter = null, mode = 'historical_backfill') => ({
  schemaVersion: 'm25-external-material-actual-v1', mode, expectedConsentRevision: consent.revision,
  expectedConsentDigest: consent.digest, cursorBefore, cursorAfter, complete: mode === 'historical_backfill', records,
  reason: 'Stage reviewed material, inventory, purchasing and vendor-cost records.', confirmed: true,
  confirmationVersion: 'm25-external-material-import-batch-v1' });

(async () => {
  let fixture; const manualClients = new Set(); const ledger = { cases: [] };
  try {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const owner = fixture.actors.owner;
    const source = key => {
      const root = `/api/v1/learning/external-material-sources/${key}`;
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
    const beginRuntimeMutation = async (functionName, sourceKey, body, requestKey = crypto.randomUUID()) => {
      const client = await fixture.runtimePool.connect();
      manualClients.add(client);
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("SET LOCAL statement_timeout='5000ms'");
      await client.query("SET LOCAL lock_timeout='4000ms'");
      const result = await client.query(`SELECT public.${functionName}($1,$2,$3,$4,$5,$6,$7,$8::jsonb) value`,
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken,
          requestKey, sourceKey, JSON.stringify(body)]);
      return { client, value: result.rows[0].value };
    };
    const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

    const primary = source('materials.operations');
    let response = await primary.write('/consent', consentBody);
    assert.equal(response.status, 201, JSON.stringify(response.body)); const consent = response.body.data.consent;
    await directRuntimeReject('canonical_external_material_adapter_mutate', 'materials.operations', {
      action: 'connect', adapterKind: 'provider_api', cadence: 'hourly', expectedRevision: null,
      expectedDigest: 'none', confirmed: true,
    });
    assert.equal((await fixture.ownerPool.query(`SELECT count(*)::integer total FROM canonical_external_material_adapter_revisions
      WHERE organization_id=$1 AND source_key=$2`, [fixture.org, 'materials.operations'])).rows[0].total, 0);
    const initialCancel = await primary.write('/deletion', { action: 'cancel', expectedRevision: 0,
      expectedDigest: 'none', confirmed: true });
    assert.equal(initialCancel.status, 400, JSON.stringify(initialCancel.body));
    response = await primary.write('/batches', batch(consent, [record('old-material')]));
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
    ledger.cases.push('Provider-neutral material, inventory, purchasing and vendor-cost adapter lifecycle is revision pinned, idempotent and credential free.');

    response = await primary.write('/retention', { action: 'set', retentionDays: 30,
      expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const retention = response.body.data.retention;
    response = await request(fixture.app).get(primary.root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.retentionEligibleTotal, 1);
    await directRuntimeReject('canonical_external_material_cleanup_execute', 'materials.operations', {
      operation: 'retention', expectedRevision: null, expectedDigest: retention.digest,
      cursorBefore: null, limit: 100, confirmed: true,
    });
    assert.equal((await fixture.ownerPool.query(`SELECT count(*)::integer total FROM canonical_external_material_cleanup_runs
      WHERE organization_id=$1 AND source_key=$2`, [fixture.org, 'materials.operations'])).rows[0].total, 0);
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

    const held = source('materials.held');
    response = await held.write('/consent', consentBody); const heldConsent = response.body.data.consent;
    response = await held.write('/batches', batch(heldConsent, [record('held-material')], null, 'held-stream', 'continuous_update'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const holdBody = { action: 'place', holdKind: 'legal', expectedRevision: 0, expectedDigest: 'none', confirmed: true };
    const holdKey = crypto.randomUUID();
    const holdResponses = await Promise.all([held.write('/hold', holdBody, holdKey), held.write('/hold', holdBody, holdKey)]);
    assert.deepEqual(holdResponses.map(item => item.status).sort(), [200, 201]);
    const activeHold = holdResponses.find(item => item.status === 201).body.data.hold;
    response = await held.write('/deletion', { action: 'request', expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    assert.equal(response.status, 201); const heldDeletion = response.body.data.deletion;
    response = await held.write('/cleanup', { operation: 'deletion', expectedRevision: heldDeletion.revision,
      expectedDigest: heldDeletion.digest, cursorBefore: null, limit: 100, confirmed: true });
    assert.equal(response.status, 409); assert.equal(response.body.error.code, 'M25_MATERIAL_IMPORT_OPERATIONS_HOLD_ACTIVE');
    assert.match(response.body.error.message, /hold is active/i);
    response = await request(fixture.app).get(held.root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.cleanupAllowed, false); assert.equal(response.body.data.activeRecordTotal, 1);
    response = await held.write('/hold', { action: 'release', holdKind: 'audit', expectedRevision: activeHold.revision,
      expectedDigest: activeHold.digest, confirmed: true });
    assert.equal(response.status, 400);
    response = await held.write('/hold', { action: 'release', holdKind: 'legal', expectedRevision: activeHold.revision,
      expectedDigest: activeHold.digest, confirmed: true });
    assert.equal(response.status, 201); assert.equal(response.body.data.hold.action, 'release');
    response = await held.write('/cleanup', { operation: 'deletion', expectedRevision: heldDeletion.revision,
      expectedDigest: heldDeletion.digest, cursorBefore: null, limit: 100, confirmed: true });
    assert.equal(response.status, 201); assert.equal(response.body.data.run.tombstonedCount, 1);
    ledger.cases.push('A tenant-private legal or audit hold blocks cleanup without blocking consent revocation; explicit matching release permits bounded cleanup and cannot restore prior detail.');

    const holdFirst = source('materials.hold-first-race');
    response = await holdFirst.write('/consent', consentBody); const holdFirstConsent = response.body.data.consent;
    response = await holdFirst.write('/batches', batch(holdFirstConsent, [record('hold-first-record')], null, 'hold-first', 'continuous_update'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await holdFirst.write('/deletion', { action: 'request', expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    const holdFirstDeletion = response.body.data.deletion;
    const holdFirstTxn = await beginRuntimeMutation('canonical_external_material_hold_mutate', 'materials.hold-first-race', holdBody);
    const committedHold = holdFirstTxn.value.hold;
    let holdFirstCleanupSettled = false;
    const holdFirstCleanup = holdFirst.write('/cleanup', { operation: 'deletion', expectedRevision: holdFirstDeletion.revision,
      expectedDigest: holdFirstDeletion.digest, cursorBefore: null, limit: 100, confirmed: true })
      .then(result => { holdFirstCleanupSettled = true; return result; });
    await wait(100); assert.equal(holdFirstCleanupSettled, false);
    await holdFirstTxn.client.query('COMMIT'); holdFirstTxn.client.release(); manualClients.delete(holdFirstTxn.client);
    response = await holdFirstCleanup;
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'M25_MATERIAL_IMPORT_OPERATIONS_HOLD_ACTIVE');
    response = await request(fixture.app).get(holdFirst.root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.activeRecordTotal, 1); assert.equal(response.body.data.hold.action, 'place');

    const releaseTxn = await beginRuntimeMutation('canonical_external_material_hold_mutate', 'materials.hold-first-race', {
      action: 'release', holdKind: 'legal', expectedRevision: committedHold.revision,
      expectedDigest: committedHold.digest, confirmed: true,
    });
    let releaseCleanupSettled = false;
    const releasedCleanup = holdFirst.write('/cleanup', { operation: 'deletion', expectedRevision: holdFirstDeletion.revision,
      expectedDigest: holdFirstDeletion.digest, cursorBefore: null, limit: 100, confirmed: true })
      .then(result => { releaseCleanupSettled = true; return result; });
    await wait(100); assert.equal(releaseCleanupSettled, false);
    await releaseTxn.client.query('COMMIT'); releaseTxn.client.release(); manualClients.delete(releaseTxn.client);
    response = await releasedCleanup;
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.tombstonedCount, 1);

    const cleanupFirst = source('materials.cleanup-first-race');
    response = await cleanupFirst.write('/consent', consentBody); const cleanupFirstConsent = response.body.data.consent;
    response = await cleanupFirst.write('/batches', batch(cleanupFirstConsent, [record('cleanup-first-record')], null, 'cleanup-first', 'continuous_update'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await cleanupFirst.write('/deletion', { action: 'request', expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    const cleanupFirstDeletion = response.body.data.deletion;
    const cleanupTxn = await beginRuntimeMutation('canonical_external_material_cleanup_execute', 'materials.cleanup-first-race', {
      operation: 'deletion', expectedRevision: cleanupFirstDeletion.revision, expectedDigest: cleanupFirstDeletion.digest,
      cursorBefore: null, limit: 100, confirmed: true,
    });
    assert.equal(cleanupTxn.value.run.tombstonedCount, 1);
    let cleanupFirstHoldSettled = false;
    const cleanupFirstHold = cleanupFirst.write('/hold', holdBody).then(result => { cleanupFirstHoldSettled = true; return result; });
    await wait(100); assert.equal(cleanupFirstHoldSettled, false);
    assert.equal((await fixture.ownerPool.query(`SELECT count(*)::integer total FROM canonical_external_material_hold_revisions
      WHERE organization_id=$1 AND source_key=$2`, [fixture.org, 'materials.cleanup-first-race'])).rows[0].total, 0);
    await cleanupTxn.client.query('COMMIT'); cleanupTxn.client.release(); manualClients.delete(cleanupTxn.client);
    response = await cleanupFirstHold;
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.hold.action, 'place');
    response = await request(fixture.app).get(cleanupFirst.root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.activeRecordTotal, 0); assert.equal(response.body.data.hold.action, 'place');
    ledger.cases.push('One tenant-and-source lifecycle lock orders hold placement, release and destructive cleanup in both directions; stale waiters retry from fresh authority and never bypass an active hold.');

    const retentionRace = source('materials.retention-race');
    response = await retentionRace.write('/consent', consentBody); const retentionRaceConsent = response.body.data.consent;
    response = await retentionRace.write('/batches', batch(retentionRaceConsent, [record('retention-race-record')], null, 'retention-race', 'continuous_update'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await retentionRace.write('/retention', { action: 'set', retentionDays: 30,
      expectedRevision: 0, expectedDigest: 'none', confirmed: true });
    const firstRetentionRace = response.body.data.retention;
    const retentionTxn = await beginRuntimeMutation('canonical_external_material_retention_mutate', 'materials.retention-race', {
      action: 'set', retentionDays: 60, expectedRevision: firstRetentionRace.revision,
      expectedDigest: firstRetentionRace.digest, confirmed: true,
    });
    let staleRetentionCleanupSettled = false;
    const staleRetentionCleanup = retentionRace.write('/cleanup', { operation: 'retention',
      expectedRevision: firstRetentionRace.revision, expectedDigest: firstRetentionRace.digest,
      cursorBefore: null, limit: 100, confirmed: true }).then(result => { staleRetentionCleanupSettled = true; return result; });
    await wait(100); assert.equal(staleRetentionCleanupSettled, false);
    await retentionTxn.client.query('COMMIT'); retentionTxn.client.release(); manualClients.delete(retentionTxn.client);
    response = await staleRetentionCleanup;
    assert.equal(response.status, 409, JSON.stringify(response.body));
    response = await request(fixture.app).get(retentionRace.root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.retention.revision, 2); assert.equal(response.body.data.activeRecordTotal, 1);
    ledger.cases.push('Retention changes share lifecycle ordering, invalidate stale pinned cleanup and preserve its cursor and current evidence.');

    const deletionRace = source('materials.deletion-race');
    response = await deletionRace.write('/consent', consentBody); const deletionRaceConsent = response.body.data.consent;
    response = await deletionRace.write('/batches', batch(deletionRaceConsent, [record('deletion-race-record')], null, 'deletion-race', 'continuous_update'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await deletionRace.write('/deletion', { action: 'request', expectedRevision: 0,
      expectedDigest: 'none', confirmed: true });
    const firstDeletionRace = response.body.data.deletion;
    const deletionCancelTxn = await beginRuntimeMutation('canonical_external_material_deletion_mutate', 'materials.deletion-race', {
      action: 'cancel', expectedRevision: firstDeletionRace.revision, expectedDigest: firstDeletionRace.digest, confirmed: true,
    });
    let staleDeletionCleanupSettled = false;
    const staleDeletionCleanup = deletionRace.write('/cleanup', { operation: 'deletion',
      expectedRevision: firstDeletionRace.revision, expectedDigest: firstDeletionRace.digest,
      cursorBefore: null, limit: 100, confirmed: true }).then(result => { staleDeletionCleanupSettled = true; return result; });
    await wait(100); assert.equal(staleDeletionCleanupSettled, false);
    await deletionCancelTxn.client.query('COMMIT'); deletionCancelTxn.client.release(); manualClients.delete(deletionCancelTxn.client);
    response = await staleDeletionCleanup;
    assert.equal(response.status, 409, JSON.stringify(response.body));
    response = await request(fixture.app).get(deletionRace.root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.deletion.action, 'cancel'); assert.equal(response.body.data.activeRecordTotal, 1);
    ledger.cases.push('Deletion cancellation shares lifecycle ordering and prevents stale deletion cleanup from removing current evidence.');

    const deletionSource = source('materials.deletion');
    response = await deletionSource.write('/consent', consentBody);
    assert.equal(response.status, 201); const deletionConsent = response.body.data.consent;
    response = await deletionSource.write('/batches', batch(deletionConsent, [record('delete-material')], null, 'stream-1', 'continuous_update'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const quantityConsentBody = { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use reviewed material quantity outcomes.', confirmed: true,
      confirmationVersion: 'm25-imported-material-quantity-consent-v1' };
    response = await deletionSource.write('/imported-material-quantity-consent', quantityConsentBody);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const costConsentBody = { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use reviewed material cost outcomes.', confirmed: true,
      confirmationVersion: 'm25-imported-material-cost-consent-v1' };
    response = await deletionSource.write('/imported-material-cost-consent', costConsentBody);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const calibrationConsentBody = { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use a bounded current same-service sample for advisory calibration.', confirmed: true,
      confirmationVersion: 'm25-imported-material-calibration-consent-v1' };
    response = await deletionSource.write('/imported-material-calibration-consent', calibrationConsentBody);
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
    let quantityRead = await request(fixture.app).get(`${deletionSource.root}/estimates/${estimateId}/imported-material-quantity-outcomes`).set(owner.session.headers);
    assert.equal(quantityRead.status, 200); assert.equal(quantityRead.body.data.activeConsent, false);
    let costRead = await request(fixture.app).get(`${deletionSource.root}/estimates/${estimateId}/imported-material-cost-observations`).set(owner.session.headers);
    assert.equal(costRead.status, 200); assert.equal(costRead.body.data.activeConsent, false);
    let calibrationRead = await request(fixture.app).get(`${deletionSource.root}/imported-material-calibrations/tree_service`).set(owner.session.headers);
    assert.equal(calibrationRead.status, 200); assert.equal(calibrationRead.body.data.activeConsent, false);
    const blocked = await deletionSource.write('/batches', batch(deletionConsent, [record('later-material')], 'stream-1', 'stream-2', 'continuous_update'));
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
    assert.equal(sourceRead.status, 200); assert.deepEqual(sourceRead.body.data.currentRecords, []);
    quantityRead = await request(fixture.app).get(`${deletionSource.root}/estimates/${estimateId}/imported-material-quantity-outcomes`).set(owner.session.headers);
    assert.equal(quantityRead.status, 200); assert.equal(quantityRead.body.data.activeConsent, false);
    costRead = await request(fixture.app).get(`${deletionSource.root}/estimates/${estimateId}/imported-material-cost-observations`).set(owner.session.headers);
    assert.equal(costRead.status, 200); assert.equal(costRead.body.data.activeConsent, false);
    calibrationRead = await request(fixture.app).get(`${deletionSource.root}/imported-material-calibrations/tree_service`).set(owner.session.headers);
    assert.equal(calibrationRead.status, 200); assert.equal(calibrationRead.body.data.activeConsent, false);
    response = await request(fixture.app).get(deletionSource.root + '/operations').set(owner.session.headers);
    assert.equal(response.body.data.activeRecordTotal, 0);
    ledger.cases.push('Active deletion blocks source re-grant and masks raw and downstream reads; cancellation plus a new source consent does not revive tombstones or prior learning consent.');

    const paged = source('materials.paged');
    response = await paged.write('/consent', consentBody); const pagedConsent = response.body.data.consent;
    const records = Array.from({ length: 101 }, (_, index) => record(`material-${String(index + 1).padStart(3, '0')}`, 1, '2026-09-15'));
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
    assert.equal(cursor, 'material-100');
    response = await request(fixture.app).get(paged.root + '/operations').set(owner.session.headers);
    const checkpoint = response.body.data.checkpoints.find(item => item.mode === 'deletion_cleanup');
    assert.equal(checkpoint.complete, false); assert.equal(checkpoint.cursorAfter, cursor);
    response = await paged.write('/cleanup', { operation: 'deletion', expectedRevision: pagedDeletion.revision,
      expectedDigest: pagedDeletion.digest, cursorBefore: cursor, limit: 100, confirmed: true });
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.run.complete, true);
    assert.equal(response.body.data.run.tombstonedCount, 1);
    ledger.cases.push('A 101-record deletion resumes from its exact checkpoint across two bounded cleanup runs.');

    const policy = source('materials.policy-reset');
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
      FROM canonical_external_material_cleanup_runs WHERE organization_id=$1 AND source_key=$2 AND operation='retention'
      ORDER BY sequence DESC LIMIT 1`, [fixture.org, 'materials.policy-reset'])).rows[0];
    assert.equal(Number(resetRun.authority_revision), secondPolicy.revision); assert.equal(resetRun.previous_run_id, null);
    ledger.cases.push('Changing retention authority starts a new cleanup chain at null so newly eligible records cannot be skipped.');

    const member = await request(fixture.app).get(primary.root + '/operations').set(fixture.actors.member.session.headers);
    assert.equal(member.status, 403);
    const other = await request(fixture.app).get(primary.root + '/operations').set(fixture.actors.otherOwner.session.headers);
    assert.equal(other.status, 200); assert.equal(other.body.data.activeRecordTotal, 0);
    const privileges = (await fixture.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_material_cleanup_runs','SELECT') cleanup_table,
      has_table_privilege($1,'canonical_external_material_hold_revisions','SELECT') hold_table,
      has_table_privilege($1,'canonical_external_material_lifecycle_gates','SELECT') lifecycle_table,
      has_function_privilege($1,'canonical_external_material_operation_projection(text,jsonb)','EXECUTE') helper,
      has_function_privilege($1,'canonical_external_material_cleanup_projection(canonical_external_material_cleanup_runs)','EXECUTE') cleanup_helper,
      has_function_privilege($1,'canonical_external_material_lifecycle_lock(uuid,text)','EXECUTE') lifecycle_helper,
      has_function_privilege($1,'canonical_external_material_cleanup_execute(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE') cleanup_entry,
      has_function_privilege($1,'canonical_external_material_hold_mutate(uuid,uuid,text,uuid,text,text,text,jsonb)','EXECUTE') hold_entry`,
    [fixture.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { cleanup_table: false, hold_table: false, lifecycle_table: false, helper: false, cleanup_helper: false,
      lifecycle_helper: false,
      cleanup_entry: true, hold_entry: true });
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_material_cleanup_runs'));
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_material_hold_revisions'));
    const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/111_canonical_external_material_import_operations.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.deepEqual((await fixture.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='111_canonical_external_material_import_operations.sql'")).rows, [{ checksum }]);
    ledger.cases.push('Tenant isolation, entry-only runtime ACLs, immutability and exact migration provenance hold.');
    ledger.pass = true;
  } catch (error) {
    ledger.error = error.stack;
    ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code, constraint: error.cause.constraint };
    process.exitCode = 1;
  } finally {
    for (const client of manualClients) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    if (fixture) await fixture.cleanup();
    fs.writeFileSync(output, JSON.stringify(ledger, null, 2));
    console.log(JSON.stringify(ledger));
  }
})();
