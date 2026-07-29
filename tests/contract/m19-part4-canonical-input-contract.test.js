'use strict';

const express = require('express');
const request = require('supertest');
const crypto = require('crypto');
const cache = require('../../src/cache/client');
const { createCanonicalRouter, createCompatibilityRouter } = require('../../src/routes/canonicalPolaris');

// ── Test double infrastructure ──────────────────────────────────────────

const ORG_A  = '00000000-0000-0000-0000-000000000001';
const USER_A = '00000000-0000-0000-0000-000000000002';

function fakeAuth(req, _res, next) {
  const organizationId = req.get('X-Test-Organization');
  const userId = req.get('X-Test-User');
  if (organizationId && userId) {
    req.tenantContext = Object.freeze({ organizationId, userId, role: 'owner' });
    req.orgId = organizationId;
    req.userRole = 'owner';
    req.user = Object.freeze({ id: userId, organizationId, role: 'owner' });
  }
  next();
}

function headers(org, user, session) {
  return {
    'X-Test-Organization': org,
    'X-Test-User': user,
    'X-Session-ID': session || 'test-session',
  };
}

/**
 * Creates an Express app wired to the canonical router with a mock pool.
 * The mock pool tracks every query call so tests can assert zero data queries.
 */
function createApp(poolProvider, cacheClient) {
  const dependencies = {
    poolProvider,
    auth: fakeAuth,
    cache: cacheClient || cache,
    audit: { record: async function () {} },
  };
  const app = express();
  app.use(function (req, res, next) {
    const generated = crypto.randomUUID();
    req.requestId = generated;
    res.setHeader('x-correlation-id', generated);
    next();
  });
  app.use(express.json());
  app.use('/api/v1/canonical', createCanonicalRouter(dependencies));
  app.use('/api/v1', createCompatibilityRouter(dependencies));
  return app;
}

/** Returns a pool mock whose .query() records every call and returns empty rows. */
function trackingPool() {
  const calls = [];
  const pool = {
    query: async function () { calls.push(Array.from(arguments)); return { rows: [] }; },
    _calls: calls,
  };
  return pool;
}

// ── Endpoint families ───────────────────────────────────────────────────

const ENDPOINTS = [
  { label: 'graphs',          path: '/api/v1/canonical/graphs' },
  { label: 'dashboard',       path: '/api/v1/canonical/dashboard' },
  { label: 'analytics',       path: '/api/v1/canonical/analytics' },
  { label: 'surfaces:surface', path: '/api/v1/canonical/surfaces/customer-detail' },
  { label: 'compat:surface',  path: '/api/v1/canonical/compat/customer-detail' },
];

// ── Tests ───────────────────────────────────────────────────────────────

describe('M19 Part 4 — canonical customerId input contract', () => {
  const VALID = '00000000-0000-0000-0000-000000000099';
  const VALID_UPPER = '00000000-0000-0000-0000-000000000099'.toUpperCase();

  for (const ep of ENDPOINTS) {
    describe(ep.label, () => {

      test('absent customerId — 200 organization collection', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path).set(headers(ORG_A, USER_A));
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      test('valid lowercase UUID — 200', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=' + VALID).set(headers(ORG_A, USER_A));
        expect(res.status).toBe(200);
      });

      test('valid uppercase UUID — 200 (if canonical contract supports)', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=' + VALID_UPPER).set(headers(ORG_A, USER_A));
        expect(res.status).toBe(200);
      });

      test('empty string — 400 INVALID_CUSTOMER_ID', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=').set(headers(ORG_A, USER_A));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_CUSTOMER_ID');
      });

      test('whitespace-only — 400', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=%20%20').set(headers(ORG_A, USER_A));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_CUSTOMER_ID');
      });

      test('valid UUID with one leading space — 400 (no trim-to-valid)', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=%20' + VALID).set(headers(ORG_A, USER_A));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_CUSTOMER_ID');
      });

      test('valid UUID with one trailing space — 400 (no trim-to-valid)', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=' + VALID + '%20').set(headers(ORG_A, USER_A));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_CUSTOMER_ID');
      });

      test('valid UUID surrounded by spaces — 400', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=%20' + VALID + '%20').set(headers(ORG_A, USER_A));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_CUSTOMER_ID');
      });

      test('partial UUID — 400', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=00000000-0000').set(headers(ORG_A, USER_A));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_CUSTOMER_ID');
      });

      test('overlong UUID — 400', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=' + VALID + '-extra').set(headers(ORG_A, USER_A));
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('INVALID_CUSTOMER_ID');
      });

      // ── Zero data-query assertion ──────────────────────────────────

      test('invalid value — zero canonical data queries', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        await request(app).get(ep.path + '?customerId=%20' + VALID).set(headers(ORG_A, USER_A));
        // After the request, pool.query may have been called for
        // authorization / membership checks. Those are NOT canonical
        // data queries. The canonical data query is the first SELECT
        // that hits the canonical graph/dashboard/analytics read model.
        // For the mock pool that always returns {rows:[]}, the test
        // verifies at minimum that the validator rejected BEFORE the
        // canonical read path.
        const queryTexts = pool._calls.map(function (c) { return c[0]; }).join(' ');
        expect(queryTexts).not.toMatch(/canonical_graphs|canonical_operations|canonical_customers|SELECT.*FROM/i);
      });

      // ── requestId contract ────────────────────────────────────────

      test('400 body requestId matches header', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=%20x').set(headers(ORG_A, USER_A));
        expect(res.status).toBe(400);
        const headerId = res.headers['x-correlation-id'];
        expect(headerId).toBeDefined();
        expect(res.body.requestId).toBe(headerId);
      });

      // ── Leakage ────────────────────────────────────────────────────

      test('400 does not expose supplied value', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=%20' + VALID).set(headers(ORG_A, USER_A));
        expect(res.status).toBe(400);
        const body = JSON.stringify(res.body);
        expect(body).not.toContain(VALID);
      });

      test('400 does not expose SQL, paths, host, or stack', async () => {
        const pool = trackingPool();
        const app  = createApp(function () { return pool; });
        const res  = await request(app).get(ep.path + '?customerId=%20x').set(headers(ORG_A, USER_A));
        expect(res.status).toBe(400);
        const body = JSON.stringify(res.body);
        expect(body).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i);
        expect(body).not.toMatch(/\/home\/|stack|localhost|127\.0\.0\.1|postgres/);
      });

    });
  }

  // ── Persistence vs validation boundary ───────────────────────────────

  test('genuine PG outage — 503 CANONICAL_PERSISTENCE_UNAVAILABLE (not 400)', async () => {
    const pool = { query: async function () { throw new Error('connection refused'); } };
    const app  = createApp(function () { return pool; });
    const res  = await request(app).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('CANONICAL_PERSISTENCE_UNAVAILABLE');
    expect(res.headers['x-correlation-id']).toBeDefined();
    expect(res.body.requestId).toBe(res.headers['x-correlation-id']);
  });

  test('503 does not leak internal exception text', async () => {
    const pool = { query: async function () { throw new Error('connection refused at tcp://10.0.0.1:5432'); } };
    const app  = createApp(function () { return pool; });
    const res  = await request(app).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A));
    expect(res.status).toBe(503);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/connection refused|tcp:|5432|10\.0\.0/);
  });

  // ── Caller-supplied correlation IDs ─────────────────────────────────

  test('caller-supplied X-Correlation-ID does not become server requestId', async () => {
    const pool = trackingPool();
    const app  = createApp(function () { return pool; });
    const res  = await request(app)
      .get('/api/v1/canonical/graphs?customerId=%20x')
      .set(Object.assign({}, headers(ORG_A, USER_A), { 'x-correlation-id': 'caller-injected' }));
    expect(res.status).toBe(400);
    expect(res.body.requestId).not.toBe('caller-injected');
  });
});
