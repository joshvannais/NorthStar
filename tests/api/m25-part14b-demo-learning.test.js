'use strict';

const request = require('supertest');
const crypto = require('crypto');
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORIGIN = 'http://northstar.test';

function cookie(response) { return response.headers['set-cookie'][0].split(';')[0]; }
function post(app, savedCookie, path, intent, key, body) {
  return request(app).post(path).set('Host', 'northstar.test').set('Origin', ORIGIN).set('Sec-Fetch-Site', 'same-origin')
    .set('Cookie', savedCookie).set('Idempotency-Key', key).set('X-NorthStar-Demo-Intent', intent).send(body);
}
function quotedIdentifier(value) { return `"${String(value).replace(/"/g, '""')}"`; }
async function paidStateDigest(pool) {
  const catalog = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename<>'_migrations' AND tablename<>'audit_logs' AND tablename NOT LIKE 'demo\\_%' ESCAPE '\\' ORDER BY tablename`);
  const result = {};
  for (const { tablename } of catalog.rows) {
    const table = quotedIdentifier(tablename);
    const value = await pool.query(`SELECT md5(COALESCE(string_agg(value.row, '' ORDER BY value.row), '')) digest, count(*)::int count
      FROM (SELECT row_to_json(item)::text row FROM ${table} item) value`);
    result[tablename] = value.rows[0];
  }
  return result;
}

realPostgres('Mission 25 Part 14B mounted resettable fictional demo', () => {
  let fixture;
  beforeAll(async () => { fixture = await createDatabaseFixture(); }, 120000);
  afterAll(async () => { if (fixture) await fixture.cleanup(); }, 120000);

  test('isolates two visitors, completes the journey, replays safely and resets without paid mutation', async () => {
    const firstEntry = await request(fixture.app).get('/api/demo/learning-center').set('Host', 'northstar.test');
    const secondEntry = await request(fixture.app).get('/api/demo/learning-center').set('Host', 'northstar.test');
    expect(firstEntry.status).toBe(200); expect(secondEntry.status).toBe(200);
    const firstCookie = cookie(firstEntry), secondCookie = cookie(secondEntry), before = await paidStateDigest(fixture.ownerPool);
    expect(firstCookie).not.toBe(secondCookie);
    expect(firstEntry.body.data.jobOutcome.demoJourneyStage).toBe('first_use');
    let revision = firstEntry.body.data.jobOutcome.demoWorkspaceRevision;
    const summaryIds = firstEntry.body.data.center.outcomeServices[0].summaries.slice(0, 5).map(value => value.summaryId);
    const actions = ['grant_graph', 'grant_proposal', 'prepare', 'preview', 'save', 'adoption_preview', 'adopt', 'rollback'];
    for (const action of actions) {
      const details = { path: 'fixture-' + action }; if (action === 'prepare') details.summaryIds = summaryIds;
      const key = crypto.randomUUID(), response = await post(fixture.app, firstCookie, '/api/demo/learning-center/actions', 'learning-journey', key, { action, details, expectedRevision: revision });
      expect([200, 201]).toContain(response.status); revision = response.body.data.jobOutcome.demoWorkspaceRevision;
      if (action === 'grant_graph') {
        const replay = await post(fixture.app, firstCookie, '/api/demo/learning-center/actions', 'learning-journey', key, { action, details, expectedRevision: response.body.data.jobOutcome.demoWorkspaceRevision - 1 });
        expect(replay.status).toBe(200); expect(replay.body.replayed).toBe(true); expect(replay.body.data.jobOutcome.demoWorkspaceRevision).toBe(revision);
      }
      if (action === 'preview') expect(response.body.data.result.preview.cohortSize).toBe(5);
      if (action === 'adoption_preview') expect(response.body.data.result.multiplier).toBe('1.080000');
    }
    const completed = await request(fixture.app).get('/api/demo/learning-center').set('Host', 'northstar.test').set('Cookie', firstCookie);
    expect(completed.body.data.jobOutcome.demoJourneyStage).toBe('rolled_back');
    expect((await request(fixture.app).get('/api/demo/learning-center').set('Host', 'northstar.test').set('Cookie', secondCookie)).body.data.jobOutcome.demoJourneyStage).toBe('first_use');
    const reset = await post(fixture.app, firstCookie, '/api/demo/learning-center/reset', 'learning-journey-reset', crypto.randomUUID(), { expectedRevision: revision });
    expect(reset.status).toBe(200); expect(reset.body.data.jobOutcome.demoJourneyStage).toBe('first_use');
    expect(await paidStateDigest(fixture.ownerPool)).toEqual(before);
    expect((await fixture.ownerPool.query("SELECT array_agg(DISTINCT operation ORDER BY operation) operations FROM demo_command_center_mutations WHERE operation IN ('learning_step','reset')")).rows[0].operations).toEqual(['learning_step', 'reset']);
  }, 120000);

  test('fails closed on stale revisions, foreign origin and invalid direct operation', async () => {
    const entry = await request(fixture.app).get('/api/demo/learning-center').set('Host', 'northstar.test'), savedCookie = cookie(entry), revision = entry.body.data.jobOutcome.demoWorkspaceRevision;
    const good = await post(fixture.app, savedCookie, '/api/demo/learning-center/actions', 'learning-journey', crypto.randomUUID(), { action: 'grant_graph', details: { path: 'grant' }, expectedRevision: revision });
    expect(good.status).toBe(201);
    const stale = await post(fixture.app, savedCookie, '/api/demo/learning-center/actions', 'learning-journey', crypto.randomUUID(), { action: 'grant_proposal', details: { path: 'stale' }, expectedRevision: revision });
    expect(stale.status).toBe(409);
    const foreign = await request(fixture.app).post('/api/demo/learning-center/actions').set('Host', 'northstar.test').set('Origin', 'https://outside.example').set('Cookie', savedCookie).set('Idempotency-Key', crypto.randomUUID()).set('X-NorthStar-Demo-Intent', 'learning-journey').send({ action: 'grant_proposal', details: {}, expectedRevision: good.body.data.jobOutcome.demoWorkspaceRevision });
    expect(foreign.status).toBe(403);
    await expect(fixture.ownerPool.query("INSERT INTO demo_command_center_mutations(session_id,idempotency_hash,operation,request_digest,response_revision,response_digest) SELECT id,$1,'paid_write',$1,revision,$1 FROM demo_command_center_sessions LIMIT 1", ['f'.repeat(64)])).rejects.toMatchObject({ code: '23514' });
  }, 120000);
});
