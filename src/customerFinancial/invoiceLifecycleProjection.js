'use strict';

const CONTRACT_VERSION = 'm27-invoice-lifecycle-projection-v1';
const DISPLAY_POLICY_VERSION = 'm27-invoice-lifecycle-display-precedence-v1';
const REASON = 'issued_invoice_unavailable';
const AXIS_ORDER = Object.freeze([
  'documentRevision',
  'delivery',
  'paymentBalance',
  'dueAging',
  'disputeRefund',
  'settlement',
  'accountingHandoff',
]);

const AXIS_GAPS = Object.freeze({
  documentRevision: Object.freeze(['immutable_issue_receipt', 'exact_issued_document_revision']),
  delivery: Object.freeze(['exact_issued_document', 'accepted_delivery_evidence']),
  paymentBalance: Object.freeze(['exact_issued_receivable', 'accepted_payment_evidence']),
  dueAging: Object.freeze(['exact_issued_due_date', 'trusted_server_clock']),
  disputeRefund: Object.freeze(['dispute_action_unsupported', 'refund_unavailable']),
  settlement: Object.freeze(['settlement_unavailable']),
  accountingHandoff: Object.freeze(['accounting_adapter_unavailable']),
});

function selectDisplay(axes) {
  if (!Array.isArray(axes) || axes.length !== AXIS_ORDER.length ||
      axes.some((axis, index) => !axis || axis.axis !== AXIS_ORDER[index] ||
        !['current', 'unavailable'].includes(axis.state) ||
        (axis.state === 'current' ? axis.reason !== null : typeof axis.reason !== 'string'))) {
    throw new Error('Invoice lifecycle axes invalid');
  }
  const primary = axes.find(axis => axis.state !== 'current') || null;
  return Object.freeze({
    policyVersion: DISPLAY_POLICY_VERSION,
    precedence: AXIS_ORDER,
    primaryAxis: primary ? primary.axis : null,
    primaryState: primary ? primary.state : 'current',
    primaryReason: primary ? primary.reason : null,
    everyAxisRetained: true,
  });
}

function unavailableAxis(axis) {
  return Object.freeze({
    axis,
    state: 'unavailable',
    reason: REASON,
    value: null,
    missingEvidence: AXIS_GAPS[axis],
  });
}

function unavailable() {
  const axes = Object.freeze(AXIS_ORDER.map(unavailableAxis));
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    value: null,
    axes,
    display: selectDisplay(axes),
    issuedInvoiceCurrent: false,
    trustedClockEvaluated: false,
    reminderAuthorized: false,
    feeAuthorized: false,
    collectionAuthorized: false,
    automaticChargeAuthorized: false,
    providerCallCount: 0,
    receiverMutationCount: 0,
  });
}

function project(raw) {
  const expected = unavailable();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Invoice lifecycle projection boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, DISPLAY_POLICY_VERSION, REASON, AXIS_ORDER,
  AXIS_GAPS, selectDisplay, unavailable, project };
