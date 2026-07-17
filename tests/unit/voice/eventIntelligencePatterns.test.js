/**
 * Unit Tests: Event Intelligence — Pattern Detection (Part 4)
 *
 * Tests for transcript pattern detection functions in
 * src/voice/eventIntelligence.js
 */

'use strict';

// Mock businessEvents before require to prevent EventBus side-effects
jest.mock('../../../src/voice/businessEvents', () => ({
  EVENT_TYPES: {
    CALL_STARTED: 'call_started',
    CUSTOMER_VERIFIED: 'customer_verified',
    ESTIMATE_REQUESTED: 'estimate_requested',
    PRICING_QUESTION: 'pricing_question',
    OBJECTION_DETECTED: 'objection_detected',
    UPSELL_DETECTED: 'upsell_detected',
    COMPETITOR_MENTIONED: 'competitor_mentioned',
    APPOINTMENT_REQUESTED: 'appointment_requested',
    TECHNICIAN_REQUESTED: 'technician_requested',
    PAYMENT_QUESTION: 'payment_question',
    CALL_TRANSFERRED: 'call_transferred',
    CALL_COMPLETED: 'call_completed',
  },
  on: jest.fn(),
  emit: jest.fn().mockResolvedValue({ emitted: true }),
  eventBus: {
    emit: jest.fn().mockResolvedValue({ emitted: true }),
    on: jest.fn(),
    getHistory: jest.fn().mockReturnValue([]),
    reset: jest.fn(),
  },
  createEvent: jest.fn((type, opts) => ({ type, sessionId: opts?.sessionId, data: opts?.data || {} })),
}));

jest.mock('../../../src/voice/transcriptStream', () => ({
  TRANSCRIPT_EVENT_TYPE: 'transcript_segment',
  addSegment: jest.fn(),
  getTranscript: jest.fn().mockReturnValue([]),
}));

const {
  detectEmergency,
  detectHighValue,
  detectPricingDiscussion,
  detectReturningCustomer,
  detectSchedulingConflict,
  detectHesitation,
  detectObjection,
  detectEscalationNeed,
  handleTranscriptSegment,
  getSessionGuidance,
  clearSessionGuidance,
} = require('../../../src/voice/eventIntelligence');

describe('Pattern Detection — detectEmergency', () => {
  test('detects high severity: flood', () => {
    const result = detectEmergency('I have a flood in my basement!');
    expect(result).not.toBeNull();
    expect(result.type).toBe('emergency_detected');
    expect(result.severity).toBe('high');
    expect(result.internal).toBe(true);
  });

  test('detects high severity: fire', () => {
    const result = detectEmergency('There is a fire in the attic');
    expect(result.severity).toBe('high');
  });

  test('detects high severity: emergency', () => {
    const result = detectEmergency('This is an emergency, please help');
    expect(result.severity).toBe('high');
  });

  test('detects medium severity: urgent', () => {
    const result = detectEmergency('I need this done urgent');
    expect(result.severity).toBe('medium');
  });

  test('detects medium severity: ASAP', () => {
    const result = detectEmergency('Can you come ASAP?');
    expect(result.severity).toBe('medium');
  });

  test('detects low severity: broken', () => {
    const result = detectEmergency('My gutter is broken');
    expect(result.severity).toBe('low');
  });

  test('returns null for non-emergency text', () => {
    const result = detectEmergency('I would like to get an estimate');
    expect(result).toBeNull();
  });

  test('handles null/empty input', () => {
    expect(detectEmergency(null)).toBeNull();
    expect(detectEmergency('')).toBeNull();
  });
});

describe('Pattern Detection — detectHighValue', () => {
  test('detects whole house project', () => {
    const result = detectHighValue('I need my whole house remodeled');
    expect(result).not.toBeNull();
    expect(result.type).toBe('high_value_opportunity');
    expect(result.confidence).toBe(0.25);
  });

  test('detects multiple high-value indicators', () => {
    const result = detectHighValue('I have a large project, commercial building, premium finish');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  test('detects luxury keywords', () => {
    const result = detectHighValue('Looking for luxury custom design');
    expect(result.confidence).toBe(0.25);
  });

  test('returns null for non-high-value text', () => {
    const result = detectHighValue('Just need a small repair');
    expect(result).toBeNull();
  });

  test('handles null/empty input', () => {
    expect(detectHighValue(null)).toBeNull();
    expect(detectHighValue('')).toBeNull();
  });
});

describe('Pattern Detection — detectPricingDiscussion', () => {
  test('detects cost discussion', () => {
    const result = detectPricingDiscussion('How much does this cost?');
    expect(result).not.toBeNull();
    expect(result.type).toBe('pricing_discussion');
  });

  test('detects quote request', () => {
    const result = detectPricingDiscussion('Can I get a quote?');
    expect(result.type).toBe('pricing_discussion');
  });

  test('detects estimate request', () => {
    const result = detectPricingDiscussion('I need an estimate for my roof');
    expect(result.type).toBe('pricing_discussion');
  });

  test('detects rate inquiry', () => {
    const result = detectPricingDiscussion('What is your rate?');
    expect(result.type).toBe('pricing_discussion');
  });

  test('returns null for non-pricing text', () => {
    const result = detectPricingDiscussion('What is your service area?');
    expect(result).toBeNull();
  });

  test('handles null/empty input', () => {
    expect(detectPricingDiscussion(null)).toBeNull();
    expect(detectPricingDiscussion('')).toBeNull();
  });
});

describe('Pattern Detection — detectReturningCustomer', () => {
  test('detects "used you before"', () => {
    const result = detectReturningCustomer('I used you before for my roof');
    expect(result).not.toBeNull();
    expect(result.type).toBe('returning_customer');
  });

  test('detects "hired you previously"', () => {
    const result = detectReturningCustomer('We hired you last year for siding');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  test('detects "the work you did"', () => {
    const result = detectReturningCustomer('The work you did on my deck was great');
    expect(result.type).toBe('returning_customer');
    expect(result.confidence).toBe(0.5);
  });

  test('detects "loyal customer"', () => {
    const result = detectReturningCustomer('I am a loyal customer');
    expect(result.confidence).toBe(0.5);
  });

  test('returns null for new customer language', () => {
    const result = detectReturningCustomer('This is my first time reaching out to you');
    expect(result).toBeNull();
  });

  test('handles null/empty input', () => {
    expect(detectReturningCustomer(null)).toBeNull();
    expect(detectReturningCustomer('')).toBeNull();
  });
});

describe('Pattern Detection — detectSchedulingConflict', () => {
  test('detects "can\'t make it"', () => {
    const result = detectSchedulingConflict("I can't make it on Tuesday");
    expect(result).not.toBeNull();
    expect(result.type).toBe('scheduling_conflict');
  });

  test('detects busy schedule', () => {
    const result = detectSchedulingConflict('I am too busy this week');
    expect(result.type).toBe('scheduling_conflict');
  });

  test('detects unavailable', () => {
    const result = detectSchedulingConflict('I am unavailable until next month');
    expect(result.type).toBe('scheduling_conflict');
  });

  test('detects conflict', () => {
    const result = detectSchedulingConflict('That time is a conflict for my schedule');
    expect(result.type).toBe('scheduling_conflict');
  });

  test('returns null for flexible schedule', () => {
    const result = detectSchedulingConflict('Any time this week works for me');
    expect(result).toBeNull();
  });

  test('handles null/empty input', () => {
    expect(detectSchedulingConflict(null)).toBeNull();
    expect(detectSchedulingConflict('')).toBeNull();
  });
});

describe('Pattern Detection — detectHesitation', () => {
  test('detects high hesitation: not sure', () => {
    const result = detectHesitation('I am not sure about this');
    expect(result).not.toBeNull();
    expect(result.type).toBe('customer_hesitation');
    expect(result.level).toBe('high');
  });

  test('detects high hesitation: let me think', () => {
    const result = detectHesitation('Let me think about it');
    expect(result.level).toBe('high');
  });

  test('detects medium hesitation: maybe', () => {
    const result = detectHesitation('Maybe we can do it later');
    expect(result.level).toBe('medium');
  });

  test('detects low hesitation: um', () => {
    const result = detectHesitation('Um, I guess that could work');
    expect(result.level).toBe('low');
  });

  test('returns null for decisive language', () => {
    const result = detectHesitation('Yes, let us do it!');
    expect(result).toBeNull();
  });

  test('handles null/empty input', () => {
    expect(detectHesitation(null)).toBeNull();
    expect(detectHesitation('')).toBeNull();
  });
});

describe('Pattern Detection — detectObjection', () => {
  test('detects price objection', () => {
    const result = detectObjection('That is too expensive for me');
    expect(result).not.toBeNull();
    expect(result.type).toBe('objection_detected');
    expect(result.objection_type).toBe('price');
  });

  test('detects disinterest', () => {
    const result = detectObjection('I am not interested, thanks');
    expect(result.objection_type).toBe('disinterest');
  });

  test('detects timing objection', () => {
    const result = detectObjection('Call me back next month');
    expect(result.objection_type).toBe('timing');
  });

  test('detects competition objection', () => {
    const result = detectObjection('I am shopping around for quotes');
    expect(result.objection_type).toBe('competition');
  });

  test('detects alternative objection', () => {
    const result = detectObjection('My husband will do it himself');
    expect(result.objection_type).toBe('alternative');
  });

  test('returns null for positive language', () => {
    const result = detectObjection('That sounds great, let us do it!');
    expect(result).toBeNull();
  });

  test('handles null/empty input', () => {
    expect(detectObjection(null)).toBeNull();
    expect(detectObjection('')).toBeNull();
  });
});

describe('Pattern Detection — detectEscalationNeed', () => {
  test('detects critical: lawsuit', () => {
    const result = detectEscalationNeed('I am going to file a lawsuit');
    expect(result).not.toBeNull();
    expect(result.type).toBe('escalation_recommended');
    expect(result.severity).toBe('critical');
  });

  test('detects critical: attorney', () => {
    const result = detectEscalationNeed('My attorney will contact you');
    expect(result.severity).toBe('critical');
  });

  test('detects high: manager', () => {
    const result = detectEscalationNeed('I want to speak to the manager');
    expect(result.severity).toBe('high');
  });

  test('detects high: real person', () => {
    const result = detectEscalationNeed('Can I talk to a real person?');
    expect(result.severity).toBe('high');
  });

  test('detects medium: complaint', () => {
    const result = detectEscalationNeed('I have a complaint about the service');
    expect(result.severity).toBe('medium');
  });

  test('detects medium: unacceptable', () => {
    const result = detectEscalationNeed('This is unacceptable!');
    expect(result.severity).toBe('medium');
  });

  test('returns null for normal conversation', () => {
    const result = detectEscalationNeed('Thank you for your help today');
    expect(result).toBeNull();
  });

  test('handles null/empty input', () => {
    expect(detectEscalationNeed(null)).toBeNull();
    expect(detectEscalationNeed('')).toBeNull();
  });
});

describe('handleTranscriptSegment', () => {
  beforeEach(() => {
    clearSessionGuidance('test-session');
  });

  test('processes segment and stores guidance', () => {
    const event = {
      type: 'transcript_segment',
      sessionId: 'test-session',
      data: { text: 'I have a flood in my basement and how much does it cost?' },
    };

    handleTranscriptSegment(event);

    const guidance = getSessionGuidance('test-session');
    // Should detect emergency + pricing
    expect(guidance.length).toBeGreaterThanOrEqual(2);
    expect(guidance.some(g => g.type === 'emergency_detected')).toBe(true);
    expect(guidance.some(g => g.type === 'pricing_discussion')).toBe(true);
  });

  test('stores multiple guidance events across segments', () => {
    handleTranscriptSegment({
      sessionId: 'test-session',
      data: { text: 'I need an estimate' },
    });
    handleTranscriptSegment({
      sessionId: 'test-session',
      data: { text: 'That is too expensive!' },
    });

    const guidance = getSessionGuidance('test-session');
    expect(guidance.length).toBeGreaterThanOrEqual(2);
  });

  test('skips empty text', () => {
    handleTranscriptSegment({
      sessionId: 'test-session',
      data: { text: '' },
    });
    expect(getSessionGuidance('test-session')).toEqual([]);
  });

  test('skips null sessionId', () => {
    handleTranscriptSegment({
      sessionId: null,
      data: { text: 'Hello' },
    });
    // Should not throw
  });

  test('reads text from segment object', () => {
    handleTranscriptSegment({
      sessionId: 'test-session',
      data: { segment: { text: 'I need to speak to your manager' } },
    });

    const guidance = getSessionGuidance('test-session');
    expect(guidance.some(g => g.type === 'escalation_recommended')).toBe(true);
  });
});

describe('getSessionGuidance / clearSessionGuidance', () => {
  test('returns empty array for unknown session', () => {
    expect(getSessionGuidance('nonexistent')).toEqual([]);
  });

  test('clears guidance for a session', () => {
    handleTranscriptSegment({
      sessionId: 'clear-test',
      data: { text: 'This is an emergency!' },
    });
    expect(getSessionGuidance('clear-test').length).toBeGreaterThan(0);

    clearSessionGuidance('clear-test');
    expect(getSessionGuidance('clear-test')).toEqual([]);
  });
});
