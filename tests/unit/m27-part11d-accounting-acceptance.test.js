'use strict';

const fs=require('node:fs');
const path=require('node:path');
const cors=require('cors');
const express=require('express');
const request=require('supertest');
const contract=require('../../src/customerFinancial/accountingPart11Acceptance');
const providerBoundary=require('../../src/customerFinancial/paymentProviderBoundary');
const part5Contract=require('../../src/customerFinancial/invoicePart5Acceptance');
const part6Contract=require('../../src/customerFinancial/invoicePart6Acceptance');
const part7Contract=require('../../src/customerFinancial/paymentPart7Acceptance');
const part9Contract=require('../../src/customerFinancial/paymentPart9Acceptance');
const part10Contract=require('../../src/customerFinancial/collectionPart10Acceptance');
const demoPart6=require('../../src/customerFinancial/demoInvoicePart6Acceptance');
const demo=require('../../src/customerFinancial/demoAccountingPart11Acceptance');
const workspace=require('../../src/commandCenter/workspace');
const ui=require('../../public/js/customer-financial-invoice-preview');
const {corsOptions}=require('../../src/middleware/security');
const {createCustomerFinancialEditableEstimateRouter}=
  require('../../src/routes/customerFinancialEditableEstimate');

const ROOT=path.resolve(__dirname,'../..');
const read=relative=>fs.readFileSync(path.join(ROOT,relative),'utf8');
const ESTIMATE='11111111-1111-4111-8111-111111111111';
const RECEIPT='22222222-2222-4222-8222-222222222222';
const DIGEST='a'.repeat(64);
function clone(value){return JSON.parse(JSON.stringify(value));}
let cachedItem; let cachedPaidPart10; let cachedDemoPart11;
function item(){
  if(cachedItem) return cachedItem;
  const tenant='44444444-4444-4444-8444-444444444444';
  const state=workspace.createInitialDemoState(tenant,new Date('2026-10-15T12:00:00Z'),
    {seed:'part11d-accounting-acceptance'});
  const view=workspace.buildDemoWorkspace({tenantId:tenant,sessionId:ESTIMATE,state,
    revision:1,simulationCount:0,persisted:true,
    expiresAt:new Date('2026-10-16T12:00:00Z')});
  cachedItem=workspace.demoCanonicalItems(view)[0];
  return cachedItem;
}
function paidPart10(){
  if(cachedPaidPart10) return clone(cachedPaidPart10);
  const demoBundle=demoPart6.bundle(item(),1);
  const preview={...demoBundle.preview,mode:'paid',fictional:false,
    documentPreview:{...demoBundle.preview.documentPreview,fictional:false},
    previewDigest:'b'.repeat(64)};
  const part5Acceptance=part5Contract.unavailable('paid',preview);
  const part5=part5Contract.bundle(preview,part5Acceptance);
  const part6=part6Contract.bundle(part5,
    part6Contract.unavailable('paid',part5Acceptance.previewWitness));
  const part7=part7Contract.bundle(part6,part7Contract.unavailable('paid',part6));
  const part9Sources=part9Contract.defaultSources(part7);
  const part9=part9Contract.bundle(part7,
    part9Contract.unavailable('paid',part7,part9Sources),part9Sources);
  const part10Sources=part10Contract.defaultSources();
  cachedPaidPart10=part10Contract.bundle(part9,
    part10Contract.unavailable('paid',part9,part10Sources),part10Sources);
  return clone(cachedPaidPart10);
}
function demoPart11(){
  if(!cachedDemoPart11) cachedDemoPart11=demo.bundle(item(),1);
  return clone(cachedDemoPart11);
}

describe('Mission 27 Part 11D complete Part 11 acceptance',()=>{
  test('resumes only an active successful-mutation recovery after same-host replacement',()=>{
    const host={}; const estimateId=ESTIMATE;
    const recovery={host,estimateId,section:{isConnected:false},
      desiredOpen:()=>true,mutationRecoveryActive:()=>true};
    expect(ui.shouldResumeMutationRecovery(recovery,host,estimateId)).toBe(true);
    expect(ui.shouldResumeMutationRecovery(null,host,estimateId)).toBe(false);
    expect(ui.shouldResumeMutationRecovery({...recovery,host:{}},host,estimateId)).toBe(false);
    expect(ui.shouldResumeMutationRecovery({...recovery,estimateId:RECEIPT},host,estimateId)).toBe(false);
    expect(ui.shouldResumeMutationRecovery({...recovery,section:{isConnected:true}},host,estimateId)).toBe(false);
    expect(ui.shouldResumeMutationRecovery({...recovery,desiredOpen:()=>false},host,estimateId)).toBe(false);
    expect(ui.shouldResumeMutationRecovery({...recovery,mutationRecoveryActive:()=>false},host,estimateId)).toBe(false);
  });

  test('preserves the same connected disclosure across same-estimate hub rerenders',()=>{
    const host={}; const section={isConnected:true};
    const previous={host,estimateId:ESTIMATE,section};
    const review={pins:{estimateId:ESTIMATE}};
    expect(ui.canPreserveMountedDisclosure(previous,review,host)).toBe(true);
    expect(ui.canPreserveMountedDisclosure({...previous,host:{}},review,host)).toBe(false);
    expect(ui.canPreserveMountedDisclosure({...previous,estimateId:RECEIPT},review,host)).toBe(false);
    expect(ui.canPreserveMountedDisclosure({...previous,section:{isConnected:false}},review,host)).toBe(false);
  });

  test('freezes exact tax, retention, hold, disconnect and regrant truth',()=>{
    const part10=paidPart10(); const sources=contract.derive(part10,'paid');
    const value=contract.unavailable('paid',part10,sources);
    expect(contract.project(clone(value),'paid',part10,sources)).toEqual(value);
    expect(value).toMatchObject({
      contractVersion:'m27-accounting-part11-acceptance-v1',state:'unavailable',
      reason:'part11_accounting_evidence_unavailable',mode:'paid',fictional:false,
      taxAccountingBoundary:{providerTaxCalculationEnabled:false,
        exactCurrentMission24TaxDecisionRequired:true,
        configuredAccountingAdapter:'quickbooks_online.accounting_export.v1',
        configuredAccountingMode:'sandbox',accountingRuntimeAvailable:false,
        accountingMayInventChartOfAccounts:false,accountingMayDecideRecognitionOrTax:false,
        accountingMaySupplyCheckClearance:false,
        journalTaxFilingRevenueRecognitionOrBooksCloseAuthorized:false},
      retentionHold:{contractVersion:'m27-accounting-retention-hold-v1',
        financialRecordCalendarYears:7,immutableIdempotencyAndAuditCalendarYears:7,
        holdsSuspendEligibleDeletion:true,
        legalTaxAccountingProviderSecurityReviewComplete:false,
        missingRetentionOrHoldStateMayAuthorizeDeletion:false,deletionAuthorized:false},
      adapterLifecycle:{contractVersion:'m27-accounting-adapter-lifecycle-v1',
        exactStates:['connection_unavailable','disconnect_unavailable','regrant_unavailable'],
        automaticReconnectAllowed:false,
        disconnectStopsNewPreviewTransmissionAcknowledgementAndReconciliation:true,
        disconnectMayDeleteImmutableReceiptsOrAudit:false,
        regrantRequiresFreshReviewedAuthority:true,disconnectAuthorized:false,
        regrantAuthorized:false},
      acceptance:{wholePart11FunctionalBoundaryPresent:true,paidDemoIsolationAccepted:true,
        independentWholeHeadAuditAccepted:false,productionPerformanceSlaAccepted:false,
        firstPayingCustomerLiveMoneyValidated:false,founderVisualApprovalAccepted:false},
      exportRecordCount:0,transmissionCount:0,acknowledgementCount:0,
      reconciliationRecordCount:0,retentionDeletionCount:0,
      adapterConnectionMutationCount:0,accountingMutationCount:0,providerCallCount:0,
      receiverMutationCount:0,liveMoneyMovementCount:0,
    });
    expect(value.sourceParts.map(source=>source.part)).toEqual(['11A','11B','11C']);
    expect(value.sourceParts.every(source=>/^[0-9a-f]{64}$/.test(source.digest))).toBe(true);
  });

  test('rejects missing, reordered, contradictory, leaked or widened values',()=>{
    const part10=paidPart10(); const sources=contract.derive(part10,'paid');
    const canonical=contract.unavailable('paid',part10,sources);
    const mutations=[
      value=>value.sourceParts.reverse(),
      value=>{value.taxAccountingBoundary.accountingRuntimeAvailable=true;},
      value=>{value.taxAccountingBoundary.taxRequiredPins.reverse();},
      value=>{value.retentionHold.recognizedHoldPurposes.reverse();},
      value=>{value.retentionHold.missingRetentionOrHoldStateMayAuthorizeDeletion=true;},
      value=>{value.adapterLifecycle.exactStates.reverse();},
      value=>{value.adapterLifecycle.automaticReconnectAllowed=true;},
      value=>{value.adapterLifecycle.currentGrantState='connected';},
      value=>{value.privacy.destinationAccountCompanyOrMappingExposed=true;},
      value=>{value.acceptance.firstPayingCustomerLiveMoneyValidated=true;},
      value=>{value.accountingMutationCount=1;},
    ];
    for(const mutate of mutations){const changed=clone(canonical);mutate(changed);
      expect(()=>contract.project(changed,'paid',part10,sources))
        .toThrow('Accounting Part 11 acceptance invalid');}
  });

  test('binds every Part 11 witness digest to the freshly derived upstream contract',()=>{
    const canonical=demoPart11();
    const part10={contractVersion:part10Contract.BUNDLE_VERSION,preview:canonical.preview,
      part5Acceptance:canonical.part5Acceptance,part6Acceptance:canonical.part6Acceptance,
      part7Acceptance:canonical.part7Acceptance,part9Acceptance:canonical.part9Acceptance,
      part10Acceptance:canonical.part10Acceptance};
    const sources=contract.derive(part10,'demo');
    const wrong='f'.repeat(64);
    const mutations=[
      value=>{value.part11Acceptance.part10Witness.digest=wrong;},
      value=>{delete value.part11Acceptance.sourceParts[0].digest;},
      value=>{value.part11Acceptance.sourceParts[0].digest='not-a-digest';},
      value=>{value.part11Acceptance.sourceParts[1].digest=
        value.part11Acceptance.sourceParts[0].digest;},
      value=>{value.part11Acceptance.sourceParts.reverse();},
      value=>{value.part11Acceptance.sourceParts[0].part='11Z';},
      value=>{delete value.part11SourceContracts.part11A;},
      value=>{value.part11SourceContracts.part11A.state='current';},
      value=>{const first=value.part11SourceContracts.part11A;
        value.part11SourceContracts.part11A=value.part11SourceContracts.part11B;
        value.part11SourceContracts.part11B=first;},
      value=>{value.part11SourceContracts.part11A.state='current';
        value.part11Acceptance.sourceParts[0].digest=
          providerBoundary.digest(value.part11SourceContracts.part11A);},
    ];
    expect(()=>contract.projectBundle(clone(canonical),'demo',sources)).not.toThrow();
    for(const mutate of mutations){const changed=clone(canonical);mutate(changed);
      expect(()=>contract.projectBundle(changed,'demo',sources))
        .toThrow(/Accounting Part 11 (acceptance|preview bundle) invalid/);}
  });

  test('client validates the complete exact server-owned Part 11 contract',async()=>{
    const bundle=demoPart11();
    const canonical=bundle.part11Acceptance;
    const sources=bundle.part11SourceContracts;
    expect(ui.invalidPart11(clone(canonical),'demo')).toBe(false);
    expect(await ui.invalidPart11SourceWitnesses(clone(canonical),clone(sources))).toBe(false);
    expect(await ui.samePart11Witness(bundle.preview,clone(canonical),
      bundle.part10Acceptance)).toBe(true);
    const mutations=[
      value=>value.sourceParts.reverse(),
      value=>{value.sourceParts[0].reason='forged';},
      value=>{value.taxAccountingBoundary.accountingMayDecideRecognitionOrTax=true;},
      value=>{value.taxAccountingBoundary.taxRequiredPins.reverse();},
      value=>{value.retentionHold.recognizedHoldPurposes.reverse();},
      value=>{value.retentionHold.disconnectMayDeleteSourceExportAcknowledgementReconciliationOrAudit=true;},
      value=>{value.adapterLifecycle.automaticReconnectAllowed=true;},
      value=>{value.adapterLifecycle.priorGrantCredentialDestinationMappingOrReceiptMayBeReusedAfterDisconnect=true;},
      value=>{value.privacy.adapterCredentialSecretOrIdempotencyKeyExposed=true;},
      value=>{value.acceptance.productionPerformanceSlaAccepted=true;},
      value=>{value.liveMoneyMovementCount=1;},
    ];
    for(const mutate of mutations){const changed=clone(canonical);mutate(changed);
      expect(ui.invalidPart11(changed,'demo')).toBe(true);}
    for(const mutate of [
      value=>{delete value.sourceParts[0].digest;},
      value=>{value.sourceParts[0].digest='wrong';},
      value=>{value.sourceParts[1].digest=value.sourceParts[0].digest;},
      value=>{value.sourceParts.reverse();},
      value=>{value.sourceParts[0].part='11Z';},
    ]) { const changed=clone(canonical); mutate(changed);
      expect(ui.invalidPart11(changed,'demo')).toBe(true); }
    for(const mutate of [
      value=>{delete value.part11A;},
      value=>{value.part11A.state='current';},
      value=>{const first=value.part11A; value.part11A=value.part11B; value.part11B=first;},
    ]) { const changed=clone(sources); mutate(changed);
      expect(await ui.invalidPart11SourceWitnesses(clone(canonical),changed)).toBe(true); }
    const wrongPart10=clone(canonical);wrongPart10.part10Witness.digest='f'.repeat(64);
    expect(await ui.samePart11Witness(bundle.preview,wrongPart10,
      bundle.part10Acceptance)).toBe(false);
    const wrongSource=clone(canonical);wrongSource.sourceParts[0].digest='e'.repeat(64);
    expect(await ui.invalidPart11SourceWitnesses(wrongSource,clone(sources))).toBe(true);
    expect(ui.invalidPart11(clone(canonical),'paid')).toBe(true);
  },120000);

  test('mounted campaign renews the real account session for every layout',()=>{
    const mounted=read('tests/browser/m27-part5e-mounted-acceptance.js');
    expect(mounted).toContain("require('../helpers/account-session-fixture')");
    expect(mounted).toContain('const layoutSession = await provisionDurableSession');
    expect(mounted).toContain('Object.entries(layoutSession.cookies)');
  });

  test('revalidates the complete Part 10 source around all Part 11 contracts',async()=>{
    const part10=paidPart10();
    const repository=require('../../src/customerFinancial/accountingPart11AcceptanceRepository');
    const readPart10=jest.fn().mockResolvedValue(part10);
    const actor={organizationId:ESTIMATE,actorUserId:RECEIPT,actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333'};
    const result=await repository.readBundle({},actor,ESTIMATE,RECEIPT,DIGEST,{readPart10});
    expect(()=>contract.projectBundle(result,'paid')).not.toThrow();
    expect(readPart10).toHaveBeenCalledTimes(2);
    const changed=clone(part10);changed.preview.previewDigest='c'.repeat(64);
    changed.part5Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part6Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part7Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part9Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part10Acceptance.previewWitness.previewDigest='c'.repeat(64);
    readPart10.mockReset().mockResolvedValueOnce(part10).mockResolvedValueOnce(changed);
    await expect(repository.readBundle({},actor,ESTIMATE,RECEIPT,DIGEST,{readPart10}))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_ACCOUNTING_PART11_CHANGED',status:409});
  });

  test('mounts GET-only paid and isolated demo reads with pre-auth OPTIONS denial',async()=>{
    const paid=read('src/routes/customerFinancialEditableEstimate.js');
    const demoRoute=read('src/routes/demo.js');
    const client=read('public/js/customer-financial-invoice-preview.js');
    expect(paid).toContain("router.all('/:estimateId/accounting-part11-acceptance'");
    expect(paid).toContain("router.get('/:estimateId/accounting-part11-acceptance'");
    expect(paid).not.toContain("router.post('/:estimateId/accounting-part11-acceptance'");
    expect(demoRoute).toContain("router.all('/customer-financial/invoice-drafts/:estimateId/part11-acceptance'");
    expect(demoRoute).toContain("router.get('/customer-financial/invoice-drafts/:estimateId/part11-acceptance'");
    expect(client).toContain("'/accounting-part11-acceptance?");
    expect(client).toContain("'/part11-acceptance'");
    expect(client).not.toContain("'/collection-part10-acceptance?");
    const route=`/api/v1/customer-financial/editable-estimates/${ESTIMATE}/accounting-part11-acceptance`;
    const resolveOptions=requestPath=>new Promise((resolve,reject)=>corsOptions({
      path:requestPath,header:()=>undefined,
    },(error,options)=>error?reject(error):resolve(options)));
    await expect(resolveOptions(route)).resolves.toMatchObject({methods:['GET'],preflightContinue:true});
    const calls={auth:0,role:0,throttle:0,read:0};
    const app=express();app.use(cors(corsOptions));
    app.use('/api/v1/customer-financial/editable-estimates',
      createCustomerFinancialEditableEstimateRouter({
        poolProvider:()=>{throw new Error('pool must not be reached');},
        accountingPart11AcceptanceRead:async()=>{calls.read+=1;},
        auth:(_req,_res,next)=>{calls.auth+=1;next();},
        role:(_req,_res,next)=>{calls.role+=1;next();},
        throttle:(_req,_res,next)=>{calls.throttle+=1;next();},
      }));
    const response=await request(app).options(route).set('Origin','http://localhost:3000')
      .set('Access-Control-Request-Method','POST');
    expect(response.status).toBe(405);expect(response.headers.allow).toBe('GET');
    expect(response.headers['access-control-allow-methods']).toBe('GET');
    expect(response.body.error.category)
      .toBe('CUSTOMER_FINANCIAL_ACCOUNTING_PART11_METHOD_NOT_ALLOWED');
    expect(calls).toEqual({auth:0,role:0,throttle:0,read:0});
  });

  test('contains no adapter, provider, receiver, accounting or money effect path',()=>{
    const implementation=[read('src/customerFinancial/accountingPart11Acceptance.js'),
      read('src/customerFinancial/accountingPart11AcceptanceRepository.js'),
      read('src/customerFinancial/demoAccountingPart11Acceptance.js')].join('\n');
    expect(implementation).not.toMatch(/https\.request|fetch\(|INSERT\s+INTO|UPDATE\s+/i);
    for(const line of ['retentionDeletionCount:0','adapterConnectionMutationCount:0',
      'accountingMutationCount:0','northStarSourceMutationCount:0','externalRecordMutationCount:0',
      'providerCallCount:0','receiverMutationCount:0','liveMoneyMovementCount:0']) {
      expect(implementation).toContain(line);
    }
  });
});
