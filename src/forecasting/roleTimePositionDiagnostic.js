'use strict';

// Pure Part 5B prerequisite. Inputs are claimed M20/M22 as-of evidence;
// an owning reader must authenticate them before this can feed a forecast.
const VERSION = 'm26-role-time-position-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_WORKERS = 100;
const MAX_INTERVALS = 4096;
const MAX_WINDOW_MS = 31 * 24 * 60 * 60000;

function invalid() {
  const error = new Error('Role time position details are invalid.');
  error.code = 'M26_ROLE_TIME_POSITION_INVALID';
  throw error;
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

function dense(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false;
  }
  return true;
}

function instant(value, minuteAligned = false) {
  if (typeof value !== 'string' || !INSTANT.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value &&
    (!minuteAligned || milliseconds % 60000 === 0);
}

function intervals(value) {
  if (!dense(value, MAX_INTERVALS)) invalid();
  return value.map(interval => {
    if (!exact(interval, ['startsAt', 'endsAt']) ||
        !instant(interval.startsAt, true) || !instant(interval.endsAt, true) ||
        interval.startsAt >= interval.endsAt ||
        Date.parse(interval.endsAt) - Date.parse(interval.startsAt) > MAX_WINDOW_MS) invalid();
    return [Date.parse(interval.startsAt), Date.parse(interval.endsAt)];
  });
}

function union(ranges) {
  const ordered = ranges.slice().sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  for (const [start, end] of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function intersection(left, right) {
  const result = [];
  let first = 0, second = 0;
  while (first < left.length && second < right.length) {
    const start = Math.max(left[first][0], right[second][0]);
    const end = Math.min(left[first][1], right[second][1]);
    if (start < end) result.push([start, end]);
    if (left[first][1] < right[second][1]) first += 1;
    else second += 1;
  }
  return result;
}

function subtract(base, blocked) {
  const result = [];
  let index = 0;
  for (const [start, end] of base) {
    let cursor = start;
    while (index < blocked.length && blocked[index][1] <= cursor) index += 1;
    for (let next = index; next < blocked.length && blocked[next][0] < end; next += 1) {
      if (blocked[next][0] > cursor) result.push([cursor, Math.min(blocked[next][0], end)]);
      cursor = Math.max(cursor, blocked[next][1]);
      if (cursor >= end) break;
    }
    if (cursor < end) result.push([cursor, end]);
  }
  return result;
}

function availableMinutes(worker, start, end) {
  const working = intervals(worker.workingIntervals);
  const declared = intervals(worker.declaredAvailableIntervals);
  const unavailable = intervals(worker.declaredUnavailableIntervals);
  const committed = intervals(worker.approvedCommitmentIntervals);
  const open = intersection(union(working), union(declared))
    .map(([left, right]) => [Math.max(left, start), Math.min(right, end)])
    .filter(([left, right]) => left < right);
  const remaining = subtract(open, union([...unavailable, ...committed]));
  const minutes = remaining.reduce((total, [left, right]) =>
    total + (right - left) / 60000, 0);
  return { minutes, intervalCount: working.length + declared.length +
    unavailable.length + committed.length };
}

function result(input, state, reason, count, eligible, minutes) {
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, horizon: Object.freeze({ ...input.horizon }), roleKey: input.roleKey,
    sourceSnapshotDigest: input.sourceSnapshotDigest, state, reason,
    declaredUncommittedPersonMinutes: minutes, reviewedWorkerCount: count,
    eligibleWorkerCount: eligible, sourceAuthenticated: false,
    forecastIssued: false, resourceConstraintsChecked: false });
}

function summarizeRoleTimePosition(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'horizon', 'roleKey',
    'sourceSnapshotDigest', 'coverage', 'workers']) || input.version !== VERSION ||
    typeof input.organizationId !== 'string' || !UUID.test(input.organizationId) ||
    !instant(input.asOf) || !exact(input.horizon, ['startsAt', 'endsAt']) ||
    !instant(input.horizon.startsAt, true) || !instant(input.horizon.endsAt, true) ||
    input.horizon.startsAt < input.asOf || input.horizon.startsAt >= input.horizon.endsAt ||
    Date.parse(input.horizon.endsAt) - Date.parse(input.horizon.startsAt) > MAX_WINDOW_MS ||
    typeof input.roleKey !== 'string' || input.roleKey.length > 80 || !TOKEN.test(input.roleKey) ||
    typeof input.sourceSnapshotDigest !== 'string' || !DIGEST.test(input.sourceSnapshotDigest) ||
    !exact(input.coverage, ['state', 'recordedThrough', 'hasMore']) ||
    !['complete', 'incomplete', 'revoked'].includes(input.coverage.state) ||
    !instant(input.coverage.recordedThrough) || typeof input.coverage.hasMore !== 'boolean' ||
    !dense(input.workers, MAX_WORKERS)) invalid();

  const seen = new Set();
  const start = Date.parse(input.horizon.startsAt), end = Date.parse(input.horizon.endsAt);
  let minutes = 0, eligible = 0, intervalCount = 0, unresolved = false;
  for (const worker of input.workers) {
    if (!exact(worker, ['workerId', 'organizationId', 'revision', 'digest', 'recordedAt',
      'employmentState', 'qualificationState', 'workingIntervals',
      'declaredAvailableIntervals', 'declaredUnavailableIntervals',
      'approvedCommitmentIntervals']) || typeof worker.workerId !== 'string' ||
      !UUID.test(worker.workerId) || seen.has(worker.workerId) ||
      worker.organizationId !== input.organizationId ||
      !Number.isSafeInteger(worker.revision) || worker.revision < 1 ||
      typeof worker.digest !== 'string' || !DIGEST.test(worker.digest) ||
      !instant(worker.recordedAt) || worker.recordedAt > input.asOf ||
      !['active', 'inactive', 'unknown'].includes(worker.employmentState) ||
      !['qualified', 'not_qualified', 'unknown'].includes(worker.qualificationState)) invalid();
    seen.add(worker.workerId);
    const position = availableMinutes(worker, start, end);
    intervalCount += position.intervalCount;
    if (intervalCount > MAX_INTERVALS) invalid();
    if (worker.employmentState === 'unknown' || worker.qualificationState === 'unknown') {
      unresolved = true;
    } else if (worker.employmentState === 'active' && worker.qualificationState === 'qualified') {
      eligible += 1;
      minutes += position.minutes;
    }
  }
  if (input.coverage.state !== 'complete' || input.coverage.hasMore ||
      input.coverage.recordedThrough !== input.asOf) {
    return result(input, 'unavailable', 'incomplete_source_coverage', input.workers.length, null, null);
  }
  if (unresolved) return result(input, 'unavailable', 'unresolved_worker_basis', input.workers.length, null, null);
  return result(input, 'descriptive_only', null, input.workers.length, eligible, minutes);
}

module.exports = { VERSION, MAX_WORKERS, MAX_INTERVALS, summarizeRoleTimePosition };
