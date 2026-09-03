'use strict';

const assert = require('assert');
const { app } = require('../../src/server');
const { buildDemoWorkspace, createInitialDemoState } = require('../../src/commandCenter/workspace');
const { navigationFixture } = require('../helpers/navigation-fixture');
const { MOUNTED_THEME_PAGES } = require('../helpers/site-theme-pages');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const VIEWPORTS = Object.freeze({
  desktop: { width: 1440, height: 900 },
  mobile390: { width: 390, height: 844 },
  mobile320: { width: 320, height: 720 },
  reflow200: { width: 640, height: 720, deviceScaleFactor: 2 },
});
const THEMES = Object.freeze(['light', 'dark']);
const FORBIDDEN_PRESENTATION = /```|\bJSON Schema\b|\b(?:stack trace|provider body|response body)\b|\b(?:POLARIS|INTERNAL|PROVIDER)_[A-Z0-9_]{3,}\b|\b(?:Lead|Customer|Request|Conversation) ID\b|\b[0-9a-f]{64}\b/i;
const DEMO_TENANT_ID = '00000000-0000-4000-8000-000000000701';
const DEMO_SESSION_ID = '00000000-0000-4000-8000-000000000702';

function response(body, status = 200) {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body), headers: { 'Cache-Control': 'no-store' } };
}

function accountFixture(role, pathname) {
  const pending = pathname === '/account/pending';
  return {
    account: {
      user: { id: '00000000-0000-4000-8000-000000000703', email: '', status: pending ? 'pending' : 'active' },
      organization: { id: DEMO_TENANT_ID, name: 'NorthStar Acceptance Fixture' },
      navigation: role === 'employee'
        ? [{ id: 'today', href: '/dashboard/today' }]
        : navigationFixture(),
      memberships: [{ role }],
      onboarding: { status: 'complete' },
      subscription: pending
        ? { safe: true, state: 'pending_verification', readOnly: true, showTrialBanner: true }
        : { safe: true, state: role === 'read-only' ? 'subscription_read_only' : 'active', readOnly: role === 'read-only', showTrialBanner: false },
    },
  };
}

function demoWorkspace() {
  return buildDemoWorkspace({
    tenantId: DEMO_TENANT_ID,
    sessionId: DEMO_SESSION_ID,
    state: createInitialDemoState(DEMO_TENANT_ID, new Date('2026-09-03T12:00:00.000Z')),
    revision: 1,
    simulationCount: 0,
    persisted: false,
    expiresAt: new Date('2099-09-04T12:00:00.000Z'),
  });
}

function canonicalFixture(request, surface) {
  return {
    success: true,
    data: {
      surface,
      readModelVersion: 'm19-part3-read-v1',
      digest: 'c'.repeat(64),
      items: [],
      records: [],
      metrics: { graphCount: 0, appointmentCount: 0, estimatedRevenue: null },
      authority: {
        userId: '00000000-0000-4000-8000-000000000703',
        organizationId: DEMO_TENANT_ID,
        sessionId: request.headers()['x-northstar-session-id'] || DEMO_SESSION_ID,
      },
    },
  };
}

async function installBoundary(context, origin, role, evidence) {
  context.on('request', request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    assert.strictEqual(url.origin, origin, `external request escaped loopback: ${url.origin}`);
    assert.strictEqual(Object.keys(request.headers()).some(name => name.toLowerCase() === 'authorization'), false);
    evidence.requests.push(`${request.method()} ${url.pathname}`);
  });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.strictEqual(url.origin, origin);
    const framePath = (() => { try { return new URL(request.frame().url()).pathname; } catch (_error) { return ''; } })();
    if (request.method() === 'POST' && url.pathname === '/api/telemetry') return route.fulfill(response({ accepted: true }, 202));
    assert.strictEqual(request.method(), 'GET', `automatic mutation attempted: ${request.method()} ${url.pathname}`);
    if (url.pathname === '/api/auth/me') return route.fulfill(response(accountFixture(role, framePath)));
    if (url.pathname === '/api/account/subscription') return route.fulfill(response({ subscription: accountFixture(role, framePath).account.subscription }));
    if (url.pathname === '/api/demo/command-center') return route.fulfill(response({ success: true, data: demoWorkspace() }));
    const demoCompat = url.pathname.match(/^\/api\/demo\/command-center\/canonical\/compat\/([^/]+)$/);
    if (demoCompat) return route.fulfill(response(canonicalFixture(request, decodeURIComponent(demoCompat[1]))));
    const paidCompat = url.pathname.match(/^\/api\/v1\/canonical\/compat\/([^/]+)$/);
    if (paidCompat) return route.fulfill(response(canonicalFixture(request, decodeURIComponent(paidCompat[1]))));
    if (url.pathname === '/api/v1/business-profile') return route.fulfill(response({ success: true, profile: null }));
    if (url.pathname === '/api/health') return route.fulfill(response({ status: 'ok', database: 'healthy', persistence: 'healthy' }));
    return route.fulfill(response({ success: true, data: {}, records: [], items: [] }));
  });
}

async function closeAutomaticQuickStart(page) {
  const dialog = page.locator('#northstarQuickStartDialog[open]');
  if (await dialog.count() === 0) return false;
  assert.strictEqual(await dialog.locator(':focus').count(), 1, 'Quick Start places focus inside the modal');
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.locator('#northstarQuickStartDialog[open]').count(), 0, 'Escape closes Quick Start');
  return true;
}

async function semanticAudit(page) {
  return page.evaluate(forbiddenSource => {
    function visible(element) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    }
    function labelText(element) {
      const labelledBy = (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
        .map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
      const explicit = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent || '' : '';
      const wrapped = element.closest('label')?.textContent || '';
      return (element.getAttribute('aria-label') || labelledBy || explicit || wrapped || element.alt || element.value || element.textContent || element.title || '')
        .replace(/\s+/g, ' ').trim();
    }
    function selector(element) {
      if (element.id) return `#${element.id}`;
      const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
    }
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(visible);
    const headingLevels = headings.map(heading => Number(heading.tagName.slice(1)));
    const headingSkips = [];
    for (let index = 1; index < headingLevels.length; index += 1) {
      if (headingLevels[index] > headingLevels[index - 1] + 1) {
        headingSkips.push({ from: headings[index - 1].textContent.trim(), to: headings[index].textContent.trim(), levels: [headingLevels[index - 1], headingLevels[index]] });
      }
    }
    const interactive = Array.from(document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])')).filter(visible);
    const unnamedControls = interactive.filter(element => !labelText(element)).map(selector);
    const unnamedNavigation = Array.from(document.querySelectorAll('nav')).filter(visible).filter(element => {
      return !(element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.title);
    }).map(selector);
    const inertInteractive = interactive.filter(element => {
      if (!element.matches('[role="button"],[role="link"],[tabindex]')) return false;
      if (element.matches('a[href],button,input,select,textarea')) return false;
      if (element.matches('[role="region"][aria-label],[role="region"][aria-labelledby]')) return false;
      return !element.hasAttribute('onclick') && !element.getAttribute('data-action') && !element.getAttribute('data-navigation-primary');
    }).map(selector);
    const badges = Array.from(document.querySelectorAll('[class*="pill"],[class*="badge"],[class*="chip"],[class*="tag"]')).filter(element => {
      if (!visible(element) || !element.textContent.trim() || element.children.length) return false;
      const style = getComputedStyle(element);
      const hasSurface = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
      const hasBorder = parseFloat(style.borderLeftWidth) > 0 || parseFloat(style.borderRightWidth) > 0;
      return hasSurface || hasBorder;
    }).map(element => {
      const style = getComputedStyle(element);
      return { selector: selector(element), left: parseFloat(style.paddingLeft) || 0, right: parseFloat(style.paddingRight) || 0, text: element.textContent.trim().slice(0, 50) };
    });
    return {
      h1: headings.filter(heading => heading.tagName === 'H1').map(heading => heading.textContent.trim()),
      headingSkips,
      mainCount: Array.from(document.querySelectorAll('main,[role="main"]')).filter(visible).length,
      unnamedNavigation,
      unnamedControls,
      inertInteractive,
      crampedBadges: badges.filter(badge => badge.left < 6 || badge.right < 6),
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      forbiddenPresentation: document.body.innerText.match(new RegExp(forbiddenSource, 'i'))?.[0] || null,
      bodyText: document.body.innerText.replace(/\s+/g, ' ').trim(),
    };
  }, FORBIDDEN_PRESENTATION.source);
}

async function exerciseQuickStartReopen(page) {
  const trigger = page.locator('[data-quick-start-reopen]:visible').first();
  if (await trigger.count() === 0) return null;
  await trigger.focus();
  await trigger.press('Enter');
  const dialog = page.locator('#northstarQuickStartDialog[open]');
  await dialog.waitFor();
  assert.strictEqual(await dialog.locator(':focus').count(), 1);
  const focusables = dialog.locator('a[href],button:not([disabled])');
  const count = await focusables.count();
  assert.ok(count >= 2);
  await focusables.first().focus();
  await page.keyboard.press('Shift+Tab');
  assert.strictEqual(await dialog.evaluate(element => element.contains(document.activeElement)), true, 'reverse Tab remains in dialog');
  await page.keyboard.press('Escape');
  assert.strictEqual(await trigger.evaluate(element => document.activeElement === element), true, 'Quick Start restores opener focus');
  return { focusables: count };
}

async function run(engine, origin) {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
  const evidence = [];
  const failures = [];
  try {
    const selectedRoutes = process.env.NORTHSTAR_P7_ROUTE
      ? MOUNTED_THEME_PAGES.filter(entry => entry.route === process.env.NORTHSTAR_P7_ROUTE)
      : MOUNTED_THEME_PAGES;
    assert.ok(selectedRoutes.length > 0, 'NORTHSTAR_P7_ROUTE must select a mounted route');
    const selectedViewports = process.env.NORTHSTAR_P7_VIEWPORT
      ? [[process.env.NORTHSTAR_P7_VIEWPORT, VIEWPORTS[process.env.NORTHSTAR_P7_VIEWPORT]]]
      : Object.entries(VIEWPORTS);
    assert.ok(selectedViewports.every(([, value]) => value), 'unknown NORTHSTAR_P7_VIEWPORT');
    const selectedThemes = process.env.NORTHSTAR_P7_THEME ? [process.env.NORTHSTAR_P7_THEME] : THEMES;
    assert.ok(selectedThemes.every(theme => THEMES.includes(theme)), 'unknown NORTHSTAR_P7_THEME');

    for (const [viewportName, viewport] of selectedViewports) {
      for (const theme of selectedThemes) {
        const context = await browser.newContext({ viewport, colorScheme: theme });
        const boundary = { requests: [] };
        await context.addInitScript(selectedTheme => {
          try { localStorage.setItem('northstar-theme', selectedTheme); } catch (_error) {}
        }, theme);
        await installBoundary(context, origin, 'owner', boundary);
        const page = await context.newPage();
        const pageErrors = [];
        const consoleErrors = [];
        page.on('pageerror', error => pageErrors.push(String(error && error.message || error)));
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
        try {
          for (const entry of selectedRoutes) {
            await page.goto(`${origin}${entry.route}`, { waitUntil: 'networkidle' });
            if (entry.surface === 'dashboard' || entry.surface === 'public-demo') {
              await page.waitForFunction(() => ['ready', 'denied'].includes(document.documentElement.getAttribute('data-northstar-navigation')), null, { timeout: 5000 });
            }
            await closeAutomaticQuickStart(page);
            const audit = await semanticAudit(page);
            const label = `${engine} ${viewportName} ${theme} ${entry.route}`;
            if (audit.h1.length !== 1) failures.push({ label, kind: 'h1', value: audit.h1 });
            if (audit.mainCount !== 1) failures.push({ label, kind: 'main', value: audit.mainCount });
            if (audit.headingSkips.length) failures.push({ label, kind: 'heading-skips', value: audit.headingSkips });
            if (audit.unnamedNavigation.length) failures.push({ label, kind: 'unnamed-navigation', value: audit.unnamedNavigation });
            if (audit.unnamedControls.length) failures.push({ label, kind: 'unnamed-controls', value: audit.unnamedControls });
            if (audit.inertInteractive.length) failures.push({ label, kind: 'inert-interactive', value: audit.inertInteractive });
            if (audit.crampedBadges.length) failures.push({ label, kind: 'cramped-badges', value: audit.crampedBadges.slice(0, 20) });
            if (audit.overflow > 1) failures.push({ label, kind: 'horizontal-overhang', value: audit.overflow });
            if (audit.forbiddenPresentation) failures.push({ label, kind: 'developer-presentation', value: audit.forbiddenPresentation });
            if (entry.route.endsWith('/polaris')) {
              if (!/No conversation selected|Choose a conversation|Ask Polaris|Start a conversation|Welcome to POLARIS/i.test(audit.bodyText)) {
                failures.push({ label, kind: 'polaris-empty-state', value: audit.bodyText.slice(0, 500) });
              }
            }
            const quickStart = entry.route === '/dashboard' && viewportName === 'mobile390' && theme === 'light'
              ? await exerciseQuickStartReopen(page)
              : null;
            evidence.push({ route: entry.route, viewport: viewportName, theme, quickStart, requests: boundary.requests.length });
          }
          assert.deepStrictEqual(pageErrors, [], `${engine} page errors`);
          assert.deepStrictEqual(consoleErrors, [], `${engine} console errors`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }
  assert.deepStrictEqual(failures, [], `${engine} route acceptance failures: ${JSON.stringify(failures)}`);
  return evidence;
}

async function main() {
  const selection = process.env.NORTHSTAR_BROWSER || 'all';
  assert.ok(['chrome', 'firefox', 'webkit', 'all'].includes(selection), 'NORTHSTAR_BROWSER must be chrome, firefox, webkit, or all');
  const engines = selection === 'all' ? ['chrome', 'firefox', 'webkit'] : [selection];
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const runs = [];
    for (const engine of engines) runs.push({ engine, evidence: await run(engine, origin) });
    process.stdout.write(`${JSON.stringify({ success: true, runs })}\n`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
