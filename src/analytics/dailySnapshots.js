/**
 * Daily Snapshot System (V3-18) — JSON file + optional DB persistence.
 */

const fs = require('fs');
const path = require('path');
const { getDataDir } = require('../services/dataPaths');

const pendingSnapshots = new Map();
function dataDir() { return path.join(getDataDir(), 'analytics'); }
function ensureDir() { const dir = dataDir(); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); return dir; }
function identityKey(identity) {
  if (!identity || typeof identity.key !== 'string' || !/^[a-f0-9]{64}$/.test(identity.key)) {
    throw new Error('Validated analytics identity is required');
  }
  return identity.key;
}
function filePath(identity, dateStr) { return path.join(ensureDir(), `${identityKey(identity)}_${dateStr}.json`); }

function loadSnapshot(identity, dateStr) {
  ensureDir();
  try { if (fs.existsSync(filePath(identity, dateStr))) return JSON.parse(fs.readFileSync(filePath(identity, dateStr), 'utf8')); } catch {}
  return null;
}

function saveSnapshot(identity, dateStr, data) {
  const scoped = Object.assign({}, data, { analytics_identity: identityKey(identity) });
  fs.writeFileSync(filePath(identity, dateStr), JSON.stringify(scoped, null, 2));
  return scoped;
}

function loadAllSnapshots(identity) {
  const dir = ensureDir();
  const results = [];
  const prefix = identityKey(identity) + '_';
  const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith('.json'));
  for (const f of files) { try { results.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch {} }
  return results.sort((a, b) => b.date.localeCompare(a.date));
}

async function getOrCompute(identity, dateStr, leads) {
  const pendingKey = identityKey(identity) + ':' + dateStr;
  const fileSnap = loadSnapshot(identity, dateStr);
  if (fileSnap) return fileSnap;
  if (pendingSnapshots.has(pendingKey)) return pendingSnapshots.get(pendingKey);
  const computation = Promise.resolve().then(function () {
    const organizationId = identity.dimensions && identity.dimensions.organizationId;
    const snap = computeFromLeads(organizationId, dateStr, leads);
    return saveSnapshot(identity, dateStr, snap);
  }).finally(function () {
    if (pendingSnapshots.get(pendingKey) === computation) pendingSnapshots.delete(pendingKey);
  });
  pendingSnapshots.set(pendingKey, computation);
  return computation;
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

module.exports = {
  getOrCompute,
  saveSnapshot,
  loadSnapshot,
  loadAllSnapshots,
  computeFromLeads,
  computePeriodSummary,
  _pendingSnapshots: pendingSnapshots
};
