'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { createForecastFeaturesRouter } = require('../../src/routes/forecastFeatures');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

realPostgres('Mission 26 Part 2A target-complete approved-estimate v2', () => {
  let fixture;
  let app;
  beforeAll(async () => {
    fixture = await createDatabaseFixture();
    app = express();
    app.use(express.json());
    app.use('/api/v1/forecast/features', createForecastFeaturesRouter({
      poolProvider: () => fixture.runtimePool,
      throttle: (_req, _res, next) => next(),
      captureThrottle: (_req, _res, next) => next(),
    }));
  }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function seedEstimateSource(actorName = 'owner') {
    const actor = fixture.actors[actorName];
    const org = actor.organizationId;
    const operation = uuid(), graph = uuid(), customer = uuid(), transcript = uuid();
    const opportunity = uuid(), estimate = uuid(), fingerprint = hash(uuid());
    await fixture.ownerPool.query(
      `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
       payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
       VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
      [operation, org, graph, fingerprint]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name)
       VALUES($1,$2,$3,$4,'Fictional approved-estimate customer')`,
      [customer, org, operation, graph]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,
       customer_id,source,source_version,transcript_text,normalized_fingerprint)
       VALUES($1,$2,$3,$4,$5,'lead','fixture','Fictional request',$6)`,
      [transcript, org, operation, graph, customer, fingerprint]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
       customer_id,status,service_type,job_scope)
       VALUES($1,$2,$3,$4,$5,'qualified','Plumbing','{}')`,
      [opportunity, org, operation, graph, customer]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,
       opportunity_id,calculation_version,normalized_input_fingerprint,
       business_profile_version,business_profile_hash,currency,customer_price,
       line_items,calculation_output,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,'fixture-v2',$6,'org-profile-v1',$6,
        'USD',500,'[]','{}',$6)`,
      [estimate, org, operation, graph, opportunity, fingerprint]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_polaris_snapshots(id,organization_id,operation_id,graph_id,
       customer_id,transcript_id,opportunity_id,estimate_id,calculation_version,
       normalized_input_fingerprint,business_profile_version,business_profile_hash,
       supporting_fact_ids,snapshot,snapshot_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'fixture-v2',$9,'org-profile-v1',$9,
        '{}','{}',$9)`,
      [uuid(), org, operation, graph, customer, transcript, opportunity, estimate, fingerprint]);
    const sourcePins = (await fixture.ownerPool.query(
      'SELECT canonical_estimate_decision_source($1,$2) pins', [org, estimate])).rows[0].pins;
    return { estimate, sourcePins, actor };
  }

  async function mutate(source, { action = 'approve', expectedRevision = 0,
    expectedDigest = 'none', client = null } = {}) {
    const actor = source.actor;
    const connection = client || await fixture.runtimePool.connect();
    const ownsConnection = !client;
    try {
      if (ownsConnection) await connection.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const value = (await connection.query(
        `SELECT canonical_estimate_decision_mutate($1,$2,$3,$4,$5,$6,$7,$8) value`,
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, source.estimate, actor.csrfToken,
          `m26-p2a-v2-decision-${uuid()}`, {
            action, expectedRevision, expectedDigest, sourcePins: source.sourcePins,
            scopeSummary: action === 'approve' ? 'Fictional approved estimate' : null,
            priceBeforeTax: action === 'approve' ? '500.00' : null,
            currency: 'USD', reason: `Fictional ${action} decision.`, confirmed: true,
            confirmationVersion: 'estimate-quote-preparation-v1',
          }])).rows[0].value;
      if (ownsConnection) await connection.query('COMMIT');
      return value.receipt;
    } catch (error) {
      if (ownsConnection) await connection.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { if (ownsConnection) connection.release(); }
  }

  function capture(actorName = 'owner', key = `m26-p2a-v2-capture-${uuid()}`,
    csrf = null) {
    const actor = fixture.actors[actorName];
    const call = request(app)
      .post('/api/v1/forecast/features/approved-estimate-stock/v2/snapshots')
      .set(actor.session.headers).set('Idempotency-Key', key).send({});
    return csrf === null ? call : call.set('X-CSRF-Token', csrf);
  }

  function read(actorName, snapshotId) {
    return request(app)
      .get(`/api/v1/forecast/features/approved-estimate-stock/v2/${snapshotId}`)
      .set(fixture.actors[actorName].session.headers);
  }

  test('captures complete zero, replays, and marks genuine approval/correction/withdrawal stale', async () => {
    const zeroKey = `m26-p2a-v2-zero-${uuid()}`;
    const zero = await capture('owner', zeroKey);
    expect(zero.status).toBe(201);
    expect(zero.body.data).toMatchObject({ state: 'current', sourceCount: 0,
      targetComplete: true, sourceAuthenticated: true,
      providerCoverageVerified: false, wholeBusinessCoverageVerified: false,
      forecastIssued: false });
    const zeroReplay = await capture('owner', zeroKey);
    expect(zeroReplay.status).toBe(200);
    expect(zeroReplay.headers['idempotency-replayed']).toBe('true');
    expect(zeroReplay.body.data).toMatchObject({ snapshotId: zero.body.data.snapshotId,
      replayed: true });

    const source = await seedEstimateSource();
    const approval = await mutate(source);
    expect((await read('owner', zero.body.data.snapshotId)).body.data)
      .toMatchObject({ state: 'stale', sourceCurrent: false,
        reason: 'source_changed', forecastIssued: false });

    const first = await capture();
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ state: 'current', sourceCount: 1,
      targetComplete: true });
    const correction = await mutate(source, { expectedRevision: 1,
      expectedDigest: approval.digest });
    expect((await read('admin', first.body.data.snapshotId)).body.data)
      .toMatchObject({ state: 'stale', sourceCurrent: false });

    const corrected = await capture('admin');
    expect(corrected.status).toBe(201);
    expect(corrected.body.data.sourceCount).toBe(1);
    await mutate(source, { action: 'withdraw', expectedRevision: 2,
      expectedDigest: correction.digest });
    expect((await read('owner', corrected.body.data.snapshotId)).body.data)
      .toMatchObject({ state: 'stale', sourceCurrent: false });
    const withdrawn = await capture();
    expect(withdrawn.status).toBe(201);
    expect(withdrawn.body.data).toMatchObject({ state: 'current', sourceCount: 0,
      targetComplete: true });

    const crossTenant = await read('otherOwner', withdrawn.body.data.snapshotId);
    expect(crossTenant.status).toBe(404);
    expect(JSON.stringify(crossTenant.body)).not.toMatch(/sourceCount|digest|current/i);
    expect((await capture('member')).status).toBe(403);
    expect((await capture('owner', undefined, 'invalid-csrf')).status).toBe(403);
  }, 120000);

  test('refuses an in-flight genuine M24 writer, then includes it after commit', async () => {
    const source = await seedEstimateSource();
    const writer = await fixture.runtimePool.connect();
    try {
      await writer.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await mutate(source, { client: writer });
      const before = await fixture.ownerPool.query(
        `SELECT count(*)::integer count
         FROM canonical_forecast_approved_estimate_v2_snapshots
         WHERE organization_id=$1`, [fixture.org]);
      const busy = await capture();
      expect(busy.status).toBe(409);
      expect(busy.body.error).toMatchObject({ category: 'FORECAST_SOURCE_BUSY' });
      const during = await fixture.ownerPool.query(
        `SELECT count(*)::integer count
         FROM canonical_forecast_approved_estimate_v2_snapshots
         WHERE organization_id=$1`, [fixture.org]);
      expect(during.rows[0].count).toBe(before.rows[0].count);
      await writer.query('COMMIT');
      const included = await capture();
      expect(included.status).toBe(201);
      expect(included.body.data).toMatchObject({ state: 'current', sourceCount: 1,
        targetComplete: true });
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      writer.release();
    }
  }, 120000);

  test('enforces pin and byte bounds without partially persisting a receipt', async () => {
    const actor = fixture.actors.otherOwner;
    const org = actor.organizationId;
    const bulk = await fixture.ownerPool.connect();
    try {
      await bulk.query('BEGIN');
      await bulk.query(
        `CREATE TEMP TABLE m26_part2a_bulk ON COMMIT DROP AS
         SELECT series,
          gen_random_uuid() operation_id,gen_random_uuid() graph_id,
          gen_random_uuid() customer_id,gen_random_uuid() opportunity_id,
          gen_random_uuid() estimate_id,
          encode(sha256(convert_to($1||series::text,'UTF8')),'hex') fingerprint
         FROM generate_series(1,1001) series`, [uuid()]);
      await bulk.query(
        `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
         payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
         SELECT operation_id,$1,graph_id,fingerprint,fingerprint,'completed',operation_id,
          NOW()+INTERVAL '1 hour',200,'{}',NOW() FROM m26_part2a_bulk`, [org]);
      await bulk.query(
        `INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name)
         SELECT customer_id,$1,operation_id,graph_id,'Fictional bounded customer'
         FROM m26_part2a_bulk`, [org]);
      await bulk.query(
        `INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
         customer_id,status,service_type,job_scope)
         SELECT opportunity_id,$1,operation_id,graph_id,customer_id,'qualified','Plumbing','{}'
         FROM m26_part2a_bulk`, [org]);
      await bulk.query(
        `INSERT INTO canonical_estimates(id,organization_id,operation_id,graph_id,
         opportunity_id,calculation_version,normalized_input_fingerprint,
         business_profile_version,business_profile_hash,currency,customer_price,
         line_items,calculation_output,snapshot_digest)
         SELECT estimate_id,$1,operation_id,graph_id,opportunity_id,'fixture-bound-v2',fingerprint,
          'org-profile-v1',fingerprint,'USD',500,'[]','{}',fingerprint
         FROM m26_part2a_bulk`, [org]);
      await bulk.query(
        `INSERT INTO canonical_estimate_decisions(id,organization_id,estimate_id,
         revision,previous_id,action,actor_user_id,membership_id,auth_session_id,
         actor_name,source_pins,scope_summary,price_before_tax,currency,reason,
         confirmation_version,request_key_hash,request_digest,digest)
         SELECT gen_random_uuid(),$1,estimate_id,1,NULL,'approve',$2,$2,$3,
          'Fictional other owner','{}','Fictional bounded approval','500.00','USD',
          'Fictional bounded approval','estimate-quote-preparation-v1',
          encode(sha256(convert_to(estimate_id::text||':key','UTF8')),'hex'),
          encode(sha256(convert_to(estimate_id::text||':request','UTF8')),'hex'),
          encode(sha256(convert_to(estimate_id::text||':digest','UTF8')),'hex')
         FROM m26_part2a_bulk`, [org, actor.actorUserId, actor.authSessionId]);
      await bulk.query('COMMIT');
    } catch (error) {
      await bulk.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { bulk.release(); }
    expect((await fixture.ownerPool.query(
      `SELECT jsonb_array_length(canonical_forecast_approved_estimate_v2_pins($1)) count`,
      [org])).rows[0].count).toBe(1001);
    expect((await capture('otherOwner')).body.error)
      .toMatchObject({ category: 'FORECAST_SOURCE_CAPACITY' });
    expect((await fixture.ownerPool.query(
      `SELECT count(*)::integer count FROM canonical_forecast_approved_estimate_v2_snapshots
       WHERE organization_id=$1`, [org])).rows[0].count).toBe(0);

    const selected = (await fixture.ownerPool.query(
      `SELECT estimate_id,id FROM canonical_estimate_decisions
       WHERE organization_id=$1 ORDER BY estimate_id LIMIT 1`, [org])).rows[0];
    await fixture.ownerPool.query(
      `INSERT INTO canonical_estimate_decisions(id,organization_id,estimate_id,
       revision,previous_id,action,actor_user_id,membership_id,auth_session_id,
       actor_name,source_pins,scope_summary,price_before_tax,currency,reason,
       confirmation_version,request_key_hash,request_digest,digest)
       VALUES($1,$2,$3,2,$4,'withdraw',$5,$5,$6,'Fictional other owner','{}',
        NULL,NULL,'USD','Fictional bounded withdrawal','estimate-quote-preparation-v1',
        $7,$8,$9)`,
      [uuid(), org, selected.estimate_id, selected.id, actor.actorUserId,
        actor.authSessionId, hash(uuid()), hash(uuid()), hash(uuid())]);
    const bounded = (await fixture.ownerPool.query(
      `SELECT jsonb_array_length(pins) count,octet_length(pins::text) bytes
       FROM (SELECT canonical_forecast_approved_estimate_v2_pins($1) pins) source`,
      [org])).rows[0];
    expect(bounded.count).toBe(1000);
    expect(bounded.bytes).toBeGreaterThan(262144);
    expect((await capture('otherOwner')).body.error)
      .toMatchObject({ category: 'FORECAST_SOURCE_CAPACITY' });
    expect((await fixture.ownerPool.query(
      `SELECT count(*)::integer count FROM canonical_forecast_approved_estimate_v2_snapshots
       WHERE organization_id=$1`, [org])).rows[0].count).toBe(0);
  }, 120000);

  test('keeps correction-heavy history bounded by one writer-owned current row', async () => {
    const source = await seedEstimateSource();
    const first = await mutate(source);
    const client = await fixture.ownerPool.connect();
    try {
      await client.query(`CREATE FUNCTION pg_temp.m26_part2a_history(
       org uuid,estimate uuid,actor uuid,session_value uuid,first_id uuid)
       RETURNS void LANGUAGE plpgsql AS $body$
       DECLARE prior uuid:=first_id;next_id uuid;revision_value bigint;
       BEGIN
        FOR revision_value IN 2..1501 LOOP
         next_id:=gen_random_uuid();
         INSERT INTO canonical_estimate_decisions(id,organization_id,estimate_id,
          revision,previous_id,action,actor_user_id,membership_id,auth_session_id,
          actor_name,source_pins,scope_summary,price_before_tax,currency,reason,
          confirmation_version,request_key_hash,request_digest,digest)
         VALUES(next_id,org,estimate,revision_value,prior,'approve',actor,actor,
          session_value,'Fictional owner','{}','Correction-heavy approved estimate',
          '500.00','USD','Fictional bounded correction','estimate-quote-preparation-v1',
          encode(sha256(convert_to(next_id::text||':key','UTF8')),'hex'),
          encode(sha256(convert_to(next_id::text||':request','UTF8')),'hex'),
          encode(sha256(convert_to(next_id::text||':digest','UTF8')),'hex'));
         prior:=next_id;
        END LOOP;
        next_id:=gen_random_uuid();
        INSERT INTO canonical_estimate_decisions(id,organization_id,estimate_id,
         revision,previous_id,action,actor_user_id,membership_id,auth_session_id,
         actor_name,source_pins,scope_summary,price_before_tax,currency,reason,
         confirmation_version,request_key_hash,request_digest,digest)
        VALUES(next_id,org,estimate,1502,prior,'withdraw',actor,actor,session_value,
         'Fictional owner','{}',NULL,NULL,'USD','Fictional bounded withdrawal',
         'estimate-quote-preparation-v1',
         encode(sha256(convert_to(next_id::text||':key','UTF8')),'hex'),
         encode(sha256(convert_to(next_id::text||':request','UTF8')),'hex'),
         encode(sha256(convert_to(next_id::text||':digest','UTF8')),'hex'));
       END $body$`);
      await client.query('SELECT pg_temp.m26_part2a_history($1,$2,$3,$4,$5)',
        [source.actor.organizationId, source.estimate, source.actor.actorUserId,
          source.actor.authSessionId, first.id]);
    } finally { client.release(); }
    expect((await fixture.ownerPool.query(
      `SELECT count(*)::integer count FROM canonical_estimate_decisions
       WHERE organization_id=$1 AND estimate_id=$2`,
      [source.actor.organizationId, source.estimate])).rows[0].count).toBe(1502);
    expect((await fixture.ownerPool.query(
      `SELECT count(*)::integer count FROM canonical_forecast_approved_estimate_v2_current_sources
       WHERE organization_id=$1 AND estimate_id=$2 AND action='withdraw'`,
      [source.actor.organizationId, source.estimate])).rows[0].count).toBe(1);
    const result = await capture();
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({ state: 'current', targetComplete: true });
  }, 120000);

  test('rechecks paid authority at persistence and private-return boundaries', async () => {
    const actor = fixture.actors.owner;
    const before = (await fixture.ownerPool.query(
      `SELECT count(*)::integer count FROM canonical_forecast_approved_estimate_v2_snapshots
       WHERE organization_id=$1`, [actor.organizationId])).rows[0].count;
    await fixture.ownerPool.query(`CREATE FUNCTION public.m26_part2a_test_pause()
      RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(1.2);RETURN NEW;END$$`);
    await fixture.ownerPool.query(`CREATE TRIGGER aaa_m26_part2a_test_pause
      BEFORE INSERT ON canonical_forecast_approved_estimate_v2_snapshots
      FOR EACH ROW EXECUTE FUNCTION public.m26_part2a_test_pause()`);
    await fixture.ownerPool.query(
      `WITH clock_value AS (SELECT clock_timestamp() value)
       UPDATE subscriptions SET status='trialing',
        trial_started_at=clock_value.value-INTERVAL '14 days'+INTERVAL '600 ms',
        trial_ends_at=clock_value.value+INTERVAL '600 ms'
       FROM clock_value WHERE organization_id=$1`, [actor.organizationId]);
    try {
      expect((await capture()).status).toBe(403);
      expect((await fixture.ownerPool.query(
        `SELECT count(*)::integer count FROM canonical_forecast_approved_estimate_v2_snapshots
         WHERE organization_id=$1`, [actor.organizationId])).rows[0].count).toBe(before);
    } finally {
      await fixture.ownerPool.query(
        'DROP TRIGGER IF EXISTS aaa_m26_part2a_test_pause ON canonical_forecast_approved_estimate_v2_snapshots');
      await fixture.ownerPool.query('DROP FUNCTION IF EXISTS public.m26_part2a_test_pause()');
      await fixture.ownerPool.query(
        `UPDATE subscriptions SET status='active',trial_started_at=NULL,trial_ends_at=NULL
         WHERE organization_id=$1`, [actor.organizationId]);
    }

    const current = await capture();
    expect(current.status).toBe(201);
    const revoker = await fixture.ownerPool.connect();
    try {
      await revoker.query('BEGIN');
      await revoker.query(
        `UPDATE subscriptions SET status='canceled' WHERE organization_id=$1`,
        [actor.organizationId]);
      const pending = read('owner', current.body.data.snapshotId);
      await new Promise(resolve => setTimeout(resolve, 100));
      await revoker.query('COMMIT');
      const denied = await pending;
      expect(denied.status).toBe(403);
      expect(JSON.stringify(denied.body)).not.toContain(current.body.data.sourceSnapshotDigest);
    } finally {
      await revoker.query('ROLLBACK').catch(() => {});
      revoker.release();
      await fixture.ownerPool.query(
        `UPDATE subscriptions SET status='active',trial_started_at=NULL,trial_ends_at=NULL
         WHERE organization_id=$1`, [actor.organizationId]);
    }
  }, 120000);

  test('keeps runtime entry-only, PUBLIC denied, and startup authority mandatory', async () => {
    const privileges = (await fixture.ownerPool.query(
      `SELECT
       has_function_privilege($1,
        'canonical_forecast_approved_estimate_v2_capture(uuid,uuid,text,uuid,text,text)',
        'EXECUTE') runtime_capture,
       has_function_privilege($1,
        'canonical_forecast_approved_estimate_v2_pins(uuid)','EXECUTE') runtime_helper,
       has_table_privilege($1,'canonical_forecast_approved_estimate_v2_snapshots','SELECT') runtime_table,
       has_function_privilege('public',
        'canonical_forecast_approved_estimate_v2_read(uuid,uuid,text,uuid,uuid)',
        'EXECUTE') public_read`, [fixture.roles.runtime])).rows[0];
    expect(privileges).toEqual({ runtime_capture: true, runtime_helper: false,
      runtime_table: false, public_read: false });
    const missing = await fixture.ownerPool.connect();
    try {
      await missing.query('BEGIN');
      await missing.query(`ALTER FUNCTION canonical_forecast_approved_estimate_v2_capture(
       uuid,uuid,text,uuid,text,text)
       RENAME TO canonical_forecast_approved_estimate_v2_capture_missing`);
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(missing,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Required approved-estimate v2 authority is missing');
    } finally { await missing.query('ROLLBACK').catch(() => {}); missing.release(); }
    const leaked = await fixture.ownerPool.connect();
    try {
      await leaked.query('BEGIN');
      await leaked.query(`GRANT EXECUTE ON FUNCTION
       canonical_forecast_approved_estimate_v2_read(uuid,uuid,text,uuid,uuid) TO PUBLIC`);
      await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(leaked,
        { runtimeRole: fixture.roles.runtime }))
        .rejects.toThrow('Runtime database role privilege verification failed');
    } finally { await leaked.query('ROLLBACK').catch(() => {}); leaked.release(); }
    for (const [table, trigger] of [
      ['canonical_estimate_decisions', 'canonical_forecast_price_decision_order_insert'],
      ['canonical_estimate_decisions', 'canonical_forecast_z_approved_estimate_v2_current_track'],
      ['canonical_forecast_approved_estimate_v2_snapshots',
        'canonical_forecast_approved_estimate_v2_guard'],
    ]) {
      const disabled = await fixture.ownerPool.connect();
      try {
        await disabled.query('BEGIN');
        await disabled.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
        await expect(fixture.db.grantAndVerifyRuntimeAuthorityForTests(disabled,
          { runtimeRole: fixture.roles.runtime }))
          .rejects.toThrow('Required approved-estimate v2 fencing is missing');
      } finally { await disabled.query('ROLLBACK').catch(() => {}); disabled.release(); }
    }
  }, 120000);

  test('refuses a post-epoch legacy ordering gap without partial persistence', async () => {
    const source = await seedEstimateSource();
    const before = (await fixture.ownerPool.query(
      `SELECT count(*)::integer count FROM canonical_forecast_approved_estimate_v2_snapshots
       WHERE organization_id=$1`, [fixture.org])).rows[0].count;
    await fixture.ownerPool.query(
      `ALTER TABLE canonical_estimate_decisions
       DISABLE TRIGGER canonical_forecast_price_decision_order_insert`);
    try { await mutate(source); } finally {
      await fixture.ownerPool.query(
        `ALTER TABLE canonical_estimate_decisions
         ENABLE TRIGGER canonical_forecast_price_decision_order_insert`);
    }
    const unavailable = await capture();
    expect(unavailable.status).toBe(409);
    expect(unavailable.body).toMatchObject({ success: false,
      data: { state: 'unavailable', reason: 'legacy_order_gap', snapshotId: null } });
    const after = (await fixture.ownerPool.query(
      `SELECT count(*)::integer count FROM canonical_forecast_approved_estimate_v2_snapshots
       WHERE organization_id=$1`, [fixture.org])).rows[0].count;
    expect(after).toBe(before);
  }, 120000);
});
