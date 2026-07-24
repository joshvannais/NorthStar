'use strict';

const crypto = require('crypto');

// Process-local coalescing is intentionally bounded. PostgreSQL call reuse
// supplies a durable guard for that store; the file-backed Polaris engines do
// not have a shared transaction or unique-key facility.
const entries = new Map();

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function requestKey(userId, sessionId, suppliedKey) {
  const raw = suppliedKey || ('unkeyed:' + Date.now() + ':' + Math.random());
  return digest(String(userId || '') + '|' + String(sessionId || '') + '|' + String(raw));
}

function claim(key) {
  if (entries.has(key)) {
    return { owner: false, promise: entries.get(key).promise };
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
  });
  return { owner: true, promise: promise };
}

function resolve(key, result) {
  const entry = entries.get(key);
  if (entry) entry.resolve(result);
}

function reject(key, error) {
  const entry = entries.get(key);
  if (entry) entry.reject(error);
}

function postgresIdentity(sessionId, key) {
  const prefix = 'northstar-sim:' + String(sessionId || '').slice(0, 80) + ':';
  return prefix + digest(key).slice(0, 48);
}

function resetForTests() {
  entries.clear();
}

module.exports = {
  requestKey,
  claim,
  resolve,
  reject,
  postgresIdentity,
  resetForTests,
};
