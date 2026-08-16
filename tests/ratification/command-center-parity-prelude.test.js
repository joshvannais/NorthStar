'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { app } = require('../../src/server');
const contract = require('../../public/js/command-center-contract');
const permissions = require('../../src/auth/permissions');
const { paidRequestContext } = require('../../src/routes/commandCenter');
const {
  buildDemoWorkspace,
  buildPaidWorkspace,
  buildSimulatedGraph,
  createInitialDemoState,
  demoConfiguration,
  tenantIdFromTokenHash,
} = require('../../src/commandCenter/workspace');

const ROOT = path.resolve(__dirname, '..', '..');
const TOKEN_HASH = 'a'.repeat(64);

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

describe('Demo/Paid Command Center Parity Prelude contracts', () => {
  test('one shared route manifest binds all eleven paid destinations to account-free counterparts', async () => {
    expect(contract.ROUTES).toHaveLength(11);
    expect(contract.ROUTES.map(route => route.id)).toEqual(permissions.NAVIGATION_DESTINATIONS.map(route => route.id));
    expect(contract.ROUTES.map(route => route.paidPath)).toEqual(permissions.NAVIGATION_DESTINATIONS.map(route => route.href));
    expect(new Set(contract.ROUTES.map(route => route.demoPath)).size).toBe(11);
    expect(contract.routeForPath('/demo-dashboard').id).toBe('command-center');

    const expectedShell = read('public/demo-dashboard.html');
    for (const destination of contract.ROUTES) {
      const response = await request(app).get(destination.demoPath).expect(200);
      expect(response.text).toBe(expectedShell);
      expect(destination.demoPath).toMatch(/^\/demo(?:\/|$)/);
    }
    expect((await request(app).get('/demo-dashboard').expect(200)).text).toBe(expectedShell);
  });

  test('paid Command Center uses real tenant projections and exposes no simulation language or controls', async () => {
    const paid = read('public/dashboard/command-center.html');
    expect(paid).toContain('/js/command-center-contract.js');
    expect(paid).toContain('PolarisApi.getDashboard');
    expect(paid).toContain('processes real tenant interactions');
    expect(paid).not.toMatch(/Simulate Lead|ccSim|SIM_SESSION|northstarSessionId|sessionStorage|simulator\.js|scenario|reset demo|\/api\/v1\/simulations\/leads/i);

    const route = read('src/routes/commandCenter.js');
    expect(route).toContain("router.get('/workspace'");
    expect(route).toContain("router.get('/polaris/:kind/:id'");
    expect(route).not.toMatch(/router\.(?:post|put|patch|delete)\(/);

    const context = paidRequestContext({
      tenantContext: { organizationId: 'tenant-a', userId: 'user-a' },
      get(name) { return name === 'X-NorthStar-Session-ID' ? 'simulation-session' : undefined; },
    });
    expect(context).toEqual(expect.objectContaining({
      organizationId: 'tenant-a',
      userId: 'user-a',
      sessionId: 'paid-command-center',
      explicitSession: null,
    }));

    const item = {
      ids: { graph: 'graph-a', opportunity: 'lead-a', appointment: 'work-a', polarisSnapshot: 'polaris-a' },
      source: { type: 'retell', version: 1 },
      customer: { id: 'customer-a', name: 'Customer A' },
      opportunity: { id: 'lead-a', status: 'new' },
      communication: { id: 'communication-a' },
      transcript: { id: 'transcript-a', text: 'Canonical tenant transcript.' },
      appointment: { id: 'work-a', status: 'scheduled' },
      estimate: { id: 'estimate-a', currency: 'USD', customerPrice: 100 },
      calculationVersion: 'test-v1',
      snapshotDigest: 'a'.repeat(64),
      snapshot: { service: { label: 'Service' } },
      facts: [],
      timestamps: {},
      projectionDigest: 'b'.repeat(64),
    };
    const paidWorkspace = buildPaidWorkspace({
      context: { organizationId: 'tenant-a' },
      items: [item],
    });
    expect(paidWorkspace.capabilities).toEqual({ realTenantData: true });
    expect(JSON.stringify(paidWorkspace)).not.toMatch(/simulate|scenario|reset/i);
    expect(() => buildPaidWorkspace({
      context: { organizationId: 'tenant-a' },
      items: [{ ...item, source: { type: 'simulation', version: 1 } }],
    })).toThrow('requires real tenant projections');

    const retiredLegacy = await request(app).get('/dashboard/legacy').redirects(0).expect(301);
    expect(retiredLegacy.headers.location).toBe('/dashboard');
  });

  test('the account-free shell alone owns explicit bounded demo controls and safe rendering', () => {
    const html = read('public/demo-dashboard.html');
    const client = read('public/js/demo-command-center.js');
    expect(html).toContain('Fictional data · account-free');
    expect(html).toContain('id="demoSimulateLead"');
    expect(html).toContain('id="demoReset"');
    expect(html).toContain('No customer, provider, production, account, or billing data is used');
    expect(html).not.toMatch(/auth-session\.js|nav-component\.js|NorthStarAccountSession/);
    expect(client).toContain('/api/demo/command-center/simulations/leads');
    expect(client).toContain("'X-NorthStar-Demo-Intent': intent");
    expect(client).toContain('contract.validateWorkspace');
    expect(client).not.toMatch(/\.innerHTML\s*=|insertAdjacentHTML|document\.write|eval\s*\(/);
    expect(read('src/routes/demo.js')).toContain('secure: config.auth.secureCookies');
    for (const destination of contract.ROUTES) {
      const key = destination.id.includes('-') ? `'${destination.id}'` : destination.id;
      expect(client).toContain(`${key}: render`);
    }
  });

  test('one canonical demo state updates meaningful surfaces while configuration remains stable', () => {
    const tenantId = tenantIdFromTokenHash(TOKEN_HASH);
    const createdAt = new Date('2026-08-15T20:00:00.000Z');
    const initial = createInitialDemoState(tenantId, createdAt);
    const graph = buildSimulatedGraph({
      tenantId,
      key: 'ratification-simulation',
      serviceKey: 'fence',
      createdAt: new Date('2026-08-15T20:01:00.000Z'),
    });
    const before = buildDemoWorkspace({
      tenantId,
      sessionId: '00000000-0000-4000-8000-000000000001',
      state: initial,
      revision: 1,
      simulationCount: 0,
      persisted: false,
      expiresAt: new Date('2026-08-16T20:00:00.000Z'),
    });
    const after = buildDemoWorkspace({
      tenantId,
      sessionId: '00000000-0000-4000-8000-000000000001',
      state: { ...initial, graphs: [graph, ...initial.graphs] },
      revision: 2,
      simulationCount: 1,
      persisted: true,
      expiresAt: new Date('2026-08-16T20:00:00.000Z'),
    });

    expect(after.graphs).toHaveLength(before.graphs.length + 1);
    expect(after.integrity.digest).not.toBe(before.integrity.digest);
    expect(after.configuration).toEqual(before.configuration);
    expect(after.navigation).toEqual(before.navigation);
    expect(graph.ids).toEqual(expect.objectContaining({ customer: expect.any(String), lead: expect.any(String), work: expect.any(String) }));
    expect(graph.polaris).toEqual(expect.objectContaining({ completeDetail: true, snapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/) }));
    expect(graph.polaris.snapshot).toEqual(expect.objectContaining({
      confidence: expect.any(Object),
      recommendedActions: expect.any(Array),
      reasoning: expect.any(Array),
      notCalculated: expect.any(Array),
    }));
  });

  test('accepted readiness, integration, branding, and map-preference language is reused without readiness invention', () => {
    const configuration = demoConfiguration();
    expect(configuration.businessProfile.readiness.guidance).toContain('complete, accurate, and up-to-date Business Profile');
    expect(configuration.businessProfile.readiness.separation).toContain('separate from integration status');
    expect(configuration.integrations.authority).toBe('northstar_integration_catalogue_v1');
    expect(configuration.integrations.readOnly).toBe(true);
    expect(configuration.integrations.categories.flatMap(category => category.providers).map(provider => provider.name))
      .toEqual(expect.arrayContaining(['Retell', 'NorthStar Voice', 'Stripe', 'Jobber', 'Google Maps', 'Apple Maps', 'Waze']));
    expect(configuration.integrations.categories.flatMap(category => category.providers).every(provider =>
      provider.capabilities.authorization === 'unavailable' && provider.capabilities.sync === 'unavailable')).toBe(true);
    expect(configuration.settings.maps.providers.map(provider => provider.name)).toEqual(['Google Maps', 'Apple Maps', 'Waze']);
    expect(configuration.settings.maps.note).toContain('preferences only');
  });

  test('the additive migration binds only token digests to bounded fictional sessions', () => {
    const migration = read('migrations/022_demo_command_center_sessions.sql');
    expect(migration).toContain('CREATE TABLE demo_command_center_sessions');
    expect(migration).toContain('token_hash CHAR(64) NOT NULL UNIQUE');
    expect(migration).toContain('simulation_count BETWEEN 0 AND 12');
    expect(migration).toContain('mutation_count BETWEEN 0 AND 24');
    expect(migration).toContain("expires_at <= created_at + INTERVAL '24 hours'");
    expect(migration).toContain('octet_length(state::text) <= 524288');
    expect(migration).toContain('CREATE TABLE demo_command_center_mutations');
    expect(migration).toContain('CREATE TABLE demo_command_center_admission_windows');
    expect(migration).toContain("CHECK (scope IN ('source', 'global'))");
    expect(migration).toContain("subject_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain('request_digest CHAR(64) NOT NULL');
    expect(migration).not.toMatch(/password|email|phone|credential|provider_token|production_data/i);
    const repository = read('src/commandCenter/demoRepository.js');
    expect(repository).toContain('pg_advisory_xact_lock');
    expect(repository).toContain('MAX_ACTIVE_SESSIONS = 4096');
    expect(repository).toContain('DemoCommandCenterHousekeepingWorker');
    const server = read('src/server.js');
    expect(server).toContain('productionDemoHousekeepingWorker.start()');
    expect(server).toContain('productionDemoHousekeepingWorker.stop()');
  });
});
