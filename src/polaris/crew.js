/**
 * Polaris Crew Intelligence — Crew & Equipment Estimation
 *
 * Does NOT simply recommend people.
 * Its purpose is to improve EVERY downstream estimate.
 *
 * Cross-intelligence model:
 *   - Consumes: duration.js, travel.js, estimation.js, store.js, learning.js
 *   - Produces: crew recommendation, equipment, labor cost, and IMPACT FACTORS
 *     that modify duration, travel, confidence, risk, and profitability
 *
 * Architectural rules (owner-ratified):
 *   1. Every intelligence layer contributes TO and consumes FROM PolarisEstimate
 *   2. UI remains presentation-only — zero estimation logic
 *   3. No duplicate business logic
 *   4. Backward compatible — existing consumers continue to work
 *   5. PolarisEngine is the orchestration layer
 */

const store = require('./store');

// ── Role Definitions ──
const ROLE_DEFINITIONS = {
  'lead_technician': {
    title: 'Lead Technician',
    skillLevel: 'senior',
    certifications: ['general'],
    baseRate: 95,        // $/hr
    minCrewSize: 1,
    maxCrewSize: 1,      // only one lead per crew
  },
  'technician': {
    title: 'Technician',
    skillLevel: 'mid',
    certifications: ['general'],
    baseRate: 75,
    minCrewSize: 0,
    maxCrewSize: 3,
  },
  'assistant': {
    title: 'Assistant',
    skillLevel: 'entry',
    certifications: [],
    baseRate: 65,
    minCrewSize: 0,
    maxCrewSize: 2,
  },
  'general_labor': {
    title: 'General Labor',
    skillLevel: 'entry',
    certifications: [],
    baseRate: 55,
    minCrewSize: 0,
    maxCrewSize: 4,
  },
};

// ── Crew Size Rules (by service type and complexity) ──
const CREW_SIZE_RULES = {
  'Tree Removal':        { baseSize: 2,   perComplexityPoint: 1,  maxSize: 5 },
  'Tree Trimming':       { baseSize: 2,   perComplexityPoint: 1,  maxSize: 4 },
  'Stump Grinding':      { baseSize: 1,   perComplexityPoint: 0,  maxSize: 2 },
  'Emergency Service':   { baseSize: 3,   perComplexityPoint: 1,  maxSize: 6 },
  'Land Clearing':       { baseSize: 3,   perComplexityPoint: 1,  maxSize: 6 },
  'Lot Clearing':        { baseSize: 2,   perComplexityPoint: 1,  maxSize: 5 },
  'Storm Cleanup':       { baseSize: 3,   perComplexityPoint: 1,  maxSize: 8 },
  'Hazardous Removal':   { baseSize: 2,   perComplexityPoint: 1,  maxSize: 4 },
  'Brush Removal':       { baseSize: 1,   perComplexityPoint: 0,  maxSize: 3 },
  'Pruning':             { baseSize: 1,   perComplexityPoint: 0,  maxSize: 2 },
  'Mulching':            { baseSize: 1,   perComplexityPoint: 0,  maxSize: 2 },
  'Fertilization':       { baseSize: 1,   perComplexityPoint: 0,  maxSize: 2 },
  'Pest Control':        { baseSize: 1,   perComplexityPoint: 0,  maxSize: 2 },
  'Lawn Care':           { baseSize: 1,   perComplexityPoint: 0,  maxSize: 2 },
  'Irrigation':          { baseSize: 2,   perComplexityPoint: 1,  maxSize: 4 },
};

// ── Experience Level Impact ──
const EXPERIENCE_LEVELS = {
  'senior': {
    label: 'Senior',
    skillMultiplier: 0.85,     // -15% duration (faster)
    qualityBonus: 0.10,        // +10% quality score
    hourlyPremium: 1.30,       // 30% above base
  },
  'mid': {
    label: 'Experienced',
    skillMultiplier: 1.0,      // baseline
    qualityBonus: 0.0,
    hourlyPremium: 1.0,
  },
  'entry': {
    label: 'Entry',
    skillMultiplier: 1.20,     // +20% duration (slower)
    qualityBonus: -0.05,       // -5% quality
    hourlyPremium: 0.85,       // 15% below base
  },
  'mixed': {
    label: 'Mixed',
    skillMultiplier: 1.05,     // +5% (slightly slower due to training)
    qualityBonus: 0.0,
    hourlyPremium: 1.0,
  },
};

// ── Equipment Requirements (by service type) ──
const EQUIPMENT_REQUIREMENTS = {
  'Tree Removal': {
    tools: ['chainsaw', 'chainsaw', 'rope', 'harness', 'rigging'],
    vehicleType: 'cargo_van_with_trailer',
    vehicleMin: 1,
    vehiclePerCrew: 1,
  },
  'Tree Trimming': {
    tools: ['chainsaw', 'pruner', 'rope', 'harness'],
    vehicleType: 'cargo_van',
    vehicleMin: 1,
    vehiclePerCrew: 1,
  },
  'Stump Grinding': {
    tools: ['stump_grinder', 'shovel'],
    vehicleType: 'pickup_truck',
    vehicleMin: 1,
    vehiclePerCrew: 1,
  },
  'Emergency Service': {
    tools: ['chainsaw', 'winch', 'safety_gear'],
    vehicleType: 'cargo_van_with_trailer',
    vehicleMin: 1,
    vehiclePerCrew: 1,
  },
  'Land Clearing': {
    tools: ['chainsaw', 'chainsaw', 'skid_steer', 'dump_truck'],
    vehicleType: 'cargo_van_with_trailer',
    vehicleMin: 1,
    vehiclePerCrew: 1,
  },
  'Lot Clearing': {
    tools: ['chainsaw', 'brush_cutter', 'chipper'],
    vehicleType: 'cargo_van_with_trailer',
    vehicleMin: 1,
    vehiclePerCrew: 1,
  },
  'Storm Cleanup': {
    tools: ['chainsaw', 'chainsaw', 'chipper', 'safety_gear'],
    vehicleType: 'cargo_van_with_trailer',
    vehicleMin: 1,
    vehiclePerCrew: 2,
  },
  'Default': {
    tools: ['basic_hand_tools'],
    vehicleType: 'cargo_van',
    vehicleMin: 1,
    vehiclePerCrew: 1,
  },
};

// ── Vehicle Operating Cost ($/mile) ──
const VEHICLE_COST = {
  cargo_van: 0.55,
  cargo_van_with_trailer: 0.75,
  pickup_truck: 0.62,
  flatbed_truck: 0.85,
};

// ── Risk Factors ──
const RISK_WEIGHTS = {
  experienceGap: 3,
  certificationGap: 2,
  understaffed: 4,
  overstaffed: 1,
  inexperiencedLead: 3,
  safetyEquipmentMissing: 5,
};

/**
 * Main function: Get comprehensive crew intelligence for a service job.
 *
 * @param {object} config - Configuration for crew estimation
 * @param {string} config.serviceType - Type of service (e.g. 'Tree Removal')
 * @param {number} [config.complexity] - Job complexity score (1-5)
 * @param {number} [config.estimatedDurationHours] - From duration intelligence
 * @param {number} [config.travelMinutes] - From travel intelligence
 * @param {number} [config.propertySize] - Property size in acres/sf
 * @param {string} [config.areaType] - 'urban', 'suburban', 'rural' (consumed from travel)
 * @param {string} [config.crewExperience] - Preferred experience level
 * @param {string[]} [config.requiredCertifications] - Required certs for this job
 * @param {string} [config.jobId] - For historical lookup
 * @returns {object} Unified crew intelligence output
 */
function getCrewIntelligence(config) {
  if (!config || !config.serviceType) {
    return { error: 'serviceType is required' };
  }

  const serviceType = config.serviceType;
  const complexity = config.complexity || 3;
  const estimatedDurationHours = config.estimatedDurationHours || 0;
  const travelMinutes = config.travelMinutes || 0;
  const areaType = config.areaType || 'suburban';
  const preferredExperience = config.crewExperience || null;

  // ── Step 1: Determine recommended crew size ──
  const sizeRules = CREW_SIZE_RULES[serviceType] || CREW_SIZE_RULES['Default'];
  const recommendedSize = _calculateCrewSize(sizeRules, complexity, estimatedDurationHours);

  // ── Step 2: Determine crew composition (roles) ──
  const composition = _determineRoles(recommendedSize, preferredExperience, serviceType);

  // ── Step 3: Determine experience level ──
  const experienceLevel = _determineExperienceLevel(composition, preferredExperience);

  // ── Step 4: Determine equipment requirements ──
  const equipment = _determineEquipment(serviceType, recommendedSize, complexity);

  // ── Step 5: Vehicle count & type ──
  const vehicleCount = _calculateVehicleCount(equipment, recommendedSize);

  // ── Step 6: Labor cost calculation ──
  const laborCost = _calculateLaborCost(composition, experienceLevel, estimatedDurationHours);

  // ── Step 7: Duration impact factor ──
  const durationImpact = _calculateDurationImpact(composition, experienceLevel, recommendedSize, sizeRules);

  // ── Step 8: Travel impact factor ──
  const travelImpact = _calculateTravelImpact(vehicleCount, equipment.vehicleType, travelMinutes);

  // ── Step 9: Confidence scoring ──
  const confidence = _calculateCrewConfidence(config, composition, experienceLevel);

  // ── Step 10: Risk factors ──
  const risks = _identifyRisks(config, composition, experienceLevel, equipment);

  // ── Step 11: Historical crew performance (if available) ──
  const historicalData = _getHistoricalCrewData(serviceType, recommendedSize, experienceLevel);

  // ── Step 12: Generate reasoning chain ──
  const reasoning = _generateCrewReasoning(
    serviceType, recommendedSize, composition, experienceLevel,
    equipment, vehicleCount, laborCost, durationImpact, travelImpact,
    confidence, risks, historicalData, config
  );

  return {
    // Direct crew recommendation
    crewRecommendation: {
      size: recommendedSize,
      roles: composition.map(r => ({
        role: r.role,
        title: r.title,
        skillLevel: r.skillLevel,
        count: r.count,
        hourlyRate: r.hourlyRate,
      })),
      experienceLevel: experienceLevel.label,
      certifications: _getRequiredCertifications(serviceType),
    },

    // Equipment & logistics
    equipmentRequirements: {
      tools: equipment.tools,
      vehicleType: equipment.vehicleType,
      vehicleCount,
      operatingCostPerMile: VEHICLE_COST[equipment.vehicleType] || VEHICLE_COST.cargo_van,
    },

    // Cross-intelligence impact factors
    durationImpact: {
      multiplier: durationImpact.multiplier,
      adjustedDurationHours: parseFloat((estimatedDurationHours * durationImpact.multiplier).toFixed(1)),
      reasoning: durationImpact.reasoning,
    },

    travelImpact: {
      vehicleCount,
      vehicleType: equipment.vehicleType,
      costPerMile: VEHICLE_COST[equipment.vehicleType] || VEHICLE_COST.cargo_van,
      totalTravelCostIncrement: travelImpact.totalTravelCostIncrement,
      reasoning: travelImpact.reasoning,
    },

    // Labor costs
    laborCost: {
      blendedRate: laborCost.blendedRate,
      estimatedHours: estimatedDurationHours,
      totalLaborCost: laborCost.totalLaborCost,
      breakdown: laborCost.breakdown,
      reasoning: laborCost.reasoning,
    },

    // Quality & confidence
    confidence,
    qualityBonus: experienceLevel.qualityBonus,

    // Risk assessment
    risks: risks.map(r => ({
      type: r.type,
      severity: r.severity,
      description: r.description,
      mitigation: r.mitigation,
    })),

    // Historical comparison
    historicalData,

    // Full reasoning
    reasoning,

    // Metadata
    predictionVersion: 'v1',
    serviceType,
  };
}

/**
 * Gets crew intelligence scoped to a specific service, looking up defaults.
 * Minimal config required — fills from rules and historical patterns.
 *
 * @param {string} serviceType - 'Tree Removal', etc.
 * @param {object} [options] - Optional overrides
 * @returns {object} Crew intelligence (same shape as getCrewIntelligence)
 */
function getCrewForService(serviceType, options) {
  return getCrewIntelligence({
    serviceType,
    ...options,
  });
}

/**
 * Gets equipment requirements for a given service type and crew size.
 *
 * @param {string} serviceType
 * @param {number} crewSize
 * @returns {object} Equipment requirements
 */
function getCrewEquipment(serviceType, crewSize) {
  const eq = EQUIPMENT_REQUIREMENTS[serviceType] || EQUIPMENT_REQUIREMENTS.Default;
  const vehicleCount = _calculateVehicleCount(eq, crewSize || 2);
  return {
    tools: eq.tools,
    vehicleType: eq.vehicleType,
    vehicleCount,
    operatingCostPerMile: VEHICLE_COST[eq.vehicleType] || VEHICLE_COST.cargo_van,
  };
}

// ── Internal: Crew Size Calculation ──

function _calculateCrewSize(rules, complexity, estimatedDurationHours) {
  if (estimatedDurationHours > 0) {
    // Duration-based: longer jobs need more people
    const durationBased = Math.max(1, Math.round(estimatedDurationHours / 2.5));
    const ruleBased = rules.baseSize + (complexity - 1) * rules.perComplexityPoint;
    return Math.min(rules.maxSize, Math.max(1, Math.max(ruleBased, durationBased)));
  }
  // Fallback: complexity-based only
  return Math.min(rules.maxSize, Math.max(1, rules.baseSize + (complexity - 1) * rules.perComplexityPoint));
}

// ── Internal: Role Determination ──

function _determineRoles(crewSize, preferredExperience, serviceType) {
  const roles = [];
  const isHighRisk = ['Emergency Service', 'Hazardous Removal', 'Storm Cleanup'].includes(serviceType);

  // Always need 1 lead technician
  roles.push({
    role: 'lead_technician',
    title: ROLE_DEFINITIONS.lead_technician.title,
    skillLevel: preferredExperience === 'entry' ? 'mid' : 'senior',
    count: 1,
    hourlyRate: preferredExperience === 'senior'
      ? Math.round(ROLE_DEFINITIONS.lead_technician.baseRate * EXPERIENCE_LEVELS.senior.hourlyPremium)
      : ROLE_DEFINITIONS.lead_technician.baseRate,
  });

  let remaining = crewSize - 1;

  // Technicians (fill up to 3)
  if (remaining > 0) {
    const techCount = Math.min(remaining, 3);
    const techRate = preferredExperience === 'senior'
      ? Math.round(ROLE_DEFINITIONS.technician.baseRate * EXPERIENCE_LEVELS.senior.hourlyPremium)
      : ROLE_DEFINITIONS.technician.baseRate;
    roles.push({
      role: 'technician',
      title: ROLE_DEFINITIONS.technician.title,
      skillLevel: preferredExperience === 'entry' ? 'entry' : 'mid',
      count: techCount,
      hourlyRate: techRate,
    });
    remaining -= techCount;
  }

  // Assistants (fill up to 2 more)
  if (remaining > 0) {
    const asstCount = Math.min(remaining, 2);
    roles.push({
      role: 'assistant',
      title: ROLE_DEFINITIONS.assistant.title,
      skillLevel: 'entry',
      count: asstCount,
      hourlyRate: ROLE_DEFINITIONS.assistant.baseRate,
    });
    remaining -= asstCount;
  }

  // General labor (any remaining slots)
  if (remaining > 0) {
    roles.push({
      role: 'general_labor',
      title: ROLE_DEFINITIONS.general_labor.title,
      skillLevel: 'entry',
      count: remaining,
      hourlyRate: ROLE_DEFINITIONS.general_labor.baseRate,
    });
  }

  // For high-risk, ensure at least mid-level lead
  if (isHighRisk && roles[0].skillLevel !== 'senior') {
    roles[0].skillLevel = 'senior';
    roles[0].hourlyRate = Math.round(ROLE_DEFINITIONS.lead_technician.baseRate * EXPERIENCE_LEVELS.senior.hourlyPremium);
  }

  return roles;
}

// ── Internal: Experience Level ──

function _determineExperienceLevel(composition, preferredExperience) {
  if (preferredExperience && EXPERIENCE_LEVELS[preferredExperience]) {
    return EXPERIENCE_LEVELS[preferredExperience];
  }

  // Derive from composition
  const roles = composition.map(r => r.skillLevel);
  const hasSenior = roles.some(l => l === 'senior');
  const allEntry = roles.every(l => l === 'entry');
  const allSenior = roles.every(l => l === 'senior');

  if (allSenior) return EXPERIENCE_LEVELS.senior;
  if (hasSenior && roles.some(l => l === 'entry')) return EXPERIENCE_LEVELS.mixed;
  if (allEntry) return EXPERIENCE_LEVELS.entry;
  return EXPERIENCE_LEVELS.mid;
}

// ── Internal: Equipment ──

function _determineEquipment(serviceType, crewSize, complexity) {
  const eq = EQUIPMENT_REQUIREMENTS[serviceType] || EQUIPMENT_REQUIREMENTS.Default;

  // Scale tools with crew size
  const tools = [];
  eq.tools.forEach(tool => {
    const count = tools.filter(t => t === tool).length + 1;
    tools.push(tool);
    // Additional tools for larger crews
    if (crewSize > 3 && tool === 'chainsaw') tools.push('chainsaw');
  });

  return {
    tools: [...new Set(tools)], // deduplicate
    vehicleType: eq.vehicleType,
    vehicleMin: eq.vehicleMin,
    vehiclePerCrew: eq.vehiclePerCrew,
  };
}

// ── Internal: Vehicle Count ──

function _calculateVehicleCount(equipment, crewSize) {
  const perCrewVehicles = Math.ceil(crewSize / 4);
  return Math.max(equipment.vehicleMin || 1, perCrewVehicles);
}

// ── Internal: Labor Cost ──

function _calculateLaborCost(composition, experienceLevel, estimatedHours) {
  if (!estimatedHours || estimatedHours <= 0) {
    return {
      blendedRate: 0,
      totalLaborCost: 0,
      breakdown: [],
      reasoning: 'No estimated duration provided — labor cost cannot be calculated.',
    };
  }

  const breakdown = [];
  let totalRate = 0;
  let totalPeople = 0;

  composition.forEach(role => {
    const people = role.count;
    const rate = role.hourlyRate;
    totalRate += rate * people;
    totalPeople += people;
    breakdown.push({
      role: role.title,
      people,
      hourlyRate: rate,
      totalHourly: rate * people,
    });
  });

  const blendedRate = totalPeople > 0 ? Math.round(totalRate / totalPeople) : 0;
  const totalLaborCost = Math.round(totalRate * estimatedHours * 100) / 100;

  const reasoning = `${totalPeople} crew at $${blendedRate}/hr blended for ${estimatedHours}h = $${totalLaborCost.toFixed(2)}`;

  return { blendedRate, totalLaborCost, breakdown, reasoning };
}

// ── Internal: Duration Impact ──

function _calculateDurationImpact(composition, experienceLevel, crewSize, sizeRules) {
  // Crew size impact: larger crews complete faster, but with diminishing returns
  const sizeEfficiency = Math.max(0.7, 1.0 - ((crewSize - 1) * 0.08));

  // Experience impact: senior crews are faster
  const experienceMultiplier = experienceLevel.skillMultiplier;

  // Combined multiplier
  const multiplier = parseFloat((sizeEfficiency * experienceMultiplier).toFixed(3));

  const parts = [];
  if (crewSize > 1) {
    const pct = Math.round((1 - sizeEfficiency) * 100);
    parts.push(`Crew of ${crewSize} reduces duration by ${pct}% (vs solo)`);
  }
  if (experienceMultiplier !== 1.0) {
    const pct = Math.round(Math.abs(1 - experienceMultiplier) * 100);
    parts.push(`${experienceLevel.label} crew ${experienceMultiplier < 1.0 ? 'reduces' : 'increases'} duration by ${pct}%`);
  }
  if (parts.length === 0) {
    parts.push('Standard crew — no duration adjustment');
  }

  return {
    multiplier,
    reasoning: parts.join('; '),
  };
}

// ── Internal: Travel Impact ──

function _calculateTravelImpact(vehicleCount, vehicleType, travelMinutes) {
  const costPerMile = VEHICLE_COST[vehicleType] || VEHICLE_COST.cargo_van;

  // Multiple vehicles scale travel cost proportionally
  const costMultiplier = vehicleCount;

  // Estimated travel distance from minutes (30 mph average)
  const estimatedMiles = Math.round(travelMinutes / 2);
  const totalTravelCostIncrement = costMultiplier > 1
    ? Math.round(estimatedMiles * costPerMile * costMultiplier * 2 * 100) / 100  // round trip
    : 0;

  const reasoning = costMultiplier > 1
    ? `${vehicleCount} vehicles needed — travel cost is ${costMultiplier}x standard`
    : 'Single vehicle — standard travel cost applies';

  return { totalTravelCostIncrement, reasoning };
}

// ── Internal: Confidence Scoring ──

function _calculateCrewConfidence(config, composition, experienceLevel) {
  let score = 50; // Base: moderate confidence

  // +20 if service type has defined rules
  if (CREW_SIZE_RULES[config.serviceType]) score += 20;

  // +10 if estimated duration is known (validated against crew size)
  if (config.estimatedDurationHours > 0) score += 10;

  // +10 if crew experience is from historical data
  if (config.crewExperience) score += 10;

  // +5 per known additional field
  if (config.complexity) score += 5;
  if (config.areaType) score += 5;
  if (config.propertySize) score += 5;

  // +5 if lead is senior
  if (composition[0] && composition[0].skillLevel === 'senior') score += 5;

  return Math.max(0, Math.min(100, score));
}

// ── Internal: Risk Identification ──

function _identifyRisks(config, composition, experienceLevel, equipment) {
  const risks = [];
  const serviceType = config.serviceType;
  const isHighRisk = ['Emergency Service', 'Hazardous Removal', 'Storm Cleanup'].includes(serviceType);

  // Understaffed risk
  const totalCrew = composition.reduce((s, r) => s + r.count, 0);
  const sizeRules = CREW_SIZE_RULES[serviceType] || CREW_SIZE_RULES['Default'];
  if (totalCrew < sizeRules.baseSize) {
    risks.push({
      type: 'understaffed',
      severity: 'high',
      description: `Recommended crew of ${totalCrew} is below the base requirement of ${sizeRules.baseSize} for ${serviceType}`,
      mitigation: `Increase crew to at least ${sizeRules.baseSize} technicians`,
    });
  }

  // Experience gap risk
  if (experienceLevel.skillMultiplier > 1.15) {
    risks.push({
      type: 'experienceGap',
      severity: 'medium',
      description: `${experienceLevel.label} crew expected to take ${Math.round((experienceLevel.skillMultiplier - 1) * 100)}% longer`,
      mitigation: 'Consider adding a senior technician to reduce job duration',
    });
  }

  // Inexperienced lead risk
  if (composition[0] && composition[0].skillLevel !== 'senior' && isHighRisk) {
    risks.push({
      type: 'inexperiencedLead',
      severity: 'high',
      description: 'High-risk service requires a senior lead technician',
      mitigation: 'Promote lead to senior or reassign to an experienced lead',
    });
  }

  // Safety equipment risk
  if (isHighRisk && !equipment.tools.includes('safety_gear')) {
    risks.push({
      type: 'safetyEquipmentMissing',
      severity: 'critical',
      description: 'High-risk job missing safety gear in equipment list',
      mitigation: 'Add safety gear and PPE to equipment requirements',
    });
  }

  // Certification gap risk
  const requiredCerts = _getRequiredCertifications(serviceType);
  if (requiredCerts.length > 0 && !config.requiredCertifications) {
    risks.push({
      type: 'certificationGap',
      severity: 'medium',
      description: `${serviceType} may require certifications: ${requiredCerts.join(', ')}`,
      mitigation: 'Verify crew certifications before dispatching',
    });
  }

  return risks;
}

// ── Internal: Required Certifications ──

function _getRequiredCertifications(serviceType) {
  const certMap = {
    'Hazardous Removal': ['OSHA', 'HazMat'],
    'Emergency Service': ['OSHA', 'First Aid'],
    'Storm Cleanup': ['OSHA', 'Chainsaw Safety'],
    'Tree Removal': ['Chainsaw Safety'],
    'Tree Trimming': ['Chainsaw Safety'],
    'Pest Control': ['Pesticide License'],
    'Fertilization': ['Pesticide License'],
    'Irrigation': ['Backflow Certification'],
  };
  return certMap[serviceType] || [];
}

// ── Internal: Historical Data Lookup ──

function _getHistoricalCrewData(serviceType, recommendedSize, experienceLevel) {
  try {
    const jobs = store.getAllJobs();
    const relevantJobs = jobs.filter(j =>
      j.serviceType === serviceType &&
      j.crewSize > 0
    );

    if (relevantJobs.length === 0) {
      return {
        available: false,
        message: 'No historical crew data available for this service type',
      };
    }

    const avgCrewSize = Math.round(relevantJobs.reduce((s, j) => s + j.crewSize, 0) / relevantJobs.length);
    const totalJobs = relevantJobs.length;

    const jobsWithOurSize = relevantJobs.filter(j => j.crewSize === recommendedSize);
    const avgDurationForSize = jobsWithOurSize.length > 0
      ? Math.round(relevantJobs.filter(j => j.crewSize === recommendedSize).reduce((s, j) => s + (j.actualDurationHours || j.estimatedDuration || 0), 0) / jobsWithOurSize.length * 10) / 10
      : null;

    return {
      available: true,
      totalJobs,
      averageHistoricalCrewSize: avgCrewSize,
      jobsWithRecommendedSize: jobsWithOurSize.length,
      averageDurationWithRecommendedSize: avgDurationForSize,
    };
  } catch (e) {
    return { available: false, message: 'Store unavailable for historical lookup' };
  }
}

// ── Internal: Reasoning Generator ──

function _generateCrewReasoning(
  serviceType, crewSize, composition, experienceLevel,
  equipment, vehicleCount, laborCost, durationImpact, travelImpact,
  confidence, risks, historicalData, config
) {
  const parts = [];

  const totalCrew = composition.reduce((s, r) => s + r.count, 0);
  parts.push(`Recommending ${totalCrew}-person ${experienceLevel.label.toLowerCase()} crew for ${serviceType}.`);

  const roleDescriptions = composition
    .filter(r => r.count > 0)
    .map(r => `${r.count}x ${r.title}`);
  parts.push(`Composition: ${roleDescriptions.join(', ')}.`);

  // Duration impact
  if (durationImpact.multiplier !== 1.0) {
    const pct = Math.round(Math.abs(1 - durationImpact.multiplier) * 100);
    parts.push(`Duration adjusted by ${durationImpact.multiplier < 1.0 ? '-' : '+'}${pct}% (${durationImpact.reasoning}).`);
  }

  // Labor cost
  if (laborCost.totalLaborCost > 0) {
    parts.push(`Labor estimated at $${laborCost.blendedRate}/hr blended ($${laborCost.totalLaborCost.toFixed(2)} total).`);
  }

  // Equipment
  parts.push(`Requires ${vehicleCount} vehicle(s) (${equipment.vehicleType}) with ${equipment.tools.length} tool types.`);

  // Travel impact
  if (travelImpact.totalTravelCostIncrement > 0) {
    parts.push(`Additional travel cost from multiple vehicles: $${travelImpact.totalTravelCostIncrement.toFixed(2)}.`);
  }

  // Risks
  if (risks.length > 0) {
    const criticalRisks = risks.filter(r => r.severity === 'critical').length;
    const highRisks = risks.filter(r => r.severity === 'high').length;
    if (criticalRisks > 0) parts.push(`${criticalRisks} critical and ${highRisks} high-risk factors identified.`);
    else if (highRisks > 0) parts.push(`${highRisks} high-risk factors identified.`);
    else parts.push(`${risks.length} medium/low risk factors identified.`);
  }

  // Historical
  if (historicalData.available) {
    parts.push(`Historical comparison: ${historicalData.totalJobs} past jobs; ${historicalData.jobsWithRecommendedSize} with similar crew size.`);
    if (historicalData.averageDurationWithRecommendedSize) {
      parts.push(`Average duration with this crew size: ${historicalData.averageDurationWithRecommendedSize}h.`);
    }
  }

  parts.push(`Crew confidence: ${confidence}%.`);

  return parts.join(' ');
}

module.exports = {
  getCrewIntelligence,
  getCrewForService,
  getCrewEquipment,
  ROLE_DEFINITIONS,
  EXPERIENCE_LEVELS,
  CREW_SIZE_RULES,
};