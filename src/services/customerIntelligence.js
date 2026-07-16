/**
 * Customer Intelligence Engine — Per-Customer Intelligence Layer
 *
 * Transforms every customer card from a CRM display into an AI-powered
 * intelligence hub. Combines stored data, calculated business intelligence,
 * and executive recommendations into a single customer intelligence object.
 *
 * Architecture:
 *   Business Data → Business Context → Business Intelligence Engine
 *                                              ↓
 *                                   Executive Decision Engine
 *                                              ↓
 *                               Customer Intelligence Engine  ← YOU ARE HERE
 *                                              ↓
 *                Polaris | Dashboard | Customer Cards | Scheduling | Retell | Future AI
 *
 * READ-ONLY: No edits, no mutations, no writes, no database updates.
 * Every future mission (17-19) must consume the exact same object structure.
 */
'use strict';

const intelligence = require('./intelligence');
const decisionEngine = require('./decisionEngine');

// ====================================================================
// Step 2: Executive Summary
// ====================================================================

/**
 * Generate a one-paragraph executive summary for a customer/lead.
 *
 * @param {Object} lead - Raw lead object
 * @param {Object} leadIntel - Pre-computed intelligence from calculateJobIntelligence()
 * @param {Object} leadRanking - Pre-computed ranking from rankOpportunity()
 * @param {Object} leadAction - Next best action from getNextBestAction()
 * @returns {string} Executive summary paragraph
 */
function generateExecutiveSummary(lead, leadIntel, leadRanking, leadAction) {
  if (!lead) return 'No customer data available.';

  const parts = [];

  // Who
  parts.push(`${lead.caller} is a ${lead.service} customer.`);

  // Current stage
  const outcome = lead.outcome || 'new';
  const stageLabels = {
    'appointment-set': 'has an appointment scheduled',
    'follow-up': 'needs follow-up',
    'lead-captured': 'was recently captured and needs qualification',
    'no-interest': 'has indicated no interest',
  };
  parts.push(`They ${stageLabels[outcome] || 'are a new lead'}.`);

  // Opportunity
  if (leadIntel && leadIntel.profit) {
    const profit = leadIntel.profit.estimated;
    const margin = leadIntel.profit.margin;
    if (profit > 0) {
      parts.push(`This job represents a $${profit.toLocaleString()} profit opportunity at ${margin} margin.`);
    }
  }

  // Biggest risk
  const risks = [];
  if (leadRanking) {
    const days = leadRanking.factors?.leadAgeDays;
    if (days !== null && days !== undefined && days >= 2) {
      risks.push(`has been waiting ${days} days without resolution`);
    }
  }
  if (leadIntel && leadIntel.confidence && leadIntel.confidence.score < 70) {
    risks.push(`confidence is low (${leadIntel.confidence.score}%)`);
  }
  if (outcome === 'lead-captured') {
    risks.push('has not been contacted yet');
  }
  if (risks.length > 0) {
    parts.push(`Risk: ${risks.join('; ')}.`);
  }

  // Recommended next action
  if (leadAction) {
    parts.push(`Recommended action: ${leadAction.action}.`);
  }

  return parts.join(' ');
}

// ====================================================================
// Step 3: Opportunity Score
// ====================================================================

/**
 * Calculate a customer-specific opportunity score (0-100).
 * Uses the same weighted factors as the Decision Engine but returns
 * a customer-specific score with reasoning.
 *
 * @param {Object} lead - Raw lead object
 * @param {Object} leadIntel - Intelligence result
 * @param {Object} leadRanking - Ranking result
 * @returns {{ score: number, level: string, reasoning: string[], factors: Object }}
 */
function calculateOpportunityScore(lead, leadIntel, leadRanking) {
  if (!lead || !leadRanking) {
    return { score: 0, level: 'Unknown', reasoning: ['Insufficient data'], factors: {} };
  }

  // Use the priority score as the base opportunity score
  const baseScore = leadRanking.priorityScore;
  const breakdown = leadRanking.breakdown;
  const factors = leadRanking.factors;

  const reasoning = [];

  // Build reasoning top contributing factors
  const factorLabels = [
    { key: 'profitScore', label: 'Estimated profit', value: leadIntel?.profit?.estimated, format: 'currency' },
    { key: 'closeScore', label: 'Close probability', value: factors?.closeProbability, format: 'percent' },
    { key: 'confidenceScore', label: 'Confidence score', value: leadIntel?.confidence?.score, format: 'number' },
    { key: 'ageUrgencyScore', label: 'Lead age urgency', value: factors?.leadAgeDays, format: 'days' },
    { key: 'travelScore', label: 'Travel efficiency', value: factors?.travelMinutes, format: 'minutes' },
  ];

  factorLabels.forEach(f => {
    const score = breakdown[f.key];
    if (score !== undefined && score >= 70) {
      if (f.format === 'currency' && f.value) {
        reasoning.push(`Strong profit potential: $${f.value.toLocaleString()}`);
      } else if (f.format === 'percent' && f.value) {
        reasoning.push(`High close probability: ${f.value}`);
      } else if (f.format === 'number' && f.value) {
        reasoning.push(`High confidence: ${f.value}%`);
      } else if (f.format === 'days' && f.value !== null) {
        reasoning.push(`Urgent attention needed: ${f.value} days waiting`);
      } else if (f.format === 'minutes' && f.value !== null && f.value <= 15) {
        reasoning.push(`Low travel cost: ${f.value} minutes`);
      }
    }
  });

  // Level
  const level = baseScore >= 85 ? 'Exceptional' :
    baseScore >= 70 ? 'High' :
    baseScore >= 50 ? 'Moderate' :
    baseScore >= 30 ? 'Low' : 'Minimal';

  return {
    score: baseScore,
    level,
    reasoning: reasoning.length > 0 ? reasoning : ['Standard opportunity'],
    factors: {
      profitScore: breakdown.profitScore,
      closeScore: breakdown.closeScore,
      confidenceScore: breakdown.confidenceScore,
      ageUrgencyScore: breakdown.ageUrgencyScore,
      travelScore: breakdown.travelScore,
      productionScore: breakdown.productionScore,
    },
  };
}

// ====================================================================
// Step 4: Risk Score
// ====================================================================

/**
 * Calculate a customer-specific risk assessment.
 *
 * @param {Object} lead - Raw lead object
 * @param {Object} leadIntel - Intelligence result
 * @param {Object} leadRanking - Ranking result
 * @returns {{ level: string, score: number, reasons: string[], details: Object }}
 */
function calculateRiskScore(lead, leadIntel, leadRanking) {
  if (!lead) {
    return { level: 'Unknown', score: 0, reasons: ['No data'], details: {} };
  }

  const reasons = [];
  let riskScore = 0; // 0-100, higher = more risk

  const outcome = lead.outcome || '';
  const days = leadRanking?.factors?.leadAgeDays;
  const confidence = leadIntel?.confidence?.score || 50;
  const travelMinutes = leadIntel?.travel?.minutes || 18;
  const profit = leadIntel?.profit?.estimated || 0;

  // Risk: No follow-up (aging lead)
  if (days !== null && days !== undefined) {
    if (days >= 3) {
      riskScore += 35;
      reasons.push(`No follow-up in ${days} days — critical aging`);
    } else if (days >= 2) {
      riskScore += 20;
      reasons.push(`No follow-up in ${days} days — aging lead`);
    } else if (days >= 1) {
      riskScore += 10;
      reasons.push(`Waiting ${days} day(s) for contact`);
    }
  }

  // Risk: Low confidence
  if (confidence < 60) {
    riskScore += 25;
    reasons.push('Low confidence estimate');
  } else if (confidence < 75) {
    riskScore += 10;
    reasons.push('Moderate confidence estimate');
  }

  // Risk: No appointment
  if (outcome === 'lead-captured') {
    riskScore += 20;
    reasons.push('No appointment scheduled');
  }

  // Risk: Estimate aging (high-value leads waiting)
  if (profit > 2000 && days !== null && days !== undefined && days >= 2) {
    riskScore += 15;
    reasons.push(`High-value lead ($${profit.toLocaleString()}) aging without action`);
  }

  // Risk: Long travel
  if (travelMinutes >= 25) {
    riskScore += 10;
    reasons.push('Extended travel time increases operational cost');
  }

  // Risk: No interest
  if (outcome === 'no-interest') {
    riskScore += 40;
    reasons.push('Customer indicated no interest');
  }

  // Cap at 100
  riskScore = Math.min(100, riskScore);

  // Level
  const level = riskScore >= 60 ? 'Critical' :
    riskScore >= 40 ? 'High' :
    riskScore >= 20 ? 'Medium' : 'Low';

  return {
    level,
    score: riskScore,
    reasons: reasons.length > 0 ? reasons : ['No significant risks identified'],
    details: {
      daysWaiting: days,
      confidenceScore: confidence,
      travelMinutes,
      hasAppointment: outcome === 'appointment-set',
      isAgingHighValue: profit > 2000 && days !== null && days !== undefined && days >= 2,
    },
  };
}

// ====================================================================
// Step 5: Recommended Actions
// ====================================================================

/**
 * Generate ranked, customer-specific recommended actions.
 * Each action includes what to do and why.
 *
 * @param {Object} lead - Raw lead object
 * @param {Object} leadIntel - Intelligence result
 * @param {Object} leadRanking - Ranking result
 * @param {Object} leadAction - Next best action from getNextBestAction()
 * @param {Object} risk - Risk assessment
 * @returns {Array<{ rank: number, action: string, reason: string, priority: string }>}
 */
function generateRecommendedActions(lead, leadIntel, leadRanking, leadAction, risk) {
  if (!lead) return [];

  const actions = [];
  const outcome = lead.outcome || '';
  const days = leadRanking?.factors?.leadAgeDays;
  const profit = leadIntel?.profit?.estimated || 0;
  const confidence = leadIntel?.confidence?.score || 50;
  const travelMinutes = leadIntel?.travel?.minutes || 18;
  const hours = leadIntel?.estimatedDuration?.hours || 0;

  // Action 1: Primary action from Decision Engine
  if (leadAction) {
    const urgency = days !== null && days !== undefined && days >= 2 ? ' (urgent)' : '';
    actions.push({
      rank: 1,
      action: leadAction.action + urgency,
      reason: leadAction.reason,
      priority: leadAction.priority === 'high' ? 'high' : 'medium',
    });
  }

  // Action 2: Send proposal (if appointment is set and no estimate sent)
  if (outcome === 'appointment-set') {
    actions.push({
      rank: 2,
      action: 'Send detailed proposal and materials list',
      reason: `Appointment is confirmed. Provide customer with a detailed scope of work, materials list, and timeline to build confidence before the visit.`,
      priority: 'high',
    });
  }

  // Action 3: Upsell opportunity
  if (profit > 1000) {
    actions.push({
      rank: 3,
      action: 'Evaluate upsell opportunities',
      reason: `High-value job ($${profit.toLocaleString()} profit). Consider offering maintenance packages, extended warranties, or complementary services during the visit.`,
      priority: 'medium',
    });
  }

  // Action 4: Schedule optimization
  if (hours > 0 && hours <= 3) {
    actions.push({
      rank: 4,
      action: 'Schedule as quick-win job',
      reason: `Estimated production time is only ${hours} hours. This can be completed in a half-day, freeing the crew for additional work.`,
      priority: 'medium',
    });
  } else if (hours > 6) {
    actions.push({
      rank: 4,
      action: 'Plan multi-day schedule',
      reason: `Estimated production time is ${hours} hours. This requires a full-day or multi-day commitment — plan crew scheduling accordingly.`,
      priority: 'medium',
    });
  }

  // Action 5: Travel optimization
  if (travelMinutes >= 20) {
    actions.push({
      rank: 5,
      action: 'Cluster with nearby jobs',
      reason: `Travel time is ${travelMinutes} minutes. Check for nearby jobs on the same day to reduce travel cost and improve crew efficiency.`,
      priority: 'low',
    });
  }

  // Action 6: Confidence improvement
  if (confidence < 70) {
    actions.push({
      rank: 6,
      action: 'Gather additional scope details',
      reason: `Confidence is ${confidence}%. More information about the job scope, materials, or access conditions would improve estimate accuracy.`,
      priority: 'low',
    });
  }

  // Action 7: Move into production
  if (outcome === 'appointment-set' && days !== null && days !== undefined && days >= 1) {
    actions.push({
      rank: 7,
      action: 'Move into production scheduling',
      reason: `Appointment was set ${days} day(s) ago. Ready to schedule the crew and move this job into the production queue.`,
      priority: 'low',
    });
  }

  return actions.slice(0, 7); // Max 7 recommendations
}

// ====================================================================
// Step 6: Customer Timeline
// ====================================================================

/**
 * Generate a customer timeline from lead data.
 * Newest first.
 *
 * @param {Object} lead - Raw lead object
 * @returns {Array<{ date: string, event: string, type: string }>}
 */
function generateCustomerTimeline(lead) {
  if (!lead) return [];

  const timeline = [];

  // Lead created
  if (lead.receivedAt) {
    timeline.push({
      date: lead.receivedAt,
      event: 'Lead captured via phone call',
      type: 'lead-captured',
    });
  }

  // Status change
  if (lead.status && lead.receivedAt) {
    const statusDate = new Date(lead.receivedAt);
    statusDate.setMinutes(statusDate.getMinutes() + 5); // Approximate status change
    timeline.push({
      date: statusDate.toISOString(),
      event: `Status changed to "${lead.status}"`,
      type: 'status-change',
    });
  }

  // Outcome
  if (lead.outcome && lead.receivedAt) {
    const outcomeDate = new Date(lead.receivedAt);
    outcomeDate.setMinutes(outcomeDate.getMinutes() + 10);
    const outcomeLabels = {
      'appointment-set': 'Appointment scheduled',
      'follow-up': 'Marked for follow-up',
      'lead-captured': 'Lead captured',
      'no-interest': 'Customer indicated no interest',
    };
    timeline.push({
      date: outcomeDate.toISOString(),
      event: outcomeLabels[lead.outcome] || `Outcome: ${lead.outcome}`,
      type: 'outcome',
    });
  }

  // Estimate generated (if polarisEstimate exists)
  if (lead.polarisEstimate && lead.polarisEstimate.generatedAt) {
    timeline.push({
      date: lead.polarisEstimate.generatedAt,
      event: `Estimate generated: $${lead.polarisEstimate.breakdown?.total || lead.polarisEstimate.total || 'N/A'}`,
      type: 'estimate',
    });
  }

  // Sort newest first
  timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

  return timeline;
}

// ====================================================================
// Step 7: Customer Snapshot
// ====================================================================

/**
 * Generate a complete customer snapshot — the master output for a customer.
 * Combines all intelligence layers into a single object.
 *
 * @param {Object} lead - Raw lead object from leads.json
 * @param {Object} [options]
 * @param {number} [options.totalLeads] - Total leads for context
 * @returns {Object} Complete customer intelligence object
 */
function generateCustomerSnapshot(lead, options) {
  if (!lead) {
    return {
      customerId: null,
      name: 'Unknown',
      error: 'No lead data provided',
    };
  }

  const opts = options || {};
  const totalLeads = opts.totalLeads || 0;

  // 1. Get Business Intelligence from Intelligence Engine
  const leadIntel = intelligence.calculateJobIntelligence(lead, { leadCount: totalLeads });

  // 2. Get Executive Decisions from Decision Engine
  const leadRanking = decisionEngine.rankOpportunity(lead, leadIntel, { totalLeads });
  const leadAction = decisionEngine.getNextBestAction(lead, leadRanking);
  const explanation = decisionEngine.generateExecutiveExplanation(lead, leadRanking, leadIntel);

  // 3. Generate Customer Intelligence
  const executiveSummary = generateExecutiveSummary(lead, leadIntel, leadRanking, leadAction);
  const opportunity = calculateOpportunityScore(lead, leadIntel, leadRanking);
  const risk = calculateRiskScore(lead, leadIntel, leadRanking);
  const actions = generateRecommendedActions(lead, leadIntel, leadRanking, leadAction, risk);
  const timeline = generateCustomerTimeline(lead);

  // 4. Build the complete snapshot
  return {
    // Identity
    customerId: lead.id,
    name: lead.caller,
    phone: lead.phone,
    address: lead.address,
    service: lead.service,
    icon: lead.icon || '📋',

    // Step 2: Executive Summary
    executiveSummary,

    // Step 3: Opportunity Score
    opportunityScore: opportunity.score,
    opportunityLevel: opportunity.level,
    opportunityReasoning: opportunity.reasoning,
    opportunityFactors: opportunity.factors,

    // Step 4: Risk Score
    riskLevel: risk.level,
    riskScore: risk.score,
    riskReasons: risk.reasons,
    riskDetails: risk.details,

    // Step 5: Recommended Actions
    recommendedActions: actions,

    // Step 6: Timeline
    timeline,

    // Step 7: Snapshot (detailed values)
    snapshot: {
      estimatedRevenue: leadIntel?.revenue || 0,
      estimatedProfit: leadIntel?.profit?.estimated || 0,
      profitMargin: leadIntel?.profit?.margin || '0%',
      estimatedLabor: leadIntel?.laborCost?.total || 0,
      recommendedCrew: leadIntel?.recommendedCrewSize || 2,
      estimatedProductionHours: leadIntel?.estimatedDuration?.hours || 0,
      productionConfidence: leadIntel?.estimatedDuration?.confidenceScore || 0,
      travelMinutes: leadIntel?.travel?.minutes || 18,
      travelCost: leadIntel?.travel?.cost || 0,
      confidenceScore: leadIntel?.confidence?.score || 0,
      confidenceLabel: leadIntel?.confidence?.label || 'Low',
      confidenceReason: leadIntel?.confidence?.reason || '',
      profitPerLaborHour: leadIntel?.profitPerLaborHour || 0,
      roiScore: leadIntel?.roiScore || 0,
    },

    // Status
    currentStatus: lead.status || 'unknown',
    currentOutcome: lead.outcome || 'pending',
    daysWaiting: leadRanking?.factors?.leadAgeDays || 0,
    closeProbability: leadRanking?.factors?.closeProbability || '0%',

    // Raw data reference
    rawLead: {
      id: lead.id,
      caller: lead.caller,
      phone: lead.phone,
      address: lead.address,
      service: lead.service,
      avgPrice: lead.avgPrice,
      status: lead.status,
      outcome: lead.outcome,
      summary: lead.summary,
      receivedAt: lead.receivedAt,
    },

    // Future compatibility placeholders
    retellIntelligence: null,     // Mission 17
    estimateIntelligence: null,    // Mission 18
    schedulingIntelligence: null,  // Mission 19

    // Priority
    priorityScore: leadRanking?.priorityScore || 0,
    priorityLabel: leadRanking?.priorityLabel || 'Unknown',
    nextBestAction: leadAction?.action || 'Review',
    escalationLevel: leadAction?.escalationLevel || 'this-week',

    // Executive explanation
    explanation: explanation.explanation,
    bulletPoints: explanation.bulletPoints,
    businessImpact: explanation.businessImpact,
    recommendationStrength: explanation.recommendationStrength,
  };
}

/**
 * Generate customer intelligence for ALL leads.
 * Returns an array of customer snapshots sorted by priority score descending.
 *
 * @param {Array} leads - Array of lead objects
 * @returns {Array<Object>} Array of customer snapshots
 */
function generateAllCustomerSnapshots(leads) {
  if (!leads || leads.length === 0) return [];

  return leads
    .map(lead => generateCustomerSnapshot(lead, { totalLeads: leads.length }))
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

/**
 * Generate dashboard-level customer intelligence summaries.
 *
 * @param {Array} leads - Array of lead objects
 * @returns {Object} Dashboard-level customer intelligence
 */
function generateDashboardCustomerIntelligence(leads) {
  if (!leads || leads.length === 0) {
    return {
      highestOpportunity: [],
      highestRisk: [],
      highestProfit: [],
      bestFollowUps: [],
      fastestRevenue: [],
      longestWaiting: [],
      lowestConfidence: [],
      highestMargin: [],
    };
  }

  const snapshots = generateAllCustomerSnapshots(leads);

  // Highest opportunity
  const highestOpportunity = [...snapshots]
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 5)
    .map(s => ({ name: s.name, service: s.service, score: s.opportunityScore, level: s.opportunityLevel, profit: s.snapshot.estimatedProfit }));

  // Highest risk
  const highestRisk = [...snapshots]
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5)
    .map(s => ({ name: s.name, service: s.service, riskLevel: s.riskLevel, riskScore: s.riskScore, reasons: s.riskReasons.slice(0, 2) }));

  // Highest profit
  const highestProfit = [...snapshots]
    .sort((a, b) => b.snapshot.estimatedProfit - a.snapshot.estimatedProfit)
    .slice(0, 5)
    .map(s => ({ name: s.name, service: s.service, profit: s.snapshot.estimatedProfit, margin: s.snapshot.profitMargin }));

  // Best follow-ups (highest priority leads needing follow-up)
  const bestFollowUps = snapshots
    .filter(s => s.currentOutcome === 'follow-up' || s.currentOutcome === 'lead-captured')
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 5)
    .map(s => ({ name: s.name, service: s.service, score: s.priorityScore, daysWaiting: s.daysWaiting, nextAction: s.nextBestAction }));

  // Fastest revenue (shortest production time with decent profit)
  const fastestRevenue = [...snapshots]
    .filter(s => s.snapshot.estimatedProductionHours > 0 && s.snapshot.estimatedProfit > 0)
    .sort((a, b) => (a.snapshot.estimatedProductionHours / (a.snapshot.estimatedProfit || 1)) - (b.snapshot.estimatedProductionHours / (b.snapshot.estimatedProfit || 1)))
    .slice(0, 5)
    .map(s => ({ name: s.name, service: s.service, hours: s.snapshot.estimatedProductionHours, profit: s.snapshot.estimatedProfit, profitPerHour: s.snapshot.profitPerLaborHour }));

  // Longest waiting estimates
  const longestWaiting = [...snapshots]
    .sort((a, b) => b.daysWaiting - a.daysWaiting)
    .slice(0, 5)
    .map(s => ({ name: s.name, service: s.service, daysWaiting: s.daysWaiting, profit: s.snapshot.estimatedProfit }));

  // Lowest confidence
  const lowestConfidence = [...snapshots]
    .sort((a, b) => a.snapshot.confidenceScore - b.snapshot.confidenceScore)
    .slice(0, 5)
    .map(s => ({ name: s.name, service: s.service, confidence: s.snapshot.confidenceScore, label: s.snapshot.confidenceLabel }));

  // Highest margin
  const highestMargin = [...snapshots]
    .filter(s => s.snapshot.profitMargin !== '0%')
    .sort((a, b) => parseFloat(b.snapshot.profitMargin) - parseFloat(a.snapshot.profitMargin))
    .slice(0, 5)
    .map(s => ({ name: s.name, service: s.service, margin: s.snapshot.profitMargin, profit: s.snapshot.estimatedProfit }));

  return {
    highestOpportunity,
    highestRisk,
    highestProfit,
    bestFollowUps,
    fastestRevenue,
    longestWaiting,
    lowestConfidence,
    highestMargin,
  };
}

module.exports = {
  // Step 2
  generateExecutiveSummary,
  // Step 3
  calculateOpportunityScore,
  // Step 4
  calculateRiskScore,
  // Step 5
  generateRecommendedActions,
  // Step 6
  generateCustomerTimeline,
  // Step 7
  generateCustomerSnapshot,
  // Step 10
  generateAllCustomerSnapshots,
  generateDashboardCustomerIntelligence,
};