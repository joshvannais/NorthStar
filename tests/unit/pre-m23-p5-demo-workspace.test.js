'use strict';

const { sha256 } = require('../../src/services/businessProfileAdapter');
const {
  FIXTURE_CONTRACT,
  createDemoWorkspaceFixture,
  distanceMiles,
  validateDemoGraphAgainstWorkspace,
  validateDemoWorkspaceFixture,
} = require('../../src/commandCenter/demoWorkspaceGenerator');
const {
  buildDemoWorkspace,
  buildSimulatedGraph,
  createInitialDemoState,
} = require('../../src/commandCenter/workspace');
const {
  nextWorkspaceSeed,
  workspaceSeedForToken,
} = require('../../src/commandCenter/demoRepository');

const EXPLICIT_SEED = 'pre-m23-p5-browser-fixture-alpha';
const CREATED_AT = new Date('2026-08-30T14:00:00.000Z');
const SESSION_ID = '10000000-0000-4000-8000-000000000005';

const SCENARIO = Object.freeze({
  business: 'multi_crew',
  service: 'plumbing',
  intent: 'repair_request',
  urgency: 'within_24_hours',
  context: 'returning_customer',
  scheduling: 'weekday_afternoon',
  outcome: 'booked',
});

function allContacts(fixture) {
  return [fixture.company, ...fixture.team.members, ...fixture.customers];
}

describe('Pre-Mission 23 P5 deterministic fictional demo workspace', () => {
  test('one explicit seed produces one byte-stable fixture snapshot', () => {
    const first = createDemoWorkspaceFixture({ seed: EXPLICIT_SEED });
    const second = createDemoWorkspaceFixture({ seed: EXPLICIT_SEED });

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.contract).toBe(FIXTURE_CONTRACT);
    expect(sha256(first)).toBe('5fecb0df7b23388c0efef7229e3e8ae837674514fbb55a99a3089dc18ee65872');

    const other = createDemoWorkspaceFixture({ seed: 'pre-m23-p5-browser-fixture-beta' });
    expect(other.tenant.id).not.toBe(first.tenant.id);
    expect(other.company.name).not.toBe(first.company.name);
    expect(sha256(other)).not.toBe(sha256(first));
  });

  test('generated identity, territory, team, customers, jobs, and schedule are coherent and reserved', () => {
    for (let index = 0; index < 128; index += 1) {
      const fixture = createDemoWorkspaceFixture({ seed: 'property-seed-' + String(index) });
      expect(() => validateDemoWorkspaceFixture(fixture)).not.toThrow();
      expect(fixture.company.timeZone).toBe(fixture.territory.timeZone);
      expect(fixture.company.serviceRadiusMiles).toBe(fixture.territory.radiusMiles);
      expect(fixture.services.every(service =>
        service.industryCompatibility === 'residential_home_services')).toBe(true);
      expect(fixture.services.map(service => service.key)).toEqual(expect.arrayContaining(
        fixture.jobs.map(job => job.serviceKey)
      ));

      for (const contact of allContacts(fixture)) {
        expect(contact.email).toMatch(/^[a-z0-9.-]+@example\.com$/);
        expect(contact.phone).toMatch(/^\([2-9][0-9]{2}\) 555-01[0-9]{2}$/);
      }
      for (const customer of fixture.customers) {
        expect(customer.address.formatted).toContain('Example');
        expect(customer.address.postalCode).toBe('00000');
        expect(customer.address.fictional).toBe(true);
        expect(customer.address.timeZone).toBe(fixture.territory.timeZone);
        expect(distanceMiles(fixture.territory.center, customer.address.coordinates))
          .toBeLessThanOrEqual(fixture.territory.radiusMiles);
      }
      for (const job of fixture.jobs) {
        expect(fixture.customers.some(customer => customer.id === job.customerId)).toBe(true);
        expect(fixture.team.members.some(member => member.id === job.assignedMemberId)).toBe(true);
        expect(job.timeZone).toBe(fixture.territory.timeZone);
        expect(Number.isFinite(Date.parse(job.scheduledStart))).toBe(true);
      }
    }
  });

  test('initial graphs and every projected route consume the same seeded workspace authority', () => {
    const first = createInitialDemoState('container-a', CREATED_AT, { seed: EXPLICIT_SEED });
    const second = createInitialDemoState('container-b', CREATED_AT, { seed: EXPLICIT_SEED });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    const workspace = buildDemoWorkspace({
      tenantId: 'container-a',
      sessionId: SESSION_ID,
      state: first,
      revision: 1,
      simulationCount: 0,
      persisted: false,
      expiresAt: new Date('2026-08-31T14:00:00.000Z'),
    });

    expect(workspace.tenant).toEqual(first.workspace.tenant);
    expect(workspace.configuration.businessProfile.company).toBe(first.workspace.company.name);
    expect(workspace.configuration.businessProfile.timeZone).toBe(first.workspace.territory.timeZone);
    expect(workspace.configuration.workforce.members).toEqual(first.workspace.team.members);
    expect(workspace.graphs).toHaveLength(first.workspace.jobs.length);
    for (const graph of workspace.graphs) {
      expect(graph.businessProfile.company).toBe(workspace.tenant.name);
      expect(graph.customer.location.timeZone).toBe(workspace.configuration.businessProfile.timeZone);
      expect(graph.customer.location.withinServiceRadius).toBe(true);
      expect(graph.work.timeZone).toBe(workspace.configuration.businessProfile.timeZone);
    }
    expect(JSON.stringify(workspace)).not.toContain(first.seed);
  });

  test('manual scenario choices add a lead without replacing the active seeded tenant', () => {
    const state = createInitialDemoState('container-a', CREATED_AT, { seed: EXPLICIT_SEED });
    const graph = buildSimulatedGraph({
      tenantId: state.workspace.tenant.id,
      workspace: state.workspace,
      key: 'session-lead-2-599258397429',
      scenarioSelection: SCENARIO,
      createdAt: new Date('2026-08-30T14:05:00.000Z'),
    });
    const workspace = buildDemoWorkspace({
      tenantId: 'container-a',
      sessionId: SESSION_ID,
      state: { ...state, graphs: [graph, ...state.graphs] },
      revision: 2,
      simulationCount: 1,
      persisted: true,
      expiresAt: new Date('2026-08-31T14:00:00.000Z'),
    });

    expect(graph.scenario.selection).toEqual(SCENARIO);
    expect(graph.businessProfile.company).toBe(state.workspace.company.name);
    expect(workspace.tenant.id).toBe(state.workspace.tenant.id);
    expect(workspace.tenant.name).toBe(state.workspace.company.name);
    expect(workspace.configuration.businessProfile).toEqual(state.workspace.businessProfile);
    expect(graph.customer.location.withinServiceRadius).toBe(true);
    expect(graph.lead.serviceType).toBe('plumbing');
    expect(() => validateDemoGraphAgainstWorkspace(graph, state.workspace)).not.toThrow();
  });

  test('admission and reset seeds are session-bound, deterministic, and independent of module-global state', () => {
    const firstTokenSeed = workspaceSeedForToken('a'.repeat(64));
    const secondTokenSeed = workspaceSeedForToken('b'.repeat(64));
    expect(firstTokenSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(secondTokenSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(firstTokenSeed).not.toBe(secondTokenSeed);
    expect(workspaceSeedForToken('a'.repeat(64))).toBe(firstTokenSeed);

    const firstState = createInitialDemoState('container-a', CREATED_AT, { seed: firstTokenSeed });
    const resetKey = sha256('explicit-reset-idempotency-key');
    const resetSeed = nextWorkspaceSeed(firstState, resetKey);
    expect(nextWorkspaceSeed(firstState, resetKey)).toBe(resetSeed);
    expect(resetSeed).not.toBe(firstState.seed);

    const resetState = createInitialDemoState('container-a', CREATED_AT, {
      seed: resetSeed,
      generation: firstState.generation + 1,
    });
    expect(resetState.workspace.tenant.id).not.toBe(firstState.workspace.tenant.id);
    expect(resetState.generation).toBe(2);
    expect(createInitialDemoState('container-a', CREATED_AT, {
      seed: resetSeed,
      generation: 2,
    })).toEqual(resetState);
  });
});
