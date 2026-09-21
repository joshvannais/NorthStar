'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const request = require('supertest');

const rootPath = require('node:path').resolve(__dirname, '../..');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-part11f-success-fixture-secret';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY']) delete process.env[key];

const { createEstimateReviewFixture } = require(rootPath + '/tests/helpers/m24-estimate-review-fixture');
const { canonicalFenceProfile } = require(rootPath + '/tests/helpers/m19-part3-business-profile');
const { ingestLead } = require(rootPath + '/src/services/canonicalGraphService');
const planHelpers = require(rootPath + '/tests/helpers/m24-cost-composition-input');
const contracts = require(rootPath + '/src/operations/contract');
const operations = require(rootPath + '/src/operations/repository');

const output = (process.argv.find(value => value.startsWith('--output=')) || '--output=m25-imported-material-calibration-success-result.json').slice(9);
assert.ok(!fs.existsSync(output));
const sourceKey = 'materials.calibration.independent';
const providerDigest = crypto.createHash('sha256').update('independent-five-pair-provider').digest('hex');
const occurredAt = '2026-09-17T12:00:00.000Z';
const exact = value => {
  const fixed = Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return fixed || '0';
};

function externalRecord({ id, type, job = null, material, vendor = null, movementKind = null, quantity, unit, amount = null, valuation = null, version = 1, state = 'active' }) {
  if (state === 'tombstone') {
    return {
      externalRecordId: id, externalVersion: version, state,
      recordType: null, jobReference: null, materialReference: null, vendorReference: null, locationReference: null,
      occurredAt: null, timeZone: null, movementKind: null, quantity: null, cost: null,
      evidenceClass: null, providerEvidenceDigest: null,
      sourceUpdatedAt: new Date(Date.parse(occurredAt) + version * 60000).toISOString(),
    };
  }
  return {
    externalRecordId: id, externalVersion: version, state, recordType: type,
    jobReference: job, materialReference: material, vendorReference: vendor,
    locationReference: type === 'inventory_movement' ? 'location-ext-main' : null,
    occurredAt, timeZone: 'America/New_York', movementKind,
    quantity: { value: quantity, unit, basis: type === 'vendor_cost' ? 'vendor_quote' : 'provider_recorded' },
    cost: amount === null ? null : { amount, currency: 'USD', valuation, basis: type === 'purchase' ? 'invoice' : 'vendor_quote' },
    evidenceClass: 'provider_recorded', providerEvidenceDigest: providerDigest,
    sourceUpdatedAt: new Date(Date.parse(occurredAt) + version * 60000).toISOString(),
  };
}

(async () => {
  let fixture;
  const ledger = { cases: [] };
  try {
    fixture = await createEstimateReviewFixture();
    const owner = fixture.actors.owner;
    const member = fixture.actors.member;
    const profile = canonicalFenceProfile();
    profile.company.timeZone = 'UTC';
    const estimates = [fixture.estimateGraphs[0].ids.estimate];

    for (let index = 1; index < 5; index += 1) {
      const key = crypto.randomUUID();
      const result = await ingestLead(fixture.runtimePool, {
        tenantContext: { organizationId: fixture.org, trusted: true },
        idempotencyKey: key,
        sourceVersion: 'm25-part11f-independent-v1',
        external: { customerId: key, callId: key, transcriptId: key, communicationId: key, appointmentId: key },
        customer: {
          name: `Calibration customer ${index + 1}`, phone: `+1555555020${index}`,
          email: `${key}@example.test`, address: { line1: `${index + 1} Sample Way`, city: 'Boston', state: 'MA', postalCode: '02108' },
        },
        transcript: [{ turnId: 'scope', speaker: 'customer', text: 'I need a 100-foot cedar fence.' }],
        facts: [{ variable: 'linearFeet', normalizedValue: 100, evidenceText: '100-foot', speaker: 'customer', evidenceTurnId: 'scope', confidence: 1 }],
        service: { key: 'fence', scope: { jobType: 'replace', linearFeet: 100, height: 6, material: 'cedar', removalRequired: true, gates: [{ type: 'walk' }], permitsRequired: true } },
        businessProfile: profile, businessProfileVersion: profile.version,
      });
      assert.equal(result.status, 201, JSON.stringify(result));
      estimates.push(result.body.ids.estimate);
    }

    const serviceRows = (await fixture.ownerPool.query(
      `SELECT e.id,lower(btrim(o.service_type)) service_key
       FROM canonical_estimates e JOIN canonical_opportunities o
       ON o.organization_id=e.organization_id AND o.id=e.opportunity_id
       WHERE e.organization_id=$1 AND e.id=ANY($2::uuid[]) ORDER BY e.id`,
      [fixture.org, estimates]
    )).rows;
    assert.equal(serviceRows.length, 5);
    assert.equal(new Set(serviceRows.map(row => row.service_key)).size, 1);
    const serviceKey = serviceRows[0].service_key;
    assert.match(serviceKey, /^[a-z0-9][a-z0-9._-]{1,63}$/);

    const plans = [];
    for (const estimate of estimates) {
      const estimateRoute = `/api/v1/canonical/estimates/${estimate}`;
      const getReview = async () => {
        const response = await request(fixture.app).get(estimateRoute + '/review').set(owner.session.headers);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        return response.body.data;
      };
      const postEstimate = (suffix, body) => request(fixture.app).post(estimateRoute + suffix)
        .set(owner.session.headers).set('Idempotency-Key', crypto.randomUUID()).send(body);
      let review = await getReview();
      let body = planHelpers.planBody(review, 'material', '20.00');
      for (let index = 0; index < body.inputs.lines.length; index += 1) {
        const line = body.inputs.lines[index];
        line.wastePercent = '20';
        line.evidence = {
          kind: 'supplier_quote', issuer: 'Cedar Supply', reference: `five-pair-quote-${index + 1}`,
          effectiveOn: '2026-09-01', validThrough: '2027-09-01', countryCode: 'US', region: 'NC', locality: 'Raleigh',
          serviceKey: review.materialSourceContext.serviceKey, materialSpecification: index ? 'support boards' : 'cedar boards',
          statedUnit: line.unit, statedCurrency: review.currency, statedUnitPrice: line.unitPrice,
          appliesToReviewedJob: true, exceptionReason: null,
        };
      }
      let response = await postEstimate('/material-plan-preview', body);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      planHelpers.acceptPlanPreview(body, response.body.data);
      response = await postEstimate('/material-plans', body);
      assert.equal(response.status, 201, JSON.stringify(response.body));
      review = await getReview();
      body = planHelpers.adoptionBody(review, 'material');
      response = await postEstimate('/cost-adoption-preview', body);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      body.assessment = response.body.data.assessment;
      response = await postEstimate('/cost-adoptions', body);
      assert.equal(response.status, 201, JSON.stringify(response.body));
      review = await getReview();
      const adopted = review.costComponents.material;
      const plan = review.materialPlans.history.find(value => value.id === adopted.id);
      assert.equal(plan.inputs.lines.length, 2);
      plans.push(plan);
    }

    const work = await fixture.createExecution({ useMigrationRoleForUpstreamSeed: true });
    const acceptTarget = async itemKey => {
      const normalized = contracts.normalizeMaterialAction({
        ...owner, executionId: work.execution.id, idempotencyKey: crypto.randomUUID(),
        body: {
          action: 'record', performerProfileId: member.actorUserId, movementKind: 'adjustment', itemKey,
          description: itemKey, quantity: '50', unitCode: 'ft', unitContractVersion: contracts.MATERIAL_UNIT_CONTRACT_VERSION,
          unitContractDigest: contracts.MATERIAL_UNIT_CONTRACT_DIGEST, locationKey: 'warehouse-main', adjustmentDirection: 'increase',
          expectedExecutionRevision: Number(work.execution.revision), expectedExecutionDigest: work.execution.digest,
          expectedAssignmentRevision: Number(work.assignment.revision), expectedAssignmentDigest: work.assignment.digest,
          reason: 'Create exact independent calibration target.',
        },
      });
      const recorded = (await operations.mutateMaterialInventory(fixture.ownerPool, {
        ...normalized, csrfToken: owner.csrfToken, requestCorrelationId: 'm25-part11f-target',
      })).body.data.material;
      const reviewAction = contracts.normalizeMaterialAction({
        ...owner, executionId: work.execution.id, idempotencyKey: crypto.randomUUID(),
        body: {
          action: 'review', performerProfileId: member.actorUserId, movementId: recorded.id,
          expectedMovementRevision: Number(recorded.revision), expectedMovementDigest: recorded.digest,
          reviewOutcome: 'accepted', unitContractVersion: contracts.MATERIAL_UNIT_CONTRACT_VERSION,
          unitContractDigest: contracts.MATERIAL_UNIT_CONTRACT_DIGEST,
          expectedExecutionRevision: Number(work.execution.revision), expectedExecutionDigest: work.execution.digest,
          expectedAssignmentRevision: Number(work.assignment.revision), expectedAssignmentDigest: work.assignment.digest,
          reason: 'Accept exact independent calibration target.',
        },
      });
      await operations.mutateMaterialInventory(fixture.ownerPool, {
        ...reviewAction, csrfToken: owner.csrfToken, requestCorrelationId: 'm25-part11f-target-review',
      });
    };
    await acceptTarget('cedar-boards');
    await acceptTarget('support-boards');

    const apiRoot = `/api/v1/learning/external-material-sources/${sourceKey}`;
    const post = (suffix, body, key = crypto.randomUUID(), actor = owner) => request(fixture.app).post(apiRoot + suffix)
      .set(actor.session.headers).set('X-CSRF-Token', actor.csrfToken).set('Idempotency-Key', key).send(body);
    let response = await post('/consent', {
      action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Use exact five-pair material evidence.',
      confirmed: true, confirmationVersion: 'm25-external-material-import-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const sourceConsent = response.body.data.consent;

    const ratios = [0.8, 0.9, 1, 1.1, 1.2, 1.3];
    const importedRecords = [];
    for (let jobIndex = 0; jobIndex < 6; jobIndex += 1) {
      const jobReference = jobIndex === 5 ? 'job-calibration-1-second' : `job-calibration-${jobIndex + 1}`;
      const ratio = ratios[jobIndex];
      const planIndex = jobIndex === 5 ? 0 : jobIndex;
      for (let lineIndex = 0; lineIndex < plans[planIndex].inputs.lines.length; lineIndex += 1) {
        const line = plans[planIndex].inputs.lines[lineIndex];
        const materialReference = lineIndex === 0 ? 'material-ext-cedar' : 'material-ext-support';
        const rawPlanned = Number(line.quantity);
        const planned = line.unit === 'ea' ? Math.ceil(rawPlanned * (1 + Number(line.wastePercent) / 100))
          : Math.ceil(rawPlanned * (1 + Number(line.wastePercent) / 100) * 1000000) / 1000000;
        const plannedWaste = planned - rawPlanned;
        importedRecords.push(externalRecord({ id: `${jobReference}-${lineIndex}-consumed`, type: 'inventory_movement', job: jobReference,
          material: materialReference, movementKind: 'consumed', quantity: exact(rawPlanned * ratio), unit: line.unit }));
        importedRecords.push(externalRecord({ id: `${jobReference}-${lineIndex}-waste`, type: 'inventory_movement', job: jobReference,
          material: materialReference, movementKind: 'waste', quantity: exact(plannedWaste * ratio), unit: line.unit }));
        importedRecords.push(externalRecord({ id: `${jobReference}-${lineIndex}-purchase`, type: 'purchase', job: jobReference,
          material: materialReference, vendor: 'vendor-ext-supply', quantity: exact(planned * ratio), unit: line.unit,
          amount: exact(planned * Number(line.unitPrice) * ratio), valuation: 'line_total' }));
        importedRecords.push(externalRecord({ id: `${jobReference}-${lineIndex}-unit-cost`, type: 'vendor_cost', job: jobReference,
          material: materialReference, vendor: 'vendor-ext-supply', quantity: '1', unit: line.unit,
          amount: exact(Number(line.unitPrice) * ratio), valuation: 'unit_cost' }));
      }
    }
    response = await post('/batches', {
      schemaVersion: 'm25-external-material-actual-v1', mode: 'historical_backfill',
      expectedConsentRevision: sourceConsent.revision, expectedConsentDigest: sourceConsent.digest,
      cursorBefore: null, cursorAfter: null, complete: true, records: importedRecords,
      reason: 'Import five complete paired job chains.', confirmed: true,
      confirmationVersion: 'm25-external-material-import-batch-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));

    const link = async (kind, externalReference, targetReference) => {
      const read = await request(fixture.app).get(apiRoot + '/matches').set(owner.session.headers);
      assert.equal(read.status, 200, JSON.stringify(read.body));
      const data = read.body.data;
      const ref = data.references.find(value => value.referenceKind === kind && value.externalReference === externalReference);
      const collection = { job: 'jobTargets', material: 'materialTargets', vendor: 'vendorTargets' }[kind];
      const target = data[collection].find(value => value.targetReference === targetReference);
      assert(ref && target, JSON.stringify({ kind, externalReference, targetReference }));
      const linked = await post('/matches', {
        action: 'link', referenceKind: kind, externalReference, targetReference,
        expectedRevision: ref.match ? ref.match.revision : 0, expectedDigest: ref.match ? ref.match.digest : 'none',
        expectedSourceDigest: ref.sourceDigest, expectedTargetDigest: target.digest,
        reason: 'Link exact five-pair calibration evidence.', confirmed: true,
        confirmationVersion: 'm25-external-material-reference-match-v1',
      });
      assert.equal(linked.status, 201, JSON.stringify(linked.body));
    };
    for (let index = 0; index < 5; index += 1) await link('job', `job-calibration-${index + 1}`, estimates[index]);
    await link('job', 'job-calibration-1-second', estimates[0]);
    await link('material', 'material-ext-cedar', 'cedar-boards');
    await link('material', 'material-ext-support', 'support-boards');
    await link('vendor', 'vendor-ext-supply', 'Cedar Supply');

    response = await post('/imported-material-quantity-consent', {
      action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Use exact paired quantity outcomes.',
      confirmed: true, confirmationVersion: 'm25-imported-material-quantity-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const quantityConsent = response.body.data.consent;
    response = await post('/imported-material-cost-consent', {
      action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Use exact paired cost outcomes.',
      confirmed: true, confirmationVersion: 'm25-imported-material-cost-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const costConsent = response.body.data.consent;

    const observePair = async index => {
      const planIndex = index === 5 ? 0 : index;
      const estimate = estimates[planIndex];
      const jobReference = index === 5 ? 'job-calibration-1-second' : `job-calibration-${index + 1}`;
      const quantityBindings = plans[planIndex].inputs.lines.map((line, lineIndex) => ({
        lineId: line.lineId, externalMaterialReference: lineIndex === 0 ? 'material-ext-cedar' : 'material-ext-support',
      }));
      response = await post(`/estimates/${estimate}/imported-material-quantity-outcomes`, {
        externalJobReference: jobReference, expectedConsentRevision: quantityConsent.revision,
        expectedConsentDigest: quantityConsent.digest, bindings: quantityBindings,
        reason: 'Record one complete fresh quantity observation.', confirmed: true,
        confirmationVersion: 'm25-imported-material-quantity-observation-v1',
      });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      assert.equal(response.body.data.observation.result.comparedLineCount, 2);
      const costBindings = plans[planIndex].inputs.lines.map((line, lineIndex) => ({
        lineId: line.lineId, externalMaterialReference: lineIndex === 0 ? 'material-ext-cedar' : 'material-ext-support',
        externalVendorReference: 'vendor-ext-supply', externalInventoryLocationReference: null,
      }));
      response = await post(`/estimates/${estimate}/imported-material-cost-observations`, {
        externalJobReference: jobReference, expectedConsentRevision: costConsent.revision,
        expectedConsentDigest: costConsent.digest, bindings: costBindings,
        reason: 'Record one complete fresh cost observation.', confirmed: true,
        confirmationVersion: 'm25-imported-material-cost-observation-v1',
      });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      for (const line of response.body.data.observation.result.lines) {
        assert.equal(line.unitCost.status, 'compared');
        assert.equal(line.purchasing.quantity.status, 'compared');
        assert.equal(line.purchasing.lineTotal.status, 'recorded');
      }
    };
    for (let index = 0; index < 5; index += 1) await observePair(index);
    ledger.cases.push('Five canonical estimates and external jobs have complete fresh mounted Slice D and E observation pairs.');

    response = await post('/imported-material-calibration-consent', {
      action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Calibrate five complete paired jobs.',
      confirmed: true, confirmationVersion: 'm25-imported-material-calibration-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const calibrationConsent = response.body.data.consent;
    const proposalBody = {
      expectedConsentRevision: calibrationConsent.revision, expectedConsentDigest: calibrationConsent.digest,
      reason: 'Review the independently constructed five-job sample.', confirmed: true,
      confirmationVersion: 'm25-imported-material-calibration-proposal-v1',
    };
    const proposalKey = crypto.randomUUID();
    const concurrent = await Promise.all([
      post(`/imported-material-calibrations/${serviceKey}`, proposalBody, proposalKey),
      post(`/imported-material-calibrations/${serviceKey}`, proposalBody, proposalKey),
    ]);
    assert.deepEqual(concurrent.map(value => value.status).sort(), [200, 201], JSON.stringify(concurrent.map(value => value.body)));
    const fiveProposal = concurrent.find(value => value.status === 201).body.data.proposal;
    assert.equal(fiveProposal.sampleSize, 5);
    assert.equal(fiveProposal.sampleManifest.observations.length, 5);
    for (const key of ['totalUse','waste','unitCost','purchaseQuantity','purchaseCost']) {
      const metric = fiveProposal.metrics[key];
      assert.equal(metric.status, 'compared', JSON.stringify(metric));
      assert.equal(metric.sampleSize, 5);
      assert.equal(metric.medianActualToPlannedRatio, '1.0000');
      assert.equal(metric.lowerQuartileRatio, '0.9000');
      assert.equal(metric.upperQuartileRatio, '1.1000');
      assert.equal(metric.proposedMultiplier, '1.0000');
      assert.equal(metric.advisoryAvailable, true);
    }
    assert.equal(JSON.stringify(fiveProposal).includes('recordedBalance'), false);
    assert.equal(JSON.stringify(fiveProposal).includes('reviewedTarget'), false);
    ledger.cases.push('The real five-pair proposal gives every job equal weight and returns deterministic raw quartiles plus bounded advice for all five dimensions, without vendor or balance calibration.');

    const replay = await post(`/imported-material-calibrations/${serviceKey}`, proposalBody, proposalKey);
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.data.replayed, true);
    assert.equal(replay.body.data.proposal.digest, fiveProposal.digest);
    assert.equal((await post(`/imported-material-calibrations/${serviceKey}`, { ...proposalBody, reason: 'Conflicting replay body.' }, proposalKey)).status, 409);

    await observePair(5);
    const staleFive = await request(fixture.app).get(apiRoot + `/imported-material-calibrations/${serviceKey}`).set(owner.session.headers);
    assert.equal(staleFive.status, 200, JSON.stringify(staleFive.body));
    assert.equal(staleFive.body.data.current.fresh, false);
    const sixBody = { ...proposalBody, reason: 'Review all six exact estimate and imported-job pairs.' };
    const sixKey = crypto.randomUUID();
    response = await post(`/imported-material-calibrations/${serviceKey}`, sixBody, sixKey);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const sixProposal = response.body.data.proposal;
    ledger.pairKey = {
      completeCurrentPairsCreated: 6,
      proposalSampleSize: sixProposal.sampleSize,
      sampledExternalJobs: sixProposal.sampleManifest.observations.map(value => value.externalJobReference),
    };
    assert.equal(sixProposal.sampleSize, 6, 'Each current estimate/external-job pair must remain a distinct equal-weight job.');
    assert.equal(sixProposal.sampleManifest.observations.length, 6);
    assert.equal(new Set(sixProposal.sampleManifest.observations.map(value => value.estimateId)).size, 5);
    assert.equal(new Set(sixProposal.sampleManifest.observations.map(value => value.externalJobReference)).size, 6);
    for (const key of ['totalUse','waste','unitCost','purchaseQuantity','purchaseCost']) {
      const metric = sixProposal.metrics[key];
      assert.equal(metric.status, 'compared', JSON.stringify(metric));
      assert.equal(metric.sampleSize, 6);
      assert.equal(metric.medianActualToPlannedRatio, '1.0500');
      assert.equal(metric.lowerQuartileRatio, '0.9250');
      assert.equal(metric.upperQuartileRatio, '1.1750');
      assert.equal(metric.proposedMultiplier, '1.0500');
      assert.equal(metric.advisoryAvailable, true);
    }
    const sixReplay = await post(`/imported-material-calibrations/${serviceKey}`, sixBody, sixKey);
    assert.equal(sixReplay.status, 200, JSON.stringify(sixReplay.body));
    assert.equal(sixReplay.body.data.replayed, true);
    assert.equal(sixReplay.body.data.proposal.digest, sixProposal.digest);
    assert.equal((await post(`/imported-material-calibrations/${serviceKey}`, { ...sixBody, reason: 'Conflicting six-pair replay.' }, sixKey)).status, 409);
    ledger.cases.push('A sixth imported job linked to an already sampled estimate remains a sixth equal-weight pair and deterministically changes all five robust summaries.');

    const before = (await fixture.ownerPool.query(
      'SELECT (SELECT count(*) FROM canonical_material_plans) plans,(SELECT count(*) FROM canonical_external_material_import_records) imported_records'
    )).rows[0];
    const corrected = externalRecord({
      id: 'job-calibration-1-0-unit-cost', type: 'vendor_cost', job: 'job-calibration-1', material: 'material-ext-cedar',
      vendor: 'vendor-ext-supply', quantity: '1', unit: plans[0].inputs.lines[0].unit,
      amount: exact(Number(plans[0].inputs.lines[0].unitPrice) * 0.85), valuation: 'unit_cost', version: 2,
    });
    response = await post('/batches', {
      schemaVersion: 'm25-external-material-actual-v1', mode: 'continuous_update',
      expectedConsentRevision: sourceConsent.revision, expectedConsentDigest: sourceConsent.digest,
      cursorBefore: null, cursorAfter: 'five-pair-correction', complete: false, records: [corrected],
      reason: 'Correct one source chain to stale the proposal.', confirmed: true,
      confirmationVersion: 'm25-external-material-import-batch-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    let read = await request(fixture.app).get(apiRoot + `/imported-material-calibrations/${serviceKey}`).set(owner.session.headers);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.equal(read.body.data.current.fresh, false);
    assert.equal(read.body.data.current.advisoryAvailable, false);
    for (const metric of Object.values(read.body.data.current.metrics)) {
      assert.equal(metric.advisoryAvailable, false);
      assert.equal(metric.proposedMultiplier, null);
    }
    const other = await request(fixture.app).get(apiRoot + `/imported-material-calibrations/${serviceKey}`).set(fixture.actors.otherOwner.session.headers);
    assert.equal(other.status, 200);
    assert.equal(other.body.data.activeConsent, false);
    const after = (await fixture.ownerPool.query(
      'SELECT (SELECT count(*) FROM canonical_material_plans) plans,(SELECT count(*) FROM canonical_external_material_import_records) imported_records'
    )).rows[0];
    assert.equal(after.plans, before.plans);
    assert.equal(Number(after.imported_records), Number(before.imported_records) + 1);
    ledger.cases.push('A source correction masks every prior multiplier, tenant isolation holds, and calibration mutates no operational plan.');

    response = await post('/consent', {
      action: 'revoke', expectedRevision: sourceConsent.revision, expectedDigest: sourceConsent.digest,
      reason: 'Stop source use after calibration.', confirmed: true, confirmationVersion: 'm25-external-material-import-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const revokedSource = response.body.data.consent;
    read = await request(fixture.app).get(apiRoot + `/imported-material-calibrations/${serviceKey}`).set(owner.session.headers);
    assert.equal(read.body.data.activeConsent, false); assert.equal(read.body.data.current, null); assert.deepEqual(read.body.data.history, []);
    response = await post('/consent', {
      action: 'grant', expectedRevision: revokedSource.revision, expectedDigest: revokedSource.digest,
      reason: 'Start a new source permission period.', confirmed: true, confirmationVersion: 'm25-external-material-import-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const renewedSource = response.body.data.consent;
    response = await post('/imported-material-quantity-consent', {
      action: 'grant', expectedRevision: quantityConsent.revision, expectedDigest: quantityConsent.digest,
      reason: 'Renew quantity consent for the new source period.', confirmed: true,
      confirmationVersion: 'm25-imported-material-quantity-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const renewedQuantity = response.body.data.consent;
    response = await post('/imported-material-cost-consent', {
      action: 'grant', expectedRevision: costConsent.revision, expectedDigest: costConsent.digest,
      reason: 'Renew cost consent for the new source period.', confirmed: true,
      confirmationVersion: 'm25-imported-material-cost-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const renewedCost = response.body.data.consent;
    assert.equal(renewedQuantity.sourceConsent.id, renewedSource.id);
    assert.equal(renewedCost.sourceConsent.id, renewedSource.id);
    read = await request(fixture.app).get(apiRoot + `/imported-material-calibrations/${serviceKey}`).set(owner.session.headers);
    assert.equal(read.body.data.activeConsent, false); assert.equal(read.body.data.current, null); assert.deepEqual(read.body.data.history, []);
    response = await post('/imported-material-calibration-consent', {
      action: 'grant', expectedRevision: calibrationConsent.revision, expectedDigest: calibrationConsent.digest,
      reason: 'Renew calibration consent without reviving prior proposals.', confirmed: true,
      confirmationVersion: 'm25-imported-material-calibration-consent-v1',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    read = await request(fixture.app).get(apiRoot + `/imported-material-calibrations/${serviceKey}`).set(owner.session.headers);
    assert.equal(read.body.data.activeConsent, true); assert.equal(read.body.data.current.hiddenByConsent, true);
    assert.equal(Object.hasOwn(read.body.data.current, 'metrics'), false);
    assert.equal((await post(`/imported-material-calibrations/${serviceKey}`, sixBody, crypto.randomUUID(), member)).status, 403);
    await assert.rejects(fixture.ownerPool.query('DELETE FROM canonical_external_material_calibration_proposals'));
    ledger.cases.push('Source revocation and a new source period hide all prior proposals; renewing every consent cannot revive their metrics, and ACL plus immutability remain enforced.');
    ledger.pass = true;
  } catch (error) {
    const source = error.cause || error;
    ledger.error = error.stack;
    ledger.cause = { message: source.message, code: source.code, constraint: source.constraint, detail: source.detail, where: source.where };
    process.exitCode = 1;
  } finally {
    if (fixture) await fixture.cleanup();
    fs.writeFileSync(output, JSON.stringify(ledger, null, 2));
    console.log(JSON.stringify(ledger));
  }
})();
