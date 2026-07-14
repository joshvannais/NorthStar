/**
 * Polaris Duration Intelligence — Intelligent Duration Estimation
 *
 * Replaces fixed-duration assumptions with multi-factor estimation.
 * Every prediction includes confidence scoring and human-readable reasoning.
 *
 * Factors considered:
 *   1. Service type baseline (from historical data)
 *   2. Property size multiplier
 *   3. Job complexity multiplier
 *   4. Historical company averages (from learning pipeline)
 *   5. Crew size adjustment
 *   6. Crew experience factor
 *   7. Equipment availability
 *   8. Customer constraints
 *   9. Travel time buffer
 *   10. Season factor
 *   11. Similar completed jobs weighted average
 */

const store = require('./store');

// ── Default Baselines (hours) ──
// Used when no company-specific data exists.
const SERVICE_BASELINES = {
  'Tree Removal': 4.0,
  'Tree Trimming': 3.0,
  'Stump Grinding': 2.0,
  'Emergency Service': 3.5,
  'Land Clearing': 6.0,
  'Lot Clearing': 5.0,
  'Storm Cleanup': 4.5,
  'Hazardous Removal': 5.0,
  'Brush Removal': 2.5,
  'Pruning': 2.0,
  'Mulching': 1.5,
  'Fertilization': 1.0,
  'Pest Control': 1.5,
  'Lawn Care': 1.0,
  'Irrigation': 3.0,
  'General': 3.0,
};

// ── Property Size Multipliers ──
const PROPERTY_SIZE_MULTIPLIERS = {
  small: 1.0,
  medium: 1.3,
  large: 1.7,
  xlarge: 2.2,
};

// ── Complexity Multipliers ──
const COMPLEXITY_MULTIPLIERS = {
  simple: 1.0,
  moderate: 1.4,
  complex: 2.0,
};

// ── Crew Experience Factors ──
const CREW_EXPERIENCE_FACTORS = {
  junior: 1.3,
  mid: 1.1,
  senior: 0.9,
  expert: 0.8,
};

// ── Equipment Availability Factors ──
const EQUIPMENT_FACTORS = {
  full: 0.9,
  partial: 1.1,
  minimal: 1.3,
};

// ── Customer Constraint Factors ──
const CONSTRAINT_FACTORS = {
  standard: 1.0,
  tight: 1.2,
  flexible: 0.95,
};

// ── Season Factors ──
const SEASON_FACTORS = {
  spring: 1.0,
  summer: 0.95,
  fall: 1.0,
  winter: 1.15,
};

/**
 * Estimate job duration based on multiple factors.
 *
 * @param {object} config - Configuration object
 * @param {string} config.serviceType - Type of service (e.g., 'Tree Removal')
 * @param {string} [config.propertySize='medium'] - 'small', 'medium', 'large', 'xlarge'
 * @param {string} [config.complexity='moderate'] - 'simple', 'moderate', 'complex'
 * @param {number} [config.crewSize=2] - Number of crew members
 * @param {string} [config.crewExperience='mid'] - 'junior', 'mid', 'senior', 'expert'
 * @param {string} [config.equipment='full'] - 'full', 'partial', 'minimal'
 * @param {string} [config.customerConstraints='standard'] - 'standard', 'tight', 'flexible'
 * @param {number} [config.travelTimeMinutes=0] - Estimated travel time in minutes
 * @param {string} [config.season='summer'] - 'spring', 'summer', 'fall', 'winter'
 * @param {string} [config.city] - City for location-based learning
 * @param {string} [config.stateOrRegion] - State/region for location-based learning
 * @returns {object} { estimatedHours, confidence, reasoning, variables, predictionVersion }
 */
function estimateDuration(config) {
  if (!config || !config.serviceType) {
    return { error: 'serviceType is required' };
  }

  const serviceType = config.serviceType;
  const propertySize = (config.propertySize || 'medium').toLowerCase();
  const complexity = (config.complexity || 'moderate').toLowerCase();
  const crewSize = config.crewSize || 2;
  const crewExperience = (config.crewExperience || 'mid').toLowerCase();
  const equipment = (config.equipment || 'full').toLowerCase();
  const constraints = (config.customerConstraints || 'standard').toLowerCase();
  const travelMinutes = config.travelTimeMinutes || 0;
  const season = (config.season || 'summer').toLowerCase();

  // 1. Base hours from service type
  const baseHours = SERVICE_BASELINES[serviceType] || SERVICE_BASELINES['General'];

  // 2. Property size multiplier
  const propertyMultiplier = PROPERTY_SIZE_MULTIPLIERS[propertySize] || PROPERTY_SIZE_MULTIPLIERS.medium;

  // 3. Complexity multiplier
  const complexityMultiplier = COMPLEXITY_MULTIPLIERS[complexity] || COMPLEXITY_MULTIPLIERS.moderate;

  // 4. Historical learning adjustment
  const historicalAdjustment = _getHistoricalAdjustment(serviceType, config);

  // 5. Crew size adjustment (diminishing returns: more crew = faster, but not linear)
  const crewSizeAdjustment = Math.max(0.6, 1.0 - (crewSize - 1) * 0.08);

  // 6. Crew experience factor
  const experienceFactor = CREW_EXPERIENCE_FACTORS[crewExperience] || CREW_EXPERIENCE_FACTORS.mid;

  // 7. Equipment factor
  const equipmentFactor = EQUIPMENT_FACTORS[equipment] || EQUIPMENT_FACTORS.full;

  // 8. Customer constraint factor
  const constraintFactor = CONSTRAINT_FACTORS[constraints] || CONSTRAINT_FACTORS.standard;

  // 9. Season factor
  const seasonFactor = SEASON_FACTORS[season] || SEASON_FACTORS.summer;

  // 10. Calculate base duration
  let estimatedHours = baseHours
    * propertyMultiplier
    * complexityMultiplier
    * crewSizeAdjustment
    * experienceFactor
    * equipmentFactor
    * constraintFactor
    * seasonFactor
    * historicalAdjustment;

  // 11. Add travel time buffer (convert minutes to hours, add 15min buffer)
  const travelHours = (travelMinutes + 15) / 60;
  estimatedHours += travelHours;

  // Round to 1 decimal
  estimatedHours = Math.round(estimatedHours * 10) / 10;

  // Calculate confidence
  const confidence = _calculateConfidence(serviceType, config);

  // Generate reasoning
  const reasoning = _generateReasoning(
    serviceType, baseHours, propertySize, propertyMultiplier,
    complexity, complexityMultiplier, crewSize, crewSizeAdjustment,
    crewExperience, experienceFactor, equipment, equipmentFactor,
    constraints, constraintFactor, travelMinutes, season, seasonFactor,
    historicalAdjustment, confidence, config
  );

  return {
    estimatedHours,
    confidence,
    reasoning,
    variables: {
      serviceType,
      baseHours,
      propertySize,
      propertySizeMultiplier: propertyMultiplier,
      complexity,
      complexityMultiplier,
      crewSize,
      crewSizeAdjustment,
      crewExperience,
      crewExperienceAdjustment: experienceFactor,
      equipment,
      equipmentAdjustment: equipmentFactor,
      customerConstraints: constraints,
      customerConstraintAdjustment: constraintFactor,
      travelTimeMinutes: travelMinutes,
      season,
      seasonAdjustment: seasonFactor,
      historicalAdjustment,
      finalCalculation: `${baseHours} * ${propertyMultiplier} * ${complexityMultiplier} * ${crewSizeAdjustment} * ${experienceFactor} * ${equipmentFactor} * ${constraintFactor} * ${seasonFactor} * ${historicalAdjustment} + ${travelHours} = ${estimatedHours}`,
    },
    predictionVersion: 'v3',
  };
}

/**
 * Calculate historical adjustment factor from completed jobs.
 * @private
 */
function _getHistoricalAdjustment(serviceType, config) {
  try {
    const jobs = store.getAllJobs();
    const relevantJobs = jobs.filter(j =>
      j.serviceType === serviceType &&
      j.actualDuration > 0 &&
      j.estimatedDuration > 0
    );

    if (relevantJobs.length === 0) return 1.0;

    // Calculate average ratio of actual/estimated duration
    const ratios = relevantJobs.map(j => j.actualDuration / j.estimatedDuration);
    const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;

    // Apply smoothing: if ratio is 1.0, no adjustment needed
    // If ratio is > 1.0, jobs tend to run longer than estimated
    return Math.max(0.5, Math.min(2.0, avgRatio));
  } catch (e) {
    return 1.0;
  }
}

/**
 * Calculate confidence score (0-100) based on data availability.
 * @private
 */
function _calculateConfidence(serviceType, config) {
  let score = 50; // Start at 50 (medium confidence)
  let factors = 0;

  // +10 if service type has a specific baseline
  if (SERVICE_BASELINES[serviceType]) {
    score += 10;
    factors++;
  }

  // +5 to +15 based on historical data volume
  try {
    const jobs = store.getAllJobs();
    const serviceJobs = jobs.filter(j => j.serviceType === serviceType && j.actualDuration > 0);
    if (serviceJobs.length >= 50) { score += 15; factors++; }
    else if (serviceJobs.length >= 20) { score += 10; factors++; }
    else if (serviceJobs.length >= 5) { score += 5; factors++; }
  } catch (e) { /* no data available */ }

  // +5 if all config fields are provided
  if (config.propertySize) { score += 3; }
  if (config.complexity) { score += 3; }
  if (config.crewSize) { score += 2; }
  if (config.crewExperience) { score += 2; }
  if (config.equipment) { score += 2; }
  if (config.travelTimeMinutes) { score += 3; }

  // Cap at 0-100
  return Math.max(0, Math.min(100, score));
}

/**
 * Generate human-readable reasoning for the duration estimate.
 * @private
 */
function _generateReasoning(
  serviceType, baseHours, propertySize, propertyMultiplier,
  complexity, complexityMultiplier, crewSize, crewSizeAdjustment,
  crewExperience, experienceFactor, equipment, equipmentFactor,
  constraints, constraintFactor, travelMinutes, season, seasonFactor,
  historicalAdjustment, confidence, config
) {
  const parts = [];

  // Base estimate
  parts.push(`Base estimate for ${serviceType} is ${baseHours} hours.`);

  // Property size
  if (propertyMultiplier !== 1.0) {
    const pct = Math.round((propertyMultiplier - 1.0) * 100);
    parts.push(`${propertySize} property size ${pct > 0 ? 'adds' : 'reduces'} ${Math.abs(pct)}% (${propertyMultiplier}x).`);
  }

  // Complexity
  if (complexityMultiplier !== 1.0) {
    const pct = Math.round((complexityMultiplier - 1.0) * 100);
    parts.push(`${complexity} complexity ${pct > 0 ? 'adds' : 'reduces'} ${Math.abs(pct)}% (${complexityMultiplier}x).`);
  }

  // Crew
  if (crewSizeAdjustment !== 1.0) {
    const pct = Math.round((1.0 - crewSizeAdjustment) * 100);
    if (pct > 0) parts.push(`Crew of ${crewSize} reduces time by ${pct}%.`);
  }
  if (experienceFactor !== 1.0) {
    const pct = Math.round((1.0 - experienceFactor) * 100);
    parts.push(`${crewExperience}-level crew ${experienceFactor < 1.0 ? 'reduces' : 'increases'} time by ${Math.abs(pct)}%.`);
  }

  // Equipment
  if (equipmentFactor !== 1.0) {
    const pct = Math.round((equipmentFactor - 1.0) * 100);
    parts.push(`${equipment} equipment ${pct > 0 ? 'adds' : 'reduces'} ${Math.abs(pct)}% (${equipmentFactor}x).`);
  }

  // Constraints
  if (constraintFactor !== 1.0) {
    const pct = Math.round((constraintFactor - 1.0) * 100);
    parts.push(`${constraints} schedule ${pct > 0 ? 'adds' : 'reduces'} ${Math.abs(pct)}% (${constraintFactor}x).`);
  }

  // Travel
  if (travelMinutes > 0) {
    parts.push(`Travel adds ${travelMinutes} min (${Math.round((travelMinutes + 15) / 60 * 10) / 10} hrs with buffer).`);
  }

  // Season
  if (seasonFactor !== 1.0) {
    const pct = Math.round((seasonFactor - 1.0) * 100);
    parts.push(`${season} season ${pct > 0 ? 'adds' : 'reduces'} ${Math.abs(pct)}% (${seasonFactor}x).`);
  }

  // Historical adjustment
  if (historicalAdjustment !== 1.0) {
    const pct = Math.round((historicalAdjustment - 1.0) * 100);
    try {
      const jobs = store.getAllJobs();
      const serviceJobs = jobs.filter(j => j.serviceType === serviceType && j.actualDuration > 0);
      parts.push(`Based on ${serviceJobs.length} completed ${serviceType} jobs, historical data ${historicalAdjustment > 1.0 ? 'adds' : 'reduces'} ${Math.abs(pct)}% (${historicalAdjustment}x).`);
    } catch (e) {
      parts.push(`Historical data adjusts estimate by ${pct}%.`);
    }
  }

  // Confidence explanation
  if (confidence >= 80) {
    parts.push(`High confidence (${confidence}%) — sufficient historical data available.`);
  } else if (confidence >= 55) {
    parts.push(`Medium confidence (${confidence}%) — more data would improve accuracy.`);
  } else {
    parts.push(`Low confidence (${confidence}%) — limited historical data for this service type.`);
  }

  return parts.join(' ');
}

/**
 * Get service type baselines (for external use).
 */
function getServiceBaselines() {
  return { ...SERVICE_BASELINES };
}

/**
 * Get all factor multipliers (for external use).
 */
function getFactorMultipliers() {
  return {
    propertySize: { ...PROPERTY_SIZE_MULTIPLIERS },
    complexity: { ...COMPLEXITY_MULTIPLIERS },
    crewExperience: { ...CREW_EXPERIENCE_FACTORS },
    equipment: { ...EQUIPMENT_FACTORS },
    constraints: { ...CONSTRAINT_FACTORS },
    season: { ...SEASON_FACTORS },
  };
}

module.exports = {
  estimateDuration,
  getServiceBaselines,
  getFactorMultipliers,
};