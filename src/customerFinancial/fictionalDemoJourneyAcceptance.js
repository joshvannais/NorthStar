'use strict';

const { types: utilTypes } = require('node:util');
const providerBoundary = require('./paymentProviderBoundary');
const part12Contract = require('./reportingPart12Acceptance');
const offlineContract = require('./offlinePaymentReadiness');

const CONTRACT_VERSION = 'm27-fictional-demo-journey-acceptance-v1';
const ENVELOPE_VERSION = 'm27-fictional-demo-journey-bundle-v1';
const STATE = 'current_fictional_demo';
const STAGE_ORDER = Object.freeze([
  'approved_estimate_selected',
  'billable_handoff_projected',
  'invoice_draft_reviewed',
  'invoice_issued_fictionally',
  'secure_delivery_recorded_fictionally',
  'provider_session_disabled',
  'provider_event_simulated_fictionally',
  'settlement_simulated_fictionally',
  'customer_receipt_generated_fictionally',
  'correction_refund_dispute_simulated_fictionally',
  'receivable_collections_projected_fictionally',
  'accounting_handoff_projected_fictionally',
  'downstream_reporting_projected_fictionally',
  'offline_cash_received_fictionally',
  'offline_check_received_clearance_unknown_fictionally',
]);
const STAGE_STATES = Object.freeze([
  'fictional_current', 'fictional_current', 'fictional_reviewed',
  'fictional_issued', 'fictional_delivered', 'provider_disabled',
  'fictional_event_recorded', 'fictional_settlement_recorded',
  'fictional_receipt_available', 'fictional_correction_recorded',
  'fictional_receivable_current', 'fictional_handoff_current',
  'fictional_reporting_current', 'offline_received', 'check_clearance_unknown',
]);
const CONTEXT_KEYS = Object.freeze(['tenantId','sessionId','estimateId','workspaceRevision',
  'workspaceGeneration','workspaceSeedDigest','workspaceStateDigest','canonicalBaseline',
  'currentMutationKeyCount','simulationCount']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function invalid() { return new Error('Fictional demo financial journey acceptance invalid'); }

function assertPlainData(value) {
  if (Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') ||
      Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) throw invalid();
  const active = new Set(); const complete = new Set(); let nodes = 0;
  function visit(current, depth) {
    nodes += 1;
    if (nodes > 65536 || depth > 64) throw invalid();
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) throw invalid();
      return;
    }
    if (typeof current !== 'object' || utilTypes.isProxy(current) || active.has(current)) {
      throw invalid();
    }
    if (complete.has(current)) return;
    active.add(current);
    const array = Array.isArray(current);
    if (Object.getPrototypeOf(current) !== (array ? Array.prototype : Object.prototype) ||
        Object.getOwnPropertyDescriptor(current, 'toJSON')) throw invalid();
    const keys = Reflect.ownKeys(current);
    if (keys.some(key => typeof key !== 'string')) throw invalid();
    if (array) {
      const length = Object.getOwnPropertyDescriptor(current, 'length');
      if (!length || length.value !== current.length || keys.length !== current.length + 1) {
        throw invalid();
      }
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw invalid();
        }
        visit(descriptor.value, depth + 1);
      }
    } else {
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw invalid();
        }
        visit(descriptor.value, depth + 1);
      }
    }
    active.delete(current); complete.add(current);
  }
  visit(value, 0);
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freeze(value[key]);
  return Object.freeze(value);
}

function validateContext(raw) {
  assertPlainData(raw);
  if (!exact(raw, CONTEXT_KEYS) || !UUID.test(raw.tenantId) || !UUID.test(raw.sessionId) ||
      !UUID.test(raw.estimateId) || !Number.isSafeInteger(raw.workspaceRevision) ||
      raw.workspaceRevision < 1 || !Number.isSafeInteger(raw.workspaceGeneration) ||
      raw.workspaceGeneration < 1 || !DIGEST.test(raw.workspaceSeedDigest) ||
      !DIGEST.test(raw.workspaceStateDigest) || typeof raw.canonicalBaseline !== 'boolean' ||
      !Number.isSafeInteger(raw.currentMutationKeyCount) || raw.currentMutationKeyCount < 0 ||
      !Number.isSafeInteger(raw.simulationCount) || raw.simulationCount < 0) throw invalid();
  return raw;
}

function stage(name, state, source, sourceState, sourceReason, bindingDigest,
  sourceContractVersion) {
  return freeze({ name, state,
    sourceContractVersion: sourceContractVersion || source.contractVersion,
    sourceState, sourceReason: sourceReason || null, sourceDigest: providerBoundary.digest(source),
    journeyBindingDigest: bindingDigest, fictional: true, syntheticEvidenceOnly: true,
    current: true, humanAuthorityFabricated: false, providerOrBankTruthFabricated: false,
    productionEffectExecuted: false, durableExternalEffectCreated: false });
}

function candidate(part12Raw, contextRaw) {
  assertPlainData(part12Raw);
  const context = validateContext(contextRaw);
  const part12 = part12Contract.projectBundle(part12Raw, 'demo');
  const preview = part12.preview;
  if (preview.mode !== 'demo' || preview.fictional !== true ||
      preview.state !== 'current' || preview.draftIdentity.estimateId !== context.estimateId ||
      preview.draftIdentity.revision !== context.workspaceRevision ||
      preview.documentPreview.fictional !== true ||
      preview.documentPreview.issuedDocument !== false ||
      preview.reconciliation.preparedDocumentTotal.state !== 'preparation_only' ||
      preview.reconciliation.amountDue.state !== 'unavailable' ||
      preview.reconciliation.amountDue.value !== null) throw invalid();
  const launch = providerBoundary.validateLaunchPolicy();
  if (launch.rollout.currentStage !== 'disabled' ||
      launch.financial.liveModeDefaultEnabled !== false ||
      launch.financial.partialProviderPayments !== false ||
      launch.financial.multiInvoiceProviderPayments !== false ||
      launch.financial.offline.cashReceiptEnabled !== true ||
      launch.financial.offline.checkReceiptEnabled !== true ||
      launch.financial.offline.checkClearedTransitionEnabled !== false ||
      launch.financial.offline.checkClearanceAuthority !==
        'unavailable_until_authenticated_bank_source') throw invalid();
  const offline = offlineContract.project(offlineContract.unavailable());
  if (offline.cashSemantics.acceptedState !== 'offline_received' ||
      offline.checkSemantics.acceptedState !== 'check_clearance_unknown' ||
      offline.clearedCheckSemantics.currentProjectionState !==
        'check_clearance_authority_unavailable' ||
      part12.part9Acceptance.customerReceipt.checkReceivedRequiredWording !==
        'check received — clearance unknown' ||
      part12.part9Acceptance.customerReceipt.receiptMayClaimProviderSettlementOrBankClearance !== false ||
      part12.part9Acceptance.accounting.maySupplyCheckClearance !== false) throw invalid();

  const binding = {
    tenantScopeDigest: providerBoundary.digest({ tenantId: context.tenantId }),
    sessionScopeDigest: providerBoundary.digest({ tenantId: context.tenantId,
      sessionId: context.sessionId }),
    recordScopeDigest: providerBoundary.digest({ tenantId: context.tenantId,
      sessionId: context.sessionId, estimateId: context.estimateId }),
    workspaceRevision: context.workspaceRevision,
    workspaceGeneration: context.workspaceGeneration,
    workspaceSeedDigest: context.workspaceSeedDigest,
    workspaceStateDigest: context.workspaceStateDigest,
    draftRevision: preview.draftIdentity.revision,
    draftDigest: preview.draftIdentity.draftDigest,
    previewDigest: preview.previewDigest,
    currency: preview.reconciliation.preparedDocumentTotal.value.currency,
  };
  const bindingDigest = providerBoundary.digest(binding);
  const stages = [
    stage(STAGE_ORDER[0], STAGE_STATES[0], preview, preview.state, null, bindingDigest),
    stage(STAGE_ORDER[1], STAGE_STATES[1], preview, preview.state, null, bindingDigest),
    stage(STAGE_ORDER[2], STAGE_STATES[2], part12.part5Acceptance,
      part12.part5Acceptance.state, part12.part5Acceptance.reason, bindingDigest),
    stage(STAGE_ORDER[3], STAGE_STATES[3], part12.part5Acceptance.issueReadiness,
      part12.part5Acceptance.issueReadiness.state,
      part12.part5Acceptance.issueReadiness.reason, bindingDigest),
    stage(STAGE_ORDER[4], STAGE_STATES[4], part12.part6Acceptance.delivery,
      part12.part6Acceptance.delivery.state, part12.part6Acceptance.delivery.reason, bindingDigest),
    stage(STAGE_ORDER[5], STAGE_STATES[5], part12.part7Acceptance,
      part12.part7Acceptance.state, part12.part7Acceptance.reason, bindingDigest),
    stage(STAGE_ORDER[6], STAGE_STATES[6], part12.part9Acceptance,
      part12.part9Acceptance.state, part12.part9Acceptance.reason, bindingDigest),
    stage(STAGE_ORDER[7], STAGE_STATES[7], part12.part9Acceptance,
      part12.part9Acceptance.state, part12.part9Acceptance.reason, bindingDigest),
    stage(STAGE_ORDER[8], STAGE_STATES[8], part12.part9Acceptance.customerReceipt,
      part12.part9Acceptance.customerReceipt.state,
      part12.part9Acceptance.customerReceipt.reason, bindingDigest,
      part12.part9Acceptance.contractVersion),
    stage(STAGE_ORDER[9], STAGE_STATES[9], part12.part9Acceptance.correctionRecovery,
      part12.part9Acceptance.correctionRecovery.state,
      part12.part9Acceptance.correctionRecovery.reason, bindingDigest,
      part12.part9Acceptance.contractVersion),
    stage(STAGE_ORDER[10], STAGE_STATES[10], part12.part10Acceptance,
      part12.part10Acceptance.state, part12.part10Acceptance.reason, bindingDigest),
    stage(STAGE_ORDER[11], STAGE_STATES[11], part12.part11Acceptance,
      part12.part11Acceptance.state, part12.part11Acceptance.reason, bindingDigest),
    stage(STAGE_ORDER[12], STAGE_STATES[12], part12.part12Acceptance,
      part12.part12Acceptance.state, part12.part12Acceptance.reason, bindingDigest),
    stage(STAGE_ORDER[13], STAGE_STATES[13], part12.part9Acceptance,
      'unavailable', 'source_authority_unavailable', bindingDigest),
    stage(STAGE_ORDER[14], STAGE_STATES[14], part12.part9Acceptance,
      'unavailable', 'source_authority_unavailable', bindingDigest),
  ];
  return freeze({
    contractVersion: CONTRACT_VERSION, policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST, state: STATE, reason: null,
    mode: 'demo', fictional: true, syntheticEvidenceOnly: true,
    label: 'Fictional financial lifecycle — no real customer, provider, bank, or money effect',
    sourceWitness: freeze({ contractVersion: part12Contract.BUNDLE_VERSION,
      digest: providerBoundary.digest(part12) }),
    journeyBinding: freeze({ ...binding, journeyBindingDigest: bindingDigest,
      rawTenantSessionOrRecordIdentityReturned: false }),
    launchMatrix: freeze({ rolloutStage: launch.rollout.currentStage,
      liveCapabilityEnabled: launch.financial.liveModeDefaultEnabled,
      providerMode: launch.financial.supportedMode,
      providerMethod: launch.financial.supportedOnlineMethods[0],
      partialProviderPaymentsEnabled: launch.financial.partialProviderPayments,
      multiInvoiceProviderPaymentsEnabled: launch.financial.multiInvoiceProviderPayments,
      offlineCashReceiptEnabled: launch.financial.offline.cashReceiptEnabled,
      offlineCheckReceiptEnabled: launch.financial.offline.checkReceiptEnabled,
      checkClearedTransitionEnabled: launch.financial.offline.checkClearedTransitionEnabled,
      checkClearanceState: 'check_clearance_authority_unavailable' }),
    lifecycle: freeze({ stages, requiredStageCount: STAGE_ORDER.length,
      currentStageCount: stages.length, skippedStageCount: 0, duplicateStageCount: 0,
      exactOrderedSourceContractsRevalidated: true, realisticFictionalStatesProjected: true,
      humanReviewRepresentedAsFictionalEvidenceOnly: true,
      providerSessionEventAndSettlementRepresentedAsFictionalEvidenceOnly: true,
      productionFinancialTruthCreated: false }),
    reset: freeze({ supported: true, endpoint: '/api/demo/command-center/reset',
      currentGeneration: context.workspaceGeneration,
      currentWorkspaceRevision: context.workspaceRevision,
      canonicalBaseline: context.canonicalBaseline,
      currentMutationKeyCount: context.currentMutationKeyCount,
      currentSimulationCount: context.simulationCount,
      exactExpectedRevisionRequired: true, idempotencyKeyRequired: true,
      sameSessionOnly: true, duplicateResetReplays: true,
      resetRestoresCanonicalBaseline: true, resetRemovesUserCreatedDemoMutations: true,
      resetMayReadOrMutatePaidData: false }),
    isolation: freeze({ accountFreeDemoNamespaceOnly: true,
      exactTenantSessionRecordAndSourceRequired: true, paidRepositoryReadAllowed: false,
      paidRouteFallbackAllowed: false, paidPrivateDataReturned: false,
      providerAccountAllowed: false, credentialOrSecretAllowed: false,
      providerTransportAllowed: false, webhookAllowed: false,
      receiverOrOutboundDeliveryAllowed: false, productionDatabaseWriteAllowed: false,
      realCustomerSessionOrDocumentAllowed: false, crossSessionReuseAllowed: false,
      cacheSharedWithPaidData: false }),
    acceptance: freeze({ completeResettableFictionalJourneyProjected: true,
      exactPart12ProductionContractsRevalidated: true,
      strictPaidDemoIsolationPreserved: true, realisticFictionalLifecycleStatesPresent: true,
      checkReceivedRemainsDistinctFromClearance: true,
      providerSandboxEvidenceAccepted: false, livePaymentEvidenceAccepted: false,
      productionJourneyAccepted: false, independentWholeHeadAuditAccepted: false,
      founderVisualApprovalAccepted: false }),
    exactCurrentnessRevalidatedBeforeAndAfterProjection: true,
    sourceReadCount: 2, providerCallCount: 0, providerMutationCount: 0,
    receiverMutationCount: 0, outboundMessageCount: 0, accountingMutationCount: 0,
    downstreamMutationCount: 0, paidRepositoryReadCount: 0,
    productionDatabaseMutationCount: 0, liveMoneyMovementCount: 0,
  });
}

function bundle(part12Raw, contextRaw) {
  const part12 = part12Contract.projectBundle(part12Raw, 'demo');
  return freeze({ contractVersion: ENVELOPE_VERSION, part12Bundle: part12,
    journeyAcceptance: candidate(part12, contextRaw) });
}

function project(raw, part12Raw, contextRaw) {
  assertPlainData(raw);
  const expected = bundle(part12Raw, contextRaw);
  if (JSON.stringify(raw) !== JSON.stringify(expected)) throw invalid();
  return expected;
}

module.exports = { CONTRACT_VERSION, ENVELOPE_VERSION, STATE, STAGE_ORDER, STAGE_STATES,
  candidate, bundle, project };
