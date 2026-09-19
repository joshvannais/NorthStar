'use strict';

const contract = require('../../src/learning/externalBusinessCalibrationContract');
const repository = require('../../src/learning/externalBusinessCalibrationRepository');
const digest = 'a'.repeat(64);
const consent = () => ({ action: 'grant', expectedRevision: 0, expectedDigest: 'none', reason: 'Use current reviewed outcomes for calibration.', confirmed: true, confirmationVersion: 'm25-external-business-calibration-consent-v1' });
const proposal = () => ({ expectedConsentRevision: 1, expectedConsentDigest: digest, reason: 'Review the current same-service sample.', confirmed: true, confirmationVersion: 'm25-external-business-calibration-proposal-v1' });

describe('Mission 25 external business calibration contract', () => {
  test('keeps customer, project and financial source identities exact', () => {
    expect(contract.normalizeConsent('customer', 'crm.primary', 'messages.primary', consent()).secondarySourceKey).toBe('messages.primary');
    expect(contract.normalizeConsent('project', 'projects.primary', undefined, consent()).secondarySourceKey).toBeNull();
    expect(contract.normalizeProposal('financial', 'finance.primary', null, 'tree_service', proposal()).serviceKey).toBe('tree_service');
    expect(() => contract.normalizeIdentity('customer', 'crm.primary')).toThrow('Business calibration details are invalid.');
    expect(() => contract.normalizeIdentity('financial', 'finance.primary', 'messages.primary')).toThrow('Business calibration details are invalid.');
  });
  test('rejects extra, stale-shaped and changed confirmation input', () => {
    for (const change of [v => { v.extra = true; }, v => { v.expectedConsentDigest = 'none'; }, v => { v.confirmed = false; }, v => { v.confirmationVersion = 'wrong'; }]) {
      const value = proposal(); change(value);
      expect(() => contract.normalizeProposal('financial', 'finance.primary', null, 'tree_service', value)).toThrow('Business calibration details are invalid.');
    }
  });
  test('maps permission, evidence, concurrency and key errors to plain messages', async () => {
    const pool = error => ({ connect: async () => ({ query: async sql => { if (sql.startsWith('SELECT public.')) throw error; return { rows: [] }; }, release() {} }) });
    const input = { organizationId: '1', actorUserId: '2', actorAccessRole: 'owner', authSessionId: '3', csrfToken: 'csrf', idempotencyKey: '1234567890123456', kind: 'financial', sourceKey: 'finance.primary', secondarySourceKey: null, serviceKey: 'tree_service', ...proposal() };
    await expect(repository.propose(pool({ code: '40001' }), input)).rejects.toMatchObject({ status: 409, code: 'M25_EXTERNAL_BUSINESS_CALIBRATION_CHANGED' });
    await expect(repository.propose(pool({ code: 'P0002', constraint: 'external_business_calibration_sample_insufficient' }), input)).rejects.toMatchObject({ status: 409, message: 'At least five current reviewed outcomes for this service are required.' });
    await expect(repository.propose(pool({ code: '23505' }), input)).rejects.toMatchObject({ status: 409, code: 'M25_EXTERNAL_BUSINESS_CALIBRATION_KEY_CONFLICT' });
  });
});
