/**
 * Simulation Session Registry
 *
 * Tracks which canonical records (customers, communications, opportunities,
 * estimates) belong to which simulation session. Used by the Polaris API
 * endpoints to filter simulated records by sessionId, so page reloads
 * produce a clean state while real records are always visible.
 */

var _sessionRecords = new Map(); // sessionId -> Set of record IDs

module.exports = {
  register: function(sessionId, recordId) {
    if (!sessionId || !recordId) return;
    if (!_sessionRecords.has(sessionId)) _sessionRecords.set(sessionId, new Set());
    _sessionRecords.get(sessionId).add(recordId);
  },
  isInSession: function(recordId, sessionId) {
    var set = _sessionRecords.get(sessionId);
    return set ? set.has(recordId) : false;
  },
  getAllSessionRecordIds: function() {
    var all = new Set();
    _sessionRecords.forEach(function(ids) { ids.forEach(function(id) { all.add(id); }); });
    return all;
  },
};
