/**
 * Daily Brief Generator (V5-08) — Phase 3 Remediation C7
 * 3-paragraph structure, max 120 words, omits zero-value stats.
 */

const coach = require('./engine');

function generate(metrics, contractorName) {
  const name = contractorName || 'there';
  const greeting = getGreeting();
  const summaryParts = [];

  if (metrics.callsToday > 0) summaryParts.push(`${metrics.callsToday} call${metrics.callsToday !== 1 ? 's were' : ' was'} answered`);
  if (metrics.leadsToday > 0) summaryParts.push(`${metrics.leadsToday} new lead${metrics.leadsToday !== 1 ? 's were' : ' was'} captured`);
  if (metrics.appointmentsScheduled > 0) summaryParts.push(`${metrics.appointmentsScheduled} appointment${metrics.appointmentsScheduled !== 1 ? 's were' : ' was'} booked`);

  let p1;
  if (summaryParts.length > 0) {
    const last = summaryParts.pop();
    const joined = summaryParts.length > 0 ? summaryParts.join(', ') + ' and ' + last : last;
    p1 = `${greeting} Yesterday ${joined}.`;
  } else {
    p1 = `${greeting} It was a quiet day — no new calls, leads, or appointments.`;
  }

  let p2;
  const revenuePart = metrics.revenueToday && metrics.revenueToday > 0
    ? `Your current opportunity is $${(metrics.revenueToday || metrics.pipelineWeightedValue || 0).toLocaleString()} in pipeline value.`
    : null;

  if (metrics.unrespondedLeads > 0) {
    p2 = `${metrics.unrespondedLeads} lead${metrics.unrespondedLeads !== 1 ? 's' : ''} from yesterday need${metrics.unrespondedLeads === 1 ? 's' : ''} your attention. `;
    if (revenuePart) p2 += revenuePart + ' ';
  } else if (revenuePart) {
    p2 = revenuePart + ' ';
  } else {
    p2 = null;
  }

  const coachRec = coach.evaluate(metrics);
  let p3;
  if (coachRec && coachRec.primary && coachRec.primary.type !== 'all_good') {
    p3 = coachRec.primary.message.split('.')[0].trim() + '.';
    if (coachRec.primary.action) p3 += ` Head to ${coachRec.primary.action} to get started.`;
  } else {
    p3 = 'Everything is running smoothly — NorthStar has you covered.';
  }

  const paragraphs = [p1];
  if (p2) paragraphs.push(p2);
  paragraphs.push(p3);

  let brief = paragraphs.join('\n\n');
  let words = brief.split(/\s+/);
  if (words.length > 120) brief = words.slice(0, 117).join(' ') + '...';

  return brief;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

module.exports = { generate, getGreeting };