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
};
const baseDraft = { version:'polaris.editable.estimate.v1', estimateId, customerId,
  sourceDigest:'a'.repeat(64), sourceRevisionDigest:'b'.repeat(64),
  sourceProposalDigest:'d'.repeat(64), sourceProposalRevisionDigest:'e'.repeat(64),
  currency:'USD', revision:0,
  state:'ready_to_edit', draftDigest:null, options:[{ id:'good', ordinal:0, name:'Good',
    scope:'Repair the reviewed fence.', validityDays:30, assumptions:[], optionDigest:null,
    total:{minorUnits:'50000'}, lines:[{id:'repair',ordinal:0,description:'Fence repair',quantity:'1',unit:'job',
      price:{version:'m27-exact-money-v1',currency:'USD',minorUnitExponent:2,minorUnits:'50000',decimal:'500.00',exactZero:false}}] }],
  capabilities:grants, signature:{state:'unavailable',reason:'legal_review_unavailable'},
  workHandoff:{state:'unavailable',reason:'work_handoff_receiver_unavailable'} };
const sourceProposal = { version:'mission24.customer_estimate_version.v1',
  id:'55555555-5555-4555-8555-555555555555',revision:3,estimateId,customerId,
  sourceProposalDigest:'d'.repeat(64),sourceProposalRevisionDigest:'e'.repeat(64),reference:'EST-0003',
  reviewedRecipient:{state:'reviewed_current',name:'Taylor Customer',address:'123 Main St',digest:'f'.repeat(64)},
  acceptedEvidence:{id:'66666666-6666-4666-8666-666666666666',digest:'1'.repeat(64),acceptedAt:'2026-10-11T11:00:00.000Z'},
  issuedAt:'2026-10-11T10:00:00.000Z',sourceCurrent:true,automaticDelivery:false };

const runtimeScript = `(function(){
 var saved=null,calls=[],delayed=null;window.m27Part3cCalls=calls;
 window.m27Part3cFailNextGet=false;window.m27Part3cFailNextPost=false;window.m27Part3cDelayNextGet=false;window.m27Part3cHasDelayed=false;
 function response(status,data){return Promise.resolve({ok:status>=200&&status<300,status:status,json:function(){return Promise.resolve({success:true,data:data});}});}
 function failure(status,message){return Promise.resolve({ok:false,status:status,json:function(){return Promise.resolve({success:false,error:{category:'TEST_UNAVAILABLE',message:message}});}});}
  function history(before){var total=45,upper=before===null?total+1:before,entries=[];for(var revision=Math.min(total,upper-1);revision>=1&&entries.length<20;revision--){entries.push({revision:revision,actorUserId:'77777777-7777-4777-8777-777777777777',actorAccessRole:'owner',reason:revision===total?'Owner reviewed every option and exact price.':'Earlier authorized revision '+revision+'.',recordedAt:'2026-10-11T12:00:00.000Z',snapshotDigest:revision.toString(16).padStart(64,'0')});}var next=entries.length&&entries[entries.length-1].revision>1?entries[entries.length-1].revision:null;return {contractVersion:'m27-polaris-revision-history-v1',state:'current',currentRevision:total,historyDigest:'9'.repeat(64),sourceOriginal:{revision:0,sourceProposalDigest:'d'.repeat(64),sourceProposalRevisionDigest:'e'.repeat(64),snapshotDigest:'8'.repeat(64),recordedAt:'2026-10-11T10:00:00.000Z'},humanRevisions:entries,pagination:{limit:20,beforeRevision:before,returned:entries.length,total:total,order:'revision_desc',nextCursor:next,hasEarlier:next!==null,truncated:true},mission25Observation:{adapter:'mission25.tenant_edit_observation.v1',state:'unavailable',reason:'learning_permission_unavailable',value:null,published:false,automaticApplication:false},mission32Adapter:{name:'polaris.estimate_studio.adapter.v1',compatibleSchemaVersion:1,state:'compatible_contract',receiverExecutionAvailable:false,receiverMutationCount:0}};}
  function current(before){if(!saved)return Object.assign({},${JSON.stringify(baseDraft)},{sourceProposal:${JSON.stringify(sourceProposal)}});var page=history(before);return {state:'current',draft:saved,sourceProposal:${JSON.stringify(sourceProposal)},capabilities:${JSON.stringify(grants)},revisionHistory:page,mission25Observation:page.mission25Observation,mission32Adapter:page.mission32Adapter,signature:{state:'unavailable',reason:'legal_review_unavailable'},workHandoff:{state:'unavailable',reason:'work_handoff_receiver_unavailable'}};}
 window.m27Part3cSetServerOption=function(name,minor){if(!saved){saved=JSON.parse(JSON.stringify(${JSON.stringify(baseDraft)}));saved.revision=1;saved.draftDigest='c'.repeat(64);}saved.nameMarker=name;saved.options[0].name=name;saved.options[0].lines[0].price.minorUnits=minor;saved.options[0].lines[0].price.decimal=(BigInt(minor)/100n).toString()+'.'+(BigInt(minor)%100n).toString().padStart(2,'0');};
  window.m27Part3cResolveDelayed=function(){if(delayed){var pending=delayed;delayed=null;window.m27Part3cHasDelayed=false;pending.resolve(response(200,pending.snapshot));}};
 window.NorthStarAccountSession={fetch:function(url,options){options=options||{};var method=options.method||'GET',body=options.body?JSON.parse(options.body):null;calls.push({url:url,method:method,body:body});
  if(method==='GET'&&window.m27Part3cFailNextGet){window.m27Part3cFailNextGet=false;return failure(503,'Synthetic unavailable');}
   if(method==='GET'&&window.m27Part3cDelayNextGet){window.m27Part3cDelayNextGet=false;window.m27Part3cHasDelayed=true;var snapshot=JSON.parse(JSON.stringify(current(null)));return new Promise(function(resolve){delayed={resolve:resolve,snapshot:snapshot};});}
   if(method==='GET'){var parsed=new URL(url,'http://northstar.test');var before=parsed.searchParams.has('historyBefore')?Number(parsed.searchParams.get('historyBefore')):null;return response(200,current(before));}
  if(method==='POST'&&window.m27Part3cFailNextPost){window.m27Part3cFailNextPost=false;return failure(409,'Synthetic changed');}
   if(url.endsWith('/draft')){saved=body.draft;saved.revision=45;saved.draftDigest='c'.repeat(64);saved.updatedAt='2026-10-11T12:00:00.000Z';return response(201,{draft:saved});}
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
      await page.locator('.polaris-quote-journey > summary').focus(); await page.keyboard.press('Enter');
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
      await page.waitForFunction(function(){return window.m27Part3cCalls.filter(function(call){
        return call.method==='GET';}).length>=2;});
      await page.locator('#host').getByRole('button',{name:'Reload current quote'}).waitFor({timeout:5000});
      await page.getByText('Ready for human review.',{exact:true}).waitFor({timeout:5000}).catch(async function(){
        throw new Error('Quote draft did not save: '+(await page.locator('body').innerText())+' | '+errors.join(' | '));
      });
      assert.equal(await page.getByText(/Current Mission 24 issued proposal EST-0003/).count(),1);
      assert.equal(await page.getByText(/reviewed recipient and legal approval/).count(),1);
      assert.equal(await page.getByText(/reviewed Mission 23 receiver exists/).count(),1);
      const historySummary=page.getByText(/Revision history · source original \+ 45 human revisions/);
      assert.equal(await historySummary.count(),1);await historySummary.focus();await page.keyboard.press('Enter');
      assert.equal(await page.getByText(/Mission 25 learning remains unavailable/).count(),1);
      assert.equal(await page.getByText(/Mission 32 adapter polaris\.estimate_studio\.adapter\.v1 version 1/).count(),1);
      assert.equal(await page.getByText(/Revision 45 · Owner reviewed every option and exact price/).count(),1);
      assert.ok(await page.locator('.polaris-quote-history li').count()<=21);
      await page.getByRole('button',{name:'Show earlier revisions'}).focus();await page.keyboard.press('Enter');
      await page.getByText(/Revision history · source original \+ 45 human revisions/).waitFor();
      await page.getByText(/Revision history · source original \+ 45 human revisions/).focus();await page.keyboard.press('Enter');
      assert.equal(await page.getByText(/Revision 25 · Earlier authorized revision 25/).count(),1);
      assert.ok(await page.locator('.polaris-quote-history li').count()<=21);
      await page.getByRole('button',{name:'Show latest revisions'}).focus();await page.keyboard.press('Enter');
      await page.getByText(/Revision history · source original \+ 45 human revisions/).waitFor();
      const calls=await page.evaluate(()=>window.m27Part3cCalls);
      const save=calls.find(call=>call.url.endsWith('/draft'));
      assert.equal(save.body.draft.options[0].name,'Reviewed repair');
      assert.equal(save.body.draft.options[0].lines[0].price.minorUnits,'28148');
      assert.equal(save.body.draft.options.length,2);
      assert.equal(calls.some(call=>call.url.endsWith('/proposal')),false);
      assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
      await auditRenderedPage(page,{mainSelector:'#mainContent',layout});
      await exerciseSkipLink(page,{mainSelector:'#mainContent'});
      await page.locator('.polaris-quote-journey > summary').click();
      await page.getByText('Ready for human review.',{exact:true}).waitFor({timeout:5000});
      await page.locator('.polaris-quote-journey').screenshot({path:path.join(output,`${engine}-${layout.name}.png`)});
      await page.evaluate(function(){window.m27Part3cDelayNextGet=true;});
      await page.locator('#host').getByRole('button',{name:'Reload current quote'}).click();
      await page.waitForFunction(function(){return window.m27Part3cHasDelayed===true;});
      await page.evaluate(function(){window.m27Part3cSetServerOption('Newer server quote','12345');});
      const getCount=await page.evaluate(function(){return window.m27Part3cCalls.filter(function(call){return call.method==='GET';}).length;});
      await page.locator('#host > .polaris-quote-journey > summary').click();
      await page.waitForFunction(function(minimum){return window.m27Part3cCalls.filter(function(call){
        return call.method==='GET';}).length>=minimum;},getCount+1);
      await page.waitForFunction(function(){return Array.from(document.querySelectorAll('#host input')).some(function(input){return input.value==='Newer server quote';});});
      await page.locator('#host > .polaris-quote-journey > summary').click();
      await page.getByLabel('Option name').waitFor({timeout:5000});
      assert.equal(await page.getByLabel('Option name').inputValue(),'Newer server quote');
      await page.evaluate(function(){window.m27Part3cResolveDelayed();});
      await page.waitForTimeout(50);
      assert.equal(await page.locator('input').evaluateAll(function(inputs){return inputs.filter(function(input){return input.value==='Newer server quote';}).length;}),1);
      assert.equal(await page.locator('input').evaluateAll(function(inputs){return inputs.filter(function(input){return input.value==='281.48';}).length;}),0);
      await page.getByLabel('Review reason').fill('This rejected mutation must clear every stale value.');
      await page.getByText('I reviewed every option and price in this exact draft.').click();
      await page.evaluate(function(){window.m27Part3cFailNextPost=true;});
      await page.getByRole('button',{name:'Save reviewed draft'}).click();
      await page.locator('#host [role=alert]').waitFor({timeout:5000});
      assert.equal(await page.locator('#host .polaris-quote-option').count(),0);
      assert.equal(await page.locator('input').evaluateAll(function(inputs){return inputs.filter(function(input){return input.value==='Newer server quote';}).length;}),0);
      assert.equal(await page.locator('input').evaluateAll(function(inputs){return inputs.filter(function(input){return input.value==='123.45';}).length;}),0);
      assert.equal(await page.locator('#host').getByRole('button',{name:'Save reviewed draft'}).count(),0);
      assert.equal(await page.locator('#host').getByText(/Mission 24 issued proposal/).count(),0);
      assert.equal(await page.locator('#host .polaris-quote-history').count(),0);
      await page.locator('#host').getByRole('button',{name:'Reload current quote'}).click();
      await page.getByLabel('Option name').waitFor({timeout:5000});
      assert.equal(await page.getByLabel('Option name').inputValue(),'Newer server quote');
      const demoIsolation=await page.evaluate(function(estimateIdentity){var before=window.m27Part3cCalls.length;
        var host=document.createElement('div');document.body.appendChild(host);
        var mounted=NorthStarPolarisQuoteJourney.mount({simulated:true,pins:{estimateId:estimateIdentity}},host);
        return {mounted:Boolean(mounted),before:before,after:window.m27Part3cCalls.length,children:host.children.length};},estimateId);
      assert.deepEqual(demoIsolation,{mounted:false,before:demoIsolation.before,after:demoIsolation.before,children:0});
      await page.evaluate(function(estimateIdentity){window.m27Part3cFailNextGet=true;var host=document.createElement('div');
        host.id='recoveryHost';document.body.appendChild(host);
        NorthStarPolarisQuoteJourney.mount({simulated:false,pins:{estimateId:estimateIdentity}},host);},estimateId);
      await page.locator('#recoveryHost > .polaris-quote-journey > summary').click();
      await page.locator('#recoveryHost [role=alert]').waitFor({timeout:5000});
      await page.locator('#recoveryHost').getByRole('button',{name:'Reload current quote'}).click();
      await page.locator('#recoveryHost').getByText('Ready for human review.',{exact:true}).waitFor({timeout:5000});
      assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
      cases.push(layout.name);await context.close();
    }
    assert.equal(cases.length,5);console.log(JSON.stringify({engine,cases,liveMoneyEvidence:'not-run-deferred-first-paying-customer'}));
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
