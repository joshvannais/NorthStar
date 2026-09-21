'use strict';
const contract = require('../../src/learning/externalCrmFieldServiceImportContract');
const digest = 'a'.repeat(64);
const stateFor = { customer: 'active', lead: 'qualified', job: 'completed', appointment: 'scheduled', issued_estimate: 'issued' };
const record = (recordType = 'job') => ({
  externalRecordId: `${recordType}-1`, externalVersion: 1, state: 'active', recordType,
  customerReference: 'customer-1', leadReference: recordType === 'customer' ? null : 'lead-1',
  jobReference: ['job','appointment','issued_estimate'].includes(recordType) ? 'job-1' : null,
  appointmentReference: recordType === 'appointment' ? 'appointment-1' : null,
  estimateReference: recordType === 'issued_estimate' ? 'estimate-1' : null,
  recordState: stateFor[recordType], occurredAt: '2026-09-15T12:00:00.000Z', endedAt: null,
  timeZone: 'America/New_York', evidenceClass: 'provider_recorded',
  providerEvidenceDigest: 'b'.repeat(64), sourceUpdatedAt: '2026-09-15T17:00:00.000Z',
});
const batch = records => ({ schemaVersion: contract.SCHEMA_VERSION, mode: 'historical_backfill', expectedConsentRevision: 1,
  expectedConsentDigest: digest, cursorBefore: null, cursorAfter: null, complete: true, records,
  reason: 'Import this reviewed CRM and field-service evidence page.', confirmed: true,
  confirmationVersion: contract.BATCH_VERSION });

describe('Mission 25 external CRM and field-service evidence contract', () => {
  test('accepts the five exact record classes without names, contact details or financial values', () => {
    const values = ['customer','lead','job','appointment','issued_estimate'].map(record);
    expect(contract.normalizeBatch('field-service.primary', batch(values)).records.map(value => value.recordType))
      .toEqual(values.map(value => value.recordType));
  });
  test('preserves explicit unknown state rather than inferring an outcome', () => {
    const value = record('job'); value.recordState = 'unknown';
    expect(contract.normalizeRecord(value).recordState).toBe('unknown');
  });
  test('rejects missing type identity, mismatched references, non-IANA shapes and event time inversions', () => {
    for (const change of [value => { value.jobReference = null; }, value => { value.appointmentReference = 'appointment-1'; },
      value => { value.timeZone = 'EST'; }, value => { value.endedAt = '2026-09-15T11:00:00.000Z'; }]) {
      const value = record('job'); change(value); expect(() => contract.normalizeRecord(value)).toThrow();
    }
  });
  test('requires detail-free tombstones', () => {
    const value = record();
    for (const key of Object.keys(value)) if (!['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(key)) value[key] = null;
    Object.assign(value, { externalVersion: 2, state: 'tombstone' });
    expect(contract.normalizeRecord(value).state).toBe('tombstone'); value.jobReference = 'job-1';
    expect(() => contract.normalizeRecord(value)).toThrow(/cannot retain/);
  });
  test('requires pinned consent and bounded, unambiguous resumable pages', () => {
    expect(() => contract.normalizeBatch('field-service.primary', batch(Array.from({ length: 101 }, (_, index) => ({ ...record(), externalRecordId: `r-${index}` }))))).toThrow();
    expect(() => contract.normalizeBatch('field-service.primary', batch([record(), record()]))).toThrow(/more than once/);
    const value = batch([record()]); value.mode = 'continuous_update'; value.complete = false; value.cursorAfter = 'cursor-1';
    expect(contract.normalizeBatch('field-service.primary', value).cursorAfter).toBe('cursor-1');
  });
});
