'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const appStoreCode = fs.readFileSync(
  path.join(__dirname, '../../public/js/app-store.js'),
  'utf8'
);
const analyticsCode = fs.readFileSync(
  path.join(__dirname, '../../public/js/analytics-engine.js'),
  'utf8'
);
const communicationsCode = fs.readFileSync(
  path.join(__dirname, '../../public/js/communications-engine.js'),
  'utf8'
);
const calendarCode = fs.readFileSync(
  path.join(__dirname, '../../public/js/calendar-engine.js'),
  'utf8'
);
const calendarSyncCode = calendarCode.slice(
  calendarCode.indexOf('window.syncCalendarFromAppStore = function()'),
  calendarCode.indexOf('window.refreshCalendar = async function()')
);
const businessModelsCode = fs.readFileSync(
  path.join(__dirname, '../../public/js/business-models.js'),
  'utf8'
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise(function (resolvePromise, rejectPromise) {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function rejection(status, kind) {
  const error = new Error(kind || 'authoritative request rejected');
  if (status !== undefined) error.status = status;
  if (kind) error.kind = kind;
  return function () { return Promise.reject(error); };
}

function createHarness(responses) {
  const sessionStorageValues = new Map();
  const localStorageValues = new Map([
    ['token', 'authorized-token'],
    ['user', JSON.stringify({ id: 'owner-a', organizationId: 'org-a' })],
  ]);
  sessionStorageValues.set('northstar_calls:session-a', JSON.stringify({
    version: 2,
    sessionId: 'session-a',
    leads: [
      {
        id: 'same-session-injected',
        caller: 'Injected Cached Lead',
        status: 'scheduled',
        avgPrice: 600,
        metadata: {
          recordScope: 'simulation',
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-a',
          organizationId: 'org-a',
        },
      },
      {
        id: 'unowned-cache',
        metadata: { source: 'simulation', simulationSessionId: 'session-a' },
      },
      {
        id: 'wrong-user-cache',
        metadata: {
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-b',
          organizationId: 'org-a',
        },
      },
      {
        id: 'wrong-organization-cache',
        metadata: {
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-a',
          organizationId: 'org-b',
        },
      },
      {
        id: 'stale-cache',
        createdAt: '2020-01-01T00:00:00.000Z',
        metadata: {
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-a',
          organizationId: 'org-a',
        },
      },
      {
        id: 'pre-auth-cache',
        metadata: {
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-a',
          organizationId: 'org-a',
          authorizationGeneration: 999,
        },
      },
    ],
  }));
  sessionStorageValues.set('northstar_calls:session-old', JSON.stringify({
    version: 2,
    sessionId: 'session-old',
    leads: [{
      id: 'old-session-cache',
      metadata: {
        recordScope: 'simulation',
        source: 'simulation',
        simulationSessionId: 'session-old',
      },
    }],
  }));

  const responseQueue = responses.slice();
  const bus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
  const window = {
    EventBus: bus,
    NorthStarDemoSession: { id: 'session-a' },
    SIM_SESSION_ID: 'session-a',
    Models: {
      Lead: function (data) { Object.assign(this, data); },
    },
  };
  const document = {
    readyState: 'loading',
    addEventListener: jest.fn(),
  };
  const context = {
    window,
    document,
    sessionStorage: {
      get length() { return sessionStorageValues.size; },
      key: function (index) { return Array.from(sessionStorageValues.keys())[index] || null; },
      getItem: function (key) {
        return sessionStorageValues.has(key) ? sessionStorageValues.get(key) : null;
      },
      setItem: function (key, value) { sessionStorageValues.set(key, value); },
      removeItem: function (key) { sessionStorageValues.delete(key); },
    },
    localStorage: {
      getItem: function (key) {
        return localStorageValues.has(key) ? localStorageValues.get(key) : null;
      },
      setItem: function (key, value) { localStorageValues.set(key, value); },
      removeItem: function (key) { localStorageValues.delete(key); },
    },
    API: {
      getLeads: jest.fn(function () {
        if (!responseQueue.length) throw new Error('No authoritative fixture response remains');
        return responseQueue.shift()();
      }),
      createLead: jest.fn(function () { return Promise.resolve({ success: true }); }),
      updateLead: jest.fn(function () { return Promise.resolve({ success: true }); }),
      deleteLead: jest.fn(function () { return Promise.resolve({ success: true }); }),
    },
    Map,
    Set,
    Date,
    Math,
    Object,
    Array,
    Promise,
    JSON,
    String,
    Boolean,
    parseFloat,
    isNaN,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.runInNewContext(appStoreCode, context);
  context.AppStore = window.AppStore;
  vm.runInNewContext(analyticsCode, context);
  vm.runInNewContext(communicationsCode, context);
  vm.runInNewContext(calendarSyncCode, Object.assign({}, context, {
    calState: {
      getLiveLeads: function () { return window.AppStore.getLeads(); },
      _formatDate: function () { return '2026-07-24'; },
    },
  }));
  return {
    window,
    context,
    localStorageValues,
    sessionStorageValues,
  };
}

function consumerSnapshot(harness) {
  const store = harness.window.AppStore;
  return {
    shared: store.getLeads().map(function (lead) { return lead.id; }).sort(),
    sharedDetail: store.getLead('same-session-injected'),
    sharedKpiTotal: store.getKpis().total,
    publicState: store.getState().leads.map(function (lead) { return lead.id; }).sort(),
    analyticsTotal: harness.window.AnalyticsEngine.total(),
    communications: harness.window.CommunicationsEngine.getConversations()
      .map(function (lead) { return lead.id; }).sort(),
    calendar: harness.window.syncCalendarFromAppStore()
      .map(function (event) { return event.leadId; }).sort(),
  };
}

function expectDeniedEverywhere(harness) {
  expect(consumerSnapshot(harness)).toEqual({
    shared: [],
    sharedDetail: null,
    sharedKpiTotal: 0,
    publicState: [],
    analyticsTotal: 0,
    communications: [],
    calendar: [],
  });
}

const validResponse = function () {
  return Promise.resolve({
    items: [
      {
        id: 'server-owned',
        caller: 'Organization-owned Lead',
        status: 'new',
        avgPrice: 900,
      },
      {
        id: 'server-simulation',
        caller: 'Server-authorized Simulation',
        status: 'scheduled',
        outcome: 'appointment-set',
        avgPrice: 700,
        metadata: {
          source: 'simulation',
          recordScope: 'simulation',
          simulationSessionId: 'session-a',
        },
      },
    ],
  });
};

describe('shared AppStore authoritative lead gate', function () {
  test('defaults closed before the first authoritative request settles', function () {
    const pending = deferred();
    const harness = createHarness([function () { return pending.promise; }]);
    expectDeniedEverywhere(harness);
    pending.reject(new Error('test cleanup'));
  });

  test('a valid response authorizes only server-returned records and current-runtime additions', async function () {
    const harness = createHarness([validResponse]);
    await harness.window.AppStore.loadFromServer();
    expect(consumerSnapshot(harness)).toEqual({
      shared: ['server-owned', 'server-simulation'],
      sharedDetail: null,
      sharedKpiTotal: 2,
      publicState: ['server-owned', 'server-simulation'],
      analyticsTotal: 2,
      communications: ['server-owned', 'server-simulation'],
      calendar: ['server-simulation'],
    });
    harness.window.AppStore.addLead({
      id: 'current-runtime-local',
      caller: 'Current Runtime Local',
      status: 'scheduled',
      outcome: 'appointment-set',
      metadata: {
        source: 'simulation',
        recordScope: 'simulation',
        simulationSessionId: 'session-a',
      },
    });
    expect(consumerSnapshot(harness)).toMatchObject({
      shared: ['current-runtime-local', 'server-owned', 'server-simulation'],
      sharedKpiTotal: 3,
      publicState: ['current-runtime-local', 'server-owned', 'server-simulation'],
      analyticsTotal: 3,
      communications: ['current-runtime-local', 'server-owned', 'server-simulation'],
      calendar: ['current-runtime-local', 'server-simulation'],
    });
    expect(harness.sessionStorageValues.has('northstar_calls:session-old')).toBe(false);

    harness.window.AppStore.addLead({
      id: 'wrong-session-runtime',
      metadata: {
        source: 'simulation',
        recordScope: 'simulation',
        simulationSessionId: 'session-b',
      },
    });
    harness.window.AppStore.addLead({
      id: 'non-simulation-runtime',
      status: 'new',
    });
    expect(consumerSnapshot(harness).shared).not.toContain('wrong-session-runtime');
    expect(consumerSnapshot(harness).shared).not.toContain('non-simulation-runtime');
  });

  test('server payload wins an authorized-ID collision across every AppStore consumer', async function () {
    const serverLead = {
      id: 'collision-id',
      caller: 'Server Authorized',
      status: 'completed',
      outcome: 'appointment-set',
      avgPrice: 900,
      metadata: { source: 'server' },
    };
    const harness = createHarness([function () {
      return Promise.resolve({ items: [serverLead] });
    }]);
    await harness.window.AppStore.loadFromServer();

    const returned = harness.window.AppStore.addLead({
      id: 'collision-id',
      caller: 'Forged Browser Lead',
      status: 'completed',
      outcome: 'appointment-set',
      avgPrice: 999999,
      metadata: {
        source: 'simulation',
        recordScope: 'simulation',
        simulationSessionId: 'session-a',
        ownerUserId: 'owner-a',
        organizationId: 'org-a',
        authorizationGeneration: 999999,
      },
    });

    expect(returned).toEqual(serverLead);
    expect(harness.context.API.createLead).not.toHaveBeenCalled();
    expect(harness.window.AppStore.getLeads()).toEqual([serverLead]);
    expect(harness.window.AppStore.getLead('collision-id')).toEqual(serverLead);
    expect(harness.window.AppStore.getKpis()).toMatchObject({
      total: 1,
      revenue: 900,
      avgLeadValue: 900,
      topOpportunity: serverLead,
    });
    expect(harness.window.AppStore.getState().leads).toEqual([serverLead]);
    expect(harness.window.AnalyticsEngine.total()).toBe(1);
    expect(harness.window.CommunicationsEngine.getConversations()).toEqual([serverLead]);
    expect(harness.window.syncCalendarFromAppStore().map(function (event) {
      return event.leadId;
    })).toEqual([]);

    harness.localStorageValues.set('northstar_calls:session-a', JSON.stringify({
      leads: [{ id: 'collision-id', avgPrice: 999999999 }],
    }));
    expect(harness.window.AppStore.getLead('collision-id')).toEqual(serverLead);
    expect(harness.window.AppStore.getKpis().avgLeadValue).toBe(900);
  });

  test('conflicting duplicate IDs in one server response default deny', async function () {
    const harness = createHarness([function () {
      return Promise.resolve({
        items: [
          { id: 'duplicate-id', caller: 'First Server Value', avgPrice: 900 },
          { id: 'duplicate-id', caller: 'Conflicting Server Value', avgPrice: 1200 },
        ],
      });
    }]);
    await harness.window.AppStore.loadFromServer();
    expectDeniedEverywhere(harness);
    expect(harness.window.AppStore.addLead({
      id: 'duplicate-id',
      metadata: {
        source: 'simulation',
        recordScope: 'simulation',
        simulationSessionId: 'session-a',
      },
    })).toBeNull();
    expectDeniedEverywhere(harness);
  });

  test('raw session cache accessors are not part of the public AppStore API', function () {
    const pending = deferred();
    const harness = createHarness([function () { return pending.promise; }]);
    expect(harness.window.AppStore.loadFromSession).toBeUndefined();
    expect(harness.window.AppStore.saveToSession).toBeUndefined();
    pending.reject(new Error('test cleanup'));
  });

  test('the production Lead model retains only the provenance AppStore needs to validate runtime simulations', async function () {
    const harness = createHarness([validResponse]);
    vm.runInNewContext(businessModelsCode, harness.context);
    await harness.window.AppStore.loadFromServer();
    harness.window.AppStore.addLead({
      id: 'real-model-runtime',
      source: 'simulation',
      recordScope: 'simulation',
      simulationSessionId: 'session-a',
      outcome: 'appointment-set',
      metadata: {
        source: 'simulation',
        recordScope: 'simulation',
        simulationSessionId: 'session-a',
      },
    });
    expect(consumerSnapshot(harness).shared).toContain('real-model-runtime');
    expect(harness.window.AppStore.getLead('real-model-runtime')).toMatchObject({
      recordScope: 'simulation',
      simulationSessionId: 'session-a',
      metadata: {
        recordScope: 'simulation',
        simulationSessionId: 'session-a',
      },
    });
  });

  test.each([
    ['200 malformed', function () { return Promise.resolve({ items: { invalid: true } }); }],
    ['401', rejection(401)],
    ['403', rejection(403)],
    ['404', rejection(404)],
    ['409', rejection(409)],
    ['429', rejection(429)],
    ['500', rejection(500)],
    ['network failure', rejection(undefined)],
    ['request abort', function () {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    }],
  ])('%s denies the shared accessor and every consumer', async function (_label, response) {
    const harness = createHarness([response]);
    await harness.window.AppStore.loadFromServer();
    expectDeniedEverywhere(harness);
  });

  test('a request timeout remains fail-closed even if no network promise settles', async function () {
    jest.useFakeTimers();
    try {
      const pending = deferred();
      const harness = createHarness([function () { return pending.promise; }]);
      const request = harness.window.AppStore.loadFromServer();
      await jest.advanceTimersByTimeAsync(15001);
      await request;
      expectDeniedEverywhere(harness);
    } finally {
      jest.useRealTimers();
    }
  });

  test.each([
    ['session rotation', function (harness) {
      harness.window.NorthStarDemoSession = { id: 'session-b' };
      harness.window.SIM_SESSION_ID = 'session-b';
    }],
    ['logout', function (harness) {
      harness.localStorageValues.delete('token');
      harness.localStorageValues.delete('user');
    }],
    ['user change', function (harness) {
      harness.localStorageValues.set('user', JSON.stringify({ id: 'owner-b', organizationId: 'org-a' }));
    }],
    ['organization change', function (harness) {
      harness.localStorageValues.set('user', JSON.stringify({ id: 'owner-a', organizationId: 'org-b' }));
    }],
  ])('%s during an in-flight request cannot authorize stale results', async function (_label, mutate) {
    const pending = deferred();
    const harness = createHarness([function () { return pending.promise; }]);
    const request = harness.window.AppStore.loadFromServer();
    mutate(harness);
    expectDeniedEverywhere(harness);
    pending.resolve({ items: [{ id: 'stale-server-result' }] });
    await request;
    expectDeniedEverywhere(harness);
  });

  test('an earlier success followed by rejection revokes every consumer immediately', async function () {
    const harness = createHarness([validResponse, rejection(500)]);
    await harness.window.AppStore.loadFromServer();
    expect(harness.window.AppStore.getLeads()).toHaveLength(2);
    const rejected = harness.window.AppStore.loadFromServer();
    expectDeniedEverywhere(harness);
    await rejected;
    expectDeniedEverywhere(harness);
  });

  test('an earlier rejection followed by legitimate success enables the current context', async function () {
    const harness = createHarness([rejection(403), validResponse]);
    await harness.window.AppStore.loadFromServer();
    expectDeniedEverywhere(harness);
    await harness.window.AppStore.loadFromServer();
    expect(consumerSnapshot(harness).shared).toEqual(['server-owned', 'server-simulation']);
  });

  test('a local record from an older authoritative generation is not reauthorized', async function () {
    const harness = createHarness([validResponse, validResponse]);
    await harness.window.AppStore.loadFromServer();
    harness.window.AppStore.addLead({
      id: 'older-generation-local',
      metadata: { source: 'simulation', simulationSessionId: 'session-a' },
    });
    expect(consumerSnapshot(harness).shared).toContain('older-generation-local');
    const refresh = harness.window.AppStore.loadFromServer();
    expectDeniedEverywhere(harness);
    await refresh;
    expect(consumerSnapshot(harness).shared).toEqual(['server-owned', 'server-simulation']);
  });

  test('logout prevents later local creation and stale success from reopening access', async function () {
    const stale = deferred();
    const harness = createHarness([function () { return stale.promise; }]);
    harness.localStorageValues.delete('token');
    harness.localStorageValues.delete('user');
    harness.window.AppStore.addLead({
      id: 'after-logout',
      metadata: { source: 'simulation', simulationSessionId: 'session-a' },
    });
    stale.resolve({ items: [{ id: 'stale-success' }] });
    await harness.window.AppStore.loadFromServer();
    expectDeniedEverywhere(harness);
  });

  test('a stale success cannot override a newer rejection completed out of order', async function () {
    const older = deferred();
    const newer = deferred();
    const harness = createHarness([
      function () { return older.promise; },
      function () { return newer.promise; },
    ]);
    const olderRequest = harness.window.AppStore.loadFromServer();
    harness.localStorageValues.set('token', 'rotated-token');
    const newerRequest = harness.window.AppStore.loadFromServer();
    const denied = new Error('newer request denied');
    denied.status = 403;
    newer.reject(denied);
    await newerRequest;
    older.resolve({ items: [{ id: 'stale-success' }] });
    await olderRequest;
    expectDeniedEverywhere(harness);
  });

  test('a stale rejection cannot override a newer legitimate success completed out of order', async function () {
    const older = deferred();
    const newer = deferred();
    const harness = createHarness([
      function () { return older.promise; },
      function () { return newer.promise; },
    ]);
    const olderRequest = harness.window.AppStore.loadFromServer();
    harness.localStorageValues.set('token', 'rotated-token');
    const newerRequest = harness.window.AppStore.loadFromServer();
    newer.resolve({ items: [{ id: 'new-context-server' }] });
    await newerRequest;
    older.reject(new Error('stale rejection'));
    await olderRequest;
    expect(consumerSnapshot(harness).shared).toEqual(['new-context-server']);
  });
});
