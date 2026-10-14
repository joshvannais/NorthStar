'use strict';

const finalReview = require('./invoiceFinalReview');
const issueReadiness = require('./invoiceIssueReadiness');
const lifecycle = require('./invoiceLifecycleProjection');
const correction = require('./invoicePostIssueCorrection');

const CONTRACT_VERSION = 'm27-invoice-part5-acceptance-v1';
const REASON = 'invoice_issue_authority_unavailable';

function unavailable(mode = 'paid') {
  if (!['paid','demo'].includes(mode)) throw new Error('Invoice Part 5 mode invalid');
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    mode,
    fictional: mode === 'demo',
    finalReview: finalReview.unavailable(),
    issueReadiness: issueReadiness.unavailable(),
    lifecycle: lifecycle.unavailable(),
    postIssueCorrection: correction.unavailable(),
    exactCurrentnessRevalidated: true,
    approvalAuthorized: false,
    issueAuthorized: false,
    reminderAuthorized: false,
    feeAuthorized: false,
    collectionAuthorized: false,
    automaticChargeAuthorized: false,
    correctionAuthorized: false,
    providerCallCount: 0,
    receiverMutationCount: 0,
  });
}

function project(raw, expectedMode) {
  const mode = expectedMode || raw?.mode;
  const expected = unavailable(mode);
  finalReview.project(raw?.finalReview);
  issueReadiness.project(raw?.issueReadiness);
  lifecycle.project(raw?.lifecycle);
  correction.project(raw?.postIssueCorrection);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length ||
      JSON.stringify(raw) !== JSON.stringify(expected)) {
    throw new Error('Invoice Part 5 acceptance boundary invalid');
  }
  return expected;
}

module.exports = { CONTRACT_VERSION, REASON, unavailable, project };
