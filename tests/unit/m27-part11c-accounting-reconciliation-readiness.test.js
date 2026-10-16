'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cors = require('cors');
const express = require('express');
const request = require('supertest');
const contract = require('../../src/customerFinancial/accountingReconciliationReadiness');
const readinessContract = require('../../src/customerFinancial/accountingExportReadiness');
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
    { seed:'part11c-accounting-reconciliation' });
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
  const source=exportContract.unavailable(part10);
  return {part10,source,readiness:readinessContract.unavailable(source,part10)}; }

describe('Mission 27 Part 11C accounting reconciliation readiness', () => {
  test('freezes exact bidirectional states without yielding NorthStar authority', () => {
    const input=sources();
    const value=contract.unavailable(input.readiness,input.source,input.part10);
    expect(contract.project(clone(value),input.readiness,input.source,input.part10)).toEqual(value);
    expect(contract.STATES).toEqual([
      'matched','unmatched','conflicting','corrected','unavailable',
    ]);
    expect(value).toMatchObject({
      contractVersion:'m27-accounting-reconciliation-readiness-v1',
      state:'unavailable',reason:'accounting_acknowledgement_and_reconciliation_authority_unavailable',
      value:null,exactCurrentnessRevalidated:true,reconciliationRecordCount:0,
      reconciliationCorrectionCount:0,accountingMutationCount:0,
      northStarSourceMutationCount:0,externalRecordMutationCount:0,
      providerCallCount:0,receiverMutationCount:0,liveMoneyMovementCount:0,
    });
    expect(value.recordContract).toMatchObject({
      recordVersion:'m27-accounting-reconciliation-record-v1',
      exactStates:['matched','unmatched','conflicting','corrected','unavailable'],
      exactSides:['northstar_source','external_accounting_record'],
      everyRecordRequiresExactSourceExportAcknowledgementAndExternalPins:true,
      missingIdentityRevisionDigestAmountCurrencyOrTimeMayBecomeZeroOrCurrent:false,
      arrivalOrderMaySupplyOccurrenceRevisionMatchOrAuthority:false,
    });
    expect(value.recordContract.stateSemantics.map(item=>item.state)).toEqual(contract.STATES);
    expect(value.recordContract.stateSemantics.every(item =>
      item.availability === 'unavailable' && item.value === null)).toBe(true);
    expect(value.northStarAuthority).toMatchObject({
      state:'unavailable',sourceRecordId:null,sourceRevision:null,sourceDigest:null,
      externalRecordMayRewriteNorthStarFactStateAmountCurrencyOrLineage:false,
      reconciliationMayCreateInvoicePaymentSettlementClearanceOrTaxTruth:false,
    });
    expect(value.externalEvidence).toMatchObject({
      state:'unavailable',configuredAdapter:'quickbooks_online.accounting_export.v1',
      configuredMode:'sandbox',runtimeAvailable:false,currentReceivingAdapterState:'unavailable',
      externalRecordId:null,externalRecordRevision:null,externalRecordDigest:null,
      externalRecordRemainsAdapterSourceOwned:true,adapterAcknowledgementIsHumanAction:false,
    });
  });

  test('preserves exact matching, append-only correction and dual-control semantics', () => {
    const input=sources(); const value=contract.unavailable(
      input.readiness,input.source,input.part10);
    expect(value.matching).toMatchObject({
      compareBothDirections:true,exactSourceRecordRevisionDigestRequired:true,
      exactExportRequestAndAcknowledgementPinsRequired:true,
      exactExternalRecordRevisionDigestRequired:true,exactCurrencyAndAbsoluteMinorUnitsRequired:true,
      fuzzyIdentityAmountToleranceSilentFxOrArrivalOrderAllowed:false,
      missingAmountCurrencyCountOrSideMayBecomeZeroOrMatch:false,
      matchedRecordCount:null,unmatchedRecordCount:null,conflictingRecordCount:null,
      correctedRecordCount:null,unavailableRecordCount:null,
    });
    expect(value.correction).toMatchObject({
      appendOnly:true,exactPriorReconciliationIdentityRevisionAndDigestRequired:true,
      exactCurrentNorthStarAndExternalPinsRequired:true,reviewedReasonRequired:true,
      priorStateRetained:true,correctionMayDeleteOrRewritePriorReconciliation:false,
      correctionMayRewriteNorthStarOrExternalSource:false,
    });
    expect(value.authority).toMatchObject({
      requiredCapability:'customer_financial.accounting.reconcile',controlMode:'dual_control',
      singleControlAllowed:false,
      exactControlledActions:['manual_match','manual_mismatch_resolution',
        'manual_books_status_override'],
      currentCapabilityGrantState:'unavailable',currentRecentAuthenticationState:'unavailable',
      currentMfaState:'unavailable',currentIndependentApprovalState:'unavailable',
      currentActionReasonState:'unavailable',roleAloneAuthorizesReconciliation:false,
      adapterAcknowledgementIsHumanAction:false,reconciliationAuthorized:false,
      manualResolutionMayInventAccountTaxRecognitionOrBooksClosePolicy:false,
    });
  });

  test('rejects missing, reordered, contradictory, leaked or widened values', () => {
    const input=sources(); const canonical=contract.unavailable(
      input.readiness,input.source,input.part10);
    const mutations=[
      value=>value.recordContract.exactStates.reverse(),
      value=>value.recordContract.stateSemantics.reverse(),
      value=>{value.northStarAuthority.sourceRecordId='inv_victim';},
      value=>{value.northStarAuthority.externalRecordMayRewriteNorthStarFactStateAmountCurrencyOrLineage=true;},
      value=>{value.externalEvidence.externalRecordId='external_victim';},
      value=>{value.externalEvidence.adapterAcknowledgementIsHumanAction=true;},
      value=>{value.matching.matchedRecordCount=0;},
      value=>{value.matching.fuzzyIdentityAmountToleranceSilentFxOrArrivalOrderAllowed=true;},
      value=>{value.correction.correctionIdentity='correction_victim';},
      value=>{value.correction.correctionMayRewriteNorthStarOrExternalSource=true;},
      value=>{value.authority.singleControlAllowed=true;},
      value=>{value.authority.reconciliationAuthorized=true;},
      value=>{value.privacy.externalRecordIdentityOrValueExposed=true;},
      value=>{value.reconciliationRecordCount=1;},
    ];
    for(const mutate of mutations){const changed=clone(canonical);mutate(changed);
      expect(()=>contract.project(changed,input.readiness,input.source,input.part10))
        .toThrow('Accounting reconciliation readiness invalid');}
    const leaked=clone(input.readiness); leaked.acknowledgement.receiptIdentity='ack_victim';
    expect(()=>contract.unavailable(leaked,input.source,input.part10))
      .toThrow('Accounting reconciliation source contract invalid');
  });

  test('revalidates the complete Part 11B source around projection', async () => {
    const part10=paidPart10();
    const repository=require('../../src/customerFinancial/accountingReconciliationReadinessRepository');
    const readPart10=jest.fn().mockResolvedValue(part10);
    const actor={organizationId:ESTIMATE,actorUserId:RECEIPT,actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333'};
    const result=await repository.read({},actor,ESTIMATE,RECEIPT,DIGEST,{readPart10});
    const input=sources();
    expect(result).toEqual(contract.unavailable(input.readiness,input.source,input.part10));
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
        code:'CUSTOMER_FINANCIAL_ACCOUNTING_RECONCILIATION_SOURCE_CHANGED',status:409,
      });
  });

  test('keeps OPTIONS inside the GET-only boundary before auth or repository entry', async () => {
    const route=`/api/v1/customer-financial/editable-estimates/${ESTIMATE}/accounting-reconciliation-readiness`;
    const resolveOptions=requestPath=>new Promise((resolve,reject)=>corsOptions({
      path:requestPath,header:()=>undefined,
    },(error,options)=>error?reject(error):resolve(options)));
    await expect(resolveOptions(route)).resolves
      .toMatchObject({methods:['GET'],preflightContinue:true});
    await expect(resolveOptions(`${route}/`)).resolves
      .toMatchObject({methods:['GET'],preflightContinue:true});
    await expect(resolveOptions(route.replace(ESTIMATE,
      '11111111-1111-7111-8111-111111111111'))).resolves
      .toMatchObject({methods:['GET'],preflightContinue:true});
    const calls={auth:0,role:0,throttle:0,read:0};
    const app=express();app.use(cors(corsOptions));
    app.use('/api/v1/customer-financial/editable-estimates',
      createCustomerFinancialEditableEstimateRouter({
        poolProvider:()=>{throw new Error('pool must not be reached');},
        accountingReconciliationReadinessRead:async()=>{calls.read+=1;},
        auth:(_req,_res,next)=>{calls.auth+=1;next();},
        role:(_req,_res,next)=>{calls.role+=1;next();},
        throttle:(_req,_res,next)=>{calls.throttle+=1;next();},
      }));
    const response=await request(app).options(route).set('Origin','http://localhost:3000')
      .set('Access-Control-Request-Method','POST');
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET');
    expect(response.headers['access-control-allow-methods']).toBe('GET');
    expect(response.body.error.category)
      .toBe('CUSTOMER_FINANCIAL_ACCOUNTING_RECONCILIATION_METHOD_NOT_ALLOWED');
    expect(calls).toEqual({auth:0,role:0,throttle:0,read:0});
  });

  test('mounts only one private paid read and contains no accounting effect path', () => {
    const route=read('src/routes/customerFinancialEditableEstimate.js');
    const implementation=[read('src/customerFinancial/accountingReconciliationReadiness.js'),
      read('src/customerFinancial/accountingReconciliationReadinessRepository.js')].join('\n');
    expect(route).toContain("router.all('/:estimateId/accounting-reconciliation-readiness'");
    expect(route).toContain("router.get('/:estimateId/accounting-reconciliation-readiness'");
    expect(route).not.toContain("router.post('/:estimateId/accounting-reconciliation-readiness'");
    expect(read('src/routes/demo.js')).not.toContain('accounting-reconciliation-readiness');
    expect(implementation).not.toMatch(/https\.request|fetch\(|INSERT\s+INTO|UPDATE\s+/i);
    for(const line of ['reconciliationRecordCount:0','accountingMutationCount:0',
      'northStarSourceMutationCount:0','externalRecordMutationCount:0',
      'providerCallCount:0','receiverMutationCount:0','liveMoneyMovementCount:0']) {
      expect(implementation).toContain(line);
    }
  });
});
