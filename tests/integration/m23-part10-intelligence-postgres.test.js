'use strict';
const request = require('supertest');
const { readOperationalIntelligence } = require('../../src/operations/intelligenceRepository');
const { validate } = require('../../public/js/operational-intelligence');
const real = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
real('Mission 23 Part 10 mounted operational intelligence', () => {
  let fixture, work, progressRecord;
  beforeAll(async () => {
    for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) delete process.env[key];
    jest.spyOn(require('https'), 'request').mockImplementation(() => { throw new Error('External transport forbidden'); });
    fixture = await require('../helpers/m23-part9b-overview-fixture').createDatabaseFixture();
    work = await fixture.createExecution({ title: 'Kitchen sink repair' });
  }, 180000);
  afterAll(async () => { try { if (fixture) await fixture.cleanup(); } finally { jest.restoreAllMocks(); } }, 180000);
  const read = (actor = 'owner', id = work.execution.id, query = '') => request(fixture.app)
    .get('/api/v1/field-executions/' + id + '/intelligence' + query).set(fixture.actors[actor].session.headers);
  test('fresh migration runner and role-separated mounted sources produce a minimized non-capability snapshot', async () => {
    const result = await read();
    expect(result.status).toBe(200);
    const data = validate(result.body.data, work.execution.id);
    expect(data.providerUsed).toBe(false); expect(data.capabilities).toEqual([]); expect(data.humanReviewRequired).toBe(true);
    expect(data.assignment.digest).toBe(work.assignment.digest); expect(data.execution.digest).toBe(work.execution.digest);
    expect(data.comparisons[0].plannedWindowSeconds).toBe(3600);
    expect(data.comparisons[0].comparable).toBe(false);
    expect(data.missingInputs.map(x => x.code)).toContain('planned_inputs');
    expect(result.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(data)).not.toMatch(/Synthetic overview customer|transcript_text|csrfToken|sessionId|email/);
  });
  test('auth, role, tenant, individual record and query boundaries fail closed', async () => {
    expect((await request(fixture.app).get('/api/v1/field-executions/' + work.execution.id + '/intelligence')).status).toBe(401);
    for (const actor of ['dispatcher', 'viewer', 'otherOwner']) expect((await read(actor)).status).toBe(404);
    expect((await read('member')).status).toBe(200);
    expect((await read('admin')).status).toBe(200);
    expect((await read('owner', work.execution.id, '?organizationId=' + fixture.otherOrg)).status).toBe(400);
  });
  test('pending recorded progress is pinned but never promoted into reviewed actuals', async () => {
    const progress = await fixture.progress(work); progressRecord = progress;
    const result = await read(); expect(result.status).toBe(200);
    const data = result.body.data;
    expect(data.conflicts.map(x => x.code)).toContain('progress_review');
    expect(data.comparisons.filter(x => x.code === 'reported_quantity')).toEqual([]);
    expect(data.evidence.find(x => x.domain === 'progress').pins).toContainEqual({ id: progress.id, revision: progress.revision, digest: progress.digest });
  });
  test('human review advances an exact current leaf and produces its measured target comparison', async () => {
    const before = (await read()).body.data;
    const reviewed = await fixture.progress(work, 'review', { outcome: 'owner_confirmed' }, progressRecord);
    const result = await read(); expect(result.status).toBe(200);
    const data = validate(result.body.data, work.execution.id);
    expect(data.comparisons.find(x => x.code === 'reported_quantity')).toMatchObject({ completed: '2.5', total: '10', unit: 'm2', source: { id: reviewed.id, revision: reviewed.revision, digest: reviewed.digest } });
    expect(data.evidence.find(x => x.domain === 'progress').sourceSetDigest).not.toBe(before.evidence.find(x => x.domain === 'progress').sourceSetDigest);
    expect(data.execution).toEqual(before.execution);
  });
  test('concurrent reads are deterministic in source sets and create no operational mutation', async () => {
    const before = await fixture.ownerPool.query('SELECT count(*)::int AS count FROM canonical_field_execution_events WHERE organization_id=$1', [fixture.org]);
    const results = await Promise.all(Array.from({ length: 4 }, () => read()));
    results.forEach(result => expect(result.status).toBe(200));
    results.slice(1).forEach(result => expect(result.body.data.evidence).toEqual(results[0].body.data.evidence));
    const after = await fixture.ownerPool.query('SELECT count(*)::int AS count FROM canonical_field_execution_events WHERE organization_id=$1', [fixture.org]);
    expect(after.rows).toEqual(before.rows);
  });
  test('database entry independently denies cross-tenant and forged role reads', async () => {
    await expect(readOperationalIntelligence(fixture.runtimePool, { ...fixture.actors.otherOwner, executionId: work.execution.id })).rejects.toMatchObject({ status: 404 });
    await expect(readOperationalIntelligence(fixture.runtimePool, { ...fixture.actors.member, actorAccessRole: 'owner', executionId: work.execution.id })).rejects.toMatchObject({ status: 404 });
  });
  test('runtime retains no direct completion or evidence table privilege', async () => {
    const result = await fixture.runtimePool.query("SELECT has_table_privilege(current_user,'public.canonical_completion_records','SELECT') AS completion,has_table_privilege(current_user,'public.canonical_progress_records','SELECT') AS progress");
    expect(result.rows[0]).toEqual({ completion: false, progress: false });
  });
  test('ordinary restart migration reconciliation remains zero-op', async () => {
    const before = await fixture.ownerPool.query('SELECT * FROM _migrations ORDER BY 1');
    expect(await fixture.db.initDatabase()).toBe(true);
    const after = await fixture.ownerPool.query('SELECT * FROM _migrations ORDER BY 1');
    expect(after.rows).toEqual(before.rows);
  });
  test('revoked individual membership clears authority on the next read', async () => {
    await fixture.ownerPool.query("UPDATE organization_memberships SET status='revoked',revoked_at=clock_timestamp() WHERE organization_id=$1 AND user_id=$2", [fixture.org, fixture.actors.member.actorUserId]);
    expect([401,403,404]).toContain((await read('member')).status);
    await expect(readOperationalIntelligence(fixture.runtimePool, { ...fixture.actors.member, executionId: work.execution.id })).rejects.toMatchObject({ status: 404 });
  });
});
