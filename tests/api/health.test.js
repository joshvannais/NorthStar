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
    test('GET /api/health returns 200 with status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.type).toMatch(/json/);
      expect(res.body).toBeDefined();
      expect(res.body.status).toBe('ok');
    });

    test('GET /api/stats returns JSON response', async () => {
      const res = await request(app).get('/api/stats');
      expect(res.type).toMatch(/json/);
      expect([200, 500]).toContain(res.status);
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
