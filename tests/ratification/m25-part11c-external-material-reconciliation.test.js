'use strict';
const fs = require('node:fs'); const path = require('node:path'); const read = value => fs.readFileSync(path.join(__dirname, '../..', value), 'utf8');
describe('Mission 25 Part 11 Slice C reviewed material reconciliation', () => {
  const migration = read('migrations/107_canonical_external_material_reconciliation.sql');
  test('pins current permission-period source manifests and exact target manifests', () => {
    for (const value of ['canonical_external_material_reference_matches','run.consent_id=consent_row.id','source_manifest','target_manifest',
      "reference_kind IN ('job','material','vendor','inventory_location')",'canonical_material_movements','canonical_estimate_revisions',"supplier_quote"]) expect(migration).toContain(value);
  });
  test('uses current reviewed target authority and never fuzzy matches', () => {
    expect(migration).toContain("review_state='accepted'"); expect(migration).toContain('canonical_material_source_identity_text');
    expect(migration).not.toMatch(/ILIKE|levenshtein|similarity/);
  });
  test('keeps source-period match chains separate and hides delayed replay after revocation', () => {
    expect(migration).toContain('UNIQUE(organization_id,source_key,consent_id,reference_kind,external_reference,revision)');
    expect(migration).toContain("'status','unavailable'"); expect(migration).toContain('consent_row.id<>replay.consent_id');
  });
  test('withholds storage and basis helpers while granting only reviewed entry functions', () => {
    const db = read('src/db.js'); for (const value of ['REVOKE ALL PRIVILEGES ON TABLE public.canonical_external_material_reference_matches',
      'REVOKE ALL ON FUNCTION public.canonical_external_material_reference_source_basis','GRANT EXECUTE ON FUNCTION public.canonical_external_material_reference_matches_read',
      'external_material_match_helpers_withheld']) expect(db).toContain(value);
  });
  test('mounts owner-only API routes and introduces no rendered surface', () => {
    const routes = read('src/routes/learning.js'); expect(routes).toContain("'/external-material-sources/:sourceKey/matches'"); expect(routes).toContain('materialMatchContract.normalizeMatch');
    expect(read('public/js/learning-center-page.js')).not.toContain('materialMatchContract');
  });
});
