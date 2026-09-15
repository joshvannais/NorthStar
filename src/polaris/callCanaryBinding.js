'use strict';

const crypto = require('crypto');
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;

function bindingDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify({
    organizationId: value.organizationId.toLowerCase(), agentId: value.agentId,
    agentVersion: value.agentVersion, llmId: value.llmId, llmVersion: value.llmVersion,
    basePromptDigest: value.basePromptDigest, consentVersion: value.consentVersion,
    exclusive: value.exclusive, syntheticOnly: value.syntheticOnly,
    maxGenerationsPerCall: value.maxGenerationsPerCall, maxCallDurationMs: value.maxCallDurationMs,
  })).digest('hex');
}

function parseCallCanaryBinding(raw) {
  let value;
  try { value = JSON.parse(raw || ''); } catch (_) { return null; }
  if (!value || Array.isArray(value) || Object.keys(value).sort().join('|') !== [
    'agentId', 'agentVersion', 'basePromptDigest', 'consentVersion', 'exclusive', 'llmId',
    'llmVersion', 'maxCallDurationMs', 'maxGenerationsPerCall', 'organizationId', 'syntheticOnly',
  ].sort().join('|')) return null;
  if (!UUID.test(value.organizationId) || value.exclusive !== true || value.syntheticOnly !== true ||
      value.maxGenerationsPerCall !== 1 || value.maxCallDurationMs !== 60000 ||
      !Number.isSafeInteger(value.agentVersion) || value.agentVersion < 0 ||
      !Number.isSafeInteger(value.llmVersion) || value.llmVersion < 0 || !DIGEST.test(value.basePromptDigest)) return null;
  for (const field of ['agentId', 'llmId', 'consentVersion']) {
    if (typeof value[field] !== 'string' || !value[field] || value[field].length > 200 || /[\u0000-\u0020]/.test(value[field])) return null;
  }
  const normalized = {
    organizationId: value.organizationId.toLowerCase(), agentId: value.agentId,
    agentVersion: value.agentVersion, llmId: value.llmId, llmVersion: value.llmVersion,
    basePromptDigest: value.basePromptDigest, consentVersion: value.consentVersion,
    exclusive: true, syntheticOnly: true, maxGenerationsPerCall: 1, maxCallDurationMs: 60000,
  };
  return Object.freeze({ ...normalized, bindingDigest: bindingDigest(normalized) });
}

module.exports = { bindingDigest, parseCallCanaryBinding };
