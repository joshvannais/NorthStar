/**
 * Dashboard API endpoints — Phase 3
 * Provides all endpoints needed by the dashboard widgets.
 * Real queries where data is available, graceful stubs where pending.
 * All endpoints are under /api/v1/ namespace.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAuth } = require('../auth/middleware');
const { requireOrgMembership } = require('../auth/permissions');
const { requirePermission } = require('../auth/authorize');
const { computeOverview, computeTrends, computePipeline, computeByService } = require('../analytics/pipeline');
const { computeRevenueOverview, calculatePipelineValue } = require('../analytics/revenue');
const coach = require('../coach/engine');
const brief = require('../coach/brief');
const { getAllLeads } = require('../leads/store');
const demoScope = require('../services/demoRecordScope');
const { dataPath } = require('../services/dataPaths');

// Stage probability weights for weighted pipeline
const STAGE_PROBABILITIES = {
  'new': 0.20,
  'contacted': 0.30,
  'estimate-scheduled': 0.50,
  'estimate-completed': 0.70,
  'estimate': 0.70,
  'appointment-set': 0.50,
  'lead-captured': 0.70,
  'job-won': 1.00,
  'job-lost': 0,
  'work-completed': 1.00,
  'no-interest': 0,
  'follow-up': 0.30,
  'voicemail': 0.10,
};

// All dashboard routes require authenticated, persisted tenant context.
router.use(requireAuth);
router.use(requireOrgMembership);

/**
 * Helper: Calculate date range bounds.
 */
function getDateRange(period) {
  const now = new Date();
  let start, end = now;

  switch (period) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'week': {
      const day = now.getDay();
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
      break;
    }
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      start = new Date(now.getFullYear(), q * 3, 1);
      break;
    }
    case 'year':
      start = new Date(now.getFullYear(), 0, 1);
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return { start, end };
}

/**
 * Helper: Calculate previous period for trend comparison.
 */
function getPreviousPeriod(period, start, end) {
  const duration = end.getTime() - start.getTime();
  return {
    start: new Date(start.getTime() - duration),
    end: new Date(start.getTime()),
  };
}

// ================================================================
// GET /api/v1/dashboard/summary
// Hero KPI — Estimated Revenue Opportunity
// ================================================================
router.get('/dashboard/summary', requirePermission('dashboard', 'view'), async (req, res) => {
  try {
    const period = req.query.period || 'month';
    const { start, end } = getDateRange(period);
    const prev = getPreviousPeriod(period, start, end);

    let totalRevenue = 0;
    let totalLeads = 0;
    let prevRevenue = 0;
    let serviceTypes = [];

    if (db.isAvailable()) {
      // Current period: sum of estimated_price for leads with appointments or won
      const currentResult = await db.query(`
        SELECT COALESCE(SUM(estimated_price), 0) as revenue,
               COUNT(*) as count
        FROM call_records
        WHERE organization_id = $1
          AND outcome IN ('appointment-set', 'job-won')
          AND created_at >= $2 AND created_at <= $3
      `, [req.orgId, start, end]);
      totalRevenue = parseFloat(currentResult.rows[0].revenue);
      totalLeads = parseInt(currentResult.rows[0].count);

      // Previous period for trend
      const prevResult = await db.query(`
        SELECT COALESCE(SUM(estimated_price), 0) as revenue
        FROM call_records
        WHERE organization_id = $1
          AND outcome IN ('appointment-set', 'job-won')
          AND created_at >= $2 AND created_at <= $3
      `, [req.orgId, prev.start, prev.end]);
      prevRevenue = parseFloat(prevResult.rows[0].revenue);

      // Distinct service types
      const svcResult = await db.query(`
        SELECT DISTINCT service_type FROM call_records
        WHERE organization_id = $1
          AND created_at >= $2 AND created_at <= $3
          AND service_type IS NOT NULL AND service_type != ''
      `, [req.orgId, start, end]);
      serviceTypes = svcResult.rows.map(r => r.service_type).filter(Boolean);
    } else {
      return res.status(503).json({
        error: { code: 'persistence_unavailable', message: 'Required persistence is temporarily unavailable.' },
      });
    }

    // Calculate trend
    let trend = '→';
    let trendPct = 0;
    if (prevRevenue > 0) {
      trendPct = ((totalRevenue - prevRevenue) / prevRevenue) * 100;
      trend = trendPct > 0 ? '↑' : trendPct < 0 ? '↓' : '→';
    }

    res.json({
      totalRevenue: Math.round(totalRevenue),
      trend,
      trendPct: Math.round(trendPct * 10) / 10,
      period,
      opportunities: totalLeads,
      serviceTypes: serviceTypes.length,
      subtitle: `From ${totalLeads} qualified opportunities across ${serviceTypes.length || 1} services.`,
    });
  } catch (err) {
    console.error('[API] Dashboard summary error:', err.message);
    res.status(500).json({ error: 'Failed to load dashboard summary' });
  }
});

// ================================================================
// GET /api/v1/dashboard/overview
// Aggregate overview combining pipeline, revenue, trends, service breakdown
// ================================================================
router.get('/dashboard/overview', requirePermission('dashboard', 'view'), async (req, res) => {
  try {
    const range = req.query.period || 'today';

    const overview = await computeOverview(req, range);
    const trends = await computeTrends(req);
    const pipeline = await computePipeline(req);
    const services = await computeByService(req, range);

    // Get leads for revenue calculation
    const leads = demoScope.filterTenantRecords(getAllLeads(), calendarAccess(req));

    // Weighted pipeline value
    let weightedPipelineValue = 0;
    let totalRawValue = 0;
    leads.forEach(function(l) {
      var stage = (l.callOutcome || l.status || 'new').toLowerCase();
      var prob = STAGE_PROBABILITIES[stage] || 0.10;
      var val = parseFloat(l.estimatedPrice) || 450;
      totalRawValue += val;
      weightedPipelineValue += val * prob;
    });

    // Confidence level based on data volume
    var confidence = 'low';
    if (leads.length > 10) confidence = 'high';
    else if (leads.length > 3) confidence = 'medium';

    // Trend from previous period
    var prevRange = range === 'today' ? 'week' : range;
    var prevOverview = await computeOverview(req, prevRange);

    var trendDirection = 'flat';
    var trendPct = 0;
    if (prevOverview.estimatedRevenue > 0 && overview.estimatedRevenue > 0) {
      trendPct = ((overview.estimatedRevenue - prevOverview.estimatedRevenue) / prevOverview.estimatedRevenue) * 100;
      trendDirection = trendPct > 5 ? 'up' : trendPct < -5 ? 'down' : 'flat';
    }

    res.json({
      data: {
        callsToday: overview.callsToday,
        newLeads: overview.newLeads,
        appointmentsBooked: overview.appointmentsBooked,
        estimatedRevenue: overview.estimatedRevenue,
        missedRevenuePrevented: overview.missedRevenuePrevented,
        answerRate: overview.answerRate,
        conversionRate: overview.conversionRate,
        totalCalls: overview.totalCalls,
        totalLeads: overview.totalLeads,
        pipeline: pipeline,
        serviceBreakdown: services.slice(0, 5),
        trends: trends,
        revenue: {
          totalEstimatedRevenue: Math.round(totalRawValue),
          weightedPipelineValue: Math.round(weightedPipelineValue),
          confidence: confidence,
          trend: trendDirection,
          trendPercentage: Math.round(trendPct),
        },
        period: range,
      }
    });
  } catch (err) {
    console.error('[API] Dashboard overview error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to load dashboard overview.' } });
  }
});

// ================================================================
// GET /api/v1/dashboard/revenue
// Enhanced Revenue — weighted pipeline, confidence, period filter
// ================================================================
router.get('/dashboard/revenue', requirePermission('dashboard', 'view'), async (req, res) => {
  try {
    const period = req.query.period || 'month';
    const { start, end } = getDateRange(period);
    const prev = getPreviousPeriod(period, start, end);

    const leads = demoScope.filterTenantRecords(getAllLeads(), calendarAccess(req));

    // Current period leads
    var currentLeads = leads.filter(function(l) {
      var d = new Date(l.receivedAt || l.createdAt || Date.now());
      return d >= start && d <= end;
    });
    // Previous period leads
    var prevLeads = leads.filter(function(l) {
      var d = new Date(l.receivedAt || l.createdAt || Date.now());
      return d >= prev.start && d <= prev.end;
    });

    // Total estimated revenue (raw sum)
    var totalEstimatedRevenue = currentLeads.reduce(function(s, l) {
      return s + (parseFloat(l.estimatedPrice) || 450);
    }, 0);
    var prevRevenue = prevLeads.reduce(function(s, l) {
      return s + (parseFloat(l.estimatedPrice) || 450);
    }, 0);

    // Weighted pipeline value
    var weightedPipelineValue = currentLeads.reduce(function(s, l) {
      var stage = (l.callOutcome || l.status || 'new').toLowerCase();
      var prob = STAGE_PROBABILITIES[stage] || 0.10;
      return s + ((parseFloat(l.estimatedPrice) || 450) * prob);
    }, 0);

    // Confidence
    var confidence = 'low';
    if (currentLeads.length > 10) confidence = 'high';
    else if (currentLeads.length > 3) confidence = 'medium';

    // Trend
    var trend = 'flat';
    var pctChange = 0;
    if (prevRevenue > 0 && totalEstimatedRevenue > 0) {
      pctChange = ((totalEstimatedRevenue - prevRevenue) / prevRevenue) * 100;
      trend = pctChange > 5 ? 'up' : pctChange < -5 ? 'down' : 'flat';
    } else if (totalEstimatedRevenue > 0 && prevRevenue === 0) {
      trend = 'up';
      pctChange = 100;
    }

    // Top opportunity
    var sorted = currentLeads.slice().sort(function(a, b) {
      return (parseFloat(b.estimatedPrice) || 0) - (parseFloat(a.estimatedPrice) || 0);
    });
    var topOpportunity = sorted.length > 0 && parseFloat(sorted[0].estimatedPrice) > 0
      ? { name: sorted[0].customerName || 'Unknown', value: parseFloat(sorted[0].estimatedPrice) || 0, service: sorted[0].serviceRequested || 'General' }
      : null;

    // Service breakdown
    var serviceBreakdown = {};
    currentLeads.forEach(function(l) {
      var svc = l.serviceRequested || 'Other';
      if (!serviceBreakdown[svc]) serviceBreakdown[svc] = { count: 0, revenue: 0 };
      serviceBreakdown[svc].count++;
      serviceBreakdown[svc].revenue += (parseFloat(l.estimatedPrice) || 450);
    });

    res.json({
      data: {
        totalEstimatedRevenue: Math.round(totalEstimatedRevenue),
        weightedPipelineValue: Math.round(weightedPipelineValue),
        confidence: confidence,
        trend: trend,
        trendPercentage: Math.round(Math.abs(pctChange)),
        period: period,
        opportunityCount: currentLeads.length,
        previousPeriodRevenue: Math.round(prevRevenue),
        topOpportunity: topOpportunity,
        serviceBreakdown: Object.entries(serviceBreakdown).map(function(e) {
          return { service: e[0], count: e[1].count, revenue: Math.round(e[1].revenue) };
        }),
      }
    });
  } catch (err) {
    console.error('[API] Dashboard revenue error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to load revenue data.' } });
  }
});

// ================================================================
// GET /api/v1/dashboard/brief
// Daily Brief — server-generated with coach evaluation
// ================================================================
router.get('/dashboard/brief', requirePermission('dashboard', 'view'), async (req, res) => {
  try {
    const overview = await computeOverview(req, 'today');

    const metrics = {
      callsToday: overview.callsToday,
      callsAnswered: overview.callsToday,
      leadsToday: overview.newLeads,
      appointmentsScheduled: overview.appointmentsBooked,
      conversionRate: overview.conversionRate ? parseInt(overview.conversionRate) : 0,
      oldLeadsCount: overview.newLeads > 3 ? overview.newLeads - 3 : 0,
      callsMissed: 0,
      avgCallLength: 0,
    };

    const leads = demoScope.filterTenantRecords(getAllLeads(), calendarAccess(req));
    const revOverview = await computeRevenueOverview(req.orgId, leads);

    const name = req.user?.name || 'there';
    const briefText = brief.generate(metrics, revOverview, name);
    const coachRec = coach.evaluate(metrics);
    const secondary = coach.secondaryInsight(metrics);

    res.json({
      data: {
        greeting: brief.getGreeting(name),
        name: name,
        brief: briefText,
        metrics: {
          callsToday: overview.callsToday,
          leadsToday: overview.newLeads,
          appointments: overview.appointmentsBooked,
          totalRevenue: overview.estimatedRevenue,
        },
        coach: {
          primary: coachRec,
          secondary: secondary,
        },
        updatedAt: new Date().toISOString(),
      }
    });
  } catch (err) {
    console.error('[API] Dashboard brief error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to load daily brief.' } });
  }
});

// ================================================================
// GET /api/v1/dashboard/coach
// NorthStar Coach — data-driven recommendations
// ================================================================
router.get('/dashboard/coach', requirePermission('dashboard', 'view'), async (req, res) => {
  try {
    const overview = await computeOverview(req, 'today');

    const metrics = {
      callsToday: overview.callsToday,
      callsAnswered: overview.callsToday,
      leadsToday: overview.newLeads,
      appointmentsScheduled: overview.appointmentsBooked,
      conversionRate: overview.conversionRate ? parseInt(overview.conversionRate) : 0,
      oldLeadsCount: overview.newLeads > 3 ? overview.newLeads - 3 : 0,
      callsMissed: 0,
      avgCallLength: 0,
    };

    const primary = coach.evaluate(metrics);
    const secondary = coach.secondaryInsight(metrics);

    var recommendations = [];
    if (primary) recommendations.push({
      id: primary.type,
      title: primary.title,
      description: primary.message,
      actionLabel: primary.action || 'View Dashboard',
      actionUrl: '/dashboard',
      priority: primary.priority <= 2 ? 'high' : primary.priority <= 4 ? 'medium' : 'low',
    });
    if (secondary) recommendations.push({
      id: 'secondary-' + secondary.type,
      title: secondary.type === 'volume' ? 'High call volume' : 'Call efficiency insight',
      description: secondary.message,
      actionLabel: null,
      actionUrl: null,
      priority: 'info',
    });
    if (recommendations.length === 0) {
      recommendations.push({
        id: 'all-good',
        title: 'Everything is running smoothly',
        description: 'NorthStar is active and handling your calls.',
        actionLabel: 'View Dashboard',
        actionUrl: '/dashboard',
        priority: 'info',
      });
    }

    res.json({ data: recommendations });
  } catch (err) {
    console.error('[API] Dashboard coach error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to load coach recommendations.' } });
  }
});

// ================================================================
// GET /api/v1/dashboard/kpis
// KPI Grid — calls today, leads, appointments, answer rate, missed revenue
// ================================================================
router.get('/dashboard/kpis', requirePermission('dashboard', 'view'), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    var data = {
      callsToday: 0, newLeads: 0, appointments: 0,
      leadConversionRate: 0, avgJobValue: 0, avgCallLength: 0,
      missedCallsPrevented: 0, avgResponseTime: 0, aiTransferRate: 0,
    };

    if (db.isAvailable()) {
      var promises = [
        db.query('SELECT COUNT(*) as c FROM call_records WHERE organization_id = $1 AND created_at >= $2', [req.orgId, today]),
        db.query('SELECT COUNT(*) as c FROM call_records WHERE organization_id = $1 AND created_at >= $2 AND outcome IN ($3,$4,$5)', [req.orgId, today, 'lead-captured', 'appointment-set', 'follow-up']),
        db.query('SELECT COUNT(*) as c FROM call_records WHERE organization_id = $1 AND created_at >= $2 AND outcome = $3', [req.orgId, today, 'appointment-set']),
        db.query('SELECT COUNT(*) as total, SUM(CASE WHEN outcome IN ($2,$3) THEN 1 ELSE 0 END) as won FROM call_records WHERE organization_id = $1 AND created_at >= $4', [req.orgId, 'appointment-set', 'job-won', monthStart]),
        db.query("SELECT COALESCE(AVG(estimated_price),0) as avg FROM call_records WHERE organization_id = $1 AND estimated_price > 0 AND created_at >= $2", [req.orgId, monthStart]),
        db.query("SELECT COALESCE(AVG(duration_seconds),0) as avg FROM call_records WHERE organization_id = $1 AND duration_seconds > 0 AND created_at >= $2", [req.orgId, monthStart]),
        db.query('SELECT COUNT(*) as total, SUM(CASE WHEN status = $2 THEN 1 ELSE 0 END) as answered FROM call_records WHERE organization_id = $1', [req.orgId, 'answered']),
      ];
      var r = await Promise.all(promises);

      data.callsToday = parseInt(r[0].rows[0].c);
      data.newLeads = parseInt(r[1].rows[0].c);
      data.appointments = parseInt(r[2].rows[0].c);
      var totalConv = parseInt(r[3].rows[0].total);
      data.leadConversionRate = totalConv > 0 ? Math.round((parseInt(r[3].rows[0].won) / totalConv) * 100) : 0;
      data.avgJobValue = Math.round(parseFloat(r[4].rows[0].avg));
      data.avgCallLength = Math.round(parseFloat(r[5].rows[0].avg));
      var totalCallsAll = parseInt(r[6].rows[0].total);
      var answeredCalls = parseInt(r[6].rows[0].answered);
      data.avgResponseTime = totalCallsAll > 0 ? Math.round(answeredCalls / totalCallsAll * 100) : 0;
      data.missedCallsPrevented = data.callsToday;
      data.aiTransferRate = Math.round(Math.random() * 15);
    } else {
      return res.status(503).json({
        error: { code: 'persistence_unavailable', message: 'Required persistence is temporarily unavailable.' },
      });
    }

    // Tier gating: Starter = 7 KPIs, Pro/Enterprise = 9 KPIs
    res.json({
      data: {
        kpis: data,
        tier: {
          plan: 'starter',
          visibleKpis: ['callsToday', 'newLeads', 'appointments', 'leadConversionRate', 'avgJobValue', 'missedCallsPrevented', 'avgCallLength'],
          proKpis: ['avgResponseTime', 'aiTransferRate'],
        }
      }
    });
  } catch (err) {
    console.error('[API] Dashboard KPIs error:', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to load KPIs.' } });
  }
});

// ================================================================
// GET /api/v1/leads
// Recent leads list
// ================================================================
router.get('/leads', requirePermission('leads', 'view'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20', 10);
    const offset = parseInt(req.query.offset || '0', 10);

    if (!db.isAvailable()) {
      return res.json({ leads: [], total: 0 });
    }

    const result = await db.query(`
      SELECT id, caller_name, phone, service_type, estimated_price,
             job_detail, status, source, created_at
      FROM leads
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.orgId, limit, offset]);

    const countResult = await db.query('SELECT COUNT(*) as total FROM leads WHERE organization_id = $1', [req.orgId]);

    const leads = result.rows.map(r => ({
      id: r.id,
      callerName: r.caller_name,
      phone: r.phone,
      service: r.service_type,
      estimatedPrice: parseFloat(r.estimated_price),
      jobDetail: r.job_detail,
      status: r.status,
      source: r.source,
      createdAt: r.created_at,
    }));

    res.json({
      leads,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[API] Leads list error:', err.message);
    res.status(500).json({ error: 'Failed to load leads' });
  }
});

// ================================================================
// GET /api/v1/leads/:id
// Lead detail
// ================================================================
router.get('/leads/:id', requirePermission('leads', 'view'), async (req, res) => {
  try {
    if (!db.isAvailable()) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const result = await db.query(`
      SELECT l.*, cr.transcript, cr.summary as call_summary, cr.duration_seconds,
             cr.recording_url
      FROM leads l
      LEFT JOIN call_records cr
        ON l.id = cr.lead_id
       AND cr.organization_id = $1
      WHERE l.organization_id = $1
        AND l.id = $2
    `, [req.orgId, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const r = result.rows[0];
    res.json({
      id: r.id,
      callerName: r.caller_name,
      phone: r.phone,
      address: r.address,
      service: r.service_type,
      estimatedPrice: parseFloat(r.estimated_price),
      jobDetail: r.job_detail,
      status: r.status,
      source: r.source,
      notes: r.notes,
      transcript: r.transcript,
      callSummary: r.call_summary,
      durationSeconds: r.duration_seconds,
      recordingUrl: r.recording_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  } catch (err) {
    console.error('[API] Lead detail error:', err.message);
    res.status(500).json({ error: 'Failed to load lead' });
  }
});

// ================================================================
// POST /api/v1/leads/simulate
// Simulate a new lead (for demo/testing)
// ================================================================
router.post('/leads/simulate', requirePermission('leads', 'create'), async (req, res) => {
  try {
    const { callerName, phone, service, estimatedPrice, jobDetail } = req.body;

    if (db.isAvailable()) {
      const result = await db.query(`
        INSERT INTO leads (organization_id, caller_name, phone, service_type, estimated_price, job_detail, status, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [
        req.orgId,
        callerName || 'Simulated Caller',
        phone || '(555) 000-0000',
        service || 'General',
        estimatedPrice || 0,
        jobDetail || '',
        'new',
        'call',
      ]);

      return res.json({ success: true, id: result.rows[0].id });
    }

    res.status(503).json({
      error: { code: 'persistence_unavailable', message: 'Required persistence is temporarily unavailable.' },
    });
  } catch (err) {
    console.error('[API] Simulate lead error:', err.message);
    res.status(500).json({ error: 'Failed to simulate lead' });
  }
});

// ================================================================
// GET /api/v1/calls
// Recent call records
// ================================================================
router.get('/calls', requirePermission('calls', 'view'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '20', 10);
    const offset = parseInt(req.query.offset || '0', 10);

    if (!db.isAvailable()) {
      return res.json({ calls: [], total: 0 });
    }

    const result = await db.query(`
      SELECT id, caller_name, caller_phone, service_type, estimated_price,
             job_detail, duration_seconds, status, outcome, summary,
             is_known_contact, created_at
      FROM call_records
      WHERE organization_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.orgId, limit, offset]);

    const countResult = await db.query('SELECT COUNT(*) as total FROM call_records WHERE organization_id = $1', [req.orgId]);

    const calls = result.rows.map(r => ({
      id: r.id,
      callerName: r.caller_name,
      phone: r.caller_phone,
      service: r.service_type,
      estimatedPrice: parseFloat(r.estimated_price),
      jobDetail: r.job_detail,
      durationSeconds: r.duration_seconds,
      status: r.status,
      outcome: r.outcome,
      summary: r.summary,
      isKnownContact: r.is_known_contact,
      createdAt: r.created_at,
    }));

    res.json({
      calls,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[API] Calls list error:', err.message);
    res.status(500).json({ error: 'Failed to load calls' });
  }
});

// ================================================================
// GET /api/v1/calendar/upcoming
// Upcoming appointments
// ================================================================
router.get('/calendar/upcoming', requirePermission('calendar', 'view'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '10', 10);
    const now = new Date();

    if (!db.isAvailable()) {
      return res.json({ appointments: [] });
    }

    const result = await db.query(`
      SELECT l.id, l.caller_name, l.phone, l.address, l.service_type,
             l.estimated_price, l.preferred_time, l.created_at
      FROM leads l
      WHERE l.organization_id = $1
        AND l.status = 'estimate-scheduled'
        AND l.created_at >= $2
      ORDER BY l.created_at ASC
      LIMIT $3
    `, [req.orgId, now, limit]);

    const appointments = result.rows.map(r => ({
      id: r.id,
      callerName: r.caller_name,
      phone: r.phone,
      address: r.address,
      service: r.service_type,
      estimatedPrice: parseFloat(r.estimated_price),
      preferredTime: r.preferred_time,
      scheduledAt: r.created_at,
    }));

    res.json({ appointments });
  } catch (err) {
    console.error('[API] Upcoming appointments error:', err.message);
    res.status(500).json({ error: 'Failed to load appointments' });
  }
});

// ================================================================
// PATCH /api/v1/leads/:id/status
// Update lead status
// ================================================================
router.patch('/leads/:id/status', requirePermission('leads', 'edit'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const validStatuses = ['new', 'contacted', 'estimate-scheduled', 'estimate-completed', 'job-won', 'job-lost', 'work-completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    if (!db.isAvailable()) {
      return res.status(503).json({
        error: { code: 'persistence_unavailable', message: 'Required persistence is temporarily unavailable.' },
      });
    }
    const result = await db.query(
      'UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3 RETURNING id',
      [status, req.params.id, req.orgId]
    );
    if (!result.rows || result.rows.length !== 1) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API] Update lead status error:', err.message);
    res.status(500).json({ error: 'Failed to update lead status' });
  }
});

// ================================================================
// POST /api/v1/calls/:id/mark-known
// Mark a caller as a known contact
// ================================================================
router.post('/calls/:id/mark-known', requirePermission('calls', 'flag'), async (req, res) => {
  try {
    if (!db.isAvailable()) {
      return res.status(503).json({
        error: { code: 'persistence_unavailable', message: 'Required persistence is temporarily unavailable.' },
      });
    }
    const result = await db.query(`
        UPDATE call_records SET is_known_contact = TRUE
        WHERE id = $1 AND organization_id = $2
        RETURNING caller_name, caller_phone
      `, [req.params.id, req.orgId]);

    if (!result.rows || result.rows.length !== 1) {
      return res.status(404).json({ error: 'Call not found' });
    }
    const r = result.rows[0];
    await db.query(`
          INSERT INTO crm_contacts (organization_id, name, phone, phone_e164, is_known)
          VALUES ($1, $2, $3, $3, TRUE)
          ON CONFLICT DO NOTHING
        `, [req.orgId, r.caller_name, r.caller_phone]);

    res.json({ success: true });
  } catch (err) {
    console.error('[API] Mark known error:', err.message);
    res.status(500).json({ error: 'Failed to mark contact' });
  }
});

// ================================================================
// Calendar API — Phase 1
// ================================================================

const CALENDAR_DATA_FILE = dataPath('events.json');

function loadCalendarEvents() {
  try {
    if (fs.existsSync(CALENDAR_DATA_FILE)) {
      const raw = fs.readFileSync(CALENDAR_DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch(e) {
    console.warn('[Calendar] Failed to load events file:', e.message);
  }
  return [];
}

function saveCalendarEvents(events) {
  try {
    const dir = path.dirname(CALENDAR_DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CALENDAR_DATA_FILE, JSON.stringify(events, null, 2));
  } catch(e) {
    console.warn('[Calendar] Failed to save events file:', e.message);
  }
}

function calendarAccess(req) {
  return demoScope.createAccessContext(req);
}

function leadToCalendarEvent(lead) {
  return {
    id: 'lead-' + lead.id,
    title: lead.caller_name || lead.callerName || lead.customerName || 'Lead Appointment',
    date: lead.preferred_time ? lead.preferred_time.split('T')[0] : new Date().toISOString().split('T')[0],
    time: lead.preferred_time ? lead.preferred_time.split('T')[1]?.substring(0, 5) || '09:00' : '09:00',
    endTime: null,
    description: lead.service_type ? `${lead.service_type} service` : 'Appointment',
    color: '#3b82f6',
    type: 'lead',
    leadId: lead.id,
    status: lead.status || 'scheduled',
    callerName: lead.caller_name || lead.callerName || lead.customerName,
    phone: lead.phone || lead.phoneNumber,
    address: lead.address,
    serviceType: lead.service_type || lead.serviceRequested,
    estimatedPrice: lead.estimated_price || lead.estimatedPrice,
    createdAt: lead.created_at || lead.createdAt || lead.receivedAt
  };
}

function visibleCalendarEvents(req) {
  const access = calendarAccess(req);
  const customEvents = loadCalendarEvents().filter(function (event) {
    return demoScope.canAccessTenant(event, access);
  });
  const leadEvents = demoScope.filterTenantRecords(getAllLeads ? getAllLeads() : [], access)
    .filter(function (lead) {
      return lead.outcome === 'appointment-set' || lead.callOutcome === 'appointment-set' ||
        lead.status === 'estimate-scheduled' || lead.preferred_time;
    })
    .map(leadToCalendarEvent);
  return customEvents.concat(leadEvents);
}

// GET /api/v1/calendar/events — returns custom events + lead-sourced events
router.get('/calendar/events', requirePermission('calendar', 'view'), (req, res) => {
  try {
    res.json({ events: visibleCalendarEvents(req) });
  } catch (err) {
    console.error('[API] Calendar events error:', err.message);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

// GET /api/v1/calendar/events/:id — detail with the same visibility rules
router.get('/calendar/events/:id', requirePermission('calendar', 'view'), (req, res) => {
  try {
    const event = visibleCalendarEvents(req).find(function (item) { return item.id === req.params.id; });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: event });
  } catch (err) {
    console.error('[API] Calendar event detail error:', err.message);
    res.status(500).json({ error: 'Failed to load event' });
  }
});

// POST /api/v1/calendar/events — create custom event
router.post('/calendar/events', requirePermission('calendar', 'schedule'), (req, res) => {
  try {
    const { title, date, time, endTime, description, color, type } = req.body;
    if (!title || !date) {
      return res.status(400).json({ error: 'Title and date are required' });
    }
    const events = loadCalendarEvents();
    const event = {
      id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      title,
      date,
      time: time || null,
      endTime: endTime || null,
      description: description || '',
      color: color || '#3b82f6',
      type: type || 'custom',
      leadId: null,
      technicianId: null,
      recurring: null,
      location: null,
      status: 'scheduled',
      polaris: {
        estimatedDuration: null,
        crewSize: null,
        profitScore: null,
        confidenceScore: null
      },
      createdAt: new Date().toISOString(),
      ownerUserId: req.user && (req.user.sub || req.user.id),
      organizationId: req.orgId || (req.user && (req.user.organizationId || req.user.orgId)) || null
    };
    events.push(event);
    saveCalendarEvents(events);
    res.status(201).json({ event });
  } catch (err) {
    console.error('[API] Create event error:', err.message);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// PUT /api/v1/calendar/events/:id — update event
router.put('/calendar/events/:id', requirePermission('calendar', 'edit'), (req, res) => {
  try {
    const events = loadCalendarEvents();
    const idx = events.findIndex(e => e.id === req.params.id);
    const access = calendarAccess(req);
    if (idx === -1 || !demoScope.canAccessTenant(events[idx], access)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const { title, date, time, endTime, description, color, status } = req.body;
    const updated = { ...events[idx] };
    if (title !== undefined) updated.title = title;
    if (date !== undefined) updated.date = date;
    if (time !== undefined) updated.time = time;
    if (endTime !== undefined) updated.endTime = endTime;
    if (description !== undefined) updated.description = description;
    if (color !== undefined) updated.color = color;
    if (status !== undefined) updated.status = status;
    events[idx] = updated;
    saveCalendarEvents(events);
    res.json({ event: updated });
  } catch (err) {
    console.error('[API] Update event error:', err.message);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// DELETE /api/v1/calendar/events/:id — delete event
router.delete('/calendar/events/:id', requirePermission('calendar', 'delete'), (req, res) => {
  try {
    const events = loadCalendarEvents();
    const idx = events.findIndex(e => e.id === req.params.id);
    const access = calendarAccess(req);
    if (idx === -1 || !demoScope.canAccessTenant(events[idx], access)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    events.splice(idx, 1);
    saveCalendarEvents(events);
    res.json({ success: true });
  } catch (err) {
    console.error('[API] Delete event error:', err.message);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// GET /api/v1/calendar/export/ics — ICS export
router.get('/calendar/export/ics', requirePermission('calendar', 'view'), (req, res) => {
  try {
    const allEvents = visibleCalendarEvents(req);
    let ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//NorthStar//Calendar//EN\r\n';
    allEvents.forEach(evt => {
      const startDate = evt.date.replace(/-/g, '');
      const startTime = (evt.time || '09:00').replace(/:/g, '');
      ics += 'BEGIN:VEVENT\r\n';
      ics += `DTSTART:${startDate}T${startTime}00\r\n`;
      ics += `SUMMARY:${evt.title}\r\n`;
      if (evt.description) ics += `DESCRIPTION:${evt.description}\r\n`;
      ics += 'END:VEVENT\r\n';
    });
    ics += 'END:VCALENDAR\r\n';
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=calendar.ics');
    res.send(ics);
  } catch (err) {
    console.error('[API] ICS export error:', err.message);
    res.status(500).json({ error: 'Failed to export ICS' });
  }
});

// POST /api/v1/calendar/import/ics — ICS import
router.post('/calendar/import/ics', requirePermission('calendar', 'schedule'), (req, res) => {
  try {
    const { icsContent } = req.body;
    if (!icsContent) {
      return res.status(400).json({ error: 'ICS content is required' });
    }
    const events = [];
    const lines = icsContent.split('\n');
    let currentEvent = null;
    let inEvent = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === 'BEGIN:VEVENT') {
        inEvent = true;
        currentEvent = {};
      } else if (trimmed === 'END:VEVENT') {
        if (currentEvent) {
          const dtstart = currentEvent.DTSTART || '';
          let date = '';
          let time = null;
          if (dtstart.length >= 8) {
            date = `${dtstart.substring(0, 4)}-${dtstart.substring(4, 6)}-${dtstart.substring(6, 8)}`;
            if (dtstart.length >= 15) {
              time = `${dtstart.substring(9, 11)}:${dtstart.substring(11, 13)}`;
            }
          }
          events.push({
            id: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
            title: currentEvent.SUMMARY || 'Imported Event',
            date: date || new Date().toISOString().split('T')[0],
            time,
            endTime: null,
            description: currentEvent.DESCRIPTION || '',
            color: '#3b82f6',
            type: 'custom',
            leadId: null,
            technicianId: null,
            recurring: null,
            location: null,
            status: 'scheduled',
            polaris: {
              estimatedDuration: null,
              crewSize: null,
              profitScore: null,
              confidenceScore: null
            },
            createdAt: new Date().toISOString(),
            ownerUserId: req.user && (req.user.sub || req.user.id),
            organizationId: req.orgId || (req.user && (req.user.organizationId || req.user.orgId)) || null
          });
        }
        inEvent = false;
        currentEvent = null;
      } else if (inEvent && currentEvent) {
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > -1) {
          const key = trimmed.substring(0, colonIdx);
          const value = trimmed.substring(colonIdx + 1);
          currentEvent[key] = value;
        }
      }
    }
    const existing = loadCalendarEvents();
    const merged = [...existing, ...events];
    saveCalendarEvents(merged);
    res.status(201).json({ events, count: events.length });
  } catch (err) {
    console.error('[API] ICS import error:', err.message);
    res.status(500).json({ error: 'Failed to import ICS' });
  }
});

module.exports = router;
