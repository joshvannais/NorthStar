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
  sha256,
  stableStringify,
  stableValue,
};
