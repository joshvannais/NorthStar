'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = value => fs.readFileSync(path.join(__dirname, '../..', value), 'utf8');

describe('Mission 25 Part 10 Slice C external asset reconciliation', () => {
  const migration = read('migrations/098_canonical_external_asset_reconciliation.sql');
  test('pins typed source manifests, current consent and same-tenant targets', () => {
    for (const value of ["reference_kind IN ('job','vehicle','equipment')", 'source_manifest', 'consent_revision',
      'canonical_external_asset_reference_source_basis', 'canonical_external_asset_reference_target_basis',
      "a.category=kind_value", "v.review_state='reviewed'", 'operationRevision']) expect(migration).toContain(value);
  });
  test('appends immutable link and unlink revisions without guessing', () => {
    for (const value of ["action IN ('link','unlink')", 'previous_id', 'canonical_external_asset_reference_matches_immutable',
      'asset_category=kind_value', 'expectedSourceDigest', 'expectedTargetDigest']) expect(migration).toContain(value);
    expect(migration).not.toMatch(/similarity|levenshtein|fuzzy/i);
  });
  test('withholds protected storage and helpers from the runtime role', () => {
    const db = read('src/db.js');
    expect(db).toContain('REVOKE ALL PRIVILEGES ON TABLE public.canonical_external_asset_reference_matches');
    expect(db).toContain('REVOKE ALL ON FUNCTION public.canonical_external_asset_reference_target_basis');
    expect(db).toContain('GRANT EXECUTE ON FUNCTION public.canonical_external_asset_reference_match_mutate');
    expect(db).toContain("'098_canonical_external_asset_reconciliation.sql'");
  });
  test('mounts owner-only guarded routes and adds no rendered surface', () => {
    const routes = read('src/routes/learning.js');
    expect(routes).toContain("'/external-asset-sources/:sourceKey/matches'");
    expect(routes).toContain('assetMatchContract.normalizeMatch');
    expect(read('public/js/learning-center-page.js')).not.toContain('external-asset-sources');
  });
  test('documents the lineage-only and Slice D boundary', () => {
    const operations = read('docs/operations/M25_PART10_EXTERNAL_ASSET_RECONCILIATION.md');
    expect(operations).toContain('Reconciliation is lineage only.');
    expect(operations).toContain('Slice D observations remain unimplemented.');
  });
});
