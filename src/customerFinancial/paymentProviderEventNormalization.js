'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const providerEventReceipt = require('./paymentProviderEventReceipt');

const CONTRACT_VERSION = 'm27-provider-event-normalization-readiness-v1';
const REASON = 'provider_event_receipt_unavailable';
const EVIDENCE_STATES = Object.freeze([
  'created', 'authorized', 'processing', 'succeeded', 'failed', 'canceled',
  'settled', 'reversed', 'corrected',
]);

const SEMANTICS = Object.freeze({
  created: 'payment_attempt_created_evidence',
  authorized: 'payment_authorization_evidence',
  processing: 'payment_processing_evidence',
  succeeded: 'payment_success_evidence',
  failed: 'payment_failure_evidence',
  canceled: 'payment_cancellation_evidence',
  settled: 'provider_settlement_evidence',
  reversed: 'prior_payment_effect_reversal_evidence',
  corrected: 'prior_provider_evidence_correction',
});

function requirement(name, reason) {
  return Object.freeze({ requirement: name, state: 'unavailable', reason });
}

function stateRule(providerState) {
  return Object.freeze({
    providerState,
    semantic: SEMANTICS[providerState],
    policyState: 'supported_evidence_state',
    currentState: 'unavailable',
    normalized: false,
    maySupersedeByArrival: false,
    financialProjectionAuthorized: false,
  });
}

function unavailable(receiptRaw = providerEventReceipt.unavailable()) {
  const receipt = providerEventReceipt.project(receiptRaw);
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    providerEventReceiptVersion: receipt.contractVersion,
    providerEventReceiptDigest: providerBoundary.digest(receipt),
    state: 'unavailable',
    reason: REASON,
    value: null,
    requirements: Object.freeze([
      requirement('exact_authenticated_provider_event_receipt',
        'provider_event_receipt_unavailable'),
      requirement('current_provider_adapter_event_schema',
        'provider_adapter_runtime_unavailable'),
      requirement('unique_provider_event_and_object_identity',
        'provider_event_identity_unavailable'),
      requirement('exact_tenant_account_and_mode_binding',
        'provider_account_mode_unavailable'),
      requirement('provider_occurrence_time',
        'provider_event_occurrence_time_unavailable'),
      requirement('exact_supported_provider_semantic_state',
        'provider_event_state_unavailable'),
      requirement('duplicate_and_replay_disposition',
        'provider_event_uniqueness_unavailable'),
      requirement('provider_sequence_or_current_snapshot_for_ambiguity',
        'provider_reconciliation_unavailable'),
      requirement('exact_reversal_or_correction_lineage',
        'provider_event_lineage_unavailable'),
    ]),
    receipt: Object.freeze({
      authenticationState: receipt.receipt.authenticationState,
      signatureVerified: receipt.receipt.signatureVerified,
      rawPayloadAccepted: receipt.receipt.rawPayloadAccepted,
      providerEventIdentity: receipt.uniqueness.providerEventIdentity,
      providerEventIdentityState: receipt.uniqueness.providerEventIdentityState,
      providerObjectIdentity: null,
      providerObjectIdentityState: 'unavailable',
      providerAccountIdentity: receipt.binding.providerAccountIdentity,
      accountModeMatchVerified: receipt.binding.modeMatchVerified,
    }),
    stateContract: Object.freeze(EVIDENCE_STATES.map(stateRule)),
    ordering: Object.freeze({
      arrivalOrderTrusted: false,
      receivedAtMaySelectProjection: false,
      globalNumericStateRankSupported: false,
      terminalStateAssumedFromArrival: false,
      providerOccurrenceTimeRequired: true,
      providerSequenceOrCurrentSnapshotRequiredForAmbiguity: true,
      exactEventAndObjectIdentityRequired: true,
      duplicateOrReplayMayAdvanceProjection: false,
      olderEventMayRegressProjection: false,
      reversalRequiresExactPriorPaymentEffect: true,
      correctionRequiresExactPriorProviderEvidence: true,
      missingEvidenceMayBecomeZero: false,
    }),
    normalization: Object.freeze({
      inputAccepted: false,
      providerEventType: null,
      providerState: null,
      providerOccurredAt: null,
      providerSequence: null,
      currentProviderSnapshot: null,
      normalizedState: null,
      normalizedAt: null,
      normalizationRevision: null,
      normalizationDigest: null,
      conflictState: 'unavailable',
      completenessState: 'unavailable',
      normalizationAuthorized: false,
    }),
    authority: Object.freeze({
      providerEvidenceCanAuthorizeCharge: false,
      providerEvidenceCanApproveRefundOrWriteOff: false,
      paymentSuccessAuthorizesSettlement: false,
      settlementAuthorizesPayout: false,
      normalizedEvidenceAuthorizesInvoiceAllocation: false,
      normalizedEvidenceAuthorizesBalanceChange: false,
      normalizedEvidenceAuthorizesAccountingEntry: false,
    }),
    privacy: Object.freeze({
      rawPayloadExposed: false,
      providerEventIdentityExposed: false,
      providerObjectIdentityExposed: false,
      providerAccountIdentityExposed: false,
      providerCredentialExposed: false,
    }),
    downstream: Object.freeze({
      normalizationRecorded: false,
      invoiceAllocationAuthorized: false,
      paymentSuccessRecorded: false,
      captureRecorded: false,
      settlementRecorded: false,
      payoutRecorded: false,
      invoiceBalanceChanged: false,
      accountingAcknowledgementRecorded: false,
    }),
    tenantSessionCurrent: true,
    exactPolicyCurrent: true,
    providerReceiptCurrent: false,
    normalizationRowCount: 0,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function project(raw) {
  const expected = unavailable();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Provider-event normalization readiness boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, EVIDENCE_STATES, SEMANTICS,
  unavailable, project };
