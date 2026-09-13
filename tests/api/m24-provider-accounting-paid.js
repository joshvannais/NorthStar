'use strict';
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto'), request = require('supertest');
process.env.NODE_ENV = 'test'; process.env.AUTH_ACCESS_SECRET = 'connected-local-disposable-secret-at-least-thirty-two';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY']) delete process.env[key];
const { createEstimateReviewFixture } = require('../helpers/m24-estimate-review-fixture');
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9); assert.ok(output && !fs.existsSync(output));
const result = { cases: [], pass: false, providerMode: 'injected Responses transport; no live provider' };
(async () => { let f;
  try {
    f = await createEstimateReviewFixture();
    await f.ownerPool.query("UPDATE subscriptions SET plan_type='Growth' WHERE organization_id=$1", [f.org]);
    await f.ownerPool.query("INSERT INTO polaris_provider_monthly_usage(organization_id,month_start,collected_subscription_revenue_cents) VALUES($1,date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date,10000)", [f.org]);
    let calls = 0, counts = 0, change = null, uncertain = false;
    const runtime = require('../../src/polaris/openaiRuntime').createOpenAIRuntime({ enabled: true, configured: true,
      countTransport: async body => {
        counts++; assert.equal(body.text.format.name, 'northstar_grounded_conversation_v2');
        assert.equal(f.runtimePool.totalCount, f.runtimePool.idleCount, 'protected loader released all runtime clients before count');
        assert.equal((await f.ownerPool.query("SELECT count(*)::int n FROM polaris_provider_requests WHERE organization_id=$1 AND state='reserved'",[f.org])).rows[0].n,1,'durable admission exists before count');
        if(change) await change();
        return {object:'response.input_tokens',input_tokens:100};
      },
      client: { responses: { create: async body => {
        calls++; if(uncertain)throw Object.assign(new Error('Synthetic uncertain result'),{code:'ECONNRESET'}); const envelope = JSON.parse(body.input); result.lastInputBytes = Buffer.byteLength(body.input); result.lastEvidenceCount = envelope.groundedContext.evidence.length;
        assert.equal(body.text.format.name, 'northstar_grounded_conversation_v2');

        return { id: 'fixture_response_' + calls, status: 'completed', output_text: JSON.stringify({
          questions: [{ text: 'Is the old fence being removed before installation?', evidenceIds: ['recorded_scope'] }],
          explanations: [{ text: 'Review the recorded scope before settling the installation plan.', evidenceIds: ['recorded_scope'] }],
          proposalIds: [], requestedCard: 'capella',
        }), usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } };
      } } } });
    const app = require('express')(); app.use(require('express').json());
    app.use('/api/v1/canonical', require('../../src/routes/canonicalPolaris').createCanonicalRouter({ assistantRuntime: { ...runtime, preflight(envelope) {
      result.input = envelope; return runtime.preflight(envelope);
    } } }));
    const body = { schemaVersion: 'northstar.polaris.message-request.v2', idempotencyKey: crypto.randomUUID(), message: 'What should I clarify for this fence?',
      selected: { kind: 'work', id: f.estimateGraphs[0].ids.appointment }, selectedRevision: null };
    const send = b => request(app).post('/api/v1/canonical/polaris/assistant/messages-v2').set(f.actors.owner.session.headers).send(b);
    const first = await send(body); result.first = { status: first.status, body: first.body }; assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.match(first.body.data.questions[0].text, /old fence/); assert.equal(first.body.data.requestedCard, 'capella');
    const replay = await send(body); assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.deepEqual(replay.body.data, first.body.data); assert.equal(calls, 1); assert.equal(counts,1);
    result.cases.push('actual paid admission before count; released loader clients; count/schema/send and exact replay without count or generation');
    uncertain=true; const uncertainBody={...body,idempotencyKey:crypto.randomUUID()};
    const failed=await send(uncertainBody);result.uncertain={status:failed.status,body:failed.body};assert.equal(failed.status,503);assert.equal(calls,2);assert.equal(counts,2);
    const saved=(await f.ownerPool.query('SELECT state,actual_cost_nano_usd FROM polaris_provider_requests WHERE request_id=$1',[uncertainBody.idempotencyKey])).rows[0];assert.equal(saved.actual_cost_nano_usd,'20000000');result.uncertainLedger=saved;
    const retry=await send(uncertainBody);assert.ok(retry.status>=400);assert.equal(calls,2);assert.equal(counts,2);uncertain=false;
    result.cases.push('unknown paid transport retains full charge; same key cannot repeat provider request');
    change = () => f.ownerPool.query("UPDATE organization_memberships SET status='revoked',revoked_at=clock_timestamp() WHERE id=$1", [f.actors.owner.actorUserId]);
    const revoked = await send({ ...body, idempotencyKey: crypto.randomUUID() }); result.revoked = { status: revoked.status, body: revoked.body }; assert.equal(revoked.status, 401);
    assert.equal(revoked.body.data, undefined);assert.equal(calls,2);assert.equal(counts,3); result.cases.push('actual membership revocation during count prevents generation');
    result.pass = true;
  } catch (e) { result.error = { message: e.message, stack: e.stack }; process.exitCode = 1; }
  finally { if (f) await f.cleanup(); fs.writeFileSync(output, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ pass: result.pass, cases: result.cases, error: result.error?.message })); }
})();
