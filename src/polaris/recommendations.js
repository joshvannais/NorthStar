/**
 * Polaris Recommendation Engine — Actionable Intelligence
 *
 * Generates recommendations based on:
 *   - Pipeline bottlenecks
 *   - Overdue follow-ups
 *   - Capacity utilization
 *   - Revenue opportunities
 *   - Scheduling conflicts
 *   - Lost opportunity recovery
 *
 * Each recommendation has a type, priority, and action URL.
 * They can be consumed by the Dashboard, Calendar, or any page.
 */

const store = require('./store');

/**
 * Scan all data and generate recommendations.
 * Called periodically or on-demand.
 *
 * @param {object} data - { leads, events, jobs, crews } from the application
 * @returns {object[]} Array of new recommendations
 */
function generateRecommendations(data) {
  if (!data) return [];
  const recommendations = [];

  // ── 1. Follow-up Opportunities ──
  if (data.leads && data.leads.length > 0) {
    const needsFollowUp = data.leads.filter(l =>
      l.status === 'new' || l.status === 'contacted' || l.outcome === 'follow-up'
    );
    if (needsFollowUp.length > 0) {
      recommendations.push({
        type: 'follow_up',
        priority: needsFollowUp.length > 5 ? 'high' : needsFollowUp.length > 2 ? 'medium' : 'low',
        title: needsFollowUp.length + ' leads need follow-up',
        description: needsFollowUp.length + ' active leads have not been contacted recently. Prioritize follow-up to avoid losing opportunities.',
        actionUrl: '/dashboard/communications',
        sourceData: { count: needsFollowUp.length, leadIds: needsFollowUp.map(l => l.id) },
      });
    }
  }

  // ── 2. Pipeline Bottlenecks ──
  if (data.leads && data.leads.length > 0) {
    const stuck = data.leads.filter(l =>
      l.status === 'new' || l.status === 'contacted' || l.outcome === 'follow-up' || l.outcome === 'lead-captured'
    );
    const total = data.leads.length;
    const stuckPct = total > 0 ? Math.round((stuck.length / total) * 100) : 0;
    if (stuckPct > 60) {
      recommendations.push({
        type: 'pipeline_bottleneck',
        priority: 'high',
        title: 'Pipeline bottleneck detected — ' + stuckPct + '% of leads are stuck',
        description: stuck.length + ' out of ' + total + ' leads have not advanced past initial stages. Review your sales process.',
        actionUrl: '/dashboard/leads',
        sourceData: { stuckCount: stuck.length, totalLeads: total, stuckPercentage: stuckPct },
      });
    }
  }

  // ── 3. Capacity Warnings (from calendar events) ──
  if (data.events && data.events.length > 0) {
    const today = new Date().toISOString().split('T')[0];
    const todayEvents = data.events.filter(e => e.date === today);
    if (todayEvents.length > 6) {
      recommendations.push({
        type: 'capacity_warning',
        priority: 'high',
        title: 'Today is overbooked — ' + todayEvents.length + ' appointments',
        description: 'You have ' + todayEvents.length + ' appointments scheduled today. Consider rescheduling lower-priority appointments.',
        actionUrl: '/dashboard/calendar',
        sourceData: { date: today, appointmentCount: todayEvents.length },
      });
    }
  }

  // ── 4. High-Value Opportunities ──
  if (data.leads && data.leads.length > 0) {
    const highValue = data.leads
      .filter(l => parseFloat(l.avgPrice || l.estimated_price) > 1000)
      .sort((a, b) => (parseFloat(b.avgPrice || b.estimated_price) || 0) - (parseFloat(a.avgPrice || a.estimated_price) || 0))
      .slice(0, 3);
    if (highValue.length > 0) {
      recommendations.push({
        type: 'revenue_opportunity',
        priority: 'high',
        title: 'High-value opportunity: ' + highValue[0].caller_name || highValue[0].caller || 'Lead',
        description: 'A lead worth $' + Math.round(parseFloat(highValue[0].avgPrice || highValue[0].estimated_price) || 0).toLocaleString() + ' needs attention. Prioritize this opportunity.',
        actionUrl: '/dashboard/communications',
        sourceData: { lead: highValue[0] },
      });
    }
  }

  // ── 5. Scheduling Conflicts ──
  if (data.events && data.events.length > 0) {
    const timeCounts = {};
    data.events.forEach(e => {
      if (e.date && e.time) {
        const key = e.date + 'T' + e.time;
        timeCounts[key] = (timeCounts[key] || 0) + 1;
      }
    });
    const conflicts = Object.keys(timeCounts).filter(k => timeCounts[k] > 1);
    if (conflicts.length > 0) {
      recommendations.push({
        type: 'scheduling_conflict',
        priority: 'medium',
        title: conflicts.length + ' scheduling conflict' + (conflicts.length > 1 ? 's' : '') + ' detected',
        description: 'Multiple appointments overlap at the same time. Review and resolve conflicts.',
        actionUrl: '/dashboard/calendar',
        sourceData: { conflictCount: conflicts.length, conflicts: conflicts },
      });
    }
  }

  // ── 6. Lost Opportunity Recovery ──
  if (data.leads && data.leads.length > 0) {
    const lost = data.leads.filter(l => l.outcome === 'no-interest' || l.status === 'lost');
    if (lost.length > 0) {
      recommendations.push({
        type: 'lost_opportunity',
        priority: 'low',
        title: lost.length + ' lost lead' + (lost.length > 1 ? 's' : '') + ' — consider re-engagement',
        description: 'Review lost leads to identify patterns and potentially re-engage with a different approach.',
        actionUrl: '/dashboard/leads',
        sourceData: { count: lost.length },
      });
    }
  }

  // ── 7. Peak Performance Times (from completed jobs) ──
  if (data.jobs && data.jobs.length > 3) {
    const fastJobs = data.jobs.filter(j => parseFloat(j.durationVariance) < -0.5);
    if (fastJobs.length > 0) {
      recommendations.push({
        type: 'schedule_optimization',
        priority: 'low',
        title: 'Schedule optimization opportunity',
        description: fastJobs.length + ' jobs completed faster than estimated. Review what made them efficient and replicate.',
        actionUrl: '/dashboard/calendar',
        sourceData: { fastJobCount: fastJobs.length },
      });
    }
  }

  // Persist recommendations
  recommendations.forEach(r => {
    try {
      r.metadata = data.metadata ? Object.assign({}, data.metadata) : {};
      store.addRecommendation(r);
    } catch (e) {
      console.warn('[PolarisRecommendations] Failed to persist:', e.message);
    }
  });

  return recommendations;
}

/**
 * Get all recommendations, optionally filtered by status.
 */
function getRecommendations(resolved) {
  if (resolved === true) return store.getAllRecommendations().filter(r => r.resolved);
  if (resolved === false) return store.getUnresolvedRecommendations();
  return store.getAllRecommendations();
}

/**
 * Mark a recommendation as resolved.
 */
function resolve(id) {
  return store.resolveRecommendation(id);
}

module.exports = {
  generateRecommendations,
  getRecommendations,
  resolve,
};
