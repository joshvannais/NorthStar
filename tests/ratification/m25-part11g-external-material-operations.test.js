'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('Mission 25 Part 11 Slice G material source operations', () => {
  const migration = read('migrations/111_canonical_external_material_import_operations.sql');

  test('records immutable lifecycle, retention, deletion and bounded cleanup authority', () => {
    for (const fragment of ['canonical_external_material_adapter_revisions', 'canonical_external_material_retention_revisions',
      'canonical_external_material_deletion_revisions', 'canonical_external_material_hold_revisions', 'canonical_external_material_cleanup_runs',
      'canonical_external_material_lifecycle_gates', 'canonical_external_material_lifecycle_lock',
      'canonical_external_material_operations_read', 'canonical_external_material_cleanup_execute',
      "operation IN ('retention','deletion')", "LIMIT (body->>'limit')::integer+1",
      "'recordType',NULL", "'materialReference',NULL", "'normalizedEvidence',NULL"]) expect(migration).toContain(fragment);
    expect(migration).toContain('Source deletion requested; new imports and derived reads are blocked.');
  });

  test('keeps runtime access entry-only and blocks imports after deletion', () => {
    const db = read('src/db.js');
    expect(db).toContain('canonical_external_material_import_deletion_guard');
    expect(db).toContain('canonical_external_material_consent_deletion_guard');
    expect(db).toContain('canonical_external_material_cleanup_execute');
    expect(db).toContain('REVOKE ALL PRIVILEGES ON TABLE public.canonical_external_material_adapter_revisions');
    expect(migration).toContain('CREATE TRIGGER canonical_external_material_import_deletion_guard');
    expect(migration).toContain('CREATE TRIGGER canonical_external_material_consent_deletion_guard');
    expect(migration).toContain('external_material_deletion_blocks_consent_grant');
    expect(migration.match(/PERFORM public\.canonical_external_material_lifecycle_lock\(org,source_value\)/g)).toHaveLength(3);
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.canonical_external_material_operation_mutate');
  });

  test('mounts guarded owner and administrator routes without a rendered surface', () => {
    const routes = read('src/routes/learning.js');
    for (const fragment of ['/external-material-sources/:sourceKey/operations', '/external-material-sources/:sourceKey/adapter',
      '/external-material-sources/:sourceKey/retention', '/external-material-sources/:sourceKey/deletion', '/external-material-sources/:sourceKey/hold',
      '/external-material-sources/:sourceKey/cleanup']) expect(routes).toContain(fragment);
    expect(routes).toContain("permission('operations', 'update')");
  });

  test('documents checkpoints, no credentials, no revival and no operational mutation', () => {
    const roadmap = read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md');
    const operations = read('docs/operations/M25_PART11_EXTERNAL_MATERIAL_OPERATIONS.md');
    expect(roadmap).toContain('## Part 11 Slice G candidate — material source lifecycle and bounded cleanup');
    for (const fragment of ['stores no provider credential', 'one to 100', 'tenant-and-source lifecycle order', 'cannot revive tombstoned evidence',
      'never create a provider connection or change an estimate']) expect(operations).toContain(fragment);
  });
});
