'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const ORG_A = '6d100000-0000-4000-8000-000000000001';
const ORG_B = '6d100000-0000-4000-8000-000000000002';
const OWNER_A = '6d200000-0000-4000-8000-000000000001';
const ADMIN_A = '6d200000-0000-4000-8000-000000000002';
const MEMBER_A = '6d200000-0000-4000-8000-000000000003';
const VIEWER_A = '6d200000-0000-4000-8000-000000000004';
const OWNER_B = '6d200000-0000-4000-8000-000000000005';
const ROLES = Object.freeze([
  ['owner', OWNER_A], ['admin', ADMIN_A], ['member', MEMBER_A], ['viewer', VIEWER_A],
]);
const PROVIDERS = Object.freeze(['google_maps', 'apple_maps', 'waze']);
const HOSTILE = '<img src=x onerror="window.__mapPreferenceXss++"><svg onload="window.__mapPreferenceXss++">';
const CFT_VERSION = '150.0.7871.129';
const CFT_SHA256 = 'fb14772807d9b4a18d87336fb112fd96fb05b2c80410aab78f74c7030751880e';
const MAP_CATALOGUE_DESCRIPTION =
  'Canonical provider preferences are managed in the Map launch preferences panel below; ' +
  'provider connection and destination-launch/navigation actions are not included.';
const MAP_CATALOGUE_BASIS =
  'Connection catalogue only; canonical provider preferences are managed below; ' +
  'destination-launch/navigation actions are deferred';

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

function attachPage(page, ledger, label) {
  page.on('pageerror', error => ledger.pageErrors.push(label + ': ' + error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (/status of (409 \(Conflict\)|503 \(Service Unavailable\))/.test(message.text())) {
      ledger.expectedConsole.push(label + ': ' + message.text());
      return;
    }
    ledger.consoleErrors.push(label + ': ' + message.text());
  });
}

async function createContext(browser, origin, session, spec, ledger) {
  const context = await browser.newContext({ viewport: spec.viewport, colorScheme: spec.theme });
  await context.addInitScript(theme => {
    window.__mapPreferenceXss = 0;
    localStorage.setItem('northstar-theme', theme);
  }, spec.theme);
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('**/*', route => {
    const browserRequest = route.request();
    const url = new URL(browserRequest.url());
    if (url.origin === origin) return route.continue();
    ledger.external.push({ label: spec.label, method: browserRequest.method(), url: browserRequest.url() });
    return route.abort('blockedbyclient');
  });
  context.on('request', browserRequest => {
    const url = new URL(browserRequest.url());
    ledger.requests.push({
      label: spec.label,
      method: browserRequest.method(),
      origin: url.origin,
      path: url.pathname,
      authorization: browserRequest.headers().authorization || null,
      csrf: browserRequest.headers()['x-csrf-token'] || null,
    });
  });
  return context;
}

async function openIntegrations(page, origin) {
  const response = await page.goto(origin + '/dashboard/integrations', {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  assert.strictEqual(response.status(), 200, 'Integrations route is mounted');
  await page.waitForFunction(() => {
    const catalogue = document.getElementById('integrationCatalogueRoot');
    const preferences = document.getElementById('mapPreferencesRoot');
    return catalogue && catalogue.dataset.state === 'ready' &&
      preferences && preferences.dataset.state === 'ready';
  });
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    preferences: document.getElementById('mapPreferencesRoot').scrollWidth -
      document.getElementById('mapPreferencesRoot').clientWidth,
    organization: document.getElementById('mapPreferencesOrganization').scrollWidth -
      document.getElementById('mapPreferencesOrganization').clientWidth,
    user: document.getElementById('mapPreferencesUser').scrollWidth -
      document.getElementById('mapPreferencesUser').clientWidth,
  }));
  for (const [surface, pixels] of Object.entries(overflow)) {
    assert.ok(pixels <= 1, `${label} ${surface} horizontal overflow: ${pixels}`);
  }
}

async function assertReadySurface(page, spec) {
  const result = await page.evaluate(() => {
    const root = document.getElementById('mapPreferencesRoot');
    const heading = document.getElementById('mapPreferencesHeading');
    const status = document.getElementById('mapPreferencesStatus');
    const organization = document.getElementById('mapPreferencesOrganization');
    const user = document.getElementById('mapPreferencesUser');
    const catalogue = document.getElementById('integrationCatalogueRoot');
    const jobber = document.querySelector('[data-provider-key="jobber"]');
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      state: root.dataset.state,
      busy: root.getAttribute('aria-busy'),
      heading: { text: heading.textContent.trim(), tabIndex: heading.tabIndex },
      status: {
        role: status.getAttribute('role'), live: status.getAttribute('aria-live'),
        atomic: status.getAttribute('aria-atomic'), text: status.textContent.trim(),
      },
      labels: Array.from(root.querySelectorAll('.map-provider-name')).map(node => node.textContent.trim()),
      glyphs: Array.from(root.querySelectorAll('.map-provider-glyph')).map(node => ({
        text: node.textContent, hidden: node.getAttribute('aria-hidden'),
      })),
      organizationLabel: organization.getAttribute('aria-labelledby'),
      userLabel: user.getAttribute('aria-labelledby'),
      catalogue: {
        state: catalogue.dataset.state,
        categories: document.querySelectorAll('#integrationCategoryList > li').length,
        providers: document.querySelectorAll('#integrationCategoryList [data-provider-key]').length,
      },
      jobber: jobber ? {
        status: jobber.querySelector('.integration-status').textContent.trim(),
        buttons: jobber.querySelectorAll('button,a').length,
        text: jobber.textContent,
      } : null,
      mapCatalogue: ['google_maps', 'apple_maps', 'waze'].map(function(key) {
        const card = document.querySelector('[data-provider-key="' + key + '"]');
        const details = Array.from(card.querySelectorAll('dt,dd')).map(node => node.textContent.trim());
        const basisIndex = details.indexOf('Status basis');
        return {
          key,
          description: card.querySelector('.integration-card-description').textContent.trim(),
          status: card.querySelector('.integration-status').textContent.trim(),
          basis: details[basisIndex + 1],
          actions: card.querySelectorAll('button,a').length,
        };
      }),
      unsafe: root.querySelectorAll('img,svg,script,a[href]').length,
      urls: Array.from(root.querySelectorAll('[href]')).map(node => node.getAttribute('href')),
      xss: window.__mapPreferenceXss,
    };
  });
  assert.strictEqual(result.theme, spec.theme);
  assert.strictEqual(result.state, 'ready');
  assert.strictEqual(result.busy, 'false');
  assert.deepStrictEqual(result.heading, { text: 'Map launch preferences', tabIndex: -1 });
  assert.deepStrictEqual(result.status, {
    role: 'status', live: 'polite', atomic: 'true', text: 'Canonical map preferences loaded.',
  });
  assert.deepStrictEqual(result.labels, [
    '↗Google Maps', '↗Apple Maps', '↗Waze', '↗Google Maps', '↗Apple Maps', '↗Waze',
  ]);
  assert.ok(result.glyphs.every(glyph => glyph.text === '↗' && glyph.hidden === 'true'));
  assert.strictEqual(result.organizationLabel, 'organizationMapPreferencesHeading');
  assert.strictEqual(result.userLabel, 'userMapPreferencesHeading');
  assert.deepStrictEqual(result.catalogue, { state: 'ready', categories: 7, providers: 26 });
  assert.ok(result.jobber);
  assert.strictEqual(result.jobber.status, 'Coming soon');
  assert.strictEqual(result.jobber.buttons, 0);
  assert.match(result.jobber.text, /Source-disabled|source-disabled/i);
  assert.deepStrictEqual(result.mapCatalogue, PROVIDERS.map(key => ({
    key,
    description: MAP_CATALOGUE_DESCRIPTION,
    status: 'Coming soon',
    basis: MAP_CATALOGUE_BASIS,
    actions: 0,
  })));
  assert.ok(result.mapCatalogue.every(provider =>
    !/preference(?:s)?(?: and launcher logic)? (?:are )?(?:absent|not included)/i.test(provider.description)));
  assert.strictEqual(result.unsafe, 0);
  assert.deepStrictEqual(result.urls, []);
  assert.strictEqual(result.xss, 0);

  const canUpdateOrganization = spec.role === 'owner' || spec.role === 'admin';
  assert.strictEqual(await page.locator('#saveOrganizationMapPreferences').isVisible(), canUpdateOrganization);
  assert.strictEqual(await page.locator('#organization-google_maps-enabled').isDisabled(), !canUpdateOrganization);
  assert.strictEqual(await page.locator('#saveUserMapPreferences').isVisible(), true);
  assert.strictEqual(await page.locator('#user-google_maps-enabled').isEnabled(), true);
  assert.strictEqual(await page.locator('#inheritMapPreferences').isDisabled(), true);
  assert.match(await page.locator('#userMapPreferencesCopy').textContent(), /inherit the company default/i);
  assert.match(await page.locator('#organizationMapPreferencesCopy').textContent(),
    canUpdateOrganization ? /You can update/ : /read-only for your role/);

  const summary = page.locator('#integrationCategoryList details summary').first();
  await summary.focus();
  await page.keyboard.press('Enter');
  assert.strictEqual(await summary.evaluate(node => node.parentElement.open), true);
  await page.keyboard.press('Enter');
  assert.strictEqual(await summary.evaluate(node => node.parentElement.open), false);
  await page.evaluate(() => {
    document.getElementById('user-google_maps-visible').__phase6dStableNode = true;
    return window.NorthStarMapPreferences.reload();
  });
  await page.waitForFunction(() => document.getElementById('mapPreferencesRoot').dataset.state === 'ready');
  assert.strictEqual(await page.evaluate(() =>
    document.getElementById('user-google_maps-visible').__phase6dStableNode === true), true);
  await assertNoOverflow(page, spec.label);
}

async function saveSelfOverride(page, origin, role) {
  await page.locator('#user-google_maps-enabled').uncheck();
  await page.locator('#user-apple_maps-default').check();
  await page.locator('#user-apple_maps-visible').focus();
  await page.keyboard.press('Space');
  const write = page.waitForResponse(response =>
    response.url() === origin + '/api/account/map-preferences/me' && response.request().method() === 'PUT');
  await page.locator('#saveUserMapPreferences').focus();
  await page.keyboard.press('Enter');
  const response = await write;
  assert.strictEqual(response.status(), 200);
  const body = await response.json();
  assert.strictEqual(body.changed, true);
  assert.deepStrictEqual(response.request().postDataJSON(), {
    expectedVersion: 0,
    mode: 'override',
    preferences: {
      providers: {
        google_maps: { enabled: false, visible: true },
        apple_maps: { enabled: true, visible: false },
        waze: { enabled: true, visible: true },
      },
      defaultProvider: 'apple_maps',
    },
  });
  assert.ok(response.request().headers()['x-csrf-token']);
  await page.waitForFunction(() => document.getElementById('mapPreferencesStatus').textContent.includes('override saved'));
  const toast = page.locator('.toast-notification').last();
  assert.strictEqual(await toast.getAttribute('role'), 'status');
  assert.strictEqual(await toast.getAttribute('aria-live'), 'polite');
  assert.strictEqual(await toast.locator('.toast-body').textContent(), 'Your map preference override saved.');
  assert.strictEqual(await toast.locator('.toast-close').getAttribute('aria-label'), 'Close notification');
  await toast.locator('.toast-close').click();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    document.getElementById('mapPreferencesRoot') && document.getElementById('mapPreferencesRoot').dataset.state === 'ready');
  assert.strictEqual(await page.locator('#user-google_maps-enabled').isChecked(), false);
  assert.strictEqual(await page.locator('#user-apple_maps-visible').isChecked(), false);
  assert.strictEqual(await page.locator('#user-apple_maps-default').isChecked(), true);
  assert.match(await page.locator('#userMapPreferencesCopy').textContent(), /personal override is effective/i);

  const inheritWrite = page.waitForResponse(responseValue =>
    responseValue.url() === origin + '/api/account/map-preferences/me' &&
    responseValue.request().method() === 'PUT');
  await page.locator('#inheritMapPreferences').focus();
  await page.keyboard.press('Enter');
  assert.strictEqual((await inheritWrite).status(), 200);
  await page.waitForFunction(() =>
    document.getElementById('mapPreferencesStatus').textContent.includes('inherits the company default'));
  assert.strictEqual(await page.locator('#inheritMapPreferences').isDisabled(), true);
  assert.match(await page.locator('#mapPreferencesStatus').textContent(), /inherits the company default/i);
  assert.strictEqual(await page.evaluate(() => window.__mapPreferenceXss), 0, role + ' XSS counter');
}

function documentFor(defaultProvider) {
  return {
    providers: {
      google_maps: { enabled: defaultProvider === 'google_maps', visible: true },
      apple_maps: { enabled: true, visible: true },
      waze: { enabled: true, visible: true },
    },
    defaultProvider,
  };
}

async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  const { browserType, executablePath } = resolveBrowserRuntime(selected);
  if (selected === 'chrome') {
    assert.strictEqual(
      crypto.createHash('sha256').update(fs.readFileSync(executablePath)).digest('hex'),
      CFT_SHA256,
      'official CfT executable hash'
    );
  }
  const originalEnvironment = new Map();
  for (const name of [
    'DATABASE_URL', 'AUTH_ACCESS_SECRET', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
    'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
  ]) originalEnvironment.set(name, process.env[name]);

  const suiteDatabase = await createSuiteDatabase('m20-phase6d-map-browser-' + selected);
  const ledger = {
    requests: [], external: [], pageErrors: [], consoleErrors: [], expectedConsole: [], providerActions: [],
  };
  let db;
  let server;
  let browser;
  let originalFetch;
  let originalHttps;
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
      'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
    ]) delete process.env[name];
    originalFetch = global.fetch;
    global.fetch = function () {
      ledger.providerActions.push('fetch');
      throw new Error('Provider fetch boundary reached during Phase 6D browser run.');
    };
    originalHttps = https.request;
    https.request = function () {
      ledger.providerActions.push('https.request');
      throw new Error('Provider HTTPS boundary reached during Phase 6D browser run.');
    };

    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const pool = db.getPool();
    const databaseIdentity = (await pool.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums`
    )).rows[0];
    assert.deepStrictEqual(databaseIdentity, { version: '18.4', timezone: 'UTC', checksums: 'on' });
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Phase 6D map browser A','phase6d-map-browser-a@example.test'),
       ($2,'Phase 6D map browser B','phase6d-map-browser-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [role, userId, organizationId] of [
      ...ROLES.map(([role, userId]) => [role, userId, ORG_A]),
      ['owner', OWNER_B, ORG_B],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role + ' map user', userId + '@phase6d-map-browser.test', role]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: OWNER_A,
      expectedVersion: null,
      profile: canonicalFenceProfile({ companyName: 'Phase 6D Map Browser A' }),
    });
    await putBusinessProfile(pool, {
      organizationId: ORG_B,
      userId: OWNER_B,
      expectedVersion: null,
      profile: canonicalFenceProfile({ companyName: 'Phase 6D Map Browser B' }),
    });
    const sessions = {};
    for (const [role, userId] of ROLES) {
      sessions[role] = await provisionDurableSession(pool, { userId, organizationId: ORG_A, role });
    }
    sessions.otherOwner = await provisionDurableSession(pool, {
      userId: OWNER_B, organizationId: ORG_B, role: 'owner',
    });

    const { app } = require('../../src/server');
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await browserType.launch({ headless: true, executablePath });
    assert.strictEqual(browser.version(), selected === 'chrome' ? CFT_VERSION : '26.5');

    const viewports = [
      ['desktop', { width: 1440, height: 900 }],
      ['mobile', { width: 390, height: 844 }],
    ];
    for (const [role] of ROLES) {
      for (const [viewportName, viewport] of viewports) {
        for (const theme of ['light', 'dark']) {
          const spec = { role, viewport, theme, label: [role, viewportName, theme].join('-') };
          const context = await createContext(browser, origin, sessions[role], spec, ledger);
          const page = await context.newPage();
          attachPage(page, ledger, spec.label);
          await openIntegrations(page, origin);
          await assertReadySurface(page, spec);
          await context.close();
        }
      }
    }

    for (const [role] of ROLES) {
      const spec = {
        role, viewport: { width: 1280, height: 800 }, theme: role === 'member' ? 'dark' : 'light',
        label: role + '-self-write',
      };
      const context = await createContext(browser, origin, sessions[role], spec, ledger);
      const page = await context.newPage();
      attachPage(page, ledger, spec.label);
      await openIntegrations(page, origin);
      await saveSelfOverride(page, origin, role);
      await assertNoOverflow(page, spec.label);
      await context.close();
    }
    const userRows = (await pool.query(
      `SELECT user_id, mode, google_maps_enabled, google_maps_visible,
              apple_maps_enabled, apple_maps_visible, waze_enabled, waze_visible,
              default_provider, version, updated_by_user_id
         FROM user_map_preferences WHERE organization_id = $1 ORDER BY user_id`,
      [ORG_A]
    )).rows;
    assert.deepStrictEqual(userRows, ROLES.map(([_role, userId]) => ({
      user_id: userId,
      mode: 'inherit',
      google_maps_enabled: null,
      google_maps_visible: null,
      apple_maps_enabled: null,
      apple_maps_visible: null,
      waze_enabled: null,
      waze_visible: null,
      default_provider: null,
      version: '2',
      updated_by_user_id: userId,
    })));

    const ownerSpec = {
      role: 'owner', viewport: { width: 1440, height: 900 }, theme: 'light', label: 'owner-org-write',
    };
    const ownerContext = await createContext(browser, origin, sessions.owner, ownerSpec, ledger);
    const ownerPage = await ownerContext.newPage();
    attachPage(ownerPage, ledger, ownerSpec.label);
    await openIntegrations(ownerPage, origin);
    await ownerPage.locator('#organization-google_maps-enabled').uncheck();
    assert.strictEqual(await ownerPage.locator('#organization-apple_maps-default').isChecked(), true);
    await ownerPage.locator('#organization-apple_maps-visible').uncheck();
    const organizationWrite = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/account/map-preferences/organization' &&
      response.request().method() === 'PUT');
    await ownerPage.locator('#saveOrganizationMapPreferences').focus();
    await ownerPage.keyboard.press('Enter');
    assert.strictEqual((await organizationWrite).status(), 200);
    await ownerPage.waitForFunction(() =>
      document.getElementById('mapPreferencesStatus').textContent === 'Company map default saved.');
    assert.strictEqual(await ownerPage.locator('.toast-notification').last().getAttribute('role'), 'status');
    await ownerPage.locator('.toast-notification .toast-close').last().click();
    const organizationRaw = (await pool.query(
      `SELECT google_maps_enabled, google_maps_visible,
              apple_maps_enabled, apple_maps_visible, waze_enabled, waze_visible,
              default_provider, version, authority_source, updated_by_user_id
         FROM organization_map_preferences WHERE organization_id = $1`,
      [ORG_A]
    )).rows[0];
    assert.deepStrictEqual(organizationRaw, {
      google_maps_enabled: false, google_maps_visible: true,
      apple_maps_enabled: true, apple_maps_visible: false,
      waze_enabled: true, waze_visible: true,
      default_provider: 'apple_maps', version: '2', authority_source: 'user', updated_by_user_id: OWNER_A,
    });

    await ownerPage.locator('#organization-waze-visible').uncheck();
    const competing = await request(app).put('/api/account/map-preferences/organization')
      .set(sessions.admin.headers)
      .send({ expectedVersion: 2, preferences: documentFor('waze') });
    assert.strictEqual(competing.status, 200);
    const staleWrite = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/account/map-preferences/organization' &&
      response.request().method() === 'PUT');
    await ownerPage.locator('#saveOrganizationMapPreferences').click();
    assert.strictEqual((await staleWrite).status(), 409);
    await ownerPage.waitForFunction(() => /changed; reload/i.test(
      document.getElementById('mapPreferencesStatus').textContent));
    assert.strictEqual(await ownerPage.locator('#mapPreferencesStatus').getAttribute('role'), 'alert');
    assert.strictEqual(await ownerPage.locator('#mapPreferencesStatus').getAttribute('aria-live'), 'assertive');
    const errorToast = ownerPage.locator('.toast-notification').last();
    assert.strictEqual(await errorToast.getAttribute('role'), 'alert');
    assert.strictEqual(await errorToast.getAttribute('aria-live'), 'assertive');
    await errorToast.locator('.toast-close').click();
    await ownerPage.evaluate(() => window.NorthStarMapPreferences.reload());
    await ownerPage.waitForFunction(() =>
      document.getElementById('mapPreferencesRoot').dataset.state === 'ready' &&
      document.getElementById('organization-waze-default').checked);
    await assertNoOverflow(ownerPage, ownerSpec.label);
    await ownerContext.close();

    const loadingSpec = {
      role: 'viewer', viewport: { width: 390, height: 844 }, theme: 'dark', label: 'viewer-loading',
    };
    const loadingContext = await createContext(browser, origin, sessions.viewer, loadingSpec, ledger);
    let releaseLoading;
    const loadingGate = new Promise(resolve => { releaseLoading = resolve; });
    await loadingContext.route('**/api/account/map-preferences', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      await loadingGate;
      return route.continue();
    });
    const loadingPage = await loadingContext.newPage();
    attachPage(loadingPage, ledger, loadingSpec.label);
    await loadingPage.goto(origin + '/dashboard/integrations', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(await loadingPage.locator('#mapPreferencesRoot').getAttribute('data-state'), 'loading');
    assert.strictEqual(await loadingPage.locator('#mapPreferencesRoot').getAttribute('aria-busy'), 'true');
    assert.strictEqual(await loadingPage.locator('#mapPreferencesContent').isHidden(), true);
    releaseLoading();
    await loadingPage.waitForFunction(() => document.getElementById('mapPreferencesRoot').dataset.state === 'ready');
    await assertNoOverflow(loadingPage, loadingSpec.label);
    await loadingContext.close();

    const retrySpec = {
      role: 'owner', viewport: { width: 1440, height: 900 }, theme: 'dark', label: 'owner-error-retry',
    };
    const retryContext = await createContext(browser, origin, sessions.owner, retrySpec, ledger);
    let mapFailure = true;
    await retryContext.route('**/api/account/map-preferences', route => {
      if (route.request().method() !== 'GET' || !mapFailure) return route.continue();
      mapFailure = false;
      return route.fulfill({
        status: 503, contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'TEST_UNAVAILABLE', message: 'Unavailable' } }),
      });
    });
    const retryPage = await retryContext.newPage();
    attachPage(retryPage, ledger, retrySpec.label);
    await retryPage.goto(origin + '/dashboard/integrations', { waitUntil: 'domcontentloaded' });
    await retryPage.waitForFunction(() => document.getElementById('mapPreferencesRoot').dataset.state === 'error');
    assert.strictEqual(await retryPage.locator('#mapPreferencesError').getAttribute('role'), 'alert');
    await retryPage.locator('#mapPreferencesRetry').focus();
    await retryPage.keyboard.press('Enter');
    await retryPage.waitForFunction(() =>
      document.getElementById('mapPreferencesRoot').dataset.state === 'ready' &&
      document.activeElement.id === 'mapPreferencesHeading');
    await retryContext.close();

    const catalogueSpec = {
      role: 'admin', viewport: { width: 390, height: 844 }, theme: 'light', label: 'catalogue-focus-retained',
    };
    const catalogueContext = await createContext(browser, origin, sessions.admin, catalogueSpec, ledger);
    let catalogueFailure = true;
    await catalogueContext.route('**/api/v1/integrations/catalogue', route => {
      if (route.request().method() !== 'GET' || !catalogueFailure) return route.continue();
      catalogueFailure = false;
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    });
    const cataloguePage = await catalogueContext.newPage();
    attachPage(cataloguePage, ledger, catalogueSpec.label);
    await cataloguePage.goto(origin + '/dashboard/integrations', { waitUntil: 'domcontentloaded' });
    await cataloguePage.waitForFunction(() =>
      document.getElementById('integrationCatalogueRoot').dataset.state === 'error' &&
      document.getElementById('mapPreferencesRoot').dataset.state === 'ready');
    await cataloguePage.locator('#retryIntegrationsBtn').focus();
    await cataloguePage.keyboard.press('Enter');
    await cataloguePage.waitForFunction(() =>
      document.getElementById('integrationCatalogueRoot').dataset.state === 'ready' &&
      document.activeElement.id === 'integrationCatalogueHeading');
    await assertNoOverflow(cataloguePage, catalogueSpec.label);
    await catalogueContext.close();

    const poisonResponse = await request(app).get('/api/account/map-preferences').set(sessions.owner.headers);
    assert.strictEqual(poisonResponse.status, 200);
    const poisonBody = JSON.parse(JSON.stringify(poisonResponse.body));
    poisonBody.data.providers[0].name = HOSTILE;
    const poisonSpec = {
      role: 'owner', viewport: { width: 390, height: 844 }, theme: 'dark', label: 'owner-poison-fail-closed',
    };
    const poisonContext = await createContext(browser, origin, sessions.owner, poisonSpec, ledger);
    await poisonContext.route('**/api/account/map-preferences', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(poisonBody),
    }));
    const poisonPage = await poisonContext.newPage();
    attachPage(poisonPage, ledger, poisonSpec.label);
    await poisonPage.goto(origin + '/dashboard/integrations', { waitUntil: 'domcontentloaded' });
    await poisonPage.waitForFunction(() => document.getElementById('mapPreferencesRoot').dataset.state === 'error');
    assert.strictEqual((await poisonPage.locator('body').textContent()).includes(HOSTILE), false);
    assert.strictEqual(await poisonPage.locator('#mapPreferencesRoot img,#mapPreferencesRoot svg,#mapPreferencesRoot script').count(), 0);
    assert.strictEqual(await poisonPage.evaluate(() => window.__mapPreferenceXss), 0);
    await assertNoOverflow(poisonPage, poisonSpec.label);
    await poisonContext.close();

    const tenantB = (await pool.query(
      `SELECT default_provider, version, authority_source, updated_by_user_id
         FROM organization_map_preferences WHERE organization_id = $1`,
      [ORG_B]
    )).rows;
    assert.deepStrictEqual(tenantB, [{
      default_provider: 'google_maps', version: '1', authority_source: 'system_default', updated_by_user_id: null,
    }]);
    assert.deepStrictEqual(ledger.external, [], 'browser external requests remain zero');
    assert.deepStrictEqual(ledger.providerActions, [], 'server provider actions remain zero');
    assert.deepStrictEqual(ledger.pageErrors, [], 'page errors remain zero');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'unexpected console errors remain zero');
    assert.ok(ledger.expectedConsole.length >= 3, 'expected 409 and 503 browser evidence retained');
    assert.ok(ledger.requests.every(entry => entry.authorization === null), 'browser sends no Authorization headers');
    const unsafeWrites = ledger.requests.filter(entry =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method) &&
      !['/api/account/map-preferences/me', '/api/account/map-preferences/organization'].includes(entry.path));
    assert.deepStrictEqual(unsafeWrites, [], 'only intentional same-origin preference PUTs occur');
    const preferenceWrites = ledger.requests.filter(entry => entry.method === 'PUT');
    assert.strictEqual(preferenceWrites.length, 10, 'self, inherit, organization, and stale browser writes are mounted');
    assert.ok(preferenceWrites.every(entry => entry.origin === origin && entry.csrf), 'every browser write is same-origin CSRF protected');
    assert.strictEqual(ledger.requests.filter(entry => entry.path.startsWith('/api/integrations/jobber')).length, 0);
    assert.strictEqual(ledger.requests.filter(entry => /maps|waze/i.test(entry.origin) && entry.origin !== origin).length, 0);

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'official Chrome-for-Testing' : 'actual Playwright WebKit',
      version: browser.version(),
      executableSha256: selected === 'chrome' ? CFT_SHA256 : null,
      physicalSafari: false,
      database: suiteDatabase.databaseName,
      databaseIdentity,
      matrix: { roles: 4, viewports: 2, themes: 2, cases: 16 },
      lifecycle: [
        'loading', 'ready', 'save', 'inherit', 'no-op projection', 'stale', 'reload', 'rerender',
        'error', 'retry', 'poison fail-closed', 'catalogue focus retained',
      ],
      accessibility: ['headings', 'labels', 'keyboard', 'focus', 'polite status', 'assertive error', 'toast close'],
      rawPersistence: 'normalized PostgreSQL columns exact',
      providerRequests: 0,
      providerActions: 0,
      externalRequests: 0,
      unexpectedWrites: 0,
      jobberRequests: 0,
      xssExecutions: 0,
      overflow: 0,
      pageErrors: 0,
      consoleErrors: 0,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db && db.getPool()) await db.getPool().end();
    if (originalHttps) https.request = originalHttps;
    if (originalFetch === undefined) delete global.fetch;
    else global.fetch = originalFetch;
    await suiteDatabase.cleanup();
    for (const [name, value] of originalEnvironment.entries()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
