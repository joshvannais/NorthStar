'use strict';

const providerBoundary = require('./paymentProviderBoundary');

const CONTRACT_VERSION = 'm27-receivable-aging-v1';
const REASON = 'receivable_population_incomplete';
const INCOMPLETE_STATES = Object.freeze([
  'issued_receivable_population_unavailable',
  'issued_balance_unavailable',
  'issued_due_date_unavailable',
  'trusted_server_clock_unavailable',
  'dispute_refund_hold_unavailable',
  'customer_contactability_unavailable',
  'receivable_projection_currentness_unavailable',
]);
const AGING_BUCKETS = Object.freeze([
  Object.freeze({ bucket: 'not_due', minimumDaysPastDue: null, maximumDaysPastDue: -1 }),
  Object.freeze({ bucket: 'due_today', minimumDaysPastDue: 0, maximumDaysPastDue: 0 }),
  Object.freeze({ bucket: 'overdue_1_30', minimumDaysPastDue: 1, maximumDaysPastDue: 30 }),
  Object.freeze({ bucket: 'overdue_31_60', minimumDaysPastDue: 31, maximumDaysPastDue: 60 }),
  Object.freeze({ bucket: 'overdue_61_90', minimumDaysPastDue: 61, maximumDaysPastDue: 90 }),
  Object.freeze({ bucket: 'overdue_91_plus', minimumDaysPastDue: 91, maximumDaysPastDue: null }),
]);
const RECEIVABLE_FIELDS = Object.freeze([
  'issuedInvoiceIdentity', 'issuedInvoiceVersionDigest', 'customerIdentity',
  'currency', 'issuedMinorUnits', 'outstandingMinorUnits', 'issuedDueDate',
  'agingBucket', 'daysPastDue', 'disputeHold', 'refundHold', 'contactability',
  'projectionRevision', 'projectionDigest',
]);

function policy() {
  const launch = providerBoundary.validateLaunchPolicy();
  const collections = launch.mission28Boundary?.collectionsExecution;
  if (launch.financial?.supportedCurrency !== 'USD' ||
      launch.performance?.maximumPageSize !== 100 ||
      collections?.internalAgingReviewSupported !== true ||
      collections.promiseToPayRecordSupported !== true ||
      collections.externalCommunicationSupported !== false ||
      collections.externalAgencyOrLegalExecutionSupported !== false ||
      collections.automaticChargeSupported !== false ||
      JSON.stringify(collections.unsupportedStates) !== JSON.stringify([
        'collection_execution_unsupported', 'collection_communication_unsupported',
        'automatic_collection_unsupported',
      ])) {
    throw new Error('Receivable-aging policy is unavailable');
  }
  return launch;
}

function unavailable() {
  const launch = policy();
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'incomplete',
    reason: REASON,
    value: null,
    access: Object.freeze({
      tenantPrivate: true,
      eligibleAccessRoles: Object.freeze(['owner', 'admin']),
      currentTenantSessionRequired: true,
      currentSubscriptionRequired: true,
      crossTenantAccessAllowed: false,
      readOnlyProjection: true,
    }),
    coverage: Object.freeze({
      state: 'incomplete',
      complete: false,
      populationSource: 'immutable_current_issued_receivables',
      populationSourceState: 'unavailable',
      populationSourceReason: INCOMPLETE_STATES[0],
      incompleteStates: INCOMPLETE_STATES,
      completenessProven: false,
      partialPopulationMayBePresentedAsComplete: false,
      missingReceivablesMayBeZero: false,
      maximumPageSize: launch.performance.maximumPageSize,
      projectedRowCount: 0,
      totalReceivableCount: null,
      asOf: null,
    }),
    receivableContract: Object.freeze({
      requiredFields: RECEIVABLE_FIELDS,
      exactCurrentIssuedInvoiceRequired: true,
      exactCurrentIssuedBalanceRequired: true,
      exactCurrencyRequired: 'USD',
      exactIssuedDueDateRequired: true,
      trustedServerClockRequired: true,
      disputeAndRefundHoldsRemainSeparate: true,
      heldReceivableMayBeRemovedFromBalance: false,
      exactReviewedContactabilityEvidenceRequired: true,
      contactabilityStates: Object.freeze(['contactable', 'not_contactable', 'unknown']),
      contactabilityAuthorizesCommunication: false,
      correctionAndOutcomeCurrentnessRequired: true,
      missingAmountDateHoldOrContactabilityMayBecomeZeroOrCurrent: false,
    }),
    agingPolicy: Object.freeze({
      dateBasis: 'issued_due_date_in_tenant_business_timezone',
      clockBasis: 'trusted_server_clock',
      buckets: AGING_BUCKETS,
      issuedDueDateMayBeInferred: false,
      missingDueDateMayBecomeDueToday: false,
      missingBalanceMayEnterABucket: false,
      exactZeroBalanceIsNotAnOpenReceivable: true,
      dueOrOverdueAuthorizesReminderFeeCollectionOrCharge: false,
    }),
    holds: Object.freeze({
      disputeState: 'unavailable',
      disputeReason: 'dispute_refund_hold_unavailable',
      refundState: 'unavailable',
      refundReason: 'dispute_refund_hold_unavailable',
      pendingHoldBlocksCollectionReview: true,
      holdChangesIssuedOrOutstandingAmount: false,
      holdAuthorizesCustomerContact: false,
    }),
    contactability: Object.freeze({
      state: 'unavailable',
      reason: 'customer_contactability_unavailable',
      value: null,
      reviewedRecipientRequired: true,
      deliveryEvidenceMaySubstituteForRecipientReview: false,
      staffRoleMaySubstituteForCustomerConsent: false,
      customerIdentityOrRecipientExposed: false,
    }),
    projection: Object.freeze({
      receivables: Object.freeze([]),
      totalIssuedMinorUnits: null,
      totalOutstandingMinorUnits: null,
      heldOutstandingMinorUnits: null,
      currency: null,
      bucketCounts: null,
      bucketOutstandingMinorUnits: null,
      oldestIssuedDueDate: null,
      oldestDaysPastDue: null,
      projectionRevision: null,
      projectionDigest: null,
    }),
    authority: Object.freeze({
      receivablePopulationAvailable: false,
      agingReviewAvailable: false,
      collectionReviewAuthorized: false,
      promiseToPayAuthorized: false,
      reminderHandoffAuthorized: false,
      paymentLinkResendAuthorized: false,
      lateFeeAuthorized: false,
      serviceOrAccountSuspensionAuthorized: false,
      customerContactAuthorized: false,
      automaticRetryOrChargeAuthorized: false,
    }),
    privacy: Object.freeze({
      tenantIdentityExposed: false,
      customerIdentityExposed: false,
      recipientOrContactDetailExposed: false,
      invoiceIdentityExposed: false,
      amountOrDueDateExposed: false,
      disputeOrRefundDetailExposed: false,
      collectionNoteOrPromiseExposed: false,
    }),
    requestContextCurrentnessRevalidated: true,
    receivableProjectionCurrentnessRevalidated: false,
    projectedReceivableRowCount: 0,
    collectionReviewRowCount: 0,
    promiseToPayRowCount: 0,
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
    throw new Error('Receivable-aging boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, INCOMPLETE_STATES, AGING_BUCKETS,
  RECEIVABLE_FIELDS, policy, unavailable, project };
