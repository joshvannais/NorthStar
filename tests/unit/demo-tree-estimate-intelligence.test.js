'use strict';

const { buildSimulatedGraph } = require('../../src/commandCenter/workspace');

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
});
