'use strict';

const crypto = require('node:crypto');
const money = require('./exactMoney');
const { POLICY_DIGEST, POLICY_VERSION, CAPABILITY, BUSINESS_PURPOSE } =
  require('./estimateCapabilityGrantIssuer');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, stable(value[key])]),
  );
  return value;
}
function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}
function exactMoney(decimal, currency) {
  return money.fromDecimal(decimal, currency);
}
function validMoney(decimal, currency) {
  try { exactMoney(decimal, currency); return true; } catch (_error) { return false; }
}
function positiveRevision(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1;
}
function unavailableSource(sourceClass, reason) {
  return Object.freeze({ sourceClass, state: 'unavailable', reason, value: null,
    sourceIdentity: null, sourceVersion: null, sourceDigest: null, capturedAt: null,
    extractor: null, confidence: null, humanReviewState: 'not_available' });
}
function lineIdentity(versionId, kind, ordinal) {
  return `line_${digest({ versionId, kind, ordinal }).slice(0, 32)}`;
}
function sourceProvenance(raw) {
  return Object.freeze({ sourceClass: 'mission24.current_commercial_version.v1',
    sourceIdentity: raw.identity.issuedVersionId, sourceVersion: String(raw.commercial.issuedRevision),
    sourceDigest: raw.commercial.issuedDigest, capturedAt: raw.capturedAt,
    extractor: null, confidence: null, humanReviewState: 'accepted_current' });
}
function validateRaw(raw) {
  const ids = raw?.identity; const commercial = raw?.commercial; const source = raw?.source;
  const booking = raw?.booking; const authority = raw?.authority; const document = raw?.customerSafeDocument;
  const requiredIds = ['estimateId','customerId','opportunityId','graphId','operationId','bookingReviewId',
    'appointmentId','scheduleApprovalId','acceptanceId','issuedVersionId'];
  const requiredDigests = ['decisionDigest','termsDigest','commercialApprovalDigest','issuedDigest',
    'documentDigest','acceptanceDigest'];
  if (raw?.state !== 'current_mission24_commercial_lineage' ||
      raw.version !== 'm27-mission24-commercial-editable-basis-v1' || raw.sourceCurrent !== true ||
      raw.providerCallCount !== 0 || raw.receiverMutationCount !== 0 ||
      !ids || requiredIds.some(key => !UUID.test(ids[key] || '')) ||
      !commercial || !validMoney(commercial.approvedPriceBeforeTax, commercial.currency) ||
      !positiveRevision(commercial.decisionRevision) ||
      !positiveRevision(commercial.termsRevision) || !positiveRevision(commercial.issuedRevision) ||
      requiredDigests.some(key => !DIGEST.test(commercial[key] || '')) ||
      !source || !DIGEST.test(source.estimateSnapshotDigest || '') ||
      !DIGEST.test(source.normalizedInputFingerprint || '') ||
      !positiveRevision(source.bookingReviewOrder) ||
      !booking || !UUID.test(booking.scheduleAssignmentId || '') || !DIGEST.test(booking.digest || '') ||
      !positiveRevision(booking.revision) || booking.state !== 'scheduled' ||
      !['preferred','scheduled'].includes(booking.appointmentStatus) ||
      !authority || authority.capability !== CAPABILITY ||
      authority.businessPurpose !== BUSINESS_PURPOSE || authority.policyVersion !== POLICY_VERSION ||
      authority.policyDigest !== POLICY_DIGEST || !UUID.test(authority.capabilityGrantId || '') ||
      !positiveRevision(authority.capabilityGrantRevision) ||
      !document || typeof document !== 'object' || Array.isArray(document) ||
      document.currency !== commercial.currency || !Array.isArray(document.charges) ||
      !Array.isArray(document.adjustments) || !Array.isArray(document.taxes) ||
      !Array.isArray(document.payments)) throw new Error('Editable estimate source invalid');
}
function projectLines(raw) {
  const document = raw.customerSafeDocument; const versionId = raw.identity.issuedVersionId;
  const rows = [
    ...document.charges.map((item, index) => ({ item, kind: item?.kind === 'fee' ? 'fee' : 'charge', index })),
    ...document.adjustments.map((item, index) => ({ item, kind: 'adjustment', index })),
    ...document.taxes.map((item, index) => ({ item: { ...item, amount: item?.amount ?? item?.tax }, kind: 'tax', index })),
  ];
  if (rows.length > 300) throw new Error('Editable estimate line limit exceeded');
  const provenance = sourceProvenance(raw);
  return rows.map(({ item, kind, index }, ordinal) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        typeof item.label !== 'string' || !item.label.trim() || item.label.length > 2000) {
      throw new Error('Editable estimate line invalid');
    }
    const amount = exactMoney(item.amount, raw.commercial.currency);
    return Object.freeze({ id: lineIdentity(versionId, kind, ordinal), ordinal,
      kind, description: item.label.trim(), quantity: null, unit: null, unitPrice: null,
      amount, assumptions: [], provenance, missingEvidence: Object.freeze([
        'quantity_unavailable','unit_unavailable','unit_price_unavailable',
      ]), humanReviewState: 'accepted_current' });
  });
}
function project(raw) {
  validateRaw(raw);
  const lines = projectLines(raw); const money = exactMoney(
    raw.commercial.approvedPriceBeforeTax, raw.commercial.currency);
  const scope = raw.customerSafeDocument.work?.scope;
  const workTitle = raw.customerSafeDocument.work?.title;
  const provenance = sourceProvenance(raw);
  const option = { id: raw.commercial.commercialApprovalId, ordinal: 0, name: 'Accepted option',
    scope: typeof scope === 'string' && scope.trim() ? scope.trim() : null,
    title: typeof workTitle === 'string' && workTitle.trim() ? workTitle.trim() : null,
    lines, assumptions: [], totalBeforeTax: money, provenance,
    customerAcceptance: Object.freeze({ state: 'accepted_current',
      acceptanceId: raw.identity.acceptanceId, acceptedAt: raw.commercial.acceptedAt,
      digest: raw.commercial.acceptanceDigest }), signatureEvidence: null };
  const basis = { contractVersion: 'm27-polaris-editable-estimate-v1', mode: 'paid_tenant',
    estimate: Object.freeze({ id: raw.identity.estimateId, customerId: raw.identity.customerId,
      opportunityId: raw.identity.opportunityId }),
    revision: Object.freeze({ id: raw.identity.issuedVersionId,
      sequence: Number(raw.commercial.issuedRevision), digest: raw.commercial.issuedDigest,
      documentDigest: raw.commercial.documentDigest, state: 'accepted_current' }),
    options: Object.freeze([Object.freeze(option)]), inputs: Object.freeze([]),
    provenance: Object.freeze([provenance]),
    intakeSources: Object.freeze({
      phone: unavailableSource('retell.inbound.completed.v1', 'source_runtime_unavailable'),
      photo: unavailableSource('northstar.quoted_job_photo.v1', 'source_runtime_unavailable'),
      extraction: unavailableSource('openai.responses.structured.v1', 'extraction_runtime_unavailable'),
    }),
    mission24: Object.freeze({ decisionId: raw.commercial.decisionId,
      decisionDigest: raw.commercial.decisionDigest, termsId: raw.commercial.termsId,
      termsDigest: raw.commercial.termsDigest,
      commercialApprovalId: raw.commercial.commercialApprovalId,
      commercialApprovalDigest: raw.commercial.commercialApprovalDigest }),
    booking: Object.freeze({ reviewId: raw.identity.bookingReviewId,
      appointmentId: raw.identity.appointmentId, scheduleApprovalId: raw.identity.scheduleApprovalId,
      assignmentId: raw.booking.scheduleAssignmentId, revision: Number(raw.booking.revision),
      digest: raw.booking.digest, state: raw.booking.state,
      scheduledStart: raw.booking.scheduledStart, scheduledEnd: raw.booking.scheduledEnd }),
    mission32Adapter: Object.freeze({ version: 'polaris.estimate_studio.adapter.v1',
      compatibleVersion: 1, available: false, reason: 'mission32_not_started',
      mayCreateParallelEstimate: false, mayDuplicateAcceptedMath: false }),
    currentness: Object.freeze({ current: true, capturedAt: raw.capturedAt,
      sourceVersion: 'm27-mission24-commercial-editable-basis-v1' }),
    authority: Object.freeze({ capability: CAPABILITY,
      capabilityGrantId: raw.authority.capabilityGrantId,
      capabilityGrantRevision: Number(raw.authority.capabilityGrantRevision),
      businessPurpose: BUSINESS_PURPOSE, policyVersion: POLICY_VERSION }),
    providerCallCount: 0, receiverMutationCount: 0, browserArithmeticUsed: false };
  return Object.freeze({ ...basis, digest: digest(basis) });
}
function unavailable(raw) {
  const reasons = new Set(['current_booking_review_unavailable','current_booking_review_ambiguous',
    'source_currentness_unavailable','commercial_lineage_unavailable']);
  if (raw?.state !== 'unavailable' || !reasons.has(raw.reason) || raw.value !== null ||
      raw.sourceCurrent !== false || raw.providerCallCount !== 0 || raw.receiverMutationCount !== 0) {
    throw new Error('Editable estimate unavailable state invalid');
  }
  return Object.freeze({ contractVersion: 'm27-polaris-editable-estimate-v1', state: 'unavailable',
    reason: raw.reason, value: null, sourceCurrent: false, providerCallCount: 0,
    receiverMutationCount: 0, phoneSourceValue: null, photoSourceValue: null,
    extractionValue: null });
}

module.exports = { project, unavailable, exactMoney, digest };
