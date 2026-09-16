'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('Mission 25 Part 9F travel Learning Center', () => {
  test('adds a bounded tenant-private labor and travel inventory without merging source identities', () => {
    const migration = read('migrations/095_canonical_learning_center_travel.sql');
    expect(migration).toContain("'labor'::text source_kind");
    expect(migration).toContain("UNION SELECT 'travel'");
    expect(migration).toContain('canonical_external_travel_outcome_observations');
    expect(migration).toContain('canonical_external_travel_calibration_proposals');
    expect(migration).toContain("'sourceKind',selected.source_kind");
    expect(migration).toContain("'version','m25-learning-center-v2'");
    expect(migration).toContain('LIMIT 100');
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE) public\.(?:canonical_estimates|canonical_travel_plans|canonical_schedule_assignments|tenant_assets)/);
  });

  test('routes each selected source through the matching guarded paid API', () => {
    const html = read('public/dashboard/learning-center.html');
    const page = read('public/js/learning-center-page.js');
    expect(html).toContain('Travel, mileage and fuel');
    expect(page).toContain("return '/external-' + kind + '-sources/'");
    expect(page).toContain("'/imported-travel-variance-consent'");
    expect(page).toContain("'/imported-travel-calibration-consent'");
    expect(page).toContain("'/imported-travel-calibrations/'");
    expect(page).toContain("'m25-external-travel-reference-match-v1'");
    expect(page).toContain("'m25-imported-travel-calibration-proposal-v1'");
    expect(page).not.toMatch(/access[_-]?token|client[_-]?secret|provider[_-]?password/i);
  });

  test('keeps the isolated demo explicit, read-only and dimension specific', () => {
    const page = read('public/js/learning-center-page.js');
    expect(page).toContain("sourceKind: 'travel'");
    expect(page).toContain("sourceKey: 'fleet.demo'");
    expect(page).toContain("authority: 'isolated_demo_postgresql'");
    expect(page).toContain("['routeDuration', 'distance', 'fuelQuantity', 'fuelCost']");
    expect(page).toContain("el('learningSourceKind').disabled = true");
    expect(page).toContain("action.disabled = demo");
  });

  test('includes keyboard, status, table and narrow-layout accessibility', () => {
    const html = read('public/dashboard/learning-center.html');
    const page = read('public/js/learning-center-page.js');
    const css = read('public/css/learning-center.css');
    expect(html).toContain('Skip to Learning Center');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Source category"');
    expect(page).toContain("th.scope = 'col'");
    expect(page).toContain("node('caption', 'learning-visually-hidden'");
    expect(page).toContain("setAttribute('aria-busy', 'true')");
    expect(page).toContain("scrollRestoration = 'manual'");
    expect(css).toContain('.learning-visually-hidden');
    expect(css).toContain('@media(max-width:560px)');
    expect(css).toContain('.learning-travel-calibration-grid');
  });
});
