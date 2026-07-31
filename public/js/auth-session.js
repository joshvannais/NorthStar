(function (global) {
  'use strict';

  var account = null;
  var pendingLoad = null;
  var refreshInFlight = null;
  var logoutInFlight = null;
  var authGeneration = 0;
  var requestSequence = 0;
  var activeRequestCaptures = new Map();
  var failedWaves = new Map();
  var seenCoordinationMessages = new Map();
  var coordinationOrderByDocument = new Map();
  var coordinationDatabase = null;
  var coordinationDatabasePromise = null;
  var REFRESH_LOCK_NAME = 'northstar-account-refresh-v1';
  var COORDINATION_PROTOCOL = 'northstar-account-refresh-v1';
  var COORDINATION_STATE_KEY = 'northstar-coordination-v1';
  var COORDINATION_DATABASE = 'northstar-coordination-v1';
  var COORDINATION_STORE = 'leases';
  var COORDINATION_PHASE_MILLISECONDS = 1000;
  var FALLBACK_LEASE_MILLISECONDS = 3000;
  var FALLBACK_HEARTBEAT_MILLISECONDS = 750;
  var FALLBACK_RECOVERY_MILLISECONDS = 6500;
  var COORDINATION_MESSAGE_MAX_KEYS = 7;
  var COORDINATION_MESSAGE_MAX_BYTES = 512;
  var COORDINATION_DOCUMENT_ID_LENGTH = 41;
  var COORDINATION_ATTEMPT_ID_LENGTH = 40;
  var COORDINATION_MAX_GENERATION_LAG = 2;
  var COORDINATION_MAX_GENERATION_DRIFT = 1024;
  var COORDINATION_MAX_PAST_MILLISECONDS = 120000;
  var COORDINATION_MAX_FUTURE_MILLISECONDS = 30000;
  var COORDINATION_DEDUPE_MAX_ENTRIES = 256;
  var COORDINATION_DEDUPE_TTL_MILLISECONDS = 60000;
  var COORDINATION_ORDER_MAX_ENTRIES = 128;
  var COORDINATION_ORDER_TTL_MILLISECONDS = 60000;
  var FAILED_WAVE_MAX_ENTRIES = 64;
  var FAILED_WAVE_TTL_MILLISECONDS = 120000;
  var COORDINATION_TYPES = Object.freeze({ result: true });
  var COORDINATION_KEYS = Object.freeze([
    'attemptId', 'documentId', 'generation', 'protocol', 'success', 'timestamp', 'type'
  ]);
  var DOCUMENT_ID_PATTERN = /^document-[a-f0-9]{32}$/;
  var ATTEMPT_ID_PATTERN = /^attempt-[a-f0-9]{32}$/;

  function nonSecretId(prefix) {
    var values = new Uint8Array(16);
    var random = '';
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      global.crypto.getRandomValues(values);
    } else {
      // Coordination IDs are non-authoritative. This format-preserving fallback
      // only keeps old browsers functional; server cookies remain the authority.
      for (var index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 256);
    }
    for (var offset = 0; offset < values.length; offset += 1) {
      random += values[offset].toString(16).padStart(2, '0');
    }
    return prefix + '-' + random;
  }

  var documentId = nonSecretId('document');
  var coordinationChannel = null;
  if (typeof global.BroadcastChannel === 'function') {
    try { coordinationChannel = new global.BroadcastChannel(COORDINATION_PROTOCOL); } catch (_error) { coordinationChannel = null; }
  }

  function cookie(name) {
    var prefix = name + '=';
    var parts = String(document.cookie || '').split(';');
    for (var index = 0; index < parts.length; index += 1) {
      var item = parts[index].trim();
      if (item.indexOf(prefix) === 0) {
        try { return decodeURIComponent(item.slice(prefix.length)); } catch (_error) { return item.slice(prefix.length); }
      }
    }
    return '';
  }

  function isUnsafe(method) {
    return ['GET', 'HEAD', 'OPTIONS'].indexOf(String(method || 'GET').toUpperCase()) < 0;
  }

  function optionsWithSession(options) {
    var next = Object.assign({}, options || {});
    next.method = String(next.method || 'GET').toUpperCase();
    next.credentials = 'same-origin';
    next.headers = Object.assign({}, next.headers || {});
    if (isUnsafe(next.method)) {
      var csrf = cookie('northstar_csrf');
      if (csrf) next.headers['X-CSRF-Token'] = csrf;
    }
    return next;
  }

  function responseCode(response) {
    return response.clone().json().then(function (body) { return body && body.code; }).catch(function () { return null; });
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) { global.setTimeout(resolve, milliseconds); });
  }

  function evictOldest(map, maximum) {
    while (map.size >= maximum) {
      var oldest = map.keys().next();
      if (oldest.done) return;
      map.delete(oldest.value);
    }
  }

  function pruneCoordinationRetention(now) {
    seenCoordinationMessages.forEach(function (receivedAt, key) {
      if (!Number.isSafeInteger(receivedAt) || now - receivedAt > COORDINATION_DEDUPE_TTL_MILLISECONDS || receivedAt > now) {
        seenCoordinationMessages.delete(key);
      }
    });
    coordinationOrderByDocument.forEach(function (entry, key) {
      if (!entry || !Number.isSafeInteger(entry.receivedAt) ||
          now - entry.receivedAt > COORDINATION_ORDER_TTL_MILLISECONDS || entry.receivedAt > now) {
        coordinationOrderByDocument.delete(key);
      }
    });
    failedWaves.forEach(function (entry, key) {
      if (!entry || !Number.isSafeInteger(entry.retainedAt) ||
          now - entry.retainedAt > FAILED_WAVE_TTL_MILLISECONDS || entry.retainedAt > now) {
        failedWaves.delete(key);
      }
    });
  }

  function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function hasExactCoordinationKeys(message) {
    var keys;
    try { keys = Reflect.ownKeys(message); } catch (_error) { return false; }
    if (keys.length !== COORDINATION_MESSAGE_MAX_KEYS || keys.some(function (key) { return typeof key !== 'string'; })) return false;
    return keys.slice().sort().every(function (key, index) { return key === COORDINATION_KEYS[index]; });
  }

  function validateCoordinationMessage(value) {
    var receivedAt = Date.now();
    pruneCoordinationRetention(receivedAt);
    if (!isPlainObject(value) || !hasExactCoordinationKeys(value)) return null;
    var serialized;
    try { serialized = JSON.stringify(value); } catch (_error) { return null; }
    if (typeof serialized !== 'string' || serialized.length > COORDINATION_MESSAGE_MAX_BYTES) return null;
    if (value.protocol !== COORDINATION_PROTOCOL || COORDINATION_TYPES[value.type] !== true) return null;
    if (typeof value.documentId !== 'string' || value.documentId.length !== COORDINATION_DOCUMENT_ID_LENGTH ||
        !DOCUMENT_ID_PATTERN.test(value.documentId) || value.documentId === documentId) return null;
    if (typeof value.attemptId !== 'string' || value.attemptId.length !== COORDINATION_ATTEMPT_ID_LENGTH ||
        !ATTEMPT_ID_PATTERN.test(value.attemptId)) return null;
    if (typeof value.success !== 'boolean') return null;
    if (!Number.isSafeInteger(value.generation) ||
        value.generation < Math.max(0, authGeneration - COORDINATION_MAX_GENERATION_LAG) ||
        value.generation > authGeneration + COORDINATION_MAX_GENERATION_DRIFT) return null;
    if (!Number.isSafeInteger(value.timestamp) ||
        value.timestamp < receivedAt - COORDINATION_MAX_PAST_MILLISECONDS ||
        value.timestamp > receivedAt + COORDINATION_MAX_FUTURE_MILLISECONDS) return null;

    var dedupeKey = value.attemptId + ':' + value.type;
    if (seenCoordinationMessages.has(dedupeKey)) return null;
    var prior = coordinationOrderByDocument.get(value.documentId);
    if (prior && (value.generation < prior.generation || value.timestamp < prior.timestamp)) return null;

    // Mutation begins only after the complete payload, duplicate, and ordering
    // checks have passed. No sender-owned payload object is retained.
    evictOldest(seenCoordinationMessages, COORDINATION_DEDUPE_MAX_ENTRIES);
    seenCoordinationMessages.set(dedupeKey, receivedAt);
    if (prior) coordinationOrderByDocument.delete(value.documentId);
    else evictOldest(coordinationOrderByDocument, COORDINATION_ORDER_MAX_ENTRIES);
    coordinationOrderByDocument.set(value.documentId, Object.freeze({
      generation: value.generation,
      timestamp: value.timestamp,
      receivedAt: receivedAt,
    }));
    return Object.freeze({
      type: value.type,
      attemptId: value.attemptId,
      success: value.success,
      generation: value.generation,
      timestamp: value.timestamp,
    });
  }

  function openCoordinationDatabase() {
    if (coordinationDatabase) return Promise.resolve(coordinationDatabase);
    if (coordinationDatabasePromise) return coordinationDatabasePromise;
    if (!global.indexedDB || typeof global.indexedDB.open !== 'function') return Promise.resolve(null);
    var pending = new Promise(function (resolve) {
      var settled = false;
      var request;
      var timeout = global.setTimeout(function () { finish(null); }, COORDINATION_PHASE_MILLISECONDS);
      function finish(value) {
        if (settled) {
          if (value && typeof value.close === 'function') value.close();
          return;
        }
        settled = true;
        global.clearTimeout(timeout);
        if (value) {
          coordinationDatabase = value;
          value.onversionchange = function () {
            value.close();
            if (coordinationDatabase === value) coordinationDatabase = null;
          };
        }
        resolve(value);
      }
      try { request = global.indexedDB.open(COORDINATION_DATABASE, 1); } catch (_error) { finish(null); return; }
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains(COORDINATION_STORE)) database.createObjectStore(COORDINATION_STORE);
      };
      request.onsuccess = function () { finish(request.result); };
      request.onerror = function () { finish(null); };
      request.onblocked = function () { finish(null); };
    });
    coordinationDatabasePromise = pending;
    pending.finally(function () {
      if (coordinationDatabasePromise === pending) coordinationDatabasePromise = null;
    });
    return pending;
  }

  function resetCoordinationDatabase(database) {
    if (database && coordinationDatabase === database) {
      try { database.close(); } catch (_error) { /* A failed handle is already unusable. */ }
      coordinationDatabase = null;
    }
  }

  function claimFallbackLease(attemptId) {
    return openCoordinationDatabase().then(function (database) {
      if (!database) return { available: false, claimed: false };
      return new Promise(function (resolve) {
        var settled = false;
        var claimed = false;
        var transaction;
        var timeout = global.setTimeout(function () {
          try { if (transaction) transaction.abort(); } catch (_error) { /* Timeout already owns failure. */ }
          resetCoordinationDatabase(database);
          finish({ available: false, claimed: false });
        }, COORDINATION_PHASE_MILLISECONDS);
        function finish(value) {
          if (settled) return;
          settled = true;
          global.clearTimeout(timeout);
          resolve(value);
        }
        try {
          transaction = database.transaction(COORDINATION_STORE, 'readwrite');
          var store = transaction.objectStore(COORDINATION_STORE);
          var read = store.get(REFRESH_LOCK_NAME);
          read.onsuccess = function () {
            var current = read.result;
            var now = Date.now();
            var valid = current && typeof current.owner === 'string' &&
              typeof current.expiresAt === 'number' && current.expiresAt > now &&
              current.expiresAt <= now + FALLBACK_LEASE_MILLISECONDS;
            if (!valid || current.owner === attemptId) {
              claimed = true;
              store.put(Object.freeze({ owner: attemptId, expiresAt: now + FALLBACK_LEASE_MILLISECONDS }), REFRESH_LOCK_NAME);
            }
          };
          read.onerror = function () { try { transaction.abort(); } catch (_error) { /* Transaction failure is bounded. */ } };
          transaction.oncomplete = function () { finish({ available: true, claimed: claimed }); };
          transaction.onerror = function () {
            resetCoordinationDatabase(database);
            finish({ available: false, claimed: false });
          };
          transaction.onabort = function () {
            resetCoordinationDatabase(database);
            finish({ available: false, claimed: false });
          };
        } catch (_error) {
          resetCoordinationDatabase(database);
          finish({ available: false, claimed: false });
        }
      });
    });
  }

  function releaseFallbackLease(attemptId) {
    return openCoordinationDatabase().then(function (database) {
      if (!database) return false;
      return new Promise(function (resolve) {
        var settled = false;
        var transaction;
        var timeout = global.setTimeout(function () {
          try { if (transaction) transaction.abort(); } catch (_error) { /* Timeout already owns failure. */ }
          resetCoordinationDatabase(database);
          finish(false);
        }, COORDINATION_PHASE_MILLISECONDS);
        function finish(value) {
          if (settled) return;
          settled = true;
          global.clearTimeout(timeout);
          resolve(value);
        }
        try {
          transaction = database.transaction(COORDINATION_STORE, 'readwrite');
          var store = transaction.objectStore(COORDINATION_STORE);
          var read = store.get(REFRESH_LOCK_NAME);
          read.onsuccess = function () {
            if (read.result && read.result.owner === attemptId) store.delete(REFRESH_LOCK_NAME);
          };
          read.onerror = function () { try { transaction.abort(); } catch (_error) { /* Transaction failure is bounded. */ } };
          transaction.oncomplete = function () { finish(true); };
          transaction.onerror = function () { resetCoordinationDatabase(database); finish(false); };
          transaction.onabort = function () { resetCoordinationDatabase(database); finish(false); };
        } catch (_error) {
          resetCoordinationDatabase(database);
          finish(false);
        }
      });
    });
  }

  function renewFallbackLease(attemptId) {
    return openCoordinationDatabase().then(function (database) {
      if (!database) return false;
      return new Promise(function (resolve) {
        var settled = false;
        var renewed = false;
        var transaction;
        var timeout = global.setTimeout(function () {
          try { if (transaction) transaction.abort(); } catch (_error) { /* Timeout already owns failure. */ }
          resetCoordinationDatabase(database);
          finish(false);
        }, COORDINATION_PHASE_MILLISECONDS);
        function finish(value) {
          if (settled) return;
          settled = true;
          global.clearTimeout(timeout);
          resolve(value);
        }
        try {
          transaction = database.transaction(COORDINATION_STORE, 'readwrite');
          var store = transaction.objectStore(COORDINATION_STORE);
          var read = store.get(REFRESH_LOCK_NAME);
          read.onsuccess = function () {
            if (read.result && read.result.owner === attemptId) {
              renewed = true;
              store.put(Object.freeze({
                owner: attemptId,
                expiresAt: Date.now() + FALLBACK_LEASE_MILLISECONDS,
              }), REFRESH_LOCK_NAME);
            }
          };
          read.onerror = function () { try { transaction.abort(); } catch (_error) { /* Transaction failure is bounded. */ } };
          transaction.oncomplete = function () { finish(renewed); };
          transaction.onerror = function () { resetCoordinationDatabase(database); finish(false); };
          transaction.onabort = function () { resetCoordinationDatabase(database); finish(false); };
        } catch (_error) {
          resetCoordinationDatabase(database);
          finish(false);
        }
      });
    });
  }

  function coordinationMessage(type, attemptId, success, generation) {
    return Object.freeze({
      protocol: COORDINATION_PROTOCOL,
      type: type,
      documentId: documentId,
      attemptId: attemptId,
      success: success === true,
      generation: generation,
      timestamp: Date.now(),
    });
  }

  function postCoordination(message) {
    if (!coordinationChannel) return;
    try { coordinationChannel.postMessage(message); } catch (_error) { /* Coordination remains best-effort. */ }
  }

  function readCoordinationState() {
    var empty = { epoch: 0, outcomes: [] };
    var parsed;
    try { parsed = JSON.parse(global.localStorage.getItem(COORDINATION_STATE_KEY) || 'null'); } catch (_error) { return empty; }
    if (!parsed || !Number.isSafeInteger(parsed.epoch) || parsed.epoch < 0 || parsed.epoch > 1000000000 ||
        !Array.isArray(parsed.outcomes) || parsed.outcomes.length > 64 ||
        Object.keys(parsed).length !== 2 || Object.keys(parsed).some(function (key) { return key !== 'epoch' && key !== 'outcomes'; })) return empty;
    var seenEpochs = Object.create(null);
    var seenAttempts = Object.create(null);
    var outcomes = parsed.outcomes.filter(function (outcome) {
      return isPlainObject(outcome) && Object.keys(outcome).length === 3 &&
        Object.keys(outcome).every(function (key) { return key === 'epoch' || key === 'success' || key === 'attemptId'; }) &&
        Number.isSafeInteger(outcome.epoch) && outcome.epoch > 0 && outcome.epoch <= parsed.epoch &&
        typeof outcome.success === 'boolean' && typeof outcome.attemptId === 'string' &&
        outcome.attemptId.length === COORDINATION_ATTEMPT_ID_LENGTH && ATTEMPT_ID_PATTERN.test(outcome.attemptId);
    }).sort(function (left, right) { return left.epoch - right.epoch; }).filter(function (outcome) {
      if (seenEpochs[outcome.epoch] || seenAttempts[outcome.attemptId]) return false;
      seenEpochs[outcome.epoch] = true;
      seenAttempts[outcome.attemptId] = true;
      return true;
    }).map(function (outcome) {
      return Object.freeze({
        epoch: outcome.epoch,
        success: outcome.success,
        attemptId: outcome.attemptId
      });
    }).slice(-64);
    return { epoch: parsed.epoch, outcomes: outcomes };
  }

  function recordCoordinationOutcome(success, attemptId, generation) {
    pruneCoordinationRetention(Date.now());
    var state = readCoordinationState();
    var existing = state.outcomes.find(function (outcome) { return outcome.attemptId === attemptId; });
    if (!existing) {
      var epoch = state.epoch + 1;
      existing = Object.freeze({ epoch: epoch, success: success === true, attemptId: attemptId });
      state = { epoch: epoch, outcomes: state.outcomes.concat([existing]).slice(-64) };
      try { global.localStorage.setItem(COORDINATION_STATE_KEY, JSON.stringify(state)); } catch (_error) { /* Server authority remains fail-closed. */ }
    }
    postCoordination(coordinationMessage('result', attemptId, success, generation));
    return existing;
  }

  function sharedOutcomeFor(capture) {
    var state = readCoordinationState();
    var outcome = state.outcomes.find(function (candidate) { return candidate.epoch > capture.coordinationEpoch; });
    if (!outcome) return null;
    return outcome.success
      ? successOutcome(capture.generation, outcome.attemptId, 'shared_coordination', false)
      : failureOutcome(capture.generation, outcome.attemptId, 'shared_coordination', false);
  }

  function successOutcome(generation, attemptId, source, shouldBroadcast) {
    pruneCoordinationRetention(Date.now());
    if (generation < authGeneration) {
      return Object.freeze({ success: true, generation: generation, currentGeneration: authGeneration, source: source });
    }
    if (generation !== authGeneration) {
      return Object.freeze({ success: false, generation: generation, currentGeneration: authGeneration, source: source });
    }
    authGeneration += 1;
    var outcome = Object.freeze({ success: true, generation: generation, currentGeneration: authGeneration, source: source });
    if (shouldBroadcast) postCoordination(coordinationMessage('result', attemptId, true, generation));
    global.dispatchEvent(new CustomEvent('northstar:auth-generation', {
      detail: Object.freeze({ generation: authGeneration, outcome: 'success', source: source }),
    }));
    return outcome;
  }

  function failureOutcome(generation, attemptId, source, shouldBroadcast) {
    pruneCoordinationRetention(Date.now());
    if (generation < authGeneration) {
      return Object.freeze({ success: true, generation: generation, currentGeneration: authGeneration, source: source });
    }
    var completedAt = Date.now();
    var cutoffSequence = requestSequence;
    activeRequestCaptures.forEach(function (capture) {
      if (capture.generation === generation && capture.sequence <= cutoffSequence && capture.startedAt <= completedAt) {
        capture.localOutcome.failed = true;
        capture.localOutcome.completedAt = completedAt;
        capture.localOutcome.attemptId = attemptId;
      }
    });
    var key = String(generation);
    var priorFailure = failedWaves.get(key);
    if (priorFailure) failedWaves.delete(key);
    else evictOldest(failedWaves, FAILED_WAVE_MAX_ENTRIES);
    failedWaves.set(key, Object.freeze({
      generation: generation,
      cutoffSequence: Math.max(priorFailure ? priorFailure.cutoffSequence : 0, cutoffSequence),
      completedAt: Math.max(priorFailure ? priorFailure.completedAt : 0, completedAt),
      attemptId: attemptId,
      retainedAt: completedAt,
    }));
    var outcome = Object.freeze({ success: false, generation: generation, currentGeneration: authGeneration, source: source });
    if (shouldBroadcast) postCoordination(coordinationMessage('result', attemptId, false, generation));
    global.dispatchEvent(new CustomEvent('northstar:auth-generation', {
      detail: Object.freeze({ generation: authGeneration, outcome: 'failure', source: source }),
    }));
    return outcome;
  }

  function outcomeFor(capture) {
    if (capture.localOutcome.failed) {
      return Object.freeze({ success: false, generation: capture.generation, currentGeneration: authGeneration, source: 'capture_failed_wave' });
    }
    pruneCoordinationRetention(Date.now());
    var failedWave = failedWaves.get(String(capture.generation));
    if (failedWave && capture.sequence <= failedWave.cutoffSequence && capture.startedAt <= failedWave.completedAt) {
      return Object.freeze({ success: false, generation: capture.generation, currentGeneration: authGeneration, source: 'failed_wave' });
    }
    if (capture.generation < authGeneration) {
      return Object.freeze({ success: true, generation: capture.generation, currentGeneration: authGeneration, source: 'completed_generation' });
    }
    return null;
  }

  function rawRefresh(capture, attemptId, leaseGuard) {
    var completed = outcomeFor(capture);
    if (completed) return Promise.resolve(completed);
    var csrf = cookie('northstar_csrf');
    if (!csrf) {
      recordCoordinationOutcome(false, attemptId, capture.generation);
      return Promise.resolve(failureOutcome(capture.generation, attemptId, 'missing_csrf', false));
    }
    var ownership = leaseGuard ? leaseGuard() : Promise.resolve(true);
    return ownership.then(function (owned) {
      if (!owned) {
        recordCoordinationOutcome(false, attemptId, capture.generation);
        return failureOutcome(capture.generation, attemptId, 'coordination_lease_lost', false);
      }
      return global.fetch('/api/auth/refresh', optionsWithSession({ method: 'POST' }));
    })
      .then(function (response) {
        if (!response || typeof response.ok !== 'boolean') return response;
        recordCoordinationOutcome(response.ok, attemptId, capture.generation);
        return response.ok
          ? successOutcome(capture.generation, attemptId, 'refresh', false)
          : failureOutcome(capture.generation, attemptId, 'refresh', false);
      }).catch(function () {
        recordCoordinationOutcome(false, attemptId, capture.generation);
        return failureOutcome(capture.generation, attemptId, 'network', false);
      });
  }

  function probeThenRefresh(capture, attemptId, leaseGuard) {
    var completed = outcomeFor(capture);
    if (completed) return Promise.resolve(completed);
    var shared = sharedOutcomeFor(capture);
    if (shared) return Promise.resolve(shared);
    return global.fetch('/api/auth/me', optionsWithSession({ method: 'GET', cache: 'no-store' }))
      .then(function (response) {
        var concurrent = outcomeFor(capture);
        if (concurrent) return concurrent;
        var sharedAfterProbe = sharedOutcomeFor(capture);
        if (sharedAfterProbe) return sharedAfterProbe;
        if (response.ok) {
          recordCoordinationOutcome(true, attemptId, capture.generation);
          return successOutcome(capture.generation, attemptId, 'authority_probe', false);
        }
        if (response.status !== 401) {
          recordCoordinationOutcome(false, attemptId, capture.generation);
          return failureOutcome(capture.generation, attemptId, 'authority_probe', false);
        }
        return responseCode(response).then(function (code) {
          if (code !== 'access_expired' && code !== 'invalid_token' && code !== 'session_inactive') {
            recordCoordinationOutcome(false, attemptId, capture.generation);
            return failureOutcome(capture.generation, attemptId, 'authority_probe', false);
          }
          return rawRefresh(capture, attemptId, leaseGuard);
        });
      }).catch(function () {
        recordCoordinationOutcome(false, attemptId, capture.generation);
        return failureOutcome(capture.generation, attemptId, 'authority_probe_network', false);
      });
  }

  function runWithFallbackLease(capture, attemptId) {
    var stopped = false;
    var leaseOwned = true;
    var heartbeatTimer = null;
    var renewal = Promise.resolve(true);
    function verifyLease() {
      if (!leaseOwned) return Promise.resolve(false);
      return renewFallbackLease(attemptId).then(function (renewed) {
        leaseOwned = renewed;
        return renewed;
      }).catch(function () {
        leaseOwned = false;
        return false;
      });
    }
    function scheduleHeartbeat() {
      heartbeatTimer = global.setTimeout(function () {
        renewal = verifyLease().then(function (renewed) {
          if (!stopped && renewed) scheduleHeartbeat();
          return renewed;
        });
      }, FALLBACK_HEARTBEAT_MILLISECONDS);
    }
    scheduleHeartbeat();
    return probeThenRefresh(capture, attemptId, verifyLease).finally(function () {
      stopped = true;
      if (heartbeatTimer) global.clearTimeout(heartbeatTimer);
      return renewal.then(function () { return releaseFallbackLease(attemptId); });
    });
  }

  function coordinateWithoutLocks(capture, attemptId) {
    var deadline = Date.now() + FALLBACK_RECOVERY_MILLISECONDS;
    function attempt() {
      var completed = outcomeFor(capture) || sharedOutcomeFor(capture);
      if (completed) return Promise.resolve(completed);
      return claimFallbackLease(attemptId).then(function (lease) {
          if (!lease.available) {
            recordCoordinationOutcome(false, attemptId, capture.generation);
            return failureOutcome(capture.generation, attemptId, 'coordination_unavailable', false);
          }
          if (lease.claimed) {
            return runWithFallbackLease(capture, attemptId);
          }
          if (Date.now() >= deadline) {
            recordCoordinationOutcome(false, attemptId, capture.generation);
            return failureOutcome(capture.generation, attemptId, 'coordination_timeout', false);
          }
          return delay(50).then(attempt);
      });
    }
    return attempt();
  }

  function coordinateRefresh(capture, attemptId) {
    var locks = global.navigator && global.navigator.locks;
    if (!locks || typeof locks.request !== 'function') {
      return coordinateWithoutLocks(capture, attemptId);
    }
    return locks.request(REFRESH_LOCK_NAME, { mode: 'exclusive' }, function () {
      return probeThenRefresh(capture, attemptId);
    }).catch(function () {
      recordCoordinationOutcome(false, attemptId, capture.generation);
      return failureOutcome(capture.generation, attemptId, 'coordination_lock_failed', false);
    });
  }

  function ensureRefresh(capture) {
    var completed = outcomeFor(capture);
    if (completed) return Promise.resolve(completed);
    if (refreshInFlight && refreshInFlight.generation === capture.generation) return refreshInFlight.promise;
    var attemptId = nonSecretId('attempt');
    var promise = coordinateRefresh(capture, attemptId);
    refreshInFlight = { generation: capture.generation, attemptId: attemptId, capture: capture, promise: promise };
    return promise.finally(function () {
      if (refreshInFlight && refreshInFlight.attemptId === attemptId) refreshInFlight = null;
    });
  }

  if (coordinationChannel) {
    coordinationChannel.onmessage = function (event) {
      var message = validateCoordinationMessage(event && event.data);
      if (!message) return;
      if (refreshInFlight) sharedOutcomeFor(refreshInFlight.capture);
    };
  }

  function request(url, options) {
    var localOutcome = { failed: false, completedAt: 0, attemptId: '' };
    var prepared = optionsWithSession(options);
    var capture = Object.freeze({
      generation: authGeneration,
      coordinationEpoch: readCoordinationState().epoch,
      sequence: ++requestSequence,
      startedAt: Date.now(),
      localOutcome: localOutcome,
    });
    activeRequestCaptures.set(capture.sequence, capture);
    return Promise.resolve().then(function () { return global.fetch(url, prepared); }).then(function (response) {
      if (response.status !== 401 || String(url).indexOf('/api/auth/refresh') === 0) {
        return response;
      }
      return responseCode(response).then(function (code) {
        if (code !== 'access_expired' && code !== 'invalid_token' && code !== 'session_inactive') return response;
        return ensureRefresh(capture).then(function (outcome) {
          // The raw retry deliberately bypasses request(): one retry can never
          // recurse into another refresh, even if it receives another 401.
          return outcome.success ? global.fetch(url, optionsWithSession(options)) : response;
        }).catch(function () { return response; });
      });
    }).finally(function () {
      activeRequestCaptures.delete(capture.sequence);
    });
  }

  function json(url, options) {
    return request(url, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var error = new Error(body.error || 'Request failed');
          error.code = body.code || 'request_failed';
          error.status = response.status;
          error.requestId = body.requestId || response.headers.get('X-Request-ID');
          throw error;
        }
        return body;
      });
    });
  }

  function showVerificationStatus(next) {
    if (!document.body) return;
    var id = 'northstar-verification-status';
    var notice = document.getElementById(id);
    var pending = Boolean(next && next.user && next.user.status === 'pending_verification');
    var protectedPage = global.location.pathname === '/dashboard' || global.location.pathname.indexOf('/dashboard/') === 0;
    if (!pending || !protectedPage) {
      if (notice) notice.remove();
      return;
    }
    if (!notice) {
      notice = document.createElement('div');
      notice.id = id;
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'position:relative;z-index:50;padding:10px 16px;text-align:center;background:#fff7d6;color:#5c4700;border-bottom:1px solid #ecd36a;font:600 13px/1.4 system-ui,sans-serif;';
      document.body.insertBefore(notice, document.body.firstChild);
    }
    notice.textContent = 'Email verification is pending. Your tenant dashboard and Business Profile remain available; external actions stay disabled.';
  }

  function publish(next) {
    account = next || null;
    showVerificationStatus(account);
    global.dispatchEvent(new CustomEvent('northstar:account', { detail: account }));
    return account;
  }

  function load(force) {
    if (account && !force) return Promise.resolve(account);
    if (pendingLoad && !force) return pendingLoad;
    pendingLoad = json('/api/auth/me', { method: 'GET', cache: 'no-store' })
      .then(function (body) { return publish(body.account); })
      .catch(function (error) { publish(null); throw error; })
      .finally(function () { pendingLoad = null; });
    return pendingLoad;
  }

  function destination(value) {
    if (!value || !value.user) return '/login';
    if (value.onboarding && value.onboarding.status !== 'complete') {
      return '/dashboard/business-profile';
    }
    return '/dashboard';
  }

  function guard() {
    var path = global.location.pathname;
    var protectedPage = path === '/dashboard' || path.indexOf('/dashboard/') === 0 || path === '/account/pending';
    if (!protectedPage) return Promise.resolve(null);
    return load().then(function (value) {
      // A current tenant session may load its dashboard and onboarding pages
      // regardless of email verification. Server-side action gates enforce
      // onboarding, verification, membership, role, and tenant boundaries.
      var verified = value && value.user && value.user.status === 'active';
      var incomplete = !value || !value.onboarding || value.onboarding.status !== 'complete';
      if (verified && incomplete && path !== '/dashboard/business-profile') {
        global.location.replace('/dashboard/business-profile');
      }
      return value;
    }).catch(function () {
      if (path !== '/login') global.location.replace('/login');
      return null;
    });
  }

  function login(email, password) {
    return json('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    }).then(function () { return load(true); });
  }

  function signup(input) {
    return json('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(function () { return load(true); });
  }

  function logoutFailureMessage(error) {
    if (error && error.code === 'csrf_invalid') {
      return 'Logout could not be confirmed. Refresh this page and try again.';
    }
    if (error && (error.status === 503 || error.code === 'account_authority_unavailable')) {
      return 'Logout could not be confirmed because the account service is temporarily unavailable. Please retry.';
    }
    return 'Logout could not be confirmed. Check your connection and try again.';
  }

  function showLogoutFailure(error) {
    if (!document.body) return;
    var status = document.getElementById('northstar-logout-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'northstar-logout-status';
      status.setAttribute('data-account-logout-error', '');
      status.setAttribute('role', 'alert');
      status.style.cssText = 'position:fixed;z-index:10000;right:16px;bottom:16px;max-width:420px;padding:12px 16px;border-radius:8px;background:#7f1d1d;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.24);font:600 14px/1.4 system-ui,sans-serif;';
      document.body.appendChild(status);
    }
    status.textContent = logoutFailureMessage(error);
    status.hidden = false;
  }

  function clearLogoutFailure() {
    var status = document.getElementById('northstar-logout-status');
    if (status) status.remove();
  }

  function logout() {
    if (logoutInFlight) return logoutInFlight;
    clearLogoutFailure();
    logoutInFlight = json('/api/auth/logout', { method: 'POST' })
      .then(function (body) {
        if (!body || body.success !== true) {
          var error = new Error('Logout was not confirmed');
          error.code = 'logout_unconfirmed';
          throw error;
        }
        publish(null);
        global.location.assign('/login');
        return true;
      })
      .catch(function (error) {
        showLogoutFailure(error);
        global.dispatchEvent(new CustomEvent('northstar:logout-failed', {
          detail: Object.freeze({
            code: error && error.code ? error.code : 'logout_unconfirmed',
            status: error && error.status ? error.status : 0,
          }),
        }));
        throw error;
      })
      .finally(function () { logoutInFlight = null; });
    return logoutInFlight;
  }

  function bindLogoutControls() {
    var root = document.documentElement;
    if (root.getAttribute('data-northstar-logout-bound') === 'true') return;
    root.setAttribute('data-northstar-logout-bound', 'true');
    document.addEventListener('click', function (event) {
      var target = event.target && event.target.closest
        ? event.target.closest('[data-account-logout]') : null;
      if (!target) return;
      event.preventDefault();
      logout().catch(function () {
        // The durable failure is already rendered and remains retryable.
      });
    });
  }

  global.NorthStarAccountSession = Object.freeze({
    destination: destination,
    fetch: request,
    getAccount: function () { return account; },
    guard: guard,
    json: json,
    load: load,
    login: login,
    logout: logout,
    prepareXhr: function (xhr, method) {
      xhr.withCredentials = true;
      if (isUnsafe(method)) {
        var csrf = cookie('northstar_csrf');
        if (csrf) xhr.setRequestHeader('X-CSRF-Token', csrf);
      }
      return xhr;
    },
    signup: signup,
  });

  if (typeof global.showToast !== 'function') {
    global.showToast = function (message) {
      var element = document.getElementById('toast');
      if (!element) return;
      element.textContent = message;
      element.className = 'toast show';
      global.setTimeout(function () { element.classList.remove('show'); }, 3500);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindLogoutControls();
      guard();
    });
  } else {
    bindLogoutControls();
    guard();
  }
})(window);
