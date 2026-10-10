'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  projectIntegrationCatalogue,
} = require('../../src/integrations/catalogue');

const ROOT = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function files(directory, suffix = '.js') {
  return fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })
    .flatMap(entry => {
      const relative = path.join(directory, entry.name);
      return entry.isDirectory() ? files(relative, suffix) : [relative];
    })
    .filter(relative => relative.endsWith(suffix));
}

describe('Mission 27 Slice 1B source inventory quarantine', () => {
  test('has no native Mission 27 financial store or migration 260', () => {
    const migrationNames = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(name => name.endsWith('.sql'))
      .sort();
    expect(migrationNames.at(-1)).toBe('259_demo_forecast_journey.sql');
    expect(migrationNames.some(name => /^260_/.test(name))).toBe(false);

    const schema = migrationNames.map(name => read(path.join('migrations', name))).join('\n');
    expect(schema).not.toMatch(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?canonical_(?:invoices|payments|collections)\b/i);
    expect(schema).not.toMatch(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?mission_27_/i);
  });

  test('keeps legacy analytics routers unmounted and behind canonical retirement', () => {
    const server = read('src/server.js');
    expect(server).not.toContain("require('./routes/dashboard')");
    expect(server).not.toContain("require('./routes/publicApi')");
    expect(server).toContain("'/dashboard': 'public/demo-dashboard.html'");
    expect(server).not.toContain("'public/dashboard.html'");
    expect(server).not.toContain("'public/dashboard/command-center.html'");

    const compatibility = server.indexOf("app.use('/api', createCompatibilityRouter())");
    const retirement = server.indexOf("app.use('/api', createLegacyAuthorityRetirementRouter())");
    const broadLegacy = server.indexOf("app.use('/api', apiRoutes)");
    expect(compatibility).toBeGreaterThan(-1);
    expect(retirement).toBeGreaterThan(compatibility);
    expect(broadLegacy).toBeGreaterThan(retirement);

    const runtimeSources = files('src')
      .filter(relative => relative !== path.join('src', 'routes', 'dashboard.js'))
      .filter(relative => relative !== path.join('src', 'routes', 'publicApi.js'))
      .map(read)
      .join('\n');
    expect(runtimeSources).not.toMatch(/require\(['"]\.\/?routes\/dashboard['"]\)/);
    expect(runtimeSources).not.toMatch(/require\(['"]\.\/?routes\/publicApi['"]\)/);
  });

  test('keeps account billing and payment providers outside customer-financial authority', () => {
    const initial = read('migrations/001_initial_schema.sql');
    expect(initial).toMatch(/CREATE TABLE IF NOT EXISTS invoices[\s\S]*subscription_id UUID REFERENCES subscriptions\(id\)/);
    expect(read('src/users/store.js')).toContain('function recordPayment');
    expect(files('src').filter(relative => relative !== path.join('src', 'users', 'store.js')).map(read).join('\n'))
      .not.toMatch(/require\(['"][^'"]*users\/store['"]\)/);
    expect(read('public/js/app-store.js')).not.toMatch(/\binvoices\s*:/);

    const dependencies = Object.keys(JSON.parse(read('package.json')).dependencies || {});
    expect(dependencies).not.toEqual(expect.arrayContaining([
      'stripe', 'square', 'paypal', '@paypal/checkout-server-sdk', 'plaid', 'quickbooks', 'xero-node',
    ]));

    const catalogue = projectIntegrationCatalogue({
      authority: 'canonical_integration_ownership',
      connectors: [
        { provider: 'retell', status: 'not_provisioned' },
        { provider: 'voice', status: 'not_provisioned' },
      ],
    });
    const accounting = catalogue.categories.find(category => category.key === 'accounting_payments');
    expect(accounting.providers.map(provider => provider.key)).toEqual(['quickbooks', 'stripe', 'square']);
    for (const provider of accounting.providers) {
      expect(provider.capabilities).toEqual(expect.objectContaining({
        management: 'unavailable', authorization: 'unavailable', scopes: 'unavailable',
        dataDirection: 'none', sync: 'unavailable', webhookHealth: 'unavailable',
      }));
    }
    expect(accounting.providers.find(provider => provider.key === 'stripe').presentation.state)
      .toBe('requires_provider_approval');
  });

  test('mounted paid copy distinguishes estimates from customer-financial truth', () => {
    const profile = read('public/dashboard/business-profile.html');
    const polaris = read('public/dashboard/polaris.html');
    const lead = read('public/dashboard/lead.html');
    const commandCenter = read('public/demo-dashboard.html');
    const estimate = read('public/customer-estimate.html');

    expect(profile).toContain('Customer-financial documents remain unavailable until a later accepted Mission 27 release.');
    expect(profile).not.toContain('used across estimates, invoices, communications');
    expect(polaris).toContain('What estimate value needs review this week?');
    expect(polaris).not.toContain('What revenue is at risk this week?');
    expect(lead).not.toContain('Original revenue estimate');
    expect(lead).not.toMatch(/ci\.snapshot\.(?:estimatedRevenue|estimatedProfit|estimatedLabor|travelCost|profitPerLaborHour)\s*\|\|\s*0/);
    expect((lead.match(/renderCustomerIntelligence\(/g) || [])).toHaveLength(1);
    expect(commandCenter).toContain('Planning only. No revenue forecast or cash timing is shown while evidence is incomplete.');
    expect(commandCenter).toContain('Company overhead cash, financing cash, earned revenue, invoices, collections, and actual payment remain distinct.');
    expect(estimate).toContain('I understand this does not make a payment.');
  });

  test('records every original and additive Slice 1B inventory family', () => {
    const inventory = read('docs/architecture/MISSION_27_PART1B_SOURCE_INVENTORY.md');
    for (const marker of [
      'Native Mission 27 invoice/payment lifecycle',
      'NorthStar account subscriptions and trial entitlement',
      'Legacy analytics and estimated-revenue engines',
      'External financial imports and outcomes',
      'Canonical call/provider identity',
      'Transcript and transcript-derived facts',
      'Field images and file evidence',
      'Canonical estimate identity and human decisions',
      'Material, labor, equipment, travel, cost composition, pricing policy and pricing plan',
      'Proposal adoption and options',
      'Customer signature evidence',
      'Accepted-estimate-to-work conversion',
      'Workforce access and job roles',
      'Native and external outcome learning',
      'Capacity, route and resource risk',
      'Mission 32 field calculator',
      'Route, event, KPI, simulation, and customer-link disposition',
    ]) expect(inventory).toContain(marker);
    expect(inventory).toContain('There is no authoritative Mission 27 customer-financial source at this base.');
  });
});
