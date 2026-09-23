'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { VERSION, normalizeForecastSettings } =
  require('../../src/forecasting/forecastSettingsContract');
const { sha256, stableStringify } = require('../../src/services/businessProfileAdapter');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const path = '/api/v1/forecast/settings';
const disabled = { enabled: false, targets: [], horizons: [],
  scenarioDisplay: 'withhold', comparisonDisplay: 'none',
  alertDelivery: 'off', actionPolicy: 'review_required' };
const key = () => crypto.randomUUID();

realPostgres('Mission 26 Part 11A disabled-default settings history', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('paid owner saves immutable disabled settings; replay and current read are exact',
    async () => {
      const owner = fixture.actors.owner;
      const before = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie);
      expect(before.status).toBe(200);
      expect(before.body.data.settings).toMatchObject({ revision: 0,
        settings: disabled, source: { kind: 'system_default' } });
      expect(before.body.data).toMatchObject({ forecastIssued: false,
        sourceEligibilityVerified: false });
      const requestKey = key();
      const body = { expectedRevision: 0, expectedDigest: null, settings: disabled };
      const saved = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', requestKey).send(body);
      expect(saved.status).toBe(201);
      expect(saved.body.data.settings).toMatchObject({ revision: 1,
        organizationId: fixture.org, settings: disabled,
        source: { kind: 'owner_reviewed', actorUserId: owner.actorUserId,
          supersedesDigest: null } });
      expect(saved.body.data).toMatchObject({ replayed: false,
        forecastIssued: false, sourceEligibilityVerified: false });
      const replay = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', requestKey).send(body);
      expect(replay.status).toBe(200);
      expect(replay.body.data).toEqual({ ...saved.body.data, replayed: true });
      expect(replay.headers['idempotency-replayed']).toBe('true');
      const current = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie);
      expect(current.body.data.settings).toEqual(saved.body.data.settings);
      expect(current.headers['cache-control']).toBe('private, no-store');
      await expect(fixture.runtimePool.query(
        'SELECT * FROM canonical_forecast_settings_revisions'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(fixture.ownerPool.query(
        'DELETE FROM canonical_forecast_settings_revisions WHERE organization_id=$1',
        [fixture.org])).rejects.toMatchObject({ code: '23514' });
    }, 120000);

  test('stale revision, changed replay, unsupported activation and cross-tenant writes fail closed',
    async () => {
      const owner = fixture.actors.owner;
      const body = { expectedRevision: 0, expectedDigest: null, settings: disabled };
      const stale = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key()).send(body);
      expect(stale.status).toBe(409);
      expect(stale.body.error.category).toBe('FORECAST_SETTINGS_CHANGED');
      const current = await request(fixture.app).get(path)
        .set('Cookie', owner.session.headers.Cookie);
      const secondBody = { expectedRevision: 1,
        expectedDigest: current.body.data.settings.digest, settings: disabled };
      const requestKey = key();
      const second = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', requestKey)
        .send(secondBody);
      expect(second.status).toBe(201);
      const conflict = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', requestKey)
        .send({ ...secondBody, expectedDigest: 'b'.repeat(64) });
      expect(conflict.status).toBe(409);
      const enabled = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ expectedRevision: 2, expectedDigest: second.body.data.settings.digest,
          settings: { ...disabled, enabled: true,
            targets: ['revenue.approved_price_flow.v1'],
            horizons: [{ grain: 'month', periods: 1 }] } });
      expect(enabled.status).toBe(409);
      expect(enabled.body.error.category).toBe('FORECAST_TARGET_NOT_READY');
      const active = normalizeForecastSettings({ version: VERSION,
        organizationId: fixture.org, revision: 3,
        effectiveAt: new Date().toISOString(),
        source: { kind: 'owner_reviewed', actorUserId: owner.actorUserId,
          supersedesDigest: second.body.data.settings.digest },
        settings: { ...disabled, enabled: true,
          targets: ['revenue.approved_price_flow.v1'],
          horizons: [{ grain: 'month', periods: 1 }] } });
      const { digest: _digest, ...activeBody } = active;
      await expect(fixture.runtimePool.query(
        'SELECT public.canonical_forecast_settings_capture($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [fixture.org, owner.actorUserId, owner.actorAccessRole,
          owner.authSessionId, owner.csrfToken, key(), sha256(activeBody),
          2, second.body.data.settings.digest, stableStringify(activeBody), active]))
        .rejects.toMatchObject({ code: '22023' });
      const missingCsrf = await request(fixture.app).post(path)
        .set('Cookie', owner.session.headers.Cookie)
        .set('Idempotency-Key', key()).send(secondBody);
      expect(missingCsrf.status).toBe(403);
      const member = await request(fixture.app).post(path)
        .set(fixture.actors.member.session.headers)
        .set('Idempotency-Key', key()).send(secondBody);
      expect(member.status).toBe(403);
      const other = await request(fixture.app).get(path)
        .set('Cookie', fixture.actors.otherOwner.session.headers.Cookie);
      expect(other.body.data.settings).toMatchObject({ revision: 0,
        organizationId: fixture.otherOrg });
      const forged = await request(fixture.app).post(path)
        .set(owner.session.headers).set('Idempotency-Key', key())
        .send({ ...secondBody, organizationId: fixture.otherOrg });
      expect(forged.status).toBe(400);
    }, 120000);
});
