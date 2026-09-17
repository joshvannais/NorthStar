'use strict';
const contract = require('../../src/learning/externalCommunicationImportContract');

const digest = 'a'.repeat(64);
const claim = (value, basis) => ({ status: 'recorded', value, basis });
const base = type => ({ externalRecordId: `${type}-1`, externalVersion: 1, state: 'active', recordType: type,
  customerReference: null, leadReference: null, jobReference: 'job-1', appointmentReference: null,
  estimateReference: null, projectReference: null, communicationReference: 'communication-1',
  channel: type === 'communication' ? 'phone' : null, direction: type === 'communication' ? 'inbound' : null,
  intentClaim: type === 'communication' ? claim('request_estimate','customer_explicit') : null,
  deliveryState: type === 'delivery' ? 'delivered' : null,
  satisfactionClaim: type === 'satisfaction' ? claim('satisfied','explicit_customer_feedback') : null,
  occurredAt: '2026-09-15T12:00:00.000Z', timeZone: 'America/New_York', evidenceClass: 'provider_recorded',
  providerEvidenceDigest: digest, sourceUpdatedAt: '2026-09-15T13:00:00.000Z' });

describe('Mission 25 Part 12C communication import contract', () => {
  test.each(['communication','delivery','satisfaction'])('accepts the exact %s evidence class', type => {
    expect(contract.normalizeRecord(base(type)).recordType).toBe(type);
  });
  test('keeps intent, delivery, and satisfaction facts separate', () => {
    expect(() => contract.normalizeRecord({ ...base('communication'), deliveryState: 'delivered' })).toThrow(/match the record type/);
    expect(() => contract.normalizeRecord({ ...base('delivery'), intentClaim: claim('question','customer_explicit') })).toThrow(/match the record type/);
    expect(() => contract.normalizeRecord({ ...base('satisfaction'), satisfactionClaim: claim('satisfied','provider_classified') })).toThrow(/allowed value and evidence basis/);
  });
  test('allows explicit unknown and unavailable evidence without guessing', () => {
    expect(contract.normalizeRecord({ ...base('communication'), intentClaim: claim('unknown','provider_classified') }).intentClaim.value).toBe('unknown');
    expect(contract.normalizeRecord({ ...base('satisfaction'), satisfactionClaim: { status: 'unavailable', value: null, basis: null } }).satisfactionClaim.status).toBe('unavailable');
  });
  test('requires detail-free tombstones and exact normalized keys', () => {
    const value = base('communication');
    const tombstone = Object.fromEntries(Object.keys(value).map(key => [key,
      ['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(key) ? value[key] : null]));
    tombstone.state = 'tombstone';
    expect(contract.normalizeRecord(tombstone).state).toBe('tombstone');
    expect(() => contract.normalizeRecord({ ...tombstone, channel: 'phone' })).toThrow(/cannot retain business details/);
    expect(() => contract.normalizeRecord({ ...value, messageBody: 'private text' })).toThrow(/invalid/);
  });
  test('bounds pages and rejects duplicate source identities', () => {
    const batch = { schemaVersion: contract.SCHEMA_VERSION, mode: 'historical_backfill', expectedConsentRevision: 1,
      expectedConsentDigest: digest, cursorBefore: null, cursorAfter: null, complete: true,
      records: [base('communication')], reason: 'Stage reviewed communication evidence.', confirmed: true,
      confirmationVersion: contract.BATCH_VERSION };
    expect(contract.normalizeBatch('communications.primary', batch).records).toHaveLength(1);
    expect(() => contract.normalizeBatch('communications.primary', { ...batch, records: [base('communication'), base('communication')] })).toThrow(/more than once/);
  });
});
