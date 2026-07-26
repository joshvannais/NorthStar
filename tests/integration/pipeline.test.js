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
const businessContext = require('../../src/context/business');
const dataLoader = require('../../src/services/dataLoader');
const { buildPolarisContext } = require('../../src/services/polarisContextBuilder');
const { buildCompactContext, buildBusinessContext } = businessContext;
const fixtures = require('../helpers/fixtures');

const EXPECTED_CORE_METRICS = Object.freeze({
  totalEstimatedLabor: 4279.8,
  totalEstimatedProfit: 13885.84,
  averageProfitMargin: '45.5%',
  averageConfidence: 79,
  totalTravelMinutes: 404,
  totalProductionHours: 46,
});

describe('Phase 3 — Integration: Full Engine Pipeline', () => {

  // ──────────────────────────────────────────────
  // Test 1: Full BP → Intel → Decision → CI → Context pipeline
  // ──────────────────────────────────────────────
  describe('Pipeline: BP → Intelligence → Decision → CI → Context', () => {
    let leads;

    beforeAll(() => {
      leads = dataLoader.loadData().leads;
      expect(leads).toHaveLength(23);
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

    test('Step 4: low-level compact formatter exposes raw metrics but no computed intelligence', () => {
      const context = buildCompactContext({ page: 'dashboard' });

      expect(context.overview).toEqual({ totalLeads: 23, totalCustomers: 0, totalEvents: 0, totalJobs: 0 });
      expect(context.metrics).toEqual({
        pipelineValue: 30505,
        needsFollowUp: 5,
        appointmentsSet: 5,
        avgLeadValue: 1326,
      });
      expect(Object.prototype.hasOwnProperty.call(context, 'calculatedIntelligence')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(context, 'executiveDecisions')).toBe(false);
      expect(context.dashboardCustomerIntelligence).toBeNull();
    });

    test('Step 5: Text context builder produces non-empty string', () => {
      const text = buildBusinessContext({});
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(100);
      expect(text).toContain('NORTHSTAR BUSINESS CONTEXT');
      expect(text).toContain('Estimated pipeline value: $30,505');
      expect(text).not.toContain('Calculated Intelligence');
      expect(text).not.toContain('Executive Decisions');
      expect(text).not.toContain('Total estimated profit');
    });

    test('Step 6: supported orchestrator wires active-lead intelligence and decisions exactly', () => {
      const firstLead = leads[0];
      const raw = buildCompactContext({ leadId: firstLead.id });
      expect(raw.activeLead.id).toBe('mrk123jsklz6yk');
      expect(raw.activeLeadIntelligence).toBeNull();
      expect(raw.activeLeadDecision).toBeNull();
      expect(raw.activeLeadNextAction).toBeNull();
      expect(raw.activeLeadCustomerIntelligence).toBeNull();

      const context = buildPolarisContext({
        page: 'leads',
        leadId: firstLead.id,
        userMessage: 'Show the active lead decision',
        correlationId: 'pipeline-active-lead',
      });
      const compact = context.compactContext;

      expect(context.request.page).toBe('leads');
      expect(context.request.leadId).toBe('mrk123jsklz6yk');
      expect(context.request.message).toBe('Show the active lead decision');
      expect(context.request.correlationId).toBe('pipeline-active-lead');
      expect(compact.activeLead.id).toBe('mrk123jsklz6yk');
      expect(compact.activeLead.caller).toBe('Elizabeth Garcia');
      expect(compact.activeLeadIntelligence.leadId).toBe('mrk123jsklz6yk');
      expect(compact.activeLeadIntelligence.revenue).toBe(500);
      expect(compact.activeLeadIntelligence.profit.estimated).toBe(159.48);
      expect(compact.activeLeadIntelligence.confidence.score).toBe(93);
      expect(compact.activeLeadDecision.priorityScore).toBe(57);
      expect(compact.activeLeadDecision.priorityLabel).toBe('Medium');
      expect(compact.activeLeadDecision.factors.estimatedProfit).toBe(159.48);
      expect(compact.activeLeadDecision.factors.closeProbability).toBe('80%');
      expect(compact.activeLeadNextAction.action).toBe('Confirm appointment & send proposal');
      expect(compact.activeLeadNextAction.priority).toBe('high');
      expect(compact.activeLeadNextAction.escalationLevel).toBe('this-week');
      expect(compact.activeLeadCustomerIntelligence.priorityScore).toBe(57);
      expect(compact.activeLeadCustomerIntelligence.snapshot.estimatedRevenue).toBe(500);
      expect(compact.activeLeadCustomerIntelligence.snapshot.estimatedProfit).toBe(159.48);
      expect(context.contextText).toContain('Currently viewing: Elizabeth Garcia');
      expect(context.contextText).toContain('Calculated Intelligence');
      expect(context.contextText).toContain('Executive Decisions');
      expect(context.contextText).toContain('Total estimated profit: 13,885.84');
    });
  });

  // ──────────────────────────────────────────────
  // Test 2: No duplicate orchestration
  // ──────────────────────────────────────────────
  describe('No Duplicate Calculations (Single Orchestrator)', () => {
    test('supported orchestrator produces one stable aggregate contract', () => {
      const ctx1 = buildPolarisContext({ page: 'dashboard', correlationId: 'pipeline-stability-1' });
      const ctx2 = buildPolarisContext({ page: 'dashboard', correlationId: 'pipeline-stability-2' });

      expect(coreMetrics(ctx1.businessIntelligence)).toEqual(EXPECTED_CORE_METRICS);
      expect(coreMetrics(ctx1.compactContext.calculatedIntelligence)).toEqual(EXPECTED_CORE_METRICS);
      expect(coreMetrics(ctx2.businessIntelligence)).toEqual(EXPECTED_CORE_METRICS);
      expect(coreMetrics(ctx2.compactContext.calculatedIntelligence)).toEqual(EXPECTED_CORE_METRICS);
    });

    test('Aggregate consistency across 3 execution paths', () => {
      const leads = dataLoader.loadData().leads;

      // Path 1: supported canonical orchestrator
      const context = buildPolarisContext({ page: 'dashboard', correlationId: 'pipeline-aggregate' });
      
      // Path 2: Direct aggregate call
      const agg = intelligence.calculateAggregateIntelligence(leads);
      
      // Path 3: Executive briefing
      const briefing = decisionEngine.generateExecutiveBriefing(leads);
      
      expect(coreMetrics(context.businessIntelligence)).toEqual(EXPECTED_CORE_METRICS);
      expect(coreMetrics(context.compactContext.calculatedIntelligence)).toEqual(EXPECTED_CORE_METRICS);
      expect(coreMetrics(agg)).toEqual(EXPECTED_CORE_METRICS);
      
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
    expect(Object.keys(businessContext).sort()).toEqual(['buildBusinessContext', 'buildCompactContext']);
    expect(Object.prototype.hasOwnProperty.call(businessContext, 'loadData')).toBe(false);
    expect(typeof dataLoader.loadData).toBe('function');
    expect(typeof buildPolarisContext).toBe('function');
  });
});

function coreMetrics(value) {
  return {
    totalEstimatedLabor: value.totalEstimatedLabor,
    totalEstimatedProfit: value.totalEstimatedProfit,
    averageProfitMargin: value.averageProfitMargin,
    averageConfidence: value.averageConfidence,
    totalTravelMinutes: value.totalTravelMinutes,
    totalProductionHours: value.totalProductionHours,
  };
}
