'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { readPriceDecisionLineage } = require('../../src/forecasting/priceDecisionLineage');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const key = () => crypto.randomUUID();

realPostgres('Mission 26 guarded approved-price event source', () => {
  let fixture;

  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function capture(actor = fixture.actors.owner, idempotencyKey = key()) {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await client.query(
        'SELECT public.canonical_forecast_price_event_snapshot_capture($1,$2,$3,$4,$5,$6) value',
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, actor.csrfToken, idempotencyKey]);
      await client.query('COMMIT');
      return result.rows[0].value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function currentness(actor, snapshotId) {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await client.query(
        'SELECT public.canonical_forecast_price_event_currentness_read($1,$2,$3,$4,$5) value',
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, snapshotId]);
      await client.query('COMMIT');
      return result.rows[0].value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function estimate() {
    const operation = key(), graph = key(), customer = key(), opportunity = key();
    const estimateId = key(), fingerprint = hash(key());
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

  async function decision(estimateId, action, revision, previousId = null, price = '500.00',
    client = fixture.ownerPool) {
    const actor = fixture.actors.owner, id = key();
    await client.query(
      `INSERT INTO canonical_estimate_decisions(
         id,organization_id,estimate_id,revision,previous_id,action,actor_user_id,
         membership_id,auth_session_id,actor_name,source_pins,scope_summary,
         price_before_tax,currency,reason,confirmation_version,request_key_hash,
         request_digest,digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,'Synthetic owner','{}',$9,$10,'USD',
         'Explicit synthetic commercial review','estimate-quote-preparation-v1',$11,$12,$13)`,
      [id, fixture.org, estimateId, revision, previousId, action,
        actor.actorUserId, actor.authSessionId,
        action === 'approve' ? 'Synthetic scope' : null,
        action === 'approve' ? price : null, hash(key()), hash(key()), hash(key())]);
    return id;
  }

  test('freezes all decision events, including amendment and withdrawal, with exact replay', async () => {
    const requestKey = key();
    const empty = await capture(fixture.actors.owner, requestKey);
    expect(empty.snapshot).toMatchObject({ eventCount: 0,
      purposeKey: 'forecast_approved_price_flow',
      targetKey: 'revenue.approved_price_flow' });
    expect(await currentness(fixture.actors.owner, empty.snapshot.id))
      .toMatchObject({ state: 'current', capturedEventCount: 0,
        currentEventCount: 0, forecastIssued: false });
    const estimateId = await estimate();
    const firstId = await decision(estimateId, 'approve', 1);
    const first = await capture();
    expect(first.snapshot.events).toEqual([expect.objectContaining({
      estimateId, decisionId: firstId, revision: 1, action: 'approve',
      priceBeforeTax: '500.00', currency: 'USD' })]);
    expect(await currentness(fixture.actors.owner, empty.snapshot.id))
      .toMatchObject({ state: 'stale', capturedEventCount: 0,
        currentEventCount: 1 });
    const secondId = await decision(estimateId, 'approve', 2, firstId, '650.00');
    const second = await capture();
    expect(second.snapshot.events.map(event => event.decisionId)).toEqual([firstId, secondId]);
    expect(second.snapshot.events.map(event => event.priceBeforeTax)).toEqual(['500.00', '650.00']);
    expect(await currentness(fixture.actors.owner, first.snapshot.id))
      .toMatchObject({ state: 'stale', capturedEventCount: 1,
        currentEventCount: 2 });
    const withdrawalId = await decision(estimateId, 'withdraw', 3, secondId);
    const withdrawn = await capture();
    expect(withdrawn.snapshot.events.map(event => event.decisionId))
      .toEqual([firstId, secondId, withdrawalId]);
    expect(withdrawn.snapshot.events[2].priceBeforeTax).toBeNull();
    expect(withdrawn.snapshot.sourceSnapshotDigest).not.toBe(second.snapshot.sourceSnapshotDigest);
    const latest = await currentness(fixture.actors.owner, withdrawn.snapshot.id);
    expect(latest).toMatchObject({ state: 'current', capturedEventCount: 3,
      currentEventCount: 3, forecastIssued: false });
    expect(latest.capturedEventsDigest).toBe(latest.currentEventsDigest);
    expect(await currentness(fixture.actors.owner, second.snapshot.id))
      .toMatchObject({ state: 'stale', currentEventCount: 3 });
    const authorized = await readPriceDecisionLineage({ pool: fixture.runtimePool,
      actor: fixture.actors.owner, snapshotId: withdrawn.snapshot.id });
    expect(authorized).toMatchObject({ state: 'historical_source_only',
      historicalSourceReadAuthorized: true, currentnessVerified: false,
      forecastIssued: false, lineage: { sourceAuthenticated: false,
        estimates: [expect.objectContaining({ currentState: 'withdrawn',
          amendmentCount: 1, withdrawalCount: 1,
          firstApproval: expect.objectContaining({ priceBeforeTax: '500.00' }) })] } });
    const earlier = await readPriceDecisionLineage({ pool: fixture.runtimePool,
      actor: fixture.actors.owner, snapshotId: first.snapshot.id });
    expect(earlier.lineage.estimates[0]).toMatchObject({ currentState: 'approved',
      amendmentCount: 0, withdrawalCount: 0 });
    const replay = await capture(fixture.actors.owner, requestKey);
    expect(replay).toEqual({ snapshot: empty.snapshot, replayed: true });
    expect(first.snapshot.events).toHaveLength(1);
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_forecast_price_event_snapshots SET purpose_key=purpose_key WHERE id=$1',
      [first.snapshot.id])).rejects.toMatchObject({ code: '23514' });
  }, 120000);

  test('denies member, cross-tenant and direct runtime source access', async () => {
    await expect(capture(fixture.actors.member)).rejects.toMatchObject({ code: '42501' });
    await expect(capture({ ...fixture.actors.member, actorAccessRole: null }))
      .rejects.toMatchObject({ code: '42501' });
    await expect(capture({ ...fixture.actors.owner, csrfToken: 'invalid-csrf' }))
      .rejects.toMatchObject({ code: '42501' });
    const savedKey = key();
    const saved = await capture(fixture.actors.owner, savedKey);
    const readSql = 'SELECT public.canonical_forecast_price_event_snapshot_read($1,$2,$3,$4,$5) value';
    const owner = fixture.actors.owner;
    const read = await fixture.runtimePool.query(readSql,
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId, saved.snapshot.id]);
    expect(read.rows[0].value.sourceSnapshotDigest).toBe(saved.snapshot.sourceSnapshotDigest);
    const member = fixture.actors.member;
    await expect(fixture.runtimePool.query(readSql,
      [fixture.org, member.actorUserId, null, member.authSessionId, saved.snapshot.id]))
      .rejects.toMatchObject({ code: '42501' });
    await fixture.ownerPool.query(
      "UPDATE organization_memberships SET role='member' WHERE organization_id=$1 AND user_id=$2",
      [fixture.org, owner.actorUserId]);
    try {
      await expect(capture({ ...owner, actorAccessRole: null }, savedKey))
        .rejects.toMatchObject({ code: '42501' });
      await expect(fixture.runtimePool.query(readSql,
        [fixture.org, owner.actorUserId, null, owner.authSessionId, saved.snapshot.id]))
        .rejects.toMatchObject({ code: '42501' });
    } finally {
      await fixture.ownerPool.query(
        "UPDATE organization_memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2",
        [fixture.org, owner.actorUserId]);
    }
    const other = fixture.actors.otherOwner;
    const otherRead = await fixture.runtimePool.query(readSql,
      [fixture.otherOrg, other.actorUserId, other.actorAccessRole,
        other.authSessionId, saved.snapshot.id]);
    expect(otherRead.rows[0].value).toBeNull();
    await expect(fixture.runtimePool.query('SELECT * FROM canonical_forecast_price_event_snapshots'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT public.canonical_forecast_price_decision_events($1,NOW())', [fixture.org]))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT public.canonical_forecast_price_event_currentness_read($1,$2,$3,$4,$5)',
      [fixture.org, owner.actorUserId, owner.actorAccessRole,
        owner.authSessionId, saved.snapshot.id]))
      .rejects.toMatchObject({ code: '25001' });
    await expect(currentness({ ...member, actorAccessRole: null }, saved.snapshot.id))
      .rejects.toMatchObject({ code: '42501' });
    await fixture.ownerPool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1", [fixture.org]);
    try {
      await expect(fixture.runtimePool.query(readSql,
        [fixture.org, owner.actorUserId, owner.actorAccessRole,
          owner.authSessionId, saved.snapshot.id])).rejects.toMatchObject({ code: '42501' });
      await expect(capture()).rejects.toMatchObject({ code: '42501' });
    } finally {
      await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1", [fixture.org]);
    }
  }, 120000);
});
