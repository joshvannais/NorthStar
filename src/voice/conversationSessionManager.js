/**
 * Conversation Session Manager — Pure Orchestration Layer
 *
 * Manages conversation lifecycle for all channels:
 *   voice | web_chat | sms | email
 *
 * NO business logic, NO pricing, NO AI decisions.
 * Pure session orchestration — creates, tracks, updates, and closes sessions.
 *
 * Architecture:
 *   Retell | Polaris Chat | SMS Gateway | Email Handler
 *                        ↓
 *   Conversation Session Manager  ← YOU ARE HERE
 *                        ↓
 *   Executive Context → Intelligence Layer
 *
 * Storage: In-memory Map<string, Session> with optional SQLite persistence.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');

// In-memory session store
const _sessions = new Map();

// Allowed values for validation
const VALID_CHANNELS = new Set(['voice', 'web_chat', 'sms', 'email']);
const VALID_STATUSES = new Set(['pending', 'active', 'paused', 'completed', 'failed', 'timeout']);
const VALID_ROLES = new Set(['customer', 'agent', 'system']);

/**
 * Default session template.
 * @param {Object} opts
 * @returns {Object} Populated session object
 */
function _buildSession(opts) {
  const now = new Date().toISOString();

  return {
    sessionId: opts.sessionId || uuidv4(),
    channel: opts.channel || 'voice',
    status: opts.status || 'pending',
    participants: opts.participants || [],
    metadata: {
      phoneNumber: opts.metadata?.phoneNumber || null,
      customerId: opts.metadata?.customerId || null,
      leadId: opts.metadata?.leadId || null,
      direction: opts.metadata?.direction || 'inbound',
      ...opts.metadata,
    },
    conversationState: {
      phase: opts.conversationState?.phase || 'greeting',
      turnCount: opts.conversationState?.turnCount || 0,
      collectedData: opts.conversationState?.collectedData || {},
    },
    executiveContextId: opts.executiveContextId || null,
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ====================================================================
// Validation helpers
// ====================================================================

function _validateChannel(channel) {
  if (!VALID_CHANNELS.has(channel)) {
    throw new Error(`Invalid channel: "${channel}". Must be one of: ${[...VALID_CHANNELS].join(', ')}`);
  }
}

function _validateStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid status: "${status}". Must be one of: ${[...VALID_STATUSES].join(', ')}`);
  }
}

function _validateParticipants(participants) {
  if (!Array.isArray(participants)) {
    throw new Error('Participants must be an array');
  }
  for (const p of participants) {
    if (!p.role || !VALID_ROLES.has(p.role)) {
      throw new Error(`Invalid participant role: "${p.role}". Must be one of: ${[...VALID_ROLES].join(', ')}`);
    }
    if (!p.identifier) {
      throw new Error('Each participant must have an identifier');
    }
  }
}

// ====================================================================
// Public API
// ====================================================================

/**
 * Create a new conversation session.
 *
 * @param {Object} opts
 * @param {string} [opts.sessionId] — Optional pre-generated session ID
 * @param {string} [opts.channel='voice'] — voice | web_chat | sms | email
 * @param {string} [opts.status='pending'] — pending | active | paused | completed | failed | timeout
 * @param {Array} [opts.participants=[]] — [{ role: 'customer'|'agent'|'system', identifier: string }]
 * @param {Object} [opts.metadata] — { phoneNumber, customerId, leadId, direction }
 * @param {Object} [opts.conversationState] — { phase, turnCount, collectedData }
 * @param {string} [opts.executiveContextId] — Reference to cached Executive Context
 * @returns {Object} Created session
 */
function createSession(opts) {
  const options = opts || {};

  // Validate
  _validateChannel(options.channel || 'voice');
  if (options.status) _validateStatus(options.status);
  if (options.participants) _validateParticipants(options.participants);

  const session = _buildSession(options);

  // Add creation event
  session.events.push({
    type: 'session_created',
    timestamp: session.createdAt,
    data: { channel: session.channel, status: session.status },
  });

  _sessions.set(session.sessionId, session);
  return JSON.parse(JSON.stringify(session)); // return defensive copy
}

/**
 * Retrieve a session by ID.
 *
 * @param {string} sessionId
 * @returns {Object|null} Session object (defensive copy) or null
 */
function getSession(sessionId) {
  const session = _sessions.get(sessionId);
  if (!session) return null;
  return JSON.parse(JSON.stringify(session));
}

/**
 * Update a session's mutable fields.
 * Only updates provided fields; preserves existing values.
 *
 * @param {string} sessionId
 * @param {Object} updates — { status, participants, metadata, conversationState, executiveContextId }
 * @returns {Object|null} Updated session or null if not found
 */
function updateSession(sessionId, updates) {
  const session = _sessions.get(sessionId);
  if (!session) return null;

  const upd = updates || {};

  // Validate where needed
  if (upd.status) _validateStatus(upd.status);
  if (upd.channel) _validateChannel(upd.channel);
  if (upd.participants) _validateParticipants(upd.participants);

  // Apply allowed updates
  if (upd.status !== undefined) session.status = upd.status;
  if (upd.channel !== undefined) session.channel = upd.channel;
  if (upd.participants !== undefined) session.participants = upd.participants;
  if (upd.metadata !== undefined) {
    session.metadata = { ...session.metadata, ...upd.metadata };
  }
  if (upd.conversationState !== undefined) {
    session.conversationState = { ...session.conversationState, ...upd.conversationState };
  }
  if (upd.executiveContextId !== undefined) {
    session.executiveContextId = upd.executiveContextId;
  }

  session.updatedAt = new Date().toISOString();

  return JSON.parse(JSON.stringify(session));
}

/**
 * Add an event to a session's event log.
 *
 * @param {string} sessionId
 * @param {Object} event — { type: string, data: object }
 * @returns {Object|null} Updated session or null if not found
 */
function addEvent(sessionId, event) {
  const session = _sessions.get(sessionId);
  if (!session) return null;

  if (!event || !event.type) {
    throw new Error('Event must have a "type" property');
  }

  session.events.push({
    type: event.type,
    timestamp: new Date().toISOString(),
    data: event.data || {},
  });

  session.updatedAt = new Date().toISOString();

  return JSON.parse(JSON.stringify(session));
}

/**
 * Close a session — mark as completed, failed, or timeout.
 *
 * @param {string} sessionId
 * @param {string} [finalStatus='completed'] — completed | failed | timeout
 * @param {Object} [closeData] — Optional data about closure (reason, summary)
 * @returns {Object|null} Closed session or null if not found
 */
function closeSession(sessionId, finalStatus, closeData) {
  const session = _sessions.get(sessionId);
  if (!session) return null;

  const status = finalStatus || 'completed';
  _validateStatus(status);

  // Only allow terminal statuses for close
  if (!['completed', 'failed', 'timeout'].includes(status)) {
    throw new Error(`closeSession requires a terminal status: completed, failed, or timeout. Got: "${status}"`);
  }

  session.status = status;
  session.updatedAt = new Date().toISOString();

  session.events.push({
    type: 'session_closed',
    timestamp: session.updatedAt,
    data: {
      finalStatus: status,
      reason: closeData?.reason || null,
      summary: closeData?.summary || null,
    },
  });

  return JSON.parse(JSON.stringify(session));
}

/**
 * List all active sessions (not completed/failed/timeout).
 *
 * @param {Object} [opts]
 * @param {string} [opts.channel] — Filter by channel
 * @param {number} [opts.limit] — Max results to return
 * @returns {Array} Array of session objects
 */
function listActiveSessions(opts) {
  const options = opts || {};
  const channel = options.channel || null;
  const limit = options.limit || 100;

  const active = [];
  for (const session of _sessions.values()) {
    if (['completed', 'failed', 'timeout'].includes(session.status)) continue;
    if (channel && session.channel !== channel) continue;
    active.push(JSON.parse(JSON.stringify(session)));
    if (active.length >= limit) break;
  }

  return active;
}

// ====================================================================
// Session cleanup (for testing / maintenance)
// ====================================================================

/**
 * Remove a session from the store entirely.
 * @param {string} sessionId
 * @returns {boolean} true if removed, false if not found
 */
function deleteSession(sessionId) {
  return _sessions.delete(sessionId);
}

/**
 * Clear all sessions. Used for testing/teardown.
 */
function clearAllSessions() {
  _sessions.clear();
}

/**
 * Get the number of sessions in the store.
 * @returns {number}
 */
function getSessionCount() {
  return _sessions.size;
}

// ====================================================================
// Exports
// ====================================================================

module.exports = {
  createSession,
  getSession,
  updateSession,
  addEvent,
  closeSession,
  listActiveSessions,
  deleteSession,
  clearAllSessions,
  getSessionCount,
};
