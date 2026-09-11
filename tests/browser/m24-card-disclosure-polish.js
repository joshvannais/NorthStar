'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='m24-card-polish-disposable-only-secret';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[key];
const {createEstimateReviewFixture}=require('../helpers/m24-estimate-review-fixture'),{resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const option=n=>(process.argv.find(v=>v.startsWith('--'+n+'='))||'').split('=').slice(1).join('=');
const output=path.resolve(option('output')),engine=option('browser');assert.ok(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
async function capture(page,name){
 const saved=await page.evaluate(()=>['cdCustomerDrawer','cdDrawerBody'].map(id=>{const e=document.getElementById(id),style=e.getAttribute('style');for(const [key,value] of Object.entries({height:'auto','max-height':'none',overflow:'visible',position:'relative',top:'0',left:'0',right:'auto',bottom:'auto',transform:'none',margin:'0'}))e.style.setProperty(key,value,'important');e.scrollTop=0;return style;}));
 await page.locator('#cdCustomerDrawer').screenshot({path:path.join(output,name+'.png')});
 await page.evaluate(saved=>['cdCustomerDrawer','cdDrawerBody'].forEach((id,i)=>{const e=document.getElementById(id);if(saved[i]===null)e.removeAttribute('style');else e.setAttribute('style',saved[i]);}),saved);
}
(async()=>{let f,server,browser;const ledger={engine,cases:[],styles:[],errors:[]};try{
 f=await createEstimateReviewFixture();server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port,rt=resolveBrowserRuntime(engine);browser=await rt.browserType.launch({headless:true,executablePath:rt.executablePath});ledger.version=browser.version();
 for(const demo of [false,true])for(const [theme,width] of [['light',1440],['dark',1440],['light',390],['dark',390]]){
  const tag=(demo?'demo':'paid')+'-'+theme+'-'+width,c=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});
  if(!demo)await c.addCookies(Object.entries(f.actors.owner.session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));
  await c.addInitScript(t=>localStorage.setItem('northstar-theme',t),theme);const p=await c.newPage();let privateCalls=0;p.on('pageerror',e=>ledger.errors.push(e.message));p.on('request',r=>{if(demo&&r.url().includes('/api/v1/canonical/'))privateCalls++;});
  await p.goto(origin+(demo?'/demo':'/dashboard'));await p.waitForLoadState('networkidle');if(await p.locator('#northstarQuickStartDialog[open]').count())await p.keyboard.press('Escape');
  const before=demo?(await(await c.request.get(origin+'/api/demo/command-center')).json()).data:null;
  if(demo)await p.getByRole('button',{name:before.graphs[0].customer.name,exact:true}).first().click();else await p.evaluate(id=>CustomerDetail.open(id),f.estimateGraphs[0].ids.customer);
  await p.locator('#cdDrawerContent').waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('#cdEstimateReviewRefresh').disabled);
  await require('../helpers/m24-drawer-hierarchy').assertDrawerHierarchy(p,tag);
  const state=await p.evaluate(()=>{const q=s=>document.querySelector(s),rect=e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height});const selectors=['.drawer-polaris-analysis','.drawer-polaris-pricing','#cdTravelDetails','#cdChargeDetails','#cdExecutionSection','#cdTranscriptDisclosure','.drawer-customer-background'];return{
   order:q('.drawer-polaris-analysis').nextElementSibling===q('.drawer-polaris-pricing')&&q('.drawer-polaris-pricing').nextElementSibling===q('#cdTravelDetails'),
   title:q('#cdCapellaTitle').textContent,stars:q('.capella-four-star').children.length,mark:rect(q('.capella-four-star')),polaris:rect(q('#cdPolarisInsight > h3 .polaris-inline-star')),
   shape:[...q('.capella-four-star').children].map(e=>{const s=getComputedStyle(e,'::before');return{clip:s.clipPath,color:s.backgroundColor};}),originalShape:{clip:getComputedStyle(q('#cdPolarisInsight > h3 .polaris-inline-star'),'::before').clipPath,color:getComputedStyle(q('#cdPolarisInsight > h3 .polaris-inline-star'),'::before').backgroundColor},
   summaries:selectors.map(selector=>{const e=q(selector+' > summary'),s=getComputedStyle(e);return{selector,fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,padding:s.padding,margin:s.margin,listStyle:s.listStyleType};}),
   pricingBorder:getComputedStyle(q('.drawer-polaris-pricing')).borderRightWidth,
   workTag:q('#cdExecutionSection').tagName,workOpen:q('#cdExecutionSection').open,duplicate:q('#cdExecutionRecords').querySelector('h4')!==null
  };});
  assert.ok(state.order);assert.equal(state.title,'CAPELLA™ Risk Lens');assert.equal(state.stars,4);assert.deepEqual(state.mark,state.polaris);for(const star of state.shape)assert.deepEqual(star,state.originalShape);
  const base=state.summaries[0];for(const summary of state.summaries)for(const key of ['fontFamily','fontSize','fontWeight','lineHeight','padding','margin'])assert.equal(summary[key],base[key],tag+' '+summary.selector+' '+key);
  assert.equal(state.pricingBorder,'0px');assert.equal(state.workTag,'DETAILS');assert.equal(state.workOpen,false);assert.equal(state.duplicate,false);ledger.styles.push({tag,...state});
  await capture(p,tag+'-default-full');
  for(const selector of ['.drawer-polaris-pricing','#cdTravelDetails','#cdChargeDetails','#cdExecutionSection','#cdTranscriptDisclosure','.drawer-customer-background']){const summary=p.locator(selector+' > summary');await summary.focus();await p.keyboard.press('Enter');assert.equal(await p.locator(selector).evaluate(e=>e.open),true);assert.equal(await summary.evaluate(e=>e===document.activeElement),true);await p.keyboard.press('Enter');assert.equal(await p.locator(selector).evaluate(e=>e.open),false);}
  await p.locator('#cdExecutionSection > summary').click();const record=p.locator('#cdExecutionRecords .execution-link').first();assert.ok(await record.count());assert.notEqual(await record.locator('summary').innerText(),'Work details');await record.locator('summary').focus();await p.keyboard.press('Enter');await record.locator('.execution-link-content').waitFor({state:'visible'});assert.ok((await record.locator('.execution-link-content').innerText()).trim());
  await p.locator('.drawer-polaris-pricing > summary').click();assert.ok(await p.locator('#cdEstimateReviewRefresh').isVisible());await p.locator('#cdCapellaRefresh').click();await p.waitForFunction(()=>!document.querySelector('#cdCapellaRefresh').disabled);assert.equal(await p.locator('#cdCapellaTitle').innerText(),'CAPELLA™ Risk Lens');
  await capture(p,tag+'-expanded-full');assert.equal(privateCalls,0);
  if(demo){const after=(await(await c.request.get(origin+'/api/demo/command-center')).json()).data;assert.deepEqual(after.graphs,before.graphs);assert.equal(after.integrity.revision,before.integrity.revision);}
  ledger.cases.push(tag+' exact shared star geometry, disclosure order/computed typography, keyboard toggles, work record access, review refresh, preserved source state');await c.close();
 }
 assert.deepEqual(ledger.errors,[]);ledger.pass=true;
}catch(error){ledger.failure={message:error.message,stack:error.stack};throw error;}finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(f)await f.cleanup();fs.writeFileSync(path.join(output,'RESULT.json'),JSON.stringify(ledger,null,2));}console.log(JSON.stringify({engine,cases:ledger.cases.length,pass:ledger.pass}));})().catch(e=>{console.error(e);process.exitCode=1;});
