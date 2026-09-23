'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const id = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

realPostgres('Mission 26 Part 2C guarded approved-estimate stock', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function capture() {
    const actor = fixture.actors.owner;
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await client.query(
        'SELECT public.canonical_forecast_estimate_decision_snapshot_capture($1,$2,$3,$4,$5,$6) value',
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, actor.csrfToken, id()]);
      await client.query('COMMIT');
      return result.rows[0].value.snapshot;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function estimate() {
    const operation = id(), graph = id(), customer = id(), opportunity = id();
    const estimateId = id(), fingerprint = hash(id());
    await fixture.ownerPool.query(
      `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
         payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
       VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
      [operation, fixture.org, graph, fingerprint]);
    await fixture.ownerPool.query(
      'INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name) VALUES($1,$2,$3,$4,$5)',
      [customer, fixture.org, operation, graph, 'Synthetic customer']);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
         customer_id,status,service_type,job_scope)
       VALUES($1,$2,$3,$4,$5,'qualified','Plumbing','{}')`,
      [opportunity, fixture.org, operation, graph, customer]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,
         opportunity_id,calculation_version,normalized_input_fingerprint,
         business_profile_version,business_profile_hash,currency,customer_price,
         line_items,calculation_output,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,'fixture-v1',$6,'org-profile-v1',$6,'USD',500,'[]','{}',$6)`,
      [estimateId, fixture.org, operation, graph, opportunity, fingerprint]);
    return estimateId;
  }

  async function decision(estimateId, action, revision, previousId = null) {
    const actor = fixture.actors.owner, decisionId = id();
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimate_decisions(
         id,organization_id,estimate_id,revision,previous_id,action,actor_user_id,
         membership_id,auth_session_id,actor_name,source_pins,scope_summary,
         price_before_tax,currency,reason,confirmation_version,request_key_hash,
         request_digest,digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,'Synthetic owner','{}',$9,$10,'USD',
         'Synthetic commercial review','estimate-quote-preparation-v1',$11,$12,$13)`,
      [decisionId, fixture.org, estimateId, revision, previousId, action,
        actor.actorUserId, actor.authSessionId,
        action === 'approve' ? 'Synthetic scope' : null,
        action === 'approve' ? '500.00' : null,
        hash(id()), hash(id()), hash(id())]);
    return decisionId;
  }

  test('paid route uses guarded M24 snapshot, masks later changes and withholds private rows', async () => {
    const capturePath = '/api/v1/forecast/features/approved-estimate-stock/snapshots';
    const owner = fixture.actors.owner;
    const requestKey = id();
    expect((await request(fixture.app).post(capturePath)
      .set('Idempotency-Key', id()).send({})).status).toBe(401);
    expect((await request(fixture.app).post(capturePath)
      .set(fixture.actors.member.session.headers)
      .set('Idempotency-Key', id()).send({})).status).toBe(403);
    expect((await request(fixture.app).post(capturePath)
      .set('Cookie', owner.session.headers.Cookie)
      .set('Idempotency-Key', id()).send({})).status).toBe(403);
    expect((await request(fixture.app).post(capturePath)
      .set(owner.session.headers).set('Idempotency-Key', id())
      .send({ organizationId: fixture.org })).status).toBe(400);
    const firstCapture = await request(fixture.app).post(capturePath)
      .set(owner.session.headers).set('Idempotency-Key', requestKey).send({});
    expect(firstCapture.status).toBe(201);
    expect(firstCapture.body.data).toMatchObject({
      state: 'historical_source_only', sourceCount: 0,
      sourceAuthenticated: true, forecastIssued: false, replayed: false });
    expect(firstCapture.body.data).not.toHaveProperty('sources');
    const replay = await request(fixture.app).post(capturePath)
      .set(owner.session.headers).set('Idempotency-Key', requestKey).send({});
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ replayed: true,
      snapshotId: firstCapture.body.data.snapshotId });
    const first = { id: firstCapture.body.data.snapshotId };
    const path = snapshot =>
      `/api/v1/forecast/features/approved-estimate-stock/${snapshot.id}`;
    const ownerCookie = fixture.actors.owner.session.headers.Cookie;
    expect((await request(fixture.app).get(path(first))).status).toBe(401);
    expect((await request(fixture.app).get(path(first))
      .set('Cookie', fixture.actors.member.session.headers.Cookie)).status).toBe(403);
    expect((await request(fixture.app).get(path(first))
      .set('Cookie', fixture.actors.otherOwner.session.headers.Cookie)).status).toBe(404);
    const empty = await request(fixture.app).get(path(first)).set('Cookie', ownerCookie);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toMatchObject({ state: 'known', amount: '0',
      sourceAuthenticated: true, forecastIssued: false });
    expect(empty.headers['cache-control']).toContain('no-store');

    const estimateId = await estimate();
    const approval = await decision(estimateId, 'approve', 1);
    const staleEmpty = await request(fixture.app).get(path(first))
      .set('Cookie', ownerCookie);
    expect(staleEmpty.body.data).toMatchObject({ state: 'stale',
      amount: null, reason: 'source_set_changed', forecastIssued: false });
    const approved = await capture();
    const active = await request(fixture.app).get(path(approved))
      .set('Cookie', ownerCookie);
    expect(active.body.data).toMatchObject({ state: 'known', amount: '1',
      unit: { key: 'count', currency: null, scale: 0 } });
    expect(JSON.stringify(active.body)).not.toContain(approval);
    expect(JSON.stringify(active.body)).not.toContain('500.00');
    await decision(estimateId, 'withdraw', 2, approval);
    expect((await request(fixture.app).get(path(approved))
      .set('Cookie', ownerCookie)).body.data)
      .toMatchObject({ state: 'stale', amount: null });
    const withdrawn = await capture();
    expect((await request(fixture.app).get(path(withdrawn))
      .set('Cookie', ownerCookie)).body.data)
      .toMatchObject({ state: 'known', amount: '0' });
  }, 120000);
});
