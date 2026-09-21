'use strict';

const crypto = require('node:crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const key = () => crypto.randomUUID();

realPostgres('Mission 26 Part 4A Retell forecast source permission', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  const input = (action, current = null) => ({ action,
    expectedRevision: current?.revision || 0, expectedDigest: current?.digest || 'none',
    reason: 'Explicit fictional company decision', confirmed: true,
    confirmationVersion: 'm26-retell-demand-source-consent-v1' });
  async function mutate(actor, body, requestKey = key()) {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await client.query(
        'SELECT public.canonical_forecast_retell_source_consent_mutate($1,$2,$3,$4,$5,$6,$7::jsonb) value',
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, actor.csrfToken, requestKey, JSON.stringify(body)]);
      await client.query('COMMIT');
      return result.rows[0].value;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async function read(actor) {
    const result = await fixture.runtimePool.query(
      'SELECT public.canonical_forecast_retell_source_consent_read($1,$2,$3,$4) value',
      [actor.organizationId, actor.actorUserId, actor.actorAccessRole, actor.authSessionId]);
    return result.rows[0].value;
  }
  async function capture(actor, requestKey = key()) {
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await client.query(
        'SELECT public.canonical_forecast_retell_call_snapshot_capture($1,$2,$3,$4,$5,$6) value',
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole,
          actor.authSessionId, actor.csrfToken, requestKey]);
      await client.query('COMMIT');
      return result.rows[0].value;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  const snapshotRead = (actor, snapshotId) => fixture.runtimePool.query(
    'SELECT public.canonical_forecast_retell_call_snapshot_read($1,$2,$3,$4,$5) value',
    [actor.organizationId, actor.actorUserId, actor.actorAccessRole, actor.authSessionId, snapshotId]);

  test('explicit company permission is tenant-private, revisioned and reversible', async () => {
    const owner = fixture.actors.owner;
    expect(await read(owner)).toMatchObject({ active: false, total: 0, current: null });
    await expect(capture(owner)).rejects.toMatchObject({ code: '42501' });
    const grant = await mutate(owner, input('grant'));
    expect(grant).toMatchObject({ replayed: false, consent: { revision: 1, action: 'grant',
      sourceScope: ['retell.inbound_calls'] } });
    expect(grant.consent.boundary).toMatch(/does not establish caller consent/);
    expect(await read(owner)).toMatchObject({ active: true, total: 1 });
    expect((await read(fixture.actors.admin)).active).toBe(true);
    expect(await read(fixture.actors.otherOwner)).toMatchObject({ active: false, total: 0 });
    const receiptKey = key();
    const receipt = (await capture(owner, receiptKey)).snapshot;
    expect(receipt).toMatchObject({ sourceConsentId: grant.consent.id,
      sourceConsentDigest: grant.consent.digest, sourceCount: 0 });
    expect((await snapshotRead(owner, receipt.id)).rows[0].value.stale).toBe(false);
    const revoke = await mutate(owner, input('revoke', grant.consent));
    expect(revoke.consent).toMatchObject({ revision: 2, previousId: grant.consent.id, action: 'revoke' });
    expect(await read(owner)).toMatchObject({ active: false, total: 2 });
    expect((await snapshotRead(owner, receipt.id)).rows[0].value)
      .toMatchObject({ stale: true, refreshRequired: true, sources: [] });
    expect((await capture(owner, receiptKey)).snapshot)
      .toMatchObject({ stale: true, refreshRequired: true, sources: [] });
    await expect(capture(owner)).rejects.toMatchObject({ code: '42501' });
    const newGrant = await mutate(owner, input('grant', revoke.consent));
    expect(newGrant.consent).toMatchObject({ revision: 3, previousId: revoke.consent.id, action: 'grant' });
    expect(await read(owner)).toMatchObject({ active: true, total: 3 });
    expect(newGrant.consent.id).not.toBe(grant.consent.id);
    expect((await snapshotRead(owner, receipt.id)).rows[0].value.stale).toBe(true);
  }, 120000);

  test('owner-only mutation, current session, CSRF, CAS, idempotency and direct access', async () => {
    const owner = fixture.actors.otherOwner;
    await expect(read(fixture.actors.member)).rejects.toMatchObject({ code: '42501' });
    await expect(read({ ...fixture.actors.member, actorAccessRole: null }))
      .rejects.toMatchObject({ code: '42501' });
    await expect(mutate(fixture.actors.admin, input('revoke'))).rejects.toMatchObject({ code: '42501' });
    await expect(mutate({ ...owner, csrfToken: 'wrong' }, input('revoke')))
      .rejects.toMatchObject({ code: '42501' });
    await expect(mutate({ ...owner, authSessionId: fixture.actors.owner.authSessionId },
      input('revoke'))).rejects.toMatchObject({ code: '42501' });
    await expect(mutate(owner, input('revoke'))).rejects.toMatchObject({ code: '22023' });
    await mutate(owner, input('grant'));
    await expect(mutate(owner, input('revoke'))).rejects.toMatchObject({ code: '40001' });
    const current = (await read(owner)).current;
    const request = input('revoke', current), requestKey = key();
    const saved = await mutate(owner, request, requestKey);
    expect((await mutate(owner, request, requestKey)).consent).toEqual(saved.consent);
    await expect(mutate(owner, { ...request, reason: 'Different reason' }, requestKey))
      .rejects.toMatchObject({ code: '23505' });
    await expect(fixture.runtimePool.query('SELECT * FROM canonical_forecast_retell_source_consents'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query(
      'SELECT public.canonical_forecast_retell_source_consent_projection(NULL::canonical_forecast_retell_source_consents)'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(fixture.ownerPool.query(
      'UPDATE canonical_forecast_retell_source_consents SET action=action WHERE id=$1',
      [saved.consent.id])).rejects.toMatchObject({ code: '23514' });
  }, 120000);
});
