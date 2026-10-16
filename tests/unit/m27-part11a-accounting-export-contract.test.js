'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/accountingExportContract');
const part5Contract = require('../../src/customerFinancial/invoicePart5Acceptance');
const part6Contract = require('../../src/customerFinancial/invoicePart6Acceptance');
const part7Contract = require('../../src/customerFinancial/paymentPart7Acceptance');
const part9Contract = require('../../src/customerFinancial/paymentPart9Acceptance');
const part10Contract = require('../../src/customerFinancial/collectionPart10Acceptance');
const demoPart6 = require('../../src/customerFinancial/demoInvoicePart6Acceptance');
const workspace = require('../../src/commandCenter/workspace');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ESTIMATE = '11111111-1111-4111-8111-111111111111';
const RECEIPT = '22222222-2222-4222-8222-222222222222';
const DIGEST = 'a'.repeat(64);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function demoItem() {
  const tenant = '44444444-4444-4444-8444-444444444444';
  const state = workspace.createInitialDemoState(tenant, new Date('2026-10-15T12:00:00Z'),
    { seed:'part11a-accounting-export' });
  const view = workspace.buildDemoWorkspace({ tenantId:tenant, sessionId:ESTIMATE, state,
    revision:1, simulationCount:0, persisted:true,
    expiresAt:new Date('2026-10-16T12:00:00Z') });
  return workspace.demoCanonicalItems(view)[0];
}
function paidPart10() {
  const demoBundle = demoPart6.bundle(demoItem(),1);
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

describe('Mission 27 Part 11A provider-neutral accounting export contract', () => {
  test('projects the exact value-free export contract from one current Part 10 witness', () => {
    const source = paidPart10();
    const value = contract.unavailable(source);
    expect(contract.project(clone(value),source)).toEqual(value);
    expect(value).toMatchObject({
      contractVersion:'m27-accounting-export-contract-v1',
      policyVersion:'mission27.launch.v1',state:'unavailable',
      reason:'accounting_export_source_facts_unavailable',value:null,
      exactCurrentnessRevalidated:true,exportRecordCount:0,exportBatchCount:0,
      exportPreviewCount:0,transmissionCount:0,acknowledgementCount:0,
      accountingMutationCount:0,providerCallCount:0,receiverMutationCount:0,
      liveMoneyMovementCount:0,
    });
    expect(value.recordContract).toEqual({
      recordVersion:'m27-accounting-export-record-v1',providerNeutral:true,
      exactFields:contract.RECORD_FIELDS,exactLineageFields:contract.LINEAGE_FIELDS,
      fieldRules:contract.FIELD_RULES,everyRecordRequiresExactSourceId:true,
      everyRecordRequiresExactSourceAuthorityContractAndState:true,
      everyRecordRequiresCurrency:true,
      everyRecordRequiresSourceOccurredAndRecordedTimestamps:true,
      everyRecordRequiresImmutableRevisionAndDigestLineage:true,
      missingAmountRevisionTimestampOrCurrencyMayBecomeZeroOrCurrent:false,
      arrivalOrderMaySupplyOccurrenceTimeRevisionOrAuthority:false,
      correctionReversalOrVoidMayRewriteSourceRecord:false,
      destinationSpecificAccountOrJournalFieldsAllowed:false,
      destinationMappingMayRewriteSourceFact:false,
    });
    expect(value.factClasses.map(item => item.factType)).toEqual([
      'issued_invoice','payment','offline_cash','offline_check','credit','refund',
      'write_off','dispute','provider_fee','settlement',
    ]);
    expect(value.factClasses[1].acceptedEvidenceStates).toEqual([
      'created','authorized','processing','succeeded','failed','canceled',
      'settled','reversed','corrected',
    ]);
    expect(value.factClasses.every(item => item.state === 'unavailable' && item.value === null &&
      item.factState === null && item.sourceAuthority === null &&
      item.sourceRecordId === null && item.sourceRevision === null &&
      item.sourceDigest === null && item.sourceOccurredAt === null &&
      item.sourceRecordedAt === null && item.currency === null &&
      item.amountMinorUnits === null && item.sourceLineage === null)).toBe(true);
  });

  test('preserves offline meanings and denies accounting, tax or recognition inference', () => {
    const value = contract.unavailable(paidPart10());
    expect(value.offlineEvidence).toEqual({
      cashReceiptLaunchApproved:true,cashMayClaimProviderSettlement:false,
      checkReceiptLaunchApproved:true,exactCheckStates:['offline_received',
        'check_clearance_unknown','check_cleared','check_returned','offline_reversed'],
      checkClearedTransitionEnabled:false,
      checkClearanceAuthority:'unavailable_until_authenticated_bank_source',
      missingClearanceState:'check_clearance_authority_unavailable',
      accountingAcknowledgementMayClaimCheckClearance:false,
      humanAttestationPhotoPhoneOrFreeTextMayClaimClearance:false,
      returnAndReversalRequireExactOriginalReceiptAndAllocation:true,
    });
    expect(value.adapterBoundary).toMatchObject({
      configuredAdapter:'quickbooks_online.accounting_export.v1',supportedMode:'sandbox',
      runtimeAvailable:false,providerNeutralRecordContract:true,
      destinationSelectionAndMappingOwnedByPart11B:true,
      exportPreviewTransmissionAndAcknowledgementOwnedByPart11B:true,
      acknowledgementMayRewriteNorthStarSource:false,acknowledgementIsHumanAction:false,
    });
    expect(value.authority).toEqual({
      requiredCapability:'customer_financial.accounting.export',
      controlMode:'conditional_dual_control',currentCapabilityGrantState:'unavailable',
      currentReceivingAdapterState:'unavailable',roleAloneAuthorizesExport:false,
      transmissionAuthorized:false,mayInventChartOfAccounts:false,
      mayDecideRecognitionOrTax:false,mayCreateJournalTaxFilingOrBooksClose:false,
      legalTaxOrAccountingReviewComplete:false,
    });
  });

  test('rejects missing, reordered, contradictory, leaked or widened values', () => {
    const source=paidPart10(); const canonical=contract.unavailable(source);
    const mutations=[
      value=>value.factClasses.reverse(),
      value=>{value.factClasses[0].sourceRecordId='inv_victim';},
      value=>{value.factClasses[1].amountMinorUnits='0';},
      value=>{value.recordContract.exactFields.reverse();},
      value=>{value.recordContract.fieldRules.currency.silentConversionAllowed=true;},
      value=>{value.recordContract.everyRecordRequiresCurrency=false;},
      value=>{value.offlineEvidence.accountingAcknowledgementMayClaimCheckClearance=true;},
      value=>{value.adapterBoundary.runtimeAvailable=true;},
      value=>{value.authority.transmissionAuthorized=true;},
      value=>{value.bounds.candidateAbsoluteMinorUnits='0';},
      value=>{value.access.demoRouteAvailable=true;},
      value=>{value.privacy.customerIdentityExposed=true;},
      value=>{value.exportRecordCount=1;},
    ];
    for(const mutate of mutations){const changed=clone(canonical);mutate(changed);
      expect(()=>contract.project(changed,source)).toThrow('Accounting export contract invalid');}
  });

  test('revalidates the complete Part 10 bundle around export projection', async () => {
    const sourceBundle=paidPart10();
    const repository=require('../../src/customerFinancial/accountingExportContractRepository');
    const readPart10=jest.fn().mockResolvedValue(sourceBundle);
    const source={organizationId:ESTIMATE,actorUserId:RECEIPT,actorAccessRole:'owner',
      authSessionId:'33333333-3333-4333-8333-333333333333'};
    await expect(repository.read({},source,ESTIMATE,RECEIPT,DIGEST,{readPart10}))
      .resolves.toEqual(contract.unavailable(sourceBundle));
    expect(readPart10).toHaveBeenCalledTimes(2);
    const changed=clone(sourceBundle);changed.preview.previewDigest='c'.repeat(64);
    changed.part5Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part6Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part7Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part9Acceptance.previewWitness.previewDigest='c'.repeat(64);
    changed.part10Acceptance.previewWitness.previewDigest='c'.repeat(64);
    readPart10.mockReset().mockResolvedValueOnce(sourceBundle).mockResolvedValueOnce(changed);
    await expect(repository.read({},source,ESTIMATE,RECEIPT,DIGEST,{readPart10}))
      .rejects.toMatchObject({code:'CUSTOMER_FINANCIAL_ACCOUNTING_EXPORT_SOURCE_CHANGED',status:409});
  });

  test('mounts only the private paid read and contains no export or external effect path', () => {
    const route=read('src/routes/customerFinancialEditableEstimate.js');
    const source=[read('src/customerFinancial/accountingExportContract.js'),
      read('src/customerFinancial/accountingExportContractRepository.js')].join('\n');
    expect(route).toContain("router.all('/:estimateId/accounting-export-contract'");
    expect(route).toContain("router.get('/:estimateId/accounting-export-contract'");
    expect(route).not.toContain("router.post('/:estimateId/accounting-export-contract'");
    expect(read('src/routes/demo.js')).not.toContain('accounting-export-contract');
    expect(source).not.toMatch(/https\.request|fetch\(|quickbooks.*request|INSERT\s+INTO|UPDATE\s+/i);
    expect(source).toContain('exportRecordCount: 0');
    expect(source).toContain('transmissionCount: 0');
    expect(source).toContain('acknowledgementCount: 0');
    expect(source).toContain('accountingMutationCount: 0');
    expect(source).toContain('receiverMutationCount: 0');
    expect(source).toContain('liveMoneyMovementCount: 0');
  });
});
