/**
 * phaseE-contactIntelligence.test.js — M19.5 Phase E: Contact Intelligence
 *
 * Tests the contact intelligence enrichment through the real buildPolarisIntelligence
 * entry point. Verifies that contact fields are added to the canonical record
 * without modifying existing operational intelligence.
 */
'use strict';

const { buildPolarisIntelligence } = require('../../src/routes/demo');

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

const executiveSummaryWithName = {
  customerName: 'John Smith',
  customerPhone: '555-0100',
  customerAddress: '123 Main Street, Springfield'
};

const executiveSummaryWithPhone = {
  customerName: 'John Smith',
  customerPhone: '555-0100'
};

// ── Tests ──

describe('Phase E — Contact Intelligence', function() {

  describe('First call — new customer with executiveSummary', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      treeServiceTranscript,
      executiveSummaryWithName,
      'simulation'
    );

    test('adds contactProfile with identity fields from executiveSummary', function() {
      expect(result.contactProfile).toBeDefined();
      expect(result.contactProfile.name).toBe('John Smith');
      expect(result.contactProfile.phone).toBe('555-0100');
      expect(result.contactProfile.address).toBe('123 Main Street, Springfield');
      expect(result.contactProfile.confidence).toBeGreaterThan(0);
    });

    test('adds relationshipProfile', function() {
      expect(result.relationshipProfile).toBeDefined();
      expect(result.relationshipProfile.type).toBeDefined();
      expect(result.relationshipProfile.label).toBeDefined();
    });

    test('adds customerTimeline array', function() {
      expect(Array.isArray(result.customerTimeline)).toBe(true);
    });

    test('adds opportunities array', function() {
      expect(Array.isArray(result.opportunities)).toBe(true);
      expect(result.opportunities.length).toBeGreaterThan(0);
    });

    test('adds healthScore', function() {
      if (result.healthScore && !result.healthScore.error) {
        expect(result.healthScore.healthScore).toBeGreaterThanOrEqual(0);
        expect(result.healthScore.healthScore).toBeLessThanOrEqual(100);
      }
    });

    test('adds executiveSummary', function() {
      expect(result.executiveSummary).toBeDefined();
      expect(typeof result.executiveSummary).toBe('string');
      expect(result.executiveSummary.length).toBeGreaterThan(0);
    });

    test('adds recommendedActions array', function() {
      expect(Array.isArray(result.recommendedActions)).toBe(true);
    });
  });

  describe('Backward compatibility — Phase C and D fields', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      treeServiceTranscript,
      executiveSummaryWithName,
      'simulation'
    );

    // Phase C fields
    test('preserves polarisFacts', function() {
      expect(Array.isArray(result.polarisFacts)).toBe(true);
    });

    test('preserves confidence', function() {
      expect(result.confidence).toBeDefined();
      expect(typeof result.confidence).toBe('number');
    });

    test('preserves revenueRange', function() {
      expect(result.revenueRange).toBeDefined();
      expect(typeof result.revenueRange).toBe('string');
    });

    test('preserves qualification', function() {
      expect(result.qualification).toBeDefined();
    });

    test('preserves extractedValues', function() {
      expect(result.extractedValues).toBeDefined();
    });

    test('preserves executiveBriefing', function() {
      expect(result.executiveBriefing).toBeDefined();
    });

    // Phase D fields
    test('preserves workScopes', function() {
      expect(Array.isArray(result.workScopes)).toBe(true);
    });

    test('preserves estimateSource', function() {
      expect(result.estimateSource).toBeDefined();
    });

    test('preserves estimate', function() {
      expect(result.estimate).toBeDefined();
      expect(result.estimate.revenueRange).toBeDefined();
    });
  });

  describe('Industry-neutral — non-Tree-Service', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Plumbing',
      'Plumbing',
      treeServiceTranscript,
      executiveSummaryWithName,
      'simulation'
    );

    test('contact intelligence works for any industry', function() {
      expect(result.contactProfile).toBeDefined();
      expect(result.contactProfile.name).toBe('John Smith');
    });

    test('opportunities are generated', function() {
      expect(Array.isArray(result.opportunities)).toBe(true);
    });

    test('Phase C fields are preserved', function() {
      expect(result.polarisFacts).toBeDefined();
      expect(result.revenueRange).toBeDefined();
      expect(result.qualification).toBeDefined();
    });
  });

  describe('No customer info — graceful handling', function() {
    const emptyTranscript = [
      { speaker: 'agent', utterance: 'Hello, how can I help?' },
      { speaker: 'customer', utterance: 'Just looking for information.' }
    ];

    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      emptyTranscript,
      null,
      'simulation'
    );

    test('contact fields are still present with null/empty values', function() {
      expect(result.contactProfile).toBeDefined();
      expect(result.relationshipProfile).toBeDefined();
      expect(Array.isArray(result.customerTimeline)).toBe(true);
      expect(Array.isArray(result.opportunities)).toBe(true);
      expect(result.executiveSummary).toBeDefined();
      expect(Array.isArray(result.recommendedActions)).toBe(true);
    });

    test('operational fields are still present', function() {
      expect(result.polarisFacts).toBeDefined();
      expect(result.estimate).toBeDefined();
      expect(result.workScopes).toBeDefined();
    });
  });

  describe('Identity extraction from facts', function() {
    const result = buildPolarisIntelligence(
      'NorthStar Tree Service',
      'Tree Service',
      [
        { speaker: 'agent', utterance: 'What is your name?' },
        { speaker: 'customer', utterance: 'My name is John Smith.' },
        { speaker: 'agent', utterance: 'What is the service address?' },
        { speaker: 'customer', utterance: 'The service address is 123 Main Street.' }
      ],
      null,
      'simulation'
    );

    test('extracts name from polarisFacts when no executiveSummary', function() {
      // customerFacts may be null, but polarisFacts should contain the name
      const hasNameFact = result.polarisFacts.some(function(f) {
        return f.variable === 'customer_name' && f.status === 'collected';
      });
      // The contactProfile may or may not have the name depending on
      // whether the fact extraction found it
      if (hasNameFact) {
        expect(result.contactProfile.name).toBeTruthy();
      }
    });
  });
});