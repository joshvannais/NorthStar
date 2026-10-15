'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const collectionReview = require('./collectionReview');

const CONTRACT_VERSION = 'm27-collection-handoff-readiness-v1';
const REASON = 'receivable_population_incomplete';
const COLLECTION_CAPABILITY = 'customer_financial.collection.action';
const INVOICE_SEND_CAPABILITY = 'customer_financial.invoice.send';
const PATH_ORDER = Object.freeze([
  'mission28_reviewed_reminder_handoff',
  'manual_payment_link_resend',
]);
const MISSION28_REQUIREMENTS = Object.freeze([
  'collectible_balance_minor_units_lte_1000000',
  'exact_current_invoice_version_and_recipient',
  'current_due_dispute_and_pending_tender_axes',
  'message_preview',
  'idempotency_and_cooldown',
  'current_receiving_adapter',
]);
const MANUAL_RESEND_REQUIREMENTS = Object.freeze([
  'explicit_next_step_request_manual_payment_link_resend',
  'founder_ratified_human_triggered_resend_policy',
  'exact_current_issued_invoice_version_and_document',
  'exact_current_customer_started_hosted_checkout_link',
  'one_reviewed_recipient_and_delivery_choice',
  'exact_message_preview',
  'current_collection_action_and_invoice_send_capabilities',
  'current_balance_due_dispute_refund_and_pending_tender_axes',
  'recent_authentication_mfa_and_required_control',
  'exact_idempotency_and_cooldown_state',
  'current_delivery_authority',
  'immutable_delivery_evidence_receipt',
]);
const MESSAGE_PREVIEW_FIELDS = Object.freeze([
  'previewVersion', 'issuedInvoiceIdentity', 'issuedInvoiceVersionDigest',
  'recipientEvidenceDigest', 'deliveryChoice', 'subject', 'body',
  'hostedCheckoutSessionDigest', 'createdAt', 'expiresAt', 'digest',
]);
const REQUEST_RECEIPT_FIELDS = Object.freeze([
  'requestIdentity', 'selectedPath', 'collectionReviewDigest',
  'issuedInvoiceIdentity', 'issuedInvoiceVersionDigest',
  'receivableProjectionDigest', 'collectibleBalanceMinorUnits', 'currency',
  'dueState', 'disputeState', 'refundState', 'pendingTenderState',
  'recipientEvidenceDigest', 'messagePreviewDigest', 'idempotencyKey',
  'requestDigest', 'cooldownPolicyVersion', 'cooldownEvaluatedAt',
  'requestedByUserIdentity', 'approvedByUserIdentity', 'requestedAt',
  'revision', 'digest',
]);
const DELIVERY_EVIDENCE_FIELDS = Object.freeze([
  'evidenceIdentity', 'requestIdentity', 'selectedPath', 'adapter',
  'receiverAcknowledgementIdentity', 'receiverAcknowledgementDigest',
  'deliveryState', 'occurredAt', 'revision', 'digest',
]);

function exact(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function policy() {
  const launch = collectionReview.policy();
  const collection = launch.actionControl?.[COLLECTION_CAPABILITY];
  const invoiceSend = launch.actionControl?.[INVOICE_SEND_CAPABILITY];
  const boundary = launch.mission28Boundary;
  const reminders = boundary?.reminders;
  const execution = boundary?.collectionsExecution;
  if (collection?.mode !== 'conditional_dual_control' ||
      collection.maximumMinorUnits !== '10000000' ||
      collection.mission28HandoffPath?.supported !== true ||
      collection.mission28HandoffPath.currentReceivingAdapterAvailable !== false ||
      !exact(collection.mission28HandoffPath.singleControlAllowedWhen,
        MISSION28_REQUIREMENTS) ||
      !exact(collection.dualControlRequiredWhen, [
        'collectible_balance_minor_units_gt_1000000_and_lte_10000000',
      ]) || !exact(collection.denyWhen, [
        'amount_or_bound_missing', 'selected_path_missing',
        'any_required_selected_path_balance_due_dispute_pending_tender_recipient_adapter_or_currentness_condition_missing',
      ]) || collection.externalExecutionAuthority !== 'mission28_only' ||
      invoiceSend?.mode !== 'conditional_dual_control' ||
      invoiceSend.maximumMinorUnits !== '10000000' ||
      !exact(invoiceSend.singleControlAllowedWhen, [
        'invoice_total_minor_units_lte_1000000', 'exact_current_issued_document',
        'one_reviewed_recipient', 'current_delivery_authority',
      ]) || !exact(invoiceSend.dualControlRequiredWhen, [
        'invoice_total_minor_units_gt_1000000_and_lte_10000000',
      ]) || !exact(invoiceSend.denyWhen, [
        'amount_or_bound_missing',
        'any_required_document_recipient_delivery_or_currentness_condition_missing',
      ]) || boundary.adapter !== 'mission28.collections_reviewed_handoff.v1' ||
      boundary.currentReceivingAdapterAvailable !== false ||
      reminders?.mission27DirectExecutionSupported !== false ||
      reminders.automaticExecutionSupported !== false ||
      reminders.reviewedHandoffSupported !== true ||
      reminders.unavailableState !== 'mission28_handoff_unavailable' ||
      !exact(reminders.unsupportedStates, [
        'automatic_reminder_unsupported', 'collection_communication_unsupported',
      ]) || execution?.externalCommunicationSupported !== false ||
      execution.externalAgencyOrLegalExecutionSupported !== false ||
      execution.automaticChargeSupported !== false ||
      boundary.paymentRetry?.automaticRetrySupported !== false ||
      boundary.paymentRetry.reusePriorProviderSessionSupported !== false ||
      boundary.paymentRetry.savedInstrumentChargeSupported !== false ||
      boundary.paymentRetry.customerMayExplicitlyStartNewExactCheckout !== true ||
      !exact(boundary.paymentRetry.unsupportedStates, [
        'automatic_payment_retry_unsupported', 'saved_instrument_charge_unsupported',
      ]) ||
      launch.amountPolicy.singleControlMaximums
        .collection_review_or_mission28_handoff !== '1000000' ||
      launch.amountPolicy.singleControlMaximums
        .proposal_signature_work_handoff_invoice_approval_issue_send !== '1000000' ||
      launch.amountPolicy.aboveSingleControlRequiresTwoDifferentCurrentHumans !== true ||
      launch.team.roleAloneAuthorizes !== false ||
      launch.team.recentAuthSeconds !== 600 || launch.team.mfaFreshnessSeconds !== 600 ||
      launch.team.independentApprovalSeconds !== 600 ||
      !launch.team.ownerDefaultCapabilities.includes(COLLECTION_CAPABILITY) ||
      !launch.team.ownerDefaultCapabilities.includes(INVOICE_SEND_CAPABILITY) ||
      !launch.team.adminDefaultCapabilities.includes(COLLECTION_CAPABILITY) ||
      !launch.team.adminDefaultCapabilities.includes(INVOICE_SEND_CAPABILITY) ||
      launch.team.memberDefaultCapabilities.includes(COLLECTION_CAPABILITY) ||
      launch.team.memberDefaultCapabilities.includes(INVOICE_SEND_CAPABILITY)) {
    throw new Error('Collection-handoff policy is unavailable');
  }
  return launch;
}

function missing(requirement, reason) {
  return Object.freeze({ requirement, state: 'unavailable', reason, value: null });
}

function unavailable(sourceRaw = collectionReview.unavailable()) {
  const source = collectionReview.project(sourceRaw);
  const launch = policy();
  const collection = launch.actionControl[COLLECTION_CAPABILITY];
  const invoiceSend = launch.actionControl[INVOICE_SEND_CAPABILITY];
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceWitness: Object.freeze({
      collectionReviewVersion: source.contractVersion,
      collectionReviewDigest: providerBoundary.digest(source),
      reviewState: source.state,
      reviewReason: source.reason,
      receivablePopulationComplete: source.sourceWitness.populationComplete,
      selectedNextStep: source.projection.selectedNextStep,
      reviewRevision: source.projection.reviewRevision,
      reviewDigest: source.projection.reviewDigest,
    }),
    access: Object.freeze({
      tenantPrivate: true,
      eligibleAccessRoles: Object.freeze(['owner', 'admin']),
      currentTenantSessionRequired: true,
      currentSubscriptionRequired: true,
      collectionCapability: COLLECTION_CAPABILITY,
      manualResendAdditionalCapability: INVOICE_SEND_CAPABILITY,
      roleAloneAuthorizes: false,
      requiredAssurance: 'recent_auth_mfa',
      maximumRecentAuthenticationSeconds: launch.team.recentAuthSeconds,
      maximumMfaFreshnessSeconds: launch.team.mfaFreshnessSeconds,
      maximumIndependentApprovalSeconds: launch.team.independentApprovalSeconds,
      currentCollectionCapabilityState: 'unavailable',
      currentInvoiceSendCapabilityState: 'unavailable',
      recentAuthenticationState: 'unavailable',
      mfaState: 'unavailable',
      independentApprovalState: 'unavailable',
    }),
    pathOrder: PATH_ORDER,
    controlPolicy: Object.freeze({
      mode: collection.mode,
      singleControlMaximumMinorUnits:
        launch.amountPolicy.singleControlMaximums.collection_review_or_mission28_handoff,
      maximumMinorUnits: collection.maximumMinorUnits,
      aboveSingleControlRequiresTwoDifferentCurrentHumans:
        launch.amountPolicy.aboveSingleControlRequiresTwoDifferentCurrentHumans,
      mission28SingleControlAllowedWhen: MISSION28_REQUIREMENTS,
      dualControlRequiredWhen: Object.freeze([...collection.dualControlRequiredWhen]),
      denyWhen: Object.freeze([...collection.denyWhen]),
      externalExecutionAuthority: collection.externalExecutionAuthority,
      manualResendControlMode: invoiceSend.mode,
      manualResendSingleControlMaximumMinorUnits:
        launch.amountPolicy.singleControlMaximums
          .proposal_signature_work_handoff_invoice_approval_issue_send,
      manualResendMaximumMinorUnits: invoiceSend.maximumMinorUnits,
      manualResendSingleControlAllowedWhen:
        Object.freeze([...invoiceSend.singleControlAllowedWhen]),
      manualResendDualControlRequiredWhen:
        Object.freeze([...invoiceSend.dualControlRequiredWhen]),
      manualResendDenyWhen: Object.freeze([...invoiceSend.denyWhen]),
    }),
    mission28ReminderHandoff: Object.freeze({
      selectedNextStepValue: 'request_mission28_reviewed_handoff',
      state: 'unavailable',
      reason: launch.mission28Boundary.reminders.unavailableState,
      value: null,
      adapter: launch.mission28Boundary.adapter,
      reviewedHandoffContractSupported: true,
      currentReceivingAdapterAvailable: false,
      mission27MayExecuteCommunication: false,
      automaticExecutionSupported: false,
      orderedRequirements: Object.freeze([
        missing('explicit_next_step_request_mission28_reviewed_handoff',
          'human_review_required'),
        missing('collectible_balance_minor_units_lte_1000000',
          'issued_balance_unavailable'),
        missing('exact_current_invoice_version_and_recipient',
          'issued_invoice_unavailable'),
        missing('current_due_dispute_and_pending_tender_axes',
          'receivable_projection_currentness_unavailable'),
        missing('exact_message_preview', 'human_review_required'),
        missing('exact_idempotency_and_cooldown',
          'source_currentness_unavailable'),
        missing('current_receiving_adapter', 'mission28_handoff_unavailable'),
        missing('recent_authentication_mfa_and_required_control',
          'recent_auth_required'),
      ]),
    }),
    manualPaymentLinkResend: Object.freeze({
      selectedNextStepValue: 'request_manual_payment_link_resend',
      state: 'unavailable',
      reason: 'issued_invoice_unavailable',
      value: null,
      humanTriggeredOnly: true,
      founderRatificationRequired: true,
      currentFounderRatificationState: 'unavailable',
      existingCustomerStartedExactCheckoutRequired: true,
      currentExactCustomerStartedLinkMayBeRedeliveredOnlyAfterAllGates: true,
      terminalExpiredOrSupersededProviderSessionMayBeReused: false,
      newCheckoutMayBeCreatedByStaff: false,
      customerMayExplicitlyStartNewExactCheckoutAfterTerminalAttempt: true,
      automaticRetryOrResendSupported: false,
      orderedRequirementNames: MANUAL_RESEND_REQUIREMENTS,
      orderedRequirements: Object.freeze([
        missing(MANUAL_RESEND_REQUIREMENTS[0], 'human_review_required'),
        missing(MANUAL_RESEND_REQUIREMENTS[1], 'human_review_required'),
        missing(MANUAL_RESEND_REQUIREMENTS[2], 'issued_invoice_unavailable'),
        missing(MANUAL_RESEND_REQUIREMENTS[3], 'payment_provider_unavailable'),
        missing(MANUAL_RESEND_REQUIREMENTS[4], 'recipient_review_required'),
        missing(MANUAL_RESEND_REQUIREMENTS[5], 'human_review_required'),
        missing(MANUAL_RESEND_REQUIREMENTS[6], 'capability_required'),
        missing(MANUAL_RESEND_REQUIREMENTS[7],
          'receivable_projection_currentness_unavailable'),
        missing(MANUAL_RESEND_REQUIREMENTS[8], 'recent_auth_required'),
        missing(MANUAL_RESEND_REQUIREMENTS[9], 'source_currentness_unavailable'),
        missing(MANUAL_RESEND_REQUIREMENTS[10], 'source_authority_unavailable'),
        missing(MANUAL_RESEND_REQUIREMENTS[11], 'source_authority_unavailable'),
      ]),
    }),
    messagePreviewPolicy: Object.freeze({
      exactServerValidatedPreviewRequired: true,
      requiredFields: MESSAGE_PREVIEW_FIELDS,
      exactCurrentInvoiceRecipientAndLinkSessionRequired: true,
      rawLinkTokenOrProviderSecretMayBeExposedOrRetained: false,
      previewMaySubstituteForDeliveryAuthority: false,
      currentPreview: null,
    }),
    idempotencyAndCooldownPolicy: Object.freeze({
      exactIdempotencyKeyBoundToRequestDigestRequired: true,
      exactPriorAttemptStateAndTrustedClockRequired: true,
      currentCooldownPolicyVersionRequired: true,
      missingOrUnknownCooldownDenies: true,
      changedInvoiceRecipientPreviewPathOrAmountRequiresNewRequest: true,
      exactReplayMayExceedOriginalRequest: false,
      cooldownMayBeBypassedByRoleOrRetry: false,
      currentIdempotencyKey: null,
      currentRequestDigest: null,
      currentCooldownPolicyVersion: null,
      currentCooldownEvaluatedAt: null,
      currentNextEligibleAt: null,
    }),
    receiptPolicy: Object.freeze({
      requestReceiptRequiredFields: REQUEST_RECEIPT_FIELDS,
      deliveryEvidenceRequiredFields: DELIVERY_EVIDENCE_FIELDS,
      appendOnly: true,
      exactRequestAndDeliveryEvidenceMustRemainSeparate: true,
      receiverAcceptanceIsDeliveryEvidence: false,
      queuedStateIsDeliveryEvidence: false,
      missingOrUnknownDeliveryEvidenceMayBePresentedAsDelivered: false,
      actionReceipt: null,
      deliveryEvidence: null,
    }),
    unsupportedExecution: Object.freeze({
      mission27DirectReminder: 'collection_communication_unsupported',
      automaticReminder: 'automatic_reminder_unsupported',
      automaticPaymentRetry: 'automatic_payment_retry_unsupported',
      savedInstrumentCharge: 'saved_instrument_charge_unsupported',
      externalCollectionExecution: 'collection_execution_unsupported',
      lateFee: 'late_fee_unsupported',
      nsfFee: 'nsf_fee_unsupported',
      collectionFee: 'collection_fee_unsupported',
      collectionEscalation: 'collection_escalation_unsupported',
    }),
    projection: Object.freeze({
      selectedPath: null,
      issuedInvoiceIdentity: null,
      issuedInvoiceVersionDigest: null,
      collectibleBalanceMinorUnits: null,
      currency: null,
      recipientEvidenceDigest: null,
      deliveryChoice: null,
      messagePreview: null,
      hostedCheckoutSessionDigest: null,
      requestIdentity: null,
      requestDigest: null,
      idempotencyKey: null,
      cooldownState: null,
      receivingAdapterState: null,
      deliveryState: null,
      actionReceipt: null,
      deliveryEvidence: null,
    }),
    authority: Object.freeze({
      collectionActionAuthorized: false,
      mission28ReminderHandoffAuthorized: false,
      mission27CustomerCommunicationAuthorized: false,
      manualPaymentLinkResendAuthorized: false,
      staffCheckoutCreationAuthorized: false,
      automaticReminderRetryOrChargeAuthorized: false,
      deliveryAuthorized: false,
      feeOrEscalationAuthorized: false,
      financialMutationAuthorized: false,
    }),
    privacy: Object.freeze({
      tenantIdentityExposed: false,
      customerIdentityExposed: false,
      invoiceIdentityExposed: false,
      amountOrDueStateExposed: false,
      recipientOrContactDetailExposed: false,
      messageContentExposed: false,
      hostedCheckoutUrlTokenOrSecretExposed: false,
      actorOrApproverIdentityExposed: false,
    }),
    requestContextCurrentnessRevalidated: true,
    collectionReviewCurrentnessRevalidated: false,
    handoffRequestRowCount: 0,
    manualResendRequestRowCount: 0,
    actionReceiptRowCount: 0,
    deliveryEvidenceRowCount: 0,
    outboundMessageCount: 0,
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
    throw new Error('Collection-handoff boundary invalid');
  }
  return expected;
}

function projectWithSource(raw, source) {
  const expected = unavailable(source);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Collection-handoff boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, COLLECTION_CAPABILITY,
  INVOICE_SEND_CAPABILITY, PATH_ORDER, MISSION28_REQUIREMENTS,
  MANUAL_RESEND_REQUIREMENTS, MESSAGE_PREVIEW_FIELDS, REQUEST_RECEIPT_FIELDS,
  DELIVERY_EVIDENCE_FIELDS, policy, unavailable, project, projectWithSource };
