const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('Pre-Mission 21 reliability and readiness correction', () => {
  test('lead export is implemented and KPI cards no longer pretend to be links', () => {
    const leads = read('public/dashboard/leads.html');
    expect(leads).toContain('function exportLeadsCSV()');
    expect(leads).toContain('new Blob(');
    expect(leads).toContain("type: 'text/csv;charset=utf-8'");
    expect(leads).toContain('URL.createObjectURL(blob)');
    expect(leads).not.toContain('data-kpi-target');
    expect(leads).not.toMatch(/class="stat-card[^"]*"[^>]*role="link"/);
  });

  test('lead export neutralizes spreadsheet formulas before RFC-4180 quoting', () => {
    const leads = read('public/dashboard/leads.html');
    const helper = leads.match(/function csvCell\(value\) \{[\s\S]*?\n    \}/);
    expect(helper).not.toBeNull();
    const csvCell = Function(helper[0] + '; return csvCell;')();

    const prefixes = [
      '', ' ', '\t', '\r', '\n',
      '\u0000', '\u0001', '\u000B', '\u001F',
      '\u007F', '\u0085', '\u009F',
      '\u00A0', '\u1680', '\u2003', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000',
      '\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF'
    ];
    for (const prefix of prefixes) {
      for (const marker of ['=', '+', '-', '@']) {
        const input = prefix + marker + 'FORMULA';
        expect(csvCell(input)).toBe('"\'' + input + '"');
      }
    }
    expect(csvCell('Ordinary customer')).toBe('"Ordinary customer"');
    expect(csvCell('Quoted "customer"')).toBe('"Quoted ""customer"""');
  });

  test('shared customer details dismiss reliably and preserve Schedule and Polaris context', () => {
    const detail = read('public/js/customer-detail.js');
    expect(detail).toContain("_drawerEl.setAttribute('aria-hidden', 'false')");
    expect(detail).toContain("_drawerEl.setAttribute('aria-hidden', 'true')");
    expect(detail).toContain('_drawerEl.hidden = true');
    expect(detail).toContain("window.location.assign(prefix + '/calendar'");
    expect(detail).toContain("window.location.assign(prefix + '/polaris?kind='");
    expect(detail).toContain("if (e.key === 'Escape') { e.preventDefault(); close(); return; }");
    expect(detail).toContain('trapDrawerFocus(e)');
    expect(detail).toContain('setBackgroundInert(true)');
  });

  test('communications reset clears the search field and non-actions are not keyboard links', () => {
    const communications = read('public/dashboard/communications.html');
    expect(communications).toContain("curSearch = ''");
    expect(communications).toContain("document.getElementById('callSearchInput').value = ''");
    expect(communications).not.toContain('data-kpi-target');
    expect(communications).toContain('<label class="filter-toggle-label" for="filterAiToggle">AI-Related Calls Only</label>');
  });

  test('calendar controls expose period-aware names and an accessible modal', () => {
    const calendar = read('public/js/calendar-engine.js');
    expect(calendar).toContain('const periodLabel =');
    expect(calendar).toContain(': s.getMonthLabel()');
    expect(calendar).toContain('aria-label="Previous ${unit}"');
    expect(calendar).toContain('role="dialog" aria-modal="true"');
    expect(calendar).toContain("event.key !== 'Tab'");
    expect(calendar).toContain("e.date + 'T12:00:00'");
  });

  test('record-specific Polaris context is mounted and readiness copy is truthful', () => {
    const polaris = read('public/dashboard/polaris.html');
    expect(polaris).toContain('<title>Polaris — NorthStar</title>');
    expect(polaris).toContain('<h1 class="polaris-page-title">Polaris</h1>');
    expect(polaris).toContain('id="polarisSelectedContext"');
    expect(polaris).toContain('function findSelectedGraph(workspace, selection)');
    expect(polaris).toContain('No fallback record is shown.');
    expect(polaris).toContain('/api/v1/canonical/polaris/assistant/context');
    expect(polaris).toContain('/api/v1/canonical/polaris/assistant/status');
    expect(polaris).toContain("providerState === 'configured' ? 'Configured - not verified'");
    expect(polaris).not.toContain("providerState === 'available' ? 'Available'");
    expect(polaris).toContain('Conversation requests');
    expect(polaris).not.toContain('/api/v1/polaris/chat');
    expect(polaris).not.toContain('All systems operational');
    expect(polaris).not.toContain('Intelligence API Connected');
  });

  test('the homepage leads with the working demo and hides the gated Web Call form', () => {
    const home = read('public/index.html');
    const client = read('public/js/homepage-demo.js');
    expect(home).toContain('<span>Answer every call</span>, capture every lead, and see what needs attention');
    expect(home).toContain('href="/demo" class="btn btn-primary">Explore the Account-Free Demo');
    expect(home).toContain('id="demoWebCallPending"');
    expect(client).toContain('form.hidden = !state.available');
    expect(client).toContain('pending.hidden = state.available');
  });

  test('legacy demo URL redirects and repeated configuration toolbars remain absent', () => {
    const server = read('src/server.js');
    const runtime = read('public/js/demo-runtime.js');
    expect(server).toContain("app.get('/demo-dashboard'");
    expect(server).toContain("res.redirect(301, '/demo')");
    for (const route of ['/demo/polaris', '/demo/team', '/demo/business-profile', '/demo/settings', '/demo/integrations']) {
      expect(runtime).toContain("'" + route + "'");
    }
    expect(server).toContain("res.redirect(301, '/demo/settings#ai-settings')");
    expect(server).toContain("res.redirect(301, '/demo/business-profile?section=company#business-number')");
  });

  test('public trust copy avoids unsupported certification, SLA, and annual-refund claims', () => {
    const legalSurfaces = ['public/legal.html', 'public/privacy.html', 'public/terms.html', 'public/refund.html']
      .map(read).join('\n');
    expect(legalSurfaces).not.toContain('SOC 2 Compliant');
    expect(legalSurfaces).not.toContain('99.9% uptime SLA');
    expect(read('public/refund.html')).toContain('currently presents monthly prices only');
    expect(read('public/dashboard/lead.html')).not.toMatch(/Coming in Mission \d+/);
  });

  test('demo data is reserved and planned integrations are collapsed by default', () => {
    expect(read('src/routes/simulation/pipeline.js')).toContain('@example.com');
    expect(read('src/analytics/seeder.js')).toContain('@example.com');
    const integrations = read('public/dashboard/integrations.html');
    expect(integrations).toContain("provider.presentation.state === 'coming_soon'");
    expect(integrations).toContain("createElement('details', 'integration-category-details')");
  });

  test('first-time experience has guided presets, quick start, active saves, and grouped setup', () => {
    const runtime = read('public/js/demo-runtime.js');
    const nav = read('public/js/nav-component.js');
    const profile = read('public/dashboard/business-profile.html');
    const settings = read('public/dashboard/settings.html');
    expect(runtime).toContain('Urgent missed-call recovery');
    expect(runtime).toContain('High-value estimate');
    expect(runtime).toContain('Schedule conflict and follow-up');
    expect(runtime).toContain("global.sessionStorage.setItem('northstarOnboardingSimulated', 'true')");
    expect(nav).toContain('/js/workspace-guidance.js');
    expect(profile).toContain('Services &amp; Pricing');
    expect(profile).toContain('Schedule &amp; Area');
    expect(profile).toContain('id="businessProfileSectionSearch"');
    expect(profile).toContain('function filterProfileSections(value)');
    expect(profile).toContain('/js/workspace-form-state.js');
    expect(settings).toContain('/js/workspace-form-state.js');
  });

  test('account-free Team uses readable summaries and Polaris omits empty placeholder panels', () => {
    const team = read('public/dashboard/team.html');
    const polaris = read('public/dashboard/polaris.html');
    const parity = read('tests/browser/command-center-parity-prelude.js');
    expect(team).toContain("function isDemoMode() { return window.location.pathname.startsWith('/demo/'); }");
    expect(team).toContain("element('dl', 'wf-summary')");
    expect(team).toContain("['Job role'");
    expect(team).toContain("['Members'");
    expect(team).toContain("['Guidance'");
    expect(parity).toContain("demo crews render contained semantic summaries without editor controls");
    expect(parity).toContain("paid crew membership and lead controls remain contained and distinct");
    expect(polaris).not.toContain('Activity feed will appear here');
    expect(polaris).not.toContain('Pinned insights will appear here');
    expect(polaris).not.toContain('Dynamic suggestions will appear here');
  });

  test('public readiness, signup, integration filters, and analytics remain truthful and bounded', () => {
    const home = read('public/index.html');
    const signup = read('public/signup.html');
    const integrations = read('public/dashboard/integrations.html');
    const telemetry = read('public/js/product-telemetry.js');
    expect(home).toContain('Compare the published plans');
    expect(home).toContain('Included billed call minutes');
    expect(signup).not.toContain('id="phone"');
    expect(signup).toContain('during guided setup');
    expect(integrations).toContain('Available to configure');
    expect(integrations).toContain('Requires approval');
    expect(integrations).toContain('All customer-facing');
    expect(telemetry).toContain('globalPrivacyControl');
    expect(telemetry).toContain('navigator.doNotTrack');
    expect(telemetry).toContain("global.fetch('/api/telemetry'");
    expect(telemetry).toContain("global.addEventListener('pagehide'");
    expect(telemetry).toContain('queuePendingExit(pending)');
    expect(telemetry).toContain("global.addEventListener('pageshow', flushPendingExit)");
    expect(telemetry).toContain('global.sessionStorage.setItem(pendingExitKey');
    expect(telemetry).not.toContain('global.localStorage.setItem(pendingExitKey');
    expect(telemetry).not.toContain('keepalive:');
    expect(telemetry).not.toContain('navigator.sendBeacon');
    expect(telemetry).not.toContain("new Blob([payload]");
    expect(telemetry).not.toContain('referrer');
    expect(telemetry).not.toContain('searchParams');
  });

  test('homepage cards share one width and every customer-facing page receives one common footer', () => {
    const home = read('public/index.html');
    const profile = read('public/dashboard/business-profile.html');
    const style = read('public/css/style.css');
    const professionalism = read('public/css/site-professionalism.css');
    const theme = read('public/js/theme.js');

    expect(style).toMatch(/\.grid\s*\{[^}]*max-width:\s*1100px/s);
    expect(style).toMatch(/\.steps\s*\{[^}]*max-width:\s*1100px/s);
    expect(style).toMatch(/\.pricing-grid\s*\{[^}]*max-width:\s*1100px/s);
    expect(style).toMatch(/@media \(max-width: 768px\)[\s\S]*?\.step\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/s);
    expect(professionalism).toMatch(/html body\.homepage-refresh \.nav-inner\s*\{[^}]*min-height:\s*calc\(64px \+ env\(safe-area-inset-top\)\)[^}]*padding-top:\s*max\(8px, env\(safe-area-inset-top\)\)[^}]*padding-bottom:\s*8px/s);

    for (const label of ['Home', 'How It Works', 'Pricing', 'FAQ', 'Contact', 'Privacy', 'Terms', 'Refunds', 'Legal']) {
      expect(theme).toContain("label: '" + label + "'");
    }
    expect(theme).toContain("footer.setAttribute('data-northstar-site-footer', '')");
    expect(theme).toContain("document.querySelector('.main-content')");
    expect(home).not.toContain('User-initiated browser Web Call');
    expect(home).not.toContain('Isolated demo context');
    expect(home).not.toContain('Verified delete before results');
    expect(profile).not.toContain('Business Profile v1.0');
    expect(profile).not.toContain('Single source of truth for NorthStar operations');
  });

  test('FAQ is compact and readiness vocabulary is explained while Mission 32 stays future-only', () => {
    const faq = read('public/faq.html');
    const mission32 = read('docs/roadmap/MISSION_32_SCENARIO_CALCULATOR.md');
    expect(faq).toContain('<details class="faq-item"');
    expect(faq).toContain('Available now');
    expect(faq).toContain('Awaiting approval');
    expect(mission32).toContain('Future mission');
    expect(mission32).toContain('not a customer, lead, job, appointment, invoice, or binding estimate');
    expect(mission32).toContain('versioned assumptions');
  });
});
