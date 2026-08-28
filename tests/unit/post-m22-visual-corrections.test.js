'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const source = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('Post-Mission 22 employee and Command Center visual corrections', () => {
  test('keeps the Today header at the true top and removes duplicate count and accent painters', () => {
    const html = source('public/dashboard/today.html');
    const css = source('public/css/today.css');

    expect(html).not.toContain('id="todayWorkCount"');
    expect(html).toContain('Personal Work Only');
    expect(html).toContain('Read-only View');
    expect(css).toMatch(/\.today-header\s*\{\s*position:\s*static;/);
    expect(css).toMatch(/\.today-page\s*>\s*\.mobile-header\s*\{[\s\S]*position:\s*static\s*!important;/);
    expect(css).toMatch(/\.today-page\s+\.app-layout\s*\{\s*padding-top:\s*0\s*!important;/);
    expect(css).toMatch(/\.today-card-accent\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.today-disclosure\[open\][\s\S]*border-top:\s*0/);
    expect(css).toMatch(/summary:focus-visible\s*\{[\s\S]*outline:\s*0;[\s\S]*box-shadow:\s*inset/);
  });

  test('capitalizes projected Today labels and keeps one appointment count authority', () => {
    const page = source('public/js/today-page.js');

    expect(page).toContain("replace(/[_-]+/g, ' ')");
    expect(page).toContain("letter.toUpperCase()");
    expect(page).toContain("' · Personal Work Only'");
    expect(page).not.toContain("byId('todayWorkCount')");
    expect(page).toContain("byId('todayRefresh').hidden = !panel.hidden && action !== false");
    expect(page).toContain("byId('todayStatus').classList.toggle('sr-only', !panel.hidden)");
  });

  test('uses structured scheduling state rows and deduplicated attention indicators', () => {
    const html = source('public/demo-dashboard.html');
    const page = source('public/js/command-center-page.js');
    const css = source('public/css/scheduling-approval.css');

    expect(html).toContain('Owner and Dispatcher Overview');
    for (const label of ['Assignment', 'Schedule', 'Dispatch']) {
      expect(page).toContain(`schedulingStateItem('${label}'`);
    }
    expect(page).toContain('Array.from(new Set(attention))');
    expect(css).toContain('.m22-state-summary');
    expect(css).toContain('.m22-record-status');
  });

  test('groups repeated customer work without repeating unavailable timestamps', () => {
    const page = source('public/js/command-center-page.js');

    expect(page).toContain('groupByCustomer');
    expect(page).toContain('customerCell.rowSpan = group.records.length');
    expect(page).toContain('command-center-customer-record-count');
    expect(page).not.toContain('Recorded time unavailable');
  });

  test('reflows the mobile lead table into complete grouped customer cards', () => {
    const html = source('public/demo-dashboard.html');
    const css = source('public/css/demo-dashboard.css');
    const page = source('public/js/command-center-page.js');

    expect(html).toContain('id="commandCenterLeadCards"');
    expect(css).not.toMatch(/\.demo-table-wrap table\s*\{[^}]*760px/);
    expect(css).toMatch(/\.demo-leads-panel \.demo-table-wrap\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.command-center-mobile-leads\s*\{\s*display:\s*grid/);
    expect(page).toContain("element('article', 'command-center-mobile-customer')");
    for (const label of ['Recorded Value', 'Status', 'Next Action']) expect(page).toContain(`'${label}'`);
  });

  test('splits camel-case owner labels and supplies accessible dark operational colors', () => {
    const page = source('public/js/command-center-page.js');
    const today = source('public/css/today.css');
    const scheduling = source('public/css/scheduling-approval.css');

    expect(page).toContain("replace(/([a-z0-9])([A-Z])/g, '$1 $2')");
    expect(today).toMatch(/\[data-theme="dark"\] \.today-scope-note > span,[\s\S]*\.today-detail-label,[\s\S]*\.today-disclosure summary::after\s*\{\s*color:\s*var\(--brand-200\)/);
    expect(scheduling).toMatch(/\[data-theme="dark"\][\s\S]*\.m22-state-chip\[data-state="at_risk"\][\s\S]*color:\s*#fde68a/);
  });
});
