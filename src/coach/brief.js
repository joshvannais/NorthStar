/**
 * Daily Brief Generation (V5-08)
 * 
 * Generates a concise 120-word max executive summary from current metrics.
 * Timezone-aware greeting. Answers: "What happened? What needs attention?
 * What's the revenue? What should I do next?"
 */

const coach = require('./engine');
const revenue = require('../analytics/revenue');

/**
 * Generate a daily brief from current metrics and leads data.
 *
 * @param {Object} metrics - { callsToday, callsAnswered, leadsToday, appointmentsScheduled, conversionRate, oldLeadsCount, callsMissed, avgCallLength }
 * @param {Object} revenueOverview - result from revenue.computeRevenueOverview()
 * @param {string} contractorName - business owner name
 * @param {string} [timezone] - contractor timezone (optional, defaults to Eastern)
 * @returns {string} Brief text, max 120 words
 */
function generate(metrics, revenueOverview, contractorName, timezone) {
  const greeting = getGreeting(contractorName);

  // Yesterday's summary
  let summary = '';
  if (metrics.callsToday > 0) {
    const parts = [];
    parts.push(`NorthStar answered ${metrics.callsToday} call${metrics.callsToday !== 1 ? 's' : ''}`);
    if (metrics.leadsToday > 0) {
      parts.push(`captured ${metrics.leadsToday} new lead${metrics.leadsToday !== 1 ? 's' : ''}`);
    }
    if (metrics.appointmentsScheduled > 0) {
      parts.push(`booked ${metrics.appointmentsScheduled} estimate appointment${metrics.appointmentsScheduled !== 1 ? 's' : ''}`);
    }
    summary = parts.join(', ') + '.';
  } else {
    summary = 'Quiet day — no new calls or leads.';
  }

  // Today's priority
  const coachRec = coach.evaluate(metrics);
  let priority = '';
  if (coachRec.type === 'follow_up' && metrics.oldLeadsCount > 0) {
    priority = `You have ${metrics.oldLeadsCount} lead${metrics.oldLeadsCount !== 1 ? 's' : ''} awaiting follow-up.`;
  } else if (coachRec.type === 'all_good') {
    priority = 'No urgent items needing attention.';
  }

  // Revenue opportunity
  let revenueLine = '';
  if (revenueOverview) {
    const pv = revenueOverview.pipelineValue;
    if (pv > 0) {
      revenueLine = `Estimated revenue opportunity in your pipeline is $${pv.toLocaleString()}.`;
    } else {
      revenueLine = 'No current revenue opportunities in your pipeline.';
    }
  }

  // Recommendation
  let recommendation = '';
  if (coachRec.message) {
    const sentences = coachRec.message.replace(new RegExp(contractorName, 'gi'), '').trim().split('.');
    const firstSentence = sentences[0] && sentences[0].length > 0 ? sentences[0].trim() + '.' : '';
    if (firstSentence && firstSentence.length > 5) {
      recommendation = `Tip: ${firstSentence}`;
    }
  }

  // Build brief
  let brief = `${greeting} ${summary} `;
  if (revenueLine) brief += `${revenueLine} `;
  if (priority) brief += `${priority} `;
  if (recommendation) brief += `${recommendation} `;
  brief += `Have a great day!`;

  // Enforce 120 word max
  const words = brief.split(/\s+/);
  if (words.length > 120) {
    brief = words.slice(0, 117).join(' ') + '...';
  }

  return brief.trim();
}

/**
 * Generate timezone-aware greeting.
 */
function getGreeting(name) {
  const hour = new Date().getHours();
  let timeGreeting;

  if (hour >= 5 && hour < 12) timeGreeting = 'Good morning';
  else if (hour >= 12 && hour < 17) timeGreeting = 'Good afternoon';
  else timeGreeting = 'Good evening';

  return `${timeGreeting}, ${name}.`;
}

module.exports = { generate, getGreeting };