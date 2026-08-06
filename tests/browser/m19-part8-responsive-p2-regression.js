'use strict';

const assert = require('assert');
const { navigationFixture } = require('../helpers/navigation-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

[
  'DATABASE_URL', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
  'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
].forEach(name => { delete process.env[name]; });

const { app } = require('../../src/server');

const VIEWPORTS = Object.freeze([
  Object.freeze({ label: '768x1024', width: 768, height: 1024 }),
  Object.freeze({ label: '1024x768', width: 1024, height: 768 }),
  Object.freeze({ label: '844x390', width: 844, height: 390 }),
]);
const THEMES = Object.freeze(['light', 'dark']);
const MODES = Object.freeze(['fresh', 'reload']);
const ASYNC_SURFACES = Object.freeze([
  Object.freeze({
    label: 'communications',
    route: '/dashboard/communications',
    gatedApi: '/api/v1/canonical/compat/communications',
  }),
  Object.freeze({
    label: 'calendar',
    route: '/dashboard/calendar',
    gatedApi: '/api/v1/canonical/compat/calendar',
  }),
]);

function json(body, status = 200) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function accountFixture() {
  const membership = {
    id: '00000000-0000-4000-8000-000000000803',
    role: 'owner',
    status: 'active',
  };
  return {
    user: {
      id: '00000000-0000-4000-8000-000000000801',
      status: 'active',
      email: 'part8-owner@example.test',
    },
    organization: {
      id: '00000000-0000-4000-8000-000000000802',
      name: 'NorthStar Part 8 Regression',
    },
    membership,
    memberships: [membership],
    navigation: navigationFixture(),
    onboarding: { status: 'complete' },
    subscription: {
      safe: true,
      state: 'active',
      readOnly: false,
      showTrialBanner: false,
    },
  };
}

function canonicalProjection(surface, request, records = []) {
  return {
    success: true,
    data: {
      surface,
      readModelVersion: 'm19-part3-read-v1',
      digest: '8'.repeat(64),
      items: [],
      records,
      metrics: {
        graphCount: 0,
        appointmentCount: records.length,
        estimatedRevenue: 0,
        knownGrossProfit: 0,
        outstandingRevenue: 0,
        activeDeals: 0,
        pendingEstimates: 0,
      },
      authority: {
        userId: accountFixture().user.id,
        organizationId: accountFixture().organization.id,
        sessionId: request.headers()['x-northstar-session-id'] || 'm19-part8-browser-session',
      },
    },
  };
}

function calendarAppointment(title, id) {
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setHours(11, 0, 0, 0);
  return {
    id,
    scheduledStart: start.toISOString(),
    scheduledEnd: end.toISOString(),
    status: 'scheduled',
    customer: {
      id: `customer-${id}`,
      name: title,
      phone: '+15555550189',
      address: '189 Authority Way',
    },
    canonical: null,
  };
}

function calendarScenarioResponse(scenario, request) {
  if (scenario.phase === 'http503') {
    return json({ success: false, error: { code: 'calendar_unavailable', message: 'Calendar unavailable.' } }, 503);
  }
  if (scenario.phase === 'malformed') {
    const malformed = canonicalProjection('calendar', request, [calendarAppointment(
      scenario.initialTitle,
      '00000000-0000-4000-8000-000000000891',
    )]);
    malformed.data.digest = 'malformed-digest';
    return json(malformed);
  }
  const recovered = scenario.phase === 'recovery';
  return json(canonicalProjection('calendar', request, [calendarAppointment(
    recovered ? scenario.recoveryTitle : scenario.initialTitle,
    recovered ? '00000000-0000-4000-8000-000000000892' : '00000000-0000-4000-8000-000000000891',
  )]));
}

function createGate(pathname) {
  let release;
  let firstRequest;
  let requested = 0;
  const released = new Promise(resolve => { release = resolve; });
  const observed = new Promise(resolve => { firstRequest = resolve; });
  return {
    pathname,
    async hold() {
      requested += 1;
      firstRequest();
      await released;
    },
    async waitForRequest() {
      let timer;
      try {
        await Promise.race([
          observed,
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`gated request did not start: ${pathname}`)), 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      assert.ok(requested >= 1, `at least one request held for ${pathname}`);
    },
    release() { release(); },
    get requested() { return requested; },
  };
}

async function installInstrumentation(context, theme) {
  await context.addInitScript(selectedTheme => {
    localStorage.setItem('northstar-theme', selectedTheme);
    const supported = typeof PerformanceObserver === 'function'
      && Array.isArray(PerformanceObserver.supportedEntryTypes)
      && PerformanceObserver.supportedEntryTypes.includes('layout-shift');
    window.__m19Part8Layout = { supported, value: 0, entries: [] };
    if (!supported) return;
    const observer = new PerformanceObserver(list => {
      list.getEntries().forEach(entry => {
        if (entry.hadRecentInput) return;
        window.__m19Part8Layout.value += entry.value;
        window.__m19Part8Layout.entries.push({
          value: entry.value,
          startTime: entry.startTime,
          sources: Array.from(entry.sources || []).map(source => ({
            node: source.node ? `${source.node.tagName || ''}#${source.node.id || ''}.${source.node.className || ''}` : null,
            previousRect: source.previousRect,
            currentRect: source.currentRect,
          })),
        });
      });
    });
    observer.observe({ type: 'layout-shift', buffered: true });
    window.__m19Part8Layout.observer = observer;
  }, theme);
}

async function installBoundaries(context, origin, evidence, activeGate, calendarScenario) {
  context.on('request', request => {
    let url;
    try { url = new URL(request.url()); } catch (_error) { return; }
    if (!['http:', 'https:'].includes(url.protocol)) return;
    assert.strictEqual(url.origin, origin, `request escaped loopback: ${request.method()} ${request.url()}`);
    evidence.requests.push({ method: request.method(), path: url.pathname, type: request.resourceType() });
  });

  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.strictEqual(url.origin, origin, `API request escaped loopback: ${request.url()}`);
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(request.method()), `unexpected mutation ${request.method()} ${url.pathname}`);
    evidence.api.push({ method: request.method(), path: url.pathname });

    const gate = activeGate.current;
    if (gate && request.method() === 'GET' && url.pathname === gate.pathname) await gate.hold();

    if (url.pathname === '/api/auth/me') return route.fulfill(json({ account: accountFixture() }));
    if (url.pathname === '/api/account/subscription') {
      return route.fulfill(json({ subscription: accountFixture().subscription }));
    }
    if (url.pathname === '/api/account/preferences') return route.fulfill(json({ preferences: {} }));
    if (url.pathname === '/api/integrations/jobber/status') {
      return route.fulfill(json({ available: false, configured: false, connected: false }));
    }
    if (url.pathname === '/api/events') return route.fulfill(json([]));
    if (url.pathname === '/api/leads') return route.fulfill(json({ items: [], records: [] }));
    if (url.pathname === '/api/v1/business-profile') {
      return route.fulfill(json({ success: true, data: null }));
    }
    if (url.pathname.includes('/api/v1/canonical/compat/')) {
      if (calendarScenario && url.pathname === '/api/v1/canonical/compat/calendar') {
        return route.fulfill(calendarScenarioResponse(calendarScenario, request));
      }
      return route.fulfill(json(canonicalProjection(url.pathname.split('/').pop(), request)));
    }
    if (url.pathname === '/api/health') {
      return route.fulfill(json({ status: 'ok', database: 'healthy', canonicalPersistence: 'healthy' }));
    }
    return route.fulfill(json({ success: true, data: {}, items: [], records: [] }));
  });
}

function addFailure(failures, condition, message, actual) {
  if (!condition) failures.push(actual === undefined ? message : `${message}: ${JSON.stringify(actual)}`);
}

async function readAsyncState(page, surface) {
  return page.evaluate(label => {
    function rect(selector) {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, left: box.left, width: box.width, height: box.height };
    }
    if (label === 'communications') {
      return {
        layout: window.__m19Part8Layout,
        gridBusy: document.getElementById('kpiGrid')?.getAttribute('aria-busy') || null,
        listBusy: document.getElementById('callHistoryList')?.getAttribute('aria-busy') || null,
        cards: document.querySelectorAll('#kpiGrid .ds-kpi-card').length,
        loadingHeading: document.querySelector('#callHistoryList .communications-loading-state h3')?.textContent.trim() || '',
        emptyHeading: document.querySelector('#callHistoryList .empty-state h3')?.textContent.trim() || '',
        anchors: {
          kpi: rect('#widget-kpi-grid'),
          polaris: rect('#polarisCard'),
          filters: rect('.filter-bar'),
          history: rect('#callHistoryList'),
        },
      };
    }
    return {
      layout: window.__m19Part8Layout,
      layoutBusy: document.querySelector('.cal-layout')?.getAttribute('aria-busy') || null,
      title: document.querySelector('#calendarHeader .cal-title')?.textContent.trim() || '',
      monthGrid: document.querySelectorAll('#calendarGrid .cal-month-grid').length,
      eventText: document.getElementById('calendarEventList')?.textContent.trim() || '',
      anchors: {
        header: rect('#calendarHeader'),
        kpis: rect('#calendarKpiBar'),
        grid: rect('#calendarGrid'),
        events: rect('#calendarEventList'),
        newEvent: rect('#calendarNewEventArea'),
        polaris: rect('#calendarPolaris'),
      },
    };
  }, surface.label);
}

function maxAnchorShift(before, after) {
  return Math.max(...Object.keys(before).map(key => {
    if (!before[key] || !after[key]) return Number.POSITIVE_INFINITY;
    return Math.abs(after[key].top - before[key].top);
  }));
}

function selectedAnchorShift(before, after, keys) {
  return Math.max(...keys.map(key => {
    if (!before[key] || !after[key]) return Number.POSITIVE_INFINITY;
    return Math.abs(after[key].top - before[key].top);
  }));
}

async function resetLayoutEvidence(page) {
  await page.evaluate(() => {
    if (!window.__m19Part8Layout) return;
    window.__m19Part8Layout.value = 0;
    window.__m19Part8Layout.entries = [];
  });
}

async function readCalendarAuthorityState(page) {
  return page.evaluate(() => {
    function rect(selector) {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, left: box.left, width: box.width, height: box.height };
    }
    const layout = window.__m19Part8Layout || { supported: false, value: 0, entries: [] };
    return {
      authority: document.documentElement.dataset.canonicalAuthority || null,
      layoutBusy: document.querySelector('.cal-layout')?.getAttribute('aria-busy') || null,
      stateTitles: Array.from(window.calState?.events || []).map(event => event.title),
      apiTitles: Array.from(window.calendarApiEvents || []).map(event => event.title),
      leadTitles: Array.from(window.calendarLeadEvents || []).map(event => event.title),
      itemCount: document.querySelectorAll('.cal-event-list-item').length,
      itemTitles: Array.from(document.querySelectorAll('.cal-event-list-title')).map(element => element.textContent.trim()),
      eventText: document.getElementById('calendarEventList')?.textContent.trim() || '',
      errorRole: document.querySelector('#calendarEventList .cal-event-list-empty')?.getAttribute('role') || null,
      bodyText: document.body.innerText,
      layout: {
        supported: Boolean(layout.supported),
        value: Number(layout.value || 0),
        entries: Array.from(layout.entries || []),
      },
      anchors: {
        header: rect('#calendarHeader'),
        kpis: rect('#calendarKpiBar'),
        grid: rect('#calendarGrid'),
        events: rect('#calendarEventList'),
        newEvent: rect('#calendarNewEventArea'),
        polaris: rect('#calendarPolaris'),
      },
    };
  });
}

async function waitForCalendarAuthorized(page, title) {
  await page.waitForFunction(expectedTitle => (
    document.documentElement.dataset.canonicalAuthority === 'server'
      && document.querySelector('.cal-layout')?.getAttribute('aria-busy') === 'false'
      && document.querySelectorAll('.cal-event-list-item').length === 1
      && document.querySelector('.cal-event-list-title')?.textContent.trim() === expectedTitle
  ), title, { timeout: 5000 });
}

async function waitForCalendarRejected(page) {
  await page.waitForFunction(() => (
    document.documentElement.dataset.canonicalAuthority === 'rejected'
      && document.querySelector('.cal-layout')?.getAttribute('aria-busy') === 'false'
      && document.querySelectorAll('.cal-event-list-item').length === 0
      && Array.from(window.calState?.events || []).length === 0
      && document.getElementById('calendarEventList')?.textContent.includes('Calendar data unavailable')
  ), null, { timeout: 5000 });
}

async function assertRejectedCalendarViews(page, label, staleTitle) {
  for (const view of ['Month', 'Week', 'Day', 'Agenda']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const selector = {
      Month: '.cal-month-grid',
      Week: '.cal-week-view',
      Day: '.cal-day-view',
      Agenda: '.cal-agenda-view',
    }[view];
    await page.locator(selector).waitFor({ state: 'visible' });
    const rejectedView = await page.evaluate(oldTitle => ({
      stateCount: Array.from(window.calState?.events || []).length,
      renderedEventCount: document.querySelectorAll([
        '.cal-month-event-dot',
        '.cal-week-event',
        '.cal-day-event-card',
        '.cal-agenda-event',
        '.cal-event-list-item',
      ].join(',')).length,
      bodyHasOldTitle: document.body.innerText.includes(oldTitle),
      titleAttributeHasOldTitle: Array.from(document.querySelectorAll('[title]'))
        .some(element => element.getAttribute('title')?.includes(oldTitle)),
    }), staleTitle);
    assert.deepStrictEqual(rejectedView, {
      stateCount: 0,
      renderedEventCount: 0,
      bodyHasOldTitle: false,
      titleAttributeHasOldTitle: false,
    }, `${label} ${view} cannot reveal rejected appointment`);
  }
}

async function waitForAsyncSettled(page, surface) {
  if (surface.label === 'communications') {
    await page.waitForFunction(() => (
      document.querySelectorAll('#kpiGrid .ds-kpi-card').length === 8
      && document.querySelector('#callHistoryList .empty-state h3')?.textContent.trim() === 'No communications yet'
    ), null, { timeout: 5000 });
    return;
  }
  await page.waitForFunction(() => (
    document.querySelectorAll('#calendarGrid .cal-month-grid').length === 1
      && document.querySelector('#calendarHeader .cal-title')?.textContent.trim() === 'Calendar'
      && document.getElementById('calendarEventList')?.textContent.includes('No events scheduled for today')
  ), null, { timeout: 5000 });
}

async function auditCalendarInteractions(page, label, viewport) {
  await page.waitForFunction(() => document.documentElement.dataset.northstarNavigation === 'ready');
  for (const view of ['Week', 'Day', 'Agenda', 'Month']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    assert.strictEqual(await page.evaluate(() => window.calState.view), view.toLowerCase(), `${label} ${view} view state`);
    const selector = {
      Week: '.cal-week-view',
      Day: '.cal-day-view',
      Agenda: '.cal-agenda-view',
      Month: '.cal-month-grid',
    }[view];
    await page.locator(selector).waitFor({ state: 'visible' });
  }

  const monthBefore = await page.evaluate(() => `${window.calState.year}-${window.calState.month}`);
  await page.locator('.cal-nav-btn').nth(1).click();
  const monthAfterNext = await page.evaluate(() => `${window.calState.year}-${window.calState.month}`);
  assert.notStrictEqual(monthAfterNext, monthBefore, `${label} next-month navigation`);
  await page.locator('.cal-nav-btn').first().click();
  assert.strictEqual(await page.evaluate(() => `${window.calState.year}-${window.calState.month}`), monthBefore, `${label} previous-month restoration`);

  await page.getByRole('button', { name: '+ New Event', exact: true }).click();
  const modal = page.locator('#calModalOverlay');
  await modal.waitFor({ state: 'visible' });
  assert.strictEqual(await modal.locator('.cal-modal-header h2').textContent(), 'New Event', `${label} mounted event modal`);
  assert.strictEqual(await modal.locator('#calEventDate').getAttribute('type'), 'date', `${label} native date input`);
  assert.strictEqual(await modal.locator('#calEventTime').getAttribute('type'), 'time', `${label} native time input`);
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('calModalOverlay'));

  const geometry = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    const mobileHeader = document.querySelector('.mobile-header');
    const main = document.querySelector('.main-content');
    const grid = document.getElementById('calendarGrid');
    return {
      sidebarDisplay: sidebar ? getComputedStyle(sidebar).display : null,
      mobileHeaderDisplay: mobileHeader ? getComputedStyle(mobileHeader).display : null,
      mainOverflowY: main ? getComputedStyle(main).overflowY : null,
      gridOverflowX: grid ? getComputedStyle(grid).overflowX : null,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  const mobile = viewport.width <= 768;
  assert.strictEqual(geometry.sidebarDisplay, mobile ? 'none' : 'flex', `${label} responsive sidebar`);
  assert.strictEqual(geometry.mobileHeaderDisplay, mobile ? 'flex' : 'none', `${label} responsive mobile header`);
  assert.strictEqual(geometry.mainOverflowY, 'auto', `${label} native main scroll`);
  assert.strictEqual(geometry.gridOverflowX, 'auto', `${label} native calendar-grid scroll`);
  assert.strictEqual(geometry.scrollWidth, geometry.clientWidth, `${label} no horizontal document overflow`);
  return { views: 4, monthNavigation: true, modal: true, nativeScroll: true, responsiveNavigation: true };
}

async function runAsyncMatrix(browser, engine, origin, evidence) {
  const results = [];
  const selectedSurface = process.env.M19_PART8_ASYNC_SURFACE || '';
  const surfaces = selectedSurface
    ? ASYNC_SURFACES.filter(surface => surface.label === selectedSurface)
    : ASYNC_SURFACES;
  assert.ok(surfaces.length > 0, `unknown M19_PART8_ASYNC_SURFACE: ${selectedSurface}`);
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      for (const surface of surfaces) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
        const activeGate = { current: null };
        const errors = [];
        await installInstrumentation(context, theme);
        await installBoundaries(context, origin, evidence, activeGate);
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.stack || error.message));
        try {
          for (const mode of MODES) {
            const gate = createGate(surface.gatedApi);
            activeGate.current = gate;
            const response = mode === 'fresh'
              ? await page.goto(origin + surface.route, { waitUntil: 'domcontentloaded' })
              : await page.reload({ waitUntil: 'domcontentloaded' });
            assert.strictEqual(response.status(), 200, `${surface.label}/${mode}: mounted status`);
            await gate.waitForRequest();
            await page.waitForTimeout(75);
            const pending = await readAsyncState(page, surface);
            gate.release();
            await waitForAsyncSettled(page, surface);
            await page.waitForTimeout(100);
            const settled = await readAsyncState(page, surface);
            const failures = [];
            const label = `${engine}/${viewport.label}/${theme}/${surface.label}/${mode}`;
            const shift = maxAnchorShift(pending.anchors, settled.anchors);
            addFailure(failures, shift <= 1, `${label} pending-to-settled anchor shift must be <= 1px`, shift);
            if (engine === 'chrome') {
              addFailure(failures, settled.layout.supported === true, `${label} Chrome Layout Instability API available`, settled.layout);
              addFailure(failures, settled.layout.value <= 0.1, `${label} CLS must be <= 0.1`, settled.layout);
            } else {
              addFailure(failures, settled.layout.supported === false, `${label} WebKit Layout Instability remains unavailable`, settled.layout);
            }
            if (surface.label === 'communications') {
              addFailure(failures, pending.gridBusy === 'true' && pending.listBusy === 'true', `${label} truthful pending busy state`, pending);
              addFailure(failures, pending.cards === 8 && pending.loadingHeading === 'Loading communications\u2026', `${label} reserved pending geometry`, pending);
              addFailure(failures, settled.gridBusy === 'false' && settled.listBusy === 'false', `${label} settled busy state`, settled);
              addFailure(failures, settled.cards === 8 && settled.emptyHeading === 'No communications yet', `${label} truthful empty state`, settled);
            } else {
              addFailure(failures, pending.layoutBusy === 'true', `${label} truthful pending busy state`, pending);
              addFailure(failures, pending.title === 'Calendar' && pending.monthGrid === 1, `${label} reserved calendar geometry`, pending);
              addFailure(failures, pending.eventText.includes('Loading schedule\u2026'), `${label} truthful loading schedule`, pending);
              addFailure(failures, settled.layoutBusy === 'false', `${label} settled calendar state`, settled);
            }
            addFailure(failures, errors.length === 0, `${label} no page errors`, errors);
            const interaction = surface.label === 'calendar'
              ? await auditCalendarInteractions(page, label, viewport)
              : null;
            results.push({ label, cls: settled.layout.supported ? settled.layout.value : null, anchorShift: shift, heldReads: gate.requested, interaction });
            if (failures.length) throw new Error(failures.join('\n'));
          }
        } finally {
          if (activeGate.current) activeGate.current.release();
          await page.close();
          await context.close();
        }
      }
    }
  }
  return results;
}

async function runCalendarAuthorityMatrix(browser, engine, origin, evidence) {
  const results = [];
  const rejectionModes = ['malformed', 'http503'];
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      for (const rejectionMode of rejectionModes) {
        for (const mode of MODES) {
          for (const consumer of ['refreshCalendar', 'initCalendar']) {
          const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
          const activeGate = { current: null };
          const scenario = {
            phase: 'initial',
            initialTitle: 'Authorized initial appointment',
            recoveryTitle: 'Recovered authorized appointment',
          };
          const errors = [];
          await installInstrumentation(context, theme);
          await installBoundaries(context, origin, evidence, activeGate, scenario);
          const page = await context.newPage();
          page.on('pageerror', error => errors.push(error.stack || error.message));
          const label = `${engine}/${viewport.label}/${theme}/calendar-authority/${consumer}/${rejectionMode}/${mode}`;
          try {
            if (mode === 'reload') {
              const bootstrap = await page.goto(origin + '/dashboard/calendar', { waitUntil: 'networkidle' });
              assert.strictEqual(bootstrap.status(), 200, `${label} bootstrap mounted status`);
              await waitForCalendarAuthorized(page, scenario.initialTitle);
            }

            const initialGate = createGate('/api/v1/canonical/compat/calendar');
            activeGate.current = initialGate;
            scenario.phase = 'initial';
            const response = mode === 'fresh'
              ? await page.goto(origin + '/dashboard/calendar', { waitUntil: 'domcontentloaded' })
              : await page.reload({ waitUntil: 'domcontentloaded' });
            assert.strictEqual(response.status(), 200, `${label} mounted status`);
            await initialGate.waitForRequest();
            await page.waitForTimeout(75);
            const pending = await readCalendarAuthorityState(page);
            initialGate.release();
            await waitForCalendarAuthorized(page, scenario.initialTitle);
            await page.waitForTimeout(100);
            const authorized = await readCalendarAuthorityState(page);
            activeGate.current = null;

            assert.strictEqual(pending.layoutBusy, 'true', `${label} initial load is busy`);
            assert.ok(pending.eventText.includes('Loading schedule…'), `${label} initial loading presentation`);
            assert.strictEqual(authorized.authority, 'server', `${label} initial server authority`);
            assert.deepStrictEqual(authorized.stateTitles, [scenario.initialTitle], `${label} initial state title`);
            assert.deepStrictEqual(authorized.itemTitles, [scenario.initialTitle], `${label} initial mounted title`);

            const upstreamShift = selectedAnchorShift(pending.anchors, authorized.anchors, ['header', 'kpis', 'grid', 'events']);
            const downstreamShift = selectedAnchorShift(pending.anchors, authorized.anchors, ['newEvent', 'polaris']);
            assert.ok(upstreamShift <= 1, `${label} non-empty settlement keeps upstream geometry stable: ${upstreamShift}`);
            assert.ok(downstreamShift <= 32, `${label} non-empty settlement downstream movement remains bounded: ${downstreamShift}`);
            if (engine === 'chrome') {
              assert.strictEqual(authorized.layout.supported, true, `${label} Chrome Layout Instability API available`);
              assert.ok(authorized.layout.value <= 0.1, `${label} initial non-empty CLS <= 0.1: ${JSON.stringify(authorized.layout)}`);
            } else {
              assert.strictEqual(authorized.layout.supported, false, `${label} WebKit Layout Instability unavailable`);
            }

            await resetLayoutEvidence(page);
            const rejectGate = createGate('/api/v1/canonical/compat/calendar');
            activeGate.current = rejectGate;
            scenario.phase = rejectionMode;
            await page.evaluate(method => { window[method](); }, consumer);
            await rejectGate.waitForRequest();
            await page.waitForTimeout(75);
            const rejectPending = await readCalendarAuthorityState(page);
            rejectGate.release();
            await waitForCalendarRejected(page);
            await page.waitForTimeout(100);
            const rejected = await readCalendarAuthorityState(page);
            activeGate.current = null;

            assert.strictEqual(rejectPending.layoutBusy, 'true', `${label} rejected refresh begins busy`);
            assert.ok(rejectPending.eventText.includes('Loading schedule…'), `${label} rejected refresh shows loading presentation`);
            assert.strictEqual(rejected.authority, 'rejected', `${label} canonical authority rejected`);
            assert.strictEqual(rejected.layoutBusy, 'false', `${label} rejected settle is not busy`);
            assert.deepStrictEqual(rejected.stateTitles, [], `${label} state cache cleared`);
            assert.deepStrictEqual(rejected.apiTitles, [], `${label} API cache cleared`);
            assert.deepStrictEqual(rejected.leadTitles, [], `${label} lead cache cleared`);
            assert.strictEqual(rejected.itemCount, 0, `${label} no rejected event items`);
            assert.deepStrictEqual(rejected.itemTitles, [], `${label} no rejected event titles`);
            assert.ok(rejected.eventText.includes('Calendar data unavailable'), `${label} truthful rejected presentation`);
            assert.strictEqual(rejected.errorRole, 'alert', `${label} rejected presentation announced`);
            assert.ok(!rejected.bodyText.includes(scenario.initialTitle), `${label} stale initial title absent after rejection`);
            if (engine === 'chrome') {
              assert.ok(rejected.layout.value <= 0.1, `${label} rejected transition CLS <= 0.1: ${JSON.stringify(rejected.layout)}`);
            }
            await assertRejectedCalendarViews(page, label, scenario.initialTitle);

            await resetLayoutEvidence(page);
            const recoveryGate = createGate('/api/v1/canonical/compat/calendar');
            activeGate.current = recoveryGate;
            scenario.phase = 'recovery';
            await page.evaluate(method => { window[method](); }, consumer);
            await recoveryGate.waitForRequest();
            await page.waitForTimeout(75);
            const recoveryPending = await readCalendarAuthorityState(page);
            recoveryGate.release();
            await waitForCalendarAuthorized(page, scenario.recoveryTitle);
            await page.waitForTimeout(100);
            const recovered = await readCalendarAuthorityState(page);
            activeGate.current = null;

            assert.strictEqual(recoveryPending.layoutBusy, 'true', `${label} recovery begins busy`);
            assert.ok(recoveryPending.eventText.includes('Loading schedule…'), `${label} recovery loading presentation`);
            assert.strictEqual(recovered.authority, 'server', `${label} recovery server authority`);
            assert.strictEqual(recovered.layoutBusy, 'false', `${label} recovery settled`);
            assert.deepStrictEqual(recovered.stateTitles, [scenario.recoveryTitle], `${label} only fresh recovered state`);
            assert.deepStrictEqual(recovered.itemTitles, [scenario.recoveryTitle], `${label} only fresh recovered title`);
            assert.ok(!recovered.bodyText.includes(scenario.initialTitle), `${label} stale initial title absent after recovery`);
            if (engine === 'chrome') {
              assert.ok(recovered.layout.value <= 0.1, `${label} recovery transition CLS <= 0.1: ${JSON.stringify(recovered.layout)}`);
            }
            assert.deepStrictEqual(errors, [], `${label} no page errors`);

            const interaction = await auditCalendarInteractions(page, label, viewport);
            results.push({
              label,
              initialCls: authorized.layout.supported ? authorized.layout.value : null,
              rejectionCls: rejected.layout.supported ? rejected.layout.value : null,
              recoveryCls: recovered.layout.supported ? recovered.layout.value : null,
              upstreamShift,
              downstreamShift,
              rejectedItems: rejected.itemCount,
              recoveredTitles: recovered.itemTitles,
              consumer,
              interaction,
            });
          } finally {
            if (activeGate.current) activeGate.current.release();
            await page.close();
            await context.close();
          }
          }
        }
      }
    }
  }
  return results;
}

async function readContrast(page) {
  return page.evaluate(() => {
    function rgba(value) {
      const values = value.match(/[\d.]+/g).map(Number);
      return { r: values[0], g: values[1], b: values[2], a: values.length > 3 ? values[3] : 1 };
    }
    function opaqueBackground(element) {
      let current = element;
      while (current) {
        const color = rgba(getComputedStyle(current).backgroundColor);
        if (color.a > 0) return color;
        current = current.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    }
    function luminance(color) {
      const channels = [color.r, color.g, color.b].map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }
    function inspect(selector) {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      const foreground = rgba(style.color);
      const background = opaqueBackground(element);
      const high = Math.max(luminance(foreground), luminance(background));
      const low = Math.min(luminance(foreground), luminance(background));
      return {
        text: element.textContent.trim(),
        foreground,
        background,
        ratio: (high + 0.05) / (low + 0.05),
        fontSize: parseFloat(style.fontSize),
        fontWeight: parseInt(style.fontWeight, 10),
      };
    }
    return {
      neutral: inspect('.eb-stat-value.neutral'),
      warning: inspect('.eb-stat-value.warning'),
      theme: document.documentElement.dataset.theme,
    };
  });
}

async function runContrastMatrix(browser, engine, origin, evidence) {
  const results = [];
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const activeGate = { current: null };
      await installInstrumentation(context, theme);
      await installBoundaries(context, origin, evidence, activeGate);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.stack || error.message));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
      });
      try {
        for (const mode of MODES) {
          const response = mode === 'fresh'
            ? await page.goto(origin + '/dashboard/executive-brief', { waitUntil: 'networkidle' })
            : await page.reload({ waitUntil: 'networkidle' });
          assert.strictEqual(response.status(), 200, `executive brief/${mode}: mounted status`);
          try {
            await page.locator('.eb-stat-value.neutral').waitFor({ state: 'visible', timeout: 5000 });
          } catch (error) {
            const state = await page.evaluate(() => ({
              url: location.href,
              loading: document.getElementById('ebLoading')?.textContent.trim() || '',
              contentDisplay: document.getElementById('ebContent')?.style.display || '',
              bodyText: document.body.innerText.slice(0, 500),
            }));
            throw new Error(`${error.message}\nexecutive diagnostics: ${JSON.stringify({ state, errors })}`);
          }
          const observed = await readContrast(page);
          const label = `${engine}/${viewport.label}/${theme}/executive-brief/${mode}`;
          assert.strictEqual(observed.theme, theme, `${label} theme`);
          assert.deepStrictEqual(errors, [], `${label} no page errors`);
          for (const semantic of ['neutral', 'warning']) {
            const value = observed[semantic];
            assert.strictEqual(value.text, '$0', `${label}/${semantic} zero-value fixture`);
            assert.ok(value.fontSize >= 24 && value.fontWeight >= 700, `${label}/${semantic} large-text semantics`);
            assert.ok(value.ratio >= 3, `${label}/${semantic} contrast >= 3:1: ${JSON.stringify(value)}`);
          }
          results.push({ label, neutral: observed.neutral.ratio, warning: observed.warning.ratio });
        }
      } finally {
        await page.close();
        await context.close();
      }
    }
  }
  return results;
}

async function readToastGeometry(page) {
  return page.evaluate(() => {
    function box(element) {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    }
    const toast = document.querySelector('#toast.show');
    const toggle = document.querySelector('[data-northstar-theme-toggle]');
    const toastBox = box(toast);
    const toggleBox = box(toggle);
    const width = Math.max(0, Math.min(toastBox.right, toggleBox.right) - Math.max(toastBox.left, toggleBox.left));
    const height = Math.max(0, Math.min(toastBox.bottom, toggleBox.bottom) - Math.max(toastBox.top, toggleBox.top));
    return {
      toast: toastBox,
      toggle: toggleBox,
      intersection: { width, height, area: width * height },
      toastPosition: getComputedStyle(toast).position,
      togglePosition: getComputedStyle(toggle.closest('.northstar-theme-control') || toggle).position,
      role: toast.getAttribute('role'),
      live: toast.getAttribute('aria-live'),
      atomic: toast.getAttribute('aria-atomic'),
      activeId: document.activeElement && document.activeElement.id,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

async function runToastMatrix(browser, engine, origin, evidence) {
  const results = [];
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const activeGate = { current: null };
      await installInstrumentation(context, theme);
      await installBoundaries(context, origin, evidence, activeGate);
      const page = await context.newPage();
      try {
        for (const mode of MODES) {
          const response = mode === 'fresh'
            ? await page.goto(origin + '/dashboard/integrations', { waitUntil: 'networkidle' })
            : await page.reload({ waitUntil: 'networkidle' });
          assert.strictEqual(response.status(), 200, `integrations/${mode}: mounted status`);
          await page.evaluate(() => {
            window.connectIntegration('email');
            const input = document.getElementById('email-input');
            input.value = 'invalid-email';
            input.focus();
            window.confirmConnection();
          });
          await page.locator('#toast.show').waitFor({ state: 'visible' });
          const observed = await readToastGeometry(page);
          const label = `${engine}/${viewport.label}/${theme}/integrations/${mode}`;
          assert.strictEqual(observed.intersection.area, 0, `${label} toast/theme-control intersection: ${JSON.stringify(observed)}`);
          assert.strictEqual(observed.toastPosition, 'fixed', `${label} toast remains fixed`);
          assert.strictEqual(observed.togglePosition, 'fixed', `${label} theme control remains fixed`);
          assert.strictEqual(observed.role, 'status', `${label} default severity role`);
          assert.strictEqual(observed.live, 'polite', `${label} polite live region`);
          assert.strictEqual(observed.atomic, 'true', `${label} atomic live region`);
          assert.strictEqual(observed.activeId, 'email-input', `${label} inline toast does not steal focus`);
          assert.strictEqual(observed.scrollWidth, observed.clientWidth, `${label} no content-width reservation or horizontal overflow`);

          await page.evaluate(() => window.NotificationService.show('Keyboard close check', 'error'));
          const close = page.locator('.toast-notification.error .toast-close');
          assert.strictEqual(await close.getAttribute('aria-label'), 'Close notification', `${label} close label`);
          await close.focus();
          assert.strictEqual(await close.evaluate(element => document.activeElement === element), true, `${label} close focus`);
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => document.querySelectorAll('.toast-notification.error').length === 0);
          results.push({ label, gap: observed.toggle.top - observed.toast.bottom, intersectionArea: 0 });
        }
      } finally {
        await page.close();
        await context.close();
      }
    }
  }
  return results;
}

async function main() {
  const engine = process.argv[2];
  const scope = process.argv[3] || 'all';
  assert.ok(engine === 'chrome' || engine === 'webkit', 'usage: node m19-part8-responsive-p2-regression.js <chrome|webkit> [async|authority|contrast|toast|all]');
  assert.ok(['async', 'authority', 'contrast', 'toast', 'all'].includes(scope), `unknown scope: ${scope}`);
  const runtime = resolveBrowserRuntime(engine);
  const evidence = { requests: [], api: [] };
  let server;
  let browser;
  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    const output = {
      engine: engine === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      browserVersion: browser.version(),
      scope,
      async: [],
      authority: [],
      contrast: [],
      toast: [],
    };
    if (scope === 'all' || scope === 'async') output.async = await runAsyncMatrix(browser, engine, origin, evidence);
    if (scope === 'all' || scope === 'authority') output.authority = await runCalendarAuthorityMatrix(browser, engine, origin, evidence);
    if (scope === 'all' || scope === 'contrast') output.contrast = await runContrastMatrix(browser, engine, origin, evidence);
    if (scope === 'all' || scope === 'toast') output.toast = await runToastMatrix(browser, engine, origin, evidence);
    assert.ok(evidence.requests.length > 0, 'mounted pages made observable loopback requests');
    assert.ok(evidence.api.length > 0, 'mounted pages exercised intercepted first-party API reads');
    assert.ok(evidence.api.every(entry => ['GET', 'HEAD', 'OPTIONS'].includes(entry.method)), 'no API mutation');
    console.log(JSON.stringify({
      ...output,
      viewports: VIEWPORTS.map(viewport => viewport.label),
      themes: THEMES,
      modes: MODES,
      loopbackRequests: evidence.requests.length,
      interceptedApiReads: evidence.api.length,
      externalRequests: 0,
      mutations: 0,
      providerActions: 0,
      databaseActions: 0,
      physicalSafari: false,
    }));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
