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
    leads: [{
      id: 'same-session-cache',
      caller: 'Protected Cached Lead',
      status: 'scheduled',
      outcome: 'appointment-set',
      avgPrice: 600,
      metadata: {
        recordScope: 'simulation',
        source: 'simulation',
        simulationSessionId: 'session-a',
      },
    }],
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
    sharedDetail: store.getLead('same-session-cache'),
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
    items: [{
      id: 'server-owned',
      caller: 'Organization-owned Lead',
      status: 'new',
      avgPrice: 900,
    }],
  });
};

describe('shared AppStore authoritative lead gate', function () {
  test('defaults closed before the first authoritative request settles', function () {
    const pending = deferred();
    const harness = createHarness([function () { return pending.promise; }]);
    expectDeniedEverywhere(harness);
    pending.reject(new Error('test cleanup'));
  });

  test('a valid authorized response enables only server-owned and active-session records', async function () {
    const harness = createHarness([validResponse]);
    await harness.window.AppStore.loadFromServer();
    expect(consumerSnapshot(harness)).toEqual({
      shared: ['same-session-cache', 'server-owned'],
      sharedDetail: expect.objectContaining({ id: 'same-session-cache' }),
      sharedKpiTotal: 2,
      publicState: ['same-session-cache', 'server-owned'],
      analyticsTotal: 2,
      communications: ['same-session-cache', 'server-owned'],
      calendar: ['same-session-cache'],
    });
    expect(harness.sessionStorageValues.has('northstar_calls:session-old')).toBe(false);
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
    expect(consumerSnapshot(harness).shared).toEqual(['same-session-cache', 'server-owned']);
  });
});
