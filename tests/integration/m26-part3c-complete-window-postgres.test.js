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
            asOf: utc(sourceCaptured), sourceSnapshotDigest: sourceDigest,
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
            reason: 'unsaved_and_off_platform_coverage_unverified' },
          drift: { state: 'descriptive_only',
            empiricalDriftVerdictAvailable: false },
          realAccuracyAvailable: false, realForecastEligible: false },
        numericalErrorAvailable: false,
      });
      expect(JSON.stringify(paired.body.data)).not.toContain('amount');
    }, 300000);
});
