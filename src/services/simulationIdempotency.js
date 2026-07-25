'use strict';

const crypto = require('crypto');

// Temporary, process-local containment only. This does not coordinate multiple
// processes, survive restarts, or make the cross-store operation transactional.
const entries = new Map();
let ttlMs = 10 * 60 * 1000;
let maxEntries = 1000;

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce(function (result, key) {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function payloadFingerprint(payload) {
  return digest(JSON.stringify(canonicalize(payload || {})));
}

function requestKey(organizationId, suppliedKey) {
  const raw = suppliedKey || ('unkeyed:' + Date.now() + ':' + Math.random());
  return digest(String(organizationId || '') + '|' + String(raw));
}

function evictExpired(now) {
  for (const [key, entry] of entries) {
    if (entry.state !== 'in_progress' && now - entry.updatedAt >= ttlMs) {
      entries.delete(key);
    }
  }
}

function evictToCapacity() {
  if (entries.size < maxEntries) return;
  const completed = Array.from(entries.entries())
    .filter(function (pair) { return pair[1].state !== 'in_progress'; })
    .sort(function (a, b) { return a[1].updatedAt - b[1].updatedAt; });
  while (entries.size >= maxEntries && completed.length > 0) {
    entries.delete(completed.shift()[0]);
  }
}

function claim(key, fingerprint) {
  const now = Date.now();
  evictExpired(now);
  const existing = entries.get(key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return { owner: false, conflict: true };
    }
    return { owner: false, promise: existing.promise };
  }

  evictToCapacity();
  if (entries.size >= maxEntries) {
    return { owner: false, capacity: true };
  }

  let resolveEntry;
  let rejectEntry;
  const promise = new Promise(function (resolve, reject) {
    resolveEntry = resolve;
    rejectEntry = reject;
  });
  // The owner responds directly rather than awaiting the stored promise.
  // Keep a rejection handler attached until a duplicate request replays it.
  promise.catch(function () {});
  entries.set(key, {
    promise: promise,
    resolve: resolveEntry,
    reject: rejectEntry,
    fingerprint: fingerprint,
    state: 'in_progress',
    updatedAt: now,
  });
  return { owner: true, promise: promise };
}

function resolve(key, result) {
  const entry = entries.get(key);
  if (entry) {
    entry.state = 'complete';
    entry.updatedAt = Date.now();
    entry.resolve(result);
  }
}

function reject(key, error) {
  const entry = entries.get(key);
  if (entry) {
    // Failed operations must be retryable. Delete before notifying waiters so
    // a new request can immediately become the owner.
    entries.delete(key);
    entry.reject(error);
  }
}

function postgresIdentity(sessionId, key) {
  const prefix = 'northstar-sim:' + String(sessionId || '').slice(0, 80) + ':';
  return prefix + digest(key).slice(0, 48);
}

function resetForTests() {
  entries.clear();
  ttlMs = 10 * 60 * 1000;
  maxEntries = 1000;
}

function configureForTests(options) {
  if (options && Number.isFinite(options.ttlMs)) ttlMs = Math.max(0, options.ttlMs);
  if (options && Number.isFinite(options.maxEntries)) maxEntries = Math.max(1, options.maxEntries);
}

function sizeForTests() {
  return entries.size;
}

module.exports = {
  payloadFingerprint,
  requestKey,
  claim,
  resolve,
  reject,
  postgresIdentity,
  resetForTests,
  configureForTests,
  sizeForTests,
};
