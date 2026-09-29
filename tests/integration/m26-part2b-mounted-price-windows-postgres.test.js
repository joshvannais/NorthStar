'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createEstimateReviewFixture } =
  require('../helpers/m24-estimate-review-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const priceRoot = '/api/v1/forecast/price-history';
const profileRoot = '/api/v1/forecast/reporting-windows/effective-anchors';
const months = { firstLocalStartDate: '2026-03-01',
  secondLocalStartDate: '2026-04-01', currency: 'USD' };

realPostgres('Mission 26 Part 2B mounted M24 price events in selected windows', () => {
  let f;
  beforeAll(async () => { f = await createEstimateReviewFixture({
    operationalSchedule: true }); }, 120000);
  afterAll(async () => { if (f) await f.cleanup(); }, 120000);

  const owner = () => f.actors.owner;
  async function capturePrice() {
    const response = await request(f.app).post(`${priceRoot}/ordered-snapshots`)
      .set(owner().session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({});
    expect(response.status).toBe(201);
    return response.body.data.snapshotId;
  }
  async function establishAnchors() {
    await capturePrice();
    const priceActivation = await request(f.app)
      .post(`${priceRoot}/ordered-anchor/activate`)
      .set(owner().session.headers).send({});
    expect(priceActivation.status).toBe(200);
    const profile = await request(f.app).post(profileRoot)
      .set(owner().session.headers)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Observe the fictional Business Profile.',
        confirmed: true });
    expect(profile.status).toBe(201);
    const profileId = profile.body.data.anchorId;
    const profileActivation = await request(f.app)
      .post(`${profileRoot}/${profileId}/activate`)
      .set(owner().session.headers).send({});
    expect(profileActivation.status).toBe(200);
    return profileId;
  }
  async function decide(estimate, action, price) {
    const route = `/api/v1/canonical/estimates/${estimate}`;
    const current = await request(f.app).get(`${route}/review`)
      .set(owner().session.headers);
    expect(current.status).toBe(200);
    const review = current.body.data;
    const response = await request(f.app).post(`${route}/decisions`)
      .set(owner().session.headers)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ action,
        expectedRevision: review.decisions.current?.revision || 0,
        expectedDigest: review.decisions.current?.digest || 'none',
        sourcePins: review.pins,
        scopeSummary: action === 'approve' ? 'Fictional fence scope.' : null,
        priceBeforeTax: price,
        currency: review.currency, reason: 'Fictional owner price review.',
        confirmed: true, confirmationVersion: 'estimate-quote-preparation-v1' });
    expect(response.status).toBe(201);
    return response.body.data.receipt.id;
  }
  async function compare(snapshotId, profileAnchorId) {
    return request(f.app).get(
      `${priceRoot}/ordered-snapshots/${snapshotId}/comparable-profile-months`)
      .set('Cookie', owner().session.headers.Cookie)
      .query({ profileAnchorId, ...months });
  }
  async function insertHeldDecision(client, estimate, previousId) {
    const id = crypto.randomUUID();
    const hash = () => crypto.createHash('sha256')
      .update(crypto.randomUUID()).digest('hex');
    await client.query(
      `INSERT INTO canonical_estimate_decisions(
       id,organization_id,estimate_id,revision,previous_id,action,
       actor_user_id,membership_id,auth_session_id,actor_name,
       source_pins,scope_summary,price_before_tax,currency,reason,
       confirmation_version,request_key_hash,request_digest,digest)
       VALUES($1,$2,$3,4,$4,'approve',$5,$5,$6,
        'Fictional owner','{}','Later fictional scope','1700.00',
        'USD','Held fictional writer','estimate-quote-preparation-v1',
        $7,$8,$9)`,
      [id, f.org, estimate, previousId, owner().actorUserId,
        owner().authSessionId, hash(), hash(), hash()]);
    return id;
  }
  async function captureGuardedDirect() {
    const runtime = await f.runtimePool.connect();
    try {
      await runtime.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const captured = (await runtime.query(
        'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
        [f.org, owner().actorUserId, owner().actorAccessRole,
          owner().authSessionId, owner().csrfToken,
          crypto.randomUUID()])).rows[0].value;
      await runtime.query('COMMIT');
      return captured.snapshot.id;
    } finally {
      await runtime.query('ROLLBACK').catch(() => {});
      runtime.release();
    }
  }
  async function shiftFictionalDates(profileId, decisionIds) {
    // Disposable database only: these genuine mounted M24 writer rows were
    // created today. Shift immutable timestamps solely to exercise two
    // selected elapsed windows; this is not real history or month-end proof.
    const dates = ['2026-03-12T13:00:00Z', '2026-04-08T13:00:00Z',
      '2026-04-19T13:00:00Z'];
    const tables = [
      ['canonical_estimate_decisions', 'canonical_estimate_decision_immutable'],
      ['canonical_forecast_price_decision_orders',
        'canonical_forecast_price_decision_order_immutable'],
      ['canonical_forecast_price_ordered_anchors',
        'canonical_forecast_price_ordered_anchors_immutable'],
      ['canonical_forecast_price_anchor_activations',
        'canonical_forecast_price_anchor_activations_immutable'],
      ['canonical_forecast_profile_effective_activations',
        'canonical_forecast_profile_effective_activations_immutable'],
    ];
    try {
      for (const [table, trigger] of tables) {
        await f.ownerPool.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      }
      for (let i = 0; i < decisionIds.length; i += 1) {
        await f.ownerPool.query(
          'UPDATE canonical_estimate_decisions SET created_at=$2 WHERE id=$1',
          [decisionIds[i], dates[i]]);
        await f.ownerPool.query(
          'UPDATE canonical_forecast_price_decision_orders SET ordered_at=$2 WHERE decision_id=$1',
          [decisionIds[i], dates[i]]);
      }
      await f.ownerPool.query(
        `UPDATE canonical_forecast_price_ordered_anchors
         SET coverage_starts_at='2026-02-28T11:00:00Z'
         WHERE organization_id=$1`, [f.org]);
      await f.ownerPool.query(
        `UPDATE canonical_forecast_price_anchor_activations
         SET observed_at='2026-02-28T12:00:00Z'
         WHERE organization_id=$1`, [f.org]);
      await f.ownerPool.query(
        `UPDATE canonical_forecast_profile_effective_activations
         SET observed_at='2026-02-28T12:00:00Z'
         WHERE organization_id=$1 AND anchor_id=$2`, [f.org, profileId]);
    } finally {
      for (const [table, trigger] of tables.reverse()) {
        await f.ownerPool.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
      }
    }
  }

  test('genuine mounted approvals and withdrawal are counted in shifted months only at capture',
    async () => {
      const profileId = await establishAnchors();
      const estimate = f.estimateGraphs[0].ids.estimate;
      const first = await decide(estimate, 'approve', '1400.00');
      const changed = await decide(estimate, 'approve', '1600.00');
      const withdrawn = await decide(estimate, 'withdraw', null);
      await shiftFictionalDates(profileId, [first, changed, withdrawn]);
      const snapshotId = await capturePrice();
      const response = await compare(snapshotId, profileId);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        state: 'comparable_supported_source_cohorts_at_capture',
        sourceCohortAsOfCaptureVerified: true,
        observationCoverageVerified: false, wholeBusinessCoverageVerified: false,
        eligibleForForecast: false, forecastIssued: false,
        periods: [
          { sourceInsertTimeDecisionCountKnownAtCapture: 1,
            zeroDecisionsKnownAtCapture: false },
          { sourceInsertTimeDecisionCountKnownAtCapture: 2,
            zeroDecisionsKnownAtCapture: false },
        ],
      });
      const writer = await f.ownerPool.connect();
      try {
        await writer.query('BEGIN');
        await insertHeldDecision(writer, estimate, withdrawn);
        const blocked = await request(f.app)
          .post(`${priceRoot}/ordered-snapshots`)
          .set(owner().session.headers)
          .set('Idempotency-Key', crypto.randomUUID()).send({});
        expect(blocked.status).toBe(409);
        expect(blocked.body.error.category).toBe('FORECAST_SOURCE_BUSY');
        await writer.query('ROLLBACK');
      } finally {
        await writer.query('ROLLBACK').catch(() => {});
        writer.release();
      }
      // The HTTP capture throttle correctly counts the failed attempt. Use
      // the same guarded SQL capture in a fresh committed runtime transaction
      // for the recovery receipt, then read it through the mounted route.
      const afterRollback = await captureGuardedDirect();
      const read = await request(f.app)
        .get(`${priceRoot}/ordered-snapshots/${afterRollback}`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(read.status).toBe(200);
      expect(read.body.data.eventCount).toBe(3);
      const stillComparable = await compare(afterRollback, profileId);
      expect(stillComparable.body.data).toMatchObject({
        state: 'comparable_supported_source_cohorts_at_capture',
        observationCoverageVerified: false,
        periods: [
          { sourceInsertTimeDecisionCountKnownAtCapture: 1 },
          { sourceInsertTimeDecisionCountKnownAtCapture: 2 },
        ],
      });
      const crossing = await f.ownerPool.connect();
      let lateId;
      try {
        await crossing.query('BEGIN');
        lateId = await insertHeldDecision(crossing, estimate, withdrawn);
        // The source event has a tenant order inside an open transaction.
        // A receipt cannot claim a cutoff while its commit is unresolved.
        await expect(captureGuardedDirect())
          .rejects.toMatchObject({ code: '55P03' });
        await crossing.query('COMMIT');
      } finally {
        await crossing.query('ROLLBACK').catch(() => {});
        crossing.release();
      }
      const stale = await compare(afterRollback, profileId);
      expect(stale.body.data).toMatchObject({ state: 'unavailable',
        observationCoverageVerified: false });
      // Test-only late in-period timestamp: commit happened after the first
      // capture. The old immutable receipt stays stale, while a fresh receipt
      // includes the late correction in April. No real month-end is inferred.
      await f.ownerPool.query(
        'ALTER TABLE canonical_estimate_decisions DISABLE TRIGGER canonical_estimate_decision_immutable');
      await f.ownerPool.query(
        'ALTER TABLE canonical_forecast_price_decision_orders DISABLE TRIGGER canonical_forecast_price_decision_order_immutable');
      try {
        await f.ownerPool.query(
          `UPDATE canonical_estimate_decisions
           SET created_at='2026-04-25T13:00:00Z' WHERE id=$1`, [lateId]);
        await f.ownerPool.query(
          `UPDATE canonical_forecast_price_decision_orders
           SET ordered_at='2026-04-25T13:00:00Z' WHERE decision_id=$1`,
          [lateId]);
      } finally {
        await f.ownerPool.query(
          'ALTER TABLE canonical_forecast_price_decision_orders ENABLE TRIGGER canonical_forecast_price_decision_order_immutable');
        await f.ownerPool.query(
          'ALTER TABLE canonical_estimate_decisions ENABLE TRIGGER canonical_estimate_decision_immutable');
      }
      const afterCommit = await captureGuardedDirect();
      const lateRead = await request(f.app)
        .get(`${priceRoot}/ordered-snapshots/${afterCommit}`)
        .set('Cookie', owner().session.headers.Cookie);
      expect(lateRead.body.data).toMatchObject({ state: 'current',
        eventCount: 4 });
      const lateComparison = await compare(afterCommit, profileId);
      expect(lateComparison.body.data).toMatchObject({
        state: 'comparable_supported_source_cohorts_at_capture',
        observationCoverageVerified: false,
        periods: [
          { sourceInsertTimeDecisionCountKnownAtCapture: 1 },
          { sourceInsertTimeDecisionCountKnownAtCapture: 3 },
        ],
      });
    }, 120000);
});
