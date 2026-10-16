'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const receivableAging = require('./receivableAging');
const invoiceLifecycle = require('./invoiceLifecycleProjection');

const CONTRACT_VERSION = 'm27-invoice-receivable-reporting-v1';
const REASON = 'invoice_receivable_reporting_coverage_incomplete';
const FACTS = Object.freeze([
  Object.freeze({ fact: 'issued_amount', valueType: 'minor_units',
    reason: 'issued_invoice_amount_unavailable' }),
  Object.freeze({ fact: 'outstanding_amount', valueType: 'minor_units',
    reason: 'outstanding_receivable_amount_unavailable' }),
  Object.freeze({ fact: 'aging', valueType: 'aging_bucket_summary',
    reason: 'receivable_aging_unavailable' }),
  Object.freeze({ fact: 'disputed_amount', valueType: 'minor_units',
    reason: 'disputed_receivable_amount_unavailable' }),
  Object.freeze({ fact: 'invoice_lifecycle_counts', valueType: 'orthogonal_axis_counts',
    reason: 'invoice_lifecycle_counts_unavailable' }),
]);

function coverage(source, sourceDigest) {
  return Object.freeze({
    state: 'incomplete',
    complete: false,
    reason: source.coverage.populationSourceReason,
    sourceContractVersion: source.contractVersion,
    sourceDigest,
    sourcePopulation: source.coverage.populationSource,
    sourcePopulationState: source.coverage.populationSourceState,
    sourceAsOf: source.coverage.asOf,
    totalSourceRecordCount: source.coverage.totalReceivableCount,
    emittedRecordCount: 0,
    completenessProven: false,
    partialPopulationMayBePresentedAsComplete: false,
    missingRecordsOrValuesMayBecomeZero: false,
    sourceProjectionCurrentnessRevalidated: false,
  });
}

function unavailable(sourceRaw = receivableAging.unavailable()) {
  const source = receivableAging.project(sourceRaw);
  const sourceDigest = providerBoundary.digest(source);
  const facts = FACTS.map(definition => Object.freeze({
    fact: definition.fact,
    state: 'unavailable',
    reason: definition.reason,
    valueType: definition.valueType,
    value: null,
    currency: null,
    coverage: coverage(source, sourceDigest),
  }));
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'incomplete',
    reason: REASON,
    value: null,
    sourceWitness: Object.freeze({
      contractVersion: source.contractVersion,
      state: source.state,
      reason: source.reason,
      digest: sourceDigest,
      requestContextCurrentnessRevalidated:
        source.requestContextCurrentnessRevalidated,
      receivableProjectionCurrentnessRevalidated:
        source.receivableProjectionCurrentnessRevalidated,
    }),
    factOrder: Object.freeze(FACTS.map(definition => definition.fact)),
    facts: Object.freeze(facts),
    amountContract: Object.freeze({
      supportedCurrency: 'USD',
      integerMinorUnitsRequired: true,
      oneMatchingCurrencyRequired: true,
      issuedOutstandingAndDisputedRemainSeparate: true,
      disputedAmountMayRewriteIssuedOrOutstandingAmount: false,
      missingAmountMayBecomeZero: false,
      partialCoverageAmountMayBePresentedAsComplete: false,
      browserArithmeticAllowed: false,
    }),
    agingContract: Object.freeze({
      exactBuckets: receivableAging.AGING_BUCKETS,
      issuedDueDateAndTrustedServerClockRequired: true,
      missingDueDateOrBalanceMayEnterBucket: false,
      overdueStateMayAuthorizeReminderFeeCollectionOrCharge: false,
      counts: null,
      outstandingMinorUnits: null,
    }),
    lifecycleCountContract: Object.freeze({
      exactOrthogonalAxes: invoiceLifecycle.AXIS_ORDER,
      completeIssuedInvoicePopulationRequired: true,
      everyAxisRetained: true,
      oneDisplayStatusMayReplaceOrthogonalAxes: false,
      missingCountMayBecomeZero: false,
      counts: null,
    }),
    coverageSummary: Object.freeze({
      state: 'incomplete',
      reason: source.coverage.populationSourceReason,
      requiredFactCount: FACTS.length,
      completeFactCount: 0,
      incompleteFactCount: FACTS.length,
      allFactsComplete: false,
      sourceAsOf: null,
      reportCurrency: null,
      reportMayBePresentedAsComplete: false,
      partialFactsMayBeSummedOrCompared: false,
      unknownOrMissingFactMayBecomeZero: false,
    }),
    access: Object.freeze({
      tenantPrivate: true,
      eligiblePaidRoles: Object.freeze(['owner','admin']),
      currentTenantSessionRequired: true,
      currentSubscriptionRequired: true,
      tenantCrossingAllowed: false,
      customerOrPublicAccessAllowed: false,
      demoRouteAvailable: false,
      readOnlyProjection: true,
    }),
    privacy: Object.freeze({
      tenantOrCustomerIdentityExposed: false,
      invoiceOrReceivableIdentityExposed: false,
      amountCurrencyDueDateOrDisputeDetailExposed: false,
      contactRecipientOrDeliveryDetailExposed: false,
      actorReviewerOrApproverIdentityExposed: false,
      providerAccountingOrCredentialDetailExposed: false,
    }),
    exactSourceRevalidatedBeforeAndAfterProjection: true,
    reportRowCount: 0,
    browserDerivedValueCount: 0,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    accountingMutationCount: 0,
    downstreamReaderMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw, sourceRaw) {
  const expected = unavailable(sourceRaw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Invoice and receivable reporting boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, FACTS, unavailable, project };
