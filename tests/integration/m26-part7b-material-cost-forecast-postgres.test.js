'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const commercial = require('../../src/estimating/commercialContract');
const costComposition = require('../helpers/m24-cost-composition-input');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');
const { fixture: pricingFixture } = require('../helpers/m24-pricing-input');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();

realPostgres('Mission 26 original Part 7B mounted material-cost forecast', () => {
  let fixture;
  let cutoff;
  let planInputs;
  let appointment;

  async function seedCurrentBookedMaterialPlan() {
    const actor = fixture.actors.owner;
    const estimate = fixture.estimateGraphs[0].ids.estimate;
    appointment = fixture.estimateGraphs[0].ids.appointment;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(fixture.app).get(route + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(fixture.app).post(route + suffix)
      .set(actor.session.headers).set('Idempotency-Key', uuid()).send(body);
    const day = cutoff.toISOString().slice(0, 10);
    const validThrough = new Date(cutoff.getTime() + 40 * 86400000).toISOString().slice(0, 10);

    let review = (await get('/review')).body.data;
    const materialPlan = costComposition.planBody(review, 'material', '60.00');
    for (const [index, line] of materialPlan.inputs.lines.entries()) {
      line.wastePercent = index === 0 ? '10' : '20';
      line.priceDate = day;
      Object.assign(line.evidence, { kind: 'supplier_quote', issuer: 'Fixture Supply',
        reference: `Q-7B-${index + 1}`, effectiveOn: day, validThrough,
        countryCode: 'US', region: 'MA', serviceKey: review.materialSourceContext.serviceKey,
        materialSpecification: line.material, statedUnit: line.unit,
        statedCurrency: review.currency, statedUnitPrice: line.unitPrice,
        appliesToReviewedJob: true, exceptionReason: null });
      Object.assign(line.availability, { kind: 'supplier_statement', issuer: 'Fixture Supply',
        reference: `A-7B-${index + 1}`, observedOn: day, validThrough,
        location: 'Fixture yard', availableQuantity: '10', statedUnit: line.unit,
        leadTimeDays: 1, appliesToReviewedJob: true, exceptionReason: null });
    }
    const preview = await post('/material-plan-preview', materialPlan);
    expect(preview.status).toBe(200);
    costComposition.acceptPlanPreview(materialPlan, preview.body.data);
    expect((await post('/material-plans', materialPlan)).status).toBe(201);
    review = (await get('/review')).body.data;
    const adoption = costComposition.adoptionBody(review, 'material');
    const adoptionPreview = await post('/cost-adoption-preview', adoption);
    expect(adoptionPreview.status).toBe(200);
    adoption.assessment = adoptionPreview.body.data.assessment;
    expect((await post('/cost-adoptions', adoption)).status).toBe(201);
    planInputs = materialPlan.inputs;

    review = (await get('/review')).body.data;
    const pricing = review.pricingPlans;
    expect((await post('/pricing-plans', {
      action: 'save', expectedRevision: 0, expectedDigest: 'none', sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest,
      inputs: pricingFixture(pricing.serviceKey), currency: review.currency,
      reason: 'Part 7B current booked-work pricing proof', confirmed: true,
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
      currency: review.currency, reason: 'Part 7B current commercial terms proof',
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
      reason: 'Part 7B current commercial approval proof', confirmed: true,
      confirmationVersion: currentTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true },
    })).status).toBe(201);
    const issued = await post('/customer-estimate-versions', {
      reason: 'Part 7B issued estimate proof', confirmed: true,
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
      .set('Idempotency-Key', uuid()).send({ customerName: 'Part 7B Customer',
        confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' })).status).toBe(201);

    const assignment = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,appointment_status,
        scheduled_start,scheduled_end
       FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2`,
      [fixture.org, appointment])).rows[0];
    const reason = 'Schedule the exact accepted Part 7B booked job.';
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
      .send({ approvalId: approval, reason: 'Review the Part 7B accepted scheduled job.' });
    expect(booking.status).toBe(201);
    expect((await request(fixture.app)
      .post(`/api/v1/forecast/booking-reviews/${booking.body.data.reviewId}/confirm-booked`)
      .set(actor.session.headers).set('Idempotency-Key', uuid()).send({
        reason: 'Confirm the Part 7B accepted scheduled job is booked.',
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
    await seedCurrentBookedMaterialPlan();
  }, 180000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('issues one bounded current forecast from current booking, adoption, price and reported availability', async () => {
    const response = await request(fixture.app)
      .get('/api/v1/forecast/material-cost/current')
      .set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data).toMatchObject({
      state: 'current', currency: 'USD', fictional: false,
      work: { state: 'current', scheduledCount: 1, unscheduledCount: 0,
        outsideWindowCount: 0 },
      plannedMaterials: { state: 'current', coveredCount: 1, lineCount: 2,
        baseCost: '600.00', wasteCost: '90.00', lineCost: '690.00', reason: null },
      purchasing: { state: 'plan_cost_only', purchaseOrdersVerified: false,
        deliveryFeesIncluded: false, taxTreatmentVerified: false,
        transportIncluded: false },
      availability: { state: 'owner_recorded_reported_sufficient',
        reportedSufficientLineCount: 2, inventoryVerified: false,
        reservationVerified: false, supplierAuthenticated: false },
      inventoryValuation: { state: 'unavailable', amount: null },
      learnedOutcomes: { state: 'none_current', applicableServiceCount: 0, applied: false },
      forecastIssued: true, completePurchasingForecastIssued: false,
      inventoryForecastIssued: false, calibratedRangeIssued: false,
      probabilityIssued: false, automaticActionAuthorized: false,
    });
  });

  test('uses UTC calendar dates and exact M24 waste rounding in every session time zone', async () => {
    const inputs = JSON.parse(JSON.stringify(planInputs));
    for (const line of inputs.lines) {
      line.evidence.effectiveOn = '2026-10-07';
      line.evidence.validThrough = '2026-10-07';
      line.availability.observedOn = '2026-10-07';
      line.availability.validThrough = '2026-10-07';
      line.sourceAssessment = undefined;
    }
    inputs.sourceAssessment = null; inputs.availabilityAssessment = null;
    const results = [];
    const client = await fixture.ownerPool.connect();
    try {
      for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
        await client.query('BEGIN');
        await client.query("SELECT set_config('TimeZone',$1,TRUE)", [zone]);
        results.push((await client.query(
          `SELECT canonical_forecast_material_cost_v1_plan_result(
           $1::jsonb,'USD','fence','2026-10-07T00:00:00Z'::timestamptz,
           '2026-10-07T00:30:00Z'::timestamptz,
           '2026-10-07T01:30:00Z'::timestamptz) value`, [inputs])).rows[0].value);
        await client.query('ROLLBACK');
      }
    } finally { client.release(); }
    expect(results).toEqual([results[0], results[0], results[0]]);
    expect(results[0]).toMatchObject({ state: 'current', lineCount: 2,
      baseCost: '600.00', wasteCost: '90.00', lineCost: '690.00' });
  });

  test('fails closed when the owner-recorded availability no longer covers the job', async () => {
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE canonical_material_plans DISABLE TRIGGER USER');
      await client.query(
        `UPDATE canonical_material_plans SET inputs=jsonb_set(
          inputs,'{lines,0,availability,validThrough}',to_jsonb($3::text),false)
         WHERE organization_id=$1 AND estimate_id=$2 AND action='save'`,
        [fixture.org, fixture.estimateGraphs[0].ids.estimate,
          new Date(cutoff.getTime() - 86400000).toISOString().slice(0, 10)]);
      const value = (await client.query(
        'SELECT canonical_forecast_material_cost_v1_current($1,$2,$3,$4) value',
        [fixture.org, fixture.actors.owner.actorUserId,
          fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId])).rows[0].value;
      expect(value).toMatchObject({ state: 'unavailable',
        reason: 'current_adopted_material_plan_unavailable', forecastIssued: false });
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });

  test('keeps tenant and access-role boundaries server-side', async () => {
    expect((await request(fixture.app).get('/api/v1/forecast/material-cost/current')
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const other = await request(fixture.app).get('/api/v1/forecast/material-cost/current')
      .set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200);
    expect(other.body.data).toMatchObject({ state: 'current',
      work: { scheduledCount: 0 }, plannedMaterials: { lineCost: '0.00' },
      forecastIssued: true });
  });
});
