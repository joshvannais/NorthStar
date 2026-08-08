'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ROOT = path.resolve(__dirname, '..', '..');
const ORG_A = '9e000000-0000-4000-8000-000000000001';
const ORG_B = '9e000000-0000-4000-8000-000000000002';
const OWNER_A = '9f000000-0000-4000-8000-000000000001';
const ADMIN_A = '9f000000-0000-4000-8000-000000000002';
const MEMBER_A = '9f000000-0000-4000-8000-000000000003';
const VIEWER_A = '9f000000-0000-4000-8000-000000000004';
const OWNER_B = '9f000000-0000-4000-8000-000000000005';
const UNKNOWN_MARKER = '  保留🧭 <svg onload=window.__operationalXss++>\r\ne\u0301  ';
const LEGACY_LEAD_TIME = '  legacy lead time 0️⃣ <raw>  ';
const COMPANY_NAME = 'Operational <img src=x onerror=window.__operationalXss++> Company 🧭';

function baseProfile(name) {
  const value = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({ companyName: name });
  value.company = { ...value.company, ...canonical.company, name };
  value.services = canonical.services;
  value.canonicalPricing = canonical.canonicalPricing;
  value.canonicalCosts = canonical.canonicalCosts;
  value.routing.futureRouting = UNKNOWN_MARKER;
  value.crew.futureCrew = UNKNOWN_MARKER;
  value.vehicles.futureVehicle = UNKNOWN_MARKER;
  value.scheduling.leadTimeHours = LEGACY_LEAD_TIME;
  value.scheduling.futureScheduling = UNKNOWN_MARKER;
  value.voiceAssistant = { name: 'Durable North', greeting: UNKNOWN_MARKER, personality: 'professional' };
  value.retell = { providerPrivate: UNKNOWN_MARKER };
  return value;
}

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
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
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function contextFor(browser, origin, session, input, ledger) {
  const context = await browser.newContext({ viewport: input.viewport });
  await context.addInitScript(theme => {
    window.__operationalXss = 0;
    localStorage.setItem('northstar-theme', theme);
  }, input.theme);
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (/fonts\.googleapis|fonts\.gstatic/.test(url.hostname)) {
      return route.fulfill({ status: 200, contentType: url.hostname.includes('googleapis') ? 'text/css' : 'font/woff2', body: '' });
    }
    const entry = { role: input.role, method: route.request().method(), url: route.request().url() };
    if (/retell|stripe|twilio|resend|openai|provider/i.test(url.hostname)) ledger.providers.push(entry);
    else ledger.external.push(entry);
    return route.fulfill({ status: 204, body: '' });
  });
  context.on('request', browserRequest => {
    const url = new URL(browserRequest.url());
    ledger.requests.push({
      role: input.role,
      method: browserRequest.method(),
      origin: url.origin,
      path: url.pathname,
      authorization: browserRequest.headers().authorization || null,
    });
  });
  return context;
}

function attachPage(page, ledger, role) {
  page.on('pageerror', error => ledger.pageErrors.push(role + ': ' + error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (/status of 409 \(Conflict\)/.test(message.text())) {
      ledger.expectedConflictConsole.push(role + ': ' + message.text());
      return;
    }
    if (role === 'owner-error-state' && /status of 503/.test(message.text())) {
      ledger.expectedErrorConsole.push(role + ': ' + message.text());
      return;
    }
    ledger.consoleErrors.push(role + ': ' + message.text());
  });
}

async function openProfile(page, origin) {
  await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'ready');
}

async function assertNoOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1));
}

async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  const { browserType, executablePath } = resolveBrowserRuntime(selected);
  const original = new Map();
  for (const name of [
    'DATABASE_URL', 'AUTH_ACCESS_SECRET', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
    'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  ]) original.set(name, process.env[name]);
  const suiteDatabase = await createSuiteDatabase('m20-phase4-browser-' + selected);
  let db;
  let server;
  let browser;
  const ledger = {
    requests: [], providers: [], external: [], consoleErrors: [], expectedConflictConsole: [],
    expectedErrorConsole: [], pageErrors: [],
  };
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    ]) delete process.env[name];

    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL initializes');
    const pool = db.getPool();
    const identity = (await pool.query(
      "SELECT current_setting('server_version') AS version, current_setting('TimeZone') AS timezone, current_setting('data_checksums') AS checksums"
    )).rows[0];
    assert.deepStrictEqual(identity, { version: '18.4', timezone: 'UTC', checksums: 'on' });
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Phase 4 browser A','phase4-browser-a@example.test'),
       ($2,'Phase 4 browser B','phase4-browser-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, `${role}-${userId.slice(-4)}@phase4-browser.test`, role]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, profile: baseProfile(COMPANY_NAME) });
    const otherAuthority = await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, profile: baseProfile('Other Tenant') });
    const sessions = {};
    for (const [role, userId, organizationId] of [
      ['owner', OWNER_A, ORG_A], ['admin', ADMIN_A, ORG_A], ['member', MEMBER_A, ORG_A],
      ['viewer', VIEWER_A, ORG_A], ['otherOwner', OWNER_B, ORG_B],
    ]) {
      sessions[role] = await provisionDurableSession(pool, { userId, organizationId, role: role === 'otherOwner' ? 'owner' : role });
    }
    const { app } = require('../../src/server');
    const { AssetCatalogueRepository } = require('../../src/assets/repository');
    const { AssetCatalogueService } = require('../../src/assets/service');
    app.locals.assetCatalogueService = new AssetCatalogueService(new AssetCatalogueRepository(pool));
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await browserType.launch({ headless: true, executablePath });

    const beforeUnrelated = (await pool.query(
      `SELECT raw_profile -> 'financial' AS financial,
              raw_profile #>> '{routing,preferredProvider}' AS provider,
              encode(convert_to(raw_profile #>> '{routing,futureRouting}', 'UTF8'), 'hex') AS routing_hex,
              encode(convert_to(raw_profile #>> '{scheduling,leadTimeHours}', 'UTF8'), 'hex') AS lead_hex,
              encode(convert_to(raw_profile #>> '{voiceAssistant,greeting}', 'UTF8'), 'hex') AS voice_hex,
              raw_profile -> 'retell' AS retell
         FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];

    const ownerContext = await contextFor(browser, origin, sessions.owner, {
      role: 'owner-desktop-light', viewport: { width: 1440, height: 900 }, theme: 'light',
    }, ledger);
    const ownerPage = await ownerContext.newPage();
    attachPage(ownerPage, ledger, 'owner-desktop-light');
    await openProfile(ownerPage, origin);
    await assertNoOverflow(ownerPage);
    assert.strictEqual(await ownerPage.locator('#saveOperationalConfigurationBtn').isDisabled(), true);
    assert.strictEqual(await ownerPage.evaluate(() => window.__operationalXss), 0);
    const operationalSurfaceText = await ownerPage.evaluate(() => [
      'section-routing', 'section-crew', 'section-vehicles', 'section-scheduling',
    ].map(id => document.getElementById(id).textContent).join('\n'));
    assert.strictEqual(operationalSurfaceText.includes(UNKNOWN_MARKER), false);
    await ownerPage.click('[data-section="routing"]');
    assert.match(await ownerPage.locator('#section-routing').textContent(), /Planning policies only/);
    assert.match(await ownerPage.locator('#section-routing').textContent(), /Mission 22\/23/);

    await ownerPage.click('[data-section="company"]');
    await ownerPage.fill('#company-dba', 'Unsaved general edit survives operational save');
    await ownerPage.click('[data-section="retell"]');
    await ownerPage.fill('#voice-assistant-name', 'Unsaved voice edit survives operational save');
    await ownerPage.click('[data-section="vehicles"]');
    await ownerPage.fill('#veh-truckCount', '0');
    await ownerPage.fill('#veh-averageMpg', '15');
    assert.strictEqual(await ownerPage.locator('#saveOperationalConfigurationBtn').isDisabled(), false);
    const operationalSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/operationalConfiguration' && response.request().method() === 'PUT');
    await ownerPage.click('#saveOperationalConfigurationBtn');
    const operationalResponse = await operationalSave;
    assert.strictEqual(operationalResponse.status(), 200);
    const operationalBody = operationalResponse.request().postDataJSON();
    assert.deepStrictEqual(Object.keys(operationalBody).sort(), ['expectedVersion', 'value']);
    assert.match(operationalBody.expectedVersion, /^org-profile-v[1-9][0-9]*$/);
    assert.deepStrictEqual(operationalBody.value, { vehicles: { averageMpg: 15, truckCount: 0 } });
    assert.strictEqual(await ownerPage.inputValue('#company-dba'), 'Unsaved general edit survives operational save');
    assert.strictEqual(await ownerPage.inputValue('#voice-assistant-name'), 'Unsaved voice edit survives operational save');
    assert.strictEqual(await ownerPage.inputValue('#veh-truckCount'), '0');
    assert.strictEqual(await ownerPage.locator('#saveOperationalConfigurationBtn').isDisabled(), true);

    const afterOperational = (await pool.query(
      `SELECT raw_profile -> 'financial' AS financial,
              raw_profile #>> '{routing,preferredProvider}' AS provider,
              encode(convert_to(raw_profile #>> '{routing,futureRouting}', 'UTF8'), 'hex') AS routing_hex,
              encode(convert_to(raw_profile #>> '{scheduling,leadTimeHours}', 'UTF8'), 'hex') AS lead_hex,
              encode(convert_to(raw_profile #>> '{voiceAssistant,greeting}', 'UTF8'), 'hex') AS voice_hex,
              raw_profile -> 'retell' AS retell,
              raw_profile #>> '{vehicles,truckCount}' AS trucks,
              raw_profile #>> '{vehicles,averageMpg}' AS mpg
         FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];
    assert.deepStrictEqual({
      financial: afterOperational.financial, provider: afterOperational.provider,
      routing_hex: afterOperational.routing_hex, lead_hex: afterOperational.lead_hex,
      voice_hex: afterOperational.voice_hex, retell: afterOperational.retell,
    }, beforeUnrelated);
    assert.strictEqual(afterOperational.routing_hex, hex(UNKNOWN_MARKER));
    assert.strictEqual(afterOperational.lead_hex, hex(LEGACY_LEAD_TIME));
    assert.strictEqual(afterOperational.voice_hex, hex(UNKNOWN_MARKER));
    assert.strictEqual(afterOperational.trucks, '0');
    assert.strictEqual(afterOperational.mpg, '15');

    await ownerPage.click('[data-section="scheduling"]');
    await ownerPage.fill('#sched-travelBuffer', '25');
    const globalWritesBeforeBlock = ledger.requests.filter(entry => entry.role === 'owner-desktop-light' &&
      entry.method === 'PUT' && entry.path === '/api/v1/business-profile').length;
    await ownerPage.click('#saveBtn');
    await ownerPage.waitForFunction(() => /Save or reload operational policies/.test(document.getElementById('operationalConfigurationError').textContent));
    assert.strictEqual(await ownerPage.locator('#saveOperationalConfigurationBtn').evaluate(element => document.activeElement === element), true);
    assert.strictEqual(ledger.requests.filter(entry => entry.role === 'owner-desktop-light' &&
      entry.method === 'PUT' && entry.path === '/api/v1/business-profile').length, globalWritesBeforeBlock);
    await ownerPage.fill('#sched-travelBuffer', '15');
    assert.strictEqual(await ownerPage.locator('#saveOperationalConfigurationBtn').isDisabled(), true, 'reverting exact baseline clears dirty');

    await ownerPage.fill('#sched-travelBuffer', '25');
    const current = await request(app).get('/api/v1/business-profile').set(sessions.admin.headers);
    const advanced = await request(app).put('/api/v1/business-profile/operationalConfiguration').set(sessions.admin.headers).send({
      expectedVersion: current.body.data.canonicalAuthority.version,
      value: { scheduling: { maxDailyTravel: 130 } },
    });
    assert.strictEqual(advanced.status, 200);
    const conflict = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/operationalConfiguration' && response.request().method() === 'PUT');
    await ownerPage.click('#saveOperationalConfigurationBtn');
    assert.strictEqual((await conflict).status(), 409);
    await ownerPage.waitForFunction(() => /unsaved operational values remain/.test(document.getElementById('operationalConfigurationError').textContent));
    assert.strictEqual(await ownerPage.locator('#reloadOperationalConfigurationBtn').isVisible(), true);
    assert.strictEqual(await ownerPage.locator('#reloadOperationalConfigurationBtn').evaluate(element => document.activeElement === element), true);
    await ownerPage.fill('#sched-travelBuffer', '26');
    assert.strictEqual(await ownerPage.locator('#saveOperationalConfigurationBtn').isDisabled(), true, 'conflict remains latched after edit');
    const reloadOperational = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile' && response.request().method() === 'GET');
    await ownerPage.click('#reloadOperationalConfigurationBtn');
    assert.strictEqual((await reloadOperational).status(), 200);
    await ownerPage.waitForFunction(() => {
      const travelBuffer = document.getElementById('sched-travelBuffer');
      const error = document.getElementById('operationalConfigurationError');
      const reload = document.getElementById('reloadOperationalConfigurationBtn');
      const save = document.getElementById('saveOperationalConfigurationBtn');
      return travelBuffer && travelBuffer.value === '15' &&
        travelBuffer.getAttribute('aria-invalid') === 'false' &&
        error && error.textContent === '' && !error.classList.contains('show') &&
        reload && reload.hidden && save && save.disabled;
    });
    assert.strictEqual(await ownerPage.inputValue('#sched-travelBuffer'), '15');
    assert.strictEqual(await ownerPage.locator('#sched-travelBuffer').getAttribute('aria-invalid'), 'false');
    assert.strictEqual(await ownerPage.locator('#operationalConfigurationError').textContent(), '');
    assert.strictEqual(await ownerPage.locator('#operationalConfigurationError').evaluate(element => element.classList.contains('show')), false);
    assert.strictEqual(await ownerPage.locator('#reloadOperationalConfigurationBtn').isVisible(), false);
    assert.strictEqual(await ownerPage.locator('#saveOperationalConfigurationBtn').isDisabled(), true);
    assert.strictEqual(await ownerPage.inputValue('#company-dba'), 'Unsaved general edit survives operational save');
    assert.strictEqual(await ownerPage.inputValue('#voice-assistant-name'), 'Unsaved voice edit survives operational save');

    const voiceSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/voiceAssistant' && response.request().method() === 'PUT');
    await ownerPage.click('[data-section="retell"]');
    await ownerPage.click('#saveVoiceAssistantBtn');
    assert.strictEqual((await voiceSave).status(), 200);
    assert.strictEqual(await ownerPage.inputValue('#company-dba'), 'Unsaved general edit survives operational save');
    await ownerPage.locator('#veh-truckCount').evaluate(element => { element.value = '999'; });
    const globalSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile' && response.request().method() === 'PUT');
    await ownerPage.click('#saveBtn');
    const globalResponse = await globalSave;
    assert.strictEqual(globalResponse.status(), 200);
    const globalBody = globalResponse.request().postDataJSON();
    assert.deepStrictEqual(Object.keys(globalBody).sort(), ['expectedVersion', 'value']);
    assert.match(globalBody.expectedVersion, /^org-profile-v[1-9][0-9]*$/);
    assert.strictEqual(globalBody.value.vehicles.truckCount, 0, 'global collection ignores the operational control value');
    assert.strictEqual(globalBody.value.company.dba, 'Unsaved general edit survives operational save');
    await ownerPage.reload({ waitUntil: 'domcontentloaded' });
    await ownerPage.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'ready');
    assert.strictEqual(await ownerPage.inputValue('#veh-truckCount'), '0');
    assert.strictEqual(await ownerPage.inputValue('#veh-averageMpg'), '15');
    assert.strictEqual(await ownerPage.inputValue('#sched-maxDailyTravel'), '130');
    assert.strictEqual(await ownerPage.inputValue('#company-dba'), 'Unsaved general edit survives operational save');
    assert.strictEqual(await ownerPage.evaluate(() => window.__operationalXss), 0);
    await ownerContext.close();

    const adminContext = await contextFor(browser, origin, sessions.admin, {
      role: 'admin-desktop-dark', viewport: { width: 1280, height: 800 }, theme: 'dark',
    }, ledger);
    const adminPage = await adminContext.newPage();
    attachPage(adminPage, ledger, 'admin-desktop-dark');
    await openProfile(adminPage, origin);
    await adminPage.click('[data-section="crew"]');
    await adminPage.fill('#crew-shopTime', '0');
    const adminSave = adminPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/operationalConfiguration' && response.request().method() === 'PUT');
    await adminPage.click('#saveOperationalConfigurationBtn');
    assert.strictEqual((await adminSave).status(), 200);
    await assertNoOverflow(adminPage);
    await adminContext.close();

    for (const input of [
      { role: 'owner-mobile-dark', session: sessions.owner, viewport: { width: 390, height: 844 }, theme: 'dark', editable: true },
      { role: 'admin-mobile-light', session: sessions.admin, viewport: { width: 412, height: 915 }, theme: 'light', editable: true },
      { role: 'member-desktop-dark', session: sessions.member, viewport: { width: 1280, height: 800 }, theme: 'dark', editable: false },
      { role: 'member-mobile-light', session: sessions.member, viewport: { width: 390, height: 844 }, theme: 'light', editable: false },
      { role: 'viewer-desktop-light', session: sessions.viewer, viewport: { width: 1280, height: 800 }, theme: 'light', editable: false },
      { role: 'viewer-mobile-dark', session: sessions.viewer, viewport: { width: 390, height: 844 }, theme: 'dark', editable: false },
    ]) {
      const context = await contextFor(browser, origin, input.session, input, ledger);
      const page = await context.newPage();
      attachPage(page, ledger, input.role);
      await openProfile(page, origin);
      assert.strictEqual(await page.locator('#routing-dispatchFrom').isDisabled(), !input.editable);
      assert.strictEqual(await page.locator('#saveOperationalConfigurationBtn').isDisabled(), true);
      assert.strictEqual(await page.locator('#reloadOperationalConfigurationBtn').isVisible(), false);
      assert.strictEqual(await page.evaluate(() => window.__operationalXss), 0);
      await assertNoOverflow(page);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'ready');
      assert.strictEqual(await page.locator('#routing-dispatchFrom').isDisabled(), !input.editable);
      await context.close();
    }

    const errorContext = await contextFor(browser, origin, sessions.owner, {
      role: 'owner-error-state', viewport: { width: 390, height: 844 }, theme: 'dark',
    }, ledger);
    await errorContext.route('**/api/v1/business-profile', route => route.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'TEST_UNAVAILABLE', message: 'Unavailable' } }),
    }));
    const errorPage = await errorContext.newPage();
    attachPage(errorPage, ledger, 'owner-error-state');
    await errorPage.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    await errorPage.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'error');
    assert.strictEqual(await errorPage.locator('#saveOperationalConfigurationBtn').isDisabled(), true);
    assert.strictEqual(await errorPage.locator('#routing-dispatchFrom').isDisabled(), true);
    await assertNoOverflow(errorPage);
    await errorContext.close();

    assert.strictEqual((await pool.query('SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B])).rows[0].id, otherAuthority.id);
    assert.deepStrictEqual(ledger.providers, [], 'provider requests remain zero');
    assert.deepStrictEqual(ledger.external, [], 'unexpected external requests remain zero');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'unexpected console errors remain zero');
    assert.strictEqual(ledger.expectedConflictConsole.length, 1, 'one intentional stale write reports one expected 409 resource error');
    assert.ok(ledger.expectedErrorConsole.length <= 1, 'the intentional error state emits at most one expected 503 resource error');
    assert.deepStrictEqual(ledger.pageErrors, [], 'page errors remain zero');
    assert.ok(ledger.requests.every(entry => entry.authorization === null), 'browser sends no Authorization headers');
    assert.strictEqual(ledger.requests.filter(entry =>
      (entry.role.startsWith('member') || entry.role.startsWith('viewer')) &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method)).length, 0, 'read-only roles emit zero writes');

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      version: browser.version(),
      database: suiteDatabase.databaseName,
      databaseIdentity: identity,
      roles: ['owner', 'admin', 'member', 'viewer'],
      viewports: ['desktop', 'mobile'],
      themes: ['light', 'dark'],
      lifecycle: ['initial', 'dirty', 'save', 'rerender', 'conflict', 'reload', 'page-reload', 'error'],
      rawBytes: 'exact',
      providerRequests: 0,
      providerActions: 0,
      consoleErrors: 0,
      pageErrors: 0,
      xssExecutions: 0,
      overflow: 0,
      physicalSafari: false,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db && db.getPool()) await db.getPool().end();
    await suiteDatabase.cleanup();
    for (const [name, value] of original.entries()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
