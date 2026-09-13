'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='policy-local-disposable-secret-at-least-thirty-two';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture'),c=require('../../src/estimating/pricingPolicyCalculation');
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);assert.ok(output&&!fs.existsSync(output));
const input=()=>({serviceKey:'fence',method:'markup',percent:'25.00',contingency:{method:'fixed',amount:'20.00',percent:null,coverage:{status:'declared_separate',explanation:'Additional uncertainty only'}},minimum:{method:'none',amount:null},source:{kind:'owner_estimate',referenceId:null,digest:null,note:'',effectiveOn:null,endsOn:null}});
const basis=()=>({directCosts:'1000.00',overhead:{gross:'100.00',alreadyIncluded:'30.00',incremental:'70.00',overlapResolved:true},proposedBeforeTax:'1400.00',reviewedPrice:'1600.00'});
(async()=>{let f;const result={cases:[],pass:false};try{f=await createEstimateReviewFixture();const cases=[];function add(label,change,expected){let i=input(),b=basis();change(i,b);cases.push({label,i,b,expected});}
add('gross less included, markup',()=>{},{threshold:'1362.50'});
add('equivalent margin20',(i)=>{i.method='target_margin';i.percent='20.00';},{threshold:'1362.50'});
add('margin upward cent',(i,b)=>{i.method='target_margin';i.percent='25.00';i.contingency.method='none';i.contingency.amount=null;b.directCosts='30.00';},{threshold:'133.34'});
add('maximum not addition',(i,b)=>{i.contingency.method='none';i.contingency.amount=null;b.directCosts='30.00';i.minimum={method:'fixed',amount:'150.00'};b.proposedBeforeTax='140.00';b.reviewedPrice='160.00';},{threshold:'150.00',floorIncrease:'25.00'});
add('zero denominators',(i,b)=>{i.percent='0.00';i.contingency.method='none';i.contingency.amount=null;b.directCosts='0.00';b.overhead={gross:'0.00',alreadyIncluded:'0.00',incremental:'0.00',overlapResolved:true};b.proposedBeforeTax='0.00';b.reviewedPrice='10.00';},{threshold:'0.00'});
add('half cent allowance',(i,b)=>{i.contingency.method='percent';i.contingency.amount=null;i.contingency.percent='50.00';b.directCosts='0.01';b.overhead={gross:'0.00',alreadyIncluded:'0.00',incremental:'0.00',overlapResolved:true};},{allowance:'0.01',policyCost:'0.02'});
add('missing costs and known floor',(i,b)=>{b.directCosts=null;i.minimum={method:'fixed',amount:'150.00'};},{threshold:null,policyCost:null});
add('unresolved contingency',(i)=>{i.contingency.coverage={status:'unknown',explanation:''};},{policyCost:null});
add('unresolved overhead',(i,b)=>{b.overhead.incremental=null;b.overhead.overlapResolved=false;},{policyCost:null});
add('negative ties',(i,b)=>{i.contingency.method='none';i.contingency.amount=null;b.directCosts='19999930.00';b.proposedBeforeTax='19999999.99';b.reviewedPrice='0.00';},{policyCost:'20000000.00'});
for(const row of cases){const js=c.calculate(row.i,'USD',row.b),sql=(await f.ownerPool.query('SELECT canonical_pricing_policy_calculate($1,$2,$3) result',[row.i,'USD',row.b])).rows[0].result;result.cases.push({...row,js,sql});assert.deepEqual(sql,js,row.label);for(const[k,v]of Object.entries(row.expected))assert.deepEqual(js[k],v,row.label);}
assert.deepEqual(c.ratio(-1n,2000000n),{value:'-0.0001',approximate:true});assert.deepEqual((await f.ownerPool.query('SELECT canonical_pricing_policy_ratio(-1,2000000) result')).rows[0].result,c.ratio(-1n,2000000n));
const invalid=[['margin100',i=>{i.method='target_margin';i.percent='100.00';}],['markup bound',i=>i.percent='1000.01'],['precision',i=>i.percent='1.001'],['negative',i=>i.percent='-1.00'],['allowance overlap label',i=>i.contingency.coverage.status='verified'],['overflow',(i,b)=>{b.directCosts='999999999999.99';}],['unknown method with rate',i=>i.method='unknown']];
for(const[label,change]of invalid){const i=input(),b=basis();change(i,b);let j,s;try{c.calculate(i,'USD',b);}catch(e){j=e.code;}try{await f.ownerPool.query('SELECT canonical_pricing_policy_calculate($1,$2,$3)',[i,'USD',b]);}catch(e){s=e.code;}result.cases.push({label,i,b,j,s});assert.ok(j,label);assert.equal(s,'22023',label);}
result.pass=true;}catch(e){result.error={message:e.message,code:e.code,where:e.where,stack:e.stack};process.exitCode=1;}finally{if(f)await f.cleanup();fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({pass:result.pass,cases:result.cases.length,error:result.error?.message}));}})();
