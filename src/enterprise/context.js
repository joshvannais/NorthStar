'use strict';

const crypto = require('node:crypto');
const { isCanonicalAccessRole, hasPermission } = require('../auth/permissions');
const { normalizeIdentity, matchLegacyLocationSnapshot, LIMITS } = require('./identityContract');

const CONTRACT = 'northstar.enterprise.context.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REVISION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

class EnterpriseContextError extends Error {
  constructor(status, code) {
    super('Enterprise context is unavailable. Refresh the current account context.');
    this.name = 'EnterpriseContextError';
    this.status = status;
    this.code = code;
  }
}

function exactRecord(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && fields.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable;
  });
}

function validId(value) { return typeof value === 'string' && UUID.test(value); }
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function timeValue(value) {
  return value instanceof Date || typeof value === 'string' ? new Date(value).getTime() : NaN;
}

function validatePrincipal(principal) {
  if (!exactRecord(principal, ['actorUserId', 'sessionId', 'organizationId']) ||
      !Object.values(principal).every(validId)) throw new EnterpriseContextError(401, 'enterprise_session_required');
}

// This projection accepts only repository-owned rows. It is not an alternative
// authentication interface, and no returned binding authorizes another request.
function projectContext(row, principal) {
  validatePrincipal(principal);
  const now = row && timeValue(row.observed_at);
  if (!row || row.actor_user_id !== principal.actorUserId || row.session_id !== principal.sessionId ||
      row.organization_id !== principal.organizationId || row.user_organization_id !== principal.organizationId ||
      !validId(row.membership_id) || row.session_status !== 'active' || row.membership_status !== 'active' ||
      row.user_status !== 'active' || row.membership_revoked_at !== null || row.session_revoked_at !== null ||
      !isCanonicalAccessRole(row.role) || !hasPermission(row.role, 'settings', 'read') ||
      !['actor_version', 'membership_version', 'session_created_version', 'access_version', 'refresh_version']
        .every(key => typeof row[key] === 'string' && REVISION.test(row[key])) ||
      typeof row.csrf_token_hash !== 'string' || !/^[0-9a-f]{64}$/.test(row.csrf_token_hash) ||
      !Number.isFinite(now) || !(timeValue(row.access_expires_at) > now) ||
      !(timeValue(row.refresh_expires_at) > now)) {
    throw new EnterpriseContextError(403, 'enterprise_membership_required');
  }
  if (!validId(row.profile_id)) throw new EnterpriseContextError(503, 'enterprise_location_source_unavailable');
  const observedAt = new Date(row.observed_at).toISOString();
  const profilePin = { id: row.profile_id, version: row.version_label, hash: row.normalized_profile_hash };
  const raw = row.raw_profile;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new EnterpriseContextError(503, 'enterprise_location_source_unavailable');
  const offices = raw.headquarters && raw.headquarters.additionalOffices;
  if (offices !== undefined && !Array.isArray(offices)) throw new EnterpriseContextError(503, 'enterprise_location_source_unavailable');
  const locations = [{ key: 'headquarters', label: 'Headquarters' }];
  for (const office of offices || []) {
    if (!office || typeof office !== 'object' || typeof office.id !== 'string') {
      throw new EnterpriseContextError(503, 'enterprise_location_source_unavailable');
    }
    locations.push({ key: office.id, label: typeof office.name === 'string' && office.name ? office.name : office.id });
  }
  if (locations.length > LIMITS.identities) throw new EnterpriseContextError(503, 'enterprise_location_source_unavailable');
  const source = { organizationId: principal.organizationId, profilePin, locationKeys: locations.map(item => item.key) };
  let available;
  try {
    available = locations.map(item => {
      const reference = normalizeIdentity({
        kind: 'legacy_location_reference', organizationId: principal.organizationId, locationKey: item.key,
        profilePin, provenance: {
          declarationId: row.profile_id, declaredByActorId: principal.actorUserId, declaredAt: observedAt,
        },
      });
      // Reuse 1B's strict source-key ambiguity and exact pin matching contract.
      matchLegacyLocationSnapshot(reference, source);
      return Object.freeze({ label: item.label, reference });
    });
  } catch (_error) {
    throw new EnterpriseContextError(503, 'enterprise_location_source_unavailable');
  }
  // Revision text is read from PostgreSQL at microsecond precision. The digest
  // is a stale-snapshot/session comparison, never a signed or bearer grant.
  const binding = digest([
    CONTRACT, principal.actorUserId, principal.sessionId, principal.organizationId,
    row.membership_id, row.role, row.actor_version, row.membership_version,
    row.session_created_version, row.access_version, row.refresh_version, row.csrf_token_hash,
    profilePin.id, profilePin.version, profilePin.hash,
    locations.map(item => [item.key, item.label]),
  ]);
  return Object.freeze({
    contract: CONTRACT, binding, observedAt,
    actor: Object.freeze({ id: principal.actorUserId, role: row.role }),
    company: Object.freeze({ organizationId: principal.organizationId }),
    membership: Object.freeze({ id: row.membership_id }),
    source: Object.freeze({ kind: 'canonical_business_profile', profilePin: available[0].reference.profilePin }),
    locations: Object.freeze(available), selectedLocation: null,
  });
}

function resolveSelection(context, input) {
  if (!exactRecord(input, ['contract', 'binding', 'location']) || input.contract !== CONTRACT ||
      typeof input.binding !== 'string' || !/^[0-9a-f]{64}$/.test(input.binding)) {
    throw new EnterpriseContextError(400, 'enterprise_selection_invalid');
  }
  if (input.binding !== context.binding) throw new EnterpriseContextError(409, 'enterprise_context_changed');
  let requested;
  try {
    requested = matchLegacyLocationSnapshot(input.location, {
      organizationId: context.company.organizationId, profilePin: context.source.profilePin,
      locationKeys: context.locations.map(item => item.reference.locationKey),
    });
  } catch (_error) {
    throw new EnterpriseContextError(409, 'enterprise_location_unavailable');
  }
  const selectedLocation = context.locations.find(item => item.reference.locationKey === requested.locationKey);
  // Return the fresh server projection, not caller-supplied declaration data.
  return Object.freeze({ ...context, selectedLocation });
}

module.exports = { CONTRACT, EnterpriseContextError, validatePrincipal, projectContext, resolveSelection };
