'use strict';

const AUTHORITY = 'canonical_map_preferences_v1';
const CONTRACT_VERSION = 1;
const PROVIDERS = Object.freeze([
  Object.freeze({ key: 'google_maps', name: 'Google Maps' }),
  Object.freeze({ key: 'apple_maps', name: 'Apple Maps' }),
  Object.freeze({ key: 'waze', name: 'Waze' }),
]);
const PROVIDER_KEYS = Object.freeze(PROVIDERS.map(provider => provider.key));
const ROLE_KEYS = new Set(['owner', 'admin', 'member', 'viewer']);

class MapPreferenceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'MapPreferenceError';
    this.status = status;
    this.code = code;
  }
}

function failInvalid() {
  throw new MapPreferenceError(400, 'MAP_PREFERENCES_INVALID', 'Map preferences are invalid.');
}

function failAuthority() {
  throw new MapPreferenceError(
    503,
    'MAP_PREFERENCES_AUTHORITY_INVALID',
    'Canonical map preference authority is invalid.'
  );
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasExactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every(key => expected.includes(key));
}

function withinEnvelope(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= 4096;
  } catch (_error) {
    return false;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function defaultPreferenceDocument() {
  return deepFreeze({
    providers: {
      google_maps: { enabled: true, visible: true },
      apple_maps: { enabled: true, visible: true },
      waze: { enabled: true, visible: true },
    },
    defaultProvider: 'google_maps',
  });
}

function parsePreferenceDocument(input, failure = failInvalid) {
  if (!hasExactKeys(input, ['providers', 'defaultProvider']) ||
      !hasExactKeys(input.providers, PROVIDER_KEYS) ||
      !PROVIDER_KEYS.includes(input.defaultProvider)) failure();

  const providers = {};
  for (const key of PROVIDER_KEYS) {
    const provider = input.providers[key];
    if (!hasExactKeys(provider, ['enabled', 'visible']) ||
        typeof provider.enabled !== 'boolean' || typeof provider.visible !== 'boolean') failure();
    providers[key] = { enabled: provider.enabled, visible: provider.visible };
  }
  if (!PROVIDER_KEYS.some(key => providers[key].enabled) ||
      !providers[input.defaultProvider].enabled) failure();
  return { providers, defaultProvider: input.defaultProvider };
}

function safeVersion(value, minimum, failure) {
  if (!Number.isSafeInteger(value) || value < minimum) failure();
  return value;
}

function parseOrganizationWrite(input) {
  if (!withinEnvelope(input) || !hasExactKeys(input, ['expectedVersion', 'preferences'])) failInvalid();
  return deepFreeze({
    expectedVersion: safeVersion(input.expectedVersion, 1, failInvalid),
    preferences: parsePreferenceDocument(input.preferences),
  });
}

function parseUserWrite(input) {
  if (!withinEnvelope(input) || !isObject(input) || !['inherit', 'override'].includes(input.mode)) {
    failInvalid();
  }
  const expected = input.mode === 'inherit'
    ? ['expectedVersion', 'mode']
    : ['expectedVersion', 'mode', 'preferences'];
  if (!hasExactKeys(input, expected)) failInvalid();
  const result = {
    expectedVersion: safeVersion(input.expectedVersion, 0, failInvalid),
    mode: input.mode,
  };
  if (input.mode === 'override') result.preferences = parsePreferenceDocument(input.preferences);
  return deepFreeze(result);
}

function persistedVersion(value) {
  if (typeof value !== 'string' && typeof value !== 'number') failAuthority();
  const number = Number(value);
  return safeVersion(number, 1, failAuthority);
}

function persistedTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || !Number.isFinite(date.getTime())) failAuthority();
  return date.toISOString();
}

function documentFromRow(row) {
  const input = {
    providers: {
      google_maps: { enabled: row.google_maps_enabled, visible: row.google_maps_visible },
      apple_maps: { enabled: row.apple_maps_enabled, visible: row.apple_maps_visible },
      waze: { enabled: row.waze_enabled, visible: row.waze_visible },
    },
    defaultProvider: row.default_provider,
  };
  try {
    return parsePreferenceDocument(input, failAuthority);
  } catch (error) {
    if (error instanceof MapPreferenceError) throw error;
    failAuthority();
  }
  return null;
}

function organizationProjection(row) {
  if (!isObject(row) || !['system_default', 'user'].includes(row.authority_source)) failAuthority();
  return {
    version: persistedVersion(row.version),
    preferences: documentFromRow(row),
    source: row.authority_source,
    updatedAt: persistedTimestamp(row.updated_at),
  };
}

function userProjection(row) {
  if (row === null || row === undefined) {
    return {
      version: 0,
      mode: 'inherit',
      hasStoredAuthority: false,
      preferences: null,
      updatedAt: null,
    };
  }
  if (!isObject(row) || !['inherit', 'override'].includes(row.mode)) failAuthority();
  const stored = {
    version: persistedVersion(row.version),
    mode: row.mode,
    hasStoredAuthority: true,
    preferences: null,
    updatedAt: persistedTimestamp(row.updated_at),
  };
  if (row.mode === 'inherit') {
    for (const key of PROVIDER_KEYS) {
      if (row[`${key}_enabled`] !== null || row[`${key}_visible`] !== null) failAuthority();
    }
    if (row.default_provider !== null) failAuthority();
  } else {
    stored.preferences = documentFromRow(row);
  }
  return stored;
}

function projectMapPreferences(input) {
  if (!isObject(input) || !ROLE_KEYS.has(input.role)) failAuthority();
  const organization = organizationProjection(input.organization);
  const user = userProjection(input.user);
  const inheritsOrganization = user.mode === 'inherit';
  const effectivePreferences = inheritsOrganization ? organization.preferences : user.preferences;
  return deepFreeze({
    authority: AUTHORITY,
    contractVersion: CONTRACT_VERSION,
    providers: PROVIDERS,
    organization,
    user,
    effective: {
      source: inheritsOrganization ? 'organization' : 'user_override',
      inheritsOrganization,
      organizationVersion: organization.version,
      userVersion: user.version,
      preferences: effectivePreferences,
    },
    permissions: {
      canUpdateOrganization: input.role === 'owner' || input.role === 'admin',
      canUpdateSelf: true,
    },
  });
}

module.exports = {
  AUTHORITY,
  CONTRACT_VERSION,
  MapPreferenceError,
  PROVIDERS,
  defaultPreferenceDocument,
  parseOrganizationWrite,
  parseUserWrite,
  projectMapPreferences,
};
