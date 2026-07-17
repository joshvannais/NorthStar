'use strict';

// ====================================================================
// Executive Context — Unit Tests
// ====================================================================

// Mock the service dependencies since executiveContext is an orchestrator
jest.mock('../../../src/services/dataLoader', () => ({
  loadData: jest.fn(),
  CACHE_TTL_MS: 30000,
}));

jest.mock('../../../src/services/businessProfile', () => ({
  getProfile: jest.fn(),
}));

jest.mock('../../../src/services/intelligence', () => ({
  calculateAggregateIntelligence: jest.fn(),
  calculateAllJobIntelligence: jest.fn(),
  calculateJobIntelligence: jest.fn(),
}));

jest.mock('../../../src/services/decisionEngine', () => ({
  generateExecutiveBriefing: jest.fn(),
  rankAllOpportunities: jest.fn(),
  rankOpportunity: jest.fn(),
  getNextBestAction: jest.fn(),
}));

jest.mock('../../../src/services/customerIntelligence', () => ({
  generateDashboardCustomerIntelligence: jest.fn(),
  generateCustomerSnapshot: jest.fn(),
}));

const dataLoader = require('../../../src/services/dataLoader');
const businessProfile = require('../../../src/services/businessProfile');
const intelligence = require('../../../src/services/intelligence');
const decisionEngine = require('../../../src/services/decisionEngine');
const customerIntelligence = require('../../../src/services/customerIntelligence');

const {
  buildExecutiveContext,
  getCachedContext,
  invalidateContext,
  clearAllContexts,
  getCacheSize,
} = require('../../../src/voice/executiveContext');

// Test data
const mockProfile = {
  company: { name: 'Test Co', dba: '', email: 'test@test.com' },
  headquarters: { city: 'Test City', state: 'TS' },
  serviceArea: { maxRadiusMiles: 50 },
  routing: { preferredProvider: 'google-maps' },
  hours: {},
  crew: { defaultCrewSize: 2, averageHourlyRate: 42 },
  vehicles: { truckCount: 3 },
  services: [{ name: 'Window replacement' }],
  financial: { desiredGrossMargin: 40, markup: 1.3 },
  scheduling: { maxJobsPerDay: 4, workDayLength: 8 },
  polaris: { responseStyle: 'executive' },
  retell: { voicePersonality: 'professional' },
  notifications: { email: true },
};

const mockLeads = [
  { id: 'lead-001', caller: 'Alice', service: 'Window replacement', outcome: 'appointment-set', phone: '555-0100', address: '123 A St' },
  { id: 'lead-002', caller: 'Bob', service: 'Roof repair', outcome: 'follow-up', phone: '555-0200', address: '456 B St' },
];

const mockCustomers = [
  { id: 'cust-001', leadId: 'lead-001', name: 'Alice Johnson' },
];

const mockAggregateIntel = {
  totalLeads: 2,
  totalPipelineValue: 15000,
  totalEstimatedLabor: 2000,
  totalEstimatedProfit: 5000,
  averageProfitMargin: '33.3%',
  averageConfidence: 65,
};

const mockAllJobIntel = [
  { leadId: 'lead-001', profit: { estimated: 3000, margin: '40%' }, confidence: { score: 75 } },
  { leadId: 'lead-002', profit: { estimated: 2000, margin: '25%' }, confidence: { score: 55 } },
];

const mockBriefing = {
  summary: { status: 'Active', totalLeads: 2, revenueAtRisk: 0, followUpsOverdue: 1 },
  priorities: { topFollowUps: [{ id: 'lead-002', caller: 'Bob' }] },
  alerts: [],
  topRecommendation: { id: 'lead-001', action: 'Confirm appointment' },
};

const mockRanked = {
  ranked: [
    { leadId: 'lead-001', score: 85, rank: 1 },
    { leadId: 'lead-002', score: 60, rank: 2 },
  ],
};

const mockDashIntel = {
  highestOpportunity: [],
  highestRisk: [],
  highestProfit: [],
};

const mockJobIntel = {
  leadId: 'lead-001',
  profit: { estimated: 3000, margin: '40%' },
  labor: { laborCost: 800 },
  confidence: { score: 75 },
  travel: { totalMinutes: 30 },
};

const mockRank = {
  leadId: 'lead-001',
  score: 85,
  rank: 1,
  factors: { leadAgeDays: 2 },
};

const mockNextAction = {
  action: 'Confirm appointment & send proposal',
  reason: 'Appointment already scheduled.',
  priority: 'high',
};

const mockSnapshot = {
  summary: 'Alice is a Window replacement customer.',
  risk: { score: 15, level: 'low' },
  opportunity: { score: 85, level: 'high' },
};

const mockEstimates = [
  { id: 'est-001', leadId: 'lead-001', createdAt: '2026-07-15T10:00:00Z', total: 7500 },
  { id: 'est-002', leadId: 'lead-001', createdAt: '2026-07-16T08:00:00Z', total: 7200 },
];

beforeEach(() => {
  jest.clearAllMocks();
  clearAllContexts();

  // Set up default mock returns
  businessProfile.getProfile.mockReturnValue(JSON.parse(JSON.stringify(mockProfile)));
  dataLoader.loadData.mockReturnValue({
    leads: JSON.parse(JSON.stringify(mockLeads)),
    customers: JSON.parse(JSON.stringify(mockCustomers)),
    events: [],
    estimates: JSON.parse(JSON.stringify(mockEstimates)),
    jobs: [],
    metrics: {},
    recommendations: [],
    crews: [],
  });
  intelligence.calculateAggregateIntelligence.mockReturnValue(mockAggregateIntel);
  intelligence.calculateAllJobIntelligence.mockReturnValue(mockAllJobIntel);
  decisionEngine.generateExecutiveBriefing.mockReturnValue(mockBriefing);
  decisionEngine.rankAllOpportunities.mockReturnValue(mockRanked);
  customerIntelligence.generateDashboardCustomerIntelligence.mockReturnValue(mockDashIntel);

  // Per-lead mocks
  intelligence.calculateJobIntelligence.mockReturnValue(mockJobIntel);
  decisionEngine.rankOpportunity.mockReturnValue(mockRank);
  decisionEngine.getNextBestAction.mockReturnValue(mockNextAction);
  customerIntelligence.generateCustomerSnapshot.mockReturnValue(mockSnapshot);
});

// ====================================================================
// Part 1: buildExecutiveContext
// ====================================================================

describe('buildExecutiveContext', () => {
  describe('Structure', () => {
    test('returns an object with all required top-level keys', () => {
      const ctx = buildExecutiveContext();

      expect(ctx).toHaveProperty('businessProfile');
      expect(ctx).toHaveProperty('customer');
      expect(ctx).toHaveProperty('intelligence');
      expect(ctx).toHaveProperty('decisions');
      expect(ctx).toHaveProperty('customerIntelligence');
      expect(ctx).toHaveProperty('recentActivity');
      expect(ctx).toHaveProperty('conversationMemory');
      expect(ctx).toHaveProperty('calendar');
      expect(ctx).toHaveProperty('weather');
      expect(ctx).toHaveProperty('currentTime');
      expect(ctx).toHaveProperty('permissions');
      expect(ctx).toHaveProperty('voiceSession');
      expect(ctx).toHaveProperty('loadedAt');
      expect(ctx).toHaveProperty('_meta');
    });

    test('businessProfile contains company, crew, financial, scheduling subsections', () => {
      const ctx = buildExecutiveContext();
      expect(ctx.businessProfile.company).toEqual(mockProfile.company);
      expect(ctx.businessProfile.crew.defaultCrewSize).toBe(2);
      expect(ctx.businessProfile.financial.desiredGrossMargin).toBe(40);
      expect(ctx.businessProfile.scheduling.maxJobsPerDay).toBe(4);
    });

    test('intelligence contains jobIntelligence and aggregateIntelligence', () => {
      const ctx = buildExecutiveContext();
      expect(ctx.intelligence.aggregateIntelligence).toEqual(mockAggregateIntel);
    });

    test('decisions contains executiveBriefing, rank, nextBestAction', () => {
      const ctx = buildExecutiveContext();
      expect(ctx.decisions.executiveBriefing).toEqual(mockBriefing);
    });

    test('customerIntelligence contains snapshot, risk, opportunity', () => {
      const ctx = buildExecutiveContext();
      expect(ctx.customerIntelligence).toHaveProperty('snapshot');
      expect(ctx.customerIntelligence).toHaveProperty('risk');
      expect(ctx.customerIntelligence).toHaveProperty('opportunity');
    });

    test('permissions default to true for all three', () => {
      const ctx = buildExecutiveContext();
      expect(ctx.permissions.canPrice).toBe(true);
      expect(ctx.permissions.canSchedule).toBe(true);
      expect(ctx.permissions.canTransfer).toBe(true);
    });

    test('placeholders are null', () => {
      const ctx = buildExecutiveContext();
      expect(ctx.conversationMemory).toBeNull();
      expect(ctx.calendar).toBeNull();
      expect(ctx.weather).toBeNull();
    });

    test('currentTime and loadedAt are ISO strings', () => {
      const ctx = buildExecutiveContext();
      expect(() => new Date(ctx.currentTime)).not.toThrow();
      expect(ctx.loadedAt).toBe(ctx.currentTime);
    });

    test('_meta contains contextId, generatedAt, leadCount, topRanked, dashboardIntel', () => {
      const ctx = buildExecutiveContext();
      expect(ctx._meta).toHaveProperty('contextId');
      expect(ctx._meta.contextId).toMatch(/^[0-9a-f-]{36}$/);
      expect(ctx._meta.leadCount).toBe(2);
      expect(ctx._meta.topRanked).toHaveLength(2);
      expect(ctx._meta.dashboardIntel).toEqual(mockDashIntel);
    });
  });

  describe('Without customerId', () => {
    test('customer fields are null when no customerId provided', () => {
      const ctx = buildExecutiveContext();
      expect(ctx.customer.customerRecord).toBeNull();
      expect(ctx.customer.lead).toBeNull();
      expect(ctx.customer.recentEstimate).toBeNull();
      expect(ctx.intelligence.jobIntelligence).toBeNull();
      expect(ctx.decisions.rank).toBeNull();
      expect(ctx.decisions.nextBestAction).toBeNull();
      expect(ctx.customerIntelligence.snapshot).toBeNull();
    });

    test('does not call per-lead intelligence functions', () => {
      buildExecutiveContext();
      expect(intelligence.calculateJobIntelligence).not.toHaveBeenCalled();
      expect(decisionEngine.rankOpportunity).not.toHaveBeenCalled();
      expect(decisionEngine.getNextBestAction).not.toHaveBeenCalled();
      expect(customerIntelligence.generateCustomerSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('With customerId', () => {
    test('populates customer fields when lead found', () => {
      const ctx = buildExecutiveContext({ customerId: 'lead-001' });

      expect(ctx.customer.lead).not.toBeNull();
      expect(ctx.customer.lead.id).toBe('lead-001');
      expect(ctx.customer.lead.caller).toBe('Alice');
      expect(ctx.customer.customerRecord).not.toBeNull();
      expect(ctx.customer.customerRecord.id).toBe('cust-001');
    });

    test('populates intelligence for matching lead', () => {
      const ctx = buildExecutiveContext({ customerId: 'lead-001' });

      expect(ctx.intelligence.jobIntelligence).toEqual(mockJobIntel);
      expect(intelligence.calculateJobIntelligence).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'lead-001' }),
        expect.any(Object)
      );
    });

    test('populates decisions for matching lead', () => {
      const ctx = buildExecutiveContext({ customerId: 'lead-001' });

      expect(ctx.decisions.rank).toEqual(mockRank);
      expect(ctx.decisions.nextBestAction).toEqual(mockNextAction);
    });

    test('populates customerIntelligence for matching lead', () => {
      const ctx = buildExecutiveContext({ customerId: 'lead-001' });

      expect(ctx.customerIntelligence.snapshot).toEqual(mockSnapshot);
      expect(ctx.customerIntelligence.risk).toEqual({ score: 15, level: 'low' });
      expect(ctx.customerIntelligence.opportunity).toEqual({ score: 85, level: 'high' });
    });

    test('returns most recent estimate', () => {
      const ctx = buildExecutiveContext({ customerId: 'lead-001' });

      expect(ctx.customer.recentEstimate).not.toBeNull();
      expect(ctx.customer.recentEstimate.id).toBe('est-002'); // newer one
    });

    test('handles missing lead gracefully', () => {
      const ctx = buildExecutiveContext({ customerId: 'lead-999' });

      expect(ctx.customer.lead).toBeNull();
      expect(ctx.customer.customerRecord).toBeNull();
      expect(ctx.intelligence.jobIntelligence).toBeNull();
    });

    test('handles intelligence failure gracefully', () => {
      intelligence.calculateJobIntelligence.mockImplementation(() => {
        throw new Error('Boom');
      });

      const ctx = buildExecutiveContext({ customerId: 'lead-001' });
      // Should not throw
      expect(ctx.intelligence.jobIntelligence).toBeNull();
    });
  });

  describe('Voice session', () => {
    test('passes through voiceSession when provided', () => {
      const voiceSession = { callSid: 'CA123', from: '+15551234567' };
      const ctx = buildExecutiveContext({ voiceSession });

      expect(ctx.voiceSession).toEqual(voiceSession);
    });

    test('voiceSession is null by default', () => {
      const ctx = buildExecutiveContext();
      expect(ctx.voiceSession).toBeNull();
    });
  });

  describe('Data loading', () => {
    test('loads profile from businessProfile service', () => {
      buildExecutiveContext();
      expect(businessProfile.getProfile).toHaveBeenCalled();
    });

    test('loads data from dataLoader', () => {
      buildExecutiveContext();
      expect(dataLoader.loadData).toHaveBeenCalled();
    });

    test('calls aggregate and all-job intelligence', () => {
      buildExecutiveContext();
      expect(intelligence.calculateAggregateIntelligence).toHaveBeenCalledWith(mockLeads);
      expect(intelligence.calculateAllJobIntelligence).toHaveBeenCalledWith(mockLeads);
    });

    test('calls executive decision engine', () => {
      buildExecutiveContext();
      expect(decisionEngine.generateExecutiveBriefing).toHaveBeenCalledWith(mockLeads);
      expect(decisionEngine.rankAllOpportunities).toHaveBeenCalledWith(mockLeads);
    });

    test('calls dashboard customer intelligence', () => {
      buildExecutiveContext();
      expect(customerIntelligence.generateDashboardCustomerIntelligence).toHaveBeenCalledWith(mockLeads);
    });
  });
});

// ====================================================================
// Part 2: Immutability (deepFreeze)
// ====================================================================

describe('Immutability', () => {
  test('returned context is frozen', () => {
    const ctx = buildExecutiveContext();
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  test('nested objects are frozen', () => {
    const ctx = buildExecutiveContext();
    expect(Object.isFrozen(ctx.businessProfile)).toBe(true);
    expect(Object.isFrozen(ctx.customer)).toBe(true);
    expect(Object.isFrozen(ctx.intelligence)).toBe(true);
    expect(Object.isFrozen(ctx.decisions)).toBe(true);
    expect(Object.isFrozen(ctx.permissions)).toBe(true);
    expect(Object.isFrozen(ctx.recentActivity)).toBe(true);
    expect(Object.isFrozen(ctx._meta)).toBe(true);
  });

  test('modification throws in strict mode', () => {
    const ctx = buildExecutiveContext();
    expect(() => {
      ctx.businessProfile = null;
    }).toThrow();
  });

  test('modification of nested throws in strict mode', () => {
    const ctx = buildExecutiveContext();
    expect(() => {
      ctx.permissions.canPrice = false;
    }).toThrow();
  });

  test('null values are preserved (not frozen into objects)', () => {
    const ctx = buildExecutiveContext();
    expect(ctx.calendar).toBeNull();
    expect(ctx.weather).toBeNull();
    expect(ctx.conversationMemory).toBeNull();
  });
});

// ====================================================================
// Part 2 (continued): Cache Management
// ====================================================================

describe('Cache management', () => {
  test('getCachedContext returns null for unknown session', () => {
    expect(getCachedContext('unknown-session')).toBeNull();
  });

  test('build with sessionId stores in cache', () => {
    const ctx = buildExecutiveContext({ sessionId: 'session-001' });
    const cached = getCachedContext('session-001');

    expect(cached).toBeDefined();
    expect(cached._meta.contextId).toBe(ctx._meta.contextId);
    expect(Object.isFrozen(cached)).toBe(true);
  });

  test('cached context equals returned context', () => {
    const ctx = buildExecutiveContext({ sessionId: 'session-002' });
    const cached = getCachedContext('session-002');

    expect(cached).toBe(ctx); // Same reference (in-memory)
  });

  test('invalidateContext removes from cache', () => {
    buildExecutiveContext({ sessionId: 'session-003' });
    expect(getCacheSize()).toBe(1);

    invalidateContext('session-003');
    expect(getCachedContext('session-003')).toBeNull();
    expect(getCacheSize()).toBe(0);
  });

  test('invalidateContext returns true when found, false when not', () => {
    buildExecutiveContext({ sessionId: 'session-004' });
    expect(invalidateContext('session-004')).toBe(true);
    expect(invalidateContext('session-004')).toBe(false);
  });

  test('clearAllContexts empties cache', () => {
    buildExecutiveContext({ sessionId: 'a' });
    buildExecutiveContext({ sessionId: 'b' });
    expect(getCacheSize()).toBe(2);

    clearAllContexts();
    expect(getCacheSize()).toBe(0);
  });

  test('getCacheSize returns correct count', () => {
    expect(getCacheSize()).toBe(0);
    buildExecutiveContext({ sessionId: 's1' });
    expect(getCacheSize()).toBe(1);
    buildExecutiveContext({ sessionId: 's2' });
    expect(getCacheSize()).toBe(2);
  });

  test('build without sessionId does not cache', () => {
    buildExecutiveContext();
    expect(getCacheSize()).toBe(0);
  });
});
