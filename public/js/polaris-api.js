/**
 * Polaris API Client — Canonical frontend data adapter
 *
 * Shared client for fetching from canonical Polaris engine endpoints.
 * All pages use this module to read authoritative server state.
 * AppStore may cache responses locally, but the server is always
 * the source of truth.
 *
 * Endpoints called here match routes in polaris-engines.js.
 * Data is normalized into consistent frontend models.
 */
window.PolarisApi = (function() {

  var API_PREFIX = '/api/v1';

  /**
   * Auth-aware fetch with Bearer token from localStorage.
   */
  function _fetch(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    var token = localStorage.getItem('token');
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (opts.body) opts.headers['Content-Type'] = 'application/json';
    var url = API_PREFIX + path;
    if (window.NorthStarDemoSession) url = window.NorthStarDemoSession.appendToUrl(url);
    return fetch(url, opts);
  }

  /**
   * GET request to a Polaris engine endpoint.
   * Returns parsed JSON or throws on non-OK response.
   */
  function _get(path) {
    return _fetch(path).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'Request failed: ' + path); });
      return r.json();
    });
  }

  /**
   * POST request to a Polaris engine endpoint.
   */
  function _post(path, body) {
    return _fetch(path, {
      method: 'POST',
      body: JSON.stringify(body || {})
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw new Error(e.error || 'POST failed: ' + path); });
      return r.json();
    });
  }

  // ═══════════════════════════════════════════════
  // Domain: Customers
  // ═══════════════════════════════════════════════

  /**
   * Fetch all customers from Polaris.
   * GET /api/v1/customers
   */
  function getCustomers(filters) {
    var qs = [];
    if (filters) {
      if (filters.status) qs.push('status=' + encodeURIComponent(filters.status));
      if (filters.search) qs.push('search=' + encodeURIComponent(filters.search));
    }
    var path = '/customers' + (qs.length > 0 ? '?' + qs.join('&') : '');
    return _get(path);
  }

  // ═══════════════════════════════════════════════
  // Domain: Communications
  // ═══════════════════════════════════════════════

  /**
   * Fetch communications from Polaris.
   * GET /api/v1/communications
   *
   * @param {object} [filters] - Optional filters (type, direction, status, limit, offset)
   * @returns {Promise<{communications: Array, total: number}>}
   */
  function getCommunications(filters) {
    var qs = [];
    if (filters) {
      if (filters.customerId) qs.push('customerId=' + encodeURIComponent(filters.customerId));
      if (filters.type) qs.push('type=' + encodeURIComponent(filters.type));
      if (filters.direction) qs.push('direction=' + encodeURIComponent(filters.direction));
      if (filters.status) qs.push('status=' + encodeURIComponent(filters.status));
      if (filters.limit) qs.push('limit=' + parseInt(filters.limit));
      if (filters.offset) qs.push('offset=' + parseInt(filters.offset));
    }
    var path = '/communications' + (qs.length > 0 ? '?' + qs.join('&') : '');
    return _get(path);
  }

  // ═══════════════════════════════════════════════
  // Domain: Opportunities / Leads
  // ═══════════════════════════════════════════════

  /**
   * Fetch opportunities (leads) from Polaris.
   * GET /api/v1/opportunities
   *
   * A lead is an opportunity at stage 'lead'. This endpoint
   * returns all opportunities with optional stage filtering.
   *
   * @param {object} [filters] - Optional filters (stage, status, customerId, limit)
   * @returns {Promise<{opportunities: Array, total: number}>}
   */
  function getOpportunities(filters) {
    var qs = [];
    if (filters) {
      if (filters.stage) qs.push('stage=' + encodeURIComponent(filters.stage));
      if (filters.status) qs.push('status=' + encodeURIComponent(filters.status));
      if (filters.customerId) qs.push('customerId=' + encodeURIComponent(filters.customerId));
      if (filters.limit) qs.push('limit=' + parseInt(filters.limit));
    }
    var path = '/opportunities' + (qs.length > 0 ? '?' + qs.join('&') : '');
    return _get(path);
  }

  /**
   * Fetch pipeline view and metrics.
   * GET /api/v1/opportunities/pipeline
   */
  function getPipeline() {
    return _get('/opportunities/pipeline');
  }

  // ═══════════════════════════════════════════════
  // Domain: Estimates
  // ═══════════════════════════════════════════════

  /**
   * Fetch estimates from Polaris.
   * GET /api/v1/financial/estimates
   */
  function getEstimates(filters) {
    var qs = [];
    if (filters) {
      if (filters.status) qs.push('status=' + encodeURIComponent(filters.status));
      if (filters.customerId) qs.push('customerId=' + encodeURIComponent(filters.customerId));
      if (filters.limit) qs.push('limit=' + parseInt(filters.limit));
    }
    var path = '/financial/estimates' + (qs.length > 0 ? '?' + qs.join('&') : '');
    return _get(path);
  }

  /**
   * Fetch financial metrics.
   * GET /api/v1/financial/metrics
   */
  function getFinancialMetrics() {
    return _get('/financial/metrics');
  }

  // ═══════════════════════════════════════════════
  // Domain: Analytics
  // ═══════════════════════════════════════════════

  /**
   * Fetch executive summary.
   * GET /api/v1/analytics/executive
   */
  function getExecutiveSummary() {
    return _get('/analytics/executive');
  }

  /**
   * Fetch KPIs.
   * GET /api/v1/analytics/kpis
   */
  function getKPIs() {
    return _get('/analytics/kpis');
  }

  /**
   * Fetch dashboard summary.
   * GET /api/v1/analytics/dashboard
   */
  function getDashboard() {
    return _get('/analytics/dashboard');
  }

  /**
   * Fetch alerts.
   * GET /api/v1/analytics/alerts
   */
  function getAlerts() {
    return _get('/analytics/alerts');
  }

  // ═══════════════════════════════════════════════
  // Domain: Workflows
  // ═══════════════════════════════════════════════

  /**
   * Fetch today's agenda.
   * GET /api/v1/workflows/agenda/today
   */
  function getAgendaToday() {
    return _get('/workflows/agenda/today');
  }

  // ═══════════════════════════════════════════════
  // Simulation
  // ═══════════════════════════════════════════════

  /**
   * Create a simulated lead across all Polaris engines.
   * POST /api/v1/simulations/leads
   */
  function simulateLead(data) {
    return _post('/simulations/leads', data);
  }

  // ═══════════════════════════════════════════════
  // Data Normalization
  // ═══════════════════════════════════════════════

  /**
   * Normalize a Polaris opportunity into a frontend lead model.
   * This is the single shared transformation — not duplicated per page.
   *
   * @param {object} opp - Polaris opportunity object
   * @param {object} [customer] - Optional Polaris customer for name/phone enrichment
   * @returns {object} Normalized lead object
   */
  function normalizeLead(opp, customer) {
    var metadata = opp.metadata || {};
    var canonical = metadata.polarisIntelligence || null;
    return {
      id: opp.id,
      customerId: opp.customerId,
      callerName: customer ? customer.name : (opp.title || '').split(' - ').pop() || 'Unknown',
      phone: customer ? customer.phone : '',
      service: canonical && canonical.service ? canonical.service : (opp.title ? opp.title.split(' - ')[0] : 'General'),
      estimatedPrice: canonical ? canonical.customerFacingPrice : (opp.estimatedValue || 0),
      jobDetail: opp.description || '',
      status: opp.stage === 'lead' ? 'new' : opp.stage,
      outcome: opp.status === 'won' ? 'appointment-set' : opp.status === 'lost' ? 'no-interest' : 'lead-captured',
      stage: opp.stage,
      stageDisplayName: opp.stageDisplayName,
      probability: opp.probability,
      expectedRevenue: opp.expectedRevenue,
      priority: opp.priority,
      createdAt: opp.createdAt,
      updatedAt: opp.updatedAt,
      source: 'polaris',
      metadata: metadata,
      canonicalPolaris: canonical,
      confidenceScore: canonical ? canonical.confidenceScore : null,
      recommendedAction: canonical ? canonical.recommendedAction : null,
    };
  }

  /**
   * Normalize a Polaris communication into a frontend call record model.
   *
   * @param {object} comm - Polaris communication object
   * @returns {object} Normalized communication object
   */
  function normalizeCommunication(comm) {
    var metadata = comm.metadata || {};
    var canonical = metadata.polarisIntelligence || null;
    return {
      id: comm.id,
      customerId: comm.customerId,
      callerName: comm.customerName || '',
      phone: comm.customerPhone || '',
      type: comm.type || 'call',
      direction: comm.direction || 'inbound',
      subject: comm.subject || '',
      content: comm.content || '',
      status: comm.status || 'completed',
      duration: comm.duration,
      createdAt: comm.createdAt,
      updatedAt: comm.updatedAt,
      metadata: metadata,
      canonicalPolaris: canonical,
      service: canonical && canonical.service ? canonical.service : (comm.subject || 'Call'),
      estimatedPrice: canonical ? canonical.customerFacingPrice : null,
      confidenceScore: canonical ? canonical.confidenceScore : null,
      recommendedAction: canonical ? canonical.recommendedAction : null,
    };
  }

  // ═══════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════

  return {
    // Raw fetch
    fetch: _fetch,
    get: _get,
    post: _post,

    // Domain methods
    getCustomers: getCustomers,
    getCommunications: getCommunications,
    getOpportunities: getOpportunities,
    getPipeline: getPipeline,
    getEstimates: getEstimates,
    getFinancialMetrics: getFinancialMetrics,
    getExecutiveSummary: getExecutiveSummary,
    getKPIs: getKPIs,
    getDashboard: getDashboard,
    getAlerts: getAlerts,
    getAgendaToday: getAgendaToday,

    // Simulation
    simulateLead: simulateLead,

    // Normalization
    normalizeLead: normalizeLead,
    normalizeCommunication: normalizeCommunication,
  };
})();
