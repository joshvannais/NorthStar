'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const base = '/api/v1/forecast/reporting-windows/effective-anchors';
const lastMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString().slice(0, 10);
};

realPostgres('Mission 26 Part 2B prospective profile source', () => {
  let fixture;
  beforeEach(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterEach(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  async function capture(actor = fixture.actors.owner, key = crypto.randomUUID()) {
    return request(fixture.app).post(base).set(actor.session.headers)
      .set('Idempotency-Key', key)
      .send({ reason: 'Record the synthetic future profile source.', confirmed: true });
  }
  async function activate(id, actor = fixture.actors.owner) {
    return request(fixture.app).post(`${base}/${id}/activate`)
      .set(actor.session.headers).send({});
  }
  async function read(id, date = lastMonth(), actor = fixture.actors.owner) {
    return request(fixture.app).get(`${base}/${id}/month`)
      .set('Cookie', actor.session.headers.Cookie)
      .query({ localStartDate: date });
  }

  test('capture is replay-safe and a past month remains unavailable', async () => {
    const key = crypto.randomUUID();
    const first = await capture(fixture.actors.owner, key);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      state: 'profile_effective_anchor_recorded',
      historicalCalendarVerified: false, forecastIssued: false,
    });
    const replay = await capture(fixture.actors.owner, key);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ anchorId: first.body.data.anchorId,
      replayed: true });
    const activation = await activate(first.body.data.anchorId);
    expect(activation.status).toBe(200);
    expect(activation.body.data.state).toBe('profile_effective_activation_recorded');
    const past = await read(first.body.data.anchorId);
    expect(past.status).toBe(200);
    expect(past.body.data).toMatchObject({ window: null,
      historicalCalendarVerified: false, observationCoverageVerified: false,
      forecastIssued: false,
      unavailableReason: 'prospective_elapsed_period_unverified' });
  }, 120000);

  test('bounded synthetic elapsed source window pins timezone and fails on change',
    async () => {
      const recorded = await capture();
      expect(recorded.status).toBe(201);
      const anchorId = recorded.body.data.anchorId;
      expect((await activate(anchorId)).status).toBe(200);
      // Test-only date shift: the source transaction did not really run last
      // month. Production tables remain immutable to the runtime role.
      await fixture.ownerPool.query(
        'ALTER TABLE canonical_forecast_profile_effective_activations DISABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
      await fixture.ownerPool.query(
        `UPDATE canonical_forecast_profile_effective_activations
            SET observed_at=($3::date - INTERVAL '1 day')
          WHERE organization_id=$1 AND anchor_id=$2`,
        [fixture.org, anchorId, lastMonth()]);
      await fixture.ownerPool.query(
        'ALTER TABLE canonical_forecast_profile_effective_activations ENABLE TRIGGER canonical_forecast_profile_effective_activations_immutable');
      const current = await read(anchorId);
      expect(current.status).toBe(200);
      expect(current.body.data).toMatchObject({
        profileBasis: 'prospective_source_observed_profile',
        historicalCalendarVerified: true, observationCoverageVerified: false,
        forecastIssued: false,
        window: { grain: 'month', localStartDate: lastMonth(),
          businessProfileHash: fixture.profiles[fixture.org].hash },
      });
      await fixture.ownerPool.query(
        `UPDATE canonical_business_profiles
            SET raw_profile=jsonb_set(raw_profile,'{company,timeZone}',
             '"Pacific/Honolulu"'::jsonb)
          WHERE organization_id=$1 AND is_active=TRUE`, [fixture.org]);
      const changed = await read(anchorId);
      expect(changed.status).toBe(200);
      expect(changed.body.data).toMatchObject({ window: null,
        historicalCalendarVerified: false,
        unavailableReason: 'profile_changed_during_period' });
    }, 120000);

  test('tenant and role boundaries deny another actor', async () => {
    const recorded = await capture();
    expect(recorded.status).toBe(201);
    const id = recorded.body.data.anchorId;
    expect((await read(id, lastMonth(), fixture.actors.otherOwner)).body.data)
      .toMatchObject({ window: null, historicalCalendarVerified: false });
    expect((await capture(fixture.actors.member)).status).toBe(403);
    expect((await read(id, lastMonth(), fixture.actors.member)).status).toBe(403);
  }, 120000);

  test('missing active profile does not report a created anchor', async () => {
    await fixture.ownerPool.query(
      'UPDATE canonical_business_profiles SET is_active=FALSE, retired_at=clock_timestamp() WHERE organization_id=$1',
      [fixture.org]);
    const response = await capture();
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      state: 'profile_effective_anchor_unavailable',
      reason: 'active_profile_missing',
      historicalCalendarVerified: false, forecastIssued: false,
    });
    expect(response.body.data.anchorId).toBeUndefined();
  }, 120000);
});
