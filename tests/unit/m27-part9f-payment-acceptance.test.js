'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/paymentPart9Acceptance');
const part5Contract = require('../../src/customerFinancial/invoicePart5Acceptance');
const part6Contract = require('../../src/customerFinancial/invoicePart6Acceptance');
const part7Contract = require('../../src/customerFinancial/paymentPart7Acceptance');
const demoPart6 = require('../../src/customerFinancial/demoInvoicePart6Acceptance');
const demo = require('../../src/customerFinancial/demoPaymentPart9Acceptance');
const workspace = require('../../src/commandCenter/workspace');
const invoicePreviewUi = require('../../public/js/customer-financial-invoice-preview');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function demoItem() {
  const tenant = '44444444-4444-4444-8444-444444444444';
  const state = workspace.createInitialDemoState(tenant, new Date('2026-10-15T12:00:00Z'),
    { seed:'part9f-payment' });
  const view = workspace.buildDemoWorkspace({ tenantId:tenant, sessionId:ESTIMATE, state,
    revision:1, simulationCount:0, persisted:true,
    expiresAt:new Date('2026-10-16T12:00:00Z') });
  return workspace.demoCanonicalItems(view)[0];
}
function paidPart7() {
  const demoBundle = demoPart6.bundle(demoItem(),1);
  const preview = {...demoBundle.preview,mode:'paid',fictional:false,
    documentPreview:{...demoBundle.preview.documentPreview,fictional:false},
    previewDigest:'b'.repeat(64)};
  const part5 = part5Contract.unavailable('paid', preview);
  const part5Bundle = part5Contract.bundle(preview, part5);
  const part6 = part6Contract.bundle(part5Bundle,
    part6Contract.unavailable('paid', part5.previewWitness));
  return part7Contract.bundle(part6, part7Contract.unavailable('paid', part6));
}

describe('Mission 27 Part 9F complete Part 9 acceptance', () => {
  test.each(['paid','demo'])('strictly composes whole-Part-9 value-free acceptance for %s', mode => {
    const part7 = mode === 'paid' ? paidPart7() :
      require('../../src/customerFinancial/demoPaymentPart7Acceptance').bundle(demoItem(),1);
    const sources = contract.defaultSources(part7);
    const value = contract.unavailable(mode, part7, sources);
    expect(contract.project(clone(value), mode, part7, sources)).toEqual(value);
    const bundle = contract.bundle(part7, value, sources);
    expect(contract.projectBundle(clone(bundle), mode)).toEqual(bundle);
    expect(value).toMatchObject({ contractVersion:'m27-payment-part9-acceptance-v1',
      policyVersion:'mission27.launch.v1', state:'unavailable',
      reason:'part9_financial_evidence_unavailable', mode, fictional:mode==='demo',
      exactCurrentnessRevalidated:true, customerReceiptRowCount:0, correctionRowCount:0,
      recoveryRowCount:0, accountingExportRowCount:0, accountingReconciliationRowCount:0,
      providerCallCount:0,providerMutationCount:0,receiverMutationCount:0,
      accountingMutationCount:0,liveMoneyMovementCount:0 });
    expect(value.sourceParts.map(source => source.part)).toEqual(['9A','9B','9C','9D','9E']);
    expect(value.sourceParts.every(source => source.state === 'unavailable' &&
      /^[0-9a-f]{64}$/.test(source.digest))).toBe(true);
    expect(new Set(value.sourceParts.map(source => source.digest)).size).toBe(5);
    expect(value.concurrency).toMatchObject({maximumConcurrentWriterPerAggregate:1,
      sameKeyChangedRequestConflicts:true,duplicateOrReplayMayRepeatEffect:false,
      arrivalOrderMayAuthorizeEffect:false,settledMoneyMayBeRefusedRetroactively:false,
      crossAxisSilentOverwriteAllowed:false,missingAmountOrEvidenceMayBecomeZero:false});
    expect(value.correctionRecovery).toMatchObject({correctionsAreAppendOnly:true,
      priorAcceptedEvidenceMayBeRewritten:false,exactOriginalRequestAndReceiptRequired:true,
      restoringExternalOrFinancialEffectRequiresDualControl:true,
      recoveryMayExceedOriginalRequest:false,staleOrChangedSourceClearsRenderedFinancialState:true});
    expect(value.customerReceipt).toMatchObject({
      numberingPattern:'RCT-{tenant_monotonic_10_digit_sequence}',serverAssigned:true,
      immutable:true,gapsAllowed:true,reuseAllowed:false,annualResetAllowed:false,
      checkReceivedRequiredWording:'check received — clearance unknown',
      receiptMayClaimProviderSettlementOrBankClearance:false,
      refundRequestIsCompletedRefund:false,providerDisputeErasesOriginalPayment:false,
      customerReceiptIdentity:null,publicReceiptRouteAvailable:false});
    expect(value.accounting).toMatchObject({state:'accounting_adapter_unavailable',
      adapter:'quickbooks_online.accounting_export.v1',supportedMode:'sandbox',
      runtimeAvailable:false,exportAndAcknowledgementOnly:true,mayInventChartOfAccounts:false,
      mayDecideRecognitionOrTax:false,maySupplyCheckClearance:false,
      maximumExportRecords:1000,maximumExportMinorUnits:'100000000',
      singleControlMaximumRecords:100,singleControlMaximumMinorUnits:'10000000',
      manualReconciliationAlwaysDualControl:true,earnedRevenuePolicyAvailable:false});
    expect(value.acceptance).toEqual({sourceContractsRevalidated:true,
      wholePart9FunctionalBoundaryPresent:true,independentWholeHeadAuditAccepted:false,
      providerSandboxEvidenceAccepted:false,firstPayingCustomerLiveMoneyValidated:false,
      founderVisualApprovalAccepted:false});
  });

  test('rejects missing, reordered, contradictory and leaked server contract values', () => {
    const canonical = demo.bundle(demoItem(),1).part9Acceptance;
    expect(invoicePreviewUi.invalidPart9(clone(canonical),'demo')).toBe(false);
    const mutations = [
      value => value.sourceParts.reverse(),
      value => { value.sourceParts[0].digest='acct_leak'; },
      value => { value.concurrency.arrivalOrderMayAuthorizeEffect=true; },
      value => { value.concurrency.maximumConcurrentWriterPerAggregate=2; },
      value => { value.correctionRecovery.priorAcceptedEvidenceMayBeRewritten=true; },
      value => { value.correctionRecovery.recoveryMayExceedOriginalRequest=true; },
      value => { value.customerReceipt.checkReceivedRequiredWording='payment complete'; },
      value => { value.customerReceipt.receiptMayClaimProviderSettlementOrBankClearance=true; },
      value => { value.accounting.runtimeAvailable=true; },
      value => { value.accounting.maySupplyCheckClearance=true; },
      value => { value.accounting.maximumExportRecords=1001; },
      value => { value.access.staffRoleMaySubstituteForCustomerAccess=true; },
      value => { value.acceptance.independentWholeHeadAuditAccepted=true; },
      value => { value.acceptance.firstPayingCustomerLiveMoneyValidated=true; },
      value => { value.customerReceiptRowCount=1; },
    ];
    for (const mutate of mutations) { const value=clone(canonical); mutate(value);
      expect(invoicePreviewUi.invalidPart9(value,'demo')).toBe(true); }
    expect(invoicePreviewUi.invalidPart9(clone(canonical),'paid')).toBe(true);
  });

  test('binds a demo mount to its exact workspace revision across reset', () => {
    const preview=demo.bundle(demoItem(),1).preview;
    expect(invoicePreviewUi.matchesDemoWorkspaceRevision(preview,1)).toBe(true);
    expect(invoicePreviewUi.matchesDemoWorkspaceRevision(preview,2)).toBe(false);
    expect(invoicePreviewUi.matchesDemoWorkspaceRevision({...preview,
      draftIdentity:{...preview.draftIdentity,revision:2}},1)).toBe(false);
    expect(invoicePreviewUi.matchesDemoWorkspaceRevision(preview,null)).toBe(false);
  });

  test('revalidates the current Part 7 bundle on both sides of all Part 9 sources', async () => {
    const current = paidPart7(); const sources = contract.defaultSources(current);
    const repository = require('../../src/customerFinancial/paymentPart9AcceptanceRepository');
    const plan = require('../../src/customerFinancial/paymentInitiationPlan').unavailable();
    const settlement = require('../../src/customerFinancial/paymentSettlementPayout').unavailable();
    const origin = require('../../src/customerFinancial/depositApplication').unavailableOrigin();
    const correction = require('../../src/customerFinancial/invoicePostIssueCorrection').unavailable();
    const options = {
      readPart7: jest.fn().mockResolvedValue(current),
      readPaymentInitiationPlan: jest.fn().mockResolvedValue(plan),
      readSettlementPayout: jest.fn().mockResolvedValue(settlement),
      readInvoiceDraftOrigin: jest.fn().mockResolvedValue(origin),
      readPostIssueCorrection: jest.fn().mockResolvedValue(correction),
      readPaymentAttempt: jest.fn().mockResolvedValue(sources.paymentAttempt),
      readDepositApplication: jest.fn().mockResolvedValue(sources.depositApplication),
      readCreditRefund: jest.fn().mockResolvedValue(sources.creditRefund),
      readOfflinePayment: jest.fn().mockResolvedValue(sources.offlinePayment),
      readPaymentOutcome: jest.fn().mockResolvedValue(sources.paymentOutcome),
    };
    const source={organizationId:ESTIMATE,actorUserId:RECEIPT,actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333'};
    const expected=contract.bundle(current,contract.unavailable('paid',current,sources),sources);
    await expect(repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST,options))
      .resolves.toEqual(expected);
    expect(options.readPart7).toHaveBeenCalledTimes(2);
    options.readPart7.mockReset().mockResolvedValueOnce(current).mockResolvedValueOnce({
      ...current,preview:{...current.preview,previewDigest:'c'.repeat(64)},
      part5Acceptance:{...current.part5Acceptance,previewWitness:{
        ...current.part5Acceptance.previewWitness,previewDigest:'c'.repeat(64)}},
      part6Acceptance:{...current.part6Acceptance,previewWitness:{
        ...current.part6Acceptance.previewWitness,previewDigest:'c'.repeat(64)}},
      part7Acceptance:{...current.part7Acceptance,previewWitness:{
        ...current.part7Acceptance.previewWitness,previewDigest:'c'.repeat(64)}}});
    await expect(repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST,options))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_PAYMENT_PART9_CHANGED',status:409});
  });

  test('mounts only private paid and isolated demo reads and no Part 10 behavior', () => {
    const paid=read('src/routes/customerFinancialEditableEstimate.js');
    const demoRoute=read('src/routes/demo.js');
    const ui=read('public/js/customer-financial-invoice-preview.js');
    expect(paid).toContain("router.get('/:estimateId/payment-part9-acceptance'");
    expect(paid).not.toContain("router.post('/:estimateId/payment-part9-acceptance'");
    expect(demoRoute).toContain("router.get('/customer-financial/invoice-drafts/:estimateId/part9-acceptance'");
    expect(demoRoute).not.toContain("router.post('/customer-financial/invoice-drafts/:estimateId/part9-acceptance'");
    expect(ui).toContain("'/payment-part9-acceptance?");
    expect(ui).toContain("'/part9-acceptance'");
    expect(ui).toContain('function invalidPart9(value, expectedMode)');
    expect(ui).toContain('part9 = null');
    expect([read('src/customerFinancial/paymentPart9Acceptance.js'),
      read('src/customerFinancial/paymentPart9AcceptanceRepository.js'),
      read('src/customerFinancial/demoPaymentPart9Acceptance.js')].join('\n'))
      .not.toMatch(/Part ?10|collection reminder|promise.to.pay/i);
  });

  test('contains no provider, receiver, accounting or live-money effect path', () => {
    const source=[read('src/customerFinancial/paymentPart9Acceptance.js'),
      read('src/customerFinancial/paymentPart9AcceptanceRepository.js'),
      read('src/customerFinancial/demoPaymentPart9Acceptance.js')].join('\n');
    expect(source).not.toMatch(/https\.request|fetch\(|stripe\.|quickbooks.*request|INSERT\s+INTO|UPDATE\s+/i);
    expect(source).toContain('providerCallCount: 0');
    expect(source).toContain('accountingMutationCount: 0');
    expect(source).toContain('liveMoneyMovementCount: 0');
  });
});
