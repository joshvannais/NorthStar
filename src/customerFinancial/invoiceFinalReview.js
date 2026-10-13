'use strict';

const CONTRACT_VERSION = 'm27-invoice-final-review-v1';
const REASON = 'recent_auth_mfa_unavailable';
const REQUIRED_FIELDS = Object.freeze([
  'exact_current_draft_digest',
  'reviewed_customer',
  'reviewed_work',
  'currency',
  'exact_totals',
  'supported_due_terms',
  'supported_delivery_choice',
  'reason',
  'explicit_confirmation',
]);
const MISSING_EVIDENCE = Object.freeze([
  Object.freeze({ source: 'server_owned_recent_authentication_fact', state: 'unavailable',
    reason: 'recent_auth_fact_unavailable' }),
  Object.freeze({ source: 'accepted_mfa_ceremony', state: 'unavailable',
    reason: 'mfa_authority_unavailable' }),
  Object.freeze({ source: 'invoice_due_terms_policy', state: 'unavailable',
    reason: 'invoice_due_terms_policy_unavailable' }),
  Object.freeze({ source: 'invoice_delivery_choice_policy', state: 'unavailable',
    reason: 'invoice_delivery_choice_policy_unavailable' }),
  Object.freeze({ source: 'exact_current_amount_due', state: 'unavailable',
    reason: 'invoice_reconciliation_evidence_unavailable' }),
]);

function unavailable() {
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    value: null,
    requiredCapability: 'customer_financial.invoice.approve',
    requiredAssurance: 'recent_auth_mfa',
    requiredFields: REQUIRED_FIELDS,
    missingEvidence: MISSING_EVIDENCE,
    sourceCurrent: false,
    approvalAuthorized: false,
    invoiceAuthorized: false,
    issueAuthorized: false,
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
    throw new Error('Invoice final-review boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, REQUIRED_FIELDS, MISSING_EVIDENCE,
  unavailable, project };
