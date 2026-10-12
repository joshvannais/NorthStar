'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('Mission 27 Part 4A immutable invoice-draft origin', () => {
  const migration = read('migrations/268_customer_financial_invoice_draft_origin_v1.sql');

  test('uses only the exact current Part 3 handoff and database-owned Mission 24 basis', () => {
    expect(migration).toContain('canonical_customer_financial_billable_handoff_receipts_v1');
    expect(migration).toContain('canonical_customer_financial_billable_review_v1_source');
    expect(migration).toContain('canonical_customer_financial_billable_review_v1_projection');
    expect(migration).toContain('canonical_customer_financial_editable_basis_v1_read');
    expect(migration).toContain("'reviewed_handoff_stale'");
    expect(migration).toContain("'mission24_commercial_source_stale'");
    expect(migration).toContain("public.canonical_completion_digest(basis-'authority')");
    expect(migration).not.toMatch(/caller_(?:amount|line|customer|source)/i);
  });

  test('reconciles bounded customer-safe additive lines and leaves later authority unavailable', () => {
    expect(migration).toContain('item_count>24');
    expect(migration).toContain("'customer_safe_lines_unavailable'");
    expect(migration).toContain("'invoice_origin_reconciliation_failed'");
    expect(migration).toContain("'customer_safe_charge'");
    expect(migration).toContain('not a field quantity');
    expect(migration).toContain("'invoice_date_tax_review_required'");
    expect(migration).toContain("'invoice_reconciliation_not_yet_authorized'");
    expect(migration).toContain("'invoiceAuthorized',FALSE");
    expect(migration).toContain("'receivableAuthorized',FALSE");
    expect(migration).toContain("'issueAuthorized',FALSE");
  });

  test('persists immutable tenant-private origins and minimized replay receipts', () => {
    for (const table of ['canonical_customer_financial_invoice_draft_grants_v1',
      'canonical_customer_financial_invoice_draft_grant_heads_v1',
      'canonical_customer_financial_invoice_draft_origins_v1',
      'canonical_customer_financial_invoice_draft_origin_requests_v1']) {
      expect(migration).toContain(`ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY`);
      expect(read('src/customerFinancial/databaseAuthority.js')).toContain(`'${table}'`);
    }
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('BEFORE UPDATE OR DELETE OR TRUNCATE');
    expect(migration).toContain("'Idempotency key conflict'");
    expect(migration).toContain("'Saved invoice-draft origin is stale'");
    expect(migration).toContain("'body',saved.origin,'replayed',TRUE");
  });

  test('enforces the released action capability without widening launch v1', () => {
    const issuer = read('src/customerFinancial/invoiceDraftGrantIssuer.js');
    const policy = read('config/mission27-launch-contract.v1.json');
    expect(issuer).toContain("customer_financial.invoice.edit_draft");
    expect(issuer).toContain("customer_financial.invoice_draft");
    expect(issuer).toContain("mission27.launch.v1");
    expect(issuer).toContain("d24c8c83f6076cedbcf916d5a9f95240fdd4aa72758c930ea511336fa5b3c56a");
    expect(policy).toContain('"customer_financial.invoice.edit_draft"');
    expect(migration).toContain(':invoice-draft-grant-scope:');
    expect(migration).toContain('Invoice-draft grant identity cannot change');
    expect(migration).toContain('canonical_customer_financial_billing_identity_v1_entitlement(org,write_value)');
  });

  test('mounts only guarded read/capture entries and withholds direct authority', () => {
    const route = read('src/routes/customerFinancialEditableEstimate.js');
    const repository = read('src/customerFinancial/invoiceDraftOriginRepository.js');
    const authority = read('src/customerFinancial/databaseAuthority.js');
    const db = read('src/db.js');
    expect(route).toContain("router.get('/:estimateId/invoice-draft-origin'");
    expect(route).toContain("router.post('/:estimateId/invoice-draft-origin'");
    expect(repository).toContain("new Set(['handoffReceiptId','handoffReceiptDigest','capabilityGrantId'");
    expect(authority).toContain("'canonical_customer_financial_invoice_draft_v1_read'");
    expect(authority).toContain("'canonical_customer_financial_invoice_draft_v1_capture'");
    const entries = authority.slice(authority.indexOf('const ENTRIES'), authority.indexOf('const TABLES'));
    expect(entries).not.toContain('issue_grant');
    expect(entries).not.toContain('invoice_draft_v1_source');
    expect(db).toContain('customer_financial_invoice_draft_private');
  });

  test('keeps exact Part 4A scope and evidence boundaries explicit', () => {
    const architecture = read('docs/architecture/MISSION_27_PART4A_INVOICE_DRAFT_ORIGIN.md');
    const roadmap = read('docs/roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md');
    expect(roadmap).toContain('| A | Immutable draft origin');
    expect(architecture).toContain('does not create an invoice, receivable, tax result');
    expect(architecture).toContain('Live money remains deferred until the first real paying customer.');
    expect(architecture).toContain('Part 4B owns');
    expect(architecture).toContain('Part 4D owns invoice-date tax review');
  });
});
