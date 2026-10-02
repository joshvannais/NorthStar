'use strict';

const crypto = require('node:crypto');
const { validateReportingWindow, compareReportingWindows } =
  require('./timeSeriesWindows');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const DIGEST = /^[0-9a-f]{64}$/;

function exact(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every(key => keys.includes(key));
}

function windowsDigest(organizationId, profileAnchorId, windows) {
  return crypto.createHash('sha256').update([
    'm26-comparable-month-windows-v2', organizationId, profileAnchorId,
    windows[0].timeZone, windows[0].localStartDate,
    String(Date.parse(windows[0].startsAt)), String(Date.parse(windows[0].endsAt)),
    String(windows[0].elapsedMinutes), String(windows[0].openMinutes),
    windows[1].localStartDate, String(Date.parse(windows[1].startsAt)),
    String(Date.parse(windows[1].endsAt)), String(windows[1].elapsedMinutes),
    String(windows[1].openMinutes),
  ].join('|')).digest('hex');
}

function normalizeReceipt(receipt, organizationId, profileAnchorId, windows) {
  if (!exact(receipt, ['id', 'version', 'organizationId', 'profileAnchorId',
    'timeZone', 'firstLocalStartDate', 'firstLocalEndDate',
    'firstStartsAt', 'firstEndsAt', 'firstElapsedMinutes', 'firstOpenMinutes',
    'secondLocalStartDate', 'secondLocalEndDate',
    'secondStartsAt', 'secondEndsAt', 'secondElapsedMinutes', 'secondOpenMinutes',
    'openMinutesBasis',
    'windowsDigest', 'capturedAt', 'sourceScope', 'targetKey', 'sourceEvents',
    'sourceEventCount', 'firstEventCount', 'secondEventCount',
    'sourceSnapshotDigest', 'coverage']) ||
    receipt.version !== 'm26-comparable-approved-estimate-months-v2' ||
    receipt.organizationId !== organizationId ||
    receipt.profileAnchorId !== profileAnchorId ||
    !UUID.test(receipt.id || '') || !UUID.test(receipt.profileAnchorId || '') ||
    !INSTANT.test(receipt.firstStartsAt || '') ||
    !INSTANT.test(receipt.firstEndsAt || '') ||
    !INSTANT.test(receipt.secondStartsAt || '') ||
    !INSTANT.test(receipt.secondEndsAt || '') ||
    !INSTANT.test(receipt.capturedAt || '') ||
    receipt.sourceScope !== 'northstar_m24_approved_estimate_decisions' ||
    receipt.targetKey !== 'pipeline.approved_estimates' ||
    !DIGEST.test(receipt.windowsDigest || '') ||
    receipt.windowsDigest !== windowsDigest(organizationId, profileAnchorId, windows) ||
    receipt.timeZone !== windows[0].timeZone ||
    receipt.firstLocalStartDate !== windows[0].localStartDate ||
    receipt.firstLocalEndDate !== windows[0].localEndDate ||
    receipt.firstElapsedMinutes !== windows[0].elapsedMinutes ||
    receipt.firstOpenMinutes !== windows[0].openMinutes ||
    receipt.secondLocalStartDate !== windows[1].localStartDate ||
    receipt.secondLocalEndDate !== windows[1].localEndDate ||
    receipt.secondElapsedMinutes !== windows[1].elapsedMinutes ||
    receipt.secondOpenMinutes !== windows[1].openMinutes ||
    receipt.openMinutesBasis !== 'opening_local_date' ||
    receipt.firstStartsAt !== windows[0].startsAt.replace('.000Z', '.000000Z') ||
    receipt.firstEndsAt !== windows[0].endsAt.replace('.000Z', '.000000Z') ||
    receipt.secondStartsAt !== windows[1].startsAt.replace('.000Z', '.000000Z') ||
    receipt.secondEndsAt !== windows[1].endsAt.replace('.000Z', '.000000Z') ||
    Date.parse(receipt.secondEndsAt) > Date.parse(receipt.capturedAt) ||
    !Array.isArray(receipt.sourceEvents) ||
    !Number.isSafeInteger(receipt.sourceEventCount) ||
    receipt.sourceEventCount !== receipt.sourceEvents.length ||
    receipt.sourceEventCount > 1000 ||
    !Number.isSafeInteger(receipt.firstEventCount) || receipt.firstEventCount < 0 ||
    !Number.isSafeInteger(receipt.secondEventCount) || receipt.secondEventCount < 0 ||
    receipt.firstEventCount + receipt.secondEventCount !== receipt.sourceEventCount ||
    !DIGEST.test(receipt.sourceSnapshotDigest || '') ||
    !exact(receipt.coverage, ['state', 'scope', 'startsAt',
      'providerCoverageVerified', 'wholeBusinessCoverageVerified',
      'areaObservationCoverageVerified']) ||
    receipt.coverage.state !== 'complete' ||
    receipt.coverage.scope !== 'northstar_m24_decision_ledger' ||
    !INSTANT.test(receipt.coverage.startsAt || '') ||
    Date.parse(receipt.coverage.startsAt) >= Date.parse(receipt.firstStartsAt) ||
    receipt.coverage.providerCoverageVerified !== false ||
    receipt.coverage.wholeBusinessCoverageVerified !== false ||
    receipt.coverage.areaObservationCoverageVerified !== false) {
    throw new Error('Invalid comparable-month v2 receipt');
  }
  let first = 0;
  let second = 0;
  let previous = 0;
  for (const event of receipt.sourceEvents) {
    if (!exact(event, ['estimateId', 'decisionId', 'revision', 'action', 'digest',
      'sourceOrder', 'sourceObservedAt', 'commitObservedAt', 'period']) ||
      !UUID.test(event.estimateId || '') || !UUID.test(event.decisionId || '') ||
      !Number.isSafeInteger(event.revision) || event.revision < 1 ||
      !['approve', 'withdraw'].includes(event.action) || !DIGEST.test(event.digest || '') ||
      !Number.isSafeInteger(event.sourceOrder) || event.sourceOrder <= previous ||
      !INSTANT.test(event.sourceObservedAt || '') ||
      !INSTANT.test(event.commitObservedAt || '') ||
      !['first', 'second'].includes(event.period)) {
      throw new Error('Invalid comparable-month v2 source event');
    }
    const window = event.period === 'first' ? windows[0] : windows[1];
    if (Date.parse(event.sourceObservedAt) < Date.parse(window.startsAt) ||
        Date.parse(event.sourceObservedAt) >= Date.parse(window.endsAt) ||
        Date.parse(event.commitObservedAt) >= Date.parse(window.endsAt)) {
      throw new Error('Comparable-month event is outside its reporting window');
    }
    previous = event.sourceOrder;
    if (event.period === 'first') first += 1;
    else second += 1;
  }
  if (first !== receipt.firstEventCount || second !== receipt.secondEventCount) {
    throw new Error('Comparable-month v2 counts changed');
  }
  return receipt;
}

function validateWindows(windows, organizationId) {
  if (!Array.isArray(windows) || windows.length !== 2) {
    throw new Error('Comparable-month windows are invalid');
  }
  windows.forEach(validateReportingWindow);
  const comparison = compareReportingWindows(windows[0], windows[1]);
  if (windows.some(window => window.organizationId !== organizationId ||
      window.grain !== 'month' || window.serviceKey !== null ||
      window.areaScope !== 'tenant_all' || window.areaDigest !== null ||
      window.calendarState !== 'known') ||
      windows[0].businessProfileId !== windows[1].businessProfileId ||
      windows[0].businessProfileVersion !== windows[1].businessProfileVersion ||
      windows[0].businessProfileHash !== windows[1].businessProfileHash ||
      windows[0].endsAt > windows[1].startsAt || !comparison.comparableContext) {
    throw new Error('Comparable-month context is invalid');
  }
  return comparison;
}

function project(receipt, windows, comparison, state, replayed) {
  return Object.freeze({
    state,
    reason: state === 'stale' ? 'source_changed' : null,
    receiptId: receipt.id,
    capturedAt: receipt.capturedAt,
    sourceScope: receipt.sourceScope,
    targetKey: receipt.targetKey,
    windows: Object.freeze(windows.map(window => Object.freeze({ ...window }))),
    normalizationRequired: comparison.normalizationRequired,
    normalizationDimensions: Object.freeze([
      ...(windows[0].elapsedMinutes !== windows[1].elapsedMinutes ? ['elapsed_minutes'] : []),
      ...(windows[0].openMinutes !== windows[1].openMinutes ? ['open_minutes'] : []),
      ...(windows[0].calendarDigest !== windows[1].calendarDigest ?
        ['calendar_revision'] : []),
    ]),
    periods: Object.freeze([
      Object.freeze({ sourceDecisionCount: receipt.firstEventCount,
        completeSelectedSourceZero: receipt.firstEventCount === 0 }),
      Object.freeze({ sourceDecisionCount: receipt.secondEventCount,
        completeSelectedSourceZero: receipt.secondEventCount === 0 }),
    ]),
    sourceEventCount: receipt.sourceEventCount,
    sourceSnapshotDigest: receipt.sourceSnapshotDigest,
    replayed,
    sourceCurrent: state === 'current',
    historicalCalendarVerified: true,
    observationCoverageVerified: true,
    selectedSourceCoverageVerified: true,
    areaObservationCoverageVerified: false,
    providerCoverageVerified: false,
    wholeBusinessCoverageVerified: false,
    targetComplete: true,
    eligibleForForecast: false,
    forecastIssued: false,
  });
}

function captureView(value, organizationId, profileAnchorId, windows) {
  const comparison = validateWindows(windows, organizationId);
  if (value?.state === 'unavailable') {
    if (!exact(value, ['state', 'reason', 'receipt', 'replayed']) ||
      typeof value.reason !== 'string' || !value.reason || value.receipt !== null ||
      value.replayed !== false) throw new Error('Invalid unavailable comparable-month receipt');
    return Object.freeze({ state: 'unavailable', reason: value.reason, receiptId: null,
      windows: null, replayed: false, sourceCurrent: false,
      historicalCalendarVerified: false, observationCoverageVerified: false,
      selectedSourceCoverageVerified: false, areaObservationCoverageVerified: false,
      providerCoverageVerified: false, wholeBusinessCoverageVerified: false,
      targetComplete: false, eligibleForForecast: false, forecastIssued: false });
  }
  if (!exact(value, ['state', 'receipt', 'replayed', 'sourceCurrent']) ||
    value.state !== 'complete' || (value.replayed !== true && value.replayed !== false) ||
    (value.sourceCurrent !== true && value.sourceCurrent !== false) ||
    (!value.replayed && !value.sourceCurrent)) {
    throw new Error('Invalid complete comparable-month capture');
  }
  const receipt = normalizeReceipt(value.receipt, organizationId, profileAnchorId, windows);
  return project(receipt, windows, comparison,
    value.sourceCurrent ? 'current' : 'stale', value.replayed);
}

function readView(value, organizationId, profileAnchorId, windows) {
  const comparison = validateWindows(windows, organizationId);
  if (!exact(value, ['state', 'sourceCurrent', 'receipt',
    'eligibleForForecast', 'forecastIssued']) ||
    !['current', 'stale'].includes(value.state) ||
    value.sourceCurrent !== (value.state === 'current') ||
    value.eligibleForForecast !== false || value.forecastIssued !== false) {
    throw new Error('Invalid comparable-month currentness');
  }
  const receipt = normalizeReceipt(value.receipt, organizationId, profileAnchorId, windows);
  return project(receipt, windows, comparison, value.state, false);
}

module.exports = { captureView, readView };
