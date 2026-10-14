'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { MISSION_26_FIVE_LAYOUTS, auditRenderedPage, exerciseSkipLink } =
  require('../helpers/m26-part12d-rendered-review');
const part5Contract = require('../../src/customerFinancial/invoicePart5Acceptance');

const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });

const estimateId = '11111111-1111-4111-8111-111111111111';
const receiptId = '22222222-2222-4222-8222-222222222222';
const digest = value => value.repeat(64);
const money = minorUnits => ({
  version: 'm27-exact-money-v1', currency: 'USD', minorUnitExponent: 2,
  minorUnits: String(minorUnits), decimal: `${Math.trunc(Number(minorUnits) / 100)}.${String(Number(minorUnits) % 100).padStart(2, '0')}`,
  exactZero: String(minorUnits) === '0',
});
function preview({ fictional = false, revision = 4, subtotal = 28148, tax = 1759, marker = 'Reviewed fence repair' } = {}) {
  const total = subtotal + tax;
  const reconciliation = {
    version: 'm27-invoice-draft-total-reconciliation-v1',
    subtotalBeforeTax: money(subtotal), preparedTax: money(tax),
    preparedDocumentTotal: { state: 'preparation_only', reason: 'professional_tax_policy_unavailable', value: money(total) },
    amountDue: { state: 'unavailable', reason: 'invoice_reconciliation_evidence_unavailable', value: null,
      missingEvidence: ['professional_tax_policy_review', 'deposit', 'prior_payment', 'credit', 'refund', 'invoice_issue']
        .map(source => ({ source, state: 'unavailable', reason: 'evidence_unavailable' })) },
    zeroRequiresExplicitSupportedArithmetic: true, missingEvidenceTreatedAsZero: false, browserArithmeticUsed: false,
  };
  const line = { ordinal: 0, sourceLineDigest: digest(revision % 2 ? 'a' : 'b'), group: 'Service', description: marker,
    quantity: { version: 'm27-invoice-quantity-v1', value: '1', unit: 'customer_safe_charge', meaning: 'One charge' },
    amount: money(subtotal), tax: money(tax), taxTreatment: 'taxable', inclusiveExclusive: 'exclusive' };
  return { contractVersion: 'm27-invoice-draft-preview-v1', state: 'current', mode: fictional ? 'demo' : 'paid', fictional,
    draftIdentity: { estimateId, originId: '33333333-3333-4333-8333-333333333333', originDigest: digest('1'),
      revision, draftDigest: digest(revision % 2 ? '2' : '3'), historyChainDigest: digest('4'),
      componentsDigest: digest('5'), preparationDigest: digest('6') },
    documentPreview: { version: 'm27-invoice-draft-document-preview-v1', state: 'review_required', fictional,
      label: fictional ? 'Fictional invoice draft — not issued' : 'Invoice draft — not issued', lines: [line], reconciliation,
      pdf: { state: 'unavailable', reason: 'not_authorized', value: null }, customerFacingDocumentAuthorized: false,
      issuedDocument: false }, reconciliation,
    professionalTaxPolicy: { state: 'unavailable', reason: 'tax_authority_unavailable', value: null },
    sourceCurrent: true, commercialSourceAuthorityCurrent: true, taxAuthorityCurrent: false, amountDueCurrent: false,
    invoiceAuthorized: false, receivableAuthorized: false, issueAuthorized: false, providerCallCount: 0,
    receiverMutationCount: 0, previewDigest: digest(revision % 2 ? '7' : '8') };
}

const paidPreview = preview({ revision: 1 });
const demoPreview = preview({ fictional: true, revision: 1, subtotal: 960000, tax: 0, marker: 'Fictional reviewed project' });
const paidPart5 = part5Contract.unavailable('paid', paidPreview);
const demoPart5 = part5Contract.unavailable('demo', demoPreview);
const demoBundle = part5Contract.bundle(demoPreview, demoPart5);
const runtimeScript = `(function(){
 var calls=[],methods=[],current=${JSON.stringify(paidPreview)},demo=${JSON.stringify(demoPreview)},paidPart5=${JSON.stringify(paidPart5)},demoBundle=${JSON.stringify(demoBundle)},delayed=null;
 var originCaptured=false,draftSaved=false,taxRecorded=false,draftRevision=0,sourceRevision=0,taxRevision=0;
 var grant={contractVersion:'m27-invoice-draft-workflow-capability-v1',state:'current',capability:'customer_financial.invoice.edit_draft',grantId:'44444444-4444-4444-8444-444444444444',revision:1,businessPurpose:'customer_financial.invoice_draft',policyVersion:'mission27.launch.v1',estimateId:'${estimateId}',sourceCurrent:true,invoiceAuthorized:false,providerCallCount:0,receiverMutationCount:0};
 window.m27Part4eCalls=calls;window.m27Part4eMethods=methods;window.m27Part4eDelayNext=false;window.m27Part4eHasDelayed=false;window.m27Part4eFailNext=false;window.m27Part5eFailNext=false;window.m27Part5eMismatchNext=false;
 function response(status,data){return Promise.resolve({ok:status>=200&&status<300,status:status,json:function(){return Promise.resolve({success:status>=200&&status<300,data:data,error:status>=400?{message:'Synthetic currentness rejection'}:undefined});}});}
 function bundleFor(previewValue){var acceptance=JSON.parse(JSON.stringify(paidPart5));acceptance.previewWitness.draftRevision=previewValue.draftIdentity.revision;acceptance.previewWitness.draftDigest=previewValue.draftIdentity.draftDigest;acceptance.previewWitness.previewDigest=previewValue.previewDigest;return {contractVersion:'m27-invoice-part5-preview-bundle-v1',preview:JSON.parse(JSON.stringify(previewValue)),acceptance:acceptance};}
 function sourceDigest(){return sourceRevision===0?'${digest('1')}':sourceRevision===1?'${digest('b')}':'${digest('c')}';}
 function taxDigest(){return taxRevision===0?'${digest('f')}':taxRevision===1?'${digest('e')}':'${digest('d')}';}
 function receiptDigest(){return sourceRevision===0?'${digest('9')}':sourceRevision===1?'${digest('8')}':'${digest('6')}';}
 function sourceMoney(){return sourceRevision===0?${JSON.stringify(money(28148))}:sourceRevision===1?${JSON.stringify(money(36500))}:${JSON.stringify(money(41200))};}
 function preparedTax(){return taxRevision===0?${JSON.stringify(money(1759))}:taxRevision===1?${JSON.stringify(money(2281))}:${JSON.stringify(money(2575))};}
 function sourceDescription(){return sourceRevision===0?(draftSaved?'Reviewed fence repair':'Fence repair'):sourceRevision===1?'Newer reviewed electrical repair':'Newest reviewed roof repair';}
 function draft(){return {contractVersion:'m27-invoice-draft-revision-v1',state:'current',originId:'33333333-3333-4333-8333-333333333333',originDigest:sourceDigest(),candidateDigest:'${digest('c')}',revision:draftRevision,draftDigest:draftRevision?'${digest('d')}':'${digest('e')}',historyChainDigest:'${digest('4')}',currency:'USD',subtotalBeforeTax:sourceMoney(),lines:[{ordinal:0,sourceLineDigest:sourceRevision===0?'${digest('a')}':sourceDigest(),group:'Service',description:sourceDescription(),quantity:{version:'m27-invoice-quantity-v1',value:'1',unit:'customer_safe_charge'},allocatedAmount:sourceMoney()}],sourceCurrent:true,invoiceAuthorized:false,receivableAuthorized:false,issueAuthorized:false,providerCallCount:0,receiverMutationCount:0};}
 function tax(){var source={kind:'owner_recorded',jurisdiction:'US-MA',location:'service',serviceKey:'fence_installation',collectionBasis:'destination',reference:'Reviewed commercial source',effectiveOn:'2026-01-01',endsOn:null,reviewedOn:'2026-10-01',reviewValidThrough:'2026-12-31',ruleId:'ma-fence-v1',ruleDigest:'${digest('a')}'};return {contractVersion:'m27-invoice-date-tax-review-v1',state:taxRecorded?'recorded_policy_unavailable':'ready_to_record',candidateDigest:taxDigest(),professionalPolicy:{state:'unavailable',reason:'tax_authority_unavailable',value:null,missingEvidence:['professional_tax_policy_review']},preparation:{version:'m27-invoice-date-tax-preparation-v1',invoiceDate:taxRevision?'2026-10-14':'2026-10-13',invoiceDraft:{originId:'33333333-3333-4333-8333-333333333333',originDigest:sourceDigest(),revision:draftRevision,draftDigest:'${digest('d')}',historyChainDigest:'${digest('4')}',currency:'USD',subtotalBeforeTax:sourceMoney()},billingIdentity:{billingPartyId:'55555555-5555-4555-8555-555555555555',reviewId:'66666666-6666-4666-8666-666666666666',reviewSequence:1,reviewDigest:'${digest('b')}'},mission24:{authorityClass:'mission24.current_accepted_tax_preparation',issuedVersionId:'77777777-7777-4777-8777-777777777777',issuedRevision:1,issuedDigest:'${digest('c')}',documentDigest:'${digest('d')}',termsId:'88888888-8888-4888-8888-888888888888',termsRevision:1,termsDigest:'${digest('e')}',decisionDigest:'${digest('f')}',calculationVersion:'estimate-commercial-terms-v2',taxAuthorityClass:'owner_recorded'},serviceJurisdiction:{countryCode:'US',region:'MA',city:'Boston',postalCode:'02108'},billingJurisdiction:{countryCode:'US',region:'MA',city:'Boston',postalCode:'02108'},registrationEvidence:{state:'unavailable',reason:'registration_evidence_unavailable',value:null},nexusEvidence:{state:'unavailable',reason:'professional_tax_policy_unavailable',value:null},exemptionSnapshot:{classification:'none_recorded',evidenceReference:'Customer statement',profileExemptionReference:null},rounding:{version:'mission24.canonical_commercial_numeric_round.v1',mode:'half_away_from_zero',minorUnitExponent:2},lines:[{ordinal:0,invoiceSourceLineDigest:sourceDigest(),mission24LineId:'fence-line',taxGroupId:'ma-fence',treatment:'taxable',inclusiveExclusive:'exclusive',ratePercent:'6.25',taxableBasis:sourceMoney(),collectedTax:preparedTax(),source:source}],collectedTaxLiability:{amount:preparedTax(),arithmeticRole:'tax_liability_separate_from_commercial_subtotal',revenueRecognitionAuthorized:false,filingAuthorized:false},creditRefundAdjustmentLineage:{state:'unavailable',reason:'credit_refund_lineage_unavailable',value:null,missingEvidence:['credit_adjustment_source','refund_adjustment_source']},sourceCurrent:true,providerCalculationUsed:false,browserArithmeticUsed:false}};}
 window.m27Part4eUseNewer=function(){sourceRevision=1;taxRevision=1;draftRevision=2;current=${JSON.stringify(preview({ revision: 2, subtotal: 36500, tax: 2281, marker: 'Newer reviewed electrical repair' }))};current.draftIdentity.originDigest=sourceDigest();current.draftIdentity.draftDigest='${digest('d')}';current.draftIdentity.preparationDigest=taxDigest();};
 window.m27Part4eUseNewest=function(){sourceRevision=2;taxRevision=2;draftRevision=3;current=${JSON.stringify(preview({ revision: 3, subtotal: 41200, tax: 2575, marker: 'Newest reviewed roof repair' }))};current.draftIdentity.originDigest=sourceDigest();current.draftIdentity.draftDigest='${digest('d')}';current.draftIdentity.preparationDigest=taxDigest();};
 window.m27Part4eResolveDelayed=function(){if(delayed){var pending=delayed;delayed=null;window.m27Part4eHasDelayed=false;pending.resolve(response(200,pending.snapshot));}};
 window.NorthStarAccountSession={fetch:function(url,options){calls.push(url);var method=options&&options.method||'GET';methods.push(method+' '+url);
  if(url.indexOf('/billable-work-review?sourceClass=final_balance')>=0)return response(200,{state:'reviewed_current',handoffReceipt:{receiptId:'${receiptId}',receiptDigest:receiptDigest()}});
  if(url.indexOf('/invoice-draft/workflow-capability')>=0)return response(200,grant);
  if(url.indexOf('/invoice-draft-origin')>=0){if(method==='POST'){originCaptured=true;return response(201,{state:'current'});}return response(200,originCaptured?{state:'current'}:{state:'ready_to_capture',candidateDigest:'${digest('0')}'});}
  if(url.indexOf('/invoice-draft/tax-review')>=0){if(method==='POST'){taxRecorded=true;return response(201,tax());}return response(200,tax());}
  if(url.indexOf('/invoice-draft/preview?')>=0)return response(200,current);
  if(url.indexOf('/invoice-part5-acceptance?')>=0){if(window.m27Part4eFailNext||window.m27Part5eFailNext){window.m27Part4eFailNext=false;window.m27Part5eFailNext=false;return response(409,null);}if(window.m27Part4eDelayNext){window.m27Part4eDelayNext=false;window.m27Part4eHasDelayed=true;var snapshot=bundleFor(current);return new Promise(function(resolve){delayed={resolve:resolve,snapshot:snapshot};});}var bundle=bundleFor(current);if(window.m27Part5eMismatchNext){window.m27Part5eMismatchNext=false;bundle.acceptance.previewWitness.previewDigest='${digest('0')}';}return response(200,bundle);}
  if(url.endsWith('/invoice-draft')||url.indexOf('/invoice-draft?')>=0){if(method==='POST'){draftSaved=true;draftRevision+=1;return response(201,draft());}return response(200,draft());}
  if(url.indexOf('/api/demo/customer-financial/invoice-drafts/')===0)return response(200,url.endsWith('/part5-acceptance')?demoBundle:demo);
  return response(503,null);
 }};
})();`;
new Function(runtimeScript);
const moduleSource = fs.readFileSync(path.join(__dirname, '../../public/js/customer-financial-invoice-preview.js'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark;--border-color:#aaadb3;--surface:#fff;--surface-subtle:#f4f1e9;--focus-ring:#9b741b}html[data-theme=dark]{--surface:#12151a;--surface-subtle:#252931;color:#f5f5f5;background:#0c0f13}body{margin:0;font:16px/1.45 system-ui;background:var(--surface);color:inherit}.skip-link{position:absolute;left:1rem;top:-100%;padding:.5rem;background:Canvas;color:CanvasText}.skip-link:focus{top:.5rem}.shell{max-width:960px;margin:auto;padding:4rem 1rem 2rem}.btn{border:1px solid currentColor;border-radius:8px;padding:.65rem .8rem;background:transparent;color:inherit}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style></head><body><a class="skip-link" href="#mainContent" tabindex="0">Skip to content</a><main id="mainContent" class="shell" tabindex="-1"><h1>Invoice draft review</h1><div id="host"></div><div id="demoHost"></div></main><script>${runtimeScript}</script><script>${moduleSource}</script><script>NorthStarCustomerFinancialInvoicePreview.mount({simulated:false,pins:{estimateId:'${estimateId}'}},document.getElementById('host'));</script></body></html>`;

async function openPreview(page, host = '#host') {
  await page.locator(`${host} > .invoice-draft-preview > summary`).focus();
  await page.keyboard.press('Enter');
  await page.locator(`${host} .invoice-draft-preview-heading`).waitFor({ timeout: 5000 });
}

async function completePaidWorkflow(page) {
  await openPreview(page);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Capture reviewed invoice source' }).click();
  await page.getByRole('button', { name: 'Save reviewed invoice draft' }).waitFor({ timeout: 5000 });
  await page.getByLabel('Customer description').fill('Reviewed fence repair');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save reviewed invoice draft' }).click();
  await page.getByRole('button', { name: 'Record tax preparation review' }).waitFor({ timeout: 5000 });
  assert.equal(await page.getByText('Exact tax preparation evidence to review', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Taxable basis', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Prepared tax', { exact: true }).count(), 1);
  assert.equal(await page.getByText(/Mission 24 line fence-line · tax group ma-fence · invoice source digest/).count(), 1);
  assert.equal(await page.getByText(/owner_recorded · US-MA · service · fence_installation/).count(), 1);
  assert.equal(await page.getByText(/Unavailable · registration_evidence_unavailable/).count(), 1);
  assert.equal(await page.getByText(/unavailable · professional_tax_policy_unavailable/).count(), 1);
  assert.equal(await page.getByText(/none_recorded · Customer statement · not recorded/).count(), 1);
  assert.equal(await page.getByText(/mission24\.canonical_commercial_numeric_round\.v1 · half_away_from_zero/).count(), 1);
  assert.equal(await page.getByText(/tax_liability_separate_from_commercial_subtotal/).count(), 1);
  assert.equal(await page.getByText(/unavailable · credit_refund_lineage_unavailable/).count(), 1);
  assert.equal(await page.getByText('Missing evidence · credit_adjustment_source', { exact: true }).count(), 1);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Record tax preparation review' }).click();
  await page.getByText('Invoice draft — not issued', { exact: true }).waitFor({ timeout: 5000 });
}

async function main() {
  const engine = process.argv.includes('--webkit') ? 'webkit' : 'chrome';
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
  const cases = [];
  try {
    for (const layout of MISSION_26_FIVE_LAYOUTS) {
      const context = await browser.newContext({ viewport: { width: layout.width, height: layout.height },
        colorScheme: layout.colorScheme, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors = [], external = [];
      page.on('pageerror', error => errors.push(error.message));
      const fixture = 'http://northstar.test/m27-part4e-fixture';
      page.on('request', request => { if (request.url() !== fixture) external.push(request.url()); });
      await page.route(fixture, route => route.fulfill({ contentType: 'text/html',
        body: html.replace('<html>', `<html data-theme="${layout.colorScheme}">`) }));
      await page.goto(fixture);
      await completePaidWorkflow(page);
      assert.equal(await page.getByText('Invoice draft — not issued', { exact: true }).count(), 1);
      assert.equal(await page.getByText('Reviewed fence repair', { exact: true }).count(), 1);
      assert.equal(await page.getByText('$281.48', { exact: true }).count(), 2);
      assert.equal(await page.getByText('$17.59', { exact: true }).count(), 1);
      assert.equal(await page.getByText('$299.07', { exact: true }).count(), 1);
      assert.equal(await page.getByText('Unavailable', { exact: true }).count(), 1);
      assert.equal(await page.getByText(/Missing evidence is never shown as zero/).count(), 1);
      assert.equal(await page.getByText(/PDF and immutable customer-facing document generation begin/).count(), 1);
      assert.equal(await page.getByText('Approval, issue, and invoice lifecycle', { exact: true }).count(), 1);
      assert.equal(await page.locator('#host .invoice-part5-axes li').count(), 7);
      assert.equal(await page.locator('#host .invoice-part5-corrections li').count(), 4);
      assert.equal(await page.getByRole('button', { name: /issue|approve|send|collect/i }).count(), 0);

      const mountedMethods = await page.evaluate(() => window.m27Part4eMethods);
      assert.equal(mountedMethods.some(value => value.startsWith('POST ') && value.includes('/invoice-draft-origin')), true);
      assert.equal(mountedMethods.some(value => value.startsWith('POST ') && /\/invoice-draft$/.test(value)), true);
      assert.equal(mountedMethods.some(value => value.startsWith('POST ') && value.includes('/invoice-draft/tax-review')), true);

      // A settled preview never survives collapse. Reopen performs the full
      // guarded currentness chain before rendering the newer exact values.
      await page.locator('#host > .invoice-draft-preview > summary').click();
      await page.locator('#host table').waitFor({ state: 'detached', timeout: 5000 });
      assert.equal(await page.locator('#host table').count(), 0);
      assert.equal(await page.locator('#host').getByText('$299.07', { exact: true }).count(), 0);
      const reopenMethodOffset = mountedMethods.length;
      await page.evaluate(() => { window.m27Part4eUseNewer(); });
      await page.locator('#host > .invoice-draft-preview > summary').click();
      await page.getByText('Newer reviewed electrical repair', { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(await page.getByText('$387.81', { exact: true }).count(), 1);
      const reopenMethods = (await page.evaluate(() => window.m27Part4eMethods)).slice(reopenMethodOffset);
      for (const path of ['/billable-work-review?sourceClass=final_balance',
        '/invoice-draft/workflow-capability','/invoice-draft-origin?','/invoice-draft?',
        '/invoice-draft/tax-review?','/invoice-part5-acceptance?']) {
        assert.equal(reopenMethods.some(value => value.includes(path)), true,
          `reopen must revalidate ${path}`);
      }

      await page.evaluate(() => { window.m27Part4eDelayNext = true; });
      await page.getByRole('button', { name: 'Reload current preview' }).focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.m27Part4eHasDelayed === true);
      await page.evaluate(() => { window.m27Part4eUseNewest(); });
      await page.locator('#host > .invoice-draft-preview > summary').click();
      await page.locator('#host > .invoice-draft-preview > summary').click();
      await page.getByText('Newest reviewed roof repair', { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(await page.getByText('$437.75', { exact: true }).count(), 1);
      await page.evaluate(() => { window.m27Part4eResolveDelayed(); });
      await page.waitForTimeout(50);
      assert.equal(await page.getByText('Newest reviewed roof repair', { exact: true }).count(), 1);
      assert.equal(await page.getByText('Newer reviewed electrical repair', { exact: true }).count(), 0);

      await page.evaluate(() => { window.m27Part4eFailNext = true; });
      await page.getByRole('button', { name: 'Reload current preview' }).click();
      await page.locator('#host [role=alert]').waitFor({ timeout: 5000 });
      assert.equal(await page.locator('#host [role=alert]').evaluate(element => document.activeElement === element), true);
      assert.equal(await page.locator('#host table').count(), 0);
      assert.equal(await page.locator('#host').getByText('$437.75', { exact: true }).count(), 0);
      assert.equal(await page.locator('#host').getByRole('button', { name: 'Reload current preview' }).count(), 0);
      await page.getByRole('button', { name: 'Retry invoice preview' }).focus();
      await page.keyboard.press('Enter');
      await page.getByText('Newest reviewed roof repair', { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(await page.locator('#host .invoice-draft-preview-heading').evaluate(element => document.activeElement === element), true);

      await page.evaluate(() => { window.m27Part5eFailNext = true; });
      await page.getByRole('button', { name: 'Reload current preview' }).click();
      await page.locator('#host [role=alert]').waitFor({ timeout: 5000 });
      assert.equal(await page.locator('#host .invoice-part5-acceptance').count(), 0);
      assert.equal(await page.locator('#host').getByText('$437.75', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Retry invoice preview' }).focus();
      await page.keyboard.press('Enter');
      await page.getByText('Approval, issue, and invoice lifecycle', { exact: true }).waitFor({ timeout: 5000 });

      await page.evaluate(() => { window.m27Part5eMismatchNext = true; });
      await page.getByRole('button', { name: 'Reload current preview' }).click();
      await page.locator('#host [role=alert]').waitFor({ timeout: 5000 });
      assert.equal(await page.locator('#host table').count(), 0);
      assert.equal(await page.locator('#host .invoice-part5-acceptance').count(), 0);
      assert.equal(await page.locator('#host').getByText('$437.75', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Retry invoice preview' }).focus();
      await page.keyboard.press('Enter');
      await page.getByText('Approval, issue, and invoice lifecycle', { exact: true }).waitFor({ timeout: 5000 });

      await page.evaluate(estimate => { NorthStarCustomerFinancialInvoicePreview.mount({ simulated: true,
        pins: { estimateId: estimate } }, document.getElementById('demoHost')); }, estimateId);
      await openPreview(page, '#demoHost');
      assert.equal(await page.getByText(/Fictional demo · no customer, provider, invoice, receivable, or money action/).count(), 1);
      assert.equal(await page.getByText('Fictional reviewed project', { exact: true }).count(), 1);
      assert.equal(await page.locator('#demoHost').getByText('$9,600.00', { exact: true }).count(), 3);
      assert.equal(await page.locator('#demoHost').getByText('Unavailable', { exact: true }).count(), 1);
      const calls = await page.evaluate(() => window.m27Part4eCalls);
      assert.equal(await page.locator('#demoHost .invoice-part5-axes li').count(), 7);
      assert.equal(await page.locator('#demoHost .invoice-part5-corrections li').count(), 4);
      assert.equal(calls.filter(url => url.startsWith('/api/demo/')).length, 1);
      assert.equal(calls.some(url => /provider|stripe|retell|jobber/i.test(url)), false);
      assert.deepEqual(external, []); assert.deepEqual(errors, []);

      await auditRenderedPage(page, { mainSelector: '#mainContent', layout });
      await page.screenshot({ fullPage: true, path: path.join(output, `${engine}-${layout.name}.png`) });
      await exerciseSkipLink(page, { mainSelector: '#mainContent' });
      cases.push(layout.name);
      await context.close();
    }
    assert.equal(cases.length, 5);
    console.log(JSON.stringify({ engine, cases, paidDemoParity: true, amountDue: 'unavailable',
      liveMoneyEvidence: 'not-run-deferred-first-paying-customer' }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
