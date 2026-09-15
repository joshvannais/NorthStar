'use strict';

const crypto = require('crypto');

const ACCOUNTING_VERSION = 'northstar.openai.counted-generation.v1';
const COUNT_ENDPOINT_VERSION = 'openai.responses.input_tokens.v1';
const TOTAL_RESERVATION_NANO_USD = 20000000;
const MAX_GENERATION_COST_NANO_USD = 13830400;
const MAX_COUNT_COST_NANO_USD = TOTAL_RESERVATION_NANO_USD - MAX_GENERATION_COST_NANO_USD;
const DIGEST = /^[a-f0-9]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseCountAccounting(environment = {}) {
  const supplied = [
    environment.POLARIS_INPUT_COUNT_ACCOUNTING_VERSION,
    environment.POLARIS_INPUT_COUNT_MAX_COST_NANO_USD,
    environment.POLARIS_INPUT_COUNT_TARIFF_EVIDENCE_DIGEST,
    environment.POLARIS_INPUT_COUNT_TARIFF_REVIEWED_ON,
  ];
  if (supplied.every(value => value === undefined || value === '')) return null;
  if (environment.POLARIS_INPUT_COUNT_ACCOUNTING_VERSION !== COUNT_ENDPOINT_VERSION ||
      !/^(0|[1-9][0-9]{0,6})$/.test(String(environment.POLARIS_INPUT_COUNT_MAX_COST_NANO_USD || '')) ||
      !DIGEST.test(String(environment.POLARIS_INPUT_COUNT_TARIFF_EVIDENCE_DIGEST || '')) ||
      !ISO_DATE.test(String(environment.POLARIS_INPUT_COUNT_TARIFF_REVIEWED_ON || ''))) return null;
  const maxCostNanoUsd = Number(environment.POLARIS_INPUT_COUNT_MAX_COST_NANO_USD);
  if (!Number.isSafeInteger(maxCostNanoUsd) || maxCostNanoUsd < 0 || maxCostNanoUsd > MAX_COUNT_COST_NANO_USD) return null;
  return Object.freeze({
    accountingVersion: ACCOUNTING_VERSION,
    endpointVersion: COUNT_ENDPOINT_VERSION,
    maxCostNanoUsd,
    tariffEvidenceDigest: environment.POLARIS_INPUT_COUNT_TARIFF_EVIDENCE_DIGEST,
    tariffReviewedOn: environment.POLARIS_INPUT_COUNT_TARIFF_REVIEWED_ON,
  });
}

function countReceipt({ body, response, accounting, startedAt, outcomeClass }) {
  if (!accounting || accounting.accountingVersion !== ACCOUNTING_VERSION) throw new TypeError('Count accounting is unavailable.');
  const inputTokens = response && Number.isSafeInteger(response.input_tokens) ? response.input_tokens : null;
  return Object.freeze({
    endpointVersion: accounting.endpointVersion,
    requestDigest: digest(body),
    responseDigest: response ? digest({ object: response.object, input_tokens: response.input_tokens }) : null,
    inputTokens,
    costCeilingNanoUsd: accounting.maxCostNanoUsd,
    tariffEvidenceDigest: accounting.tariffEvidenceDigest,
    tariffReviewedOn: accounting.tariffReviewedOn,
    outcomeClass,
    attemptCount: 1,
    latencyMs: Math.max(0, Date.now() - startedAt),
  });
}

function combineUsage(count, generation) {
  if (!count || !generation) throw new TypeError('Count and generation receipts are required.');
  const costNanoUsd = count.costCeilingNanoUsd + generation.costNanoUsd;
  if (!Number.isSafeInteger(costNanoUsd) || costNanoUsd > TOTAL_RESERVATION_NANO_USD) throw new TypeError('Combined provider usage exceeds its reservation.');
  return Object.freeze({
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
    costNanoUsd,
    latencyMs: Math.max(count.latencyMs, generation.latencyMs),
    attemptCount: count.attemptCount + generation.attemptCount,
    outcomeClass: generation.outcomeClass,
    providerRequestId: generation.providerRequestId,
    accountingVersion: ACCOUNTING_VERSION,
    count,
    generation,
  });
}

function reconciliationUsage(usage) {
  return Object.freeze({
    inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    costNanoUsd: usage.costNanoUsd, latencyMs: usage.latencyMs,
    attemptCount: usage.attemptCount, outcomeClass: usage.outcomeClass,
    providerRequestId: usage.providerRequestId,
  });
}

module.exports = {
  ACCOUNTING_VERSION,
  COUNT_ENDPOINT_VERSION,
  MAX_COUNT_COST_NANO_USD,
  MAX_GENERATION_COST_NANO_USD,
  TOTAL_RESERVATION_NANO_USD,
  combineUsage,
  countReceipt,
  parseCountAccounting,
  reconciliationUsage,
};
