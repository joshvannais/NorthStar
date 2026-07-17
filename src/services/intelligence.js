/**
 * Business Intelligence Engine — NorthStar's Central Calculation Layer
 *
 * Provides reusable business calculations consumed by ALL modules:
 *   - Polaris, Dashboard, Customer Cards, Estimates, Scheduling,
 *     Production, Retell, and all future AI modules.
 *
 * Architecture:
 *   Business Data → Business Context → Business Intelligence Engine → Consumers
 *
 * This is the SINGLE source of calculated business intelligence.
 * NO module should implement duplicate calculations.
 *
 * READ-ONLY: No edits, no mutations, no writes, no database updates.
 *
 * Future Compatibility:
 *   Designed so Mission 18+ can plug in actual labor rates,
 *   GPS routing, historical averages, and AI scope extraction
 *   without changing the architecture.
 */
'use strict';

const businessProfile = require('./businessProfile');

/**
 * Get operational defaults from the Business Profile.
 * Falls back to hardcoded defaults if BP field is missing.
 * Called once per pipeline run — cached in module scope.
 * @returns {Object} BP-driven defaults
 */
let _bpCache = null;
let _bpCacheTime = 0;
const BP_CACHE_TTL = 5000;

function getBPDefaults() {
  const now = Date.now();
  if (_bpCache && now - _bpCacheTime < BP_CACHE_TTL) return _bpCache;
  try {
    const bp = businessProfile.getProfile();
    _bpCache = {
      averageHourlyRate: (bp.crew && Number.isFinite(bp.crew.averageHourlyRate)) ? bp.crew.averageHourlyRate : 42,
      defaultCrewSize: (bp.crew && Number.isFinite(bp.crew.defaultCrewSize)) ? bp.crew.defaultCrewSize : 2,
      overtimeMultiplier: (bp.crew && Number.isFinite(bp.crew.overtimeMultiplier)) ? bp.crew.overtimeMultiplier : 1.0,
      materialCostPercent: (bp.financial && Number.isFinite(bp.financial.materialCostPercent)) ? bp.financial.materialCostPercent : 25,
      overheadPercent: (bp.financial && Number.isFinite(bp.financial.overheadPercent)) ? bp.financial.overheadPercent : 15,
      costPerMile: (bp.financial && Number.isFinite(bp.financial.travelCharge)) ? bp.financial.travelCharge : 0.58,
    };
    _bpCacheTime = now;
    return _bpCache;
  } catch (e) {
    return {
      averageHourlyRate: 42,
      defaultCrewSize: 2,
      overtimeMultiplier: 1.0,
      materialCostPercent: 25,
      overheadPercent: 15,
      costPerMile: 0.58,
    };
  }
}

// ====================================================================
// Module 1: Labor Cost Engine
// ====================================================================

/**
 * Calculate estimated labor cost.
 * @param {Object} opts
 * @param {number} opts.crewSize - Number of crew members
 * @param {number} opts.hours - Estimated production hours
 * @param {number} opts.hourlyRate - Hourly labor rate ($/hr)
 * @param {number} [opts.overtimeMultiplier=1.0] - Overtime multiplier (future-ready)
 * @returns {{ laborCost: number, breakdown: { crewSize: number, hours: number, hourlyRate: number, effectiveRate: number } }}
 */
function calculateLaborCost(opts) {
  // NaN guards — sanitize all numeric inputs
  const crewSize = Number.isFinite(opts.crewSize) ? opts.crewSize : 1;
  const hours = Number.isFinite(opts.hours) ? opts.hours : 0;
  const hourlyRate = Number.isFinite(opts.hourlyRate) ? opts.hourlyRate : 42;
  const overtimeMultiplier = Number.isFinite(opts.overtimeMultiplier) ? opts.overtimeMultiplier : 1.0;

  // Standard hours (40hr/week assumed as base)
  const standardHours = Math.min(hours, 40);
  const overtimeHours = Math.max(0, hours - 40);

  const standardCost = crewSize * standardHours * hourlyRate;
  const overtimeCost = crewSize * overtimeHours * hourlyRate * overtimeMultiplier;

  let laborCost = Math.round((standardCost + overtimeCost) * 100) / 100;
  if (!Number.isFinite(laborCost)) laborCost = 0;

  return {
    laborCost,
    breakdown: {
      crewSize,
      hours,
      hourlyRate,
      effectiveRate: Number.isFinite(hourlyRate * overtimeMultiplier)
        ? Math.round(hourlyRate * overtimeMultiplier * 100) / 100 : hourlyRate,
      standardHours,
      overtimeHours,
      standardCost: Number.isFinite(standardCost) ? Math.round(standardCost * 100) / 100 : 0,
      overtimeCost: Number.isFinite(overtimeCost) ? Math.round(overtimeCost * 100) / 100 : 0,
    },
  };
}

// ====================================================================
// Module 2: Crew Size Engine
// ====================================================================

/**
 * Centralized service-to-crew-size mapping.
 * Easily extendable — add new services here.
 * Default sourced from Business Profile (falls back to 2).
 */
function getDefaultCrewSize() {
  return getBPDefaults().defaultCrewSize;
}

const CREW_SIZE_MAP = {
  'Window replacement': 2,
  'Window Replacement': 2,
  'Roof Repair': 3,
  'Roof repair': 3,
  'Tree Removal': 4,
  'Tree removal': 4,
  'Emergency Service': 3,
  'HVAC repair': 2,
  'HVAC Repair': 2,
  'Electrical panel upgrade': 2,
  'Electrical': 2,
  'Plumbing': 2,
  'Foundation Repair': 3,
  'Foundation repair': 3,
  'Concrete driveway': 3,
  'Concrete': 3,
  'Siding Installation/Repair': 2,
  'Siding': 2,
  'Drywall Repair/Installation': 2,
  'Drywall': 2,
  'Bathroom Remodeling': 2,
  'Bathroom': 2,
  'Flooring Installation': 2,
  'Flooring': 2,
  'Mold Remediation': 2,
  'Mold': 2,
  'Appliance Repair': 1,
  'Appliance': 1,
  'Chimney Service': 2,
  'Chimney': 2,
  'Well Pump Service': 2,
  'Well Pump': 2,
  'Septic System Service': 2,
  'Septic': 2,
};

/**
 * Get recommended crew size for a service type.
 * @param {string} serviceType
 * @returns {number} Recommended crew size
 */
function getRecommendedCrewSize(serviceType) {
  if (!serviceType) return getDefaultCrewSize();
  // Try exact match first, then partial match
  if (CREW_SIZE_MAP[serviceType]) return CREW_SIZE_MAP[serviceType];
  const lower = serviceType.toLowerCase();
  for (const [key, size] of Object.entries(CREW_SIZE_MAP)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return size;
    }
  }
  return getDefaultCrewSize();
}

// ====================================================================
// Module 3: Travel Engine
// ====================================================================

/**
 * Calculate travel time and cost.
 * Mission 16: Simulated travel calculations.
 * Mission 18: Replace with Google Maps, Mapbox, or GPS routing.
 *
 * The interface is designed so consumers don't change when the
 * implementation is upgraded.
 *
 * @param {Object} opts
 * @param {string} opts.serviceType - Type of service (affects travel time estimate)
 * @param {string} [opts.address] - Customer address (for future GPS routing)
 * @param {string} [opts.hqAddress] - Headquarters address (for future GPS routing)
 * @param {number} [opts.costPerMile] - Cost per mile from Business Profile (default: 0.58)
 * @returns {{ travelMinutes: number, travelCost: number, travelCostPerMinute: number }}
 */
function calculateTravel(opts) {
  const serviceType = (opts && typeof opts.serviceType === 'string') ? opts.serviceType : 'General';

  // Simulated travel times based on service type
  // In Mission 18, these will be replaced with actual GPS routing
  const TRAVEL_MINUTES_MAP = {
    'Window replacement': 15,
    'Window Replacement': 15,
    'Roof Repair': 20,
    'Tree Removal': 25,
    'Emergency Service': 12,
    'HVAC repair': 18,
    'Electrical panel upgrade': 15,
    'Foundation Repair': 22,
    'Concrete driveway': 20,
    'Siding Installation/Repair': 18,
    'Drywall Repair/Installation': 15,
    'Bathroom Remodeling': 15,
    'Flooring Installation': 15,
    'Mold Remediation': 18,
    'Appliance Repair': 12,
    'Chimney Service': 15,
    'Well Pump Service': 20,
    'Septic System Service': 22,
  };

  // Default travel time
  let travelMinutes = 18;

  // Look up by exact match
  if (TRAVEL_MINUTES_MAP[serviceType]) {
    travelMinutes = TRAVEL_MINUTES_MAP[serviceType];
  } else {
    // Partial match
    const lower = serviceType.toLowerCase();
    for (const [key, minutes] of Object.entries(TRAVEL_MINUTES_MAP)) {
      if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
        travelMinutes = minutes;
        break;
      }
    }
  }

  // Travel cost: sourced from Business Profile (IRS standard default $0.58/mile)
  // Convert to per-minute: costPerMile * (miles per minute) ≈ costPerMile * (35/60)
  // Simplified: ~costPerMile * 0.583 per minute
  const costPerMile = (opts && Number.isFinite(opts.costPerMile)) ? opts.costPerMile : 0.58;
  const travelCostPerMinute = Math.round(costPerMile * 0.583 * 100) / 100;
  let travelCost = Math.round(travelMinutes * travelCostPerMinute * 100) / 100;

  // NaN guard — ensure outputs are finite
  if (!Number.isFinite(travelCost)) travelCost = 0;
  if (!Number.isFinite(travelMinutes)) travelMinutes = 18;

  return {
    travelMinutes,
    travelCost,
    travelCostPerMinute,
  };
}

// ====================================================================
// Module 4: Production Duration Engine
// ====================================================================

/**
 * Estimate production duration for a job.
 *
 * Inputs: service type, crew size, job complexity
 * Returns: estimated hours, confidence score
 *
 * Future: Replace with historical production averages from completed jobs.
 *
 * @param {Object} opts
 * @param {string} opts.serviceType
 * @param {number} [opts.crewSize] - Recomputed if not provided
 * @param {string} [opts.complexity] - 'simple', 'standard', 'complex'
 * @param {number} [opts.avgPrice] - Job price for estimating scope
 * @returns {{ estimatedHours: number, confidenceScore: number, confidenceLabel: string, breakdown: Object }}
 */
function estimateProductionDuration(opts) {
  const serviceType = opts.serviceType || 'General';
  const crewSize = Number.isFinite(opts.crewSize) ? opts.crewSize : getRecommendedCrewSize(serviceType);
  const complexity = opts.complexity || 'standard';
  const avgPrice = Number.isFinite(opts.avgPrice) ? opts.avgPrice : 0;

  // Base hours by service type
  const BASE_HOURS_MAP = {
    'Window replacement': 3.5,
    'Window Replacement': 3.5,
    'Roof Repair': 6.0,
    'Tree Removal': 5.0,
    'Emergency Service': 2.0,
    'HVAC repair': 2.5,
    'Electrical panel upgrade': 3.0,
    'Foundation Repair': 5.0,
    'Concrete driveway': 4.5,
    'Siding Installation/Repair': 4.0,
    'Drywall Repair/Installation': 3.0,
    'Bathroom Remodeling': 6.0,
    'Flooring Installation': 3.5,
    'Mold Remediation': 3.0,
    'Appliance Repair': 1.5,
    'Chimney Service': 2.0,
    'Well Pump Service': 3.0,
    'Septic System Service': 4.0,
  };

  let baseHours = 3.0;
  const lower = serviceType.toLowerCase();
  for (const [key, hours] of Object.entries(BASE_HOURS_MAP)) {
    if (key.toLowerCase() === serviceType.toLowerCase() ||
        key.toLowerCase().includes(lower) ||
        lower.includes(key.toLowerCase())) {
      baseHours = hours;
      break;
    }
  }
  // NaN guard — ensure baseHours is finite
  if (!Number.isFinite(baseHours)) baseHours = 3.0;

  // Complexity multiplier
  const COMPLEXITY_MAP = { simple: 0.7, standard: 1.0, complex: 1.5 };
  const complexityMultiplier = COMPLEXITY_MAP[complexity] || 1.0;

  // Crew size adjustment: more crew = less time, but diminishing returns
  let crewEfficiencyFactor = 1 + (crewSize - 1) * 0.65;
  // Protect against NaN and divide-by-zero: efficiency factor must be > 0
  if (!Number.isFinite(crewEfficiencyFactor) || crewEfficiencyFactor <= 0) crewEfficiencyFactor = 1;
  const crewAdjustedHours = baseHours / crewEfficiencyFactor;

  // Price-based scope adjustment
  let priceFactor = 1.0;
  if (avgPrice > 0) {
    // Higher price jobs typically take longer
    priceFactor = 0.5 + (avgPrice / 5000);
    priceFactor = Math.max(0.5, Math.min(2.0, priceFactor));
  }

  const estimatedHours = Math.round(crewAdjustedHours * complexityMultiplier * priceFactor * 10) / 10;

  // Confidence score
  // Higher when we have good data matches
  let confidenceScore = 75;
  const confidenceReasons = [];

  // Base confidence
  confidenceScore += 10; // 85

  // Service familiarity bonus
  if (BASE_HOURS_MAP[serviceType]) {
    confidenceScore += 5; // 90
    confidenceReasons.push('Service type recognized');
  }

  // Price data bonus
  if (avgPrice > 0) {
    confidenceScore += 5; // 95
    confidenceReasons.push('Pricing data available');
  }

  // Complexity adjustment
  if (complexity === 'simple') {
    confidenceScore += 3;
    confidenceReasons.push('Simple job scope');
  } else if (complexity === 'complex') {
    confidenceScore -= 5;
    confidenceReasons.push('Complex job scope');
  }

  // Cap at 99
  confidenceScore = Math.min(99, confidenceScore);

  const confidenceLabel = confidenceScore >= 90 ? 'High' : confidenceScore >= 70 ? 'Medium' : 'Low';

  // NaN guard — ensure outputs are finite
  const safeEstimatedHours = Number.isFinite(estimatedHours) ? estimatedHours : 3.0;
  const safeConfidenceScore = Number.isFinite(confidenceScore) ? confidenceScore : 75;

  return {
    estimatedHours: safeEstimatedHours,
    confidenceScore: safeConfidenceScore,
    confidenceLabel,
    breakdown: {
      baseHours,
      crewSize,
      complexityMultiplier,
      crewEfficiencyFactor,
      priceFactor,
      totalHours: safeEstimatedHours,
    },
    confidenceReasons,
  };
}

// ====================================================================
// Module 5: Estimated Profit Engine
// ====================================================================

/**
 * Calculate estimated profit and profit margin.
 *
 * Revenue - Labor - Materials (placeholder) - Travel Cost = Estimated Profit
 *
 * @param {Object} opts
 * @param {number} opts.revenue - Estimated or quoted revenue
 * @param {Object} [opts.laborResult] - Result from calculateLaborCost()
 * @param {number} [opts.materialCost] - Material cost (placeholder for future)
 * @param {Object} [opts.travelResult] - Result from calculateTravel()
 * @param {number} [opts.overheadPercent] - Overhead percentage (default: 15)
 * @returns {{ estimatedProfit: number, profitMargin: string, breakdown: Object }}
 */
function calculateEstimatedProfit(opts) {
  // NaN guards — sanitize all numeric inputs
  const revenue = Number.isFinite(opts.revenue) ? opts.revenue : 0;
  const laborCost = (opts.laborResult && Number.isFinite(opts.laborResult.laborCost))
    ? opts.laborResult.laborCost : 0;
  const materialCost = Number.isFinite(opts.materialCost)
    ? opts.materialCost
    : Math.round(revenue * 0.25 * 100) / 100; // 25% placeholder
  const travelCost = (opts.travelResult && Number.isFinite(opts.travelResult.travelCost))
    ? opts.travelResult.travelCost : 0;
  const overheadPercent = Number.isFinite(opts.overheadPercent) ? opts.overheadPercent : 15;

  // Calculate overhead
  const overhead = Math.round((revenue * overheadPercent / 100) * 100) / 100;

  // Total costs
  const totalCosts = Math.round((laborCost + materialCost + travelCost + overhead) * 100) / 100;

  // Profit
  let estimatedProfit = Math.round((revenue - totalCosts) * 100) / 100;
  // NaN guard
  if (!Number.isFinite(estimatedProfit)) estimatedProfit = 0;

  // Profit margin — guard against NaN/Infinity and divide-by-zero
  let profitMargin;
  if (Number.isFinite(revenue) && revenue > 0 && Number.isFinite(estimatedProfit)) {
    profitMargin = ((estimatedProfit / revenue) * 100).toFixed(1) + '%';
  } else {
    profitMargin = '0.0%';
  }

  return {
    estimatedProfit,
    profitMargin,
    breakdown: {
      revenue,
      laborCost,
      materialCost,
      travelCost,
      overhead,
      overheadPercent,
      totalCosts,
    },
  };
}

// ====================================================================
// Module 6: Confidence Engine
// ====================================================================

/**
 * Calculate a confidence score for an estimate or recommendation.
 *
 * @param {Object} opts
 * @param {string} opts.serviceType - Service type familiarity
 * @param {number} [opts.avgPrice] - Average price for this service
 * @param {number} [opts.leadCount] - Number of similar leads in system
 * @param {boolean} [opts.hasCustomerHistory] - Whether customer has prior jobs
 * @param {boolean} [opts.hasKnownPricing] - Whether pricing data is available
 * @returns {{ confidenceScore: number, confidenceLabel: string, confidenceReason: string }}
 */
function calculateConfidence(opts) {
  const serviceType = opts.serviceType || 'General';
  const avgPrice = Number.isFinite(opts.avgPrice) ? opts.avgPrice : 0;
  const leadCount = Number.isFinite(opts.leadCount) ? opts.leadCount : 0;
  const hasCustomerHistory = opts.hasCustomerHistory || false;
  const hasKnownPricing = opts.hasKnownPricing || false;

  let score = 60; // Base confidence
  const reasons = [];

  // Service familiarity
  const lower = serviceType.toLowerCase();
  let isKnownService = false;
  for (const key of Object.keys(CREW_SIZE_MAP)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      isKnownService = true;
      break;
    }
  }
  if (isKnownService) {
    score += 15;
    reasons.push('Familiar service type');
  } else {
    score -= 10;
    reasons.push('Unfamiliar service type');
  }

  // Pricing data
  if (avgPrice > 0) {
    score += 10;
    reasons.push('Known pricing data');
  }

  // Lead volume
  if (leadCount >= 5) {
    score += 8;
    reasons.push('Sufficient business data');
  } else if (leadCount >= 2) {
    score += 4;
    reasons.push('Limited business data');
  } else {
    score -= 5;
    reasons.push('Minimal business data');
  }

  // Customer history
  if (hasCustomerHistory) {
    score += 7;
    reasons.push('Customer has prior jobs');
  }

  // Cap at 99
  score = Math.max(10, Math.min(99, score));

  // NaN guard
  if (!Number.isFinite(score)) score = 60;

  const label = score >= 90 ? 'High' : score >= 70 ? 'Medium' : 'Low';

  return {
    confidenceScore: score,
    confidenceLabel: label,
    confidenceReason: reasons.join('; ') || 'Standard estimate',
  };
}

// ====================================================================
// Full Job Intelligence Calculation
// ====================================================================

/**
 * Run the full intelligence pipeline for a single lead/job.
 * Combines all 6 engines into a single result.
 *
 * @param {Object} lead - Lead object from leads.json
 * @param {Object} [options]
 * @param {number} [options.hourlyRate=42] - Labor rate
 * @param {number} [options.leadCount] - Total leads count for confidence
 * @returns {Object} Full intelligence result
 */
function calculateJobIntelligence(lead, options) {
  if (!lead) return null;

  const opts = options || {};
  const bp = getBPDefaults();
  const hourlyRate = Number.isFinite(opts.hourlyRate) ? opts.hourlyRate : bp.averageHourlyRate;
  const leadCount = Number.isFinite(opts.leadCount) ? opts.leadCount : 0;

  const serviceType = lead.service || 'General';
  const avgPrice = Number.isFinite(lead.avgPrice) ? lead.avgPrice : 0;
  const crewSize = getRecommendedCrewSize(serviceType);

  // 1. Production duration
  const duration = estimateProductionDuration({
    serviceType,
    crewSize,
    complexity: lead.jobDetail && lead.jobDetail.length > 30 ? 'complex' : 'standard',
    avgPrice,
  });

  // 2. Labor cost
  const labor = calculateLaborCost({
    crewSize,
    hours: duration.estimatedHours,
    hourlyRate,
    overtimeMultiplier: bp.overtimeMultiplier,
  });

  // 3. Travel (with BP cost per mile)
  const travel = calculateTravel({
    serviceType,
    address: lead.address,
    costPerMile: bp.costPerMile,
  });

  // 4. Profit (with BP financial defaults)
  const bpMaterialCost = Math.round(avgPrice * bp.materialCostPercent / 100 * 100) / 100;
  const profit = calculateEstimatedProfit({
    revenue: avgPrice,
    laborResult: labor,
    travelResult: travel,
    materialCost: bpMaterialCost,
    overheadPercent: bp.overheadPercent,
  });

  // 5. Confidence
  const confidence = calculateConfidence({
    serviceType,
    avgPrice,
    leadCount,
    hasCustomerHistory: false,
    hasKnownPricing: avgPrice > 0,
  });

  // 6. Profit per labor hour
  let profitPerHour = 0;
  if (Number.isFinite(duration.estimatedHours) && duration.estimatedHours > 0) {
    profitPerHour = Math.round((profit.estimatedProfit / duration.estimatedHours) * 100) / 100;
  }
  if (!Number.isFinite(profitPerHour)) profitPerHour = 0;

  // NaN guard — ensure all return values are finite
  const safeRevenue = Number.isFinite(avgPrice) ? avgPrice : 0;
  const safeDurationHours = Number.isFinite(duration.estimatedHours) ? duration.estimatedHours : 0;
  const safeDurationConfidence = Number.isFinite(duration.confidenceScore) ? duration.confidenceScore : 75;
  const safeLaborTotal = Number.isFinite(labor.laborCost) ? labor.laborCost : 0;
  const safeTravelMinutes = Number.isFinite(travel.travelMinutes) ? travel.travelMinutes : 18;
  const safeTravelCost = Number.isFinite(travel.travelCost) ? travel.travelCost : 0;
  const safeProfitEstimated = Number.isFinite(profit.estimatedProfit) ? profit.estimatedProfit : 0;
  const safeConfidenceScore = Number.isFinite(confidence.confidenceScore) ? confidence.confidenceScore : 60;
  const safeRoiScore = Number.isFinite(profitPerHour * 10) ? Math.round((profitPerHour * 10) * 100) / 100 : 0;

  return {
    leadId: lead.id,
    caller: lead.caller,
    service: serviceType,
    revenue: safeRevenue,
    recommendedCrewSize: crewSize,
    estimatedDuration: {
      hours: safeDurationHours,
      confidenceScore: safeDurationConfidence,
      confidenceLabel: duration.confidenceLabel || 'Low',
    },
    laborCost: {
      total: safeLaborTotal,
      breakdown: labor.breakdown,
    },
    travel: {
      minutes: safeTravelMinutes,
      cost: safeTravelCost,
    },
    profit: {
      estimated: safeProfitEstimated,
      margin: profit.profitMargin || '0.0%',
      breakdown: profit.breakdown,
    },
    confidence: {
      score: safeConfidenceScore,
      label: confidence.confidenceLabel || 'Low',
      reason: confidence.confidenceReason || 'Standard estimate',
    },
    profitPerLaborHour: profitPerHour,
    roiScore: safeRoiScore,
  };
}

/**
 * Calculate intelligence for all leads in the dataset.
 * @param {Array} leads - Array of lead objects
 * @param {Object} [options]
 * @returns {Array} Array of job intelligence results, sorted by ROI descending
 */
function calculateAllJobIntelligence(leads, options) {
  if (!leads || leads.length === 0) return [];

  const opts = options || {};
  const results = leads.map(lead => calculateJobIntelligence(lead, {
    ...opts,
    leadCount: leads.length,
  }));

  // Sort by ROI score descending
  results.sort((a, b) => b.roiScore - a.roiScore);

  return results;
}

/**
 * Get aggregate intelligence metrics across all jobs.
 * @param {Array} leads - Array of lead objects
 * @returns {Object} Aggregate metrics
 */
function calculateAggregateIntelligence(leads) {
  if (!leads || leads.length === 0) {
    return {
      totalLeads: 0,
      totalPipelineValue: 0,
      totalEstimatedLabor: 0,
      totalEstimatedProfit: 0,
      averageProfitMargin: '0.0%',
      averageConfidence: 0,
      totalTravelMinutes: 0,
      totalProductionHours: 0,
      highestValueJob: null,
      highestProfitJob: null,
      mostEfficientJob: null,
    };
  }

  const results = calculateAllJobIntelligence(leads);

  const totalPipelineValue = leads.reduce((s, l) => {
    const price = Number.isFinite(l.avgPrice) ? l.avgPrice : 0;
    return s + price;
  }, 0);
  const totalEstimatedLabor = results.reduce((s, r) => {
    const labor = Number.isFinite(r.laborCost.total) ? r.laborCost.total : 0;
    return s + labor;
  }, 0);
  const totalEstimatedProfit = results.reduce((s, r) => {
    const profit = Number.isFinite(r.profit.estimated) ? r.profit.estimated : 0;
    return s + profit;
  }, 0);
  const totalTravelMinutes = results.reduce((s, r) => {
    const mins = Number.isFinite(r.travel.minutes) ? r.travel.minutes : 0;
    return s + mins;
  }, 0);
  const totalProductionHours = results.reduce((s, r) => {
    const hours = Number.isFinite(r.estimatedDuration.hours) ? r.estimatedDuration.hours : 0;
    return s + hours;
  }, 0);
  let avgConfidence = 0;
  if (results.length > 0) {
    const sumConfidence = results.reduce((s, r) => {
      const score = Number.isFinite(r.confidence.score) ? r.confidence.score : 0;
      return s + score;
    }, 0);
    avgConfidence = Math.round(sumConfidence / results.length);
    if (!Number.isFinite(avgConfidence)) avgConfidence = 0;
  }

  let avgProfitMargin = '0.0%';
  if (Number.isFinite(totalPipelineValue) && totalPipelineValue > 0) {
    const margin = (totalEstimatedProfit / totalPipelineValue) * 100;
    if (Number.isFinite(margin)) {
      avgProfitMargin = margin.toFixed(1) + '%';
    }
  }

  // Sort for top jobs
  const byRevenue = [...results].sort((a, b) => b.revenue - a.revenue);
  const byProfit = [...results].sort((a, b) => b.profit.estimated - a.profit.estimated);
  const byEfficiency = [...results].sort((a, b) => b.profitPerLaborHour - a.profitPerLaborHour);

  return {
    totalLeads: leads.length,
    totalPipelineValue: Number.isFinite(totalPipelineValue) ? totalPipelineValue : 0,
    totalEstimatedLabor: Number.isFinite(totalEstimatedLabor) ? Math.round(totalEstimatedLabor * 100) / 100 : 0,
    totalEstimatedProfit: Number.isFinite(totalEstimatedProfit) ? Math.round(totalEstimatedProfit * 100) / 100 : 0,
    averageProfitMargin: avgProfitMargin,
    averageConfidence: avgConfidence,
    totalTravelMinutes: Number.isFinite(totalTravelMinutes) ? Math.round(totalTravelMinutes) : 0,
    totalProductionHours: Number.isFinite(totalProductionHours) ? Math.round(totalProductionHours * 10) / 10 : 0,
    highestValueJob: byRevenue[0] || null,
    highestProfitJob: byProfit[0] || null,
    mostEfficientJob: byEfficiency[0] || null,
  };
}

module.exports = {
  // Module 1
  calculateLaborCost,
  // Module 2
  getRecommendedCrewSize,
  CREW_SIZE_MAP,
  // Module 3
  calculateTravel,
  // Module 4
  estimateProductionDuration,
  // Module 5
  calculateEstimatedProfit,
  // Module 6
  calculateConfidence,
  // Full pipeline
  calculateJobIntelligence,
  calculateAllJobIntelligence,
  calculateAggregateIntelligence,
};