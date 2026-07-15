/**
 * Polaris Opportunity & Pipeline Intelligence Engine
 *
 * Manages revenue opportunities, sales pipeline stages, forecasting,
 * and pipeline analytics across the Polaris platform.
 *
 * Ownership Boundary:
 *   - Opportunity lifecycle (create, update, archive, restore)
 *   - Pipeline stage management and transitions
 *   - Win probability calculation (stage-based)
 *   - Revenue forecasting and weighted pipeline value
 *   - Pipeline analytics (stage totals, conversion rates, deal values)
 *   - Priority queue and stale opportunity detection
 *   - Customer opportunity summaries
 *
 * NOT estimation, pricing, scheduling, workflow, learning, validation,
 * customer management, communication history, or UI.
 *
 * Dependencies (consumed via public APIs only):
 *   - store.js (persistence) — file-backed storage
 *   - customer-engine.js (customer context)
 *   - communications-engine.js (activity recording)
 *   - engine.js (recommendations + learning)
 */

const store = require('./store');

// ── Pipeline Stage Constants ──
const PIPELINE_STAGES = Object.freeze({
  lead:              { id: 'lead',              displayName: 'Lead',              order: 0,  baseProbability: 0.05, category: 'active' },
  qualified:         { id: 'qualified',         displayName: 'Qualified',         order: 1,  baseProbability: 0.15, category: 'active' },
  discovery:         { id: 'discovery',         displayName: 'Discovery',         order: 2,  baseProbability: 0.30, category: 'active' },
  proposal:          { id: 'proposal',          displayName: 'Proposal',          order: 3,  baseProbability: 0.50, category: 'active' },
  negotiation:       { id: 'negotiation',       displayName: 'Negotiation',       order: 4,  baseProbability: 0.70, category: 'active' },
  verbalCommitment:  { id: 'verbalCommitment',  displayName: 'Verbal Commitment', order: 5,  baseProbability: 0.85, category: 'active' },
  won:               { id: 'won',               displayName: 'Won',               order: 6,  baseProbability: 1.00, category: 'closed' },
  lost:              { id: 'lost',              displayName: 'Lost',              order: 7,  baseProbability: 0.00, category: 'closed' },
  archived:          { id: 'archived',          displayName: 'Archived',          order: 8,  baseProbability: 0.00, category: 'closed' },
});

const VALID_STAGES = new Set(Object.keys(PIPELINE_STAGES));
const ACTIVE_STAGES = new Set(Object.keys(PIPELINE_STAGES).filter(function (k) { return PIPELINE_STAGES[k].category === 'active'; }));
const CLOSED_STAGES = new Set(Object.keys(PIPELINE_STAGES).filter(function (k) { return PIPELINE_STAGES[k].category === 'closed'; }));

// ── Priority Constants ──
const PRIORITY_LEVELS = Object.freeze({
  critical: { id: 'critical', displayName: 'Critical', weight: 5 },
  high:     { id: 'high',     displayName: 'High',     weight: 4 },
  medium:   { id: 'medium',   displayName: 'Medium',   weight: 3 },
  low:      { id: 'low',      displayName: 'Low',      weight: 2 },
  none:     { id: 'none',     displayName: 'None',     weight: 1 },
});

const VALID_PRIORITIES = new Set(Object.keys(PRIORITY_LEVELS));

// ── In-memory store ──
const _opportunities = {};
var _idCounter = 0;

function _genId() {
  _idCounter++;
  return 'opp_' + Date.now() + '_' + _idCounter;
}

function _now() {
  return new Date().toISOString();
}

// ── Persistence — Polaris Store Integration ──

function _persist(opp) {
  try {
    store.addRecommendation({
      type: 'opportunity',
      oppId: opp.id,
      customerId: opp.customerId,
      data: opp,
      timestamp: opp.updatedAt,
    });
  } catch (e) {
    // Non-critical: in-memory cache is primary.
  }
}

/**
 * Initialize the Opportunity Engine — load existing opportunity
 * records from the Polaris store into the in-memory cache.
 *
 * Call once at server startup after communicationsEngine.init().
 *
 * @returns {object} { loaded: number }
 */
function init() {
  var loaded = 0;
  try {
    var recs = store.getAllRecommendations() || [];
    recs.forEach(function (r) {
      if (r && r.type === 'opportunity' && r.data && r.data.id) {
        _opportunities[r.data.id] = r.data;
        loaded++;
      }
    });
  } catch (e) {
    // Store may not be initialized yet.
  }
  return { loaded: loaded };
}

// ── Validation ──

function _validateStage(stage) {
  if (!VALID_STAGES.has(stage)) {
    return { valid: false, error: 'Invalid stage: "' + stage + '". Allowed: ' + Array.from(VALID_STAGES).join(', ') };
  }
  return { valid: true };
}

function _validatePriority(priority) {
  if (!VALID_PRIORITIES.has(priority)) {
    return { valid: false, error: 'Invalid priority: "' + priority + '". Allowed: ' + Array.from(VALID_PRIORITIES).join(', ') };
  }
  return { valid: true };
}

function _isActiveStage(stage) {
  return ACTIVE_STAGES.has(stage);
}

function _isClosedStage(stage) {
  return CLOSED_STAGES.has(stage);
}

// ── Core Opportunity CRUD ──

/**
 * Create a new opportunity.
 *
 * @param {object} data - Opportunity data
 * @param {string} data.customerId - Customer ID (required)
 * @param {string} data.title - Opportunity title (required)
 * @param {string} [data.description] - Description
 * @param {number} [data.estimatedValue=0] - Estimated value in currency units
 * @param {string} [data.stage='lead'] - Pipeline stage
 * @param {string} [data.priority='medium'] - Priority level
 * @param {string} [data.owner] - Sales owner/agent name
 * @param {string} [data.expectedCloseDate] - Expected close date (ISO string)
 * @param {string[]} [data.tags] - Tags for categorization
 * @param {string} [data.notes] - Internal notes
 * @returns {object} Created opportunity
 */
function createOpportunity(data) {
  if (!data || !data.customerId) return { error: 'Customer ID is required' };
  if (!data || !data.title) return { error: 'Opportunity title is required' };

  var stage = data.stage || 'lead';
  var stageCheck = _validateStage(stage);
  if (!stageCheck.valid) return { error: stageCheck.error };

  var priority = data.priority || 'medium';
  var priorityCheck = _validatePriority(priority);
  if (!priorityCheck.valid) return { error: priorityCheck.error };

  var id = _genId();
  var now = _now();
  var estimatedValue = (typeof data.estimatedValue === 'number' && data.estimatedValue >= 0) ? data.estimatedValue : 0;
  var probability = PIPELINE_STAGES[stage].baseProbability;

  var opp = {
    id: id,
    customerId: data.customerId,
    title: data.title,
    description: data.description || null,
    estimatedValue: estimatedValue,
    probability: probability,
    expectedRevenue: Math.round(estimatedValue * probability * 100) / 100,
    stage: stage,
    stageDisplayName: PIPELINE_STAGES[stage].displayName,
    priority: priority,
    priorityDisplayName: PRIORITY_LEVELS[priority].displayName,
    priorityWeight: PRIORITY_LEVELS[priority].weight,
    owner: data.owner || null,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    expectedCloseDate: data.expectedCloseDate || null,
    actualCloseDate: null,
    lastActivity: now,
    tags: Array.isArray(data.tags) ? data.tags.slice() : [],
    notes: data.notes || null,
    archived: false,
  };

  _opportunities[id] = opp;
  _persist(opp);

  // Record pipeline activity as a communication
  try {
    var comms = require('./communications-engine');
    comms.recordCommunication({
      customerId: data.customerId,
      type: 'internal',
      direction: 'outbound',
      subject: 'Opportunity Created: ' + data.title,
      content: 'New opportunity created in stage "' + PIPELINE_STAGES[stage].displayName + '" with value $' + estimatedValue.toFixed(2),
      status: 'completed',
      author: data.owner || 'System',
      metadata: { opportunityId: id, stage: stage, value: estimatedValue },
    });
  } catch (e) {
    // Non-critical.
  }

  return {
    id: opp.id,
    customerId: opp.customerId,
    title: opp.title,
    stage: opp.stage,
    stageDisplayName: opp.stageDisplayName,
    priority: opp.priority,
    estimatedValue: opp.estimatedValue,
    probability: opp.probability,
    expectedRevenue: opp.expectedRevenue,
    createdAt: opp.createdAt,
  };
}

/**
 * Update an opportunity's fields.
 *
 * @param {string} id - Opportunity ID
 * @param {object} updates - Fields to update
 * @returns {object} Updated opportunity
 */
function updateOpportunity(id, updates) {
  if (!id) return { error: 'Opportunity ID is required' };
  var opp = _opportunities[id];
  if (!opp) return { error: 'Opportunity not found: ' + id };
  if (!updates) return { error: 'Updates object is required' };

  var now = _now();

  if (updates.title !== undefined) opp.title = updates.title;
  if (updates.description !== undefined) opp.description = updates.description;
  if (updates.notes !== undefined) opp.notes = updates.notes;
  if (updates.owner !== undefined) opp.owner = updates.owner;
  if (updates.expectedCloseDate !== undefined) opp.expectedCloseDate = updates.expectedCloseDate;
  if (updates.priority !== undefined) {
    var priorityCheck = _validatePriority(updates.priority);
    if (!priorityCheck.valid) return { error: priorityCheck.error };
    opp.priority = updates.priority;
    opp.priorityDisplayName = PRIORITY_LEVELS[updates.priority].displayName;
    opp.priorityWeight = PRIORITY_LEVELS[updates.priority].weight;
  }

  if (updates.estimatedValue !== undefined) {
    opp.estimatedValue = (typeof updates.estimatedValue === 'number' && updates.estimatedValue >= 0) ? updates.estimatedValue : 0;
    opp.expectedRevenue = Math.round(opp.estimatedValue * opp.probability * 100) / 100;
  }

  if (updates.stage !== undefined) {
    var stageCheck = _validateStage(updates.stage);
    if (!stageCheck.valid) return { error: stageCheck.error };
    opp.stage = updates.stage;
    opp.stageDisplayName = PIPELINE_STAGES[updates.stage].displayName;
    opp.probability = PIPELINE_STAGES[updates.stage].baseProbability;
    opp.expectedRevenue = Math.round(opp.estimatedValue * opp.probability * 100) / 100;

    if (updates.stage === 'won') {
      opp.status = 'won';
      opp.actualCloseDate = now;
    } else if (updates.stage === 'lost') {
      opp.status = 'lost';
      opp.actualCloseDate = now;
    } else if (updates.stage === 'archived') {
      opp.archived = true;
      opp.status = 'archived';
    }
  }

  if (Array.isArray(updates.tags)) opp.tags = updates.tags.slice();

  opp.lastActivity = now;
  opp.updatedAt = now;
  _persist(opp);

  return {
    id: opp.id,
    customerId: opp.customerId,
    title: opp.title,
    stage: opp.stage,
    stageDisplayName: opp.stageDisplayName,
    priority: opp.priority,
    estimatedValue: opp.estimatedValue,
    probability: opp.probability,
    expectedRevenue: opp.expectedRevenue,
    status: opp.status,
    updatedAt: opp.updatedAt,
  };
}

/**
 * Get a single opportunity by ID.
 *
 * @param {string} id - Opportunity ID
 * @returns {object} Opportunity record
 */
function getOpportunity(id) {
  if (!id) return { error: 'Opportunity ID is required' };
  var opp = _opportunities[id];
  if (!opp) return { error: 'Opportunity not found: ' + id };
  return Object.assign({}, opp);
}

/**
 * List opportunities with optional filters.
 *
 * @param {object} [filters] - Optional filters
 * @param {string} [filters.stage] - Filter by stage
 * @param {string} [filters.priority] - Filter by priority
 * @param {string} [filters.status] - Filter by status (open/won/lost/archived)
 * @param {string} [filters.owner] - Filter by owner
 * @param {string} [filters.customerId] - Filter by customer
 * @param {string} [filters.search] - Search in title/description
 * @param {number} [filters.limit] - Max results
 * @param {boolean} [filters.includeArchived] - Include archived opportunities
 * @returns {object} { opportunities, total }
 */
function listOpportunities(filters) {
  var results = [];

  Object.keys(_opportunities).forEach(function (k) {
    var opp = _opportunities[k];

    if (filters) {
      if (filters.stage && opp.stage !== filters.stage) return;
      if (filters.priority && opp.priority !== filters.priority) return;
      if (filters.status && opp.status !== filters.status) return;
      if (filters.owner && opp.owner !== filters.owner) return;
      if (filters.customerId && opp.customerId !== filters.customerId) return;
      if (!filters.includeArchived && opp.archived) return;
      if (filters.search) {
        var q = filters.search.toLowerCase();
        var titleMatch = opp.title && opp.title.toLowerCase().indexOf(q) !== -1;
        var descMatch = opp.description && opp.description.toLowerCase().indexOf(q) !== -1;
        if (!titleMatch && !descMatch) return;
      }
    } else {
      // Default: non-archived only
      if (opp.archived) return;
    }

    results.push(opp);
  });

  // Sort by lastActivity descending
  results.sort(function (a, b) {
    return new Date(b.lastActivity) - new Date(a.lastActivity);
  });

  var total = results.length;
  if (filters && filters.limit && filters.limit > 0) {
    results = results.slice(0, filters.limit);
  }

  return {
    opportunities: results.map(function (o) { return Object.assign({}, o); }),
    total: total,
  };
}

/**
 * Archive an opportunity.
 *
 * @param {string} id - Opportunity ID
 * @returns {object} { id, archived: true }
 */
function archiveOpportunity(id) {
  if (!id) return { error: 'Opportunity ID is required' };
  var opp = _opportunities[id];
  if (!opp) return { error: 'Opportunity not found: ' + id };

  opp.archived = true;
  opp.status = 'archived';
  opp.stage = 'archived';
  opp.stageDisplayName = PIPELINE_STAGES.archived.displayName;
  opp.probability = 0;
  opp.expectedRevenue = 0;
  opp.updatedAt = _now();
  opp.lastActivity = _now();
  _persist(opp);

  return { id: opp.id, archived: true, updatedAt: opp.updatedAt };
}

/**
 * Restore an archived opportunity.
 *
 * @param {string} id - Opportunity ID
 * @returns {object} Updated opportunity
 */
function restoreOpportunity(id) {
  if (!id) return { error: 'Opportunity ID is required' };
  var opp = _opportunities[id];
  if (!opp) return { error: 'Opportunity not found: ' + id };
  if (!opp.archived) return { error: 'Opportunity is not archived' };

  opp.archived = false;
  opp.status = 'open';
  opp.stage = 'lead';
  opp.stageDisplayName = PIPELINE_STAGES.lead.displayName;
  opp.probability = PIPELINE_STAGES.lead.baseProbability;
  opp.expectedRevenue = Math.round(opp.estimatedValue * opp.probability * 100) / 100;
  opp.updatedAt = _now();
  opp.lastActivity = _now();
  _persist(opp);

  return {
    id: opp.id,
    archived: opp.archived,
    stage: opp.stage,
    stageDisplayName: opp.stageDisplayName,
    status: opp.status,
    updatedAt: opp.updatedAt,
  };
}

/**
 * Search opportunities across all fields.
 *
 * @param {string} query - Search query
 * @param {object} [filters] - Additional filters
 * @returns {object} { opportunities, total }
 */
function searchOpportunities(query, filters) {
  var combinedFilters = Object.assign({}, filters || {}, { search: query });
  return listOpportunities(combinedFilters);
}

/**
 * Update an opportunity's pipeline stage.
 *
 * @param {string} id - Opportunity ID
 * @param {string} newStage - Target stage
 * @returns {object} Updated opportunity
 */
function updateOpportunityStage(id, newStage) {
  return updateOpportunity(id, { stage: newStage });
}

// ── Win Probability ──

/**
 * Calculate win probability for an opportunity.
 * Based on stage defaults, with optional adjustments for age, value, and activity.
 *
 * @param {string} id - Opportunity ID
 * @returns {object} Probability analysis
 */
function calculateWinProbability(id) {
  if (!id) return { error: 'Opportunity ID is required' };
  var opp = _opportunities[id];
  if (!opp) return { error: 'Opportunity not found: ' + id };

  var baseProbability = opp.probability;
  var adjustments = [];
  var adjustedProbability = baseProbability;

  // Stage-based base
  if (opp.stage === 'won') {
    return { opportunityId: id, winProbability: 1.0, baseProbability: 1.0, adjustments: [], finalProbability: 1.0, label: 'Won' };
  }
  if (opp.stage === 'lost' || opp.stage === 'archived') {
    return { opportunityId: id, winProbability: 0.0, baseProbability: 0.0, adjustments: [], finalProbability: 0.0, label: 'Lost' };
  }

  // Adjustment: Age — older deals (>90 days) lose some probability
  var ageDays = (Date.now() - new Date(opp.createdAt).getTime()) / 86400000;
  if (ageDays > 90) {
    adjustments.push({ factor: 'age', description: 'Deal age > 90 days', impact: -0.05 });
    adjustedProbability -= 0.05;
  }

  // Adjustment: Recency of activity — stale deals lose probability
  var inactivityDays = (Date.now() - new Date(opp.lastActivity).getTime()) / 86400000;
  if (inactivityDays > 30) {
    adjustments.push({ factor: 'stale', description: 'No activity in > 30 days', impact: -0.10 });
    adjustedProbability -= 0.10;
  } else if (inactivityDays > 14) {
    adjustments.push({ factor: 'low_activity', description: 'No activity in 14-30 days', impact: -0.05 });
    adjustedProbability -= 0.05;
  }

  // Clamp
  adjustedProbability = Math.max(0, Math.min(1, adjustedProbability));

  var label = 'Low';
  if (adjustedProbability >= 0.80) label = 'Very High';
  else if (adjustedProbability >= 0.60) label = 'High';
  else if (adjustedProbability >= 0.40) label = 'Medium';
  else if (adjustedProbability >= 0.20) label = 'Low';

  return {
    opportunityId: id,
    winProbability: Math.round(adjustedProbability * 100) / 100,
    baseProbability: baseProbability,
    adjustments: adjustments,
    finalProbability: Math.round(adjustedProbability * 100) / 100,
    label: label,
  };
}

// ── Pipeline Analytics ──

/**
 * Get the full pipeline view.
 *
 * @param {object} [filters] - Optional filters
 * @returns {object} Pipeline data
 */
function getPipeline(filters) {
  var all = listOpportunities(Object.assign({}, filters || {}, { includeArchived: false }));

  var byStage = {};
  Object.keys(ACTIVE_STAGES).forEach(function (k) {
    byStage[k] = [];
  });

  all.opportunities.forEach(function (opp) {
    if (byStage[opp.stage]) {
      byStage[opp.stage].push(opp);
    }
  });

  var stageCounts = {};
  var stageValues = {};
  Object.keys(byStage).forEach(function (k) {
    stageCounts[k] = byStage[k].length;
    stageValues[k] = byStage[k].reduce(function (sum, o) { return sum + o.estimatedValue; }, 0);
  });

  return {
    totalDeals: all.total,
    totalValue: all.opportunities.reduce(function (s, o) { return s + o.estimatedValue; }, 0),
    weightedValue: all.opportunities.reduce(function (s, o) { return s + o.expectedRevenue; }, 0),
    stageCounts: stageCounts,
    stageValues: stageValues,
    byStage: byStage,
  };
}

/**
 * Get pipeline metrics and KPIs.
 *
 * @returns {object} Pipeline metrics
 */
function getPipelineMetrics() {
  var all = listOpportunities({ includeArchived: false });
  var won = listOpportunities({ status: 'won', includeArchived: false });
  var lost = listOpportunities({ status: 'lost', includeArchived: false });
  var active = listOpportunities({ includeArchived: false, status: 'open' });

  var totalValue = all.opportunities.reduce(function (s, o) { return s + o.estimatedValue; }, 0);
  var weightedValue = all.opportunities.reduce(function (s, o) { return s + o.expectedRevenue; }, 0);
  var wonValue = won.opportunities.reduce(function (s, o) { return s + o.estimatedValue; }, 0);
  var averageDealValue = all.total > 0 ? Math.round((totalValue / all.total) * 100) / 100 : 0;

  var totalClosed = won.total + lost.total;
  var winRate = totalClosed > 0 ? Math.round((won.total / totalClosed) * 10000) / 100 : 0;
  var lossRate = totalClosed > 0 ? Math.round((lost.total / totalClosed) * 10000) / 100 : 0;

  // Stale deals: no activity in >30 days
  var staleThreshold = new Date(Date.now() - 30 * 86400000).toISOString();
  var staleDeals = 0;
  active.opportunities.forEach(function (o) {
    if (o.lastActivity < staleThreshold) staleDeals++;
  });

  return {
    totalDeals: all.total,
    activeDeals: active.total,
    wonDeals: won.total,
    lostDeals: lost.total,
    totalPipelineValue: totalValue,
    weightedPipelineValue: weightedValue,
    wonValue: wonValue,
    averageDealValue: averageDealValue,
    winRate: winRate,
    lossRate: lossRate,
    staleDeals: staleDeals,
    winRateDisplay: winRate + '%',
    lossRateDisplay: lossRate + '%',
  };
}

/**
 * Get totals grouped by pipeline stage.
 *
 * @returns {object} Stage totals
 */
function getStageTotals() {
  var all = listOpportunities({ includeArchived: false });
  var stageTotals = {};

  Object.keys(PIPELINE_STAGES).forEach(function (k) {
    var stageOpps = all.opportunities.filter(function (o) { return o.stage === k; });
    var count = stageOpps.length;
    var totalValue = stageOpps.reduce(function (s, o) { return s + o.estimatedValue; }, 0);
    var weightedValue = stageOpps.reduce(function (s, o) { return s + o.expectedRevenue; }, 0);

    stageTotals[k] = {
      stage: k,
      displayName: PIPELINE_STAGES[k].displayName,
      count: count,
      totalValue: totalValue,
      weightedValue: Math.round(weightedValue * 100) / 100,
      averageValue: count > 0 ? Math.round((totalValue / count) * 100) / 100 : 0,
    };
  });

  // Conversion rates: % of opportunities that moved to next stage
  var conversionRates = {};
  var stageKeys = Object.keys(ACTIVE_STAGES);
  for (var i = 0; i < stageKeys.length - 1; i++) {
    var current = stageKeys[i];
    var next = stageKeys[i + 1];
    var currentCount = stageTotals[current].count;
    var nextCount = stageTotals[next].count;
    var totalInCurrentOrLater = stageTotals[current].count + stageTotals[next].count;

    // Also count how many were won after this stage
    var wonCount = 0;
    all.opportunities.forEach(function (o) {
      if (o.status === 'won') wonCount++;
    });

    conversionRates[current + '_to_' + next] = {
      from: current,
      to: next,
      count: nextCount,
      rate: totalInCurrentOrLater > 0 ? Math.round((nextCount / totalInCurrentOrLater) * 10000) / 100 + '%' : '0%',
    };
  }

  return {
    stages: stageTotals,
    conversionRates: conversionRates,
  };
}

/**
 * Calculate forecast revenue based on active pipeline.
 *
 * @param {object} [options] - Forecast options
 * @param {number} [options.months] - Forecast horizon in months
 * @returns {object} Forecast data
 */
function calculateForecastRevenue(options) {
  var all = listOpportunities({ includeArchived: false, status: 'open' });
  var options_ = options || {};

  // Forecast: weighted value of active pipeline
  var forecastValue = all.opportunities.reduce(function (s, o) {
    return s + o.expectedRevenue;
  }, 0);

  // Expected revenue from deals in Negotiation+ stages
  var lateStageDeals = all.opportunities.filter(function (o) {
    return o.stage === 'negotiation' || o.stage === 'verbalCommitment';
  });
  var lateStageValue = lateStageDeals.reduce(function (s, o) { return s + o.expectedRevenue; }, 0);

  // Best case: full value of active deals
  var bestCase = all.opportunities.reduce(function (s, o) { return s + o.estimatedValue; }, 0);

  // Most likely: weighted value
  var mostLikely = forecastValue;

  // Worst case: 50% of weighted value
  var worstCase = Math.round(forecastValue * 0.5 * 100) / 100;

  return {
    totalActiveDeals: all.total,
    totalActiveValue: all.opportunities.reduce(function (s, o) { return s + o.estimatedValue; }, 0),
    weightedPipelineValue: Math.round(forecastValue * 100) / 100,
    lateStageValue: Math.round(lateStageValue * 100) / 100,
    forecast: {
      worstCase: worstCase,
      mostLikely: Math.round(mostLikely * 100) / 100,
      bestCase: bestCase,
    },
    calculatedAt: _now(),
  };
}

/**
 * Get expected revenue (alias for forecast).
 *
 * @returns {object} Forecast data
 */
function getExpectedRevenue() {
  return calculateForecastRevenue();
}

/**
 * Get all opportunities for a specific customer.
 *
 * @param {string} customerId - Customer ID
 * @returns {object} { opportunities, total }
 */
function getCustomerOpportunities(customerId) {
  return listOpportunities({ customerId: customerId, includeArchived: false });
}

/**
 * Get opportunity health score and analysis.
 *
 * @param {string} id - Opportunity ID
 * @returns {object} Health analysis
 */
function getOpportunityHealth(id) {
  if (!id) return { error: 'Opportunity ID is required' };
  var opp = _opportunities[id];
  if (!opp) return { error: 'Opportunity not found: ' + id };

  var healthScore = 50;
  var factors = [];
  var warnings = [];

  // Factor 1: Stage progression — later stages are healthier
  var stageOrder = PIPELINE_STAGES[opp.stage] ? PIPELINE_STAGES[opp.stage].order : 0;
  var stageHealth = Math.round((stageOrder / 5) * 30); // 0-30 points
  healthScore += stageHealth;
  factors.push({ factor: 'stage_progression', score: stageHealth, stage: opp.stage });

  // Factor 2: Recency of activity
  var inactivityDays = (Date.now() - new Date(opp.lastActivity).getTime()) / 86400000;
  var activityHealth = 0;
  if (inactivityDays < 3) activityHealth = 20;
  else if (inactivityDays < 7) activityHealth = 15;
  else if (inactivityDays < 14) activityHealth = 10;
  else if (inactivityDays < 30) activityHealth = 5;
  healthScore += activityHealth;
  factors.push({ factor: 'activity_recency', score: activityHealth, daysSinceActivity: Math.round(inactivityDays) });
  if (inactivityDays > 30) warnings.push('No activity in ' + Math.round(inactivityDays) + ' days');

  // Factor 3: Value clarity
  var valueHealth = 0;
  if (opp.estimatedValue > 0) valueHealth = 10;
  healthScore += valueHealth;
  factors.push({ factor: 'value_defined', score: valueHealth });

  // Factor 4: Close date set
  var closeDateHealth = opp.expectedCloseDate ? 10 : 0;
  healthScore += closeDateHealth;
  factors.push({ factor: 'close_date_set', score: closeDateHealth });
  if (!opp.expectedCloseDate) warnings.push('No expected close date set');

  // Factor 5: Owner assigned
  var ownerHealth = opp.owner ? 10 : 0;
  healthScore += ownerHealth;
  factors.push({ factor: 'owner_assigned', score: ownerHealth });
  if (!opp.owner) warnings.push('No owner assigned to this opportunity');

  healthScore = Math.max(0, Math.min(100, healthScore));

  var label = 'Fair';
  var color = 'yellow';
  if (healthScore >= 80) { label = 'Excellent'; color = 'green'; }
  else if (healthScore >= 60) { label = 'Good'; color = 'teal'; }
  else if (healthScore >= 40) { label = 'Fair'; color = 'yellow'; }
  else { label = 'At Risk'; color = 'red'; }

  return {
    opportunityId: id,
    healthScore: healthScore,
    healthLabel: label,
    color: color,
    factors: factors,
    warnings: warnings,
    calculatedAt: _now(),
  };
}

/**
 * Get the priority queue — active opportunities sorted by a weighted score.
 *
 * @param {object} [filters] - Optional filters
 * @param {number} [filters.limit=20] - Max results
 * @returns {object} { queue, total }
 */
function getPriorityQueue(filters) {
  var all = listOpportunities({ includeArchived: false, status: 'open' });
  var limit = (filters && filters.limit) ? filters.limit : 20;

  var scored = all.opportunities.map(function (opp) {
    // Priority score = (estimatedValue weight * 0.4) + (stage weight * 0.3) + (recency weight * 0.2) + (priority weight * 0.1)
    var maxValue = all.opportunities.reduce(function (max, o) { return Math.max(max, o.estimatedValue); }, 1);
    var valueScore = maxValue > 0 ? (opp.estimatedValue / maxValue) * 40 : 0;

    var stageScore = (PIPELINE_STAGES[opp.stage] ? PIPELINE_STAGES[opp.stage].order : 0) * 6; // 0-30

    var inactivityDays = (Date.now() - new Date(opp.lastActivity).getTime()) / 86400000;
    var recencyScore = Math.max(0, 20 - Math.min(20, inactivityDays));

    var priorityScore = opp.priorityWeight * 2; // 2-10

    var totalScore = Math.round(valueScore + stageScore + recencyScore + priorityScore);

    return {
      id: opp.id,
      title: opp.title,
      customerId: opp.customerId,
      stage: opp.stage,
      stageDisplayName: opp.stageDisplayName,
      priority: opp.priority,
      estimatedValue: opp.estimatedValue,
      expectedRevenue: opp.expectedRevenue,
      owner: opp.owner,
      lastActivity: opp.lastActivity,
      priorityScore: totalScore,
      factors: {
        valueScore: Math.round(valueScore),
        stageScore: Math.round(stageScore),
        recencyScore: Math.round(recencyScore),
        priorityScore: Math.round(priorityScore),
      },
    };
  });

  scored.sort(function (a, b) {
    return b.priorityScore - a.priorityScore;
  });

  var total = scored.length;
  scored = scored.slice(0, limit);

  return {
    queue: scored,
    total: total,
  };
}

// ── Stage Definitions ──

/**
 * Get all pipeline stage definitions.
 *
 * @returns {object[]}
 */
function getPipelineStages() {
  return Object.keys(PIPELINE_STAGES).map(function (k) {
    return {
      id: PIPELINE_STAGES[k].id,
      displayName: PIPELINE_STAGES[k].displayName,
      order: PIPELINE_STAGES[k].order,
      baseProbability: PIPELINE_STAGES[k].baseProbability,
      category: PIPELINE_STAGES[k].category,
    };
  });
}

// ── Module Exports ──

module.exports = {
  // Lifecycle
  init: init,

  // Core CRUD
  createOpportunity: createOpportunity,
  updateOpportunity: updateOpportunity,
  getOpportunity: getOpportunity,
  listOpportunities: listOpportunities,
  archiveOpportunity: archiveOpportunity,
  restoreOpportunity: restoreOpportunity,
  searchOpportunities: searchOpportunities,

  // Pipeline
  updateOpportunityStage: updateOpportunityStage,
  calculateWinProbability: calculateWinProbability,
  calculateForecastRevenue: calculateForecastRevenue,
  getPipeline: getPipeline,
  getPipelineMetrics: getPipelineMetrics,
  getStageTotals: getStageTotals,
  getExpectedRevenue: getExpectedRevenue,
  getCustomerOpportunities: getCustomerOpportunities,
  getOpportunityHealth: getOpportunityHealth,
  getPriorityQueue: getPriorityQueue,

  // Stage definitions
  getPipelineStages: getPipelineStages,

  // Constants
  PIPELINE_STAGES: PIPELINE_STAGES,
  PRIORITY_LEVELS: PRIORITY_LEVELS,
};