'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const ROOT = path.resolve(__dirname, '..', '..');
const ROUTES = Object.freeze([
  Object.freeze({ id: 'command-center', path: '/demo', marker: 'One operating view for the day ahead.', surface: '.command-center-blueprint-main' }),
  Object.freeze({ id: 'polaris', path: '/demo/polaris', marker: 'POLARIS', surface: '.polaris-workspace' }),
  Object.freeze({ id: 'leads', path: '/demo/leads', marker: 'All Leads', surface: '.leads-kpi-grid' }),
  Object.freeze({ id: 'communications', path: '/demo/communications', marker: 'Communications', surface: '#kpiGrid' }),
  Object.freeze({ id: 'my-number', path: '/demo/my-number', marker: 'My Number', surface: '.settings-section' }),
  Object.freeze({ id: 'calendar', path: '/demo/calendar', marker: 'Calendar', surface: '#calendarGrid' }),
  Object.freeze({ id: 'team', path: '/demo/team', marker: 'Team', surface: '.wf-shell' }),
  Object.freeze({ id: 'ai-settings', path: '/demo/ai-settings', marker: 'AI Settings', surface: '.ai-settings-gateway' }),
  Object.freeze({ id: 'business-profile', path: '/demo/business-profile', marker: 'Business Profile', surface: '#businessProfileRoot' }),
  Object.freeze({ id: 'settings', path: '/demo/settings', marker: 'Settings', surface: '.settings-section' }),
  Object.freeze({ id: 'integrations', path: '/demo/integrations', marker: 'Integrations', surface: '#integrationAuthority' }),
]);
const VIEWPORTS = Object.freeze([
  Object.freeze({ label: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ label: 'mobile', width: 390, height: 844 }),
]);
const PROVIDER_ENVIRONMENT = Object.freeze([
  'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
]);

function treeDigest(directory) {
  const hash = crypto.createHash('sha256');
  function visit(current) {
    if (!fs.existsSync(current)) return;
    fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).forEach(entry => {
      const absolute = path.join(current, entry.name);
      hash.update(path.relative(directory, absolute).replace(/\\/g, '/'));
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
    });
  }
  visit(directory);
  return hash.digest('hex');
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function waitReady(page, route, revision) {
  await page.waitForFunction(({ expectedRevision, marker, surface }) => {
    const api = window.NorthStarDemoRuntime;
    const value = api && api.getWorkspace && api.getWorkspace();
    const root = document.documentElement;
    const node = document.querySelector(surface);
    return value && value.integrity.revision === expectedRevision &&
      root.getAttribute('data-northstar-navigation') === 'ready' &&
      root.getAttribute('data-demo-workspace') === 'ready' &&
      document.getElementById('northstarDemoToolbar') && node &&
      document.body.textContent.includes(marker);
  }, { expectedRevision: revision, marker: route.marker, surface: route.surface }, { timeout: 15000 });
}

async function inspectCurrent(page, route, revision, viewport) {
  await waitReady(page, route, revision);
  const snapshot = await page.evaluate(({ routeId, routePath, mobile }) => {
    function rect(node) {
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
    }
    function visible(node) {
      if (!node) return false;
      const value = rect(node);
      const style = getComputedStyle(node);
      const browserVisible = typeof node.checkVisibility === 'function'
        ? node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : node.getClientRects().length > 0;
      return browserVisible && value.width > 0 && value.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden';
    }
    const main = document.querySelector('.main-content');
    const toolbar = document.getElementById('northstarDemoToolbar');
    const mainStyle = getComputedStyle(main);
    const mainRect = rect(main);
    const toolbarRect = rect(toolbar);
    const contentLeft = mainRect.left + parseFloat(mainStyle.paddingLeft || '0');
    const contentRight = mainRect.right - parseFloat(mainStyle.paddingRight || '0');
    const nextSurface = Array.from(main.children).find(node => node !== toolbar && visible(node));
    const controlRects = Array.from(toolbar.querySelectorAll('button, select, a')).filter(visible).map(node => ({
      id: node.id || node.textContent.trim(), rect: rect(node),
    }));
    const overlaps = [];
    for (let left = 0; left < controlRects.length; left += 1) {
      for (let right = left + 1; right < controlRects.length; right += 1) {
        const a = controlRects[left].rect;
        const b = controlRects[right].rect;
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
          overlaps.push(controlRects[left].id + ' / ' + controlRects[right].id);
        }
      }
    }
    const sidebarLinks = Array.from(document.querySelectorAll('.sidebar-nav a')).map(node => ({
      id: node.dataset.navId, href: node.getAttribute('href'), current: node.getAttribute('aria-current'), visible: visible(node),
    }));
    const mobileLinks = Array.from(document.querySelectorAll('.mobile-menu-nav a')).map(node => ({
      id: node.dataset.navId, href: node.getAttribute('href'), current: node.getAttribute('aria-current'),
    }));
    const polarisCard = document.querySelector('.polaris-card');
    const polarisGrid = polarisCard && polarisCard.querySelector('.polaris-grid');
    const polarisCardRect = rect(polarisCard);
    const polarisItemsContained = !polarisCard || Array.from(polarisCard.querySelectorAll('.polaris-item')).every(node => {
      const itemRect = rect(node);
      return itemRect.left >= polarisCardRect.left - 1 && itemRect.right <= polarisCardRect.right + 1;
    });
    return {
      pathname: location.pathname,
      workspace: window.NorthStarDemoRuntime.getWorkspace(),
      body: document.body.textContent,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sidebarLinks,
      mobileLinks,
      sidebarVisible: visible(document.querySelector('.sidebar')),
      mobileHeaderVisible: visible(document.querySelector('.mobile-header')),
      activeSidebar: sidebarLinks.filter(item => item.current === 'page').map(item => item.id),
      activeMobile: mobileLinks.filter(item => item.current === 'page').map(item => item.id),
      genericShells: document.querySelectorAll('.demo-command-layout, .demo-command-nav-link, #demoCommandContent').length,
      contentLeft,
      contentRight,
      mainRect,
      mainPaddingLeft: parseFloat(mainStyle.paddingLeft || '0'),
      mainPaddingRight: parseFloat(mainStyle.paddingRight || '0'),
      toolbarRect,
      nextSurfaceRect: rect(nextSurface),
      overlaps,
      themeRect: rect(document.querySelector('[data-northstar-theme-control]')),
      polarisGridOverflow: polarisGrid ? polarisGrid.scrollWidth - polarisGrid.clientWidth : null,
      polarisItemsContained,
      routeId,
      routePath,
      mobile,
    };
  }, { routeId: route.id, routePath: route.path, mobile: viewport.width <= 768 });

  assert.strictEqual(snapshot.pathname, route.path, route.path + ' exact route');
  assert.strictEqual(snapshot.workspace.integrity.revision, revision, route.path + ' shared revision');
  assert.strictEqual(snapshot.sidebarLinks.length, ROUTES.length, route.path + ' full canonical desktop navigation');
  assert.strictEqual(snapshot.mobileLinks.length, ROUTES.length, route.path + ' full canonical mobile navigation');
  assert.ok(snapshot.sidebarLinks.concat(snapshot.mobileLinks).every(item => item.href === '/demo' || item.href.startsWith('/demo/')),
    route.path + ' account-free navigation projection');
  assert.deepStrictEqual(snapshot.activeSidebar, [route.id], route.path + ' desktop active destination');
  assert.deepStrictEqual(snapshot.activeMobile, [route.id], route.path + ' mobile active destination');
  assert.strictEqual(snapshot.sidebarVisible, viewport.width > 768, route.path + ' responsive sidebar visibility');
  assert.strictEqual(snapshot.mobileHeaderVisible, viewport.width <= 768, route.path + ' responsive mobile header visibility');
  assert.strictEqual(snapshot.genericShells, 0, route.path + ' generic Parity shell removed');
  assert.ok(snapshot.overflow <= 1, route.path + ' no horizontal overflow');
  assert.ok(snapshot.toolbarRect.left - snapshot.mainRect.left >= 11 &&
    snapshot.mainRect.right - snapshot.toolbarRect.right >= 11,
  route.path + ' demo controls retain responsive outer gutters');
  assert.ok(snapshot.toolbarRect.left >= snapshot.contentLeft - 1 && snapshot.toolbarRect.right <= snapshot.contentRight + 1,
    route.path + ' demo controls stay within content gutters');
  if (snapshot.nextSurfaceRect) {
    assert.ok(snapshot.nextSurfaceRect.top - snapshot.toolbarRect.bottom >= 8, route.path + ' demo controls do not touch canonical surface');
  }
  assert.deepStrictEqual(snapshot.overlaps, [], route.path + ' demo controls do not overlap');
  if (snapshot.polarisGridOverflow !== null) {
    assert.ok(snapshot.polarisGridOverflow <= 1, route.path + ' Polaris card text stays contained');
    assert.strictEqual(snapshot.polarisItemsContained, true, route.path + ' Polaris items stay within the card');
  }
  assert.ok(snapshot.themeRect && snapshot.themeRect.left >= 0 && snapshot.themeRect.right <= viewport.width &&
    snapshot.themeRect.top >= 0 && snapshot.themeRect.bottom <= viewport.height,
  route.path + ' theme toggle remains in the viewport');
  return snapshot;
}

async function enterDemo(page, origin, revision, viewport) {
  const route = ROUTES[0];
  const response = await page.goto(origin + route.path, { waitUntil: 'domcontentloaded', timeout: 15000 });
  assert.ok(response, route.path + ' entry response');
  assert.ok([200, 304].includes(response.status()), route.path + ' shell HTTP ' + response.status());
  return inspectCurrent(page, route, revision, viewport);
}

async function clickRoute(page, origin, route, revision, viewport) {
  const mobile = viewport.width <= 768;
  if (mobile) {
    await page.click('#navHamburgerBtn');
    await page.waitForFunction(() => document.getElementById('mobileMenu').classList.contains('open'));
  }
  const selector = (mobile ? '.mobile-menu-nav' : '.sidebar-nav') + ' a[data-nav-id="' + route.id + '"]';
  await Promise.all([
    page.waitForURL(url => url.origin === origin && url.pathname === route.path, { timeout: 15000 }),
    page.click(selector),
  ]);
  return inspectCurrent(page, route, revision, viewport);
}

async function exerciseTheme(page, viewport) {
  const before = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, url: location.href }));
  await page.click('[data-northstar-theme-toggle]');
  await page.waitForFunction(previous => {
    const root = document.documentElement;
    return root.dataset.theme && root.dataset.theme !== previous && !root.hasAttribute('data-theme-switching');
  }, before.theme);
  const after = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    url: location.href,
    rect: (() => { const value = document.querySelector('[data-northstar-theme-control]').getBoundingClientRect(); return { left: value.left, right: value.right, top: value.top, bottom: value.bottom }; })(),
  }));
  assert.notStrictEqual(after.theme, before.theme, viewport.label + ' theme changes on click');
  assert.strictEqual(after.url, before.url, viewport.label + ' theme click does not navigate');
  assert.ok(after.rect.left >= 0 && after.rect.right <= viewport.width && after.rect.top >= 0 && after.rect.bottom <= viewport.height,
    viewport.label + ' theme control stays flush and visible');
}

async function exerciseViewport(browser, origin, viewport, ledger) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  page.on('request', request => ledger.requests.push({ viewport: viewport.label, method: request.method(), url: request.url() }));
  page.on('response', response => {
    if (response.status() >= 400) ledger.httpErrors.push({ viewport: viewport.label, status: response.status(), url: response.url() });
  });
  page.on('console', message => {
    const location = message.location();
    const source = location && location.url ? ' [' + location.url + (location.lineNumber != null ? ':' + location.lineNumber : '') + ']' : '';
    if (message.type() === 'warning') ledger.warnings.push(viewport.label + ': ' + message.text() + source);
    if (message.type() === 'error') {
      const entry = viewport.label + ': ' + message.text() + source;
      ledger.consoleErrors.push(entry);
      console.log('PARITY_BROWSER_CONSOLE_ERROR ' + entry);
    }
  });
  page.on('pageerror', error => ledger.pageErrors.push(viewport.label + ': ' + error.message));
  try {
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' entry');
    const initial = await enterDemo(page, origin, 1, viewport);
    assert.strictEqual(initial.workspace.session.durable, false, viewport.label + ' GET remains projection-only');
    assert.strictEqual(initial.workspace.graphs.length, 3, viewport.label + ' seed graph count');
    const initialConfiguration = initial.workspace.configuration;
    const initialNavigation = initial.workspace.navigation;
    const initialDigest = initial.workspace.integrity.digest;
    await exerciseTheme(page, viewport);
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' theme');

    for (const route of ROUTES.slice(1)) {
      const snapshot = await clickRoute(page, origin, route, 1, viewport);
      assert.strictEqual(snapshot.workspace.integrity.digest, initialDigest, route.path + ' exact initial digest');
      if (route.id === 'polaris') {
        const requestOffset = ledger.requests.length;
        const prompt = page.locator('#polarisPromptInput').first();
        const send = page.locator('#polarisSendBtn').first();
        await prompt.fill('Show the account-free demo boundary.');
        await send.click();
        await page.waitForFunction(() => Array.from(document.querySelectorAll('.polaris-chat-message')).some(node =>
          node.textContent.includes('Live Polaris chat is not available in the account-free demo.')
        ));
        const chatRequests = ledger.requests.slice(requestOffset).filter(entry =>
          new URL(entry.url).pathname === '/api/v1/polaris/chat'
        );
        assert.deepStrictEqual(chatRequests, [], viewport.label + ' demo Polaris chat stays browser-local');
      }
      console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' route ' + route.id);
    }

    await clickRoute(page, origin, ROUTES[0], 1, viewport);
    const scenarioBuilder = page.locator('.northstar-demo-scenario-builder');
    if (!(await scenarioBuilder.evaluate(node => node.open))) {
      await scenarioBuilder.locator('summary').click();
    }
    const scenarioSelection = {
      business: 'multi_crew',
      service: 'roofing',
      intent: 'second_opinion',
      urgency: 'safety_emergency',
      context: 'insurance_claim',
      scheduling: 'weather_window',
      outcome: 'booked',
    };
    for (const [dimension, value] of Object.entries(scenarioSelection)) {
      await page.selectOption('[data-scenario-dimension="' + dimension + '"]', value);
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('#demoSimulateLead'),
    ]);
    await waitReady(page, ROUTES[0], 2);
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' simulated');
    const simulated = await page.evaluate(() => window.NorthStarDemoRuntime.getWorkspace());
    assert.strictEqual(simulated.session.durable, true, viewport.label + ' explicit mutation creates durable session');
    assert.strictEqual(simulated.session.simulationCount, 1, viewport.label + ' simulation count');
    assert.strictEqual(simulated.graphs.length, 4, viewport.label + ' one added graph');
    assert.notStrictEqual(simulated.integrity.digest, initialDigest, viewport.label + ' state digest advances');
    assert.deepStrictEqual(simulated.configuration, initialConfiguration, viewport.label + ' configuration remains stable');
    assert.deepStrictEqual(simulated.navigation, initialNavigation, viewport.label + ' navigation remains stable');
    const added = simulated.graphs[0];
    assert.strictEqual(added.lead.serviceType, 'roofing', viewport.label + ' selected service');
    assert.deepStrictEqual(added.scenario.selection, scenarioSelection, viewport.label + ' complete selected scenario');
    assert.strictEqual(added.polaris.snapshot.risk.emergency, true, viewport.label + ' urgency changes Polaris risk');
    assert.ok(added.communication.transcript.some(turn => turn.text.includes('second opinion')),
      viewport.label + ' caller intent changes the generated conversation');
    assert.strictEqual(added.polaris.completeDetail, true, viewport.label + ' complete Polaris detail');
    assert.match(added.polaris.snapshotDigest, /^[0-9a-f]{64}$/, viewport.label + ' snapshot digest');

    const leadsRoute = ROUTES.find(route => route.id === 'leads');
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' leads-revisit-start');
    const leads = await clickRoute(page, origin, leadsRoute, 2, viewport);
    await page.waitForFunction(name => document.body.textContent.includes(name), added.customer.name);
    assert.ok(leads.workspace.graphs.some(graph => graph.ids.graph === added.ids.graph), 'Leads reads the committed graph');
    const rowTarget = await page.evaluate(async name => {
      const row = Array.from(document.querySelectorAll('#leadsContent tr')).find(candidate => candidate.textContent.includes(name));
      if (!row) return null;
      row.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const value = row.getBoundingClientRect();
      const visibleLeft = Math.max(0, value.left);
      const visibleRight = Math.min(window.innerWidth, value.right);
      const visibleTop = Math.max(0, value.top);
      const visibleBottom = Math.min(window.innerHeight, value.bottom);
      const x = visibleLeft + (visibleRight - visibleLeft) / 2;
      const y = visibleTop + (visibleBottom - visibleTop) / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x,
        y,
        rowLeft: value.left,
        rowRight: value.right,
        rowTop: value.top,
        rowBottom: value.bottom,
        width: visibleRight - visibleLeft,
        height: visibleBottom - visibleTop,
        hitTag: hit && hit.tagName,
        hitId: hit && hit.id,
        hitClass: hit && hit.className,
        exactHit: Boolean(hit && hit.closest('#leadsContent tr') === row),
      };
    }, added.customer.name);
    assert.ok(rowTarget && rowTarget.width > 0 && rowTarget.height > 0 && rowTarget.exactHit,
      viewport.label + ' newly rendered lead row is unobstructed and actionable: ' + JSON.stringify(rowTarget));
    await page.mouse.click(rowTarget.x, rowTarget.y);
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' lead-row-clicked');
    await page.waitForFunction(name => {
      const drawer = document.getElementById('cdCustomerDrawer');
      const content = document.getElementById('cdDrawerContent');
      return drawer && drawer.classList.contains('open') && content && getComputedStyle(content).display !== 'none' &&
        drawer.textContent.includes(name) && drawer.textContent.includes('POLARIS');
    }, added.customer.name, { timeout: 10000 });
    const drawerText = await page.locator('#cdCustomerDrawer').innerText();
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' drawer-ready');
    assert.ok(drawerText.includes(added.customer.name), viewport.label + ' clicked customer opens canonical detail');
    assert.ok(drawerText.includes(added.lead.serviceLabel), viewport.label + ' detail retains canonical service');
    assert.ok(drawerText.includes('POLARIS'), viewport.label + ' detail contains Polaris intelligence');
    assert.ok(drawerText.includes('AI AGENT') && !drawerText.includes('No transcript available.'),
      viewport.label + ' detail renders the authentic generated transcript');
    const drawerContainment = await page.evaluate(() => {
      const drawer = document.getElementById('cdCustomerDrawer').getBoundingClientRect();
      const description = document.getElementById('cdDescription');
      const value = description.getBoundingClientRect();
      return {
        inside: value.left >= drawer.left && value.right <= drawer.right,
        wrapped: description.scrollWidth <= description.clientWidth + 1,
      };
    });
    assert.deepStrictEqual(drawerContainment, { inside: true, wrapped: true },
      viewport.label + ' canonical scope text remains contained and wrapped');
    await page.click('#cdDrawerClose');

    for (const id of ['communications', 'calendar', 'command-center']) {
      const route = ROUTES.find(candidate => candidate.id === id);
      await clickRoute(page, origin, route, 2, viewport);
      if (id === 'calendar') {
        const agendaButton = page.locator('.cal-view-tab', { hasText: 'Agenda' });
        await agendaButton.click();
        await page.waitForFunction(() => window.calState && window.calState.view === 'agenda');
      }
      await page.waitForFunction(name => document.body.textContent.includes(name), added.customer.name);
      console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' propagated ' + id);
    }

    const polarisRoute = ROUTES.find(route => route.id === 'polaris');
    await clickRoute(page, origin, polarisRoute, 2, viewport);
    const detailPath = polarisRoute.path + '?kind=lead&id=' + encodeURIComponent(added.ids.lead);
    const detailResponse = await page.goto(origin + detailPath, { waitUntil: 'domcontentloaded', timeout: 15000 });
    assert.ok(detailResponse && [200, 304].includes(detailResponse.status()), viewport.label + ' Polaris detail shell');
    const detail = await inspectCurrent(page, polarisRoute, 2, viewport);
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' polaris-detail');
    assert.ok(detail.body.includes(added.ids.customer), viewport.label + ' customer authority ID visible');
    assert.ok(detail.body.includes(added.ids.lead), viewport.label + ' lead authority ID visible');
    assert.ok(detail.body.includes(added.ids.work), viewport.label + ' work authority ID visible');
    assert.ok(detail.body.includes(added.polaris.snapshotDigest), viewport.label + ' Polaris digest visible');
    assert.ok(detail.body.includes('Supporting facts'), viewport.label + ' full supporting facts visible');
    assert.ok(detail.body.includes('Not calculated'), viewport.label + ' bounded calculation limitations visible');

    for (const id of ['team', 'ai-settings', 'business-profile', 'settings', 'integrations']) {
      const route = ROUTES.find(candidate => candidate.id === id);
      const snapshot = await clickRoute(page, origin, route, 2, viewport);
      assert.deepStrictEqual(snapshot.workspace.configuration, initialConfiguration, route.path + ' configuration stability');
      console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' config ' + id);
    }

    await clickRoute(page, origin, ROUTES[0], 2, viewport);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.click('#demoReset'),
    ]);
    await waitReady(page, ROUTES[0], 3);
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' reset');
    const reset = await page.evaluate(() => window.NorthStarDemoRuntime.getWorkspace());
    assert.strictEqual(reset.graphs.length, 3, viewport.label + ' reset restores seed graph count');
    assert.strictEqual(reset.session.simulationCount, 0, viewport.label + ' reset count');
    assert.deepStrictEqual(reset.configuration, initialConfiguration, viewport.label + ' reset preserves configuration');
    assert.ok(!reset.graphs.some(graph => graph.ids.graph === added.ids.graph), viewport.label + ' reset removes only session-added graph');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady(page, ROUTES[0], 3);
    const reloaded = await page.evaluate(() => window.NorthStarDemoRuntime.getWorkspace());
    assert.strictEqual(reloaded.session.durable, true, viewport.label + ' durable state survives reload');
    assert.strictEqual(reloaded.integrity.digest, reset.integrity.digest, viewport.label + ' reload digest');
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' complete');
    return { viewport: viewport.label, sessionId: reloaded.session.id, finalDigest: reloaded.integrity.digest };
  } finally {
    await context.close();
  }
}

async function main() {
  const selected = process.env.NORTHSTAR_BROWSER;
  assert.ok(selected === 'chrome' || selected === 'webkit', 'NORTHSTAR_BROWSER must be chrome or webkit');
  const runtime = resolveBrowserRuntime(selected);
  const selectedViewports = process.env.NORTHSTAR_VIEWPORT
    ? VIEWPORTS.filter(viewport => viewport.label === process.env.NORTHSTAR_VIEWPORT)
    : VIEWPORTS;
  assert.ok(selectedViewports.length > 0, 'NORTHSTAR_VIEWPORT must be desktop or mobile when provided');
  const suiteDatabase = await createSuiteDatabase('cc-parity-browser');
  const originalEnvironment = new Map();
  for (const name of PROVIDER_ENVIRONMENT.concat(['DATABASE_URL', 'NODE_ENV', 'AUTH_ACCESS_SECRET'])) {
    originalEnvironment.set(name, process.env[name]);
  }
  const beforeData = treeDigest(path.join(ROOT, 'data'));
  let db;
  let server;
  let browser;
  const originalFetch = global.fetch;
  try {
    for (const name of PROVIDER_ENVIRONMENT) delete process.env[name];
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.chdir(ROOT);
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL initialized');
    global.fetch = async function () { throw new Error('provider boundary must remain unused'); };
    const { app } = require('../../src/server');
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
    const ledger = { requests: [], httpErrors: [], warnings: [], consoleErrors: [], pageErrors: [] };
    const receipts = [];
    for (const viewport of selectedViewports) receipts.push(await exerciseViewport(browser, origin, viewport, ledger));

    const external = ledger.requests.filter(entry => new URL(entry.url).origin !== origin);
    const mutations = ledger.requests.filter(entry => entry.method !== 'GET' && entry.method !== 'HEAD' && entry.method !== 'OPTIONS');
    assert.deepStrictEqual(external, [], 'all browser traffic remains on the disposable loopback origin');
    assert.strictEqual(mutations.length, selectedViewports.length * 2, 'one simulate and one reset per viewport');
    assert.ok(mutations.every(entry => {
      const pathname = new URL(entry.url).pathname;
      return entry.method === 'POST' && (pathname === '/api/demo/command-center/simulations/leads' || pathname === '/api/demo/command-center/reset');
    }), 'only bounded demo mutations occur');
    assert.deepStrictEqual(ledger.httpErrors, [], 'browser HTTP errors');
    assert.deepStrictEqual(ledger.warnings, [], 'browser console warnings');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'browser console errors');
    assert.deepStrictEqual(ledger.pageErrors, [], 'browser page errors');

    const pool = db.getPool();
    const rows = (await pool.query(
      `SELECT count(*)::int AS sessions,
              count(DISTINCT tenant_id)::int AS tenants,
              min(revision)::int AS minimum_revision,
              max(simulation_count)::int AS maximum_simulation_count,
              bool_and(token_hash ~ '^[0-9a-f]{64}$') AS token_hashes_only
         FROM demo_command_center_sessions`
    )).rows[0];
    assert.deepStrictEqual(rows, {
      sessions: selectedViewports.length,
      tenants: selectedViewports.length,
      minimum_revision: 3,
      maximum_simulation_count: 0,
      token_hashes_only: true,
    }, 'one isolated durable tenant/session per browser context');

    console.log('COMMAND_CENTER_PARITY_BROWSER_RECEIPT ' + JSON.stringify({
      browser: selected,
      version: browser.version(),
      viewports: selectedViewports.map(value => value.label),
      routes: ROUTES.length,
      receipts,
      requests: ledger.requests.length,
      mutations: mutations.length,
      externalRequests: external.length,
      httpErrors: ledger.httpErrors.length,
      warnings: ledger.warnings.length,
      consoleErrors: ledger.consoleErrors.length,
      pageErrors: ledger.pageErrors.length,
      postgres: rows,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db) await db.close();
    global.fetch = originalFetch;
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await suiteDatabase.cleanup();
    assert.strictEqual(treeDigest(path.join(ROOT, 'data')), beforeData, 'browser test does not alter repository data');
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
