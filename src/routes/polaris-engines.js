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
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/customers
 * Create a new customer.
 */
router.post('/customers', (req, res) => {
  try {
    var e = _getEngines().customers;
    var result = e.createCustomer(req.body);
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
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/v1/customers/:id
 * Update a customer.
 */
router.put('/customers/:id', (req, res) => {
  try {
    var e = _getEngines().customers;
    var result = e.updateCustomer(req.params.id, req.body);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * DELETE /api/v1/customers/:id
 * Archive a customer.
 */
router.delete('/customers/:id', (req, res) => {
  try {
    var e = _getEngines().customers;
    var result = e.archiveCustomer(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/customers/:id/restore
 * Restore an archived customer.
 */
router.post('/customers/:id/restore', (req, res) => {
  try {
    var e = _getEngines().customers;
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
    if (req.query.status) filters.status = req.query.status;
    if (req.query.limit) filters.limit = parseInt(req.query.limit);
    if (req.query.customerId) {
      var result = e.getCommunications(req.query.customerId, filters);
      res.json(result);
    } else {
      res.json({ communications: [], total: 0 });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/communications
 * Record a communication.
 */
router.post('/communications', (req, res) => {
  try {
    var e = _getEngines().comms;
    var result = e.recordCommunication(req.body);
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
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/v1/communications/:id/status
 * Update communication status.
 */
router.put('/communications/:id/status', (req, res) => {
  try {
    var e = _getEngines().comms;
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
    var e = _getEngines().comms;
    var result = e.getTimeline(req.params.customerId);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/communications/intelligence/:customerId
 * Get communication intelligence for a customer.
 */
router.get('/communications/intelligence/:customerId', (req, res) => {
  try {
    var e = _getEngines().comms;
    var result = {
      lastContact: e.getLastContact(req.params.customerId),
      frequency: e.getCommunicationFrequency(req.params.customerId, 30),
      engagement: e.getEngagementScore(req.params.customerId),
      followUps: e.getFollowUpRecommendations(req.params.customerId),
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
    if (req.query.limit) filters.limit = parseInt(req.query.limit);
    var result = e.listOpportunities(filters);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/opportunities
 * Create an opportunity.
 */
router.post('/opportunities', (req, res) => {
  try {
    var e = _getEngines().opps;
    var result = e.createOpportunity(req.body);
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
    var result = {
      pipeline: e.getPipeline(),
      metrics: e.getPipelineMetrics(),
      stages: e.getStageTotals(),
      forecast: e.calculateForecastRevenue(),
    };
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
    var result = e.getPriorityQueue({ limit: parseInt(req.query.limit) || 20 });
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
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/v1/opportunities/:id
 * Update an opportunity.
 */
router.put('/opportunities/:id', (req, res) => {
  try {
    var e = _getEngines().opps;
    var result = e.updateOpportunity(req.params.id, req.body);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * PUT /api/v1/opportunities/:id/stage
 * Move opportunity to a new stage.
 */
router.put('/opportunities/:id/stage', (req, res) => {
  try {
    var e = _getEngines().opps;
    var result = e.updateOpportunityStage(req.params.id, req.body.stage);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * DELETE /api/v1/opportunities/:id
 * Archive an opportunity.
 */
router.delete('/opportunities/:id', (req, res) => {
  try {
    var e = _getEngines().opps;
    var result = e.archiveOpportunity(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/opportunities/pipeline
 * Get pipeline view and metrics.
 */
router.get('/opportunities/pipeline', (req, res) => {
  try {
    var e = _getEngines().opps;
    var result = {
      pipeline: e.getPipeline(),
      metrics: e.getPipelineMetrics(),
      stages: e.getStageTotals(),
      forecast: e.calculateForecastRevenue(),
    };
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
    var result = e.getPriorityQueue({ limit: parseInt(req.query.limit) || 20 });
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
router.post('/workflows', (req, res) => {
  try {
    var e = _getEngines().wf;
    var result = e.createTask(req.body);
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
router.put('/workflows/:id', (req, res) => {
  try {
    var e = _getEngines().wf;
    var result = e.updateTask(req.params.id, req.body);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/workflows/:id/complete
 * Mark a task as completed.
 */
router.post('/workflows/:id/complete', (req, res) => {
  try {
    var e = _getEngines().wf;
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
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/financial/estimates
 * Create an estimate.
 */
router.post('/financial/estimates', (req, res) => {
  try {
    var e = _getEngines().fin;
    var result = e.createEstimate(req.body);
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
    if (result.error) return res.status(404).json(result);
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
router.post('/financial/invoices', (req, res) => {
  try {
    var e = _getEngines().fin;
    var result = e.createInvoice(req.body);
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
router.post('/financial/invoices/:id/send', (req, res) => {
  try {
    var e = _getEngines().fin;
    var result = e.markInvoiceSent(req.params.id);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/financial/payments
 * Record a payment.
 */
router.post('/financial/payments', (req, res) => {
  try {
    var e = _getEngines().fin;
    var result = e.recordPayment(req.body);
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
    res.json({
      metrics: e.getFinancialMetrics(),
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
router.post('/assets', (req, res) => {
  try {
    var e = _getEngines().ast;
    var result = e.createAsset(req.body);
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
router.put('/assets/:id', (req, res) => {
  try {
    var e = _getEngines().ast;
    var result = e.updateAsset(req.params.id, req.body);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/assets/:id/maintenance
 * Schedule maintenance.
 */
router.post('/assets/:id/maintenance', (req, res) => {
  try {
    var e = _getEngines().ast;
    var data = req.body;
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
router.post('/crew/employees', (req, res) => {
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
router.put('/crew/employees/:id', (req, res) => {
  try {
    var e = _getEngines().crew;
    var result = e.updateEmployee(req.params.id, req.body);
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
router.post('/crew/crews', (req, res) => {
  try {
    var e = _getEngines().crew;
    var result = e.createCrew(req.body);
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/crew/crews/:id/assign
 * Assign a crew.
 */
router.post('/crew/crews/:id/assign', (req, res) => {
  try {
    var e = _getEngines().crew;
    var result = e.assignCrew(req.params.id, req.body);
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
router.post('/jobs', (req, res) => {
  try {
    var e = _getEngines().job;
    var result = e.createJob(req.body);
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
router.put('/jobs/:id', (req, res) => {
  try {
    var e = _getEngines().job;
    var result = e.updateJob(req.params.id, req.body);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/jobs/:id/schedule
 * Schedule a job.
 */
router.post('/jobs/:id/schedule', (req, res) => {
  try {
    var e = _getEngines().job;
    var result = e.scheduleJob(req.params.id, req.body.scheduledStart, req.body.scheduledEnd);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/jobs/:id/start
 * Start a job.
 */
router.post('/jobs/:id/start', (req, res) => {
  try {
    var e = _getEngines().job;
    var result = e.startJob(req.params.id);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/jobs/:id/complete
 * Complete a job.
 */
router.post('/jobs/:id/complete', (req, res) => {
  try {
    var e = _getEngines().job;
    var result = e.completeJob(req.params.id, req.body);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/jobs/:id/production
 * Record production.
 */
router.post('/jobs/:id/production', (req, res) => {
  try {
    var e = _getEngines().job;
    var result = e.recordProduction(req.params.id, req.body);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/v1/jobs/:id/issue
 * Record an issue.
 */
router.post('/jobs/:id/issue', (req, res) => {
  try {
    var e = _getEngines().job;
    var result = e.recordIssue(req.params.id, req.body);
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
    res.json(e.generateDashboard());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/analytics/executive
 * Get executive summary.
 */
router.get('/analytics/executive', (req, res) => {
  try {
    var e = _getEngines().bi;
    res.json(e.generateExecutiveSummary());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/analytics/kpis
 * Get KPIs.
 */
router.get('/analytics/kpis', (req, res) => {
  try {
    var e = _getEngines().bi;
    res.json(e.generateKPIs());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/analytics/alerts
 * Get alerts.
 */
router.get('/analytics/alerts', (req, res) => {
  try {
    var e = _getEngines().bi;
    res.json(e.generateAlerts());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * GET /api/v1/analytics/:category
 * Get analytics by category.
 */
router.get('/analytics/:category', (req, res) => {
  try {
    var e = _getEngines().bi;
    var result = e.getAnalytics(req.params.category);
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