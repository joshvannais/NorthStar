/**
 * Optional in-process acceleration cache.
 *
 * PostgreSQL is always authoritative. Redis is intentionally not loaded or
 * required for Mission 19 Part 3. Cache failures and disabled caching affect
 * latency only; callers must always be able to fetch the same database value.
 */
'use strict';

const crypto = require('crypto');

const memoryCache = new Map();
const KEY_PREFIX = 'northstar:cache:v2:';
const REQUIRED_CANONICAL_IDENTITY = Object.freeze([
  'organizationId', 'userId', 'sessionId', 'endpoint', 'filters', 'readModelVersion',
]);
const TTL_CONFIG = Object.freeze({
  routing: 60,
  org: 60,
  'analytics:overview': 300,
  'analytics:trends': 300,
  canonical: 30,
  default: 60,
});

let cacheEnabled = process.env.CANONICAL_CACHE_DISABLED !== 'true';

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce(function (result, key) {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function init() {
  console.log('[Cache] Redis is not required; optional in-process acceleration is ' + (cacheEnabled ? 'enabled' : 'disabled'));
  return false;
}

function isAvailable() {
  return cacheEnabled;
}

function isRedisAvailable() {
  return false;
}

function getTTL(keyType) {
  return TTL_CONFIG[keyType] || TTL_CONFIG.default;
}

function buildKey(type, id) {
  return KEY_PREFIX + String(type) + ':' + String(id);
}

function buildCanonicalKey(identity, generation) {
  const source = identity && typeof identity === 'object' ? identity : {};
  const missing = REQUIRED_CANONICAL_IDENTITY.filter(function (field) {
    return source[field] === undefined || source[field] === null || source[field] === '';
  });
  if (missing.length) throw new TypeError('canonical cache identity missing: ' + missing.join(', '));
  return KEY_PREFIX + 'canonical:' + digest({
    organizationId: String(source.organizationId),
    organizationGeneration: generation === undefined ? 0 : generation,
    userId: String(source.userId),
    sessionId: String(source.sessionId),
    endpoint: String(source.endpoint),
    filters: stableValue(source.filters),
    readModelVersion: String(source.readModelVersion),
  });
}

async function get(key) {
  if (!cacheEnabled) return null;
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return clone(entry.value);
}

async function set(key, value, ttlSeconds) {
  if (!cacheEnabled) return false;
  const ttl = ttlSeconds === undefined || ttlSeconds === null ? getTTL('default') : Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) return false;
  memoryCache.set(key, { value: clone(value), expiresAt: Date.now() + (ttl * 1000) });
  if (memoryCache.size > 5000) {
    const now = Date.now();
    for (const [candidate, entry] of memoryCache) {
      if (now >= entry.expiresAt) memoryCache.delete(candidate);
    }
  }
  return true;
}

async function del(key) {
  memoryCache.delete(key);
}

async function invalidateOrg(organizationId) {
  const marker = String(organizationId);
  for (const [key, entry] of memoryCache) {
    if (entry.organizationId === marker) memoryCache.delete(key);
  }
  for (const type of ['routing', 'org', 'analytics:overview', 'analytics:trends', 'ai:agent', 'integrations:status']) {
    memoryCache.delete(buildKey(type, marker));
  }
}

async function setCanonical(identity, value, ttlSeconds, expectedGeneration) {
  void identity;
  void value;
  void ttlSeconds;
  void expectedGeneration;
  return false;
}

async function wrapCanonical(identity, fetchFn, ttlSeconds) {
  if (typeof fetchFn !== 'function') throw new TypeError('fetchFn is required');
  void identity;
  void ttlSeconds;
  return fetchFn();
}

async function incr(key, ttlSeconds = 60) {
  const now = Date.now();
  const entry = memoryCache.get(key) || { count: 0, expiresAt: now + ttlSeconds * 1000 };
  if (now >= entry.expiresAt) {
    entry.count = 0;
    entry.expiresAt = now + ttlSeconds * 1000;
  }
  entry.count += 1;
  memoryCache.set(key, entry);
  return entry.count;
}

async function wrap(key, fetchFn, ttlSeconds) {
  if (!cacheEnabled) return fetchFn();
  const cached = await get(key);
  if (cached !== null) return cached;
  const value = await fetchFn();
  if (value !== null && value !== undefined) await set(key, value, ttlSeconds);
  return value;
}

function setEnabled(enabled) {
  cacheEnabled = Boolean(enabled);
  if (!cacheEnabled) memoryCache.clear();
}

function clearForTests() {
  memoryCache.clear();
}

module.exports = {
  REQUIRED_CANONICAL_IDENTITY,
  buildCanonicalKey,
  buildKey,
  clearForTests,
  del,
  get,
  incr,
  init,
  invalidateOrg,
  isAvailable,
  isRedisAvailable,
  set,
  setCanonical,
  setEnabled,
  wrap,
  wrapCanonical,
};
