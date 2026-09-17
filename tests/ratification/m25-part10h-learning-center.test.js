'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('Mission 25 Part 10 Slice H vehicle and equipment Learning Center', () => {
  test('extends the bounded tenant-private inventory without merging source categories', () => {
    const migration = read('migrations/103_canonical_learning_center_assets.sql');
    expect(migration).toContain("UNION SELECT 'asset',source_key");
    expect(migration).toContain('canonical_external_asset_import_records');
    expect(migration).toContain('canonical_external_asset_health_observations');
    expect(migration).toContain('canonical_external_asset_calibration_proposals');
    expect(migration).toContain('canonical_equipment_learning_consent_read');
    expect(migration).toContain("'version','m25-learning-center-v3'");
    expect(migration).toContain('LIMIT 100');
    expect(migration).toContain('ordinal<=50');
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE) public\.(?:canonical_estimates|canonical_equipment_plans|canonical_schedule_assignments|tenant_assets)/);
  });

  test('routes vehicle and equipment review through guarded accepted authorities', () => {
    const page = read('public/js/learning-center-page.js');
    for (const fragment of ["'/imported-utilization-cost-consent'", "'/imported-asset-health-consent'",
      "'/imported-asset-calibration-consent'", "'/imported-asset-health-outcomes'",
      "'/imported-asset-calibrations/'", "'m25-external-asset-reference-match-v1'",
      "'m25-imported-asset-calibration-proposal-v1'"]) expect(page).toContain(fragment);
    expect(page).not.toMatch(/access[_-]?token|client[_-]?secret|provider[_-]?password/i);
  });

  test('keeps the isolated demo explicit, read-only and dimension specific', () => {
    const page = read('public/js/learning-center-page.js');
    expect(page).toContain("sourceKind: 'asset'");
    expect(page).toContain("sourceKey: 'equipment.demo'");
    expect(page).toContain("authority: 'isolated_demo_postgresql'");
    expect(page).toContain("['utilization', 'operatingCost']");
    expect(page).toContain("condition: { status: 'unavailable'");
    expect(page).toContain("availability: { status: 'unavailable'");
    expect(page).toContain("el('learningSourceKind').disabled = true");
    expect(page).toContain('action.disabled = demo');
  });

  test('surfaces deletion recovery and preserves non-revival language', () => {
    const page = read('public/js/learning-center-page.js');
    const docs = read('docs/operations/M25_PART10_LEARNING_CENTER.md');
    expect(page).toContain("deletion.action === 'request'");
    expect(page).toContain("'Cancel deletion first'");
    expect(page).toContain('Cancel the active deletion request before starting a new source consent period.');
    expect(docs).toContain('do not revive deleted source detail or earlier learning authority');
  });

  test('retains keyboard, status, table, theme and narrow-layout accessibility', () => {
    const html = read('public/dashboard/learning-center.html');
    const page = read('public/js/learning-center-page.js');
    const css = read('public/css/learning-center.css');
    expect(html).toContain('Skip to Learning Center');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Vehicle and equipment time');
    expect(html).toContain('Asset health review');
    expect(page).toContain("setAttribute('aria-busy', 'true')");
    expect(page).toContain("scrollRestoration = 'manual'");
    expect(page).toContain('generation !== state.selectionGeneration');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media(max-width:560px)');
    expect(css).toContain('.learning-native-grid');
    expect(html + page).not.toMatch(/Human approval reason|Reason For This Update|<textarea/i);
  });
});
