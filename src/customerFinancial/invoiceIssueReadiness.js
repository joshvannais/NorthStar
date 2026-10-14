'use strict';

const CONTRACT_VERSION = 'm27-invoice-issue-readiness-v1';
const REASON = 'final_invoice_approval_unavailable';
const REQUIRED_FIELDS = Object.freeze([
  'exact_current_approved_invoice_digest',
  'exact_current_numbering_policy',
  'current_issue_capability',
  'recent_auth_mfa',
  'exact_total_within_issue_bound',
  'current_billable_source',
  'reason',
  'idempotency_key',
]);
const MISSING_EVIDENCE = Object.freeze([
  Object.freeze({ source: 'immutable_final_invoice_approval', state: 'unavailable',
    reason: 'final_invoice_approval_unavailable' }),
  Object.freeze({ source: 'exact_current_approved_invoice_digest', state: 'unavailable',
    reason: 'approved_invoice_digest_unavailable' }),
  Object.freeze({ source: 'server_owned_recent_authentication_fact', state: 'unavailable',
    reason: 'recent_auth_fact_unavailable' }),
  Object.freeze({ source: 'accepted_mfa_ceremony', state: 'unavailable',
    reason: 'mfa_authority_unavailable' }),
  Object.freeze({ source: 'invoice_issue_capability_grant', state: 'unavailable',
    reason: 'invoice_issue_capability_unavailable' }),
]);

function unavailable() {
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    value: null,
    requiredCapability: 'customer_financial.invoice.issue',
    requiredAssurance: 'recent_auth_mfa',
    requiredFields: REQUIRED_FIELDS,
    missingEvidence: MISSING_EVIDENCE,
    approvalCurrent: false,
    numberReservationAuthorized: false,
    numberAssigned: false,
    issueReceiptCreated: false,
    uncertainRetryAvailable: false,
    invoiceAuthorized: false,
    receivableAuthorized: false,
    providerCallCount: 0,
    receiverMutationCount: 0,
  });
}

function project(raw) {
  const expected = unavailable();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Invoice issue-readiness boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, REQUIRED_FIELDS, MISSING_EVIDENCE,
  unavailable, project };
