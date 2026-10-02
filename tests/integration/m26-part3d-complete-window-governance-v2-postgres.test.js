'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } =
  require('../helpers/m24-estimate-review-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const root = '/api/v1/forecast/price-history';
const profileRoot = '/api/v1/forecast/reporting-windows/effective-anchors';
const day = 86400000;
const key = () => crypto.randomUUID();
const utc = value => new Date(value).toISOString();

realPostgres('Mission 26 Part 3D complete-window governance v2', () => {
  let f;
  beforeAll(async () => { f = await createEstimateReviewFixture({
    operationalSchedule: true, additionalCompleteEstimates: 49,
  }); }, 300000);
  afterAll(async () => { if (f) await f.cleanup(); }, 300000);

  test('server-selected matched population records guarded human governance',
    async () => {
      const scenario = 'flat';
      const owner = f.actors.owner;
      const args = [f.org, owner.actorUserId, owner.actorAccessRole,
        owner.authSessionId];
      const estimates = [f.estimateGraphs[0], ...f.estimateGraphs.slice(2)];
      expect(estimates).toHaveLength(50);
      const first = await request(f.app).post(`${root}/ordered-snapshots`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(first.status).toBe(201);
      const activated = await request(f.app)
        .post(`${root}/ordered-anchor/activate`)
        .set(owner.session.headers).send({});
      expect(activated.status).toBe(200);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const future = new Date(today.getTime() + day);
      const futureEnd = new Date(future.getTime() + day);
      const start = new Date(today.getTime() - 50 * day);
      const coverageBefore = new Date(start.getTime() - 4 * day);
      const profile = await request(f.app).post(profileRoot)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ reason: 'Fictional governance population.', confirmed: true });
      expect(profile.status).toBe(201);
      const profileAnchorId = profile.body.data.anchorId;
      const profileActivation = await request(f.app)
        .post(`${profileRoot}/${profileAnchorId}/activate`)
        .set(owner.session.headers).send({});
      expect(profileActivation.status).toBe(200);
      const anchorTriggers = [
        ['canonical_forecast_price_ordered_anchors',
          'canonical_forecast_price_ordered_anchors_immutable'],
        ['canonical_forecast_price_anchor_activations',
          'canonical_forecast_price_anchor_activations_immutable'],
      ];
      try {
        for (const [table, trigger] of anchorTriggers) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        await f.ownerPool.query(`UPDATE canonical_forecast_price_ordered_anchors
          SET coverage_starts_at=$2 WHERE organization_id=$1`,
        [f.org, coverageBefore]);
        await f.ownerPool.query(`UPDATE canonical_forecast_price_anchor_activations
          SET observed_at=$2 WHERE organization_id=$1`,
        [f.org, coverageBefore]);
      } finally {
        for (const [table, trigger] of anchorTriggers.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      const runIds = [];
      const zeroRunIds = [];
      const receiptIds = [];
      const decisionIds = [];
      const sourceTriggers = [
        ['canonical_estimate_decisions',
          'canonical_estimate_decision_immutable'],
        ['canonical_forecast_price_decision_orders',
          'canonical_forecast_price_decision_order_immutable'],
      ];
      try {
        for (const [table, trigger] of sourceTriggers) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        for (let index = 0; index < 50; index += 1) {
          const estimateId = estimates[index].ids.estimate;
          const path = `/api/v1/canonical/estimates/${estimateId}`;
          const review = await request(f.app).get(`${path}/review`)
            .set(owner.session.headers);
          expect(review.status).toBe(200);
          const approval = await request(f.app).post(`${path}/decisions`)
            .set(owner.session.headers).set('Idempotency-Key', key())
            .send({ action: 'approve', expectedRevision: 0,
              expectedDigest: 'none', sourcePins: review.body.data.pins,
              scopeSummary: `Fictional approval ${index + 1}.`,
              priceBeforeTax: '1400.00',
              currency: review.body.data.currency,
              reason: 'Fictional owner review.', confirmed: true,
              confirmationVersion: 'estimate-quote-preparation-v1' });
          expect(approval.status).toBe(201);
          const eventAt = new Date(start.getTime() + (index - 2) * day +
            10 * 3600000);
          const decisionId = approval.body.data.receipt.id;
          decisionIds.push(decisionId);
          await f.ownerPool.query(`UPDATE canonical_estimate_decisions
            SET created_at=$2 WHERE id=$1`, [decisionId, eventAt]);
          await f.ownerPool.query(`UPDATE canonical_forecast_price_decision_orders
            SET ordered_at=$2::timestamptz + interval '123 microseconds'
            WHERE decision_id=$1`, [decisionId, eventAt]);
          const observed = await f.runtimePool.query(
            'SELECT public.canonical_forecast_observe_price_decision_commit($1,$2,$3,$4,$5,$6) value',
            [...args, owner.csrfToken, decisionId]);
          expect(observed.rows[0].value.state).toBe(
            'price_decision_commit_observed');
          const source = await f.runtimePool.query(
            'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
            [...args, owner.csrfToken, key()]);
          const receiptId = source.rows[0].value.snapshot.id;
          receiptIds.push(receiptId);
          const saved = await f.runtimePool.query(
            'SELECT public.canonical_forecast_capture_price_flow_origin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
            [...args, owner.csrfToken, key(), receiptId,
              'USD', future, futureEnd]);
          const runId = saved.rows[0].value.runId;
          runIds.push(runId);
          await f.runtimePool.query(
            'SELECT public.canonical_forecast_activate_price_flow_origin($1,$2,$3,$4,$5,$6) value',
            [...args, owner.csrfToken, runId]);
          await f.runtimePool.query(
            'SELECT public.canonical_forecast_price_flow_profile_observe($1,$2,$3,$4,$5,$6,$7) value',
            [...args, owner.csrfToken, runId, profileAnchorId]);
          const zero = await f.runtimePool.query(
            'SELECT public.canonical_forecast_capture_price_flow_zero_baseline($1,$2,$3,$4,$5,$6,$7) value',
            [...args, owner.csrfToken, key(), runId]);
          const zeroRunId = zero.rows[0].value.runId;
          zeroRunIds.push(zeroRunId);
          await f.runtimePool.query(
            'SELECT public.canonical_forecast_activate_price_flow_origin($1,$2,$3,$4,$5,$6) value',
            [...args, owner.csrfToken, zeroRunId]);
          await f.runtimePool.query(
            'SELECT public.canonical_forecast_price_flow_profile_observe($1,$2,$3,$4,$5,$6,$7) value',
            [...args, owner.csrfToken, zeroRunId, profileAnchorId]);
        }
      } finally {
        for (const [table, trigger] of sourceTriggers.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      const mutable = [
        ['canonical_forecast_price_ordered_receipts',
          'canonical_forecast_price_ordered_receipts_immutable'],
        ['canonical_forecast_price_flow_saved_origins',
          'canonical_forecast_price_flow_origins_immutable'],
        ['canonical_forecast_price_flow_origin_activations',
          'canonical_forecast_price_flow_activation_immutable'],
        ['canonical_forecast_profile_effective_anchors',
          'canonical_forecast_profile_effective_anchors_immutable'],
        ['canonical_forecast_profile_effective_activations',
          'canonical_forecast_profile_effective_activations_immutable'],
        ['canonical_forecast_price_flow_profile_witnesses',
          'canonical_forecast_price_flow_profile_witness_immutable'],
        ['canonical_forecast_price_decision_commit_observations',
          'canonical_forecast_price_decision_commit_immutable'],
      ];
      try {
        for (const [table, trigger] of mutable) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        const profileCaptured = new Date(start.getTime() - 13 * 3600000);
        await f.ownerPool.query(`UPDATE canonical_forecast_profile_effective_anchors
          SET captured_at=$2 WHERE id=$1`, [profileAnchorId, profileCaptured]);
        await f.ownerPool.query(`UPDATE canonical_forecast_profile_effective_activations
          SET observed_at=$2 WHERE anchor_id=$1`,
        [profileAnchorId, new Date(profileCaptured.getTime() + 3600000)]);
        for (let index = 0; index < 50; index += 1) {
          const horizon = new Date(start.getTime() + index * day);
          const horizonEnd = new Date(horizon.getTime() + day);
          const capturedAt = new Date(horizon.getTime() - 11 * 3600000);
          const savedAt = new Date(horizon.getTime() - 10 * 3600000);
          const proofAt = new Date(horizon.getTime() - 9 * 3600000);
          const witnessAt = new Date(horizon.getTime() - 8 * 3600000);
          const sourceEventAt = new Date(horizon.getTime() - 2 * day + 10 * 3600000);
          await f.ownerPool.query(`UPDATE canonical_forecast_price_decision_commit_observations
            SET observed_at=$2 WHERE decision_id=$1`,
          [decisionIds[index], new Date(sourceEventAt.getTime() + 3600000)]);
          const changedSource = await f.ownerPool.query(`
            UPDATE canonical_forecast_price_ordered_receipts value
            SET captured_at=$2,
              snapshot_digest=public.canonical_completion_digest(
                jsonb_build_object('version','m26-price-ordered-source-v1',
                  'organizationId',value.organization_id,
                  'coverageStartOrder',value.coverage_start_order,
                  'highWaterOrder',value.high_water_order,
                  'digestNonce',value.digest_nonce,
                  'capturedAt',public.canonical_forecast_utc_instant($2::timestamptz),
                  'events',value.decision_events))
            WHERE id=$1 RETURNING rtrim(snapshot_digest) digest`,
          [receiptIds[index], capturedAt]);
          for (const currentRunId of [runIds[index], zeroRunIds[index]]) {
            const current = await f.ownerPool.query(`SELECT output
              FROM canonical_forecast_price_flow_saved_origins
              WHERE organization_id=$1 AND id=$2`, [f.org, currentRunId]);
            const output = { ...current.rows[0].output,
              asOf: utc(savedAt),
              sourceSnapshotDigest: changedSource.rows[0].digest,
              horizon: { startsAt: utc(horizon), endsAt: utc(horizonEnd),
                grain: 'day' },
              value: { kind: 'point', amount:
                currentRunId === runIds[index] ? '1400.00' : '0.00' },
              evidenceCoverage: { included: 1, excluded: 0, missing: 0,
                stale: 0, conflicting: 0 } };
            const changed = await f.ownerPool.query(`UPDATE
              canonical_forecast_price_flow_saved_origins
              SET saved_at=$3,horizon_start=$4,horizon_end=$5,
                output=$6::jsonb,
                receipt_digest=public.canonical_completion_digest($6::jsonb)
              WHERE organization_id=$1 AND id=$2 RETURNING receipt_digest`,
            [f.org, currentRunId, savedAt, horizon, horizonEnd,
              JSON.stringify(output)]);
            const currentProof = await f.ownerPool.query(`SELECT proof
              FROM canonical_forecast_price_flow_origin_activations
              WHERE organization_id=$1 AND run_id=$2`, [f.org, currentRunId]);
            const proof = { ...currentProof.rows[0].proof,
              savedReceiptDigest: changed.rows[0].receipt_digest,
              captureCommitObservedAt: utc(proofAt),
              horizonStartsAt: utc(horizon) };
            await f.ownerPool.query(`UPDATE canonical_forecast_price_flow_origin_activations
              SET observed_at=$3,proof=$4::jsonb,
                proof_digest=public.canonical_completion_digest($4::jsonb)
              WHERE organization_id=$1 AND run_id=$2`,
            [f.org, currentRunId, proofAt, JSON.stringify(proof)]);
            await f.ownerPool.query(`UPDATE canonical_forecast_price_flow_profile_witnesses
              SET observed_at=$3 WHERE organization_id=$1 AND run_id=$2`,
            [f.org, currentRunId, witnessAt]);
          }
        }
      } finally {
        for (const [table, trigger] of mutable.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      const postHorizon = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
        [...args, owner.csrfToken, key()]);
      expect(postHorizon.rows[0].value.snapshot.eventCount).toBe(50);
      // Leave one candidate outcome absent so governance must refuse an
      // incomplete same-origin comparison before the positive retry.
      for (const runId of [...runIds, ...zeroRunIds.slice(1)]) {
        const actual = await f.runtimePool.query(
          'SELECT public.canonical_forecast_capture_price_flow_actual($1,$2,$3,$4,$5,$6,$7,$8) value',
          [...args, owner.csrfToken, key(), runId,
            postHorizon.rows[0].value.snapshot.id]);
        expect(actual.rows[0].value.state).toBe('price_flow_actual_recorded');
      }
      const evaluation = await request(f.app)
        .post(`${root}/complete-price-flow-evaluations-v2`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(evaluation.status).toBe(201);
      const measurement = await request(f.app)
        .get(`${root}/complete-price-flow-evaluations-v2/${evaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(measurement.status).toBe(200);
      expect(measurement.body.data).toMatchObject({
        state: 'complete_window_measurement_available',
        measurement: { organizationId: f.org,
          evaluationId: evaluation.body.data.evaluationId,
          denominator: { storedOriginCount: 100, matchingContextCount: 50,
            pairedCount: 50 } } });

      const incompleteReview = (await f.runtimePool.query(
        `SELECT public.canonical_forecast_complete_window_governance_review_v2_capture(
          $1,$2,$3,$4,$5,$6,$7) value`,
        [...args, owner.csrfToken, key(),
          evaluation.body.data.evaluationId])).rows[0].value;
      expect(incompleteReview).toMatchObject({
        state: 'complete_window_governance_review_unavailable',
        reason: 'complete_matched_governance_evidence_unavailable' });
      expect((await f.ownerPool.query(`SELECT count(*)::integer count FROM
        canonical_forecast_complete_window_governance_reviews_v2`))
        .rows[0].count).toBe(0);

      const committedCandidateActual = await f.runtimePool.query(
        'SELECT public.canonical_forecast_capture_price_flow_actual($1,$2,$3,$4,$5,$6,$7,$8) value',
        [...args, owner.csrfToken, key(), zeroRunIds[0],
          postHorizon.rows[0].value.snapshot.id]);
      expect(committedCandidateActual.rows[0].value.state).toBe(
        'price_flow_actual_recorded');

      // Hold only the candidate's exact actual-generation advisory lock. The
      // tenant price-decision fence remains free, so this failure proves the
      // Part3D candidate lock rather than an earlier source-ordering guard.
      const candidateLock = await f.ownerPool.connect();
      try {
        await candidateLock.query('BEGIN');
        await candidateLock.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
          [`m26:price-flow-actual:${f.org}:${zeroRunIds[0]}`]);
        await expect(f.runtimePool.query(
          `SELECT public.canonical_forecast_complete_window_governance_review_v2_capture(
            $1,$2,$3,$4,$5,$6,$7) value`,
          [...args, owner.csrfToken, key(),
            evaluation.body.data.evaluationId])).rejects.toMatchObject({
          code: '55P03' });
        expect((await f.ownerPool.query(`SELECT count(*)::integer count FROM
          canonical_forecast_complete_window_governance_reviews_v2`))
          .rows[0].count).toBe(0);
        await candidateLock.query('ROLLBACK');
      } catch (error) {
        await candidateLock.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        candidateLock.release();
      }

      const reviewKey = key();
      const review = await request(f.app)
        .post(`${root}/complete-price-flow-governance-reviews-v2`)
        .set(owner.session.headers).set('Idempotency-Key', reviewKey)
        .send({ evaluationId: evaluation.body.data.evaluationId });
      expect(review.status).toBe(201);
      expect(review.body.data).toMatchObject({
        state: 'complete_window_governance_review_saved', revision: 1,
        replayed: false, internalExperimentOnly: true,
        productionPromotionEligible: false, realForecastEligible: false,
        paidNumericServing: false, forecastServingEnabled: false });
      const replay = await request(f.app)
        .post(`${root}/complete-price-flow-governance-reviews-v2`)
        .set(owner.session.headers).set('Idempotency-Key', reviewKey)
        .send({ evaluationId: evaluation.body.data.evaluationId });
      expect(replay.status).toBe(200);
      expect(replay.body.data).toMatchObject({
        reviewId: review.body.data.reviewId, replayed: true });
      const available = await request(f.app)
        .get(`${root}/complete-price-flow-governance-reviews-v2/${review.body.data.reviewId}`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(available.body.data).toMatchObject({
        state: 'complete_window_governance_review_available',
        storedOriginCount: 100, pairedCount: 50,
        baseAlgorithmVersion: 'm26_price_flow_carry_forward_v1',
        candidateAlgorithmVersion: 'm26_price_flow_zero_baseline_v1',
        humanDecisionRequired: true });
      const foreign = await request(f.app)
        .get(`${root}/complete-price-flow-governance-reviews-v2/${review.body.data.reviewId}`)
        .set('Cookie', f.actors.otherOwner.session.headers.Cookie);
      expect(foreign.body.data).toMatchObject({
        state: 'complete_window_governance_review_unavailable',
        reason: 'governance_review_not_found' });
      const denied = await request(f.app)
        .get(`${root}/complete-price-flow-governance-reviews-v2/${review.body.data.reviewId}`)
        .set('Cookie', f.actors.member.session.headers.Cookie);
      expect(denied.status).toBe(403);

      const selectionKey = key();
      const selectionRequest = { reviewId: review.body.data.reviewId,
        expectedRevision: 0, action: 'promote',
        algorithmVersion: 'm26_price_flow_zero_baseline_v1',
        reversesEventId: null,
        reason: 'Owner reviewed the complete deterministic evidence.',
        reviewDigest: review.body.data.reviewDigest, confirmed: true };
      const selected = await request(f.app)
        .post(`${root}/complete-price-flow-governance-selections-v2`)
        .set(owner.session.headers).set('Idempotency-Key', selectionKey)
        .send(selectionRequest);
      expect(selected.status).toBe(201);
      expect(selected.body.data).toMatchObject({
        state: 'complete_window_governance_selection_recorded', revision: 1,
        action: 'promote', algorithmVersion: 'm26_price_flow_zero_baseline_v1',
        replayed: false, productionPromotionEligible: false,
        realForecastEligible: false, paidNumericServing: false,
        forecastServingEnabled: false });
      const selectedReplay = await request(f.app)
        .post(`${root}/complete-price-flow-governance-selections-v2`)
        .set(owner.session.headers).set('Idempotency-Key', selectionKey)
        .send(selectionRequest);
      expect(selectedReplay.status).toBe(200);
      expect(selectedReplay.body.data.replayed).toBe(true);
      const current = await request(f.app)
        .get(`${root}/complete-price-flow-governance-selections-v2`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(current.body.data).toMatchObject({
        state: 'complete_window_governance_selection_current', revision: 1,
        action: 'promote', rollbackCurrent: false,
        algorithmVersion: 'm26_price_flow_zero_baseline_v1',
        productionPromotionEligible: false, forecastServingEnabled: false });

      const revisedEvaluation = await request(f.app)
        .post(`${root}/complete-price-flow-evaluations-v2`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(revisedEvaluation.status).toBe(201);
      const revisedReview = (await f.runtimePool.query(
        `SELECT public.canonical_forecast_complete_window_governance_review_v2_capture(
          $1,$2,$3,$4,$5,$6,$7) value`,
        [...args, owner.csrfToken, key(),
          revisedEvaluation.body.data.evaluationId])).rows[0].value;
      expect(revisedReview.state).toBe('complete_window_governance_review_saved');
      const rollback = (await f.runtimePool.query(
        `SELECT public.canonical_forecast_complete_window_governance_select_v2(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) value`,
        [...args, owner.csrfToken, key(), revisedReview.reviewId, 1,
          'rollback', 'm26_price_flow_carry_forward_v1',
          selected.body.data.eventId,
          'Owner explicitly restored the compatible prior method.',
          revisedReview.reviewDigest, true])).rows[0].value;
      expect(rollback).toMatchObject({ revision: 2,
        action: 'rollback',
        algorithmVersion: 'm26_price_flow_carry_forward_v1' });

      await expect(f.runtimePool.query(
        `SELECT public.canonical_forecast_complete_window_governance_select_v2(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) value`,
        [...args, 'wrong-csrf-token', key(), revisedReview.reviewId, 2,
          'promote', 'm26_price_flow_zero_baseline_v1', null,
          'This request must fail its explicit CSRF authority check.',
          revisedReview.reviewDigest, true])).rejects.toBeTruthy();
      await expect(f.runtimePool.query(
        `SELECT public.canonical_forecast_complete_window_governance_select_v2(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) value`,
        [...args, owner.csrfToken, key(), revisedReview.reviewId, 0,
          'promote', 'm26_price_flow_zero_baseline_v1', null,
          'This request intentionally carries a stale expected revision.',
          revisedReview.reviewDigest, true])).rejects.toMatchObject({
        code: '23505' });

      const changedMethod = await f.ownerPool.connect();
      try {
        await changedMethod.query('BEGIN');
        await changedMethod.query(`ALTER TABLE
          canonical_forecast_complete_window_governance_methods_v2
          DISABLE TRIGGER m26_complete_window_governance_methods_v2_immutable`);
        await changedMethod.query(`UPDATE
          canonical_forecast_complete_window_governance_methods_v2
          SET dependency_closure_digest=repeat('0',64)`);
        const staleMethod = await changedMethod.query(
          `SELECT public.canonical_forecast_complete_window_governance_review_v2_read(
            $1,$2,$3,$4,$5) value`, [...args, revisedReview.reviewId]);
        expect(staleMethod.rows[0].value).toMatchObject({
          state: 'complete_window_governance_review_stale',
          restartRequired: true });
        await changedMethod.query('ROLLBACK');
      } catch (error) {
        await changedMethod.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        changedMethod.release();
      }

      const laterSource = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
        [...args, owner.csrfToken, key()]);
      const laterActual = await f.runtimePool.query(
        'SELECT public.canonical_forecast_capture_price_flow_actual($1,$2,$3,$4,$5,$6,$7,$8) value',
        [...args, owner.csrfToken, key(), runIds[0],
          laterSource.rows[0].value.snapshot.id]);
      expect(laterActual.rows[0].value).toMatchObject({
        state: 'price_flow_actual_recorded', revision: 2 });
      const staleReview = await request(f.app)
        .get(`${root}/complete-price-flow-governance-reviews-v2/${review.body.data.reviewId}`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(staleReview.body.data).toMatchObject({
        state: 'complete_window_governance_review_stale' });
      const staleSelection = await request(f.app)
        .get(`${root}/complete-price-flow-governance-selections-v2`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(staleSelection.body.data).toMatchObject({
        state: 'complete_window_governance_selection_unavailable',
        reason: 'governance_review_stale' });
      expect(JSON.stringify({ review: available.body.data,
        selected: selected.body.data, rollback }))
        .not.toMatch(/1400\.00|forecastValue|outcomeAmount/);
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_complete_window_governance_reviews_v2'))
        .rejects.toMatchObject({ code: '42501' });
    }, 300000);
});
