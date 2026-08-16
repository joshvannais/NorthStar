'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { ingestRetell } = require('../../src/services/canonicalGraphService');

const ROOT = path.resolve(__dirname, '..', '..');
const ROUTES = Object.freeze([
  Object.freeze({ id: 'command-center', path: '/demo', paidPath: '/dashboard', marker: 'One operating view for the day ahead.', surface: '.command-center-blueprint-main' }),
  Object.freeze({ id: 'polaris', path: '/demo/polaris', paidPath: '/dashboard/polaris', marker: 'POLARIS', surface: '.polaris-workspace' }),
  Object.freeze({ id: 'leads', path: '/demo/leads', paidPath: '/dashboard/leads', marker: 'All Leads', surface: '.leads-kpi-grid' }),
  Object.freeze({ id: 'communications', path: '/demo/communications', paidPath: '/dashboard/communications', marker: 'Communications', surface: '#kpiGrid' }),
  Object.freeze({ id: 'my-number', path: '/demo/my-number', paidPath: '/dashboard/my-number', marker: 'My Number', surface: '.settings-section' }),
  Object.freeze({ id: 'calendar', path: '/demo/calendar', paidPath: '/dashboard/calendar', marker: 'Calendar', surface: '#calendarGrid' }),
  Object.freeze({ id: 'team', path: '/demo/team', paidPath: '/dashboard/team', marker: 'Team', surface: '.wf-shell' }),
  Object.freeze({ id: 'ai-settings', path: '/demo/ai-settings', paidPath: '/dashboard/ai-settings', marker: 'AI Settings', surface: '.ai-settings-gateway' }),
  Object.freeze({ id: 'business-profile', path: '/demo/business-profile', paidPath: '/dashboard/business-profile', marker: 'Business Profile', surface: '#businessProfileRoot' }),
  Object.freeze({ id: 'settings', path: '/demo/settings', paidPath: '/dashboard/settings', marker: 'Settings', surface: '.settings-section' }),
  Object.freeze({ id: 'integrations', path: '/demo/integrations', paidPath: '/dashboard/integrations', marker: 'Integrations', surface: '#integrationAuthority' }),
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
const PAID_ORG_A = '8b000000-0000-4000-8000-000000000001';
const PAID_ORG_B = '8b000000-0000-4000-8000-000000000002';
const PAID_USER_A = '8c000000-0000-4000-8000-000000000001';
const PAID_USER_B = '8c000000-0000-4000-8000-000000000002';
const PAID_CUSTOMER_A = 'Authorized Paid Customer';
const PAID_CUSTOMER_B = 'Other Tenant Private Customer';

function paidBusinessProfile(companyName) {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({
    companyName,
    materialRates: { cedar: 123, pine: 71, vinyl: 83, 'chain-link': 47 },
  });
  profile.company.name = companyName;
  profile.services = canonical.services;
  profile.canonicalPricing = canonical.canonicalPricing;
  profile.canonicalCosts = canonical.canonicalCosts;
  return profile;
}

function paidGraphRequest(organizationId, key, customerName, phone) {
  return {
    tenantContext: { organizationId },
    idempotencyKey: key,
    sourceVersion: 'command-center-paid-browser-v1',
    external: {
      customerId: key + ':customer',
      callId: key + ':call',
      transcriptId: key + ':transcript',
      communicationId: key + ':communication',
      appointmentId: key + ':appointment',
    },
    customer: {
      name: customerName,
      phone,
      email: key + '@paid-browser.test',
      address: { city: 'Raleigh', state: 'NC' },
    },
    transcript: [
      { speaker: 'agent', text: 'Thanks for calling. What kind of fence work do you need?' },
      { speaker: 'customer', text: 'I need a 120 foot cedar privacy fence and an appointment next week.' },
    ],
    facts: [
      { variable: 'jobType', normalizedValue: 'Cedar privacy fence installation', evidenceText: 'The customer requested a cedar privacy fence.', speaker: 'customer', confidence: 0.98 },
      { variable: 'linearFeet', normalizedValue: 120, evidenceText: 'The customer requested 120 feet.', speaker: 'customer', confidence: 0.98 },
    ],
    service: { key: 'fence', scope: { linearFeet: 120, material: 'cedar', gates: 1 } },
    appointmentPreference: { window: 'next week', flexibility: 'weekday' },
    scheduledAppointment: { start: '2026-08-20T14:00:00.000Z', end: '2026-08-20T16:00:00.000Z' },
    travel: { miles: 8 },
    callDurationSeconds: 185,
    occurredAt: '2026-08-16T16:00:00.000Z',
  };
}

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
  await page.waitForFunction(({ expectedRevision, marker, surface, routeId }) => {
    const api = window.NorthStarDemoRuntime;
    const value = api && api.getWorkspace && api.getWorkspace();
    const root = document.documentElement;
    const node = document.querySelector(surface);
    const cardReady = routeId === 'command-center'
      ? Boolean(document.querySelector('#commandCenterPolaris[data-polaris-card="northstar_polaris_intelligence_card_v1"]'))
      : Boolean(document.querySelector('#northstarPolarisSurfaceCard[data-state="ready"]'));
    return value && value.integrity.revision === expectedRevision &&
      root.getAttribute('data-northstar-navigation') === 'ready' &&
      root.getAttribute('data-demo-workspace') === 'ready' &&
      document.getElementById('northstarDemoToolbar') && node && cardReady &&
      document.body.textContent.includes(marker);
  }, { expectedRevision: revision, marker: route.marker, surface: route.surface, routeId: route.id }, { timeout: 15000 });
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
    const mountedPolarisCard = routeId === 'command-center'
      ? document.querySelector('#commandCenterPolaris[data-polaris-card]')
      : document.getElementById('northstarPolarisSurfaceCard');
    const polarisGrid = mountedPolarisCard && mountedPolarisCard.querySelector('.polaris-card-detail-grid');
    const polarisCardRect = rect(mountedPolarisCard);
    const polarisItemsContained = !mountedPolarisCard || Array.from(mountedPolarisCard.querySelectorAll('li, a, p, span')).every(node => {
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
      polarisCardCount: document.querySelectorAll('[data-polaris-card="northstar_polaris_intelligence_card_v1"]').length,
      polarisCardPresent: Boolean(mountedPolarisCard),
      polarisCardContract: mountedPolarisCard && mountedPolarisCard.dataset.polarisCard,
      polarisCardSurface: mountedPolarisCard && mountedPolarisCard.dataset.polarisSurface,
      polarisCardState: routeId === 'command-center' ? 'ready' : mountedPolarisCard && mountedPolarisCard.dataset.state,
      polarisCardText: mountedPolarisCard && mountedPolarisCard.textContent,
      polarisObjectHrefs: mountedPolarisCard ? Array.from(mountedPolarisCard.querySelectorAll('.polaris-card-object-links a')).map(node => node.getAttribute('href')) : [],
      polarisDetailed: Boolean(mountedPolarisCard && mountedPolarisCard.querySelector('.polaris-card-details')),
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
  assert.strictEqual(snapshot.polarisCardPresent, true, route.path + ' shared Polaris card is mounted');
  assert.strictEqual(snapshot.polarisCardCount, 1, route.path + ' has exactly one mounted Polaris card');
  assert.strictEqual(snapshot.polarisCardContract, 'northstar_polaris_intelligence_card_v1', route.path + ' Polaris card contract');
  assert.strictEqual(snapshot.polarisCardSurface, route.id, route.path + ' page-specific Polaris surface');
  assert.strictEqual(snapshot.polarisCardState, 'ready', route.path + ' Polaris projection ready');
  assert.ok(!snapshot.polarisCardText.includes('[object Object]'), route.path + ' no raw object rendering');
  assert.ok(!snapshot.polarisCardText.includes('Not calculated'), route.path + ' no unexplained calculation placeholder');
  assert.strictEqual(snapshot.polarisDetailed, ['command-center', 'leads', 'polaris'].includes(route.id),
    route.path + ' detailed-card depth');
  if (snapshot.polarisGridOverflow !== null) {
    assert.ok(snapshot.polarisGridOverflow <= 1, route.path + ' Polaris card text stays contained');
    assert.strictEqual(snapshot.polarisItemsContained, true, route.path + ' Polaris items stay within the card');
  }
  assert.ok(snapshot.themeRect && snapshot.themeRect.left >= 0 && snapshot.themeRect.right <= viewport.width &&
    snapshot.themeRect.top >= 0 && snapshot.themeRect.bottom <= viewport.height,
  route.path + ' theme toggle remains in the viewport');
  return snapshot;
}

async function exercisePolarisDisclosure(page, route, viewport) {
  if (!['command-center', 'leads', 'polaris'].includes(route.id)) return;
  const selector = route.id === 'command-center'
    ? '#commandCenterPolaris .polaris-card-details'
    : '#northstarPolarisSurfaceCard .polaris-card-details';
  const details = page.locator(selector);
  assert.strictEqual(await details.count(), 1, route.path + ' one detailed Polaris disclosure');
  assert.strictEqual(await details.evaluate(node => node.open), false, route.path + ' details start collapsed');
  await details.locator('summary').click();
  assert.strictEqual(await details.evaluate(node => node.open), true, route.path + ' details expand by click');
  await details.locator('summary').click();
  assert.strictEqual(await details.evaluate(node => node.open), false, route.path + ' details collapse by click');
  console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' polaris-disclosure ' + route.id);
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

async function waitPaidReady(page, route) {
  await page.waitForFunction(({ marker, surface, routeId }) => {
    const account = window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount &&
      window.NorthStarAccountSession.getAccount();
    const cardReady = routeId === 'command-center'
      ? Boolean(document.querySelector('#commandCenterPolaris[data-polaris-card="northstar_polaris_intelligence_card_v1"]'))
      : Boolean(document.querySelector('#northstarPolarisSurfaceCard[data-state="ready"]'));
    return account && document.documentElement.getAttribute('data-northstar-navigation') === 'ready' &&
      !document.getElementById('northstarDemoToolbar') && document.querySelector(surface) && cardReady &&
      document.body.textContent.includes(marker);
  }, { marker: route.marker, surface: route.surface, routeId: route.id }, { timeout: 15000 });
}

async function inspectPaidCurrent(page, route, viewport) {
  await waitPaidReady(page, route);
  const snapshot = await page.evaluate(({ routeId, expectedPath }) => {
    function rect(node) {
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    }
    const mounted = routeId === 'command-center'
      ? document.querySelector('#commandCenterPolaris[data-polaris-card]')
      : document.getElementById('northstarPolarisSurfaceCard');
    const cardRect = rect(mounted);
    const contained = !mounted || Array.from(mounted.querySelectorAll('li, a, p, span')).filter(node => {
      return typeof node.checkVisibility === 'function'
        ? node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : node.getClientRects().length > 0;
    }).every(node => {
      const value = rect(node);
      return value.left >= cardRect.left - 1 && value.right <= cardRect.right + 1;
    });
    const sidebarLinks = Array.from(document.querySelectorAll('.sidebar-nav a')).map(node => ({
      id: node.dataset.navId, href: node.getAttribute('href'), current: node.getAttribute('aria-current'),
    }));
    const mobileLinks = Array.from(document.querySelectorAll('.mobile-menu-nav a')).map(node => ({
      id: node.dataset.navId, href: node.getAttribute('href'), current: node.getAttribute('aria-current'),
    }));
    return {
      pathname: location.pathname,
      expectedPath,
      body: document.body.innerText,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      toolbar: Boolean(document.getElementById('northstarDemoToolbar')),
      sidebarLinks,
      mobileLinks,
      activeSidebar: sidebarLinks.filter(item => item.current === 'page').map(item => item.id),
      activeMobile: mobileLinks.filter(item => item.current === 'page').map(item => item.id),
      cardCount: document.querySelectorAll('[data-polaris-card="northstar_polaris_intelligence_card_v1"]').length,
      cardContract: mounted && mounted.dataset.polarisCard,
      cardSurface: mounted && mounted.dataset.polarisSurface,
      cardState: routeId === 'command-center' ? 'ready' : mounted && mounted.dataset.state,
      cardText: mounted && mounted.innerText,
      cardDetailed: Boolean(mounted && mounted.querySelector('.polaris-card-details')),
      cardContained: contained,
      objectHrefs: mounted ? Array.from(mounted.querySelectorAll('.polaris-card-object-links a')).map(node => node.getAttribute('href')) : [],
    };
  }, { routeId: route.id, expectedPath: route.paidPath });

  assert.strictEqual(snapshot.pathname, route.paidPath, route.paidPath + ' exact paid route');
  assert.strictEqual(snapshot.toolbar, false, route.paidPath + ' has no demo controls');
  assert.strictEqual(snapshot.sidebarLinks.length, ROUTES.length, route.paidPath + ' full paid desktop navigation');
  assert.strictEqual(snapshot.mobileLinks.length, ROUTES.length, route.paidPath + ' full paid mobile navigation');
  assert.deepStrictEqual(snapshot.sidebarLinks.map(item => item.href), ROUTES.map(item => item.paidPath),
    route.paidPath + ' exact paid desktop destinations');
  assert.deepStrictEqual(snapshot.mobileLinks.map(item => item.href), ROUTES.map(item => item.paidPath),
    route.paidPath + ' exact paid mobile destinations');
  assert.deepStrictEqual(snapshot.activeSidebar, [route.id], route.paidPath + ' paid desktop active destination');
  assert.deepStrictEqual(snapshot.activeMobile, [route.id], route.paidPath + ' paid mobile active destination');
  assert.strictEqual(snapshot.cardCount, 1, route.paidPath + ' exactly one mounted Polaris card');
  assert.strictEqual(snapshot.cardContract, 'northstar_polaris_intelligence_card_v1', route.paidPath + ' shared card contract');
  assert.strictEqual(snapshot.cardSurface, route.id, route.paidPath + ' page-specific projection');
  assert.strictEqual(snapshot.cardState, 'ready', route.paidPath + ' role-authorized projection ready');
  assert.strictEqual(snapshot.cardContained, true, route.paidPath + ' card content stays contained');
  assert.strictEqual(snapshot.cardDetailed, ['command-center', 'leads', 'polaris'].includes(route.id),
    route.paidPath + ' detailed-card depth');
  assert.ok(snapshot.overflow <= 1, route.paidPath + ' has no horizontal overflow at ' + viewport.label);
  assert.ok(snapshot.cardText.includes(PAID_CUSTOMER_A), route.paidPath + ' reads real tenant A data');
  assert.ok(!snapshot.body.includes(PAID_CUSTOMER_B), route.paidPath + ' excludes tenant B data');
  assert.ok(!/Simulate Lead|Reset demo|account-free demo workspace|fictional demo workspace/i.test(snapshot.body),
    route.paidPath + ' contains no demo controls or language');
  assert.ok(!snapshot.cardText.includes('[object Object]') && !snapshot.cardText.includes('Not calculated'),
    route.paidPath + ' card remains human-readable');
  assert.ok(snapshot.objectHrefs.every(href => href && href.startsWith('/dashboard')),
    route.paidPath + ' actions remain in paid role-authorized routes');
  assert.ok(snapshot.objectHrefs.filter(href => href.startsWith('/dashboard/polaris?')).length >= 3,
    route.paidPath + ' exposes customer, lead, and work detail paths');
  return snapshot;
}

async function clickPaidRoute(page, origin, route, viewport) {
  const mobile = viewport.width <= 768;
  if (mobile) {
    await page.click('#navHamburgerBtn');
    await page.waitForFunction(() => document.getElementById('mobileMenu').classList.contains('open'));
  }
  const selector = (mobile ? '.mobile-menu-nav' : '.sidebar-nav') + ' a[data-nav-id="' + route.id + '"]';
  await Promise.all([
    page.waitForURL(url => url.origin === origin && url.pathname === route.paidPath, { timeout: 15000 }),
    page.click(selector),
  ]);
  return inspectPaidCurrent(page, route, viewport);
}

async function exercisePaidViewport(browser, origin, viewport, session, ledger) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
  context.setDefaultTimeout(10000);
  await context.addCookies(Object.entries(session.cookies).map(([name, value]) => ({
    name, value, url: origin, httpOnly: name !== 'northstar_csrf', sameSite: 'Lax',
  })));
  const label = 'paid-' + viewport.label;
  const page = await context.newPage();
  page.on('request', request => ledger.requests.push({ viewport: label, method: request.method(), url: request.url() }));
  page.on('response', response => {
    if (response.status() >= 400) ledger.httpErrors.push({ viewport: label, status: response.status(), url: response.url() });
  });
  page.on('console', message => {
    const location = message.location();
    const source = location && location.url ? ' [' + location.url + (location.lineNumber != null ? ':' + location.lineNumber : '') + ']' : '';
    if (message.type() === 'warning') ledger.warnings.push(label + ': ' + message.text() + source);
    if (message.type() === 'error') ledger.consoleErrors.push(label + ': ' + message.text() + source);
  });
  page.on('pageerror', error => ledger.pageErrors.push(label + ': ' + error.message));
  try {
    const entry = await page.goto(origin + ROUTES[0].paidPath, { waitUntil: 'domcontentloaded', timeout: 15000 });
    assert.ok(entry && [200, 304].includes(entry.status()), 'paid Command Center shell loads');
    const first = await inspectPaidCurrent(page, ROUTES[0], viewport);
    assert.strictEqual(first.objectHrefs.length >= 3, true, viewport.label + ' paid Command Center exposes complete object paths');
    await exercisePolarisDisclosure(page, { ...ROUTES[0], path: ROUTES[0].paidPath }, viewport);

    for (const route of ROUTES.slice(1)) {
      await clickPaidRoute(page, origin, route, viewport);
      await exercisePolarisDisclosure(page, { ...route, path: route.paidPath }, viewport);
      console.log('PARITY_BROWSER_CHECKPOINT paid-' + viewport.label + ' route ' + route.id);
    }

    await clickPaidRoute(page, origin, ROUTES[0], viewport);
    const leadLink = page.locator('#commandCenterPolaris .polaris-card-object-links a', { hasText: 'lead detail' }).first();
    const leadHref = await leadLink.getAttribute('href');
    assert.ok(leadHref && leadHref.startsWith('/dashboard/polaris?kind=lead&id='), viewport.label + ' paid lead path');
    await Promise.all([
      page.waitForURL(url => url.origin === origin && url.pathname + url.search === leadHref, { timeout: 15000 }),
      leadLink.click(),
    ]);
    const detail = await inspectPaidCurrent(page, ROUTES[1], viewport);
    assert.ok(detail.cardText.includes(PAID_CUSTOMER_A) && detail.cardText.includes('Evidence'),
      viewport.label + ' paid role-authorized complete Polaris detail');
    assert.ok(!detail.cardText.includes(PAID_CUSTOMER_B), viewport.label + ' paid detail excludes tenant B');
    console.log('PARITY_BROWSER_CHECKPOINT paid-' + viewport.label + ' complete');
    return { viewport: viewport.label, routes: ROUTES.length, tenant: PAID_ORG_A };
  } finally {
    await context.close();
  }
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
    await exercisePolarisDisclosure(page, ROUTES[0], viewport);
    assert.strictEqual(initial.workspace.session.durable, false, viewport.label + ' GET remains projection-only');
    assert.strictEqual(initial.workspace.graphs.length, 3, viewport.label + ' seed graph count');
    const initialConfiguration = initial.workspace.configuration;
    const initialNavigation = initial.workspace.navigation;
    const initialDigest = initial.workspace.integrity.digest;
    await exerciseTheme(page, viewport);
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' theme');

    for (const route of ROUTES.slice(1)) {
      const snapshot = await clickRoute(page, origin, route, 1, viewport);
      await exercisePolarisDisclosure(page, route, viewport);
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
    const simulatedCommandCard = await inspectCurrent(page, ROUTES[0], 2, viewport);
    assert.ok(simulatedCommandCard.polarisObjectHrefs.some(href => href && href.includes(encodeURIComponent(added.ids.lead))),
      viewport.label + ' Command Center card links to the simulated lead detail');

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
    const detailPath = polarisRoute.path + '?kind=lead&id=' + encodeURIComponent(added.ids.lead);
    const detailLink = page.locator('#commandCenterPolaris .polaris-card-object-links a', { hasText: 'lead detail' }).first();
    assert.strictEqual(await detailLink.getAttribute('href'), detailPath, viewport.label + ' exact lead-detail destination');
    await Promise.all([
      page.waitForURL(url => url.origin === origin && url.pathname + url.search === detailPath, { timeout: 15000 }),
      detailLink.click(),
    ]);
    const detail = await inspectCurrent(page, polarisRoute, 2, viewport);
    console.log('PARITY_BROWSER_CHECKPOINT ' + viewport.label + ' polaris-detail');
    assert.ok(detail.polarisCardText.includes(added.customer.name), viewport.label + ' customer detail is human-readable');
    assert.ok(detail.polarisCardText.includes(added.lead.serviceLabel), viewport.label + ' lead detail retains service context');
    assert.ok(detail.polarisCardText.includes('Evidence'), viewport.label + ' complete supporting evidence is available');
    assert.ok(detail.polarisCardText.includes('Missing information'), viewport.label + ' missing inputs are explained');
    assert.ok(detail.polarisObjectHrefs.some(href => href && href.includes(encodeURIComponent(added.ids.customer))),
      viewport.label + ' customer object has a complete detail path');
    assert.ok(detail.polarisObjectHrefs.some(href => href && href.includes(encodeURIComponent(added.ids.work))),
      viewport.label + ' work object has a complete detail path');
    await exercisePolarisDisclosure(page, polarisRoute, viewport);

    for (const id of ['team', 'ai-settings', 'business-profile', 'settings', 'integrations']) {
      const route = ROUTES.find(candidate => candidate.id === id);
      const snapshot = await clickRoute(page, origin, route, 2, viewport);
      assert.deepStrictEqual(snapshot.workspace.configuration, initialConfiguration, route.path + ' configuration stability');
      assert.ok(snapshot.polarisObjectHrefs.some(href => href && href.includes(encodeURIComponent(added.ids.lead))),
        route.path + ' Polaris card advances with the simulated canonical state');
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
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1, 'Paid Browser Organization A', 'paid-browser-a@northstar.test'),
        ($2, 'Paid Browser Organization B', 'paid-browser-b@northstar.test')`,
      [PAID_ORG_A, PAID_ORG_B]
    );
    for (const user of [
      [PAID_USER_A, PAID_ORG_A, 'paid-browser-owner-a@northstar.test'],
      [PAID_USER_B, PAID_ORG_B, 'paid-browser-owner-b@northstar.test'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used','owner','active')`,
        [user[0], user[1], user[2], user[2]]
      );
    }
    await pool.query(
      `INSERT INTO notification_preferences (
         organization_id, email_new_lead, email_call_summary, email_appointment,
         sms_new_lead, sms_urgent, notification_email, notification_phone
       ) VALUES
         ($1,TRUE,TRUE,TRUE,FALSE,TRUE,'paid-browser-owner-a@northstar.test',''),
         ($2,FALSE,FALSE,FALSE,FALSE,FALSE,'paid-browser-owner-b@northstar.test','')`,
      [PAID_ORG_A, PAID_ORG_B]
    );
    await pool.query(
      `INSERT INTO organization_account_preferences (organization_id, preferences)
       VALUES ($1,'{}'::jsonb),($2,'{}'::jsonb)`,
      [PAID_ORG_A, PAID_ORG_B]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: PAID_ORG_A,
      userId: PAID_USER_A,
      expectedVersion: null,
      profile: paidBusinessProfile('Paid Browser Organization A'),
    });
    await putBusinessProfile(pool, {
      organizationId: PAID_ORG_B,
      userId: PAID_USER_B,
      expectedVersion: null,
      profile: paidBusinessProfile('Paid Browser Organization B'),
    });
    const paidA = await ingestRetell(pool, paidGraphRequest(PAID_ORG_A, 'paid-browser-a', PAID_CUSTOMER_A, '+15550101001'));
    const paidB = await ingestRetell(pool, paidGraphRequest(PAID_ORG_B, 'paid-browser-b', PAID_CUSTOMER_B, '+15550101002'));
    assert.strictEqual(paidA.status, 201, 'tenant A real canonical graph created');
    assert.strictEqual(paidB.status, 201, 'tenant B negative-control graph created');
    const paidSession = await provisionDurableSession(pool, {
      userId: PAID_USER_A, organizationId: PAID_ORG_A, role: 'owner',
    });
    global.fetch = async function () { throw new Error('provider boundary must remain unused'); };
    const { app } = require('../../src/server');
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
    const ledger = { requests: [], httpErrors: [], warnings: [], consoleErrors: [], pageErrors: [] };
    const receipts = [];
    for (const viewport of selectedViewports) receipts.push(await exerciseViewport(browser, origin, viewport, ledger));
    const paidReceipts = [];
    for (const viewport of selectedViewports) {
      paidReceipts.push(await exercisePaidViewport(browser, origin, viewport, paidSession, ledger));
    }

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
      paidReceipts,
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
