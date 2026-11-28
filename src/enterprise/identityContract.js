'use strict';

// Slice 1B defines data contracts only. These records do not establish durable
// existence, ownership, current membership, authentication, or authorization.
// No repository, route, provider, environment, or identity allocator is used.
const CONTRACT = 'northstar.enterprise.identity.v1';
const LIMITS = Object.freeze({ identities: 1000, relationships: 2000 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEGACY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const PROFILE_VERSION = /^org-profile-v[1-9][0-9]*$/;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function invalid(reason) {
  return Object.assign(new Error('Enterprise identity contract is invalid.'), {
    code: 'ENTERPRISE_IDENTITY_INVALID', reason,
  });
}

// Read only own enumerable data properties; reject accessors without invoking
// them. A JSON-shaped record cannot smuggle a grant or inherit an identity.
function shape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid('shape');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw invalid('shape');
  }
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw invalid('shape');
    result[key] = descriptor.value;
  }
  return result;
}

function list(value, maximum) {
  if (!Array.isArray(value)) throw invalid('shape');
  if (value.length > maximum) throw invalid('limit');
  if (Reflect.ownKeys(value).length !== value.length + 1) throw invalid('shape');
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw invalid('shape');
    result.push(descriptor.value);
  }
  return result;
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid('identifier');
  return value;
}

function legacyKey(value) {
  if (typeof value !== 'string' || !LEGACY_KEY.test(value)) throw invalid('legacy_key');
  return value;
}

function instant(value) {
  if (typeof value !== 'string' || !UTC_INSTANT.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw invalid('timestamp');
  return value;
}

function provenance(value) {
  const data = shape(value, ['declarationId', 'declaredByActorId', 'declaredAt']);
  return Object.freeze({
    declarationId: uuid(data.declarationId),
    declaredByActorId: uuid(data.declaredByActorId),
    declaredAt: instant(data.declaredAt),
  });
}

function profilePin(value) {
  const data = shape(value, ['id', 'version', 'hash']);
  if (typeof data.version !== 'string' || data.version.length > 100 || !PROFILE_VERSION.test(data.version) ||
      typeof data.hash !== 'string' || !/^[0-9a-f]{64}$/.test(data.hash)) throw invalid('profile_pin');
  return Object.freeze({ id: uuid(data.id), version: data.version, hash: data.hash });
}

function kindOf(value) {
  if (!value || typeof value !== 'object') throw invalid('shape');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'kind');
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw invalid('shape');
  return descriptor.value;
}

function normalizeIdentity(value) {
  switch (kindOf(value)) {
    case 'enterprise_group_identity': {
      const data = shape(value, ['kind', 'id', 'provenance']);
      return Object.freeze({ kind: data.kind, id: uuid(data.id), provenance: provenance(data.provenance) });
    }
    case 'company_reference': {
      const data = shape(value, ['kind', 'organizationId', 'provenance']);
      return Object.freeze({ kind: data.kind, organizationId: uuid(data.organizationId), provenance: provenance(data.provenance) });
    }
    case 'location_identity': {
      const data = shape(value, ['kind', 'organizationId', 'id', 'provenance']);
      return Object.freeze({
        kind: data.kind, organizationId: uuid(data.organizationId), id: uuid(data.id),
        provenance: provenance(data.provenance),
      });
    }
    case 'legacy_location_reference': {
      const data = shape(value, ['kind', 'organizationId', 'locationKey', 'profilePin', 'provenance']);
      return Object.freeze({
        kind: data.kind, organizationId: uuid(data.organizationId), locationKey: legacyKey(data.locationKey),
        profilePin: profilePin(data.profilePin), provenance: provenance(data.provenance),
      });
    }
    default: throw invalid('kind');
  }
}

function normalizeRelationship(value) {
  switch (kindOf(value)) {
    case 'enterprise_company_association': {
      const data = shape(value, ['kind', 'id', 'enterpriseGroupId', 'organizationId', 'provenance']);
      return Object.freeze({
        kind: data.kind, id: uuid(data.id), enterpriseGroupId: uuid(data.enterpriseGroupId),
        organizationId: uuid(data.organizationId), provenance: provenance(data.provenance),
      });
    }
    case 'company_location_reference': {
      const data = shape(value, ['kind', 'id', 'organizationId', 'locationId', 'provenance']);
      return Object.freeze({
        kind: data.kind, id: uuid(data.id), organizationId: uuid(data.organizationId),
        locationId: uuid(data.locationId), provenance: provenance(data.provenance),
      });
    }
    default: throw invalid('kind');
  }
}

function identityKey(record) {
  if (record.kind === 'enterprise_group_identity') return JSON.stringify([record.kind, record.id]);
  if (record.kind === 'company_reference') return JSON.stringify([record.kind, record.organizationId]);
  if (record.kind === 'location_identity') return JSON.stringify([record.kind, record.organizationId, record.id]);
  return JSON.stringify([record.kind, record.organizationId, record.locationKey]);
}

function comparison(key) {
  return (left, right) => key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0;
}

function normalizeIdentityGraph(value) {
  const data = shape(value, ['contract', 'identities', 'relationships']);
  if (data.contract !== CONTRACT) throw invalid('contract');
  const identities = list(data.identities, LIMITS.identities).map(normalizeIdentity);
  const relationships = list(data.relationships, LIMITS.relationships).map(normalizeRelationship);
  const keys = new Set();
  const groups = new Set();
  const companies = new Set();
  const locations = new Set();
  for (const record of identities) {
    const key = identityKey(record);
    if (keys.has(key)) throw invalid('duplicate_identity');
    keys.add(key);
    if (record.kind === 'enterprise_group_identity') groups.add(record.id);
    if (record.kind === 'company_reference') companies.add(record.organizationId);
    if (record.kind === 'location_identity') locations.add(JSON.stringify([record.organizationId, record.id]));
  }
  for (const record of identities) {
    if (record.kind !== 'enterprise_group_identity' && record.kind !== 'company_reference' &&
        !companies.has(record.organizationId)) throw invalid('unknown_reference');
  }
  const relationshipIds = new Set();
  const pairs = new Set();
  const linkedLocations = new Set();
  for (const record of relationships) {
    if (relationshipIds.has(record.id)) throw invalid('duplicate_relationship');
    relationshipIds.add(record.id);
    if (!companies.has(record.organizationId)) throw invalid('unknown_reference');
    let pair;
    if (record.kind === 'enterprise_company_association') {
      if (!groups.has(record.enterpriseGroupId)) throw invalid('unknown_reference');
      pair = JSON.stringify([record.kind, record.enterpriseGroupId, record.organizationId]);
    } else {
      const location = JSON.stringify([record.organizationId, record.locationId]);
      if (!locations.has(location)) throw invalid('unknown_reference');
      linkedLocations.add(location);
      pair = JSON.stringify([record.kind, record.organizationId, record.locationId]);
    }
    if (pairs.has(pair)) throw invalid('duplicate_relationship');
    pairs.add(pair);
  }
  // A scoped location identity cannot silently create its own relationship.
  for (const location of locations) if (!linkedLocations.has(location)) throw invalid('missing_relationship');
  identities.sort(comparison(identityKey));
  relationships.sort(comparison(record => record.id));
  return Object.freeze({ contract: CONTRACT, identities: Object.freeze(identities), relationships: Object.freeze(relationships) });
}

// This checks only an explicitly supplied snapshot. It does not fetch an active
// profile, certify freshness, allocate a location, or authorize the caller.
function matchLegacyLocationSnapshot(reference, snapshot) {
  const record = normalizeIdentity(reference);
  if (record.kind !== 'legacy_location_reference') throw invalid('kind');
  const data = shape(snapshot, ['organizationId', 'profilePin', 'locationKeys']);
  const organizationId = uuid(data.organizationId);
  const pin = profilePin(data.profilePin);
  if (record.organizationId !== organizationId) throw invalid('scope_mismatch');
  if (record.profilePin.id !== pin.id || record.profilePin.version !== pin.version || record.profilePin.hash !== pin.hash) {
    throw invalid('profile_mismatch');
  }
  const keys = list(data.locationKeys, LIMITS.identities).map(legacyKey);
  const folded = new Set();
  for (const key of keys) {
    if (folded.has(key.toLowerCase())) throw invalid('ambiguous_legacy_reference');
    folded.add(key.toLowerCase());
  }
  if (!keys.includes(record.locationKey)) throw invalid('unknown_reference');
  return record;
}

module.exports = Object.freeze({
  CONTRACT, LIMITS, normalizeIdentity, normalizeRelationship, normalizeIdentityGraph, matchLegacyLocationSnapshot,
});
