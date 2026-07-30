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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function captureMounted401Wave(context, waveName, expectedRequests) {
  const ready = deferred();
  const entries = [];
  const calls = new Map();
  const handler = async route => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/api/auth/me' || url.searchParams.get('authWave') !== waveName) {
      await route.continue();
      return;
    }
    const key = url.searchParams.get('request');
    const call = (calls.get(key) || 0) + 1;
    calls.set(key, call);
    if (call > 1) {
      await route.continue();
      return;
    }
    try {
      const response = await route.fetch();
      assert.strictEqual(response.status(), 401, `${waveName} original request is a mounted 401`);
      const gate = deferred();
      entries.push({ gate, response, route });
      if (entries.length === expectedRequests) ready.resolve(entries);
      await gate.promise;
      await route.fulfill({ response });
    } catch (error) {
      ready.reject(error);
      try { await route.abort(); } catch (_ignored) { /* Page closure owns the request. */ }
    }
  };
  await context.route('**/api/auth/me**', handler);
  return {
    entries,
    ready: ready.promise,
    release(index) { entries[index].gate.resolve(); },
    releaseAll(start = 0) {
      for (let index = start; index < entries.length; index += 1) entries[index].gate.resolve();
    },
    async dispose() { await context.unroute('**/api/auth/me**', handler); },
  };
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
    requestCount(method, pathname, mark = 0) {
      return events.filter(event => event.sequence > mark && event.type === 'request' &&
        event.method === method && event.pathname === pathname).length;
    },
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
      waveCompletions: Object.create(null),
      authGenerationEvents: [],
      initialGlobals,
    };
    const addEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type) {
      if (type === 'northstar:account') evidence.accountListeners += 1;
      return addEventListener.apply(this, arguments);
    };
    addEventListener.call(window, 'northstar:auth-generation', event => {
      const detail = event && event.detail;
      evidence.authGenerationEvents.push({
        generation: detail && detail.generation,
        outcome: detail && detail.outcome,
        source: detail && detail.source,
      });
    });
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

async function assertNoBrowserAuthority(page, requireCoordinationState = false) {
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
    const coordinationRaw = localStorage.getItem('northstar-coordination-v1');
    let coordinationState = { present: coordinationRaw !== null, raw: coordinationRaw, value: null, parseError: false };
    if (coordinationRaw !== null) {
      try { coordinationState.value = JSON.parse(coordinationRaw); }
      catch (_error) { coordinationState.parseError = true; }
    }
    let indexedDatabases = [];
    if (indexedDB.databases) indexedDatabases = (await indexedDB.databases()).map(database => database.name || 'unnamed');
    let coordinationDatabase = { present: false, stores: [], leases: [], observedAt: Date.now() };
    if (indexedDatabases.includes('northstar-coordination-v1')) {
      coordinationDatabase = await new Promise(resolve => {
        const opened = indexedDB.open('northstar-coordination-v1');
        opened.onerror = () => resolve({ present: true, error: true, stores: [], leases: [], observedAt: Date.now() });
        opened.onsuccess = () => {
          const database = opened.result;
          const stores = Array.from(database.objectStoreNames);
          if (!stores.includes('leases')) {
            database.close();
            resolve({ present: true, stores, leases: [], observedAt: Date.now() });
            return;
          }
          const transaction = database.transaction('leases', 'readonly');
          const keys = transaction.objectStore('leases').getAllKeys();
          const values = transaction.objectStore('leases').getAll();
          transaction.oncomplete = () => {
            database.close();
            resolve({
              present: true,
              stores,
              leases: values.result.map((value, index) => ({ key: keys.result[index], value })),
              observedAt: Date.now(),
            });
          };
          transaction.onerror = () => {
            database.close();
            resolve({ present: true, error: true, stores, leases: [], observedAt: Date.now() });
          };
        };
      });
    }
    return {
      forbiddenStorage,
      unsafePerTabMetadata,
      forbiddenGlobals,
      unsafeSimulationGlobal,
      indexedDatabases,
      indexedDbOpens: window.__northstarRatification.indexedDbOpens,
      coordinationState,
      coordinationDatabase,
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
  if (requireCoordinationState) {
    assert.strictEqual(evidence.coordinationState.present, true, 'shared refresh coordination state is present after a refresh wave');
  }
  if (evidence.coordinationState.present) {
    assert.strictEqual(evidence.coordinationState.parseError, false, 'shared refresh coordination state is valid JSON');
    assert.ok(evidence.coordinationState.value && !Array.isArray(evidence.coordinationState.value), 'coordination state is an object');
    assert.deepStrictEqual(Object.keys(evidence.coordinationState.value).sort(), ['epoch', 'outcomes'], 'coordination state has an exact non-authoritative schema');
    assert.ok(Number.isSafeInteger(evidence.coordinationState.value.epoch), 'coordination epoch is a safe integer');
    assert.ok(evidence.coordinationState.value.epoch >= 0 && evidence.coordinationState.value.epoch <= 1000000000, 'coordination epoch is bounded');
    assert.ok(Array.isArray(evidence.coordinationState.value.outcomes), 'coordination outcomes are an array');
    assert.ok(evidence.coordinationState.value.outcomes.length <= 64, 'coordination outcomes remain bounded to 64');
    for (const outcome of evidence.coordinationState.value.outcomes) {
      assert.ok(outcome && !Array.isArray(outcome), 'coordination outcome is an object');
      assert.deepStrictEqual(Object.keys(outcome).sort(), ['attemptId', 'epoch', 'success'], 'coordination outcomes contain only non-authoritative metadata');
      assert.ok(Number.isSafeInteger(outcome.epoch) && outcome.epoch > 0 && outcome.epoch <= evidence.coordinationState.value.epoch, 'coordination outcome epoch is bounded');
      assert.strictEqual(typeof outcome.success, 'boolean', 'coordination outcome success is boolean');
      assert.match(outcome.attemptId, /^attempt-[A-Za-z0-9-]+$/, 'coordination attempt id is non-secret metadata');
    }
    assert.doesNotMatch(
      evidence.coordinationState.raw,
      /\bBearer\s+[A-Za-z0-9._~-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|"(?:accessToken|refreshToken|csrfToken|sessionId|organizationId|orgId|userId|role|verification|onboarding|password|secret)"\s*:/i,
      'coordination metadata contains no credentials or account authority'
    );
  }
  if (evidence.coordinationDatabase.present) {
    assert.strictEqual(evidence.coordinationDatabase.error, undefined, 'coordination IndexedDB remains readable');
    assert.deepStrictEqual(evidence.coordinationDatabase.stores, ['leases'], 'coordination IndexedDB contains only the lease store');
    for (const lease of evidence.coordinationDatabase.leases) {
      assert.strictEqual(lease.key, 'northstar-account-refresh-v1', 'one fixed non-secret lease key');
      assert.deepStrictEqual(Object.keys(lease.value).sort(), ['expiresAt', 'owner'], 'lease stores only owner and bounded expiry');
      assert.match(lease.value.owner, /^attempt-[A-Za-z0-9-]+$/, 'lease owner is a non-secret attempt id');
      assert.ok(Number.isFinite(lease.value.expiresAt), 'lease expiry is finite');
      assert.ok(lease.value.expiresAt <= evidence.coordinationDatabase.observedAt + 3000, 'lease expiry is bounded');
    }
  }
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
  const browserSelection = String(process.env.NORTHSTAR_BROWSER || 'both').toLowerCase();
  assert.ok(['chrome', 'webkit', 'both'].includes(browserSelection), 'NORTHSTAR_BROWSER must be chrome, webkit, or both');
  const selectedEngines = browserSelection === 'both' ? ['chrome', 'webkit'] : [browserSelection];
  const runtimeSpecs = selectedEngines.map(engine => ({
    engine,
    label: engine === 'chrome' ? 'Chrome' : 'Playwright WebKit',
    runtime: resolveBrowserRuntime(engine),
  }));
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
  const engineEvidence = {};
  try {
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    pool = db.getPool();
    const app = require('../helpers/account-test-app').createDisposableAccountApp();
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const password = 'browser password 123';

    const launchedEngines = [];
    for (const spec of runtimeSpecs) {
      const browser = await spec.runtime.browserType.launch({ executablePath: spec.runtime.executablePath, headless: true });
      browsers.push(browser);
      launchedEngines.push({ ...spec, browser });
      engineEvidence[spec.engine] = { viewports: {} };
    }
    const primaryBrowser = launchedEngines[0].browser;

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

    async function currentSession(userId) {
      const result = await pool.query(
        `SELECT session.id FROM auth_sessions session
          WHERE session.user_id = $1 AND session.status = 'active'
          ORDER BY session.created_at DESC LIMIT 1`,
        [userId]
      );
      assert.strictEqual(result.rowCount, 1, 'one current browser session');
      return result.rows[0].id;
    }

    async function expireAccess(sessionId) {
      await pool.query("UPDATE auth_sessions SET access_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [sessionId]);
    }

    function browserWave(page, waveName, count, requestPrefix = '') {
      const paths = Array.from({ length: count }, (_unused, index) => (
        `/api/auth/me?authWave=${encodeURIComponent(waveName)}&request=${encodeURIComponent(`${requestPrefix}${index}`)}`
      ));
      return page.evaluate(({ urls, wave }) => {
        const slot = window.__northstarRatification.waveCompletions[wave] = {
          completed: 0,
          statuses: Array(urls.length).fill(null),
        };
        return Promise.all(urls.map((url, index) => (
          window.NorthStarAccountSession.fetch(url, { cache: 'no-store' }).then(response => {
            slot.statuses[index] = response.status;
            slot.completed += 1;
            return response.status;
          }, error => {
            slot.statuses[index] = 'rejected';
            slot.completed += 1;
            throw error;
          })
        )));
      }, { urls: paths, wave: waveName });
    }

    function observePending(promise) {
      // Attach a rejection observer immediately so a later assertion can tear
      // down the context without allowing the still-pending page evaluation to
      // mask that original assertion as an unhandled rejection.
      promise.catch(() => {});
      return promise;
    }

    async function waitForBrowserWaveCompletions(page, waveName, count) {
      await page.waitForFunction(({ wave, expected }) => {
        const slot = window.__northstarRatification && window.__northstarRatification.waveCompletions[wave];
        return Boolean(slot && slot.completed >= expected);
      }, { wave: waveName, expected: count });
      return page.evaluate(wave => {
        const slot = window.__northstarRatification.waveCompletions[wave];
        return { completed: slot.completed, statuses: slot.statuses.slice() };
      }, waveName);
    }

    async function delayedSuccessfulWave(run, sessionId, waveName, count) {
      await expireAccess(sessionId);
      const controller = await captureMounted401Wave(run.context, waveName, count);
      const mark = run.tracker.mark();
      run.tracker.allow('POST', '/api/auth/refresh');
      const operation = observePending(browserWave(run.page, waveName, count));
      await controller.ready;
      controller.release(0);
      const leadingCompletion = await waitForBrowserWaveCompletions(run.page, waveName, 1);
      assert.strictEqual(leadingCompletion.statuses.filter(status => status === 200).length, 1, `${waveName} leading caller completes after refresh cleanup`);
      controller.releaseAll(1);
      const statuses = await operation;
      await controller.dispose();
      assert.deepStrictEqual(statuses, Array(count).fill(200), `${waveName} retries all mounted 401 responses`);
      assert.strictEqual(run.tracker.requestCount('POST', '/api/auth/refresh', mark), 1, `${waveName} exact refresh count`);
      return 1;
    }

    async function failedRefreshAndRecovery(run, sessionId, waveName, failureMode, holdOriginalThroughRecovery = false) {
      await expireAccess(sessionId);
      const controller = await captureMounted401Wave(run.context, waveName, 8);
      const refreshHandler = async route => {
        if (failureMode === 'network') await route.abort('failed');
        else await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'account_authority_unavailable', error: 'Account service is temporarily unavailable' }),
        });
      };
      await run.context.route('**/api/auth/refresh', refreshHandler);
      const failedMark = run.tracker.mark();
      run.tracker.allow('POST', '/api/auth/refresh');
      const failedOperation = observePending(browserWave(run.page, waveName, 8));
      await controller.ready;
      if (holdOriginalThroughRecovery) controller.release(0);
      else controller.releaseAll();
      const releasedCount = holdOriginalThroughRecovery ? 1 : 8;
      const releasedCompletion = await waitForBrowserWaveCompletions(run.page, waveName, releasedCount);
      assert.strictEqual(releasedCompletion.statuses.filter(status => status === 401).length, releasedCount, `${waveName} released callers complete the failed refresh wave`);
      assert.strictEqual(run.tracker.requestCount('POST', '/api/auth/refresh', failedMark), 1, `${waveName} failed refresh count`);
      await run.context.unroute('**/api/auth/refresh', refreshHandler);

      const recoveryMark = run.tracker.mark();
      run.tracker.allow('POST', '/api/auth/refresh');
      const recovered = await run.page.evaluate(url => (
        window.NorthStarAccountSession.fetch(url, { cache: 'no-store' }).then(response => response.status)
      ), `/api/auth/me?recovery=${encodeURIComponent(waveName)}`);
      assert.strictEqual(recovered, 200, `${waveName} later request recovers`);
      assert.strictEqual(run.tracker.requestCount('POST', '/api/auth/refresh', recoveryMark), 1, `${waveName} recovery refresh count`);
      if (holdOriginalThroughRecovery) controller.releaseAll(1);
      const failedStatuses = await failedOperation;
      assert.deepStrictEqual(failedStatuses, Array(8).fill(401), `${waveName} callers join one failed wave even after later recovery`);
      assert.strictEqual(run.tracker.requestCount('POST', '/api/auth/refresh', failedMark), 2, `${waveName} has one failed attempt and one later recovery only`);
      await controller.dispose();
      return { failed: 1, recovery: 1 };
    }

    // Authentic pending journey: the browser uses the real mounted signup
    // transaction exposed only by the disposable test application.
    const pendingTracked = await newTrackedContext(primaryBrowser, baseUrl, VIEWPORTS[1], totals);
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
    for (const { engine, label, browser } of launchedEngines) {
      for (const viewport of VIEWPORTS) {
        const run = await loginContext(browser, viewport, 'browser-active@example.test');
        assert.strictEqual(await run.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} ${viewport.label} overflow`);
        await assertCredentialCookieShape(run.context, baseUrl, run.credentialHeaders);
        await assertNoBrowserAuthority(run.page);
        const sessionId = await currentSession(active.id);
        const evidence = {
          simultaneous401Refreshes: 0,
          delayedOld401AdditionalRefreshes: 0,
          twoExpiryWaveRefreshes: 0,
          httpFailureAttempts: 0,
          httpRecoveryAttempts: 0,
          networkFailureAttempts: 0,
          networkRecoveryAttempts: 0,
          retry401Refreshes: 0,
          forgedSharedSuccessRefreshes: 0,
          forgedSharedSuccessRecoveryRefreshes: 0,
          twoTabFailureRefreshes: 0,
          twoTabFailureRecoveryRefreshes: 0,
          twoTabFailureGenerationBaselines: null,
          twoTabRefreshes: 0,
          tabCloseRecoveryRefreshes: 0,
          idbFallbackRefreshes: 0,
          restartRefreshes: 0,
          maxConcurrentRefreshes: 0,
          capabilities: await run.page.evaluate(() => ({
            webLocks: Boolean(navigator.locks && typeof navigator.locks.request === 'function'),
            broadcastChannel: typeof BroadcastChannel === 'function',
            indexedDb: Boolean(window.indexedDB),
          })),
        };

        const twoWaveMark = run.tracker.mark();
        evidence.simultaneous401Refreshes = await delayedSuccessfulWave(
          run, sessionId, `${engine}-${viewport.label}-sixteen`, 16
        );
        evidence.delayedOld401AdditionalRefreshes = 0;
        await delayedSuccessfulWave(run, sessionId, `${engine}-${viewport.label}-second-wave`, 4);
        evidence.twoExpiryWaveRefreshes = run.tracker.requestCount('POST', '/api/auth/refresh', twoWaveMark);
        assert.strictEqual(evidence.twoExpiryWaveRefreshes, 2, `${label} ${viewport.label} two expiry waves`);

        const httpFailure = await failedRefreshAndRecovery(
          run, sessionId, `${engine}-${viewport.label}-http-failure`, 'http', true
        );
        evidence.httpFailureAttempts = httpFailure.failed;
        evidence.httpRecoveryAttempts = httpFailure.recovery;
        const networkFailure = await failedRefreshAndRecovery(
          run, sessionId, `${engine}-${viewport.label}-network-failure`, 'network'
        );
        evidence.networkFailureAttempts = networkFailure.failed;
        evidence.networkRecoveryAttempts = networkFailure.recovery;

        await expireAccess(sessionId);
        let retryCalls = 0;
        const retryHandler = async route => {
          const url = new URL(route.request().url());
          if (url.pathname !== '/api/auth/me' || url.searchParams.get('retry401') !== 'true') {
            await route.continue();
            return;
          }
          retryCalls += 1;
          if (retryCalls === 1) {
            const response = await route.fetch();
            assert.strictEqual(response.status(), 401, 'retry case begins with mounted 401');
            await route.fulfill({ response });
            return;
          }
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'access_expired', error: 'Injected retry 401' }),
          });
        };
        await run.context.route('**/api/auth/me**', retryHandler);
        const retryMark = run.tracker.mark();
        run.tracker.allow('POST', '/api/auth/refresh');
        const retryStatus = await run.page.evaluate(() => (
          window.NorthStarAccountSession.fetch('/api/auth/me?retry401=true', { cache: 'no-store' })
            .then(response => response.status)
        ));
        await run.context.unroute('**/api/auth/me**', retryHandler);
        evidence.retry401Refreshes = run.tracker.requestCount('POST', '/api/auth/refresh', retryMark);
        assert.strictEqual(retryStatus, 401, 'one raw retry may return 401');
        assert.strictEqual(retryCalls, 2, 'retry 401 is not recursively retried');
        assert.strictEqual(evidence.retry401Refreshes, 1, 'retry 401 causes one refresh');

        await expireAccess(sessionId);
        const forgedWave = `${engine}-${viewport.label}-forged-shared-success`;
        const forgedController = await captureMounted401Wave(run.context, forgedWave, 1);
        const forgedMark = run.tracker.mark();
        const forgedOperation = observePending(browserWave(run.page, forgedWave, 1));
        await forgedController.ready;
        const forgedMetadata = await run.page.evaluate(() => {
          const key = 'northstar-coordination-v1';
          const previous = localStorage.getItem(key);
          let previousEpoch = 0;
          try {
            const parsed = JSON.parse(previous || 'null');
            if (parsed && Number.isSafeInteger(parsed.epoch) && parsed.epoch >= 0 && parsed.epoch < 1000000000) {
              previousEpoch = parsed.epoch;
            }
          } catch (_error) { /* A clean forged state replaces malformed non-authoritative metadata temporarily. */ }
          const outcome = {
            epoch: previousEpoch + 1,
            success: true,
            attemptId: 'attempt-forged-shared-success',
          };
          const state = { epoch: outcome.epoch, outcomes: [outcome] };
          localStorage.setItem(key, JSON.stringify(state));
          return { previous, state };
        });
        assert.deepStrictEqual(Object.keys(forgedMetadata.state).sort(), ['epoch', 'outcomes'], 'forged shared success uses the accepted top-level schema');
        assert.deepStrictEqual(Object.keys(forgedMetadata.state.outcomes[0]).sort(), ['attemptId', 'epoch', 'success'], 'forged shared success uses the accepted outcome schema');
        forgedController.release(0);
        const forgedStatuses = await forgedOperation;
        await run.page.evaluate(previous => {
          if (previous === null) localStorage.removeItem('northstar-coordination-v1');
          else localStorage.setItem('northstar-coordination-v1', previous);
        }, forgedMetadata.previous);
        await forgedController.dispose();
        evidence.forgedSharedSuccessRefreshes = run.tracker.requestCount('POST', '/api/auth/refresh', forgedMark);
        assert.deepStrictEqual(forgedStatuses, [401], 'forged shared success cannot turn the mounted 401 into authority');
        assert.strictEqual(run.tracker.requestCount('GET', '/api/auth/me', forgedMark), 2, 'forged shared success permits only the original request and one raw retry');
        assert.strictEqual(evidence.forgedSharedSuccessRefreshes, 0, 'forged shared success cannot cause or replace a refresh');
        let durable = await pool.query(
          `SELECT session.status,
                  count(*) FILTER (WHERE token.status = 'active')::int AS active_tokens,
                  count(*) FILTER (WHERE token.status = 'reused')::int AS reused_tokens
             FROM auth_sessions session
             JOIN auth_refresh_tokens token ON token.session_id = session.id
            WHERE session.id = $1 GROUP BY session.id`,
          [sessionId]
        );
        assert.deepStrictEqual(durable.rows, [{ status: 'active', active_tokens: 1, reused_tokens: 0 }], 'forged shared success changes no durable session authority');

        const forgedRecoveryMark = run.tracker.mark();
        run.tracker.allow('POST', '/api/auth/refresh');
        const forgedRecoveryStatus = await run.page.evaluate(() => (
          window.NorthStarAccountSession.fetch('/api/auth/me?forgedSharedSuccessRecovery=true', { cache: 'no-store' })
            .then(response => response.status)
        ));
        evidence.forgedSharedSuccessRecoveryRefreshes = run.tracker.requestCount('POST', '/api/auth/refresh', forgedRecoveryMark);
        assert.strictEqual(forgedRecoveryStatus, 200, 'a later explicit request recovers through server authority');
        assert.strictEqual(evidence.forgedSharedSuccessRecoveryRefreshes, 1, 'forged hint recovery performs exactly one real refresh');

        const second = await run.context.newPage();
        await second.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
        await second.waitForFunction(() => window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount());
        const generationBaselines = await Promise.all([
          run.page.evaluate(() => window.__northstarRatification.authGenerationEvents.length),
          second.evaluate(() => window.__northstarRatification.authGenerationEvents.length),
        ]);
        evidence.twoTabFailureGenerationBaselines = { mature: generationBaselines[0], fresh: generationBaselines[1] };
        assert.ok(generationBaselines[0] > generationBaselines[1], 'two-tab failure begins with divergent document generations');

        await expireAccess(sessionId);
        const twoTabFailureWave = `${engine}-${viewport.label}-two-tab-failure`;
        const twoTabFailureController = await captureMounted401Wave(run.context, twoTabFailureWave, 2);
        const twoTabFailureHandler = async route => route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'account_authority_unavailable', error: 'Account service is temporarily unavailable' }),
        });
        await run.context.route('**/api/auth/refresh', twoTabFailureHandler);
        const twoTabFailureMark = run.tracker.mark();
        run.tracker.allow('POST', '/api/auth/refresh');
        const matureTabFailure = observePending(browserWave(run.page, twoTabFailureWave, 1, 'mature-'));
        const freshTabFailure = observePending(browserWave(second, twoTabFailureWave, 1, 'fresh-'));
        await twoTabFailureController.ready;
        twoTabFailureController.releaseAll();
        const twoTabFailureStatuses = await Promise.all([matureTabFailure, freshTabFailure]);
        await run.context.unroute('**/api/auth/refresh', twoTabFailureHandler);
        await twoTabFailureController.dispose();
        evidence.twoTabFailureRefreshes = run.tracker.requestCount('POST', '/api/auth/refresh', twoTabFailureMark);
        assert.deepStrictEqual(twoTabFailureStatuses, [[401], [401]], 'mature and fresh tabs join the same failed refresh outcome');
        assert.strictEqual(evidence.twoTabFailureRefreshes, 1, 'divergent tab generations perform exactly one failed refresh attempt');
        durable = await pool.query(
          `SELECT session.status,
                  count(*) FILTER (WHERE token.status = 'active')::int AS active_tokens,
                  count(*) FILTER (WHERE token.status = 'reused')::int AS reused_tokens
             FROM auth_sessions session
             JOIN auth_refresh_tokens token ON token.session_id = session.id
            WHERE session.id = $1 GROUP BY session.id`,
          [sessionId]
        );
        assert.deepStrictEqual(durable.rows, [{ status: 'active', active_tokens: 1, reused_tokens: 0 }], 'failed two-tab refresh leaves the durable session active without replay');

        const twoTabFailureRecoveryMark = run.tracker.mark();
        run.tracker.allow('POST', '/api/auth/refresh');
        const twoTabFailureRecovery = await second.evaluate(() => (
          window.NorthStarAccountSession.fetch('/api/auth/me?twoTabFailureRecovery=true', { cache: 'no-store' })
            .then(response => response.status)
        ));
        evidence.twoTabFailureRecoveryRefreshes = run.tracker.requestCount('POST', '/api/auth/refresh', twoTabFailureRecoveryMark);
        assert.strictEqual(twoTabFailureRecovery, 200, 'a later explicit request recovers after the shared failure');
        assert.strictEqual(evidence.twoTabFailureRecoveryRefreshes, 1, 'shared failure recovery performs exactly one later refresh');
        durable = await pool.query(
          `SELECT session.status,
                  count(*) FILTER (WHERE token.status = 'active')::int AS active_tokens,
                  count(*) FILTER (WHERE token.status = 'reused')::int AS reused_tokens
             FROM auth_sessions session
             JOIN auth_refresh_tokens token ON token.session_id = session.id
            WHERE session.id = $1 GROUP BY session.id`,
          [sessionId]
        );
        assert.deepStrictEqual(durable.rows, [{ status: 'active', active_tokens: 1, reused_tokens: 0 }], 'two-tab recovery rotates without replay revocation');

        await expireAccess(sessionId);
        const twoTabWave = `${engine}-${viewport.label}-two-tab`;
        const twoTabController = await captureMounted401Wave(run.context, twoTabWave, 2);
        const twoTabMark = run.tracker.mark();
        run.tracker.allow('POST', '/api/auth/refresh');
        const firstTabOperation = observePending(browserWave(run.page, twoTabWave, 1));
        const secondTabOperation = observePending(browserWave(second, twoTabWave, 1, 'second-'));
        await twoTabController.ready;
        twoTabController.releaseAll();
        assert.deepStrictEqual(await Promise.all([firstTabOperation, secondTabOperation]), [[200], [200]], 'two tabs share one rotation');
        await twoTabController.dispose();
        evidence.twoTabRefreshes = run.tracker.requestCount('POST', '/api/auth/refresh', twoTabMark);
        assert.strictEqual(evidence.twoTabRefreshes, 1, 'two tabs perform one coordinated refresh');
        durable = await pool.query(
          `SELECT session.status,
                  count(*) FILTER (WHERE token.status = 'active')::int AS active_tokens,
                  count(*) FILTER (WHERE token.status = 'reused')::int AS reused_tokens
             FROM auth_sessions session
             JOIN auth_refresh_tokens token ON token.session_id = session.id
            WHERE session.id = $1 GROUP BY session.id`,
          [sessionId]
        );
        assert.deepStrictEqual(durable.rows, [{ status: 'active', active_tokens: 1, reused_tokens: 0 }], 'two-tab coordination does not trigger replay revocation');

        const coordinator = await run.context.newPage();
        await coordinator.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
        await coordinator.waitForFunction(() => window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount());
        await expireAccess(sessionId);
        const probeStarted = deferred();
        const probeRelease = deferred();
        const closeHandler = async route => {
          const url = new URL(route.request().url());
          let requestPage = null;
          try { requestPage = route.request().frame().page(); } catch (_error) { requestPage = null; }
          if (url.pathname === '/api/auth/me' && !url.search && requestPage === coordinator) {
            probeStarted.resolve();
            await probeRelease.promise;
            try { await route.abort('failed'); } catch (_ignored) { /* Coordinator closure owns the request. */ }
            return;
          }
          await route.continue();
        };
        await run.context.route('**/api/auth/me**', closeHandler);
        const closeMark = run.tracker.mark();
        run.tracker.allow('POST', '/api/auth/refresh');
        const coordinatorOperation = coordinator.evaluate(() => (
          window.NorthStarAccountSession.fetch('/api/auth/me?tabClose=leader', { cache: 'no-store' })
            .then(response => response.status)
        )).catch(() => null);
        await probeStarted.promise;
        const followerInitial = second.waitForResponse(response => (
          response.url().includes('/api/auth/me?tabClose=follower') && response.status() === 401
        ));
        const startedAt = Date.now();
        const followerOperation = observePending(second.evaluate(() => (
          window.NorthStarAccountSession.fetch('/api/auth/me?tabClose=follower', { cache: 'no-store' })
            .then(response => response.status)
        )));
        await followerInitial;
        const closing = coordinator.close();
        await new Promise(resolve => setTimeout(resolve, 50));
        probeRelease.resolve();
        await closing;
        const followerStatus = await Promise.race([
          followerOperation,
          new Promise((_resolve, reject) => setTimeout(() => reject(new Error('tab-close recovery exceeded 5 seconds')), 5000)),
        ]);
        await coordinatorOperation;
        await run.context.unroute('**/api/auth/me**', closeHandler);
        evidence.tabCloseRecoveryRefreshes = run.tracker.requestCount('POST', '/api/auth/refresh', closeMark);
        assert.strictEqual(followerStatus, 200, 'surviving tab recovers after coordinator closes');
        assert.ok(Date.now() - startedAt < 5000, 'tab-close recovery is bounded');
        assert.strictEqual(evidence.tabCloseRecoveryRefreshes, 1, 'tab-close recovery rotates once');
        durable = await pool.query(
          `SELECT session.status,
                  count(*) FILTER (WHERE token.status = 'active')::int AS active_tokens,
                  count(*) FILTER (WHERE token.status = 'reused')::int AS reused_tokens
             FROM auth_sessions session
             JOIN auth_refresh_tokens token ON token.session_id = session.id
            WHERE session.id = $1 GROUP BY session.id`,
          [sessionId]
        );
        assert.deepStrictEqual(durable.rows, [{ status: 'active', active_tokens: 1, reused_tokens: 0 }], 'tab-close recovery preserves replay authority');
        await second.close();
        evidence.maxConcurrentRefreshes = await run.page.evaluate(() => window.__northstarRatification.refreshMaxActive);
        assert.ok(evidence.maxConcurrentRefreshes <= 1, 'one document never overlaps refresh requests');
        await assertNoBrowserAuthority(run.page, true);
        let state = await run.context.storageState();
        assert.deepStrictEqual(run.errors, [], `${label} ${viewport.label} page errors`);
        await run.tracker.assertClean();
        await run.context.close();

        const fallback = await newTrackedContext(browser, baseUrl, viewport, totals, state);
        await fallback.context.addInitScript(() => {
          try { Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }); }
          catch (_error) {
            try { Object.defineProperty(Navigator.prototype, 'locks', { configurable: true, get: () => undefined }); }
            catch (_ignored) { /* Capability assertion below fails closed. */ }
          }
        });
        const fallbackFirst = await fallback.context.newPage();
        const fallbackSecond = await fallback.context.newPage();
        await Promise.all([
          fallbackFirst.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' }),
          fallbackSecond.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' }),
        ]);
        await Promise.all([
          fallbackFirst.waitForFunction(() => window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount()),
          fallbackSecond.waitForFunction(() => window.NorthStarAccountSession && window.NorthStarAccountSession.getAccount()),
        ]);
        assert.deepStrictEqual(await fallbackFirst.evaluate(() => ({
          webLocks: Boolean(navigator.locks && typeof navigator.locks.request === 'function'),
          broadcastChannel: typeof BroadcastChannel === 'function',
          indexedDb: Boolean(window.indexedDB),
        })), { webLocks: false, broadcastChannel: true, indexedDb: true }, 'forced fallback has BC and IndexedDB but no Web Locks');
        await expireAccess(sessionId);
        const fallbackWaveName = `${engine}-${viewport.label}-idb-fallback`;
        const fallbackController = await captureMounted401Wave(fallback.context, fallbackWaveName, 2);
        let delayedFallbackRefreshes = 0;
        const delayedFallbackRefresh = async route => {
          delayedFallbackRefreshes += 1;
          if (delayedFallbackRefreshes === 1) await new Promise(resolve => setTimeout(resolve, 3500));
          await route.continue();
        };
        await fallback.context.route('**/api/auth/refresh', delayedFallbackRefresh);
        const fallbackMark = fallback.tracker.mark();
        fallback.tracker.allow('POST', '/api/auth/refresh');
        const fallbackOne = observePending(browserWave(fallbackFirst, fallbackWaveName, 1));
        const fallbackTwo = observePending(fallbackSecond.evaluate(url => (
          window.NorthStarAccountSession.fetch(url, { cache: 'no-store' }).then(response => response.status)
        ), `/api/auth/me?authWave=${encodeURIComponent(fallbackWaveName)}&request=second`));
        await fallbackController.ready;
        fallbackController.releaseAll();
        assert.deepStrictEqual(await Promise.all([fallbackOne, fallbackTwo]), [[200], 200], 'IndexedDB fallback coordinates two tabs');
        await fallback.context.unroute('**/api/auth/refresh', delayedFallbackRefresh);
        await fallbackController.dispose();
        evidence.idbFallbackRefreshes = fallback.tracker.requestCount('POST', '/api/auth/refresh', fallbackMark);
        assert.strictEqual(evidence.idbFallbackRefreshes, 1, 'IndexedDB fallback performs exactly one rotation');
        assert.strictEqual(delayedFallbackRefreshes, 1, 'lease remains exclusive beyond its initial duration');
        durable = await pool.query(
          `SELECT session.status,
                  count(*) FILTER (WHERE token.status = 'active')::int AS active_tokens,
                  count(*) FILTER (WHERE token.status = 'reused')::int AS reused_tokens
             FROM auth_sessions session
             JOIN auth_refresh_tokens token ON token.session_id = session.id
            WHERE session.id = $1 GROUP BY session.id`,
          [sessionId]
        );
        assert.deepStrictEqual(durable.rows, [{ status: 'active', active_tokens: 1, reused_tokens: 0 }], 'IndexedDB fallback preserves replay authority');
        await assertNoBrowserAuthority(fallbackFirst, true);
        state = await fallback.context.storageState();
        await fallback.tracker.assertClean();
        await fallback.context.close();

        const restarted = await loginContext(browser, viewport, 'browser-active@example.test', state);
        assert.strictEqual(new URL(restarted.page.url()).pathname, '/dashboard', `${label} ${viewport.label} restart`);
        await assertNoBrowserAuthority(restarted.page, true);
        evidence.restartRefreshes = restarted.tracker.requestCount('POST', '/api/auth/refresh');
        assert.strictEqual(evidence.restartRefreshes, 0, 'browser restart bootstraps without refresh');
        await restarted.tracker.assertClean();
        await restarted.context.close();
        engineEvidence[engine].viewports[viewport.label] = evidence;
      }
    }

    const logoutFixture = await provisionVerifiedFixture('browser-logout@example.test');

    async function logoutFailureCase(label, prepare, restore) {
      const run = await loginContext(primaryBrowser, VIEWPORTS[0], 'browser-logout@example.test');
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

    const unavailable = await loginContext(primaryBrowser, VIEWPORTS[0], 'browser-logout@example.test');
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

    const success = await loginContext(primaryBrowser, VIEWPORTS[0], 'browser-logout@example.test');
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

    const restarted = await newTrackedContext(primaryBrowser, baseUrl, VIEWPORTS[0], totals, staleState);
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
    console.log('ACCOUNT_LIFECYCLE_BROWSER_EVIDENCE ' + JSON.stringify({
      selected: selectedEngines,
      engines: engineEvidence,
      localRequests: totals.requests,
      inspectedApiBodies: totals.apiResponses,
      logout: {
        missingCsrf: 'failed_without_redirect',
        wrongCsrf: 'failed_without_redirect',
        networkFailure: 'failed_without_redirect',
        postgresUnavailable: 'failed_without_redirect',
        revocationFailure: 'failed_without_redirect',
        success: 'revoked_then_redirected',
        repeated: 'confirmed_revoked',
      },
    }));
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
