'use strict';

const CATALOG = require('../routes/simulation/service-catalog');

const PUBLIC_FIELDS = Object.freeze([
  'service', 'serviceClassification', 'supportingEvidence', 'scope',
  'missingInformation', 'assumptions', 'qualification', 'urgency',
  'customerIntent', 'bookingIntent', 'customerSentiment', 'pricingStrategy',
  'pricingRecommendation', 'preliminaryRange', 'pricingBreakdown',
  'internalCost', 'customerFacingPrice', 'confidenceScore', 'confidenceLevel',
  'confidenceExplanation', 'recommendedAction', 'operationalReasoning',
  'pipelineVersion',
]);

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function findServiceKey(serviceName, requestedKey) {
  if (requestedKey && CATALOG[requestedKey]) return requestedKey;
  const normalized = String(serviceName || '').toLowerCase();
  return Object.keys(CATALOG).find(function (key) {
    return CATALOG[key].displayName.toLowerCase() === normalized;
  }) || null;
}

function build(options) {
  const opts = options || {};
  const classification = opts.classification || {};
  const serviceKey = findServiceKey(classification.service, opts.serviceKey);
  const serviceDefinition = serviceKey ? CATALOG[serviceKey] : null;
  const schema = serviceDefinition ? serviceDefinition.scopeSchema : { required: [], recommended: [], optional: [] };
  const permittedScope = unique([].concat(schema.required || [], schema.recommended || [], schema.optional || []));
  const rawScope = opts.scope || {};
  const scope = {};
  const supportingEvidence = {};

  permittedScope.forEach(function (field) {
    if (rawScope[field] !== undefined) scope[field] = rawScope[field];
    if (opts.evidence && opts.evidence[field]) supportingEvidence[field] = opts.evidence[field];
  });

  const missingInformation = unique([].concat(opts.missingInformation || []).filter(function (field) {
    return permittedScope.indexOf(field) !== -1;
  }));
  const missingRequired = (schema.required || []).filter(function (field) {
    return scope[field] === undefined || missingInformation.indexOf(field) !== -1;
  });

  const profile = opts.businessProfile || {};
  const financial = profile.financial || {};
  const configuredMarkup = Number(financial.markup);
  const markupMultiplier = configuredMarkup > 0 ? configuredMarkup : 1;
  const emergency = Boolean(opts.emergencyEvidence && opts.emergencyEvidence.isEmergency === true);
  const emergencyMultiplier = emergency && Number(financial.emergencyMarkup) > 1
    ? Number(financial.emergencyMarkup) : 1;

  const sourcePricing = opts.pricing || {};
  const canPrice = missingRequired.length === 0 && Number(sourcePricing.total) > 0;
  let internalCost = null;
  let customerFacingPrice = null;
  let preliminaryRange = null;
  let pricingBreakdown = [];

  if (canPrice) {
    const baseComponents = (sourcePricing.breakdown || []).filter(function (component) {
      return Number(component.amount) > 0;
    }).map(function (component) {
      return {
        label: component.label || component.description || 'Cost component',
        amount: roundCurrency(component.amount),
        category: 'internalCost',
      };
    });
    internalCost = roundCurrency(baseComponents.reduce(function (sum, component) {
      return sum + component.amount;
    }, 0));
    if (!internalCost) internalCost = roundCurrency(sourcePricing.total);
    pricingBreakdown = baseComponents;

    if (markupMultiplier > 1) {
      pricingBreakdown.push({
        label: 'Business Profile markup (' + Math.round((markupMultiplier - 1) * 100) + '%)',
        amount: roundCurrency(internalCost * (markupMultiplier - 1)),
        category: 'markup',
      });
    }
    if (emergencyMultiplier > 1) {
      const beforeEmergency = pricingBreakdown.reduce(function (sum, component) { return sum + component.amount; }, 0);
      pricingBreakdown.push({
        label: 'Business Profile emergency adjustment',
        amount: roundCurrency(beforeEmergency * (emergencyMultiplier - 1)),
        category: 'emergencyAdjustment',
      });
    }

    customerFacingPrice = roundCurrency(pricingBreakdown.reduce(function (sum, component) {
      return sum + component.amount;
    }, 0));
    if (sourcePricing.range && Number(sourcePricing.range.low) > 0 && Number(sourcePricing.range.high) > 0) {
      preliminaryRange = {
        low: roundCurrency(sourcePricing.range.low * markupMultiplier * emergencyMultiplier),
        high: roundCurrency(sourcePricing.range.high * markupMultiplier * emergencyMultiplier),
      };
    }
  }

  let confidenceScore = Math.max(0, Math.min(100, Number(opts.confidence && opts.confidence.score) || 0));
  if (missingRequired.length) confidenceScore = Math.min(confidenceScore, 49);
  const confidenceLevel = confidenceScore >= 80 ? 'high' : confidenceScore >= 50 ? 'medium' : 'low';
  const label = serviceDefinition ? serviceDefinition.displayName : (classification.service || 'Unclassified service');
  const action = opts.recommendedAction || {};

  return {
    service: label,
    serviceClassification: {
      serviceKey: serviceKey,
      confidence: classification.confidence || 'low',
      alternatives: classification.alternatives || [],
    },
    supportingEvidence: supportingEvidence,
    scope: scope,
    missingInformation: unique(missingInformation.concat(missingRequired)),
    assumptions: canPrice
      ? ['Preliminary pricing uses the configured service catalog and Business Profile pricing settings.']
      : [],
    qualification: missingRequired.length ? 'Needs assessment' : 'Qualified for preliminary review',
    urgency: emergency
      ? 'emergency'
      : (/emergency/i.test(String(scope.urgency || '')) ? 'not established' : (scope.urgency || 'not established')),
    customerIntent: 'Requesting ' + label.toLowerCase() + ' service',
    bookingIntent: action.action || action.label || 'Not established',
    customerSentiment: 'Not reliably determined',
    pricingStrategy: serviceDefinition && serviceDefinition.pricing ? serviceDefinition.pricing.strategy : 'insufficientInformation',
    pricingRecommendation: canPrice
      ? 'Preliminary only; verify scope and configured rates before quoting.'
      : 'Insufficient verified scope for a supported price; complete an assessment first.',
    preliminaryRange: preliminaryRange,
    pricingBreakdown: pricingBreakdown,
    internalCost: internalCost,
    customerFacingPrice: customerFacingPrice,
    confidenceScore: confidenceScore,
    confidenceLevel: confidenceLevel,
    confidenceExplanation: missingRequired.length
      ? 'Confidence is limited because required scope is missing: ' + missingRequired.join(', ') + '.'
      : ((opts.confidence && opts.confidence.explanation) || 'Confidence reflects the supported scope captured in the simulated communication.'),
    recommendedAction: action,
    operationalReasoning: missingRequired.length
      ? 'Collect the missing service-specific scope before pricing or scheduling consequential work.'
      : 'Review the captured scope, Business Profile settings, crew and equipment availability, and site conditions before acting.',
    pipelineVersion: 'canonical-polaris-v1',
  };
}

function sanitize(value) {
  const source = value || {};
  return PUBLIC_FIELDS.reduce(function (result, field) {
    result[field] = source[field] === undefined ? null : source[field];
    return result;
  }, {});
}

module.exports = { PUBLIC_FIELDS, build, sanitize };
