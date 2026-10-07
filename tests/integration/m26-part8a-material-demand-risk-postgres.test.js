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

realPostgres('Mission 26 original Part 8A mounted material-demand risk forecast', () => {
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
    expect(historyResponse.status).toBe(200);
    const currentReceipt = historyResponse.body.data.history[0] || null;
    let body = { version: 'estimate-proposal-adoption-v1', draft,
      selection: { materials: 'replace', labor: 'replace', equipment: 'replace',
        travel: 'replace', pricing: 'replace' },
      previousReceipt: currentReceipt ? { id: currentReceipt.id,
        revision: currentReceipt.revision, digest: currentReceipt.digest } : null,
      coverage: { costs: { overlaps: [], equipmentOutside: [], travelOutside: [],
        confirmed: true,
        reason: 'Reviewed each distinct component and quantity once for Part 8A.' },
      overhead: { status: 'disjoint',
        explanation: 'Job overhead is distinct from inventory and purchasing evidence.',
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

  async function seedCurrentBookedMaterialPlan() {
    const actor = fixture.actors.owner;
    estimate = fixture.estimateGraphs[0].ids.estimate;
    appointment = fixture.estimateGraphs[0].ids.appointment;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const get = suffix => request(fixture.app).get(route + suffix).set(actor.session.headers);
    const post = (suffix, body) => request(fixture.app).post(route + suffix)
      .set(actor.session.headers).set('Idempotency-Key', uuid()).send(body);
    const day = cutoff.toISOString().slice(0, 10);
    const validThrough = new Date(cutoff.getTime() + 40 * 86400000).toISOString().slice(0, 10);

    const sourceRecordedAt = new Date();
    await proposalSource.seed(fixture, recipe => {
      recipe.reviewBy = validThrough;
      const extendRecordedSources = value => {
        if (!value || typeof value !== 'object') return;
        if (Object.hasOwn(value, 'endsOn')) value.endsOn = validThrough;
        for (const nested of Object.values(value)) extendRecordedSources(nested);
      };
      extendRecordedSources(recipe);
      const material = recipe.components.find(component => component.kind === 'materials');
      material.version = 'estimate-material-plan-v4';
      const materialLines = [material.inputs.lines[0],
        { ...material.inputs.lines[0], lineId: uuid() }];
      material.inputs = { lines: materialLines.map((line, index) => ({
        ...line, material: index === 0 ? 'Boards' : 'Support Boards',
        quantity: '5', wastePercent: index === 0 ? '10' : '20', priceDate: day,
        evidence: { kind: 'supplier_quote', issuer: 'Fixture Supply',
          reference: `Q-8A-${index + 1}`, effectiveOn: day, validThrough,
          countryCode: 'US', region: 'MA', locality: null, serviceKey: 'fence',
          materialSpecification: line.material, statedUnit: line.unit,
          statedCurrency: 'USD', statedUnitPrice: line.unitPrice,
          appliesToReviewedJob: true, exceptionReason: null },
        availability: { kind: 'supplier_statement', issuer: 'Fixture Supply',
          reference: `A-8A-${index + 1}`, observedOn: day, validThrough,
          location: 'Fixture yard', availableQuantity: '10', statedUnit: line.unit,
          leadTimeDays: 1, appliesToReviewedJob: true, exceptionReason: null },
        replacement: null,
      })), sourceAssessment: null, availabilityAssessment: null };
      material.inputs.sourceAssessment = require('../../src/estimating/materialSourceContract')
        .assess(material.inputs, 'USD', { now: sourceRecordedAt, serviceKey: 'fence' });
      const result = require('../../src/estimating/materialPlanContract')
        .calculate(material.inputs, 'USD', material.version);
      material.inputs.availabilityAssessment =
        require('../../src/estimating/materialAvailabilityContract')
          .assess(material.inputs, result, { now: sourceRecordedAt });
      const equipment = recipe.components.find(component => component.kind === 'equipment');
      equipment.inputs.lines[0].assetId = liveAsset.asset.id;
      equipment.inputs.lines[0].identity = liveAsset.identity;
    }, sourceRecordedAt.toISOString(), validThrough + 'T23:59:59.999Z');
    await adoptPublishedProposal('Adopt one source-authenticated complete v3 composition for Part 8A.');
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
      currency: review.currency, reason: 'Part 8A current commercial terms proof',
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
      reason: 'Part 8A current commercial approval proof', confirmed: true,
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
      'Schedule the exact Part 8A job inside the bounded horizon.');
    const issued = await post('/customer-estimate-versions', {
      reason: 'Part 8A issued estimate proof', confirmed: true,
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
      .set('Idempotency-Key', uuid()).send({ customerName: 'Part 8A Customer',
        confirmed: true, confirmationVersion: 'customer-estimate-accept-v1' })).status).toBe(201);
    const approval = await mutateSchedule('assign',
      { kind: 'profile', id: fixture.actors.member.actorUserId },
      jobStart.toISOString(), jobEnd.toISOString(),
      'Assign the exact accepted Part 8A booked job.');
    const pair = (await fixture.ownerPool.query(
      'SELECT canonical_forecast_acceptance_booking_pair($1,$2,$3,$4,$5) value',
      [fixture.org, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, approval])).rows[0].value;
    if (pair.state !== 'ordered_same_opportunity_candidate') throw new Error(JSON.stringify(pair));
    const booking = await request(fixture.app).post('/api/v1/forecast/booking-reviews/first')
      .set(actor.session.headers).set('Idempotency-Key', uuid())
      .send({ approvalId: approval, reason: 'Review the Part 8A accepted scheduled job.' });
    if (booking.status !== 201) throw new Error(JSON.stringify(booking.body));
    expect((await request(fixture.app)
      .post(`/api/v1/forecast/booking-reviews/${booking.body.data.reviewId}/confirm-booked`)
      .set(actor.session.headers).set('Idempotency-Key', uuid()).send({
        reason: 'Confirm the Part 8A accepted scheduled job is booked.',
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
    await seedCurrentBookedMaterialPlan();
  }, 180000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('issues exact waste-inclusive demand with one adopted composition per current job', async () => {
    const response = await request(fixture.app)
      .get('/api/v1/forecast/material-demand-risk/current')
      .set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const value = response.body.data;
    expect(value).toMatchObject({ state: 'current', fictional: false,
      horizon: { timeZone: 'UTC' },
      sourceCoverage: { state: 'complete_as_of', completeAsOf: true, hasMore: false,
        currentBookedPositionCount: 1, scheduledJobCount: 1, unscheduledJobCount: 0,
        outsideWindowCount: 0, materialRevisionCount: 1, componentLineCount: 2 },
      demand: { state: 'current', groupCount: 2, componentCount: 2 },
      inventory: { state: 'unavailable', onHand: null, m23UsageApplied: false },
      futureReceipts: { state: 'unavailable', quantity: null },
      replenishment: { state: 'unavailable', leadTimeDays: null, cutoffAt: null,
        supplierAvailabilityVerified: false, purchaseAuthorityVerified: false },
      reorder: { state: 'unavailable', reorderAt: null },
      stockoutRisk: { state: 'unavailable', risk: null, shortageQuantity: null },
      purchasingRisk: { state: 'unavailable', risk: null },
      evidence: { sourceAuthenticatedDemand: true, currentAdoptedCompositionVerified: true,
        compatibleUnitsVerified: true, periodAttributionVerified: true,
        inventoryVerified: false, futureReceiptsVerified: false,
        replenishmentPolicyVerified: false, supplierAvailabilityVerified: false,
        purchaseAuthorityVerified: false, m25AdjustmentApplied: false },
      forecastIssued: true, demandForecastIssued: true, reorderForecastIssued: false,
      stockoutForecastIssued: false, purchasingRiskForecastIssued: false,
      probabilityIssued: false, automaticActionAuthorized: false });
    expect(value.sources[0]).toMatchObject({ sourceIndex: 0,
      job: { appointmentId: appointment }, estimate: { id: estimate },
      composition: { calculationVersion: 'estimate-cost-adoption-v3' },
      materialPlan: { calculationVersion: 'estimate-material-plan-v4' } });
    expect(value.sources[0].composition.componentManifest).toEqual(expect.any(Object));
    expect(value.sources[0].composition.coverageAssessment).toEqual(expect.any(Object));
    expect(value.demand.groups.map(groupValue => ({ label: groupValue.identity.materialLabel,
      base: groupValue.baseQuantity, waste: groupValue.wasteQuantity,
      planned: groupValue.plannedQuantity, unit: groupValue.unit }))).toEqual([
      { label: 'Boards', base: '5', waste: '0.5', planned: '5.5', unit: 'ft' },
      { label: 'Support Boards', base: '5', waste: '1', planned: '6', unit: 'ft' },
    ]);
    expect(value.demand.groups.flatMap(groupValue => groupValue.components)).toHaveLength(2);
    expect(value.run.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(value.run.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is deterministic across session time zones and keeps the profile calendar attribution', async () => {
    const results = [];
    const client = await fixture.ownerPool.connect();
    try {
      for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        await client.query('SELECT set_config($1,$2,TRUE)', ['TimeZone', zone]);
        results.push((await client.query(
          'SELECT canonical_forecast_material_demand_risk_v1_current($1,$2,$3,$4) value',
          [fixture.org, fixture.actors.owner.actorUserId,
            fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId])).rows[0].value);
        await client.query('ROLLBACK');
      }
    } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    expect(results.map(value => ({ horizon: value.horizon, demand: value.demand,
      sources: value.sources })))
      .toEqual(Array(3).fill({ horizon: results[0].horizon, demand: results[0].demand,
        sources: results[0].sources }));
    for (const value of results) expect(value.run.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test('fails closed for an unproven Mission 25 material value and recovers after it is unset', async () => {
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
         VALUES($1,$2,$3,'material_planning','planned_quantity','NorthStar material quantity',
          1,NULL,'adopt','active',1.1,$4,$5,$6,$7,NULL,NULL,$8,$9,$9,$10,
          'Bounded learned material fixture value',TRUE,
          'm25-job-outcome-planning-adoption-v1',$11,$12,$13)`,
        [activeId, fixture.org, serviceKey, sourceRegistryId, 'a'.repeat(64),
          'b'.repeat(64), 'c'.repeat(64), activeDigest,
          fixture.actors.owner.actorUserId, fixture.actors.owner.authSessionId,
          'd'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)]);
      await admin.query("SET session_replication_role='origin'");
      let response = await request(fixture.app)
        .get('/api/v1/forecast/material-demand-risk/current')
        .set(fixture.actors.owner.session.headers);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ state: 'unavailable',
        reason: 'compatible_m25_outcome_unavailable', forecastIssued: false,
        demandForecastIssued: false });
      const writer = await fixture.ownerPool.connect();
      const reader = await fixture.ownerPool.connect();
      try {
        await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const actor = fixture.actors.owner;
        await writer.query(
          `SELECT canonical_job_outcome_planning_value_rollback(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) value`,
          [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
            actor.csrfToken, uuid(), serviceKey, 'material_planning', 'planned_quantity',
            'NorthStar material quantity', 1, 'f'.repeat(64), null, 'none',
            'Unset the incompatible learned material fixture value', true,
            'm25-job-outcome-planning-adoption-v1']);
        const rollback = (await writer.query(
          `SELECT id,created_at FROM canonical_job_outcome_planning_value_versions
           WHERE organization_id=$1 AND service_key=$2 AND planning_area='material_planning'
            AND metric_key='planned_quantity' AND basis='NorthStar material quantity'
           ORDER BY revision DESC,id DESC LIMIT 1`, [fixture.org, serviceKey])).rows[0];
        const readPromise = reader.query(
          'SELECT canonical_forecast_material_demand_risk_v1_current($1,$2,$3,$4) value',
          [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId]);
        await waitForBackendLock(fixture.ownerPool, reader.processID,
          'Mission 25 rollback/currentness reader');
        await writer.query('COMMIT');
        const value = (await readPromise).rows[0].value;
        expect(value).toMatchObject({ state: 'current',
          demand: { state: 'current', componentCount: 2 },
          sourceCoverage: { materialRevisionCount: 1, componentLineCount: 2 },
          learnedOutcomes: { state: 'none_current', applied: false },
          demandForecastIssued: true });
        expect(new Date(value.sourceAsOf).getTime())
          .toBeGreaterThanOrEqual(new Date(rollback.created_at).getTime());
      } finally {
        await writer.query('ROLLBACK').catch(() => {});
        writer.release(); reader.release();
      }
      response = await request(fixture.app)
        .get('/api/v1/forecast/material-demand-risk/current')
        .set(fixture.actors.owner.session.headers);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ state: 'current',
        learnedOutcomes: { state: 'none_current', applied: false },
        demandForecastIssued: true });
    } finally {
      await admin.query("SET session_replication_role='origin'").catch(() => {});
      await admin.end();
    }
  });

  test('keeps tenant, role, public and helper authority boundaries server-side', async () => {
    expect((await request(fixture.app).get('/api/v1/forecast/material-demand-risk/current')
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const other = await request(fixture.app).get('/api/v1/forecast/material-demand-risk/current')
      .set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200);
    expect(other.body.data).toMatchObject({ state: 'current',
      sourceCoverage: { currentBookedPositionCount: 0, componentLineCount: 0 },
      demand: { state: 'current', groupCount: 0, componentCount: 0, groups: [] },
      demandForecastIssued: true });
    const privileges = (await fixture.ownerPool.query(
      `SELECT
        has_function_privilege('public','canonical_forecast_material_demand_risk_v1_current(uuid,uuid,text,uuid)','EXECUTE') public_entry,
        has_function_privilege('public','canonical_forecast_material_demand_risk_v1_lock_sources(uuid)','EXECUTE') public_lock_helper,
        has_function_privilege($1,'canonical_forecast_material_demand_risk_v1_current(uuid,uuid,text,uuid)','EXECUTE') runtime_entry,
        has_function_privilege($1,'canonical_forecast_material_demand_risk_v1_unavailable(text,timestamptz,timestamptz,text)','EXECUTE') runtime_helper,
        has_function_privilege($1,'canonical_forecast_material_demand_risk_v1_lock_sources(uuid)','EXECUTE') runtime_lock_helper,
        has_function_privilege($1,'canonical_forecast_material_quantity_v1(numeric)','EXECUTE') runtime_quantity`,
      [fixture.roles.runtime])).rows[0];
    expect(privileges).toEqual({ public_entry: false, public_lock_helper: false,
      runtime_entry: true,
      runtime_helper: false, runtime_lock_helper: false, runtime_quantity: false });
  });

  test('fences a real concurrent material-plan withdrawal and clears stale demand', async () => {
    const actor = fixture.actors.owner;
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const review = (await request(fixture.app).get(route + '/review')
      .set(actor.session.headers)).body.data;
    const body = { action: 'withdraw', expectedRevision: review.materialPlans.current.revision,
      expectedDigest: review.materialPlans.current.digest, sourcePins: review.pins,
      expectedDecisionRevision: review.decisions.writeBasis.revision,
      expectedDecisionDigest: review.decisions.writeBasis.digest, inputs: null,
      currency: review.currency, reason: 'Part 8A currentness withdrawal proof',
      confirmed: true, confirmationVersion: review.materialPlans.contract };
    const writer = await fixture.ownerPool.connect();
    const reader = await fixture.ownerPool.connect();
    try {
      await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const mutation = (await writer.query(
        `SELECT canonical_material_plan_mutate(
         $1,$2,$3,$4,$5,$6,$7,$8::jsonb) value`,
        [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId,
          estimate, actor.csrfToken, uuid(), JSON.stringify(body)])).rows[0].value;
      const withdrawn = (await writer.query(
        'SELECT created_at FROM canonical_material_plans WHERE organization_id=$1 AND id=$2',
        [fixture.org, mutation.receipt.id])).rows[0];
      const readPromise = reader.query(
        'SELECT canonical_forecast_material_demand_risk_v1_current($1,$2,$3,$4) value',
        [fixture.org, actor.actorUserId, actor.actorAccessRole, actor.authSessionId]);
      await waitForBackendLock(fixture.ownerPool, reader.processID,
        'Mission 24 material-plan reader');
      await writer.query('COMMIT');
      const value = (await readPromise).rows[0].value;
      expect(value).toMatchObject({ state: 'unavailable',
        reason: 'current_adopted_material_composition_unavailable',
        sources: null, demand: { state: 'unavailable', groups: null },
        forecastIssued: false, demandForecastIssued: false,
        reorderForecastIssued: false, stockoutForecastIssued: false,
        purchasingRiskForecastIssued: false });
      expect(new Date(value.sourceAsOf).getTime())
        .toBeGreaterThanOrEqual(new Date(withdrawn.created_at).getTime());
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release(); reader.release();
    }
  });
});
