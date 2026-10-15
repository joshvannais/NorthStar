'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const receivableAging = require('./receivableAging');

const CONTRACT_VERSION = 'm27-collection-review-v1';
const REASON = 'receivable_population_incomplete';
const CAPABILITY = 'customer_financial.collection.action';
const FILTER_ORDER = Object.freeze([
  'agingBucket', 'holdState', 'contactabilityState', 'promiseToPayState',
  'selectedNextStep',
]);
const NEXT_STEP_ORDER = Object.freeze([
  'continue_internal_review',
  'record_internal_note',
  'record_promise_to_pay',
  'close_internal_review_no_action',
  'request_mission28_reviewed_handoff',
  'request_manual_payment_link_resend',
]);
const NOTE_FIELDS = Object.freeze([
  'noteIdentity', 'issuedInvoiceIdentity', 'issuedInvoiceVersionDigest',
  'receivableProjectionDigest', 'body', 'reason', 'actorUserIdentity',
  'recordedAt', 'revision', 'digest',
]);
const PROMISE_FIELDS = Object.freeze([
  'promiseIdentity', 'issuedInvoiceIdentity', 'issuedInvoiceVersionDigest',
  'receivableProjectionDigest', 'customerIdentity', 'currency',
  'outstandingMinorUnitsAtReview', 'promisedMinorUnits', 'promisedByDate',
  'tenantBusinessTimezone', 'commitmentEvidenceClass',
  'commitmentEvidenceDigest', 'reason', 'actorUserIdentity', 'recordedAt',
  'idempotencyKey', 'revision', 'digest',
]);

function exact(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function policy() {
  const launch = receivableAging.policy();
  const team = launch.team;
  const control = launch.actionControl?.[CAPABILITY];
  const boundary = launch.mission28Boundary;
  const execution = boundary?.collectionsExecution;
  if (team.roleAloneAuthorizes !== false ||
      !team.ownerDefaultCapabilities.includes(CAPABILITY) ||
      !team.adminDefaultCapabilities.includes(CAPABILITY) ||
      team.memberDefaultCapabilities.includes(CAPABILITY) ||
      team.memberGrantableCapabilities.includes(CAPABILITY) ||
      team.recentAuthSeconds !== 600 || team.mfaFreshnessSeconds !== 600 ||
      team.independentApprovalSeconds !== 600 ||
      control?.mode !== 'conditional_dual_control' ||
      control.maximumMinorUnits !== '10000000' ||
      control.internalReviewPath?.supported !== true ||
      !exact(control.internalReviewPath.singleControlAllowedWhen, [
        'collectible_balance_minor_units_lte_1000000',
        'current_due_dispute_and_pending_tender_axes',
        'no_fee_charge_or_external_execution',
      ]) || !exact(control.dualControlRequiredWhen, [
        'collectible_balance_minor_units_gt_1000000_and_lte_10000000',
      ]) || !exact(control.denyWhen, [
        'amount_or_bound_missing', 'selected_path_missing',
        'any_required_selected_path_balance_due_dispute_pending_tender_recipient_adapter_or_currentness_condition_missing',
      ]) || control.externalExecutionAuthority !== 'mission28_only' ||
      launch.amountPolicy.singleControlMaximums
        .collection_review_or_mission28_handoff !== '1000000' ||
      launch.amountPolicy.aboveSingleControlRequiresTwoDifferentCurrentHumans !== true ||
      boundary.adapter !== 'mission28.collections_reviewed_handoff.v1' ||
      boundary.currentReceivingAdapterAvailable !== false ||
      execution?.internalAgingReviewSupported !== true ||
      execution.promiseToPayRecordSupported !== true ||
      execution.externalCommunicationSupported !== false ||
      execution.externalAgencyOrLegalExecutionSupported !== false ||
      execution.automaticChargeSupported !== false ||
      !exact(execution.unsupportedStates, [
        'collection_execution_unsupported', 'collection_communication_unsupported',
        'automatic_collection_unsupported',
      ]) || boundary.reminders?.mission27DirectExecutionSupported !== false ||
      boundary.reminders.automaticExecutionSupported !== false ||
      boundary.reminders.reviewedHandoffSupported !== true ||
      boundary.reminders.unavailableState !== 'mission28_handoff_unavailable' ||
      boundary.paymentRetry?.automaticRetrySupported !== false ||
      boundary.paymentRetry.reusePriorProviderSessionSupported !== false ||
      boundary.paymentRetry.savedInstrumentChargeSupported !== false ||
      boundary.fees?.lateFeeSupported !== false ||
      boundary.fees.nsfFeeSupported !== false ||
      boundary.fees.collectionFeeSupported !== false ||
      boundary.escalation?.automaticEscalationSupported !== false ||
      boundary.escalation.serviceSuspensionSupported !== false ||
      boundary.escalation.accountSuspensionSupported !== false ||
      boundary.escalation.creditReportingSupported !== false ||
      boundary.escalation.legalThreatOrReferralSupported !== false ||
      launch.performance.maximumPageSize !== 100) {
    throw new Error('Collection-review policy is unavailable');
  }
  return launch;
}

function unavailable(sourceRaw = receivableAging.unavailable()) {
  const source = receivableAging.project(sourceRaw);
  const launch = policy();
  const control = launch.actionControl[CAPABILITY];
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceWitness: Object.freeze({
      receivableAgingVersion: source.contractVersion,
      receivableAgingDigest: providerBoundary.digest(source),
      populationState: source.coverage.populationSourceState,
      populationReason: source.coverage.populationSourceReason,
      populationComplete: source.coverage.complete,
    }),
    access: Object.freeze({
      tenantPrivate: true,
      eligibleAccessRoles: Object.freeze(['owner', 'admin']),
      currentTenantSessionRequired: true,
      currentSubscriptionRequired: true,
      requiredCapability: CAPABILITY,
      roleAloneAuthorizes: false,
      requiredAssurance: 'recent_auth_mfa',
      maximumRecentAuthenticationSeconds: launch.team.recentAuthSeconds,
      maximumMfaFreshnessSeconds: launch.team.mfaFreshnessSeconds,
      maximumIndependentApprovalSeconds: launch.team.independentApprovalSeconds,
      currentCapabilityState: 'unavailable',
      recentAuthenticationState: 'unavailable',
      mfaState: 'unavailable',
      independentApprovalState: 'unavailable',
    }),
    queuePolicy: Object.freeze({
      source: 'complete_current_receivable_population',
      sourceState: 'unavailable',
      sourceReason: REASON,
      maximumPageSize: launch.performance.maximumPageSize,
      exactCurrentRowsOnly: true,
      incompletePopulationMayBePresentedAsEmptyOrComplete: false,
      missingBalanceDueHoldOrContactabilityMayBecomeZeroOrCurrent: false,
      stableOrder: 'oldest_due_date_then_issued_invoice_identity',
      filterOrder: FILTER_ORDER,
      filterDefinitions: Object.freeze({
        agingBucket: Object.freeze(['all', ...receivableAging.AGING_BUCKETS.map(x => x.bucket)]),
        holdState: Object.freeze(['all', 'none', 'dispute', 'refund', 'any_hold', 'unavailable']),
        contactabilityState: Object.freeze([
          'all', 'contactable', 'not_contactable', 'unknown', 'unavailable',
        ]),
        promiseToPayState: Object.freeze([
          'all', 'none', 'recorded', 'due', 'kept', 'missed', 'unavailable',
        ]),
        selectedNextStep: Object.freeze(['all', 'not_selected', ...NEXT_STEP_ORDER]),
      }),
      activeFilters: null,
      totalQueueRows: null,
      projectedQueueRows: 0,
    }),
    drilldownPolicy: Object.freeze({
      exactCurrentReceivableRequired: true,
      requiredReceivableFields: receivableAging.RECEIVABLE_FIELDS,
      requiredReviewFields: Object.freeze([
        'collectionReviewState', 'selectedNextStep', 'latestInternalNote',
        'latestPromiseToPay', 'reviewRevision', 'reviewDigest',
      ]),
      exactIssuedInvoiceVersionAndReceivableProjectionRequired: true,
      exactBalanceDueDisputeRefundPendingTenderAndContactabilityRequired: true,
      heldOrUnknownReceivableMayNotAuthorizeAnAction: true,
      missingDrilldownMayNotReuseAnOlderRevision: true,
    }),
    notePolicy: Object.freeze({
      supported: true,
      appendOnly: true,
      requiredFields: NOTE_FIELDS,
      minimumBodyCharacters: 1,
      maximumBodyCharacters: 2000,
      boundedReasonRequired: true,
      exactCurrentReceivableWitnessRequired: true,
      noteMayAuthorizeCustomerContactFeeChargeOrBalanceChange: false,
      noteMayContainProviderCredentialOrPaymentInstrument: false,
    }),
    promiseToPayPolicy: Object.freeze({
      supported: true,
      appendOnly: true,
      requiredFields: PROMISE_FIELDS,
      exactCustomerCommitmentEvidenceRequired: true,
      exactCurrentIssuedInvoiceBalanceAndCurrencyRequired: true,
      promisedAmountMustBePositiveAndNoGreaterThanOutstandingBalance: true,
      promisedDateAndTenantBusinessTimezoneRequired: true,
      boundedReasonAndIdempotencyRequired: true,
      promiseIsPaymentAuthorization: false,
      promiseIsPaymentSettlement: false,
      promiseAuthorizesAutomaticReminderRetryChargeOrFee: false,
      missedPromiseAuthorizesEscalationSuspensionCreditReportingOrLegalReferral: false,
    }),
    nextStepPolicy: Object.freeze({
      orderedValues: NEXT_STEP_ORDER,
      exactlyOneExplicitSelectionRequired: true,
      noDefaultOrInferredSelection: true,
      currentReceivableReviewWitnessRequired: true,
      internalReviewPathSupported: control.internalReviewPath.supported,
      controlMode: control.mode,
      singleControlMaximumMinorUnits:
        launch.amountPolicy.singleControlMaximums.collection_review_or_mission28_handoff,
      maximumMinorUnits: control.maximumMinorUnits,
      aboveSingleControlRequiresTwoDifferentCurrentHumans:
        launch.amountPolicy.aboveSingleControlRequiresTwoDifferentCurrentHumans,
      selectedMission28OrResendStepIsExecutionAuthority: false,
      mission28ReceivingAdapterAvailable: launch.mission28Boundary.currentReceivingAdapterAvailable,
      externalExecutionAuthority: control.externalExecutionAuthority,
    }),
    unsupportedExecution: Object.freeze({
      mission27DirectCollectionCommunication: 'collection_communication_unsupported',
      automaticReminder: 'automatic_reminder_unsupported',
      automaticPaymentRetry: 'automatic_payment_retry_unsupported',
      savedInstrumentCharge: 'saved_instrument_charge_unsupported',
      lateFee: 'late_fee_unsupported',
      nsfFee: 'nsf_fee_unsupported',
      collectionFee: 'collection_fee_unsupported',
      automaticEscalation: 'collection_escalation_unsupported',
      serviceSuspension: 'service_suspension_unsupported',
      accountSuspension: 'account_suspension_unsupported',
      creditReporting: 'credit_reporting_unsupported',
      legalReferral: 'legal_collection_referral_unsupported',
      externalExecution: 'collection_execution_unsupported',
      mission28Handoff: 'mission28_handoff_unavailable',
    }),
    requirements: Object.freeze([
      Object.freeze({ requirement: 'complete_current_receivable_population',
        state: 'unavailable', reason: 'issued_receivable_population_unavailable', value: null }),
      Object.freeze({ requirement: 'exact_current_receivable_drilldown',
        state: 'unavailable', reason: 'receivable_projection_currentness_unavailable', value: null }),
      Object.freeze({ requirement: 'current_collection_action_capability',
        state: 'unavailable', reason: 'capability_required', value: null }),
      Object.freeze({ requirement: 'server_owned_recent_authentication_fact',
        state: 'unavailable', reason: 'recent_auth_required', value: null }),
      Object.freeze({ requirement: 'accepted_mfa_ceremony',
        state: 'unavailable', reason: 'mfa_required', value: null }),
      Object.freeze({ requirement: 'exact_balance_due_dispute_refund_pending_tender_axes',
        state: 'unavailable', reason: 'issued_balance_unavailable', value: null }),
      Object.freeze({ requirement: 'exact_reviewed_contactability_evidence',
        state: 'unavailable', reason: 'customer_contactability_unavailable', value: null }),
      Object.freeze({ requirement: 'bounded_note_promise_or_next_step_reason',
        state: 'unavailable', reason: 'human_review_required', value: null }),
      Object.freeze({ requirement: 'different_current_human_approval_when_policy_requires',
        state: 'unavailable', reason: 'dual_control_unavailable', value: null }),
    ]),
    projection: Object.freeze({
      queueRows: Object.freeze([]),
      queueAsOf: null,
      queueRevision: null,
      queueDigest: null,
      selectedReceivable: null,
      activeFilters: null,
      internalNotes: Object.freeze([]),
      promisesToPay: Object.freeze([]),
      selectedNextStep: null,
      reviewRevision: null,
      reviewDigest: null,
    }),
    authority: Object.freeze({
      queueReviewAvailable: false,
      drilldownAvailable: false,
      internalNoteRecordAuthorized: false,
      promiseToPayRecordAuthorized: false,
      nextStepSelectionAuthorized: false,
      mission28HandoffAuthorized: false,
      manualPaymentLinkResendAuthorized: false,
      customerCommunicationAuthorized: false,
      feeAuthorized: false,
      automaticRetryOrChargeAuthorized: false,
      escalationSuspensionCreditOrLegalActionAuthorized: false,
      balanceOrPaymentMutationAuthorized: false,
    }),
    privacy: Object.freeze({
      tenantIdentityExposed: false,
      customerIdentityExposed: false,
      recipientOrContactDetailExposed: false,
      invoiceIdentityExposed: false,
      amountOrDueDateExposed: false,
      disputeRefundOrPendingTenderDetailExposed: false,
      noteOrPromiseContentExposed: false,
      actorIdentityExposed: false,
    }),
    requestContextCurrentnessRevalidated: true,
    receivableProjectionCurrentnessRevalidated: false,
    collectionReviewRowCount: 0,
    collectionNoteRowCount: 0,
    promiseToPayRowCount: 0,
    nextStepSelectionRowCount: 0,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    accountingMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw) {
  const expected = unavailable();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Collection-review boundary invalid');
  }
  return expected;
}

function projectWithSource(raw, source) {
  const expected = unavailable(source);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Collection-review boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, CAPABILITY, FILTER_ORDER, NEXT_STEP_ORDER,
  NOTE_FIELDS, PROMISE_FIELDS, policy, unavailable, project, projectWithSource };
