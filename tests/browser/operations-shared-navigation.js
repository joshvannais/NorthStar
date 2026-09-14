'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='operations-nav-local-fixture-only';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[key];
const {createDatabaseFixture}=require('../helpers/m23-part9b-overview-fixture'),{resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const arg=n=>process.argv.find(v=>v.startsWith('--'+n+'='))?.slice(n.length+3),engine=arg('browser')||'chrome',out=path.resolve(arg('output'));
assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
(async()=>{let f,server,browser,page;const ledger={engine,cases:[],errors:[]};try{
 f=await createDatabaseFixture();const paid=await f.createExecution();
 server=require('http').createServer(f.app).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 const rt=resolveBrowserRuntime(engine);browser=await rt.browserType.launch({headless:true,executablePath:rt.executablePath});
 for(const demo of [true,false])for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'}),writes=[],responses=[];const prefix=demo?'/demo':'/dashboard';
  if(!demo)await context.addCookies(Object.entries(paid.actor.session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));
  await context.route('**/*',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.request().method())){writes.push(r.request().url());return r.abort();}return r.continue();});
  ledger.current={demo,width,writes,responses};page=await context.newPage();page.on('requestfailed',r=>responses.push({path:new URL(r.url()).pathname,failure:r.failure()}));page.on('console',m=>{if(m.type()==='error')responses.push({console:m.text()});});page.on('pageerror',e=>ledger.errors.push(e.message));page.on('response',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/api/'))responses.push({path:p,status:r.status()});});
  await page.goto(origin+prefix+'/operations');
  await page.waitForFunction(()=>document.documentElement.dataset.northstarNavigation==='ready');
  await page.getByText('Current Work Loaded.',{exact:true}).waitFor();
  await page.waitForFunction(()=>['empty','success'].includes(document.querySelector('#operationsStatus').dataset.state));
  const selected=await page.locator('#ownerWork select').inputValue();
  const initial=await page.locator('#ownerWork [data-work-content]').innerText();
  if(demo)assert(await page.locator('#operationsPagination').isHidden());
  for(const theme of ['light','dark']){
   const toggle=page.locator('[data-northstar-theme-toggle]');
   if(await page.locator('html').getAttribute('data-theme')!==theme)await toggle.click();
   await page.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
   assert.equal(await page.locator('[data-northstar-theme-control]').count(),1);
   assert.equal(await toggle.evaluate(e=>getComputedStyle(e.parentElement).position),'static');
   assert(await toggle.evaluate(e=>Boolean(e.closest('.northstar-theme-slot'))));
   if(width===390){const open=page.locator('#navHamburgerBtn');await open.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#mobileMenu').classList.contains('open'));await page.keyboard.press('Tab');assert(await page.locator('#mobileMenu').evaluate(e=>e.contains(document.activeElement)));await page.keyboard.press('Escape');assert(await open.evaluate(e=>e===document.activeElement));}
   await page.screenshot({path:path.join(out,`${demo?'demo':'paid'}-${width}-${theme}-top.png`)});
   await page.locator('.operations-boundary').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`${demo?'demo':'paid'}-${width}-${theme}-lower.png`)});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.evaluate(()=>scrollTo(0,0));
  }
  await page.locator('[data-work-refresh]').click();await page.getByText('Current Work Loaded.',{exact:true}).waitFor();assert.equal(await page.locator('#ownerWork select').inputValue(),selected);assert.equal(await page.locator('#ownerWork [data-work-content]').innerText(),initial);
  for(const filter of ['all','completed','active']){await page.locator('#operationsFilter').selectOption(filter);await page.waitForFunction(()=>['empty','success'].includes(document.querySelector('#operationsStatus').dataset.state));}
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.northstarNavigation==='ready');await page.getByText('Current Work Loaded.',{exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.locator('.operations-command-center').click();assert.equal(new URL(page.url()).pathname,prefix);await page.waitForFunction(()=>document.documentElement.dataset.northstarNavigation==='ready');await page.getByRole('button',{name:'Close quick start',exact:true}).click();
  if(width===390)await page.locator('#navHamburgerBtn').click();await page.locator((width===390?'#mobileMenu':'.sidebar')+' [data-nav-id=operations]').click();await page.getByText('Current Work Loaded.',{exact:true}).waitFor();
  if(width===390)await page.locator('#navHamburgerBtn').click();await page.locator((width===390?'#mobileMenu':'.sidebar')+' [data-nav-id=calendar]').click();assert.equal(new URL(page.url()).pathname,prefix+'/calendar');await page.waitForFunction(()=>document.documentElement.dataset.northstarNavigation==='ready');
  if(width===390)await page.locator('#navHamburgerBtn').click();await page.locator((width===390?'#mobileMenu':'.sidebar')+' [data-nav-id=operations]').click();await page.getByText('Current Work Loaded.',{exact:true}).waitFor();
  assert.deepEqual(writes,[]);const privateReads=responses.filter(r=>r.path.startsWith('/api/v1/'));if(demo)assert.deepEqual(privateReads,[]);assert(responses.some(r=>r.path===(demo?'/api/demo/command-center/operations':'/api/v1/field-executions/owner-work')&&r.status===200));
  ledger.cases.push({demo,width,selected,initial,final:await page.locator('#ownerWork [data-work-content]').innerText(),writes,responses,privateReads,finalNavigationChecked:true});await context.close();
 }
 assert.deepEqual(ledger.errors,[]);
}catch(e){ledger.failure=e.stack;process.exitCode=1;if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}finally{fs.writeFileSync(path.join(out,'ledger.json'),JSON.stringify(ledger,null,2));await browser?.close();if(server)await new Promise(r=>server.close(r));if(f)await f.cleanup();}})();
