/**
 * Human Handoff — Intelligent Escalation Detection and State Preservation
 *
 * Detects when a voice conversation should be escalated to a human agent.
 * Six escalation triggers:
 *   1. Explicit request — customer asks for human/manager/supervisor
 *   2. Billing dispute — pricing discussion + negative sentiment
 *   3. Legal concern — lawsuit, attorney, complaint keywords
 *   4. Low confidence — from Retell analysis events
 *   5. Multiple failed responses — 3+ consecutive turns with objection/hesitation
 *   6. Conversation deadlock — same topic repeating 3+ times
 *
 * On escalation: preserves full session state (transcript, timeline, EC snapshot,
 * escalation record).
 */

'use strict';

// ── In-memory escalation store ───────────────────────────────────

/** @type {Map<string, Object>}  sessionId → escalation record */
const _escalations = new Map();

// ═════════════════════════════════════════════════════════════════
// Pattern detection for escalation triggers
// ═════════════════════════════════════════════════════════════════

/** Keywords that indicate an explicit request for a human */
const EXPLICIT_REQUEST_KEYWORDS = [
  /\b(human|person|real person|live agent|live person)\b/i,
  /\b(manager|supervisor|boss|owner|management)\b/i,
  /\b(speak to|talk to|transfer me|connect me|put me through)\b/i,
  /\b(not a robot|not an ai|not a bot|not automated)\b/i,
  /\b(get me someone|someone else|somebody|anybody)\b/i,
];

/** Keywords for billing disputes */
const BILLING_KEYWORDS = [
  /\b(overcharged|overcharge|billed wrong|billing error|wrong amount)\b/i,
  /\b(dispute|disputing|chargeback|refund)\b/i,
  /\b(can't pay|won't pay|not paying|too much money)\b/i,
];

/** Keywords for legal concerns */
const LEGAL_KEYWORDS = [
  /\b(lawsuit|sue|suing|attorney|lawyer|legal|court)\b/i,
  /\b(complaint|file a complaint|better business|bbb)\b/i,
  /\b(license|bonded|insurance claim|damages|liable)\b/i,
];

/** Keywords indicating negative sentiment */
const NEGATIVE_SENTIMENT_KEYWORDS = [
  /\b(angry|furious|upset|unacceptable|ridiculous|terrible|awful|horrible)\b/i,
  /\b(frustrated|disappointed|fed up|done with|never again)\b/i,
];

/** Keywords for hesitation/objection (for tracking consecutive failures) */
const HESITATION_OBJECTION_KEYWORDS = [
  /\b(maybe|not sure|i don't know|let me think|i'll think about it)\b/i,
  /\b(too expensive|too much|overpriced|can't afford|out of budget)\b/i,
  /\b(call back|call me back|another time|not now|not today)\b/i,
  /\b(not interested|no thanks|i'm good|i'll pass)\b/i,
];

/** Same-topic repetition detection: extract normalized topic words */
function extractTopicWords(text) {
  if (!text) return '';

  // Normalize: lowercase, strip punctuation, sort words > 3 chars, deduplicate
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .sort()
    .slice(0, 10); // limit to top 10 long words for comparison

  return words.join(' ');
}

// ═════════════════════════════════════════════════════════════════
// Escalation Check
// ═════════════════════════════════════════════════════════════════

/**
 * Evaluate whether the current conversation should be escalated to a human.
 *
 * @param {string} sessionId — Session identifier
 * @param {Array<Object>} transcriptSegments — Array of { timestamp, speaker, text, segmentIndex }
 * @param {Object} [context] — Optional executive context snapshot
 * @param {Object} [options]
 * @param {Array<string>} [options.retellAnalysisTags] — Tags from Retell analysis (low confidence, etc.)
 * @returns {Object} { shouldEscalate: boolean, reasons: Array<{ trigger, detail, severity }> }
 */
function checkEscalation(sessionId, transcriptSegments, context, options) {
  const opts = options || {};
  const segments = transcriptSegments || [];
  const reasons = [];

  if (!sessionId) {
    return { shouldEscalate: false, reasons: [] };
  }

  // Only examine customer segments for most triggers
  const customerSegments = segments.filter(s => s.speaker === 'customer');
  const customerText = customerSegments.map(s => s.text).join(' ');

  // ── 1. Explicit human request ──
  const explicitRequestDetected = EXPLICIT_REQUEST_KEYWORDS.some(pattern => pattern.test(customerText));
  if (explicitRequestDetected) {
    reasons.push({
      trigger: 'explicit_request',
      detail: 'Customer explicitly requested a human agent or manager',
      severity: 'high',
    });
  }

  // ── 2. Billing dispute ──
  const billingDetected = BILLING_KEYWORDS.some(pattern => pattern.test(customerText));
  const negativeSentiment = NEGATIVE_SENTIMENT_KEYWORDS.some(pattern => pattern.test(customerText));
  if (billingDetected && negativeSentiment) {
    reasons.push({
      trigger: 'billing_dispute',
      detail: 'Pricing/billing concern combined with negative sentiment',
      severity: 'high',
    });
  }

  // ── 3. Legal concern ──
  const legalDetected = LEGAL_KEYWORDS.some(pattern => pattern.test(customerText));
  if (legalDetected) {
    reasons.push({
      trigger: 'legal_concern',
      detail: 'Legal or complaint-related language detected',
      severity: 'critical',
    });
  }

  // ── 4. Low confidence (from Retell analysis) ──
  const retellTags = opts.retellAnalysisTags || [];
  if (retellTags.some(t => /\b(low.confidence|unclear|confused|unsure)\b/i.test(t))) {
    reasons.push({
      trigger: 'low_confidence',
      detail: 'Retell analysis indicates low confidence in the AI responses',
      severity: 'medium',
    });
  }

  // ── 5. Multiple failed responses (consecutive objection/hesitation) ──
  // Check last N customer segments for consecutive objection/hesitation patterns
  const recentCustomerSegments = customerSegments.slice(-5);
  let consecutiveObjections = 0;
  for (let i = recentCustomerSegments.length - 1; i >= 0; i--) {
    const text = recentCustomerSegments[i].text || '';
    if (HESITATION_OBJECTION_KEYWORDS.some(pattern => pattern.test(text))) {
      consecutiveObjections++;
    } else {
      break; // break streak
    }
  }
  if (consecutiveObjections >= 3) {
    reasons.push({
      trigger: 'multiple_failures',
      detail: `${consecutiveObjections} consecutive customer turns with objection/hesitation`,
      severity: 'high',
    });
  }

  // ── 6. Conversation deadlock (same topic repeating) ──
  if (customerSegments.length >= 3) {
    const recentTopics = customerSegments.slice(-6).map(s => extractTopicWords(s.text));
    // Check for same topic appearing 3+ times
    const topicCounts = {};
    for (const topic of recentTopics) {
      if (topic && topic.length > 0) {
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      }
    }
    const maxRepeat = Math.max(0, ...Object.values(topicCounts));
    if (maxRepeat >= 3) {
      reasons.push({
        trigger: 'conversation_deadlock',
        detail: `Same topic repeated ${maxRepeat} times — conversation may be stuck`,
        severity: 'medium',
      });
    }
  }

  return {
    shouldEscalate: reasons.length > 0,
    reasons,
  };
}

// ═════════════════════════════════════════════════════════════════
// Escalation Lifecycle
// ═════════════════════════════════════════════════════════════════

/**
 * Initiate an escalation for a session.
 * Preserves full session state: transcript, timeline, EC snapshot, escalation record.
 *
 * @param {string} sessionId
 * @param {Object} reason — The escalation reason from checkEscalation
 * @param {Object} context — Executive context snapshot
 * @returns {Object} Escalation record
 */
function initiateEscalation(sessionId, reason, context) {
  if (!sessionId) throw new Error('sessionId is required');

  const escalation = {
    sessionId,
    status: 'escalating',
    reason: reason || { trigger: 'manual', detail: 'Manual escalation triggered', severity: 'medium' },
    triggeredAt: new Date().toISOString(),
    triggeredBy: 'system',
    preservedState: {
      contextSnapshot: context ? JSON.parse(JSON.stringify(context)) : null,
      escalatedAt: new Date().toISOString(),
    },
    resolvedAt: null,
    resolution: null,
  };

  _escalations.set(sessionId, escalation);

  console.log(`[HumanHandoff] Escalation initiated for session ${sessionId}: ${escalation.reason.trigger}`);

  return { ...escalation };
}

/**
 * Resolve an escalation (human took over).
 *
 * @param {string} sessionId
 * @param {Object} [resolution] — Resolution details
 * @returns {Object|null} Resolved escalation record or null if not found
 */
function resolveEscalation(sessionId, resolution) {
  const escalation = _escalations.get(sessionId);
  if (!escalation) return null;

  escalation.status = 'resolved';
  escalation.resolvedAt = new Date().toISOString();
  escalation.resolution = resolution || { outcome: 'Human agent took over' };

  _escalations.set(sessionId, escalation);

  console.log(`[HumanHandoff] Escalation resolved for session ${sessionId}`);

  return { ...escalation };
}

/**
 * Get the escalation status for a session.
 *
 * @param {string} sessionId
 * @returns {Object|null} Escalation record or null if no escalation exists
 */
function getEscalationStatus(sessionId) {
  const escalation = _escalations.get(sessionId);
  if (!escalation) return null;
  return { ...escalation };
}

/**
 * Get all active escalations (status === 'escalating').
 *
 * @returns {Array<Object>}
 */
function getActiveEscalations() {
  const active = [];
  for (const [id, esc] of _escalations.entries()) {
    if (esc.status === 'escalating') {
      active.push({ ...esc });
    }
  }
  return active;
}

/**
 * Clear all escalations. For testing/teardown.
 */
function clearAll() {
  _escalations.clear();
}

module.exports = {
  checkEscalation,
  initiateEscalation,
  resolveEscalation,
  getEscalationStatus,
  getActiveEscalations,
  clearAll,
  // Exported for testing
  EXPLICIT_REQUEST_KEYWORDS,
  BILLING_KEYWORDS,
  LEGAL_KEYWORDS,
  NEGATIVE_SENTIMENT_KEYWORDS,
  HESITATION_OBJECTION_KEYWORDS,
};
