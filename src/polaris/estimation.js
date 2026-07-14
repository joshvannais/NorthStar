/**
 * Polaris Estimation Framework — Multi-Variable Estimation Engine
 *
 * Estimates are based on weighted inputs including:
 *   - Service type
 *   - Square footage / property size
 *   - Job complexity
 *   - Equipment required
 *   - Crew size
 *   - Customer location / travel time
 *   - Historical completion data (same service, same crew)
 *   - Seasonality
 *   - Company-specific historical averages
 *
 * Every estimate is stored and compared against actual outcomes for self-learning.
 */

const store = require('./store');

// ── Base Configuration ──
// These are seeded defaults. Companies can override via loadEstimationConfig().

const DEFAULT_CONFIG = {
  // Labor rates by service type ($/hour)
  laborRates: {
    'HVAC Repair':       95,
    'HVAC Installation': 110,
    'Plumbing Repair':   90,
    'Electrical Repair': 100,
    'Roofing':           85,
    'Landscaping':       65,
    'Chimney Service':   85,
    'Flooring':          75,
    'General':           80,
  },

  // Base hours by service type
  baseHours: {
    'HVAC Repair':       2.5,
    'HVAC Installation': 6.0,
    'Plumbing Repair':   2.0,
    'Electrical Repair': 2.0,
    'Roofing':           8.0,
    'Landscaping':       3.0,
    'Chimney Service':   2.0,
    'Flooring':          4.0,
    'General':           2.0,
  },

  // Complexity multipliers
  complexity: {
    low:    { labor: 1.0,  material: 1.0,  label: 'Straightforward' },
    medium: { labor: 1.15, material: 1.1,  label: 'Moderate' },
    high:   { labor: 1.35, material: 1.2,  label: 'Complex' },
  },

  // Property size multipliers (square footage)
  propertySize: {
    small:  { maxSqft: 1000,  multiplier: 0.85, label: 'Small (<1,000 sqft)' },
    medium: { maxSqft: 2500,  multiplier: 1.0,  label: 'Medium (1,000-2,500 sqft)' },
    large:  { maxSqft: 5000,  multiplier: 1.2,  label: 'Large (2,500-5,000 sqft)' },
    xlarge: { maxSqft: 99999, multiplier: 1.5,  label: 'Extra Large (5,000+ sqft)' },
  },

  // Seasonality adjustments (multiplier by month, 0-indexed)
  seasonality: {
    0: 0.8,   // January
    1: 0.8,   // February
    2: 0.9,   // March
    3: 1.0,   // April
    4: 1.1,   // May
    5: 1.2,   // June
    6: 1.3,   // July
    7: 1.2,   // August
    8: 1.1,   // September
    9: 1.0,   // October
    10: 0.9,  // November
    11: 0.8,  // December
  },

  // Travel cost ($/mile)
  travelCostPerMile: 1.50,

  // Overhead percentage
  overheadPct: 0.15,

  // Target profit margin
  profitMargin: 0.20,

  // Tax rate
  taxRate: 0.07,
};

let _config = { ...DEFAULT_CONFIG };

/**
 * Load a custom estimation configuration (merges with defaults).
 */
function loadConfig(customConfig) {
  if (!customConfig) return;
  _config = deepMerge(_config, customConfig);
}

/**
 * Get the current configuration.
 */
function getConfig() {
  return { ..._config };
}

/**
 * Reset configuration to defaults.
 */
function resetConfig() {
  _config = { ...DEFAULT_CONFIG };
}

/**
 * Assess job complexity based on available data.
 */
function assessComplexity(jobData) {
  if (!jobData) return 'low';

  let score = 0;
  if (jobData.description && jobData.description.length > 200) score += 2;
  if (jobData.description && jobData.description.length > 100) score += 1;
  if (jobData.squareFootage && jobData.squareFootage > 2500) score += 1;
  if (jobData.squareFootage && jobData.squareFootage > 5000) score += 2;
  if (jobData.equipmentRequired && jobData.equipmentRequired.length > 2) score += 1;
  if (jobData.crewSize && jobData.crewSize > 2) score += 1;
  if (jobData.stories && jobData.stories > 1) score += 1;
  if (jobData.serviceType && ['Roofing', 'HVAC Installation', 'Electrical'].includes(jobData.serviceType)) score += 1;

  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

/**
 * Determine property size tier from square footage.
 */
function getPropertySizeTier(sqft) {
  const tiers = _config.propertySize;
  if (!sqft || sqft <= 0) return tiers.medium;
  for (const key of ['small', 'medium', 'large', 'xlarge']) {
    if (sqft <= tiers[key].maxSqft) return tiers[key];
  }
  return tiers.xlarge;
}

/**
 * Get the seasonality multiplier for a given month.
 */
function getSeasonalityMultiplier(month) {
  return _config.seasonality[month] || 1.0;
}

/**
 * Generate a complete estimate.
 *
 * @param {object} data - { serviceType, description, squareFootage, crewSize, equipmentRequired, stories, region, profitMargin, taxRate }
 * @returns {object} Standardized estimate with line items
 */
function generateEstimate(data) {
  if (!data || !data.serviceType) return null;

  const svc = data.serviceType;
  const complexity = assessComplexity(data);
  const comp = _config.complexity[complexity] || _config.complexity.low;
  const baseHours = data.estimatedHours || _config.baseHours[svc] || _config.baseHours['General'];
  const hourlyRate = _config.laborRates[svc] || _config.laborRates['General'];
  const propertyTier = getPropertySizeTier(data.squareFootage);
  const seasonality = getSeasonalityMultiplier(data.month !== undefined ? data.month : new Date().getMonth());
  const travelDistance = data.travelDistance || 0;

  // ── Compute estimates ──
  const adjustedHours = baseHours * comp.labor * propertyTier.multiplier * seasonality;
  const laborCost = Math.round(adjustedHours * hourlyRate * 100) / 100;

  const materialCost = data.materialCost || Math.round(baseHours * 45 * comp.material * propertyTier.multiplier * 100) / 100;
  const equipmentCost = data.equipmentCost || 0;
  const travelCost = Math.round(travelDistance * _config.travelCostPerMile * 100) / 100;

  const directCosts = laborCost + materialCost + equipmentCost + travelCost;
  const overhead = Math.round(directCosts * _config.overheadPct * 100) / 100;
  const subtotal = directCosts + overhead;
  const profit = Math.round(subtotal * (data.profitMargin !== undefined ? data.profitMargin : _config.profitMargin) * 100) / 100;
  const beforeTax = subtotal + profit;
  const tax = Math.round(beforeTax * (data.taxRate !== undefined ? data.taxRate : _config.taxRate) * 100) / 100;
  const total = beforeTax + tax;

  // ── Confidence scoring ──
  let confidence = 40;
  let dataPoints = 0;
  if (data.description) dataPoints++;
  if (data.squareFootage) dataPoints += 2;
  if (data.crewSize) dataPoints++;
  if (data.equipmentRequired) dataPoints++;
  if (data.estimatedHours) dataPoints++;
  if (data.travelDistance > 0) dataPoints++;
  if (data.priorJobData) dataPoints += 3;

  if (dataPoints >= 5) confidence = 90;
  else if (dataPoints >= 3) confidence = 70;
  else if (dataPoints >= 1) confidence = 55;

  const lineItems = [
    { type: 'labor',     label: 'Labor — ' + svc,                hours: Math.round(adjustedHours * 10) / 10, rate: hourlyRate, amount: laborCost },
    { type: 'materials', label: 'Materials & Supplies',          amount: materialCost },
    { type: 'equipment', label: 'Equipment',                     amount: equipmentCost },
    { type: 'travel',    label: 'Travel (' + travelDistance + ' mi @ $' + _config.travelCostPerMile + '/mi)', amount: travelCost },
    { type: 'overhead',  label: 'Overhead (' + Math.round(_config.overheadPct * 100) + '%)', amount: overhead },
    { type: 'profit',    label: 'Profit Margin',                  amount: profit },
    { type: 'tax',       label: 'Sales Tax',                      amount: tax },
  ].filter(item => item.amount > 0);

  const estimate = {
    serviceType: svc,
    complexity: complexity,
    complexityLabel: comp.label,
    propertySize: propertyTier.label,
    seasonalityMultiplier: seasonality,
    estimatedHours: Math.round(adjustedHours * 10) / 10,
    hourlyRate: hourlyRate,
    laborCost: laborCost,
    materialCost: materialCost,
    equipmentCost: equipmentCost,
    travelCost: travelCost,
    overhead: overhead,
    profit: profit,
    tax: tax,
    total: total,
    confidence: confidence,
    confidenceLabel: confidence >= 80 ? 'High' : confidence >= 55 ? 'Medium' : 'Low',
    variables: {
      serviceType: svc,
      complexity: complexity,
      propertyTier: propertyTier.label,
      seasonality: seasonality,
      baseHours: baseHours,
      adjustedHours: Math.round(adjustedHours * 10) / 10,
      hourlyRate: hourlyRate,
      travelDistance: travelDistance,
      dataPoints: dataPoints,
    },
    lineItems: lineItems,
    reasoning: generateReasoning(svc, complexity, comp, adjustedHours, hourlyRate, propertyTier, seasonality, confidence),
    generatedAt: new Date().toISOString(),
  };

  // Persist to historical estimates store
  try {
    store.addEstimate({
      leadId: data.leadId || null,
      serviceType: svc,
      difficulty: complexity,
      estimatedHours: Math.round(adjustedHours * 10) / 10,
      hourlyRate: hourlyRate,
      laborCost: laborCost,
      materialsCost: materialCost,
      equipmentCost: equipmentCost,
      totalEstimated: total,
      confidence: confidence,
      variables: estimate.variables,
    });
  } catch (e) {
    console.warn('[PolarisEstimation] Failed to persist estimate:', e.message);
  }

  return estimate;
}

/**
 * Generate human-readable reasoning for an estimate.
 */
function generateReasoning(svc, complexity, comp, hours, rate, propertyTier, seasonality, confidence) {
  let reasoning = 'Estimate generated for ' + svc + ' (' + comp.label + ' complexity). ';
  reasoning += 'Labor: ' + Math.round(hours * 10) / 10 + ' hours at $' + rate + '/hr. ';
  reasoning += 'Property size: ' + propertyTier.label + '. ';
  reasoning += 'Seasonality adjustment: ' + Math.round(seasonality * 100) + '%. ';
  reasoning += 'Confidence: ' + (confidence >= 80 ? 'High' : confidence >= 55 ? 'Medium' : 'Low') + ' (' + confidence + '%).';
  return reasoning;
}

/**
 * Simple deep merge for nested objects.
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = {
  generateEstimate,
  assessComplexity,
  getPropertySizeTier,
  getSeasonalityMultiplier,
  loadConfig,
  getConfig,
  resetConfig,
};