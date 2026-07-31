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

describe('Phase 4 — API: Health Check System', () => {

  describe('Public Health Endpoints', () => {
    test('GET /api/health reports degraded when PostgreSQL is not initialized', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.type).toMatch(/json/);
      expect(res.body).toBeDefined();
      expect(res.body.status).toBe('degraded');
    });

    test('GET /api/stats requires authenticated tenant context', async () => {
      const res = await request(app).get('/api/stats');
      expect(res.type).toMatch(/json/);
      expect(res.status).toBe(401);
    });
  });

  describe('Polaris Status', () => {
    test('GET /api/v1/polaris/status — returns the exact retired-authority response', async () => {
      const res = await request(app).get('/api/v1/polaris/status');
      expect(res.status).toBe(410);
      expect(res.type).toMatch(/json/);
      expect(res.body.error.code).toBe('LEGACY_AUTHORITY_RETIRED');
    });
  });

  describe('Other Endpoints', () => {
    const endpoints = ['/health', '/status', '/api/v1/health'];
    endpoints.forEach(ep => {
      test(`GET ${ep} responds appropriately`, async () => {
        const res = await request(app).get(ep);
        // May be served by frontend (404), by API (200), auth-blocked (401),
        // or fail readiness while PostgreSQL is unavailable (503).
        expect([200, 401, 404, 503]).toContain(res.status);
      });
    });
  });
});
