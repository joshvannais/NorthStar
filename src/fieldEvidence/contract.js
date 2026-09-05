'use strict';

const crypto = require('crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const RESULT_TYPES = new Set(['observation', 'measurement', 'pass', 'fail', 'unavailable', 'needs_review']);
const OBSERVATION_CLASSES = new Set(['inspection', 'quality', 'field_observation']);
const AD_HOC_TEMPLATE_VERSION = 'm23-checklist-ad-hoc-v1';
const AD_HOC_TEMPLATE_DIGEST = crypto.createHash('sha256')
  .update(AD_HOC_TEMPLATE_VERSION, 'utf8').digest('hex');
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_COUNT = 25;
const MAX_EXECUTION_FILE_BYTES = 100 * 1024 * 1024;
const COMMON_ACTION_FIELDS = Object.freeze([
  'action', 'performerProfileId', 'expectedExecutionRevision', 'expectedExecutionDigest',
  'expectedAssignmentRevision', 'expectedAssignmentDigest', 'reason',
]);
const ACTION_FIELDS = Object.freeze({
  create_checklist: Object.freeze(['template', 'items']),
  respond_item: Object.freeze(['checklistId', 'expectedChecklistRevision', 'expectedChecklistDigest', 'itemKey',
    'resultType', 'observation', 'measurement', 'exception', 'supportingEvidenceIds']),
  record_observation: Object.freeze(['observationClass', 'resultType', 'observation', 'measurement', 'exception', 'supportingEvidenceIds']),
  record_note: Object.freeze(['note', 'caption']),
  correct: Object.freeze(['evidenceId', 'expectedEvidenceRevision', 'expectedEvidenceDigest', 'replacement']),
});
const FILE_MEDIA = Object.freeze({
  'image/jpeg': Object.freeze({ extensions: new Set(['jpg', 'jpeg']), magic: 'jpeg' }),
  'image/png': Object.freeze({ extensions: new Set(['png']), magic: 'png' }),
  'image/webp': Object.freeze({ extensions: new Set(['webp']), magic: 'webp' }),
});

class FieldEvidenceContractError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'FieldEvidenceContractError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
  }
}

function fail(status, code, message) { throw new FieldEvidenceContractError(status, code, message); }
function has(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function exactObject(value, allowed, code = 'INVALID_FIELD_EVIDENCE_REQUEST') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.has(key))) {
    fail(400, code, 'Field evidence request is invalid.');
  }
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value), 'utf8'); } catch (_error) { bytes = Infinity; }
  if (bytes > 32768) fail(413, 'M23_FIELD_EVIDENCE_BODY_TOO_LARGE', 'Field evidence request exceeds the 32768-byte limit.');
  return value;
}
function uuid(value, code = 'INVALID_FIELD_EVIDENCE_ID') {
  if (typeof value !== 'string' || value !== value.trim() || !UUID.test(value)) fail(400, code, 'Field evidence identity is invalid.');
  return value.toLowerCase();
}
function digest(value, code = 'INVALID_FIELD_EVIDENCE_DIGEST') {
  if (typeof value !== 'string' || value !== value.trim() || !DIGEST.test(value)) fail(400, code, 'Field evidence digest is invalid.');
  return value;
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail(400, 'INVALID_FIELD_EVIDENCE_REVISION', 'Field evidence revision is invalid.');
  return value;
}
function key(value, label = 'Field evidence key') {
  if (typeof value !== 'string' || !KEY.test(value)) fail(400, 'INVALID_FIELD_EVIDENCE_KEY', `${label} is invalid.`);
  return value;
}
function inertText(value, maximum = 2000, allowEmpty = false) {
  if (typeof value !== 'string' || value !== value.normalize('NFC') || value !== value.trim() ||
      (!allowEmpty && !value) || Array.from(value).length > maximum ||
      Buffer.byteLength(value, 'utf8') > maximum * 4 ||
      /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb\ufffc\u{e0000}-\u{e007f}]/u.test(value) ||
      /[<>]/.test(value) || /(?:https?:\/\/|data:|javascript:|www\.)/iu.test(value)) {
    fail(400, 'INVALID_FIELD_EVIDENCE_TEXT', 'Field evidence text must be bounded inert plain text.');
  }
  return value;
}
function idempotencyKey(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.length < 16 || value.length > 128 || /[^\x21-\x7e]/.test(value)) {
    fail(400, 'INVALID_IDEMPOTENCY_KEY', 'A bounded canonical Idempotency-Key is required.');
  }
  return value;
}
function common(input, body) {
  const required = ['performerProfileId', 'expectedExecutionRevision', 'expectedExecutionDigest',
    'expectedAssignmentRevision', 'expectedAssignmentDigest', 'reason'];
  if (required.some(field => !has(body, field))) fail(428, 'M23_FIELD_EVIDENCE_PRECONDITION_REQUIRED', 'Exact performer, execution, assignment, reason, and idempotency evidence are required.');
  return Object.freeze({
    organizationId: uuid(input && input.organizationId),
    actorUserId: uuid(input && input.actorUserId),
    actorAccessRole: String(input && input.actorAccessRole || ''),
    authSessionId: uuid(input && input.authSessionId),
    executionId: uuid(input && input.executionId),
    performerProfileId: uuid(body.performerProfileId),
    expectedExecutionRevision: revision(body.expectedExecutionRevision),
    expectedExecutionDigest: digest(body.expectedExecutionDigest),
    expectedAssignmentRevision: revision(body.expectedAssignmentRevision),
    expectedAssignmentDigest: digest(body.expectedAssignmentDigest),
    reason: inertText(body.reason, 1000),
    idempotencyKey: idempotencyKey(input && input.idempotencyKey),
  });
}
function resultType(value) {
  if (!RESULT_TYPES.has(value)) fail(400, 'INVALID_FIELD_EVIDENCE_RESULT', 'Inspection or checklist result semantics are invalid.');
  return value;
}
function measurement(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(field => !['value', 'unit'].includes(field)) ||
      typeof value.value !== 'string' || !/^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(value.value) ||
      typeof value.unit !== 'string' || !KEY.test(value.unit)) {
    fail(400, 'INVALID_FIELD_EVIDENCE_MEASUREMENT', 'Measurement evidence is invalid.');
  }
  return Object.freeze({ value: value.value, unit: value.unit });
}
function evidenceIds(value) {
  if (!Array.isArray(value) || value.length > 20 || new Set(value).size !== value.length) {
    fail(400, 'INVALID_FIELD_EVIDENCE_LINKS', 'Supporting evidence links are invalid.');
  }
  return Object.freeze(value.map(item => uuid(item)));
}
function resultDocument(body, kindValue) {
  const type = resultType(body.resultType);
  const observed = inertText(body.observation, 2000);
  const measured = has(body, 'measurement') && body.measurement !== null
    ? measurement(body.measurement) : null;
  if ((type === 'measurement') !== (measured !== null)) fail(400, 'INVALID_FIELD_EVIDENCE_MEASUREMENT', 'Measurement semantics require one explicit value and unit.');
  return Object.freeze({
    kind: kindValue,
    ...(kindValue === 'observation' ? {
      observationClass: OBSERVATION_CLASSES.has(body.observationClass) ? body.observationClass
        : fail(400, 'INVALID_FIELD_EVIDENCE_OBSERVATION_CLASS', 'Inspection or quality observation class is invalid.'),
    } : {}),
    resultType: type,
    observation: observed,
    measurement: measured,
    exception: has(body, 'exception') && body.exception !== null ? inertText(body.exception, 1000) : null,
    supportingEvidenceIds: evidenceIds(body.supportingEvidenceIds || []),
    professionalConclusion: false,
  });
}
function normalizeEvidenceAction(input) {
  const body = exactObject(input && input.body, new Set([
    'action', 'performerProfileId', 'expectedExecutionRevision', 'expectedExecutionDigest',
    'expectedAssignmentRevision', 'expectedAssignmentDigest', 'reason', 'template', 'items',
    'checklistId', 'expectedChecklistRevision', 'expectedChecklistDigest', 'itemKey',
    'observationClass', 'resultType', 'observation', 'measurement', 'exception', 'supportingEvidenceIds',
    'note', 'caption', 'evidenceId', 'expectedEvidenceRevision', 'expectedEvidenceDigest', 'replacement',
  ]));
  const action = body.action;
  if (!Object.prototype.hasOwnProperty.call(ACTION_FIELDS, action)) fail(400, 'INVALID_FIELD_EVIDENCE_ACTION', 'Field evidence action is invalid.');
  if (Object.keys(body).some(field => !COMMON_ACTION_FIELDS.includes(field) && !ACTION_FIELDS[action].includes(field))) {
    fail(400, 'INVALID_FIELD_EVIDENCE_REQUEST', 'Field evidence request contains fields that do not belong to its action.');
  }
  const base = common(input, body);
  let document;
  let subjectId = null;
  let expectedSubjectRevision = null;
  let expectedSubjectDigest = null;
  if (action === 'create_checklist') {
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) fail(400, 'INVALID_CHECKLIST_ITEMS', 'Checklist items are invalid.');
    const seen = new Set();
    const items = body.items.map(item => {
      exactObject(item, new Set(['key', 'prompt', 'required']));
      const itemKey = key(item.key, 'Checklist item key');
      if (seen.has(itemKey) || typeof item.required !== 'boolean') fail(400, 'INVALID_CHECKLIST_ITEMS', 'Checklist items are invalid.');
      seen.add(itemKey);
      return Object.freeze({ key: itemKey, prompt: inertText(item.prompt, 500), required: item.required });
    });
    let template = null;
    if (body.template !== null) {
      exactObject(body.template, new Set(['entryId', 'versionId', 'versionNumber', 'digest', 'publicationId']));
      template = Object.freeze({ entryId: uuid(body.template.entryId), versionId: uuid(body.template.versionId),
        versionNumber: revision(body.template.versionNumber), digest: digest(body.template.digest),
        publicationId: uuid(body.template.publicationId) });
    }
    document = Object.freeze({ kind: 'checklist', template,
      adHocTemplateVersion: template ? null : AD_HOC_TEMPLATE_VERSION,
      adHocTemplateDigest: template ? null : AD_HOC_TEMPLATE_DIGEST, items });
  } else if (action === 'respond_item') {
    subjectId = uuid(body.checklistId); expectedSubjectRevision = revision(body.expectedChecklistRevision);
    expectedSubjectDigest = digest(body.expectedChecklistDigest);
    document = Object.freeze({ ...resultDocument(body, 'checklist_response'), checklistId: subjectId,
      itemKey: key(body.itemKey, 'Checklist item key') });
  } else if (action === 'record_observation') {
    document = resultDocument(body, 'observation');
  } else if (action === 'record_note') {
    document = Object.freeze({ kind: 'note', note: inertText(body.note, 4000),
      caption: has(body, 'caption') && body.caption !== null ? inertText(body.caption, 500) : null });
  } else if (action === 'correct') {
    subjectId = uuid(body.evidenceId); expectedSubjectRevision = revision(body.expectedEvidenceRevision);
    expectedSubjectDigest = digest(body.expectedEvidenceDigest);
    const replacement = exactObject(body.replacement, new Set([
      'kind', 'resultType', 'observation', 'measurement', 'exception', 'supportingEvidenceIds',
      'observationClass', 'checklistId', 'itemKey', 'note', 'caption',
    ]));
    if (replacement.kind === 'note') {
      document = Object.freeze({ kind: 'note', note: inertText(replacement.note, 4000),
        caption: has(replacement, 'caption') && replacement.caption !== null ? inertText(replacement.caption, 500) : null });
    } else if (replacement.kind === 'observation') {
      document = resultDocument(replacement, 'observation');
    } else if (replacement.kind === 'checklist_response') {
      document = Object.freeze({ ...resultDocument(replacement, 'checklist_response'),
        checklistId: uuid(replacement.checklistId), itemKey: key(replacement.itemKey, 'Checklist item key') });
    } else fail(400, 'INVALID_FIELD_EVIDENCE_CORRECTION', 'Only notes, observations, and item responses may be corrected.');
  } else fail(400, 'INVALID_FIELD_EVIDENCE_ACTION', 'Field evidence action is invalid.');
  return Object.freeze({ ...base, action, subjectId, expectedSubjectRevision, expectedSubjectDigest, document });
}

function normalizeFileHeaders(input, headers) {
  const baseBody = {
    performerProfileId: headers['x-performer-profile-id'],
    expectedExecutionRevision: Number(headers['x-execution-revision']),
    expectedExecutionDigest: headers['x-execution-digest'],
    expectedAssignmentRevision: Number(headers['x-assignment-revision']),
    expectedAssignmentDigest: headers['x-assignment-digest'],
    reason: headers['x-evidence-reason'],
  };
  const base = common({ ...input, idempotencyKey: headers['idempotency-key'] }, baseBody);
  const displayName = inertText(headers['x-file-name'], 120);
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._ -]{0,119}$/u.test(displayName) || displayName.includes('..')) fail(400, 'INVALID_FIELD_FILE_NAME', 'Field file name is invalid.');
  const extension = displayName.includes('.') ? displayName.split('.').pop().toLowerCase() : '';
  const contentType = String(headers['content-type'] || '').toLowerCase().split(';')[0].trim();
  if (!FILE_MEDIA[contentType] || !FILE_MEDIA[contentType].extensions.has(extension)) fail(415, 'M23_FIELD_FILE_MEDIA_UNSUPPORTED', 'Field files are limited to allowlisted JPEG, PNG, and WebP media with matching extensions.');
  const contentLength = Number(headers['content-length']);
  if (!Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > MAX_FILE_BYTES) fail(413, 'M23_FIELD_FILE_SIZE_INVALID', 'A positive Content-Length within the 10 MiB file limit is required.');
  const flags = String(headers['x-privacy-flags'] || 'none').split(',').map(value => value.trim()).filter(Boolean);
  if (flags.length > 4 || new Set(flags).size !== flags.length || flags.some(value => !['none', 'faces', 'customer_property', 'signature'].includes(value)) ||
      (flags.includes('none') && flags.length !== 1) || flags.includes('signature')) fail(400, 'M23_FIELD_FILE_PRIVACY_GATED', 'Sensitive field media is unavailable without the exact permitted privacy gate; signatures are not accepted.');
  const sensitive = flags.some(value => value !== 'none');
  const privacy = sensitive ? Object.freeze({
    policyVersion: inertText(headers['x-privacy-policy-version'], 80),
    policyDigest: digest(headers['x-privacy-policy-digest']),
    consentEvidenceId: uuid(headers['x-consent-evidence-id']),
    consentEvidenceDigest: digest(headers['x-consent-evidence-digest']),
  }) : null;
  const retentionDays = Number(headers['x-retention-days']);
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) fail(400, 'M23_FIELD_FILE_RETENTION_INVALID', 'Field file retention must be explicitly bounded from 1 to 365 days.');
  return Object.freeze({ ...base, displayName, extension, contentType, contentLength, privacyFlags: flags, privacy, retentionDays });
}

function detectMagic(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function normalizeReadQuery(query) {
  const value = query && typeof query === 'object' && !Array.isArray(query) ? query : {};
  if (Object.keys(value).some(field => !['limit', 'cursor'].includes(field))) fail(400, 'M23_FIELD_EVIDENCE_QUERY_INVALID', 'Field evidence query is invalid.');
  const limit = value.limit === undefined ? 100 : Number(value.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || String(limit) !== String(value.limit || limit)) fail(400, 'M23_FIELD_EVIDENCE_QUERY_INVALID', 'Field evidence query is invalid.');
  let cursor = null;
  if (value.cursor !== undefined) {
    try {
      cursor = JSON.parse(Buffer.from(String(value.cursor), 'base64url').toString('utf8'));
      exactObject(cursor, new Set(['cutoff', 'lastTime', 'lastId']));
      if (![cursor.lastId].every(candidate => UUID.test(candidate)) ||
          ![cursor.cutoff, cursor.lastTime].every(candidate => typeof candidate === 'string' && Number.isFinite(Date.parse(candidate))) ||
          Date.parse(cursor.lastTime) > Date.parse(cursor.cutoff) || Date.parse(cursor.cutoff) > Date.now() + 5000) throw new Error('invalid');
    } catch (_error) { fail(400, 'M23_FIELD_EVIDENCE_CURSOR_INVALID', 'Field evidence cursor is invalid.'); }
  }
  return Object.freeze({ limit, cursor });
}

module.exports = {
  AD_HOC_TEMPLATE_DIGEST, AD_HOC_TEMPLATE_VERSION, FILE_MEDIA, MAX_EXECUTION_FILE_BYTES,
  MAX_FILE_BYTES, MAX_FILE_COUNT, FieldEvidenceContractError, detectMagic,
  normalizeEvidenceAction, normalizeFileHeaders, normalizeReadQuery,
};
