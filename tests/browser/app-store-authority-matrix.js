'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
let playwright;
try {
  playwright = require('playwright');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  playwright = require('playwright-core');
}
const { chromium, webkit } = playwright;
const { app } = require('../../src/server');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const appStoreCode = fs.readFileSync(path.join(__dirname, '../../public/js/app-store.js'), 'utf8');
const analyticsCode = fs.readFileSync(path.join(__dirname, '../../public/js/analytics-engine.js'), 'utf8');
const communicationsCode = fs.readFileSync(path.join(__dirname, '../../public/js/communications-engine.js'), 'utf8');
const apiCode = fs.readFileSync(path.join(__dirname, '../../public/js/api.js'), 'utf8');
const polarisApiCode = fs.readFileSync(path.join(__dirname, '../../public/js/polaris-api.js'), 'utf8');
const calendarCode = fs.readFileSync(path.join(__dirname, '../../public/js/calendar-engine.js'), 'utf8');
const calendarSyncCode = calendarCode.slice(
  calendarCode.indexOf('window.syncCalendarFromAppStore = function()'),
  calendarCode.indexOf('window.refreshCalendar = async function()')
);

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise(function (_resolve, reject) {
    timeoutId = setTimeout(function () {
      reject(new Error(label + ' timed out after ' + timeoutMs + 'ms'));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(function () {
    clearTimeout(timeoutId);
  });
}

function validItems(idPrefix) {
  const prefix = idPrefix || 'server';
  return [
    {
      id: prefix + '-owned',
      caller: 'Server Authorized Lead',
      status: 'new',
      avgPrice: 900,
    },
    {
      id: prefix + '-simulation',
      caller: 'Server Authorized Appointment',
      status: 'scheduled',
      outcome: 'appointment-set',
      avgPrice: 700,
      metadata: {
        source: 'simulation',
        recordScope: 'simulation',
        simulationSessionId: 'session-a',
      },
    },
  ];
}

function expectedDenied() {
  return {
    leads: [],
    detail: null,
    kpis: 0,
    state: [],
    analytics: 0,
    communications: [],
    calendar: [],
  };
}

async function installHarness(context, baseUrl, specs) {
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', function (error) {
    failures.push('pageerror: ' + error.message);
  });
  page.on('console', function (message) {
    if (message.type() === 'error') failures.push('console: ' + message.text());
  });
  await page.route('**/favicon.ico', function (route) {
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(baseUrl + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(function (responseSpecs) {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('token', 'authorized-token');
    localStorage.setItem('user', JSON.stringify({ id: 'owner-a', organizationId: 'org-a' }));
    localStorage.setItem('organization', 'org-a');
    window.NorthStarDemoSession = { id: 'session-a' };
    window.SIM_SESSION_ID = 'session-a';
    window.EventBus = {
      emit: function () {},
      on: function () {},
      off: function () {},
    };
    window.Models = {
      Lead: function Lead(data) { Object.assign(this, data); },
    };
    window.__authoritySpecs = responseSpecs.slice();
    window.__authorityDeferred = [];
    window.API = {
      getLeads: function () {
        if (!window.__authoritySpecs.length) {
          return Promise.reject(new Error('No authoritative fixture response remains'));
        }
        const spec = window.__authoritySpecs.shift();
        if (spec.type === 'valid') return Promise.resolve({ items: spec.items });
        if (spec.type === 'malformed') return Promise.resolve({ items: { invalid: true } });
        if (spec.type === 'deferred') {
          return new Promise(function (resolve, reject) {
            window.__authorityDeferred.push({ resolve: resolve, reject: reject });
          });
        }
        if (spec.type === 'pending') return new Promise(function () {});
        const error = new Error(spec.type === 'abort' ? 'aborted' : 'authoritative request rejected');
        if (spec.status !== undefined) error.status = spec.status;
        if (spec.type === 'abort') error.name = 'AbortError';
        if (spec.kind) error.kind = spec.kind;
        return Promise.reject(error);
      },
      createLead: function () { return Promise.resolve({ success: true }); },
      updateLead: function () { return Promise.resolve({ success: true }); },
      deleteLead: function () { return Promise.resolve({ success: true }); },
    };
    const injected = [
      {
        id: 'same-session-injected',
        caller: 'Injected Cached Lead',
        status: 'scheduled',
        outcome: 'appointment-set',
        createdAt: new Date().toISOString(),
        metadata: {
          source: 'simulation',
          recordScope: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-a',
          organizationId: 'org-a',
          authorizationGeneration: 1,
        },
      },
      { id: 'unowned', metadata: { source: 'simulation', simulationSessionId: 'session-a' } },
      {
        id: 'wrong-user',
        metadata: {
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-b',
          organizationId: 'org-a',
        },
      },
      {
        id: 'wrong-organization',
        metadata: {
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-a',
          organizationId: 'org-b',
        },
      },
      {
        id: 'wrong-session',
        metadata: {
          source: 'simulation',
          simulationSessionId: 'session-b',
          ownerUserId: 'owner-a',
          organizationId: 'org-a',
        },
      },
      {
        id: 'stale',
        createdAt: '2020-01-01T00:00:00.000Z',
        metadata: {
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-a',
          organizationId: 'org-a',
        },
      },
      {
        id: 'forged-provenance',
        metadata: {
          source: 'simulation',
          simulationSessionId: 'session-a',
          ownerUserId: 'owner-a',
          organizationId: 'org-a',
          authorizationGeneration: 999999,
        },
      },
    ];
    sessionStorage.setItem('northstar_calls:session-a', JSON.stringify({
      version: 2,
      sessionId: 'session-a',
      leads: injected,
    }));
    sessionStorage.setItem('northstar_calls:session-old', JSON.stringify({
      version: 2,
      sessionId: 'session-old',
      leads: [{
        id: 'prior-session',
        metadata: { source: 'simulation', simulationSessionId: 'session-old' },
      }],
    }));
  }, specs);
  await page.addScriptTag({ content: appStoreCode });
  await page.addScriptTag({ content: analyticsCode });
  await page.addScriptTag({ content: communicationsCode });
  await page.evaluate(function () {
    window.calState = {
      getLiveLeads: function () { return window.AppStore.getLeads(); },
      _formatDate: function () { return '2026-07-24'; },
    };
  });
  await page.addScriptTag({ content: calendarSyncCode });
  return {
    page,
    assertClean: function (label) {
      assert.deepEqual(failures, [], label + ' emitted browser errors');
    },
  };
}

async function snapshot(page, detailId) {
  return page.evaluate(function (id) {
    const store = window.AppStore;
    return {
      leads: store.getLeads().map(function (lead) { return lead.id; }).sort(),
      detail: store.getLead(id),
      kpis: store.getKpis().total,
      state: store.getState().leads.map(function (lead) { return lead.id; }).sort(),
      analytics: window.AnalyticsEngine.total(),
      communications: window.CommunicationsEngine.getConversations()
        .map(function (lead) { return lead.id; }).sort(),
      calendar: window.syncCalendarFromAppStore()
        .map(function (event) { return event.leadId; }).sort(),
    };
  }, detailId || 'same-session-injected');
}

async function waitForAuthoritativeSettlement(page) {
  await page.waitForFunction(function () {
    const state = window.AppStore && window.AppStore.getState();
    return state && state.authoritativeSources &&
      state.authoritativeSources.leads.kind !== 'loading';
  }, null, { timeout: 17000 });
}

async function runSimpleScenario(browser, baseUrl, label, spec, expectedState, detailId) {
  const context = await browser.newContext();
  let harness;
  try {
    harness = await installHarness(context, baseUrl, [spec]);
    await waitForAuthoritativeSettlement(harness.page);
    assert.deepEqual(await snapshot(harness.page, detailId), expectedState, label);
    harness.assertClean(label);
  } finally {
    await context.close();
  }
}

async function runMatrix(browser, baseUrl, label) {
  const serverItems = validItems();
  const expectedServer = {
    leads: ['server-owned', 'server-simulation'],
    detail: serverItems[0],
    kpis: 2,
    state: ['server-owned', 'server-simulation'],
    analytics: 2,
    communications: ['server-owned', 'server-simulation'],
    calendar: ['server-simulation'],
  };
  await runSimpleScenario(
    browser,
    baseUrl,
    label + ' valid authoritative response',
    { type: 'valid', items: serverItems },
    expectedServer,
    'server-owned'
  );

  for (const spec of [
    { label: 'malformed 200', type: 'malformed' },
    { label: '401', type: 'reject', status: 401 },
    { label: '403', type: 'reject', status: 403 },
    { label: '404', type: 'reject', status: 404 },
    { label: '409', type: 'reject', status: 409 },
    { label: '429', type: 'reject', status: 429 },
    { label: '500', type: 'reject', status: 500 },
    { label: 'network failure', type: 'reject' },
    { label: 'abort', type: 'abort' },
  ]) {
    await runSimpleScenario(
      browser,
      baseUrl,
      label + ' ' + spec.label,
      spec,
      expectedDenied()
    );
  }

  const timeoutContext = await browser.newContext();
  try {
    const timeoutHarness = await installHarness(timeoutContext, baseUrl, [{ type: 'pending' }]);
    await withTimeout(
      waitForAuthoritativeSettlement(timeoutHarness.page),
      17000,
      label + ' AppStore timeout'
    );
    assert.deepEqual(await snapshot(timeoutHarness.page), expectedDenied(), label + ' timeout');
    timeoutHarness.assertClean(label + ' timeout');
  } finally {
    await timeoutContext.close();
  }

  const runtimeContext = await browser.newContext();
  try {
    const harness = await installHarness(runtimeContext, baseUrl, [
      { type: 'valid', items: serverItems },
      { type: 'reject', status: 500 },
      { type: 'valid', items: validItems('recovered') },
    ]);
    await waitForAuthoritativeSettlement(harness.page);
    await harness.page.evaluate(function () {
      window.AppStore.addLead({
        id: 'current-runtime',
        caller: 'Current Runtime',
        status: 'scheduled',
        outcome: 'appointment-set',
        metadata: {
          source: 'simulation',
          recordScope: 'simulation',
          simulationSessionId: 'session-a',
        },
      });
    });
    assert.deepEqual((await snapshot(harness.page, 'current-runtime')).leads, [
      'current-runtime',
      'server-owned',
      'server-simulation',
    ]);
    assert.equal((await snapshot(harness.page, 'current-runtime')).detail.id, 'current-runtime');
    await harness.page.evaluate(function () { return window.AppStore.loadFromServer(); });
    assert.deepEqual(await snapshot(harness.page), expectedDenied(), label + ' rejection after success');
    await harness.page.evaluate(function () { return window.AppStore.loadFromServer(); });
    const recovered = await snapshot(harness.page, 'recovered-owned');
    assert.deepEqual(recovered.leads, ['recovered-owned', 'recovered-simulation']);
    assert.equal(recovered.detail.id, 'recovered-owned');
    assert.equal(recovered.kpis, 2);
    assert.deepEqual(recovered.calendar, ['recovered-simulation']);
    harness.assertClean(label + ' runtime/recovery');
  } finally {
    await runtimeContext.close();
  }

  for (const mutation of [
    {
      label: 'logout',
      apply: function () {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      },
    },
    {
      label: 'token rotation',
      apply: function () { localStorage.setItem('token', 'rotated-token'); },
    },
    {
      label: 'user rotation',
      apply: function () {
        localStorage.setItem('user', JSON.stringify({ id: 'owner-b', organizationId: 'org-a' }));
      },
    },
    {
      label: 'organization rotation',
      apply: function () {
        localStorage.setItem('organization', 'org-b');
        localStorage.setItem('user', JSON.stringify({ id: 'owner-a', organizationId: 'org-b' }));
      },
    },
    {
      label: 'session rotation',
      apply: function () {
        window.NorthStarDemoSession = { id: 'session-b' };
        window.SIM_SESSION_ID = 'session-b';
      },
    },
  ]) {
    const context = await browser.newContext();
    try {
      const harness = await installHarness(context, baseUrl, [{ type: 'deferred' }]);
      const pending = harness.page.evaluate(function () { return window.AppStore.loadFromServer(); });
      await harness.page.waitForFunction(function () { return window.__authorityDeferred.length === 1; });
      await harness.page.evaluate(mutation.apply);
      assert.deepEqual(await snapshot(harness.page), expectedDenied(), label + ' ' + mutation.label + ' before stale response');
      await harness.page.evaluate(function () {
        window.__authorityDeferred[0].resolve({ items: [{ id: 'stale-success' }] });
      });
      await pending;
      assert.deepEqual(await snapshot(harness.page), expectedDenied(), label + ' ' + mutation.label + ' stale response');
      harness.assertClean(label + ' ' + mutation.label);
    } finally {
      await context.close();
    }
  }

  for (const order of ['stale-success-after-denial', 'stale-rejection-after-success']) {
    const context = await browser.newContext();
    try {
      const harness = await installHarness(context, baseUrl, [
        { type: 'deferred' },
        { type: 'deferred' },
      ]);
      const older = harness.page.evaluate(function () { return window.AppStore.loadFromServer(); });
      await harness.page.waitForFunction(function () { return window.__authorityDeferred.length === 1; });
      await harness.page.evaluate(function () { localStorage.setItem('token', 'rotated-token'); });
      const newer = harness.page.evaluate(function () { return window.AppStore.loadFromServer(); });
      await harness.page.waitForFunction(function () { return window.__authorityDeferred.length === 2; });
      if (order === 'stale-success-after-denial') {
        await harness.page.evaluate(function () {
          const error = new Error('new context denied');
          error.status = 403;
          window.__authorityDeferred[1].reject(error);
        });
        await newer;
        await harness.page.evaluate(function () {
          window.__authorityDeferred[0].resolve({ items: [{ id: 'stale-success' }] });
        });
        await older;
        assert.deepEqual(await snapshot(harness.page), expectedDenied(), label + ' stale success');
      } else {
        await harness.page.evaluate(function () {
          window.__authorityDeferred[1].resolve({ items: [{ id: 'new-context-success' }] });
        });
        await newer;
        await harness.page.evaluate(function () {
          window.__authorityDeferred[0].reject(new Error('stale rejection'));
        });
        await older;
        const visible = await snapshot(harness.page, 'new-context-success');
        assert.deepEqual(visible.leads, ['new-context-success']);
        assert.equal(visible.detail.id, 'new-context-success');
      }
      harness.assertClean(label + ' ' + order);
    } finally {
      await context.close();
    }
  }
}

async function runClientErrorCompatibility(browser, baseUrl, label) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const failures = [];
    page.on('pageerror', function (error) {
      failures.push('pageerror: ' + error.message);
    });
    page.on('console', function (message) {
      if (message.type() !== 'error') return;
      if (/^Failed to load resource: the server responded with a status of (?:400|401|403|404|409|422|429|500|503)/.test(message.text())) {
        return;
      }
      failures.push('console: ' + message.text());
    });
    await page.route('**/favicon.ico', function (route) {
      return route.fulfill({ status: 204, body: '' });
    });
    await page.route('**/api/compatibility-error**', function (route) {
      const url = new URL(route.request().url());
      const status = Number(url.searchParams.get('status'));
      const requestId = '123e4567-e89b-42d3-a456-426614174000';
      return route.fulfill({
        status: status,
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': requestId,
        },
        body: JSON.stringify({
          error: 'Safe compatibility message ' + status + '.',
          code: 'fixture_' + status,
          requestId: requestId,
        }),
      });
    });
    await page.route('**/api/v1/customers**', function (route) {
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'You do not have permission to perform this action.',
          code: 'forbidden',
          requestId: '123e4567-e89b-42d3-a456-426614174001',
        }),
      });
    });
    await page.goto(baseUrl + '/login', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: apiCode });
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 503]) {
      const observed = await page.evaluate(async function (statusCode) {
        try {
          await window.API.request('GET', '/compatibility-error?status=' + statusCode);
          return null;
        } catch (error) {
          return {
            message: error.message,
            code: error.code,
            requestId: error.requestId,
            status: error.status,
          };
        }
      }, status);
      assert.deepEqual(observed, {
        message: 'Safe compatibility message ' + status + '.',
        code: 'fixture_' + status,
        requestId: '123e4567-e89b-42d3-a456-426614174000',
        status: status,
      }, label + ' shared API client status ' + status);
      assert.doesNotMatch(observed.message, /\[object Object\]/);
    }
    await page.evaluate(function () {
      window.NorthStarDemoSession = {
        appendToUrl: function (url) { return url; },
      };
    });
    await page.addScriptTag({ content: polarisApiCode });
    const polarisMessage = await page.evaluate(async function () {
      try {
        await window.PolarisApi.getCustomers();
        return null;
      } catch (error) {
        return error.message;
      }
    });
    assert.equal(polarisMessage, 'You do not have permission to perform this action.');
    assert.doesNotMatch(polarisMessage, /\[object Object\]/);
    assert.deepEqual(failures, [], label + ' error compatibility emitted browser errors');
  } finally {
    await context.close();
  }
}

async function main() {
  const server = await new Promise(function (resolve, reject) {
    const listener = app.listen(0, '127.0.0.1', function () { resolve(listener); });
    listener.once('error', reject);
  });
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  try {
    const targets = [
      {
        label: 'installed-chrome',
        launch: function () {
          return chromium.launch({ headless: true, executablePath: chromePath });
        },
      },
      {
        label: 'playwright-webkit',
        launch: function () { return webkit.launch({ headless: true }); },
      },
    ].filter(function (target) {
      return !process.env.NORTHSTAR_BROWSER_TARGET ||
        target.label === process.env.NORTHSTAR_BROWSER_TARGET;
    });
    if (!targets.length) throw new Error('No browser target selected');
    for (const target of targets) {
      process.stderr.write(target.label + ': launching authority matrix\n');
      const browser = await withTimeout(target.launch(), 60000, target.label + ' launch');
      try {
        await withTimeout(
          runClientErrorCompatibility(browser, baseUrl, target.label),
          60000,
          target.label + ' error compatibility'
        );
        await withTimeout(
          runMatrix(browser, baseUrl, target.label),
          300000,
          target.label + ' authority matrix'
        );
        process.stdout.write(target.label + ': PASS\n');
      } finally {
        await withTimeout(browser.close(), 30000, target.label + ' close');
      }
    }
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await withTimeout(new Promise(function (resolve) {
      server.close(resolve);
    }), 30000, 'server close');
  }
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
