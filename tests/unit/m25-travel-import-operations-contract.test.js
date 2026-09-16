'use strict';

const operations = require('../../src/learning/externalTravelOperationsContract');

const digest = 'a'.repeat(64);

describe('Mission 25 Part 9 travel source operation contracts', () => {
  test('normalizes exact travel source lifecycle, retention, deletion and cleanup inputs', () => {
    expect(operations.normalizeAdapter('fleet.primary', { action: 'connect', adapterKind: 'provider_api',
      cadence: 'hourly', expectedRevision: 0, expectedDigest: 'none', confirmed: true }).action).toBe('connect');
    expect(operations.normalizeRetention('fleet.primary', { action: 'set', retentionDays: 365,
      expectedRevision: 0, expectedDigest: 'none', confirmed: true }).retentionDays).toBe(365);
    expect(operations.normalizeDeletion('fleet.primary', { action: 'request', expectedRevision: 0,
      expectedDigest: 'none', confirmed: true }).action).toBe('request');
    expect(operations.normalizeCleanup('fleet.primary', { operation: 'deletion', expectedRevision: 1,
      expectedDigest: digest, cursorBefore: null, limit: 100, confirmed: true }).limit).toBe(100);
  });

  test('rejects secret-shaped extras, invalid retention and unbounded cleanup', () => {
    expect(() => operations.normalizeAdapter('fleet.primary', { action: 'connect', adapterKind: 'provider_api',
      cadence: 'hourly', credential: 'secret', expectedRevision: 0, expectedDigest: 'none', confirmed: true })).toThrow(/invalid/i);
    expect(() => operations.normalizeRetention('fleet.primary', { action: 'set', retentionDays: 1,
      expectedRevision: 0, expectedDigest: 'none', confirmed: true })).toThrow(/invalid/i);
    expect(() => operations.normalizeCleanup('fleet.primary', { operation: 'deletion', expectedRevision: 1,
      expectedDigest: digest, cursorBefore: null, limit: 101, confirmed: true })).toThrow(/invalid/i);
  });
});
