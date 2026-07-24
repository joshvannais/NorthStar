/**
 * Polaris Context Builder — Unified Intelligence Context for Polaris
 *
 * Gathers every Mission 16 intelligence module into one complete context object
 * that Polaris consumes for every response.
 *
 * Architecture:
 *   dataLoader.js ───→ Business Profile ──→ Business Intelligence Engine
 *        │                                            ↓
 *        │                                 Executive Decision Engine
 *        │                                            ↓
 *        │                              Customer Intelligence Engine
 *        │                                            ↓
 *        └──→ business.js (pure formatters) ←── Pre-computed Intelligence
 *                            ↓
 *              Polaris Context Builder  ← YOU ARE HERE (SINGLE orchestrator)
 *                            ↓
 *              Polaris Response Builder → Polaris Chat
 *
 * REFACTORED (M16.5): Direct data loading via dataLoader. All intelligence
 * computation happens here — NO redundant calls across modules.
 *
 * READ-ONLY: No edits, no mutations, no writes, no database updates.
 */
'use strict';

const dataLoader = require('./dataLoader');
const businessProfile = require('./businessProfile');
const businessContext = require('../context/business');
const intelligence = require('./intelligence');
const decisionEngine = require('./decisionEngine');
const customerIntelligence = require('./customerIntelligence');

const VERSION = '1.0.0';
const CONTEXT_VERSION = '1.0.0';

/**
 * Build the complete unified Polaris context.
 *
 * This is the SINGLE orchestration point for all intelligence computation.
 * business.js is only called for text/JSON formatting after computation.
 *
 * @param {Object} [options]
 * @param {string} [options.page] - Current page (dashboard, polaris, leads, etc.)
 * @param {string} [options.leadId] - Active lead ID for customer intelligence
 * @param {string} [options.userMessage] - The user's message
 * @param {string} [options.correlationId] - Request correlation ID for tracing
 * @returns {Object} Complete unified context object
 */
function buildPolarisContext(options) {
  const opts = options || {};
  const page = opts.page || 'dashboard';
  const leadId = opts.leadId || null;
  const userMessage = opts.userMessage || '';
  const correlationId = opts.correlationId || 'unknown';

  const now = new Date().toISOString();

  // ── 1. Business Profile ──
  let profile;
  try {
    console.time(`[polaris:${correlationId}] businessProfile.getProfile`);
    profile = businessProfile.getProfile();
    console.timeEnd(`[polaris:${correlationId}] businessProfile.getProfile`);
  } catch (err) {
    console.error(`[polaris:${correlationId}] businessProfile.getProfile FAILED:`, err.message);
    profile = { company: {}, crew: {}, financial: {}, scheduling: {}, serviceArea: {}, routing: {}, polaris: {} };
  }

  // ── 2. Load raw data ──
  let data;
  try {
    console.time(`[polaris:${correlationId}] dataLoader.loadData`);
    data = dataLoader.loadCanonicalData(opts.sessionId || null);
    console.timeEnd(`[polaris:${correlationId}] dataLoader.loadData`);
  } catch (err) {
    console.error(`[polaris:${correlationId}] dataLoader.loadData FAILED:`, err.message);
    data = { leads: [], customers: [], events: [], estimates: [], jobs: [], metrics: {}, recommendations: [], crews: [] };
  }

  // ── 3. Business Intelligence (aggregate) ──
  let agg;
  try {
    console.time(`[polaris:${correlationId}] intelligence.calculateAggregateIntelligence`);
    agg = intelligence.calculateAggregateIntelligence(data.leads);
    console.timeEnd(`[polaris:${correlationId}] intelligence.calculateAggregateIntelligence`);
  } catch (err) {
    console.error(`[polaris:${correlationId}] intelligence.calculateAggregateIntelligence FAILED:`, err.message);
    agg = { totalLeads: 0, totalPipelineValue: 0, totalEstimatedLabor: 0, totalEstimatedProfit: 0, averageProfitMargin: '0.0%', averageConfidence: 0, totalTravelMinutes: 0, totalProductionHours: 0, highestValueJob: null, highestProfitJob: null, mostEfficientJob: null };
  }

  // ── 4. Executive Decisions ──
  let briefing;
  try {
    console.time(`[polaris:${correlationId}] decisionEngine.generateExecutiveBriefing`);
    briefing = decisionEngine.generateExecutiveBriefing(data.leads);
    console.timeEnd(`[polaris:${correlationId}] decisionEngine.generateExecutiveBriefing`);
  } catch (err) {
    console.error(`[polaris:${correlationId}] decisionEngine.generateExecutiveBriefing FAILED:`, err.message);
    briefing = { summary: { status: 'Error', totalLeads: 0 }, priorities: [], alerts: [], topRecommendation: null };
  }

  let ranked = [];
  try {
    console.time(`[polaris:${correlationId}] decisionEngine.rankAllOpportunities`);
    const rankResult = decisionEngine.rankAllOpportunities(data.leads);
    ranked = rankResult.ranked || [];
    console.timeEnd(`[polaris:${correlationId}] decisionEngine.rankAllOpportunities`);
  } catch (err) {
    console.error(`[polaris:${correlationId}] decisionEngine.rankAllOpportunities FAILED:`, err.message);
  }

  // ── 5. Per-lead intelligence map (for business.js) ──
  let allIntel = [];
  try {
    console.time(`[polaris:${correlationId}] intelligence.calculateAllJobIntelligence`);
    allIntel = intelligence.calculateAllJobIntelligence(data.leads);
    console.timeEnd(`[polaris:${correlationId}] intelligence.calculateAllJobIntelligence`);
  } catch (err) {
    console.error(`[polaris:${correlationId}] intelligence.calculateAllJobIntelligence FAILED:`, err.message);
  }

  const leadIntelMap = {};
  allIntel.forEach(i => { leadIntelMap[i.leadId] = i; });

  // ── 6. Active lead intelligence ──
  let activeLeadIntel = null;
  let activeLeadDecision = null;
  let activeLeadAction = null;
  let activeLeadCustomerIntel = null;
  let activeCustomerIntel = null;

  if (leadId) {
    const lead = data.leads.find(l => l.id === leadId);
    if (lead) {
      try {
        console.time(`[polaris:${correlationId}] activeLead.intelligence`);
        activeLeadIntel = intelligence.calculateJobIntelligence(lead, { leadCount: data.leads.length });
        activeLeadDecision = decisionEngine.rankOpportunity(lead, activeLeadIntel, { totalLeads: data.leads.length });
        activeLeadAction = decisionEngine.getNextBestAction(lead, activeLeadDecision);
        console.timeEnd(`[polaris:${correlationId}] activeLead.intelligence`);
      } catch (err) {
        console.error(`[polaris:${correlationId}] activeLead.intelligence FAILED:`, err.message);
      }

      try {
        console.time(`[polaris:${correlationId}] customerIntelligence.generateCustomerSnapshot`);
        activeLeadCustomerIntel = customerIntelligence.generateCustomerSnapshot(lead, {
          totalLeads: data.leads.length,
        });
        activeCustomerIntel = activeLeadCustomerIntel;
        console.timeEnd(`[polaris:${correlationId}] customerIntelligence.generateCustomerSnapshot`);
      } catch (err) {
        console.error(`[polaris:${correlationId}] customerIntelligence.generateCustomerSnapshot FAILED:`, err.message);
      }
    }
  }

  // ── 7. Dashboard Intelligence ──
  let dashIntel;
  try {
    console.time(`[polaris:${correlationId}] customerIntelligence.generateDashboardCustomerIntelligence`);
    dashIntel = customerIntelligence.generateDashboardCustomerIntelligence(data.leads);
    console.timeEnd(`[polaris:${correlationId}] customerIntelligence.generateDashboardCustomerIntelligence`);
  } catch (err) {
    console.error(`[polaris:${correlationId}] customerIntelligence.generateDashboardCustomerIntelligence FAILED:`, err.message);
    dashIntel = { highestOpportunity: [], highestRisk: [], highestProfit: [], bestFollowUps: [], fastestRevenue: [], longestWaiting: [], lowestConfidence: [], highestMargin: [] };
  }

  // ── 8. Build computed data for business.js formatters ──
  const computed = {
    aggregateIntel: agg,
    briefing,
    ranked,
    leadIntelMap,
    activeLeadIntel,
    activeLeadDecision,
    activeLeadAction,
    activeLeadCustomerIntel,
    dashboardIntel: dashIntel,
  };

  // ── 9. Business Context (text + compact) — pure formatting ──
  const pageContext = { page, leadId };
  console.time(`[polaris:${correlationId}] businessContext.buildBusinessContext`);
  const contextText = businessContext.buildBusinessContext(pageContext, computed, data);
  console.timeEnd(`[polaris:${correlationId}] businessContext.buildBusinessContext`);

  console.time(`[polaris:${correlationId}] businessContext.buildCompactContext`);
  const compactContext = businessContext.buildCompactContext(pageContext, computed, data);
  console.timeEnd(`[polaris:${correlationId}] businessContext.buildCompactContext`);

  // ── 10. Build unified context ──
  const unifiedContext = {
    // Metadata
    _meta: {
      generatedAt: now,
      contextVersion: CONTEXT_VERSION,
      intelligenceVersion: VERSION,
      decisionVersion: VERSION,
      customerIntelligenceVersion: VERSION,
      businessProfileVersion: VERSION,
      readOnly: true,
      correlationId,
    },

    // Request context
    request: {
      page,
      leadId,
      message: userMessage,
      timestamp: now,
      correlationId,
    },

    // Business Profile
    businessProfile: {
      company: profile.company,
      headquarters: profile.headquarters,
      serviceArea: profile.serviceArea,
      routing: profile.routing,
      hours: profile.hours,
      crew: profile.crew,
      vehicles: profile.vehicles,
      services: profile.services,
      financial: profile.financial,
      scheduling: profile.scheduling,
      polaris: profile.polaris,
      retell: profile.retell,
      notifications: profile.notifications,
    },

    // Business Context (text for system prompt embedding)
    contextText,

    // Business Intelligence
    businessIntelligence: {
      aggregate: agg,
      totalLeads: agg.totalLeads,
      totalPipelineValue: agg.totalPipelineValue,
      totalEstimatedLabor: agg.totalEstimatedLabor,
      totalEstimatedProfit: agg.totalEstimatedProfit,
      averageProfitMargin: agg.averageProfitMargin,
      averageConfidence: agg.averageConfidence,
      totalTravelMinutes: agg.totalTravelMinutes,
      totalProductionHours: agg.totalProductionHours,
      highestValueJob: agg.highestValueJob,
      highestProfitJob: agg.highestProfitJob,
      mostEfficientJob: agg.mostEfficientJob,
    },

    // Executive Decisions
    executiveDecisions: {
      topPriority: briefing.topRecommendation,
      summary: briefing.summary,
      alerts: briefing.alerts,
      priorityRanking: ranked.slice(0, 10),
      topFollowUps: briefing.priorities?.topFollowUps || [],
      revenueAtRisk: briefing.summary?.revenueAtRisk || 0,
      followUpsOverdue: briefing.summary?.followUpsOverdue || 0,
    },

    // Customer Intelligence (active lead only)
    customerIntelligence: activeCustomerIntel,

    // Dashboard Intelligence
    dashboardIntelligence: dashIntel,

    // Compact context (for API consumers)
    compactContext,
  };

  return unifiedContext;
}

module.exports = {
  buildPolarisContext,
  VERSION,
};
