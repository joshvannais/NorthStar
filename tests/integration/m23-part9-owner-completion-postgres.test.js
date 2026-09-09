'use strict';
const crypto = require('crypto');
const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9-owner-completion-fixture');
const real = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

real('Part 9 owner workflow over mounted PostgreSQL authority', () => {
  let fixture, httpsRequest, httpsGet, externalFetch;
  beforeAll(async () => {
    httpsRequest = jest.spyOn(require('https'), 'request').mockImplementation(() => { throw new Error('External transport forbidden'); });
    httpsGet = jest.spyOn(require('https'), 'get').mockImplementation(() => { throw new Error('External transport forbidden'); });
    externalFetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('External fetch forbidden'); });
    fixture = await createDatabaseFixture();
  }, 180000);
  afterAll(async () => {
    try {
      if (fixture) await fixture.cleanup();
      expect(httpsRequest).not.toHaveBeenCalled(); expect(httpsGet).not.toHaveBeenCalled();
      expect(externalFetch).not.toHaveBeenCalled();
    } finally { jest.restoreAllMocks(); }
  }, 180000);
  const get = (executionId, actor = 'owner') => request(fixture.app)
    .get(`/api/v1/field-executions/${executionId}/completion-review`).set(fixture.actors[actor].session.headers);
  const send = (executionId, body, key = crypto.randomUUID(), actor = 'owner') => request(fixture.app)
    .post(`/api/v1/field-executions/${executionId}/completion-actions`).set(fixture.actors[actor].session.headers)
    .set('Idempotency-Key', key).send(body);
  const prepare = (data, action, target = null) => require('../../public/js/completion-review-contract').actionBody(data, action, target,
    { reason: 'Reviewed the explicit recorded work', nextAction: 'Recheck the completed seal', note: 'Clarified the recorded observation' });
  async function review(executionId, actor = 'owner') {
    const response = await get(executionId, actor); expect(response.status).toBe(200);
    return require('../../public/js/completion-review-contract').validate(response.body.data);
  }
  async function countRecords(executionId) {
    return Number((await fixture.ownerPool.query('SELECT count(*) FROM canonical_completion_records WHERE organization_id=$1 AND execution_id=$2',
      [fixture.org, executionId])).rows[0].count);
  }

  test('owner/admin can review work outside personal Today; dispatcher/member/viewer/other tenant cannot', async () => {
    const work = await fixture.createExecution();
    for (const actor of ['owner', 'admin']) {
      const value = await review(work.execution.id, actor);
      expect(value.execution.id).toBe(work.execution.id);
      expect(value.commands.some(command => command.action === 'cancel_execution')).toBe(true);
    }
    for (const actor of ['dispatcher', 'member', 'viewer']) {
      const response = await get(work.execution.id, actor); expect(response.status).toBe(403);
      expect(response.body).not.toHaveProperty('data');
    }
    expect((await get(work.execution.id, 'otherOwner')).status).toBe(404);
    const today = await request(fixture.app).get('/api/v1/today').set(fixture.actors.owner.session.headers);
    expect(today.status).toBe(200);
    expect(today.body.data.records.some(record => record.appointmentId === work.appointment)).toBe(false);
  });

  test('all five commands append durable authority; same-key concurrency cannot duplicate a decision', async () => {
    const work = await fixture.createExecution();
    await fixture.completion(work);
    let data = await review(work.execution.id);
    const approval = prepare(data, 'approve_completion'); const key = crypto.randomUUID();
    const responses = await Promise.all([send(work.execution.id, approval, key), send(work.execution.id, approval, key)]);
    expect(responses.map(value => value.status)).toEqual([200, 200]);
    expect(await countRecords(work.execution.id)).toBe(2);
    data = await review(work.execution.id); expect(data.execution.lifecycleState).toBe('completed');
    expect((await send(work.execution.id, prepare(data, 'reopen_execution'))).status).toBe(200);
    data = await review(work.execution.id); expect(data.execution.lifecycleState).toBe('reopened');
    expect((await send(work.execution.id, prepare(data, 'resume_reopened'))).status).toBe(200);
    data = await review(work.execution.id); expect(data.execution.lifecycleState).toBe('in_progress');
    const target = data.commands.find(command => command.action === 'correct_completion').target.id;
    const beforeRevision = data.execution.revision;
    expect((await send(work.execution.id, prepare(data, 'correct_completion', target))).status).toBe(200);
    data = await review(work.execution.id); expect(data.execution.revision).toBe(beforeRevision);
    expect((await send(work.execution.id, prepare(data, 'cancel_execution'))).status).toBe(200);
    data = await review(work.execution.id); expect(data.execution.lifecycleState).toBe('cancelled');
    expect(await countRecords(work.execution.id)).toBe(6);
    const raw = (await fixture.ownerPool.query('SELECT lifecycle_state,revision FROM canonical_field_executions WHERE organization_id=$1 AND id=$2',
      [fixture.org, work.execution.id])).rows[0];
    expect(raw.lifecycle_state).toBe('cancelled'); expect(Number(raw.revision)).toBe(data.execution.revision);
    const schedule = (await fixture.ownerPool.query('SELECT status FROM canonical_appointments WHERE organization_id=$1 AND id=$2',
      [fixture.org, work.appointment])).rows[0]; expect(schedule.status).toBe('scheduled');
  });

  test('stale pins and proposal evidence changes reject without optimistic completion', async () => {
    const work = await fixture.createExecution(); await fixture.completion(work);
    const data = await review(work.execution.id); const body = prepare(data, 'approve_completion');
    expect((await send(work.execution.id, { ...body, expectedExecutionRevision: body.expectedExecutionRevision + 1 })).status).toBe(409);
    await fixture.fieldEvidence(work, 'record_note', { note: 'New evidence after proposal', caption: null });
    const response = await send(work.execution.id, body); expect(response.status).toBe(409);
    expect((await review(work.execution.id)).execution.lifecycleState).toBe('completion_pending');
    expect(await countRecords(work.execution.id)).toBe(1);
  });

  test('durable subscription read-only and session revocation remove mutation visibility without widening roles', async () => {
    const work = await fixture.createExecution();
    const before = await review(work.execution.id); const body = prepare(before, 'cancel_execution');
    await fixture.ownerPool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1", [fixture.org]);
    try {
      const readOnly = await review(work.execution.id); expect(readOnly.commands).toEqual([]);
      expect(readOnly.readOnlyReason).toBe('subscription_read_only');
      expect((await send(work.execution.id, body)).status).toBe(403);
    } finally { await fixture.ownerPool.query("UPDATE subscriptions SET status='active' WHERE organization_id=$1", [fixture.org]); }
    await fixture.ownerPool.query("UPDATE auth_sessions SET status='revoked',revoked_at=NOW(),revoke_reason='local-test' WHERE id=$1", [fixture.actors.admin.authSessionId]);
    try { expect((await get(work.execution.id, 'admin')).status).toBe(401); }
    finally { await fixture.ownerPool.query("UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1", [fixture.actors.admin.authSessionId]); }
  });

  test('runtime private completion tables/helpers stay denied and review GET creates no completion records', async () => {
    const work = await fixture.createExecution(); const before = await countRecords(work.execution.id);
    await Promise.all([review(work.execution.id), review(work.execution.id, 'admin')]);
    expect(await countRecords(work.execution.id)).toBe(before);
    await expect(fixture.runtimePool.query('SELECT id FROM canonical_completion_records LIMIT 1')).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query('SELECT canonical_completion_gate_snapshot($1,$2,$3)',
      [fixture.org, work.execution.id, { checklists: [], inspections: [], files: [] }])).rejects.toMatchObject({ code: '42501' });
  });
});
