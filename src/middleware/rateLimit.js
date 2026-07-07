/**
 * Rate Limiting Middleware
 * 
 * Protects API endpoints from abuse by limiting request frequency.
 * Uses in-memory store by default. When Redis is available, uses Redis for
 * distributed rate limiting across multiple app instances.
 * 
 * See V3-24_Rate_Limiting.md for full spec.
 * 
 * Rate limit tiers (per plan):
 * - Starter:   100 req/min for Public API
 * - Professional: 300 req/min
 * - Enterprise: 1000 req/min
 * - Internal API: 1000 req/min per user
 * - Auth endpoints: 5 failed attempts / 15 min per IP
 */

const cache = require('../cache/client');

// In-memory fallback store (used when Redis is unavailable)
const memoryStore = new Map();

/**
 * Get the rate limit configuration for a given endpoint group and plan.
 */
function getLimitConfig(group, plan = 'starter') {
  const configs = {
    'public-api': { starter: 100, professional: 300, enterprise: 1000 },
    'internal-api': { starter: 1000, professional: 1000, enterprise: 1000 },
    'auth': { default: 5, window: 15 * 60 * 1000 }, // 5 attempts per 15 min
    'auth-total': { default: 20, window: 15 * 60 * 1000 } // 20 total per 15 min
  };

  const config = configs[group];
  if (!config) return { limit: 100, window: 60000 };

  if (group === 'auth' || group === 'auth-total') {
    return { limit: config.default, window: config.window };
  }

  const planKey = plan.toLowerCase();
  return { limit: config[planKey] || config.starter, window: 60000 };
}

/**
 * Rate limit a key. Returns { allowed, remaining, resetTime }.
 */
async function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const resetTime = now + windowMs;

  // Try Redis first
  if (cache.isAvailable()) {
    try {
      const result = await cache.incr(key, windowMs / 1000);
      const count = result;
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetTime: now + windowMs,
        count
      };
    } catch (err) {
      // Fall through to memory store
      console.warn('[RateLimit] Redis error, falling back to memory:', err.message);
    }
  }

  // Fall back to in-memory store
  const entry = memoryStore.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }

  entry.count++;
  memoryStore.set(key, entry);

  // Cleanup old entries periodically
  if (memoryStore.size > 10000) {
    for (const [k, v] of memoryStore) {
      if (now > v.resetAt) memoryStore.delete(k);
    }
  }

  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetTime: entry.resetAt,
    count: entry.count
  };
}

/**
 * Middleware factory: rate limit by API key or user ID.
 * 
 * Usage: app.use('/api/v1/', rateLimit('public-api'))
 */
function rateLimit(group, getKey) {
  return async (req, res, next) => {
    // Determine the key for rate limiting
    let key;

    if (getKey) {
      key = getKey(req);
    } else {
      // Auto-detect key: API key header > user ID > IP
      const apiKey = req.headers['x-api-key'];
      const userId = req.user?.id;
      key = apiKey || userId || req.ip;
    }

    // Determine plan from user or default
    const plan = req.user?.plan || req.plan || 'starter';

    // Get config for the endpoint group
    const config = getLimitConfig(group, plan);
    const fullKey = `rate_limit:${group}:${key}`;

    const result = await checkRateLimit(fullKey, config.limit, config.window);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', config.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: {
          code: 'rate_limited',
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          details: { retryAfterSeconds: retryAfter, limit: config.limit, window: '1m' }
        }
      });
    }

    next();
  };
}

/**
 * Middleware: rate limit auth endpoints by IP (5 failed attempts per 15 min).
 */
function authRateLimit() {
  const attempts = new Map();

  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;

    const entry = attempts.get(ip) || { count: 0, resetAt: now + windowMs, failedCount: 0 };

    if (now > entry.resetAt) {
      entry.count = 0;
      entry.failedCount = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count++;

    if (entry.count > 20) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: {
          code: 'rate_limited',
          message: 'Too many authentication attempts. Please try again later.',
          details: { retryAfterSeconds: retryAfter }
        }
      });
    }

    // Track failed attempts for stricter limiting
    req._rateLimitEntry = entry;
    attempts.set(ip, entry);

    // Cleanup
    if (attempts.size > 1000) {
      for (const [k, v] of attempts) {
        if (now > v.resetAt) attempts.delete(k);
      }
    }

    next();
  };
}

/**
 * Track a failed auth attempt.
 */
function trackFailedAttempt(req) {
  if (req._rateLimitEntry) {
    req._rateLimitEntry.failedCount++;
    if (req._rateLimitEntry.failedCount >= 5) {
      req._rateLimitEntry.resetAt = Date.now() + 15 * 60 * 1000;
    }
  }
}

module.exports = { rateLimit, authRateLimit, trackFailedAttempt, getLimitConfig };
