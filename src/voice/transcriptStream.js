/**
 * Transcript Stream — Real-time transcript segment management
 *
 * In-memory store for streaming transcript segments from Retell AI.
 * Emits transcript_segment events to the EventBus for live intelligence.
 *
 * Each segment: { timestamp, speaker: 'customer'|'ai'|'system', text, segmentIndex }
 * Max: 1000 segments per session (oldest evicted on overflow)
 */

'use strict';

const { eventBus, EVENT_TYPES, createEvent } = require('./businessEvents');

// ── In-memory transcript store ──────────────────────────────────

/** @type {Map<string, Array<{ timestamp: string, speaker: string, text: string, segmentIndex: number }>>} */
const _segments = new Map();

/** @type {Map<string, number>}  Next segment index per session */
const _nextIndex = new Map();

const MAX_SEGMENTS = 1000;

// Transcript-specific event type name (not in EVENT_TYPES enum but
// used as an internal event on the EventBus)
const TRANSCRIPT_EVENT_TYPE = 'transcript_segment';

/**
 * Add a transcript segment to a session.
 * Emits transcript_segment event to EventBus for intelligence handling.
 *
 * @param {string} sessionId
 * @param {Object} segment
 * @param {string} segment.text - The transcript text
 * @param {string} [segment.speaker] - 'customer' | 'ai' | 'system' (default: 'unknown')
 * @param {string} [segment.timestamp] - ISO timestamp (default: now)
 * @returns {Object} The stored segment with segmentIndex
 */
function addSegment(sessionId, segment) {
  if (!sessionId) throw new Error('sessionId is required');
  if (!segment || !segment.text) throw new Error('segment text is required');

  // Get or init index
  let idx = _nextIndex.get(sessionId) || 0;

  const stored = {
    timestamp: segment.timestamp || new Date().toISOString(),
    speaker: segment.speaker || 'unknown',
    text: String(segment.text).trim(),
    segmentIndex: idx,
  };

  // Get or init array
  let arr = _segments.get(sessionId);
  if (!arr) {
    arr = [];
    _segments.set(sessionId, arr);
  }

  // Evict oldest if at capacity
  if (arr.length >= MAX_SEGMENTS) {
    arr.shift();
  }

  arr.push(stored);
  _nextIndex.set(sessionId, idx + 1);

  // Emit transcript_segment event to EventBus (fire-and-forget)
  try {
    const event = {
      type: TRANSCRIPT_EVENT_TYPE,
      sessionId,
      timestamp: stored.timestamp,
      data: {
        segment: stored,
        speaker: stored.speaker,
        text: stored.text,
      },
      source: 'voice',
    };
    eventBus.emit(event).catch(err => {
      console.error(`[TranscriptStream] EventBus emit error for session ${sessionId}:`, err.message);
    });
  } catch (err) {
    console.error(`[TranscriptStream] Failed to emit transcript_segment for session ${sessionId}:`, err.message);
  }

  return stored;
}

/**
 * Get transcript segments for a session.
 *
 * @param {string} sessionId
 * @param {number} [sinceIndex] — Only return segments with segmentIndex >= sinceIndex
 * @returns {Array<Object>} Array of transcript segments
 */
function getTranscript(sessionId, sinceIndex) {
  const arr = _segments.get(sessionId);
  if (!arr) return [];

  if (sinceIndex !== undefined && sinceIndex !== null) {
    return arr.filter(s => s.segmentIndex >= sinceIndex);
  }

  return [...arr];
}

/**
 * Get the total segment count for a session.
 *
 * @param {string} sessionId
 * @returns {number}
 */
function getSegmentCount(sessionId) {
  const arr = _segments.get(sessionId);
  return arr ? arr.length : 0;
}

/**
 * Clear all transcript segments for a session.
 *
 * @param {string} sessionId
 * @returns {boolean} true if session had segments, false otherwise
 */
function clearSession(sessionId) {
  const had = _segments.has(sessionId);
  _segments.delete(sessionId);
  _nextIndex.delete(sessionId);
  return had;
}

/**
 * Update the last segment (for incremental transcript updates from Retell).
 * If there's an existing last segment from the same speaker, replace its text.
 * Otherwise, add a new segment.
 *
 * @param {string} sessionId
 * @param {Object} segment
 * @returns {Object} The stored/updated segment
 */
function updateLastSegment(sessionId, segment) {
  const arr = _segments.get(sessionId);
  if (arr && arr.length > 0) {
    const last = arr[arr.length - 1];
    if (last.speaker === (segment.speaker || 'unknown')) {
      last.text = String(segment.text).trim();
      last.timestamp = segment.timestamp || new Date().toISOString();
      return last;
    }
  }
  // No matching last segment — add new one
  return addSegment(sessionId, segment);
}

/**
 * Get IDs of all sessions that have transcript segments.
 *
 * @returns {string[]} Array of session IDs
 */
function getActiveSessions() {
  return Array.from(_segments.keys());
}

/**
 * Clear all transcript data. Used for testing/teardown.
 */
function clearAll() {
  _segments.clear();
  _nextIndex.clear();
}

module.exports = {
  addSegment,
  getTranscript,
  getSegmentCount,
  clearSession,
  updateLastSegment,
  getActiveSessions,
  clearAll,
  TRANSCRIPT_EVENT_TYPE,
  MAX_SEGMENTS,
};
