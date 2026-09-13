'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='commercial-local-disposable-secret-at-least-thirty-two';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture'),c=require('../../src/estimating/commercialCalculation'),{fixture,group,source,adjustment}=require('../helpers/m24-commercial-input');
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);assert.ok(output&&!fs.existsSync(output));
(async()=>{let f;const result={cases:[],pass:false};try{
 f=await createEstimateReviewFixture();const cases=[];function add(label,amounts,change,expected){const v=fixture(amounts);change(v);cases.push({label,...v,expected});}
 add('discount plus fee',['60.00','40.00'],f=>{f.value.adjustments=[adjustment(['a','b'])];f.value.fees=[{lineId:'fee',label:'Fee',amount:'5.00',reason:'Recorded fee'}];f.value.taxGroups[0].lineIds.push('fee');},{total:'104.50'});
 add('stable order remainder',['1.00','1.00','1.00'],f=>f.value.adjustments=[adjustment(['c','b','a'],{amount:'1.00'})],{netBeforeTax:'2.00'});
 add('inclusive',['110.00'],f=>f.value.taxGroups[0].behavior='inclusive',{netBeforeTax:'100.00',tax:'10.00',total:'110.00'});
 add('exempt separate',['100.00','50.00'],f=>f.value.taxGroups=[group(['a']),group(['b'],{groupId:'exempt',treatment:'exempt',ratePercent:'0'})],{total:'160.00'});
 add('one group rounding',['0.05','0.05'],()=>{},{tax:'0.01'});
 add('signed increase',['1000.00'],f=>f.value.adjustments=[adjustment(['a'],{kind:'adjustment',amount:'200.00'})],{netBeforeTax:'1200.00'});
 add('signed reduction',['1000.00'],f=>f.value.adjustments=[adjustment(['a'],{kind:'adjustment',amount:'-200.00'})],{netBeforeTax:'800.00'});
 add('percent tie',['0.01'],f=>f.value.adjustments=[adjustment(['a'],{kind:'line_discount',method:'percent',amount:null,percent:'50'})],{netBeforeTax:'0.00'});
 add('missing charge',[null],()=>{},{complete:false,total:null});
 add('missing adjustment',['100.00'],f=>f.value.adjustments=[adjustment(['a'],{kind:'adjustment',amount:null})],{complete:false,total:null});
 add('unknown treatment',['100.00'],f=>Object.assign(f.value.taxGroups[0],{treatment:'unknown',ratePercent:null,source:source({kind:'unknown'})}),{complete:false,total:null});
 add('missing applicability',['100.00'],f=>f.value.taxGroups[0].source.location='',{complete:false,total:null});
 add('expired applicability',['100.00'],f=>f.value.taxGroups[0].source.endsOn='2026-09-12',{complete:false,total:null});
 add('zero-rate',['100.00'],f=>Object.assign(f.value.taxGroups[0],{treatment:'zero_rate',ratePercent:'0'}),{total:'100.00'});
 add('included package child',['100.00','50.00'],f=>{f.context.pricing.lines[1].includedIn='a';f.value.taxGroups[0].lineIds=['a'];},{netBeforeTax:'100.00'});
 add('payment remainder',['0.05'],f=>f.value.payments={mode:'share',balanceId:'b',stages:[{stageId:'d',label:'Deposit',kind:'deposit',value:'50'},{stageId:'b',label:'Balance',kind:'balance',value:'50'}]},{total:'0.06'});
 for(const row of cases){const js=c.calculate(row.value,'USD',row.context),sql=(await f.ownerPool.query('SELECT canonical_commercial_calculate($1,$2,$3) result',[row.value,'USD',row.context])).rows[0].result;result.cases.push({...row,js,sql});assert.deepEqual(sql,js,row.label);for(const[k,v]of Object.entries(row.expected))assert.deepEqual(js[k],v,row.label);}
 const invalid=[['stacked line discount',f=>f.value.adjustments=[adjustment(['a'],{kind:'line_discount'}),adjustment(['a'],{kind:'line_discount',adjustmentId:'second'})]],['over discount',f=>f.value.adjustments=[adjustment(['a'],{amount:'100.01'})]],['overlapping tax',f=>f.value.taxGroups.push(group(['a'],{groupId:'second'}))],['invalid rate',f=>f.value.taxGroups[0].ratePercent='100.01'],['false validation',f=>f.value.taxGroups[0].source.ruleId='false'],['unsupported compound',f=>f.value.taxGroups[0].compound=true],['fixed payment mismatch',f=>f.value.payments={mode:'amount',balanceId:'b',stages:[{stageId:'b',label:'Balance',kind:'balance',value:'1.00'}]}]];
 for(const[label,change]of invalid){const v=fixture();change(v);let js,sql;try{c.calculate(v.value,'USD',v.context);}catch(e){js=e.code;}try{await f.ownerPool.query('SELECT canonical_commercial_calculate($1,$2,$3)',[v.value,'USD',v.context]);}catch(e){sql=e.code;}result.cases.push({label,...v,js,sql});assert.ok(js,label);assert.equal(sql,'22023',label);}
 result.pass=true;
}catch(e){result.error={message:e.message,code:e.code,where:e.where,stack:e.stack};process.exitCode=1;}finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({pass:result.pass,cases:result.cases.length,error:result.error?.message}));}})();
