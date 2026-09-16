'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-imported-labor-outcome-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { ingestLead } = require('../../src/services/canonicalGraphService');
const parts = require('../helpers/m24-cost-composition-input');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-imported-labor-outcomes-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'payroll.primary';

(async () => {
  let f; const ledger = { cases: [] };
  try {
    f = await createDatabaseFixture({ operationalSchedule: true });
    const owner = f.actors.owner;
    const profile = (await f.ownerPool.query('SELECT raw_profile,version_label FROM canonical_business_profiles WHERE organization_id=$1 AND is_active=true', [f.org])).rows[0];
    const external = crypto.randomUUID();
    const ingested = await ingestLead(f.runtimePool, { tenantContext: { organizationId: f.org, trusted: true }, idempotencyKey: external,
      sourceVersion: 'm25-imported-outcome-fixture-v1', external: { customerId: external, callId: external, transcriptId: external,
        communicationId: external, appointmentId: external },
      customer: { name: 'Imported labor outcome customer', phone: '+15555550255', email: `${external}@example.test`,
        address: { line1: '25 Test Way', city: 'Boston', state: 'MA', postalCode: '02108' } },
      transcript: [{ turnId: 'scope', speaker: 'customer', text: 'The work is expected to require sixteen worker hours.' }],
      facts: [{ variable: 'laborHours', normalizedValue: 16, evidenceText: 'sixteen worker hours', speaker: 'customer',
        evidenceTurnId: 'scope', confidence: 1 }],
      service: { key: 'plumbing', scope: { jobType: 'repair', laborHours: 16, description: 'Imported labor comparison' } },
      businessProfile: profile.raw_profile, businessProfileVersion: profile.version_label });
    assert.equal(ingested.status, 201, JSON.stringify(ingested)); f.estimateGraphs = [ingested.body];
    const estimate = ingested.body.ids.estimate; const estimateRoot = `/api/v1/canonical/estimates/${estimate}`;
    const estimatePost = (suffix, body) => request(f.app).post(estimateRoot + suffix).set(owner.session.headers)
      .set('Idempotency-Key', crypto.randomUUID()).send(body);
    const review = async () => { const value = await request(f.app).get(estimateRoot + '/review').set(owner.session.headers);
      assert.equal(value.status, 200, JSON.stringify(value.body)); return value.body.data; };
    let state = await review(); const plan = parts.planBody(state, 'labor');
    let response = await estimatePost('/labor-plan-preview', plan); assert.equal(response.status, 200, JSON.stringify(response.body));
    parts.acceptPlanPreview(plan, response.body.data); response = await estimatePost('/labor-plans', plan);
    assert.equal(response.status, 201, JSON.stringify(response.body)); state = await review();
    const adoption = parts.adoptionBody(state, 'labor'); response = await estimatePost('/cost-adoption-preview', adoption);
    assert.equal(response.status, 200, JSON.stringify(response.body)); adoption.assessment = response.body.data.assessment;
    response = await estimatePost('/cost-adoptions', adoption); assert.equal(response.status, 201, JSON.stringify(response.body));
    ledger.cases.push('A reviewed sixteen-worker-hour labor plan is adopted as the immutable comparison baseline.');

    const root = `/api/v1/learning/external-labor-sources/${sourceKey}`;
    const post = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(f.app).post(root + suffix)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    response = await post('/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use this reviewed external labor source.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const sourceConsent = response.body.data.consent;
    const start = new Date(Date.now() - 10 * 3600000); const end = new Date(start.getTime() + 8 * 3600000);
    const record = (version, stop) => ({ externalRecordId: 'shift-1', externalVersion: version, state: 'active',
      workerReference: 'worker-7', jobReference: 'job-19', category: 'production', observedStart: start.toISOString(),
      observedEnd: stop.toISOString(), sourceUpdatedAt: new Date(stop.getTime() + 60000).toISOString() });
    const batch = (records, before, after) => ({ schemaVersion: 'm25-external-labor-time-v1', mode: 'continuous_update',
      expectedConsentRevision: sourceConsent.revision, expectedConsentDigest: sourceConsent.digest, cursorBefore: before,
      cursorAfter: after, complete: false, records, reason: 'Stage current normalized labor evidence.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-batch-v1' });
    response = await post('/batches', batch([record(1, end)], null, 'cursor-1'));
    assert.equal(response.status, 201, JSON.stringify(response.body));

    const readMatches = async () => { const value = await request(f.app).get(root + '/matches').set(owner.session.headers);
      assert.equal(value.status, 200, JSON.stringify(value.body)); return value.body.data; };
    let matches = await readMatches();
    const workerTarget = matches.workerTargets.find(value => value.targetId === f.actors.member.actorUserId);
    const jobTarget = matches.jobTargets.find(value => value.targetId === estimate);
    const workerRef = matches.references.find(value => value.referenceKind === 'worker');
    const jobRef = matches.references.find(value => value.referenceKind === 'job');
    assert.ok(workerTarget && jobTarget && workerRef && jobRef);
    const matchBody = (kind, reference, sourceDigest, target, previous = null) => ({ referenceKind: kind,
      externalReference: reference, action: 'link', targetId: target.targetId, expectedRevision: previous?.revision || 0,
      expectedDigest: previous?.digest || 'none', expectedSourceDigest: sourceDigest, expectedTargetDigest: target.digest,
      reason: 'Owner reviewed the current source reference and same-tenant target.', confirmed: true,
      confirmationVersion: 'm25-external-labor-reference-match-v1' });
    response = await post('/matches', matchBody('worker', 'worker-7', workerRef.sourceDigest, workerTarget));
    assert.equal(response.status, 201, JSON.stringify(response.body)); let workerMatch = response.body.data.match;
    response = await post('/matches', matchBody('job', 'job-19', jobRef.sourceDigest, jobTarget));
    assert.equal(response.status, 201, JSON.stringify(response.body)); let jobMatch = response.body.data.match;
    ledger.cases.push('The external job and every worker reference are explicitly linked to current same-tenant targets.');

    const grant = { action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Compare current matched imported labor with adopted labor plans.', confirmed: true,
      confirmationVersion: 'm25-imported-labor-duration-consent-v1' };
    const grantKey = crypto.randomUUID(); response = await post('/imported-labor-duration-consent', grant, grantKey);
    assert.equal(response.status, 201, JSON.stringify(response.body)); let learningConsent = response.body.data.consent;
    assert.equal((await post('/imported-labor-duration-consent', grant, grantKey)).status, 200);
    assert.equal((await post('/imported-labor-duration-consent', grant, crypto.randomUUID(), f.actors.member)).status, 403);
    const observeBody = { externalJobReference: 'job-19', expectedConsentRevision: learningConsent.revision,
      expectedConsentDigest: learningConsent.digest, reason: 'Compare this matched external job with the adopted plan.',
      confirmed: true, confirmationVersion: 'm25-imported-labor-duration-observation-v1' };
    const direct = await f.runtimePool.connect(); let directError;
    try { await direct.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await direct.query('SELECT public.canonical_imported_labor_outcome_observe($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [f.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, owner.csrfToken, crypto.randomUUID(), sourceKey,
          estimate, 'job-19', learningConsent.revision, learningConsent.digest, 'Unconfirmed direct attempt.', false,
          'm25-imported-labor-duration-observation-v1']);
    } catch (error) { directError = error; } finally { await direct.query('ROLLBACK').catch(() => {}); direct.release(); }
    assert.equal(directError && directError.code, '22023');
    try {
      await f.ownerPool.query('SELECT public.canonical_imported_labor_learning_basis($1,$2,$3,$4)',
        [f.org, sourceKey, estimate, 'job-19']);
    } catch (error) { throw Object.assign(new Error('Imported labor basis failed: ' + error.message), { cause: error }); }
    const observationKey = crypto.randomUUID(); response = await post(`/estimates/${estimate}/imported-labor-duration-outcomes`, observeBody, observationKey);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.observation.plannedWorkerHours, '16.0000');
    assert.equal(response.body.data.observation.recordedWorkerHours, '8.0000');
    assert.equal(response.body.data.observation.variancePercent, '-50.00');
    assert.equal(response.body.data.observation.advisoryCode, 'actual_below_plan');
    assert.equal(response.body.data.observation.sourceManifest.workerMatches.length, 1);
    assert.equal((await post(`/estimates/${estimate}/imported-labor-duration-outcomes`, observeBody, observationKey)).status, 200);
    assert.equal((await post(`/estimates/${estimate}/imported-labor-duration-outcomes`, observeBody)).status, 409);
    let learned = await request(f.app).get(root + `/estimates/${estimate}/imported-labor-duration-outcomes`).set(owner.session.headers);
    assert.equal(learned.status, 200); assert.equal(learned.body.data.current.fresh, true);
    ledger.cases.push('Explicit purpose consent produces one deterministic, provenance-pinned and advisory-only imported labor variance.');

    const correctedEnd = new Date(start.getTime() + 9 * 3600000);
    response = await post('/batches', batch([record(2, correctedEnd)], 'cursor-1', 'cursor-2'));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    learned = await request(f.app).get(root + `/estimates/${estimate}/imported-labor-duration-outcomes`).set(owner.session.headers);
    assert.equal(learned.status, 200); assert.equal(learned.body.data.current.fresh, false);
    assert.equal(learned.body.data.current.advisoryAvailable, false); assert.equal(learned.body.data.current.advisoryCode, null);
    const staleMatchAttempt = await post(`/estimates/${estimate}/imported-labor-duration-outcomes`, observeBody);
    assert.equal(staleMatchAttempt.status, 409); assert.equal(staleMatchAttempt.body.error.code, 'M25_IMPORTED_OUTCOME_EVIDENCE_INCOMPLETE');
    matches = await readMatches();
    const changedWorker = matches.references.find(value => value.referenceKind === 'worker');
    const changedJob = matches.references.find(value => value.referenceKind === 'job');
    response = await post('/matches', matchBody('worker', 'worker-7', changedWorker.sourceDigest, workerTarget, workerMatch));
    assert.equal(response.status, 201, JSON.stringify(response.body)); workerMatch = response.body.data.match;
    response = await post('/matches', matchBody('job', 'job-19', changedJob.sourceDigest, jobTarget, jobMatch));
    assert.equal(response.status, 201, JSON.stringify(response.body)); jobMatch = response.body.data.match;
    response = await post(`/estimates/${estimate}/imported-labor-duration-outcomes`, observeBody);
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.observation.revision, 2);
    assert.equal(response.body.data.observation.recordedWorkerHours, '9.0000');
    ledger.cases.push('A source correction stales prior advice and requires renewed current matches before a new immutable observation.');

    const overlapStart = new Date(start.getTime() + 3600000); const overlapEnd = new Date(start.getTime() + 3 * 3600000);
    const overlapping = { ...record(1, overlapEnd), externalRecordId: 'shift-2', workerReference: 'worker-8',
      observedStart: overlapStart.toISOString() };
    response = await post('/batches', batch([overlapping], 'cursor-2', 'cursor-3'));
    assert.equal(response.status, 201, JSON.stringify(response.body)); matches = await readMatches();
    let overlapWorker = matches.references.find(value => value.referenceKind === 'worker' && value.externalReference === 'worker-7');
    const overlapAlias = matches.references.find(value => value.referenceKind === 'worker' && value.externalReference === 'worker-8');
    let overlapJob = matches.references.find(value => value.referenceKind === 'job');
    response = await post('/matches', matchBody('worker', 'worker-7', overlapWorker.sourceDigest,
      matches.workerTargets.find(value => value.targetId === f.actors.member.actorUserId), workerMatch));
    assert.equal(response.status, 201, JSON.stringify(response.body)); workerMatch = response.body.data.match;
    response = await post('/matches', matchBody('worker', 'worker-8', overlapAlias.sourceDigest,
      matches.workerTargets.find(value => value.targetId === f.actors.member.actorUserId)));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    response = await post('/matches', matchBody('job', 'job-19', overlapJob.sourceDigest,
      matches.jobTargets.find(value => value.targetId === estimate), jobMatch));
    assert.equal(response.status, 201, JSON.stringify(response.body)); jobMatch = response.body.data.match;
    const overlapAttempt = await post(`/estimates/${estimate}/imported-labor-duration-outcomes`, observeBody);
    assert.equal(overlapAttempt.status, 409); assert.match(overlapAttempt.body.error.message, /overlap/i);
    const tombstone = { externalRecordId: 'shift-2', externalVersion: 2, state: 'tombstone', workerReference: null,
      jobReference: null, category: null, observedStart: null, observedEnd: null,
      sourceUpdatedAt: new Date(overlapEnd.getTime() + 120000).toISOString() };
    response = await post('/batches', batch([tombstone], 'cursor-3', 'cursor-4'));
    assert.equal(response.status, 201, JSON.stringify(response.body)); matches = await readMatches();
    overlapWorker = matches.references.find(value => value.referenceKind === 'worker' && value.externalReference === 'worker-7');
    overlapJob = matches.references.find(value => value.referenceKind === 'job');
    response = await post('/matches', matchBody('worker', 'worker-7', overlapWorker.sourceDigest,
      matches.workerTargets.find(value => value.targetId === f.actors.member.actorUserId), workerMatch));
    assert.equal(response.status, 201, JSON.stringify(response.body)); workerMatch = response.body.data.match;
    response = await post('/matches', matchBody('job', 'job-19', overlapJob.sourceDigest,
      matches.jobTargets.find(value => value.targetId === estimate), jobMatch));
    assert.equal(response.status, 201, JSON.stringify(response.body)); jobMatch = response.body.data.match;
    ledger.cases.push('Overlapping intervals fail review; tombstoning the conflicting source interval restores a reviewable current basis.');

    response = await post('/consent', { action: 'revoke', expectedRevision: sourceConsent.revision,
      expectedDigest: sourceConsent.digest, reason: 'Stop the external source.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const revokedSource = response.body.data.consent;
    learned = await request(f.app).get(root + `/estimates/${estimate}/imported-labor-duration-outcomes`).set(owner.session.headers);
    assert.equal(learned.body.data.activeConsent, false); assert.equal(learned.body.data.current, null);
    response = await post('/consent', { action: 'grant', expectedRevision: revokedSource.revision,
      expectedDigest: revokedSource.digest, reason: 'Re-enable the external source under new consent.', confirmed: true,
      confirmationVersion: 'm25-external-labor-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    let purpose = await request(f.app).get(root + '/imported-labor-duration-consent').set(owner.session.headers);
    assert.equal(purpose.status, 200); assert.equal(purpose.body.data.active, false);
    response = await post('/imported-labor-duration-consent', { ...grant, expectedRevision: learningConsent.revision,
      expectedDigest: learningConsent.digest, reason: 'Renew imported labor learning for the current source consent.' });
    assert.equal(response.status, 201, JSON.stringify(response.body)); learningConsent = response.body.data.consent;
    matches = await readMatches();
    const regrantedWorker = matches.references.find(value => value.referenceKind === 'worker');
    const regrantedJob = matches.references.find(value => value.referenceKind === 'job');
    response = await post('/matches', matchBody('worker', 'worker-7', regrantedWorker.sourceDigest,
      matches.workerTargets.find(value => value.targetId === f.actors.member.actorUserId), workerMatch));
    assert.equal(response.status, 201, JSON.stringify(response.body)); workerMatch = response.body.data.match;
    response = await post('/matches', matchBody('job', 'job-19', regrantedJob.sourceDigest,
      matches.jobTargets.find(value => value.targetId === estimate), jobMatch));
    assert.equal(response.status, 201, JSON.stringify(response.body)); jobMatch = response.body.data.match;
    const renewedObservation = { ...observeBody, expectedConsentRevision: learningConsent.revision,
      expectedConsentDigest: learningConsent.digest };
    response = await post(`/estimates/${estimate}/imported-labor-duration-outcomes`, renewedObservation);
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.observation.revision, 3);
    ledger.cases.push('Source revocation hides results; re-granting does not revive purpose consent or reviewed matches, which must be renewed.');

    response = await post('/imported-labor-duration-consent', { action: 'revoke', expectedRevision: learningConsent.revision,
      expectedDigest: learningConsent.digest, reason: 'Stop this imported labor learning purpose.', confirmed: true,
      confirmationVersion: 'm25-imported-labor-duration-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    learned = await request(f.app).get(root + `/estimates/${estimate}/imported-labor-duration-outcomes`).set(owner.session.headers);
    assert.equal(learned.body.data.activeConsent, false); assert.equal(learned.body.data.current, null);
    assert.deepEqual(learned.body.data.history, []);
    const other = await request(f.app).get(root + `/estimates/${estimate}/imported-labor-duration-outcomes`)
      .set(f.actors.otherOwner.session.headers);
    assert.equal(other.status, 200); assert.equal(other.body.data.current, null); assert.deepEqual(other.body.data.history, []);
    ledger.cases.push('Purpose revocation hides derived results and another tenant receives no record-existence signal.');

    const privileges = (await f.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_labor_import_learning_consents','SELECT') consent_table,
      has_table_privilege($1,'canonical_external_labor_import_outcome_observations','INSERT') outcome_table,
      has_function_privilege($1,'canonical_imported_labor_learning_basis(uuid,text,uuid,text)','EXECUTE') helper,
      has_function_privilege($1,'canonical_imported_labor_outcome_read(uuid,uuid,text,uuid,text,uuid)','EXECUTE') entry`,
    [f.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { consent_table: false, outcome_table: false, helper: false, entry: true });
    await assert.rejects(f.ownerPool.query('DELETE FROM canonical_external_labor_import_outcome_observations'));
    const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/086_canonical_imported_labor_outcomes.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const applied = (await f.ownerPool.query("SELECT trim(checksum) checksum FROM _migrations WHERE filename='086_canonical_imported_labor_outcomes.sql'")).rows;
    assert.deepEqual(applied, [{ checksum }]);
    ledger.cases.push('Runtime access is limited to guarded entries, histories are immutable and the exact migration is recorded once.');
    ledger.pass = true;
  } catch (error) {
    ledger.error = error.stack; ledger.cause = error.cause && { message: error.cause.message, code: error.cause.code,
      constraint: error.cause.constraint, detail: error.cause.detail }; process.exitCode = 1;
  } finally {
    if (f) await f.cleanup(); fs.writeFileSync(output, JSON.stringify(ledger, null, 2)); console.log(JSON.stringify(ledger));
  }
})();
