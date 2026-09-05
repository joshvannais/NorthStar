'use strict';

const crypto = require('crypto');
const { canonicalObject, canonicalStringify } = require('../knowledge/contract');
const VERSION = 'northstar.equipment.v1';
const FIELDS = Object.freeze(['manufacturer', 'model', 'modelYear', 'series', 'engine', 'configuration', 'attachments', 'accessType']);
const QUESTIONS = Object.freeze({
  manufacturer: 'What is the manufacturer shown on the equipment?',
  model: 'What is the exact model, as shown on its identification plate?',
  modelYear: 'What is the model year? Enter unknown if you cannot verify it.',
  series: 'What is the exact series or trim? Enter not applicable or unknown when appropriate.',
  engine: 'Which engine or power configuration does it have? Enter not applicable or unknown when appropriate.',
  configuration: 'What is its exact configuration (for example cab, drivetrain, wheelbase or machine variant)?',
  attachments: 'Which attachments do you actually use with this asset? Enter none or unknown when appropriate.',
  accessType: 'How do you access it: owned, leased, rented, borrowed, or unknown?',
});
const KINDS = Object.freeze(['check_out', 'use', 'check_in', 'reading', 'condition', 'fault', 'downtime_start', 'downtime_end', 'maintenance', 'meter_reset']);
const UNITS = Object.freeze(['hours', 'km', 'mi', 'percent', 'litres', 'gallons', 'count']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function error(status, code, message) { return Object.assign(new Error(message), { status, statusCode: status, code }); }
function invalid() { throw error(400, 'EQUIPMENT_INPUT_INVALID', 'Equipment information is invalid. Check the entered fields.'); }
function text(value, maximum = 500, empty = false) {
  if (typeof value !== 'string' || value !== value.normalize('NFC') || value !== value.trim() ||
      (!empty && !value) || Array.from(value).length > maximum || Buffer.byteLength(value) > maximum * 4 ||
      /[\p{Cc}\p{Cf}\p{Cs}\uFFF9-\uFFFC]/u.test(value)) invalid();
  return value;
}
function exact(value, keys, required = keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some(key => !keys.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) invalid();
  canonicalObject(value, 'equipment', 32768);
  return value;
}
function uuid(value) { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value.toLowerCase(); }
function digest(value) { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) invalid(); return value; }
function revision(value) { if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) invalid(); return value; }
function hash(value) { return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex'); }
function identifierValue(field, value) {
  text(value, field === 'attachments' || field === 'configuration' ? 500 : 120);
  if (field === 'modelYear' && value !== 'unknown' && !/^(18|19|20|21|22|23|24|25|26|27|28|29|30)\d{2}$/.test(value)) invalid();
  if (field === 'accessType' && !['owned', 'leased', 'rented', 'borrowed', 'unknown'].includes(value)) invalid();
  return value;
}
function normalizeDraft(input) {
  exact(input, ['entryPath', 'message', 'identifiers', 'useContext', 'target'], ['entryPath', 'message', 'identifiers', 'useContext']);
  if (!['business_profile', 'polaris'].includes(input.entryPath)) invalid();
  text(input.message, 1500, true); text(input.useContext, 500, true);
  exact(input.identifiers, FIELDS, []);
  for (const [key, value] of Object.entries(input.identifiers)) identifierValue(key, value);
  if (Object.hasOwn(input, 'target')) { exact(input.target, ['assetId', 'version', 'digest']); uuid(input.target.assetId); revision(input.target.version); digest(input.target.digest); }
  return input;
}
function normalizeDraftAction(input) {
  exact(input, ['action', 'expectedRevision', 'expectedDigest', 'answer', 'confirmation'], ['action', 'expectedRevision', 'expectedDigest']);
  revision(input.expectedRevision); digest(input.expectedDigest);
  if (input.action === 'answer') {
    if (Object.hasOwn(input, 'confirmation')) invalid();
    text(input.answer, 500);
  } else if (input.action === 'confirm') {
    if (input.confirmation !== 'save_reviewed_asset' || Object.hasOwn(input, 'answer')) invalid();
  } else if (input.action === 'cancel') {
    if (Object.hasOwn(input, 'answer') || Object.hasOwn(input, 'confirmation')) invalid();
  } else invalid();
  return input;
}
function publicIdentity(fields) {
  return Object.fromEntries(FIELDS.slice(0, 6).map(key => [key, fields[key] || 'unknown']));
}
function nextQuestion(fields) {
  const field = FIELDS.find(key => !Object.hasOwn(fields, key));
  return field ? { field, question: QUESTIONS[field] } : null;
}
function literalIdentifiers(raw, message) {
  exact(raw, FIELDS.slice(0, 6));
  const result = {};
  for (const key of FIELDS.slice(0, 6)) {
    if (raw[key] === null) continue;
    identifierValue(key, raw[key]);
    // Extraction cannot manufacture a specification from model memory.
    if (!message.includes(raw[key])) invalid();
    result[key] = raw[key];
  }
  return result;
}
function normalizeOperation(input) {
  const keys = ['action', 'assetId', 'assetVersion', 'assetDigest', 'knowledgeVersionId', 'knowledgeDigest',
    'expectedExecutionRevision', 'expectedExecutionDigest', 'expectedAssignmentRevision', 'expectedAssignmentDigest',
    'expectedAssetRevision', 'expectedAssetDigest', 'performerProfileId', 'kind', 'observedAt', 'meterKey', 'reading',
    'unit', 'description', 'reason', 'correctsEventId'];
  exact(input, keys);
  if (!['record', 'correct'].includes(input.action) || !KINDS.includes(input.kind)) invalid();
  uuid(input.assetId); revision(input.assetVersion); digest(input.assetDigest);
  uuid(input.knowledgeVersionId); digest(input.knowledgeDigest); uuid(input.performerProfileId);
  revision(input.expectedExecutionRevision); digest(input.expectedExecutionDigest);
  revision(input.expectedAssignmentRevision); digest(input.expectedAssignmentDigest);
  if (!Number.isInteger(input.expectedAssetRevision) || input.expectedAssetRevision < 0) invalid();
  if (input.expectedAssetRevision === 0) { if (input.expectedAssetDigest !== null) invalid(); }
  else digest(input.expectedAssetDigest);
  if (input.action === 'correct') uuid(input.correctsEventId);
  else if (input.correctsEventId !== null) invalid();
  text(input.reason, 500); text(input.description, 1000, true);
  if (typeof input.observedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(input.observedAt) || !Number.isFinite(Date.parse(input.observedAt))) invalid();
  if (input.reading !== null) {
    if (typeof input.reading !== 'string' || !/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,3})?$/.test(input.reading) || !UNITS.includes(input.unit)) invalid();
    text(input.meterKey, 80);
  } else if (input.unit !== null || input.meterKey !== null || ['reading', 'meter_reset'].includes(input.kind)) invalid();
  return input;
}
module.exports = { VERSION, FIELDS, QUESTIONS, KINDS, UNITS, error, exact, text, uuid, digest, revision,
  hash, identifierValue, normalizeDraft, normalizeDraftAction, publicIdentity, nextQuestion, literalIdentifiers, normalizeOperation };
