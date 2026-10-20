'use strict';

const { types: utilTypes } = require('node:util');
const providerBoundary = require('./paymentProviderBoundary');
const paidJourney = require('./paidTenantJourneyAcceptance');
const providerRecovery = require('./providerLifecycleRecovery');
const providerAcceptance = require('./providerLifecycleAcceptance');
const postIssueCorrection = require('./invoicePostIssueCorrection');
const creditRefund = require('./creditRefundReadiness');
const offlinePayment = require('./offlinePaymentReadiness');
const paymentOutcome = require('./paymentOutcomeReadiness');
const lifecycleRetention = require('./providerLifecycleRetention');

const CONTRACT_VERSION = 'm27-financial-lifecycle-recovery-acceptance-v1';
const STATE = 'incomplete_required_evidence';
const REASON = 'financial_lifecycle_recovery_evidence_unavailable';
const SCENARIO_ORDER = Object.freeze([
  'migration', 'restart', 'replay', 'out_of_order_event', 'uncertain_response',
  'source_correction', 'reopening', 'dispute', 'refund', 'retention', 'deletion',
  'restore', 'offline_duplicate_safe_receipt', 'offline_append_only_correction',
  'offline_reversal', 'check_clearance_or_unknown', 'returned_check_nsf_reopening',
  'downstream_correction_and_recovery',
]);
const CONTEXT_KEYS = Object.freeze([
  'source', 'estimateId', 'handoffReceiptId', 'handoffReceiptDigest',
]);
const SOURCE_KEYS = Object.freeze([
  'organizationId', 'actorUserId', 'actorAccessRole', 'authSessionId',
]);
const PAID_KEYS = Object.freeze([
  'contractVersion', 'executionVersion', 'policyVersion', 'policyDigest', 'state',
  'reason', 'value', 'mode', 'fictional', 'journeyBinding', 'releasedPart13',
  'sourceWitnesses', 'launchMatrix', 'execution', 'offlineBranches', 'separation',
  'authorityAndCurrentness', 'acceptance',
  'exactCurrentnessRevalidatedBeforeAndAfterProjection', 'idempotencyReplayEffectCount',
  'providerCallCount', 'providerMutationCount', 'receiverMutationCount',
  'accountingMutationCount', 'downstreamMutationCount', 'databaseMutationCount',
  'liveMoneyMovementCount',
]);
const PAID_BINDING_KEYS = Object.freeze([
  'recordScopeDigest', 'requestAuthorizationDigest', 'estimateIdentityDigest',
  'handoffReceiptDigest', 'draftRevision', 'draftDigest', 'historyChainDigest',
  'componentsDigest', 'preparationDigest', 'previewDigest', 'currency',
  'preparedDocumentTotalState', 'preparedDocumentTotalDigest', 'amountDueState',
  'amountDueValue', 'journeyBindingDigest',
  'rawTenantActorSessionEstimateOrReceiptIdentityReturned',
]);
const RELEASED_PART13_KEYS = Object.freeze([
  'acceptedHead', 'acceptedTree', 'mergedMain', 'pullRequest', 'deployment',
  'migrationLatest', 'migration273Present',
  'founderAuthorizedFallbackWholeHeadAuditAccepted', 'maximumAcceptedFindingSeverity',
  'supportedNodeStandardReflectionIntrinsicsRequired',
  'arbitraryEarlierSameProcessReplacementCovered',
]);
const SOURCE_WITNESS_KEYS = Object.freeze([
  'source', 'contractVersion', 'state', 'reason', 'digest',
]);
const LAUNCH_KEYS = Object.freeze([
  'rolloutStage', 'liveCapabilityEnabled', 'providerMode', 'providerMethod',
  'partialProviderPaymentsEnabled', 'multiInvoiceProviderPaymentsEnabled',
  'offlineCashReceiptEnabled', 'offlineCheckReceiptEnabled',
  'checkClearedTransitionEnabled', 'checkClearanceAuthority',
  'checkClearanceUnavailableState',
]);
const EXECUTION_KEYS = Object.freeze([
  'deterministic', 'inProcess', 'explicitSyntheticProviderDisabledProvenance',
  'productionContractsExecuted', 'repositoryReadCounts', 'stages',
  'requiredStageCount', 'contractValidationStageCount', 'skippedStageCount',
  'duplicateStageCount', 'completeContractValidationTrace',
  'completeProductionJourney', 'providerAccountUsed', 'credentialUsed',
  'externalTransportUsed', 'liveMoneyUsed',
]);
const REPOSITORY_READ_KEYS = Object.freeze([
  'part9', 'part10', 'part11', 'part12Sources', 'part12',
]);
const STAGE_KEYS = Object.freeze([
  'stage', 'contractVersion', 'state', 'reason', 'sourceDigest',
  'journeyBindingDigest', 'contractValidationExecuted', 'productionEffectExecuted',
  'durableEffectCreated', 'externalEffectCreated',
]);
const OFFLINE_BRANCH_KEYS = Object.freeze([
  'method', 'intendedAcceptedState', 'productionState', 'productionReason', 'value',
  'journeyBindingDigest', 'reviewedCurrentHumanRequired',
  'exactTenantInvoiceBalanceAndAllocationRequired', 'receiptState', 'receiptReason',
  'accountingState', 'accountingReason', 'reportingState', 'reportingReason',
  'balanceFact', 'balanceState', 'checkClearanceState', 'contractValidationExecuted',
  'acceptedReceiptCreated', 'balanceMutationCreated', 'customerReceiptCreated',
  'accountingHandoffCreated', 'reportingRecordCreated',
  'providerOrBankSettlementClaimed',
]);
const PAID_SEPARATION_KEYS = Object.freeze([
  'contractExecutionIsFinancialTruth',
  'syntheticProviderEvidenceMayCreateProviderOrBankSettlement',
  'contractExecutionMayCreateInvoicePaymentRefundReceiptOrAccountingRecord',
  'productionValuesRemainServerOwned', 'unavailableMayBecomeZero',
  'providerSuccessMayImplySettlement', 'settlementMayImplyPayoutOrBankArrival',
  'checkReceivedMayImplyClearance',
  'accountingAcknowledgementMayImplySettlementOrClearance',
]);
const PAID_AUTHORITY_KEYS = Object.freeze([
  'exactTenantSessionRoleAndRecordScopeRequired', 'ownerOrAdministratorRoleRequired',
  'exactCurrentHandoffReceiptRequired', 'exactCurrentInvoiceAndFinancialSourceRequired',
  'currentHumanReviewAndIssueAuthorityRequired',
  'currentCustomerDeliveryAuthorityRequired',
  'idempotencyKeyAndExactRequestDigestRequiredForConsequentialActions',
  'oneConcurrentWriterPerAggregate', 'duplicateConsequentialEffectAllowed',
  'sourceCorrectionRequiresNewProjection', 'missingOrUnavailableMayBecomeZero',
  'customerPrivateOrProviderSecretReturned',
]);
const PAID_ACCEPTANCE_KEYS = Object.freeze([
  'exactPaidProductionContractsExecuted',
  'completeOrderedContractValidationTracePresent',
  'completeProductionJourneyAccepted', 'providerDisabledBoundaryPreserved',
  'partialAndMultiInvoicePathsCorrectlyExcluded',
  'offlineCashAndCheckBranchesIndependentlyValidated',
  'independentWholeHeadAuditAccepted', 'providerSandboxEvidenceAccepted',
  'livePaymentEvidenceAccepted', 'founderVisualApprovalAccepted',
]);
const PAID_CONTRACTS = Object.freeze([
  'm27-invoice-part5-acceptance-v1', 'm27-invoice-part6-acceptance-v1',
  'm27-payment-part7-acceptance-v1', 'm27-payment-part9-acceptance-v1',
  'm27-collection-part10-acceptance-v1', 'm27-accounting-part11-acceptance-v1',
  'm27-reporting-part12-acceptance-v1',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function invalid() {
  return new Error('Financial lifecycle recovery acceptance boundary invalid');
}

function assertPlainData(value) {
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

function exactOrdered(value, keys) {
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
  if (!exactOrdered(raw, CONTEXT_KEYS) || !exactOrdered(raw.source, SOURCE_KEYS) ||
      !UUID.test(raw.source.organizationId) || !UUID.test(raw.source.actorUserId) ||
      !UUID.test(raw.source.authSessionId) || raw.source.actorAccessRole !== 'owner' ||
      !UUID.test(raw.estimateId) || !UUID.test(raw.handoffReceiptId) ||
      !DIGEST.test(raw.handoffReceiptDigest)) throw invalid();
  return raw;
}

function validatePaid(raw, context) {
  assertPlainData(raw);
  const binding = raw?.journeyBinding;
  const bindingSource = binding && Object.fromEntries(PAID_BINDING_KEYS.slice(0, 15)
    .map(key => [key, binding[key]]));
  const witness = raw?.sourceWitnesses;
  const execution = raw?.execution;
  const offlineBranches = raw?.offlineBranches;
  if (!exactOrdered(raw, PAID_KEYS) ||
      !exactOrdered(binding, PAID_BINDING_KEYS) ||
      !DIGEST.test(binding.recordScopeDigest) ||
      !DIGEST.test(binding.requestAuthorizationDigest) ||
      !DIGEST.test(binding.estimateIdentityDigest) ||
      binding.handoffReceiptDigest !== context.handoffReceiptDigest ||
      !Number.isSafeInteger(binding.draftRevision) || binding.draftRevision < 1 ||
      !DIGEST.test(binding.draftDigest) || !DIGEST.test(binding.historyChainDigest) ||
      !DIGEST.test(binding.componentsDigest) || !DIGEST.test(binding.preparationDigest) ||
      !DIGEST.test(binding.previewDigest) || binding.currency !== 'USD' ||
      binding.preparedDocumentTotalState !== 'preparation_only' ||
      !DIGEST.test(binding.preparedDocumentTotalDigest) ||
      binding.amountDueState !== 'unavailable' || binding.amountDueValue !== null ||
      binding.journeyBindingDigest !== providerBoundary.digest(bindingSource) ||
      binding.rawTenantActorSessionEstimateOrReceiptIdentityReturned !== false ||
      !exactOrdered(raw.releasedPart13, RELEASED_PART13_KEYS) ||
      JSON.stringify(raw.releasedPart13) !== JSON.stringify(paidJourney.RELEASED_PART13) ||
      !Array.isArray(witness) || witness.length !== 2 ||
      witness.some(value => !exactOrdered(value, SOURCE_WITNESS_KEYS) ||
        typeof value.contractVersion !== 'string' || !DIGEST.test(value.digest)) ||
      witness[0].source !== 'part12_reporting_acceptance' ||
      witness[0].contractVersion !== 'm27-reporting-part12-acceptance-v1' ||
      witness[0].state !== 'incomplete' ||
      witness[0].reason !== 'part12_reporting_evidence_incomplete' ||
      witness[1].source !== 'part13_release_authority' ||
      witness[1].contractVersion !== 'm27-part13-release-v1' ||
      witness[1].state !== 'released' ||
      witness[1].reason !== 'founder_authorized_fallback_audit_accepted' ||
      witness[1].digest !== providerBoundary.digest(paidJourney.RELEASED_PART13) ||
      !exactOrdered(raw.launchMatrix, LAUNCH_KEYS) ||
      !exactOrdered(execution, EXECUTION_KEYS) ||
      !Array.isArray(execution.productionContractsExecuted) ||
      JSON.stringify(execution.productionContractsExecuted) !== JSON.stringify(PAID_CONTRACTS) ||
      !exactOrdered(execution.repositoryReadCounts, REPOSITORY_READ_KEYS) ||
      JSON.stringify(execution.repositoryReadCounts) !== JSON.stringify({
        part9: 4, part10: 2, part11: 1, part12Sources: 2, part12: 1,
      }) ||
      !Array.isArray(execution.stages) ||
      execution.stages.length !== paidJourney.STAGE_ORDER.length ||
      execution.stages.some((stage, index) => !exactOrdered(stage, STAGE_KEYS) ||
        stage.stage !== paidJourney.STAGE_ORDER[index] ||
        typeof stage.contractVersion !== 'string' || typeof stage.state !== 'string' ||
        !(stage.reason === null || typeof stage.reason === 'string') ||
        !DIGEST.test(stage.sourceDigest) ||
        stage.journeyBindingDigest !== binding.journeyBindingDigest ||
        stage.contractValidationExecuted !== true ||
        stage.productionEffectExecuted !== false || stage.durableEffectCreated !== false ||
        stage.externalEffectCreated !== false) ||
      !Array.isArray(offlineBranches) || offlineBranches.length !== 2 ||
      offlineBranches.some(branch => !exactOrdered(branch, OFFLINE_BRANCH_KEYS) ||
        !(branch.productionReason === null || typeof branch.productionReason === 'string') ||
        branch.value !== null || branch.journeyBindingDigest !== binding.journeyBindingDigest ||
        branch.reviewedCurrentHumanRequired !== true ||
        branch.exactTenantInvoiceBalanceAndAllocationRequired !== true ||
        typeof branch.receiptState !== 'string' ||
        !(branch.receiptReason === null || typeof branch.receiptReason === 'string') ||
        typeof branch.accountingState !== 'string' ||
        !(branch.accountingReason === null || typeof branch.accountingReason === 'string') ||
        typeof branch.reportingState !== 'string' ||
        !(branch.reportingReason === null || typeof branch.reportingReason === 'string') ||
        typeof branch.balanceFact !== 'string' || branch.balanceState !== branch.productionState ||
        branch.contractValidationExecuted !== true || branch.acceptedReceiptCreated !== false ||
        branch.balanceMutationCreated !== false || branch.customerReceiptCreated !== false ||
        branch.accountingHandoffCreated !== false || branch.reportingRecordCreated !== false ||
        branch.providerOrBankSettlementClaimed !== false) ||
      offlineBranches[0].method !== 'cash' ||
      offlineBranches[0].intendedAcceptedState !== 'offline_received' ||
      offlineBranches[0].balanceFact !== 'offline_cash_received_amount' ||
      offlineBranches[0].checkClearanceState !== 'not_applicable' ||
      offlineBranches[1].method !== 'check' ||
      offlineBranches[1].intendedAcceptedState !== 'check_clearance_unknown' ||
      offlineBranches[1].balanceFact !== 'check_clearance_unknown_amount' ||
      offlineBranches[1].checkClearanceState !== 'check_clearance_authority_unavailable' ||
      !exactOrdered(raw.separation, PAID_SEPARATION_KEYS) ||
      JSON.stringify(raw.separation) !== JSON.stringify({
        contractExecutionIsFinancialTruth: false,
        syntheticProviderEvidenceMayCreateProviderOrBankSettlement: false,
        contractExecutionMayCreateInvoicePaymentRefundReceiptOrAccountingRecord: false,
        productionValuesRemainServerOwned: true, unavailableMayBecomeZero: false,
        providerSuccessMayImplySettlement: false,
        settlementMayImplyPayoutOrBankArrival: false,
        checkReceivedMayImplyClearance: false,
        accountingAcknowledgementMayImplySettlementOrClearance: false,
      }) ||
      !exactOrdered(raw.authorityAndCurrentness, PAID_AUTHORITY_KEYS) ||
      JSON.stringify(raw.authorityAndCurrentness) !== JSON.stringify({
        exactTenantSessionRoleAndRecordScopeRequired: true,
        ownerOrAdministratorRoleRequired: true, exactCurrentHandoffReceiptRequired: true,
        exactCurrentInvoiceAndFinancialSourceRequired: true,
        currentHumanReviewAndIssueAuthorityRequired: true,
        currentCustomerDeliveryAuthorityRequired: true,
        idempotencyKeyAndExactRequestDigestRequiredForConsequentialActions: true,
        oneConcurrentWriterPerAggregate: true, duplicateConsequentialEffectAllowed: false,
        sourceCorrectionRequiresNewProjection: true, missingOrUnavailableMayBecomeZero: false,
        customerPrivateOrProviderSecretReturned: false,
      }) ||
      !exactOrdered(raw.acceptance, PAID_ACCEPTANCE_KEYS) ||
      JSON.stringify(raw.acceptance) !== JSON.stringify({
        exactPaidProductionContractsExecuted: true,
        completeOrderedContractValidationTracePresent: true,
        completeProductionJourneyAccepted: false, providerDisabledBoundaryPreserved: true,
        partialAndMultiInvoicePathsCorrectlyExcluded: true,
        offlineCashAndCheckBranchesIndependentlyValidated: true,
        independentWholeHeadAuditAccepted: false, providerSandboxEvidenceAccepted: false,
        livePaymentEvidenceAccepted: false, founderVisualApprovalAccepted: false,
      }) ||
      raw.contractVersion !== paidJourney.CONTRACT_VERSION ||
      raw.executionVersion !== paidJourney.EXECUTION_VERSION ||
      raw.policyVersion !== providerBoundary.POLICY_VERSION ||
      raw.policyDigest !== providerBoundary.POLICY_DIGEST ||
      raw.state !== paidJourney.STATE || raw.reason !== paidJourney.REASON ||
      raw.value !== null || raw.mode !== 'paid' || raw.fictional !== false ||
      raw.journeyBinding.handoffReceiptDigest !== context.handoffReceiptDigest ||
      raw.journeyBinding.currency !== 'USD' ||
      raw.journeyBinding.amountDueState !== 'unavailable' ||
      raw.journeyBinding.amountDueValue !== null ||
      raw.journeyBinding.rawTenantActorSessionEstimateOrReceiptIdentityReturned !== false ||
      raw.launchMatrix.rolloutStage !== 'disabled' ||
      raw.launchMatrix.liveCapabilityEnabled !== false ||
      raw.launchMatrix.providerMode !== 'test' ||
      raw.launchMatrix.providerMethod !== 'card' ||
      raw.launchMatrix.partialProviderPaymentsEnabled !== false ||
      raw.launchMatrix.multiInvoiceProviderPaymentsEnabled !== false ||
      raw.launchMatrix.offlineCashReceiptEnabled !== true ||
      raw.launchMatrix.offlineCheckReceiptEnabled !== true ||
      raw.launchMatrix.checkClearedTransitionEnabled !== false ||
      raw.launchMatrix.checkClearanceAuthority !==
        'unavailable_until_authenticated_bank_source' ||
      raw.launchMatrix.checkClearanceUnavailableState !==
        'check_clearance_authority_unavailable' ||
      raw.execution.deterministic !== true || raw.execution.inProcess !== true ||
      raw.execution.explicitSyntheticProviderDisabledProvenance !== true ||
      raw.execution.requiredStageCount !== paidJourney.STAGE_ORDER.length ||
      raw.execution.contractValidationStageCount !== paidJourney.STAGE_ORDER.length ||
      raw.execution.skippedStageCount !== 0 || raw.execution.duplicateStageCount !== 0 ||
      raw.execution.completeContractValidationTrace !== true ||
      raw.execution.completeProductionJourney !== false ||
      raw.execution.providerAccountUsed !== false || raw.execution.credentialUsed !== false ||
      raw.execution.externalTransportUsed !== false || raw.execution.liveMoneyUsed !== false ||
      !Array.isArray(raw.execution.stages) ||
      raw.execution.stages.length !== paidJourney.STAGE_ORDER.length ||
      !Array.isArray(raw.offlineBranches) || raw.offlineBranches.length !== 2 ||
      raw.offlineBranches[0].method !== 'cash' ||
      raw.offlineBranches[0].intendedAcceptedState !== 'offline_received' ||
      raw.offlineBranches[1].method !== 'check' ||
      raw.offlineBranches[1].intendedAcceptedState !== 'check_clearance_unknown' ||
      raw.offlineBranches[1].checkClearanceState !==
        'check_clearance_authority_unavailable' ||
      raw.offlineBranches.some(branch => branch.acceptedReceiptCreated !== false ||
        branch.balanceMutationCreated !== false || branch.customerReceiptCreated !== false ||
        branch.accountingHandoffCreated !== false || branch.reportingRecordCreated !== false ||
        branch.providerOrBankSettlementClaimed !== false) ||
      raw.separation.contractExecutionIsFinancialTruth !== false ||
      raw.separation.unavailableMayBecomeZero !== false ||
      raw.separation.checkReceivedMayImplyClearance !== false ||
      raw.authorityAndCurrentness.oneConcurrentWriterPerAggregate !== true ||
      raw.authorityAndCurrentness.duplicateConsequentialEffectAllowed !== false ||
      raw.authorityAndCurrentness.sourceCorrectionRequiresNewProjection !== true ||
      raw.authorityAndCurrentness.missingOrUnavailableMayBecomeZero !== false ||
      raw.acceptance.exactPaidProductionContractsExecuted !== true ||
      raw.acceptance.completeProductionJourneyAccepted !== false ||
      raw.acceptance.providerSandboxEvidenceAccepted !== false ||
      raw.acceptance.livePaymentEvidenceAccepted !== false ||
      raw.exactCurrentnessRevalidatedBeforeAndAfterProjection !== true ||
      raw.idempotencyReplayEffectCount !== 0 || raw.providerCallCount !== 0 ||
      raw.providerMutationCount !== 0 || raw.receiverMutationCount !== 0 ||
      raw.accountingMutationCount !== 0 || raw.downstreamMutationCount !== 0 ||
      raw.databaseMutationCount !== 0 || raw.liveMoneyMovementCount !== 0) throw invalid();
  return raw;
}

function scenario(name, source, state, reason, rule) {
  return freeze({ scenario: name, sourceContractVersion: source.contractVersion,
    sourceDigest: providerBoundary.digest(source), state, reason, rule,
    positiveEvidenceAccepted: false, effectAuthorized: false, effectExecuted: false });
}

function candidate(paidRaw, recoveryRaw, acceptanceRaw, contextRaw) {
  const context = validateContext(contextRaw);
  const paid = validatePaid(paidRaw, context);
  assertPlainData(recoveryRaw); assertPlainData(acceptanceRaw);
  const recovery = providerRecovery.project(recoveryRaw);
  const acceptance = providerAcceptance.project(acceptanceRaw, recovery);
  if (acceptance.sources[0].source !== 'part13c_provider_lifecycle_recovery' ||
      acceptance.sources[0].digest !== providerBoundary.digest(recovery)) throw invalid();

  const correction = postIssueCorrection.project(postIssueCorrection.unavailable());
  const credit = creditRefund.project(creditRefund.unavailable());
  const offline = offlinePayment.projectWithSource(offlinePayment.unavailable(credit), credit);
  const outcome = paymentOutcome.projectWithSource(paymentOutcome.unavailable(offline), offline);
  const retention = lifecycleRetention.project(lifecycleRetention.unavailable());
  const axis = name => outcome.axes.find(value => value.axis === name);
  const scenarios = [
    scenario(SCENARIO_ORDER[0], recovery, recovery.migrationAndRestart.state,
      recovery.migrationAndRestart.reason, 'exact_migration_272_no_273_only'),
    scenario(SCENARIO_ORDER[1], recovery, recovery.migrationAndRestart.state,
      recovery.migrationAndRestart.reason, 'restart_rereads_exact_current_sources'),
    scenario(SCENARIO_ORDER[2], paid, paid.state, paid.reason,
      'same_key_same_request_is_effect_free_and_changed_reuse_conflicts'),
    scenario(SCENARIO_ORDER[3], outcome, axis('paymentFailure').state,
      axis('paymentFailure').reason, 'arrival_order_never_authorizes_financial_truth'),
    scenario(SCENARIO_ORDER[4], recovery, recovery.uncertainResultRecovery.state,
      recovery.uncertainResultRecovery.reason,
      'lookup_exact_original_request_and_receipt_before_any_retry'),
    scenario(SCENARIO_ORDER[5], correction, correction.state, correction.reason,
      'source_correction_is_append_only_and_requires_current_projection'),
    scenario(SCENARIO_ORDER[6], outcome, axis('reopenedBalance').state,
      axis('reopenedBalance').reason, 'reopening_requires_exact_accepted_outcome_and_allocation'),
    scenario(SCENARIO_ORDER[7], outcome, axis('disputeOutcome').state,
      axis('disputeOutcome').reason, 'dispute_never_erases_original_payment_or_auto_refunds'),
    scenario(SCENARIO_ORDER[8], credit, credit.state, credit.reason,
      'refund_request_is_not_completion_or_settlement'),
    scenario(SCENARIO_ORDER[9], retention, retention.retention.state,
      retention.retention.reason, 'retention_requires_review_and_current_holds'),
    scenario(SCENARIO_ORDER[10], retention, retention.deletionRequest.state,
      retention.deletionRequest.reason, 'delete_requires_exact_scope_dual_control_and_holds'),
    scenario(SCENARIO_ORDER[11], acceptance, acceptance.disasterRecovery.state,
      acceptance.disasterRecovery.reason, 'restore_requires_independent_source_integrity_proof'),
    scenario(SCENARIO_ORDER[12], offline, offline.state, offline.reason,
      'receipt_requires_idempotency_and_duplicate_disposition'),
    scenario(SCENARIO_ORDER[13], offline, offline.offlineReversalSemantics.currentProjectionState,
      'accepted_offline_receipt_unavailable', 'correction_is_append_only_replacement_or_reversal'),
    scenario(SCENARIO_ORDER[14], outcome, axis('offlineReversal').state,
      axis('offlineReversal').reason, 'offline_reversal_never_edits_original_receipt'),
    scenario(SCENARIO_ORDER[15], offline,
      offline.clearedCheckSemantics.currentProjectionState,
      'check_clearance_authority_unavailable',
      'check_received_remains_clearance_unknown_without_authenticated_bank_authority'),
    scenario(SCENARIO_ORDER[16], outcome, axis('returnedOfflinePayment').state,
      axis('returnedOfflinePayment').reason,
      'authorized_return_reopens_only_exact_pending_allocation_and_nsf_fee_is_unsupported'),
    scenario(SCENARIO_ORDER[17], paid, paid.state, paid.reason,
      'every_correction_requires_new_receivable_accounting_and_reporting_projection'),
  ];
  if (scenarios.length !== SCENARIO_ORDER.length ||
      scenarios.some((value, index) => value.scenario !== SCENARIO_ORDER[index])) throw invalid();

  const binding = freeze({
    paidJourneyDigest: providerBoundary.digest(paid),
    providerRecoveryDigest: providerBoundary.digest(recovery),
    providerAcceptanceDigest: providerBoundary.digest(acceptance),
    requestAuthorizationDigest: providerBoundary.digest(context.source),
    estimateScopeDigest: providerBoundary.digest({ organizationId: context.source.organizationId,
      estimateId: context.estimateId, handoffReceiptId: context.handoffReceiptId,
      handoffReceiptDigest: context.handoffReceiptDigest }),
  });
  return freeze({
    contractVersion: CONTRACT_VERSION, policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST, state: STATE, reason: REASON,
    value: null, mode: 'paid', fictional: false,
    journeyBinding: freeze({ ...binding,
      journeyBindingDigest: providerBoundary.digest(binding),
      rawTenantActorSessionEstimateReceiptOrProviderIdentityReturned: false }),
    sourceWitnesses: freeze([
      freeze({ source: 'part14a_paid_provider_disabled_journey',
        contractVersion: paid.contractVersion, digest: providerBoundary.digest(paid) }),
      freeze({ source: 'part13c_provider_lifecycle_recovery',
        contractVersion: recovery.contractVersion, digest: providerBoundary.digest(recovery) }),
      freeze({ source: 'part13d_provider_lifecycle_acceptance',
        contractVersion: acceptance.contractVersion, digest: providerBoundary.digest(acceptance) }),
    ]),
    scenarioOrder: SCENARIO_ORDER, scenarios: freeze(scenarios),
    offline: freeze({
      launchEnabled: offline.intakePolicy.launchEnabled,
      states: offline.stateVocabulary,
      duplicateSafeReceiptRequired: offline.receiptContract.duplicateDetectionRequired,
      exactRequestDigestRequired: offline.receiptContract.idempotencyKeyAndExactRequestDigestRequired,
      correctionShape: offline.receiptContract.correctionShape,
      cashAcceptedState: offline.cashSemantics.acceptedState,
      checkReceivedState: offline.checkSemantics.acceptedState,
      checkClearanceState: offline.clearedCheckSemantics.currentProjectionState,
      checkReturnedState: offline.returnedCheckSemantics.acceptedState,
      offlineReversalState: offline.offlineReversalSemantics.acceptedState,
      returnedCheckAuthorityState: offline.returnedCheckSemantics.missingAuthorityState,
      nsfFeeState: outcome.offlineOutcomePolicy.nsfFeeState,
      bankClearanceClaimed: false, providerSettlementClaimed: false,
      receiptRecorded: false, correctionRecorded: false, reversalRecorded: false,
      returnRecorded: false, balanceMutationCount: 0,
    }),
    recovery: freeze({
      migrationLatest: recovery.migrationAndRestart.requiredMigrationSequence,
      migration273Expected: recovery.migrationAndRestart.laterMigrationExpected,
      previousVersionFallbackAllowed: recovery.migrationAndRestart.previousVersionFallbackAllowed,
      concurrentWriterPerAggregate: recovery.concurrency.concurrentWriterPerAggregate,
      exactRequestDigestRequired: recovery.concurrency.exactRequestDigestRequired,
      serializeDuplicateRequests: recovery.concurrency.serializeDuplicateRequests,
      changedReuseConflicts: recovery.concurrency.changedReuseConflicts,
      receiptLookupBeforeRetryRequired:
        recovery.uncertainResultRecovery.receiptLookupBeforeRetryRequired,
      recoveryMayExceedOriginalRequest:
        recovery.uncertainResultRecovery.effectMayExceedOriginalRequest,
      olderSourceFallbackAllowed: false, delayedEvidenceBecomesFailure: false,
      destructiveCleanupAuthorized: retention.holds.destructiveCleanupAuthorized,
      restoreTestAccepted: acceptance.disasterRecovery.restoreTestAccepted,
      productionRestoreAuthorized: acceptance.disasterRecovery.productionRestoreAuthorized,
    }),
    separation: freeze({
      upstreamFactIsNotAutomationDecision: true,
      automationDecisionIsNotExternalEffect: true,
      providerMessageIsNotFinancialTruth: true,
      effectEvidenceIsNotAuthorityToRepeatEffect: true,
      unavailableMayBecomeZero: false, outOfOrderArrivalMayAuthorizeEffect: false,
      checkReceivedMayBecomeClearance: false, accountingMaySupplyClearance: false,
      deletionMayIgnoreHolds: false, restoreMayRepeatExternalEffect: false,
    }),
    acceptance: freeze({
      allRequiredScenariosProjected: true,
      exactReleasedProductionContractsRevalidated: true,
      completePositiveRecoveryJourneyAccepted: false,
      independentWholeHeadAuditAccepted: false,
      providerSandboxEvidenceAccepted: false, productionRestoreEvidenceAccepted: false,
      livePaymentEvidenceAccepted: false, founderVisualApprovalAccepted: false,
    }),
    exactCurrentnessRevalidatedBeforeAndAfterProjection: true,
    migrationMutationCount: 0, providerCallCount: 0, providerMutationCount: 0,
    receiverMutationCount: 0, accountingMutationCount: 0, downstreamMutationCount: 0,
    databaseMutationCount: 0, liveMoneyMovementCount: 0,
  });
}

function project(raw, paidRaw, recoveryRaw, acceptanceRaw, contextRaw) {
  assertPlainData(raw);
  const expected = candidate(paidRaw, recoveryRaw, acceptanceRaw, contextRaw);
  if (JSON.stringify(raw) !== JSON.stringify(expected)) throw invalid();
  return expected;
}

module.exports = { CONTRACT_VERSION, STATE, REASON, SCENARIO_ORDER, candidate, project };
