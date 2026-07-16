/**
 * Executive Decision Engine — NorthStar's Central Decision & Recommendation Layer
 *
 * Consumes ONLY the Business Intelligence Engine (src/services/intelligence.js).
 * Never duplicates calculations.
 *
 * Architecture:
 *   Business Data → Business Context → Business Intelligence Engine
 *                                              ↓
 *                                   Executive Decision Engine  ← YOU ARE HERE
 *                                              ↓
 *                              Polaris | Dashboard | Customer Cards | Scheduling | Retell | Future AI
 *
 * This is the SINGLE source of business recommendations.
 * Mission 17, 18, 19, 20 must EXTEND this engine, never replace or duplicate it.
 *
 * READ-ONLY: No edits, no mutations, no writes, no database updates.
 * Recommendations only — never executes actions.
 */
'use strict';

const intelligence = require('./intelligence');

// ====================================================================
// Constants & Weights
// ====================================================================

/** Priority scoring weights — each factor contributes to the 0-100 priority score */
const PRIORITY_WEIGHTS = {
  estimatedProfit: 0.30,    // 30% — Highest profit = higher priority
  closeProbability: 0.25,   // 25% — More likely to close = higher priority
  confidenceScore: 0.15,    // 15% — Higher confidence = more certain
  leadAgeUrgency: 0.10,     // 10% — Older untouched leads need attention
  travelEfficiency: 0.10,   // 10% — Lower travel cost = more efficient
  productionTime: 0.05,     // 5%  — Quicker jobs = faster revenue
  customerHistory: 0.05,    // 5%  — Existing customers = warmer
};

/**
 * Estimated close probability by lead outcome.
 * Derived from typical contractor lead conversion patterns.
 */
const CLOSE_PROBABILITY_MAP = {
  'appointment-set': 0.80,   // 80% — Already scheduled, strong intent
  'follow-up': 0.55,          // 55% — Needs nurturing, moderate intent
  'lead-captured': 0.35,      // 35% — Fresh capture, needs qualification
  'no-interest': 0.05,        // 5%  — Expressed disinterest
};

const DEFAULT_CLOSE_PROBABILITY = 0.30;

/** Urgency thresholds for lead age (in days) — calibrated for contractor response times */
const URGENCY_THRESHOLDS = {
  critical: 3,       // 3+ days untouched → critical (close window closing)
  high: 2,           // 2 days → high urgency
  medium: 1,         // 1 day → moderate urgency
  low: 0.5,           // Half day → early prompt
};

/** Outcome-based exclusion: leads with these outcomes are excluded from active ranking */
const EXCLUDED_OUTCOMES = ['no-interest'];

/** Next best action mapping by lead outcome */
const NEXT_BEST_ACTION_MAP = {
  'appointment-set': {
    action: 'Confirm appointment & send proposal',
    reason: 'Appointment already scheduled. Verify details, send proposal/materials list, and confirm day-before reminder.',
    priority: 'high',
  },
  'follow-up': {
    action: 'Call customer to follow up',
    reason: 'Customer expressed interest but has not committed. Prompt follow-up increases close likelihood.',
    priority: 'high',
  },
  'lead-captured': {
    action: 'Schedule consultation or estimate visit',
    reason: 'Lead captured but not yet qualified. Schedule a site visit or call to scope the job.',
    priority: 'medium',
  },
  'no-interest': {
    action: 'Archive — no current interest',
    reason: 'Customer indicated no interest. Archive to free pipeline focus.',
    priority: 'low',
  },
};

const DEFAULT_NEXT_BEST_ACTION = {
  action: 'Contact to qualify lead',
  reason: 'Lead outcome undetermined. Contact customer to understand their needs and schedule a consultation.',
  priority: 'medium',
};

// ====================================================================
// Module 1: Opportunity Ranking
// ====================================================================

/**
 * Rank a single lead with a comprehensive priority score (0-100).
 * Consumes intelligence engine results — never duplicates calculations.
 *
 * Factors weighted:
 *   Estimated Profit (30%) + Close Probability (25%) +
 *   Confidence Score (15%) + Lead Age Urgency (10%) +
 *   Travel Efficiency (10%) + Production Time (5%) +
 *   Customer History (5%)
 *
 * @param {Object} lead - Raw lead object from leads.json
 * @param {Object} leadIntelligence - Pre-computed intelligence (from calculateJobIntelligence)
 * @param {Object} [options]
 * @param {number} [options.now] - Current timestamp for age calculations
 * @param {number} [options.totalLeads] - Total leads in system (for cross-referencing)
 * @returns {Object} Opportunity ranking with priority score, breakdown, and label
 */
function rankOpportunity(lead, leadIntelligence, options) {
  if (!lead || !leadIntelligence) return null;

  const opts = options || {};
  const now = opts.now || Date.now();
  const totalLeads = opts.totalLeads || 1;

  // ── Factor: Estimated Profit (0-100) ──
  const profit = leadIntelligence.profit?.estimated || 0;
  // Scale: profit up to $10K → score 0-100
  const profitScore = Math.min(100, (profit / 10000) * 100);

  // ── Factor: Close Probability (0-100) ──
  const outcome = lead.outcome || '';
  const closeProb = CLOSE_PROBABILITY_MAP[outcome] ?? DEFAULT_CLOSE_PROBABILITY;
  const closeScore = closeProb * 100;

  // ── Factor: Confidence Score (0-100) ──
  const confidenceScore = leadIntelligence.confidence?.score || 50;

  // ── Factor: Lead Age Urgency (0-100) ──
  let ageUrgencyScore = 0;
  if (lead.receivedAt) {
    const receivedTime = new Date(lead.receivedAt).getTime();
    const ageDays = (now - receivedTime) / (1000 * 60 * 60 * 24);
    if (ageDays >= URGENCY_THRESHOLDS.critical) {
      ageUrgencyScore = 100;  // Critical urgency
    } else if (ageDays >= URGENCY_THRESHOLDS.high) {
      ageUrgencyScore = 75;   // High urgency
    } else if (ageDays >= URGENCY_THRESHOLDS.medium) {
      ageUrgencyScore = 50;   // Medium urgency
    } else if (ageDays >= URGENCY_THRESHOLDS.low) {
      ageUrgencyScore = 25;   // Low urgency
    }
    // Fresh leads (< 1 day) get 0 — not urgent yet
  }

  // ── Factor: Travel Efficiency (0-100) ──
  const travelMinutes = leadIntelligence.travel?.minutes || 18;
  // Lower travel = higher score: 0 min = 100, 60 min = 0
  const travelScore = Math.max(0, 100 - (travelMinutes / 60) * 100);

  // ── Factor: Production Time (0-100) ──
  const prodHours = leadIntelligence.estimatedDuration?.hours || 3;
  // Shorter jobs score higher: 1hr = 100, 8hr+ = 0
  const prodScore = Math.max(0, 100 - ((prodHours - 1) / 7) * 100);

  // ── Factor: Customer History (0-100) ──
  // Simplified: check if name appears multiple times in leads
  const caller = lead.caller || '';
  const historyScore = 20; // Base score for new customers
  // (Future: replace with real customer history lookup)

  // ── Weighted Priority Score ──
  const priorityScore = Math.round(
    (profitScore * PRIORITY_WEIGHTS.estimatedProfit) +
    (closeScore * PRIORITY_WEIGHTS.closeProbability) +
    (confidenceScore * PRIORITY_WEIGHTS.confidenceScore) +
    (ageUrgencyScore * PRIORITY_WEIGHTS.leadAgeUrgency) +
    (travelScore * PRIORITY_WEIGHTS.travelEfficiency) +
    (prodScore * PRIORITY_WEIGHTS.productionTime) +
    (historyScore * PRIORITY_WEIGHTS.customerHistory)
  );

  // Priority label
  const priorityLabel = priorityScore >= 85 ? 'Critical' :
    priorityScore >= 70 ? 'High' :
    priorityScore >= 50 ? 'Medium' :
    priorityScore >= 30 ? 'Low' : 'Minimal';

  return {
    leadId: lead.id,
    caller: lead.caller,
    service: lead.service,
    priorityScore,
    priorityLabel,
    breakdown: {
      profitScore: Math.round(profitScore),
      closeScore: Math.round(closeScore),
      confidenceScore: Math.round(confidenceScore),
      ageUrgencyScore: Math.round(ageUrgencyScore),
      travelScore: Math.round(travelScore),
      productionScore: Math.round(prodScore),
      historyScore: Math.round(historyScore),
    },
    factors: {
      estimatedProfit: profit,
      closeProbability: Math.round(closeProb * 100) + '%',
      closeProbRaw: closeProb,
      leadAgeDays: lead.receivedAt
        ? Math.round((now - new Date(lead.receivedAt).getTime()) / (1000 * 60 * 60 * 24) * 10) / 10
        : null,
      travelMinutes,
      productionHours: prodHours,
    },
  };
}

/**
 * Rank ALL leads in the dataset.
 * Returns ranked array sorted by priority score descending.
 *
 * @param {Array} leads - Array of lead objects from leads.json
 * @param {Object} [options]
 * @returns {{ ranked: Array, topOpportunity: Object, summary: Object }}
 */
function rankAllOpportunities(leads, options) {
  if (!leads || leads.length === 0) {
    return { ranked: [], topOpportunity: null, summary: null };
  }

  const opts = options || {};
  const now = opts.now || Date.now();

  // Get intelligence for all leads
  const allIntelligence = intelligence.calculateAllJobIntelligence(leads, opts);

  // Index intelligence by leadId
  const intelMap = {};
  allIntelligence.forEach(i => { intelMap[i.leadId] = i; });

  // Rank each lead (excluding dead outcomes like no-interest)
  const ranked = leads
    .filter(lead => !EXCLUDED_OUTCOMES.includes(lead.outcome || ''))
    .map(lead => {
      const intel = intelMap[lead.id] || null;
      if (!intel) return null;
      return rankOpportunity(lead, intel, { ...opts, now });
    })
    .filter(r => r !== null)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const topOpportunity = ranked[0] || null;

  const summary = ranked.length > 0 ? {
    totalRanked: ranked.length,
    criticalCount: ranked.filter(r => r.priorityLabel === 'Critical').length,
    highCount: ranked.filter(r => r.priorityLabel === 'High').length,
    mediumCount: ranked.filter(r => r.priorityLabel === 'Medium').length,
    lowCount: ranked.filter(r => r.priorityLabel === 'Low').length,
    minimalCount: ranked.filter(r => r.priorityLabel === 'Minimal').length,
    topCaller: topOpportunity?.caller || null,
    topScore: topOpportunity?.priorityScore || 0,
  } : null;

  return { ranked, topOpportunity, summary };
}

// ====================================================================
// Module 2: Next Best Action
// ====================================================================

/**
 * Determine the next best action for a lead.
 *
 * @param {Object} lead - Raw lead object
 * @param {Object} leadRanking - Result from rankOpportunity()
 * @returns {Object} Next best action with action, reason, priority
 */
function getNextBestAction(lead, leadRanking) {
  if (!lead) return null;

  const outcome = lead.outcome || '';
  const baseAction = NEXT_BEST_ACTION_MAP[outcome] || DEFAULT_NEXT_BEST_ACTION;

  // Enhance reason with urgency from ranking
  let urgencyNote = '';
  if (leadRanking) {
    const daysWaiting = leadRanking.factors?.leadAgeDays;
    if (daysWaiting !== null && daysWaiting !== undefined) {
      if (daysWaiting >= URGENCY_THRESHOLDS.critical) {
        urgencyNote = ` Customer has been waiting ${daysWaiting} days — priority is critical.`;
      } else if (daysWaiting >= URGENCY_THRESHOLDS.high) {
        urgencyNote = ` Customer has been waiting ${daysWaiting} days — respond soon.`;
      }
    }
  }

  return {
    action: baseAction.action,
    reason: baseAction.reason + urgencyNote,
    priority: baseAction.priority,
    escalationLevel: leadRanking
      ? (leadRanking.priorityScore >= 85 ? 'immediate' :
         leadRanking.priorityScore >= 70 ? 'today' :
         leadRanking.priorityScore >= 50 ? 'this-week' : 'this-month')
      : 'this-week',
  };
}

// ====================================================================
// Module 3: Executive Explanations
// ====================================================================

/**
 * Generate a human-readable explanation for a ranking decision.
 *
 * @param {Object} lead - Raw lead object
 * @param {Object} leadRanking - Result from rankOpportunity()
 * @param {Object} leadIntelligence - Result from calculateJobIntelligence()
 * @returns {{ explanation: string, bulletPoints: string[], businessImpact: string }}
 */
function generateExecutiveExplanation(lead, leadRanking, leadIntelligence) {
  if (!lead || !leadRanking) {
    return {
      explanation: 'Insufficient data to generate recommendation.',
      bulletPoints: [],
      businessImpact: 'Unknown',
    };
  }

  const bullets = [];
  const reasons = [];

  // Build reasons from highest contributing factors
  const breakdown = leadRanking.breakdown;
  const factors = [];

  if (leadIntelligence?.profit?.estimated > 0) {
    factors.push({
      label: 'Estimated profit',
      value: `$${leadIntelligence.profit.estimated}`,
      score: breakdown.profitScore,
    });
  }

  if (leadIntelligence?.confidence?.score) {
    factors.push({
      label: 'Confidence score',
      value: `${leadIntelligence.confidence.score}%`,
      score: breakdown.confidenceScore,
    });
  }

  const closeLabel = leadRanking.factors?.closeProbability || 'N/A';
  if (closeLabel !== 'N/A') {
    factors.push({
      label: 'Close likelihood',
      value: closeLabel,
      score: breakdown.closeScore,
    });
  }

  if (leadRanking.factors?.leadAgeDays !== null && leadRanking.factors?.leadAgeDays !== undefined) {
    const days = leadRanking.factors.leadAgeDays;
    if (days >= 3) {
      factors.push({
        label: 'Days waiting',
        value: `${days} days`,
        score: breakdown.ageUrgencyScore,
      });
    }
  }

  if (leadIntelligence?.travel?.minutes) {
    const mins = leadIntelligence.travel.minutes;
    if (mins <= 15) {
      factors.push({
        label: 'Travel time',
        value: `${mins} minutes`,
        score: breakdown.travelScore,
      });
    }
  }

  // Sort factors by contribution score descending, take top 4
  factors.sort((a, b) => b.score - a.score);
  const topFactors = factors.slice(0, 4);

  // Build bullet points
  topFactors.forEach(f => {
    bullets.push(`• ${f.label}: ${f.value}`);
  });

  // Build explanation
  const profitNote = leadIntelligence?.profit?.margin
    ? `profit margin of ${leadIntelligence.profit.margin}`
    : 'strong revenue potential';

  const explanation = `${lead.caller} is ranked ${leadRanking.priorityLabel.toLowerCase()} priority (score: ${leadRanking.priorityScore}/100) because of ${topFactors.length > 0 ? topFactors[0].label.toLowerCase() : 'overall opportunity'}. This job offers ${profitNote}${leadIntelligence?.estimatedDuration?.hours ? ` and requires approximately ${leadIntelligence.estimatedDuration.hours} production hours` : ''}.`;

  // Business impact
  let businessImpact = 'Low';
  if (leadIntelligence?.profit?.estimated > 5000) {
    businessImpact = 'Very High';
  } else if (leadIntelligence?.profit?.estimated > 2000) {
    businessImpact = 'High';
  } else if (leadIntelligence?.profit?.estimated > 500) {
    businessImpact = 'Medium';
  }

  return {
    explanation,
    bulletPoints: bullets,
    businessImpact,
    recommendationStrength: leadRanking.priorityScore >= 85 ? 'Strongly recommended' :
      leadRanking.priorityScore >= 70 ? 'Recommended' :
      leadRanking.priorityScore >= 50 ? 'Consider' : 'Optional',
  };
}

// ====================================================================
// Module 4: Daily Priority Engine
// ====================================================================

/**
 * Generate today's executive priorities.
 *
 * @param {Array} leads - Array of lead objects
 * @param {Object} [options]
 * @returns {Object} Daily priorities organized by category
 */
function generateDailyPriorities(leads, options) {
  if (!leads || leads.length === 0) {
    return { priorities: [], topFollowUps: [], topOpportunities: [], summary: null };
  }

  const opts = options || {};
  const now = opts.now || Date.now();

  // Get all rankings
  const { ranked, topOpportunity, summary: rankSummary } = rankAllOpportunities(leads, opts);

  // Index intelligence
  const allIntel = intelligence.calculateAllJobIntelligence(leads, opts);
  const intelMap = {};
  allIntel.forEach(i => { intelMap[i.leadId] = i; });

  // ── Top 5 Follow-ups (leads needing outreach) ──
  const followUpOutcomes = ['follow-up', 'lead-captured'];
  const topFollowUps = ranked
    .filter(r => {
      const lead = leads.find(l => l.id === r.leadId);
      return lead && followUpOutcomes.includes(lead.outcome || '');
    })
    .slice(0, 5)
    .map(r => {
      const lead = leads.find(l => l.id === r.leadId);
      const intel = intelMap[r.leadId];
      const nba = getNextBestAction(lead, r);
      return {
        caller: r.caller,
        service: r.service,
        priorityScore: r.priorityScore,
        priorityLabel: r.priorityLabel,
        nextAction: nba.action,
        daysWaiting: r.factors?.leadAgeDays || 0,
        estimatedProfit: intel?.profit?.estimated || 0,
      };
    });

  // ── Top 5 Highest Value Opportunities ──
  const topOpportunities = ranked.slice(0, 5).map(r => {
    const lead = leads.find(l => l.id === r.leadId);
    const intel = intelMap[r.leadId];
    const exp = generateExecutiveExplanation(lead, r, intel);
    return {
      caller: r.caller,
      service: r.service,
      priorityScore: r.priorityScore,
      priorityLabel: r.priorityLabel,
      estimatedRevenue: intel?.revenue || 0,
      estimatedProfit: intel?.profit?.estimated || 0,
      profitMargin: intel?.profit?.margin || '0%',
      confidenceScore: intel?.confidence?.score || 0,
      explanation: exp.explanation,
      businessImpact: exp.businessImpact,
    };
  });

  // ── Jobs at Risk (aging follow-ups not contacted) ──
  const staleThreshold = URGENCY_THRESHOLDS.high; // 3 days
  const jobsAtRisk = ranked
    .filter(r => r.factors?.leadAgeDays >= staleThreshold)
    .map(r => {
      const lead = leads.find(l => l.id === r.leadId);
      return {
        caller: r.caller,
        service: r.service,
        daysWaiting: r.factors?.leadAgeDays,
        estimatedRevenue: intelMap[r.leadId]?.revenue || 0,
        priorityScore: r.priorityScore,
      };
    });

  // ── Revenue at Risk ──
  const revenueAtRisk = jobsAtRisk.reduce((sum, j) => sum + (j.estimatedRevenue || 0), 0);

  // ── Biggest Profit Opportunity ──
  const biggestProfit = ranked.length > 0
    ? ranked.reduce((best, r) => {
        const profit = intelMap[r.leadId]?.profit?.estimated || 0;
        return profit > (best.profit || 0) ? { caller: r.caller, profit, leadId: r.leadId, service: r.service } : best;
      }, { caller: null, profit: 0, leadId: null, service: null })
    : null;

  // ── Most Efficient Jobs (highest profit per labor hour) ──
  const mostEfficient = [...allIntel]
    .sort((a, b) => (b.profitPerLaborHour || 0) - (a.profitPerLaborHour || 0))
    .slice(0, 3)
    .map(i => ({
      caller: i.caller,
      service: i.service,
      profitPerHour: i.profitPerLaborHour,
      estimatedProfit: i.profit?.estimated,
      hours: i.estimatedDuration?.hours,
    }));

  // ── Highest Confidence Estimates ──
  const highestConfidence = [...allIntel]
    .sort((a, b) => (b.confidence?.score || 0) - (a.confidence?.score || 0))
    .slice(0, 5)
    .map(i => ({
      caller: i.caller,
      service: i.service,
      confidenceScore: i.confidence?.score,
      confidenceLabel: i.confidence?.label,
      estimatedProfit: i.profit?.estimated,
    }));

  return {
    summary: {
      totalRanked: rankSummary?.totalRanked || 0,
      criticalCount: rankSummary?.criticalCount || 0,
      highCount: rankSummary?.highCount || 0,
      mediumCount: rankSummary?.mediumCount || 0,
      topPriority: topOpportunities[0] || null,
      revenueAtRisk,
      staleJobCount: jobsAtRisk.length,
    },
    topFollowUps,
    topOpportunities,
    jobsAtRisk,
    revenueAtRisk,
    biggestProfitOpportunity: biggestProfit,
    mostEfficientJobs: mostEfficient,
    highestConfidenceEstimates: highestConfidence,
  };
}

// ====================================================================
// Module 5: Executive Alerts
// ====================================================================

/**
 * Generate automated business alerts from business intelligence.
 * No manual configuration required.
 *
 * @param {Array} leads - Array of lead objects
 * @param {Object} [options]
 * @returns {Array<Object>} Array of alert objects with severity, category, message, impact
 */
function generateExecutiveAlerts(leads, options) {
  if (!leads || leads.length === 0) return [];

  const opts = options || {};
  const now = opts.now || Date.now();
  const alerts = [];

  // Get all rankings
  const { ranked } = rankAllOpportunities(leads, opts);
  const allIntel = intelligence.calculateAllJobIntelligence(leads, opts);
  const intelMap = {};
  allIntel.forEach(i => { intelMap[i.leadId] = i; });

  // ── Alert 1: Revenue Risk ──
  const staleLeads = ranked.filter(r => {
    const days = r.factors?.leadAgeDays || 0;
    const profit = intelMap[r.leadId]?.profit?.estimated || 0;
    return days >= URGENCY_THRESHOLDS.critical && profit > 0;
  });
  if (staleLeads.length > 0) {
    const atRiskRevenue = staleLeads.reduce((sum, r) => {
      return sum + (intelMap[r.leadId]?.revenue || 0);
    }, 0);
    alerts.push({
      id: 'revenue-risk',
      category: 'Revenue Risk',
      severity: staleLeads.length >= 3 ? 'critical' : 'warning',
      title: `${staleLeads.length} high-value lead${staleLeads.length > 1 ? 's' : ''} aging without contact`,
      message: `${staleLeads.length} lead${staleLeads.length > 1 ? 's have' : ' has'} been waiting ${URGENCY_THRESHOLDS.critical}+ days. Estimated revenue at risk: $${atRiskRevenue.toLocaleString()}.`,
      impact: atRiskRevenue > 5000 ? 'high' : atRiskRevenue > 2000 ? 'medium' : 'low',
      leads: staleLeads.map(r => ({ caller: r.caller, daysWaiting: r.factors?.leadAgeDays, revenue: intelMap[r.leadId]?.revenue })),
    });
  }

  // ── Alert 2: Underutilized Crew ──
  const idleJobs = leads.filter(l => l.outcome === 'lead-captured');
  if (idleJobs.length >= 3) {
    alerts.push({
      id: 'underutilized-crew',
      category: 'Crew Utilization',
      severity: 'warning',
      title: `${idleJobs.length} captured leads awaiting scheduling`,
      message: `${idleJobs.length} job${idleJobs.length > 1 ? 's are' : ' is'} ready to schedule. Estimated production capacity available.`,
      impact: 'medium',
      leadCount: idleJobs.length,
    });
  }

  // ── Alert 3: High-Value Lead Waiting ──
  const highValueWaiting = ranked.filter(r => {
    const days = r.factors?.leadAgeDays || 0;
    const profit = intelMap[r.leadId]?.profit?.estimated || 0;
    return days >= 1 && profit >= 2000;
  });
  if (highValueWaiting.length > 0) {
    highValueWaiting.slice(0, 3).forEach(r => {
      const profit = intelMap[r.leadId]?.profit?.estimated || 0;
      alerts.push({
        id: `high-value-waiting-${r.leadId}`,
        category: 'High Value Lead Waiting',
        severity: profit >= 5000 ? 'critical' : 'warning',
        title: `${r.caller} — $${profit.toLocaleString()} profit opportunity`,
        message: `${r.caller} (${r.service}) has been waiting ${r.factors?.leadAgeDays} day${r.factors?.leadAgeDays !== 1 ? 's' : ''}. Estimated profit: $${profit.toLocaleString()}. Contact today.`,
        impact: profit >= 5000 ? 'high' : profit >= 2000 ? 'medium' : 'low',
        caller: r.caller,
        estimatedProfit: profit,
      });
    });
  }

  // ── Alert 4: Estimate Aging ──
  const agingEstimates = ranked.filter(r => {
    const days = r.factors?.leadAgeDays || 0;
    return days >= URGENCY_THRESHOLDS.high && r.breakdown?.closeScore >= 50;
  });
  if (agingEstimates.length > 0) {
    alerts.push({
      id: 'estimate-aging',
      category: 'Estimate Aging',
      severity: agingEstimates.length >= 3 ? 'critical' : 'warning',
      title: `${agingEstimates.length} estimate${agingEstimates.length > 1 ? 's' : ''} aging with high close probability`,
      message: `${agingEstimates.length} estimate${agingEstimates.length > 1 ? 's with' : ' with'} high close probability ${agingEstimates.length > 1 ? 'have' : 'has'} been waiting ${URGENCY_THRESHOLDS.high}+ days. Follow up to prevent deal slippage.`,
      impact: 'medium',
      leads: agingEstimates.map(r => ({
        caller: r.caller,
        daysWaiting: r.factors?.leadAgeDays,
        closeProbability: r.factors?.closeProbability,
      })),
    });
  }

  // ── Alert 5: Travel Inefficiency ──
  const highTravel = allIntel
    .filter(i => (i.travel?.minutes || 0) >= 25)
    .sort((a, b) => (b.travel?.minutes || 0) - (a.travel?.minutes || 0));
  if (highTravel.length >= 2) {
    alerts.push({
      id: 'travel-inefficiency',
      category: 'Travel Inefficiency',
      severity: 'info',
      title: `${highTravel.length} job${highTravel.length > 1 ? 's have' : ' has'} high travel time`,
      message: `${highTravel[0].caller} (${highTravel[0].travel?.minutes} min) and ${highTravel[1].caller} (${highTravel[1].travel?.minutes} min) have extended travel times. Consider route optimization or geographic clustering.`,
      impact: 'low',
      jobs: highTravel.slice(0, 3).map(i => ({
        caller: i.caller,
        travelMinutes: i.travel?.minutes,
        travelCost: i.travel?.cost,
      })),
    });
  }

  // Sort alerts by severity: critical > warning > info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));

  return alerts;
}

// ====================================================================
// Module 6: Executive Briefing
// ====================================================================

/**
 * Generate a complete executive briefing for today.
 * This is the master function that combines all modules into a unified briefing.
 *
 * @param {Array} leads - Array of lead objects
 * @param {Object} [options]
 * @returns {Object} Complete executive briefing
 */
function generateExecutiveBriefing(leads, options) {
  if (!leads || leads.length === 0) {
    return {
      date: new Date().toISOString(),
      summary: { status: 'No leads in system', totalLeads: 0 },
      priorities: [],
      alerts: [],
      topRecommendation: null,
    };
  }

  const opts = options || {};
  const now = opts.now || Date.now();

  // Get all calculations from the intelligence engine
  const agg = intelligence.calculateAggregateIntelligence(leads);
  const daily = generateDailyPriorities(leads, opts);
  const alerts = generateExecutiveAlerts(leads, opts);

  // Top single recommendation
  const topRec = daily.topOpportunities[0] || null;
  const topRecLead = topRec ? leads.find(l => l.caller === topRec.caller) : null;
  const topRecIntel = topRecLead ? intelligence.calculateJobIntelligence(topRecLead, { leadCount: leads.length }) : null;
  const topRecRanking = topRecLead ? rankOpportunity(topRecLead, topRecIntel, opts) : null;

  const topRecommendation = topRec ? {
    caller: topRec.caller,
    service: topRec.service,
    priorityScore: topRec.priorityScore,
    estimatedRevenue: topRec.estimatedRevenue,
    estimatedProfit: topRec.estimatedProfit,
    profitMargin: topRec.profitMargin,
    confidenceScore: topRec.confidenceScore,
    nextAction: topRecLead ? getNextBestAction(topRecLead, topRecRanking) : null,
    explanation: topRec.explanation,
    businessImpact: topRec.businessImpact,
  } : null;

  // Executive summary
  const executiveSummary = {
    date: new Date(now).toISOString(),
    totalLeads: agg.totalLeads,
    totalPipelineValue: agg.totalPipelineValue,
    totalEstimatedProfit: agg.totalEstimatedProfit,
    averageProfitMargin: agg.averageProfitMargin,
    averageConfidence: agg.averageConfidence + '%',
    followUpsOverdue: daily.topFollowUps.length,
    revenueAtRisk: daily.revenueAtRisk,
    criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
    warningAlerts: alerts.filter(a => a.severity === 'warning').length,
    infoAlerts: alerts.filter(a => a.severity === 'info').length,
    topPriority: topRec?.caller || null,
  };

  return {
    summary: executiveSummary,
    priorities: daily,
    alerts,
    topRecommendation,
  };
}

// ====================================================================
// Exports
// ====================================================================

module.exports = {
  // Module 1
  rankOpportunity,
  rankAllOpportunities,

  // Module 2
  getNextBestAction,

  // Module 3
  generateExecutiveExplanation,

  // Module 4
  generateDailyPriorities,

  // Module 5
  generateExecutiveAlerts,

  // Module 6
  generateExecutiveBriefing,

  // Constants (for testing/extension)
  PRIORITY_WEIGHTS,
  CLOSE_PROBABILITY_MAP,
  NEXT_BEST_ACTION_MAP,
};