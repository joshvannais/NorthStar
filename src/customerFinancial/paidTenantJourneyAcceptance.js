'use strict';

const { types: utilTypes } = require('node:util');
const providerBoundary = require('./paymentProviderBoundary');
const part5Contract = require('./invoicePart5Acceptance');
const part6Contract = require('./invoicePart6Acceptance');
const part7Contract = require('./paymentPart7Acceptance');
const part9Contract = require('./paymentPart9Acceptance');
const offlinePaymentContract = require('./offlinePaymentReadiness');
const part10Contract = require('./collectionPart10Acceptance');
const part11Contract = require('./accountingPart11Acceptance');
const part12Contract = require('./reportingPart12Acceptance');

const CONTRACT_VERSION = 'm27-paid-provider-disabled-journey-v1';
const EXECUTION_VERSION = 'm27-production-contract-journey-execution-v1';
const STATE = 'incomplete_provider_disabled';
const REASON = 'required_production_stage_evidence_unavailable';
const RELEASED_PART13 = Object.freeze({
  acceptedHead: 'd465d2c0576547571aa2b6c930d22af12b723381',
  acceptedTree: '05e317ee7ef2dc8e64604839752976f93a9968cc',
  mergedMain: '4b69a1c81db0d86eaa154a489f560c0a85b8f547',
  pullRequest: 533,
  deployment: '0ee0e7c1-d388-4a53-b293-50c59cbe4c7d',
  migrationLatest: 272,
  migration273Present: false,
  founderAuthorizedFallbackWholeHeadAuditAccepted: true,
  maximumAcceptedFindingSeverity: 'none_p0_through_p3',
  supportedNodeStandardReflectionIntrinsicsRequired: true,
  arbitraryEarlierSameProcessReplacementCovered: false,
});
const STAGE_ORDER = Object.freeze([
  'launch_approved_billable_handoff',
  'human_invoice_review_and_issue',
  'secure_customer_delivery',
  'deterministic_provider_payment',
  'simulated_settlement_evidence',
  'customer_receipt',
  'correction_and_refund',
  'receivable_update',
  'accounting_handoff',
  'downstream_evidence',
  'offline_cash_receipt',
  'offline_check_received',
]);
const CONTEXT_KEYS = Object.freeze(['source','estimateId','handoffReceiptId','handoffReceiptDigest']);
const SOURCE_KEYS = Object.freeze(['organizationId','actorUserId','actorAccessRole','authSessionId']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function invalid() { return new Error('Paid provider-disabled journey acceptance boundary invalid'); }

function assertPlainData(value) {
  if (Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') ||
      Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) throw invalid();
  const active = new Set(); const validated = new Set(); let nodes = 0;
  function visit(current, depth) {
    nodes += 1;
    if (nodes > 65536 || depth > 64) throw invalid();
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) throw invalid();
      return;
    }
    if (typeof current !== 'object' || utilTypes.isProxy(current) || active.has(current)) throw invalid();
    if (validated.has(current)) return;
    active.add(current);
    const array = Array.isArray(current);
    if (Object.getPrototypeOf(current) !== (array ? Array.prototype : Object.prototype) ||
        Object.getOwnPropertyDescriptor(current, 'toJSON')) throw invalid();
    const keys = Reflect.ownKeys(current);
    if (keys.some(key => typeof key !== 'string')) throw invalid();
    if (array) {
      const length = Object.getOwnPropertyDescriptor(current, 'length');
      if (!length || length.value !== current.length || keys.length !== current.length + 1) throw invalid();
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
        visit(descriptor.value, depth + 1);
      }
    } else {
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw invalid();
        visit(descriptor.value, depth + 1);
      }
    }
    active.delete(current); validated.add(current);
  }
  visit(value, 0);
}

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freeze(value[key]);
  return Object.freeze(value);
}

function validateContext(raw) {
  assertPlainData(raw);
  if (!exact(raw, CONTEXT_KEYS) || !exact(raw.source, SOURCE_KEYS) ||
      !UUID.test(raw.estimateId) || !UUID.test(raw.handoffReceiptId) ||
      !DIGEST.test(raw.handoffReceiptDigest) || !UUID.test(raw.source.organizationId) ||
      !UUID.test(raw.source.actorUserId) || !UUID.test(raw.source.authSessionId) ||
      !['owner','admin'].includes(raw.source.actorAccessRole)) throw invalid();
  return raw;
}

function reconstruct(raw, keys, contractVersion) {
  const value = { contractVersion };
  for (const key of keys) value[key] = raw[key];
  return value;
}

function executeReleasedContracts(part12Raw, traceRaw) {
  assertPlainData(part12Raw);
  assertPlainData(traceRaw);
  if (!exact(traceRaw, ['part9','part10','part11','part12Sources','repositoryReads']) ||
      !exact(traceRaw.repositoryReads,
        ['part9','part10','part11','part12Sources','part12']) ||
      JSON.stringify(traceRaw.repositoryReads) !== JSON.stringify({
        part9:4,part10:2,part11:1,part12Sources:2,part12:1,
      }) || !exact(traceRaw.part12Sources,
        ['invoiceReceivableReporting','paymentCashReporting','downstreamReportingReaders'])) throw invalid();
  const expectedPart9 = reconstruct(part12Raw,
    ['preview','part5Acceptance','part6Acceptance','part7Acceptance','part9Acceptance'],
    part9Contract.BUNDLE_VERSION);
  const expectedPart10 = reconstruct(part12Raw,
    ['preview','part5Acceptance','part6Acceptance','part7Acceptance','part9Acceptance',
      'part10Acceptance'], part10Contract.BUNDLE_VERSION);
  const expectedPart11 = reconstruct(part12Raw,
    ['preview','part5Acceptance','part6Acceptance','part7Acceptance','part9Acceptance',
      'part10Acceptance','part11SourceContracts','part11Acceptance'],
    part11Contract.BUNDLE_VERSION);
  if (JSON.stringify(traceRaw.part9) !== JSON.stringify(expectedPart9) ||
      JSON.stringify(traceRaw.part10) !== JSON.stringify(expectedPart10) ||
      JSON.stringify(traceRaw.part11) !== JSON.stringify(expectedPart11)) throw invalid();
  const part9 = part9Contract.projectBundle(traceRaw.part9, 'paid');
  const part10 = part10Contract.projectBundle(traceRaw.part10, 'paid');
  const part11Sources = part11Contract.derive(part10, 'paid');
  const part11 = part11Contract.projectBundle(traceRaw.part11, 'paid', part11Sources);
  const part7 = part7Contract.projectBundle(reconstruct(part9,
    ['preview','part5Acceptance','part6Acceptance','part7Acceptance'],
    part7Contract.BUNDLE_VERSION), 'paid');
  const part6 = part6Contract.projectBundle(reconstruct(part7,
    ['preview','part5Acceptance','part6Acceptance'], part6Contract.BUNDLE_VERSION), 'paid');
  const part5 = part5Contract.projectBundle({ contractVersion:part5Contract.BUNDLE_VERSION,
    preview:part6.preview, acceptance:part6.part5Acceptance }, 'paid');
  const part12Sources = traceRaw.part12Sources;
  const part12 = part12Contract.projectBundle(part12Raw, 'paid', part12Sources);
  const offline = offlinePaymentContract.project(offlinePaymentContract.unavailable());
  return { part5, part6, part7, part9, part10, part11, part12,
    offline, part11Sources, part12Sources };
}

function witness(stage, source, contractVersion, state, reason, bindingDigest) {
  return freeze({ stage, contractVersion, state, reason: reason || null,
    sourceDigest: providerBoundary.digest(source), journeyBindingDigest: bindingDigest,
    contractValidationExecuted: true, productionEffectExecuted: false,
    durableEffectCreated: false, externalEffectCreated: false });
}

function findFact(report, name) {
  const fact = report.facts.find(value => value.fact === name);
  if (!fact) throw invalid();
  return fact;
}

function candidate(part12Raw, contextRaw, traceRaw) {
  const context = validateContext(contextRaw);
  const chain = executeReleasedContracts(part12Raw, traceRaw);
  const { part5, part6, part7, part9, part11, part12, offline, part12Sources } = chain;
  const preview = part12.preview;
  if (preview.draftIdentity.estimateId !== context.estimateId ||
      preview.mode !== 'paid' || preview.fictional !== false) throw invalid();
  const launch = providerBoundary.validateLaunchPolicy();
  if (launch.rollout.currentStage !== 'disabled' || launch.financial.liveModeDefaultEnabled !== false ||
      launch.financial.partialProviderPayments !== false ||
      launch.financial.multiInvoiceProviderPayments !== false ||
      launch.financial.offline.cashReceiptEnabled !== true ||
      launch.financial.offline.checkReceiptEnabled !== true ||
      launch.financial.offline.checkClearedTransitionEnabled !== false ||
      launch.financial.offline.checkClearanceAuthority !==
        'unavailable_until_authenticated_bank_source') throw invalid();
  const preparedTotal = preview.reconciliation.preparedDocumentTotal;
  if (preparedTotal.state !== 'preparation_only' ||
      preparedTotal.value?.currency !== launch.financial.supportedCurrency ||
      preview.reconciliation.amountDue.state !== 'unavailable' ||
      preview.reconciliation.amountDue.value !== null) throw invalid();
  const recordScopeDigest = providerBoundary.digest({
    organizationId: context.source.organizationId, estimateId: context.estimateId,
    handoffReceiptId: context.handoffReceiptId,
    handoffReceiptDigest: context.handoffReceiptDigest,
  });
  const journeyBinding = {
    recordScopeDigest,
    requestAuthorizationDigest: providerBoundary.digest(context.source),
    estimateIdentityDigest: providerBoundary.digest(preview.draftIdentity),
    handoffReceiptDigest: context.handoffReceiptDigest,
    draftRevision: preview.draftIdentity.revision,
    draftDigest: preview.draftIdentity.draftDigest,
    historyChainDigest: preview.draftIdentity.historyChainDigest,
    componentsDigest: preview.draftIdentity.componentsDigest,
    preparationDigest: preview.draftIdentity.preparationDigest,
    previewDigest: preview.previewDigest,
    currency: preparedTotal.value.currency,
    preparedDocumentTotalState: preparedTotal.state,
    preparedDocumentTotalDigest: providerBoundary.digest(preparedTotal),
    amountDueState: preview.reconciliation.amountDue.state,
    amountDueValue: null,
  };
  const bindingDigest = providerBoundary.digest(journeyBinding);
  const cashFact = findFact(part12Sources.paymentCashReporting, 'offline_cash_received_amount');
  const checkFact = findFact(part12Sources.paymentCashReporting, 'check_clearance_unknown_amount');
  const clearedFact = findFact(part12Sources.paymentCashReporting, 'check_cleared_amount');
  if (offline.cashSemantics.acceptedState !== 'offline_received' ||
      offline.checkSemantics.acceptedState !== 'check_clearance_unknown' ||
      offline.clearedCheckSemantics.currentProjectionState !== 'check_clearance_authority_unavailable' ||
      part9.part9Acceptance.customerReceipt.checkReceivedRequiredWording !==
        'check received — clearance unknown' ||
      part9.part9Acceptance.customerReceipt.receiptMayClaimProviderSettlementOrBankClearance !== false ||
      part9.part9Acceptance.accounting.maySupplyCheckClearance !== false ||
      cashFact.state !== 'unavailable' || checkFact.state !== 'unavailable' ||
      clearedFact.state !== 'check_clearance_authority_unavailable') throw invalid();
  const stages = [
    witness(STAGE_ORDER[0], preview, preview.contractVersion, preview.state, null, bindingDigest),
    witness(STAGE_ORDER[1], part5.acceptance, part5.acceptance.contractVersion,
      part5.acceptance.state, part5.acceptance.reason, bindingDigest),
    witness(STAGE_ORDER[2], part6.part6Acceptance, part6.part6Acceptance.contractVersion,
      part6.part6Acceptance.delivery.state, part6.part6Acceptance.delivery.reason, bindingDigest),
    witness(STAGE_ORDER[3], part7.part7Acceptance, part7.part7Acceptance.contractVersion,
      part7.part7Acceptance.state, part7.part7Acceptance.reason, bindingDigest),
    witness(STAGE_ORDER[4], part9.part9Acceptance, part9.part9Acceptance.contractVersion,
      part9.part9Acceptance.state, part9.part9Acceptance.reason, bindingDigest),
    witness(STAGE_ORDER[5], part9.part9Acceptance.customerReceipt,
      part9.part9Acceptance.contractVersion, part9.part9Acceptance.customerReceipt.state,
      part9.part9Acceptance.customerReceipt.reason, bindingDigest),
    witness(STAGE_ORDER[6], part9.part9Acceptance.correctionRecovery,
      part9.part9Acceptance.contractVersion, part9.part9Acceptance.correctionRecovery.state,
      part9.part9Acceptance.correctionRecovery.reason, bindingDigest),
    witness(STAGE_ORDER[7], part12Sources.invoiceReceivableReporting,
      part12Sources.invoiceReceivableReporting.contractVersion,
      part12Sources.invoiceReceivableReporting.state,
      part12Sources.invoiceReceivableReporting.reason, bindingDigest),
    witness(STAGE_ORDER[8], part11.part11Acceptance, part11.part11Acceptance.contractVersion,
      part11.part11Acceptance.state, part11.part11Acceptance.reason, bindingDigest),
    witness(STAGE_ORDER[9], part12Sources.downstreamReportingReaders,
      part12Sources.downstreamReportingReaders.contractVersion,
      part12Sources.downstreamReportingReaders.state,
      part12Sources.downstreamReportingReaders.reason, bindingDigest),
    witness(STAGE_ORDER[10], part9.part9Acceptance, part9.part9Acceptance.contractVersion,
      cashFact.state, cashFact.reason, bindingDigest),
    witness(STAGE_ORDER[11], part9.part9Acceptance, part9.part9Acceptance.contractVersion,
      checkFact.state, checkFact.reason, bindingDigest),
  ];
  const offlineBranch = (method, intendedState, fact, clearanceState) => freeze({
    method, intendedAcceptedState: intendedState, productionState: fact.state,
    productionReason: fact.reason, value: null, journeyBindingDigest: bindingDigest,
    reviewedCurrentHumanRequired: true, exactTenantInvoiceBalanceAndAllocationRequired: true,
    receiptState: part9.part9Acceptance.customerReceipt.state,
    receiptReason: part9.part9Acceptance.customerReceipt.reason,
    accountingState: part11.part11Acceptance.state,
    accountingReason: part11.part11Acceptance.reason,
    reportingState: part12Sources.paymentCashReporting.state,
    reportingReason: part12Sources.paymentCashReporting.reason,
    balanceFact: fact.fact, balanceState: fact.state, checkClearanceState: clearanceState,
    contractValidationExecuted: true, acceptedReceiptCreated: false,
    balanceMutationCreated: false, customerReceiptCreated: false,
    accountingHandoffCreated: false, reportingRecordCreated: false,
    providerOrBankSettlementClaimed: false,
  });
  return freeze({
    contractVersion: CONTRACT_VERSION, executionVersion: EXECUTION_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION, policyDigest: providerBoundary.POLICY_DIGEST,
    state: STATE, reason: REASON, value: null, mode: 'paid', fictional: false,
    journeyBinding: freeze({ ...journeyBinding, journeyBindingDigest: bindingDigest,
      rawTenantActorSessionEstimateOrReceiptIdentityReturned: false }),
    releasedPart13: RELEASED_PART13,
    sourceWitnesses: freeze([
      { source: 'part12_reporting_acceptance', contractVersion: part12Contract.CONTRACT_VERSION,
        state: part12.part12Acceptance.state, reason: part12.part12Acceptance.reason,
        digest: providerBoundary.digest(part12) },
      { source: 'part13_release_authority', contractVersion: 'm27-part13-release-v1',
        state: 'released', reason: 'founder_authorized_fallback_audit_accepted',
        digest: providerBoundary.digest(RELEASED_PART13) },
    ]),
    launchMatrix: freeze({
      rolloutStage: launch.rollout.currentStage,
      liveCapabilityEnabled: launch.financial.liveModeDefaultEnabled,
      providerMode: launch.financial.supportedMode,
      providerMethod: launch.financial.supportedOnlineMethods[0],
      partialProviderPaymentsEnabled: launch.financial.partialProviderPayments,
      multiInvoiceProviderPaymentsEnabled: launch.financial.multiInvoiceProviderPayments,
      offlineCashReceiptEnabled: launch.financial.offline.cashReceiptEnabled,
      offlineCheckReceiptEnabled: launch.financial.offline.checkReceiptEnabled,
      checkClearedTransitionEnabled: launch.financial.offline.checkClearedTransitionEnabled,
      checkClearanceAuthority: launch.financial.offline.checkClearanceAuthority,
      checkClearanceUnavailableState: 'check_clearance_authority_unavailable',
    }),
    execution: freeze({
      deterministic: true, inProcess: true, explicitSyntheticProviderDisabledProvenance: true,
      productionContractsExecuted: freeze([part5Contract.CONTRACT_VERSION,
        part6Contract.CONTRACT_VERSION, part7Contract.CONTRACT_VERSION,
        part9Contract.CONTRACT_VERSION, part10Contract.CONTRACT_VERSION,
        part11Contract.CONTRACT_VERSION, part12Contract.CONTRACT_VERSION]),
      repositoryReadCounts: freeze({ ...traceRaw.repositoryReads }),
      stages, requiredStageCount: STAGE_ORDER.length,
      contractValidationStageCount: stages.length, skippedStageCount: 0,
      duplicateStageCount: 0, completeContractValidationTrace: true,
      completeProductionJourney: false, providerAccountUsed: false, credentialUsed: false,
      externalTransportUsed: false, liveMoneyUsed: false,
    }),
    offlineBranches: freeze([
      offlineBranch('cash', offline.cashSemantics.acceptedState, cashFact, 'not_applicable'),
      offlineBranch('check', offline.checkSemantics.acceptedState, checkFact,
        offline.clearedCheckSemantics.currentProjectionState),
    ]),
    separation: freeze({
      contractExecutionIsFinancialTruth: false,
      syntheticProviderEvidenceMayCreateProviderOrBankSettlement: false,
      contractExecutionMayCreateInvoicePaymentRefundReceiptOrAccountingRecord: false,
      productionValuesRemainServerOwned: true, unavailableMayBecomeZero: false,
      providerSuccessMayImplySettlement: false,
      settlementMayImplyPayoutOrBankArrival: false,
      checkReceivedMayImplyClearance: false,
      accountingAcknowledgementMayImplySettlementOrClearance: false,
    }),
    authorityAndCurrentness: freeze({
      exactTenantSessionRoleAndRecordScopeRequired: true,
      ownerOrAdministratorRoleRequired: true, exactCurrentHandoffReceiptRequired: true,
      exactCurrentInvoiceAndFinancialSourceRequired: true,
      currentHumanReviewAndIssueAuthorityRequired: true,
      currentCustomerDeliveryAuthorityRequired: true,
      idempotencyKeyAndExactRequestDigestRequiredForConsequentialActions: true,
      oneConcurrentWriterPerAggregate: true, duplicateConsequentialEffectAllowed: false,
      sourceCorrectionRequiresNewProjection: true, missingOrUnavailableMayBecomeZero: false,
      customerPrivateOrProviderSecretReturned: false,
    }),
    acceptance: freeze({
      exactPaidProductionContractsExecuted: true,
      completeOrderedContractValidationTracePresent: true,
      completeProductionJourneyAccepted: false,
      providerDisabledBoundaryPreserved: true,
      partialAndMultiInvoicePathsCorrectlyExcluded: true,
      offlineCashAndCheckBranchesIndependentlyValidated: true,
      independentWholeHeadAuditAccepted: false,
      providerSandboxEvidenceAccepted: false,
      livePaymentEvidenceAccepted: false,
      founderVisualApprovalAccepted: false,
    }),
    exactCurrentnessRevalidatedBeforeAndAfterProjection: true,
    idempotencyReplayEffectCount: 0, providerCallCount: 0, providerMutationCount: 0,
    receiverMutationCount: 0, accountingMutationCount: 0, downstreamMutationCount: 0,
    databaseMutationCount: 0, liveMoneyMovementCount: 0,
  });
}

function project(raw, part12Raw, contextRaw, traceRaw) {
  assertPlainData(raw);
  const expected = candidate(part12Raw, contextRaw, traceRaw);
  if (JSON.stringify(raw) !== JSON.stringify(expected)) throw invalid();
  return expected;
}

module.exports = { CONTRACT_VERSION, EXECUTION_VERSION, STATE, REASON, STAGE_ORDER,
  RELEASED_PART13, executeReleasedContracts, candidate, project };
