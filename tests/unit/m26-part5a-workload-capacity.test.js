'use strict';

const express = require('express');
const request = require('supertest');
const fs = require('node:fs');
const { createForecastWorkloadCapacityRouter, safeOrigin, safeEvaluation } =
  require('../../src/routes/forecastWorkloadCapacity');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const ID = '44444444-4444-4444-8444-444444444444';
const ORIGIN = '55555555-5555-4555-8555-555555555555';
const DIGEST = 'a'.repeat(64);
const KEY = 'm26-part5a-test-key-0001';
const TARGETS = ['workload.accepted_person_hours.v1', 'workload.end_backlog_hours.v1',
  'capacity.available_role_hours.v1'];

function origin(extra = {}) {
  return { state: 'workload_capacity_origin_current', id: ID, capacityRole: 'technician',
    predictionCutoffAt: '2026-11-01T12:00:00.000000Z',
    horizonEndsAt: '2026-12-01T12:00:00.000000Z', targets: TARGETS,
    refreshRequired: false, resultsWithheld: true, outputDigestsWithheld: true,
    researchOnly: true, forecastIssued: false, paidNumericServing: false,
    forecastServingEnabled: false, automaticActionTaken: false, replayed: false, ...extra };
}
function evaluation(extra = {}) {
  return { state: 'workload_capacity_evaluation_current', id: ID, originId: ORIGIN,
    capacityRole: 'technician',
    revision: 1, evaluatedAt: '2026-12-01T12:00:00.000000Z', targets: TARGETS,
    refreshRequired: false, metricsWithheld: true, researchOnly: true,
    forecastIssued: false, paidNumericServing: false, forecastServingEnabled: false,
    automaticActionTaken: false, replayed: false, ...extra };
}
function application({ role = 'owner', values = {}, databaseError } = {}) {
  const app = express(); app.use(express.json());
  const auth = (req, _res, next) => {
    req.user = { id: USER }; req.orgId = ORG;
    req.tenantContext = { organizationId: ORG, userId: USER };
    req.userRole = role; req.authSession = { id: SESSION }; next();
  };
  const client = { query: jest.fn(async sql => {
    if (databaseError && sql.startsWith('SELECT public.')) throw databaseError;
    if (!sql.startsWith('SELECT public.')) return { rows: [] };
    for (const [needle, value] of Object.entries(values)) {
      if (sql.includes(needle)) return { rows: [{ value }] };
    }
    return { rows: [{ value: null }] };
  }), release: jest.fn() };
  const pool = { connect: jest.fn(async () => client) };
  const bypass = (_req, _res, next) => next();
  app.use('/api/v1/forecast/workload-capacity', createForecastWorkloadCapacityRouter({
    auth, throttle: bypass, writeThrottle: bypass, poolProvider: () => pool,
  }));
  return { app, client, pool };
}

describe('Mission 26 Part 5A workload and base-capacity boundary', () => {
  test('withholds every private point, digest, member and metric', () => {
    expect(safeOrigin(origin(), ID)).toEqual(origin());
    expect(safeEvaluation(evaluation(), ORIGIN, ID)).toEqual(evaluation());
    for (const poison of [{ privateResults: {} }, { outputDigest: DIGEST }, { members: [] },
      { acceptedPersonHours: '4.0' }, { availableRoleHours: '8.0' }]) {
      expect(safeOrigin({ ...origin(), ...poison }, ID)).toBeNull();
    }
    for (const poison of [{ privateMetrics: {} }, { actual: '1' }, { absoluteError: '1' }]) {
      expect(safeEvaluation({ ...evaluation(), ...poison }, ORIGIN, ID)).toBeNull();
    }
  });

  test('requires exact ordered targets, identities and false serving flags', () => {
    expect(safeOrigin(origin({ targets: [...TARGETS].reverse() }), ID)).toBeNull();
    expect(safeOrigin(origin({ id: ORIGIN }), ID)).toBeNull();
    expect(safeOrigin(origin({ horizonEndsAt: '2026-12-02T12:00:00.000000Z' }), ID)).toBeNull();
    expect(safeOrigin(origin({ predictionCutoffAt: 'not-an-instant' }), ID)).toBeNull();
    expect(safeOrigin(origin({ paidNumericServing: true }), ID)).toBeNull();
    expect(safeEvaluation(evaluation({ originId: ID }), ORIGIN, ID)).toBeNull();
    expect(safeEvaluation(evaluation({ replayed: 'false' }), ORIGIN, ID)).toBeNull();
  });

  test('rejects caller clocks, members, manifests and malformed human reviews before DB use', async () => {
    const { app, pool } = application();
    expect((await request(app).post('/api/v1/forecast/workload-capacity/origins')
      .set('Idempotency-Key', KEY).send({ horizonDays: 30 })).status).toBe(400);
    expect((await request(app).post('/api/v1/forecast/workload-capacity/windows/finalize')
      .set('Idempotency-Key', KEY).send({ windowStart: 'bad', windowEnd: 'bad',
        reason: 'Finalize this complete installed source window.' })).status).toBe(400);
    expect((await request(app).post('/api/v1/forecast/workload-capacity/reviews')
      .set('Idempotency-Key', KEY).send({ kind: 'method', target: TARGETS[0], subjectId: null,
        role: null, action: 'approve', expectedRevision: 0, expectedDigest: 'none',
        remainingPersonMinutes: null, reason: 'short', confirmed: true,
        confirmationVersion: 'm26-workload-capacity-review-v1' })).status).toBe(400);
    expect((await request(app).post('/api/v1/forecast/workload-capacity/reviews')
      .set('Idempotency-Key', KEY).send({ kind: 'availability_basis', target: TARGETS[2], subjectId: ID,
        role: 'technician', action: 'approve', expectedRevision: 0, expectedDigest: 'none',
        remainingPersonMinutes: null, reason: 'This contradictory review shape must be refused.', confirmed: true,
        confirmationVersion: 'm26-workload-capacity-review-v1' })).status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('routes explicit server-timed origin authorization and preserves replay identity', async () => {
    const saved = origin({ state: 'workload_capacity_origin_saved', replayed: true });
    const { app, client } = application({ values: {
      canonical_forecast_workload_capacity_v1_origin_capture: saved,
    } });
    const response = await request(app).post('/api/v1/forecast/workload-capacity/origins')
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send({
        reason: 'Authorize exact server-selected training receipts and a future research origin.',
        confirmed: true, confirmationVersion: 'm26-workload-capacity-origin-v1',
      });
    expect(response.status).toBe(200);
    expect(response.headers['idempotency-replayed']).toBe('true');
    expect(response.body.data).toEqual(saved);
    const call = client.query.mock.calls.find(([sql]) => sql.includes('_origin_capture'));
    expect(call[1]).toEqual([ORG, USER, 'owner', SESSION, 'csrf', KEY,
      'Authorize exact server-selected training receipts and a future research origin.',
      'm26-workload-capacity-origin-v1']);
  });

  test('reads exact recovery tokens without private reviewed values', async () => {
    const value = { state: 'workload_capacity_review_current', kind: 'remaining_work',
      target: TARGETS[1], subjectId: ID, role: null, reviewId: ORIGIN, action: 'approve',
      expectedRevision: 2, expectedDigest: DIGEST, sourceCurrent: false, researchOnly: true,
      forecastIssued: false, paidNumericServing: false, forecastServingEnabled: false,
      automaticActionTaken: false };
    const { app, client } = application({ values: {
      canonical_forecast_workload_capacity_v1_review_current: value,
    } });
    const response = await request(app).get(`/api/v1/forecast/workload-capacity/reviews/current?kind=remaining_work&target=${encodeURIComponent(TARGETS[1])}&subjectId=${ID}&role=none`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(value);
    expect(JSON.stringify(response.body)).not.toContain('remainingPersonMinutes');
    const call = client.query.mock.calls.find(([sql]) => sql.includes('_review_current'));
    expect(call[1]).toEqual([ORG, USER, 'owner', SESSION, 'remaining_work', TARGETS[1], ID, null]);
  });

  test('routes explicit unschedule with exact source identity and replay semantics', async () => {
    const value = { state: 'workload_capacity_backlog_unscheduled', appointmentId: ID,
      assignmentId: ORIGIN, assignmentRevision: 2, assignmentDigest: DIGEST,
      scheduleState: 'unscheduled', dispatchState: 'revoked', researchOnly: true,
      forecastIssued: false, paidNumericServing: false, forecastServingEnabled: false,
      automaticActionTaken: false, replayed: false };
    const { app, client } = application({ values: {
      canonical_forecast_workload_capacity_v1_backlog_unschedule: value,
    } });
    const body = { expectedRevision: 1, expectedDigest: DIGEST,
      reason: 'Return this approved assignment to the explicit unscheduled workload queue.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-unschedule-v1' };
    const response = await request(app).post(`/api/v1/forecast/workload-capacity/backlog-items/${ID}/unschedule`)
      .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send(body);
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(value);
    const call = client.query.mock.calls.find(([sql]) => sql.includes('_backlog_unschedule'));
    expect(call[1]).toEqual([ORG, USER, 'owner', SESSION, 'csrf', KEY, ID, 1, DIGEST,
      body.reason, body.confirmationVersion]);

    for (const malformed of [
      { ...body, expectedRevision: 0 },
      { ...body, expectedDigest: 'none' },
      { ...body, confirmed: false },
      { ...body, confirmationVersion: 'other' },
      { ...body, callerMembers: [] },
    ]) {
      const invalidResponse = await request(app)
        .post(`/api/v1/forecast/workload-capacity/backlog-items/${ID}/unschedule`)
        .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send(malformed);
      expect(invalidResponse.status).toBe(400);
    }
  });

  test('fails closed on malformed explicit-unschedule projections', async () => {
    const valid = { state: 'workload_capacity_backlog_unscheduled', appointmentId: ID,
      assignmentId: ORIGIN, assignmentRevision: 2, assignmentDigest: DIGEST,
      scheduleState: 'unscheduled', dispatchState: 'not_dispatched', researchOnly: true,
      forecastIssued: false, paidNumericServing: false, forecastServingEnabled: false,
      automaticActionTaken: false, replayed: true };
    const body = { expectedRevision: 1, expectedDigest: DIGEST,
      reason: 'Return this approved assignment to the explicit unscheduled workload queue.',
      confirmed: true, confirmationVersion: 'm26-workload-capacity-unschedule-v1' };
    for (const poisoned of [
      { ...valid, replayed: 'true' },
      { ...valid, assignmentRevision: 1 },
      { ...valid, appointmentId: ORIGIN },
      { ...valid, outputDigest: DIGEST },
      { ...valid, scheduleState: 'scheduled' },
    ]) {
      const { app } = application({ values: {
        canonical_forecast_workload_capacity_v1_backlog_unschedule: poisoned,
      } });
      const response = await request(app)
        .post(`/api/v1/forecast/workload-capacity/backlog-items/${ID}/unschedule`)
        .set('X-CSRF-Token', 'csrf').set('Idempotency-Key', KEY).send(body);
      expect(response.status).toBe(503);
      expect(JSON.stringify(response.body)).not.toContain(DIGEST);
    }
  });

  test('keeps missing and cross-tenant identities non-disclosing', async () => {
    const missing = application({ values: {
      canonical_forecast_workload_capacity_v1_origin_read: null,
    } });
    const response = await request(missing.app)
      .get(`/api/v1/forecast/workload-capacity/origins/${ID}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ state: 'not_found' });
    const member = application({ role: 'member' });
    expect((await request(member.app)
      .get(`/api/v1/forecast/workload-capacity/origins/${ID}`)).status).toBe(403);
  });

  test('maps guarded errors without leaking private database details', async () => {
    const app = application({ databaseError: { code: 'XX000', detail: 'private point 17.5' } }).app;
    const response = await request(app).get(`/api/v1/forecast/workload-capacity/origins/${ID}`);
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('17.5');
  });

  test('migration fixes exact units, half-open horizons, source fences and private ACLs', () => {
    const sql = fs.readFileSync('migrations/224_canonical_forecast_workload_capacity_v1.sql', 'utf8');
    expect(sql).toContain("'workload.accepted_person_hours.v1'");
    expect(sql).toContain("'workload.end_backlog_hours.v1'");
    expect(sql).toContain("'capacity.available_role_hours.v1'");
    expect(sql).toContain("CHECK(horizon_seconds=2592000)");
    expect(sql).toContain("end_value-start_value<>INTERVAL '30 days'");
    expect(sql).toContain("cutoff_value+INTERVAL '2592000 seconds'");
    expect(sql).toContain('ALTER FUNCTION public.canonical_field_execution_validate_complete() SECURITY DEFINER');
    expect(sql).toContain('ALTER FUNCTION public.canonical_labor_validate_complete() SECURITY DEFINER');
    expect(sql).toContain('ALTER FUNCTION public.canonical_completion_validate_complete() SECURITY DEFINER');
    expect(sql).toContain('z_m26_p5a_disposable_completion_clock');
    expect(sql).toContain('canonical_forecast_workload_capacity_availability_events_v1');
    expect(sql).toContain('Capacity eligibility or commitment changed inside window');
    expect(sql).toContain('canonical_forecast_workload_capacity_v1_lock_sources');
    expect(sql).toContain('IN SHARE MODE');
    expect(sql).toContain("review_state='accepted'");
    expect(sql).toContain("'owner_reviewed_m23_profile_and_operational_role'");
    expect(sql).toContain("'owner_reviewed_internal_operational_role_only'");
    expect(sql).toContain("'independentCredentialVerified',FALSE");
    expect(sql).toContain("'providerCertificationVerified',FALSE");
    expect(sql).toContain("'realizedAttendanceVerified',FALSE");
    expect(sql).toContain("'jobSpecificConstraintCompositionAvailable',FALSE");
    expect(sql).toContain('owner_reviewed_internal_operational_role_only');
    expect(sql.match(/location_scope_authority_missing/g)).toHaveLength(2);
    expect(sql.match(/required_skill_authority_missing/g)).toHaveLength(2);
    expect(sql).not.toContain("assignment.schedule_state='scheduled' AND assignment.needs_review=FALSE");
    expect(sql).toContain('Backlog evidence exceeds bound');
    expect(sql).toContain('Capacity evidence exceeds bound');
    expect(sql).toContain('REVOKE ALL ON TABLE public.canonical_forecast_workload_capacity_test_clock_v1');
  });
});
