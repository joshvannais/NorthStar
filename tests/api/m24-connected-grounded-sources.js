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
    const knowledge=require('../../src/knowledge/repository'),helper=require('../helpers/m24-connected-knowledge'),actors={organizationId:f.org,owner:f.actors.owner.actorUserId,admin:f.actors.admin.actorUserId};const published=await helper.completeKnowledge(knowledge,f.runtimePool,actors,'grounded-source');
    let calls = 0, change = null;
    const runtime = require('../../src/polaris/openaiRuntime').createOpenAIRuntime({ enabled: true, configured: true,
      client: { responses: { create: async body => {
        calls++; const envelope = JSON.parse(body.input); result.lastInputBytes = Buffer.byteLength(body.input); result.lastEvidenceCount = envelope.groundedContext.evidence.length;
        assert.equal(body.text.format.name, 'northstar_grounded_conversation_v2');
        if (change) try { await change(); } catch (e) { result.fixtureChangeError = { code: e.code, message: e.message }; throw e; }
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
    const replay = await send(body); assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.deepEqual(replay.body.data, first.body.data); assert.equal(calls, 1);
    result.cases.push('actual paid v2 provider parser/current full review and exact revalidated replay');
    assert.ok(result.input.groundedContext.evidence.some(e=>e.id.startsWith('knowledge:')));
    change=async()=>{const tombstone=await knowledge.createKnowledgeTombstone(f.runtimePool,helper.lifecycleTarget(published.identity,actors,'Remove outdated published guidance during generated response'));await helper.approveAndPublish(knowledge,f.runtimePool,tombstone,actors,published.identityPublication);};
    const changed=await send({...body,idempotencyKey:crypto.randomUUID()});result.changed={status:changed.status,body:changed.body};assert.equal(changed.status,409,JSON.stringify(changed.body));assert.equal(changed.body.data,undefined);assert.equal(calls,2);change=null;
    const oldReplay=await send(body);result.oldReplay={status:oldReplay.status,body:oldReplay.body};assert.equal(oldReplay.status,409);assert.equal(oldReplay.body.data,undefined);assert.equal(calls,2);
    result.cases.push('actual publication tombstone during provider wait succeeds outside read transaction; post-provider old source and cached old response both suppressed');
    result.pass = true;
  } catch (e) { result.error = { message: e.message, stack: e.stack }; process.exitCode = 1; }
  finally { if (f) await f.cleanup(); fs.writeFileSync(output, JSON.stringify(result, null, 2)); console.log(JSON.stringify({ pass: result.pass, cases: result.cases, error: result.error?.message })); }
})();
