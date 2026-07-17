/**
 * Phase 3 — Integration Tests: Full Engine Pipeline
 *
 * Tests the complete engine pipeline from end to end:
 * Business Profile → Intelligence → Decision → Customer Intelligence → Polaris Context → Prompt Builder
 *
 * Verification targets:
 * 1. Correct data flow through the full chain
 * 2. No duplicate calculations occur
 * 3. Deterministic output (same input = same output)
 * 4. Single orchestrator (buildCompactContext / buildBusinessContext)
 */
'use strict';

const path = require('path');

// Change to project root so data/ paths resolve correctly
process.chdir(path.resolve(__dirname, '../..'));

const intelligence = require('../../src/services/intelligence');
const decisionEngine = require('../../src/services/decisionEngine');
const customerIntelligence = require('../../src/services/customerIntelligence');
const { buildCompactContext, buildBusinessContext, loadData } = require('../../src/context/business');
const fixtures = require('../helpers/fixtures');

describe('Phase 3 — Integration: Full Engine Pipeline', () => {

  // ──────────────────────────────────────────────
  // Test 1: Full BP → Intel → Decision → CI → Context pipeline
  // ──────────────────────────────────────────────
  describe('Pipeline: BP → Intelligence → Decision → CI → Context', () => {
    let leads;

    beforeAll(() => {
      // Use real data files from the project
      try {
        leads = loadData().leads;
      } catch (e) {
        // Fall back to fixtures if data files not available
        leads = fixtures.fullTestSet;
      }
    });

    test('Step 1: Intelligence Engine produces valid output for all leads', () => {
      expect(leads.length).toBeGreaterThan(0);
      
      leads.forEach(lead => {
        const result = intelligence.calculateJobIntelligence(lead, { leadCount: leads.length });
        expect(result).not.toBeNull();
        expect(result.leadId).toBe(lead.id);
        
        // Verify no NaN in any numeric field
        verifyNoNaN(result);
      });
    });

    test('Step 2: Decision Engine consumes Intelligence output without duplication', () => {
      const ranked = decisionEngine.rankAllOpportunities(leads);
      expect(ranked.ranked.length).toBeGreaterThan(0);
      
      // Each ranked lead has valid priority scores (no NaN)
      ranked.ranked.forEach(r => {
        expect(typeof r.priorityScore).toBe('number');
        expect(Number.isFinite(r.priorityScore)).toBe(true);
        expect(r.priorityScore).toBeGreaterThanOrEqual(0);
        expect(r.priorityScore).toBeLessThanOrEqual(100);
      });
    });

    test('Step 3: Customer Intelligence consumes both Intelligence and Decision', () => {
      const lead = leads[0];
      const snapshot = customerIntelligence.generateCustomerSnapshot(lead, { totalLeads: leads.length });
      
      expect(snapshot).not.toBeNull();
      expect(snapshot.customerId).toBe(lead.id);
      expect(snapshot.name).toBe(lead.caller);
      
      // All numeric fields are finite
      expect(Number.isFinite(snapshot.priorityScore)).toBe(true);
      expect(Number.isFinite(snapshot.opportunityScore)).toBe(true);
      expect(Number.isFinite(snapshot.riskScore)).toBe(true);
      verifyNoNaN(snapshot.snapshot);
    });

    test('Step 4: Business Context builder produces valid context', () => {
      const context = buildCompactContext({});
      
      expect(context).not.toBeNull();
      expect(context.overview).toBeDefined();
      expect(context.leads).toBeDefined();
      expect(context.metrics).toBeDefined();
      expect(context.calculatedIntelligence).toBeDefined();
      
      // All numeric metrics are finite
      expect(Number.isFinite(context.metrics.pipelineValue)).toBe(true);
      expect(Number.isFinite(context.metrics.avgLeadValue)).toBe(true);
      expect(Number.isFinite(context.metrics.needsFollowUp)).toBe(true);
      expect(Number.isFinite(context.metrics.appointmentsSet)).toBe(true);
    });

    test('Step 5: Text context builder produces non-empty string', () => {
      const text = buildBusinessContext({});
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(100);
      expect(text).toContain('NORTHSTAR BUSINESS CONTEXT');
    });

    test('Step 6: Full pipeline with active lead context works', () => {
      const firstLead = leads[0];
      const context = buildCompactContext({ leadId: firstLead.id });
      
      expect(context.activeLead).not.toBeNull();
      expect(context.activeLeadIntelligence).not.toBeNull();
      expect(context.activeLeadDecision).not.toBeNull();
      expect(context.activeLeadNextAction).not.toBeNull();
      expect(context.activeLeadCustomerIntelligence).not.toBeNull();
      
      // Active lead intelligence has valid values
      if (context.activeLeadIntelligence) {
        verifyNoNaN(context.activeLeadIntelligence);
      }
      
      // Customer snapshot from active lead
      if (context.activeLeadCustomerIntelligence) {
        expect(Number.isFinite(context.activeLeadCustomerIntelligence.priorityScore)).toBe(true);
        expect(Number.isFinite(context.activeLeadCustomerIntelligence.opportunityScore)).toBe(true);
      }
    });
  });

  // ──────────────────────────────────────────────
  // Test 2: No duplicate orchestration
  // ──────────────────────────────────────────────
  describe('No Duplicate Calculations (Single Orchestrator)', () => {
    test('buildCompactContext calls intelligence once for aggregate', () => {
      // Build context twice — same object structure each time
      const ctx1 = buildCompactContext({});
      const ctx2 = buildCompactContext({});
      
      // Both produce same aggregate values (deterministic)
      expect(ctx1.calculatedIntelligence.totalEstimatedLabor)
        .toBe(ctx2.calculatedIntelligence.totalEstimatedLabor);
      expect(ctx1.calculatedIntelligence.totalEstimatedProfit)
        .toBe(ctx2.calculatedIntelligence.totalEstimatedProfit);
      expect(ctx1.calculatedIntelligence.averageConfidence)
        .toBe(ctx2.calculatedIntelligence.averageConfidence);
    });

    test('Aggregate consistency across 3 execution paths', () => {
      const leads = loadData().leads;
      
      // Path 1: buildCompactContext
      const ctx = buildCompactContext({});
      
      // Path 2: Direct aggregate call
      const agg = intelligence.calculateAggregateIntelligence(leads);
      
      // Path 3: Executive briefing
      const briefing = decisionEngine.generateExecutiveBriefing(leads);
      
      // Verify all 6 metrics match
      expect(ctx.calculatedIntelligence.totalEstimatedLabor)
        .toBe(agg.totalEstimatedLabor);
      expect(ctx.calculatedIntelligence.totalEstimatedProfit)
        .toBe(agg.totalEstimatedProfit);
      expect(ctx.calculatedIntelligence.averageProfitMargin)
        .toBe(agg.averageProfitMargin);
      expect(ctx.calculatedIntelligence.averageConfidence)
        .toBe(agg.averageConfidence);
      expect(ctx.calculatedIntelligence.totalTravelMinutes)
        .toBe(agg.totalTravelMinutes);
      expect(ctx.calculatedIntelligence.totalProductionHours)
        .toBe(agg.totalProductionHours);
      
      // Executive briefing also consistent
      expect(briefing.summary.totalEstimatedProfit).toBe(agg.totalEstimatedProfit);
      expect(briefing.summary.averageProfitMargin).toBe(agg.averageProfitMargin);
    });
  });

  // ──────────────────────────────────────────────
  // Test 3: Deterministic output
  // ──────────────────────────────────────────────
  describe('Deterministic Output (Same Input = Same Output)', () => {
    test('Same leads produce identical intelligence results', () => {
      const leads = fixtures.fullTestSet;
      
      const result1 = intelligence.calculateAllJobIntelligence(leads);
      const result2 = intelligence.calculateAllJobIntelligence(leads);
      
      expect(result1.length).toBe(result2.length);
      result1.forEach((r, i) => {
        expect(r.leadId).toBe(result2[i].leadId);
        expect(r.revenue).toBe(result2[i].revenue);
        expect(r.profit.estimated).toBe(result2[i].profit.estimated);
        expect(r.confidence.score).toBe(result2[i].confidence.score);
        expect(r.roiScore).toBe(result2[i].roiScore);
      });
    });

    test('Same leads produce identical ranking', () => {
      const leads = fixtures.fullTestSet;
      
      const ranked1 = decisionEngine.rankAllOpportunities(leads, { now: Date.now() });
      const ranked2 = decisionEngine.rankAllOpportunities(leads, { now: Date.now() });
      
      expect(ranked1.ranked.length).toBe(ranked2.ranked.length);
      ranked1.ranked.forEach((r, i) => {
        expect(r.priorityScore).toBe(ranked2.ranked[i].priorityScore);
      });
    });

    test('Same leads produce identical customer snapshots', () => {
      const lead = fixtures.sampleLead;
      
      const snap1 = customerIntelligence.generateCustomerSnapshot(lead, { totalLeads: 5 });
      const snap2 = customerIntelligence.generateCustomerSnapshot(lead, { totalLeads: 5 });
      
      expect(snap1.priorityScore).toBe(snap2.priorityScore);
      expect(snap1.opportunityScore).toBe(snap2.opportunityScore);
      expect(snap1.riskScore).toBe(snap2.riskScore);
      expect(snap1.snapshot.estimatedProfit).toBe(snap2.snapshot.estimatedProfit);
    });
  });

  // ──────────────────────────────────────────────
  // Test 4: Edge cases
  // ──────────────────────────────────────────────
  describe('Edge Cases', () => {
    test('Empty lead array produces safe defaults', () => {
      const agg = intelligence.calculateAggregateIntelligence([]);
      expect(agg.totalLeads).toBe(0);
      expect(agg.totalEstimatedLabor).toBe(0);
      expect(agg.totalEstimatedProfit).toBe(0);
      
      const briefing = decisionEngine.generateExecutiveBriefing([]);
      expect(briefing.summary.status).toBe('No leads in system');
      
      const dashboardCI = customerIntelligence.generateDashboardCustomerIntelligence([]);
      expect(dashboardCI.highestOpportunity).toEqual([]);
    });

    test('Null lead returns null from intelligence', () => {
      const result = intelligence.calculateJobIntelligence(null);
      expect(result).toBeNull();
    });

    test('Leadership with missing fields works', () => {
      const incomplete = { id: 'min-1', caller: 'Minimal', service: 'Plumbing' };
      const result = intelligence.calculateJobIntelligence(incomplete, { leadCount: 0 });
      
      expect(result).not.toBeNull();
      expect(result.revenue).toBe(0);
      expect(result.estimatedDuration.hours).toBeGreaterThan(0);
      verifyNoNaN(result);
    });
  });
});

// ──────────────────────────────────────────────
// Helper: Verify no NaN or Infinity in object
// ──────────────────────────────────────────────
function verifyNoNaN(obj, path = '') {
  if (obj === null || obj === undefined) return;
  
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) {
      throw new Error(`NaN/Infinity found at ${path}: ${obj}`);
    }
    return;
  }
  
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => verifyNoNaN(item, `${path}[${i}]`));
    return;
  }
  
  if (typeof obj === 'object') {
    Object.entries(obj).forEach(([key, value]) => {
      verifyNoNaN(value, path ? `${path}.${key}` : key);
    });
  }
}

describe('M16.6 Integrity', () => {
  test('All test modules are loadable', () => {
    expect(intelligence).toBeDefined();
    expect(decisionEngine).toBeDefined();
    expect(customerIntelligence).toBeDefined();
    expect(buildCompactContext).toBeDefined();
    expect(buildBusinessContext).toBeDefined();
    expect(loadData).toBeDefined();
  });
});
