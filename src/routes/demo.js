'use strict';

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const db = require('../db');
const { getProvisionedDemoOrganization } = require('../services/organizationAuthority');
const { readDemoLifecycle } = require('../services/demoVoiceLifecycle');
const {
  DemoCommandCenterError,
  DemoCommandCenterRepository,
} = require('../commandCenter/demoRepository');
const {
  buildDemoWorkspace,
  demoCanonicalItems,
  DEMO_SERVICES,
} = require('../commandCenter/workspace');
const { DEFAULT_SELECTION, normalizeSelection } = require('../commandCenter/scenarioSpace');
const {
  SURFACES,
  compatibilityProjection,
  surfaceProjection,
} = require('./canonicalPolaris');
const scenarios = require('./simulation/scenario-catalog');

const router = express.Router();
const commandCenterRepository = new DemoCommandCenterRepository();
const DEMO_COOKIE = 'northstar_demo_workspace';
const DETAIL_IDENTIFIERS = Object.freeze({ customer: 'customer', lead: 'lead', work: 'work' });
const PRODUCTION_DEMO_ORIGINS = new Set([
  'https://northstar-os.ai',
  'https://www.northstar-os.ai',
]);

function configuredOrganizationId() {
  return process.env.NORTHSTAR_DEMO_ORGANIZATION_ID;
}

function cookieValue(req, name) {
  const source = String(req.headers.cookie || '').split(';');
  for (const part of source) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch (_error) { return ''; }
  }
  return '';
}

function commandCenterToken(req, res) {
  let token = commandCenterRepository.token(cookieValue(req, DEMO_COOKIE));
  if (token) return token;
  token = commandCenterRepository.issue();
  res.cookie(DEMO_COOKIE, token.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.secureCookies,
    path: '/',
    maxAge: Math.max(1, token.expiresAt.getTime() - Date.now()),
  });
  return token;
}

function demoWorkspace(record) {
  return buildDemoWorkspace({
    tenantId: record.tenantId,
    sessionId: record.sessionId,
    state: record.state,
    revision: record.revision,
    simulationCount: record.simulationCount,
    persisted: record.persisted,
    expiresAt: record.expiresAt,
  });
}

function demoCanonicalContext(workspace) {
  return Object.freeze({
    organizationId: workspace.tenant.id,
    userId: workspace.viewer.id,
    sessionId: workspace.session.id,
    explicitSession: workspace.session.id,
  });
}

function demoCanonicalFilters(items, query) {
  let result = items;
  if (query.status) {
    result = result.filter(function (item) { return item.opportunity.status === query.status; });
  }
  if (query.customerId) {
    result = result.filter(function (item) { return item.ids.customer === query.customerId; });
  }
  const parsedLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isSafeInteger(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 100;
  return result.slice(0, limit);
}

async function demoCanonicalProjection(req, res, compatibility) {
  res.set('Cache-Control', 'no-store');
  res.vary('Cookie');
  if (!SURFACES.has(req.params.surface)) {
    return res.status(404).json({
      success: false,
      error: { code: 'demo_surface_not_found', message: 'Demo surface not found.' },
    });
  }
  try {
    const token = commandCenterToken(req, res);
    const record = await commandCenterRepository.read(token);
    const workspace = demoWorkspace(record);
    const items = demoCanonicalFilters(demoCanonicalItems(workspace), req.query || {});
    const context = demoCanonicalContext(workspace);
    const data = compatibility
      ? compatibilityProjection(req.params.surface, items, context)
      : surfaceProjection(req.params.surface, items, context);
    return res.json({ success: true, data });
  } catch (error) {
    return commandCenterFailure(req, res, error);
  }
}

function commandCenterFailure(req, res, error) {
  const known = error instanceof DemoCommandCenterError ||
    (error && Number.isInteger(error.status) && typeof error.code === 'string');
  const status = known ? error.status : 503;
  return res.status(status).json({
    success: false,
    requestId: req.requestId || req.correlationId || 'unavailable',
    error: {
      code: known ? String(error.code).toLowerCase() : 'demo_command_center_unavailable',
      message: known && status < 500 ? error.message : 'The isolated account-free demo is temporarily unavailable.',
    },
  });
}

function exactBody(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = keys.slice().sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function mutationBoundary(req, res, intent) {
  const origin = req.get('Origin');
  const expectedOrigin = req.protocol + '://' + req.get('host');
  const fetchSite = req.get('Sec-Fetch-Site');
  const recognizedProductionOrigin = config.auth.secureCookies && PRODUCTION_DEMO_ORIGINS.has(origin);
  if (!origin || (!recognizedProductionOrigin && origin !== expectedOrigin) ||
      (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
    res.status(403).json({
      success: false,
      error: { code: 'demo_same_origin_required', message: 'Demo actions require the same NorthStar origin.' },
    });
    return false;
  }
  if (req.get('X-NorthStar-Demo-Intent') !== intent) {
    res.status(403).json({
      success: false,
      error: { code: 'demo_intent_required', message: 'The explicit demo action intent is required.' },
    });
    return false;
  }
  return true;
}

function scenarioSelection(body) {
  if (exactBody(body, ['expectedRevision', 'scenario'])) {
    return normalizeSelection(body.scenario);
  }
  // One-release compatibility for a cached pre-restoration demo client. The
  // old service-only request maps to the new contract defaults and remains
  // subject to the same origin, intent, CAS, idempotency, and admission gates.
  if (exactBody(body, ['expectedRevision', 'service']) &&
      Object.prototype.hasOwnProperty.call(DEMO_SERVICES, body.service)) {
    return normalizeSelection({ ...DEFAULT_SELECTION, service: body.service });
  }
  return null;
}

function durableSourceHash(req) {
  const secret = config.auth.accessSecret;
  const source = typeof req.ip === 'string' ? req.ip.trim() : '';
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 ||
      !source || Buffer.byteLength(source, 'utf8') > 128) {
    throw new DemoCommandCenterError(
      503, 'DEMO_ADMISSION_UNAVAILABLE', 'The isolated demo admission authority is unavailable.'
    );
  }
  return crypto.createHmac('sha256', secret)
    .update('northstar-demo-command-center-admission-v1\0', 'utf8')
    .update(source, 'utf8')
    .digest('hex');
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
    return res.json({
      status: 'ok',
      available: true,
      persistence: 'postgresql',
      canonicalLifecycle: true,
      outboundCalls: false,
      guidedPreview: false,
      browserWebCall: true,
    });
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

router.get('/command-center', async function (req, res) {
  res.set('Cache-Control', 'no-store');
  res.vary('Cookie');
  try {
    const token = commandCenterToken(req, res);
    const record = await commandCenterRepository.read(token);
    return res.json({ success: true, data: demoWorkspace(record) });
  } catch (error) {
    return commandCenterFailure(req, res, error);
  }
});

router.post('/command-center/simulations/leads', async function (req, res) {
  res.set('Cache-Control', 'no-store');
  if (!mutationBoundary(req, res, 'simulate-lead')) return undefined;
  const selectedScenario = scenarioSelection(req.body);
  if (!selectedScenario) {
    return res.status(422).json({
      success: false,
      error: { code: 'demo_scenario_invalid', message: 'Choose one supported fictional demo scenario.' },
    });
  }
  try {
    const token = commandCenterToken(req, res);
    const result = await commandCenterRepository.mutate(token, {
      operation: 'simulate_lead',
      expectedRevision: req.body.expectedRevision,
      scenarioSelection: selectedScenario,
      idempotencyKey: req.get('Idempotency-Key'),
    }, { sourceHash: durableSourceHash(req) });
    return res.status(result.replayed ? 200 : 201).json({
      success: true,
      replayed: result.replayed,
      data: demoWorkspace(result.record),
    });
  } catch (error) {
    return commandCenterFailure(req, res, error);
  }
});

router.post('/command-center/reset', async function (req, res) {
  res.set('Cache-Control', 'no-store');
  if (!mutationBoundary(req, res, 'reset')) return undefined;
  if (!exactBody(req.body, ['expectedRevision'])) {
    return res.status(400).json({
      success: false,
      error: { code: 'demo_reset_invalid', message: 'Refresh the demo before resetting it.' },
    });
  }
  try {
    const token = commandCenterToken(req, res);
    const result = await commandCenterRepository.mutate(token, {
      operation: 'reset',
      expectedRevision: req.body.expectedRevision,
      idempotencyKey: req.get('Idempotency-Key'),
    }, { sourceHash: durableSourceHash(req) });
    return res.json({ success: true, replayed: result.replayed, data: demoWorkspace(result.record) });
  } catch (error) {
    return commandCenterFailure(req, res, error);
  }
});

router.get('/command-center/canonical/compat/:surface', function (req, res) {
  return demoCanonicalProjection(req, res, true);
});

router.get('/command-center/canonical/surfaces/:surface', function (req, res) {
  return demoCanonicalProjection(req, res, false);
});

router.get('/command-center/polaris/:kind/:id', async function (req, res) {
  res.set('Cache-Control', 'no-store');
  const idKey = DETAIL_IDENTIFIERS[req.params.kind];
  if (!idKey) return res.status(404).json({ success: false, error: { code: 'demo_detail_not_found', message: 'Demo detail not found.' } });
  try {
    const token = commandCenterToken(req, res);
    const record = await commandCenterRepository.read(token);
    const graph = record.state.graphs.find(item => item && item.ids && item.ids[idKey] === req.params.id);
    if (!graph) return res.status(404).json({ success: false, error: { code: 'demo_detail_not_found', message: 'Demo detail not found.' } });
    return res.json({ success: true, data: graph, integrity: demoWorkspace(record).integrity });
  } catch (error) {
    return commandCenterFailure(req, res, error);
  }
});

router.post('/call', function (_req, res) {
  return res.status(410).json({
    success: false,
    error: {
      code: 'demo_external_action_retired',
      message: 'Public demo outbound calls are unavailable.',
    },
  });
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
