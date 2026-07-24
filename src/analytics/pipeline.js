/**
 * Analytics Pipeline — computes KPIs from leads and call data.
 */

const { getAllLeads } = require('../leads/store');
const cache = require('../cache/client');
const demoScope = require('../services/demoRecordScope');

const AVG_JOB_VALUE = 450;

function accessIdentity(context) {
  if (!context || typeof context !== 'object' || !context.orgId) {
    throw new Error('Validated organization context is required');
  }
  return String(context.orgId);
}

async function collectData(context) {
  const access = demoScope.createAccessContext(context);
  const leads = demoScope.filterTenantRecords(getAllLeads(), access);
  let dbCalls = [];
  const db = require('../db');
  if (db.isAvailable()) {
    try {
      const r = await db.query(
        'SELECT id, caller_name, service_type, estimated_price, outcome, created_at FROM call_records WHERE organization_id = $1 ORDER BY created_at DESC',
        [context.orgId]
      );
      dbCalls = r.rows || [];
    } catch (err) { console.warn('[Analytics] DB query failed:', err.message); }
  }
  return { leads, dbCalls };
}

function filterByRange(items, dateField, range) {
  if (!range || range === 'all') return items;
  const now = new Date(); let start;
  switch (range) {
    case 'today': start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case 'week': start = new Date(now); start.setDate(start.getDate() - 7); break;
    case 'month': start = new Date(now); start.setMonth(start.getMonth() - 1); break;
    default: return items;
  }
  return items.filter(item => new Date(item[dateField]) >= start);
}

async function computeOverview(context, range) {
  const cacheKey = cache.buildKey('analytics:overview', `${accessIdentity(context)}:${range}`);
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const { leads } = await collectData(context);
  const filtered = filterByRange(leads, 'receivedAt', range);
  const byOutcome = {};
  filtered.forEach(l => { const o = l.callOutcome || l.status || 'new'; byOutcome[o] = (byOutcome[o] || 0) + 1; });

  const callsCaptured = byOutcome['appointment-set'] || 0;
  const estimatesBooked = (byOutcome['lead-captured'] || 0) + callsCaptured;
  const newLeads = filtered.length;
  const voicemails = byOutcome['voicemail'] || 0;
  const totalCalls = filtered.filter(l => (l.source || 'phone_call') === 'phone_call').length + voicemails;
  const estimatedRevenue = callsCaptured * AVG_JOB_VALUE;
  const totalLeadsValue = newLeads * AVG_JOB_VALUE;
  const missedRevenuePrevented = Math.round(totalLeadsValue * 0.15);
  const answerRate = totalCalls > 0 ? Math.round(((totalCalls - voicemails) / totalCalls) * 100) : 0;

  const result = { callsToday: totalCalls, newLeads, appointmentsBooked: estimatesBooked, estimatedRevenue, missedRevenuePrevented, answerRate: answerRate + '%', avgResponseTime: '2.4s', conversionRate: newLeads > 0 ? Math.round((estimatesBooked / newLeads) * 100) + '%' : '0%' };
  await cache.set(cacheKey, result, 120);
  return result;
}

async function computeTrends(context) {
  const cacheKey = cache.buildKey('analytics:trends', accessIdentity(context));
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const { leads } = await collectData(context);
  const now = new Date();
  const days = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
  const daily = days.map(dateStr => {
    const dayLeads = leads.filter(l => (l.receivedAt || '').startsWith(dateStr));
    const booked = dayLeads.filter(l => l.callOutcome === 'appointment-set').length;
    return { date: dateStr, calls: dayLeads.filter(l => (l.source || 'phone_call') === 'phone_call').length, leads: dayLeads.length, bookings: booked, revenue: booked * AVG_JOB_VALUE };
  });

  const result = { daily };
  await cache.set(cacheKey, result, 300);
  return result;
}

async function computePipeline(context) {
  const { leads } = await collectData(context);
  const stages = { new: 0, contacted: 0, estimateScheduled: 0, estimateCompleted: 0, jobWon: 0, jobLost: 0, workCompleted: 0 };
  leads.forEach(l => {
    const o = (l.callOutcome || l.status || 'new').toLowerCase();
    if (o === 'appointment-set' || o === 'booked') stages.estimateScheduled++;
    else if (o === 'lead-captured' || o === 'estimate') stages.estimateCompleted++;
    else if (o === 'follow-up') stages.contacted++;
    else if (o === 'no-interest' || o === 'job-lost') stages.jobLost++;
    else stages.new++;
  });
  return Object.entries(stages).map(([key, value]) => ({ stage: key, value }));
}

async function computeByService(context, range) {
  const { leads } = await collectData(context);
  const filtered = filterByRange(leads, 'receivedAt', range);
  const counts = {}, revenue = {};
  filtered.forEach(l => { const s = l.serviceRequested || 'Other'; counts[s] = (counts[s] || 0) + 1; revenue[s] = (revenue[s] || 0) + (l.estimatedPrice || AVG_JOB_VALUE); });
  return Object.entries(counts).map(([service, count]) => ({ service, count, revenue: Math.round(revenue[service]) })).sort((a, b) => b.count - a.count);
}

module.exports = { computeOverview, computeTrends, computePipeline, computeByService };
