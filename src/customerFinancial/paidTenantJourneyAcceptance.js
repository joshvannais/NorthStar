'use strict';

const { types: utilTypes } = require('node:util');
const providerBoundary = require('./paymentProviderBoundary');
const part12Contract = require('./reportingPart12Acceptance');

const CONTRACT_VERSION = 'm27-paid-provider-disabled-journey-v1';
const FIXTURE_VERSION = 'm27-local-synthetic-provider-fixture-v1';
const STATE = 'complete_provider_disabled';
const REASON = 'live_capability_disabled';
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

function invalid() {
  return new Error('Paid provider-disabled journey acceptance boundary invalid');
}

function assertPlainData(value) {
  // The strict comparison below ultimately serializes only validated data.
  // Fail before walking caller data if an inherited serializer could run.
  if (Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON') ||
      Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')) throw invalid();
  const active = new Set();
  const validated = new Set();
  let nodes = 0;
  function visit(current, depth) {
    nodes += 1;
    if (nodes > 32768 || depth > 48) throw invalid();
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!Number.isFinite(current) || Object.is(current, -0)) throw invalid();
      return;
    }
    if (typeof current !== 'object' || utilTypes.isProxy(current) || active.has(current)) {
      throw invalid();
    }
    if (validated.has(current)) return;
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
      active.delete(current);
      validated.add(current);
      return;
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw invalid();
      }
      visit(descriptor.value, depth + 1);
    }
    active.delete(current);
    validated.add(current);
  }
  visit(value, 0);
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freeze(value[key]);
  return Object.freeze(value);
}

function fixtureStage(stage, fixtureState, productionState, source) {
  return freeze({ stage, fixtureState, productionState, source,
    syntheticOnly: true, financialTruthAccepted: false,
    durableProductionEffectCreated: false, externalEffectCreated: false });
}

function localSyntheticFixture() {
  return freeze({
    fixtureVersion: FIXTURE_VERSION,
    deterministic: true,
    inProcess: true,
    paidTenantDataUsed: false,
    providerAccountUsed: false,
    credentialUsed: false,
    externalTransportUsed: false,
    liveMoneyUsed: false,
    currency: 'USD',
    exactInvoiceMinorUnits: '150000',
    exactRefundMinorUnits: '25000',
    exactPostRefundCollectedMinorUnits: '125000',
    stages: STAGE_ORDER.map((stage, index) => {
      const states = [
        ['current', 'current', 'm27-invoice-draft-preview-v1'],
        ['simulated_issued', 'unavailable', 'm27-invoice-part5-acceptance-v1'],
        ['simulated_delivered', 'unavailable', 'm27-invoice-part6-acceptance-v1'],
        ['simulated_succeeded', 'unavailable', 'm27-payment-part9-acceptance-v1'],
        ['simulated_settled', 'unavailable', 'm27-settlement-payout-reconciliation-readiness-v1'],
        ['simulated_receipt_issued', 'unavailable', 'm27-payment-part9-acceptance-v1'],
        ['simulated_refund_succeeded', 'unavailable', 'm27-payment-outcome-readiness-v1'],
        ['simulated_receivable_current', 'incomplete', 'm27-invoice-receivable-reporting-v1'],
        ['simulated_handoff_prepared', 'unavailable', 'm27-accounting-part11-acceptance-v1'],
        ['simulated_evidence_prepared', 'incomplete', 'm27-reporting-part12-acceptance-v1'],
        ['offline_received', 'unavailable', 'm27-offline-payment-intake-readiness-v1'],
        ['check_clearance_unknown', 'unavailable', 'm27-offline-payment-intake-readiness-v1'],
      ][index];
      return fixtureStage(stage, ...states);
    }),
    offline: freeze({
      reviewedCurrentHumanRequired: true,
      exactTenantInvoiceBalanceAndAllocationRequired: true,
      boundedEvidenceAndReasonRequired: true,
      immutableReceiptNumberAndAcceptanceTimeRequired: true,
      idempotencyKeyAndExactRequestDigestRequired: true,
      duplicateDetectionRequired: true,
      appendOnlyCorrectionOrReversalRequired: true,
      cashReceiptState: 'offline_received',
      cashEffect: 'reduce_collectible_balance_by_exact_allocation',
      cashCollectibleBalanceReductionMinorUnits: '100000',
      cashCustomerReceiptState: 'unavailable',
      cashAccountingHandoffState: 'unavailable',
      cashReportingState: 'incomplete',
      cashProviderSettlementClaimed: false,
      checkReceiptState: 'check_clearance_unknown',
      checkEffect: 'pending_tender_blocks_collection_only',
      checkPendingTenderMinorUnits: '100000',
      checkFaceOrSettledBalanceChanged: false,
      checkCollectionActionBlocked: true,
      checkCustomerReceiptCopy: 'check received — clearance unknown',
      checkCustomerReceiptState: 'unavailable',
      checkAccountingHandoffState: 'unavailable',
      checkReportingState: 'incomplete',
      checkClearedState: 'check_clearance_authority_unavailable',
      providerOrBankSettlementClaimed: false,
    }),
  });
}

function candidate(part12Raw) {
  assertPlainData(part12Raw);
  const part12 = part12Contract.projectBundle(part12Raw, 'paid');
  const launch = providerBoundary.validateLaunchPolicy();
  const fixture = localSyntheticFixture();
  if (launch.rollout.currentStage !== 'disabled' ||
      launch.financial.liveModeDefaultEnabled !== false ||
      launch.financial.partialProviderPayments !== false ||
      launch.financial.multiInvoiceProviderPayments !== false ||
      launch.financial.offline.cashReceiptEnabled !== true ||
      launch.financial.offline.checkReceiptEnabled !== true ||
      launch.financial.offline.checkClearedTransitionEnabled !== false ||
      launch.financial.offline.checkClearanceAuthority !==
        'unavailable_until_authenticated_bank_source') throw invalid();
  return freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: STATE,
    reason: REASON,
    value: null,
    mode: 'paid',
    fictional: false,
    sourceWitnesses: freeze([
      { source: 'part12_reporting_acceptance', contractVersion: part12Contract.CONTRACT_VERSION,
        state: part12.part12Acceptance.state, reason: part12.part12Acceptance.reason,
        digest: providerBoundary.digest(part12) },
      { source: 'part13_release_authority', contractVersion: 'm27-part13-release-v1',
        state: 'released', reason: 'founder_authorized_fallback_audit_accepted',
        digest: providerBoundary.digest(RELEASED_PART13) },
    ]),
    releasedPart13: RELEASED_PART13,
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
    fixture,
    separation: freeze({
      fixtureEvidenceIsFinancialTruth: false,
      fixtureEvidenceMayCreateProviderOrBankSettlement: false,
      fixtureEvidenceMayCreateInvoicePaymentRefundReceiptOrAccountingRecord: false,
      productionValuesRemainServerOwned: true,
      unavailableMayBecomeZero: false,
      providerSuccessMayImplySettlement: false,
      settlementMayImplyPayoutOrBankArrival: false,
      checkReceivedMayImplyClearance: false,
      accountingAcknowledgementMayImplySettlementOrClearance: false,
    }),
    authorityAndCurrentness: freeze({
      exactTenantSessionRoleAndRecordScopeRequired: true,
      ownerOrAdministratorRoleRequired: true,
      exactCurrentHandoffReceiptRequired: true,
      exactCurrentInvoiceAndFinancialSourceRequired: true,
      currentHumanReviewAndIssueAuthorityRequired: true,
      currentCustomerDeliveryAuthorityRequired: true,
      idempotencyKeyAndExactRequestDigestRequiredForConsequentialActions: true,
      oneConcurrentWriterPerAggregate: true,
      duplicateConsequentialEffectAllowed: false,
      sourceCorrectionRequiresNewProjection: true,
      missingOrUnavailableMayBecomeZero: false,
      customerPrivateOrProviderSecretReturned: false,
    }),
    acceptance: freeze({
      exactPaidProductionModulesMounted: true,
      completeOrderedLocalSyntheticTracePresent: true,
      providerDisabledBoundaryPreserved: true,
      partialAndMultiInvoicePathsCorrectlyExcluded: true,
      offlineCashAndCheckSemanticsCovered: true,
      independentWholeHeadAuditAccepted: false,
      providerSandboxEvidenceAccepted: false,
      livePaymentEvidenceAccepted: false,
      founderVisualApprovalAccepted: false,
    }),
    exactCurrentnessRevalidatedBeforeAndAfterProjection: true,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    accountingMutationCount: 0,
    downstreamMutationCount: 0,
    databaseMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw, part12Raw) {
  assertPlainData(raw); assertPlainData(part12Raw);
  const expected = candidate(part12Raw);
  if (JSON.stringify(raw) !== JSON.stringify(expected)) throw invalid();
  return expected;
}

module.exports = { CONTRACT_VERSION, FIXTURE_VERSION, STATE, REASON, STAGE_ORDER,
  RELEASED_PART13, localSyntheticFixture, candidate, project };
