'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const PUBLIC_ROOT = path.resolve(__dirname, '../../public');
const VIEWPORTS = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 },
];
const INTERNAL_LANGUAGE = /\bPR (?:A|B1|B2)\b|PR #|pull request|phase B[12]\b|internal phase|development milestone|implementation availability/i;
const TOKEN = 'A'.repeat(43);
const EXPIRED_TOKEN = 'B'.repeat(43);

function contentType(file) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  })[path.extname(file)] || 'application/octet-stream';
}

function safePublicFile(pathname) {
  const pageFiles = {
    '/verify-email': 'verify-email.html',
    '/login': 'login.html',
    '/account/pending': 'account/pending.html',
    '/dashboard': 'dashboard/command-center.html',
    '/admin': 'admin.html',
  };
  const relative = pageFiles[pathname] || (
    /^\/(?:css|js|assets)\/[A-Za-z0-9._/-]+$/.test(pathname) ? pathname.slice(1) : ''
  );
  if (!relative) return null;
  const file = path.resolve(PUBLIC_ROOT, relative);
  return file.startsWith(`${PUBLIC_ROOT}${path.sep}`) ? file : null;
}

function json(response, status, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': encoded.length,
    'Cache-Control': 'no-store',
  });
  response.end(encoded);
}

async function createMountedServer() {
  const authority = {
    subscription: null,
    requests: [],
    verificationPosts: 0,
    resendPosts: 0,
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    authority.requests.push({ method: request.method, path: url.pathname });
    if (request.method === 'GET' && url.pathname === '/api/auth/me') {
      return json(response, 200, {
        account: {
          user: { email: '' },
          organization: { onboardingCompleted: false },
          memberships: [{ role: 'owner' }],
          subscription: authority.subscription,
        },
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/account/subscription') {
      return json(response, 200, { subscription: authority.subscription });
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/verify-email') {
      authority.verificationPosts += 1;
      let raw = '';
      request.on('data', chunk => { raw += chunk; });
      request.on('end', () => {
        let token = '';
        try { token = JSON.parse(raw).token; } catch (_error) {}
        if (token === TOKEN) return json(response, 200, { success: true });
        return json(response, 400, { error: 'Verification link is invalid or expired', code: 'invalid_action_token' });
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/resend-verification') {
      authority.resendPosts += 1;
      return json(response, 202, { accepted: true });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/')) return json(response, 200, {});
    const file = request.method === 'GET' ? safePublicFile(url.pathname) : null;
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      response.writeHead(200, { 'Content-Type': contentType(file), 'Referrer-Policy': 'no-referrer' });
      fs.createReadStream(file).pipe(response);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    authority,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function trialProjection(daysRemaining, endsToday = false) {
  return {
    safe: true,
    state: 'trialing',
    trialStart: '2026-08-04T00:00:00.000Z',
    trialEnd: '2026-08-18T00:00:00.000Z',
    serverTimestamp: '2026-08-04T00:00:00.000Z',
    daysRemaining,
    endsToday,
    readOnly: false,
    upgradeAvailable: false,
    showTrialBanner: true,
  };
}

async function computedContrast(page, selector) {
  return page.locator(selector).evaluate(element => {
    function rgb(value) {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return match ? match.slice(1).map(Number) : null;
    }
    function luminance(values) {
      const converted = values.map(channel => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return (0.2126 * converted[0]) + (0.7152 * converted[1]) + (0.0722 * converted[2]);
    }
    const style = getComputedStyle(element);
    let background = style.backgroundColor;
    let parent = element.parentElement;
    while (rgb(background) && background.endsWith(', 0)') && parent) {
      background = getComputedStyle(parent).backgroundColor;
      parent = parent.parentElement;
    }
    const foregroundRgb = rgb(style.color);
    const backgroundRgb = rgb(background) || rgb(getComputedStyle(document.body).backgroundColor);
    const light = Math.max(luminance(foregroundRgb), luminance(backgroundRgb));
    const dark = Math.min(luminance(foregroundRgb), luminance(backgroundRgb));
    return { ratio: (light + 0.05) / (dark + 0.05), color: style.color, background };
  });
}

async function assertLayout(page, headingSelector) {
  const layout = await page.evaluate(selector => {
    const heading = document.querySelector(selector);
    const bounds = heading.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth <= innerWidth,
      headingVisible: bounds.width > 0 && bounds.height > 0,
      headingInside: bounds.left >= 0 && bounds.right <= innerWidth + 1,
      bodyHeight: document.body.getBoundingClientRect().height,
    };
  }, headingSelector);
  assert.strictEqual(layout.overflow, true);
  assert.strictEqual(layout.headingVisible, true);
  assert.strictEqual(layout.headingInside, true);
  assert.ok(layout.bodyHeight > 0);
}

async function verificationMatrix(page, context, origin, requests) {
  const requestStart = requests.length;
  await page.goto(`${origin}/verify-email?token=${TOKEN}`);
  await page.waitForFunction(() => document.getElementById('verifyTitle').textContent === 'Email verified');
  assert.strictEqual(page.url(), `${origin}/verify-email`);
  await assertLayout(page, '#verifyTitle');
  assert.strictEqual(await page.locator('#verifyStatus').textContent(), "Your organization's 14-day trial has started.");
  assert.strictEqual(await page.locator('#verifySignIn').textContent(), 'Sign in to NorthStar');
  assert.strictEqual(await page.locator('#verifySignIn').getAttribute('href'), '/login');
  assert.strictEqual(await page.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
  assert.ok((await computedContrast(page, '#verifySignIn')).ratio >= 4.5);
  assert.notStrictEqual((await page.locator('#verifySignIn').evaluate(element => getComputedStyle(element).color)), 'rgb(85, 26, 139)');
  const surfaces = await page.evaluate(() => ({
    url: location.href,
    html: document.documentElement.outerHTML,
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
    stringGlobals: Object.fromEntries(Object.getOwnPropertyNames(window).flatMap(name => {
      try { return typeof window[name] === 'string' ? [[name, window[name]]] : []; } catch (_error) { return []; }
    })),
  }));
  assert.ok(!JSON.stringify(surfaces).includes(TOKEN));
  for (const item of requests.slice(requestStart).filter(item => item.resourceType !== 'document')) {
    assert.strictEqual(item.referer, '');
    assert.ok(!item.url.includes(TOKEN));
  }

  for (const entry of [
    { label: 'missing', query: '' },
    { label: 'malformed', query: '?token=not-a-token' },
    { label: 'expired', query: `?token=${EXPIRED_TOKEN}` },
    { label: 'replayed', query: `?token=${EXPIRED_TOKEN}` },
  ]) {
    await page.goto(`${origin}/verify-email${entry.query}`);
    await page.waitForFunction(() => !document.getElementById('verifyStatus').textContent.includes('Checking'));
    assert.strictEqual(page.url(), `${origin}/verify-email`, entry.label);
    assert.strictEqual(await page.locator('#verifyTitle').textContent(), 'Verification link unavailable');
    assert.strictEqual(await page.locator('#verifyStatus').textContent(), 'This verification link is invalid or expired.');
    await assertLayout(page, '#verifyTitle');
  }
  assert.strictEqual((await context.cookies()).some(cookie => /access|refresh/i.test(cookie.name)), false);
}

async function loginRecoveryLink(page, origin) {
  await page.addInitScript(() => localStorage.setItem('northstar-theme', 'dark'));
  await page.goto(`${origin}/login`);
  const link = page.locator('.auth-recovery-link');
  assert.strictEqual(await link.getAttribute('href'), '/forgot-password');
  const normal = await computedContrast(page, '.auth-recovery-link');
  assert.ok(normal.ratio >= 4.5, JSON.stringify(normal));
  await link.hover();
  await page.waitForTimeout(250);
  const hover = await link.evaluate(element => getComputedStyle(element).color);
  await link.focus();
  const focus = await link.evaluate(element => {
    const style = getComputedStyle(element);
    return { color: style.color, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  assert.notStrictEqual(hover, normal.color);
  assert.notStrictEqual(focus.outlineStyle, 'none');
  assert.notStrictEqual(focus.outlineWidth, '0px');
  await assertLayout(page, 'h1');
}

async function customerSurfaceTerminology(page, origin) {
  for (const forbidden of ['PR A', 'PR B1', 'PR B2', 'PR #76', 'pull request', 'phase B1', 'phase B2']) {
    assert.match(forbidden, INTERNAL_LANGUAGE, `scanner recognizes ${forbidden}`);
  }
  for (const pathname of ['/admin', '/login', '/account/pending']) {
    await page.goto(`${origin}${pathname}`);
    const visibleText = await page.locator('body').innerText();
    assert.doesNotMatch(visibleText, INTERNAL_LANGUAGE, pathname);
    if (pathname === '/admin') {
      assert.ok(visibleText.includes('Monitor NorthStar account and platform activity.'));
    }
  }
}

async function trialMatrix(page, authority, origin, listenerEvidence) {
  authority.subscription = trialProjection(14);
  await page.goto(`${origin}/account/pending`);
  assert.doesNotMatch(await page.locator('body').textContent(), INTERNAL_LANGUAGE);
  for (const expected of [14, 7, 3, 1]) {
    authority.subscription = trialProjection(expected);
    await page.evaluate(() => NorthStarTrialStatus.refresh());
    await page.waitForFunction(days => document.getElementById('northstar-trial-status').textContent.includes(`${days} days remaining`), expected);
    const banner = page.locator('#northstar-trial-status');
    assert.ok((await banner.textContent()).includes('Enjoy full access during your trial.'));
    assert.strictEqual(await banner.locator('button, a').count(), 0);
    assert.doesNotMatch(await banner.textContent(), INTERNAL_LANGUAGE);
    await assertLayout(page, '#northstar-trial-status');
  }
  authority.subscription = trialProjection(1, true);
  await page.evaluate(() => NorthStarTrialStatus.refresh());
  await page.waitForFunction(() => document.getElementById('northstar-trial-status').textContent.includes('Trial ends today'));

  authority.subscription = {
    safe: true, state: 'expired', trialStart: '2026-07-01T00:00:00.000Z',
    trialEnd: '2026-07-15T00:00:00.000Z', serverTimestamp: '2026-08-04T00:00:00.000Z',
    daysRemaining: 0, endsToday: false, readOnly: true, upgradeAvailable: false, showTrialBanner: true,
  };
  await page.evaluate(() => NorthStarTrialStatus.refresh());
  await page.waitForFunction(() => document.getElementById('northstar-trial-status').textContent.includes('Your trial has ended'));
  const expired = page.locator('#northstar-trial-status');
  assert.ok((await expired.textContent()).includes('Upgrade options are coming soon.'));
  assert.strictEqual(await expired.locator('button, a').count(), 0);
  assert.doesNotMatch(await expired.textContent(), INTERNAL_LANGUAGE);

  authority.subscription = { safe: true, state: 'active', serverTimestamp: '2026-08-04T00:00:00.000Z' };
  await page.evaluate(() => NorthStarTrialStatus.refresh());
  await page.waitForFunction(() => !document.getElementById('northstar-trial-status'));

  authority.subscription = {
    safe: true, state: 'pending_verification', trialStart: null, trialEnd: null,
    serverTimestamp: '2026-08-04T00:00:00.000Z', daysRemaining: null,
    endsToday: false, readOnly: true, upgradeAvailable: false, showTrialBanner: true,
  };
  await page.evaluate(() => NorthStarTrialStatus.refresh());
  await page.waitForFunction(() => document.getElementById('northstar-trial-status').textContent.includes('Verify your email'));
  assert.strictEqual(await page.locator('#northstar-trial-status button').textContent(), 'Resend verification');
  const beforeResend = authority.resendPosts;
  await page.locator('#northstar-trial-status button').click();
  await page.waitForFunction(() => document.querySelector('#northstar-trial-status button').textContent === 'Verification sent');
  assert.strictEqual(authority.resendPosts, beforeResend + 1);

  await page.evaluate(() => Promise.all([NorthStarTrialStatus.init(), NorthStarTrialStatus.init()]));
  assert.strictEqual(await page.locator('#northstar-trial-status').count(), 1);
  assert.strictEqual(await page.evaluate(() => window.__visualPolishListeners), listenerEvidence);
}

async function runEngineViewport(engine, viewport, mounted) {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({
    executablePath: runtime.executablePath,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const requests = [];
  let listenerEvidence = 0;
  try {
    await context.addInitScript(() => {
      window.__visualPolishListeners = 0;
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type) {
        if (this === window && type === 'northstar:account') window.__visualPolishListeners += 1;
        return add.apply(this, arguments);
      };
    });
    context.on('request', request => {
      const url = new URL(request.url());
      assert.strictEqual(url.origin, mounted.origin, `loopback destination ${request.url()}`);
      assert.ok(!Object.keys(request.headers()).some(name => name.toLowerCase() === 'authorization'));
      requests.push({
        url: request.url(), method: request.method(), resourceType: request.resourceType(),
        referer: request.headers().referer || '',
      });
    });
    const page = context.pages()[0] || await context.newPage();
    await verificationMatrix(page, context, mounted.origin, requests);
    await loginRecoveryLink(page, mounted.origin);
    mounted.authority.subscription = trialProjection(14);
    await page.goto(`${mounted.origin}/account/pending`);
    listenerEvidence = await page.evaluate(() => window.__visualPolishListeners);
    assert.strictEqual(listenerEvidence, 1);
    await trialMatrix(page, mounted.authority, mounted.origin, listenerEvidence);
    await customerSurfaceTerminology(page, mounted.origin);
    assert.strictEqual(requests.some(item => item.method !== 'GET' && ![
      '/api/auth/verify-email', '/api/auth/resend-verification',
    ].includes(new URL(item.url).pathname)), false);
    return {
      engine, viewport: viewport.label, requests: requests.length,
      verificationPosts: mounted.authority.verificationPosts,
      resendPosts: mounted.authority.resendPosts,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const selection = process.env.NORTHSTAR_BROWSER || 'both';
  assert.ok(['chrome', 'webkit', 'both'].includes(selection));
  const engines = selection === 'both' ? ['chrome', 'webkit'] : [selection];
  const mounted = await createMountedServer();
  const evidence = [];
  try {
    for (const engine of engines) {
      for (const viewport of VIEWPORTS) evidence.push(await runEngineViewport(engine, viewport, mounted));
    }
    process.stdout.write(`${JSON.stringify({ success: true, evidence })}\n`);
  } finally {
    await mounted.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
