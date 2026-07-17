/**
 * Tests for src/voice/liveTimeline.js — M17 P3
 *
 * Run: node tests/test-liveTimeline.js
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

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed++;
    console.log('  ✓ ' + message);
  } else {
    failed++;
    console.error('  ✗ FAIL: ' + message + ' — expected ' + b + ', got ' + a);
  }
}

// ── Test: addEntry ──
console.log('\n📋 Test: addEntry');
try {
  // Clear any pre-existing state
  liveTimeline.clearSession('test-session-1');

  const entry = liveTimeline.addEntry('test-session-1', 'call_started', 'Incoming Call', 'system');
  assert(entry !== undefined, 'addEntry returns entry object');
  assertEqual(entry.event, 'call_started', 'Entry has correct event');
  assertEqual(entry.detail, 'Incoming Call', 'Entry has correct detail');
  assertEqual(entry.speaker, 'system', 'Entry has correct speaker');
  assert(typeof entry.timestamp === 'string', 'Entry has timestamp string');

  // Add more entries
  liveTimeline.addEntry('test-session-1', 'customer_identified', 'John Smith', 'system');
  liveTimeline.addEntry('test-session-1', 'service_discussed', 'Tree removal', 'customer');
  liveTimeline.addEntry('test-session-1', 'appointment_requested', 'Thursday morning', 'customer');

  const timeline = liveTimeline.getTimeline('test-session-1');
  assertEqual(timeline.length, 4, 'Timeline has 4 entries');

  // Verify entries are sorted by timestamp
  for (let i = 1; i < timeline.length; i++) {
    assert(new Date(timeline[i].timestamp) >= new Date(timeline[i-1].timestamp),
      'Entry ' + i + ' is chronologically after entry ' + (i-1));
  }
} catch(e) {
  failed++;
  console.error('  ✗ FAIL: addEntry threw: ' + e.message);
}

// ── Test: getTimeline (empty) ──
console.log('\n📋 Test: getTimeline (empty session)');
const empty = liveTimeline.getTimeline('nonexistent-session');
assertDeepEqual(empty, [], 'Returns empty array for nonexistent session');

// ── Test: clearSession ──
console.log('\n📋 Test: clearSession');
liveTimeline.addEntry('test-session-2', 'call_started', 'Outbound Call', 'system');
assertEqual(liveTimeline.getTimeline('test-session-2').length, 1, 'Has 1 entry before clear');
liveTimeline.clearSession('test-session-2');
assertEqual(liveTimeline.getTimeline('test-session-2').length, 0, 'Has 0 entries after clear');

// ── Test: getActiveSessionIds ──
console.log('\n📋 Test: getActiveSessionIds');
// Clean up any leftover sessions
liveTimeline.clearSession('test-session-1');
liveTimeline.clearSession('test-standard-events');
liveTimeline.addEntry('session-a', 'call_started', 'Incoming', 'system');
liveTimeline.addEntry('session-b', 'call_started', 'Incoming', 'system');
liveTimeline.addEntry('session-c', 'call_started', 'Outbound', 'system');

const ids = liveTimeline.getActiveSessionIds();
assert(ids.includes('session-a'), 'Includes session-a');
assert(ids.includes('session-b'), 'Includes session-b');
assert(ids.includes('session-c'), 'Includes session-c');
assertEqual(liveTimeline.getActiveSessionCount(), 3, 'Active count is 3');

// ── Test: Standard events ──
console.log('\n📋 Test: All standard events');
const STANDARD_EVENTS = liveTimeline.STANDARD_EVENTS;
const expectedEvents = [
  'call_started', 'customer_identified', 'emergency_mentioned',
  'address_collected', 'service_discussed', 'appointment_requested',
  'pricing_question', 'objection_raised', 'call_completed',
  'escalation_triggered', 'human_handoff',
];
assertDeepEqual(STANDARD_EVENTS, expectedEvents, 'All 11 standard events defined');

// Test each standard event
const eventSession = 'test-all-events';
liveTimeline.clearSession(eventSession);
for (const evt of STANDARD_EVENTS) {
  liveTimeline.addEntry(eventSession, evt, 'Detail for ' + evt, 'customer');
}
const allEntries = liveTimeline.getTimeline(eventSession);
assertEqual(allEntries.length, STANDARD_EVENTS.length,
  'All ' + STANDARD_EVENTS.length + ' standard events stored');

// ── Test: Multiple sessions ──
console.log('\n📋 Test: Multiple sessions isolation');
liveTimeline.clearSession('iso-a');
liveTimeline.clearSession('iso-b');

liveTimeline.addEntry('iso-a', 'call_started', 'Incoming A', 'system');
liveTimeline.addEntry('iso-b', 'call_started', 'Incoming B', 'system');
liveTimeline.addEntry('iso-a', 'service_discussed', 'Plumbing', 'customer');

assertEqual(liveTimeline.getTimeline('iso-a').length, 2, 'iso-a has 2 entries');
assertEqual(liveTimeline.getTimeline('iso-b').length, 1, 'iso-b has 1 entry');
assert(liveTimeline.getTimeline('iso-a')[1].detail === 'Plumbing', 'iso-a entries are isolated');

// ── Clean up ──
liveTimeline.clearSession('test-session-1');
liveTimeline.clearSession('test-session-2');
liveTimeline.clearSession('session-a');
liveTimeline.clearSession('session-b');
liveTimeline.clearSession('session-c');
liveTimeline.clearSession('test-standard-events');
liveTimeline.clearSession('test-all-events');
liveTimeline.clearSession('iso-a');
liveTimeline.clearSession('iso-b');

// ── Results ──
console.log('\n═══════════════════════════════════');
console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
console.log('═══════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
