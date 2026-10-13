'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoiceTaxReview');
const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const DIGEST = 'a'.repeat(64);
const UUID = '11111111-1111-4111-8111-111111111111';
const money = minorUnits => ({ version: 'm27-exact-money-v1', currency: 'USD', minorUnitExponent: 2,
  minorUnits, decimal: `${BigInt(minorUnits) / 100n}.${String(BigInt(minorUnits) % 100n).padStart(2,'0')}`,
  exactZero: minorUnits === '0' });

function candidate() {
  return { contractVersion: contract.CONTRACT_VERSION, state: 'ready_to_record', reviewId: null,
    reviewSequence: 0, preparation: { version: 'm27-invoice-date-tax-preparation-v1',
      invoiceDate: '2026-10-13', invoiceDraft: { originId: UUID, originDigest: DIGEST,
        revision: 2, draftDigest: DIGEST, historyChainDigest: DIGEST, currency: 'USD',
        subtotalBeforeTax: money('10000') }, billingIdentity: { billingPartyId: UUID,
        reviewId: UUID, reviewSequence: 1, reviewDigest: DIGEST }, mission24: {
        authorityClass: 'mission24.current_accepted_tax_preparation', issuedVersionId: UUID,
        issuedRevision: 2, issuedDigest: DIGEST, documentDigest: DIGEST, termsId: UUID,
        termsRevision: 3, termsDigest: DIGEST, decisionDigest: DIGEST,
        calculationVersion: 'estimate-commercial-terms-v2', taxAuthorityClass: 'owner_recorded' },
      serviceJurisdiction: { countryCode: 'US', region: 'MA', city: 'Boston', postalCode: '02108' },
      billingJurisdiction: { countryCode: 'US', region: 'MA', city: 'Boston', postalCode: '02108' },
      registrationEvidence: { state: 'unavailable', reason: 'registration_evidence_unavailable', value: null },
      nexusEvidence: { state: 'unavailable', reason: 'professional_tax_policy_unavailable', value: null },
      exemptionSnapshot: { classification: 'none', evidenceReference: 'Customer statement',
        profileExemptionReference: null }, rounding: {
        version: 'mission24.canonical_commercial_numeric_round.v1', mode: 'half_away_from_zero',
        minorUnitExponent: 2 }, lines: [{ ordinal: 0, invoiceSourceLineDigest: DIGEST,
        mission24LineId: 'installation', taxGroupId: 'default', treatment: 'taxable',
        inclusiveExclusive: 'exclusive', ratePercent: '6.25', taxableBasis: money('10000'),
        collectedTax: money('625'), source: { kind: 'owner_recorded', jurisdiction: 'MA',
          location: 'Boston MA', serviceKey: 'fence', collectionBasis: 'service_location',
          reference: 'Owner review', effectiveOn: '2026-01-01', endsOn: null,
          reviewedOn: '2026-10-13', reviewValidThrough: '2026-10-13', ruleId: null,
          ruleDigest: null } }], collectedTaxLiability: { amount: money('625'),
        arithmeticRole: 'tax_liability_separate_from_commercial_subtotal',
        revenueRecognitionAuthorized: false, filingAuthorized: false },
      creditRefundAdjustmentLineage: { state: 'unavailable', reason: 'credit_refund_lineage_unavailable',
        value: null, missingEvidence: ['mission27.native_credit_note','mission27.native_refund_receipt'] },
      sourceCurrent: true, providerCalculationUsed: false, browserArithmeticUsed: false },
    preparationDigest: DIGEST, professionalPolicy: { state: 'unavailable',
      reason: 'tax_authority_unavailable', value: null,
      missingEvidence: ['professional_tax_policy_review'] }, taxReviewDisposition: {
      state: 'unavailable', reason: 'tax_authority_unavailable', value: null,
      taxBearingInvoiceAuthorized: false }, sourceCurrent: true, taxAuthorityCurrent: false,
    taxBearingInvoiceAuthorized: false, invoiceAuthorized: false, receivableAuthorized: false,
    issueAuthorized: false, providerCallCount: 0, receiverMutationCount: 0,
    candidateDigest: DIGEST, reviewDigest: null, reason: null, reviewedAt: null };
}

describe('Mission 27 Part 4D invoice-date tax review', () => {
  const migration = read('migrations/271_customer_financial_invoice_tax_review_v1.sql');

  test('preserves exact line tax, jurisdiction and separated liability without authorizing tax', () => {
    const value = contract.project(candidate());
    expect(value.preparation.lines[0].taxableBasis.minorUnits).toBe('10000');
    expect(value.preparation.collectedTaxLiability.amount.minorUnits).toBe('625');
    expect(value.taxAuthorityCurrent).toBe(false);
    expect(value.taxBearingInvoiceAuthorized).toBe(false);
    expect(value.preparation.providerCalculationUsed).toBe(false);
    const mismatch = candidate(); mismatch.preparation.collectedTaxLiability.amount = money('624');
    expect(() => contract.project(mismatch)).toThrow();
    const zero = candidate(); zero.preparation.lines[0].collectedTax = money('0');
    zero.preparation.collectedTaxLiability.amount = money('0');
    expect(contract.project(zero).preparation.collectedTaxLiability.amount.exactZero).toBe(true);
  });

  test('requires exact current Mission 24 and reviewed billing authority and names missing policy', () => {
    expect(migration).toContain('canonical_customer_financial_invoice_draft_components_v1_read');
    expect(migration).toContain('canonical_customer_financial_billing_review_v1_projection');
    expect(migration).toContain("'mission24.current_accepted_tax_preparation'");
    expect(migration).toContain("'professional_tax_policy_unavailable'");
    expect(migration).toContain("'taxBearingInvoiceAuthorized',FALSE");
    const callerAuthority = candidate(); callerAuthority.preparation.mission24.authorityClass = 'caller_claim';
    expect(() => contract.project(callerAuthority)).toThrow();
    const unsupported = candidate(); unsupported.preparation.serviceJurisdiction.countryCode = 'CA';
    expect(() => contract.project(unsupported)).toThrow();
    const unsupportedSubdivision = candidate(); unsupportedSubdivision.preparation.serviceJurisdiction.region = 'PR';
    expect(() => contract.project(unsupportedSubdivision)).toThrow();
    expect(migration).toContain("'WV','WI','WY','DC'");
  });

  test('accepts an immutable reviewed record but rejects provider or invoice effects', () => {
    const value = candidate(); delete value.candidateDigest;
    Object.assign(value, { state: 'recorded_policy_unavailable', reviewId: UUID, reviewSequence: 1,
      reviewDigest: DIGEST, reason: 'Owner reviewed invoice date tax preparation.',
      reviewedAt: '2026-10-13T12:00:00.000000Z' });
    expect(contract.project(value).state).toBe('recorded_policy_unavailable');
    const effect = JSON.parse(JSON.stringify(value)); effect.providerCallCount = 1;
    expect(() => contract.project(effect)).toThrow();
  });

  test('keeps every failed gate value-free', () => {
    expect(contract.project({ contractVersion: contract.CONTRACT_VERSION, state: 'unavailable',
      reason: 'billing_identity_review_required', value: null, sourceCurrent: false,
      taxAuthorityCurrent: false, taxBearingInvoiceAuthorized: false, invoiceAuthorized: false,
      receivableAuthorized: false, issueAuthorized: false, providerCallCount: 0,
      receiverMutationCount: 0 }).value).toBeNull();
    expect(() => contract.project({ contractVersion: contract.CONTRACT_VERSION, state: 'unavailable',
      reason: 'stale', value: null, sourceCurrent: false, taxAuthorityCurrent: false,
      taxBearingInvoiceAuthorized: false, invoiceAuthorized: false, receivableAuthorized: false,
      issueAuthorized: false, providerCallCount: 0, receiverMutationCount: 0,
      preparation: candidate().preparation })).toThrow();
  });

  test('mounts guarded read and record only and withholds tables and helpers', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    const authority = read('src/customerFinancial/databaseAuthority.js');
    expect(route).toContain("router.get('/:estimateId/invoice-draft/tax-review'");
    expect(route).toContain("router.post('/:estimateId/invoice-draft/tax-review'");
    expect(authority).toContain("'canonical_customer_financial_invoice_tax_review_v1_read'");
    expect(authority).toContain("'canonical_customer_financial_invoice_tax_review_v1_record'");
    const entries = authority.slice(authority.indexOf('const ENTRIES'), authority.indexOf('const TABLES'));
    expect(entries).not.toContain('tax_review_v1_source');
    expect(entries).not.toContain('tax_review_v1_money');
    expect(migration).toContain('canonical_customer_financial_invoice_tax_reviews_v1');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).not.toContain('CREATE INVOICE');
    const names = fs.readdirSync(path.join(ROOT, 'migrations')).filter(name => name.endsWith('.sql')).sort();
    expect(names.at(-1)).toBe('271_customer_financial_invoice_tax_review_v1.sql');
    expect(names.filter(name => /^271_/.test(name))).toHaveLength(1);
  });
});
