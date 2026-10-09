'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const repository = require('../../src/forecasting/forecastRunRepository');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const route = '/api/v1/forecast/runs';
const key = () => crypto.randomUUID();
const ZERO = '0'.repeat(64);
const enabled = { enabled: true, targets: ['demand.inbound_leads'],
  horizons: [{ grain: 'month', periods: 3 }],
  scenarioDisplay: 'deterministic_when_eligible', comparisonDisplay: 'prior',
  alertDelivery: 'off', actionPolicy: 'review_required' };

realPostgres('Mission 26 Part 11B immutable forecast run receipts', () => {
  let fixture, horizon, horizons, snapshots, settings, consent, calculatorDefinition;
  let integrationOwnershipId, agentId, first, second, firstRequestKey;

  async function transaction(operation, isolation = 'READ COMMITTED', pool) {
    const client = await (pool || fixture.runtimePool).connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const value = await operation(client); await client.query('COMMIT'); return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  }
  async function sourceConsent(action, expectedRevision, expectedDigest) {
    const owner = fixture.actors.owner;
    return transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_source_consent_mutate(
       $1,$2,$3,$4,$5,$6,$7::jsonb) value`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, key(), JSON.stringify({ action, expectedRevision,
          expectedDigest, reason: `Synthetic Part 11B source permission ${action}.`,
          confirmed: true, confirmationVersion: 'm26-retell-demand-source-consent-v1' })])).rows[0].value,
    'SERIALIZABLE');
  }
  async function periodEvidence(actor, month) {
    return transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_evidence_v2(
       $1,$2,$3,$4,$5,$6::date) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, snapshots[month].id, month])).rows[0].value);
  }
  async function certify(actor, month, evidence) {
    const snapshot = snapshots[month];
    const scan = { version: 'm26-retell-provider-scan-v2', organizationId: fixture.org,
      snapshotId: snapshot.id, localMonthStart: month,
      startsAt: evidence.startsAt, endsAt: evidence.endsAt,
      integrationOwnershipId, agentId, canonicalCallDigests: [], callCount: 0,
      sourceSnapshotDigest: evidence.snapshotDigest, scannedAt: new Date().toISOString() };
    return transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_certification_v2_mutate(
       $1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,$15::jsonb,
       $16,$17,$18,$19,$20) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, actor.csrfToken, key(), 'certify', snapshot.id, month,
        0, 'none', ZERO, evidence.sourceCount, ZERO, JSON.stringify(scan),
        true, true, true, 'Synthetic complete zero Part 11B period certification.',
        'm26-retell-period-certification-v2'])).rows[0].value);
  }
  function body(month, supersedes = null) {
    return { expectedSettingsRevision: settings.revision,
      expectedSettingsDigest: settings.digest, localHorizonStart: month, supersedes };
  }
  async function issue(month, requestKey = key(), supersedes = null) {
    return request(fixture.app).post(route).set(fixture.actors.owner.session.headers)
      .set('Idempotency-Key', requestKey).send(body(month, supersedes));
  }
  async function tamperCalculator() {
    await fixture.ownerPool.query(`CREATE OR REPLACE FUNCTION
      public.canonical_forecast_run_v1_calculate(evidence_value JSONB)
      RETURNS JSONB LANGUAGE sql IMMUTABLE STRICT
      SET search_path=pg_catalog,public,pg_temp AS $$ SELECT NULL::jsonb $$`);
  }
  async function restoreCalculator() {
    await fixture.ownerPool.query(calculatorDefinition);
  }

  beforeAll(async () => {
    fixture = await createDatabaseFixture();
    calculatorDefinition = (await fixture.ownerPool.query(`SELECT pg_get_functiondef(
      'public.canonical_forecast_run_v1_calculate(jsonb)'::regprocedure) definition`))
      .rows[0].definition;
    const owner = fixture.actors.owner, profile = fixture.profiles[fixture.org];
    horizon = (await fixture.ownerPool.query(`SELECT
      date_trunc('month',(statement_timestamp() AT TIME ZONE
       (raw_profile#>>'{company,timeZone}'))+INTERVAL '1 month')::date::text horizon
      FROM canonical_business_profiles WHERE organization_id=$1 AND is_active`,
    [fixture.org])).rows[0].horizon;
    horizons = (await fixture.ownerPool.query(`SELECT $1::date::text horizon_one,
      ($1::date+INTERVAL '1 month')::date::text horizon_two,
      ($1::date+INTERVAL '2 months')::date::text horizon_three,
      ($1::date+INTERVAL '3 months')::date::text horizon_four`, [horizon])).rows[0];
    const months = (await fixture.ownerPool.query(`SELECT
      ($1::date-INTERVAL '4 months')::date::text m1,
      ($1::date-INTERVAL '3 months')::date::text m2,
      ($1::date-INTERVAL '2 months')::date::text m3`, [horizon])).rows[0];
    agentId = 'synthetic-' + key();
    integrationOwnershipId = (await fixture.ownerPool.query(
      `INSERT INTO canonical_integration_ownership(organization_id,provider,external_integration_id)
       VALUES($1,'retell',$2) RETURNING id`, [fixture.org, agentId])).rows[0].id;
    consent = await sourceConsent('grant', 0, 'none');
    for (const month of Object.values(months)) {
      const attestation = await request(fixture.app)
        .post('/api/v1/forecast/reporting-windows/month-attestations')
        .set(owner.session.headers).set('Idempotency-Key', key()).send({
          localStartDate: month, action: 'confirm',
          businessProfileId: profile.businessProfileId, businessProfileHash: profile.hash,
          expectedRevision: 0, expectedDigest: null,
          reason: 'Synthetic owner confirms this complete Part 11B baseline month.',
          confirmed: true, confirmationVersion: 'forecast-calendar-review-v1' });
      if (attestation.status !== 201) throw new Error(JSON.stringify(attestation.body));
    }
    snapshots = {};
    for (const month of Object.values(months)) {
      snapshots[month] = (await transaction(async client => (await client.query(
        `SELECT public.canonical_forecast_retell_period_snapshot_v2_capture(
         $1,$2,$3,$4,$5,$6,$7::date) value`,
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
          owner.csrfToken, key(), month])).rows[0].value)).snapshot;
      const evidence = await periodEvidence(owner, month);
      if ((await certify(owner, month, evidence)).state !== 'retell_period_certified') {
        throw new Error('Part 11B source certification failed');
      }
    }
    const saved = await request(fixture.app).post('/api/v1/forecast/settings')
      .set(owner.session.headers).set('Idempotency-Key', key())
      .send({ expectedRevision: 0, expectedDigest: null, settings: enabled });
    if (saved.status !== 201) throw new Error(JSON.stringify(saved.body));
    settings = saved.body.data.settings;
  }, 120000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('empty history, atomic issue, authenticated zero and exact idempotent replay are distinct', async () => {
    const owner = fixture.actors.owner;
    const empty = await request(fixture.app).get(route).set(owner.session.headers);
    expect(empty.status).toBe(200);
    expect(empty.headers['cache-control']).toBe('private, no-store');
    expect(empty.body.data).toEqual({ state: 'current', runs: [] });
    firstRequestKey = key();
    const beforeUnavailable = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_forecast_retell_future_origins_v2) origins,
      (SELECT count(*)::int FROM canonical_forecast_runs_v1) runs,
      (SELECT count(*)::int FROM canonical_forecast_run_outputs_v1) outputs`)).rows[0];
    try {
      await tamperCalculator();
      const unavailable = await issue(horizons.horizon_one, firstRequestKey);
      expect(unavailable.status).toBe(200);
      expect(unavailable.body.data).toEqual({ state: 'unavailable',
        reason: 'source_or_algorithm_not_current', runs: null });
    } finally { await restoreCalculator(); }
    const afterUnavailable = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_forecast_retell_future_origins_v2) origins,
      (SELECT count(*)::int FROM canonical_forecast_runs_v1) runs,
      (SELECT count(*)::int FROM canonical_forecast_run_outputs_v1) outputs`)).rows[0];
    expect(afterUnavailable).toEqual(beforeUnavailable);
    const issued = await issue(horizons.horizon_one, firstRequestKey);
    expect(issued.status).toBe(201);
    expect(issued.body.data).toMatchObject({ state: 'current', replayed: false,
      receipt: { version: 'm26-forecast-run-receipt-v2', organizationId: fixture.org,
        settings: { revision: settings.revision, digest: settings.digest },
        sourceSnapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        reportingWindowDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        featureSetDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        algorithm: { key: 'retell_three_complete_month_mean',
          version: 'm26-retell-three-month-mean-v2',
          definitionDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
          implementationDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
          buildDigest: expect.stringMatching(/^[0-9a-f]{64}$/) },
        inputDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        resultDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        digest: expect.stringMatching(/^[0-9a-f]{64}$/) },
      values: [{ value: { kind: 'point', amount: '0' } }],
      currentness: { sourceCurrent: true, algorithmCurrent: true,
        settingsRecorded: true, refreshRequired: false },
      historyPosition: { latest: true, superseded: false } });
    first = issued.body.data;
    const replay = await issue(horizons.horizon_one, firstRequestKey);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toMatchObject({ replayed: true,
      receipt: { id: first.receipt.id, digest: first.receipt.digest } });
    const rows = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_forecast_runs_v1) runs,
      (SELECT count(*)::int FROM canonical_forecast_run_outputs_v1) outputs`)).rows[0];
    expect(rows).toEqual({ runs: 1, outputs: 1 });
  }, 120000);

  test('second stored run is input_changed and controlled rerun uses retained exact evidence', async () => {
    const issued = await issue(horizons.horizon_one);
    expect(issued.status).toBe(201);
    second = issued.body.data;
    const compared = await request(fixture.app)
      .get(`${route}/compare/${first.receipt.id}/${second.receipt.id}`)
      .set(fixture.actors.owner.session.headers);
    expect(compared.status).toBe(200);
    expect(compared.body.data).toMatchObject({ state: 'input_changed',
      sameInputs: false, leftRunId: first.receipt.id, rightRunId: second.receipt.id });
    const rerun = await request(fixture.app)
      .post(`${route}/${first.receipt.id}/controlled-rerun`)
      .set(fixture.actors.owner.session.headers).set('Idempotency-Key', key()).send({});
    expect(rerun.status).toBe(200);
    expect(rerun.body.data).toMatchObject({ state: 'reproduced',
      runId: first.receipt.id, sameResults: true, automaticActionAuthorized: false,
      storedResultDigest: first.receipt.resultDigest,
      freshResultDigest: first.receipt.resultDigest });
    try {
      await tamperCalculator();
      const unavailable = await request(fixture.app)
        .post(`${route}/${first.receipt.id}/controlled-rerun`)
        .set(fixture.actors.owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(unavailable.status).toBe(200);
      expect(unavailable.body.data).toEqual({ state: 'unavailable',
        reason: 'exact_executable_version_unavailable', runId: null, comparison: null });
    } finally { await restoreCalculator(); }
    const recovered = await request(fixture.app)
      .post(`${route}/${first.receipt.id}/controlled-rerun`)
      .set(fixture.actors.owner.session.headers).set('Idempotency-Key', key()).send({});
    expect(recovered.body.data).toMatchObject({ state: 'reproduced',
      runId: first.receipt.id, sameResults: true });
  }, 120000);

  test('conflicts, unsupported horizons, fresh connections and tenant-role-CSRF boundaries fail closed', async () => {
    const owner = fixture.actors.owner;
    const conflict = await issue(horizons.horizon_one, firstRequestKey, {
      runId: first.receipt.id, runDigest: first.receipt.digest,
      reason: 'conflicting_replay' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.category).toBe('FORECAST_RUN_CHANGED');
    const unsupported = await issue(horizons.horizon_two);
    expect(unsupported.status).toBe(200);
    expect(unsupported.body.data).toEqual({ state: 'unavailable',
      reason: 'source_or_algorithm_not_current', runs: null });
    const outsideReviewedSettings = await issue(horizons.horizon_four);
    expect(outsideReviewedSettings.status).toBe(400);
    expect(outsideReviewedSettings.body.error.category).toBe('FORECAST_RUN_REQUEST_INVALID');
    const withoutCsrf = { ...owner.session.headers };
    delete withoutCsrf['X-CSRF-Token'];
    const csrfRejected = await request(fixture.app).post(route).set(withoutCsrf)
      .set('Idempotency-Key', key()).send(body(horizons.horizon_one));
    expect(csrfRejected.status).toBe(403);
    const member = await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers);
    expect(member.status).toBe(403);
    const otherTenant = await request(fixture.app).get(route)
      .set(fixture.actors.otherOwner.session.headers);
    expect(otherTenant.status).toBe(200);
    expect(otherTenant.body.data).toEqual({ state: 'current', runs: [] });
    const freshPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      const reloaded = await repository.list(freshPool, {
        organizationId: owner.organizationId, actorUserId: owner.actorUserId,
        actorAccessRole: owner.actorAccessRole, authSessionId: owner.authSessionId });
      expect(reloaded).toMatchObject({ state: 'current', runs: expect.any(Array) });
      expect(reloaded.runs).toHaveLength(2);
    } finally { await freshPool.end(); }
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_runs_v1')).rows[0].count).toBe(2);
  }, 120000);

  test('bounded contention recovers with the same key and immutable supersession preserves history', async () => {
    const owner = fixture.actors.owner, requestKey = key();
    const supersedes = { runId: first.receipt.id, runDigest: first.receipt.digest,
      reason: 'owner_reviewed_reissue' };
    const lock = await fixture.ownerPool.connect();
    try {
      await lock.query('BEGIN');
      await lock.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`m26:forecast-run:${fixture.org}`]);
      const busy = await issue(horizons.horizon_one, requestKey, supersedes);
      expect(busy.status).toBe(503);
      expect(busy.headers['retry-after']).toBe('2');
      expect(busy.body.error.category).toBe('FORECAST_RUN_BUSY');
    } finally { await lock.query('ROLLBACK'); lock.release(); }
    const recovered = await issue(horizons.horizon_one, requestKey, supersedes);
    expect(recovered.status).toBe(201);
    expect(recovered.body.data).toMatchObject({ receipt: {
      supersedes: { runId: first.receipt.id, runDigest: first.receipt.digest },
      supersessionReason: 'owner_reviewed_reissue' },
    historyPosition: { latest: true, superseded: false } });
    const replayFirst = await issue(horizons.horizon_one, firstRequestKey);
    expect(replayFirst.status).toBe(200);
    expect(replayFirst.body.data).toMatchObject({ replayed: true,
      receipt: { id: first.receipt.id },
      historyPosition: { latest: false, superseded: true } });
    const listed = await request(fixture.app).get(route).set(owner.session.headers);
    expect(listed.body.data.runs).toHaveLength(3);
    const old = listed.body.data.runs.find(value => value.receipt.id === first.receipt.id);
    expect(old.historyPosition).toEqual({ latest: false, superseded: true });
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_run_supersessions_v1')).rows[0].count).toBe(1);
  }, 120000);

  test('runtime privileges are entry-only and owner mutations hit immutable triggers', async () => {
    await expect(fixture.runtimePool.query('SELECT * FROM canonical_forecast_runs_v1'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query('SELECT * FROM canonical_forecast_run_calculators_v1'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      `SELECT public.canonical_forecast_run_v1_calculate('{}'::jsonb)`))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      `SELECT public.canonical_forecast_run_v1_paid_authority(
       gen_random_uuid(),gen_random_uuid(),'owner',gen_random_uuid(),NULL,FALSE)`))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      `UPDATE canonical_forecast_runs_v1 SET created_at=created_at WHERE id=$1`,
      [first.receipt.id])).rejects.toBeDefined();
    await expect(fixture.ownerPool.query(
      `DELETE FROM canonical_forecast_run_outputs_v1 WHERE run_id=$1`,
      [first.receipt.id])).rejects.toBeDefined();
    const privileges = (await fixture.runtimePool.query(`SELECT
      has_function_privilege(current_user,
       'canonical_forecast_run_v1_list(uuid,uuid,text,uuid)','EXECUTE') list_entry,
      has_function_privilege(current_user,
       'canonical_forecast_run_v1_compare(uuid,uuid,text,uuid,uuid,uuid)','EXECUTE') compare_entry,
      has_table_privilege(current_user,'canonical_forecast_runs_v1','SELECT') table_read,
      has_table_privilege(current_user,'canonical_forecast_run_calculators_v1','SELECT') calculator_read,
      has_function_privilege(current_user,
       'canonical_forecast_run_v1_calculate(jsonb)','EXECUTE') calculator_execute`)).rows[0];
    expect(privileges).toEqual({ list_entry: true, compare_entry: true,
      table_read: false, calculator_read: false, calculator_execute: false });
  }, 120000);

  test('source revocation clears mounted values while immutable receipts remain retained', async () => {
    consent = await sourceConsent('revoke', consent.consent.revision, consent.consent.digest);
    const response = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ state: 'unavailable',
      reason: 'source_or_algorithm_not_current', runs: null });
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_runs_v1')).rows[0].count).toBe(3);
    const rerun = await request(fixture.app)
      .post(`${route}/${first.receipt.id}/controlled-rerun`)
      .set(fixture.actors.owner.session.headers).set('Idempotency-Key', key()).send({});
    expect(rerun.body.data).toEqual({ state: 'unavailable',
      reason: 'source_or_algorithm_not_current', runId: null, comparison: null });
  }, 120000);

  test('a later reviewed settings revision stales every earlier receipt without rewriting history', async () => {
    const off = { enabled: false, targets: [], horizons: [], scenarioDisplay: 'withhold',
      comparisonDisplay: 'none', alertDelivery: 'off', actionPolicy: 'review_required' };
    const saved = await request(fixture.app).post('/api/v1/forecast/settings')
      .set(fixture.actors.owner.session.headers).set('Idempotency-Key', key())
      .send({ expectedRevision: settings.revision, expectedDigest: settings.digest,
        settings: off });
    expect(saved.status).toBe(201);
    const listed = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual({ state: 'unavailable',
      reason: 'settings_not_current', runs: null });
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_runs_v1')).rows[0].count).toBe(3);
  }, 120000);
});
