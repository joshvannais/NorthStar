'use strict';

const { buildSimulatedGraph } = require('../../src/commandCenter/workspace');
const { createInitialDemoState } = require('../../src/commandCenter/workspace');
const { validateDemoGraphAgainstWorkspace } = require('../../src/commandCenter/demoWorkspaceGenerator');
const { repairKnownTreeServiceIdentity } = require('../../src/commandCenter/demoRepository');
const { sha256 } = require('../../src/services/businessProfileAdapter');

const TENANT = '11111111-1111-4111-8111-111111111111';

function graph(intent, index) {
  return buildSimulatedGraph({
    tenantId: TENANT,
    key: `tree-intelligence-${index}`,
    createdAt: new Date('2032-03-18T14:00:00.000Z'),
    scenarioSelection: {
      business: 'owner_operator',
      service: 'tree',
      intent,
      urgency: intent === 'tree_storm' ? 'safety_emergency' : 'planning',
      context: 'new_customer',
      scheduling: 'flexible',
      outcome: 'needs_information',
    },
  });
}

describe('fictional tree estimate intelligence', () => {
  test('uses scenario scope and the simulated tree business instead of a fixed placeholder', () => {
    const values = ['tree_removal', 'tree_pruning', 'tree_stump', 'tree_storm', 'tree_hauling', 'tree_visit']
      .map(graph);
    expect(new Set(values.map(value => value.estimate.customerPrice)).size).toBe(values.length);
    for (const value of values) {
      const snapshot = value.polaris.snapshot;
      expect(value.estimate.customerPrice).not.toBe(1000);
      expect(snapshot.knownDirectCosts).not.toBeNull();
      expect(snapshot.netProfit).not.toBeNull();
      expect(snapshot.service.scope.estimateBasis).toMatch(/job;/);
      expect(snapshot.service.scope.crewProfile).toBeTruthy();
      expect(snapshot.service.scope.equipmentName).toBeTruthy();
      expect(value.polaris.syntheticCalculation.details.profile).toBe(snapshot.service.scope.crewProfile);
      expect(value.communication.transcript.some(turn => /How many trees or debris groups/.test(turn.text))).toBe(true);
      expect(value.communication.transcript.some(turn => /access for trucks and equipment/.test(turn.text))).toBe(true);
    }
  });

  test('persists a simulated tree lead under the workspace service authority', () => {
    const state = createInitialDemoState(TENANT, new Date('2032-03-18T14:00:00.000Z'), { seed: 'tree-persistence-boundary' });
    const value = buildSimulatedGraph({
      tenantId: state.workspace.tenant.id,
      workspace: state.workspace,
      key: 'tree-persistence-boundary-lead',
      createdAt: new Date('2032-03-18T15:00:00.000Z'),
      scenarioSelection: {
        business: 'growing_residential', service: 'tree', intent: 'tree_removal', urgency: 'this_week',
        context: 'new_customer', scheduling: 'flexible', outcome: 'estimate_ready',
      },
    });
    expect(value.polaris.snapshot.service.label).toBe(value.lead.serviceLabel);
    expect(() => validateDemoGraphAgainstWorkspace(value, state.workspace)).not.toThrow();
  });

  test('repairs only the released tree operation-label mismatch', () => {
    const state = createInitialDemoState(TENANT, new Date('2032-03-18T14:00:00.000Z'), { seed: 'tree-repair-boundary' });
    const value = buildSimulatedGraph({
      tenantId: state.workspace.tenant.id,
      workspace: state.workspace,
      key: 'tree-repair-boundary-lead',
      createdAt: new Date('2032-03-18T15:00:00.000Z'),
      scenarioSelection: {
        business: 'growing_residential', service: 'tree', intent: 'tree_removal', urgency: 'this_week',
        context: 'new_customer', scheduling: 'flexible', outcome: 'estimate_ready',
      },
    });
    const releasedState = JSON.parse(JSON.stringify({ ...state, graphs: [value, ...state.graphs] }));
    const releasedGraph = releasedState.graphs[0];
    releasedGraph.polaris.snapshot.service.label = 'Tree removal';
    releasedGraph.polaris.syntheticCalculation.input.businessProfile.services[0].name = 'Tree removal';
    releasedGraph.polaris.snapshotDigest = sha256(releasedGraph.polaris.snapshot);
    delete releasedGraph.projectionDigest;
    releasedGraph.projectionDigest = sha256(releasedGraph);

    const repaired = repairKnownTreeServiceIdentity(releasedState);
    expect(repaired.graphs[0].polaris.snapshot.service.label).toBe('Tree service');
    expect(repaired.graphs[0].polaris.syntheticCalculation.input.businessProfile.services[0].name).toBe('Tree service');
    expect(() => validateDemoGraphAgainstWorkspace(repaired.graphs[0], repaired.workspace)).not.toThrow();

    const unrelated = JSON.parse(JSON.stringify(releasedState));
    unrelated.graphs[0].polaris.snapshot.service.label = 'Unrecognized service';
    unrelated.graphs[0].polaris.syntheticCalculation.input.businessProfile.services[0].name = 'Unrecognized service';
    expect(repairKnownTreeServiceIdentity(unrelated)).toBeNull();
  });
});
