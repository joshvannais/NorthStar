'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='travel-local-disposable-secret-at-least-thirty-two';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture'),{fixture}=require('../helpers/m24-travel-input'),calc=require('../../src/estimating/travelCalculation');
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);assert.ok(output&&!fs.existsSync(output));
(async()=>{let f;const result={cases:[],pass:false};try{f=await createEstimateReviewFixture();
const cases=[fixture()];
{const i=fixture();i.trips[0].vehicles=3;cases.push(i);}
{const i=fixture();i.trips[0].vehicle.rate=null;cases.push(i);}
{const i=fixture();i.trips[0].vehicle.rate='0.00';cases.push(i);}
{const i=fixture();i.trips[0].distance.basis='straight_line';cases.push(i);}
{const i=fixture();i.trips[0].distance={value:'1.609344',unit:'km',basis:'reported'};cases.push(i);}
{const i=fixture();i.logistics=[];Object.assign(i.trips[0],{distance:{value:'100',unit:'km',basis:'reported'},returnIncluded:false,trips:1,people:0,labor:{method:'not_applicable',reason:'Fuel-only example'},vehicle:{method:'consumption',unit:'l',price:'1.50',basis:'efficiency',quantity:null,efficiency:{value:'8',unit:'l_per_100km'},otherCosts:{status:'not_applicable',note:'Fuel-only declared example'}}});cases.push(i);}
for(const [index,i]of cases.entries()){const js=calc.calculate(i,'USD'),sql=(await f.ownerPool.query('SELECT canonical_travel_plan_calculate($1::jsonb) result',[i])).rows[0].result;assert.equal(String(sql.knownCents),String(calc.money(js.knownCostSubtotal)));assert.equal(sql.complete,js.complete);assert.equal(sql.totalCents===null?null:String(sql.totalCents),js.total===null?null:String(calc.money(js.total)));result.cases.push({index,known:js.knownCostSubtotal,total:js.total,sqlAgreement:true});}
result.pass=true;
}catch(e){result.error={message:e.message,code:e.code,where:e.where,stack:e.stack};process.exitCode=1;}finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({pass:result.pass,cases:result.cases.length,error:result.error?.message}));}})();
