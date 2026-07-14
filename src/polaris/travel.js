/**
 * Polaris Travel Intelligence — Travel Estimation Architecture
 *
 * Estimates travel time, cost, and arrival windows for service appointments.
 * Designed as a field within the unified PolarisEstimate object.
 *
 * This module provides the architecture ONLY — no external API integrations.
 * Provider interfaces are defined for future Google Maps, Apple Maps, Waze, etc.
 *
 * Architecture notes:
 *   - Every function returns a structured object with: value, confidence, reasoning
 *   - Travel output is designed to feed into duration.js as travelTimeMinutes
 *   - Travel cost feeds into estimation.js as a pricing factor
 *   - Provider interfaces are standardized for drop-in future integration
 */

const store = require('./store');

// ── Supported Route Providers (architecture only) ──
const PROVIDERS = {
  GOOGLE_MAPS: 'google_maps',
  APPLE_MAPS: 'apple_maps',
  WAZE: 'waze',
  HERE: 'here',
  MAPBOX: 'mapbox',
};

// ── Distance-based travel time estimation (fallback when no provider) ──
// Approximate minutes per mile based on area type
const SPEED_ESTIMATES = {
  urban: 3.0,     // 20 mph avg
  suburban: 2.0,  // 30 mph avg
  rural: 1.2,     // 50 mph avg
  highway: 1.0,   // 60 mph avg
};

// ── Time-of-day traffic multipliers ──
const TIME_OF_DAY_MULTIPLIERS = {
  'early_morning': 0.9,   // 5-7am
  'morning_rush': 1.4,    // 7-9am
  'midday': 1.0,          // 9am-4pm
  'afternoon_rush': 1.3,  // 4-6pm
  'evening': 1.1,         // 6-9pm
  'night': 0.85,          // 9pm-5am
};

// ── Day-of-week multipliers ──
const DAY_OF_WEEK_MULTIPLIERS = {
  'monday': 1.1,
  'tuesday': 1.0,
  'wednesday': 1.0,
  'thursday': 1.05,
  'friday': 1.15,
  'saturday': 0.9,
  'sunday': 0.85,
};

// ── Buffer time defaults ──
const BUFFER_DEFAULTS = {
  short: 10,    // < 15 min estimated travel
  medium: 15,   // 15-45 min
  long: 20,     // 45-90 min
  extended: 30, // > 90 min
};

/**
 * Estimate travel time and cost for a service appointment.
 *
 * @param {object} config - Travel estimation configuration
 * @param {string} [config.origin] - Origin address or postal code
 * @param {string} config.destination - Destination address or postal code
 * @param {string} [config.areaType='suburban'] - 'urban', 'suburban', 'rural', 'highway'
 * @param {string} [config.timeOfDay='midday'] - Time period for traffic adjustment
 * @param {string} [config.dayOfWeek] - Day of week for traffic adjustment
 * @param {number} [config.distanceMiles] - Estimated distance if known
 * @param {number} [config.historicalTravelMinutes] - Average from past jobs at this location
 * @returns {object} Unified travel estimate with confidence, reasoning, arrival window
 */
function estimateTravel(config) {
  if (!config || !config.destination) {
    return { error: 'destination is required' };
  }

  const areaType = (config.areaType || 'suburban').toLowerCase();
  const timeOfDay = (config.timeOfDay || 'midday').toLowerCase();
  const dayOfWeek = config.dayOfWeek
    ? config.dayOfWeek.toLowerCase()
    : new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();

  // Step 1: Determine base travel minutes
  let baseMinutes = 0;

  if (config.historicalTravelMinutes) {
    // Use historical data as primary source
    baseMinutes = config.historicalTravelMinutes;
  } else if (config.distanceMiles) {
    // Estimate from distance and area type
    const speedMinPerMile = SPEED_ESTIMATES[areaType] || SPEED_ESTIMATES.suburban;
    baseMinutes = config.distanceMiles * speedMinPerMile;
  } else {
    // Default: assume average suburban trip of 15 miles
    baseMinutes = 15 * SPEED_ESTIMATES.suburban; // ~30 minutes
  }

  // Step 2: Apply time-of-day adjustment
  const timeMultiplier = TIME_OF_DAY_MULTIPLIERS[timeOfDay] || TIME_OF_DAY_MULTIPLIERS.midday;

  // Step 3: Apply day-of-week adjustment
  const dayMultiplier = DAY_OF_WEEK_MULTIPLIERS[dayOfWeek] || DAY_OF_WEEK_MULTIPLIERS.tuesday;

  // Step 4: Calculate estimated travel time
  const estimatedMinutes = Math.round(baseMinutes * timeMultiplier * dayMultiplier);

  // Step 5: Calculate buffer time based on estimated duration
  const bufferMinutes = _getBufferMinutes(estimatedMinutes);

  // Step 6: Arrival window
  const arrivalWindowStart = estimatedMinutes - bufferMinutes;
  const arrivalWindowEnd = estimatedMinutes + bufferMinutes;

  // Step 7: Return travel (assume same as outbound for single-stop)
  const returnMinutes = estimatedMinutes;

  // Step 8: Deadhead travel (empty return — same as return for service jobs)
  const deadheadMinutes = estimatedMinutes;

  // Step 9: Travel cost estimation ($0.65/mile at 30mph avg = ~$0.65/2min)
  // Based on IRS standard mileage rate + labor overhead
  const totalTravelMinutes = estimatedMinutes + returnMinutes;
  const estimatedCost = Math.round(totalTravelMinutes * 0.55 * 100) / 100;

  // Step 10: Confidence scoring
  const confidence = _calculateTravelConfidence(config, baseMinutes);

  // Step 11: Generate reasoning
  const reasoning = _generateTravelReasoning(
    estimatedMinutes, baseMinutes, areaType, timeOfDay, dayOfWeek,
    timeMultiplier, dayMultiplier, bufferMinutes, confidence, config
  );

  return {
    estimatedMinutes,
    estimatedCost,
    confidence,
    reasoning,
    arrivalWindow: {
      startMinutes: arrivalWindowStart,
      endMinutes: arrivalWindowEnd,
      bufferMinutes,
    },
    returnTravel: {
      estimatedMinutes: returnMinutes,
      estimatedCost: Math.round(returnMinutes * 0.55 * 100) / 100,
    },
    deadheadTravel: {
      estimatedMinutes: deadheadMinutes,
      estimatedCost: Math.round(deadheadMinutes * 0.55 * 100) / 100,
    },
    provider: 'distance_estimate',
    variables: {
      baseMinutes,
      areaType,
      distanceMiles: config.distanceMiles || 'estimated',
      timeOfDay,
      timeOfDayMultiplier: timeMultiplier,
      dayOfWeek,
      dayOfWeekMultiplier: dayMultiplier,
      bufferMinutes,
      calculation: `${baseMinutes} × ${timeMultiplier} (time) × ${dayMultiplier} (day) = ${estimatedMinutes} min`,
    },
    predictionVersion: 'v1',
  };
}

/**
 * Estimate travel for a specific service type (location-aware).
 * Integrates with the unified PolarisEstimate object.
 *
 * @param {string} serviceType - Type of service
 * @param {object} location - { city, stateOrRegion, areaType }
 * @param {object} [options] - Additional travel options
 * @returns {object} Travel estimate (same shape as estimateTravel)
 */
function getTravelForService(serviceType, location, options) {
  // Look up historical travel data for this service type and location
  let historicalMinutes = null;
  try {
    const jobs = store.getAllJobs();
    const locationJobs = jobs.filter(j =>
      j.serviceType === serviceType &&
      j.travelTimeMinutes > 0 &&
      (!location.city || j.city === location.city) &&
      (!location.stateOrRegion || j.stateOrRegion === location.stateOrRegion)
    );
    if (locationJobs.length > 0) {
      const totalTravel = locationJobs.reduce((s, j) => s + j.travelTimeMinutes, 0);
      historicalMinutes = Math.round(totalTravel / locationJobs.length);
    }
  } catch (e) { /* no data */ }

  return estimateTravel({
    ...options,
    destination: location.city || 'service location',
    areaType: location.areaType || 'suburban',
    historicalTravelMinutes: historicalMinutes,
  });
}

/**
 * Get the standard provider interface for future integration.
 * Each provider must implement: getTravelTime(origin, destination, options)
 *
 * @param {string} provider - Provider name from PROVIDERS constant
 * @returns {object} Provider interface definition
 */
function getProviderInterface(provider) {
  const providerKey = Object.keys(PROVIDERS).find(
    k => PROVIDERS[k] === provider || k === provider
  );
  if (!providerKey) {
    return { error: `Unknown provider: ${provider}. Supported: ${getSupportedProviders().join(', ')}` };
  }

  return {
    name: PROVIDERS[providerKey],
    version: '1.0',
    status: 'not_implemented',
    methods: {
      getTravelTime: {
        description: 'Get travel time between two addresses',
        params: {
          origin: 'string (address or coordinates)',
          destination: 'string (address or coordinates)',
          departureTime: 'ISO date string (optional)',
          mode: 'driving | walking | bicycling | transit',
        },
        returns: {
          durationMinutes: 'number',
          distanceMiles: 'number',
          durationInTraffic: 'number (optional)',
          polyline: 'string (optional)',
        },
      },
      getDistanceMatrix: {
        description: 'Get travel times for multiple origins/destinations',
        params: {
          origins: 'string[]',
          destinations: 'string[]',
        },
        returns: {
          rows: 'object[]',
        },
      },
    },
    implementationStatus: 'architecture_defined',
    estimatedEffortToImplement: '2-4 hours per provider with API key',
  };
}

/**
 * List all supported travel providers.
 * @returns {string[]}
 */
function getSupportedProviders() {
  return Object.values(PROVIDERS);
}

// ── Internal Helpers ──

/**
 * Determine buffer minutes based on estimated travel time.
 * @private
 */
function _getBufferMinutes(estimatedMinutes) {
  if (estimatedMinutes < 15) return BUFFER_DEFAULTS.short;
  if (estimatedMinutes <= 45) return BUFFER_DEFAULTS.medium;
  if (estimatedMinutes <= 90) return BUFFER_DEFAULTS.long;
  return BUFFER_DEFAULTS.extended;
}

/**
 * Calculate confidence score for travel estimate.
 * @private
 */
function _calculateTravelConfidence(config, baseMinutes) {
  let score = 40; // Base: moderate-low confidence for distance estimates

  // +20 if using historical data
  if (config.historicalTravelMinutes) score += 20;

  // +10 if exact distance known
  if (config.distanceMiles) score += 10;

  // +5 per known field
  if (config.areaType) score += 5;
  if (config.timeOfDay) score += 5;
  if (config.dayOfWeek) score += 5;
  if (config.origin) score += 5;

  // +10 if provider integration were available (future)
  // (reserved — not yet applicable)

  return Math.max(0, Math.min(100, score));
}

/**
 * Generate human-readable reasoning for travel estimate.
 * @private
 */
function _generateTravelReasoning(
  estimatedMinutes, baseMinutes, areaType, timeOfDay, dayOfWeek,
  timeMultiplier, dayMultiplier, bufferMinutes, confidence, config
) {
  const parts = [];

  if (config.historicalTravelMinutes) {
    parts.push(`Based on historical average of ${config.historicalTravelMinutes} minutes for this location.`);
  } else if (config.distanceMiles) {
    parts.push(`Estimated ${config.distanceMiles} miles in ${areaType} area at ${Math.round(60 / (SPEED_ESTIMATES[areaType] || 2))} mph average.`);
  } else {
    parts.push(`Estimated ${baseMinutes} minutes base travel time for ${areaType} area.`);
  }

  if (timeMultiplier !== 1.0) {
    const pct = Math.round((timeMultiplier - 1.0) * 100);
    parts.push(`${timeOfDay.replace('_', ' ')} traffic ${pct > 0 ? 'adds' : 'reduces'} ${Math.abs(pct)}%.`);
  }

  if (dayMultiplier !== 1.0) {
    const pct = Math.round((dayMultiplier - 1.0) * 100);
    parts.push(`${dayOfWeek} travel ${pct > 0 ? 'adds' : 'reduces'} ${Math.abs(pct)}%.`);
  }

  parts.push(`Arrival window: ±${bufferMinutes} minutes.`);
  parts.push(`Estimated travel cost: $${Math.round(estimatedMinutes * 2 * 0.55 * 100) / 100}.`);

  if (confidence >= 70) {
    parts.push(`Good confidence (${confidence}%) — sufficient data available.`);
  } else if (confidence >= 50) {
    parts.push(`Moderate confidence (${confidence}%) — more location data would improve accuracy.`);
  } else {
    parts.push(`Low confidence (${confidence}%) — limited data. Future provider integration will improve accuracy.`);
  }

  return parts.join(' ');
}

module.exports = {
  estimateTravel,
  getTravelForService,
  getProviderInterface,
  getSupportedProviders,
  PROVIDERS,
};