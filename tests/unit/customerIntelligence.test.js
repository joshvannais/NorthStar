'use strict';

const {
  generateExecutiveSummary,
  calculateOpportunityScore,
  calculateRiskScore,
  generateRecommendedActions,
  generateCustomerTimeline,
  generateCustomerSnapshot,
  generateAllCustomerSnapshots,
  generateDashboardCustomerIntelligence,
} = require('../../src/services/customerIntelligence');

const intelligence = require('../../src/services/intelligence');
const decisionEngine = require('../../src/services/decisionEngine');

// ====================================================================
// Helpers
// ====================================================================

function makeLead(overrides = {}) {
  return {
    id: 'test-lead-001',
    caller: 'Jane Smith',
    phone: '555-0200',
    address: '456 Oak Ave',
    service: 'Roof Repair',
    icon: '🏠',
    avgPrice: 8000,
    jobDetail: 'Leak repair, 200sqft',
    status: 'answered',
    outcome: 'appointment-set',
    receivedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function getIntelAndRanking(lead) {
  const intel = intelligence.calculateJobIntelligence(lead, { leadCount: 1 });
  const ranking = decisionEngine.rankOpportunity(lead, intel, { totalLeads: 1 });
  return { intel, ranking };
}

// ====================================================================
// generateExecutiveSummary
// ====================================================================

describe('generateExecutiveSummary', () => {
  test('full lead generates rich summary', () => {
    const lead = makeLead();
    const { intel, ranking } = getIntelAndRanking(lead);
    const action = decisionEngine.getNextBestAction(lead, ranking);
    const summary = generateExecutiveSummary(lead, intel, ranking, action);

    expect(summary).toContain('Jane Smith');
    expect(summary).toContain('Roof Repair');
    expect(summary).toContain('Recommended action');
    expect(summary).toContain('$');
  });

  test('null lead returns fallback', () => {
    expect(generateExecutiveSummary(null)).toBe('No customer data available.');
  });

  test('lead-captured outcome notes lack of contact', () => {
    const lead = makeLead({ outcome: 'lead-captured' });
    const { intel, ranking } = getIntelAndRanking(lead);
    const action = decisionEngine.getNextBestAction(lead, ranking);
    const summary = generateExecutiveSummary(lead, intel, ranking, action);
    expect(summary).toContain('Risk:');
  });
});

// ====================================================================
// calculateOpportunityScore
// ====================================================================

describe('calculateOpportunityScore', () => {
  test('high-value lead gets high score', () => {
    const lead = makeLead({ avgPrice: 12000 });
    const { intel, ranking } = getIntelAndRanking(lead);
    const score = calculateOpportunityScore(lead, intel, ranking);
    expect(score.score).toBeGreaterThan(0);
    expect(score.level).toBeDefined();
    expect(score.reasoning.length).toBeGreaterThan(0);
  });

  test('null lead returns unknown', () => {
    const score = calculateOpportunityScore(null, null, null);
    expect(score.score).toBe(0);
    expect(score.level).toBe('Unknown');
  });

  test('levels: Exceptional (85+), High (70+), Moderate (50+), Low (30+), Minimal (<30)', () => {
    const lead = makeLead({ avgPrice: 100, outcome: 'no-interest' });
    const { intel, ranking } = getIntelAndRanking(lead);
    const score = calculateOpportunityScore(lead, intel, ranking);
    expect(['Exceptional', 'High', 'Moderate', 'Low', 'Minimal']).toContain(score.level);
  });
});

// ====================================================================
// calculateRiskScore
// ====================================================================

describe('calculateRiskScore', () => {
  test('aging lead has elevated risk', () => {
    const lead = makeLead({
      outcome: 'lead-captured',
      receivedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const { intel, ranking } = getIntelAndRanking(lead);
    const risk = calculateRiskScore(lead, intel, ranking);
    expect(risk.score).toBeGreaterThan(30);
    expect(risk.level).toMatch(/^(Critical|High|Medium|Low)$/);
  });

  test('no-interest lead has high risk', () => {
    const lead = makeLead({ outcome: 'no-interest' });
    const { intel, ranking } = getIntelAndRanking(lead);
    const risk = calculateRiskScore(lead, intel, ranking);
    expect(risk.score).toBeGreaterThanOrEqual(40);
    expect(risk.reasons.some(r => r.includes('no interest'))).toBe(true);
  });

  test('null lead returns unknown', () => {
    const risk = calculateRiskScore(null);
    expect(risk.level).toBe('Unknown');
  });

  test('fresh appointment-set lead has low risk', () => {
    const lead = makeLead({
      outcome: 'appointment-set',
      receivedAt: new Date().toISOString(),
    });
    const { intel, ranking } = getIntelAndRanking(lead);
    const risk = calculateRiskScore(lead, intel, ranking);
    expect(risk.score).toBeLessThanOrEqual(20);
    expect(risk.level).toBe('Low');
  });
});

// ====================================================================
// generateRecommendedActions
// ====================================================================

describe('generateRecommendedActions', () => {
  test('returns ranked actions', () => {
    const lead = makeLead();
    const { intel, ranking } = getIntelAndRanking(lead);
    const action = decisionEngine.getNextBestAction(lead, ranking);
    const risk = { level: 'Low', score: 10, reasons: [], details: {} };
    const actions = generateRecommendedActions(lead, intel, ranking, action, risk);

    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].rank).toBe(1);
    expect(actions[0].action).toBeDefined();
    expect(actions[0].priority).toBeDefined();
  });

  test('null lead returns empty array', () => {
    expect(generateRecommendedActions(null)).toEqual([]);
  });

  test('high-value job includes upsell', () => {
    const lead = makeLead({ avgPrice: 15000 });
    const { intel, ranking } = getIntelAndRanking(lead);
    const action = decisionEngine.getNextBestAction(lead, ranking);
    const risk = { level: 'Low', score: 10, reasons: [], details: {} };
    const actions = generateRecommendedActions(lead, intel, ranking, action, risk);
    const upsellAction = actions.find(a => a.action.includes('upsell'));
    expect(upsellAction).toBeDefined();
  });

  test('max 7 recommendations', () => {
    const lead = makeLead({ avgPrice: 15000 });
    const { intel, ranking } = getIntelAndRanking(lead);
    const action = decisionEngine.getNextBestAction(lead, ranking);
    const risk = { level: 'Low', score: 10, reasons: [], details: {} };
    const actions = generateRecommendedActions(lead, intel, ranking, action, risk);
    expect(actions.length).toBeLessThanOrEqual(7);
  });
});

// ====================================================================
// generateCustomerTimeline
// ====================================================================

describe('generateCustomerTimeline', () => {
  test('generates timeline entries', () => {
    const lead = makeLead();
    const timeline = generateCustomerTimeline(lead);
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0].date).toBeDefined();
    expect(timeline[0].event).toBeDefined();
    expect(timeline[0].type).toBeDefined();
  });

  test('null lead returns empty', () => {
    expect(generateCustomerTimeline(null)).toEqual([]);
  });

  test('timeline sorted newest first', () => {
    const lead = makeLead({ receivedAt: '2025-01-01T00:00:00.000Z' });
    const timeline = generateCustomerTimeline(lead);
    for (let i = 1; i < timeline.length; i++) {
      expect(new Date(timeline[i - 1].date).getTime()).toBeGreaterThanOrEqual(
        new Date(timeline[i].date).getTime()
      );
    }
  });
});

// ====================================================================
// generateCustomerSnapshot
// ====================================================================

describe('generateCustomerSnapshot', () => {
  test('complete snapshot from valid lead', () => {
    const lead = makeLead();
    const snapshot = generateCustomerSnapshot(lead, { totalLeads: 1 });

    expect(snapshot.customerId).toBe('test-lead-001');
    expect(snapshot.name).toBe('Jane Smith');
    expect(snapshot.service).toBe('Roof Repair');
    expect(snapshot.executiveSummary).toBeDefined();
    expect(snapshot.opportunityScore).toBeGreaterThan(0);
    expect(snapshot.opportunityLevel).toBeDefined();
    expect(snapshot.riskLevel).toBeDefined();
    expect(snapshot.riskScore).toBeGreaterThanOrEqual(0);
    expect(snapshot.recommendedActions.length).toBeGreaterThan(0);
    expect(snapshot.timeline.length).toBeGreaterThan(0);
    expect(snapshot.snapshot.estimatedRevenue).toBe(8000);
    expect(snapshot.snapshot.estimatedProfit).toBeGreaterThan(0);
    expect(snapshot.priorityScore).toBeGreaterThan(0);
    expect(snapshot.nextBestAction).toBeDefined();
  });

  test('null lead returns error object', () => {
    const snapshot = generateCustomerSnapshot(null);
    expect(snapshot.name).toBe('Unknown');
    expect(snapshot.error).toBeDefined();
  });

  test('minimal lead data still works', () => {
    const lead = { id: 'min', caller: 'Min', service: 'General' };
    const snapshot = generateCustomerSnapshot(lead);
    expect(snapshot.name).toBe('Min');
    expect(snapshot.snapshot).toBeDefined();
  });
});

// ====================================================================
// generateAllCustomerSnapshots
// ====================================================================

describe('generateAllCustomerSnapshots', () => {
  test('returns sorted by priority descending', () => {
    const leads = [
      makeLead({ id: 'a', caller: 'A', avgPrice: 5000 }),
      makeLead({ id: 'b', caller: 'B', avgPrice: 12000 }),
    ];
    const snapshots = generateAllCustomerSnapshots(leads);
    expect(snapshots.length).toBe(2);
    expect(snapshots[0].priorityScore).toBeGreaterThanOrEqual(snapshots[1].priorityScore);
  });

  test('empty returns empty', () => {
    expect(generateAllCustomerSnapshots([])).toEqual([]);
  });

  test('null returns empty', () => {
    expect(generateAllCustomerSnapshots(null)).toEqual([]);
  });
});

// ====================================================================
// generateDashboardCustomerIntelligence
// ====================================================================

describe('generateDashboardCustomerIntelligence', () => {
  test('generates dashboard summaries', () => {
    const leads = [
      makeLead({ id: 'a', caller: 'A', outcome: 'follow-up', avgPrice: 5000 }),
      makeLead({ id: 'b', caller: 'B', outcome: 'appointment-set', avgPrice: 12000 }),
      makeLead({ id: 'c', caller: 'C', outcome: 'lead-captured', avgPrice: 2000 }),
    ];
    const dashboard = generateDashboardCustomerIntelligence(leads);
    expect(dashboard.highestOpportunity.length).toBeGreaterThan(0);
    expect(dashboard.highestRisk.length).toBeGreaterThan(0);
    expect(dashboard.highestProfit.length).toBeGreaterThan(0);
    expect(dashboard.bestFollowUps).toBeDefined();
  });

  test('empty leads returns empty arrays', () => {
    const dashboard = generateDashboardCustomerIntelligence([]);
    expect(dashboard.highestOpportunity).toEqual([]);
  });
});
