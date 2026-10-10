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
  expect(source).toMatch(new RegExp(`class="skip-link"[^>]+href="#${id}"[^>]+tabindex="0"`));
  expect(source).toMatch(new RegExp(`<main[^>]+id="${id}"[^>]+tabindex="-1"`));
});

test('browser proof reaches skip navigation through Tab in normal and forced colors', () => {
  const source = read('tests/helpers/m26-part12d-rendered-review.js');
  expect(source).toMatch(/page\.keyboard\.press\('Tab'\)/);
  expect(source).not.toMatch(/skip\.focus\(\)/);
  expect(source).toMatch(/document\.body\.focus\(\{ preventScroll: true \}\)/);
  expect(source).toMatch(/neutral document body focus/);
  expect(source).toMatch(/skip link must be the first genuine keyboard Tab target/);
  expect(source).toMatch(/tabToSkip\('active'\)/);
  expect(source).toMatch(/matchMedia\('\(forced-colors: active\)'\)\.matches/);
  expect(source).toMatch(/tabToSkip\('active'\)[\s\S]*page\.keyboard\.press\('Enter'\)[\s\S]*page\.waitForFunction\(selector => document\.activeElement === document\.querySelector\(selector\), mainSelector\)[\s\S]*page\.emulateMedia\(\{ forcedColors: 'none'/);
});

test('shared navigation preserves the skip link as the first generated-control Tab target', () => {
  const source = read('public/js/nav-component.js');
  expect(source).toMatch(/var skipLink = document\.querySelector\('\.skip-link'\)/);
  expect(source).toMatch(/skipLink\.insertAdjacentHTML\('afterend', buildMobileNav\(items, mode\)\)/);
  expect(source).not.toMatch(/document\.body\.insertAdjacentHTML\('afterbegin', buildMobileNav\(items, mode\)\);\s*if \(!installSidebar/);
});

test.each([
  'tests/browser/m26-part12a-paid-journey.js',
  'tests/browser/m26-part12b-demo-journey.js',
])('%s binds required branches to a retained layout and records execution', file => {
  const source = read(file);
  expect(source).not.toContain("viewport.name === 'desktop-light'");
  expect(source).toContain("viewport.name === 'phone-standard-light'");
  expect(source).toMatch(/exercisedRequiredBranches\.push\(/);
  expect(source).toMatch(/assert\.deepEqual\(exercisedRequiredBranches/);
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
