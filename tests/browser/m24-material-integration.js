"use strict";
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='m24-material-integration-local-only';
for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture'),{resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'=')).slice(n.length+3),engine=arg('browser'),out=path.resolve(arg('output'));assert.ok(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
(async()=>{let f,server,browser;const ledger={engine,cases:[],errors:[]};try{
 f=await createEstimateReviewFixture({recordedLaborHours:2});server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port,rt=resolveBrowserRuntime(engine);browser=await rt.browserType.launch({headless:true,executablePath:rt.executablePath});
 for(const demo of [false,true])for(const [theme,width]of [['light',1440],['dark',1440],['light',390],['dark',390]]){
  const tag=(demo?'demo':'paid')+'-'+theme+'-'+width,c=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  await c.addInitScript(t=>localStorage.setItem('northstar-theme',t),theme);
  if(!demo)await c.addCookies(Object.entries(f.actors.owner.session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));
  const p=await c.newPage();p.on('pageerror',e=>ledger.errors.push(e.message));await p.goto(origin+(demo?'/demo':'/dashboard'));await p.waitForLoadState('networkidle');
  const graph=demo?await p.evaluate(async()=>((await(await fetch('/api/demo/command-center')).json()).data.graphs[0])):f.estimateGraphs[0];
  const prefix=demo?'/demo':'/dashboard';
  const prepared=await p.evaluate(async ({id,demo})=>{
    const route='/api/v1/canonical/estimates/'+id;
    async function read(){const r=await NorthStarAccountSession.fetch(route+'/review');if(!r.ok)throw Error('read '+r.status);return(await r.json()).data;}
    let review=await read();
    async function post(path,body){const headers={'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()};if(demo)headers['X-NorthStar-Demo-Revision']=String(review.demoWorkspaceRevision);const r=await NorthStarAccountSession.fetch(route+path,{method:'POST',headers,body:JSON.stringify(body)}),b=await r.json();if(!r.ok)throw Error(path+' '+r.status+' '+JSON.stringify(b));return b.data;}
    const input={lines:[{lineId:crypto.randomUUID(),material:'Reviewed Boards',quantity:'10',unit:'ft',wastePercent:'10',unitPrice:'3.00',sourceType:'my_estimate',sourceNote:'Owner recorded comparison fixture',priceDate:null,evidence:{kind:'my_estimate',issuer:null,reference:null,effectiveOn:null,validThrough:null,countryCode:null,region:null,locality:null,serviceKey:review.materialSourceContext.serviceKey,materialSpecification:'cedar',statedUnit:'ft',statedCurrency:'USD',statedUnitPrice:'3.00',appliesToReviewedJob:true,exceptionReason:null},availability:{kind:'unknown',issuer:null,reference:null,observedOn:null,validThrough:null,location:null,availableQuantity:null,statedUnit:null,leadTimeDays:null,appliesToReviewedJob:false,exceptionReason:null},replacement:null}],sourceAssessment:null,availabilityAssessment:null};
    const b={action:'save',expectedRevision:review.materialPlans.current?.revision||0,expectedDigest:review.materialPlans.current?.digest||'none',sourcePins:review.pins,expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,inputs:input,currency:review.currency,reason:'Review materials for this local fixture',confirmed:true,confirmationVersion:'estimate-material-plan-v4'};
    const preview=await post('/material-plan-preview',b);input.sourceAssessment=preview.result.sourceAssessment;input.availabilityAssessment=preview.result.availabilityAssessment;await post('/material-plans',b);review=await read();
    const adopt={sourcePins:review.pins,expectedPlanId:review.materialPlans.current.id,expectedPlanRevision:review.materialPlans.current.revision,expectedPlanDigest:review.materialPlans.current.digest,expectedDecisionRevision:review.decisions.writeBasis.revision,expectedDecisionDigest:review.decisions.writeBasis.digest,reason:'Include this saved material plan once',confirmed:true,confirmationVersion:'estimate-material-adoption-v4'};
    await post('/material-adoption-preview',adopt);await post('/material-adoptions',adopt);review=await read();if(review.decisions.current!==null)throw Error('Approval inherited');return {cost:review.financialCosts.knownDirectCosts,pins:review.pins};
  },{id:graph.ids.estimate,demo});
  if(await p.locator('#northstarQuickStartDialog[open]').count())await p.keyboard.press('Escape');
  await p.evaluate(id=>CustomerDetail.open(id),graph.ids.customer);await p.locator('#cdDrawerContent').waitFor({state:'visible'});
  await p.locator('.drawer-polaris-pricing > summary').click();await p.getByRole('button',{name:/^Review Scope And Price$/i}).click();
  await p.locator('#cdDecisionScope').fill('Reviewed job scope and current material plan');await p.locator('#cdDecisionPrice').fill('700.00');await p.locator('#cdDecisionReason').fill('Human review after material adoption');assert.equal(await p.locator('#cdDecisionConfirm').isChecked(),false);await p.locator('#cdDecisionConfirm').check();await p.getByRole('button',{name:/^Approve For Quote Preparation$/i}).click();
  await p.getByRole('button',{name:/^Revise Scope And Price$/i}).waitFor();
  const cents=70000n-BigInt(prepared.cost.replace('.','')),expected=(cents/100n)+'.'+String(cents%100n).padStart(2,'0');
  assert.notEqual(prepared.cost,null);
  assert.match(await p.locator('#cdCapellaReview').innerText(),new RegExp(expected.replace('-','').replace('.','\\.')));
  await p.locator('#cdCapellaReview').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,tag+'-renewed-capella.png')});
  await p.evaluate(async ({id,demo})=>{
    const route='/api/v1/canonical/estimates/'+id;let r=(await(await NorthStarAccountSession.fetch(route+'/review')).json()).data;
    const inputs=structuredClone(r.materialPlans.current.inputs);inputs.lines[0].unitPrice='4.00';inputs.lines[0].evidence.statedUnitPrice='4.00';inputs.sourceAssessment=null;inputs.availabilityAssessment=null;
    const b={action:'save',expectedRevision:r.materialPlans.current.revision,expectedDigest:r.materialPlans.current.digest,sourcePins:r.pins,expectedDecisionRevision:r.decisions.writeBasis.revision,expectedDecisionDigest:r.decisions.writeBasis.digest,inputs,currency:r.currency,reason:'Separate later plan, deliberately not adopted',confirmed:true,confirmationVersion:'estimate-material-plan-v4'};
    const headers={'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()};if(demo)headers['X-NorthStar-Demo-Revision']=String(r.demoWorkspaceRevision);
    const preview=await NorthStarAccountSession.fetch(route+'/material-plan-preview',{method:'POST',headers,body:JSON.stringify(b)});if(!preview.ok)throw Error('later preview '+preview.status);const result=(await preview.json()).data.result;inputs.sourceAssessment=result.sourceAssessment;inputs.availabilityAssessment=result.availabilityAssessment;
    headers['Idempotency-Key']=crypto.randomUUID();const saved=await NorthStarAccountSession.fetch(route+'/material-plans',{method:'POST',headers,body:JSON.stringify(b)});if(!saved.ok)throw Error('later save '+saved.status);
  },{id:graph.ids.estimate,demo});
  await p.goto(origin+prefix+'/polaris?kind=customer&id='+graph.ids.customer);await p.waitForLoadState('networkidle');
  await p.locator('#polarisMaterialSection').waitFor({state:'visible',timeout:15000});
  await p.locator('#polarisMaterialDetails > summary').focus();await p.keyboard.press('Enter');
  await p.locator('#polarisMaterialStatus').getByText('Saved Material Review Loaded',{exact:true}).waitFor();
  const first=await p.locator('#polarisMaterialBody').innerText();assert.match(first,/Included Material Cost/);assert.match(first,/USD 33.00/);assert.match(first,/Latest Saved Plan/);assert.match(first,/USD 44.00/);assert.match(first,new RegExp(expected.replace('.','\\.')));
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.locator('#polarisMaterialSection').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,tag+'-original.png')});
  const mutations=[];p.on('request',r=>{if(r.method()==='POST'&&!r.url().endsWith('/assistant/context'))mutations.push(r.url());});
  await p.locator('#polarisMaterialRefresh').click();await p.locator('#polarisMaterialStatus').getByText('Saved Material Review Loaded',{exact:true}).waitFor();
  assert.equal(await p.locator('#polarisMaterialBody').innerText(),first);assert.deepEqual(mutations,[]);
  await p.locator('#polarisMaterialRevision').selectOption('1');await p.locator('#polarisMaterialStatus').getByText('Saved Material Review Loaded',{exact:true}).waitFor();assert.match(await p.locator('#polarisMaterialBody').innerText(),/Earlier Review/);
  await p.locator('#polarisMaterialRevision').selectOption('');await p.locator('#polarisMaterialStatus').getByText('Saved Material Review Loaded',{exact:true}).waitFor();
  for(const status of [401,403,503]){await p.route('**/estimates/*/review',r=>r.fulfill({status,contentType:'application/json',body:JSON.stringify({success:false,error:{message:'untrusted diagnostic'}})}));await p.locator('#polarisMaterialRefresh').click();await p.waitForFunction(()=>!document.getElementById('polarisMaterialStatus').textContent.startsWith('Loading'));assert.equal(await p.locator('#polarisMaterialBody').innerText(),'');assert.doesNotMatch(await p.locator('#polarisMaterialStatus').innerText(),/untrusted/);await p.screenshot({path:path.join(out,tag+'-error-'+status+'.png')});await p.unroute('**/estimates/*/review');}
  await p.locator('#polarisPromptInput').fill('Show saved material costs');await p.locator('#polarisSendBtn').click();await p.locator('#polarisMaterialStatus').getByText('Saved Material Review Loaded',{exact:true}).waitFor();assert.match(await p.locator('#polarisMaterialBody').innerText(),new RegExp(expected.replace('.','\\.')));assert.deepEqual(mutations,[]);
  const other=demo?await p.evaluate(async()=>((await(await fetch('/api/demo/command-center')).json()).data.graphs[1])):f.estimateGraphs[1];
  let release;const hold=new Promise(r=>release=r);let intercepted;const seen=new Promise(r=>intercepted=r);let handled;const finished=new Promise(r=>handled=r);
  await p.route('**/estimates/'+graph.ids.estimate+'/review',async r=>{intercepted();await hold;await r.continue();handled();});
  await p.locator('#polarisMaterialRefresh').click();await seen;assert.match(await p.locator('#polarisMaterialStatus').innerText(),/^Loading/);assert.equal(await p.locator('#polarisMaterialBody').innerText(),'');
  await p.evaluate(id=>{history.pushState({},'',location.pathname+'?kind=customer&id='+id);dispatchEvent(new PopStateEvent('popstate'));},other.ids.customer);
  release();await finished;await p.unroute('**/estimates/'+graph.ids.estimate+'/review');await p.waitForLoadState('networkidle');
  assert.equal(await p.locator('#polarisMaterialBody').innerText(),'');
  await p.locator('#polarisMaterialRefresh').click();await p.locator('#polarisMaterialStatus').getByText('Saved Material Review Loaded',{exact:true}).waitFor();assert.doesNotMatch(await p.locator('#polarisMaterialBody').innerText(),/USD 33.00/);
  assert.deepEqual(mutations,[]);
  ledger.cases.push(tag+' actual v4 save/adoption plus renewed human approval; drawer/Polaris exact comparison and keyboard open/refresh with zero read POSTs');await c.close();
 }
 assert.deepEqual(ledger.errors,[]);ledger.pass=true;
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(f)await f.cleanup();fs.writeFileSync(path.join(out,'ledger.json'),JSON.stringify(ledger,null,2));}})().catch(e=>{console.error(e);process.exitCode=1;});
