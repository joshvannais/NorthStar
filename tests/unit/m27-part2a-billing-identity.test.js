'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repository = require('../../src/customerFinancial/billingIdentityRepository');

const ROOT = path.resolve(__dirname, '..', '..');
const read = value => fs.readFileSync(path.join(ROOT, value), 'utf8');
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const instant = '2026-10-10T12:00:00.000000Z';
const actor = Object.freeze({ organizationId: id(1), actorUserId: id(2),
  actorAccessRole: 'owner', authSessionId: id(3) });

function snapshot(partyId = null) {
  return { version: 'm27-billing-identity-origin-v1', organizationId: actor.organizationId,
    billingPartyId: partyId,
    customer: { identityKind: 'canonical_customer', id: id(4), source: {
      class: 'canonical_customer.v1', operationId: id(5), graphId: id(6),
      externalCustomerId: null, createdAt: instant, updatedAt: instant, digest: digest('source') } },
    name: { state: 'source_candidate', value: 'Synthetic customer', reason: null },
    address: { state: 'unavailable', value: null, reason: 'source_value_missing',
      sourceRole: 'unclassified_customer_address' },
    contact: { email: { state: 'source_candidate', value: 'customer@example.test', reason: null },
      phone: { state: 'unavailable', value: null, reason: 'source_value_missing' } },
    tax: { state: 'unavailable', value: null, reason: 'owner_review_required' },
    exemption: { state: 'unavailable', value: null, reason: 'owner_review_required' },
    delivery: { state: 'unavailable', value: null, reason: 'owner_review_required' },
    actor: { userId: actor.actorUserId, accessRole: 'owner', membershipId: id(2),
      authSessionId: actor.authSessionId }, capturedAt: instant, reviewState: 'unreviewed',
    documentUseAuthorized: false, automaticCustomerCreationAuthorized: false };
}
function projection(state, partyId = null) {
  return { version: 'm27-billing-identity-v1', state, available: true, current: true,
    reason: null, customerId: id(4), billingPartyId: partyId,
    snapshotId: partyId ? id(8) : null, sourceDigest: digest('source'),
    sourceUpdatedAt: instant, reviewState: 'unreviewed', documentUseAuthorized: false,
    value: snapshot(partyId), automaticCustomerCreationAuthorized: false };
}

describe('Mission 27 Part 2A billing identity contract', () => {
  test('accepts exact candidate and established evidence while freezing it', () => {
    const candidate = repository.verified(projection('candidate_unreviewed'), actor.organizationId);
    expect(candidate.value.customer.source.digest).toBe(candidate.sourceDigest);
    expect(candidate.value.tax).toEqual({ state: 'unavailable', value: null,
      reason: 'owner_review_required' });
    expect(candidate.documentUseAuthorized).toBe(false);
    expect(Object.isFrozen(candidate.value.customer.source)).toBe(true);

    const established = repository.verified(
      projection('established_unreviewed', id(7)), actor.organizationId);
    expect(established).toMatchObject({ billingPartyId: id(7), snapshotId: id(8),
      reviewState: 'unreviewed', automaticCustomerCreationAuthorized: false });
  });

  test('rejects invented authority, malformed values and incomplete callers', () => {
    const approved = projection('candidate_unreviewed'); approved.value.reviewState = 'reviewed';
    expect(() => repository.verified(approved, actor.organizationId)).toThrow(
      'Billing identity evidence is unavailable.');
    const amount = projection('candidate_unreviewed'); amount.value.tax.value = '0.00';
    expect(() => repository.verified(amount, actor.organizationId)).toThrow(
      'Billing identity evidence is unavailable.');
    expect(() => repository.normalizeSelection({ customerId: 'missing' })).toThrow(
      'Select one exact current customer.');
    expect(() => repository.normalizeEstablishment({ customerId: id(4),
      expectedSourceDigest: digest('source'), expectedSourceUpdatedAt: instant,
      reason: 'short' })).toThrow('Billing identity establishment evidence is invalid.');
  });

  test('keeps named unavailable responses value-free', () => {
    const value = { version: 'm27-billing-identity-v1', state: 'unavailable',
      available: false, current: false, reason: 'billing_identity_source_changed_requires_review',
      customerId: id(4), billingPartyId: id(7), snapshotId: id(8), sourceDigest: null,
      sourceUpdatedAt: null, reviewState: null, documentUseAuthorized: false,
      value: null, automaticCustomerCreationAuthorized: false };
    expect(repository.verified(value, actor.organizationId)).toEqual(value);
  });

  test('ratifies the exact migration boundary and excludes later-slice behavior', () => {
    const sql = read('migrations/260_customer_financial_billing_identity_v1.sql');
    expect(sql).toContain('REFERENCES public.canonical_customers(organization_id,id) ON DELETE RESTRICT');
    expect(sql).toContain("'party_origin_unreviewed'");
    expect(sql).toContain("'documentUseAuthorized',FALSE");
    expect(sql).toContain("'automaticCustomerCreationAuthorized',FALSE");
    expect(sql).toContain('billing_identity_source_changed_requires_review');
    expect(sql).not.toMatch(/\bresponse_body\b/i);
    expect(sql).not.toMatch(/INSERT INTO public\.canonical_customers|UPDATE public\.canonical_customers|DELETE FROM public\.canonical_customers/);
    expect(sql).not.toMatch(/canonical_(?:customer_)?(?:invoice|payment|schedule|estimate)/i);
    expect(sql).not.toMatch(/INSERT INTO public\.(?!canonical_customer_financial_billing_)/);
    const migrationNames = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql')).sort();
    expect(migrationNames.at(-1)).toBe('260_customer_financial_billing_identity_v1.sql');
    expect(migrationNames.filter(name => /^260_/.test(name))).toHaveLength(1);
    expect(fs.existsSync(path.join(ROOT, 'src', 'customerFinancial', 'billingIdentityRepository.js'))).toBe(true);
    expect(read('src/customerFinancial/databaseAuthority.js')).toContain(
      "'canonical_customer_financial_billing_identity_v1_establish'");
    expect(read('src/db.js')).toContain("require('./customerFinancial/databaseAuthority').grantAndVerify");
    expect(read('docs/architecture/MISSION_27_PART2A_BILLING_IDENTITY.md')).toContain(
      'Part 2B still owns owner-reviewed billing contacts');
  });
});
