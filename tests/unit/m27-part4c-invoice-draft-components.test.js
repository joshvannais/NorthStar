'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoiceDraftComponents');
const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const DIGEST = 'a'.repeat(64);
const UUID = '11111111-1111-4111-8111-111111111111';
const money = minorUnits => ({ version: 'm27-exact-money-v1', currency: 'USD', minorUnitExponent: 2,
  minorUnits, decimal: `${BigInt(minorUnits) / 100n}.${String(BigInt(minorUnits) % 100n).padStart(2,'0')}`,
  exactZero: minorUnits === '0' });

function current() {
  return { contractVersion: contract.CONTRACT_VERSION, state: 'current', invoiceDraft: {
    originId: UUID, originDigest: DIGEST, revision: 2, draftDigest: DIGEST,
    historyChainDigest: DIGEST, currency: 'USD', subtotalBeforeTax: money('2500'),
  }, commercialRevision: { authorityClass: 'mission24.current_accepted_commercial_revision',
    issuedVersionId: UUID, issuedRevision: 3, issuedDigest: DIGEST, documentDigest: DIGEST,
    commercialApprovalId: UUID, commercialApprovalDigest: DIGEST,
    customerAcceptance: { state: 'accepted_current', acceptanceId: UUID, acceptanceDigest: DIGEST },
    amountChangingFeesDiscountsOrScopeRequireNewAcceptedMission24Revision: true,
    mission27CommercialAmountOverrideAuthorized: false },
  financialComponents: contract.COMPONENT_TYPES.map((componentType, index) => ({ componentType,
    state: 'unavailable', reason: contract.COMPONENT_REASONS[index], value: null, provenance: null,
    arithmeticRole: ['amount_due_subtraction_once','amount_due_subtraction_once',
      'document_balance_adjustment_once','settled_payment_reversal_once',
      'tax_liability_adjustment_once'][index],
    missingEvidence: [contract.COMPONENT_MISSING_EVIDENCE[index]] })),
  unsupportedShapes: contract.UNSUPPORTED_TYPES.map((componentType,index) => ({ componentType,
    state: 'unsupported', reason: contract.UNSUPPORTED_REASONS[index], value: null,
    provenance: null, arithmeticRole: 'none' })), reconciliation: {
    version: 'm27-invoice-component-reconciliation-v1',
    commercialSubtotalSource: 'exact_current_invoice_draft_only',
    subtotalBeforeTax: money('2500'), separateComponentsAffectCommercialSubtotal: false,
    depositScheduleIsPaymentReceipt: false, componentIdentityAndProvenanceRequired: true,
    duplicateComponentEffectAllowed: false,
    componentEffect: { state: 'unavailable', reason: 'financial_component_evidence_unavailable', value: null },
    amountDue: { state: 'unavailable', reason: 'invoice_reconciliation_not_yet_authorized', value: null },
  }, sourceCurrent: true, commercialSourceAuthorityCurrent: true, invoiceAuthorized: false,
  receivableAuthorized: false, issueAuthorized: false, providerCallCount: 0,
  receiverMutationCount: 0, componentsDigest: DIGEST };
}

describe('Mission 27 Part 4C typed invoice-draft components', () => {
  const migration = read('migrations/270_customer_financial_invoice_draft_components_v1.sql');

  test('accepts only the exact-current Mission 24 commercial authority and reconciled subtotal', () => {
    expect(contract.project(current()).commercialRevision).toMatchObject({
      authorityClass: 'mission24.current_accepted_commercial_revision',
      mission27CommercialAmountOverrideAuthorized: false,
    });
    const mismatch = current(); mismatch.reconciliation.subtotalBeforeTax = money('2499');
    expect(() => contract.project(mismatch)).toThrow();
    const zero = current(); zero.invoiceDraft.subtotalBeforeTax = money('0');
    zero.reconciliation.subtotalBeforeTax = money('0');
    expect(contract.project(zero).invoiceDraft.subtotalBeforeTax.exactZero).toBe(true);
    const callerAmount = current(); callerAmount.commercialRevision.callerAmount = money('9999');
    expect(() => contract.project(callerAmount)).toThrow();
    expect(migration).toContain('canonical_customer_financial_invoice_draft_revision_v1_current');
    expect(migration).toContain("'mission24.current_accepted_commercial_revision'");
    expect(migration).toContain("'mission27CommercialAmountOverrideAuthorized',FALSE");
  });

  test('keeps every absent native financial component typed, value-free and non-additive', () => {
    const projected = contract.project(current());
    expect(projected.financialComponents.map(value => value.componentType))
      .toEqual(contract.COMPONENT_TYPES);
    expect(projected.financialComponents.every(value => value.value === null &&
      value.provenance === null && value.state === 'unavailable')).toBe(true);
    expect(projected.financialComponents.map(value => value.missingEvidence[0]))
      .toEqual(contract.COMPONENT_MISSING_EVIDENCE);
    expect(projected.reconciliation).toMatchObject({
      separateComponentsAffectCommercialSubtotal: false,
      depositScheduleIsPaymentReceipt: false,
      duplicateComponentEffectAllowed: false,
      componentEffect: { state: 'unavailable', value: null },
      amountDue: { state: 'unavailable', value: null },
    });
    const leaked = current(); leaked.financialComponents[0].value = money('100');
    expect(() => contract.project(leaked)).toThrow();
    const substitutedEvidence = current();
    substitutedEvidence.financialComponents[0].missingEvidence = ['caller.claimed.deposit'];
    expect(() => contract.project(substitutedEvidence)).toThrow();
    const substitutedReason = current();
    substitutedReason.reconciliation.amountDue.reason = 'caller_claimed_zero_balance';
    expect(() => contract.project(substitutedReason)).toThrow();
  });

  test('preserves all frozen unsupported commercial shapes without fallback', () => {
    const projected = contract.project(current());
    expect(projected.unsupportedShapes.map(value => value.componentType))
      .toEqual(contract.UNSUPPORTED_TYPES);
    expect(projected.unsupportedShapes.map(value => value.reason))
      .toEqual(contract.UNSUPPORTED_REASONS);
    const fallback = current(); fallback.unsupportedShapes[0].state = 'current';
    expect(() => contract.project(fallback)).toThrow();
  });

  test('rejects stale responses unless every amount and component is value-free', () => {
    expect(contract.unavailable({ contractVersion: contract.CONTRACT_VERSION, state: 'unavailable',
      reason: 'mission24_commercial_source_stale', value: null, sourceCurrent: false,
      commercialSourceAuthorityCurrent: false, invoiceAuthorized: false, receivableAuthorized: false,
      issueAuthorized: false, providerCallCount: 0, receiverMutationCount: 0 }).value).toBeNull();
    expect(() => contract.unavailable({ contractVersion: contract.CONTRACT_VERSION,
      state: 'unavailable', reason: 'stale', value: null, sourceCurrent: false,
      commercialSourceAuthorityCurrent: false, invoiceAuthorized: false, receivableAuthorized: false,
      issueAuthorized: false, providerCallCount: 0, receiverMutationCount: 0,
      financialComponents: [] })).toThrow();
  });

  test('mounts only one read entry and withholds private helpers and downstream actions', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    const authority = read('src/customerFinancial/databaseAuthority.js');
    expect(route).toContain("router.get('/:estimateId/invoice-draft/components'");
    expect(route).not.toContain("router.post('/:estimateId/invoice-draft/components'");
    expect(authority).toContain("'canonical_customer_financial_invoice_draft_components_v1_read'");
    const entries = authority.slice(authority.indexOf('const ENTRIES'), authority.indexOf('const TABLES'));
    expect(entries).not.toContain('components_v1_missing');
    expect(entries).not.toContain('components_v1_unsupported');
    for (const effect of ["'invoiceAuthorized',FALSE","'receivableAuthorized',FALSE",
      "'issueAuthorized',FALSE","'providerCallCount',0","'receiverMutationCount',0"]) {
      expect(migration).toContain(effect);
    }
  });
});
