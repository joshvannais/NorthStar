'use strict';

const crypto = require('crypto');

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
};
