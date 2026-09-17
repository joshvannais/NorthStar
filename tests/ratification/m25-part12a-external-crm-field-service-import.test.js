'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = value => fs.readFileSync(path.join(__dirname, '../..', value), 'utf8');

describe('Mission 25 Part 12 Slice A CRM and field-service imports', () => {
  const migration = read('migrations/113_canonical_external_crm_field_service_import_authority.sql');
  test('stages exact provider-neutral record classes with explicit unknown and unmatched states', () => {
    for (const value of ['customer','lead','job','appointment','issued_estimate','record_state',
      "'reconciliationStatus',CASE WHEN v.state='active' THEN 'unmatched'",'historical_backfill','continuous_update']) expect(migration).toContain(value);
  });
  test('preserves source-specific consent, versioned corrections, tombstones and current-period masking', () => {
    for (const value of ['canonical_external_crm_field_service_import_consents','canonical_external_crm_field_service_import_runs',
      'canonical_external_crm_field_service_import_records','request_key_hash','previous_id',"state IN ('active','tombstone')",
      'run.consent_id=consent_row.id','canonical_field_execution_actor_authority']) expect(migration).toContain(value);
  });
  test('validates distinct time zones once per page and keeps a 100-record public bound', () => {
    expect(migration).toContain("SELECT DISTINCT item_value->>'timeZone' AS name");
    expect(migration).toContain('LEFT JOIN pg_catalog.pg_timezone_names known_zone');
    expect(migration).toContain('jsonb_array_length(body->\'records\') NOT BETWEEN 1 AND 100');
    expect(migration).not.toContain('NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names');
  });
  test('withholds storage and helpers while granting only four entry functions', () => {
    const db = read('src/db.js');
    for (const value of ['REVOKE ALL PRIVILEGES ON TABLE public.canonical_external_crm_field_service_import_consents',
      'REVOKE ALL ON FUNCTION public.canonical_external_crm_field_service_record_projection',
      'GRANT EXECUTE ON FUNCTION public.canonical_external_crm_field_service_import_batch',
      'external_crm_field_service_import_helpers_withheld']) expect(db).toContain(value);
  });
  test('mounts owner/admin-only routes without adding a rendered surface', () => {
    const routes = read('src/routes/learning.js');
    for (const value of ["'/external-crm-field-service-sources/:sourceKey/consent'", "'/external-crm-field-service-sources/:sourceKey/batches'",
      "'/external-crm-field-service-sources/:sourceKey'", 'crmFieldServiceImportContract.normalizeBatch']) expect(routes).toContain(value);
    expect(read('public/js/learning-center-page.js')).not.toContain('external-crm-field-service-sources');
  });
  test('does not stage provider credentials, finance fields, or operational mutation SQL', () => {
    for (const forbidden of ['provider_account','access_token','refresh_token','invoice_reference','payment_reference','amount','currency']) expect(migration).not.toContain(forbidden);
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:customers|opportunities|appointments|canonical_estimates|invoices|payments)\b/);
  });
});
