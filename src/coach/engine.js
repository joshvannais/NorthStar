/**
 * Coach Evaluation Engine (V5-07) — Phase 3 Remediation C6
 * 
 * 6-priority evaluation system. Returns primary + secondary insight.
 * Checks priorities in order and returns the first match.
 * 
 * Priority order:
 *   1. Missed calls > 3 in last hour
 *   2. Low lead conversion rate (< 20%)
 *   3. No customer activity for 2+ days
 *   4. Pipeline gap (weighted value < target)
 *   5. Unresponded leads (no follow-up in 24h)
 *   6. Underperforming service line
 */

function evaluate(metrics) {
  const primary = checkPriorities(metrics, 1);
  const secondary = checkPriorities(metrics, primary ? primary.priority + 1 : 1);
  return {
    primary: primary || { type: 'all_good', priority: 6, title: 'Everything looks good', message: 'Your business is running smoothly. NorthStar is handling calls and capturing leads. Keep up the great work!', action: null },
    secondary
  };
}

function checkPriorities(metrics, startFrom) {
  for (let p = startFrom; p <= 6; p++) {
    const result = evaluatePriority(p, metrics);
    if (result) return result;
  }
  return null;
}

function evaluatePriority(priority, metrics) {
  switch (priority) {
    case 1:
      if (metrics.callsMissedLastHour && metrics.callsMissedLastHour > 3) {
        return { type: 'missed_calls', priority: 1, title: `📞 ${metrics.callsMissedLastHour} missed calls in the last hour`, message: `${metrics.callsMissedLastHour} calls were missed in the past hour. Check your phone forwarding and ensure your NorthStar number is properly configured to answer calls.`, action: 'Check Call Routing' };
      }
      return null;
    case 2:
      if (metrics.leadsConverted !== null && metrics.leadsConverted !== undefined && metrics.leadsCaptured > 0) {
        const rate = metrics.leadsCaptured > 0 ? Math.round((metrics.leadsConverted / metrics.leadsCaptured) * 100) : 0;
        if (rate < 20) {
          return { type: 'low_conversion', priority: 2, title: `📈 Lead conversion rate is ${rate}%`, message: `Only ${rate}% of leads are converting to booked jobs. The industry benchmark is 35-50%. Enable automatic estimate scheduling to improve conversion.`, action: 'Enable Auto-Scheduling' };
        }
      }
      return null;
    case 3:
      if (metrics.lastActivityDays !== null && metrics.lastActivityDays !== undefined && metrics.lastActivityDays >= 2) {
        return { type: 'no_activity', priority: 3, title: `⏸️ No activity for ${metrics.lastActivityDays} days`, message: `It's been ${metrics.lastActivityDays} days since your last customer call. Make sure your forwarding number is still active and your AI settings are correct.`, action: 'Check AI Settings' };
      }
      return null;
    case 4:
      if (metrics.pipelineWeightedValue !== null && metrics.pipelineWeightedValue !== undefined && metrics.pipelineTarget !== null && metrics.pipelineTarget !== undefined && metrics.pipelineWeightedValue < metrics.pipelineTarget) {
        const gap = Math.round(metrics.pipelineTarget - metrics.pipelineWeightedValue);
        return { type: 'pipeline_gap', priority: 4, title: `💰 Pipeline value below target by $${gap.toLocaleString()}`, message: `Your weighted pipeline value of $${Math.round(metrics.pipelineWeightedValue).toLocaleString()} is below your target of $${Math.round(metrics.pipelineTarget).toLocaleString()}. Consider reaching out to past leads or adjusting your service offerings.`, action: 'View Pipeline' };
      }
      return null;
    case 5:
      if (metrics.unrespondedLeads && metrics.unrespondedLeads > 0) {
        return { type: 'unresponded_leads', priority: 5, title: `⏰ ${metrics.unrespondedLeads} lead${metrics.unrespondedLeads !== 1 ? 's' : ''} need${metrics.unrespondedLeads === 1 ? 's' : ''} follow-up`, message: `${metrics.unrespondedLeads} lead${metrics.unrespondedLeads !== 1 ? 's' : ''} from previous day${metrics.unrespondedLeads !== 1 ? 's' : ''} haven't been contacted yet. Respond within 24 hours to maximize your chance of booking.`, action: 'View Leads' };
      }
      return null;
    case 6:
      if (metrics.servicePerformance && Array.isArray(metrics.servicePerformance)) {
        const sorted = [...metrics.servicePerformance].filter(s => s.count > 0).sort((a, b) => (a.revenue || 0) - (b.revenue || 0));
        if (sorted.length > 0 && sorted[0].revenue < 500) {
          const svc = sorted[0];
          return { type: 'underperforming_service', priority: 6, title: `🔧 ${svc.service} is underperforming`, message: `Your ${svc.service} service has generated only $${svc.revenue.toLocaleString()} from ${svc.count} lead${svc.count !== 1 ? 's' : ''}. Consider adjusting pricing or promoting this service more.`, action: 'Review Services' };
        }
      }
      return null;
    default: return null;
  }
}

module.exports = { evaluate };