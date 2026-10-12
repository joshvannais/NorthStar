'use strict';

const crypto = require('node:crypto');
const money = require('./exactMoney');

const CONTRACT_VERSION = 'm27-polaris-quote-journey-v1';
const DRAFT_VERSION = 'polaris.editable.estimate.v1';
const SIGNATURE_VERSION = 'm24.typed_name_explicit_consent.v1';
const HANDOFF_VERSION = 'mission23.work_intake.review.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const QUANTITY = /^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,3})?$/;

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
function invalid(message = 'Review every quote field and try again.') {
  throw Object.assign(new Error(message), {
    code: 'CUSTOMER_FINANCIAL_QUOTE_JOURNEY_INVALID', status: 400,
  });
}
function text(value, minimum, maximum, label) {
  if (typeof value !== 'string' || value !== value.trim() || value.length < minimum ||
      value.length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    invalid(`${label} is incomplete or too long.`);
  }
  return value;
}
function identity(value, label) {
  if (typeof value !== 'string' || !IDENTITY.test(value)) invalid(`${label} identity is invalid.`);
  return value;
}
function exactPrice(value) {
  try { return money.verify(value); } catch (_error) { invalid('Enter each price in exact USD cents.'); }
}
function normalizeLine(raw, ordinal) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).some(key => !['id','description','quantity','unit','price'].includes(key))) {
    invalid('A quote line is invalid.');
  }
  const quantity = text(raw.quantity, 1, 24, 'Quantity');
  if (!QUANTITY.test(quantity) || Number(quantity) <= 0) invalid('Quantity must be a positive exact value.');
  return Object.freeze({ id: identity(raw.id, 'Line'), ordinal,
    description: text(raw.description, 1, 2000, 'Line description'), quantity,
    unit: text(raw.unit, 1, 32, 'Unit'), price: exactPrice(raw.price) });
}
function normalizeOption(raw, ordinal) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).some(key => !['id','name','scope','lines','assumptions','validityDays'].includes(key)) ||
      !Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 100 ||
      !Array.isArray(raw.assumptions) || raw.assumptions.length > 50) invalid('A quote option is invalid.');
  const lines = raw.lines.map(normalizeLine);
  const assumptions = raw.assumptions.map((value, index) => Object.freeze({
    ordinal: index, text: text(value, 1, 500, 'Assumption'),
  }));
  const validityDays = Number(raw.validityDays);
  if (!Number.isSafeInteger(validityDays) || validityDays < 1 || validityDays > 30) {
    invalid('Proposal validity must be from 1 through 30 days.');
  }
  const totalMinorUnits = lines.reduce((sum, line) => sum + BigInt(line.price.minorUnits), 0n);
  const option = { id: identity(raw.id, 'Option'), ordinal,
    name: text(raw.name, 1, 120, 'Option name'), scope: text(raw.scope, 1, 2000, 'Scope'),
    lines: Object.freeze(lines), assumptions: Object.freeze(assumptions), validityDays,
    total: money.fromMinorUnits(totalMinorUnits.toString(), 'USD'),
  };
  return Object.freeze({ ...option, optionDigest: digest(option) });
}
function normalizeDraft(raw, source) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).some(key => !['options'].includes(key)) || !Array.isArray(raw.options) ||
      raw.options.length < 1 || raw.options.length > 3) invalid('Choose from one through three options.');
  const options = raw.options.map(normalizeOption);
  const lineIdentities = options.flatMap(option => option.lines.map(line => line.id));
  if (new Set(options.map(option => option.id)).size !== options.length ||
      options.reduce((sum, option) => sum + option.lines.length, 0) > 300 ||
      new Set(lineIdentities).size !== lineIdentities.length) {
    invalid('Option and line identities must be unique and within the launch limits.');
  }
  if (!source || !UUID.test(source.estimateId || '') || !UUID.test(source.customerId || '') ||
      !DIGEST.test(source.sourceDigest || '') || !DIGEST.test(source.sourceRevisionDigest || '') ||
      !DIGEST.test(source.sourceProposalDigest || '') ||
      !DIGEST.test(source.sourceProposalRevisionDigest || '')) {
    invalid('The current Mission 24 source is unavailable.');
  }
  const draft = { version: DRAFT_VERSION, estimateId: source.estimateId,
    customerId: source.customerId, sourceDigest: source.sourceDigest,
    sourceRevisionDigest: source.sourceRevisionDigest,
    sourceProposalDigest: source.sourceProposalDigest,
    sourceProposalRevisionDigest: source.sourceProposalRevisionDigest, currency: 'USD',
    options: Object.freeze(options), machineDraftApprovedPrice: false,
    commercialAuthority: 'mission24.authorized_human_price.v1',
    mission32Adapter: Object.freeze({ version: 'polaris.estimate_studio.adapter.v1',
      mayCreateParallelEstimate: false, mayDuplicateAcceptedMath: false }),
  };
  return Object.freeze({ ...draft, draftDigest: digest(draft) });
}
function draftFromBasis(basis) {
  const option = basis?.options?.[0];
  if (!basis || basis.state === 'unavailable' || basis.currentness?.current !== true ||
      !option || !UUID.test(basis.estimate?.id || '') || !UUID.test(basis.estimate?.customerId || '')) {
    return unavailable('mission24_current_estimate_unavailable', ['mission24.current_accepted_estimate']);
  }
  return Object.freeze({ version: DRAFT_VERSION, estimateId: basis.estimate.id,
    customerId: basis.estimate.customerId, sourceDigest: basis.currentness.sourceDigest,
    sourceRevisionDigest: basis.revision.digest,
    sourceProposalDigest: basis.revision.documentDigest,
    sourceProposalRevisionDigest: basis.revision.digest,
    currency: 'USD', draftDigest: null,
    revision: 0, state: 'ready_to_edit', machineDraftApprovedPrice: false,
    commercialAuthority: 'mission24.authorized_human_price.v1',
    options: Object.freeze([Object.freeze({ id: option.id, ordinal: 0,
      name: option.name || 'Option 1', scope: option.scope || '', validityDays: 30,
      lines: Object.freeze((option.lines || []).map((line, ordinal) => Object.freeze({
        id: line.id, ordinal, description: line.description,
        quantity: line.quantity || '', unit: line.unit || '', price: line.amount,
        sourceGaps: Object.freeze(line.missingEvidence || []),
      }))), assumptions: Object.freeze([]), total: option.totalBeforeTax,
      optionDigest: null })]),
    mission32Adapter: basis.mission32Adapter,
  });
}
function unavailable(reason, missingEvidence) {
  return Object.freeze({ contractVersion: CONTRACT_VERSION, state: 'unavailable', reason,
    value: null, missingEvidence: Object.freeze([...(missingEvidence || [])]),
    providerCallCount: 0, receiverMutationCount: 0, schedulingMutationCount: 0,
    workMutationCount: 0, financialActionAuthorized: false });
}

module.exports = { CONTRACT_VERSION, DRAFT_VERSION, SIGNATURE_VERSION,
  HANDOFF_VERSION, digest, invalid, normalizeDraft, draftFromBasis, unavailable };
