'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const route = '/api/v1/forecast/handoffs';
const key = () => crypto.randomUUID();
const ZERO = '0'.repeat(64);
const enabled = { enabled: true, targets: ['demand.inbound_leads'],
  horizons: [{ grain: 'month', periods: 3 }],
  scenarioDisplay: 'deterministic_when_eligible', comparisonDisplay: 'prior',
  alertDelivery: 'off', actionPolicy: 'review_required' };

realPostgres('Mission 26 Part 11D immutable reviewed forecast handoffs', () => {
  let fixture, horizon, snapshots, settings, integrationOwnershipId, agentId;
  let issued, currentnessDigest, proposal, reviewExpiresAt;
  let firstRequestKey, firstDismissKey;

  async function transaction(operation, isolation = 'READ COMMITTED') {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const value = await operation(client); await client.query('COMMIT'); return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  }
  async function sourceConsent() {
    const owner = fixture.actors.owner;
    return transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_source_consent_mutate(
       $1,$2,$3,$4,$5,$6,$7::jsonb) value`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, key(), JSON.stringify({ action: 'grant', expectedRevision: 0,
          expectedDigest: 'none', reason: 'Synthetic Part 11D source permission.',
          confirmed: true,
          confirmationVersion: 'm26-retell-demand-source-consent-v1' })])).rows[0].value,
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
        true, true, true, 'Synthetic complete zero Part 11D period certification.',
        'm26-retell-period-certification-v2'])).rows[0].value);
  }
  async function requestReview(requestKey = key(), overrides = {}) {
    return request(fixture.app).post(route).set(fixture.actors.owner.session.headers)
      .set('Idempotency-Key', requestKey).send({ runId: issued.receipt.id,
        runDigest: issued.receipt.digest, currentnessDigest,
        expiresAt: reviewExpiresAt || new Date(Date.now() + 7 * 86400000).toISOString(),
        ...overrides });
  }

  beforeAll(async () => {
    fixture = await createDatabaseFixture();
    const owner = fixture.actors.owner, profile = fixture.profiles[fixture.org];
    horizon = (await fixture.ownerPool.query(`SELECT
      date_trunc('month',(statement_timestamp() AT TIME ZONE
       (raw_profile#>>'{company,timeZone}'))+INTERVAL '1 month')::date::text horizon
      FROM canonical_business_profiles WHERE organization_id=$1 AND is_active`,
    [fixture.org])).rows[0].horizon;
    const months = (await fixture.ownerPool.query(`SELECT
      ($1::date-INTERVAL '4 months')::date::text m1,
      ($1::date-INTERVAL '3 months')::date::text m2,
      ($1::date-INTERVAL '2 months')::date::text m3`, [horizon])).rows[0];
    agentId = `synthetic-${key()}`;
    integrationOwnershipId = (await fixture.ownerPool.query(
      `INSERT INTO canonical_integration_ownership(organization_id,provider,external_integration_id)
       VALUES($1,'retell',$2) RETURNING id`, [fixture.org, agentId])).rows[0].id;
    await sourceConsent();
    for (const month of Object.values(months)) {
      const attestation = await request(fixture.app)
        .post('/api/v1/forecast/reporting-windows/month-attestations')
        .set(owner.session.headers).set('Idempotency-Key', key()).send({
          localStartDate: month, action: 'confirm',
          businessProfileId: profile.businessProfileId, businessProfileHash: profile.hash,
          expectedRevision: 0, expectedDigest: null,
          reason: 'Synthetic owner confirms this complete Part 11D baseline month.',
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
        throw new Error('Part 11D source certification failed');
      }
    }
    const saved = await request(fixture.app).post('/api/v1/forecast/settings')
      .set(owner.session.headers).set('Idempotency-Key', key())
      .send({ expectedRevision: 0, expectedDigest: null, settings: enabled });
    if (saved.status !== 201) throw new Error(JSON.stringify(saved.body));
    settings = saved.body.data.settings;
    const run = await request(fixture.app).post('/api/v1/forecast/runs')
      .set(owner.session.headers).set('Idempotency-Key', key()).send({
        expectedSettingsRevision: settings.revision,
        expectedSettingsDigest: settings.digest, localHorizonStart: horizon,
        supersedes: null });
    if (run.status !== 201) throw new Error(JSON.stringify(run.body));
    issued = run.body.data;
  }, 120000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('released Retell run is honestly unavailable and masks every proposal identity', async () => {
    const response = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data).toEqual({ version: 'm26-forecast-reviewed-handoff-v1',
      state: 'unavailable', reason: 'unsupported_source_currentness',
      candidate: null, proposals: null, automaticActionAuthorized: false,
      outboundCommunicationAuthorized: false });
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_handoff_proposals_v1'))
      .rows[0].count).toBe(0);
  }, 120000);

  test('compatible currentness creates immutable zero-valued advice with no receiver mutation', async () => {
    const owner = fixture.actors.owner;
    const event = (await fixture.ownerPool.query(`SELECT rtrim(currentness_digest) digest
      FROM canonical_forecast_run_currentness_events_v1 WHERE run_id=$1
      ORDER BY sequence DESC LIMIT 1`, [issued.receipt.id])).rows[0];
    currentnessDigest = event.digest;
    reviewExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    await fixture.ownerPool.query(`CREATE OR REPLACE FUNCTION
      public.canonical_forecast_run_currentness_v1_read(
       org UUID,actor UUID,role_value TEXT,session_value UUID,run_value UUID)
      RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
      SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE saved public.canonical_forecast_runs_v1%ROWTYPE;
       current_event public.canonical_forecast_run_currentness_events_v1%ROWTYPE;
      BEGIN
       PERFORM public.canonical_forecast_run_v1_paid_authority(
        org,actor,role_value,session_value,NULL,FALSE);
       SELECT * INTO saved FROM public.canonical_forecast_runs_v1
        WHERE organization_id=org AND id=run_value;
       IF saved.id IS NULL THEN RETURN jsonb_build_object(
        'version','m26-forecast-run-currentness-v1','state','unavailable',
        'reason','run_not_found','reasons',jsonb_build_array('run_not_found'),
        'runId',NULL,'runDigest',NULL,'adviceDisplayAuthorized',FALSE,
        'digest',public.canonical_completion_digest(jsonb_build_object('runId',NULL)));
       END IF;
       SELECT * INTO current_event FROM public.canonical_forecast_run_currentness_events_v1
        WHERE organization_id=org AND run_id=saved.id ORDER BY sequence DESC LIMIT 1;
       RETURN jsonb_build_object('version','m26-forecast-run-currentness-v1',
        'state','unchanged_candidate','reason','unchanged_candidate',
        'reasons',jsonb_build_array('unchanged_candidate'),'runId',saved.id,
        'runDigest',rtrim(saved.canonical_digest),'adviceDisplayAuthorized',FALSE,
        'digest',rtrim(current_event.currentness_digest));
      END $$`);

    const ready = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(ready.status).toBe(200);
    expect(ready.body.data).toMatchObject({ state: 'current',
      candidate: { runId: issued.receipt.id, runDigest: issued.receipt.digest,
        currentness: { revision: 1, digest: currentnessDigest },
        recommendation: { evidence: { amount: '0', unit: 'count' },
          uncertainty: { state: 'unquantified' } },
        receiver: { mission: '22', availability: 'unavailable', href: null },
        advisoryOnly: true, navigationIsApproval: false,
        automaticActionAuthorized: false }, proposals: [] });

    const before = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_schedule_assignments) assignments,
      (SELECT count(*)::int FROM canonical_estimate_decisions) estimates,
      (SELECT count(*)::int FROM canonical_customer_estimate_versions) customer_estimates`)).rows[0];
    firstRequestKey = key();
    const created = await requestReview(firstRequestKey);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ state: 'created', proposal: {
      state: 'requested', revision: 1, reviewer: { userId: fixture.actors.owner.actorUserId,
        accessRole: 'owner' }, run: { id: issued.receipt.id,
        currentnessDigest }, recommendation: { evidence: { amount: '0' } },
      receiver: { availability: 'unavailable', recordId: null, href: null },
      advisoryOnly: true, navigationIsApproval: false,
      receiverRecheckRequired: true, automaticActionAuthorized: false,
      outboundCommunicationAuthorized: false } });
    proposal = created.body.data.proposal;
    await fixture.db.close();
    expect(await fixture.db.initDatabase()).toBe(true);
    const afterRestart = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(afterRestart.status).toBe(200);
    expect(afterRestart.body.data).toMatchObject({ state: 'current',
      candidate: { recommendation: { evidence: { amount: '0' } } },
      proposals: [{ id: proposal.id, digest: proposal.digest, state: 'requested' }] });
    const after = (await fixture.ownerPool.query(`SELECT
      (SELECT count(*)::int FROM canonical_schedule_assignments) assignments,
      (SELECT count(*)::int FROM canonical_estimate_decisions) estimates,
      (SELECT count(*)::int FROM canonical_customer_estimate_versions) customer_estimates`)).rows[0];
    expect(after).toEqual(before);

    const replay = await requestReview(firstRequestKey);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data).toEqual({ state: 'replay', proposal });
    const conflict = await requestReview(firstRequestKey, {
      expiresAt: new Date(Date.now() + 8 * 86400000).toISOString() });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.category).toBe('FORECAST_HANDOFF_CHANGED');
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_handoff_proposals_v1'))
      .rows[0].count).toBe(1);
  }, 120000);

  test('CSRF, tenant, role, expiry, concurrency, exact dismiss and replay fail closed', async () => {
    const owner = fixture.actors.owner;
    const noCsrf = { ...owner.session.headers }; delete noCsrf['X-CSRF-Token'];
    expect((await request(fixture.app).post(route).set(noCsrf)
      .set('Idempotency-Key', key()).send({ runId: issued.receipt.id,
        runDigest: issued.receipt.digest, currentnessDigest,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() })).status).toBe(403);
    expect((await request(fixture.app).post(`${route}?unexpected=true`)
      .set(owner.session.headers).set('Idempotency-Key', key())
      .send({ runId: issued.receipt.id, runDigest: issued.receipt.digest,
        currentnessDigest, expiresAt: reviewExpiresAt })).status).toBe(400);
    expect((await request(fixture.app).post(route).set(owner.session.headers)
      .set('Idempotency-Key', key()).send({ runId: issued.receipt.id,
        runDigest: issued.receipt.digest, currentnessDigest,
        expiresAt: new Date(Date.now() + 60000).toISOString() })).status).toBe(400);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    const other = await request(fixture.app).get(route)
      .set(fixture.actors.otherOwner.session.headers);
    expect(other.status).toBe(200);
    expect(other.body.data).toMatchObject({ state: 'unavailable', reason: 'run_not_found',
      candidate: null, proposals: null });

    const lock = await fixture.ownerPool.connect();
    const busyKey = key();
    try {
      await lock.query('BEGIN');
      await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`m26:forecast-handoff:${fixture.org}:${issued.receipt.id}`]);
      const busy = await requestReview(busyKey);
      expect(busy.status).toBe(503);
      expect(busy.headers['retry-after']).toBe('2');
      expect(busy.body.error.category).toBe('FORECAST_HANDOFF_BUSY');
    } finally { await lock.query('ROLLBACK'); lock.release(); }
    const recovered = await requestReview(busyKey);
    expect(recovered.status).toBe(201);

    firstDismissKey = key();
    const proposalLock = await fixture.ownerPool.connect();
    try {
      await proposalLock.query('BEGIN');
      await proposalLock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`m26:forecast-handoff-proposal:${fixture.org}:${proposal.id}`]);
      const busyDismiss = await request(fixture.app)
        .post(`${route}/${proposal.id}/dismiss`).set(owner.session.headers)
        .set('Idempotency-Key', firstDismissKey)
        .send({ expectedRevision: proposal.revision, expectedDigest: proposal.digest });
      expect(busyDismiss.status).toBe(503);
      expect(busyDismiss.headers['retry-after']).toBe('2');
      expect(busyDismiss.body.error.category).toBe('FORECAST_HANDOFF_BUSY');
    } finally { await proposalLock.query('ROLLBACK'); proposalLock.release(); }
    const dismissed = await request(fixture.app)
      .post(`${route}/${proposal.id}/dismiss`).set(owner.session.headers)
      .set('Idempotency-Key', firstDismissKey)
      .send({ expectedRevision: proposal.revision, expectedDigest: proposal.digest });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.data).toMatchObject({ state: 'dismissed', proposal: {
      id: proposal.id, state: 'dismissed', revision: 2,
      history: [{ action: 'requested' }, { action: 'dismissed' }] } });
    const replay = await request(fixture.app)
      .post(`${route}/${proposal.id}/dismiss`).set(owner.session.headers)
      .set('Idempotency-Key', firstDismissKey)
      .send({ expectedRevision: proposal.revision, expectedDigest: proposal.digest });
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.data.state).toBe('replay');
    const stale = await request(fixture.app)
      .post(`${route}/${proposal.id}/dismiss`).set(owner.session.headers)
      .set('Idempotency-Key', key())
      .send({ expectedRevision: 1, expectedDigest: proposal.digest });
    expect(stale.status).toBe(409);
  }, 120000);

  test('currentness loss clears the API while immutable history and entry-only privileges remain', async () => {
    await fixture.ownerPool.query(`CREATE OR REPLACE FUNCTION
      public.canonical_forecast_run_currentness_v1_read(
       org UUID,actor UUID,role_value TEXT,session_value UUID,run_value UUID)
      RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
      SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
       PERFORM public.canonical_forecast_run_v1_paid_authority(
        org,actor,role_value,session_value,NULL,FALSE);
       RETURN jsonb_build_object('version','m26-forecast-run-currentness-v1',
        'state','unavailable','reason','run_stale','reasons',jsonb_build_array('source_corrected'),
        'runId',NULL,'runDigest',NULL,'adviceDisplayAuthorized',FALSE,'digest',repeat('9',64));
      END $$`);
    const unavailable = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    expect(unavailable.body.data).toEqual({ version: 'm26-forecast-reviewed-handoff-v1',
      state: 'unavailable', reason: 'run_stale', candidate: null, proposals: null,
      automaticActionAuthorized: false, outboundCommunicationAuthorized: false });
    const staleRequestReplay = await requestReview(firstRequestKey);
    expect(staleRequestReplay.status).toBe(200);
    expect(staleRequestReplay.body.data).toEqual({ state: 'unavailable',
      reason: 'run_stale', proposal: null });
    const staleDismissReplay = await request(fixture.app)
      .post(`${route}/${proposal.id}/dismiss`).set(fixture.actors.owner.session.headers)
      .set('Idempotency-Key', firstDismissKey)
      .send({ expectedRevision: proposal.revision, expectedDigest: proposal.digest });
    expect(staleDismissReplay.status).toBe(200);
    expect(staleDismissReplay.body.data).toEqual({ state: 'unavailable',
      reason: 'run_stale', proposal: null });
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::int count FROM canonical_forecast_handoff_proposals_v1'))
      .rows[0].count).toBe(2);
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_handoff_proposals_v1'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'DELETE FROM canonical_forecast_handoff_events_v1'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_forecast_handoff_proposals_v1 SET expires_at=expires_at'))
      .rejects.toBeDefined();
    const privileges = (await fixture.runtimePool.query(`SELECT
      has_function_privilege(current_user,
       'canonical_forecast_handoff_v1_read(uuid,uuid,text,uuid)','EXECUTE') read_entry,
      has_function_privilege(current_user,
       'canonical_forecast_handoff_v1_request(uuid,uuid,text,uuid,text,text,text,uuid,text,text,timestamptz)','EXECUTE') request_entry,
      has_function_privilege(current_user,
       'canonical_forecast_handoff_v1_dismiss(uuid,uuid,text,uuid,text,text,text,uuid,integer,text)','EXECUTE') dismiss_entry,
      has_function_privilege(current_user,
       'canonical_forecast_handoff_v1_item(uuid,uuid)','EXECUTE') raw_item,
      has_table_privilege(current_user,'canonical_forecast_handoff_proposals_v1','SELECT') proposal_read,
      has_table_privilege(current_user,'canonical_forecast_handoff_events_v1','SELECT') event_read`)).rows[0];
    expect(privileges).toEqual({ read_entry: true, request_entry: true,
      dismiss_entry: true, raw_item: false, proposal_read: false, event_read: false });
  }, 120000);
});
