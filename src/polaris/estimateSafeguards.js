/**
 * estimateSafeguards.js — M19.5 Phase D: Estimate Eligibility and Adjustment Model
 *
 * Governs which Phase C typed facts may influence opportunity estimates.
 * Only facts meeting ALL eligibility criteria may directly affect pricing.
 */
'use strict';

const entityModel = require('./entityModel');

// ── Revenue Defaults (unmodified) ──

const TREE_SERVICE_BASELINE = {
  min: 1800,
  max: 3800,
  currency: 'USD',
  source: 'M19.4 default — Phase D preserves unchanged'
};

// ── Eligibility Rules ──

/**
 * Check if a fact is eligible for estimate influence.
 * Requirements (all must be true):
 * 1. status === 'collected'
 * 2. evidence.speaker === 'customer'
 * 3. normalizedValue !== null && normalizedValue !== undefined
 * 4. Not conflicting with another fact
 * 5. Associated with a valid entity
 * 6. Variable type is eligible for adjustment
 */
function isEligibleForEstimate(fact, entity) {
  // Hard requirements
  if (fact.status !== 'collected') {
    return { eligible: false, reason: 'status_not_collected: ' + fact.status };
  }
  if (!fact.evidence || fact.evidence.speaker !== 'customer') {
    return { eligible: false, reason: 'speaker_not_customer: ' + (fact.evidence ? fact.evidence.speaker : 'none') };
  }
  if (fact.normalizedValue === null || fact.normalizedValue === undefined) {
    return { eligible: false, reason: 'null_normalized_value' };
  }
  if (fact.status === 'conflicting') {
    return { eligible: false, reason: 'conflicting_status' };
  }

  // Soft checks (reduce confidence but don't block eligibility)
  const issues = [];
  if (fact.extractionConfidence !== undefined && fact.extractionConfidence < 0.5) {
    issues.push('low_extraction_confidence');
  }
  if (!entity) {
    issues.push('no_entity_association');
  }

  return {
    eligible: true,
    issues: issues.length > 0 ? issues : null,
    reason: 'eligible'
  };
}

/**
 * Classify an ineligible fact with its exclusion reason.
 */
function classifyIneligible(fact, entity) {
  const check = isEligibleForEstimate(fact, entity);
  if (check.eligible) return null;

  return {
    factId: fact.factId || (fact.variable + '_' + (fact.evidence ? fact.evidence.turnId : 'unknown')),
    variable: fact.variable,
    status: fact.status,
    normalizedValue: fact.normalizedValue,
    speaker: fact.evidence ? fact.evidence.speaker : 'unknown',
    eligible: false,
    exclusionReason: check.reason
  };
}

// ── Adjustment Model ──

/**
 * Known adjustment factors for Tree Service.
 * Each factor specifies its effect direction and whether it's currently calibrated.
 */
const ADJUSTMENT_FACTORS = {
  tree_height: {
    label: 'Tree Height',
    effect: 'increase',
    calibrated: false,
    requiresVerification: true,
    description: 'Taller trees increase equipment and labor requirements'
  },
  trunk_diameter: {
    label: 'Trunk Diameter',
    effect: 'increase',
    calibrated: false,
    requiresVerification: true,
    description: 'Larger trunks require more cutting and removal effort'
  },
  quantity: {
    label: 'Tree Quantity',
    effect: 'increase',
    calibrated: false,
    requiresVerification: true,
    description: 'More trees increase total scope'
  },
  hazard: {
    label: 'Hazard / Risk',
    effect: 'increase',
    calibrated: false,
    requiresVerification: true,
    description: 'Hazardous trees require specialized equipment and safety measures'
  },
  location_difficulty: {
    label: 'Location Difficulty',
    effect: 'increase',
    calibrated: false,
    requiresVerification: true,
    description: 'Difficult access increases labor and equipment costs'
  },
  stump_removal: {
    label: 'Stump Removal',
    effect: 'increase',
    calibrated: false,
    requiresVerification: true,
    description: 'Stump removal adds grinding and cleanup'
  },
  emergency: {
    label: 'Emergency Response',
    effect: 'increase',
    calibrated: false,
    requiresVerification: true,
    description: 'Emergency service requires priority scheduling'
  },
  debris_removal: {
    label: 'Debris Removal',
    effect: 'increase',
    calibrated: false,
    requiresVerification: true,
    description: 'Full debris removal adds hauling and disposal costs'
  }
};

/**
 * Build adjustment objects from eligible facts and tree entity.
 * Returns { adjustments: EstimateAdjustment[], considerations: Object[] }
 */
function buildAdjustments(entity, eligibleFacts, allFacts) {
  const adjustments = [];
  const considerations = [];

  for (const fact of eligibleFacts) {
    if (!isEligibleForEstimate(fact, entity).eligible) continue;

    const variable = fact.variable;
    const value = fact.normalizedValue;
    const factId = fact.factId || (variable + '_' + (fact.evidence ? fact.evidence.turnId : 'unknown'));

    // Map variable to adjustment factor
    let factorKey = null;
    let reason = null;

    if (variable === 'Tree Height') {
      factorKey = 'tree_height';
      reason = 'Tree height: ' + value + (fact.unit || 'ft') + ' — requires verification';
    } else if (variable === 'Trunk Size') {
      factorKey = 'trunk_diameter';
      reason = 'Trunk diameter: ' + value + (fact.unit || 'in') + ' — requires verification';
    } else if (variable === 'quantity') {
      factorKey = 'quantity';
      reason = 'Tree quantity: ' + value + ' — scope factor';
    } else if (variable === 'urgency' && value === 'high') {
      factorKey = 'emergency';
      reason = 'Emergency response requested';
    } else if (variable === 'Stump Removal' || variable === 'Stump Grinding') {
      factorKey = 'stump_removal';
      reason = 'Stump removal requested';
    } else if (variable === 'Location Difficulty') {
      factorKey = 'location_difficulty';
      reason = 'Location difficulty: ' + value;
    } else if (variable === 'Debris Removal' || variable === 'Debris Removal Preference') {
      factorKey = 'debris_removal';
      reason = 'Debris removal requested';
    }

    if (factorKey && ADJUSTMENT_FACTORS[factorKey]) {
      const factor = ADJUSTMENT_FACTORS[factorKey];
      adjustments.push({
        factor: factorKey,
        effect: 'widen',
        reason: reason,
        sourceFactIds: [factId],
        eligibilityStatus: 'eligible',
        requiresVerification: factor.requiresVerification
      });
    }
  }

  // Build considerations from entity data
  const totalQuantity = entityModel.computeJobQuantity(entity);

  if (totalQuantity > 1) {
    considerations.push({
      type: 'quantity',
      value: totalQuantity,
      label: 'Multiple trees: ' + totalQuantity,
      status: 'estimate_consideration',
      requiresVerification: true
    });
  }

  for (const group of entity.treeGroups) {
    for (const hazard of group.hazards) {
      considerations.push({
        type: 'hazard',
        description: hazard.description,
        status: 'estimate_consideration',
        requiresVerification: true
      });
    }
  }

  return {
    adjustments: adjustments,
    considerations: considerations
  };
}

// ── Confidence ──

/**
 * Compute estimate confidence independent of extractionConfidence.
 * Reflects completeness of eligible required facts, unresolved conflicts,
 * entity association certainty, and whether scope exceeds default model.
 */
function computeEstimateConfidence(entity, eligibleFacts, allFacts, adjustments) {
  let score = 1.0;
  const factors = [];

  // Completeness: how many required facts are collected
  const requiredVars = ['requested_service', 'quantity', 'Tree Height'];
  let collectedCount = 0;
  let totalRequired = requiredVars.length;

  for (const v of requiredVars) {
    const found = allFacts.some(function(f) { return f.variable === v && f.status === 'collected'; });
    if (found) collectedCount++;
  }

  const completenessRatio = collectedCount / totalRequired;
  if (completenessRatio < 0.5) {
    score -= 0.3;
    factors.push('low_completeness');
  } else if (completenessRatio < 0.8) {
    score -= 0.1;
    factors.push('partial_completeness');
  }

  // Unresolved conflicts
  const conflicts = allFacts.filter(function(f) { return f.status === 'conflicting'; });
  if (conflicts.length > 0) {
    score -= 0.2;
    factors.push('conflicting_facts');
  }

  // Missing critical info
  const missing = allFacts.filter(function(f) { return f.status === 'missing'; });
  if (missing.length > 0) {
    score -= 0.1;
    factors.push('missing_information');
  }

  // Entity association certainty
  if (!entity || entity.treeGroups.length === 0) {
    score -= 0.2;
    factors.push('no_entity_association');
  }

  // Uncalibrated adjustments
  const uncalibrated = adjustments.filter(function(a) { return a.requiresVerification; });
  if (uncalibrated.length > 0) {
    score -= 0.1;
    factors.push('uncalibrated_adjustments');
  }

  // Clamp
  score = Math.max(0.1, Math.min(1.0, score));

  return {
    score: Math.round(score * 100) / 100,
    label: score >= 0.8 ? 'High' : score >= 0.5 ? 'Medium' : 'Low',
    factors: factors
  };
}

// ── Full Pipeline ──

/**
 * Run the complete estimate pipeline for a given set of facts and industry.
 * Returns the full estimate output.
 */
function runEstimatePipeline(facts, industry) {
  if (industry !== 'Tree Service') {
    return { applicable: false, reason: 'Phase D only covers Tree Service', baseline: null };
  }

  // Build entity
  const entity = entityModel.buildTreeServiceEntity(facts);

  // Classify eligible and ineligible facts
  const eligibleFacts = [];
  const ineligibleFacts = [];

  for (const fact of facts) {
    const check = isEligibleForEstimate(fact, entity);
    if (check.eligible) {
      eligibleFacts.push(fact);
    } else {
      ineligibleFacts.push(classifyIneligible(fact, entity));
    }
  }

  // Build adjustments
  const adjResult = buildAdjustments(entity, eligibleFacts, facts);

  // Compute confidence
  const confidence = computeEstimateConfidence(entity, eligibleFacts, facts, adjResult.adjustments);

  // Estimate range
  const estimateRange = {
    min: TREE_SERVICE_BASELINE.min,
    max: TREE_SERVICE_BASELINE.max,
    currency: TREE_SERVICE_BASELINE.currency,
    classification: 'Preliminary opportunity range — site verification required',
    confidence: confidence
  };

  // Widen range if confidence is low
  if (confidence.score < 0.5) {
    estimateRange.min = Math.round(TREE_SERVICE_BASELINE.min * 0.8);
    estimateRange.max = Math.round(TREE_SERVICE_BASELINE.max * 1.2);
  } else if (confidence.score < 0.8) {
    estimateRange.min = Math.round(TREE_SERVICE_BASELINE.min * 0.9);
    estimateRange.max = Math.round(TREE_SERVICE_BASELINE.max * 1.1);
  }

  return {
    applicable: true,
    baseline: TREE_SERVICE_BASELINE,
    estimateRange: estimateRange,
    entity: entity,
    eligibleFacts: eligibleFacts.map(function(f) {
      return {
        factId: f.factId || (f.variable + '_' + (f.evidence ? f.evidence.turnId : 'unknown')),
        variable: f.variable,
        normalizedValue: f.normalizedValue,
        status: f.status,
        speaker: f.evidence ? f.evidence.speaker : 'unknown'
      };
    }),
    ineligibleFacts: ineligibleFacts.filter(Boolean),
    adjustments: adjResult.adjustments,
    considerations: adjResult.considerations,
    confidence: confidence,
    missingEstimateInfo: computeMissingInfo(facts, entity),
    siteVerificationRequired: true,
    totalQuantity: entityModel.computeJobQuantity(entity)
  };
}

/**
 * Compute missing estimate information from facts.
 */
function computeMissingInfo(facts, entity) {
  const missing = [];
  const requiredForEstimate = [
    'Trunk Size', 'Stump Removal', 'Debris Removal',
    'Location Difficulty', 'Equipment Access'
  ];

  for (const v of requiredForEstimate) {
    const found = facts.some(function(f) { return f.variable === v && f.status === 'collected'; });
    if (!found) {
      missing.push(v);
    }
  }

  return missing;
}

module.exports = {
  TREE_SERVICE_BASELINE,
  isEligibleForEstimate,
  classifyIneligible,
  buildAdjustments,
  computeEstimateConfidence,
  runEstimatePipeline,
  ADJUSTMENT_FACTORS
};