'use strict';
const contract = require('../../src/learning/externalAssetImportContract');
const digest = 'a'.repeat(64);
const record = (recordType = 'utilization') => ({
  externalRecordId: `${recordType}-1`, externalVersion: 1, state: 'active', recordType,
  jobReference: 'job-19', assetReference: 'asset-2', assetCategory: 'equipment',
  periodStartedAt: '2026-09-15T12:00:00.000Z', periodEndedAt: '2026-09-15T16:00:00.000Z', timeZone: 'America/New_York',
  utilization: recordType === 'utilization' ? { value: '4.0', unit: 'engine_hour', basis: 'telematics' } : null,
  cost: recordType === 'operating_cost' ? { amount: '86.42', currency: 'USD', costClass: 'fuel_energy', basis: 'fuel_card' } : null,
  maintenance: recordType === 'maintenance' ? { kind: 'preventive', status: 'completed', workOrderReference: 'wo-4', meter: { value: '840', unit: 'engine_hour', basis: 'meter' } } : null,
  downtime: recordType === 'downtime' ? { reasonClass: 'maintenance', scheduled: true } : null,
  evidenceClass: 'provider_recorded', providerEvidenceDigest: 'b'.repeat(64), sourceUpdatedAt: '2026-09-15T17:00:00.000Z',
});
const batch = records => ({ schemaVersion: 'm25-external-asset-actual-v1', mode: 'historical_backfill', expectedConsentRevision: 1,
  expectedConsentDigest: digest, cursorBefore: null, cursorAfter: null, complete: true, records,
  reason: 'Owner confirmed this normalized fleet and equipment page.', confirmed: true,
  confirmationVersion: 'm25-external-asset-import-batch-v1' });

describe('Mission 25 external vehicle and equipment evidence contract', () => {
  test('accepts exact provider-neutral utilization, operating cost, maintenance and downtime records', () => {
    const records = ['utilization', 'operating_cost', 'maintenance', 'downtime'].map(record);
    expect(contract.normalizeBatch('fleet.example', batch(records)).records.map(value => value.recordType)).toEqual(['utilization', 'operating_cost', 'maintenance', 'downtime']);
  });
  test('keeps job references optional while preserving exact opaque asset identity', () => {
    const value = record(); value.jobReference = null;
    expect(contract.normalizeRecord(value).jobReference).toBeNull();
    value.assetReference = null; expect(() => contract.normalizeRecord(value)).toThrow(/invalid/);
  });
  test('does not convert mismatched evidence into an actual', () => {
    for (const change of [
      value => { value.recordType = 'downtime'; }, value => { value.utilization.basis = 'estimated'; },
      value => { value.providerEvidenceDigest = null; }, value => { value.periodEndedAt = '2099-09-15T16:00:00.000Z'; },
      value => { value.timeZone = null; }, value => { value.assetCategory = 'tool'; },
    ]) { const value = record(); change(value); expect(() => contract.normalizeRecord(value)).toThrow(); }
  });
  test('allows maintenance cost only when its currency, class and basis are explicit', () => {
    const value = record('maintenance'); value.cost = { amount: '245.00', currency: 'USD', costClass: 'maintenance', basis: 'work_order' };
    expect(contract.normalizeRecord(value).cost.amount).toBe('245.00'); value.cost.currency = null;
    expect(() => contract.normalizeRecord(value)).toThrow(/cost evidence/);
    value.cost = { amount: '245.00', currency: 'USD', costClass: 'rental', basis: 'invoice' };
    expect(() => contract.normalizeRecord(value)).toThrow(/record type/);
  });
  test('requires detail-free higher-version tombstones', () => {
    const value = record(); Object.assign(value, { externalVersion: 2, state: 'tombstone', recordType: null, jobReference: null,
      assetReference: null, assetCategory: null, periodStartedAt: null, periodEndedAt: null, timeZone: null, utilization: null,
      cost: null, maintenance: null, downtime: null, evidenceClass: null, providerEvidenceDigest: null });
    expect(contract.normalizeRecord(value).state).toBe('tombstone'); value.assetReference = 'asset-2';
    expect(() => contract.normalizeRecord(value)).toThrow(/cannot retain/);
  });
  test('requires current consent pins and bounded resumable pages', () => {
    const value = batch(Array.from({ length: 101 }, (_, index) => ({ ...record(), externalRecordId: `r-${index}` })));
    expect(() => contract.normalizeBatch('fleet.example', value)).toThrow();
    const continuous = batch([record()]); continuous.mode = 'continuous_update'; continuous.complete = false; continuous.cursorAfter = 'cursor-1';
    expect(contract.normalizeBatch('fleet.example', continuous).cursorAfter).toBe('cursor-1');
  });
});
