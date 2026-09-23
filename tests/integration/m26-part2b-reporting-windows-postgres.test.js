'use strict';

const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const endpoint = '/api/v1/forecast/reporting-windows';

realPostgres('Mission 26 Part 2B guarded current Business Profile windows', () => {
  let fixture;
  beforeAll(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
  }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('paid owner receives a pinned local reporting window without historical or forecast claims',
    async () => {
      const owner = fixture.actors.owner;
      const response = await request(fixture.app).get(endpoint)
        .query({ localStartDate: '2026-11-01', grain: 'month' })
        .set('Cookie', owner.session.headers.Cookie);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.body.data).toMatchObject({
        profileBasis: 'current_active_profile_at_read',
        historicalCalendarVerified: false,
        observationCoverageVerified: false,
        sourceEligibilityVerified: false,
        forecastIssued: false,
        window: {
          organizationId: fixture.org,
          businessProfileId: fixture.profiles[fixture.org].businessProfileId,
          businessProfileVersion: 1,
          businessProfileHash: fixture.profiles[fixture.org].hash,
          timeZone: 'UTC', grain: 'month',
          serviceKey: null, areaScope: 'tenant_all',
          localStartDate: '2026-11-01', localEndDate: '2026-12-01',
          startsAt: '2026-11-01T00:00:00.000Z',
          endsAt: '2026-12-01T00:00:00.000Z',
          calendarState: 'known',
        },
      });
      expect(response.body.data.window.openMinutes).toBeGreaterThan(0);
      expect(JSON.stringify(response.body)).not.toContain('tenant@example.test');
    }, 120000);

  test('other tenant sees only its own profile, while member and unauthenticated reads are denied',
    async () => {
      const other = fixture.actors.otherOwner;
      const own = await request(fixture.app).get(endpoint)
        .query({ localStartDate: '2026-11-01', grain: 'month' })
        .set('Cookie', other.session.headers.Cookie);
      expect(own.status).toBe(200);
      expect(own.body.data.window.organizationId).toBe(fixture.otherOrg);
      expect(own.body.data.window.businessProfileId).toBe(
        fixture.profiles[fixture.otherOrg].businessProfileId);
      expect(own.body.data.window.businessProfileId).not.toBe(
        fixture.profiles[fixture.org].businessProfileId);
      const member = await request(fixture.app).get(endpoint)
        .query({ localStartDate: '2026-11-01', grain: 'month' })
        .set('Cookie', fixture.actors.member.session.headers.Cookie);
      expect(member.status).toBe(403);
      const anonymous = await request(fixture.app).get(endpoint)
        .query({ localStartDate: '2026-11-01', grain: 'month' });
      expect(anonymous.status).toBe(401);
    }, 120000);

  test('malformed or broadened query cannot select an unverified service or area',
    async () => {
      const cookie = fixture.actors.owner.session.headers.Cookie;
      for (const query of [
        { localStartDate: '2026-11-01', grain: 'month', serviceKey: 'plumbing' },
        { localStartDate: '2026-11-01', grain: 'month', areaScope: 'profile_area' },
        { localStartDate: '2026-11-01', grain: ['month', 'year'] },
        { localStartDate: '2026-11-02', grain: 'month' },
        { localStartDate: '2100-12-01', grain: 'month' },
      ]) {
        const result = await request(fixture.app).get(endpoint).query(query)
          .set('Cookie', cookie);
        expect(result.status).toBe(400);
        expect(result.body.error.category).toBe('FORECAST_REQUEST_INVALID');
      }
    }, 120000);

  test('corrupt current profile is unavailable source evidence, not a bad owner request',
    async () => {
      await fixture.ownerPool.query(
        'UPDATE canonical_business_profiles SET normalized_profile_hash=$2 WHERE organization_id=$1 AND is_active=TRUE',
        [fixture.org, 'c'.repeat(64)]);
      const mismatched = await request(fixture.app).get(endpoint)
        .query({ localStartDate: '2026-11-01', grain: 'month' })
        .set('Cookie', fixture.actors.owner.session.headers.Cookie);
      expect(mismatched.status).toBe(503);
      expect(mismatched.body.error.category).toBe('FORECAST_WINDOW_UNAVAILABLE');
      await fixture.ownerPool.query(
        'UPDATE canonical_business_profiles SET normalized_profile_hash=$2 WHERE organization_id=$1 AND is_active=TRUE',
        [fixture.org, fixture.profiles[fixture.org].hash]);
      await fixture.ownerPool.query(
        "UPDATE canonical_business_profiles SET raw_profile='[]'::jsonb WHERE organization_id=$1 AND is_active=TRUE",
        [fixture.org]);
      const result = await request(fixture.app).get(endpoint)
        .query({ localStartDate: '2026-11-01', grain: 'month' })
        .set('Cookie', fixture.actors.owner.session.headers.Cookie);
      expect(result.status).toBe(503);
      expect(result.body.error.category).toBe('FORECAST_WINDOW_UNAVAILABLE');
      expect(JSON.stringify(result.body)).not.toContain('[]');
    }, 120000);
});
