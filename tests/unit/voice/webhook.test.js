/**
 * Unit Tests: Voice Webhook Framework
 *
 * Tests for src/voice/webhook.js
 * - HMAC-SHA256 signature validation
 * - Timestamp validation (±5min window)
 * - Event deduplication
 * - Event routing
 */

'use strict';

const crypto = require('crypto');

// We need to mock the businessEvents module used by webhook.js
jest.mock('../../../src/voice/businessEvents', () => ({
  eventBus: {
    emit: jest.fn().mockResolvedValue({ emitted: true, handlerCount: 0, errors: 0 }),
  },
  emit: jest.fn().mockResolvedValue({ emitted: true, handlerCount: 0, errors: 0 }),
  EVENT_TYPES: {
    CALL_STARTED: 'call_started',
    CALL_COMPLETED: 'call_completed',
  },
}));

const webhook = require('../../../src/voice/webhook');
const businessEvents = require('../../../src/voice/businessEvents');

describe('Voice Webhook Framework', () => {
  // ── Signature Validation ──────────────────────────────────

  describe('validateSignature', () => {
    test('fails closed when no validation material is configured', () => {
      const originalSecret = process.env.RETELL_WEBHOOK_SECRET;
      const originalApiKey = process.env.RETELL_API_KEY;
      delete process.env.RETELL_WEBHOOK_SECRET;
      delete process.env.RETELL_API_KEY;
      expect(webhook.validateSignature('body', '0'.repeat(64))).toBe(false);
      if (originalSecret === undefined) delete process.env.RETELL_WEBHOOK_SECRET;
      else process.env.RETELL_WEBHOOK_SECRET = originalSecret;
      if (originalApiKey === undefined) delete process.env.RETELL_API_KEY;
      else process.env.RETELL_API_KEY = originalApiKey;
    });

    test('returns false when signature is missing', () => {
      // Set a secret so validation is attempted
      const originalSecret = process.env.RETELL_WEBHOOK_SECRET;
      process.env.RETELL_WEBHOOK_SECRET = 'test-secret';
      const result = webhook.validateSignature('body', '');
      if (originalSecret === undefined) delete process.env.RETELL_WEBHOOK_SECRET;
      else process.env.RETELL_WEBHOOK_SECRET = originalSecret;
      expect(result).toBe(false);
    });

    test('returns false for mismatched signature', () => {
      const originalSecret = process.env.RETELL_WEBHOOK_SECRET;
      process.env.RETELL_WEBHOOK_SECRET = 'correct-secret';
      // Generate an HMAC with a DIFFERENT secret
      const wrongSig = crypto.createHmac('sha256', 'wrong-secret').update('body').digest('hex');
      const result = webhook.validateSignature('body', wrongSig);
      if (originalSecret === undefined) delete process.env.RETELL_WEBHOOK_SECRET;
      else process.env.RETELL_WEBHOOK_SECRET = originalSecret;
      expect(result).toBe(false);
    });

    test('returns true for correct signature', () => {
      const originalSecret = process.env.RETELL_WEBHOOK_SECRET;
      const secret = 'correct-secret';
      process.env.RETELL_WEBHOOK_SECRET = secret;
      const correctSig = crypto.createHmac('sha256', secret).update('body').digest('hex');
      const result = webhook.validateSignature('body', correctSig);
      if (originalSecret === undefined) delete process.env.RETELL_WEBHOOK_SECRET;
      else process.env.RETELL_WEBHOOK_SECRET = originalSecret;
      expect(result).toBe(true);
    });

    test('accepts canonical hex case and rejects non-hex input of the correct length', () => {
      const originalSecret = process.env.RETELL_WEBHOOK_SECRET;
      const secret = 'strict-hex-secret';
      process.env.RETELL_WEBHOOK_SECRET = secret;
      const signature = crypto.createHmac('sha256', secret).update('body').digest('hex');
      expect(webhook.validateSignature('body', signature.toUpperCase())).toBe(true);
      expect(webhook.validateSignature('body', 'g'.repeat(64))).toBe(false);
      if (originalSecret === undefined) delete process.env.RETELL_WEBHOOK_SECRET;
      else process.env.RETELL_WEBHOOK_SECRET = originalSecret;
    });

    test('handles different body lengths securely', () => {
      const originalSecret = process.env.RETELL_WEBHOOK_SECRET;
      const secret = 'secure-secret';
      process.env.RETELL_WEBHOOK_SECRET = secret;
      const shortBody = 'hello';
      const shortSig = crypto.createHmac('sha256', secret).update(shortBody).digest('hex');
      // Using shortSig against a different body should fail
      const result = webhook.validateSignature('different body', shortSig);
      if (originalSecret === undefined) delete process.env.RETELL_WEBHOOK_SECRET;
      else process.env.RETELL_WEBHOOK_SECRET = originalSecret;
      expect(result).toBe(false);
    });
  });

  // ── Timestamp Validation ──────────────────────────────────

  describe('validateTimestamp', () => {
    test('rejects missing timestamp', () => {
      expect(webhook.validateTimestamp(null)).toBe(false);
      expect(webhook.validateTimestamp(undefined)).toBe(false);
      expect(webhook.validateTimestamp('')).toBe(false);
    });

    test('accepts timestamp within 5 minute window', () => {
      const now = Date.now();
      // 2 minutes ago (in seconds)
      const ts = Math.floor((now - 2 * 60 * 1000) / 1000);
      expect(webhook.validateTimestamp(String(ts))).toBe(true);
    });

    test('accepts timestamp in milliseconds', () => {
      const tsMs = Date.now() - 60000; // 1 minute ago
      expect(webhook.validateTimestamp(String(tsMs))).toBe(true);
    });

    test('rejects timestamp older than 5 minutes', () => {
      const ts = Math.floor((Date.now() - 10 * 60 * 1000) / 1000); // 10 minutes ago
      expect(webhook.validateTimestamp(String(ts))).toBe(false);
    });

    test('rejects future timestamp beyond 5 minutes', () => {
      const ts = Math.floor((Date.now() + 10 * 60 * 1000) / 1000); // 10 minutes in future
      expect(webhook.validateTimestamp(String(ts))).toBe(false);
    });

    test('rejects numeric prefixes, decimals, non-finite values, and unsafe integers', () => {
      expect(webhook.validateTimestamp('123abc')).toBe(false);
      expect(webhook.validateTimestamp(String(Date.now() / 1000))).toBe(false);
      expect(webhook.validateTimestamp(Math.floor(Date.now() / 1000))).toBe(false);
      expect(webhook.validateTimestamp(Infinity)).toBe(false);
      expect(webhook.validateTimestamp(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    });
  });

  // ── Deduplication ─────────────────────────────────────────

  describe('isDuplicate', () => {
    test('returns false for new event IDs', () => {
      const eventId = 'evt_' + Date.now() + '_' + Math.random();
      expect(webhook.isDuplicate(eventId)).toBe(false);
    });

    test('returns true for already-seen event IDs', () => {
      const eventId = 'evt_dup_test_' + Date.now();
      expect(webhook.isDuplicate(eventId)).toBe(false); // first time
      expect(webhook.isDuplicate(eventId)).toBe(true);  // second time
    });

    test('returns false for null/empty event IDs', () => {
      expect(webhook.isDuplicate(null)).toBe(false);
      expect(webhook.isDuplicate('')).toBe(false);
      expect(webhook.isDuplicate(undefined)).toBe(false);
    });

    test('handles multiple unique IDs correctly', () => {
      const ids = ['evt_a', 'evt_b', 'evt_c'];
      ids.forEach(id => expect(webhook.isDuplicate(id)).toBe(false));
      ids.forEach(id => expect(webhook.isDuplicate(id)).toBe(true));
    });
  });

  describe('bounded replay claims', () => {
    test('one synchronous check-and-claim wins for concurrent callers', () => {
      const key = 'atomic-claim-' + Math.random();
      expect(webhook.claimReplay(key)).toEqual({ claimed: true, reason: null });
      expect(webhook.claimReplay(key)).toEqual({ claimed: false, reason: 'replayed' });
      expect(webhook.releaseReplay(key)).toBe(true);
    });

    test('expired entries are cleaned before a new atomic claim', () => {
      const key = 'expiring-claim-' + Math.random();
      const start = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
      try {
        expect(webhook.claimReplay(key).claimed).toBe(true);
        clock.mockReturnValue(start + webhook.DEDUP_TTL_MS + 1);
        expect(webhook.claimReplay(key)).toEqual({ claimed: true, reason: null });
      } finally {
        webhook.releaseReplay(key);
        clock.mockRestore();
      }
    });

    test('capacity saturation fails closed and cleanup restores capacity without eviction', () => {
      const prefix = 'capacity-claim-' + Math.random() + '-';
      const start = Date.now() + webhook.DEDUP_TTL_MS + 1000;
      const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
      try {
        for (let index = 0; index < webhook.MAX_REPLAY_ENTRIES; index += 1) {
          expect(webhook.claimReplay(prefix + index).claimed).toBe(true);
        }
        expect(webhook.claimReplay(prefix + 'overflow')).toEqual({ claimed: false, reason: 'saturated' });
        expect(webhook.claimReplay(prefix + '0')).toEqual({ claimed: false, reason: 'replayed' });

        clock.mockReturnValue(start + webhook.DEDUP_TTL_MS + 1);
        expect(webhook.claimReplay(prefix + 'after-cleanup')).toEqual({ claimed: true, reason: null });
        webhook.releaseReplay(prefix + 'after-cleanup');
      } finally {
        clock.mockRestore();
      }
    });
  });

  // ── Event Routing ─────────────────────────────────────────

  describe('routeEvent', () => {
    test('handles unknown event type gracefully', async () => {
      const result = await webhook.routeEvent({ event: 'unknown_event', event_id: 'evt1' });
      expect(result.received).toBe(true);
      expect(result.routed).toBe(false);
      expect(result.reason).toBe('unknown_event');
    });

    test('handles missing event type', async () => {
      const result = await webhook.routeEvent({ event_id: 'evt1' });
      expect(result.received).toBe(true);
      expect(result.routed).toBe(false);
      expect(result.reason).toBe('unknown_event');
    });

    test('routes call_started event', async () => {
      const result = await webhook.routeEvent({
        event: 'call_started',
        event_id: 'evt_start_1',
        call_id: 'call_123',
        from_number: '+15551234567',
      });
      expect(result.received).toBe(true);
      expect(result.routed).toBe(true);
      expect(result.event).toBe('call_started');
    });

    test('routes call_ended event', async () => {
      const result = await webhook.routeEvent({
        event: 'call_ended',
        event_id: 'evt_end_1',
        call_id: 'call_123',
        transcript: 'Hello, I need tree removal...',
      });
      expect(result.received).toBe(true);
      expect(result.routed).toBe(true);
      expect(result.event).toBe('call_ended');
    });

    test('routes call_analyzed event', async () => {
      const result = await webhook.routeEvent({
        event: 'call_analyzed',
        event_id: 'evt_analyzed_1',
        call_id: 'call_123',
        call_analysis: { customer_name: 'John', service_requested: 'Tree Removal' },
      });
      expect(result.received).toBe(true);
      expect(result.routed).toBe(true);
    });

    test('routes ping event silently', async () => {
      const result = await webhook.routeEvent({
        event: 'ping',
        event_id: 'evt_ping_1',
      });
      expect(result.received).toBe(true);
      expect(result.routed).toBe(true);
    });
  });

  describe('handler timeout lifecycle', () => {
    function deferred() {
      let resolve;
      let reject;
      const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
    }

    beforeEach(() => {
      jest.useFakeTimers();
      webhook.start();
      businessEvents.emit.mockReset();
    });

    afterEach(() => {
      webhook.shutdown();
      webhook.start();
      businessEvents.emit.mockReset().mockResolvedValue({ emitted: true, handlerCount: 0, errors: 0 });
      jest.useRealTimers();
    });

    test('normal completion clears its owned timeout', async () => {
      businessEvents.emit.mockResolvedValueOnce({ emitted: true, handlerCount: 0, errors: 0 });

      await expect(webhook.routeEvent({
        event: 'call_started',
        event_id: 'evt_lifecycle_complete',
        call_id: 'call_lifecycle_complete',
      })).resolves.toEqual({
        received: true,
        routed: true,
        event: 'call_started',
        eventId: 'evt_lifecycle_complete',
      });
      expect(jest.getTimerCount()).toBe(0);
    });

    test('handler rejection clears its owned timeout', async () => {
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
      businessEvents.emit.mockRejectedValueOnce(new Error('emit failed'));

      await expect(webhook.routeEvent({
        event: 'call_started',
        event_id: 'evt_lifecycle_rejection',
      })).resolves.toEqual({
        received: true,
        routed: true,
        event: 'call_started',
        eventId: 'evt_lifecycle_rejection',
      });
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        '[Voice:Webhook] Event handler error for call_started:',
        'emit failed'
      );
      expect(jest.getTimerCount()).toBe(0);
      errorLog.mockRestore();
    });

    test('replacement retires the obsolete timeout before the new handler completes', async () => {
      const firstEmit = deferred();
      const replacementEmit = deferred();
      businessEvents.emit
        .mockReturnValueOnce(firstEmit.promise)
        .mockReturnValueOnce(replacementEmit.promise);

      const firstRoute = webhook.routeEvent({
        event: 'call_started',
        event_id: 'evt_lifecycle_replace',
      });
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(1);

      const replacementRoute = webhook.routeEvent({
        event: 'call_started',
        event_id: 'evt_lifecycle_replace',
      });
      await expect(firstRoute).resolves.toEqual({
        received: true,
        routed: true,
        event: 'call_started',
        eventId: 'evt_lifecycle_replace',
      });
      expect(jest.getTimerCount()).toBe(1);

      replacementEmit.resolve({ emitted: true, handlerCount: 0, errors: 0 });
      await expect(replacementRoute).resolves.toEqual({
        received: true,
        routed: true,
        event: 'call_started',
        eventId: 'evt_lifecycle_replace',
      });
      expect(jest.getTimerCount()).toBe(0);

      firstEmit.resolve({ emitted: true, handlerCount: 0, errors: 0 });
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(0);
    });

    test('explicit cancellation retires the timer and cannot fire later', async () => {
      const emit = deferred();
      businessEvents.emit.mockReturnValueOnce(emit.promise);
      const route = webhook.routeEvent({
        event: 'call_started',
        event_id: 'evt_lifecycle_cancel',
      });
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(1);

      expect(webhook.cancelPendingEvent('evt_lifecycle_cancel')).toBe(true);
      await expect(route).resolves.toEqual({
        received: true,
        routed: true,
        event: 'call_started',
        eventId: 'evt_lifecycle_cancel',
      });
      expect(webhook.cancelPendingEvent('evt_lifecycle_cancel')).toBe(false);
      expect(jest.getTimerCount()).toBe(0);

      jest.advanceTimersByTime(10000);
      emit.resolve({ emitted: true, handlerCount: 0, errors: 0 });
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(0);
    });

    test('shutdown cancels every timer and rejects new routing until restarted', async () => {
      const firstEmit = deferred();
      const secondEmit = deferred();
      businessEvents.emit
        .mockReturnValueOnce(firstEmit.promise)
        .mockReturnValueOnce(secondEmit.promise);
      const firstRoute = webhook.routeEvent({ event: 'call_started', event_id: 'evt_shutdown_1' });
      const secondRoute = webhook.routeEvent({ event: 'call_ended', event_id: 'evt_shutdown_2' });
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(2);

      expect(webhook.shutdown()).toBe(2);
      await expect(Promise.all([firstRoute, secondRoute])).resolves.toEqual([
        { received: true, routed: true, event: 'call_started', eventId: 'evt_shutdown_1' },
        { received: true, routed: true, event: 'call_ended', eventId: 'evt_shutdown_2' },
      ]);
      expect(jest.getTimerCount()).toBe(0);

      await expect(webhook.routeEvent({
        event: 'call_started',
        event_id: 'evt_after_shutdown',
      })).resolves.toEqual({
        received: true,
        routed: false,
        reason: 'webhook_shutdown',
        event: 'call_started',
        eventId: 'evt_after_shutdown',
      });
      expect(businessEvents.emit).toHaveBeenCalledTimes(2);

      firstEmit.resolve({ emitted: true, handlerCount: 0, errors: 0 });
      secondEmit.resolve({ emitted: true, handlerCount: 0, errors: 0 });
      webhook.start();
    });

    test('timeout completion removes the expired callback exactly once', async () => {
      const emit = deferred();
      const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
      businessEvents.emit.mockReturnValueOnce(emit.promise);
      const route = webhook.routeEvent({
        event: 'call_started',
        event_id: 'evt_lifecycle_timeout',
      });
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(1);

      jest.advanceTimersByTime(10000);
      await expect(route).resolves.toEqual({
        received: true,
        routed: true,
        event: 'call_started',
        eventId: 'evt_lifecycle_timeout',
      });
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        '[Voice:Webhook] Event handler error for call_started:',
        'Handler timeout'
      );
      expect(jest.getTimerCount()).toBe(0);

      emit.resolve({ emitted: true, handlerCount: 0, errors: 0 });
      await Promise.resolve();
      expect(errorLog).toHaveBeenCalledTimes(1);
      errorLog.mockRestore();
    });
  });

  // ── Integration: Full handleWebhook ───────────────────────

  describe('handleWebhook', () => {
    // Save/restore env vars to avoid .env leakage
    let originalRetellKey, originalWebhookSecret;
    const testSecret = 'voice-webhook-unit-secret';

    beforeEach(() => {
      originalRetellKey = process.env.RETELL_API_KEY;
      originalWebhookSecret = process.env.RETELL_WEBHOOK_SECRET;
      delete process.env.RETELL_API_KEY;
      process.env.RETELL_WEBHOOK_SECRET = testSecret;
    });

    afterEach(() => {
      if (originalRetellKey === undefined) delete process.env.RETELL_API_KEY;
      else process.env.RETELL_API_KEY = originalRetellKey;
      if (originalWebhookSecret === undefined) delete process.env.RETELL_WEBHOOK_SECRET;
      else process.env.RETELL_WEBHOOK_SECRET = originalWebhookSecret;
    });
    // Mock express req/res
    function mockReq(body = {}, headers = {}) {
      const rawBody = JSON.stringify(body);
      return {
        body,
        rawBody,
        headers: {
          'content-type': 'application/json',
          'x-retell-signature': crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex'),
          ...headers,
        },
      };
    }

    function mockRes() {
      return {
        statusCode: null,
        responseBody: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.responseBody = data;
          return this;
        },
      };
    }

    test('fails closed when persisted integration ownership is unavailable', async () => {
      const req = mockReq({
        event: 'call_started',
        event_id: 'test_evt_' + Date.now(),
        call_id: 'call_test',
        timestamp: Math.floor(Date.now() / 1000),
      }, {
        'x-retell-timestamp': String(Math.floor(Date.now() / 1000)),
      });

      const res = mockRes();
      await webhook.handleWebhook(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.responseBody.error.code).toBe('CANONICAL_PERSISTENCE_UNAVAILABLE');
    });

    test('returns 400 for invalid timestamp', async () => {
      const oldTimestamp = String(Math.floor((Date.now() - 20 * 60 * 1000) / 1000)); // 20 min ago
      const req = mockReq({
        event: 'call_started',
        event_id: 'test_old',
        timestamp: oldTimestamp,
      }, {
        'x-retell-timestamp': oldTimestamp,
      });

      const res = mockRes();
      await webhook.handleWebhook(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.responseBody.error).toBeDefined();
      expect(res.responseBody.error.code).toBe('INVALID_TIMESTAMP');
    });

    test('a canonical 5xx releases the replay claim for a legitimate retry', async () => {
      const eventId = 'dup_test_' + Date.now();
      const req = mockReq({
        event: 'call_started',
        event_id: eventId,
        timestamp: Math.floor(Date.now() / 1000),
      }, {
        'x-retell-timestamp': String(Math.floor(Date.now() / 1000)),
      });

      // First call
      const res1 = mockRes();
      await webhook.handleWebhook(req, res1);
      expect(res1.statusCode).toBe(503);
      expect(res1.responseBody.error.code).toBe('CANONICAL_PERSISTENCE_UNAVAILABLE');

      // Second call with same event_id
      const res2 = mockRes();
      await webhook.handleWebhook(req, res2);
      expect(res2.statusCode).toBe(503);
      expect(res2.responseBody.error.code).toBe('CANONICAL_PERSISTENCE_UNAVAILABLE');
    });

    test('a non-5xx malformed body retains the replay claim', async () => {
      const rawBody = '{"event":';
      const signature = crypto.createHmac('sha256', testSecret).update(rawBody).digest('hex');
      const req = {
        rawBody,
        headers: {
          'content-type': 'application/json',
          'x-retell-signature': signature,
          'x-retell-timestamp': String(Math.floor(Date.now() / 1000)),
        },
      };

      const first = mockRes();
      await webhook.handleWebhook(req, first);
      expect(first.statusCode).toBe(400);
      expect(first.responseBody.error.code).toBe('INVALID_WEBHOOK_BODY');

      const replay = mockRes();
      await webhook.handleWebhook(req, replay);
      expect(replay.statusCode).toBe(409);
      expect(replay.responseBody.error.code).toBe('WEBHOOK_REPLAYED');
      webhook.releaseReplay('hmac:' + signature);
    });
  });
});
