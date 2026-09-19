'use strict';

const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');

describe('Mission 25 Part 11 Slice A native material outcomes', () => {
  const migration = read('migrations/105_canonical_native_material_outcomes.sql');

  test('pins exact adopted plan, selected completion and complete matching movement lineage', () => {
    for (const value of ['canonical_material_learning_consents', 'canonical_native_material_outcome_observations',
      'canonical_estimate_revision_components', 'canonical_material_plans', 'canonical_field_executions',
      'canonical_completion_records', 'canonical_material_movements', 'resulting_execution_digest']) {
      expect(migration).toContain(value);
    }
    expect(migration).toContain("purpose='native_material_quantity_variance_v1'");
    expect(migration).toContain("movement.review_state IN ('unreviewed','needs_review')");
    expect(migration).toContain('IF movement_count>500');
    expect(migration).toContain('plan_count<>binding_count');
  });

  test('compares only accepted consumption and waste in already matching units', () => {
    expect(migration).toContain("movement.movement_kind IN ('consumed','waste')");
    expect(migration).toContain("movement.unit_code IS DISTINCT FROM plan_line->>'unit'");
    expect(migration).toContain('Returns, transfers and adjustments do not establish use.');
    expect(migration).toContain('No estimate, price, job, inventory balance, purchase, vendor record or business policy was changed.');
    expect(migration).not.toContain('exchange rate');
  });

  test('withholds storage and basis helpers while mounting owner-only entry functions', () => {
    const db = read('src/db.js');
    const routes = read('src/routes/learning.js');
    for (const value of ['native_material_learning_tables_withheld', 'native_material_learning_entry_execute',
      'native_material_learning_helpers_withheld']) expect(db).toContain(value);
    expect(migration).toContain('REVOKE ALL ON TABLE public.canonical_material_learning_consents,public.canonical_native_material_outcome_observations FROM PUBLIC');
    expect(routes).toContain("'/native-material-outcome-consent'");
    expect(routes).toContain("'/estimates/:estimateId/executions/:executionId/native-material-outcomes'");
    expect(routes).toContain('nativeMaterialContract.normalizeObservation');
  });

  test('keeps later Part 11 authorities and rendered work outside Slice A', () => {
    const changedRuntime = [read('src/learning/nativeMaterialOutcomeContract.js'),
      read('src/learning/nativeMaterialOutcomeRepository.js'), read('src/routes/learning.js')].join('\n');
    for (const value of ['vendor cost import', 'purchasing calibration', 'inventory-location reconciliation']) {
      expect(changedRuntime).not.toContain(value);
    }
    expect(fs.existsSync(path.join(__dirname, '../../public/js/learning-materials.js'))).toBe(false);
  });
});
