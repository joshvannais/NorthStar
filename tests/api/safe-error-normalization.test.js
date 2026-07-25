'use strict';

require('../helpers/loopbackConcurrencyGuard').install();

const express = require('express');
const request = require('supertest');
jest.mock('../../src/audit/client', function () {
  return {
    record: jest.fn(function () { return Promise.resolve(); }),
  };
});
const audit = require('../../src/audit/client');
const { correlationId, auditLogger } = require('../../src/middleware/auditLog');
const {
  ApiError,
  errorHandler,
  normalizeErrorResponses
} = require('../../src/middleware/errorHandler');

function buildApp() {
  const app = express();
  app.use(correlationId);
  app.use(auditLogger);
  app.use(normalizeErrorResponses);
  app.use(express.json({ limit: '1mb' }));
  app.post('/required-json', function (req, res) {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
        Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'A JSON object is required' });
    }
    return res.json({ success: true });
  });
  app.get('/sql', function (_req, _res, next) {
    const error = new Error('SELECT secret FROM users at db.internal.example');
    error.code = '42601';
    next(error);
  });
  app.get('/filesystem', function (_req, _res, next) {
    next(new ApiError(503, 'persistence_unavailable', 'ENOENT C:\\private\\customers.json'));
  });
  app.get('/validation', function (_req, _res, next) {
    const error = new Error('validator leaked password=hunter2');
    error.name = 'ValidationError';
    error.details = [
      { path: ['customer', 'email'], type: 'string.email', value: 'private@example.test', message: 'raw validator message' },
      { field: '..\\private\\field', code: 'any.required', value: 'secret' }
    ];
    next(error);
  });
  app.get('/timeout', function (_req, _res, next) {
    next(new ApiError(504, 'timeout', 'connect ETIMEDOUT postgres://secret@db.internal'));
  });
  app.get('/uniqueness', function (_req, _res, next) {
    const error = new Error('duplicate key value violates unique constraint users_email_key');
    error.code = '23505';
    next(error);
  });
  app.get('/connection', function (_req, _res, next) {
    next(new ApiError(503, 'persistence_unavailable', 'ECONNREFUSED 10.0.0.8:5432'));
  });
  app.get('/malicious-status', function (_req, _res, next) {
    next(new ApiError(418, 'owned_by_other_org', '<script>alert(document.cookie)</script>'));
  });
  app.get('/direct-500', function (_req, res) {
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'C:\\secrets\\app.js SELECT password stack trace'
      }
    });
  });
  [
    [400, 'bad_request'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'validation_error'],
    [429, 'rate_limited'],
    [500, 'internal_error'],
    [503, 'service_unavailable'],
  ].forEach(function (fixture) {
    app.get(['/status-' + fixture[0], '/api/status-' + fixture[0]], function (_req, res) {
      res.status(fixture[0]).json({
        error: {
          code: fixture[1],
          message: 'raw internal endpoint /private SELECT secret C:\\hidden\\file.js',
        },
      });
    });
  });
  app.use(errorHandler);
  return app;
}

describe('safe public error normalization', function () {
  const app = buildApp();
  let logSpy;

  beforeEach(function () {
    audit.record.mockReset().mockResolvedValue();
    logSpy = jest.spyOn(console, 'error').mockImplementation(function () {});
  });

  afterEach(function () {
    logSpy.mockRestore();
  });

  test.each([
    ['/sql', 500, 'internal_error'],
    ['/filesystem', 503, 'persistence_unavailable'],
    ['/timeout', 504, 'timeout'],
    ['/uniqueness', 500, 'internal_error'],
    ['/connection', 503, 'persistence_unavailable'],
    ['/malicious-status', 400, 'bad_request'],
    ['/direct-500', 500, 'internal_error']
  ])('%s returns only allowlisted public data', async function (path, status, code) {
    const response = await request(app).get(path).set('X-Correlation-ID', 'opaque-request-123');
    expect(response.status).toBe(status);
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(response.body.requestId).toBe(response.headers['x-correlation-id']);
    expect(response.body.requestId).not.toBe('opaque-request-123');
    expect(response.body.code).toBe(code);
    expect(typeof response.body.error).toBe('string');
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/SELECT|postgres|db\.internal|C:\\|stack|23505|users_email|10\.0\.0\.8|script|cookie|ECONN|ENOENT/i);
  });

  test('validation exposes only normalized field identifiers and codes', async function () {
    const response = await request(app).get('/validation').set('X-Correlation-ID', 'validation-request');
    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: 'Invalid request data.',
      code: 'validation_error',
      requestId: response.headers['x-correlation-id'],
      details: {
        errors: [
          { field: 'customer.email', code: 'string.email' },
          { field: 'request', code: 'any.required' }
        ]
      }
    });
    expect(JSON.stringify(response.body)).not.toMatch(/hunter2|private@example|raw validator|secret/i);
  });

  test.each([
    [400, 'bad_request'],
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'validation_error'],
    [429, 'rate_limited'],
    [500, 'internal_error'],
    [503, 'service_unavailable'],
  ])('normalizes a direct %i with one canonical request ID', async function (status, code) {
    logSpy.mockClear();
    const supplied = '123e4567-e89b-42d3-a456-426614174000';
    const response = await request(app)
      .get('/status-' + status)
      .set('X-Correlation-ID', supplied);
    const requestId = response.headers['x-correlation-id'];
    expect(response.status).toBe(status);
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(response.body.requestId).toBe(requestId);
    expect(response.body.code).toBe(code);
    expect(typeof response.body.error).toBe('string');
    expect(requestId).not.toBe(supplied);
    expect(JSON.stringify(response.body)).not.toMatch(/private|SELECT|C:\\|hidden|endpoint/i);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mock.calls.forEach(function (call) {
      expect(JSON.stringify(call)).toContain(requestId);
    });
  });

  test('audit persistence failure warning is correlated and contains no raw failure details', async function () {
    const warning = jest.spyOn(console, 'warn').mockImplementation(function () {});
    audit.record.mockRejectedValueOnce(
      new Error('postgres://secret@db.internal C:\\private\\audit.sql SELECT * FROM audit_logs')
    );
    try {
      const response = await request(app).get('/api/status-400');
      await new Promise(function (resolve) { setImmediate(resolve); });
      await new Promise(function (resolve) { setImmediate(resolve); });
      const requestId = response.headers['x-correlation-id'];
      expect(response.body.requestId).toBe(requestId);
      expect(warning).toHaveBeenCalled();
      const serialized = JSON.stringify(warning.mock.calls);
      expect(serialized).toContain(requestId);
      expect(serialized).not.toMatch(/postgres|db\.internal|C:\\|SELECT|audit_logs|secret/i);
      warning.mock.calls.forEach(function (call) {
        expect(JSON.stringify(call)).toContain(requestId);
      });
    } finally {
      warning.mockRestore();
    }
  });

  test('protected exception logs retain internal context but direct route payloads are not logged raw', async function () {
    const sqlResponse = await request(app).get('/sql').set('X-Correlation-ID', 'logged-request-456');
    const directResponse = await request(app).get('/direct-500').set('X-Correlation-ID', 'direct-request-789');
    expect(logSpy).toHaveBeenCalled();
    const logText = JSON.stringify(logSpy.mock.calls);
    expect(logText).toContain(sqlResponse.body.requestId);
    expect(logText).toContain('SELECT secret FROM users');
    expect(logText).toContain('db.internal.example');
    expect(logText).toContain(directResponse.body.requestId);
    expect(logText).not.toContain('C:\\\\secrets\\\\app.js');
  });

  test.each([
    ['filesystem-and-sql', 'C:\\prod\\secrets\\db.sql SELECT * FROM users'],
    ['database-host', 'postgres.internal.example:5432'],
    ['extremely-long', 'x'.repeat(10000)],
    ['empty', '   '],
    ['valid-uuid', '123e4567-e89b-42d3-a456-426614174000'],
    ['conflicting', '123e4567-e89b-42d3-a456-426614174000, 123e4567-e89b-42d3-a456-426614174001'],
  ])('uses one server-controlled opaque ID for adversarial header %s', async function (_label, supplied) {
    logSpy.mockClear();
    const response = await request(app)
      .get('/sql')
      .set('X-Correlation-ID', supplied);
    const requestId = response.headers['x-correlation-id'];
    expect(response.status).toBe(500);
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(response.body.requestId).toBe(requestId);
    expect(requestId).not.toBe(supplied.trim().toLowerCase());
    const publicBody = JSON.stringify(response.body);
    expect(publicBody).not.toContain(supplied);
    expect(publicBody).not.toMatch(/SELECT|postgres|db\.internal|C:\\|stack|users|forged|X-Fake/i);
    expect(logSpy).toHaveBeenCalled();
    for (const call of logSpy.mock.calls) {
      expect(JSON.stringify(call)).toContain(requestId);
    }
  });

  test.each([
    ['log-forging', 'safe\nERROR forged=true\r\nX-Fake: value'],
    ['unicode-controls', 'trace-\u202E\u2066\u0007-hidden'],
  ])('default-denies %s values even when supplied directly by an upstream runtime', function (_label, supplied) {
    const req = { headers: { 'x-correlation-id': supplied } };
    const responseHeaders = {};
    const res = {
      setHeader: function (name, value) {
        responseHeaders[String(name).toLowerCase()] = value;
      },
    };
    let nextCalled = false;
    correlationId(req, res, function () { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(req.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(req.upstreamTraceId).toBeNull();
    expect(responseHeaders['x-correlation-id']).toBe(req.correlationId);
    expect(req.correlationId).not.toContain(supplied);
  });

  test.each([
    ['truncated JSON', '{"name":"fixture"'],
    ['invalid token', '{"name": nope}'],
    ['trailing comma', '{"name":"fixture",}'],
    ['invalid nesting', '{"name":[1,2}'],
  ])('%s receives one canonical UUID and no parser internals', async function (_label, payload) {
    logSpy.mockClear();
    const response = await request(app)
      .post('/required-json')
      .set('Content-Type', 'application/json')
      .send(payload);
    const requestId = response.headers['x-correlation-id'];
    expect(response.status).toBe(400);
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(response.body).toEqual({
      error: 'Invalid request.',
      code: 'bad_request',
      requestId,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/SyntaxError|Unexpected|position|body-parser|stack|fixture|nope/i);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mock.calls.forEach(function (call) {
      const serialized = JSON.stringify(call);
      expect(serialized).toContain(requestId);
      expect(serialized).not.toMatch(/SyntaxError|Unexpected|position|body-parser|fixture|nope/i);
    });
  });

  test('empty JSON body and wrong content type fail safely with canonical IDs', async function () {
    const probes = [
      await request(app).post('/required-json').set('Content-Type', 'application/json').send(''),
      await request(app).post('/required-json').set('Content-Type', 'text/plain').send('not-json'),
    ];
    probes.forEach(function (response) {
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request.');
      expect(response.body.code).toBe('bad_request');
      expect(response.body.requestId).toBe(response.headers['x-correlation-id']);
    });
  });

  test('oversized JSON preserves the parser limit and returns a safe correlated 413', async function () {
    logSpy.mockClear();
    const response = await request(app)
      .post('/required-json')
      .set('Content-Type', 'application/json')
      .send('{"value":"' + 'x'.repeat(1024 * 1024) + '"}');
    const requestId = response.headers['x-correlation-id'];
    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: 'The request body is too large.',
      code: 'payload_too_large',
      requestId,
    });
    expect(logSpy).toHaveBeenCalled();
    expect(JSON.stringify(logSpy.mock.calls)).toContain(requestId);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain('x'.repeat(100));
  });

  test('a reproducible unsupported encoding failure is rejected safely', async function () {
    logSpy.mockClear();
    const response = await request(app)
      .post('/required-json')
      .set('Content-Type', 'application/json; charset=koi8-r')
      .send('{"name":"fixture"}');
    expect(response.status).toBe(415);
    expect(response.body).toEqual({
      error: 'The request encoding is not supported.',
      code: 'unsupported_media_type',
      requestId: response.headers['x-correlation-id'],
    });
    expect(logSpy).toHaveBeenCalled();
    expect(JSON.stringify(logSpy.mock.calls)).toContain(response.body.requestId);
    expect(JSON.stringify(logSpy.mock.calls)).not.toMatch(/koi8|charset|body-parser|stack|fixture/i);
  });
});
