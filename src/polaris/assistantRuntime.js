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

async function statusForRuntime(runtime, req) {
  const intercepted = normalizeRuntime(runtime);
  if (!intercepted) return validateAssistantStatus(unconfiguredStatus(requestId(req)));
  let supplied;
  try { supplied = await intercepted.status(); } catch (_error) {
    return validateAssistantStatus(Object.freeze({
      ...unconfiguredStatus(requestId(req)),
      state: 'error',
      label: 'Intercepted assistant status unavailable',
    }));
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
  function execute(scope, operation) {
    if (typeof operation !== 'function') throw new TypeError('An idempotent operation function is required.');
    const now = Number(clock());
    if (!Number.isFinite(now)) throw new TypeError('The idempotency clock is invalid.');
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
      if (existing.state === 'fulfilled') return Promise.resolve(existing.value);
      if (existing.state === 'rejected') return Promise.reject(existing.error);
      return existing.promise;
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
    };
    entries.set(key, entry);
    entry.promise = Promise.resolve().then(operation).then(value => {
      entry.state = 'fulfilled';
      entry.value = value;
      entry.settledAt = Number(clock());
      entry.expiresAt = entry.settledAt + retentionMs;
      return value;
    }, error => {
      entry.state = 'rejected';
      entry.error = error;
      entry.settledAt = Number(clock());
      entry.expiresAt = entry.settledAt + retentionMs;
      throw error;
    });
    return entry.promise;
  }

  return Object.freeze({ execute });
}

function executeIdempotentMessage(registry, request, authority, operation) {
  return registry.execute({
    key: request.idempotencyKey,
    organizationId: authority.organizationId,
    userId: authority.userId,
    operation: MESSAGE_OPERATION,
    fingerprint: messageRequestFingerprint(request, authority),
  }, operation);
}

async function executeIntercepted(runtime, request, authority, localContext) {
  const intercepted = normalizeRuntime(runtime);
  if (!intercepted) {
    throw contractError(
      'POLARIS_PROVIDER_DECISIONS_REQUIRED',
      `Provider-backed conversation remains unavailable until these decisions are approved: ${PROVIDER_DECISIONS.join(', ')}.`,
      503
    );
  }
  const status = await statusForRuntime(intercepted, { requestId: request.idempotencyKey });
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
  let timeout;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => intercepted.respond(envelope)),
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(contractError(
          'POLARIS_INTERCEPTED_TIMEOUT',
          'The intercepted test runtime exceeded its test-only timeout.',
          504
        )), INTERCEPTED_TIMEOUT_MS);
      }),
    ]);
    return boundedInterceptedResponse(result, request, authority);
  } finally {
    if (timeout) clearTimeout(timeout);
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
