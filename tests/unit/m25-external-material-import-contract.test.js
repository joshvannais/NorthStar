'use strict';
const contract = require('../../src/learning/externalMaterialImportContract');
const digest = 'a'.repeat(64);
const record = (recordType = 'inventory_movement') => ({
  externalRecordId: `${recordType}-1`, externalVersion: 1, state: 'active', recordType,
  jobReference: recordType === 'inventory_balance' ? null : 'job-19', materialReference: 'material-cedar',
  vendorReference: ['purchase','vendor_cost'].includes(recordType) ? 'vendor-4' : null, locationReference: 'warehouse-1',
  occurredAt: '2026-09-15T12:00:00.000Z', timeZone: 'America/New_York',
  movementKind: recordType === 'inventory_movement' ? 'consumed' : null,
  quantity: { value: recordType === 'inventory_balance' ? '0' : '4.0', unit: 'ft', basis: recordType === 'vendor_cost' ? 'vendor_quote' : 'provider_recorded' },
  cost: ['purchase','vendor_cost'].includes(recordType) ? { amount: '32.00', currency: 'USD', valuation: recordType === 'purchase' ? 'line_total' : 'unit_cost', basis: recordType === 'vendor_cost' ? 'vendor_quote' : 'invoice' } : null,
  evidenceClass: 'provider_recorded', providerEvidenceDigest: 'b'.repeat(64), sourceUpdatedAt: '2026-09-15T17:00:00.000Z',
});
const batch = records => ({ schemaVersion: 'm25-external-material-actual-v1', mode: 'historical_backfill', expectedConsentRevision: 1,
  expectedConsentDigest: digest, cursorBefore: null, cursorAfter: null, complete: true, records,
  reason: 'Owner confirmed this normalized material evidence page.', confirmed: true,
  confirmationVersion: 'm25-external-material-import-batch-v1' });

describe('Mission 25 external material evidence contract', () => {
  test('accepts exact inventory, movement, purchase and vendor-cost records', () => {
    const values = ['inventory_balance','inventory_movement','purchase','vendor_cost'].map(record);
    expect(contract.normalizeBatch('materials.primary', batch(values)).records.map(v => v.recordType)).toEqual(values.map(v => v.recordType));
  });
  test('preserves explicit units, currency and bases without conversions', () => {
    const value = record('vendor_cost');
    expect(contract.normalizeRecord(value).quantity).toEqual({ value: '4.0', unit: 'ft', basis: 'vendor_quote' });
    expect(contract.normalizeRecord(value).cost).toEqual({ amount: '32.00', currency: 'USD', valuation: 'unit_cost', basis: 'vendor_quote' });
  });
  test('rejects missing identity, units, currency and mismatched evidence', () => {
    for (const change of [v => { v.materialReference = null; }, v => { v.quantity.unit = 'board_ft'; },
      v => { v.cost.currency = null; }, v => { v.movementKind = 'consumed'; }]) {
      const value = record('vendor_cost'); change(value); expect(() => contract.normalizeRecord(value)).toThrow();
    }
  });
  test('allows a zero counted balance and requires detail-free tombstones', () => {
    expect(contract.normalizeRecord(record('inventory_balance')).quantity.value).toBe('0');
    const value = record(); Object.assign(value, { externalVersion: 2, state: 'tombstone', recordType: null, jobReference: null,
      materialReference: null, vendorReference: null, locationReference: null, occurredAt: null, timeZone: null,
      movementKind: null, quantity: null, cost: null, evidenceClass: null, providerEvidenceDigest: null });
    expect(contract.normalizeRecord(value).state).toBe('tombstone'); value.materialReference = 'material-cedar';
    expect(() => contract.normalizeRecord(value)).toThrow(/cannot retain/);
  });
  test('requires current consent pins and bounded resumable pages', () => {
    expect(() => contract.normalizeBatch('materials.primary', batch(Array.from({ length: 101 }, (_, i) => ({ ...record(), externalRecordId: `r-${i}` }))))).toThrow();
    const value = batch([record()]); value.mode = 'continuous_update'; value.complete = false; value.cursorAfter = 'cursor-1';
    expect(contract.normalizeBatch('materials.primary', value).cursorAfter).toBe('cursor-1');
  });
});
