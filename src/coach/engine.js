/**
 * NorthStar Coach Engine (V5-07)
 * 
 * Evaluates 6 priority conditions in order and returns the first matching
 * recommendation. Each recommendation is data-driven and actionable.
 *
 * Priority order:
 * 1. No leads today → "Welcome / activation"
 * 2. Unanswered calls → "Check forwarding"
 * 3. Low conversion rate → "Auto-schedule estimates"
 * 4. Old leads not contacted → "Follow up now"
 * 5. No appointments today → "Enable scheduling"
 * 6. All good → "Keep it up"
 */

/**
 * Evaluate conditions and return the first matching recommendation.
 *
 * @param {Object} metrics - { callsToday, callsAnswered, leadsToday, appointmentsScheduled, conversionRate, oldLeadsCount, callsMissed }
 * @param {string} [businessName]
 * @returns {{ type: string, priority: number, title: string, message: string, action: string|null }}
 */
function evaluate(metrics, businessName) {
  const name = businessName || 'your business';

  // Priority 1: No leads today — activation needed
  if (metrics.leadsToday === 0 && metrics.callsToday > 0) {
    return {
      type: 'activation',
      priority: 1,
      title: '📋 Leads coming in but none captured',
      message: `${name} received calls today but no leads were captured. Check your AI greeting script and ensure it's asking callers for their name, phone, and service details.`,
      action: 'Review AI Settings'
    };
  }

  // Priority 2: Unanswered/missed calls
  if (metrics.callsMissed && metrics.callsMissed > 0) {
    return {
      type: 'call_coverage',
      priority: 2,
      title: '📞 Missed calls detected',
      message: `NorthStar missed ${metrics.callsMissed} call(s) today. Check your phone forwarding setup to ensure calls reach the AI.`,
      action: 'Check Call Routing'
    };
  }

  // Priority 3: Low conversion rate
  if (metrics.conversionRate !== null && metrics.conversionRate !== undefined &&
      metrics.conversionRate < 30 && metrics.leadsToday >= 3) {
    return {
      type: 'conversion',
      priority: 3,
      title: '📈 Improve your lead conversion',
      message: `Only ${metrics.conversionRate}% of leads are converting to estimates. Contractors who auto-schedule within 5 minutes convert 7x more.`,
      action: 'Enable Auto-Scheduling'
    };
  }

  // Priority 4: Old leads not contacted
  if (metrics.oldLeadsCount && metrics.oldLeadsCount > 2) {
    return {
      type: 'follow_up',
      priority: 4,
      title: '⏰ Leads waiting for follow-up',
      message: `You have ${metrics.oldLeadsCount} leads from previous days that haven't been followed up. Follow up within 24 hours for best results.`,
      action: 'View Leads'
    };
  }

  // Priority 5: No appointments today
  if (metrics.appointmentsScheduled === 0 && metrics.leadsToday > 0) {
    return {
      type: 'scheduling',
      priority: 5,
      title: '📅 No appointments booked today',
      message: `You have ${metrics.leadsToday} new lead(s) but no appointments scheduled. Enable automatic estimate scheduling to book more jobs.`,
      action: 'Enable Scheduling'
    };
  }

  // Priority 6: All good
  return {
    type: 'all_good',
    priority: 6,
    title: '✅ Everything looks good',
    message: `NorthStar is handling calls and capturing leads for ${name}. Keep up the great work!`,
    action: null
  };
}

/**
 * Generate a secondary insight based on additional metrics.
 */
function secondaryInsight(metrics) {
  if (metrics.callsToday > 10) {
    return { type: 'volume', message: `High call volume today — ${metrics.callsToday} calls. Consider extending hours if you're seeing after-hours activity.` };
  }
  if (metrics.avgCallLength && metrics.avgCallLength > 300) {
    return { type: 'call_length', message: `Calls averaging ${Math.round(metrics.avgCallLength / 60)} minutes. AI may need more efficient scripting.` };
  }
  return null;
}

module.exports = { evaluate, secondaryInsight };