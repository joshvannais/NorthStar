'use strict';
const { normalizeAction, certificationState } = require('../../src/workforce/workProfileContract');
const profile = () => ({ title: 'Service technician', summary: 'Residential repair and careful handover.', skills: ['Fixture repair'], certifications: [{ id: 'safety', name: 'Safety training', issuer: 'Example Training', expiresOn: '2027-09-09', documentReference: 'CERT-2026-014' }] });
const submit = () => ({ action: 'submit', expectedRevision: 0, profile: profile() });
describe('My Work Profile claim boundary', () => {
  test('preserves claims separately from operational authority', () => {
    expect(normalizeAction(submit())).toEqual(submit());
    for (const key of ['operationalRole','accessRole','organizationId','verified']) expect(() => normalizeAction({ ...submit(), [key]: 'owner' })).toThrow();
  });
  test('rejects oversized, duplicate, invalid and authority-bearing certification input', () => {
    const invalid = [
      { ...profile(), title: 'x'.repeat(121) },
      { ...profile(), skills: ['Repair', 'Repair'] },
      { ...profile(), certifications: [ { ...profile().certifications[0], verified: true } ] },
      { ...profile(), certifications: [ { ...profile().certifications[0], expiresOn: '2026-02-30' } ] },
      { ...profile(), certifications: [ { ...profile().certifications[0], documentReference: 'https://example.test/private' } ] },
    ];
    invalid.forEach(value => expect(() => normalizeAction({ ...submit(), profile: value })).toThrow());
  });
  test('review is explicit, reasoned and pinned', () => {
    expect(normalizeAction({ action: 'approve', expectedRevision: 1, reason: 'Original training record reviewed', verifiedCertificationIds: ['safety'] }).action).toBe('approve');
    expect(() => normalizeAction({ action: 'reject', expectedRevision: 1, reason: '' })).toThrow();
    expect(() => normalizeAction({ ...submit(), expectedRevision: '0' })).toThrow();
    expect(() => normalizeAction({ ...submit(), approved: true })).toThrow();
  });
  test('availability has its own bounded time window', () => {
    const now = Date.parse('2026-09-09T12:00:00Z');
    expect(normalizeAction({ action: 'availability', expectedRevision: 0, availability: { status: 'limited', note: 'Available after lunch', until: '2026-09-09T18:00:00.000Z' } }, now).availability.status).toBe('limited');
    expect(() => normalizeAction({ action: 'availability', expectedRevision: 0, availability: { status: 'available', note: '', until: '2026-10-09T18:00:00.000Z' } }, now)).toThrow();
  });
  test('expired and revoked certifications never appear currently verified', () => {
    const cert = profile().certifications[0];
    expect(certificationState(cert, 'approved', ['safety'], '2026-09-09')).toBe('verified');
    expect(certificationState(cert, 'approved', ['safety'], '2028-09-09')).toBe('expired');
    expect(certificationState(cert, 'revoked', ['safety'], '2026-09-09')).toBe('revoked');
    expect(certificationState(cert, 'pending', ['safety'], '2026-09-09')).toBe('unverified');
  });
});
