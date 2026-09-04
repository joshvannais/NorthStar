'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const {
  FieldExecutionContractError,
  normalizeInitialization,
  normalizeTransition,
} = require('../../src/operations/contract');
const {
  executionBodyBoundary,
  isExecutionMutationRequest,
} = require('../../src/operations/httpBoundary');
const { createFieldExecutionsRouter } = require('../../src/routes/fieldExecutions');

const IDS = Object.freeze({
  organization: 'b1000000-0000-4000-8000-000000000001',
  actor: 'b2000000-0000-4000-8000-000000000001',
  session: 'b3000000-0000-4000-8000-000000000001',
  appointment: 'b4000000-0000-4000-8000-000000000001',
  execution: 'b5000000-0000-4000-8000-000000000001',
});
const DIGEST = 'a'.repeat(64);
const KEY = 'm23-part2-idempotency-0001';

function actor(overrides = {}) {
  return {
    organizationId: IDS.organization,
    actorUserId: IDS.actor,
    actorAccessRole: 'member',
    authSessionId: IDS.session,
    ...overrides,
  };
}

function initialization(overrides = {}) {
  return {
    ...actor(),
    appointmentId: IDS.appointment,
    idempotencyKey: KEY,
    body: {
      expectedAssignmentRevision: 4,
      expectedAssignmentDigest: DIGEST,
      reason: 'Begin the assigned field visit.',
    },
    ...overrides,
  };
}

function transition(overrides = {}) {
  return {
    ...actor(),
    executionId: IDS.execution,
    idempotencyKey: KEY,
    body: {
      action: 'start', expectedRevision: 1, expectedDigest: DIGEST,
      expectedAssignmentRevision: 4, expectedAssignmentDigest: DIGEST,
      reason: 'Work has started at the assigned site.',
    },
    ...overrides,
  };
}

function errorMiddleware(error, _req, res, _next) {
  res.status(error.statusCode || error.status || 500).json({ code: error.code || 'ERROR' });
}

describe('Mission 23 Part 2 field-execution contract', () => {
  test('normalizes only exact initialization and transition inputs', () => {
    expect(normalizeInitialization(initialization())).toMatchObject({
      organizationId: IDS.organization, actorUserId: IDS.actor,
      appointmentId: IDS.appointment, expectedAssignmentRevision: 4,
      expectedAssignmentDigest: DIGEST,
    });
    expect(normalizeTransition(transition())).toMatchObject({
      executionId: IDS.execution, action: 'start', expectedRevision: 1,
      expectedAssignmentRevision: 4,
    });
  });

  test.each([
    ['tenant injection', () => normalizeInitialization(initialization({
      body: { ...initialization().body, organizationId: IDS.organization },
    })), 'INVALID_EXECUTION_INITIALIZATION'],
    ['performer injection', () => normalizeTransition(transition({
      body: { ...transition().body, performedByProfileId: IDS.actor },
    })), 'INVALID_EXECUTION_TRANSITION'],
    ['missing source pin', () => normalizeInitialization(initialization({
      body: { expectedAssignmentRevision: 4, reason: 'Missing digest.' },
    })), 'M23_EXECUTION_PRECONDITION_REQUIRED'],
    ['unsupported later-part action', () => normalizeTransition(transition({
      body: { ...transition().body, action: 'complete' },
    })), 'INVALID_EXECUTION_ACTION'],
    ['short idempotency key', () => normalizeTransition(transition({ idempotencyKey: 'short' })),
      'INVALID_IDEMPOTENCY_KEY'],
    ['non-NFC reason', () => normalizeTransition(transition({
      body: { ...transition().body, reason: 'Cafe\u0301 started.' },
    })), 'INVALID_EXECUTION_REASON'],
    ['control byte', () => normalizeTransition(transition({
      body: { ...transition().body, reason: 'Started\u0007now.' },
    })), 'INVALID_EXECUTION_REASON'],
  ])('rejects %s', (_label, action, code) => {
    expect(action).toThrow(FieldExecutionContractError);
    try { action(); } catch (error) { expect(error.code).toBe(code); }
  });

  test('recognizes only the two exact mutation targets', () => {
    const req = target => ({ method: 'POST', originalUrl: target, url: target });
    expect(isExecutionMutationRequest(req(
      `/api/v1/field-executions/appointments/${IDS.appointment}`
    ))).toBe(true);
    expect(isExecutionMutationRequest(req(
      `/api/v1/field-executions/${IDS.execution}/transitions`
    ))).toBe(true);
    expect(isExecutionMutationRequest(req(`/api/v1/field-executions/${IDS.execution}`))).toBe(false);
    expect(isExecutionMutationRequest({ ...req('/api/v1/jobs'), method: 'POST' })).toBe(false);
  });

  test('owns raw bytes and rejects ambiguous, compressed, and oversized bodies', async () => {
    const app = express();
    app.use(executionBodyBoundary);
    app.post('/api/v1/field-executions/appointments/:appointmentId', (req, res) => {
      res.json({ body: req.body, rawBody: req.rawBody });
    });
    app.use(errorMiddleware);

    const valid = await request(app)
      .post(`/api/v1/field-executions/appointments/${IDS.appointment}`)
      .type('application/json').send('{"reason":"one"}');
    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({ body: { reason: 'one' }, rawBody: '{"reason":"one"}' });

    const duplicate = await request(app)
      .post(`/api/v1/field-executions/appointments/${IDS.appointment}`)
      .type('application/json').send('{"reason":"one","reason":"two"}');
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.code).toBe('M23_EXECUTION_AMBIGUOUS_JSON');

    const compressed = await request(app)
      .post(`/api/v1/field-executions/appointments/${IDS.appointment}`)
      .set('Content-Type', 'application/json').set('Content-Encoding', 'gzip').send('{}');
    expect(compressed.status).toBe(415);
    expect(compressed.body.code).toBe('M23_EXECUTION_CONTENT_ENCODING_UNSUPPORTED');

    const oversized = await request(app)
      .post(`/api/v1/field-executions/appointments/${IDS.appointment}`)
      .type('application/json').send(JSON.stringify({ value: 'x'.repeat(33 * 1024) }));
    expect(oversized.status).toBe(413);
    expect(oversized.body.code).toBe('M23_EXECUTION_BODY_TOO_LARGE');
  });

  test('derives route authority from trusted request state and preserves exact replay response', async () => {
    const observed = [];
    const app = express();
    app.use(executionBodyBoundary);
    app.use((req, _res, next) => {
      req.tenantContext = { organizationId: IDS.organization, userId: IDS.actor };
      req.userRole = 'member';
      req.authSession = { id: IDS.session };
      req.accountAuthority = { membership_id: IDS.actor };
      req.requestId = 'm23-route-request-1';
      next();
    });
    app.use('/api/v1/field-executions', createFieldExecutionsRouter({
      poolProvider: () => ({ marker: 'pool' }),
      mutationAuth: (_req, _res, next) => next(),
      tenantAuth: (_req, _res, next) => next(),
      permission: () => (_req, _res, next) => next(),
      initialize: async (pool, input) => {
        observed.push({ pool, input });
        return {
          status: 201, replayed: true,
          body: { success: true, requestId: 'original-request', data: { id: IDS.execution } },
        };
      },
    }));
    app.use(errorMiddleware);

    const response = await request(app)
      .post(`/api/v1/field-executions/appointments/${IDS.appointment}`)
      .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'c'.repeat(64))
      .type('application/json').send(initialization().body);
    expect(response.status).toBe(201);
    expect(response.headers['idempotency-replayed']).toBe('true');
    expect(response.body.requestId).toBe('original-request');
    expect(observed[0]).toMatchObject({
      pool: { marker: 'pool' },
      input: {
        organizationId: IDS.organization, actorUserId: IDS.actor,
        actorAccessRole: 'member', authSessionId: IDS.session,
        appointmentId: IDS.appointment, requestCorrelationId: 'm23-route-request-1',
      },
    });
    expect(observed[0].input).not.toHaveProperty('performedByProfileId');
  });

  test('requires the raw-body boundary before mutation routes', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/field-executions', createFieldExecutionsRouter({
      mutationAuth: (_req, _res, next) => next(),
      permission: () => (_req, _res, next) => next(),
    }));
    app.use(errorMiddleware);
    const response = await request(app)
      .post(`/api/v1/field-executions/appointments/${IDS.appointment}`)
      .set('Idempotency-Key', KEY).type('application/json').send(initialization().body);
    expect(response.status).toBe(500);
    expect(response.body.code).toBe('M23_EXECUTION_BODY_BOUNDARY_UNAVAILABLE');
  });

  test('mounts Part 2 before the global parser and legacy retirement router', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'server.js'), 'utf8');
    expect(source.indexOf('app.use(executionBodyBoundary)')).toBeLessThan(source.indexOf('app.use(express.json'));
    expect(source.indexOf("app.use('/api/v1/field-executions'"))
      .toBeLessThan(source.indexOf("app.use('/api/v1', createLegacyAuthorityRetirementRouter())"));
    for (const laterPart of ['time-entries', 'materials', 'equipment', 'completion', 'photos']) {
      expect(source).not.toContain(`/api/v1/${laterPart}`);
    }
  });
});
