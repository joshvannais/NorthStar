'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('Mission 25 Part 8 usable import operations', () => {
  const migration = read('migrations/089_canonical_external_labor_import_operations.sql');

  test('records lifecycle, retention, deletion and bounded cleanup authority', () => {
    for (const fragment of ['canonical_external_labor_adapter_revisions', 'canonical_external_labor_retention_revisions',
      'canonical_external_labor_deletion_revisions', 'canonical_external_labor_cleanup_runs',
      'canonical_external_labor_operations_read', 'canonical_external_labor_cleanup_execute',
      "operation IN ('retention','deletion')", 'LIMIT (body->>\'limit\')::integer+1']) expect(migration).toContain(fragment);
    expect(migration).toContain("Source deletion requested; new imports and derived reads are blocked.");
    expect(migration).toContain("state','tombstone'");
  });

  test('keeps runtime access entry-only and blocks imports after deletion', () => {
    const authority = read('src/learning/importDatabaseAuthority.js');
    expect(authority).toContain('canonical_external_labor_import_deletion_guard');
    expect(authority).toContain('canonical_external_labor_cleanup_execute');
    expect(authority).toContain('operations_withheld');
    expect(migration).toContain('CREATE TRIGGER canonical_external_labor_import_deletion_guard');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.canonical_external_labor_operation_mutate');
  });

  test('provides an owner-facing source setup, CSV import and operation workflow', () => {
    const html = read('public/dashboard/learning-center.html');
    const page = read('public/js/learning-center-page.js');
    const routes = read('src/routes/learning.js');
    for (const fragment of ['Add a company source', 'Import and source operations', 'learningOperations']) expect(html).toContain(fragment);
    for (const fragment of ['CSV history', 'Continuous sync', 'Save retention', 'Request deletion', 'Process next 100']) expect(page).toContain(fragment);
    for (const fragment of ['/csv-backfill', '/operations', '/adapter', '/retention', '/deletion', '/cleanup']) expect(routes).toContain(fragment);
    expect(page).not.toMatch(/human approval reason/i);
  });

  test('documents checkpoint, correction and operational boundaries without claiming a provider connector', () => {
    const roadmap = read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md');
    const operations = read('docs/operations/MISSION_25_IMPORT_OPERATIONS.md');
    expect(roadmap).toContain('## Eighth bounded package — usable import operations');
    for (const fragment of ['provider-neutral lifecycle', 'No provider credential', 'bounded cleanup', 'does not apply']) expect(operations).toContain(fragment);
  });
});
