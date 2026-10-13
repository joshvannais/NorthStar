'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createInitialDemoState } = require('../../src/commandCenter/workspace');
const journey = require('../../src/customerFinancial/demoBillingIdentityJourney');

const ROOT = path.resolve(__dirname, '..', '..');
const read = value => fs.readFileSync(path.join(ROOT, value), 'utf8');
const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key = value => crypto.createHash('sha256').update(value).digest('hex');
const at = value => new Date(value);

function initial(seed = 'm27-part2d') {
  return createInitialDemoState(tenant, at('2026-10-11T12:00:00.000Z'), { seed, generation: 1 });
}
function source(state) {
  const customerId = state.graphs[0].ids.customer;
  return { customerId, envelope: journey.journeyEnvelope(state, 1, customerId) };
}
function establish(state, suffix = 'establish') {
  const selected = source(state);
  return journey.apply(state, { action: 'establish', customerId: selected.customerId,
    expectedSourceDigest: selected.envelope.identity.sourceDigest,
    expectedSourceUpdatedAt: selected.envelope.identity.sourceUpdatedAt,
    reason: 'Begin this explicit fictional billing identity review.' }, key(suffix),
  at('2026-10-11T12:05:00.000Z'));
}
function review(state, suffix = 'review') {
  const customerId = state.graphs[0].ids.customer;
  const value = journey.journeyEnvelope(state, 2, customerId);
  const candidate = value.review.value;
  return journey.apply(state, { action: 'review', customerId,
    billingPartyId: value.review.billingPartyId,
    originSnapshotId: value.identity.snapshotId,
    expectedSourceDigest: value.review.sourceDigest,
    expectedSourceUpdatedAt: value.review.sourceUpdatedAt,
    expectedPreviousReviewId: value.review.reviewId,
    expectedPreviousReviewDigest: value.review.reviewDigest,
    expectedPreviousSequence: value.review.sequence,
    payload: { contact: { name: candidate.name, email: candidate.email, phone: candidate.phone },
      serviceAddress: candidate.serviceAddress, billingAddress: candidate.serviceAddress,
      purchaseOrderReference: 'PO-FICTIONAL-27', customerReference: 'DEMO-CUSTOMER-27' },
    reason: 'Confirm this fictional billing identity for review-only evidence.' }, key(suffix),
  at('2026-10-11T12:06:00.000Z'));
}

describe('Mission 27 Part 2D mounted billing identity journeys', () => {
  test('keeps the fictional journey deterministic, isolated, account-free, and mutation-free', () => {
    const first = source(initial());
    const second = source(initial());
    expect(first).toEqual(second);
    expect(first.envelope).toMatchObject({ version: 'm27-billing-identity-journey-v1',
      mode: 'isolated_fictional_demo', fictional: true, accountFree: true, resettable: true,
      identity: { state: 'candidate_unreviewed', documentUseAuthorized: false },
      review: null, history: { complete: true, total: 0 }, invoiceMutationCount: 0,
      paymentMutationCount: 0, providerCallCount: 0, customerCreationCount: 0 });
    expect(JSON.stringify(first.envelope)).not.toMatch(/providerPayload|transcript|real customer/i);
  });

  test('establishes and reviews exact fictional source evidence with immutable lineage', () => {
    let state = establish(initial());
    let current = journey.journeyEnvelope(state, 2, state.graphs[0].ids.customer);
    expect(current).toMatchObject({ identity: { state: 'established_unreviewed' },
      review: { state: 'review_required', sequence: 0, documentUseAuthorized: false } });
    state = review(state);
    current = journey.journeyEnvelope(state, 3, state.graphs[0].ids.customer);
    expect(current).toMatchObject({ review: { state: 'reviewed_current', sequence: 1,
      documentUseAuthorized: true, value: { fictional: true,
        payload: { purchaseOrderReference: 'PO-FICTIONAL-27' } } },
    history: { complete: true, total: 1, revisions: [{ sequence: 1 }] },
    invoiceMutationCount: 0, paymentMutationCount: 0, providerCallCount: 0 });
    expect(current.review.sourceDigest).toBe(current.identity.sourceDigest);
    expect(current.review.reviewDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  test('requires another human review after a fictional source correction and keeps the prior receipt', () => {
    let state = review(establish(initial('m27-part2d-correction')));
    const customerId = state.graphs[0].ids.customer;
    const before = journey.journeyEnvelope(state, 3, customerId);
    state = journey.apply(state, { action: 'correct_source', customerId,
      expectedSourceDigest: before.identity.sourceDigest,
      reason: 'Simulate one explicit fictional customer source correction.' }, key('correction'),
    at('2026-10-11T12:07:00.000Z'));
    const changed = journey.journeyEnvelope(state, 4, customerId);
    expect(changed).toMatchObject({ identity: { state: 'unavailable',
      reason: 'billing_identity_source_changed_requires_review', documentUseAuthorized: false },
    review: { state: 'correction_required', sequence: 1, reviewId: before.review.reviewId,
      reviewDigest: before.review.reviewDigest, documentUseAuthorized: false },
    history: { total: 1 } });
    expect(changed.review.sourceDigest).not.toBe(before.review.sourceDigest);
    const corrected = journey.journeyEnvelope(review(state, 'corrected-review'), 5, customerId);
    expect(corrected.review).toMatchObject({ state: 'reviewed_current', sequence: 2,
      documentUseAuthorized: true });
    expect(corrected.history.revisions.map(value => value.sequence)).toEqual([1, 2]);
  });

  test('fails closed for stale pins, malformed requests, and foreign fictional customers', () => {
    const state = initial('m27-part2d-denials');
    const selected = source(state);
    expect(() => journey.apply(state, { action: 'establish', customerId: selected.customerId,
      expectedSourceDigest: '0'.repeat(64),
      expectedSourceUpdatedAt: selected.envelope.identity.sourceUpdatedAt,
      reason: 'Attempt a stale fictional billing identity review.' }, key('stale'), at('2026-10-11T12:05:00Z')))
      .toThrow('source changed');
    expect(() => journey.apply(state, { action: 'establish', customerId: selected.customerId },
      key('malformed'), at('2026-10-11T12:05:00Z'))).toThrow('Check the fictional');
    expect(() => journey.journeyEnvelope(state, 1, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
      .toThrow('unavailable');
  });

  test('mounts private paid and isolated demo routes without browser-selected authority', () => {
    const paid = read('src/routes/customerFinancialBillingIdentity.js');
    const resolver = read('migrations/263_customer_financial_billing_journey_v1.sql');
    const server = read('src/server.js');
    const demoRoute = read('src/routes/demo.js');
    expect(server).toContain("/api/v1/customer-financial/billing-identities");
    expect(paid).toContain("requireRole('owner', 'admin')");
    expect(paid).not.toMatch(/req\.body\.(?:capability|grant|policy|purpose)/);
    expect(resolver).toContain("capability='customer_financial.billing_identity.review'");
    expect(resolver).toContain("business_purpose='customer_financial.billing_identity'");
    expect(resolver).toContain("policy_version='mission27.launch.v1'");
    expect(resolver).toContain('candidate_count<>1');
    expect(demoRoute).toContain("mutationBoundary(req, res, 'billing-identity-review')");
    expect(demoRoute).toContain("operation: 'billing_identity'");
  });

  test('mounts one stale-clearing accessible shared UI and deterministic reset focus', () => {
    const html = read('public/dashboard/settings.html');
    const browser = read('public/js/customer-financial-billing-identity.js');
    const rendered = read('tests/browser/m27-part2d-billing-identity.js');
    const css = read('public/css/customer-financial-billing-identity.css');
    expect(html).toContain('id="billing-identity-journey"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('/js/customer-financial-billing-identity.js');
    expect(browser).toContain('function clearPrivate()');
    expect(browser).toContain("}, 'resetBillingIdentityDemo');");
    expect(browser).toContain("value.invoiceMutationCount !== 0");
    expect(browser).not.toMatch(/capabilityGrantId|capabilityGrantRevision|policyVersion/);
    expect(css).toMatch(/@media \(max-width: 720px\)/);
    expect(css).toMatch(/forced-colors/);
    expect(rendered).toContain('MISSION_26_FIVE_LAYOUTS');
    expect(rendered).toContain("for (const mode of ['paid', 'demo'])");
    expect(rendered).toContain('assert.equal(cases.length, 10)');
    expect(rendered).toContain("liveMoneyEvidence: 'not-run-deferred-first-paying-customer'");
  });

  test('keeps migration 263 additive, admits only the bounded demo operation, and keeps runtime access function-only', () => {
    const sql = read('migrations/263_customer_financial_billing_journey_v1.sql');
    const names = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('268_customer_financial_invoice_draft_origin_v1.sql');
    expect(names.filter(name => /^263_/.test(name))).toHaveLength(1);
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('REVOKE ALL ON FUNCTION');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION');
    expect(sql).toContain("'forecast_journey','billing_identity','estimate_review'");
    expect(sql.match(/ALTER TABLE public\.demo_command_center_mutations/g)).toHaveLength(2);
    expect(sql).not.toMatch(/CREATE TABLE|GRANT (?:SELECT|INSERT|UPDATE|DELETE)/i);
    expect(sql).not.toMatch(/INSERT INTO public\.canonical_(?:invoices|payments|estimates|appointments)/i);
  });
});
