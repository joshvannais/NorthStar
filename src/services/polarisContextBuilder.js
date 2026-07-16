/**
 * Polaris Context Builder — Unified Intelligence Context for Polaris
 *
 * Gathers every Mission 16 intelligence module into one complete context object
 * that Polaris consumes for every response.
 *
 * Architecture:
 *   Business Profile → Business Context → Business Intelligence Engine
 *                                             ↓
 *                                  Executive Decision Engine
 *                                             ↓
 *                               Customer Intelligence Engine
 *                                             ↓
 *                             Polaris Context Builder  ← YOU ARE HERE
 *                                             ↓
 *                             Polaris Response Builder → Polaris Chat
 *
 * READ-ONLY: No edits, no mutations, no writes, no database updates.
 */
'use strict';

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
 * @param {Object} [options]
 * @param {string} [options.page] - Current page (dashboard, polaris, leads, etc.)
 * @param {string} [options.leadId] - Active lead ID for customer intelligence
 * @param {string} [options.userMessage] - The user's message
 * @returns {Object} Complete unified context object
 */
function buildPolarisContext(options) {
  const opts = options || {};
  const page = opts.page || 'dashboard';
  const leadId = opts.leadId || null;
  const userMessage = opts.userMessage || '';

  const now = new Date().toISOString();

  // ── 1. Business Profile ──
  const profile = businessProfile.getProfile();

  // ── 2. Business Context (text + compact) ──
  const pageContext = { page, leadId };
  const contextText = businessContext.buildBusinessContext(pageContext);
  const compactContext = businessContext.buildCompactContext(pageContext);

  // ── 3. Business Intelligence (aggregate) ──
  // Load leads from the compact context
  const leads = compactContext.leads || [];
  const agg = intelligence.calculateAggregateIntelligence(leads);

  // ── 4. Executive Decisions ──
  const briefing = decisionEngine.generateExecutiveBriefing(leads);
  const { ranked } = decisionEngine.rankAllOpportunities(leads);

  // ── 5. Customer Intelligence (if active lead) ──
  let activeCustomerIntel = null;
  if (leadId) {
    const lead = leads.find(l => l.id === leadId);
    if (lead) {
      activeCustomerIntel = customerIntelligence.generateCustomerSnapshot(lead, {
        totalLeads: leads.length,
      });
    }
  }

  // ── 6. Dashboard Intelligence ──
  const dashIntel = customerIntelligence.generateDashboardCustomerIntelligence(leads);

  // ── 7. Build unified context ──
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
    },

    // Request context
    request: {
      page,
      leadId,
      message: userMessage,
      timestamp: now,
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