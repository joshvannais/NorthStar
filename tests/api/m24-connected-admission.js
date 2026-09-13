'use strict';
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
process.env.NODE_ENV = 'test'; process.env.AUTH_ACCESS_SECRET = 'connected-local-disposable-secret-at-least-thirty-two';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY']) delete process.env[key];
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9); assert.ok(output && !fs.existsSync(output));
const result = { cases: [], pass: false };
(async () => { let f;
  try {
    f = await createEstimateReviewFixture(); result.cases.push('074 compiled through actual separated-role startup');
    const counts = await f.ownerPool.query('SELECT count(*)::int n FROM public._migrations'); result.migrations = counts.rows[0].n;
    for (const table of ['demo_polaris_provider_requests', 'demo_polaris_provider_windows', 'canonical_tax_research_jobs', 'canonical_tax_research_candidates', 'canonical_tax_rule_versions']) {
      await assert.rejects(f.runtimePool.query('SELECT * FROM public.' + table), e => e.code === '42501');
    }
    result.cases.push('runtime direct private usage/candidate/validated-rule reads denied');
    const tenant = crypto.randomUUID(), token = 'a'.repeat(64), source = 'b'.repeat(64), expires = new Date(Date.now() + 3600000).toISOString();
    const request = crypto.randomUUID();
    const reserve = id => f.runtimePool.query('SELECT public.demo_polaris_provider_reserve($1,$2,$3,$4,$5,$6,$7) result', [tenant, token, id, 'c'.repeat(64), 'd'.repeat(64), expires, source]).then(r => r.rows[0].result);
    const first = await reserve(request); assert.equal(first.admitted, true);
    const replay = await reserve(request); assert.equal(replay.replay, true); assert.equal(replay.id, first.id);
    assert.equal((await reserve(crypto.randomUUID())).reason, 'busy');
    const usage = { costNanoUsd: 10, inputTokens: 1, outputTokens: 1, attemptCount: 1, outcomeClass: 'completed', latencyMs: 1, providerRequestId: null };
    const reconcile = id => f.runtimePool.query('SELECT public.demo_polaris_provider_reconcile($1,$2,$3) result', [id, token, usage]);
    await reconcile(first.id); assert.equal((await reconcile(first.id)).rows[0].result.replay, true);
    for (let i = 0; i < 3; i++) { const r = await reserve(crypto.randomUUID()); assert.equal(r.admitted, true); await reconcile(r.id); }
    assert.equal((await reserve(crypto.randomUUID())).reason, 'session_limit');
    result.cases.push('demo exact replay/no duplicate charge, concurrency and four-request lifetime cap');
    await assert.rejects(f.runtimePool.query('SELECT public.demo_polaris_provider_reserve($1,$2,$3,$4,$5,$6,$7)', [tenant, token, request, 'e'.repeat(64), 'd'.repeat(64), expires, source]), e => e.constraint === 'demo_polaris_request_changed');
    result.cases.push('changed same-key request rejected');
    for (const field of ['costNanoUsd', 'inputTokens', 'outcomeClass']) {
      await assert.rejects(f.runtimePool.query('SELECT public.demo_polaris_provider_reconcile($1,$2,$3)', [first.id, token, { ...usage, [field]: null }]), e => e.code === '22023');
    }
    const retired = (await f.runtimePool.query('SELECT public.connected_reasoning_retire() result')).rows[0].result;
    assert.deepEqual(retired, { requestsRetired: 0, windowsRetired: 0 });
    assert.equal((await reserve(request)).replay, true);
    result.cases.push('malformed usage rejected and retirement preserves live request replay/caps');
    async function status(actor, org = f.org) {
      const client = await f.runtimePool.connect();
      try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        return (await client.query('SELECT public.canonical_tax_research_status($1,$2,$3) result', [org, actor.actorUserId, actor.authSessionId])).rows[0].result;
      } finally { await client.query('ROLLBACK'); client.release(); }
    }
    assert.deepEqual(await status(f.actors.owner), { total: 0, pending: 0, leased: 0, done: 0, exhausted: 0, capacity: 1000, capacityReached: false });
    await assert.rejects(status(f.actors.owner, crypto.randomUUID()), e => e.code === '42501');
    await assert.rejects(status({ ...f.actors.owner, authSessionId: crypto.randomUUID() }), e => e.code === '42501');
    result.cases.push('protected owner status counts and cross-tenant/unavailable session denial');
    result.pass = true;
  } catch (e) { result.error = { message: e.message, stack: e.stack }; process.exitCode = 1; }
  finally { if (f) await f.cleanup(); fs.writeFileSync(output, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); }
})();
