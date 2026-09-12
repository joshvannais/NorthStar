'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
process.env.NODE_ENV='test';process.env.AUTH_ACCESS_SECRET='owner-return-links-disposable-fixture-only';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY'])delete process.env[key];
const {createDatabaseFixture}=require('../helpers/m23-part9b-overview-fixture'),{session}=require('../helpers/owner-operations-demo-session'),{resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const arg=n=>process.argv.find(v=>v.startsWith('--'+n+'=')).slice(n.length+3),engine=arg('browser'),out=path.resolve(arg('output'));assert.ok(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
(async()=>{let f,server,browser,page;const ledger={engine,cases:[],errors:[]};try{
 f=await createDatabaseFixture();server=f.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 // Preexisting completed fixtures are local setup, never claimed as fresh/zero-write creation.
 const saved=session(f.app),id=await saved.setup();
 for(const [family,body]of [['initialize',{}],['transition',{action:'start'}]])assert.equal((await saved.act(id,family,body)).status,201);
 const proposal=await saved.act(id,'completion',{action:'propose_completion',expiresAt:new Date(Date.now()+3600000).toISOString(),gateRequirements:{checklists:[],inspections:[],files:[]}});assert.equal(proposal.status,201);
 const pin=proposal.body.completionRecord;assert.equal((await saved.act(id,'completion',{action:'approve_completion',proposal:{id:pin.id,revision:pin.revision,digest:pin.digest}})).status,201);
 const savedDetail=await saved.detail(id),savedRow=(await f.ownerPool.query('SELECT * FROM demo_command_center_sessions WHERE id=$1',[(await saved.read()).session.id])).rows[0];
 const paid=await f.createExecution(),paidProposal=await f.completion(paid);const pp=paidProposal.body.completionRecord;await f.completion(paid,'approve_completion',{proposal:{id:pp.id,revision:pp.revision,digest:pp.digest}});
 const rt=resolveBrowserRuntime(engine);browser=await rt.browserType.launch({headless:true,executablePath:rt.executablePath});
 for(const scenario of ['fresh-demo','fresh-completion','completed-demo','completed-paid'])for(const [width,theme]of [[1440,'light'],[390,'dark']]){
  const selected=process.argv.find(v=>v.startsWith('--scenario='));if(selected&&selected.slice(11)!==scenario)continue;
  const demo=scenario!=='completed-paid',prefix=demo?'/demo':'/dashboard',context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});await context.addInitScript(t=>localStorage.setItem('northstar-theme',t),theme);
  if(scenario==='completed-demo'){const at=saved.cookie.indexOf('=');await context.addCookies([{name:saved.cookie.slice(0,at),value:saved.cookie.slice(at+1),url:origin}]);}
  if(!demo)await context.addCookies(Object.entries(paid.actor.session.cookies).map(([name,value])=>({name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));
  const writes=[],responses=[],ownerCookieHashes=[],headerReads=[];ledger.currentContext={scenario,width,writes,responses,ownerCookieHashes};await context.route('**/*',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.request().method())){writes.push({path:new URL(r.request().url()).pathname,method:r.request().method()});return r.abort();}return r.continue();});
  page=await context.newPage();page.on('pageerror',e=>ledger.errors.push(e.message));page.on('response',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/api/'))responses.push({path:p,status:r.status()});});
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/demo/command-center/operations'))headerReads.push(r.allHeaders().then(headers=>{const cookie=headers.cookie;ownerCookieHashes.push(cookie?require('crypto').createHash('sha256').update(cookie).digest('hex'):null);}));});
  const execution=scenario.startsWith('fresh')?'11111111-1111-4111-8111-111111111111':demo?savedDetail.execution.id:paid.execution.id;
  const tag=scenario+'-'+width,links=[];
  const routes=[['operations','.operations-brand',prefix],['operations','.operations-back',prefix],['completion-review','.completion-brand',prefix],['completion-review','.completion-back',prefix+'/operations']];if(scenario==='fresh-completion')routes.unshift(routes.pop());
  for(const [host,selector,destination]of routes){
   await page.goto(origin+prefix+'/'+host+(host==='completion-review'?'?executionId='+execution:''));
   if(host==='operations')await page.getByText('Current Work Loaded.',{exact:true}).waitFor();
   else if(!scenario.startsWith('fresh'))await page.getByRole('button',{name:'Reopen completed work',exact:true}).waitFor();
   else await page.getByText('This completion review is not available in this demo. Choose a job from Operations.',{exact:true}).waitFor();
   await page.waitForFunction(([s,d])=>document.querySelector(s)?.getAttribute('href')===d,[selector,destination]);
   await page.locator(selector).click();assert.equal(new URL(page.url()).pathname,destination);
   if(destination.endsWith('/operations')){await page.getByText('Current Work Loaded.',{exact:true}).waitFor();await page.getByText('No recorded work matches this status.',{exact:true}).waitFor();}
   else await page.waitForFunction(()=>document.documentElement.getAttribute('data-northstar-navigation')==='ready');
   links.push({host,selector,destination,loaded:true});
  }
  await page.screenshot({path:path.join(out,tag+'-final-return.png'),fullPage:true});
  await Promise.all(headerReads);const privateReads=responses.filter(r=>r.path.startsWith('/api/v1/'));assert.deepEqual(writes,[]);if(demo){assert.deepEqual(privateReads,[]);assert.ok(ownerCookieHashes.length>0);assert.ok(ownerCookieHashes.every(h=>h!==null&&h===ownerCookieHashes[0]));}
  assert.ok(responses.some(r=>r.path===(demo?'/api/demo/command-center/operations':'/api/v1/field-executions/owner-work')&&r.status===200));
  ledger.cases.push({tag,links,writes,privateReads,responses,ownerCookieHashes,assertedAfterFinalNavigation:true});await context.close();
 }
 assert.deepEqual((await f.ownerPool.query('SELECT * FROM demo_command_center_sessions WHERE id=$1',[savedRow.id])).rows[0],savedRow);
 ledger.persistedRowUnchanged=true;assert.deepEqual(ledger.errors,[]);
}catch(e){ledger.failure=e.stack;process.exitCode=1;if(page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});}finally{fs.writeFileSync(path.join(out,'ledger.json'),JSON.stringify(ledger,null,2));if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));if(f)await f.cleanup();}})();
