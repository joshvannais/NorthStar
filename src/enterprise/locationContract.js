'use strict';

const CONTRACT = 'northstar.enterprise.location-lifecycle.v1';
const REVIEW = 'northstar.enterprise.location-review.v1';
const CANONICAL_CONTEXT = 'northstar.enterprise.canonical-location-context.v1';
const BASE_FIELDS = ['contract', 'action', 'locationId', 'expected', 'change', 'reason', 'profilePin'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

class EnterpriseLocationError extends Error {
  constructor(status, code = 'enterprise_location_unavailable') {
    super('Location administration is unavailable. Refresh and review the current location again.');
    this.name = 'EnterpriseLocationError'; this.status = status; this.code = code;
  }
}
function invalid() { throw new EnterpriseLocationError(400, 'enterprise_location_invalid'); }
function own(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length) return invalid();
  const result = Object.create(null);
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return invalid();
    result[key] = descriptor.value;
  }
  return result;
}
function uuid(value) { if (typeof value !== 'string' || value.length !== 36 || !UUID.test(value)) return invalid(); return value; }
function hash(value) { if (typeof value !== 'string' || value.length !== 64 || !HASH.test(value)) return invalid(); return value; }
function text(value, maximum, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value.isWellFormed() || value.length < 1 || [...value].length > maximum ||
      Buffer.byteLength(value, 'utf8') > maximum * 4 || /^ | $/.test(value) || /[\u0000-\u001f\u007f]/.test(value)) return invalid();
  return value;
}
function pin(value, empty = false) {
  const data = own(value, ['id', 'revision', 'digest']);
  if (empty && data.id === null && data.revision === 0 && data.digest === null) return Object.freeze({ id: null, revision: 0, digest: null });
  if (!Number.isSafeInteger(data.revision) || data.revision < 1 || data.revision > 2147483647) return invalid();
  return Object.freeze({ id: uuid(data.id), revision: data.revision, digest: hash(data.digest) });
}
function sourcePin(value) {
  const data = own(value, ['id', 'version', 'hash']);
  if (typeof data.version !== 'string' || data.version.length > 100 || !/^org-profile-v[1-9][0-9]*$/.test(data.version)) return invalid();
  return Object.freeze({ id: uuid(data.id), version: data.version, hash: hash(data.hash) });
}
function normalize(raw, committed = false) {
  const body = own(raw, committed ? [...BASE_FIELDS, 'review'] : BASE_FIELDS);
  if (body.contract !== CONTRACT || !['create', 'activate', 'deactivate', 'rename', 'correct', 'relocate', 'transfer'].includes(body.action)) return invalid();
  let change;
  switch (body.action) {
    case 'create': {
      const value = own(body.change, ['name', 'address']);
      change = { name: text(value.name, 160), address: text(value.address, 500, true) }; break;
    }
    case 'activate': case 'deactivate': own(body.change, []); change = {}; break;
    case 'rename': { const value = own(body.change, ['name']); change = { name: text(value.name, 160) }; break; }
    case 'relocate': { const value = own(body.change, ['address']); change = { address: text(value.address, 500) }; break; }
    case 'correct': {
      const value = own(body.change, ['name', 'address', 'correctedRevision']);
      change = { name: text(value.name, 160), address: text(value.address, 500, true), correctedRevision: pin(value.correctedRevision) }; break;
    }
    case 'transfer': {
      const value = own(body.change, ['target']), target = own(value.target, ['locationId', 'pin']);
      change = { target: Object.freeze({ locationId: uuid(target.locationId), pin: pin(target.pin) }) }; break;
    }
  }
  const result = {
    contract: CONTRACT, action: body.action, locationId: uuid(body.locationId),
    expected: pin(body.expected, body.action === 'create'), change: Object.freeze(change),
    reason: text(body.reason, 2000), profilePin: sourcePin(body.profilePin),
  };
  if (committed) {
    const review = own(body.review, ['contract', 'digest', 'confirmed']);
    if (review.contract !== REVIEW || review.confirmed !== true) return invalid();
    result.review = Object.freeze({ contract: REVIEW, digest: hash(review.digest), confirmed: true });
  }
  return Object.freeze(result);
}

module.exports = { CONTRACT, REVIEW, CANONICAL_CONTEXT, EnterpriseLocationError, own, uuid, hash, pin, sourcePin, normalize };
