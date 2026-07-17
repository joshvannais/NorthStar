/**
 * Live Customer Timeline — Part 5: M17 Phase 3
 *
 * Manages in-memory timeline entries for active voice sessions.
 * Populated by EventBus handlers and exposed via timeline endpoint.
 */

const timelineStore = new Map();

const STANDARD_EVENTS = [
  'call_started',
  'customer_identified',
  'emergency_mentioned',
  'address_collected',
  'service_discussed',
  'appointment_requested',
  'pricing_question',
  'objection_raised',
  'call_completed',
  'escalation_triggered',
  'human_handoff',
];

/**
 * Add a timeline entry for a session.
 * @param {string} sessionId
 * @param {string} event - One of the standard events
 * @param {string} detail - Human-readable detail
 * @param {'customer'|'ai'|'system'|null} [speaker=null]
 * @returns {object} The created entry
 */
function addEntry(sessionId, event, detail, speaker) {
  if (!sessionId || !event) {
    throw new Error('sessionId and event are required');
  }

  const entry = {
    timestamp: new Date().toISOString(),
    event,
    detail: detail || '',
    speaker: speaker || null,
  };

  if (!timelineStore.has(sessionId)) {
    timelineStore.set(sessionId, []);
  }
  timelineStore.get(sessionId).push(entry);

  return entry;
}

/**
 * Get all timeline entries for a session, sorted by timestamp.
 * @param {string} sessionId
 * @returns {object[]} Array of timeline entries
 */
function getTimeline(sessionId) {
  const entries = timelineStore.get(sessionId);
  if (!entries) return [];
  return [...entries].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Clear all timeline entries for a session.
 * @param {string} sessionId
 */
function clearSession(sessionId) {
  timelineStore.delete(sessionId);
}

/**
 * Get all active sessions with timeline entries.
 * @returns {string[]} Array of session IDs
 */
function getActiveSessionIds() {
  return Array.from(timelineStore.keys());
}

/**
 * Get the count of active sessions.
 * @returns {number}
 */
function getActiveSessionCount() {
  return timelineStore.size;
}

/**
 * Get the raw store (for dashboard aggregation).
 * @returns {Map}
 */
function getStore() {
  return timelineStore;
}

module.exports = {
  addEntry,
  getTimeline,
  clearSession,
  getActiveSessionIds,
  getActiveSessionCount,
  getStore,
  STANDARD_EVENTS,
};
