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

  test('shared customer details dismiss reliably and preserve Schedule and Polaris context', () => {
    const detail = read('public/js/customer-detail.js');
    expect(detail).toContain("_drawerEl.setAttribute('aria-hidden', 'false')");
    expect(detail).toContain("_drawerEl.setAttribute('aria-hidden', 'true')");
    expect(detail).toContain('_drawerEl.hidden = true');
    expect(detail).toContain("window.location.assign(prefix + '/calendar'");
    expect(detail).toContain("window.location.assign(prefix + '/polaris?kind='");
    expect(detail).toContain("if (e.key === 'Escape') close()");
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
    expect(polaris).toContain('<h1 class="sr-only">Polaris Intelligence Workspace</h1>');
    expect(polaris).toContain('id="polarisSelectedContext"');
    expect(polaris).toContain('function findSelectedGraph(workspace, selection)');
    expect(polaris).toContain('No fallback record is shown.');
    expect(polaris).toContain('Live provider requests');
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
    for (const route of ['/demo/polaris', '/demo/team', '/demo/ai-settings', '/demo/business-profile', '/demo/settings', '/demo/integrations']) {
      expect(runtime).toContain("'" + route + "'");
    }
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
});
