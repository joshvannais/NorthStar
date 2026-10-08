'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = () => crypto.randomUUID();
const ZERO = '0'.repeat(64);

realPostgres('Mission 26 original Part 9A mounted deterministic baseline', () => {
  let fixture;
  let months;
  let horizon;
  let snapshots;
  let origin;
  let integrationOwnershipId;
  let agentId;

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
    return transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_evidence_v2(
       $1,$2,$3,$4,$5,$6::date) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, snapshots[month].id, month])).rows[0].value);
  }

  async function certify(actor, month, evidence, overrides = {}) {
    const snapshot = snapshots[month];
    const scan = overrides.providerScanEvidence || {
      version: 'm26-retell-provider-scan-v2', organizationId: fixture.org,
      snapshotId: snapshot.id, localMonthStart: month,
      startsAt: evidence.startsAt, endsAt: evidence.endsAt,
      integrationOwnershipId, agentId, canonicalCallDigests: [], callCount: 0,
      sourceSnapshotDigest: evidence.snapshotDigest, scannedAt: new Date().toISOString(),
    };
    return transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_period_certification_v2_mutate(
       $1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10,$11,$12,$13,$14,$15::jsonb,
       $16,$17,$18,$19,$20) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, actor.csrfToken, key(), overrides.action || 'certify',
        snapshot.id, month, overrides.expectedRevision ?? 0,
        overrides.expectedDigest || 'none', ZERO,
        overrides.providerScanCount ?? evidence.sourceCount, ZERO, JSON.stringify(scan),
        overrides.callerConsent ?? true, overrides.providerCoverage ?? true,
        overrides.retention ?? true,
        overrides.reason || 'Synthetic complete zero Retell period certification.',
        'm26-retell-period-certification-v2'])).rows[0].value);
  }

  async function capture(actor) {
    return transaction(async client => (await client.query(
      `SELECT public.canonical_forecast_retell_future_origin_v2_capture(
       $1,$2,$3,$4,$5,$6,$7::date) value`,
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
        actor.authSessionId, actor.csrfToken, key(), horizon])).rows[0].value);
  }

  beforeAll(async () => {
    fixture = await createDatabaseFixture();
    const profile = fixture.profiles[fixture.org];
    horizon = (await fixture.ownerPool.query(`SELECT
      date_trunc('month',(statement_timestamp() AT TIME ZONE
        (raw_profile#>>'{company,timeZone}'))+INTERVAL '1 month')::date::text horizon
      FROM canonical_business_profiles WHERE organization_id=$1 AND is_active`,
    [fixture.org])).rows[0].horizon;
    months = (await fixture.ownerPool.query(`SELECT
      ($1::date-INTERVAL '4 months')::date::text m1,
      ($1::date-INTERVAL '3 months')::date::text m2,
      ($1::date-INTERVAL '2 months')::date::text m3`, [horizon])).rows[0];
    agentId = 'synthetic-' + key();
    integrationOwnershipId = (await fixture.ownerPool.query(
      `INSERT INTO canonical_integration_ownership(organization_id,provider,external_integration_id)
       VALUES($1,'retell',$2) RETURNING id`, [fixture.org, agentId])).rows[0].id;
    const owner = fixture.actors.owner;
    await transaction(async client => client.query(
      `SELECT public.canonical_forecast_retell_source_consent_mutate(
       $1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
        owner.csrfToken, key(), JSON.stringify({ action: 'grant', expectedRevision: 0,
          expectedDigest: 'none', reason: 'Synthetic Part 9A source permission',
          confirmed: true, confirmationVersion: 'm26-retell-demand-source-consent-v1' })]),
    'SERIALIZABLE');
    for (const month of Object.values(months)) {
      const response = await request(fixture.app)
        .post('/api/v1/forecast/reporting-windows/month-attestations')
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ localStartDate: month, action: 'confirm',
          businessProfileId: profile.businessProfileId, businessProfileHash: profile.hash,
          expectedRevision: 0, expectedDigest: null,
          reason: 'Synthetic owner confirms this complete baseline month.',
          confirmed: true, confirmationVersion: 'forecast-calendar-review-v1' });
      if (response.status !== 201) throw new Error(JSON.stringify(response.body));
    }
    snapshots = {};
    for (const month of Object.values(months)) {
      snapshots[month] = (await transaction(async client => (await client.query(
        `SELECT public.canonical_forecast_retell_period_snapshot_v2_capture(
         $1,$2,$3,$4,$5,$6,$7::date) value`,
        [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
          owner.csrfToken, key(), month])).rows[0].value)).snapshot;
      const evidence = await periodEvidence(owner, month);
      expect(evidence).toMatchObject({ state: 'retell_period_ready_for_certification',
        sourceCount: 0, reviewedDistinctLeadCount: 0 });
      expect(await certify(owner, month, evidence)).toMatchObject({
        state: 'retell_period_certified', revision: 1 });
    }
    origin = await capture(owner);
    expect(origin).toMatchObject({ state: 'retell_future_origin_saved',
      amountWithheld: true, paidNumericServing: false });
  }, 120000);

  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('issues one reproducible research baseline from the exact immutable Part 4A receipt', async () => {
    const route = `/api/v1/forecast/deterministic-baselines/${origin.id}`;
    const first = await request(fixture.app).get(route).set(fixture.actors.owner.session.headers);
    const second = await request(fixture.app).get(route).set(fixture.actors.admin.session.headers);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers['cache-control']).toBe('private, no-store');
    expect(first.body.data).toMatchObject({ state: 'current', originId: origin.id,
      target: { key: 'demand.inbound_leads', sourceScope: 'retell_only_tenant_all' },
      output: { value: { kind: 'point', amount: '0' } },
      sourceSnapshot: { completeAsOf: true, includedPeriods: 3, missingPeriods: 0,
        hasMore: false, providerCoverageAttestedRetellOnly: true,
        providerIndependentVerified: false, wholeBusinessCoverageVerified: false },
      evaluation: { state: 'unavailable', evaluatedAt: null },
      sourceAuthenticated: true, researchOnly: true, realForecastEligible: false,
      forecastIssued: true, paidNumericServing: false, probabilityIssued: false,
      calibratedRangeIssued: false, automaticActionAuthorized: false });
    expect(first.body.data.sourceSnapshot.observations.map(item => item.count))
      .toEqual([0, 0, 0]);
    expect(first.body.data.sourceSnapshot.observations.map(item => item.localMonthStart))
      .toEqual(Object.values(months).sort());
    expect(second.body.data.digests).toEqual(first.body.data.digests);
    expect(second.body.data.output).toEqual(first.body.data.output);
    expect(first.body.data.digests).toEqual(expect.objectContaining({
      configuration: expect.stringMatching(/^[0-9a-f]{64}$/),
      input: expect.stringMatching(/^[0-9a-f]{64}$/),
      output: expect.stringMatching(/^[0-9a-f]{64}$/),
      baseline: expect.stringMatching(/^[0-9a-f]{64}$/),
      receipt: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  }, 120000);

  test('tenant and role authority plus direct-table boundaries fail closed', async () => {
    const route = `/api/v1/forecast/deterministic-baselines/${origin.id}`;
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.otherOwner.session.headers)).status).toBe(404);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
    await expect(fixture.runtimePool.query(
      'SELECT * FROM canonical_forecast_retell_future_origins_v2'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      `SELECT public.canonical_forecast_deterministic_baseline_v1_unavailable(
       gen_random_uuid(),'x',statement_timestamp())`))
      .rejects.toMatchObject({ code: '42501' });
  }, 120000);

  test('a business-time-zone change clears the old baseline and exact restoration recovers it', async () => {
    const owner = fixture.actors.owner;
    const profile = (await fixture.ownerPool.query(
      `SELECT raw_profile FROM canonical_business_profiles
       WHERE organization_id=$1 AND is_active`, [fixture.org])).rows[0].raw_profile;
    const changed = JSON.parse(JSON.stringify(profile));
    changed.company.timeZone = profile.company.timeZone === 'UTC' ?
      'America/New_York' : 'UTC';
    try {
      await fixture.ownerPool.query(
        `UPDATE canonical_business_profiles SET raw_profile=$2::jsonb
         WHERE organization_id=$1 AND is_active`, [fixture.org, JSON.stringify(changed)]);
      const stale = await request(fixture.app)
        .get(`/api/v1/forecast/deterministic-baselines/${origin.id}`)
        .set(owner.session.headers);
      expect(stale.status).toBe(200);
      expect(stale.body.data).toMatchObject({ state: 'unavailable', output: null,
        sourceSnapshot: null, forecastIssued: false,
        currentness: { sourceCurrent: false, refreshRequired: true } });
      expect(Object.values(stale.body.data.digests).every(value => value === null)).toBe(true);
    } finally {
      await fixture.ownerPool.query(
        `UPDATE canonical_business_profiles SET raw_profile=$2::jsonb
         WHERE organization_id=$1 AND is_active`, [fixture.org, JSON.stringify(profile)]);
    }
    const recovered = await request(fixture.app)
      .get(`/api/v1/forecast/deterministic-baselines/${origin.id}`)
      .set(owner.session.headers);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data).toMatchObject({ state: 'current',
      output: { value: { amount: '0' } }, forecastIssued: true });
  }, 120000);

  test('revocation clears old values; recertification changes identity and recovers zero', async () => {
    const owner = fixture.actors.owner;
    const before = (await request(fixture.app)
      .get(`/api/v1/forecast/deterministic-baselines/${origin.id}`)
      .set(owner.session.headers)).body.data;
    const month = months.m2;
    const prior = (await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest,evidence
       FROM canonical_forecast_retell_period_certifications_v2
       WHERE organization_id=$1 AND local_month_start=$2::date
       ORDER BY revision DESC LIMIT 1`, [fixture.org, month])).rows[0];
    const revoked = await certify(owner, month, prior.evidence, {
      action: 'revoke', expectedRevision: prior.revision, expectedDigest: prior.digest,
      providerScanCount: 0, providerScanEvidence: {}, callerConsent: false,
      providerCoverage: false, retention: false,
      reason: 'Synthetic owner revokes this complete baseline period.' });
    expect(revoked).toMatchObject({ state: 'retell_period_revoked', revision: 2 });
    const stale = await request(fixture.app)
      .get(`/api/v1/forecast/deterministic-baselines/${origin.id}`)
      .set(owner.session.headers);
    expect(stale.status).toBe(200);
    expect(stale.body.data).toMatchObject({ state: 'unavailable',
      reason: 'source_or_profile_changed_refresh_required', output: null,
      sourceSnapshot: null, sourceAuthenticated: false, forecastIssued: false });
    expect(Object.values(stale.body.data.digests).every(value => value === null)).toBe(true);
    const currentEvidence = await periodEvidence(owner, month);
    const restored = await certify(owner, month, currentEvidence, {
      expectedRevision: 2, expectedDigest: revoked.digest,
      reason: 'Synthetic owner recertifies corrected complete baseline period.' });
    expect(restored).toMatchObject({ state: 'retell_period_certified', revision: 3 });
    const recoveredOrigin = await capture(owner);
    const recovered = await request(fixture.app)
      .get(`/api/v1/forecast/deterministic-baselines/${recoveredOrigin.id}`)
      .set(owner.session.headers);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data).toMatchObject({ state: 'current',
      output: { value: { kind: 'point', amount: '0' } }, forecastIssued: true });
    expect(recovered.body.data.digests.input).not.toBe(before.digests.input);
    expect(recovered.body.data.digests.baseline).not.toBe(before.digests.baseline);
    expect(recovered.body.data.digests.configuration).toBe(before.digests.configuration);
    expect(recovered.body.data.digests.output).toBe(before.digests.output);
    expect((await fixture.ownerPool.query(
      'SELECT count(*)::integer count FROM canonical_forecast_retell_future_origins_v2 WHERE id=$1',
    [origin.id])).rows[0].count).toBe(1);
  }, 120000);
});
