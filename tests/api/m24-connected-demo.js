'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),express=require('express'),request=require('supertest');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='local-connected-fixture-secret-at-least-thirty-two';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY'])delete process.env[k];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);assert.ok(output&&!fs.existsSync(output));const result={cases:[],pass:false};
(async()=>{let f;try{
 f=await createEstimateReviewFixture();let calls=0;
 const runtime=require('../../src/polaris/openaiRuntime').createOpenAIRuntime({enabled:true,configured:true,client:{responses:{create:async input=>{calls++;result.input=JSON.parse(input.input);return{id:'local-demo-'+calls,status:'completed',output_text:JSON.stringify({questions:[{text:'What access should the owner check before work begins?',evidenceIds:['recorded_scope']}],explanations:[],proposalIds:[],requestedCard:'capella'}),usage:{input_tokens:100,output_tokens:50,total_tokens:150,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}}};}}}});
 const app=express();app.use(express.json());app.locals.demoGroundedRuntime=runtime;app.use('/api/demo',require('../../src/routes/demo'));const agent=request.agent(app);
 const first=await agent.get('/api/demo/command-center');assert.equal(first.status,200);result.workspace=first.body.data;
 const items=require('../../src/commandCenter/workspace').demoCanonicalItems(first.body.data);assert.ok(items.length);
 const body={schemaVersion:'northstar.polaris.message-request.v2',idempotencyKey:crypto.randomUUID(),message:'What should we clarify?',selected:{kind:'work',id:items[0].ids.appointment},selectedRevision:null};
 const send=b=>agent.post('/api/demo/command-center/polaris/messages-v2').set('Host','127.0.0.1').set('Origin','http://127.0.0.1').set('X-NorthStar-Demo-Intent','polaris-conversation').send(b);
 const response=await send(body);result.response={status:response.status,body:response.body};assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.data.simulated,true);assert.equal(response.body.data.requestedCard,'capella');
 const replay=await send(body);assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(calls,1);assert.deepEqual(replay.body,response.body);
 const after=await agent.get('/api/demo/command-center');assert.deepEqual(after.body.data,first.body.data);assert.equal((await f.ownerPool.query('SELECT count(*)::int n FROM demo_command_center_sessions')).rows[0].n,0);
 result.cases.push('fresh isolated actual demo context/selected review/provider parser/replay with zero financial session persistence');result.pass=true;
}catch(e){result.error={message:e.message,stack:e.stack};process.exitCode=1;}finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,error:result.error?.message}));}})();
