'use strict';

/**
 * Durable ownership metadata for simulated records.
 *
 * Session ownership must live on every persisted record. The in-memory demo
 * registry is intentionally not authoritative because it is empty after a
 * process restart.
 */

const LEGACY_SESSION_ID = 'legacy-simulation';
let _legacyIndex = null;

function createMetadata(sessionId, extra) {
  return Object.assign({}, extra || {}, {
    recordScope: 'simulation',
    source: 'simulation',
    simulationSessionId: sessionId,
  });
}

function _buildLegacyIndex() {
  const customerIds = new Set();
  const recordIds = new Set();
  try {
    const store = require('../polaris/store');
    const records = store.getAllRecommendations() || [];

    records.forEach(function (wrapper) {
      const record = wrapper && wrapper.data;
      if (!record) return;
      const isSimulatedCall = wrapper.type === 'communication' &&
        typeof record.subject === 'string' &&
        record.subject.indexOf('Simulated call from ') === 0;
      if (isSimulatedCall && record.customerId) customerIds.add(record.customerId);
    });

    records.forEach(function (wrapper) {
      const record = wrapper && wrapper.data;
      if (!record) return;
      const customerId = record.customerId || (wrapper.type === 'customer' ? record.id : null);
      if (customerId && customerIds.has(customerId) && record.id) recordIds.add(record.id);
    });
  } catch (err) {
    // A missing store means there are no legacy records to classify.
  }
  return { customerIds: customerIds, recordIds: recordIds };
}

function _legacy() {
  if (!_legacyIndex) _legacyIndex = _buildLegacyIndex();
  return _legacyIndex;
}

function getSessionId(record) {
  if (!record) return null;
  const metadata = record.metadata || {};
  if (metadata.simulationSessionId) return metadata.simulationSessionId;
  if (record.simulationSessionId) return record.simulationSessionId;
  if (record.demoSessionId) return record.demoSessionId;
  const legacy = _legacy();
  if ((record.id && legacy.recordIds.has(record.id)) ||
      (record.customerId && legacy.customerIds.has(record.customerId))) {
    return LEGACY_SESSION_ID;
  }
  return null;
}

function isSimulation(record) {
  if (!record) return false;
  const metadata = record.metadata || {};
  return metadata.recordScope === 'simulation' || metadata.source === 'simulation' ||
    record.recordScope === 'simulation' || record.source === 'simulation' ||
    Boolean(getSessionId(record));
}

function canAccess(record, requestedSessionId) {
  if (!isSimulation(record)) return true;
  return Boolean(requestedSessionId) && getSessionId(record) === requestedSessionId;
}

function filterRecords(records, requestedSessionId) {
  return (Array.isArray(records) ? records : []).filter(function (record) {
    return canAccess(record, requestedSessionId);
  });
}

function resetLegacyIndexForTests() {
  _legacyIndex = null;
}

module.exports = {
  LEGACY_SESSION_ID,
  createMetadata,
  getSessionId,
  isSimulation,
  canAccess,
  filterRecords,
  resetLegacyIndexForTests,
};
