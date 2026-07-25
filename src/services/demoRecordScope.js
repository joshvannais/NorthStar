'use strict';

/**
 * Durable ownership metadata for simulated records.
 *
 * Session ownership must live on every persisted record. The in-memory demo
 * registry is intentionally not authoritative because it is empty after a
 * process restart.
 */

const { AsyncLocalStorage } = require('async_hooks');
const requestAccess = new AsyncLocalStorage();

const LEGACY_SESSION_ID = 'legacy-simulation';
// Frozen IDs for the eight disposable fixtures committed before durable
// ownership metadata existed. Never infer simulation ownership from names or
// subjects: real tenant records can legitimately use the same text.
const LEGACY_FIXTURE_CUSTOMER_IDS = new Set([
  'cust_1784653727574_1',
  'cust_1784667527956_1',
  'cust_1784667534373_2',
  'cust_1784667545827_3',
  'cust_1784675358633_1',
  'cust_1784675369032_2',
  'cust_1784675372351_3',
  'cust_1784675372728_4',
]);
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

    LEGACY_FIXTURE_CUSTOMER_IDS.forEach(function (id) { customerIds.add(id); });

    records.forEach(function (wrapper) {
      const record = wrapper && wrapper.data;
      if (!record) return;
      const customerId = record.customerId || (wrapper.type === 'customer' ? record.id : null);
      if (customerId && customerIds.has(customerId) && record.id) {
        recordIds.add(record.id);
      }
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

function getOwnerUserId(record) {
  if (!record) return null;
  const metadata = record.metadata || {};
  return metadata.ownerUserId || metadata.owner_user_id ||
    record.ownerUserId || record.owner_user_id || null;
}

function getOrganizationId(record) {
  if (!record) return null;
  const metadata = record.metadata || {};
  return metadata.organizationId || metadata.organization_id ||
    record.organizationId || record.organization_id || null;
}

function createAccessContext(req, selectedSessionId) {
  const user = (req && req.user) || {};
  return {
    sessionId: selectedSessionId === undefined
      ? ((req && req.query && req.query.sessionId) || (req && req.body && req.body.sessionId) || null)
      : selectedSessionId,
    userId: user.sub || user.id || null,
    organizationId: (req && req.orgId) || user.organizationId || user.orgId || null,
    enforceOwner: true,
  };
}

function runWithAccess(req, callback) {
  return requestAccess.run(createAccessContext(req), callback);
}

function resolveAccess(selector) {
  if (selector && typeof selector === 'object') return selector;
  const active = requestAccess.getStore();
  if (!active) return { sessionId: selector, enforceOwner: false };
  return Object.assign({}, active, {
    sessionId: selector === undefined ? active.sessionId : selector,
    enforceOwner: true,
  });
}

function canAccess(record, selector) {
  const context = resolveAccess(selector);
  if (context.enforceOwner) {
    const organizationId = getOrganizationId(record);
    if (!context.organizationId || !organizationId ||
        String(organizationId) !== String(context.organizationId)) return false;
  }
  if (!isSimulation(record)) return true;
  if (!context.sessionId || getSessionId(record) !== context.sessionId) return false;
  if (!context.enforceOwner) return true;
  const ownerUserId = getOwnerUserId(record);
  if (!ownerUserId || !context.userId || String(ownerUserId) !== String(context.userId)) return false;
  return true;
}

function canAccessTenant(record, selector) {
  const context = resolveAccess(selector);
  if (!context.organizationId) return false;
  const organizationId = getOrganizationId(record);
  if (!organizationId ||
      String(organizationId) !== String(context.organizationId)) return false;
  return canAccess(record, selector);
}

function filterRecords(records, selector) {
  return (Array.isArray(records) ? records : []).filter(function (record) {
    return canAccess(record, selector);
  });
}

function filterTenantRecords(records, selector) {
  return (Array.isArray(records) ? records : []).filter(function (record) {
    return canAccessTenant(record, selector);
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
  getOwnerUserId,
  getOrganizationId,
  createAccessContext,
  runWithAccess,
  resolveAccess,
  canAccess,
  canAccessTenant,
  filterRecords,
  filterTenantRecords,
  resetLegacyIndexForTests,
};
