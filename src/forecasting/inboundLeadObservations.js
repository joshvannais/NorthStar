'use strict';

// Unmounted projection of reviewed lead identities, never raw call IDs. The
// owning reader must prove the receipt, dedupe, source completeness and consent.
const { validateReportingWindow, compareReportingWindows } = require('./timeSeriesWindows');

const VERSION = 'm26-inbound-lead-observations-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function invalid() {
  const error = new Error('Inbound lead observation details are invalid.');
  error.code = 'M26_INBOUND_LEAD_OBSERVATION_INVALID';
  throw error;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key =>
    typeof key === 'string' && keys.includes(key) &&
    Object.getOwnPropertyDescriptor(value, key).enumerable &&
    Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function boundedArray(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false;
  }
  return true;
}
function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }

function projectInboundLeadObservations(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'sourceSnapshotDigest',
    'leadReceipts', 'periods']) || input.version !== VERSION ||
    typeof input.organizationId !== 'string' || !UUID.test(input.organizationId) ||
    input.organizationId !== input.organizationId.toLowerCase() ||
    !instant(input.asOf) || !digest(input.sourceSnapshotDigest) ||
    !boundedArray(input.leadReceipts, 1000) || !boundedArray(input.periods, 52)) invalid();

  const identities = new Set();
  for (const lead of input.leadReceipts) {
    if (!exact(lead, ['organizationId', 'leadId', 'firstReceiptAt', 'reviewedAt',
      'sourceDigest', 'state']) ||
        lead.organizationId !== input.organizationId ||
        typeof lead.leadId !== 'string' || !UUID.test(lead.leadId) ||
        !instant(lead.firstReceiptAt) || !instant(lead.reviewedAt) ||
        !digest(lead.sourceDigest) || !['active', 'revoked'].includes(lead.state) ||
        lead.firstReceiptAt > lead.reviewedAt || lead.reviewedAt > input.asOf ||
        identities.has(lead.leadId.toLowerCase())) invalid();
    identities.add(lead.leadId.toLowerCase());
  }

  const periods = new Set();
  let previous = null;
  const observations = input.periods.map(period => {
    if (!exact(period, ['window', 'state', 'sourceRecordedThrough', 'coverageReceiptDigest']) ||
        !['complete', 'incomplete', 'revoked'].includes(period.state) ||
        !instant(period.sourceRecordedThrough) || !digest(period.coverageReceiptDigest)) invalid();
    try { validateReportingWindow(period.window); }
    catch (_error) { invalid(); }
    const window = period.window;
    if (window.organizationId !== input.organizationId ||
        window.serviceKey !== null || window.areaScope !== 'tenant_all' ||
        window.endsAt > period.sourceRecordedThrough ||
        period.sourceRecordedThrough > input.asOf || periods.has(window.startsAt)) invalid();
    if (previous && (previous.endsAt > window.startsAt ||
        !compareReportingWindows(previous, window).comparableContext)) invalid();
    previous = window;
    periods.add(window.startsAt);
    const inPeriod = input.leadReceipts.filter(lead =>
      lead.firstReceiptAt >= window.startsAt && lead.firstReceiptAt < window.endsAt);
    // A later review or revoked identity cannot be counted as an observed zero.
    const unresolved = inPeriod.some(lead => lead.reviewedAt > period.sourceRecordedThrough);
    const revoked = inPeriod.some(lead => lead.state === 'revoked');
    const state = period.state === 'complete' && unresolved ? 'incomplete' :
      period.state === 'complete' && revoked ? 'revoked' : period.state;
    return Object.freeze({ window: Object.freeze({ ...window }),
      count: state === 'complete' ? inPeriod.length : null, state,
      sourceRecordedThrough: period.sourceRecordedThrough,
      coverageReceiptDigest: period.coverageReceiptDigest });
  });
  return Object.freeze({ version: VERSION, organizationId: input.organizationId.toLowerCase(),
    asOf: input.asOf, sourceSnapshotDigest: input.sourceSnapshotDigest,
    observations: Object.freeze(observations) });
}

module.exports = { VERSION, projectInboundLeadObservations };
