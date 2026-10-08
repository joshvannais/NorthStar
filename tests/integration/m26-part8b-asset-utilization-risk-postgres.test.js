'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { Client } = require('pg');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const proposalSource = require('../helpers/m24-proposal-source');
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

realPostgres('Mission 26 original Part 8B mounted asset-utilization risk forecast', () => {
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
    const historyResponse = await request(fixture.app).get(route + '/proposal-adoptions')
      .set(headers);
    const currentReceipt = historyResponse.body.data.history[0] || null;
    let body = { version: 'estimate-proposal-adoption-v1', draft,
      selection: { materials: 'replace', labor: 'replace', equipment: 'replace',
        travel: 'replace', pricing: 'replace' },
      previousReceipt: currentReceipt ? { id: currentReceipt.id,
        revision: currentReceipt.revision, digest: currentReceipt.digest } : null,
      coverage: { costs: { overlaps: [], equipmentOutside: [], travelOutside: [],
        confirmed: true, reason: 'Reviewed every adopted Part 8B component once.' },
      overhead: { status: 'disjoint',
        explanation: 'Recorded overhead is separate from asset utilization evidence.',
        included: [] } }, pricingPolicy: null, expectedReviewDigest: null,
      confirmed: false, reason };
    response = await request(fixture.app).post(route + '/proposal-adoption-preview')
      .set(headers).send(body);
    if (response.status !== 200) throw new Error(JSON.stringify(response.body));
    body = { ...body, expectedReviewDigest: response.body.data.reviewDigest, confirmed: true };
    response = await request(fixture.app).post(route + '/proposal-adoptions')
      .set(headers).set('Idempotency-Key', uuid()).send(body);
    if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  }

  async function seedBookedAssetPosition() {
    const actor = fixture.actors.owner;
    estimate = fixture.estimateGraphs[0].ids.estimate;
    appointment = fixture.estimateGraphs[0].ids.appointment;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(fixture.app).get(route + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(fixture.app).post(route + suffix)
      .set(actor.session.headers).set('Idempotency-Key', uuid()).send(body);
    const validThrough = new Date(cutoff.getTime() + 40 * 86400000)
      .toISOString().slice(0, 10);
    await proposalSource.seed(fixture, recipe => {
      recipe.reviewBy = validThrough;
      const extendSources = value => {
        if (!value || typeof value !== 'object') return;
        if (Object.hasOwn(value, 'endsOn')) value.endsOn = validThrough;
        for (const nested of Object.values(value)) extendSources(nested);
      };
      extendSources(recipe);
      const equipment = recipe.components.find(component => component.kind === 'equipment');
      equipment.inputs.lines[0].assetId = liveAsset.asset.id;
      equipment.inputs.lines[0].identity = liveAsset.identity;
      equipment.inputs.lines[0].accessBasis = 'owned';
      recipe.equipmentCostLines[0].access = 'owned';
      recipe.equipmentCostLines[0].plannedHours = '2';
    }, new Date().toISOString(), validThrough + 'T23:59:59.999Z');
    await adoptPublishedProposal('Adopt the exact authenticated Part 8B equipment composition.');

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
      currency: review.currency, reason: 'Part 8B current commercial terms proof',
      confirmed: true, confirmationVersion: terms.contract,
      evidenceDigest: terms.sources.digest,
    })).status).toBe(201);
    review = (await get('/review')).body.data;
    const currentTerms = review.commercialTerms;
    expect((await post('/commercial-approvals', {
      termsPin: commercial.pin(currentTerms.current), evidenceDigest: currentTerms.sources.digest,
      expectedDecisionRevision: currentTerms.decisionBasis.revision,
      expectedDecisionDigest: currentTerms.decisionBasis.digest,
      scopeSummary: 'Complete the exact reviewed job with the recorded equipment.',
      reason: 'Part 8B current commercial approval proof', confirmed: true,
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
    const jobEnd = new Date(cutoff.getTime() + 100800000);
    await mutateSchedule('schedule', { kind: 'unassigned', id: null },
      jobStart.toISOString(), jobEnd.toISOString(),
      'Schedule the exact Part 8B planned utilization window.');

    review = (await get('/review')).body.data;
    const readiness = require('../helpers/m24-readiness-input').body(review);
    const line = readiness.inputs.lines[0];
    Object.assign(line, { quantity: 1, start: jobStart.toISOString(),
      end: jobEnd.toISOString(), location: 'Recorded fixture yard' });
    Object.assign(line.source, { label: 'Owner observed current asset',
      reference: 'Part 8B owner review',
      observedAt: new Date(cutoff.getTime() - 60000).toISOString(),
      validUntil: new Date(cutoff.getTime() + 35 * 86400000).toISOString(),
      quantity: 1, start: jobStart.toISOString(), end: jobEnd.toISOString(),
      condition: 'reported_no_problem', restrictions: '',
      location: 'Recorded fixture yard', leadTime: 0, leadTimeUnit: 'hours' });
    line.maintenance = { dueAt: new Date(cutoff.getTime() + 2 * 86400000).toISOString(),
      meterKey: 'engine-hours', threshold: '101', unit: 'hours',
      reference: 'Owner-reviewed 101-hour service interval' };
    let response = await post('/equipment-readiness-preview', readiness);
    if (response.status !== 200) throw new Error(JSON.stringify(response.body));
    readiness.inputs.assessment = { ...response.body.data.assessment, acknowledged: true };
    response = await post('/equipment-readiness-plans', readiness);
    if (response.status !== 201) throw new Error(JSON.stringify(response.body));

    const issued = await post('/customer-estimate-versions', {
      reason: 'Part 8B issued estimate proof', confirmed: true,
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
      .set('Idempotency-Key', uuid()).send({ customerName: 'Part 8B Customer',
        confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' })).status).toBe(201);
    const approval = await mutateSchedule('assign',
      { kind: 'profile', id: fixture.actors.member.actorUserId },
      jobStart.toISOString(), jobEnd.toISOString(),
      'Assign the exact accepted Part 8B booked job.');
    const pair = (await fixture.ownerPool.query(
      'SELECT canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [fixture.org, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, approval])).rows[0].value;
    if (pair.state !== 'ordered_same_opportunity_candidate') throw new Error(JSON.stringify(pair));
    const booking = await request(fixture.app).post('/api/v1/forecast/booking-reviews/first')
      .set(actor.session.headers).set('Idempotency-Key', uuid())
      .send({ approvalId: approval, reason: 'Review the Part 8B accepted scheduled job.' });
    if (booking.status !== 201) throw new Error(JSON.stringify(booking.body));
    expect((await request(fixture.app)
      .post(`/api/v1/forecast/booking-reviews/${booking.body.data.reviewId}/confirm-booked`)
      .set(actor.session.headers).set('Idempotency-Key', uuid()).send({
        reason: 'Confirm the Part 8B accepted scheduled job is booked.',
        confirmed: true, confirmationVersion: 'owner-booked-work-confirm-v1',
      })).status).toBe(201);
  }

  beforeAll(async () => {
    fixture = await createEstimateReviewFixture({ operationalSchedule: true,
      scheduledAppointment: { status: 'scheduled' },
      proposalScope: { measuredFenceLength: { value: '5', unit: 'ft' },
        proposalGeography: 'simulated-workspace' } });
    liveAsset = await require('../helpers/m24-readiness-asset').createReadinessAsset(fixture);
    await liveAsset.record('reading', { meterKey: 'engine-hours', reading: '100', unit: 'hours' });
    await fixture.ownerPool.query("SET northstar.m26_part5a_disposable_clock='enabled'");
    cutoff = new Date((await fixture.ownerPool.query(
      "SELECT date_trunc('second',clock_timestamp()) value")).rows[0].value);
    await fixture.ownerPool.query(
      'SELECT canonical_forecast_workload_capacity_v1_test_clock_set($1)', [cutoff]);
    await seedBookedAssetPosition();
  }, 180000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('issues exact claimed utilization and meter-threshold positions without inventing timing or risk', async () => {
    const owner = await request(fixture.app)
      .get('/api/v1/forecast/asset-utilization-risk/current')
      .set(fixture.actors.owner.session.headers);
    expect(owner.status).toBe(200);
    expect(owner.headers['cache-control']).toBe('private, no-store');
    expect(owner.body.data).toMatchObject({
      version: 'm26-asset-utilization-risk-forecast-v1',
      state: 'current', fictional: false,
      sourceCoverage: { state: 'complete_as_of', completeAsOf: true,
        currentBookedPositionCount: 1, scheduledJobCount: 1,
        equipmentRevisionCount: 1, readinessRevisionCount: 1,
        plannedUseCount: 1, assetCount: 1 },
      utilization: { state: 'current_claimed_plan_only', claimedOperatingHours: '2',
        operatingTimeVerified: false, checkoutDurationUsed: false },
      forecastIssued: true, utilizationForecastIssued: true,
      serviceIntervalForecastIssued: true, maintenanceDueForecastIssued: true,
      serviceTimingForecastIssued: false, downtimeRiskForecastIssued: false,
      probabilityIssued: false, automaticActionAuthorized: false,
    });
    expect(owner.body.data.sources[0]).toMatchObject({ sourceIndex: 0,
      job: { appointmentId: appointment }, estimate: { id: estimate },
      composition: { calculationVersion: 'estimate-cost-adoption-v3' },
      equipmentCostPlan: { calculationVersion: 'estimate-equipment-cost-plan-v1' },
      equipmentPlan: { calculationVersion: 'estimate-equipment-plan-v1' },
      readinessPlan: { calculationVersion: 'estimate-equipment-readiness-v1' } });
    expect(owner.body.data.assets[0]).toMatchObject({
      asset: { id: liveAsset.asset.id, accessType: 'owned', planAccessBasis: 'owned' },
      plannedUtilization: { state: 'current_claimed_plan_only', claimedOperatingHours: '2',
        operatingTimeVerified: false, checkoutDurationUsed: false },
      meter: { state: 'current_as_of_source', meterKey: 'engine-hours', unit: 'hours',
        reading: '100', historyComplete: true },
      serviceInterval: { state: 'current_claimed_plan_position', threshold: '101',
        currentReading: '100', projectedReading: '102', hoursRemainingAtStart: '1',
        thresholdReachedNow: false, thresholdReachedByClaimedPlan: true,
        verifiedServiceDate: null },
      maintenanceDue: { state: 'current_claimed_plan_position', dueWithinHorizon: true,
        dueByRecordedMeter: false, dueByClaimedPlanEnd: true,
        maintenanceScheduleVerified: false, maintenanceWorkAuthorized: false },
      serviceTiming: { state: 'unavailable', serviceAt: null },
      rentalLease: { state: 'owned_current', providerAvailabilityVerified: false,
        providerMaintenanceVerified: false },
      downtimeRisk: { state: 'unavailable', risk: null, probability: null },
    });
    expect(owner.body.data.run.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(owner.body.data.run.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test('propagates an explicit meter reset and correction without deriving a service date', async () => {
    const reset = await liveAsset.record('meter_reset', {
      meterKey: 'engine-hours', reading: '10', unit: 'hours',
      description: 'Explicit owner-reviewed meter reset for Part 8B.',
    });
    let response = await request(fixture.app)
      .get('/api/v1/forecast/asset-utilization-risk/current')
      .set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.body.data.assets[0]).toMatchObject({
      meter: { reading: '10', resetApplied: true, correctionApplied: false },
      serviceInterval: { currentReading: '10', projectedReading: '12',
        verifiedServiceDate: null },
    });
    const correction = liveAsset.body('meter_reset', {
      meterKey: 'engine-hours', reading: '12', unit: 'hours',
      description: 'Correct the exact reset reading for Part 8B.',
    });
    correction.action = 'correct';
    correction.correctsEventId = reset.result.data.eventId;
    await liveAsset.repo.mutate(liveAsset.actor, liveAsset.work.execution.id,
      uuid(), correction, true);
    response = await request(fixture.app)
      .get('/api/v1/forecast/asset-utilization-risk/current')
      .set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.body.data.assets[0]).toMatchObject({
      meter: { reading: '12', resetApplied: true, correctionApplied: true,
        historyComplete: true },
      serviceInterval: { currentReading: '12', projectedReading: '14',
        verifiedServiceDate: null },
      downtimeRisk: { state: 'unavailable', risk: null, probability: null },
    });
  });

  test('fails closed for an unproven equipment-planning outcome and recovers after owner rollback', async () => {
    const activeId = uuid(); const sourceRegistryId = uuid();
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.username = 'postgres'; databaseUrl.password = '';
    const admin = new Client({ connectionString: databaseUrl.toString() });
    await admin.connect();
    try {
      const serviceKey = (await admin.query(
        `SELECT snapshot#>>'{service,key}' service_key FROM canonical_polaris_snapshots
         WHERE organization_id=$1 AND estimate_id=$2
         ORDER BY created_at DESC,id DESC LIMIT 1`, [fixture.org, estimate])).rows[0].service_key;
      const basis = 'Imported machine hour utilization';
      const metric = 'machine_hour_utilization';
      const activeDigest = (await admin.query(
        `SELECT canonical_completion_digest(jsonb_build_object(
         'state','active','multiplier','1.100000','sourceRegistryId',$1::uuid,
         'sourceRegistryDigest',$2::text,'sourcePreviewDigest',$3::text,
         'sourceSelectionDigest',$4::text)) digest`,
        [sourceRegistryId, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)])).rows[0].digest;
      await admin.query("SET session_replication_role='replica'");
      await admin.query(
        `INSERT INTO canonical_job_outcome_planning_value_versions(
         id,organization_id,service_key,planning_area,metric_key,basis,revision,
         previous_id,action,value_state,multiplier,source_registry_id,
         source_registry_digest,source_preview_digest,source_selection_digest,
         rollback_to_id,rollback_to_digest,effective_digest,actor_user_id,membership_id,
         auth_session_id,reason,confirmed,confirmation_version,request_key_hash,
         request_digest,canonical_digest)
         VALUES($1,$2,$3,'equipment_planning',$4,$5,1,NULL,'adopt','active',1.1,
          $6,$7,$8,$9,NULL,NULL,$10,$11,$11,$12,
          'Bounded learned equipment fixture value',TRUE,
          'm25-job-outcome-planning-adoption-v1',$13,$14,$15)`,
        [activeId, fixture.org, serviceKey, metric, basis, sourceRegistryId,
          'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), activeDigest,
          fixture.actors.owner.actorUserId, fixture.actors.owner.authSessionId,
          'd'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)]);
      await admin.query("SET session_replication_role='origin'");
      let response = await request(fixture.app)
        .get('/api/v1/forecast/asset-utilization-risk/current')
        .set(fixture.actors.owner.session.headers);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ state: 'unavailable',
        reason: 'compatible_m25_outcome_unavailable', sources: null, assets: null,
        forecastIssued: false, utilizationForecastIssued: false,
        serviceIntervalForecastIssued: false, maintenanceDueForecastIssued: false,
        downtimeRiskForecastIssued: false, probabilityIssued: false,
        automaticActionAuthorized: false });
      const actor = fixture.actors.owner;
      await fixture.ownerPool.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      try {
        await fixture.ownerPool.query(
          `SELECT canonical_job_outcome_planning_value_rollback(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) value`,
          [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
            actor.csrfToken, uuid(), serviceKey, 'equipment_planning', metric, basis,
            1, 'f'.repeat(64), null, 'none',
            'Unset the incompatible learned equipment fixture value', true,
            'm25-job-outcome-planning-adoption-v1']);
        await fixture.ownerPool.query('COMMIT');
      } catch (error) {
        await fixture.ownerPool.query('ROLLBACK'); throw error;
      }
      response = await request(fixture.app)
        .get('/api/v1/forecast/asset-utilization-risk/current')
        .set(fixture.actors.owner.session.headers);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ state: 'current',
        learnedOutcomes: { state: 'none_current', applied: false },
        utilizationForecastIssued: true, serviceIntervalForecastIssued: true });
    } finally {
      await admin.query("SET session_replication_role='origin'").catch(() => {});
      await admin.end();
    }
  });

  test('keeps tenant, role, public and helper authority boundaries server-side', async () => {
    expect((await request(fixture.app)
      .get('/api/v1/forecast/asset-utilization-risk/current')
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const other = await request(fixture.app)
      .get('/api/v1/forecast/asset-utilization-risk/current')
      .set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200);
    expect(other.body.data.sourceCoverage.currentBookedPositionCount).toBe(0);

    const privileges = (await fixture.ownerPool.query(
      `SELECT
        has_function_privilege('public','canonical_forecast_asset_utilization_risk_v1_current(uuid,uuid,text,uuid)','EXECUTE') public_entry,
        has_function_privilege('public','canonical_forecast_asset_utilization_risk_v1_lock_sources(uuid)','EXECUTE') public_lock_helper,
        has_function_privilege('public','canonical_forecast_asset_utilization_risk_v1_unavailable(text,timestamptz,timestamptz,text)','EXECUTE') public_unavailable_helper,
        has_function_privilege('public','canonical_forecast_asset_hours_v1(numeric)','EXECUTE') public_hours,
        has_function_privilege($1,'canonical_forecast_asset_utilization_risk_v1_current(uuid,uuid,text,uuid)','EXECUTE') runtime_entry,
        has_function_privilege($1,'canonical_forecast_asset_utilization_risk_v1_unavailable(text,timestamptz,timestamptz,text)','EXECUTE') runtime_helper,
        has_function_privilege($1,'canonical_forecast_asset_utilization_risk_v1_lock_sources(uuid)','EXECUTE') runtime_lock_helper,
        has_function_privilege($1,'canonical_forecast_asset_hours_v1(numeric)','EXECUTE') runtime_hours`,
      [fixture.roles.runtime])).rows[0];
    expect(privileges).toEqual({ public_entry: false, public_lock_helper: false,
      public_unavailable_helper: false, public_hours: false,
      runtime_entry: true, runtime_helper: false, runtime_lock_helper: false,
      runtime_hours: false });
  });

  test('serializes behind a readiness withdrawal and clears stale asset positions', async () => {
    const actor = fixture.actors.owner;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const review = (await request(fixture.app).get(route + '/review')
      .set(actor.session.headers)).body.data;
    const body = { action: 'withdraw', expectedRevision: review.equipmentReadiness.current.revision,
      expectedDigest: review.equipmentReadiness.current.digest, sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest, inputs: null,
      currency: review.currency, reason: 'Part 8B readiness currentness withdrawal proof',
      confirmed: true, confirmationVersion: review.equipmentReadiness.contract };
    const gate = await fixture.ownerPool.connect();
    const writer = await fixture.ownerPool.connect();
    const reader = await fixture.ownerPool.connect();
    let mutationPromise; let readPromise;
    try {
      await gate.query('BEGIN');
      await gate.query('LOCK TABLE canonical_equipment_readiness_plans IN SHARE MODE');
      await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      mutationPromise = writer.query(
        `SELECT canonical_equipment_readiness_mutate(
         $1,$2,$3,$4,$5,$6,$7,$8::jsonb) value`,
        [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
          estimate, actor.csrfToken, uuid(), JSON.stringify(body)]);
      await waitForBackendLock(fixture.ownerPool, writer.processID,
        'Mission 24 readiness writer before INSERT');
      readPromise = reader.query(
        'SELECT canonical_forecast_asset_utilization_risk_v1_current($1,$2,$3,$4) value',
        [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId]);
      await waitForBackendLock(fixture.ownerPool, reader.processID,
        'Part 8B reader behind readiness currentness writer');
      const blockers = (await fixture.ownerPool.query(
        `SELECT pg_blocking_pids($1) writer_blockers,
          pg_blocking_pids($2) reader_blockers`,
        [writer.processID, reader.processID])).rows[0];
      expect(blockers.writer_blockers).toContain(gate.processID);
      expect(blockers.writer_blockers).not.toContain(reader.processID);
      expect(blockers.reader_blockers).toContain(writer.processID);
      await gate.query('COMMIT');
      const mutation = (await mutationPromise).rows[0].value;
      const withdrawn = (await writer.query(
        'SELECT created_at FROM canonical_equipment_readiness_plans WHERE organization_id=$1 AND id=$2',
        [fixture.org, mutation.receipt.id])).rows[0];
      await writer.query('COMMIT');
      const value = (await readPromise).rows[0].value;
      expect(value).toMatchObject({ state: 'unavailable',
        reason: 'current_adopted_readiness_unavailable', sources: null, assets: null,
        forecastIssued: false, utilizationForecastIssued: false,
        serviceIntervalForecastIssued: false, maintenanceDueForecastIssued: false,
        serviceTimingForecastIssued: false, downtimeRiskForecastIssued: false,
        probabilityIssued: false, automaticActionAuthorized: false });
      expect(new Date(value.sourceAsOf).getTime())
        .toBeGreaterThanOrEqual(new Date(withdrawn.created_at).getTime());
    } finally {
      await gate.query('ROLLBACK').catch(() => {});
      if (mutationPromise) await mutationPromise.catch(() => {});
      await writer.query('ROLLBACK').catch(() => {});
      if (readPromise) await readPromise.catch(() => {});
      gate.release(); writer.release(); reader.release();
    }
  });
});
