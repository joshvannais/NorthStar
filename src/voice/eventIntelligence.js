/**
 * Event-Driven Intelligence — Part 6
 *
 * Reacts to voice business events with context-aware intelligence.
 * NO continuous recalculation — all data comes from the frozen
 * Executive Context (polarisContextBuilder).
 *
 * Event handlers:
 * - estimate_requested → provide revenue intelligence from cached context
 * - pricing_question → provide pricing explanation from context
 * - objection_detected → provide objection guidance (hardcoded for now)
 * - call_completed → generate executive summary
 */

'use strict';

const { EVENT_TYPES, on } = require('./businessEvents');

// ── Cached Executive Context ───────────────────────────────────

/** @type {Object|null} Frozen executive context snapshot */
let frozenContext = null;

/**
 * Update the frozen context snapshot.
 * Called by the voice route/session manager when new context is available.
 *
 * @param {Object} context - Full polarisContextBuilder output
 */
function updateContext(context) {
  if (context) {
    frozenContext = Object.freeze ? Object.freeze(JSON.parse(JSON.stringify(context))) : context;
    console.log('[EventIntel] Executive context updated');
  }
}

/**
 * Get the current frozen context.
 * @returns {Object|null}
 */
function getContext() {
  return frozenContext;
}

// ── Intelligence Handlers ──────────────────────────────────────

/**
 * Handle estimate_requested event.
 * Provides revenue intelligence from the cached context.
 *
 * @param {Object} event - Business event
 * @returns {Object|null} Revenue intelligence data
 */
function handleEstimateRequested(event) {
  if (!frozenContext) {
    console.log('[EventIntel] No context available for estimate_requested');
    return null;
  }

  const bi = frozenContext.businessIntelligence || {};
  const ed = frozenContext.executiveDecisions || {};

  return {
    guidance: 'estimate_in_progress',
    averagePipelineValue: bi.totalPipelineValue || 0,
    averageProfitMargin: bi.averageProfitMargin || '0%',
    similarJobs: {
      count: bi.totalLeads || 0,
      averageValue: bi.totalLeads > 0
        ? Math.round((bi.totalPipelineValue || 0) / bi.totalLeads)
        : 0,
    },
    topPriority: ed.topPriority || null,
    revenueAtRisk: ed.revenueAtRisk || 0,
  };
}

/**
 * Handle pricing_question event.
 * Provides pricing explanation from the business context.
 *
 * @param {Object} event - Business event
 * @returns {Object|null} Pricing guidance
 */
function handlePricingQuestion(event) {
  if (!frozenContext) {
    console.log('[EventIntel] No context available for pricing_question');
    return null;
  }

  const bp = frozenContext.businessProfile || {};
  const bi = frozenContext.businessIntelligence || {};

  return {
    guidance: 'pricing_explanation',
    servicePricing: bp.services || {},
    averageTicket: bi.totalPipelineValue > 0 && bi.totalLeads > 0
      ? Math.round(bi.totalPipelineValue / bi.totalLeads)
      : 0,
    hourlyRate: bp.financial?.hourlyRate || 0,
    travelFee: bp.financial?.tripCharge || bp.routing?.baseTravelCharge || 0,
    minimumCharge: bp.financial?.minimumJobAmount || 0,
    emergencyMultiplier: bp.financial?.emergencyMultiplier || 1.5,
  };
}

/**
 * Handle objection_detected event.
 * Provides objection handling guidance.
 * Hardcoded for now; could be enhanced with NLP-based objection classification.
 *
 * @param {Object} event - Business event
 * @returns {Object} Objection guidance
 */
function handleObjectionDetected(event) {
  const objectionText = event.data?.text || event.data?.transcript || '';

  // Common objection patterns
  const objectionPatterns = [
    { pattern: /too\s*(much|expensive|high|pricey)/i, type: 'price', guidance: 'Acknowledge the price concern. Highlight value, quality, and long-term savings. Offer to break down the estimate line by line. If appropriate, mention financing options.' },
    { pattern: /(think about|need to|talk to|check with|discuss with).*(spouse|wife|husband|partner)/i, type: 'third_party', guidance: 'Respect the need to consult. Ask if they\'d like you to explain the estimate in terms they can share. Offer to set a follow-up call for all parties.' },
    { pattern: /(get another|shopping around|other quote|another estimate|compare)/i, type: 'competition', guidance: 'Don\'t disparage competitors. Emphasize your unique value: warranty, experience, response time, local reputation. Ask what factors are most important to them.' },
    { pattern: /not\s*(now|ready|right now|today|this month)/i, type: 'timing', guidance: 'Acknowledge their timeline. Ask if there\'s a specific date they have in mind. Offer to schedule a follow-up and mention any seasonal pricing considerations.' },
    { pattern: /(do it myself|diy|self|own|friend|family member)/i, type: 'diy', guidance: 'Respect their capability. Highlight safety considerations, time investment, and professional results. Ask if they\'ve tackled similar projects before.' },
  ];

  let matchedType = 'general';
  let matchedGuidance = 'Listen carefully to the objection. Validate the customer\'s concern. Ask clarifying questions before responding.';

  for (const { pattern, type, guidance } of objectionPatterns) {
    if (pattern.test(objectionText)) {
      matchedType = type;
      matchedGuidance = guidance;
      break;
    }
  }

  return {
    guidance: 'objection_handling',
    objectionType: matchedType,
    suggestedResponse: matchedGuidance,
    detectedText: objectionText.substring(0, 200),
  };
}

/**
 * Handle call_completed event.
 * Generates an executive summary from the context.
 *
 * @param {Object} event - Business event
 * @returns {Object|null} Call summary intelligence
 */
function handleCallCompleted(event) {
  if (!frozenContext) {
    console.log('[EventIntel] No context available for call_completed');
    return null;
  }

  const summary = {
    guidance: 'call_summary',
    timestamp: event.timestamp,
    businessSnapshot: {
      totalPipelineValue: frozenContext.businessIntelligence?.totalPipelineValue || 0,
      activeLeads: frozenContext.businessIntelligence?.totalLeads || 0,
      topPriority: frozenContext.executiveDecisions?.topPriority
        ? `${frozenContext.executiveDecisions.topPriority.leadName || 'Unknown'} — $${frozenContext.executiveDecisions.topPriority.estimatedValue || 0}`
        : 'None',
      alerts: frozenContext.executiveDecisions?.alerts?.length || 0,
      followUpsOverdue: frozenContext.executiveDecisions?.followUpsOverdue || 0,
    },
    recommendations: frozenContext.executiveDecisions?.topFollowUps?.slice(0, 3) || [],
  };

  return summary;
}

// ── Register Handlers on EventBus ──────────────────────────────

function registerIntelligenceHandlers() {
  on(EVENT_TYPES.ESTIMATE_REQUESTED, (event) => {
    console.log(`[EventIntel] Processing estimate_requested for session ${event.sessionId}`);
    const result = handleEstimateRequested(event);
    if (result) {
      event.data._intelligence = result;
    }
  });

  on(EVENT_TYPES.PRICING_QUESTION, (event) => {
    console.log(`[EventIntel] Processing pricing_question for session ${event.sessionId}`);
    const result = handlePricingQuestion(event);
    if (result) {
      event.data._intelligence = result;
    }
  });

  on(EVENT_TYPES.OBJECTION_DETECTED, (event) => {
    console.log(`[EventIntel] Processing objection_detected for session ${event.sessionId}`);
    const result = handleObjectionDetected(event);
    if (result) {
      event.data._intelligence = result;
    }
  });

  on(EVENT_TYPES.CALL_COMPLETED, (event) => {
    console.log(`[EventIntel] Processing call_completed for session ${event.sessionId}`);
    const result = handleCallCompleted(event);
    if (result) {
      event.data._intelligence = result;
    }
  });

  console.log('[EventIntel] Intelligence handlers registered');
}

// ── Export ─────────────────────────────────────────────────────

module.exports = {
  updateContext,
  getContext,
  handleEstimateRequested,
  handlePricingQuestion,
  handleObjectionDetected,
  handleCallCompleted,
  registerIntelligenceHandlers,
};
