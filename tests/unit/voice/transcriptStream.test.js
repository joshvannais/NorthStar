/**
 * Unit Tests: Transcript Stream
 *
 * Tests for src/voice/transcriptStream.js
 * - addSegment / getTranscript
 * - Segment eviction at max capacity
 * - clearSession, updateLastSegment, getActiveSessions
 */

'use strict';

// Mock the EventBus before importing transcriptStream
jest.mock('../../../src/voice/businessEvents', () => {
  const actual = jest.requireActual('../../../src/voice/businessEvents');
  return {
    ...actual,
    eventBus: {
      emit: jest.fn().mockResolvedValue({ emitted: true, handlerCount: 0, errors: 0 }),
      on: jest.fn(),
      getHistory: jest.fn().mockReturnValue([]),
      reset: jest.fn(),
    },
    EVENT_TYPES: actual.EVENT_TYPES,
    createEvent: actual.createEvent,
  };
});

const {
  addSegment,
  getTranscript,
  getSegmentCount,
  clearSession,
  updateLastSegment,
  getActiveSessions,
  clearAll,
  TRANSCRIPT_EVENT_TYPE,
  MAX_SEGMENTS,
} = require('../../../src/voice/transcriptStream');

describe('Transcript Stream', () => {
  beforeEach(() => {
    clearAll();
    jest.clearAllMocks();
  });

  // ── addSegment ──────────────────────────────────────────────

  describe('addSegment', () => {
    test('adds a segment and assigns segmentIndex', () => {
      const seg = addSegment('session-1', {
        text: 'Hello, how can I help you?',
        speaker: 'ai',
      });

      expect(seg.segmentIndex).toBe(0);
      expect(seg.text).toBe('Hello, how can I help you?');
      expect(seg.speaker).toBe('ai');
      expect(seg.timestamp).toBeDefined();
    });

    test('increments segmentIndex for subsequent segments', () => {
      addSegment('session-1', { text: 'First', speaker: 'ai' });
      addSegment('session-1', { text: 'Second', speaker: 'customer' });
      const seg3 = addSegment('session-1', { text: 'Third', speaker: 'ai' });

      expect(seg3.segmentIndex).toBe(2);
    });

    test('defaults speaker to unknown', () => {
      const seg = addSegment('session-1', { text: 'Some text' });
      expect(seg.speaker).toBe('unknown');
    });

    test('uses provided timestamp', () => {
      const ts = '2026-07-17T12:00:00.000Z';
      const seg = addSegment('session-1', { text: 'Hello', timestamp: ts });
      expect(seg.timestamp).toBe(ts);
    });

    test('throws if sessionId is missing', () => {
      expect(() => addSegment(null, { text: 'hello' })).toThrow('sessionId is required');
    });

    test('throws if segment text is missing', () => {
      expect(() => addSegment('session-1', {})).toThrow('segment text is required');
    });

    test('emits transcript_segment event to EventBus', () => {
      const { eventBus } = require('../../../src/voice/businessEvents');
      addSegment('session-1', { text: 'Hello', speaker: 'customer' });

      expect(eventBus.emit).toHaveBeenCalled();
      const callArgs = eventBus.emit.mock.calls[0][0];
      expect(callArgs.type).toBe(TRANSCRIPT_EVENT_TYPE);
      expect(callArgs.sessionId).toBe('session-1');
      expect(callArgs.data.text).toBe('Hello');
      expect(callArgs.data.speaker).toBe('customer');
    });
  });

  // ── getTranscript ───────────────────────────────────────────

  describe('getTranscript', () => {
    test('returns all segments for a session', () => {
      addSegment('session-1', { text: 'A', speaker: 'ai' });
      addSegment('session-1', { text: 'B', speaker: 'customer' });
      addSegment('session-1', { text: 'C', speaker: 'ai' });

      const transcript = getTranscript('session-1');
      expect(transcript).toHaveLength(3);
      expect(transcript[0].text).toBe('A');
      expect(transcript[1].text).toBe('B');
      expect(transcript[2].text).toBe('C');
    });

    test('returns empty array for unknown session', () => {
      const transcript = getTranscript('nonexistent');
      expect(transcript).toEqual([]);
    });

    test('returns segments since a given index', () => {
      addSegment('session-2', { text: 'One' });
      addSegment('session-2', { text: 'Two' });
      addSegment('session-2', { text: 'Three' });
      addSegment('session-2', { text: 'Four' });

      const since = getTranscript('session-2', 2);
      expect(since).toHaveLength(2);
      expect(since[0].text).toBe('Three');
      expect(since[1].text).toBe('Four');
    });

    test('sinceIndex with no matching segments returns empty', () => {
      addSegment('session-3', { text: 'Hello' });
      const result = getTranscript('session-3', 100);
      expect(result).toEqual([]);
    });
  });

  // ── getSegmentCount ─────────────────────────────────────────

  describe('getSegmentCount', () => {
    test('returns correct count', () => {
      expect(getSegmentCount('session-1')).toBe(0);
      addSegment('session-1', { text: 'A' });
      expect(getSegmentCount('session-1')).toBe(1);
      addSegment('session-1', { text: 'B' });
      expect(getSegmentCount('session-1')).toBe(2);
    });

    test('returns 0 for unknown session', () => {
      expect(getSegmentCount('nonexistent')).toBe(0);
    });
  });

  // ── clearSession ────────────────────────────────────────────

  describe('clearSession', () => {
    test('removes all segments for a session', () => {
      addSegment('session-1', { text: 'A' });
      addSegment('session-1', { text: 'B' });

      const had = clearSession('session-1');
      expect(had).toBe(true);
      expect(getTranscript('session-1')).toEqual([]);
      expect(getSegmentCount('session-1')).toBe(0);
    });

    test('returns false for unknown session', () => {
      const had = clearSession('nonexistent');
      expect(had).toBe(false);
    });

    test('reseeds next index after clear', () => {
      addSegment('session-5', { text: 'First' });
      clearSession('session-5');
      const seg = addSegment('session-5', { text: 'New first' });
      expect(seg.segmentIndex).toBe(0);
    });
  });

  // ── updateLastSegment ───────────────────────────────────────

  describe('updateLastSegment', () => {
    test('updates last segment text for same speaker', () => {
      addSegment('session-1', { text: 'I need help with', speaker: 'customer' });
      const updated = updateLastSegment('session-1', { text: 'I need help with my roof', speaker: 'customer' });

      expect(updated.text).toBe('I need help with my roof');
      expect(updated.speaker).toBe('customer');

      const transcript = getTranscript('session-1');
      expect(transcript).toHaveLength(1);
      expect(transcript[0].text).toBe('I need help with my roof');
    });

    test('adds new segment when speaker changes', () => {
      addSegment('session-1', { text: 'Hello', speaker: 'ai' });
      const added = updateLastSegment('session-1', { text: 'Hi there', speaker: 'customer' });

      expect(added.segmentIndex).toBe(1);
      expect(added.speaker).toBe('customer');

      const transcript = getTranscript('session-1');
      expect(transcript).toHaveLength(2);
    });

    test('adds new segment when session has no segments yet', () => {
      const seg = updateLastSegment('session-new', { text: 'First message', speaker: 'customer' });
      expect(seg.segmentIndex).toBe(0);
    });
  });

  // ── getActiveSessions ───────────────────────────────────────

  describe('getActiveSessions', () => {
    test('returns session IDs with segments', () => {
      addSegment('sess-a', { text: 'A' });
      addSegment('sess-b', { text: 'B' });

      const active = getActiveSessions();
      expect(active).toContain('sess-a');
      expect(active).toContain('sess-b');
      expect(active).toHaveLength(2);
    });

    test('returns empty array when no sessions', () => {
      expect(getActiveSessions()).toEqual([]);
    });

    test('cleared sessions are removed', () => {
      addSegment('sess-x', { text: 'X' });
      clearSession('sess-x');
      expect(getActiveSessions()).not.toContain('sess-x');
    });
  });

  // ── Eviction at MAX_SEGMENTS ────────────────────────────────

  describe('segment eviction', () => {
    test('evicts oldest segments when exceeding MAX_SEGMENTS', () => {
      // We'll test eviction with a smaller batch. MAX_SEGMENTS is 1000,
      // but we can test the logic with a large number.
      const sessionId = 'eviction-test';

      // Add 1005 segments
      for (let i = 0; i < 1005; i++) {
        addSegment(sessionId, { text: `Segment ${i}` });
      }

      const transcript = getTranscript(sessionId);
      // Should have at most MAX_SEGMENTS (1000)
      expect(transcript.length).toBeLessThanOrEqual(MAX_SEGMENTS);
      expect(transcript.length).toBe(1000);

      // The first segment should be segmentIndex 5 (evicted 0-4)
      expect(transcript[0].segmentIndex).toBe(5);
      // The last segment should be segmentIndex 1004
      expect(transcript[transcript.length - 1].segmentIndex).toBe(1004);
    });
  });

  // ── clearAll ────────────────────────────────────────────────

  describe('clearAll', () => {
    test('clears all sessions', () => {
      addSegment('s1', { text: 'A' });
      addSegment('s2', { text: 'B' });
      addSegment('s3', { text: 'C' });

      clearAll();

      expect(getActiveSessions()).toEqual([]);
      expect(getSegmentCount('s1')).toBe(0);
      expect(getSegmentCount('s2')).toBe(0);
      expect(getSegmentCount('s3')).toBe(0);
    });
  });
});
