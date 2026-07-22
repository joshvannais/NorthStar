/**
 * Simulation Session Registry
 *
 * Tracks which canonical records (customers, communications, opportunities,
 * estimates) belong to which simulation session. Used by the Polaris API
 * endpoints to filter simulated records by sessionId, ensuring that page
 * reloads produce a clean state while real records (no session) are always visible.
 */

// sessionId → Set of record IDs
const _sessionRecords = new Map();

module.exports = {
  /**
   * Register a record ID with a simulation session.
   * @param {string} sessionId
   * @param {string} recordId
   */
  register(sessionId, recordId) {
    if (!sessionId || !recordId) return;
    if (!_sessionRecords.has(sessionId)) {
      _sessionRecords.set(sessionId, new Set());
    }
    _sessionRecords.get(sessionId).add(recordId);
  },

  /**
   * Check if a record belongs to a specific session.
   * @param {string} recordId
   * @param {string} sessionId
   * @returns {boolean}
   */
  isInSession(recordId, sessionId) {
    const set = _sessionRecords.get(sessionId);
    return set ? set.has(recordId) : false;
  },

  /**
   * Get all record IDs that belong to ANY simulation session.
   * Records NOT in this set are real/non-simulated and always visible.
   * @returns {Set<string>}
   */
  getAllSessionRecordIds() {
    const all = new Set();
    for (const ids of _sessionRecords.values()) {
      for (const id of ids) {
        all.add(id);
      }
    }
    return all;
  },
};
