'use strict';

const crypto = require('crypto');

const RAW_PROFILE_FIELD_TYPES = Object.freeze({
  version: 'string',
  updatedAt: 'string',
  industry: 'string',
  ownerName: 'string',
  businessDescription: 'string',
  company: 'object',
  headquarters: 'object',
  serviceArea: 'object',
  routing: 'object',
  hours: 'object',
  crew: 'object',
  vehicles: 'object',
  services: 'array',
  financial: 'object',
  scheduling: 'object',
  polaris: 'object',
  retell: 'object',
  notifications: 'object',
  integrations: 'object',
  canonicalPricing: 'object',
  canonicalCosts: 'object',
  emergencyPolicy: 'string',
  faq: 'array',
  policies: 'object',
  companyValues: 'array',
  customPrompt: 'string',
});

const RAW_PROFILE_LIMITS = Object.freeze({
  maximumArrayItems: 500,
  maximumContainerKeys: 500,
  maximumKeyBytes: 256,
  maximumNestingDepth: 12,
  maximumProfileBytes: 256 * 1024,
  maximumStringBytes: 32 * 1024,
  maximumValues: 10000,
});

const UNSAFE_RAW_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function postgresJsonStringIssue(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) return 'NUL';
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        index += 1;
        continue;
      }
      return 'unpaired-surrogate';
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return 'unpaired-surrogate';
  }
  return null;
}

function validateRawBusinessProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) return ['Business Profile must be an object.'];

  for (const key of Object.keys(profile)) {
    if (!Object.prototype.hasOwnProperty.call(RAW_PROFILE_FIELD_TYPES, key)) {
      errors.push(key + ' is not a writable Business Profile field.');
      continue;
    }
    const expected = RAW_PROFILE_FIELD_TYPES[key];
    const value = profile[key];
    if (expected === 'object' && !isPlainObject(value)) errors.push(key + ' must be an object.');
    if (expected === 'array' && !Array.isArray(value)) errors.push(key + ' must be an array.');
    if (expected === 'string' && typeof value !== 'string') errors.push(key + ' must be a string.');
  }

  let serialized;
  try {
    serialized = JSON.stringify(profile);
  } catch (_error) {
    errors.push('Business Profile must contain an acyclic JSON value.');
  }
  if (serialized !== undefined && Buffer.byteLength(serialized, 'utf8') > RAW_PROFILE_LIMITS.maximumProfileBytes) {
    errors.push('Business Profile exceeds the maximum UTF-8 byte length of ' + RAW_PROFILE_LIMITS.maximumProfileBytes + '.');
  }

  const seen = new WeakSet();
  let valueCount = 0;
  let valueLimitReported = false;
  function inspect(value, path, depth) {
    valueCount += 1;
    if (valueCount > RAW_PROFILE_LIMITS.maximumValues) {
      if (!valueLimitReported) {
        errors.push('Business Profile exceeds the maximum value count of ' + RAW_PROFILE_LIMITS.maximumValues + '.');
        valueLimitReported = true;
      }
      return;
    }
    if (depth > RAW_PROFILE_LIMITS.maximumNestingDepth) {
      errors.push(path + ' exceeds the maximum nesting depth of ' + RAW_PROFILE_LIMITS.maximumNestingDepth + '.');
      return;
    }
    if (typeof value === 'string') {
      const issue = postgresJsonStringIssue(value);
      if (issue === 'NUL') {
        errors.push(path + ' contains a NUL character that PostgreSQL JSONB cannot represent.');
      } else if (issue === 'unpaired-surrogate') {
        errors.push(path + ' contains an unpaired UTF-16 surrogate that PostgreSQL JSONB cannot represent.');
      }
      if (Buffer.byteLength(value, 'utf8') > RAW_PROFILE_LIMITS.maximumStringBytes) {
        errors.push(path + ' exceeds the maximum UTF-8 byte length of ' + RAW_PROFILE_LIMITS.maximumStringBytes + '.');
      }
      return;
    }
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) errors.push(path + ' must be a finite JSON number.');
      return;
    }
    if (typeof value !== 'object') {
      errors.push(path + ' must contain only JSON values.');
      return;
    }
    if (seen.has(value)) {
      errors.push(path + ' must not contain a cyclic reference.');
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > RAW_PROFILE_LIMITS.maximumArrayItems) {
        errors.push(path + ' exceeds the maximum array length of ' + RAW_PROFILE_LIMITS.maximumArrayItems + '.');
      }
      for (let index = 0; index < value.length && !valueLimitReported; index += 1) {
        inspect(value[index], path + '[' + index + ']', depth + 1);
      }
      return;
    }
    if (!isPlainObject(value)) {
      errors.push(path + ' must contain only plain JSON objects.');
      return;
    }
    const keys = Object.keys(value);
    if (keys.length > RAW_PROFILE_LIMITS.maximumContainerKeys) {
      errors.push(path + ' exceeds the maximum object key count of ' + RAW_PROFILE_LIMITS.maximumContainerKeys + '.');
    }
    for (const key of keys) {
      if (UNSAFE_RAW_KEYS.has(key)) errors.push(path + ' contains unsafe key ' + key + '.');
      const keyIssue = postgresJsonStringIssue(key);
      if (keyIssue === 'NUL') {
        errors.push(path + ' contains a key with a NUL character that PostgreSQL JSONB cannot represent.');
      } else if (keyIssue === 'unpaired-surrogate') {
        errors.push(path + ' contains a key with an unpaired UTF-16 surrogate that PostgreSQL JSONB cannot represent.');
      }
      if (Buffer.byteLength(key, 'utf8') > RAW_PROFILE_LIMITS.maximumKeyBytes) {
        errors.push(path + ' contains a key that exceeds the maximum UTF-8 byte length of ' + RAW_PROFILE_LIMITS.maximumKeyBytes + '.');
      }
      if (!valueLimitReported) inspect(value[key], path + '.' + key, depth + 1);
    }
  }
  inspect(profile, 'profile', 0);
  return errors;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce(function (result, key) {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function finiteOrNull(value, options) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  if (options && options.nonNegative && number < 0) return null;
  if (options && options.positive && number <= 0) return null;
  return number;
}

function integerOrNull(value, options) {
  const number = finiteOrNull(value, options);
  return number === null || !Number.isInteger(number) ? null : number;
}

function configured(source, key, options) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return null;
  return finiteOrNull(source[key], options);
}

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function migrateLegacyCanonicalAuthority(profile) {
  const source = stableValue(profile && typeof profile === 'object' ? profile : {});
  const migratedFields = [];
  const financial = source.financial && typeof source.financial === 'object' && !Array.isArray(source.financial)
    ? source.financial : {};

  if (!hasOwn(source, 'canonicalPricing')) {
    const canonicalPricing = {};
    const markup = finiteOrNull(financial.markup, { positive: true });
    const travelCharge = finiteOrNull(financial.travelCharge, { nonNegative: true });
    const emergencyMarkup = finiteOrNull(financial.emergencyMarkup, { nonNegative: true });
    const taxRate = finiteOrNull(financial.taxRate, { nonNegative: true });
    const minimumJobPrice = finiteOrNull(financial.minimumJobPrice, { nonNegative: true });
    if (markup !== null && markup >= 1) canonicalPricing.customerMarkupPercent = (markup - 1) * 100;
    if (travelCharge !== null) canonicalPricing.travelCustomerChargePerMile = travelCharge;
    if (emergencyMarkup !== null) canonicalPricing.emergencyMultiplier = emergencyMarkup;
    if (taxRate !== null && taxRate <= 100) canonicalPricing.taxRatePercent = taxRate;
    if (minimumJobPrice !== null) canonicalPricing.minimumJobPrice = minimumJobPrice;
    source.canonicalPricing = canonicalPricing;
    migratedFields.push('canonicalPricing');
  }
  if (!hasOwn(source, 'canonicalCosts')) {
    const canonicalCosts = {};
    const overhead = finiteOrNull(financial.overheadPercent, { nonNegative: true });
    if (overhead !== null) canonicalCosts.overheadPercent = overhead;
    source.canonicalCosts = canonicalCosts;
    migratedFields.push('canonicalCosts');
  }
  return { profile: source, migratedFields };
}

function validateCanonicalBusinessProfile(profile) {
  const errors = [];
  function validateContainer(name, fields) {
    const container = profile[name];
    if (!container || typeof container !== 'object' || Array.isArray(container)) {
      errors.push(name + ' must be an object.');
      return;
    }
    for (const field of fields) {
      if (!hasOwn(container, field.key)) continue;
      const value = container[field.key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
          (field.maximum !== undefined && value > field.maximum)) {
        errors.push(name + '.' + field.key + ' must be a finite number ' +
          (field.maximum === undefined ? 'greater than or equal to 0.' : 'between 0 and ' + field.maximum + '.'));
      }
    }
  }
  validateContainer('canonicalPricing', [
    { key: 'customerMarkupPercent' },
    { key: 'travelCustomerChargePerMile' },
    { key: 'emergencyMultiplier' },
    { key: 'taxRatePercent', maximum: 100 },
    { key: 'minimumJobPrice' },
  ]);
  validateContainer('canonicalCosts', [
    { key: 'overheadPercent' },
    { key: 'travelCostPerMile' },
  ]);
  for (const mapName of ['materialCostByService', 'equipmentCostByReference']) {
    const costs = profile.canonicalCosts;
    if (!costs || !hasOwn(costs, mapName)) continue;
    const map = costs[mapName];
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      errors.push('canonicalCosts.' + mapName + ' must be an object of non-negative finite numbers.');
      continue;
    }
    for (const key of Object.keys(map)) {
      if (!key.trim() || typeof map[key] !== 'number' || !Number.isFinite(map[key]) || map[key] < 0) {
        errors.push('canonicalCosts.' + mapName + '.' + key + ' must be a non-negative finite number.');
      }
    }
  }
  return errors;
}

function synchronizeLegacyFinancial(profile) {
  const pricing = profile.canonicalPricing;
  const financial = profile.financial && typeof profile.financial === 'object' && !Array.isArray(profile.financial)
    ? profile.financial : {};
  function mirror(canonicalKey, legacyKey, transform, maximum) {
    const value = hasOwn(pricing, canonicalKey) ? pricing[canonicalKey] : null;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
        (maximum === undefined || value <= maximum)) {
      financial[legacyKey] = transform ? transform(value) : value;
    } else {
      delete financial[legacyKey];
    }
  }
  mirror('customerMarkupPercent', 'markup', function (value) { return 1 + value / 100; });
  mirror('taxRatePercent', 'taxRate', null, 100);
  mirror('emergencyMultiplier', 'emergencyMarkup');
  mirror('travelCustomerChargePerMile', 'travelCharge');
  mirror('minimumJobPrice', 'minimumJobPrice');
  profile.financial = financial;
  return profile;
}

function prepareBusinessProfileForWrite(profile) {
  const rawErrors = validateRawBusinessProfile(profile);
  if (rawErrors.length) {
    return { profile: null, migratedFields: [], errors: rawErrors };
  }
  const migrated = migrateLegacyCanonicalAuthority(profile);
  const errors = validateCanonicalBusinessProfile(migrated.profile);
  if (!errors.length) synchronizeLegacyFinancial(migrated.profile);
  return {
    profile: stableValue(migrated.profile),
    migratedFields: migrated.migratedFields,
    errors,
  };
}

/**
 * Normalize current and future Business Profile shapes into the only profile
 * contract consumed by the canonical Part 3 calculator. Legacy financial
 * fields remain visible for provenance but never become canonical authority.
 * Service calculation rules are retained only from explicit, versioned
 * Business Profile configuration.
 */
function adaptBusinessProfile(profile, version) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const crew = source.crew || {};
  const financial = source.financial || {};
  const canonicalPricing = source.canonicalPricing || {};
  const canonicalCosts = source.canonicalCosts || {};
  const services = Array.isArray(source.services) ? source.services : [];
  const configuredTaxRate = configured(canonicalPricing, 'taxRatePercent', { nonNegative: true });

  const normalized = {
    version: String(version || source.version || source.updatedAt || 'business-profile-v1'),
    currency: source.company && source.company.currency ? String(source.company.currency) : 'USD',
    crew: {
      defaultCrewSize: integerOrNull(crew.defaultCrewSize, { positive: true }),
      averageHourlyCost: finiteOrNull(crew.averageHourlyRate, { nonNegative: true }),
      overtimeMultiplier: finiteOrNull(crew.overtimeMultiplier, { positive: true }),
    },
    pricing: {
      customerMarkupPercent: configured(canonicalPricing, 'customerMarkupPercent', { nonNegative: true }),
      travelCustomerChargePerMile: configured(canonicalPricing, 'travelCustomerChargePerMile', { nonNegative: true }),
      emergencyMultiplier: configured(canonicalPricing, 'emergencyMultiplier', { nonNegative: true }),
      taxRatePercent: configuredTaxRate !== null && configuredTaxRate <= 100 ? configuredTaxRate : null,
      minimumJobPrice: configured(canonicalPricing, 'minimumJobPrice', { nonNegative: true }),
      legacyCatalogMarkupMultiplier: finiteOrNull(financial.markup, { positive: true }),
      legacyTravelChargePerMile: finiteOrNull(financial.travelCharge, { nonNegative: true }),
      legacyEmergencyMultiplier: finiteOrNull(financial.emergencyMarkup, { positive: true }),
    },
    costs: {
      overheadPercent: configured(canonicalCosts, 'overheadPercent', { nonNegative: true }),
      travelCostPerMile: configured(canonicalCosts, 'travelCostPerMile', { nonNegative: true }),
      materialCostByService: canonicalCosts.materialCostByService && typeof canonicalCosts.materialCostByService === 'object'
        ? stableValue(canonicalCosts.materialCostByService) : {},
      equipmentCostByReference: canonicalCosts.equipmentCostByReference && typeof canonicalCosts.equipmentCostByReference === 'object'
        ? stableValue(canonicalCosts.equipmentCostByReference) : {},
    },
    services: services.map(function (service) {
      const identifier = service && (service.id || service.key || service.serviceId);
      const servicePricing = service && service.canonicalPricing && typeof service.canonicalPricing === 'object'
        ? stableValue(service.canonicalPricing) : null;
      return {
        id: identifier ? String(identifier).trim().toLowerCase() : null,
        name: service && service.name ? String(service.name) : null,
        crewSize: service ? integerOrNull(service.crewSize, { positive: true }) : null,
        averageHours: service ? finiteOrNull(service.avgHours, { positive: true }) : null,
        equipmentReference: service && service.equipment ? String(service.equipment) : null,
        canonicalPricing: servicePricing,
      };
    }).filter(function (service) { return service.id || service.name; }),
  };

  return Object.freeze({
    ...normalized,
    hash: sha256(normalized),
  });
}

module.exports = {
  adaptBusinessProfile,
  finiteOrNull,
  migrateLegacyCanonicalAuthority,
  prepareBusinessProfileForWrite,
  sha256,
  stableStringify,
  stableValue,
  synchronizeLegacyFinancial,
  validateCanonicalBusinessProfile,
  validateRawBusinessProfile,
};
