'use strict';

const fs = require('fs');
const path = require('path');
const commandCenterContract = require('../../public/js/command-center-contract');
const { MOUNTED_THEME_PAGES } = require('../helpers/site-theme-pages');

const ROOT = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('Pre-Mission 23 P7 accessibility acceptance contracts', () => {
  test('route inventory maps every demo destination to the page mounted by the server', () => {
    const expectedFiles = {
      'command-center': 'public/demo-dashboard.html',
      polaris: 'public/dashboard/polaris.html',
      leads: 'public/dashboard/leads.html',
      communications: 'public/dashboard/communications.html',
      calendar: 'public/dashboard/calendar.html',
      team: 'public/dashboard/team.html',
      'business-profile': 'public/dashboard/business-profile.html',
      settings: 'public/dashboard/settings.html',
      integrations: 'public/dashboard/integrations.html',
    };

    for (const destination of commandCenterContract.ROUTES) {
      expect(MOUNTED_THEME_PAGES).toContainEqual(expect.objectContaining({
        route: destination.demoPath,
        file: expectedFiles[destination.id],
        surface: 'public-demo',
      }));
    }
    expect(MOUNTED_THEME_PAGES).toContainEqual(expect.objectContaining({
      route: '/dashboard',
      file: 'public/demo-dashboard.html',
      surface: 'dashboard',
    }));
  });

  test('cross-browser runtime includes Chromium, Firefox, and actual Playwright WebKit', () => {
    const runtime = read('tests/helpers/playwright-runtime.js');
    expect(runtime).toMatch(/selected\s*===\s*['"]firefox['"]/);
    expect(runtime).toMatch(/\{\s*chromium,\s*firefox,\s*webkit\s*\}/);
    expect(runtime).toMatch(/firefox\.executablePath\(\)/);
  });

  test('the shared paid and demo sidebar is a named navigation landmark', () => {
    const navigation = read('public/js/nav-component.js');
    expect(navigation).toMatch(/<nav class="sidebar-nav" aria-label="Workspace navigation">/);
  });

  test('customer identity opens surface-specific detail while Polaris remains an explicit action', () => {
    const leads = read('public/dashboard/leads.html');
    const communications = read('public/dashboard/communications.html');
    const detail = read('public/js/customer-detail.js');

    expect(leads).toMatch(/CustomerDetail\.open\(lead\.customerId,\s*\{\s*source:\s*['"]leads['"]/);
    expect(communications).toMatch(/CustomerDetail\.open\(lead\.customerId,\s*\{\s*source:\s*['"]communications['"]/);
    expect(leads).not.toMatch(/openLeadDrawer[\s\S]{0,500}location\.(?:assign|href)[\s\S]{0,100}polaris/i);
    expect(communications).not.toMatch(/openCallCard[\s\S]{0,500}location\.(?:assign|href)[\s\S]{0,100}polaris/i);
    expect(detail).toContain('id="cdConversationHistory"');
    expect(detail).toMatch(/function renderCommunicationHistory\(/);
    expect(detail).toMatch(/id="cdBtnAskPolaris"[\s\S]{0,120}>Ask Polaris</);
  });

  test('the accessibility ledger keeps all seven acceptance records explicit', () => {
    const ledger = read('docs/pre-m23-p7-accessibility-acceptance.md');
    for (let index = 1; index <= 7; index += 1) {
      expect(ledger).toContain(`ACC-0${index}`);
    }
    expect(ledger).toMatch(/Physical iPhone, iPad, and Android[\s\S]{0,120}unavailable/i);
    expect(ledger).toMatch(/WebKit[\s\S]{0,80}not physical Safari/i);
    expect(ledger).toMatch(/professional prose[\s\S]{0,80}native cards/i);
    expect(ledger).toMatch(/raw JSON[\s\S]{0,160}code fences[\s\S]{0,160}internal error codes/i);
  });
});
