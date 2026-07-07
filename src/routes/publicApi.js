/**
 * Public REST API Routes (v1)
 * 
 * Versioned, externally-facing API for third-party developers,
 * enterprise contractors, and Zapier-style integrations.
 * 
 * All endpoints prefixed with /api/v1/.
 * 
 * Authentication: JWT (Bearer token) or API Key (X-API-Key header).
 * Rate limited per plan tier. See V3-05_Public_REST_API.md.
 */

const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { requirePermission } = require('../auth/authorize');
const { rateLimit } = require('../middleware/rateLimit');
const { ApiError } = require('../middleware/errorHandler');
const cache = require('../cache/client');
const db = require('../db');
const { getAllLeads, getLead } = require('../leads/store');
const analytics = require('../analytics/pipeline');
const { seedDemoData } = require('../analytics/seeder');

const router = express.Router();

// All public API endpoints are rate limited
router.use(rateLimit('public-api', (req) => {
  return req.headers['x-api-key'] || req.user?.id || req.ip;
}));

/**
 * Middleware: support API key authentication.
 * Checks X-API-Key header as an alternative to Bearer JWT.
 */
router.use((req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    // In production, look up API key in database and set req.user
    // For now, accept a demo API key
    if (apiKey === process.env.DEMO_API_KEY || apiKey === 'ns_demo_key_2024') {
      req.user = { id: 'api-demo-user', role: 'member', plan: 'professional' };
      req.authMethod = 'api_key';
    }
  }
  next();
});

// ==================== Leads ====================

/**
 * GET /api/v1/leads
 * List leads with cursor-based pagination and search.
 */
router.get('/leads', requireAuth, requirePermission('leads', 'view'), async (req, res, next) => {
  try {
    const { cursor, limit: limitParam, status, search } = req.query;
    const limit = Math.min(parseInt(limitParam) || 20, 100);

    // Try to get from cache
    const cacheKey = cache.buildKey('leads:list', `${req.user.id}:${cursor || ''}:${limit}:${status || ''}:${search || ''}`);
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    let leads = getAllLeads();

    // Filter by status
    if (status) {
      leads = leads.filter(l => l.status === status);
    }

    // Search by name or phone
    if (search) {
      const q = search.toLowerCase();
      leads = leads.filter(l =>
        (l.customerName && l.customerName.toLowerCase().includes(q)) ||
        (l.phoneNumber && l.phoneNumber.includes(q))
      );
    }

    // Cursor-based pagination
    let startIndex = 0;
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
        startIndex = leads.findIndex(l => l.id === decoded.id) + 1;
      } catch (e) {
        throw new ApiError(400, 'invalid_cursor', 'Invalid pagination cursor.');
      }
    }

    const page = leads.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < leads.length;
    const nextCursor = hasMore && page.length > 0
      ? Buffer.from(JSON.stringify({ id: page[page.length - 1].id })).toString('base64')
      : null;

    const response = {
      data: page.map(l => ({
        id: l.id,
        name: l.customerName,
        phone: l.phoneNumber,
        email: l.email || '',
        service: l.serviceRequested,
        status: l.callOutcome || 'new',
        estimatedValue: l.estimatedPrice || 0,
        address: l.address || '',
        notes: l.notes || '',
        source: l.source || 'phone_call',
        createdAt: l.createdAt || l.receivedAt,
        updatedAt: l.updatedAt || l.createdAt
      })),
      pagination: { cursor: nextCursor, hasMore }
    };

    // Cache for 30 seconds
    await cache.set(cacheKey, response, 30);

    res.json(response);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/leads/:id
 * Get a single lead by ID.
 */
router.get('/leads/:id', requireAuth, requirePermission('leads', 'view'), async (req, res, next) => {
  try {
    const lead = getLead(req.params.id);
    if (!lead) {
      throw new ApiError(404, 'not_found', 'Lead not found.');
    }
    res.json({
      data: {
        id: lead.id,
        name: lead.customerName,
        phone: lead.phoneNumber,
        email: lead.email || '',
        service: lead.serviceRequested,
        status: lead.callOutcome || 'new',
        estimatedValue: lead.estimatedPrice || 0,
        address: lead.address || '',
        notes: lead.notes || '',
        source: lead.source || 'phone_call',
        createdAt: lead.createdAt || lead.receivedAt
      }
    });
  } catch (err) {
    next(err);
  }
});

// ==================== Calls ====================

/**
 * GET /api/v1/calls
 * List calls with pagination and search.
 */
router.get('/calls', requireAuth, requirePermission('calls', 'view'), async (req, res, next) => {
  try {
    const range = req.query.range || 'today';
    const data = await analytics.computeOverview(req.user.id, range);
    res.json({ data });
  } catch (err) { next(err); }
});

router.get('/analytics/trends', requireAuth, requirePermission('dashboard', 'view'), async (req, res, next) => {
  try {
    const data = await analytics.computeTrends(req.user.id);
    res.json({ data });
  } catch (err) { next(err); }
});

router.get('/analytics/pipeline', requireAuth, requirePermission('dashboard', 'view'), async (req, res, next) => {
  try {
    const data = await analytics.computePipeline(req.user.id);
    res.json({ data });
  } catch (err) { next(err); }
});

router.get('/analytics/by-service', requireAuth, requirePermission('dashboard', 'view'), async (req, res, next) => {
  try {
    const range = req.query.range || 'month';
    const data = await analytics.computeByService(req.user.id, range);
    res.json({ data });
  } catch (err) { next(err); }
});

// Seed demo data for the current user
router.post('/analytics/seed', requireAuth, async (req, res, next) => {
  try {
    const seeded = await seedDemoData(req.user.id);
    res.json({ data: { message: 'Demo data seeded successfully', records: seeded.length } });
  } catch (err) { next(err); }
    const { cursor, limit: limitParam, status, search } = req.query;
    const limit = Math.min(parseInt(limitParam) || 20, 100);

    // Calls would come from DB in production
    // For now, return empty paginated response
    const response = {
      data: [],
      pagination: { cursor: null, hasMore: false }
    };

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ==================== Dashboard ====================

/**
 * GET /api/v1/dashboard/overview
 * Pre-computed daily/weekly/monthly aggregates. (V3-18)
 */
router.get('/dashboard/overview', requireAuth, async (req, res, next) => {
  try {
    const cacheKey = cache.buildKey('dashboard:overview', req.user.id);
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const leads = getAllLeads();
    const today = new Date().toISOString().slice(0, 10);

    // Get or compute snapshots for today, last 7 days, last 30 days
    const todaySnap = await getOrCompute(req.user.id, today, leads);
    const allSnaps = loadAllSnapshots(req.user.id);

    const todaySummary = computePeriodSummary(req.user.id, 'current_day', allSnaps.length > 0 ? allSnaps : [todaySnap]);
    const weekSummary = computePeriodSummary(req.user.id, 'current_week', allSnaps);
    const monthSummary = computePeriodSummary(req.user.id, 'current_month', allSnaps);

    const overview = {
      today: {
        callsReceived: todaySummary.callsReceived,
        callsAnswered: todaySummary.callsAnswered,
        leadsCaptured: todaySummary.leadsCaptured,
        appointmentsScheduled: todaySummary.appointmentsScheduled,
        missedCallsSaved: todaySummary.missedCallsSaved,
        estimatedRevenue: todaySummary.estimatedRevenue,
        avgCallLength: todaySummary.totalCallDurationSecs > 0 && todaySummary.callsReceived > 0
          ? Math.round(todaySummary.totalCallDurationSecs / todaySummary.callsReceived) : 0
      },
      thisWeek: {
        callsReceived: weekSummary.callsReceived,
        leadsCaptured: weekSummary.leadsCaptured,
        appointmentsScheduled: weekSummary.appointmentsScheduled,
        revenueWon: weekSummary.revenueWon,
        estimatedRevenue: weekSummary.estimatedRevenue,
        conversionRate: weekSummary.conversionRate
      },
      thisMonth: {
        callsReceived: monthSummary.callsReceived,
        leadsCaptured: monthSummary.leadsCaptured,
        appointmentsScheduled: monthSummary.appointmentsScheduled,
        revenueWon: monthSummary.revenueWon,
        estimatedRevenue: monthSummary.estimatedRevenue,
        conversionRate: monthSummary.conversionRate
      }
    };

    await cache.set(cacheKey, overview, 120);
    res.json({ data: overview });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/dashboard/revenue-trends
 * Pipeline value with trend direction. (V5-17)
 */
router.get('/dashboard/revenue-trends', requireAuth, async (req, res, next) => {
  try {
    const cacheKey = cache.buildKey('dashboard:revenue', req.user.id);
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const leads = getAllLeads();
    const revOverview = await revenue.computeRevenueOverview(req.user.id, leads);

    const result = {
      pipelineValue: revOverview.pipelineValue,
      activeLeads: revOverview.activeLeads,
      averageLeadValue: revOverview.averageLeadValue,
      todayRevenue: revOverview.todayRevenue,
      yesterdayRevenue: revOverview.yesterdayRevenue,
      trend: revOverview.trend,
      topLead: revOverview.topLead
    };

    await cache.set(cacheKey, result, 300);
    res.json({ data: result });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/dashboard/coach
 * Returns the primary recommendation and secondary insight. (V5-07)
 */
router.get('/dashboard/coach', requireAuth, async (req, res, next) => {
  try {
    const leads = getAllLeads();
    const today = new Date().toISOString().slice(0, 10);

    const todayLeads = leads.filter(l => (l.receivedAt || '').startsWith(today));
    const callsToday = todayLeads.filter(l => (l.source || 'phone_call') === 'phone_call').length;
    const appointmentsToday = todayLeads.filter(l => l.callOutcome === 'appointment-set').length;
    const oldLeads = leads.filter(l => {
      if (!l.receivedAt) return false;
      const daysOld = (Date.now() - new Date(l.receivedAt).getTime()) / 86400000;
      return daysOld > 1 && !['no-interest', 'voicemail', 'appointment-set'].includes(l.callOutcome || '');
    });
    const wonCount = leads.filter(l => l.callOutcome === 'appointment-set').length;
    const lostCount = leads.filter(l => l.callOutcome === 'no-interest').length;
    const conversionRate = (wonCount + lostCount) > 0
      ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null;

    const metrics = {
      callsToday,
      callsAnswered: callsToday,
      leadsToday: todayLeads.length,
      appointmentsScheduled: appointmentsToday,
      conversionRate,
      oldLeadsCount: oldLeads.length,
      callsMissed: 0
    };

    const recommendation = coach.evaluate(metrics, req.user.name);
    const insight = coach.secondaryInsight(metrics);

    res.json({ data: { recommendation, insight } });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/dashboard/brief
 * Daily Brief generation — 120-word max. (V5-08)
 */
router.get('/dashboard/brief', requireAuth, async (req, res, next) => {
  try {
    const leads = getAllLeads();
    const today = new Date().toISOString().slice(0, 10);

    const todayLeads = leads.filter(l => (l.receivedAt || '').startsWith(today));
    const callsToday = todayLeads.filter(l => (l.source || 'phone_call') === 'phone_call').length;
    const appointmentsToday = todayLeads.filter(l => l.callOutcome === 'appointment-set').length;
    const oldLeads = leads.filter(l => {
      if (!l.receivedAt) return false;
      const daysOld = (Date.now() - new Date(l.receivedAt).getTime()) / 86400000;
      return daysOld > 1 && !['no-interest', 'voicemail', 'appointment-set'].includes(l.callOutcome || '');
    });
    const wonCount = leads.filter(l => l.callOutcome === 'appointment-set').length;
    const lostCount = leads.filter(l => l.callOutcome === 'no-interest').length;
    const conversionRate = (wonCount + lostCount) > 0
      ? Math.round((wonCount / (wonCount + lostCount)) * 100) : null;

    const metrics = {
      callsToday,
      callsAnswered: callsToday,
      leadsToday: todayLeads.length,
      appointmentsScheduled: appointmentsToday,
      conversionRate,
      oldLeadsCount: oldLeads.length
    };

    const revOverview = await revenue.computeRevenueOverview(req.user.id, leads);
    const name = req.user.name || req.user.email || 'there';
    const briefText = brief.generate(metrics, revOverview, name);

    res.json({ data: { brief: briefText, wordCount: briefText.split(/\s+/).length } });
  } catch (err) { next(err); }
});

// ==================== Health ====================

/**
 * GET /api/v1/health
 * API health check.
 */
router.get('/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
      version: '1.0.0',
      service: 'northstar-solutions-api',
      time: new Date().toISOString()
    }
  });
});

module.exports = router;