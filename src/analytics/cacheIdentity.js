'use strict';

const crypto = require('crypto');
const demoScope = require('../services/demoRecordScope');

const TENANT_SESSION = 'tenant';

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value == null ? '' : String(value);
  return Object.keys(value).sort().reduce((result, key) => {
    if (/^(?:organizationId|organization_id|orgId)$/i.test(key)) return result;
    result[key] = stableObject(value[key]);
    return result;
  }, {});
}

function createAnalyticsIdentity(req, endpoint, filters) {
  const organizationId = req && req.orgId;
  const user = (req && req.user) || {};
  const userId = user.sub || user.id;
  if (!organizationId || !userId) {
    throw new Error('Persisted analytics identity is unavailable');
  }

  const access = demoScope.createAccessContext(req);
  const dimensions = {
    version: 2,
    organizationId: String(organizationId),
    userId: String(userId),
    simulationSessionId: access.sessionId ? String(access.sessionId) : TENANT_SESSION,
    endpoint: String(endpoint || 'unknown'),
    filters: stableObject(filters || {})
  };
  const serialized = JSON.stringify(dimensions);
  return Object.freeze({
    dimensions: Object.freeze(dimensions),
    key: crypto.createHash('sha256').update(serialized).digest('hex')
  });
}

function cacheKey(cache, type, identity) {
  return cache.buildKey(type, identity.key);
}

module.exports = {
  TENANT_SESSION,
  createAnalyticsIdentity,
  cacheKey,
  stableObject
};
