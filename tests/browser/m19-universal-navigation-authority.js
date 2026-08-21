'use strict';

const assert = require('assert');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

[
  'DATABASE_URL', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
  'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
].forEach(name => { delete process.env[name]; });

const { app } = require('../../src/server');

const BASE_RED = process.env.M19_NAV_BASE_RED === '1';
const EXPECTED_NAVIGATION = Object.freeze([
  Object.freeze({ id: 'command-center', href: '/dashboard', label: 'Command Center' }),
  Object.freeze({ id: 'polaris', href: '/dashboard/polaris', label: 'POLARIS' }),
  Object.freeze({ id: 'leads', href: '/dashboard/leads', label: 'Leads' }),
  Object.freeze({ id: 'communications', href: '/dashboard/communications', label: 'Communications' }),
  Object.freeze({ id: 'calendar', href: '/dashboard/calendar', label: 'Calendar' }),
  Object.freeze({ id: 'team', href: '/dashboard/team', label: 'Team' }),
  Object.freeze({ id: 'business-profile', href: '/dashboard/business-profile', label: 'Business Profile' }),
  Object.freeze({ id: 'settings', href: '/dashboard/settings', label: 'Settings' }),
  Object.freeze({ id: 'integrations', href: '/dashboard/integrations', label: 'Integrations' }),
]);
const PAGES = Object.freeze([
  Object.freeze({ label: 'Canonical Command Center', route: '/dashboard', active: 'command-center' }),
  Object.freeze({ label: 'Lead detail', route: '/dashboard/lead?id=navigation-contract', active: 'leads' }),
  Object.freeze({ label: 'Executive brief', route: '/dashboard/executive-brief', active: 'command-center' }),
  ...(BASE_RED ? [] : [Object.freeze({ label: 'Canonical control', route: '/dashboard/leads', active: 'leads' })]),
]);
const ROLES = Object.freeze(BASE_RED ? ['owner'] : ['owner', 'admin', 'member', 'viewer']);
const VIEWPORTS = Object.freeze(BASE_RED
  ? [Object.freeze({ label: 'desktop', width: 1440, height: 900 })]
  : [
      Object.freeze({ label: 'desktop', width: 1440, height: 900 }),
      Object.freeze({ label: 'mobile', width: 390, height: 844 }),
    ]);
const THEMES = Object.freeze(BASE_RED ? ['light'] : ['light', 'dark']);
const PASSES = BASE_RED ? 1 : 2;

function json(body, status = 200) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function account(role, navigation) {
  return {
    user: {
      id: '00000000-0000-4000-8000-000000000901',
      status: 'active',
      email: role + '@navigation.example.test',
    },
    organization: {
      id: '00000000-0000-4000-8000-000000000902',
      name: 'Navigation Contract',
    },
    membership: {
      id: '00000000-0000-4000-8000-000000000903',
      role,
      status: 'active',
    },
    navigation: (navigation || EXPECTED_NAVIGATION).map(item => ({ id: item.id, href: item.href })),
    onboarding: { status: 'complete' },
    subscription: { safe: true, state: 'active', readOnly: false, showTrialBanner: false },
  };
}

function emptyProjection(surface) {
  return {
    success: true,
    data: {
      surface,
      readModelVersion: 'm19-part3-read-v1',
      digest: '0'.repeat(64),
      items: [],
      records: [],
      metrics: { graphCount: 0, appointmentCount: 0, estimatedRevenue: null },
      authority: {
        userId: '00000000-0000-4000-8000-000000000901',
        organizationId: '00000000-0000-4000-8000-000000000902',
        sessionId: 'm19-navigation-browser',
      },
    },
  };
}

function record(evidence, condition, message, actual) {
  if (!condition) evidence.failures.push(actual === undefined ? message : message + ': ' + JSON.stringify(actual));
}

function equal(evidence, actual, expected, message) {
  record(evidence, JSON.stringify(actual) === JSON.stringify(expected), message, { actual, expected });
}

async function installBoundaries(context, origin, role, evidence, navigation) {
  context.on('request', request => {
    let url;
    try { url = new URL(request.url()); } catch (_error) { return; }
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin !== origin) evidence.external.push({ method: request.method(), url: request.url() });
    else evidence.requests.push({ method: request.method(), path: url.pathname, type: request.resourceType() });
  });

  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    evidence.api.push({ method: request.method(), path: url.pathname });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      evidence.mutations.push({ method: request.method(), path: url.pathname });
      return route.fulfill(json({ error: 'mutations blocked by navigation browser boundary' }, 405));
    }
    if (url.pathname === '/api/auth/me') return route.fulfill(json({ account: account(role, navigation) }));
    if (url.pathname === '/api/account/subscription') {
      return route.fulfill(json({ subscription: account(role, navigation).subscription }));
    }
    if (url.pathname === '/api/account/preferences') return route.fulfill(json({ preferences: {} }));
    if (url.pathname.indexOf('/api/v1/canonical/compat/') === 0) {
      return route.fulfill(json(emptyProjection(decodeURIComponent(url.pathname.split('/').pop()))));
    }
    if (url.pathname === '/api/v1/business-profile') {
      return route.fulfill(json({ success: true, data: { company: {}, canonicalAuthority: null } }));
    }
    if (url.pathname === '/api/events') return route.fulfill(json([]));
    if (url.pathname === '/api/health') {
      return route.fulfill(json({ status: 'ok', components: { database: 'healthy', canonicalPersistence: 'healthy' } }));
    }
    return route.fulfill(json({
      success: true,
      data: {},
      items: [],
      records: [],
      customers: [],
      tasks: [],
      alerts: [],
    }));
  });
}

function expectedLinks(active) {
  return EXPECTED_NAVIGATION.map(item => ({
    id: item.id,
    href: item.href,
    label: item.label,
    current: item.id === active,
  }));
}

async function snapshot(page) {
  return page.evaluate(() => {
    function links(selector) {
      return Array.from(document.querySelectorAll(selector)).map(anchor => ({
        id: anchor.getAttribute('data-nav-id'),
        href: new URL(anchor.href, location.origin).pathname,
        label: anchor.textContent.trim().replace(/\s+/g, ' '),
        current: anchor.getAttribute('aria-current') === 'page' && anchor.classList.contains('active'),
      }));
    }
    return {
      state: document.documentElement.getAttribute('data-northstar-navigation'),
      sidebars: document.querySelectorAll('.sidebar').length,
      mobileHeaders: document.querySelectorAll('.mobile-header').length,
      mobileMenus: document.querySelectorAll('.mobile-menu').length,
      mobileOverlays: document.querySelectorAll('.mobile-overlay').length,
      desktopLinks: links('.sidebar-nav a'),
      mobileLinks: links('.mobile-menu-nav a'),
      logout: Array.from(document.querySelectorAll('[data-account-logout]')).map(anchor => ({
        href: new URL(anchor.href, location.origin).pathname,
        text: anchor.textContent.trim().replace(/\s+/g, ' '),
      })),
      localExecutiveBriefLinks: Array.from(document.querySelectorAll('.sidebar a')).filter(anchor =>
        anchor.textContent.indexOf('Executive Brief') >= 0).length,
      theme: document.documentElement.getAttribute('data-theme'),
      bodyX: document.body.getBoundingClientRect().x,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
}

async function exercisePass(page, origin, definition, role, viewport, theme, pass, evidence) {
  if (pass === 0) await page.goto(origin + definition.route, { waitUntil: 'domcontentloaded' });
  else await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);

  const observed = await snapshot(page);
  const expected = expectedLinks(definition.active);
  const label = [definition.label, role, viewport.label, theme, pass === 0 ? 'fresh' : 'reload'].join('/');
  record(evidence, observed.state === 'ready', label + ': canonical navigation reaches ready state', observed.state);
  record(evidence, observed.sidebars === 1, label + ': exactly one desktop sidebar', observed.sidebars);
  record(evidence, observed.mobileHeaders === 1 && observed.mobileMenus === 1 && observed.mobileOverlays === 1,
    label + ': exactly one mobile navigation shell', observed);
  equal(evidence, observed.desktopLinks, expected, label + ': desktop links/order/active state equal server contract');
  equal(evidence, observed.mobileLinks, expected, label + ': mobile links/order/active state equal server contract');
  equal(evidence, observed.logout, [
    { href: '/login', text: 'Sign Out' },
    { href: '/login', text: 'Sign Out' },
  ], label + ': one shared desktop and mobile logout owner');
  record(evidence, observed.localExecutiveBriefLinks === 0, label + ': no page-local Executive Brief navigation survives');
  record(evidence, observed.theme === theme, label + ': selected theme remains stable', observed.theme);
  record(evidence, observed.bodyX === 0 && observed.scrollWidth === observed.clientWidth,
    label + ': no horizontal page shift or overflow', observed);

  if (viewport.label === 'mobile' && observed.state === 'ready') {
    const hamburger = page.locator('#navHamburgerBtn');
    const count = await hamburger.count();
    record(evidence, count === 1, label + ': one keyboard-operable hamburger', count);
    if (count === 1) {
      await hamburger.click();
      const opened = await page.evaluate(() => ({
        menu: document.getElementById('mobileMenu').classList.contains('open'),
        overlay: document.getElementById('mobileOverlay').classList.contains('open'),
        overflow: document.body.style.overflow,
      }));
      record(evidence, opened.menu && opened.overlay && opened.overflow === 'hidden', label + ': hamburger opens navigation', opened);
      await page.keyboard.press('Escape');
      const closed = await page.evaluate(() => ({
        menu: document.getElementById('mobileMenu').classList.contains('open'),
        overlay: document.getElementById('mobileOverlay').classList.contains('open'),
        overflow: document.body.style.overflow,
      }));
      record(evidence, !closed.menu && !closed.overlay && closed.overflow === '', label + ': Escape closes navigation', closed);
    }
  }

  if (viewport.label === 'desktop' && observed.desktopLinks.length) {
    const focused = await page.evaluate(() => {
      const first = document.querySelector('.sidebar-nav a');
      first.focus();
      return document.activeElement === first;
    });
    record(evidence, focused, label + ': desktop navigation links receive keyboard focus');
  }
}

async function deepLinkNegative(browser, origin, evidence) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const projected = EXPECTED_NAVIGATION.filter(item => item.id !== 'business-profile');
  await context.addInitScript(() => localStorage.setItem('northstar-theme', 'light'));
  await installBoundaries(context, origin, 'viewer', evidence, projected);
  const page = await context.newPage();
  page.on('pageerror', error => evidence.pageErrors.push({ page: 'Deep-link negative', message: error.stack || error.message }));
  await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForURL(origin + '/dashboard', { timeout: 4000 });
  } catch (_error) {
    // The exact URL is recorded below so unchanged production produces an authentic red.
  }
  record(evidence, page.url() === origin + '/dashboard',
    'server-projected permission removal redirects a disallowed deep link to the first canonical destination', page.url());
  await page.close();
  await context.close();
}

async function main() {
  const selected = process.argv[2] || 'chrome';
  const runtime = resolveBrowserRuntime(selected);
  const evidence = {
    pages: [], requests: [], api: [], external: [], mutations: [], pageErrors: [], consoleErrors: [], failures: [],
  };
  let server;
  let browser;
  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });

    for (const role of ROLES) {
      for (const viewport of VIEWPORTS) {
        for (const theme of THEMES) {
          const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
          await context.addInitScript(selectedTheme => localStorage.setItem('northstar-theme', selectedTheme), theme);
          await installBoundaries(context, origin, role, evidence, EXPECTED_NAVIGATION);
          for (const definition of PAGES) {
            const page = await context.newPage();
            page.on('pageerror', error => evidence.pageErrors.push({ page: definition.label, message: error.stack || error.message }));
            page.on('console', message => {
              if (message.type() === 'error') evidence.consoleErrors.push({ page: definition.label, message: message.text() });
            });
            for (let pass = 0; pass < PASSES; pass += 1) {
              await exercisePass(page, origin, definition, role, viewport, theme, pass, evidence);
            }
            evidence.pages.push({ page: definition.label, role, viewport: viewport.label, theme, passes: PASSES });
            await page.close();
          }
          await context.close();
        }
      }
    }

    if (!BASE_RED) await deepLinkNegative(browser, origin, evidence);

    record(evidence, evidence.external.length === 0, 'no external traffic', evidence.external);
    record(evidence, evidence.mutations.length === 0, 'no provider or business mutation', evidence.mutations);
    record(evidence, evidence.pageErrors.length === 0, 'no page errors', evidence.pageErrors);
    record(evidence, evidence.consoleErrors.length === 0, 'no console errors', evidence.consoleErrors);

    const summary = {
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      browserVersion: browser.version(),
      baseRed: BASE_RED,
      mountedCases: evidence.pages.length,
      passesPerCase: PASSES,
      roles: ROLES,
      viewports: VIEWPORTS.map(item => item.label),
      themes: THEMES,
      pages: PAGES.map(item => item.label),
      loopbackRequests: evidence.requests.length,
      interceptedApiReads: evidence.api.length,
      externalRequests: evidence.external.length,
      mutations: evidence.mutations.length,
      providerActions: 0,
      databaseActions: 0,
      instrumentation: 'none; mounted pages use unmodified production navigation and account-session scripts',
      failures: evidence.failures,
      physicalSafari: false,
    };
    console.log(JSON.stringify(summary));
    assert.deepStrictEqual(evidence.failures, []);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
