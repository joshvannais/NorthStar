'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const root = '/api/v1/forecast/reporting-windows/effective-anchors';
const months = { firstLocalStartDate: '2026-03-01',
  secondLocalStartDate: '2026-04-01' };

realPostgres('Mission 26 Part 2B area context for prospective profile months', () => {
  let fixture;
  beforeEach(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const row = (await fixture.ownerPool.query(
      'SELECT raw_profile FROM canonical_business_profiles WHERE organization_id=$1 AND is_active=TRUE',
      [fixture.org])).rows[0];
    const raw = { ...row.raw_profile,
      company: { ...row.raw_profile.company, timeZone: 'America/New_York' },
      serviceArea: { primaryTerritory: 'Fictional Connecticut service area' } };
    const adapted = adaptBusinessProfile(raw, 'org-profile-v1');
    await fixture.ownerPool.query(
      `UPDATE canonical_business_profiles SET raw_profile=$2,
       normalized_profile=$3, normalized_profile_hash=$4
       WHERE organization_id=$1 AND is_active=TRUE`,
      [fixture.org, raw, adapted, adapted.hash]);
  }, 120000);
  afterEach(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function prepare() {
    const owner = fixture.actors.owner;
    const recorded = await request(fixture.app).post(root)
      .set(owner.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Record fictional profile context.', confirmed: true });
    expect(recorded.status).toBe(201);
    const id = recorded.body.data.anchorId;
    const activated = await request(fixture.app).post(`${root}/${id}/activate`)
      .set(owner.session.headers).send({});
    expect(activated.status).toBe(200);
    // Test-only date shift. Neither month actually elapsed after activation.
    await fixture.ownerPool.query(
      'ALTER TABLE canonical_forecast_profile_effective_activations DISABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
    await fixture.ownerPool.query(
      `UPDATE canonical_forecast_profile_effective_activations
       SET observed_at='2026-02-28T12:00:00Z'
       WHERE organization_id=$1 AND anchor_id=$2`, [fixture.org, id]);
    await fixture.ownerPool.query(
      'ALTER TABLE canonical_forecast_profile_effective_activations ENABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
    return id;
  }
  function compare(id, areaScope = 'profile_area', actor = fixture.actors.owner,
    period = months) {
    return request(fixture.app).get(`${root}/${id}/compare-months`)
      .set('Cookie', actor.session.headers.Cookie)
      .query({ ...period, areaScope });
  }

  test('guarded area and tenant-wide context retain distinct area meaning and DST',
    async () => {
      const id = await prepare();
      const area = await compare(id);
      expect(area.status).toBe(200);
      expect(area.body.data).toMatchObject({
        state: 'comparable_profile_context', areaScope: 'profile_area',
        historicalCalendarVerified: true, observationCoverageVerified: false,
        areaObservationCoverageVerified: false, forecastIssued: false,
        normalizationRequired: true,
        windows: [
          { localStartDate: '2026-03-01',
            startsAt: '2026-03-01T05:00:00.000Z',
            endsAt: '2026-04-01T04:00:00.000Z', areaScope: 'profile_area' },
          { localStartDate: '2026-04-01', areaScope: 'profile_area' },
        ],
      });
      expect(area.body.data.normalizationDimensions)
        .toEqual(expect.arrayContaining(['elapsed_minutes', 'open_minutes']));
      const digest = area.body.data.windows[0].areaDigest;
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(area.body.data.windows[1].areaDigest).toBe(digest);
      const tenant = await compare(id, 'tenant_all');
      expect(tenant.status).toBe(200);
      expect(tenant.body.data).toMatchObject({
        state: 'comparable_profile_context', areaScope: 'tenant_all',
        areaObservationCoverageVerified: false,
        windows: [{ areaDigest: null }, { areaDigest: null }],
      });
      const partial = await compare(id, 'profile_area', fixture.actors.owner,
        { ...months, firstLocalStartDate: '2026-02-01' });
      expect(partial.body.data).toMatchObject({ state: 'unavailable',
        historicalCalendarVerified: false, areaObservationCoverageVerified: false });
      expect((await compare(id, 'profile_area', fixture.actors.member)).status).toBe(403);
      const other = await compare(id, 'profile_area', fixture.actors.otherOwner);
      expect(other.body.data).toMatchObject({ state: 'unavailable',
        reason: 'anchor_not_found' });
    }, 120000);

  test('changed area invalidates both guarded profile scope and tenant scope',
    async () => {
      const id = await prepare();
      await fixture.ownerPool.query(
        `UPDATE canonical_business_profiles SET raw_profile=jsonb_set(
         raw_profile, '{serviceArea,primaryTerritory}',
         '"Different fictional territory"'::jsonb)
         WHERE organization_id=$1 AND is_active=TRUE`, [fixture.org]);
      const changedArea = await compare(id);
      expect(changedArea.body.data).toMatchObject({ state: 'unavailable',
        historicalCalendarVerified: false, areaObservationCoverageVerified: false });
      const changedTenant = await compare(id, 'tenant_all');
      expect(changedTenant.body.data).toMatchObject({ state: 'unavailable',
        historicalCalendarVerified: false });
    }, 120000);

  test('missing configured area is unavailable only for profile area scope',
    async () => {
      const row = (await fixture.ownerPool.query(
        'SELECT raw_profile FROM canonical_business_profiles WHERE organization_id=$1 AND is_active=TRUE',
        [fixture.org])).rows[0];
      const raw = { ...row.raw_profile, serviceArea: null };
      const adapted = adaptBusinessProfile(raw, 'org-profile-v1');
      await fixture.ownerPool.query(
        `UPDATE canonical_business_profiles SET raw_profile=$2,
         normalized_profile=$3, normalized_profile_hash=$4
         WHERE organization_id=$1 AND is_active=TRUE`,
        [fixture.org, raw, adapted, adapted.hash]);
      const id = await prepare();
      const missing = await compare(id);
      expect(missing.body.data).toMatchObject({ state: 'unavailable',
        reason: 'service_area_unknown', areaObservationCoverageVerified: false });
      const tenant = await compare(id, 'tenant_all');
      expect(tenant.body.data).toMatchObject({
        state: 'comparable_profile_context', areaScope: 'tenant_all',
        areaObservationCoverageVerified: false });
    }, 120000);
});
