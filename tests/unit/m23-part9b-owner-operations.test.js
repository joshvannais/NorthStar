'use strict';

const express = require('express');
const request = require('supertest');
const { overview, record, INSTANT } = require('../helpers/m23-part9b-overview-fixture');
const ORG = 'a1900000-0000-4000-8000-000000000001';
const USER = 'b1900000-0000-4000-8000-000000000001';
const SESSION = 'c1900000-0000-4000-8000-000000000001';

function contract() { return require('../../src/operations/overviewContract'); }
function clientContract() { return require('../../public/js/operations-overview-contract'); }
function cursor(overrides = {}) {
  return Buffer.from(JSON.stringify({ version: 'm23-part9b-cursor-v1', state: 'active',
    scopeDigest: 'b'.repeat(64), dataDigest: 'a'.repeat(64), cutoff: INSTANT,
    lastCreatedAt: INSTANT, lastId: record().executionId, ...overrides })).toString('base64url');
}

function mounted(role = 'owner', data = overview()) {
  const read = jest.fn(async () => data);
  const pool = { connect: jest.fn() };
  const app = express();
  app.use('/api/v1/operational-overview', require('../../src/routes/operationalOverview').createOperationalOverviewRouter({
    poolProvider: () => pool,
    readOverview: read,
    tenantAuth: (req, res, next) => {
      if (role === null) return res.status(401).json({ success: false, code: 'UNAUTHENTICATED' });
      req.user = { id: USER }; req.userRole = role; req.orgId = ORG;
      req.tenantContext = { organizationId: ORG, userId: USER };
      req.authSession = { id: SESSION }; req.requestId = 'part9b-unit';
      next();
    },
    throttle: (_req, _res, next) => next(),
  }));
  app.use(require('../../src/middleware/errorHandler').errorHandler);
  return { app, read, pool };
}

describe('Mission 23 Part 9B read-only operational overview', () => {
  test('production app serves the inert overview skeleton and protects its data route', async () => {
    process.env.NODE_ENV = 'test';
    for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'POLARIS_OPENAI_ENABLED',
      'RETELL_API_KEY', 'STRIPE_SECRET_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RESEND_API_KEY',
      'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) delete process.env[key];
    const { app } = require('../../src/server');
    const page = await request(app).get('/dashboard/operations');
    expect(page.status).toBe(200);
    expect(page.text).toContain('id="operationsStatus"');
    expect(page.text).toContain('/js/operations-page.js');
    expect((await request(app).get('/api/v1/operational-overview')).status).toBe(401);
  });

  test('owns a strict bounded query with no caller authority selectors', () => {
    expect(contract().normalizeOverviewRead({})).toEqual({ state: 'active', limit: 25, cursor: null });
    expect(contract().normalizeOverviewRead({ state: 'all', limit: '100' })).toEqual({ state: 'all', limit: 100, cursor: null });
    for (const value of [{ organizationId: ORG }, { role: 'owner' }, { state: 'unknown' },
      { state: ['active', 'all'] }, { limit: '0' }, { limit: '101' }, { limit: '01' },
      { limit: ['25', '50'] }, { cursor: 'bad' }, { state: 'active', extra: 'value' }]) {
      expect(() => contract().normalizeOverviewRead(value)).toThrow();
    }
  });

  test('cursors preserve microsecond ordering and bind the exact filter/dataset/scope', () => {
    const token = cursor();
    expect(contract().normalizeOverviewRead({ cursor: token }).cursor).toMatchObject({
      lastCreatedAt: INSTANT, cutoff: INSTANT, dataDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64),
    });
    for (const tokenValue of [cursor({ state: 'all' }), cursor({ version: 'old' }),
      cursor({ dataDigest: '' }), cursor({ extra: true }), cursor({ lastId: 'not-an-id' }),
      cursor({ cutoff: '2026-09-08T24:00:00Z' }), `${token}=`, 'a'.repeat(2049)]) {
      expect(() => contract().normalizeOverviewRead({ cursor: tokenValue })).toThrow();
    }
  });

  test('validates role-specific output and cannot manufacture readiness or capacity', () => {
    expect(clientContract().validate(overview()).scope).toBe('owner_admin');
    expect(clientContract().validate(overview('dispatcher_coordination')).records[0]).not.toHaveProperty('ownerDetails');
    for (const value of [
      overview('dispatcher_coordination', { records: [record('owner_admin')] }),
      overview('owner_admin', { records: [record('dispatcher_coordination')] }),
      overview('owner_admin', { capacity: { status: 'available' } }),
      overview('owner_admin', { records: [record('owner_admin', { evidence: { state: 'complete', recorded: 2 } })] }),
      overview('owner_admin', { records: [record(), record()], pagination: { limit: 25, offset: 0, returned: 2, total: 2, nextCursor: null } }),
      overview('owner_admin', { pagination: { limit: 25, offset: 0, returned: 1, total: 2, nextCursor: null } }),
      overview('owner_admin', { secret: 'forbidden extra field' }),
    ]) expect(() => clientContract().validate(value)).toThrow('OPERATIONS_OVERVIEW_INVALID');
  });

  test('retains literal presentation text and keeps unrelated domain details outside the contract', () => {
    const value = overview('owner_admin', { records: [record('owner_admin', { title: '<strong>Service label</strong>' })] });
    expect(clientContract().validate(value).records[0].title).toBe('<strong>Service label</strong>');
    value.records[0].customer = { address: 'Not in the overview contract' };
    expect(() => clientContract().validate(value)).toThrow('OPERATIONS_OVERVIEW_INVALID');
  });

  test('response cannot contradict its work-state filter or the requested snapshot page', () => {
    const pending = overview('owner_admin', { filter: 'completion_pending' });
    expect(() => clientContract().validate(pending)).toThrow('OPERATIONS_OVERVIEW_INVALID');
    const expected = { state: 'active', limit: 25, cursor: null };
    expect(() => contract().validateOverviewResponse(overview('owner_admin', { filter: 'all' }), 'owner', expected)).toThrow();
    expect(() => contract().validateOverviewResponse(overview('owner_admin', {
      pagination: { limit: 50, offset: 0, returned: 1, total: 1, nextCursor: null },
    }), 'owner', expected)).toThrow();
    const next = { ...expected, cursor: contract().normalizeOverviewRead({ cursor: cursor() }).cursor };
    expect(() => contract().validateOverviewResponse(overview('owner_admin', { dataDigest: 'c'.repeat(64) }), 'owner', next)).toThrow();
  });

  test('mounts the authenticated owner read with server-derived identity and no-store response', async () => {
    const { app, read, pool } = mounted();
    const response = await request(app).get('/api/v1/operational-overview?limit=25');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body).toMatchObject({ success: true, data: overview() });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(pool, { organizationId: ORG, actorUserId: USER,
      actorAccessRole: 'owner', authSessionId: SESSION, state: 'active', limit: 25, cursor: null });
  });

  test('authentication and unsupported methods never call the repository', async () => {
    const unauthenticated = mounted(null);
    expect((await request(unauthenticated.app).get('/api/v1/operational-overview')).status).toBe(401);
    expect(unauthenticated.read).not.toHaveBeenCalled();
    const owner = mounted();
    expect((await request(owner.app).post('/api/v1/operational-overview').send({})).status).toBe(404);
    expect(owner.read).not.toHaveBeenCalled();
    expect((await request(owner.app).get(`/api/v1/operational-overview?organizationId=${ORG}`)).status).toBe(400);
    expect(owner.read).not.toHaveBeenCalled();
  });

  test('a dispatcher contract is preserved and an invalid or mismatched result fails closed', async () => {
    const dispatcher = mounted('member', overview('dispatcher_coordination'));
    expect((await request(dispatcher.app).get('/api/v1/operational-overview')).body.data.scope).toBe('dispatcher_coordination');
    const invalid = mounted('member', overview('owner_admin'));
    const rejected = await request(invalid.app).get('/api/v1/operational-overview');
    expect(rejected.status).toBe(503);
    expect(rejected.body).not.toHaveProperty('data');
    const viewer = mounted('viewer');
    expect((await request(viewer.app).get('/api/v1/operational-overview')).status).toBe(403);
    expect(viewer.read).not.toHaveBeenCalled();
  });

  test('repository owns and closes a repeatable-read read-only transaction through only the entry', async () => {
    const body = overview();
    const client = { query: jest.fn(async sql => sql.includes('canonical_operational_overview_read') ?
      { rows: [{ result: body }] } : { rows: [] }), release: jest.fn() };
    const pool = { connect: jest.fn(async () => client) };
    const repository = require('../../src/operations/overviewRepository');
    await expect(repository.readOperationalOverview(pool, { organizationId: ORG, actorUserId: USER,
      actorAccessRole: 'owner', authSessionId: SESSION, ...contract().normalizeOverviewRead({}) })).resolves.toEqual(body);
    expect(client.query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
    expect(client.query.mock.calls.filter(([sql]) => sql.includes('canonical_operational_overview_read'))).toHaveLength(1);
    expect(client.query.mock.calls.some(([sql]) => /SELECT.*FROM public\.canonical_field_executions/is.test(sql))).toBe(false);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('repository rolls back and sanitizes unavailable-entry and stale-snapshot failures', async () => {
    const repository = require('../../src/operations/overviewRepository');
    for (const error of [{ code: '42883', message: 'private database detail' },
      { code: '40001', constraint: 'canonical_operational_overview_stale', message: 'private snapshot detail' }]) {
      const client = { query: jest.fn(async sql => {
        if (sql.includes('canonical_operational_overview_read')) throw error;
        return { rows: [] };
      }), release: jest.fn() };
      const promise = repository.readOperationalOverview({ connect: async () => client }, {
        organizationId: ORG, actorUserId: USER, actorAccessRole: 'owner', authSessionId: SESSION,
        ...contract().normalizeOverviewRead({}),
      });
      await expect(promise).rejects.toMatchObject({ status: error.code === '40001' ? 409 : 503 });
      expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
      expect(client.release).toHaveBeenCalledTimes(1);
    }
  });
});
