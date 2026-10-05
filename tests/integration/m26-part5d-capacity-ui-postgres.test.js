'use strict';

const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { createForecastCapacityAdvisoryRouter } = require('../../src/routes/forecastCapacityAdvisory');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

realPostgres('Mission 26 Part 5D mounted paid capacity UI boundary', () => {
  let fixture; let app;
  const endpoint = '/api/v1/forecast/capacity-advice';
  const actor = name => fixture.actors[name];
  const get = (path, name = 'owner') => request(app).get(endpoint + path).set('X-Test-Actor', name);
  const post = (path, body, name = 'owner', csrf = null, key = crypto.randomUUID()) => request(app)
    .post(endpoint + path).set('X-Test-Actor', name)
    .set('X-CSRF-Token', csrf === null ? actor(name).csrfToken : csrf)
    .set('Idempotency-Key', key).send(body);

  beforeAll(async () => {
    fixture = await createDatabaseFixture();
    app = express(); app.use(express.json());
    const bypass = (_req, _res, next) => next();
    const auth = (req, _res, next) => {
      const selected = actor(req.get('X-Test-Actor') || 'owner');
      req.user = { id: selected.actorUserId }; req.orgId = selected.organizationId;
      req.tenantContext = { organizationId: selected.organizationId, userId: selected.actorUserId };
      req.userRole = selected.actorAccessRole; req.authSession = { id: selected.authSessionId };
      next();
    };
    app.use(endpoint, createForecastCapacityAdvisoryRouter({ auth, throttle: bypass,
      writeThrottle: bypass, poolProvider: () => fixture.runtimePool }));
  }, 120000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('owner and admin receive an empty nonnumeric journey while lower roles are restricted', async () => {
    for (const name of ['owner', 'admin']) {
      const result = await get('/journey/current', name);
      expect(result.status).toBe(200);
      expect(result.headers['cache-control']).toBe('private, no-store');
      expect(result.headers['referrer-policy']).toBe('no-referrer');
      expect(result.body.data).toMatchObject({ state: 'capacity_research_journey_current',
        workload: { selectedOrigin: null, selectedEvaluation: null,
          targets: [
            { key: 'workload.accepted_person_hours.v1', evidenceState: 'unavailable' },
            { key: 'workload.end_backlog_hours.v1', evidenceState: 'unavailable' },
            { key: 'capacity.available_role_hours.v1', evidenceState: 'unavailable' }],
          currentAction: { name: 'capture_origin', originId: null } },
        constrained: { selectedOrigin: null, selectedOutcome: null, selectedEvaluation: null,
          scopes: [], currentAction: { name: 'capture_origin', originId: null } },
        advisory: { selectedOrigin: null, selectedOutcome: null, selectedEvaluation: null,
          selectedContinuation: null, currentAction: { name: 'capture_origin', originId: null } },
        boundaries: { alternativesCombined: false, valuesWithheld: true, predictionIsFact: false },
        researchOnly: true, forecastIssued: false, paidNumericServing: false,
        forecastServingEnabled: false, automaticActionTaken: false });
      expect(JSON.stringify(result.body.data)).not.toMatch(/privateResults|inputManifest|workerId|jobId|assetId|memberId|personMinutes|demandMinutes|capacityMinutes|gapMinutes|"digest"/i);
    }
    for (const name of ['dispatcher', 'member']) {
      const result = await get('/journey/current', name);
      expect(result.status).toBe(403); expect(result.body).toEqual({ success: false, error: 'Forbidden' });
    }
  }, 120000);

  test('revoked session and past-due subscription fail closed with generic privacy', async () => {
    const owner = actor('owner');
    await fixture.ownerPool.query(
      "UPDATE auth_sessions SET status='revoked', revoked_at=clock_timestamp(), revoke_reason='part5d_test' WHERE id=$1",
      [owner.authSessionId],
    );
    let result = await get('/journey/current');
    expect(result.status).toBe(403); expect(JSON.stringify(result.body)).not.toContain(owner.actorUserId);
    await fixture.ownerPool.query(
      "UPDATE auth_sessions SET status='active', revoked_at=NULL, revoke_reason=NULL WHERE id=$1",
      [owner.authSessionId],
    );

    const saved = (await fixture.ownerPool.query('SELECT status FROM subscriptions WHERE organization_id=$1',
      [fixture.org])).rows[0].status;
    await fixture.ownerPool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1", [fixture.org]);
    result = await get('/journey/current');
    expect(result.status).toBe(403); expect(result.body).toEqual({ success: false, error: 'Forbidden' });
    await fixture.ownerPool.query('UPDATE subscriptions SET status=$2 WHERE organization_id=$1', [fixture.org, saved]);
    expect((await get('/journey/current')).status).toBe(200);
  }, 120000);

  test('absent and cross-tenant-looking receipts are the same generic 404 and write refusals leave no partial chain', async () => {
    const missing = crypto.randomUUID(); const otherLooking = actor('otherOwner').actorUserId;
    const decisionBody = { action: 'approve', expectedDecisionId: null, expectedDecisionRevision: 0,
      reason: 'Approve this exact qualitative advisory receipt for review.', confirmed: true,
      confirmationVersion: 'm26-capacity-ui-decision-v1' };
    for (const id of [missing, otherLooking]) {
      const result = await post(`/origins/${id}/safe-decisions`, decisionBody);
      expect(result.status).toBe(404); expect(result.body).toEqual({ success: false, error: 'Not found' });
    }
    const before = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_ui_action_requests_v1 WHERE organization_id=$1',
    [fixture.org])).rows[0].count);
    const actionBody = { action: 'workload_capture_origin', originId: null, outcomeId: null,
      correctionOriginId: null, reason: 'Save an origin only if every accepted prerequisite is current.',
      confirmed: true, confirmationVersion: 'm26-capacity-ui-action-v1' };
    const invalidCsrf = await post('/journey/actions', actionBody, 'owner', 'x'.repeat(32));
    expect(invalidCsrf.status).toBe(403); expect(invalidCsrf.body).toEqual({ success: false, error: 'Forbidden' });
    const refused = await post('/journey/actions', actionBody);
    expect(refused.status).toBe(400); expect(refused.body).toEqual({ success: false, error: 'Invalid request' });
    const after = Number((await fixture.ownerPool.query(
      'SELECT count(*) count FROM canonical_forecast_capacity_ui_action_requests_v1 WHERE organization_id=$1',
    [fixture.org])).rows[0].count);
    expect(after).toBe(before);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::integer count FROM canonical_forecast_workload_capacity_origins_v1 WHERE organization_id=$1',
    [fixture.org])).rows[0].count).toBe(0);
  }, 120000);

  test('the UI registry refuses a changed body under the same exact idempotency key', async () => {
    const owner = actor('owner'); const key = `m26-part5d-registry-${crypto.randomUUID()}`;
    const body = { action: 'workload_capture_origin', originId: null, outcomeId: null,
      correctionOriginId: null, reason: 'Save this exact accepted workload research position.',
      confirmed: true, confirmationVersion: 'm26-capacity-ui-action-v1' };
    const digest = (await fixture.ownerPool.query(`SELECT
      encode(sha256(convert_to($1,'UTF8')),'hex') key_hash,
      canonical_completion_digest(jsonb_build_object(
        'action',$2::text,'originId',$3::uuid,'outcomeId',$4::uuid,
        'correctionOriginId',$5::uuid,'reason',btrim($6::text),'confirmation',$7::text)) request_digest`,
    [key, body.action, body.originId, body.outcomeId, body.correctionOriginId,
      body.reason, body.confirmationVersion])).rows[0];
    await fixture.ownerPool.query(`INSERT INTO canonical_forecast_capacity_ui_action_requests_v1(
      organization_id,actor_id,idempotency_key_hash,request_digest,created_at)
      VALUES($1,$2,$3,$4,clock_timestamp())`,
    [fixture.org, owner.actorUserId, digest.key_hash, digest.request_digest]);

    const changed = { ...body, reason: 'Save a different workload research position under the reused key.' };
    const refused = await post('/journey/actions', changed, 'owner', null, key);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ success: false, error: 'Conflict' });
    expect((await fixture.ownerPool.query(`SELECT count(*)::integer count
      FROM canonical_forecast_capacity_ui_action_requests_v1
      WHERE organization_id=$1 AND actor_id=$2 AND idempotency_key_hash=$3`,
    [fixture.org, owner.actorUserId, digest.key_hash])).rows[0].count).toBe(1);
    expect((await fixture.ownerPool.query(`SELECT count(*)::integer count
      FROM canonical_forecast_workload_capacity_origins_v1 WHERE organization_id=$1`,
    [fixture.org])).rows[0].count).toBe(0);
  }, 120000);

  test('queued access revocation cannot overtake the fenced read and refuses the next read', async () => {
    const lockClient = await fixture.ownerPool.connect();
    const subscriptionWriter = await fixture.ownerPool.connect();
    let pending; let revoke;
    try {
      await lockClient.query('BEGIN');
      await lockClient.query(`SELECT pg_advisory_xact_lock(
        hashtextextended('m26:capacity-advisory-source:'||$1::text,0))`, [fixture.org]);
      pending = get('/journey/current').then(result => result);
      let waiting = false;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const row = (await fixture.ownerPool.query(`SELECT EXISTS(
          SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted
           AND database=(SELECT oid FROM pg_database WHERE datname=current_database())) waiting`)).rows[0];
        if (row.waiting) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await subscriptionWriter.query('BEGIN');
      let revocationReachedWrite = false;
      revoke = subscriptionWriter.query(
        "UPDATE subscriptions SET status='past_due' WHERE organization_id=$1", [fixture.org])
        .then(() => { revocationReachedWrite = true; });
      await new Promise(resolve => setTimeout(resolve, 80));
      expect(revocationReachedWrite).toBe(false);
      await lockClient.query('COMMIT');
      const result = await pending;
      expect(result.status).toBe(200);
      await revoke; await subscriptionWriter.query('COMMIT');
      const refused = await get('/journey/current');
      expect(refused.status).toBe(403);
      expect(refused.body).toEqual({ success: false, error: 'Forbidden' });
    } finally {
      await lockClient.query('ROLLBACK').catch(() => {}); lockClient.release();
      await subscriptionWriter.query('ROLLBACK').catch(() => {}); subscriptionWriter.release();
      await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1", [fixture.org]);
      if (pending) await pending.catch(() => {});
      if (revoke) await revoke.catch(() => {});
    }
    expect((await get('/journey/current')).status).toBe(200);
  }, 120000);

  test('runtime and PUBLIC cannot reach private projection sources or the UI registry', async () => {
    const row = (await fixture.ownerPool.query(`SELECT
      has_table_privilege($1,'canonical_forecast_capacity_ui_action_requests_v1','SELECT') runtime_registry,
      has_table_privilege('public','canonical_forecast_capacity_ui_action_requests_v1','SELECT') public_registry,
      has_table_privilege($1,'canonical_forecast_workload_capacity_origins_v1','SELECT') runtime_workload,
      has_table_privilege($1,'canonical_forecast_constrained_capacity_origins_v1','SELECT') runtime_constrained,
      has_table_privilege($1,'canonical_forecast_capacity_advisory_origins_v1','SELECT') runtime_advisory,
      has_function_privilege($1,'canonical_forecast_capacity_ui_v1_history_item(text,uuid,uuid,text,timestamptz,timestamptz,timestamptz,bigint,text)','EXECUTE') runtime_helper`,
    [fixture.roles.runtime])).rows[0];
    expect(row).toEqual({ runtime_registry: false, public_registry: false, runtime_workload: false,
      runtime_constrained: false, runtime_advisory: false, runtime_helper: false });
  });
});
