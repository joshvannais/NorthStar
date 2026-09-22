'use strict';

// Pure, unmounted Part 5A candidate. The owning M22/M23 readers must prove
// approval, current revision, completion, remaining-work basis and coverage.
// This module cannot authenticate a source or issue a future forecast.
const VERSION = 'm26-workload-position-diagnostic-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_RECORDS = 256;
const MAX_MINUTES = 10000000;

function invalid() {
  const error = new Error('Workload position details are invalid.');
  error.code = 'M26_WORKLOAD_POSITION_INVALID';
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

function dense(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > MAX_RECORDS || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return false;
  }
  return true;
}

function instant(value) {
  return typeof value === 'string' && INSTANT.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function unavailable(reason, count, input) {
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, sourceSnapshotDigest: input.sourceSnapshotDigest,
    state: 'unavailable', reason,
    scheduledPersonMinutes: null, unscheduledPersonMinutes: null,
    totalPersonMinutes: null, includedWorkCount: null, reviewedRecordCount: count,
    sourceAuthenticated: false, forecastIssued: false });
}

function summarizeWorkloadPosition(input) {
  if (!exact(input, ['version', 'organizationId', 'asOf', 'sourceSnapshotDigest',
    'coverage', 'records']) || input.version !== VERSION ||
    typeof input.organizationId !== 'string' || !UUID.test(input.organizationId) ||
    !instant(input.asOf) || typeof input.sourceSnapshotDigest !== 'string' ||
    !DIGEST.test(input.sourceSnapshotDigest) || !dense(input.records) ||
    !exact(input.coverage, ['state', 'recordedThrough', 'hasMore']) ||
    !['complete', 'incomplete', 'revoked'].includes(input.coverage.state) ||
    !instant(input.coverage.recordedThrough) ||
    typeof input.coverage.hasMore !== 'boolean') invalid();

  const seen = new Set();
  let scheduled = 0;
  let unscheduled = 0;
  let included = 0;
  let unresolved = false;
  for (const record of input.records) {
    if (!exact(record, ['workId', 'organizationId', 'revision', 'digest', 'recordedAt',
      'approvalState', 'scheduleState', 'progressState', 'remainingPersonMinutes',
      'remainingBasis']) || typeof record.workId !== 'string' || !UUID.test(record.workId) ||
      record.organizationId !== input.organizationId ||
      !Number.isSafeInteger(record.revision) || record.revision < 1 ||
      typeof record.digest !== 'string' || !DIGEST.test(record.digest) ||
      !instant(record.recordedAt) || record.recordedAt > input.asOf ||
      seen.has(record.workId) ||
      !['approved', 'unapproved', 'unknown'].includes(record.approvalState) ||
      !['scheduled', 'unscheduled', 'unknown'].includes(record.scheduleState) ||
      !['not_started', 'in_progress', 'accepted_complete', 'unknown'].includes(record.progressState) ||
      !(record.remainingPersonMinutes === null ||
        (Number.isSafeInteger(record.remainingPersonMinutes) &&
          record.remainingPersonMinutes >= 0 && record.remainingPersonMinutes <= MAX_MINUTES)) ||
      !['approved_plan', 'reviewed_remaining', null].includes(record.remainingBasis)) invalid();
    seen.add(record.workId);
    if (record.approvalState !== 'approved' ||
        (record.progressState !== 'accepted_complete' && record.scheduleState === 'unknown') ||
        record.progressState === 'unknown' || record.remainingPersonMinutes === null ||
        (record.progressState === 'accepted_complete' && record.remainingPersonMinutes !== 0) ||
        (record.progressState !== 'accepted_complete' &&
          (record.remainingBasis === null ||
            (record.progressState === 'in_progress' &&
              record.remainingBasis !== 'reviewed_remaining')))) {
      unresolved = true;
      continue;
    }
    if (record.progressState === 'accepted_complete') continue;
    included += 1;
    if (record.scheduleState === 'scheduled') scheduled += record.remainingPersonMinutes;
    else unscheduled += record.remainingPersonMinutes;
  }

  if (input.coverage.state !== 'complete' || input.coverage.hasMore ||
      input.coverage.recordedThrough !== input.asOf) {
    return unavailable('incomplete_source_coverage', input.records.length, input);
  }
  if (unresolved) return unavailable('unresolved_work_basis', input.records.length, input);
  return Object.freeze({ version: VERSION, organizationId: input.organizationId,
    asOf: input.asOf, sourceSnapshotDigest: input.sourceSnapshotDigest,
    state: 'descriptive_only', reason: null,
    scheduledPersonMinutes: scheduled, unscheduledPersonMinutes: unscheduled,
    totalPersonMinutes: scheduled + unscheduled, includedWorkCount: included,
    reviewedRecordCount: input.records.length,
    sourceAuthenticated: false, forecastIssued: false });
}

module.exports = { VERSION, MAX_RECORDS, summarizeWorkloadPosition };
