/**
 * Polaris M13 Engine API Routes
 *
 * Exposes all 9 M13 intelligence engines through REST endpoints.
 * Mounted at /api/v1 in server.js
 *
 * Engines:
 *   - Customer Lifecycle Engine
 *   - Communications Intelligence Engine
 *   - Opportunity & Pipeline Intelligence Engine
 *   - Workflow & Scheduling Intelligence Engine
 *   - Financial Intelligence Engine
 *   - Asset & Equipment Intelligence Engine
 *   - Crew & Resource Intelligence Engine
 *   - Job Execution Intelligence Engine
 *   - Business Intelligence & Analytics Engine
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const { requireOrgMembership } = require('../auth/permissions');
const { permissionFor } = require('../auth/polarisRoutePermissions');
const demoScope = require('../services/demoRecordScope');
const canonicalPolaris = require('../services/canonicalPolaris');
const sessionScopedOpportunity = require('../services/sessionScopedOpportunity');

function mutationPermission(method, path) {
  return permissionFor('polaris-engines', method, path);
}

/**
 * Filter an array of records by sessionId.
 * Real records (not in any session) are always included.
 * Simulated records are included only if they belong to the requested session.
 */
function _filterBySession(records, sessionId) {
  return demoScope.filterRecords(records, sessionId);
}

function _filterCollection(result, key, sessionId) {
  if (!result || !Array.isArray(result[key])) return result;
  result[key] = _filterBySession(result[key], sessionId);
  result.total = result[key].length;
  return result;
}

function _filterThenPaginate(result, key, sessionId, limit, offset) {
  if (!result || !Array.isArray(result[key])) return result;
  var visible = _filterBySession(result[key], sessionId);
  var start = Number(offset) > 0 ? Number(offset) : 0;
  var maximum = Number(limit) > 0 ? Number(limit) : null;
  result.total = visible.length;
  result[key] = maximum == null ? visible.slice(start) : visible.slice(start, start + maximum);
  return result;
}

function _denyHiddenSimulation(record, sessionId, res) {
  if (record && !record.error &&
      demoScope.canAccessTenant(record, demoScope.resolveAccess(sessionId))) return false;
  res.status(404).json({ error: 'Record not found' });
  return true;
}

function _sanitizePublicBody(body) {
  var clean = Object.assign({}, body || {});
  delete clean.recordScope;
  delete clean.simulationSessionId;
  delete clean.demoSessionId;
  delete clean.ownerUserId;
  delete clean.organizationId;
  if (clean.source === 'simulation') delete clean.source;
  if (clean.metadata && typeof clean.metadata === 'object') {
    clean.metadata = Object.assign({}, clean.metadata);
    delete clean.metadata.recordScope;
    delete clean.metadata.source;
    delete clean.metadata.simulationSessionId;
    delete clean.metadata.ownerUserId;
    delete clean.metadata.organizationId;
  }
  var context = demoScope.resolveAccess();
  if (context && context.enforceOwner && context.organizationId) {
    clean.metadata = Object.assign({}, clean.metadata || {}, {
      ownerUserId: context.userId,
      organizationId: context.organizationId,
    });
  }
  return clean;
}

function _bodyWithInheritedScope(body, parent) {
  var clean = _sanitizePublicBody(body);
  if (parent && demoScope.isSimulation(parent)) {
    var inherited = Object.assign({}, clean.metadata || {}, parent.metadata || {});
    clean.metadata = demoScope.createMetadata(demoScope.getSessionId(parent), inherited);
  }
  return clean;
}

// ── Engine References ──
let engines = {};

function _getEngines() {
  if (!engines.customers) {
    try { engines.customers = require('../polaris/customer-engine'); } catch (e) {}
  }
  if (!engines.comms) {
    try { engines.comms = require('../polaris/communications-engine'); } catch (e) {}
  }
  if (!engines.opps) {
    try { engines.opps = require('../polaris/opportunity-engine'); } catch (e) {}
  }
  if (!engines.wf) {
    try { engines.wf = require('../polaris/workflow-engine'); } catch (e) {}
  }
  if (!engines.fin) {
    try { engines.fin = require('../polaris/financial-engine'); } catch (e) {}
  }
  if (!engines.ast) {
    try { engines.ast = require('../polaris/asset-engine'); } catch (e) {}
  }
  if (!engines.crew) {
    try { engines.crew = require('../polaris/crew-engine'); } catch (e) {}
  }
  if (!engines.job) {
    try { engines.job = require('../polaris/job-engine'); } catch (e) {}
  }
  if (!engines.bi) {
    try { engines.bi = require('../polaris/analytics-engine'); } catch (e) {}
  }
  return engines;
}

// ── Middleware ──
router.use((req, res, next) => {
  res.setHeader('X-Polaris-Engines-Version', '13.0');
  const sendJson = res.json.bind(res);
  res.json = function (body) {
    const rawError = body && body.error;
    const rawMessage = typeof rawError === 'string'
      ? rawError
      : rawError && typeof rawError.message === 'string' ? rawError.message : null;
    if (res.statusCode >= 500 && rawMessage) {
      console.error('[Polaris Engines] Internal route failure:', {
        method: req.method,
        path: req.path,
        message: rawMessage,
      });
      const safe = {
        error: { code: 'internal_error', message: 'An unexpected error occurred. Please try again.' },
      };
      if (body && body.success === false) safe.success = false;
      return sendJson(safe);
    }
    return sendJson(body);
  };
  next();
});

// All engine routes require authentication
router.use(requireAuth);
router.use(requireOrgMembership);
router.use(function (req, res, next) {
  demoScope.runWithAccess(req, next);
});
router.use(function (req, _res, next) {
  if (/^(?:POST|PUT|PATCH)$/.test(req.method) && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    req.body = _sanitizePublicBody(req.body);
  }
  next();
});

// ══════════════════════════════════════════════
// CUSTOMER ENGINE
// ══════════════════════════════════════════════

/**
 * GET /api/v1/customers
 * List customers with optional filters.
 */
router.get('/customers', (req, res) => {
  try {
    var e = _getEngines().customers;
    var filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.search) filters.search = req.query.search;
    var result = e.listCustomers(filters);
    if (result && Array.isArray(result.customers)) {
      var visibleIds = demoScope.filterRecords(result.customers.map(function (summary) {
        return e.getCustomer(summary.id) || summary;
      }), req.query.sessionId).reduce(function (ids, customer) {
        ids[customer.id] = true;
        return ids;
      }, {});
      result.customers = result.customers.filter(function (summary) { return visibleIds[summary.id]; });
      result.total = result.customers.length;
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/customers
 * Create a new customer.
 */
router.post('/customers', mutationPermission('POST', '/customers'), (req, res) => {
  try {
    var e = _getEngines().customers;
    var result = e.createCustomer(_sanitizePublicBody(req.body));
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/customers/:id
 * Get a single customer.
 */
router.get('/customers/:id', (req, res) => {
  try {
    var e = _getEngines().customers;
    var result = e.getCustomer(req.params.id);
    if (_denyHiddenSimulation(result, req.query.sessionId, res)) return;
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/customers/:id/polaris
 * Return the canonical Polaris object without changing the legacy lead-intelligence API.
 */
router.get('/customers/:id/polaris', (req, res) => {
  try {
    var e = _getEngines();
    var customer = e.customers.getCustomer(req.params.id);
    if (!customer || customer.error || !demoScope.canAccess(customer, req.query.sessionId)) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    var records = [customer]
      .concat(_filterBySession(e.opps.listOpportunities({ customerId: req.params.id }).opportunities || [], req.query.sessionId))
      .concat(_filterBySession(e.fin.listEstimates({ customerId: req.params.id }).estimates || [], req.query.sessionId))
      .concat(_filterBySession(e.comms.getCommunications(req.params.id, {}).communications || [], req.query.sessionId));
    var source = records.find(function (record) {
      return record && record.metadata && record.metadata.polarisIntelligence;
    });
    if (!source) {
      return res.status(404).json({ success: false, error: 'Canonical Polaris intelligence is not available for this customer' });
    }
    return res.json({
      success: true,
      customerId: req.params.id,
      data: canonicalPolaris.sanitize(source.metadata.polarisIntelligence),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to load canonical customer intelligence' });
  }
});

/**
 * PUT /api/v1/customers/:id
 * Update a customer.
 */
router.put('/customers/:id', mutationPermission('PUT', '/customers/:id'), (req, res) => {
  try {
    var e = _getEngines().customers;
    var existing = e.getCustomer(req.params.id);
    if (_denyHiddenSimulation(existing, req.query.sessionId, res)) return;
    var result = e.updateCustomer(req.params.id, _bodyWithInheritedScope(req.body, existing));
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * DELETE /api/v1/customers/:id
 * Archive a customer.
 */
router.delete('/customers/:id', mutationPermission('DELETE', '/customers/:id'), (req, res) => {
  try {
    var e = _getEngines().customers;
    if (_denyHiddenSimulation(e.getCustomer(req.params.id), req.query.sessionId, res)) return;
    var result = e.archiveCustomer(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/customers/:id/restore
 * Restore an archived customer.
 */
router.post('/customers/:id/restore', mutationPermission('POST', '/customers/:id/restore'), (req, res) => {
  try {
    var e = _getEngines().customers;
    if (_denyHiddenSimulation(e.getCustomer(req.params.id), req.query.sessionId, res)) return;
    var result = e.restoreCustomer(req.params.id);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/customers/:id/health
 * Get customer health score.
 */
router.get('/customers/:id/health', (req, res) => {
  try {
    var e = _getEngines().customers;
    if (_denyHiddenSimulation(e.getCustomer(req.params.id), req.query.sessionId, res)) return;
    var result = e.calculateCustomerHealth(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// COMMUNICATIONS ENGINE
// ══════════════════════════════════════════════

/**
 * GET /api/v1/communications
 * List communications with filters.
 */
router.get('/communications', (req, res) => {
      try {
        var e = _getEngines().comms;
        var filters = {};
        if (req.query.customerId) filters.customerId = req.query.customerId;
        if (req.query.type) filters.type = req.query.type;
        if (req.query.direction) filters.direction = req.query.direction;
        if (req.query.status) filters.status = req.query.status;
        if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom;
        if (req.query.dateTo) filters.dateTo = req.query.dateTo;

        if (req.query.customerId) {
          var result = e.getCommunications(req.query.customerId, filters);
          _filterThenPaginate(result, 'communications', req.query.sessionId, req.query.limit, req.query.offset);
          res.json(result);
        } else {
          // Canonical collection endpoint — return all communications across customers
          var result = e.getAllCommunications(filters);
          _filterThenPaginate(result, 'communications', req.query.sessionId, req.query.limit, req.query.offset);
          res.json(result);
        }
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

/**
 * POST /api/v1/communications
 * Record a communication.
 */
router.post('/communications', mutationPermission('POST', '/communications'), (req, res) => {
  try {
    var engines = _getEngines();
    var body = req.body || {};
    var parent = body.customerId ? engines.customers.getCustomer(body.customerId) : null;
    if (_denyHiddenSimulation(parent, req.query.sessionId, res)) return;
    var result = engines.comms.recordCommunication(_bodyWithInheritedScope(body, parent));
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/communications/search
 * Search communications.
 */
router.get('/communications/search', (req, res) => {
  try {
    var e = _getEngines().comms;
    if (!req.query.q) return res.status(400).json({ error: 'Search query q is required' });
    var result = e.searchCommunications(req.query.q);
    _filterCollection(result, 'communications', req.query.sessionId);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/communications/:id
 * Get a single communication.
 */
router.get('/communications/:id', (req, res) => {
  try {
    var e = _getEngines().comms;
    var result = e.getCommunication(req.params.id);
    if (_denyHiddenSimulation(result, req.query.sessionId, res)) return;
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/v1/communications/:id/status
 * Update communication status.
 */
router.put('/communications/:id/status', mutationPermission('PUT', '/communications/:id/status'), (req, res) => {
  try {
    var e = _getEngines().comms;
    if (_denyHiddenSimulation(e.getCommunication(req.params.id), req.query.sessionId, res)) return;
    var result = e.updateCommunicationStatus(req.params.id, req.body.status);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/communications/timeline/:customerId
 * Get communication timeline for a customer.
 */
router.get('/communications/timeline/:customerId', (req, res) => {
  try {
    var engines = _getEngines();
    if (_denyHiddenSimulation(engines.customers.getCustomer(req.params.customerId), req.query.sessionId, res)) return;
    var result = engines.comms.getTimeline(req.params.customerId);
    if (result && result.entries) {
      result.entries = _filterBySession(result.entries, req.query.sessionId);
      result.total = result.entries.length;
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/communications/intelligence/:customerId
 * Get communication intelligence for a customer.
 */
router.get('/communications/intelligence/:customerId', (req, res) => {
  try {
    var engines = _getEngines();
    if (_denyHiddenSimulation(engines.customers.getCustomer(req.params.customerId), req.query.sessionId, res)) return;
    var e = engines.comms;
    var visible = _filterBySession(
      e.getCommunications(req.params.customerId, {}).communications || [], req.query.sessionId
    );
    var result = {
      lastContact: e.getLastContact(req.params.customerId, visible),
      frequency: e.getCommunicationFrequency(req.params.customerId, 30, visible),
      engagement: e.getEngagementScore(req.params.customerId, visible),
      followUps: e.getFollowUpRecommendations(req.params.customerId, visible),
    };
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// OPPORTUNITY ENGINE
// ══════════════════════════════════════════════

/**
 * GET /api/v1/opportunities
 * List opportunities.
 */
router.get('/opportunities', (req, res) => {
  try {
    var e = _getEngines().opps;
    var filters = {};
    if (req.query.stage) filters.stage = req.query.stage;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.owner) filters.owner = req.query.owner;
    if (req.query.customerId) filters.customerId = req.query.customerId;
    var result = e.listOpportunities(filters);
    _filterThenPaginate(result, 'opportunities', req.query.sessionId, req.query.limit, 0);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/opportunities
 * Create an opportunity.
 */
router.post('/opportunities', mutationPermission('POST', '/opportunities'), (req, res) => {
  try {
    var engines = _getEngines();
    var body = req.body || {};
    var parent = body.customerId ? engines.customers.getCustomer(body.customerId) : null;
    if (_denyHiddenSimulation(parent, req.query.sessionId, res)) return;
    var result = engines.opps.createOpportunity(_bodyWithInheritedScope(body, parent));
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/opportunities/pipeline
 * Get pipeline view and metrics.
 */
router.get('/opportunities/pipeline', (req, res) => {
  try {
    var e = _getEngines().opps;
    var result = sessionScopedOpportunity.buildSnapshot(e, req.query.sessionId);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/opportunities/queue
 * Get priority queue.
 */
router.get('/opportunities/queue', (req, res) => {
  try {
    var e = _getEngines().opps;
    var result = e.getPriorityQueue({ limit: Number.MAX_SAFE_INTEGER });
    if (result && result.queue) _filterThenPaginate(result, 'queue', req.query.sessionId, parseInt(req.query.limit) || 20, 0);
    if (Array.isArray(result)) result = _filterBySession(result, req.query.sessionId);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/opportunities/:id
 * Get a single opportunity.
 */
router.get('/opportunities/:id', (req, res) => {
  try {
    var e = _getEngines().opps;
    var result = e.getOpportunity(req.params.id);
    if (_denyHiddenSimulation(result, req.query.sessionId, res)) return;
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/v1/opportunities/:id
 * Update an opportunity.
 */
router.put('/opportunities/:id', mutationPermission('PUT', '/opportunities/:id'), (req, res) => {
  try {
    var e = _getEngines().opps;
    var existing = e.getOpportunity(req.params.id);
    if (_denyHiddenSimulation(existing, req.query.sessionId, res)) return;
    var result = e.updateOpportunity(req.params.id, _bodyWithInheritedScope(req.body, existing));
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/v1/opportunities/:id/stage
 * Move opportunity to a new stage.
 */
router.put('/opportunities/:id/stage', mutationPermission('PUT', '/opportunities/:id/stage'), (req, res) => {
  try {
    var e = _getEngines().opps;
    if (_denyHiddenSimulation(e.getOpportunity(req.params.id), req.query.sessionId, res)) return;
    var result = e.updateOpportunityStage(req.params.id, req.body.stage);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * DELETE /api/v1/opportunities/:id
 * Archive an opportunity.
 */
router.delete('/opportunities/:id', mutationPermission('DELETE', '/opportunities/:id'), (req, res) => {
  try {
    var e = _getEngines().opps;
    if (_denyHiddenSimulation(e.getOpportunity(req.params.id), req.query.sessionId, res)) return;
    var result = e.archiveOpportunity(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// WORKFLOW ENGINE
// ══════════════════════════════════════════════

/**
 * GET /api/v1/workflows
 * List tasks.
 */
router.get('/workflows', (req, res) => {
  try {
    var e = _getEngines().wf;
    var filters = {};
    if (req.query.type) filters.type = req.query.type;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.owner) filters.owner = req.query.owner;
    if (req.query.customerId) filters.customerId = req.query.customerId;
    if (req.query.limit) filters.limit = parseInt(req.query.limit);
    var result = e.listTasks(filters);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/workflows
 * Create a task.
 */
router.post('/workflows', mutationPermission('POST', '/workflows'), (req, res) => {
  try {
    var all = _getEngines();
    var body = req.body || {};
    var parent = null;
    if (body.customerId) {
      parent = all.customers.getCustomer(body.customerId);
      if (_denyHiddenSimulation(parent, req.query.sessionId, res)) return;
    }
    if (body.opportunityId) {
      var opportunity = all.opps.getOpportunity(body.opportunityId);
      if (_denyHiddenSimulation(opportunity, req.query.sessionId, res)) return;
      parent = parent || opportunity;
    }
    var result = all.wf.createTask(_bodyWithInheritedScope(body, parent));
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/workflows/agenda/today
 * Get today's agenda.
 */
router.get('/workflows/agenda/today', (req, res) => {
  try {
    var e = _getEngines().wf;
    res.json(e.getTodayAgenda());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/workflows/agenda/overdue
 * Get overdue tasks.
 */
router.get('/workflows/agenda/overdue', (req, res) => {
  try {
    var e = _getEngines().wf;
    res.json(e.getOverdueTasks());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/workflows/agenda/upcoming
 * Get upcoming tasks.
 */
router.get('/workflows/agenda/upcoming', (req, res) => {
  try {
    var e = _getEngines().wf;
    res.json(e.getUpcomingTasks(parseInt(req.query.days) || 7));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/workflows/metrics
 * Get workflow metrics.
 */
router.get('/workflows/metrics', (req, res) => {
  try {
    var e = _getEngines().wf;
    res.json(e.getWorkflowMetrics());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/workflows/:id
 * Get a single task.
 */
router.get('/workflows/:id', (req, res) => {
  try {
    var e = _getEngines().wf;
    var result = e.getTask(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/v1/workflows/:id
 * Update a task.
 */
router.put('/workflows/:id', mutationPermission('PUT', '/workflows/:id'), (req, res) => {
  try {
    var e = _getEngines().wf;
    var existing = e.getTask(req.params.id);
    if (_denyHiddenSimulation(existing, req.query.sessionId, res)) return;
    var result = e.updateTask(req.params.id, _bodyWithInheritedScope(req.body, existing));
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/workflows/:id/complete
 * Mark a task as completed.
 */
router.post('/workflows/:id/complete', mutationPermission('POST', '/workflows/:id/complete'), (req, res) => {
  try {
    var e = _getEngines().wf;
    if (_denyHiddenSimulation(e.getTask(req.params.id), req.query.sessionId, res)) return;
    var result = e.completeTask(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/workflows/agenda/today
 * Get today's agenda.
 */
router.get('/workflows/agenda/today', (req, res) => {
  try {
    var e = _getEngines().wf;
    res.json(e.getTodayAgenda());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/workflows/agenda/overdue
 * Get overdue tasks.
 */
router.get('/workflows/agenda/overdue', (req, res) => {
  try {
    var e = _getEngines().wf;
    res.json(e.getOverdueTasks());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/workflows/agenda/upcoming
 * Get upcoming tasks.
 */
router.get('/workflows/agenda/upcoming', (req, res) => {
  try {
    var e = _getEngines().wf;
    res.json(e.getUpcomingTasks(parseInt(req.query.days) || 7));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/workflows/metrics
 * Get workflow metrics.
 */
router.get('/workflows/metrics', (req, res) => {
  try {
    var e = _getEngines().wf;
    res.json(e.getWorkflowMetrics());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// FINANCIAL ENGINE
// ══════════════════════════════════════════════

/**
 * GET /api/v1/financial/estimates
 * List estimates.
 */
router.get('/financial/estimates', (req, res) => {
  try {
    var e = _getEngines().fin;
    var filters = {};
    if (req.query.customerId) filters.customerId = req.query.customerId;
    if (req.query.status) filters.status = req.query.status;
    var result = e.listEstimates(filters);
    _filterCollection(result, 'estimates', req.query.sessionId);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/financial/estimates
 * Create an estimate.
 */
router.post('/financial/estimates', mutationPermission('POST', '/financial/estimates'), (req, res) => {
  try {
    var engines = _getEngines();
    var body = req.body || {};
    var customer = body.customerId ? engines.customers.getCustomer(body.customerId) : null;
    var opportunity = body.opportunityId ? engines.opps.getOpportunity(body.opportunityId) : null;
    if (_denyHiddenSimulation(customer, req.query.sessionId, res)) return;
    if (body.opportunityId && _denyHiddenSimulation(opportunity, req.query.sessionId, res)) return;
    var parent = opportunity && !opportunity.error ? opportunity : customer;
    var result = engines.fin.createEstimate(_bodyWithInheritedScope(body, parent));
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/financial/estimates/:id
 * Get a single estimate.
 */
router.get('/financial/estimates/:id', (req, res) => {
  try {
    var e = _getEngines().fin;
    var result = e.getEstimate(req.params.id);
    if (_denyHiddenSimulation(result, req.query.sessionId, res)) return;
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/financial/invoices
 * List invoices.
 */
router.get('/financial/invoices', (req, res) => {
  try {
    var e = _getEngines().fin;
    var filters = {};
    if (req.query.customerId) filters.customerId = req.query.customerId;
    if (req.query.status) filters.status = req.query.status;
    var result = e.listInvoices(filters);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/financial/invoices
 * Create an invoice.
 */
router.post('/financial/invoices', mutationPermission('POST', '/financial/invoices'), (req, res) => {
  try {
    var all = _getEngines();
    var body = req.body || {};
    var customer = body.customerId ? all.customers.getCustomer(body.customerId) : null;
    if (_denyHiddenSimulation(customer, req.query.sessionId, res)) return;
    var parent = customer;
    if (body.estimateId) {
      var estimate = all.fin.getEstimate(body.estimateId);
      if (_denyHiddenSimulation(estimate, req.query.sessionId, res)) return;
      parent = estimate;
    }
    var result = all.fin.createInvoice(_bodyWithInheritedScope(body, parent));
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/financial/invoices/:id
 * Get a single invoice.
 */
router.get('/financial/invoices/:id', (req, res) => {
  try {
    var e = _getEngines().fin;
    var result = e.getInvoice(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/financial/invoices/:id/send
 * Mark invoice as sent.
 */
router.post('/financial/invoices/:id/send', mutationPermission('POST', '/financial/invoices/:id/send'), (req, res) => {
  try {
    var e = _getEngines().fin;
    if (_denyHiddenSimulation(e.getInvoice(req.params.id), req.query.sessionId, res)) return;
    var result = e.markInvoiceSent(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/financial/payments
 * Record a payment.
 */
router.post('/financial/payments', mutationPermission('POST', '/financial/payments'), (req, res) => {
  try {
    var e = _getEngines().fin;
    var invoice = e.getInvoice(req.body && req.body.invoiceId);
    if (_denyHiddenSimulation(invoice, req.query.sessionId, res)) return;
    var result = e.recordPayment(_bodyWithInheritedScope(req.body, invoice));
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/financial/metrics
 * Get financial metrics.
 */
router.get('/financial/metrics', (req, res) => {
  try {
    var e = _getEngines().fin;
    var metrics = e.getFinancialMetrics();
    var estimates = _filterBySession(e.listEstimates().estimates || [], req.query.sessionId).filter(function (estimate) {
      return estimate.status !== 'archived' && estimate.status !== 'rejected';
    });
    metrics.pendingEstimateCount = estimates.length;
    metrics.pendingEstimateTotal = Math.round(estimates.reduce(function (sum, estimate) {
      return sum + (Number(estimate.total) || 0);
    }, 0) * 100) / 100;
    res.json({
      metrics: metrics,
      profitability: e.calculateProfitability(),
      forecast: e.calculateRevenueForecast(3),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// ASSET ENGINE
// ══════════════════════════════════════════════

/**
 * GET /api/v1/assets
 * List assets.
 */
router.get('/assets', (req, res) => {
  try {
    var e = _getEngines().ast;
    var filters = {};
    if (req.query.type) filters.type = req.query.type;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.limit) filters.limit = parseInt(req.query.limit);
    var result = e.listAssets(filters);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/assets
 * Create an asset.
 */
router.post('/assets', mutationPermission('POST', '/assets'), (req, res) => {
  try {
    var all = _getEngines();
    var body = req.body || {};
    var parent = null;
    if (body.assignedCustomerId) {
      parent = all.customers.getCustomer(body.assignedCustomerId);
      if (_denyHiddenSimulation(parent, req.query.sessionId, res)) return;
    }
    if (body.assignedOpportunityId) {
      var opportunity = all.opps.getOpportunity(body.assignedOpportunityId);
      if (_denyHiddenSimulation(opportunity, req.query.sessionId, res)) return;
      parent = parent || opportunity;
    }
    if (body.assignedWorkflowId) {
      var workflow = all.wf.getTask(body.assignedWorkflowId);
      if (_denyHiddenSimulation(workflow, req.query.sessionId, res)) return;
      parent = parent || workflow;
    }
    var result = all.ast.createAsset(_bodyWithInheritedScope(body, parent));
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/assets/metrics
 * Get asset metrics.
 */
router.get('/assets/metrics', (req, res) => {
  try {
    var e = _getEngines().ast;
    res.json(e.getAssetMetrics());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/assets/:id
 * Get a single asset.
 */
router.get('/assets/:id', (req, res) => {
  try {
    var e = _getEngines().ast;
    var result = e.getAsset(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/v1/assets/:id
 * Update an asset.
 */
router.put('/assets/:id', mutationPermission('PUT', '/assets/:id'), (req, res) => {
  try {
    var e = _getEngines().ast;
    var existing = e.getAsset(req.params.id);
    if (_denyHiddenSimulation(existing, req.query.sessionId, res)) return;
    var result = e.updateAsset(req.params.id, _bodyWithInheritedScope(req.body, existing));
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/assets/:id/maintenance
 * Schedule maintenance.
 */
router.post('/assets/:id/maintenance', mutationPermission('POST', '/assets/:id/maintenance'), (req, res) => {
  try {
    var e = _getEngines().ast;
    var asset = e.getAsset(req.params.id);
    if (_denyHiddenSimulation(asset, req.query.sessionId, res)) return;
    var data = _bodyWithInheritedScope(req.body, asset);
    data.assetId = req.params.id;
    var result = e.scheduleMaintenance(data);
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/assets/:id/analytics
 * Get asset analytics.
 */
router.get('/assets/:id/analytics', (req, res) => {
  try {
    var e = _getEngines().ast;
    res.json({
      utilization: e.calculateUtilization(req.params.id),
      operatingCost: e.calculateOperatingCost(req.params.id),
      depreciation: e.calculateDepreciation(req.params.id),
      replacementScore: e.calculateReplacementScore(req.params.id),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/assets/metrics
 * Get asset metrics.
 */
router.get('/assets/metrics', (req, res) => {
  try {
    var e = _getEngines().ast;
    res.json(e.getAssetMetrics());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// CREW ENGINE
// ══════════════════════════════════════════════

/**
 * GET /api/v1/crew/employees
 * List employees.
 */
router.get('/crew/employees', (req, res) => {
  try {
    var e = _getEngines().crew;
    var filters = {};
    if (req.query.role) filters.role = req.query.role;
    if (req.query.status) filters.status = req.query.status;
    var result = e.listEmployees(filters);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/crew/employees
 * Create an employee.
 */
router.post('/crew/employees', mutationPermission('POST', '/crew/employees'), (req, res) => {
  try {
    var e = _getEngines().crew;
    var result = e.createEmployee(req.body);
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/crew/employees/:id
 * Get a single employee.
 */
router.get('/crew/employees/:id', (req, res) => {
  try {
    var e = _getEngines().crew;
    var result = e.getEmployee(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/v1/crew/employees/:id
 * Update an employee.
 */
router.put('/crew/employees/:id', mutationPermission('PUT', '/crew/employees/:id'), (req, res) => {
  try {
    var e = _getEngines().crew;
    var existing = e.getEmployee(req.params.id);
    if (_denyHiddenSimulation(existing, req.query.sessionId, res)) return;
    var result = e.updateEmployee(req.params.id, _bodyWithInheritedScope(req.body, existing));
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/crew/crews
 * List crews.
 */
router.get('/crew/crews', (req, res) => {
  try {
    var e = _getEngines().crew;
    var result = e.listCrews();
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/crew/crews
 * Create a crew.
 */
router.post('/crew/crews', mutationPermission('POST', '/crew/crews'), (req, res) => {
  try {
    var all = _getEngines();
    var body = req.body || {};
    var parent = null;
    if (body.assignedCustomerId) {
      parent = all.customers.getCustomer(body.assignedCustomerId);
      if (_denyHiddenSimulation(parent, req.query.sessionId, res)) return;
    }
    if (body.assignedOpportunityId) {
      var opportunity = all.opps.getOpportunity(body.assignedOpportunityId);
      if (_denyHiddenSimulation(opportunity, req.query.sessionId, res)) return;
      parent = parent || opportunity;
    }
    if (body.assignedWorkflowId) {
      var workflow = all.wf.getTask(body.assignedWorkflowId);
      if (_denyHiddenSimulation(workflow, req.query.sessionId, res)) return;
      parent = parent || workflow;
    }
    if (body.foremanId) {
      var foreman = all.crew.getEmployee(body.foremanId);
      if (_denyHiddenSimulation(foreman, req.query.sessionId, res)) return;
      parent = parent || foreman;
    }
    var result = all.crew.createCrew(_bodyWithInheritedScope(body, parent));
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/crew/crews/:id/assign
 * Assign a crew.
 */
router.post('/crew/crews/:id/assign', mutationPermission('POST', '/crew/crews/:id/assign'), (req, res) => {
  try {
    var e = _getEngines().crew;
    var existing = e.getCrew(req.params.id);
    if (_denyHiddenSimulation(existing, req.query.sessionId, res)) return;
    var result = e.assignCrew(req.params.id, _bodyWithInheritedScope(req.body, existing));
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/crew/metrics
 * Get crew metrics.
 */
router.get('/crew/metrics', (req, res) => {
  try {
    var e = _getEngines().crew;
    res.json(e.getCrewMetrics());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// JOB ENGINE
// ══════════════════════════════════════════════

/**
 * GET /api/v1/jobs
 * List jobs.
 */
router.get('/jobs', (req, res) => {
  try {
    var e = _getEngines().job;
    var filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.customerId) filters.customerId = req.query.customerId;
    if (req.query.limit) filters.limit = parseInt(req.query.limit);
    var result = e.listJobs(filters);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/jobs
 * Create a job.
 */
router.post('/jobs', mutationPermission('POST', '/jobs'), (req, res) => {
  try {
    var all = _getEngines();
    var body = req.body || {};
    var customer = body.customerId ? all.customers.getCustomer(body.customerId) : null;
    if (_denyHiddenSimulation(customer, req.query.sessionId, res)) return;
    var parent = customer;
    if (body.opportunityId) {
      var opportunity = all.opps.getOpportunity(body.opportunityId);
      if (_denyHiddenSimulation(opportunity, req.query.sessionId, res)) return;
      parent = opportunity;
    }
    var result = all.job.createJob(_bodyWithInheritedScope(body, parent));
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/jobs/metrics
 * Get job metrics.
 */
router.get('/jobs/metrics', (req, res) => {
  try {
    var e = _getEngines().job;
    res.json(e.getJobMetrics());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/jobs/:id
 * Get a single job.
 */
router.get('/jobs/:id', (req, res) => {
  try {
    var e = _getEngines().job;
    var result = e.getJob(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/v1/jobs/:id
 * Update a job.
 */
router.put('/jobs/:id', mutationPermission('PUT', '/jobs/:id'), (req, res) => {
  try {
    var e = _getEngines().job;
    var existing = e.getJob(req.params.id);
    if (_denyHiddenSimulation(existing, req.query.sessionId, res)) return;
    var result = e.updateJob(req.params.id, _bodyWithInheritedScope(req.body, existing));
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/jobs/:id/schedule
 * Schedule a job.
 */
router.post('/jobs/:id/schedule', mutationPermission('POST', '/jobs/:id/schedule'), (req, res) => {
  try {
    var e = _getEngines().job;
    if (_denyHiddenSimulation(e.getJob(req.params.id), req.query.sessionId, res)) return;
    var result = e.scheduleJob(req.params.id, req.body.scheduledStart, req.body.scheduledEnd);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/jobs/:id/start
 * Start a job.
 */
router.post('/jobs/:id/start', mutationPermission('POST', '/jobs/:id/start'), (req, res) => {
  try {
    var e = _getEngines().job;
    if (_denyHiddenSimulation(e.getJob(req.params.id), req.query.sessionId, res)) return;
    var result = e.startJob(req.params.id);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/jobs/:id/complete
 * Complete a job.
 */
router.post('/jobs/:id/complete', mutationPermission('POST', '/jobs/:id/complete'), (req, res) => {
  try {
    var e = _getEngines().job;
    var existing = e.getJob(req.params.id);
    if (_denyHiddenSimulation(existing, req.query.sessionId, res)) return;
    var result = e.completeJob(req.params.id, _bodyWithInheritedScope(req.body, existing));
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/jobs/:id/production
 * Record production.
 */
router.post('/jobs/:id/production', mutationPermission('POST', '/jobs/:id/production'), (req, res) => {
  try {
    var e = _getEngines().job;
    var existing = e.getJob(req.params.id);
    if (_denyHiddenSimulation(existing, req.query.sessionId, res)) return;
    var result = e.recordProduction(req.params.id, _bodyWithInheritedScope(req.body, existing));
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/jobs/:id/issue
 * Record an issue.
 */
router.post('/jobs/:id/issue', mutationPermission('POST', '/jobs/:id/issue'), (req, res) => {
  try {
    var e = _getEngines().job;
    var existing = e.getJob(req.params.id);
    if (_denyHiddenSimulation(existing, req.query.sessionId, res)) return;
    var result = e.recordIssue(req.params.id, _bodyWithInheritedScope(req.body, existing));
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/jobs/:id/analytics
 * Get job analytics.
 */
router.get('/jobs/:id/analytics', (req, res) => {
  try {
    var e = _getEngines().job;
    res.json({
      progress: e.calculateProgress(req.params.id),
      productionRate: e.calculateProductionRate(req.params.id),
      cost: e.calculateJobCost(req.params.id),
      profitability: e.calculateProfitability(req.params.id),
      scheduleVariance: e.calculateScheduleVariance(req.params.id),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/jobs/metrics
 * Get job metrics.
 */
router.get('/jobs/metrics', (req, res) => {
  try {
    var e = _getEngines().job;
    res.json(e.getJobMetrics());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// ANALYTICS ENGINE
// ══════════════════════════════════════════════

/**
 * GET /api/v1/analytics/dashboard
 * Get the main dashboard.
 */
router.get('/analytics/dashboard', (req, res) => {
  try {
    var e = _getEngines().bi;
    var r = e.generateDashboard(req.query.sessionId);
    if (r && r.customers) r.customers = _filterBySession(r.customers, req.query.sessionId);
    if (r && r.recentLeads) r.recentLeads = _filterBySession(r.recentLeads, req.query.sessionId);
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/analytics/executive
 * Get executive summary.
 */
router.get('/analytics/executive', (req, res) => {
  try {
    var e = _getEngines().bi;
    var r = e.generateExecutiveSummary(req.query.sessionId);
    if (r && r.customers) r.customers = _filterBySession(r.customers, req.query.sessionId);
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/analytics/kpis
 * Get KPIs.
 */
router.get('/analytics/kpis', (req, res) => {
  try {
    var e = _getEngines().bi;
    var r = e.generateKPIs(req.query.sessionId);
    if (r && r.customers) r.customers = _filterBySession(r.customers, req.query.sessionId);
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/analytics/alerts
 * Get alerts.
 */
router.get('/analytics/alerts', (req, res) => {
  try {
    var e = _getEngines().bi;
    res.json(e.generateAlerts(req.query.sessionId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/analytics/:category
 * Get analytics by category.
 */
router.get('/analytics/:category', (req, res) => {
  try {
    var e = _getEngines().bi;
    var result = e.getAnalytics(req.params.category, req.query.sessionId);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/analytics/reports/list
 * List available reports.
 */
router.get('/analytics/reports/list', (req, res) => {
  try {
    var e = _getEngines().bi;
    res.json(e.listReports());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// POLARIS INTELLIGENCE REPORT
// ══════════════════════════════════════════════

/**
 * POST /api/v1/polaris/intelligence
 * Generate a complete Polaris Intelligence Report for a lead/opportunity.
 * Aggregates data from all M13 engines into a single unified estimate.
 */
router.post('/polaris/intelligence', mutationPermission('POST', '/polaris/intelligence'), (req, res) => {
  try {
    var data = req.body || {};
    var sessionId = req.query.sessionId || data.sessionId;
    if (data.customerId) {
      var customer = _getEngines().customers.getCustomer(data.customerId);
      if (_denyHiddenSimulation(customer, sessionId, res)) return;
    }
    var svc = data.service || data.serviceRequested || 'General';
    var description = data.description || '';
    var scope = description ? description.length : 50;
    var difficulty = scope > 200 ? 'high' : scope > 100 ? 'medium' : 'low';
    var basePrice = data.avgPrice || data.estimatedValue || 0;
    var region = data.region || 'default';

    var laborRates = {
      'HVAC Repair': 95, 'HVAC Installation': 110, 'Plumbing': 90,
      'Plumbing Repair': 90, 'Electrical': 100, 'Electrical Repair': 100,
      'Roofing': 85, 'Landscaping': 65, 'Tree removal': 95,
      'Chimney Service': 85, 'Flooring': 75, 'General': 80,
    };
    var laborRate = laborRates[svc] || 80;
    var baseHours = 2.5;
    if (svc.indexOf('HVAC Installation') >= 0) baseHours = 6;
    else if (svc.indexOf('HVAC Repair') >= 0) baseHours = 2.5;
    else if (svc.indexOf('Installation') >= 0) baseHours = 6;
    else if (svc.indexOf('Roofing') >= 0) baseHours = 8;
    else if (svc.indexOf('Tree') >= 0) baseHours = 4;
    else if (svc.indexOf('Landscaping') >= 0) baseHours = 3;

    var diffMultiplier = difficulty === 'high' ? 1.35 : difficulty === 'medium' ? 1.15 : 1.0;
    var regionMultiplier = region === 'northeast' ? 1.25 : region === 'midwest' ? 0.85 : region === 'south' ? 0.9 : region === 'west' ? 1.2 : 1.0;
    var effectiveRate = Math.round(laborRate * regionMultiplier * diffMultiplier * 100) / 100;
    var hours = data.hours || baseHours;
    var laborCost = Math.round(hours * effectiveRate * 100) / 100;

    var materialCosts = {
      'HVAC Repair': 225, 'HVAC Installation': 1350, 'Plumbing': 185,
      'Plumbing Repair': 150, 'Electrical': 110, 'Electrical Repair': 85,
      'Roofing': 2150, 'Landscaping': 330, 'Tree removal': 50,
      'Chimney Service': 160, 'Flooring': 700, 'General': 130,
    };
    var materialCost = Math.round((materialCosts[svc] || 130) * regionMultiplier * diffMultiplier * 100) / 100;
    var equipCost = 0;
    if (svc.indexOf('HVAC Installation') >= 0) equipCost = 350;
    else if (svc.indexOf('Landscaping') >= 0) equipCost = 120;
    else if (svc.indexOf('Tree') >= 0) equipCost = 200;
    else if (svc.indexOf('Flooring') >= 0) equipCost = 50;
    equipCost = Math.round(equipCost * regionMultiplier * 100) / 100;

    var travelPct = 0.05, travelMin = 25;
    var travelCost = Math.max(Math.round(laborCost * travelPct * 100) / 100, travelMin);
    var disposalPct = 0.03, disposalMin = 15;
    var disposalCost = Math.max(Math.round((materialCost + equipCost) * disposalPct * 100) / 100, disposalMin);
    var permitPct = 0.02;
    var permitCost = Math.round((laborCost + materialCost) * permitPct * 100) / 100;
    var overheadPct = 0.15;
    var subtotalBeforeOverhead = laborCost + materialCost + equipCost + travelCost + disposalCost + permitCost;
    var overheadCost = Math.round(subtotalBeforeOverhead * overheadPct * 100) / 100;
    var profitPct = 0.20;
    var subtotal = subtotalBeforeOverhead + overheadCost;
    var profit = Math.round(subtotal * profitPct * 100) / 100;
    var taxRate = 0.07;
    var beforeTax = subtotal + profit;
    var tax = Math.round(beforeTax * taxRate * 100) / 100;
    var total = beforeTax + tax;

    var dataPoints = 0;
    if (basePrice > 0) dataPoints++;
    if (description) dataPoints++;
    if (data.summary) dataPoints++;
    if (data.jobDetail) dataPoints++;
    if (data.address || data.jobAddress) dataPoints++;
    if (data.customerId) dataPoints += 2;
    var confidence = dataPoints >= 5 ? 88 : dataPoints >= 3 ? 68 : dataPoints >= 1 ? 45 : 25;
    var confLabel = confidence >= 80 ? 'High' : confidence >= 50 ? 'Medium' : 'Low';

    var items = [
      { type: 'labor', label: 'Labor - ' + svc, description: hours + ' hrs @ $' + Math.round(effectiveRate) + '/hr', quantity: hours, unitPrice: Math.round(effectiveRate * 100) / 100, amount: laborCost },
      { type: 'materials', label: 'Materials', description: 'Parts and supplies for ' + svc, quantity: 1, unitPrice: materialCost, amount: materialCost },
    ];
    if (equipCost > 0) items.push({ type: 'equipment', label: 'Equipment', description: 'Specialized equipment', quantity: 1, unitPrice: equipCost, amount: equipCost });
    items.push({ type: 'travel', label: 'Travel Fee', description: '5% of labor for travel', quantity: 1, unitPrice: travelCost, amount: travelCost });
    if (disposalCost > 0) items.push({ type: 'disposal', label: 'Disposal Fee', description: '3% for waste disposal', quantity: 1, unitPrice: disposalCost, amount: disposalCost });
    if (permitCost > 0) items.push({ type: 'permit', label: 'Permit Fee', description: '2% for permits', quantity: 1, unitPrice: permitCost, amount: permitCost });
    items.push({ type: 'overhead', label: 'Overhead', description: '15% on direct costs', quantity: 1, unitPrice: overheadCost, amount: overheadCost });
    items.push({ type: 'profit', label: 'Profit Margin', description: '20% target profit', quantity: 1, unitPrice: profit, amount: profit });
    if (tax > 0) items.push({ type: 'tax', label: 'Sales Tax', description: '7% sales tax', quantity: 1, unitPrice: tax, amount: tax });

    var upsells = [];
    if (svc.indexOf('HVAC') >= 0) upsells.push({ label: 'Preventative Maintenance Plan', amount: Math.round(total * 0.08), description: 'Annual HVAC maintenance' });
    if (svc.indexOf('Plumbing') >= 0) upsells.push({ label: 'Water Heater Flush', amount: Math.round(total * 0.05), description: 'Extend water heater lifespan' });
    if (svc.indexOf('Roofing') >= 0) upsells.push({ label: 'Gutter Guard Installation', amount: Math.round(total * 0.12), description: 'Protect roof with gutter guards' });
    if (svc.indexOf('Electrical') >= 0) upsells.push({ label: 'Surge Protection System', amount: Math.round(total * 0.06), description: 'Whole-home surge protection' });

    var intelligence = {};
    var customerIntel = null;
    var commsIntel = null;
    var jobIntel = null;
    var crewIntel = null;
    var wfIntel = null;
    var assetsIntel = null;
    try {
      var bi = _getEngines().bi;
      if (bi) {
        intelligence.kpis = bi.generateKPIs(sessionId).kpis;
        intelligence.alerts = bi.generateAlerts(sessionId).alerts;
      }
    } catch (e) {}

    if (data.customerId) {
      try {
        var custEng = _getEngines().customers;
        if (custEng) {
          var health = custEng.calculateCustomerHealth(data.customerId);
          if (health && !health.error) {
            customerIntel = { healthScore: health.score || 0, lifecycleStage: health.lifecycleStage || health.stage || 'unknown' };
          }
        }
      } catch (e) {}
    }
    var reasoning = 'Estimate generated for ' + svc + ' (' + (difficulty === 'high' ? 'Complex' : difficulty === 'medium' ? 'Moderate' : 'Straightforward') + ' difficulty). ';
    reasoning += 'Based on ' + hours + ' hours of labor at $' + Math.round(effectiveRate) + '/hr. ';
    reasoning += 'Material costs calculated using regional pricing. ';
    reasoning += 'Includes overhead (15%), profit margin (20%), and applicable taxes (7%). ';
    reasoning += 'Confidence: ' + confLabel + ' (' + confidence + '%).';

    var estimate = {
      leadId: data.id || null,
      service: svc,
      difficulty: difficulty,
      difficultyLabel: difficulty === 'high' ? 'Complex' : difficulty === 'medium' ? 'Moderate' : 'Straightforward',
      region: region === 'default' ? 'National Average' : region,
      items: items,
      labor: laborCost,
      materials: materialCost,
      equipment: equipCost,
      travel: travelCost,
      disposal: disposalCost,
      permit: permitCost,
      overhead: overheadCost,
      profitMargin: profit,
      taxes: tax,
      subtotal: subtotal,
      total: total,
      confidence: confidence,
      confidenceLabel: confLabel,
      confidenceDescription: dataPoints >= 5 ? 'Detailed lead data available' : dataPoints >= 3 ? 'Partial lead data' : 'Estimate based on service type only',
      reasoning: reasoning,
      upsells: upsells,
      generatedAt: new Date().toISOString(),
      intelligence: intelligence,
      customerIntelligence: customerIntel,
      communicationsIntelligence: commsIntel,
      jobIntelligence: jobIntel,
      crewIntelligence: crewIntel,
      workflowIntelligence: wfIntel,
      assetsIntelligence: assetsIntel,
      breakdown: {
        revenue: total,
        labor: laborCost,
        equipment: equipCost,
        materials: materialCost,
        fuel: 0,
        travel: travelCost,
        permits: permitCost,
        insurance: 0,
        disposal: disposalCost,
        taxes: tax,
        overhead: overheadCost,
        grossMargin: Math.round((total - laborCost - materialCost - equipCost) / total * 10000) / 100 + '%',
        netProfit: profit,
        profitMargin: Math.round(profit / total * 10000) / 100 + '%',
      },
    };

    res.json(estimate);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// POLARIS EXECUTIVE SUMMARY
// ══════════════════════════════════════════════

/**
 * POST /api/v1/polaris/executive-summary
 * Generate a unified executive summary from all available intelligence.
 * Aggregates data from all M13 engines into a single cohesive view.
 */
router.post("/polaris/executive-summary", mutationPermission('POST', '/polaris/executive-summary'), (req, res) => {
  try {
    var data = req.body || {};
    var sessionId = req.query.sessionId || data.sessionId;
    if (data.customerId) {
      var customer = _getEngines().customers.getCustomer(data.customerId);
      if (_denyHiddenSimulation(customer, sessionId, res)) return;
    }
    var summary = {
      generatedAt: new Date().toISOString(),
      overview: {},
      financial: {},
      customer: {},
      operations: {},
      risks: [],
      recommendations: [],
      nextActions: [],
    };

    // Financial overview
    try {
      var bi = _getEngines().bi;
      if (bi) {
        var kpis = bi.generateKPIs(sessionId);
        if (kpis && kpis.kpis) {
          summary.financial.revenue = kpis.kpis.totalRevenue || 0;
          summary.financial.outstanding = kpis.kpis.outstandingRevenue || 0;
          summary.financial.profitMargin = kpis.kpis.profitMargin || 0;
        }
        var alerts = bi.generateAlerts(sessionId);
        if (alerts && alerts.alerts) {
          summary.risks = alerts.alerts.filter(function(a) { return a.severity === "critical" || a.severity === "warning"; }).map(function(a) { return { type: a.type, message: a.message, severity: a.severity }; });
        }
      }
    } catch (e) {}

    // Customer overview
    try {
      var custEng = _getEngines().customers;
      if (custEng && data.customerId) {
        var health = custEng.calculateCustomerHealth(data.customerId);
        if (health && !health.error) {
          summary.customer.health = health.score || 0;
          summary.customer.lifecycle = health.lifecycleStage || health.stage || "unknown";
          summary.customer.lifetimeValue = health.lifetimeValue || 0;
          summary.customer.totalJobs = health.totalJobs || 0;
        }
      }
    } catch (e) {}

    // Communications overview
    try {
      var commsEng = _getEngines().comms;
      if (commsEng && data.customerId) {
        var visibleCommunications = _filterBySession(
          commsEng.getCommunications(data.customerId, {}).communications || [], sessionId
        );
        var engagement = commsEng.getEngagementScore(data.customerId, visibleCommunications);
        var followUps = commsEng.getFollowUpRecommendations(data.customerId, visibleCommunications);
        summary.customer.engagement = (typeof engagement === "number") ? engagement : (engagement && engagement.score) || 0;
        summary.customer.pendingFollowUps = (followUps || []).length;
        if (summary.customer.pendingFollowUps > 0) {
          summary.recommendations.push("Contact customer: " + summary.customer.pendingFollowUps + " follow-up(s) pending");
          summary.nextActions.push("Reach out to customer regarding pending follow-ups");
        }
      }
    } catch (e) {}

    // Job overview
    try {
      var jobEng = _getEngines().job;
      if (jobEng) {
        var metrics = jobEng.getJobMetrics();
        if (metrics) {
          summary.operations.activeJobs = metrics.activeJobs || 0;
          summary.operations.completedJobs = metrics.completedJobs || 0;
          summary.operations.openIssues = metrics.openIssues || 0;
          summary.operations.atRisk = metrics.atRisk || 0;
        }
      }
    } catch (e) {}

    // Workflow overview
    try {
      var wfEng = _getEngines().wf;
      if (wfEng) {
        var wfMetrics = wfEng.getWorkflowMetrics();
        if (wfMetrics) {
          summary.operations.pendingTasks = wfMetrics.pendingTasks || 0;
          summary.operations.overdueTasks = wfMetrics.overdueTasks || 0;
          summary.operations.completionRate = wfMetrics.completionRate || 0;
          if (summary.operations.overdueTasks > 0) {
            summary.risks.push({ type: "workflow", message: summary.operations.overdueTasks + " overdue task(s)", severity: "warning" });
            summary.recommendations.push("Address " + summary.operations.overdueTasks + " overdue task(s)");
            summary.nextActions.push("Review and resolve overdue tasks");
          }
        }
      }
    } catch (e) {}

    // Crew overview
    try {
      var crewEng = _getEngines().crew;
      if (crewEng) {
        var crewMetrics = crewEng.getCrewMetrics();
        if (crewMetrics) {
          summary.operations.activeCrews = crewMetrics.activeCrews || 0;
          summary.operations.crewUtilization = crewMetrics.utilization || 0;
        }
      }
    } catch (e) {}

    // Asset overview
    try {
      var astEng = _getEngines().ast;
      if (astEng) {
        var astMetrics = astEng.getAssetMetrics();
        if (astMetrics) {
          summary.operations.totalAssets = astMetrics.totalAssets || 0;
          summary.operations.maintenanceDue = astMetrics.maintenanceDue || 0;
          if (summary.operations.maintenanceDue > 0) {
            summary.risks.push({ type: "asset", message: summary.operations.maintenanceDue + " asset(s) due for maintenance", severity: "info" });
          }
        }
      }
    } catch (e) {}

    // Build overview
    var overviewParts = [];
    var financialHealth = "stable";
    if (summary.financial.revenue > 0) {
      overviewParts.push("Revenue: $" + Math.round(summary.financial.revenue).toLocaleString());
    }
    if (summary.operations.activeJobs > 0) {
      overviewParts.push(summary.operations.activeJobs + " active job(s)");
    }
    if (summary.customer.health > 0) {
      overviewParts.push("Customer health: " + summary.customer.health + "/100");
      if (summary.customer.health < 50) financialHealth = "at-risk";
    }
    if (summary.operations.overdueTasks > 0) {
      overviewParts.push(summary.operations.overdueTasks + " overdue task(s)");
    }
    if (summary.operations.crewUtilization > 0) {
      overviewParts.push("Crew utilization: " + Math.round(summary.operations.crewUtilization) + "%");
    }
    summary.overview = {
      summary: overviewParts.length > 0 ? overviewParts.join(" | ") : "No operational data available.",
      health: financialHealth,
      riskCount: summary.risks.length,
      recommendationCount: summary.recommendations.length,
    };

    // Add default recommendations if none exist
    if (summary.recommendations.length === 0) {
      summary.recommendations.push("All systems operational");
    }
    if (summary.nextActions.length === 0) {
      summary.nextActions.push("Review dashboard for current status");
    }

    res.json(summary);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════
// META — Engine Status
// ══════════════════════════════════════════════

/**
 * GET /api/v1/engines
 * List all available engines and their status.
 */
router.get('/engines', (req, res) => {
  var e = _getEngines();
  var status = {
    customers: !!e.customers,
    communications: !!e.comms,
    opportunities: !!e.opps,
    workflows: !!e.wf,
    financial: !!e.fin,
    assets: !!e.ast,
    crew: !!e.crew,
    jobs: !!e.job,
    analytics: !!e.bi,
  };
  res.json({
    version: '13.0',
    allEnginesLoaded: Object.values(status).every(Boolean),
    engines: status,
  });
});

module.exports = router;
