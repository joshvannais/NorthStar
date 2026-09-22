'use strict';

// Pure M26 Part 5B calendar prerequisite. Mission 22 retains the wall-time
// resolution policy. Company operating time is not worker availability.
const schedulingTime = require('../../public/js/scheduling-time-contract');
const { hoursForDate } = require('../scheduling/conflictEvaluator');

const VERSION = 'm26-operating-windows-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_WINDOW_MS = 31 * 86400000;

function invalid() {
  const failure = new Error('Operating window details are invalid.');
  failure.code = 'M26_OPERATING_WINDOW_INVALID';
  throw failure;
}

function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, 'value');
  });
}

function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function dateAtOffset(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function unavailable(input, reason) {
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    sourceSnapshotDigest: input.sourceSnapshotDigest, state: 'unavailable', reason,
    operatingIntervals: null, companyOperatingMinutes: null,
    sourceAuthenticated: false, workerAvailabilityVerified: false,
    forecastIssued: false });
}

function summarizeOperatingWindows(input) {
  if (!exact(input, ['version', 'organizationId', 'sourceSnapshotDigest',
    'horizon', 'timeZone', 'hours']) || input.version !== VERSION ||
      typeof input.organizationId !== 'string' || !UUID.test(input.organizationId) ||
      typeof input.sourceSnapshotDigest !== 'string' || !DIGEST.test(input.sourceSnapshotDigest) ||
      !exact(input.horizon, ['startsAt', 'endsAt']) ||
      !instant(input.horizon.startsAt) || !instant(input.horizon.endsAt) ||
      input.horizon.startsAt >= input.horizon.endsAt ||
      Date.parse(input.horizon.endsAt) - Date.parse(input.horizon.startsAt) > MAX_WINDOW_MS ||
      !schedulingTime.isValidTimeZone(input.timeZone) ||
      !input.hours || typeof input.hours !== 'object' || Array.isArray(input.hours) ||
      Object.getPrototypeOf(input.hours) !== Object.prototype) invalid();
  let serialized;
  try { serialized = JSON.stringify(input.hours); } catch (_) { invalid(); }
  if (typeof serialized !== 'string') invalid();
  const bytes = Buffer.byteLength(serialized);
  if (bytes > 32768) invalid();
  const hours = JSON.parse(serialized);
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) invalid();

  const start = Date.parse(input.horizon.startsAt);
  const end = Date.parse(input.horizon.endsAt);
  const first = schedulingTime.formatInstant(new Date(start), input.timeZone).date;
  const last = schedulingTime.formatInstant(new Date(end - 1), input.timeZone).date;
  let date = dateAtOffset(first, -1);
  const windows = [];
  for (let count = 0; date <= last && count < 34; count += 1) {
    const resolved = hoursForDate({ hours }, date, input.timeZone);
    if (!['known', 'closed'].includes(resolved.status)) {
      return unavailable(input, 'operating_hours_unresolved');
    }
    for (const window of resolved.windows) {
      const left = Math.max(start, window.start);
      const right = Math.min(end, window.end);
      if (left < right) windows.push([left, right]);
    }
    date = dateAtOffset(date, 1);
  }
  if (date <= last) return unavailable(input, 'operating_window_bounded');
  windows.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  for (const [left, right] of windows) {
    const previous = merged[merged.length - 1];
    if (previous && left <= previous[1]) previous[1] = Math.max(right, previous[1]);
    else merged.push([left, right]);
  }
  const minutes = merged.reduce((total, [left, right]) => total + (right - left) / 60000, 0);
  if (!Number.isSafeInteger(minutes)) return unavailable(input, 'operating_time_not_minute_aligned');
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    sourceSnapshotDigest: input.sourceSnapshotDigest, state: 'descriptive_only',
    reason: null, operatingIntervals: Object.freeze(merged.map(([left, right]) =>
      Object.freeze({ startsAt: new Date(left).toISOString(),
        endsAt: new Date(right).toISOString() }))),
    companyOperatingMinutes: minutes, sourceAuthenticated: false,
    workerAvailabilityVerified: false, forecastIssued: false });
}

module.exports = { VERSION, summarizeOperatingWindows };
