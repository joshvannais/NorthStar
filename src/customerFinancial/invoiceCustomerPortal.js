'use strict';

const CONTRACT_VERSION = 'm27-invoice-customer-portal-v1';
const REASON = 'issued_invoice_unavailable';
const REQUIREMENTS = Object.freeze([
  Object.freeze({ requirement: 'exact_current_invoice_public_session', state: 'unavailable' }),
  Object.freeze({ requirement: 'part1_recipient_verification_policy', state: 'unavailable' }),
  Object.freeze({ requirement: 'customer_mutation_origin_csrf_protection', state: 'not_mounted' }),
]);
const ACTION_NAMES = Object.freeze([
  'view',
  'download',
  'question',
  'billing_detail_correction_request',
  'delivery_acknowledgement',
  'view_acknowledgement',
]);

function action(name) {
  return Object.freeze({ action: name, state: 'unavailable', reason: REASON,
    value: null, authorized: false });
}

function unavailable(mode = 'paid') {
  if (!['paid', 'demo'].includes(mode)) throw new Error('Invoice customer-portal mode invalid');
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    mode,
    fictional: mode === 'demo',
    value: null,
    requirements: REQUIREMENTS,
    actions: Object.freeze(ACTION_NAMES.map(action)),
    exactCurrentnessRevalidated: true,
    customerSessionCurrent: false,
    recipientVerified: false,
    customerViewAuthorized: false,
    downloadAuthorized: false,
    questionSubmissionAuthorized: false,
    billingDetailCorrectionRequestAuthorized: false,
    deliveryAcknowledgementAuthorized: false,
    viewAcknowledgementAuthorized: false,
    invoiceMutationAuthorized: false,
    publicViewMounted: false,
    publicDownloadMounted: false,
    customerMutationRouteMounted: false,
    originCsrfProtectionMounted: false,
    questionRecorded: false,
    billingDetailCorrectionRequestRecorded: false,
    deliveryAcknowledgementRecorded: false,
    viewAcknowledgementRecorded: false,
    privateFieldValuesExposed: false,
    thirdPartyContentIncluded: false,
    rawTokenReturned: false,
    providerCallCount: 0,
    receiverMutationCount: 0,
  });
}

function project(raw, expectedMode) {
  const mode = expectedMode || raw?.mode;
  const expected = unavailable(mode);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Invoice customer-portal boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, REQUIREMENTS, ACTION_NAMES,
  unavailable, project };
