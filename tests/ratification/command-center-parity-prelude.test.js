'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const request = require('supertest');
const { app } = require('../../src/server');
const contract = require('../../public/js/command-center-contract');
const permissions = require('../../src/auth/permissions');
const { paidRequestContext } = require('../../src/routes/commandCenter');
const { sha256 } = require('../../src/services/businessProfileAdapter');
const scenarioSpace = require('../../src/commandCenter/scenarioSpace');
const {
  buildDemoWorkspace,
  buildPaidWorkspace,
  buildSimulatedGraph,
  createInitialDemoState,
  demoCanonicalItems,
  demoConfiguration,
  tenantIdFromTokenHash,
} = require('../../src/commandCenter/workspace');

const ROOT = path.resolve(__dirname, '..', '..');
const TOKEN_HASH = 'a'.repeat(64);
const POLARIS_PLACEMENT_ALLOWLIST = Object.freeze(['command-center', 'leads', 'communications']);
const PAGE_BY_ROUTE = Object.freeze({
  'command-center': 'public/demo-dashboard.html',
  polaris: 'public/dashboard/polaris.html',
  leads: 'public/dashboard/leads.html',
  communications: 'public/dashboard/communications.html',
  calendar: 'public/dashboard/calendar.html',
  team: 'public/dashboard/team.html',
  'business-profile': 'public/dashboard/business-profile.html',
  settings: 'public/dashboard/settings.html',
  integrations: 'public/dashboard/integrations.html',
});

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function surfaceProjector(search = '') {
  const window = {
    location: { pathname: '/demo/polaris', search },
    NorthStarPolarisCard: { CONTRACT: 'northstar_polaris_intelligence_card_v1' },
  };
  const document = { readyState: 'loading', addEventListener: jest.fn() };
  vm.runInNewContext(read('public/js/polaris-surface-card.js'), {
    window, document, URLSearchParams, Intl, Date, Number, Promise,
    encodeURIComponent, decodeURIComponent,
  });
  return window.NorthStarPolarisSurface;
}

function cardRenderer() {
  function Element(tag) {
    this.tagName = tag;
    this.children = [];
    this.childNodes = this.children;
    this.className = '';
    this.dataset = {};
    this.textContent = '';
    this.classList = { add: (...values) => { this.className += ' ' + values.join(' '); } };
  }
  Element.prototype.appendChild = function appendChild(child) {
    this.children.push(child);
    return child;
  };
  Element.prototype.append = function append(...children) {
    children.forEach(child => this.appendChild(child));
  };
  Element.prototype.replaceChildren = function replaceChildren(...children) {
    this.children.length = 0;
    this.append(...children);
  };
  Element.prototype.setAttribute = function setAttribute(name, value) {
    this[name] = String(value);
  };
  const document = { createElement: tag => new Element(tag) };
  const window = {};
  vm.runInNewContext(read('public/js/polaris-card.js'), { window, document, Number });
  return { card: window.NorthStarPolarisCard, createElement: document.createElement };
}

function renderedText(node) {
  return [node.textContent, ...(node.children || []).map(renderedText)].filter(Boolean).join(' ');
}

describe('Demo/Paid Command Center Parity Prelude contracts', () => {
  test('nine shared routes retain demo parity while paid navigation adds signed-in Today only', async () => {
    expect(contract.ROUTES).toHaveLength(9);
    expect(contract.PAID_ROUTES).toHaveLength(10);
    expect(contract.PAID_ROUTES.map(route => route.id)).toEqual(permissions.NAVIGATION_DESTINATIONS.map(route => route.id));
    expect(contract.PAID_ROUTES.map(route => route.paidPath)).toEqual(permissions.NAVIGATION_DESTINATIONS.map(route => route.href));
    expect(contract.TODAY_ROUTE.demoPath).toBeNull();
    expect(new Set(contract.ROUTES.map(route => route.demoPath)).size).toBe(9);
    expect(contract.routeForPath('/demo-dashboard').id).toBe('command-center');

    for (const destination of contract.ROUTES) {
      const response = await request(app).get(destination.demoPath).expect(200);
      expect(response.text).toBe(read(PAGE_BY_ROUTE[destination.id]));
      expect(response.text).toContain('/js/demo-runtime.js');
      expect(response.text).toContain('/js/nav-component.js');
      if (POLARIS_PLACEMENT_ALLOWLIST.includes(destination.id)) {
        expect(response.text).toContain('/css/polaris-card.css');
        expect(response.text).toContain('/js/polaris-card.js');
      } else {
        expect(response.text).not.toContain('/css/polaris-card.css');
        expect(response.text).not.toContain('/js/polaris-card.js');
        expect(response.text).not.toContain('/js/polaris-surface-card.js');
      }
      if (POLARIS_PLACEMENT_ALLOWLIST.includes(destination.id) && destination.id !== 'command-center') {
        expect(response.text).toContain('/js/polaris-surface-card.js');
      }
      expect(destination.demoPath).toMatch(/^\/demo(?:\/|$)/);
    }
    const legacy = await request(app).get('/demo-dashboard').expect(301);
    expect(legacy.headers.location).toBe('/demo');
    expect((await request(app).get('/demo').expect(200)).text)
      .toBe(read(PAGE_BY_ROUTE['command-center']));

    const leadsPage = read(PAGE_BY_ROUTE.leads);
    expect(leadsPage).not.toContain('id="polarisCard"');
    expect(leadsPage).not.toContain('Not calculated');
  });

  test('paid Command Center uses real tenant projections and exposes no simulation language or controls', async () => {
    const paid = read('public/demo-dashboard.html');
    const pageClient = read('public/js/command-center-page.js');
    expect(paid).toContain('/js/command-center-contract.js');
    expect(paid).toContain('/js/command-center-page.js');
    expect(paid).toContain('demo-dashboard-priority-grid');
    expect(paid).toContain('demo-dashboard-analytics-grid');
    expect(paid).toContain('demo-leads-panel');
    expect(pageClient).toContain("'/api/v1/command-center/workspace'");
    expect(pageClient).toContain("demo ? 'Demo Data' : 'Workspace Data'");
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

  test('one shared demo runtime adapts established page modules without a generic renderer', () => {
    const client = read('public/js/demo-runtime.js');
    const server = read('src/server.js');
    expect(client).toContain("section.id = 'northstarDemoToolbar'");
    expect(client).toContain("simulate.id = 'demoSimulateLead'");
    expect(client).toContain("reset.id = 'demoReset'");
    expect(client).toContain('/api/demo/command-center/simulations/leads');
    expect(client).toContain('scenario: selected');
    expect(client).toContain('scenarioSpace.dimensions.forEach');
    expect(client).toContain("var SCENARIO_PREFERENCES_KEY = 'northstarDemoScenarioPreferences'");
    expect(client).toContain("var RETURN_TO_TOOLBAR_KEY = 'northstarDemoReturnToToolbar'");
    expect(client).toContain("stored.sessionId !== value.session.id");
    expect(client).toContain("definition.id === rememberedValue");
    expect(client).toContain("global.history.scrollRestoration = 'manual'");
    expect(client).toContain("global.scrollTo({ top: 0, left: 0, behavior: 'auto' })");
    expect(client).toContain("'X-NorthStar-Demo-Intent': intent");
    expect(client).not.toMatch(/\.innerHTML\s*=|insertAdjacentHTML|document\.write|eval\s*\(/);
    expect(client).not.toContain('northstarDemoPolarisDetail');
    const polaris = read('public/dashboard/polaris.html');
    expect(polaris).toContain('function respondToAccountFreeDemoChat(message)');
    expect(polaris).toContain('function demoPolarisResponse(message)');
    expect(polaris).toContain('no live provider request was sent.');
    expect(polaris).toContain('NorthStarDemoRuntime.getWorkspace()');
    expect(server).toContain("'command-center': 'public/demo-dashboard.html'");
    expect(server).toContain("'/dashboard': 'public/demo-dashboard.html'");
    expect(server).toContain("integrations: 'public/dashboard/integrations.html'");
    expect(server).not.toContain("pages[destination.demoPath] = 'public/demo-dashboard.html'");
    expect(read('src/routes/demo.js')).toContain('secure: config.auth.secureCookies');
    for (const destination of contract.ROUTES) {
      const html = read(PAGE_BY_ROUTE[destination.id]);
      expect(html).toContain('/js/demo-runtime.js');
      expect(html).toMatch(new RegExp(`NavComponent\\.init\\(['"]${destination.id}['"]\\)`));
    }
  });

  test('one shared Polaris projection contract is page-specific, human-readable, and fail-closed', () => {
    const tenantId = tenantIdFromTokenHash('c'.repeat(64));
    const createdAt = new Date('2026-08-16T12:00:00.000Z');
    const initial = createInitialDemoState(tenantId, createdAt);
    const scenarioSelection = {
      business: 'multi_crew', service: 'electrical', intent: 'inspection',
      urgency: 'safety_emergency', context: 'property_manager',
      scheduling: 'after_hours', outcome: 'booked',
    };
    const added = buildSimulatedGraph({
      tenantId,
      key: 'polaris-surface-ratification',
      scenarioSelection,
      createdAt: new Date('2026-08-16T12:01:00.000Z'),
    });
    const workspace = buildDemoWorkspace({
      tenantId,
      sessionId: '00000000-0000-4000-8000-000000000011',
      state: { ...initial, graphs: [added, ...initial.graphs] },
      revision: 2,
      simulationCount: 1,
      persisted: true,
      expiresAt: new Date('2026-08-17T12:00:00.000Z'),
    });
    const configuration = workspace.configuration;
    const supplements = {
      team: { members: configuration.workforce.members },
      'business-profile': {
        itemOrder: ['dispatch', 'guidance'],
        items: {
          dispatch: { label: 'Dispatch origin', state: 'reviewed' },
          guidance: { label: 'Customer guidance', state: 'needs_review', help: 'Confirm customer guidance before dispatch.' },
        },
      },
      settings: {
        emailEnabled: true, emailCallSummary: true, emailAppointment: true,
        smsEnabled: true, smsUrgent: true, smartRouting: true,
        securityEmailMandatory: true, securityEmailAddress: 'demo@northstar.invalid',
      },
      integrations: configuration.integrations,
    };
    const projector = surfaceProjector();
    const surfaces = contract.ROUTES.slice(1).map(route => route.id);
    const projections = surfaces.map(surface => projector.project(surface, workspace, supplements[surface] || null));

    expect(new Set(projections.map(projection => projection.title)).size).toBe(surfaces.length);
    projections.forEach((projection, index) => {
      expect(projection).toEqual(expect.objectContaining({
        projectionContract: 'northstar_polaris_surface_projection_v1',
        contract: 'northstar_polaris_intelligence_card_v1',
        surface: surfaces[index],
        title: expect.any(String),
        summary: expect.any(String),
        confidenceExplanation: expect.any(String),
        evidence: expect.any(Array),
        missing: expect.any(Array),
        risks: expect.any(Array),
        opportunities: expect.any(Array),
        recommendations: expect.any(Array),
        objects: expect.any(Array),
      }));
      expect(projection.detailed).toBe(['leads', 'polaris', 'communications'].includes(projection.surface));
      expect(projection.objects).toHaveLength(3);
      expect(projection.objects.map(entry => entry.href)).toEqual(expect.arrayContaining([
        expect.stringContaining(encodeURIComponent(added.ids.customer)),
        expect.stringContaining(encodeURIComponent(added.ids.lead)),
        expect.stringContaining(encodeURIComponent(added.ids.work)),
      ]));
      expect(JSON.stringify(projection)).not.toMatch(/\[object Object\]|Not calculated/);
    });

    const detailProjector = surfaceProjector('?kind=lead&id=' + encodeURIComponent(added.ids.lead));
    const detail = detailProjector.project('polaris', workspace, null);
    expect(detail.title).toContain(added.customer.name);
    expect(detail.summary).toBe(added.lead.summary);
    expect(detail.evidence.length).toBeGreaterThan(0);
    expect(detail.missing.some(item => item.includes('is unavailable:'))).toBe(true);

    const missingProjector = surfaceProjector('?kind=work&id=not-authorized');
    const unavailable = missingProjector.project('polaris', workspace, null);
    expect(unavailable.title).toBe('Requested Polaris detail is unavailable');
    expect(unavailable.objects).toEqual([]);
    expect(unavailable.summary).toContain('No fallback object is shown');
    expect(() => projector.project('leads', null, null)).toThrow('role-authorized workspace projection is unavailable');

    const paid = buildPaidWorkspace({
      context: { organizationId: 'paid-tenant-a' },
      items: [{
        ids: {
          graph: 'paid-graph', customer: 'paid-customer', opportunity: 'paid-lead',
          appointment: 'paid-work', polarisSnapshot: 'paid-polaris', estimate: 'paid-estimate',
          communication: 'paid-communication', transcript: 'paid-transcript', facts: ['paid-fact'],
        },
        source: { type: 'retell', version: 1 },
        customer: { id: 'paid-customer', name: 'Authorized Customer' },
        opportunity: { id: 'paid-lead', status: 'follow_up', serviceType: 'electrical', serviceLabel: 'Electrical service', summary: 'Inspection follow-up requires review.' },
        communication: { id: 'paid-communication', channel: 'voice', direction: 'inbound', subject: 'Inspection follow-up', intent: 'Inspection' },
        transcript: { id: 'paid-transcript', text: JSON.stringify([{ speaker: 'customer', text: 'Please review the inspection.' }]) },
        appointment: { id: 'paid-work', status: 'follow_up_due', scheduledStart: null, assignedTo: null },
        estimate: { id: 'paid-estimate', currency: 'USD', customerPrice: 4250, lineItems: [] },
        calculationVersion: 'paid-v1',
        snapshotDigest: 'd'.repeat(64),
        snapshot: {
          service: { key: 'electrical', label: 'Electrical service', supported: true, scope: {} },
          confidence: { score: 84 },
          risk: { emergency: false, signal: 'Follow-up due', evidence: 'The inspection follow-up remains open.' },
          missingInformation: ['Appointment timing is not recorded.'],
          recommendedActions: [{ label: 'Review the inspection follow-up.', priority: 'high' }],
        },
        facts: [{ id: 'paid-fact', evidenceText: 'The customer requested an inspection follow-up.' }],
        timestamps: { createdAt: createdAt.toISOString(), updatedAt: createdAt.toISOString() },
        projectionDigest: 'e'.repeat(64),
      }],
    });
    for (const surface of surfaces) {
      const paidProjection = projector.project(surface, paid, null);
      const demoProjection = projector.project(surface, workspace, supplements[surface] || null);
      expect(Object.keys(paidProjection).sort()).toEqual(Object.keys(demoProjection).sort());
      expect(paidProjection.surface).toBe(surface);
      expect(paidProjection.objects.every(entry => entry.href.startsWith('/dashboard/polaris?'))).toBe(true);
      expect(JSON.stringify(paidProjection)).not.toMatch(/fictional|simulate lead|demo session/i);
    }
    expect(projector.CARD_SURFACES).toEqual(['leads', 'polaris', 'communications']);
  });

  test('missing confidence remains explicitly unavailable instead of becoming a fabricated zero', () => {
    const renderer = cardRenderer();
    const container = renderer.createElement('section');
    const value = renderer.card.render(container, {
      contract: renderer.card.CONTRACT,
      surface: 'calendar',
      title: 'Scheduling intelligence',
      summary: 'No complete scheduling inputs are available.',
      confidence: null,
      confidenceExplanation: 'Confidence is unavailable because scheduling inputs are incomplete.',
      evidence: [], missing: [], risks: [], opportunities: [], recommendations: [], objects: [],
    });
    const text = renderedText(container);
    expect(value.confidence).toBeNull();
    expect(text).toContain('Confidence unavailable');
    expect(text).not.toContain('0% confidence');
  });

  test('Command Center numeric normalization preserves absence and legitimate recorded zero', () => {
    const script = read('public/js/command-center-page.js');
    const start = script.indexOf('function finiteNumber(value) {');
    const end = script.indexOf('function formatMoney', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const finiteNumber = vm.runInNewContext('(' + script.slice(start, end).trim() + ')', { Number });

    expect(finiteNumber(null)).toBeNull();
    expect(finiteNumber(undefined)).toBeNull();
    expect(finiteNumber('')).toBeNull();
    expect(finiteNumber(false)).toBeNull();
    expect(finiteNumber(0)).toBe(0);
    expect(finiteNumber('0')).toBe(0);
    expect(finiteNumber('4250.50')).toBe(4250.5);
  });

  test('the server-owned scenario builder exposes and materializes far more than 100 distinct paths', () => {
    expect(scenarioSpace.DIMENSION_ORDER).toEqual([
      'business', 'service', 'intent', 'urgency', 'context', 'scheduling', 'outcome',
    ]);
    expect(scenarioSpace.COMBINATION_COUNT).toBe(115200);
    expect(scenarioSpace.publicScenarioSpace()).toEqual(expect.objectContaining({
      contract: 'northstar_demo_scenario_space_v1',
      combinationCount: 115200,
      dimensions: expect.any(Array),
    }));

    const tenantId = tenantIdFromTokenHash('b'.repeat(64));
    const generated = [];
    let sequence = 0;
    for (const business of scenarioSpace.DIMENSIONS.business.options) {
      for (const service of scenarioSpace.DIMENSIONS.service.options) {
        for (const intent of scenarioSpace.DIMENSIONS.intent.options) {
          for (const urgency of scenarioSpace.DIMENSIONS.urgency.options) {
            const selection = {
              ...scenarioSpace.DEFAULT_SELECTION,
              business: business.id,
              service: service.id,
              intent: intent.id,
              urgency: urgency.id,
              context: scenarioSpace.DIMENSIONS.context.options[sequence % scenarioSpace.DIMENSIONS.context.options.length].id,
              scheduling: scenarioSpace.DIMENSIONS.scheduling.options[sequence % scenarioSpace.DIMENSIONS.scheduling.options.length].id,
              outcome: scenarioSpace.DIMENSIONS.outcome.options[sequence % scenarioSpace.DIMENSIONS.outcome.options.length].id,
            };
            sequence += 1;
            generated.push(buildSimulatedGraph({
              tenantId,
              key: 'scenario-diversity-' + String(sequence),
              scenarioSelection: selection,
              createdAt: new Date('2026-08-16T12:00:00.000Z'),
            }));
            if (generated.length === 120) break;
          }
          if (generated.length === 120) break;
        }
        if (generated.length === 120) break;
      }
      if (generated.length === 120) break;
    }

    expect(generated).toHaveLength(120);
    expect(new Set(generated.map(graph => graph.scenario.signature)).size).toBe(120);
    for (const graph of generated) {
      expect(graph.scenario.contract).toBe('northstar_demo_scenario_selection_v1');
      expect(graph.communication.transcript).toEqual(expect.arrayContaining([
        expect.objectContaining({ speaker: 'customer', text: expect.any(String) }),
      ]));
      expect(graph.polaris.facts.map(fact => fact.variable)).toEqual(expect.arrayContaining([
        'businessContext', 'callerIntent', 'urgency', 'customerContext',
        'schedulingConstraint', 'conversationOutcome', 'serviceRadiusMiles',
        'customerDistanceMiles', 'crewCount', 'pricingModel',
      ]));
      expect(graph.scenario.businessFactors).toEqual(expect.objectContaining({
        serviceRadiusMiles: expect.any(Number),
        customerDistanceMiles: expect.any(Number),
        crewCount: expect.any(Number),
        pricingModel: expect.any(String),
        withinServiceRadius: true,
      }));
      expect(graph.scenario.businessFactors.customerDistanceMiles)
        .toBeLessThanOrEqual(graph.scenario.businessFactors.serviceRadiusMiles);
      expect(graph.scenario.businessFactors.customerDistanceMiles).toBeGreaterThanOrEqual(1);
      expect(graph.lead).toEqual(expect.objectContaining({
        callerIntent: graph.scenario.labels.intent,
        urgency: graph.scenario.labels.urgency,
        outcome: graph.scenario.labels.outcome,
      }));
      expect(graph.work.schedulingConstraint).toBe(graph.scenario.labels.scheduling);
      expect(graph.polaris.snapshot).toEqual(expect.objectContaining({
        risk: expect.objectContaining({ emergency: expect.any(Boolean) }),
        missingInformation: expect.any(Array),
        recommendedActions: expect.any(Array),
      }));
    }
  });

  test('one canonical demo state updates meaningful surfaces and binds the selected business authority', () => {
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
    expect(before.tenant).toEqual(expect.objectContaining({
      name: 'Rivera Home Services', businessProfileKey: 'owner_operator',
    }));
    expect(after.tenant).toEqual(expect.objectContaining({
      name: 'Pine & Peak Residential', businessProfileKey: 'growing_residential',
    }));
    expect(after.configuration.businessProfile).toEqual(graph.businessProfile);
    expect(after.configuration.scenarioSpace).toEqual(before.configuration.scenarioSpace);
    expect(after.configuration.workforce).toEqual(before.configuration.workforce);
    expect(after.configuration.integrations).toEqual(before.configuration.integrations);
    expect(after.navigation).toEqual(before.navigation);
    expect(graph.ids).toEqual(expect.objectContaining({ customer: expect.any(String), lead: expect.any(String), work: expect.any(String) }));
    expect(graph.polaris).toEqual(expect.objectContaining({ completeDetail: true, snapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/) }));
    expect(graph.polaris.snapshot).toEqual(expect.objectContaining({
      contract: 'CanonicalPolarisOutput',
      confidence: expect.any(Object),
      grossProfit: null,
      netProfit: null,
      recommendedActions: expect.any(Array),
      reasoning: expect.any(Array),
      notCalculated: expect.any(Array),
    }));
    const canonical = demoCanonicalItems(after);
    expect(canonical).toHaveLength(after.graphs.length);
    expect(canonical[0]).toEqual(expect.objectContaining({
      readModelVersion: 'canonical-polaris-read-model-v1',
      ids: expect.objectContaining({
        graph: graph.ids.graph,
        transcript: expect.stringMatching(/^[0-9a-f-]{36}$/),
        facts: expect.any(Array),
      }),
      businessProfileAuthorityId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      projectionDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(canonical[0].businessProfileInputHash).toBe(sha256(graph.businessProfile));
  });

  test('every selectable business owns its demo profile and configuration facts never impersonate transcript evidence', () => {
    const tenantId = tenantIdFromTokenHash('d'.repeat(64));
    const createdAt = new Date('2026-08-16T12:00:00.000Z');
    const initial = createInitialDemoState(tenantId, createdAt);
    const authorityIds = new Set();

    for (const business of scenarioSpace.DIMENSIONS.business.options) {
      const scenarioSelection = { ...scenarioSpace.DEFAULT_SELECTION, business: business.id };
      const graph = buildSimulatedGraph({
        tenantId,
        key: 'business-authority-' + business.id,
        scenarioSelection,
        createdAt,
      });
      const workspace = buildDemoWorkspace({
        tenantId,
        sessionId: '00000000-0000-4000-8000-000000000021',
        state: { ...initial, graphs: [graph, ...initial.graphs] },
        revision: 2,
        simulationCount: 1,
        persisted: true,
        expiresAt: new Date('2026-08-17T12:00:00.000Z'),
      });
      const canonical = demoCanonicalItems(workspace)[0];
      const factsByVariable = new Map(graph.polaris.facts.map(fact => [fact.variable, fact]));
      const profileFactVariables = ['businessContext', 'serviceRadiusMiles', 'crewCount', 'pricingModel'];
      const transcriptFacts = graph.polaris.facts.filter(fact => fact.evidenceSource === 'transcript');

      expect(workspace.tenant).toEqual(expect.objectContaining({
        name: business.label,
        businessProfileKey: business.id,
      }));
      expect(workspace.configuration.businessProfile).toEqual(expect.objectContaining({
        businessKey: business.id,
        company: business.label,
        serviceRadiusMiles: business.material.serviceRadiusMiles,
        crewCount: business.material.crewCount,
        pricingModel: business.material.pricingModel,
      }));
      expect(graph.businessProfile).toEqual(workspace.configuration.businessProfile);
      expect(canonical.businessProfileInputHash).toBe(sha256(graph.businessProfile));
      expect(canonical.businessProfileAuthorityId).toMatch(/^[0-9a-f-]{36}$/);
      authorityIds.add(canonical.businessProfileAuthorityId);

      for (const variable of profileFactVariables) {
        expect(factsByVariable.get(variable)).toEqual(expect.objectContaining({
          evidenceSource: 'business_profile',
          speaker: 'system',
        }));
        expect(graph.polaris.snapshot.supportingTranscriptFactIds)
          .not.toContain(factsByVariable.get(variable).id);
      }
      expect(factsByVariable.get('customerDistanceMiles')).toEqual(expect.objectContaining({
        evidenceSource: 'calculation',
        speaker: 'system',
      }));
      expect(graph.polaris.snapshot.supportingTranscriptFactIds)
        .not.toContain(factsByVariable.get('customerDistanceMiles').id);
      expect(transcriptFacts.length).toBeGreaterThan(0);
      expect(transcriptFacts.every(fact => fact.speaker === 'customer')).toBe(true);
      expect(graph.polaris.snapshot.supportingTranscriptFactIds)
        .toEqual(transcriptFacts.map(fact => fact.id));
      expect(canonical.supportingTranscriptFactIds).toHaveLength(transcriptFacts.length);
    }

    expect(authorityIds.size).toBe(scenarioSpace.DIMENSIONS.business.options.length);
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
