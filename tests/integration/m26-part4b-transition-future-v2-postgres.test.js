'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const research = require('../../public/js/command-center-demand-research');
const { openPaidResearchBrowser } = require('../helpers/m26-part4d-paid-browser');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = prefix => `${prefix}-${crypto.randomUUID()}`;
const ORIGIN_PATH = '/api/v1/forecast/demand-sources/transitions/future-origins';
const METHOD_PATH = '/api/v1/forecast/demand-sources/transitions/method-reviews';
const PROFILE_PATH = '/api/v1/forecast/reporting-windows/effective-anchors';

realPostgres('Mission 26 Part 4B complete four-target future-origin authority', () => {
  let fixture; let ui;
  beforeAll(async () => { fixture = await createDatabaseFixture({ operationalSchedule: true }); },
    120000);
  afterAll(async () => {
    if (ui) await ui.close();
    if (fixture) await fixture.cleanup();
  }, 120000);

  const actor = name => fixture.actors[name || 'owner'];
  const postOrigin = (name = 'owner', idempotencyKey = key('m26-p4b-origin')) =>
    request(fixture.app).post(ORIGIN_PATH).set(actor(name).session.headers)
      .set('Idempotency-Key', idempotencyKey).send({});

  async function profileAuthority(name = 'owner', activationAt = null) {
    const selected = actor(name);
    const anchored = await request(fixture.app).post(PROFILE_PATH)
      .set(selected.session.headers).set('Idempotency-Key', key('m26-p4b-profile'))
      .send({ reason: 'Record the exact prospective profile used by Part 4B.', confirmed: true });
    expect(anchored.status).toBe(201);
    const anchorId = anchored.body.data.anchorId;
    const activated = await request(fixture.app).post(`${PROFILE_PATH}/${anchorId}/activate`)
      .set(selected.session.headers).send({});
    expect(activated.status).toBe(200);
    if (activationAt) {
      await fixture.ownerPool.query(`ALTER TABLE canonical_forecast_profile_effective_activations
        DISABLE TRIGGER canonical_forecast_profile_effective_activations_immutable`);
      try {
        await fixture.ownerPool.query(`UPDATE canonical_forecast_profile_effective_activations
          SET observed_at=$3 WHERE organization_id=$1 AND anchor_id=$2`,
        [selected.organizationId, anchorId, activationAt]);
      } finally {
        await fixture.ownerPool.query(`ALTER TABLE canonical_forecast_profile_effective_activations
          ENABLE TRIGGER canonical_forecast_profile_effective_activations_immutable`);
      }
    }
    return anchorId;
  }

  function methodReview(name, action, expectedRevision, expectedDigest,
    idempotencyKey = key('m26-p4b-method-review')) {
    return request(fixture.app).post(METHOD_PATH).set(actor(name).session.headers)
      .set('Idempotency-Key', idempotencyKey).send({ action, expectedRevision,
        expectedDigest,
        reason: `${action === 'approve' ? 'Approve' : 'Reject'} the exact deterministic Part 4B research method.`,
        confirmed: true, confirmationVersion: 'm26-transition-method-review-v2' });
  }

  function review(kind, context, state, effectiveAt, action = 'observe') {
    const source = kind === 'qualification' ? 'lead-qualification' : 'estimate-request';
    return request(fixture.app)
      .post(`/api/v1/forecast/transition-cohorts/${source}-sources/${context.opportunity}/reviews`)
      .set(context.actor.session.headers).set('Idempotency-Key', key(`m26-p4b-${source}`))
      .send({ action, state, effectiveAt,
        reason: `Guarded synthetic ${kind} source evidence for the Part 4B full-window test.` });
  }

  function finalize(kind, recordedThrough) {
    const source = kind === 'qualification' ? 'lead-qualification' : 'estimate-request';
    return request(fixture.app)
      .post(`/api/v1/forecast/transition-cohorts/${source}-sources/finalizations`)
      .set(actor().session.headers).set('Idempotency-Key', key(`m26-p4b-${source}-final`))
      .send({ recordedThrough,
        reason: `Guarded synthetic ${kind} finalization for the Part 4B full-window test.` });
  }

  async function setSyntheticEpoch(organizationId) {
    await fixture.ownerPool.query(`ALTER TABLE canonical_forecast_transition_coverage_epochs_v2
      DISABLE TRIGGER canonical_forecast_transition_epochs_v2_immutable`);
    try {
      await fixture.ownerPool.query(`UPDATE canonical_forecast_transition_coverage_epochs_v2
        SET installed_at='2026-05-01T00:00:00.000000Z',epoch_digest=canonical_completion_digest(
          jsonb_build_object('version','m26-transition-coverage-epoch-v2',
           'organizationId',organization_id,'installedAt','2026-05-01T00:00:00.000000Z',
           'targetKey',target_key,'baselineSourceOrder',baseline_source_order,
           'baselineSecondaryOrder',baseline_secondary_order,
           'sourceAuthority',source_authority))
        WHERE organization_id=$1`, [organizationId]);
    } finally {
      await fixture.ownerPool.query(`ALTER TABLE canonical_forecast_transition_coverage_epochs_v2
        ENABLE TRIGGER canonical_forecast_transition_epochs_v2_immutable`);
    }
  }

  async function setTransitionClock(instant) {
    expect(instant).toMatch(/^2026-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/);
    await fixture.ownerPool.query(`CREATE OR REPLACE FUNCTION
      canonical_forecast_transition_clock_v2() RETURNS timestamptz
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path=pg_catalog,public,pg_temp AS $clock$
       SELECT '${instant}'::timestamptz
      $clock$`);
  }

  async function seedHistoricalWindows() {
    const contexts = {};
    for (const name of ['bookAug', 'bookSep', 'cancelAug', 'cancelSep']) {
      contexts[name] = await fixture.createExecution({ approvedScheduling: true,
        stopAfterScheduling: true });
      await fixture.ownerPool.query(`UPDATE canonical_opportunities
        SET created_at='2026-05-01T00:00:00.000000Z',updated_at='2026-05-01T00:00:00.000000Z'
        WHERE organization_id=$1 AND id=$2`, [fixture.org, contexts[name].opportunity]);
    }

    expect((await review('qualification', contexts.bookAug, 'open',
      '2026-05-15T12:00:00.000000Z')).status).toBe(201);
    expect((await review('qualification', contexts.bookAug, 'qualified',
      '2026-06-15T12:00:00.000000Z')).status).toBe(201);
    expect((await review('qualification', contexts.bookSep, 'open',
      '2026-06-15T12:00:00.000000Z')).status).toBe(201);
    expect((await review('estimate', contexts.bookAug, 'open',
      '2026-05-15T12:00:00.000000Z')).status).toBe(201);
    expect((await review('estimate', contexts.bookSep, 'open',
      '2026-06-15T12:00:00.000000Z')).status).toBe(201);
    expect((await review('estimate', contexts.bookSep, 'requested',
      '2026-07-15T12:00:00.000000Z')).status).toBe(201);
    expect((await finalize('qualification', '2026-08-01T00:00:00.000000Z')).status).toBe(201);
    expect((await finalize('estimate', '2026-08-01T00:00:00.000000Z')).status).toBe(201);

    let order = 1;
    for (const [name, visibleAt] of Object.entries({ bookAug: '2026-05-15T00:00:00.000000Z',
      bookSep: '2026-06-15T00:00:00.000000Z', cancelAug: '2026-05-10T00:00:00.000000Z',
      cancelSep: '2026-05-10T00:00:00.000000Z' })) {
      const context = contexts[name];
      const digest = crypto.createHash('sha256').update(`activation:${name}`).digest('hex');
      await fixture.ownerPool.query(`INSERT INTO canonical_forecast_opportunity_eligibility_activations(
        organization_id,source_event_id,source_order,operation_id,graph_id,opportunity_id,
        transcript_id,source_kind,visible_at,source_digest)
        VALUES($1,gen_random_uuid(),$2,gen_random_uuid(),gen_random_uuid(),$3,
         gen_random_uuid(),'lead',$4,$5)`, [fixture.org, order++, context.opportunity,
        visibleAt, digest]);
    }

    await fixture.ownerPool.query(`ALTER TABLE canonical_forecast_schedule_booking_events
      DISABLE TRIGGER canonical_forecast_schedule_booking_event_immutable`);
    try {
      const shifts = { bookAug: '2026-06-15T12:00:00.000000Z',
        bookSep: '2026-09-15T12:00:00.000000Z', cancelAug: '2026-05-15T12:00:00.000000Z',
        cancelSep: '2026-06-15T12:00:00.000000Z' };
      for (const [name, occurredAt] of Object.entries(shifts)) {
        await fixture.ownerPool.query(`UPDATE canonical_forecast_schedule_booking_events event_value
          SET occurred_at=$3
          FROM canonical_schedule_assignments assignment
          WHERE event_value.organization_id=$1 AND event_value.assignment_id=assignment.id
           AND assignment.appointment_id=$2 AND event_value.transition_kind='accepted_booking'`,
        [fixture.org, contexts[name].appointment, occurredAt]);
      }
      await fixture.ownerPool.query(`WITH chosen AS (
        SELECT event_value.id FROM canonical_forecast_schedule_booking_events event_value
        JOIN canonical_schedule_assignments assignment ON assignment.id=event_value.assignment_id
        WHERE event_value.organization_id=$1 AND assignment.appointment_id=$2
         AND event_value.transition_kind='state_changed'
        ORDER BY event_value.source_order DESC LIMIT 1)
       UPDATE canonical_forecast_schedule_booking_events event_value
       SET transition_kind='booking_cancelled',appointment_status='cancelled',
         occurred_at='2026-07-20T12:00:00.000000Z'
       FROM chosen WHERE event_value.id=chosen.id`, [fixture.org, contexts.cancelSep.appointment]);
    } finally {
      await fixture.ownerPool.query(`ALTER TABLE canonical_forecast_schedule_booking_events
        ENABLE TRIGGER canonical_forecast_schedule_booking_event_immutable`);
    }
    return contexts;
  }

  async function seedProspectiveOutcomes() {
    const contexts = {};
    for (const name of ['futureQualification', 'futureEstimate', 'futureBooking',
      'futureCancellation']) {
      contexts[name] = await fixture.createExecution({ approvedScheduling: true,
        stopAfterScheduling: true });
      await fixture.ownerPool.query(`UPDATE canonical_opportunities
        SET created_at='2026-08-20T00:00:00.000000Z',
            updated_at='2026-08-20T00:00:00.000000Z'
        WHERE organization_id=$1 AND id=$2`, [fixture.org, contexts[name].opportunity]);
    }
    expect((await review('qualification', contexts.futureQualification, 'open',
      '2026-08-20T12:00:00.000000Z')).status).toBe(201);
    expect((await review('qualification', contexts.futureQualification, 'qualified',
      '2026-09-15T12:00:00.000000Z')).status).toBe(201);
    expect((await review('estimate', contexts.futureEstimate, 'open',
      '2026-08-20T12:00:00.000000Z')).status).toBe(201);

    const activationDigest = crypto.createHash('sha256')
      .update('activation:prospective-booking').digest('hex');
    await fixture.ownerPool.query(`INSERT INTO canonical_forecast_opportunity_eligibility_activations(
      organization_id,source_event_id,source_order,operation_id,graph_id,opportunity_id,
      transcript_id,source_kind,visible_at,source_digest)
      SELECT $1,gen_random_uuid(),COALESCE(max(source_order),0)+1,gen_random_uuid(),
       gen_random_uuid(),$2,gen_random_uuid(),'lead',$3,$4
      FROM canonical_forecast_opportunity_eligibility_activations
      WHERE organization_id=$1`, [fixture.org, contexts.futureBooking.opportunity,
      '2026-08-20T12:00:00.000000Z', activationDigest]);
    await fixture.ownerPool.query(`ALTER TABLE canonical_forecast_schedule_booking_events
      DISABLE TRIGGER canonical_forecast_schedule_booking_event_immutable`);
    try {
      for (const [name, occurredAt] of Object.entries({
        futureBooking: '2026-09-15T12:00:00.000000Z',
        futureCancellation: '2026-08-20T12:00:00.000000Z',
      })) {
        await fixture.ownerPool.query(`UPDATE canonical_forecast_schedule_booking_events event_value
          SET occurred_at=$3
          FROM canonical_schedule_assignments assignment
          WHERE event_value.organization_id=$1 AND event_value.assignment_id=assignment.id
           AND assignment.appointment_id=$2 AND event_value.transition_kind='accepted_booking'`,
        [fixture.org, contexts[name].appointment, occurredAt]);
      }
    } finally {
      await fixture.ownerPool.query(`ALTER TABLE canonical_forecast_schedule_booking_events
        ENABLE TRIGGER canonical_forecast_schedule_booking_event_immutable`);
    }
    expect((await finalize('qualification', '2026-10-01T00:00:00.000000Z')).status).toBe(201);
    expect((await finalize('estimate', '2026-10-01T00:00:00.000000Z')).status).toBe(201);
    return contexts;
  }

  test('atomically saves all four targets with a positive and authenticated-zero window each',
    async () => {
      await setTransitionClock('2026-08-15T12:00:00.000000Z');
      const missingReview = await request(fixture.app).get(`${METHOD_PATH}/current`)
        .set(actor().session.headers);
      expect(missingReview.status).toBe(200);
      expect(missingReview.body.data).toMatchObject({
        state: 'transition_method_review_unavailable', approved: false,
        expectedRevision: 0, expectedDigest: 'none', automaticActionTaken: false });
      const approved = await methodReview('owner', 'approve', 0, 'none');
      expect(approved.status).toBe(201);
      expect(approved.body.data).toMatchObject({ state: 'transition_method_review_recorded',
        revision: 1, action: 'approve', approved: true, replayed: false,
        automaticSelection: false, automaticActionTaken: false });
      const approvalKey = key('m26-p4b-method-review-replay');
      const replayFirst = await methodReview('admin', 'approve', 1,
        approved.body.data.reviewDigest, approvalKey);
      expect(replayFirst.status).toBe(201);
      const replaySecond = await methodReview('admin', 'approve', 1,
        approved.body.data.reviewDigest, approvalKey);
      expect(replaySecond.status).toBe(200);
      expect(replaySecond.body.data).toMatchObject({ id: replayFirst.body.data.id,
        revision: 2, replayed: true });
      expect((await methodReview('owner', 'approve', 1,
        approved.body.data.reviewDigest)).status).toBe(409);

      const anchorId = await profileAuthority('owner');
      const lateProfile = await postOrigin();
      expect(lateProfile.status).toBe(200);
      expect(lateProfile.body.data).toMatchObject({ state: 'transition_origin_unavailable',
        reason: 'profile_historical_applicability_unavailable',
        sourceCoverageComplete: false });
      await fixture.ownerPool.query(`ALTER TABLE canonical_forecast_profile_effective_activations
        DISABLE TRIGGER canonical_forecast_profile_effective_activations_immutable`);
      try {
        await fixture.ownerPool.query(`UPDATE canonical_forecast_profile_effective_activations
          SET observed_at='2026-05-01T00:00:00.000000Z'
          WHERE organization_id=$1 AND anchor_id=$2`, [fixture.org, anchorId]);
      } finally {
        await fixture.ownerPool.query(`ALTER TABLE canonical_forecast_profile_effective_activations
          ENABLE TRIGGER canonical_forecast_profile_effective_activations_immutable`);
      }
      const epoch = await postOrigin();
      expect(epoch.status).toBe(200);
      expect(epoch.body.data).toMatchObject({ state: 'transition_origin_unavailable',
        reason: 'coverage_epoch_started', sourceCoverageComplete: false,
        probabilityWithheld: true, paidNumericServing: false,
        forecastServingEnabled: false });
      await setSyntheticEpoch(fixture.org);
      const contexts = await seedHistoricalWindows();

      const profileWriter = await fixture.ownerPool.connect();
      try {
        await profileWriter.query('BEGIN');
        await profileWriter.query(`SELECT pg_advisory_xact_lock(hashtextextended(
          'm26:profile-effective-source:'||$1::text,0))`, [fixture.org]);
        const busyProfile = await postOrigin('owner', key('m26-p4b-profile-busy'));
        expect(busyProfile.status).toBe(409);
        expect(busyProfile.body.error.category).toBe('FORECAST_DEMAND_SOURCE_BUSY');
      } finally {
        await profileWriter.query('ROLLBACK').catch(() => {});
        profileWriter.release();
      }

      ui = await openPaidResearchBrowser(fixture);
      await ui.action('transition-review', 'Evidence is current', 'Transitions');
      await ui.action('transition-save', 'Research origin saved', 'Transitions');
      const uiOriginResponse = [...ui.responses].reverse().find(item => item.method === 'POST' &&
        item.url.endsWith(ORIGIN_PATH));
      expect(uiOriginResponse).toBeDefined();
      const captureKey = uiOriginResponse.headers['idempotency-key'];
      const created = { status: uiOriginResponse.status, body: uiOriginResponse.body };
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ state: 'transition_origin_saved',
        sourceCoverageComplete: true,
        sourceCoverageScope: 'post_installation_northstar_selected_sources_only',
        uncertaintyState: 'unavailable_insufficient_natural_calibration',
        researchOnly: true, probabilityWithheld: true, outputDigestWithheld: true,
        realForecastEligible: false, forecastIssued: false,
        paidNumericServing: false, forecastServingEnabled: false, replayed: false });
      expect(created.body.data.targets).toEqual([
        'demand.qualification_transition.v1',
        'demand.estimate_request_transition.v1',
        'demand.booking_transition.v1',
        'demand.booking_cancellation.v1',
      ]);
      expect(JSON.stringify(created.body.data)).not.toMatch(/"probability":|"outputDigest":/i);
      expect(research.validateTransitionOrigin(created.body.data)).not.toBeNull();
      const uiTransitionOrigin = await ui.page
        .locator('#commandCenterResearchTransitionId').inputValue();
      expect(uiTransitionOrigin).toMatch(/^[0-9a-f-]{36}$/);
      expect(uiTransitionOrigin).toBe(created.body.data.id);
      await ui.action('transition-load', 'Evidence is current', 'Transitions');
      const saved = (await fixture.ownerPool.query(`SELECT evidence,private_output
        FROM canonical_forecast_transition_future_origins_v2
        WHERE organization_id=$1 AND id=$2`, [fixture.org, created.body.data.id])).rows[0];
      expect(saved.evidence.coverageEpochs).toHaveLength(4);
      expect(saved.evidence.cohorts).toHaveLength(8);
      expect(saved.private_output.targets).toHaveLength(4);
      for (const target of saved.private_output.targets) {
        const windows = saved.evidence.cohorts.filter(item => item.targetKey === target.targetKey);
        expect(windows).toHaveLength(2);
        expect(windows.some(item => item.outcomeCount === 0)).toBe(true);
        expect(windows.some(item => item.outcomeCount > 0)).toBe(true);
      }
      const replay = await postOrigin('owner', captureKey);
      expect(replay.status).toBe(200);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data).toMatchObject({ id: created.body.data.id, replayed: true });

      const longPrefix = 'p'.repeat(80);
      const longFirst = await postOrigin('owner', longPrefix + 'a'.repeat(48));
      const longSecond = await postOrigin('owner', longPrefix + 'b'.repeat(48));
      expect(longFirst.status).toBe(201);
      expect(longSecond.status).toBe(201);
      expect(longSecond.body.data.id).not.toBe(longFirst.body.data.id);
      const childSets = await fixture.ownerPool.query(`SELECT id,evidence->'cohorts' cohorts
        FROM canonical_forecast_transition_future_origins_v2
        WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,
      [fixture.org, [longFirst.body.data.id, longSecond.body.data.id]]);
      expect(childSets.rows).toHaveLength(2);
      const firstIds = new Set(childSets.rows[0].cohorts.map(item => item.cohortId));
      expect(childSets.rows[1].cohorts.every(item => !firstIds.has(item.cohortId))).toBe(true);

      expect(created.body.data).toMatchObject({
        asOf: '2026-08-15T12:00:00.000000Z',
        predictionCutoffAt: '2026-09-01T00:00:00.000000Z',
        horizonEndsAt: '2026-10-01T00:00:00.000000Z',
      });
      const immutableOrigin = (await fixture.ownerPool.query(`SELECT evidence,evidence_digest,
        private_output,output_digest,canonical_digest,as_of,prediction_cutoff_at,horizon_ends_at
        FROM canonical_forecast_transition_future_origins_v2
        WHERE organization_id=$1 AND id=$2`, [fixture.org, created.body.data.id])).rows[0];
      const beforeHorizon = await request(fixture.app)
        .post(`${ORIGIN_PATH}/${created.body.data.id}/evaluations`)
        .set(actor().session.headers)
        .set('Idempotency-Key', key('m26-p4b-before-horizon')).send({});
      expect(beforeHorizon.status).toBe(200);
      expect(beforeHorizon.body.data).toMatchObject({
        state: 'transition_evaluation_unavailable', reason: 'horizon_not_ended' });

      await setTransitionClock('2026-10-02T12:00:00.000000Z');
      const cohortsBeforeMissing = Number((await fixture.ownerPool.query(`SELECT count(*) count
        FROM (
          SELECT id FROM canonical_forecast_lead_qualification_cohorts WHERE organization_id=$1
          UNION ALL SELECT id FROM canonical_forecast_estimate_request_cohorts WHERE organization_id=$1
          UNION ALL SELECT id FROM canonical_forecast_schedule_booking_transition_cohorts
            WHERE organization_id=$1
          UNION ALL SELECT id FROM canonical_forecast_schedule_booking_cancellation_cohorts
            WHERE organization_id=$1
        ) cohorts`, [fixture.org])).rows[0].count);
      const missingOutcome = await request(fixture.app)
        .post(`${ORIGIN_PATH}/${created.body.data.id}/evaluations`)
        .set(actor().session.headers)
        .set('Idempotency-Key', key('m26-p4b-missing-outcome')).send({});
      expect(missingOutcome.status).toBe(200);
      expect(missingOutcome.body.data).toMatchObject({
        state: 'transition_evaluation_unavailable',
        reason: 'complete_outcome_window_unavailable', metricsWithheld: true });
      expect(Number((await fixture.ownerPool.query(`SELECT count(*) count
        FROM canonical_forecast_transition_evaluations_v2 WHERE organization_id=$1`,
      [fixture.org])).rows[0].count)).toBe(0);
      expect(Number((await fixture.ownerPool.query(`SELECT count(*) count FROM (
        SELECT id FROM canonical_forecast_lead_qualification_cohorts WHERE organization_id=$1
        UNION ALL SELECT id FROM canonical_forecast_estimate_request_cohorts WHERE organization_id=$1
        UNION ALL SELECT id FROM canonical_forecast_schedule_booking_transition_cohorts
          WHERE organization_id=$1
        UNION ALL SELECT id FROM canonical_forecast_schedule_booking_cancellation_cohorts
          WHERE organization_id=$1) cohorts`, [fixture.org])).rows[0].count)).toBe(cohortsBeforeMissing);

      const prospective = await seedProspectiveOutcomes();
      await ui.page.locator('#commandCenterResearchTransitionId').fill(created.body.data.id);
      await ui.action('transition-evaluate', 'Evaluation saved', 'Transitions');
      const uiTransitionEvaluation = await ui.page
        .locator('#commandCenterResearchTransitionEvaluationId').inputValue();
      expect(uiTransitionEvaluation).toMatch(/^[0-9a-f-]{36}$/);
      await ui.action('transition-evaluation-load', 'Evidence is current', 'Transitions');
      const originAfterOutcomeProgress = await request(fixture.app)
        .get(`${ORIGIN_PATH}/${created.body.data.id}`).set(actor().session.headers);
      expect(originAfterOutcomeProgress.body.data).toMatchObject({
        state: 'transition_origin_current', id: created.body.data.id });
      const uiEvaluationResponse = [...ui.responses].reverse().find(item => item.method === 'POST' &&
        item.url.endsWith(`${ORIGIN_PATH}/${created.body.data.id}/evaluations`));
      expect(uiEvaluationResponse).toBeDefined();
      const evaluationKey = uiEvaluationResponse.headers['idempotency-key'];
      const evaluated = { status: uiEvaluationResponse.status, body: uiEvaluationResponse.body };
      expect(evaluated.status).toBe(201);
      expect(evaluated.body.data).toMatchObject({ state: 'transition_evaluation_saved',
        originId: created.body.data.id, revision: 1, replayed: false,
        researchOnly: true, metricsWithheld: true, calibrationClaimed: false,
        driftVerdictIssued: false, automaticActionTaken: false });
      expect(JSON.stringify(evaluated.body.data)).not.toMatch(
        /predictedProbability|actualProbability|absoluteError|metricsDigest/i);
      const privateEvaluation = (await fixture.ownerPool.query(`SELECT private_metrics,
        outcome_evidence
        FROM canonical_forecast_transition_evaluations_v2
        WHERE organization_id=$1 AND id=$2`, [fixture.org, evaluated.body.data.id])).rows[0];
      expect(privateEvaluation.private_metrics.targets).toHaveLength(4);
      expect(privateEvaluation.outcome_evidence.outcomeGeneration.cohorts).toHaveLength(4);
      expect(privateEvaluation.private_metrics.targets.some(item => item.outcomeCount === 0))
        .toBe(true);
      expect(privateEvaluation.private_metrics.targets.some(item => item.outcomeCount > 0))
        .toBe(true);
      const evaluationReplay = await request(fixture.app)
        .post(`${ORIGIN_PATH}/${created.body.data.id}/evaluations`)
        .set(actor().session.headers).set('Idempotency-Key', evaluationKey).send({});
      expect(evaluationReplay.status).toBe(200);
      expect(evaluationReplay.body.data).toMatchObject({ id: evaluated.body.data.id,
        revision: 1, replayed: true, metricsWithheld: true });
      const evaluationRead = await request(fixture.app)
        .get(`/api/v1/forecast/demand-sources/transitions/evaluations/${evaluated.body.data.id}`)
        .set(actor().session.headers);
      expect(evaluationRead.status).toBe(200);
      expect(evaluationRead.body.data).toMatchObject({ state: 'transition_evaluation_current',
        revision: 1, metricsWithheld: true, calibrationClaimed: false,
        driftVerdictIssued: false, automaticActionTaken: false });
      expect(research.validateTransitionEvaluation(evaluationRead.body.data,
        created.body.data.id, evaluated.body.data.id)).not.toBeNull();
      expect((await review('qualification', prospective.futureQualification, 'unqualified',
        '2026-09-15T12:00:00.000000Z', 'correct')).status).toBe(201);
      expect((await finalize('qualification', '2026-10-02T00:00:00.000000Z')).status).toBe(201);
      const staleOutcome = await request(fixture.app)
        .get(`/api/v1/forecast/demand-sources/transitions/evaluations/${evaluated.body.data.id}`)
        .set(actor().session.headers);
      expect(staleOutcome.body.data).toMatchObject({
        state: 'transition_evaluation_stale', reason: 'outcome_source_changed',
        refreshRequired: true, metricsWithheld: true });
      const staleReplay = await request(fixture.app)
        .post(`${ORIGIN_PATH}/${created.body.data.id}/evaluations`)
        .set(actor().session.headers).set('Idempotency-Key', evaluationKey).send({});
      expect(staleReplay.body.data).toMatchObject({
        state: 'transition_evaluation_unavailable',
        reason: 'prior_evaluation_stale_new_request_required', metricsWithheld: true });
      const originAfterOutcomeCorrection = await request(fixture.app)
        .get(`${ORIGIN_PATH}/${created.body.data.id}`).set(actor().session.headers);
      expect(originAfterOutcomeCorrection.body.data).toMatchObject({
        state: 'transition_origin_current', id: created.body.data.id });
      const rereview = await request(fixture.app)
        .post(`${ORIGIN_PATH}/${created.body.data.id}/evaluations`)
        .set(actor('admin').session.headers)
        .set('Idempotency-Key', key('m26-p4b-evaluation-revision')).send({});
      expect(rereview.status).toBe(201);
      expect(rereview.body.data).toMatchObject({ state: 'transition_evaluation_saved',
        originId: created.body.data.id, revision: 2, replayed: false,
        metricsWithheld: true, calibrationClaimed: false,
        driftVerdictIssued: false, automaticActionTaken: false });
      const revisions = await fixture.ownerPool.query(`SELECT revision,previous_id
        FROM canonical_forecast_transition_evaluations_v2
        WHERE organization_id=$1 AND origin_id=$2 ORDER BY revision`,
      [fixture.org, created.body.data.id]);
      expect(revisions.rows).toEqual([
        { revision: 1, previous_id: null },
        { revision: 2, previous_id: evaluated.body.data.id },
      ]);
      const originAfterEvaluations = (await fixture.ownerPool.query(`SELECT evidence,evidence_digest,
        private_output,output_digest,canonical_digest,as_of,prediction_cutoff_at,horizon_ends_at
        FROM canonical_forecast_transition_future_origins_v2
        WHERE organization_id=$1 AND id=$2`, [fixture.org, created.body.data.id])).rows[0];
      expect(originAfterEvaluations).toEqual(immutableOrigin);
      await setTransitionClock('2026-08-15T12:00:00.000000Z');

      const rejected = await methodReview('owner', 'reject', 2,
        replayFirst.body.data.reviewDigest);
      expect(rejected.status).toBe(201);
      expect(rejected.body.data).toMatchObject({ revision: 3, action: 'reject', approved: false });
      const rejectedOrigin = await request(fixture.app)
        .get(`${ORIGIN_PATH}/${created.body.data.id}`).set(actor().session.headers);
      expect(rejectedOrigin.body.data).toMatchObject({ state: 'transition_origin_stale',
        reason: 'method_or_review_changed', refreshRequired: true });
      const blockedByReview = await postOrigin('owner', key('m26-p4b-rejected-method'));
      expect(blockedByReview.body.data).toMatchObject({
        state: 'transition_origin_unavailable',
        reason: 'approved_method_review_unavailable', sourceCoverageComplete: false });
      const reapproved = await methodReview('admin', 'approve', 3,
        rejected.body.data.reviewDigest);
      expect(reapproved.status).toBe(201);
      expect(reapproved.body.data).toMatchObject({ revision: 4, action: 'approve', approved: true });
      const remainsStale = await request(fixture.app)
        .get(`${ORIGIN_PATH}/${created.body.data.id}`).set(actor().session.headers);
      expect(remainsStale.body.data).toMatchObject({ state: 'transition_origin_stale',
        reason: 'method_or_review_changed' });

      const adminOrigin = await postOrigin('admin', key('m26-p4b-admin-origin'));
      expect(adminOrigin.status).toBe(201);
      expect(adminOrigin.body.data).toMatchObject({ state: 'transition_origin_saved',
        researchOnly: true, probabilityWithheld: true, paidNumericServing: false });
      const profileFresh = await postOrigin('owner', key('m26-p4b-profile-current-origin'));
      expect(profileFresh.status).toBe(201);
      await fixture.ownerPool.query(`UPDATE canonical_business_profiles
        SET raw_profile=jsonb_set(raw_profile,'{company,name}',to_jsonb($2::text))
        WHERE organization_id=$1 AND is_active=TRUE`,
      [fixture.org, 'Changed after the saved Part 4B origin']);
      const profileStale = await request(fixture.app)
        .get(`${ORIGIN_PATH}/${profileFresh.body.data.id}`).set(actor().session.headers);
      expect(profileStale.body.data).toMatchObject({ state: 'transition_origin_stale',
        reason: 'profile_or_context_changed', refreshRequired: true });

      const originCount = Number((await fixture.ownerPool.query(`SELECT count(*) count
        FROM canonical_forecast_transition_future_origins_v2 WHERE organization_id=$1`,
      [fixture.org])).rows[0].count);
      const writer = await fixture.ownerPool.connect();
      try {
        await writer.query('BEGIN');
        await writer.query(`SELECT pg_advisory_xact_lock(hashtextextended(
          'm26:lead-state:'||$1::text,0))`, [fixture.org]);
        const busy = await postOrigin('owner', key('m26-p4b-busy-origin'));
        expect(busy.status).toBe(409);
        expect(busy.body.error.category).toBe('FORECAST_DEMAND_SOURCE_BUSY');
        expect(JSON.stringify(busy.body)).not.toMatch(/probability|digest|eligible|outcome/i);
      } finally {
        await writer.query('ROLLBACK').catch(() => {});
        writer.release();
      }
      expect(Number((await fixture.ownerPool.query(`SELECT count(*) count
        FROM canonical_forecast_transition_future_origins_v2 WHERE organization_id=$1`,
      [fixture.org])).rows[0].count)).toBe(originCount);

      expect((await review('qualification', contexts.bookAug, 'unqualified',
        '2026-06-15T12:00:00.000000Z', 'correct')).status).toBe(201);
      const stale = await request(fixture.app).get(`${ORIGIN_PATH}/${created.body.data.id}`)
        .set(actor().session.headers);
      expect(stale.status).toBe(200);
      expect(stale.body.data).toMatchObject({ state: 'transition_origin_stale',
        refreshRequired: true, sourceCoverageComplete: false,
        probabilityWithheld: true, paidNumericServing: false });
      const staleEvaluation = await request(fixture.app)
        .get(`/api/v1/forecast/demand-sources/transitions/evaluations/${evaluated.body.data.id}`)
        .set(actor().session.headers);
      expect(staleEvaluation.status).toBe(200);
      expect(staleEvaluation.body.data).toMatchObject({ state: 'transition_evaluation_stale',
        originId: created.body.data.id, refreshRequired: true,
        researchOnly: true, metricsWithheld: true });
    }, 120000);

  test('withholds an incomplete tenant without retaining partial cohorts or an origin', async () => {
    await profileAuthority('otherOwner', '2026-05-01T00:00:00.000000Z');
    const reviewResult = await methodReview('otherOwner', 'approve', 0, 'none');
    expect(reviewResult.status).toBe(201);
    const started = await postOrigin('otherOwner');
    expect(started.status).toBe(200);
    expect(started.body.data.reason).toBe('coverage_epoch_started');
    await setSyntheticEpoch(fixture.otherOrg);
    const before = Number((await fixture.ownerPool.query(`SELECT count(*) count FROM (
      SELECT id FROM canonical_forecast_lead_qualification_cohorts WHERE organization_id=$1
      UNION ALL SELECT id FROM canonical_forecast_estimate_request_cohorts WHERE organization_id=$1
      UNION ALL SELECT id FROM canonical_forecast_schedule_booking_transition_cohorts WHERE organization_id=$1
      UNION ALL SELECT id FROM canonical_forecast_schedule_booking_cancellation_cohorts WHERE organization_id=$1
    ) rows`, [fixture.otherOrg])).rows[0].count);
    const unavailable = await postOrigin('otherOwner');
    expect(unavailable.status).toBe(200);
    expect(unavailable.body.data).toMatchObject({ state: 'transition_origin_unavailable',
      reason: 'complete_comparable_windows_unavailable', sourceCoverageComplete: false });
    const after = Number((await fixture.ownerPool.query(`SELECT count(*) count FROM (
      SELECT id FROM canonical_forecast_lead_qualification_cohorts WHERE organization_id=$1
      UNION ALL SELECT id FROM canonical_forecast_estimate_request_cohorts WHERE organization_id=$1
      UNION ALL SELECT id FROM canonical_forecast_schedule_booking_transition_cohorts WHERE organization_id=$1
      UNION ALL SELECT id FROM canonical_forecast_schedule_booking_cancellation_cohorts WHERE organization_id=$1
    ) rows`, [fixture.otherOrg])).rows[0].count);
    expect(after).toBe(before);
    expect(Number((await fixture.ownerPool.query(`SELECT count(*) count
      FROM canonical_forecast_transition_future_origins_v2 WHERE organization_id=$1`,
    [fixture.otherOrg])).rows[0].count)).toBe(0);
  }, 120000);

  test('enforces paid mutation authority, exact empty input, tenant privacy, and side-effect-free reads',
    async () => {
      expect((await postOrigin('member')).status).toBe(403);
      expect((await methodReview('member', 'approve', 0, 'none')).status).toBe(403);
      expect((await request(fixture.app).post(METHOD_PATH).set(actor().session.headers)
        .set('X-CSRF-Token', 'wrong').set('Idempotency-Key', key('m26-p4b-method-csrf'))
        .send({ action: 'approve', expectedRevision: 4,
          expectedDigest: 'a'.repeat(64),
          reason: 'Attempt a reviewed method write with a bad anti-forgery token.',
          confirmed: true,
          confirmationVersion: 'm26-transition-method-review-v2' })).status).toBe(403);
      expect((await request(fixture.app).post(ORIGIN_PATH).set(actor().session.headers)
        .set('X-CSRF-Token', 'wrong').set('Idempotency-Key', key('m26-p4b-csrf'))
        .send({})).status).toBe(403);
      expect((await request(fixture.app).post(ORIGIN_PATH).set(actor().session.headers)
        .set('Idempotency-Key', key('m26-p4b-input')).send({ cutoffAt: '2026-09-01' }))
        .status).toBe(400);
      await fixture.ownerPool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1",
        [fixture.org]);
      try {
        expect((await postOrigin('owner', key('m26-p4b-unpaid'))).status).toBe(403);
      } finally {
        await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1",
          [fixture.org]);
      }
      const before = Number((await fixture.ownerPool.query(`SELECT count(*) count
        FROM canonical_forecast_transition_future_origins_v2`)).rows[0].count);
      const hidden = await request(fixture.app).get(`${ORIGIN_PATH}/${crypto.randomUUID()}`)
        .set(actor('otherOwner').session.headers);
      expect(hidden.status).toBe(200);
      expect(hidden.body.data).toEqual({ state: 'not_found' });
      expect(JSON.stringify(hidden.body)).not.toMatch(/probability|digest|cohort|eligible/i);
      const after = Number((await fixture.ownerPool.query(`SELECT count(*) count
        FROM canonical_forecast_transition_future_origins_v2`)).rows[0].count);
      expect(after).toBe(before);
      await expect(fixture.runtimePool.query(
        'SELECT * FROM canonical_forecast_transition_future_origins_v2'))
        .rejects.toMatchObject({ code: '42501' });
    }, 120000);
});
