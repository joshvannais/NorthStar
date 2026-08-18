'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const contract = require('../../public/js/command-center-contract');

const ROOT = path.resolve(__dirname, '..', '..');
const ALLOWLIST = Object.freeze(['command-center', 'leads', 'communications']);
const PAGE_BY_ROUTE = Object.freeze({
  'command-center': 'public/demo-dashboard.html',
  polaris: 'public/dashboard/polaris.html',
  leads: 'public/dashboard/leads.html',
  communications: 'public/dashboard/communications.html',
  'my-number': 'public/dashboard/my-number.html',
  calendar: 'public/dashboard/calendar.html',
  team: 'public/dashboard/team.html',
  'ai-settings': 'public/dashboard/ai-settings.html',
  'business-profile': 'public/dashboard/business-profile.html',
  settings: 'public/dashboard/settings.html',
  integrations: 'public/dashboard/integrations.html',
});

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function allFiles(root, suffixes) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...allFiles(absolute, suffixes));
    else if (suffixes.some(suffix => entry.name.endsWith(suffix))) result.push(absolute);
  }
  return result;
}

describe('surgical site professionalism correction', () => {
  test('Polaris placement is an exact shared paid/demo allowlist', () => {
    expect(contract.ROUTES.map(route => route.id)).toHaveLength(11);
    for (const route of contract.ROUTES) {
      const html = read(PAGE_BY_ROUTE[route.id]);
      if (ALLOWLIST.includes(route.id)) {
        expect(html).toContain('/js/polaris-card.js');
        expect(html).toContain('/css/polaris-card.css');
      } else {
        expect(html).not.toContain('/js/polaris-card.js');
        expect(html).not.toContain('/js/polaris-surface-card.js');
        expect(html).not.toContain('/css/polaris-card.css');
      }
    }

    const surface = read('public/js/polaris-surface-card.js');
    const card = read('public/js/polaris-card.js');
    expect(surface).toContain("Object.freeze(['leads', 'polaris', 'communications'])");
    expect(card).toContain("Object.freeze(['command-center', 'leads', 'polaris', 'communications'])");
    expect(read('public/dashboard/calendar.html')).not.toContain('calendarPolaris');
    expect(read('public/js/calendar-engine.js')).not.toContain('renderPolaris()');
    expect(read('public/dashboard/communications.html')).not.toContain('id="polarisCard"');
  });

  test('the site uses the approved native iPhone-first typography across platforms', () => {
    expect(read('public/css/style.css').startsWith("@import url('/css/site-professionalism.css');")).toBe(true);
    const layer = read('public/css/site-professionalism.css');
    expect(layer).toContain('Inter Latin, Google Fonts v20');
    expect(layer).toMatch(/@font-face\s*{[\s\S]*?font-family:\s*'Inter'[\s\S]*?format\('woff2'\)/);
    expect(layer).toContain("font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important");
    expect(layer).toContain("--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
    expect(layer).toContain("--font-display: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif");
    expect(layer).not.toContain("font-family: 'Inter', -apple-system");
    expect(layer).not.toContain('font-synthesis: none');
    expect(layer).toMatch(/\.northstar-lockup img[\s\S]*?object-fit:\s*cover/);
    expect(read('public/js/nav-component.js')).toContain('src="/assets/logo.png"');
    expect(read('public/js/nav-component.js')).not.toContain('src="/assets/logo.svg"');
    expect(read('public/demo-dashboard.html')).toContain('src="/assets/logo.png"');
    expect(read('public/demo-dashboard.html')).not.toContain('src="/assets/logo.svg"');
    expect(read('public/index.html')).not.toMatch(/font-family\s*:\s*Inter\b/);

    const source = allFiles(path.join(ROOT, 'public'), ['.css', '.html'])
      .map(file => fs.readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/font-weight\s*:\s*(?:650|720|750|760|780|850)\b/);
    expect(source).not.toMatch(/font\s*:\s*(?:650|720|750|760|780|850)\b/);

    const security = read('src/middleware/security.js');
    expect(security).toContain(`'font-src': ["'self'", 'data:', "https://fonts.gstatic.com"]`);
    expect(security).not.toMatch(/'script-src'[^\n]*data:/);
  });

  test('the empty Command Center pipeline chart collapses to one bounded column', () => {
    const css = read('public/css/demo-dashboard.css');
    expect(css).toMatch(/\.command-center-chart-empty \.demo-chart-bars\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.command-center-chart-empty \.demo-chart-bars\s*\{[^}]*width:\s*100%/s);
    expect(css).toMatch(/\.command-center-chart-empty \.demo-chart-bars\s*\{[^}]*padding:\s*0/s);
    expect(css).toMatch(/\.command-center-empty-copy\s*\{[^}]*width:\s*min\(100%, 36ch\)/s);
  });

  test('the shared mobile navigation has one explicit accessible open and closed state', () => {
    const navigation = read('public/js/nav-component.js');
    expect(navigation).toContain('#mobileMenu.mobile-menu[data-state="open"]');
    expect(navigation).toContain('aria-controls="mobileMenu" aria-expanded="false"');
    expect(navigation).toContain('data-state="closed" aria-hidden="true" inert');
    expect(navigation).toContain("menu.setAttribute('data-state', 'open')");
    expect(navigation).toContain("menu.setAttribute('data-state', 'closed')");
    expect(navigation).toContain("menu.setAttribute('inert', '')");
    expect(navigation).toContain("closeMenu(false)");
    expect(navigation).toContain("if (e.key === 'Escape')");
    expect(navigation).toContain("if (e.key !== 'Tab') return");
  });

  test('shared presentation formatting hides internal identifiers and renders structured values as prose', () => {
    const sandbox = { window: {}, Intl };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(read('public/js/presentation-format.js'), sandbox, { filename: 'presentation-format.js' });
    const text = vm.runInContext(`window.NorthStarPresentationFormat.describe({
      customerId: '10000000-0000-4000-8000-000000000083',
      snapshotDigest: '${'a'.repeat(64)}',
      callerIntent: 'new_estimate',
      gates: [{ type: 'walk', width: 4 }],
      pricing: { customerFacingPrice: 0 },
      risk: { emergency: false, signal: 'follow_up_due' }
    })`, sandbox);
    expect(text).toContain('Caller intent: New estimate');
    expect(text).toContain('Gates: Type: walk; Width: 4');
    expect(text).toContain('Customer price: $0.00');
    expect(text).toContain('Emergency: No');
    expect(text).not.toMatch(/[{}"]|\[object Object\]|10000000-|[a-f0-9]{64}/i);

    const cyclic = vm.runInContext(`(function () {
      var value = { linearFeet: 100 }; value.self = value;
      return window.NorthStarPresentationFormat.hasCycle(value);
    })()`, sandbox);
    expect(cyclic).toBe(true);

    const pricing = vm.runInContext(`window.NorthStarPresentationFormat.describe({
      preliminaryRange: { low: 13320, high: 16280 }
    }, { key: 'pricing' })`, sandbox);
    expect(pricing).toContain('Low: $13,320.00');
    expect(pricing).toContain('High: $16,280.00');
  });

  test('customer/work presentation contains no raw snapshot or serialized internal identifiers', () => {
    const customerDetail = read('public/js/customer-detail.js');
    const demoDetail = read('public/js/demo-command-center.js');
    const leadDetail = read('public/dashboard/lead.html');
    const homepage = read('public/js/homepage-demo.js');

    expect(customerDetail).not.toContain('var serialized = JSON.stringify(value)');
    expect(customerDetail).toContain('Gates and missing information');
    expect(customerDetail).toContain('drawer-polaris-insight');
    expect(demoDetail).not.toMatch(/\['(?:Customer|Lead|Work) ID'/);
    expect(demoDetail).not.toContain("['Snapshot digest'");
    expect(demoDetail).not.toContain('Inspect the complete fictional Polaris snapshot');
    expect(leadDetail).not.toContain("['Snapshot digest'");
    expect(leadDetail).not.toContain('? JSON.stringify(entry[1])');
    expect(homepage).not.toContain('result.provenance && result.provenance.calculationVersion');
    expect(read('public/js/command-center-page.js')).toContain("element('span', '', ' No customer");
    expect(read('public/dashboard/team.html')).not.toContain("'wf-id'");
    expect(read('public/dashboard/team.html')).not.toContain('ui-monospace');
    expect(read('public/dashboard/team.html')).toContain('Role-authorized workspace');
    expect(read('public/dashboard/team.html')).not.toContain('>PostgreSQL authority<');
    expect(read('public/dashboard/team.html')).toContain("element('div', 'wf-crew-member')");
    expect(read('public/dashboard/team.html')).toContain("element('label', 'wf-lead-toggle')");
    expect(read('public/dashboard/settings.html')).toContain('role-authorized workspace preferences');
    expect(read('public/dashboard/settings.html')).not.toContain('<code>notification_preferences</code>');
    expect(read('public/dashboard/integrations.html')).toContain('NorthStar-owned read-only catalogue');
    expect(read('public/dashboard/integrations.html')).not.toContain('Authority: northstar_integration_catalogue_v1');
  });

  test('Communications cards omit empty separators and support keyboard activation', () => {
    const listeners = {};
    const document = {
      addEventListener(type, callback) { listeners[type] = callback; },
    };
    const window = {};
    const sandbox = { window, document, Number, String, Array, Object, Date, isNaN };
    window.window = window;
    window.document = document;
    vm.createContext(sandbox);
    vm.runInContext(read('public/js/customer-card.js'), sandbox, { filename: 'customer-card.js' });

    const html = window.CustomerCard.render({ caller: 'Avery Lewis', service: 'Roof inspection' }, {
      layout: 'call', index: 0, outcome: 'answered',
    });
    expect(html).toContain('role="button" tabindex="0"');
    expect(html).toContain('<span class="call-meta-item">Roof inspection</span>');
    expect(html).not.toContain('meta-sep');
    expect(html).not.toContain(' | ');
    expect(html).not.toContain('call-card-body');

    const row = window.CustomerCard.render({ caller: 'Avery Lewis', status: 'follow_up' }, {
      layout: 'row', index: 0,
    });
    expect(row).toContain('data-label="Phone">Not recorded');
    expect(row).toContain('data-label="Service"');
    expect(row).toContain('Service not recorded');
    expect(row).toContain('data-label="Estimated value"><strong>Unavailable</strong>');
    expect(row).toContain('data-label="Date">Not recorded');
    expect(row).not.toContain('>—<');

    const click = jest.fn();
    const preventDefault = jest.fn();
    listeners.keydown({
      key: 'Enter', preventDefault,
      target: { closest: () => ({ click }) },
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  test('shared statuses render canonical human labels instead of internal tokens', () => {
    const sandbox = { window: {}, String };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(read('public/js/status-pill.js'), sandbox, { filename: 'status-pill.js' });
    expect(sandbox.window.StatusPill.render('follow_up')).toContain('>Follow Up<');
    expect(sandbox.window.StatusPill.render('follow_up')).not.toContain('follow_up');
    expect(sandbox.window.StatusPill.getClass('follow_up')).toBe('followup');
    expect(sandbox.window.StatusPill.render('<internal_status>')).not.toContain('<internal_status>');
  });
});
