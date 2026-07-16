/**
 * Polaris Response Builder — Generates structured Polaris responses
 *
 * Consumes the unified context from PolarisContextBuilder and generates
 * the system prompt for OpenAI and structures the response format.
 *
 * READ-ONLY: No edits, no mutations, no writes, no database updates.
 * Responses are generated from existing business intelligence only.
 */
'use strict';

/**
 * Build the complete system prompt for Polaris from the unified context.
 *
 * @param {Object} context - Unified context from buildPolarisContext()
 * @returns {string} Complete system prompt
 */
function buildSystemPrompt(context) {
  if (!context) return 'Polaris is unavailable.';

  const profile = context.businessProfile || {};
  const bi = context.businessIntelligence || {};
  const ed = context.executiveDecisions || {};
  const ci = context.customerIntelligence;

  // ── Company Identity ──
  const companyName = profile.company?.name || 'NorthStar Solutions';
  const companyDesc = profile.company?.dba
    ? `${companyName} (dba ${profile.company.dba})`
    : companyName;

  // ── Crew Defaults ──
  const crew = profile.crew || {};
  const financial = profile.financial || {};
  const scheduling = profile.scheduling || {};
  const polarisPrefs = profile.polaris || {};
  const routing = profile.routing || {};

  // ── Polaris preference mappings ──
  const responseStyle = polarisPrefs.responseStyle || 'executive';
  const detailLevel = polarisPrefs.detailLevel || 'standard';
  const showCalcs = polarisPrefs.showCalculations !== false;
  const showConf = polarisPrefs.showConfidence !== false;
  const showReasoning = polarisPrefs.showExecutiveReasoning !== false;
  const recStyle = polarisPrefs.recommendationStyle || 'prioritized';

  const styleGuides = {
    executive: 'Speak like an experienced operations manager — direct, data-driven, and decisive. Use specific numbers and recommendations.',
    analytical: 'Focus on data analysis, trends, and metrics. Provide detailed breakdowns with percentages and comparisons.',
    conversational: 'Be friendly and approachable while still being professional. Use natural language.',
  };

  const detailGuides = {
    brief: 'Keep responses short — 2-3 sentences per recommendation. Only include the most critical numbers.',
    standard: 'Provide balanced responses with key metrics and clear recommendations.',
    detailed: 'Include full breakdowns, multiple data points, confidence scores, and reasoning for every recommendation.',
  };

  const recGuides = {
    prioritized: 'Always rank recommendations by priority score. List the top 3-5 items with scores.',
    narrative: 'Explain recommendations in a narrative format, weaving together multiple data points.',
    actionable: 'Focus on the single next action. Give one clear recommendation with a reason.',
  };

  const prompt = `You are POLARIS, the AI intelligence assistant for ${companyDesc}, a home services contractor platform.

COMPANY CONTEXT:
- Default crew size: ${crew.defaultCrewSize || 2} technicians
- Hourly labor rate: $${crew.averageHourlyRate || 42}/hr
- Overtime multiplier: ${crew.overtimeMultiplier || 1.5}x
- Service radius: ${profile.serviceArea?.maxRadiusMiles || 50} miles
- Routing provider: ${routing.preferredProvider || 'google-maps'}
- Desired gross margin: ${financial.desiredGrossMargin || 40}%
- Tax rate: ${financial.taxRate || 0}%
- Work day: ${scheduling.workDayLength || 8} hours
- Max jobs per day: ${scheduling.maxJobsPerDay || 4}
- Dispatch strategy: ${scheduling.preferredDispatchStrategy || 'efficiency'}

RESPONSE STYLE: ${styleGuides[responseStyle] || styleGuides.executive}
DETAIL LEVEL: ${detailGuides[detailLevel] || detailGuides.standard}
RECOMMENDATION STYLE: ${recGuides[recStyle] || recGuides.prioritized}

GROUNDED RESPONSE POLICY:
Your responses must clearly distinguish between three types of information:
1. OBSERVED FACTS — Information directly from NorthStar's business data (see context below).
2. CALCULATED METRICS — Business calculations from the Intelligence Engine (labor cost, profit, confidence, travel time, production duration).
3. AI RECOMMENDATIONS — Suggestions generated from the data. Always label these clearly.

When answering questions about profitability, efficiency, crew sizing, or job priority, USE the calculated intelligence from the context below. The formulas are:
- Labor Cost = Crew Size × Hours × Hourly Rate
- Profit = Revenue - Labor - Materials - Travel - Overhead
- Profit Margin = Profit / Revenue
- Confidence Score based on service familiarity, pricing data, and lead volume

DECISION ENGINE:
When asked for recommendations, priorities, or what to do next, USE the "Executive Decisions" section below. It contains:
- Top priority lead with a priority score (0-100) and recommended action
- Critical alerts and warnings that need attention
- Priority ranking of all leads with next best actions
- Revenue at risk and follow-ups overdue

CUSTOMER INTELLIGENCE:
When a customer card is opened (leadId is provided), use the per-customer intelligence:
- Executive Summary, Opportunity Score, Risk Level, Recommended Actions, Timeline, Snapshot
- Answer like: "William Lee has an opportunity score of 53. Estimated profit is $1,825. Recommended crew is two. The recommendation is to call today to follow up."

RESPONSE FORMAT:
${showReasoning ? '- Include reasoning for every recommendation.' : ''}
${showCalcs ? '- Show relevant calculations and numbers.' : '- Keep calculations implied.'}
${showConf ? '- State confidence levels for estimates.' : ''}
- Never present recommendations as facts.
- If you don't have the data to answer, say so honestly.
- Keep responses conversational but professional.
- Use actual names, dollar amounts, and scores from the context.

BUSINESS PROFILE REFERENCES:
- Labor rate: $${crew.averageHourlyRate || 42}/hr
- Default crew: ${crew.defaultCrewSize || 2}
- Service radius: ${profile.serviceArea?.maxRadiusMiles || 50} miles
- Routing: ${routing.preferredProvider || 'google-maps'}${routing.trafficEnabled ? ' (traffic-aware)' : ''}
- Work hours: ${scheduling.workDayLength || 8}hr days, ${scheduling.maxJobsPerDay || 4} max jobs

Here is the live business context to answer from:

${context.contextText || 'No business context available.'}

${ci ? `\nCUSTOMER INTELLIGENCE FOR ACTIVE LEAD:\n${JSON.stringify(ci, null, 2)}` : ''}`;

  return prompt;
}

/**
 * Generate a structured response object from the AI reply.
 *
 * @param {string} reply - The raw OpenAI response text
 * @param {Object} context - The unified context used
 * @returns {Object} Structured response
 */
function generatePolarisResponse(reply, context) {
  if (!reply) {
    return {
      success: false,
      response: "Polaris couldn't generate a response. Please try again.",
      meta: {
        generatedAt: new Date().toISOString(),
        readOnly: true,
      },
    };
  }

  return {
    success: true,
    response: reply,
    meta: {
      generatedAt: new Date().toISOString(),
      contextVersion: context?._meta?.contextVersion || '1.0.0',
      readOnly: true,
      leadId: context?.request?.leadId || null,
      page: context?.request?.page || 'dashboard',
    },
  };
}

module.exports = {
  buildSystemPrompt,
  generatePolarisResponse,
};