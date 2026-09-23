'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const root = '/api/v1/forecast/price-history/ordered-snapshots';
const key = () => crypto.randomUUID();
const priorMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString().slice(0, 10);
};

realPostgres('Mission 26 Parts 6A/2B reviewed local price-month candidate', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('guarded pre-anchor price receipt and reviewed profile claim remain unavailable',
    async () => {
      const owner = fixture.actors.owner;
      const captured = await request(fixture.app).post(root)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({});
      expect(captured.status).toBe(201);
      const path = `${root}/${captured.body.data.snapshotId}/reviewed-profile-month-candidate`;
      const query = { localStartDate: priorMonth(), currency: 'USD' };
      const missing = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie).query(query);
      expect(missing.status).toBe(200);
      expect(missing.body.data).toMatchObject({ state: 'unavailable',
        reason: 'no_reviewed_claim', window: null,
        sourceAuthenticated: false, historicalCalendarVerified: false,
        observationCoverageVerified: false, eligibleForForecast: false,
        forecastIssued: false });
      const body = { localStartDate: priorMonth(), action: 'confirm',
        businessProfileId: fixture.profiles[fixture.org].businessProfileId,
        businessProfileHash: fixture.profiles[fixture.org].hash,
        expectedRevision: 0, expectedDigest: null,
        reason: 'Synthetic owner confirms these were the applicable hours.',
        confirmed: true, confirmationVersion: 'forecast-calendar-review-v1' };
      const claim = await request(fixture.app).post(
        '/api/v1/forecast/reporting-windows/month-attestations')
        .set(owner.session.headers).set('Idempotency-Key', key()).send(body);
      expect(claim.status).toBe(201);
      const reviewed = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie).query(query);
      expect(reviewed.status).toBe(200);
      expect(reviewed.body.data).toMatchObject({ state: 'unavailable',
        reason: 'period_before_ordered_anchor',
        profileBasis: 'owner_reviewed_month_claim',
        attestation: { id: claim.body.data.id, revision: 1 },
        ownerConfirmedHistoricalProfile: true, profilePinVerified: true,
        historicalCalendarVerified: false, observationCoverageVerified: false,
        sourceMonthVerified: false, calendarPeriodVerified: false,
        eligibleForForecast: false, wholeBusinessCoverageVerified: false,
        forecastIssued: false,
        window: { organizationId: fixture.org, grain: 'month',
          localStartDate: priorMonth(),
          businessProfileId: fixture.profiles[fixture.org].businessProfileId } });
      expect(JSON.stringify(reviewed.body)).not.toContain('rawProfile');
      expect(JSON.stringify(reviewed.body)).not.toMatch(
        /"(?:sourceOrder|coverageStartOrder|highWaterOrder|currentHighWaterOrder|digestNonce)"/);
      expect(reviewed.headers['cache-control']).toBe('private, no-store');

      const locked = await fixture.runtimePool.connect();
      try {
        await locked.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const source = await locked.query(
          'SELECT public.canonical_forecast_profile_month_guarded_source($1,$2,$3,$4,$5) value',
          [fixture.org, owner.actorUserId, owner.actorAccessRole,
            owner.authSessionId, priorMonth()]);
        expect(source.rows[0].value.state).toBe('owner_claim_only');
        const busy = await request(fixture.app).post(
          '/api/v1/forecast/reporting-windows/month-attestations')
          .set(owner.session.headers).set('Idempotency-Key', key())
          .send({ ...body, action: 'revoke', expectedRevision: 1,
            expectedDigest: claim.body.data.digest,
            reason: 'Synthetic concurrent withdrawal.' });
        expect(busy.status).toBe(409);
        await locked.query('COMMIT');
      } finally {
        await locked.query('ROLLBACK').catch(() => {});
        locked.release();
      }

      await fixture.ownerPool.query(
        `UPDATE canonical_business_profiles
            SET raw_profile=jsonb_set(raw_profile,'{company,timeZone}','"America/New_York"'::jsonb)
          WHERE organization_id=$1 AND is_active=TRUE`, [fixture.org]);
      const changed = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie).query(query);
      expect(changed.status).toBe(200);
      expect(changed.body.data).toMatchObject({ state: 'unavailable',
        reason: 'profile_changed', window: null, forecastIssued: false });
      const revoked = await request(fixture.app).post(
        '/api/v1/forecast/reporting-windows/month-attestations')
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ ...body, action: 'revoke', expectedRevision: 1,
          expectedDigest: claim.body.data.digest,
          reason: 'Synthetic owner withdraws the historical claim.' });
      expect(revoked.status).toBe(201);
      const after = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie).query(query);
      expect(after.body.data).toMatchObject({ state: 'unavailable',
        reason: 'claim_revoked', window: null, forecastIssued: false });
      expect((await request(fixture.app).get(path)
        .set('Cookie', fixture.actors.member.session.headers.Cookie)
        .query(query)).status).toBe(403);
      expect((await request(fixture.app).get(path)
        .set('Cookie', fixture.actors.otherOwner.session.headers.Cookie)
        .query(query)).status).toBe(404);
      expect((await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie)
        .query({ ...query, serviceKey: 'patio' })).status).toBe(400);
    }, 120000);
});
