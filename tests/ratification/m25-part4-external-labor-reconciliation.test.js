'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const migration = read('migrations/085_canonical_external_labor_reconciliation.sql');

describe('Mission 25 Part 4 reviewed external labor reconciliation', () => {
  test('keeps immutable tenant, actor, request, source and target lineage', () => {
    for (const fragment of ['CREATE TABLE public.canonical_external_labor_import_reference_matches',
      'canonical_external_labor_import_reference_matches_immutable', 'source_manifest JSONB NOT NULL',
      'source_digest TEXT NOT NULL', 'target_digest TEXT NOT NULL',
      'FOREIGN KEY(organization_id,actor_user_id,auth_session_id)', 'request_key_hash', 'request_digest']) expect(migration).toContain(fragment);
  });
  test('requires exact current source and target bases plus explicit confirmation', () => {
    for (const fragment of ['canonical_external_labor_reference_source_basis', 'canonical_external_labor_reference_target_basis',
      "body->'confirmed' IS DISTINCT FROM 'true'::jsonb", 'm25-external-labor-reference-match-v1',
      'learning_match_source_changed', 'learning_match_target_changed']) expect(migration).toContain(fragment);
  });
  test('keeps matching advisory and withholds tables and helper functions', () => {
    const authority = read('src/learning/importDatabaseAuthority.js');
    const operations = read('docs/operations/MISSION_25_EXTERNAL_LABOR_RECONCILIATION.md');
    expect(authority).toContain('matches_withheld'); expect(authority).toContain('helpers_withheld');
    expect(operations).toContain('does not create or alter a worker, job, labor interval, estimate, payroll record, schedule or policy');
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE) public\.(?:canonical_labor_intervals|canonical_estimates|canonical_schedule_assignments|workforce_profiles)/);
  });
  test('documents stale, revocation, UI and downstream observation boundaries', () => {
    const roadmap = read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md');
    const inventory = read('docs/architecture/MISSION_25_LEARNING_SOURCE_INVENTORY.md');
    for (const phrase of ['source correction or tombstone makes a saved link stale', 'No imported record supports an outcome observation yet',
      'No rendered owner interface is included']) expect(roadmap).toContain(phrase);
    expect(inventory).toContain('reviewed worker and job reference reconciliation');
  });
});
