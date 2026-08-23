'use strict';

const crypto = require('crypto');

const ENTRY_TYPES = Object.freeze([
  'fact', 'override', 'policy', 'faq', 'guidance', 'constraint',
  'generated_knowledge', 'disclosure',
]);
const CONTENT_ORIGINS = Object.freeze(['human', 'authoritative_source', 'generated', 'imported']);
const SENSITIVITIES = Object.freeze(['public', 'internal', 'restricted', 'legal']);
const REVIEW_REQUIREMENTS = Object.freeze(['standard', 'high_risk', 'attorney_gated']);
const SOURCE_TYPES = Object.freeze([
  'business_profile', 'service_catalogue', 'workforce', 'asset_catalogue',
  'policy_override', 'human_input', 'system_generation', 'imported_record',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_KEY = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FORBIDDEN_KEY = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const MAX_DOCUMENT_BYTES = 65536;
const MAX_APPLICABILITY_BYTES = 8192;
const MAX_DEPTH = 16;
const MAX_NODES = 2048;
const MAX_ARRAY_LENGTH = 256;
const MAX_STRING_BYTES = 16384;

class KnowledgeContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'KnowledgeContractError';
    this.code = code;
    this.status = 400;
  }
}

function fail(code, message) {
  throw new KnowledgeContractError(code, message);
}

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeUuid(value, field) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!UUID.test(normalized)) fail('knowledge_invalid_uuid', `${field} must be a UUID`);
  return normalized;
}

function boundedText(value, field, options) {
  if (typeof value !== 'string') fail('knowledge_invalid_text', `${field} must be text`);
  const normalized = value.normalize('NFC').trim();
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (normalized.length < options.min || normalized.length > options.max || bytes > options.maxBytes) {
    fail('knowledge_invalid_text', `${field} is outside its allowed length`);
  }
  if (CONTROL_OR_FORMAT.test(normalized)) {
    fail('knowledge_invalid_text', `${field} contains control or formatting characters`);
  }
  return normalized;
}

function enumValue(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail('knowledge_invalid_enum', `${field} is not supported`);
  }
  return value;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function requireJsonbSafeString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) {
      fail('knowledge_invalid_string', 'Knowledge strings cannot contain the null character');
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail('knowledge_invalid_string', 'Knowledge strings must contain valid Unicode');
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      fail('knowledge_invalid_string', 'Knowledge strings must contain valid Unicode');
    }
  }
  return value;
}

function canonicalNumberText(value) {
  const serialized = JSON.stringify(Object.is(value, -0) ? 0 : value);
  if (!/[eE]/.test(serialized)) return serialized;
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(serialized);
  if (!match) fail('knowledge_invalid_number', 'Knowledge number cannot be canonicalized');
  const [, sign, integer, fraction = '', exponentText] = match;
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + Number(exponentText);
  if (decimalIndex <= 0) return `${sign}0.${'0'.repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${sign}${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function canonicalStringify(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('knowledge_invalid_number', 'Knowledge numbers must be finite');
    return canonicalNumberText(value);
  }
  if (typeof value === 'string') return JSON.stringify(requireJsonbSafeString(value));
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (!plainObject(value)) fail('knowledge_invalid_value', 'Knowledge values must be JSON-compatible');
  const keys = Object.keys(value).sort(compareUtf8);
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

function canonicalValue(value, state, depth = 0) {
  if (depth > MAX_DEPTH) fail('knowledge_document_too_deep', 'Knowledge document nesting is too deep');
  state.nodes += 1;
  if (state.nodes > MAX_NODES) fail('knowledge_document_too_complex', 'Knowledge document is too complex');

  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('knowledge_invalid_number', 'Knowledge numbers must be finite');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'string') {
    const normalized = requireJsonbSafeString(value.normalize('NFC'));
    if (Buffer.byteLength(normalized, 'utf8') > MAX_STRING_BYTES) {
      fail('knowledge_string_too_large', 'A knowledge string exceeds the byte limit');
    }
    return normalized;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) fail('knowledge_array_too_large', 'A knowledge array is too large');
    return value.map(item => canonicalValue(item, state, depth + 1));
  }
  if (!plainObject(value)) fail('knowledge_invalid_value', 'Knowledge values must be JSON-compatible');

  const output = {};
  const normalizedKeys = new Set();
  const entries = Object.keys(value).map(key => {
    const normalized = requireJsonbSafeString(key.normalize('NFC'));
    if (FORBIDDEN_KEY.has(normalized) || CONTROL_OR_FORMAT.test(normalized) || normalized.length === 0 ||
        Buffer.byteLength(normalized, 'utf8') > 256) {
      fail('knowledge_invalid_key', 'Knowledge document contains an unsafe key');
    }
    if (normalizedKeys.has(normalized)) fail('knowledge_duplicate_key', 'Knowledge keys collide after normalization');
    normalizedKeys.add(normalized);
    return [normalized, value[key]];
  }).sort(([left], [right]) => compareUtf8(left, right));

  for (const [key, nested] of entries) output[key] = canonicalValue(nested, state, depth + 1);
  return output;
}

function canonicalObject(value, field, maxBytes) {
  if (!plainObject(value)) fail('knowledge_invalid_object', `${field} must be an object`);
  const canonical = canonicalValue(value, { nodes: 0 });
  const serialized = canonicalStringify(canonical);
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    fail('knowledge_document_too_large', `${field} exceeds its byte limit`);
  }
  return canonical;
}

function normalizeCanonicalKey(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!CANONICAL_KEY.test(normalized) || normalized.length > 128 ||
      Buffer.byteLength(normalized, 'utf8') > 128) {
    fail('knowledge_invalid_key', 'canonicalKey must be a stable lower-case identifier');
  }
  return normalized;
}

function normalizeJsonPointer(value) {
  if (value === undefined || value === null || value === '') return '';
  const pointer = boundedText(value, 'jsonPointer', { min: 1, max: 512, maxBytes: 2048 });
  if (!pointer.startsWith('/')) fail('knowledge_invalid_pointer', 'jsonPointer must be empty or begin with /');
  return pointer;
}

function normalizeProvenance(provenance) {
  if (!Array.isArray(provenance) || provenance.length < 1 || provenance.length > 1024) {
    fail('knowledge_invalid_provenance', 'At least one bounded provenance link is required');
  }
  const seen = new Set();
  return provenance.map((item, index) => {
    if (!plainObject(item)) fail('knowledge_invalid_provenance', 'Each provenance link must be an object');
    const normalized = {
      ordinal: index + 1,
      sourceType: enumValue(item.sourceType, SOURCE_TYPES, 'sourceType'),
      sourceRecordId: boundedText(item.sourceRecordId, 'sourceRecordId', { min: 1, max: 128, maxBytes: 512 }),
      sourceVersion: boundedText(item.sourceVersion, 'sourceVersion', { min: 1, max: 64, maxBytes: 256 }),
      sourceDigest: typeof item.sourceDigest === 'string' ? item.sourceDigest.toLowerCase() : '',
      jsonPointer: normalizeJsonPointer(item.jsonPointer),
    };
    if (!SHA256.test(normalized.sourceDigest)) {
      fail('knowledge_invalid_digest', 'sourceDigest must be a SHA-256 hex digest');
    }
    const identity = [normalized.sourceType, normalized.sourceRecordId, normalized.sourceVersion,
      normalized.sourceDigest, normalized.jsonPointer].join('\u0000');
    if (seen.has(identity)) fail('knowledge_duplicate_provenance', 'Duplicate provenance links are not allowed');
    seen.add(identity);
    return normalized;
  });
}

function normalizeInitialDraft(input) {
  if (!plainObject(input)) fail('knowledge_invalid_input', 'Knowledge draft input must be an object');
  const organizationId = normalizeUuid(input.organizationId, 'organizationId');
  const actorUserId = normalizeUuid(input.actorUserId, 'actorUserId');
  const canonicalKey = normalizeCanonicalKey(input.canonicalKey);
  const entryType = enumValue(input.entryType, ENTRY_TYPES, 'entryType');
  const label = boundedText(input.label, 'label', { min: 1, max: 160, maxBytes: 640 });
  const sensitivity = enumValue(
    input.sensitivity === undefined ? 'internal' : input.sensitivity,
    SENSITIVITIES,
    'sensitivity'
  );
  const reviewRequirement = enumValue(
    input.reviewRequirement === undefined ? 'standard' : input.reviewRequirement,
    REVIEW_REQUIREMENTS,
    'reviewRequirement'
  );
  const origin = enumValue(
    input.origin === undefined ? 'human' : input.origin,
    CONTENT_ORIGINS,
    'origin'
  );
  const applicability = canonicalObject(
    input.applicability === undefined ? {} : input.applicability,
    'applicability',
    MAX_APPLICABILITY_BYTES
  );
  const content = canonicalObject(input.content, 'content', MAX_DOCUMENT_BYTES);
  const reason = boundedText(input.reason, 'reason', { min: 1, max: 500, maxBytes: 2000 });
  const provenance = normalizeProvenance(input.provenance);

  const document = canonicalObject({
    applicability,
    canonicalKey,
    content,
    entryType,
    label,
    origin,
    reviewRequirement,
    schemaVersion: 1,
    sensitivity,
  }, 'document', MAX_DOCUMENT_BYTES);
  const canonicalDocument = canonicalStringify(document);
  const canonicalDigest = crypto.createHash('sha256').update(canonicalDocument, 'utf8').digest('hex');

  return Object.freeze({
    organizationId,
    actorUserId,
    canonicalKey,
    entryType,
    label,
    sensitivity,
    reviewRequirement,
    origin,
    applicability,
    content,
    reason,
    provenance: Object.freeze(provenance.map(item => Object.freeze(item))),
    document,
    canonicalDocument,
    canonicalDigest,
  });
}

module.exports = {
  CANONICAL_KEY,
  CONTENT_ORIGINS,
  ENTRY_TYPES,
  KnowledgeContractError,
  MAX_APPLICABILITY_BYTES,
  MAX_DOCUMENT_BYTES,
  REVIEW_REQUIREMENTS,
  SENSITIVITIES,
  SOURCE_TYPES,
  canonicalObject,
  canonicalStringify,
  normalizeInitialDraft,
  normalizeUuid,
};
