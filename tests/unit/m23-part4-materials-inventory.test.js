'use strict';

const express = require('express');
const request = require('supertest');
const {
  FieldExecutionContractError,
  MATERIAL_UNIT_CONTRACT_DIGEST,
  MATERIAL_UNIT_CONTRACT_VERSION,
  normalizeMaterialAction,
} = require('../../src/operations/contract');
const { executionBodyBoundary, isExecutionMutationRequest } = require('../../src/operations/httpBoundary');
const { createFieldExecutionsRouter } = require('../../src/routes/fieldExecutions');
const { mapDatabaseError } = require('../../src/operations/repository');

const IDS = Object.freeze({
  organization: 'e1000000-0000-4000-8000-000000000001',
  actor: 'e2000000-0000-4000-8000-000000000001',
  session: 'e3000000-0000-4000-8000-000000000001',
  execution: 'e4000000-0000-4000-8000-000000000001',
  performer: 'e5000000-0000-4000-8000-000000000001',
  movement: 'e6000000-0000-4000-8000-000000000001',
});
const DIGEST = 'a'.repeat(64);
const KEY = 'm23-part4-idempotency-0001';

function common(action) {
  return {
    action,
    performerProfileId: IDS.performer,
    expectedExecutionRevision: 2,
    expectedExecutionDigest: DIGEST,
    expectedAssignmentRevision: 5,
    expectedAssignmentDigest: DIGEST,
    unitContractVersion: MATERIAL_UNIT_CONTRACT_VERSION,
    unitContractDigest: MATERIAL_UNIT_CONTRACT_DIGEST,
    reason: 'Record attributable material movement evidence.',
  };
}

function input(action, extra = {}) {
  return {
    organizationId: IDS.organization,
    actorUserId: IDS.actor,
    actorAccessRole: 'member',
    authSessionId: IDS.session,
    executionId: IDS.execution,
    idempotencyKey: KEY,
    body: { ...common(action), ...extra },
  };
}

function materialFields(overrides = {}) {
  return Object.fromEntries(Object.entries({
    movementKind: 'consumed',
    itemKey: 'fence_board',
    description: 'Pressure-treated fence board',
    quantity: '12.000000',
    unitCode: 'each',
    locationKey: 'truck_1',
    lotCode: 'lot_2026_09',
    ...overrides,
  }).filter(([, value]) => value !== undefined));
}

function existingFields(overrides = {}) {
  return {
    movementId: IDS.movement,
    expectedMovementRevision: 1,
    expectedMovementDigest: DIGEST,
    ...overrides,
  };
}

function errorMiddleware(error, _req, res, _next) {
  res.status(error.statusCode || error.status || 500).json({ code: error.code || 'ERROR' });
}

describe('Mission 23 Part 4 materials and inventory contract', () => {
  test.each([
    ['consumed usage', input('record', materialFields())],
    ['returned usage', input('record', materialFields({ movementKind: 'returned' }))],
    ['waste usage', input('record', materialFields({ movementKind: 'waste' }))],
    ['known transfer', input('record', materialFields({
      movementKind: 'transferred', destinationLocationKey: 'warehouse_2',
    }))],
    ['unknown-location transfer', input('record', materialFields({
      movementKind: 'transferred', locationKey: undefined, destinationLocationKey: undefined,
      lotCode: undefined,
    }))],
    ['authorized increase adjustment', input('record', materialFields({
      movementKind: 'adjustment', adjustmentDirection: 'increase',
    }))],
    ['correction', input('correct', {
      ...materialFields({ quantity: '11.500000' }), ...existingFields(),
    })],
    ['review', input('review', { ...existingFields(), reviewOutcome: 'accepted' })],
    ['reversal', input('reverse', existingFields())],
  ])('normalizes %s with exact execution, assignment, unit, and movement pins', (_label, value) => {
    expect(normalizeMaterialAction(value)).toMatchObject({
      action: value.body.action,
      performerProfileId: IDS.performer,
      expectedExecutionRevision: 2,
      expectedAssignmentRevision: 5,
      unitContractVersion: MATERIAL_UNIT_CONTRACT_VERSION,
    });
  });

  test.each([
    ['unknown commercial field', input('record', materialFields({ price: '40.00' })), 'INVALID_MATERIAL_ACTION'],
    ['numeric quantity', input('record', materialFields({ quantity: 12 })), 'INVALID_MATERIAL_QUANTITY'],
    ['zero quantity', input('record', materialFields({ quantity: '0.000000' })), 'INVALID_MATERIAL_QUANTITY'],
    ['excess precision', input('record', materialFields({ quantity: '1.0000001' })), 'INVALID_MATERIAL_QUANTITY'],
    ['noncanonical item key', input('record', materialFields({ itemKey: 'Fence Board' })), 'INVALID_MATERIAL_KEY'],
    ['non-NFC description', input('record', materialFields({ description: 'Cafe\u0301 board' })), 'INVALID_MATERIAL_TEXT'],
    ['hostile location control', input('record', materialFields({ locationKey: 'truck\u0007one' })), 'INVALID_MATERIAL_KEY'],
    ['same transfer endpoints', input('record', materialFields({
      movementKind: 'transferred', destinationLocationKey: 'truck_1',
    })), 'INVALID_MATERIAL_ACTION'],
    ['adjustment missing direction', input('record', materialFields({
      movementKind: 'adjustment', adjustmentDirection: undefined,
    })), 'M23_MATERIAL_PRECONDITION_REQUIRED'],
    ['nonadjustment direction', input('record', materialFields({ adjustmentDirection: 'increase' })), 'INVALID_MATERIAL_ACTION'],
    ['stale unit contract', input('record', {
      ...materialFields(), unitContractDigest: 'b'.repeat(64),
    }), 'M23_MATERIAL_UNIT_CONTRACT_STALE'],
    ['correction missing exact movement pin', input('correct', materialFields()), 'M23_MATERIAL_PRECONDITION_REQUIRED'],
    ['review carrying quantity', input('review', {
      ...existingFields(), reviewOutcome: 'accepted', ...materialFields(),
    }), 'INVALID_MATERIAL_ACTION'],
    ['reversal carrying review', input('reverse', {
      ...existingFields(), reviewOutcome: 'accepted',
    }), 'INVALID_MATERIAL_ACTION'],
  ])('rejects %s', (_label, value, code) => {
    expect(() => normalizeMaterialAction(value)).toThrow(FieldExecutionContractError);
    try { normalizeMaterialAction(value); } catch (error) { expect(error.code).toBe(code); }
  });

  test('the raw HTTP boundary owns material mutation bytes', async () => {
    const target = `/api/v1/field-executions/${IDS.execution}/material-actions`;
    expect(isExecutionMutationRequest({ method: 'POST', originalUrl: target, url: target })).toBe(true);
    const app = express();
    app.use(executionBodyBoundary);
    app.post('/api/v1/field-executions/:executionId/material-actions', (req, res) =>
      res.json({ body: req.body, rawBody: req.rawBody }));
    app.use(errorMiddleware);
    const duplicate = await request(app).post(target).type('application/json')
      .send('{"action":"record","action":"reverse"}');
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
      req.accountAuthority = { membership_id: IDS.actor }; req.requestId = 'm23-p4-route'; next();
    });
    app.use('/api/v1/field-executions', createFieldExecutionsRouter({
      poolProvider: () => ({ marker: 'pool' }),
      mutationAuth: (_req, _res, next) => next(), tenantAuth: (_req, _res, next) => next(),
      permission: () => (_req, _res, next) => next(), throttle: (_req, _res, next) => next(),
      materialMutate: async (pool, value) => {
        observed.push({ pool, value });
        return { status: 200, replayed: true,
          body: { success: true, requestId: 'original', data: { id: IDS.movement } } };
      },
    }));
    app.use(errorMiddleware);
    const response = await request(app)
      .post(`/api/v1/field-executions/${IDS.execution}/material-actions`)
      .set('Idempotency-Key', KEY).set('X-CSRF-Token', 'c'.repeat(64))
      .type('application/json').send(input('record', materialFields()).body);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['idempotency-replayed']).toBe('true');
    expect(response.body.requestId).toBe('original');
    expect(observed[0]).toMatchObject({ pool: { marker: 'pool' }, value: {
      organizationId: IDS.organization, actorUserId: IDS.actor,
      authSessionId: IDS.session, performerProfileId: IDS.performer,
      quantity: '12.000000', unitCode: 'each',
    } });
  });

  test('maps balance, stale, reversal, authorization, and input failures safely', () => {
    const mapped = constraint => mapDatabaseError({ code: '23514', constraint });
    expect(mapped('canonical_material_balance_overflow')).toMatchObject({
      status: 409, code: 'M23_MATERIAL_BALANCE_LIMIT',
    });
    expect(mapped('canonical_material_stale_movement')).toMatchObject({
      status: 409, code: 'M23_MATERIAL_STALE',
    });
    expect(mapped('canonical_material_action_invalid')).toMatchObject({
      status: 409, code: 'M23_MATERIAL_ACTION_INVALID',
    });
    expect(mapped('canonical_material_already_reversed')).toMatchObject({
      status: 409, code: 'M23_MATERIAL_ALREADY_REVERSED',
    });
    expect(mapDatabaseError({ code: '42501', constraint: 'canonical_material_performer_forged' }))
      .toMatchObject({ status: 403, code: 'M23_EXECUTION_FORBIDDEN' });
    expect(mapped('canonical_material_input_invalid')).toMatchObject({
      status: 400, code: 'INVALID_MATERIAL_REQUEST',
    });
  });

  test('keeps Part 4 backend-only and excludes stock, cost, purchasing, pricing, and later authorities', () => {
    const forbidden = [
      'stockCost', 'stockValue', 'supplier', 'purchaseOrder', 'markup', 'customerPrice',
      'invoice', 'payment', 'provider', 'polaris', 'equipment', 'checklist', 'photo',
    ];
    const normalized = normalizeMaterialAction(input('record', materialFields()));
    for (const key of forbidden) expect(normalized).not.toHaveProperty(key);
    expect(MATERIAL_UNIT_CONTRACT_VERSION).toBe('m23-material-unit-v1');
    expect(MATERIAL_UNIT_CONTRACT_DIGEST).toMatch(/^[0-9a-f]{64}$/);
  });
});
