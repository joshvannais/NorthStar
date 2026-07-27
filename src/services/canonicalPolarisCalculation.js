'use strict';

const CATALOG = require('../routes/simulation/service-catalog');
const { adaptBusinessProfile, finiteOrNull, sha256, stableStringify, stableValue } = require('./businessProfileAdapter');
const { detectEmergencyEvidence, normalizeSpeaker } = require('./emergencyEvidence');

const CALCULATION_VERSION = 'm19-part3-canonical-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @typedef {Object} CanonicalPolarisInput
 * @property {string} organizationId
 * @property {string} customerId
 * @property {string} opportunityId
 * @property {string} calculationVersion
 * @property {{key:string, scope:Object}} service
 * @property {Array<Object>} transcript
 * @property {Array<Object>} facts
 * @property {Object} businessProfile
 * @property {Object|null} appointmentPreference
 * @property {Object|null} travel
 * @property {Object|null} actualCrewAssignment
 * @property {number|null} callDurationSeconds
 */

/**
 * @typedef {Object} CanonicalPolarisOutput
 * @property {string} calculationVersion
 * @property {string} normalizedInputFingerprint
 * @property {number|null} customerFacingPrice
 * @property {number|null} tax
 * @property {number|null} totalIncludingTax
 * @property {Array<Object>} pricingLineItems
 * @property {number|null} knownDirectCosts
 * @property {number|null} grossProfit
 * @property {number|null} netProfit
 * @property {Array<{field:string,reason:string}>} notCalculated
 */

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function requireUuid(value, field) {
  if (!UUID.test(String(value || ''))) throw contractError(field + ' must be a UUID');
  return String(value).toLowerCase();
}

function contractError(message) {
  const error = new Error(message);
  error.code = 'INVALID_CANONICAL_INPUT';
  error.status = 400;
  return error;
}

function normalizeTranscript(transcript) {
  return (Array.isArray(transcript) ? transcript : []).map(function (turn, index) {
    return {
      turnId: turn && turn.turnId ? String(turn.turnId) : 'turn-' + (index + 1),
      speaker: normalizeSpeaker(turn && (turn.speaker || turn.role || turn.from)),
      text: String(turn && (turn.text !== undefined ? turn.text : turn.utterance) || '').trim(),
    };
  }).filter(function (turn) { return turn.text; });
}

function normalizeFacts(facts) {
  return (Array.isArray(facts) ? facts : []).map(function (fact, index) {
    return {
      id: fact && (fact.id || fact.factId) ? String(fact.id || fact.factId) : 'fact-' + (index + 1),
      variable: fact && fact.variable ? String(fact.variable) : null,
      status: fact && fact.status ? String(fact.status) : 'collected',
      normalizedValue: fact && fact.normalizedValue !== undefined ? stableValue(fact.normalizedValue) : null,
      evidenceTurnId: fact && fact.evidenceTurnId ? String(fact.evidenceTurnId)
        : (fact && fact.evidence && fact.evidence.turnId ? String(fact.evidence.turnId) : null),
    };
  }).sort(function (a, b) { return a.id.localeCompare(b.id); });
}

function explicitNumber(source, key, options) {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return null;
  return finiteOrNull(source[key], options);
}

function selectSetting(explicit, key, fallback, options) {
  const selected = explicitNumber(explicit, key, options);
  return selected === null ? fallback : selected;
}

function normalizeCanonicalInput(source) {
  const input = source && typeof source === 'object' ? source : {};
  const service = input.service && typeof input.service === 'object' ? input.service : {};
  const key = String(service.key || input.serviceKey || '').trim().toLowerCase();
  const profile = input.businessProfile && input.businessProfile.hash
    ? input.businessProfile
    : adaptBusinessProfile(input.businessProfile || {}, input.businessProfileVersion);
  const explicitPricing = input.pricingSettings || (input.settings && input.settings.pricing) || {};
  const explicitCosts = input.costSettings || (input.settings && input.settings.costs) || {};
  const normalized = {
    organizationId: requireUuid(input.organizationId || (input.organization && input.organization.id), 'organizationId'),
    customerId: requireUuid(input.customerId, 'customerId'),
    opportunityId: requireUuid(input.opportunityId, 'opportunityId'),
    calculationVersion: String(input.calculationVersion || CALCULATION_VERSION),
    service: {
      key,
      scope: stableValue(service.scope || input.scope || {}),
    },
    transcript: normalizeTranscript(input.transcript),
    facts: normalizeFacts(input.facts),
    businessProfile: stableValue(profile),
    appointmentPreference: input.appointmentPreference ? stableValue(input.appointmentPreference) : null,
    travel: input.travel ? stableValue(input.travel) : null,
    actualCrewAssignment: input.actualCrewAssignment ? stableValue(input.actualCrewAssignment) : null,
    callDurationSeconds: finiteOrNull(input.callDurationSeconds, { nonNegative: true }),
    settings: {
      pricing: {
        customerMarkupPercent: selectSetting(explicitPricing, 'customerMarkupPercent', profile.pricing.customerMarkupPercent, { nonNegative: true }),
        travelCustomerChargePerMile: selectSetting(explicitPricing, 'travelCustomerChargePerMile', profile.pricing.travelCustomerChargePerMile, { nonNegative: true }),
        emergencyMultiplier: selectSetting(explicitPricing, 'emergencyMultiplier', profile.pricing.emergencyMultiplier, { positive: true }),
      },
      costs: {
        overheadPercent: selectSetting(explicitCosts, 'overheadPercent', profile.costs.overheadPercent, { nonNegative: true }),
        travelCostPerMile: selectSetting(explicitCosts, 'travelCostPerMile', profile.costs.travelCostPerMile, { nonNegative: true }),
        materialCost: explicitNumber(explicitCosts, 'materialCost', { nonNegative: true }),
        laborCost: explicitNumber(explicitCosts, 'laborCost', { nonNegative: true }),
        equipmentCost: explicitNumber(explicitCosts, 'equipmentCost', { nonNegative: true }),
      },
    },
  };
  if (!key) throw contractError('service.key is required');
  if (normalized.calculationVersion !== CALCULATION_VERSION) {
    throw contractError('unsupported calculationVersion: ' + normalized.calculationVersion);
  }
  return normalized;
}

function adaptInput(source) {
  return normalizeCanonicalInput(source);
}

function adaptSimulationInput(source) {
  return adaptInput(source);
}

function adaptLiveInput(source) {
  return adaptInput(source);
}

function classifyLine(label, index) {
  const value = String(label || '').toLowerCase();
  if (/material|cedar|pine|vinyl|aluminum|iron|chain link|shingle|concrete/.test(value)) return 'materials';
  if (/labor|installation/.test(value)) return 'labor';
  if (/equipment/.test(value)) return 'equipment';
  if (/travel|mileage/.test(value)) return 'travel';
  return 'serviceCharge';
}

function configuredMaterialCost(input) {
  if (input.settings.costs.materialCost !== null) return input.settings.costs.materialCost;
  const map = input.businessProfile.costs.materialCostByService || {};
  const material = input.service.scope.material ? String(input.service.scope.material).toLowerCase() : '';
  return finiteOrNull(map[input.service.key + ':' + material], { nonNegative: true });
}

function matchedProfileService(input, definition) {
  const expected = String(definition && definition.displayName || input.service.key).toLowerCase();
  return (input.businessProfile.services || []).find(function (service) {
    return String(service.name || '').toLowerCase() === expected;
  }) || null;
}

function notCalculatedCollector() {
  const values = [];
  return {
    add: function (field, reason) {
      if (!values.some(function (entry) { return entry.field === field; })) values.push({ field, reason });
      return null;
    },
    values,
  };
}

function calculateCanonicalPolaris(source) {
  const input = normalizeCanonicalInput(source);
  const definition = CATALOG[input.service.key] || null;
  const scope = input.service.scope;
  const missing = [];
  const conflicting = input.facts.filter(function (fact) { return fact.status === 'conflicting'; });
  const notCalculated = notCalculatedCollector();
  let pricing = null;
  let priceReason = null;

  if (!definition || !definition.pricing || typeof definition.pricing.calculate !== 'function') {
    priceReason = 'The requested service does not have a supported current catalog price.';
  } else {
    for (const field of definition.scopeSchema.required || []) {
      if (scope[field] === undefined || scope[field] === null || scope[field] === '') missing.push(field);
      if (conflicting.some(function (fact) { return fact.variable === field; })) missing.push(field);
    }
    if (input.service.key === 'fence' && scope.material && !definition.pricing.materials[scope.material]) {
      missing.push('supported material');
    }
    if (missing.length) {
      priceReason = 'Required supported scope is missing or contradictory: ' + Array.from(new Set(missing)).join(', ') + '.';
    } else {
      try {
        pricing = definition.pricing.calculate(clone(scope));
        if (!pricing || !Number.isFinite(pricing.total) || pricing.total <= 0) {
          pricing = null;
          priceReason = 'The supported catalog did not produce a finite positive price.';
        }
      } catch (error) {
        priceReason = 'The supported catalog could not calculate this scope.';
      }
    }
  }

  const lineItems = [];
  if (pricing) {
    (pricing.breakdown || []).forEach(function (item, index) {
      const amount = finiteOrNull(item.amount, { nonNegative: true });
      if (amount === null) throw contractError('catalog pricing produced a non-finite line item');
      lineItems.push({
        code: 'catalog-' + (index + 1),
        label: String(item.label || item.description || 'Catalog charge'),
        category: classifyLine(item.label || item.description, index),
        customerCharge: roundCurrency(amount),
      });
    });
  }

  const emergency = detectEmergencyEvidence(input.transcript);
  const markupPercent = input.settings.pricing.customerMarkupPercent;
  if (pricing && markupPercent !== null && markupPercent > 0) {
    lineItems.push({
      code: 'configured-markup',
      label: 'Configured customer markup',
      category: 'markup',
      customerCharge: roundCurrency(pricing.total * markupPercent / 100),
    });
  }

  const distanceMiles = input.travel ? finiteOrNull(input.travel.distanceMiles, { nonNegative: true }) : null;
  const travelMinutes = input.travel ? finiteOrNull(input.travel.minutes, { nonNegative: true }) : null;
  const travelSource = input.travel && input.travel.source ? String(input.travel.source) : null;
  const travelRate = input.settings.pricing.travelCustomerChargePerMile;
  if (pricing && distanceMiles !== null && travelRate !== null) {
    lineItems.push({
      code: 'configured-travel',
      label: 'Configured travel charge',
      category: 'travel',
      customerCharge: roundCurrency(distanceMiles * travelRate),
    });
  }

  const emergencyMultiplier = input.settings.pricing.emergencyMultiplier;
  if (pricing && emergency.isEmergency && emergencyMultiplier !== null && emergencyMultiplier > 1) {
    const beforeEmergency = lineItems.reduce(function (sum, line) { return sum + line.customerCharge; }, 0);
    lineItems.push({
      code: 'configured-emergency',
      label: 'Configured emergency adjustment',
      category: 'emergency',
      customerCharge: roundCurrency(beforeEmergency * (emergencyMultiplier - 1)),
    });
  }

  const customerFacingPrice = pricing
    ? roundCurrency(lineItems.reduce(function (sum, line) { return sum + line.customerCharge; }, 0))
    : notCalculated.add('customerFacingPrice', priceReason);
  const materialsCharge = pricing
    ? roundCurrency(lineItems.filter(function (line) { return line.category === 'materials'; }).reduce(function (sum, line) { return sum + line.customerCharge; }, 0))
    : notCalculated.add('materialsCharge', priceReason);
  const laborCharge = pricing
    ? roundCurrency(lineItems.filter(function (line) { return line.category === 'labor'; }).reduce(function (sum, line) { return sum + line.customerCharge; }, 0))
    : notCalculated.add('laborCharge', priceReason);
  const equipmentCharge = pricing
    ? roundCurrency(lineItems.filter(function (line) { return line.category === 'equipment'; }).reduce(function (sum, line) { return sum + line.customerCharge; }, 0))
    : notCalculated.add('equipmentCharge', priceReason);
  const taxRatePercent = input.businessProfile.pricing.taxRatePercent;
  const taxReason = taxRatePercent === null
    ? 'tax_configuration_unavailable'
    : (customerFacingPrice === null ? 'tax_base_unavailable' : null);
  const tax = taxReason === null
    ? roundCurrency(customerFacingPrice * taxRatePercent / 100)
    : notCalculated.add('tax', taxReason);
  const totalIncludingTax = tax === null
    ? notCalculated.add('totalIncludingTax', taxReason)
    : roundCurrency(customerFacingPrice + tax);

  const profileService = matchedProfileService(input, definition);
  const laborHours = finiteOrNull(scope.laborHours, { nonNegative: true })
    ?? (profileService ? profileService.averageHours : null)
    ?? notCalculated.add('laborHours', 'No authoritative production-hours input exists for this service scope.');
  const productionDurationHours = laborHours === null
    ? notCalculated.add('estimatedProductionDurationHours', 'Production duration requires authoritative labor hours.')
    : laborHours;
  const crewRecommendation = profileService && profileService.crewSize
    ? { size: profileService.crewSize, source: 'businessProfileService' }
    : (input.businessProfile.crew.defaultCrewSize
      ? { size: input.businessProfile.crew.defaultCrewSize, source: 'businessProfileDefault' }
      : notCalculated.add('crewRecommendation', 'No Business Profile crew size is configured.'));

  const materialCost = configuredMaterialCost(input);
  if (materialsCharge > 0 && materialCost === null) {
    notCalculated.add('knownDirectMaterialCost', 'Customer material charges are not authoritative internal material costs.');
  }
  let laborCost = input.settings.costs.laborCost;
  if (laborCost === null && laborHours !== null && crewRecommendation && input.businessProfile.crew.averageHourlyCost !== null) {
    laborCost = roundCurrency(laborHours * crewRecommendation.size * input.businessProfile.crew.averageHourlyCost);
  }
  if (laborCharge > 0 && laborCost === null) {
    notCalculated.add('knownInternalLaborCost', 'Internal labor cost requires hours, crew size, and an authoritative hourly cost.');
  }
  let equipmentCost = input.settings.costs.equipmentCost;
  const equipmentReference = scope.equipmentReference || (profileService && profileService.equipmentReference) || null;
  if (equipmentCost === null && equipmentReference) {
    equipmentCost = finiteOrNull(input.businessProfile.costs.equipmentCostByReference[equipmentReference], { nonNegative: true });
  }
  if (equipmentCharge > 0 && equipmentCost === null) {
    notCalculated.add('knownEquipmentCost', 'Customer equipment charges are not authoritative internal equipment costs.');
  }
  const travelCustomerCharge = pricing && distanceMiles !== null && travelRate !== null
    ? roundCurrency(distanceMiles * travelRate)
    : notCalculated.add('travelCustomerCharge', !pricing ? priceReason
      : (distanceMiles === null ? 'No authoritative travel distance is available.' : 'No customer travel charge is explicitly configured.'));
  const travelInternalCost = distanceMiles !== null && input.settings.costs.travelCostPerMile !== null
    ? roundCurrency(distanceMiles * input.settings.costs.travelCostPerMile)
    : notCalculated.add('knownTravelInternalCost', distanceMiles === null
      ? 'No authoritative travel distance is available.'
      : 'No authoritative internal travel cost rate is configured.');

  const requiredCosts = [];
  if (materialsCharge > 0) requiredCosts.push(materialCost);
  if (laborCharge > 0) requiredCosts.push(laborCost);
  if (equipmentCharge > 0) requiredCosts.push(equipmentCost);
  if (distanceMiles !== null) requiredCosts.push(travelInternalCost);
  const directCostsKnown = pricing && requiredCosts.length > 0 && requiredCosts.every(function (value) { return value !== null; });
  const knownDirectCosts = directCostsKnown
    ? roundCurrency(requiredCosts.reduce(function (sum, value) { return sum + value; }, 0))
    : notCalculated.add('knownDirectCosts', 'All applicable direct-cost components must be known.');
  const grossProfit = knownDirectCosts !== null && customerFacingPrice !== null
    ? roundCurrency(customerFacingPrice - knownDirectCosts)
    : notCalculated.add('grossProfit', 'Gross profit requires customer price and all applicable direct costs.');
  const grossMargin = grossProfit !== null && customerFacingPrice > 0
    ? roundCurrency(grossProfit / customerFacingPrice * 100)
    : notCalculated.add('grossMargin', 'Gross margin requires a calculated gross profit.');
  const overheadPercent = input.settings.costs.overheadPercent;
  const overhead = knownDirectCosts !== null && overheadPercent !== null
    ? roundCurrency(knownDirectCosts * overheadPercent / 100)
    : notCalculated.add('overhead', 'Overhead requires known direct costs and explicit overhead configuration.');
  const netProfit = grossProfit !== null && overhead !== null
    ? roundCurrency(grossProfit - overhead)
    : notCalculated.add('netProfit', 'Net profit requires gross profit and explicit overhead.');
  const netMargin = netProfit !== null && customerFacingPrice > 0
    ? roundCurrency(netProfit / customerFacingPrice * 100)
    : notCalculated.add('netMargin', 'Net margin requires a calculated net profit.');

  notCalculated.add('vehicleCost', 'No authoritative vehicle-cost allocation input is supported in Part 3.');
  notCalculated.add('fuelCost', 'No authoritative fuel-cost allocation input is supported in Part 3.');
  if (input.callDurationSeconds === null) notCalculated.add('callDurationSeconds', 'No call duration was supplied by the input source.');
  if (travelMinutes === null) notCalculated.add('travelMinutes', 'No authoritative travel time is available.');
  if (distanceMiles === null) notCalculated.add('travelDistanceMiles', 'No authoritative travel distance is available.');
  if (travelSource === null) notCalculated.add('travelSource', 'No authoritative travel source is available.');
  if (equipmentReference === null) notCalculated.add('equipmentReference', 'No authoritative equipment reference is available for this scope.');
  if (equipmentCost === null) notCalculated.add('knownEquipmentCost', 'No authoritative internal equipment cost is available.');
  if (materialCost === null) notCalculated.add('knownDirectMaterialCost', 'No authoritative internal material cost is available.');
  if (input.actualCrewAssignment === null) notCalculated.add('actualCrewAssignment', 'No actual crew assignment was supplied.');
  if (input.appointmentPreference === null) notCalculated.add('appointmentPreference', 'No appointment preference was supplied.');

  const requiredCount = definition ? (definition.scopeSchema.required || []).length : 0;
  const missingCount = Array.from(new Set(missing)).length;
  const confidenceScore = Math.max(0, Math.min(100, definition ? 100 - (missingCount * 30) - (conflicting.length * 20) : 0));
  const confidenceFactors = [
    { factor: 'supportedService', value: Boolean(definition) },
    { factor: 'requiredScopeCollected', value: Math.max(0, requiredCount - missingCount) + '/' + requiredCount },
    { factor: 'contradictoryFacts', value: conflicting.length },
    { factor: 'supportingFacts', value: input.facts.length },
  ];
  const recommendedActions = emergency.isEmergency
    ? [{ code: 'dispatch-review', label: 'Review for emergency dispatch', priority: 'critical' }]
    : (missingCount
      ? [{ code: 'collect-scope', label: 'Collect missing supported scope', priority: 'high' }]
      : (input.appointmentPreference
        ? [{ code: 'schedule-estimate', label: 'Schedule the requested estimate window', priority: 'high' }]
        : [{ code: 'review-estimate', label: 'Review and follow up on the preliminary estimate', priority: 'medium' }]));

  const fingerprintSource = clone(input);
  const normalizedInputFingerprint = sha256(fingerprintSource);
  let preliminaryRange = null;
  if (pricing && pricing.range) {
    const markupMultiplier = markupPercent !== null ? 1 + (markupPercent / 100) : 1;
    const fixedTravel = distanceMiles !== null && travelRate !== null ? distanceMiles * travelRate : 0;
    const configuredEmergencyMultiplier = emergency.isEmergency && emergencyMultiplier !== null && emergencyMultiplier > 1
      ? emergencyMultiplier : 1;
    preliminaryRange = {
      low: roundCurrency(((pricing.range.low * markupMultiplier) + fixedTravel) * configuredEmergencyMultiplier),
      high: roundCurrency(((pricing.range.high * markupMultiplier) + fixedTravel) * configuredEmergencyMultiplier),
    };
  } else {
    notCalculated.add('preliminaryRange', priceReason);
  }
  const output = {
    contract: 'CanonicalPolarisOutput',
    organizationId: input.organizationId,
    customerId: input.customerId,
    opportunityId: input.opportunityId,
    calculationVersion: input.calculationVersion,
    normalizedInputFingerprint,
    businessProfileInputVersion: input.businessProfile.version,
    businessProfileInputHash: input.businessProfile.hash,
    service: {
      key: input.service.key,
      label: definition ? definition.displayName : null,
      supported: Boolean(pricing),
      unpricedReason: pricing ? null : priceReason,
      scope: clone(scope),
    },
    customerFacingPrice,
    subtotalBeforeTax: customerFacingPrice,
    taxRatePercent,
    tax,
    taxDisposition: {
      status: tax === null ? 'notCalculated' : 'calculated',
      reason: taxReason,
    },
    totalIncludingTax,
    preliminaryRange,
    pricingLineItems: lineItems,
    materialsCharge,
    knownDirectMaterialCost: materialCost,
    laborCharge,
    laborHours,
    knownInternalLaborCost: laborCost,
    equipmentCharge,
    knownEquipmentCost: equipmentCost,
    equipmentReference,
    travel: {
      minutes: travelMinutes,
      distanceMiles,
      source: travelSource,
      customerCharge: travelCustomerCharge,
      knownInternalCost: travelInternalCost,
    },
    callDurationSeconds: input.callDurationSeconds,
    estimatedProductionDurationHours: productionDurationHours,
    crewRecommendation,
    actualCrewAssignment: clone(input.actualCrewAssignment),
    estimatedRevenue: customerFacingPrice,
    knownDirectCosts,
    grossProfit,
    grossMarginPercent: grossMargin,
    overhead,
    netProfit,
    netMarginPercent: netMargin,
    confidence: { score: confidenceScore, factors: confidenceFactors },
    risk: {
      emergency: emergency.isEmergency,
      signal: emergency.signal,
      evidence: emergency.evidence,
      evidenceTurnId: emergency.turnId,
      contradictoryFactIds: conflicting.map(function (fact) { return fact.id; }),
    },
    recommendedActions,
    appointmentPreference: clone(input.appointmentPreference),
    supportingTranscriptFactIds: input.facts.map(function (fact) { return fact.id; }),
    notCalculated: notCalculated.values,
  };

  if (/NaN|Infinity/.test(stableStringify(output))) throw new Error('canonical calculation produced a non-finite value');
  return output;
}

function readHistoricalSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw contractError('historical snapshot is required');
  return clone(snapshot);
}

module.exports = {
  CALCULATION_VERSION,
  adaptLiveInput,
  adaptSimulationInput,
  calculateCanonicalPolaris,
  normalizeCanonicalInput,
  readHistoricalSnapshot,
};
