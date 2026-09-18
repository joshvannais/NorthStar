'use strict';

const contract = require('../../src/learning/externalBusinessOperationsContract');
const digest = 'a'.repeat(64);

describe('Mission 25 Part 12J external business source operation contract', () => {
  test.each(['crm_field_service','project_change_order','communication','financial'])('accepts bounded exact operations for %s', sourceClass => {
    expect(contract.normalizeAdapter(sourceClass,'primary.source',{ action:'connect',adapterKind:'provider_api',cadence:'hourly',expectedRevision:0,expectedDigest:'none',confirmed:true }).sourceClass).toBe(sourceClass);
    expect(contract.normalizeRetention(sourceClass,'primary.source',{ action:'set',retentionDays:365,expectedRevision:0,expectedDigest:'none',confirmed:true }).body.retentionDays).toBe(365);
    expect(contract.normalizeDeletion(sourceClass,'primary.source',{ action:'request',expectedRevision:0,expectedDigest:'none',confirmed:true }).body.action).toBe('request');
    expect(contract.normalizeHold(sourceClass,'primary.source',{ action:'place',holdKind:'legal',expectedRevision:0,expectedDigest:'none',confirmed:true }).body.holdKind).toBe('legal');
    expect(contract.normalizeCleanup(sourceClass,'primary.source',{ operation:'deletion',expectedRevision:1,expectedDigest:digest,cursorBefore:null,limit:100,confirmed:true }).body.limit).toBe(100);
  });
  test('rejects unknown classes, extras, short retention and unbounded cleanup', () => {
    expect(() => contract.identity('unknown','primary.source')).toThrow(/invalid/i);
    expect(() => contract.normalizeAdapter('financial','primary.source',{ action:'connect',adapterKind:'provider_api',cadence:'hourly',credential:'secret',expectedRevision:0,expectedDigest:'none',confirmed:true })).toThrow(/invalid/i);
    expect(() => contract.normalizeRetention('financial','primary.source',{ action:'set',retentionDays:1,expectedRevision:0,expectedDigest:'none',confirmed:true })).toThrow(/invalid/i);
    expect(() => contract.normalizeCleanup('financial','primary.source',{ operation:'deletion',expectedRevision:1,expectedDigest:digest,cursorBefore:null,limit:101,confirmed:true })).toThrow(/invalid/i);
  });
});
