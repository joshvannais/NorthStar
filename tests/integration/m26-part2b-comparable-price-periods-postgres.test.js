'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { adaptBusinessProfile } = require('../../src/services/businessProfileAdapter');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const priceRoot = '/api/v1/forecast/price-history';
const profileRoot = '/api/v1/forecast/reporting-windows/effective-anchors';
const months = { firstLocalStartDate: '2026-03-01',
  secondLocalStartDate: '2026-04-01', currency: 'USD' };

realPostgres('Mission 26 Part 2B supported-source period comparison', () => {
  let fixture;
  beforeEach(async () => {
    fixture = await createDatabaseFixture({ operationalSchedule: true });
    const before = (await fixture.ownerPool.query(
      'SELECT raw_profile FROM canonical_business_profiles WHERE organization_id=$1 AND is_active=TRUE',
      [fixture.org])).rows[0].raw_profile;
    const raw = { ...before, company: { ...before.company,
      timeZone: 'America/New_York' } };
    const adapted = adaptBusinessProfile(raw, 'org-profile-v1');
    await fixture.ownerPool.query(
      `UPDATE canonical_business_profiles SET raw_profile=$2,
       normalized_profile=$3, normalized_profile_hash=$4
       WHERE organization_id=$1 AND is_active=TRUE`,
      [fixture.org, raw, adapted, adapted.hash]);
    fixture.profiles[fixture.org].hash = adapted.hash;
  }, 120000);
  afterEach(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function prepare() {
    const owner = fixture.actors.owner;
    const price = await request(fixture.app).post(`${priceRoot}/ordered-snapshots`)
      .set(owner.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({});
    expect(price.status).toBe(201);
    const priceActivation = await request(fixture.app)
      .post(`${priceRoot}/ordered-anchor/activate`)
      .set(owner.session.headers).send({});
    expect(priceActivation.status).toBe(200);
    expect(priceActivation.body.data.state).toBe('price_anchor_activation_recorded');
    const profile = await request(fixture.app).post(profileRoot)
      .set(owner.session.headers).set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Prospective synthetic profile evidence.', confirmed: true });
    expect(profile.status).toBe(201);
    const profileActivation = await request(fixture.app)
      .post(`${profileRoot}/${profile.body.data.anchorId}/activate`)
      .set(owner.session.headers).send({});
    expect(profileActivation.status).toBe(200);
    return { snapshotId: price.body.data.snapshotId,
      profileAnchorId: profile.body.data.anchorId };
  }
  function compare(ids, actor = fixture.actors.owner, query = months) {
    return request(fixture.app).get(
      `${priceRoot}/ordered-snapshots/${ids.snapshotId}/comparable-profile-months`)
      .set('Cookie', actor.session.headers.Cookie)
      .query({ profileAnchorId: ids.profileAnchorId, ...query });
  }

  test('prospective activation fails closed for past months and tenant/role',
    async () => {
      const ids = await prepare();
      const past = await compare(ids);
      expect(past.status).toBe(200);
      expect(past.body.data).toMatchObject({ state: 'unavailable',
        historicalCalendarVerified: false,
        observationCoverageVerified: false, forecastIssued: false });
      const wrongCurrency = await compare(ids, fixture.actors.owner,
        { ...months, currency: 'CAD' });
      expect(wrongCurrency.body.data).toMatchObject({ state: 'unavailable',
        reason: 'profile_currency_mismatch' });
      expect((await compare(ids, fixture.actors.member)).status).toBe(403);
      const other = await compare(ids, fixture.actors.otherOwner);
      expect(other.status).toBe(200);
      expect(other.body.data).toMatchObject({ state: 'unavailable',
        reason: 'profile_anchor_not_found' });
      await fixture.ownerPool.query(
        `UPDATE canonical_business_profiles SET raw_profile=jsonb_set(
          raw_profile,'{company,timeZone}','"America/Chicago"'::jsonb)
         WHERE organization_id=$1 AND is_active=TRUE`, [fixture.org]);
      const changed = await compare(ids);
      expect(changed.status).toBe(200);
      expect(changed.body.data).toMatchObject({ state: 'unavailable',
        reason: 'profile_period_unverified', observationCoverageVerified: false });
    }, 120000);

  test('test-only shifted activation yields two DST-aware zero-at-capture cohorts',
    async () => {
      const ids = await prepare();
      // This alters only the disposable fictional fixture. No real elapsed
      // month or historical source coverage is inferred from this test.
      await fixture.ownerPool.query(
        'ALTER TABLE canonical_forecast_profile_effective_activations DISABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
      await fixture.ownerPool.query(
        `UPDATE canonical_forecast_profile_effective_activations
         SET observed_at='2026-02-28T12:00:00Z'
         WHERE organization_id=$1 AND anchor_id=$2`,
        [fixture.org, ids.profileAnchorId]);
      await fixture.ownerPool.query(
        'ALTER TABLE canonical_forecast_profile_effective_activations ENABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
      await fixture.ownerPool.query(
        'ALTER TABLE canonical_forecast_price_anchor_activations DISABLE TRIGGER canonical_forecast_price_anchor_activations_immutable');
      await fixture.ownerPool.query(
        `UPDATE canonical_forecast_price_anchor_activations
         SET observed_at='2026-02-28T12:00:00Z'
         WHERE organization_id=$1`, [fixture.org]);
      await fixture.ownerPool.query(
        'ALTER TABLE canonical_forecast_price_anchor_activations ENABLE TRIGGER canonical_forecast_price_anchor_activations_immutable');
      await fixture.ownerPool.query(
        'ALTER TABLE canonical_forecast_price_ordered_anchors DISABLE TRIGGER canonical_forecast_price_ordered_anchors_immutable');
      await fixture.ownerPool.query(
        `UPDATE canonical_forecast_price_ordered_anchors
         SET coverage_starts_at='2026-02-28T11:00:00Z'
         WHERE organization_id=$1`, [fixture.org]);
      await fixture.ownerPool.query(
        'ALTER TABLE canonical_forecast_price_ordered_anchors ENABLE TRIGGER canonical_forecast_price_ordered_anchors_immutable');
      const result = await compare(ids);
      expect(result.status).toBe(200);
      expect(result.body.data).toMatchObject({
        state: 'comparable_supported_source_cohorts_at_capture',
        historicalCalendarVerified: true,
        sourceCohortAsOfCaptureVerified: true,
        observationCoverageVerified: false,
        wholeBusinessCoverageVerified: false, forecastIssued: false,
        periods: [
          { sourceInsertTimeDecisionCountKnownAtCapture: 0,
            zeroDecisionsKnownAtCapture: true,
            window: { localStartDate: '2026-03-01',
              startsAt: '2026-03-01T05:00:00.000Z',
              endsAt: '2026-04-01T04:00:00.000Z' } },
          { sourceInsertTimeDecisionCountKnownAtCapture: 0,
            zeroDecisionsKnownAtCapture: true,
            window: { localStartDate: '2026-04-01' } },
        ],
      });
      const partial = await compare(ids, fixture.actors.owner,
        { ...months, firstLocalStartDate: '2026-02-01' });
      expect(partial.body.data).toMatchObject({ state: 'unavailable',
        observationCoverageVerified: false });
    }, 120000);
});
