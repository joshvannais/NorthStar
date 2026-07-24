'use strict';

const assert = require('assert/strict');
const { chromium, webkit } = require('playwright');
const { app } = require('../../src/server');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

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

function monitor(page, label) {
  const failures = [];
  const expectedHttpRejections = [];
  page.on('pageerror', function (error) {
    failures.push('pageerror: ' + error.message);
  });
  page.on('console', function (message) {
    if (message.type() !== 'error') return;
    if (/^Failed to load resource: (?:the server responded with a status of (?:401|403|404|500)|net::ERR_CONNECTION_FAILED)/.test(message.text())) {
      expectedHttpRejections.push(message.text());
      return;
    }
    failures.push('console: ' + message.text());
  });
  return function assertClean() {
    assert.deepEqual(failures, [], label + ' emitted browser errors');
    return expectedHttpRejections.slice();
  };
}

async function setToken(context) {
  await context.addInitScript(function () {
    localStorage.setItem('token', 'browser-containment-token');
  });
}

async function exerciseLeadDetail(browser, baseUrl, label) {
  const context = await browser.newContext();
  await setToken(context);
  const page = await context.newPage();
  const assertClean = monitor(page, label + ' lead detail');
  const bootstrapRequests = [];

  await page.route('**/api/leads/**', async function (route) {
    const request = route.request();
    const url = new URL(request.url());
    bootstrapRequests.push({
      path: url.pathname,
      sessionId: url.searchParams.get('sessionId'),
      authorization: request.headers().authorization
    });
    const id = decodeURIComponent(url.pathname.split('/').pop());
    if (id === 'authorized-lead') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'authorized-lead',
          callerName: 'Authorized Customer',
          service: 'Electrical',
          phone: '(555) 010-0200',
          address: '10 Tenant Way',
          status: 'new',
          estimatedPrice: 725,
          summary: 'Authorized server record'
        })
      });
    }
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'not_found', message: 'Record not found.' } })
    });
  });

  await page.goto(baseUrl + '/dashboard/lead?id=authorized-lead', { waitUntil: 'networkidle' });
  await page.waitForFunction(function () {
    return window.__northstarLeadDetailState && window.__northstarLeadDetailState.status === 'ready';
  });
  assert.match(await page.locator('#leadDetailContainer').innerText(), /Authorized Customer/);
  assert.match(await page.locator('#leadDetailContainer').innerText(), /Authorized server record/);
  assert.notEqual((await page.locator('#leadDetailContainer').innerText()).trim(), '');
  assert.doesNotMatch(await page.locator('body').innerText(), /function bootstrap|window\.API|<\/script>/i);
  assert.equal(bootstrapRequests[0].authorization, 'Bearer browser-containment-token');
  assert.ok(bootstrapRequests[0].sessionId, label + ' lead bootstrap omitted active session');

  const safeStates = [];
  for (const id of ['wrong-session', 'unowned', 'missing']) {
    await page.goto(baseUrl + '/dashboard/lead?id=' + id, { waitUntil: 'networkidle' });
    await page.waitForFunction(function () {
      return window.__northstarLeadDetailState && window.__northstarLeadDetailState.status === 'not-found';
    });
    const text = (await page.locator('#leadDetailContainer').innerText()).trim();
    safeStates.push(text);
    assert.doesNotMatch(text, /Authorized Customer|stale customer|organization|owner/i);
    assert.notEqual(text, '');
  }
  assert.equal(new Set(safeStates).size, 1, label + ' lead rejection states disclosed identifier class');
  assertClean();
  await context.close();
}

async function exerciseCalendar(browser, baseUrl, label) {
  const context = await browser.newContext();
  await context.addInitScript(function () {
    localStorage.setItem('token', 'browser-containment-token');
    if (localStorage.getItem('calendarFixtureSeeded')) return;
    localStorage.setItem('calendarFixtureSeeded', 'true');
    sessionStorage.setItem('northstarSessionId', 'session-a');
    sessionStorage.setItem('northstarTabId', 'tab-a');
    window.name = 'northstarSessionId=session-a;northstarTabId=tab-a';
    const leads = [
      {
        id: 'same-session-cache',
        caller: 'Same Session Cached Event',
        outcome: 'appointment-set',
        avgPrice: 350,
        metadata: {
          recordScope: 'simulation',
          source: 'simulation',
          simulationSessionId: 'session-a'
        }
      },
      {
        id: 'wrong-session-cache',
        caller: 'Wrong Session Cached Event',
        outcome: 'appointment-set',
        metadata: {
          recordScope: 'simulation',
          source: 'simulation',
          simulationSessionId: 'session-b'
        }
      },
      {
        id: 'unowned-cache',
        caller: 'Unowned Cached Event',
        outcome: 'appointment-set'
      }
    ];
    sessionStorage.setItem('northstar_calls:session-a', JSON.stringify({
      version: 2,
      sessionId: 'session-a',
      leads
    }));
    sessionStorage.setItem('northstar_calls:session-old', JSON.stringify({
      version: 2,
      sessionId: 'session-old',
      leads: [{
        id: 'stale-cache',
        caller: 'Stale Cached Event',
        outcome: 'appointment-set',
        metadata: {
          recordScope: 'simulation',
          source: 'simulation',
          simulationSessionId: 'session-old'
        }
      }]
    }));
  });

  const page = await context.newPage();
  const assertClean = monitor(page, label + ' calendar');
  let calendarStatus = 200;
  let leadsMode = 'success';
  const calendarRequests = [];
  const leadsRequests = [];

  await page.route('**/api/leads', function (route) {
    leadsRequests.push(route.request().url());
    if (leadsMode === 'network') return route.abort('connectionfailed');
    if (leadsMode === 'malformed') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: { unexpected: true } })
      });
    }
    if (typeof leadsMode === 'number') {
      return route.fulfill({
        status: leadsMode,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'request_rejected' } })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], count: 0 })
    });
  });
  await page.route('**/api/v1/calendar/**', function (route) {
    const request = route.request();
    const url = new URL(request.url());
    calendarRequests.push({
      path: url.pathname,
      sessionId: url.searchParams.get('sessionId'),
      authorization: request.headers().authorization
    });
    if (url.pathname.endsWith('/export/ics')) {
      return route.fulfill({
        status: calendarStatus,
        contentType: calendarStatus === 200 ? 'text/calendar' : 'application/json',
        body: calendarStatus === 200 ? 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' : '{}'
      });
    }
    return route.fulfill({
      status: calendarStatus,
      contentType: 'application/json',
      body: calendarStatus === 200
        ? JSON.stringify({ events: [{
          id: 'server-authorized',
          title: 'Authorized Real Appointment',
          date: new Date().toISOString().slice(0, 10),
          time: '10:00 AM',
          type: 'appointment'
        }] })
        : JSON.stringify({ error: { code: 'request_rejected' } })
    });
  });

  await page.goto(baseUrl + '/dashboard/calendar', { waitUntil: 'networkidle' });
  await page.waitForFunction(function () {
    return window.calState && window.calState.serverState && window.calState.serverState.kind === 'ready';
  });
  let body = await page.locator('body').innerText();
  assert.match(body, /Authorized Real Appointment/);
  assert.match(body, /Same Session Cached Event/);
  assert.doesNotMatch(body, /Wrong Session Cached Event|Unowned Cached Event|Stale Cached Event/);
  assert.equal(await page.evaluate(function () {
    return sessionStorage.getItem('northstar_calls:session-old');
  }), null);
  assert.equal(calendarRequests[0].authorization, 'Bearer browser-containment-token');
  assert.equal(calendarRequests[0].sessionId, 'session-a');
  assert.ok(leadsRequests.length > 0, label + ' did not request authoritative leads');

  for (const mode of [401, 403, 404, 500, 'malformed', 'network']) {
    leadsMode = mode;
    await page.evaluate(function () { return window.refreshCalendar(); });
    await page.waitForFunction(function () {
      return window.calState && window.calState.serverState.kind === 'ready' &&
        window.calState.leadsState.kind !== 'loading';
    });
    body = await page.locator('body').innerText();
    assert.match(body, /Authorized Real Appointment/);
    assert.doesNotMatch(body, /Same Session Cached Event|Wrong Session Cached Event|Unowned Cached Event|Stale Cached Event/);
    assert.equal(await page.evaluate(function () {
      return window.calState.events.some(function (event) {
        return event.id === 'lead-same-session-cache';
      });
    }), false);
    assert.ok(await page.locator('[data-calendar-leads-state]').count(), label + ' hid leads source failure for ' + mode);
  }

  leadsMode = 'success';
  for (const status of [404, 401, 403, 500]) {
    calendarStatus = status;
    await page.evaluate(function () { return window.refreshCalendar(); });
    await page.waitForFunction(function (expected) {
      return window.calState && window.calState.serverState &&
        window.calState.serverState.status === expected;
    }, status);
    body = await page.locator('body').innerText();
    assert.doesNotMatch(body, /Authorized Real Appointment|Same Session Cached Event|Wrong Session Cached Event|Unowned Cached Event|Stale Cached Event/);
    assert.equal(await page.evaluate(function () { return window.calState.events.length; }), 0);
  }

  calendarStatus = 200;
  await page.evaluate(function () { return window.refreshCalendar(); });
  await page.evaluate(function () { return window.calData.exportICS(); });
  await page.waitForTimeout(50);
  assert.ok(calendarRequests.some(function (item) {
    return item.path.endsWith('/export/ics') && item.sessionId;
  }), label + ' ICS export omitted active session');

  const priorSession = await page.evaluate(function () { return window.NorthStarDemoSession.id; });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(function () {
    return window.calState && window.calState.serverState && window.calState.serverState.kind === 'ready';
  });
  const rotatedSession = await page.evaluate(function () { return window.NorthStarDemoSession.id; });
  assert.notEqual(rotatedSession, priorSession);
  body = await page.locator('body').innerText();
  assert.match(body, /Authorized Real Appointment/);
  assert.doesNotMatch(body, /Same Session Cached Event/);
  assert.equal(await page.evaluate(function (oldSession) {
    return sessionStorage.getItem('northstar_calls:' + oldSession);
  }, priorSession), null);
  assertClean();
  await context.close();
}

async function main() {
  const server = await new Promise(function (resolve, reject) {
    const listener = app.listen(0, '127.0.0.1', function () { resolve(listener); });
    listener.once('error', reject);
  });
  const address = server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;
  const results = [];

  try {
    const targets = [
      {
        label: 'installed-chrome',
        launch: function () { return chromium.launch({ headless: true, executablePath: chromePath }); }
      },
      {
        label: 'playwright-webkit',
        launch: function () { return webkit.launch({ headless: true }); }
      }
    ].filter(function (target) {
      return !process.env.NORTHSTAR_BROWSER_TARGET ||
        target.label === process.env.NORTHSTAR_BROWSER_TARGET;
    });

    for (const target of targets) {
      process.stderr.write(target.label + ': launching\n');
      const browser = await withTimeout(target.launch(), 60000, target.label + ' launch');
      try {
        process.stderr.write(target.label + ': lead-detail\n');
        await withTimeout(exerciseLeadDetail(browser, baseUrl, target.label), 120000, target.label + ' lead-detail');
        process.stderr.write(target.label + ': calendar\n');
        await withTimeout(exerciseCalendar(browser, baseUrl, target.label), 180000, target.label + ' calendar');
        results.push(target.label + ': PASS');
        process.stdout.write(target.label + ': PASS\n');
      } finally {
        await withTimeout(browser.close(), 30000, target.label + ' close');
      }
    }
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await withTimeout(new Promise(function (resolve) { server.close(resolve); }), 30000, 'server close');
  }

  if (!results.length) throw new Error('No browser target selected');
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
