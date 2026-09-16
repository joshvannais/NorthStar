'use strict';

const csv = require('../../src/learning/externalLaborCsvContract');
const operations = require('../../src/learning/externalLaborOperationsContract');
const browser = require('../../public/js/learning-center-contract');

const digest = 'a'.repeat(64);
const header = csv.HEADERS.join(',');
const line = 'shift-1,1,active,worker-1,job-1,production,2026-01-10T13:00:00.000Z,2026-01-10T17:00:00.000Z,2026-01-10T17:05:00.000Z';

describe('Mission 25 Part 8 import operation contracts', () => {
  test('CSV normalization accepts only the exact bounded labor schema', () => {
    const value = csv.normalizeCsvBackfill('crewclock.primary', { cursorBefore: null, cursorAfter: null,
      complete: true, csvText: `${header}\n${line}`, expectedConsentRevision: 1, expectedConsentDigest: digest });
    expect(value.mode).toBe('historical_backfill');
    expect(value.records).toHaveLength(1);
    expect(value.records[0].externalVersion).toBe(1);
    const page = csv.normalizeCsvBackfill('crewclock.primary', { cursorBefore: null, cursorAfter: 'page-001',
      complete: false, csvText: `${header}\n${line}`, expectedConsentRevision: 1, expectedConsentDigest: digest });
    expect(page.complete).toBe(false); expect(page.cursorAfter).toBe('page-001');
    const finalPage = csv.normalizeCsvBackfill('crewclock.primary', { cursorBefore: page.cursorAfter, cursorAfter: null,
      complete: true, csvText: `${header}\n${line.replace('shift-1', 'shift-2')}`, expectedConsentRevision: 1, expectedConsentDigest: digest });
    expect(finalPage.complete).toBe(true); expect(finalPage.cursorBefore).toBe('page-001');
    expect(() => csv.normalizeCsvBackfill('crewclock.primary', { cursorBefore: null, cursorAfter: null,
      complete: true, csvText: `wrong,header\n${line}`, expectedConsentRevision: 1, expectedConsentDigest: digest })).toThrow(/exact NorthStar labor header/);
    expect(() => csv.normalizeCsvBackfill('crewclock.primary', { cursorBefore: null, cursorAfter: null,
      complete: true, csvText: `${header}\n${line}\n${line}`, expectedConsentRevision: 1, expectedConsentDigest: digest })).toThrow(/appears more than once/);
  });

  test('adapter, retention, deletion and cleanup mutations use closed exact bodies', () => {
    expect(operations.normalizeAdapter('crewclock.primary', { action: 'connect', adapterKind: 'provider_api', cadence: 'daily',
      expectedRevision: 0, expectedDigest: 'none', confirmed: true }).action).toBe('connect');
    expect(() => operations.normalizeAdapter('crewclock.primary', { action: 'connect', adapterKind: 'provider_api', cadence: 'daily',
      accountReference: 'sk_live_super_secret_1234567890', expectedRevision: 0, expectedDigest: 'none', confirmed: true })).toThrow(/invalid/);
    expect(operations.normalizeRetention('crewclock.primary', { action: 'set', retentionDays: 365,
      expectedRevision: 0, expectedDigest: 'none', confirmed: true }).retentionDays).toBe(365);
    expect(operations.normalizeDeletion('crewclock.primary', { action: 'request', expectedRevision: 0,
      expectedDigest: 'none', confirmed: true }).action).toBe('request');
    expect(operations.normalizeCleanup('crewclock.primary', { operation: 'deletion', expectedRevision: 1,
      expectedDigest: digest, cursorBefore: null, limit: 100, confirmed: true }).limit).toBe(100);
    expect(() => operations.normalizeRetention('crewclock.primary', { action: 'set', retentionDays: 1,
      expectedRevision: 0, expectedDigest: 'none', confirmed: true })).toThrow(/invalid/);
  });

  test('browser projection accepts bounded operation state and rejects malformed authority', () => {
    const value = browser.operations({ sourceKey: 'crewclock.primary', adapter: null, retention: null, deletion: null,
      checkpoints: [], activeRecordTotal: 0, retentionEligibleTotal: 0, deletionComplete: false, boundary: 'Advisory only.' });
    expect(value.sourceKey).toBe('crewclock.primary');
    expect(() => browser.operations({ ...value, activeRecordTotal: -1 })).toThrow(/invalid/);
  });
});
