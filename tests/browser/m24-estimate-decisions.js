'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {resolveBrowserRuntime}=require('../helpers/playwright-runtime');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='m24-decision-disposable-demo-test-secret-only';for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[k];
const demoRepository=require('../../src/commandCenter/demoRepository');
const originalMutation=demoRepository.DemoCommandCenterRepository.prototype.mutate;
demoRepository.DemoCommandCenterRepository.prototype.mutate=async function(...args){try{return await originalMutation.apply(this,args);}catch(error){console.error('Synthetic demo test mutation:',error);throw error;}};
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture');
const option=(n)=>(process.argv.find(v=>v.startsWith('--'+n+'='))||'').split('=').slice(1).join('=');
const output=path.resolve(option('output')),engine=option('browser');assert.ok(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
(async()=>{let f,server,browser;const ledger={engine,cases:[],errors:[]};try{
 f=await createEstimateReviewFixture();server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 const runtime=resolveBrowserRuntime(engine);browser=await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath});ledger.version=browser.version();
 for(const demo of [false,true])for(const [theme,width] of [['light',1440],['dark',390]]){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
 if(!demo)await context.addCookies(Object.entries(f.actors.owner.session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));
 await context.addInitScript(t=>{localStorage.setItem('northstar-theme',t);localStorage.setItem('northstar-quick-start-seen','true');},theme);
 const page=await context.newPage();let privateCalls=0;page.on('pageerror',e=>ledger.errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/v1/canonical/estimates/'))privateCalls++;});
 await page.goto(origin+(demo?'/demo':'/dashboard'));await page.waitForFunction(()=>window.CustomerDetail&&window.NorthStarAccountSession);await page.waitForLoadState('networkidle');if(await page.locator('#northstarQuickStartDialog[open]').count())await page.keyboard.press('Escape');
 const customer=demo?await page.evaluate(async()=>{const r=await fetch('/api/demo/command-center');return(await r.json()).data.graphs[0].ids.customer;}):f.estimateGraphs[0].ids.customer;
 await page.evaluate(id=>CustomerDetail.open(id),customer);await page.locator('#cdDrawerContent').waitFor({state:'visible'});await page.locator('.drawer-polaris-pricing > summary').click();await page.getByRole('button',{name:'Review scope and price',exact:true}).waitFor();
 const root=page.locator('#cdEstimateDecision'),area=page.locator('#cdEstimateReview').locator('..');const name=(demo?'demo':'paid')+'-'+theme+'-'+width;
 await page.getByRole('button',{name:'Review scope and price',exact:true}).focus();await page.keyboard.press('Enter');await page.locator('#cdDecisionScope').fill('Replace the agreed fence after inspection.');await page.locator('#cdDecisionPrice').fill('1e2');assert.equal(await page.locator('#cdDecisionPrice').evaluate(e=>e.checkValidity()),false);await page.locator('#cdDecisionPrice').fill('0.00');await page.locator('#cdDecisionReason').fill('Confirmed scope and a no-charge customer repair.');await page.locator('#cdDecisionConfirm').check();
 await area.screenshot({path:path.join(output,name+'-form.png')});await page.getByRole('button',{name:'Approve for quote preparation',exact:true}).click();await page.getByText('Human-reviewed price before tax: USD 0.00',{exact:true}).waitFor();ledger.cases.push(name+' keyboard form validates exact decimal then saves zero');
 await page.getByRole('button',{name:'Revise scope and price',exact:true}).click();assert.equal(await page.locator('#cdDecisionPrice').inputValue(),'0.00');await page.locator('#cdDecisionPrice').fill('1400.25');await page.locator('#cdDecisionReason').fill('Customer requested a larger reviewed scope.');await page.locator('#cdDecisionConfirm').check();await page.getByRole('button',{name:'Approve for quote preparation',exact:true}).click();await page.getByText('Human-reviewed price before tax: USD 1,400.25',{exact:true}).waitFor();
 await root.locator('summary').click();await area.screenshot({path:path.join(output,name+'-approved-history.png')});assert.ok((await root.innerText()).includes('USD 0.00'));assert.ok(!(await root.innerText()).match(/PostgreSQL|SQL|digest|canonical|\uFFFD|NaN|Infinity/));ledger.cases.push(name+' revise retains previous human decision and plain history');
 await page.getByRole('button',{name:'Withdraw approval',exact:true}).click();await page.locator('#cdDecisionReason').fill('Job scope needs another customer discussion.');await page.locator('#cdDecisionConfirm').check();await page.getByRole('button',{name:'Confirm withdrawal',exact:true}).click();await page.getByText('The approval was withdrawn.',{exact:false}).waitFor();await root.locator('summary').click();await area.screenshot({path:path.join(output,name+'-withdrawn.png')});
 await page.locator('#cdEstimateReviewRefresh').click();await page.getByText('The approval was withdrawn.',{exact:false}).waitFor();ledger.cases.push(name+' withdrawal and reload preserve history without current approval');
 await page.getByRole('button',{name:'Review scope and price',exact:true}).click();await page.locator('#cdDecisionPrice').fill('-1');await root.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('#cdDecisionForm').count(),0);ledger.cases.push(name+' invalid draft cancel works');
 if(demo){assert.equal(privateCalls,0);ledger.cases.push(name+' same renderer synthetic mutations never call private estimate endpoint');}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);await context.close();
 }
 ledger.pass=true;
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(f)await f.cleanup();fs.writeFileSync(path.join(output,'ledger.json'),JSON.stringify(ledger,null,2));}})().catch(e=>{console.error(e);process.exitCode=1;});
