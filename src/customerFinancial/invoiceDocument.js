'use strict';

const CONTRACT_VERSION = 'm27-customer-invoice-document-v1';
const REASON = 'issued_invoice_unavailable';

function unavailableFormat(format) {
  return Object.freeze({ format, state: 'unavailable', reason: REASON, value: null });
}

function unavailable(mode = 'paid') {
  if (!['paid', 'demo'].includes(mode)) throw new Error('Invoice document mode invalid');
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    mode,
    fictional: mode === 'demo',
    value: null,
    evidence: Object.freeze([
      Object.freeze({ requirement: 'immutable_invoice_issue_receipt', state: 'unavailable' }),
      Object.freeze({ requirement: 'exact_issued_document_revision', state: 'unavailable' }),
      Object.freeze({ requirement: 'customer_safe_document_projection', state: 'unavailable' }),
    ]),
    formats: Object.freeze({
      html: unavailableFormat('html'),
      pdf: unavailableFormat('pdf'),
    }),
    exactCurrentnessRevalidated: true,
    issuedDocumentCurrent: false,
    customerSafeProjectionCurrent: false,
    htmlRenderingAuthorized: false,
    pdfRenderingAuthorized: false,
    downloadAuthorized: false,
    publicAccessAuthorized: false,
    deliveryAuthorized: false,
    privateFieldValuesExposed: false,
    thirdPartyContentIncluded: false,
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
    throw new Error('Invoice document boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, unavailable, project };
