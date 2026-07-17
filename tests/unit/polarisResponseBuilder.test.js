'use strict';

const {
  buildSystemPrompt,
  generatePolarisResponse,
} = require('../../src/services/polarisResponseBuilder');

// ====================================================================
// Helpers
// ====================================================================

function makeContext(overrides = {}) {
  return {
    businessProfile: {
      company: { name: 'NorthStar Solutions', dba: '' },
      crew: { defaultCrewSize: 2, averageHourlyRate: 42, overtimeMultiplier: 1.5 },
      serviceArea: { maxRadiusMiles: 50 },
      routing: { preferredProvider: 'google-maps', trafficEnabled: true },
      financial: { desiredGrossMargin: 40, taxRate: 7 },
      scheduling: { workDayLength: 8, maxJobsPerDay: 4, preferredDispatchStrategy: 'efficiency' },
      polaris: {
        responseStyle: 'executive',
        detailLevel: 'standard',
        showCalculations: true,
        showConfidence: true,
        showExecutiveReasoning: true,
        recommendationStyle: 'prioritized',
      },
    },
    businessIntelligence: {
      totalLeads: 10,
      totalPipelineValue: 50000,
    },
    executiveDecisions: {
      ranked: [],
      topOpportunity: null,
    },
    contextText: 'Test business context text.',
    ...overrides,
  };
}

// ====================================================================
// buildSystemPrompt
// ====================================================================

describe('buildSystemPrompt', () => {
  test('returns a string', () => {
    const ctx = makeContext();
    const prompt = buildSystemPrompt(ctx);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  test('contains company name', () => {
    const ctx = makeContext();
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('NorthStar Solutions');
  });

  test('contains crew defaults', () => {
    const ctx = makeContext();
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('crew size');
    expect(prompt).toContain('42');
  });

  test('contains financial defaults', () => {
    const ctx = makeContext();
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('gross margin');
    expect(prompt).toContain('40');
  });

  test('contains scheduling defaults', () => {
    const ctx = makeContext();
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('8');
    expect(prompt).toContain('4');
  });

  test('contains response style guide', () => {
    const ctx = makeContext();
    const prompt = buildSystemPrompt(ctx);
    // The style guide text uses "operations manager" for the executive style
    expect(prompt).toContain('operations manager');
  });

  test('contains grounded response policy', () => {
    const ctx = makeContext();
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('OBSERVED FACTS');
    expect(prompt).toContain('CALCULATED METRICS');
    expect(prompt).toContain('AI RECOMMENDATIONS');
  });

  test('null context returns fallback', () => {
    const prompt = buildSystemPrompt(null);
    expect(prompt).toBe('Polaris is unavailable.');
  });

  test('undefined context returns fallback', () => {
    const prompt = buildSystemPrompt(undefined);
    expect(prompt).toBe('Polaris is unavailable.');
  });

  test('empty context object uses defaults', () => {
    const prompt = buildSystemPrompt({});
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('2');
    expect(prompt).toContain('42');
  });

  test('dba is included if present', () => {
    const ctx = makeContext();
    ctx.businessProfile.company.dba = 'NorthStar Field Services';
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('dba NorthStar Field Services');
  });

  test('traffic-aware note appears when trafficEnabled', () => {
    const ctx = makeContext();
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('traffic-aware');
  });

  test('customer intelligence is included when ci is provided', () => {
    const ctx = makeContext();
    ctx.customerIntelligence = { name: 'Test Customer', opportunityScore: 75 };
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('CUSTOMER INTELLIGENCE');
  });

  test('analytical style guide is used', () => {
    const ctx = makeContext();
    ctx.businessProfile.polaris.responseStyle = 'analytical';
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('data analysis');
  });

  test('conversational style guide is used', () => {
    const ctx = makeContext();
    ctx.businessProfile.polaris.responseStyle = 'conversational';
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('approachable');
  });
});

// ====================================================================
// generatePolarisResponse
// ====================================================================

describe('generatePolarisResponse', () => {
  test('valid reply returns success', () => {
    const ctx = makeContext();
    const response = generatePolarisResponse('Here is the analysis.', ctx);
    expect(response.success).toBe(true);
    expect(response.response).toBe('Here is the analysis.');
    expect(response.meta.generatedAt).toBeDefined();
    expect(response.meta.readOnly).toBe(true);
  });

  test('null reply returns failure', () => {
    const response = generatePolarisResponse(null, makeContext());
    expect(response.success).toBe(false);
    expect(response.response).toContain("couldn't generate");
  });

  test('empty string reply is falsy (returns failure)', () => {
    // empty string is falsy in JS, so !'' === true → returns error response
    const response = generatePolarisResponse('', makeContext());
    expect(response.success).toBe(false);
    expect(response.response).toContain("couldn't generate");
  });

  test('meta includes leadId from context', () => {
    const ctx = makeContext();
    ctx.request = { leadId: 'test-123', page: 'dashboard' };
    const response = generatePolarisResponse('Reply', ctx);
    expect(response.meta.leadId).toBe('test-123');
    expect(response.meta.page).toBe('dashboard');
  });

  test('meta defaults when no request context', () => {
    const response = generatePolarisResponse('Reply', makeContext());
    expect(response.meta.leadId).toBeNull();
    expect(response.meta.page).toBe('dashboard');
  });
});
