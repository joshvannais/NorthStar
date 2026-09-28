'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const path = '/api/v1/forecast/reporting-windows/month-attestations';
const key = () => crypto.randomUUID();
const priorMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString().slice(0, 10);
};

realPostgres('Mission 26 Part 2B reviewed historical profile claim', () => {
  let fixture;
  beforeEach(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterEach(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  function body(overrides = {}) {
    return { localStartDate: priorMonth(), action: 'confirm',
      businessProfileId: fixture.profiles[fixture.org].businessProfileId,
      businessProfileHash: fixture.profiles[fixture.org].hash,
      expectedRevision: 0, expectedDigest: null,
      reason: 'Synthetic owner confirms the recorded hours for this month.',
      confirmed: true, confirmationVersion: 'forecast-calendar-review-v1',
      ...overrides };
  }

  test('guarded owner claim is immutable, revocable and never certifies observation coverage',
    async () => {
      const owner = fixture.actors.owner;
      const month = priorMonth();
      const missing = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie)
        .query({ localStartDate: month });
      expect(missing.status).toBe(200);
      expect(missing.body.data).toMatchObject({ attestation: null,
        ownerConfirmedHistoricalProfile: false, profilePinVerified: false,
        historicalCalendarVerified: false,
        observationCoverageVerified: false, forecastIssued: false });

      const requestKey = key();
      const confirmed = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', requestKey)
        .send(body());
      expect(confirmed.status).toBe(201);
      expect(confirmed.body.data).toMatchObject({ revision: 1, action: 'confirm',
        replayed: false, ownerConfirmedHistoricalProfile: true,
        profilePinVerified: true,
        historicalCalendarVerified: false, observationCoverageVerified: false,
        forecastIssued: false });
      const replay = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', requestKey)
        .send(body());
      expect(replay.status).toBe(200);
      expect(replay.body.data.id).toBe(confirmed.body.data.id);
      expect(replay.body.data.replayed).toBe(true);

      const read = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie)
        .query({ localStartDate: month });
      expect(read.status).toBe(200);
      expect(read.body.data.attestation).toMatchObject({
        id: confirmed.body.data.id, revision: 1, action: 'confirm',
        businessProfileId: fixture.profiles[fixture.org].businessProfileId,
        businessProfileHash: fixture.profiles[fixture.org].hash,
        evidenceKind: 'owner_reviewed_historical_profile_applicability',
        historicalCalendarVerified: false, observationCoverageVerified: false,
        forecastIssued: false });
      expect(read.body.data.profilePinVerified).toBe(true);
      expect(JSON.stringify(read.body)).not.toContain('rawProfile');

      const stale = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(body());
      expect(stale.status).toBe(409);
      const revoked = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(body({ action: 'revoke', expectedRevision: 1,
          expectedDigest: confirmed.body.data.digest,
          reason: 'Synthetic correction: applicability withdrawn.' }));
      expect(revoked.status).toBe(201);
      expect(revoked.body.data).toMatchObject({ revision: 2, action: 'revoke',
        ownerConfirmedHistoricalProfile: false, profilePinVerified: false,
        forecastIssued: false });
      const after = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie)
        .query({ localStartDate: month });
      expect(after.body.data.attestation).toMatchObject({ revision: 2,
        action: 'revoke',
        evidenceKind: 'owner_reviewed_historical_profile_applicability' });
      expect(after.body.data.ownerConfirmedHistoricalProfile).toBe(false);
      expect((await fixture.ownerPool.query(
        'SELECT revision,action FROM canonical_forecast_profile_month_attestations WHERE organization_id=$1 ORDER BY revision',
        [fixture.org])).rows.map(row => [row.revision, row.action]))
        .toEqual([[1, 'confirm'], [2, 'revoke']]);
    }, 120000);

  test('a corrupt pinned profile disables use of the claim but cannot prevent revocation',
    async () => {
      const owner = fixture.actors.owner;
      const confirmed = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(body());
      expect(confirmed.status).toBe(201);
      await fixture.ownerPool.query(
        'UPDATE canonical_business_profiles SET normalized_profile_hash=$2 WHERE organization_id=$1 AND is_active=TRUE',
        [fixture.org, 'c'.repeat(64)]);
      const read = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie)
        .query({ localStartDate: priorMonth() });
      expect(read.status).toBe(200);
      expect(read.body.data).toMatchObject({ ownerConfirmedHistoricalProfile: true,
        profilePinVerified: false,
        historicalCalendarVerified: false, forecastIssued: false });
      const revoked = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(body({ action: 'revoke', expectedRevision: 1,
          expectedDigest: confirmed.body.data.digest,
          reason: 'Synthetic correction after profile source became invalid.' }));
      expect(revoked.status).toBe(201);
      expect(revoked.body.data).toMatchObject({ action: 'revoke',
        profilePinVerified: false, forecastIssued: false });
    }, 120000);

  test('a later raw calendar change invalidates the profile pin even when normalized hash is unchanged',
    async () => {
      const owner = fixture.actors.owner;
      const confirmed = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(body());
      expect(confirmed.status).toBe(201);
      await fixture.ownerPool.query(
        `UPDATE canonical_business_profiles
            SET raw_profile=jsonb_set(raw_profile,'{company,timeZone}','"America/New_York"'::jsonb)
          WHERE organization_id=$1 AND is_active=TRUE`, [fixture.org]);
      const read = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie)
        .query({ localStartDate: priorMonth() });
      expect(read.status).toBe(200);
      expect(read.body.data).toMatchObject({ ownerConfirmedHistoricalProfile: true,
        profilePinVerified: false, historicalCalendarVerified: false,
        observationCoverageVerified: false, forecastIssued: false });
      const replay = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(body({ action: 'revoke', expectedRevision: 1,
          expectedDigest: confirmed.body.data.digest,
          reason: 'Synthetic correction after raw calendar change.' }));
      expect(replay.status).toBe(201);
      expect(replay.body.data).toMatchObject({ action: 'revoke',
        profilePinVerified: false, forecastIssued: false });
    }, 120000);

  test('a corrupt normalized source cannot create a new historical claim',
    async () => {
      const owner = fixture.actors.owner;
      await fixture.ownerPool.query(
        'UPDATE canonical_business_profiles SET normalized_profile_hash=$2 WHERE organization_id=$1 AND is_active=TRUE',
        [fixture.org, 'c'.repeat(64)]);
      const attempted = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(body({ businessProfileHash: 'c'.repeat(64) }));
      expect(attempted.status).toBe(503);
      expect((await fixture.ownerPool.query(
        'SELECT count(*)::integer AS count FROM canonical_forecast_profile_month_attestations WHERE organization_id=$1',
        [fixture.org])).rows[0].count).toBe(0);
    }, 120000);

  test.each(['timeZone', 'hours'])(
    'raw %s corruption before confirmation cannot be sealed into a profile pin',
    async (field) => {
      const owner = fixture.actors.owner;
      if (field === 'timeZone') {
        await fixture.ownerPool.query(
          `UPDATE canonical_business_profiles
              SET raw_profile=jsonb_set(raw_profile,'{company,timeZone}',
                to_jsonb(CASE WHEN raw_profile#>>'{company,timeZone}'='UTC'
                  THEN 'America/New_York' ELSE 'UTC' END))
            WHERE organization_id=$1 AND is_active=TRUE`, [fixture.org]);
      } else {
        await fixture.ownerPool.query(
          `UPDATE canonical_business_profiles
              SET raw_profile=jsonb_set(raw_profile,'{hours}',
                COALESCE(raw_profile->'hours','{}'::jsonb)||'{"calendarAuthorityTampered":true}'::jsonb)
            WHERE organization_id=$1 AND is_active=TRUE`, [fixture.org]);
      }
      const attempted = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(body());
      expect(attempted.status).toBe(409);
      expect((await fixture.ownerPool.query(
        'SELECT count(*)::integer AS count FROM canonical_forecast_profile_month_attestations WHERE organization_id=$1',
        [fixture.org])).rows[0].count).toBe(0);
    }, 120000);

  test('startup fails closed on inherited attestation access and restores only guarded entries',
    async () => {
      const startup = async () => {
        const client = await fixture.ownerPool.connect();
        try {
          await client.query('BEGIN');
          try {
            await fixture.db.grantAndVerifyRuntimeAuthorityForTests(client,
              { runtimeRole: fixture.roles.runtime });
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        } finally {
          client.release();
        }
      };
      const privileges = async () => (await fixture.ownerPool.query(
        `SELECT
          has_table_privilege($1,'canonical_forecast_profile_month_attestations',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS table_access,
          has_function_privilege($1,
            'canonical_forecast_profile_month_attestation_immutable()','EXECUTE') AS helper,
          has_function_privilege($1,
            'canonical_forecast_profile_month_attestation_capture(uuid,uuid,text,uuid,text,text,date,text,uuid,text,integer,text,text,boolean,text)',
            'EXECUTE') AS capture_entry,
          has_function_privilege($1,
            'canonical_forecast_profile_month_attestation_read(uuid,uuid,text,uuid,date)',
            'EXECUTE') AS read_entry`, [fixture.roles.runtime])).rows[0];

      await fixture.ownerPool.query(
        'GRANT SELECT ON TABLE canonical_forecast_profile_month_attestations TO PUBLIC');
      try {
        await expect(startup()).rejects.toThrow(
          'Runtime database role privilege verification failed');
      } finally {
        await fixture.ownerPool.query(
          'REVOKE ALL ON TABLE canonical_forecast_profile_month_attestations FROM PUBLIC');
      }

      await fixture.ownerPool.query(
        'GRANT EXECUTE ON FUNCTION canonical_forecast_profile_month_attestation_immutable() TO PUBLIC');
      try {
        await expect(startup()).rejects.toThrow(
          'Runtime database role privilege verification failed');
      } finally {
        await fixture.ownerPool.query(
          'REVOKE ALL ON FUNCTION canonical_forecast_profile_month_attestation_immutable() FROM PUBLIC');
      }

      const runtimeRole = `"${fixture.roles.runtime.replace(/"/g, '""')}"`;
      await fixture.ownerPool.query(
        `REVOKE ALL ON FUNCTION canonical_forecast_profile_month_attestation_read(uuid,uuid,text,uuid,date) FROM ${runtimeRole}`);
      expect((await privileges()).read_entry).toBe(false);
      await expect(startup()).resolves.toBeUndefined();
      expect(await privileges()).toEqual({ table_access: false, helper: false,
        capture_entry: true, read_entry: true });
    }, 180000);

  test('tenant, role, CSRF, future-period and direct-table boundaries fail closed',
    async () => {
      const owner = fixture.actors.owner;
      expect((await request(fixture.app).post(path)
        .set('Idempotency-Key', key()).send(body())).status).toBe(401);
      expect((await request(fixture.app).post(path)
        .set(fixture.actors.member.session.headers)
        .set('Idempotency-Key', key()).send(body())).status).toBe(403);
      expect((await request(fixture.app).post(path)
        .set('Cookie', owner.session.headers.Cookie)
        .set('Idempotency-Key', key()).send(body())).status).toBe(403);
      expect((await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(body({ confirmed: false }))).status).toBe(400);
      const future = new Date(Date.UTC(new Date().getUTCFullYear(),
        new Date().getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
      expect((await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send(body({ localStartDate: future }))).status).toBe(400);
      expect((await request(fixture.app).post(path)
        .set(fixture.actors.otherOwner.session.headers)
        .set('Idempotency-Key', key()).send(body())).status).toBe(409);
      expect((await request(fixture.app).get(path)
        .set('Cookie', fixture.actors.otherOwner.session.headers.Cookie)
        .query({ localStartDate: priorMonth() })).body.data.attestation).toBeNull();
      await expect(fixture.runtimePool.query(
        'SELECT * FROM canonical_forecast_profile_month_attestations'))
        .rejects.toMatchObject({ code: '42501' });
    }, 120000);
});
