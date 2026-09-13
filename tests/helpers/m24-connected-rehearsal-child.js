'use strict';
// IPC-only disposable rehearsal. All model/call/source transports are injected fixtures.
const path=require('node:path'),assert=require('node:assert/strict');
const source=path.resolve(process.argv[2]),seed=process.argv[3]==='seed';
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='m24-connected-recovery-fixture-only-at-least-thirty-two';
for(const k of ['OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
(async()=>{let fixture,db,server;try{
 let app,metadata={};
 if(seed){delete process.env.DATABASE_URL;delete process.env.MIGRATION_DATABASE_URL;fixture=await require(path.join(source,'tests/helpers/m24-estimate-review-fixture')).createEstimateReviewFixture();app=fixture.app;db=fixture.db;metadata={databaseUrl:process.env.DATABASE_URL,migrationUrl:process.env.MIGRATION_DATABASE_URL,actors:fixture.actors,graphs:fixture.estimateGraphs,org:fixture.org};}
 else{
 db=require(path.join(source,'src/db'));assert.equal(await db.initDatabase(),true);
 const express=require('express'),actual=require(path.join(source,'src/server')).app;
 const runtime=require(path.join(source,'src/polaris/openaiRuntime')).createOpenAIRuntime({enabled:true,configured:true,client:{responses:{create:async body=>{const envelope=JSON.parse(body.input),caller=envelope.purpose==='caller_guidance';return{id:'fixture-response',status:'completed',output_text:JSON.stringify({questions:[{text:'What access should the owner confirm before work starts?',evidenceIds:[caller?envelope.groundedContext.evidence.find(e=>e.id.startsWith('call_')).id:'recorded_scope']}],explanations:[],proposalIds:[],requestedCard:caller?'none':'capella'}),usage:{input_tokens:100,output_tokens:50,total_tokens:150,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}}};}}}});
 // Router is mounted at its normal canonical prefix; the path filter prevents bypassing financial raw-body middleware.
 app=express();const canonical=require(path.join(source,'src/routes/canonicalPolaris')).createCanonicalRouter({assistantRuntime:runtime});
 app.use((req,res,next)=>{if(req.path.startsWith('/api/v1/canonical/polaris/assistant/'))express.json()(req,res,()=>{const old=req.url;req.url=req.url.slice('/api/v1/canonical'.length);canonical(req,res,()=>{req.url=old;next();});});else next();});
 app.locals.demoGroundedRuntime=runtime;actual.locals.demoGroundedRuntime=runtime;
 app.locals.connectedCallGenerate=require(path.join(source,'src/polaris/callGenerationBinding')).createProductionCallGenerate({POLARIS_CALL_GUIDANCE_ENABLED:'true',POLARIS_GROUNDED_V2_ENABLED:'true'},{getPool:()=>db.getPool(),runtime});
 app.use(require(path.join(source,'src/routes/connectedCall')).createConnectedCallRouter({getPool:()=>db.getPool(),verifyRaw:(_raw,sig)=>sig==='local-recovery-fixture'}));app.use(actual);
 }
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));process.send({ready:true,origin:'http://127.0.0.1:'+server.address().port,...metadata});
 await new Promise(resolve=>process.on('message',async message=>{if(message==='stop')return resolve();if(message?.action==='research'){try{const Worker=require(path.join(source,'src/estimating/taxResearchWorker')).TaxResearchWorker,acquire=require(path.join(source,'src/estimating/taxSourceAcquisition')).createTaxSourceAcquisition({allowedOrigins:new Set(['https://official.example']),transport:{acquire:async()=>[{url:'https://official.example/fixture',content:'Synthetic evidence; independent review required.',effectiveOn:null,endsOn:null,coverage:'Fixture only',exclusions:'No validated tax treatment'}]}});const value=await new Worker({getPool:()=>db.getPool(),acquire,batchSize:5}).tick();process.send({action:'research',value});}catch(error){process.send({action:'research',error:error.message});}}}));
 await new Promise(r=>server.close(r));if(fixture)await fixture.cleanup();else await db.close();process.disconnect();
}catch(error){process.send({error:error.message});process.exitCode=1;}})();
