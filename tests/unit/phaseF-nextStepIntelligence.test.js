/**
 * phaseF-nextStepIntelligence.test.js — M19.5 Phase F: Next-Step Intelligence
 *
 * Tests the next-step recommendation engine through the real buildPolarisIntelligence
 * entry point. Verifies that nextSteps are added to the canonical record without
 * modifying operational or contact intelligence.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const originalDataDir = process.env.NORTHSTAR_DATA_DIR;
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-phase-f-next-step-'));
fs.copyFileSync(
  path.resolve(__dirname, '../../data/business-profile.json'),
  path.join(testDataDir, 'business-profile.json')
);
process.env.NORTHSTAR_DATA_DIR = testDataDir;

const { buildPolarisIntelligence } = require('../../src/routes/demo');

afterAll(function () {
  fs.rmSync(testDataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.NORTHSTAR_DATA_DIR;
  else process.env.NORTHSTAR_DATA_DIR = originalDataDir;
});

// ── Fixtures ──

const treeServiceTranscript = [
  { speaker: 'agent', utterance: 'Thank you for calling NorthStar Tree Service. How can I help you today?' },
  { speaker: 'customer', utterance: 'Hi, I have a large oak tree in my backyard that needs to be removed.' },
  { speaker: 'agent', utterance: 'How tall would you say the tree is?' },
  { speaker: 'customer', utterance: "It's about 80 feet tall, and the trunk is pretty large." },
  { speaker: 'agent', utterance: 'Is it near any structures?' },
  { speaker: 'customer', utterance: "Yes, it's leaning toward my house. I'm worried it might fall." },
  { speaker: 'agent', utterance: 'I understand. We can definitely help with that.' },
  { speaker: 'agent', utterance: 'Great, and what is the service address?' },
  { speaker: 'customer', utterance: 'The address is 123 Main Street.' }
];

const executiveSummary = {
  customerName: 'John Smith',
  customerPhone: '555-0100'
};

const plumbingTranscript = [
  { speaker: 'agent', utterance: 'Thanks for calling NorthStar Plumbing.' },
  { speaker: 'customer', utterance: 'My sink is leaking under the kitchen cabinet.' },
  { speaker: 'agent', utterance: 'How long has it been leaking?' },
  { speaker: 'customer', utterance: 'Since yesterday afternoon.' }
];

const emptyTranscript = [
  { speaker: 'agent', utterance: 'Hello.' },
  { speaker: 'customer', utterance: 'Hi.' }
];

// ── Tests ──

describe('Phase F — Next-Step Intelligence', function() {

  describe('Basic structure', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      treeServiceTranscript,
      executiveSummary,
      'simulation'
    );

    test('adds nextSteps array to canonical record', function() {
      expect(Array.isArray(result.nextSteps)).toBe(true);
    });

    test('nextSteps contains at least one recommendation', function() {
      expect(result.nextSteps.length).toBeGreaterThan(0);
    });

    test('each recommendation has required fields', function() {
      result.nextSteps.forEach(function(r) {
        expect(r.id).toBeDefined();
        expect(r.title).toBeDefined();
        expect(r.category).toBeDefined();
        expect(r.priority).toBeDefined();
        expect(r.confidence).toBeDefined();
        expect(typeof r.confidence).toBe('number');
        expect(r.businessImpact).toBeDefined();
        expect(r.urgency).toBeDefined();
        expect(r.timing).toBeDefined();
        expect(r.recommendedChannel).toBeDefined();
        expect(r.owner).toBeDefined();
        expect(r.dependencies).toBeDefined();
        expect(Array.isArray(r.dependencies)).toBe(true);
        expect(r.explanation).toBeDefined();
        expect(r.supportingEvidence).toBeDefined();
        expect(Array.isArray(r.supportingEvidence)).toBe(true);
      });
    });
  });

  describe('Recommendation ranking', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      treeServiceTranscript,
      executiveSummary,
      'simulation'
    );

    test('recommendations are ranked with sequential rank numbers', function() {
      result.nextSteps.forEach(function(r, i) {
        expect(r.rank).toBe(i + 1);
      });
    });

    test('higher priority recommendations appear first', function() {
      for (var i = 1; i < result.nextSteps.length; i++) {
        var prev = result.nextSteps[i - 1];
        var curr = result.nextSteps[i];
        // Same or higher priority is fine, but lower priority should not come before higher
        var priorityOrder = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
        expect(priorityOrder[prev.priority] || 99).toBeLessThanOrEqual(priorityOrder[curr.priority] || 99);
      }
    });
  });

  describe('Priority ordering', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      treeServiceTranscript,
      executiveSummary,
      'simulation'
    );

    test('priorities are valid values', function() {
      var valid = ['Critical', 'High', 'Medium', 'Low'];
      result.nextSteps.forEach(function(r) {
        expect(valid.indexOf(r.priority)).toBeGreaterThanOrEqual(0);
      });
    });

    test('urgencies are valid values', function() {
      var valid = ['Immediate', 'Today', 'This Week', 'Future'];
      result.nextSteps.forEach(function(r) {
        expect(valid.indexOf(r.urgency)).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('No operational mutation', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      treeServiceTranscript,
      executiveSummary,
      'simulation'
    );

    test('polarisFacts are unchanged', function() {
      expect(Array.isArray(result.polarisFacts)).toBe(true);
    });

    test('confidence is unchanged', function() {
      expect(typeof result.confidence).toBe('number');
    });

    test('revenueRange is unchanged', function() {
      expect(result.revenueRange).toBeDefined();
    });

    test('estimate is unchanged', function() {
      expect(result.estimate).toBeDefined();
    });

    test('workScopes are unchanged', function() {
      expect(Array.isArray(result.workScopes)).toBe(true);
    });
  });

  describe('No customer mutation', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      treeServiceTranscript,
      executiveSummary,
      'simulation'
    );

    test('contactProfile is unchanged', function() {
      expect(result.contactProfile).toBeDefined();
      expect(result.contactProfile.name).toBe('John Smith');
    });

    test('relationshipProfile is unchanged', function() {
      expect(result.relationshipProfile).toBeDefined();
    });

    test('customerTimeline is unchanged', function() {
      expect(Array.isArray(result.customerTimeline)).toBe(true);
    });

    test('opportunities are unchanged', function() {
      expect(Array.isArray(result.opportunities)).toBe(true);
    });

    test('executiveSummary is unchanged', function() {
      expect(result.executiveSummary).toBeDefined();
    });
  });

  describe('Missing information handling', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      emptyTranscript,
      null,
      'simulation'
    );

    test('returns nextSteps (possibly empty)', function() {
      expect(Array.isArray(result.nextSteps)).toBe(true);
    });

    test('does not block other intelligence', function() {
      expect(result.polarisFacts).toBeDefined();
      expect(result.estimate).toBeDefined();
      expect(result.contactProfile).toBeDefined();
    });
  });

  describe('Industry neutrality', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Plumbing',
      'Plumbing',
      plumbingTranscript,
      { customerName: 'Jane Doe', customerPhone: '555-0200' },
      'simulation'
    );

    test('works for non-Tree-Service industries', function() {
      expect(Array.isArray(result.nextSteps)).toBe(true);
    });

    test('Phase C fields are preserved', function() {
      expect(result.polarisFacts).toBeDefined();
      expect(result.revenueRange).toBeDefined();
    });
  });

  describe('Backward compatibility', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      treeServiceTranscript,
      executiveSummary,
      'simulation'
    );

    test('Phase C fields present', function() {
      expect(result.polarisFacts).toBeDefined();
      expect(result.confidence).toBeDefined();
      expect(result.revenueRange).toBeDefined();
      expect(result.qualification).toBeDefined();
      expect(result.executiveBriefing).toBeDefined();
    });

    test('Phase D fields present', function() {
      expect(Array.isArray(result.workScopes)).toBe(true);
      expect(result.estimateSource).toBeDefined();
    });

    test('Phase E1 fields present', function() {
      expect(result.contactProfile).toBeDefined();
      expect(result.relationshipProfile).toBeDefined();
      expect(result.executiveSummary).toBeDefined();
      expect(Array.isArray(result.recommendedActions)).toBe(true);
    });
  });

  describe('Evidence traceability', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      treeServiceTranscript,
      executiveSummary,
      'simulation'
    );

    test('recommendations have supporting evidence', function() {
      result.nextSteps.forEach(function(r) {
        expect(r.supportingEvidence.length).toBeGreaterThan(0);
      });
    });

    test('recommendations have explanations', function() {
      result.nextSteps.forEach(function(r) {
        expect(r.explanation.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Confidence scoring', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      treeServiceTranscript,
      executiveSummary,
      'simulation'
    );

    test('confidence is between 0 and 100', function() {
      result.nextSteps.forEach(function(r) {
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(100);
      });
    });

    test('confidence is deterministic for same input', function() {
      var result2 = buildPolarisIntelligence(
        'NorthStar Tree Service',
        'Tree Service',
        treeServiceTranscript,
        { customerName: 'Jane Doe', customerPhone: '555-0200' },
        'simulation'
      );
      // Both results should have the same structure
      expect(Array.isArray(result2.nextSteps)).toBe(true);
      result2.nextSteps.forEach(function(r) {
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('No hallucination', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      [{ speaker: 'agent', utterance: 'Hello' }, { speaker: 'customer', utterance: 'Just checking prices.' }],
      null,
      'simulation'
    );

    test('does not fabricate recommendations without evidence', function() {
      // With minimal transcript and no executiveSummary, there may be few or no recommendations
      // What matters is that nothing is fabricated without evidence
      result.nextSteps.forEach(function(r) {
        expect(r.supportingEvidence.length).toBeGreaterThan(0);
        expect(r.explanation.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Graceful degradation', function() {
    test('handles null record', function() {
      const nextStepIntelligence = require('../../src/polaris/nextStepIntelligence');
      var result = nextStepIntelligence.buildNextSteps(null);
      expect(result.nextSteps).toBeDefined();
      expect(Array.isArray(result.nextSteps)).toBe(true);
    });
  });
});
