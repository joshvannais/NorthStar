'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ROOT = '/api/v1/forecast/demand-to-schedule';
const key = prefix => `${prefix}-${crypto.randomUUID()}`;

realPostgres('Mission 26 Part 4C paid and private runtime boundary', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture({ operationalSchedule: true }); },
    120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  const body = () => ({ purpose: 'pipeline_first_booking', action: 'approve',
    expectedRevision: 0, expectedDigest: 'none',
    reason: 'Approve the exact deterministic Part 4C pipeline research method.',
    confirmed: true, confirmationVersion: 'm26-demand-schedule-method-review-v1' });

  test('enforces owner/admin, anti-forgery, paid access and exact bodies', async () => {
    expect((await request(fixture.app).post(`${ROOT}/method-reviews`)
      .set(fixture.actors.member.session.headers).set('Idempotency-Key', key('member'))
      .send(body())).status).toBe(403);
    expect((await request(fixture.app).post(`${ROOT}/method-reviews`)
      .set(fixture.actors.owner.session.headers).set('X-CSRF-Token', 'wrong')
      .set('Idempotency-Key', key('csrf')).send(body())).status).toBe(403);
    expect((await request(fixture.app).post(`${ROOT}/pipeline-origins`)
      .set(fixture.actors.owner.session.headers).set('Idempotency-Key', key('extra'))
      .send({ horizonDays: 30 })).status).toBe(400);
    await fixture.ownerPool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1",
      [fixture.org]);
    try {
      expect((await request(fixture.app).post(`${ROOT}/method-reviews`)
        .set(fixture.actors.owner.session.headers).set('Idempotency-Key', key('unpaid'))
        .send(body())).status).toBe(403);
    } finally {
      await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1",
        [fixture.org]);
    }
    const approved = await request(fixture.app).post(`${ROOT}/method-reviews`)
      .set(fixture.actors.admin.session.headers).set('Idempotency-Key', key('admin'))
      .send(body());
    expect(approved.status).toBe(201);
    expect(approved.body.data).toMatchObject({ purpose: 'pipeline_first_booking',
      action: 'approve', revision: 1, researchOnly: true, automaticActionTaken: false });
  }, 120000);

  test('keeps tables/helpers private and cross-tenant reads non-disclosing and side-effect free',
    async () => {
      await expect(fixture.runtimePool.query(
        'SELECT * FROM canonical_forecast_pipeline_origins_v1'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(fixture.runtimePool.query(
        `SELECT canonical_forecast_pipeline_risk_v1(
         $1,NOW()-INTERVAL '1 day',NOW())`, [fixture.org]))
        .rejects.toMatchObject({ code: '42501' });
      await expect(fixture.runtimePool.query(
        "SELECT canonical_forecast_demand_schedule_child_key_v1('a-valid-parent-key-0001','x')"))
        .rejects.toMatchObject({ code: '42501' });
      const before = Number((await fixture.ownerPool.query(`SELECT count(*) count FROM (
        SELECT id FROM canonical_forecast_seasonal_origins_v1
        UNION ALL SELECT id FROM canonical_forecast_pipeline_origins_v1
        UNION ALL SELECT id FROM canonical_forecast_seasonal_evaluations_v1
        UNION ALL SELECT id FROM canonical_forecast_pipeline_evaluations_v1) rows`))
        .rows[0].count);
      const hidden = await request(fixture.app)
        .get(`${ROOT}/pipeline-origins/${crypto.randomUUID()}`)
        .set(fixture.actors.otherOwner.session.headers);
      expect(hidden.status).toBe(200);
      expect(hidden.body.data).toEqual({ state: 'not_found' });
      expect(JSON.stringify(hidden.body)).not.toMatch(/count|digest|member|probability/i);
      const after = Number((await fixture.ownerPool.query(`SELECT count(*) count FROM (
        SELECT id FROM canonical_forecast_seasonal_origins_v1
        UNION ALL SELECT id FROM canonical_forecast_pipeline_origins_v1
        UNION ALL SELECT id FROM canonical_forecast_seasonal_evaluations_v1
        UNION ALL SELECT id FROM canonical_forecast_pipeline_evaluations_v1) rows`))
        .rows[0].count);
      expect(after).toBe(before);
    }, 120000);
});
