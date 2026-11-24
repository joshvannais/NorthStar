'use strict';

const crypto = require('node:crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORIGIN = 'http://northstar.test';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const cookie = response => response.headers['set-cookie'][0].split(';')[0];
const tokenHash = savedCookie => digest(decodeURIComponent(savedCookie.slice(savedCookie.indexOf('=') + 1)));

function action(app, savedCookie, idempotencyKey, expectedRevision, automationAction) {
  return request(app).post('/api/demo/automation-center/actions')
    .set('Host', 'northstar.test').set('Origin', ORIGIN)
    .set('Sec-Fetch-Site', 'same-origin').set('Cookie', savedCookie)
    .set('Idempotency-Key', idempotencyKey)
    .set('X-NorthStar-Demo-Intent', 'automation-center-action')
    .send({ action: automationAction, expectedRevision });
}

realPostgres('Mission 28 Part 14C isolated Automation Center PostgreSQL persistence', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('persists one exact action with CAS and idempotency while unknown operations remain denied', async () => {
    const initial = await request(fixture.app).get('/api/demo/automation-center')
      .set('Host', 'northstar.test');
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ success: true,
      demo: { workspaceRevision: 1, zeroEffects: {
        recipients: 0, providerCalls: 0, external: 0, financial: 0, money: 0,
      } } });
    const savedCookie = cookie(initial);
    const idempotencyKey = crypto.randomUUID();

    const accepted = await action(fixture.app, savedCookie, idempotencyKey, 1, 'advance_time');
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({ success: true, replayed: false,
      demo: { workspaceRevision: 2, zeroEffects: {
        recipients: 0, providerCalls: 0, external: 0, financial: 0, money: 0,
      } } });

    const replayed = await action(fixture.app, savedCookie, idempotencyKey, 1, 'advance_time');
    expect(replayed.status).toBe(200);
    expect(replayed.body).toMatchObject({ success: true, replayed: true,
      demo: { workspaceRevision: 2 } });

    const session = (await fixture.ownerPool.query(
      'SELECT id,revision,state FROM demo_command_center_sessions WHERE token_hash=$1',
      [tokenHash(savedCookie)])).rows[0];
    expect(Number(session.revision)).toBe(2);
    expect((await fixture.ownerPool.query(
      `SELECT operation,response_revision FROM demo_command_center_mutations
       WHERE session_id=$1 AND operation='automation_action'`, [session.id])).rows)
      .toEqual([{ operation: 'automation_action', response_revision: '2' }]);

    const stale = await action(fixture.app, savedCookie, crypto.randomUUID(), 1, 'advance_time');
    expect(stale.status).toBe(409);
    const afterStale = (await fixture.ownerPool.query(
      'SELECT revision,state FROM demo_command_center_sessions WHERE id=$1', [session.id])).rows[0];
    expect(Number(afterStale.revision)).toBe(2);
    expect(afterStale.state).toEqual(session.state);
    expect(Number((await fixture.ownerPool.query(
      `SELECT count(*) count FROM demo_command_center_mutations
       WHERE session_id=$1 AND operation='automation_action'`, [session.id])).rows[0].count)).toBe(1);

    await expect(fixture.ownerPool.query(
      `INSERT INTO demo_command_center_mutations
        (session_id,idempotency_hash,operation,request_digest,response_revision,response_digest)
       VALUES($1,$2,'unknown_automation_action',$3,3,$4)`,
      [session.id, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]))
      .rejects.toMatchObject({ code: '23514',
        constraint: 'demo_command_center_mutations_operation_check' });
  }, 120000);
});
