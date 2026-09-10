'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='m24-description-local-disposable-secret';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[key];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture'),{resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const option=n=>(process.argv.find(v=>v.startsWith('--'+n+'='))||'').split('=').slice(1).join('=');
const output=path.resolve(option('output')),engine=option('browser');assert.ok(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
(async()=>{let fixture,server,browser;const ledger={engine,cases:[],errors:[]};try{
 fixture=await createEstimateReviewFixture();server=fixture.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port,rt=resolveBrowserRuntime(engine);browser=await rt.browserType.launch({headless:true,executablePath:rt.executablePath});ledger.version=browser.version();
 const remaining=new Set(['hvac','concrete']);
 for(let attempt=0;attempt<16&&remaining.size;attempt++){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>ledger.errors.push(e.message));await page.goto(origin+'/demo');await page.waitForLoadState('networkidle');if(await page.locator('#northstarQuickStartDialog[open]').count())await page.keyboard.press('Escape');
  const graphs=await page.evaluate(async()=>{const response=await fetch('/api/demo/command-center');return(await response.json()).data.graphs;});
  for(const graph of graphs){const key=graph.polaris.snapshot.service.key;if(!remaining.has(key))continue;const scope=graph.polaris.snapshot.service.scope;
   for(const [theme,width] of [['dark',390],['light',390],['dark',1440],['light',1440]]){
    await page.evaluate(theme=>localStorage.setItem('northstar-theme',theme),theme);await page.setViewportSize({width,height:1000});await page.goto(origin+'/demo');await page.waitForLoadState('networkidle');await page.getByRole('button',{name:graph.customer.name,exact:true}).first().click();await page.locator('#cdDrawerContent').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#cdEstimateReviewRefresh').disabled);
    await require('../helpers/m24-drawer-hierarchy').assertDrawerHierarchy(page,key+' '+theme+' '+width);
    const description=await page.locator('#cdJobDescription').innerText(),facts=await page.locator('#cdDescription').innerText();assert.ok(description.length>graph.lead.serviceLabel.length);assert.doesNotMatch(description,/;|undefined|\[object Object\]/);
    if(key==='hvac'){assert.ok(description.includes(scope.systemType));assert.match(facts,/SEER\s+16/);assert.match(facts,/Area\s+2100 square feet/);assert.match(facts,/Cooling capacity\s+3 tons/);}
    if(key==='concrete'){assert.ok(description.includes(scope.finish));assert.match(facts,/Area\s+720 square feet/);const finish=await page.locator('#cdDescription li').filter({has:page.locator('.drawer-fact-label',{hasText:/^finish$/i})}).locator('.drawer-fact-value').evaluate(e=>({text:e.textContent,transform:getComputedStyle(e).textTransform}));assert.equal(finish.text,'broom');assert.equal(finish.transform,'capitalize');}
    await page.addStyleTag({content:'#cdCustomerDrawer{position:absolute!important;top:16px!important;bottom:auto!important;left:50%!important;transform:translateX(-50%)!important;height:auto!important;max-height:none!important;}#cdDrawerBody{height:auto!important;max-height:none!important;overflow:visible!important;}'});await page.setViewportSize({width,height:Math.ceil(await page.locator('#cdCustomerDrawer').evaluate(e=>e.scrollHeight))+32});await page.locator('#cdCustomerDrawer').screenshot({path:path.join(output,key+'-'+theme+'-'+width+'-full.png')});ledger.cases.push({key,theme,width,description,scope});
   }remaining.delete(key);
  }await context.close();
 }
 assert.equal(remaining.size,0,'Ordinary generated demo workspaces must provide both targeted services within bounded sampling');assert.deepEqual(ledger.errors,[]);ledger.pass=true;
}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(fixture)await fixture.cleanup();fs.writeFileSync(path.join(output,'ledger.json'),JSON.stringify(ledger,null,2));}})().catch(error=>{console.error(error);process.exitCode=1;});
