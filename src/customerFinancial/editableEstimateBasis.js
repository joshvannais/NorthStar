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
function timestamp(value) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}
function text(value, maximum = 2000) {
  return typeof value === 'string' && value.trim() && value.length <= maximum ? value.trim() : null;
}
function sameMoney(left, right) {
  return money.verify(left).currency === money.verify(right).currency &&
    money.verify(left).minorUnits === money.verify(right).minorUnits;
}
function sumMoney(values, currency) {
  return values.length ? money.add(values) : money.fromMinorUnits('0', currency);
}
function unavailableSource(sourceClass, reason) {
  return Object.freeze({ sourceClass, state: 'unavailable', reason, value: null,
    sourceIdentity: null, sourceVersion: null, sourceDigest: null, capturedAt: null,
    extractor: null, confidence: null, humanReviewState: 'not_available' });
}
function lineIdentity(versionId, kind, ordinal) {
  return `line_${digest({ versionId, kind, ordinal }).slice(0, 32)}`;
}
function sourceReceipt(raw) {
  const value = {
    sourceClass: 'mission24.current_commercial_version.v1',
    estimateId: raw.identity.estimateId, graphId: raw.identity.graphId,
    operationId: raw.identity.operationId, estimateSnapshotDigest: raw.source.estimateSnapshotDigest,
    calculationVersion: raw.source.calculationVersion,
    normalizedInputFingerprint: raw.source.normalizedInputFingerprint,
    businessProfileId: raw.source.businessProfileId,
    businessProfileVersion: raw.source.businessProfileVersion,
    businessProfileDigest: raw.source.businessProfileDigest,
    bookingReviewId: raw.identity.bookingReviewId,
    bookingReviewOrder: Number(raw.source.bookingReviewOrder), reviewedAt: raw.source.reviewedAt,
    issuedVersionId: raw.identity.issuedVersionId,
    issuedRevision: Number(raw.commercial.issuedRevision), issuedDigest: raw.commercial.issuedDigest,
    documentDigest: raw.commercial.documentDigest, capturedAt: raw.capturedAt,
  };
  return Object.freeze({ ...value, provenanceIdentity: `provenance_${digest(value).slice(0, 32)}`,
    provenanceDigest: digest(value) });
}
function sourceProvenance(raw) {
  const receipt = sourceReceipt(raw);
  return Object.freeze({ sourceClass: receipt.sourceClass,
    sourceIdentity: receipt.provenanceIdentity, sourceVersion: receipt.calculationVersion,
    sourceDigest: receipt.provenanceDigest, capturedAt: receipt.capturedAt,
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
      !UUID.test(source.businessProfileId || '') ||
      !text(source.businessProfileVersion, 200) || !DIGEST.test(source.businessProfileDigest || '') ||
      !text(source.calculationVersion, 200) || !positiveRevision(source.bookingReviewOrder) ||
      !timestamp(raw.capturedAt) || !timestamp(source.reviewedAt) ||
      !timestamp(commercial.issuedAt) || !timestamp(commercial.acceptedAt) ||
      !booking || !UUID.test(booking.scheduleAssignmentId || '') || !DIGEST.test(booking.digest || '') ||
      !positiveRevision(booking.revision) || booking.state !== 'scheduled' ||
      !['preferred','scheduled'].includes(booking.appointmentStatus) ||
      !timestamp(booking.scheduledStart) || !timestamp(booking.scheduledEnd) ||
      !authority || authority.capability !== CAPABILITY ||
      authority.businessPurpose !== BUSINESS_PURPOSE || authority.policyVersion !== POLICY_VERSION ||
      authority.policyDigest !== POLICY_DIGEST || !UUID.test(authority.capabilityGrantId || '') ||
      !positiveRevision(authority.capabilityGrantRevision) ||
      !document || typeof document !== 'object' || Array.isArray(document) ||
      document.currency !== commercial.currency || !Array.isArray(document.charges) ||
      !Array.isArray(document.adjustments) || !Array.isArray(document.taxes) ||
      !Array.isArray(document.payments)) throw new Error('Editable estimate source invalid');
}
function evidenceRows(rows, kind, raw, maximum, amountKey = 'amount') {
  if (rows.length > maximum) throw new Error(`Editable estimate ${kind} limit exceeded`);
  return Object.freeze(rows.map((item, ordinal) => {
    const label = text(item?.label);
    if (!label) throw new Error(`Editable estimate ${kind} invalid`);
    return Object.freeze({ id: lineIdentity(raw.identity.issuedVersionId, kind, ordinal), ordinal,
      kind, arithmeticRole: `${kind}_non_additive`, description: label,
      amount: exactMoney(item?.[amountKey], raw.commercial.currency),
      ...(kind === 'tax' ? { treatment: ['taxable','zero_rate','exempt','reviewed']
        .includes(item?.treatment) ? item.treatment : 'reviewed' } : {}),
      ...(kind === 'payment_schedule' ? { paymentKind: ['deposit','milestone','balance','payment']
        .includes(item?.kind) ? item.kind : 'payment' } : {}),
      provenance: sourceProvenance(raw), humanReviewState: 'accepted_current' });
  }));
}
function projectPricing(raw) {
  const document = raw.customerSafeDocument; const versionId = raw.identity.issuedVersionId;
  if (!document.charges.length || document.charges.length > 24) {
    throw new Error('Editable estimate charge limit exceeded');
  }
  const provenance = sourceProvenance(raw);
  const lines = document.charges.map((item, ordinal) => {
    const kind = item?.kind === 'fee' ? 'fee' : 'charge';
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        !text(item.label)) {
      throw new Error('Editable estimate line invalid');
    }
    const amount = exactMoney(item.amount, raw.commercial.currency);
    return Object.freeze({ id: lineIdentity(versionId, kind, ordinal), ordinal,
      kind, arithmeticRole: 'additive_pre_tax_component', description: text(item.label),
      quantity: null, unit: null, unitPrice: null,
      amount, assumptions: [], provenance, missingEvidence: Object.freeze([
        'quantity_unavailable','unit_unavailable','unit_price_unavailable',
      ]), humanReviewState: 'accepted_current' });
  });
  const adjustments = evidenceRows(document.adjustments, 'adjustment', raw, 12);
  const taxes = evidenceRows(document.taxes.map(item => ({ ...item,
    amount: item?.amount ?? item?.tax })), 'tax', raw, 12);
  const payments = evidenceRows(document.payments, 'payment_schedule', raw, 12);
  const totals = Object.freeze({ beforeTax: exactMoney(document.subtotal, raw.commercial.currency),
    tax: exactMoney(document.tax, raw.commercial.currency),
    afterTax: exactMoney(document.total, raw.commercial.currency) });
  const additiveLineTotal = sumMoney(lines.map(line => line.amount), raw.commercial.currency);
  const acceptedBeforeTax = exactMoney(raw.commercial.approvedPriceBeforeTax,
    raw.commercial.currency);
  if (!sameMoney(additiveLineTotal, acceptedBeforeTax) ||
      !sameMoney(totals.beforeTax, acceptedBeforeTax) ||
      !sameMoney(sumMoney([totals.beforeTax, totals.tax], raw.commercial.currency), totals.afterTax)) {
    throw new Error('Editable estimate accepted totals do not reconcile');
  }
  return Object.freeze({ lines: Object.freeze(lines), adjustments, taxes, payments,
    totals, additiveLineTotal, reconciliation: Object.freeze({
      arithmeticVersion: 'm27-accepted-document-reconciliation-v1',
      additiveLineTotalMatchesAcceptedBeforeTax: true,
      acceptedBeforeTaxPlusTaxMatchesAfterTax: true,
      adjustmentsAreInformational: true, taxesAreNonAdditive: true,
      paymentScheduleIsNonAdditive: true,
    }) });
}
function project(raw) {
  validateRaw(raw);
  const pricing = projectPricing(raw); const acceptedMoney = exactMoney(
    raw.commercial.approvedPriceBeforeTax, raw.commercial.currency);
  const scope = raw.customerSafeDocument.work?.scope;
  const workTitle = raw.customerSafeDocument.work?.title;
  const provenance = sourceProvenance(raw);
  const option = { id: raw.commercial.commercialApprovalId, ordinal: 0, name: 'Accepted option',
    scope: typeof scope === 'string' && scope.trim() ? scope.trim() : null,
    title: typeof workTitle === 'string' && workTitle.trim() ? workTitle.trim() : null,
    lines: pricing.lines, assumptions: [], totalBeforeTax: acceptedMoney, provenance,
    pricingEvidence: Object.freeze({ adjustments: pricing.adjustments, taxes: pricing.taxes,
      paymentSchedule: pricing.payments, totals: pricing.totals,
      additiveLineTotal: pricing.additiveLineTotal, reconciliation: pricing.reconciliation }),
    customerAcceptance: Object.freeze({ state: 'accepted_current',
      acceptanceId: raw.identity.acceptanceId, acceptedAt: raw.commercial.acceptedAt,
      digest: raw.commercial.acceptanceDigest }), signatureEvidence: null };
  const receipt = sourceReceipt(raw);
  const typedInput = Object.freeze({ id: `input_${receipt.provenanceDigest.slice(0, 32)}`,
    key: 'mission24.normalized_estimate_input', valueType: 'digest',
    value: raw.source.normalizedInputFingerprint, sourceIdentity: raw.identity.graphId,
    operationIdentity: raw.identity.operationId, sourceVersion: raw.source.calculationVersion,
    sourceDigest: raw.source.estimateSnapshotDigest, capturedAt: raw.source.reviewedAt,
    humanReviewState: 'accepted_current' });
  const basis = { contractVersion: 'm27-polaris-editable-estimate-v1', mode: 'paid_tenant',
    estimate: Object.freeze({ id: raw.identity.estimateId, customerId: raw.identity.customerId,
      opportunityId: raw.identity.opportunityId }),
    revision: Object.freeze({ id: raw.identity.issuedVersionId,
      sequence: Number(raw.commercial.issuedRevision), digest: raw.commercial.issuedDigest,
      documentDigest: raw.commercial.documentDigest, state: 'accepted_current' }),
    options: Object.freeze([Object.freeze(option)]), inputs: Object.freeze([typedInput]),
    provenance: Object.freeze([provenance]),
    sourceEvidence: Object.freeze({ receipt,
      build: Object.freeze({ calculationVersion: raw.source.calculationVersion }),
      configuration: Object.freeze({ state: 'available', identity: raw.source.businessProfileId,
        version: raw.source.businessProfileVersion, digest: raw.source.businessProfileDigest }),
      typedFields: Object.freeze({ state: 'unavailable',
        reason: 'source_typed_fields_not_exposed_by_mission24_contract', value: null }),
      optionValidity: Object.freeze({ state: 'accepted_current', valid: true,
        decisionId: raw.commercial.decisionId, decisionDigest: raw.commercial.decisionDigest,
        approvalId: raw.commercial.commercialApprovalId,
        approvalDigest: raw.commercial.commercialApprovalDigest,
        acceptanceId: raw.identity.acceptanceId,
        acceptanceDigest: raw.commercial.acceptanceDigest }),
      exclusions: Object.freeze([
        Object.freeze({ sourceClass: 'phone', state: 'unavailable', reason: 'source_runtime_unavailable' }),
        Object.freeze({ sourceClass: 'photo', state: 'unavailable', reason: 'source_runtime_unavailable' }),
        Object.freeze({ sourceClass: 'extraction', state: 'unavailable', reason: 'extraction_runtime_unavailable' }),
        Object.freeze({ sourceClass: 'mission32', state: 'unavailable', reason: 'mission32_not_started' }),
      ]) }),
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
      sourceVersion: 'm27-mission24-commercial-editable-basis-v1',
      sourceIdentity: receipt.provenanceIdentity, sourceDigest: receipt.provenanceDigest,
      bookingReviewOrder: Number(raw.source.bookingReviewOrder),
      reviewedAt: raw.source.reviewedAt }),
    authority: Object.freeze({ capability: CAPABILITY,
      capabilityGrantId: raw.authority.capabilityGrantId,
      capabilityGrantRevision: Number(raw.authority.capabilityGrantRevision),
      businessPurpose: BUSINESS_PURPOSE, policyVersion: POLICY_VERSION }),
    providerCallCount: 0, receiverMutationCount: 0, browserArithmeticUsed: false };
  return Object.freeze({ ...basis, digest: digest(basis) });
}
function unavailable(raw) {
  const reasons = new Set(['current_booking_review_unavailable','current_booking_review_ambiguous',
    'source_currentness_unavailable','commercial_lineage_unavailable',
    'source_configuration_unavailable']);
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
