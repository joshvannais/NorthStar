'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cors = require('cors');
const express = require('express');
const request = require('supertest');
const contract = require('../../src/customerFinancial/accountingExportReadiness');
const exportContract = require('../../src/customerFinancial/accountingExportContract');
const part5Contract = require('../../src/customerFinancial/invoicePart5Acceptance');
const part6Contract = require('../../src/customerFinancial/invoicePart6Acceptance');
const part7Contract = require('../../src/customerFinancial/paymentPart7Acceptance');
const part9Contract = require('../../src/customerFinancial/paymentPart9Acceptance');
const part10Contract = require('../../src/customerFinancial/collectionPart10Acceptance');
const demoPart6 = require('../../src/customerFinancial/demoInvoicePart6Acceptance');
const workspace = require('../../src/commandCenter/workspace');
const { corsOptions } = require('../../src/middleware/security');
const { createCustomerFinancialEditableEstimateRouter } =
  require('../../src/routes/customerFinancialEditableEstimate');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function paidPart10() {
  const tenant = '44444444-4444-4444-8444-444444444444';
  const state = workspace.createInitialDemoState(tenant, new Date('2026-10-15T12:00:00Z'),
    { seed:'part11b-accounting-readiness' });
  const view = workspace.buildDemoWorkspace({ tenantId:tenant, sessionId:ESTIMATE, state,
    revision:1, simulationCount:0, persisted:true,
    expiresAt:new Date('2026-10-16T12:00:00Z') });
  const demoBundle = demoPart6.bundle(workspace.demoCanonicalItems(view)[0],1);
  const preview = {...demoBundle.preview,mode:'paid',fictional:false,
    documentPreview:{...demoBundle.preview.documentPreview,fictional:false},
    previewDigest:'b'.repeat(64)};
  const part5 = part5Contract.unavailable('paid',preview);
  const part5Bundle = part5Contract.bundle(preview,part5);
  const part6 = part6Contract.bundle(part5Bundle,
    part6Contract.unavailable('paid',part5.previewWitness));
  const part7 = part7Contract.bundle(part6,part7Contract.unavailable('paid',part6));
  const part9Sources = part9Contract.defaultSources(part7);
  const part9 = part9Contract.bundle(part7,
    part9Contract.unavailable('paid',part7,part9Sources),part9Sources);
  const part10Sources = part10Contract.defaultSources();
  return part10Contract.bundle(part9,
    part10Contract.unavailable('paid',part9,part10Sources),part10Sources);
}
function sources() { const part10=paidPart10();
  return { part10, export:exportContract.unavailable(part10) }; }

describe('Mission 27 Part 11B accounting export readiness', () => {
  test('keeps exact OPTIONS inside the GET-only boundary before auth, throttle or source read', async () => {
    const route = `/api/v1/customer-financial/editable-estimates/${ESTIMATE}/accounting-export-readiness`;
    const resolveOptions = requestPath => new Promise((resolve, reject) => corsOptions({
      path: requestPath, header: () => undefined,
    }, (error, options) => error ? reject(error) : resolve(options)));
    await expect(resolveOptions(route)).resolves
      .toMatchObject({ methods: ['GET'], preflightContinue: true });
    await expect(resolveOptions(`${route}/`)).resolves
      .toMatchObject({ methods: ['GET'], preflightContinue: true });
    await expect(resolveOptions(route.replace(ESTIMATE,
      '11111111-1111-7111-8111-111111111111'))).resolves
      .toMatchObject({ methods: ['GET'], preflightContinue: true });
    await expect(resolveOptions(route.replace('accounting-export-readiness',
      'accounting-export-contract'))).resolves.toMatchObject({ preflightContinue: false });

    const calls = { auth:0, role:0, throttle:0, read:0 };
    const app = express(); app.use(cors(corsOptions));
    app.use('/api/v1/customer-financial/editable-estimates',
      createCustomerFinancialEditableEstimateRouter({
        poolProvider: () => { throw new Error('pool must not be reached'); },
        accountingExportReadinessRead: async () => { calls.read += 1; },
        auth: (_req,_res,next) => { calls.auth += 1; next(); },
        role: (_req,_res,next) => { calls.role += 1; next(); },
        throttle: (_req,_res,next) => { calls.throttle += 1; next(); },
      }));
    const response = await request(app).options(route)
      .set('Origin','http://localhost:3000').set('Access-Control-Request-Method','POST');
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET');
    expect(response.headers['access-control-allow-methods']).toBe('GET');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body.error.category)
      .toBe('CUSTOMER_FINANCIAL_ACCOUNTING_EXPORT_READINESS_METHOD_NOT_ALLOWED');
    expect(calls).toEqual({ auth:0, role:0, throttle:0, read:0 });
  });

  test('projects exact owner destination, mapping, preview, transmission and receipt contracts', () => {
    const source=sources(); const value=contract.unavailable(source.export,source.part10);
    expect(contract.project(clone(value),source.export,source.part10)).toEqual(value);
    expect(value).toMatchObject({
      contractVersion:'m27-accounting-export-readiness-v1',state:'unavailable',
      reason:'accounting_destination_and_export_authority_unavailable',value:null,
      exactCurrentnessRevalidated:true,destinationSelectionCount:0,mappingReviewCount:0,
      exportPreviewCount:0,transmissionCount:0,acknowledgementCount:0,
      partialFailureRecordCount:0,accountingMutationCount:0,providerCallCount:0,
      receiverMutationCount:0,liveMoneyMovementCount:0,
    });
    expect(value.destination).toMatchObject({
      contractVersion:'m27-accounting-destination-selection-v1',state:'unavailable',
      launchAdapter:'quickbooks_online.accounting_export.v1',launchMode:'sandbox',
      runtimeAvailable:false,ownerSelectionRequired:true,selectionEligibleRoles:['owner'],
      administratorMaySelectDestination:false,roleAloneAuthorizesSelectionOrTransmission:false,
      selectedAdapter:null,destinationAccountId:null,selectionDigest:null,
    });
    expect(value.mappingReview.factClassOrder).toEqual([
      'issued_invoice','payment','offline_cash','offline_check','credit','refund',
      'write_off','dispute','provider_fee','settlement',
    ]);
    expect(value.mappingReview.mappings.every(item => item.state === 'unavailable' &&
      item.value === null && item.destinationAccountId === null &&
      item.mappingDigest === null)).toBe(true);
    expect(value.mappingReview).toMatchObject({
      ownerReviewRequired:true,callerAuthoredOrInferredMappingAccepted:false,
      chartOfAccountsMayBeInvented:false,journalClassificationMayBeInvented:false,
      taxOrRecognitionPolicyMayBeInvented:false,mappingCount:null,
    });
    expect(value.preview).toMatchObject({
      state:'unavailable',recordCount:0,absoluteMinorUnits:null,currency:null,
      previewDigest:null,missingAmountCurrencyMappingOrSourceMayBecomeZeroOrCurrent:false,
      previewMayAuthorizeTransmission:false,
    });
  });

  test('freezes idempotent transmission, acknowledgement and partial-failure handling', () => {
    const source=sources(); const value=contract.unavailable(source.export,source.part10);
    expect(value.transmission).toMatchObject({
      requiredCapability:'customer_financial.accounting.export',
      controlMode:'conditional_dual_control',currentCapabilityGrantState:'unavailable',
      currentRecentAuthenticationState:'unavailable',currentMfaState:'unavailable',
      currentIndependentApprovalState:'unavailable',currentActionReasonState:'unavailable',
      currentReceivingAdapterState:'unavailable',transmissionAuthorized:false,
      maximumRecords:1000,maximumAbsoluteMinorUnits:'100000000',
      singleControlMaximumRecords:100,singleControlMaximumAbsoluteMinorUnits:'10000000',
      largerInBoundsExportRequiresTwoDifferentCurrentHumans:true,
      missingRecordCountAmountBoundFactSetAdapterIdentityCurrentnessOrControlDenies:true,
      sameKeyChangedRequestConflicts:true,exactReplayReturnsSameImmutableReceipt:true,
      uncertainResultRequiresOriginalReceiptLookupBeforeRetry:true,
      retryMayWidenOriginalRecordSetAmountOrDestination:false,
      duplicateTransmissionMayRepeatExternalEffect:false,
    });
    expect(value.acknowledgement).toMatchObject({
      state:'unavailable',receiptIdentity:null,receiptDigest:null,immutable:true,
      sameRequestMayHaveOneCanonicalReceipt:true,
      adapterAcknowledgementIsHumanApproval:false,
      acknowledgementMayRewriteNorthStarSource:false,
      acknowledgementMaySupplyPaymentSettlementOrCheckClearance:false,
      acknowledgementMaySupplyTaxRecognitionOrBooksCloseAuthority:false,
      uncertainReceiptStateMayBecomeSuccessOrFailureWithoutLookup:false,
    });
    expect(value.partialFailure.exactDispositionStates).toEqual([
      'accepted','rejected','retryable','uncertain','duplicate_confirmed','unavailable',
    ]);
    expect(value.partialFailure).toMatchObject({
      acceptedRecordCount:null,rejectedRecordCount:null,retryableRecordCount:null,
      uncertainRecordCount:null,missingCountsMayBecomeZero:false,
      partialAcknowledgementMayBecomeWholeBatchSuccess:false,
      acceptedRecordsMayBeRetransmittedWithoutExactDuplicateProof:false,
      retryRestrictedToExactFailedSubset:true,
      uncertainRecordsRequireReceiptLookupBeforeRetry:true,
      everyDispositionRequiresOriginalSourceAndRequestPins:true,
    });
  });

  test('rejects missing, reordered, contradictory, leaked or widened values', () => {
    const input=sources(); const canonical=contract.unavailable(input.export,input.part10);
    const mutations=[
      value=>value.mappingReview.factClassOrder.reverse(),
      value=>{value.destination.selectedAdapter='quickbooks_online';},
      value=>{value.destination.destinationAccountId='acct_victim';},
      value=>{value.mappingReview.mappings[0].destinationAccountId='income_victim';},
      value=>{value.mappingReview.chartOfAccountsMayBeInvented=true;},
      value=>{value.preview.absoluteMinorUnits='0';},
      value=>{value.transmission.transmissionAuthorized=true;},
      value=>{value.transmission.sameKeyChangedRequestConflicts=false;},
      value=>{value.acknowledgement.receiptIdentity='ack_victim';},
      value=>{value.acknowledgement.acknowledgementMayRewriteNorthStarSource=true;},
      value=>{value.partialFailure.acceptedRecordCount=0;},
      value=>{value.partialFailure.exactDispositionStates.reverse();},
      value=>{value.access.demoRouteAvailable=true;},
      value=>{value.privacy.destinationAccountOrCompanyIdentityExposed=true;},
      value=>{value.transmissionCount=1;},
    ];
    for(const mutate of mutations){const changed=clone(canonical);mutate(changed);
      expect(()=>contract.project(changed,input.export,input.part10))
        .toThrow('Accounting export readiness invalid');}
    const leaked=clone(input.export); leaked.adapterBoundary.runtimeAvailable=true;
    expect(()=>contract.unavailable(leaked,input.part10))
      .toThrow('Accounting export source contract invalid');
  });

  test('revalidates the complete source around readiness projection', async () => {
    const part10=paidPart10();
    const repository=require('../../src/customerFinancial/accountingExportReadinessRepository');
    const readPart10=jest.fn().mockResolvedValue(part10);
    const actor={organizationId:ESTIMATE,actorUserId:RECEIPT,actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333'};
    await expect(repository.read({},actor,ESTIMATE,RECEIPT,DIGEST,{readPart10}))
      .resolves.toEqual(contract.unavailable(exportContract.unavailable(part10),part10));
    expect(readPart10).toHaveBeenCalledTimes(2);
    const changed=clone(part10);changed.preview.previewDigest='c'.repeat(64);
    changed.part5Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part6Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part7Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part9Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part10Acceptance.previewWitness.previewDigest='c'.repeat(64);
    readPart10.mockReset().mockResolvedValueOnce(part10).mockResolvedValueOnce(changed);
    await expect(repository.read({},actor,ESTIMATE,RECEIPT,DIGEST,{readPart10}))
      .rejects.toMatchObject({
        code:'CUSTOMER_FINANCIAL_ACCOUNTING_EXPORT_READINESS_SOURCE_CHANGED',status:409,
      });
  });

  test('mounts only one private paid read and contains no accounting effect path', () => {
    const route=read('src/routes/customerFinancialEditableEstimate.js');
    const implementation=[read('src/customerFinancial/accountingExportReadiness.js'),
      read('src/customerFinancial/accountingExportReadinessRepository.js')].join('\n');
    expect(route).toContain("router.all('/:estimateId/accounting-export-readiness'");
    expect(route).toContain("router.get('/:estimateId/accounting-export-readiness'");
    expect(route).not.toContain("router.post('/:estimateId/accounting-export-readiness'");
    expect(read('src/routes/demo.js')).not.toContain('accounting-export-readiness');
    expect(implementation).not.toMatch(/https\.request|fetch\(|INSERT\s+INTO|UPDATE\s+/i);
    expect(implementation).toContain('destinationSelectionCount: 0');
    expect(implementation).toContain('transmissionCount: 0');
    expect(implementation).toContain('acknowledgementCount: 0');
    expect(implementation).toContain('accountingMutationCount: 0');
    expect(implementation).toContain('liveMoneyMovementCount: 0');
  });
});
