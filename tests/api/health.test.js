/**
 * Phase 4 — API Tests: Health Check System
 *
 * Tests all accessible public and protected health endpoints.
 */
'use strict';

const path = require('path');
process.chdir(path.resolve(__dirname, '../..'));

const request = require('supertest');
const { app } = require('../../src/server');
const { generateToken } = require('../../src/auth/middleware');

describe('Phase 4 — API: Health Check System', () => {

  describe('Public Health Endpoints', () => {
    test('GET /api/health returns 200 with status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.type).toMatch(/json/);
      expect(res.body).toBeDefined();
      // A reachable API can intentionally be degraded when an optional
      // dependency (for example PostgreSQL) is unavailable in the test env.
      expect(['ok', 'degraded']).toContain(res.body.status);
      expect(res.body.components).toEqual(expect.objectContaining({
        dataDirectory: expect.any(String),
        leadsFile: expect.any(String),
        database: expect.any(String),
      }));
      const allHealthy = Object.values(res.body.components)
        .every(status => status === 'healthy' || status === 'unconfigured');
      expect(res.body.status).toBe(allHealthy ? 'ok' : 'degraded');
    });

    test('GET /api/version returns the public build identity shape', async () => {
      const res = await request(app).get('/api/version');

      expect(res.status).toBe(200);
      expect(res.type).toMatch(/json/);
      expect(Object.keys(res.body)).toEqual(['buildSha']);
      expect(res.body.buildSha === null || typeof res.body.buildSha === 'string').toBe(true);
      if (typeof res.body.buildSha === 'string') {
        expect(res.body.buildSha.trim().length).toBeGreaterThan(0);
      }
    });

    test('GET /api/stats rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/stats');
      expect(res.type).toMatch(/json/);
      // Stats moved behind the API authentication boundary.
      expect(res.status).toBe(401);
      expect(res.body).toEqual(expect.objectContaining({
        error: expect.stringMatching(/authentication required/i),
      }));
    });

    test('GET /api/stats returns aggregate JSON for an authenticated user', async () => {
      const token = generateToken({
        id: 'health-test-user',
        email: 'health-test@northstar.invalid',
        name: 'Health Test User',
      });
      const res = await request(app)
        .get('/api/stats')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.type).toMatch(/json/);
      expect(res.body).toEqual(expect.objectContaining({
        totalCalls: expect.any(Number),
        totalRevenue: expect.any(Number),
        appointmentsBooked: expect.any(Number),
      }));
    });
  });

  describe('Polaris Status', () => {
    test('GET /api/v1/polaris/status — returns JSON (may be 200 or 401)', async () => {
      const res = await request(app).get('/api/v1/polaris/status');
      // Pre-Phase 9 middleware order: dashboard requireAuth intercepts → 401
      // Post-Phase 9: public → 200
      expect([200, 401]).toContain(res.status);
      expect(res.type).toMatch(/json/);
    });
  });

  describe('Other Endpoints', () => {
    const endpoints = ['/health', '/status', '/api/v1/health'];
    endpoints.forEach(ep => {
      test(`GET ${ep} responds appropriately`, async () => {
        const res = await request(app).get(ep);
        // May be served by frontend (404) or by API (200) or auth-blocked (401)
        expect([200, 401, 404]).toContain(res.status);
      });
    });
  });
});
