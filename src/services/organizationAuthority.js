'use strict';

const {
  adaptBusinessProfile,
  FINANCIAL_CONFIGURATION_FIELDS,
  stableValue,
  validateRawBusinessProfile,
} = require('./businessProfileAdapter');
const {
  applyProfileReadinessChanges,
  transitionCompatibleProfileReadiness,
} = require('./profileReadiness');
const repository = require('../persistence/v2/repository');

const LEGACY_FINANCIAL_AUTHORITY_FIELDS = Object.freeze([
  'markup', 'taxRate', 'emergencyMarkup', 'travelCharge', 'minimumJobPrice',
  'desiredGrossMargin', 'desiredNetMargin', 'maximumDiscount',
]);

function authorityError(code, message, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requirePool(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw authorityError(
      'CANONICAL_PERSISTENCE_UNAVAILABLE',
      'Canonical PostgreSQL persistence is unavailable.',
      503
    );
  }
  return pool;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidBusinessProfile(errors) {
  const error = authorityError(
    'INVALID_BUSINESS_PROFILE',
    'Business Profile validation failed.',
    400
  );
  error.details = errors;
  return error;
}

function validatedRawProfile(profile) {
  const value = profile === undefined ? {} : profile;
  const errors = validateRawBusinessProfile(value);
  if (errors.length) throw invalidBusinessProfile(errors);
  return stableValue(value);
}

function defineOwn(target, key, value) {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function preserveAuthorityFields(candidate, active, section, fields) {
  const candidateHasSection = isPlainObject(candidate[section]);
  const activeHasSection = hasOwn(active, section) && isPlainObject(active[section]);
  const activeSection = isPlainObject(active[section]) ? active[section] : null;
  const nextSection = candidateHasSection ? { ...candidate[section] } : {};

  for (const field of fields) {
    if (activeSection && hasOwn(activeSection, field)) {
      defineOwn(nextSection, field, clone(activeSection[field]));
    } else {
      delete nextSection[field];
    }
  }

  if (activeHasSection || Object.keys(nextSection).length > 0) defineOwn(candidate, section, nextSection);
  else delete candidate[section];
}

function preserveFinancialConfiguration(candidate, active) {
  const updated = { ...candidate };
  const current = isPlainObject(active) ? active : {};
  for (const [section, fields] of Object.entries(FINANCIAL_CONFIGURATION_FIELDS)) {
    preserveAuthorityFields(updated, current, section, fields);
  }
  preserveAuthorityFields(updated, current, 'financial', LEGACY_FINANCIAL_AUTHORITY_FIELDS);
  return updated;
}

function preserveTopLevelField(candidate, active, field) {
  const updated = { ...candidate };
  if (hasOwn(active, field)) defineOwn(updated, field, clone(active[field]));
  else delete updated[field];
  return updated;
}

function profilesEqual(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function projectProfile(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    versionNumber: Number(row.version_number),
    versionLabel: row.version_label,
    profileHash: row.normalized_profile_hash,
    rawProfile: clone(row.raw_profile),
    normalizedProfile: Object.freeze(clone(row.normalized_profile)),
    createdBy: row.created_by,
    createdAt: row.created_at,
  });
}

async function getActiveBusinessProfile(pool, organizationId) {
  const result = await requirePool(pool).query(
    `SELECT id, organization_id, version_number, version_label, raw_profile,
            normalized_profile, normalized_profile_hash, created_by, created_at
       FROM canonical_business_profiles
      WHERE organization_id = $1 AND is_active = TRUE`,
    [organizationId]
  );
  if (result.rows.length !== 1) {
    throw authorityError(
      'CANONICAL_BUSINESS_PROFILE_REQUIRED',
      'An active organization Business Profile is required.',
      503
    );
  }
  return projectProfile(result.rows[0]);
}

async function getBusinessProfileById(pool, organizationId, profileId) {
  const result = await requirePool(pool).query(
    `SELECT id, organization_id, version_number, version_label, raw_profile,
            normalized_profile, normalized_profile_hash, created_by, created_at
       FROM canonical_business_profiles
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, profileId]
  );
  if (result.rows.length !== 1) {
    throw authorityError(
      'CANONICAL_BUSINESS_PROFILE_REQUIRED',
      'The pinned organization Business Profile is unavailable.',
      503
    );
  }
  return projectProfile(result.rows[0]);
}

async function putBusinessProfile(pool, input) {
  const source = requirePool(pool);
  let rawProfile = validatedRawProfile(input.profile || {});
  return repository.withTransaction(source, async function (client) {
    const organization = await client.query(
      'SELECT id FROM organizations WHERE id = $1 FOR UPDATE',
      [input.organizationId]
    );
    if (organization.rows.length !== 1) {
      throw authorityError('ORGANIZATION_NOT_FOUND', 'Organization not found.', 404);
    }
    let active = null;
    const writesProfileReadiness = Array.isArray(input.profileReadinessChanges);
    const preserveProfileReadiness = !writesProfileReadiness && input.preserveProfileReadiness !== false;
    if (hasOwn(input, 'expectedVersion') || input.preserveVoiceAssistant === true ||
        input.preserveFinancialConfiguration === true || preserveProfileReadiness || writesProfileReadiness) {
      active = await client.query(
        `SELECT version_label, raw_profile
           FROM canonical_business_profiles
          WHERE organization_id = $1 AND is_active = TRUE`,
        [input.organizationId]
      );
      if (active.rows.length > 1) {
        throw authorityError('CANONICAL_PROFILE_CONFLICT', 'Multiple active Business Profiles were found.', 409);
      }
    }
    const activeRawProfile = active && active.rows.length === 1 && isPlainObject(active.rows[0].raw_profile)
      ? active.rows[0].raw_profile : {};
    if (hasOwn(input, 'expectedVersion')) {
      const actualVersion = active.rows.length === 1 ? active.rows[0].version_label : null;
      const expectedVersion = input.expectedVersion === null ? null : String(input.expectedVersion);
      if (actualVersion !== expectedVersion) {
        throw authorityError(
          'BUSINESS_PROFILE_VERSION_CONFLICT',
          'Business Profile changed; reload and try again.',
          409
        );
      }
    }
    if (writesProfileReadiness) {
      const readinessBase = active.rows.length === 1 ? activeRawProfile : rawProfile;
      rawProfile = applyProfileReadinessChanges(
        readinessBase,
        input.profileReadinessChanges,
        new Date()
      );
    }
    if (input.preserveVoiceAssistant === true) {
      if (hasOwn(activeRawProfile, 'voiceAssistant')) {
        rawProfile.voiceAssistant = stableValue(activeRawProfile.voiceAssistant);
      } else {
        delete rawProfile.voiceAssistant;
      }
      rawProfile = stableValue(rawProfile);
    }
    if (input.preserveFinancialConfiguration === true) {
      const mutationCandidate = validatedRawProfile(
        hasOwn(input, 'financialMutationCandidate') ? input.financialMutationCandidate : rawProfile
      );
      const containedCandidate = preserveFinancialConfiguration(mutationCandidate, activeRawProfile);
      const attemptedFinancialMutation = !profilesEqual(mutationCandidate, containedCandidate);
      if (attemptedFinancialMutation && profilesEqual(containedCandidate, activeRawProfile)) {
        throw authorityError(
          'FINANCIAL_CONFIGURATION_ROUTE_REQUIRED',
          'Financial Configuration changes require the versioned Financial Configuration endpoint.',
          409
        );
      }
      rawProfile = preserveFinancialConfiguration(rawProfile, activeRawProfile);
    }
    if (preserveProfileReadiness) {
      const mutationCandidate = validatedRawProfile(rawProfile);
      const containedCandidate = preserveTopLevelField(mutationCandidate, activeRawProfile, 'profileReadiness');
      const attemptedReadinessMutation = !profilesEqual(mutationCandidate, containedCandidate);
      if (attemptedReadinessMutation && profilesEqual(containedCandidate, activeRawProfile)) {
        throw authorityError(
          'PROFILE_READINESS_ROUTE_REQUIRED',
          'Profile Readiness changes require the dedicated versioned endpoint.',
          409
        );
      }
      rawProfile = transitionCompatibleProfileReadiness(activeRawProfile, containedCandidate);
    }
    rawProfile = validatedRawProfile(rawProfile);
    const sequence = await client.query(
      `SELECT COALESCE(MAX(version_number), 0)::bigint + 1 AS next_version
         FROM canonical_business_profiles
        WHERE organization_id = $1`,
      [input.organizationId]
    );
    const versionNumber = Number(sequence.rows[0].next_version);
    const versionLabel = 'org-profile-v' + versionNumber;
    const normalized = adaptBusinessProfile(rawProfile, versionLabel);
    await client.query(
      `UPDATE canonical_business_profiles
          SET is_active = FALSE, retired_at = NOW()
        WHERE organization_id = $1 AND is_active = TRUE`,
      [input.organizationId]
    );
    const inserted = await client.query(
      `INSERT INTO canonical_business_profiles
        (organization_id, version_number, version_label, raw_profile,
         normalized_profile, normalized_profile_hash, is_active, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,TRUE,$7)
       RETURNING id, organization_id, version_number, version_label, raw_profile,
                 normalized_profile, normalized_profile_hash, created_by, created_at`,
      [input.organizationId, versionNumber, versionLabel, JSON.stringify(rawProfile),
        JSON.stringify(normalized), normalized.hash, input.userId || null]
    );
    await client.query(
      `INSERT INTO organization_onboarding (
         organization_id, status, active_business_profile_id, completed_at
       ) VALUES ($1, 'complete', $2, NOW())
       ON CONFLICT (organization_id) DO UPDATE SET
         status = 'complete',
         active_business_profile_id = EXCLUDED.active_business_profile_id,
         completed_at = NOW(),
         updated_at = NOW()`,
      [input.organizationId, inserted.rows[0].id]
    );
    return projectProfile(inserted.rows[0]);
  });
}

async function putProfileReadiness(pool, input) {
  return putBusinessProfile(pool, {
    organizationId: input.organizationId,
    userId: input.userId,
    profile: input.profile,
    expectedVersion: input.expectedVersion,
    profileReadinessChanges: input.changes,
    preserveProfileReadiness: false,
  });
}

async function resolveIntegrationOwner(pool, provider, externalIntegrationId) {
  const identifier = String(externalIntegrationId || '').trim();
  if (!identifier) {
    throw authorityError('INTEGRATION_OWNERSHIP_UNKNOWN', 'Integration ownership is not recognized.', 404);
  }
  const result = await requirePool(pool).query(
    `SELECT id, organization_id, provider, external_integration_id, status, metadata
       FROM canonical_integration_ownership
      WHERE provider = $1 AND external_integration_id = $2 AND status = 'active'`,
    [String(provider), identifier]
  );
  if (result.rows.length !== 1) {
    throw authorityError('INTEGRATION_OWNERSHIP_UNKNOWN', 'Integration ownership is not recognized.', 404);
  }
  return Object.freeze({
    id: result.rows[0].id,
    organizationId: result.rows[0].organization_id,
    provider: result.rows[0].provider,
    externalIntegrationId: result.rows[0].external_integration_id,
    metadata: clone(result.rows[0].metadata),
  });
}

async function getOrganizationIntegration(pool, organizationId, provider) {
  const result = await requirePool(pool).query(
    `SELECT id, organization_id, provider, external_integration_id, status, metadata
       FROM canonical_integration_ownership
      WHERE organization_id = $1 AND provider = $2 AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 2`,
    [organizationId, provider]
  );
  if (result.rows.length !== 1) {
    throw authorityError('INTEGRATION_OWNERSHIP_UNKNOWN', 'Integration ownership is not recognized.', 404);
  }
  return result.rows[0];
}

async function getProvisionedDemoOrganization(pool, configuredOrganizationId) {
  const organizationId = String(configuredOrganizationId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
    throw authorityError('DEMO_UNAVAILABLE', 'The public demo is not provisioned.', 503);
  }
  const result = await requirePool(pool).query(
    `SELECT d.organization_id
       FROM canonical_demo_authority d
       JOIN organizations o ON o.id = d.organization_id
      WHERE d.organization_id = $1 AND d.status = 'active'`,
    [organizationId]
  );
  if (result.rows.length !== 1) {
    throw authorityError('DEMO_UNAVAILABLE', 'The public demo is not provisioned.', 503);
  }
  return Object.freeze({ organizationId: result.rows[0].organization_id });
}

async function bindIntegrationOwner(pool, input) {
  const identifier = String(input.externalIntegrationId || '').trim();
  if (!identifier) throw authorityError('INVALID_INTEGRATION_ID', 'Integration identifier is required.', 400);
  const result = await requirePool(pool).query(
    `INSERT INTO canonical_integration_ownership
      (organization_id, provider, external_integration_id, status, metadata, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     ON CONFLICT (provider, external_integration_id) DO UPDATE
       SET status = EXCLUDED.status, metadata = EXCLUDED.metadata, updated_at = NOW()
       WHERE canonical_integration_ownership.organization_id = EXCLUDED.organization_id
     RETURNING id, organization_id, provider, external_integration_id, status, metadata`,
    [input.organizationId, input.provider, identifier, input.status || 'active',
      JSON.stringify(stableValue(input.metadata || {})), input.userId || null]
  );
  if (result.rows.length !== 1) {
    throw authorityError('INTEGRATION_OWNERSHIP_CONFLICT', 'Integration ownership conflicts with another organization.', 409);
  }
  return result.rows[0];
}

module.exports = {
  authorityError,
  bindIntegrationOwner,
  getActiveBusinessProfile,
  getBusinessProfileById,
  getProvisionedDemoOrganization,
  getOrganizationIntegration,
  projectProfile,
  putBusinessProfile,
  putProfileReadiness,
  resolveIntegrationOwner,
};
