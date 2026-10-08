'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const route = '/api/v1/forecast/settings';
const off = { enabled: false, targets: [], horizons: [], scenarioDisplay: 'withhold',
  comparisonDisplay: 'none', alertDelivery: 'off', actionPolicy: 'review_required' };
const on = { enabled: true, targets: ['demand.inbound_leads'],
  horizons: [{ grain: 'month', periods: 3 }],
  scenarioDisplay: 'calibrated_when_eligible', comparisonDisplay: 'prior_and_actual',
  alertDelivery: 'in_app_review_only', actionPolicy: 'review_required' };
const key = () => crypto.randomUUID();

async function inTransaction(pool, work, isolation = 'SERIALIZABLE') {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function changeSourceConsent(fixture, action, expectedRevision, expectedDigest) {
  const owner = fixture.actors.owner;
  const result = await inTransaction(fixture.ownerPool, client => client.query(
    `SELECT public.canonical_forecast_retell_source_consent_mutate(
      $1,$2,$3,$4,$5,$6,$7::jsonb) value`,
    [fixture.org, owner.actorUserId, owner.actorAccessRole, owner.authSessionId,
      owner.csrfToken, key(), JSON.stringify({ action, expectedRevision, expectedDigest,
        reason: `Synthetic Part 11A source permission ${action}.`, confirmed: true,
        confirmationVersion: 'm26-retell-demand-source-consent-v1' })]));
  return result.rows[0].value;
}

realPostgres('Mission 26 Part 11A immutable forecast settings', () => {
  let fixture;
  beforeAll(async () => {
    fixture = await createDatabaseFixture();
    await changeSourceConsent(fixture, 'grant', 0, 'none');
  }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('default, enabled revision, idempotent replay, predecessor chain and audit are exact',
    async () => {
      const owner = fixture.actors.owner;
      const initial = await request(fixture.app).get(route)
        .set('Cookie', owner.session.headers.Cookie);
      expect(initial.status).toBe(200);
      expect(initial.headers['cache-control']).toBe('private, no-store');
      expect(initial.body.data).toMatchObject({ state: 'current',
        settings: { revision: 0, organizationId: fixture.org, settings: off,
          source: { kind: 'system_default', supersedesDigest: null } },
        forecastIssued: false, calibratedRangeIssued: false,
        sourceAuthorityProvenByPreference: false,
        issuanceEligibilityProvenByPreference: false,
        automaticActionAuthorized: false,
        authority: { limits: { targets: 24, horizons: 12, periodsPerHorizon: 100 } } });
      expect(initial.body.data.authority.targets).toHaveLength(1);

      const requestKey = key();
      const body = { expectedRevision: 0, expectedDigest: null, settings: on };
      const saved = await request(fixture.app).post(route)
        .set(owner.session.headers).set('Idempotency-Key', requestKey).send(body);
      expect(saved.status).toBe(201);
      expect(saved.body.data).toMatchObject({ state: 'current', replayed: false,
        settings: { revision: 1, settings: on,
          source: { kind: 'owner_reviewed', actorUserId: owner.actorUserId,
            supersedesDigest: null } }, intervalCalibrationProvenByPreference: false,
        actualFinalityProvenByPreference: false });
      const replay = await request(fixture.app).post(route)
        .set(owner.session.headers).set('Idempotency-Key', requestKey).send(body);
      expect(replay.status).toBe(200);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data.settings).toEqual(saved.body.data.settings);

      const second = await request(fixture.app).post(route)
        .set(owner.session.headers).set('Idempotency-Key', key()).send({
          expectedRevision: 1, expectedDigest: saved.body.data.settings.digest, settings: off,
        });
      expect(second.status).toBe(201);
      expect(second.body.data.settings).toMatchObject({ revision: 2, settings: off,
        source: { supersedesDigest: saved.body.data.settings.digest } });
      const rows = await fixture.ownerPool.query(
        `SELECT revision,actor_access_role,rtrim(canonical_digest) digest,
                rtrim(supersedes_digest) predecessor
           FROM canonical_forecast_settings_revisions_v1
          WHERE organization_id=$1 ORDER BY revision`, [fixture.org]);
      expect(rows.rows).toEqual([
        { revision: 1, actor_access_role: 'owner',
          digest: saved.body.data.settings.digest, predecessor: null },
        { revision: 2, actor_access_role: 'owner', digest: second.body.data.settings.digest,
          predecessor: saved.body.data.settings.digest },
      ]);
      const audit = await fixture.ownerPool.query(
        "SELECT count(*)::integer count FROM audit_logs WHERE organization_id=$1 AND action='forecast_settings_revision_accepted'",
        [fixture.org]);
      expect(audit.rows[0].count).toBe(2);
      await expect(fixture.runtimePool.query(
        'SELECT * FROM canonical_forecast_settings_revisions_v1'))
        .rejects.toMatchObject({ code: '42501' });
      await expect(fixture.ownerPool.query(
        'DELETE FROM canonical_forecast_settings_revisions_v1 WHERE organization_id=$1',
        [fixture.org])).rejects.toMatchObject({ code: '23514' });
    }, 120000);

  test('stale/concurrent revisions, request-key conflict, malformed settings and CSRF fail closed',
    async () => {
      const owner = fixture.actors.owner;
      const current = await request(fixture.app).get(route)
        .set('Cookie', owner.session.headers.Cookie);
      const revision = current.body.data.settings.revision;
      const digest = current.body.data.settings.digest;
      const common = { expectedRevision: revision, expectedDigest: digest, settings: on };
      const concurrent = await Promise.all([
        request(fixture.app).post(route).set(owner.session.headers)
          .set('Idempotency-Key', key()).send(common),
        request(fixture.app).post(route).set(owner.session.headers)
          .set('Idempotency-Key', key()).send(common),
      ]);
      expect(concurrent.map(item => item.status).sort()).toEqual([201, 409]);
      const winner = concurrent.find(item => item.status === 201);

      const stale = await request(fixture.app).post(route).set(owner.session.headers)
        .set('Idempotency-Key', key()).send(common);
      expect(stale.status).toBe(409);
      expect(stale.body.error.category).toBe('FORECAST_SETTINGS_CHANGED');
      const conflictKey = key();
      const next = { expectedRevision: winner.body.data.settings.revision,
        expectedDigest: winner.body.data.settings.digest, settings: off };
      const accepted = await request(fixture.app).post(route).set(owner.session.headers)
        .set('Idempotency-Key', conflictKey).send(next);
      expect(accepted.status).toBe(201);
      const conflict = await request(fixture.app).post(route).set(owner.session.headers)
        .set('Idempotency-Key', conflictKey).send({ ...next, settings: on });
      expect(conflict.status).toBe(409);

      for (const settings of [
        { ...on, horizons: [{ grain: 'week', periods: 1 }] },
        { ...on, targets: ['revenue.earned_value'] },
        { ...on, horizons: [{ grain: 'month', periods: 1 },
          { grain: 'month', periods: 2 }] },
        { ...off, targets: ['demand.inbound_leads'] },
        { ...off, automaticAction: true },
      ]) {
        const currentValue = (await request(fixture.app).get(route)
          .set('Cookie', owner.session.headers.Cookie)).body.data.settings;
        const response = await request(fixture.app).post(route).set(owner.session.headers)
          .set('Idempotency-Key', key()).send({ expectedRevision: currentValue.revision,
            expectedDigest: currentValue.digest, settings });
        expect(response.status).toBe(400);
      }
      const currentValue = (await request(fixture.app).get(route)
        .set('Cookie', owner.session.headers.Cookie)).body.data.settings;
      const noCsrf = await request(fixture.app).post(route)
        .set('Cookie', owner.session.headers.Cookie).set('Idempotency-Key', key())
        .send({ expectedRevision: currentValue.revision,
          expectedDigest: currentValue.digest, settings: off });
      expect(noCsrf.status).toBe(403);
    }, 120000);

  test('role and tenant boundaries preserve an independent disabled default', async () => {
    const member = await request(fixture.app).get(route)
      .set('Cookie', fixture.actors.member.session.headers.Cookie);
    expect(member.status).toBe(403);
    const other = await request(fixture.app).get(route)
      .set('Cookie', fixture.actors.otherOwner.session.headers.Cookie);
    expect(other.status).toBe(200);
    expect(other.body.data.settings).toMatchObject({ revision: 0,
      organizationId: fixture.otherOrg, settings: off });
    expect(other.body.data.settings.organizationId).not.toBe(fixture.org);
    const unsupported = await request(fixture.app).post(route)
      .set(fixture.actors.otherOwner.session.headers).set('Idempotency-Key', key())
      .send({ expectedRevision: 0, expectedDigest: null, settings: on });
    expect(unsupported.status).toBe(400);
    const admin = fixture.actors.admin;
    const current = (await request(fixture.app).get(route)
      .set('Cookie', admin.session.headers.Cookie)).body.data.settings;
    const adminSaved = await request(fixture.app).post(route).set(admin.session.headers)
      .set('Idempotency-Key', key()).send({ expectedRevision: current.revision,
        expectedDigest: current.digest, settings: off });
    expect(adminSaved.status).toBe(201);
    const actor = await fixture.ownerPool.query(
      `SELECT actor_user_id,actor_access_role FROM canonical_forecast_settings_revisions_v1
        WHERE organization_id=$1 ORDER BY revision DESC LIMIT 1`, [fixture.org]);
    expect(actor.rows[0]).toEqual({ actor_user_id: admin.actorUserId,
      actor_access_role: 'admin' });
  });

  test('source revocation stales an enabled preference without rewriting its receipt', async () => {
    const owner = fixture.actors.owner;
    const current = (await request(fixture.app).get(route)
      .set('Cookie', owner.session.headers.Cookie)).body.data.settings;
    const enableKey = key();
    const enableBody = { expectedRevision: current.revision,
      expectedDigest: current.digest, settings: on };
    const enabled = await request(fixture.app).post(route).set(owner.session.headers)
      .set('Idempotency-Key', enableKey).send(enableBody);
    expect(enabled.status).toBe(201);
    const consent = await fixture.ownerPool.query(
      `SELECT revision,rtrim(canonical_digest) digest
         FROM canonical_forecast_retell_source_consents
        WHERE organization_id=$1 ORDER BY revision DESC LIMIT 1`, [fixture.org]);
    await changeSourceConsent(fixture, 'revoke', Number(consent.rows[0].revision),
      consent.rows[0].digest);
    const unavailable = await request(fixture.app).get(route)
      .set('Cookie', owner.session.headers.Cookie);
    expect(unavailable.status).toBe(200);
    expect(unavailable.body.data).toMatchObject({ state: 'unavailable',
      reason: 'selected_target_algorithm_or_source_authority_changed', settings: null });
    const staleReplay = await request(fixture.app).post(route).set(owner.session.headers)
      .set('Idempotency-Key', enableKey).send(enableBody);
    expect(staleReplay.status).toBe(200);
    expect(staleReplay.body.data).toMatchObject({ state: 'unavailable', replayed: true,
      reason: 'selected_target_algorithm_or_source_authority_changed', settings: null });
    const immutable = await fixture.ownerPool.query(
      `SELECT rtrim(canonical_digest) digest FROM canonical_forecast_settings_revisions_v1
        WHERE organization_id=$1 ORDER BY revision DESC LIMIT 1`, [fixture.org]);
    expect(immutable.rows[0].digest).toBe(enabled.body.data.settings.digest);
  });
});
