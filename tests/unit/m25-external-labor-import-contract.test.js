'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const contract = require('../../src/learning/externalLaborImportContract');

const digest = 'a'.repeat(64);
const sourceKey = 'payroll.primary';
const active = Object.freeze({ externalRecordId: 'shift-1', externalVersion: 1, state: 'active',
  workerReference: 'worker-7', jobReference: 'job-19', category: 'production',
  observedStart: '2026-09-15T13:00:00.000Z', observedEnd: '2026-09-15T17:00:00.000Z',
  sourceUpdatedAt: '2026-09-15T17:05:00.000Z' });

test('normalizes source consent and bounded historical and continuous batches', () => {
  const consent = { action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Import this source.',
    confirmed: true, confirmationVersion: 'm25-external-labor-import-consent-v1' };
  assert.equal(contract.normalizeConsent(sourceKey, consent).sourceKey, sourceKey);
  const historicalBody = { schemaVersion: 'm25-external-labor-time-v1',
    mode: 'historical_backfill', expectedConsentRevision: 1, expectedConsentDigest: digest,
    cursorBefore: null, cursorAfter: null, complete: true, records: [active], reason: 'Import reviewed history.',
    confirmed: true, confirmationVersion: 'm25-external-labor-import-batch-v1' };
  const historical = contract.normalizeBatch(sourceKey, historicalBody);
  assert.equal(historical.records[0].externalRecordId, 'shift-1');
  const continuous = contract.normalizeBatch(sourceKey, { ...historicalBody, mode: 'continuous_update', complete: false,
    cursorAfter: 'cursor-1' });
  assert.equal(continuous.cursorAfter, 'cursor-1');
  assert.equal(contract.normalizeBatch(sourceKey, { ...historicalBody, mode: 'continuous_update', complete: false,
    cursorAfter: 'c'.repeat(200) }).cursorAfter.length, 200);
});

test('rejects unconfirmed, duplicate, oversized, future, ambiguous cursor and tombstone payloads', () => {
  const base = { schemaVersion: 'm25-external-labor-time-v1', mode: 'historical_backfill',
    expectedConsentRevision: 1, expectedConsentDigest: digest, cursorBefore: null, cursorAfter: null, complete: true,
    records: [active], reason: 'Import reviewed history.', confirmed: true,
    confirmationVersion: 'm25-external-labor-import-batch-v1' };
  const tombstone = { ...active, externalVersion: 2, state: 'tombstone', workerReference: null, jobReference: null,
    category: null, observedStart: null, observedEnd: null };
  assert.equal(contract.normalizeBatch(sourceKey, { ...base, records: [tombstone] }).records[0].state, 'tombstone');
  for (const candidate of [
    { ...base, confirmed: false }, { ...base, extra: true }, { ...base, records: [active, active] },
    { ...base, complete: true, cursorAfter: 'more' },
    { ...base, records: [{ ...tombstone, workerReference: 'worker-7' }] },
    { ...base, records: [{ ...active, observedEnd: '2026-09-25T17:00:00.000Z' }] },
    { ...base, records: [{ ...active, sourceUpdatedAt: '2026-99-99T17:05:00.000Z' }] },
  ]) assert.throws(() => contract.normalizeBatch(sourceKey, candidate), error => error.code === 'M25_IMPORT_INPUT_INVALID');
  assert.throws(() => contract.normalizeSourceKey('Payroll Primary'), error => error.code === 'M25_IMPORT_INPUT_INVALID');
});
