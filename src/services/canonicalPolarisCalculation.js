'use strict';

const { adaptBusinessProfile, finiteOrNull, sha256, stableStringify, stableValue } = require('./businessProfileAdapter');
const { detectEmergencyEvidence, normalizeSpeaker } = require('./emergencyEvidence');

const CALCULATION_VERSION = 'm19-part3-canonical-v2';
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

function normalizeCanonicalInput(source) {
  const input = source && typeof source === 'object' ? source : {};
  const service = input.service && typeof input.service === 'object' ? input.service : {};
  const key = String(service.key || input.serviceKey || '').trim().toLowerCase();
  const profile = input.businessProfile && input.businessProfile.hash
    ? input.businessProfile
    : adaptBusinessProfile(input.businessProfile || {}, input.businessProfileVersion);
  const profileAuthority = input.businessProfileAuthority && typeof input.businessProfileAuthority === 'object'
    ? input.businessProfileAuthority : {};
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
    businessProfileAuthority: {
      id: profileAuthority.id ? String(profileAuthority.id) : null,
      version: profileAuthority.versionLabel ? String(profileAuthority.versionLabel) : profile.version,
      hash: profileAuthority.profileHash ? String(profileAuthority.profileHash) : profile.hash,
    },
    appointmentPreference: input.appointmentPreference ? stableValue(input.appointmentPreference) : null,
    travel: input.travel ? stableValue(input.travel) : null,
    actualCrewAssignment: input.actualCrewAssignment ? stableValue(input.actualCrewAssignment) : null,
    callDurationSeconds: finiteOrNull(input.callDurationSeconds, { nonNegative: true }),
    settings: {
      pricing: {
        customerMarkupPercent: profile.pricing.customerMarkupPercent,
        travelCustomerChargePerMile: profile.pricing.travelCustomerChargePerMile,
        emergencyMultiplier: profile.pricing.emergencyMultiplier,
      },
      costs: {
        overheadPercent: profile.costs.overheadPercent,
        travelCostPerMile: profile.costs.travelCostPerMile,
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

function configuredMaterialCost(input) {
  const map = input.businessProfile.costs.materialCostByService || {};
  const material = input.service.scope.material ? String(input.service.scope.material).toLowerCase() : '';
  return finiteOrNull(map[input.service.key + ':' + material], { nonNegative: true });
}

function matchedProfileService(input) {
  return (input.businessProfile.services || []).find(function (service) {
    return String(service.id || '').toLowerCase() === input.service.key;
  }) || null;
}

function hasOwn(source, key) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
}

function configuredNumberState(source, key, options) {
  if (!hasOwn(source, key)) return { status: 'missing', value: null };
  const value = finiteOrNull(source[key], options);
  return value === null ? { status: 'malformed', value: null } : { status: 'configured', value };
}

function exactCondition(condition, scope) {
  if (condition === undefined || condition === null) return { applies: true, field: null, error: null };
  if (!condition || typeof condition !== 'object' || !condition.field || !hasOwn(condition, 'equals')) {
    return { applies: false, field: null, error: 'pricing_rule_condition_malformed' };
  }
  const field = String(condition.field);
  if (!hasOwn(scope, field)) return { applies: false, field, error: null };
  return {
    applies: stableStringify(scope[field]) === stableStringify(condition.equals),
    field,
    error: null,
  };
}

function ruleFailure(kind, code) {
  return kind + ':' + String(code || 'unnamed');
}

function calculateProfileLineItems(input, profileService, conflicting) {
  if (!profileService) {
    return { calculated: false, lineItems: [], reason: 'service_not_configured', requiredScope: [], fieldsUsed: [] };
  }
  const config = profileService.canonicalPricing;
  if (!config || typeof config !== 'object') {
    return { calculated: false, lineItems: [], reason: 'service_pricing_configuration_missing', requiredScope: [], fieldsUsed: [] };
  }
  if (!Array.isArray(config.lineItems) || config.lineItems.length === 0) {
    return { calculated: false, lineItems: [], reason: 'service_pricing_configuration_malformed', requiredScope: [], fieldsUsed: [] };
  }
  const requiredScope = Array.isArray(config.requiredScope)
    ? config.requiredScope.filter(function (field) { return typeof field === 'string' && field.trim(); }).map(String)
    : [];
  const fieldsUsed = ['services[' + profileService.id + '].canonicalPricing.requiredScope'];
  const unavailable = requiredScope.filter(function (field) {
    return !hasOwn(input.service.scope, field) || input.service.scope[field] === null || input.service.scope[field] === '' ||
      conflicting.some(function (fact) { return fact.variable === field; });
  });
  if (unavailable.length) {
    return {
      calculated: false,
      lineItems: [],
      reason: 'required_scope_unavailable:' + Array.from(new Set(unavailable)).sort().join(','),
      requiredScope,
      fieldsUsed,
    };
  }
  if (hasOwn(config, 'allowedScopeValues')) {
    if (!config.allowedScopeValues || typeof config.allowedScopeValues !== 'object' || Array.isArray(config.allowedScopeValues)) {
      return { calculated: false, lineItems: [], reason: 'allowed_scope_values_malformed', requiredScope, fieldsUsed };
    }
    for (const field of Object.keys(config.allowedScopeValues).sort()) {
      const allowed = config.allowedScopeValues[field];
      fieldsUsed.push('services[' + profileService.id + '].canonicalPricing.allowedScopeValues.' + field);
      if (!Array.isArray(allowed) || allowed.length === 0) {
        return { calculated: false, lineItems: [], reason: 'allowed_scope_values_malformed:' + field, requiredScope, fieldsUsed };
      }
      if (hasOwn(input.service.scope, field) && !allowed.some(function (value) {
        return stableStringify(value) === stableStringify(input.service.scope[field]);
      })) {
        return {
          calculated: false,
          lineItems: [],
          reason: 'pricing_scope_value_unsupported:' + field + ':' + String(input.service.scope[field]).toLowerCase(),
          requiredScope,
          fieldsUsed,
        };
      }
    }
  }

  const lineItems = [];
  const seenCodes = new Set();
  for (let index = 0; index < config.lineItems.length; index += 1) {
    const rule = config.lineItems[index];
    const code = rule && rule.code ? String(rule.code) : 'rule-' + (index + 1);
    const basePath = 'services[' + profileService.id + '].canonicalPricing.lineItems[' + code + ']';
    if (!rule || typeof rule !== 'object' || !rule.code || seenCodes.has(code)) {
      return { calculated: false, lineItems: [], reason: ruleFailure('pricing_rule_malformed', code), requiredScope, fieldsUsed };
    }
    seenCodes.add(code);
    const condition = exactCondition(rule.when, input.service.scope);
    if (condition.error) {
      return { calculated: false, lineItems: [], reason: ruleFailure(condition.error, code), requiredScope, fieldsUsed };
    }
    if (condition.field) fieldsUsed.push(basePath + '.when');
    if (!condition.applies) continue;

    const type = String(rule.type || '');
    let amount = null;
    if (type === 'fixed') {
      const fixed = configuredNumberState(rule, 'amount', { nonNegative: true });
      if (fixed.status !== 'configured') {
        return { calculated: false, lineItems: [], reason: ruleFailure('pricing_rule_amount_' + fixed.status, code), requiredScope, fieldsUsed };
      }
      amount = fixed.value;
      fieldsUsed.push(basePath + '.amount');
    } else if (type === 'perUnit') {
      const quantityField = rule.quantityField ? String(rule.quantityField) : '';
      if (!quantityField) {
        return { calculated: false, lineItems: [], reason: ruleFailure('pricing_rule_quantity_field_missing', code), requiredScope, fieldsUsed };
      }
      const quantity = configuredNumberState(input.service.scope, quantityField, { nonNegative: true });
      if (quantity.status !== 'configured') {
        return { calculated: false, lineItems: [], reason: 'pricing_quantity_' + quantity.status + ':' + quantityField, requiredScope, fieldsUsed };
      }
      const rate = configuredNumberState(rule, 'unitRate', { nonNegative: true });
      if (rate.status !== 'configured') {
        return { calculated: false, lineItems: [], reason: ruleFailure('pricing_rule_rate_' + rate.status, code), requiredScope, fieldsUsed };
      }
      amount = quantity.value * rate.value;
      fieldsUsed.push(basePath + '.unitRate');
    } else if (type === 'perUnitByValue') {
      const quantityField = rule.quantityField ? String(rule.quantityField) : '';
      const selectorField = rule.selectorField ? String(rule.selectorField) : '';
      const quantity = configuredNumberState(input.service.scope, quantityField, { nonNegative: true });
      if (!quantityField || quantity.status !== 'configured') {
        return { calculated: false, lineItems: [], reason: 'pricing_quantity_' + (quantityField ? quantity.status : 'field_missing') + ':' + quantityField, requiredScope, fieldsUsed };
      }
      if (!selectorField || !hasOwn(input.service.scope, selectorField)) {
        return { calculated: false, lineItems: [], reason: 'pricing_selector_missing:' + selectorField, requiredScope, fieldsUsed };
      }
      const selected = String(input.service.scope[selectorField]).toLowerCase();
      if (!rule.unitRates || typeof rule.unitRates !== 'object' || !hasOwn(rule.unitRates, selected)) {
        return { calculated: false, lineItems: [], reason: 'pricing_scope_value_unsupported:' + selectorField + ':' + selected, requiredScope, fieldsUsed };
      }
      const rate = configuredNumberState(rule.unitRates, selected, { nonNegative: true });
      if (rate.status !== 'configured') {
        return { calculated: false, lineItems: [], reason: ruleFailure('pricing_rule_rate_' + rate.status, code), requiredScope, fieldsUsed };
      }
      amount = quantity.value * rate.value;
      fieldsUsed.push(basePath + '.unitRates.' + selected);
    } else if (type === 'perItemByValue') {
      const collectionField = rule.collectionField ? String(rule.collectionField) : '';
      const selectorField = rule.selectorField ? String(rule.selectorField) : '';
      const collection = collectionField && input.service.scope[collectionField];
      if (!Array.isArray(collection)) {
        return { calculated: false, lineItems: [], reason: 'pricing_collection_missing:' + collectionField, requiredScope, fieldsUsed };
      }
      if (!selectorField || !rule.unitRates || typeof rule.unitRates !== 'object') {
        return { calculated: false, lineItems: [], reason: ruleFailure('pricing_rule_rate_map_malformed', code), requiredScope, fieldsUsed };
      }
      amount = 0;
      for (const item of collection) {
        const selected = item && hasOwn(item, selectorField) ? String(item[selectorField]).toLowerCase() : '';
        if (!selected || !hasOwn(rule.unitRates, selected)) {
          return { calculated: false, lineItems: [], reason: 'pricing_scope_value_unsupported:' + collectionField + '.' + selectorField + ':' + selected, requiredScope, fieldsUsed };
        }
        const rate = configuredNumberState(rule.unitRates, selected, { nonNegative: true });
        if (rate.status !== 'configured') {
          return { calculated: false, lineItems: [], reason: ruleFailure('pricing_rule_rate_' + rate.status, code), requiredScope, fieldsUsed };
        }
        amount += rate.value;
        fieldsUsed.push(basePath + '.unitRates.' + selected);
      }
    } else {
      return { calculated: false, lineItems: [], reason: ruleFailure('pricing_rule_type_unsupported', code), requiredScope, fieldsUsed };
    }

    lineItems.push({
      code: 'profile-' + code,
      label: String(rule.label || code),
      category: String(rule.category || 'serviceCharge'),
      customerCharge: roundCurrency(amount),
    });
  }
  return {
    calculated: true,
    lineItems,
    reason: null,
    requiredScope,
    fieldsUsed: Array.from(new Set(fieldsUsed)).sort(),
  };
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
  const scope = input.service.scope;
  const conflicting = input.facts.filter(function (fact) { return fact.status === 'conflicting'; });
  const notCalculated = notCalculatedCollector();
  const profileService = matchedProfileService(input);
  const profilePricing = calculateProfileLineItems(input, profileService, conflicting);
  const pricingCalculated = profilePricing.calculated;
  const priceReason = profilePricing.reason;
  const lineItems = profilePricing.lineItems.slice();
  const baseSubtotal = pricingCalculated
    ? roundCurrency(lineItems.reduce(function (sum, line) { return sum + line.customerCharge; }, 0))
    : null;

  const emergency = detectEmergencyEvidence(input.transcript);
  const markupPercent = input.settings.pricing.customerMarkupPercent;
  if (pricingCalculated && markupPercent !== null && markupPercent > 0) {
    lineItems.push({
      code: 'configured-markup',
      label: 'Configured customer markup',
      category: 'markup',
      customerCharge: roundCurrency(baseSubtotal * markupPercent / 100),
    });
  }

  const distanceMiles = input.travel ? finiteOrNull(input.travel.distanceMiles, { nonNegative: true }) : null;
  const travelMinutes = input.travel ? finiteOrNull(input.travel.minutes, { nonNegative: true }) : null;
  const travelSource = input.travel && input.travel.source ? String(input.travel.source) : null;
  const travelRate = input.settings.pricing.travelCustomerChargePerMile;
  if (pricingCalculated && distanceMiles !== null && travelRate !== null) {
    lineItems.push({
      code: 'configured-travel',
      label: 'Configured travel charge',
      category: 'travel',
      customerCharge: roundCurrency(distanceMiles * travelRate),
    });
  }

  const emergencyMultiplier = input.settings.pricing.emergencyMultiplier;
  if (pricingCalculated && emergency.isEmergency && emergencyMultiplier !== null && emergencyMultiplier > 1) {
    const beforeEmergency = lineItems.reduce(function (sum, line) { return sum + line.customerCharge; }, 0);
    lineItems.push({
      code: 'configured-emergency',
      label: 'Configured emergency adjustment',
      category: 'emergency',
      customerCharge: roundCurrency(beforeEmergency * (emergencyMultiplier - 1)),
    });
  }

  const customerFacingPrice = pricingCalculated
    ? roundCurrency(lineItems.reduce(function (sum, line) { return sum + line.customerCharge; }, 0))
    : notCalculated.add('customerFacingPrice', priceReason);
  const materialsCharge = pricingCalculated
    ? roundCurrency(lineItems.filter(function (line) { return line.category === 'materials'; }).reduce(function (sum, line) { return sum + line.customerCharge; }, 0))
    : notCalculated.add('materialsCharge', priceReason);
  const laborCharge = pricingCalculated
    ? roundCurrency(lineItems.filter(function (line) { return line.category === 'labor'; }).reduce(function (sum, line) { return sum + line.customerCharge; }, 0))
    : notCalculated.add('laborCharge', priceReason);
  const equipmentCharge = pricingCalculated
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

  const laborHours = finiteOrNull(scope.laborHours, { nonNegative: true })
    ?? notCalculated.add('laborHours', 'No authoritative production-hours fact exists for this service scope.');
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
  let laborCost = null;
  if (laborHours !== null && crewRecommendation && input.businessProfile.crew.averageHourlyCost !== null) {
    laborCost = roundCurrency(laborHours * crewRecommendation.size * input.businessProfile.crew.averageHourlyCost);
  }
  if (laborCharge > 0 && laborCost === null) {
    notCalculated.add('knownInternalLaborCost', 'Internal labor cost requires hours, crew size, and an authoritative hourly cost.');
  }
  let equipmentCost = null;
  const equipmentReference = scope.equipmentReference || (profileService && profileService.equipmentReference) || null;
  if (equipmentCost === null && equipmentReference) {
    equipmentCost = finiteOrNull(input.businessProfile.costs.equipmentCostByReference[equipmentReference], { nonNegative: true });
  }
  if (equipmentCharge > 0 && equipmentCost === null) {
    notCalculated.add('knownEquipmentCost', 'Customer equipment charges are not authoritative internal equipment costs.');
  }
  const travelCustomerCharge = pricingCalculated && distanceMiles !== null && travelRate !== null
    ? roundCurrency(distanceMiles * travelRate)
    : notCalculated.add('travelCustomerCharge', !pricingCalculated ? priceReason
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
  const directCostsKnown = pricingCalculated && requiredCosts.length > 0 && requiredCosts.every(function (value) { return value !== null; });
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

  const requiredCount = profilePricing.requiredScope.length;
  const missingCount = priceReason && priceReason.startsWith('required_scope_unavailable:')
    ? priceReason.slice('required_scope_unavailable:'.length).split(',').filter(Boolean).length : 0;
  const confidenceScore = Math.max(0, Math.min(100, profileService ? 100 - (missingCount * 30) - (conflicting.length * 20) : 0));
  const confidenceFactors = [
    { factor: 'supportedService', value: Boolean(profileService) },
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
  const rangeState = profileService && profileService.canonicalPricing
    ? configuredNumberState(profileService.canonicalPricing, 'rangePercent', { nonNegative: true })
    : { status: 'missing', value: null };
  if (pricingCalculated && rangeState.status === 'configured') {
    const rangeMultiplier = rangeState.value / 100;
    preliminaryRange = {
      low: roundCurrency(customerFacingPrice * Math.max(0, 1 - rangeMultiplier)),
      high: roundCurrency(customerFacingPrice * (1 + rangeMultiplier)),
    };
  } else {
    notCalculated.add('preliminaryRange', priceReason || 'range_configuration_' + rangeState.status);
  }
  const businessProfileFieldsUsed = Array.from(new Set(profilePricing.fieldsUsed.concat([
    'canonicalPricing.customerMarkupPercent',
    'canonicalPricing.travelCustomerChargePerMile',
    'canonicalPricing.emergencyMultiplier',
    'canonicalPricing.taxRatePercent',
    'canonicalCosts.overheadPercent',
    'canonicalCosts.travelCostPerMile',
    'canonicalCosts.materialCostByService',
    'canonicalCosts.equipmentCostByReference',
    'crew.defaultCrewSize',
    'crew.averageHourlyRate',
  ], rangeState.status === 'configured' && profileService
    ? ['services[' + profileService.id + '].canonicalPricing.rangePercent'] : []))).sort();
  const output = {
    contract: 'CanonicalPolarisOutput',
    organizationId: input.organizationId,
    customerId: input.customerId,
    opportunityId: input.opportunityId,
    calculationVersion: input.calculationVersion,
    normalizedInputFingerprint,
    businessProfileInputId: input.businessProfileAuthority.id,
    businessProfileInputVersion: input.businessProfileAuthority.version,
    businessProfileInputHash: input.businessProfileAuthority.hash,
    businessProfileFieldsUsed,
    service: {
      key: input.service.key,
      label: profileService ? profileService.name : null,
      supported: pricingCalculated,
      unpricedReason: pricingCalculated ? null : priceReason,
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
