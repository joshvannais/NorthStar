'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = () => crypto.randomUUID();
const ZERO = '0'.repeat(64);

realPostgres('Mission 26 original Part 10B mounted monthly KPI boundary', () => {
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
          expectedDigest: 'none', reason: 'Synthetic Part 10B source permission.',
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

  test('binds one authenticated month while withholding every run value and graph point', async () => {
    const route = `/api/v1/forecast/monthly-kpis/${origin.id}`;
    const authenticatedZero = await request(fixture.app)
      .get(`/api/v1/forecast/deterministic-baselines/${origin.id}`)
      .set(fixture.actors.owner.session.headers);
    const owner = await request(fixture.app).get(route)
      .set(fixture.actors.owner.session.headers);
    const admin = await request(fixture.app).get(route)
      .set(fixture.actors.admin.session.headers);
    expect(owner.status).toBe(200); expect(admin.status).toBe(200);
    expect(authenticatedZero.status).toBe(200);
    expect(authenticatedZero.body.data).toMatchObject({ state: 'current',
      output: { value: { kind: 'point', amount: '0' } }, sourceAuthenticated: true });
    expect(owner.headers['cache-control']).toBe('private, no-store');
    expect(owner.body.data).toMatchObject({ state: 'unavailable',
      reason: 'same_run_manifest_not_available', organizationId: fixture.org,
      anchor: { target: { key: 'demand.inbound_leads', definitionVersion: 'v1' },
        unit: { key: 'count', currency: null }, algorithm: {
          key: 'retell_three_complete_month_mean', version: 'm26-retell-three-month-mean-v2' } },
      month: { localStart: horizon, grain: 'business_local_month' },
      run: { runId: null, revision: null, predictionCutoff: null,
        manifestDigest: null, complete: false, current: false },
      currentness: { anchorCurrent: true, manifestCurrent: false,
        sourceReadersCurrent: false, refreshRequired: true,
        correctionOrRevocationApplied: false },
      anchorSourceAuthenticated: true, sameRunManifestComplete: false,
      bundleIssued: false, paidNumericServing: false, automaticActionAuthorized: false });
    expect(owner.body.data.slots.map(slot => slot.key)).toEqual([
      'revenue','operating_cost','profit','margin','demand','capacity']);
    expect(owner.body.data.slots.every(slot => slot.value === null &&
      slot.outputDigest === null && slot.manifestEntryState ===
        'unknown_manifest_unavailable')).toBe(true);
    expect(owner.body.data.graph.series.every(point => point.value === null)).toBe(true);
    expect(owner.body.data.slots[3]).toMatchObject({ unit: { key: 'ratio', currency: null } });
    expect(owner.body.data.slots[5]).toMatchObject({ unit: { key: 'role_hours' },
      scope: { dimensionKind: 'role', dimensionValue: null } });
    expect(admin.body.data.anchor).toEqual(owner.body.data.anchor);
    expect(admin.body.data.digests).toEqual(owner.body.data.digests);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.otherOwner.session.headers)).status).toBe(404);
    expect((await request(fixture.app).get(route)
      .set(fixture.actors.member.session.headers)).status).toBe(403);
  }, 120000);

  test('runtime can call only the guarded reader, never the value constructors', async () => {
    await expect(fixture.runtimePool.query(
      `SELECT public.canonical_forecast_monthly_kpis_v1_unavailable(
       $1,'{}'::jsonb,'same_run_manifest_not_available')`,
    [fixture.org])).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      `SELECT public.canonical_forecast_monthly_kpis_v1_slots(
       'same_run_manifest_not_available')`)).rejects.toMatchObject({ code: '42501' });
    const privileges = (await fixture.runtimePool.query(`SELECT
      has_function_privilege(current_user,
       'canonical_forecast_monthly_kpis_v1_slots(text)','EXECUTE') slots,
      has_function_privilege(current_user,
       'canonical_forecast_monthly_kpis_v1_unavailable(uuid,jsonb,text)','EXECUTE') helper,
      has_function_privilege(current_user,
       'canonical_forecast_monthly_kpis_v1_read(uuid,uuid,text,uuid,uuid)','EXECUTE') reader`))
      .rows[0];
    expect(privileges).toEqual({ slots: false, helper: false, reader: true });
  });

  test('revocation clears every anchor identity and corrected evidence gets a new bundle',
    async () => {
      const owner = fixture.actors.owner;
      const route = `/api/v1/forecast/monthly-kpis/${origin.id}`;
      const before = (await request(fixture.app).get(route)
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
        reason: 'Synthetic owner revokes Part 10B source evidence.' });
      expect(revoked).toMatchObject({ state: 'retell_period_revoked', revision: 2 });
      const stale = await request(fixture.app).get(route).set(owner.session.headers);
      expect(stale.status).toBe(200);
      expect(stale.body.data).toMatchObject({ state: 'unavailable',
        reason: 'deterministic_baseline_not_current', anchor: null, month: null,
        currentness: { anchorCurrent: false, manifestCurrent: false,
          sourceReadersCurrent: false, correctionOrRevocationApplied: true },
        digests: { bundle: null, run: null, manifest: null },
        anchorSourceAuthenticated: false, bundleIssued: false });
      expect(stale.body.data.graph.month).toBeNull();
      expect(stale.body.data.slots.every(slot => slot.value === null &&
        slot.sourceSnapshotDigest === null)).toBe(true);

      const currentEvidence = await periodEvidence(owner, month);
      const restored = await certify(owner, month, currentEvidence, {
        expectedRevision: 2, expectedDigest: revoked.digest,
        reason: 'Synthetic owner recertifies corrected Part 10B source evidence.' });
      expect(restored).toMatchObject({ state: 'retell_period_certified', revision: 3 });
      const recoveredOrigin = await capture(owner);
      const recovered = await request(fixture.app)
        .get(`/api/v1/forecast/monthly-kpis/${recoveredOrigin.id}`)
        .set(owner.session.headers);
      expect(recovered.status).toBe(200);
      expect(recovered.body.data).toMatchObject({ state: 'unavailable',
        reason: 'same_run_manifest_not_available', currentness: { anchorCurrent: true },
        anchorSourceAuthenticated: true, sameRunManifestComplete: false, bundleIssued: false });
      expect(recovered.body.data.digests.bundle).not.toBe(before.digests.bundle);
      expect(recovered.body.data.anchor.sourceSnapshotDigest)
        .not.toBe(before.anchor.sourceSnapshotDigest);
      expect(recovered.body.data.anchor.configurationDigest)
        .toBe(before.anchor.configurationDigest);
    }, 120000);
});
