'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const migration = read('migrations/086_canonical_imported_labor_outcomes.sql');

describe('Mission 25 Part 5 imported labor outcomes', () => {
  test('retains immutable consent, observation and source lineage', () => {
    for (const value of ['canonical_external_labor_import_learning_consents',
      'canonical_external_labor_import_outcome_observations', 'source_manifest JSONB NOT NULL',
      'source_digest CHAR(64) NOT NULL', 'canonical_external_labor_import_outcomes_immutable',
      'FOREIGN KEY(organization_id,actor_user_id,auth_session_id)', 'request_key_hash', 'request_digest']) {
      expect(migration).toContain(value);
    }
  });
  test('requires an adopted plan and current reviewed job and worker matches', () => {
    for (const value of ['canonical_imported_labor_learning_basis', 'Adopted labor plan is required',
      'Current reviewed job match is required', 'Current reviewed worker matches are required',
      'Imported labor intervals overlap']) expect(migration).toContain(value);
  });
  test('keeps output advisory and runtime authority narrow', () => {
    const authority = read('src/learning/importDatabaseAuthority.js');
    const operations = read('docs/operations/MISSION_25_IMPORTED_LABOR_OUTCOMES.md');
    expect(authority).toContain('imported_outcomes_withheld');
    expect(authority).toContain('imported_outcome_helpers_withheld');
    expect(operations).toContain('does not change an estimate, rate, schedule, payroll record, worker profile or business policy');
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE) public\.(?:canonical_estimates|canonical_labor_plans|canonical_schedule_assignments|workforce_profiles)/);
  });
  test('documents correction, revocation and owner-interface boundaries', () => {
    const roadmap = read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md');
    const inventory = read('docs/architecture/MISSION_25_LEARNING_SOURCE_INVENTORY.md');
    expect(roadmap).toContain('Fifth bounded package');
    expect(roadmap).toContain('No rendered owner interface is included');
    expect(inventory).toContain('imported labor-duration outcome');
  });
});
