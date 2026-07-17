/**
 * Retell AI webhook handler.
 * Receives call events from Retell AI and processes them.
 *
 * Also advances the demo session state machine for active demo calls.
 *
 * Events:
 * - call_started: A new call has started
 * - call_ended: A call has ended (includes transcript)
 * - call_analyzed: Retell has analyzed the call and extracted structured data
 * - transcript: Live transcript update during a call (requires Retell streaming)
 */

const { addLead } = require('../leads/store');
const { appendLead } = require('../sheets/client');
const { sendLeadNotification: sendSms } = require('../notifications/sms');
const { sendLeadNotification: sendEmail } = require('../notifications/email');

/**
 * Get the demo sessions module dynamically to avoid circular deps.
 * Demo sessions are looked up by Retell call_id.
 */
function getDemoSession(callId) {
  try {
    const demo = require('../routes/demo');
    if (demo.demoSessions) {
      for (const [, session] of demo.demoSessions) {
        if (session.callId === callId) return session;
      }
    }
  } catch (e) {
    // Demo module not available — non-demo call
  }
  return null;
}

function advanceDemoSession(callId, toState) {
  try {
    const demo = require('../routes/demo');
    if (demo.advanceCallState) {
      for (const [sessionId, session] of demo.demoSessions) {
        if (session.callId === callId) {
          demo.advanceCallState(sessionId, toState);
          return sessionId;
        }
      }
    }
  } catch (e) {
    // Not a demo call
  }
  return null;
}

/**
 * Parse structured lead info from Retell's call analysis.
 * Retell can return custom LLM output — we parse it here.
 */
function parseLeadFromAnalysis(analysis) {
  const data = analysis?.call_analysis?.custom_data || {};

  return {
    customerName: data.customer_name || data.name || '',
    phoneNumber: data.phone_number || data.phone || '',
    address: data.property_address || data.address || '',
    serviceRequested: data.service_requested || data.service || '',
    preferredTime: data.preferred_time || data.preferred_appointment || '',
    urgency: data.urgency || data.emergency || '',
    callOutcome: data.call_outcome || data.outcome || 'Lead captured',
    notes: data.notes || data.summary || '',
  };
}

/**
 * Parse lead from transcript (fallback when analysis isn't available).
 * Uses basic heuristics to extract info from call transcript.
 */
function parseLeadFromTranscript(transcript) {
  // Simple extraction — in production this would use an LLM
  const text = transcript || '';
  const lines = text.split('\n').filter(Boolean);

  return {
    customerName: extractField(lines, ['name', 'customer', 'caller']) || '',
    phoneNumber: extractPhone(text) || '',
    address: extractField(lines, ['address', 'property', 'location']) || '',
    serviceRequested: extractField(lines, ['service', 'need', 'help', 'looking for']) || '',
    preferredTime: extractField(lines, ['time', 'appointment', 'schedule', 'when']) || '',
    urgency: detectUrgency(text),
    callOutcome: 'Call completed',
    notes: text.substring(0, 500),
  };
}

function extractField(lines, keywords) {
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        // Return the value after the keyword/colon
        const parts = line.split(':');
        if (parts.length > 1) {
          return parts.slice(1).join(':').trim();
        }
        return line.trim();
      }
    }
  }
  return '';
}

function extractPhone(text) {
  const phoneRegex = /(\+?1?\s*[-.]?\s*\(?\d{3}\)?\s*[-.]?\s*\d{3}\s*[-.]?\s*\d{4})/;
  const match = text.match(phoneRegex);
  return match ? match[1].trim() : '';
}

function detectUrgency(text) {
  const urgent = ['emergency', 'urgent', 'storm', 'flood', 'fire', 'asap', 'right now', 'broken', 'leak'];
  const lower = text.toLowerCase();
  for (const word of urgent) {
    if (lower.includes(word)) return 'high';
  }
  return '';
}

/**
 * Main webhook handler for Retell AI call events.
 */
async function handleWebhook(payload) {
  console.log(`[Webhook] Received event: ${payload.event} (call: ${payload.call_id})`);

  const callId = payload.call_id;

  // ── Demo session state management ──
  if (payload.event === 'call_started') {
    advanceDemoSession(callId, 'dialing');
    return { received: true, processed: true };
  }

  if (payload.event === 'call_ringing') {
    advanceDemoSession(callId, 'ringing');
    return { received: true, processed: true };
  }

  if (payload.event === 'call_answered') {
    advanceDemoSession(callId, 'answered');
    return { received: true, processed: true };
  }

  if (payload.event === 'call_media_connected') {
    advanceDemoSession(callId, 'media_connected');
    return { received: true, processed: true };
  }

  // ── Live transcript streaming ──
  if (payload.event === 'transcript') {
    const session = getDemoSession(callId);
    if (session) {
      // Store the transcript line
      const line = {
        speaker: payload.role || 'customer',
        text: payload.transcript || payload.text || '',
        timestamp: new Date().toISOString(),
      };
      if (!session.transcriptLines) session.transcriptLines = [];
      session.transcriptLines.push(line);

      // If not yet in live state, advance
      if (session.callStatus === 'media_connected' || session.callStatus === 'answered') {
        const demo = require('../routes/demo');
        if (demo.advanceCallState) {
          for (const [sid] of demo.demoSessions) {
            if (demo.demoSessions.get(sid)?.callId === callId) {
              demo.advanceCallState(sid, 'live');
              break;
            }
          }
        }
      }
    }
    return { received: true, processed: true };
  }

  // ── Call ended ──
  if (payload.event === 'call_ended') {
    advanceDemoSession(callId, 'completed');

    // Parse lead from transcript
    const lead = parseLeadFromTranscript(payload.transcript || '');
    if (lead) {
      const savedLead = addLead(lead);
      await appendLead(savedLead);
      await Promise.allSettled([
        sendSms(savedLead),
        sendEmail(savedLead),
      ]);
      console.log(`[Webhook] Lead processed: ${savedLead.id} — ${savedLead.customerName}`);
      return { received: true, processed: true, leadId: savedLead.id };
    }
    return { received: true, processed: false };
  }

  // ── Call analyzed ──
  if (payload.event === 'call_analyzed') {
    advanceDemoSession(callId, 'polaris_summary');

    const lead = parseLeadFromAnalysis(payload);
    if (lead) {
      const savedLead = addLead(lead);
      await appendLead(savedLead);
      await Promise.allSettled([
        sendSms(savedLead),
        sendEmail(savedLead),
      ]);
      console.log(`[Webhook] Lead processed (analysis): ${savedLead.id} — ${savedLead.customerName}`);
      return { received: true, processed: true, leadId: savedLead.id };
    }
    return { received: true, processed: false };
  }

  console.log(`[Webhook] Unknown event type: ${payload.event} — skipping.`);
  return { received: true, processed: false };
}

module.exports = { handleWebhook };