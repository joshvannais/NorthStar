'use strict';

const jwt = require('jsonwebtoken');

jest.mock('../../src/db', () => ({
  isAvailable: jest.fn(),
  query: jest.fn(),
}));

const db = require('../../src/db');
const auth = require('../../src/auth/middleware');
const permissions = require('../../src/auth/permissions');
const audit = require('../../src/audit/client');
const { correlationId } = require('../../src/middleware/auditLog');

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function contractorToken(subject, extra = {}) {
  return jwt.sign(
    Object.assign({ sub: subject, role: 'contractor' }, extra),
    auth.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function authenticate(rows, options = {}) {
  db.isAvailable.mockReset();
  db.query.mockReset();
  db.isAvailable.mockReturnValue(options.available !== false);
  if (options.error) db.query.mockRejectedValueOnce(options.error);
  else db.query.mockResolvedValueOnce({ rows });
  const req = {
    headers: { authorization: `Bearer ${contractorToken(options.subject || 'user-a', options.claims)}` },
    body: options.body || {},
    query: options.query || {},
    params: options.params || {},
    requestId: options.requestId || 'request-commit1',
  };
  const res = responseRecorder();
  const next = jest.fn();
  await auth.requireAuth(req, res, next);
  return { req, res, next };
}

describe('Mission 19 Part 3 durable tenant context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.isAvailable.mockReset();
    db.query.mockReset();
  });

  test('active persisted membership becomes the immutable trusted tenant context', async () => {
    const result = await authenticate([{
      id: 'user-a',
      organization_id: 'org-a',
      role: 'owner',
      status: 'active',
      email: 'owner@example.test',
      name: 'Owner A',
    }], {
      claims: { orgId: 'org-evil', organizationId: 'org-evil', persistedRole: 'viewer' },
      body: { organizationId: 'org-b', role: 'viewer', ownerId: 'other' },
      query: { organizationId: 'org-b' },
    });

    expect(result.next).toHaveBeenCalledTimes(1);
    expect(result.req.tenantContext).toEqual({ userId: 'user-a', organizationId: 'org-a', role: 'owner' });
    expect(result.req.user).toMatchObject({ id: 'user-a', sub: 'user-a', role: 'owner', organizationId: 'org-a' });
    expect(result.req.orgId).toBe('org-a');
    expect(result.req.userRole).toBe('owner');
    expect(Object.isFrozen(result.req.tenantContext)).toBe(true);
    expect(Object.isFrozen(result.req.user)).toBe(true);
  });

  test.each([
    ['missing', []],
    ['ambiguous', [
      { id: 'user-a', organization_id: 'org-a', role: 'owner', status: 'active' },
      { id: 'user-a', organization_id: 'org-b', role: 'owner', status: 'active' },
    ]],
    ['inactive', [{ id: 'user-a', organization_id: 'org-a', role: 'owner', status: 'disabled' }]],
    ['null organization', [{ id: 'user-a', organization_id: null, role: 'owner', status: 'active' }]],
    ['null role', [{ id: 'user-a', organization_id: 'org-a', role: null, status: 'active' }]],
  ])('denies %s membership', async (_name, rows) => {
    const result = await authenticate(rows);
    expect(result.next).not.toHaveBeenCalled();
    expect(result.res.statusCode).toBe(403);
    expect(result.res.body).toMatchObject({
      code: 'organization_membership_required',
      requestId: 'request-commit1',
    });
  });

  test('database-unavailable and lookup-outage authorization fail closed with 503', async () => {
    const unavailable = await authenticate([], { available: false });
    expect(unavailable.res.statusCode).toBe(503);
    expect(unavailable.res.body.code).toBe('authorization_unavailable');

    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const outage = await authenticate([], { error: new Error('secret database detail') });
    expect(outage.res.statusCode).toBe(503);
    expect(outage.res.body).not.toEqual(expect.objectContaining({ detail: expect.anything() }));
    expect(warning).toHaveBeenCalledWith('[Auth] Membership lookup warning:', {
      requestId: 'request-commit1',
      event: 'authorization_persistence_unavailable',
    });
    warning.mockRestore();
  });

  test('organization permission checks use only the persisted context', async () => {
    const result = await authenticate([{
      id: 'user-a', organization_id: 'org-a', role: 'viewer', status: 'active',
    }], { body: { organizationId: 'org-b', role: 'owner' } });
    const denied = responseRecorder();
    const allowed = jest.fn();
    permissions.requirePermission('leads', 'delete')(result.req, denied, allowed);
    expect(allowed).not.toHaveBeenCalled();
    expect(denied.statusCode).toBe(403);
    expect(result.req.orgId).toBe('org-a');
    expect(result.req.userRole).toBe('viewer');
  });
});

describe('Mission 19 Part 3 migrated audit contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.isAvailable.mockReset();
    db.query.mockReset();
    db.isAvailable.mockReturnValue(true);
  });

  test.each([
    ['authenticated', 'org-a', 'user-a', 'owner'],
    ['anonymous', null, null, 'anonymous'],
    ['system', null, null, 'system'],
  ])('persists %s audit details through migrated columns', async (actorLabel, organizationId, userId, actorRole) => {
    db.query.mockResolvedValueOnce({ rows: [] });
    await audit.record({
      organizationId,
      userId,
      actorLabel,
      actorRole,
      action: `m19.commit1.${actorLabel}`,
      entityType: 'test',
      entityId: '',
      correlationId: `request-${actorLabel}`,
      userAgent: 'M19 Test',
      beforeState: { state: 'before' },
      afterState: { state: 'after' },
      ipAddress: '127.0.0.1',
    });

    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain('(organization_id, user_id, action, entity_type, entity_id, details, ip_address, created_at)');
    expect(sql).not.toMatch(/actor_id|actor_role|before_state|after_state|user_agent|correlation_id/);
    expect(values[0]).toBe(organizationId);
    expect(values[1]).toBe(userId);
    expect(JSON.parse(values[5])).toMatchObject({
      actorLabel,
      role: actorRole,
      requestId: `request-${actorLabel}`,
      userAgent: 'M19 Test',
      beforeState: { state: 'before' },
      afterState: { state: 'after' },
    });
  });

  test('audit database outage never fails the business request and emits only a safe correlated warning', async () => {
    db.query.mockRejectedValueOnce(new Error('private database outage detail'));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(audit.record({ action: 'm19.commit1.outage', correlationId: 'request-outage' })).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledWith('[Audit] Persistence warning:', {
      requestId: 'request-outage',
      event: 'audit_persistence_failed',
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private database outage detail');
    warning.mockRestore();
  });

  test('the server-generated canonical request ID is immutable and reflected in the response', () => {
    const req = { headers: { 'x-correlation-id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } };
    const res = responseRecorder();
    const next = jest.fn();
    correlationId(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.requestId).not.toBe(req.headers['x-correlation-id']);
    expect(req.correlationId).toBe(req.requestId);
    expect(res.headers['x-correlation-id']).toBe(req.requestId);
    expect(() => { req.requestId = 'changed'; }).toThrow();
  });
});
