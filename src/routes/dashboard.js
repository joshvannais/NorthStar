/**
 * Dashboard API endpoints — Phase 3
 * Real queries where data is available, graceful stubs where pending.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { getAllLeads } = require('../leads/store');
const coach = require('../coach/engine');
const brief = require('../coach/brief');

function getDateRange(period) {
  const now = new Date(); let start, end = now;
  switch (period) {
    case 'today': start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case 'yesterday': start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); break;
    case 'week': const d = now.getDay(); start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d); break;
    case 'month': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
    default: start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { start, end };
}

router.get('/dashboard/summary', async (req, res) => {
  try {
    const period = req.query.period || 'today';
    const range = getDateRange(period);
    let totalRevenue = 0, totalCalls = 0, appointments = 0;
    if (db.isAvailable()) {
      const r = await Promise.all([
        db.query("SELECT COALESCE(SUM(estimated_price),0) as r FROM call_records WHERE outcome IN ('appointment-set','job-won') AND created_at >= $1", [range.start]),
        db.query("SELECT COUNT(*) as c FROM call_records WHERE created_at >= $1", [range.start]),
        db.query("SELECT COUNT(*) as c FROM call_records WHERE outcome = 'appointment-set' AND created_at >= $1", [range.start]),
      ]);
      totalRevenue = parseFloat(r[0].rows[0].r);
      totalCalls = parseInt(r[1].rows[0].c);
      appointments = parseInt(r[2].rows[0].c);
    }
    res.json({ data: { totalRevenue: Math.round(totalRevenue), totalCalls, appointments, period } });
  } catch (err) { console.error('[API] Summary error:', err.message); res.status(500).json({ error: 'Failed to load summary' }); }
});

router.get('/dashboard/kpis', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    let data = { callsToday: 0, newLeads: 0, appointments: 0, leadConversionRate: 0, avgJobValue: 0, avgCallLength: 0, missedCallsPrevented: 0, avgResponseTime: 3, aiTransferRate: 0 };
    if (db.isAvailable()) {
      const r = await Promise.all([
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
      const totalConv = parseInt(r[3].rows[0].total);
      data.leadConversionRate = totalConv > 0 ? Math.round((parseInt(r[3].rows[0].won) / totalConv) * 100) : 0;
      data.avgJobValue = Math.round(parseFloat(r[4].rows[0].avg));
      data.avgCallLength = Math.round(parseFloat(r[5].rows[0].avg));
      data.missedCallsPrevented = data.callsToday;
    }
    res.json({ data });
  } catch (err) { console.error('[API] KPIs error:', err.message); res.status(500).json({ error: 'Failed to load KPIs' }); }
});

router.get('/dashboard/revenue', async (req, res) => {
  try {
    const period = req.query.period || 'month';
    const range = getDateRange(period);
    const prevStart = new Date(range.start.getTime() - (range.end.getTime() - range.start.getTime()));
    let totalValue = 0, prevValue = 0, count = 0;
    if (db.isAvailable()) {
      const r = await Promise.all([
        db.query("SELECT COALESCE(SUM(estimated_price),0) as r, COUNT(*) as c FROM call_records WHERE outcome IN ('appointment-set','job-won') AND created_at >= $1 AND created_at <= $2", [range.start, range.end]),
        db.query("SELECT COALESCE(SUM(estimated_price),0) as r FROM call_records WHERE outcome IN ('appointment-set','job-won') AND created_at >= $1 AND created_at <= $2", [prevStart, range.start]),
      ]);
      totalValue = parseFloat(r[0].rows[0].r);
      prevValue = parseFloat(r[1].rows[0].r);
      count = parseInt(r[0].rows[0].c);
    }
    let trend = 'flat', pctChange = 0;
    if (prevValue > 0) { pctChange = Math.round(((totalValue - prevValue) / prevValue) * 100); trend = pctChange > 5 ? 'up' : pctChange < -5 ? 'down' : 'flat'; }
    else if (totalValue > 0) { trend = 'up'; pctChange = 100; }
    res.json({ data: { totalPipelineValue: Math.round(totalValue), trend, percentageChange: pctChange, opportunityCount: count, period } });
  } catch (err) { console.error('[API] Revenue error:', err.message); res.status(500).json({ error: 'Failed to load revenue' }); }
});

router.get('/dashboard/trends', async (req, res) => {
  try {
    const days = parseInt(req.query.days || '30', 10);
    const endD = new Date();
    const startD = new Date(endD.getTime() - days * 86400000);
    let dataPoints = [];
    if (db.isAvailable()) {
      const result = await db.query("SELECT DATE(created_at) as date, COALESCE(SUM(estimated_price),0) as revenue FROM call_records WHERE outcome IN ('appointment-set','job-won') AND created_at >= $1 GROUP BY DATE(created_at) ORDER BY date ASC", [startD]);
      const revMap = {};
      result.rows.forEach(r => { revMap[r.date.toISOString().split('T')[0]] = parseFloat(r.revenue); });
      for (let i = 0; i < days; i++) { const d = new Date(startD.getTime() + i * 86400000); const key = d.toISOString().split('T')[0]; dataPoints.push({ date: key, revenue: revMap[key] || 0 }); }
    }
    const totalRev = dataPoints.reduce((s, p) => s + p.revenue, 0);
    res.json({ data: { dataPoints, totalRevenue: Math.round(totalRev), days } });
  } catch (err) { console.error('[API] Trends error:', err.message); res.status(500).json({ error: 'Failed to load trends' }); }
});

// Coach Insight — 6-priority evaluation engine (C6)
router.get('/coach/insight', async (req, res) => {
  try {
    const leads = getAllLeads();
    const today = new Date().toISOString().slice(0, 10);
    const todayLeads = leads.filter(l => (l.receivedAt || '').startsWith(today));
    const callsToday = todayLeads.filter(l => (l.source || 'phone_call') === 'phone_call').length;
    const capturedCount = todayLeads.length;
    const convertedCount = todayLeads.filter(l => l.callOutcome === 'appointment-set').length;
    const unrespondedLeads = leads.filter(l => {
      if (!l.receivedAt) return false;
      return (Date.now() - new Date(l.receivedAt).getTime()) / 86400000 > 1 && !['appointment-set', 'voicemail', 'no-interest'].includes(l.callOutcome || '');
    }).length;
    const serviceMap = {};
    leads.forEach(l => { const s = l.serviceRequested || 'Other'; if (!serviceMap[s]) serviceMap[s] = { service: s, count: 0, revenue: 0 }; serviceMap[s].count++; serviceMap[s].revenue += l.estimatedPrice || 450; });
    const lastCallDate = Math.max(...leads.map(l => new Date(l.receivedAt || Date.now()).getTime()));
    const lastActivityDays = callsToday > 0 ? 0 : Math.min(Math.ceil((Date.now() - lastCallDate) / 86400000), 30);
    const metrics = { callsMissedLastHour: 0, callsAnswered: callsToday, leadsCaptured: capturedCount, leadsConverted: convertedCount, lastActivityDays, pipelineWeightedValue: capturedCount * 450 * 0.35, pipelineTarget: 10000, unrespondedLeads, servicePerformance: Object.values(serviceMap) };
    const result = coach.evaluate(metrics);
    res.json({ data: result });
  } catch (err) { console.error('[API] Coach error:', err.message); res.status(500).json({ error: 'Failed to generate coach insight' }); }
});

// Daily Brief — server-generated (C7)
router.get('/dashboard/brief', async (req, res) => {
  try {
    const leads = getAllLeads();
    const today = new Date().toISOString().slice(0, 10);
    const todayLeads = leads.filter(l => (l.receivedAt || '').startsWith(today));
    const callsToday = todayLeads.filter(l => (l.source || 'phone_call') === 'phone_call').length;
    const appointmentsToday = todayLeads.filter(l => l.callOutcome === 'appointment-set').length;
    const revenueToday = todayLeads.reduce((sum, l) => sum + (l.estimatedPrice || 450), 0);
    const unrespondedLeads = leads.filter(l => {
      if (!l.receivedAt) return false;
      return (Date.now() - new Date(l.receivedAt).getTime()) / 86400000 > 1 && !['appointment-set', 'voicemail', 'no-interest'].includes(l.callOutcome || '');
    }).length;
    const metrics = { callsToday, leadsToday: todayLeads.length, appointmentsScheduled: appointmentsToday, revenueToday, unrespondedLeads, pipelineWeightedValue: revenueToday * 0.35 };
    const briefText = brief.generate(metrics, req.query.name || 'there');
    res.json({ data: { brief: briefText, wordCount: briefText.split(/\s+/).length } });
  } catch (err) { console.error('[API] Brief error:', err.message); res.status(500).json({ error: 'Failed to generate daily brief' }); }
});

router.get('/dashboard/status', async (req, res) => {
  try {
    const dbStatus = db.isAvailable() ? 'up' : 'degraded';
    const retellStatus = process.env.RETELL_API_KEY ? 'up' : 'degraded';
    const twilioStatus = process.env.TWILIO_ACCOUNT_SID ? 'up' : 'degraded';
    const services = [
      { name: 'AI Active', status: retellStatus === 'up' ? 'healthy' : 'degraded' },
      { name: 'Phone Forwarding', status: twilioStatus === 'up' ? 'healthy' : 'degraded' },
      { name: 'Database', status: dbStatus === 'up' ? 'healthy' : 'degraded' },
      { name: 'API', status: 'healthy' },
    ];
    res.json({ data: { services } });
  } catch (err) { console.error('[API] Status error:', err.message); res.status(500).json({ error: 'Failed to load status' }); }
});

module.exports = router;