/**
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
const { updateContext, registerIntelligenceHandlers } = require('../voice/eventIntelligence');
const { buildPolarisContext } = require('../services/polarisContextBuilder');
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
 */
router.post('/call', async (req, res) => {
  try {
    const { phoneNumber, service, caller } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: { code: 'MISSING_PHONE', message: 'phoneNumber is required' } });
    }

    // Initiate outbound call via Retell
    const { createCall } = require('../retell/client');
    const result = await createCall(phoneNumber, config.retell.agentId, {
      service: service || 'General',
      caller: caller || 'Outbound Call',
      fromNumber: config.twilio ? config.twilio.phoneNumber : undefined,
    });

    if (!result) {
      return res.json({ success: false, error: 'Retell API not configured', status: 'unconfigured' });
    }

    // Create a session for this outbound call
    const session = createSession(result.call_id, {
      fromNumber: config.twilio?.phoneNumber || '',
      toNumber: phoneNumber,
      direction: 'outbound',
      metadata: { service, caller },
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

// ── Initialize on load ─────────────────────────────────────────
initVoice();

module.exports = router;
