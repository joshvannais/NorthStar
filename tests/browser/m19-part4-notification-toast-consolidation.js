'use strict';

const assert = require('assert');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
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
  Object.freeze({ label: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ label: 'mobile', width: 390, height: 844 }),
]);
const THEMES = Object.freeze(['light', 'dark']);
const PAYLOAD = '<img src=x onerror="window.__slice4Pwned=1"><script>window.__slice4Pwned=2</script>';
const SURFACES = Object.freeze([
  Object.freeze({ label: 'Business Profile', route: '/dashboard/business-profile', mode: 'bp' }),
  Object.freeze({ label: 'My Number', route: '/dashboard/my-number', mode: 'legacy', natural: 'my-number', expected: 'Please enter a full phone number' }),
  Object.freeze({ label: 'Settings', route: '/dashboard/settings', mode: 'legacy', natural: 'settings', expected: 'Twilio integration coming soon' }),
  Object.freeze({ label: 'Integrations', route: '/dashboard/integrations', mode: 'legacy', natural: 'integrations', expected: 'Please enter a valid email address' }),
  Object.freeze({ label: 'Leads', route: '/dashboard/leads', mode: 'premium' }),
  Object.freeze({ label: 'Communications', route: '/dashboard/communications', mode: 'premium' }),
  Object.freeze({ label: 'Calendar', route: '/dashboard/calendar', mode: 'legacy' }),
  Object.freeze({ label: 'AI Settings', route: '/dashboard/ai-settings', mode: 'legacy' }),
  Object.freeze({ label: 'Lead Detail', route: '/dashboard/lead?id=00000000-0000-4000-8000-000000000404', mode: 'legacy' }),
  Object.freeze({ label: 'Public Contact fallback', route: '/contact', mode: 'legacy', serviceAbsent: true }),
]);

function json(body, status = 200) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function account() {
  return {
    user: {
      id: '00000000-0000-4000-8000-000000000401',
      status: 'active',
      email: 'owner@example.test',
      phone: '+15555550199',
    },
    organization: {
      id: '00000000-0000-4000-8000-000000000402',
      name: 'NorthStar Notification Test',
    },
    navigation: navigationFixture(),
    memberships: [{ role: 'owner', status: 'active' }],
    onboarding: { status: 'complete' },
    subscription: { safe: true, state: 'active', readOnly: false, showTrialBanner: false },
  };
}

function canonicalProjection(surface) {
  return {
    success: true,
    data: {
      surface,
      readModelVersion: 'm19-part3-read-v1',
      digest: '4'.repeat(64),
      items: [],
      records: [],
      metrics: { graphCount: 0, appointmentCount: 0, estimatedRevenue: null },
      authority: {
        userId: account().user.id,
        organizationId: account().organization.id,
        sessionId: 'slice4-browser-session',
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
    evidence.api.push({ method: request.method(), path: url.pathname });
    assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(request.method()), `unexpected mutation ${request.method()} ${url.pathname}`);

    if (url.pathname === '/api/auth/me') return route.fulfill(json({ account: account() }));
    if (url.pathname === '/api/account/subscription') {
      return route.fulfill(json({ subscription: account().subscription }));
    }
    if (url.pathname === '/api/account/preferences') return route.fulfill(json({ preferences: {} }));
    if (url.pathname === '/api/v1/business-profile') {
      return route.fulfill(json({ success: true, data: canonicalFenceProfile({
        companyName: 'NorthStar Notification Test',
        version: 1,
      }) }));
    }
    if (url.pathname === '/api/integrations/jobber/status') {
      return route.fulfill(json({ available: false, configured: false, connected: false }));
    }
    if (url.pathname === '/api/events') return route.fulfill(json([]));
    if (url.pathname === '/api/leads') return route.fulfill(json({ items: [], records: [] }));
    if (url.pathname.includes('/api/v1/canonical/compat/')) {
      return route.fulfill(json(canonicalProjection(url.pathname.split('/').pop())));
    }
    if (url.pathname === '/api/health') {
      return route.fulfill(json({ status: 'ok', database: 'healthy', canonicalPersistence: 'healthy' }));
    }
    return route.fulfill(json({ success: true, data: {}, items: [], records: [] }));
  });
}

async function triggerNatural(page, surface) {
  if (!surface.natural) return;
  if (surface.natural === 'my-number') {
    await page.evaluate(() => {
      document.getElementById('businessNumber').value = '';
      window.saveNumber();
    });
  } else if (surface.natural === 'settings') {
    await page.locator('#integration-twilio button').click();
  } else if (surface.natural === 'integrations') {
    await page.evaluate(() => {
      window.connectIntegration('email');
      window.confirmConnection();
    });
  }
  await page.waitForFunction(expected => {
    const element = document.getElementById('toast');
    return element && element.classList.contains('show') && element.textContent === expected;
  }, surface.expected);
  const observed = await page.locator('#toast').evaluate(element => ({
    text: element.textContent,
    count: document.querySelectorAll('#toast.show').length,
  }));
  assert.deepStrictEqual(observed, { text: surface.expected, count: 1 }, `${surface.label}: natural trigger wording`);
}

async function exerciseToast(page, surface, viewport, theme) {
  const before = await page.evaluate(() => ({
    bodyX: document.body.getBoundingClientRect().x,
    bodyWidth: document.body.getBoundingClientRect().width,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  const observed = await page.evaluate(({ mode, payload }) => {
    window.__slice4Pwned = 0;
    if (mode === 'premium') window.NotificationService.show(payload, 'error');
    else window.showToast(payload, 'error');
    const selector = mode === 'premium' ? '.toast-notification.error' : '#toast.show';
    const toast = document.querySelector(selector);
    const body = mode === 'premium' ? toast && toast.querySelector('.toast-body') : toast;
    const container = document.getElementById('toastContainer');
    const themeToggle = document.querySelector('[data-northstar-theme-toggle]');
    const style = toast ? getComputedStyle(toast) : null;
    const toastRect = toast ? toast.getBoundingClientRect() : null;
    const toggleRect = themeToggle ? themeToggle.getBoundingClientRect() : null;
    const overlapWidth = toastRect && toggleRect
      ? Math.max(0, Math.min(toastRect.right, toggleRect.right) - Math.max(toastRect.left, toggleRect.left))
      : 0;
    const overlapHeight = toastRect && toggleRect
      ? Math.max(0, Math.min(toastRect.bottom, toggleRect.bottom) - Math.max(toastRect.top, toggleRect.top))
      : 0;
    return {
      count: document.querySelectorAll(selector).length,
      text: body && body.textContent,
      role: toast && toast.getAttribute('role'),
      live: toast && toast.getAttribute('aria-live'),
      atomic: toast && toast.getAttribute('aria-atomic'),
      className: toast && toast.className,
      maliciousElements: toast ? toast.querySelectorAll('img,script,svg').length : -1,
      executed: window.__slice4Pwned,
      bottom: style && style.bottom,
      right: style && style.right,
      themeTogglePresent: Boolean(themeToggle),
      themeToggleIntersectionArea: overlapWidth * overlapHeight,
      containerTop: container && container.style.top,
      containerLeft: container && container.style.left,
      containerTransform: container && container.style.transform,
      serviceAvailable: Boolean(window.NotificationService),
      after: {
        bodyX: document.body.getBoundingClientRect().x,
        bodyWidth: document.body.getBoundingClientRect().width,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
    };
  }, { mode: surface.mode, payload: PAYLOAD });

  assert.strictEqual(observed.count, 1, `${surface.label}/${viewport}/${theme}: one notification`);
  assert.strictEqual(observed.text, PAYLOAD, `${surface.label}/${viewport}/${theme}: literal dynamic text`);
  assert.strictEqual(observed.maliciousElements, 0, `${surface.label}/${viewport}/${theme}: no payload elements`);
  assert.strictEqual(observed.executed, 0, `${surface.label}/${viewport}/${theme}: no payload execution`);
  assert.strictEqual(observed.role, 'alert', `${surface.label}/${viewport}/${theme}: severity role`);
  assert.strictEqual(observed.live, 'assertive', `${surface.label}/${viewport}/${theme}: live region`);
  assert.strictEqual(observed.atomic, 'true', `${surface.label}/${viewport}/${theme}: atomic announcement`);
  if (surface.serviceAbsent) {
    assert.strictEqual(observed.serviceAvailable, false, `${surface.label}: API fallback remains independent`);
  }
  assert.deepStrictEqual(observed.after, before, `${surface.label}/${viewport}/${theme}: no page shift or overflow`);
  assert.strictEqual(observed.after.scrollWidth, observed.after.clientWidth, `${surface.label}/${viewport}/${theme}: no horizontal overflow`);

  if (surface.mode === 'premium') {
    assert.strictEqual(observed.containerTop, '28px', `${surface.label}: premium top`);
    assert.strictEqual(observed.containerLeft, '50%', `${surface.label}: premium center`);
    assert.ok(observed.containerTransform.includes('translateX(-50%)'), `${surface.label}: premium transform`);
    const close = page.locator('.toast-notification.error .toast-close');
    assert.strictEqual(await close.getAttribute('aria-label'), 'Close notification', `${surface.label}: close label`);
    await close.focus();
    assert.strictEqual(await close.evaluate(element => document.activeElement === element), true, `${surface.label}: focusable close`);
    await close.click();
    assert.strictEqual(await page.locator('.toast-notification.error').count(), 0, `${surface.label}: close cleanup`);
  } else if (surface.mode === 'bp') {
    assert.ok(observed.className.split(/\s+/).includes('bp-toast'), `${surface.label}: Business Profile class`);
    assert.strictEqual(observed.bottom, '24px', `${surface.label}: Business Profile bottom`);
    assert.strictEqual(observed.right, '24px', `${surface.label}: Business Profile right`);
  } else {
    assert.ok(observed.className.split(/\s+/).includes('toast'), `${surface.label}: legacy class`);
    assert.strictEqual(observed.bottom, '70px', `${surface.label}: legacy bottom clears fixed theme control`);
    assert.strictEqual(observed.right, '14px', `${surface.label}: legacy safe-area edge`);
    assert.strictEqual(observed.themeTogglePresent, true, `${surface.label}: mounted fixed theme control`);
    assert.strictEqual(observed.themeToggleIntersectionArea, 0, `${surface.label}: toast does not overlap theme control`);
  }
}

async function main() {
  const selected = process.argv[2];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'usage: node m19-part4-notification-toast-consolidation.js <chrome|webkit>');
  const runtime = resolveBrowserRuntime(selected);
  const evidence = { requests: [], api: [], pages: [] };
  let server;
  let browser;
  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });

    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
        await context.addInitScript(selectedTheme => {
          localStorage.setItem('theme', selectedTheme);
        }, theme);
        await installBoundaries(context, origin, evidence);
        for (const surface of SURFACES) {
          const page = await context.newPage();
          const pageErrors = [];
          const consoleErrors = [];
          page.on('pageerror', error => pageErrors.push(error.stack || error.message));
          page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
          const response = await page.goto(origin + surface.route, { waitUntil: 'networkidle' });
          assert.strictEqual(response.status(), 200, `${surface.label}: mounted route status`);
          await page.waitForTimeout(50);
          await triggerNatural(page, surface);
          await exerciseToast(page, surface, viewport.label, theme);
          assert.deepStrictEqual(pageErrors, [], `${surface.label}/${viewport.label}/${theme}: no page errors`);
          assert.deepStrictEqual(consoleErrors, [], `${surface.label}/${viewport.label}/${theme}: no console errors`);
          evidence.pages.push({ surface: surface.label, viewport: viewport.label, theme });
          await page.close();
        }
        await context.close();
      }
    }

    assert.ok(evidence.requests.length > 0, 'mounted pages made observable loopback requests');
    assert.ok(evidence.api.length > 0, 'mounted pages exercised intercepted first-party API reads');
    assert.ok(evidence.api.every(entry => ['GET', 'HEAD', 'OPTIONS'].includes(entry.method)), 'no API mutation');
    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      browserVersion: browser.version(),
      pages: evidence.pages.length,
      surfaces: SURFACES.map(surface => surface.label),
      viewports: VIEWPORTS.map(viewport => viewport.label),
      themes: THEMES,
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
