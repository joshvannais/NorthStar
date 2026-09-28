'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const base = '/api/v1/forecast/reporting-windows';
const priorMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString().slice(0, 10);
};

realPostgres('Mission 26 Part 2B reviewed historical month window', () => {
  let fixture;
  beforeEach(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterEach(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  function body(overrides = {}) {
    return { localStartDate: priorMonth(), action: 'confirm',
      businessProfileId: fixture.profiles[fixture.org].businessProfileId,
      businessProfileHash: fixture.profiles[fixture.org].hash,
      expectedRevision: 0, expectedDigest: null,
      reason: 'Synthetic owner confirms this profile described the month.',
      confirmed: true, confirmationVersion: 'forecast-calendar-review-v1',
      ...overrides };
  }
  async function confirm() {
    return request(fixture.app).post(`${base}/month-attestations`)
      .set(fixture.actors.owner.session.headers)
      .set('Idempotency-Key', crypto.randomUUID()).send(body());
  }
  async function read(actor = fixture.actors.owner) {
    return request(fixture.app).get(`${base}/reviewed-month-window`)
      .set('Cookie', actor.session.headers.Cookie)
      .query({ localStartDate: priorMonth() });
  }

  test('a confirmed profile yields a pinned local month but no verified history or forecast',
    async () => {
      const missing = await read();
      expect(missing.status).toBe(200);
      expect(missing.body.data).toMatchObject({ window: null,
        unavailableReason: 'no_reviewed_claim',
        ownerConfirmedHistoricalProfile: false, historicalCalendarVerified: false,
        observationCoverageVerified: false, forecastIssued: false });
      const claim = await confirm();
      expect(claim.status).toBe(201);
      const response = await read();
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        profileBasis: 'owner_reviewed_month_claim',
        attestation: { id: claim.body.data.id, revision: 1 },
        ownerConfirmedHistoricalProfile: true, profilePinVerified: true,
        historicalCalendarVerified: false, observationCoverageVerified: false,
        sourceEligibilityVerified: false, forecastIssued: false,
        window: { localStartDate: priorMonth(), grain: 'month',
          organizationId: fixture.org,
          businessProfileId: fixture.profiles[fixture.org].businessProfileId,
          businessProfileHash: fixture.profiles[fixture.org].hash } });
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(JSON.stringify(response.body)).not.toContain('rawProfile');
    }, 120000);

  test('a later raw calendar change withholds the window and revocation remains visible',
    async () => {
      const claim = await confirm();
      expect(claim.status).toBe(201);
      await fixture.ownerPool.query(
        `UPDATE canonical_business_profiles
            SET raw_profile=jsonb_set(raw_profile,'{company,timeZone}','"America/New_York"'::jsonb)
          WHERE organization_id=$1 AND is_active=TRUE`, [fixture.org]);
      const changed = await read();
      expect(changed.status).toBe(200);
      expect(changed.body.data).toMatchObject({ window: null,
        unavailableReason: 'profile_changed',
        ownerConfirmedHistoricalProfile: true, profilePinVerified: false,
        historicalCalendarVerified: false, forecastIssued: false });
      const revoked = await request(fixture.app).post(`${base}/month-attestations`)
        .set(fixture.actors.owner.session.headers)
        .set('Idempotency-Key', crypto.randomUUID())
        .send(body({ action: 'revoke', expectedRevision: 1,
          expectedDigest: claim.body.data.digest,
          reason: 'Synthetic owner withdraws the calendar claim.' }));
      expect(revoked.status).toBe(201);
      const after = await read();
      expect(after.body.data).toMatchObject({ window: null,
        unavailableReason: 'claim_revoked', forecastIssued: false });
    }, 120000);

  test('tenant, role and request shape are enforced on the reviewed window',
    async () => {
      expect((await request(fixture.app).get(`${base}/reviewed-month-window`)
        .query({ localStartDate: priorMonth() })).status).toBe(401);
      expect((await read(fixture.actors.member)).status).toBe(403);
      expect((await request(fixture.app).get(`${base}/reviewed-month-window`)
        .set('Cookie', fixture.actors.owner.session.headers.Cookie)
        .query({ localStartDate: priorMonth(), serviceKey: 'patio' })).status).toBe(400);
      expect((await confirm()).status).toBe(201);
      const other = await read(fixture.actors.otherOwner);
      expect(other.status).toBe(200);
      expect(other.body.data).toMatchObject({ window: null,
        unavailableReason: 'no_reviewed_claim', forecastIssued: false });
    }, 120000);
});
