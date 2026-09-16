'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const request = require('supertest');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-imported-travel-outcome-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { ingestLead } = require('../../src/services/canonicalGraphService');
const composition = require('../helpers/m24-cost-composition-input');
const { fixture: travelFixture } = require('../helpers/m24-travel-input');
const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-imported-travel-outcomes-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'fleet.primary';

(async () => {
  let f; const ledger = { cases: [] };
  try {
    f = await createDatabaseFixture({ operationalSchedule: true }); const owner = f.actors.owner;
    const profile = (await f.ownerPool.query('SELECT raw_profile,version_label FROM canonical_business_profiles WHERE organization_id=$1 AND is_active=true', [f.org])).rows[0];
    const external = crypto.randomUUID();
    const ingested = await ingestLead(f.runtimePool, { tenantContext: { organizationId: f.org, trusted: true }, idempotencyKey: external,
      sourceVersion: 'm25-imported-travel-outcome-v1', external: { customerId: external, callId: external, transcriptId: external, communicationId: external, appointmentId: external },
      customer: { name: 'Travel outcome customer', phone: '+15555550292', email: `${external}@example.test`, address: { line1: '92 Test Way', city: 'Boston', state: 'MA', postalCode: '02108' } },
      transcript: [{ turnId: 'scope', speaker: 'customer', text: 'Travel to the job and return with the company truck.' }],
      facts: [], service: { key: 'tree', scope: { jobType: 'removal', description: 'Travel outcome comparison' } },
      businessProfile: profile.raw_profile, businessProfileVersion: profile.version_label });
    assert.equal(ingested.status, 201, JSON.stringify(ingested)); f.estimateGraphs = [ingested.body]; const estimate = ingested.body.ids.estimate;
    const estimateRoot = `/api/v1/canonical/estimates/${estimate}`;
    const estimatePost = (suffix, body) => request(f.app).post(estimateRoot + suffix).set(owner.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);
    const review = async () => { const value = await request(f.app).get(estimateRoot + '/review').set(owner.session.headers); assert.equal(value.status, 200, JSON.stringify(value.body)); return value.body.data; };
    let state = await review(); const plan = { ...composition.common(state, state.travelPlans.current), inputs: travelFixture(), confirmationVersion: 'estimate-travel-plan-v1' };
    plan.inputs.serviceKey = state.travelPlans.serviceKey; plan.inputs.trips[0].vehicle = { method: 'consumption', unit: 'us_gal', price: '3.90', basis: 'efficiency', quantity: null, efficiency: { value: '10', unit: 'mi_per_us_gal' }, otherCosts: { status: 'not_applicable', note: 'No separate vehicle costs are included in this fixture.' } };
    let response = await estimatePost('/travel-plan-preview', plan); assert.equal(response.status, 200, JSON.stringify(response.body));
    plan.inputs.assessment = { ...response.body.data.assessment, acknowledged: true, explanation: 'The owner reviewed the declared route, distance, duration and fuel assumptions.' };
    response = await estimatePost('/travel-plans', plan); assert.equal(response.status, 201, JSON.stringify(response.body)); state = await review();
    const saved = state.travelPlans.current; const adoption = { sourcePins: state.pins, expectedPlanId: saved.id, expectedPlanRevision: saved.revision, expectedPlanDigest: saved.digest, expectedDecisionRevision: state.decisions.writeBasis.revision, expectedDecisionDigest: state.decisions.writeBasis.digest, reason: 'Adopt the reviewed travel plan as the comparison baseline.', confirmed: true, confirmationVersion: 'estimate-cost-adoption-v3', changedComponent: 'travel', expectedComponents: state.travelCostComponents, assessment: {}, coverage: { componentManifest: state.travelCoverageChoices.travel.componentManifest, overlaps: [], equipmentOutside: [], travelOutside: [], confirmed: true, reason: 'The travel costs are separately identified and not counted elsewhere.' } };
    response = await estimatePost('/cost-adoption-preview', adoption); assert.equal(response.status, 200, JSON.stringify(response.body)); adoption.assessment = response.body.data.assessment;
    response = await estimatePost('/cost-adoptions', adoption); assert.equal(response.status, 201, JSON.stringify(response.body));
    ledger.cases.push('A reviewed 40-mile, 80-vehicle-minute, 4-gallon travel plan is adopted as the immutable comparison baseline.');

    const vehicle = crypto.randomUUID(), draft = crypto.randomUUID(), draftDocument = { fixture: 'reviewed travel outcome vehicle' };
    await f.ownerPool.query(`INSERT INTO tenant_assets(id,organization_id,category,name,internal_reference,manufacturer,model,model_year,configuration,created_by_user_id,updated_by_user_id) VALUES($1,$2,'vehicle','Travel truck','TRUCK-2','Ford','F-550',2024,'Chip body',$3,$3)`, [vehicle, f.org, owner.actorUserId]);
    const equipmentClient = await f.ownerPool.connect(); try { await equipmentClient.query('BEGIN');
      await equipmentClient.query(`INSERT INTO canonical_equipment_drafts(organization_id,id,actor_user_id,session_id,revision,document,digest) VALUES($1,$2,$3,$4,1,$5,equipment_digest($5::jsonb))`, [f.org, draft, owner.actorUserId, owner.authSessionId, draftDocument]);
      await equipmentClient.query(`INSERT INTO canonical_equipment_receipts(organization_id,actor_user_id,session_id,key_hash,request_digest,action,subject_id,response) VALUES($1,$2,$3,$4,$5,'confirm',$6,'{"data":{"revision":1}}')`, [f.org, owner.actorUserId, owner.authSessionId, 'd'.repeat(64), 'c'.repeat(64), draft]);
      await equipmentClient.query(`INSERT INTO canonical_equipment_draft_history(organization_id,draft_id,revision,document,digest,actor_user_id,session_id,action,request_digest) VALUES($1,$2,1,$5,equipment_digest($5::jsonb),$3,$4,'confirm',$6)`, [f.org, draft, owner.actorUserId, owner.authSessionId, draftDocument, 'c'.repeat(64)]);
      await equipmentClient.query(`INSERT INTO canonical_equipment_asset_versions(organization_id,asset_id,asset_version,asset_snapshot,asset_digest,private_configuration,knowledge_version_id,knowledge_digest,category_label,review_state,draft_id,draft_revision,actor_user_id) SELECT organization_id,id,version,to_jsonb(a),equipment_digest(to_jsonb(a)),'{}',NULL,NULL,'Vehicle','reviewed',$2,1,$3 FROM tenant_assets a WHERE organization_id=$1 AND id=$4`, [f.org, draft, owner.actorUserId, vehicle]); await equipmentClient.query('COMMIT');
    } catch (error) { await equipmentClient.query('ROLLBACK').catch(() => {}); throw error; } finally { equipmentClient.release(); }

    const root = `/api/v1/learning/external-travel-sources/${sourceKey}`;
    const post = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(f.app).post(root + suffix).set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    response = await post('/consent', { action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Use reviewed external travel evidence.', confirmed: true, confirmationVersion: 'm25-external-travel-import-consent-v1' });
    assert.equal(response.status, 201, JSON.stringify(response.body)); const sourceConsent = response.body.data.consent;
    const record = version => ({ externalRecordId: 'route-1', externalVersion: version, state: 'active', jobReference: 'job-19', vehicleReference: 'truck-2', routeStartedAt: '2026-09-15T12:00:00.000Z', routeEndedAt: '2026-09-15T12:48:00.000Z', timeZone: 'America/New_York', distance: { value: version === 1 ? '23.4' : '42', unit: 'mi', basis: 'gps' }, fuel: { quantity: version === 1 ? '2.8' : '4.2', unit: 'us_gal', costAmount: version === 1 ? '10.92' : '16.38', currency: 'USD', basis: 'fuel_card' }, evidenceClass: 'provider_recorded', sourceUpdatedAt: version === 1 ? '2026-09-15T13:00:00.000Z' : '2026-09-15T14:00:00.000Z' });
    const batch = (version, before, after) => ({ schemaVersion: 'm25-external-travel-actual-v1', mode: 'continuous_update', expectedConsentRevision: sourceConsent.revision, expectedConsentDigest: sourceConsent.digest, cursorBefore: before, cursorAfter: after, complete: false, records: [record(version)], reason: 'Stage current normalized travel evidence.', confirmed: true, confirmationVersion: 'm25-external-travel-import-batch-v1' });
    response = await post('/batches', batch(1, null, 'cursor-1')); assert.equal(response.status, 201, JSON.stringify(response.body));
    const readMatches = async () => { const value = await request(f.app).get(root + '/matches').set(owner.session.headers); assert.equal(value.status, 200, JSON.stringify(value.body)); return value.body.data; };
    let matches = await readMatches(); const jobRef = matches.references.find(value => value.referenceKind === 'job'); const vehicleRef = matches.references.find(value => value.referenceKind === 'vehicle'); const jobTarget = matches.jobTargets.find(value => value.targetId === estimate); const vehicleTarget = matches.vehicleTargets.find(value => value.targetId === vehicle); assert.ok(jobRef && vehicleRef && jobTarget && vehicleTarget);
    const matchBody = (kind, reference, sourceDigest, target, previous = null) => ({ referenceKind: kind, externalReference: reference, action: 'link', targetId: target.targetId, expectedRevision: previous?.revision || 0, expectedDigest: previous?.digest || 'none', expectedSourceDigest: sourceDigest, expectedTargetDigest: target.digest, reason: 'Owner reviewed the current source reference and same-tenant target.', confirmed: true, confirmationVersion: 'm25-external-travel-reference-match-v1' });
    response = await post('/matches', matchBody('job', 'job-19', jobRef.sourceDigest, jobTarget)); assert.equal(response.status, 201, JSON.stringify(response.body)); let jobMatch = response.body.data.match;
    response = await post('/matches', matchBody('vehicle', 'truck-2', vehicleRef.sourceDigest, vehicleTarget)); assert.equal(response.status, 201, JSON.stringify(response.body)); let vehicleMatch = response.body.data.match;
    ledger.cases.push('The external job and every vehicle reference are explicitly linked to current reviewed same-tenant targets.');

    const grant = { action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Compare current matched travel evidence with adopted travel plans.', confirmed: true, confirmationVersion: 'm25-imported-travel-variance-consent-v1' };
    const grantKey = crypto.randomUUID(); response = await post('/imported-travel-variance-consent', grant, grantKey); assert.equal(response.status, 201, JSON.stringify(response.body)); const learningConsent = response.body.data.consent;
    assert.equal((await post('/imported-travel-variance-consent', grant, grantKey)).status, 200); assert.equal((await post('/imported-travel-variance-consent', grant, crypto.randomUUID(), f.actors.member)).status, 403);
    const observeBody = { externalJobReference: 'job-19', expectedConsentRevision: learningConsent.revision, expectedConsentDigest: learningConsent.digest, reason: 'Compare this matched external job with the adopted travel plan.', confirmed: true, confirmationVersion: 'm25-imported-travel-variance-observation-v1' };
    const observationKey = crypto.randomUUID(); response = await post(`/estimates/${estimate}/imported-travel-outcomes`, observeBody, observationKey); assert.equal(response.status, 201, JSON.stringify(response.body));
    const metrics = response.body.data.observation.metrics; assert.equal(Number(metrics.routeDuration.planned), 80); assert.equal(Number(metrics.routeDuration.actual), 48); assert.equal(Number(metrics.distance.planned), 40); assert.equal(Number(metrics.distance.actual), 23.4); assert.equal(Number(metrics.fuelQuantity.planned), 4); assert.equal(Number(metrics.fuelQuantity.actual), 2.8); assert.equal(Number(metrics.fuelCost.planned), 15.6); assert.equal(Number(metrics.fuelCost.actual), 10.92);
    assert.equal((await post(`/estimates/${estimate}/imported-travel-outcomes`, observeBody, observationKey)).status, 200); assert.equal((await post(`/estimates/${estimate}/imported-travel-outcomes`, observeBody)).status, 409);
    let learned = await request(f.app).get(root + `/estimates/${estimate}/imported-travel-outcomes`).set(owner.session.headers); assert.equal(learned.status, 200); assert.equal(learned.body.data.current.fresh, true);
    ledger.cases.push('Separate consent produces deterministic duration, distance, liquid-fuel and same-currency cost observations without changing operations.');

    response = await post('/batches', batch(2, 'cursor-1', 'cursor-2')); assert.equal(response.status, 201, JSON.stringify(response.body)); learned = await request(f.app).get(root + `/estimates/${estimate}/imported-travel-outcomes`).set(owner.session.headers); assert.equal(learned.body.data.current.fresh, false); assert.equal(learned.body.data.current.advisoryAvailable, false);
    matches = await readMatches(); const changedJob = matches.references.find(value => value.referenceKind === 'job'); const changedVehicle = matches.references.find(value => value.referenceKind === 'vehicle'); response = await post('/matches', matchBody('job', 'job-19', changedJob.sourceDigest, jobTarget, jobMatch)); assert.equal(response.status, 201); jobMatch = response.body.data.match; response = await post('/matches', matchBody('vehicle', 'truck-2', changedVehicle.sourceDigest, vehicleTarget, vehicleMatch)); assert.equal(response.status, 201); vehicleMatch = response.body.data.match;
    response = await post(`/estimates/${estimate}/imported-travel-outcomes`, observeBody); assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.observation.revision, 2); assert.equal(response.body.data.observation.metrics.distance.advisoryCode, 'within_expected_range');
    ledger.cases.push('A source correction stales prior advice and requires renewed job and vehicle matches before a new immutable observation.');

    const electric = { ...record(3), distance: { value: '40', unit: 'mi', basis: 'odometer' }, fuel: { quantity: '5', unit: 'kwh', costAmount: '12', currency: 'USD', basis: 'meter' }, sourceUpdatedAt: '2026-09-15T15:00:00.000Z' };
    response = await post('/batches', { ...batch(3, 'cursor-2', 'cursor-3'), records: [electric] }); assert.equal(response.status, 201, JSON.stringify(response.body)); matches = await readMatches();
    const electricJob = matches.references.find(value => value.referenceKind === 'job'); const electricVehicle = matches.references.find(value => value.referenceKind === 'vehicle');
    response = await post('/matches', matchBody('job', 'job-19', electricJob.sourceDigest, jobTarget, jobMatch)); assert.equal(response.status, 201); jobMatch = response.body.data.match;
    response = await post('/matches', matchBody('vehicle', 'truck-2', electricVehicle.sourceDigest, vehicleTarget, vehicleMatch)); assert.equal(response.status, 201); vehicleMatch = response.body.data.match;
    response = await post(`/estimates/${estimate}/imported-travel-outcomes`, observeBody); assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.data.observation.revision, 3); assert.equal(response.body.data.observation.metrics.distance.status, 'compared'); assert.equal(response.body.data.observation.metrics.fuelQuantity.status, 'unavailable'); assert.equal(response.body.data.observation.metrics.fuelCost.status, 'compared');
    ledger.cases.push('Incompatible liquid-fuel and electric-energy units leave only that dimension unavailable while commensurate distance and same-currency cost remain usable.');

    response = await post('/consent', { action: 'revoke', expectedRevision: sourceConsent.revision, expectedDigest: sourceConsent.digest, reason: 'Stop using this travel source.', confirmed: true, confirmationVersion: 'm25-external-travel-import-consent-v1' }); assert.equal(response.status, 201);
    const delayed = await post(`/estimates/${estimate}/imported-travel-outcomes`, observeBody, observationKey); assert.equal(delayed.status, 200); assert.equal(delayed.headers['idempotency-replayed'], 'true');
    assert.equal((await post(`/estimates/${estimate}/imported-travel-outcomes`, { ...observeBody, reason: 'Changed delayed retry.' }, observationKey)).status, 409);
    learned = await request(f.app).get(root + `/estimates/${estimate}/imported-travel-outcomes`).set(owner.session.headers); assert.equal(learned.body.data.activeConsent, false); assert.equal(learned.body.data.current, null);
    ledger.cases.push('Source revocation hides derived values and blocks new work while exact delayed retries preserve the immutable receipt.');

    const counts = (await f.ownerPool.query('SELECT (SELECT count(*) FROM canonical_estimates WHERE organization_id=$1) estimates,(SELECT count(*) FROM canonical_travel_plans WHERE organization_id=$1) plans,(SELECT count(*) FROM canonical_external_travel_outcome_observations WHERE organization_id=$1) observations', [f.org])).rows[0]; assert.equal(counts.estimates, '1'); assert.equal(counts.observations, '3'); assert.equal(counts.plans, '1');
    ledger.cases.push('Outcome writes append only to the private observation ledger and do not create estimates or travel plans.'); ledger.pass = true;
  } catch (error) { const source = error.cause || error; ledger.error = error.stack; ledger.cause = { message: source.message, code: source.code, constraint: source.constraint, detail: source.detail, where: source.where, position: source.position }; process.exitCode = 1;
  } finally { if (f) await f.cleanup(); fs.writeFileSync(output, JSON.stringify(ledger, null, 2)); console.log(JSON.stringify(ledger)); }
})();
