'use strict';

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const ROOT = path.resolve(__dirname, '..', '..');
const VIEWPORTS = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 },
];
const JOBBER_STATUS_PATH = '/api/integrations/jobber/status';
const JOBBER_AUTH_PATH = '/api/integrations/jobber/auth';
const JOBBER_CALLBACK_PATH = '/api/integrations/jobber/callback';

function responseCookies(response) {
  const values = {};
  for (const header of response.headers['set-cookie'] || []) {
    const pair = header.split(';')[0];
    const separator = pair.indexOf('=');
    values[pair.slice(0, separator)] = decodeURIComponent(pair.slice(separator + 1));
  }
  return values;
}

function cookieHeader(values) {
  return Object.entries(values)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
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
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function waitFor(predicate, label, timeoutMilliseconds = 10000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function unavailableProjection(body) {
  return {
    available: body && body.available,
    configured: body && body.configured,
    connected: body && body.connected,
  };
}

function assertUnavailableProjection(body, label) {
  assert.deepStrictEqual(
    unavailableProjection(body),
    { available: false, configured: false, connected: false },
    `${label} uses the mounted unavailable projection`
  );
}

function assertUnavailableBoundary(response, label) {
  assert.strictEqual(response.status, 503, `${label} is unavailable`);
  assert.strictEqual(response.headers.location, undefined, `${label} has no redirect Location`);
  assert.strictEqual(response.headers['set-cookie'], undefined, `${label} creates no cookies`);
  assert.deepStrictEqual(
    { error: response.body.error, code: response.body.code },
    { error: 'Jobber integration is unavailable', code: 'jobber_unavailable' },
    `${label} returns the bounded source-owned response`
  );
}

function requestInventory(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = `${entry.phase} ${entry.method} ${entry.pathname}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => ({ key, count }));
}

async function provisionMountedIdentity(app, pool) {
  const email = `jobber-browser-${crypto.randomUUID()}@example.test`;
  const password = 'Jobber browser password 123!';
  await pool.query("DELETE FROM auth_rate_limits WHERE event_type = 'signup_ip'");
  const signup = await request(app).post('/api/auth/signup').send({
    name: 'Jobber Browser Owner',
    businessName: 'Jobber Browser Company',
    phone: '8605550177',
    email,
    password,
  });
  assert.strictEqual(signup.status, 201, 'mounted disposable signup succeeds');
  const cookies = responseCookies(signup);
  assert.ok(cookies.northstar_access && cookies.northstar_refresh && cookies.northstar_csrf, 'signup sets the real credential cookies');
  const cookie = cookieHeader(cookies);

  const pending = await request(app).get('/api/auth/me').set('Cookie', cookie);
  assert.strictEqual(pending.status, 200, 'pending identity can read its mounted account');
  assert.strictEqual(pending.body.account.user.status, 'pending_verification');
  assert.strictEqual(pending.body.account.onboarding.status, 'business_profile_required');

  const profile = await request(app)
    .put('/api/v1/business-profile')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', cookies.northstar_csrf)
    .send(canonicalFenceProfile({ companyName: 'Jobber Browser Company' }));
  assert.strictEqual(profile.status, 200, 'mounted Business Profile onboarding succeeds');

  const onboarded = await request(app).get('/api/auth/me').set('Cookie', cookie);
  assert.strictEqual(onboarded.status, 200);
  assert.strictEqual(onboarded.body.account.user.status, 'pending_verification', 'onboarding does not verify email');
  assert.strictEqual(onboarded.body.account.onboarding.status, 'complete');

  const authority = await pool.query(
    `SELECT account.id AS user_id,
            account.organization_id,
            account.status AS user_status,
            membership.status AS membership_status,
            membership.role,
            session.id AS session_id,
            session.status AS session_status,
            onboarding.status AS onboarding_status,
            EXISTS (
              SELECT 1
                FROM canonical_business_profiles profile
               WHERE profile.organization_id = account.organization_id
                 AND profile.is_active = TRUE
            ) AS active_profile
       FROM users account
       JOIN organization_memberships membership
         ON membership.user_id = account.id
        AND membership.organization_id = account.organization_id
       JOIN auth_sessions session
         ON session.user_id = account.id
        AND session.organization_id = account.organization_id
        AND session.membership_id = membership.id
       JOIN organization_onboarding onboarding
         ON onboarding.organization_id = account.organization_id
      WHERE account.email_normalized = $1
      ORDER BY session.created_at DESC
      LIMIT 1`,
    [email]
  );
  assert.strictEqual(authority.rowCount, 1, 'mounted identity has one current PostgreSQL authority graph');
  assert.deepStrictEqual(
    {
      user: authority.rows[0].user_status,
      membership: authority.rows[0].membership_status,
      role: authority.rows[0].role,
      session: authority.rows[0].session_status,
      onboarding: authority.rows[0].onboarding_status,
      activeProfile: authority.rows[0].active_profile,
    },
    {
      user: 'pending_verification',
      membership: 'active',
      role: 'owner',
      session: 'active',
      onboarding: 'complete',
      activeProfile: true,
    },
    'PostgreSQL reflects the mounted pending/onboarding journey'
  );

  // TEST PROVISIONING ONLY: the mounted pending journey and onboarding were
  // proven above. PR B owns the email-verification flow.
  await pool.query("UPDATE users SET status = 'active' WHERE id = $1", [authority.rows[0].user_id]);
  const verified = await request(app).get('/api/auth/me').set('Cookie', cookie);
  assert.strictEqual(verified.status, 200);
  assert.strictEqual(verified.body.account.user.status, 'active', 'test-only verification is visible through mounted authority');
  assert.strictEqual(verified.body.account.onboarding.status, 'complete');

  return {
    email,
    password,
    cookie,
    userId: authority.rows[0].user_id,
    sessionId: authority.rows[0].session_id,
  };
}

async function exerciseViewport(browser, engine, viewport, pool, baseUrl, identity, totals) {
  const context = await browser.newContext({ viewport });
  const requests = [];
  const responses = [];
  const responseReads = [];
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const interceptedNonlocal = [];
  const requestPhases = new WeakMap();
  let phase = 'login';
  const oauthStateBefore = await pool.query(
    'SELECT count(*)::int AS count FROM oauth_authorization_states WHERE user_id = $1',
    [identity.userId]
  );
  assert.deepStrictEqual(oauthStateBefore.rows, [{ count: 0 }], 'browser flow begins with no OAuth state');

  await context.addInitScript(() => {
    const evidence = window.__jobberUnavailableRatification = {
      toastMessages: [],
      statusTexts: [],
      buttonTexts: [],
    };
    function appendUnique(target, value) {
      const normalized = String(value || '').replace(/\s+/g, ' ').trim();
      if (normalized && target[target.length - 1] !== normalized) target.push(normalized);
    }
    function snapshot() {
      const toast = document.getElementById('toast');
      const status = document.getElementById('jobber-status');
      const button = document.getElementById('jobber-btn');
      if (toast) appendUnique(evidence.toastMessages, toast.textContent);
      if (status) appendUnique(evidence.statusTexts, status.textContent);
      if (button) appendUnique(evidence.buttonTexts, button.textContent);
    }
    new MutationObserver(snapshot).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    document.addEventListener('DOMContentLoaded', snapshot);
  });

  await context.route('**/*', async route => {
    const destination = new URL(route.request().url());
    if (['http:', 'https:'].includes(destination.protocol) && destination.origin !== baseUrl) {
      interceptedNonlocal.push({ phase, origin: destination.origin, pathname: destination.pathname });
      if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(destination.hostname)) {
        await route.fulfill({
          status: 200,
          contentType: destination.hostname === 'fonts.googleapis.com' ? 'text/css' : 'font/woff2',
          body: '',
        });
      } else {
        await route.abort('blockedbyclient');
      }
      return;
    }
    await route.continue();
  });

  context.on('request', browserRequest => {
    const destination = new URL(browserRequest.url());
    requestPhases.set(browserRequest, phase);
    requests.push({
      phase,
      method: browserRequest.method(),
      url: destination.toString(),
      origin: destination.origin,
      pathname: destination.pathname,
      local: destination.origin === baseUrl,
      navigation: browserRequest.isNavigationRequest(),
      authorization: browserRequest.headers().authorization || null,
    });
    totals.requests += 1;
  });
  context.on('response', response => {
    const destination = new URL(response.url());
    if (destination.pathname !== JOBBER_STATUS_PATH) return;
    const responsePhase = requestPhases.get(response.request()) || phase;
    const reading = response.json().then(body => {
      responses.push({ phase: responsePhase, status: response.status(), body });
      totals.jobberStatusResponses += 1;
    });
    responseReads.push(reading);
  });
  context.on('requestfailed', browserRequest => {
    requestFailures.push({
      url: browserRequest.url(),
      failure: browserRequest.failure() && browserRequest.failure().errorText,
    });
  });

  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.NorthStarAccountSession));
    const account = await page.evaluate(credentials => (
      window.NorthStarAccountSession.login(credentials.email, credentials.password)
    ), { email: identity.email, password: identity.password });
    assert.strictEqual(account.user.status, 'active', 'browser login reloads verified PostgreSQL authority');
    assert.strictEqual(account.onboarding.status, 'complete', 'browser login reloads completed onboarding');

    phase = 'forged_query';
    const forgedResponse = await page.goto(
      `${baseUrl}/dashboard/integrations?jobber=connected`,
      { waitUntil: 'domcontentloaded' }
    );
    assert.strictEqual(forgedResponse.status(), 200, 'real integrations page is served');
    await page.waitForFunction(() => (
      window.__jobberUnavailableRatification &&
      window.__jobberUnavailableRatification.toastMessages.includes('Jobber connection could not be confirmed.')
    ));
    await waitFor(
      () => responses.filter(entry => entry.phase === 'forged_query').length >= 2,
      `${engine} ${viewport.label} initial Jobber status projections`
    );
    await Promise.all(responseReads);

    const initialStatusRequests = requests.filter(entry => (
      entry.phase === 'forged_query' &&
      entry.method === 'GET' &&
      entry.pathname === JOBBER_STATUS_PATH
    ));
    assert.strictEqual(initialStatusRequests.length, 2, 'load and forged callback confirmation each read mounted status once');
    for (const entry of responses.filter(candidate => candidate.phase === 'forged_query')) {
      assert.strictEqual(entry.status, 200);
      assertUnavailableProjection(entry.body, 'forged query');
    }

    const forgedUi = await page.evaluate(() => ({
      origin: location.origin,
      pathname: location.pathname,
      search: location.search,
      status: document.getElementById('jobber-status').textContent.replace(/\s+/g, ' ').trim(),
      button: document.getElementById('jobber-btn').textContent.trim(),
      sessionClient: Boolean(window.NorthStarAccountSession),
      sessionClientFrozen: Object.isFrozen(window.NorthStarAccountSession),
      sessionScriptCount: document.querySelectorAll('script[src="/js/auth-session.js"]').length,
      evidence: window.__jobberUnavailableRatification,
    }));
    assert.strictEqual(forgedUi.origin, baseUrl, 'forged query stays on the disposable origin');
    assert.strictEqual(forgedUi.pathname, '/dashboard/integrations');
    assert.strictEqual(forgedUi.search, '', 'forged success query is removed');
    assert.strictEqual(forgedUi.status, 'Not connected');
    assert.strictEqual(forgedUi.button, 'Connect');
    assert.strictEqual(forgedUi.sessionClient, true, 'real account session client is loaded');
    assert.strictEqual(forgedUi.sessionClientFrozen, true, 'real account session client remains immutable');
    assert.strictEqual(forgedUi.sessionScriptCount, 1, 'one real account session client is mounted');
    assert.ok(forgedUi.evidence.toastMessages.includes('Jobber connection could not be confirmed.'));
    assert.ok(!forgedUi.evidence.toastMessages.some(message => /Jobber connected successfully/i.test(message)), 'forged query never presents success');
    assert.ok(!forgedUi.evidence.statusTexts.some(status => status === 'Connected'), 'forged query never presents connected status');
    assert.ok(!forgedUi.evidence.buttonTexts.some(button => button === 'Disconnect'), 'forged query never presents a disconnect action');

    phase = 'connect_click';
    const clickResponsePromise = page.waitForResponse(response => (
      new URL(response.url()).pathname === JOBBER_STATUS_PATH &&
      response.request().method() === 'GET'
    ));
    await page.locator('#jobber-btn').click();
    const clickResponse = await clickResponsePromise;
    assert.strictEqual(clickResponse.status(), 200, 'Connect checks mounted availability');
    assertUnavailableProjection(await clickResponse.json(), 'Connect');
    await page.waitForFunction(() => (
      window.__jobberUnavailableRatification.toastMessages.includes('Jobber integration is not currently available.')
    ));
    await page.locator('#toast.show').waitFor({ state: 'visible' });

    const clickUi = await page.evaluate(() => {
      const toast = document.getElementById('toast');
      const toastStyle = getComputedStyle(toast);
      return {
        origin: location.origin,
        pathname: location.pathname,
        search: location.search,
        status: document.getElementById('jobber-status').textContent.replace(/\s+/g, ' ').trim(),
        button: document.getElementById('jobber-btn').textContent.trim(),
        toast: toast.textContent.trim(),
        toastVisible: toastStyle.display !== 'none' && toastStyle.visibility !== 'hidden' &&
          toast.getClientRects().length > 0,
        readyState: document.readyState,
        evidence: window.__jobberUnavailableRatification,
      };
    });
    assert.deepStrictEqual(
      {
        origin: clickUi.origin,
        pathname: clickUi.pathname,
        search: clickUi.search,
        status: clickUi.status,
        button: clickUi.button,
      },
      {
        origin: baseUrl,
        pathname: '/dashboard/integrations',
        search: '',
        status: 'Not connected',
        button: 'Connect',
      },
      'Connect remains on the local unavailable UI'
    );
    assert.strictEqual(clickUi.toast, 'Jobber integration is not currently available.');
    assert.strictEqual(clickUi.toastVisible, true, 'unavailable message is visibly rendered');
    assert.ok(['interactive', 'complete'].includes(clickUi.readyState), 'page remains operational');
    assert.ok(!clickUi.evidence.toastMessages.some(message => /Jobber connected successfully/i.test(message)));
    assert.ok(!clickUi.evidence.statusTexts.some(status => status === 'Connected'));
    assert.ok(!clickUi.evidence.buttonTexts.some(button => button === 'Disconnect'));

    const connectStatusCount = () => requests.filter(entry => (
      entry.phase === 'connect_click' &&
      entry.method === 'GET' &&
      entry.pathname === JOBBER_STATUS_PATH
    )).length;
    assert.strictEqual(connectStatusCount(), 1, 'Connect performs one bounded availability read');
    await page.waitForTimeout(500);
    assert.strictEqual(connectStatusCount(), 1, 'Connect does not enter an availability retry loop');

    const clickRequests = requests.filter(entry => entry.phase === 'connect_click');
    assert.strictEqual(clickRequests.some(entry => entry.pathname === JOBBER_AUTH_PATH), false, 'Connect never navigates to the OAuth start route');
    assert.strictEqual(clickRequests.some(entry => !entry.local), false, 'Connect produces no nonlocal destination');
    assert.strictEqual(
      clickRequests.some(entry => entry.navigation && entry.pathname !== '/dashboard/integrations'),
      false,
      'Connect produces no navigation away from the local page'
    );
    assert.strictEqual(page.isClosed(), false, 'Connect does not crash or close the page');
    assert.deepStrictEqual(
      requests.filter(entry => (
        ['forged_query', 'connect_click'].includes(entry.phase) &&
        !['GET', 'HEAD', 'OPTIONS'].includes(entry.method)
      )),
      [],
      'forged load and Connect perform no browser mutation'
    );

    await waitFor(
      () => responses.filter(entry => entry.phase === 'connect_click').length === 1,
      `${engine} ${viewport.label} Connect status projection`
    );
    await Promise.all(responseReads);
    const clickProjections = responses.filter(entry => entry.phase === 'connect_click');
    assert.strictEqual(clickProjections.length, 1, 'Connect receives one mounted status response');
    assertUnavailableProjection(clickProjections[0].body, 'Connect response');

    const providerDestinations = requests.filter(entry => /(?:^|\.)getjobber\.com$/i.test(new URL(entry.url).hostname));
    assert.deepStrictEqual(providerDestinations, [], 'browser never targets a Jobber provider destination');
    assert.ok(
      requests.filter(entry => !entry.local).every(entry => (
        ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(entry.url).hostname)
      )),
      'the only nonlocal page assets are locally fulfilled font requests'
    );
    assert.ok(requests.every(entry => entry.authorization === null), 'browser sends no Authorization header');
    assert.deepStrictEqual(requestFailures, [], 'browser has no failed requests');
    assert.deepStrictEqual(pageErrors, [], 'browser has no uncaught page errors');
    assert.deepStrictEqual(consoleErrors, [], 'browser has no console errors');
    const oauthStateAfter = await pool.query(
      'SELECT count(*)::int AS count FROM oauth_authorization_states WHERE user_id = $1',
      [identity.userId]
    );
    assert.deepStrictEqual(oauthStateAfter.rows, oauthStateBefore.rows, 'browser unavailable flow creates no OAuth state');

    return {
      status: clickUi.status,
      button: clickUi.button,
      forgedQueryRemoved: forgedUi.search === '',
      forgedSuccessPresented: false,
      unavailableMessage: clickUi.toast,
      initialStatusRequests: initialStatusRequests.length,
      connectStatusRequests: connectStatusCount(),
      authNavigations: clickRequests.filter(entry => entry.pathname === JOBBER_AUTH_PATH).length,
      providerDestinations: providerDestinations.map(entry => entry.url),
      nonlocalDestinations: Array.from(new Set(
        requests.filter(entry => !entry.local).map(entry => new URL(entry.url).origin)
      )).sort(),
      interceptedNonlocalDestinations: Array.from(new Set(
        interceptedNonlocal.map(entry => entry.origin)
      )).sort(),
      oauthStateRowsBefore: oauthStateBefore.rows[0].count,
      oauthStateRowsAfter: oauthStateAfter.rows[0].count,
      localRequestInventory: requestInventory(requests.filter(entry => entry.local)),
      pageErrors,
      consoleErrors,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  if (!process.env.M19_PG_ADMIN_URL) {
    throw new Error('Disposable PostgreSQL 18 identity is required');
  }
  const browserSelection = String(process.env.NORTHSTAR_BROWSER || 'both').toLowerCase();
  assert.ok(
    ['chrome', 'webkit', 'both'].includes(browserSelection),
    'NORTHSTAR_BROWSER must be chrome, webkit, or both'
  );
  const selectedEngines = browserSelection === 'both'
    ? ['chrome', 'webkit']
    : [browserSelection];
  const runtimeSpecs = selectedEngines.map(engine => ({
    engine,
    label: engine === 'chrome' ? 'Chrome' : 'Playwright WebKit',
    runtime: resolveBrowserRuntime(engine),
  }));

  const allocation = await createSuiteDatabase('jobber-browser');
  const originalEnvironment = {};
  for (const key of [
    'DATABASE_URL',
    'AUTH_ACCESS_SECRET',
    'NODE_ENV',
    'JOBBER_CLIENT_ID',
    'JOBBER_CLIENT_SECRET',
    'JOBBER_INTEGRATION_ENABLED',
    'JOBBER_OAUTH_ENABLED',
    'JOBBER_TOKEN_PERSISTENCE_ENABLED',
  ]) {
    originalEnvironment[key] = process.env[key];
  }
  process.env.DATABASE_URL = allocation.connectionString;
  process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
  process.env.NODE_ENV = 'test';
  process.env.JOBBER_CLIENT_ID = 'disposable-browser-client';
  process.env.JOBBER_CLIENT_SECRET = 'disposable-browser-secret';
  process.env.JOBBER_INTEGRATION_ENABLED = 'true';
  process.env.JOBBER_OAUTH_ENABLED = 'true';
  process.env.JOBBER_TOKEN_PERSISTENCE_ENABLED = 'true';

  let db;
  let server;
  const browsers = [];
  const totals = { requests: 0, jobberStatusResponses: 0 };
  const engineEvidence = {};
  try {
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL initializes');
    const pool = db.getPool();
    const postgres = await pool.query(
      `SELECT current_setting('server_version') AS server_version,
              current_database() AS database,
              current_setting('port')::int AS port,
              current_setting('listen_addresses') AS listen_addresses,
              host(inet_server_addr()) AS server_address`
    );
    assert.match(postgres.rows[0].server_version, /^18\./, 'physical PostgreSQL 18 is required');
    assert.strictEqual(postgres.rows[0].database, allocation.databaseName);
    assert.notStrictEqual(postgres.rows[0].port, 5432);
    assert.strictEqual(postgres.rows[0].listen_addresses, '127.0.0.1');
    assert.strictEqual(postgres.rows[0].server_address, '127.0.0.1');

    const app = require('../helpers/account-test-app').createDisposableAccountApp();
    app.get('/dashboard/integrations', (_req, res) => {
      res.sendFile(path.join(ROOT, 'public', 'dashboard', 'integrations.html'));
    });
    const identity = await provisionMountedIdentity(app, pool);

    const stateBefore = await pool.query(
      'SELECT count(*)::int AS count FROM oauth_authorization_states WHERE auth_session_id = $1',
      [identity.sessionId]
    );
    assert.deepStrictEqual(stateBefore.rows, [{ count: 0 }], 'direct unavailable flow begins with no OAuth state');
    const directStatus = await request(app)
      .get(JOBBER_STATUS_PATH)
      .set('Cookie', identity.cookie);
    assert.strictEqual(directStatus.status, 200);
    assert.strictEqual(directStatus.headers.location, undefined);
    assertUnavailableProjection(directStatus.body, 'direct mounted status');

    const directStart = await request(app)
      .get(JOBBER_AUTH_PATH)
      .set('Cookie', identity.cookie);
    const directCallback = await request(app)
      .get(JOBBER_CALLBACK_PATH)
      .set('Cookie', identity.cookie)
      .query({
        code: `forged-${crypto.randomUUID()}`,
        state: crypto.randomBytes(32).toString('base64url'),
      });
    assertUnavailableBoundary(directStart, 'direct mounted OAuth start');
    assertUnavailableBoundary(directCallback, 'direct mounted OAuth callback');
    const stateAfter = await pool.query(
      'SELECT count(*)::int AS count FROM oauth_authorization_states WHERE auth_session_id = $1',
      [identity.sessionId]
    );
    assert.deepStrictEqual(stateAfter.rows, stateBefore.rows, 'unavailable boundaries create no OAuth state');

    server = await listen(app);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    for (const spec of runtimeSpecs) {
      const browser = await spec.runtime.browserType.launch({
        executablePath: spec.runtime.executablePath,
        headless: true,
      });
      browsers.push(browser);
      engineEvidence[spec.engine] = { label: spec.label, viewports: {} };
      for (const viewport of VIEWPORTS) {
        engineEvidence[spec.engine].viewports[viewport.label] = await exerciseViewport(
          browser,
          spec.engine,
          viewport,
          pool,
          baseUrl,
          identity,
          totals
        );
      }
    }

    console.log('JOBBER_UNAVAILABLE_BROWSER_EVIDENCE ' + JSON.stringify({
      selected: selectedEngines,
      postgres: {
        serverVersion: postgres.rows[0].server_version,
        port: postgres.rows[0].port,
        listenAddresses: postgres.rows[0].listen_addresses,
        serverAddress: postgres.rows[0].server_address,
      },
      directMounted: {
        status: directStatus.status,
        available: directStatus.body.available,
        startStatus: directStart.status,
        startLocation: directStart.headers.location || null,
        callbackStatus: directCallback.status,
        callbackLocation: directCallback.headers.location || null,
        oauthStateRowsBefore: stateBefore.rows[0].count,
        oauthStateRowsAfter: stateAfter.rows[0].count,
      },
      engines: engineEvidence,
      totals,
    }));
  } finally {
    for (const browser of browsers.reverse()) await browser.close().catch(() => {});
    await closeServer(server).catch(() => {});
    if (db) await db.close().catch(() => {});
    await allocation.cleanup();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
