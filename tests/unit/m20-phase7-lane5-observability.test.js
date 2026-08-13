'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..', '..');

function response(statusCode) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  return res;
}

function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

describe('Mission 20 Phase 7 Lane 5 bounded and redacted observability', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.dontMock('../../src/audit/client');
    jest.dontMock('../../src/db');
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('safe logger emits one structured allowlisted object and never serializes sensitive input', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const safeLogger = require('../../src/observability/safeLogger');
    const secret = 'sk_live_lane5_secret';
    const phone = '+15551234567';
    const email = 'private@example.com';
    const transcript = 'customer transcript words';
    const payload = { secret, phone, email, transcript };
    const hostileError = new Error(`${secret} ${phone} ${email} ${transcript}`);

    safeLogger.info('retell', 'request_started', {
      requestId: '77b66d85-06c1-4d6e-a19a-8c5826af349f',
      attempt: 2,
      maxAttempts: 3,
      methodClass: 'POST',
      payload,
      authorization: `Bearer ${secret}`,
      error: hostileError,
      token: secret,
      tenantId: 'tenant-sensitive',
      customerId: 'customer-sensitive',
    });
    safeLogger.warn('twilio', 'provider_unconfigured', { configured: false });
    safeLogger.error('jobber', 'provider_request_failed', {
      requestId: 'not-a-correlation-id-or-safe-value',
      statusCode: 503,
      retryable: true,
      errorCode: secret,
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    for (const call of [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]) {
      expect(call).toHaveLength(1);
      expect(call[0]).toEqual(expect.objectContaining({ component: expect.any(String), event: expect.any(String) }));
      const serialized = JSON.stringify(call[0]);
      for (const sensitive of [secret, phone, email, transcript, 'tenant-sensitive', 'customer-sensitive', 'Bearer']) {
        expect(serialized).not.toContain(sensitive);
      }
    }
    expect(info.mock.calls[0][0]).toEqual({
      component: 'retell',
      event: 'request_started',
      requestId: '77b66d85-06c1-4d6e-a19a-8c5826af349f',
      attempt: 2,
      maxAttempts: 3,
      methodClass: 'POST',
    });
    expect(error.mock.calls[0][0].requestId).toBe('unavailable');
    expect(error.mock.calls[0][0]).not.toHaveProperty('errorCode');
  });

  test('anonymous API 404 is aggregated once and does not enter the durable or memory audit stream', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const recordAnonymousNotFound = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../src/audit/client', () => ({ record, recordAnonymousNotFound }));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const { auditLogger } = require('../../src/middleware/auditLog');
    const req = {
      method: 'GET',
      path: '/api/attacker-controlled/private@example.com/sk_live_never-log',
      originalUrl: '/api/attacker-controlled/private@example.com/sk_live_never-log?token=secret',
      url: '/api/attacker-controlled/private@example.com/sk_live_never-log?token=secret',
      headers: { 'user-agent': 'secret-user-agent' },
      requestId: '77b66d85-06c1-4d6e-a19a-8c5826af349f',
      ip: '203.0.113.45',
      params: {},
    };
    const res = response(404);

    auditLogger(req, res, jest.fn());
    res.emit('finish');
    await settle();

    expect(recordAnonymousNotFound).toHaveBeenCalledTimes(1);
    expect(recordAnonymousNotFound).toHaveBeenCalledWith({ method: 'GET' });
    expect(record).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]).toHaveLength(1);
    expect(info.mock.calls[0][0]).toEqual(expect.objectContaining({
      component: 'http',
      event: 'request_completed',
      requestId: req.requestId,
      methodClass: 'GET',
      statusCode: 404,
    }));
    const logged = JSON.stringify(info.mock.calls[0][0]);
    expect(logged).not.toContain('attacker-controlled');
    expect(logged).not.toContain('private@example.com');
    expect(logged).not.toContain('secret-user-agent');
    expect(logged).not.toContain('203.0.113.45');
  });

  test('authenticated 404 and non-404 modifying traffic retain existing audit semantics', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const recordAnonymousNotFound = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../src/audit/client', () => ({ record, recordAnonymousNotFound }));
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const { auditLogger } = require('../../src/middleware/auditLog');
    const authenticated = {
      method: 'GET', path: '/api/assets/missing', originalUrl: '/api/assets/missing',
      headers: {}, requestId: '77b66d85-06c1-4d6e-a19a-8c5826af349f', ip: '127.0.0.1',
      params: { id: 'missing' }, user: { id: 'user-1' }, userRole: 'owner',
      tenantContext: { organizationId: 'org-1', userId: 'user-1' },
    };
    const modifying = {
      method: 'PATCH', path: '/api/assets/asset-1', originalUrl: '/api/assets/asset-1',
      headers: {}, requestId: '0499f256-aa0f-45bd-bd07-4a10be934fd3', ip: '127.0.0.1',
      params: { id: 'asset-1' }, user: { id: 'user-1' }, userRole: 'owner',
      tenantContext: { organizationId: 'org-1', userId: 'user-1' },
    };

    const first = response(404);
    auditLogger(authenticated, first, jest.fn());
    first.emit('finish');
    const second = response(200);
    auditLogger(modifying, second, jest.fn());
    second.emit('finish');
    await settle();

    expect(recordAnonymousNotFound).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0][0]).toEqual(expect.objectContaining({ action: 'GET 404', userId: 'user-1' }));
    expect(record.mock.calls[1][0]).toEqual(expect.objectContaining({ action: 'PATCH 200', userId: 'user-1' }));
  });

  test('exact signed webhook 404 retains its accepted zero-generic-write boundary', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const recordAnonymousNotFound = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../src/audit/client', () => ({ record, recordAnonymousNotFound }));
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const { auditLogger } = require('../../src/middleware/auditLog');
    const req = {
      method: 'POST', path: '/api/retell/webhook', originalUrl: '/api/retell/webhook',
      headers: {}, requestId: '77b66d85-06c1-4d6e-a19a-8c5826af349f', ip: '127.0.0.1', params: {},
    };
    const res = response(404);

    auditLogger(req, res, jest.fn());
    res.emit('finish');
    await settle();

    expect(recordAnonymousNotFound).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  test('aggregate client uses a fixed UTC-hour slot and handles persistence failure without audit memory growth', async () => {
    jest.dontMock('../../src/audit/client');
    const query = jest.fn()
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockRejectedValueOnce(new Error('password=secret private@example.com'));
    jest.doMock('../../src/db', () => ({ isAvailable: () => true, query }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const audit = require('../../src/audit/client');
    const before = await audit.query({ action: 'GET 404', limit: 10000 });

    await audit.recordAnonymousNotFound({ method: 'get', observedAt: new Date('2026-08-13T22:41:09.123Z') });
    await audit.recordAnonymousNotFound({ method: 'TRACE', observedAt: new Date('2026-08-13T22:59:59.999Z') });
    const after = await audit.query({ action: 'GET 404', limit: 10000 });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('api_observability_hourly');
    expect(query.mock.calls[0][1]).toEqual([
      'anonymous_api_not_found', 'GET', 22, '2026-08-13T22:00:00.000Z', '2026-08-13T22:41:09.123Z',
    ]);
    expect(query.mock.calls[1][1][1]).toBe('OTHER');
    expect(after.pagination.total).toBe(before.pagination.total);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(warn.mock.calls[0][0]).toEqual({
      component: 'audit', event: 'anonymous_not_found_aggregation_failed', requestId: 'unavailable',
    });
    expect(JSON.stringify(warn.mock.calls[0][0])).not.toContain('password=secret');
  });

  test('every reachable provider-facing module routes logs through the strict logger', () => {
    const providerFiles = [
      'src/audit/client.js',
      'src/middleware/auditLog.js',
      'src/middleware/errorHandler.js',
      'src/retell/client.js',
      'src/voice/webhook.js',
      'src/voice/businessEvents.js',
      'src/voice/transcriptStream.js',
      'src/voice/callCompletion.js',
      'src/voice/eventIntelligence.js',
      'src/voice/humanHandoff.js',
      'src/voice/toolRegistry.js',
      'src/integrations/jobber.js',
      'src/routes/jobberIntegration.js',
      'src/accounts/service.js',
      'src/workforce/service.js',
      'src/email/outbox.js',
      'src/notifications/email.js',
      'src/notifications/sms.js',
      'src/sheets/client.js',
      'src/calendar/client.js',
    ];
    for (const relative of providerFiles) {
      const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)\s*\(/);
      expect(source).toContain("require('../observability/safeLogger')");
    }
    const apiSource = fs.readFileSync(path.join(ROOT, 'src/routes/api.js'), 'utf8');
    expect(apiSource).not.toContain("console.error('[API] Retell create-call error:', err.message)");
    expect(apiSource).toContain("safeLogger.error('retell', 'create_call_failed'");
  });
});
