'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/paymentPart7Acceptance');
const part5Contract = require('../../src/customerFinancial/invoicePart5Acceptance');
const part6Contract = require('../../src/customerFinancial/invoicePart6Acceptance');
const demo = require('../../src/customerFinancial/demoPaymentPart7Acceptance');
const demoPart6 = require('../../src/customerFinancial/demoInvoicePart6Acceptance');
const workspace = require('../../src/commandCenter/workspace');
const invoicePreviewUi = require('../../public/js/customer-financial-invoice-preview');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);

function demoItem() {
  const tenant = '44444444-4444-4444-8444-444444444444';
  const state = workspace.createInitialDemoState(tenant, new Date('2026-10-14T12:00:00Z'),
    { seed: 'part7d-payment' });
  const view = workspace.buildDemoWorkspace({ tenantId:tenant, sessionId:ESTIMATE, state,
    revision:1, simulationCount:0, persisted:true,
    expiresAt:new Date('2026-10-15T12:00:00Z') });
  return workspace.demoCanonicalItems(view)[0];
}

function paidPart6() {
  const item = demoItem();
  const demoBundle = demoPart6.bundle(item,1);
  const preview = {...demoBundle.preview,mode:'paid',fictional:false,
    documentPreview:{...demoBundle.preview.documentPreview,fictional:false},
    previewDigest:'b'.repeat(64)};
  const part5 = part5Contract.unavailable('paid', preview);
  const part5Bundle = part5Contract.bundle(preview, part5);
  return part6Contract.bundle(part5Bundle,
    part6Contract.unavailable('paid', part5.previewWitness));
}

describe('Mission 27 Part 7D complete payment-provider acceptance', () => {
  test.each(['paid','demo'])('strictly composes disabled provider acceptance for %s', mode => {
    const part6 = mode === 'paid' ? paidPart6() : demoPart6.bundle(demoItem(),1);
    const value = contract.unavailable(mode, part6);
    expect(contract.project(JSON.parse(JSON.stringify(value)), mode, part6)).toEqual(value);
    expect(value).toMatchObject({ contractVersion:'m27-payment-part7-acceptance-v1',
      state:'unavailable', reason:'provider_sandbox_evidence_unavailable', mode,
      fictional:mode==='demo', exactCurrentnessRevalidated:true,
      providerSandboxAccepted:false,providerConnectionCurrent:false,paymentPlanCurrent:false,
      paymentInitiationAuthorized:false,providerSessionCreated:false,paymentSuccessRecorded:false,
      settlementRecorded:false,providerCallCount:0,providerMutationCount:0,
      receiverMutationCount:0,liveMoneyMovementCount:0 });
    expect(value.requirements).toEqual(contract.REQUIREMENTS);
    expect(value.sandbox).toMatchObject({state:'unavailable',value:null,
      requiredForMissionCompletion:true,evidenceAccepted:false,
      syntheticEvidenceMaySubstitute:false,providerAccountId:null,providerSessionId:null,
      hostedCheckoutUrl:null});
    expect(value.rollout).toMatchObject({stage:'disabled',tenantFlagDefault:'off',
      tenantFlagEnabled:false,featureFlagRollbackState:'active',
      rollbackBlocksNewInitiation:true,rollbackCanMarkInvoicePaid:false,
      liveCapabilityEnabled:false});
    expect(value.driftAndDisconnect).toMatchObject({
      capabilityDriftBehavior:'deny_and_require_current_reauthorization',
      accountOrModeDriftBehavior:'deny_and_require_exact_revalidation',
      disconnectBehavior:'deny_new_initiation_and_clear_provider_state',
      automaticReconnectAuthorized:false,browserReturnMayRestoreAuthority:false});
    expect(value.methods).toEqual([
      {method:'card',policyState:'launch_supported',runtimeState:'unavailable',
        reason:'payment_provider_unavailable'},
      {method:'any_other_online_method',policyState:'unsupported',runtimeState:'unsupported',
        reason:'payment_method_unsupported'},
    ]);
    expect(value.protections).toMatchObject({duplicateClickRequiresSameIdempotencyReceipt:true,
      changedRequestUnderSameIdempotencyKeyConflicts:true,
      amountCurrencyInvoiceOrAllocationChangeInvalidatesPlan:true,
      stalePlanMayReachProvider:false,missingAmountMayBeTreatedAsZero:false,
      browserReturnAuthorizesPayment:false});
    expect(value.adapterSchema).toMatchObject({
      contractVersion:'m27-payment-provider-adapter-schema-v1',state:'unavailable',value:null,
      acceptedMajorVersion:1,minimumSupportedMinorVersion:0,maximumTestedMinorVersion:0,
      breakingChangeRequiresNewMajorVersion:true,unknownRequiredFieldAccepted:false,
      unknownOptionalFieldMayAuthorizeEffect:false,backwardCompatibleMinorInputRequired:true,
      forwardCompatibleOptionalOutputRequired:true,callerAuthoredProviderObjectAccepted:false,
      providerPayloadMayMarkInvoicePaid:false});
    const bundle = contract.bundle(part6,value);
    expect(contract.projectBundle(JSON.parse(JSON.stringify(bundle)),mode)).toEqual(bundle);
    expect(() => contract.project({...value,providerCallCount:1},mode,part6)).toThrow();
    expect(() => contract.project({...value,requirements:value.requirements.slice(1)},mode,part6)).toThrow();
    expect(() => contract.project({...value,adapterSchema:{...value.adapterSchema,
      unknownRequiredFieldAccepted:true}},mode,part6)).toThrow();
    expect(() => contract.project({...value,protections:{...value.protections,
      amountCurrencyInvoiceOrAllocationChangeInvalidatesPlan:false}},mode,part6)).toThrow();
  });

  test('revalidates the complete paid chain on both sides of initiation-plan construction', async () => {
    const current = paidPart6();
    const part6Repository = require('../../src/customerFinancial/invoicePart6AcceptanceRepository');
    const planRepository = require('../../src/customerFinancial/paymentInitiationPlanRepository');
    const connection = require('../../src/customerFinancial/paymentProviderConnection').unavailable();
    const plan = require('../../src/customerFinancial/paymentInitiationPlan').unavailable(
      current.part6Acceptance.publicSession, connection, 'paid');
    const part6Spy = jest.spyOn(part6Repository,'readBundle').mockResolvedValue(current);
    const planSpy = jest.spyOn(planRepository,'read').mockResolvedValue(plan);
    const repository = require('../../src/customerFinancial/paymentPart7AcceptanceRepository');
    const source={organizationId:ESTIMATE,actorUserId:RECEIPT,actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333'};
    await expect(repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST)).resolves.toEqual(
      contract.bundle(current,contract.unavailable('paid',current,undefined,undefined,plan)));
    expect(part6Spy).toHaveBeenCalledTimes(2); expect(planSpy).toHaveBeenCalledTimes(1);
    part6Spy.mockReset().mockResolvedValueOnce(current).mockResolvedValueOnce({
      ...current, preview:{...current.preview,previewDigest:'c'.repeat(64)},
      part5Acceptance:{...current.part5Acceptance,previewWitness:{...current.part5Acceptance.previewWitness,
        previewDigest:'c'.repeat(64)}},
      part6Acceptance:{...current.part6Acceptance,previewWitness:{...current.part6Acceptance.previewWitness,
        previewDigest:'c'.repeat(64)}}});
    await expect(repository.readBundle({},source,ESTIMATE,RECEIPT,DIGEST))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_PAYMENT_PART7_CHANGED',status:409});
    part6Spy.mockRestore(); planSpy.mockRestore();
  });

  test('builds one isolated fictional bundle and mounts no provider action or migration 273', () => {
    const item=demoItem(), current=demoPart6.bundle(item,1), value=demo.bundle(item,1);
    expect(contract.projectBundle(value,'demo')).toEqual(value);
    expect(value.part7Acceptance.previewWitness).toEqual(current.part6Acceptance.previewWitness);
    expect(() => demo.bundle({source:{type:'paid'}},1)).toThrow();
    const paid=read('src/routes/customerFinancialEditableEstimate.js');
    const demoRoute=read('src/routes/demo.js');
    const ui=read('public/js/customer-financial-invoice-preview.js');
    expect(paid).toContain("router.get('/:estimateId/payment-part7-acceptance', auth, role, throttle");
    expect(paid).not.toContain("router.post('/:estimateId/payment-part7-acceptance'");
    expect(demoRoute).toContain("router.get('/customer-financial/invoice-drafts/:estimateId/part7-acceptance'");
    expect(demoRoute).not.toContain("router.post('/customer-financial/invoice-drafts/:estimateId/part7-acceptance'");
    expect(ui).toContain("'/payment-part7-acceptance?");
    expect(ui).toContain("'/part7-acceptance'");
    expect(ui).toContain('function invalidPart7(value, expectedMode)');
    expect(ui).toContain('Ten exact payment prerequisites');
    for (const requirement of contract.REQUIREMENTS) expect(ui).toContain(requirement.requirement);
    expect(ui).not.toMatch(/button[^\n]*(?:connect provider|start checkout|pay invoice)/i);
    const source=[read('src/customerFinancial/paymentPart7Acceptance.js'),
      read('src/customerFinancial/paymentPart7AcceptanceRepository.js'),
      read('src/customerFinancial/demoPaymentPart7Acceptance.js')].join('\n');
    expect(source).not.toMatch(/INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM|fetch\(|axios/i);
    const names=fs.readdirSync(path.join(ROOT,'migrations')).filter(name=>name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('272_customer_financial_invoice_draft_preview_v1.sql');
    expect(names.some(name=>/^273_/.test(name))).toBe(false);
  });

  test('browser contract validation rejects authority, privacy, rollback, method and access contradictions', () => {
    const canonical=contract.unavailable('paid',paidPart6());
    expect(invoicePreviewUi.invalidPart7(JSON.parse(JSON.stringify(canonical)),'paid')).toBe(false);
    const mutations=[
      value=>{ value.extra='not_allowed'; },
      value=>{ value.requirements.reverse(); },
      value=>{ delete value.requirements[0].reason; },
      value=>{ value.requirements[0].state='unavailable'; value.requirements[0].reason='forged_reason'; },
      value=>{ value.sandbox.providerAccountId='acct_victim'; },
      value=>{ value.adapterSchema.callerAuthoredProviderObjectAccepted=true; },
      value=>{ value.rollout.rollbackCanMarkInvoicePaid=true; },
      value=>{ value.driftAndDisconnect.automaticReconnectAuthorized=true; },
      value=>{ value.access.staffRoleMaySubstituteForCustomerSession=true; },
      value=>{ value.protections.missingAmountMayBeTreatedAsZero=true; },
      value=>{ const first=value.methods[0]; value.methods[0]=value.methods[1]; value.methods[1]=first; },
      value=>{ value.methods[0].policyState='unsupported'; value.methods[1].policyState='launch_supported'; },
    ];
    for (const mutate of mutations) {
      const value=JSON.parse(JSON.stringify(canonical)); mutate(value);
      expect(invoicePreviewUi.invalidPart7(value,'paid')).toBe(true);
    }
    const auditorPayload=JSON.parse(JSON.stringify(canonical));
    Object.assign(auditorPayload.requirements[0],{state:'unavailable',reason:'forged_reason'});
    Object.assign(auditorPayload.sandbox,{providerAccountId:'acct_victim'});
    auditorPayload.adapterSchema.callerAuthoredProviderObjectAccepted=true;
    auditorPayload.rollout.rollbackCanMarkInvoicePaid=true;
    auditorPayload.driftAndDisconnect.automaticReconnectAuthorized=true;
    auditorPayload.access.staffRoleMaySubstituteForCustomerSession=true;
    auditorPayload.protections.missingAmountMayBeTreatedAsZero=true;
    auditorPayload.methods[0].policyState='unsupported';
    auditorPayload.methods[1].policyState='launch_supported';
    expect(invoicePreviewUi.invalidPart7(auditorPayload,'paid')).toBe(true);
  });

  test('browser contract validation rejects every missing or extra server-owned field', () => {
    const canonical=JSON.parse(JSON.stringify(contract.unavailable('paid',paidPart6())));
    const objectPaths=[[],['previewWitness'],['sourceWitnesses'],['adapterSchema'],['sandbox'],
      ['rollout'],['driftAndDisconnect'],['protections'],['access']];
    for (const pathParts of objectPaths) {
      let source=canonical; for (const part of pathParts) source=source[part];
      for (const key of Object.keys(source)) {
        const value=JSON.parse(JSON.stringify(canonical));
        let target=value; for (const part of pathParts) target=target[part];
        delete target[key];
        expect(invoicePreviewUi.invalidPart7(value,'paid')).toBe(true);
      }
      const value=JSON.parse(JSON.stringify(canonical));
      let target=value; for (const part of pathParts) target=target[part];
      target.unexpectedAuthority='not_allowed';
      expect(invoicePreviewUi.invalidPart7(value,'paid')).toBe(true);
    }
    for (const collection of ['requirements','methods']) {
      canonical[collection].forEach((entry,index)=>Object.keys(entry).forEach(key=>{
        const value=JSON.parse(JSON.stringify(canonical)); delete value[collection][index][key];
        expect(invoicePreviewUi.invalidPart7(value,'paid')).toBe(true);
      }));
    }
  });
});
