'use strict';

const part5Contract = require('./invoicePart5Acceptance');
const documentContract = require('./invoiceDocument');
const sessionContract = require('./invoicePublicSession');
const portalContract = require('./invoiceCustomerPortal');

const CONTRACT_VERSION = 'm27-invoice-part6-acceptance-v1';
const BUNDLE_VERSION = 'm27-invoice-part6-preview-bundle-v1';
const DELIVERY_VERSION = 'm27-invoice-delivery-readiness-v1';
const REASON = 'issued_invoice_unavailable';
const ACTION_NAMES = Object.freeze([
  'email_delivery_handoff',
  'sms_delivery_handoff',
  'resend',
  'revoke_customer_access',
  'delivery_recovery',
  'mission28_broader_communication_handoff',
]);
const REQUIREMENTS = Object.freeze([
  Object.freeze({ requirement: 'exact_current_issued_document', state: 'unavailable' }),
  Object.freeze({ requirement: 'reviewed_recipient_and_delivery_choice', state: 'unavailable' }),
  Object.freeze({ requirement: 'customer_financial_invoice_send_capability', state: 'unavailable' }),
  Object.freeze({ requirement: 'recent_auth_and_required_control', state: 'unavailable' }),
  Object.freeze({ requirement: 'exact_delivery_idempotency', state: 'unavailable' }),
  Object.freeze({ requirement: 'delivery_evidence_receipt', state: 'unavailable' }),
  Object.freeze({ requirement: 'scoped_customer_access_revocation', state: 'unavailable' }),
  Object.freeze({ requirement: 'mission28_broader_communication_adapter', state: 'unavailable' }),
]);

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function action(name) {
  return Object.freeze({ action: name, state: 'unavailable', reason: REASON,
    value: null, authorized: false });
}

function unavailable(mode = 'paid', previewWitness) {
  if (!['paid','demo'].includes(mode)) throw new Error('Invoice Part 6 mode invalid');
  const witness = part5Contract.witness(previewWitness);
  if (witness.mode !== mode) throw new Error('Invoice Part 6 preview mode mismatch');
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    mode,
    fictional: mode === 'demo',
    previewWitness: witness,
    document: documentContract.unavailable(mode),
    publicSession: sessionContract.unavailable(mode),
    customerPortal: portalContract.unavailable(mode),
    delivery: Object.freeze({
      contractVersion: DELIVERY_VERSION,
      state: 'unavailable',
      reason: REASON,
      value: null,
      requirements: REQUIREMENTS,
      actions: Object.freeze(ACTION_NAMES.map(action)),
    }),
    exactCurrentnessRevalidated: true,
    exactDocumentCurrent: false,
    recipientReviewed: false,
    explicitDeliveryChoiceCurrent: false,
    invoiceSendCapabilityCurrent: false,
    recentAuthenticationCurrent: false,
    customerSessionCurrent: false,
    emailDeliveryAuthorized: false,
    smsDeliveryAuthorized: false,
    resendAuthorized: false,
    revocationAuthorized: false,
    recoveryAuthorized: false,
    mission28HandoffAuthorized: false,
    messageSent: false,
    deliveryReceiptCreated: false,
    accessRevocationRecorded: false,
    automaticSendAuthorized: false,
    automaticRetryAuthorized: false,
    providerCallCount: 0,
    receiverMutationCount: 0,
    outboundMessageCount: 0,
  });
}

function project(raw, expectedMode) {
  const mode = expectedMode || raw?.mode;
  documentContract.project(raw?.document, mode);
  sessionContract.project(raw?.publicSession, mode);
  portalContract.project(raw?.customerPortal, mode);
  const expected = unavailable(mode, raw?.previewWitness);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Invoice Part 6 acceptance boundary invalid');
  }
  return expected;
}

function bundle(part5Bundle, acceptance) {
  const current = part5Contract.projectBundle(part5Bundle);
  const value = project(acceptance, current.preview.mode);
  const witness = current.acceptance.previewWitness;
  if (JSON.stringify(witness) !== JSON.stringify(value.previewWitness)) {
    throw new Error('Invoice Part 6 preview bundle currentness mismatch');
  }
  return Object.freeze({ contractVersion: BUNDLE_VERSION,
    preview: current.preview,
    part5Acceptance: current.acceptance,
    part6Acceptance: value });
}

function projectBundle(raw, expectedMode) {
  if (!exact(raw, ['contractVersion','preview','part5Acceptance','part6Acceptance']) ||
      raw.contractVersion !== BUNDLE_VERSION) {
    throw new Error('Invoice Part 6 preview bundle invalid');
  }
  const part5Bundle = { contractVersion: part5Contract.BUNDLE_VERSION,
    preview: raw.preview, acceptance: raw.part5Acceptance };
  const value = bundle(part5Bundle, raw.part6Acceptance);
  if (expectedMode && value.preview.mode !== expectedMode) {
    throw new Error('Invoice Part 6 preview bundle mode mismatch');
  }
  return value;
}

module.exports = { CONTRACT_VERSION, BUNDLE_VERSION, DELIVERY_VERSION, REASON,
  ACTION_NAMES, REQUIREMENTS, unavailable, project, bundle, projectBundle };
