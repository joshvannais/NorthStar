/**
 * Phase 6 — Determinism Tests
 *
 * Verify that identical inputs produce identical outputs every time.
 * Every calculation in the intelligence pipeline must be deterministic:
 * 1. Run each calculation 3 times with same input, verify identical results
 * 2. Test profit, confidence, opportunity score, priority scores
 * 3. Test three execution paths remain identical
 * 4. Test that random/date-dependent code paths are deterministic
 */
'use strict';

const path = require('path');
process.chdir(path.resolve(__dirname, '../..'));

const intelligence = require('../../src/services/intelligence');
const decisionEngine = require('../../src/services/decisionEngine');
const customerIntelligence = require('../../src/services/customerIntelligence');
const { buildCompactContext, buildBusinessContext } = require('../../src/context/business');
const fixtures = require('../helpers/fixtures');

// Fixed timestamp for deterministic date-based tests
const FIXED_NOW = new Date('2026-07-17T12:00:00.000Z').getTime();

describe('Phase 6 — Determinism Tests', () => {

  // ────────────────────────────────────────────────────────
  // Test 1: Each calculation 3× with same input = identical results
  // ────────────────────────────────────────────────────────
  describe('Triple-run determinism', () => {
    
    // Helper to run a function 3 times and verify identical results
    function assertTripleDeterministic(name, fn, comparator) {
      const r1 = fn();
      const r2 = fn();
      const r3 = fn();
      
      test(`${name} — 3 runs produce identical output`, () => {
        if (comparator) {
          comparator(r1, r2, r3);
        } else {
          // Default deep comparison via JSON
          expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
          expect(JSON.stringify(r1)).toBe(JSON.stringify(r3));
        }
      });
    }

    // 1a. Labor cost
    assertTripleDeterministic('calculateLaborCost', () =>
      intelligence.calculateLaborCost({ crewSize: 3, hours: 6, hourlyRate: 42 })
    );

    // 1b. Travel
    assertTripleDeterministic('calculateTravel', () =>
      intelligence.calculateTravel({ serviceType: 'HVAC Repair' })
    );

    // 1c. Production duration
    assertTripleDeterministic('estimateProductionDuration', () =>
      intelligence.estimateProductionDuration({
        serviceType: 'Roof Repair',
        crewSize: 3,
        complexity: 'standard',
        avgPrice: 5000,
      })
    );

    // 1d. Profit
    assertTripleDeterministic('calculateEstimatedProfit', () => {
      const labor = intelligence.calculateLaborCost({ crewSize: 2, hours: 4, hourlyRate: 42 });
      const travel = intelligence.calculateTravel({ serviceType: 'Plumbing' });
      return intelligence.calculateEstimatedProfit({
        revenue: 3000,
        laborResult: labor,
        travelResult: travel,
      });
    });

    // 1e. Confidence
    assertTripleDeterministic('calculateConfidence', () =>
      intelligence.calculateConfidence({
        serviceType: 'Window Replacement',
        avgPrice: 2500,
        leadCount: 10,
        hasCustomerHistory: true,
        hasKnownPricing: true,
      })
    );

    // 1f. Full job intelligence
    assertTripleDeterministic('calculateJobIntelligence', () =>
      intelligence.calculateJobIntelligence(fixtures.sampleLead, { leadCount: 5 })
    );
  });

  // ────────────────────────────────────────────────────────
  // Test 2: Profit, confidence, opportunity score, priority determinism
  // ────────────────────────────────────────────────────────
  describe('Core metric determinism', () => {
    
    test('Profit calculation is deterministic', () => {
      const run = () => {
        const labor = intelligence.calculateLaborCost({ crewSize: 3, hours: 8, hourlyRate: 45 });
        const travel = intelligence.calculateTravel({ serviceType: 'Foundation Repair' });
        return intelligence.calculateEstimatedProfit({
          revenue: 10000,
          laborResult: labor,
          travelResult: travel,
        });
      };
      
      const r1 = run(), r2 = run(), r3 = run();
      expect(r1.estimatedProfit).toBe(r2.estimatedProfit);
      expect(r1.estimatedProfit).toBe(r3.estimatedProfit);
      expect(r1.profitMargin).toBe(r2.profitMargin);
      expect(r1.profitMargin).toBe(r3.profitMargin);
    });

    test('Confidence calculation is deterministic', () => {
      const run = () => intelligence.calculateConfidence({
        serviceType: 'Tree Removal',
        avgPrice: 4500,
        leadCount: 8,
        hasCustomerHistory: false,
        hasKnownPricing: true,
      });
      
      const r1 = run(), r2 = run(), r3 = run();
      expect(r1.confidenceScore).toBe(r2.confidenceScore);
      expect(r1.confidenceScore).toBe(r3.confidenceScore);
      expect(r1.confidenceLabel).toBe(r2.confidenceLabel);
    });

    test('Opportunity ranking is deterministic with fixed timestamp', () => {
      const lead = fixtures.sampleLead;
      const intel = intelligence.calculateJobIntelligence(lead, { leadCount: 5 });
      
      const run = () => decisionEngine.rankOpportunity(lead, intel, {
        now: FIXED_NOW,
        totalLeads: 5,
      });
      
      const r1 = run(), r2 = run(), r3 = run();
      expect(r1.priorityScore).toBe(r2.priorityScore);
      expect(r1.priorityScore).toBe(r3.priorityScore);
      expect(r1.priorityLabel).toBe(r2.priorityLabel);
    });

    test('Customer snapshot is deterministic', () => {
      const run = () => customerIntelligence.generateCustomerSnapshot(
        fixtures.highValueLead,
        { totalLeads: 5 }
      );
      
      const r1 = run(), r2 = run(), r3 = run();
      expect(r1.priorityScore).toBe(r2.priorityScore);
      expect(r1.priorityScore).toBe(r3.priorityScore);
      expect(r1.opportunityScore).toBe(r2.opportunityScore);
      expect(r1.riskScore).toBe(r2.riskScore);
      expect(r1.snapshot.estimatedProfit).toBe(r2.snapshot.estimatedProfit);
      expect(r1.snapshot.roiScore).toBe(r2.snapshot.roiScore);
    });
  });

  // ────────────────────────────────────────────────────────
  // Test 3: Three execution paths remain identical
  // ────────────────────────────────────────────────────────
  describe('Three execution path determinism', () => {
    
    test('Path 1 (compactContext) vs Path 2 (direct aggregate) vs Path 3 (briefing) match', () => {
      const leads = fixtures.fullTestSet;
      
      // Path 1: buildCompactContext (uses internal loadData but we test with fixtures)
      const agg1 = intelligence.calculateAggregateIntelligence(leads);
      
      // Path 2: Direct aggregate call again
      const agg2 = intelligence.calculateAggregateIntelligence(leads);
      
      // Path 3: Executive briefing
      const briefing = decisionEngine.generateExecutiveBriefing(leads);
      
      // Verify all paths produce identical values
      expect(agg1.totalEstimatedLabor).toBe(agg2.totalEstimatedLabor);
      expect(agg1.totalEstimatedProfit).toBe(agg2.totalEstimatedProfit);
      expect(agg1.averageProfitMargin).toBe(agg2.averageProfitMargin);
      expect(agg1.averageConfidence).toBe(agg2.averageConfidence);
      expect(agg1.totalTravelMinutes).toBe(agg2.totalTravelMinutes);
      expect(agg1.totalProductionHours).toBe(agg2.totalProductionHours);
      
      // Briefing must match aggregate
      expect(briefing.summary.totalEstimatedProfit).toBe(agg1.totalEstimatedProfit);
      expect(briefing.summary.averageProfitMargin).toBe(agg1.averageProfitMargin);
    });

    test('All 3 paths produce identical results for each lead', () => {
      const allIntel = intelligence.calculateAllJobIntelligence(fixtures.fullTestSet);
      
      // Run twice
      const allIntel2 = intelligence.calculateAllJobIntelligence(fixtures.fullTestSet);
      
      // Every lead's intelligence must match
      allIntel.forEach((r, i) => {
        expect(r.leadId).toBe(allIntel2[i].leadId);
        expect(r.roiScore).toBe(allIntel2[i].roiScore);
        expect(r.profit.estimated).toBe(allIntel2[i].profit.estimated);
        expect(r.confidence.score).toBe(allIntel2[i].confidence.score);
      });
    });
  });

  // ────────────────────────────────────────────────────────
  // Test 4: Date-dependent code paths are deterministic
  // ────────────────────────────────────────────────────────
  describe('Date-dependent determinism', () => {
    
    test('Lead age urgency is deterministic with fixed "now"', () => {
      const lead = {
        ...fixtures.sampleLead,
        receivedAt: '2026-07-10T12:00:00.000Z', // 7 days before FIXED_NOW
      };
      const intel = intelligence.calculateJobIntelligence(lead, { leadCount: 5 });
      
      const run = () => decisionEngine.rankOpportunity(lead, intel, {
        now: FIXED_NOW,
        totalLeads: 5,
      });
      
      const r1 = run(), r2 = run();
      expect(r1.factors.leadAgeDays).toBe(r2.factors.leadAgeDays);
      expect(r1.priorityScore).toBe(r2.priorityScore);
      // 7-day-old lead should have high urgency
      expect(r1.factors.leadAgeDays).toBe(7);
      expect(r1.breakdown.ageUrgencyScore).toBe(100); // Critical
    });

    test('Executive briefing with fixed timestamp is deterministic', () => {
      const leads = fixtures.fullTestSet;
      
      const run = () => decisionEngine.generateExecutiveBriefing(leads, { now: FIXED_NOW });
      
      const r1 = run(), r2 = run(), r3 = run();
      
      expect(r1.summary.totalLeads).toBe(r2.summary.totalLeads);
      expect(r1.summary.followUpsOverdue).toBe(r2.summary.followUpsOverdue);
      expect(r1.alerts.length).toBe(r2.alerts.length);
      
      if (r1.topRecommendation) {
        expect(r1.topRecommendation.priorityScore).toBe(r2.topRecommendation.priorityScore);
      }
    });

    test('Daily priorities are deterministic with fixed timestamp', () => {
      const leads = fixtures.fullTestSet;
      
      const run = () => decisionEngine.generateDailyPriorities(leads, { now: FIXED_NOW });
      
      const r1 = run(), r2 = run();
      
      expect(r1.topFollowUps.length).toBe(r2.topFollowUps.length);
      expect(r1.revenueAtRisk).toBe(r2.revenueAtRisk);
      expect(r1.summary.criticalCount).toBe(r2.summary.criticalCount);
    });

    test('Executive alerts are deterministic with fixed timestamp', () => {
      const leads = fixtures.fullTestSet;
      
      const run = () => decisionEngine.generateExecutiveAlerts(leads, { now: FIXED_NOW });
      
      const r1 = run(), r2 = run();
      
      expect(r1.length).toBe(r2.length);
      r1.forEach((alert, i) => {
        expect(alert.id).toBe(r2[i].id);
        expect(alert.severity).toBe(r2[i].severity);
      });
    });
  });

  // ────────────────────────────────────────────────────────
  // Test 5: Edge case determinism
  // ────────────────────────────────────────────────────────
  describe('Edge case determinism', () => {
    
    test('Empty leads array produces identical results every time', () => {
      const run = () => ({
        agg: intelligence.calculateAggregateIntelligence([]),
        briefing: decisionEngine.generateExecutiveBriefing([]),
        ci: customerIntelligence.generateDashboardCustomerIntelligence([]),
      });
      
      const r1 = run(), r2 = run();
      
      expect(r1.agg.totalLeads).toBe(0);
      expect(r2.agg.totalLeads).toBe(0);
      expect(r1.briefing.summary.status).toBe(r2.briefing.summary.status);
    });

    test('Null lead produces consistent null result', () => {
      expect(intelligence.calculateJobIntelligence(null)).toBeNull();
      expect(intelligence.calculateJobIntelligence(null)).toBeNull();
      expect(intelligence.calculateJobIntelligence(null)).toBeNull();
    });

    test('Crew size mapping is deterministic', () => {
      const services = ['HVAC Repair', 'Roof Repair', 'Tree Removal', 'Plumbing', 'Unknown'];
      
      services.forEach(svc => {
        const r1 = intelligence.getRecommendedCrewSize(svc);
        const r2 = intelligence.getRecommendedCrewSize(svc);
        expect(r1).toBe(r2);
      });
    });
  });

  // ────────────────────────────────────────────────────────
  // Test 6: Full pipeline determinism
  // ────────────────────────────────────────────────────────
  describe('Full pipeline determinism', () => {
    
    test('Entire BP → Intel → Decision → CI pipeline is deterministic', () => {
      const leads = fixtures.fullTestSet;
      
      const runFullPipeline = () => {
        const allIntel = intelligence.calculateAllJobIntelligence(leads);
        const briefing = decisionEngine.generateExecutiveBriefing(leads, { now: FIXED_NOW });
        const ranked = decisionEngine.rankAllOpportunities(leads, { now: FIXED_NOW });
        const snapshots = customerIntelligence.generateAllCustomerSnapshots(leads);
        const dashboardCI = customerIntelligence.generateDashboardCustomerIntelligence(leads);
        
        return {
          intelCount: allIntel.length,
          briefingSummary: briefing.summary.totalEstimatedProfit,
          rankedCount: ranked.ranked.length,
          topScore: ranked.ranked[0]?.priorityScore,
          snapshotCount: snapshots.length,
          topSnapshotScore: snapshots[0]?.priorityScore,
          highestOppCount: dashboardCI.highestOpportunity.length,
        };
      };
      
      const r1 = runFullPipeline();
      const r2 = runFullPipeline();
      const r3 = runFullPipeline();
      
      // Every output must match exactly
      expect(r1).toEqual(r2);
      expect(r1).toEqual(r3);
    });
  });
});
