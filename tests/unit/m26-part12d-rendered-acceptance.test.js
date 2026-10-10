'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MISSION_26_FIVE_LAYOUTS } = require('../helpers/m26-part12d-rendered-review');

const read = relative => fs.readFileSync(path.resolve(relative), 'utf8');

test('Part 12D freezes the five-layout review matrix', () => {
  expect(MISSION_26_FIVE_LAYOUTS).toEqual([
    { name: 'phone-narrow-dark', width: 360, height: 800, colorScheme: 'dark' },
    { name: 'phone-standard-light', width: 390, height: 844, colorScheme: 'light' },
    { name: 'tablet-portrait-dark', width: 768, height: 1024, colorScheme: 'dark' },
    { name: 'tablet-landscape-light', width: 1024, height: 768, colorScheme: 'light' },
    { name: 'desktop-dark', width: 1440, height: 900, colorScheme: 'dark' },
  ]);
});

test.each([
  ['Command Center', 'public/demo-dashboard.html', '#commandCenterMain'],
  ['Settings', 'public/dashboard/settings.html', '#mainContent'],
  ['Executive Brief', 'public/dashboard/executive-brief.html', '#mainContent'],
])('%s exposes a keyboard-focusable skip target', (_name, file, selector) => {
  const source = read(file);
  const id = selector.slice(1);
  expect(source).toMatch(new RegExp(`class="skip-link"[^>]+href="#${id}"`));
  expect(source).toMatch(new RegExp(`<main[^>]+id="${id}"[^>]+tabindex="-1"`));
});

test('Executive Brief exposes semantic regions and clears stale values on failure', () => {
  const source = read('public/dashboard/executive-brief.html');
  expect(source.match(/<section class="eb-card/g)).toHaveLength(7);
  expect(source.match(/<h2 class="eb-card-title"/g)).toHaveLength(7);
  expect(source).toMatch(/id="ebLoading" role="status" aria-live="polite" aria-atomic="true"/);
  expect(source).toMatch(/id="executiveBrief" aria-busy="true"/);
  expect(source).toMatch(/function showUnavailable\(\)/);
  expect(source).toMatch(/availability\.dataset\.state = 'unavailable'/);
  expect(source).toMatch(/availability\.textContent = 'Unavailable'/);
  for (const id of ['ebSummary', 'ebPriority', 'ebRevenue', 'ebOperational',
    'ebCustomers', 'ebInsight', 'ebNextAction']) {
    expect(source).toContain(`getElementById('${id}')`);
  }
  expect(source).not.toMatch(/catch\(function\(err\)[\s\S]{0,300}err\.message/);
  expect(source).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  expect(source).toMatch(/@media \(forced-colors: active\)/);
});
