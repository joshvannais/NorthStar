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

const { addLead, updateLead } = require('../leads/store');
const { appendLead } = require('../sheets/client');
const { sendLeadNotification: sendSms } = require('../notifications/sms');
const { sendLeadNotification: sendEmail } = require('../notifications/email');
const { generateExecutiveSummary, generateActionItems, generateFollowUpRecommendations, extractKeyTopics, estimateSentiment } = require('../voice/callCompletion');

// ── Webhook Diagnostics ──
// Global counters and event log for diagnostics endpoint
let webhookEventCounter = 0;
const webhookEventLog = []; // Last 50 events
const MAX_LOG_ENTRIES = 50;
let webhookStartedAt = new Date().toISOString();
let lastWebhookAt = null;

function logWebhookEvent(type, callId, detail) {
  const entry = {
    type,
    callId: callId || null,
    timestamp: new Date().toISOString(),
    detail: detail || null,
  };
  webhookEventLog.unshift(entry);
  if (webhookEventLog.length > MAX_LOG_ENTRIES) {
    webhookEventLog.pop();
  }
}

function getDiagnostics() {
  try {
    const demo = require('../routes/demo');
    const sessions = [];
    if (demo.demoSessions) {
      for (const [id, s] of demo.demoSessions) {
        sessions.push({
          sessionId: id,
          callId: s.callId || null,
          callStatus: s.callStatus || 'unknown',
          businessName: s.businessName || '—',
          createdAt: s.createdAt || null,
        });
      }
    }
    const config = require('../config');
    return {
      status: 'ok',
      webhookStartedAt,
      lastWebhookAt,
      totalEventsReceived: webhookEventCounter,
      recentEvents: webhookEventLog.slice(0, 10),
      activeSessions: sessions,
      retellPhoneNumbers: config.retell?.fromNumbers || config.retell?.phoneNumbers || [],
      retellAgentId: config.retell?.agentId || null,
      retellConfigured: !!(config.retell && config.retell.apiKey),
    };
  } catch (e) {
    return {
      status: 'error',
      error: e.message,
      totalEventsReceived: webhookEventCounter,
      recentEvents: webhookEventLog.slice(0, 10),
    };
  }
}

// ── SSE broadcast ──
// A list of active SSE connections keyed by demo session id
const sseConnections = new Map();

function addSSEConnection(sessionId, res) {
  if (!sseConnections.has(sessionId)) {
    sseConnections.set(sessionId, []);
  }
  sseConnections.get(sessionId).push(res);
}

function removeSSEConnection(sessionId, res) {
  const conns = sseConnections.get(sessionId);
  if (conns) {
    const idx = conns.indexOf(res);
    if (idx >= 0) conns.splice(idx, 1);
    if (conns.length === 0) sseConnections.delete(sessionId);
  }
}

function broadcastSSE(sessionId, event, data) {
  const conns = sseConnections.get(sessionId);
  console.log(`[Webhook:SSE] broadcast sessionId=${sessionId} event=${event} connections=${conns ? conns.length : 0}`);
  if (!conns || conns.length === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of conns) {
    try {
      res.write(payload);
    } catch (e) {
      // Client disconnected — will be cleaned up on next connection attempt
    }
  }
}

/**
 * Get the demo sessions module dynamically to avoid circular deps.
 * Demo sessions are looked up by Retell call_id.
 */
function getDemoSession(callId) {
  try {
    const demo = require('../routes/demo');
    if (demo.demoSessions) {
      const sessionCount = demo.demoSessions.size;
      for (const [sessionId, session] of demo.demoSessions) {
        if (session.callId === callId) {
          console.log(`[Webhook:Lookup] FOUND session for call_id=${callId} → sessionId=${sessionId} (of ${sessionCount} sessions)`);
          return session;
        }
      }
      console.log(`[Webhook:Lookup] NOT FOUND: call_id=${callId} not matched in ${sessionCount} active sessions`);
    } else {
      console.log('[Webhook:Lookup] No demo sessions map available');
    }
  } catch (e) {
    console.log(`[Webhook:Lookup] Error looking up demo session: ${e.message}`);
  }
  return null;
}

function advanceDemoSession(callId, toState) {
  try {
    const demo = require('../routes/demo');
    if (demo.advanceCallState) {
      for (const [sessionId, session] of demo.demoSessions) {
        if (session.callId === callId) {
          const prevState = session.callStatus;
          const result = demo.advanceCallState(sessionId, toState);
          console.log(`[Webhook:State] Session ${sessionId}: ${prevState} → ${toState} (result: ${result})`);
          // Broadcast state change via SSE
          broadcastSSE(sessionId, 'status', {
            callStatus: toState,
            previousStatus: prevState,
            timestamp: new Date().toISOString(),
          });
          return sessionId;
        }
      }
      console.log(`[Webhook:State] No session found for call_id=${callId} to advance to ${toState}`);
    }
  } catch (e) {
    console.log(`[Webhook:State] Error advancing state: ${e.message}`);
  }
  return null;
}

/**
 * Parse structured lead info from Retell's call analysis.
 * Retell can return custom LLM output — we parse it here.
 */
function parseLeadFromAnalysis(callData) {
  const data = callData?.call_analysis?.custom_data || {};

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
 * Generate an Executive Summary from call data and attach it to a lead.
 *
 * Includes: call outcome summary, key discussion points, sentiment assessment,
 * action items, follow-up recommendations, and a Polaris opportunity score placeholder.
 *
 * @param {string} leadId - The lead ID to update
 * @param {object} callData - The call data object (from payload.call or Retell API)
 */
function generateAndAttachSummary(leadId, callData) {
  try {
    const transcript = callData.transcript || '';
    const analysis = callData.call_analysis || {};
    const summaryData = {
      callId: callData.call_id,
      transcript,
      duration: callData.duration_ms || 0,
      analysis,
      fromNumber: callData.from_number || '',
    };

    const summary = generateExecutiveSummary(summaryData, {});
    const actionItems = generateActionItems(summaryData, summary);
    const recommendations = generateFollowUpRecommendations(summary, {});

    const topics = extractKeyTopics(transcript);
    const sentiment = estimateSentiment(transcript);

    const executiveSummary = {
      outcome: summary.summary || (transcript ? transcript.substring(0, 300) : 'Call completed'),
      callOutcome: summary.appointmentRequested ? 'Appointment requested' : 'Call completed',
      keyTopics: summary.keyTopics || topics,
      sentiment: summary.sentiment || sentiment,
      customerName: summary.customerName || '',
      serviceRequested: summary.serviceRequested || '',
      estimatedAmount: summary.estimatedAmount || 0,
      appointmentRequested: summary.appointmentRequested || false,
      preferredTime: summary.preferredTime || '',
      durationFormatted: summary.durationFormatted || '—',
      actionItems: (actionItems || []).map(a => ({
        type: a.type,
        priority: a.priority,
        description: a.description,
      })),
      recommendations: (recommendations || []).map(r => ({
        action: r.action,
        description: r.description,
        priority: r.priority,
      })),
      polarisOpportunityScore: {
        score: 'PENDING',
        placeholder: true,
        note: 'Full Polaris analysis will be generated when call_analyzed event fires',
      },
      generatedAt: new Date().toISOString(),
    };

    const updated = updateLead(leadId, { executiveSummary });
    if (updated) {
      console.log(`[Webhook] Executive summary attached to lead: ${leadId}`);
    }

    // Also store on the demo session if available for the post-call view
    try {
      const demoSession = getDemoSession(callId);
      if (demoSession) {
        demoSession.executiveSummary = executiveSummary;
      }
    } catch (e) {
      // Non-critical — just means the demo post-call view won't show summary
    }

    return executiveSummary;
  } catch (e) {
    console.warn(`[Webhook] Executive summary generation failed for lead ${leadId}: ${e.message}`);
    return null;
  }
}

/**
 * Main webhook handler for Retell AI call events.
 */
async function handleWebhook(payload) {
  // Retell webhook payload nests all call data under a "call" key.
  // Top-level: { event: "call_ended", call: { call_id, transcript, ... } }
  const call = payload.call || {};
  const callId = call.call_id || payload.call_id;
  const eventType = payload.event || 'unknown';

  // Increment global counter
  webhookEventCounter++;
  lastWebhookAt = new Date().toISOString();

  // Log EVERY incoming webhook
  console.log(`[Webhook:Incoming] #${webhookEventCounter} — event=${eventType} call_id=${callId} timestamp=${lastWebhookAt}`);
  logWebhookEvent(eventType, callId, `Received ${eventType} event`);

  // ── Demo session state management ──
  if (payload.event === 'call_started') {
    advanceDemoSession(callId, 'dialing');
    logWebhookEvent(eventType, callId, 'Advanced to dialing');
    return { received: true, processed: true };
  }

  if (payload.event === 'call_ringing') {
    advanceDemoSession(callId, 'ringing');
    logWebhookEvent(eventType, callId, 'Advanced to ringing');
    return { received: true, processed: true };
  }

  if (payload.event === 'call_answered') {
    advanceDemoSession(callId, 'answered');
    logWebhookEvent(eventType, callId, 'Advanced to answered');
    return { received: true, processed: true };
  }

  if (payload.event === 'call_media_connected') {
    advanceDemoSession(callId, 'media_connected');
    logWebhookEvent(eventType, callId, 'Advanced to media_connected');
    return { received: true, processed: true };
  }

  // ── Live transcript streaming ──
  if (payload.event === 'transcript' || payload.event === 'transcript_updated') {
    const session = getDemoSession(callId);
    console.log(`[Webhook:Transcript] callId=${callId} sessionFound=${!!session} event=${payload.event}`);
    if (session) {
      // Log the full payload for debugging
      const payloadLog = {
        event: payload.event,
        call_id: call.call_id || payload.call_id,
        role: call.role || payload.role,
        transcript: (call.transcript || payload.transcript || '').substring(0, 100),
        text: (call.text || payload.text || '').substring(0, 100),
        transcript_length: typeof (call.transcript || payload.transcript),
        has_transcript_object: Array.isArray(call.transcript_object || payload.transcript_object),
        has_words: Array.isArray(payload.words),
        content: (call.content || payload.content || '').substring(0, 100),
        other_keys: Object.keys(payload).filter(k => !['event','call','call_id','transcript','text','transcript_object','words','content','role','timestamp'].includes(k)),
      };
      console.log(`[Webhook:TranscriptPayload] ${JSON.stringify(payloadLog)}`);

      // Store the transcript line
      const line = {
        speaker: call.role === 'agent' ? 'ai' : (call.role === 'user' ? 'customer' : (payload.role === 'agent' ? 'ai' : (payload.role === 'user' ? 'customer' : 'customer'))),
        text: call.transcript || payload.transcript || call.text || payload.text || "",
        timestamp: new Date().toISOString(),
      };
      if (!session.transcriptLines) session.transcriptLines = [];
      session.transcriptLines.push(line);

      // Broadcast transcript via SSE
      broadcastSSE(session.id, 'transcript', {
        line,
        totalLines: session.transcriptLines.length,
      });

      // Advance through state machine to reach 'live'
      // Retell only sends call_started, transcript, call_ended, call_analyzed
      // So we must chain-advance through intermediate states when transcript arrives
      const demo = require('../routes/demo');
      if (demo.advanceCallState && demo.isValidTransition) {
        // Find the session id for this call
        let sid = null;
        for (const [id, s] of demo.demoSessions) {
          if (s.callId === callId) { sid = id; break; }
        }
        if (sid) {
          // Chain advance: dialing → ringing → answered → media_connected → live
          const chain = ['dialing', 'ringing', 'answered', 'media_connected', 'live'];
          const currentIdx = chain.indexOf(session.callStatus);
          if (currentIdx >= 0) {
            for (let i = currentIdx; i < chain.length - 1; i++) {
              const from = chain[i];
              const to = chain[i + 1];
              if (demo.isValidTransition(from, to)) {
                const result = demo.advanceCallState(sid, to);
                if (result) {
                  broadcastSSE(sid, 'status', {
                    callStatus: to,
                    previousStatus: from,
                    timestamp: new Date().toISOString(),
                  });
                  console.log(`[Webhook:Transcript] Advanced ${sid}: ${from} → ${to}`);
                }
              }
            }
          }

          // Update timer start once we hit 'answered' or beyond
          if (session.callStatus === 'answered' || session.callStatus === 'media_connected' || session.callStatus === 'live') {
            if (!session.startedAt) {
              session.startedAt = new Date().toISOString();
            }
          }
        }
      }
    } else {
      console.log(`[Webhook:Transcript] No demo session found for call_id=${callId} — transcript not stored`);
    }
    logWebhookEvent(eventType, callId, `Transcript: ${(call.transcript || payload.transcript || call.text || payload.text || '').substring(0, 60)} sessionFound=${!!session}`);
    return { received: true, processed: true };
  }

  // ── Call ended ──
  if (payload.event === 'call_ended') {
    // Chain-advance from current state through to completed.
    // This handles the case where Retell doesn't send intermediate webhook
    // events (call_started, transcript_updated) for conversation-flow agents.
    // If transcript data exists, the call connected — advance through live states.
    const demo = require('../routes/demo');
    if (demo.isValidTransition) {
      for (const [sid, s] of demo.demoSessions) {
        if (s.callId === callId) {
          const hasTranscript = call.transcript || payload.transcript || (Array.isArray(call.transcript_object || payload.transcript_object) && (call.transcript_object || payload.transcript_object).length > 0);
          if (hasTranscript && s.callStatus !== 'live' && s.callStatus !== 'completed') {
            // Call actually connected — advance through live states
            const toStates = ['ringing', 'answered', 'media_connected', 'live', 'completed'];
            const startIdx = toStates.indexOf(s.callStatus === 'dialing' ? 'ringing' : s.callStatus);
            if (startIdx < 0) {
              // Unknown state, jump to completed
              advanceDemoSession(callId, 'completed');
            } else {
              for (let i = startIdx; i < toStates.length; i++) {
                const next = toStates[i];
                if (demo.isValidTransition(s.callStatus, next)) {
                  const result = demo.advanceCallState(sid, next);
                  if (result) {
                    broadcastSSE(sid, 'status', {
                      callStatus: next,
                      previousStatus: toStates[i-1] || s.callStatus,
                      timestamp: new Date().toISOString(),
                    });
                    console.log(`[Webhook:CallEnded] Advanced ${sid}: → ${next}`);
                  }
                }
              }
            }
          } else {
            // Call didn't connect — advance directly to completed
            advanceDemoSession(callId, 'completed');
          }
          break;
        }
      }
    } else {
      advanceDemoSession(callId, 'completed');
    }
    logWebhookEvent(eventType, callId, 'Advanced to completed');

    // Parse lead from transcript
    const lead = parseLeadFromTranscript(call.transcript || payload.transcript || "");
    if (lead) {
      // Store transcript on the lead for display
      lead.transcript = call.transcript || payload.transcript || "";

      // Store demo session ID if this call matches a demo session
      const demoSession = getDemoSession(callId);
      if (demoSession && demoSession.id) {
        lead.demoSessionId = demoSession.id;
      }

      const savedLead = addLead(lead);

      // Generate executive summary from call data
      const es = generateAndAttachSummary(savedLead.id, call);

      // Broadcast executive summary via SSE
      if (demoSession && demoSession.id && es) {
        broadcastSSE(demoSession.id, 'executiveSummary', es);
      }

      await appendLead(savedLead);
      await Promise.allSettled([
        sendSms(savedLead),
        sendEmail(savedLead),
      ]);
      console.log(`[Webhook] Lead processed: ${savedLead.id} — ${savedLead.customerName}`);
      logWebhookEvent(eventType, callId, `Lead saved: ${savedLead.id}`);
      return { received: true, processed: true, leadId: savedLead.id };
    }
    logWebhookEvent(eventType, callId, 'No lead data extracted from transcript');
    return { received: true, processed: false };
  }

  // ── Call analyzed ──
  if (payload.event === 'call_analyzed') {
    advanceDemoSession(callId, 'polaris_summary');
    logWebhookEvent(eventType, callId, 'Advanced to polaris_summary');

    const lead = parseLeadFromAnalysis(call);
    if (lead) {
      // Store transcript on the lead for display
      lead.transcript = call.transcript || payload.transcript || call.call_analysis?.transcript || payload.call_analysis?.transcript || '';

      // Store demo session ID if this call matches a demo session
      const demoSession2 = getDemoSession(callId);
      if (demoSession2 && demoSession2.id) {
        lead.demoSessionId = demoSession2.id;
      }

      const savedLead = addLead(lead);

      // Generate executive summary from analysis + transcript
      const summary = generateAndAttachSummary(savedLead.id, call);

      // Update the Polaris score placeholder if we got real analysis data
      if (summary && (call.call_analysis || payload.call_analysis)) {
        try {
          const analysisData = call.call_analysis || payload.call_analysis || {};
          const analysisScore = {
            score: analysisData.call_success_probability
              ? `${Math.round(analysisData.call_success_probability * 100)}%`
              : 'GENERATED',
            confidence: analysisData.call_success_probability
              ? Math.round(analysisData.call_success_probability * 100)
              : 50,
            placeholder: false,
            source: 'Retell call_analyzed',
          };
          updateLead(savedLead.id, {
            polarisOpportunityScore: analysisScore,
            executiveSummary: {
              ...summary,
              polarisOpportunityScore: analysisScore,
            },
          });
        } catch (e) {
          console.warn(`[Webhook] Polaris score update failed: ${e.message}`);
        }
      }

      // Broadcast via SSE
      if (demoSession2 && demoSession2.id) {
        broadcastSSE(demoSession2.id, 'polarisSummary', {
          leadId: savedLead.id,
          polarisScore: summary?.polarisOpportunityScore || null,
        });
      }

      await appendLead(savedLead);
      await Promise.allSettled([
        sendSms(savedLead),
        sendEmail(savedLead),
      ]);
      console.log(`[Webhook] Lead processed (analysis): ${savedLead.id} — ${savedLead.customerName}`);
      logWebhookEvent(eventType, callId, `Lead saved (analysis): ${savedLead.id}`);
      return { received: true, processed: true, leadId: savedLead.id };
    }
    logWebhookEvent(eventType, callId, 'No lead data extracted from analysis');
    return { received: true, processed: false };
  }

  console.log(`[Webhook] Unknown event type: ${payload.event} — skipping.`);
  logWebhookEvent(eventType, callId, `Unknown event type — skipped`);
  return { received: true, processed: false };
}

module.exports = {
  handleWebhook,
  getDiagnostics,
  addSSEConnection,
  removeSSEConnection,
  broadcastSSE,
};