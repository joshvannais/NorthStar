'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const crypto=require('node:crypto');
process.chdir(path.resolve(__dirname,'../..'));
process.env.NODE_ENV='test';
process.env.AUTH_ACCESS_SECRET='m27-part14b-mounted-browser-disposable-only';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','POLARIS_OPENAI_ENABLED',
  'RETELL_API_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','TWILIO_AUTH_TOKEN','RESEND_API_KEY',
  'SMTP_HOST','SMTP_USER','SMTP_PASS']) delete process.env[key];
const {createDatabaseFixture}=require('../helpers/m23-part9b-overview-fixture');
const {resolveBrowserRuntime}=require('../helpers/playwright-runtime');
let serializationBarrier=null,activeSerializationRelease=null;
let responsePrototype=null,realResponseSend=null;
function arg(name){const value=process.argv.find(item=>item.startsWith(`--${name}=`));
  assert.ok(value,`Missing --${name}`);return value.slice(name.length+3);}
const engine=arg('browser'),output=path.resolve(arg('output')),layoutName=arg('layout');
const layouts={
  'mobile-dark':{width:390,height:844,colorScheme:'dark'},
  'desktop-light':{width:1440,height:900,colorScheme:'light'},
};
const layout=layouts[layoutName];assert.ok(layout);assert.ok(['chrome','webkit'].includes(engine));
assert.equal(fs.existsSync(output),false);fs.mkdirSync(output,{recursive:true});
async function listen(app){const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{
  server.once('listening',resolve);server.once('error',reject);});return server;}
async function workspace(page){return page.evaluate(async()=>{const r=await fetch('/api/demo/command-center',{cache:'no-store'});
  const b=await r.json();if(!r.ok||!b.success)throw new Error('workspace read failed');return b.data;});}
async function openInvoice(page,customer){
  const quick=page.locator('#northstarQuickStartDialog[open]');if(await quick.count())
    await quick.getByRole('button',{name:'Close quick start',exact:true}).click();
  await page.waitForFunction(()=>window.CustomerDetail&&typeof window.CustomerDetail.open==='function',null,{timeout:60000});
  await page.evaluate(id=>window.CustomerDetail.open(id),customer);
  await page.locator('#cdCustomerDrawer:not([hidden])').waitFor({timeout:60000});
  await page.locator('#cdCustomerDrawer[aria-busy="false"]').waitFor({timeout:120000});
  await page.waitForFunction(()=>document.getElementById('cdEstimateReview')?.getAttribute('aria-busy')==='false',null,{timeout:120000});
  const root=page.locator('#cdEstimateHub > .invoice-draft-preview');const summary=root.locator(':scope > summary');
  await summary.waitFor({timeout:120000});
  if(!await root.evaluate(node=>node.open)){
    await summary.focus();await page.keyboard.press('Enter');
  }
  await page.waitForFunction(()=>document.querySelector('#cdEstimateHub > .invoice-draft-preview')?.open===true,
    null,{timeout:600000});
  await page.waitForFunction(()=>{const node=document.querySelector('#cdEstimateHub > .invoice-draft-preview');
    return node?.textContent.includes('Loading the exact current invoice draft…')||
      node?.textContent.includes('Complete fictional financial journey');},null,{timeout:600000});
  await root.getByText('Complete fictional financial journey',{exact:true}).waitFor({timeout:600000});
  return root;
}
async function audit(page,root){
  assert.equal(await root.locator('.invoice-part14b-stages li').count(),15);
  await root.getByText('Fictional financial lifecycle — no real customer, provider, bank, or money effect',{exact:true}).waitFor();
  await root.getByText('offline check received clearance unknown fictionally · check_clearance_unknown',{exact:true}).waitFor();
  assert.equal(await root.getByText('Paid repository reads · 0',{exact:true}).count(),1);
  assert.equal(await root.getByText('Provider calls · 0',{exact:true}).count(),1);
  assert.equal(await root.getByText('Live-money movements · 0',{exact:true}).count(),1);
  assert.equal(await root.getByRole('button',{name:/approve invoice|issue invoice|send invoice|pay invoice|connect provider|start checkout/i}).count(),0);
  const result=await page.evaluate(()=>{
    const scope=document.querySelector('#cdEstimateHub > .invoice-draft-preview');
    const controls=Array.from(scope.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,summary'))
      .filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;});
    return {overflow:document.documentElement.scrollWidth-innerWidth,unnamed:controls.filter(el=>
      !(el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent||el.value||'').trim()).length,
      theme:document.documentElement.dataset.theme};
  });
  assert.ok(result.overflow<=1,JSON.stringify(result));assert.equal(result.unnamed,0);assert.equal(result.theme,layout.colorScheme);
}
(async()=>{let fixture,server,browser,context,page;const ledger={engine,layout:layoutName,mockedResponses:0,
  requestInterceptions:0,responseInterceptions:0,paidRouteCalls:0,providerCalls:0,receiverMutations:0,
  liveMoneyEvidence:'not-run-deferred-first-paying-customer',requests:[],responses:[]};
try{
  fixture=await createDatabaseFixture();responsePrototype=fixture.app.response;
  realResponseSend=responsePrototype.send;responsePrototype.send=function(){
    const args=arguments;
    if(serializationBarrier&&this.req?.url?.includes('/part14b-acceptance')){
      const barrier=serializationBarrier;serializationBarrier=null;
      activeSerializationRelease=barrier.releaseResolve;barrier.enteredResolve();
      barrier.release.then(()=>realResponseSend.apply(this,args)).finally(()=>{activeSerializationRelease=null;});
      return this;
    }
    return realResponseSend.apply(this,args);
  };
  server=await listen(fixture.app);const origin=`http://127.0.0.1:${server.address().port}`;
  const runtime=resolveBrowserRuntime(engine);browser=await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath});
  context=await browser.newContext({viewport:{width:layout.width,height:layout.height},colorScheme:layout.colorScheme,reducedMotion:'reduce'});
  await context.addInitScript(theme=>localStorage.setItem('northstar-theme',theme),layout.colorScheme);
  page=await context.newPage();const errors=[];const consoleErrors=[];const external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.on('request',r=>{const u=new URL(r.url());if(u.origin!==origin)external.push(r.url());
    if(u.pathname.startsWith('/api/v1/customer-financial'))ledger.paidRouteCalls+=1;
    if(u.pathname.includes('part14b-acceptance')||u.pathname.endsWith('/command-center/reset'))
      ledger.requests.push({method:r.method(),path:u.pathname});});
  page.on('response',r=>{const u=new URL(r.url());if(u.pathname.includes('part14b-acceptance')||u.pathname.endsWith('/command-center/reset'))
    ledger.responses.push({status:r.status(),path:u.pathname});});
  await page.goto(origin+'/demo',{waitUntil:'networkidle'});let current=await workspace(page);const old=current.graphs[0];
  let root=await openInvoice(page,old.ids.customer);await audit(page,root);
  await root.screenshot({path:path.join(output,`${engine}-${layoutName}-journey.png`)});
  const storageBefore=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
  const poison=await page.evaluate(async estimate=>{
    const response=await fetch('/api/demo/customer-financial/invoice-drafts/'+
      encodeURIComponent(estimate)+'/part14b-acceptance',{cache:'no-store'});
    const body=await response.json();if(!response.ok||!body.success)throw new Error('canonical poison source unavailable');
    const api=window.NorthStarCustomerFinancialInvoicePreview;
    const paths=[['part12Bundle','preview'],['part12Bundle','part5Acceptance'],
      ['part12Bundle','part6Acceptance'],['part12Bundle','part7Acceptance'],
      ['part12Bundle','part9Acceptance'],['part12Bundle','part10Acceptance'],
      ['part12Bundle','part11SourceContracts','part11A'],['part12Bundle','part11Acceptance'],
      ['part12Bundle','part12Acceptance'],['journeyAcceptance']];
    let getterCalls=0,accepted=0;
    for(const path of paths){const value=structuredClone(body.data);let target=value;
      for(const key of path)target=target[key];Object.defineProperty(target,'contractVersion',{
        enumerable:true,configurable:true,get(){getterCalls+=1;return 'forged';}});
      if(await api.validateActiveFictionalDemoEnvelope(value))accepted+=1;}
    const mutations=[
      value=>{value.part12Bundle.preview.providerAccountId='acct_poison';},
      value=>{value.part12Bundle.part5Acceptance.secret='sk_poison';},
      value=>{value.part12Bundle.part6Acceptance.recipientEmail='victim@example.com';},
      value=>{value.part12Bundle.part7Acceptance.customerToken='tok_private';},
      value=>{value.part12Bundle.part9Acceptance.paymentCard='4242424242424242';},
      value=>{value.part12Bundle.part10Acceptance.customerAddress='private';},
      value=>{value.part12Bundle.part11SourceContracts.part11A.credential='private';},
      value=>{value.part12Bundle.part11Acceptance.accountingCredential='private';},
      value=>{value.part12Bundle.part12Acceptance.privateTenantId='paid-tenant';},
      value=>{value.journeyAcceptance.journeyBinding.providerAccountId='acct_poison';},
      value=>{Object.defineProperty(value.part12Bundle.part12Acceptance,'toJSON',{
        enumerable:false,value(){getterCalls+=1;return {};}});},
      value=>{value.part12Bundle.part5Acceptance[Symbol('secret')]='sk_symbol';},
      value=>{Object.setPrototypeOf(value.part12Bundle.part6Acceptance,{recipientEmail:'victim@example.com'});},
    ];
    for(const mutate of mutations){const value=structuredClone(body.data);mutate(value);
      if(await api.validateActiveFictionalDemoEnvelope(value))accepted+=1;}
    return {getterCalls,accepted,cases:paths.length+mutations.length};
  },old.ids.estimate);
  assert.deepEqual(poison,{getterCalls:0,accepted:0,cases:23});
  await root.locator('[role=alert]').waitFor({timeout:600000});
  for(const selector of ['table','.invoice-draft-preview-document','.invoice-part5-acceptance',
    '.invoice-part6-acceptance','.invoice-part7-acceptance','.invoice-part9-acceptance',
    '.invoice-part10-acceptance','.invoice-part11-acceptance','.invoice-part12-acceptance',
    '.invoice-part14b-acceptance']) assert.equal(await root.locator(selector).count(),0);
  assert.doesNotMatch(await root.innerText(),/sk_poison|acct_poison|victim@example|paid-customer/);
  assert.equal(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}})),storageBefore);
  ledger.poisonRejectedAndCleared=true;
  const summary=root.locator(':scope > summary');await summary.focus();await page.keyboard.press('Enter');
  await root.locator('.invoice-part14b-acceptance').waitFor({state:'detached',timeout:10000});
  for(const selector of ['table','.invoice-part5-acceptance','.invoice-part6-acceptance','.invoice-part7-acceptance',
    '.invoice-part9-acceptance','.invoice-part10-acceptance','.invoice-part11-acceptance','.invoice-part12-acceptance'])
    assert.equal(await root.locator(selector).count(),0);
  await summary.focus();await page.keyboard.press('Enter');await root.getByText('Complete fictional financial journey',{exact:true}).waitFor({timeout:600000});
  let enteredResolve,releaseResolve;const entered=new Promise(resolve=>{enteredResolve=resolve;});
  const release=new Promise(resolve=>{releaseResolve=resolve;});
  serializationBarrier={enteredResolve,release,releaseResolve};
  const reloadClick=root.getByRole('button',{name:'Reload current preview',exact:true})
    .click({timeout:600000});
  await Promise.race([entered,new Promise((_,reject)=>setTimeout(
    ()=>reject(new Error('Mounted serialization barrier not reached')),600000))]);
  await page.locator('#cdCustomerDrawer').getByRole('button',{name:'Close customer details',exact:true}).click();
  await page.locator('#demoReset').click();
  const resetResponse=page.waitForResponse(r=>r.url().endsWith('/api/demo/command-center/reset')&&r.request().method()==='POST');
  const resetNavigation=page.waitForNavigation({waitUntil:'networkidle'}).catch(error=>error);
  await page.getByRole('button',{name:'Reset And Start Over',exact:true}).click();
  await page.waitForTimeout(100);releaseResolve();
  await reloadClick;
  const resetResult=await resetResponse;ledger.resetStatus=resetResult.status();
  assert.equal(resetResult.status(),200);
  const navigationResult=await resetNavigation;if(navigationResult instanceof Error)throw navigationResult;
  current=await workspace(page);assert.equal(current.graphs.length,3);assert.equal(current.session.simulationCount,0);
  assert.notEqual(current.graphs[0].ids.estimate,old.ids.estimate);
  root=await openInvoice(page,current.graphs[0].ids.customer);await audit(page,root);
  await root.getByText('canonical',{exact:true}).waitFor();
  await root.screenshot({path:path.join(output,`${engine}-${layoutName}-after-reset.png`)});
  const wrong=await page.evaluate(async oldEstimate=>{const r=await fetch('/api/demo/customer-financial/invoice-drafts/'+
    encodeURIComponent(oldEstimate)+'/part14b-acceptance',{cache:'no-store'});const b=await r.json();return {status:r.status,body:b};},old.ids.estimate);
  assert.equal(wrong.status,404);assert.doesNotMatch(JSON.stringify(wrong.body),/sk_|acct_|customer@example/i);
  assert.deepEqual(errors,[]);assert.equal(consoleErrors.length,1,JSON.stringify(consoleErrors));
  assert.match(consoleErrors[0],/Failed to load resource: the server responded with a status of 404/);
  ledger.expectedResetIsolationConsole404=1;assert.deepEqual(external,[]);
  ledger.concurrentResetSerialized=true;
  assert.equal(ledger.paidRouteCalls,0);assert.equal(ledger.requests.filter(r=>r.path.includes('part14b')).length,6);
  assert.equal(ledger.responses.filter(r=>r.path.includes('part14b')&&r.status===200).length,5);
  ledger.pass=true;
}catch(error){ledger.failure=error.stack;process.exitCode=1;if(page&&!page.isClosed()){
  ledger.failureState=await page.evaluate(()=>{const root=document.querySelector('#cdEstimateHub > .invoice-draft-preview');
    return root?{open:root.open,text:root.textContent?.slice(-2000),body:root.querySelector('.invoice-draft-preview-body')?.innerText}:null;
  }).catch(()=>null);
  await page.screenshot({fullPage:true,path:path.join(output,'failure.png')}).catch(()=>{});}
}finally{if(activeSerializationRelease)activeSerializationRelease();
  if(responsePrototype&&realResponseSend)responsePrototype.send=realResponseSend;
  fs.writeFileSync(path.join(output,'ledger.json'),JSON.stringify(ledger,null,2));
  if(context)await context.close();if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));
  if(fixture)await fixture.cleanup();}
})().then(()=>process.exit(process.exitCode||0)).catch(error=>{console.error(error);process.exit(1);});
