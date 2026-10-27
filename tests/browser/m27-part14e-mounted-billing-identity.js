'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const request=require('supertest');
process.chdir(path.resolve(__dirname,'../..'));
process.env.NODE_ENV='test';
process.env.AUTH_ACCESS_SECRET='m27-part14e-mounted-browser-disposable-only';
for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','POLARIS_OPENAI_ENABLED',
  'RETELL_API_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','TWILIO_AUTH_TOKEN','RESEND_API_KEY',
  'SMTP_HOST','SMTP_USER','SMTP_PASS']) delete process.env[key];

const {createPart4ePaidBrowserFixture}=require('../helpers/m27-part4e-paid-journey-fixture');
const {resolveBrowserRuntime}=require('../helpers/playwright-runtime');
const {MISSION_26_FIVE_LAYOUTS,auditRenderedPage,exerciseSkipLink}=
  require('../helpers/m26-part12d-rendered-review');

function arg(name){const value=process.argv.find(item=>item.startsWith(`--${name}=`));
  assert.ok(value,`Missing --${name}`);return value.slice(name.length+3);}
const engine=arg('browser'),output=path.resolve(arg('output'));
const requested=process.argv.find(item=>item.startsWith('--layout='));
const selected=requested?MISSION_26_FIVE_LAYOUTS.filter(value=>value.name===requested.slice(9)):
  MISSION_26_FIVE_LAYOUTS;
assert.ok(['chrome','webkit'].includes(engine));assert.ok(selected.length);
assert.equal(fs.existsSync(output),false);fs.mkdirSync(output,{recursive:true});

async function listen(app){const server=app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});return server;}

async function review(page,mode,paidExpectedPurchaseOrder){
  const root=page.locator('#billing-identity-journey');
  await root.waitFor({state:'visible',timeout:120000});
  if(mode==='paid'){
    await page.getByText('Current billing identity review is ready.',{exact:true}).waitFor({timeout:120000});
    assert.match(await page.locator('#billingIdentityMode').innerText(),/Paid tenant/);
    assert.match(await page.locator('#billingIdentityReviewedContact').innerText(),/taylor@example\.test/);
    assert.equal(await page.locator('#billingIdentityReviewedPurchaseOrder').innerText(),paidExpectedPurchaseOrder);
  }else{
    await page.getByText('Ready to start a private billing review.',{exact:true}).waitFor({timeout:120000});
    assert.match(await page.locator('#billingIdentityMode').innerText(),/Fictional demo/);
    await page.locator('#establishBillingIdentity').focus();await page.keyboard.press('Enter');
    await page.getByText('Billing identity is ready for human review.',{exact:true}).waitFor({timeout:120000});
    await page.locator('#billingPurchaseOrder').fill('PO-P14E-DEMO');
    await page.locator('#saveBillingIdentityReview').focus();await page.keyboard.press('Enter');
    await page.getByText('Current billing identity review is ready.',{exact:true}).waitFor({timeout:120000});
    assert.equal(await page.locator('#billingIdentityReviewedPurchaseOrder').innerText(),'PO-P14E-DEMO');
    await page.locator('#correctBillingIdentitySource').focus();await page.keyboard.press('Enter');
    await page.getByText('A source correction requires another human review.',{exact:true}).waitFor({timeout:120000});
    assert.equal(await page.locator('#billingIdentityCurrent').isHidden(),true);
    await page.locator('#resetBillingIdentityDemo').focus();await page.keyboard.press('Enter');
    await page.getByText('Ready to start a private billing review.',{exact:true}).waitFor({timeout:120000});
    assert.equal(await page.locator('#billingIdentityHistory').innerText(),'');
    assert.equal(await page.locator('#billingIdentityReviewedContact').innerText(),'');
  }
  return root;
}

function ok(response,expected,label){
  assert.equal(response.status,expected,`${label}: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body&&response.body.data;
}

async function prepareCurrentBillingIdentity(prepared,customerId){
  if(customerId===prepared.customer)return 'PO-P4E-BROWSER';
  const actor=prepared.actor,fixture=prepared.fixture,grantId=crypto.randomUUID();
  await fixture.ownerPool.query(
    `INSERT INTO canonical_customer_financial_billing_capability_grants_v1(
      organization_id,id,revision,actor_user_id,membership_id,customer_id,capability,
      business_purpose,policy_version,template_version,active,valid_from,expires_at,issued_at)
     VALUES($1,$2,1,$3,$3,$4,$5,$6,$7,'m27.owner.v1',TRUE,
      clock_timestamp()-INTERVAL '1 minute',clock_timestamp()+INTERVAL '1 hour',clock_timestamp())`,
    [fixture.org,grantId,actor.actorUserId,customerId,
      'customer_financial.billing_identity.review','customer_financial.billing_identity',
      'mission27.launch.v1']);
  const route=`/api/v1/customer-financial/billing-identities/${customerId}`;
  let current=ok(await request(fixture.app).get(route).set(actor.session.headers),200,
    'current paid billing candidate');
  ok(await request(fixture.app).post(`${route}/establish`).set(actor.session.headers)
    .set('Idempotency-Key',crypto.randomUUID()).send({
      expectedSourceDigest:current.identity.sourceDigest,
      expectedSourceUpdatedAt:current.identity.sourceUpdatedAt,
      reason:'Begin exact Part 14E mounted billing identity review.'}),201,
  'current paid billing establish');
  current=ok(await request(fixture.app).get(route).set(actor.session.headers),200,
    'current paid billing review read');
  const review=current.review;
  ok(await request(fixture.app).post(`${route}/reviews`).set(actor.session.headers)
    .set('Idempotency-Key',crypto.randomUUID()).send({
      billingPartyId:review.billingPartyId,originSnapshotId:current.identity.snapshotId,
      expectedSourceDigest:review.sourceDigest,expectedSourceUpdatedAt:review.sourceUpdatedAt,
      expectedPreviousReviewId:review.reviewId,expectedPreviousReviewDigest:review.reviewDigest,
      expectedPreviousSequence:review.sequence,
      payload:{contact:{name:'Taylor Customer',email:'taylor@example.test',phone:null},
        serviceAddress:{line1:'10 Service Street',line2:null,city:'Boston',region:'MA',
          postalCode:'02108',countryCode:'US'},
        billingAddress:{line1:'20 Billing Street',line2:null,city:'Boston',region:'MA',
          postalCode:'02108',countryCode:'US'},
        purchaseOrderReference:'PO-P14E-PAID',customerReference:'CUSTOMER-P14E-PAID'},
      reason:'Owner reviewed the current Part 14E mounted billing identity.'}),201,
  'current paid billing review');
  return 'PO-P14E-PAID';
}

(async()=>{let prepared,server,browser,activePage;const ledger={engine,layouts:[],surfaces:[],
  requestInterceptions:0,responseInterceptions:0,mockedResponses:0,providerCalls:0,
  receiverMutations:0,moneyMovements:0,pageErrors:0,unexpectedConsoleErrors:0,
  unexpectedExternalRequests:0,boundedUnrelatedUnavailableResponses:[],
  liveMoneyEvidence:'not-run-deferred-first-paying-customer'};
try{
  prepared=await createPart4ePaidBrowserFixture();server=await listen(prepared.fixture.app);
  const origin=`http://127.0.0.1:${server.address().port}`;
  // The fixture issued the exact customer-financial capability to this actor
  // and session.  Reusing that mounted production session proves the browser
  // reads the reviewed identity under the same server-owned authority instead
  // of minting a second, unrelated test session after the grant was issued.
  const session=prepared.actor.session;
  const workspaceResponse=await request(prepared.fixture.app).get('/api/v1/command-center/workspace')
    .set(session.headers);
  assert.equal(workspaceResponse.status,200,JSON.stringify(workspaceResponse.body));
  const currentGraph=workspaceResponse.body.data.graphs.slice().sort((left,right)=>
    String(right.timestamps?.updatedAt||'').localeCompare(String(left.timestamps?.updatedAt||'')))
    .find(item=>item?.ids?.customer);
  assert.ok(currentGraph,'Paid billing identity evidence requires one current customer graph.');
  const paidExpectedPurchaseOrder=await prepareCurrentBillingIdentity(prepared,currentGraph.ids.customer);
  const runtime=resolveBrowserRuntime(engine);
  browser=await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath});
  for(const layout of selected){
    const layoutEvidence={name:layout.name,modes:[]};
    for(const mode of ['paid','demo']){
      const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},
        colorScheme:layout.colorScheme,reducedMotion:'reduce'});
      await context.addInitScript(theme=>localStorage.setItem('northstar-theme',theme),layout.colorScheme);
      if(mode==='paid')await context.addCookies(Object.entries(session.cookies).map(([name,value])=>({
        name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf'})));
      if(mode==='demo'){
        // Establish one durable account-free demo session before the full
        // settings page starts concurrent reads. This is a mounted GET using
        // the browser context's real cookie jar, with no route interception.
        const admission=await context.request.get(origin+'/api/demo/command-center');
        assert.equal(admission.status(),200,await admission.text());
      }
      const page=await context.newPage(),errors=[],consoleErrors=[],external=[],failed=[];activePage=page;
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
      page.on('request',request=>{const url=new URL(request.url());
        if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol))external.push(request.url());});
      page.on('response',response=>{const url=new URL(response.url());
        if(url.origin===origin&&response.status()>=400)failed.push({path:url.pathname,status:response.status()});});
      const started=performance.now();
      await page.goto(origin+(mode==='paid'?'/dashboard/settings':'/demo/settings'),{waitUntil:'networkidle'});
      const root=await review(page,mode,paidExpectedPurchaseOrder);
      const settledMs=Math.round(performance.now()-started);
      assert.ok(settledMs<120000,`billing identity render exceeded local bound: ${settledMs}`);
      await auditRenderedPage(page,{mainSelector:'#mainContent',layout});
      await root.screenshot({path:path.join(output,`${engine}-${layout.name}-${mode}.png`)});
      await exerciseSkipLink(page,{mainSelector:'#mainContent'});
      const targetFailures=failed.filter(item=>item.path==='/api/v1/command-center/workspace'||
        item.path.includes('/customer-financial/billing-identities/'));
      const unexpectedConsole=consoleErrors.filter(message=>
        message!=='Failed to load resource: the server responded with a status of 503 (Service Unavailable)');
      assert.deepEqual(errors,[]);assert.deepEqual(unexpectedConsole,[]);assert.deepEqual(external,[]);
      assert.deepEqual(targetFailures,[]);
      assert.equal(failed.every(item=>item.status===503),true,
        `Only unrelated bounded unavailable panels may fail: ${JSON.stringify(failed)}`);
      ledger.boundedUnrelatedUnavailableResponses.push(...failed.map(item=>({mode,...item})));
      ledger.pageErrors+=errors.length;ledger.unexpectedConsoleErrors+=unexpectedConsole.length;
      ledger.unexpectedExternalRequests+=external.length;
      ledger.surfaces.push(`${mode==='paid'?'billing-identity-paid':'billing-identity-demo'}:${layout.name}`);
      layoutEvidence.modes.push({mode,settledMs,failedResponses:failed.length});
      await context.close();
    }
    ledger.layouts.push(layoutEvidence);
  }
  assert.equal(ledger.layouts.length,selected.length);ledger.pass=true;
}catch(error){ledger.failure=error.stack;process.exitCode=1;
  if(activePage&&!activePage.isClosed()){
    ledger.failureState=await activePage.evaluate(()=>({url:location.href,
      status:document.getElementById('billingIdentityStatus')?.textContent,
      detail:document.getElementById('billingIdentityDetail')?.textContent,
      body:document.body.innerText.slice(-3000)})).catch(()=>null);
    await activePage.screenshot({fullPage:true,path:path.join(output,'failure.png')}).catch(()=>{});
  }
}finally{fs.writeFileSync(path.join(output,'ledger.json'),JSON.stringify(ledger,null,2)+'\n');
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  if(prepared)await prepared.fixture.cleanup();console.log(JSON.stringify(ledger));}
})();
