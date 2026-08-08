'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ROOT = path.resolve(__dirname, '..', '..');
const ORG_A = 'ac000000-0000-4000-8000-000000000001';
const ORG_B = 'ac000000-0000-4000-8000-000000000002';
const OWNER_A = 'ad000000-0000-4000-8000-000000000001';
const ADMIN_A = 'ad000000-0000-4000-8000-000000000002';
const MEMBER_A = 'ad000000-0000-4000-8000-000000000003';
const VIEWER_A = 'ad000000-0000-4000-8000-000000000004';
const OWNER_B = 'ad000000-0000-4000-8000-000000000005';
const UNKNOWN = '  保留 <svg onload=window.__financialXss++> 😀\r\ne\u0301  ';
const COMPANY = 'Financial <img src=x onerror=window.__financialXss++> Company 😀';

function baseProfile(name) {
  const value = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({ companyName: name });
  value.company = { ...value.company, ...canonical.company, name };
  value.services = canonical.services;
  value.canonicalPricing = {
    ...canonical.canonicalPricing,
    desiredGrossMarginPercent: 0,
    desiredNetMarginPercent: 0,
    maximumDiscountPercent: 0,
    defaultRangePercent: 0,
    futurePricing: UNKNOWN,
  };
  value.canonicalCosts = {
    ...canonical.canonicalCosts,
    materialCostByService: {},
    equipmentCostByReference: {},
    futureCosts: UNKNOWN,
  };
  value.crew = {
    ...value.crew,
    averageHourlyRate: 0,
    overtimeMultiplier: 1,
    travelPay: 0,
    minimumBillableHours: 0,
    futureCrew: UNKNOWN,
  };
  value.vehicles = {
    ...value.vehicles,
    averageFuelCost: 0,
    hourlyVehicleCost: 0,
    maintenanceReserve: 0,
    futureVehicle: UNKNOWN,
  };
  value.financial = {
    ...value.financial,
    desiredGrossMargin: 99,
    desiredNetMargin: 99,
    maximumDiscount: 99,
    unknownLegacy: UNKNOWN,
  };
  value.routing.futureRouting = UNKNOWN;
  value.scheduling.futureScheduling = UNKNOWN;
  value.voiceAssistant = { name: 'Durable North', greeting: UNKNOWN, personality: 'professional' };
  value.retell = { providerPrivate: UNKNOWN };
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
    window.__financialXss = 0;
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
    if (/status of (409 \(Conflict\)|503)/.test(message.text())) {
      ledger.expectedConsole.push(role + ': ' + message.text());
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

async function active(pool) {
  return (await pool.query(
    `SELECT version_label AS version, raw_profile,
            (SELECT count(*)::int FROM canonical_business_profiles WHERE organization_id = $1) AS version_count
       FROM canonical_business_profiles
      WHERE organization_id = $1 AND is_active = TRUE`,
    [ORG_A]
  )).rows[0];
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
  const suiteDatabase = await createSuiteDatabase('m20-phase5-browser-' + selected);
  let db;
  let server;
  let browser;
  const ledger = { requests: [], providers: [], external: [], consoleErrors: [], expectedConsole: [], pageErrors: [] };
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    ]) delete process.env[name];

    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const pool = db.getPool();
    const identity = (await pool.query(
      "SELECT current_setting('server_version') AS version, current_setting('TimeZone') AS timezone, current_setting('data_checksums') AS checksums"
    )).rows[0];
    assert.deepStrictEqual(identity, { version: '18.4', timezone: 'UTC', checksums: 'on' });
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Phase 5 browser A','phase5-browser-a@example.test'),
       ($2,'Phase 5 browser B','phase5-browser-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, `${role}-${userId.slice(-4)}@phase5-browser.test`, role]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, profile: baseProfile(COMPANY) });
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

    const ownerContext = await contextFor(browser, origin, sessions.owner, {
      role: 'owner-desktop-light', viewport: { width: 1440, height: 900 }, theme: 'light',
    }, ledger);
    const ownerPage = await ownerContext.newPage();
    attachPage(ownerPage, ledger, 'owner-desktop-light');
    await openProfile(ownerPage, origin);
    await assertNoOverflow(ownerPage);
    assert.strictEqual(await ownerPage.evaluate(() => window.__financialXss), 0);
    await ownerPage.click('[data-section="financial"]');
    assert.strictEqual(await ownerPage.locator('#fin-defaultRangePercent').inputValue(), '0');
    assert.strictEqual(await ownerPage.locator('#crew-averageHourlyRate').inputValue(), '0');
    assert.strictEqual((await ownerPage.locator('#section-financial').textContent()).includes(UNKNOWN), false);
    assert.match(await ownerPage.locator('#section-financial').textContent(), /Mission 24 owns estimate execution/);

    await ownerPage.locator('[data-section="financial"]').focus();
    await ownerPage.keyboard.press('ArrowRight');
    assert.strictEqual(await ownerPage.evaluate(() => document.activeElement.dataset.section), 'scheduling');
    await ownerPage.keyboard.press('ArrowLeft');
    assert.strictEqual(await ownerPage.evaluate(() => document.activeElement.dataset.section), 'financial');

    // An own Operational write rebases untouched Financial; the following
    // Financial write then rebases untouched General and Voice without a false conflict.
    await ownerPage.click('[data-section="company"]');
    await ownerPage.fill('#company-dba', 'Unsaved general survives financial save');
    await ownerPage.click('[data-section="retell"]');
    await ownerPage.fill('#voice-assistant-name', 'Unsaved voice survives financial save');
    await ownerPage.click('[data-section="vehicles"]');
    await ownerPage.fill('#veh-truckCount', '0');
    const operationalSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/operationalConfiguration' && response.request().method() === 'PUT');
    await ownerPage.click('#saveOperationalConfigurationBtn');
    assert.strictEqual((await operationalSave).status(), 200);

    await ownerPage.click('[data-section="financial"]');
    await ownerPage.fill('#fin-desiredGrossMarginPercent', '40');
    const financialSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/financialConfiguration' && response.request().method() === 'PUT');
    await ownerPage.click('#saveFinancialConfigurationBtn');
    const financialResponse = await financialSave;
    assert.strictEqual(financialResponse.status(), 200);
    const financialBody = financialResponse.request().postDataJSON();
    assert.match(financialBody.expectedVersion, /^org-profile-v[1-9][0-9]*$/);
    assert.deepStrictEqual(Object.keys(financialBody), ['expectedVersion', 'value']);
    assert.deepStrictEqual(Object.keys(financialBody.value), ['canonicalPricing']);
    assert.strictEqual(financialBody.value.canonicalPricing.desiredGrossMarginPercent, 40);
    assert.strictEqual(await ownerPage.locator('#company-dba').inputValue(), 'Unsaved general survives financial save');
    assert.strictEqual(await ownerPage.locator('#voice-assistant-name').inputValue(), 'Unsaved voice survives financial save');

    await ownerPage.click('[data-section="retell"]');
    const voiceSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/voiceAssistant' && response.request().method() === 'PUT');
    await ownerPage.click('#saveVoiceAssistantBtn');
    assert.strictEqual((await voiceSave).status(), 200, 'aligned Financial save advances untouched Voice token');
    const generalSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile' && response.request().method() === 'PUT');
    await ownerPage.click('#saveBtn');
    assert.strictEqual((await generalSave).status(), 200, 'aligned section saves advance untouched General token');

    // Operational conflict/reload advances only Operational. Dirty Financial
    // must retain its stale token and fail closed rather than borrow it.
    await ownerPage.click('[data-section="financial"]');
    await ownerPage.fill('#fin-defaultRangePercent', '7');
    let state = await active(pool);
    const adminOperational = await request(app).put('/api/v1/business-profile/operationalConfiguration').set(sessions.admin.headers).send({
      expectedVersion: state.version,
      value: { scheduling: { travelBuffer: 17 } },
    });
    assert.strictEqual(adminOperational.status, 200);
    await ownerPage.click('[data-section="scheduling"]');
    await ownerPage.fill('#sched-travelBuffer', '18');
    const staleOperational = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/operationalConfiguration' && response.request().method() === 'PUT');
    await ownerPage.click('#saveOperationalConfigurationBtn');
    assert.strictEqual((await staleOperational).status(), 409);
    await ownerPage.waitForFunction(() => document.activeElement.id === 'reloadOperationalConfigurationBtn');
    await ownerPage.click('#reloadOperationalConfigurationBtn');
    await ownerPage.waitForFunction(() => document.getElementById('sched-travelBuffer').value === '17');
    assert.strictEqual(await ownerPage.locator('#fin-defaultRangePercent').inputValue(), '7');
    await ownerPage.click('[data-section="financial"]');
    const staleFinancial = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/financialConfiguration' && response.request().method() === 'PUT');
    await ownerPage.click('#saveFinancialConfigurationBtn');
    assert.strictEqual((await staleFinancial).status(), 409);
    await ownerPage.waitForFunction(() => document.activeElement.id === 'reloadFinancialConfigurationBtn');
    assert.strictEqual((await active(pool)).raw_profile.canonicalPricing.defaultRangePercent, 0);
    const financialReload = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/financialConfiguration' && response.request().method() === 'GET');
    await ownerPage.click('#reloadFinancialConfigurationBtn');
    assert.strictEqual((await financialReload).status(), 200);
    await ownerPage.waitForFunction(() => document.getElementById('fin-defaultRangePercent').value === '0');

    // Fetch-only Financial reload does not advance General.
    await ownerPage.click('[data-section="company"]');
    await ownerPage.fill('#company-dba', 'Stale general must not borrow Financial token');
    const staleGeneral = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile' && response.request().method() === 'PUT');
    await ownerPage.click('#saveBtn');
    assert.strictEqual((await staleGeneral).status(), 409);
    assert.strictEqual(await ownerPage.locator('#company-dba').inputValue(), 'Stale general must not borrow Financial token');
    assert.strictEqual(await ownerPage.locator('#saveBtn').isDisabled(), true);
    await ownerPage.reload({ waitUntil: 'domcontentloaded' });
    await ownerPage.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'ready');

    // A newer external Financial write plus Financial reload cannot advance a
    // dirty Voice token.
    await ownerPage.click('[data-section="retell"]');
    await ownerPage.fill('#voice-assistant-name', 'Stale voice must not borrow Financial token');
    state = await active(pool);
    const adminFinancial = await request(app).put('/api/v1/business-profile/financialConfiguration').set(sessions.admin.headers).send({
      expectedVersion: state.version,
      value: { canonicalPricing: { defaultRangePercent: 9 } },
    });
    assert.strictEqual(adminFinancial.status, 200);
    await ownerPage.click('[data-section="financial"]');
    await ownerPage.fill('#fin-defaultRangePercent', '8');
    const secondStaleFinancial = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/financialConfiguration' && response.request().method() === 'PUT');
    await ownerPage.click('#saveFinancialConfigurationBtn');
    assert.strictEqual((await secondStaleFinancial).status(), 409);
    await ownerPage.click('#reloadFinancialConfigurationBtn');
    await ownerPage.waitForFunction(() => document.getElementById('fin-defaultRangePercent').value === '9');
    await ownerPage.click('[data-section="retell"]');
    const staleVoice = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/voiceAssistant' && response.request().method() === 'PUT');
    await ownerPage.click('#saveVoiceAssistantBtn');
    assert.strictEqual((await staleVoice).status(), 409);
    assert.strictEqual(await ownerPage.locator('#voice-assistant-name').inputValue(), 'Stale voice must not borrow Financial token');
    await ownerPage.reload({ waitUntil: 'domcontentloaded' });
    await ownerPage.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'ready');

    // Cross-field validation stays mounted and client-side; no request occurs.
    await ownerPage.click('[data-section="financial"]');
    const putsBeforeValidation = ledger.requests.filter(entry =>
      entry.role === 'owner-desktop-light' && entry.method === 'PUT' && entry.path.endsWith('/financialConfiguration')).length;
    await ownerPage.fill('#fin-desiredGrossMarginPercent', '10');
    await ownerPage.fill('#fin-desiredNetMarginPercent', '11');
    await ownerPage.click('#saveFinancialConfigurationBtn');
    await ownerPage.waitForFunction(() => /must not exceed/.test(document.getElementById('canonicalFinancialError').textContent));
    assert.strictEqual(await ownerPage.evaluate(() => document.activeElement.id), 'fin-desiredNetMarginPercent');
    assert.strictEqual(ledger.requests.filter(entry =>
      entry.role === 'owner-desktop-light' && entry.method === 'PUT' && entry.path.endsWith('/financialConfiguration')).length, putsBeforeValidation);

    // Exact zero then blank never becomes 42.
    await ownerPage.fill('#fin-desiredGrossMarginPercent', '40');
    await ownerPage.fill('#fin-desiredNetMarginPercent', '0');
    await ownerPage.fill('#crew-averageHourlyRate', '17');
    let rateSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/financialConfiguration' && response.request().method() === 'PUT');
    await ownerPage.click('#saveFinancialConfigurationBtn');
    assert.strictEqual((await rateSave).status(), 200);
    await ownerPage.fill('#crew-averageHourlyRate', '0');
    rateSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/financialConfiguration' && response.request().method() === 'PUT');
    await ownerPage.click('#saveFinancialConfigurationBtn');
    assert.strictEqual((await rateSave).status(), 200);
    assert.strictEqual((await active(pool)).raw_profile.crew.averageHourlyRate, 0);
    await ownerPage.fill('#crew-averageHourlyRate', '');
    rateSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/financialConfiguration' && response.request().method() === 'PUT');
    await ownerPage.click('#saveFinancialConfigurationBtn');
    assert.strictEqual((await rateSave).status(), 200);
    assert.strictEqual(Object.prototype.hasOwnProperty.call((await active(pool)).raw_profile.crew, 'averageHourlyRate'), false);

    const raw = (await pool.query(
      `SELECT encode(convert_to(raw_profile #>> '{canonicalPricing,futurePricing}', 'UTF8'), 'hex') AS pricing_hex,
              encode(convert_to(raw_profile #>> '{canonicalCosts,futureCosts}', 'UTF8'), 'hex') AS costs_hex,
              encode(convert_to(raw_profile #>> '{crew,futureCrew}', 'UTF8'), 'hex') AS crew_hex,
              encode(convert_to(raw_profile #>> '{vehicles,futureVehicle}', 'UTF8'), 'hex') AS vehicle_hex,
              encode(convert_to(raw_profile #>> '{financial,unknownLegacy}', 'UTF8'), 'hex') AS legacy_hex,
              encode(convert_to(raw_profile #>> '{voiceAssistant,greeting}', 'UTF8'), 'hex') AS voice_hex
         FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE`, [ORG_A]
    )).rows[0];
    for (const field of Object.keys(raw)) assert.strictEqual(raw[field], hex(UNKNOWN));
    assert.strictEqual(await ownerPage.evaluate(() => window.__financialXss), 0);
    await assertNoOverflow(ownerPage);
    await ownerContext.close();

    // Read-only and responsive/theme matrix.
    for (const input of [
      { role: 'member-desktop-dark', session: sessions.member, viewport: { width: 1440, height: 900 }, theme: 'dark' },
      { role: 'viewer-mobile-light', session: sessions.viewer, viewport: { width: 390, height: 844 }, theme: 'light' },
    ]) {
      const context = await contextFor(browser, origin, input.session, input, ledger);
      const page = await context.newPage();
      attachPage(page, ledger, input.role);
      await openProfile(page, origin);
      await page.click('[data-section="financial"]');
      assert.strictEqual(await page.locator('#fin-defaultRangePercent').isDisabled(), true);
      assert.strictEqual(await page.locator('#saveFinancialConfigurationBtn').isDisabled(), true);
      assert.strictEqual(await page.evaluate(() => window.__financialXss), 0);
      await assertNoOverflow(page);
      await context.close();
    }

    // Loading and fail-closed error states keep Financial disabled.
    const loadingContext = await contextFor(browser, origin, sessions.owner, {
      role: 'owner-mobile-loading', viewport: { width: 390, height: 844 }, theme: 'dark',
    }, ledger);
    let releaseProfile;
    const gate = new Promise(resolve => { releaseProfile = resolve; });
    await loadingContext.route('**/api/v1/business-profile', async route => {
      await gate;
      await route.continue();
    });
    const loadingPage = await loadingContext.newPage();
    attachPage(loadingPage, ledger, 'owner-mobile-loading');
    await loadingPage.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(await loadingPage.locator('#businessProfileRoot').getAttribute('data-state'), 'loading');
    assert.strictEqual(await loadingPage.locator('#saveFinancialConfigurationBtn').isDisabled(), true);
    releaseProfile();
    await loadingPage.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'ready');
    await assertNoOverflow(loadingPage);
    await loadingContext.close();

    const errorContext = await contextFor(browser, origin, sessions.owner, {
      role: 'owner-mobile-error', viewport: { width: 390, height: 844 }, theme: 'dark',
    }, ledger);
    await errorContext.route('**/api/v1/business-profile', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'TEST_UNAVAILABLE', message: 'Unavailable' } }),
    }));
    const errorPage = await errorContext.newPage();
    attachPage(errorPage, ledger, 'owner-mobile-error');
    await errorPage.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    await errorPage.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'error');
    assert.strictEqual(await errorPage.locator('#saveFinancialConfigurationBtn').isDisabled(), true);
    assert.strictEqual(await errorPage.locator('#fin-defaultRangePercent').isDisabled(), true);
    await assertNoOverflow(errorPage);
    await errorContext.close();

    assert.strictEqual((await pool.query(
      'SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B]
    )).rows[0].id, otherAuthority.id);
    assert.deepStrictEqual(ledger.providers, [], 'provider requests remain zero');
    assert.deepStrictEqual(ledger.external, [], 'unexpected external requests remain zero');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'unexpected console errors remain zero');
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
      lifecycle: [
        'loading', 'initial', 'dirty', 'validation', 'save', 'zero', 'blank-delete',
        'aligned-sibling-rebase', 'operational-reload-stale-financial',
        'financial-reload-stale-general', 'financial-reload-stale-voice', 'error',
      ],
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
