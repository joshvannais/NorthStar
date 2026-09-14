'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),request=require('supertest');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='proposal-rate-local-disposable-secret';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture'),rates=require('../helpers/m24-proposal-rate');
const out=path.resolve(process.argv.find(x=>x.startsWith('--output=')).slice(9));assert(!fs.existsSync(out));fs.mkdirSync(out);const save=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2));
(async()=>{const result={pass:false,cases:[]};let f;
const demoSeed=require('../../src/commandCenter/demoProposalRecipe'),original=demoSeed.create;
try{for(const [index,unit]of ['USD/ft','ft','CAD/ft','USD/m'].entries()){
 demoSeed.create=(...args)=>{const value=original(...args);rates.transformKnowledge(value.knowledge,unit);value.basis.digest=value.knowledge.canonical_digest;return value;};
 f=await createEstimateReviewFixture({proposalScope:{measuredFenceLength:{value:'100',unit:'ft'},proposalGeography:'simulated-workspace'}});
 // The paid recipe passes actual draft/review/publication. Demo uses the normal
 // generation carrier with controlled test-only recipe text before generation.
 await require('../helpers/m24-proposal-source').seed(f,r=>{r.steps=r.steps.filter(s=>s.id!=='priceRate');rates.transform(r,unit);});
 for(const demo of [false,true]){
  const tag=index+'-'+(demo?'demo':'paid');let entry=demo?await request(f.app).get('/api/demo/command-center'):null;
  if(demo&&!entry.body.data.graphs.some(g=>g.polaris?.snapshot?.service?.key==='fence')){
   const cookies=entry.headers['set-cookie'];const created=await request(f.app).post('/api/demo/command-center/simulations/leads').set({Cookie:cookies.map(x=>x.split(';')[0]).join('; '),Origin:'http://localhost',Host:'localhost','X-NorthStar-Demo-Intent':'simulate-lead','Idempotency-Key':require('node:crypto').randomUUID()}).send({expectedRevision:entry.body.data.integrity.revision,scenario:{...require('../../src/commandCenter/scenarioSpace').DEFAULT_SELECTION,service:'fence'}});assert.equal(created.status,201);entry=created;entry.headers['set-cookie']=cookies;
  }
  const graph=demo?entry.body.data.graphs.find(g=>g.polaris?.snapshot?.service?.key==='fence'):f.estimateGraphs[0],route=(demo?'/api/demo/command-center/estimates/':'/api/v1/canonical/estimates/')+graph.ids.estimate;
  const headers=demo?{Cookie:entry.headers['set-cookie'].map(x=>x.split(';')[0]).join('; '),Origin:'http://localhost',Host:'localhost','X-NorthStar-Demo-Intent':'proposal-preview'}:f.actors.owner.session.headers;
  const before=await request(f.app).get(route+'/review').set(headers);assert.equal(before.status,200);save(tag+'-before.json',before.body);
  let body={version:'estimate-proposal-preview-v1',selectedRevision:null,expectedBasisDigest:null,overrides:[],candidateIds:[]};
  let response=await request(f.app).post(route+'/proposal-preview').set(headers).send(body);
  if(response.status===200&&response.body.data.readiness==='blocked'){
   body={...body,expectedBasisDigest:response.body.data.basisDigest,overrides:[{fieldId:'material',value:'cedar',unit:'category',sourceKind:'owner_assumption',reason:'Explicit local proposed cedar replacement; original preserved.'}]};response=await request(f.app).post(route+'/proposal-preview').set(headers).send(body);
  }
  save(tag+'-response.json',{unit,status:response.status,body:response.body});
  assert.equal(response.status,unit==='USD/ft'?200:400,JSON.stringify(response.body));
  if(unit==='USD/ft'){const pricing=response.body.data.components.find(c=>c.kind==='pricing');assert.equal(pricing.inputs.lines[0].rate,'5');assert.equal(pricing.result.result.proposedBeforeTax,'500.00');assert.equal(response.body.data.completeCost,null);}
  const after=await request(f.app).get(route+'/review').set(headers);assert.equal(after.status,200);save(tag+'-after.json',after.body);
  const stable=v=>JSON.parse(JSON.stringify(v,(k,x)=>['assessedAt','generatedAt','expiresAt'].includes(k)?undefined:x));assert.deepEqual(stable(before.body),stable(after.body));result.cases.push({demo,unit,status:response.status,noFinancialDrift:true});
 }
 await f.cleanup();f=null;
}result.pass=true;}catch(e){result.error={message:e.message,stack:e.stack};process.exitCode=1;}finally{demoSeed.create=original;if(f)await f.cleanup();save('RESULT.json',result);console.log(JSON.stringify(result));}})();
