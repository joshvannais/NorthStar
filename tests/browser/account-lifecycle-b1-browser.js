'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const VIEWPORTS = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 },
];
const CREDENTIAL = /northstar_(?:access|refresh|csrf)|\bBearer\s+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i;

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function tokenFrom(message, pathname) {
  const match = String(message && message.text || '').match(/https?:\/\/[^\s]+/);
  assert.ok(match, `captured ${pathname} link`);
  const url = new URL(match[0]);
  assert.strictEqual(url.pathname, pathname);
  return url;
}

function inventory(context, origin) {
  const requests = [];
  const responses = [];
  const nonlocal = [];
  const mainFrameUrls = [];
  const consoleMessages = [];
  const pageErrors = [];
  const attachedPages = new WeakSet();
  function attachPage(page) {
    if (attachedPages.has(page)) return;
    attachedPages.add(page);
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) mainFrameUrls.push(frame.url());
    });
    page.on('console', message => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', error => pageErrors.push(String(error && error.message || error)));
  }
  context.pages().forEach(attachPage);
  context.on('page', attachPage);
  context.on('request', request => {
    const url = new URL(request.url());
    const redirects = [];
    for (let previous = request.redirectedFrom(); previous; previous = previous.redirectedFrom()) {
      redirects.unshift(previous.url());
    }
    requests.push({
      url: request.url(), method: request.method(), path: url.pathname, origin: url.origin,
      referer: request.headers().referer || '', resourceType: request.resourceType(),
      navigation: request.isNavigationRequest(), redirects,
    });
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) nonlocal.push(url.origin);
    assert.ok(!Object.keys(request.headers()).some(name => name.toLowerCase() === 'authorization'),
      `Authorization header is forbidden: ${url.pathname}`);
  });
  context.on('response', response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/')) return;
    responses.push(response.text().then(text => ({ path: url.pathname, status: response.status(), text })).catch(() => null));
  });
  return {
    requests, mainFrameUrls, consoleMessages, pageErrors, attachPage,
    nonlocal,
    async assertSafe() {
      const bodies = (await Promise.all(responses)).filter(Boolean);
      assert.deepStrictEqual(nonlocal, [], 'every browser destination remains loopback');
      for (const body of bodies) assert.ok(!CREDENTIAL.test(body.text), `credential-free response ${body.path}`);
      return bodies;
    },
  };
}

function opaqueToken(label) {
  return crypto.createHash('sha256').update(`${label}-${crypto.randomUUID()}`).digest('base64url');
}

function secretRepresentations(secrets) {
  const values = new Set();
  for (const secret of secrets.filter(Boolean)) {
    values.add(secret);
    values.add(encodeURIComponent(secret));
    if (secret.length >= 16) {
      values.add(secret.slice(0, 12));
      values.add(secret.slice(-12));
    }
  }
  return Array.from(values).filter(value => value.length >= 8);
}

function assertSecretsAbsent(value, secrets, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const representation of secretRepresentations(secrets)) {
    assert.ok(!String(text).includes(representation), `${label} contains sensitive token material`);
  }
}

async function browserSurfaceSnapshot(page, context) {
  const pageState = await page.evaluate(async () => {
    const indexed = [];
    const databases = indexedDB.databases ? await indexedDB.databases() : [];
    for (const descriptor of databases) {
      if (!descriptor.name) continue;
      const opened = await new Promise((resolve, reject) => {
        const request = indexedDB.open(descriptor.name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stores = [];
      for (const name of Array.from(opened.objectStoreNames)) {
        const values = await new Promise((resolve, reject) => {
          const transaction = opened.transaction(name, 'readonly');
          const request = transaction.objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        stores.push({ name, values });
      }
      opened.close();
      indexed.push({ name: descriptor.name, stores });
    }
    const globals = {};
    for (const name of Object.getOwnPropertyNames(window)) {
      try {
        const value = window[name];
        if (typeof value === 'string') globals[name] = value;
      } catch (_error) {}
    }
    return {
      url: location.href,
      historyLength: history.length,
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
      indexed,
      globals,
      html: document.documentElement.outerHTML,
      text: document.body.textContent,
      cssLoaded: performance.getEntriesByType('resource').some(entry => (
        new URL(entry.name).pathname === '/css/style.css'
      )),
    };
  });
  pageState.cookies = await context.cookies();
  return pageState;
}

function tokenCases(kind) {
  const valid = opaqueToken(`${kind}-valid`);
  const serverError = opaqueToken(`${kind}-server-error`);
  const networkError = opaqueToken(`${kind}-network-error`);
  const duplicateA = opaqueToken(`${kind}-duplicate-a`);
  const duplicateB = opaqueToken(`${kind}-duplicate-b`);
  const malformed = `malformed-${kind}-token`;
  const oversized = `oversized-${kind}-${'O'.repeat(150)}`;
  return [
    { label: 'valid', query: `?token=${encodeURIComponent(valid)}`, secrets: [valid], outcome: 'success', posts: 1 },
    { label: 'missing', query: '', secrets: [], outcome: 'invalid', posts: 0 },
    { label: 'empty', query: '?token=', secrets: [], outcome: 'invalid', posts: 0 },
    { label: 'malformed', query: `?token=${encodeURIComponent(malformed)}`, secrets: [malformed], outcome: 'invalid', posts: 0 },
    { label: 'oversized', query: `?token=${encodeURIComponent(oversized)}`, secrets: [oversized], outcome: 'invalid', posts: 0 },
    {
      label: 'duplicate',
      query: `?token=${encodeURIComponent(duplicateA)}&token=${encodeURIComponent(duplicateB)}`,
      secrets: [duplicateA, duplicateB], outcome: 'invalid', posts: 0,
    },
    { label: 'server-error', query: `?token=${serverError}`, secrets: [serverError], outcome: 'server-error', posts: 1 },
    { label: 'network-error', query: `?token=${networkError}`, secrets: [networkError], outcome: 'network-error', posts: 1 },
  ];
}

async function runTokenConfidentialityMatrix(context, trace, baseUrl, kind) {
  const pathname = kind === 'verification' ? '/verify-email' : '/reset-password';
  const endpoint = kind === 'verification' ? '/api/auth/verify-email' : '/api/auth/reset-password';
  const results = [];
  for (const tokenCase of tokenCases(kind)) {
    const page = await context.newPage();
    trace.attachPage(page);
    let posts = 0;
    await page.route(`**${endpoint}`, async route => {
      posts += 1;
      if (tokenCase.outcome === 'network-error') return route.abort('connectionfailed');
      const success = tokenCase.outcome === 'success';
      return route.fulfill({
        status: success ? 200 : 503,
        contentType: 'application/json',
        body: JSON.stringify(success ? { success: true } : { error: 'bounded failure' }),
      });
    });
    await page.goto(`${baseUrl}/login`);
    const requestStart = trace.requests.length;
    const responseStart = trace.mainFrameUrls.length;
    const consoleStart = trace.consoleMessages.length;
    const errorStart = trace.pageErrors.length;
    await page.goto(`${baseUrl}${pathname}${tokenCase.query}`);
    if (kind === 'verification') {
      await page.waitForFunction(() => !document.getElementById('verifyStatus').textContent.includes('Checking'));
    } else if (tokenCase.posts) {
      await page.fill('#password', 'Confidential-reset-password-123!');
      await page.fill('#confirmPassword', 'Confidential-reset-password-123!');
      await page.click('#resetForm button[type="submit"]');
      await page.waitForFunction(() => document.getElementById('resetStatus').textContent.length > 0);
    } else {
      await page.waitForFunction(() => document.getElementById('resetStatus').textContent.length > 0);
    }
    assert.strictEqual(page.url(), `${baseUrl}${pathname}`);
    assert.strictEqual(posts, tokenCase.posts);
    const firstSnapshot = await browserSurfaceSnapshot(page, context);
    assert.strictEqual(firstSnapshot.cssLoaded, true, `${kind}/${tokenCase.label} CSS loaded`);
    assertSecretsAbsent(firstSnapshot, tokenCase.secrets, `${kind}/${tokenCase.label} browser surfaces`);

    await page.reload();
    if (kind === 'verification') {
      await page.waitForFunction(() => !document.getElementById('verifyStatus').textContent.includes('Checking'));
    } else {
      await page.waitForFunction(() => document.getElementById('resetStatus').textContent.length > 0);
    }
    assert.strictEqual(posts, tokenCase.posts, `${kind}/${tokenCase.label} reload must not repeat POST`);
    const sensitiveRequestEnd = trace.requests.length;
    const back = await page.goBack();
    assert.ok(back);
    await page.waitForURL(`${baseUrl}/login`);
    const backUrl = page.url();
    const forward = await page.goForward();
    assert.ok(forward);
    await page.waitForURL(`${baseUrl}${pathname}`);
    const forwardUrl = page.url();
    assert.strictEqual(posts, tokenCase.posts, `${kind}/${tokenCase.label} history must not repeat POST`);

    const relevantRequests = trace.requests.slice(requestStart);
    const relevantFrames = trace.mainFrameUrls.slice(responseStart);
    const relevantConsole = trace.consoleMessages.slice(consoleStart);
    const relevantErrors = trace.pageErrors.slice(errorStart);
    const initiated = trace.requests.slice(requestStart, sensitiveRequestEnd)
      .filter(item => item.resourceType !== 'document');
    assert.ok(initiated.length > 0, `${kind}/${tokenCase.label} must capture subresource requests`);
    for (const item of initiated) {
      assert.strictEqual(item.referer, '', `${kind}/${tokenCase.label} ${item.method} ${item.path} Referer`);
      assertSecretsAbsent(item.url, tokenCase.secrets, `${kind}/${tokenCase.label} subresource URL`);
      assertSecretsAbsent(item.redirects, tokenCase.secrets, `${kind}/${tokenCase.label} redirect chain`);
    }
    for (const item of relevantRequests.slice(sensitiveRequestEnd - requestStart)) {
      assertSecretsAbsent(item.referer, tokenCase.secrets, `${kind}/${tokenCase.label} history Referer`);
      assertSecretsAbsent(item.url, tokenCase.secrets, `${kind}/${tokenCase.label} history request URL`);
    }
    for (const item of relevantRequests.filter(item => item.origin !== baseUrl)) {
      assertSecretsAbsent(item.url, tokenCase.secrets, `${kind}/${tokenCase.label} nonlocal destination`);
    }
    assertSecretsAbsent([backUrl, forwardUrl, page.url()], tokenCase.secrets, `${kind}/${tokenCase.label} retained history`);
    const tokenBearingFrames = relevantFrames.filter(url => secretRepresentations(tokenCase.secrets)
      .some(representation => url.includes(representation)));
    assert.ok(tokenBearingFrames.length <= 1, `${kind}/${tokenCase.label} raw main-frame URL occurs once at most`);
    assertSecretsAbsent(relevantConsole, tokenCase.secrets, `${kind}/${tokenCase.label} console`);
    assertSecretsAbsent(relevantErrors, tokenCase.secrets, `${kind}/${tokenCase.label} page errors`);
    const bodies = await trace.assertSafe();
    assertSecretsAbsent(bodies, tokenCase.secrets, `${kind}/${tokenCase.label} API responses`);
    results.push({
      case: tokenCase.label, posts, requests: relevantRequests.length,
      referersCaptured: initiated.length, history: [backUrl, forwardUrl],
      rawMainFrameNavigations: tokenBearingFrames.length,
    });
    await page.close();
  }
  return results;
}

async function assertMountedTokenPageConfidentiality(page, context, trace, requestStart, token, label) {
  const requests = trace.requests.slice(requestStart).filter(item => item.resourceType !== 'document');
  assert.ok(requests.length > 0, `${label} subresource inventory`);
  for (const item of requests) {
    assert.strictEqual(item.referer, '', `${label} ${item.method} ${item.path} Referer`);
    assertSecretsAbsent(item.url, [token], `${label} subresource URL`);
    assertSecretsAbsent(item.redirects, [token], `${label} redirects`);
  }
  assertSecretsAbsent(await browserSurfaceSnapshot(page, context), [token], `${label} browser surfaces`);
}

async function instrument(context, origin) {
  await context.addInitScript(() => {
    window.__b1TrialEvidence = { accountListeners: 0, accountListenerStacks: [] };
    if (!EventTarget.prototype.__b1TrialInstrumentationInstalled) {
      Object.defineProperty(EventTarget.prototype, '__b1TrialInstrumentationInstalled', { value: true });
      const nativeAdd = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type) {
        if (this === window && type === 'northstar:account') {
          window.__b1TrialEvidence.accountListeners += 1;
          window.__b1TrialEvidence.accountListenerStacks.push(new Error().stack);
        }
        return nativeAdd.apply(this, arguments);
      };
    }
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
}

async function bannerEvidence(page, expectedText) {
  await page.waitForSelector('#northstar-trial-status');
  const evidence = await page.evaluate(() => {
    const banner = document.getElementById('northstar-trial-status');
    const bounds = banner.getBoundingClientRect();
    return {
      count: document.querySelectorAll('#northstar-trial-status').length,
      listeners: window.__b1TrialEvidence.accountListeners,
      trialListeners: window.__b1TrialEvidence.accountListenerStacks
        .filter(stack => stack.includes('/js/trial-status.js')).length,
      role: banner.getAttribute('role'),
      text: banner.textContent,
      visible: bounds.width > 0 && bounds.height > 0,
      insideViewport: bounds.left >= 0 && bounds.right <= innerWidth + 1,
      overflow: document.documentElement.scrollWidth <= innerWidth,
      scriptLoads: performance.getEntriesByType('resource')
        .filter(entry => entry.name.includes('/js/trial-status.js')).length,
      pathname: location.pathname,
      listenerStacks: window.__b1TrialEvidence.accountListenerStacks,
    };
  });
  assert.strictEqual(evidence.count, 1);
  assert.strictEqual(evidence.trialListeners, 1, JSON.stringify(evidence));
  assert.ok(['status', 'alert'].includes(evidence.role));
  assert.ok(evidence.visible && evidence.insideViewport && evidence.overflow);
  assert.match(evidence.text, expectedText);
  return evidence;
}

async function submitLogin(page, email, password) {
  await page.locator('#loginForm').waitFor({ state: 'visible' });
  await page.locator('#email').waitFor({ state: 'visible' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([
    page.waitForURL(url => ['/dashboard', '/dashboard/business-profile'].includes(url.pathname)),
    page.click('#loginForm button[type="submit"]'),
  ]);
}

async function login(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/login`);
  await submitLogin(page, email, password);
}

async function runJourney(spec, viewport, state) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `northstar-b1-${spec.engine}-${viewport.label}-`));
  const evidence = { engine: spec.engine, viewport: viewport.label, requests: 0 };
  let context;
  try {
    context = await spec.runtime.browserType.launchPersistentContext(profile, {
      executablePath: spec.runtime.executablePath,
      headless: true,
      viewport: { width: viewport.width, height: viewport.height },
    });
    await instrument(context, state.baseUrl);
    const trace = inventory(context, state.baseUrl);
    const page = context.pages()[0] || await context.newPage();
    trace.attachPage(page);
    evidence.confidentiality = {
      verification: await runTokenConfidentialityMatrix(
        context, trace, state.baseUrl, 'verification'
      ),
      reset: await runTokenConfidentialityMatrix(context, trace, state.baseUrl, 'reset'),
    };
    const lifecycleRequestStart = trace.requests.length;
    const suffix = `${spec.engine}-${viewport.width}-${crypto.randomUUID().slice(0, 8)}`;
    const email = `b1-browser-${suffix}@example.test`;
    const oldPassword = 'Browser-lifecycle-password-123!';
    const newPassword = 'Browser-lifecycle-replacement-456!';
    const firstMessage = state.capture.messages.length;

    await page.goto(`${state.baseUrl}/signup`);
    await page.fill('#name', 'Browser Owner');
    await page.fill('#businessName', `Browser Company ${suffix}`);
    await page.fill('#phone', '8605550198');
    await page.fill('#email', email);
    await page.fill('#password', oldPassword);
    await page.fill('#confirmPassword', oldPassword);
    const signupResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/signup'));
    await page.click('#signupForm button[type="submit"]');
    assert.strictEqual((await signupResponse).status(), 202);
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('verification'));
    assert.strictEqual((await context.cookies()).filter(cookie => /^northstar_/.test(cookie.name)).length, 0);
    assert.deepStrictEqual(await state.drainAccountEmailOutbox(), {
      claimed: 1, delivered: 1, configurationUnavailable: false,
    });
    assert.strictEqual(state.capture.messages.length, firstMessage + 1);

    await login(page, state.baseUrl, email, oldPassword);
    await bannerEvidence(page, /Verify your email/);
    const verificationUrl = tokenFrom(state.capture.messages.at(-1), '/verify-email');
    const verificationRequestStart = trace.requests.length;
    await page.goto(verificationUrl.toString());
    await page.waitForFunction(() => document.getElementById('verifyStatus').textContent.includes('14-day trial'));
    assert.strictEqual(page.url(), `${state.baseUrl}/verify-email`);
    await assertMountedTokenPageConfidentiality(
      page, context, trace, verificationRequestStart,
      verificationUrl.searchParams.get('token'), 'mounted verification'
    );

    await page.goto(`${state.baseUrl}/dashboard/business-profile`);
    await bannerEvidence(page, /14 days remaining/);
    const saved = await page.evaluate(async profile => {
      const currentResponse = await NorthStarAccountSession.fetch('/api/v1/business-profile');
      const current = await currentResponse.json();
      const authority = current && current.data && current.data.canonicalAuthority;
      const expectedVersion = authority && typeof authority.version === 'string' ? authority.version : null;
      const response = await NorthStarAccountSession.fetch('/api/v1/business-profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion, value: profile }),
      });
      return { expectedVersion, status: response.status, body: await response.json() };
    }, canonicalFenceProfile({ companyName: `Browser Company ${suffix}` }));
    assert.ok(saved.expectedVersion === null || /^org-profile-v[1-9][0-9]*$/.test(saved.expectedVersion));
    assert.strictEqual(saved.status, 200);

    await page.goto(`${state.baseUrl}/dashboard`);
    await bannerEvidence(page, /14 days remaining/);
    await page.evaluate(() => NorthStarTrialStatus.init());
    await page.evaluate(() => NorthStarTrialStatus.init());
    await bannerEvidence(page, /14 days remaining/);

    const secondPage = await context.newPage();
    await secondPage.goto(`${state.baseUrl}/dashboard/business-profile`);
    const secondBanner = await bannerEvidence(secondPage, /14 days remaining/);
    assert.strictEqual(secondBanner.text.includes('14 days'), true);

    await Promise.all([
      page.waitForURL(url => url.pathname === '/login'),
      page.evaluate(() => NorthStarAccountSession.logout()),
    ]);
    await submitLogin(page, email, oldPassword);
    await page.goto(`${state.baseUrl}/forgot-password`);
    await page.fill('#email', email);
    const forgotResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/forgot-password'));
    await page.click('#forgotForm button[type="submit"]');
    assert.strictEqual((await forgotResponse).status(), 202);
    await page.waitForFunction(() => document.getElementById('forgotStatus').textContent.includes('eligible'));
    assert.deepStrictEqual(await state.drainAccountEmailOutbox(), {
      claimed: 1, delivered: 1, configurationUnavailable: false,
    });
    assert.strictEqual(state.capture.messages.length, firstMessage + 2);
    const resetUrl = tokenFrom(state.capture.messages.at(-1), '/reset-password');
    const resetRequestStart = trace.requests.length;
    await page.goto(resetUrl.toString());
    assert.strictEqual(page.url(), `${state.baseUrl}/reset-password`);
    await page.fill('#password', newPassword);
    await page.fill('#confirmPassword', newPassword);
    const resetResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/reset-password'));
    await page.click('#resetForm button[type="submit"]');
    assert.strictEqual((await resetResponse).status(), 200);
    await page.waitForFunction(() => document.getElementById('resetStatus').textContent.includes('Password reset'));
    await assertMountedTokenPageConfidentiality(
      page, context, trace, resetRequestStart,
      resetUrl.searchParams.get('token'), 'mounted password reset'
    );
    assert.strictEqual((await page.evaluate(() => fetch('/api/auth/me').then(response => response.status))), 401);
    await login(page, state.baseUrl, email, newPassword);

    await page.evaluate(async () => {
      localStorage.setItem('northstar-subscription-state', 'active');
      sessionStorage.setItem('northstar-trial-days', '999');
      window.northstarPaid = true;
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('northstar-forged-authority', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('authority');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('authority', 'readwrite');
          tx.objectStore('authority').put('active', 'subscription');
          tx.oncomplete = () => { open.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    });
    await page.goto(`${state.baseUrl}/dashboard?organizationId=foreign&state=active&daysRemaining=999&upgrade=true&paid=true&success=true`);
    await bannerEvidence(page, /14 days remaining/);
    const forgedProjection = await page.evaluate(async () => {
      const response = await NorthStarAccountSession.fetch(
        '/api/account/subscription?organizationId=foreign&upgrade=true&paid=true&success=true'
      );
      return response.json();
    });
    assert.strictEqual(forgedProjection.subscription.upgradeAvailable, false);
    const initialStorage = await page.evaluate(async () => ({
      cookies: document.cookie,
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
      databases: indexedDB.databases ? await indexedDB.databases() : [],
      globals: { northstarPaid: window.northstarPaid },
    }));
    assert.match(initialStorage.cookies, /^northstar_csrf=/);
    assert.ok(!/northstar_(?:access|refresh)=/i.test(initialStorage.cookies));
    assert.ok(!CREDENTIAL.test(JSON.stringify({
      local: initialStorage.local,
      session: initialStorage.session,
      databases: initialStorage.databases,
      globals: initialStorage.globals,
    })));

    const authority = (await state.pool.query(
      'SELECT organization_id FROM users WHERE email_normalized = $1', [email]
    )).rows[0];
    const trial = (await state.pool.query(
      'SELECT trial_started_at, trial_ends_at FROM subscriptions WHERE organization_id = $1',
      [authority.organization_id]
    )).rows[0];
    assert.strictEqual(new Date(trial.trial_ends_at).getTime() - new Date(trial.trial_started_at).getTime(), 14 * 86400000);

    await secondPage.close();
    await context.close();
    context = await spec.runtime.browserType.launchPersistentContext(profile, {
      executablePath: spec.runtime.executablePath, headless: true,
      viewport: { width: viewport.width, height: viewport.height },
    });
    await instrument(context, state.baseUrl);
    const restartTrace = inventory(context, state.baseUrl);
    const restarted = context.pages()[0] || await context.newPage();
    await restarted.goto(`${state.baseUrl}/dashboard`);
    await bannerEvidence(restarted, /14 days remaining/);

    state.controlledNow.value = new Date(trial.trial_ends_at);
    await restarted.evaluate(() => NorthStarTrialStatus.refresh());
    await bannerEvidence(
      restarted,
      /Your trial has ended\. Your organization remains available in restricted read-only mode\. Upgrade options are coming soon\./
    );
    const expiredProjection = await restarted.evaluate(async () => {
      const response = await NorthStarAccountSession.fetch(
        '/api/account/subscription?upgrade=true&paid=true&success=true'
      );
      return response.json();
    });
    assert.strictEqual(expiredProjection.subscription.upgradeAvailable, false);
    const upgradeUi = await restarted.evaluate(() => ({
      enabledButtons: Array.from(document.querySelectorAll('#northstar-trial-status button:not([disabled])')).length,
      paymentLinks: Array.from(document.querySelectorAll('#northstar-trial-status a')).filter(anchor => (
        /stripe|checkout|billing|payment/i.test(anchor.href)
      )).length,
      text: document.getElementById('northstar-trial-status').textContent,
    }));
    assert.deepStrictEqual(
      { enabledButtons: upgradeUi.enabledButtons, paymentLinks: upgradeUi.paymentLinks },
      { enabledButtons: 0, paymentLinks: 0 }
    );
    assert.match(upgradeUi.text, /Your trial has ended/i);
    assert.match(upgradeUi.text, /Upgrade options are coming soon/i);
    assert.doesNotMatch(upgradeUi.text, /PR B2|pull request|internal phase/i);
    const denied = await restarted.evaluate(async () => {
      const response = await NorthStarAccountSession.fetch('/api/account/preferences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      return { status: response.status, body: await response.json() };
    });
    assert.strictEqual(denied.status, 403);
    assert.strictEqual(denied.body.code, 'subscription_read_only');

    await state.pool.query(
      "UPDATE subscriptions SET status = 'active' WHERE organization_id = $1",
      [authority.organization_id]
    );
    await restarted.evaluate(() => NorthStarTrialStatus.refresh());
    await restarted.waitForFunction(() => !document.getElementById('northstar-trial-status'));
    assert.strictEqual(await restarted.locator('#northstar-trial-status').count(), 0);
    const activeProjection = await restarted.evaluate(async () => {
      const response = await NorthStarAccountSession.fetch('/api/account/subscription?upgrade=true&paid=true');
      return response.json();
    });
    assert.strictEqual(activeProjection.subscription.state, 'active');
    assert.strictEqual(activeProjection.subscription.upgradeAvailable, false);
    state.controlledNow.value = null;

    const bodies = (await trace.assertSafe()).concat(await restartTrace.assertSafe());
    evidence.requests = trace.requests.length + restartTrace.requests.length;
    evidence.methods = Object.fromEntries(Array.from(new Set(trace.requests.concat(restartTrace.requests)
      .map(item => `${item.method} ${item.path}`))).sort().map(key => [key, true]));
    evidence.apiResponses = bodies.length;
    evidence.deliveryCount = state.capture.messages.length - firstMessage;
    evidence.verificationAttempts = trace.requests.slice(lifecycleRequestStart).concat(restartTrace.requests)
      .filter(item => item.method === 'POST' && item.path === '/api/auth/verify-email').length;
    evidence.resetAttempts = trace.requests.slice(lifecycleRequestStart).concat(restartTrace.requests)
      .filter(item => item.method === 'POST' && item.path === '/api/auth/reset-password').length;
    assert.strictEqual(evidence.deliveryCount, 2);
    assert.strictEqual(evidence.verificationAttempts, 1);
    assert.strictEqual(evidence.resetAttempts, 1);
    await context.close();
    context = null;
    return evidence;
  } finally {
    state.controlledNow.value = null;
    if (context) await context.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

async function main() {
  for (const key of ['M19_PG_ADMIN_URL', 'M19_EXPECTED_PG_DATA_DIR', 'M19_EXPECTED_PG_PORT', 'M19_TEST_RUN_ID']) {
    assert.ok(process.env[key], `${key} is required`);
  }
  const selection = process.env.NORTHSTAR_BROWSER || 'both';
  assert.ok(['chrome', 'webkit', 'both'].includes(selection));
  const engines = selection === 'both' ? ['chrome', 'webkit'] : [selection];
  const allocation = await createSuiteDatabase(`account-lifecycle-b1-browser-${selection}`);
  const previous = { database: process.env.DATABASE_URL, secret: process.env.AUTH_ACCESS_SECRET };
  process.env.DATABASE_URL = allocation.connectionString;
  process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
  let db;
  let server;
  try {
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const controlledNow = { value: null };
    const capture = { messages: [], async send(message) {
      this.messages.push(JSON.parse(JSON.stringify(message)));
      return { accepted: true };
    } };
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const app = require('../helpers/account-test-app').createDisposableAccountApp({
      emailCapture: capture, publicOrigin: baseUrl, testClock: () => controlledNow.value,
    });
    server = app.listen(port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const state = {
      baseUrl,
      capture,
      controlledNow,
      pool: db.getPool(),
      drainAccountEmailOutbox: app.drainAccountEmailOutbox,
    };
    const results = [];
    for (const engine of engines) {
      const runtime = resolveBrowserRuntime(engine);
      for (const viewport of VIEWPORTS) {
        results.push(await runJourney({ engine, runtime }, viewport, state));
      }
    }
    console.log(JSON.stringify({
      browser: selection,
      engines: engines.map(engine => engine === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit'),
      physicalSafari: false,
      viewports: VIEWPORTS.map(item => item.label),
      journeys: results,
    }));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.close();
    await allocation.cleanup();
    if (previous.database === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.database;
    if (previous.secret === undefined) delete process.env.AUTH_ACCESS_SECRET; else process.env.AUTH_ACCESS_SECRET = previous.secret;
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
