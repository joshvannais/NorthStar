'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('Mission 25 Part 11 Slice H material Learning Center', () => {
  test('adds bounded material authority to the tenant-private center', () => {
    const migration = read('migrations/112_canonical_learning_center_materials.sql');
    expect(migration).toContain('canonical_material_learning_consent_read');
    for (const table of ['canonical_external_material_import_records', 'canonical_external_material_reference_matches',
      'canonical_external_material_quantity_observations', 'canonical_external_material_cost_observations',
      'canonical_external_material_calibration_proposals']) expect(migration).toContain(table);
    expect(migration).toContain("'version','m25-learning-center-v4'");
    expect(migration).toContain('LIMIT 100');
    expect(migration).toContain('ordinal<=50');
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE) public\.(?:canonical_estimates|canonical_material_plans|canonical_material_movements)/);
  });

  test('mounts only accepted material permissions, reference and planning routes', () => {
    const page = read('public/js/learning-center-page.js');
    for (const fragment of ["'/native-material-outcome-consent'", "'/imported-material-quantity-consent'",
      "'/imported-material-cost-consent'", "'/imported-material-calibration-consent'",
      "'/imported-material-calibrations/'", "'m25-external-material-reference-match-v1'",
      "'m25-imported-material-calibration-proposal-v1'"]) expect(page).toContain(fragment);
    expect(page).not.toMatch(/access[ _-]?token|client[ _-]?secret|provider[ _-]?password|credential implementation/i);
  });

  test('shows every independent material planning measure and unavailable state', () => {
    const page = read('public/js/learning-center-page.js');
    expect(page).toContain("['totalUse', 'waste', 'unitCost', 'purchaseQuantity', 'purchaseCost']");
    expect(page).toContain("waste: { status: 'unavailable'");
    expect(page).toContain('Supplier identity and inventory balance do not establish current availability.');
    expect(page).toContain('Saving a suggestion does not apply it.');
  });

  test('requires explicit cleanup confirmation and makes holds visible', () => {
    const page = read('public/js/learning-center-page.js');
    expect(page).toContain("saveOperation('/hold'");
    expect(page).toContain('Legal and audit hold');
    expect(page).toContain('This step cannot be undone.');
    expect(page).toContain("confirmationBox.type = 'checkbox'");
    expect(page).toContain('holdActive || state.operations.deletionComplete || !confirmationBox.checked');
    expect(page).not.toContain('tombstoned.');
  });

  test('keeps demo records isolated, read-only, responsive and accessible', () => {
    const html = read('public/dashboard/learning-center.html');
    const page = read('public/js/learning-center-page.js');
    const css = read('public/css/learning-center.css');
    expect(page).toContain("sourceKind: 'material'");
    expect(page).toContain("sourceKey: 'materials.demo'");
    expect(page).toContain("authority: 'isolated_demo_postgresql'");
    expect(page).toContain("el('learningSourceKind').disabled = true");
    expect(html).toContain('Materials used');
    expect(html).toContain('Connections are managed outside this page.');
    expect(html).toContain('What Polaris has learned');
    expect(html).toContain('aria-live="polite"');
    expect(css).toContain('.learning-confirmation');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media(max-width:560px)');
    expect(html + page).not.toMatch(/Human approval reason|Reason For This Update|<textarea/i);
  });

  test('preserves opaque matching values without displaying internal identifiers', () => {
    const page = read('public/js/learning-center-page.js');
    const repository = read('src/learning/externalMaterialReconciliationRepository.js');
    expect(page).toContain('target.targetId || target.targetReference');
    expect(page).toContain('contract.safeLabel(target.displayLabel || target.label)');
    expect(repository).toContain('canonical_learning_reconciliation_target_labels_read');
    expect(repository).toContain('targetReference: target.targetId, displayLabel: target.displayLabel');
    expect(repository).toContain("value.materialTargets = safeTargets(value.materialTargets, 'targetReference')");
    expect(page).not.toContain("String(target.targetReference).slice");
  });
});
