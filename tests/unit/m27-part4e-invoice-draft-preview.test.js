'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoiceDraftPreview');
const demo = require('../../src/customerFinancial/demoInvoiceDraftPreview');
const workspace = require('../../src/commandCenter/workspace');
const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const UUID = '11111111-1111-4111-8111-111111111111';
const DIGEST = 'a'.repeat(64);
const exact = minorUnits => { const value=BigInt(minorUnits); return { version:'m27-exact-money-v1',
  currency:'USD',minorUnitExponent:2,minorUnits:value.toString(),decimal:`${value/100n}.${String(value%100n).padStart(2,'0')}`,
  exactZero:value===0n }; };
function paid() {
  const missingEvidence = ['professional_tax_policy_review','deposit','prior','credit','refund','tax']
    .map(source => ({ source, state:'unavailable', reason:'evidence_unavailable' }));
  const reconciliation = { version:'m27-invoice-draft-total-reconciliation-v1',
    subtotalBeforeTax:exact('10000'),preparedTax:exact('625'),preparedDocumentTotal:{state:'preparation_only',
      reason:'professional_tax_policy_unavailable',value:exact('10625')},amountDue:{state:'unavailable',
      reason:'invoice_reconciliation_evidence_unavailable',value:null,missingEvidence},
    zeroRequiresExplicitSupportedArithmetic:true,missingEvidenceTreatedAsZero:false,browserArithmeticUsed:false };
  const line={ordinal:0,sourceLineDigest:DIGEST,group:'Service',description:'Customer-safe work',
    quantity:{version:'m27-invoice-quantity-v1',value:'1',unit:'customer_safe_charge',meaning:'One charge'},
    amount:exact('10000'),tax:exact('625'),taxTreatment:'taxable',inclusiveExclusive:'exclusive'};
  const documentPreview={version:'m27-invoice-draft-document-preview-v1',state:'review_required',fictional:false,
    label:'Invoice draft — not issued',lines:[line],reconciliation,pdf:{state:'unavailable',reason:'not_authorized',value:null},
    customerFacingDocumentAuthorized:false,issuedDocument:false};
  return {contractVersion:contract.CONTRACT_VERSION,state:'current',mode:'paid',fictional:false,
    draftIdentity:{estimateId:UUID,originId:UUID,originDigest:DIGEST,revision:1,draftDigest:DIGEST,
      historyChainDigest:DIGEST,componentsDigest:DIGEST,preparationDigest:DIGEST},documentPreview,reconciliation,
    professionalTaxPolicy:{state:'unavailable',reason:'tax_authority_unavailable',value:null},sourceCurrent:true,
    commercialSourceAuthorityCurrent:true,taxAuthorityCurrent:false,amountDueCurrent:false,
    invoiceAuthorized:false,receivableAuthorized:false,issueAuthorized:false,providerCallCount:0,
    receiverMutationCount:0,previewDigest:DIGEST};
}

describe('Mission 27 Part 4E invoice-draft preview', () => {
  const migration=read('migrations/272_customer_financial_invoice_draft_preview_v1.sql');
  test('reconciles exact subtotal, prepared tax and preview total without manufacturing amount due', () => {
    const value=contract.project(paid());
    expect(value.reconciliation.preparedDocumentTotal.value.minorUnits).toBe('10625');
    expect(value.reconciliation.amountDue.value).toBeNull();
    expect(value.invoiceAuthorized).toBe(false);
    const mismatch=paid();mismatch.reconciliation.preparedDocumentTotal.value=exact('10624');
    mismatch.documentPreview.reconciliation=mismatch.reconciliation;
    expect(()=>contract.project(mismatch)).toThrow();
    const lineMismatch=paid();lineMismatch.documentPreview.lines[0].amount=exact('9999');
    expect(()=>contract.project(lineMismatch)).toThrow();
    const duplicatedGap=paid();duplicatedGap.reconciliation.amountDue.missingEvidence[5]=
      duplicatedGap.reconciliation.amountDue.missingEvidence[0];
    duplicatedGap.documentPreview.reconciliation=duplicatedGap.reconciliation;
    expect(()=>contract.project(duplicatedGap)).toThrow();
    const zero=paid();zero.reconciliation.subtotalBeforeTax=exact('0');zero.reconciliation.preparedTax=exact('0');
    zero.reconciliation.preparedDocumentTotal.value=exact('0');zero.documentPreview.lines[0].amount=exact('0');
    zero.documentPreview.lines[0].tax=exact('0');zero.documentPreview.reconciliation=zero.reconciliation;
    expect(contract.project(zero).reconciliation.amountDue.state).toBe('unavailable');
  });
  test('returns every failed paid gate value-free', () => {
    expect(contract.unavailable({contractVersion:contract.CONTRACT_VERSION,state:'unavailable',mode:'paid',
      fictional:false,reason:'invoice_preview_source_conflict',value:null,sourceCurrent:false,
      commercialSourceAuthorityCurrent:false,taxAuthorityCurrent:false,amountDueCurrent:false,
      invoiceAuthorized:false,receivableAuthorized:false,issueAuthorized:false,providerCallCount:0,
      receiverMutationCount:0}).value).toBeNull();
  });
  test('projects a resettable isolated fictional demo with no external effect', () => {
    const tenant='22222222-2222-4222-8222-222222222222',now=new Date('2026-10-13T12:00:00Z');
    const state=workspace.createInitialDemoState(tenant,now,{seed:'part4e-preview'});
    const view=workspace.buildDemoWorkspace({tenantId:tenant,sessionId:UUID,state,revision:1,
      simulationCount:0,persisted:true,expiresAt:new Date('2026-10-14T12:00:00Z')});
    const value=demo.project(workspace.demoCanonicalItems(view)[0],1);
    expect(value.mode).toBe('demo');expect(value.fictional).toBe(true);
    expect(value.documentPreview.label).toContain('Fictional');
    expect(value.reconciliation.amountDue.value).toBeNull();
    expect(value.providerCallCount).toBe(0);expect(value.receiverMutationCount).toBe(0);
  });
  test('mounts guarded paid and account-free demo reads and withholds the private helper', () => {
    const paidRoute=read('src/routes/customerFinancialEditableEstimate.js');
    const demoRoute=read('src/routes/demo.js');const authority=read('src/customerFinancial/databaseAuthority.js');
    expect(paidRoute).toContain("router.get('/:estimateId/invoice-draft/preview'");
    expect(paidRoute).toContain("router.post('/:estimateId/invoice-draft/workflow-capability'");
    expect(paidRoute).toContain("res.set('Cache-Control','no-store'); res.vary('Cookie');");
    expect(demoRoute).toContain("router.get('/customer-financial/invoice-drafts/:estimateId/preview'");
    expect(authority).toContain("'canonical_customer_financial_invoice_draft_preview_v1_read'");
    expect(authority).toContain("'canonical_customer_financial_invoice_draft_workflow_v1_grant'");
    expect('canonical_customer_financial_invoice_draft_workflow_v1_grant'.length).toBeLessThanOrEqual(63);
    const entries=authority.slice(authority.indexOf('const ENTRIES'),authority.indexOf('const TABLES'));
    expect(entries).not.toContain('preview_v1_unavailable');
    expect(entries).not.toContain("'canonical_customer_financial_invoice_draft_v1_issue_grant'");
    expect(migration).toContain('CREATE FUNCTION public.canonical_customer_financial_invoice_draft_workflow_v1_grant');
    expect(migration).toContain('canonical_customer_financial_invoice_draft_components_v1_read');
    expect(migration).toContain('canonical_customer_financial_invoice_tax_review_v1_read');
    expect(migration).toContain('canonical_customer_financial_invoice_draft_v1_issue_grant');
    expect(migration).toContain('canonical_customer_financial_billable_review_v1_read');
    expect(migration).toContain("'missingEvidenceTreatedAsZero',FALSE");
    expect(migration).toContain("'browserArithmeticUsed',FALSE");
  });
  test('mounts the same currentness-clearing preview module on every estimate surface', () => {
    const ui=read('public/js/customer-financial-invoice-preview.js');
    const browser=read('tests/browser/m27-part4e-invoice-draft-preview.js');
    const mounted=read('tests/browser/m27-part4e-mounted-paid-journey.js');
    const mountedFixture=read('tests/helpers/m27-part4e-paid-journey-fixture.js');
    expect(ui).toContain('requestToken += 1; clearAndStatus');
    expect(ui).toContain('mountToken === mountGeneration');
    expect(ui).toContain("'/invoice-draft/workflow-capability'");
    expect(ui).toContain("'/invoice-draft-origin'");
    expect(ui).toContain("'/invoice-draft/tax-review'");
    expect(ui).toContain("confirmationVersion: 'm27-invoice-draft-revision-save-v1'");
    expect(ui).toContain('function clearCollapsed() { requestToken += 1; data = null; part5 = null; part6 = null; part7 = null; part9 = null; part10 = null; part11 = null; part12 = null; part14b = null; context = null; body.replaceChildren(); }');
    expect(ui).toContain("summary.addEventListener('keydown', function (event) {");
    expect(ui).toContain("event.key !== 'Enter'");
    expect(ui).toContain('event.preventDefault(); if (event.repeat) return;');
    expect(ui).toContain("summary.addEventListener('keyup', function (event) {");
    expect(ui).toContain("summary.addEventListener('pointerdown', function () {");
    expect(ui).toContain("summary.addEventListener('click', function (event) {");
    expect(ui).toContain('event.preventDefault();');
    expect(ui).toContain('keyboardActivationState');
    expect(ui).toContain('keyboardActivationSequence');
    expect(ui).toContain('sequence: ++keyboardActivationSequence');
    expect(ui).toContain('if (keyboardActivationState !== null)');
    expect(ui).not.toContain('keyboardActivationState !== null && event.detail === 0');
    expect(ui).toContain('keyboardActivationState = null;');
    expect(ui).not.toContain('keyboardActivationState.expiresAt');
    expect(ui).toContain('var opening = !section.open; desiredOpenState = opening;');
    expect(ui).toContain('settleKeyboardDisclosure(keyboardActivationState);');
    expect(ui).toContain('activation.sequence !== keyboardActivationSequence');
    expect(ui).toContain('section.open = activation.desiredOpen;');
    expect(ui).toContain('if (section.open !== desiredOpenState) section.open = desiredOpenState;');
    expect(ui).toContain("disclosureObserver.observe(section, { attributes: true, attributeFilter: ['open'] });");
    expect(ui).toContain('disconnect: function () { disclosureObserver.disconnect(); }');
    expect(ui).toContain('Missing evidence is never shown as zero.');
    ['Exact tax preparation evidence to review','Registration evidence','Nexus evidence',
      'Exemption snapshot','Rounding identity','Separated collected-tax liability',
      'Credit/refund lineage','Professional tax policy'].forEach(label=>expect(ui).toContain(label));
    expect(ui).toContain('line.taxableBasis');expect(ui).toContain('line.collectedTax');
    expect(ui).toContain('line.inclusiveExclusive');expect(ui).toContain('line.ratePercent');
    expect(ui).toContain('line.invoiceSourceLineDigest');expect(ui).toContain('line.mission24LineId');
    expect(ui).toContain('line.taxGroupId');
    expect(ui).toContain('source.ruleDigest');expect(ui).toContain('lineage.missingEvidence');
    expect(browser).toContain('for (const layout of MISSION_26_FIVE_LAYOUTS)');
    expect(browser).toContain('m27Part4eDelayNext');
    expect(browser).toContain('m27Part4eFailNext');
    expect(browser).toContain('completePaidWorkflow(page)');
    expect(browser).toContain("name: 'Capture reviewed invoice source'");
    expect(browser).toContain("name: 'Save reviewed invoice draft'");
    expect(browser).toContain("name: 'Record tax preparation review'");
    expect(browser).toContain('A settled preview never survives collapse');
    expect(browser).toContain("exerciseSkipLink(page, { mainSelector: '#mainContent' })");
    expect(browser).toContain("assert.equal(cases.length, 5)");
    expect(mounted).toContain("page.goto(origin + '/dashboard'");
    expect(mounted).toContain('createPart4ePaidBrowserFixture()');
    expect(mounted).not.toContain('page.route(');
    expect(mounted).not.toContain('NorthStarAccountSession={');
    expect(mounted).toContain('for (let index = 0; index < MISSION_26_FIVE_LAYOUTS.length; index += 1)');
    expect(mounted).toContain("name: 'Capture reviewed invoice source'");
    expect(mounted).toContain("name: 'Save reviewed invoice draft'");
    expect(mounted).toContain("name: 'Record tax preparation review'");
    expect(mounted).toContain('correctDraftThroughRealSession');
    expect(mounted).toContain("root.locator('[role=alert]')");
    expect(mountedFixture).toContain('reviewed Mission 27 Part 3 final-balance handoff');
    expect(mountedFixture).toContain('deliberately stops before every Part 4 effect');
    const pages=['public/dashboard.html','public/demo-dashboard.html','public/dashboard/command-center.html',
      'public/dashboard/communications.html','public/dashboard/leads.html','public/dashboard/polaris.html'];
    pages.forEach(page=>expect(read(page)).toContain('/js/customer-financial-invoice-preview.js?v=m27-part12d'));
    expect(read('public/js/customer-detail.js')).toContain('NorthStarCustomerFinancialInvoicePreview.mount');
    expect(read('public/js/customer-detail.js')).toContain('NorthStarCustomerFinancialInvoicePreview.preserveMountedDisclosure');
    expect(read('public/js/customer-detail.js')).toContain("if(preservedInvoice)Array.from(estimateHub.childNodes).forEach(function(child){if(child!==preservedInvoice)child.remove();});else estimateHub.replaceChildren()");
  });
  test('keeps migration order exact through one additive 272', () => {
    const names=fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.filter(name=>/^272_/.test(name))).toHaveLength(1);
  });
});
