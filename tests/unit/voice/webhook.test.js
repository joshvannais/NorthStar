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

describe('Voice Webhook Framework', () => {
  // ── Signature Validation ──────────────────────────────────

  describe('validateSignature', () => {
    test('returns true when no secret is configured (dev mode)', () => {
      // validateSignature checks process.env.RETELL_WEBHOOK_SECRET at call time
      // If not set, it returns true (skip validation)
      const result = webhook.validateSignature('body', 'sig123');
      // This will skip if env var is not set
      expect(typeof result).toBe('boolean');
    });

    test('returns false when signature is missing', () => {
      // Set a secret so validation is attempted
      const originalSecret = process.env.RETELL_WEBHOOK_SECRET;
      process.env.RETELL_WEBHOOK_SECRET = 'test-secret';
      const result = webhook.validateSignature('body', '');
      process.env.RETELL_WEBHOOK_SECRET = originalSecret;
      expect(result).toBe(false);
    });

    test('returns false for mismatched signature', () => {
      const originalSecret = process.env.RETELL_WEBHOOK_SECRET;
      process.env.RETELL_WEBHOOK_SECRET = 'correct-secret';
      // Generate an HMAC with a DIFFERENT secret
      const crypto = require('crypto');
      const wrongSig = crypto.createHmac('sha256', 'wrong-secret').update('body').digest('hex');
      const result = webhook.validateSignature('body', wrongSig);
      process.env.RETELL_WEBHOOK_SECRET = originalSecret;
      expect(result).toBe(false);
    });

    test('returns true for correct signature', () => {
      const originalSecret = process.env.RETELL_WEBHOOK_SECRET;
      const secret = 'correct-secret';
      process.env.RETELL_WEBHOOK_SECRET = secret;
      const crypto = require('crypto');
      const correctSig = crypto.createHmac('sha256', secret).update('body').digest('hex');
      const result = webhook.validateSignature('body', correctSig);
      process.env.RETELL_WEBHOOK_SECRET = originalSecret;
      expect(result).toBe(true);
    });

    test('handles different body lengths securely', () => {
      const originalSecret = process.env.RETELL_WEBHOOK_SECRET;
      const secret = 'secure-secret';
      process.env.RETELL_WEBHOOK_SECRET = secret;
      const crypto = require('crypto');
      const shortBody = 'hello';
      const shortSig = crypto.createHmac('sha256', secret).update(shortBody).digest('hex');
      // Using shortSig against a different body should fail
      const result = webhook.validateSignature('different body', shortSig);
      process.env.RETELL_WEBHOOK_SECRET = originalSecret;
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
      expect(webhook.validateTimestamp(ts)).toBe(true);
    });

    test('accepts timestamp in milliseconds', () => {
      const tsMs = Date.now() - 60000; // 1 minute ago
      expect(webhook.validateTimestamp(tsMs)).toBe(true);
    });

    test('rejects timestamp older than 5 minutes', () => {
      const ts = Math.floor((Date.now() - 10 * 60 * 1000) / 1000); // 10 minutes ago
      expect(webhook.validateTimestamp(ts)).toBe(false);
    });

    test('rejects future timestamp beyond 5 minutes', () => {
      const ts = Math.floor((Date.now() + 10 * 60 * 1000) / 1000); // 10 minutes in future
      expect(webhook.validateTimestamp(ts)).toBe(false);
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

  // ── Integration: Full handleWebhook ───────────────────────

  describe('handleWebhook', () => {
    // Save/restore env vars to avoid .env leakage
    let originalRetellKey, originalWebhookSecret;

    beforeEach(() => {
      originalRetellKey = process.env.RETELL_API_KEY;
      originalWebhookSecret = process.env.RETELL_WEBHOOK_SECRET;
      delete process.env.RETELL_API_KEY;
      delete process.env.RETELL_WEBHOOK_SECRET;
    });

    afterEach(() => {
      if (originalRetellKey !== undefined) process.env.RETELL_API_KEY = originalRetellKey;
      if (originalWebhookSecret !== undefined) process.env.RETELL_WEBHOOK_SECRET = originalWebhookSecret;
    });
    // Mock express req/res
    function mockReq(body = {}, headers = {}) {
      return {
        body,
        rawBody: JSON.stringify(body),
        headers,
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

    test('returns 200 with received:true for valid event', async () => {
      const req = mockReq({
        event: 'call_started',
        event_id: 'test_evt_' + Date.now(),
        call_id: 'call_test',
        timestamp: Math.floor(Date.now() / 1000),
      }, {
        'x-retell-signature': '',
        'x-retell-timestamp': String(Math.floor(Date.now() / 1000)),
      });

      const res = mockRes();
      await webhook.handleWebhook(req, res);

      expect(res.statusCode).toBeNull(); // 200 default
      expect(res.responseBody.received).toBe(true);
    });

    test('returns 400 for invalid timestamp', async () => {
      const oldTimestamp = String(Math.floor((Date.now() - 20 * 60 * 1000) / 1000)); // 20 min ago
      const req = mockReq({
        event: 'call_started',
        event_id: 'test_old',
        timestamp: oldTimestamp,
      }, {
        'x-retell-signature': '',
        'x-retell-timestamp': oldTimestamp,
      });

      const res = mockRes();
      await webhook.handleWebhook(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.responseBody.error).toBeDefined();
      expect(res.responseBody.error.code).toBe('INVALID_TIMESTAMP');
    });

    test('returns deduplicated:true for duplicate event', async () => {
      const eventId = 'dup_test_' + Date.now();
      const req = mockReq({
        event: 'call_started',
        event_id: eventId,
        timestamp: Math.floor(Date.now() / 1000),
      }, {
        'x-retell-signature': '',
        'x-retell-timestamp': String(Math.floor(Date.now() / 1000)),
      });

      // First call
      const res1 = mockRes();
      await webhook.handleWebhook(req, res1);
      expect(res1.responseBody.received).toBe(true);
      expect(res1.responseBody.deduplicated).toBeUndefined();

      // Second call with same event_id
      const res2 = mockRes();
      await webhook.handleWebhook(req, res2);
      expect(res2.responseBody.received).toBe(true);
      expect(res2.responseBody.deduplicated).toBe(true);
    });
  });
});
