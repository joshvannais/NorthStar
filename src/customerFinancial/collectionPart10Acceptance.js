'use strict';

const providerBoundary = require('./paymentProviderBoundary');
const part9Contract = require('./paymentPart9Acceptance');
const receivableAging = require('./receivableAging');
const collectionReview = require('./collectionReview');
const collectionHandoff = require('./collectionHandoffReadiness');

const CONTRACT_VERSION = 'm27-collection-part10-acceptance-v1';
const BUNDLE_VERSION = 'm27-collection-part10-preview-bundle-v1';
const REASON = 'part10_collection_evidence_unavailable';
const SOURCE_PARTS = Object.freeze([
  Object.freeze({ part: '10A', contractVersion: receivableAging.CONTRACT_VERSION,
    state: 'incomplete', reason: receivableAging.REASON }),
  Object.freeze({ part: '10B', contractVersion: collectionReview.CONTRACT_VERSION,
    state: 'unavailable', reason: collectionReview.REASON }),
  Object.freeze({ part: '10C', contractVersion: collectionHandoff.CONTRACT_VERSION,
    state: 'unavailable', reason: collectionHandoff.REASON }),
]);
const FAILURE_ORDER = Object.freeze([
  'source_unavailable',
  'source_changed',
  'request_rejected',
  'retry_currentness_unknown',
  'cooldown_unknown',
  'receiver_unavailable',
  'delivery_evidence_unknown',
]);
const REVOCATION_ORDER = Object.freeze([
  'issued_invoice_or_document',
  'scoped_customer_session',
  'reviewed_recipient',
  'delivery_authority',
  'provider_checkout_session',
  'collection_capability',
  'mission28_receiver',
  'idempotency_receipt',
]);

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function defaultSources() {
  const aging = receivableAging.unavailable();
  const review = collectionReview.unavailable(aging);
  const handoff = collectionHandoff.unavailable(review);
  return { receivableAging: aging, collectionReview: review, collectionHandoff: handoff };
}

function sourceParts(sources) {
  return SOURCE_PARTS.map((expected, index) => Object.freeze({
    part: expected.part,
    contractVersion: expected.contractVersion,
    state: expected.state,
    reason: expected.reason,
    digest: providerBoundary.digest(sources[index]),
  }));
}

function projectSources(sourcesRaw, allowDefaults) {
  const keys = ['receivableAging','collectionReview','collectionHandoff'];
  const supplied = sourcesRaw && Object.keys(sourcesRaw).length ? sourcesRaw :
    (allowDefaults ? defaultSources() : null);
  if (!exact(supplied, keys)) {
    throw new Error('Collection Part 10 source contracts invalid');
  }
  const aging = receivableAging.project(supplied.receivableAging);
  const review = collectionReview.projectWithSource(supplied.collectionReview, aging);
  const handoff = collectionHandoff.projectWithSource(supplied.collectionHandoff, review);
  return { receivableAging:aging, collectionReview:review, collectionHandoff:handoff };
}

function buildUnavailable(mode, part9, sources) {
  const aging = sources.receivableAging;
  const review = sources.collectionReview;
  const handoff = sources.collectionHandoff;
  const previewWitness = part9.part9Acceptance.previewWitness;
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    policyVersion: providerBoundary.POLICY_VERSION,
    policyDigest: providerBoundary.POLICY_DIGEST,
    state: 'unavailable',
    reason: REASON,
    mode,
    fictional: mode === 'demo',
    previewWitness,
    part9Witness: Object.freeze({
      contractVersion: part9.part9Acceptance.contractVersion,
      state: part9.part9Acceptance.state,
      reason: part9.part9Acceptance.reason,
      digest: providerBoundary.digest(part9.part9Acceptance),
    }),
    sourceParts: Object.freeze(sourceParts([aging, review, handoff])),
    failureRetry: Object.freeze({
      state: 'unavailable',
      reason: receivableAging.REASON,
      orderedFailureStates: FAILURE_ORDER,
      exactCurrentSourceRequiredBeforeEveryRetry: true,
      humanReviewedRetryRequired: true,
      automaticReminderRetryOrChargeSupported: false,
      priorProviderSessionMayBeReused: false,
      missingOrUnknownCooldownDenies: true,
      failedOrRejectedRequestMayCreateEffect: false,
      changedSourceMayReusePriorRequestOrReceipt: false,
      retryMayBypassRecipientCapabilityAssuranceOrControl: false,
      retryMayExceedOriginalReviewedRequest: false,
      staleGenerationOrDelayedResponseMayRepopulateRenderedState: false,
    }),
    revocation: Object.freeze({
      state: 'unavailable',
      reason: 'revocation_authority_unavailable',
      orderedRevocationAxes: REVOCATION_ORDER,
      everyAxisRevalidatedBeforeDisplayOrAction: true,
      revocationClearsRenderedPrivateAndCollectionState: true,
      revokedInvoiceDocumentSessionRecipientOrCheckoutMayBeReused: false,
      revokedCapabilityDeliveryAuthorityReceiverOrReceiptMayAuthorize: false,
      roleOrRetryMayBypassRevocation: false,
      revocationCreatesFinancialOrExternalEffect: false,
    }),
    access: Object.freeze({
      eligiblePaidRoles: Object.freeze(['owner', 'admin']),
      currentTenantSessionRequired: true,
      currentSubscriptionRequired: true,
      roleAloneAuthorizesCollectionAction: false,
      scopedCustomerSessionRequiredForCustomerAction: true,
      staffRoleMaySubstituteForCustomerSession: false,
      demoPhysicallyAndLogicallyIsolated: true,
      tenantCrossingAllowed: false,
    }),
    privacy: Object.freeze({
      tenantIdentityExposed: false,
      customerIdentityExposed: false,
      invoiceIdentityExposed: false,
      amountDueDateOrHoldExposed: false,
      recipientOrContactDetailExposed: false,
      collectionNoteOrPromiseExposed: false,
      messageContentExposed: false,
      rawLinkTokenProviderSessionOrSecretExposed: false,
      actorOrApproverIdentityExposed: false,
    }),
    acceptance: Object.freeze({
      sourceContractsRevalidated: true,
      wholePart10FunctionalBoundaryPresent: true,
      paidDemoIsolationAccepted: true,
      failureRetryRevocationPrivacyBoundaryPresent: true,
      independentWholeHeadAuditAccepted: false,
      firstPayingCustomerLiveMoneyValidated: false,
      founderVisualApprovalAccepted: false,
    }),
    exactCurrentnessRevalidated: true,
    receivableRowCount: 0,
    collectionReviewRowCount: 0,
    promiseToPayRowCount: 0,
    handoffRequestRowCount: 0,
    manualResendRequestRowCount: 0,
    outboundMessageCount: 0,
    providerCallCount: 0,
    providerMutationCount: 0,
    receiverMutationCount: 0,
    accountingMutationCount: 0,
    liveMoneyMovementCount: 0,
  });
}

function unavailable(mode, part9Raw, sourcesRaw = {}) {
  if (!['paid','demo'].includes(mode)) {
    throw new Error('Collection Part 10 mode invalid');
  }
  const part9 = part9Contract.projectBundle(part9Raw, mode);
  return buildUnavailable(mode, part9, projectSources(sourcesRaw, true));
}

function project(raw, mode, part9Bundle, sources) {
  const expected = unavailable(mode, part9Bundle, sources);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== Object.keys(expected).length) {
    throw new Error('Collection Part 10 acceptance boundary invalid');
  }
  if (sources) {
    if (JSON.stringify(raw) !== JSON.stringify(expected)) {
      throw new Error('Collection Part 10 acceptance boundary invalid');
    }
    return expected;
  }
  const actualComparable = JSON.parse(JSON.stringify(raw));
  const expectedComparable = JSON.parse(JSON.stringify(expected));
  if (!/^[0-9a-f]{64}$/.test(actualComparable.part9Witness?.digest || '') ||
      !Array.isArray(actualComparable.sourceParts) || actualComparable.sourceParts.length !== 3 ||
      actualComparable.sourceParts.some(value => !/^[0-9a-f]{64}$/.test(value.digest || ''))) {
    throw new Error('Collection Part 10 acceptance boundary invalid');
  }
  actualComparable.part9Witness.digest = expectedComparable.part9Witness.digest;
  actualComparable.sourceParts.forEach((value, index) => {
    value.digest = expectedComparable.sourceParts[index].digest;
  });
  if (JSON.stringify(actualComparable) !== JSON.stringify(expectedComparable)) {
    throw new Error('Collection Part 10 acceptance boundary invalid');
  }
  return raw;
}

function buildBundle(part9, value) {
  if (JSON.stringify(value.previewWitness) !==
      JSON.stringify(part9.part9Acceptance.previewWitness)) {
    throw new Error('Collection Part 10 preview bundle currentness mismatch');
  }
  return Object.freeze({
    contractVersion: BUNDLE_VERSION,
    preview: part9.preview,
    part5Acceptance: part9.part5Acceptance,
    part6Acceptance: part9.part6Acceptance,
    part7Acceptance: part9.part7Acceptance,
    part9Acceptance: part9.part9Acceptance,
    part10Acceptance: value,
  });
}

function bundle(part9Raw, acceptance, sources) {
  const part9 = part9Contract.projectBundle(part9Raw);
  const value = project(acceptance, part9.preview.mode, part9, sources);
  return buildBundle(part9, value);
}

// Repository-facing composition starts with one strict projection of the exact
// Part 9 bundle and one strict projection of each exact Part 10 source. The
// repository has already bracketed these values with current before/after
// reads, so rebuilding and then re-projecting the same acceptance would add no
// authority while materially extending the mounted response window.
function candidate(part9Raw, expectedMode, sourcesRaw) {
  if (!['paid','demo'].includes(expectedMode)) {
    throw new Error('Collection Part 10 mode invalid');
  }
  const part9 = part9Contract.projectBundle(part9Raw, expectedMode);
  const sources = projectSources(sourcesRaw, false);
  return buildBundle(part9, buildUnavailable(expectedMode, part9, sources));
}

function projectBundle(raw, expectedMode, sources) {
  if (!exact(raw, ['contractVersion','preview','part5Acceptance','part6Acceptance',
    'part7Acceptance','part9Acceptance','part10Acceptance']) ||
      raw.contractVersion !== BUNDLE_VERSION) {
    throw new Error('Collection Part 10 preview bundle invalid');
  }
  const part9 = {
    contractVersion: part9Contract.BUNDLE_VERSION,
    preview: raw.preview,
    part5Acceptance: raw.part5Acceptance,
    part6Acceptance: raw.part6Acceptance,
    part7Acceptance: raw.part7Acceptance,
    part9Acceptance: raw.part9Acceptance,
  };
  const value = bundle(part9, raw.part10Acceptance, sources);
  if (expectedMode && value.preview.mode !== expectedMode) {
    throw new Error('Collection Part 10 preview bundle mode mismatch');
  }
  return value;
}

module.exports = { CONTRACT_VERSION, BUNDLE_VERSION, REASON, SOURCE_PARTS,
  FAILURE_ORDER, REVOCATION_ORDER, defaultSources, unavailable, project, bundle,
  candidate, projectBundle };
