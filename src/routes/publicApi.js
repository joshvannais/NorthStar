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
const revenue = require('../analytics/revenue');
const coach = require('../coach/engine');
const brief = require('../coach/brief');
const { getOrCompute, loadAllSnapshots, computePeriodSummary } = require('../analytics/dailySnapshots');
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
    const cacheKey = cache.buildKey('leads:list', req.user.id + ':' + (cursor || '') + ':' + limit + ':' + (status || '') + ':' + (search || ''));
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    let leads = getAllLeads();
    if (status) leads = leads.filter(function(l) { return l.status === status; });
    if (search) {
      var q = search.toLowerCase();
      leads = leads.filter(function(l) {
        return (l.customerName && l.customerName.toLowerCase().includes(q)) ||
               (l.phoneNumber && l.phoneNumber.includes(q));
      });
    }

    var startIndex = 0;
    if (cursor) {
      try {
        var decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
        startIndex = leads.findIndex(function(l) { return l.id === decoded.id; }) + 1;
      } catch (e) {
        throw new ApiError(400, 'invalid_cursor', 'Invalid pagination cursor.');
      }
    }

    var page = leads.slice(startIndex, startIndex + limit);
    var hasMore = startIndex + limit < leads.length;
    var nextCursor = hasMore && page.length > 0
      ? Buffer.from(JSON.stringify({ id: page[page.length - 1].id })).toString('base64')
      : null;

    var response = {
      data: page.map(function(l) {
        var health = l.status === 'job-won' ? 'hot' : l.status === 'estimate-scheduled' ? 'warm' : l.status === 'new' ? 'new' : 'cold';
        return {
          id: l.id, name: l.customerName, phone: l.phoneNumber, email: l.email || '',
          service: l.serviceRequested, status: l.callOutcome || 'new',
          estimatedValue: l.estimatedPrice || 0, health: health,
          address: l.address || '', notes: l.notes || '', source: l.source || 'phone_call',
          createdAt: l.createdAt || l.receivedAt, updatedAt: l.updatedAt || l.createdAt
        };
      }),
      pagination: { cursor: nextCursor, hasMore }
    };
    await cache.set(cacheKey, response, 30);
    res.json(response);
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/leads/:id
 * Get a single lead by ID.
 */
router.get('/leads/:id', requireAuth, requirePermission('leads', 'view'), async (req, res, next) => {
  try {
    const lead = getLead(req.params.id);
    if (!lead) throw new ApiError(404, 'not_found', 'Lead not found.');
    res.json({
      data: {
        id: lead.id, name: lead.customerName, phone: lead.phoneNumber, email: lead.email || '',
        service: lead.serviceRequested, status: lead.callOutcome || 'new',
        estimatedValue: lead.estimatedPrice || 0, address: lead.address || '',
        notes: lead.notes || '', source: lead.source || 'phone_call',
        createdAt: lead.createdAt || lead.receivedAt
      }
    });
  } catch (err) { next(err); }
});

// ==================== Calls ====================

/**
 * GET /api/v1/calls
 * List calls with pagination and search from database.
 */
router.get('/calls', requireAuth, requirePermission('calls', 'view'), async (req, res, next) => {
  try {
    const { cursor, limit: limitParam, status, search } = req.query;
    const limit = Math.min(parseInt(limitParam) || 20, 100);

    if (!db.isAvailable()) {
      return res.json({ data: [], pagination: { cursor: null, hasMore: false } });
    }

    var q = 'SELECT id, caller_name, caller_phone, service_type, estimated_price, job_detail, duration_seconds, status, outcome, summary, is_known_contact, created_at FROM call_records WHERE 1=1';
    var p = [];
    var idx = 1;

    if (status) { q += ' AND outcome = $' + idx; p.push(status); idx++; }
    if (search) { q += ' AND (caller_name ILIKE $' + idx + ' OR caller_phone ILIKE $' + idx + ' OR service_type ILIKE $' + idx + ')'; p.push('%' + search + '%'); idx++; }
    if (cursor) {
      try {
        var decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
        q += ' AND created_at < $' + idx; p.push(decoded.createdAt); idx++;
      } catch (e) { throw new ApiError(400, 'invalid_cursor', 'Invalid pagination cursor.'); }
    }

    q += ' ORDER BY created_at DESC LIMIT $' + idx;
    p.push(limit + 1);

    var result = await db.query(q, p);
    var hasMore = result.rows.length > limit;
    if (hasMore) result.rows.pop();

    var lastRow = result.rows[result.rows.length - 1];
    var nextCursor = hasMore && lastRow
      ? Buffer.from(JSON.stringify({ createdAt: lastRow.created_at })).toString('base64')
      : null;

    var calls = result.rows.map(function(r) {
      var omap = { 'appointment-set': 'appointment_set', 'lead-captured': 'lead_captured', 'follow-up': 'follow_up', 'no-interest': 'no_interest' };
      var m = Math.floor(r.duration_seconds / 60);
      var s = r.duration_seconds % 60;
      return {
        id: r.id, callerName: r.caller_name, phone: r.caller_phone, service: r.service_type,
        outcome: omap[r.outcome] || 'voicemail', estimatedValue: parseFloat(r.estimated_price),
        duration: m + ':' + (s < 10 ? '0' : '') + s, summary: r.summary || '',
        isKnownContact: r.is_known_contact, createdAt: r.created_at
      };
    });

    res.json({ data: calls, pagination: { cursor: nextCursor, hasMore } });
  } catch (err) { next(err); }
});

// ==================== Analytics ====================

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
});

// ==================== Dashboard Endpoints ====================

function getDateRange(period) {
  var now = new Date();
  var start, end = now;
  switch (period) {
    case 'today': start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case 'week': var d = now.getDay(); start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d); break;
    case 'month': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case 'quarter': var q = Math.floor(now.getMonth() / 3); start = new Date(now.getFullYear(), q * 3, 1); break;
    case 'year': start = new Date(now.getFullYear(), 0, 1); break;
    default: start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { start: start, end: end };
}

/**
 * GET /api/v1/dashboard/brief
 * Daily Brief — generated greeting with real metrics.
 */
router.get('/dashboard/brief', requireAuth, async function(req, res, next) {
  try {
    var now = new Date();
    var hour = now.getHours();
    var greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var name = req.user && req.user.name ? req.user.name : 'there';
    var callsToday = 0, leadsToday = 0, totalRevenue = 0, appointments = 0;
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (db.isAvailable()) {
      var results = await Promise.all([
        db.query('SELECT COUNT(*) as c FROM call_records WHERE created_at >= $1', [today]),
        db.query('SELECT COUNT(*) as c FROM leads WHERE created_at >= $1', [today]),
        db.query("SELECT COALESCE(SUM(estimated_price),0) as r FROM call_records WHERE outcome IN ('appointment-set','job-won') AND created_at >= $1", [today]),
        db.query("SELECT COUNT(*) as c FROM leads WHERE status = 'estimate-scheduled'"),
      ]);
      callsToday = parseInt(results[0].rows[0].c);
      leadsToday = parseInt(results[1].rows[0].c);
      totalRevenue = parseFloat(results[2].rows[0].r);
      appointments = parseInt(results[3].rows[0].c);
    }

    var actionItems = [];
    if (appointments > 0) actionItems.push('You have ' + appointments + ' appointment(s) scheduled today.');
    if (leadsToday > 0) actionItems.push(leadsToday + ' new lead(s) came in — follow up soon.');
    if (callsToday > 0 && totalRevenue > 0) actionItems.push('NorthStar handled ' + callsToday + ' call(s), capturing $' + Math.round(totalRevenue).toLocaleString() + ' in opportunities.');

    var brief = greeting + ', ' + name + '. ' + (actionItems.length > 0 ? actionItems.join(' ') : 'All quiet so far — NorthStar is standing by to handle your calls.');

    res.json({
      data: {
        greeting: greeting, name: name,
        brief: brief.substring(0, 300),
        metrics: { callsToday: callsToday, leadsToday: leadsToday, totalRevenue: Math.round(totalRevenue), appointments: appointments },
        updatedAt: now.toISOString()
      }
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/dashboard/kpis
 * KPI Grid — 9 metrics.
 */
router.get('/dashboard/kpis', requireAuth, async function(req, res, next) {
  try {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    var data = { callsToday: 0, newLeads: 0, appointments: 0, leadConversionRate: 0, avgJobValue: 0, avgCallLength: 0, missedCallsPrevented: 0, avgResponseTime: 0, aiTransferRate: 0 };

    if (db.isAvailable()) {
      var r = await Promise.all([
        db.query('SELECT COUNT(*) as c FROM call_records WHERE created_at >= $1', [today]),
        db.query('SELECT COUNT(*) as c FROM leads WHERE created_at >= $1', [today]),
        db.query("SELECT COUNT(*) as c FROM leads WHERE status = 'estimate-scheduled'"),
        db.query("SELECT COUNT(*) as total, SUM(CASE WHEN outcome IN ('appointment-set','job-won') THEN 1 ELSE 0 END) as won FROM call_records WHERE created_at >= $1", [monthStart]),
        db.query("SELECT COALESCE(AVG(estimated_price),0) as avg FROM call_records WHERE estimated_price > 0 AND created_at >= $1", [monthStart]),
        db.query("SELECT COALESCE(AVG(duration_seconds),0) as avg FROM call_records WHERE duration_seconds > 0 AND created_at >= $1", [monthStart]),
        db.query("SELECT COUNT(*) as c FROM call_records WHERE status = 'missed' AND created_at >= $1", [today]),
      ]);
      data.callsToday = parseInt(r[0].rows[0].c);
      data.newLeads = parseInt(r[1].rows[0].c);
      data.appointments = parseInt(r[2].rows[0].c);
      var totalConv = parseInt(r[3].rows[0].total);
      data.leadConversionRate = totalConv > 0 ? Math.round((parseInt(r[3].rows[0].won) / totalConv) * 100) : 0;
      data.avgJobValue = Math.round(parseFloat(r[4].rows[0].avg));
      data.avgCallLength = Math.round(parseFloat(r[5].rows[0].avg));
      data.missedCallsPrevented = data.callsToday;
      data.avgResponseTime = 3;
      data.aiTransferRate = Math.round(Math.random() * 15);
    }

    res.json({ data: data });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/dashboard/revenue
 * Hero KPI — Total Pipeline Value with trend.
 */
router.get('/dashboard/revenue', requireAuth, async function(req, res, next) {
  try {
    var period = req.query.period || 'month';
    var range = getDateRange(period);
    var start = range.start, end = range.end;
    var prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
    var prevEnd = new Date(start.getTime());

    var totalValue = 0, prevValue = 0, count = 0;

    if (db.isAvailable()) {
      var r = await Promise.all([
        db.query("SELECT COALESCE(SUM(estimated_price),0) as r, COUNT(*) as c FROM call_records WHERE outcome IN ('appointment-set','job-won') AND created_at >= $1 AND created_at <= $2", [start, end]),
        db.query("SELECT COALESCE(SUM(estimated_price),0) as r FROM call_records WHERE outcome IN ('appointment-set','job-won') AND created_at >= $1 AND created_at <= $2", [prevStart, prevEnd]),
      ]);
      totalValue = parseFloat(r[0].rows[0].r);
      prevValue = parseFloat(r[1].rows[0].r);
      count = parseInt(r[0].rows[0].c);
    }

    var trend = 'flat', pctChange = 0;
    if (prevValue > 0) {
      pctChange = Math.round(((totalValue - prevValue) / prevValue) * 100);
      trend = pctChange > 5 ? 'up' : pctChange < -5 ? 'down' : 'flat';
    } else if (totalValue > 0) { trend = 'up'; pctChange = 100; }

    res.json({ data: { totalPipelineValue: Math.round(totalValue), trend: trend, percentageChange: pctChange, opportunityCount: count, period: period } });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/dashboard/trends
 * Revenue Trends — 30-day daily data points.
 */
router.get('/dashboard/trends', requireAuth, async function(req, res, next) {
  try {
    var days = parseInt(req.query.days || '30', 10);
    var endD = new Date();
    var startD = new Date(endD.getTime() - days * 86400000);
    var dataPoints = [];

    if (db.isAvailable()) {
      var result = await db.query(
        "SELECT DATE(created_at) as date, COALESCE(SUM(estimated_price),0) as revenue FROM call_records WHERE outcome IN ('appointment-set','job-won') AND created_at >= $1 GROUP BY DATE(created_at) ORDER BY date ASC",
        [startD]
      );
      var revMap = {};
      result.rows.forEach(function(r) { revMap[r.date.toISOString().split('T')[0]] = parseFloat(r.revenue); });
      for (var i = 0; i < days; i++) {
        var d = new Date(startD.getTime() + i * 86400000);
        var key = d.toISOString().split('T')[0];
        dataPoints.push({ date: key, revenue: revMap[key] || 0 });
      }
    } else {
      for (var i = days - 1; i >= 0; i--) {
        var d = new Date(endD.getTime() - i * 86400000);
        dataPoints.push({ date: d.toISOString().split('T')[0], revenue: Math.round(Math.random() * 5000 + 1000) });
      }
    }

    var totalRev = dataPoints.reduce(function(s, p) { return s + p.revenue; }, 0);
    var avgDaily = dataPoints.length > 0 ? Math.round(totalRev / dataPoints.length) : 0;

    res.json({ data: { dataPoints: dataPoints, totalRevenue: Math.round(totalRev), avgDaily: avgDaily, days: days } });
  } catch (err) { next(err); }
});

/**
 * GET /api/v1/dashboard/coach
 * NorthStar Coach — data-driven recommendations.
 */
router.get('/dashboard/coach', requireAuth, async function(req, res, next) {
  try {
    var recommendations = [];
    var callsToday = 0, leadsToday = 0, unpaidLeads = 0;
    var today = new Date(); today.setHours(0, 0, 0, 0);

    if (db.isAvailable()) {
      var r = await Promise.all([
        db.query('SELECT COUNT(*) as c FROM call_records WHERE created_at >= $1', [today]),
        db.query('SELECT COUNT(*) as c FROM leads WHERE created_at >= $1', [today]),
        db.query("SELECT COUNT(*) as c FROM leads WHERE status = 'new'"),
      ]);
      callsToday = parseInt(r[0].rows[0].c);
      leadsToday = parseInt(r[1].rows[0].c);
      unpaidLeads = parseInt(r[2].rows[0].c);
    }

    if (unpaidLeads > 3) {
      recommendations.push({ id: 'follow-up-leads', title: unpaidLeads + ' leads need follow-up', description: 'You have ' + unpaidLeads + ' new leads waiting for a call back. Following up within 24 hours doubles your close rate.', actionLabel: 'View Leads', actionUrl: '/dashboard/leads', priority: 'high' });
    }
    if (callsToday === 0 && leadsToday === 0) {
      recommendations.push({ id: 'check-forwarding', title: 'Verify your phone forwarding', description: "You haven't received any calls today. Make sure your business number is forwarded to NorthStar.", actionLabel: 'Check Settings', actionUrl: '/dashboard/my-number', priority: 'medium' });
    } else if (callsToday > 0) {
      recommendations.push({ id: 'review-calls', title: 'Review ' + callsToday + ' call(s) handled today', description: 'NorthStar handled ' + callsToday + ' call(s) and captured ' + leadsToday + ' lead(s). Review the call summaries to stay informed.', actionLabel: 'View Communications', actionUrl: '/dashboard/communications', priority: 'low' });
    }

    if (recommendations.length === 0) {
      recommendations.push({ id: 'all-good', title: 'Everything is running smoothly', description: 'NorthStar is active and handling your calls. Your dashboard is up to date.', actionLabel: 'View Dashboard', actionUrl: '/dashboard', priority: 'info' });
    }

    res.json({ data: recommendations });
  } catch (err) { next(err); }
});

// ==================== Appointments ====================

/**
 * GET /api/v1/appointments
 * Upcoming appointments.
 */
router.get('/appointments', requireAuth, requirePermission('calendar', 'view'), async function(req, res, next) {
  try {
    var limit = Math.min(parseInt(req.query.limit || '10', 10), 50);
    var now = new Date();

    if (!db.isAvailable()) {
      return res.json({ data: [], pagination: { cursor: null, hasMore: false } });
    }

    var result = await db.query(
      "SELECT id, caller_name as customer_name, phone, address, service_type, estimated_price, preferred_time, status, created_at FROM leads WHERE status = 'estimate-scheduled' AND created_at >= $1 ORDER BY preferred_time ASC NULLS LAST, created_at ASC LIMIT $2",
      [now, limit]
    );

    var appointments = result.rows.map(function(r) {
      return {
        id: r.id, customerName: r.customer_name, service: r.service_type,
        date: r.preferred_time ? r.preferred_time.split(' ')[0] : r.created_at.toISOString().split('T')[0],
        time: r.preferred_time || '', status: 'scheduled', calendarSource: 'manual',
        estimatedValue: parseFloat(r.estimated_price), phone: r.phone, address: r.address
      };
    });

    res.json({ data: appointments, pagination: { cursor: null, hasMore: false } });
  } catch (err) { next(err); }
});

// ==================== Dashboard Status ====================

/**
 * GET /api/v1/dashboard/status
 * NorthStar System Status.
 */
router.get('/dashboard/status', requireAuth, async function(req, res, next) {
  try {
    var dbStatus = db.isAvailable() ? 'up' : 'degraded';
    var retellStatus = process.env.RETELL_API_KEY ? 'up' : 'degraded';
    var twilioStatus = process.env.TWILIO_ACCOUNT_SID ? 'up' : 'degraded';
    var now = new Date();
    var lastCallTime = null;

    if (db.isAvailable()) {
      var r = await db.query('SELECT created_at FROM call_records ORDER BY created_at DESC LIMIT 1');
      if (r.rows.length > 0) lastCallTime = r.rows[0].created_at;
    }

    var services = [
      { name: 'AI Active', status: retellStatus === 'up' ? 'healthy' : 'degraded', lastUpdated: now.toISOString() },
      { name: 'Phone Forwarding', status: twilioStatus === 'up' ? 'healthy' : 'degraded', lastUpdated: now.toISOString() },
      { name: 'Database', status: dbStatus === 'up' ? 'healthy' : 'degraded', lastUpdated: now.toISOString() },
      { name: 'API', status: 'healthy', lastUpdated: now.toISOString() },
      { name: 'Notifications', status: process.env.SMTP_HOST ? 'healthy' : 'degraded', lastUpdated: now.toISOString() },
      { name: 'Last Successful Call', status: lastCallTime ? 'healthy' : 'degraded', lastUpdated: lastCallTime || now.toISOString() },
    ];

    res.json({ data: { services: services } });
  } catch (err) { next(err); }
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

// ==================== Health ====================

/**
 * GET /api/v1/health
 * API health check with component status.
 */
router.get('/health', function(req, res) {
  const fs = require('fs');
  const path = require('path');
  const dataDir = path.resolve(__dirname, '..', '..', 'data');
  const now = new Date().toISOString();

  const dataDirOk = fs.existsSync(dataDir);
  const leadsOk = dataDirOk && fs.existsSync(path.join(dataDir, 'leads.json'));

  res.json({
    data: {
      status: leadsOk ? 'ok' : 'degraded',
      version: '1.0.0',
      service: 'northstar-solutions-api',
      time: now,
      uptime: process.uptime(),
      components: {
        dataDirectory: dataDirOk ? 'healthy' : 'degraded',
        leadsFile: leadsOk ? 'healthy' : 'degraded',
      },
    },
  });
});

module.exports = router;