'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const TRANSITIONS = new Set(['start', 'pause', 'resume']);
const LABOR_ACTIONS = new Set(['start_timer', 'stop_timer', 'record_manual', 'correct', 'review']);
const LABOR_CATEGORIES = new Set(['break', 'cleanup', 'other', 'production', 'setup', 'travel']);
const LABOR_CATEGORY_CONTRACT_VERSION = 'm23-labor-category-v1';
const LABOR_CATEGORY_CONTRACT_DIGEST = '298ead37057f362ae32de59f23cfda8e9cae8f78dd0cd1e9c637cc525bc27738';
const MATERIAL_ACTIONS = new Set(['record', 'correct', 'review', 'reverse']);
const MATERIAL_MOVEMENT_KINDS = new Set(['adjustment', 'consumed', 'returned', 'transferred', 'waste']);
const MATERIAL_UNIT_CONTRACT_VERSION = 'm23-material-unit-v1';
const MATERIAL_UNIT_CONTRACT_DIGEST = '8fcbf0c5a646dbd199e6fa8a93f863d851fab24d83c7a819ed65573c22761eba';
const MAXIMUM_BODY_BYTES = 32 * 1024;

class FieldExecutionContractError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'FieldExecutionContractError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new FieldExecutionContractError(status, code, message);
}

function exactObject(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.has(key))) {
    fail(400, code, 'Field execution request is invalid.');
  }
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch (_error) { bytes = Infinity; }
  if (bytes > MAXIMUM_BODY_BYTES) {
    fail(413, 'M23_EXECUTION_BODY_TOO_LARGE', 'Field execution request exceeds the 32768-byte limit.');
  }
  return value;
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function uuid(value, code, label) {
  if (typeof value !== 'string' || value !== value.trim() || !UUID.test(value)) {
    fail(400, code, `${label} is invalid.`);
  }
  return value.toLowerCase();
}

function digest(value, code, label) {
  if (typeof value !== 'string' || value !== value.trim() || !DIGEST.test(value)) {
    fail(400, code, `${label} is invalid.`);
  }
  return value;
}

function revision(value, code, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(400, code, `${label} is invalid.`);
  }
  return value;
}

function reason(value) {
  if (typeof value !== 'string') {
    fail(400, 'INVALID_EXECUTION_REASON', 'Field execution reason is invalid.');
  }
  const normalized = value.normalize('NFC');
  if (normalized !== value || value !== value.trim() || !value ||
      Array.from(value).length > 1000 || Buffer.byteLength(value, 'utf8') > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail(400, 'INVALID_EXECUTION_REASON', 'Field execution reason is invalid.');
  }
  return value;
}

function idempotencyKey(value) {
  if (typeof value !== 'string' || value !== value.trim() ||
      value.length < 16 || value.length > 128 || /[^\x21-\x7e]/.test(value)) {
    fail(400, 'INVALID_IDEMPOTENCY_KEY', 'A bounded canonical Idempotency-Key is required.');
  }
  return value;
}

function actionCode(value) {
  if (typeof value !== 'string' || !LABOR_ACTIONS.has(value)) {
    fail(400, 'INVALID_LABOR_ACTION', 'Labor evidence action is invalid.');
  }
  return value;
}

function category(value) {
  if (typeof value !== 'string' || !LABOR_CATEGORIES.has(value)) {
    fail(400, 'INVALID_LABOR_CATEGORY', 'Labor category is invalid.');
  }
  return value;
}

function exactInstant(value, code, label) {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 64 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    fail(400, code, `${label} is invalid.`);
  }
  return value;
}

function timeZone(value) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > 255 ||
      !/^[A-Za-z0-9_+\-/]+$/.test(value)) {
    fail(400, 'INVALID_LABOR_TIME_ZONE', 'Labor time-zone authority is invalid.');
  }
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); } catch (_error) {
    fail(400, 'INVALID_LABOR_TIME_ZONE', 'Labor time-zone authority is invalid.');
  }
  return value;
}

function reviewOutcome(value) {
  if (!['accepted', 'rejected'].includes(value)) {
    fail(400, 'INVALID_LABOR_REVIEW', 'Labor review outcome is invalid.');
  }
  return value;
}

function materialKey(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,63}$/.test(value)) {
    fail(400, 'INVALID_MATERIAL_KEY', 'Material identity evidence is invalid.');
  }
  return value;
}

function materialText(value) {
  if (typeof value !== 'string' || value !== value.trim() || value !== value.normalize('NFC') ||
      Array.from(value).length < 1 || Array.from(value).length > 500 ||
      Buffer.byteLength(value, 'utf8') > 2000 ||
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u.test(value)) {
    fail(400, 'INVALID_MATERIAL_TEXT', 'Material description evidence is invalid.');
  }
  return value;
}

function materialQuantity(value) {
  if (typeof value !== 'string' ||
      !/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(value)) {
    fail(400, 'INVALID_MATERIAL_QUANTITY', 'Material quantity evidence is invalid.');
  }
  const [whole, fraction = ''] = value.split('.');
  if (BigInt(whole + fraction.padEnd(6, '0')) === 0n) {
    fail(400, 'INVALID_MATERIAL_QUANTITY', 'Material quantity evidence is invalid.');
  }
  return value;
}

function normalizeMaterialAction(input) {
  const body = exactObject(input && input.body, new Set([
    'action', 'performerProfileId', 'movementKind', 'itemKey', 'description', 'quantity',
    'unitCode', 'unitContractVersion', 'unitContractDigest', 'locationKey',
    'destinationLocationKey', 'lotCode', 'adjustmentDirection', 'movementId',
    'expectedMovementRevision', 'expectedMovementDigest', 'reviewOutcome',
    'expectedExecutionRevision', 'expectedExecutionDigest', 'expectedAssignmentRevision',
    'expectedAssignmentDigest', 'reason',
  ]), 'INVALID_MATERIAL_ACTION');
  const common = [
    'action', 'performerProfileId', 'unitContractVersion', 'unitContractDigest',
    'expectedExecutionRevision', 'expectedExecutionDigest', 'expectedAssignmentRevision',
    'expectedAssignmentDigest', 'reason',
  ];
  if (common.some(key => !has(body, key))) {
    fail(428, 'M23_MATERIAL_PRECONDITION_REQUIRED',
      'Exact execution, assignment, unit, reason, and idempotency evidence are required.');
  }
  if (typeof body.action !== 'string' || !MATERIAL_ACTIONS.has(body.action)) {
    fail(400, 'INVALID_MATERIAL_ACTION', 'Material evidence action is invalid.');
  }
  if (body.unitContractVersion !== MATERIAL_UNIT_CONTRACT_VERSION ||
      body.unitContractDigest !== MATERIAL_UNIT_CONTRACT_DIGEST) {
    fail(409, 'M23_MATERIAL_UNIT_CONTRACT_STALE',
      'Material unit authority changed; refresh before trying again.');
  }
  const writesMaterial = ['record', 'correct'].includes(body.action);
  const needsExisting = ['correct', 'review', 'reverse'].includes(body.action);
  const materialFields = ['movementKind', 'itemKey', 'description', 'quantity', 'unitCode'];
  const optionalMaterialFields = ['locationKey', 'destinationLocationKey', 'lotCode', 'adjustmentDirection'];
  if ((writesMaterial && materialFields.some(key => !has(body, key))) ||
      (needsExisting && ['movementId', 'expectedMovementRevision', 'expectedMovementDigest']
        .some(key => !has(body, key))) ||
      (body.action === 'review' && !has(body, 'reviewOutcome'))) {
    fail(428, 'M23_MATERIAL_PRECONDITION_REQUIRED',
      'The material action is missing required exact evidence.');
  }
  if ((!writesMaterial && [...materialFields, ...optionalMaterialFields].some(key => has(body, key))) ||
      (!needsExisting && ['movementId', 'expectedMovementRevision', 'expectedMovementDigest']
        .some(key => has(body, key))) ||
      (body.action !== 'review' && has(body, 'reviewOutcome'))) {
    fail(400, 'INVALID_MATERIAL_ACTION', 'Material action contains fields that do not apply.');
  }
  let movementKind = null;
  let adjustmentDirection = null;
  let locationKey = null;
  let destinationLocationKey = null;
  if (writesMaterial) {
    if (typeof body.movementKind !== 'string' || !MATERIAL_MOVEMENT_KINDS.has(body.movementKind)) {
      fail(400, 'INVALID_MATERIAL_ACTION', 'Material movement kind is invalid.');
    }
    movementKind = body.movementKind;
    locationKey = has(body, 'locationKey') ? materialKey(body.locationKey) : null;
    destinationLocationKey = has(body, 'destinationLocationKey')
      ? materialKey(body.destinationLocationKey) : null;
    if (movementKind === 'transferred') {
      if ((locationKey === null) !== (destinationLocationKey === null) ||
          (locationKey !== null && locationKey === destinationLocationKey)) {
        fail(400, 'INVALID_MATERIAL_ACTION', 'Material transfer location evidence is invalid.');
      }
    } else if (destinationLocationKey !== null) {
      fail(400, 'INVALID_MATERIAL_ACTION', 'Destination location applies only to a transfer.');
    }
    if (movementKind === 'adjustment') {
      if (!has(body, 'adjustmentDirection')) {
        fail(428, 'M23_MATERIAL_PRECONDITION_REQUIRED',
          'An explicit material adjustment direction is required.');
      }
      if (!['increase', 'decrease'].includes(body.adjustmentDirection)) {
        fail(400, 'INVALID_MATERIAL_ACTION', 'Material adjustment direction is invalid.');
      }
      adjustmentDirection = body.adjustmentDirection;
    } else if (has(body, 'adjustmentDirection')) {
      fail(400, 'INVALID_MATERIAL_ACTION', 'Adjustment direction applies only to an adjustment.');
    }
  }
  return Object.freeze({
    ...trustedActor(input),
    executionId: uuid(input && input.executionId, 'INVALID_EXECUTION_ID', 'Field execution'),
    action: body.action,
    performerProfileId: uuid(body.performerProfileId, 'INVALID_MATERIAL_PERFORMER', 'Material performer'),
    movementKind,
    itemKey: writesMaterial ? materialKey(body.itemKey) : null,
    description: writesMaterial ? materialText(body.description) : null,
    quantity: writesMaterial ? materialQuantity(body.quantity) : null,
    unitCode: writesMaterial ? materialKey(body.unitCode) : null,
    unitContractVersion: body.unitContractVersion,
    unitContractDigest: digest(body.unitContractDigest,
      'INVALID_MATERIAL_UNIT_CONTRACT', 'Material unit contract digest'),
    locationKey,
    destinationLocationKey,
    lotCode: writesMaterial && has(body, 'lotCode') ? materialKey(body.lotCode) : null,
    adjustmentDirection,
    movementId: needsExisting
      ? uuid(body.movementId, 'INVALID_MATERIAL_MOVEMENT', 'Material movement') : null,
    expectedMovementRevision: needsExisting
      ? revision(body.expectedMovementRevision, 'INVALID_MATERIAL_PRECONDITION', 'Expected movement revision') : null,
    expectedMovementDigest: needsExisting
      ? digest(body.expectedMovementDigest, 'INVALID_MATERIAL_PRECONDITION', 'Expected movement digest') : null,
    reviewOutcome: body.action === 'review' ? reviewOutcome(body.reviewOutcome) : null,
    expectedExecutionRevision: revision(body.expectedExecutionRevision,
      'INVALID_MATERIAL_SOURCE_PIN', 'Expected execution revision'),
    expectedExecutionDigest: digest(body.expectedExecutionDigest,
      'INVALID_MATERIAL_SOURCE_PIN', 'Expected execution digest'),
    expectedAssignmentRevision: revision(body.expectedAssignmentRevision,
      'INVALID_MATERIAL_SOURCE_PIN', 'Expected assignment revision'),
    expectedAssignmentDigest: digest(body.expectedAssignmentDigest,
      'INVALID_MATERIAL_SOURCE_PIN', 'Expected assignment digest'),
    reason: reason(body.reason),
    idempotencyKey: idempotencyKey(input && input.idempotencyKey),
  });
}

function normalizeLaborAction(input) {
  const body = exactObject(input && input.body, new Set([
    'action', 'performerProfileId', 'category', 'categoryContractVersion',
    'categoryContractDigest', 'expectedExecutionRevision', 'expectedExecutionDigest',
    'expectedAssignmentRevision', 'expectedAssignmentDigest', 'businessProfileId',
    'businessProfileVersion', 'businessProfileHash', 'timeZone', 'observedStart',
    'observedEnd', 'intervalId', 'expectedIntervalRevision', 'expectedIntervalDigest',
    'reviewOutcome', 'reason',
  ]), 'INVALID_LABOR_ACTION');
  const common = [
    'action', 'performerProfileId', 'categoryContractVersion', 'categoryContractDigest',
    'expectedExecutionRevision', 'expectedExecutionDigest', 'expectedAssignmentRevision',
    'expectedAssignmentDigest', 'businessProfileId', 'businessProfileVersion',
    'businessProfileHash', 'timeZone', 'reason',
  ];
  if (common.some(key => !has(body, key))) {
    fail(428, 'M23_LABOR_PRECONDITION_REQUIRED',
      'Exact execution, assignment, category, time-zone, reason, and idempotency evidence are required.');
  }
  const action = actionCode(body.action);
  if (body.categoryContractVersion !== LABOR_CATEGORY_CONTRACT_VERSION ||
      body.categoryContractDigest !== LABOR_CATEGORY_CONTRACT_DIGEST) {
    fail(409, 'M23_LABOR_CATEGORY_CONTRACT_STALE',
      'Labor category authority changed; refresh before trying again.');
  }
  const needsCategory = ['start_timer', 'record_manual', 'correct'].includes(action);
  const needsInterval = ['stop_timer', 'correct', 'review'].includes(action);
  const needsManualTimes = ['record_manual', 'correct'].includes(action);
  if ((needsCategory && !has(body, 'category')) || (needsInterval &&
      ['intervalId', 'expectedIntervalRevision', 'expectedIntervalDigest'].some(key => !has(body, key))) ||
      (needsManualTimes && ['observedStart', 'observedEnd'].some(key => !has(body, key))) ||
      (action === 'review' && !has(body, 'reviewOutcome'))) {
    fail(428, 'M23_LABOR_PRECONDITION_REQUIRED', 'The labor action is missing required exact evidence.');
  }
  if ((!needsCategory && has(body, 'category')) || (!needsInterval &&
      ['intervalId', 'expectedIntervalRevision', 'expectedIntervalDigest'].some(key => has(body, key))) ||
      (!needsManualTimes && ['observedStart', 'observedEnd'].some(key => has(body, key))) ||
      (action !== 'review' && has(body, 'reviewOutcome'))) {
    fail(400, 'INVALID_LABOR_ACTION', 'Labor action contains fields that do not apply.');
  }
  return Object.freeze({
    ...trustedActor(input),
    executionId: uuid(input && input.executionId, 'INVALID_EXECUTION_ID', 'Field execution'),
    action,
    performerProfileId: uuid(body.performerProfileId, 'INVALID_LABOR_PERFORMER', 'Labor performer'),
    category: needsCategory ? category(body.category) : null,
    categoryContractVersion: body.categoryContractVersion,
    categoryContractDigest: digest(body.categoryContractDigest,
      'INVALID_LABOR_CATEGORY_CONTRACT', 'Labor category contract digest'),
    expectedExecutionRevision: revision(body.expectedExecutionRevision,
      'INVALID_LABOR_SOURCE_PIN', 'Expected execution revision'),
    expectedExecutionDigest: digest(body.expectedExecutionDigest,
      'INVALID_LABOR_SOURCE_PIN', 'Expected execution digest'),
    expectedAssignmentRevision: revision(body.expectedAssignmentRevision,
      'INVALID_LABOR_SOURCE_PIN', 'Expected assignment revision'),
    expectedAssignmentDigest: digest(body.expectedAssignmentDigest,
      'INVALID_LABOR_SOURCE_PIN', 'Expected assignment digest'),
    businessProfileId: uuid(body.businessProfileId, 'INVALID_LABOR_TIME_AUTHORITY', 'Business Profile'),
    businessProfileVersion: revision(body.businessProfileVersion,
      'INVALID_LABOR_TIME_AUTHORITY', 'Business Profile version'),
    businessProfileHash: digest(body.businessProfileHash,
      'INVALID_LABOR_TIME_AUTHORITY', 'Business Profile hash'),
    timeZone: timeZone(body.timeZone),
    observedStart: needsManualTimes ? exactInstant(body.observedStart,
      'INVALID_LABOR_INSTANT', 'Observed start') : null,
    observedEnd: needsManualTimes ? exactInstant(body.observedEnd,
      'INVALID_LABOR_INSTANT', 'Observed end') : null,
    intervalId: needsInterval ? uuid(body.intervalId, 'INVALID_LABOR_INTERVAL', 'Labor interval') : null,
    expectedIntervalRevision: needsInterval ? revision(body.expectedIntervalRevision,
      'INVALID_LABOR_PRECONDITION', 'Expected labor interval revision') : null,
    expectedIntervalDigest: needsInterval ? digest(body.expectedIntervalDigest,
      'INVALID_LABOR_PRECONDITION', 'Expected labor interval digest') : null,
    reviewOutcome: action === 'review' ? reviewOutcome(body.reviewOutcome) : null,
    reason: reason(body.reason),
    idempotencyKey: idempotencyKey(input && input.idempotencyKey),
  });
}

function trustedActor(input) {
  return Object.freeze({
    organizationId: uuid(input && input.organizationId, 'INVALID_EXECUTION_ORGANIZATION', 'Organization'),
    actorUserId: uuid(input && input.actorUserId, 'INVALID_EXECUTION_ACTOR', 'Execution actor'),
    actorAccessRole: String(input && input.actorAccessRole || ''),
    authSessionId: uuid(input && input.authSessionId, 'INVALID_EXECUTION_SESSION', 'Execution session'),
  });
}

function normalizeInitialization(input) {
  const body = exactObject(input && input.body, new Set([
    'expectedAssignmentRevision', 'expectedAssignmentDigest', 'reason',
  ]), 'INVALID_EXECUTION_INITIALIZATION');
  if (['expectedAssignmentRevision', 'expectedAssignmentDigest', 'reason'].some(key => !has(body, key))) {
    fail(428, 'M23_EXECUTION_PRECONDITION_REQUIRED',
      'Exact assignment revision, assignment digest, reason, and idempotency evidence are required.');
  }
  return Object.freeze({
    ...trustedActor(input),
    appointmentId: uuid(input && input.appointmentId, 'INVALID_EXECUTION_APPOINTMENT', 'Appointment'),
    expectedAssignmentRevision: revision(body.expectedAssignmentRevision,
      'INVALID_EXECUTION_SOURCE_PIN', 'Expected assignment revision'),
    expectedAssignmentDigest: digest(body.expectedAssignmentDigest,
      'INVALID_EXECUTION_SOURCE_PIN', 'Expected assignment digest'),
    reason: reason(body.reason),
    idempotencyKey: idempotencyKey(input && input.idempotencyKey),
  });
}

function normalizeTransition(input) {
  const body = exactObject(input && input.body, new Set([
    'action', 'expectedRevision', 'expectedDigest',
    'expectedAssignmentRevision', 'expectedAssignmentDigest', 'reason',
  ]), 'INVALID_EXECUTION_TRANSITION');
  if (['action', 'expectedRevision', 'expectedDigest', 'expectedAssignmentRevision',
    'expectedAssignmentDigest', 'reason'].some(key => !has(body, key))) {
    fail(428, 'M23_EXECUTION_PRECONDITION_REQUIRED',
      'Exact execution and assignment pins, action, reason, and idempotency evidence are required.');
  }
  if (!TRANSITIONS.has(body.action)) {
    fail(400, 'INVALID_EXECUTION_ACTION', 'Field execution action is invalid.');
  }
  return Object.freeze({
    ...trustedActor(input),
    executionId: uuid(input && input.executionId, 'INVALID_EXECUTION_ID', 'Field execution'),
    action: body.action,
    expectedRevision: revision(body.expectedRevision,
      'INVALID_EXECUTION_PRECONDITION', 'Expected execution revision'),
    expectedDigest: digest(body.expectedDigest,
      'INVALID_EXECUTION_PRECONDITION', 'Expected execution digest'),
    expectedAssignmentRevision: revision(body.expectedAssignmentRevision,
      'INVALID_EXECUTION_SOURCE_PIN', 'Expected assignment revision'),
    expectedAssignmentDigest: digest(body.expectedAssignmentDigest,
      'INVALID_EXECUTION_SOURCE_PIN', 'Expected assignment digest'),
    reason: reason(body.reason),
    idempotencyKey: idempotencyKey(input && input.idempotencyKey),
  });
}

function normalizeExecutionId(value) {
  return uuid(value, 'INVALID_EXECUTION_ID', 'Field execution');
}

module.exports = {
  DIGEST,
  FieldExecutionContractError,
  LABOR_ACTIONS,
  LABOR_CATEGORIES,
  LABOR_CATEGORY_CONTRACT_DIGEST,
  LABOR_CATEGORY_CONTRACT_VERSION,
  MATERIAL_ACTIONS,
  MATERIAL_MOVEMENT_KINDS,
  MATERIAL_UNIT_CONTRACT_DIGEST,
  MATERIAL_UNIT_CONTRACT_VERSION,
  MAXIMUM_BODY_BYTES,
  TRANSITIONS,
  UUID,
  normalizeExecutionId,
  normalizeInitialization,
  normalizeLaborAction,
  normalizeMaterialAction,
  normalizeTransition,
};
