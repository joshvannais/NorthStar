/**
 * Caching Layer
 * V3-22: Redis-backed cache with in-memory fallback and TTL support.
 */

let redisClient = null;
let redisAvailable = false;
const memoryCache = new Map();
const TTL_CONFIG = { routing: 60, org: 60, 'analytics:overview': 300, 'analytics:trends': 300, 'ai:agent': 60, 'integrations:status': 120, default: 60 };

async function init() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) { console.log('[Cache] No REDIS_URL — using in-memory'); return false; }
  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: redisUrl, socket: { connectTimeout: 2000, reconnectStrategy: false } });
    redisClient.on('error', (err) => { console.warn('[Cache] Redis error:', err.message); redisAvailable = false; });
    redisClient.on('connect', () => { console.log('[Cache] Redis connected'); redisAvailable = true; });
    await redisClient.connect();
    redisAvailable = true;
  } catch (err) { console.warn('[Cache] Redis failed:', err.message); redisAvailable = false; }
  return redisAvailable;
}

function isAvailable() { return true; }
function getTTL(type) { return TTL_CONFIG[type] || TTL_CONFIG.default; }
function buildKey(type, id) { return `northstar:${process.env.NODE_ENV || 'dev'}:${type}:${id}`; }

async function get(key) {
  if (redisAvailable && redisClient) { try { const v = await redisClient.get(key); if (v) return JSON.parse(v); } catch (_) {} }
  const entry = memoryCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) { if (entry) memoryCache.delete(key); return null; }
  return entry.value;
}

async function set(key, value, ttlSeconds = null) {
  if (!ttlSeconds) { const parts = key.split(':'); ttlSeconds = getTTL(parts.length >= 3 ? parts[2] : 'default'); }
  if (redisAvailable && redisClient) { try { await redisClient.setEx(key, ttlSeconds, JSON.stringify(value)); return; } catch (_) {} }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  if (memoryCache.size > 5000) { const now = Date.now(); for (const [k, v] of memoryCache) { if (now > v.expiresAt) memoryCache.delete(k); } }
}

async function del(key) { if (redisAvailable && redisClient) { try { await redisClient.del(key); } catch (_) {} } memoryCache.delete(key); }

async function incr(key, ttlSeconds = 60) {
  if (redisAvailable && redisClient) { try { const c = await redisClient.incr(key); if (c === 1) await redisClient.expire(key, ttlSeconds); return c; } catch (_) {} }
  const now = Date.now(); const entry = memoryCache.get(key) || { count: 0, expiresAt: now + ttlSeconds * 1000 };
  if (now > entry.expiresAt) { entry.count = 0; entry.expiresAt = now + ttlSeconds * 1000; }
  entry.count++; memoryCache.set(key, entry); return entry.count;
}

async function wrap(key, fetchFn, ttlSeconds = null) {
  const cached = await get(key);
  if (cached !== null) return cached;
  const value = await fetchFn();
  if (value !== null && value !== undefined) await set(key, value, ttlSeconds);
  return value;
}

async function invalidateOrg(orgId) {
  const patterns = ['routing', 'org', 'analytics:overview', 'analytics:trends', 'ai:agent', 'integrations:status'];
  for (const type of patterns) await del(buildKey(type, orgId));
}

module.exports = { init, isAvailable, get, set, del, incr, wrap, invalidateOrg, buildKey };