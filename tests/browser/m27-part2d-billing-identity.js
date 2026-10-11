'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { MISSION_26_FIVE_LAYOUTS, auditRenderedPage, exerciseSkipLink } =
  require('../helpers/m26-part12d-rendered-review');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm27-part2d-billing-identity-browser-20261011';
const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });

const customerId = '11111111-1111-4111-8111-111111111111';
const partyId = '22222222-2222-4222-8222-222222222222';
const snapshotId = '33333333-3333-4333-8333-333333333333';
const reviewOne = '44444444-4444-4444-8444-444444444444';
const reviewTwo = '55555555-5555-4555-8555-555555555555';
const digest = value => value.repeat(64);

const runtimeScript = `(function(){
  var demo=location.pathname.indexOf('/demo/')===0;
  var phase='candidate',sequence=0,sourceRevision=1,workspaceRevision=1;
  var reviews=[];
  var customerId='${customerId}',partyId='${partyId}',snapshotId='${snapshotId}';
  function sourceDigest(){return sourceRevision===1?'${digest('a')}':'${digest('b')}';}
  function sourceUpdatedAt(){return sourceRevision===1?'2026-10-10T12:00:00.000000Z':'2026-10-10T12:07:00.000000Z';}
  function source(){return {name:sourceRevision===1?'Fictional billing customer':'Fictional billing customer corrected 1',
    email:'billing@example.test',phone:'+15550109000',serviceAddress:{line1:sourceRevision===1?'1 Fictional Review Way':'101 Fictional Correction Way',line2:null,city:'Example Falls',region:'NC',postalCode:'00000',countryCode:'US'}};}
  function identity(){var value=source();if(phase==='candidate')return {state:'candidate_unreviewed',available:true,current:true,reason:null,
    customerId:customerId,billingPartyId:null,snapshotId:null,sourceDigest:sourceDigest(),sourceUpdatedAt:sourceUpdatedAt(),reviewState:'unreviewed',documentUseAuthorized:false,value:value};
    if(phase==='correction')return {state:'unavailable',available:false,current:false,reason:'billing_identity_source_changed_requires_review',
      customerId:customerId,billingPartyId:partyId,snapshotId:snapshotId,sourceDigest:null,sourceUpdatedAt:null,reviewState:null,documentUseAuthorized:false,value:null};
    return {state:'established_unreviewed',available:true,current:true,reason:null,customerId:customerId,billingPartyId:partyId,
      snapshotId:snapshotId,sourceDigest:sourceDigest(),sourceUpdatedAt:sourceUpdatedAt(),reviewState:'unreviewed',documentUseAuthorized:false,value:value};}
  function review(){if(phase==='candidate')return null;var latest=reviews[reviews.length-1]||null;if(phase==='current')return {state:'reviewed_current',available:true,current:true,
    reason:null,customerId:customerId,billingPartyId:partyId,reviewId:latest.reviewId,sequence:latest.sequence,sourceDigest:sourceDigest(),
    sourceUpdatedAt:sourceUpdatedAt(),reviewDigest:latest.reviewDigest,reviewState:'reviewed',documentUseAuthorized:true,value:{payload:latest.payload}};
    return {state:phase==='correction'?'correction_required':'review_required',available:true,current:true,reason:null,customerId:customerId,
      billingPartyId:partyId,reviewId:latest&&latest.reviewId,sequence:latest?latest.sequence:0,sourceDigest:sourceDigest(),sourceUpdatedAt:sourceUpdatedAt(),
      reviewDigest:latest&&latest.reviewDigest,reviewState:'unreviewed',documentUseAuthorized:false,value:source()};}
  function envelope(){return {version:'m27-billing-identity-journey-v1',mode:demo?'isolated_fictional_demo':'paid_tenant',fictional:demo,
    accountFree:demo,resettable:demo,demoWorkspaceRevision:demo?workspaceRevision:undefined,customerId:customerId,identity:identity(),review:review(),
    history:{complete:true,total:reviews.length,revisions:reviews.map(function(v){return {reviewId:v.reviewId,sequence:v.sequence,reviewDigest:v.reviewDigest,
      sourceDigest:v.sourceDigest,sourceUpdatedAt:v.sourceUpdatedAt,reviewedAt:v.reviewedAt,reason:v.reason};})},invoiceMutationCount:0,paymentMutationCount:0,
    providerCallCount:0,customerCreationCount:0};}
  function workspace(){return {graphs:[{ids:{customer:customerId,graph:'66666666-6666-4666-8666-666666666666',operation:'77777777-7777-4777-8777-777777777777'},
    customer:{name:'Fictional billing customer'},timestamps:{updatedAt:sourceUpdatedAt()}}],integrity:{revision:workspaceRevision}};}
  function response(status,data){return Promise.resolve({status:status,ok:status>=200&&status<300,json:function(){return Promise.resolve({success:true,data:data});}});}
  function apply(action,details){workspaceRevision+=1;if(action==='establish'){phase='review';}
    else if(action==='correct_source'){sourceRevision+=1;phase='correction';}
    else if(action==='review'){sequence+=1;reviews.push({reviewId:sequence===1?'${reviewOne}':'${reviewTwo}',sequence:sequence,
      reviewDigest:sequence===1?'${digest('c')}':'${digest('d')}',sourceDigest:sourceDigest(),sourceUpdatedAt:sourceUpdatedAt(),payload:details.payload,
      reason:details.reason,reviewedAt:sequence===1?'2026-10-10T12:06:00.000000Z':'2026-10-10T12:08:00.000000Z'});phase='current';}
    return envelope();}
  function fetcher(url,options){options=options||{};var method=options.method||'GET';window.m27BillingCalls.push({url:url,method:method});
    if(url==='/api/v1/command-center/workspace')return response(200,workspace());
    if(url.indexOf('/billing-identities/')>=0&&method==='GET')return response(200,envelope());
    if(url.indexOf('/billing-identities/')>=0&&method==='POST'){var sent=JSON.parse(options.body||'{}');
      if(url.indexOf('/actions')>=0)return response(201,apply(sent.action,sent.details||{}));
      return response(201,apply(url.indexOf('/establish')>=0?'establish':'review',sent));}
    if(url==='/api/demo/command-center/reset'&&method==='POST'){phase='candidate';sequence=0;sourceRevision=1;reviews=[];workspaceRevision=1;return response(200,{integrity:{revision:1}});}
    return Promise.resolve({status:503,ok:false,json:function(){return Promise.resolve({success:false,error:{message:'Unavailable in bounded browser fixture.'}});}});}
  window.m27BillingCalls=[];window.showToast=function(){};
  window.NorthStarAccountSession={load:function(){return Promise.resolve({mode:demo?'demo':'paid',navigation:[{id:'settings',href:demo?'/demo/settings':'/dashboard/settings'}]});},fetch:fetcher};
  window.NorthStarDemoRuntime={active:demo,fetch:fetcher,loadWorkspace:function(){return Promise.resolve(workspace());}};
})();`;

async function main() {
  const app = require('../../src/server').app;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const engine = process.argv.includes('--webkit') ? 'webkit' : 'chrome';
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
  const cases = [];
  try {
    for (const layout of MISSION_26_FIVE_LAYOUTS) {
      for (const mode of ['paid', 'demo']) {
        const context = await browser.newContext({ viewport: { width: layout.width, height: layout.height },
          colorScheme: layout.colorScheme, reducedMotion: 'reduce' });
        await context.addInitScript(theme => localStorage.setItem('northstar-theme', theme), layout.colorScheme);
        const page = await context.newPage(); const errors = []; const external = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('request', request => { if (!request.url().startsWith(base)) external.push(request.url()); });
        await page.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== base) return route.abort();
          if (url.pathname === '/js/demo-runtime.js') return route.fulfill({ contentType: 'application/javascript', body: runtimeScript });
          if (url.pathname === '/js/auth-session.js') return route.fulfill({ contentType: 'application/javascript', body: '' });
          if (url.pathname === '/js/api.js') return route.fulfill({ contentType: 'application/javascript', body: 'window.showToast=function(){};' });
          if (url.pathname === '/js/workspace-form-state.js') return route.fulfill({ contentType: 'application/javascript',
            body: 'window.NorthStarFormState={create:function(){return {}}};' });
          if (url.pathname === '/js/nav-component.js') return route.fulfill({ contentType: 'application/javascript',
            body: 'window.NavComponent={init:function(){}};' });
          if (url.pathname.startsWith('/js/') && !['/js/theme.js','/js/customer-financial-billing-identity.js'].includes(url.pathname)) {
            return route.fulfill({ contentType: 'application/javascript', body: '' });
          }
          if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: {} });
          return route.continue();
        });
        await page.goto(base + (mode === 'demo' ? '/demo/settings' : '/dashboard/settings'));
        await page.getByText('Ready to start a private billing review.', { exact: true }).waitFor();
        assert.match(await page.locator('#billingIdentityMode').innerText(), mode === 'demo' ? /Fictional demo/ : /Paid tenant/);
        await page.locator('#establishBillingIdentity').focus(); await page.keyboard.press('Enter');
        await page.getByText('Billing identity is ready for human review.', { exact: true }).waitFor();
        assert.equal(await page.locator('#billingIdentityContactName').inputValue(), 'Fictional billing customer');
        await page.locator('#billingPurchaseOrder').fill('PO-BROWSER-27');
        await page.locator('#saveBillingIdentityReview').focus(); await page.keyboard.press('Enter');
        await page.getByText('Current billing identity review is ready.', { exact: true }).waitFor();
        assert.match(await page.locator('#billingIdentityReviewedContact').innerText(), /billing@example\.test/);
        assert.equal(await page.locator('#billingIdentityReviewedPurchaseOrder').innerText(), 'PO-BROWSER-27');
        assert.match(await page.locator('#billingIdentityReviewedReceipt').innerText(), /Review 1/);
        assert.equal(await page.locator('#billingIdentityHistory li').count(), 1);
        if (mode === 'demo') {
          await page.locator('#correctBillingIdentitySource').focus(); await page.keyboard.press('Enter');
          await page.getByText('A source correction requires another human review.', { exact: true }).waitFor();
          assert.equal(await page.locator('#billingIdentityCurrent').isHidden(), true);
          assert.equal(await page.locator('#billingAddressLine1').inputValue(), '101 Fictional Correction Way');
          await page.locator('#billingPurchaseOrder').fill('PO-BROWSER-28');
          await page.locator('#saveBillingIdentityReview').focus(); await page.keyboard.press('Enter');
          await page.getByText('Current billing identity review is ready.', { exact: true }).waitFor();
          assert.equal(await page.locator('#billingIdentityHistory li').count(), 2);
          await page.locator('#resetBillingIdentityDemo').focus(); await page.keyboard.press('Enter');
          await page.getByText('Ready to start a private billing review.', { exact: true }).waitFor();
          assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'resetBillingIdentityDemo');
          assert.equal(await page.locator('#billingIdentityHistory').innerText(), '');
          assert.equal(await page.locator('#billingIdentityReviewedContact').innerText(), '');
        }
        const calls = await page.evaluate(() => window.m27BillingCalls);
        assert.equal(calls.some(call => call.url.includes('/invoices') || call.url.includes('/payments')), false);
        assert.deepEqual(external, []); assert.deepEqual(errors, []);
        await auditRenderedPage(page, { mainSelector: '#mainContent', layout });
        await page.locator('#billing-identity-journey').screenshot({ path: path.join(output, `${engine}-${layout.name}-${mode}.png`) });
        await exerciseSkipLink(page, { mainSelector: '#mainContent' });
        cases.push(`${layout.name}-${mode}`); await context.close();
      }
    }
    assert.equal(cases.length, 10);
    console.log(JSON.stringify({ engine, cases, liveMoneyEvidence: 'not-run-deferred-first-paying-customer' }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
