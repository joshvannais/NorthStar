'use strict';

const operations = require('../../src/learning/externalMaterialOperationsContract');

const digest = 'a'.repeat(64);

describe('Mission 25 Part 11 material source operation contracts', () => {
  test('normalizes exact material source lifecycle, retention, deletion and cleanup inputs', () => {
    expect(operations.normalizeAdapter('materials.primary', { action: 'connect', adapterKind: 'provider_api',
      cadence: 'hourly', expectedRevision: 0, expectedDigest: 'none', confirmed: true }).action).toBe('connect');
    expect(operations.normalizeRetention('materials.primary', { action: 'set', retentionDays: 365,
      expectedRevision: 0, expectedDigest: 'none', confirmed: true }).retentionDays).toBe(365);
    expect(operations.normalizeDeletion('materials.primary', { action: 'request', expectedRevision: 0,
      expectedDigest: 'none', confirmed: true }).action).toBe('request');
    expect(operations.normalizeHold('materials.primary', { action: 'place', holdKind: 'legal', expectedRevision: 0, expectedDigest: 'none', confirmed: true }).holdKind).toBe('legal');
    expect(operations.normalizeCleanup('materials.primary', { operation: 'deletion', expectedRevision: 1,
      expectedDigest: digest, cursorBefore: null, limit: 100, confirmed: true }).limit).toBe(100);
  });

  test('rejects secret-shaped extras, invalid retention and unbounded cleanup', () => {
    expect(() => operations.normalizeAdapter('materials.primary', { action: 'connect', adapterKind: 'provider_api',
      cadence: 'hourly', credential: 'secret', expectedRevision: 0, expectedDigest: 'none', confirmed: true })).toThrow(/invalid/i);
    expect(() => operations.normalizeRetention('materials.primary', { action: 'set', retentionDays: 1,
      expectedRevision: 0, expectedDigest: 'none', confirmed: true })).toThrow(/invalid/i);
    expect(() => operations.normalizeHold('materials.primary', { action: 'place', holdKind: 'legal', note: 'secret',
      expectedRevision: 0, expectedDigest: 'none', confirmed: true })).toThrow(/invalid/i);
    expect(() => operations.normalizeCleanup('materials.primary', { operation: 'deletion', expectedRevision: 1,
      expectedDigest: digest, cursorBefore: null, limit: 101, confirmed: true })).toThrow(/invalid/i);
  });
});
