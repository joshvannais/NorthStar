'use strict';

const {
  CARD_SCHEMA,
  PROVIDER_DECISIONS,
  RESPONSE_SCHEMA,
  contractError,
  unconfiguredStatus,
} = require('./assistantContract');

const MAX_INTERCEPTED_RESPONSE_BYTES = 64 * 1024;
const INTERCEPTED_TIMEOUT_MS = 1000;

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
  if (!intercepted) return unconfiguredStatus(requestId(req));
  let supplied;
  try { supplied = await intercepted.status(); } catch (_error) {
    return Object.freeze({
      ...unconfiguredStatus(requestId(req)),
      state: 'error',
      label: 'Intercepted assistant status unavailable',
    });
  }
  const state = supplied && supplied.state;
  if (!['local', 'unconfigured', 'error', 'available'].includes(state)) {
    throw contractError('POLARIS_RUNTIME_STATUS_INVALID', 'Intercepted runtime returned an invalid status.', 502);
  }
  return Object.freeze({
    ...unconfiguredStatus(requestId(req)),
    state,
    label: String(supplied.label || `Intercepted assistant ${state}`),
    intercepted: true,
    providerRequestsEnabled: false,
    providerRequestsSent: 0,
  });
}

function sameSelection(left, right) {
  if (!left || !right) return left === right;
  return left.kind === right.kind && left.id === right.id;
}

function boundedInterceptedResponse(value, request, authority) {
  const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).sort() : [];
  const expected = [
    'advisoryOnly', 'answer', 'authority', 'canonicalMutationAllowed', 'cards', 'provider',
    'requestId', 'responseId', 'schemaVersion', 'selected', 'source', 'state',
  ].sort();
  const answerKeys = value && value.answer && typeof value.answer === 'object'
    ? Object.keys(value.answer).sort() : [];
  if (!value || keys.length !== expected.length || keys.some((key, index) => key !== expected[index]) ||
      value.schemaVersion !== RESPONSE_SCHEMA || value.requestId !== request.idempotencyKey ||
      typeof value.responseId !== 'string' || value.responseId.length < 1 || value.responseId.length > 128 ||
      value.state !== 'available' || value.source !== 'interceptor' ||
      !value.authority || value.authority.organizationId !== authority.organizationId ||
      value.authority.userId !== authority.userId || value.authority.role !== authority.role ||
      !sameSelection(value.selected, request.selected) ||
      answerKeys.join('|') !== 'evidenceCount|text|unknownCount' ||
      typeof value.answer.text !== 'string' || value.answer.text.length < 1 || value.answer.text.length > 8000 ||
      !Number.isSafeInteger(value.answer.evidenceCount) || value.answer.evidenceCount < 0 ||
      !Number.isSafeInteger(value.answer.unknownCount) || value.answer.unknownCount < 0 ||
      !Array.isArray(value.cards) || value.cards.length > 4 ||
      value.cards.some(card => !card || card.schemaVersion !== CARD_SCHEMA || card.advisoryOnly !== true ||
        card.canonicalMutationAllowed !== false) ||
      !value.provider || value.provider.state !== 'unconfigured' || value.provider.requestsSent !== 0 ||
      value.canonicalMutationAllowed !== false || value.advisoryOnly !== true) {
    throw contractError('POLARIS_INTERCEPTED_RESPONSE_INVALID', 'Intercepted runtime returned an invalid assistant response.', 502);
  }
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > MAX_INTERCEPTED_RESPONSE_BYTES) {
    throw contractError('POLARIS_INTERCEPTED_RESPONSE_TOO_LARGE', 'Intercepted runtime response exceeded the bounded response contract.', 502);
  }
  return value;
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
  INTERCEPTED_TIMEOUT_MS,
  MAX_INTERCEPTED_RESPONSE_BYTES,
  executeIntercepted,
  normalizeRuntime,
  statusForRuntime,
};
