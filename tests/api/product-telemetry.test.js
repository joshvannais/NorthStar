'use strict';

const path = require('path');
process.chdir(path.resolve(__dirname, '../..'));

const request = require('supertest');
const { app } = require('../../src/server');

const valid = {
  event: 'page_view',
  surface: 'public',
  routeClass: 'home',
  action: 'none',
  elapsedBucket: 'under_15s',
};

describe('public product telemetry boundary', () => {
  test('accepts a bounded anonymous event without authentication', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const response = await request(app).post('/api/telemetry').send(valid);
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true });
    expect(response.headers['x-ratelimit-limit']).toBe('1000');
    expect(JSON.stringify(info.mock.calls)).not.toContain('127.0.0.1');
    info.mockRestore();
  });

  test('rejects unexpected fields and unrecognized dimensions', async () => {
    expect((await request(app).post('/api/telemetry').send({ ...valid, email: 'person@example.com' })).status).toBe(400);
    expect((await request(app).post('/api/telemetry').send({ ...valid, routeClass: '/?token=secret' })).status).toBe(400);
  });

  test('rejects oversized envelopes before recording', async () => {
    const response = await request(app).post('/api/telemetry').send({ ...valid, padding: 'x'.repeat(1100) });
    expect(response.status).toBe(413);
  });

  test('measures the actual raw envelope rather than trusting a client dimension', async () => {
    const nearLimit = JSON.stringify(valid);
    expect(Buffer.byteLength(nearLimit, 'utf8')).toBeLessThan(1024);
    expect((await request(app).post('/api/telemetry').set('Content-Type', 'application/json').send(nearLimit)).status).toBe(202);
  });
});
