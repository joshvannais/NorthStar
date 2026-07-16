/**
 * Polaris Learning Pipeline — Self-Learning from Completed Jobs
 *
 * Every completed job is compared against its estimate.
 * Variances are stored and used to continuously improve future predictions.
 *
 * Learning dimensions:
 *   - Duration accuracy (estimated vs actual)
 *   - Revenue accuracy (estimated vs actual)
 *   - Complexity accuracy (was the complexity assessment correct?)
 *   - Service-specific learning (each service type gets its own baselines)
 *   - Crew-specific learning (each crew's efficiency is tracked)
 *   - Seasonal tracking (performance varies by season)
 *   - Property-based learning (size, type, access impact)
 */

const store = require('./store');

/**
 * Derive the season from a date string or Date object.
 * @param {string|Date} dateInput - A date string (ISO) or Date object
 * @returns {string} 'spring', 'summer', 'fall', or 'winter'
 */
function _deriveSeason(dateInput) {
  if (!dateInput) {
    // Default to current season if no date provided
    dateInput = new Date();
  }
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return 'unknown';

  const month = date.getMonth(); // 0-based
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}

/**
 * Resolve the effective date for season detection.
 * Priority: actualEnd > completedAt > actualStart > now
 */
function _resolveCompletionDate(job) {
  return job.actualEnd || job.completedAt || job.actualStart || new Date().toISOString();
}

/**
 * Resolve predicted (estimated) duration from either naming convention.
 * Accepts: predictedDuration, estimatedDuration
 */
function _resolvePredictedDuration(job) {
  return parseFloat(job.predictedDuration ?? job.estimatedDuration) || 0;
}

/**
 * Resolve predicted (estimated) revenue from either naming convention.
 * Accepts: predictedRevenue, estimatedRevenue
 */
function _resolvePredictedRevenue(job) {
  return parseFloat(job.predictedRevenue ?? job.estimatedRevenue) || 0;
}

/**
 * Resolve actual duration from either naming convention.
 * Accepts: actualDuration
 */
function _resolveActualDuration(job) {
  return parseFloat(job.actualDuration) || 0;
}

/**
 * Resolve actual revenue from either naming convention.
 * Accepts: actualRevenue
 */
function _resolveActualRevenue(job) {
  return parseFloat(job.actualRevenue) || 0;
}

/**
 * Record a completed job and compute its learning signals.
 *
 * All new fields are OPTIONAL (backward-compatible).
 * Accepts both 'predicted' and 'estimated' naming conventions for duration/revenue.
 *
 * @param {object} job - The completed job data
 * @returns {object} The learning results (variance, accuracy, metric ID, season, etc.)
 */
function recordCompletion(job) {
  if (!job || !job.serviceType) {
    return { error: 'Job must have a serviceType' };
  }

  // Resolve values with dual naming convention support
  const estDuration = _resolvePredictedDuration(job);
  const actDuration = _resolveActualDuration(job);
  const estRevenue = _resolvePredictedRevenue(job);
  const actRevenue = _resolveActualRevenue(job);

  // Compute duration variance
  const durationVariance = actDuration - estDuration;
  const durationAccuracy = estDuration > 0
    ? Math.max(0, 100 - Math.abs((durationVariance / estDuration) * 100))
    : 0;

  // Compute revenue variance
  const revenueVariance = actRevenue - estRevenue;
  const revenueAccuracy = estRevenue > 0
    ? Math.max(0, 100 - Math.abs((revenueVariance / estRevenue) * 100))
    : 0;

  // Derive season from completion date
  const completionDate = _resolveCompletionDate(job);
  const season = _deriveSeason(completionDate);

  // Build the full job record with all new fields (all optional)
  const savedJob = store.addJob({
    // Core fields (backward-compatible)
    serviceType: job.serviceType,
    estimatedDuration: estDuration,
    actualDuration: actDuration,
    durationVariance: Math.round(durationVariance * 100) / 100,
    estimatedRevenue: estRevenue,
    actualRevenue: actRevenue,
    revenueVariance: Math.round(revenueVariance * 100) / 100,
    completionStatus: job.completionStatus || 'completed',
    predictedDuration: estDuration,  // alias for consistency
    predictedRevenue: estRevenue,    // alias for consistency

    // Scheduling fields
    scheduledStart: job.scheduledStart || null,
    actualStart: job.actualStart || null,
    scheduledEnd: job.scheduledEnd || null,
    actualEnd: job.actualEnd || null,

    // Crew fields
    crewId: job.crewId || null,
    crewSize: job.crewSize != null ? parseInt(job.crewSize, 10) : null,
    crewExperience: job.crewExperience != null ? parseInt(job.crewExperience, 10) : null,
    travelTimeMinutes: job.travelTimeMinutes != null ? parseFloat(job.travelTimeMinutes) : null,

    // Equipment
    equipmentUsed: job.equipmentUsed || null,

    // Property fields
    propertySize: job.propertySize || null,
    propertyType: job.propertyType || null,
    propertyAccessNotes: job.propertyAccessNotes || null,

    // Outcome fields
    customerOutcome: job.customerOutcome || null,
    estimateConfidence: job.estimateConfidence != null ? parseFloat(job.estimateConfidence) : null,
    profitability: job.profitability != null ? parseFloat(job.profitability) : null,
    customerSatisfaction: job.customerSatisfaction != null ? parseFloat(job.customerSatisfaction) : null,
    completionNotes: job.completionNotes || null,

    // Service description
    serviceDescription: job.serviceDescription || null,

    // Location fields
    jobAddress: job.jobAddress || null,
    city: job.city || null,
    stateOrRegion: job.stateOrRegion || null,

    // Seasonal tracking (auto-derived)
    season: season,

    // Weather (future-ready, optional)
    weatherConditions: job.weatherConditions || null,
  });

  // Update learning metrics
  try {
    _updateDurationMetrics(job.serviceType, durationVariance, durationAccuracy);
    _updateRevenueMetrics(job.serviceType, revenueVariance, revenueAccuracy);

    if (job.crewId) {
      _updateCrewEfficiency(job.crewId, durationVariance, actDuration, job);
    }

    // Update seasonal tracking
    if (season !== 'unknown') {
      _updateSeasonalMetrics(job.serviceType, season, durationVariance, revenueVariance, durationAccuracy);
    }

    // Update property-based learning
    if (job.propertySize) {
      _updatePropertyMetrics(job.serviceType, job.propertySize, durationVariance, revenueVariance);
    }
  } catch (e) {
    console.warn('[PolarisLearning] Metrics update error:', e.message);
  }

  return {
    jobId: savedJob.id,
    durationVariance: Math.round(durationVariance * 100) / 100,
    durationAccuracy: Math.round(durationAccuracy * 100) / 100,
    revenueVariance: Math.round(revenueVariance * 100) / 100,
    revenueAccuracy: Math.round(revenueAccuracy * 100) / 100,
    season: season,
    crewId: job.crewId || null,
    customerOutcome: job.customerOutcome || null,
    estimateConfidence: job.estimateConfidence != null ? parseFloat(job.estimateConfidence) : null,
  };
}

/**
 * Internal: Update duration accuracy metrics.
 */
function _updateDurationMetrics(serviceType, variance, accuracy) {
  const metrics = store.getAllMetrics();
  const existing = metrics.find(m =>
    m.metricType === 'duration_accuracy' &&
    m.serviceType === serviceType
  );

  if (existing) {
    // Rolling average
    const newSampleSize = (existing.sampleSize || 1) + 1;
    const newMean = ((existing.meanVariance || 0) * (existing.sampleSize || 1) + variance) / newSampleSize;
    const newMAE = ((existing.meanAbsoluteError || 0) * (existing.sampleSize || 1) + Math.abs(variance)) / newSampleSize;

    store.addMetric({
      metricType: 'duration_accuracy',
      serviceType: serviceType,
      sampleSize: newSampleSize,
      meanVariance: Math.round(newMean * 10000) / 10000,
      meanAbsoluteError: Math.round(newMAE * 10000) / 10000,
      accuracyPct: Math.round(((existing.accuracyPct || 0) * (existing.sampleSize || 1) + accuracy) / newSampleSize * 100) / 100,
    });
  } else {
    store.addMetric({
      metricType: 'duration_accuracy',
      serviceType: serviceType,
      sampleSize: 1,
      meanVariance: variance,
      meanAbsoluteError: Math.abs(variance),
      accuracyPct: Math.round(accuracy * 100) / 100,
    });
  }
}

/**
 * Internal: Update revenue accuracy metrics.
 */
function _updateRevenueMetrics(serviceType, variance, accuracy) {
  const metrics = store.getAllMetrics();
  const existing = metrics.find(m =>
    m.metricType === 'revenue_accuracy' &&
    m.serviceType === serviceType
  );

  if (existing) {
    const newSampleSize = (existing.sampleSize || 1) + 1;
    const newMean = ((existing.meanVariance || 0) * (existing.sampleSize || 1) + variance) / newSampleSize;

    store.addMetric({
      metricType: 'revenue_accuracy',
      serviceType: serviceType,
      sampleSize: newSampleSize,
      meanVariance: Math.round(newMean * 10000) / 10000,
      accuracyPct: Math.round(((existing.accuracyPct || 0) * (existing.sampleSize || 1) + accuracy) / newSampleSize * 100) / 100,
    });
  } else {
    store.addMetric({
      metricType: 'revenue_accuracy',
      serviceType: serviceType,
      sampleSize: 1,
      meanVariance: variance,
      accuracyPct: Math.round(accuracy * 100) / 100,
    });
  }
}

/**
 * Internal: Update crew efficiency with extended dimensions.
 * Now tracks: duration variance, average actual duration, job count, travel time, crew size.
 */
function _updateCrewEfficiency(crewId, durationVariance, actualDuration, job) {
  const crews = store.getAllCrews();
  const crew = crews.find(c => c.id === crewId);
  if (!crew) return;

  // Compute rolling average efficiency
  const oldEff = parseFloat(crew.efficiency) || 0;
  const sampleSize = crew.jobCount || 0;
  const newEff = sampleSize > 0
    ? (oldEff * sampleSize + durationVariance) / (sampleSize + 1)
    : durationVariance;

  // Extended crew metrics
  const oldAvgDuration = parseFloat(crew.avgActualDuration) || 0;
  const newAvgDuration = sampleSize > 0
    ? (oldAvgDuration * sampleSize + (actualDuration || 0)) / (sampleSize + 1)
    : (actualDuration || 0);

  const oldAvgTravel = parseFloat(crew.avgTravelTime) || 0;
  const travelTime = parseFloat(job.travelTimeMinutes) || 0;
  const newAvgTravel = sampleSize > 0
    ? (oldAvgTravel * sampleSize + travelTime) / (sampleSize + 1)
    : travelTime;

  store.addMetric({
    metricType: 'crew_efficiency',
    serviceType: crewId,
    sampleSize: sampleSize + 1,
    meanVariance: Math.round(newEff * 10000) / 10000,
    avgActualDuration: Math.round(newAvgDuration * 100) / 100,
    avgTravelTime: Math.round(newAvgTravel * 100) / 100,
    crewSize: job.crewSize != null ? parseInt(job.crewSize, 10) : null,
  });
}

/**
 * Internal: Update seasonal tracking metrics.
 */
function _updateSeasonalMetrics(serviceType, season, durationVariance, revenueVariance, durationAccuracy) {
  const metrics = store.getAllMetrics();
  const existing = metrics.find(m =>
    m.metricType === 'seasonal_performance' &&
    m.serviceType === serviceType &&
    m.season === season
  );

  if (existing) {
    const newSampleSize = (existing.sampleSize || 1) + 1;
    const newDurationVar = ((existing.meanDurationVariance || 0) * (existing.sampleSize || 1) + durationVariance) / newSampleSize;
    const newRevenueVar = ((existing.meanRevenueVariance || 0) * (existing.sampleSize || 1) + revenueVariance) / newSampleSize;

    store.addMetric({
      metricType: 'seasonal_performance',
      serviceType: serviceType,
      season: season,
      sampleSize: newSampleSize,
      meanDurationVariance: Math.round(newDurationVar * 10000) / 10000,
      meanRevenueVariance: Math.round(newRevenueVar * 10000) / 10000,
      accuracyPct: Math.round(((existing.accuracyPct || 0) * (existing.sampleSize || 1) + durationAccuracy) / newSampleSize * 100) / 100,
    });
  } else {
    store.addMetric({
      metricType: 'seasonal_performance',
      serviceType: serviceType,
      season: season,
      sampleSize: 1,
      meanDurationVariance: durationVariance,
      meanRevenueVariance: revenueVariance,
      accuracyPct: Math.round(durationAccuracy * 100) / 100,
    });
  }
}

/**
 * Internal: Update property-based learning metrics.
 */
function _updatePropertyMetrics(serviceType, propertySize, durationVariance, revenueVariance) {
  const metrics = store.getAllMetrics();
  const existing = metrics.find(m =>
    m.metricType === 'property_performance' &&
    m.serviceType === serviceType &&
    m.propertySize === propertySize
  );

  if (existing) {
    const newSampleSize = (existing.sampleSize || 1) + 1;
    const newDurationVar = ((existing.meanDurationVariance || 0) * (existing.sampleSize || 1) + durationVariance) / newSampleSize;

    store.addMetric({
      metricType: 'property_performance',
      serviceType: serviceType,
      propertySize: propertySize,
      sampleSize: newSampleSize,
      meanDurationVariance: Math.round(newDurationVar * 10000) / 10000,
    });
  } else {
    store.addMetric({
      metricType: 'property_performance',
      serviceType: serviceType,
      propertySize: propertySize,
      sampleSize: 1,
      meanDurationVariance: durationVariance,
    });
  }
}

/**
 * Get service-specific duration predictions.
 * Returns the average duration variance for each service type.
 *
 * @param {string} serviceType - Optional, filter to one service
 * @returns {object[]} List of { serviceType, avgVariance, accuracy, sampleSize }
 */
function getDurationPredictions(serviceType) {
  const metrics = store.getAllMetrics();
  const durationMetrics = metrics.filter(m =>
    m.metricType === 'duration_accuracy' &&
    (!serviceType || m.serviceType === serviceType)
  );

  // Group by service type, take most recent entry for each
  const byService = {};
  durationMetrics.forEach(m => {
    byService[m.serviceType] = m; // last one wins (chronological order)
  });

  return Object.entries(byService).map(([svc, m]) => ({
    serviceType: svc,
    avgVariance: m.meanVariance,
    avgAbsoluteError: m.meanAbsoluteError,
    accuracyPct: m.accuracyPct,
    sampleSize: m.sampleSize,
  }));
}

/**
 * Adjusted estimate using learned duration variance.
 * Takes a base estimate and adjusts it based on historical data.
 *
 * @param {object} estimate - An estimate object from estimation.generateEstimate()
 * @param {string} serviceType - The service type to look up learning data for
 * @returns {object} The same estimate with adjustedHours and total adjusted
 */
function applyLearningToEstimate(estimate, serviceType) {
  if (!estimate) return null;

  const predictions = getDurationPredictions(serviceType);
  if (predictions.length === 0) return estimate;

  const bestPrediction = predictions[0];
  const adjustment = bestPrediction.avgVariance || 0;

  // If historical jobs tend to take longer, increase the estimate
  const adjustedEstimate = { ...estimate };
  if (adjustment !== 0) {
    const currentHours = estimate.estimatedHours || 0;
    const newHours = Math.max(0.5, currentHours + adjustment);
    adjustedEstimate.estimatedHours = Math.round(newHours * 10) / 10;
    adjustedEstimate.adjustedForLearning = true;
    adjustedEstimate.learningSource = {
      serviceType: serviceType,
      historicalVariance: adjustment,
      accuracy: bestPrediction.accuracyPct,
      sampleSize: bestPrediction.sampleSize,
    };
  }

  return adjustedEstimate;
}

/**
 * Get seasonal trend predictions for a service type.
 * Shows how performance varies by season.
 *
 * @param {string} serviceType - Optional, filter to one service
 * @returns {object[]} Seasonal performance data
 */
function getSeasonalTrends(serviceType) {
  const metrics = store.getAllMetrics();
  const seasonalMetrics = metrics.filter(m =>
    m.metricType === 'seasonal_performance' &&
    (!serviceType || m.serviceType === serviceType)
  );

  // Group by season, take most recent entry for each
  const bySeason = {};
  seasonalMetrics.forEach(m => {
    bySeason[m.season] = m;
  });

  return Object.entries(bySeason).map(([season, m]) => ({
    season: season,
    serviceType: m.serviceType,
    avgDurationVariance: m.meanDurationVariance,
    avgRevenueVariance: m.meanRevenueVariance,
    accuracyPct: m.accuracyPct,
    sampleSize: m.sampleSize,
  }));
}

/**
 * Get crew efficiency data with extended dimensions.
 *
 * @param {string} crewId - Optional, filter to one crew
 * @returns {object[]} Crew efficiency data
 */
function getCrewEfficiency(crewId) {
  const metrics = store.getAllMetrics();
  const crewMetrics = metrics.filter(m =>
    m.metricType === 'crew_efficiency' &&
    (!crewId || m.serviceType === crewId)
  );

  // Group by crew, take most recent entry for each
  const byCrew = {};
  crewMetrics.forEach(m => {
    byCrew[m.serviceType] = m;
  });

  return Object.entries(byCrew).map(([id, m]) => ({
    crewId: id,
    avgDurationVariance: m.meanVariance,
    avgActualDuration: m.avgActualDuration,
    avgTravelTime: m.avgTravelTime,
    crewSize: m.crewSize,
    jobCount: m.sampleSize,
  }));
}

/**
 * Get property-based performance data.
 *
 * @param {string} serviceType - Optional, filter to one service
 * @returns {object[]} Property performance data
 */
function getPropertyPerformance(serviceType) {
  const metrics = store.getAllMetrics();
  const propertyMetrics = metrics.filter(m =>
    m.metricType === 'property_performance' &&
    (!serviceType || m.serviceType === serviceType)
  );

  return propertyMetrics.map(m => ({
    serviceType: m.serviceType,
    propertySize: m.propertySize,
    avgDurationVariance: m.meanDurationVariance,
    sampleSize: m.sampleSize,
  }));
}

/**
 * Get overall learning summary.
 * Enhanced with seasonal, crew, and property data.
 */
function getLearningSummary() {
  const metrics = store.getAllMetrics();
  const jobs = store.getAllJobs();

  return {
    totalCompletedJobs: jobs.length,
    totalMetricsRecorded: metrics.length,
    servicesTracked: [...new Set(metrics.map(m => m.serviceType).filter(Boolean))],
    durationAccuracy: metrics.filter(m => m.metricType === 'duration_accuracy'),
    revenueAccuracy: metrics.filter(m => m.metricType === 'revenue_accuracy'),
    seasonalTrends: metrics.filter(m => m.metricType === 'seasonal_performance'),
    crewEfficiency: metrics.filter(m => m.metricType === 'crew_efficiency'),
    propertyPerformance: metrics.filter(m => m.metricType === 'property_performance'),
    recentCompletions: jobs.slice(-10).reverse(),
  };
}

module.exports = {
  recordCompletion,
  getDurationPredictions,
  applyLearningToEstimate,
  getLearningSummary,
  getSeasonalTrends,
  getCrewEfficiency,
  getPropertyPerformance,
  // Internal helpers exposed for testing
  _deriveSeason,
  _resolvePredictedDuration,
  _resolvePredictedRevenue,
};