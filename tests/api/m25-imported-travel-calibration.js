'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-imported-travel-calibration-local-disposable-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) {
  delete process.env[key];
}

const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { ingestLead } = require('../../src/services/canonicalGraphService');
const composition = require('../helpers/m24-cost-composition-input');
const { fixture: travelFixture } = require('../helpers/m24-travel-input');

const output = (process.argv.find(value => value.startsWith('--output=')) ||
  '--output=m25-imported-travel-calibration-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'fleet.primary';

(async () => {
  let f;
  const ledger = { cases: [] };
  try {
    f = await createDatabaseFixture({ operationalSchedule: true });
    const owner = f.actors.owner;
    const profile = (await f.ownerPool.query(
      'SELECT raw_profile,version_label FROM canonical_business_profiles WHERE organization_id=$1 AND is_active=true',
      [f.org])).rows[0];
    const estimates = [];

    for (let index = 0; index < 5; index += 1) {
      const external = crypto.randomUUID();
      const ingested = await ingestLead(f.runtimePool, {
        tenantContext: { organizationId: f.org, trusted: true },
        idempotencyKey: external,
        sourceVersion: 'm25-imported-travel-calibration-fixture-v1',
        external: {
          customerId: external, callId: external, transcriptId: external,
          communicationId: external, appointmentId: external,
        },
        customer: {
          name: `Travel calibration customer ${index + 1}`,
          phone: `+1555555040${index}`,
          email: `${external}@example.test`,
          address: { line1: `${index + 1} Route Way`, city: 'Boston', state: 'MA', postalCode: '02108' },
        },
        transcript: [{ turnId: 'scope', speaker: 'customer', text: 'Travel to the tree job and return with the company truck.' }],
        facts: [],
        service: { key: 'tree', scope: { jobType: 'removal', description: 'Imported travel calibration' } },
        businessProfile: profile.raw_profile,
        businessProfileVersion: profile.version_label,
      });
      assert.equal(ingested.status, 201, JSON.stringify(ingested));
      const estimate = ingested.body.ids.estimate;
      estimates.push(estimate);
      f.estimateGraphs = [ingested.body];
      const root = `/api/v1/canonical/estimates/${estimate}`;
      const estimatePost = (suffix, body) => request(f.app).post(root + suffix).set(owner.session.headers)
        .set('Idempotency-Key', crypto.randomUUID()).send(body);
      const review = async () => {
        const value = await request(f.app).get(root + '/review').set(owner.session.headers);
        assert.equal(value.status, 200, JSON.stringify(value.body));
        return value.body.data;
      };
      let state = await review();
      const plan = { ...composition.common(state, state.travelPlans.current), inputs: travelFixture(),
        confirmationVersion: 'estimate-travel-plan-v1' };
      plan.inputs.serviceKey = state.travelPlans.serviceKey;
      plan.inputs.trips[0].vehicle = {
        method: 'consumption', unit: 'us_gal', price: '3.90', basis: 'efficiency', quantity: null,
        efficiency: { value: '10', unit: 'mi_per_us_gal' },
        otherCosts: { status: 'not_applicable', note: 'No separate vehicle costs are included in this fixture.' },
      };
      let response = await estimatePost('/travel-plan-preview', plan);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      plan.inputs.assessment = { ...response.body.data.assessment, acknowledged: true,
        explanation: 'The owner reviewed the declared route, duration, distance and fuel assumptions.' };
      response = await estimatePost('/travel-plans', plan);
      assert.equal(response.status, 201, JSON.stringify(response.body));
      state = await review();
      const saved = state.travelPlans.current;
      const adoption = {
        sourcePins: state.pins,
        expectedPlanId: saved.id,
        expectedPlanRevision: saved.revision,
        expectedPlanDigest: saved.digest,
        expectedDecisionRevision: state.decisions.writeBasis.revision,
        expectedDecisionDigest: state.decisions.writeBasis.digest,
        reason: 'Adopt the reviewed travel plan as the comparison baseline.',
        confirmed: true,
        confirmationVersion: 'estimate-cost-adoption-v3',
        changedComponent: 'travel',
        expectedComponents: state.travelCostComponents,
        assessment: {},
        coverage: {
          componentManifest: state.travelCoverageChoices.travel.componentManifest,
          overlaps: [], equipmentOutside: [], travelOutside: [], confirmed: true,
          reason: 'Travel costs are separately identified and not counted elsewhere.',
        },
      };
      response = await estimatePost('/cost-adoption-preview', adoption);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      adoption.assessment = response.body.data.assessment;
      response = await estimatePost('/cost-adoptions', adoption);
      assert.equal(response.status, 201, JSON.stringify(response.body));
    }
    ledger.cases.push('Five same-service estimates retain separate adopted travel plans.');

    const vehicle = crypto.randomUUID();
    const draft = crypto.randomUUID();
    const draftDocument = { fixture: 'reviewed travel calibration vehicle' };
    await f.ownerPool.query(`INSERT INTO tenant_assets(id,organization_id,category,name,internal_reference,
      manufacturer,model,model_year,configuration,created_by_user_id,updated_by_user_id)
      VALUES($1,$2,'vehicle','Travel truck','TRUCK-CAL','Ford','F-550',2024,'Chip body',$3,$3)`,
    [vehicle, f.org, owner.actorUserId]);
    const equipmentClient = await f.ownerPool.connect();
    try {
      await equipmentClient.query('BEGIN');
      await equipmentClient.query(`INSERT INTO canonical_equipment_drafts(organization_id,id,actor_user_id,session_id,
        revision,document,digest) VALUES($1,$2,$3,$4,1,$5,equipment_digest($5::jsonb))`,
      [f.org, draft, owner.actorUserId, owner.authSessionId, draftDocument]);
      await equipmentClient.query(`INSERT INTO canonical_equipment_receipts(organization_id,actor_user_id,session_id,
        key_hash,request_digest,action,subject_id,response) VALUES($1,$2,$3,$4,$5,'confirm',$6,
        '{"data":{"revision":1}}')`, [f.org, owner.actorUserId, owner.authSessionId, 'd'.repeat(64), 'c'.repeat(64), draft]);
      await equipmentClient.query(`INSERT INTO canonical_equipment_draft_history(organization_id,draft_id,revision,
        document,digest,actor_user_id,session_id,action,request_digest)
        VALUES($1,$2,1,$5,equipment_digest($5::jsonb),$3,$4,'confirm',$6)`,
      [f.org, draft, owner.actorUserId, owner.authSessionId, draftDocument, 'c'.repeat(64)]);
      await equipmentClient.query(`INSERT INTO canonical_equipment_asset_versions(organization_id,asset_id,asset_version,
        asset_snapshot,asset_digest,private_configuration,knowledge_version_id,knowledge_digest,category_label,review_state,
        draft_id,draft_revision,actor_user_id) SELECT organization_id,id,version,to_jsonb(a),equipment_digest(to_jsonb(a)),
        '{}',NULL,NULL,'Vehicle','reviewed',$2,1,$3 FROM tenant_assets a WHERE organization_id=$1 AND id=$4`,
      [f.org, draft, owner.actorUserId, vehicle]);
      await equipmentClient.query('COMMIT');
    } catch (error) {
      await equipmentClient.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      equipmentClient.release();
    }

    const root = `/api/v1/learning/external-travel-sources/${sourceKey}`;
    const post = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(f.app).post(root + suffix)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    let response = await post('/consent', {
      action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use reviewed external travel evidence.', confirmed: true,
      confirmationVersion: 'm25-external-travel-import-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const sourceConsent = response.body.data.consent;
    const ratios = [1, 1.1, 1.2, 1.25, 1.3];
    const records = ratios.map((ratio, index) => {
      const start = new Date(Date.UTC(2026, 1, index + 1, 12));
      const end = new Date(start.getTime() + 80 * ratio * 60000);
      return {
        externalRecordId: `route-${index + 1}`, externalVersion: 1, state: 'active',
        jobReference: `job-${index + 1}`, vehicleReference: 'truck-cal',
        routeStartedAt: start.toISOString(), routeEndedAt: end.toISOString(), timeZone: 'America/New_York',
        distance: { value: String(40 * ratio), unit: 'mi', basis: 'gps' },
        fuel: { quantity: String(4 * ratio), unit: 'us_gal', costAmount: String(15.6 * ratio),
          currency: 'USD', basis: 'fuel_card' },
        evidenceClass: 'provider_recorded', sourceUpdatedAt: new Date(end.getTime() + 60000).toISOString(),
      };
    });
    response = await post('/batches', {
      schemaVersion: 'm25-external-travel-actual-v1', mode: 'continuous_update',
      expectedConsentRevision: sourceConsent.revision, expectedConsentDigest: sourceConsent.digest,
      cursorBefore: null, cursorAfter: 'cursor-1', complete: false, records,
      reason: 'Stage five current reviewed travel outcomes.', confirmed: true,
      confirmationVersion: 'm25-external-travel-import-batch-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));

    const readMatches = async () => {
      const value = await request(f.app).get(root + '/matches').set(owner.session.headers);
      assert.equal(value.status, 200, JSON.stringify(value.body));
      return value.body.data;
    };
    const matches = await readMatches();
    const vehicleRef = matches.references.find(value => value.referenceKind === 'vehicle');
    const vehicleTarget = matches.vehicleTargets.find(value => value.targetId === vehicle);
    const matchBody = (kind, reference, sourceDigest, target) => ({
      referenceKind: kind, externalReference: reference, action: 'link', targetId: target.targetId,
      expectedRevision: 0, expectedDigest: 'none', expectedSourceDigest: sourceDigest,
      expectedTargetDigest: target.digest, reason: 'Owner reviewed the current source reference and same-tenant target.',
      confirmed: true, confirmationVersion: 'm25-external-travel-reference-match-v1',
    });
    response = await post('/matches', matchBody('vehicle', 'truck-cal', vehicleRef.sourceDigest, vehicleTarget));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    for (let index = 0; index < 5; index += 1) {
      const jobRef = matches.references.find(value => value.referenceKind === 'job' &&
        value.externalReference === `job-${index + 1}`);
      const jobTarget = matches.jobTargets.find(value => value.targetId === estimates[index]);
      assert.ok(jobRef && jobTarget);
      response = await post('/matches', matchBody('job', `job-${index + 1}`, jobRef.sourceDigest, jobTarget));
      assert.equal(response.status, 201, JSON.stringify(response.body));
    }
    ledger.cases.push('One vehicle and five external jobs are explicitly reconciled to current same-tenant targets.');

    response = await post('/imported-travel-variance-consent', {
      action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Compare matched travel evidence with adopted travel plans.', confirmed: true,
      confirmationVersion: 'm25-imported-travel-variance-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const outcomeConsent = response.body.data.consent;
    const calibrationGrant = {
      action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Summarize current reviewed imported travel outcomes.', confirmed: true,
      confirmationVersion: 'm25-imported-travel-calibration-consent-v1',
    };
    const consentKey = crypto.randomUUID();
    response = await post('/imported-travel-calibration-consent', calibrationGrant, consentKey);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const calibrationConsent = response.body.data.consent;
    assert.equal((await post('/imported-travel-calibration-consent', calibrationGrant, consentKey)).status, 200);
    assert.equal((await post('/imported-travel-calibration-consent', calibrationGrant,
      crypto.randomUUID(), f.actors.member)).status, 403);

    const proposalBody = {
      expectedConsentRevision: calibrationConsent.revision,
      expectedConsentDigest: calibrationConsent.digest,
      reason: 'Review the complete current five-job travel sample.', confirmed: true,
      confirmationVersion: 'm25-imported-travel-calibration-proposal-v1',
    };
    for (let index = 0; index < 5; index += 1) {
      response = await post(`/estimates/${estimates[index]}/imported-travel-outcomes`, {
        externalJobReference: `job-${index + 1}`,
        expectedConsentRevision: outcomeConsent.revision,
        expectedConsentDigest: outcomeConsent.digest,
        reason: 'Compare this matched external job with its adopted travel plan.', confirmed: true,
        confirmationVersion: 'm25-imported-travel-variance-observation-v1',
      });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      if (index === 3) {
        const insufficient = await post('/imported-travel-calibrations/tree', proposalBody);
        assert.equal(insufficient.status, 409, JSON.stringify(insufficient.body));
        assert.equal(insufficient.body.error.code, 'M25_IMPORTED_TRAVEL_CALIBRATION_SAMPLE_REQUIRED');
      }
    }
    ledger.cases.push('Calibration fails closed until five current reviewed same-service travel outcomes exist.');

    const proposalKey = crypto.randomUUID();
    response = await post('/imported-travel-calibrations/tree', proposalBody, proposalKey);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const proposal = response.body.data.proposal;
    assert.equal(proposal.sampleSize, 5);
    assert.equal(proposal.eligibleMetricCount, 4);
    for (const key of ['routeDuration', 'distance', 'fuelQuantity', 'fuelCost']) {
      assert.equal(proposal.metrics[key].status, 'compared');
      assert.equal(proposal.metrics[key].medianActualToPlannedRatio, '1.2000');
      assert.equal(proposal.metrics[key].lowerQuartileRatio, '1.1000');
      assert.equal(proposal.metrics[key].upperQuartileRatio, '1.2500');
      assert.equal(proposal.metrics[key].proposedMultiplier, '1.2000');
      assert.equal(proposal.metrics[key].advisoryCode, 'increase_planned_amount');
    }
    assert.equal((await post('/imported-travel-calibrations/tree', proposalBody, proposalKey)).status, 200);
    const changedKey = await post('/imported-travel-calibrations/tree',
      { ...proposalBody, reason: 'Different request details.' }, proposalKey);
    assert.equal(changedKey.status, 409);
    assert.equal(changedKey.body.error.code, 'M25_IMPORTED_TRAVEL_CALIBRATION_KEY_CONFLICT');
    assert.equal((await post('/imported-travel-calibrations/tree', proposalBody)).status, 409);
    let read = await request(f.app).get(root + '/imported-travel-calibrations/tree').set(owner.session.headers);
    assert.equal(read.status, 200);
    assert.equal(read.body.data.current.fresh, true);
    assert.equal(read.body.data.current.advisoryAvailable, true);
    const other = await request(f.app).get(root + '/imported-travel-calibrations/tree')
      .set(f.actors.otherOwner.session.headers);
    assert.equal(other.status, 200);
    assert.equal(other.body.data.current, null);
    ledger.cases.push('Median and quartiles are deterministic, tenant-private, dimension-specific and advisory-only.');

    const mixed = ratios.concat([1]).map((ratio, index) => ({ metrics: {
      routeDuration: { status: 'compared', unit: 'vehicle_minute', actual: String(80 * ratio), planned: '80' },
      fuelQuantity: { status: 'compared', unit: index < 5 ? 'us_gal' : 'kwh', actual: String(4 * ratio), planned: '4' },
    } }));
    const dimensionCheck = (await f.ownerPool.query(`SELECT
      public.canonical_imported_travel_calibration_metric($1::jsonb,'routeDuration') route_duration,
      public.canonical_imported_travel_calibration_metric($1::jsonb,'fuelQuantity') fuel_quantity`,
    [JSON.stringify(mixed)])).rows[0];
    assert.equal(dimensionCheck.route_duration.status, 'compared');
    assert.equal(dimensionCheck.fuel_quantity.status, 'unavailable');
    assert.match(dimensionCheck.fuel_quantity.unavailableReason, /incompatible units/i);
    ledger.cases.push('Incompatible fuel or energy units suppress only that dimension; comparable route duration remains usable.');

    const corrected = { ...records[0], externalVersion: 2,
      routeEndedAt: new Date(Date.parse(records[0].routeStartedAt) + 90 * 60000).toISOString(),
      distance: { value: '45', unit: 'mi', basis: 'gps' },
      fuel: { quantity: '4.5', unit: 'us_gal', costAmount: '17.55', currency: 'USD', basis: 'fuel_card' },
      sourceUpdatedAt: new Date(Date.parse(records[0].routeStartedAt) + 91 * 60000).toISOString() };
    response = await post('/batches', {
      schemaVersion: 'm25-external-travel-actual-v1', mode: 'continuous_update',
      expectedConsentRevision: sourceConsent.revision, expectedConsentDigest: sourceConsent.digest,
      cursorBefore: 'cursor-1', cursorAfter: 'cursor-2', complete: false, records: [corrected],
      reason: 'Correct one current route.', confirmed: true,
      confirmationVersion: 'm25-external-travel-import-batch-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const delayedReplay = await post('/imported-travel-calibrations/tree', proposalBody, proposalKey);
    assert.equal(delayedReplay.status, 200, JSON.stringify(delayedReplay.body));
    assert.equal(delayedReplay.body.data.replayed, true);
    assert.equal(delayedReplay.body.data.proposal.fresh, false);
    assert.equal(delayedReplay.body.data.proposal.advisoryAvailable, false);
    assert.equal(delayedReplay.body.data.proposal.metrics.routeDuration.proposedMultiplier, null);
    read = await request(f.app).get(root + '/imported-travel-calibrations/tree').set(owner.session.headers);
    assert.equal(read.status, 200);
    assert.equal(read.body.data.current.fresh, false);
    assert.equal(read.body.data.current.advisoryAvailable, false);
    ledger.cases.push('A source correction stales and masks prior advice while preserving an exact delayed replay.');

    response = await post('/imported-travel-calibration-consent', {
      action: 'revoke', expectedRevision: calibrationConsent.revision, expectedDigest: calibrationConsent.digest,
      reason: 'Stop this calibration purpose.', confirmed: true,
      confirmationVersion: 'm25-imported-travel-calibration-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    read = await request(f.app).get(root + '/imported-travel-calibrations/tree').set(owner.session.headers);
    assert.equal(read.body.data.activeConsent, false);
    assert.equal(read.body.data.current, null);
    assert.deepEqual(read.body.data.history, []);

    const privileges = (await f.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_external_travel_calibration_consents','SELECT') consent_table,
      has_table_privilege($1,'canonical_external_travel_calibration_proposals','INSERT') proposal_table,
      has_function_privilege($1,'canonical_imported_travel_calibration_basis(uuid,text,text)','EXECUTE') helper,
      has_function_privilege($1,'canonical_imported_travel_calibration_read(uuid,uuid,text,uuid,text,text)','EXECUTE') entry`,
    [f.roles.runtime])).rows[0];
    assert.deepEqual(privileges, { consent_table: false, proposal_table: false, helper: false, entry: true });
    await assert.rejects(f.ownerPool.query('DELETE FROM canonical_external_travel_calibration_proposals'));
    const bytes = fs.readFileSync(path.join(__dirname, '../../migrations/093_canonical_imported_travel_calibration.sql'));
    const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
    const applied = (await f.ownerPool.query(
      "SELECT trim(checksum) checksum FROM _migrations WHERE filename='093_canonical_imported_travel_calibration.sql'"
    )).rows;
    assert.deepEqual(applied, [{ checksum }]);
    const counts = (await f.ownerPool.query(`SELECT
      (SELECT count(*) FROM canonical_estimates WHERE organization_id=$1) estimates,
      (SELECT count(*) FROM canonical_travel_plans WHERE organization_id=$1) plans,
      (SELECT count(*) FROM canonical_external_travel_calibration_proposals WHERE organization_id=$1) proposals`,
    [f.org])).rows[0];
    assert.deepEqual(counts, { estimates: '5', plans: '5', proposals: '1' });
    ledger.cases.push('Revocation hides advice; runtime authority, immutability, provenance and no-operational-mutation boundaries hold.');
    ledger.pass = true;
  } catch (error) {
    const source = error.cause || error;
    ledger.error = error.stack;
    ledger.cause = { message: source.message, code: source.code, constraint: source.constraint,
      detail: source.detail, where: source.where, position: source.position };
    process.exitCode = 1;
  } finally {
    if (f) await f.cleanup();
    fs.writeFileSync(output, JSON.stringify(ledger, null, 2));
    console.log(JSON.stringify(ledger));
  }
})();
