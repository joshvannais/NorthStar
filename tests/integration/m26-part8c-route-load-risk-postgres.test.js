'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const proposalSource = require('../helpers/m24-proposal-source');
const travelInput = require('../helpers/m24-travel-input');
const commercial = require('../../src/estimating/commercialContract');
const costComposition = require('../helpers/m24-cost-composition-input');
const { fixture: commercialFixture, group } = require('../helpers/m24-commercial-input');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();

async function waitForBackendLock(pool, backendPid, label) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const waiting = await pool.query(
      'SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted LIMIT 1', [backendPid]);
    if (waiting.rowCount === 1) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const state = (await pool.query(
    `SELECT locktype,mode,granted FROM pg_locks
     WHERE pid=$1 ORDER BY granted,locktype,mode`, [backendPid])).rows;
  throw new Error(`${label} did not reach the source fence: ${JSON.stringify(state)}`);
}

realPostgres('Mission 26 original Part 8C mounted route-load risk forecast', () => {
  let fixture;
  let cutoff;
  let estimate;
  let appointment;
  let liveAsset;

  async function adoptPublishedProposal(reason) {
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const headers = fixture.actors.owner.session.headers;
    let draft = { version: 'estimate-proposal-preview-v1', selectedRevision: null,
      expectedBasisDigest: null, overrides: [], candidateIds: [] };
    let response = await request(fixture.app).post(route + '/proposal-preview')
      .set(headers).send(draft);
    expect(response.status).toBe(200);
    draft = { ...draft, expectedBasisDigest: response.body.data.basisDigest };
    const history = await request(fixture.app).get(route + '/proposal-adoptions').set(headers);
    expect(history.status).toBe(200);
    const current = history.body.data.history[0] || null;
    let body = { version: 'estimate-proposal-adoption-v1', draft,
      selection: { materials: 'replace', labor: 'replace', equipment: 'replace',
        travel: 'replace', pricing: 'replace' },
      previousReceipt: current ? { id: current.id, revision: current.revision,
        digest: current.digest } : null,
      coverage: { costs: { overlaps: [], equipmentOutside: [], travelOutside: [],
        confirmed: true,
        reason: 'Reviewed each Part 8C cost component once without using route distance twice.' },
      overhead: { status: 'disjoint',
        explanation: 'Period overhead is separate from route-load evidence.', included: [] } },
      pricingPolicy: null, expectedReviewDigest: null, confirmed: false, reason };
    response = await request(fixture.app).post(route + '/proposal-adoption-preview')
      .set(headers).send(body);
    if (response.status !== 200) throw new Error(JSON.stringify(response.body));
    body = { ...body, expectedReviewDigest: response.body.data.reviewDigest, confirmed: true };
    response = await request(fixture.app).post(route + '/proposal-adoptions')
      .set(headers).set('Idempotency-Key', uuid()).send(body);
    if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  }

  async function seedCurrentBookedRoutePlan() {
    const actor = fixture.actors.owner;
    estimate = fixture.estimateGraphs[0].ids.estimate;
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
        userId: actor.actorUserId, expectedVersion: 'org-profile-v2', profile });
    const routeLocations = (await get('/review')).body.data.travelPlans.sources.locations
      .filter(location => location.kind !== 'declared');
    expect(routeLocations.length).toBeGreaterThanOrEqual(1);

    await proposalSource.seed(fixture, recipe => {
      recipe.reviewBy = validThrough;
      const travel = recipe.components.find(component => component.kind === 'travel');
      const trip = travelInput.fixture().trips[0];
      Object.assign(trip.source, { kind: 'company_reference', issuer: 'Fixture Fleet',
        reference: 'ROUTE-8C-1', note: 'Owner-recorded measured vehicle-leg distance.',
        effectiveOn: day, endsOn: validThrough, geography: 'Fixture service area' });
      trip.origin = JSON.parse(JSON.stringify(
        routeLocations.find(location => location.kind === 'business_location') || routeLocations[0]));
      trip.destination = JSON.parse(JSON.stringify(
        routeLocations.find(location => location.kind === 'recorded_job') || routeLocations[0]));
      travel.inputs.trips = [trip];
      const extendSources = value => {
        if (!value || typeof value !== 'object') return;
        if (Object.hasOwn(value, 'endsOn')) value.endsOn = validThrough;
        for (const nested of Object.values(value)) extendSources(nested);
      };
      extendSources(recipe);
      const equipment = recipe.components.find(component => component.kind === 'equipment');
      equipment.inputs.lines[0].assetId = liveAsset.asset.id;
      equipment.inputs.lines[0].identity = liveAsset.identity;
    }, new Date().toISOString(), validThrough + 'T23:59:59.999Z');
    await adoptPublishedProposal('Adopt the exact authenticated Part 8C travel composition.');

    let review = (await get('/review')).body.data;
    expect((await post('/decisions', costComposition.decisionBody(review))).status).toBe(201);
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
    inputs.taxGroups = [group(review.pricingPlans.current.inputs.lines.map(line => line.lineId))];
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
      currency: review.currency, reason: 'Part 8C current commercial terms proof',
      confirmed: true, confirmationVersion: terms.contract,
      evidenceDigest: terms.sources.digest,
    })).status).toBe(201);
    review = (await get('/review')).body.data;
    const currentTerms = review.commercialTerms;
    expect((await post('/commercial-approvals', {
      termsPin: commercial.pin(currentTerms.current), evidenceDigest: currentTerms.sources.digest,
      expectedDecisionRevision: currentTerms.decisionBasis.revision,
      expectedDecisionDigest: currentTerms.decisionBasis.digest,
      scopeSummary: 'Complete the reviewed job with the recorded vehicle legs.',
      reason: 'Part 8C current commercial approval proof', confirmed: true,
      confirmationVersion: currentTerms.contract,
      exceptions: { policyReason: '', policyUnknownAcknowledged: true,
        ownerRecordedTaxAcknowledged: true },
    })).status).toBe(201);

    const mutateSchedule = async (action, target, scheduledStart, scheduledEnd, reason) => {
      const assignment = (await fixture.ownerPool.query(
        `SELECT revision,rtrim(canonical_digest) digest,appointment_status
         FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2`,
        [fixture.org, appointment])).rows[0];
      const preview = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-previews`)
        .set(actor.session.headers).send({ expectedRevision: Number(assignment.revision),
          expectedDigest: assignment.digest, expectedTimeZone: 'UTC', action, target,
          scheduledStart, scheduledEnd, appointmentStatus: assignment.appointment_status, reason });
      if (preview.status !== 201) throw new Error(JSON.stringify(preview.body));
      const applied = await request(fixture.app)
        .post(`/api/v1/canonical/appointments/${appointment}/mutation-approvals`)
        .set(actor.session.headers).set('Idempotency-Key', uuid()).send({
          previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
          acknowledgedWarningDigests: preview.body.data.warningDigests,
          acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason });
      if (applied.status !== 200) throw new Error(JSON.stringify(applied.body));
      const current = (await fixture.ownerPool.query(
        'SELECT revision FROM canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2',
        [fixture.org, appointment])).rows[0];
      return (await fixture.ownerPool.query(
        `SELECT id FROM canonical_schedule_human_approvals
         WHERE organization_id=$1 AND appointment_id=$2 AND applied_revision=$3`,
        [fixture.org, appointment, Number(current.revision)])).rows[0].id;
    };
    const jobStart = new Date(cutoff.getTime() + 86400000);
    const jobEnd = new Date(cutoff.getTime() + 90000000);
    await mutateSchedule('schedule', { kind: 'unassigned', id: null },
      jobStart.toISOString(), jobEnd.toISOString(),
      'Schedule the exact Part 8C job inside the bounded horizon.');
    const issued = await post('/customer-estimate-versions', {
      reason: 'Part 8C issued estimate proof', confirmed: true,
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
      .set('Idempotency-Key', uuid()).send({ customerName: 'Part 8C Customer',
        confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' })).status).toBe(201);
    const approval = await mutateSchedule('assign',
      { kind: 'profile', id: fixture.actors.member.actorUserId },
      jobStart.toISOString(), jobEnd.toISOString(),
      'Assign the exact accepted Part 8C booked job.');
    const booking = await request(fixture.app).post('/api/v1/forecast/booking-reviews/first')
      .set(actor.session.headers).set('Idempotency-Key', uuid())
      .send({ approvalId: approval, reason: 'Review the Part 8C accepted scheduled job.' });
    if (booking.status !== 201) throw new Error(JSON.stringify(booking.body));
    expect((await request(fixture.app)
      .post(`/api/v1/forecast/booking-reviews/${booking.body.data.reviewId}/confirm-booked`)
      .set(actor.session.headers).set('Idempotency-Key', uuid()).send({
        reason: 'Confirm the Part 8C accepted scheduled job is booked.',
        confirmed: true, confirmationVersion: 'owner-booked-work-confirm-v1',
      })).status).toBe(201);
  }

  beforeAll(async () => {
    fixture = await createEstimateReviewFixture({ operationalSchedule: true,
      scheduledAppointment: { status: 'scheduled' },
      proposalScope: { measuredFenceLength: { value: '5', unit: 'ft' },
        proposalGeography: 'simulated-workspace' } });
    liveAsset = await require('../helpers/m24-readiness-asset').createReadinessAsset(fixture);
    await liveAsset.record('condition');
    await fixture.ownerPool.query("SET northstar.m26_part5a_disposable_clock='enabled'");
    cutoff = new Date((await fixture.ownerPool.query(
      "SELECT date_trunc('second',clock_timestamp()) value")).rows[0].value);
    await fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [cutoff]);
    await seedCurrentBookedRoutePlan();
  }, 180000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('issues only authenticated declared vehicle-leg distance from the exact current travel revision', async () => {
    const response = await request(fixture.app)
      .get('/api/v1/forecast/route-load-risk/current')
      .set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const value = response.body.data;
    expect(value).toMatchObject({ version: 'm26-route-load-risk-forecast-v1',
      state: 'current', fictional: false, horizon: { timeZone: 'UTC' },
      sourceCoverage: { state: 'complete_as_of', completeAsOf: true, hasMore: false,
        currentBookedPositionCount: 1, scheduledJobCount: 1, unscheduledJobCount: 0,
        outsideWindowCount: 0, travelRevisionCount: 1, routeLineCount: 1 },
      declaredRouteLoad: { state: 'current_claimed_plan_only', routeLineCount: 1,
        tripLegs: 4, vehicleLegs: 4, declaredVehicleMiles: '40',
        declaredVehicleKilometres: '0', reason: null },
      evidence: { sourceAuthenticatedDeclaredDistance: true,
        currentAdoptedTravelVerified: true, currentnessVerified: true,
        compatibleUnitsVerified: true, periodAttributionVerified: true,
        movementClassVerified: false, verifiedRoadRouting: false,
        resourceIdentityVerified: false, independentConsumptionEvidenceVerified: false,
        capacityLoadEvidenceVerified: false, rentalLeaseProviderEvidenceVerified: false,
        m25AdjustmentApplied: false },
      forecastIssued: true, declaredRouteLoadForecastIssued: true,
      roadMileageForecastIssued: false, routeTimingForecastIssued: false,
      fuelEnergyForecastIssued: false, logisticsCapacityRiskForecastIssued: false,
      calibratedRangeIssued: false, probabilityIssued: false,
      automaticActionAuthorized: false });
    expect(value.routes).toHaveLength(1);
    expect(value.routes[0]).toMatchObject({ sourceIndex: 0,
      route: { direction: 'origin_to_destination', returnIncluded: true },
      movement: { state: 'unavailable', class: null,
        roadTransportationVerified: false, onsiteEquipmentMovementVerified: false },
      resource: { state: 'unavailable', assetId: null, kind: null, accessType: null,
        providerSemanticsVerified: false },
      declaredDistance: { state: 'current_claimed_plan_only', oneWayQuantity: '10',
        unit: 'mi', basis: 'estimated', tripCount: 2, vehicleCount: 1,
        tripLegs: 4, vehicleLegs: 4, totalVehicleLegDistance: '40',
        sourceAuthenticated: true },
      verifiedRoadMileage: { state: 'unavailable', value: null, unit: null },
      routeTiming: { state: 'unavailable', value: null, unit: null },
      fuelEnergy: { state: 'unavailable', value: null, unit: null },
      capacity: { state: 'unavailable', value: null, unit: null } });
    expect(value.sources[0]).toMatchObject({ sourceIndex: 0,
      job: { appointmentId: appointment }, estimate: { id: estimate },
      composition: { calculationVersion: 'estimate-cost-adoption-v3' },
      travelPlan: { calculationVersion: 'estimate-travel-plan-v1' } });
    expect(value.run.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(value.run.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic across database session time zones while retaining the business calendar', async () => {
    const results = [];
    const client = await fixture.ownerPool.connect();
    try {
      for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query('SELECT set_config($1,$2,TRUE)', ['TimeZone', zone]);
        results.push((await client.query(
          'SELECT canonical_forecast_route_load_risk_v1_current($1,$2,$3,$4) value',
          [fixture.org, fixture.actors.owner.actorUserId,
            fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId])).rows[0].value);
        await client.query('ROLLBACK');
      }
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    expect(results.map(value => ({ horizon: value.horizon,
      declaredRouteLoad: value.declaredRouteLoad, routes: value.routes,
      sources: value.sources }))).toEqual(Array(3).fill({ horizon: results[0].horizon,
      declaredRouteLoad: results[0].declaredRouteLoad, routes: results[0].routes,
      sources: results[0].sources }));
  });

  test('keeps authenticated measured distance when only its monetary vehicle rate is unknown', async () => {
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query('ALTER TABLE canonical_travel_plans DISABLE TRIGGER USER');
      await client.query(
        `UPDATE canonical_travel_plans SET inputs=jsonb_set(
          inputs,'{trips,0,vehicle,rate}','null'::jsonb,false)
         WHERE organization_id=$1 AND estimate_id=$2 AND action='save'`,
        [fixture.org, estimate]);
      const value = (await client.query(
        'SELECT canonical_forecast_route_load_risk_v1_current($1,$2,$3,$4) value',
        [fixture.org, fixture.actors.owner.actorUserId,
          fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId])).rows[0].value;
      expect(value).toMatchObject({ state: 'current',
        declaredRouteLoad: { state: 'current_claimed_plan_only',
          declaredVehicleMiles: '40', declaredVehicleKilometres: '0' },
        declaredRouteLoadForecastIssued: true, roadMileageForecastIssued: false,
        fuelEnergyForecastIssued: false });
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });

  test('fails closed when the owner-recorded route source does not cover the forecast horizon', async () => {
    const client = await fixture.ownerPool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query('ALTER TABLE canonical_travel_plans DISABLE TRIGGER USER');
      await client.query(
        `UPDATE canonical_travel_plans SET inputs=jsonb_set(
          inputs,'{trips,0,source,endsOn}',to_jsonb($3::text),false)
         WHERE organization_id=$1 AND estimate_id=$2 AND action='save'`,
        [fixture.org, estimate,
          new Date(cutoff.getTime() + 86400000).toISOString().slice(0, 10)]);
      const value = (await client.query(
        'SELECT canonical_forecast_route_load_risk_v1_current($1,$2,$3,$4) value',
        [fixture.org, fixture.actors.owner.actorUserId,
          fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId])).rows[0].value;
      expect(value).toMatchObject({ state: 'unavailable',
        reason: 'current_adopted_route_coverage_unavailable', sources: null, routes: null,
        declaredRouteLoad: { state: 'unavailable', declaredVehicleMiles: null },
        forecastIssued: false, declaredRouteLoadForecastIssued: false });
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  });

  test('keeps tenant, role, public and helper authority boundaries server-side', async () => {
    expect((await request(fixture.app).get('/api/v1/forecast/route-load-risk/current')
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const other = await request(fixture.app).get('/api/v1/forecast/route-load-risk/current')
      .set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200);
    expect(other.body.data).toMatchObject({ state: 'current',
      sourceCoverage: { currentBookedPositionCount: 0, routeLineCount: 0 },
      declaredRouteLoad: { state: 'current_claimed_plan_only', routeLineCount: 0,
        tripLegs: 0, vehicleLegs: 0, declaredVehicleMiles: '0',
        declaredVehicleKilometres: '0' }, declaredRouteLoadForecastIssued: true });
    const privileges = (await fixture.ownerPool.query(
      `SELECT
        has_function_privilege('public','canonical_forecast_route_load_risk_v1_current(uuid,uuid,text,uuid)','EXECUTE') public_entry,
        has_function_privilege('public','canonical_forecast_route_load_risk_v1_lock_sources(uuid)','EXECUTE') public_lock_helper,
        has_function_privilege($1,'canonical_forecast_route_load_risk_v1_current(uuid,uuid,text,uuid)','EXECUTE') runtime_entry,
        has_function_privilege($1,'canonical_forecast_route_load_risk_v1_unavailable(text,timestamptz,timestamptz,text)','EXECUTE') runtime_helper,
        has_function_privilege($1,'canonical_forecast_route_load_risk_v1_lock_sources(uuid)','EXECUTE') runtime_lock_helper,
        has_function_privilege($1,'canonical_forecast_route_quantity_v1(numeric)','EXECUTE') runtime_quantity`,
      [fixture.roles.runtime])).rows[0];
    expect(privileges).toEqual({ public_entry: false, public_lock_helper: false,
      runtime_entry: true, runtime_helper: false, runtime_lock_helper: false,
      runtime_quantity: false });
  });

  test('fences a real concurrent travel-plan withdrawal and clears every stale route value', async () => {
    const actor = fixture.actors.owner;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const review = (await request(fixture.app).get(route + '/review')
      .set(actor.session.headers)).body.data;
    const body = { action: 'withdraw', expectedRevision: review.travelPlans.current.revision,
      expectedDigest: review.travelPlans.current.digest, sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest, inputs: null,
      currency: review.currency, reason: 'Part 8C currentness withdrawal proof',
      confirmed: true, confirmationVersion: review.travelPlans.contract };
    const gate = await fixture.ownerPool.connect();
    const writer = await fixture.ownerPool.connect();
    const reader = await fixture.ownerPool.connect();
    let mutationPromise; let readPromise;
    try {
      await gate.query('BEGIN');
      await gate.query('LOCK TABLE canonical_travel_plans IN SHARE MODE');
      await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      mutationPromise = writer.query(
        `SELECT canonical_travel_plan_mutate(
         $1,$2,$3,$4,$5,$6,$7,$8::jsonb) value`,
        [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
          estimate, actor.csrfToken, uuid(), JSON.stringify(body)]);
      await waitForBackendLock(fixture.ownerPool, writer.processID,
        'Mission 24 travel writer before INSERT');
      readPromise = reader.query(
        'SELECT canonical_forecast_route_load_risk_v1_current($1,$2,$3,$4) value',
        [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId]);
      await waitForBackendLock(fixture.ownerPool, reader.processID,
        'Mission 26 Part 8C reader behind travel writer');
      const blockers = (await fixture.ownerPool.query(
        'SELECT pg_blocking_pids($1) writer_blockers,pg_blocking_pids($2) reader_blockers',
        [writer.processID, reader.processID])).rows[0];
      expect(blockers.writer_blockers).toContain(gate.processID);
      expect(blockers.writer_blockers).not.toContain(reader.processID);
      expect(blockers.reader_blockers).toContain(writer.processID);
      await gate.query('COMMIT');
      const mutation = (await mutationPromise).rows[0].value;
      const withdrawn = (await writer.query(
        'SELECT created_at FROM canonical_travel_plans WHERE organization_id=$1 AND id=$2',
        [fixture.org, mutation.receipt.id])).rows[0];
      await writer.query('COMMIT');
      const value = (await readPromise).rows[0].value;
      expect(value).toMatchObject({ state: 'unavailable',
        reason: 'current_adopted_travel_composition_unavailable', sources: null,
        routes: null, declaredRouteLoad: { state: 'unavailable',
          declaredVehicleMiles: null, declaredVehicleKilometres: null },
        forecastIssued: false, declaredRouteLoadForecastIssued: false,
        roadMileageForecastIssued: false, routeTimingForecastIssued: false,
        fuelEnergyForecastIssued: false, logisticsCapacityRiskForecastIssued: false,
        probabilityIssued: false, automaticActionAuthorized: false });
      expect(new Date(value.sourceAsOf).getTime())
        .toBeGreaterThanOrEqual(new Date(withdrawn.created_at).getTime());
    } finally {
      await gate.query('ROLLBACK').catch(() => {});
      if (mutationPromise) await mutationPromise.catch(() => {});
      await writer.query('ROLLBACK').catch(() => {});
      if (readPromise) await readPromise.catch(() => {});
      await reader.query('ROLLBACK').catch(() => {});
      gate.release(); writer.release(); reader.release();
    }
  }, 30000);
});
