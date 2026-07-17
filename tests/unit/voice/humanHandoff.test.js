/**
 * Unit Tests: Human Handoff
 *
 * Tests for src/voice/humanHandoff.js
 * - Escalation trigger detection (6 triggers)
 * - State preservation on escalation
 * - Resolve escalation
 */

'use strict';

const {
  checkEscalation,
  initiateEscalation,
  resolveEscalation,
  getEscalationStatus,
  getActiveEscalations,
  clearAll,
} = require('../../../src/voice/humanHandoff');

describe('Human Handoff', () => {
  beforeEach(() => {
    clearAll();
  });

  // ── checkEscalation: Trigger 1 — Explicit Request ───────────

  describe('checkEscalation — explicit request', () => {
    test('detects "I want to speak to a human"', () => {
      const segments = [
        { speaker: 'customer', text: 'I want to speak to a human, not a robot' },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reasons.some(r => r.trigger === 'explicit_request')).toBe(true);
      expect(result.reasons.find(r => r.trigger === 'explicit_request').severity).toBe('high');
    });

    test('detects "get me the manager"', () => {
      const segments = [
        { speaker: 'customer', text: 'Get me the manager right now' },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reasons.some(r => r.trigger === 'explicit_request')).toBe(true);
    });

    test('detects "transfer me to a supervisor"', () => {
      const segments = [
        { speaker: 'customer', text: 'Please transfer me to a supervisor' },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reasons.some(r => r.trigger === 'explicit_request')).toBe(true);
    });
  });

  // ── checkEscalation: Trigger 2 — Billing Dispute ────────────

  describe('checkEscalation — billing dispute', () => {
    test('detects pricing concern + negative sentiment', () => {
      const segments = [
        { speaker: 'customer', text: 'You overcharged me and I am furious about this!' },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.shouldEscalate).toBe(true);
      const billingReason = result.reasons.find(r => r.trigger === 'billing_dispute');
      expect(billingReason).toBeDefined();
      if (billingReason) expect(billingReason.severity).toBe('high');
    });

    test('detects billing dispute with refund demand', () => {
      const segments = [
        { speaker: 'customer', text: 'This is wrong, I want a refund. This is ridiculous!' },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reasons.some(r => r.trigger === 'billing_dispute')).toBe(true);
    });

    test('no escalation for pricing without negative sentiment', () => {
      const segments = [
        { speaker: 'customer', text: 'I have a question about my bill' },
      ];

      const result = checkEscalation('session-1', segments);
      // Should not trigger billing_dispute (needs negative sentiment too)
      const hasBillingDispute = result.reasons.some(r => r.trigger === 'billing_dispute');
      expect(hasBillingDispute).toBe(false);
    });
  });

  // ── checkEscalation: Trigger 3 — Legal Concern ──────────────

  describe('checkEscalation — legal concern', () => {
    test('detects lawsuit keyword', () => {
      const segments = [
        { speaker: 'customer', text: 'I am going to sue you and file a lawsuit' },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.shouldEscalate).toBe(true);
      const legalReason = result.reasons.find(r => r.trigger === 'legal_concern');
      expect(legalReason).toBeDefined();
      if (legalReason) expect(legalReason.severity).toBe('critical');
    });

    test('detects attorney mention', () => {
      const segments = [
        { speaker: 'customer', text: 'My attorney will be contacting you' },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reasons.some(r => r.trigger === 'legal_concern')).toBe(true);
    });

    test('detects complaint filing threat', () => {
      const segments = [
        { speaker: 'customer', text: 'I am going to file a complaint with the BBB' },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reasons.some(r => r.trigger === 'legal_concern')).toBe(true);
    });
  });

  // ── checkEscalation: Trigger 4 — Low Confidence ─────────────

  describe('checkEscalation — low confidence', () => {
    test('detects low_confidence from Retell analysis tags', () => {
      const segments = [{ speaker: 'customer', text: 'Hello' }];

      const result = checkEscalation('session-1', segments, null, {
        retellAnalysisTags: ['low_confidence', 'unclear_intent'],
      });

      expect(result.shouldEscalate).toBe(true);
      expect(result.reasons.some(r => r.trigger === 'low_confidence')).toBe(true);
    });

    test('no escalation when Retell confidence is normal', () => {
      const segments = [{ speaker: 'customer', text: 'Hello' }];

      const result = checkEscalation('session-1', segments, null, {
        retellAnalysisTags: ['high_confidence', 'clear_intent'],
      });

      expect(result.reasons.some(r => r.trigger === 'low_confidence')).toBe(false);
    });
  });

  // ── checkEscalation: Trigger 5 — Multiple Failed Responses ──

  describe('checkEscalation — multiple failures', () => {
    test('detects 3+ consecutive objections', () => {
      const segments = [
        { speaker: 'customer', text: 'I am not sure about this', segmentIndex: 0 },
        { speaker: 'customer', text: 'It seems too expensive', segmentIndex: 1 },
        { speaker: 'customer', text: 'Maybe call me back later', segmentIndex: 2 },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reasons.some(r => r.trigger === 'multiple_failures')).toBe(true);
    });

    test('no escalation with only 2 consecutive objections', () => {
      const segments = [
        { speaker: 'customer', text: 'I am not sure', segmentIndex: 0 },
        { speaker: 'customer', text: 'It is too expensive', segmentIndex: 1 },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.reasons.some(r => r.trigger === 'multiple_failures')).toBe(false);
    });

    test('streak breaks with non-objection in between', () => {
      const segments = [
        { speaker: 'customer', text: 'I am not sure', segmentIndex: 0 },
        { speaker: 'customer', text: 'Tell me more about the service', segmentIndex: 1 },
        { speaker: 'customer', text: 'It is too expensive', segmentIndex: 2 },
        { speaker: 'customer', text: 'Call me back', segmentIndex: 3 },
      ];

      const result = checkEscalation('session-1', segments);
      // Only last 2 are consecutive objections, so 3-consecutive not met
      expect(result.reasons.some(r => r.trigger === 'multiple_failures')).toBe(false);
    });
  });

  // ── checkEscalation: Trigger 6 — Conversation Deadlock ──────

  describe('checkEscalation — conversation deadlock', () => {
    test('detects same topic repeated 3+ times', () => {
      // Use the exact same set of long words so extractTopicWords produces identical output
      const segments = [
        { speaker: 'customer', text: 'need roof repair storm damage help', segmentIndex: 0 },
        { speaker: 'customer', text: 'roof repair storm damage need help', segmentIndex: 1 },
        { speaker: 'customer', text: 'repair storm damage need help roof', segmentIndex: 2 },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.shouldEscalate).toBe(true);
      expect(result.reasons.some(r => r.trigger === 'conversation_deadlock')).toBe(true);
    });

    test('no deadlock with varied topics', () => {
      const segments = [
        { speaker: 'customer', text: 'I need roof repair', segmentIndex: 0 },
        { speaker: 'customer', text: 'What about siding options?', segmentIndex: 1 },
        { speaker: 'customer', text: 'Can you do gutter cleaning?', segmentIndex: 2 },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.reasons.some(r => r.trigger === 'conversation_deadlock')).toBe(false);
    });

    test('needs at least 3 segments', () => {
      const segments = [
        { speaker: 'customer', text: 'Roof repair needed', segmentIndex: 0 },
        { speaker: 'customer', text: 'Need roof repaired', segmentIndex: 1 },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.reasons.some(r => r.trigger === 'conversation_deadlock')).toBe(false);
    });
  });

  // ── checkEscalation: Multiple triggers ──────────────────────

  describe('checkEscalation — multiple triggers', () => {
    test('can detect multiple escalation reasons', () => {
      const segments = [
        { speaker: 'customer', text: 'I want to speak to a manager about this billing error, I am furious!' },
      ];

      const result = checkEscalation('session-1', segments);
      expect(result.shouldEscalate).toBe(true);
      // Should trigger both explicit_request and billing_dispute
      const triggers = result.reasons.map(r => r.trigger);
      expect(triggers).toContain('explicit_request');
      expect(triggers).toContain('billing_dispute');
    });
  });

  // ── checkEscalation: Edge cases ─────────────────────────────

  describe('checkEscalation — edge cases', () => {
    test('empty segments returns no escalation', () => {
      const result = checkEscalation('session-1', []);
      expect(result.shouldEscalate).toBe(false);
      expect(result.reasons).toEqual([]);
    });

    test('null sessionId returns no escalation', () => {
      const result = checkEscalation(null, [{ speaker: 'customer', text: 'I want a manager' }]);
      expect(result.shouldEscalate).toBe(false);
    });

    test('only AI/system segments — no customer escalation triggers', () => {
      const segments = [
        { speaker: 'ai', text: 'I want to speak to a manager' },
        { speaker: 'system', text: 'This is an emergency' },
      ];

      const result = checkEscalation('session-1', segments);
      // These are not customer segments, so explicit_request won't trigger
      expect(result.reasons.some(r => r.trigger === 'explicit_request')).toBe(false);
    });
  });

  // ── initiateEscalation ──────────────────────────────────────

  describe('initiateEscalation', () => {
    test('creates escalation record with reason', () => {
      const esc = initiateEscalation('session-1', {
        trigger: 'explicit_request',
        detail: 'Customer asked for manager',
        severity: 'high',
      }, { snapshot: 'context-data' });

      expect(esc.sessionId).toBe('session-1');
      expect(esc.status).toBe('escalating');
      expect(esc.reason.trigger).toBe('explicit_request');
      expect(esc.triggeredAt).toBeDefined();
      expect(esc.preservedState).toBeDefined();
      expect(esc.preservedState.contextSnapshot).toEqual({ snapshot: 'context-data' });
    });

    test('throws if sessionId missing', () => {
      expect(() => initiateEscalation(null, {}, null)).toThrow('sessionId is required');
    });

    test('preserves context snapshot deep copy', () => {
      const context = { businessProfile: { company: { name: 'TestCo' } } };
      const esc = initiateEscalation('session-1', { trigger: 'manual', detail: 'test' }, context);

      // Modify original — should not affect preserved copy
      context.businessProfile.company.name = 'Changed';
      expect(esc.preservedState.contextSnapshot.businessProfile.company.name).toBe('TestCo');
    });
  });

  // ── resolveEscalation ───────────────────────────────────────

  describe('resolveEscalation', () => {
    test('resolves an escalation', () => {
      initiateEscalation('session-1', { trigger: 'test', detail: 'test' }, null);
      const resolved = resolveEscalation('session-1', { outcome: 'Human took over the call' });

      expect(resolved.status).toBe('resolved');
      expect(resolved.resolvedAt).toBeDefined();
      expect(resolved.resolution.outcome).toBe('Human took over the call');
    });

    test('returns null for unknown session', () => {
      const result = resolveEscalation('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ── getEscalationStatus ─────────────────────────────────────

  describe('getEscalationStatus', () => {
    test('returns escalation record', () => {
      initiateEscalation('session-1', { trigger: 'test', detail: 'test' }, null);
      const status = getEscalationStatus('session-1');

      expect(status).not.toBeNull();
      expect(status.sessionId).toBe('session-1');
      expect(status.status).toBe('escalating');
    });

    test('returns null for unknown session', () => {
      expect(getEscalationStatus('nonexistent')).toBeNull();
    });
  });

  // ── getActiveEscalations ────────────────────────────────────

  describe('getActiveEscalations', () => {
    test('returns only active (escalating) escalations', () => {
      initiateEscalation('s1', { trigger: 'test' }, null);
      initiateEscalation('s2', { trigger: 'test' }, null);
      resolveEscalation('s2');

      const active = getActiveEscalations();
      expect(active).toHaveLength(1);
      expect(active[0].sessionId).toBe('s1');
    });

    test('returns empty when no escalations', () => {
      expect(getActiveEscalations()).toEqual([]);
    });
  });

  // ── Full lifecycle ──────────────────────────────────────────

  describe('full escalation lifecycle', () => {
    test('escalate → check status → resolve → verify', () => {
      // Initiate
      const esc = initiateEscalation('lifecycle-1', {
        trigger: 'explicit_request',
        detail: 'Test lifecycle',
        severity: 'high',
      }, { test: true });

      expect(esc.status).toBe('escalating');

      // Check
      const status = getEscalationStatus('lifecycle-1');
      expect(status.status).toBe('escalating');

      // Resolve
      const resolved = resolveEscalation('lifecycle-1', { outcome: 'Resolved successfully' });
      expect(resolved.status).toBe('resolved');

      // Verify
      const final = getEscalationStatus('lifecycle-1');
      expect(final.status).toBe('resolved');
      expect(final.resolution.outcome).toBe('Resolved successfully');
    });
  });

  // ── clearAll ────────────────────────────────────────────────

  describe('clearAll', () => {
    test('clears all escalations', () => {
      initiateEscalation('s1', { trigger: 'test' }, null);
      initiateEscalation('s2', { trigger: 'test' }, null);

      clearAll();

      expect(getActiveEscalations()).toEqual([]);
      expect(getEscalationStatus('s1')).toBeNull();
      expect(getEscalationStatus('s2')).toBeNull();
    });
  });
});
