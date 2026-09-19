'use strict';
const contract = require('../../src/learning/externalProjectChangeOrderImportContract');
const digest = 'a'.repeat(64);
const unavailable = () => ({ status: 'unavailable', amount: null, currency: null });
const recorded = amount => ({ status: 'recorded', amount, currency: 'USD' });
const changeValue = (amount, effect = 'increase') => ({ status: 'recorded', effect, amount, currency: 'USD' });
const record = (recordType = 'project') => ({
  externalRecordId: `${recordType}-1`, externalVersion: 1, state: 'active', recordType,
  customerReference: 'customer-1', jobReference: 'job-1', estimateReference: 'estimate-1',
  projectReference: 'project-1', changeOrderReference: recordType === 'change_order' ? 'change-1' : null,
  recordState: recordType === 'project' ? 'active' : 'approved',
  originalContract: recordType === 'project' ? recorded('125000.00') : null,
  currentContract: recordType === 'project' ? recorded('132500.00') : null,
  changeOrderValue: recordType === 'change_order' ? changeValue('7500.00') : null,
  occurredAt: '2026-09-15T12:00:00.000Z', endedAt: null, timeZone: 'America/New_York',
  evidenceClass: 'provider_recorded', providerEvidenceDigest: 'b'.repeat(64),
  sourceUpdatedAt: '2026-09-15T17:00:00.000Z',
});
const batch = records => ({ schemaVersion: contract.SCHEMA_VERSION, mode: 'historical_backfill', expectedConsentRevision: 1,
  expectedConsentDigest: digest, cursorBefore: null, cursorAfter: null, complete: true, records,
  reason: 'Import this reviewed project evidence page.', confirmed: true, confirmationVersion: contract.BATCH_VERSION });

describe('Mission 25 external project and change-order evidence contract', () => {
  test('keeps original, current and change-order values distinct', () => {
    const values = contract.normalizeBatch('projects.primary', batch([record('project'), record('change_order')])).records;
    expect(values[0].originalContract.amount).toBe('125000.00');
    expect(values[0].currentContract.amount).toBe('132500.00');
    expect(values[0].changeOrderValue).toBeNull();
    expect(values[1].originalContract).toBeNull();
    expect(values[1].changeOrderValue.amount).toBe('7500.00');
  });
  test('preserves explicit unavailable values without deriving an amount', () => {
    const value = record(); value.currentContract = unavailable();
    expect(contract.normalizeRecord(value).currentContract).toEqual(unavailable());
  });
  test('rejects guessed, malformed and cross-purpose values', () => {
    for (const change of [value => { value.originalContract.amount = '-1'; }, value => { value.currentContract.currency = 'usd'; },
      value => { value.currentContract.amount = 132500; }, value => { value.projectReference = 123; },
      value => { value.currentContract = { status: 'unavailable', amount: '0', currency: null }; },
      value => { value.changeOrderReference = 'change-1'; }, value => { value.changeOrderValue = changeValue('1.00'); }]) {
      const value = record(); change(value); expect(() => contract.normalizeRecord(value)).toThrow();
    }
    const change = record('change_order'); change.originalContract = recorded('125000.00');
    expect(() => contract.normalizeRecord(change)).toThrow();
    const deduction = record('change_order'); deduction.changeOrderValue = changeValue('2500.00', 'decrease');
    expect(contract.normalizeRecord(deduction).changeOrderValue.effect).toBe('decrease');
    const badZero = record('change_order'); badZero.changeOrderValue = changeValue('0', 'increase');
    expect(() => contract.normalizeRecord(badZero)).toThrow();
  });
  test('requires a project lineage for every change order and detail-free tombstones', () => {
    const value = record('change_order'); value.projectReference = null;
    expect(() => contract.normalizeRecord(value)).toThrow(/references/);
    const removed = record();
    for (const key of Object.keys(removed)) if (!['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(key)) removed[key] = null;
    Object.assign(removed, { externalVersion: 2, state: 'tombstone' });
    expect(contract.normalizeRecord(removed).state).toBe('tombstone'); removed.currentContract = unavailable();
    expect(() => contract.normalizeRecord(removed)).toThrow(/cannot retain/);
  });
  test('requires pinned consent and bounded resumable pages', () => {
    expect(() => contract.normalizeBatch('projects.primary', batch(Array.from({ length: 101 }, (_, index) => ({ ...record(), externalRecordId: `r-${index}` })))))
      .toThrow();
    expect(() => contract.normalizeBatch('projects.primary', batch([record(), record()]))).toThrow(/more than once/);
    const value = batch([record()]); value.mode = 'continuous_update'; value.complete = false; value.cursorAfter = 'cursor-1';
    expect(contract.normalizeBatch('projects.primary', value).cursorAfter).toBe('cursor-1');
  });
});
