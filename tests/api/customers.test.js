/**
 * Phase 4 — API Tests: Customer & Auth Routes
 */
'use strict';

const path = require('path');
process.chdir(path.resolve(__dirname, '../..'));

const request = require('supertest');
const { app } = require('../../src/server');

describe('Phase 4 — API: Customer Intelligence & Auth', () => {

  test('GET /api/v1/leads/ — rejects unauthenticated', async () => {
    const res = await request(app).get('/api/v1/leads/');
    expect([401, 403, 400]).toContain(res.status);
  });

  test('GET /api/v1/leads/:id — rejects unauthenticated', async () => {
    const res = await request(app).get('/api/v1/leads/test-id');
    expect([401, 403, 400]).toContain(res.status);
  });

  test('POST /api/auth/login — returns JSON', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'test' });
    expect(res.type).toMatch(/json/);
  });

  test('GET /api/auth/me — rejects unauthenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect([401, 403, 400]).toContain(res.status);
  });
});
