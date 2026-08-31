'use strict';

const {
  MESSAGE_OPERATION,
  PROVIDER_DECISIONS,
  UUID,
  contractError,
  messageRequestFingerprint,
  unconfiguredStatus,
  validateAssistantResponse,
  validateAssistantStatus,
  validateRuntimeStatusInput,
} = require('./assistantContract');

const MAX_INTERCEPTED_RESPONSE_BYTES = 64 * 1024;
const INTERCEPTED_TIMEOUT_MS = 1000;
const IDEMPOTENCY_MAXIMUM_ENTRIES = 256;
const IDEMPOTENCY_RETENTION_MS = 5 * 60 * 1000;
const FINGERPRINT = /^[0-9a-f]{64}$/;

function requestId(req) {
  return req && (req.requestId || req.correlationId) || 'unavailable';
}

function normalizeRuntime(runtime) {
  if (!runtime) return null;
  if (runtime.kind !== 'interceptor' || typeof runtime.status !== 'function' || typeof runtime.respond !== 'function') {
    throw contractError(
      'POLARIS_RUNTIME_FORBIDDEN',
      'Only an explicit intercepted test runtime can cross the provider-neutral seam.',
      500
    );
  }
  return runtime;
}

function interceptedTimeoutError() {
  return contractError(
    'POLARIS_INTERCEPTED_TIMEOUT',
    'The intercepted test runtime exceeded its test-only timeout.',
    504
  );
}

function interceptedAbortError() {
  return contractError(
    'POLARIS_INTERCEPTED_ABORTED',
    'The intercepted test request was aborted.',
    499
  );
}

function createInterceptedBoundary(parentSignal) {
  const controller = new AbortController();
  const deadlineAt = Date.now() + INTERCEPTED_TIMEOUT_MS;
  const abortFromParent = function () { controller.abort(interceptedAbortError()); };
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  const timer = setTimeout(() => controller.abort(interceptedTimeoutError()), INTERCEPTED_TIMEOUT_MS);
  return Object.freeze({
    deadlineAt,
    signal: controller.signal,
    dispose: function () {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
    },
  });
}

function raceInterceptedAction(action, options = {}) {
  const deadlineAt = options.deadlineAt;
  const signal = options.signal;
  const remaining = deadlineAt - Date.now();
  if (!Number.isFinite(deadlineAt) || remaining <= 0) return Promise.reject(interceptedTimeoutError());
  if (signal && signal.aborted) {
    return Promise.reject(signal.reason && signal.reason.code ? signal.reason : interceptedAbortError());
  }
  let timer;
  let abortListener;
  const boundary = new Promise((_resolve, reject) => {
    if (signal) {
      abortListener = function () {
        reject(signal.reason && signal.reason.code ? signal.reason : interceptedAbortError());
      };
      signal.addEventListener('abort', abortListener, { once: true });
    } else {
      timer = setTimeout(() => reject(interceptedTimeoutError()), remaining);
    }
  });
  return Promise.race([Promise.resolve().then(action), boundary]).finally(() => {
    clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener('abort', abortListener);
  });
}

async function statusForRuntime(runtime, req, options = {}) {
  const intercepted = normalizeRuntime(runtime);
  if (!intercepted) return validateAssistantStatus(unconfiguredStatus(requestId(req)));
  let supplied;
  const ownedBoundary = options.deadlineAt === undefined ? createInterceptedBoundary(options.signal) : null;
  const deadlineAt = ownedBoundary ? ownedBoundary.deadlineAt : options.deadlineAt;
  const signal = ownedBoundary ? ownedBoundary.signal : options.signal;
  try {
    supplied = await raceInterceptedAction(
      () => intercepted.status(Object.freeze({ signal })),
      { deadlineAt, signal }
    );
  } catch (_error) {
    if (_error && (_error.code === 'POLARIS_INTERCEPTED_TIMEOUT' || _error.code === 'POLARIS_INTERCEPTED_ABORTED')) {
      throw _error;
    }
    return validateAssistantStatus(Object.freeze({
      ...unconfiguredStatus(requestId(req)),
      state: 'error',
      label: 'Intercepted assistant status unavailable',
    }));
  } finally {
    if (ownedBoundary) ownedBoundary.dispose();
  }
  try {
    supplied = validateRuntimeStatusInput(supplied);
  } catch (_error) {
    throw contractError(
      'POLARIS_RUNTIME_STATUS_INVALID',
      'Intercepted runtime returned an invalid status.',
      502
    );
  }
  return validateAssistantStatus(Object.freeze({
    ...unconfiguredStatus(requestId(req)),
    state: supplied.state,
    label: supplied.label || `Intercepted assistant ${supplied.state}`,
    intercepted: true,
    providerRequestsEnabled: false,
    providerRequestsSent: 0,
  }));
}

function boundedInterceptedResponse(value, request, authority) {
  try {
    validateAssistantResponse(value, {
      requestId: request.idempotencyKey,
      authority,
      selected: request.selected,
      source: 'interceptor',
    });
  } catch (_error) {
    throw contractError('POLARIS_INTERCEPTED_RESPONSE_INVALID', 'Intercepted runtime returned an invalid assistant response.', 502);
  }
  let serialized;
  try { serialized = JSON.stringify(value); } catch (_error) {
    throw contractError('POLARIS_INTERCEPTED_RESPONSE_INVALID', 'Intercepted runtime returned an invalid assistant response.', 502);
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > MAX_INTERCEPTED_RESPONSE_BYTES) {
    throw contractError('POLARIS_INTERCEPTED_RESPONSE_TOO_LARGE', 'Intercepted runtime response exceeded the bounded response contract.', 502);
  }
  return value;
}

function createIdempotencyRegistry(options = {}) {
  const maximumEntries = options.maximumEntries === undefined ? IDEMPOTENCY_MAXIMUM_ENTRIES : options.maximumEntries;
  const retentionMs = options.retentionMs === undefined ? IDEMPOTENCY_RETENTION_MS : options.retentionMs;
  const clock = options.clock || Date.now;
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 1024 ||
      !Number.isSafeInteger(retentionMs) || retentionMs < 1 || retentionMs > 60 * 60 * 1000 || typeof clock !== 'function') {
    throw new TypeError('Polaris idempotency bounds are invalid.');
  }
  const entries = new Map();
  let lastClock = null;

  function clockError() {
    return contractError(
      'POLARIS_IDEMPOTENCY_CLOCK_INVALID',
      'The bounded idempotency clock was invalid.',
      500
    );
  }

  function purgeCompleted() {
    for (const [key, entry] of entries) {
      if (entry.state !== 'pending') entries.delete(key);
    }
  }

  function readClock(minimum) {
    const value = Number(clock());
    if (!Number.isSafeInteger(value) || value < 0 || (minimum !== undefined && value < minimum) ||
        (lastClock !== null && value < lastClock)) {
      purgeCompleted();
      throw clockError();
    }
    lastClock = value;
    return value;
  }

  function scopeKey(scope) {
    if (!scope || typeof scope !== 'object' || !UUID.test(scope.key || '') || !UUID.test(scope.organizationId || '') ||
        !UUID.test(scope.userId || '') || scope.operation !== MESSAGE_OPERATION ||
        typeof scope.fingerprint !== 'string' || !FINGERPRINT.test(scope.fingerprint)) {
      throw contractError('POLARIS_IDEMPOTENCY_SCOPE_INVALID', 'The idempotency scope is invalid.', 500);
    }
    return [scope.organizationId.toLowerCase(), scope.userId.toLowerCase(), scope.operation,
      scope.key.toLowerCase()].join('|');
  }

  function removeExpired(now) {
    for (const [key, entry] of entries) {
      if (entry.state !== 'pending' && entry.expiresAt <= now) entries.delete(key);
    }
  }

  function makeCapacity(now) {
    removeExpired(now);
    if (entries.size < maximumEntries) return;
    const completed = Array.from(entries.entries())
      .filter(([, entry]) => entry.state !== 'pending')
      .sort((left, right) => left[1].settledAt - right[1].settledAt || left[1].sequence - right[1].sequence);
    if (completed.length) {
      entries.delete(completed[0][0]);
      return;
    }
    throw contractError('POLARIS_IDEMPOTENCY_CAPACITY', 'The bounded idempotency registry is temporarily full.', 429);
  }

  let sequence = 0;
  function execute(scope, operation, options = {}) {
    if (typeof operation !== 'function') throw new TypeError('An idempotent operation function is required.');
    let now;
    try { now = readClock(); } catch (error) { return Promise.reject(error); }
    const key = scopeKey(scope);
    removeExpired(now);
    const existing = entries.get(key);
    if (existing) {
      if (existing.fingerprint !== scope.fingerprint) {
        return Promise.reject(contractError(
          'POLARIS_IDEMPOTENCY_KEY_REUSED',
          'This idempotency key is already bound to a different Polaris request.',
          409
        ));
      }
      if (options.signal && options.signal.aborted) return Promise.reject(interceptedAbortError());
      if (existing.state === 'fulfilled') return Promise.resolve(existing.value);
      if (existing.state === 'rejected') return Promise.reject(existing.error);
      return subscribe(existing, options.signal);
    }
    makeCapacity(now);
    const entry = {
      fingerprint: scope.fingerprint,
      state: 'pending',
      sequence: ++sequence,
      settledAt: null,
      expiresAt: null,
      promise: null,
      value: undefined,
      error: undefined,
      startedAt: now,
      controller: new AbortController(),
      subscribers: 0,
    };
    entries.set(key, entry);
    const operationPromise = Promise.resolve().then(() => operation(entry.controller.signal));
    const abortPromise = new Promise((_resolve, reject) => {
      entry.controller.signal.addEventListener('abort', () => reject(interceptedAbortError()), { once: true });
    });
    entry.promise = Promise.race([operationPromise, abortPromise]).then(value => {
      let settledAt;
      try {
        settledAt = readClock(entry.startedAt);
        const expiresAt = settledAt + retentionMs;
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= settledAt) throw clockError();
        entry.state = 'fulfilled';
        entry.value = value;
        entry.settledAt = settledAt;
        entry.expiresAt = expiresAt;
      } catch (error) {
        entries.delete(key);
        throw error && error.code === 'POLARIS_IDEMPOTENCY_CLOCK_INVALID' ? error : clockError();
      }
      return value;
    }, error => {
      let settledAt;
      try {
        settledAt = readClock(entry.startedAt);
        const expiresAt = settledAt + retentionMs;
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= settledAt) throw clockError();
        entry.state = 'rejected';
        entry.error = error;
        entry.settledAt = settledAt;
        entry.expiresAt = expiresAt;
      } catch (clockFailure) {
        entries.delete(key);
        throw clockFailure && clockFailure.code === 'POLARIS_IDEMPOTENCY_CLOCK_INVALID' ? clockFailure : clockError();
      }
      throw error;
    });
    return subscribe(entry, options.signal);
  }

  function subscribe(entry, signal) {
    entry.subscribers += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      let abortListener;
      function finish(callback, value) {
        if (settled) return;
        settled = true;
        if (signal && abortListener) signal.removeEventListener('abort', abortListener);
        entry.subscribers -= 1;
        if (entry.state === 'pending' && entry.subscribers === 0) entry.controller.abort();
        callback(value);
      }
      if (signal) {
        abortListener = function () { finish(reject, interceptedAbortError()); };
        if (signal.aborted) {
          abortListener();
          return;
        }
        signal.addEventListener('abort', abortListener, { once: true });
      }
      entry.promise.then(value => finish(resolve, value), error => finish(reject, error));
    });
  }

  return Object.freeze({ execute });
}

function executeIdempotentMessage(registry, request, authority, operation, options = {}) {
  return registry.execute({
    key: request.idempotencyKey,
    organizationId: authority.organizationId,
    userId: authority.userId,
    operation: MESSAGE_OPERATION,
    fingerprint: messageRequestFingerprint(request, authority),
  }, operation, options);
}

async function executeIntercepted(runtime, request, authority, localContext, options = {}) {
  const intercepted = normalizeRuntime(runtime);
  if (!intercepted) {
    throw contractError(
      'POLARIS_PROVIDER_DECISIONS_REQUIRED',
      `Provider-backed conversation remains unavailable until these decisions are approved: ${PROVIDER_DECISIONS.join(', ')}.`,
      503
    );
  }
  const boundary = createInterceptedBoundary(options.signal);
  try {
    const status = await statusForRuntime(intercepted, { requestId: request.idempotencyKey }, {
      deadlineAt: boundary.deadlineAt,
      signal: boundary.signal,
    });
    if (status.state !== 'available') {
      throw contractError('POLARIS_ASSISTANT_UNAVAILABLE', `Intercepted assistant state is ${status.state}.`, 503);
    }
    const envelope = Object.freeze({
    schemaVersion: request.schemaVersion,
    requestId: request.idempotencyKey,
    authority: Object.freeze({ ...authority }),
    untrustedInput: Object.freeze({ message: request.message, selected: request.selected }),
    untrustedContext: localContext ? Object.freeze({
      selected: localContext.selected,
      answer: localContext.answer,
      cards: localContext.cards,
    }) : null,
    safety: Object.freeze({
      storedCustomerContentIsDataOnly: true,
      followStoredInstructions: false,
      canonicalMutationAllowed: false,
      secretsAllowed: false,
    }),
    });
    const result = await raceInterceptedAction(
      () => intercepted.respond(envelope, Object.freeze({ signal: boundary.signal })),
      { deadlineAt: boundary.deadlineAt, signal: boundary.signal }
    );
    return boundedInterceptedResponse(result, request, authority);
  } finally {
    boundary.dispose();
  }
}

module.exports = {
  IDEMPOTENCY_MAXIMUM_ENTRIES,
  IDEMPOTENCY_RETENTION_MS,
  INTERCEPTED_TIMEOUT_MS,
  MAX_INTERCEPTED_RESPONSE_BYTES,
  boundedInterceptedResponse,
  createIdempotencyRegistry,
  executeIntercepted,
  executeIdempotentMessage,
  normalizeRuntime,
  statusForRuntime,
};
