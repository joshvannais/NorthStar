'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),request=require('supertest');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='proposal-local-disposable-secret-at-least-thirty-two';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const out=process.argv.find(x=>x.startsWith('--output='))?.slice(9);assert(out&&!fs.existsSync(out));fs.mkdirSync(out);const save=(n,v)=>fs.writeFileSync(path.join(out,n),JSON.stringify(v,null,2));
(async()=>{let f;try{
 f=await require('../helpers/m24-estimate-review-fixture').createEstimateReviewFixture({recordedLaborHours:8,proposalScope:{measuredFenceLength:{value:'100',unit:'ft'},proposalGeography:'simulated-workspace'}});
 const demoRepo=require('../../src/commandCenter/demoRepository'),workspaceModule=require('../../src/commandCenter/workspace');
 // Local seed selection only; use the unmodified new-session generator and its one
 // canonical cost example. Other legacy demo graphs must not be relabeled.
 let token;
 for(let n=0;n<100;n++){const candidate=demoRepo.issueToken(),state=workspaceModule.createInitialDemoState(candidate.tenantId,candidate.issuedAt,{seed:demoRepo.workspaceSeedForToken(candidate.tokenHash)});if(state.graphs[0].polaris.snapshot.service.key==='fence'){token=candidate;break;}}
 assert(token,'Bounded local seed search requires a canonical fence example');
 const cookies='northstar_demo_workspace='+token.token;
 let entry=await request(f.app).get('/api/demo/command-center').set('Cookie',cookies);assert.equal(entry.status,200);
 save('seed-attribution.json',{localGeneratedSeedSelection:true,unchangedGenerator:true,noRetrofittedRecords:true});
 const graph=entry.body.data.graphs.find(g=>g.polaris?.snapshot?.service?.key==='fence'&&g.polaris.calculationVersion==='m19-part3-canonical-v2'),route='/api/demo/command-center/estimates/'+graph.ids.estimate,headers={Cookie:cookies,Origin:'http://localhost',Host:'localhost','X-NorthStar-Demo-Intent':'proposal-preview','X-NorthStar-Demo-Revision':String(entry.body.data.integrity.revision)};
 const before=await request(f.app).get(route+'/review').set(headers);save('before.json',before.body);assert.equal(before.status,200);
 let draft={version:'estimate-proposal-preview-v1',selectedRevision:null,expectedBasisDigest:null,overrides:[],candidateIds:[]};
 let response=await request(f.app).post(route+'/proposal-preview').set(headers).send(draft);save('draft.json',{status:response.status,body:response.body});assert.equal(response.status,200);
 draft={...draft,expectedBasisDigest:response.body.data.basisDigest};
 if(response.body.data.readiness==='blocked'||response.body.data.questions.some(q=>q.id==='material')){draft.overrides=[{fieldId:'material',value:'cedar',unit:'category',sourceKind:'owner_assumption',reason:'Explicit owner choice for this local proposed cedar fence.'}];response=await request(f.app).post(route+'/proposal-preview').set(headers).send(draft);save('confirmed-draft.json',{status:response.status,body:response.body});assert.equal(response.status,200);}
 headers['X-NorthStar-Demo-Intent']='proposal-adoption';
 let body={version:'estimate-proposal-adoption-v1',draft,selection:{materials:'replace',labor:'replace',equipment:'replace',travel:'replace',pricing:'replace'},previousReceipt:null,coverage:{costs:{overlaps:[],equipmentOutside:[],travelOutside:[],confirmed:true,reason:'Reviewed distinct material, work, equipment and mobilization allocations.'},overhead:{status:'disjoint',explanation:'Reviewed explicit local fixture cost sources; overhead is separate.',included:[]}},pricingPolicy:null,expectedReviewDigest:null,confirmed:false,reason:'Reviewed local complete fence estimate; existing records preserved.'};
 if(process.argv.includes('--policy')){const current=before.body.data.pricingPolicies,sources=before.body.data.pricingPlans.sources,recipe=sources.references.find(r=>r.content?.estimateProposalRecipe)?.content.estimateProposalRecipe;assert(recipe);body.pricingPolicy={sourceDigest:current.sources.digest,currentPin:null,inputs:{serviceKey:'fence',method:'markup',percent:'20.00',contingency:{method:'none',amount:null,percent:null,coverage:{status:'declared_separate',explanation:'No additional allowance is proposed.'}},minimum:{method:'none',amount:null},source:recipe.components.find(c=>c.kind==='pricing').inputs.overhead.source}};}
 response=await request(f.app).post(route+'/proposal-adoption-preview').set(headers).send(body);save('aggregate-preview.json',{status:response.status,body:response.body});assert.equal(response.status,200,JSON.stringify(response.body));
 body={...body,expectedReviewDigest:response.body.data.reviewDigest,confirmed:true};const key=require('node:crypto').randomUUID();
 response=await request(f.app).post(route+'/proposal-adoptions').set({...headers,'Idempotency-Key':key}).send(body);save('adopt.json',{status:response.status,body:response.body});assert.equal(response.status,201,JSON.stringify(response.body));
 const after=await request(f.app).get(route+'/review').set(headers);save('after.json',after.body);assert.equal(after.status,200,JSON.stringify(after.body));assert.equal(after.body.data.changedComponent,'prepared');if(body.pricingPolicy){assert(after.body.data.pricingPolicies.current);assert.equal(after.body.data.pricingPolicies.current.result.reviewed,null);}
 const again=await request(f.app).post(route+'/proposal-adoptions').set({...headers,'Idempotency-Key':key}).send(body);save('retry.json',{status:again.status,body:again.body});assert.equal(again.status,200);assert.equal(again.body.data.replayed,true);
 save('RESULT.json',{pass:true});
 }catch(e){save('FAILURE.json',{message:e.message,code:e.code,detail:e.detail,where:e.where,stack:e.stack});throw e;}finally{if(f)await f.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
