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

realPostgres('Mission 26 Part 3C registered M24 population', () => {
  let f;
  beforeAll(async () => { f = await createEstimateReviewFixture({
    operationalSchedule: true }); }, 300000);
  afterAll(async () => { if (f) await f.cleanup(); }, 300000);

  test('startup refuses a missing Part 3C runtime entry and recovers after rollback',
    async () => {
      const client = await f.ownerPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`ALTER FUNCTION
          public.canonical_forecast_price_flow_complete_window(uuid,uuid,text,uuid)
          RENAME TO canonical_forecast_price_flow_complete_window_missing_for_test`);
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(client,
          { runtimeRole: f.roles.runtime })).rejects.toThrow(
          'Runtime database role privilege verification failed');
        await client.query('ROLLBACK');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }

      const recovery = await f.ownerPool.connect();
      try {
        await recovery.query('BEGIN');
        await expect(f.db.grantAndVerifyRuntimeAuthorityForTests(recovery,
          { runtimeRole: f.roles.runtime })).resolves.toBeUndefined();
        await recovery.query('COMMIT');
      } catch (error) {
        await recovery.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        recovery.release();
      }
    }, 300000);

  test('guarded paid window counts sixty source-owned saved origins but withholds sufficiency without outcomes',
    async () => {
      const owner = f.actors.owner;
      const args = [f.org, owner.actorUserId, owner.actorAccessRole,
        owner.authSessionId];
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
      const coverageBefore = new Date(today.getTime() - 4 * day);
      // Disposable fictional fixture: make the prospective M24 source anchor
      // precede the common future origin's prior-day observation window.
      const sourceTriggers = [
        ['canonical_forecast_price_ordered_anchors',
          'canonical_forecast_price_ordered_anchors_immutable'],
        ['canonical_forecast_price_anchor_activations',
          'canonical_forecast_price_anchor_activations_immutable'],
      ];
      try {
        for (const [table, trigger] of sourceTriggers) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        await f.ownerPool.query(`UPDATE canonical_forecast_price_ordered_anchors
          SET coverage_starts_at=$2 WHERE organization_id=$1`,
        [f.org, coverageBefore]);
        await f.ownerPool.query(`UPDATE canonical_forecast_price_anchor_activations
          SET observed_at=$2 WHERE organization_id=$1`,
        [f.org, coverageBefore]);
      } finally {
        for (const [table, trigger] of sourceTriggers.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      const source = await request(f.app).post(`${root}/ordered-snapshots`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(source.status).toBe(201);
      const sourceReceiptId = source.body.data.snapshotId;
      const profile = await request(f.app).post(profileRoot)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ reason: 'Fictional complete daily origin population.',
          confirmed: true });
      expect(profile.status).toBe(201);
      const profileAnchorId = profile.body.data.anchorId;
      const profileActivation = await request(f.app)
        .post(`${profileRoot}/${profileAnchorId}/activate`)
        .set(owner.session.headers).send({});
      expect(profileActivation.status).toBe(200);
      const futureEnd = new Date(future.getTime() + day);
      const runIds = [];
      for (let index = 0; index < 60; index += 1) {
        // Each receipt is created through the actual mounted source-owned SQL
        // functions and committed before its separate activation/witness.
        const saved = await f.runtimePool.query(
          'SELECT public.canonical_forecast_capture_price_flow_origin($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
          [...args, owner.csrfToken, key(), sourceReceiptId, 'USD',
            future, futureEnd]);
        expect(saved.rows[0].value.state).toBe('saved_price_flow_origin');
        const runId = saved.rows[0].value.runId;
        runIds.push(runId);
        const proof = await f.runtimePool.query(
          'SELECT public.canonical_forecast_activate_price_flow_origin($1,$2,$3,$4,$5,$6) value',
          [...args, owner.csrfToken, runId]);
        expect(proof.rows[0].value.state).toBe('price_flow_origin_activated');
        const witness = await f.runtimePool.query(
          'SELECT public.canonical_forecast_price_flow_profile_observe($1,$2,$3,$4,$5,$6,$7) value',
          [...args, owner.csrfToken, runId, profileAnchorId]);
        expect(witness.rows[0].value.state).toBe('profile_witness_recorded');
      }
      expect(new Set(runIds).size).toBe(60);
      // Shift only the disposable fixture clocks to 60 distinct completed
      // UTC days. This does not prove actual elapsed production chronology.
      const start = new Date(today.getTime() - 60 * day);
      const sourceCaptured = new Date(start.getTime() - 12 * 3600000);
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
        ['canonical_forecast_price_ordered_anchors',
          'canonical_forecast_price_ordered_anchors_immutable'],
        ['canonical_forecast_price_anchor_activations',
          'canonical_forecast_price_anchor_activations_immutable'],
      ];
      try {
        for (const [table, trigger] of mutable) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
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
        [sourceReceiptId, sourceCaptured]);
        expect(changedSource.rows).toHaveLength(1);
        const sourceDigest = changedSource.rows[0].digest;
        const profileCaptured = new Date(start.getTime() - 13 * 3600000);
        await f.ownerPool.query(`UPDATE canonical_forecast_profile_effective_anchors
          SET captured_at=$2 WHERE id=$1`, [profileAnchorId, profileCaptured]);
        await f.ownerPool.query(`UPDATE canonical_forecast_profile_effective_activations
          SET observed_at=$2 WHERE anchor_id=$1`,
        [profileAnchorId, new Date(profileCaptured.getTime() + 3600000)]);
        await f.ownerPool.query(`UPDATE canonical_forecast_price_ordered_anchors
          SET coverage_starts_at=$2 WHERE organization_id=$1`,
        [f.org, profileCaptured]);
        await f.ownerPool.query(`UPDATE canonical_forecast_price_anchor_activations
          SET observed_at=$2 WHERE organization_id=$1`,
        [f.org, new Date(profileCaptured.getTime() + 3600000)]);
        for (let index = 0; index < 60; index += 1) {
          const horizon = new Date(start.getTime() + index * day);
          const horizonEnd = new Date(horizon.getTime() + day);
          const savedAt = new Date(horizon.getTime() - 10 * 3600000);
          const proofAt = new Date(horizon.getTime() - 9 * 3600000);
          const witnessAt = new Date(horizon.getTime() - 8 * 3600000);
          const current = await f.ownerPool.query(`
            SELECT output FROM canonical_forecast_price_flow_saved_origins
            WHERE organization_id=$1 AND id=$2`, [f.org, runIds[index]]);
          const output = { ...current.rows[0].output,
            asOf: utc(savedAt), sourceSnapshotDigest: sourceDigest,
            horizon: { startsAt: utc(horizon), endsAt: utc(horizonEnd),
              grain: 'day' } };
          const changed = await f.ownerPool.query(`
            UPDATE canonical_forecast_price_flow_saved_origins
            SET saved_at=$3,horizon_start=$4,horizon_end=$5,
              output=$6::jsonb,
              receipt_digest=public.canonical_completion_digest($6::jsonb)
            WHERE organization_id=$1 AND id=$2 RETURNING receipt_digest`,
          [f.org, runIds[index], savedAt, horizon, horizonEnd,
            JSON.stringify(output)]);
          const currentProof = await f.ownerPool.query(`
            SELECT proof FROM canonical_forecast_price_flow_origin_activations
            WHERE organization_id=$1 AND run_id=$2`, [f.org, runIds[index]]);
          const proof = { ...currentProof.rows[0].proof,
            savedReceiptDigest: changed.rows[0].receipt_digest,
            captureCommitObservedAt: utc(proofAt),
            horizonStartsAt: utc(horizon) };
          await f.ownerPool.query(`
            UPDATE canonical_forecast_price_flow_origin_activations
            SET observed_at=$3,proof=$4::jsonb,
              proof_digest=public.canonical_completion_digest($4::jsonb)
            WHERE organization_id=$1 AND run_id=$2`,
          [f.org, runIds[index], proofAt, JSON.stringify(proof)]);
          await f.ownerPool.query(`
            UPDATE canonical_forecast_price_flow_profile_witnesses
            SET observed_at=$3 WHERE organization_id=$1 AND run_id=$2`,
          [f.org, runIds[index], witnessAt]);
        }
      } finally {
        for (const [table, trigger] of mutable.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      const response = await request(f.app)
        .get(`${root}/complete-price-flow-evaluation-window`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        state: 'evaluation_window_descriptive_only',
        policy: { denominator: { expectedUtcDays: 60,
          matchingContextCount: 60, missingSavedOriginDays: 0,
          duplicateSavedOriginDays: 0, registeredWindowComplete: true,
          pairedCount: 0 },
          sampleSufficiency: { state: 'unavailable',
            reason: 'finalized_outcomes_incomplete' },
          realAccuracyAvailable: false, realForecastEligible: false },
        numericalErrorAvailable: false,
      });
      expect(JSON.stringify(response.body.data)).not.toContain('amount');
      expect(response.body.data).not.toHaveProperty('digest');
      const missingEvaluation = await request(f.app)
        .post(`${root}/complete-price-flow-evaluations-v2`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(missingEvaluation.status).toBe(201);
      const missingMeasurement = await request(f.app)
        .get(`${root}/complete-price-flow-evaluations-v2/${missingEvaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(missingMeasurement.status).toBe(200);
      expect(missingMeasurement.body.data).toMatchObject({
        state: 'complete_window_measurement_available',
        measurement: {
          version: 'm26-complete-window-measurement-v2',
          evaluationId: missingEvaluation.body.data.evaluationId,
          denominator: { storedOriginCount: 60, matchingContextCount: 60,
            pairedCount: 0, missingCount: 60, excludedCount: 0,
            unsavedOriginCoverageVerified: false },
          applicability: { state: 'supported_source_only',
            target: { key: 'revenue.approved_price_flow',
              definitionVersion: 'v1' },
            unit: { key: 'money', currency: 'USD' },
            sourceApplicability: { serviceKey: null, areaKey: null,
              limits: ['northstar_m24_only', 'uncalibrated_carry_forward'] },
            algorithmVersion: 'm26-rolling-backtest-v1',
            calculationVersion: 'm26_price_flow_carry_forward_v1',
            horizon: { grain: 'day', expectedUtcDays: 60 },
            dataRecency: { state: 'descriptive_only' },
            excludedConditions: { contextChangedCount: 0,
              missingOutcomeCount: 60, revokedOutcomeCount: 0,
              excludedOutcomeCount: 0, unsavedOriginCoverageVerified: false,
              providerCoverageVerified: false,
              wholeBusinessCoverageVerified: false } },
          descriptiveError: { state: 'unavailable',
            reason: 'no_paired_actuals', pairedCount: 0 },
          intervalCoverage: { state: 'not_applicable',
            reason: 'point_only_target' },
          sampleSufficiency: { state: 'unavailable',
            reason: 'finalized_outcomes_incomplete' },
          calibration: { state: 'unavailable',
            reason: 'point_only_no_nominal_interval' },
          observationLag: { state: 'unavailable',
            reason: 'no_paired_actuals', actualCommitLagVerified: false },
          realAccuracyAvailable: false, calibrationAvailable: false,
          realForecastEligible: false,
        },
      });
      expect(JSON.stringify(missingMeasurement.body.data))
        .not.toMatch(/forecastValue|outcomeAmount|1400\.00/);
      const sourceWindow = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_complete_window($1,$2,$3,$4) value',
        args);
      const diversity = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_event_diversity($1,$2,$3,$4,$5,$6::jsonb) value',
        [...args, sourceWindow.rows[0].value.anchorRunId,
          JSON.stringify(sourceWindow.rows[0].value.origins)]);
      expect(diversity.rows[0].value).toMatchObject({
        state: 'source_event_diversity_observed',
        sourceEventDiversityVerified: false,
        distinctSourceEventCount: 0,
      });
      const changedAnchor = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_event_diversity($1,$2,$3,$4,$5,$6::jsonb) value',
        [...args, crypto.randomUUID(),
          JSON.stringify(sourceWindow.rows[0].value.origins)]);
      expect(changedAnchor.rows[0].value).toMatchObject({
        state: 'source_event_diversity_unavailable',
        sourceEventDiversityVerified: false,
      });
      const postHorizonSource = await request(f.app)
        .post(`${root}/ordered-snapshots`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(postHorizonSource.status).toBe(201);
      for (const runId of runIds) {
        const actual = await f.runtimePool.query(
          'SELECT public.canonical_forecast_capture_price_flow_actual($1,$2,$3,$4,$5,$6,$7,$8) value',
          [...args, owner.csrfToken, key(), runId,
            postHorizonSource.body.data.snapshotId]);
        expect(actual.rows[0].value).toMatchObject({
          state: 'price_flow_actual_recorded', actualState: 'known',
          selectedSourceFinalizedAtCapture: true });
        // Direct function capture emulates a still-serving pre-183 process:
        // it does not call the observer, but the migration-installed source
        // trigger supplies a durable marker after the legacy write commits.
        const beforeObservation = await f.runtimePool.query(
          'SELECT public.canonical_forecast_price_flow_actual_read($1,$2,$3,$4,$5) value',
          [...args, runId]);
        expect(beforeObservation.rows[0].value).toMatchObject({
          state: 'price_flow_actual_finalized',
          receiptId: actual.rows[0].value.receiptId,
        });
        const commitObservation = await f.runtimePool.query(
          'SELECT public.canonical_forecast_observe_price_flow_actual_commit($1,$2,$3,$4,$5,$6) value',
          [...args, owner.csrfToken, actual.rows[0].value.receiptId]);
        expect(commitObservation.rows[0].value).toMatchObject({
          state: 'price_flow_actual_commit_observed', runId,
          receiptId: actual.rows[0].value.receiptId,
          replayed: true,
        });
      }
      const paired = await request(f.app)
        .get(`${root}/complete-price-flow-evaluation-window`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(paired.status).toBe(200);
      expect(paired.body.data).toMatchObject({
        state: 'evaluation_window_descriptive_only',
        policy: { denominator: { registeredWindowComplete: true,
          pairedCount: 60 }, reference: { pairedCount: 30 },
          later: { pairedCount: 30 },
          sampleSufficiency: { state: 'unavailable',
            reason: 'source_snapshot_concentration' },
          drift: { state: 'descriptive_only',
            empiricalDriftVerdictAvailable: false },
          realAccuracyAvailable: false, realForecastEligible: false },
        numericalErrorAvailable: false,
      });
      expect(JSON.stringify(paired.body.data)).not.toContain('amount');
      const pairedEvaluation = await request(f.app)
        .post(`${root}/complete-price-flow-evaluations-v2`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(pairedEvaluation.status).toBe(201);
      const pairedMeasurement = await request(f.app)
        .get(`${root}/complete-price-flow-evaluations-v2/${pairedEvaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(pairedMeasurement.status).toBe(200);
      expect(pairedMeasurement.body.data).toMatchObject({
        state: 'complete_window_measurement_available',
        measurement: {
          version: 'm26-complete-window-measurement-v2',
          evaluationId: pairedEvaluation.body.data.evaluationId,
          denominator: { storedOriginCount: 60, matchingContextCount: 60,
            pairedCount: 60, missingCount: 0, excludedCount: 0,
            unsavedOriginCoverageVerified: false },
          applicability: { state: 'supported_source_only',
            target: { key: 'revenue.approved_price_flow',
              definitionVersion: 'v1' },
            sourceApplicability: { serviceKey: null, areaKey: null,
              limits: ['northstar_m24_only', 'uncalibrated_carry_forward'] },
            algorithmVersion: 'm26-rolling-backtest-v1',
            calculationVersion: 'm26_price_flow_carry_forward_v1',
            horizon: { grain: 'day', expectedUtcDays: 60 },
            dataRecency: { state: 'descriptive_only' },
            excludedConditions: { contextChangedCount: 0,
              missingOutcomeCount: 0, revokedOutcomeCount: 0,
              excludedOutcomeCount: 0 } },
          descriptiveError: { state: 'descriptive_only', pairedCount: 60,
            unit: 'money' },
          intervalCoverage: { state: 'not_applicable',
            reason: 'point_only_target' },
          sampleSufficiency: { state: 'unavailable',
            reason: 'source_event_diversity_unverified' },
          calibration: { state: 'unavailable',
            reason: 'point_only_no_nominal_interval' },
          observationLag: { state: 'descriptive_only',
            policyMaxUtcDays: 60, actualCommitLagVerified: false },
          drift: { state: 'unavailable',
            reason: 'source_event_diversity_unverified',
            empiricalDriftVerdictAvailable: false },
          realAccuracyAvailable: false, calibrationAvailable: false,
          realForecastEligible: false,
        },
      });
      expect(pairedMeasurement.body.data.measurement.digest)
        .toMatch(/^[0-9a-f]{64}$/);
      expect(pairedMeasurement.body.data.measurement.drift)
        .not.toHaveProperty('reviewedRule');
      expect(pairedMeasurement.body.data.measurement.drift)
        .not.toHaveProperty('reviewAction');
      expect(JSON.stringify(pairedMeasurement.body.data))
        .not.toMatch(/forecastValue|outcomeAmount|1400\.00/);
      const malformed = await f.ownerPool.connect();
      try {
        await malformed.query('BEGIN');
        await malformed.query(`ALTER TABLE
          canonical_forecast_price_flow_saved_origins
          DISABLE TRIGGER canonical_forecast_price_flow_origins_immutable`);
        await malformed.query(`ALTER TABLE
          canonical_forecast_price_flow_origin_activations
          DISABLE TRIGGER canonical_forecast_price_flow_activation_immutable`);
        await malformed.query(`ALTER TABLE
          canonical_forecast_complete_window_evaluations_v2
          DISABLE TRIGGER canonical_forecast_complete_window_evaluations_v2_immutable`);
        await malformed.query(`WITH rewritten AS (
          SELECT id,jsonb_set(output,'{target}',
            (output->'target')-'definitionVersion') next_output
          FROM canonical_forecast_price_flow_saved_origins
          WHERE organization_id=$1)
          UPDATE canonical_forecast_price_flow_saved_origins saved
          SET output=rewritten.next_output,
            receipt_digest=public.canonical_completion_digest(
              rewritten.next_output)
          FROM rewritten WHERE saved.id=rewritten.id`, [f.org]);
        await malformed.query(`WITH rewritten AS (
          SELECT activation.run_id,jsonb_set(activation.proof,
            '{savedReceiptDigest}',to_jsonb(saved.receipt_digest)) next_proof
          FROM canonical_forecast_price_flow_origin_activations activation
          JOIN canonical_forecast_price_flow_saved_origins saved
            ON saved.organization_id=activation.organization_id
           AND saved.id=activation.run_id
          WHERE activation.organization_id=$1)
          UPDATE canonical_forecast_price_flow_origin_activations activation
          SET proof=rewritten.next_proof,
            proof_digest=public.canonical_completion_digest(
              rewritten.next_proof)
          FROM rewritten WHERE activation.run_id=rewritten.run_id`, [f.org]);
        await malformed.query(`WITH rebuilt AS (
          SELECT public.canonical_forecast_complete_window_evidence_v2(
            $1,$2,$3,$4) value), rewritten AS (
          SELECT $5::uuid id,value->'evidence' next_evidence
          FROM rebuilt WHERE value->>'state'='complete_window_evidence_current')
          UPDATE canonical_forecast_complete_window_evaluations_v2 saved
          SET evidence=rewritten.next_evidence,
            evidence_digest=public.canonical_completion_digest(
              rewritten.next_evidence)
          FROM rewritten WHERE saved.id=rewritten.id`,
        [...args, pairedEvaluation.body.data.evaluationId]);
        const rejected = await malformed.query(
          `SELECT public.canonical_forecast_complete_window_measurement_v2(
            $1,$2,$3,$4,$5) value`,
          [...args, pairedEvaluation.body.data.evaluationId]);
        expect(rejected.rows[0].value).toMatchObject({
          state: 'complete_window_measurement_unavailable',
          reason: 'forecast_context_invalid', realAccuracyAvailable: false,
          calibrationAvailable: false, realForecastEligible: false,
        });
        await malformed.query('ROLLBACK');
      } catch (error) {
        await malformed.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        malformed.release();
      }
      const pairedMeasurementReplay = await request(f.app)
        .get(`${root}/complete-price-flow-evaluations-v2/${pairedEvaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(pairedMeasurementReplay.body.data).toEqual(pairedMeasurement.body.data);
      const foreignMeasurement = await request(f.app)
        .get(`${root}/complete-price-flow-evaluations-v2/${pairedEvaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', f.actors.otherOwner.session.headers.Cookie);
      expect(foreignMeasurement.body.data).toEqual({
        state: 'complete_window_measurement_unavailable',
        reason: 'evaluation_not_found', realAccuracyAvailable: false,
        calibrationAvailable: false, realForecastEligible: false,
      });
      const deniedMeasurement = await request(f.app)
        .get(`${root}/complete-price-flow-evaluations-v2/${pairedEvaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', f.actors.member.session.headers.Cookie);
      expect(deniedMeasurement.status).toBe(403);
      const estimateId = f.estimateGraphs[0].ids.estimate;
      const review = await request(f.app)
        .get(`/api/v1/canonical/estimates/${estimateId}/review`)
        .set(owner.session.headers);
      expect(review.status).toBe(200);
      const approval = await request(f.app)
        .post(`/api/v1/canonical/estimates/${estimateId}/decisions`)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ action: 'approve', expectedRevision: 0,
          expectedDigest: 'none', sourcePins: review.body.data.pins,
          scopeSummary: 'Fictional later-window price-flow work.',
          priceBeforeTax: '1400.00', currency: review.body.data.currency,
          reason: 'Fictional owner price review.', confirmed: true,
          confirmationVersion: 'estimate-quote-preparation-v1' });
      expect(approval.status).toBe(201);
      const decisionId = approval.body.data.receipt.id;
      const observed = await request(f.app)
        .post(`${root}/decision-commit-observations`)
        .set(owner.session.headers).send({ decisionId });
      expect(observed.status).toBe(200);
      const eventAt = new Date(start.getTime() + 45 * day + 12 * 3600000);
      const decisionTriggers = [
        ['canonical_estimate_decisions', 'canonical_estimate_decision_immutable'],
        ['canonical_forecast_price_decision_orders',
          'canonical_forecast_price_decision_order_immutable'],
        ['canonical_forecast_price_decision_commit_observations',
          'canonical_forecast_price_decision_commit_immutable'],
      ];
      try {
        for (const [table, trigger] of decisionTriggers) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        // Disposable fixture only: place the genuine M24 approval and its
        // commit witness in the later 30-day half before source capture.
        await f.ownerPool.query(`UPDATE canonical_estimate_decisions
          SET created_at=$2 WHERE id=$1`, [decisionId, eventAt]);
        await f.ownerPool.query(`UPDATE canonical_forecast_price_decision_orders
          SET ordered_at=$2::timestamptz + interval '123 microseconds'
          WHERE decision_id=$1`, [decisionId, eventAt]);
        await f.ownerPool.query(`UPDATE canonical_forecast_price_decision_commit_observations
          SET observed_at=$2 WHERE decision_id=$1`,
        [decisionId, new Date(eventAt.getTime() + 3600000)]);
      } finally {
        for (const [table, trigger] of decisionTriggers.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      const changedSource = await request(f.app)
        .post(`${root}/ordered-snapshots`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(changedSource.status).toBe(201);
      for (const runId of runIds) {
        const revision = await f.runtimePool.query(
          'SELECT public.canonical_forecast_capture_price_flow_actual($1,$2,$3,$4,$5,$6,$7,$8) value',
          [...args, owner.csrfToken, key(), runId,
            changedSource.body.data.snapshotId]);
        expect(revision.rows[0].value).toMatchObject({
          state: 'price_flow_actual_recorded', actualState: 'known',
          revision: 2 });
        const commitObservation = await f.runtimePool.query(
          'SELECT public.canonical_forecast_observe_price_flow_actual_commit($1,$2,$3,$4,$5,$6) value',
          [...args, owner.csrfToken, revision.rows[0].value.receiptId]);
        expect(commitObservation.rows[0].value).toMatchObject({
          state: 'price_flow_actual_commit_observed', runId,
          receiptId: revision.rows[0].value.receiptId,
        });
      }
      const changed = await request(f.app)
        .get(`${root}/complete-price-flow-evaluation-window`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(changed.status).toBe(200);
      expect(changed.body.data).toMatchObject({
        state: 'evaluation_window_descriptive_only',
        policy: { denominator: { registeredWindowComplete: true,
          pairedCount: 60 }, reference: { pairedCount: 30 },
          later: { pairedCount: 30 }, drift: { state: 'descriptive_only',
            direction: 'higher_error', empiricalDriftVerdictAvailable: false },
          sampleSufficiency: { state: 'unavailable' },
          realAccuracyAvailable: false, realForecastEligible: false },
        numericalErrorAvailable: false });
      expect(JSON.stringify(changed.body.data)).not.toContain('1400.00');
      const staleMeasurement = await request(f.app)
        .get(`${root}/complete-price-flow-evaluations-v2/${pairedEvaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(staleMeasurement.status).toBe(200);
      expect(staleMeasurement.body.data).toMatchObject({
        state: 'complete_window_measurement_stale',
        evaluationId: pairedEvaluation.body.data.evaluationId,
        restartRequired: true, realAccuracyAvailable: false,
        calibrationAvailable: false, realForecastEligible: false,
      });
      const revisedEvaluation = await request(f.app)
        .post(`${root}/complete-price-flow-evaluations-v2`)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(revisedEvaluation.status).toBe(201);
      const positiveMeasurement = await request(f.app)
        .get(`${root}/complete-price-flow-evaluations-v2/${revisedEvaluation.body.data.evaluationId}/measurement`)
        .set('Cookie', owner.session.headers.Cookie);
      expect(positiveMeasurement.body.data).toMatchObject({
        state: 'complete_window_measurement_available',
        measurement: { denominator: { pairedCount: 60 },
          descriptiveError: { state: 'descriptive_only', pairedCount: 60 },
          realAccuracyAvailable: false, calibrationAvailable: false,
          realForecastEligible: false },
      });
      expect(Number(positiveMeasurement.body.data.measurement
        .descriptiveError.totalAbsolute)).toBeGreaterThan(0);
      expect(JSON.stringify(positiveMeasurement.body.data))
        .not.toMatch(/forecastValue|outcomeAmount/);
      // Disposable owner-only chronology fixture: bind one of the saved
      // origins to the genuine M24 source receipt containing the day-45
      // approval, including its nonzero microsecond source order. The prior
      // 60 unchanged snapshots must not count as 60 source event days.
      const reboundCapture = new Date(start.getTime() + 46 * day +
        13 * 3600000);
      const reboundRunId = runIds[47];
      const reboundTriggers = [
        ['canonical_forecast_price_ordered_receipts',
          'canonical_forecast_price_ordered_receipts_immutable'],
        ['canonical_forecast_price_flow_saved_origins',
          'canonical_forecast_price_flow_origins_immutable'],
        ['canonical_forecast_price_flow_origin_activations',
          'canonical_forecast_price_flow_activation_immutable'],
      ];
      try {
        for (const [table, trigger] of reboundTriggers) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        const reboundSource = await f.ownerPool.query(`
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
        [changedSource.body.data.snapshotId, reboundCapture]);
        const currentRun = await f.ownerPool.query(`
          SELECT output,saved_at FROM canonical_forecast_price_flow_saved_origins
          WHERE organization_id=$1 AND id=$2`, [f.org, reboundRunId]);
        const output = { ...currentRun.rows[0].output,
          asOf: utc(currentRun.rows[0].saved_at),
          sourceSnapshotDigest: reboundSource.rows[0].digest,
          value: { kind: 'point', amount: '1400.00' },
          evidenceCoverage: { included: 1, excluded: 0, missing: 0,
            stale: 0, conflicting: 0 } };
        const rebound = await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_saved_origins
          SET source_receipt_id=$3,output=$4::jsonb,
            receipt_digest=public.canonical_completion_digest($4::jsonb)
          WHERE organization_id=$1 AND id=$2 RETURNING receipt_digest`,
        [f.org, reboundRunId, changedSource.body.data.snapshotId,
          JSON.stringify(output)]);
        const currentProof = await f.ownerPool.query(`
          SELECT proof FROM canonical_forecast_price_flow_origin_activations
          WHERE organization_id=$1 AND run_id=$2`, [f.org, reboundRunId]);
        const proof = { ...currentProof.rows[0].proof,
          savedReceiptDigest: rebound.rows[0].receipt_digest };
        await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_origin_activations
          SET proof=$3::jsonb,
            proof_digest=public.canonical_completion_digest($3::jsonb)
          WHERE organization_id=$1 AND run_id=$2`,
        [f.org, reboundRunId, JSON.stringify(proof)]);
      } finally {
        for (const [table, trigger] of reboundTriggers.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      const reboundWindow = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_complete_window($1,$2,$3,$4) value',
        args);
      const reboundDiversity = await f.runtimePool.query(
        'SELECT public.canonical_forecast_price_flow_event_diversity($1,$2,$3,$4,$5,$6::jsonb) value',
        [...args, reboundWindow.rows[0].value.anchorRunId,
          JSON.stringify(reboundWindow.rows[0].value.origins)]);
      expect(reboundDiversity.rows[0].value).toMatchObject({
        state: 'source_event_diversity_observed',
        sourceEventDiversityVerified: false,
        distinctSourceEventCount: 1,
      });
    }, 300000);
});
