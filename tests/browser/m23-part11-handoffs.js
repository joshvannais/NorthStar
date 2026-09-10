'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const option=(key,fallback)=>(process.argv.find(v=>v.startsWith('--'+key+'='))||'--'+key+'='+fallback).split('=').slice(1).join('=');
process.chdir(path.resolve(__dirname,'../..'));process.env.NODE_ENV='test';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','POLARIS_OPENAI_ENABLED','RETELL_API_KEY','STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS'])delete process.env[key];
async function main(){
 const output=path.resolve(option('output','')),selected=option('browser','chrome');
 assert.ok(process.argv.some(v=>v.startsWith('--output='))&&!fs.existsSync(output),'New output directory required');fs.mkdirSync(output,{recursive:true});
 const ledger={browser:selected,cases:[],pageErrors:[],providerAttempts:0,externalBlocked:[],authority:'Mounted production HTTP and PostgreSQL 18.4 UTC; synthetic records',
  limitations:'Actual WebKit is not physical Safari. Reflow viewports are not native zoom. No manual assistive technology, provider, production, or founder personal visual evidence.'};
 let fixture,server,browser,activePage;
 const https=require('node:https'),oldRequest=https.request,oldGet=https.get,oldFetch=globalThis.fetch;
 const deny=()=>{ledger.providerAttempts++;throw new Error('Provider transport forbidden');};https.request=deny;https.get=deny;globalThis.fetch=deny;
 try{
  fixture=await require('../helpers/m23-part9b-overview-fixture').createDatabaseFixture({operationalSchedule:true});
  const work=await fixture.createExecution({approvedScheduling:true,title:'Kitchen sink repair',start:new Date(Date.now()+60000).toISOString()});
  server=fixture.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port,runtime=resolveBrowserRuntime(selected);
  browser=await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath});ledger.version=browser.version();
    await require('../helpers/m23-user-wording').observeUserWording(browser);
  const profiles=[{name:'1440',width:1440,height:1000},{name:'1280',width:1280,height:720},{name:'768',width:768,height:1024},
   {name:'430',width:430,height:932},{name:'390',width:390,height:844},{name:'320',width:320,height:760},
   {name:'reflow200',width:720,height:500},{name:'reflow400',width:360,height:350}].filter(p=>option('profile','all')==='all'||p.name===option('profile'));
  for(const theme of ['light','dark'])for(const profile of profiles){
   const label=theme+'-'+profile.name,actor=profile.name==='768'?'admin':'owner';
   const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},hasTouch:profile.width<=430,reducedMotion:'reduce'});
   await context.addInitScript(value=>localStorage.setItem('northstar-theme',value),theme);
   await context.addCookies(Object.entries(fixture.actors[actor].session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));
   const page=await context.newPage();activePage=page;page.on('pageerror',e=>ledger.pageErrors.push({label,message:e.message}));
   await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){ledger.externalBlocked.push(route.request().url());return route.abort();}return route.continue();});
   await page.goto(origin+'/dashboard/completion-review?executionId='+work.execution.id);
   const panel=page.locator('#downstreamHandoffs'),summary=panel.locator(':scope > summary');await summary.waitFor();await summary.focus();await page.keyboard.press('Enter');
   await panel.getByText('Current work records are ready for review.',{exact:true}).waitFor();
   const explanation=panel.locator('.handoff-explanation');
   assert.equal(await explanation.getAttribute('open'),null);
   await explanation.locator('summary').focus();await page.keyboard.press('Enter');
   assert(await explanation.locator('.handoff-notice').isVisible());
   await page.keyboard.press('Enter');
   const spacing=await page.evaluate(()=>{const gap=(a,b)=>document.querySelector(b).getBoundingClientRect().top-document.querySelector(a).getBoundingClientRect().bottom;return {timestamp:gap('#completionStatus','#completionSnapshot'),decision:gap('#completionAvailability','#completionActions'),refresh:gap('.handoff-status','#downstreamHandoffs > .completion-actions'),logo:document.querySelector('.completion-brand img').getAttribute('src'),gradient:getComputedStyle(document.querySelector('.oi-panel')).backgroundImage};});
   assert(spacing.timestamp>=15 && spacing.decision>=15 && spacing.refresh>=15,JSON.stringify(spacing));
   assert.equal(spacing.logo,'/assets/logo.png');assert.match(spacing.gradient,/linear-gradient/);
   ledger.cases.push({label:label+'-visual-spacing-disclosure',...spacing,passed:true});
   assert.equal(await panel.locator('option:disabled').textContent(),'Interactive experience — practice work only');
   assert.equal(await panel.locator('#handoffConsent').isChecked(),false);
   await panel.locator('#handoffMission').selectOption('25');await panel.locator('#handoffConsent').check();await panel.locator('#handoffMission').selectOption('24');
   assert.equal(await panel.locator('#handoffConsent').isChecked(),false,'purpose changes require fresh consent');
   const geometry=await page.evaluate(()=>{const panel=document.getElementById('downstreamHandoffs');const shown=e=>e.getClientRects().length>0;
    return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,clipped:[...panel.querySelectorAll('button,select,input,p,dt,dd')].filter(shown).filter(e=>{const r=e.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1;}).map(e=>e.tagName),
     unnamed:[...panel.querySelectorAll('button,select,input')].filter(shown).filter(e=>!e.textContent.trim()&&!e.labels?.length).map(e=>e.tagName),theme:document.documentElement.dataset.theme,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};});
   assert.ok(geometry.scrollWidth<=geometry.width+1,label+' overflow');assert.deepEqual(geometry.clipped,[]);assert.deepEqual(geometry.unnamed,[]);assert.equal(geometry.theme,theme);assert.equal(geometry.reduced,true);
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   await page.screenshot({path:path.join(output,label+'-review.png'),fullPage:true});
   ledger.cases.push({label:label+'-review',actor,...geometry,passed:true});
   await panel.locator('#handoffConsent').check();await panel.getByRole('button',{name:'Save handoff',exact:true}).focus();await page.keyboard.press('Enter');
   await panel.getByText('Handoff saved for company review. Nothing has been sent or used by another task.',{exact:true}).waitFor();
   await panel.locator('.handoff-history > summary').click();
   const receipt=panel.locator('.handoff-receipt').first();assert.equal(await receipt.locator('.handoff-receipt-state').textContent(),'Saved for company review');
   await panel.screenshot({path:path.join(output,label+'-saved.png')});ledger.cases.push({label:label+'-consent-save',passed:true});
   await receipt.getByRole('button',{name:'Revoke consent',exact:true}).click();await receipt.getByRole('button',{name:'Keep consent',exact:true}).click();
   await receipt.getByRole('button',{name:'Revoke consent',exact:true}).click();await receipt.getByRole('button',{name:'Confirm revocation',exact:true}).click();
   await panel.getByText('Consent revoked. The original decision stays in history.',{exact:true}).waitFor();
   await panel.locator('.handoff-history > summary').click();
   assert.equal(await panel.locator('.handoff-receipt').first().locator('.handoff-receipt-state').textContent(),'Consent revoked');ledger.cases.push({label:label+'-revocation',passed:true});
   if(profile.name==='390'||option('profile','all')!=='all'){
    // Read-failure fixtures follow real mounted success, separately identified.
    await page.route('**/handoffs',route=>route.fulfill({status:403,json:{success:false}}));await panel.getByRole('button',{name:'Reload handoff review',exact:true}).click();
    await panel.getByText('Handoff review is unavailable or access has changed.',{exact:true}).waitFor();assert.equal(await panel.locator('.handoff-content').textContent(),'');
    await panel.screenshot({path:path.join(output,label+'-denied.png')});ledger.cases.push({label:label+'-denied-clear',interceptedFailure:true,passed:true});
    await page.unroute('**/handoffs');await panel.getByRole('button',{name:'Reload handoff review',exact:true}).click();await panel.getByText('Current work records are ready for review.',{exact:true}).waitFor();
    await context.setOffline(true);await panel.getByRole('button',{name:'Reload handoff review',exact:true}).click();
    await panel.getByText('Offline. Reconnect and reload current handoff review.',{exact:true}).waitFor();assert.equal(await panel.locator('.handoff-content').textContent(),'');await context.setOffline(false);
    ledger.cases.push({label:label+'-offline-clear',passed:true});
    await panel.getByRole('button',{name:'Reload handoff review',exact:true}).click();await panel.getByText('Current work records are ready for review.',{exact:true}).waitFor();
    // The first POST reaches the real database; only its response is lost.
    const keys=[];let lost=true;await page.route('**/handoff-actions',async route=>{keys.push(route.request().headers()['idempotency-key']);if(lost){lost=false;await route.fetch();return route.abort();}return route.continue();});
    const before=Number((await fixture.ownerPool.query('SELECT count(*) FROM canonical_handoff_receipts')).rows[0].count);
    await panel.locator('#handoffConsent').check();await panel.getByRole('button',{name:'Save handoff',exact:true}).click();
    await panel.getByText('The outcome is uncertain. Retry this same handoff to confirm one recorded result.',{exact:true}).waitFor();
    await panel.getByRole('button',{name:'Retry this same handoff',exact:true}).click();await panel.getByText('Handoff saved for company review. Nothing has been sent or used by another task.',{exact:true}).waitFor();
    assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(Number((await fixture.ownerPool.query('SELECT count(*) FROM canonical_handoff_receipts')).rows[0].count),before+1);
    ledger.cases.push({label:label+'-lost-response-idempotent-retry',interceptedResponseLoss:true,passed:true});await page.unroute('**/handoff-actions');
    await page.route('**/handoffs',async route=>{const response=await route.fetch(),json=await response.json();
      json.data.sourceAvailable=false;json.data.sourceSnapshot=null;json.data.sourceDigest=null;
      json.data.receipts.forEach(r=>{if(r.status==='prepared'||r.status==='source_changed')r.status='source_unavailable';});return route.fulfill({response,json});});
    await panel.getByRole('button',{name:'Reload handoff review',exact:true}).click();
    await panel.getByText('There are too many records to prepare a new handoff here. You can still revoke earlier consent.',{exact:true}).waitFor();
    assert.equal(await panel.getByRole('button',{name:'Save handoff',exact:true}).count(),0);
    await panel.locator('.handoff-history > summary').click();const prior=panel.locator('.handoff-receipt').first();
    await prior.getByRole('button',{name:'Revoke consent',exact:true}).click();await prior.getByRole('button',{name:'Confirm revocation',exact:true}).click();
    await panel.getByText('Consent revoked. The original decision stays in history.',{exact:true}).waitFor();
    ledger.cases.push({label:label+'-source-unavailable-revocation',interceptedSourceAvailability:true,passed:true});await page.unroute('**/handoffs');
   }
   await context.close();activePage=null;
  }
  assert.deepEqual(ledger.pageErrors,[]);assert.equal(ledger.providerAttempts,0);ledger.status='passed';
 }catch(error){ledger.status='failed';ledger.failure={message:error.message,stack:error.stack};if(activePage)await activePage.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
 finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));if(fixture)await fixture.cleanup();https.request=oldRequest;https.get=oldGet;globalThis.fetch=oldFetch;fs.writeFileSync(path.join(output,'ledger.json'),JSON.stringify(ledger,null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
