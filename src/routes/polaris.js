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
 * GET /api/v1/polaris/business-context
 * Returns the current business context (read-only).
 * Query params: ?page=dashboard&leadId=xxx
 */
router.get('/business-context', (req, res) => {
  try {
    const ctx = require('../context/business');
    const pageContext = {
      page: req.query.page || 'dashboard',
      leadId: req.query.leadId || null,
    };
    const context = ctx.buildCompactContext(pageContext);
    res.json({ success: true, context });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/polaris/chat
 * Send a message to the Polaris AI assistant (OpenAI) with live business context.
 * Body: { message: "...", context: { page: "dashboard", leadId: "..." } }
 * Response: { success: true, response: "..." }
 */
router.post('/chat', (req, res) => {
  try {
    const message = req.body && req.body.message;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Message is required.' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('[Polaris Chat] OPENAI_API_KEY not configured');
      return res.status(500).json({ success: false, error: 'Polaris is not configured for chat yet.' });
    }

    // Load live business context
    const businessContext = require('../context/business');
    const pageContext = (req.body && req.body.context) || {};
    const contextText = businessContext.buildBusinessContext(pageContext);

  const systemPrompt = `You are POLARIS, the AI intelligence assistant for NorthStar Solutions, a home services contractor platform. You help contractors run their business better: analyze leads, check schedules, estimate jobs, track crews, and recommend actions.

GROUNDED RESPONSE POLICY:
Your responses must clearly distinguish between three types of information:

1. OBSERVED FACTS — Information directly loaded from NorthStar's business data. These are facts you can see in the context below.
2. CALCULATED METRICS — Business calculations derived from observed facts by the Business Intelligence Engine (e.g., labor cost, profit, confidence scores, travel time, production duration).
3. AI RECOMMENDATIONS — Suggestions or recommendations generated from the data. Always label these clearly as recommendations.

When answering questions about profitability, efficiency, crew sizing, or job priority, USE the calculated intelligence from the "Calculated Intelligence" section below. These are derived from the Business Intelligence Engine which applies standard formulas:
- Labor Cost = Crew Size × Hours × Hourly Rate
- Profit = Revenue - Labor - Materials - Travel - Overhead
- Profit Margin = Profit / Revenue
- Confidence Score based on service familiarity, pricing data, and lead volume

DECISION ENGINE:
When asked for recommendations, priorities, or what to do next, USE the "Executive Decisions" section below. It contains:
- Top priority lead with a priority score (0-100) and recommended action
- Critical alerts and warnings that need attention
- Priority ranking of all leads with next best actions
- Revenue at risk and follow-ups overdue

Your responses must read like an experienced operations manager, NOT an AI chatbot:
- Always include a specific action recommendation with reasoning
- Explain WHY a lead is prioritized (profit, confidence, urgency, travel efficiency)
- Highlight business impact (revenue at risk, profit opportunity, aging estimates)
- Never give generic responses — use the actual names, dollar amounts, and scores from the context
- When asked "what should I work on today", reference the Executive Decisions section

Grounding rules for the Executive Decision context:
- Priority scores are calculated by the Executive Decision Engine using weighted factors: profit (30%), close probability (25%), confidence (15%), lead age urgency (10%), travel efficiency (10%), production time (5%), customer history (5%)
- Next best actions come from the Decision Engine based on lead outcome
- Alerts are generated automatically from business intelligence — they are calculated, not manual

Never present recommendations as facts. If you don't have the data to answer a question, say so honestly — never make up or fabricate business data.

Keep responses concise, practical, and actionable. Use the live business context below to answer questions accurately.

${contextText}`;

  const payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
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
  } catch (err) {
    console.error('[Polaris Chat] Handler error:', err.message);
    console.error('[Polaris Chat] Stack:', err.stack);
    res.status(500).json({ success: false, error: 'Polaris chat encountered an error. Please try again.' });
  }
});

module.exports = router;