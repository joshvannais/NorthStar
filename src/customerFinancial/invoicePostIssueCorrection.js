'use strict';

const CONTRACT_VERSION = 'm27-invoice-post-issue-correction-v1';
const REASON = 'issued_invoice_unavailable';
const RECORD_TYPES = Object.freeze(['credit', 'debit', 'replacement', 'void']);
const REQUIRED_LINEAGE = Object.freeze([
  'organization_id',
  'correction_record_id',
  'correction_record_digest',
  'correction_sequence',
  'record_type',
  'original_issue_receipt_id',
  'original_issue_receipt_digest',
  'original_issued_version_digest',
  'previous_correction_record_id',
  'source_authority_digest',
  'requested_by_actor_id',
  'authorization_receipt_ids',
  'authorization_policy_version',
  'reason',
  'recorded_at',
]);

const RECORD_POLICY = Object.freeze({
  credit: Object.freeze({
    requiredCapability: 'customer_financial.invoice.correct',
    requiredControl: 'conditional_dual_control',
    missingEvidence: Object.freeze([
      'immutable_issue_receipt',
      'exact_current_issued_document',
      'exact_current_remaining_balance',
      'current_mission24_authority_for_commercial_change',
      'exact_correction_amount_and_bound',
      'correction_reason',
      'complete_correction_lineage',
    ]),
  }),
  debit: Object.freeze({
    requiredCapability: 'customer_financial.invoice.correct',
    requiredControl: 'conditional_dual_control',
    missingEvidence: Object.freeze([
      'immutable_issue_receipt',
      'exact_current_issued_document',
      'exact_current_remaining_balance',
      'current_mission24_authority_for_commercial_change',
      'exact_correction_amount_and_bound',
      'correction_reason',
      'complete_correction_lineage',
    ]),
  }),
  replacement: Object.freeze({
    requiredCapability: 'customer_financial.invoice.correct',
    requiredControl: 'conditional_dual_control',
    missingEvidence: Object.freeze([
      'immutable_issue_receipt',
      'exact_current_issued_document',
      'exact_current_remaining_balance',
      'current_mission24_authority_for_commercial_change',
      'exact_replacement_document_lineage',
      'correction_reason',
      'complete_correction_lineage',
    ]),
  }),
  void: Object.freeze({
    requiredCapability: 'customer_financial.invoice.void',
    requiredControl: 'dual_control',
    missingEvidence: Object.freeze([
      'immutable_issue_receipt',
      'exact_current_issued_invoice_and_remaining_balance',
      'accepted_void_lifecycle',
      'two_different_current_humans',
      'reason',
      'complete_correction_lineage',
    ]),
  }),
});

function unavailableRecord(recordType) {
  const policy = RECORD_POLICY[recordType];
  return Object.freeze({
    recordType,
    state: 'unavailable',
    reason: REASON,
    value: null,
    requiredCapability: policy.requiredCapability,
    requiredControl: policy.requiredControl,
    requiredLineage: REQUIRED_LINEAGE,
    missingEvidence: policy.missingEvidence,
    appendOnlyRecordAuthorized: false,
    issuedVersionMutationAuthorized: false,
  });
}

function unavailable() {
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    value: null,
    sourceLifecycleContractVersion: 'm27-invoice-lifecycle-projection-v1',
    issuedInvoiceCurrent: false,
    issuedVersionImmutable: true,
    originalIssuedVersionMutationAuthorized: false,
    records: Object.freeze(RECORD_TYPES.map(unavailableRecord)),
    creditRecordAuthorized: false,
    debitRecordAuthorized: false,
    replacementRecordAuthorized: false,
    voidRecordAuthorized: false,
    providerCallCount: 0,
    receiverMutationCount: 0,
  });
}

function project(raw) {
  const expected = unavailable();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Invoice post-issue correction boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, RECORD_TYPES, REQUIRED_LINEAGE, RECORD_POLICY,
  unavailableRecord, unavailable, project };
