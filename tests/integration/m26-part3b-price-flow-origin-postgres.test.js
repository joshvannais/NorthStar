'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } =
  require('../helpers/m24-estimate-review-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const root = '/api/v1/forecast/price-history';
const key = () => crypto.randomUUID();
const utc = day => `${day.toISOString().slice(0, 10)}T00:00:00.000000Z`;

realPostgres('Mission 26 Part 3B supported price-flow prediction origin', () => {
  let f;
  beforeAll(async () => { f = await createEstimateReviewFixture({
    operationalSchedule: true }); }, 120000);
  afterAll(async () => { if (f) await f.cleanup(); }, 120000);
  const owner = () => f.actors.owner;

  async function capturePrice() {
    const response = await request(f.app).post(`${root}/ordered-snapshots`)
      .set(owner().session.headers).set('Idempotency-Key', key()).send({});
    expect(response.status).toBe(201);
    return response.body.data.snapshotId;
  }

  async function capturePriceThroughGuardedSource() {
    // Same production SQL source capture after the test-only HTTP capture
    // allowance is exhausted; this does not bypass source authorization.
    const client = await f.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await client.query(
        'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, owner().csrfToken, key()]);
      await client.query('COMMIT');
      return result.rows[0].value.snapshot.id;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function approve(estimate) {
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const review = await request(f.app).get(`${route}/review`)
      .set(owner().session.headers);
    expect(review.status).toBe(200);
    const response = await request(f.app).post(`${route}/decisions`)
      .set(owner().session.headers).set('Idempotency-Key', key())
      .send({ action: 'approve', expectedRevision: 0,
        expectedDigest: 'none', sourcePins: review.body.data.pins,
        scopeSummary: 'Fictional price-flow work.',
        priceBeforeTax: '1400.00', currency: review.body.data.currency,
        reason: 'Fictional owner price review.', confirmed: true,
        confirmationVersion: 'estimate-quote-preparation-v1' });
    expect(response.status).toBe(201);
    return response.body.data.receipt.id;
  }

  async function shiftSourceDatesForFictionalDay(decisionId, priorStart) {
    // Disposable fixture only: move real M24 writer rows and the prospective
    // source anchor into a completed UTC day. This does not prove real history.
    const date = new Date(priorStart.getTime() + 12 * 60 * 60 * 1000);
    const before = new Date(priorStart.getTime() - 24 * 60 * 60 * 1000);
    const tables = [
      ['canonical_estimate_decisions', 'canonical_estimate_decision_immutable'],
      ['canonical_forecast_price_decision_orders',
        'canonical_forecast_price_decision_order_immutable'],
      ['canonical_forecast_price_ordered_anchors',
        'canonical_forecast_price_ordered_anchors_immutable'],
      ['canonical_forecast_price_anchor_activations',
        'canonical_forecast_price_anchor_activations_immutable'],
    ];
    try {
      for (const [table, trigger] of tables) {
        await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      }
      await f.ownerPool.query(
        'UPDATE canonical_estimate_decisions SET created_at=$2 WHERE id=$1',
        [decisionId, date]);
      await f.ownerPool.query(
        'UPDATE canonical_forecast_price_decision_orders SET ordered_at=$2 WHERE decision_id=$1',
        [decisionId, date]);
      await f.ownerPool.query(
        'UPDATE canonical_forecast_price_ordered_anchors SET coverage_starts_at=$2 WHERE organization_id=$1',
        [f.org, before]);
      await f.ownerPool.query(
        'UPDATE canonical_forecast_price_anchor_activations SET observed_at=$2 WHERE organization_id=$1',
        [f.org, before]);
    } finally {
      for (const [table, trigger] of tables.reverse()) {
        await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
      }
    }
  }

  test('paid M24 writer feeds an immutable uncalibrated saved point with causal origin proof',
    async () => {
      const anchorReceiptId = await capturePrice();
      const activation = await request(f.app)
        .post(`${root}/ordered-anchor/activate`)
        .set(owner().session.headers).send({});
      expect(activation.status).toBe(200);
      const decisionId = await approve(f.estimateGraphs[0].ids.estimate);
      const observed = await request(f.app)
        .post(`${root}/decision-commit-observations`)
        .set(owner().session.headers).send({ decisionId });
      expect(observed.status).toBe(200);
      expect(observed.body.data).toMatchObject({
        state: 'price_decision_commit_observed', decisionId,
        sourceFinalized: false, replayed: false });
      const denied = await request(f.app)
        .post(`${root}/decision-commit-observations`)
        .set(f.actors.member.session.headers).send({ decisionId });
      expect(denied.status).toBe(403);
      const tomorrow = new Date();
      tomorrow.setUTCHours(0, 0, 0, 0);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const priorStart = new Date(tomorrow);
      priorStart.setUTCDate(priorStart.getUTCDate() - 2);
      await shiftSourceDatesForFictionalDay(decisionId, priorStart);
      const snapshotId = await capturePrice();
      const horizonStartsAt = utc(tomorrow);
      const horizonEnd = new Date(tomorrow);
      horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 1);
      const body = { sourceReceiptId: snapshotId, currency: 'USD',
        horizonStartsAt, horizonEndsAt: utc(horizonEnd) };
      const origin = await request(f.app)
        .post(`${root}/saved-price-flow-origins`)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .send(body);
      expect(origin.status).toBe(201);
      expect(origin.body.data).toMatchObject({
        state: 'saved_price_flow_origin', preHorizonCommitVerified: false,
        realForecastEligible: false, forecastValueAvailable: false,
        output: null,
      });
      const runId = origin.body.data.runId;
      const proof = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/activate`)
        .set(owner().session.headers).send({});
      expect(proof.status).toBe(200);
      expect(proof.body.data).toMatchObject({
        state: 'price_flow_origin_activated', preHorizonCommitVerified: true,
        realForecastEligible: false });
      const read = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(read.status).toBe(200);
      expect(read.body.data).toMatchObject({
        runId, preHorizonCommitVerified: true,
        outputDigest: origin.body.data.outputDigest,
        forecastValueAvailable: false, output: null,
      });
      const pendingActual = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-candidates/${snapshotId}`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(pendingActual.status).toBe(200);
      expect(pendingActual.body.data).toMatchObject({
        state: 'price_flow_actual_pending', reason: 'horizon_open',
        amount: null, firstApprovalCount: null,
        outcomeFinalized: false, realForecastEligible: false });
      const stored = await f.ownerPool.query(
        'SELECT output FROM canonical_forecast_price_flow_saved_origins WHERE id=$1',
        [runId]);
      expect(stored.rows[0].output.value.amount).toBe('1400.00');
      const replay = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/activate`)
        .set(owner().session.headers).send({});
      expect(replay.status).toBe(200);
      expect(replay.body.data).toMatchObject({
        state: 'price_flow_origin_activated', replayed: true,
        preHorizonCommitVerified: true });
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_saved_origins'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_origin_activations'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_decision_commit_observations'))
        .rejects.toMatchObject({ code: '42501' });

      // Disposable fixture only: move the already-proven production writer
      // and its immutable receipts to a coherent past UTC window so the
      // post-horizon calculation can execute today. This cannot prove real
      // elapsed history or causal past commits.
      const fictionalStart = new Date(priorStart);
      const fictionalEnd = new Date(fictionalStart.getTime() + 86400000);
      const captureAt = new Date(fictionalStart.getTime() - 12 * 3600000);
      const savedAt = new Date(fictionalStart.getTime() - 10 * 3600000);
      const proofAt = new Date(fictionalStart.getTime() - 9 * 3600000);
      const witnessAt = new Date(fictionalStart.getTime() + 13 * 3600000);
      const triggers = [
        ['canonical_forecast_price_ordered_receipts',
          'canonical_forecast_price_ordered_receipts_immutable'],
        ['canonical_forecast_price_flow_saved_origins',
          'canonical_forecast_price_flow_origins_immutable'],
        ['canonical_forecast_price_flow_origin_activations',
          'canonical_forecast_price_flow_activation_immutable'],
        ['canonical_forecast_price_decision_commit_observations',
          'canonical_forecast_price_decision_commit_immutable'],
      ];
      try {
        for (const [table, trigger] of triggers) {
          await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        }
        const receipt = await f.ownerPool.query(`
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
        [anchorReceiptId, captureAt]);
        const output = { ...stored.rows[0].output,
          asOf: captureAt.toISOString(),
          horizon: { startsAt: fictionalStart.toISOString(),
            endsAt: fictionalEnd.toISOString(), grain: 'day' },
          value: { kind: 'point', amount: '0.00' },
          sourceSnapshotDigest: receipt.rows[0].digest };
        const changed = await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_saved_origins
          SET source_receipt_id=$2,saved_at=$3,horizon_start=$4,horizon_end=$5,
            output=$6::jsonb,
            receipt_digest=public.canonical_completion_digest($6::jsonb)
          WHERE id=$1 RETURNING receipt_digest`,
        [runId, anchorReceiptId, savedAt, fictionalStart, fictionalEnd,
          JSON.stringify(output)]);
        const proofValue = { ...proof.body.data,
          savedReceiptDigest: changed.rows[0].receipt_digest,
          captureCommitObservedAt: proofAt.toISOString(),
          horizonStartsAt: fictionalStart.toISOString() };
        delete proofValue.proofDigest;
        delete proofValue.replayed;
        await f.ownerPool.query(`
          UPDATE canonical_forecast_price_flow_origin_activations
          SET observed_at=$2,proof=$3::jsonb,
            proof_digest=public.canonical_completion_digest($3::jsonb)
          WHERE run_id=$1`, [runId, proofAt, JSON.stringify(proofValue)]);
        await f.ownerPool.query(`
          UPDATE canonical_forecast_price_decision_commit_observations
          SET observed_at=$2 WHERE decision_id=$1`, [decisionId, witnessAt]);
      } finally {
        for (const [table, trigger] of triggers.reverse()) {
          await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
      const postHorizonReceiptId = await capturePrice();
      const actual = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-candidates/${postHorizonReceiptId}`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(actual.status).toBe(200);
      expect(actual.body.data).toMatchObject({
        state: 'price_flow_actual_candidate', amount: null,
        firstApprovalCount: null, selectedSourceFinalizedAtCapture: true,
        outcomeFinalized: false });
      const internalActual = await f.ownerPool.query(
        'SELECT public.canonical_forecast_price_flow_actual_candidate($1,$2,$3,$4,$5,$6) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, runId, postHorizonReceiptId]);
      expect(internalActual.rows[0].value).toMatchObject({
        state: 'price_flow_actual_candidate', amount: '1400.00',
        firstApprovalCount: 1, outcomeFinalized: false });
      try {
        await f.ownerPool.query(`ALTER TABLE
          canonical_forecast_price_decision_commit_observations
          DISABLE TRIGGER canonical_forecast_price_decision_commit_immutable`);
        await f.ownerPool.query(`UPDATE
          canonical_forecast_price_decision_commit_observations
          SET observed_at=$2 WHERE decision_id=$1`, [decisionId, new Date()]);
      } finally {
        await f.ownerPool.query(`ALTER TABLE
          canonical_forecast_price_decision_commit_observations
          ENABLE TRIGGER canonical_forecast_price_decision_commit_immutable`);
      }
      const lateWitness = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-candidates/${postHorizonReceiptId}`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(lateWitness.status).toBe(200);
      expect(lateWitness.body.data).toMatchObject({
        state: 'price_flow_actual_unavailable',
        reason: 'event_commit_boundary_unverified', amount: null,
        outcomeFinalized: false });
      try {
        await f.ownerPool.query(`ALTER TABLE
          canonical_forecast_price_decision_commit_observations
          DISABLE TRIGGER canonical_forecast_price_decision_commit_immutable`);
        await f.ownerPool.query(`UPDATE
          canonical_forecast_price_decision_commit_observations
          SET observed_at=$2 WHERE decision_id=$1`, [decisionId, witnessAt]);
      } finally {
        await f.ownerPool.query(`ALTER TABLE
          canonical_forecast_price_decision_commit_observations
          ENABLE TRIGGER canonical_forecast_price_decision_commit_immutable`);
      }
      const actualKey = key();
      const deniedActual = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/actual-receipts`)
        .set(f.actors.member.session.headers)
        .set('Idempotency-Key', key())
        .send({ sourceReceiptId: postHorizonReceiptId });
      expect(deniedActual.status).toBe(403);
      const savedActual = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/actual-receipts`)
        .set(owner().session.headers).set('Idempotency-Key', actualKey)
        .send({ sourceReceiptId: postHorizonReceiptId });
      expect(savedActual.status).toBe(201);
      expect(savedActual.body.data).toMatchObject({
        state: 'price_flow_actual_recorded', revision: 1,
        actualState: 'known', amount: null, firstApprovalCount: null,
        selectedSourceFinalizedAtCapture: true,
        wholeBusinessCoverageVerified: false,
        realForecastEligible: false });
      const actualReplay = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/actual-receipts`)
        .set(owner().session.headers).set('Idempotency-Key', actualKey)
        .send({ sourceReceiptId: postHorizonReceiptId });
      expect(actualReplay.status).toBe(200);
      expect(actualReplay.body.data).toMatchObject({
        receiptId: savedActual.body.data.receiptId,
        revision: 1, replayed: true,
        amount: null, firstApprovalCount: null });
      const latest = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-receipts/latest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(latest.status).toBe(200);
      expect(latest.body.data).toMatchObject({
        state: 'price_flow_actual_finalized', revision: 1,
        amount: null, firstApprovalCount: null, outcomeFinalized: true,
        wholeBusinessCoverageVerified: false,
        realForecastEligible: false });
      const internalSaved = await f.ownerPool.query(
        'SELECT public.canonical_forecast_price_flow_actual_read($1,$2,$3,$4,$5) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, runId]);
      expect(internalSaved.rows[0].value).toMatchObject({
        state: 'price_flow_actual_finalized', amount: 1400,
        firstApprovalCount: 1, outcomeFinalized: true });
      await expect(f.runtimePool.query(
        'SELECT * FROM canonical_forecast_price_flow_actual_receipts'))
        .rejects.toMatchObject({ code: '42501' });
      const estimate = f.estimateGraphs[0].ids.estimate;
      const route = `/api/v1/canonical/estimates/${estimate}`;
      const current = await request(f.app).get(`${route}/review`)
        .set(owner().session.headers);
      expect(current.status).toBe(200);
      const withdrawal = await request(f.app).post(`${route}/decisions`)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .send({ action: 'withdraw',
          expectedRevision: current.body.data.decisions.current.revision,
          expectedDigest: current.body.data.decisions.current.digest,
          sourcePins: current.body.data.pins, scopeSummary: null,
          priceBeforeTax: null, currency: current.body.data.currency,
          reason: 'Fictional owner withdrawal.', confirmed: true,
          confirmationVersion: 'estimate-quote-preparation-v1' });
      expect(withdrawal.status).toBe(201);
      const stale = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-receipts/latest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(stale.status).toBe(200);
      expect(stale.body.data).toMatchObject({
        state: 'price_flow_actual_unavailable', reason: 'source_changed',
        amount: null, outcomeFinalized: false });
      const correctedSource = await capturePriceThroughGuardedSource();
      const correction = await request(f.app)
        .post(`${root}/saved-price-flow-origins/${runId}/actual-receipts`)
        .set(owner().session.headers).set('Idempotency-Key', key())
        .send({ sourceReceiptId: correctedSource });
      expect(correction.status).toBe(201);
      expect(correction.body.data).toMatchObject({
        state: 'price_flow_actual_recorded', revision: 2,
        actualState: 'revoked', amount: null,
        previousId: savedActual.body.data.receiptId });
      const revised = await request(f.app)
        .get(`${root}/saved-price-flow-origins/${runId}/actual-receipts/latest`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(revised.status).toBe(200);
      expect(revised.body.data).toMatchObject({
        state: 'price_flow_actual_revoked', revision: 2,
        amount: null, outcomeFinalized: false });
      const history = await f.ownerPool.query(
        `SELECT revision,state,amount FROM canonical_forecast_price_flow_actual_receipts
         WHERE run_id=$1 ORDER BY revision`, [runId]);
      expect(history.rows.map(row => row.state)).toEqual(['known', 'revoked']);
      expect(history.rows[0].amount).toBe('1400.00');
    }, 120000);
});
