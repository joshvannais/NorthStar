'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

describe('founder desktop and mobile visual corrections', () => {
  test('published plan cards disclose approved prices, usage, and connected-workspace contents', () => {
    const homepage = read('public/index.html');
    const faq = read('public/faq.html');
    const css = read('public/css/public-site.css');
    for (const value of ['$149', '$299', '$499', '160', '325', '540']) expect(homepage).toContain(value);
    expect(homepage).toContain('pricing-feature-list');
    expect(homepage).not.toContain('Plan allocation not yet published');
    for (const value of ['160 billed call minutes', '325 billed call minutes', '540 billed call minutes']) expect(faq).toContain(value);
    expect(css).toMatch(/\.pricing-card \.price\s*\{[^}]*font-family:\s*var\(--font-body\)/s);
    expect(css).toMatch(/\.pricing-readiness :is\(h3, p, th, td\)/);
  });

  test('Polaris title follows the shared hierarchy and its composer is fixed to the viewport', () => {
    const page = read('public/dashboard/polaris.html');
    const shared = read('public/css/site-professionalism.css');
    expect(page).toContain('<body class="polaris-page">');
    expect(page).toContain('polaris-inline-header page-header');
    expect(page).toMatch(/\.polaris-prompt-bar\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0[^}]*left:\s*240px/s);
    expect(page).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.polaris-prompt-bar\s*\{\s*left:\s*0;/);
    expect(shared).toMatch(/\.polaris-page-title/);
  });

  test('customer drawers remain inset and rounded on mobile', () => {
    const css = read('public/css/pre-m23-p3.css');
    expect(css).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.customer-drawer\s*\{[^}]*width:\s*calc\(100vw - 24px\)[^}]*height:\s*calc\(100dvh - 24px\)[^}]*border-radius:\s*18px/s);
    expect(css).not.toMatch(/\.customer-drawer\s*\{[^}]*width:\s*100vw[^}]*border-radius:\s*0/s);
  });

  test('record scope and the complete categorized price breakdown live inside Polaris', () => {
    const detail = read('public/js/customer-detail.js');
    const polarisStart = detail.indexOf('drawer-polaris-insight');
    expect(detail.indexOf('drawer-polaris-analysis')).toBeGreaterThan(polarisStart);
    expect(detail.indexOf('id="cdDescription"')).toBeGreaterThan(polarisStart);
    for (const category of ['Service And Scope', 'Labor', 'Materials', 'Equipment And Machinery', 'Travel And Mobilization', 'Permits And Fees', 'Overhead, Margin, And Adjustments', 'Tax']) {
      expect(detail).toContain(category);
    }
    expect(detail).toContain('Awaiting a recorded input.');
  });

  test('leads, communications, and team use one non-overlapping functional search control', () => {
    const shared = read('public/css/site-professionalism.css');
    const leads = read('public/dashboard/leads.html');
    const communications = read('public/dashboard/communications.html');
    const team = read('public/dashboard/team.html');
    expect(shared).toMatch(/\.northstar-search\s*\{[^}]*display:\s*flex[^}]*gap:\s*10px/s);
    expect(shared).toMatch(/\.northstar-search svg\s*\{[^}]*flex:\s*0 0 20px/s);
    expect(leads).toContain('id="leadSearchInput"');
    expect(leads).toContain('function setLeadSearch');
    expect(communications).toContain('call-search-bar northstar-search');
    expect(team).toContain('id="teamSearchInput"');
    expect(team).toContain('function applyWorkforceSearch');
  });

  test('integration sections and Command Center customer cards render collapsed', () => {
    const integrations = read('public/dashboard/integrations.html');
    const commandCenter = read('public/js/command-center-page.js');
    const legacyCommandCenter = read('public/dashboard/command-center.html');
    const dashboard = read('public/dashboard.html');
    expect(integrations).toContain('categoryDetails.open = false;');
    expect(integrations).not.toMatch(/class="map-preference-scope"[^>]*\sopen(?:\s|>)/);
    expect(commandCenter).toContain("element('details', 'command-center-mobile-customer customer-record-card')");
    expect(commandCenter).not.toContain("customerCard.open = true");
    for (const page of [legacyCommandCenter, dashboard]) {
      expect(page).toContain("document.createElement('details')");
      expect(page).toContain("className = 'customer-record-avatar'");
    }
  });

  test('demo transcripts use natural service language and retire the robotic prompts', () => {
    const workspace = read('src/commandCenter/workspace.js');
    const scenarios = read('src/commandCenter/scenarioSpace.js');
    expect(workspace).not.toContain('What outcome would be most useful from this call?');
    expect(workspace).not.toContain('How quickly does the team need to respond?');
    expect(workspace).toContain('Is there a particular day or deadline you are working toward?');
    expect(scenarios).toContain('This is my first time calling your company.');
  });

  test('Business Profile uses the full content width and compact pills can reflow', () => {
    const profile = read('public/dashboard/business-profile.html');
    const shared = read('public/css/site-professionalism.css');
    expect(profile).toMatch(/\.bp-container\s*\{[^}]*max-width:\s*none[^}]*margin:\s*0/s);
    expect(shared).toMatch(/\.demo-count-pill[^}]*[\s\S]*?white-space:\s*normal\s*!important/);
  });
});
