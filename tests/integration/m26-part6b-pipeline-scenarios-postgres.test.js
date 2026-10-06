'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const root = '/api/v1/forecast/pipeline-scenarios';
const profileRoot = '/api/v1/forecast/reporting-windows/effective-anchors';
const demandRoot = '/api/v1/forecast/demand-to-schedule';
const key = () => crypto.randomUUID();

async function setClock(pool, instant) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL northstar.m26_part6b_disposable_clock='enabled'");
    await client.query(
      'SELECT canonical_forecast_pipeline_scenario_test_clock_set($1)', [instant]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

realPostgres('Mission 26 Part 6B guarded pipeline scenario lifecycle', () => {
  let fixture;
  beforeAll(async () => {
    fixture = await createEstimateReviewFixture({ operationalSchedule: true });
  }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('runs policy, frozen origin, future evaluation, replay, privacy, and fail-close paths',
    async () => {
      const owner = fixture.actors.owner;
      const profile = await request(fixture.app).post(profileRoot)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ reason: 'Record the prospective profile used by the bounded pipeline scenario.',
          confirmed: true });
      expect(profile.status).toBe(201);
      expect((await request(fixture.app)
        .post(`${profileRoot}/${profile.body.data.anchorId}/activate`)
        .set(owner.session.headers).send({})).status).toBe(200);
      const epoch = await request(fixture.app).post(`${demandRoot}/epochs`)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ purpose: 'pipeline_first_booking',
          profileAnchorId: profile.body.data.anchorId });
      expect(epoch.status).toBe(201);
      const policyKey = key();
      const policyBody = { action: 'approve',
        reason: 'Approve bounded synthetic scenario assumptions for research.',
        expectedRevision: 0,
        scenarioWeights: {
          preliminaryEstimate: { lowerPpm: 111111, centralPpm: 333333,
            upperPpm: 777777 },
          approvedUnbooked: { lowerPpm: 222222, centralPpm: 555555,
            upperPpm: 888888 },
        }, confirmed: true, confirmationVersion: 'pipeline-scenario-policy-v1' };
      const policy = await request(fixture.app).post(`${root}/policies`)
        .set(owner.session.headers).set('Idempotency-Key', policyKey).send(policyBody);
      expect(policy.status).toBe(201);
      expect(policy.body.data).toMatchObject({ state: 'pipeline_scenario_policy_reviewed',
        revision: 1, action: 'approve', replayed: false, weightsWithheld: true,
        weightsAreScenarioAssumptions: true, probabilityCalibrated: false,
        forecastIssued: false });
      const replay = await request(fixture.app).post(`${root}/policies`)
        .set(owner.session.headers).set('Idempotency-Key', policyKey).send(policyBody);
      expect(replay.status).toBe(200);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data).toMatchObject({ id: policy.body.data.id, replayed: true });

      const readPolicy = await request(fixture.app).get(`${root}/policies/current`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(readPolicy.status).toBe(200);
      expect(readPolicy.headers['cache-control']).toBe('private, no-store');
      expect(readPolicy.body.data).toMatchObject({ id: policy.body.data.id,
        weightsWithheld: true });
      expect(JSON.stringify(readPolicy.body)).not.toMatch(/111111|333333|777777|888888/);
      expect((await request(fixture.app).get(`${root}/policies/current`)
        .set('Cookie', fixture.actors.member.session.headers.Cookie)).status).toBe(403);
      expect((await request(fixture.app).get(`${root}/policies/current`)
        .set('Cookie', fixture.actors.otherOwner.session.headers.Cookie)).status).toBe(200);

      const originKey = key();
      const originBody = { reason: 'Capture the bounded private pipeline research cohort.',
        confirmed: true, confirmationVersion: 'pipeline-open-value-scenario-v1' };
      await fixture.ownerPool.query(`CREATE FUNCTION public.part6b_origin_insert_delay()
        RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $$`);
      await fixture.ownerPool.query(`CREATE TRIGGER part6b_origin_insert_delay
        BEFORE INSERT ON canonical_forecast_pipeline_scenario_origins
        FOR EACH ROW EXECUTE FUNCTION public.part6b_origin_insert_delay()`);
      let origin; let concurrentOrigin;
      try {
        const firstOrigin = request(fixture.app).post(`${root}/origins`)
          .set(owner.session.headers).set('Idempotency-Key', originKey)
          .send(originBody).then(value => value);
        await new Promise(resolve => setTimeout(resolve, 75));
        const secondOrigin = request(fixture.app).post(`${root}/origins`)
          .set(owner.session.headers).set('Idempotency-Key', originKey)
          .send(originBody).then(value => value);
        const originResponses = await Promise.all([firstOrigin, secondOrigin]);
        expect(originResponses.map(value => value.status).sort()).toEqual([201, 409]);
        origin = originResponses.find(value => value.status === 201);
        concurrentOrigin = originResponses.find(value => value.status === 409);
      } finally {
        await fixture.ownerPool.query(`DROP TRIGGER part6b_origin_insert_delay
          ON canonical_forecast_pipeline_scenario_origins`);
        await fixture.ownerPool.query('DROP FUNCTION public.part6b_origin_insert_delay()');
      }
      expect(origin.status).toBe(201);
      expect(concurrentOrigin.status).toBe(409);
      expect(concurrentOrigin.body).toEqual({ success: false,
        error: 'Pipeline scenario is busy' });
      expect(origin.body.data).toMatchObject({ state: 'pipeline_scenario_origin_saved',
        replayed: false, targetKey: 'pipeline.open_value_scenario',
        formalBookedWorkValueTargetClaimed: false, postCutoffEntrantsExcluded: true,
        valuesWithheld: true, probabilityCalibrated: false, researchOnly: true,
        realForecastEligible: false, forecastIssued: false, paidNumericServing: false,
        automaticActionAuthorized: false });
      expect(JSON.stringify(origin.body)).not.toMatch(/privateOutput|scenarioWeights|members|price/);
      const originId = origin.body.data.id;
      const replayedOrigin = await request(fixture.app).post(`${root}/origins`)
        .set(owner.session.headers).set('Idempotency-Key', originKey).send(originBody);
      expect(replayedOrigin.status).toBe(200);
      expect(replayedOrigin.headers['idempotency-replayed']).toBe('true');
      expect(replayedOrigin.body.data).toMatchObject({ id: originId, replayed: true });
      const collidedOrigin = await request(fixture.app).post(`${root}/origins`)
        .set(owner.session.headers).set('Idempotency-Key', originKey).send({
          ...originBody, reason: 'Divergent reuse of the bounded pipeline origin request.' });
      expect(collidedOrigin.status).toBe(409);
      expect(collidedOrigin.body).toEqual({ success: false, error: 'Conflict' });
      expect(Number((await fixture.ownerPool.query(
        `SELECT count(*) count FROM canonical_forecast_pipeline_scenario_origins
          WHERE organization_id=$1 AND actor_user_id=$2
            AND request_key_hash=encode(sha256(convert_to($3,'UTF8')),'hex')`,
        [fixture.org, owner.actorUserId, originKey])).rows[0].count)).toBe(1);
      const current = await request(fixture.app).get(`${root}/origins/${originId}`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(current.status).toBe(200);
      expect(current.body.data).toMatchObject({ id: originId,
        captureInputsCurrentAtRead: true, captureInputsFrozen: false,
        sourceCoverageCompleteAtCapture: true, valuesWithheld: true });

      const end = new Date(origin.body.data.horizonEndsAt);
      end.setUTCDate(end.getUTCDate() + 1);
      await setClock(fixture.ownerPool, end.toISOString());
      const evaluationKey = key();
      const evaluationBody = {
        reason: 'Evaluate the frozen synthetic cohort after its full horizon.',
        confirmed: true, confirmationVersion: 'pipeline-cutoff-cohort-evaluation-v1' };
      await fixture.ownerPool.query(`CREATE FUNCTION public.part6b_evaluation_insert_delay()
        RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $$`);
      await fixture.ownerPool.query(`CREATE TRIGGER part6b_evaluation_insert_delay
        BEFORE INSERT ON canonical_forecast_pipeline_scenario_evaluations
        FOR EACH ROW EXECUTE FUNCTION public.part6b_evaluation_insert_delay()`);
      let evaluation; let concurrentEvaluation;
      try {
        const firstEvaluation = request(fixture.app)
          .post(`${root}/origins/${originId}/evaluations`)
          .set(owner.session.headers).set('Idempotency-Key', evaluationKey)
          .send(evaluationBody).then(value => value);
        await new Promise(resolve => setTimeout(resolve, 75));
        const secondEvaluation = request(fixture.app)
          .post(`${root}/origins/${originId}/evaluations`)
          .set(owner.session.headers).set('Idempotency-Key', evaluationKey)
          .send(evaluationBody).then(value => value);
        const evaluationResponses = await Promise.all([firstEvaluation, secondEvaluation]);
        expect(evaluationResponses.map(value => value.status).sort()).toEqual([201, 409]);
        evaluation = evaluationResponses.find(value => value.status === 201);
        concurrentEvaluation = evaluationResponses.find(value => value.status === 409);
      } finally {
        await fixture.ownerPool.query(`DROP TRIGGER part6b_evaluation_insert_delay
          ON canonical_forecast_pipeline_scenario_evaluations`);
        await fixture.ownerPool.query('DROP FUNCTION public.part6b_evaluation_insert_delay()');
      }
      expect(evaluation.status).toBe(201);
      expect(concurrentEvaluation.status).toBe(409);
      expect(concurrentEvaluation.body).toEqual({ success: false,
        error: 'Pipeline scenario is busy' });
      expect(evaluation.body.data).toMatchObject({
        state: 'pipeline_scenario_evaluation_saved', originId, revision: 1,
        replayed: false,
        measurementKey: 'research.pipeline_cutoff_cohort_booked_work_value',
        formalTargetClaimed: false, postCutoffEntrantsExcluded: true,
        metricsWithheld: true, researchOnly: true, calibrationClaimed: false,
        forecastIssued: false, paidNumericServing: false, automaticActionTaken: false });
      const evaluationId = evaluation.body.data.id;
      const replayedEvaluation = await request(fixture.app)
        .post(`${root}/origins/${originId}/evaluations`)
        .set(owner.session.headers).set('Idempotency-Key', evaluationKey)
        .send(evaluationBody);
      expect(replayedEvaluation.status).toBe(200);
      expect(replayedEvaluation.headers['idempotency-replayed']).toBe('true');
      expect(replayedEvaluation.body.data).toMatchObject({ id: evaluationId,
        originId, replayed: true });
      const collidedEvaluation = await request(fixture.app)
        .post(`${root}/origins/${originId}/evaluations`)
        .set(owner.session.headers).set('Idempotency-Key', evaluationKey)
        .send({ ...evaluationBody,
          reason: 'Divergent reuse of the bounded pipeline evaluation request.' });
      expect(collidedEvaluation.status).toBe(409);
      expect(collidedEvaluation.body).toEqual({ success: false, error: 'Conflict' });
      expect(Number((await fixture.ownerPool.query(
        `SELECT count(*) count FROM canonical_forecast_pipeline_scenario_evaluations
          WHERE organization_id=$1 AND actor_user_id=$2
            AND request_key_hash=encode(sha256(convert_to($3,'UTF8')),'hex')`,
        [fixture.org, owner.actorUserId, evaluationKey])).rows[0].count)).toBe(1);
      const evaluationRead = await request(fixture.app)
        .get(`${root}/evaluations/${evaluationId}`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(evaluationRead.status).toBe(200);
      expect(evaluationRead.body.data).toMatchObject({
        id: evaluationId, originId, metricsWithheld: true, automaticActionTaken: false });
      expect(JSON.stringify(evaluationRead.body)).not.toMatch(/actualBooked|privateMetrics|price/);

      const rows = (await fixture.ownerPool.query(`SELECT
        (private_output#>>'{totalRangeMicro,central}')::numeric total_central,
        jsonb_array_length(evidence->'members') member_count,
        method_closure_digest=canonical_forecast_pipeline_scenario_method_closure_digest()
          closure_current
        FROM canonical_forecast_pipeline_scenario_origins WHERE id=$1`, [originId])).rows[0];
      expect(rows).toEqual({ total_central: '0', member_count: 0,
        closure_current: true });
      const arithmetic = (await fixture.ownerPool.query(`SELECT
        canonical_forecast_pipeline_scenario_total_weighted_micro(
          '[{"category":"preliminary_estimate","priceBeforeTax":"0.01"},
            {"category":"approved_unbooked","priceBeforeTax":"0.01"}]'::jsonb,
          49,49)::text total,
        (canonical_forecast_pipeline_scenario_weighted_micro(
          '[{"category":"preliminary_estimate","priceBeforeTax":"0.01"}]'::jsonb,
          'preliminary_estimate',49)+
         canonical_forecast_pipeline_scenario_weighted_micro(
          '[{"category":"approved_unbooked","priceBeforeTax":"0.01"}]'::jsonb,
          'approved_unbooked',49))::text rounded_categories`)).rows[0];
      expect(arithmetic).toEqual({ total: '1', rounded_categories: '0' });

      const concurrent = await Promise.all([
        request(fixture.app).post(`${root}/policies`).set(owner.session.headers)
          .set('Idempotency-Key', key()).send({ ...policyBody, expectedRevision: 1,
            reason: 'First concurrent bounded synthetic review.' }),
        request(fixture.app).post(`${root}/policies`).set(owner.session.headers)
          .set('Idempotency-Key', key()).send({ ...policyBody, expectedRevision: 1,
            reason: 'Second concurrent bounded synthetic review.' }),
      ]);
      expect(concurrent.map(value => value.status).sort()).toEqual([201, 409]);

      const staleClient = await fixture.ownerPool.connect();
      let poisoned = false;
      try {
        await staleClient.query('BEGIN');
        await staleClient.query(`ALTER TABLE canonical_forecast_pipeline_scenario_origins
          DISABLE TRIGGER canonical_forecast_pipeline_scenario_origins_immutable`);
        await staleClient.query(`UPDATE canonical_forecast_pipeline_scenario_origins
          SET evidence=jsonb_set(evidence,'{sourceCoverageComplete}','false'::jsonb)
          WHERE id=$1`, [originId]);
        await staleClient.query(`ALTER TABLE canonical_forecast_pipeline_scenario_origins
          ENABLE TRIGGER canonical_forecast_pipeline_scenario_origins_immutable`);
        await staleClient.query('COMMIT');
        poisoned = true;
        const stale = await request(fixture.app).get(`${root}/origins/${originId}`)
          .set('Cookie', owner.session.headers.Cookie);
        expect(stale.status).toBe(503);
        expect(stale.body).toEqual({ success: false,
          error: 'Pipeline scenario research unavailable' });
      } finally {
        await staleClient.query('ROLLBACK').catch(() => {});
        if (poisoned) {
          await staleClient.query('BEGIN');
          try {
            await staleClient.query(`ALTER TABLE canonical_forecast_pipeline_scenario_origins
              DISABLE TRIGGER canonical_forecast_pipeline_scenario_origins_immutable`);
            await staleClient.query(`UPDATE canonical_forecast_pipeline_scenario_origins
              SET evidence=jsonb_set(evidence,'{sourceCoverageComplete}','true'::jsonb)
              WHERE id=$1`, [originId]);
            await staleClient.query(`ALTER TABLE canonical_forecast_pipeline_scenario_origins
              ENABLE TRIGGER canonical_forecast_pipeline_scenario_origins_immutable`);
            await staleClient.query('COMMIT');
          } catch (error) {
            await staleClient.query('ROLLBACK').catch(() => {});
            throw error;
          }
        }
        staleClient.release();
      }
    }, 120000);
});
