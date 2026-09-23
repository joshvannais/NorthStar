'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const id = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

realPostgres('Mission 26 source-ordered approved-price receipt', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  const params = actor => [actor.organizationId, actor.actorUserId,
    actor.actorAccessRole, actor.authSessionId];

  async function capture(actor = fixture.actors.owner, requestKey = id()) {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await client.query(
        'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
        [...params(actor), actor.csrfToken, requestKey]);
      await client.query('COMMIT');
      return result.rows[0].value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function read(receiptId, actor = fixture.actors.owner) {
    const result = await fixture.runtimePool.query(
      'SELECT public.canonical_forecast_price_ordered_read($1,$2,$3,$4,$5) value',
      [...params(actor), receiptId]);
    return result.rows[0].value;
  }

  async function privateReceipt(receiptId) {
    const result = await fixture.ownerPool.query(
      `SELECT coverage_start_order,high_water_order,digest_nonce
         FROM canonical_forecast_price_ordered_receipts WHERE id=$1`,
      [receiptId]);
    return result.rows[0];
  }

  async function privateDecisionOrder(decisionId) {
    const result = await fixture.ownerPool.query(
      'SELECT source_order FROM canonical_forecast_price_decision_orders WHERE decision_id=$1',
      [decisionId]);
    return Number(result.rows[0].source_order);
  }

  function expectNoGlobalOrder(value) {
    const serialized = JSON.stringify(value);
    expect(serialized).not.toMatch(
      /"(?:sourceOrder|coverageStartOrder|highWaterOrder|currentHighWaterOrder|digestNonce)"/);
  }

  async function createEstimate(organizationId = fixture.org) {
    const operation = id(), graph = id(), customer = id();
    const opportunity = id(), estimate = id(), fingerprint = hash(id());
    await fixture.ownerPool.query(
      `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
         payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
       VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
      [operation, organizationId, graph, fingerprint]);
    await fixture.ownerPool.query(
      'INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,$5)',
      [customer, organizationId, operation, graph, 'Synthetic customer']);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
         customer_id,status,service_type,job_scope)
       VALUES($1,$2,$3,$4,$5,'qualified','Plumbing','{}')`,
      [opportunity, organizationId, operation, graph, customer]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,
         opportunity_id,calculation_version,normalized_input_fingerprint,
         business_profile_version,business_profile_hash,currency,customer_price,
         line_items,calculation_output,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,'fixture-v1',$6,'org-profile-v1',$6,'USD',500,'[]','{}',$6)`,
      [estimate, organizationId, operation, graph, opportunity, fingerprint]);
    return estimate;
  }

  async function decide(estimate, client = fixture.ownerPool,
    actor = fixture.actors.owner) {
    const decision = id();
    await client.query(
      `INSERT INTO canonical_estimate_decisions(
         id,organization_id,estimate_id,revision,previous_id,action,actor_user_id,
         membership_id,auth_session_id,actor_name,source_pins,scope_summary,
         price_before_tax,currency,reason,confirmation_version,request_key_hash,
         request_digest,digest)
       VALUES($1,$2,$3,1,NULL,'approve',$4,$4,$5,'Synthetic owner','{}',
         'Synthetic scope','500.00','USD','Synthetic approval',
         'estimate-quote-preparation-v1',$6,$7,$8)`,
      [decision, actor.organizationId, estimate, actor.actorUserId,
        actor.authSessionId, hash(id()), hash(id()), hash(id())]);
    return decision;
  }

  test('first fence excludes prior decisions; later fence pins ordered work and replay is immutable',
    async () => {
      const priorEstimate = await createEstimate();
      const priorDecision = await decide(priorEstimate);
      const firstKey = id();
      const first = await capture(fixture.actors.owner, firstKey);
      expect(first.replayed).toBe(false);
      expect(first.snapshot).toMatchObject({ eventCount: 0,
        wholeBusinessCoverageVerified: false, forecastIssued: false });
      const firstPrivate = await privateReceipt(first.snapshot.id);
      expect(firstPrivate.coverage_start_order).toBe(firstPrivate.high_water_order);
      expectNoGlobalOrder(first);
      expect(first.snapshot.events).toEqual([]);
      expect((await read(first.snapshot.id)).state).toBe('current');

      const estimate = await createEstimate();
      const decision = await decide(estimate);
      expect((await read(first.snapshot.id)).state).toBe('stale');
      const second = await capture();
      expect(second.snapshot.events.map(event => event.decisionId)).toEqual([decision]);
      expect(second.snapshot.events.map(event => event.decisionId))
        .not.toContain(priorDecision);
      expect(await privateDecisionOrder(decision)).toBeGreaterThan(
        Number(firstPrivate.high_water_order));
      expectNoGlobalOrder(second);
      expect((await read(second.snapshot.id))).toMatchObject({ state: 'current',
        sourceOrderCurrent: true, calendarPeriodVerified: false,
        eligibleForForecast: false, wholeBusinessCoverageVerified: false,
        forecastIssued: false });
      const replay = await capture(fixture.actors.owner, firstKey);
      expect(replay.replayed).toBe(true);
      expect(replay.snapshot).toEqual(first.snapshot);
      expect((await read(replay.snapshot.id)).state).toBe('stale');
    }, 120000);

  test('owner scope, tenant fence and immutable private source are enforced', async () => {
    await expect(capture(fixture.actors.member)).rejects.toMatchObject({ code: '42501' });
    const saved = await capture();
    await expect(read(saved.snapshot.id, fixture.actors.member))
      .rejects.toMatchObject({ code: '42501' });
    expect(await read(saved.snapshot.id, fixture.actors.otherOwner)).toBeNull();
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_price_ordered_receipts'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_price_ordered_anchors'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'DELETE FROM canonical_forecast_price_ordered_receipts WHERE id=$1',
      [saved.snapshot.id])).rejects.toMatchObject({ code: '23514' });
  }, 120000);

  test('an in-flight writer cannot be omitted; retry captures its committed order', async () => {
    const first = await capture();
    const estimate = await createEstimate();
    const writer = await fixture.ownerPool.connect();
    try {
      await writer.query('BEGIN');
      const decision = await decide(estimate, writer);
      await expect(capture()).rejects.toMatchObject({ code: '55P03' });
      await expect(read(first.snapshot.id)).rejects.toMatchObject({ code: '55P03' });
      await writer.query('COMMIT');
      const next = await capture();
      const capturedDecision = next.snapshot.events.find(event => event.decisionId === decision);
      expect(capturedDecision).toBeDefined();
      expect(await privateDecisionOrder(decision)).toBeGreaterThan(
        Number((await privateReceipt(first.snapshot.id)).high_water_order));
      expect(new Date(capturedDecision.sourceObservedAt).getTime())
        .toBeGreaterThanOrEqual(new Date(first.snapshot.capturedAt).getTime());
      expect((await read(next.snapshot.id)).state).toBe('current');
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
    }
  }, 120000);

  test('rolled-back source-order gaps are never interpreted as missing decisions', async () => {
    const first = await capture();
    const rejectedEstimate = await createEstimate();
    const writer = await fixture.ownerPool.connect();
    try {
      await writer.query('BEGIN');
      await decide(rejectedEstimate, writer);
      await writer.query('ROLLBACK');
    } finally { writer.release(); }
    const acceptedEstimate = await createEstimate();
    const committed = await decide(acceptedEstimate);
    const next = await capture();
    const capturedDecision = next.snapshot.events.find(event => event.decisionId === committed);
    expect(capturedDecision).toBeDefined();
    expect(await privateDecisionOrder(committed)).toBeGreaterThan(
      Number((await privateReceipt(first.snapshot.id)).high_water_order) + 1);
    expect((await read(next.snapshot.id)).sourceOrderCurrent).toBe(true);
  }, 120000);

  test('a backdated Mission 24 created_at remains ordered after the first fence', async () => {
    const estimate = await createEstimate();
    const captureClient = await fixture.runtimePool.connect();
    const writer = await fixture.ownerPool.connect();
    try {
      await captureClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await captureClient.query(
        `SELECT pg_advisory_xact_lock(hashtextextended(
          'm26:price-decision-order:'||$1::text,0))`, [fixture.org]);
      await writer.query('BEGIN');
      const pendingDecision = decide(estimate, writer);
      const deadline = Date.now() + 3000;
      let blocked = false;
      while (Date.now() < deadline) {
        const result = await fixture.ownerPool.query(
          'SELECT pg_blocking_pids($1) AS blockers', [writer.processID]);
        if (result.rows[0].blockers.includes(captureClient.processID)) {
          blocked = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      const first = (await captureClient.query(
        'SELECT public.canonical_forecast_price_ordered_capture($1,$2,$3,$4,$5,$6) value',
        [...params(fixture.actors.owner), fixture.actors.owner.csrfToken, id()]
      )).rows[0].value;
      await captureClient.query('COMMIT');
      const decision = await pendingDecision;
      await writer.query('COMMIT');
      const next = await capture();
      const event = next.snapshot.events.find(value => value.decisionId === decision);
      expect(event).toBeDefined();
      expect(await privateDecisionOrder(decision)).toBeGreaterThan(
        Number((await privateReceipt(first.snapshot.id)).high_water_order));
      expect(new Date(event.recordedAt).getTime())
        .toBeLessThan(new Date(first.snapshot.capturedAt).getTime());
      expect(new Date(event.sourceObservedAt).getTime())
        .toBeGreaterThanOrEqual(new Date(first.snapshot.capturedAt).getTime());
    } finally {
      await captureClient.query('ROLLBACK').catch(() => {});
      await writer.query('ROLLBACK').catch(() => {});
      captureClient.release();
      writer.release();
    }
  }, 120000);

  test('interleaved tenant decisions do not expose global sequence or digest nonce', async () => {
    const ownBefore = await capture();
    const otherEstimate = await createEstimate(fixture.otherOrg);
    const otherDecision = await decide(otherEstimate, fixture.ownerPool,
      fixture.actors.otherOwner);
    const ownEstimate = await createEstimate();
    const ownDecision = await decide(ownEstimate);
    expect(await privateDecisionOrder(ownDecision)).toBeGreaterThan(
      (await privateDecisionOrder(otherDecision)));
    const ownAfter = await capture();
    expectNoGlobalOrder(ownBefore);
    expectNoGlobalOrder(ownAfter);
    expectNoGlobalOrder(await read(ownAfter.snapshot.id));
    expect(ownAfter.snapshot.events.map(event => event.decisionId)).toContain(ownDecision);
    expect(ownAfter.snapshot.events.map(event => event.decisionId)).not.toContain(otherDecision);
    expect((await privateReceipt(ownAfter.snapshot.id)).digest_nonce).toBeDefined();
  }, 120000);
});
