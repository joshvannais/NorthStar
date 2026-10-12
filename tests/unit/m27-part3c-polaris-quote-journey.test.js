'use strict';

const crypto = require('node:crypto');
const quote = require('../../src/customerFinancial/polarisQuoteJourney');
const money = require('../../src/customerFinancial/exactMoney');
const grants = require('../../src/customerFinancial/estimateJourneyGrantIssuer');
const fs = require('node:fs');
const path = require('node:path');

const ids = { estimateId: '11111111-1111-4111-8111-111111111111',
  customerId: '22222222-2222-4222-8222-222222222222' };
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function draft() {
  return { options: [{ id: 'good', name: 'Good', scope: 'Repair the exact reviewed scope.',
    validityDays: 14, assumptions: ['Existing surface remains serviceable.'],
    lines: [{ id: 'line_good', description: 'Reviewed repair', quantity: '1.25',
      unit: 'job', price: money.fromMinorUnits('0') }] },
  { id: 'better', name: 'Better', scope: 'Replace the exact reviewed scope.',
    validityDays: 21, assumptions: [], lines: [{ id: 'line_better',
      description: 'Reviewed replacement', quantity: '2', unit: 'section',
      price: money.fromMinorUnits('1097142') }] }] };
}

describe('Mission 27 Part 3C Polaris quote journey', () => {
  test('normalizes every editable field with exact independent option totals and stable identity', () => {
    const normalized = quote.normalizeDraft(draft(), { ...ids,
      sourceDigest: digest('source'), sourceRevisionDigest: digest('revision') });
    expect(normalized).toMatchObject({ version: 'polaris.editable.estimate.v1', ...ids,
      currency: 'USD', machineDraftApprovedPrice: false,
      options: [{ id: 'good', scope: 'Repair the exact reviewed scope.',
        total: { minorUnits: '0', exactZero: true } },
      { id: 'better', total: { minorUnits: '1097142', decimal: '10971.42' } }] });
    expect(normalized.options[0].lines[0]).toMatchObject({ quantity: '1.25', unit: 'job' });
    expect(normalized.options[0].assumptions[0].text).toBe('Existing surface remains serviceable.');
    expect(normalized.draftDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(quote.normalizeDraft(draft(), { ...ids, sourceDigest: digest('source'),
      sourceRevisionDigest: digest('revision') }).draftDigest).toBe(normalized.draftDigest);
  });

  test('keeps exact zero distinct and rejects malformed money, missing units and option overflow', () => {
    const source = { ...ids, sourceDigest: digest('source'), sourceRevisionDigest: digest('revision') };
    const missingUnit = draft(); missingUnit.options[0].lines[0].unit = '';
    expect(() => quote.normalizeDraft(missingUnit, source)).toThrow(/Unit/);
    const malformed = draft(); malformed.options[1].lines[0].price = { minorUnits: '1097142' };
    expect(() => quote.normalizeDraft(malformed, source)).toThrow(/exact USD cents/);
    const overflow = draft(); overflow.options.push(...[draft().options[0], draft().options[1]]);
    expect(() => quote.normalizeDraft(overflow, source)).toThrow(/one through three/);
    const duplicateLine = draft(); duplicateLine.options[1].lines[0].id = duplicateLine.options[0].lines[0].id;
    expect(() => quote.normalizeDraft(duplicateLine, source)).toThrow(/identities/);
  });

  test('binds the multi-option Mission 24 proposal to one exact draft and never claims delivery', () => {
    const normalized = Object.freeze({ ...quote.normalizeDraft(draft(), { ...ids,
      sourceDigest: digest('source'), sourceRevisionDigest: digest('revision') }),
    revision: 2 });
    const proposal = quote.proposal(normalized, '33333333-3333-4333-8333-333333333333',
      1, '2026-10-11T12:00:00.000Z');
    expect(proposal).toMatchObject({ version: 'm24.polaris.multi_option_proposal.v1',
      draftRevision: 2, draftDigest: normalized.draftDigest,
      signatureMethod: 'm24.typed_name_explicit_consent.v1', automaticDelivery: false,
      exactMission24Authority: true });
    expect(proposal.proposalDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test.each([
    ['customer_financial.estimate.edit_draft','single_control','current_session'],
    ['customer_financial.estimate.edit_options','single_control','current_session'],
    ['customer_financial.estimate.request_signature','conditional_dual_control','recent_auth'],
    ['customer_financial.estimate.review_signature','single_control','recent_auth'],
    ['customer_financial.estimate.request_work_handoff','conditional_dual_control','recent_auth'],
  ])('ratifies the frozen action-specific grant %s', (capability, actionMode, assurance) => {
    expect(grants.classify('owner', capability)).toMatchObject({ capability, actionMode, assurance,
      policyVersion: 'mission27.launch.v1' });
    expect(grants.classify('admin', capability)).toMatchObject({ capability, actionMode, assurance });
    expect(() => grants.classify('member', capability)).toThrow(/restricted/);
  });

  test('keeps signature and work receiver prerequisites named and value-free', () => {
    expect(quote.unavailable('legal_review_unavailable', ['professional_review.legal']))
      .toEqual(expect.objectContaining({ state: 'unavailable', value: null,
        providerCallCount: 0, receiverMutationCount: 0, financialActionAuthorized: false }));
  });

  test('ratifies immutable logical grant scope and fail-closed capability discovery', () => {
    const migration = fs.readFileSync(path.join(__dirname,
      '../../migrations/266_customer_financial_billable_work_review_v1.sql'), 'utf8');
    expect(migration).toMatch(/Grant identity cannot change/);
    expect(migration).toMatch(/A current grant already owns this estimate journey scope/);
    expect(migration).toMatch(/membership_id=\(actor_authority->>'membershipId'\)::uuid/);
    expect(migration).toMatch(/Estimate journey capability scope is ambiguous/);
    expect(migration).toMatch(/grant_row\.target_class<>'canonical_estimate'/);
  });
});
