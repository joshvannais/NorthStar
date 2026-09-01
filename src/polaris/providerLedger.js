'use strict';

const { RESPONSE_SCHEMA, UUID, contractError } = require('./assistantContract');

const RESERVED_COST_NANO_USD = 20000000;
const PROJECT_MINIMUM_CAP_NANO_USD = 100000000000;
const USER_LIMITS = Object.freeze({ minute: 12, hour: 120, day: 600, concurrent: 1 });
const TENANT_LIMITS = Object.freeze({ minute: 60, hour: 600, day: 3000, concurrent: 4 });
const RETENTION_DAYS = Object.freeze({ operational: 30, security: 90, aggregateMonths: 13 });
const MODEL = 'gpt-5.6-luna';

function usageAuthorityUnavailable() {
  return contractError(
    'POLARIS_USAGE_AUTHORITY_UNAVAILABLE',
    'Polaris usage authority is temporarily unavailable.',
    503
  );
}

function queryable(poolProvider) {
  let pool;
  try { pool = poolProvider(); } catch (_error) { throw usageAuthorityUnavailable(); }
  if (!pool || typeof pool.query !== 'function') throw usageAuthorityUnavailable();
  return pool;
}

function exactUuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw contractError('POLARIS_USAGE_CONTRACT_INVALID', `${label} must be one UUID.`, 500);
  }
  return value.toLowerCase();
}

function denialError(row) {
  const denial = String(row.denial_code || '');
  const retry = Number.isSafeInteger(Number(row.retry_after_seconds))
    ? Math.max(1, Math.min(86400, Number(row.retry_after_seconds))) : 60;
  let error;
  if (denial === 'idempotency_conflict') {
    error = contractError(
      'POLARIS_IDEMPOTENCY_KEY_REUSED',
      'This idempotency key is already bound to a durable Polaris request.',
      409
    );
  } else if (denial === 'tenant_spend_limit' || denial === 'project_spend_limit') {
    error = contractError(
      'POLARIS_USAGE_LIMIT',
      'Polaris conversation is temporarily unavailable because a usage limit was reached.',
      429
    );
  } else {
    error = contractError(
      'POLARIS_RATE_LIMIT',
      'Polaris conversation is temporarily busy. Try again after the indicated delay.',
      429
    );
  }
  error.retryAfterSeconds = retry;
  return error;
}

function mapDatabaseError(error) {
  if (error && error.code && String(error.code).startsWith('POLARIS_')) return error;
  if (error && error.constraint === 'polaris_provider_actor_not_entitled') {
    return contractError('POLARIS_CONVERSATION_UNAVAILABLE', 'Conversation is unavailable for this account.', 403);
  }
  if (error && (error.constraint === 'polaris_provider_reservation_contract' ||
      error.constraint === 'polaris_provider_reconciliation_contract')) {
    return contractError('POLARIS_USAGE_CONTRACT_INVALID', 'The Polaris usage contract was rejected.', 500);
  }
  return usageAuthorityUnavailable();
}

function validateReservationInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw contractError('POLARIS_USAGE_CONTRACT_INVALID', 'A bounded usage reservation is required.', 500);
  }
  const organizationId = exactUuid(input.organizationId, 'organizationId');
  const userId = exactUuid(input.userId, 'userId');
  const requestId = exactUuid(input.requestId, 'requestId');
  if (input.model !== MODEL || input.schemaVersion !== RESPONSE_SCHEMA) {
    throw contractError('POLARIS_USAGE_CONTRACT_INVALID', 'The model or schema reservation is unsupported.', 500);
  }
  return Object.freeze({ organizationId, userId, requestId });
}

function validateUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage) ||
      !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 || usage.inputTokens > 16000 ||
      !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0 || usage.outputTokens > 8192 ||
      !Number.isSafeInteger(usage.costNanoUsd) || usage.costNanoUsd < 0 || usage.costNanoUsd > RESERVED_COST_NANO_USD ||
      ![1, 2].includes(usage.attemptCount) ||
      !['completed', 'refused', 'incomplete', 'failed'].includes(usage.outcomeClass) ||
      !(usage.providerRequestId === null || usage.providerRequestId === undefined ||
        (typeof usage.providerRequestId === 'string' && usage.providerRequestId.length >= 1 &&
          usage.providerRequestId.length <= 128))) {
    throw contractError('POLARIS_USAGE_CONTRACT_INVALID', 'The reconciled usage contract is invalid.', 500);
  }
  return usage;
}

function createProviderUsageLedger(options = {}) {
  const poolProvider = typeof options.poolProvider === 'function' ? options.poolProvider : function () { return null; };

  async function reserve(input) {
    const authority = validateReservationInput(input);
    let result;
    try {
      result = await queryable(poolProvider).query(
        `SELECT * FROM public.polaris_provider_reserve_usage($1,$2,$3,$4,$5,$6)`,
        [authority.organizationId, authority.userId, authority.requestId, MODEL, RESPONSE_SCHEMA,
          RESERVED_COST_NANO_USD]
      );
    } catch (error) {
      throw mapDatabaseError(error);
    }
    const row = result && result.rows && result.rows[0];
    if (!row || row.admitted !== true) {
      if (row && row.admitted === false) throw denialError(row);
      throw usageAuthorityUnavailable();
    }
    if (typeof row.reservation_id !== 'string' || !UUID.test(row.reservation_id) ||
        Number(row.reserved_cost_nano_usd) !== RESERVED_COST_NANO_USD) {
      throw usageAuthorityUnavailable();
    }
    return Object.freeze({
      id: row.reservation_id.toLowerCase(),
      organizationId: authority.organizationId,
      userId: authority.userId,
      requestId: authority.requestId,
      reservedCostNanoUsd: RESERVED_COST_NANO_USD,
    });
  }

  async function reconcile(reservation, suppliedUsage) {
    if (!reservation || typeof reservation !== 'object' ||
        !UUID.test(reservation.id || '') || !UUID.test(reservation.organizationId || '') ||
        !UUID.test(reservation.userId || '')) {
      throw contractError('POLARIS_USAGE_CONTRACT_INVALID', 'A valid Polaris reservation is required.', 500);
    }
    const usage = validateUsage(suppliedUsage);
    try {
      const result = await queryable(poolProvider).query(
        `SELECT public.polaris_provider_reconcile_usage($1,$2,$3,$4,$5,$6,$7,$8,$9) AS reconciled`,
        [reservation.organizationId, reservation.userId, reservation.id, usage.costNanoUsd,
          usage.inputTokens, usage.outputTokens, usage.attemptCount, usage.outcomeClass,
          usage.providerRequestId || null]
      );
      if (!result || !result.rows || !result.rows[0] || result.rows[0].reconciled !== true) {
        throw usageAuthorityUnavailable();
      }
      return true;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  return Object.freeze({ reconcile, reserve });
}

module.exports = {
  PROJECT_MINIMUM_CAP_NANO_USD,
  RESERVED_COST_NANO_USD,
  RETENTION_DAYS,
  TENANT_LIMITS,
  USER_LIMITS,
  createProviderUsageLedger,
};
