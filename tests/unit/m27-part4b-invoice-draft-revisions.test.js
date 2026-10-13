'use strict';

const fs = require('node:fs');
const path = require('node:path');
const contract = require('../../src/customerFinancial/invoiceDraftRevision');
const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const DIGEST = 'a'.repeat(64);
const UUID = '11111111-1111-4111-8111-111111111111';
const money = minorUnits => ({ version: 'm27-exact-money-v1', currency: 'USD',
  minorUnitExponent: 2, minorUnits, decimal: `${BigInt(minorUnits) / 100n}.${String(
    BigInt(minorUnits) % 100n).padStart(2,'0')}`, exactZero: minorUnits === '0' });

describe('Mission 27 Part 4B append-only invoice-draft revisions', () => {
  const migration = read('migrations/269_customer_financial_invoice_draft_revisions_v1.sql');

  test('accepts only bounded wording, grouping and exact allocation edits', () => {
    const edit = { contractVersion: contract.EDIT_VERSION, originId: UUID, originDigest: DIGEST,
      lines: [{ ordinal: 0, sourceLineDigest: DIGEST, group: 'Core service',
        description: 'Customer-safe service description', allocatedMinorUnits: '0' }] };
    expect(contract.normalizeEdit(edit)).toEqual(edit);
    expect(() => contract.normalizeEdit({ ...edit, priceAuthority: true })).toThrow();
    expect(() => contract.normalizeEdit({ ...edit, lines: [...edit.lines, edit.lines[0]] })).toThrow();
    expect(() => contract.normalizeEdit({ ...edit,
      lines: [{ ...edit.lines[0], allocatedMinorUnits: '-1' }] })).toThrow();
    expect(migration).toContain('edit_count<>source_count');
    expect(migration).toContain("edit_line->>'sourceLineDigest'<>source_line->>'lineDigest'");
    expect(migration).toContain('total_value<>saved.subtotal_before_tax_minor_units');
    expect(migration).toContain('cannot change accepted commercial total');
    expect(migration).toContain('count(DISTINCT');
  });

  test('projects exact zero distinctly and rejects inconsistent recalculation', () => {
    const value = { contractVersion: contract.CONTRACT_VERSION, state: 'current', originId: UUID,
      originDigest: DIGEST, candidateDigest: DIGEST, revision: 0, draftDigest: DIGEST,
      historyChainDigest: DIGEST, currency: 'USD', lines: [{ ordinal: 0,
        sourceLineDigest: DIGEST, group: 'Deposit', description: 'Accepted deposit',
        quantity: { version: 'm27-invoice-quantity-v1', value: '1', unit: 'accepted_deposit' },
        allocatedAmount: money('0') }],
      subtotalBeforeTax: money('0'), sourceCurrent: true, invoiceAuthorized: false,
      receivableAuthorized: false, issueAuthorized: false, providerCallCount: 0,
      receiverMutationCount: 0 };
    expect(contract.project(value).subtotalBeforeTax).toMatchObject({ minorUnits: '0', exactZero: true });
    expect(() => contract.project({ ...value, subtotalBeforeTax: money('1') })).toThrow();
    expect(contract.unavailable({ contractVersion: contract.CONTRACT_VERSION, state: 'unavailable',
      reason: 'reviewed_handoff_stale', value: null, sourceCurrent: false,
      invoiceAuthorized: false, receivableAuthorized: false, issueAuthorized: false,
      providerCallCount: 0, receiverMutationCount: 0 }).value).toBeNull();
  });

  test('uses database-owned current source, optimistic concurrency and exact idempotency', () => {
    expect(migration).toContain('canonical_customer_financial_invoice_draft_v1_source');
    expect(migration).toContain('canonical_customer_financial_invoice_draft_origins_v1');
    expect(migration).toContain(':invoice-draft-revision:');
    expect(migration).toContain("current_value->>'revision')::bigint<>expected_revision");
    expect(migration).toContain("current_value->>'draftDigest'<>expected_draft_digest");
    expect(migration).toContain('Idempotency key conflict');
    expect(migration).toContain('Saved invoice-draft revision is superseded');
    expect(migration).toContain('history_chain_digest');
  });

  test('keeps revisions immutable, tenant private and runtime-callable only through guarded entries', () => {
    const authority = read('src/customerFinancial/databaseAuthority.js');
    for (const table of ['canonical_customer_financial_invoice_draft_revisions_v1',
      'canonical_customer_financial_invoice_draft_revision_requests_v1']) {
      expect(migration).toContain(`'${table}'`);
      expect(authority).toContain(`'${table}'`);
    }
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('BEFORE UPDATE OR DELETE OR TRUNCATE');
    expect(authority).toContain("'canonical_customer_financial_invoice_draft_revision_v1_read'");
    expect(authority).toContain("'canonical_customer_financial_invoice_draft_revision_v1_save'");
    const entries = authority.slice(authority.indexOf('const ENTRIES'), authority.indexOf('const TABLES'));
    expect(entries).not.toContain('invoice_draft_revision_v1_build');
    expect(entries).not.toContain('invoice_draft_revision_v1_current');
  });

  test('mounts the owner/admin revision route and preserves later-part boundaries', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    expect(route).toContain("router.get('/:estimateId/invoice-draft'");
    expect(route).toContain("router.post('/:estimateId/invoice-draft'");
    expect(route).toContain('invoiceDraftRevisionSave');
    expect(migration).toContain("'invoiceAuthorized',FALSE");
    expect(migration).toContain("'receivableAuthorized',FALSE");
    expect(migration).toContain("'issueAuthorized',FALSE");
    expect(read('docs/architecture/MISSION_27_PART4B_INVOICE_DRAFT_REVISIONS.md'))
      .toContain('Part 4C remains the only next slice');
  });
});
