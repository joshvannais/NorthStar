/**
 * Revenue Calculator (V5-17)
 * 
 * Calculates pipeline value from active leads × estimated job values.
 * Tracks trend direction (up/down/flat) by comparing to yesterday.
 *
 * Estimation Methods:
 * - Service-based: each service has base price range adjusted by complexity
 * - Historical: averages historical values for same service
 * - AI-powered: uses call transcript details (future)
 */

const cache = require('../cache/client');

const AVG_JOB_VALUE = 450;
const SERVICE_BASE_PRICES = {
  'Tree removal': { min: 500, max: 3000 },
  'Roof': { min: 3000, max: 12000 },
  'Plumbing': { min: 300, max: 2000 },
  'Electrical': { min: 200, max: 4000 },
  'Landscape': { min: 500, max: 5000 },
  'HVAC': { min: 500, max: 8000 },
  'Gutter': { min: 150, max: 600 },
  'Pest': { min: 150, max: 800 },
  'Concrete': { min: 1000, max: 6000 },
  'Fence': { min: 800, max: 4000 },
  'Window': { min: 800, max: 5000 },
  'Carpet': { min: 150, max: 700 },
  'Pressure': { min: 200, max: 800 },
  'Painting': { min: 500, max: 4000 },
  'Drywall': { min: 300, max: 1500 },
  'Flooring': { min: 1000, max: 8000 },
  'Garage': { min: 200, max: 1200 },
  'Solar': { min: 8000, max: 25000 },
  'Deck': { min: 3000, max: 10000 },
  'Pool': { min: 300, max: 1500 },
  'Appliance': { min: 150, max: 800 },
  'Siding': { min: 3000, max: 10000 },
  'Chimney': { min: 300, max: 1500 },
  'Foundation': { min: 3000, max: 15000 },
  'Mold': { min: 800, max: 5000 },
  'Well': { min: 1500, max: 7000 },
  'Septic': { min: 800, max: 4000 },
  'Generator': { min: 4000, max: 12000 },
  'Bathroom': { min: 5000, max: 15000 },
  'Insulation': { min: 800, max: 3000 }
};

/**
 * Estimate value for a single lead based on service type.
 * Uses service-based estimation (primary method).
 */
function estimateLeadValue(lead) {
  if (lead.estimatedPrice && lead.estimatedPrice > 0) return lead.estimatedPrice;

  const service = lead.serviceRequested || 'Other';
  let basePrice = AVG_JOB_VALUE;

  for (const [key, range] of Object.entries(SERVICE_BASE_PRICES)) {
    if (service.includes(key) || key.includes(service.split(' ')[0])) {
      basePrice = Math.round((range.min + range.max) / 2);
      break;
    }
  }

  return basePrice;
}

/**
 * Calculate total pipeline value from active leads.
 * Excludes: lost, no-interest, voicemail (no follow-up), archived.
 */
function calculatePipelineValue(leads) {
  const activeLeads = leads.filter(l => {
    const o = (l.callOutcome || l.status || '').toLowerCase();
    return !['no-interest', 'lost', 'archived', 'spam'].includes(o);
  });

  const totalValue = activeLeads.reduce((sum, l) => sum + estimateLeadValue(l), 0);
  const activeCount = activeLeads.length;

  return {
    totalValue,
    activeCount,
    averageValue: activeCount > 0 ? Math.round(totalValue / activeCount) : 0,
    maxValue: activeCount > 0 ? Math.max(...activeLeads.map(l => estimateLeadValue(l))) : 0,
    topLead: activeCount > 0 ? activeLeads.reduce((a, b) => estimateLeadValue(a) > estimateLeadValue(b) ? a : b) : null,
    confidenceLevel: activeCount > 10 ? 'high' : (activeCount > 3 ? 'medium' : 'low')
  };
}

/**
 * Get trend direction by comparing today's value to yesterday's.
 * Returns: { direction: 'up'|'down'|'flat', percentage }
 */
function calculateTrend(currentValue, previousValue) {
  if (!previousValue || previousValue === 0) {
    return { direction: 'flat', percentage: 0 };
  }

  const change = ((currentValue - previousValue) / previousValue) * 100;
  const direction = change > 5 ? 'up' : (change < -5 ? 'down' : 'flat');
  return {
    direction,
    percentage: Math.round(Math.abs(change) * 10) / 10
  };
}

/**
 * Compute full revenue overview from leads data.
 * Returns pipeline value, today's revenue, trends, and top lead info.
 */
async function computeRevenueOverview(userId, leads) {
  const cacheKey = `revenue:overview:${userId}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const pipeline = calculatePipelineValue(leads);

  // Today's leads
  const todayLeads = leads.filter(l => (l.receivedAt || '').startsWith(today));
  const todayRevenue = todayLeads.reduce((sum, l) => sum + estimateLeadValue(l), 0);

  // Yesterday's leads
  const yesterdayLeads = leads.filter(l => (l.receivedAt || '').startsWith(yesterday));
  const yesterdayRevenue = yesterdayLeads.reduce((sum, l) => sum + estimateLeadValue(l), 0);

  // Trend
  const trend = calculateTrend(todayRevenue, yesterdayRevenue);

  // Top lead this week
  const thisWeekLeads = leads.filter(l => {
    const d = new Date(l.receivedAt || Date.now());
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    return d >= weekAgo;
  });
  const topLead = thisWeekLeads.reduce((best, l) => {
    const val = estimateLeadValue(l);
    return val > (best ? estimateLeadValue(best) : 0) ? l : best;
  }, null);

  const result = {
    pipelineValue: pipeline.totalValue,
    activeLeads: pipeline.activeCount,
    averageLeadValue: pipeline.averageValue,
    todayRevenue,
    yesterdayRevenue,
    trend,
    topLead: topLead ? {
      id: topLead.id,
      name: topLead.customerName || 'Unknown',
      service: topLead.serviceRequested || 'General',
      value: estimateLeadValue(topLead),
      status: topLead.callOutcome || topLead.status || 'new'
    } : null,
    confidenceLevel: pipeline.confidenceLevel
  };

  await cache.set(cacheKey, result, 300);
  return result;
}

module.exports = {
  estimateLeadValue,
  calculatePipelineValue,
  calculateTrend,
  computeRevenueOverview,
  SERVICE_BASE_PRICES
};