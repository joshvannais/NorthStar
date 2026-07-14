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
 */

const store = require('./store');

/**
 * Record a completed job and compute its learning signals.
 *
 * @param {object} job - The completed job data (must include estimatedDuration and actualDuration)
 * @returns {object} The learning results (variance, accuracy, metric ID)
 */
function recordCompletion(job) {
  if (!job || !job.serviceType) {
    return { error: 'Job must have a serviceType' };
  }

  // Compute duration variance
  const estDuration = parseFloat(job.estimatedDuration) || 0;
  const actDuration = parseFloat(job.actualDuration) || 0;
  const durationVariance = actDuration - estDuration;
  const durationAccuracy = estDuration > 0
    ? Math.max(0, 100 - Math.abs((durationVariance / estDuration) * 100))
    : 0;

  // Compute revenue variance
  const estRevenue = parseFloat(job.estimatedRevenue) || 0;
  const actRevenue = parseFloat(job.actualRevenue) || 0;
  const revenueVariance = actRevenue - estRevenue;
  const revenueAccuracy = estRevenue > 0
    ? Math.max(0, 100 - Math.abs((revenueVariance / estRevenue) * 100))
    : 0;

  // Store the completed job
  const savedJob = store.addJob({
    ...job,
    estimatedDuration: estDuration,
    actualDuration: actDuration,
    durationVariance: Math.round(durationVariance * 100) / 100,
    estimatedRevenue: estRevenue,
    actualRevenue: actRevenue,
    completionStatus: job.completionStatus || 'completed',
  });

  // Update learning metrics
  try {
    _updateDurationMetrics(job.serviceType, durationVariance, durationAccuracy);
    _updateRevenueMetrics(job.serviceType, revenueVariance, revenueAccuracy);

    if (job.crewId) {
      _updateCrewEfficiency(job.crewId, durationVariance);
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
 * Internal: Update crew efficiency based on duration variance.
 */
function _updateCrewEfficiency(crewId, durationVariance) {
  const crews = store.getAllCrews();
  const crew = crews.find(c => c.id === crewId);
  if (!crew) return;

  // Compute rolling average efficiency
  const oldEff = parseFloat(crew.efficiency) || 0;
  const sampleSize = crew.jobCount || 0;
  const newEff = sampleSize > 0
    ? (oldEff * sampleSize + durationVariance) / (sampleSize + 1)
    : durationVariance;

  store.addMetric({
    metricType: 'crew_efficiency',
    serviceType: crewId,
    sampleSize: sampleSize + 1,
    meanVariance: Math.round(newEff * 10000) / 10000,
  });
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
 * Get overall learning summary.
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
    recentCompletions: jobs.slice(-10).reverse(),
  };
}

module.exports = {
  recordCompletion,
  getDurationPredictions,
  applyLearningToEstimate,
  getLearningSummary,
};