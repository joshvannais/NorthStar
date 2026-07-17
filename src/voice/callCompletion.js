/**
 * Call Completion Pipeline — Part 7
 *
 * Triggered when call_ended event fires. Executes the full post-call
 * pipeline:
 *
 * 1. Generate Executive Summary (from transcript + context)
 * 2. Generate Action Items
 * 3. Generate Follow-up recommendations
 * 4. Update lead status
 * 5. Generate Timeline entry
 * 6. Persist to SQLite voice_sessions table
 * 7. Close session
 */

'use strict';

const db = require('../db');
const { addLead, updateLead, getLead } = require('../leads/store');
const { getContext } = require('./eventIntelligence');

/**
 * Call Summary model:
 * {
 *   callId, duration, sentiment, keyTopics,
 *   actionItems, leadUpdate, transcript
 * }
 */

// ── Summary Generation ─────────────────────────────────────────

/**
 * Generate an executive summary from call data + intelligence context.
 *
 * @param {Object} callData - Raw call data from webhook
 * @param {Object} context - Frozen executive context
 * @returns {Object} CallSummary
 */
function generateExecutiveSummary(callData, context) {
  const transcript = callData.transcript || '';
  const analysis = callData.analysis || {};

  // Extract key topics from transcript using simple keyword detection
  const keyTopics = extractKeyTopics(transcript);
  const sentiment = estimateSentiment(transcript);

  return {
    callId: callData.callId || 'unknown',
    duration: callData.duration || 0,
    durationFormatted: formatDuration(callData.duration || 0),
    sentiment,
    keyTopics,
    summary: analysis.summary || transcript.substring(0, 500),
    customerName: analysis.customer_name || extractCustomerName(transcript),
    serviceRequested: analysis.service_requested || extractServiceType(transcript),
    estimatedAmount: analysis.estimated_amount || 0,
    appointmentRequested: !!analysis.preferred_time,
    preferredTime: analysis.preferred_time || '',
  };
}

/**
 * Generate action items from call analysis.
 *
 * @param {Object} callData - Raw call data
 * @param {Object} summary - Generated call summary
 * @returns {Array<Object>} Action items
 */
function generateActionItems(callData, summary) {
  const items = [];

  // Always add a follow-up action
  items.push({
    type: 'follow_up',
    priority: summary.appointmentRequested ? 'high' : 'medium',
    description: summary.appointmentRequested
      ? `Schedule estimate for ${summary.preferredTime || 'customer-preferred time'}`
      : 'Follow up with customer within 24 hours',
    dueBy: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  // If service was discussed but no appointment, add estimate action
  if (summary.serviceRequested && !summary.appointmentRequested) {
    items.push({
      type: 'prepare_estimate',
      priority: 'medium',
      description: `Prepare estimate for ${summary.serviceRequested}`,
      dueBy: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
  }

  // If no customer name was captured, flag for enrichment
  if (!summary.customerName || summary.customerName === 'Unknown') {
    items.push({
      type: 'enrich_lead',
      priority: 'low',
      description: 'Enrich lead with customer name and details',
      dueBy: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    });
  }

  return items;
}

/**
 * Generate follow-up recommendations.
 *
 * @param {Object} summary - Call summary
 * @param {Object} context - Frozen context (optional)
 * @returns {Array<Object>} Recommendations
 */
function generateFollowUpRecommendations(summary, context) {
  const recommendations = [];

  if (summary.appointmentRequested) {
    recommendations.push({
      action: 'schedule_estimate',
      description: 'Customer requested an estimate appointment',
      priority: 'high',
      suggestedTime: summary.preferredTime || 'Next available',
    });
  }

  if (summary.sentiment === 'positive') {
    recommendations.push({
      action: 'send_thank_you',
      description: 'Send thank-you message to reinforce positive experience',
      priority: 'medium',
    });
  }

  if (summary.sentiment === 'negative' || summary.sentiment === 'frustrated') {
    recommendations.push({
      action: 'service_recovery',
      description: 'Initiate service recovery — personal follow-up call',
      priority: 'high',
    });
  }

  if (summary.keyTopics && (summary.keyTopics.includes('pricing') || summary.keyTopics.includes('cost'))) {
    recommendations.push({
      action: 'send_estimate',
      description: 'Customer discussed pricing — send detailed estimate',
      priority: 'medium',
    });
  }

  return recommendations;
}

// ── Lead Management ────────────────────────────────────────────

/**
 * Update or create a lead from call completion data.
 *
 * @param {Object} summary - Call summary
 * @param {Object} callData - Raw call data
 * @returns {Object} Updated lead
 */
function updateLeadFromCall(summary, callData) {
  const leadData = {
    customerName: summary.customerName || callData.fromNumber || 'Unknown Caller',
    phoneNumber: callData.fromNumber || '',
    serviceRequested: summary.serviceRequested || 'General Inquiry',
    preferredTime: summary.preferredTime || '',
    urgency: summary.appointmentRequested ? 'medium' : 'low',
    callOutcome: summary.appointmentRequested ? 'Appointment requested' : 'Call completed',
    notes: summary.summary || 'Call completed via Retell AI',
    duration: summary.duration,
    outcome: summary.appointmentRequested ? 'estimate-scheduled' : 'lead-captured',
  };

  // Try to find existing lead by phone number
  const allLeads = require('../leads/store').getAllLeads();
  const existingLead = allLeads.find(l =>
    l.phoneNumber === callData.fromNumber && l.phoneNumber
  );

  if (existingLead) {
    return updateLead(existingLead.id, leadData);
  }

  return addLead(leadData);
}

/**
 * Generate a timeline entry for the call.
 *
 * @param {Object} summary - Call summary
 * @param {string} leadId - Lead ID
 * @returns {Object} Timeline entry
 */
function generateTimelineEntry(summary, leadId) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    leadId,
    type: 'call',
    timestamp: new Date().toISOString(),
    title: summary.appointmentRequested ? 'Estimate Requested via AI' : 'Call Completed via AI',
    description: summary.summary,
    metadata: {
      callId: summary.callId,
      duration: summary.duration,
      sentiment: summary.sentiment,
      keyTopics: summary.keyTopics,
      appointmentRequested: summary.appointmentRequested,
    },
  };
}

// ── Persistence ────────────────────────────────────────────────

/**
 * Persist call completion to the voice_sessions table.
 *
 * @param {Object} session - Full session data
 * @returns {Promise<Object>} Persisted session
 */
async function persistVoiceSession(session) {
  if (!db.isAvailable()) {
    console.log('[CallCompletion] DB not available — skipping voice_sessions persist');
    return null;
  }

  try {
    const result = await db.query(
      `INSERT INTO voice_sessions (
        call_id, session_status, duration_ms, sentiment, key_topics,
        action_items, lead_id, transcript, summary, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (call_id) DO UPDATE SET
        session_status = EXCLUDED.session_status,
        duration_ms = EXCLUDED.duration_ms,
        sentiment = EXCLUDED.sentiment,
        key_topics = EXCLUDED.key_topics,
        action_items = EXCLUDED.action_items,
        lead_id = EXCLUDED.lead_id,
        transcript = EXCLUDED.transcript,
        summary = EXCLUDED.summary,
        completed_at = EXCLUDED.completed_at
      RETURNING *`,
      [
        session.callId,
        session.status || 'completed',
        session.duration || 0,
        session.sentiment || 'neutral',
        JSON.stringify(session.keyTopics || []),
        JSON.stringify(session.actionItems || []),
        session.leadId || null,
        session.transcript || '',
        session.summary || '',
        session.startedAt || new Date().toISOString(),
        new Date().toISOString(),
      ]
    );

    console.log(`[CallCompletion] Voice session persisted: ${session.callId}`);
    return result.rows[0];
  } catch (err) {
    console.error('[CallCompletion] Failed to persist voice session:', err.message);
    return null;
  }
}

// ── Main Pipeline ──────────────────────────────────────────────

/**
 * Execute the full call completion pipeline.
 *
 * Called when call_ended / call_analyzed event fires.
 *
 * @param {Object} event - The call_completed business event
 * @returns {Promise<Object>} Pipeline result
 */
async function executeCallCompletion(event) {
  const callData = event.data || {};
  const context = getContext();
  const callId = callData.callId || event.sessionId || 'unknown';

  console.log(`[CallCompletion] Starting pipeline for call: ${callId}`);

  const result = {
    callId,
    completed: false,
    steps: {},
    errors: [],
  };

  try {
    // Step 1: Generate Executive Summary
    const summary = generateExecutiveSummary(callData, context);
    result.steps.summary = summary;
  } catch (err) {
    result.errors.push({ step: 'summary', error: err.message });
  }

  try {
    // Step 2: Generate Action Items
    const actionItems = generateActionItems(callData, result.steps.summary || {});
    result.steps.actionItems = actionItems;
  } catch (err) {
    result.errors.push({ step: 'actionItems', error: err.message });
  }

  try {
    // Step 3: Generate Follow-up recommendations
    const recommendations = generateFollowUpRecommendations(
      result.steps.summary || {},
      context
    );
    result.steps.recommendations = recommendations;
  } catch (err) {
    result.errors.push({ step: 'recommendations', error: err.message });
  }

  try {
    // Step 4: Update lead status
    const lead = updateLeadFromCall(result.steps.summary || {}, callData);
    result.steps.lead = lead;
  } catch (err) {
    result.errors.push({ step: 'leadUpdate', error: err.message });
  }

  try {
    // Step 5: Generate Timeline entry
    const leadId = result.steps.lead?.id || null;
    const timelineEntry = generateTimelineEntry(result.steps.summary || {}, leadId);
    result.steps.timelineEntry = timelineEntry;
  } catch (err) {
    result.errors.push({ step: 'timeline', error: err.message });
  }

  try {
    // Step 6: Persist to DB
    const sessionData = {
      callId,
      status: 'completed',
      duration: result.steps.summary?.duration || 0,
      sentiment: result.steps.summary?.sentiment || 'neutral',
      keyTopics: result.steps.summary?.keyTopics || [],
      actionItems: result.steps.actionItems || [],
      leadId: result.steps.lead?.id || null,
      transcript: callData.transcript || '',
      summary: result.steps.summary?.summary || '',
    };
    const persisted = await persistVoiceSession(sessionData);
    result.steps.persisted = !!persisted;
  } catch (err) {
    result.errors.push({ step: 'persist', error: err.message });
  }

  result.completed = true;
  result.stepCount = Object.keys(result.steps).length;
  result.errorCount = result.errors.length;

  console.log(`[CallCompletion] Pipeline complete: ${callId} (${result.stepCount} steps, ${result.errorCount} errors)`);

  return result;
}

// ── Helper Functions ───────────────────────────────────────────

/**
 * Extract key topics from transcript using keyword matching.
 */
function extractKeyTopics(transcript) {
  const topics = [];
  const lower = (transcript || '').toLowerCase();

  const topicMap = {
    pricing: /pric|cost|how much|rate|charge|quote|estimate|dollar/i,
    scheduling: /schedule|appointment|when|available|time|day|week|month|tomorrow/i,
    emergency: /emergency|urgent|asap|right now|flood|leak|broken|storm/i,
    service: /service|repair|install|replace|remove|fix|maintenance/i,
    warranty: /warranty|guarantee|insurance|coverage/i,
    payment: /payment|pay|finance|credit|card|cash|check/i,
    competitor: /other company|competitor|someone else|cheaper/i,
  };

  for (const [topic, pattern] of Object.entries(topicMap)) {
    if (pattern.test(lower)) {
      topics.push(topic);
    }
  }

  return topics;
}

/**
 * Estimate sentiment from transcript.
 */
function estimateSentiment(transcript) {
  const lower = (transcript || '').toLowerCase();

  const positiveWords = /great|awesome|perfect|thank|appreciate|wonderful|excellent|happy|pleased|love/gi;
  const negativeWords = /frustrat|angry|upset|terrible|awful|bad|unacceptable|disappoint|ridiculous|waste/gi;
  const urgentWords = /emergency|urgent|asap|right now|immediately|flood|leak|broken/gi;

  const positiveCount = (lower.match(positiveWords) || []).length;
  const negativeCount = (lower.match(negativeWords) || []).length;
  const urgentCount = (lower.match(urgentWords) || []).length;

  if (urgentCount > 2 && negativeCount > 0) return 'frustrated';
  if (negativeCount > positiveCount) return 'negative';
  if (urgentCount > 2) return 'urgent';
  if (positiveCount > negativeCount) return 'positive';
  return 'neutral';
}

/**
 * Extract customer name from transcript (simple heuristic).
 */
function extractCustomerName(transcript) {
  const match = (transcript || '').match(/(?:my name is|this is|I'm|I am) ([A-Z][a-z]+ [A-Z][a-z]+)/);
  return match ? match[1] : 'Unknown';
}

/**
 * Extract service type from transcript.
 */
function extractServiceType(transcript) {
  const services = [
    'tree removal', 'tree trimming', 'stump grinding', 'roof repair',
    'roof replacement', 'gutter cleaning', 'plumbing', 'electrical',
    'HVAC', 'painting', 'landscaping', 'snow removal', 'demolition',
    'fencing', 'concrete', 'deck building', 'window replacement',
  ];

  const lower = (transcript || '').toLowerCase();
  for (const service of services) {
    if (lower.includes(service)) return service;
  }
  return '';
}

/**
 * Format duration in ms to human-readable string.
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

module.exports = {
  executeCallCompletion,
  generateExecutiveSummary,
  generateActionItems,
  generateFollowUpRecommendations,
  updateLeadFromCall,
  generateTimelineEntry,
  persistVoiceSession,
  extractKeyTopics,
  estimateSentiment,
};
