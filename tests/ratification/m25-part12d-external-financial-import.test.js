'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = value => fs.readFileSync(path.join(__dirname, '../..', value), 'utf8');

describe('Mission 25 Part 12 Slice D external financial evidence imports', () => {
  const migration = read('migrations/116_canonical_external_financial_import_authority.sql');
  test('stages four separate evidence classes with exact source lineage', () => {
    for (const value of ["record_type IN ('invoice','payment','collection','accounting_entry')", 'invoice_reference', 'payment_reference',
      'collection_reference', 'accounting_reference', 'customer_reference', 'job_reference', 'estimate_reference',
      'execution_reference', 'project_reference', 'change_order_reference',
      "'reconciliationStatus',CASE WHEN v.state='active' THEN 'unmatched'", 'historical_backfill', 'continuous_update']) {
      expect(migration).toContain(value);
    }
  });
  test('keeps amounts typed and unavailable rather than deriving financial truth', () => {
    for (const value of ["'invoice_total','invoice_balance'", "'payment_received','refund_issued'",
      "'amount_collected','outstanding_balance','write_off'", "'revenue','direct_cost','overhead_cost','other_income','other_cost','unknown'",
      "amount_claim->>'status'='unavailable'", "amount_claim->>'status'='recorded'"]) expect(migration).toContain(value);
    for (const forbidden of ['exchange_rate','converted_amount','profit_margin','tax_calculation','balance_calculation']) expect(migration).not.toContain(forbidden);
  });
  test('uses strict content-free tokens and known time zones at direct-table level', () => {
    const contract = read('src/learning/externalFinancialImportContract.js');
    expect(contract).toContain("const OPAQUE_REFERENCE = /^ref_[0-9a-f]{64}$/");
    expect(contract).toContain("const OPAQUE_CURSOR = /^cur_[0-9a-f]{64}$/");
    expect(migration).toContain("external_record_id~'^ref_[0-9a-f]{64}$'");
    expect(migration).toContain("accounting_reference~'^ref_[0-9a-f]{64}$'");
    expect(migration).toContain("amount_claim-ARRAY['status','amount','currency','basis']='{}'::jsonb");
    for (const required of ['record_type IS NOT NULL','record_state IS NOT NULL','amount_claim IS NOT NULL',
      'evidence_class IS NOT NULL','provider_evidence_digest IS NOT NULL']) expect(migration).toContain(required);
    expect(migration).toContain('FOREIGN KEY(time_zone) REFERENCES public.canonical_external_financial_time_zones(name)');
  });
  test('withholds tables and helpers while granting guarded entries only', () => {
    const db = read('src/db.js');
    for (const value of ['REVOKE ALL PRIVILEGES ON TABLE public.canonical_external_financial_import_consents',
      "NOT has_table_privilege($1,'public.canonical_external_financial_time_zones','SELECT,INSERT,UPDATE,DELETE')",
      'REVOKE ALL ON FUNCTION public.canonical_external_financial_record_projection',
      'GRANT EXECUTE ON FUNCTION public.canonical_external_financial_import_batch',
      'external_financial_import_helpers_withheld', '116_canonical_external_financial_import_authority.sql']) expect(db).toContain(value);
  });
  test('mounts owner routes and adds no rendered surface', () => {
    const routes = read('src/routes/learning.js');
    for (const value of ["'/external-financial-sources/:sourceKey/consent'", "'/external-financial-sources/:sourceKey/batches'",
      "'/external-financial-sources/:sourceKey'", 'financialImportContract.normalizeBatch']) expect(routes).toContain(value);
    for (const rendered of ['public/js/learning-center-page.js','public/dashboard/learning-center.html','public/css/learning-center.css']) {
      expect(read(rendered)).not.toContain('external-financial-sources');
    }
  });
  test('preserves the Mission 27 boundary and does not mutate operating or financial truth', () => {
    expect(migration).toContain('NorthStar billing and accounting records remain unavailable until Mission 27');
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:customers|opportunities|appointments|canonical_estimates|invoices|payments|canonical_field_executions)\b/);
    for (const forbidden of ['account_number','routing_number','card_number','message_body','subject','transcript','customer_name']) expect(migration).not.toContain(forbidden);
  });
});
