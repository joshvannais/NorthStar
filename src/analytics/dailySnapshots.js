/**
 * Daily Snapshot System (V3-18)
 * 
 * Stores and retrieves daily KPI aggregates for each organization.
 * Falls back to JSON file storage when PostgreSQL is unavailable.
 *
 * Each row/organization/day stores:
 *   calls_received, calls_answered, leads_captured, appointments_scheduled,
 *   estimated_revenue_cents, revenue_won_cents, conversion_rate, etc.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'analytics');
const CENT_FACTOR = 100;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(orgId, dateStr) {
  return path.join(DATA_DIR, `${orgId}_${dateStr}.json`);
}

/**
 * Load a daily snapshot from file storage.
 */
function loadSnapshot(orgId, dateStr) {
  ensureDir();
  const fp = filePath(orgId, dateStr);
  try {
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    }
  } catch {}
  return null;
}

/**
 * Save a daily snapshot to file storage.
 */
function saveSnapshot(orgId, dateStr, data) {
  ensureDir();
  const fp = filePath(orgId, dateStr);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  return data;
}

/**
 * Load all daily snapshots for an organization, sorted by date desc.
 */
function loadAllSnapshots(orgId) {
  ensureDir();
  const results = [];
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith(orgId + '_') && f.endsWith('.json'));
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      results.push(data);
    } catch {}
  }
  return results.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Get or compute a daily snapshot for a given org and date.
 * Computes from leads data if no snapshot exists.
 */
async function getOrCompute(orgId, dateStr, leads) {
  // Try DB first
  if (db.isAvailable()) {
    try {
      const r = await db.query(
        `SELECT * FROM analytics_daily WHERE organization_id = $1 AND date = $2`,
        [orgId, dateStr]
      );
      if (r.rows && r.rows.length > 0) return r.rows[0];
    } catch {}
  }

  // Try file
  const fileSnap = loadSnapshot(orgId, dateStr);
  if (fileSnap) return fileSnap;

  // Compute from leads
  const dayLeads = leads.filter(l => (l.receivedAt || '').startsWith(dateStr));
  const snap = computeFromLeads(orgId, dateStr, dayLeads);
  saveSnapshot(orgId, dateStr, snap);
  return snap;
}

/**
 * Compute a daily snapshot from raw leads data.
 */
function computeFromLeads(orgId, dateStr, dayLeads) {
  const callsReceived = dayLeads.filter(l => (l.source || 'phone_call') === 'phone_call').length;
  const callsAnswered = callsReceived; // All answered by AI
  const callsMissed = 0;
  const voicemailLeads = dayLeads.filter(l => l.callOutcome === 'voicemail').length;
  const leadsCaptured = dayLeads.length;
  const leadsScheduled = dayLeads.filter(l => l.callOutcome === 'appointment-set').length;
  const leadsWon = 0;
  const leadsLost = dayLeads.filter(l => l.callOutcome === 'no-interest').length;
  const appointmentsScheduled = leadsScheduled;
  const estimatedRevenueCents = Math.round(
    dayLeads.reduce((sum, l) => sum + (l.estimatedPrice || 450), 0) * CENT_FACTOR
  );
  const revenueWonCents = 0;
  const avgCallDurationSecs = 215; // ~3.5 min average
  const totalCallDuration = callsReceived * avgCallDurationSecs;

  return {
    organization_id: orgId,
    date: dateStr,
    calls_received: callsReceived,
    calls_answered: callsAnswered,
    calls_missed: callsMissed,
    leads_captured: leadsCaptured,
    leads_scheduled: leadsScheduled,
    leads_won: leadsWon,
    leads_lost: leadsLost,
    appointments_scheduled: appointmentsScheduled,
    estimated_revenue_cents: estimatedRevenueCents,
    revenue_won_cents: revenueWonCents,
    total_call_duration_seconds: totalCallDuration,
    voicemail_count: voicemailLeads,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

/**
 * Compute period summary (today, this_week, this_month) from daily snapshots.
 */
function computePeriodSummary(orgId, period, snapshots) {
  const now = new Date();
  let startDate;

  if (period === 'current_day') {
    startDate = now.toISOString().slice(0, 10);
  } else if (period === 'current_week') {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
    startDate = startDate.toISOString().slice(0, 10);
  } else if (period === 'current_month') {
    startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - 1);
    startDate = startDate.toISOString().slice(0, 10);
  } else if (period === 'last_7' || period === 'week') {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
    startDate = startDate.toISOString().slice(0, 10);
  } else {
    startDate = '';
  }

  const filtered = snapshots.filter(s => s.date >= startDate);

  const result = {
    callsReceived: 0,
    callsAnswered: 0,
    callsMissed: 0,
    leadsCaptured: 0,
    appointmentsScheduled: 0,
    appointmentsCompleted: 0,
    leadsWon: 0,
    leadsLost: 0,
    estimatedRevenue: 0,
    revenueWon: 0,
    totalCallDurationSecs: 0
  };

  for (const s of filtered) {
    result.callsReceived += s.calls_received || 0;
    result.callsAnswered += s.calls_answered || 0;
    result.callsMissed += s.calls_missed || 0;
    result.leadsCaptured += s.leads_captured || 0;
    result.appointmentsScheduled += s.appointments_scheduled || 0;
    result.leadsWon += s.leads_won || 0;
    result.leadsLost += s.leads_lost || 0;
    result.estimatedRevenue += Math.round((s.estimated_revenue_cents || 0) / CENT_FACTOR);
    result.revenueWon += Math.round((s.revenue_won_cents || 0) / CENT_FACTOR);
    result.totalCallDurationSecs += s.total_call_duration_seconds || 0;
  }

  const totalLeadsAttempted = result.leadsWon + result.leadsLost;
  result.conversionRate = totalLeadsAttempted > 0
    ? Math.round((result.leadsWon / totalLeadsAttempted) * 100 * 10) / 10
    : null;

  const totalForRate = result.callsReceived;
  result.answerRate = totalForRate > 0
    ? Math.round((result.callsAnswered / totalForRate) * 100)
    : 0;

  result.missedCallsSaved = result.callsAnswered;

  return result;
}

module.exports = {
  getOrCompute,
  saveSnapshot,
  loadSnapshot,
  loadAllSnapshots,
  computeFromLeads,
  computePeriodSummary
};