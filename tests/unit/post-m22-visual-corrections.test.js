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
    expect(css).toMatch(/\.today-header \.demo-dashboard-brand\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.today-header #todayAuthority[\s\S]*white-space:\s*nowrap;[\s\S]*text-overflow:\s*ellipsis;/);
    expect(css).toMatch(/\.today-page \.app-layout > \.sidebar[\s\S]*position:\s*static;[\s\S]*min-height:\s*100vh;/);
    expect(css).toMatch(/\.today-disclosure\[open\][\s\S]*border-top:\s*0/);
    expect(css).toMatch(/summary:focus-visible\s*\{[\s\S]*outline:\s*0;[\s\S]*box-shadow:\s*inset/);
  });

  test('uses a single NorthStar lockup in the desktop Command Center shell', () => {
    const shared = source('public/css/site-professionalism.css');

    expect(shared).toMatch(/@media \(min-width:\s*769px\)[\s\S]*\.command-center-blueprint-header \.demo-dashboard-brand\s*\{\s*display:\s*none\s*!important;/);
    expect(shared).toMatch(/\.command-center-blueprint-header \.demo-dashboard-header-actions\s*\{[\s\S]*justify-content:\s*flex-end;/);
  });

  test('capitalizes projected Today labels and keeps one appointment count authority', () => {
    const page = source('public/js/today-page.js');

    expect(page).toContain("replace(/[_-]+/g, ' ')");
    expect(page).toContain("letter.toUpperCase()");
    expect(page).toContain("' · Personal Work Only'");
    expect(page).not.toContain("byId('todayWorkCount')");
    expect(page).toContain("byId('todayRefresh').hidden = !panel.hidden && action !== false");
    expect(page).toContain("byId('todayStatus').classList.toggle('sr-only', !panel.hidden)");
    expect(page).toContain("'Owner Operator · Personal Work Only'");
  });

  test('keeps hostile authority bytes out of the Today and Command Center display projections', () => {
    const today = source('public/js/today-page.js');
    const command = source('public/js/command-center-page.js');

    for (const placeholder of ['Job title unavailable', 'Employee name unavailable', 'Customer name unavailable', 'Service location unavailable']) {
      expect(today).toContain(placeholder);
    }
    expect(today).toContain('function markupLike(value)');
    expect(today).toContain('function presentationText(value, fallback)');
    expect(command).toContain('function markupLike(value)');
    expect(command).toContain('function presentationString(value, fallback)');
    expect(command).toContain("presentationString(record.customer && record.customer.name, 'Customer name unavailable')");
    expect(command).toContain("presentationString(record.work && record.work.title, 'Job title unavailable')");
  });

  test('uses a clear shared theme switch and a real themed Today sign-out button', () => {
    const theme = source('public/js/theme.js');
    const shell = source('public/js/today-shell.js');
    const shared = source('public/css/site-professionalism.css');
    const today = source('public/css/today.css');

    expect(theme).toContain('northstar-theme-switch');
    expect(theme).toContain('northstar-theme-sun');
    expect(theme).toContain('northstar-theme-moon');
    expect(theme).toContain("button.setAttribute('data-current-theme', theme)");
    expect(shell).toContain("node('button', 'today-sign-out')");
    expect(shell).toContain("control.setAttribute('aria-disabled', 'true')");
    expect(shared).toMatch(/\.northstar-theme-switch\s*\{[\s\S]*width:\s*70px\s*!important;[\s\S]*border-radius:\s*999px/);
    expect(today).toContain('.today-sign-out');
    expect(today).toContain('.today-sign-out:disabled');
  });

  test('uses customer-facing scheduling language and removes the paid ready sentence without a gap', () => {
    const html = source('public/demo-dashboard.html');
    const page = source('public/js/command-center-page.js');
    const contract = source('public/js/command-center-contract.js');
    const calendar = source('public/js/calendar-engine.js');
    const scheduling = source('public/css/scheduling-approval.css');

    expect(html).toContain('Scheduling Overview');
    for (const value of [html, page, contract, calendar]) {
      expect(value).not.toMatch(/canonical scheduling|canonical appointments/i);
    }
    expect(page).not.toContain('The current tenant workspace is ready.');
    expect(page).toContain('status.hidden = !message');
    expect(scheduling).toMatch(/\.m22-authority-heading > div\s*\{\s*display:\s*grid;\s*gap:\s*6px;/);
  });

  test('keeps Reload actions consistently separated from state copy and card boundaries', () => {
    const css = source('public/css/today.css');

    expect(css).toMatch(/\.today-state-panel\s*\{[\s\S]*row-gap:\s*18px;/);
    expect(css).toMatch(/\.today-state-action\s*\{\s*grid-column:\s*2;[\s\S]*justify-self:\s*start;/);
    expect(css).toMatch(/@media \(max-width:\s*768px\)[\s\S]*\.today-state-action\s*\{\s*grid-column:\s*1 \/ -1;[\s\S]*margin-top:\s*0;/);
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
