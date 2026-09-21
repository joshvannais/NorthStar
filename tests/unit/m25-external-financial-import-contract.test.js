'use strict';
const crypto = require('node:crypto');
const contract = require('../../src/learning/externalFinancialImportContract');

const digest = 'a'.repeat(64);
const ref = value => `ref_${crypto.createHash('sha256').update(`financial.primary:${value}`).digest('hex')}`;
const amount = (value, basis) => ({ status: 'recorded', amount: value, currency: 'USD', basis });
const base = type => ({
  externalRecordId: ref(`${type}-1`), externalVersion: 1, state: 'active', recordType: type,
  customerReference: null, jobReference: ref('job-1'), estimateReference: null, executionReference: null,
  projectReference: null, changeOrderReference: null,
  invoiceReference: type === 'invoice' ? ref('invoice-1') : null,
  paymentReference: type === 'payment' ? ref('payment-1') : null,
  collectionReference: type === 'collection' ? ref('collection-1') : null,
  accountingReference: type === 'accounting_entry' ? ref('accounting-1') : null,
  recordState: { invoice: 'issued', payment: 'succeeded', collection: 'settled', accounting_entry: 'posted' }[type],
  amountClaim: amount('1250.25', { invoice: 'invoice_total', payment: 'payment_received', collection: 'amount_collected', accounting_entry: 'revenue' }[type]),
  occurredAt: '2026-09-15T12:00:00.000Z', timeZone: 'America/New_York', evidenceClass: 'provider_recorded',
  providerEvidenceDigest: digest, sourceUpdatedAt: '2026-09-15T13:00:00.000Z',
});

describe('Mission 25 Part 12D external financial evidence contract', () => {
  test.each(['invoice','payment','collection','accounting_entry'])('accepts the exact %s evidence class', type => {
    expect(contract.normalizeRecord(base(type)).recordType).toBe(type);
  });
  test('keeps invoice, payment, collection, and accounting evidence independent', () => {
    expect(() => contract.normalizeRecord({ ...base('invoice'), paymentReference: ref('payment-1') })).toThrow(/match the record type/);
    expect(() => contract.normalizeRecord({ ...base('payment'), amountClaim: amount('10', 'revenue') })).toThrow(/requires an exact/);
    expect(() => contract.normalizeRecord({ ...base('collection'), accountingReference: ref('accounting-1') })).toThrow(/match the record type/);
    expect(() => contract.normalizeRecord({ ...base('accounting_entry'), collectionReference: ref('collection-1') })).toThrow(/match the record type/);
  });
  test('preserves unavailable amount evidence without guessing', () => {
    const record = contract.normalizeRecord({ ...base('invoice'), amountClaim: { status: 'unavailable', amount: null, currency: null, basis: null } });
    expect(record.amountClaim.status).toBe('unavailable');
  });
  test.each([
    ['null record type', { ...base('invoice'), recordType: null }],
    ['null record state', { ...base('invoice'), recordState: null }],
    ['null amount claim', { ...base('invoice'), amountClaim: null }],
    ['null evidence class', { ...base('invoice'), evidenceClass: null }],
    ['null evidence digest', { ...base('invoice'), providerEvidenceDigest: null }],
    ['negative amount', { ...base('invoice'), amountClaim: amount('-1', 'invoice_total') }],
    ['too precise', { ...base('invoice'), amountClaim: amount('1.1234567', 'invoice_total') }],
    ['unsupported currency form', { ...base('invoice'), amountClaim: { ...amount('1', 'invoice_total'), currency: 'usd' } }],
    ['extra amount detail', { ...base('invoice'), amountClaim: { ...amount('1', 'invoice_total'), memo: 'Call Alice' } }],
    ['scalar amount claim', { ...base('invoice'), amountClaim: '100' }],
    ['array amount claim', { ...base('invoice'), amountClaim: [] }],
    ['missing amount key', { ...base('invoice'), amountClaim: { status: 'recorded', amount: '1', currency: 'USD' } }],
    ['wrong basis', { ...base('payment'), amountClaim: amount('1', 'invoice_total') }],
  ])('rejects %s', (_label, record) => expect(() => contract.normalizeRecord(record)).toThrow(/invalid|requires/));
  test.each([
    ['externalRecordId','alice@example.com'], ['customerReference','8605550101'], ['jobReference','Alice Smith'],
    ['estimateReference','Subject: emergency'], ['invoiceReference','Invoice 1001'], ['paymentReference','card ending 1234'],
    ['collectionReference','Message: please pay'], ['accountingReference','account 001122'],
  ])('rejects content-bearing %s', (field, value) => expect(() => contract.normalizeRecord({ ...base('invoice'), [field]: value })).toThrow());
  test('requires detail-free tombstones and exact normalized keys', () => {
    const value = base('invoice');
    const tombstone = Object.fromEntries(Object.keys(value).map(key => [key,
      ['externalRecordId','externalVersion','state','sourceUpdatedAt'].includes(key) ? value[key] : null]));
    tombstone.state = 'tombstone';
    expect(contract.normalizeRecord(tombstone).state).toBe('tombstone');
    expect(() => contract.normalizeRecord({ ...tombstone, amountClaim: amount('1', 'invoice_total') })).toThrow(/cannot retain/);
    expect(() => contract.normalizeRecord({ ...value, accountNumber: '1234' })).toThrow(/invalid/);
  });
  test('bounds pages, cursors, and duplicate source identities', () => {
    const batch = { schemaVersion: contract.SCHEMA_VERSION, mode: 'historical_backfill', expectedConsentRevision: 1,
      expectedConsentDigest: digest, cursorBefore: null, cursorAfter: null, complete: true, records: [base('invoice')],
      reason: 'Stage reviewed financial evidence.', confirmed: true, confirmationVersion: contract.BATCH_VERSION };
    expect(contract.normalizeBatch('financial.primary', batch).records).toHaveLength(1);
    expect(() => contract.normalizeBatch('financial.primary', { ...batch, records: [base('invoice'), base('invoice')] })).toThrow(/more than once/);
    expect(() => contract.normalizeBatch('financial.primary', { ...batch, mode: 'continuous_update', complete: false, cursorAfter: 'invoice@example.com' })).toThrow(/batch is invalid/);
  });
});
