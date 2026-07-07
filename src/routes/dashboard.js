/**
 * Dashboard API endpoints — Phase 3
 * Provides all endpoints needed by the dashboard widgets.
 * Real queries where data is available, graceful stubs where pending.
 * All endpoints are under /api/v1/ namespace.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

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
router.get('/dashboard/summary', async (req, res) => {
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
        WHERE outcome IN ('appointment-set', 'job-won')
          AND created_at >= $1 AND created_at <= $2
      `, [start, end]);
      totalRevenue = parseFloat(currentResult.rows[0].revenue);
      totalLeads = parseInt(currentResult.rows[0].count);

      // Previous period for trend
      const prevResult = await db.query(`
        SELECT COALESCE(SUM(estimated_price), 0) as revenue
        FROM call_records
        WHERE outcome IN ('appointment-set', 'job-won')
          AND created_at >= $1 AND created_at <= $2
      `, [prev.start, prev.end]);
      prevRevenue = parseFloat(prevResult.rows[0].revenue);

      // Distinct service types
      const svcResult = await db.query(`
        SELECT DISTINCT service_type FROM call_records
        WHERE created_at >= $1 AND created_at <= $2
          AND service_type IS NOT NULL AND service_type != ''
      `, [start, end]);
      serviceTypes = svcResult.rows.map(r => r.service_type).filter(Boolean);
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
// GET /api/v1/dashboard/kpis
// KPI Grid — calls today, leads, appointments, answer rate, missed revenue
// ================================================================
router.get('/dashboard/kpis', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let callsToday = 0;
    let leadsToday = 0;
    let appointmentsToday = 0;
    let totalCalls = 0;
    let answeredCalls = 0;

    if (db.isAvailable()) {
      // Calls today
      const callsResult = await db.query(`
        SELECT COUNT(*) as count FROM call_records WHERE created_at >= $1
      `, [today]);
      callsToday = parseInt(callsResult.rows[0].count);

      // Leads today (call_records with captured leads)
      const leadsResult = await db.query(`
        SELECT COUNT(*) as count FROM call_records
        WHERE created_at >= $1
          AND outcome IN ('lead-captured', 'appointment-set', 'follow-up')
      `, [today]);
      leadsToday = parseInt(leadsResult.rows[0].count);

      // Appointments today
      const aptResult = await db.query(`
        SELECT COUNT(*) as count FROM call_records
        WHERE created_at >= $1 AND outcome = 'appointment-set'
      `, [today]);
      appointmentsToday = parseInt(aptResult.rows[0].count);

      // All-time answer rate
      const allResult = await db.query(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN status = 'answered' THEN 1 ELSE 0 END) as answered
        FROM call_records
      `);
      totalCalls = parseInt(allResult.rows[0].total);
      answeredCalls = parseInt(allResult.rows[0].answered);
    }

    const answerRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 100;
    const missedRevenue = 0; // Placeholder — requires average job value config

    res.json({
      callsToday,
      leadsToday,
      appointmentsToday,
      answerRate,
      missedRevenue,
      totalCalls,
      totalAnswered: answeredCalls,
    });
  } catch (err) {
    console.error('[API] Dashboard KPIs error:', err.message);
    res.status(500).json({ error: 'Failed to load KPIs' });
  }
});

// ================================================================
// GET /api/v1/leads
// Recent leads list
// ================================================================
router.get('/leads', async (req, res) => {
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
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const countResult = await db.query('SELECT COUNT(*) as total FROM leads');

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
router.get('/leads/:id', async (req, res) => {
  try {
    if (!db.isAvailable()) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const result = await db.query(`
      SELECT l.*, cr.transcript, cr.summary as call_summary, cr.duration_seconds,
             cr.recording_url
      FROM leads l
      LEFT JOIN call_records cr ON l.id = cr.lead_id
      WHERE l.id = $1
    `, [req.params.id]);

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
router.post('/leads/simulate', async (req, res) => {
  try {
    const { callerName, phone, service, estimatedPrice, jobDetail } = req.body;

    if (db.isAvailable()) {
      const result = await db.query(`
        INSERT INTO leads (caller_name, phone, service_type, estimated_price, job_detail, status, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [
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

    res.json({ success: true, id: 'simulated-' + Date.now() });
  } catch (err) {
    console.error('[API] Simulate lead error:', err.message);
    res.status(500).json({ error: 'Failed to simulate lead' });
  }
});

// ================================================================
// GET /api/v1/calls
// Recent call records
// ================================================================
router.get('/calls', async (req, res) => {
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
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const countResult = await db.query('SELECT COUNT(*) as total FROM call_records');

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
router.get('/calendar/upcoming', async (req, res) => {
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
      WHERE l.status = 'estimate-scheduled'
        AND l.created_at >= $1
      ORDER BY l.created_at ASC
      LIMIT $2
    `, [now, limit]);

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
router.patch('/leads/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const validStatuses = ['new', 'contacted', 'estimate-scheduled', 'estimate-completed', 'job-won', 'job-lost', 'work-completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    if (db.isAvailable()) {
      await db.query('UPDATE leads SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.id]);
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
router.post('/calls/:id/mark-known', async (req, res) => {
  try {
    if (db.isAvailable()) {
      const result = await db.query(`
        UPDATE call_records SET is_known_contact = TRUE WHERE id = $1
        RETURNING caller_name, caller_phone
      `, [req.params.id]);

      if (result.rows.length > 0) {
        const r = result.rows[0];
        // Also create/update CRM contact
        await db.query(`
          INSERT INTO crm_contacts (organization_id, name, phone, phone_e164, is_known)
          VALUES (NULL, $1, $2, $2, TRUE)
          ON CONFLICT DO NOTHING
        `, [r.caller_name, r.caller_phone]);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[API] Mark known error:', err.message);
    res.status(500).json({ error: 'Failed to mark contact' });
  }
});

module.exports = router;