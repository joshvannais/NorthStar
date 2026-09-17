'use strict';

const contract = require('../../src/learning/nativeMaterialOutcomeContract');

const estimateId = '123e4567-e89b-42d3-a456-426614174000';
const executionId = '223e4567-e89b-42d3-a456-426614174001';
const firstLine = '323e4567-e89b-42d3-a456-426614174002';
const secondLine = '423e4567-e89b-42d3-a456-426614174003';
const digest = 'a'.repeat(64);

describe('Mission 25 native material outcome contract', () => {
  test('normalizes explicit consent and deterministic exact line bindings', () => {
    expect(contract.normalizeConsent({
      action: 'grant', expectedRevision: 0, expectedDigest: 'none',
      reason: 'Use reviewed NorthStar material movements.', confirmed: true,
      confirmationVersion: contract.CONSENT_VERSION,
    }).action).toBe('grant');

    expect(contract.normalizeObservation(estimateId, executionId, {
      expectedConsentRevision: 1, expectedConsentDigest: digest,
      bindings: [{ lineId: secondLine, itemKey: 'support.boards' },
        { lineId: firstLine, itemKey: 'cedar.boards' }],
      reason: 'Compare exact planned and reviewed material quantities.', confirmed: true,
      confirmationVersion: contract.OBSERVATION_VERSION,
    }).bindings).toEqual([
      { lineId: firstLine, itemKey: 'cedar.boards' },
      { lineId: secondLine, itemKey: 'support.boards' },
    ]);
  });

  test('rejects duplicate, fuzzy, extra and implicit inputs', () => {
    const valid = {
      expectedConsentRevision: 1, expectedConsentDigest: digest,
      bindings: [{ lineId: firstLine, itemKey: 'cedar.boards' }],
      reason: 'Compare exact quantities.', confirmed: true,
      confirmationVersion: contract.OBSERVATION_VERSION,
    };
    expect(() => contract.normalizeObservation(estimateId, executionId, {
      ...valid, bindings: [...valid.bindings, { lineId: secondLine, itemKey: 'cedar.boards' }],
    })).toThrow('unique');
    expect(() => contract.normalizeObservation(estimateId, executionId, {
      ...valid, bindings: [{ lineId: firstLine, itemKey: 'Cedar Boards' }],
    })).toThrow();
    expect(() => contract.normalizeObservation(estimateId, executionId, {
      ...valid, conversionRate: 12,
    })).toThrow();
    expect(() => contract.normalizeConsent({
      action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Use evidence.',
      confirmed: false, confirmationVersion: contract.CONSENT_VERSION,
    })).toThrow();
  });
});
