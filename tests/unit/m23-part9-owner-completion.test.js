'use strict';

const express = require('express');
const request = require('supertest');
const { id, input, raw, rawRecord, context } = require('../helpers/m23-part9-owner-completion-fixture');
const projection = () => require('../../src/completion/ownerReview');
const contract = () => require('../../public/js/completion-review-contract');
const project = (value = raw(), authority = context(), actor = input) => projection().projectOwnerReview(value, authority, actor);

function mounted(role = 'owner') {
  const read = jest.fn(async () => ({ status: 200, body: { success: true, data: project() } }));
  const pool = { connect: jest.fn() };
  const app = express(); app.use(express.json());
  app.use('/api/v1/field-executions', require('../../src/routes/fieldExecutions').createFieldExecutionsRouter({
    poolProvider: () => pool, ownerCompletionRead: read,
    tenantAuth(req, res, next) {
      if (!role) return res.status(401).json({ success: false });
      req.user = { id: input.actorUserId }; req.userRole = role; req.orgId = input.organizationId;
      req.tenantContext = { organizationId: input.organizationId, userId: input.actorUserId };
      req.authSession = { id: input.authSessionId }; req.requestId = 'owner-completion-unit'; next();
    },
    throttle: (_req, _res, next) => next(),
  }));
  return { app, read, pool };
}

describe('Part 9 owner completion destination and exact action contract', () => {
  test('mounted production HTML exists without exposing private data', async () => {
    process.env.NODE_ENV = 'test';
    for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'POLARIS_OPENAI_ENABLED',
      'RETELL_API_KEY', 'STRIPE_SECRET_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RESEND_API_KEY',
      'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) delete process.env[key];
    const app = require('../../src/server').app;
    const page = await request(app).get('/dashboard/completion-review');
    expect(page.status).toBe(200);
    expect(page.text).toContain('/js/completion-review-page.js');
    expect(page.text).toContain('id="completionStatus"');
    expect((await request(app).get(`/api/v1/field-executions/${id(4)}/completion-review`)).status).toBe(401);
  });

  test.each(['owner', 'admin'])('mounted owner read uses server identity for %s', async role => {
    const fixture = mounted(role);
    const response = await request(fixture.app).get(`/api/v1/field-executions/${id(4)}/completion-review`);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toMatch(/no-store/);
    expect(response.body.data.authority).toBe('postgresql');
    expect(fixture.read).toHaveBeenCalledWith(fixture.pool, expect.objectContaining({
      ...input, actorAccessRole: role, executionId: id(4),
    }));
  });

  test.each(['member', 'viewer'])('rejects %s before the owner loader', async role => {
    const fixture = mounted(role);
    const response = await request(fixture.app).get(`/api/v1/field-executions/${id(4)}/completion-review`);
    expect(response.status).toBe(403); expect(fixture.read).not.toHaveBeenCalled();
    expect(response.body).not.toHaveProperty('data');
  });

  test.each(['?role=owner', '?organizationId=' + id(1), '?state=all', '?executionId=' + id(4)])(
    'rejects extra read selectors %s before the loader', async query => {
      const fixture = mounted();
      expect((await request(fixture.app).get(`/api/v1/field-executions/${id(4)}/completion-review${query}`)).status).toBe(400);
      expect(fixture.read).not.toHaveBeenCalled();
    });

  test('server projection binds current assignment, private scope and record pins without claiming live gate approval', () => {
    const value = project();
    expect(contract().validate(value)).toBe(value);
    expect(value.execution.assignment).toEqual({ id: id(6), revision: 4, digest: 'b'.repeat(64), changed: false });
    expect(value.commands.map(item => item.action)).toEqual(['approve_completion', 'cancel_execution', 'correct_completion']);
    expect(value.proposal.gates).toHaveLength(11);
    expect(value.proposal.evidenceCounts).toEqual({ checklists: 0, inspections: 0, files: 0, labor: 1, materials: 2, progress: 1, fieldEvidence: 3, equipment: 0 });
    expect(value).not.toHaveProperty('organizationId');
    expect(project(raw(), context(), { ...input, authSessionId: id(99) }).scopeDigest).not.toBe(value.scopeDigest);
  });

  test.each(['approve_completion', 'cancel_execution', 'reopen_execution', 'resume_reopened', 'correct_completion'])(
    '%s prepares only the existing exact server normalizer contract', action => {
      const value = project(raw(action === 'reopen_execution' ? 'completed' : action === 'resume_reopened' ? 'reopened' : 'completion_pending'));
      const body = contract().actionBody(value, action, action === 'correct_completion' ? id(10) : null,
        { reason: 'An explicit reviewed decision', nextAction: 'Return to inspect the seal', note: 'Clarified the recorded observation' });
      const parsed = require('../../src/completion/contract').normalizeCompletionAction({
        ...input, executionId: id(4), idempotencyKey: 'owner-completion-unit-0001', body,
      });
      expect(parsed.action).toBe(action);
      expect(body.expectedExecutionRevision).toBe(3);
      expect(body.expectedAssignmentRevision).toBe(4);
    });

  test('expiry, read-only authority and role changes cannot manufacture commands', () => {
    const expired = raw(); expired.data.activeProposal.expired = true;
    expect(project(expired).commands.map(item => item.action)).not.toContain('approve_completion');
    for (const changed of [context({ onboarding_status: 'pending' }), context({ subscription_status: 'past_due' })]) {
      const value = project(raw(), changed); expect(value.commands).toEqual([]); expect(value.readOnlyReason).not.toBeNull();
      expect(() => contract().actionBody(value, 'cancel_execution', null, { reason: 'Forbidden' })).toThrow();
    }
    for (const role of ['member', 'viewer', 'administrator']) expect(() => project(raw(), context(), { ...input, actorAccessRole: role })).toThrow();
  });

  test('history correction selects only current leaves and truncation is not silently complete', () => {
    const body = raw(); body.data.records.unshift(rawRecord('correction', {
      id: id(11), previousRecordId: id(10), revision: 2, subjectKind: 'proposal',
      document: { kind: 'correction', annotation: { note: 'Clarification', nextAction: null } },
    })); body.data.totalRecordCount = 2;
    expect(project(body).commands.filter(item => item.action === 'correct_completion').map(item => item.target.id)).toEqual([id(11)]);
    body.data.truncated = true; body.data.totalRecordCount = 201;
    expect(project(body).history.truncated).toBe(true);
    expect(project(body).commands.some(item => item.action === 'correct_completion')).toBe(false);
  });

  test('stale lifecycle pins and changed assignment are never substituted silently', () => {
    const completed = raw('completed'); completed.data.records[0].resultingExecutionRevision = 2;
    expect(project(completed).commands.some(item => item.action === 'reopen_execution')).toBe(false);
    const changed = project(raw(), context({ revision: '5', digest: 'c'.repeat(64) }));
    expect(changed.execution.assignment.changed).toBe(true);
    const body = contract().actionBody(changed, 'cancel_execution', null, { reason: 'Review changed work' });
    expect(body.expectedAssignmentRevision).toBe(5);
    expect(body.expectedExecutionRevision).toBe(3);
  });

  test('selectors, malformed projections, unknown commands and hostile input fail closed', () => {
    expect(contract().parseSelector('?executionId=' + id(4))).toBe(id(4));
    for (const query of ['', '?executionId=bad', '?executionId=' + id(4) + '&role=owner', '?executionId=' + id(4) + '&executionId=' + id(4)]) {
      expect(() => contract().parseSelector(query)).toThrow();
    }
    const value = project(raw(), context({ title: '<strong>Literal service</strong>' }));
    expect(contract().validate(value).title).toBe('<strong>Literal service</strong>');
    for (const candidate of [{ ...value, role: 'owner' }, { ...value, authority: 'browser' },
      { ...value, commands: [{ action: 'delete_history', target: null }] }]) expect(() => contract().validate(candidate)).toThrow();
    for (const reason of ['', '<strong>Not plain input</strong>', 'x\u0000y', 'x'.repeat(1001)]) {
      expect(() => contract().actionBody(value, 'cancel_execution', null, { reason })).toThrow();
    }
  });
});
