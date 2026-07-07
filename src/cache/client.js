/**
 * Caching Layer
 * 
 * In-memory cache with TTL support. When Redis is available via REDIS_URL,
 * uses Redis for distributed caching. Falls back gracefully to in-memory store
 * when Redis is unavailable.
 * 
 * See V3-22_Caching_Layer.md for full spec.
 * 
 * Key patterns: northstar:{env}:{type}:{id}
 * TTL defaults per item type defined in TTL_CONFIG.
 */

let redisClient = null;
let redisAvailable = false;
let redisCheckDone = false;

// In-memory store fallback
const memoryCache = new Map();
const KEY_PREFIX = 'northstar:development:';

// Default TTLs per item type (in seconds)
const TTL_CONFIG = {
  routing: 60,
  org: 60,
  'analytics:overview': 300,
  'analytics:trends': 300,
  'ai:agent': 60,
  'integrations:status': 120,
  default: 60
};

/**
 * Try to connect to Redis if REDIS_URL is set.
 */
async function init() {
  if (redisCheckDone) return redisAvailable;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log('[Cache] No REDIS_URL set — using in-memory cache');
    redisAvailable = false;
    redisCheckDone = true;
    return false;
  }

  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: redisUrl, socket: { connectTimeout: 2000, reconnectStrategy: false } });

    redisClient.on('error', (err) => {
      console.warn('[Cache] Redis error:', err.message);
      redisAvailable = false;
    });

    redisClient.on('connect', () => {
      console.log('[Cache] Redis connected');
      redisAvailable = true;
    });

    await redisClient.connect();
    redisAvailable = true;
  } catch (err) {
    console.warn('[Cache] Redis connection failed:', err.message);
    console.log('[Cache] Falling back to in-memory cache');
    redisAvailable = false;
  }

  redisCheckDone = true;
  return redisAvailable;
}

/**
 * Check if cache is available.
 */
function isAvailable() {
  return redisAvailable || true; // Always return true (memory fallback always works)
}

/**
 * Get TTL for a cache key type.
 */
function getTTL(keyType) {
  return TTL_CONFIG[keyType] || TTL_CONFIG.default;
}

/**
 * Build the full cache key.
 */
function buildKey(type, id) {
  return `${KEY_PREFIX}${type}:${id}`;
}

/**
 * Get a value from cache.
 * Returns null on cache miss or error.
 */
async function get(key) {
  if (redisAvailable && redisClient) {
    try {
      const value = await redisClient.get(key);
      if (value) return JSON.parse(value);
    } catch (err) {
      console.warn('[Cache] Redis get error:', err.message);
    }
  }

  // Fall back to in-memory
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Set a value in cache with TTL.
 */
async function set(key, value, ttlSeconds = null) {
  if (ttlSeconds === null) {
    // Extract type from key to determine default TTL
    const parts = key.split(':');
    ttlSeconds = getTTL(parts.length >= 3 ? parts[2] : 'default');
  }

  if (redisAvailable && redisClient) {
    try {
      await redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
      return;
    } catch (err) {
      console.warn('[Cache] Redis set error:', err.message);
    }
  }

  // Fall back to in-memory
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000
  });

  // Cleanup stale entries if map gets too large
  if (memoryCache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of memoryCache) {
      if (now > v.expiresAt) memoryCache.delete(k);
    }
  }
}

/**
 * Delete a key from cache.
 */
async function del(key) {
  if (redisAvailable && redisClient) {
    try {
      await redisClient.del(key);
    } catch (err) {
      console.warn('[Cache] Redis del error:', err.message);
    }
  }
  memoryCache.delete(key);
}

/**
 * Invalidate all caches for an organization.
 * Used when org is suspended or settings change.
 */
async function invalidateOrg(orgId) {
  const patterns = ['routing', 'org', 'analytics:overview', 'analytics:trends', 'ai:agent', 'integrations:status'];
  for (const type of patterns) {
    await del(buildKey(type, orgId));
  }
}

/**
 * Increment a counter in cache (for rate limiting).
 * Returns the new count.
 */
async function incr(key, ttlSeconds = 60) {
  if (redisAvailable && redisClient) {
    try {
      const count = await redisClient.incr(key);
      if (count === 1) await redisClient.expire(key, ttlSeconds);
      return count;
    } catch (err) {
      console.warn('[Cache] Redis incr error:', err.message);
    }
  }

  // In-memory fallback
  const now = Date.now();
  const entry = memoryCache.get(key) || { count: 0, expiresAt: now + ttlSeconds * 1000 };

  if (now > entry.expiresAt) {
    entry.count = 0;
    entry.expiresAt = now + ttlSeconds * 1000;
  }

  entry.count++;
  memoryCache.set(key, entry);
  return entry.count;
}

/**
 * Cache wrapper: get from cache or compute and store.
 * 
 * Usage: const data = await cache.wrap('org:' + orgId, () => fetchFromDb(orgId), 60);
 */
async function wrap(key, fetchFn, ttlSeconds = null) {
  const cached = await get(key);
  if (cached !== null) return cached;

  const value = await fetchFn();
  if (value !== null && value !== undefined) {
    await set(key, value, ttlSeconds);
  }
  return value;
}

module.exports = {
  init,
  isAvailable,
  get,
  set,
  del,
  incr,
  wrap,
  invalidateOrg,
  buildKey
};
