'use strict';

const request = require('supertest');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { readOperationalOverview } = require('../../src/operations/overviewRepository');
const { normalizeOverviewRead } = require('../../src/operations/overviewContract');
const real = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

real('Part 9B mounted operational overview on durable runtime authority', () => {
  let fixture, first, second, other, httpsRequest, httpsGet, providerFetch;
  beforeAll(async () => {
    httpsRequest = jest.spyOn(require('https'), 'request').mockImplementation(() => { throw new Error('External transport forbidden'); });
    httpsGet = jest.spyOn(require('https'), 'get').mockImplementation(() => { throw new Error('External transport forbidden'); });
    providerFetch = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Provider fetch forbidden'); });
    fixture = await createDatabaseFixture();
    first = await fixture.createExecution({ title: 'Owner <strong>sample</strong> work' });
    second = await fixture.createExecution();
    other = await fixture.createExecution({ actor: 'otherOwner', title: 'Other tenant work' });
  }, 180000);
  afterAll(async () => {
    try {
      if (fixture) await fixture.cleanup();
      expect(httpsRequest).not.toHaveBeenCalled(); expect(httpsGet).not.toHaveBeenCalled();
      expect(providerFetch).not.toHaveBeenCalled();
    } finally { jest.restoreAllMocks(); }
  }, 180000);
  const get = (actor = 'owner', query = {}) => request(fixture.app)
    .get('/api/v1/operational-overview').set(fixture.actors[actor].session.headers).query(query);
  const read = (actor = 'owner', query = {}) => readOperationalOverview(fixture.runtimePool,
    { ...fixture.actors[actor], ...normalizeOverviewRead(query) });
  async function rawState() {
    const tables = (await fixture.ownerPool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'
      AND tablename LIKE 'canonical_%' ORDER BY tablename`)).rows;
    const hashes = {};
    for (const { tablename } of tables) {
      if (!/^canonical_[a-z_]+$/.test(tablename)) throw new Error('Unexpected canonical test table');
      hashes[tablename] = (await fixture.ownerPool.query(`SELECT count(*)::int AS count,
        encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(row) ORDER BY to_jsonb(row)::text),'[]'::jsonb)::text,'UTF8')),'hex') AS digest
        FROM public."${tablename}" row`)).rows[0];
    }
    return hashes;
  }

  test('mounted owner/admin route discovers tenant work using real sessions, no personal-assignment requirement', async () => {
    for (const actor of ['owner', 'admin']) {
      const response = await get(actor);
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toContain('no-store');
      expect(response.body.data).toMatchObject({ authority: 'postgresql', readOnly: true, scope: 'owner_admin',
        capacity: { status: 'unknown' }, pagination: { total: 2, returned: 2 } });
      expect(response.body.data.records.map(row => row.executionId).sort()).toEqual([first.execution.id, second.execution.id].sort());
      const row = response.body.data.records.find(value => value.executionId === first.execution.id);
      expect(row.title).toBe('Owner <strong>sample</strong> work');
      expect(row).toMatchObject({ lifecycleState: 'in_progress', assignment: { current: true, kind: 'worker' },
        approval: { state: 'none' }, evidence: { state: 'not_evaluated' }, ownerDetails: { pendingProposal: null } });
    }
  });
  test('dispatcher coordination is masked and ordinary member/viewer have no overview authority', async () => {
    const response = await get('dispatcher'); expect(response.status).toBe(200);
    expect(response.body.data.scope).toBe('dispatcher_coordination');
    for (const row of response.body.data.records) {
      expect(Object.keys(row).sort()).toEqual(['executionId','appointmentId','title','serviceType','createdAt','updatedAt',
        'lifecycleState','schedule','assignment','progress','blockers','exceptions','approval','evidence','capacity'].sort());
      expect(row).not.toHaveProperty('ownerDetails');
    }
    for (const actor of ['member', 'viewer']) {
      expect((await get(actor)).status).toBe(403);
      await expect(read(actor)).rejects.toMatchObject({ status: 403 });
    }
  });
  test('other tenant has only its own work and anonymous requests have no canonical payload', async () => {
    const response = await get('otherOwner'); expect(response.status).toBe(200);
    expect(response.body.data.records.map(row => row.executionId)).toEqual([other.execution.id]);
    const anonymous = await request(fixture.app).get('/api/v1/operational-overview');
    expect(anonymous.status).toBe(401); expect(anonymous.body).not.toHaveProperty('data.records');
    expect((await get('owner', { organizationId: fixture.otherOrg })).status).toBe(400);
  });
  test('stable microsecond cursor pages once with consistent snapshot/filter and no duplicate work', async () => {
    const page1 = await read('owner', { limit: '1' });
    expect(page1.pagination).toMatchObject({ limit: 1, offset: 0, returned: 1, total: 2 });
    const cursor = normalizeOverviewRead({ limit: '1', cursor: page1.pagination.nextCursor }).cursor;
    expect(cursor.cutoff).toMatch(/\.\d{6}Z$/); expect(cursor.lastCreatedAt).toMatch(/\.\d{6}Z$/);
    const page2 = await read('owner', { limit: '1', cursor: page1.pagination.nextCursor });
    expect(page2.evaluatedAt).toBe(page1.evaluatedAt); expect(page2.dataDigest).toBe(page1.dataDigest);
    expect(page2.pagination).toMatchObject({ offset: 1, returned: 1, total: 2, nextCursor: null });
    expect(new Set([...page1.records, ...page2.records].map(row => row.executionId)).size).toBe(2);
    await expect(read('admin', { limit: '1', cursor: page1.pagination.nextCursor })).rejects.toMatchObject({ status: 409 });
    await expect(read('otherOwner', { limit: '1', cursor: page1.pagination.nextCursor })).rejects.toMatchObject({ status: 409 });
  });
  test('raw canonical rows, events, revisions, audit and idempotency stay identical through concurrent reads', async () => {
    const before = await rawState();
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => read(index % 2 ? 'dispatcher' : 'owner')));
    expect(results.every(value => value.readOnly)).toBe(true); expect(await rawState()).toEqual(before);
  });
  test('current progress leaf replaces prior review projection without doubling recorded quantities', async () => {
    const record = await fixture.progress(first);
    const before = await read('owner', { limit: '1' });
    const reviewed = await fixture.progress(first, 'review', { outcome: 'owner_confirmed' }, record);
    expect(reviewed.revision).toBe(record.revision + 1);
    await expect(read('owner', { limit: '1', cursor: before.pagination.nextCursor })).rejects.toMatchObject({ status: 409 });
    const row = (await read()).records.find(value => value.executionId === first.execution.id);
    expect(row.progress).toEqual({ recorded: 1, needsReview: 0, uncertain: 0 });
    expect(row.ownerDetails.progress).toHaveLength(1);
    expect(row.ownerDetails.progress[0]).toMatchObject({ quantity: { completed: '2.5', total: '10', unit: 'm2' }, reviewState: 'owner_confirmed' });
    expect(row.lifecycleState).toBe('in_progress'); expect(row.evidence.state).toBe('not_evaluated');
  });
  test('new work invalidates old pagination rather than silently omitting a current execution', async () => {
    const page = await read('owner', { limit: '1' });
    await fixture.createExecution();
    await expect(read('owner', { limit: '1', cursor: page.pagination.nextCursor })).rejects.toMatchObject({ status: 409 });
  });
  test('proposal readiness follows accepted gate snapshot, expiry invalidates a paginated snapshot', async () => {
    const context = await fixture.createExecution();
    await fixture.completion(context, 'propose_completion', { expiresAt: new Date(Date.now() + 1800).toISOString() });
    const page = await read('owner', { state: 'all', limit: '1' });
    expect(page.records[0]).toMatchObject({ executionId: context.execution.id, lifecycleState: 'completion_pending',
      approval: { state: 'pending' }, evidence: { state: 'ready_for_review' } });
    await new Promise(resolve => setTimeout(resolve, 1900));
    await expect(read('owner', { state: 'all', limit: '1', cursor: page.pagination.nextCursor })).rejects.toMatchObject({ status: 409 });
    const expired = (await read('owner', { state: 'completion_pending' })).records.find(row => row.executionId === context.execution.id);
    expect(expired.approval.state).toBe('expired'); expect(expired.evidence.state).not.toBe('ready_for_review');
  });
  test('current account/session/dispatcher-role changes revoke old reads without relying on browser state', async () => {
    const actor = fixture.actors.dispatcher;
    await fixture.ownerPool.query("UPDATE workforce_profiles SET operational_role='technician' WHERE id=$1", [actor.actorUserId]);
    try { expect((await get('dispatcher')).status).toBe(403); await expect(read('dispatcher')).rejects.toMatchObject({ status: 403 }); }
    finally { await fixture.ownerPool.query("UPDATE workforce_profiles SET operational_role='dispatcher' WHERE id=$1", [actor.actorUserId]); }
    await fixture.ownerPool.query("UPDATE auth_sessions SET status='revoked',revoked_at=NOW() WHERE id=$1", [actor.authSessionId]);
    try { expect((await get('dispatcher')).status).toBe(401); await expect(read('dispatcher')).rejects.toMatchObject({ status: 403 }); }
    finally { await fixture.ownerPool.query("UPDATE auth_sessions SET status='active',revoked_at=NULL WHERE id=$1", [actor.authSessionId]); }
  });
  test('runtime has entry-only read and 053 still refuses an owner not personally assigned', async () => {
    await expect(fixture.runtimePool.query('SELECT id FROM public.canonical_field_executions LIMIT 1')).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.runtimePool.query('SELECT public.canonical_completion_gate_snapshot($1,$2,$3)',
      [fixture.org, first.execution.id, { checklists: [], inspections: [], files: [] }])).rejects.toMatchObject({ code: '42501' });
    const client = await fixture.runtimePool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const actor = fixture.actors.owner;
      await expect(client.query('SELECT public.canonical_field_execution_read_by_appointment($1,$2,$3,$4,$5)',
        [actor.organizationId, actor.actorUserId, actor.actorAccessRole, actor.authSessionId, first.appointment])).rejects.toMatchObject({ code: 'P0002' });
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
});
