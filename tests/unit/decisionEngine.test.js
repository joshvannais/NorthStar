'use strict';

const {
  rankOpportunity,
  rankAllOpportunities,
  getNextBestAction,
  generateExecutiveExplanation,
  generateDailyPriorities,
  generateExecutiveAlerts,
  generateExecutiveBriefing,
  PRIORITY_WEIGHTS,
  CLOSE_PROBABILITY_MAP,
  NEXT_BEST_ACTION_MAP,
} = require('../../src/services/decisionEngine');

// We need intelligence for rankings
const intelligence = require('../../src/services/intelligence');

// ====================================================================
// Helpers
// ====================================================================

function makeLead(overrides = {}) {
  return {
    id: 'test-lead-001',
    caller: 'John Doe',
    phone: '555-0100',
    address: '123 Main St',
    service: 'Window replacement',
    avgPrice: 5000,
    jobDetail: '5 windows',
    status: 'answered',
    outcome: 'appointment-set',
    receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
    ...overrides,
  };
}

function getIntel(lead) {
  return intelligence.calculateJobIntelligence(lead, { leadCount: 1 });
}

// ====================================================================
// Module 1: rankOpportunity
// ====================================================================

describe('rankOpportunity', () => {
  test('normal lead returns valid ranking', () => {
    const lead = makeLead();
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);

    expect(ranking).toBeDefined();
    expect(ranking.leadId).toBe('test-lead-001');
    expect(ranking.priorityScore).toBeGreaterThan(0);
    expect(ranking.priorityScore).toBeLessThanOrEqual(100);
    expect(ranking.priorityLabel).toMatch(/^(Critical|High|Medium|Low|Minimal)$/);
    expect(ranking.breakdown.profitScore).toBeDefined();
    expect(ranking.factors.estimatedProfit).toBeGreaterThan(0);
  });

  test('null lead returns null', () => {
    expect(rankOpportunity(null, {})).toBeNull();
  });

  test('null intel returns null', () => {
    expect(rankOpportunity(makeLead(), null)).toBeNull();
  });

  test('lead without receivedAt has 0 age urgency', () => {
    const lead = makeLead({ receivedAt: undefined });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    expect(ranking.breakdown.ageUrgencyScore).toBe(0);
  });

  test('very old lead gets 100 urgency', () => {
    const lead = makeLead({ receivedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    expect(ranking.breakdown.ageUrgencyScore).toBe(100);
  });

  test('fresh lead (< 1 day) has 0 urgency', () => {
    const lead = makeLead({ receivedAt: new Date().toISOString() });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    expect(ranking.breakdown.ageUrgencyScore).toBe(0);
  });

  test('no-interest outcome has low close probability', () => {
    const lead = makeLead({ outcome: 'no-interest' });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    expect(ranking.factors.closeProbRaw).toBe(0.05);
  });

  test('lead-captured outcome has 35% close prob', () => {
    const lead = makeLead({ outcome: 'lead-captured' });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    expect(ranking.factors.closeProbRaw).toBe(0.35);
  });
});

// ====================================================================
// PRIORITY_WEIGHTS
// ====================================================================

describe('PRIORITY_WEIGHTS', () => {
  test('sums to 1.0', () => {
    const sum = Object.values(PRIORITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
  });

  test('has all expected keys', () => {
    expect(PRIORITY_WEIGHTS.estimatedProfit).toBe(0.30);
    expect(PRIORITY_WEIGHTS.closeProbability).toBe(0.25);
    expect(PRIORITY_WEIGHTS.confidenceScore).toBe(0.15);
    expect(PRIORITY_WEIGHTS.leadAgeUrgency).toBe(0.10);
    expect(PRIORITY_WEIGHTS.travelEfficiency).toBe(0.10);
    expect(PRIORITY_WEIGHTS.productionTime).toBe(0.05);
    expect(PRIORITY_WEIGHTS.customerHistory).toBe(0.05);
  });
});

// ====================================================================
// URGENCY_THRESHOLDS
// ====================================================================

// URGENCY_THRESHOLDS is not exported — it's internal.
// The behavior is verified through rankOpportunity tests above.
// These constants are accessed indirectly via the ranking logic.
describe('URGENCY_THRESHOLDS (indirect verification)', () => {
  test('critical urgency triggers at 3+ days', () => {
    const lead = makeLead({
      receivedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    // At 5 days, urgency should be 100 (critical)
    expect(ranking.breakdown.ageUrgencyScore).toBe(100);
  });

  test('2 days = high urgency (75)', () => {
    const lead = makeLead({
      receivedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    expect(ranking.breakdown.ageUrgencyScore).toBe(75);
  });
});

// ====================================================================
// Module 2: getNextBestAction
// ====================================================================

describe('getNextBestAction', () => {
  test('appointment-set lead', () => {
    const lead = makeLead({ outcome: 'appointment-set' });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    const action = getNextBestAction(lead, ranking);
    expect(action.action).toContain('Confirm');
    expect(action.priority).toBe('high');
  });

  test('follow-up lead', () => {
    const lead = makeLead({ outcome: 'follow-up' });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    const action = getNextBestAction(lead, ranking);
    expect(action.action).toContain('follow up');
  });

  test('lead-captured lead', () => {
    const lead = makeLead({ outcome: 'lead-captured' });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    const action = getNextBestAction(lead, ranking);
    expect(action.action).toContain('Schedule');
  });

  test('no-interest lead', () => {
    const lead = makeLead({ outcome: 'no-interest' });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    const action = getNextBestAction(lead, ranking);
    expect(action.action).toContain('Archive');
  });

  test('null lead returns null', () => {
    expect(getNextBestAction(null, {})).toBeNull();
  });

  test('escalation level for critical priority', () => {
    const lead = makeLead({
      outcome: 'appointment-set',
      avgPrice: 15000,
      receivedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    const action = getNextBestAction(lead, ranking);
    expect(action.escalationLevel).toBeDefined();
  });
});

// ====================================================================
// Module 3: generateExecutiveExplanation
// ====================================================================

describe('generateExecutiveExplanation', () => {
  test('valid lead generates explanation', () => {
    const lead = makeLead();
    const intel = getIntel(lead);
    const ranking = rankOpportunity(lead, intel);
    const explanation = generateExecutiveExplanation(lead, ranking, intel);
    expect(explanation.explanation).toContain('John Doe');
    expect(explanation.bulletPoints.length).toBeGreaterThan(0);
    expect(explanation.businessImpact).toMatch(/^(Very High|High|Medium|Low)$/);
  });

  test('null lead returns insufficient data', () => {
    const explanation = generateExecutiveExplanation(null, null);
    expect(explanation.explanation).toContain('Insufficient data');
  });
});

// ====================================================================
// Module 4: rankAllOpportunities
// ====================================================================

describe('rankAllOpportunities', () => {
  test('normal leads ranked and sorted', () => {
    const leads = [
      makeLead({ id: 'a', caller: 'A', avgPrice: 5000, outcome: 'appointment-set' }),
      makeLead({ id: 'b', caller: 'B', avgPrice: 8000, outcome: 'follow-up' }),
      makeLead({ id: 'c', caller: 'C', avgPrice: 3000, outcome: 'lead-captured' }),
    ];
    const result = rankAllOpportunities(leads);
    expect(result.ranked.length).toBe(3);
    expect(result.topOpportunity).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.summary.totalRanked).toBe(3);
    // Sorted descending
    for (let i = 1; i < result.ranked.length; i++) {
      expect(result.ranked[i - 1].priorityScore).toBeGreaterThanOrEqual(result.ranked[i].priorityScore);
    }
  });

  test('empty leads returns null results', () => {
    const result = rankAllOpportunities([]);
    expect(result.ranked).toEqual([]);
    expect(result.topOpportunity).toBeNull();
    expect(result.summary).toBeNull();
  });

  test('null leads returns null results', () => {
    const result = rankAllOpportunities(null);
    expect(result.ranked).toEqual([]);
    expect(result.topOpportunity).toBeNull();
  });

  test('excludes no-interest outcomes', () => {
    const leads = [
      makeLead({ id: 'a', caller: 'A', outcome: 'no-interest' }),
      makeLead({ id: 'b', caller: 'B', outcome: 'appointment-set' }),
    ];
    const result = rankAllOpportunities(leads);
    expect(result.ranked.length).toBe(1);
    expect(result.ranked[0].caller).toBe('B');
  });

  test('single lead works', () => {
    const result = rankAllOpportunities([makeLead()]);
    expect(result.ranked.length).toBe(1);
  });
});

// ====================================================================
// Module 5: generateExecutiveBriefing
// ====================================================================

describe('generateExecutiveBriefing', () => {
  test('generates complete briefing', () => {
    const leads = [
      makeLead({ id: 'a', caller: 'A', avgPrice: 5000, outcome: 'appointment-set' }),
      makeLead({ id: 'b', caller: 'B', avgPrice: 8000, outcome: 'follow-up' }),
    ];
    const briefing = generateExecutiveBriefing(leads);
    expect(briefing.summary).toBeDefined();
    expect(briefing.summary.totalLeads).toBe(2);
    expect(briefing.summary.totalPipelineValue).toBe(13000);
    expect(briefing.priorities).toBeDefined();
    expect(briefing.alerts).toBeDefined();
    expect(Array.isArray(briefing.alerts)).toBe(true);
  });

  test('empty leads returns minimal briefing', () => {
    const briefing = generateExecutiveBriefing([]);
    expect(briefing.summary.status).toBe('No leads in system');
    expect(briefing.summary.totalLeads).toBe(0);
  });

  test('null leads returns minimal briefing', () => {
    const briefing = generateExecutiveBriefing(null);
    expect(briefing.summary.totalLeads).toBe(0);
  });
});

// ====================================================================
// Module 6: generateExecutiveAlerts
// ====================================================================

describe('generateExecutiveAlerts', () => {
  test('generates alerts for aging leads', () => {
    const leads = [
      makeLead({
        id: 'a', caller: 'A', avgPrice: 10000,
        outcome: 'lead-captured',
        receivedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days old
      }),
    ];
    const alerts = generateExecutiveAlerts(leads);
    expect(alerts.length).toBeGreaterThan(0);
  });

  test('empty leads returns no alerts', () => {
    expect(generateExecutiveAlerts([])).toEqual([]);
  });

  test('null leads returns no alerts', () => {
    expect(generateExecutiveAlerts(null)).toEqual([]);
  });
});

// ====================================================================
// generateDailyPriorities
// ====================================================================

describe('generateDailyPriorities', () => {
  test('generates daily priorities from leads', () => {
    const leads = [
      makeLead({ id: 'a', caller: 'A', outcome: 'follow-up' }),
      makeLead({ id: 'b', caller: 'B', outcome: 'appointment-set' }),
      makeLead({ id: 'c', caller: 'C', outcome: 'lead-captured' }),
    ];
    const priorities = generateDailyPriorities(leads);
    expect(priorities.summary).toBeDefined();
    expect(priorities.topFollowUps).toBeDefined();
    expect(priorities.topOpportunities.length).toBeGreaterThan(0);
  });

  test('empty leads returns null results', () => {
    const priorities = generateDailyPriorities([]);
    expect(priorities.summary).toBeNull();
  });
});

// ====================================================================
// CLOSE_PROBABILITY_MAP
// ====================================================================

describe('CLOSE_PROBABILITY_MAP', () => {
  test('appointment-set = 0.80', () => {
    expect(CLOSE_PROBABILITY_MAP['appointment-set']).toBe(0.80);
  });
  test('follow-up = 0.55', () => {
    expect(CLOSE_PROBABILITY_MAP['follow-up']).toBe(0.55);
  });
  test('lead-captured = 0.35', () => {
    expect(CLOSE_PROBABILITY_MAP['lead-captured']).toBe(0.35);
  });
  test('no-interest = 0.05', () => {
    expect(CLOSE_PROBABILITY_MAP['no-interest']).toBe(0.05);
  });
});

// ====================================================================
// NEXT_BEST_ACTION_MAP
// ====================================================================

describe('NEXT_BEST_ACTION_MAP', () => {
  test('has entries for all outcomes', () => {
    expect(NEXT_BEST_ACTION_MAP['appointment-set']).toBeDefined();
    expect(NEXT_BEST_ACTION_MAP['follow-up']).toBeDefined();
    expect(NEXT_BEST_ACTION_MAP['lead-captured']).toBeDefined();
    expect(NEXT_BEST_ACTION_MAP['no-interest']).toBeDefined();
  });
});
