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
      await capturePrice();
      const activation = await request(f.app)
        .post(`${root}/ordered-anchor/activate`)
        .set(owner().session.headers).send({});
      expect(activation.status).toBe(200);
      const decisionId = await approve(f.estimateGraphs[0].ids.estimate);
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
        realForecastEligible: false,
        output: { target: { key: 'revenue.approved_price_flow' },
          value: { kind: 'point', amount: '1400.00' },
          confidence: { state: 'unavailable' } },
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
        output: { value: { amount: '1400.00' } },
      });
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
    }, 120000);
});
