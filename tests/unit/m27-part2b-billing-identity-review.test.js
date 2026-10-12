'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repository = require('../../src/customerFinancial/billingIdentityReviewRepository');

const ROOT = path.resolve(__dirname, '..', '..');
const read = value => fs.readFileSync(path.join(ROOT, value), 'utf8');
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const instant = '2026-10-10T12:00:00.000000Z';
const actor = Object.freeze({ organizationId: id(1), actorUserId: id(2), actorAccessRole: 'owner',
  authSessionId: id(3), capabilityGrantId: id(4), capabilityGrantRevision: 1,
  businessPurpose: repository.BUSINESS_PURPOSE, policyVersion: repository.POLICY_VERSION });
const address = Object.freeze({ line1: '1 Test Way', line2: null, city: 'Boston', region: 'MA',
  postalCode: '02108', countryCode: 'US' });
const provenance = Object.freeze({ class: 'owner_admin_review.v1', customerSourceDigest: digest('source'),
  customerSourceUpdatedAt: instant, reviewActorUserId: actor.actorUserId, reviewId: id(9) });
const field = value => ({ state: value === null ? 'not_supplied' : 'reviewed', value, provenance });

function reviewSnapshot(sequence = 1) {
  return { version: 'm27-billing-identity-review-v1', organizationId: actor.organizationId,
    billingPartyId: id(6), customerId: id(5), reviewId: id(sequence + 8), sequence,
    previousReviewId: sequence === 1 ? null : id(sequence + 7),
    previousReviewDigest: sequence === 1 ? null : digest(`review-${sequence - 1}`),
    origin: { snapshotId: id(7), snapshotDigest: digest('origin') },
    customerIdentity: { kind: 'canonical_customer', id: id(5), source: {
      class: 'canonical_customer.v1', operationId: id(10), graphId: id(11),
      externalCustomerId: null, digest: digest('source'), updatedAt: instant } },
    prospectIdentity: { state: 'unavailable', value: null,
      reason: 'canonical_prospect_source_unavailable' },
    billingContact: { id: id(12), name: field('Synthetic customer'),
      email: field('billing@example.test'), phone: field(null) },
    serviceLocation: { id: id(13), address: field(address) },
    billingAddress: { id: id(14), address: field(address) },
    references: { purchaseOrder: field('PO-100'), customer: field(null) },
    actor: { userId: actor.actorUserId, accessRole: actor.actorAccessRole,
      membershipId: actor.actorUserId, authSessionId: actor.authSessionId,
      capability: repository.CAPABILITY, capabilityGrantId: actor.capabilityGrantId,
      capabilityGrantRevision: actor.capabilityGrantRevision,
      businessPurpose: actor.businessPurpose, policyVersion: actor.policyVersion },
    reason: 'Review the exact synthetic billing destination.',
    sourceCustomerDigest: digest('source'), sourceCustomerUpdatedAt: instant,
    reviewedAt: instant, reviewState: 'reviewed', documentUseAuthorized: true,
    automaticCustomerCreationAuthorized: false };
}
function projection() {
  return { version: 'm27-billing-identity-review-state-v1', state: 'reviewed_current',
    available: true, current: true, reason: null, customerId: id(5), billingPartyId: id(6),
    reviewId: id(9), sequence: 1, sourceDigest: digest('source'), sourceUpdatedAt: instant,
    reviewDigest: digest('review-1'), reviewState: 'reviewed', documentUseAuthorized: true,
    value: reviewSnapshot(), automaticCustomerCreationAuthorized: false };
}

describe('Mission 27 Part 2B billing identity review contract', () => {
  test('accepts one exact reviewed current snapshot and freezes it', () => {
    const value = repository.verified(projection(), actor.organizationId);
    expect(value).toMatchObject({ state: 'reviewed_current', reviewState: 'reviewed',
      documentUseAuthorized: true, automaticCustomerCreationAuthorized: false });
    expect(value.value.prospectIdentity).toEqual({ state: 'unavailable', value: null,
      reason: 'canonical_prospect_source_unavailable' });
    expect(Object.isFrozen(value.value.billingContact.email.provenance)).toBe(true);
  });

  test('normalizes only a complete reviewed US identity and exact correction pins', () => {
    const input = { customerId: id(5), billingPartyId: id(6), originSnapshotId: id(7),
      expectedSourceDigest: digest('source'), expectedSourceUpdatedAt: instant,
      expectedPreviousReviewId: null, expectedPreviousReviewDigest: null,
      expectedPreviousSequence: 0, payload: { contact: { name: 'Synthetic customer',
        email: 'billing@example.test', phone: null }, serviceAddress: address,
      billingAddress: address, purchaseOrderReference: 'PO-100', customerReference: null },
      reason: 'Review the exact synthetic billing destination.' };
    expect(repository.normalizeReview(input)).toEqual(input);
    expect(() => repository.normalizeReview({ ...input,
      payload: { ...input.payload, serviceAddress: { ...address, countryCode: 'CA' } } }))
      .toThrow('Billing identity review evidence is invalid.');
    expect(() => repository.normalizeReview({ ...input, expectedPreviousSequence: 1 }))
      .toThrow('Billing identity review evidence is invalid.');
  });

  test('keeps stale and missing review states value-free', () => {
    const unavailable = { version: 'm27-billing-identity-review-state-v1', state: 'unavailable',
      available: false, current: false, reason: 'billing_identity_review_source_changed',
      customerId: id(5), billingPartyId: id(6), reviewId: id(9), sequence: null,
      sourceDigest: null, sourceUpdatedAt: null, reviewDigest: null, reviewState: null,
      documentUseAuthorized: false, value: null, automaticCustomerCreationAuthorized: false };
    expect(repository.verified(unavailable, actor.organizationId)).toEqual(unavailable);
    const leaking = { ...unavailable, value: reviewSnapshot() };
    expect(() => repository.verified(leaking, actor.organizationId))
      .toThrow('Billing identity review evidence is unavailable.');
    const superseded = { ...unavailable, reason: 'billing_identity_review_superseded' };
    expect(repository.verified(superseded, actor.organizationId)).toEqual(superseded);
  });

  test('ratifies append-only lineage and excludes later-slice authority', () => {
    const sql = read('migrations/261_customer_financial_billing_identity_review_v1.sql');
    expect(sql).toContain('canonical_customer_financial_billing_identity_reviews_v1');
    expect(sql).toContain("'canonical_prospect_source_unavailable'");
    expect(sql).toContain("'documentUseAuthorized',TRUE");
    expect(sql).toContain('previous_review_id');
    expect(sql).toContain("'billing_identity_review_superseded'");
    expect(sql).toContain("org::text||':billing-review-party:'||request_record.billing_party_id::text");
    expect(sql).toMatch(/latest_record\.id<>request_record\.review_id[\s\S]*latest_record\.sequence<>review_record\.sequence[\s\S]*latest_record\.reviewed_snapshot_digest/);
    expect(sql).toContain("current_setting('transaction_isolation')<>'read committed'");
    expect(sql).toContain('canonical_customer_financial_billing_capability_heads_v1');
    expect(sql).toContain("':billing-capability-grant:'");
    expect(sql).toMatch(/CREATE TRIGGER canonical_customer_financial_billing_capability_grants_v1_lock[\s\S]*BEFORE INSERT/);
    expect(sql).toMatch(/CREATE FUNCTION public\.canonical_customer_financial_billing_identity_v1_effect_grant_fence\(\)[\s\S]*pg_advisory_xact_lock[\s\S]*FOR SHARE OF head_value/);
    expect(sql.match(/BEFORE INSERT ON public\.canonical_customer_financial_billing_(?:parties|identity_requests|identity_reviews|review_requests)_v1/g)).toHaveLength(4);
    expect(sql).toMatch(/head_record\.latest_revision<>capability_grant_revision_value[\s\S]*canonical_customer_financial_billing_identity_capability_unavailable/);
    expect(read('src/customerFinancial/billingIdentityReviewRepository.js'))
      .toContain('BEGIN ISOLATION LEVEL READ COMMITTED');
    expect(sql).toContain('FOR SHARE');
    expect(sql).not.toMatch(/INSERT INTO public\.canonical_customers|UPDATE public\.canonical_customers|DELETE FROM public\.canonical_customers/);
    expect(sql).not.toMatch(/INSERT INTO public\.canonical_(?:estimates|appointments|invoice|payment)/i);
    expect(sql).not.toMatch(/customer_price|minor_units|currency|invoice_number/i);
    const names = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('267_customer_financial_part3_handoff_history_v1.sql');
    expect(names.filter(name => /^261_/.test(name))).toHaveLength(1);
    expect(read('src/customerFinancial/databaseAuthority.js')).toContain(
      "'canonical_customer_financial_billing_review_v1_accept'");
  });
});
