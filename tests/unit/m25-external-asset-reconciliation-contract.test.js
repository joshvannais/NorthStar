'use strict';
const contract = require('../../src/learning/externalAssetReconciliationContract');
const repository = require('../../src/learning/externalAssetReconciliationRepository');
const digest = 'a'.repeat(64);
const body = () => ({ action: 'link', referenceKind: 'equipment', externalReference: 'chipper-2', targetId: '11111111-1111-4111-8111-111111111111', expectedRevision: 0, expectedDigest: 'none', expectedSourceDigest: digest, expectedTargetDigest: digest, reason: 'Owner matched the exact current reviewed equipment record.', confirmed: true, confirmationVersion: 'm25-external-asset-reference-match-v1' });

describe('Mission 25 external vehicle and equipment reconciliation contract', () => {
  test('accepts only explicit reviewed job, vehicle or equipment links', () => {
    for (const kind of ['job', 'vehicle', 'equipment']) { const value = body(); value.referenceKind = kind; expect(contract.normalizeMatch('fleet.primary', value).referenceKind).toBe(kind); }
  });
  test('requires exact current digests, confirmation and exact fields', () => {
    for (const change of [v => { v.expectedSourceDigest = 'unavailable'; }, v => { v.expectedTargetDigest = null; }, v => { v.extra = true; }, v => { v.referenceKind = 'asset'; }, v => { v.confirmed = false; }]) { const value = body(); change(value); expect(() => contract.normalizeMatch('fleet.primary', value)).toThrow('Vehicle and equipment reference match details are invalid.'); }
  });
  test('supports an explicit unlink without retaining a target', () => {
    const value = body(); Object.assign(value, { action: 'unlink', targetId: null, expectedRevision: 1, expectedDigest: digest, expectedSourceDigest: digest, expectedTargetDigest: 'unavailable' });
    expect(contract.normalizeMatch('fleet.primary', value).targetId).toBeNull();
  });
  test('maps conflicts and changed source or target to plain review messages', async () => {
    const failurePool = error => ({ connect: async () => ({ query: async sql => { if (sql.startsWith('SELECT public.')) throw error; return { rows: [] }; }, release() {} }) });
    await expect(repository.readMatches(failurePool({ code: '42501' }), { organizationId: '1', actorUserId: '2', actorAccessRole: 'member', authSessionId: '3', sourceKey: 'fleet.primary' })).rejects.toMatchObject({ code: 'M25_ASSET_MATCH_FORBIDDEN', status: 403 });
    await expect(repository.mutateMatch(failurePool({ code: '40001', constraint: 'asset_match_target_changed' }), { organizationId: '1', actorUserId: '2', actorAccessRole: 'owner', authSessionId: '3', csrfToken: 'x', idempotencyKey: '1234567890123456', sourceKey: 'fleet.primary', body: body() })).rejects.toMatchObject({ code: 'M25_ASSET_MATCH_CHANGED', status: 409, message: 'The NorthStar record changed. Refresh before linking it.' });
  });
});
