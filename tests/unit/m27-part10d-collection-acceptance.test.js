'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/collectionPart10Acceptance');
const part5Contract = require('../../src/customerFinancial/invoicePart5Acceptance');
const part6Contract = require('../../src/customerFinancial/invoicePart6Acceptance');
const part7Contract = require('../../src/customerFinancial/paymentPart7Acceptance');
const part9Contract = require('../../src/customerFinancial/paymentPart9Acceptance');
const demoPart6 = require('../../src/customerFinancial/demoInvoicePart6Acceptance');
const demo = require('../../src/customerFinancial/demoCollectionPart10Acceptance');
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
    { seed:'part10d-collection' });
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
function paidPart9() {
  const part7 = paidPart7();
  const sources = part9Contract.defaultSources(part7);
  return part9Contract.bundle(part7, part9Contract.unavailable('paid', part7, sources), sources);
}

describe('Mission 27 Part 10D complete Part 10 acceptance', () => {
  test.each(['paid','demo'])('strictly composes whole-Part-10 value-free acceptance for %s', mode => {
    const part9 = mode === 'paid' ? paidPart9() :
      require('../../src/customerFinancial/demoPaymentPart9Acceptance').bundle(demoItem(),1);
    const sources = contract.defaultSources();
    const value = contract.unavailable(mode, part9, sources);
    expect(contract.project(clone(value), mode, part9, sources)).toEqual(value);
    const bundle = contract.bundle(part9, value, sources);
    expect(contract.projectBundle(clone(bundle), mode)).toEqual(bundle);
    expect(value).toMatchObject({contractVersion:'m27-collection-part10-acceptance-v1',
      policyVersion:'mission27.launch.v1',state:'unavailable',
      reason:'part10_collection_evidence_unavailable',mode,fictional:mode==='demo',
      exactCurrentnessRevalidated:true,receivableRowCount:0,collectionReviewRowCount:0,
      promiseToPayRowCount:0,handoffRequestRowCount:0,manualResendRequestRowCount:0,
      outboundMessageCount:0,providerCallCount:0,providerMutationCount:0,
      receiverMutationCount:0,accountingMutationCount:0,liveMoneyMovementCount:0});
    expect(value.sourceParts.map(source => source.part)).toEqual(['10A','10B','10C']);
    expect(value.sourceParts.map(source => source.state)).toEqual(['incomplete','unavailable','unavailable']);
    expect(value.sourceParts.every(source => /^[0-9a-f]{64}$/.test(source.digest))).toBe(true);
    expect(new Set(value.sourceParts.map(source => source.digest)).size).toBe(3);
    expect(value.failureRetry).toMatchObject({state:'unavailable',
      orderedFailureStates:['source_unavailable','source_changed','request_rejected',
        'retry_currentness_unknown','cooldown_unknown','receiver_unavailable','delivery_evidence_unknown'],
      exactCurrentSourceRequiredBeforeEveryRetry:true,humanReviewedRetryRequired:true,
      automaticReminderRetryOrChargeSupported:false,priorProviderSessionMayBeReused:false,
      missingOrUnknownCooldownDenies:true,failedOrRejectedRequestMayCreateEffect:false,
      changedSourceMayReusePriorRequestOrReceipt:false,
      retryMayBypassRecipientCapabilityAssuranceOrControl:false,
      retryMayExceedOriginalReviewedRequest:false,
      staleGenerationOrDelayedResponseMayRepopulateRenderedState:false});
    expect(value.revocation).toMatchObject({state:'unavailable',reason:'revocation_authority_unavailable',
      everyAxisRevalidatedBeforeDisplayOrAction:true,
      revocationClearsRenderedPrivateAndCollectionState:true,
      revokedInvoiceDocumentSessionRecipientOrCheckoutMayBeReused:false,
      revokedCapabilityDeliveryAuthorityReceiverOrReceiptMayAuthorize:false,
      roleOrRetryMayBypassRevocation:false,revocationCreatesFinancialOrExternalEffect:false});
    expect(value.revocation.orderedRevocationAxes).toEqual(['issued_invoice_or_document',
      'scoped_customer_session','reviewed_recipient','delivery_authority',
      'provider_checkout_session','collection_capability','mission28_receiver','idempotency_receipt']);
    expect(value.access).toEqual({eligiblePaidRoles:['owner','admin'],
      currentTenantSessionRequired:true,currentSubscriptionRequired:true,
      roleAloneAuthorizesCollectionAction:false,scopedCustomerSessionRequiredForCustomerAction:true,
      staffRoleMaySubstituteForCustomerSession:false,demoPhysicallyAndLogicallyIsolated:true,
      tenantCrossingAllowed:false});
    expect(Object.values(value.privacy).every(entry => entry === false)).toBe(true);
    expect(value.acceptance).toEqual({sourceContractsRevalidated:true,
      wholePart10FunctionalBoundaryPresent:true,paidDemoIsolationAccepted:true,
      failureRetryRevocationPrivacyBoundaryPresent:true,
      independentWholeHeadAuditAccepted:false,firstPayingCustomerLiveMoneyValidated:false,
      founderVisualApprovalAccepted:false});
  });

  test('rejects missing, reordered, contradictory and leaked server contract values', () => {
    const canonical = demo.bundle(demoItem(),1).part10Acceptance;
    expect(invoicePreviewUi.invalidPart10(clone(canonical),'demo')).toBe(false);
    const mutations = [
      value => value.sourceParts.reverse(),
      value => { value.sourceParts[0].digest='customer@example.test'; },
      value => { value.failureRetry.orderedFailureStates.reverse(); },
      value => { value.failureRetry.automaticReminderRetryOrChargeSupported=true; },
      value => { value.failureRetry.priorProviderSessionMayBeReused=true; },
      value => { value.revocation.orderedRevocationAxes.reverse(); },
      value => { value.revocation.roleOrRetryMayBypassRevocation=true; },
      value => { value.access.staffRoleMaySubstituteForCustomerSession=true; },
      value => { value.privacy.recipientOrContactDetailExposed=true; },
      value => { value.acceptance.independentWholeHeadAuditAccepted=true; },
      value => { value.acceptance.firstPayingCustomerLiveMoneyValidated=true; },
      value => { value.outboundMessageCount=1; },
    ];
    for (const mutate of mutations) { const value=clone(canonical); mutate(value);
      expect(invoicePreviewUi.invalidPart10(value,'demo')).toBe(true); }
    expect(invoicePreviewUi.invalidPart10(clone(canonical),'paid')).toBe(true);
  });

  test('revalidates the current Part 9 bundle around all Part 10 sources', async () => {
    const current = paidPart9(); const sources = contract.defaultSources();
    const repository = require('../../src/customerFinancial/collectionPart10AcceptanceRepository');
    const options = {
      readPart9: jest.fn().mockResolvedValue(current),
      readReceivableAging: jest.fn().mockResolvedValue(sources.receivableAging),
      readCollectionReview: jest.fn().mockResolvedValue(sources.collectionReview),
      readCollectionHandoff: jest.fn().mockResolvedValue(sources.collectionHandoff),
    };
    const source={organizationId:ESTIMATE,actorUserId:RECEIPT,actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333'};
    const expected=contract.bundle(current,contract.unavailable('paid',current,sources),sources);
    await expect(repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST,options))
      .resolves.toEqual(expected);
    expect(options.readPart9).toHaveBeenCalledTimes(2);
    expect(options.readCollectionReview).toHaveBeenCalledWith(source,
      expect.objectContaining({readReceivableAging:expect.any(Function)}));
    expect(options.readCollectionHandoff).toHaveBeenCalledWith(source,
      expect.objectContaining({readCollectionReview:expect.any(Function)}));
    const changed=clone(current); changed.preview.previewDigest='c'.repeat(64);
    changed.part5Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part6Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part7Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part9Acceptance.previewWitness.previewDigest='c'.repeat(64);
    options.readPart9.mockReset().mockResolvedValueOnce(current).mockResolvedValueOnce(changed);
    await expect(repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST,options))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_COLLECTION_PART10_CHANGED',status:409});
  });

  test('builds the repository candidate from each strict current source without legacy recomposition', () => {
    const part9=paidPart9(); const sources=contract.defaultSources();
    const project=jest.spyOn(part9Contract,'projectBundle');
    try {
      const value=contract.candidate(part9,'paid',sources);
      expect(project).toHaveBeenCalledTimes(1);
      project.mockRestore();
      expect(value).toEqual(contract.bundle(part9,
        contract.unavailable('paid',part9,sources),sources));
    } finally { if (project.mockRestore) project.mockRestore(); }
    expect(()=>contract.candidate(part9,'paid',{...sources,extra:true}))
      .toThrow(/source contracts invalid/);
    const changed=clone(sources);changed.collectionReview.state='ready';
    expect(()=>contract.candidate(part9,'paid',changed)).toThrow();
    let reads=0;
    const unread={get preview(){reads+=1;throw new Error('read');}};
    expect(()=>contract.candidate(unread,'other',sources)).toThrow(/mode invalid/);
    expect(reads).toBe(0);
  });

  test('mounts only private paid and isolated demo reads and clears Part 10 state', () => {
    const paid=read('src/routes/customerFinancialEditableEstimate.js');
    const demoRoute=read('src/routes/demo.js');
    const ui=read('public/js/customer-financial-invoice-preview.js');
    expect(paid).toContain("router.all('/:estimateId/collection-part10-acceptance'");
    expect(paid).toContain("if (req.method === 'GET') return next()");
    expect(paid).toContain("router.get('/:estimateId/collection-part10-acceptance'");
    expect(paid).not.toContain("router.post('/:estimateId/collection-part10-acceptance'");
    expect(demoRoute).toContain("router.all('/customer-financial/invoice-drafts/:estimateId/part10-acceptance'");
    expect(demoRoute).toContain("code: 'demo_collection_part10_method_not_allowed'");
    expect(demoRoute).toContain("router.get('/customer-financial/invoice-drafts/:estimateId/part10-acceptance'");
    expect(demoRoute).not.toContain("router.post('/customer-financial/invoice-drafts/:estimateId/part10-acceptance'");
    expect(ui).toContain("'/reporting-part12-acceptance?");
    expect(ui).toContain("'/part14b-acceptance'");
    expect(ui).not.toContain("'/part12-acceptance'");
    expect(ui).not.toContain("'/accounting-part11-acceptance?");
    expect(ui).not.toContain("'/part11-acceptance'");
    expect(ui).not.toContain("'/collection-part10-acceptance?");
    expect(ui).not.toContain("'/part10-acceptance'");
    expect(ui).toContain('function invalidPart10(value, expectedMode)');
    expect(ui).toContain('part10 = null; part11 = null');
  });

  test('contains no provider, receiver, accounting or live-money effect path', () => {
    const source=[read('src/customerFinancial/collectionPart10Acceptance.js'),
      read('src/customerFinancial/collectionPart10AcceptanceRepository.js'),
      read('src/customerFinancial/demoCollectionPart10Acceptance.js')].join('\n');
    expect(source).not.toMatch(/https\.request|fetch\(|stripe\.|quickbooks.*request|INSERT\s+INTO|UPDATE\s+/i);
    expect(source).toContain('outboundMessageCount: 0');
    expect(source).toContain('providerCallCount: 0');
    expect(source).toContain('receiverMutationCount: 0');
    expect(source).toContain('accountingMutationCount: 0');
    expect(source).toContain('liveMoneyMovementCount: 0');
  });
});
