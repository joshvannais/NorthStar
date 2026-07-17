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
 * - transcript_segment → live pattern detection (emergency, high-value,
 *     pricing, returning customer, scheduling conflict, hesitation,
 *     objection, escalation need)
 */

'use strict';

const { EVENT_TYPES, on } = require('./businessEvents');

// ── Cached Executive Context ───────────────────────────────────

/** @type {Object|null} Frozen executive context snapshot */
let frozenContext = null;

/**
 * Per-session guidance store: sessionId → Array<{ type, timestamp, data }>
 */
const _sessionGuidance = new Map();

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

// ── Live Pattern Detection (Part 4: Transcript Intelligence) ───

/**
 * Internal guidance event type — used for dashboard/agent view only.
 * NEVER returned to the customer during a call.
 */

/**
 * Detect emergency keywords in transcript text.
 *
 * @param {string} text — Transcript segment text
 * @returns {Object|null} Guidance event or null if no match
 */
function detectEmergency(text) {
  if (!text) return null;

  const t = text.toLowerCase();
  const highKeywords = /\b(emergency|flood|fire|leak|storm damage|broken pipe|water damage|collapse)\b/i;
  const mediumKeywords = /\b(urgent|asap|right away|immediately|tonight|today|can't wait)\b/i;
  const lowKeywords = /\b(broken|damaged|not working|needs repair|fix)\b/i;

  let severity = null;
  if (highKeywords.test(t)) severity = 'high';
  else if (mediumKeywords.test(t)) severity = 'medium';
  else if (lowKeywords.test(t)) severity = 'low';

  if (severity) {
    return {
      type: 'emergency_detected',
      severity,
      detail: `Emergency keyword detected in customer transcript: "${text.substring(0, 100)}"`,
      timestamp: new Date().toISOString(),
      internal: true,
    };
  }

  return null;
}

/**
 * Detect high-value opportunity keywords.
 */
function detectHighValue(text) {
  if (!text) return null;

  const t = text.toLowerCase();
  const highValuePatterns = [
    /\b(whole house|entire home|complete renovation|full remodel)\b/i,
    /\b(multiple rooms|several rooms|large project|big job)\b/i,
    /\b(commercial|business|office building|property management)\b/i,
    /\b(premium|high.end|luxury|custom|designer)\b/i,
  ];

  let confidence = 0;
  for (const pattern of highValuePatterns) {
    if (pattern.test(t)) confidence += 0.25;
  }

  if (confidence > 0) {
    return {
      type: 'high_value_opportunity',
      confidence: Math.min(confidence, 1.0),
      detail: `High-value keywords detected: "${text.substring(0, 100)}"`,
      timestamp: new Date().toISOString(),
      internal: true,
    };
  }

  return null;
}

/**
 * Detect pricing discussion keywords.
 */
function detectPricingDiscussion(text) {
  if (!text) return null;

  const t = text.toLowerCase();
  const pricingPatterns = /\b(cost|price|quote|estimate|how much|pricing|rate|charge|fee|dollar|money)\b/i;

  if (pricingPatterns.test(t)) {
    return {
      type: 'pricing_discussion',
      detail: `Customer discussing pricing: "${text.substring(0, 100)}"`,
      timestamp: new Date().toISOString(),
      internal: true,
    };
  }

  return null;
}

/**
 * Detect returning customer language.
 */
function detectReturningCustomer(text) {
  if (!text) return null;

  const t = text.toLowerCase();
  const returningPatterns = [
    /\b(before|previously|last time|last year|past)\b.*\b(used|hired|worked|called|had you)\b/i,
    /\b(used you|hired you|called you|had you out|you guys did)\b.*\b(before|previously|last|earlier)\b/i,
    /\b(repeat customer|returning customer|been a customer|loyal customer)\b/i,
    /\b(the work you did|the job you did|when you fixed|when you installed)\b/i,
  ];

  let confidence = 0;
  for (const pattern of returningPatterns) {
    if (pattern.test(t)) confidence += 0.5;
  }

  if (confidence > 0) {
    return {
      type: 'returning_customer',
      confidence: Math.min(confidence, 1.0),
      detail: `Customer appears to be returning: "${text.substring(0, 100)}"`,
      timestamp: new Date().toISOString(),
      internal: true,
    };
  }

  return null;
}

/**
 * Detect scheduling conflict language.
 */
function detectSchedulingConflict(text) {
  if (!text) return null;

  const t = text.toLowerCase();
  const conflictPatterns = /\b(can't|cannot|won't work|busy|unavailable|conflict|doesn't work|not available|booked)\b/i;

  if (conflictPatterns.test(t)) {
    return {
      type: 'scheduling_conflict',
      detail: `Customer may have scheduling conflict: "${text.substring(0, 100)}"`,
      timestamp: new Date().toISOString(),
      internal: true,
    };
  }

  return null;
}

/**
 * Detect customer hesitation.
 */
function detectHesitation(text) {
  if (!text) return null;

  const t = text.toLowerCase();
  const highHesitation = /\b(not sure|i don't know|let me think|i'll think about it|i have to think|i need to think)\b/i;
  const mediumHesitation = /\b(maybe|possibly|perhaps|not now|another time|let me check|i'll check)\b/i;
  const lowHesitation = /\b(um+|uh+|hmm|well\.\.\.|i guess|kinda|sort of)\b/i;

  let level = null;
  if (highHesitation.test(t)) level = 'high';
  else if (mediumHesitation.test(t)) level = 'medium';
  else if (lowHesitation.test(t)) level = 'low';

  if (level) {
    return {
      type: 'customer_hesitation',
      level,
      detail: `Customer hesitation detected (${level}): "${text.substring(0, 100)}"`,
      timestamp: new Date().toISOString(),
      internal: true,
    };
  }

  return null;
}

/**
 * Detect customer objection.
 */
function detectObjection(text) {
  if (!text) return null;

  const t = text.toLowerCase();
  const objectionPatterns = [
    { pattern: /\b(too expensive|too much money|overpriced|can't afford|out of.*budget|way too high)\b/i, type: 'price' },
    { pattern: /\b(not interested|don't need|don't want|no thanks|I'm good|I'll pass|not right now)\b/i, type: 'disinterest' },
    { pattern: /\b(call me back|call back later|another time|next week|next month|after the holidays)\b/i, type: 'timing' },
    { pattern: /\b(getting other|shopping around|other quote|another estimate|comparing|getting quotes)\b/i, type: 'competition' },
    { pattern: /\b(do it myself|diy|my husband|my wife|my friend|someone else|another company)\b/i, type: 'alternative' },
  ];

  for (const { pattern, type } of objectionPatterns) {
    if (pattern.test(t)) {
      return {
        type: 'objection_detected',
        objection_type: type,
        detail: `Customer objection (${type}): "${text.substring(0, 100)}"`,
        timestamp: new Date().toISOString(),
        internal: true,
      };
    }
  }

  return null;
}

/**
 * Detect need for escalation to human.
 */
function detectEscalationNeed(text) {
  if (!text) return null;

  const t = text.toLowerCase();
  const criticalPatterns = /\b(lawsuit|sue|attorney|lawyer|legal action)\b/i;
  const highPatterns = /\b(manager|supervisor|boss|owner|speak to someone|talk to someone|real person)\b/i;
  const mediumPatterns = /\b(complaint|unacceptable|ridiculous|terrible|awful|horrible|not happy|very unhappy)\b/i;

  let severity = null;
  if (criticalPatterns.test(t)) severity = 'critical';
  else if (highPatterns.test(t)) severity = 'high';
  else if (mediumPatterns.test(t)) severity = 'medium';

  if (severity) {
    return {
      type: 'escalation_recommended',
      severity,
      detail: `Escalation may be needed (${severity}): "${text.substring(0, 100)}"`,
      timestamp: new Date().toISOString(),
      internal: true,
    };
  }

  return null;
}

/**
 * Process a transcript segment through all pattern detectors.
 * Emits internal_guidance events for each detection.
 *
 * @param {Object} event — transcript_segment event from EventBus
 */
function handleTranscriptSegment(event) {
  const sessionId = event.sessionId;
  const text = event.data?.text || event.data?.segment?.text || '';

  if (!text || !sessionId) return;

  const detections = [];

  // Run all detectors
  const emergency = detectEmergency(text);
  if (emergency) detections.push(emergency);

  const highValue = detectHighValue(text);
  if (highValue) detections.push(highValue);

  const pricing = detectPricingDiscussion(text);
  if (pricing) detections.push(pricing);

  const returning = detectReturningCustomer(text);
  if (returning) detections.push(returning);

  const conflict = detectSchedulingConflict(text);
  if (conflict) detections.push(conflict);

  const hesitation = detectHesitation(text);
  if (hesitation) detections.push(hesitation);

  const objection = detectObjection(text);
  if (objection) detections.push(objection);

  const escalation = detectEscalationNeed(text);
  if (escalation) detections.push(escalation);

  // Store guidance per session
  if (detections.length > 0) {
    if (!_sessionGuidance.has(sessionId)) {
      _sessionGuidance.set(sessionId, []);
    }
    _sessionGuidance.get(sessionId).push(...detections);

    // Emit each detection as an internal_guidance event
    for (const detection of detections) {
      console.log(`[EventIntel] Guidance for session ${sessionId}: ${detection.type} (${detection.severity || detection.level || 'info'})`);
    }
  }
}

/**
 * Get guidance events for a session.
 *
 * @param {string} sessionId
 * @returns {Array<Object>} Array of guidance events
 */
function getSessionGuidance(sessionId) {
  return _sessionGuidance.get(sessionId) || [];
}

/**
 * Clear guidance for a session.
 *
 * @param {string} sessionId
 */
function clearSessionGuidance(sessionId) {
  _sessionGuidance.delete(sessionId);
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
    // Clean up session guidance on completion
    clearSessionGuidance(event.sessionId);
  });

  // ── Transcript segment handler (Part 4) ──
  const { TRANSCRIPT_EVENT_TYPE } = require('./transcriptStream');
  on(TRANSCRIPT_EVENT_TYPE, (event) => {
    handleTranscriptSegment(event);
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
  handleTranscriptSegment,
  detectEmergency,
  detectHighValue,
  detectPricingDiscussion,
  detectReturningCustomer,
  detectSchedulingConflict,
  detectHesitation,
  detectObjection,
  detectEscalationNeed,
  getSessionGuidance,
  clearSessionGuidance,
  registerIntelligenceHandlers,
};
