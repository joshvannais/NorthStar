'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const CANONICAL_STANDALONE_CALCULATOR = path.join(ROOT, 'public/unlisted/investor-forecast.html');

describe('Pre-Mission-23 P1 design system and employee foundation', () => {
  test('publishes one shared typography, rail, card, control, and page-title contract', () => {
    const css = read('public/css/site-professionalism.css');

    for (const token of [
      '--font-body', '--font-numeric', '--northstar-rail-max', '--northstar-page-gutter',
      '--northstar-card-padding', '--northstar-card-radius', '--northstar-control-height',
      '--northstar-control-radius', '--northstar-page-title-size', '--northstar-page-title-line',
    ]) expect(css).toContain(token);

    expect(css).toMatch(/\.stat-value,[\s\S]*\.ds-kpi-value,[\s\S]*\.price,[\s\S]*font-family:\s*var\(--font-body\)\s*!important;/);
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums lining-nums;/);
    expect(css).toMatch(/\.page-header h1,[\s\S]*\.cal-title,[\s\S]*\.polaris-inline-name,[\s\S]*font-size:\s*var\(--northstar-page-title-size\)\s*!important;/);
    expect(css).toMatch(/\.dashboard-main,[\s\S]*\.command-center-blueprint-main[\s\S]*max-width:\s*var\(--northstar-rail-max\);/);
    expect(css).toMatch(/\.polaris-inline-star,[\s\S]*\.demo-polaris-mark[\s\S]*clip-path:\s*polygon/);
  });

  test('mounts the shared professionalism layer on every shipped application-shell HTML route', () => {
    const files = [];
    const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.name.endsWith('.html') && absolute !== CANONICAL_STANDALONE_CALCULATOR) files.push(absolute);
    });
    walk(path.join(ROOT, 'public'));
    expect(files.length).toBeGreaterThan(25);
    for (const filename of files) {
      expect(fs.readFileSync(filename, 'utf8')).toContain('/css/site-professionalism.css');
    }
  });

  test('uses one centered information footer and a real themed Sign Out control', () => {
    const theme = read('public/js/theme.js');
    const nav = read('public/js/nav-component.js');
    const css = read('public/css/site-professionalism.css');

    for (const label of ['Privacy', 'Terms', 'Legal']) expect(theme).toContain(`label: '${label}'`);
    expect(theme).toContain("navigation.setAttribute('aria-label', 'NorthStar information')");
    expect(css).toMatch(/\.northstar-site-footer \.footer-links[\s\S]*justify-content:\s*center;/);
    expect(nav).toContain('<button type="button" class="northstar-nav-action" id="navSignOut" data-account-logout');
    expect(nav).toContain('<button type="button" class="northstar-nav-action" data-account-logout');
    expect(css).toMatch(/\.today-sign-out,[\s\S]*\.northstar-nav-action,[\s\S]*\.m22-action-button[\s\S]*min-height:\s*var\(--northstar-control-height\);/);
  });

  test('keeps the theme slider stable, stateful, keyboard-native, and icon-based', () => {
    const theme = read('public/js/theme.js');
    const css = read('public/css/site-professionalism.css');

    expect(theme).toContain('button type="button" class="theme-toggle northstar-theme-switch"');
    expect(theme).toContain("button.setAttribute('aria-pressed', dark ? 'true' : 'false')");
    expect(theme).toContain("button.setAttribute('data-current-theme', theme)");
    expect(theme).toContain("global.localStorage.setItem(STORAGE_KEY, theme)");
    expect(theme).toContain('northstar-theme-sun');
    expect(theme).toContain('northstar-theme-moon');
    expect(css).toMatch(/\.northstar-theme-switch::before[\s\S]*top:\s*50%;[\s\S]*left:\s*25%;[\s\S]*width:\s*34px;[\s\S]*height:\s*34px;[\s\S]*transform:\s*translate\(-50%,\s*-50%\)/);
    expect(css).toMatch(/data-current-theme="dark"\]::before\s*\{[^}]*left:\s*75%;/s);
  });

  test('keeps Today responsive, compact, centered in non-ready states, and free of layout emoji', () => {
    const html = read('public/dashboard/today.html');
    const css = read('public/css/today.css');
    const shell = read('public/js/today-shell.js');

    expect(html).toContain('class="today-state-copy"');
    expect(html).toMatch(/today-state-icon[\s\S]*<svg/);
    expect(html).not.toContain('aria-hidden="true">✦');
    expect(css).toMatch(/\.today-state-panel\s*\{[\s\S]*justify-items:\s*center;[\s\S]*text-align:\s*center;/);
    expect(css).toMatch(/\.today-state-copy\s*\{[^}]*gap:\s*10px;/);
    expect(css).toMatch(/@media \(max-width:\s*390px\)[\s\S]*\.today-page-actions\s*\{[^}]*width:\s*100%;/);
    expect(css).toMatch(/@media \(max-width:\s*768px\)[\s\S]*\.today-detail-grid\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(shell).toContain('function menuIcon()');
    expect(shell).toContain('function closeIcon()');
    expect(shell).not.toContain("node('button', 'mobile-menu-close', '×')");
  });

  test('retains inert hostile-field projection and bounded DOM identifiers', () => {
    const projection = read('public/js/display-projection.js');
    const today = read('public/js/today-page.js');
    const command = read('public/js/command-center-page.js');

    expect(projection).toContain('knownEventAttribute');
    expect(projection).toContain('return markupLike(normalized) ? unavailable : normalized;');
    expect(today).toContain('function stableDomIdentifier(value)');
    expect(today).toContain("var jobTitle = element('h3', '', presentationText(record.title, 'Job title unavailable'));");
    expect(today).not.toContain('innerHTML');
    expect(command).toContain("return displayProjection().text(text, fallback || '');");
    expect(command).toContain("element('h3', '', presentationString(record.customer && record.customer.name");
  });

  test('has one appointment count authority and no repeated recorded-time placeholder rows', () => {
    const today = read('public/js/today-page.js');
    const command = read('public/js/command-center-page.js');
    const publicSources = [
      today, command, read('public/js/calendar-engine.js'), read('public/js/today-shell.js'),
    ].join('\n');

    expect(today.match(/todayCount/g).length).toBe(2);
    expect(today).toContain("byId('todayCount').textContent = data.records.length + (data.records.length === 1 ? ' Appointment' : ' Appointments');");
    expect(command).toContain("definition.textContent = 'Review current scheduling records in ' + overview.timeZone + '.';");
    expect(command).not.toContain("definition.textContent = 'Showing ' + page.shown + ' of ' + page.total + ' appointments");
    expect(publicSources).not.toMatch(/Recorded time unavailable/i);
  });

  test('keeps ordinary identity on one line while preserving an accessible full value', () => {
    const today = read('public/js/today-page.js');
    const css = read('public/css/today.css');

    expect(today).toContain("authority.title = authorityText");
    expect(today).toContain("authority.setAttribute('aria-label', authorityText)");
    expect(today).toContain("'Owner Operator · Personal Work Only'");
    expect(css).toMatch(/\.today-header #todayAuthority[\s\S]*white-space:\s*nowrap;[\s\S]*text-overflow:\s*ellipsis;/);
  });
});
