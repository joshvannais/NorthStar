/**
 * Polaris Engine — Server-Side Intelligence Core
 *
 * This is the backend entry point for all Polaris operations.
 * Every page communicates with Polaris through this engine.
 *
 * Responsibilities:
 *   - Estimation (multi-variable, self-learning)
 *   - Job completion recording (learning pipeline)
 *   - Recommendation generation
 *   - Analytics queries
 *   - Future AI interface (ChatGPT, Retell AI)
 *
 * Usage:
 *   const polaris = require('./polaris/engine');
 *   const estimate = polaris.generateEstimate({ serviceType: 'HVAC Repair', ... });
 *   const learning = polaris.recordCompletion({ ... });
 *   const recs = polaris.generateRecommendations({ leads, events, jobs });
 */

const store = require('./store');
const estimation = require('./estimation');
const learning = require('./learning');
const recommendations = require('./recommendations');

/**
 * Initialize Polaris — load all data stores.
 * Call once at server startup.
 */
function init() {
  store.init();
  console.log('[Polaris] Engine initialized');
}

// ── Estimation ──

function generateEstimate(data) {
  return estimation.generateEstimate(data);
}

function assessComplexity(data) {
  return estimation.assessComplexity(data);
}

function loadEstimationConfig(config) {
  estimation.loadConfig(config);
}

// ── Learning ──

function recordCompletion(job) {
  return learning.recordCompletion(job);
}

function getDurationPredictions(serviceType) {
  return learning.getDurationPredictions(serviceType);
}

function applyLearningToEstimate(estimate, serviceType) {
  return learning.applyLearningToEstimate(estimate, serviceType);
}

function getLearningSummary() {
  return learning.getLearningSummary();
}

/**
 * Get seasonal trend data for service types.
 */
function getSeasonalTrends(serviceType) {
  return learning.getSeasonalTrends(serviceType);
}

/**
 * Get crew efficiency data with extended dimensions.
 */
function getCrewEfficiency(crewId) {
  return learning.getCrewEfficiency(crewId);
}

/**
 * Get property-based performance data.
 */
function getPropertyPerformance(serviceType) {
  return learning.getPropertyPerformance(serviceType);
}

/**
 * Derive season from a date string.
 * @param {string|Date} dateInput
 * @returns {string} 'spring', 'summer', 'fall', 'winter', or 'unknown'
 */
function deriveSeason(dateInput) {
  return learning._deriveSeason(dateInput);
}

// ── Recommendations ──

function generateRecommendations(data) {
  return recommendations.generateRecommendations(data);
}

function getRecommendations(resolved) {
  return recommendations.getRecommendations(resolved);
}

function resolveRecommendation(id) {
  return recommendations.resolve(id);
}

// ── Store Access ──

function getCompletedJobs() {
  return store.getAllJobs();
}

function getHistoricalEstimates() {
  return store.getAllEstimates();
}

function getLearningMetrics() {
  return store.getAllMetrics();
}

// ── Analytics Queries ──

/**
 * Get pipeline overview with Polaris intelligence.
 * @param {object[]} leads - All leads from the application
 * @returns {object} Pipeline analysis
 */
function analyzePipeline(leads) {
  if (!leads || leads.length === 0) {
    return { totalLeads: 0, pipelineValue: 0, topOpportunity: null, stageBreakdown: [] };
  }

  const stages = { new: 0, contacted: 0, qualified: 0, booked: 0, completed: 0, lost: 0 };
  let totalPipelineValue = 0;
  let topOpportunity = null;
  let topValue = 0;

  leads.forEach(l => {
    const status = (l.status || l.outcome || 'new').toLowerCase();
    const value = parseFloat(l.avgPrice || l.estimated_price) || 0;

    if (status === 'appointment-set' || status === 'booked') stages.booked++;
    else if (status === 'lead-captured' || status === 'estimate' || status === 'qualified') stages.qualified++;
    else if (status === 'follow-up' || status === 'contacted') stages.contacted++;
    else if (status === 'no-interest' || status === 'lost' || status === 'job-lost') stages.lost++;
    else if (status === 'completed' || status === 'done') stages.completed++;
    else stages.new++;

    // Only include active pipeline value
    if (['new', 'contacted', 'follow-up', 'qualified', 'appointment-set', 'booked', 'lead-captured'].includes(status)) {
      totalPipelineValue += value;
      if (value > topValue) {
        topValue = value;
        topOpportunity = l;
      }
    }
  });

  return {
    totalLeads: leads.length,
    pipelineValue: Math.round(totalPipelineValue),
    topOpportunity: topOpportunity ? {
      name: topOpportunity.caller_name || topOpportunity.caller || 'Lead',
      value: topValue,
      service: topOpportunity.service || topOpportunity.service_type || 'General',
    } : null,
    stageBreakdown: Object.entries(stages).map(([stage, count]) => ({ stage, count })),
    conversionRate: leads.length > 0
      ? Math.round((stages.booked + stages.completed) / leads.length * 100) + '%'
      : '0%',
  };
}

/**
 * Analyze calendar schedule for intelligence.
 * @param {object[]} events - Calendar events
 * @returns {object} Schedule analysis
 */
function analyzeSchedule(events) {
  if (!events || events.length === 0) {
    return { totalEvents: 0, todayEvents: 0, conflicts: 0, efficiency: 0 };
  }

  const today = new Date().toISOString().split('T')[0];
  const todayEvents = events.filter(e => e.date === today);
  const leadEvents = events.filter(e => e.type === 'lead');
  const todayRevenue = todayEvents.reduce((s, e) => s + (parseFloat(e.estimatedPrice) || 0), 0);

  // Detect conflicts
  const timeCounts = {};
  events.forEach(e => {
    if (e.date && e.time) {
      const key = e.date + 'T' + e.time;
      timeCounts[key] = (timeCounts[key] || 0) + 1;
    }
  });
  const conflicts = Object.keys(timeCounts).filter(k => timeCounts[k] > 1).length;

  return {
    totalEvents: events.length,
    todayEvents: todayEvents.length,
    todayRevenue: Math.round(todayRevenue),
    leadAppointments: leadEvents.length,
    conflicts: conflicts,
    efficiency: events.length > 0 ? Math.round((todayEvents.length / events.length) * 100) : 0,
  };
}

/**
 * Get full Polaris dashboard intelligence.
 * Combines pipeline, schedule, learning, and recommendations.
 */
function getDashboardIntelligence(leads, events, jobs) {
  return {
    pipeline: analyzePipeline(leads || []),
    schedule: analyzeSchedule(events || []),
    learning: getLearningSummary(),
    recommendations: getRecommendations(false),
    generatedAt: new Date().toISOString(),
  };
}

// ── Future AI Interface ──

/**
 * Prepare a query context for ChatGPT integration.
 * Returns structured data that an AI can query.
 *
 * Future: ChatGPT calls this to get Polaris intelligence.
 *
 * @param {string} query - Natural language query (e.g., "What jobs will run late?")
 * @param {object} context - { leads, events, jobs }
 * @returns {object} Context data relevant to the query
 */
function prepareQueryContext(query, context) {
  const query_lower = (query || '').toLowerCase();

  // Route query to the appropriate data
  if (query_lower.includes('late') || query_lower.includes('overdue') || query_lower.includes('delay')) {
    // Return schedule data for late-job detection
    return {
      type: 'schedule_analysis',
      data: analyzeSchedule(context.events || []),
      recommendations: getRecommendations(false).filter(r => r.type === 'capacity_warning' || r.type === 'scheduling_conflict'),
    };
  }

  if (query_lower.includes('pipeline') || query_lower.includes('revenue') || query_lower.includes('opportunity')) {
    return {
      type: 'pipeline_analysis',
      data: analyzePipeline(context.leads || []),
      recommendations: getRecommendations(false).filter(r =>
        r.type === 'pipeline_bottleneck' || r.type === 'revenue_opportunity'
      ),
    };
  }

  if (query_lower.includes('crew') || query_lower.includes('busiest') || query_lower.includes('efficiency')) {
    return {
      type: 'crew_analysis',
      data: getLearningSummary(),
      crews: store.getAllCrews(),
    };
  }

  if (query_lower.includes('follow') || query_lower.includes('estimate') || query_lower.includes('profitable')) {
    return {
      type: 'opportunity_analysis',
      data: analyzePipeline(context.leads || []),
      historicalEstimates: getHistoricalEstimates().slice(-20),
    };
  }

  // Default: return full intelligence
  return getDashboardIntelligence(context.leads, context.events, context.jobs);
}

/**
 * Prepare a context object for Retell AI voice conversations.
 * Returns scheduling and availability data.
 *
 * Future: Retell AI calls this when scheduling appointments.
 */
function prepareRetellContext(events, crews) {
  return {
    availableSlots: _getAvailableSlots(events || []),
    crews: store.getAllCrews().map(c => ({ id: c.id, name: c.name, skills: c.skills, status: c.status })),
    scheduleSummary: analyzeSchedule(events || []),
  };
}

/**
 * Internal: Compute available scheduling slots.
 * Used by both ChatGPT and Retell AI integrations.
 */
function _getAvailableSlots(events) {
  const today = new Date();
  const slots = [];
  const standardHours = [8, 9, 10, 11, 13, 14, 15, 16]; // 8-11 AM, 1-4 PM

  // Generate slots for the next 7 days
  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];
    const dayEvents = events.filter(e => e.date === dateStr);
    const bookedTimes = new Set(dayEvents.map(e => e.time));

    const daySlots = standardHours
      .filter(h => !bookedTimes.has(h + ':00') && !bookedTimes.has(h + ':30'))
      .map(h => ({
        time: (h > 12 ? (h - 12) + ':00 PM' : h + ':00 AM').replace('0:', '12:'),
        date: dateStr,
        available: true,
      }));

    if (daySlots.length > 0) {
      slots.push({ date: dateStr, dayOfWeek: date.toLocaleDateString('en-US', { weekday: 'long' }), slots: daySlots });
    }
  }

  return slots;
}

module.exports = {
  init,
  // Estimation
  generateEstimate,
  assessComplexity,
  loadEstimationConfig,
  // Learning
  recordCompletion,
  getDurationPredictions,
  applyLearningToEstimate,
  getLearningSummary,
  getSeasonalTrends,
  getCrewEfficiency,
  getPropertyPerformance,
  deriveSeason,
  // Recommendations
  generateRecommendations,
  getRecommendations,
  resolveRecommendation,
  // Store access
  getCompletedJobs,
  getHistoricalEstimates,
  getLearningMetrics,
  // Analytics
  analyzePipeline,
  analyzeSchedule,
  getDashboardIntelligence,
  // AI interfaces
  prepareQueryContext,
  prepareRetellContext,
};