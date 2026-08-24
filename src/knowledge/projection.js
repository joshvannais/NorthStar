'use strict';

const crypto = require('crypto');
const {
  canonicalStringify,
  normalizeUuid,
} = require('./contract');

const PROJECTION_CONTRACT = 'NorthStarKnowledgeProjection/v1';
const AUDIENCES = Object.freeze(['customer', 'internal', 'workforce']);
const CAPABILITY_KEYS = Object.freeze({
  availability: 'organization.availability',
  customer_guidance: 'organization.customer-guidance',
  financial_constraints: 'organization.financial-constraints',
  identity: 'organization.identity',
  operational_capabilities: 'organization.operational-capabilities',
  services: 'organization.services',
  voice_guidance: 'organization.voice-guidance',
});
const KEY_CAPABILITIES = Object.freeze(Object.fromEntries(
  Object.entries(CAPABILITY_KEYS).map(([capability, key]) => [key, capability])
));
const CONSUMER_PROFILES = Object.freeze({
  integration_adapter: Object.freeze({
    audiences: AUDIENCES,
    capabilities: Object.freeze(Object.keys(CAPABILITY_KEYS)),
    maximumBytes: 262144,
    maximumCandidates: 64,
    maximumEntries: 64,
    requiresAdministrator: true,
    requiresCompleteProjection: true,
    supportsQuery: false,
  }),
  northstar_assistant: Object.freeze({
    audiences: AUDIENCES,
    capabilities: Object.freeze(Object.keys(CAPABILITY_KEYS)),
    maximumBytes: 262144,
    maximumCandidates: 256,
    maximumEntries: 32,
    requiresAdministrator: false,
    requiresCompleteProjection: false,
    supportsQuery: true,
  }),
  northstar_search: Object.freeze({
    audiences: AUDIENCES,
    capabilities: Object.freeze(Object.keys(CAPABILITY_KEYS)),
    maximumBytes: 262144,
    maximumCandidates: 256,
    maximumEntries: 32,
    requiresAdministrator: false,
    requiresCompleteProjection: false,
    supportsQuery: true,
  }),
  voice_runtime: Object.freeze({
    audiences: Object.freeze(['customer']),
    capabilities: Object.freeze([
      'availability', 'customer_guidance', 'identity', 'services', 'voice_guidance',
    ]),
    maximumBytes: 65536,
    maximumCandidates: 16,
    maximumEntries: 16,
    requiresAdministrator: true,
    requiresCompleteProjection: true,
    supportsQuery: false,
  }),
});

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_QUERY_BYTES = 1024;
const MAX_QUERY_LENGTH = 256;

class KnowledgeProjectionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'KnowledgeProjectionError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new KnowledgeProjectionError(code, message, status);
}

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function normalizedEnum(value, allowed, field) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail('knowledge_projection_invalid_request', `${field} is not supported`);
  }
  return value;
}

function positiveInteger(value, field, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    fail('knowledge_projection_invalid_request', `${field} is outside its allowed bounds`);
  }
  return number;
}

function normalizeQuery(value, profile) {
  if (value === undefined || value === null || value === '') return '';
  if (!profile.supportsQuery) {
    fail('knowledge_projection_query_not_supported', 'This projection consumer does not accept a query');
  }
  if (typeof value !== 'string') {
    fail('knowledge_projection_invalid_request', 'query must be text');
  }
  const normalized = value.normalize('NFC').trim();
  if (normalized.length < 1 || normalized.length > MAX_QUERY_LENGTH ||
      Buffer.byteLength(normalized, 'utf8') > MAX_QUERY_BYTES ||
      CONTROL_OR_FORMAT.test(normalized)) {
    fail('knowledge_projection_invalid_request', 'query is outside its allowed bounds');
  }
  return normalized;
}

function normalizeCapabilities(value, profile, audience) {
  if (!Array.isArray(value) || value.length < 1 || value.length > profile.capabilities.length) {
    fail('knowledge_projection_invalid_request', 'At least one bounded capability is required');
  }
  const allowed = new Set(profile.capabilities);
  const seen = new Set();
  const capabilities = value.map(capability => {
    if (typeof capability !== 'string' || !allowed.has(capability)) {
      fail('knowledge_projection_capability_not_allowed', 'A requested capability is not allowed');
    }
    if (audience === 'customer' &&
        (capability === 'financial_constraints' || capability === 'operational_capabilities')) {
      fail('knowledge_projection_capability_not_allowed', 'A requested capability is not allowed');
    }
    if (seen.has(capability)) {
      fail('knowledge_projection_invalid_request', 'Duplicate capabilities are not allowed');
    }
    seen.add(capability);
    return capability;
  });
  return capabilities.sort(compareUtf8);
}

function normalizePin(pin) {
  if (!plainObject(pin)) {
    fail('knowledge_projection_invalid_request', 'Each exact source pin must be an object');
  }
  const canonicalDigest = typeof pin.canonicalDigest === 'string'
    ? pin.canonicalDigest.toLowerCase() : '';
  if (!SHA256.test(canonicalDigest)) {
    fail('knowledge_projection_invalid_request', 'canonicalDigest must be a SHA-256 digest');
  }
  return {
    canonicalDigest,
    entryId: normalizeUuid(pin.entryId, 'entryId'),
    publicationId: normalizeUuid(pin.publicationId, 'publicationId'),
    publicationNumber: positiveInteger(pin.publicationNumber, 'publicationNumber', 2147483647),
    versionId: normalizeUuid(pin.versionId, 'versionId'),
    versionNumber: positiveInteger(pin.versionNumber, 'versionNumber', 2147483647),
  };
}

function normalizePins(value, maximumEntries) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximumEntries) {
    fail('knowledge_projection_invalid_request', 'exactSourcePins are outside their allowed bounds');
  }
  if (value.length === 0) return [];
  const seenEntries = new Set();
  const seenPublications = new Set();
  const pins = value.map(normalizePin);
  for (const pin of pins) {
    if (seenEntries.has(pin.entryId) || seenPublications.has(pin.publicationId)) {
      fail('knowledge_projection_invalid_request', 'Exact source pins must be unique');
    }
    seenEntries.add(pin.entryId);
    seenPublications.add(pin.publicationId);
  }
  return pins.sort((left, right) => compareUtf8(left.entryId, right.entryId));
}

function normalizeProjectionRequest(input) {
  if (!plainObject(input)) {
    fail('knowledge_projection_invalid_request', 'Projection input must be an object');
  }
  const organizationId = normalizeUuid(input.organizationId, 'organizationId');
  const actorUserId = normalizeUuid(input.actorUserId, 'actorUserId');
  const consumer = normalizedEnum(
    input.consumer,
    Object.keys(CONSUMER_PROFILES),
    'consumer'
  );
  const profile = CONSUMER_PROFILES[consumer];
  const audience = normalizedEnum(input.audience, profile.audiences, 'audience');
  const capabilities = normalizeCapabilities(input.capabilities, profile, audience);
  const maximumEntries = input.maximumEntries === undefined
    ? profile.maximumEntries
    : positiveInteger(input.maximumEntries, 'maximumEntries', profile.maximumEntries);
  const maximumBytes = input.maximumBytes === undefined
    ? profile.maximumBytes
    : positiveInteger(input.maximumBytes, 'maximumBytes', profile.maximumBytes);
  if (maximumBytes < 1024) {
    fail('knowledge_projection_invalid_request', 'maximumBytes is outside its allowed bounds');
  }
  const query = normalizeQuery(input.query, profile);
  const exactSourcePins = normalizePins(input.exactSourcePins, maximumEntries);
  if (query && exactSourcePins.length > 0) {
    fail(
      'knowledge_projection_invalid_request',
      'query cannot be combined with exactSourcePins'
    );
  }
  return deepFreeze({
    actorUserId,
    audience,
    capabilities,
    consumer,
    exactSourcePins,
    maximumBytes,
    maximumEntries,
    organizationId,
    profile,
    query,
    selection: exactSourcePins.length > 0 ? 'exact_pins' : 'latest_published',
  });
}

function copyFields(source, fields) {
  if (!plainObject(source)) return {};
  const output = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) output[field] = source[field];
  }
  return output;
}

function minimizeCustomerContent(canonicalKey, content) {
  if (!plainObject(content) || !plainObject(content.facts)) {
    fail(
      'knowledge_projection_integrity_failure',
      'Published knowledge does not satisfy its projection shape',
      503
    );
  }
  const facts = content.facts;
  if (canonicalKey === CAPABILITY_KEYS.identity) {
    return {
      ...copyFields(facts, ['businessDescription', 'industry']),
      company: copyFields(facts.company, ['dba', 'name', 'phone', 'website']),
    };
  }
  if (canonicalKey === CAPABILITY_KEYS.availability) {
    return {
      ...copyFields(facts, ['hours']),
      serviceArea: copyFields(
        facts.serviceArea,
        ['maxRadiusMiles', 'maxTravelMinutes', 'primaryTerritory']
      ),
    };
  }
  if (canonicalKey === CAPABILITY_KEYS.services) {
    const services = Array.isArray(facts.services) ? facts.services : [];
    return {
      services: services.filter(plainObject).map(service => copyFields(
        service,
        ['active', 'category', 'description', 'id', 'name']
      )),
    };
  }
  if (canonicalKey === CAPABILITY_KEYS.customer_guidance) {
    return copyFields(
      facts,
      ['companyValues', 'emergencyPolicy', 'faq', 'policies']
    );
  }
  if (canonicalKey === CAPABILITY_KEYS.voice_guidance) {
    return {
      voiceAssistant: copyFields(
        facts.voiceAssistant,
        ['conversationStyle', 'greeting', 'name', 'personality', 'style']
      ),
    };
  }
  fail('knowledge_projection_capability_not_allowed', 'A requested capability is not allowed');
}

function validateApplicability(document, request, capability) {
  const applicability = document.applicability;
  if (!plainObject(applicability) || applicability.projection === undefined) return true;
  const projection = applicability.projection;
  if (!plainObject(projection)) {
    fail('knowledge_projection_integrity_failure', 'Published projection applicability is invalid', 503);
  }
  const supportedFields = new Set(['audiences', 'capabilities', 'consumers']);
  if (Object.keys(projection).some(field => !supportedFields.has(field))) {
    fail('knowledge_projection_integrity_failure', 'Published projection applicability is invalid', 503);
  }
  const filters = [
    ['audiences', request.audience, AUDIENCES],
    ['capabilities', capability, Object.keys(CAPABILITY_KEYS)],
    ['consumers', request.consumer, Object.keys(CONSUMER_PROFILES)],
  ];
  for (const [field, expected, allowed] of filters) {
    if (projection[field] === undefined) continue;
    if (!Array.isArray(projection[field]) ||
        projection[field].length > allowed.length ||
        new Set(projection[field]).size !== projection[field].length ||
        projection[field].some(value => typeof value !== 'string' || !allowed.includes(value))) {
      fail('knowledge_projection_integrity_failure', 'Published projection applicability is invalid', 503);
    }
    if (!projection[field].includes(expected)) return false;
  }
  return true;
}

function capabilitiesForDocument(document, request, canonicalKey) {
  const fixed = KEY_CAPABILITIES[canonicalKey];
  if (fixed) return request.capabilities.includes(fixed) ? [fixed] : [];
  const applicability = document.applicability;
  const projection = plainObject(applicability) ? applicability.projection : null;
  if (projection === undefined || projection === null) return [];
  if (!plainObject(projection) || !Array.isArray(projection.capabilities) ||
      projection.capabilities.length < 1 ||
      projection.capabilities.some(capability => typeof capability !== 'string')) {
    fail('knowledge_projection_integrity_failure', 'Published projection applicability is invalid', 503);
  }
  if (request.audience === 'customer') {
    // Custom customer-field schemas require a later explicit minimization contract.
    return [];
  }
  const allowed = new Set(request.profile.capabilities);
  const capabilities = Array.from(new Set(projection.capabilities));
  if (capabilities.some(capability => !allowed.has(capability))) {
    fail('knowledge_projection_integrity_failure', 'Published projection applicability is invalid', 503);
  }
  return capabilities
    .filter(capability => request.capabilities.includes(capability))
    .sort(compareUtf8);
}

function normalizeRow(row, request) {
  if (!plainObject(row)) {
    fail('knowledge_projection_integrity_failure', 'Published knowledge is unavailable', 503);
  }
  const canonicalKey = row.canonical_key;
  let document;
  try {
    document = JSON.parse(row.canonical_document);
  } catch (_error) {
    fail('knowledge_projection_integrity_failure', 'Published knowledge is unavailable', 503);
  }
  const canonicalDocument = canonicalStringify(document);
  const canonicalDigest = crypto.createHash('sha256').update(canonicalDocument, 'utf8').digest('hex');
  if (canonicalDocument !== row.canonical_document ||
      canonicalDigest !== String(row.canonical_digest).trim() ||
      canonicalDigest !== String(row.publication_digest).trim() ||
      canonicalKey !== document.canonicalKey ||
      row.entry_type !== document.entryType ||
      row.sensitivity !== document.sensitivity ||
      row.review_requirement !== document.reviewRequirement) {
    fail('knowledge_projection_integrity_failure', 'Published knowledge failed integrity verification', 503);
  }
  const capabilities = capabilitiesForDocument(document, request, canonicalKey)
    .filter(capability => validateApplicability(document, request, capability));
  if (capabilities.length === 0) return [];
  const source = {
    canonicalDigest,
    entryId: row.entry_id,
    publicationId: row.publication_id,
    publicationNumber: Number(row.publication_number),
    versionId: row.version_id,
    versionNumber: Number(row.version_number),
  };
  const tombstoned = document.content && document.content.state === 'tombstoned';
  return capabilities.map(capability => {
    const item = {
      capability,
      canonicalKey,
      entryType: row.entry_type,
      state: tombstoned ? 'tombstoned' : 'published',
    };
    if (request.audience !== 'customer') item.label = document.label;
    if (!tombstoned) {
      item.content = request.audience === 'customer'
        ? minimizeCustomerContent(canonicalKey, document.content)
        : document.content;
    }
    return { capability, item, source };
  });
}

function queryTokens(query) {
  if (!query) return [];
  return Array.from(new Set(
    query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  )).sort(compareUtf8);
}

function rankRows(rows, request) {
  const tokens = queryTokens(request.query);
  const ranked = rows.map(row => {
    const searchable = canonicalStringify(row.item).toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (searchable.includes(token) ? 1 : 0), 0);
    return { ...row, score };
  });
  const matched = tokens.length === 0 ? ranked : ranked.filter(row => row.score > 0);
  return matched.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    const capabilityOrder = compareUtf8(left.capability, right.capability);
    if (capabilityOrder !== 0) return capabilityOrder;
    const keyOrder = compareUtf8(left.item.canonicalKey, right.item.canonicalKey);
    if (keyOrder !== 0) return keyOrder;
    return compareUtf8(left.source.canonicalDigest, right.source.canonicalDigest);
  });
}

function verifyExactPins(request, rows) {
  if (request.selection !== 'exact_pins') return;
  const actual = new Map(rows.map(row => [row.source.entryId, row.source]));
  if (actual.size !== request.exactSourcePins.length) {
    fail('knowledge_projection_pin_unavailable', 'An exact published source pin is unavailable', 409);
  }
  for (const expected of request.exactSourcePins) {
    const observed = actual.get(expected.entryId);
    if (!observed || canonicalStringify(observed) !== canonicalStringify(expected)) {
      fail('knowledge_projection_pin_unavailable', 'An exact published source pin is unavailable', 409);
    }
  }
}

function buildKnowledgeProjection(requestInput, rawRows) {
  const request = normalizeProjectionRequest(requestInput);
  if (!Array.isArray(rawRows)) {
    fail('knowledge_projection_integrity_failure', 'Published knowledge is unavailable', 503);
  }
  const minimized = rawRows.flatMap(row => normalizeRow(row, request));
  verifyExactPins(request, minimized);
  const availableCapabilities = new Set(minimized.map(row => row.capability));
  const missingCapabilities = request.capabilities.filter(capability => !availableCapabilities.has(capability));
  if (request.profile.requiresCompleteProjection && missingCapabilities.length > 0) {
    fail('knowledge_projection_incomplete', 'The exact requested projection is incomplete', 409);
  }
  const ranked = rankRows(minimized, request);
  if (request.profile.requiresCompleteProjection && ranked.length > request.maximumEntries) {
    fail('knowledge_projection_size_exceeded', 'The exact requested projection exceeds its entry limit', 413);
  }
  const selected = ranked.slice(0, request.maximumEntries);
  const sources = [];
  const sourceIndexes = new Map();
  const items = selected.map(row => {
    const identity = canonicalStringify(row.source);
    if (!sourceIndexes.has(identity)) {
      sourceIndexes.set(identity, sources.length);
      sources.push(row.source);
    }
    return {
      ...row.item,
      sourceIndex: sourceIndexes.get(identity),
    };
  });
  const projectionSource = {
    audience: request.audience,
    capabilities: request.capabilities,
    consumer: request.consumer,
    contract: PROJECTION_CONTRACT,
    items,
    missingCapabilities,
    organizationId: request.organizationId,
    queryDigest: request.query
      ? crypto.createHash('sha256').update(request.query, 'utf8').digest('hex')
      : null,
    selection: request.selection,
    sources,
    truncated: ranked.length > selected.length,
  };
  const canonicalProjection = canonicalStringify(projectionSource);
  if (Buffer.byteLength(canonicalProjection, 'utf8') > request.maximumBytes) {
    fail('knowledge_projection_size_exceeded', 'The exact requested projection exceeds its byte limit', 413);
  }
  const projection = JSON.parse(canonicalProjection);
  const projectionDigest = crypto.createHash('sha256')
    .update(canonicalProjection, 'utf8')
    .digest('hex');
  return deepFreeze({ canonicalProjection, projection, projectionDigest });
}

module.exports = {
  AUDIENCES,
  CAPABILITY_KEYS,
  CONSUMER_PROFILES,
  KnowledgeProjectionError,
  PROJECTION_CONTRACT,
  buildKnowledgeProjection,
  normalizeProjectionRequest,
};
