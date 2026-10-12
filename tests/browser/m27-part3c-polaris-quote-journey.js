'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { MISSION_26_FIVE_LAYOUTS, auditRenderedPage, exerciseSkipLink } =
  require('../helpers/m26-part12d-rendered-review');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm27-part3c-polaris-quote-browser-20261011';
const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });

const estimateId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const grants = {
  'customer_financial.estimate.edit_options': { grantId:'33333333-3333-4333-8333-333333333333', revision:1,
    businessPurpose:'customer_financial.polaris_quote_options', policyVersion:'mission27.launch.v1' },
  'customer_financial.estimate.request_signature': { grantId:'44444444-4444-4444-8444-444444444444', revision:1,
    businessPurpose:'customer_financial.polaris_quote_signature_request', policyVersion:'mission27.launch.v1' },
};
const baseDraft = { version:'polaris.editable.estimate.v1', estimateId, customerId,
  sourceDigest:'a'.repeat(64), sourceRevisionDigest:'b'.repeat(64), currency:'USD', revision:0,
  state:'ready_to_edit', draftDigest:null, options:[{ id:'good', ordinal:0, name:'Good',
    scope:'Repair the reviewed fence.', validityDays:30, assumptions:[], optionDigest:null,
    total:{minorUnits:'50000'}, lines:[{id:'repair',ordinal:0,description:'Fence repair',quantity:'1',unit:'job',
      price:{version:'m27-exact-money-v1',currency:'USD',minorUnitExponent:2,minorUnits:'50000',decimal:'500.00',exactZero:false}}] }],
  capabilities:grants, signature:{state:'unavailable',reason:'legal_review_unavailable'},
  workHandoff:{state:'unavailable',reason:'work_handoff_receiver_unavailable'} };

const runtimeScript = `(function(){
 var saved=null,proposal=null,calls=[],delayed=null;window.m27Part3cCalls=calls;
 window.m27Part3cFailNextGet=false;window.m27Part3cDelayNextGet=false;window.m27Part3cHasDelayed=false;
 function response(status,data){return Promise.resolve({ok:status>=200&&status<300,status:status,json:function(){return Promise.resolve({success:true,data:data});}});}
 function failure(status,message){return Promise.resolve({ok:false,status:status,json:function(){return Promise.resolve({success:false,error:{category:'TEST_UNAVAILABLE',message:message}});}});}
 function current(){if(!saved)return ${JSON.stringify(baseDraft)};return {state:'current',draft:saved,proposal:proposal,proposalState:proposal?'proposal_current':null,capabilities:${JSON.stringify(grants)},signature:{state:'unavailable',reason:'legal_review_unavailable'},workHandoff:{state:'unavailable',reason:'work_handoff_receiver_unavailable'}};}
 window.m27Part3cResolveDelayed=function(){if(delayed){var resolve=delayed;delayed=null;window.m27Part3cHasDelayed=false;resolve(response(200,current()));}};
 window.NorthStarAccountSession={fetch:function(url,options){options=options||{};var method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({url:url,method:method,body:body});
  if(method==='GET'&&window.m27Part3cFailNextGet){window.m27Part3cFailNextGet=false;return failure(503,'Synthetic unavailable');}
  if(method==='GET'&&window.m27Part3cDelayNextGet){window.m27Part3cDelayNextGet=false;window.m27Part3cHasDelayed=true;return new Promise(function(resolve){delayed=resolve;});}
  if(method==='GET')return response(200,current());
  if(url.endsWith('/draft')){saved=body.draft;saved.revision=1;saved.draftDigest='c'.repeat(64);saved.updatedAt='2026-10-11T12:00:00.000Z';return response(201,{draft:saved});}
  if(url.endsWith('/proposal')){proposal={id:body.proposalId,revision:body.proposalRevision,proposalDigest:'d'.repeat(64),automaticDelivery:false};return response(201,{state:'proposal_current',proposal:proposal});}
  return response(503,null);
 }};
})();`;
const moduleSource = fs.readFileSync(path.join(__dirname, '../../public/js/polaris-quote-journey.js'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark;--border-color:#b8bcc5;--surface:#fff;--surface-subtle:#f2eee5;--text-muted:#56606c}html[data-theme=dark]{--surface:#15181d;--surface-subtle:#22262d;--text-muted:#b8c0cb;color:#f5f5f5;background:#101216}body{margin:0;font:16px/1.45 system-ui;background:var(--surface);color:inherit}.skip-link{position:absolute;left:1rem;top:.5rem;transform:translateY(-200%)}.skip-link:focus{transform:none}.shell{max-width:980px;margin:auto;padding:4rem 1rem 2rem}.btn{border:1px solid #8e7534;border-radius:9px;padding:.65rem .8rem;background:transparent;color:inherit}.btn-primary{background:#8a681d;color:#fff}input,textarea{box-sizing:border-box;width:100%;padding:.6rem;border:1px solid var(--border-color);border-radius:8px;background:var(--surface);color:inherit}textarea{min-height:5rem}</style></head><body><a class="skip-link" href="#mainContent" tabindex="0">Skip to content</a><main id="mainContent" class="shell" tabindex="-1"><h1>Polaris quote review</h1><div id="host"></div></main><script>${runtimeScript}</script><script>${moduleSource}</script><script>NorthStarPolarisQuoteJourney.mount({simulated:false,pins:{estimateId:'${estimateId}'}},document.getElementById('host'));</script></body></html>`;

async function main() {
  const engine = process.argv.includes('--webkit') ? 'webkit' : 'chrome';
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ headless:true, executablePath:runtime.executablePath });
  const cases=[];
  try {
    for (const layout of MISSION_26_FIVE_LAYOUTS) {
      const context=await browser.newContext({viewport:{width:layout.width,height:layout.height},colorScheme:layout.colorScheme,reducedMotion:'reduce'});
      const page=await context.newPage(),errors=[],external=[];
      page.on('pageerror',error=>errors.push(error.message));
      const fixture='http://northstar.test/m27-part3c-fixture';
      page.on('request',request=>{if(request.url()!==fixture)external.push(request.url());});
      await page.route(fixture,route=>route.fulfill({contentType:'text/html',body:html.replace('<html>','<html data-theme="'+layout.colorScheme+'">')}));
      await page.goto(fixture);
      await page.locator('.polaris-quote-journey summary').focus(); await page.keyboard.press('Enter');
      await page.getByText('Ready for human review.',{exact:true}).waitFor({timeout:5000}).catch(async function(){
        throw new Error('Quote editor did not render: '+(await page.locator('body').innerText())+' | '+errors.join(' | '));
      });
      await page.getByLabel('Option name').fill('Reviewed repair');
      await page.getByLabel('Scope').fill('Repair every reviewed fence section.');
      await page.getByLabel('Assumptions, one per line').fill('Existing posts remain serviceable.');
      await page.getByLabel('Line item').fill('Reviewed fence repair');
      await page.getByLabel('Quantity').fill('2'); await page.getByLabel('Unit').fill('section');
      await page.getByLabel('Price (USD)').fill('281.48');
      await page.getByRole('button',{name:'Add option'}).focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('.polaris-quote-option').count(),2);
      await page.getByLabel('Review reason').fill('Owner reviewed every option and exact customer-facing price.');
      await page.getByText('I reviewed every option and price in this exact draft.').click();
      await page.getByRole('button',{name:'Save reviewed draft'}).focus();await page.keyboard.press('Enter');
      await page.getByText('Ready for human review.',{exact:true}).waitFor({timeout:5000}).catch(async function(){
        throw new Error('Quote draft did not save: '+(await page.locator('body').innerText())+' | '+errors.join(' | '));
      });
      await page.getByLabel('Review reason').fill('Owner reviewed this exact multi-option proposal.');
      await page.getByText('I reviewed every option and price in this exact draft.').click();
      await page.getByRole('button',{name:'Review multi-option proposal'}).focus();await page.keyboard.press('Enter');
      await page.getByText('Ready for human review.',{exact:true}).waitFor({timeout:5000}).catch(async function(){
        throw new Error('Proposal review did not settle: '+(await page.locator('body').innerText())+' | '+errors.join(' | '));
      });
      assert.equal(await page.getByText(/legal review is complete/).count(),1);
      assert.equal(await page.getByText(/Mission 23 receiver exists/).count(),1);
      const calls=await page.evaluate(()=>window.m27Part3cCalls);
      const save=calls.find(call=>call.url.endsWith('/draft'));
      assert.equal(save.body.draft.options[0].name,'Reviewed repair');
      assert.equal(save.body.draft.options[0].lines[0].price.minorUnits,'28148');
      assert.equal(save.body.draft.options.length,2);
      assert.ok(calls.some(call=>call.url.endsWith('/proposal')));
      assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
      await auditRenderedPage(page,{mainSelector:'#mainContent',layout});
      await exerciseSkipLink(page,{mainSelector:'#mainContent'});
      await page.locator('.polaris-quote-journey').screenshot({path:path.join(output,`${engine}-${layout.name}.png`)});
      const demoIsolation=await page.evaluate(function(estimateIdentity){var before=window.m27Part3cCalls.length;
        var host=document.createElement('div');document.body.appendChild(host);
        var mounted=NorthStarPolarisQuoteJourney.mount({simulated:true,pins:{estimateId:estimateIdentity}},host);
        return {mounted:Boolean(mounted),before:before,after:window.m27Part3cCalls.length,children:host.children.length};},estimateId);
      assert.deepEqual(demoIsolation,{mounted:false,before:demoIsolation.before,after:demoIsolation.before,children:0});
      await page.evaluate(function(estimateIdentity){window.m27Part3cFailNextGet=true;var host=document.createElement('div');
        host.id='recoveryHost';document.body.appendChild(host);
        NorthStarPolarisQuoteJourney.mount({simulated:false,pins:{estimateId:estimateIdentity}},host);},estimateId);
      await page.locator('#recoveryHost summary').click();
      await page.locator('#recoveryHost [role=alert]').waitFor({timeout:5000});
      await page.locator('#recoveryHost').getByRole('button',{name:'Reload quote'}).click();
      await page.locator('#recoveryHost').getByText('Ready for human review.',{exact:true}).waitFor({timeout:5000});
      await page.evaluate(function(estimateIdentity){window.m27Part3cDelayNextGet=true;var host=document.createElement('div');
        host.id='staleHost';document.body.appendChild(host);
        NorthStarPolarisQuoteJourney.mount({simulated:false,pins:{estimateId:estimateIdentity}},host);},estimateId);
      await page.locator('#staleHost summary').click();
      await page.waitForFunction(function(){return window.m27Part3cHasDelayed===true;});
      await page.evaluate(function(estimateIdentity){var host=document.createElement('div');host.id='newerHost';document.body.appendChild(host);
        NorthStarPolarisQuoteJourney.mount({simulated:false,pins:{estimateId:estimateIdentity}},host);
        window.m27Part3cResolveDelayed();},estimateId);
      await page.waitForTimeout(50);
      assert.equal(await page.locator('#staleHost .polaris-quote-option').count(),0);
      assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
      cases.push(layout.name);await context.close();
    }
    assert.equal(cases.length,5);console.log(JSON.stringify({engine,cases,liveMoneyEvidence:'not-run-deferred-first-paying-customer'}));
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
