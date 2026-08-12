'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const ORG_A = '7d100000-0000-4000-8000-000000000001';
const ORG_B = '7d100000-0000-4000-8000-000000000002';
const ROLE_USERS = Object.freeze([
  Object.freeze({ role: 'owner', id: '7d200000-0000-4000-8000-000000000001' }),
  Object.freeze({ role: 'admin', id: '7d200000-0000-4000-8000-000000000002' }),
  Object.freeze({ role: 'member', id: '7d200000-0000-4000-8000-000000000003' }),
  Object.freeze({ role: 'viewer', id: '7d200000-0000-4000-8000-000000000004' }),
]);
const OWNER_B = '7d200000-0000-4000-8000-000000000005';
const ADDRESS = Object.freeze({
  line1: '100 Cedar Lane', city: 'Testville', state: 'NY', postalCode: '10001', country: 'US',
});
const DISPLAY_ADDRESS = '100 Cedar Lane, Testville, NY 10001, US';
const ENCODED_ADDRESS = '100%20Cedar%20Lane%2C%20Testville%2C%20NY%2010001%2C%20US';
const EXPECTED_URLS = Object.freeze({
  google_maps: `https://www.google.com/maps/dir/?api=1&destination=${ENCODED_ADDRESS}`,
  apple_maps: `https://maps.apple.com/?daddr=${ENCODED_ADDRESS}&dirflg=d`,
  waze: `https://waze.com/ul?q=${ENCODED_ADDRESS}&navigate=yes`,
});
const VERIFIED_COORDINATES = Object.freeze({ verified: true, latitude: 41.7658, longitude: -72.6734 });
const ENCODED_COORDINATES = '41.7658%2C-72.6734';
const EXPECTED_COORDINATE_URLS = Object.freeze({
  google_maps: `https://www.google.com/maps/dir/?api=1&destination=${ENCODED_COORDINATES}`,
  apple_maps: `https://maps.apple.com/?daddr=${ENCODED_COORDINATES}&dirflg=d`,
  waze: `https://waze.com/ul?q=${ENCODED_COORDINATES}&navigate=yes`,
});
const CFT_VERSION = '150.0.7871.129';
const CFT_SHA256 = 'fb14772807d9b4a18d87336fb112fd96fb05b2c80410aab78f74c7030751880e';
const WEBKIT_VERSION = '26.5';

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

function graphInput(organizationId, suffix, address) {
  return {
    tenantContext: { organizationId, trusted: true },
    idempotencyKey: `phase6e-browser-${suffix}`,
    source: 'lead', sourceVersion: 'm20-phase6e-browser-v1',
    external: {
      customerId: `phase6e-browser-${suffix}-customer`, callId: `phase6e-browser-${suffix}-call`,
      transcriptId: `phase6e-browser-${suffix}-transcript`, communicationId: `phase6e-browser-${suffix}-communication`,
      appointmentId: `phase6e-browser-${suffix}-appointment`,
    },
    customer: {
      name: `Phase 6E ${suffix.toUpperCase()} Customer`,
      phone: suffix === 'a' ? '+15555550801' : '+15555550802',
      email: `phase6e-browser-${suffix}@example.test`, address,
    },
    transcript: [
      { turnId: 'turn-1', speaker: 'customer', text: 'I need a new 100-foot cedar fence and the existing fence removed.' },
      { turnId: 'turn-2', speaker: 'customer', text: 'Include one walk gate and permits. Weekday mornings work best.' },
    ],
    facts: [
      { variable: 'linearFeet', normalizedValue: 100, evidenceText: '100-foot cedar fence', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'height', normalizedValue: 6, evidenceText: 'six-foot', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'material', normalizedValue: 'cedar', evidenceText: 'cedar fence', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'removalRequired', normalizedValue: true, evidenceText: 'existing fence removed', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'gates', normalizedValue: [{ type: 'walk' }], evidenceText: 'one walk gate', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
      { variable: 'permitsRequired', normalizedValue: true, evidenceText: 'permits', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
    ],
    service: {
      key: 'fence',
      scope: { jobType: 'replace', linearFeet: 100, height: 6, material: 'cedar', removalRequired: true, gates: [{ type: 'walk' }], permitsRequired: true },
    },
    appointmentPreference: { dayPart: 'morning', days: ['weekday'] },
    scheduledAppointment: { start: '2026-08-12T13:00:00.000Z', end: '2026-08-12T15:00:00.000Z', status: 'scheduled' },
    callDurationSeconds: 180,
  };
}

function preferenceDocument(defaultProvider = 'google_maps', states = {}) {
  function state(key) {
    return Object.assign({ enabled: true, visible: true }, states[key] || {});
  }
  return {
    providers: {
      google_maps: state('google_maps'), apple_maps: state('apple_maps'), waze: state('waze'),
    },
    defaultProvider,
  };
}

function preferenceBody(document, requestId = 'phase6e-browser-preference') {
  return {
    success: true,
    data: {
      authority: 'canonical_map_preferences_v1', contractVersion: 1,
      providers: [
        { key: 'google_maps', name: 'Google Maps' },
        { key: 'apple_maps', name: 'Apple Maps' },
        { key: 'waze', name: 'Waze' },
      ],
      organization: {
        version: 1, preferences: preferenceDocument(), source: 'system_default',
        updatedAt: '2026-08-11T12:00:00.000Z',
      },
      user: { version: 1, mode: 'override', hasStoredAuthority: true, preferences: document, updatedAt: '2026-08-11T12:01:00.000Z' },
      effective: {
        source: 'user_override', inheritsOrganization: false,
        organizationVersion: 1, userVersion: 1, preferences: document,
      },
      permissions: { canUpdateOrganization: false, canUpdateSelf: true },
    },
    requestId,
  };
}

function stableJson(value) {
  return JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item);
}

async function databaseDigest(pool) {
  const tables = {
    canonical_operations: 'organization_id, id', canonical_customers: 'organization_id, id',
    canonical_estimates: 'organization_id, id', canonical_appointments: 'organization_id, id',
    organization_map_preferences: 'organization_id', user_map_preferences: 'organization_id, user_id',
    organization_account_preferences: 'organization_id', notification_preferences: 'organization_id',
  };
  const result = {};
  for (const [table, order] of Object.entries(tables)) {
    const rows = (await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;
    result[table] = crypto.createHash('sha256').update(stableJson(rows), 'utf8').digest('hex');
  }
  return result;
}

function attachPage(page, ledger, label) {
  page.on('pageerror', error => ledger.pageErrors.push(`${label}: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') ledger.consoleErrors.push(`${label}: ${message.text()}`);
  });
}

async function createContext(browser, origin, session, spec, ledger) {
  const context = await browser.newContext({ viewport: spec.viewport, colorScheme: spec.theme });
  await context.addInitScript(theme => {
    localStorage.setItem('northstar-theme', theme);
    window.__phase6eOpenMode = 'success-null';
    window.__phase6eOpenCalls = [];
    window.__phase6eXss = 0;
    window.open = function(url, target, features) {
      window.__phase6eOpenCalls.push({ url, target, features });
      if (window.__phase6eOpenMode === 'throw') throw new Error('synchronous open failure');
      if (window.__phase6eOpenMode === 'success-proxy') {
        return new Proxy({}, { get() { throw new Error('opener access forbidden'); }, set() { throw new Error('opener access forbidden'); } });
      }
      return null;
    };
  }, spec.theme);
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('**/*', route => {
    const browserRequest = route.request();
    const url = new URL(browserRequest.url());
    if (url.origin === origin) return route.continue();
    ledger.externalRequests.push({ label: spec.label, method: browserRequest.method(), url: browserRequest.url() });
    return route.abort('blockedbyclient');
  });
  context.on('request', browserRequest => {
    const url = new URL(browserRequest.url());
    ledger.requests.push({ label: spec.label, method: browserRequest.method(), origin: url.origin, path: url.pathname });
  });
  return context;
}

async function waitLauncher(page, rootId) {
  await page.waitForFunction(id => {
    const root = document.getElementById(id);
    return root && ['ready', 'unavailable', 'error'].includes(root.dataset.state);
  }, rootId);
}

async function assertNoOverflow(page, rootId, label) {
  const values = await page.evaluate(id => {
    const root = document.getElementById(id);
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      root: root ? root.scrollWidth - root.clientWidth : 999,
    };
  }, rootId);
  assert.ok(values.document <= 1, `${label} document overflow ${values.document}`);
  assert.ok(values.root <= 1, `${label} launcher overflow ${values.root}`);
}

async function assertVerifiedCoordinateRuntime(page) {
  const result = await page.evaluate(({ address, coordinates }) => {
    const contract = window.NorthStarNavigationLauncher;
    const destination = contract.normalizeDestination({ address, verifiedCoordinates: coordinates });
    const rejection = candidate => {
      try {
        contract.validateNavigationUrl('waze', candidate);
        return false;
      } catch (_error) {
        return true;
      }
    };
    return {
      retainedAddress: destination.address,
      google_maps: contract.buildNavigationUrl('google_maps', destination),
      apple_maps: contract.buildNavigationUrl('apple_maps', destination),
      waze: contract.buildNavigationUrl('waze', destination),
      rejectsLl: rejection('https://waze.com/ul?ll=41.7658%2C-72.6734&navigate=yes'),
      rejectsMixedKeys: rejection('https://waze.com/ul?q=41.7658%2C-72.6734&ll=41.7658%2C-72.6734&navigate=yes'),
    };
  }, { address: DISPLAY_ADDRESS, coordinates: VERIFIED_COORDINATES });
  assert.deepStrictEqual(result, {
    retainedAddress: DISPLAY_ADDRESS,
    ...EXPECTED_COORDINATE_URLS,
    rejectsLl: true,
    rejectsMixedKeys: true,
  });
  return result;
}

async function assertPrimaryContrastStates(page, rootId, label) {
  const primary = page.locator(`#${rootId} [data-navigation-primary]`);
  const states = [];
  for (const state of ['normal', 'hover', 'focus', 'disabled']) {
    await page.mouse.move(0, 0);
    await page.evaluate(id => {
      const button = document.querySelector(`#${id} [data-navigation-primary]`);
      button.disabled = false;
      button.blur();
    }, rootId);
    if (state === 'hover') await primary.hover();
    if (state === 'focus') await primary.focus();
    if (state === 'disabled') {
      await page.evaluate(id => {
        document.querySelector(`#${id} [data-navigation-primary]`).disabled = true;
      }, rootId);
    }
    const sample = await page.evaluate(({ id, stateName }) => {
      const button = document.querySelector(`#${id} [data-navigation-primary]`);
      const style = getComputedStyle(button);
      const channels = value => {
        const match = String(value).match(/^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/);
        if (!match) throw new Error(`Unsupported computed color: ${value}`);
        return match.slice(1).map(Number);
      };
      const component = value => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const luminance = rgb => 0.2126 * component(rgb[0]) + 0.7152 * component(rgb[1]) + 0.0722 * component(rgb[2]);
      const filterMatch = style.filter.match(/^brightness\((\d+(?:\.\d+)?)\)$/);
      const brightness = filterMatch ? Number(filterMatch[1]) : 1;
      const filtered = value => channels(value).map(channel => Math.min(255, channel * brightness));
      const foreground = filtered(style.color);
      const background = filtered(style.backgroundColor);
      const first = luminance(foreground);
      const second = luminance(background);
      return {
        state: stateName,
        color: style.color,
        backgroundColor: style.backgroundColor,
        filter: style.filter,
        opacity: Number(style.opacity),
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
        hovered: button.matches(':hover'),
        focused: document.activeElement === button,
        disabled: button.disabled,
      };
    }, { id: rootId, stateName: state });
    assert.ok(sample.ratio >= 4.5, `${label} ${state} contrast ${sample.ratio}`);
    if (state === 'hover') assert.strictEqual(sample.hovered, true, `${label} hover state`);
    if (state === 'focus') assert.strictEqual(sample.focused, true, `${label} focus state`);
    if (state === 'disabled') {
      assert.strictEqual(sample.disabled, true, `${label} disabled state`);
      assert.strictEqual(sample.opacity, 1, `${label} disabled text must remain fully opaque`);
    }
    states.push(sample);
  }
  await page.evaluate(id => {
    document.querySelector(`#${id} [data-navigation-primary]`).disabled = false;
  }, rootId);
  return states;
}

async function openLead(page, origin, opportunityId) {
  const response = await page.goto(`${origin}/dashboard/lead?id=${encodeURIComponent(opportunityId)}`, {
    waitUntil: 'domcontentloaded', timeout: 15000,
  });
  assert.strictEqual(response.status(), 200);
  await waitLauncher(page, 'leadNavigationLauncher');
}

async function openCustomerDrawer(page, origin, route, customerId) {
  const response = await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 15000 });
  assert.strictEqual(response.status(), 200);
  await page.waitForFunction(() => window.CustomerDetail && typeof window.CustomerDetail.open === 'function');
  await page.evaluate(id => window.CustomerDetail.open(id), customerId);
  await waitLauncher(page, 'cdNavigationLauncher');
}

async function launcherState(page, rootId) {
  return page.evaluate(id => {
    const root = document.getElementById(id);
    const primary = root.querySelector('[data-navigation-primary]');
    const chooser = root.querySelector('[data-navigation-chooser]');
    return {
      state: root.dataset.state,
      theme: document.documentElement.getAttribute('data-theme'),
      address: root.closest('.lead-detail-card')
        ? document.getElementById('leadCanonicalAddress').textContent
        : document.getElementById('cdAddress').textContent,
      primaryDisabled: primary.disabled,
      primaryLabel: primary.getAttribute('aria-label'),
      chooserHidden: chooser.hidden,
      statusRole: root.querySelector('[data-navigation-status]').getAttribute('role'),
      providers: Array.from(root.querySelectorAll('[data-navigation-provider]')).map(node => ({
        key: node.dataset.navigationProvider, text: node.textContent, hidden: node.hidden,
      })),
      scripts: root.querySelectorAll('script,img,svg,a').length,
    };
  }, rootId);
}

async function observeActionTimePreferenceRequest(page, action) {
  const request = page.waitForRequest(candidate => {
    const url = new URL(candidate.url());
    return candidate.method() === 'GET' && url.pathname === '/api/account/map-preferences';
  }, { timeout: 1500 }).then(() => true, () => false);
  await action();
  return request;
}

async function exerciseDirectAndChooser(page, rootId) {
  const root = page.locator('#' + rootId);
  const primary = root.locator('[data-navigation-primary]');
  await page.evaluate(id => {
    document.querySelector(`#${id} [data-navigation-primary]`)
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, rootId);
  assert.deepStrictEqual(await page.evaluate(() => window.__phase6eOpenCalls.slice()), [],
    'an untrusted synthetic click cannot navigate');
  await primary.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__phase6eOpenCalls.length === 1);
  let calls = await page.evaluate(() => window.__phase6eOpenCalls.slice());
  assert.deepStrictEqual(calls, [{ url: EXPECTED_URLS.google_maps, target: '_blank', features: 'noopener,noreferrer' }]);
  let status = root.locator('[data-navigation-status]');
  assert.strictEqual(await status.getAttribute('role'), 'status');
  assert.match(await status.textContent(), /opened Google Maps/i,
    'a nonthrowing noopener null result is an attempted launch, not proof of blocking');

  const chooser = root.locator('[data-navigation-chooser]');
  await chooser.focus();
  await page.keyboard.press('Enter');
  assert.strictEqual(await chooser.getAttribute('aria-expanded'), 'true');
  assert.strictEqual(await page.evaluate(id => document.activeElement.dataset.navigationProvider,
    rootId), 'apple_maps');
  await page.keyboard.press('Escape');
  assert.strictEqual(await chooser.getAttribute('aria-expanded'), 'false');
  assert.strictEqual(await page.evaluate(id => document.activeElement === document.querySelector(`#${id} [data-navigation-chooser]`), rootId), true);
  await chooser.click();
  await page.mouse.click(5, 5);
  assert.strictEqual(await chooser.getAttribute('aria-expanded'), 'false');
  assert.strictEqual(await page.evaluate(id => document.activeElement === document.querySelector(`#${id} [data-navigation-chooser]`), rootId), true);
  await chooser.click();
  await root.locator('[data-navigation-provider="waze"]').click();
  await page.waitForFunction(() => window.__phase6eOpenCalls.length === 2);
  calls = await page.evaluate(() => window.__phase6eOpenCalls.slice());
  assert.deepStrictEqual(calls[1], { url: EXPECTED_URLS.waze, target: '_blank', features: 'noopener,noreferrer' });
  assert.strictEqual(calls.length, 2);

  await page.evaluate(() => { window.__phase6eOpenMode = 'success-proxy'; });
  await primary.click();
  await page.waitForFunction(() => window.__phase6eOpenCalls.length === 3);
  status = root.locator('[data-navigation-status]');
  assert.strictEqual(await status.getAttribute('role'), 'status');
  assert.match(await status.textContent(), /opened Google Maps/i,
    'the launcher must not access an opener retained only by a test proxy');

  await page.evaluate(() => { window.__phase6eOpenMode = 'throw'; });
  await primary.click();
  await page.waitForFunction(() => window.__phase6eOpenCalls.length === 4);
  assert.strictEqual(await status.getAttribute('role'), 'alert');
  assert.match(await status.textContent(), /could not be opened/i);
}

async function main() {
  const selected = process.argv[2] || process.env.BROWSER || 'chrome';
  assert.ok(['chrome', 'webkit'].includes(selected), 'Usage: node tests/browser/m20-phase6e-navigation-launchers.js chrome|webkit');
  const runtime = resolveBrowserRuntime(selected);
  const suiteDatabase = await createSuiteDatabase(`m20-phase6e-navigation-${selected}`);
  const environmentNames = [
    'DATABASE_URL', 'AUTH_ACCESS_SECRET', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
    'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER',
    'SMTP_PASS', 'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
  ];
  const originalEnvironment = new Map(environmentNames.map(name => [name, process.env[name]]));
  process.env.DATABASE_URL = suiteDatabase.connectionString;
  process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
  for (const name of environmentNames.slice(2)) delete process.env[name];
  const originalFetch = global.fetch;
  global.fetch = async function() { throw new Error('provider boundary must remain unused'); };

  let db;
  let server;
  let browser;
  try {
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const pool = db.getPool();
    const databaseIdentity = {
      version: (await pool.query('SHOW server_version')).rows[0].server_version,
      timezone: (await pool.query('SHOW timezone')).rows[0].TimeZone,
      checksums: (await pool.query('SHOW data_checksums')).rows[0].data_checksums,
    };
    assert.match(databaseIdentity.version, /^18\.4(?:\D|$)/);
    assert.strictEqual(databaseIdentity.timezone, 'UTC');
    assert.strictEqual(databaseIdentity.checksums, 'on');

    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Phase 6E Browser A','phase6e-browser-a@example.test'),
       ($2,'Phase 6E Browser B','phase6e-browser-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const user of ROLE_USERS.concat([{ role: 'owner', id: OWNER_B }])) {
      const organizationId = user.id === OWNER_B ? ORG_B : ORG_A;
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [user.id, organizationId, `Phase 6E ${user.role}`, `${user.id}@phase6e-browser.test`, user.role]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: ROLE_USERS[0].id, profile: canonicalFenceProfile({ version: 'phase6e-browser-a' }) });
    await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, profile: canonicalFenceProfile({ version: 'phase6e-browser-b' }) });
    const { ingestLead } = require('../../src/services/canonicalGraphService');
    const graphA = await ingestLead(pool, graphInput(ORG_A, 'a', ADDRESS));
    const graphB = await ingestLead(pool, graphInput(ORG_B, 'b', '900 Other Tenant Way, Elsewhere, WA 98000'));
    assert.strictEqual(graphA.status, 201);
    assert.strictEqual(graphB.status, 201);
    const ids = graphA.body.ids;

    const sessions = {};
    for (const user of ROLE_USERS) {
      sessions[user.role] = await provisionDurableSession(pool, { userId: user.id, organizationId: ORG_A, role: user.role });
    }
    sessions.tenantB = await provisionDurableSession(pool, { userId: OWNER_B, organizationId: ORG_B, role: 'owner' });
    const before = await databaseDigest(pool);
    const { app } = require('../../src/server');
    server = await listen(app);
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
    if (selected === 'chrome') assert.strictEqual(browser.version(), CFT_VERSION);
    if (selected === 'webkit') assert.strictEqual(browser.version(), WEBKIT_VERSION);

    const ledger = { requests: [], externalRequests: [], pageErrors: [], consoleErrors: [], contrast: [] };
    let verifiedCoordinateEvidence = null;
    const staleAuthorityEvidence = {};

    const staleDirectSpec = { label: 'stale-authority-primary', viewport: { width: 1280, height: 800 }, theme: 'light' };
    const staleDirectContext = await createContext(browser, origin, sessions.owner, staleDirectSpec, ledger);
    let staleDirectDocument = preferenceDocument('google_maps');
    let staleDirectReads = 0;
    await staleDirectContext.route('**/api/account/map-preferences', route => {
      staleDirectReads += 1;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(preferenceBody(staleDirectDocument, `stale-primary-${staleDirectReads}`)),
      });
    });
    const staleDirectPage = await staleDirectContext.newPage();
    attachPage(staleDirectPage, ledger, staleDirectSpec.label);
    await openLead(staleDirectPage, origin, ids.opportunity);
    staleDirectDocument = preferenceDocument('apple_maps', {
      google_maps: { enabled: false, visible: true },
    });
    const staleDirectRefresh = await observeActionTimePreferenceRequest(staleDirectPage, () =>
      staleDirectPage.locator('#leadNavigationLauncher [data-navigation-primary]').click());
    if (staleDirectRefresh) {
      await waitLauncher(staleDirectPage, 'leadNavigationLauncher');
      await staleDirectPage.waitForFunction(() => /changed|no longer available/i.test(
        document.querySelector('#leadNavigationLauncher [data-navigation-status]').textContent
      ));
    }
    const staleDirectState = await launcherState(staleDirectPage, 'leadNavigationLauncher');
    staleAuthorityEvidence.primary = {
      refreshObserved: staleDirectRefresh,
      reads: staleDirectReads,
      launches: await staleDirectPage.evaluate(() => window.__phase6eOpenCalls.slice()),
      primaryLabel: staleDirectState.primaryLabel,
      providerKeys: staleDirectState.providers.map(provider => provider.key),
      status: await staleDirectPage.locator('#leadNavigationLauncher [data-navigation-status]').textContent(),
    };
    await staleDirectContext.close();

    const staleChooserSpec = { label: 'stale-authority-chooser', viewport: { width: 390, height: 844 }, theme: 'dark' };
    const staleChooserContext = await createContext(browser, origin, sessions.admin, staleChooserSpec, ledger);
    let staleChooserDocument = preferenceDocument('google_maps');
    let staleChooserReads = 0;
    await staleChooserContext.route('**/api/account/map-preferences', route => {
      staleChooserReads += 1;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(preferenceBody(staleChooserDocument, `stale-chooser-${staleChooserReads}`)),
      });
    });
    const staleChooserPage = await staleChooserContext.newPage();
    attachPage(staleChooserPage, ledger, staleChooserSpec.label);
    await openLead(staleChooserPage, origin, ids.opportunity);
    await staleChooserPage.locator('#leadNavigationLauncher [data-navigation-chooser]').click();
    staleChooserDocument = preferenceDocument('google_maps', {
      apple_maps: { enabled: true, visible: false },
    });
    const staleChooserRefresh = await observeActionTimePreferenceRequest(staleChooserPage, () =>
      staleChooserPage.locator('#leadNavigationLauncher [data-navigation-provider="apple_maps"]').click());
    if (staleChooserRefresh) {
      await waitLauncher(staleChooserPage, 'leadNavigationLauncher');
      await staleChooserPage.waitForFunction(() => /changed|no longer available/i.test(
        document.querySelector('#leadNavigationLauncher [data-navigation-status]').textContent
      ));
    }
    const staleChooserState = await launcherState(staleChooserPage, 'leadNavigationLauncher');
    staleAuthorityEvidence.chooser = {
      refreshObserved: staleChooserRefresh,
      reads: staleChooserReads,
      launches: await staleChooserPage.evaluate(() => window.__phase6eOpenCalls.slice()),
      primaryLabel: staleChooserState.primaryLabel,
      providerKeys: staleChooserState.providers.map(provider => provider.key),
      status: await staleChooserPage.locator('#leadNavigationLauncher [data-navigation-status]').textContent(),
    };
    await staleChooserContext.close();

    const matrix = [
      { role: 'owner', viewport: { width: 1440, height: 900 }, theme: 'light' },
      { role: 'admin', viewport: { width: 390, height: 844 }, theme: 'dark' },
      { role: 'member', viewport: { width: 1280, height: 800 }, theme: 'dark' },
      { role: 'viewer', viewport: { width: 412, height: 915 }, theme: 'light' },
    ];
    for (const spec of matrix) {
      spec.label = `${spec.role}-${spec.viewport.width}-${spec.theme}`;
      const context = await createContext(browser, origin, sessions[spec.role], spec, ledger);
      const page = await context.newPage();
      attachPage(page, ledger, spec.label);
      await openLead(page, origin, ids.opportunity);
      const state = await launcherState(page, 'leadNavigationLauncher');
      assert.deepStrictEqual(state.providers, [
        { key: 'apple_maps', text: '↗Apple Maps', hidden: false },
        { key: 'waze', text: '↗Waze', hidden: false },
      ]);
      assert.strictEqual(state.state, 'ready');
      assert.strictEqual(state.theme, spec.theme);
      assert.strictEqual(state.address, DISPLAY_ADDRESS);
      assert.strictEqual(state.primaryDisabled, false);
      assert.match(state.primaryLabel, /Google Maps.*100 Cedar Lane/i);
      assert.strictEqual(state.chooserHidden, false);
      assert.strictEqual(state.scripts, 0);
      await assertNoOverflow(page, 'leadNavigationLauncher', spec.label);
      if (spec.role === 'owner') {
        verifiedCoordinateEvidence = await assertVerifiedCoordinateRuntime(page);
        await exerciseDirectAndChooser(page, 'leadNavigationLauncher');
      }
      if (spec.theme === 'dark') {
        ledger.contrast.push(...await assertPrimaryContrastStates(page, 'leadNavigationLauncher', spec.label));
      }
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitLauncher(page, 'leadNavigationLauncher');
      assert.strictEqual(await page.locator('#leadNavigationLauncher [data-navigation-primary]').count(), 1);
      await context.close();
    }

    for (const [index, route] of ['/dashboard/leads', '/dashboard/communications', '/dashboard'].entries()) {
      const spec = { label: `shared-drawer-${index}`, viewport: { width: index === 1 ? 390 : 1366, height: 850 }, theme: index === 2 ? 'dark' : 'light' };
      const context = await createContext(browser, origin, sessions.owner, spec, ledger);
      const page = await context.newPage();
      attachPage(page, ledger, spec.label);
      await openCustomerDrawer(page, origin, route, ids.customer);
      const state = await launcherState(page, 'cdNavigationLauncher');
      assert.strictEqual(state.state, 'ready');
      assert.strictEqual(state.address, DISPLAY_ADDRESS);
      assert.strictEqual(state.scripts, 0);
      await assertNoOverflow(page, 'cdNavigationLauncher', spec.label);
      if (spec.theme === 'dark') {
        ledger.contrast.push(...await assertPrimaryContrastStates(page, 'cdNavigationLauncher', spec.label));
      }
      if (index === 0) {
        await page.locator('#cdNavigationLauncher [data-navigation-chooser]').focus();
        await page.keyboard.press('Enter');
        await page.locator('#cdNavigationLauncher [data-navigation-provider="apple_maps"]').click();
        await page.waitForFunction(() => window.__phase6eOpenCalls.length === 1);
        assert.deepStrictEqual(await page.evaluate(() => window.__phase6eOpenCalls), [
          { url: EXPECTED_URLS.apple_maps, target: '_blank', features: 'noopener,noreferrer' },
        ]);
      }
      await page.evaluate(() => window.CustomerDetail.close());
      await page.evaluate(id => window.CustomerDetail.open(id), ids.customer);
      await waitLauncher(page, 'cdNavigationLauncher');
      assert.strictEqual(await page.locator('#cdNavigationLauncher [data-navigation-primary]').count(), 1);
      await context.close();
    }

    const hiddenSpec = { label: 'hidden-default', viewport: { width: 390, height: 844 }, theme: 'dark' };
    const hiddenContext = await createContext(browser, origin, sessions.viewer, hiddenSpec, ledger);
    const hiddenDocument = preferenceDocument('apple_maps', {
      google_maps: { enabled: false, visible: true },
      apple_maps: { enabled: true, visible: false },
      waze: { enabled: true, visible: true },
    });
    await hiddenContext.route('**/api/account/map-preferences', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(preferenceBody(hiddenDocument)),
    }));
    const hiddenPage = await hiddenContext.newPage();
    attachPage(hiddenPage, ledger, hiddenSpec.label);
    await openLead(hiddenPage, origin, ids.opportunity);
    const hiddenState = await launcherState(hiddenPage, 'leadNavigationLauncher');
    assert.strictEqual(hiddenState.primaryDisabled, false);
    assert.deepStrictEqual(hiddenState.providers, [{ key: 'waze', text: '↗Waze', hidden: false }]);
    await hiddenPage.locator('#leadNavigationLauncher [data-navigation-primary]').click();
    assert.strictEqual(await hiddenPage.locator('#leadNavigationLauncher [data-navigation-chooser]').getAttribute('aria-expanded'), 'true');
    assert.deepStrictEqual(await hiddenPage.evaluate(() => window.__phase6eOpenCalls), []);
    await hiddenPage.locator('#leadNavigationLauncher [data-navigation-provider="waze"]').click();
    await hiddenPage.waitForFunction(() => window.__phase6eOpenCalls.length === 1);
    assert.strictEqual((await hiddenPage.evaluate(() => window.__phase6eOpenCalls[0].url)), EXPECTED_URLS.waze);
    await hiddenContext.close();

    const unavailableSpec = { label: 'no-visible-provider', viewport: { width: 1280, height: 800 }, theme: 'light' };
    const unavailableContext = await createContext(browser, origin, sessions.member, unavailableSpec, ledger);
    const unavailableDocument = preferenceDocument('google_maps', {
      google_maps: { visible: false }, apple_maps: { visible: false }, waze: { visible: false },
    });
    await unavailableContext.route('**/api/account/map-preferences', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(preferenceBody(unavailableDocument)),
    }));
    const unavailablePage = await unavailableContext.newPage();
    attachPage(unavailablePage, ledger, unavailableSpec.label);
    await openLead(unavailablePage, origin, ids.opportunity);
    const unavailableState = await launcherState(unavailablePage, 'leadNavigationLauncher');
    assert.strictEqual(unavailableState.state, 'unavailable');
    assert.strictEqual(unavailableState.primaryDisabled, true);
    assert.deepStrictEqual(unavailableState.providers, []);
    assert.match(await unavailablePage.locator('#leadNavigationLauncher [data-navigation-status]').textContent(), /no enabled.*visible|unavailable/i);
    await unavailableContext.close();

    const poisonSpec = { label: 'destination-poison', viewport: { width: 412, height: 915 }, theme: 'dark' };
    const poisonContext = await createContext(browser, origin, sessions.owner, poisonSpec, ledger);
    await poisonContext.route('**/api/v1/canonical/compat/leads*', async route => {
      const response = await route.fetch();
      const body = await response.json();
      if (body.data && body.data.records && body.data.records[0]) {
        body.data.records[0].customer.address = '<img src=x onerror="window.__phase6eXss++">javascript:alert(1)';
      }
      return route.fulfill({ response, body: JSON.stringify(body), contentType: 'application/json' });
    });
    const poisonPage = await poisonContext.newPage();
    attachPage(poisonPage, ledger, poisonSpec.label);
    await openLead(poisonPage, origin, ids.opportunity);
    const poisonState = await launcherState(poisonPage, 'leadNavigationLauncher');
    assert.strictEqual(poisonState.state, 'unavailable');
    assert.strictEqual(poisonState.primaryDisabled, true);
    assert.strictEqual(await poisonPage.evaluate(() => window.__phase6eXss), 0);
    assert.strictEqual(await poisonPage.locator('#leadNavigationLauncher img,#leadNavigationLauncher script,#leadNavigationLauncher svg').count(), 0);
    assert.deepStrictEqual(await poisonPage.evaluate(() => window.__phase6eOpenCalls), []);
    await poisonContext.close();

    const missingSpec = { label: 'destination-missing', viewport: { width: 1280, height: 800 }, theme: 'light' };
    const missingContext = await createContext(browser, origin, sessions.viewer, missingSpec, ledger);
    await missingContext.route('**/api/v1/canonical/compat/leads*', async route => {
      const response = await route.fetch();
      const body = await response.json();
      if (body.data && body.data.records && body.data.records[0]) body.data.records[0].customer.address = null;
      return route.fulfill({ response, body: JSON.stringify(body), contentType: 'application/json' });
    });
    const missingPage = await missingContext.newPage();
    attachPage(missingPage, ledger, missingSpec.label);
    await openLead(missingPage, origin, ids.opportunity);
    const missingState = await launcherState(missingPage, 'leadNavigationLauncher');
    assert.strictEqual(missingState.state, 'unavailable');
    assert.strictEqual(missingState.address, 'Address unavailable');
    assert.strictEqual(missingState.primaryDisabled, true);
    assert.deepStrictEqual(await missingPage.evaluate(() => window.__phase6eOpenCalls), []);
    await missingContext.close();

    const preferencePoisonSpec = { label: 'preference-poison-retry', viewport: { width: 1366, height: 850 }, theme: 'light' };
    const preferencePoisonContext = await createContext(browser, origin, sessions.admin, preferencePoisonSpec, ledger);
    let poisonPreference = true;
    await preferencePoisonContext.route('**/api/account/map-preferences', route => {
      if (!poisonPreference) return route.continue();
      poisonPreference = false;
      const body = preferenceBody(preferenceDocument());
      body.data.effective.targetUserId = OWNER_B;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const preferencePoisonPage = await preferencePoisonContext.newPage();
    attachPage(preferencePoisonPage, ledger, preferencePoisonSpec.label);
    await openLead(preferencePoisonPage, origin, ids.opportunity);
    assert.strictEqual((await launcherState(preferencePoisonPage, 'leadNavigationLauncher')).state, 'error');
    assert.strictEqual(await preferencePoisonPage.locator('#leadNavigationLauncher [data-navigation-primary]').isDisabled(), true);
    await preferencePoisonPage.locator('#leadNavigationLauncher [data-navigation-retry]').focus();
    await preferencePoisonPage.keyboard.press('Enter');
    await preferencePoisonPage.waitForFunction(() => document.getElementById('leadNavigationLauncher').dataset.state === 'ready');
    assert.strictEqual(await preferencePoisonPage.evaluate(() => document.activeElement.dataset.navigationPrimary !== undefined), true);
    await preferencePoisonContext.close();

    const staleSpec = { label: 'stale-preference-reload', viewport: { width: 1280, height: 800 }, theme: 'dark' };
    const staleContext = await createContext(browser, origin, sessions.owner, staleSpec, ledger);
    const stalePage = await staleContext.newPage();
    attachPage(stalePage, ledger, staleSpec.label);
    await openLead(stalePage, origin, ids.opportunity);
    let releaseOld;
    const oldGate = new Promise(resolve => { releaseOld = resolve; });
    let reloadCount = 0;
    await stalePage.route('**/api/account/map-preferences', async route => {
      reloadCount += 1;
      if (reloadCount === 1) {
        await oldGate;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(preferenceBody(preferenceDocument('apple_maps'), 'old')) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(preferenceBody(preferenceDocument('waze'), 'new')) });
    });
    const firstReload = stalePage.evaluate(() => window.NorthStarNavigationLauncher.reload());
    await stalePage.waitForTimeout(20);
    const secondReload = stalePage.evaluate(() => window.NorthStarNavigationLauncher.reload());
    await secondReload;
    releaseOld();
    await firstReload.catch(() => null);
    await stalePage.waitForFunction(() => /Waze/.test(document.querySelector('#leadNavigationLauncher [data-navigation-primary]').getAttribute('aria-label')));
    await stalePage.locator('#leadNavigationLauncher [data-navigation-primary]').click();
    await stalePage.waitForFunction(() => window.__phase6eOpenCalls.length === 1);
    assert.strictEqual((await stalePage.evaluate(() => window.__phase6eOpenCalls[0].url)), EXPECTED_URLS.waze);
    await staleContext.close();

    const tenantBSpec = { label: 'tenant-b', viewport: { width: 390, height: 844 }, theme: 'light' };
    const tenantBContext = await createContext(browser, origin, sessions.tenantB, tenantBSpec, ledger);
    const tenantBPage = await tenantBContext.newPage();
    attachPage(tenantBPage, ledger, tenantBSpec.label);
    await openLead(tenantBPage, origin, graphB.body.ids.opportunity);
    assert.match(await tenantBPage.locator('#leadCanonicalAddress').textContent(), /900 Other Tenant Way/);
    assert.doesNotMatch(await tenantBPage.locator('body').textContent(), /100 Cedar Lane/);
    await tenantBContext.close();

    assert.deepStrictEqual(staleAuthorityEvidence.primary, {
      refreshObserved: true,
      reads: 2,
      launches: [],
      primaryLabel: `Navigate with Apple Maps to ${DISPLAY_ADDRESS}`,
      providerKeys: ['waze'],
      status: 'Navigation preferences changed. Review the refreshed options and try again.',
    }, 'primary activation must not launch a provider disabled after mount');
    assert.deepStrictEqual(staleAuthorityEvidence.chooser, {
      refreshObserved: true,
      reads: 2,
      launches: [],
      primaryLabel: `Navigate with Google Maps to ${DISPLAY_ADDRESS}`,
      providerKeys: ['waze'],
      status: 'That navigation provider is no longer available.',
    }, 'chooser selection must not launch a provider hidden after the chooser opens');

    assert.deepStrictEqual(await databaseDigest(pool), before, 'browser launch intents never mutate PostgreSQL');
    assert.deepStrictEqual(ledger.externalRequests, [], 'no provider or other external request occurs');
    assert.deepStrictEqual(ledger.pageErrors, [], 'no browser page errors');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'no browser console errors');
    assert.ok(ledger.requests.every(entry => entry.origin === origin), 'all network traffic is same-origin');
    assert.deepStrictEqual(ledger.requests.filter(entry => entry.method !== 'GET'), [], 'browser launcher flow is GET-only');
    assert.ok(ledger.requests.some(entry => entry.path === '/api/account/map-preferences'));
    assert.ok(ledger.requests.some(entry => entry.path.startsWith('/api/v1/canonical/compat/')));

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'official Chrome-for-Testing' : 'actual Playwright WebKit',
      version: browser.version(), executableSha256: selected === 'chrome' ? CFT_SHA256 : null,
      physicalSafari: false, database: suiteDatabase.databaseName, databaseIdentity,
      roles: 4, tenants: 2, sharedDrawerHosts: 3, canonicalLocationSurfaces: 2,
      viewports: ['1440x900', '1280x800', '412x915', '390x844'], themes: ['light', 'dark'],
      urlContracts: EXPECTED_URLS,
      verifiedCoordinateUrls: verifiedCoordinateEvidence,
      contrastStates: ledger.contrast,
      states: ['loading', 'ready', 'hidden-default chooser', 'no-visible-provider', 'invalid destination', 'preference poison', 'retry', 'stale reload', 'action-time authority change', 'nonthrowing noopener null', 'synchronous open failure'],
      accessibility: ['trusted keyboard Enter', 'synthetic click rejected', 'Escape', 'outside dismiss', 'chooser focus', 'retry focus', 'live status', 'assertive error'],
      externalRequests: 0, providerRequests: 0, productionWrites: 0, databaseMutations: 0,
      xssExecutions: 0, pageErrors: 0, consoleErrors: 0, overflow: 0,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db && db.getPool()) await db.getPool().end();
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
