/**
 * Polaris API Routes — Application Interface
 *
 * These routes expose the Polaris engine to the application.
 * Every page (Dashboard, Calendar, Leads, Communications) consumes Polaris through these endpoints.
 *
 * All routes are prefixed with /api/v1/polaris
 */

const express = require('express');
const router = express.Router();
const polaris = require('../polaris/engine');
const https = require('https');
const { requireAuth } = require('../auth/middleware');
const { requireOrgMembership } = require('../auth/permissions');
const { permissionFor } = require('../auth/polarisRoutePermissions');
const demoScope = require('../services/demoRecordScope');

function mutationPermission(method, path) {
  return permissionFor('polaris', method, path);
}

function filterScopedRecords(records, sessionId) {
  const access = demoScope.resolveAccess(sessionId);
  return (Array.isArray(records) ? records : []).filter(function (record) {
    return demoScope.canAccessTenant(record && (record.data || record), access);
  });
}

// ── Middleware ──
router.use((req, res, next) => {
  res.setHeader('X-Polaris-Version', '2.0');
  const sendJson = res.json.bind(res);
  res.json = function (body) {
    const rawError = body && body.error;
    const rawMessage = typeof rawError === 'string'
      ? rawError
      : rawError && typeof rawError.message === 'string' ? rawError.message : null;
    if (res.statusCode >= 500 && rawMessage) {
      console.error('[Polaris] Internal route failure:', {
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

/**
 * GET /api/v1/polaris/status
 * Health check and engine status. PUBLIC — no auth required.
 */
router.get('/status', (req, res) => {
  res.json({
    status: 'operational',
    version: '2.0',
    engine: 'Polaris Intelligence Engine',
    capabilities: [
      'estimation', 'learning', 'recommendations',
      'pipeline_analysis', 'schedule_analysis',
      'chatgpt_interface', 'retell_interface',
    ],
  });
});

// ── All routes below this point require authentication ──
router.use(requireAuth);
router.use(requireOrgMembership);
router.use(function (req, res, next) {
  demoScope.runWithAccess(req, next);
});
router.use(function (req, _res, next) {
  if (/^(?:POST|PUT|PATCH)$/.test(req.method) && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const clean = Object.assign({}, req.body);
    delete clean.organizationId;
    delete clean.ownerUserId;
    delete clean.simulationSessionId;
    delete clean.demoSessionId;
    delete clean.recordScope;
    const metadata = Object.assign({}, clean.metadata || {});
    delete metadata.organizationId;
    delete metadata.ownerUserId;
    delete metadata.simulationSessionId;
    delete metadata.recordScope;
    const access = demoScope.resolveAccess();
    clean.metadata = Object.assign(metadata, {
      organizationId: access.organizationId,
      ownerUserId: access.userId,
    });
    req.body = clean;
  }
  next();
});

/**
 * GET /api/v1/polaris/intelligence
 * Get full dashboard intelligence (pipeline + schedule + learning + recommendations).
 * Query params: ?leads=true&events=true&jobs=true
 */
router.get('/intelligence', (req, res) => {
  try {
    const leads = []; // In production, load from leads store
    const events = []; // In production, load from calendar store
    const jobs = polaris.getCompletedJobs();

    const intelligence = polaris.getDashboardIntelligence(leads, events, jobs);
    intelligence.recommendations = filterScopedRecords(intelligence.recommendations, req.query.sessionId);
    res.json(intelligence);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/polaris/estimate
 * Generate a multi-variable estimate.
 * Body: { serviceType, description, squareFootage, crewSize, equipmentRequired, travelDistance, ... }
 */
router.post('/estimate', mutationPermission('POST', '/estimate'), (req, res) => {
  try {
    if (req.body && req.body.leadId) {
      const lead = require('../leads/store').getLead(req.body.leadId);
      if (!demoScope.canAccessTenant(lead, demoScope.resolveAccess(req.query.sessionId))) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
      }
    }
    const estimate = polaris.generateEstimate(req.body);
    if (!estimate) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Could not generate estimate. serviceType is required.' } });
    }
    res.json(estimate);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/polaris/complete
 * Record a completed job for learning.
 * Body: { serviceType, estimatedDuration, actualDuration, estimatedRevenue, actualRevenue, ... }
 */
router.post('/complete', mutationPermission('POST', '/complete'), (req, res) => {
  try {
    const result = polaris.recordCompletion(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/polaris/learning
 * Get learning metrics and predictions.
 * Query params: ?serviceType=HVAC%20Repair
 */
router.get('/learning', (req, res) => {
  try {
    const svc = req.query.serviceType;
    if (svc) {
      const predictions = polaris.getDurationPredictions(svc);
      return res.json({ serviceType: svc, predictions });
    }
    const summary = polaris.getLearningSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/polaris/recommendations/generate
 * Trigger recommendation generation.
 * Body: { leads, events, jobs }
 */
router.post('/recommendations/generate', mutationPermission('POST', '/recommendations/generate'), (req, res) => {
  try {
    const access = demoScope.resolveAccess(req.query.sessionId);
    const body = Object.assign({}, req.body);
    ['leads', 'events', 'jobs', 'crews'].forEach(function (key) {
      if (Array.isArray(body[key])) body[key] = demoScope.filterTenantRecords(body[key], access);
    });
    const recs = polaris.generateRecommendations(body);
    res.json({ generated: recs.length, recommendations: recs });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/polaris/recommendations
 * Get recommendations.
 * Query params: ?resolved=false (default: unresolved only)
 */
router.get('/recommendations', (req, res) => {
  try {
    const resolved = req.query.resolved === 'true' ? true : req.query.resolved === 'all' ? undefined : false;
    const recs = filterScopedRecords(polaris.getRecommendations(resolved), req.query.sessionId);
    res.json({ count: recs.length, recommendations: recs });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * PUT /api/v1/polaris/recommendations/:id/resolve
 * Mark a recommendation as resolved.
 */
router.put('/recommendations/:id/resolve', mutationPermission('PUT', '/recommendations/:id/resolve'), (req, res) => {
  try {
    const existing = polaris.getRecommendations(undefined).find(function (recommendation) {
      return recommendation.id === req.params.id;
    });
    if (!existing || !demoScope.canAccessTenant(existing.data || existing, demoScope.resolveAccess(req.query.sessionId))) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recommendation not found' } });
    }
    const result = polaris.resolveRecommendation(req.params.id);
    if (!result) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recommendation not found' } });
    res.json({ resolved: true, recommendation: result });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/polaris/jobs
 * Get completed jobs (for learning analysis).
 */
router.get('/jobs', (req, res) => {
  try {
    const jobs = filterScopedRecords(polaris.getCompletedJobs(), req.query.sessionId);
    res.json({ count: jobs.length, jobs });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/polaris/estimates
 * Get historical estimates.
 */
router.get('/estimates', (req, res) => {
  try {
    const estimates = filterScopedRecords(polaris.getHistoricalEstimates(), req.query.sessionId);
    res.json({ count: estimates.length, estimates });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/polaris/query
 * Future ChatGPT integration interface.
 * Body: { query: "What jobs will run late?", context: { leads, events, jobs } }
 */
router.post('/query', mutationPermission('POST', '/query'), (req, res) => {
  try {
    const { query, context } = req.body;
    if (!query) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'query is required' } });
    const result = polaris.prepareQueryContext(query, context || {});
    if (Array.isArray(result.recommendations)) {
      result.recommendations = filterScopedRecords(result.recommendations, req.query.sessionId);
    }
    if (Array.isArray(result.historicalEstimates)) {
      result.historicalEstimates = filterScopedRecords(result.historicalEstimates, req.query.sessionId);
    }
    res.json({ query, result });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/polaris/retell-context
 * Future Retell AI integration interface.
 * Returns scheduling and availability data for voice conversations.
 */
router.get('/retell-context', (req, res) => {
  try {
    const events = []; // In production, load from calendar store
    const context = polaris.prepareRetellContext(events);
    res.json(context);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/polaris/pipeline
 * Analyze pipeline from provided leads.
 * Query params: Pass leads as JSON array in query string (for now, returns empty analysis)
 */
router.get('/pipeline', (req, res) => {
  try {
    const analysis = polaris.analyzePipeline([]);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/polaris/pipeline
 * Analyze pipeline from leads in body.
 * Body: { leads: [...] }
 */
router.post('/pipeline', mutationPermission('POST', '/pipeline'), (req, res) => {
  try {
    const analysis = polaris.analyzePipeline(req.body.leads || []);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/polaris/config
 * Update estimation configuration at runtime.
 * Body: { laborRates: {...}, baseHours: {...}, ... }
 */
router.post('/config', mutationPermission('POST', '/config'), (req, res) => {
  try {
    const config = Object.assign({}, req.body);
    delete config.metadata;
    polaris.loadEstimationConfig(config);
    res.json({ status: 'configuration updated' });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * GET /api/v1/polaris/business-context
 * Returns the current business context (read-only).
 * Query params: ?page=dashboard&leadId=xxx
 */
router.get('/business-context', (req, res) => {
  try {
    const contextBuilder = require('../services/polarisContextBuilder');
    const unified = contextBuilder.buildPolarisContext({
      page: req.query.page || 'dashboard',
      leadId: req.query.leadId || null,
      sessionId: req.query.sessionId || null,
      correlationId: req.correlationId || 'unknown',
    });
    const compact = unified.compactContext;
    const context = {
      overview: compact.overview,
      leads: compact.leads,
      recommendations: compact.recommendations,
      pageContext: compact.pageContext,
      metrics: compact.metrics,
      dashboardCustomerIntelligence: compact.dashboardCustomerIntelligence,
    };
    if (req.query.leadId) {
      context.activeLead = compact.activeLead;
      context.activeLeadIntelligence = compact.activeLeadIntelligence;
      context.activeLeadDecision = compact.activeLeadDecision;
      context.activeLeadNextAction = compact.activeLeadNextAction;
      context.activeLeadCustomerIntelligence = compact.activeLeadCustomerIntelligence;
    }
    res.json({ success: true, context });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

/**
 * POST /api/v1/polaris/chat
 * Send a message to the Polaris AI assistant with unified intelligence context.
 * Uses the PolarisContextBuilder and PolarisResponseBuilder for all intelligence.
 * Body: { message: "...", context: { page: "dashboard", leadId: "..." } }
 * Response: { success: true, response: "...", meta: { ... } }
 */
router.post('/chat', mutationPermission('POST', '/chat'), (req, res) => {
  try {
    const message = req.body && req.body.message;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Message is required.' } });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('[Polaris Chat] OPENAI_API_KEY not configured');
      return res.status(500).json({ success: false, error: { code: 'CONFIGURATION_ERROR', message: 'Polaris is not configured for chat yet.' } });
    }

    // Load the unified context builder
    const contextBuilder = require('../services/polarisContextBuilder');
    const responseBuilder = require('../services/polarisResponseBuilder');

    // Build unified context from all intelligence engines
    const pageContext = (req.body && req.body.context) || {};
    const unifiedContext = contextBuilder.buildPolarisContext({
      page: pageContext.page || 'dashboard',
      leadId: pageContext.leadId || null,
      sessionId: pageContext.sessionId || null,
      userMessage: message,
      correlationId: req.correlationId || 'unknown',
    });

    // Build system prompt from unified context
    const systemPrompt = responseBuilder.buildSystemPrompt(unifiedContext);

    const payload = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message.trim() }
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 30000,
    };

    const reqOut = https.request(options, (resIn) => {
      let body = '';
      resIn.on('data', (chunk) => { body += chunk; });
      resIn.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (resIn.statusCode === 200 && parsed.choices && parsed.choices[0]) {
            const reply = parsed.choices[0].message.content;
            const structured = responseBuilder.generatePolarisResponse(reply, unifiedContext);
            res.json(structured);
          } else {
            const errMsg = parsed.error ? parsed.error.message : 'Unknown error';
            console.error('[Polaris Chat] OpenAI error:', resIn.statusCode, errMsg);
            if (resIn.statusCode === 401) {
              return res.status(500).json({ success: false, error: { code: 'CONFIGURATION_ERROR', message: 'Polaris chat is not properly configured.' } });
            }
            if (resIn.statusCode === 429) {
              return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Polaris is rate-limited. Please wait a moment and try again.' } });
            }
            res.status(500).json({ success: false, error: { code: 'AI_SERVICE_ERROR', message: 'Polaris couldn\'t complete that request. Please try again.' } });
          }
        } catch (e) {
          console.error('[Polaris Chat] Parse error:', e.message);
          res.status(500).json({ success: false, error: { code: 'AI_SERVICE_ERROR', message: 'Polaris couldn\'t complete that request. Please try again.' } });
        }
      });
    });

    reqOut.on('error', (e) => {
      console.error('[Polaris Chat] Request error:', e.message);
      if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET') {
        return res.status(504).json({ success: false, error: { code: 'TIMEOUT', message: 'Polaris took too long to respond. Please try again.' } });
      }
      res.status(500).json({ success: false, error: { code: 'AI_SERVICE_ERROR', message: 'Polaris couldn\'t complete that request. Please try again.' } });
    });

    reqOut.on('timeout', () => {
      reqOut.destroy();
      res.status(504).json({ success: false, error: { code: 'TIMEOUT', message: 'Polaris took too long to respond. Please try again.' } });
    });

    reqOut.write(payload);
    reqOut.end();
  } catch (err) {
    console.error('[Polaris Chat] Handler error:', err.message);
    console.error('[Polaris Chat] Stack:', err.stack);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Polaris chat encountered an error. Please try again.' } });
  }
});

/**
 * GET /api/v1/polaris/unified-context
 * Returns the complete unified intelligence context (read-only).
 * Query params: ?page=dashboard&leadId=xxx
 * This replaces the old /business-context endpoint.
 */
router.get('/unified-context', (req, res) => {
  try {
    const contextBuilder = require('../services/polarisContextBuilder');
    const context = contextBuilder.buildPolarisContext({
      page: req.query.page || 'dashboard',
      leadId: req.query.leadId || null,
      sessionId: req.query.sessionId || null,
    });
    res.json({ success: true, context });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

module.exports = router;
