/**
 * Unit Tests: Voice Webhook Framework
 *
 * Tests for src/voice/webhook.js
 * - HMAC-SHA256 signature validation
 * - Embedded timestamp validation (±5min window)
 * - Durable replay fail-closure
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
    const apiKey = 'official-retell-webhook-api-key';

    function officialHeader(body, timestamp = String(Date.now()), key = apiKey) {
      const digest = crypto.createHmac('sha256', key)
        .update(body)
        .update(timestamp, 'ascii')
        .digest('hex');
      return `v=${timestamp},d=${digest}`;
    }

    let originalApiKey;
    let originalLegacySecret;

    beforeEach(() => {
      originalApiKey = process.env.RETELL_API_KEY;
      originalLegacySecret = process.env.RETELL_WEBHOOK_SECRET;
      process.env.RETELL_API_KEY = apiKey;
      process.env.RETELL_WEBHOOK_SECRET = 'ignored-legacy-secret';
    });

    afterEach(() => {
      if (originalApiKey === undefined) delete process.env.RETELL_API_KEY;
      else process.env.RETELL_API_KEY = originalApiKey;
      if (originalLegacySecret === undefined) delete process.env.RETELL_WEBHOOK_SECRET;
      else process.env.RETELL_WEBHOOK_SECRET = originalLegacySecret;
    });

    test('fails closed when no validation material is configured', () => {
      delete process.env.RETELL_API_KEY;
      expect(webhook.validateSignature('body', officialHeader('body'))).toBe(false);
    });

    test('returns false when signature is missing', () => {
      expect(webhook.validateSignature('body', '')).toBe(false);
    });

    test('returns false for mismatched signature', () => {
      expect(webhook.validateSignature('body', officialHeader('body', String(Date.now()), 'wrong-key'))).toBe(false);
    });

    test('accepts exact official raw-body-plus-timestamp bytes using only the API key', () => {
      const timestamp = String(Date.now());
      const body = Buffer.from('{\r\n"label":"caf\u00e9"\r\n}', 'utf8');
      expect(webhook.validateSignature(body, officialHeader(body, timestamp))).toBe(true);
      expect(webhook.validateSignature(Buffer.from(body.toString('utf8').replace('\r\n', '\n')), officialHeader(body, timestamp)))
        .toBe(false);
    });

    test('rejects the invented bare digest and every non-canonical composite form', () => {
      const body = 'body';
      const timestamp = String(Date.now());
      const canonical = officialHeader(body, timestamp);
      const digest = canonical.split('d=')[1];
      expect(webhook.validateSignature(body, digest)).toBe(false);
      expect(webhook.validateSignature(body, canonical.toUpperCase())).toBe(false);
      expect(webhook.validateSignature(body, canonical + ',x=1')).toBe(false);
      expect(webhook.validateSignature(body, ' ' + canonical)).toBe(false);
      expect(webhook.validateSignature(body, `v=${timestamp},d=${'g'.repeat(64)}`)).toBe(false);
    });

    test('parses only one complete embedded-millisecond header', () => {
      const canonical = officialHeader('body');
      expect(webhook.parseSignature(canonical)).toEqual({
        timestamp: canonical.match(/^v=(\d+),/)[1],
        digest: canonical.slice(-64),
      });
      for (const invalid of [null, '', `d=${'0'.repeat(64)}`, `v=123abc,d=${'0'.repeat(64)}`,
        `v=1.5,d=${'0'.repeat(64)}`, `v=1,d=${'0'.repeat(63)}`]) {
        expect(webhook.parseSignature(invalid)).toBeNull();
      }
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
      const ts = now - 2 * 60 * 1000;
      expect(webhook.validateTimestamp(String(ts))).toBe(true);
    });

    test('accepts timestamp in milliseconds', () => {
      const tsMs = Date.now() - 60000; // 1 minute ago
      expect(webhook.validateTimestamp(String(tsMs))).toBe(true);
    });

    test('rejects timestamp older than 5 minutes', () => {
      const ts = Date.now() - 10 * 60 * 1000;
      expect(webhook.validateTimestamp(String(ts))).toBe(false);
    });

    test('rejects future timestamp beyond 5 minutes', () => {
      const ts = Date.now() + 10 * 60 * 1000;
      expect(webhook.validateTimestamp(String(ts))).toBe(false);
    });

    test('rejects seconds, numeric prefixes, decimals, non-strings, and unsafe integers', () => {
      expect(webhook.validateTimestamp(String(Math.floor(Date.now() / 1000)))).toBe(false);
      expect(webhook.validateTimestamp('123abc')).toBe(false);
      expect(webhook.validateTimestamp(String(Date.now()) + '.5')).toBe(false);
      expect(webhook.validateTimestamp(Date.now())).toBe(false);
      expect(webhook.validateTimestamp(Infinity)).toBe(false);
      expect(webhook.validateTimestamp(String(Number.MAX_SAFE_INTEGER + 1))).toBe(false);
    });
  });

  // ── Deduplication ─────────────────────────────────────────

  // ── Event Routing ─────────────────────────────────────────

  describe('provider event identity', () => {
    const organizationId = '66000000-0000-0000-0000-000000000001';
    const otherOrganizationId = '66000000-0000-0000-0000-000000000002';
    const identity = (payload, overrides = {}) => webhook.providerEventIdentity(payload, {
      organizationId,
      ingestionSource: 'retell',
      ...overrides,
    });

    test('uses the exact existing supported-event contract', () => {
      expect(webhook.SUPPORTED_EVENTS).toEqual([
        'call_started', 'call_ended', 'call_analyzed', 'transcript_ready', 'transcript', 'ping',
      ]);
      webhook.SUPPORTED_EVENTS.forEach(event => expect(webhook.isSupportedEvent(event)).toBe(true));
      expect(webhook.isSupportedEvent('transcript_updated')).toBe(false);
      expect(webhook.isSupportedEvent('')).toBe(false);
      expect(webhook.isSupportedEvent(undefined)).toBe(false);
    });

    test('hashes supplied identity into provider, source, tenant, call, and event domains', () => {
      const first = {
        event_id: '  provider-event-1  ',
        event: 'call_ended',
        call: { call_id: 'official-call-1', agent_id: 'agent-a', transcript: 'safe transcript' },
      };
      const reordered = {
        call: { transcript: 'safe transcript', agent_id: 'agent-a', call_id: 'official-call-1' },
        event_id: 'provider-event-1',
        event: 'call_ended',
      };
      const eventIdentity = identity(first);
      expect(eventIdentity).toMatch(/^retell-provider-event-v2:[0-9a-f]{64}$/);
      expect(eventIdentity).not.toContain('provider-event-1');
      expect(identity(reordered)).toBe(eventIdentity);
      expect(identity({ ...reordered, event: 'call_analyzed' })).not.toBe(eventIdentity);
      expect(identity({ ...reordered, call: { ...reordered.call, call_id: 'official-call-2' } })).not.toBe(eventIdentity);
      expect(identity(reordered, { ingestionSource: 'voice' })).not.toBe(eventIdentity);
      expect(identity(reordered, { organizationId: otherOrganizationId })).not.toBe(eventIdentity);
      expect(eventIdentity).not.toBe('provider-event-1');
    });

    test('derives stable official no-ID identity and separates distinct transcript semantics', () => {
      const lifecycle = {
        event: 'call_ended',
        call: { call_id: 'official-call-1', agent_id: 'agent-a', transcript: 'safe transcript' },
      };
      const lifecycleReordered = {
        call: { transcript: 'safe transcript', agent_id: 'agent-a', call_id: 'official-call-1' },
        event: 'call_ended',
      };
      expect(identity(lifecycleReordered)).toBe(identity(lifecycle));

      const first = {
        event: 'transcript', call_id: 'transcript-call-1', speaker: 'user', text: 'first update',
      };
      const reordered = {
        text: 'first update', speaker: 'user', call_id: 'transcript-call-1', event: 'transcript',
      };
      expect(identity(reordered)).toBe(identity(first));
      expect(identity({ ...reordered, text: 'second update' }))
        .not.toBe(identity(first));
    });
  });

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
    let originalRetellKey, originalWebhookSecret;
    const testApiKey = 'voice-webhook-unit-api-key';

    beforeEach(() => {
      originalRetellKey = process.env.RETELL_API_KEY;
      originalWebhookSecret = process.env.RETELL_WEBHOOK_SECRET;
      process.env.RETELL_API_KEY = testApiKey;
      process.env.RETELL_WEBHOOK_SECRET = 'ignored-legacy-secret';
    });

    afterEach(() => {
      if (originalRetellKey === undefined) delete process.env.RETELL_API_KEY;
      else process.env.RETELL_API_KEY = originalRetellKey;
      if (originalWebhookSecret === undefined) delete process.env.RETELL_WEBHOOK_SECRET;
      else process.env.RETELL_WEBHOOK_SECRET = originalWebhookSecret;
    });
    function mockReq(body = {}, headers = {}, timestamp = String(Date.now())) {
      const rawBody = JSON.stringify(body);
      const digest = crypto.createHmac('sha256', testApiKey)
        .update(rawBody)
        .update(timestamp, 'ascii')
        .digest('hex');
      return {
        body,
        rawBody,
        headers: {
          'content-type': 'application/json',
          'x-retell-signature': `v=${timestamp},d=${digest}`,
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

    test('fails closed before JSON parsing when durable replay persistence is unavailable', async () => {
      const req = mockReq({
        event: 'call_started',
        event_id: 'test_evt_' + Date.now(),
        call_id: 'call_test',
      });

      const res = mockRes();
      await webhook.handleWebhook(req, res);

      expect(res.statusCode).toBe(503);
      expect(res.responseBody.error.code).toBe('WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE');
    });

    test('returns 400 for an expired embedded millisecond timestamp', async () => {
      const oldTimestamp = String(Date.now() - 20 * 60 * 1000);
      const req = mockReq({
        event: 'call_started',
        event_id: 'test_old',
      }, {}, oldTimestamp);

      const res = mockRes();
      await webhook.handleWebhook(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.responseBody.error).toBeDefined();
      expect(res.responseBody.error.code).toBe('INVALID_TIMESTAMP');
    });

    test('does not accept the invented separate timestamp header', async () => {
      const rawBody = JSON.stringify({ event: 'ping' });
      const req = {
        rawBody,
        headers: {
          'content-type': 'application/json',
          'x-retell-timestamp': String(Date.now()),
        },
      };

      const res = mockRes();
      await webhook.handleWebhook(req, res);
      expect(res.statusCode).toBe(401);
      expect(res.responseBody.error.code).toBe('INVALID_SIGNATURE');
    });
  });
});
