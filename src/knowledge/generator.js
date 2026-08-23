'use strict';

const crypto = require('crypto');
const {
  canonicalStringify,
  normalizeInitialDraft,
  normalizeUuid,
} = require('./contract');
const {
  sha256: businessProfileHash,
  validateCanonicalBusinessProfile,
  validateOperationalBusinessProfile,
  validateRawBusinessProfile,
} = require('../services/businessProfileAdapter');

const GENERATOR_VERSION = 'm21-p2-v1';
const GENERATION_REASON = 'Generate reproducible Mission 21 Part 2 drafts from pinned NorthStar authorities.';
const PRECEDENCE = Object.freeze([
  'business_profile.raw_configured',
  'business_profile.same_version_normalized_projection',
  'normalized_workforce',
  'normalized_asset_catalogue',
]);
const PROFILE_VERSION = /^org-profile-v[1-9][0-9]*$/;

const GENERATOR_CONTRACT = Object.freeze({
  documents: Object.freeze([
    'organization.availability',
    'organization.customer-guidance',
    'organization.financial-constraints',
    'organization.identity',
    'organization.operational-capabilities',
    'organization.services',
    'organization.voice-guidance',
  ]),
  missingFacts: 'needs_review',
  conflictingFacts: 'needs_review',
  publication: 'never',
  providerTransport: 'never',
  precedence: PRECEDENCE,
  version: GENERATOR_VERSION,
});

class KnowledgeGenerationError extends Error {
  constructor(code, message, status = 409, details = []) {
    super(message);
    this.name = 'KnowledgeGenerationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status, details) {
  throw new KnowledgeGenerationError(code, message, status, details);
}

function plainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value, key) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function canonicalDigest(value) {
  return crypto.createHash('sha256')
    .update(canonicalStringify(canonicalSourceValue(value)), 'utf8')
    .digest('hex');
}

function compareCanonical(left, right) {
  return Buffer.compare(
    Buffer.from(canonicalStringify(left), 'utf8'),
    Buffer.from(canonicalStringify(right), 'utf8')
  );
}

function canonicalCopy(value) {
  return JSON.parse(canonicalStringify(value));
}

function canonicalSourceValue(value) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('knowledge_source_invalid', 'Knowledge source numbers must be finite.', 503);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(canonicalSourceValue);
  if (!plainObject(value)) {
    fail('knowledge_source_invalid', 'Knowledge sources must contain JSON-compatible values.', 503);
  }
  const output = Object.create(null);
  const keys = new Set();
  for (const originalKey of Object.keys(value)) {
    const key = originalKey.normalize('NFC');
    if (keys.has(key)) {
      fail(
        'knowledge_source_conflict',
        'Knowledge source keys collide after Unicode normalization.',
        409,
        [key]
      );
    }
    keys.add(key);
    output[key] = canonicalSourceValue(value[originalKey]);
  }
  return output;
}

function configured(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (plainObject(value)) return Object.keys(value).length > 0;
  return true;
}

function pointer(parts) {
  return '/' + parts.map(part => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

function readPath(source, parts) {
  let value = source;
  for (const part of parts) {
    if (!plainObject(value) || !hasOwn(value, part)) return { present: false, value: undefined };
    value = value[part];
  }
  return { present: configured(value), value };
}

function issue(code, path, message, sources) {
  return {
    code,
    message,
    path,
    sources: Array.from(new Set(sources || [])).sort(),
  };
}

function sortIssues(issues) {
  return issues.slice().sort((left, right) => {
    const pathOrder = Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8'));
    if (pathOrder !== 0) return pathOrder;
    return Buffer.compare(Buffer.from(left.code, 'utf8'), Buffer.from(right.code, 'utf8'));
  });
}

function setVerifiedFact(target, key, value) {
  target[key] = canonicalCopy(value);
}

function resolveRawFact(options) {
  const raw = readPath(options.rawProfile, options.rawPath);
  if (!raw.present) {
    if (options.required) {
      options.issues.push(issue(
        'missing_authoritative_fact',
        pointer(['rawProfile', ...options.rawPath]),
        'No configured authoritative value is available; NorthStar did not invent one.',
        ['business_profile.raw_configured']
      ));
    }
    return;
  }

  if (options.normalizedPath) {
    const normalized = readPath(options.normalizedProfile, options.normalizedPath);
    if (!normalized.present || canonicalStringify(raw.value) !== canonicalStringify(normalized.value)) {
      options.issues.push(issue(
        'conflicting_authoritative_fact',
        pointer(['rawProfile', ...options.rawPath]),
        'The configured value conflicts with its same-version normalized projection and remains unresolved.',
        [
          'business_profile.raw_configured',
          'business_profile.same_version_normalized_projection',
        ]
      ));
      return;
    }
  }
  setVerifiedFact(options.target, options.key, raw.value);
}

function verifyProfileAuthority(profile) {
  if (!plainObject(profile)) {
    fail('knowledge_profile_invalid', 'Canonical Business Profile authority is unavailable.', 503);
  }
  const id = normalizeUuid(profile.id, 'profile.id');
  const organizationId = normalizeUuid(profile.organizationId, 'profile.organizationId');
  const versionNumber = Number(profile.versionNumber);
  const versionLabel = typeof profile.versionLabel === 'string' ? profile.versionLabel : '';
  const storedHash = typeof profile.profileHash === 'string' ? profile.profileHash.toLowerCase() : '';
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1 || !PROFILE_VERSION.test(versionLabel)) {
    fail('knowledge_profile_invalid', 'Canonical Business Profile version evidence is invalid.', 503);
  }
  if (!/^[0-9a-f]{64}$/.test(storedHash) || !plainObject(profile.rawProfile) ||
      !plainObject(profile.normalizedProfile)) {
    fail('knowledge_profile_invalid', 'Canonical Business Profile digest evidence is invalid.', 503);
  }
  const profileErrors = validateRawBusinessProfile(profile.rawProfile);
  const semanticErrors = profileErrors.length === 0
    ? [
        ...validateOperationalBusinessProfile(profile.rawProfile),
        ...validateCanonicalBusinessProfile(profile.rawProfile),
      ]
    : [];
  if (profileErrors.length > 0 || semanticErrors.length > 0) {
    fail(
      'knowledge_profile_invalid',
      'Canonical Business Profile content does not satisfy its source contract.',
      503,
      [...profileErrors, ...semanticErrors]
    );
  }
  const normalized = canonicalCopy(profile.normalizedProfile);
  const embeddedHash = normalized.hash;
  delete normalized.hash;
  if (embeddedHash !== storedHash || businessProfileHash(normalized) !== storedHash) {
    fail('knowledge_profile_digest_mismatch', 'Canonical Business Profile digest verification failed.', 503);
  }
  return {
    id,
    organizationId,
    versionNumber,
    versionLabel,
    profileHash: storedHash,
    rawProfile: canonicalCopy(profile.rawProfile),
    normalizedProfile: canonicalCopy(profile.normalizedProfile),
  };
}

function stableRows(rows, fields, identityField) {
  if (!Array.isArray(rows)) {
    fail('knowledge_source_invalid', 'Normalized authority rows must be an array.', 503);
  }
  const seen = new Set();
  const output = rows.map(row => {
    if (!plainObject(row)) fail('knowledge_source_invalid', 'Normalized authority row is invalid.', 503);
    const projected = {};
    for (const field of fields) {
      if (hasOwn(row, field) && row[field] !== undefined) projected[field] = canonicalCopy(row[field]);
    }
    const identity = String(projected[identityField] || '').trim().toLowerCase();
    if (!identity || seen.has(identity)) {
      fail('knowledge_source_conflict', 'Normalized authority contains a missing or duplicate identity.', 409, [identityField]);
    }
    seen.add(identity);
    return projected;
  });
  return output.sort(compareCanonical);
}

function stableRelations(rows, fields) {
  if (!Array.isArray(rows)) {
    fail('knowledge_source_invalid', 'Normalized authority relations must be an array.', 503);
  }
  const seen = new Set();
  const output = rows.map(row => {
    if (!plainObject(row)) fail('knowledge_source_invalid', 'Normalized authority relation is invalid.', 503);
    const projected = {};
    for (const field of fields) {
      if (!hasOwn(row, field)) fail('knowledge_source_invalid', 'Normalized authority relation is incomplete.', 503);
      projected[field] = canonicalCopy(row[field]);
    }
    const identity = canonicalStringify(projected);
    if (seen.has(identity)) fail('knowledge_source_conflict', 'Normalized authority relation is duplicated.', 409);
    seen.add(identity);
    return projected;
  });
  return output.sort(compareCanonical);
}

function normalizeAuthorities(input) {
  if (!plainObject(input)) fail('knowledge_source_invalid', 'Knowledge authority bundle is required.', 400);
  const profile = verifyProfileAuthority(input.profile);
  const workforce = plainObject(input.workforce) ? input.workforce : {};
  const assets = plainObject(input.assets) ? input.assets : {};
  const normalizedWorkforce = {
    skills: stableRows(
      workforce.skills || [],
      ['id', 'skillKey', 'name', 'description', 'serviceId'],
      'id'
    ),
    crews: stableRows(
      workforce.crews || [],
      ['id', 'crewKey', 'name', 'homeLocationId'],
      'id'
    ),
    crewMembers: stableRelations(
      workforce.crewMembers || [],
      ['crewId', 'profileId', 'crewRole']
    ),
  };
  const normalizedAssets = {
    items: stableRows(
      assets.items || [],
      [
        'id', 'category', 'name', 'internalReference', 'manufacturer', 'model',
        'modelYear', 'configuration', 'homeLocationId', 'catalogueState', 'version',
      ],
      'id'
    ),
    capabilities: stableRelations(assets.capabilities || [], ['assetId', 'serviceId']),
  };
  const normalizedProfileContent = canonicalSourceValue(profile.normalizedProfile);
  delete normalizedProfileContent.hash;
  const profileRecord = {
    id: profile.id,
    organizationId: profile.organizationId,
    rawProfile: profile.rawProfile,
    normalizedProfile: normalizedProfileContent,
    normalizedProfileDigest: canonicalDigest(normalizedProfileContent),
    versionLabel: profile.versionLabel,
    versionNumber: profile.versionNumber,
  };
  const profileDigest = canonicalDigest(profileRecord);
  const workforceDigest = canonicalDigest(normalizedWorkforce);
  const assetDigest = canonicalDigest(normalizedAssets);
  return {
    profile,
    workforce: normalizedWorkforce,
    assets: normalizedAssets,
    sources: {
      profile: {
        sourceType: 'business_profile',
        sourceRecordId: profile.id,
        sourceVersion: profile.versionLabel,
        sourceDigest: profileDigest,
      },
      workforce: {
        sourceType: 'workforce',
        sourceRecordId: `organization:${profile.organizationId}`,
        sourceVersion: `snapshot-${workforceDigest.slice(0, 32)}`,
        sourceDigest: workforceDigest,
      },
      assets: {
        sourceType: 'asset_catalogue',
        sourceRecordId: `organization:${profile.organizationId}`,
        sourceVersion: `snapshot-${assetDigest.slice(0, 32)}`,
        sourceDigest: assetDigest,
      },
      generator: {
        sourceType: 'system_generation',
        sourceRecordId: 'northstar-knowledge-generator',
        sourceVersion: GENERATOR_VERSION,
        sourceDigest: canonicalDigest(GENERATOR_CONTRACT),
      },
    },
  };
}

function provenanceLink(source, jsonPointer) {
  return { ...source, jsonPointer };
}

function dedupeProvenance(links) {
  const seen = new Set();
  return links.filter(link => {
    const identity = canonicalStringify(link);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function createDraft(authority, input) {
  const sortedIssues = sortIssues(input.issues);
  const provenance = dedupeProvenance([
    provenanceLink(authority.sources.generator, ''),
    ...input.provenance,
  ]);
  const dependencyDigest = canonicalDigest({
    generator: authority.sources.generator.sourceDigest,
    sources: provenance.map(link => ({
      jsonPointer: link.jsonPointer,
      sourceDigest: link.sourceDigest,
      sourceRecordId: link.sourceRecordId,
      sourceType: link.sourceType,
      sourceVersion: link.sourceVersion,
    })),
  });
  return normalizeInitialDraft({
    organizationId: authority.profile.organizationId,
    actorUserId: input.actorUserId,
    canonicalKey: input.canonicalKey,
    entryType: input.entryType,
    label: input.label,
    sensitivity: input.sensitivity,
    reviewRequirement: input.reviewRequirement,
    origin: 'generated',
    applicability: {},
    content: {
      facts: input.facts,
      generation: {
        dependencyDigest,
        generatorVersion: GENERATOR_VERSION,
        precedence: PRECEDENCE,
      },
      needsReview: sortedIssues,
      state: sortedIssues.length > 0 ? 'needs_review' : 'ready_for_review',
    },
    reason: GENERATION_REASON,
    provenance,
  });
}

function profileLinks(authority, paths) {
  return paths.map(path => provenanceLink(authority.sources.profile, path));
}

function identityDraft(authority, actorUserId) {
  const raw = authority.profile.rawProfile;
  const normalized = authority.profile.normalizedProfile;
  const facts = { company: {}, headquarters: {} };
  const issues = [];
  for (const field of ['name', 'dba', 'email', 'phone', 'website', 'timeZone']) {
    resolveRawFact({
      rawProfile: raw,
      normalizedProfile: normalized,
      rawPath: ['company', field],
      target: facts.company,
      key: field,
      required: field === 'name',
      issues,
    });
  }
  resolveRawFact({
    rawProfile: raw,
    normalizedProfile: normalized,
    rawPath: ['company', 'currency'],
    normalizedPath: ['currency'],
    target: facts.company,
    key: 'currency',
    required: false,
    issues,
  });
  for (const field of ['street', 'city', 'state', 'zip', 'country', 'latitude', 'longitude']) {
    resolveRawFact({
      rawProfile: raw,
      normalizedProfile: normalized,
      rawPath: ['headquarters', field],
      target: facts.headquarters,
      key: field,
      required: false,
      issues,
    });
  }
  for (const field of ['industry', 'businessDescription']) {
    resolveRawFact({
      rawProfile: raw,
      normalizedProfile: normalized,
      rawPath: [field],
      target: facts,
      key: field,
      required: false,
      issues,
    });
  }
  return createDraft(authority, {
    actorUserId,
    canonicalKey: 'organization.identity',
    entryType: 'fact',
    label: 'Organization identity',
    sensitivity: 'internal',
    reviewRequirement: 'standard',
    facts,
    issues,
    provenance: profileLinks(authority, [
      '/rawProfile/businessDescription', '/rawProfile/company', '/rawProfile/headquarters',
      '/rawProfile/industry', '/normalizedProfile/currency',
    ]),
  });
}

function availabilityDraft(authority, actorUserId) {
  const raw = authority.profile.rawProfile;
  const normalized = authority.profile.normalizedProfile;
  const facts = { hours: {}, routing: {}, scheduling: {}, serviceArea: {} };
  const issues = [];
  const hours = readPath(raw, ['hours']);
  if (hours.present && plainObject(hours.value) && Object.keys(hours.value).length > 0) {
    facts.hours = canonicalCopy(hours.value);
  } else {
    issues.push(issue(
      'missing_authoritative_section',
      '/rawProfile/hours',
      'Business hours are not configured; NorthStar did not infer availability.',
      ['business_profile.raw_configured']
    ));
  }
  for (const field of ['maxRadiusMiles', 'maxTravelMinutes', 'primaryTerritory', 'polygon']) {
    resolveRawFact({
      rawProfile: raw,
      normalizedProfile: normalized,
      rawPath: ['serviceArea', field],
      target: facts.serviceArea,
      key: field,
      required: false,
      issues,
    });
  }
  const operational = [
    ['routing', ['dispatchFrom', 'trafficEnabled', 'useLiveTraffic', 'avoidTolls', 'avoidHighways', 'avoidFerries']],
    ['scheduling', ['maxJobsPerDay', 'travelBuffer', 'appointmentBuffer', 'workDayLength', 'maxDailyTravel', 'preferredDispatchStrategy']],
  ];
  for (const [section, fields] of operational) {
    for (const field of fields) {
      resolveRawFact({
        rawProfile: raw,
        normalizedProfile: normalized,
        rawPath: [section, field],
        normalizedPath: ['operationalConfiguration', section, field],
        target: facts[section],
        key: field,
        required: false,
        issues,
      });
    }
  }
  if (Object.keys(facts.serviceArea).length === 0) {
    issues.push(issue(
      'missing_authoritative_section',
      '/rawProfile/serviceArea',
      'Service-area limits are not configured; NorthStar did not infer a territory.',
      ['business_profile.raw_configured']
    ));
  }
  return createDraft(authority, {
    actorUserId,
    canonicalKey: 'organization.availability',
    entryType: 'constraint',
    label: 'Availability and service-area constraints',
    sensitivity: 'internal',
    reviewRequirement: 'standard',
    facts,
    issues,
    provenance: profileLinks(authority, [
      '/rawProfile/hours', '/rawProfile/routing', '/rawProfile/scheduling',
      '/rawProfile/serviceArea', '/normalizedProfile/operationalConfiguration',
    ]),
  });
}

function servicesDraft(authority, actorUserId) {
  const rawServices = Array.isArray(authority.profile.rawProfile.services)
    ? authority.profile.rawProfile.services : [];
  const services = rawServices
    .filter(service => plainObject(service) && service.active !== false)
    .map(service => canonicalCopy(service))
    .sort(compareCanonical);
  const issues = [];
  if (services.length === 0) {
    issues.push(issue(
      'missing_authoritative_section',
      '/rawProfile/services',
      'No active service catalogue is configured; NorthStar did not invent services.',
      ['business_profile.raw_configured']
    ));
  }
  return createDraft(authority, {
    actorUserId,
    canonicalKey: 'organization.services',
    entryType: 'generated_knowledge',
    label: 'Service catalogue knowledge',
    sensitivity: 'internal',
    reviewRequirement: 'standard',
    facts: { services },
    issues,
    provenance: profileLinks(authority, ['/rawProfile/services']),
  });
}

function customerGuidanceDraft(authority, actorUserId) {
  const raw = authority.profile.rawProfile;
  const facts = {};
  const issues = [];
  for (const field of ['companyValues', 'emergencyPolicy', 'faq', 'policies']) {
    const value = readPath(raw, [field]);
    if (value.present && (!plainObject(value.value) || Object.keys(value.value).length > 0)) {
      facts[field] = canonicalCopy(value.value);
    }
  }
  const workforcePolicies = readPath(raw, ['workforce', 'policies']);
  if (workforcePolicies.present && Array.isArray(workforcePolicies.value) && workforcePolicies.value.length > 0) {
    facts.workforcePolicies = canonicalCopy(workforcePolicies.value).sort(compareCanonical);
  }
  if (Object.keys(facts).length === 0) {
    issues.push(issue(
      'missing_authoritative_section',
      '/rawProfile/policies',
      'No customer or workforce guidance is configured; NorthStar did not generate policy language.',
      ['business_profile.raw_configured']
    ));
  }
  return createDraft(authority, {
    actorUserId,
    canonicalKey: 'organization.customer-guidance',
    entryType: 'policy',
    label: 'Customer and workforce guidance',
    sensitivity: 'internal',
    reviewRequirement: 'high_risk',
    facts,
    issues,
    provenance: profileLinks(authority, [
      '/rawProfile/companyValues', '/rawProfile/emergencyPolicy', '/rawProfile/faq',
      '/rawProfile/policies', '/rawProfile/workforce/policies',
    ]),
  });
}

function financialDraft(authority, actorUserId) {
  const raw = authority.profile.rawProfile;
  const normalized = authority.profile.normalizedProfile;
  const facts = { costs: {}, crew: {}, pricing: {}, vehicles: {} };
  const issues = [];
  const mappings = [
    ['canonicalPricing', 'pricing', [
      'customerMarkupPercent', 'taxRatePercent', 'emergencyMultiplier',
      'travelCustomerChargePerMile', 'minimumJobPrice', 'desiredGrossMarginPercent',
      'desiredNetMarginPercent', 'maximumDiscountPercent', 'defaultRangePercent',
    ]],
    ['canonicalCosts', 'costs', [
      'overheadPercent', 'travelCostPerMile', 'materialCostByService', 'equipmentCostByReference',
    ]],
  ];
  for (const [rawSection, normalizedSection, fields] of mappings) {
    for (const field of fields) {
      resolveRawFact({
        rawProfile: raw,
        normalizedProfile: normalized,
        rawPath: [rawSection, field],
        normalizedPath: [normalizedSection, field],
        target: facts[normalizedSection],
        key: field,
        required: false,
        issues,
      });
    }
  }
  const crewMappings = [
    ['defaultCrewSize', 'defaultCrewSize'],
    ['averageHourlyRate', 'averageHourlyCost'],
    ['overtimeMultiplier', 'overtimeMultiplier'],
  ];
  for (const [rawField, normalizedField] of crewMappings) {
    resolveRawFact({
      rawProfile: raw,
      normalizedProfile: normalized,
      rawPath: ['crew', rawField],
      normalizedPath: ['crew', normalizedField],
      target: facts.crew,
      key: rawField,
      required: false,
      issues,
    });
  }
  for (const field of ['travelPay', 'minimumBillableHours']) {
    resolveRawFact({
      rawProfile: raw,
      normalizedProfile: normalized,
      rawPath: ['crew', field],
      target: facts.crew,
      key: field,
      required: false,
      issues,
    });
  }
  for (const field of ['averageFuelCost', 'hourlyVehicleCost', 'maintenanceReserve']) {
    resolveRawFact({
      rawProfile: raw,
      normalizedProfile: normalized,
      rawPath: ['vehicles', field],
      target: facts.vehicles,
      key: field,
      required: false,
      issues,
    });
  }
  if (Object.values(facts).every(section => Object.keys(section).length === 0)) {
    issues.push(issue(
      'missing_authoritative_section',
      '/rawProfile/canonicalPricing',
      'No canonical financial constraints are configured; NorthStar did not infer prices or costs.',
      ['business_profile.raw_configured']
    ));
  }
  return createDraft(authority, {
    actorUserId,
    canonicalKey: 'organization.financial-constraints',
    entryType: 'constraint',
    label: 'Internal financial constraints',
    sensitivity: 'restricted',
    reviewRequirement: 'high_risk',
    facts,
    issues,
    provenance: profileLinks(authority, [
      '/rawProfile/canonicalCosts', '/rawProfile/canonicalPricing', '/rawProfile/crew',
      '/rawProfile/vehicles', '/normalizedProfile/costs', '/normalizedProfile/crew',
      '/normalizedProfile/pricing',
    ]),
  });
}

function operationalCapabilitiesDraft(authority, actorUserId) {
  const profileServiceIds = new Set(
    (Array.isArray(authority.profile.rawProfile.services) ? authority.profile.rawProfile.services : [])
      .filter(service => plainObject(service) && typeof service.id === 'string')
      .map(service => service.id.toLowerCase())
  );
  const issues = [];
  const memberCounts = new Map();
  for (const member of authority.workforce.crewMembers) {
    memberCounts.set(member.crewId, (memberCounts.get(member.crewId) || 0) + 1);
  }
  const skills = authority.workforce.skills.map(skill => {
    const output = {
      description: skill.description || '',
      name: skill.name,
      skillKey: skill.skillKey,
    };
    if (skill.serviceId) {
      output.serviceId = skill.serviceId;
      if (!profileServiceIds.has(String(skill.serviceId).toLowerCase())) {
        issues.push(issue(
          'orphaned_authority_reference',
          `/workforce/skills/${skill.id}/serviceId`,
          'A workforce skill references a service that is not in the active Business Profile.',
          ['business_profile.raw_configured', 'normalized_workforce']
        ));
      }
    }
    return output;
  });
  const crews = authority.workforce.crews.map(crew => ({
    crewKey: crew.crewKey,
    homeLocationId: crew.homeLocationId || null,
    memberCount: memberCounts.get(crew.id) || 0,
    name: crew.name,
  }));
  const capabilitiesByAsset = new Map();
  for (const capability of authority.assets.capabilities) {
    const list = capabilitiesByAsset.get(capability.assetId) || [];
    list.push(capability.serviceId);
    capabilitiesByAsset.set(capability.assetId, list);
    if (!profileServiceIds.has(String(capability.serviceId).toLowerCase())) {
      issues.push(issue(
        'orphaned_authority_reference',
        `/assets/capabilities/${capability.assetId}/${capability.serviceId}`,
        'An asset capability references a service that is not in the active Business Profile.',
        ['business_profile.raw_configured', 'normalized_asset_catalogue']
      ));
    }
  }
  const assets = authority.assets.items
    .filter(asset => asset.catalogueState === 'active')
    .map(asset => ({
      assetId: asset.id,
      category: asset.category,
      configuration: asset.configuration || '',
      homeLocationId: asset.homeLocationId || null,
      internalReference: asset.internalReference || '',
      manufacturer: asset.manufacturer || '',
      model: asset.model || '',
      modelYear: asset.modelYear || null,
      name: asset.name,
      serviceIds: (capabilitiesByAsset.get(asset.id) || []).slice().sort(),
      version: asset.version,
    }));
  if (skills.length === 0 && crews.length === 0 && assets.length === 0) {
    issues.push(issue(
      'missing_authoritative_section',
      '/workforce',
      'No normalized workforce or asset capabilities are configured; NorthStar did not infer capacity.',
      ['normalized_workforce', 'normalized_asset_catalogue']
    ));
  }
  return createDraft(authority, {
    actorUserId,
    canonicalKey: 'organization.operational-capabilities',
    entryType: 'generated_knowledge',
    label: 'Operational capability snapshot',
    sensitivity: 'restricted',
    reviewRequirement: 'high_risk',
    facts: { assets, crews, skills },
    issues,
    provenance: [
      ...profileLinks(authority, ['/rawProfile/services']),
      provenanceLink(authority.sources.workforce, '/skills'),
      provenanceLink(authority.sources.workforce, '/crews'),
      provenanceLink(authority.sources.workforce, '/crewMembers'),
      provenanceLink(authority.sources.assets, '/items'),
      provenanceLink(authority.sources.assets, '/capabilities'),
    ],
  });
}

function voiceGuidanceDraft(authority, actorUserId) {
  const voice = readPath(authority.profile.rawProfile, ['voiceAssistant']);
  const facts = {};
  const issues = [];
  if (voice.present && plainObject(voice.value) && Object.keys(voice.value).length > 0) {
    facts.voiceAssistant = canonicalCopy(voice.value);
  } else {
    issues.push(issue(
      'missing_authoritative_section',
      '/rawProfile/voiceAssistant',
      'No provider-neutral voice guidance is configured; NorthStar did not generate a greeting or disclosure.',
      ['business_profile.raw_configured']
    ));
  }
  return createDraft(authority, {
    actorUserId,
    canonicalKey: 'organization.voice-guidance',
    entryType: 'guidance',
    label: 'Provider-neutral voice guidance',
    sensitivity: 'internal',
    reviewRequirement: 'high_risk',
    facts,
    issues,
    provenance: profileLinks(authority, ['/rawProfile/voiceAssistant']),
  });
}

function generateInitialKnowledgeDrafts(input) {
  if (!plainObject(input)) fail('knowledge_generation_invalid', 'Generation input is required.', 400);
  const actorUserId = normalizeUuid(input.actorUserId, 'actorUserId');
  const authority = normalizeAuthorities(input.authorities);
  if (input.organizationId !== undefined &&
      normalizeUuid(input.organizationId, 'organizationId') !== authority.profile.organizationId) {
    fail('knowledge_generation_tenant_mismatch', 'Authority bundle does not belong to the requested organization.', 403);
  }
  const drafts = [
    availabilityDraft(authority, actorUserId),
    customerGuidanceDraft(authority, actorUserId),
    financialDraft(authority, actorUserId),
    identityDraft(authority, actorUserId),
    operationalCapabilitiesDraft(authority, actorUserId),
    servicesDraft(authority, actorUserId),
    voiceGuidanceDraft(authority, actorUserId),
  ].sort((left, right) => Buffer.compare(
    Buffer.from(left.canonicalKey, 'utf8'),
    Buffer.from(right.canonicalKey, 'utf8')
  ));
  return Object.freeze({
    actorUserId,
    authority: Object.freeze({
      assetDigest: authority.sources.assets.sourceDigest,
      businessProfileDigest: authority.sources.profile.sourceDigest,
      businessProfileId: authority.profile.id,
      businessProfileVersion: authority.profile.versionLabel,
      generatorDigest: authority.sources.generator.sourceDigest,
      generatorVersion: GENERATOR_VERSION,
      organizationId: authority.profile.organizationId,
      workforceDigest: authority.sources.workforce.sourceDigest,
    }),
    drafts: Object.freeze(drafts),
  });
}

module.exports = {
  GENERATION_REASON,
  GENERATOR_CONTRACT,
  GENERATOR_VERSION,
  KnowledgeGenerationError,
  PRECEDENCE,
  canonicalDigest,
  generateInitialKnowledgeDrafts,
  normalizeAuthorities,
};
