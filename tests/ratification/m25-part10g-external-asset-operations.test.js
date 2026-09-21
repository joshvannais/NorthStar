'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('Mission 25 Part 10 Slice G vehicle and equipment source operations', () => {
  const migration = read('migrations/102_canonical_external_asset_import_operations.sql');

  test('records immutable lifecycle, retention, deletion and bounded cleanup authority', () => {
    for (const fragment of ['canonical_external_asset_adapter_revisions', 'canonical_external_asset_retention_revisions',
      'canonical_external_asset_deletion_revisions', 'canonical_external_asset_cleanup_runs',
      'canonical_external_asset_operations_read', 'canonical_external_asset_cleanup_execute',
      "operation IN ('retention','deletion')", "LIMIT (body->>'limit')::integer+1",
      "'recordType',NULL", "'assetReference',NULL", "'normalizedEvidence',NULL"]) expect(migration).toContain(fragment);
    expect(migration).toContain('Source deletion requested; new imports and derived reads are blocked.');
  });

  test('keeps runtime access entry-only and blocks imports after deletion', () => {
    const db = read('src/db.js');
    expect(db).toContain('canonical_external_asset_import_deletion_guard');
    expect(db).toContain('canonical_external_asset_consent_deletion_guard');
    expect(db).toContain('canonical_external_asset_cleanup_execute');
    expect(db).toContain('REVOKE ALL PRIVILEGES ON TABLE public.canonical_external_asset_adapter_revisions');
    expect(migration).toContain('CREATE TRIGGER canonical_external_asset_import_deletion_guard');
    expect(migration).toContain('CREATE TRIGGER canonical_external_asset_consent_deletion_guard');
    expect(migration).toContain('external_asset_deletion_blocks_consent_grant');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.canonical_external_asset_operation_mutate');
  });

  test('mounts guarded owner and administrator routes without a rendered surface', () => {
    const routes = read('src/routes/learning.js');
    for (const fragment of ['/external-asset-sources/:sourceKey/operations', '/external-asset-sources/:sourceKey/adapter',
      '/external-asset-sources/:sourceKey/retention', '/external-asset-sources/:sourceKey/deletion',
      '/external-asset-sources/:sourceKey/cleanup']) expect(routes).toContain(fragment);
    expect(routes).toContain("permission('operations', 'update')");
  });

  test('documents checkpoints, no credentials, no revival and no operational mutation', () => {
    const roadmap = read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md');
    const operations = read('docs/operations/M25_PART10_EXTERNAL_ASSET_OPERATIONS.md');
    expect(roadmap).toContain('## Part 10 Slice G candidate — source lifecycle and bounded cleanup');
    for (const fragment of ['no field for credentials', 'at most 100', 'does not restore deleted details',
      'never change an estimate']) expect(operations).toContain(fragment);
  });
});
