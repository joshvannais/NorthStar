/**
 * Unit Tests: Business Events System
 *
 * Tests for src/voice/businessEvents.js
 * - Event creation
 * - EventBus: on, off, emit
 * - Event history
 * - Handler isolation (errors don't break other handlers)
 */

'use strict';

const {
  EVENT_TYPES,
  createEvent,
  EventBus,
  eventBus,
} = require('../../../src/voice/businessEvents');

describe('Business Events System', () => {
  // Reset the singleton event bus before each test
  beforeEach(() => {
    eventBus.reset();
  });

  // ── Event Type Constants ──────────────────────────────────

  describe('EVENT_TYPES', () => {
    test('defines all 12 standard event types', () => {
      const types = Object.values(EVENT_TYPES);
      expect(types).toHaveLength(12);
      expect(types).toContain('call_started');
      expect(types).toContain('customer_verified');
      expect(types).toContain('estimate_requested');
      expect(types).toContain('pricing_question');
      expect(types).toContain('objection_detected');
      expect(types).toContain('upsell_detected');
      expect(types).toContain('competitor_mentioned');
      expect(types).toContain('appointment_requested');
      expect(types).toContain('technician_requested');
      expect(types).toContain('payment_question');
      expect(types).toContain('call_transferred');
      expect(types).toContain('call_completed');
    });
  });

  // ── createEvent ───────────────────────────────────────────

  describe('createEvent', () => {
    test('creates an event with all required fields', () => {
      const event = createEvent('CALL_STARTED', {
        sessionId: 'session-123',
        data: { fromNumber: '+15551234567' },
      });

      expect(event.type).toBe('call_started');
      expect(event.sessionId).toBe('session-123');
      expect(event.timestamp).toBeDefined();
      expect(event.data.fromNumber).toBe('+15551234567');
      expect(event.source).toBe('voice');
    });

    test('accepts string type values directly', () => {
      const event = createEvent('call_started', { sessionId: 's1' });
      expect(event.type).toBe('call_started');
    });

    test('throws for unknown event type', () => {
      expect(() => createEvent('INVALID_TYPE', { sessionId: 's1' }))
        .toThrow('Unknown event type');
    });

    test('defaults source to voice', () => {
      const event = createEvent('CALL_STARTED', { sessionId: 's1' });
      expect(event.source).toBe('voice');
    });

    test('accepts custom source', () => {
      const event = createEvent('CALL_STARTED', { sessionId: 's1', source: 'twilio' });
      expect(event.source).toBe('twilio');
    });

    test('accepts custom timestamp', () => {
      const customTime = '2026-07-17T12:00:00.000Z';
      const event = createEvent('CALL_STARTED', { sessionId: 's1', timestamp: customTime });
      expect(event.timestamp).toBe(customTime);
    });

    test('defaults sessionId to unknown when missing', () => {
      const event = createEvent('CALL_STARTED', {});
      expect(event.sessionId).toBe('unknown');
    });
  });

  // ── EventBus: on / emit ───────────────────────────────────

  describe('EventBus — on / emit', () => {
    test('emits event to registered handler', async () => {
      const handler = jest.fn();
      eventBus.on(EVENT_TYPES.CALL_STARTED, handler);

      const event = createEvent('CALL_STARTED', { sessionId: 's1' });
      await eventBus.emit(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    test('returns handler count in emit result', async () => {
      eventBus.on(EVENT_TYPES.CALL_STARTED, jest.fn());
      eventBus.on(EVENT_TYPES.CALL_STARTED, jest.fn());

      const event = createEvent('CALL_STARTED', { sessionId: 's1' });
      const result = await eventBus.emit(event);

      expect(result.emitted).toBe(true);
      expect(result.handlerCount).toBe(2);
      expect(result.errors).toBe(0);
    });

    test('returns zero handlers when none registered', async () => {
      const event = createEvent('CALL_STARTED', { sessionId: 's1' });
      const result = await eventBus.emit(event);

      expect(result.emitted).toBe(true);
      expect(result.handlerCount).toBe(0);
      expect(result.errors).toBe(0);
    });

    test('does not call handlers for different event types', async () => {
      const callStartedHandler = jest.fn();
      const callCompletedHandler = jest.fn();

      eventBus.on(EVENT_TYPES.CALL_STARTED, callStartedHandler);
      eventBus.on(EVENT_TYPES.CALL_COMPLETED, callCompletedHandler);

      const event = createEvent('CALL_STARTED', { sessionId: 's1' });
      await eventBus.emit(event);

      expect(callStartedHandler).toHaveBeenCalledTimes(1);
      expect(callCompletedHandler).not.toHaveBeenCalled();
    });

    test('wildcard handler (*) receives all events', async () => {
      const wildcardHandler = jest.fn();
      const specificHandler = jest.fn();

      eventBus.on('*', wildcardHandler);
      eventBus.on(EVENT_TYPES.CALL_STARTED, specificHandler);

      const event = createEvent('CALL_STARTED', { sessionId: 's1' });
      await eventBus.emit(event);

      expect(wildcardHandler).toHaveBeenCalledTimes(1);
      expect(specificHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ── EventBus: off ─────────────────────────────────────────

  describe('EventBus — off', () => {
    test('unsubscribes a handler', async () => {
      const handler = jest.fn();
      eventBus.on(EVENT_TYPES.CALL_STARTED, handler);
      eventBus.off(EVENT_TYPES.CALL_STARTED, handler);

      const event = createEvent('CALL_STARTED', { sessionId: 's1' });
      await eventBus.emit(event);

      expect(handler).not.toHaveBeenCalled();
    });

    test('on() returns unsubscribe function', async () => {
      const handler = jest.fn();
      const unsubscribe = eventBus.on(EVENT_TYPES.CALL_STARTED, handler);
      unsubscribe();

      const event = createEvent('CALL_STARTED', { sessionId: 's1' });
      await eventBus.emit(event);

      expect(handler).not.toHaveBeenCalled();
    });

    test('removing non-existent handler does not throw', () => {
      expect(() => {
        eventBus.off(EVENT_TYPES.CALL_STARTED, jest.fn());
      }).not.toThrow();
    });
  });

  // ── EventBus: error isolation ─────────────────────────────

  describe('EventBus — error isolation', () => {
    test('handler errors do not prevent other handlers', async () => {
      const failingHandler = jest.fn().mockRejectedValue(new Error('Boom!'));
      const successHandler = jest.fn();

      eventBus.on(EVENT_TYPES.CALL_STARTED, failingHandler);
      eventBus.on(EVENT_TYPES.CALL_STARTED, successHandler);

      const event = createEvent('CALL_STARTED', { sessionId: 's1' });
      const result = await eventBus.emit(event);

      expect(failingHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledTimes(1);
      expect(result.errors).toBe(1);
    });

    test('async handlers are awaited', async () => {
      let completed = false;
      const asyncHandler = async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        completed = true;
      };

      eventBus.on(EVENT_TYPES.CALL_STARTED, asyncHandler);

      const event = createEvent('CALL_STARTED', { sessionId: 's1' });
      await eventBus.emit(event);

      expect(completed).toBe(true);
    });
  });

  // ── EventBus: history ─────────────────────────────────────

  describe('EventBus — history', () => {
    test('records events in history', async () => {
      const event1 = createEvent('CALL_STARTED', { sessionId: 's1' });
      const event2 = createEvent('CALL_COMPLETED', { sessionId: 's1' });

      await eventBus.emit(event1);
      await eventBus.emit(event2);

      const history = eventBus.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    test('getHistory respects limit', async () => {
      for (let i = 0; i < 10; i++) {
        await eventBus.emit(createEvent('CALL_STARTED', { sessionId: `s${i}` }));
      }

      const history = eventBus.getHistory(5);
      expect(history.length).toBe(5);
    });
  });

  // ── EventBus: reset ───────────────────────────────────────

  describe('EventBus — reset', () => {
    test('clears all handlers', async () => {
      const handler = jest.fn();
      eventBus.on(EVENT_TYPES.CALL_STARTED, handler);
      eventBus.reset();

      const event = createEvent('CALL_STARTED', { sessionId: 's1' });
      const result = await eventBus.emit(event);

      expect(handler).not.toHaveBeenCalled();
      expect(result.handlerCount).toBe(0);
    });

    test('clears history', async () => {
      await eventBus.emit(createEvent('CALL_STARTED', { sessionId: 's1' }));
      expect(eventBus.getHistory().length).toBeGreaterThan(0);

      eventBus.reset();
      expect(eventBus.getHistory().length).toBe(0);
    });

    test('getHandlerCount returns zero after reset', () => {
      eventBus.on(EVENT_TYPES.CALL_STARTED, jest.fn());
      eventBus.on(EVENT_TYPES.CALL_COMPLETED, jest.fn());
      expect(eventBus.getHandlerCount()).toBe(2);

      eventBus.reset();
      expect(eventBus.getHandlerCount()).toBe(0);
    });
  });

  // ── Singleton exports ─────────────────────────────────────

  describe('Singleton exports', () => {
    const { emit, on, off } = require('../../../src/voice/businessEvents');

    test('emit and on work via singleton exports', async () => {
      const handler = jest.fn();
      const unsub = on(EVENT_TYPES.ESTIMATE_REQUESTED, handler);

      const event = createEvent('ESTIMATE_REQUESTED', { sessionId: 's1' });
      await emit(event);

      expect(handler).toHaveBeenCalledTimes(1);
      unsub();
    });
  });
});
