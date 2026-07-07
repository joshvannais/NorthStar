/**
 * Rate Limiting Middleware
 * 
 * V3-24: Protects API endpoints from abuse. Redis + in-memory fallback.
 * Plan tiers: Starter 100, Professional 300, Enterprise 1000 req/min.
 * Auth endpoints limited per IP (5 failed / 15 min).
 */

const cache = require('../cache/client');

const memoryStore = new Map();

function getLimitConfig(group, plan = 'starter') {
  const configs = {
    'public-api': { starter: 100, professional: 300, enterprise: 1000, window: 60000 },
    'internal-api': { starter: 1000, professional: 1000, enterprise: 1000, window: 60000 },
    'auth': { limit: 5, window: 15 * 60 * 1000 }
  };
  const c = configs[group];
  if (!c) return { limit: 100, window: 60000 };
  if (group === 'auth') return { limit: c.limit, window: c.window };
  const planKey = plan.toLowerCase();
  return { limit: c[planKey] || c.starter, window: c.window };
}

async function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();

  if (cache.isAvailable()) {
    try {
      const count = await cache.incr(key, Math.ceil(windowMs / 1000));
      const resetTime = now + windowMs;
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetTime,
        count
      };
    } catch (_) { /* fall through */ }
  }

  const entry = memoryStore.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  memoryStore.set(key, entry);

  if (memoryStore.size > 10000) {
    for (const [k, v] of memoryStore) { if (now > v.resetAt) memoryStore.delete(k); }
  }

  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetTime: entry.resetAt,
    count: entry.count
  };
}

function rateLimit(group, getKey) {
  return async (req, res, next) => {
    const key = getKey
      ? getKey(req)
      : (req.headers['x-api-key'] || req.user?.id || req.ip);
    const plan = req.user?.plan || req.plan || 'starter';
    const config = getLimitConfig(group, plan);
    const fullKey = `rl:${group}:${key}`;
    const result = await checkRateLimit(fullKey, config.limit, config.window);

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

function authRateLimit() {
  const attempts = new Map();
  return (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const entry = attempts.get(ip) || { count: 0, failedCount: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.failedCount = 0; entry.resetAt = now + windowMs; }
    entry.count++;
    if (entry.count > 20) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ error: { code: 'rate_limited', message: 'Too many auth attempts. Try again later.', details: { retryAfterSeconds: retryAfter } } });
    }
    req._rateLimitEntry = entry;
    attempts.set(ip, entry);
    if (attempts.size > 1000) { for (const [k, v] of attempts) { if (now > v.resetAt) attempts.delete(k); } }
    next();
  };
}

function trackFailedAttempt(req) {
  if (req._rateLimitEntry) {
    req._rateLimitEntry.failedCount++;
    if (req._rateLimitEntry.failedCount >= 5) req._rateLimitEntry.resetAt = Date.now() + 15 * 60 * 1000;
  }
}

module.exports = { rateLimit, authRateLimit, trackFailedAttempt };