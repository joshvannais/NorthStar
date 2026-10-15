'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '../..'));

const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const demo = require('../../src/customerFinancial/demoPaymentPart7Acceptance');
const workspace = require('../../src/commandCenter/workspace');

function argument(name) {
  const value=process.argv.find(item=>item.startsWith(`--${name}=`));
  assert.ok(value,`Missing --${name}`); return value.slice(name.length+3);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

const engine=argument('browser');
const estimate='11111111-1111-4111-8111-111111111111';
const tenant='44444444-4444-4444-8444-444444444444';
const state=workspace.createInitialDemoState(tenant,new Date('2026-10-14T12:00:00Z'),
  {seed:'part7d-contract-rejection'});
const view=workspace.buildDemoWorkspace({tenantId:tenant,sessionId:estimate,state,revision:1,
  simulationCount:0,persisted:true,expiresAt:new Date('2026-10-15T12:00:00Z')});
const canonical=demo.bundle(workspace.demoCanonicalItems(view)[0],1);
const applicationScript=fs.readFileSync('public/js/customer-financial-invoice-preview.js','utf8');
let responseMode='valid';
function payload() {
  const value=clone(canonical);
  if (responseMode==='invalid') {
    Object.assign(value.part7Acceptance.requirements[0],{state:'unavailable',reason:'forged_reason'});
    value.part7Acceptance.sandbox.providerAccountId='acct_victim';
    value.part7Acceptance.adapterSchema.callerAuthoredProviderObjectAccepted=true;
    value.part7Acceptance.rollout.rollbackCanMarkInvoicePaid=true;
    value.part7Acceptance.driftAndDisconnect.automaticReconnectAuthorized=true;
    value.part7Acceptance.access.staffRoleMaySubstituteForCustomerSession=true;
    value.part7Acceptance.protections.missingAmountMayBeTreatedAsZero=true;
    value.part7Acceptance.methods[0].policyState='unsupported';
    value.part7Acceptance.methods[1].policyState='launch_supported';
  }
  return value;
}
const html=`<!doctype html><html><head><meta charset="utf-8"><title>Part 7 contract rejection</title></head>
<body><main id="host"></main><script src="/invoice-preview.js"></script><script>
window.NorthStarCustomerFinancialInvoicePreview.mount({simulated:true,pins:{estimateId:'${estimate}'}},document.getElementById('host'));
</script></body></html>`;

(async()=>{
  let browser; let server;
  const requests=[];
  try {
    server=http.createServer((request,response)=>{
      requests.push(request.url);
      if(request.url==='/'){response.writeHead(200,{'Content-Type':'text/html'});return response.end(html);}
      if(request.url==='/invoice-preview.js'){response.writeHead(200,{'Content-Type':'application/javascript'});return response.end(applicationScript);}
      if(request.url===`/api/demo/customer-financial/invoice-drafts/${estimate}/part7-acceptance`){
        response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
        return response.end(JSON.stringify({success:true,data:payload()}));
      }
      response.writeHead(404); response.end();
    }).listen(0,'127.0.0.1');
    await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
    const runtime=resolveBrowserRuntime(engine);
    browser=await runtime.browserType.launch({headless:true,executablePath:runtime.executablePath});
    const page=await browser.newPage({viewport:{width:390,height:844},colorScheme:'dark'});
    const pageErrors=[]; page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle'});
    const summary=page.locator('summary'); await summary.focus(); await summary.press('Enter');
    await page.getByText('Payment provider and initiation',{exact:true}).waitFor();
    assert.equal(await page.locator('.invoice-part7-acceptance').count(),1);
    assert.equal(await page.getByText('acct_victim',{exact:false}).count(),0);
    await summary.focus(); await summary.press('Enter');
    assert.equal(await page.locator('.invoice-draft-preview-document').count(),0);
    responseMode='invalid'; await summary.focus(); await summary.press('Enter');
    const alert=page.locator('[role=alert]'); await alert.waitFor();
    assert.equal(await page.locator('.invoice-draft-preview-document').count(),0);
    assert.equal(await page.locator('.invoice-part5-acceptance').count(),0);
    assert.equal(await page.locator('.invoice-part6-acceptance').count(),0);
    assert.equal(await page.locator('.invoice-part7-acceptance').count(),0);
    assert.equal(await page.locator('.invoice-draft-preview-lines').count(),0);
    assert.equal(await page.getByText(/\$/).count(),0);
    assert.equal(await page.getByText('acct_victim',{exact:false}).count(),0);
    assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('[role=alert]')),true);
    responseMode='valid';
    const retry=page.getByRole('button',{name:'Retry invoice preview'}); await retry.focus(); await retry.press('Enter');
    await page.getByText('Payment provider and initiation',{exact:true}).waitFor();
    assert.equal(await page.locator('.invoice-part7-acceptance').count(),1);
    assert.equal(await page.locator('.invoice-part7-requirements li').count(),10);
    assert.equal(await page.locator('.invoice-part7-controls li').count(),8);
    assert.equal(await page.locator('.invoice-part7-methods li').count(),2);
    assert.deepEqual(pageErrors,[]);
    assert.ok(requests.filter(value=>value.includes('/part7-acceptance')).length>=3);
    process.stdout.write(JSON.stringify({engine,validRender:true,contradictionRejected:true,
      privateStateCleared:true,guardedRecovery:true,requestInterceptions:0,responseInterceptions:0})+'\n');
  } finally {
    if(browser) await browser.close();
    if(server) await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
