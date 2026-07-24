'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const priorDataDir = process.env.NORTHSTAR_DATA_DIR;
const testDataDir = fs.mkdtempSync(path.join(
  os.tmpdir(),
  'northstar-analytics-' + (process.env.JEST_WORKER_ID || '0') + '-'
));
process.env.NORTHSTAR_DATA_DIR = testDataDir;

const cache = require('../../src/cache/client');
const { createAnalyticsIdentity, cacheKey, TENANT_SESSION } = require('../../src/analytics/cacheIdentity');
const snapshots = require('../../src/analytics/dailySnapshots');
const revenue = require('../../src/analytics/revenue');

function req(options) {
  const input = options || {};
  return {
    orgId: input.orgId || 'org-a',
    user: { id: input.userId || 'user-a' },
    query: input.sessionId ? Object.assign({ sessionId: input.sessionId }, input.query || {}) : (input.query || {}),
    body: {}
  };
}

describe('analytics cache identity containment', function () {
  afterAll(function () {
    if (priorDataDir === undefined) delete process.env.NORTHSTAR_DATA_DIR;
    else process.env.NORTHSTAR_DATA_DIR = priorDataDir;
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  test('identity includes organization, user, active session, endpoint, period, and filters', function () {
    const base = createAnalyticsIdentity(req({ sessionId: 'session-a' }), 'overview', { period: 'week', service: 'HVAC' });
    expect(createAnalyticsIdentity(req({ sessionId: 'session-a' }), 'overview', { service: 'HVAC', period: 'week' }).key).toBe(base.key);
    expect(createAnalyticsIdentity(req({ sessionId: 'session-b' }), 'overview', { period: 'week', service: 'HVAC' }).key).not.toBe(base.key);
    expect(createAnalyticsIdentity(req({ userId: 'user-b', sessionId: 'session-a' }), 'overview', { period: 'week', service: 'HVAC' }).key).not.toBe(base.key);
    expect(createAnalyticsIdentity(req({ orgId: 'org-b', sessionId: 'session-a' }), 'overview', { period: 'week', service: 'HVAC' }).key).not.toBe(base.key);
    expect(createAnalyticsIdentity(req({ sessionId: 'session-a' }), 'revenue', { period: 'week', service: 'HVAC' }).key).not.toBe(base.key);
    expect(createAnalyticsIdentity(req({ sessionId: 'session-a' }), 'overview', { period: 'month', service: 'HVAC' }).key).not.toBe(base.key);
    expect(createAnalyticsIdentity(req({ sessionId: 'session-a' }), 'overview', { period: 'week', service: 'Plumbing' }).key).not.toBe(base.key);
  });

  test('sessionless tenant identity uses an explicit sentinel and ignores request organization fields', function () {
    const identity = createAnalyticsIdentity(
      req({ query: { organizationId: 'attacker-org', period: 'month' } }),
      'overview',
      { organizationId: 'attacker-org', period: 'month' }
    );
    expect(identity.dimensions.organizationId).toBe('org-a');
    expect(identity.dimensions.simulationSessionId).toBe(TENANT_SESSION);
    expect(identity.dimensions.filters).not.toHaveProperty('organizationId');
  });

  test('exact-identity cache hits and concurrent population coalesce', async function () {
    const identity = createAnalyticsIdentity(req({ sessionId: 'session-a' }), 'overview', { period: 'week' });
    const key = cacheKey(cache, 'test:analytics:coalesce', identity);
    let calls = 0;
    const compute = async function () {
      calls += 1;
      await new Promise(function (resolve) { setImmediate(resolve); });
      return { leads: 1 };
    };
    const values = await Promise.all([
      cache.wrap(key, compute, 30),
      cache.wrap(key, compute, 30),
      cache.wrap(key, compute, 30)
    ]);
    expect(values).toEqual([{ leads: 1 }, { leads: 1 }, { leads: 1 }]);
    expect(calls).toBe(1);
    expect(await cache.wrap(key, compute, 30)).toEqual({ leads: 1 });
    expect(calls).toBe(1);
  });

  test('different session and user identities never share concurrent cache work', async function () {
    const identities = [
      createAnalyticsIdentity(req({ sessionId: 'session-a' }), 'overview', { period: 'week' }),
      createAnalyticsIdentity(req({ sessionId: 'session-b' }), 'overview', { period: 'week' }),
      createAnalyticsIdentity(req({ userId: 'user-b', sessionId: 'session-a' }), 'overview', { period: 'week' })
    ];
    let calls = 0;
    const values = await Promise.all(identities.map(function (identity, index) {
      return cache.wrap(cacheKey(cache, 'test:analytics:isolation', identity), async function () {
        calls += 1;
        return { identity: index };
      }, 30);
    }));
    expect(calls).toBe(3);
    expect(values.map(function (value) { return value.identity; })).toEqual([0, 1, 2]);
  });

  test('the revenue consumer cannot reuse another session or user result', async function () {
    const appointment = [{ id: 'appointment-a', callOutcome: 'appointment-set', estimatedPrice: 1000 }];
    const twoLeads = [
      { id: 'lead-b-1', callOutcome: 'lead-captured', estimatedPrice: 100 },
      { id: 'lead-b-2', callOutcome: 'lead-captured', estimatedPrice: 200 }
    ];
    const sessionA = await revenue.computeRevenueOverview(
      req({ sessionId: 'revenue-session-a' }),
      appointment,
      { report: 'reviewer-scenario' }
    );
    const sessionB = await revenue.computeRevenueOverview(
      req({ sessionId: 'revenue-session-b' }),
      twoLeads,
      { report: 'reviewer-scenario' }
    );
    const userB = await revenue.computeRevenueOverview(
      req({ userId: 'revenue-user-b', sessionId: 'revenue-session-a' }),
      twoLeads,
      { report: 'reviewer-scenario' }
    );

    expect(sessionA.activeLeads).toBe(1);
    expect(sessionB.activeLeads).toBe(2);
    expect(userB.activeLeads).toBe(2);
  });

  test('persisted snapshots isolate the reviewer Session A and Session B scenario', async function () {
    const date = '2026-07-24';
    const sessionA = createAnalyticsIdentity(req({ sessionId: 'session-a' }), 'overview', { period: 'current_day' });
    const sessionB = createAnalyticsIdentity(req({ sessionId: 'session-b' }), 'overview', { period: 'current_day' });
    const a = await snapshots.getOrCompute(sessionA, date, [
      { id: 'appointment-a', source: 'phone_call', callOutcome: 'appointment-set', estimatedPrice: 1000 }
    ]);
    const b = await snapshots.getOrCompute(sessionB, date, [
      { id: 'lead-b-1', source: 'phone_call', callOutcome: 'lead-captured', estimatedPrice: 100 },
      { id: 'lead-b-2', source: 'phone_call', callOutcome: 'lead-captured', estimatedPrice: 200 }
    ]);

    expect(a.leads_captured).toBe(1);
    expect(a.appointments_scheduled).toBe(1);
    expect(b.leads_captured).toBe(2);
    expect(b.appointments_scheduled).toBe(0);
    expect(snapshots.loadSnapshot(sessionA, date).analytics_identity).toBe(sessionA.key);
    expect(snapshots.loadSnapshot(sessionB, date).analytics_identity).toBe(sessionB.key);
    expect(snapshots.loadAllSnapshots(sessionA)).toHaveLength(1);
    expect(snapshots.loadAllSnapshots(sessionB)).toHaveLength(1);
    expect(fs.readdirSync(path.join(testDataDir, 'analytics'))).toHaveLength(2);
  });

  test('same-identity concurrent snapshot creation produces one isolated graph', async function () {
    const identity = createAnalyticsIdentity(req({ sessionId: 'concurrent' }), 'overview', { period: 'today' });
    const date = '2026-07-25';
    const results = await Promise.all([
      snapshots.getOrCompute(identity, date, [{ id: 'one' }]),
      snapshots.getOrCompute(identity, date, [{ id: 'different-loser' }, { id: 'different-loser-2' }])
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(snapshots._pendingSnapshots.size).toBe(0);
  });
});
