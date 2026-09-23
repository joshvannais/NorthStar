'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

realPostgres('Mission 26 approved-price source ordering', () => {
  let fixture;

  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function createEstimate() {
    const operation = uuid(), graph = uuid(), customer = uuid();
    const opportunity = uuid(), estimate = uuid(), fingerprint = hash(uuid());
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
      [estimate, fixture.org, operation, graph, opportunity, fingerprint]);
    return estimate;
  }

  async function waitForLockWait(client) {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const row = (await fixture.ownerPool.query(
        'SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked',
        [client.processID])).rows[0];
      if (row.blocked) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected approval-source lock wait was not observed');
  }

  test('a wall-clock cutoff after a concurrent approval is not complete coverage', async () => {
    const estimate = await createEstimate();
    const actor = fixture.actors.owner;
    const capture = await fixture.runtimePool.connect();
    const writer = await fixture.ownerPool.connect();
    try {
      await capture.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      // Establish the MVCC snapshot before the independent approval commits.
      await capture.query('SELECT 1 FROM public.subscriptions WHERE organization_id=$1',
        [fixture.org]);
      await writer.query('BEGIN');
      const decisionId = uuid();
      await writer.query(
        `INSERT INTO canonical_estimate_decisions(
           id,organization_id,estimate_id,revision,previous_id,action,actor_user_id,
           membership_id,auth_session_id,actor_name,source_pins,scope_summary,
           price_before_tax,currency,reason,confirmation_version,request_key_hash,
           request_digest,digest)
         VALUES($1,$2,$3,1,NULL,'approve',$4,$4,$5,'Synthetic owner','{}',
           'Synthetic scope','500.00','USD','Synthetic approval',
           'estimate-quote-preparation-v1',$6,$7,$8)`,
        [decisionId, fixture.org, estimate, actor.actorUserId,
          actor.authSessionId, hash(uuid()), hash(uuid()), hash(uuid())]);
      await writer.query('COMMIT');

      const snapshot = (await capture.query(
        'SELECT public.canonical_forecast_price_event_snapshot_capture($1,$2,$3,$4,$5,$6) value',
        [fixture.org, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, actor.csrfToken, uuid()])).rows[0].value.snapshot;
      await capture.query('COMMIT');
      const recordedAt = (await fixture.ownerPool.query(
        'SELECT created_at FROM canonical_estimate_decisions WHERE id=$1',
        [decisionId])).rows[0].created_at;
      expect(new Date(snapshot.asOf).getTime()).toBeGreaterThanOrEqual(recordedAt.getTime());
      expect(snapshot.events).toEqual([]);

      const fresh = await fixture.runtimePool.connect();
      try {
        await fresh.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const currentness = (await fresh.query(
          'SELECT public.canonical_forecast_price_event_currentness_read($1,$2,$3,$4,$5) value',
          [fixture.org, actor.actorUserId, actor.actorAccessRole,
            actor.authSessionId, snapshot.id])).rows[0].value;
        await fresh.query('COMMIT');
        expect(currentness).toMatchObject({ state: 'stale',
          capturedEventCount: 0, currentEventCount: 1, forecastIssued: false });
      } finally { fresh.release(); }
    } finally {
      await capture.query('ROLLBACK').catch(() => {});
      await writer.query('ROLLBACK').catch(() => {});
      capture.release();
      writer.release();
    }
  }, 120000);

  test('a serializable procedure still hides a writer committed during its lock wait', async () => {
    const estimate = await createEstimate();
    const actor = fixture.actors.owner;
    const decisionId = uuid();
    await fixture.ownerPool.query(`
      CREATE PROCEDURE public.test_forecast_price_lock_then_capture(
        IN org uuid, IN actor uuid, IN role_value text, IN session_value uuid,
        IN csrf text, IN request_key text, INOUT result jsonb)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        LOCK TABLE public.canonical_estimate_decisions IN SHARE MODE;
        result:=public.canonical_forecast_price_event_snapshot_capture(
          org,actor,role_value,session_value,csrf,request_key);
      END $$`);
    await fixture.ownerPool.query(`GRANT EXECUTE ON PROCEDURE
      public.test_forecast_price_lock_then_capture(uuid,uuid,text,uuid,text,text,jsonb)
      TO "${fixture.roles.runtime}"`);

    const writer = await fixture.ownerPool.connect();
    const capture = await fixture.runtimePool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(
        `INSERT INTO canonical_estimate_decisions(
           id,organization_id,estimate_id,revision,previous_id,action,actor_user_id,
           membership_id,auth_session_id,actor_name,source_pins,scope_summary,
           price_before_tax,currency,reason,confirmation_version,request_key_hash,
           request_digest,digest)
         VALUES($1,$2,$3,1,NULL,'approve',$4,$4,$5,'Synthetic owner','{}',
           'Synthetic scope','500.00','USD','Synthetic approval',
           'estimate-quote-preparation-v1',$6,$7,$8)`,
        [decisionId, fixture.org, estimate, actor.actorUserId,
          actor.authSessionId, hash(uuid()), hash(uuid()), hash(uuid())]);
      await capture.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const pending = capture.query(
        'CALL public.test_forecast_price_lock_then_capture($1,$2,$3,$4,$5,$6,NULL)',
        [fixture.org, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, actor.csrfToken, uuid()]);
      await waitForLockWait(capture);
      await writer.query('COMMIT');
      const result = await pending;
      await capture.query('COMMIT');
      expect(result.rows[0].result.snapshot.events.map(event => event.decisionId))
        .not.toContain(decisionId);
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      await capture.query('ROLLBACK').catch(() => {});
      writer.release();
      capture.release();
    }
  }, 120000);

  test('read committed sees an in-flight writer after the same table lock wait', async () => {
    const estimate = await createEstimate();
    const actor = fixture.actors.owner;
    const before = (await fixture.ownerPool.query(
      'SELECT count(*)::integer AS count FROM canonical_estimate_decisions WHERE organization_id=$1',
      [fixture.org])).rows[0].count;
    await fixture.ownerPool.query(`
      CREATE PROCEDURE public.test_forecast_price_read_committed_fence(
        IN org uuid, INOUT event_count integer)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        LOCK TABLE public.canonical_estimate_decisions IN SHARE MODE;
        SELECT count(*) INTO event_count FROM public.canonical_estimate_decisions
         WHERE organization_id=org;
      END $$`);
    await fixture.ownerPool.query(`GRANT EXECUTE ON PROCEDURE
      public.test_forecast_price_read_committed_fence(uuid,integer)
      TO "${fixture.roles.runtime}"`);

    const writer = await fixture.ownerPool.connect();
    const capture = await fixture.runtimePool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query(
        `INSERT INTO canonical_estimate_decisions(
           id,organization_id,estimate_id,revision,previous_id,action,actor_user_id,
           membership_id,auth_session_id,actor_name,source_pins,scope_summary,
           price_before_tax,currency,reason,confirmation_version,request_key_hash,
           request_digest,digest)
         VALUES($1,$2,$3,1,NULL,'approve',$4,$4,$5,'Synthetic owner','{}',
           'Synthetic scope','500.00','USD','Synthetic approval',
           'estimate-quote-preparation-v1',$6,$7,$8)`,
        [uuid(), fixture.org, estimate, actor.actorUserId,
          actor.authSessionId, hash(uuid()), hash(uuid()), hash(uuid())]);
      await capture.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
      const pending = capture.query(
        'CALL public.test_forecast_price_read_committed_fence($1,NULL)',
        [fixture.org]);
      await waitForLockWait(capture);
      await writer.query('COMMIT');
      const result = await pending;
      await capture.query('COMMIT');
      expect(result.rows[0].event_count).toBe(before + 1);
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      await capture.query('ROLLBACK').catch(() => {});
      writer.release();
      capture.release();
    }
  }, 120000);
});
