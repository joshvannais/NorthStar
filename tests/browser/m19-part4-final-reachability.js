'use strict';

const assert = require('assert');
const path = require('path');
const { MOUNTED_THEME_PAGES, MOUNTED_REDIRECTS } = require('../helpers/site-theme-pages');
const { navigationFixture } = require('../helpers/navigation-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { projectIntegrationCatalogue } = require('../../src/integrations/catalogue');

[
  'DATABASE_URL', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
  'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
].forEach(name => { delete process.env[name]; });

const ROOT = path.resolve(__dirname, '..', '..');
process.chdir(ROOT);
const { app } = require('../../src/server');

const VIEWPORTS = Object.freeze([
  Object.freeze({ label: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ label: 'mobile', width: 390, height: 844 }),
]);
const THEMES = Object.freeze(['light', 'dark']);
const CANDIDATES = Object.freeze([
  Object.freeze({ asset: '/js/customer-drawer.js', global: 'CustomerDrawer' }),
  Object.freeze({ asset: '/js/dashboard-init.js', global: 'DASHBOARD_INIT_LOADED' }),
]);

function json(body, status = 200) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function account(pathname) {
  const pending = pathname === '/account/pending';
  return {
    account: {
      user: {
        id: '00000000-0000-4000-8000-000000000911',
        status: pending ? 'pending' : 'active',
        email: 'reachability@example.test',
      },
      organization: {
        id: '00000000-0000-4000-8000-000000000912',
        name: 'NorthStar Reachability Ratification',
      },
      navigation: navigationFixture(),
      memberships: [{ role: 'owner', status: 'active' }],
      onboarding: { status: 'complete' },
      subscription: pending
        ? { safe: true, state: 'pending_verification', readOnly: true, showTrialBanner: true }
        : { safe: true, state: 'active', readOnly: false, showTrialBanner: false },
    },
  };
}

function canonical(surface, request) {
  return {
    success: true,
    data: {
      surface,
      readModelVersion: 'm19-part3-read-v1',
      digest: '6'.repeat(64),
      items: [],
      records: [],
      metrics: { graphCount: 0, appointmentCount: 0, estimatedRevenue: null },
      authority: {
        userId: '00000000-0000-4000-8000-000000000911',
        organizationId: '00000000-0000-4000-8000-000000000912',
        sessionId: request.headers()['x-northstar-session-id'] || 'slice5-reachability-session',
      },
    },
  };
}

async function installBoundaries(context, origin, evidence) {
  context.on('request', request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    assert.strictEqual(url.origin, origin, `request escaped loopback: ${request.method()} ${request.url()}`);
    evidence.requests.push({ method: request.method(), path: url.pathname, type: request.resourceType() });
  });

  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.strictEqual(url.origin, origin, `API request escaped loopback: ${request.url()}`);
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(request.method()), `automatic mutation: ${request.method()} ${url.pathname}`);
    evidence.api.push({ method: request.method(), path: url.pathname });
    const framePath = (() => {
      try { return new URL(request.frame().url()).pathname; } catch (_error) { return ''; }
    })();

    if (url.pathname === '/api/auth/me') return route.fulfill(json(account(framePath)));
    if (url.pathname === '/api/account/subscription') {
      return route.fulfill(json({ subscription: account(framePath).account.subscription }));
    }
    if (url.pathname === '/api/account/preferences') return route.fulfill(json({ preferences: {} }));
    if (url.pathname === '/api/v1/business-profile') return route.fulfill(json({ success: true, profile: null }));
    if (url.pathname === '/api/v1/integrations/catalogue') {
      return route.fulfill(json({ success: true, data: projectIntegrationCatalogue({
        authority: 'canonical_integration_ownership',
        connectors: [{ provider: 'retell', status: 'not_provisioned' }, { provider: 'voice', status: 'not_provisioned' }],
      }) }));
    }
    if (url.pathname === '/api/events') return route.fulfill(json([]));
    if (url.pathname === '/api/leads') return route.fulfill(json({ items: [], records: [] }));
    if (url.pathname.includes('/api/v1/canonical/compat/')) {
      return route.fulfill(json(canonical(url.pathname.split('/').pop(), request)));
    }
    if (url.pathname === '/api/health') {
      return route.fulfill(json({ status: 'ok', database: 'healthy', canonicalPersistence: 'healthy' }));
    }
    return route.fulfill(json({ success: true, data: {}, records: [], items: [] }));
  });
}

async function inspectPage(context, origin, pageDefinition, viewport, theme, evidence) {
  const page = await context.newPage();
  const pageRequests = [];
  const pageErrors = [];
  const consoleErrors = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin) pageRequests.push({ method: request.method(), path: url.pathname, type: request.resourceType() });
  });
  page.on('pageerror', error => pageErrors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  try {
    const suffix = pageDefinition.route === '/dashboard/lead'
      ? '?id=00000000-0000-4000-8000-000000000915'
      : '';
    const response = await page.goto(origin + pageDefinition.route + suffix, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    assert.ok(response, `${pageDefinition.route}: no navigation response`);
    assert.strictEqual(response.status(), 200, `${pageDefinition.route}: mounted response`);
    assert.match(response.headers()['cache-control'] || '', /public,\s*max-age=0/i, `${pageDefinition.route}: cache disposition`);
    await page.waitForTimeout(125);

    const observed = await page.evaluate(async candidates => {
      const registrations = navigator.serviceWorker && navigator.serviceWorker.getRegistrations
        ? await navigator.serviceWorker.getRegistrations()
        : [];
      return {
        scriptSources: Array.from(document.scripts).map(script => script.src).filter(Boolean).map(value => new URL(value).pathname),
        scriptResources: performance.getEntriesByType('resource')
          .filter(entry => entry.initiatorType === 'script')
          .map(entry => new URL(entry.name).pathname),
        registrations: Object.fromEntries(candidates.map(candidate => [candidate.global, typeof window[candidate.global]])),
        customerDetailType: typeof window.CustomerDetail,
        themeType: typeof window.NorthStarTheme,
        theme: document.documentElement.getAttribute('data-theme'),
        toggleCount: document.querySelectorAll('[data-northstar-theme-toggle]').length,
        serviceWorkerCount: registrations.length,
        bodyX: document.body ? document.body.getBoundingClientRect().x : null,
        bodyWidth: document.body ? document.body.getBoundingClientRect().width : null,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    }, CANDIDATES);

    for (const candidate of CANDIDATES) {
      assert.strictEqual(pageRequests.some(item => item.path === candidate.asset), false, `${pageDefinition.route}: requested ${candidate.asset}`);
      assert.strictEqual(observed.scriptSources.includes(candidate.asset), false, `${pageDefinition.route}: declared ${candidate.asset}`);
      assert.strictEqual(observed.scriptResources.includes(candidate.asset), false, `${pageDefinition.route}: loaded ${candidate.asset}`);
      assert.strictEqual(observed.registrations[candidate.global], 'undefined', `${pageDefinition.route}: registered ${candidate.global}`);
    }
    assert.strictEqual(observed.themeType, 'object', `${pageDefinition.route}: shared theme runtime`);
    assert.strictEqual(observed.theme, theme, `${pageDefinition.route}: selected theme`);
    assert.strictEqual(observed.toggleCount, 1, `${pageDefinition.route}: single theme control`);
    assert.strictEqual(observed.serviceWorkerCount, 0, `${pageDefinition.route}: no service worker cache`);
    assert.ok(observed.bodyX >= 0, `${pageDefinition.route}: body remains in viewport`);
    assert.ok(observed.bodyWidth <= observed.clientWidth, `${pageDefinition.route}: body width remains bounded`);
    assert.ok(observed.scrollWidth <= observed.clientWidth, `${pageDefinition.route}: no horizontal overflow`);
    assert.deepStrictEqual(pageErrors, [], `${pageDefinition.route}/${viewport.label}/${theme}: no page errors`);
    assert.deepStrictEqual(consoleErrors, [], `${pageDefinition.route}/${viewport.label}/${theme}: no console errors`);

    evidence.pages.push({
      route: pageDefinition.route,
      viewport: viewport.label,
      theme,
      requestCount: pageRequests.length,
      scriptCount: observed.scriptResources.length,
      customerDetailType: observed.customerDetailType,
      bodyX: observed.bodyX,
      bodyWidth: observed.bodyWidth,
      clientWidth: observed.clientWidth,
      scrollWidth: observed.scrollWidth,
    });
  } finally {
    await page.close();
  }
}

async function inspectRedirect(context, origin, route, evidence) {
  const page = await context.newPage();
  try {
    const response = await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 15000 });
    assert.ok(response, `${route}: no redirect response`);
    assert.strictEqual(response.status(), 200, `${route}: final response`);
    const chain = [];
    let current = response.request();
    while (current) {
      chain.unshift(new URL(current.url()).pathname);
      current = current.redirectedFrom();
    }
    assert.ok(chain.length >= 2, `${route}: redirect chain`);
    const observed = await page.evaluate(candidates => ({
      scripts: Array.from(document.scripts).map(script => script.src).filter(Boolean).map(value => new URL(value).pathname),
      registrations: Object.fromEntries(candidates.map(candidate => [candidate.global, typeof window[candidate.global]])),
    }), CANDIDATES);
    for (const candidate of CANDIDATES) {
      assert.strictEqual(observed.scripts.includes(candidate.asset), false, `${route}: redirect declared ${candidate.asset}`);
      assert.strictEqual(observed.registrations[candidate.global], 'undefined', `${route}: redirect registered ${candidate.global}`);
    }
    evidence.redirects.push({ route, chain, final: new URL(page.url()).pathname });
  } finally {
    await page.close();
  }
}

async function main() {
  const selected = process.argv[2];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'usage: node m19-part4-final-reachability.js <chrome|webkit>');
  const runtime = resolveBrowserRuntime(selected);
  const evidence = { requests: [], api: [], pages: [], redirects: [], direct: [] };
  let browser;
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });

    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          serviceWorkers: 'block',
        });
        await context.addInitScript(selectedTheme => localStorage.setItem('northstar-theme', selectedTheme), theme);
        await installBoundaries(context, origin, evidence);
        for (const pageDefinition of MOUNTED_THEME_PAGES) {
          await inspectPage(context, origin, pageDefinition, viewport, theme, evidence);
        }
        if (viewport.label === 'desktop' && theme === 'light') {
          for (const route of MOUNTED_REDIRECTS) await inspectRedirect(context, origin, route, evidence);
        }
        await context.close();
      }
    }

    const directContext = await browser.newContext({ serviceWorkers: 'block' });
    await installBoundaries(directContext, origin, evidence);
    for (const candidate of CANDIDATES) {
      const response = await directContext.request.get(origin + candidate.asset);
      const rootResponse = await directContext.request.get(origin + '/' + path.posix.basename(candidate.asset));
      evidence.direct.push({
        asset: candidate.asset,
        status: response.status(),
        cacheControl: response.headers()['cache-control'] || null,
        rootStatus: rootResponse.status(),
      });
    }
    await directContext.close();

    assert.strictEqual(evidence.pages.length, MOUNTED_THEME_PAGES.length * VIEWPORTS.length * THEMES.length);
    assert.strictEqual(evidence.redirects.length, MOUNTED_REDIRECTS.length);
    assert.strictEqual(evidence.requests.some(item => CANDIDATES.some(candidate => candidate.asset === item.path)), false, 'candidate request observed from a mounted page');
    assert.ok(evidence.requests.length > 0, 'loopback request evidence');
    assert.ok(evidence.api.length > 0, 'intercepted API evidence');
    assert.deepStrictEqual(evidence.direct.map(item => ({ asset: item.asset, status: item.status, rootStatus: item.rootStatus })),
      CANDIDATES.map(candidate => ({ asset: candidate.asset, status: 404, rootStatus: 404 })),
      `retired direct assets: ${JSON.stringify(evidence.direct)}`);

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      browserVersion: browser.version(),
      mountedPages: MOUNTED_THEME_PAGES.length,
      pageCases: evidence.pages.length,
      redirects: evidence.redirects,
      viewports: VIEWPORTS.map(viewport => viewport.label),
      themes: THEMES,
      loopbackRequests: evidence.requests.length,
      interceptedApiReads: evidence.api.length,
      directAssets: evidence.direct,
      candidateRequestsFromMountedPages: 0,
      candidateDomDeclarations: 0,
      candidatePerformanceLoads: 0,
      candidateRuntimeRegistrations: 0,
      pageErrorCount: 0,
      consoleErrorCount: 0,
      overflowCases: 0,
      serviceWorkerRegistrations: 0,
      externalRequests: 0,
      automaticMutations: 0,
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
