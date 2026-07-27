'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../auth/middleware');
const { requirePermission } = require('../auth/permissions');
const { handleWebhook, rawBodyCapture } = require('../voice/webhook');
const { createCanonicalVoiceCall } = require('../services/canonicalVoiceSessionCreation');
const voiceSessions = require('../services/voiceSessionAuthority');

const router = express.Router();

function errorResponse(res, error) {
  const status = error && error.status ? error.status : 503;
  const code = error && error.code ? error.code : 'CANONICAL_PERSISTENCE_UNAVAILABLE';
  const message = status === 503 && code !== 'VOICE_RUNTIME_UNAVAILABLE' && code !== 'CANONICAL_BUSINESS_PROFILE_REQUIRED'
    ? 'Canonical PostgreSQL persistence is unavailable.' : error.message;
  return res.status(status).json({ success: false, error: { code, message } });
}

function organizationId(req) {
  return req.tenantContext.organizationId;
}

router.post('/webhook',
  rawBodyCapture,
  express.json({ verify: function (req, _res, buffer) { req.rawBody = req.rawBody || buffer.toString(); } }),
  handleWebhook
);

router.get('/sessions', requireAuth, requirePermission('calls', 'read'), async function (req, res) {
  try {
    const sessions = await voiceSessions.listSessions(db.getPool(), organizationId(req), req.query.all === 'true');
    return res.json({ sessions, count: sessions.length });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.get('/sessions/:id', requireAuth, requirePermission('calls', 'read'), async function (req, res) {
  try {
    return res.json({ session: await voiceSessions.getSession(db.getPool(), organizationId(req), req.params.id) });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.post('/call', requireAuth, requirePermission('leads', 'create'), async function (req, res) {
  try {
    const created = await createCanonicalVoiceCall({
      pool: db.getPool(),
      organizationId: organizationId(req),
      phoneNumber: req.body && req.body.phoneNumber,
      service: req.body && req.body.service,
      caller: req.body && req.body.caller,
      fromNumber: config.retell && config.retell.phoneNumber,
      source: 'api-v1-voice-call',
    });
    return res.json({
      success: true,
      callId: created.result.call_id,
      status: created.result.call_status,
      profile: created.session.profile,
      session: created.session,
      canonicalGraphPendingWebhook: true,
    });
  } catch (error) {
    return errorResponse(res, error);
  }
});

async function sessionTimeline(req, res) {
  try {
    const entries = await voiceSessions.timeline(db.getPool(), organizationId(req), req.params.id);
    return res.json({ sessionId: req.params.id, entries, count: entries.length });
  } catch (error) {
    return errorResponse(res, error);
  }
}

router.get('/sessions/:id/timeline', requireAuth, requirePermission('calls', 'read'), sessionTimeline);
router.get('/sessions/:id/transcript', requireAuth, requirePermission('calls', 'read'), async function (req, res) {
  try {
    const entries = await voiceSessions.timeline(db.getPool(), organizationId(req), req.params.id);
    const segments = entries.filter(function (entry) { return entry.event === 'transcript' || entry.event === 'transcript_ready'; });
    return res.json({ sessionId: req.params.id, segments, count: segments.length });
  } catch (error) {
    return errorResponse(res, error);
  }
});
router.get('/sessions/:id/guidance', requireAuth, requirePermission('calls', 'read'), async function (req, res) {
  try {
    const entries = await voiceSessions.timeline(db.getPool(), organizationId(req), req.params.id);
    const guidance = entries.filter(function (entry) { return entry.event === 'guidance'; });
    return res.json({ sessionId: req.params.id, guidance, count: guidance.length });
  } catch (error) {
    return errorResponse(res, error);
  }
});
router.get('/sessions/:id/escalation', requireAuth, requirePermission('calls', 'read'), async function (req, res) {
  try {
    const session = await voiceSessions.getSession(db.getPool(), organizationId(req), req.params.id);
    return res.json({ sessionId: req.params.id, isEscalating: session.status === 'escalating', status: session.status });
  } catch (error) {
    return errorResponse(res, error);
  }
});

async function runtimeAction(req, res, action) {
  try {
    const result = await voiceSessions.performRuntimeAction(db.getPool(), {
      organizationId: organizationId(req),
      externalSessionId: req.params.id,
      action,
      reason: req.body && req.body.reason,
      userId: req.tenantContext.userId,
      eventId: req.get('Idempotency-Key') || null,
    });
    return res.json({ success: true, session: result.session });
  } catch (error) {
    return errorResponse(res, error);
  }
}

router.post('/sessions/:id/handoff', requireAuth, requirePermission('calls', 'update'), function (req, res) {
  return runtimeAction(req, res, 'handoff');
});
router.post('/sessions/:id/cancel', requireAuth, requirePermission('calls', 'update'), function (req, res) {
  return runtimeAction(req, res, 'cancel');
});

router.get('/status', requireAuth, requirePermission('calls', 'read'), async function (req, res) {
  try {
    const sessions = await voiceSessions.listSessions(db.getPool(), organizationId(req), false);
    return res.json({
      status: 'ok',
      persistence: 'postgresql',
      components: { canonicalSessions: 'healthy', activeSessions: sessions.length },
    });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.get('/dashboard', requireAuth, requirePermission('calls', 'read'), async function (req, res) {
  try {
    const sessions = await voiceSessions.listSessions(db.getPool(), organizationId(req), true);
    return res.json({
      activeCalls: sessions.filter(function (session) { return session.status === 'active' || session.status === 'escalating'; }).length,
      callsCompleted: sessions.filter(function (session) { return session.status === 'completed'; }).length,
    });
  } catch (error) {
    return errorResponse(res, error);
  }
});

function retired(_req, res) {
  return res.status(410).json({ success: false, error: { code: 'LEGACY_AUTHORITY_RETIRED', message: 'This process-local voice endpoint has been retired.' } });
}
router.post('/context/refresh', requireAuth, retired);
router.get('/events/history', requireAuth, retired);

module.exports = router;
