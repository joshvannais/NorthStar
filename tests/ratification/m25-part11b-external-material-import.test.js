'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = value => fs.readFileSync(path.join(__dirname, '../..', value), 'utf8');

describe('Mission 25 Part 11 Slice B external material imports', () => {
  const migration = read('migrations/106_canonical_external_material_import_authority.sql');
  test('stages four exact evidence classes with opaque provenance', () => {
    for (const value of ['inventory_balance','inventory_movement','purchase','vendor_cost','provider_evidence_digest',
      'external_material_actual_normalized_v1','historical_backfill','continuous_update']) expect(migration).toContain(value);
  });
  test('preserves source-specific consent, corrections, tombstones and current consent-period masking', () => {
    for (const value of ['canonical_external_material_import_consents','canonical_external_material_import_runs',
      'canonical_external_material_import_records','request_key_hash','previous_id',"state IN ('active','tombstone')",
      'run.consent_id=consent_row.id','canonical_field_execution_actor_authority']) expect(migration).toContain(value);
  });
  test('withholds storage and helpers while granting only bounded entry functions', () => {
    const db = read('src/db.js');
    for (const value of ['REVOKE ALL PRIVILEGES ON TABLE public.canonical_external_material_import_consents',
      'REVOKE ALL ON FUNCTION public.canonical_external_material_record_projection',
      'GRANT EXECUTE ON FUNCTION public.canonical_external_material_import_batch',
      "relation.relname NOT LIKE 'canonical_external_material_%'", 'external_material_import_helpers_withheld']) expect(db).toContain(value);
  });
  test('mounts owner-only routes and adds no rendered surface', () => {
    const routes = read('src/routes/learning.js');
    for (const value of ["'/external-material-sources/:sourceKey/consent'", "'/external-material-sources/:sourceKey/batches'",
      "'/external-material-sources/:sourceKey'", 'materialImportContract.normalizeBatch']) expect(routes).toContain(value);
    expect(read('public/js/learning-center-page.js')).not.toContain('external-material-sources');
  });
});
