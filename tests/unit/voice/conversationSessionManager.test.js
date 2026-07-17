'use strict';

// ====================================================================
// Conversation Session Manager — Unit Tests
// ====================================================================

// No external dependencies other than uuid — pure orchestration tests

const {
  createSession,
  getSession,
  updateSession,
  addEvent,
  closeSession,
  listActiveSessions,
  deleteSession,
  clearAllSessions,
  getSessionCount,
} = require('../../../src/voice/conversationSessionManager');

beforeEach(() => {
  clearAllSessions();
});

// ====================================================================
// createSession
// ====================================================================

describe('createSession', () => {
  test('creates a session with defaults', () => {
    const session = createSession();

    expect(session).toHaveProperty('sessionId');
    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.channel).toBe('voice');
    expect(session.status).toBe('pending');
    expect(session.participants).toEqual([]);
    expect(session.metadata.phoneNumber).toBeNull();
    expect(session.metadata.customerId).toBeNull();
    expect(session.metadata.direction).toBe('inbound');
    expect(session.conversationState.phase).toBe('greeting');
    expect(session.conversationState.turnCount).toBe(0);
    expect(session.events).toHaveLength(1);
    expect(session.events[0].type).toBe('session_created');
  });

  test('accepts custom sessionId', () => {
    const session = createSession({ sessionId: 'custom-id-123' });
    expect(session.sessionId).toBe('custom-id-123');
  });

  test('accepts custom channel', () => {
    const session = createSession({ channel: 'web_chat' });
    expect(session.channel).toBe('web_chat');
  });

  test('accepts custom status', () => {
    const session = createSession({ status: 'active' });
    expect(session.status).toBe('active');
  });

  test('accepts participants', () => {
    const participants = [
      { role: 'customer', identifier: '+15551234567' },
      { role: 'agent', identifier: 'northstar-agent' },
    ];
    const session = createSession({ participants });
    expect(session.participants).toEqual(participants);
  });

  test('accepts metadata', () => {
    const meta = { phoneNumber: '+15559876543', customerId: 'cust-1', direction: 'outbound' };
    const session = createSession({ metadata: meta });
    expect(session.metadata.phoneNumber).toBe('+15559876543');
    expect(session.metadata.customerId).toBe('cust-1');
    expect(session.metadata.direction).toBe('outbound');
  });

  test('accepts conversation state', () => {
    const state = { phase: 'discovery', turnCount: 3, collectedData: { name: 'Alice' } };
    const session = createSession({ conversationState: state });
    expect(session.conversationState.phase).toBe('discovery');
    expect(session.conversationState.turnCount).toBe(3);
    expect(session.conversationState.collectedData).toEqual({ name: 'Alice' });
  });

  test('accepts executiveContextId', () => {
    const session = createSession({ executiveContextId: 'ctx-abc' });
    expect(session.executiveContextId).toBe('ctx-abc');
  });

  test('returns a defensive copy (modifying returned object does not mutate store)', () => {
    const session1 = createSession({ sessionId: 'immutable-test' });
    session1.status = 'modified';
    session1.metadata.phoneNumber = 'hacked';

    const session2 = getSession('immutable-test');
    expect(session2.status).toBe('pending');
    expect(session2.metadata.phoneNumber).toBeNull();
  });

  // Validation tests
  test('throws on invalid channel', () => {
    expect(() => createSession({ channel: 'fax' })).toThrow('Invalid channel');
  });

  test('throws on invalid status', () => {
    expect(() => createSession({ status: 'sleeping' })).toThrow('Invalid status');
  });

  test('throws on invalid participant role', () => {
    expect(() => createSession({
      participants: [{ role: 'hacker', identifier: 'x' }],
    })).toThrow('Invalid participant role');
  });

  test('throws on participant missing identifier', () => {
    expect(() => createSession({
      participants: [{ role: 'customer' }],
    })).toThrow('identifier');
  });

  test('throws when participants is not an array', () => {
    expect(() => createSession({ participants: 'not-an-array' })).toThrow('array');
  });

  test('accepts all valid channels', () => {
    for (const channel of ['voice', 'web_chat', 'sms', 'email']) {
      const session = createSession({ channel });
      expect(session.channel).toBe(channel);
    }
  });

  test('creates timestamps', () => {
    const before = new Date().toISOString();
    const session = createSession();
    const after = new Date().toISOString();
    expect(session.createdAt >= before).toBe(true);
    expect(session.createdAt <= after).toBe(true);
    expect(session.updatedAt).toBe(session.createdAt);
  });
});

// ====================================================================
// getSession
// ====================================================================

describe('getSession', () => {
  test('returns session by ID', () => {
    createSession({ sessionId: 'find-me' });
    const session = getSession('find-me');
    expect(session).not.toBeNull();
    expect(session.sessionId).toBe('find-me');
  });

  test('returns null for unknown ID', () => {
    expect(getSession('nope')).toBeNull();
  });

  test('returned session is a deep copy', () => {
    createSession({ sessionId: 'copy-test' });
    const copy1 = getSession('copy-test');
    const copy2 = getSession('copy-test');

    copy1.status = 'modified';
    expect(copy2.status).toBe('pending');
  });
});

// ====================================================================
// updateSession
// ====================================================================

describe('updateSession', () => {
  test('updates status', () => {
    createSession({ sessionId: 's1' });
    const updated = updateSession('s1', { status: 'active' });
    expect(updated.status).toBe('active');
    expect(getSession('s1').status).toBe('active');
  });

  test('updates channel', () => {
    createSession({ sessionId: 's2' });
    updateSession('s2', { channel: 'sms' });
    expect(getSession('s2').channel).toBe('sms');
  });

  test('updates participants', () => {
    createSession({ sessionId: 's3' });
    const participants = [{ role: 'customer', identifier: 'alice' }];
    updateSession('s3', { participants });
    expect(getSession('s3').participants).toEqual(participants);
  });

  test('merges metadata', () => {
    createSession({ sessionId: 's4', metadata: { phoneNumber: '111', direction: 'inbound' } });
    updateSession('s4', { metadata: { customerId: 'cust-5' } });
    const session = getSession('s4');
    expect(session.metadata.phoneNumber).toBe('111'); // preserved
    expect(session.metadata.customerId).toBe('cust-5'); // added
    expect(session.metadata.direction).toBe('inbound'); // preserved
  });

  test('merges conversationState', () => {
    createSession({ sessionId: 's5', conversationState: { phase: 'greeting', turnCount: 0 } });
    updateSession('s5', { conversationState: { turnCount: 5, collectedData: { name: 'Bob' } } });
    const session = getSession('s5');
    expect(session.conversationState.phase).toBe('greeting'); // preserved
    expect(session.conversationState.turnCount).toBe(5); // updated
    expect(session.conversationState.collectedData).toEqual({ name: 'Bob' }); // added
  });

  test('updates executiveContextId', () => {
    createSession({ sessionId: 's6' });
    updateSession('s6', { executiveContextId: 'ctx-new' });
    expect(getSession('s6').executiveContextId).toBe('ctx-new');
  });

  test('updates updatedAt timestamp', () => {
    createSession({ sessionId: 's7' });
    const original = getSession('s7');

    updateSession('s7', { status: 'active' });
    const updated = getSession('s7');

    // Timestamps may be equal if operations run in same millisecond;
    // verify they are at least >= original
    expect(updated.updatedAt >= original.updatedAt).toBe(true);
    expect(updated.createdAt).toBe(original.createdAt); // unchanged
  });

  test('returns null for unknown session', () => {
    expect(updateSession('unknown', { status: 'active' })).toBeNull();
  });

  test('validates status on update', () => {
    createSession({ sessionId: 's8' });
    expect(() => updateSession('s8', { status: 'invalid' })).toThrow('Invalid status');
  });

  test('validates channel on update', () => {
    createSession({ sessionId: 's9' });
    expect(() => updateSession('s9', { channel: 'carrier_pigeon' })).toThrow('Invalid channel');
  });

  test('no updates leaves session unchanged', () => {
    createSession({ sessionId: 's10' });
    const updated = updateSession('s10', {});
    expect(updated).not.toBeNull();
    expect(updated.status).toBe('pending');
  });

  test('returned session is defensive copy', () => {
    createSession({ sessionId: 's11' });
    const updated = updateSession('s11', { status: 'active' });
    updated.status = 'hacked';
    expect(getSession('s11').status).toBe('active');
  });
});

// ====================================================================
// addEvent
// ====================================================================

describe('addEvent', () => {
  test('adds an event to session', () => {
    createSession({ sessionId: 's-events' });
    addEvent('s-events', { type: 'message_sent', data: { text: 'Hello' } });

    const session = getSession('s-events');
    expect(session.events).toHaveLength(2); // creation + message_sent
    expect(session.events[1].type).toBe('message_sent');
    expect(session.events[1].data).toEqual({ text: 'Hello' });
    expect(session.events[1].timestamp).toBeDefined();
  });

  test('adds event with empty data if none provided', () => {
    createSession({ sessionId: 's-ed' });
    addEvent('s-ed', { type: 'status_change' });

    const session = getSession('s-ed');
    expect(session.events[1].data).toEqual({});
  });

  test('throws if event has no type', () => {
    createSession({ sessionId: 's-etype' });
    expect(() => addEvent('s-etype', { data: 'no type' })).toThrow('type');
    expect(() => addEvent('s-etype', null)).toThrow('type');
  });

  test('returns null for unknown session', () => {
    expect(addEvent('unknown', { type: 'test' })).toBeNull();
  });

  test('updates session updatedAt timestamp', () => {
    createSession({ sessionId: 's-time' });
    const before = getSession('s-time').updatedAt;
    addEvent('s-time', { type: 'ping' });
    const after = getSession('s-time').updatedAt;
    expect(after >= before).toBe(true);
  });
});

// ====================================================================
// closeSession
// ====================================================================

describe('closeSession', () => {
  test('closes session as completed by default', () => {
    createSession({ sessionId: 'close-me' });
    const closed = closeSession('close-me');

    expect(closed.status).toBe('completed');
    expect(getSession('close-me').status).toBe('completed');
  });

  test('closes session with specified terminal status', () => {
    createSession({ sessionId: 'fail-me' });
    closeSession('fail-me', 'failed', { reason: 'Customer hung up' });

    const session = getSession('fail-me');
    expect(session.status).toBe('failed');
    expect(session.events).toHaveLength(2); // created + closed
    expect(session.events[1].type).toBe('session_closed');
    expect(session.events[1].data.finalStatus).toBe('failed');
    expect(session.events[1].data.reason).toBe('Customer hung up');
  });

  test('accepts timeout status', () => {
    createSession({ sessionId: 'timeout-me' });
    closeSession('timeout-me', 'timeout');

    expect(getSession('timeout-me').status).toBe('timeout');
  });

  test('accepts close data with summary', () => {
    createSession({ sessionId: 'summary-test' });
    closeSession('summary-test', 'completed', { summary: 'Customer scheduled estimate for Friday' });

    const session = getSession('summary-test');
    expect(session.events[1].data.summary).toBe('Customer scheduled estimate for Friday');
  });

  test('throws on non-terminal status', () => {
    createSession({ sessionId: 'bad-close' });
    expect(() => closeSession('bad-close', 'active')).toThrow('terminal status');
    expect(() => closeSession('bad-close', 'pending')).toThrow('terminal status');
  });

  test('returns null for unknown session', () => {
    expect(closeSession('unknown')).toBeNull();
  });

  test('updates updatedAt', () => {
    createSession({ sessionId: 'close-time' });
    const before = getSession('close-time').updatedAt;
    closeSession('close-time');
    const after = getSession('close-time').updatedAt;
    expect(after >= before).toBe(true);
  });
});

// ====================================================================
// listActiveSessions
// ====================================================================

describe('listActiveSessions', () => {
  test('returns empty array when no sessions', () => {
    expect(listActiveSessions()).toEqual([]);
  });

  test('returns only active sessions (excludes completed/failed/timeout)', () => {
    createSession({ sessionId: 'a1', status: 'pending' });
    createSession({ sessionId: 'a2', status: 'active' });
    createSession({ sessionId: 'a3', status: 'paused' });
    createSession({ sessionId: 'd1', status: 'completed' });
    createSession({ sessionId: 'd2', status: 'failed' });
    createSession({ sessionId: 'd3', status: 'timeout' });

    const active = listActiveSessions();
    expect(active).toHaveLength(3);
    expect(active.map(s => s.sessionId).sort()).toEqual(['a1', 'a2', 'a3']);
  });

  test('filters by channel', () => {
    createSession({ sessionId: 'v1', channel: 'voice' });
    createSession({ sessionId: 's1', channel: 'sms' });
    createSession({ sessionId: 'v2', channel: 'voice' });

    const voiceSessions = listActiveSessions({ channel: 'voice' });
    expect(voiceSessions).toHaveLength(2);
    expect(voiceSessions.map(s => s.sessionId).sort()).toEqual(['v1', 'v2']);
  });

  test('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      createSession({ sessionId: `s-${i}` });
    }

    const limited = listActiveSessions({ limit: 5 });
    expect(limited).toHaveLength(5);
  });

  test('returns defensive copies', () => {
    createSession({ sessionId: 'copy-list' });
    const [session] = listActiveSessions();
    session.status = 'hacked';
    expect(getSession('copy-list').status).toBe('pending');
  });
});

// ====================================================================
// deleteSession & maintenance
// ====================================================================

describe('deleteSession', () => {
  test('removes session from store', () => {
    createSession({ sessionId: 'del-me' });
    expect(getSession('del-me')).not.toBeNull();

    deleteSession('del-me');
    expect(getSession('del-me')).toBeNull();
    expect(getSessionCount()).toBe(0);
  });

  test('returns true when found, false when not', () => {
    createSession({ sessionId: 'del-exists' });
    expect(deleteSession('del-exists')).toBe(true);
    expect(deleteSession('del-exists')).toBe(false);
  });
});

describe('clearAllSessions', () => {
  test('removes all sessions', () => {
    createSession({ sessionId: 'c1' });
    createSession({ sessionId: 'c2' });
    createSession({ sessionId: 'c3' });
    expect(getSessionCount()).toBe(3);

    clearAllSessions();
    expect(getSessionCount()).toBe(0);
  });
});

describe('getSessionCount', () => {
  test('returns accurate count', () => {
    expect(getSessionCount()).toBe(0);
    const s = createSession();
    expect(getSessionCount()).toBe(1);
    createSession();
    createSession();
    expect(getSessionCount()).toBe(3);
  });

  test('count includes all statuses', () => {
    createSession({ sessionId: 'cnt-1', status: 'active' });
    createSession({ sessionId: 'cnt-2', status: 'completed' });
    createSession({ sessionId: 'cnt-3', status: 'failed' });
    expect(getSessionCount()).toBe(3);
  });
});

// ====================================================================
// Integration-like: Full lifecycle
// ====================================================================

describe('Full session lifecycle', () => {
  test('create → update → add events → close', () => {
    // Create
    const session = createSession({
      channel: 'voice',
      metadata: { phoneNumber: '+15551112222', direction: 'inbound' },
      participants: [{ role: 'customer', identifier: '+15551112222' }],
    });
    const sessionId = session.sessionId;

    // Update to active
    updateSession(sessionId, { status: 'active' });

    // Add events during conversation
    addEvent(sessionId, { type: 'greeting_played', data: { message: 'Welcome!' } });
    addEvent(sessionId, { type: 'customer_response', data: { text: 'I need a roof estimate' } });
    addEvent(sessionId, { type: 'info_collected', data: { field: 'service', value: 'Roof repair' } });

    // Update conversation state
    updateSession(sessionId, {
      conversationState: {
        phase: 'information_collection',
        turnCount: 3,
        collectedData: { service: 'Roof repair' },
      },
    });

    // Close
    closeSession(sessionId, 'completed', { summary: 'Customer scheduled estimate' });

    // Verify final state
    const final = getSession(sessionId);
    expect(final.status).toBe('completed');
    expect(final.events).toHaveLength(5); // created + 3 events + closed
    expect(final.events.map(e => e.type)).toEqual([
      'session_created',
      'greeting_played',
      'customer_response',
      'info_collected',
      'session_closed',
    ]);
    expect(final.conversationState.phase).toBe('information_collection');
    expect(final.conversationState.turnCount).toBe(3);
    expect(final.conversationState.collectedData).toEqual({ service: 'Roof repair' });
    expect(final.metadata.phoneNumber).toBe('+15551112222');
  });

  test('sessions are isolated', () => {
    const s1 = createSession({ sessionId: 'iso-1', channel: 'voice' });
    const s2 = createSession({ sessionId: 'iso-2', channel: 'sms' });

    updateSession('iso-1', { status: 'active' });
    addEvent('iso-1', { type: 'test', data: { session: 1 } });
    closeSession('iso-1', 'completed');

    // s2 should be unaffected
    const s2final = getSession('iso-2');
    expect(s2final.status).toBe('pending');
    expect(s2final.events).toHaveLength(1); // Only creation event
    expect(s2final.channel).toBe('sms');
  });
});
