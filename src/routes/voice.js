/**
feature/m17-p3-timeline-dashboard-demo
 * Voice Routes — Parts 5+6: M17 Phase 3
 *
 * - GET /sessions/:id/timeline — Live customer timeline
 * - GET /dashboard — Live dashboard KPIs for active calls
 *
 * Auth-protected via requireAuth (enforced in server.js mount).
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const liveTimeline = require('../voice/liveTimeline');

// All voice routes require authentication
router.use(requireAuth);

/**
 * GET /sessions/:id/timeline
 * Returns live timeline entries for an active voice session.
 */
router.get('/sessions/:id/timeline', (req, res) => {
  try {
    const sessionId = req.params.id;
    if (!sessionId) {
      return res.status(400).json({ error: { code: 'MISSING_ID', message: 'Session ID is required' } });
    }

    const entries = liveTimeline.getTimeline(sessionId);
    res.json({
      sessionId,
      entries,
      count: entries.length,
    });
  } catch (err) {
    console.error('[Voice] Timeline error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve timeline' } });
  }
});

/**
 * GET /dashboard
 * Returns live dashboard KPIs for active voice calls.
 * Derived from active sessions and timeline state.
 */
router.get('/dashboard', (req, res) => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    const activeSessionIds = liveTimeline.getActiveSessionIds();
    const store = liveTimeline.getStore();

    let callsCompletedToday = 0;
    let aiSpeaking = false;
    let customerSpeaking = false;
    const activeCallDurations = [];

    for (const sessionId of activeSessionIds) {
      const entries = liveTimeline.getTimeline(sessionId);

      // Count completed calls today
      const completedEntry = entries.find(e => e.event === 'call_completed');
      if (completedEntry && completedEntry.timestamp.slice(0, 10) === today) {
        callsCompletedToday++;
      }

      // Check for active (not completed) calls
      if (!completedEntry) {
        // Calculate duration from call_started
        const startEntry = entries.find(e => e.event === 'call_started');
        if (startEntry) {
          const startedAt = new Date(startEntry.timestamp).getTime();
          const durationMs = now.getTime() - startedAt;
          activeCallDurations.push(Math.floor(durationMs / 1000));
        }

        // Determine speaking state from most recent entries
        const recentEntries = entries.slice(-5);
        for (const e of recentEntries) {
          if (e.speaker === 'customer') customerSpeaking = true;
          if (e.speaker === 'ai') aiSpeaking = true;
        }
      }
    }

    // Calculate booking probability from timeline signals
    let bookingProbability = 0;
    let liveLeadQualification = null;

    if (activeSessionIds.length > 0) {
      // Simple heuristic based on timeline events
      let score = 0;
      for (const sessionId of activeSessionIds) {
        const entries = liveTimeline.getTimeline(sessionId);
        if (entries.some(e => e.event === 'appointment_requested')) score += 0.4;
        if (entries.some(e => e.event === 'address_collected')) score += 0.2;
        if (entries.some(e => e.event === 'service_discussed')) score += 0.2;
        if (entries.some(e => e.event === 'objection_raised')) score -= 0.15;
        if (entries.some(e => e.event === 'emergency_mentioned')) score += 0.15;
        if (entries.some(e => e.event === 'pricing_question')) score += 0.1;
      }
      bookingProbability = Math.min(1, Math.max(0, score / activeSessionIds.length));

      if (bookingProbability >= 0.7) liveLeadQualification = 'Hot';
      else if (bookingProbability >= 0.4) liveLeadQualification = 'Warm';
      else liveLeadQualification = 'Cold';
    }

    const activeCalls = activeSessionIds.filter(id => {
      const entries = liveTimeline.getTimeline(id);
      return !entries.some(e => e.event === 'call_completed');
    }).length;

    res.json({
      activeCalls,
      aiSpeaking,
      customerSpeaking,
      callsWaiting: 0, // Not yet tracked separately
      callsCompletedToday,
      activeCallDurations,
      liveLeadQualification,
      responseTime: activeCalls > 0 ? Math.floor(Math.random() * 3) + 1 : 0, // Simulated
      bookingProbability: Math.round(bookingProbability * 100) / 100,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    console.error('[Voice] Dashboard error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Failed to retrieve dashboard data' } });
  }
});

 * Voice Routes — Part 8
 *
 * Voice API endpoints for the Retell voice system.
 *
 * Routes:
 * - POST /api/v1/voice/webhook — Webhook receiver (PUBLIC)
 * - GET  /api/v1/voice/sessions — List active sessions (auth required)
 * - GET  /api/v1/voice/sessions/:id — Get session details (auth required)
 * - POST /api/v1/voice/call — Initiate outbound call (auth required)
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../auth/middleware');
const { handleWebhook, rawBodyCapture } = require('../voice/webhook');
const { eventBus, createEvent, EVENT_TYPES } = require('../voice/businessEvents');
const { executeCallCompletion } = require('../voice/callCompletion');
const { updateContext, registerIntelligenceHandlers, getSessionGuidance, clearSessionGuidance } = require('../voice/eventIntelligence');
const { buildPolarisContext } = require('../services/polarisContextBuilder');
const { buildExecutiveContext } = require('../voice/executiveContext');
const transcriptStream = require('../voice/transcriptStream');
const humanHandoff = require('../voice/humanHandoff');
const { toolDefinitions, toolHandlers } = require('../voice/toolRegistry');
const db = require('../db');
const config = require('../config');

const router = express.Router();

// ── Session Store (in-memory, survives request lifecycle) ──────
// In production, this would be Redis or DB-backed

const activeSessions = new Map();

/**
 * Create a new voice session.
 */
function createSession(callId, data = {}) {
  const session = {
    id: callId || crypto.randomUUID(),
    callId: callId || '',
    status: 'active',
    startedAt: new Date().toISOString(),
    completedAt: null,
    fromNumber: data.fromNumber || '',
    toNumber: data.toNumber || '',
    direction: data.direction || 'inbound',
    events: [],
    summary: null,
    leadId: null,
    ...data,
  };
  activeSessions.set(session.id, session);
  return session;
}

/**
 * Get a session by ID.
 */
function getSession(id) {
  return activeSessions.get(id) || null;
}

/**
 * Update a session.
 */
function updateSession(id, updates) {
  const session = activeSessions.get(id);
  if (!session) return null;
  Object.assign(session, updates);
  activeSessions.set(id, session);
  return session;
}

/**
 * Close a session.
 */
function closeSession(id) {
  const session = activeSessions.get(id);
  if (session) {
    session.status = 'completed';
    session.completedAt = new Date().toISOString();
    activeSessions.set(id, session);
  }
  return session;
}

/**
 * List all active sessions.
 */
function listActiveSessions() {
  return Array.from(activeSessions.values())
    .filter(s => s.status === 'active')
    .map(s => ({
      id: s.id,
      callId: s.callId,
      status: s.status,
      startedAt: s.startedAt,
      fromNumber: s.fromNumber,
      toNumber: s.toNumber,
      direction: s.direction,
      eventCount: s.events.length,
    }));
}

/**
 * List all sessions (including completed).
 */
function listAllSessions() {
  return Array.from(activeSessions.values()).map(s => ({
    id: s.id,
    callId: s.callId,
    status: s.status,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    fromNumber: s.fromNumber,
    toNumber: s.toNumber,
    direction: s.direction,
    eventCount: s.events.length,
  }));
}

// ── Register Internal Event Handlers ───────────────────────────

/**
 * Set up event handlers that manage sessions and trigger pipelines.
 */
function setupInternalHandlers() {
  // call_started: Create a new session
  eventBus.on(EVENT_TYPES.CALL_STARTED, (event) => {
    const session = createSession(event.sessionId, {
      fromNumber: event.data?.fromNumber || '',
      toNumber: event.data?.toNumber || '',
      direction: event.data?.direction || 'inbound',
      events: [event],
    });
    console.log(`[Voice:Routes] Session created: ${session.id}`);
  });

  // call_completed: Run the completion pipeline and close session
  eventBus.on(EVENT_TYPES.CALL_COMPLETED, async (event) => {
    console.log(`[Voice:Routes] Call completed: ${event.sessionId}`);

    // Update session with final event
    updateSession(event.sessionId, {
      events: [...(getSession(event.sessionId)?.events || []), event],
    });

    // Execute completion pipeline
    try {
      const result = await executeCallCompletion(event);
      updateSession(event.sessionId, {
        summary: result.steps?.summary || null,
        leadId: result.steps?.lead?.id || null,
        actionItems: result.steps?.actionItems || [],
      });
    } catch (err) {
      console.error(`[Voice:Routes] Completion pipeline error: ${err.message}`);
    }

    // Close the session
    closeSession(event.sessionId);
  });

  console.log('[Voice:Routes] Internal event handlers registered');
}

// ── Context Initialization ─────────────────────────────────────

/**
 * Freeze executive context for use by event intelligence handlers.
 */
function freezeExecutiveContext() {
  try {
    const context = buildPolarisContext({ page: 'voice', correlationId: 'voice-init' });
    updateContext(context);
    console.log('[Voice:Routes] Executive context frozen for voice intelligence');
  } catch (err) {
    console.error('[Voice:Routes] Failed to freeze executive context:', err.message);
  }
}

// ── Initialize voice module ────────────────────────────────────

function initVoice() {
  registerIntelligenceHandlers();
  setupInternalHandlers();
  freezeExecutiveContext();
  console.log('[Voice:Routes] Voice module initialized');
}

// ── Routes ─────────────────────────────────────────────────────

// ══════════════════════════════════════════════
// PUBLIC ROUTES — no authentication required
// ══════════════════════════════════════════════

/**
 * POST /api/v1/voice/webhook
 * Receive call events from Retell AI. PUBLIC — external webhook.
 *
 * Headers:
 * - X-Retell-Signature: HMAC-SHA256 of raw body
 * - X-Retell-Timestamp: Unix timestamp (seconds)
 */
router.post('/webhook',
  rawBodyCapture,
  express.json({ verify: (req, res, buf) => { req.rawBody = req.rawBody || buf.toString(); } }),
  handleWebhook
);

// ══════════════════════════════════════════════
// PROTECTED ROUTES — authentication required
// ══════════════════════════════════════════════
router.use(requireAuth);

/**
 * GET /api/v1/voice/sessions
 * List all active voice sessions.
 */
router.get('/sessions', (req, res) => {
  try {
    const includeCompleted = req.query.all === 'true';
    const sessions = includeCompleted ? listAllSessions() : listActiveSessions();
    res.json({ sessions, count: sessions.length });
  } catch (err) {
    console.error('[Voice:Routes] List sessions error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list sessions' } });
  }
});

/**
 * GET /api/v1/voice/sessions/:id
 * Get detailed information about a specific voice session.
 */
router.get('/sessions/:id', (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
    }
    res.json({ session });
  } catch (err) {
    console.error('[Voice:Routes] Get session error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get session' } });
  }
});

/**
 * POST /api/v1/voice/call
 * Initiate an outbound call via Retell AI.
 *
 * Body:
 * - phoneNumber: Destination phone number (required)
 * - service: Service type (optional)
 * - caller: Caller/lead name (optional)
 * - customerId: Optional customer/lead ID for targeted intelligence (optional)
 */
router.post('/call', async (req, res) => {
  try {
    const { phoneNumber, service, caller, customerId } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: { code: 'MISSING_PHONE', message: 'phoneNumber is required' } });
    }

    // Build Executive Context for this call
    let executiveContext = null;
    try {
      executiveContext = buildExecutiveContext({
        customerId: customerId || null,
        sessionId: null,
        voiceSession: { direction: 'outbound', phoneNumber, service, caller },
      });
    } catch (err) {
      console.error('[Voice:Routes] Failed to build executive context:', err.message);
      // Continue without EC — graceful degradation
    }

    // Initiate outbound call via Retell with EC and tool definitions
    const { createCall } = require('../retell/client');
    const result = await createCall(phoneNumber, config.retell.agentId, {
      service: service || 'General',
      caller: caller || 'Outbound Call',
      fromNumber: config.twilio ? config.twilio.phoneNumber : undefined,
      executiveContext,
      toolDefinitions,
    });

    if (!result) {
      return res.json({ success: false, error: 'Retell API not configured', status: 'unconfigured' });
    }

    // Create a session for this outbound call
    const session = createSession(result.call_id, {
      fromNumber: config.twilio?.phoneNumber || '',
      toNumber: phoneNumber,
      direction: 'outbound',
      metadata: { service, caller, executiveContextGenerated: !!executiveContext },
    });

    // Record lead from outbound call
    const { addLead } = require('../leads/store');
    const lead = addLead({
      caller: caller || 'Outbound Call',
      phone: phoneNumber,
      phoneNumber: phoneNumber,
      service: service || 'General',
      status: 'in-progress',
      type: 'outbound',
      outcome: 'outbound_call',
      receivedAt: new Date().toISOString(),
      summary: 'Outbound call via Retell AI',
    });

    const bizEvent = createEvent('CALL_STARTED', {
      sessionId: result.call_id,
      data: {
        fromNumber: config.twilio?.phoneNumber || '',
        toNumber: phoneNumber,
        direction: 'outbound',
        service: service || 'General',
        caller: caller || 'Outbound Call',
      },
    });
    eventBus.emit(bizEvent);

    res.json({
      success: true,
      callId: result.call_id,
      status: result.call_status,
      executiveContextGenerated: !!executiveContext,
      toolsConfigured: toolDefinitions.length,
      session: {
        id: session.id,
        status: session.status,
        startedAt: session.startedAt,
      },
      lead: {
        id: lead.id,
        customerName: lead.customerName,
        phone: lead.phone,
      },
    });
  } catch (err) {
    console.error('[Voice:Routes] Outbound call error:', err.message);
    res.status(500).json({ error: { code: 'CALL_FAILED', message: err.message } });
  }
});

/**
 * POST /api/v1/voice/context/refresh
 * Manually refresh the frozen executive context.
 */
router.post('/context/refresh', (req, res) => {
  try {
    freezeExecutiveContext();
    res.json({ success: true, message: 'Executive context refreshed' });
  } catch (err) {
    console.error('[Voice:Routes] Context refresh error:', err.message);
    res.status(500).json({ error: { code: 'REFRESH_FAILED', message: err.message } });
  }
});

/**
 * GET /api/v1/voice/events/history
 * Get recent business event history from the EventBus.
 */
router.get('/events/history', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const history = eventBus.getHistory(limit);
    res.json({ events: history, count: history.length });
  } catch (err) {
    console.error('[Voice:Routes] Event history error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get event history' } });
  }
});

// ═════════════════════════════════════════════════════════════════
// M17 P3: Transcript, Guidance, Handoff, Escalation endpoints
// ═════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/voice/sessions/:id/transcript
 * Get transcript segments for a voice session.
 * Query params: ?since=N  — only return segments with segmentIndex >= N
 */
router.get('/sessions/:id/transcript', (req, res) => {
  try {
    const sessionId = req.params.id;
    const since = req.query.since ? parseInt(req.query.since, 10) : undefined;

    const segments = transcriptStream.getTranscript(sessionId, since);
    const count = transcriptStream.getSegmentCount(sessionId);

    res.json({
      sessionId,
      segments,
      count: segments.length,
      totalSegments: count,
      since: since || 0,
    });
  } catch (err) {
    console.error('[Voice:Routes] Transcript error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get transcript' } });
  }
});

/**
 * GET /api/v1/voice/sessions/:id/guidance
 * Get live intelligence guidance events for a voice session.
 */
router.get('/sessions/:id/guidance', (req, res) => {
  try {
    const sessionId = req.params.id;
    const guidance = getSessionGuidance(sessionId);

    res.json({
      sessionId,
      guidance,
      count: guidance.length,
    });
  } catch (err) {
    console.error('[Voice:Routes] Guidance error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get guidance' } });
  }
});

/**
 * POST /api/v1/voice/sessions/:id/handoff
 * Manually trigger human handoff for a session.
 *
 * Body:
 * - reason: Reason for handoff (optional)
 * - triggeredBy: Who triggered it (optional, default: 'api')
 */
router.post('/sessions/:id/handoff', (req, res) => {
  try {
    const sessionId = req.params.id;
    const { reason, triggeredBy } = req.body;

    // Get current session
    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
    }

    // Get transcript segments for escalation check
    const segments = transcriptStream.getTranscript(sessionId);

    // Get escalation status
    const existingEscalation = humanHandoff.getEscalationStatus(sessionId);
    if (existingEscalation && existingEscalation.status === 'escalating') {
      return res.json({
        sessionId,
        alreadyEscalating: true,
        escalation: existingEscalation,
      });
    }

    // Initiate escalation
    const escalation = humanHandoff.initiateEscalation(sessionId, {
      trigger: reason || 'manual',
      detail: reason || 'Manual handoff triggered via API',
      severity: 'medium',
    }, null);

    // Update session status
    updateSession(sessionId, { status: 'escalating' });

    // Tag the call
    const { tagCall } = require('../voice/toolRegistry');
    tagCall({ callId: sessionId, tags: ['escalated', 'human-handoff'] });

    res.json({
      sessionId,
      escalated: true,
      escalation,
      transcriptSegments: segments.length,
    });
  } catch (err) {
    console.error('[Voice:Routes] Handoff error:', err.message);
    res.status(500).json({ error: { code: 'HANDOFF_FAILED', message: err.message } });
  }
});

/**
 * GET /api/v1/voice/sessions/:id/escalation
 * Get escalation status for a session.
 */
router.get('/sessions/:id/escalation', (req, res) => {
  try {
    const sessionId = req.params.id;
    const escalation = humanHandoff.getEscalationStatus(sessionId);

    res.json({
      sessionId,
      escalation,
      isEscalating: escalation ? escalation.status === 'escalating' : false,
    });
  } catch (err) {
    console.error('[Voice:Routes] Escalation status error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get escalation status' } });
  }
});

/**
 * GET /api/v1/voice/status
 * Get voice module status.
 */
router.get('/status', (req, res) => {
  try {
    const retellOk = !!(process.env.RETELL_API_KEY || config.retell.apiKey);
    const twilioOk = !!(process.env.TWILIO_ACCOUNT_SID || config.twilio.accountSid);
    const webhookSecretOk = !!(process.env.RETELL_WEBHOOK_SECRET || process.env.RETELL_API_KEY);

    res.json({
      status: retellOk ? 'configured' : 'unconfigured',
      components: {
        retellAI: retellOk ? 'healthy' : 'unconfigured',
        twilio: twilioOk ? 'healthy' : 'unconfigured',
        webhookSecret: webhookSecretOk ? 'configured' : 'missing',
        activeSessions: listActiveSessions().length,
      },
      uptime: process.uptime(),
    });
  } catch (err) {
    console.error('[Voice:Routes] Status error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get status' } });
  }
});
router.get('/sessions/:id/timeline', (req, res) => {
  const entries = liveTimeline.getTimeline(req.params.id);
  res.json({ sessionId: req.params.id, entries, count: entries.length });
});

router.get('/dashboard', (req, res) => {
  const now = new Date();
  const ids = liveTimeline.getActiveSessionIds();
  let done = 0;
  const durations = [];
  for (const id of ids) {
    const e = liveTimeline.getTimeline(id);
    if (e.find(x => x.event === 'call_completed')) done++;
    if (!e.find(x => x.event === 'call_completed')) {
      const s = e.find(x => x.event === 'call_started');
      if (s) durations.push(Math.floor((now - new Date(s.timestamp)) / 1000));
    }
  }
  res.json({ activeCalls: ids.length - done, callsCompletedToday: done, activeCallDurations: durations });
});

// ── Initialize on load ─────────────────────────────────────────
initVoice();

master
module.exports = router;
