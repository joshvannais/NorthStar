'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 price order preserves the Mission 24 decision writer', () => {
  let fixture;
  beforeAll(async () => { fixture = await createEstimateReviewFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('approved decisions, replay and concurrent revision conflict retain exact ordered rows', async () => {
    const estimate = fixture.estimateGraphs[0].ids.estimate;
    const path = `/api/v1/canonical/estimates/${estimate}`;
    const review = async () => {
      const response = await request(fixture.app).get(`${path}/review`)
        .set(fixture.actors.owner.session.headers);
      expect(response.status).toBe(200);
      return response.body.data;
    };
    const post = (actor, body, key) => request(fixture.app)
      .post(`${path}/decisions`)
      .set(fixture.actors[actor].session.headers)
      .set('X-CSRF-Token', fixture.actors[actor].csrfToken)
      .set('Idempotency-Key', key)
      .send(body);
    const bodyFor = current => ({
      action: 'approve', expectedRevision: current.decisions.current?.revision || 0,
      expectedDigest: current.decisions.current?.digest || 'none',
      sourcePins: current.pins, scopeSummary: 'Synthetic reviewed fence replacement.',
      priceBeforeTax: '1400.00', currency: current.currency,
      reason: 'Synthetic owner confirmation.', confirmed: true,
      confirmationVersion: 'estimate-quote-preparation-v1',
    });

    const firstBody = bodyFor(await review());
    const firstKey = crypto.randomUUID();
    const first = await post('owner', firstBody, firstKey);
    expect(first.status).toBe(201);
    const firstId = first.body.data.receipt.id;
    const replay = await post('owner', firstBody, firstKey);
    expect(replay.status).toBe(200);
    expect(replay.body.data.receipt.id).toBe(firstId);

    const contenderBody = bodyFor(await review());
    const contenders = await Promise.all([
      post('owner', { ...contenderBody, priceBeforeTax: '1500.00' }, crypto.randomUUID()),
      post('admin', { ...contenderBody, priceBeforeTax: '1600.00' }, crypto.randomUUID()),
    ]);
    expect(contenders.map(value => value.status).sort()).toEqual([201, 409]);
    const secondId = contenders.find(value => value.status === 201).body.data.receipt.id;
    const rows = (await fixture.ownerPool.query(
      `SELECT orders.decision_id, orders.source_order, decision.revision
       FROM public.canonical_forecast_price_decision_orders orders
       JOIN public.canonical_estimate_decisions decision
         ON decision.organization_id=orders.organization_id
        AND decision.id=orders.decision_id
       WHERE orders.organization_id=$1 AND decision.estimate_id=$2
       ORDER BY orders.source_order`, [fixture.org, estimate])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.map(value => value.decision_id)).toEqual([firstId, secondId]);
    expect(rows.map(value => Number(value.revision))).toEqual([1, 2]);
    expect(BigInt(rows[1].source_order)).toBeGreaterThan(BigInt(rows[0].source_order));
  }, 120000);
});
