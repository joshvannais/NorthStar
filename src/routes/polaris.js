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

// ── Middleware ──
router.use((req, res, next) => {
  res.setHeader('X-Polaris-Version', '2.0');
  next();
});

/**
 * GET /api/v1/polaris/status
 * Health check and engine status.
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
    res.json(intelligence);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/polaris/estimate
 * Generate a multi-variable estimate.
 * Body: { serviceType, description, squareFootage, crewSize, equipmentRequired, travelDistance, ... }
 */
router.post('/estimate', (req, res) => {
  try {
    const estimate = polaris.generateEstimate(req.body);
    if (!estimate) {
      return res.status(400).json({ error: 'Could not generate estimate. serviceType is required.' });
    }
    res.json(estimate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/polaris/complete
 * Record a completed job for learning.
 * Body: { serviceType, estimatedDuration, actualDuration, estimatedRevenue, actualRevenue, ... }
 */
router.post('/complete', (req, res) => {
  try {
    const result = polaris.recordCompletion(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/polaris/recommendations/generate
 * Trigger recommendation generation.
 * Body: { leads, events, jobs }
 */
router.post('/recommendations/generate', (req, res) => {
  try {
    const recs = polaris.generateRecommendations(req.body);
    res.json({ generated: recs.length, recommendations: recs });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const recs = polaris.getRecommendations(resolved);
    res.json({ count: recs.length, recommendations: recs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/v1/polaris/recommendations/:id/resolve
 * Mark a recommendation as resolved.
 */
router.put('/recommendations/:id/resolve', (req, res) => {
  try {
    const result = polaris.resolveRecommendation(req.params.id);
    if (!result) return res.status(404).json({ error: 'Recommendation not found' });
    res.json({ resolved: true, recommendation: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/polaris/jobs
 * Get completed jobs (for learning analysis).
 */
router.get('/jobs', (req, res) => {
  try {
    const jobs = polaris.getCompletedJobs();
    res.json({ count: jobs.length, jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/polaris/estimates
 * Get historical estimates.
 */
router.get('/estimates', (req, res) => {
  try {
    const estimates = polaris.getHistoricalEstimates();
    res.json({ count: estimates.length, estimates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/polaris/query
 * Future ChatGPT integration interface.
 * Body: { query: "What jobs will run late?", context: { leads, events, jobs } }
 */
router.post('/query', (req, res) => {
  try {
    const { query, context } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    const result = polaris.prepareQueryContext(query, context || {});
    res.json({ query, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/polaris/pipeline
 * Analyze pipeline from leads in body.
 * Body: { leads: [...] }
 */
router.post('/pipeline', (req, res) => {
  try {
    const analysis = polaris.analyzePipeline(req.body.leads || []);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/polaris/config
 * Update estimation configuration at runtime.
 * Body: { laborRates: {...}, baseHours: {...}, ... }
 */
router.post('/config', (req, res) => {
  try {
    polaris.loadEstimationConfig(req.body);
    res.json({ status: 'configuration updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/polaris/chat
 * Send a message to the Polaris AI assistant (OpenAI).
 * Body: { message: "..." }
 * Response: { success: true, response: "..." }
 */
router.post('/chat', (req, res) => {
  const message = req.body && req.body.message;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Message is required.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[Polaris Chat] OPENAI_API_KEY not configured');
    return res.status(500).json({ success: false, error: 'Polaris is not configured for chat yet.' });
  }

  const payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are POLARIS, the AI intelligence assistant for NorthStar Solutions, a home services contractor platform. You help contractors run their business better: analyze leads, check schedules, estimate jobs, track crews, and recommend actions. Keep responses concise, practical, and actionable. If you don\'t know something, say so — never make up data.'
      },
      { role: 'user', content: message.trim() }
    ],
    max_tokens: 800,
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
          res.json({ success: true, response: reply });
        } else {
          const errMsg = parsed.error ? parsed.error.message : 'Unknown error';
          console.error('[Polaris Chat] OpenAI error:', resIn.statusCode, errMsg);
          if (resIn.statusCode === 401) {
            return res.status(500).json({ success: false, error: 'Polaris chat is not properly configured.' });
          }
          if (resIn.statusCode === 429) {
            return res.status(429).json({ success: false, error: 'Polaris is rate-limited. Please wait a moment and try again.' });
          }
          res.status(500).json({ success: false, error: 'Polaris couldn\'t complete that request. Please try again.' });
        }
      } catch (e) {
        console.error('[Polaris Chat] Parse error:', e.message);
        res.status(500).json({ success: false, error: 'Polaris couldn\'t complete that request. Please try again.' });
      }
    });
  });

  reqOut.on('error', (e) => {
    console.error('[Polaris Chat] Request error:', e.message);
    if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET') {
      return res.status(504).json({ success: false, error: 'Polaris took too long to respond. Please try again.' });
    }
    res.status(500).json({ success: false, error: 'Polaris couldn\'t complete that request. Please try again.' });
  });

  reqOut.on('timeout', () => {
    reqOut.destroy();
    res.status(504).json({ success: false, error: 'Polaris took too long to respond. Please try again.' });
  });

  reqOut.write(payload);
  reqOut.end();
});

module.exports = router;