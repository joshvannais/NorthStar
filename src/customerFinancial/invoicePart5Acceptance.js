'use strict';

const finalReview = require('./invoiceFinalReview');
const issueReadiness = require('./invoiceIssueReadiness');
const lifecycle = require('./invoiceLifecycleProjection');
const correction = require('./invoicePostIssueCorrection');
const previewContract = require('./invoiceDraftPreview');

const CONTRACT_VERSION = 'm27-invoice-part5-acceptance-v1';
const WITNESS_VERSION = 'm27-invoice-part5-preview-witness-v1';
const BUNDLE_VERSION = 'm27-invoice-part5-preview-bundle-v1';
const REASON = 'invoice_issue_authority_unavailable';
const DIGEST = /^[0-9a-f]{64}$/;

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function witness(value) {
  if (value?.contractVersion === WITNESS_VERSION) {
    if (!exact(value, ['contractVersion','mode','draftRevision','draftDigest','previewDigest']) ||
        !['paid','demo'].includes(value.mode) ||
        !Number.isSafeInteger(value.draftRevision) || value.draftRevision < 0 ||
        !DIGEST.test(value.draftDigest || '') || !DIGEST.test(value.previewDigest || '')) {
      throw new Error('Invoice Part 5 preview witness invalid');
    }
    return Object.freeze(value);
  }
  const preview = previewContract.project(value);
  if (preview.state !== 'current') throw new Error('Invoice Part 5 preview witness unavailable');
  return Object.freeze({ contractVersion: WITNESS_VERSION,
    mode: preview.mode,
    draftRevision: preview.draftIdentity.revision,
    draftDigest: preview.draftIdentity.draftDigest,
    previewDigest: preview.previewDigest });
}

function unavailable(mode = 'paid', previewOrWitness) {
  if (!['paid','demo'].includes(mode)) throw new Error('Invoice Part 5 mode invalid');
  const previewWitness = witness(previewOrWitness);
  if (previewWitness.mode !== mode) throw new Error('Invoice Part 5 preview mode mismatch');
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    state: 'unavailable',
    reason: REASON,
    mode,
    fictional: mode === 'demo',
    previewWitness,
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
  const expected = unavailable(mode, raw?.previewWitness);
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

function samePreview(preview, acceptance) {
  const previewValue = previewContract.project(preview);
  const acceptanceValue = project(acceptance, previewValue.mode);
  const current = acceptanceValue.previewWitness;
  return current.mode === previewValue.mode &&
    current.draftRevision === previewValue.draftIdentity.revision &&
    current.draftDigest === previewValue.draftIdentity.draftDigest &&
    current.previewDigest === previewValue.previewDigest;
}

function bundle(preview, acceptance) {
  const previewValue = previewContract.project(preview);
  const acceptanceValue = project(acceptance, previewValue.mode);
  if (!samePreview(previewValue, acceptanceValue)) {
    throw new Error('Invoice Part 5 preview bundle currentness mismatch');
  }
  return Object.freeze({ contractVersion:BUNDLE_VERSION,
    preview:previewValue, acceptance:acceptanceValue });
}

function projectBundle(raw, expectedMode) {
  if (!exact(raw, ['contractVersion','preview','acceptance']) ||
      raw.contractVersion !== BUNDLE_VERSION) {
    throw new Error('Invoice Part 5 preview bundle invalid');
  }
  const value = bundle(raw.preview, raw.acceptance);
  if (expectedMode && value.preview.mode !== expectedMode) {
    throw new Error('Invoice Part 5 preview bundle mode mismatch');
  }
  return value;
}

module.exports = { CONTRACT_VERSION, WITNESS_VERSION, BUNDLE_VERSION, REASON,
  witness, unavailable, project, samePreview, bundle, projectBundle };
