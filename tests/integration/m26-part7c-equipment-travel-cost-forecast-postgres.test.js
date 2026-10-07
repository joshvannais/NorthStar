'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { Client } = require('pg');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const commercial = require('../../src/estimating/commercialContract');
const equipment = require('../helpers/m24-equipment-input');
const equipmentCost = require('../helpers/m24-equipment-cost-input');
const travelInput = require('../helpers/m24-travel-input');
const travelComposition = require('../../src/estimating/travelCostComposition');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();

realPostgres('Mission 26 original Part 7C mounted equipment-and-travel forecast', () => {
  let fixture;
  let cutoff;
  let equipmentCostInputs;
  let travelPlanInputs;
  let appointment;

  async function seedCurrentBookedEquipmentTravelPlan() {
    const actor = fixture.actors.owner;
    const estimate = fixture.estimateGraphs[0].ids.estimate;
    appointment = fixture.estimateGraphs[0].ids.appointment;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(fixture.app).get(route + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(fixture.app).post(route + suffix)
      .set(actor.session.headers).set('Idempotency-Key', uuid()).send(body);
    const day = cutoff.toISOString().slice(0, 10);
    const validThrough = new Date(cutoff.getTime() + 40 * 86400000).toISOString().slice(0, 10);
    const profile = require('../helpers/m19-part3-business-profile').canonicalFenceProfile();
    profile.company.timeZone = 'UTC';
    profile.headquarters = { street: '1 Synthetic Office Way', city: 'Boston',
      state: 'MA', zip: '02108', country: 'US' };
    await require('../../src/services/organizationAuthority').putBusinessProfile(
      fixture.ownerPool, { organizationId: fixture.org,
        userId: fixture.actors.owner.actorUserId,
        expectedVersion: 'org-profile-v2', profile });

    let review = (await get('/review')).body.data;
    const equipmentPlan = {
      action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: equipment.inputs(), currency: review.currency,
      reason: 'Part 7C current equipment basis proof', confirmed: true,
      confirmationVersion: 'estimate-equipment-plan-v1',
    };
    let preview = await post('/equipment-plan-preview', equipmentPlan);
    expect(preview.status).toBe(200);
    equipmentPlan.inputs.assessment = { ...preview.body.data.assessment, acknowledged: true };
    expect((await post('/equipment-plans', equipmentPlan)).status).toBe(201);

    review = (await get('/review')).body.data;
    const equipmentCostPlan = equipmentCost.body(review);
    for (const [index, line] of equipmentCostPlan.inputs.lines.entries()) {
      Object.assign(line.source, { kind: 'company_reference', issuer: 'Fixture Fleet',
        reference: `EQ-7C-${index + 1}`, note: 'Current authenticated owner equipment record.',
        effectiveOn: day, endsOn: validThrough, geography: 'Fixture service area' });
    }
    preview = await post('/equipment-cost-preview', equipmentCostPlan);
    expect(preview.status).toBe(200);
    equipmentCostPlan.inputs.assessment = { ...preview.body.data.assessment,
      acknowledged: true, explanation: '' };
    expect((await post('/equipment-cost-plans', equipmentCostPlan)).status).toBe(201);
    review = (await get('/review')).body.data;
    const currentEquipment = review.equipmentCostPlans.current;
    const equipmentAdoption = { sourcePins: review.pins, expectedPlanId: currentEquipment.id,
      expectedPlanRevision: currentEquipment.revision, expectedPlanDigest: currentEquipment.digest,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      reason: 'Apply the current Part 7C equipment plan.', confirmed: true,
      confirmationVersion: 'estimate-cost-adoption-v2', changedComponent: 'equipment',
      expectedComponents: review.equipmentCostComponents, assessment: {} };
    preview = await post('/cost-adoption-preview', equipmentAdoption);
    expect(preview.status).toBe(200);
    equipmentAdoption.assessment = preview.body.data.assessment;
    expect((await post('/cost-adoptions', equipmentAdoption)).status).toBe(201);

    review = (await get('/review')).body.data;
    const travelPlan = { action: 'save', expectedRevision: 0, expectedDigest: 'none',
      sourcePins: review.pins, expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: travelInput.fixture(), currency: review.currency,
      reason: 'Part 7C current travel basis proof', confirmed: true,
      confirmationVersion: 'estimate-travel-plan-v1' };
    travelPlan.inputs.serviceKey = review.travelPlans.serviceKey;
    const sourceLocations = review.travelPlans.sources.locations.filter(location =>
      location.kind !== 'declared');
    expect(sourceLocations.length).toBeGreaterThanOrEqual(1);
    travelPlan.inputs.trips[0].origin = structuredClone(
      sourceLocations.find(location => location.kind === 'business_location') || sourceLocations[0]);
    travelPlan.inputs.trips[0].destination = structuredClone(
      sourceLocations.find(location => location.kind === 'recorded_job') || sourceLocations[0]);
    for (const line of [...travelPlan.inputs.trips, ...travelPlan.inputs.logistics]) {
      Object.assign(line.source, { kind: 'company_reference', issuer: 'Fixture Fleet',
        reference: `TR-7C-${line.lineId}`, note: 'Current authenticated owner travel record.',
        effectiveOn: day, endsOn: validThrough, geography: 'Fixture service area' });
    }
    preview = await post('/travel-plan-preview', travelPlan);
    expect(preview.status).toBe(200);
    travelPlan.inputs.assessment = { ...preview.body.data.assessment,
      acknowledged: true, explanation: '' };
    expect((await post('/travel-plans', travelPlan)).status).toBe(201);
    review = (await get('/review')).body.data;
    const currentTravel = review.travelPlans.current;
    const equipmentLineId = review.adoptedEquipmentCostPlan.inputs.lines[0].lineId;
    const travelLineId = currentTravel.inputs.trips[0].lineId;
    const travelAdoption = { sourcePins: review.pins, expectedPlanId: currentTravel.id,
      expectedPlanRevision: currentTravel.revision, expectedPlanDigest: currentTravel.digest,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      reason: 'Apply the current Part 7C travel plan with exact reviewed overlap.',
      confirmed: true, confirmationVersion: travelComposition.VERSION,
      changedComponent: 'travel', expectedComponents: review.travelCostComponents,
      assessment: {}, coverage: {
        componentManifest: travelComposition.manifest({
          equipment: review.adoptedEquipmentCostPlan, travel: currentTravel }),
        overlaps: [{ travelLineId, category: 'vehicle', component: 'equipment',
          sourceLineId: equipmentLineId, amount: '10.00',
          reason: 'This exact vehicle amount is already included in the adopted equipment cost.' }],
        equipmentOutside: [], travelOutside: [], confirmed: true,
        reason: 'Review the exact adopted v3 equipment and travel allocation once.' } };
    preview = await post('/cost-adoption-preview', travelAdoption);
    expect(preview.status).toBe(200);
    travelAdoption.assessment = preview.body.data.assessment;
    expect((await post('/cost-adoptions', travelAdoption)).status).toBe(201);
    equipmentCostInputs = equipmentCostPlan.inputs;
    travelPlanInputs = travelPlan.inputs;

    review = (await get('/review')).body.data;
    const pricing = review.pricingPlans;
    expect((await post('/pricing-plans', {
      action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: pricingFixture(pricing.serviceKey), currency: review.currency,
      reason: 'Part 7C current booked-work pricing proof', confirmed: true,
      confirmationVersion: pricing.contract, evidenceDigest: pricing.sources.digest,
    })).status).toBe(201);

    review = (await get('/review')).body.data;
    const terms = review.commercialTerms;
    const inputs = commercialFixture().value;
    inputs.version = terms.contract;
    inputs.jobApplicability = { serviceOperation: 'fence_installation',
      propertyUse: 'residential', workContext: 'new_construction',
      customerExemption: 'none', evidenceRef: { serviceOperation: 'Reviewed scope',
        propertyUse: 'Recorded property', workContext: 'Reviewed scope',
        customerExemption: 'Customer statement' } };
    inputs.transactionDate = terms.sources.asOfDate;
    inputs.taxGroups = [group(['installation'])];
    inputs.taxGroups[0].source.serviceKey = terms.sources.serviceKey;
    Object.assign(inputs.taxGroups[0].source, {
      legalEffectiveOn: inputs.taxGroups[0].source.effectiveOn, legalEndsOn: null,
      reviewedOn: terms.sources.asOfDate, reviewValidThrough: terms.sources.asOfDate,
    });
    delete inputs.taxGroups[0].source.effectiveOn;
    delete inputs.taxGroups[0].source.endsOn;
    expect((await post('/commercial-terms', {
      action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: terms.decisionBasis.revision,
      expectedDecisionDigest: terms.decisionBasis.digest, inputs,
      currency: review.currency, reason: 'Part 7C current commercial terms proof',
      confirmed: true, confirmationVersion: terms.contract,
      evidenceDigest: terms.sources.digest,
    })).status).toBe(201);
    review = (await get('/review')).body.data;
    const currentTerms = review.commercialTerms;
    expect((await post('/commercial-approvals', {
      termsPin: commercial.pin(currentTerms.current), evidenceDigest: currentTerms.sources.digest,
      expectedDecisionRevision: currentTerms.decisionBasis.revision,
      expectedDecisionDigest: currentTerms.decisionBasis.digest,
      scopeSummary: 'Install the recorded cedar fence and complete reviewed work.',
      reason: 'Part 7C current commercial approval proof', confirmed: true,
      confirmationVersion: currentTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true },
    })).status).toBe(201);
    const issued = await post('/customer-estimate-versions', {
      reason: 'Part 7C issued estimate proof', confirmed: true,
      confirmationVersion: 'customer-estimate-issue-v1',
    });
    expect(issued.status).toBe(201);
    const link = await post('/customer-estimate-links', {
      versionId: issued.body.data.receipt.id, expiresInDays: 14,
      confirmed: true, confirmationVersion: 'customer-estimate-delivery-v1',
    });
    expect(link.status).toBe(201);
    const token = decodeURIComponent(link.body.data.urlPath.split('/').pop());
    expect((await request(fixture.app).post(`/api/public/customer-estimates/${token}/accept`)
      .set({ Host: 'localhost', Origin: 'http://localhost' })
      .set('Idempotency-Key', uuid()).send({ customerName: 'Part 7C Customer',
        confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' })).status).toBe(201);

    const assignment = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,appointment_status,
        scheduled_start,scheduled_end
       FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2`,
      [fixture.org, appointment])).rows[0];
    const reason = 'Schedule the exact accepted Part 7C booked job.';
    const schedulePreview = await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
      .set(actor.session.headers).send({ expectedRevision: Number(assignment.revision),
        expectedDigest: assignment.digest, expectedTimeZone: 'UTC', action: 'assign',
        target: { kind: 'profile', id: fixture.actors.member.actorUserId },
        scheduledStart: assignment.scheduled_start.toISOString(),
        scheduledEnd: assignment.scheduled_end.toISOString(),
        appointmentStatus: assignment.appointment_status, reason });
    if (schedulePreview.status !== 201) throw new Error(JSON.stringify(schedulePreview.body));
    expect((await request(fixture.app)
      .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
      .set(actor.session.headers).set('Idempotency-Key', uuid()).send({
        previewId: schedulePreview.body.data.id,
        previewDigest: schedulePreview.body.data.previewDigest,
        acknowledgedWarningDigests: schedulePreview.body.data.warningDigests,
        acknowledgedReviewReasonDigests: schedulePreview.body.data.reviewReasonDigests, reason,
      })).status).toBe(200);
    const approval = (await fixture.ownerPool.query(
      `SELECT id FROM canonical_schedule_human_approvals
       WHERE organization_id=$1 AND appointment_id=$2
       ORDER BY approved_at DESC,id DESC LIMIT 1`, [fixture.org, appointment])).rows[0].id;
    const booking = await request(fixture.app).post('/api/v1/forecast/booking-reviews/first')
      .set(actor.session.headers).set('Idempotency-Key', uuid())
      .send({ approvalId: approval, reason: 'Review the Part 7C accepted scheduled job.' });
    expect(booking.status).toBe(201);
    expect((await request(fixture.app)
      .post(`/api/v1/forecast/booking-reviews/${booking.body.data.reviewId}/confirm-booked`)
      .set(actor.session.headers).set('Idempotency-Key', uuid()).send({
        reason: 'Confirm the Part 7C accepted scheduled job is booked.',
        confirmed: true, confirmationVersion: 'owner-booked-work-confirm-v1',
      })).status).toBe(201);
  }

  beforeAll(async () => {
    const fixtureNow = new Date();
    fixture = await createEstimateReviewFixture({ operationalSchedule: true,
      scheduledAppointment: {
        start: new Date(fixtureNow.getTime() + 86400000).toISOString(),
        end: new Date(fixtureNow.getTime() + 90000000).toISOString(),
        status: 'scheduled',
      } });
    await fixture.ownerPool.query("SET northstar.m26_part5a_disposable_clock='enabled'");
    cutoff = new Date((await fixture.ownerPool.query(
      "SELECT date_trunc('second',clock_timestamp()) value")).rows[0].value);
    await fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [cutoff]);
    await seedCurrentBookedEquipmentTravelPlan();
  }, 180000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('issues one bounded current forecast from current booking, exact v3 allocation and source coverage', async () => {
    const response = await request(fixture.app)
      .get('/api/v1/forecast/equipment-travel-cost/current')
      .set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data).toMatchObject({
      state: 'current', currency: 'USD', fictional: false,
      work: { state: 'current', scheduledCount: 1, unscheduledCount: 0,
        outsideWindowCount: 0 },
      plannedEquipmentTravel: { state: 'current', coveredCount: 1,
        equipmentLineCount: 1, tripCount: 1, logisticsLineCount: 1,
        equipmentCost: '160.00', grossTravelCost: '109.00',
        overlapDeduction: '10.00', netTravelCost: '99.00',
        combinedCost: '259.00', reason: null },
      allocation: { state: 'reviewed_v3_allocation', v3AllocationReviewed: true,
        crossForecastLaborOverlapReviewed: true },
      operations: { state: 'plan_cost_only', futureUtilizationVerified: false,
        assetReadinessVerified: false, maintenanceScheduleVerified: false,
        downtimeCostVerified: false, ownershipOrFinancingBasisVerified: false,
        providerAuthenticated: false },
      learnedOutcomes: { state: 'none_current', applicableServiceCount: 0, applied: false },
      forecastIssued: true, completeOperatingCostForecastIssued: false,
      downtimeForecastIssued: false, calibratedRangeIssued: false,
      probabilityIssued: false, automaticActionAuthorized: false,
    });
  });

  test('keeps exact current source assessment independent of the database session time zone', async () => {
    const results = [];
    const client = await fixture.ownerPool.connect();
    try {
      for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
        await client.query('BEGIN');
        await client.query("SELECT set_config('TimeZone',$1,TRUE)", [zone]);
        results.push((await client.query(
          `SELECT jsonb_build_object(
            'equipment',canonical_equipment_cost_source_assess($1::jsonb,$3::date),
            'travel',canonical_travel_plan_assess($2::jsonb,$3::date)) value`,
          [equipmentCostInputs, travelPlanInputs,
            new Date(cutoff.getTime() + 29 * 86400000).toISOString().slice(0, 10)])).rows[0].value);
        await client.query('ROLLBACK');
      }
    } finally { client.release(); }
    expect(results).toEqual([results[0], results[0], results[0]]);
    expect(results[0]).toMatchObject({ equipment: { cautions: [] }, travel: { cautions: [] } });
  });

  test('fails closed when an owner-recorded travel source no longer covers the horizon', async () => {
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE canonical_travel_plans DISABLE TRIGGER USER');
      await client.query(
        `UPDATE canonical_travel_plans SET inputs=jsonb_set(
          inputs,'{trips,0,source,endsOn}',to_jsonb($3::text),false)
         WHERE organization_id=$1 AND estimate_id=$2 AND action='save'`,
        [fixture.org, fixture.estimateGraphs[0].ids.estimate,
          new Date(cutoff.getTime() + 86400000).toISOString().slice(0, 10)]);
      const value = (await client.query(
        'SELECT canonical_forecast_equipment_travel_cost_v1_current($1,$2,$3,$4) value',
        [fixture.org, fixture.actors.owner.actorUserId,
          fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId])).rows[0].value;
      expect(value).toMatchObject({ state: 'unavailable',
        reason: 'current_equipment_travel_source_unavailable', forecastIssued: false });
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });

  test('withholds amounts when scheduled work crosses the exact forecast boundary', async () => {
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE canonical_schedule_assignments DISABLE TRIGGER USER');
      await client.query(
        `UPDATE canonical_schedule_assignments
         SET scheduled_start=$3,scheduled_end=$4
         WHERE organization_id=$1 AND appointment_id=$2`,
        [fixture.org, appointment, new Date(cutoff.getTime() - 3600000),
          new Date(cutoff.getTime() + 3600000)]);
      const value = (await client.query(
        'SELECT canonical_forecast_equipment_travel_cost_v1_current($1,$2,$3,$4) value',
        [fixture.org, fixture.actors.owner.actorUserId,
          fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId])).rows[0].value;
      expect(value).toMatchObject({ state: 'unavailable',
        reason: 'period_attribution_unavailable', forecastIssued: false });
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });

  test('fails closed when an applicable learned equipment value cannot be proven compatible', async () => {
    const sourceRegistryId = uuid();
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.username = 'postgres'; databaseUrl.password = '';
    const client = new Client({ connectionString: databaseUrl.toString() });
    await client.connect();
    try {
      const serviceKey = (await client.query(
        `SELECT snapshot#>>'{service,key}' service_key
         FROM canonical_polaris_snapshots
         WHERE organization_id=$1 AND estimate_id=$2
         ORDER BY created_at DESC,id DESC LIMIT 1`,
        [fixture.org, fixture.estimateGraphs[0].ids.estimate])).rows[0].service_key;
      const effectiveDigest = (await client.query(
        `SELECT canonical_completion_digest(jsonb_build_object(
         'state','active','multiplier','1.100000','sourceRegistryId',$1::uuid,
         'sourceRegistryDigest',$2::text,'sourcePreviewDigest',$3::text,
         'sourceSelectionDigest',$4::text)) digest`,
        [sourceRegistryId, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)])).rows[0].digest;
      await client.query("SET session_replication_role='replica'");
      await client.query(
        `INSERT INTO canonical_job_outcome_planning_value_versions(
         id,organization_id,service_key,planning_area,metric_key,basis,revision,
         previous_id,action,value_state,multiplier,source_registry_id,
         source_registry_digest,source_preview_digest,source_selection_digest,
         rollback_to_id,rollback_to_digest,effective_digest,actor_user_id,membership_id,
         auth_session_id,reason,confirmed,confirmation_version,request_key_hash,
         request_digest,canonical_digest)
         VALUES($1,$2,$3,'equipment_planning','planned_cost','NorthStar equipment cost',
          1,NULL,'adopt','active',1.1,$4,$5,$6,$7,NULL,NULL,$8,$9,$9,$10,
          'Bounded learned equipment fixture value',TRUE,
          'm25-job-outcome-planning-adoption-v1',$11,$12,$13)`,
        [uuid(), fixture.org, serviceKey, sourceRegistryId, 'a'.repeat(64),
          'b'.repeat(64), 'c'.repeat(64), effectiveDigest,
          fixture.actors.owner.actorUserId, fixture.actors.owner.authSessionId,
          'd'.repeat(64), 'e'.repeat(64),
          'f'.repeat(64)]);
    } finally {
      await client.query("SET session_replication_role='origin'").catch(() => {});
      await client.end();
    }
    const response = await request(fixture.app)
      .get('/api/v1/forecast/equipment-travel-cost/current')
      .set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ state: 'unavailable',
      reason: 'learned_adjustment_compatibility_unverified',
      forecastIssued: false, probabilityIssued: false });
  });

  test('keeps tenant and access-role boundaries server-side', async () => {
    expect((await request(fixture.app).get('/api/v1/forecast/equipment-travel-cost/current')
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const other = await request(fixture.app).get('/api/v1/forecast/equipment-travel-cost/current')
      .set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200);
    expect(other.body.data).toMatchObject({ state: 'current',
      work: { scheduledCount: 0 }, plannedEquipmentTravel: { combinedCost: '0.00' },
      forecastIssued: true });
  });
});
