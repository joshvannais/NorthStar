'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {resolveBrowserRuntime}=require('../helpers/playwright-runtime');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='m24-capella-disposable-demo-test-secret-only';for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');
const option=n=>(process.argv.find(v=>v.startsWith('--'+n+'='))||'').split('=').slice(1).join('=');
const output=path.resolve(option('output')),engine=option('browser');assert.ok(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
(async()=>{let f,server,browser;const ledger={engine,cases:[],pageErrors:[]};try{
 f=await createEstimateReviewFixture({recordedLaborHours:2});server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 const runtime=resolveBrowserRuntime(engine);browser=await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath});ledger.version=browser.version();
 for(const demo of [false,true])for(const [theme,width] of [['light',1440],['dark',1440],['light',390],['dark',390]]){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
 if(!demo)await context.addCookies(Object.entries(f.actors.owner.session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));
 await context.addInitScript(t=>{localStorage.setItem('northstar-theme',t);localStorage.setItem('northstar-quick-start-seen','true');},theme);
 const page=await context.newPage();let privateCalls=0;page.on('pageerror',e=>ledger.pageErrors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/v1/canonical/estimates/'))privateCalls++;});
 await page.goto(origin+(demo?'/demo':'/dashboard'));await page.waitForFunction(()=>window.CustomerDetail&&window.NorthStarAccountSession);await page.waitForLoadState('networkidle');if(await page.locator('#northstarQuickStartDialog[open]').count())await page.keyboard.press('Escape');
 const customer=demo?await page.evaluate(async()=>{const r=await fetch('/api/demo/command-center');return(await r.json()).data.graphs[0].ids.customer;}):f.estimateGraphs[0].ids.customer;
 if(demo){const customerName=await page.evaluate(async id=>{const response=await fetch('/api/demo/command-center');return(await response.json()).data.graphs.find(g=>g.ids.customer===id).customer.name;},customer);await page.getByRole('button',{name:customerName,exact:true}).first().click();}else await page.evaluate(id=>CustomerDetail.open(id),customer);await page.locator('#cdDrawerContent').waitFor({state:'visible'});await page.locator('.drawer-polaris-pricing > summary').focus();await page.keyboard.press('Enter');
 const card=page.locator('#cdMaterialReview'),name=(demo?'demo':'paid')+'-'+theme+'-'+width;
 await card.waitFor();await card.locator('summary').focus();await page.keyboard.press('Enter');assert.equal(await card.evaluate(e=>e.open),true);
 await card.getByText('Recorded material cost: '+(demo?'USD 500.00':'USD 12,000.00'),{exact:true}).waitFor();
 const capture=async suffix=>{await card.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,name+'-'+suffix+'.png')});assert.doesNotMatch(await card.innerText(),/PostgreSQL|SQL|digest|canonical|\uFFFD|NaN|Infinity/);assert.equal(await card.evaluate(e=>e.scrollWidth>e.clientWidth),false);};
 await capture('recorded');ledger.cases.push(name+' real shared material basis, exact amount, keyboard and wording');
 if(demo){await page.keyboard.press('Escape');const second=await page.evaluate(async()=>{const r=await fetch('/api/demo/command-center');return(await r.json()).data.graphs[1].customer.name;});await page.getByRole('button',{name:second,exact:true}).first().click();if(!await page.locator('.drawer-polaris-pricing').evaluate(e=>e.open))await page.locator('.drawer-polaris-pricing > summary').click();await card.locator('summary').click();await card.getByText('Recorded material cost: Unavailable',{exact:true}).waitFor();await capture('missing');assert.equal(privateCalls,0);ledger.cases.push(name+' ordinary missing peer and private endpoint isolation');}
 else if(width===1440&&theme==='light'){
  const route='**/api/v1/canonical/estimates/*/review';
  await page.route(route,async route=>{const response=await route.fetch(),body=await response.json();body.data.materialReview.sourcePins={...body.data.materialReview.sourcePins,estimateId:'different'};await route.fulfill({response,json:body});});
  await page.getByRole('button',{name:'Refresh estimate review',exact:true}).click();await card.locator('summary').click();await card.getByText('Material information is unavailable. Refresh this estimate to try again.',{exact:true}).waitFor();await capture('mismatched');await page.unroute(route);ledger.cases.push('material response source mismatch is rejected by actual renderer');
  for(const status of [401,403,503]){await page.route(route,r=>r.fulfill({status,json:{success:false}}));await page.getByRole('button',{name:'Refresh estimate review',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#cdEstimateReviewRefresh').disabled);assert.equal(await card.count(),0);await page.screenshot({path:path.join(output,name+'-error-'+status+'.png')});await page.unroute(route);}ledger.cases.push('known review errors clear old material disclosure and preserve actionable status');
  let release;const held=new Promise(r=>release=r);await page.route(route,async r=>{await held;await r.continue();});await page.getByRole('button',{name:'Refresh estimate review',exact:true}).click();await page.getByText('Loading estimate review.',{exact:true}).waitFor();assert.equal(await card.count(),0);await page.screenshot({path:path.join(output,name+'-loading.png')});release();await card.waitFor();await page.unroute(route);ledger.cases.push('loading clears previous amounts');
 }
 await context.close();
 }
 assert.deepEqual(ledger.pageErrors,[]);ledger.pass=true;
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(f)await f.cleanup();fs.writeFileSync(path.join(output,'ledger.json'),JSON.stringify(ledger,null,2));}})().catch(e=>{console.error(e);process.exitCode=1;});
