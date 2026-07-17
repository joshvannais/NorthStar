'use strict';

const {
  calculateLaborCost,
  getRecommendedCrewSize,
  CREW_SIZE_MAP,
  calculateTravel,
  estimateProductionDuration,
  calculateEstimatedProfit,
  calculateConfidence,
  calculateJobIntelligence,
  calculateAllJobIntelligence,
  calculateAggregateIntelligence,
} = require('../../src/services/intelligence');

// ====================================================================
// Module 1: calculateLaborCost
// ====================================================================

describe('calculateLaborCost', () => {
  test('normal inputs: standard hours (no overtime)', () => {
    const result = calculateLaborCost({ crewSize: 2, hours: 8, hourlyRate: 42 });
    expect(result.laborCost).toBe(672); // 2 * 8 * 42
    expect(result.breakdown.crewSize).toBe(2);
    expect(result.breakdown.hours).toBe(8);
    expect(result.breakdown.overtimeHours).toBe(0);
  });

  test('overtime: 50 hours with overtime multiplier 1.5', () => {
    const result = calculateLaborCost({ crewSize: 2, hours: 50, hourlyRate: 42, overtimeMultiplier: 1.5 });
    // Standard: 2 * 40 * 42 = 3360, OT: 2 * 10 * 42 * 1.5 = 1260, Total = 4620
    expect(result.laborCost).toBe(4620);
    expect(result.breakdown.standardHours).toBe(40);
    expect(result.breakdown.overtimeHours).toBe(10);
  });

  test('zero hours', () => {
    const result = calculateLaborCost({ crewSize: 2, hours: 0, hourlyRate: 42 });
    expect(result.laborCost).toBe(0);
  });

  test('NaN hours — defaults to 0', () => {
    const result = calculateLaborCost({ crewSize: 2, hours: NaN, hourlyRate: 42 });
    expect(Number.isFinite(result.laborCost)).toBe(true);
    expect(result.laborCost).toBe(0);
  });

  test('null/undefined opts fields use defaults', () => {
    const result = calculateLaborCost({});
    expect(Number.isFinite(result.laborCost)).toBe(true);
    expect(result.laborCost).toBe(0); // crewSize=1, hours=0
    expect(result.breakdown.crewSize).toBe(1);
    expect(result.breakdown.hourlyRate).toBe(42);
  });

  test('NaN crewSize defaults to 1', () => {
    const result = calculateLaborCost({ crewSize: NaN, hours: 10, hourlyRate: 42 });
    expect(Number.isFinite(result.laborCost)).toBe(true);
    expect(result.breakdown.crewSize).toBe(1);
  });

  test('NaN hourlyRate defaults to 42', () => {
    const result = calculateLaborCost({ crewSize: 2, hours: 10, hourlyRate: NaN });
    expect(result.breakdown.hourlyRate).toBe(42);
    expect(Number.isFinite(result.laborCost)).toBe(true);
  });

  test('Infinity inputs produce finite outputs', () => {
    const result = calculateLaborCost({ crewSize: Infinity, hours: Infinity, hourlyRate: Infinity });
    expect(Number.isFinite(result.laborCost)).toBe(true);
  });

  test('undefined opts (missing argument) — throws as expected', () => {
    // When opts is undefined, access to properties will throw.
    // This is expected behavior — callers should always pass an object.
    expect(() => calculateLaborCost(undefined)).toThrow();
  });

  test('negative hours — treated literally', () => {
    const result = calculateLaborCost({ crewSize: 2, hours: -5, hourlyRate: 42 });
    expect(result.laborCost).toBe(-420); // 2 * -5 * 42
  });
});

// ====================================================================
// Module 2: getRecommendedCrewSize
// ====================================================================

describe('getRecommendedCrewSize', () => {
  test('exact service match — Window replacement', () => {
    expect(getRecommendedCrewSize('Window replacement')).toBe(2);
  });

  test('case-insensitive match — "window replacement"', () => {
    expect(getRecommendedCrewSize('window replacement')).toBe(2);
  });

  test('partial match — "Roof" matches "Roof Repair"', () => {
    expect(getRecommendedCrewSize('Roof')).toBe(3);
  });

  test('Tree Removal returns 4', () => {
    expect(getRecommendedCrewSize('Tree Removal')).toBe(4);
  });

  test('Emergency Service returns 3', () => {
    expect(getRecommendedCrewSize('Emergency Service')).toBe(3);
  });

  test('unknown service returns default (2)', () => {
    expect(getRecommendedCrewSize('Unicorn Grooming')).toBe(2);
  });

  test('null returns default (2)', () => {
    expect(getRecommendedCrewSize(null)).toBe(2);
  });

  test('undefined returns default (2)', () => {
    expect(getRecommendedCrewSize(undefined)).toBe(2);
  });

  test('empty string returns default (2)', () => {
    expect(getRecommendedCrewSize('')).toBe(2);
  });

  test('Appliance Repair returns 1', () => {
    expect(getRecommendedCrewSize('Appliance Repair')).toBe(1);
  });

  test('CREW_SIZE_MAP is exported', () => {
    expect(CREW_SIZE_MAP).toBeDefined();
    expect(typeof CREW_SIZE_MAP).toBe('object');
  });
});

// ====================================================================
// Module 3: calculateTravel
// ====================================================================

describe('calculateTravel', () => {
  test('known service — Window replacement (15 min)', () => {
    const result = calculateTravel({ serviceType: 'Window replacement' });
    expect(result.travelMinutes).toBe(15);
    expect(result.travelCost).toBeCloseTo(15 * 0.34, 2); // 5.10
    expect(result.travelCostPerMinute).toBe(0.34);
  });

  test('known service — Roof Repair (20 min)', () => {
    const result = calculateTravel({ serviceType: 'Roof Repair' });
    expect(result.travelMinutes).toBe(20);
  });

  test('known service — Emergency Service (12 min)', () => {
    const result = calculateTravel({ serviceType: 'Emergency Service' });
    expect(result.travelMinutes).toBe(12);
  });

  test('case-insensitive partial match', () => {
    const result = calculateTravel({ serviceType: 'roof repair' });
    expect(result.travelMinutes).toBe(20);
  });

  test('unknown service falls back to 18 minutes', () => {
    const result = calculateTravel({ serviceType: 'Mystery Service' });
    expect(result.travelMinutes).toBe(18);
    expect(result.travelCost).toBe(18 * 0.34);
  });

  test('null/undefined serviceType falls back to 18', () => {
    const result = calculateTravel({});
    expect(result.travelMinutes).toBe(18);
  });

  test('address is accepted but not used yet', () => {
    const result = calculateTravel({ serviceType: 'HVAC repair', address: '123 Main St' });
    expect(result.travelMinutes).toBe(18);
  });
});

// ====================================================================
// Module 4: estimateProductionDuration
// ====================================================================

describe('estimateProductionDuration', () => {
  test('Window replacement — standard complexity', () => {
    const result = estimateProductionDuration({
      serviceType: 'Window replacement',
      crewSize: 2,
      complexity: 'standard',
    });
    expect(result.estimatedHours).toBeGreaterThan(0);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(75);
    expect(result.confidenceLabel).toBe('High');
  });

  test('complex job increases hours', () => {
    const simple = estimateProductionDuration({ serviceType: 'Window replacement', complexity: 'simple' });
    const complex = estimateProductionDuration({ serviceType: 'Window replacement', complexity: 'complex' });
    expect(complex.estimatedHours).toBeGreaterThan(simple.estimatedHours);
  });

  test('simple complexity reduces hours', () => {
    const result = estimateProductionDuration({ serviceType: 'Roof Repair', complexity: 'simple' });
    expect(result.breakdown.complexityMultiplier).toBe(0.7);
  });

  test('missing params use defaults', () => {
    const result = estimateProductionDuration({});
    expect(result.estimatedHours).toBeGreaterThan(0);
    expect(result.confidenceLabel).toBeDefined();
  });

  test('avgPrice scales production hours', () => {
    const cheap = estimateProductionDuration({ serviceType: 'Window replacement', avgPrice: 100 });
    const expensive = estimateProductionDuration({ serviceType: 'Window replacement', avgPrice: 10000 });
    expect(expensive.estimatedHours).toBeGreaterThan(cheap.estimatedHours);
  });

  test('unknown service uses default base hours (3.0)', () => {
    const result = estimateProductionDuration({ serviceType: 'Unknown Service' });
    expect(result.estimatedHours).toBeGreaterThan(0);
  });

  test('known service has confidence bonus', () => {
    const known = estimateProductionDuration({ serviceType: 'Window replacement' });
    const unknown = estimateProductionDuration({ serviceType: 'Alien Abduction Prevention' });
    expect(known.confidenceScore).toBeGreaterThan(unknown.confidenceScore);
  });

  test('confidence caps at 99', () => {
    const result = estimateProductionDuration({ serviceType: 'Window replacement', avgPrice: 5000, complexity: 'simple' });
    expect(result.confidenceScore).toBeLessThanOrEqual(99);
  });
});

// ====================================================================
// Module 5: calculateEstimatedProfit
// ====================================================================

describe('calculateEstimatedProfit', () => {
  test('normal calculation', () => {
    const laborResult = { laborCost: 500 };
    const travelResult = { travelCost: 50 };
    const result = calculateEstimatedProfit({
      revenue: 5000,
      laborResult,
      travelResult,
    });
    expect(result.estimatedProfit).toBeGreaterThan(0);
    expect(result.profitMargin).toMatch(/%$/);
  });

  test('zero revenue returns zero profit', () => {
    const result = calculateEstimatedProfit({ revenue: 0 });
    expect(result.estimatedProfit).toBeLessThanOrEqual(0);
  });

  test('NaN revenue produces finite output', () => {
    const result = calculateEstimatedProfit({ revenue: NaN });
    expect(Number.isFinite(result.estimatedProfit)).toBe(true);
  });

  test('negative revenue', () => {
    const result = calculateEstimatedProfit({ revenue: -1000 });
    expect(result.estimatedProfit).toBeLessThan(0);
  });

  test('default materialCost is 25% of revenue', () => {
    const laborResult = { laborCost: 0 };
    const travelResult = { travelCost: 0 };
    const result = calculateEstimatedProfit({ revenue: 1000, laborResult, travelResult });
    // 1000 - 0 - 250 (25%) - 0 - 150 (15% overhead) = 600
    expect(result.breakdown.materialCost).toBe(250);
    expect(result.breakdown.overhead).toBe(150);
  });

  test('explicit materialCost overrides default', () => {
    const result = calculateEstimatedProfit({ revenue: 1000, materialCost: 100 });
    expect(result.breakdown.materialCost).toBe(100);
  });

  test('custom overhead percent', () => {
    const result = calculateEstimatedProfit({ revenue: 1000, overheadPercent: 10 });
    expect(result.breakdown.overhead).toBe(100);
  });
});

// ====================================================================
// Module 6: calculateConfidence
// ====================================================================

describe('calculateConfidence', () => {
  test('known service with high data yields high confidence', () => {
    const result = calculateConfidence({
      serviceType: 'Window replacement',
      avgPrice: 5000,
      leadCount: 10,
      hasCustomerHistory: true,
      hasKnownPricing: true,
    });
    expect(result.confidenceScore).toBeGreaterThanOrEqual(80);
    expect(result.confidenceLabel).toBe('High');
  });

  test('unknown service yields low confidence', () => {
    const result = calculateConfidence({ serviceType: 'Unknown Service' });
    expect(result.confidenceScore).toBeLessThan(70);
    expect(result.confidenceLabel).toBe('Low');
  });

  test('default params work', () => {
    const result = calculateConfidence({});
    expect(result.confidenceScore).toBeGreaterThanOrEqual(10);
    expect(result.confidenceScore).toBeLessThanOrEqual(99);
  });

  test('leadCount 1 gives limited data penalty', () => {
    const result = calculateConfidence({ serviceType: 'Window replacement', leadCount: 1 });
    // The code uses "Minimal" or "Limited" — check for the data penalty
    expect(result.confidenceReason).toMatch(/Minimal|Limited/);
  });

  test('customer history adds bonus', () => {
    const without = calculateConfidence({ serviceType: 'Window replacement', hasCustomerHistory: false });
    const withHistory = calculateConfidence({ serviceType: 'Window replacement', hasCustomerHistory: true });
    expect(withHistory.confidenceScore).toBeGreaterThan(without.confidenceScore);
  });

  test('confidence capped at 99', () => {
    const result = calculateConfidence({
      serviceType: 'Window replacement',
      avgPrice: 5000,
      leadCount: 100,
      hasCustomerHistory: true,
      hasKnownPricing: true,
    });
    expect(result.confidenceScore).toBeLessThanOrEqual(99);
  });

  test('confidence minimum is 10', () => {
    const result = calculateConfidence({ serviceType: 'Unknown' });
    expect(result.confidenceScore).toBeGreaterThanOrEqual(10);
  });
});

// ====================================================================
// Full Pipeline: calculateJobIntelligence
// ====================================================================

describe('calculateJobIntelligence', () => {
  const validLead = {
    id: 'test-001',
    caller: 'John Doe',
    phone: '555-0100',
    address: '123 Main St',
    service: 'Window replacement',
    avgPrice: 5000,
    jobDetail: 'Replace 5 windows, double-pane, standard size',
    outcome: 'appointment-set',
    receivedAt: new Date().toISOString(),
  };

  test('full pipeline on valid lead', () => {
    const result = calculateJobIntelligence(validLead);
    expect(result).toBeDefined();
    expect(result.leadId).toBe('test-001');
    expect(result.service).toBe('Window replacement');
    expect(result.revenue).toBe(5000);
    expect(result.recommendedCrewSize).toBe(2);
    expect(result.estimatedDuration.hours).toBeGreaterThan(0);
    expect(result.laborCost.total).toBeGreaterThan(0);
    expect(result.travel.minutes).toBe(15);
    expect(result.profit.estimated).toBeDefined();
    expect(result.confidence.score).toBeGreaterThan(0);
    expect(result.roiScore).toBeDefined();
  });

  test('null lead returns null', () => {
    expect(calculateJobIntelligence(null)).toBeNull();
  });

  test('undefined lead returns null', () => {
    expect(calculateJobIntelligence(undefined)).toBeNull();
  });

  test('NaN in lead fields produces finite output', () => {
    const badLead = { ...validLead, avgPrice: NaN };
    const result = calculateJobIntelligence(badLead);
    expect(result).toBeDefined();
    // avgPrice=NaN || 0 = 0, so revenue becomes 0 (finite)
    expect(Number.isFinite(result.revenue)).toBe(true);
    expect(Number.isFinite(result.profit.estimated)).toBe(true);
    expect(Number.isFinite(result.roiScore)).toBe(true);
  });

  test('complex job detail (>30 chars) triggers complex complexity', () => {
    const complexLead = {
      ...validLead,
      jobDetail: 'This is a very complex job with lots of details that make it quite involved',
    };
    const simpleLead = { ...validLead, jobDetail: 'simple' };
    const complex = calculateJobIntelligence(complexLead);
    const simple = calculateJobIntelligence(simpleLead);
    // Complex jobs should take more hours due to complexity multiplier
    expect(complex.estimatedDuration.hours).toBeGreaterThan(simple.estimatedDuration.hours);
  });

  test('lead without service defaults to General', () => {
    const noServiceLead = { ...validLead, service: undefined };
    const result = calculateJobIntelligence(noServiceLead);
    expect(result.service).toBe('General');
  });

  test('profitPerHour is calculated', () => {
    const result = calculateJobIntelligence(validLead);
    expect(result.profitPerLaborHour).toBeGreaterThan(0);
  });
});

// ====================================================================
// calculateAllJobIntelligence
// ====================================================================

describe('calculateAllJobIntelligence', () => {
  const leads = [
    { id: 'a', caller: 'A', service: 'Window replacement', avgPrice: 5000, outcome: 'appointment-set', receivedAt: new Date().toISOString() },
    { id: 'b', caller: 'B', service: 'Roof Repair', avgPrice: 8000, outcome: 'follow-up', receivedAt: new Date().toISOString() },
    { id: 'c', caller: 'C', service: 'Tree Removal', avgPrice: 3000, outcome: 'lead-captured', receivedAt: new Date().toISOString() },
  ];

  test('returns sorted array (by ROI descending)', () => {
    const results = calculateAllJobIntelligence(leads);
    expect(results).toHaveLength(3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].roiScore).toBeGreaterThanOrEqual(results[i].roiScore);
    }
  });

  test('empty array returns empty', () => {
    expect(calculateAllJobIntelligence([])).toEqual([]);
  });

  test('null returns empty', () => {
    expect(calculateAllJobIntelligence(null)).toEqual([]);
  });

  test('single lead works', () => {
    const results = calculateAllJobIntelligence([leads[0]]);
    expect(results).toHaveLength(1);
  });
});

// ====================================================================
// calculateAggregateIntelligence
// ====================================================================

describe('calculateAggregateIntelligence', () => {
  const leads = [
    { id: 'a', caller: 'A', service: 'Window replacement', avgPrice: 5000, outcome: 'appointment-set', receivedAt: new Date().toISOString() },
    { id: 'b', caller: 'B', service: 'Roof Repair', avgPrice: 8000, outcome: 'follow-up', receivedAt: new Date().toISOString() },
  ];

  test('aggregates across multiple leads', () => {
    const agg = calculateAggregateIntelligence(leads);
    expect(agg.totalLeads).toBe(2);
    expect(agg.totalPipelineValue).toBe(13000);
    expect(agg.totalEstimatedLabor).toBeGreaterThan(0);
    expect(agg.totalEstimatedProfit).toBeGreaterThan(0);
    expect(agg.averageProfitMargin).toMatch(/%$/);
    expect(agg.averageConfidence).toBeGreaterThan(0);
    expect(agg.highestValueJob).toBeDefined();
    expect(agg.highestProfitJob).toBeDefined();
    expect(agg.mostEfficientJob).toBeDefined();
  });

  test('empty array returns zeroed aggregate', () => {
    const agg = calculateAggregateIntelligence([]);
    expect(agg.totalLeads).toBe(0);
    expect(agg.totalPipelineValue).toBe(0);
    expect(agg.averageProfitMargin).toBe('0.0%');
    expect(agg.highestValueJob).toBeNull();
  });

  test('null returns zeroed aggregate', () => {
    const agg = calculateAggregateIntelligence(null);
    expect(agg.totalLeads).toBe(0);
  });

  test('single lead works', () => {
    const agg = calculateAggregateIntelligence([leads[0]]);
    expect(agg.totalLeads).toBe(1);
    expect(agg.highestValueJob).toBeDefined();
  });
});
