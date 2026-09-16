'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const migration = read('migrations/087_canonical_imported_labor_calibration.sql');

describe('Mission 25 Part 6 imported labor calibration', () => {
  test('retains consent, proposal, sample and source lineage immutably', () => {
    for (const value of ['canonical_external_labor_calibration_consents',
      'canonical_external_labor_calibration_proposals', 'sample_manifest JSONB NOT NULL',
      'sample_digest CHAR(64) NOT NULL', 'canonical_external_labor_calibration_proposals_immutable',
      'outcome_consent_digest', 'request_key_hash', 'canonical_digest']) expect(migration).toContain(value);
  });
  test('requires five current outcomes and uses deterministic robust statistics', () => {
    for (const value of ["fresh_total<5", 'percentile_cont(0.5)', 'percentile_cont(0.25)',
      'percentile_cont(0.75)', 'm25-imported-labor-median-calibration-v1']) expect(migration).toContain(value);
  });
  test('keeps calibration advisory and runtime authority narrow', () => {
    const authority = read('src/learning/importDatabaseAuthority.js');
    const operations = read('docs/operations/MISSION_25_IMPORTED_LABOR_CALIBRATION.md');
    expect(authority).toContain('calibration_withheld');
    expect(authority).toContain('calibration_helpers_withheld');
    expect(operations).toContain('does not change an estimate, labor plan, rate, schedule, payroll record, worker profile or business policy');
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE) public\.(?:canonical_estimates|canonical_labor_plans|canonical_schedule_assignments|workforce_profiles)/);
  });
  test('documents source correction, revocation and owner-interface boundaries', () => {
    expect(read('docs/roadmap/MISSION_25_OUTCOME_LEARNING.md')).toContain('Sixth bounded package');
    expect(read('docs/architecture/MISSION_25_LEARNING_SOURCE_INVENTORY.md')).toContain('multi-job imported labor calibration');
  });
});

