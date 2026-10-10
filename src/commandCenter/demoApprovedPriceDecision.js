'use strict';

const { v5: uuidv5 } = require('uuid');
const { sha256, stableValue } = require('../services/businessProfileAdapter');

const CONTRACT = 'northstar_fictional_approved_price_decision_v1';
const NAMESPACE = '0bb87299-b01c-44b1-a1d2-ed9a649de9a4';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function exactMoney(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const amount = value.toFixed(2);
  const minorUnits = Number(amount.replace('.', ''));
  if (!Number.isSafeInteger(minorUnits) || Number(amount) !== value) return null;
  return stableValue({ amount, minorUnits });
}

function decisionBasis(input) {
  const money = exactMoney(input && input.amount);
  const approvedAt = new Date(input && input.approvedAt);
  if (!input || !UUID.test(input.tenantId || '') || !UUID.test(input.graphId || '') ||
      !UUID.test(input.estimateId || '') || !UUID.test(input.sourceSnapshotId || '') ||
      !DIGEST.test(input.sourceSnapshotDigest || '') || !money || input.currency !== 'USD' ||
      !Number.isFinite(approvedAt.getTime())) return null;
  return stableValue({
    contract: CONTRACT,
    id: uuidv5(`${input.graphId}:${input.estimateId}:${input.sourceSnapshotDigest}:${money.amount}`, NAMESPACE),
    decision: 'approved',
    state: 'accepted',
    estimateId: input.estimateId,
    sourceSnapshotId: input.sourceSnapshotId,
    sourceSnapshotDigest: input.sourceSnapshotDigest,
    amount: money.amount,
    amountMinorUnits: money.minorUnits,
    currency: input.currency,
    reviewer: {
      id: uuidv5('account-free-demo-owner', input.tenantId),
      type: 'fictional_human',
      accessRole: 'owner',
    },
    reviewedAt: approvedAt.toISOString(),
    approvedAt: approvedAt.toISOString(),
    fictional: true,
  });
}

function createApprovedPriceDecision(input) {
  const basis = decisionBasis(input);
  if (!basis) throw new Error('Explicit fictional approved-price decision evidence is invalid.');
  return stableValue({ ...basis, digest: sha256({ contract: CONTRACT, decision: basis }) });
}

function verifyApprovedPriceDecision(value, input) {
  const basis = decisionBasis(input);
  if (!basis || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = stableValue({ ...basis, digest: sha256({ contract: CONTRACT, decision: basis }) });
  return sha256(value) === sha256(expected);
}

module.exports = {
  CONTRACT,
  createApprovedPriceDecision,
  exactMoney,
  verifyApprovedPriceDecision,
};
