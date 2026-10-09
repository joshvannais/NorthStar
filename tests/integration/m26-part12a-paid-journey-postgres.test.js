'use strict';

const crypto = require('node:crypto');
const { Client } = require('pg');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const root = '/api/v1/forecast/paid-journey';
const settingsRoute = '/api/v1/forecast/settings';
const key = () => crypto.randomUUID();
const enabled = { enabled: true, targets: ['revenue.approved_price_flow'],
  horizons: [{ grain: 'month', periods: 1 }],
  scenarioDisplay: 'deterministic_when_eligible', comparisonDisplay: 'none',
  alertDelivery: 'off', actionPolicy: 'review_required' };

realPostgres('Mission 26 Part 12A complete synthetic paid journey', () => {
  let fixture, originId, positionId, settings, firstRun, firstReview;

  async function installSyntheticApprovedPriceAuthority() {
    const owner = fixture.actors.owner;
    const membership = (await fixture.ownerPool.query(
      `SELECT id FROM organization_memberships
        WHERE organization_id=$1 AND user_id=$2 AND status='active'`,
    [fixture.org, owner.actorUserId])).rows[0].id;
    originId = crypto.randomUUID(); positionId = crypto.randomUUID();
    const horizonStart = new Date();
    horizonStart.setUTCDate(horizonStart.getUTCDate() + 2);
    horizonStart.setUTCHours(0, 0, 0, 0);
    const horizonEnd = new Date(horizonStart.getTime() + 86400000);
    const output = { target: { key: 'revenue.approved_price_flow',
      definitionVersion: 'v1' }, unit: { key: 'money', currency: 'USD' },
    value: { kind: 'point', amount: '0.00' }, confidence: { state: 'unavailable' },
    calculationVersion: 'm26_price_flow_carry_forward_v1' };
    const position = { state: 'northstar_integrated_commercial_baseline',
      sourceCohortsCompleteAtCapture: true, captureTimeEquivalentVerified: true,
      futureApprovedPriceBaselineVerified: true, earnedRevenueMeasured: false,
      collectedCashMeasured: false, forecastIssued: false };
    const adminUrl = new URL(process.env.MIGRATION_DATABASE_URL);
    adminUrl.username = 'postgres'; adminUrl.password = '';
    const client = new Client({ connectionString: adminUrl.toString() });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL session_replication_role='replica'");
      await client.query(`INSERT INTO canonical_forecast_price_flow_saved_origins(
        organization_id,id,saved_at,horizon_start,horizon_end,source_receipt_id,output,
        receipt_digest,actor_user_id,auth_session_id,request_key_hash,request_digest)
       VALUES($1,$2,date_trunc('milliseconds',clock_timestamp()),$3,$4,$5,$6::jsonb,
        canonical_completion_digest($6::jsonb),$7,$8,repeat('1',64),repeat('2',64))`,
      [fixture.org, originId, horizonStart.toISOString(), horizonEnd.toISOString(),
        crypto.randomUUID(), JSON.stringify(output), owner.actorUserId, owner.authSessionId]);
      await client.query(`INSERT INTO canonical_forecast_integrated_commercial_positions(
        organization_id,id,captured_at,source_digest,future_origin_id,position,
        position_digest,actor_user_id,membership_id,auth_session_id,reason,
        request_key_hash,request_digest)
       VALUES($1,$2,date_trunc('milliseconds',clock_timestamp()),repeat('3',64),$3,$4::jsonb,
        canonical_completion_digest($4::jsonb),$5,$6,$7,
        'Synthetic implementation-only Part 12A source authority.',repeat('4',64),repeat('5',64))`,
      [fixture.org, positionId, originId, JSON.stringify(position), owner.actorUserId,
        membership, owner.authSessionId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { await client.end(); }

    await fixture.ownerPool.query(`CREATE OR REPLACE FUNCTION
      public.canonical_forecast_capture_integrated_commercial_position(
       org UUID,actor UUID,role_value TEXT,session_value UUID,csrf TEXT,
       origin_value UUID,key_value TEXT,reason_value TEXT,confirmed_value BOOLEAN,
       version_value TEXT)
      RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
      SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE saved public.canonical_forecast_integrated_commercial_positions%ROWTYPE;
      BEGIN
       PERFORM public.canonical_forecast_booking_ordered_access(
        org,actor,role_value,session_value,csrf,TRUE);
       SELECT * INTO saved FROM canonical_forecast_integrated_commercial_positions
        WHERE organization_id=org AND future_origin_id=origin_value;
       IF saved.id IS NULL THEN RETURN jsonb_build_object('state','unavailable',
        'reason','approved_price_origin_not_current','sourceCurrent',FALSE); END IF;
       IF reason_value='Synthetic post-capture unavailable rollback evidence.' THEN
        INSERT INTO canonical_forecast_integrated_commercial_positions(
         organization_id,captured_at,source_digest,future_origin_id,position,
         position_digest,actor_user_id,membership_id,auth_session_id,reason,
         request_key_hash,request_digest)
        VALUES(org,date_trunc('milliseconds',clock_timestamp()),saved.source_digest,
         saved.future_origin_id,saved.position,saved.position_digest,actor,
         saved.membership_id,session_value,reason_value,
         encode(sha256(convert_to(key_value||':forced','UTF8')),'hex'),
         encode(sha256(convert_to(reason_value||key_value,'UTF8')),'hex'));
        RETURN jsonb_build_object('state','unavailable','reason','source_revoked',
         'sourceCurrent',FALSE);
       END IF;
       RETURN saved.position||jsonb_build_object('positionId',saved.id,
        'asOf',canonical_forecast_utc_instant(saved.captured_at),'sourceCurrent',TRUE,
        'sourceCapture',jsonb_build_object('sourceDigest',rtrim(saved.source_digest)),
        'futureApprovedPriceBaseline',jsonb_build_object(
          'profileProofDigest',repeat('6',64)));
      END $$`);
    await fixture.ownerPool.query(`CREATE OR REPLACE FUNCTION
      public.canonical_forecast_integrated_commercial_position_read(
       org UUID,actor UUID,role_value TEXT,session_value UUID,position_value UUID)
      RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
      SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE saved public.canonical_forecast_integrated_commercial_positions%ROWTYPE;
      BEGIN
       PERFORM public.canonical_forecast_booking_ordered_access(
        org,actor,role_value,session_value,NULL,FALSE);
       SELECT * INTO saved FROM canonical_forecast_integrated_commercial_positions
        WHERE organization_id=org AND id=position_value;
       IF saved.id IS NULL THEN RETURN jsonb_build_object('state','unavailable',
        'reason','source_not_found','sourceCurrent',FALSE); END IF;
       RETURN saved.position||jsonb_build_object('positionId',saved.id,
        'asOf',canonical_forecast_utc_instant(saved.captured_at),'sourceCurrent',TRUE,
        'sourceCapture',jsonb_build_object('sourceDigest',rtrim(saved.source_digest)),
        'futureApprovedPriceBaseline',jsonb_build_object(
          'profileProofDigest',repeat('6',64)));
      END $$`);
  }

  beforeAll(async () => {
    fixture = await createDatabaseFixture();
    await fixture.db.close();
    if (!await fixture.db.initDatabase()) throw new Error('Schema 258 restart failed');
    await installSyntheticApprovedPriceAuthority();
    const owner = fixture.actors.owner;
    const saved = await request(fixture.app).post(settingsRoute)
      .set(owner.session.headers).set('Idempotency-Key', key())
      .send({ expectedRevision: 0, expectedDigest: null, settings: enabled });
    if (saved.status !== 201) throw new Error(JSON.stringify(saved.body));
    settings = saved.body.data.settings;
  }, 120000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('post-capture unavailability rolls back source and run atomically', async () => {
    const owner = fixture.actors.owner;
    const before = (await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_integrated_commercial_positions WHERE organization_id=$1',
    [fixture.org])).rows[0].count;
    const unavailable = await request(fixture.app).post(`${root}/issue`)
      .set(owner.session.headers).set('Idempotency-Key', key()).send({
        expectedSettingsRevision: settings.revision,
        expectedSettingsDigest: settings.digest, approvedPriceOriginId: originId,
        reason: 'Synthetic post-capture unavailable rollback evidence.',
      });
    expect(unavailable.status).toBe(200);
    expect(unavailable.body.data).toMatchObject({ state: 'unavailable',
      reason: 'source_revoked', run: null, review: null, replayed: false });
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_integrated_commercial_positions WHERE organization_id=$1',
    [fixture.org])).rows[0].count).toBe(before);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_paid_journey_runs_v1 WHERE organization_id=$1',
    [fixture.org])).rows[0].count).toBe(0);
  }, 120000);

  test('mounted paid path issues one exact immutable zero receipt and reproduces after restart', async () => {
    const owner = fixture.actors.owner;
    const before = await request(fixture.app).get(root).set(owner.session.headers);
    expect(before.status).toBe(200);
    expect(before.headers['cache-control']).toBe('private, no-store');
    expect(before.body.data).toMatchObject({ state: 'ready', reason: null,
      run: null, review: null, targetKey: 'revenue.approved_price_flow',
      syntheticImplementationEvidenceOnly: true, liveValidationAvailable: false,
      automaticActionAuthorized: false });
    const requestKey = key();
    const body = { expectedSettingsRevision: settings.revision,
      expectedSettingsDigest: settings.digest, approvedPriceOriginId: originId,
      reason: 'Synthetic paid owner issues the exact approved-price journey.' };
    const issued = await request(fixture.app).post(`${root}/issue`)
      .set(owner.session.headers).set('Idempotency-Key', requestKey).send(body);
    expect(issued.status).toBe(201);
    firstRun = issued.body.data.run;
    expect(issued.body.data).toMatchObject({ state: 'current', replayed: false,
      run: { settings: { revision: settings.revision, digest: settings.digest },
        source: { positionId, sourceSnapshotDigest: '3'.repeat(64),
          naturalHistoryValidated: false, wholeBusinessCoverageValidated: false },
        target: { key: 'revenue.approved_price_flow', definitionVersion: 'v1',
          semantic: 'future_human_approved_commercial_price_decisions' },
        output: { predictionKind: 'deterministic_point', value: { amount: '0.00' },
          uncertainty: { state: 'unquantified', calibratedIntervalAvailable: false } },
        explanation: { customerSafe: true, advisoryOnly: true,
          uncertainty: 'A calibrated interval is unavailable.' },
        currentness: { state: 'unchanged_candidate', adviceDisplayAuthorized: false },
        review: { receiverAvailability: 'unavailable', receiverHref: null,
          receiverMutationCount: 0, history: [] },
        automaticActionAuthorized: false, outboundCommunicationAuthorized: false },
      review: { availability: 'unavailable', reason: 'no_exact_receiving_adapter' } });
    for (const value of [firstRun.receipt.digest, firstRun.output.digest,
      firstRun.explanation.digest, firstRun.currentness.digest,
      firstRun.source.positionDigest, firstRun.source.reportingWindowDigest,
      firstRun.source.featureSetDigest, firstRun.algorithm.definitionDigest,
      firstRun.algorithm.implementationDigest, firstRun.algorithm.configurationDigest]) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(firstRun.receipt.organizationId).toBe(fixture.org);
    expect(Date.parse(firstRun.cutoffAt)).toBeLessThan(Date.parse(firstRun.horizon.startsAt));
    const replay = await request(fixture.app).post(`${root}/issue`)
      .set(owner.session.headers).set('Idempotency-Key', requestKey).send(body);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data.run.id).toBe(firstRun.id);
    expect(replay.body.data.run.receipt.digest).toBe(firstRun.receipt.digest);

    const rerun = await request(fixture.app).post(`${root}/${firstRun.id}/rerun`)
      .set(owner.session.headers).set('Idempotency-Key', key()).send({});
    expect(rerun.status).toBe(200);
    expect(rerun.body.data).toEqual({ state: 'reproduced', runId: firstRun.id,
      runDigest: firstRun.receipt.digest, storedOutputDigest: firstRun.output.digest,
      freshOutputDigest: firstRun.output.digest, sameResults: true,
      automaticActionAuthorized: false });
    const restored = await request(fixture.app).get(root).set(owner.session.headers);
    expect(restored.status).toBe(200);
    expect(restored.body.data.run).toMatchObject({ id: firstRun.id,
      receipt: { digest: firstRun.receipt.digest },
      output: { value: { amount: '0.00' } } });
  }, 120000);

  test('review and dismissal append only Mission 26 history and mutate no receiver', async () => {
    const owner = fixture.actors.owner;
    const before = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_schedule_assignments) assignments,
      (SELECT count(*)::int FROM canonical_estimate_decisions) estimates,
      (SELECT count(*)::int FROM canonical_customer_estimate_versions) customer_estimates`)).rows[0];
    const expiry = new Date(Date.now() + 7 * 86400000).toISOString();
    const requestKey = key();
    const body = { runId: firstRun.id, runDigest: firstRun.receipt.digest,
      currentnessDigest: firstRun.currentness.digest, action: 'requested',
      expectedRevision: null, expectedDigest: null, expiresAt: expiry };
    const requested = await request(fixture.app).post(`${root}/review`)
      .set(owner.session.headers).set('Idempotency-Key', requestKey).send(body);
    expect(requested.status).toBe(201);
    firstReview = requested.body.data.journey.run.review.history[0];
    expect(requested.body.data).toMatchObject({ state: 'requested', journey: {
      state: 'current', run: { id: firstRun.id, review: {
        receiverAvailability: 'unavailable', receiverHref: null,
        receiverMutationCount: 0, history: [{ revision: 1, action: 'requested' }] } },
      review: { requestReviewAvailable: false } } });
    expect(firstReview).toMatchObject({ recordedAction: 'requested',
      organizationId: fixture.org, runId: firstRun.id,
      actorUserId: owner.actorUserId, actorAccessRole: 'owner', predecessorDigest: null,
      runDigest: firstRun.receipt.digest, currentnessRevision: 1,
      currentnessDigest: firstRun.currentness.digest,
      target: { key: 'revenue.approved_price_flow', definitionVersion: 'v1',
        semantic: 'future_human_approved_commercial_price_decisions' },
      horizon: firstRun.horizon, outputDigest: firstRun.output.digest,
      recommendationType: 'review_approved_price_flow',
      receiving: { mission: null, workflow: null, recordId: null,
        expectedRevision: null, availability: 'unavailable',
        reason: 'no_exact_receiving_adapter' },
      evidence: { receiptDigest: firstRun.receipt.digest,
        explanationDigest: firstRun.explanation.digest,
        sourcePositionDigest: firstRun.source.positionDigest },
      uncertainty: { state: 'unquantified', calibratedIntervalAvailable: false,
        reason: 'empirical_calibration_unavailable' },
      missingInformation: ['natural_observation_history','empirical_calibration',
        'whole_business_coverage','live_provider_validation'],
      tradeoff: 'Review can inform a later independently authorized workflow; no receiver or operational state changes here.' });
    const persistedReview = (await fixture.ownerPool.query(`SELECT
       rtrim(run_digest) "runDigest", currentness_revision "currentnessRevision",
       rtrim(currentness_digest) "currentnessDigest", event,
       rtrim(event_digest)=canonical_completion_digest(event) "digestMatches"
       FROM canonical_forecast_paid_journey_reviews_v1
       WHERE organization_id=$1 AND run_id=$2 AND sequence=1`,
    [fixture.org, firstRun.id])).rows[0];
    expect(persistedReview).toMatchObject({ runDigest: firstRun.receipt.digest,
      currentnessRevision: 1, currentnessDigest: firstRun.currentness.digest,
      digestMatches: true, event: { receiverMutationCount: 0,
        automaticActionAuthorized: false } });
    expect(JSON.stringify(persistedReview.event)).not.toMatch(/transcript|wage|customercontact|providerpayload/i);
    const replay = await request(fixture.app).post(`${root}/review`)
      .set(owner.session.headers).set('Idempotency-Key', requestKey).send(body);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data.state).toBe('replay');
    const dismissed = await request(fixture.app).post(`${root}/review`)
      .set(owner.session.headers).set('Idempotency-Key', key()).send({ ...body,
        action: 'dismissed', expectedRevision: firstReview.revision,
        expectedDigest: firstReview.digest, expiresAt: firstReview.expiresAt });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data).toMatchObject({ state: 'dismissed', journey: {
      run: { review: { history: [{ action: 'requested' }, { action: 'dismissed' }] } },
      review: { requestReviewAvailable: true } } });
    const staleReplay = await request(fixture.app).post(`${root}/review`)
      .set(owner.session.headers).set('Idempotency-Key', requestKey).send(body);
    expect(staleReplay.status).toBe(200);
    expect(staleReplay.body.data).toEqual({ state: 'unavailable',
      reason: 'review_replay_superseded', journey: null });
    const after = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_schedule_assignments) assignments,
      (SELECT count(*)::int FROM canonical_estimate_decisions) estimates,
      (SELECT count(*)::int FROM canonical_customer_estimate_versions) customer_estimates`)).rows[0];
    expect(after).toEqual(before);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_paid_journey_reviews_v1 WHERE organization_id=$1',
    [fixture.org])).rows[0].count).toBe(2);
  }, 120000);

  test('bounded lock, role/tenant isolation, superseded replay and stale source are value-free', async () => {
    const owner = fixture.actors.owner;
    expect((await request(fixture.app).get(root)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const other = await request(fixture.app).get(root)
      .set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200);
    expect(other.body.data).toMatchObject({ state: 'unavailable',
      reason: 'approved_price_settings_not_current', run: null, review: null });

    const heldKey = key();
    const lock = await fixture.ownerPool.connect();
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`m26:forecast-settings:${fixture.org}`]);
      const busy = await request(fixture.app).post(`${root}/issue`)
        .set(owner.session.headers).set('Idempotency-Key', heldKey).send({
          expectedSettingsRevision: settings.revision,
          expectedSettingsDigest: settings.digest, approvedPriceOriginId: originId,
          reason: 'Synthetic retry while the exact settings lock is held.' });
      expect(busy.status).toBe(503);
      expect(busy.headers['retry-after']).toBe('2');
      expect(busy.body.error.category).toBe('FORECAST_PAID_JOURNEY_BUSY');
    } finally { await lock.query('ROLLBACK'); lock.release(); }
    const recovered = await request(fixture.app).post(`${root}/issue`)
      .set(owner.session.headers).set('Idempotency-Key', heldKey).send({
        expectedSettingsRevision: settings.revision,
        expectedSettingsDigest: settings.digest, approvedPriceOriginId: originId,
        reason: 'Synthetic retry while the exact settings lock is held.' });
    expect(recovered.status).toBe(201);
    const secondRun = recovered.body.data.run;
    expect(secondRun.id).not.toBe(firstRun.id);

    const oldReplay = await request(fixture.app).post(`${root}/issue`)
      .set(owner.session.headers).set('Idempotency-Key', 'part12a-first-run-replay-key')
      .send({ expectedSettingsRevision: settings.revision,
        expectedSettingsDigest: settings.digest, approvedPriceOriginId: originId,
        reason: 'Synthetic distinct receipt used only to prove a historical replay.' });
    expect(oldReplay.status).toBe(201);
    const third = await request(fixture.app).post(`${root}/issue`)
      .set(owner.session.headers).set('Idempotency-Key', key()).send({
        expectedSettingsRevision: settings.revision,
        expectedSettingsDigest: settings.digest, approvedPriceOriginId: originId,
        reason: 'Synthetic newer receipt supersedes the replay presentation.' });
    expect(third.status).toBe(201);
    const superseded = await request(fixture.app).post(`${root}/issue`)
      .set(owner.session.headers).set('Idempotency-Key', 'part12a-first-run-replay-key')
      .send({ expectedSettingsRevision: settings.revision,
        expectedSettingsDigest: settings.digest, approvedPriceOriginId: originId,
        reason: 'Synthetic distinct receipt used only to prove a historical replay.' });
    expect(superseded.status).toBe(200);
    expect(superseded.body.data).toMatchObject({ state: 'unavailable',
      reason: 'historical_replay_superseded', run: null, review: null, replayed: true });

    await fixture.ownerPool.query(`CREATE OR REPLACE FUNCTION
      public.canonical_forecast_integrated_commercial_position_read(
       org UUID,actor UUID,role_value TEXT,session_value UUID,position_value UUID)
      RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
      SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
       PERFORM public.canonical_forecast_booking_ordered_access(
        org,actor,role_value,session_value,NULL,FALSE);
       RETURN jsonb_build_object('state','unavailable','reason','source_revoked',
        'sourceCurrent',FALSE,'positionId',NULL,'sourceCapture',NULL);
      END $$`);
    const revoked = await request(fixture.app).get(root).set(owner.session.headers);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data).toMatchObject({ state: 'unavailable',
      reason: 'source_revoked', run: null, review: null });
  }, 120000);

  test('runtime privileges expose only entry functions and stored ledgers stay immutable', async () => {
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_paid_journey_runs_v1'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_paid_journey_reviews_v1'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'DELETE FROM canonical_forecast_paid_journey_runs_v1 WHERE organization_id=$1',
    [fixture.org])).rejects.toMatchObject({ code: '23514' });
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_forecast_paid_journey_reviews_v1 SET action=action WHERE organization_id=$1',
    [fixture.org])).rejects.toMatchObject({ code: '23514' });
    const privilege = (await fixture.ownerPool.query(`SELECT
      has_function_privilege($1,
       'public.canonical_forecast_paid_journey_v1_current(uuid,uuid,text,uuid)','EXECUTE') entry,
      has_function_privilege($1,
       'public.canonical_forecast_paid_price_v1_calculate(jsonb)','EXECUTE') helper`,
    [fixture.roles.runtime])).rows[0];
    expect(privilege).toEqual({ entry: true, helper: false });
  }, 120000);
});
