/**
 * Business Context Module — Read-Only Data Layer for Polaris
 *
 * Provides structured, read-only access to NorthStar's live business data.
 * All operations are informational only — no edits, no mutations.
 *
 * REFACTORED (M16.5): Pure text/JSON formatters. All intelligence computation
 * happens in polarisContextBuilder.js. Data loading via dataLoader.js.
 */
'use strict';

const dataLoader = require('../services/dataLoader');

/**
 * Build a structured business context summary for Polaris.
 * Returns a plain-text summary that can be injected into the system prompt.
 *
 * @param {Object} pageContext - { page, leadId }
 * @param {Object} [computed] - Pre-computed intelligence
 * @param {Object} [computed.aggregateIntel] - From intelligence.calculateAggregateIntelligence()
 * @param {Object} [computed.briefing] - From decisionEngine.generateExecutiveBriefing()
 * @param {Array}  [computed.ranked] - From decisionEngine.rankAllOpportunities().ranked
 * @param {Object} [computed.leadIntelMap] - Map of leadId → intelligence result
 * @returns {string} Formatted business context text
 */
function buildBusinessContext(pageContext, computed) {
  const data = dataLoader.loadData();
  const parts = [];

  // ── Business Overview ──
  const totalLeads = data.leads.length;
  const totalCustomers = data.customers.length;
  const totalEvents = data.events.length;
  const totalEstimates = data.estimates.length;
  const totalJobs = data.jobs.length;

  parts.push('=== NORTHSTAR BUSINESS CONTEXT (Read-Only) ===');

  // ── Pipeline Health ──
  if (data.leads.length > 0) {
    const outcomeCounts = {};
    let totalPipelineValue = 0;
    let valueCount = 0;
    data.leads.forEach(l => {
      const o = l.outcome || 'unknown';
      outcomeCounts[o] = (outcomeCounts[o] || 0) + 1;
      if (l.avgPrice) {
        totalPipelineValue += l.avgPrice;
        valueCount++;
      }
    });
    const avgValue = valueCount > 0 ? Math.round(totalPipelineValue / valueCount) : 0;

    parts.push(`\n── Pipeline Health ──`);
    parts.push(`Total leads: ${totalLeads}`);
    parts.push(`Estimated pipeline value: $${totalPipelineValue.toLocaleString()}`);
    parts.push(`Average lead value: $${avgValue}`);
    parts.push(`Lead outcomes: ${Object.entries(outcomeCounts).map(([k, v]) => `${k}(${v})`).join(', ')}`);

    // Leads needing immediate attention (follow-up or appointment-set)
    const needsAttention = data.leads.filter(l => l.outcome === 'follow-up');
    if (needsAttention.length > 0) {
      parts.push(`\nLeads needing follow-up: ${needsAttention.length}`);
      needsAttention.slice(0, 5).forEach(l => {
        parts.push(`  - ${l.caller} | ${l.service} | $${l.avgPrice} | Phone: ${l.phone}`);
      });
    }

    const appointments = data.leads.filter(l => l.outcome === 'appointment-set');
    if (appointments.length > 0) {
      parts.push(`\nAppointments set: ${appointments.length}`);
      appointments.slice(0, 3).forEach(l => {
        parts.push(`  - ${l.caller} | ${l.service} | ${l.address || 'No address'}`);
      });
    }
  }

  // ── Customer Overview ──
  if (data.customers.length > 0) {
    parts.push(`\n── Customers ──`);
    parts.push(`Total customers: ${totalCustomers}`);
    data.customers.slice(0, 5).forEach(c => {
      parts.push(`  - ${c.name || c.caller || 'Unknown'} | ${c.email || c.phone || 'No contact'}`);
    });
  }

  // ── Calendar / Events ──
  if (data.events.length > 0) {
    parts.push(`\n── Calendar ──`);
    parts.push(`Upcoming events: ${totalEvents}`);
    data.events.slice(0, 5).forEach(e => {
      parts.push(`  - ${e.title || e.service || 'Event'} | ${e.date || e.start || ''}`);
    });
  } else {
    parts.push(`\n── Calendar ──`);
    parts.push(`No upcoming events scheduled.`);
  }

  // ── Active Recommendations ──
  if (data.recommendations.length > 0) {
    const unresolved = data.recommendations.filter(r => !r.resolved);
    parts.push(`\n── Recommendations (${unresolved.length} active) ──`);
    unresolved.slice(0, 5).forEach(r => {
      const name = r.data && (r.data.name || r.data.caller) ? ` (${r.data.name || r.data.caller})` : '';
      parts.push(`  [${r.priority}] ${r.type}${name}: ${r.data?.email || r.data?.service || 'Review needed'}`);
    });
  }

  // ── Customer Context (if specific lead is active) ──
  if (pageContext && pageContext.leadId) {
    const lead = data.leads.find(l => l.id === pageContext.leadId);
    if (lead) {
      parts.push(`\n── Active Customer Context ──`);
      parts.push(`Currently viewing: ${lead.caller}`);
      parts.push(`Service: ${lead.service} | Address: ${lead.address || 'N/A'}`);
      parts.push(`Phone: ${lead.phone} | Average price: $${lead.avgPrice}`);
      parts.push(`Status: ${lead.status} | Outcome: ${lead.outcome || 'Pending'}`);
      parts.push(`Job detail: ${lead.jobDetail || 'N/A'}`);
      if (lead.summary) parts.push(`Summary: ${lead.summary}`);
    }
  }

  // ── Page Context ──
  if (pageContext && pageContext.page) {
    parts.push(`\n── Active Page ──`);
    parts.push(`The user is currently viewing: ${pageContext.page}`);
    if (pageContext.page === 'dashboard') {
      parts.push('They are looking at the overall business dashboard with KPIs and summaries.');
    } else if (pageContext.page === 'leads') {
      parts.push('They are viewing the leads/CRM list.');
    } else if (pageContext.page === 'communications') {
      parts.push('They are in the communications/inbox section.');
    } else if (pageContext.page === 'calendar') {
      parts.push('They are viewing the calendar/schedule.');
    } else if (pageContext.page === 'polaris') {
      parts.push('They are in the Polaris intelligence workspace.');
    }
  }

  // ── Calculated Intelligence (from pre-computed data) ──
  const agg = computed && computed.aggregateIntel;
  if (agg && agg.totalLeads > 0) {
    parts.push(`\n── Calculated Intelligence ──`);
    parts.push(`Total estimated labor cost: ${agg.totalEstimatedLabor.toLocaleString()}`);
    parts.push(`Total estimated profit: ${agg.totalEstimatedProfit.toLocaleString()}`);
    parts.push(`Average profit margin: ${agg.averageProfitMargin}`);
    parts.push(`Average confidence score: ${agg.averageConfidence}%`);
    parts.push(`Total travel time: ${agg.totalTravelMinutes} minutes`);
    parts.push(`Total production hours: ${agg.totalProductionHours} hours`);
    if (agg.highestValueJob) {
      parts.push(`Highest value job: ${agg.highestValueJob.caller} | ${agg.highestValueJob.revenue}`);
    }
    if (agg.highestProfitJob) {
      parts.push(`Highest profit job: ${agg.highestProfitJob.caller} | ${agg.highestProfitJob.profit.estimated}`);
    }
    if (agg.mostEfficientJob) {
      parts.push(`Most efficient job: ${agg.mostEfficientJob.caller} | ${agg.mostEfficientJob.profitPerLaborHour}/hr`);
    }
  }

  // ── Executive Decisions (from pre-computed data) ──
  const briefing = computed && computed.briefing;
  if (briefing && briefing.summary && briefing.summary.totalLeads > 0) {
    const alerts = briefing.alerts || [];

    parts.push(`\n── Executive Decisions ──`);
    parts.push(`Top priority: ${briefing.topRecommendation?.caller || 'None'} (Priority Score: ${briefing.topRecommendation?.priorityScore || 'N/A'}/100)`);
    parts.push(`Action: ${briefing.topRecommendation?.nextAction?.action || 'N/A'}`);
    parts.push(`Business impact: ${briefing.topRecommendation?.businessImpact || 'Unknown'}`);

    // Alerts
    const criticalAlerts = alerts.filter(a => a.severity === 'critical');
    if (criticalAlerts.length > 0) {
      parts.push(`\nCritical alerts:`);
      criticalAlerts.forEach(a => parts.push(`  ⚠ ${a.title}`));
    }
    const warningAlerts = alerts.filter(a => a.severity === 'warning');
    if (warningAlerts.length > 0) {
      parts.push(`\nWarnings:`);
      warningAlerts.forEach(a => parts.push(`  • ${a.title}`));
    }

    // Top 5 ranked leads
    const ranked = computed && computed.ranked;
    if (ranked && ranked.length > 0) {
      parts.push(`\nPriority ranking (top 5):`);
      ranked.slice(0, 5).forEach(r => {
        parts.push(`  ${r.priorityScore}/100 [${r.priorityLabel}] ${r.caller} — ${r.service}`);
      });
    }
  }

  parts.push('\n=== END CONTEXT ===\n');
  return parts.join('\n');
}

/**
 * Build a compact JSON context object for embedding in prompts.
 * Pure data formatter — all intelligence comes from computed parameter.
 *
 * @param {Object} pageContext - { page, leadId }
 * @param {Object} [computed] - Pre-computed intelligence
 * @param {Object} [computed.aggregateIntel] - Aggregate intelligence
 * @param {Object} [computed.briefing] - Executive briefing
 * @param {Array}  [computed.ranked] - Ranked opportunities
 * @param {Object} [computed.leadIntelMap] - Map of leadId → intelligence
 * @param {Object} [computed.activeLeadIntel] - Active lead intelligence
 * @param {Object} [computed.activeLeadDecision] - Active lead decision ranking
 * @param {Object} [computed.activeLeadAction] - Active lead next action
 * @param {Object} [computed.activeLeadCustomerIntel] - Active lead customer snapshot
 * @param {Object} [computed.dashboardIntel] - Dashboard customer intelligence
 * @returns {Object} Compact context JSON
 */
function buildCompactContext(pageContext, computed) {
  const data = dataLoader.loadData();
  const context = {
    overview: {
      totalLeads: data.leads.length,
      totalCustomers: data.customers.length,
      totalEvents: data.events.length,
      totalJobs: data.estimates.length,
    },
    leads: data.leads.map(l => ({
      id: l.id,
      caller: l.caller,
      phone: l.phone,
      address: l.address,
      service: l.service,
      avgPrice: l.avgPrice,
      status: l.status,
      outcome: l.outcome || 'pending',
      receivedAt: l.receivedAt,
      jobDetail: l.jobDetail,
      summary: l.summary,
      icon: l.icon,
    })),
    recommendations: data.recommendations.filter(r => !r.resolved).map(r => ({
      id: r.id,
      priority: r.priority,
      type: r.type,
      customerName: r.data?.name || null,
      email: r.data?.email || null,
    })),
    pageContext: pageContext || {},
  };

  // Calculate derived metrics
  const pipelineValue = data.leads.reduce((sum, l) => sum + (l.avgPrice || 0), 0);
  const needsFollowUp = data.leads.filter(l => l.outcome === 'follow-up').length;
  const appointmentsSet = data.leads.filter(l => l.outcome === 'appointment-set').length;

  context.metrics = {
    pipelineValue,
    needsFollowUp,
    appointmentsSet,
    avgLeadValue: data.leads.length > 0 ? Math.round(pipelineValue / data.leads.length) : 0,
  };

  // ── Calculated Intelligence (from pre-computed data) ──
  const agg = computed && computed.aggregateIntel;
  if (agg && agg.totalLeads > 0) {
    context.calculatedIntelligence = {
      totalEstimatedLabor: agg.totalEstimatedLabor,
      totalEstimatedProfit: agg.totalEstimatedProfit,
      averageProfitMargin: agg.averageProfitMargin,
      averageConfidence: agg.averageConfidence,
      totalTravelMinutes: agg.totalTravelMinutes,
      totalProductionHours: agg.totalProductionHours,
      highestValueJob: agg.highestValueJob ? {
        caller: agg.highestValueJob.caller,
        service: agg.highestValueJob.service,
        revenue: agg.highestValueJob.revenue,
        estimatedProfit: agg.highestValueJob.profit.estimated,
        profitMargin: agg.highestValueJob.profit.margin,
        confidence: agg.highestValueJob.confidence.score,
      } : null,
      highestProfitJob: agg.highestProfitJob ? {
        caller: agg.highestProfitJob.caller,
        profit: agg.highestProfitJob.profit.estimated,
        margin: agg.highestProfitJob.profit.margin,
      } : null,
      mostEfficientJob: agg.mostEfficientJob ? {
        caller: agg.mostEfficientJob.caller,
        profitPerHour: agg.mostEfficientJob.profitPerLaborHour,
      } : null,
    };
  }

  // ── Active Lead Intelligence (from pre-computed data) ──
  if (pageContext && pageContext.leadId) {
    context.activeLead = data.leads.find(l => l.id === pageContext.leadId) || null;
    context.activeLeadIntelligence = computed && computed.activeLeadIntel || null;
    context.activeLeadDecision = computed && computed.activeLeadDecision || null;
    context.activeLeadNextAction = computed && computed.activeLeadAction || null;
    context.activeLeadCustomerIntelligence = computed && computed.activeLeadCustomerIntel || null;
  }

  // ── Executive Decisions (from pre-computed data) ──
  const briefing = computed && computed.briefing;
  if (briefing && briefing.summary && briefing.summary.totalLeads > 0) {
    context.executiveDecisions = {
      topPriority: briefing.topRecommendation ? {
        caller: briefing.topRecommendation.caller,
        service: briefing.topRecommendation.service,
        priorityScore: briefing.topRecommendation.priorityScore,
        estimatedRevenue: briefing.topRecommendation.estimatedRevenue,
        estimatedProfit: briefing.topRecommendation.estimatedProfit,
        nextAction: briefing.topRecommendation.nextAction?.action,
        businessImpact: briefing.topRecommendation.businessImpact,
      } : null,
      alerts: (briefing.alerts || []).map(a => ({
        id: a.id,
        category: a.category,
        severity: a.severity,
        title: a.title,
        impact: a.impact,
      })),
      topFollowUps: (briefing.priorities?.topFollowUps || []).map(f => ({
        caller: f.caller,
        service: f.service,
        priorityScore: f.priorityScore,
        nextAction: f.nextAction,
        daysWaiting: f.daysWaiting,
      })),
      revenueAtRisk: briefing.summary?.revenueAtRisk || 0,
      followUpsOverdue: briefing.summary?.followUpsOverdue || 0,
    };
  }

  // ── Dashboard Customer Intelligence (from pre-computed data) ──
  context.dashboardCustomerIntelligence = computed && computed.dashboardIntel || null;

  return context;
}

module.exports = {
  buildBusinessContext,
  buildCompactContext,
};
