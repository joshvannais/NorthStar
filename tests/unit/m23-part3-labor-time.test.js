'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const {
  FieldExecutionContractError,
  LABOR_CATEGORY_CONTRACT_DIGEST,
  LABOR_CATEGORY_CONTRACT_VERSION,
  normalizeLaborAction,
} = require('../../src/operations/contract');
const { executionBodyBoundary, isExecutionMutationRequest } = require('../../src/operations/httpBoundary');
const { createFieldExecutionsRouter } = require('../../src/routes/fieldExecutions');
const { mapDatabaseError } = require('../../src/operations/repository');

const IDS = Object.freeze({
  organization: 'd1000000-0000-4000-8000-000000000001',
  actor: 'd2000000-0000-4000-8000-000000000001',
  session: 'd3000000-0000-4000-8000-000000000001',
  execution: 'd4000000-0000-4000-8000-000000000001',
  performer: 'd5000000-0000-4000-8000-000000000001',
  profile: 'd6000000-0000-4000-8000-000000000001',
  interval: 'd7000000-0000-4000-8000-000000000001',
});
const DIGEST = 'a'.repeat(64);
const KEY = 'm23-part3-idempotency-0001';

function common(action) {
  return {
    action, performerProfileId: IDS.performer,
    categoryContractVersion: LABOR_CATEGORY_CONTRACT_VERSION,
    categoryContractDigest: LABOR_CATEGORY_CONTRACT_DIGEST,
    expectedExecutionRevision: 2, expectedExecutionDigest: DIGEST,
    expectedAssignmentRevision: 5, expectedAssignmentDigest: DIGEST,
    businessProfileId: IDS.profile, businessProfileVersion: 3,
    businessProfileHash: DIGEST, timeZone: 'America/New_York',
    reason: 'Record observed field-service time evidence.',
  };
}

function input(action, extra = {}) {
  return {
    organizationId: IDS.organization, actorUserId: IDS.actor,
    actorAccessRole: 'member', authSessionId: IDS.session,
    executionId: IDS.execution, idempotencyKey: KEY,
    body: { ...common(action), ...extra },
  };
}

function errorMiddleware(error, _req, res, _next) {
  res.status(error.statusCode || error.status || 500).json({ code: error.code || 'ERROR' });
}

describe('Mission 23 Part 3 labor/time contract', () => {
  test.each([
    ['start timer', input('start_timer', { category: 'production' })],
    ['stop timer', input('stop_timer', { intervalId: IDS.interval,
      expectedIntervalRevision: 1, expectedIntervalDigest: DIGEST })],
    ['manual', input('record_manual', { category: 'travel',
      observedStart: '2026-11-01T01:15:00-04:00', observedEnd: '2026-11-01T01:45:00-04:00' })],
    ['correction', input('correct', { category: 'setup', intervalId: IDS.interval,
      expectedIntervalRevision: 2, expectedIntervalDigest: DIGEST,
      observedStart: '2026-11-01T01:15:00-05:00', observedEnd: '2026-11-01T01:45:00-05:00' })],
    ['review', input('review', { intervalId: IDS.interval,
      expectedIntervalRevision: 3, expectedIntervalDigest: DIGEST, reviewOutcome: 'accepted' })],
  ])('normalizes %s with exact source and category/time authority pins', (_label, value) => {
    expect(normalizeLaborAction(value)).toMatchObject({
      action: value.body.action, performerProfileId: IDS.performer,
      expectedExecutionRevision: 2, expectedAssignmentRevision: 5,
      businessProfileId: IDS.profile, businessProfileVersion: 3,
      categoryContractVersion: LABOR_CATEGORY_CONTRACT_VERSION,
    });
  });

  test.each([
    ['unknown field', input('start_timer', { category: 'production', wage: 40 }), 'INVALID_LABOR_ACTION'],
    ['unsupported category', input('start_timer', { category: 'overtime' }), 'INVALID_LABOR_CATEGORY'],
    ['stale category contract', input('start_timer', { category: 'production',
      categoryContractDigest: 'b'.repeat(64) }), 'M23_LABOR_CATEGORY_CONTRACT_STALE'],
    ['missing execution pin', input('start_timer', { category: 'production',
      expectedExecutionDigest: undefined }), 'INVALID_LABOR_SOURCE_PIN'],
    ['timer with client time', input('start_timer', { category: 'production',
      observedStart: '2026-09-04T10:00:00Z' }), 'INVALID_LABOR_ACTION'],
    ['manual missing offset', input('record_manual', { category: 'production',
      observedStart: '2026-09-04T10:00:00', observedEnd: '2026-09-04T11:00:00Z' }), 'INVALID_LABOR_INSTANT'],
    ['non-NFC reason', input('start_timer', { category: 'production', reason: 'Cafe\u0301 work.' }),
      'INVALID_EXECUTION_REASON'],
  ])('rejects %s', (_label, value, code) => {
    expect(() => normalizeLaborAction(value)).toThrow(FieldExecutionContractError);
    try { normalizeLaborAction(value); } catch (error) { expect(error.code).toBe(code); }
  });

  test('the raw HTTP boundary owns the labor mutation bytes', async () => {
    const target = `/api/v1/field-executions/${IDS.execution}/labor-actions`;
    expect(isExecutionMutationRequest({ method: 'POST', originalUrl: target, url: target })).toBe(true);
    const app = express();
    app.use(executionBodyBoundary);
    app.post('/api/v1/field-executions/:executionId/labor-actions', (req, res) =>
      res.json({ body: req.body, rawBody: req.rawBody }));
    app.use(errorMiddleware);
    const duplicate = await request(app).post(target).type('application/json')
      .send('{"action":"start_timer","action":"record_manual"}');
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.code).toBe('M23_EXECUTION_AMBIGUOUS_JSON');
    const compressed = await request(app).post(target).set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip').send('{}');
    expect(compressed.status).toBe(415);
  });

  test('route derives actor identity, returns exact replay, and emits no-store', async () => {
    const observed = [];
    const app = express();
    app.use(executionBodyBoundary);
    app.use((req, _res, next) => {
      req.tenantContext = { organizationId: IDS.organization, userId: IDS.actor };
      req.userRole = 'member'; req.authSession = { id: IDS.session };
      req.accountAuthority = { membership_id: IDS.actor }; req.requestId = 'm23-p3-route'; next();
    });
    app.use('/api/v1/field-executions', createFieldExecutionsRouter({
      poolProvider: () => ({ marker: 'pool' }),
      mutationAuth: (_req, _res, next) => next(), tenantAuth: (_req, _res, next) => next(),
      permission: () => (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
      laborMutate: async (pool, value) => {
        observed.push({ pool, value });
        return { status: 200, replayed: true,
          body: { success: true, requestId: 'original', data: { id: IDS.interval } } };
      },
    }));
    app.use(errorMiddleware);
    const response = await request(app)
      .post(`/api/v1/field-executions/${IDS.execution}/labor-actions`)
      .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'c'.repeat(64))
      .type('application/json').send(input('start_timer', { category: 'production' }).body);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['idempotency-replayed']).toBe('true');
    expect(response.body.requestId).toBe('original');
    expect(observed[0]).toMatchObject({ pool: { marker: 'pool' }, value: {
      organizationId: IDS.organization, actorUserId: IDS.actor,
      authSessionId: IDS.session, performerProfileId: IDS.performer,
    } });
  });

  test('maps overlap, timer, stale, authorization, and input failures without an oracle', () => {
    const mapped = constraint => mapDatabaseError({ code: '23514', constraint });
    expect(mapped('canonical_labor_overlap')).toMatchObject({ status: 409, code: 'M23_LABOR_OVERLAP' });
    expect(mapped('canonical_labor_timer_open')).toMatchObject({ status: 409, code: 'M23_LABOR_TIMER_ALREADY_OPEN' });
    expect(mapped('canonical_labor_stale_interval')).toMatchObject({ status: 409, code: 'M23_LABOR_STALE' });
    expect(mapDatabaseError({ code: '42501', constraint: 'canonical_labor_performer_forged' }))
      .toMatchObject({ status: 403, code: 'M23_EXECUTION_FORBIDDEN' });
    expect(mapped('canonical_labor_input_invalid')).toMatchObject({ status: 400, code: 'INVALID_LABOR_REQUEST' });
  });

  test('keeps Part 3 backend-only and records explicit non-inference boundaries', () => {
    const root = path.join(__dirname, '..', '..');
    const migration = fs.readFileSync(path.join(root, 'migrations',
      '039_canonical_labor_time_evidence.sql'), 'utf8');
    expect(migration).toContain('Observed or entered operational time evidence only');
    expect(migration).toContain("transcript.source NOT IN ('simulation','demo')");
    expect(migration).not.toContain('CREATE TABLE public.canonical_material');
    expect(migration).not.toContain('latitude');
    const changedRuntime = ['src/db.js', 'src/operations/contract.js',
      'src/operations/httpBoundary.js', 'src/operations/repository.js', 'src/routes/fieldExecutions.js'];
    for (const file of changedRuntime) expect(file).not.toMatch(/public[\\/]|views?[\\/]|browser[\\/]/);
  });
});
