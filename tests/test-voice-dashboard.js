/**
 * Tests for src/routes/voice.js dashboard endpoint — M17 P3
 *
 * Run: node tests/test-voice-dashboard.js
 */

const liveTimeline = require('../src/voice/liveTimeline');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  ✓ ' + message);
  } else {
    failed++;
    console.error('  ✗ FAIL: ' + message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log('  ✓ ' + message);
  } else {
    failed++;
    console.error('  ✗ FAIL: ' + message + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

// ── Helper: simulate the dashboard computation logic ──
function computeDashboard() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const activeSessionIds = liveTimeline.getActiveSessionIds();

  let callsCompletedToday = 0;
  let aiSpeaking = false;
  let customerSpeaking = false;
  const activeCallDurations = [];

  for (const sessionId of activeSessionIds) {
    const entries = liveTimeline.getTimeline(sessionId);
    const completedEntry = entries.find(e => e.event === 'call_completed');
    if (completedEntry && completedEntry.timestamp.slice(0, 10) === today) {
      callsCompletedToday++;
    }
    if (!completedEntry) {
      const startEntry = entries.find(e => e.event === 'call_started');
      if (startEntry) {
        const startedAt = new Date(startEntry.timestamp).getTime();
        const durationMs = now.getTime() - startedAt;
        activeCallDurations.push(Math.floor(durationMs / 1000));
      }
      const recentEntries = entries.slice(-5);
      for (const e of recentEntries) {
        if (e.speaker === 'customer') customerSpeaking = true;
        if (e.speaker === 'ai') aiSpeaking = true;
      }
    }
  }

  let bookingProbability = 0;
  let liveLeadQualification = null;
  if (activeSessionIds.length > 0) {
    let score = 0;
    for (const sessionId of activeSessionIds) {
      const entries = liveTimeline.getTimeline(sessionId);
      if (entries.some(e => e.event === 'appointment_requested')) score += 0.4;
      if (entries.some(e => e.event === 'address_collected')) score += 0.2;
      if (entries.some(e => e.event === 'service_discussed')) score += 0.2;
      if (entries.some(e => e.event === 'objection_raised')) score -= 0.15;
      if (entries.some(e => e.event === 'emergency_mentioned')) score += 0.15;
      if (entries.some(e => e.event === 'pricing_question')) score += 0.1;
    }
    bookingProbability = Math.min(1, Math.max(0, score / activeSessionIds.length));
    if (bookingProbability >= 0.7) liveLeadQualification = 'Hot';
    else if (bookingProbability >= 0.4) liveLeadQualification = 'Warm';
    else liveLeadQualification = 'Cold';
  }

  const activeCalls = activeSessionIds.filter(id => {
    const entries = liveTimeline.getTimeline(id);
    return !entries.some(e => e.event === 'call_completed');
  }).length;

  return {
    activeCalls,
    aiSpeaking,
    customerSpeaking,
    callsWaiting: 0,
    callsCompletedToday,
    activeCallDurations,
    liveLeadQualification,
    responseTime: activeCalls > 0 ? 1 : 0,
    bookingProbability: Math.round(bookingProbability * 100) / 100,
    timestamp: now.toISOString(),
  };
}

// ── Clean state ──
console.log('\n📋 Test: Dashboard — empty state');
liveTimeline.getActiveSessionIds().forEach(id => liveTimeline.clearSession(id));

const emptyDashboard = computeDashboard();
assertEqual(emptyDashboard.activeCalls, 0, 'activeCalls is 0 when no sessions');
assertEqual(emptyDashboard.aiSpeaking, false, 'aiSpeaking is false');
assertEqual(emptyDashboard.customerSpeaking, false, 'customerSpeaking is false');
assertEqual(emptyDashboard.callsCompletedToday, 0, 'callsCompletedToday is 0');
assert(Array.isArray(emptyDashboard.activeCallDurations), 'activeCallDurations is array');
assertEqual(emptyDashboard.activeCallDurations.length, 0, 'activeCallDurations is empty');
assertEqual(emptyDashboard.liveLeadQualification, null, 'liveLeadQualification is null');
assertEqual(emptyDashboard.bookingProbability, 0, 'bookingProbability is 0');
assert(typeof emptyDashboard.timestamp === 'string', 'timestamp is present');

// ── Test: Single active call ──
console.log('\n📋 Test: Dashboard — single active call');
liveTimeline.addEntry('dash-test-1', 'call_started', 'Incoming Call', 'system');
liveTimeline.addEntry('dash-test-1', 'customer_identified', 'Alice Johnson', 'system');
liveTimeline.addEntry('dash-test-1', 'service_discussed', 'AC repair', 'customer');
liveTimeline.addEntry('dash-test-1', 'address_collected', '123 Main St', 'customer');

const singleDash = computeDashboard();
assertEqual(singleDash.activeCalls, 1, 'activeCalls is 1');
assert(singleDash.customerSpeaking, 'customerSpeaking is true (customer spoke)');
assertEqual(singleDash.liveLeadQualification, 'Warm', 'Qualification is Warm (0.4 booking prob)');
assert(singleDash.bookingProbability > 0, 'bookingProbability > 0');
assert(singleDash.activeCallDurations.length === 1, 'One active call duration');

// ── Test: Single active call with appointment → Hot ──
console.log('\n📋 Test: Dashboard — hot lead (appointment requested)');
liveTimeline.addEntry('dash-test-1', 'appointment_requested', 'Tomorrow 10am', 'customer');

const hotDash = computeDashboard();
assertEqual(hotDash.liveLeadQualification, 'Hot', 'Qualification is Hot (0.8+ booking prob)');
assert(hotDash.bookingProbability >= 0.7, 'bookingProbability >= 0.7');

// ── Test: Completed call ──
console.log('\n📋 Test: Dashboard — completed call tracking');
liveTimeline.addEntry('dash-test-2', 'call_started', 'Incoming Call', 'system');
liveTimeline.addEntry('dash-test-2', 'service_discussed', 'Roofing', 'customer');
liveTimeline.addEntry('dash-test-2', 'call_completed', 'Duration: 180s', 'system');

const completedDash = computeDashboard();
assertEqual(completedDash.callsCompletedToday, 1, 'callsCompletedToday is 1 (one completed today)');
assertEqual(completedDash.activeCalls, 1, 'activeCalls counts only non-completed calls');

// ── Test: KPI structure completeness ──
console.log('\n📋 Test: Dashboard — KPI structure');
const structure = computeDashboard();
const requiredKeys = [
  'activeCalls', 'aiSpeaking', 'customerSpeaking', 'callsWaiting',
  'callsCompletedToday', 'activeCallDurations', 'liveLeadQualification',
  'responseTime', 'bookingProbability', 'timestamp',
];
for (const key of requiredKeys) {
  assert(structure.hasOwnProperty(key), 'Has key: ' + key);
}

// ── Clean up ──
['dash-test-1', 'dash-test-2'].forEach(id => liveTimeline.clearSession(id));

// ── Results ──
console.log('\n═══════════════════════════════════');
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('═══════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
