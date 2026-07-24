'use strict';

const express = require('express');
const request = require('supertest');
const { correlationId } = require('../../src/middleware/auditLog');
const {
  ApiError,
  errorHandler,
  normalizeErrorResponses
} = require('../../src/middleware/errorHandler');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(correlationId);
  app.use(normalizeErrorResponses);
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
  app.use(errorHandler);
  return app;
}

describe('safe public error normalization', function () {
  const app = buildApp();
  let logSpy;

  beforeEach(function () {
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
    expect(response.headers['x-correlation-id']).toBe('opaque-request-123');
    expect(response.body.error.requestId).toBe('opaque-request-123');
    expect(response.body.error.code).toBe(code);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/SELECT|postgres|db\.internal|C:\\|stack|23505|users_email|10\.0\.0\.8|script|cookie|ECONN|ENOENT/i);
  });

  test('validation exposes only normalized field identifiers and codes', async function () {
    const response = await request(app).get('/validation').set('X-Correlation-ID', 'validation-request');
    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: {
        code: 'validation_error',
        message: 'Invalid request data.',
        requestId: 'validation-request',
        details: {
          errors: [
            { field: 'customer.email', code: 'string.email' },
            { field: 'request', code: 'any.required' }
          ]
        }
      }
    });
    expect(JSON.stringify(response.body)).not.toMatch(/hunter2|private@example|raw validator|secret/i);
  });

  test('protected logs retain correlation and detailed internal context', async function () {
    await request(app).get('/sql').set('X-Correlation-ID', 'logged-request-456');
    await request(app).get('/direct-500').set('X-Correlation-ID', 'direct-request-789');
    expect(logSpy).toHaveBeenCalled();
    const logText = JSON.stringify(logSpy.mock.calls);
    expect(logText).toContain('logged-request-456');
    expect(logText).toContain('SELECT secret FROM users');
    expect(logText).toContain('db.internal.example');
    expect(logText).toContain('direct-request-789');
    expect(logText).toContain('C:\\\\secrets\\\\app.js');
  });
});
