'use strict';

const assert = require('assert');
const crypto = require('crypto');
const request = require('supertest');
const { Client } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const CREDENTIAL_NAMES = ['northstar_access', 'northstar_refresh', 'northstar_csrf'];
const VIEWPORTS = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 },
];

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

function trackerFor(context, baseUrl, totals) {
  const allowedUnsafe = new Map();
  const violations = [];
  const events = [];
  const bodies = [];
  const pendingBodies = [];
  let sequence = 0;

  function key(method, pathname) {
    return `${String(method).toUpperCase()} ${pathname}`;
  }

  context.on('request', browserRequest => {
    sequence += 1;
    const url = new URL(browserRequest.url());
    events.push({ sequence, type: 'request', method: browserRequest.method(), pathname: url.pathname });
    totals.requests += 1;
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== baseUrl) {
      violations.push(`nonlocal request: ${url.origin}`);
    }
    const headers = browserRequest.headers();
    if (Object.keys(headers).some(name => name.toLowerCase() === 'authorization')) {
      violations.push(`Authorization header: ${url.pathname}`);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(browserRequest.method())) {
      const requestKey = key(browserRequest.method(), url.pathname);
      const remaining = allowedUnsafe.get(requestKey) || 0;
      if (remaining < 1) violations.push(`unexpected unsafe request: ${requestKey}`);
      else allowedUnsafe.set(requestKey, remaining - 1);
    }
  });

  context.on('response', response => {
    sequence += 1;
    const url = new URL(response.url());
    events.push({ sequence, type: 'response', method: response.request().method(), pathname: url.pathname, status: response.status() });
    if (!url.pathname.startsWith('/api/')) return;
    const promise = (async () => {
      let body = '';
      try { body = await response.text(); } catch (_error) { return; }
      bodies.push({ pathname: url.pathname, body });
      totals.apiResponses += 1;
    })();
    pendingBodies.push(promise);
  });

  return {
    allow(method, pathname, count = 1) {
      const requestKey = key(method, pathname);
      allowedUnsafe.set(requestKey, (allowedUnsafe.get(requestKey) || 0) + count);
    },
    mark() { return sequence; },
    eventsAfter(mark) { return events.filter(event => event.sequence > mark); },
    async assertClean() {
      await Promise.allSettled(pendingBodies);
      for (const [requestKey, remaining] of allowedUnsafe) {
        if (remaining !== 0) violations.push(`expected request missing: ${requestKey}`);
      }
      for (const entry of bodies) {
        let parsed;
        try { parsed = JSON.parse(entry.body); } catch (_error) { parsed = null; }
        const forbidden = [];
        (function visit(value) {
          if (!value || typeof value !== 'object') return;
          for (const [name, nested] of Object.entries(value)) {
            if (/^(?:accessToken|refreshToken|csrfToken|refreshFamilyId|authorization|bearer)$/i.test(name)) forbidden.push(name);
            if (/^sessionId$/i.test(name) &&
                (typeof nested !== 'string' || !/^sim_[A-Za-z0-9_-]+$/.test(nested))) {
              forbidden.push(name);
            }
            visit(nested);
          }
        })(parsed);
        if (forbidden.length || /\bBearer\s+[A-Za-z0-9._~-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(entry.body)) {
          violations.push(`credential material in response: ${entry.pathname}`);
        }
      }
      assert.deepStrictEqual(violations, [], 'browser network/response inventory must remain local and credential-free');
    },
  };
}

async function installBrowserInstrumentation(context) {
  await context.addInitScript(() => {
    const initialGlobals = Object.getOwnPropertyNames(window);
    const evidence = window.__northstarRatification = {
      accountListeners: 0,
      fetchCounts: {},
      refreshActive: 0,
      refreshMaxActive: 0,
      indexedDbOpens: [],
      initialGlobals,
    };
    const addEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type) {
      if (type === 'northstar:account') evidence.accountListeners += 1;
      return addEventListener.apply(this, arguments);
    };
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name) {
      evidence.indexedDbOpens.push(String(name));
      return open.apply(this, arguments);
    };
    const nativeFetch = window.fetch;
    window.fetch = function (input) {
      const pathname = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      evidence.fetchCounts[pathname] = (evidence.fetchCounts[pathname] || 0) + 1;
      if (pathname === '/api/auth/refresh') {
        evidence.refreshActive += 1;
        evidence.refreshMaxActive = Math.max(evidence.refreshMaxActive, evidence.refreshActive);
      }
      return nativeFetch.apply(this, arguments).finally(function () {
        if (pathname === '/api/auth/refresh') evidence.refreshActive -= 1;
      });
    };
  });
}

async function newTrackedContext(browser, baseUrl, viewport, totals, storageState) {
  const context = await browser.newContext({ viewport, ...(storageState ? { storageState } : {}) });
  await installBrowserInstrumentation(context);
  return { context, tracker: trackerFor(context, baseUrl, totals) };
}

async function assertCredentialCookieShape(context, baseUrl, rawSetCookies) {
  const cookies = await context.cookies(baseUrl);
  const selected = cookies.filter(cookie => CREDENTIAL_NAMES.includes(cookie.name));
  assert.deepStrictEqual(selected.map(cookie => cookie.name).sort(), [...CREDENTIAL_NAMES].sort());
  for (const cookie of selected) {
    assert.strictEqual(cookie.path, '/', `${cookie.name} path`);
    assert.strictEqual(cookie.httpOnly, cookie.name !== 'northstar_csrf', `${cookie.name} HttpOnly`);
  }
  assert.ok(Array.isArray(rawSetCookies), 'raw mounted credential Set-Cookie headers are required');
  const credentialHeaders = rawSetCookies.filter(value => /^northstar_(?:access|refresh|csrf)=/i.test(value));
  assert.strictEqual(credentialHeaders.length, 3, 'three credential Set-Cookie headers');
  for (const value of credentialHeaders) {
    const name = value.slice(0, value.indexOf('='));
    assert.match(value, /(?:^|;)\s*Path=\/(?:;|$)/i, `${name} raw path`);
    assert.match(value, /(?:^|;)\s*SameSite=Lax(?:;|$)/i, `${name} raw SameSite`);
    assert.strictEqual(/(?:^|;)\s*HttpOnly(?:;|$)/i.test(value), name !== 'northstar_csrf', `${name} raw HttpOnly`);
  }
  return selected;
}

async function assertNoBrowserAuthority(page) {
  const evidence = await page.evaluate(async () => {
    const local = Object.entries(localStorage);
    const session = Object.entries(sessionStorage);
    const allowedPerTabMetadata = new Set(['northstarSessionId', 'northstarSessionOwner']);
    const forbiddenStorage = local.concat(session).filter(([name, value]) => (
      !allowedPerTabMetadata.has(name) && (
        /auth|token|credential|bearer|session.?id|organization.?id|org.?id|user.?id|role|verification|onboarding/i.test(name) ||
        /\bBearer\s+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(String(value))
      )
    )).map(([name]) => name);
    const unsafePerTabMetadata = local.concat(session).filter(([name, value]) => (
      allowedPerTabMetadata.has(name) &&
      (/\bBearer\s+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(String(value)) ||
       local.some(([localName]) => localName === name))
    )).map(([name]) => name);
    const allowedBrowserGlobals = new Set(['NorthStarAccountSession', 'SIM_SESSION_ID', 'credentialless']);
    const initialGlobals = new Set(window.__northstarRatification.initialGlobals || []);
    const forbiddenGlobals = Object.getOwnPropertyNames(window).filter(name => {
      if (allowedBrowserGlobals.has(name) || initialGlobals.has(name)) return false;
      return /(?:access|refresh|csrf).*token|credential|bearer|authorization|session.?id|^(?:currentUser|userRole|organizationId|orgId)$/i.test(name);
    });
    const simulationGlobal = window.SIM_SESSION_ID;
    const unsafeSimulationGlobal = simulationGlobal !== sessionStorage.getItem('northstarSessionId') ||
      /\bBearer\s+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(String(simulationGlobal || ''));
    let indexedDatabases = [];
    if (indexedDB.databases) indexedDatabases = (await indexedDB.databases()).map(database => database.name || 'unnamed');
    return {
      forbiddenStorage,
      unsafePerTabMetadata,
      forbiddenGlobals,
      unsafeSimulationGlobal,
      indexedDatabases,
      indexedDbOpens: window.__northstarRatification.indexedDbOpens,
      accountListeners: window.__northstarRatification.accountListeners,
      accountScriptCount: document.querySelectorAll('script[src="/js/auth-session.js"]').length,
      singletonFrozen: Object.isFrozen(window.NorthStarAccountSession),
    };
  });
  assert.deepStrictEqual(evidence.forbiddenStorage, []);
  assert.deepStrictEqual(evidence.unsafePerTabMetadata, [], 'simulation correlation metadata stays per-tab and credential-free');
  assert.deepStrictEqual(evidence.forbiddenGlobals, []);
  assert.strictEqual(evidence.unsafeSimulationGlobal, false, 'simulation global mirrors credential-free per-tab metadata only');
  assert.ok(evidence.indexedDatabases.every(name => !/auth|token|credential|session/i.test(name)), 'IndexedDB names contain no auth authority');
  assert.ok(evidence.indexedDbOpens.every(name => !/auth|token|credential|session/i.test(name)), 'IndexedDB opens contain no auth authority');
  assert.ok(evidence.accountListeners <= 2, 'account event listeners remain bounded');
  assert.strictEqual(evidence.accountScriptCount, 1, 'one browser session client');
  assert.strictEqual(evidence.singletonFrozen, true, 'browser session client is immutable');
}

async function assertVisibleLogoutFailure(page, originalUrl) {
  assert.strictEqual(page.url(), originalUrl, 'failed logout remains on the current URL');
  const evidence = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('[data-account-logout-error], #northstar-logout-error, #toast, .toast, [role="alert"]'));
    const visible = candidates.find(element => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0 &&
        /logout|log out|sign out|could not confirm/i.test(element.textContent || '');
    });
    return {
      accountPresent: Boolean(window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount()),
      errorText: visible ? String(visible.textContent || '') : '',
      falseSuccess: /logged out successfully|logout successful|signed out successfully/i.test(document.body.innerText),
    };
  });
  assert.strictEqual(evidence.accountPresent, true, 'failed logout preserves browser account state');
  assert.match(evidence.errorText, /retry|try again|could not confirm|unable/i, 'failed logout presents a retryable error');
  assert.strictEqual(evidence.falseSuccess, false, 'failed logout never presents success');
  assert.doesNotMatch(evidence.errorText, /postgres|sql|token|credential|stack|\\|\/src\//i, 'logout error remains bounded');
}

async function browserLogout(page) {
  return page.evaluate(() => window.NorthStarAccountSession.logout().then(
    () => ({ resolved: true }),
    error => ({ resolved: false, code: error && error.code, status: error && error.status })
  ));
}

async function main() {
  if (!process.env.M19_PG_ADMIN_URL) throw new Error('Disposable PostgreSQL 18 identity is required');
  const chromeRuntime = resolveBrowserRuntime('chrome');
  const webkitRuntime = resolveBrowserRuntime('webkit');
  const allocation = await createSuiteDatabase('account-browser');
  const originals = {};
  for (const key of ['DATABASE_URL', 'AUTH_ACCESS_SECRET', 'NODE_ENV']) originals[key] = process.env[key];
  process.env.DATABASE_URL = allocation.connectionString;
  process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
  process.env.NODE_ENV = 'test';

  let db;
  let pool;
  let server;
  const browsers = [];
  const detachedPools = [];
  const totals = { requests: 0, apiResponses: 0 };
  try {
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    pool = db.getPool();
    const app = require('../helpers/account-test-app').createDisposableAccountApp();
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const password = 'browser password 123';

    const chrome = await chromeRuntime.browserType.launch({ executablePath: chromeRuntime.executablePath, headless: true });
    const webkit = await webkitRuntime.browserType.launch({ executablePath: webkitRuntime.executablePath, headless: true });
    browsers.push(chrome, webkit);

    async function apiSignup(email) {
      await pool.query("DELETE FROM auth_rate_limits WHERE event_type = 'signup_ip'");
      const response = await request(app).post('/api/auth/signup').send({
        name: 'Browser Owner', businessName: `Browser ${email}`, phone: '8605550199', email, password,
      });
      assert.strictEqual(response.status, 201, `mounted disposable signup: ${email}`);
      const identity = await pool.query('SELECT id, organization_id FROM users WHERE email_normalized = $1', [email]);
      assert.strictEqual(identity.rowCount, 1);
      return identity.rows[0];
    }

    async function provisionVerifiedFixture(email) {
      // TEST PROVISIONING ONLY: this is deliberately after the complete pending
      // journey below and is not evidence of the PR B verification flow.
      const identity = await apiSignup(email);
      await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [identity.id]);
      await putBusinessProfile(pool, {
        organizationId: identity.organization_id,
        userId: identity.id,
        profile: canonicalFenceProfile({ companyName: `Verified ${email}` }),
      });
      return identity;
    }

    async function loginContext(browser, viewport, email, storageState) {
      const tracked = await newTrackedContext(browser, baseUrl, viewport, totals, storageState);
      const page = await tracked.context.newPage();
      const errors = [];
      let credentialHeaders = null;
      page.on('pageerror', error => errors.push(error.message));
      if (!storageState) {
        await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
        await page.fill('#email', email.toUpperCase());
        await page.fill('#password', password);
        tracked.tracker.allow('POST', '/api/auth/login');
        const responsePromise = page.waitForResponse(response => response.url() === `${baseUrl}/api/auth/login`);
        await Promise.all([
          page.waitForURL(url => url.pathname === '/dashboard'),
          page.click('#loginForm button[type=submit]'),
        ]);
        const loginResponse = await responsePromise;
        credentialHeaders = (await loginResponse.headersArray())
          .filter(header => header.name.toLowerCase() === 'set-cookie')
          .map(header => header.value);
      } else {
        await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
      }
      await page.waitForFunction(() => window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount());
      return { ...tracked, page, errors, credentialHeaders };
    }

    // Authentic pending journey: the browser uses the real mounted signup
    // transaction exposed only by the disposable test application.
    const pendingTracked = await newTrackedContext(chrome, baseUrl, VIEWPORTS[1], totals);
    const pendingPage = await pendingTracked.context.newPage();
    await pendingPage.goto(`${baseUrl}/signup`, { waitUntil: 'networkidle' });
    await pendingPage.fill('#name', 'Pending Owner');
    await pendingPage.fill('#businessName', 'Pending Browser Company');
    await pendingPage.fill('#phone', '8605550123');
    await pendingPage.fill('#email', 'pending-browser@example.test');
    await pendingPage.fill('#password', password);
    pendingTracked.tracker.allow('POST', '/api/auth/signup');
    const signupResponsePromise = pendingPage.waitForResponse(response => response.url() === `${baseUrl}/api/auth/signup`);
    await Promise.all([
      pendingPage.waitForURL(url => url.pathname === '/dashboard/business-profile'),
      pendingPage.click('#signupForm button[type=submit]'),
    ]);
    const signupResponse = await signupResponsePromise;
    const signupCredentialHeaders = (await signupResponse.headersArray())
      .filter(header => header.name.toLowerCase() === 'set-cookie')
      .map(header => header.value);
    await pendingPage.waitForFunction(() => window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount());
    assert.strictEqual(await pendingPage.locator('#northstar-verification-status').isVisible(), true);
    assert.strictEqual((await pendingPage.evaluate(() => window.NorthStarAccountSession.getAccount())).user.status, 'pending_verification');
    await pendingPage.evaluate(() => {
      localStorage.setItem('northstar-notification-preferences', JSON.stringify({ emailEnabled: true, smsEnabled: true }));
      localStorage.setItem('northstar-auth-forgery', JSON.stringify({ role: 'owner', organizationId: 'foreign', verified: true }));
      sessionStorage.setItem('northstar-role-forgery', 'owner');
      window.currentUser = { role: 'owner', organizationId: 'foreign', status: 'active', onboarding: 'complete' };
    });
    const pendingProfile = canonicalFenceProfile({ companyName: 'Pending Browser Company' });
    pendingProfile.notifications = { email: true, sms: true, criticalAlerts: true };
    pendingTracked.tracker.allow('PUT', '/api/v1/business-profile');
    const saved = await pendingPage.evaluate(profile => window.NorthStarAccountSession.json('/api/v1/business-profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile),
    }), pendingProfile);
    assert.strictEqual(saved.success, true);
    const pendingAccount = await pendingPage.evaluate(() => window.NorthStarAccountSession.load(true));
    assert.strictEqual(pendingAccount.user.status, 'pending_verification', 'onboarding never verifies email');
    assert.strictEqual(pendingAccount.onboarding.status, 'complete');
    const preferences = await pendingPage.evaluate(() => window.NorthStarAccountSession.json('/api/account/preferences'));
    for (const name of ['emailEnabled', 'emailCallSummary', 'emailAppointment', 'smsEnabled', 'smsUrgent']) {
      assert.strictEqual(preferences.preferences[name], false, `${name} ignores stale browser/Profile claims`);
    }
    pendingTracked.tracker.allow('POST', '/api/v1/voice/call');
    const externalDenial = await pendingPage.evaluate(async () => {
      const response = await window.NorthStarAccountSession.fetch('/api/v1/voice/call', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneNumber: '8605550124' }),
      });
      return { status: response.status, body: await response.json() };
    });
    assert.deepStrictEqual({ status: externalDenial.status, code: externalDenial.body.code }, { status: 403, code: 'verification_required' });
    await pendingPage.evaluate(() => {
      localStorage.removeItem('northstar-auth-forgery');
      sessionStorage.removeItem('northstar-role-forgery');
      delete window.currentUser;
    });
    await pendingPage.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
    await pendingPage.waitForFunction(() => window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount());
    assert.strictEqual(new URL(pendingPage.url()).pathname, '/dashboard');
    assert.strictEqual(await pendingPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await assertNoBrowserAuthority(pendingPage);
    await assertCredentialCookieShape(pendingTracked.context, baseUrl, signupCredentialHeaders);
    await pendingTracked.tracker.assertClean();
    await pendingTracked.context.close();

    const active = await provisionVerifiedFixture('browser-active@example.test');

    // Actual installed Chrome and actual Playwright WebKit, never physical Safari.
    for (const [label, browser] of [['Chrome', chrome], ['Playwright WebKit', webkit]]) {
      for (const viewport of VIEWPORTS) {
        const run = await loginContext(browser, viewport, 'browser-active@example.test');
        assert.strictEqual(await run.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} ${viewport.label} overflow`);
        await assertCredentialCookieShape(run.context, baseUrl, run.credentialHeaders);
        await assertNoBrowserAuthority(run.page);
        const current = await pool.query(
          `SELECT session.id FROM auth_sessions session JOIN users account ON account.id = session.user_id
            WHERE account.id = $1 AND session.status = 'active' ORDER BY session.created_at DESC LIMIT 1`,
          [active.id]
        );
        assert.strictEqual(current.rowCount, 1);
        await pool.query("UPDATE auth_sessions SET access_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [current.rows[0].id]);
        const refreshBefore = await run.page.evaluate(() => window.__northstarRatification.fetchCounts['/api/auth/refresh'] || 0);
        run.tracker.allow('POST', '/api/auth/refresh');
        const statuses = await run.page.evaluate(() => Promise.all(Array.from({ length: 16 }, () => (
          window.NorthStarAccountSession.fetch('/api/auth/me', { cache: 'no-store' }).then(response => response.status)
        ))));
        assert.deepStrictEqual(statuses, Array(16).fill(200), `${label} ${viewport.label} refresh storm`);
        const refreshEvidence = await run.page.evaluate(before => ({
          calls: (window.__northstarRatification.fetchCounts['/api/auth/refresh'] || 0) - before,
          maxActive: window.__northstarRatification.refreshMaxActive,
        }), refreshBefore);
        assert.deepStrictEqual(refreshEvidence, { calls: 1, maxActive: 1 }, 'one refresh client handles the storm');

        const second = await run.context.newPage();
        await second.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
        await second.waitForFunction(() => window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount());
        assert.strictEqual(await second.evaluate(() => (
          window.NorthStarAccountSession.fetch('/api/auth/me').then(response => response.status)
        )), 200, 'second tab uses durable session');
        await second.close();
        const state = await run.context.storageState();
        assert.deepStrictEqual(run.errors, [], `${label} ${viewport.label} page errors`);
        await run.tracker.assertClean();
        await run.context.close();

        const restarted = await loginContext(browser, viewport, 'browser-active@example.test', state);
        assert.strictEqual(new URL(restarted.page.url()).pathname, '/dashboard', `${label} ${viewport.label} restart`);
        await assertNoBrowserAuthority(restarted.page);
        await restarted.tracker.assertClean();
        await restarted.context.close();
      }
    }

    const logoutFixture = await provisionVerifiedFixture('browser-logout@example.test');

    async function logoutFailureCase(label, prepare, restore) {
      const run = await loginContext(chrome, VIEWPORTS[0], 'browser-logout@example.test');
      const before = await assertCredentialCookieShape(run.context, baseUrl, run.credentialHeaders);
      const current = await pool.query(
        `SELECT session.id FROM auth_sessions session JOIN users account ON account.id = session.user_id
          WHERE account.id = $1 AND session.status = 'active' ORDER BY session.created_at DESC LIMIT 1`,
        [logoutFixture.id]
      );
      assert.strictEqual(current.rowCount, 1);
      const cleanup = await prepare({ ...run, cookies: before, sessionId: current.rows[0].id });
      const originalUrl = run.page.url();
      const mark = run.tracker.mark();
      run.tracker.allow('POST', '/api/auth/logout');
      const result = await browserLogout(run.page);
      assert.strictEqual(result.resolved, false, `${label} rejects`);
      await assertVisibleLogoutFailure(run.page, originalUrl);
      assert.strictEqual(run.tracker.eventsAfter(mark).some(event => event.type === 'request' && event.pathname === '/login'), false, `${label} has no false redirect`);
      const after = await run.context.cookies(baseUrl);
      for (const name of ['northstar_access', 'northstar_refresh']) {
        assert.strictEqual(after.find(cookie => cookie.name === name).value, before.find(cookie => cookie.name === name).value, `${label} preserves retry credentials`);
      }
      const durable = await pool.query('SELECT status FROM auth_sessions WHERE id = $1', [current.rows[0].id]);
      assert.deepStrictEqual(durable.rows, [{ status: 'active' }], `${label} leaves session active`);
      if (restore) await restore({ ...run, cleanup, cookies: before, sessionId: current.rows[0].id });
      await run.tracker.assertClean();
      await run.context.close();
    }

    for (const mode of ['missing', 'wrong']) {
      await logoutFailureCase(`${mode} CSRF`, async ({ context, cookies }) => {
        const csrf = cookies.find(cookie => cookie.name === 'northstar_csrf');
        if (mode === 'missing') await context.clearCookies({ name: 'northstar_csrf' });
        else await context.addCookies([{ ...csrf, value: 'wrong-csrf-browser-value' }]);
      });
    }

    await logoutFailureCase('network failure', async ({ page }) => {
      await page.route('**/api/auth/logout', route => route.abort('failed'));
    }, async ({ page }) => page.unroute('**/api/auth/logout'));

    let triggerInstalled = false;
    await logoutFailureCase('revocation transaction failure', async () => {
      await pool.query(`
        CREATE FUNCTION account_browser_reject_logout() RETURNS trigger AS $$
        BEGIN
          IF NEW.revoke_reason = 'logout' THEN RAISE EXCEPTION 'injected browser logout failure'; END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER account_browser_reject_logout_trigger BEFORE UPDATE ON auth_refresh_tokens
          FOR EACH ROW EXECUTE FUNCTION account_browser_reject_logout();
      `);
      triggerInstalled = true;
    }, async () => {
      await pool.query('DROP TRIGGER account_browser_reject_logout_trigger ON auth_refresh_tokens');
      await pool.query('DROP FUNCTION account_browser_reject_logout()');
      triggerInstalled = false;
    });

    const unavailable = await loginContext(chrome, VIEWPORTS[0], 'browser-logout@example.test');
    const unavailableBefore = await assertCredentialCookieShape(unavailable.context, baseUrl, unavailable.credentialHeaders);
    const unavailableSession = await pool.query(
      `SELECT session.id FROM auth_sessions session JOIN users account ON account.id = session.user_id
        WHERE account.id = $1 AND session.status = 'active' ORDER BY session.created_at DESC LIMIT 1`,
      [logoutFixture.id]
    );
    // Test-owned availability fault: retain the physical pool so the durable
    // state can be independently inspected, while production repository code
    // sees PostgreSQL authority as unavailable for the mounted request.
    detachedPools.push(pool);
    db.resetForTests();
    const unavailableUrl = unavailable.page.url();
    unavailable.tracker.allow('POST', '/api/auth/logout');
    assert.strictEqual((await browserLogout(unavailable.page)).resolved, false);
    await assertVisibleLogoutFailure(unavailable.page, unavailableUrl);
    const unavailableAfter = await unavailable.context.cookies(baseUrl);
    for (const name of CREDENTIAL_NAMES) {
      assert.strictEqual(unavailableAfter.find(cookie => cookie.name === name).value, unavailableBefore.find(cookie => cookie.name === name).value, `PostgreSQL failure preserves ${name}`);
    }
    const verifier = new Client({ connectionString: allocation.connectionString });
    await verifier.connect();
    try {
      const durable = await verifier.query('SELECT status FROM auth_sessions WHERE id = $1', [unavailableSession.rows[0].id]);
      assert.deepStrictEqual(durable.rows, [{ status: 'active' }]);
    } finally {
      await verifier.end();
    }
    assert.strictEqual(await db.initDatabase(), true);
    pool = db.getPool();
    await unavailable.tracker.assertClean();
    await unavailable.context.close();

    const success = await loginContext(chrome, VIEWPORTS[0], 'browser-logout@example.test');
    const successCookies = await assertCredentialCookieShape(success.context, baseUrl, success.credentialHeaders);
    const staleState = await success.context.storageState();
    const successSession = await pool.query(
      `SELECT session.id FROM auth_sessions session JOIN users account ON account.id = session.user_id
        WHERE account.id = $1 AND session.status = 'active' ORDER BY session.created_at DESC LIMIT 1`,
      [logoutFixture.id]
    );
    const secondTab = await success.context.newPage();
    await secondTab.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
    await secondTab.waitForFunction(() => window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount());
    const mark = success.tracker.mark();
    success.tracker.allow('POST', '/api/auth/logout');
    const logoutResponsePromise = success.page.waitForResponse(response => response.url() === `${baseUrl}/api/auth/logout`);
    const visibleLogout = success.page.locator('[data-account-logout]:visible').first();
    assert.strictEqual(await visibleLogout.count(), 1, 'one visible logout control is available');
    assert.strictEqual(await success.page.evaluate(() => (
      document.documentElement.getAttribute('data-northstar-logout-bound')
    )), 'true', 'shared delegated logout listener is bound');
    await Promise.all([
      success.page.waitForURL(url => url.pathname === '/login'),
      visibleLogout.evaluate(element => element.click()),
    ]);
    const logoutResponse = await logoutResponsePromise;
    assert.strictEqual(logoutResponse.status(), 200);
    const ordered = success.tracker.eventsAfter(mark);
    const logoutResponseIndex = ordered.findIndex(event => event.type === 'response' && event.pathname === '/api/auth/logout' && event.status === 200);
    const redirectIndex = ordered.findIndex(event => event.type === 'request' && event.pathname === '/login');
    assert.ok(logoutResponseIndex >= 0 && redirectIndex > logoutResponseIndex, 'redirect follows durable logout response');
    const clearing = (await logoutResponse.headersArray()).filter(header => header.name.toLowerCase() === 'set-cookie' && /northstar_(?:access|refresh|csrf)=/.test(header.value));
    assert.strictEqual(clearing.length, 3);
    assert.ok(clearing.every(header => /Path=\//i.test(header.value) && /SameSite=Lax/i.test(header.value) && /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(header.value)));
    assert.deepStrictEqual((await success.context.cookies(baseUrl)).filter(cookie => CREDENTIAL_NAMES.includes(cookie.name)), []);
    const revoked = await pool.query(
      `SELECT session.status, count(*) FILTER (WHERE token.status = 'active')::int AS active_tokens
         FROM auth_sessions session JOIN auth_refresh_tokens token ON token.session_id = session.id
        WHERE session.id = $1 GROUP BY session.id`,
      [successSession.rows[0].id]
    );
    assert.deepStrictEqual(revoked.rows, [{ status: 'revoked', active_tokens: 0 }]);
    assert.strictEqual(await secondTab.evaluate(() => fetch('/api/auth/me', { credentials: 'same-origin' }).then(response => response.status)), 401, 'second tab rejects revoked session');
    await secondTab.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
    await secondTab.waitForURL(url => url.pathname === '/login');
    await success.tracker.assertClean();
    await success.context.close();

    const restarted = await newTrackedContext(chrome, baseUrl, VIEWPORTS[0], totals, staleState);
    const restartedPage = await restarted.context.newPage();
    await restartedPage.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    assert.strictEqual(await restartedPage.evaluate(() => fetch('/api/auth/me', { credentials: 'same-origin' }).then(response => response.status)), 401, 'browser restart rejects revoked session');
    restarted.tracker.allow('POST', '/api/auth/logout');
    const repeat = await restartedPage.evaluate(async () => {
      const response = await window.NorthStarAccountSession.fetch('/api/auth/logout', { method: 'POST' });
      return { status: response.status, body: await response.json() };
    });
    assert.deepStrictEqual({ status: repeat.status, success: repeat.body.success }, { status: 200, success: true }, 'repeated logout confirms durable revocation');
    assert.deepStrictEqual((await restarted.context.cookies(baseUrl)).filter(cookie => CREDENTIAL_NAMES.includes(cookie.name)), []);
    await restarted.tracker.assertClean();
    await restarted.context.close();

    assert.ok(successCookies.length === 3);
    assert.strictEqual(triggerInstalled, false, 'fault trigger was removed');
    console.log(`Account Lifecycle browser ratification passed: actual Chrome and actual Playwright WebKit; 1440x900 + 390x844; ${totals.requests} local requests; ${totals.apiResponses} inspected API bodies`);
  } finally {
    for (const browser of browsers.reverse()) await browser.close().catch(() => {});
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.close();
    for (const detachedPool of detachedPools) await detachedPool.end().catch(() => {});
    await allocation.cleanup();
    Object.entries(originals).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
