'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='equipment-cost-local-disposable-secret-at-least-thirty-two';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);assert.ok(output&&!fs.existsSync(output));
(async()=>{let fixture;const evidence={cases:[]};try{fixture=await createEstimateReviewFixture();const r=(await fixture.ownerPool.query("SELECT to_regclass('public.canonical_equipment_cost_plans')::text name")).rows[0];assert.equal(r.name,'canonical_equipment_cost_plans');evidence.cases.push('Disposable migration compilation and existing graph creation');evidence.pass=true;}catch(e){evidence.error=e.stack;process.exitCode=1;}finally{if(fixture)await fixture.cleanup();fs.writeFileSync(output,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}})();
