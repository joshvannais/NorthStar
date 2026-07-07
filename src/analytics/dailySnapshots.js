/**
 * Daily Snapshot System (V3-18) — JSON file + optional DB persistence.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'analytics');
function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }
function filePath(orgId, dateStr) { return path.join(DATA_DIR, `${orgId}_${dateStr}.json`); }

function loadSnapshot(orgId, dateStr) {
  ensureDir();
  try { if (fs.existsSync(filePath(orgId, dateStr))) return JSON.parse(fs.readFileSync(filePath(orgId, dateStr), 'utf8')); } catch {}
  return null;
}

function saveSnapshot(orgId, dateStr, data) { ensureDir(); fs.writeFileSync(filePath(orgId, dateStr), JSON.stringify(data, null, 2)); return data; }

function loadAllSnapshots(orgId) {
  ensureDir();
  const results = [];
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith(orgId + '_') && f.endsWith('.json'));
  for (const f of files) { try { results.push(JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'))); } catch {} }
  return results.sort((a, b) => b.date.localeCompare(a.date));
}

async function getOrCompute(orgId, dateStr, leads) {
  if (db.isAvailable()) {
    try { const r = await db.query('SELECT * FROM analytics_daily WHERE organization_id = $1 AND date = $2', [orgId, dateStr]); if (r.rows && r.rows.length > 0) return r.rows[0]; } catch {}
  }
  const fileSnap = loadSnapshot(orgId, dateStr);
  if (fileSnap) return fileSnap;
  const snap = computeFromLeads(orgId, dateStr, leads);
  saveSnapshot(orgId, dateStr, snap);
  return snap;
}

function computeFromLeads(orgId, dateStr, dayLeads) {
  const callsReceived = dayLeads.filter(l => (l.source || 'phone_call') === 'phone_call').length;
  const callsAnswered = callsReceived;
  const leadsCaptured = dayLeads.length;
  const leadsScheduled = dayLeads.filter(l => l.callOutcome === 'appointment-set').length;
  const leadsLost = dayLeads.filter(l => l.callOutcome === 'no-interest').length;
  const estimatedRevenueCents = Math.round(dayLeads.reduce((sum, l) => sum + (l.estimatedPrice || 450), 0) * 100);
  return {
    organization_id: orgId, date: dateStr,
    calls_received: callsReceived, calls_answered: callsAnswered, calls_missed: 0,
    leads_captured: leadsCaptured, leads_scheduled: leadsScheduled, leads_won: 0, leads_lost: leadsLost,
    appointments_scheduled: leadsScheduled,
    estimated_revenue_cents: estimatedRevenueCents, revenue_won_cents: 0,
    total_call_duration_seconds: callsReceived * 215,
    voicemail_count: dayLeads.filter(l => l.callOutcome === 'voicemail').length,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
}

function computePeriodSummary(orgId, period, snapshots) {
  const now = new Date();
  let startDate;
  if (period === 'current_day') startDate = now.toISOString().slice(0, 10);
  else if (period === 'current_week') { const d = new Date(now); d.setDate(d.getDate() - 7); startDate = d.toISOString().slice(0, 10); }
  else if (period === 'current_month') { const d = new Date(now); d.setMonth(d.getMonth() - 1); startDate = d.toISOString().slice(0, 10); }
  else if (period === 'last_7') { const d = new Date(now); d.setDate(d.getDate() - 7); startDate = d.toISOString().slice(0, 10); }
  else startDate = '';

  const filtered = snapshots.filter(s => s.date >= startDate);
  const result = { callsReceived: 0, callsAnswered: 0, callsMissed: 0, leadsCaptured: 0, appointmentsScheduled: 0, leadsWon: 0, leadsLost: 0, estimatedRevenue: 0, revenueWon: 0, totalCallDurationSecs: 0 };
  for (const s of filtered) {
    result.callsReceived += s.calls_received || 0;
    result.callsAnswered += s.calls_answered || 0;
    result.leadsCaptured += s.leads_captured || 0;
    result.appointmentsScheduled += s.appointments_scheduled || 0;
    result.estimatedRevenue += Math.round((s.estimated_revenue_cents || 0) / 100);
    result.totalCallDurationSecs += s.total_call_duration_seconds || 0;
  }
  const totalForRate = result.callsReceived;
  result.answerRate = totalForRate > 0 ? Math.round((result.callsAnswered / totalForRate) * 100) : 0;
  result.missedCallsSaved = result.callsAnswered;
  return result;
}

module.exports = { getOrCompute, saveSnapshot, loadSnapshot, loadAllSnapshots, computeFromLeads, computePeriodSummary };