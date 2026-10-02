'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ZERO = '0'.repeat(64);

realPostgres('Mission 26 Part 4A complete Retell periods and future origin v2', () => {
  let fixture;
  let months;
  let horizon;
  let snapshots;
  let certification;
  let callSourceId;
  let providerSessionId;
  let profileRaw;
  let integrationOwnershipId;
  let agentId;

  beforeAll(async () => {
    fixture = await createDatabaseFixture();
    const profile = fixture.profiles[fixture.org];
    profileRaw = (await fixture.ownerPool.query(
      'SELECT raw_profile FROM canonical_business_profiles WHERE organization_id=$1 AND is_active',
    [fixture.org])).rows[0].raw_profile;
    const period = (await fixture.ownerPool.query(`SELECT
      date_trunc('month',(statement_timestamp() AT TIME ZONE
        (raw_profile#>>'{company,timeZone}'))+INTERVAL '1 month')::date::text horizon
      FROM canonical_business_profiles WHERE organization_id=$1 AND is_active`,
    [fixture.org])).rows[0];
    horizon = period.horizon;
    months = (await fixture.ownerPool.query(`SELECT
      ($1::date-INTERVAL '4 months')::date::text m1,
      ($1::date-INTERVAL '3 months')::date::text m2,
      ($1::date-INTERVAL '2 months')::date::text m3`, [horizon])).rows[0];

    agentId = 'synthetic-' + key();
    const ownership = (await fixture.ownerPool.query(
      `INSERT INTO canonical_integration_ownership(organization_id,provider,external_integration_id)
       VALUES($1,'retell',$2) RETURNING id`, [fixture.org, agentId])).rows[0].id;
    integrationOwnershipId = ownership;
    const owner = fixture.actors.owner;
    await transaction(async client => client.query(
      'SELECT public.canonical_forecast_retell_source_consent_mutate($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, key(), JSON.stringify({ action: 'grant', expectedRevision: 0,
          expectedDigest: 'none', reason: 'Synthetic Part 4A source permission',
          confirmed: true, confirmationVersion: 'm26-retell-demand-source-consent-v1' })]),
    'SERIALIZABLE');

    const eventAt = `${months.m2.slice(0, 8)}15T12:00:00.000Z`;
    const operation = key(), graph = key(), customer = key(), transcript = key();
    callSourceId = transcript;
    const external = 'synthetic-call-' + key();
    providerSessionId = external;
    await fixture.ownerPool.query(
      `INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
       payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
       VALUES($1,$2,$3,$4,$4,'completed',$1,NOW()+INTERVAL '1 hour',200,'{}',NOW())`,
    [operation, fixture.org, graph, hash(key())]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name)
       VALUES($1,$2,$3,$4,'Synthetic caller')`,
    [customer, fixture.org, operation, graph]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,
       source,source_version,external_call_id,external_transcript_id,transcript_text,
       normalized_fingerprint,occurred_at)
       VALUES($1,$2,$3,$4,$5,'retell','synthetic-v1',$6,$7,'Synthetic call',$8,$9)`,
    [transcript, fixture.org, operation, graph, customer, external,
      external + ':transcript', hash(external), eventAt]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_communications(id,organization_id,operation_id,graph_id,
       customer_id,transcript_id,channel,direction,body,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,'voice_call','inbound','Synthetic call',$7)`,
    [key(), fixture.org, operation, graph, customer, transcript, eventAt]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
       customer_id,status,service_type,job_scope)
       VALUES($1,$2,$3,$4,$5,'lead','general','{}')`,
    [key(), fixture.org, operation, graph, customer]);
    await fixture.ownerPool.query(
      `INSERT INTO canonical_voice_sessions(organization_id,external_session_id,provider,
       provider_session_id,integration_ownership_id,business_profile_id,business_profile_version,
       business_profile_hash,status,direction,metadata,canonical_operation_id,completed_at)
       VALUES($1,$2,'retell',$2,$3,$4,'org-profile-v1',$5,'completed','inbound',
       '{"retellPayloadDirection":"inbound"}'::jsonb,$6,NOW())`,
    [fixture.org, external, ownership, profile.businessProfileId, profile.hash, operation]);

    for (const month of Object.values(months)) {
      const response = await request(fixture.app)
        .post('/api/v1/forecast/reporting-windows/month-attestations')
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ localStartDate: month, action: 'confirm',
          businessProfileId: profile.businessProfileId,
          businessProfileHash: profile.hash, expectedRevision: 0,
          expectedDigest: null, reason: 'Synthetic owner confirms this historical month.',
          confirmed: true, confirmationVersion: 'forecast-calendar-review-v1' });
      if (response.status !== 201) throw new Error(`Month attestation failed: ${response.status}`);
    }
    snapshots = {};
    for (const month of Object.values(months)) {
      snapshots[month] = (await transaction(async client => (await client.query(
        `SELECT public.canonical_forecast_retell_period_snapshot_v2_capture(
         $1,$2,$3,$4,$5,$6,$7::date) value`,
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
          owner.csrfToken, key(), month])).rows[0].value.snapshot));
    }
    const snapshot = snapshots[months.m2];
    const pin = snapshot.sources.find(item => item.sourceId === transcript);
    await transaction(async client => client.query(
      'SELECT public.canonical_forecast_retell_call_review_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, key(), snapshot.id, JSON.stringify({ transcriptId: transcript,
          expectedSourceDigest: pin.digest, expectedRevision: 0, expectedDigest: 'none',
          disposition: 'new_lead', anchorTranscriptId: null,
          reason: 'Synthetic owner confirms a distinct lead', confirmed: true,
          confirmationVersion: 'm26-retell-call-review-v1' })]), 'SERIALIZABLE');
  }, 120000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function transaction(operation, isolation = 'READ COMMITTED') {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function periodEvidence(actor, month) {
    const snapshot = snapshots[month];
    return transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_evidence_v2(
       $1,$2,$3,$4,$5,$6::date) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, snapshot.id, month])).rows[0].value);
  }

  async function certify(actor, month, evidence, overrides = {}) {
    const snapshot = snapshots[month];
    const providerScanEvidence = overrides.providerScanEvidence || {
      version: 'm26-retell-provider-scan-v2', organizationId: fixture.org,
      snapshotId: snapshot.id, localMonthStart: month,
      startsAt: evidence.startsAt, endsAt: evidence.endsAt,
      integrationOwnershipId, agentId,
      canonicalCallDigests: evidence.sourceCount === 0 ? [] : [hash(providerSessionId)],
      callCount: evidence.sourceCount, sourceSnapshotDigest: evidence.snapshotDigest,
      scannedAt: new Date().toISOString(),
    };
    return transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_certification_v2_mutate(
       $1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,$15::jsonb,
       $16,$17,$18,$19,$20) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, actor.csrfToken, overrides.key || key(),
        overrides.action || 'certify', snapshot.id, month,
        overrides.expectedRevision ?? 0, overrides.expectedDigest || 'none', ZERO,
        overrides.providerScanCount ?? evidence.sourceCount,
        ZERO, JSON.stringify(providerScanEvidence),
        overrides.callerConsent ?? true, overrides.providerCoverage ?? true,
        overrides.retention ?? true,
        overrides.reason || 'Synthetic complete Retell period certification.',
        'm26-retell-period-certification-v2'])).rows[0].value);
  }

  async function capture(actor, requestKey = key(), requestedHorizon = horizon) {
    return transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_future_origin_v2_capture(
       $1,$2,$3,$4,$5,$6,$7::date) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, actor.csrfToken, requestKey, requestedHorizon])).rows[0].value);
  }

  async function read(actor, id) {
    return transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_future_origin_v2_read(
       $1,$2,$3,$4,$5) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, id])).rows[0].value);
  }

  test('server derives positive and authenticated-zero completed periods', async () => {
    const evidence = {};
    for (const month of Object.values(months)) evidence[month] =
      await periodEvidence(fixture.actors.owner, month);
    expect(evidence[months.m1]).toMatchObject({
      state: 'retell_period_ready_for_certification', sourceCount: 0,
      reviewedDistinctLeadCount: 0, scope: 'retell_only_tenant_all' });
    expect(evidence[months.m2]).toMatchObject({
      state: 'retell_period_ready_for_certification', sourceCount: 1,
      reviewedDistinctLeadCount: 1 });
    expect(evidence[months.m3]).toMatchObject({
      state: 'retell_period_ready_for_certification', sourceCount: 0,
      reviewedDistinctLeadCount: 0 });
    for (const month of Object.values(months)) {
      certification = await certify(fixture.actors.owner, month, evidence[month]);
      expect(certification).toMatchObject({ state: 'retell_period_certified',
        revision: 1, replayed: false });
    }
    expect((await fixture.ownerPool.query(
      `SELECT local_month_start::text period_start,provider_scan_count,
       evidence->>'reviewedDistinctLeadCount' lead_count
       FROM canonical_forecast_retell_period_certifications_v2
       WHERE organization_id=$1 ORDER BY local_month_start`, [fixture.org])).rows)
      .toEqual([
        { period_start: months.m1, provider_scan_count: 0, lead_count: '0' },
        { period_start: months.m2, provider_scan_count: 1, lead_count: '1' },
        { period_start: months.m3, provider_scan_count: 0, lead_count: '0' },
      ]);
  }, 120000);

  test('month-scoped capture remains available beyond the lifetime 1,000-call bound', async () => {
    const oldDate = new Date(`${months.m1}T12:00:00.000Z`);
    oldDate.setUTCMonth(oldDate.getUTCMonth() - 2);
    const oldOccurredAt = oldDate.toISOString();
    const profile = fixture.profiles[fixture.org];
    await fixture.ownerPool.query(`DO $block$
      DECLARE i integer; operation_id uuid; graph_id uuid; customer_id uuid;
       transcript_id uuid; external_id text; fingerprint text;
      BEGIN
       FOR i IN 1..1001 LOOP
        operation_id:=gen_random_uuid(); graph_id:=gen_random_uuid();
        customer_id:=gen_random_uuid(); transcript_id:=gen_random_uuid();
        external_id:='old-part4a-'||gen_random_uuid()::text;
        fingerprint:=encode(sha256(convert_to(external_id,'UTF8')),'hex');
        INSERT INTO canonical_operations(id,organization_id,graph_id,idempotency_key_hash,
         payload_fingerprint,state,lease_owner,lease_expires_at,result_status,result_body,completed_at)
        VALUES(operation_id,'${fixture.org}',graph_id,fingerprint,fingerprint,'completed',operation_id,
         NOW()+INTERVAL '1 hour',200,'{}',NOW());
        INSERT INTO canonical_customers(id,organization_id,operation_id,graph_id,name)
        VALUES(customer_id,'${fixture.org}',operation_id,graph_id,'Old synthetic caller');
        INSERT INTO canonical_transcripts(id,organization_id,operation_id,graph_id,customer_id,
         source,source_version,external_call_id,external_transcript_id,transcript_text,
         normalized_fingerprint,occurred_at)
        VALUES(transcript_id,'${fixture.org}',operation_id,graph_id,customer_id,'retell','synthetic-v1',
         external_id,external_id||':transcript','Old synthetic call',fingerprint,'${oldOccurredAt}');
        INSERT INTO canonical_communications(id,organization_id,operation_id,graph_id,
         customer_id,transcript_id,channel,direction,body,occurred_at)
        VALUES(gen_random_uuid(),'${fixture.org}',operation_id,graph_id,customer_id,transcript_id,
         'voice_call','inbound','Old synthetic call','${oldOccurredAt}');
        INSERT INTO canonical_opportunities(id,organization_id,operation_id,graph_id,
         customer_id,status,service_type,job_scope)
        VALUES(gen_random_uuid(),'${fixture.org}',operation_id,graph_id,customer_id,
         'lead','general','{}');
        INSERT INTO canonical_voice_sessions(organization_id,external_session_id,provider,
         provider_session_id,integration_ownership_id,business_profile_id,business_profile_version,
         business_profile_hash,status,direction,metadata,canonical_operation_id,completed_at)
        VALUES('${fixture.org}',external_id,'retell',external_id,'${integrationOwnershipId}',
         '${profile.businessProfileId}','org-profile-v1','${profile.hash}','completed','inbound',
         '{"retellPayloadDirection":"inbound"}'::jsonb,operation_id,NOW());
       END LOOP;
      END $block$`);
    expect((await fixture.ownerPool.query(
      `SELECT jsonb_array_length(canonical_forecast_retell_call_pins($1,clock_timestamp())) count`,
    [fixture.org])).rows[0].count).toBe(1001);
    const owner = fixture.actors.owner;
    const value = await transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_snapshot_v2_capture(
       $1,$2,$3,$4,$5,$6,$7::date) value`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, key(), months.m1])).rows[0].value);
    expect(value).toMatchObject({ state: 'retell_period_snapshot_saved', replayed: false,
      snapshot: { localMonthStart: months.m1, sourceCount: 0,
        windowVersion: 'm26-retell-period-source-window-v2' } });
  }, 120000);

  test('current certification read returns the exact token required for revocation', async () => {
    const owner = fixture.actors.owner;
    const current = await transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_certification_v2_read(
       $1,$2,$3,$4,$5::date) value`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole,
        owner.authSessionId, months.m2])).rows[0].value);
    expect(current).toMatchObject({ state: 'retell_period_certified',
      localMonthStart: months.m2, revision: 1, expectedRevision: 1,
      action: 'certify', snapshotId: snapshots[months.m2].id });
    expect(current.expectedDigest).toBe(current.digest);
    expect(JSON.stringify(current)).not.toMatch(/providerScan|sourceManifest|reviewManifest/);
    const other = fixture.actors.otherOwner;
    expect(await transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_certification_v2_read(
       $1,$2,$3,$4,$5::date) value`,
      [other.organizationId, other.actorUserId, other.actorAccessRole,
        other.authSessionId, months.m2])).rows[0].value)).toMatchObject({
      state: 'retell_period_certification_missing', expectedRevision: 0,
      expectedDigest: 'none' });
  }, 120000);

  test('saves only the server-selected next-month research output and withholds amount', async () => {
    expect(await capture(fixture.actors.owner, key(), months.m3))
      .toMatchObject({ state: 'retell_future_unavailable', reason: 'horizon_not_next_local_month' });
    const requestKey = key();
    const saved = await capture(fixture.actors.owner, requestKey);
    expect(saved).toMatchObject({ state: 'retell_future_origin_saved', replayed: false,
      localHorizonStart: horizon, researchOnly: true, amountWithheld: true,
      serviceMixAvailable: false, areaForecastAvailable: false,
      realForecastEligible: false, paidNumericServing: false,
      forecastServingEnabled: false });
    expect(JSON.stringify(saved)).not.toContain('outputDigest');
    expect(await capture(fixture.actors.owner, requestKey)).toMatchObject({
      id: saved.id, replayed: true, paidNumericServing: false });
    await expect(capture(fixture.actors.owner, requestKey, months.m3))
      .rejects.toMatchObject({ code: '23505' });
    expect(await capture(fixture.actors.admin)).toMatchObject({
      state: 'retell_future_origin_saved', replayed: false,
      amountWithheld: true, paidNumericServing: false });
    const current = await read(fixture.actors.admin, saved.id);
    expect(current).toMatchObject({
      state: 'retell_future_origin_current', id: saved.id,
      localHorizonStart: horizon, amountWithheld: true, serviceMixAvailable: false,
      areaForecastAvailable: false, providerIndependentVerified: false,
      wholeBusinessCoverageVerified: false, paidNumericServing: false });
    expect(JSON.stringify(current)).not.toContain('outputDigest');
    const privateOutput = (await fixture.ownerPool.query(
      'SELECT private_output FROM canonical_forecast_retell_future_origins_v2 WHERE id=$1',
    [saved.id])).rows[0].private_output;
    expect(privateOutput.value).toEqual({ kind: 'point', amount: '0.333333' });
    expect(JSON.stringify(saved)).not.toContain('0.333333');
  }, 120000);

  test('a changed Retell integration identity makes the saved origin stale', async () => {
    const saved = await capture(fixture.actors.owner);
    await fixture.ownerPool.query(
      `UPDATE canonical_integration_ownership SET status='inactive' WHERE id=$1`,
    [integrationOwnershipId]);
    const replacement = (await fixture.ownerPool.query(
      `INSERT INTO canonical_integration_ownership(
        organization_id,provider,external_integration_id,status)
       VALUES($1,'retell',$2,'active') RETURNING id`,
    [fixture.org, 'replacement-' + key()])).rows[0].id;
    try {
      expect(await read(fixture.actors.owner, saved.id)).toMatchObject({
        state: 'retell_future_origin_stale', id: saved.id,
        refreshRequired: true, amountWithheld: true });
    } finally {
      await fixture.ownerPool.query(
        `UPDATE canonical_integration_ownership SET status='inactive' WHERE id=$1`,
      [replacement]);
      await fixture.ownerPool.query(
        `UPDATE canonical_integration_ownership SET status='active' WHERE id=$1`,
      [integrationOwnershipId]);
    }
  }, 120000);

  test('later revocation makes the immutable origin stale without rewriting it', async () => {
    const saved = await capture(fixture.actors.owner);
    await fixture.ownerPool.query(
      `UPDATE canonical_voice_sessions SET direction='outbound'
       WHERE organization_id=$1 AND provider_session_id=$2`,
    [fixture.org, providerSessionId]);
    expect(await read(fixture.actors.owner, saved.id)).toMatchObject({
      state: 'retell_future_origin_stale', refreshRequired: true });
    await fixture.ownerPool.query(
      `UPDATE canonical_voice_sessions SET direction='inbound'
       WHERE organization_id=$1 AND provider_session_id=$2`,
    [fixture.org, providerSessionId]);
    expect(await read(fixture.actors.owner, saved.id)).toMatchObject({
      state: 'retell_future_origin_current' });
    await fixture.ownerPool.query(
      `UPDATE canonical_business_profiles
       SET raw_profile=jsonb_set(raw_profile,'{company,timeZone}','"America/New_York"'::jsonb)
       WHERE organization_id=$1 AND is_active`, [fixture.org]);
    expect(await read(fixture.actors.owner, saved.id)).toMatchObject({
      state: 'retell_future_origin_stale', refreshRequired: true });
    await fixture.ownerPool.query(
      `UPDATE canonical_business_profiles SET raw_profile=$2::jsonb
       WHERE organization_id=$1 AND is_active`, [fixture.org, JSON.stringify(profileRaw)]);
    expect(await read(fixture.actors.owner, saved.id)).toMatchObject({
      state: 'retell_future_origin_current' });
    const reviews = (await transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_call_reviews_read(
       $1,$2,$3,$4,$5) value`, [fixture.org, fixture.actors.owner.actorUserId,
        fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId,
        snapshots[months.m2].id])).rows[0].value));
    const currentReview = reviews.calls.find(item => item.callSourceId === callSourceId);
    await transaction(async client => client.query(
      'SELECT public.canonical_forecast_retell_call_review_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
      [fixture.org, fixture.actors.owner.actorUserId,
        fixture.actors.owner.actorAccessRole, fixture.actors.owner.authSessionId,
        fixture.actors.owner.csrfToken, key(), snapshots[months.m2].id, JSON.stringify({
          transcriptId: callSourceId, expectedSourceDigest:
            snapshots[months.m2].sources.find(item => item.sourceId === callSourceId).digest,
          expectedRevision: currentReview.reviewRevision,
          expectedDigest: currentReview.reviewDigest, disposition: 'not_lead',
          anchorTranscriptId: null,
          reason: 'Synthetic correction changes the reviewed disposition.',
          confirmed: true, confirmationVersion: 'm26-retell-call-review-v1' })]),
    'SERIALIZABLE');
    expect(await read(fixture.actors.owner, saved.id)).toMatchObject({
      state: 'retell_future_origin_stale', id: saved.id,
      refreshRequired: true, amountWithheld: true });
    const current = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,evidence
       FROM canonical_forecast_retell_period_certifications_v2
       WHERE organization_id=$1 AND local_month_start=$2::date
       ORDER BY revision DESC LIMIT 1`, [fixture.org, months.m2])).rows[0];
    const revoked = await certify(fixture.actors.owner, months.m2, current.evidence, {
      action: 'revoke', expectedRevision: current.revision,
      expectedDigest: current.digest, providerScanCount: 0,
      providerScanEvidence: {}, callerConsent: false,
      providerCoverage: false, retention: false,
      reason: 'Synthetic owner withdraws this completed period.' });
    expect(revoked).toMatchObject({ state: 'retell_period_revoked', revision: 2 });
    expect(await read(fixture.actors.owner, saved.id)).toMatchObject({
      state: 'retell_future_origin_stale', id: saved.id,
      refreshRequired: true, amountWithheld: true });
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::integer count FROM canonical_forecast_retell_future_origins_v2 WHERE id=$1',
    [saved.id])).rows[0].count).toBe(1);
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_forecast_retell_future_origins_v2 SET recorded_at=recorded_at WHERE id=$1',
    [saved.id])).rejects.toMatchObject({ code: '23514' });
    expect(await capture(fixture.actors.owner)).toMatchObject({
      state: 'retell_future_unavailable', reason: 'complete_period_missing' });
  }, 120000);

  test('role, tenant, CSRF, direct-table and malformed attestation inputs fail closed', async () => {
    await expect(capture(fixture.actors.member)).rejects.toMatchObject({ code: '22023' });
    await expect(capture({ ...fixture.actors.owner, csrfToken: 'wrong' }))
      .rejects.toMatchObject({ code: '42501' });
    expect(await read(fixture.actors.otherOwner, key())).toBeNull();
    expect(await capture(fixture.actors.otherOwner)).toMatchObject({
      state: 'retell_future_unavailable', reason: 'complete_period_missing' });
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::integer count FROM canonical_forecast_retell_future_origins_v2 WHERE organization_id=$1',
    [fixture.otherOrg])).rows[0].count).toBe(0);
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_retell_future_origins_v2'))
      .rejects.toMatchObject({ code: '42501' });
    const evidence = await periodEvidence(fixture.actors.owner, months.m1);
    await expect(certify(fixture.actors.owner, months.m1, evidence, {
      providerScanCount: 1 })).rejects.toMatchObject({ code: '40001' });
    await expect(certify(fixture.actors.owner, months.m1, evidence, {
      callerConsent: false })).rejects.toMatchObject({ code: '22023' });
    expect((await fixture.ownerPool.query(
      `SELECT count(*)::integer count FROM canonical_forecast_retell_period_certifications_v2
       WHERE organization_id=$1 AND local_month_start=$2::date`,
    [fixture.org, months.m1])).rows[0].count).toBe(1);
  }, 120000);

  test('a stale idempotent month-snapshot replay returns explicit refresh-required state', async () => {
    const owner = fixture.actors.owner;
    const requestKey = key();
    const first = await transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_snapshot_v2_capture(
       $1,$2,$3,$4,$5,$6,$7::date) value`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, requestKey, months.m2])).rows[0].value);
    expect(first).toMatchObject({ state: 'retell_period_snapshot_saved', replayed: false });
    const original = (await fixture.ownerPool.query(
      'SELECT occurred_at FROM canonical_transcripts WHERE id=$1', [callSourceId])).rows[0].occurred_at;
    try {
      await fixture.ownerPool.query(
        "UPDATE canonical_transcripts SET occurred_at=occurred_at+INTERVAL '1 minute' WHERE id=$1",
      [callSourceId]);
      expect(await transaction(async client => (await client.query(
        `SELECT public.canonical_forecast_retell_period_snapshot_v2_capture(
         $1,$2,$3,$4,$5,$6,$7::date) value`,
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
          owner.csrfToken, requestKey, months.m2])).rows[0].value)).toEqual({
        state: 'retell_period_snapshot_unavailable',
        reason: 'source_changed_refresh_required', replayed: true,
      });
    } finally {
      await fixture.ownerPool.query(
        'UPDATE canonical_transcripts SET occurred_at=$2 WHERE id=$1',
      [callSourceId, original]);
    }
  }, 120000);

  test('an in-flight source writer blocks capture and leaves no partial origin', async () => {
    const writer = await fixture.ownerPool.connect();
    const captureClient = await fixture.runtimePool.connect();
    const before = (await fixture.ownerPool.query(
      'SELECT count(*)::integer count FROM canonical_forecast_retell_future_origins_v2 WHERE organization_id=$1',
    [fixture.org])).rows[0].count;
    try {
      await writer.query('BEGIN');
      await writer.query(
        'UPDATE canonical_transcripts SET occurred_at=occurred_at WHERE id=$1',
        [callSourceId]);
      await captureClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await captureClient.query("SET LOCAL lock_timeout='150ms'");
      const owner = fixture.actors.owner;
      await expect(captureClient.query(
        `SELECT public.canonical_forecast_retell_future_origin_v2_capture(
         $1,$2,$3,$4,$5,$6,$7::date) value`,
        [fixture.org, owner.actorUserId, owner.actorAccessRole,
          owner.authSessionId, owner.csrfToken, key(), horizon]))
        .rejects.toMatchObject({ code: '55P03' });
      await captureClient.query('ROLLBACK');
      expect((await fixture.ownerPool.query(
        'SELECT count(*)::integer count FROM canonical_forecast_retell_future_origins_v2 WHERE organization_id=$1',
      [fixture.org])).rows[0].count).toBe(before);
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      await captureClient.query('ROLLBACK').catch(() => {});
      writer.release();
      captureClient.release();
    }
  }, 120000);

  test('a consent-stale month-snapshot replay returns explicit refresh-required state', async () => {
    const owner = fixture.actors.owner;
    const requestKey = key();
    const first = await transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_snapshot_v2_capture(
       $1,$2,$3,$4,$5,$6,$7::date) value`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, requestKey, months.m2])).rows[0].value);
    expect(first).toMatchObject({ state: 'retell_period_snapshot_saved', replayed: false });
    const current = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest
       FROM canonical_forecast_retell_source_consents
       WHERE organization_id=$1 AND purpose_key='forecast_demand_source'
       ORDER BY revision DESC LIMIT 1`, [fixture.org])).rows[0];
    await transaction(async client => client.query(
      'SELECT public.canonical_forecast_retell_source_consent_mutate($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, key(), JSON.stringify({ action: 'revoke',
          expectedRevision: Number(current.revision), expectedDigest: current.digest,
          reason: 'Synthetic owner withdraws the Retell demand source permission.',
          confirmed: true, confirmationVersion: 'm26-retell-demand-source-consent-v1' })]),
    'SERIALIZABLE');
    expect(await transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_snapshot_v2_capture(
       $1,$2,$3,$4,$5,$6,$7::date) value`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, requestKey, months.m2])).rows[0].value)).toEqual({
      state: 'retell_period_snapshot_unavailable',
      reason: 'source_permission_changed_refresh_required', replayed: true,
    });
  }, 120000);
});
