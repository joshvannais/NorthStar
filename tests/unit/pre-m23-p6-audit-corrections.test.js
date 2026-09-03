'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const {
  RESPONSE_SCHEMA,
  contractError,
} = require('../../src/polaris/assistantContract');
const {
  createIdempotencyRegistry,
  statusForRuntime,
} = require('../../src/polaris/assistantRuntime');
const { createProductionOpenAIRuntime } = require('../../src/polaris/openaiRuntime');
const { createProviderUsageLedger } = require('../../src/polaris/providerLedger');
const { createCanonicalRouter } = require('../../src/routes/canonicalPolaris');
const cardRenderer = require('../../public/js/polaris-native-card');

const ORG = 'd1000000-0000-4000-8000-000000000001';
const USER = 'd2000000-0000-4000-8000-000000000001';
const LEAD = 'd3000000-0000-4000-8000-000000000001';
const MESSAGE_SCHEMA = 'northstar.polaris.message-request.v1';
const CONTEXT_SCHEMA = 'northstar.polaris.context-request.v1';

function scope(key, suffix) {
  return {
    key,
    organizationId: ORG,
    userId: USER,
    operation: 'polaris_message_v1',
    fingerprint: crypto.createHash('sha256').update(suffix).digest('hex'),
  };
}

describe('P6 audit correction: retryable idempotency recovery', () => {
  test.each([429, 503, 504])(
    're-admits one exact %s rejection at Retry-After while concurrent retries still join once',
    async statusCode => {
      let now = 0;
      let calls = 0;
      let release;
      const held = new Promise(resolve => { release = resolve; });
      const registry = createIdempotencyRegistry({
        maximumEntries: 4,
        retentionMs: 60000,
        clock: () => now,
      });
      const key = crypto.randomUUID();
      const exactScope = scope(key, `retryable-${statusCode}`);
      const operation = async function () {
        calls += 1;
        if (calls === 1) {
          const error = contractError(`POLARIS_RETRYABLE_${statusCode}`, 'Retry at the authoritative time.', statusCode);
          error.retryAfterSeconds = 2;
          throw error;
        }
        await held;
        return 'recovered-once';
      };

      await expect(registry.execute(exactScope, operation)).rejects.toMatchObject({
        statusCode,
        retryAfterSeconds: 2,
      });
      now = 1999;
      await expect(registry.execute(exactScope, operation)).rejects.toMatchObject({ statusCode });
      expect(calls).toBe(1);
      await expect(registry.execute({ ...exactScope, fingerprint: scope(key, 'changed').fingerprint }, operation))
        .rejects.toMatchObject({ code: 'POLARIS_IDEMPOTENCY_KEY_REUSED', statusCode: 409 });

      now = 2000;
      const firstRetry = registry.execute(exactScope, operation);
      const joinedRetry = registry.execute(exactScope, operation);
      await new Promise(resolve => setImmediate(resolve));
      expect(calls).toBe(2);
      release();
      await expect(Promise.all([firstRetry, joinedRetry])).resolves.toEqual(['recovered-once', 'recovered-once']);
      expect(calls).toBe(2);
      await expect(registry.execute(exactScope, operation)).resolves.toBe('recovered-once');
      expect(calls).toBe(2);
    }
  );

  test('retains a non-retryable rejection for the full bounded window even if it carries a delay-like field', async () => {
    let now = 0;
    let calls = 0;
    const registry = createIdempotencyRegistry({ maximumEntries: 2, retentionMs: 5000, clock: () => now });
    const exactScope = scope(crypto.randomUUID(), 'non-retryable');
    const operation = async function () {
      calls += 1;
      const error = contractError('POLARIS_PROVIDER_REFUSED', 'No retry.', 422);
      error.retryAfterSeconds = 1;
      throw error;
    };
    await expect(registry.execute(exactScope, operation)).rejects.toMatchObject({ statusCode: 422 });
    now = 1000;
    await expect(registry.execute(exactScope, operation)).rejects.toMatchObject({ statusCode: 422 });
    expect(calls).toBe(1);
  });

  test('never expires a retryable rejection before a Retry-After longer than normal retention', async () => {
    let now = 0;
    let calls = 0;
    const registry = createIdempotencyRegistry({ maximumEntries: 2, retentionMs: 1000, clock: () => now });
    const exactScope = scope(crypto.randomUUID(), 'long-retry-after');
    const operation = async function () {
      calls += 1;
      if (calls === 1) {
        const error = contractError('POLARIS_RATE_LIMIT', 'Wait for the authoritative retry time.', 429);
        error.retryAfterSeconds = 2;
        throw error;
      }
      return 'recovered-after-authoritative-delay';
    };
    await expect(registry.execute(exactScope, operation)).rejects.toMatchObject({ statusCode: 429 });
    now = 1500;
    await expect(registry.execute(exactScope, operation)).rejects.toMatchObject({ statusCode: 429 });
    expect(calls).toBe(1);
    now = 2000;
    await expect(registry.execute(exactScope, operation)).resolves.toBe('recovered-after-authoritative-delay');
    expect(calls).toBe(2);
  });
});

function mountedAuth(req, _res, next) {
  const role = req.get('X-Test-Role') || 'owner';
  const plan = req.get('X-Test-Plan') || 'Starter';
  req.tenantContext = Object.freeze({ organizationId: ORG, userId: USER, role });
  req.orgId = ORG;
  req.userRole = role;
  req.user = Object.freeze({ id: USER });
  Object.defineProperty(req, 'accountAuthority', {
    value: Object.freeze({ organization_id: ORG, user_id: USER, role, plan_type: plan, subscription_status: 'active' }),
  });
  next();
}

function denialApp(state) {
  const app = express();
  app.use(function (req, _res, next) { req.requestId = crypto.randomUUID(); next(); });
  app.use(express.json());
  app.use('/api/v1/canonical', createCanonicalRouter({
    auth: mountedAuth,
    permission: function () { return function (_req, _res, next) { next(); }; },
    assistantRateLimit: function (_req, _res, next) { state.rate += 1; next(); },
    assistantIdempotency: {
      execute: function () { state.idempotency += 1; throw new Error('idempotency must not run'); },
    },
    poolProvider: function () {
      return { query: async function () { state.queries += 1; return { rows: [] }; } };
    },
    assistantContextLoader: async function () { state.context += 1; return null; },
    assistantUsageLedger: {
      reserve: async function () { state.reserve += 1; throw new Error('reserve must not run'); },
      reconcile: async function () { state.reconcile += 1; },
      status: async function () { state.usageStatus += 1; return { state: 'warning' }; },
    },
    assistantRuntime: {
      kind: 'openai',
      status: async function () { state.runtimeStatus += 1; return { state: 'configured', label: 'Configured - not verified' }; },
      respond: async function () { state.transport += 1; throw new Error('transport must not run'); },
    },
  }));
  return app;
}

function emptyState() {
  return {
    rate: 0, idempotency: 0, queries: 0, context: 0, reserve: 0, reconcile: 0,
    usageStatus: 0, runtimeStatus: 0, transport: 0,
  };
}

function headers(role) {
  return { 'X-Test-Plan': 'Starter', 'X-Test-Role': role };
}

describe('P6 audit correction: Starter entitlement precedes all assistant work', () => {
  test.each(['owner', 'admin', 'member', 'viewer'])(
    'Starter %s status, context, and messages are denied before every assistant boundary',
    async role => {
      const state = emptyState();
      const app = denialApp(state);
      const status = await request(app).get('/api/v1/canonical/polaris/assistant/status').set(headers(role));
      const context = await request(app).post('/api/v1/canonical/polaris/assistant/context').set(headers(role)).send({
        schemaVersion: CONTEXT_SCHEMA,
        selected: { kind: 'lead', id: LEAD },
      });
      const messages = await request(app).post('/api/v1/canonical/polaris/assistant/messages').set(headers(role)).send({
        schemaVersion: MESSAGE_SCHEMA,
        idempotencyKey: crypto.randomUUID(),
        message: 'Do not reach assistant work.',
        selected: { kind: 'lead', id: LEAD },
      });

      for (const response of [status, context, messages]) {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe(role === 'owner' || role === 'admin'
          ? 'POLARIS_PLAN_LOCKED' : 'POLARIS_CONVERSATION_UNAVAILABLE');
        if (role === 'member' || role === 'viewer') {
          expect(JSON.stringify(response.body)).not.toMatch(/Starter|Growth|Complete|price|billing|provider|budget|warning/i);
        }
      }
      expect(state).toEqual(emptyState());
    }
  );
});

describe('P6 audit correction: configuration never claims provider availability', () => {
  test('configured production state is explicitly not verified across server and browser contracts', async () => {
    const secret = 'test-only-never-exposed';
    const runtime = createProductionOpenAIRuntime({
      POLARIS_OPENAI_ENABLED: 'true',
      OPENAI_API_KEY: secret,
    }, {
      clientFactory: function () { throw new Error('status must not construct a client'); },
    });
    expect(await runtime.status()).toEqual({ state: 'configured', label: 'Configured - not verified' });
    const status = await statusForRuntime(runtime, { requestId: 'configured-status' });
    expect(status).toMatchObject({
      state: 'configured',
      label: 'Configured - not verified',
      providerRequestsEnabled: true,
      providerRequestsSent: 0,
      decisionsRequired: [],
    });
    expect(cardRenderer.validateAssistantStatus(status)).toBe(status);
    expect(JSON.stringify(runtime) + JSON.stringify(status)).not.toContain(secret);
    expect(status.state + ' ' + status.label).not.toMatch(/available|healthy|ready/i);
  });
});

describe('P6 audit correction: durable target and warning policy', () => {
  test.each([
    ['within_target', '4000000000'],
    ['target', '5000000000'],
    ['warning', '10000000000'],
  ])('consumes exact migration thresholds into the server-only %s reservation state', async (expected, spend) => {
    const pool = {
      query: jest.fn(async function () {
        return { rows: [{
          reservation_id: crypto.randomUUID(),
          admitted: true,
          denial_code: null,
          retry_after_seconds: null,
          reserved_cost_nano_usd: '20000000',
          tenant_spend_nano_usd: spend,
          tenant_target_nano_usd: '5000000000',
          tenant_warning_nano_usd: '10000000000',
          tenant_hard_nano_usd: '20000000000',
          project_hard_nano_usd: '100000000000',
        }] };
      }),
    };
    const ledger = createProviderUsageLedger({ poolProvider: () => pool });
    const reservation = await ledger.reserve({
      organizationId: ORG,
      userId: USER,
      requestId: crypto.randomUUID(),
      fingerprint: 'a'.repeat(64),
      model: 'gpt-5.6-luna',
      schemaVersion: RESPONSE_SCHEMA,
    });
    expect(reservation.usagePolicyState).toBe(expected);
    expect(Object.keys(reservation).sort()).toEqual([
      'id', 'organizationId', 'requestId', 'reservedCostNanoUsd', 'usagePolicyState', 'userId',
    ]);
  });

  test('reads one tenant-scoped durable policy state without returning thresholds, revenue, or provider detail', async () => {
    const pool = {
      query: jest.fn(async function (sql, parameters) {
        expect(sql).toContain('polaris_provider_usage_policy_status');
        expect(parameters).toEqual([ORG, USER]);
        return { rows: [{ policy_state: 'warning' }] };
      }),
    };
    const ledger = createProviderUsageLedger({ poolProvider: () => pool });
    await expect(ledger.status({ organizationId: ORG, userId: USER })).resolves.toEqual({ state: 'warning' });
    expect(JSON.stringify(await ledger.status({ organizationId: ORG, userId: USER })))
      .not.toMatch(/nano|dollar|revenue|provider|openai|target.*\d|warning.*\d/i);
  });
});
