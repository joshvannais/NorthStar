'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = value => fs.readFileSync(path.join(__dirname, '../..', value), 'utf8');

describe('Mission 25 Part 10 Slice B external vehicle and equipment imports', () => {
  const migration = read('migrations/097_canonical_external_asset_import_authority.sql');
  test('stages four evidence classes with opaque source provenance', () => {
    for (const value of ['utilization', 'operating_cost', 'maintenance', 'downtime', 'provider_evidence_digest',
      'external_asset_actual_normalized_v1', 'historical_backfill', 'continuous_update']) expect(migration).toContain(value);
  });
  test('preserves consent, correction, tombstone, replay and tenant boundaries', () => {
    for (const value of ['canonical_external_asset_import_consents', 'canonical_external_asset_import_runs',
      'canonical_external_asset_import_records', 'request_key_hash', 'previous_id', "state IN ('active','tombstone')",
      'canonical_field_execution_actor_authority']) expect(migration).toContain(value);
  });
  test('withholds protected storage and helper execution from the runtime role', () => {
    const db = read('src/db.js');
    expect(db).toContain("REVOKE ALL PRIVILEGES ON TABLE public.canonical_external_asset_import_consents");
    expect(db).toContain("REVOKE ALL ON FUNCTION public.canonical_external_asset_record_projection");
    expect(db).toContain("GRANT EXECUTE ON FUNCTION public.canonical_external_asset_import_batch");
    expect(db).toContain("relation.relname NOT LIKE 'canonical_external_asset_%'");
  });
  test('mounts owner-only provider-neutral routes without adding a rendered surface', () => {
    const routes = read('src/routes/learning.js');
    for (const value of ["'/external-asset-sources/:sourceKey/consent'", "'/external-asset-sources/:sourceKey/batches'",
      "'/external-asset-sources/:sourceKey'", 'assetImportContract.normalizeBatch']) expect(routes).toContain(value);
    expect(read('public/js/learning-center-page.js')).not.toContain('external-asset-sources');
  });
});
