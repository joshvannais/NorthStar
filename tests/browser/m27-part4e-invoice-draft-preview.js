'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { MISSION_26_FIVE_LAYOUTS, auditRenderedPage, exerciseSkipLink } =
  require('../helpers/m26-part12d-rendered-review');

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

const paidPreview = preview();
const demoPreview = preview({ fictional: true, revision: 1, subtotal: 960000, tax: 0, marker: 'Fictional reviewed project' });
const runtimeScript = `(function(){
 var calls=[],current=${JSON.stringify(paidPreview)},demo=${JSON.stringify(demoPreview)},delayed=null;
 window.m27Part4eCalls=calls;window.m27Part4eDelayNext=false;window.m27Part4eHasDelayed=false;window.m27Part4eFailNext=false;
 function response(status,data){return Promise.resolve({ok:status>=200&&status<300,status:status,json:function(){return Promise.resolve({success:status>=200&&status<300,data:data,error:status>=400?{message:'Synthetic currentness rejection'}:undefined});}});}
 window.m27Part4eUseNewer=function(){current=${JSON.stringify(preview({ revision: 5, subtotal: 36500, tax: 2281, marker: 'Newer reviewed electrical repair' }))};};
 window.m27Part4eResolveDelayed=function(){if(delayed){var pending=delayed;delayed=null;window.m27Part4eHasDelayed=false;pending.resolve(response(200,pending.snapshot));}};
 window.NorthStarAccountSession={fetch:function(url){calls.push(url);
  if(url.indexOf('/billable-work-review?sourceClass=final_balance')>=0)return response(200,{state:'reviewed_current',handoffReceipt:{receiptId:'${receiptId}',receiptDigest:'${digest('9')}'}});
  if(url.indexOf('/invoice-draft/preview?')>=0){if(window.m27Part4eFailNext){window.m27Part4eFailNext=false;return response(409,null);}if(window.m27Part4eDelayNext){window.m27Part4eDelayNext=false;window.m27Part4eHasDelayed=true;var snapshot=JSON.parse(JSON.stringify(current));return new Promise(function(resolve){delayed={resolve:resolve,snapshot:snapshot};});}return response(200,current);}
  if(url.indexOf('/api/demo/customer-financial/invoice-drafts/')===0)return response(200,demo);
  return response(503,null);
 }};
})();`;
const moduleSource = fs.readFileSync(path.join(__dirname, '../../public/js/customer-financial-invoice-preview.js'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{color-scheme:light dark;--border-color:#aaadb3;--surface:#fff;--surface-subtle:#f4f1e9;--focus-ring:#9b741b}html[data-theme=dark]{--surface:#12151a;--surface-subtle:#252931;color:#f5f5f5;background:#0c0f13}body{margin:0;font:16px/1.45 system-ui;background:var(--surface);color:inherit}.skip-link{position:absolute;left:1rem;top:-100%;padding:.5rem;background:Canvas;color:CanvasText}.skip-link:focus{top:.5rem}.shell{max-width:960px;margin:auto;padding:4rem 1rem 2rem}.btn{border:1px solid currentColor;border-radius:8px;padding:.65rem .8rem;background:transparent;color:inherit}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style></head><body><a class="skip-link" href="#mainContent" tabindex="0">Skip to content</a><main id="mainContent" class="shell" tabindex="-1"><h1>Invoice draft review</h1><div id="host"></div><div id="demoHost"></div></main><script>${runtimeScript}</script><script>${moduleSource}</script><script>NorthStarCustomerFinancialInvoicePreview.mount({simulated:false,pins:{estimateId:'${estimateId}'}},document.getElementById('host'));</script></body></html>`;

async function openPreview(page, host = '#host') {
  await page.locator(`${host} > .invoice-draft-preview > summary`).focus();
  await page.keyboard.press('Enter');
  await page.locator(`${host} .invoice-draft-preview-heading`).waitFor({ timeout: 5000 });
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
      await openPreview(page);
      assert.equal(await page.getByText('Invoice draft — not issued', { exact: true }).count(), 1);
      assert.equal(await page.getByText('Reviewed fence repair', { exact: true }).count(), 1);
      assert.equal(await page.getByText('$281.48', { exact: true }).count(), 2);
      assert.equal(await page.getByText('$17.59', { exact: true }).count(), 1);
      assert.equal(await page.getByText('$299.07', { exact: true }).count(), 1);
      assert.equal(await page.getByText('Unavailable', { exact: true }).count(), 1);
      assert.equal(await page.getByText(/Missing evidence is never shown as zero/).count(), 1);
      assert.equal(await page.getByText(/PDF and immutable customer-facing document generation begin/).count(), 1);
      assert.equal(await page.getByRole('button', { name: /issue|approve|send|collect/i }).count(), 0);

      await page.evaluate(() => { window.m27Part4eDelayNext = true; });
      await page.getByRole('button', { name: 'Reload current preview' }).focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.m27Part4eHasDelayed === true);
      await page.evaluate(() => { window.m27Part4eUseNewer(); });
      await page.locator('#host > .invoice-draft-preview > summary').click();
      await page.locator('#host > .invoice-draft-preview > summary').click();
      await page.getByText('Newer reviewed electrical repair', { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(await page.getByText('$387.81', { exact: true }).count(), 1);
      await page.evaluate(() => { window.m27Part4eResolveDelayed(); });
      await page.waitForTimeout(50);
      assert.equal(await page.getByText('Newer reviewed electrical repair', { exact: true }).count(), 1);
      assert.equal(await page.getByText('Reviewed fence repair', { exact: true }).count(), 0);

      await page.evaluate(() => { window.m27Part4eFailNext = true; });
      await page.getByRole('button', { name: 'Reload current preview' }).click();
      await page.locator('#host [role=alert]').waitFor({ timeout: 5000 });
      assert.equal(await page.locator('#host [role=alert]').evaluate(element => document.activeElement === element), true);
      assert.equal(await page.locator('#host table').count(), 0);
      assert.equal(await page.locator('#host').getByText('$387.81', { exact: true }).count(), 0);
      assert.equal(await page.locator('#host').getByRole('button', { name: 'Reload current preview' }).count(), 0);
      await page.getByRole('button', { name: 'Retry invoice preview' }).focus();
      await page.keyboard.press('Enter');
      await page.getByText('Newer reviewed electrical repair', { exact: true }).waitFor({ timeout: 5000 });
      assert.equal(await page.locator('#host .invoice-draft-preview-heading').evaluate(element => document.activeElement === element), true);

      await page.evaluate(estimate => { NorthStarCustomerFinancialInvoicePreview.mount({ simulated: true,
        pins: { estimateId: estimate } }, document.getElementById('demoHost')); }, estimateId);
      await openPreview(page, '#demoHost');
      assert.equal(await page.getByText(/Fictional demo · no customer, provider, invoice, receivable, or money action/).count(), 1);
      assert.equal(await page.getByText('Fictional reviewed project', { exact: true }).count(), 1);
      assert.equal(await page.locator('#demoHost').getByText('$9,600.00', { exact: true }).count(), 3);
      assert.equal(await page.locator('#demoHost').getByText('Unavailable', { exact: true }).count(), 1);
      const calls = await page.evaluate(() => window.m27Part4eCalls);
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
