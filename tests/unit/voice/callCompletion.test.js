/**
 * Unit Tests: Call Completion Pipeline
 *
 * Tests for src/voice/callCompletion.js
 * - Executive summary generation
 * - Action item generation
 * - Follow-up recommendations
 * - Lead management
 * - Timeline entries
 * - Helper functions (topic extraction, sentiment, etc.)
 */

'use strict';

const callCompletion = require('../../../src/voice/callCompletion');

describe('Call Completion Pipeline', () => {
  // ── generateExecutiveSummary ───────────────────────────────

  describe('generateExecutiveSummary', () => {
    const sampleCallData = {
      callId: 'call_123',
      duration: 180000, // 3 minutes
      transcript: 'Hello, my name is John Smith. I need tree removal service for my property at 123 Oak Street. Can you give me a quote? I\'d like to schedule an appointment for Tuesday afternoon.',
      analysis: {
        customer_name: 'John Smith',
        service_requested: 'Tree Removal',
        estimated_amount: 2500,
        preferred_time: 'Tuesday afternoon',
        summary: 'Customer needs tree removal at 123 Oak Street',
      },
    };

    test('generates summary from analysis data', () => {
      const summary = callCompletion.generateExecutiveSummary(sampleCallData, null);
      expect(summary.callId).toBe('call_123');
      expect(summary.customerName).toBe('John Smith');
      expect(summary.serviceRequested).toBe('Tree Removal');
      expect(summary.estimatedAmount).toBe(2500);
      expect(summary.appointmentRequested).toBe(true);
      expect(summary.preferredTime).toBe('Tuesday afternoon');
    });

    test('extracts customer name from transcript when analysis missing', () => {
      const data = {
        callId: 'call_456',
        duration: 120000,
        transcript: 'Hi, my name is Jane Doe and I need roof repair.',
        analysis: {},
      };
      const summary = callCompletion.generateExecutiveSummary(data, null);
      expect(summary.customerName).toBe('Jane Doe');
    });

    test('handles empty transcript gracefully', () => {
      const data = {
        callId: 'call_789',
        duration: 0,
        transcript: '',
        analysis: {},
      };
      const summary = callCompletion.generateExecutiveSummary(data, null);
      expect(summary.callId).toBe('call_789');
      expect(summary.customerName).toBe('Unknown');
      expect(summary.keyTopics).toEqual([]);
    });

    test('formats duration correctly', () => {
      const data = {
        callId: 'call',
        duration: 245000, // 4m 5s
        transcript: '',
        analysis: {},
      };
      const summary = callCompletion.generateExecutiveSummary(data, null);
      expect(summary.durationFormatted).toBe('4m 5s');
    });

    test('extracts key topics from transcript', () => {
      const data = {
        callId: 'call',
        duration: 60000,
        transcript: 'I need a quote for emergency tree removal. How much will it cost? Can you come tomorrow?',
        analysis: {},
      };
      const summary = callCompletion.generateExecutiveSummary(data, null);
      expect(summary.keyTopics).toContain('pricing');
      expect(summary.keyTopics).toContain('emergency');
      expect(summary.keyTopics).toContain('scheduling');
    });

    test('defaults appointmentRequested to false', () => {
      const data = {
        callId: 'call',
        duration: 60000,
        transcript: 'Just calling for information about your services.',
        analysis: {},
      };
      const summary = callCompletion.generateExecutiveSummary(data, null);
      expect(summary.appointmentRequested).toBe(false);
    });
  });

  // ── generateActionItems ────────────────────────────────────

  describe('generateActionItems', () => {
    test('always includes a follow-up action', () => {
      const summary = { appointmentRequested: false };
      const items = callCompletion.generateActionItems({}, summary);
      const followUp = items.find(i => i.type === 'follow_up');
      expect(followUp).toBeDefined();
      expect(followUp.priority).toBe('medium');
    });

    test('gives high priority follow-up when appointment requested', () => {
      const summary = {
        appointmentRequested: true,
        preferredTime: 'Wednesday morning',
      };
      const items = callCompletion.generateActionItems({}, summary);
      const followUp = items.find(i => i.type === 'follow_up');
      expect(followUp.priority).toBe('high');
      expect(followUp.description).toContain('Wednesday morning');
    });

    test('includes prepare_estimate when service discussed but no appointment', () => {
      const summary = {
        appointmentRequested: false,
        serviceRequested: 'Plumbing repair',
      };
      const items = callCompletion.generateActionItems({}, summary);
      const estimateAction = items.find(i => i.type === 'prepare_estimate');
      expect(estimateAction).toBeDefined();
      expect(estimateAction.priority).toBe('medium');
    });

    test('includes enrich_lead when customer name is unknown', () => {
      const summary = {
        appointmentRequested: false,
        customerName: 'Unknown',
      };
      const items = callCompletion.generateActionItems({}, summary);
      const enrichAction = items.find(i => i.type === 'enrich_lead');
      expect(enrichAction).toBeDefined();
      expect(enrichAction.priority).toBe('low');
    });

    test('does not include enrich_lead when customer name is known', () => {
      const summary = {
        appointmentRequested: false,
        customerName: 'John Smith',
      };
      const items = callCompletion.generateActionItems({}, summary);
      const enrichAction = items.find(i => i.type === 'enrich_lead');
      expect(enrichAction).toBeUndefined();
    });

    test('all items have dueBy dates in the future', () => {
      const summary = { appointmentRequested: false };
      const items = callCompletion.generateActionItems({}, summary);
      const now = Date.now();
      items.forEach(item => {
        expect(new Date(item.dueBy).getTime()).toBeGreaterThan(now);
      });
    });
  });

  // ── generateFollowUpRecommendations ────────────────────────

  describe('generateFollowUpRecommendations', () => {
    test('recommends scheduling when appointment requested', () => {
      const summary = { appointmentRequested: true, preferredTime: 'Friday' };
      const recs = callCompletion.generateFollowUpRecommendations(summary);
      const scheduleRec = recs.find(r => r.action === 'schedule_estimate');
      expect(scheduleRec).toBeDefined();
      expect(scheduleRec.priority).toBe('high');
    });

    test('recommends thank-you for positive sentiment', () => {
      const summary = { sentiment: 'positive' };
      const recs = callCompletion.generateFollowUpRecommendations(summary);
      const thankRec = recs.find(r => r.action === 'send_thank_you');
      expect(thankRec).toBeDefined();
    });

    test('recommends service recovery for negative sentiment', () => {
      const summary = { sentiment: 'negative' };
      const recs = callCompletion.generateFollowUpRecommendations(summary);
      const recoveryRec = recs.find(r => r.action === 'service_recovery');
      expect(recoveryRec).toBeDefined();
      expect(recoveryRec.priority).toBe('high');
    });

    test('recommends estimate when pricing topics discussed', () => {
      const summary = { keyTopics: ['pricing', 'service'] };
      const recs = callCompletion.generateFollowUpRecommendations(summary);
      const estimateRec = recs.find(r => r.action === 'send_estimate');
      expect(estimateRec).toBeDefined();
    });

    test('returns empty array when nothing to recommend', () => {
      const summary = {
        appointmentRequested: false,
        sentiment: 'neutral',
        keyTopics: [],
      };
      const recs = callCompletion.generateFollowUpRecommendations(summary);
      expect(recs).toEqual([]);
    });
  });

  // ── extractKeyTopics ───────────────────────────────────────

  describe('extractKeyTopics', () => {
    test('detects pricing topic', () => {
      const topics = callCompletion.extractKeyTopics('How much does this cost? What is the price?');
      expect(topics).toContain('pricing');
    });

    test('detects scheduling topic', () => {
      const topics = callCompletion.extractKeyTopics('Can you come tomorrow? When are you available?');
      expect(topics).toContain('scheduling');
    });

    test('detects emergency topic', () => {
      const topics = callCompletion.extractKeyTopics('I have a flood! This is an emergency!');
      expect(topics).toContain('emergency');
    });

    test('detects service topic', () => {
      const topics = callCompletion.extractKeyTopics('I need to repair my roof');
      expect(topics).toContain('service');
    });

    test('detects warranty topic', () => {
      const topics = callCompletion.extractKeyTopics('Do you offer a warranty on the work?');
      expect(topics).toContain('warranty');
    });

    test('detects multiple topics', () => {
      const topics = callCompletion.extractKeyTopics(
        'I need an emergency plumbing repair. How much will it cost? Can you come today?'
      );
      expect(topics).toContain('emergency');
      expect(topics).toContain('service');
      expect(topics).toContain('pricing');
      expect(topics).toContain('scheduling');
    });

    test('returns empty array for empty transcript', () => {
      expect(callCompletion.extractKeyTopics('')).toEqual([]);
    });
  });

  // ── estimateSentiment ──────────────────────────────────────

  describe('estimateSentiment', () => {
    test('detects positive sentiment', () => {
      const result = callCompletion.estimateSentiment(
        'Thank you so much! That is great, I really appreciate your help. You are wonderful!'
      );
      expect(result).toBe('positive');
    });

    test('detects negative sentiment', () => {
      const result = callCompletion.estimateSentiment(
        'This is terrible. I am very frustrated and disappointed with this awful service.'
      );
      expect(result).toBe('negative');
    });

    test('detects urgent sentiment with frustration', () => {
      const result = callCompletion.estimateSentiment(
        'This is an emergency! My basement is flooding right now! I am so frustrated!'
      );
      expect(result).toBe('frustrated');
    });

    test('detects urgent sentiment', () => {
      const result = callCompletion.estimateSentiment(
        'This is an emergency! I need someone here right now, immediately! This is urgent!'
      );
      expect(result).toBe('urgent');
    });

    test('returns neutral for balanced transcript', () => {
      const result = callCompletion.estimateSentiment(
        'I need a quote for tree removal. What times are you available?'
      );
      expect(result).toBe('neutral');
    });

    test('returns neutral for empty transcript', () => {
      expect(callCompletion.estimateSentiment('')).toBe('neutral');
    });

    test('positive words outweigh negative words', () => {
      const result = callCompletion.estimateSentiment(
        'The price was terrible but your service was great and wonderful, thank you!'
      );
      expect(result).toBe('positive');
    });
  });

  // ── generateTimelineEntry ──────────────────────────────────

  describe('generateTimelineEntry', () => {
    test('creates a valid timeline entry', () => {
      const summary = {
        callId: 'call_123',
        duration: 180000,
        sentiment: 'positive',
        keyTopics: ['pricing', 'scheduling'],
        summary: 'Customer called about tree removal',
        appointmentRequested: true,
      };
      const entry = callCompletion.generateTimelineEntry(summary, 'lead_456');

      expect(entry.id).toBeDefined();
      expect(entry.leadId).toBe('lead_456');
      expect(entry.type).toBe('call');
      expect(entry.timestamp).toBeDefined();
      expect(entry.title).toContain('Estimate Requested');
      expect(entry.metadata.callId).toBe('call_123');
      expect(entry.metadata.sentiment).toBe('positive');
    });

    test('uses generic title when no appointment', () => {
      const summary = {
        appointmentRequested: false,
      };
      const entry = callCompletion.generateTimelineEntry(summary, 'lead_1');
      expect(entry.title).toContain('Call Completed');
    });

    test('includes all metadata fields', () => {
      const summary = {
        callId: 'call',
        duration: 60000,
        sentiment: 'neutral',
        keyTopics: [],
        appointmentRequested: false,
      };
      const entry = callCompletion.generateTimelineEntry(summary, 'lead');
      expect(entry.metadata).toHaveProperty('callId');
      expect(entry.metadata).toHaveProperty('duration');
      expect(entry.metadata).toHaveProperty('sentiment');
      expect(entry.metadata).toHaveProperty('keyTopics');
      expect(entry.metadata).toHaveProperty('appointmentRequested');
    });
  });

  // ── formatDuration ─────────────────────────────────────────
  // (tested indirectly via generateExecutiveSummary)

  describe('duration formatting', () => {
    test('formats seconds only', () => {
      const summary = callCompletion.generateExecutiveSummary(
        { callId: 'c1', duration: 45000, transcript: '', analysis: {} },
        null
      );
      expect(summary.durationFormatted).toBe('45s');
    });

    test('formats minutes and seconds', () => {
      const summary = callCompletion.generateExecutiveSummary(
        { callId: 'c2', duration: 185000, transcript: '', analysis: {} },
        null
      );
      expect(summary.durationFormatted).toBe('3m 5s');
    });

    test('formats zero duration', () => {
      const summary = callCompletion.generateExecutiveSummary(
        { callId: 'c3', duration: 0, transcript: '', analysis: {} },
        null
      );
      expect(summary.durationFormatted).toBe('0s');
    });
  });
});
