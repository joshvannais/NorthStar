'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('Mission 25 Part 7 Owner Learning Center', () => {
  test('uses a bounded tenant-private database read authority', () => {
    const migration = read('migrations/088_canonical_learning_center.sql');
    expect(migration).toContain('canonical_learning_center_read');
    expect(migration).toContain("role_value NOT IN ('owner','admin')");
    expect(migration).toContain('LIMIT 100');
    expect(migration).toContain('JOIN selected ON selected.source_key=observation.source_key');
    expect(migration).toContain('JOIN selected ON selected.source_key=proposal.source_key');
    expect(migration).toContain('ordinal<=50');
    expect(migration).toContain("'authority','tenant_private_postgresql'");
    expect(migration).toContain('Learning remains advisory');
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE) public\.(?:canonical_estimates|canonical_labor_plans|canonical_schedule_assignments|workforce_profiles)/);
  });

  test('mounts one owner and administrator interface in paid and isolated demo navigation', () => {
    const server = read('src/server.js'), permissions = read('src/auth/permissions.js');
    const routes = require('../../public/js/command-center-contract').ROUTES;
    const route = routes.find(value => value.id === 'learning-center');
    expect(route).toEqual(expect.objectContaining({ resource: 'learning', paidPath: '/dashboard/learning-center', demoPath: '/demo/learning-center' }));
    expect(server).toContain("'/dashboard/learning-center': 'public/dashboard/learning-center.html'");
    expect(server).toContain("'learning-center': 'public/dashboard/learning-center.html'");
    expect(permissions.match(/'learning': \['read', 'update'\]/g)).toHaveLength(2);
    expect(permissions.match(/'learning': \[\]/g)).toHaveLength(2);
  });

  test('renders source, consent, freshness, conflict and calibration review without freeform approval reasons', () => {
    const html = read('public/dashboard/learning-center.html'), page = read('public/js/learning-center-page.js');
    for (const phrase of ['Completed job comparisons', 'External labor sources', 'Source evidence', 'Reference review', 'Labor planning calibration']) expect(html).toContain(phrase);
    expect(page).toContain("confirmationVersion: 'm25-external-labor-reference-match-v1'");
    expect(page).toContain("confirmationVersion: 'm25-imported-labor-calibration-proposal-v1'");
    expect(page).toContain("currentAndFresh ? 'Proposal current'");
    expect(page).toContain('currentAndFresh;');
    expect(html).toContain('For the selected source');
    expect(html).toContain('For the selected service');
    expect(html).toContain('Owner decision remains required');
    expect(html + page).not.toMatch(/Human approval reason|Reason For This Update|<textarea/i);
  });

  test('keeps demo records explicit, isolated and read-only', () => {
    const page = read('public/js/learning-center-page.js');
    expect(page).toContain("authority: 'isolated_demo_postgresql'");
    expect(page).toContain('Demo records are isolated and illustrative.');
    expect(page).toContain("control.disabled = demo");
    expect(page).toContain('select.disabled = demo');
  });

  test('keeps the page responsive, keyboard reachable and advisory', () => {
    const html = read('public/dashboard/learning-center.html'), css = read('public/css/learning-center.css');
    expect(html).toContain('Skip to Learning Center');
    expect(html).toContain('aria-live="polite"');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media(max-width:560px)');
    expect(html).toContain('does not automatically change estimates, rates, schedules, payroll, worker profiles or business policy');
  });
});
