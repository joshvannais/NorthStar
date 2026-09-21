'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = value => fs.readFileSync(path.join(__dirname, '../..', value), 'utf8');

describe('Mission 25 Part 12 Slice B project and change-order imports', () => {
  const migration = read('migrations/114_canonical_external_project_change_order_import_authority.sql');
  test('stages exact provider-neutral project and change-order classes', () => {
    for (const value of ["record_type IN ('project','change_order')",'project_reference','change_order_reference',
      'original_contract','current_contract','change_order_value',"'reconciliationStatus',CASE WHEN v.state='active' THEN 'unmatched'",
      'historical_backfill','continuous_update']) expect(migration).toContain(value);
  });
  test('keeps contract facts distinct and rejects inferred or malformed values', () => {
    for (const value of ["value->>'status' NOT IN ('recorded','unavailable')","value->>'currency'!~'^[A-Z]{3}$'",
      "value->>'amount'!~'^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,6})?$'",'changeOrderValue',
      "item->'changeOrderValue'->>'effect' NOT IN ('increase','decrease','no_change')"]) expect(migration).toContain(value);
    expect(migration).not.toMatch(/(?:current_contract|currentContract)\s*[-+]\s*(?:original_contract|originalContract)/);
  });
  test('preserves separate source consent, exact lineage, corrections and current-period masking', () => {
    for (const value of ['canonical_external_project_change_order_import_consents','canonical_external_project_change_order_import_runs',
      'canonical_external_project_change_order_import_records','request_key_hash','previous_id',"state IN ('active','tombstone')",
      'run.consent_id=consent_row.id','canonical_field_execution_actor_authority']) expect(migration).toContain(value);
  });
  test('withholds storage and helpers while granting only four entry functions', () => {
    const db = read('src/db.js');
    for (const value of ['REVOKE ALL PRIVILEGES ON TABLE public.canonical_external_project_change_order_import_consents',
      'REVOKE ALL ON FUNCTION public.canonical_external_project_change_order_record_projection',
      'GRANT EXECUTE ON FUNCTION public.canonical_external_project_change_order_import_batch',
      'external_project_change_order_import_helpers_withheld']) expect(db).toContain(value);
  });
  test('mounts owner/admin routes without adding a rendered surface', () => {
    const routes = read('src/routes/learning.js');
    for (const value of ["'/external-project-change-order-sources/:sourceKey/consent'",
      "'/external-project-change-order-sources/:sourceKey/batches'", "'/external-project-change-order-sources/:sourceKey'",
      'projectChangeOrderImportContract.normalizeBatch']) expect(routes).toContain(value);
    for (const rendered of ['public/js/learning-center-page.js','public/dashboard/learning-center.html','public/css/learning-center.css']) {
      expect(read(rendered)).not.toContain('external-project-change-order-sources');
    }
  });
  test('does not mutate operations or implement later Part 12 slices', () => {
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:customers|opportunities|appointments|canonical_estimates|invoices|payments|canonical_field_executions)\b/);
    for (const forbidden of ['access_token','refresh_token','provider_account','communication_intent','satisfaction_label','revenue_observation','margin_observation']) {
      expect(migration).not.toContain(forbidden);
    }
  });
});
