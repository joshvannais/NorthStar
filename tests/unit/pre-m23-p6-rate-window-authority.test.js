'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const cache = require('../../src/cache/client');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { rateLimit } = require('../../src/middleware/rateLimit');

const WINDOW_MS = 60000;
const LIMIT = 100;

function mounted(key, backing) {
  const app = express();
  app.get('/bounded', rateLimit('public-api', function () { return key; }), function (_req, res) {
    backing.count += 1;
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

async function exhaust(app) {
  for (let index = 0; index < LIMIT; index += 1) {
    const response = await request(app).get('/bounded');
    expect(response.status).toBe(200);
  }
}

describe('Pre-M23 P6 rate-window authority', () => {
  let clock;

  afterEach(() => {
    if (clock) clock.mockRestore();
    clock = null;
    cache.setEnabled(true);
    cache.clearForTests();
    jest.restoreAllMocks();
  });

  test('cache-backed rejection reports the original counter expiry and recovers exactly there', async () => {
    cache.setEnabled(true);
    cache.clearForTests();
    const start = 1788192000000;
    clock = jest.spyOn(Date, 'now').mockReturnValue(start);
    const backing = { count: 0 };
    const app = mounted('cache-expiry-' + crypto.randomUUID(), backing);

    await exhaust(app);
    clock.mockReturnValue(start + 59000);
    const rejected = await request(app).get('/bounded');
    expect(rejected.status).toBe(429);
    expect(rejected.headers).toMatchObject({
      'x-ratelimit-reset': String((start + WINDOW_MS) / 1000),
      'retry-after': '1',
    });
    expect(rejected.body.error.details.retryAfterSeconds).toBe(1);
    expect(backing.count).toBe(LIMIT);

    clock.mockReturnValue(start + WINDOW_MS);
    const recovered = await request(app).get('/bounded');
    expect(recovered.status).toBe(200);
    expect(recovered.headers).toMatchObject({
      'x-ratelimit-reset': String((start + (2 * WINDOW_MS)) / 1000),
      'x-ratelimit-remaining': String(LIMIT - 1),
    });
    expect(backing.count).toBe(LIMIT + 1);
  });

  test('fallback rejection always has a positive bounded wait and equality starts a new window', async () => {
    cache.setEnabled(false);
    const start = 1788195600000;
    clock = jest.spyOn(Date, 'now').mockReturnValue(start);
    const backing = { count: 0 };
    const app = mounted('fallback-expiry-' + crypto.randomUUID(), backing);

    await exhaust(app);
    for (const offset of [0, 1, 999, 1000, 58999, 59000, 59999]) {
      clock.mockReturnValue(start + offset);
      const rejected = await request(app).get('/bounded');
      const expectedWait = Math.ceil((WINDOW_MS - offset) / 1000);
      expect(rejected.status).toBe(429);
      expect(Number(rejected.headers['retry-after'])).toBe(expectedWait);
      expect(Number(rejected.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(Number(rejected.headers['retry-after'])).toBeLessThanOrEqual(WINDOW_MS / 1000);
      expect(rejected.headers['x-ratelimit-reset']).toBe(String((start + WINDOW_MS) / 1000));
      expect(rejected.body.error.details.retryAfterSeconds).toBe(expectedWait);
    }
    expect(backing.count).toBe(LIMIT);

    clock.mockReturnValue(start + WINDOW_MS);
    const recovered = await request(app).get('/bounded');
    expect(recovered.status).toBe(200);
    expect(recovered.headers['x-ratelimit-remaining']).toBe(String(LIMIT - 1));
    expect(backing.count).toBe(LIMIT + 1);
  });

  test.each([
    ['cache', true],
    ['fallback', false],
  ])('%s path preserves one boundary under concurrent rejection and recovery', async (_label, enabled) => {
    cache.setEnabled(enabled);
    cache.clearForTests();
    const start = 1788199200000;
    clock = jest.spyOn(Date, 'now').mockReturnValue(start);
    const backing = { count: 0 };
    const app = mounted('concurrent-' + enabled + '-' + crypto.randomUUID(), backing);

    const initial = await Promise.all(Array.from({ length: LIMIT + 1 }, function () {
      return request(app).get('/bounded');
    }));
    expect(initial.filter(response => response.status === 200)).toHaveLength(LIMIT);
    expect(initial.filter(response => response.status === 429)).toHaveLength(1);
    expect(backing.count).toBe(LIMIT);

    clock.mockReturnValue(start + WINDOW_MS - 1);
    const nearBoundary = await Promise.all(Array.from({ length: 12 }, function () {
      return request(app).get('/bounded');
    }));
    expect(nearBoundary.every(response => response.status === 429)).toBe(true);
    expect(nearBoundary.every(response => response.headers['retry-after'] === '1')).toBe(true);
    expect(nearBoundary.every(response => response.headers['x-ratelimit-reset'] === String((start + WINDOW_MS) / 1000))).toBe(true);
    expect(backing.count).toBe(LIMIT);

    clock.mockReturnValue(start + WINDOW_MS);
    const recovered = await request(app).get('/bounded');
    expect(recovered.status).toBe(200);
    expect(backing.count).toBe(LIMIT + 1);
  });

  test.each([
    ['cache', true],
    ['fallback', false],
  ])('%s path fails closed on regressive and unsafe clocks without backing execution', async (_label, enabled) => {
    jest.spyOn(console, 'error').mockImplementation(function () {});
    cache.setEnabled(enabled);
    cache.clearForTests();
    const start = 1788202800000;
    clock = jest.spyOn(Date, 'now').mockReturnValue(start);
    const backing = { count: 0 };
    const app = mounted('clock-' + enabled + '-' + crypto.randomUUID(), backing);
    expect((await request(app).get('/bounded')).status).toBe(200);

    for (const unsafe of [start - 1, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER - 1]) {
      clock.mockReturnValue(unsafe);
      const response = await request(app).get('/bounded');
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('internal_error');
      expect(response.headers['retry-after']).toBeUndefined();
      expect(response.headers['x-ratelimit-reset']).toBeUndefined();
      expect(backing.count).toBe(1);
    }

    clock.mockReturnValue(start);
    const legitimate = await request(app).get('/bounded');
    expect(legitimate.status).toBe(200);
    expect(backing.count).toBe(2);
  });
});
