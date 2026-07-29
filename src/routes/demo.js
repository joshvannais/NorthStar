'use strict';

const express = require('express');
const config = require('../config');
const db = require('../db');
const { rateLimit } = require('../middleware/rateLimit');
const { createProvisionedDemoVoiceCall } = require('../services/canonicalVoiceSessionCreation');
const { getProvisionedDemoOrganization } = require('../services/organizationAuthority');
const { readDemoLifecycle } = require('../services/demoVoiceLifecycle');
const scenarios = require('./simulation/scenario-catalog');

const router = express.Router();

function configuredOrganizationId() {
  return process.env.NORTHSTAR_DEMO_ORGANIZATION_ID;
}

function errorResponse(res, error) {
  if (error && error.code === 'DEMO_SESSION_NOT_FOUND') {
    return res.status(404).json({ success: false, error: { code: 'demo_session_not_found', message: 'Demo session not found.' } });
  }
  if (error && ['DEMO_UNAVAILABLE', 'CANONICAL_PERSISTENCE_UNAVAILABLE',
    'CANONICAL_BUSINESS_PROFILE_REQUIRED', 'INTEGRATION_OWNERSHIP_UNKNOWN'].includes(error.code)) {
    return res.status(503).json({ success: false, error: { code: 'demo_unavailable', message: 'The public demo is unavailable.' } });
  }
  const status = error && error.status ? error.status : 503;
  return res.status(status).json({
    success: false,
    error: {
      code: error && error.code ? String(error.code).toLowerCase() : 'demo_unavailable',
      message: status >= 500 ? 'The public demo is temporarily unavailable.' : error.message,
    },
    demoSessionId: error && error.canonicalSessionId ? error.canonicalSessionId : undefined,
  });
}

function statusBody(lifecycle) {
  const session = lifecycle.session;
  const callStatus = lifecycle.lifecycle === 'pending' ? 'live' : lifecycle.lifecycle;
  return {
    success: true,
    sessionId: session.externalSessionId,
    callId: session.externalSessionId,
    callStatus,
    canonicalStatus: session.status,
    lifecycle: lifecycle.lifecycle,
    persistence: 'postgresql',
    profile: session.profile,
    estimate: lifecycle.estimate,
    polarisEstimate: lifecycle.estimate.status === 'ready' ? lifecycle.estimate.snapshot : null,
    polarisState: lifecycle.estimate.status,
    transcriptLineCount: lifecycle.transcript.length,
    providerFailure: session.status === 'failed'
      ? lifecycle.entries.find(function (entry) { return entry.event === 'provider_creation_failed'; }) || null
      : null,
  };
}

router.get('/status', async function (_req, res) {
  try {
    await getProvisionedDemoOrganization(db.getPool(), configuredOrganizationId());
    return res.json({ status: 'ok', available: true, persistence: 'postgresql', canonicalLifecycle: true });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.get('/industries', function (_req, res) {
  return res.json({
    industries: Object.keys(scenarios).map(function (key) {
      return { id: key, name: scenarios[key].displayName };
    }),
  });
});

router.post('/call', rateLimit('public-api'), async function (req, res) {
  try {
    const body = req.body || {};
    const created = await createProvisionedDemoVoiceCall({
      pool: db.getPool(),
      configuredOrganizationId: configuredOrganizationId(),
      phoneNumber: body.phoneNumber,
      service: body.industry || body.service,
      caller: body.contactName || body.caller,
      fromNumber: config.retell && config.retell.phoneNumber,
    });
    const publicId = created.session.externalSessionId;
    return res.json({
      success: true,
      demoSessionId: publicId,
      sessionId: publicId,
      callId: publicId,
      status: 'live',
      canonicalStatus: created.session.status,
      lifecycle: 'pending',
      estimate: { status: 'not_ready', snapshot: null },
      profile: created.session.profile,
      providerCallCreated: true,
    });
  } catch (error) {
    return errorResponse(res, error);
  }
});

async function lifecycle(req, res, project) {
  try {
    const current = await readDemoLifecycle(db.getPool(), configuredOrganizationId(), req.params.id);
    return res.json(project(current));
  } catch (error) {
    return errorResponse(res, error);
  }
}

router.get('/:id/status', function (req, res) {
  return lifecycle(req, res, statusBody);
});

router.get('/:id/transcript', function (req, res) {
  return lifecycle(req, res, function (current) {
    return {
      success: true,
      sessionId: current.session.externalSessionId,
      callStatus: statusBody(current).callStatus,
      lifecycle: current.lifecycle,
      lines: current.transcript,
      count: current.transcript.length,
    };
  });
});

router.get('/:id/timeline', function (req, res) {
  return lifecycle(req, res, function (current) {
    return {
      success: true,
      sessionId: current.session.externalSessionId,
      entries: current.entries,
      count: current.entries.length,
    };
  });
});

router.get('/:id/polaris-estimate', function (req, res) {
  return lifecycle(req, res, function (current) {
    return {
      success: true,
      sessionId: current.session.externalSessionId,
      lifecycle: current.lifecycle,
      estimate: current.estimate,
      polarisEstimate: current.estimate.status === 'ready' ? current.estimate.snapshot : null,
    };
  });
});

router.get('/:id/events', async function (req, res) {
  try {
    const current = await readDemoLifecycle(db.getPool(), configuredOrganizationId(), req.params.id);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('event: connected\ndata: ' + JSON.stringify(statusBody(current)) + '\n\n');
    const heartbeat = setInterval(function () {
      res.write('event: heartbeat\ndata: ' + JSON.stringify({ timestamp: new Date().toISOString() }) + '\n\n');
    }, 15000);
    req.on('close', function () { clearInterval(heartbeat); });
  } catch (error) {
    return errorResponse(res, error);
  }
});

function retiredMutation(_req, res) {
  return res.status(410).json({
    success: false,
    error: { code: 'demo_lifecycle_canonical', message: 'Demo lifecycle is controlled by canonical provider events.' },
  });
}

router.post('/:id/simulate', retiredMutation);
router.post('/:id/advance', retiredMutation);
router.post('/:id/complete', retiredMutation);
router.post('/:id/cancel', retiredMutation);

module.exports = router;
