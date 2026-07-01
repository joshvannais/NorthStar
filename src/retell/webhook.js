/**
 * Retell AI webhook handler.
 * Receives call events from Retell AI and processes them.
 * 
 * Events:
 * - call_started: A new call has started
 * - call_ended: A call has ended (includes transcript)
 * - call_analyzed: Retell has analyzed the call and extracted structured data
 */

const { addLead } = require('../leads/store');
const { appendLead } = require('../sheets/client');
const { sendLeadNotification: sendSms } = require('../notifications/sms');
const { sendLeadNotification: sendEmail } = require('../notifications/email');

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

  let lead = null;

  if (payload.event === 'call_analyzed') {
    // Best case: Retell has structured analysis
    lead = parseLeadFromAnalysis(payload);
  } else if (payload.event === 'call_ended') {
    // Fallback: parse from transcript
    lead = parseLeadFromTranscript(payload.transcript || '');
  }

  if (!lead) {
    console.log('[Webhook] No lead data extracted — skipping.');
    return { received: true, processed: false };
  }

  // Store lead in memory
  const savedLead = addLead(lead);

  // Save to Google Sheets
  await appendLead(savedLead);

  // Send notifications
  await Promise.allSettled([
    sendSms(savedLead),
    sendEmail(savedLead),
  ]);

  console.log(`[Webhook] Lead processed: ${savedLead.id} — ${savedLead.customerName}`);

  return { received: true, processed: true, leadId: savedLead.id };
}

module.exports = { handleWebhook };