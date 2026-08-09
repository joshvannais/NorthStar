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

const ORG_A = 'b6200000-0000-4000-8000-000000000001';
const ORG_B = 'b6200000-0000-4000-8000-000000000002';
const OWNER_A = 'b6300000-0000-4000-8000-000000000001';
const ADMIN_A = 'b6300000-0000-4000-8000-000000000002';
const MEMBER_A = 'b6300000-0000-4000-8000-000000000003';
const VIEWER_A = 'b6300000-0000-4000-8000-000000000004';
const OWNER_B = 'b6300000-0000-4000-8000-000000000005';
const ROOT = path.resolve(__dirname, '..', '..');
const HOSTILE = '保留🧭 e\u0301\r\n<img src=x onerror="window.__readinessXss++"><svg onload="window.__readinessXss++">';
const GUIDANCE = 'Help Polaris understand your business. Polaris works best with a complete, accurate, and up-to-date Business Profile. The more relevant detail you provide, the better Polaris can tailor its recommendations to your business.';

function profileFor(name) {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({ companyName: name });
  profile.company = {
    ...profile.company,
    ...canonical.company,
    name,
    email: '',
    phone: '',
    timeZone: 'America/New_York',
    currency: 'USD',
  };
  profile.industry = 'Tree care';
  profile.businessDescription = 'Residential and commercial work.';
  profile.headquarters = {
    street: '10 Main Street', city: 'Asheville', state: 'NC', zip: '28801', country: 'US',
    latitude: 35.5951, longitude: -82.5515, additionalOffices: [],
  };
  profile.routing = { dispatchFrom: 'headquarters', trafficEnabled: false };
  profile.serviceArea = { maxRadiusMiles: null, maxTravelMinutes: null, primaryTerritory: '', polygon: [] };
  profile.hours = { monday: { open: '08:00', close: '17:00' }, holidays: [] };
  profile.services = canonical.services;
  profile.canonicalPricing = canonical.canonicalPricing;
  profile.canonicalCosts = canonical.canonicalCosts;
  profile.crew = { ...profile.crew, ...canonical.crew };
  profile.emergencyPolicy = HOSTILE;
  profile.faq = ['Do you handle permits?\r\nYes.'];
  profile.companyValues = ['Safety'];
  profile.policies = { cleanup: 'Leave the site clean.' };
  profile.voiceAssistant = {
    name: 'NorthStar Guide', greeting: HOSTILE, personality: 'professional',
  };
  profile.integrations = { retell: { status: 'connected', opaque: HOSTILE } };
  return profile;
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
  const context = await browser.newContext({ viewport: input.viewport, colorScheme: input.theme });
  await context.addInitScript(theme => {
    window.__readinessXss = 0;
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
      return route.fulfill({
        status: 200,
        contentType: url.hostname.includes('googleapis') ? 'text/css' : 'font/woff2',
        body: '',
      });
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
  await page.waitForFunction(() => {
    const root = document.getElementById('businessProfileRoot');
    const readiness = document.getElementById('profileReadiness');
    return root && root.dataset.state === 'ready' && readiness && readiness.dataset.state === 'ready';
  });
}

async function assertNoOverflow(page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    readiness: document.getElementById('profileReadiness').scrollWidth -
      document.getElementById('profileReadiness').clientWidth,
  }));
  assert.ok(overflow.document <= 1, 'document horizontal overflow: ' + overflow.document);
  assert.ok(overflow.readiness <= 1, 'readiness horizontal overflow: ' + overflow.readiness);
}

async function assertReadinessAccessibility(page) {
  const result = await page.evaluate(expectedGuidance => {
    const region = document.getElementById('profileReadiness');
    const heading = document.getElementById('profileReadinessHeading');
    const description = document.getElementById('profileReadinessDescription');
    const status = document.getElementById('profileReadinessStatus');
    const error = document.getElementById('profileReadinessError');
    const live = document.getElementById('profileReadinessLive');
    const list = document.getElementById('profileReadinessList');
    const guidance = document.getElementById('polarisProfileGuidance');
    return {
      region: {
        tag: region.tagName,
        labelledBy: region.getAttribute('aria-labelledby'),
        describedBy: region.getAttribute('aria-describedby'),
        busy: region.getAttribute('aria-busy'),
      },
      heading: { text: heading.textContent.trim(), tabIndex: heading.tabIndex },
      description: description.textContent.trim(),
      status: { role: status.getAttribute('role'), live: status.getAttribute('aria-live'), atomic: status.getAttribute('aria-atomic') },
      error: { role: error.getAttribute('role'), tabIndex: error.tabIndex },
      live: { role: live.getAttribute('role'), live: live.getAttribute('aria-live') },
      list: { role: list.getAttribute('role'), label: list.getAttribute('aria-label'), count: list.children.length },
      listItems: Array.from(list.children).every(row => row.getAttribute('role') === 'listitem' &&
        row.getAttribute('aria-labelledby') && document.getElementById(row.getAttribute('aria-labelledby'))),
      groups: Array.from(region.querySelectorAll('[role="group"]')).every(group => group.getAttribute('aria-label')),
      guidance: {
        exact: guidance.textContent === expectedGuidance,
        followsHeading: guidance.previousElementSibling && guidance.previousElementSibling.matches('h1'),
      },
      decorativeMeasures: region.querySelectorAll('progress,meter,[role="progressbar"]').length,
      unsafeNodes: region.querySelectorAll('script,img,svg').length,
    };
  }, GUIDANCE);
  assert.deepStrictEqual(result.region, {
    tag: 'SECTION',
    labelledBy: 'profileReadinessHeading',
    describedBy: 'profileReadinessDescription',
    busy: 'false',
  });
  assert.deepStrictEqual(result.heading, { text: 'Profile Readiness', tabIndex: -1 });
  assert.match(result.description, /recognized Business Profile details/);
  assert.deepStrictEqual(result.status, { role: 'status', live: 'polite', atomic: 'true' });
  assert.deepStrictEqual(result.error, { role: 'alert', tabIndex: -1 });
  assert.deepStrictEqual(result.live, { role: 'status', live: 'polite' });
  assert.deepStrictEqual(result.list, { role: 'list', label: 'Profile Readiness items', count: 11 });
  assert.strictEqual(result.listItems, true);
  assert.strictEqual(result.groups, true);
  assert.deepStrictEqual(result.guidance, { exact: true, followsHeading: true });
  assert.strictEqual(result.decorativeMeasures, 0);
  assert.strictEqual(result.unsafeNodes, 0);
}

async function active(pool, organizationId = ORG_A) {
  return (await pool.query(
    `SELECT id, version_label AS version, raw_profile,
            CASE WHEN raw_profile ? 'profileReadiness'
                 THEN encode(convert_to((raw_profile -> 'profileReadiness')::text, 'UTF8'), 'hex')
                 ELSE NULL END AS readiness_hex,
            (SELECT count(*)::int FROM canonical_business_profiles WHERE organization_id = $1) AS version_count
       FROM canonical_business_profiles
      WHERE organization_id = $1 AND is_active = TRUE`,
    [organizationId]
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
  const suiteDatabase = await createSuiteDatabase('m20-phase6b-browser-' + selected);
  let db;
  let server;
  let browser;
  let httpsSpy;
  let originalFetch;
  const providerActions = [];
  const ledger = {
    requests: [], providers: [], external: [], consoleErrors: [], expectedConsole: [], pageErrors: [],
  };
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    ]) delete process.env[name];
    originalFetch = global.fetch;
    global.fetch = function () {
      providerActions.push('fetch');
      throw new Error('Provider fetch boundary reached during Phase 6B browser run.');
    };
    httpsSpy = https.request;
    https.request = function () {
      providerActions.push('https.request');
      throw new Error('Provider HTTPS boundary reached during Phase 6B browser run.');
    };

    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const pool = db.getPool();
    const identity = (await pool.query(
      "SELECT current_setting('server_version') AS version, current_setting('TimeZone') AS timezone, current_setting('data_checksums') AS checksums"
    )).rows[0];
    assert.deepStrictEqual(identity, { version: '18.4', timezone: 'UTC', checksums: 'on' });
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Phase 6B browser A','phase6b-browser-a@example.test'),
       ($2,'Phase 6B browser B','phase6b-browser-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, `${role}-${userId.slice(-4)}@phase6b-browser.test`, role]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, profile: profileFor('Phase 6B Browser Company') });
    const otherAuthority = await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B, profile: profileFor('Other Tenant'),
    });
    const sessions = {};
    for (const [role, userId, organizationId] of [
      ['owner', OWNER_A, ORG_A], ['admin', ADMIN_A, ORG_A], ['member', MEMBER_A, ORG_A],
      ['viewer', VIEWER_A, ORG_A], ['otherOwner', OWNER_B, ORG_B],
    ]) {
      sessions[role] = await provisionDurableSession(pool, {
        userId,
        organizationId,
        role: role === 'otherOwner' ? 'owner' : role,
      });
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
    await assertReadinessAccessibility(ownerPage);
    await assertNoOverflow(ownerPage);
    assert.strictEqual(await ownerPage.evaluate(() => window.__readinessXss), 0);
    assert.match(await ownerPage.locator('#profileReadinessStatus').textContent(), /^Action needed/);
    assert.strictEqual(await ownerPage.locator('#profileReadinessEmpty').isVisible(), true);
    assert.strictEqual(await ownerPage.locator('[data-item-id="business_contact"] .bp-readiness-state').textContent(), 'Recommended');
    assert.strictEqual(await ownerPage.locator('[data-item-id="service_area"] .bp-readiness-state').textContent(), 'Missing');
    assert.strictEqual((await ownerPage.locator('#profileReadiness').textContent()).includes(HOSTILE), false);

    const companyReview = ownerPage.locator('[data-item-id="company_identity"] [data-readiness-action="review"]');
    await companyReview.focus();
    await ownerPage.keyboard.press('Enter');
    assert.deepStrictEqual(await ownerPage.evaluate(() => ({
      itemId: document.activeElement.dataset.itemId,
      action: document.activeElement.dataset.readinessAction,
      pressed: document.activeElement.getAttribute('aria-pressed'),
    })), { itemId: 'company_identity', action: 'review', pressed: 'true' });
    await ownerPage.locator('[data-item-id="service_area"] [data-readiness-action="mark_not_applicable"]').click();
    assert.strictEqual(await ownerPage.locator('#saveProfileReadinessBtn').isEnabled(), true);
    const saveResponse = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/profileReadiness' &&
      response.request().method() === 'PUT');
    await ownerPage.locator('#saveProfileReadinessBtn').focus();
    await ownerPage.keyboard.press('Enter');
    const saved = await saveResponse;
    assert.strictEqual(saved.status(), 200);
    assert.deepStrictEqual(saved.request().postDataJSON(), {
      expectedVersion: 'org-profile-v1',
      changes: [
        { itemId: 'company_identity', action: 'review' },
        { itemId: 'service_area', action: 'mark_not_applicable' },
      ],
    });
    await ownerPage.waitForFunction(() =>
      document.querySelector('[data-item-id="company_identity"] .bp-readiness-state').textContent === 'Reviewed');
    assert.strictEqual(await ownerPage.locator('[data-item-id="service_area"] .bp-readiness-state').textContent(), 'Not applicable');
    assert.match(await ownerPage.locator('[data-item-id="company_identity"] .bp-readiness-reviewed').textContent(),
      /Last reviewed:.*orientation only/);
    assert.strictEqual(await ownerPage.locator('#profileReadinessEmpty').isHidden(), true);
    const storedAfterOwner = await active(pool);
    assert.match(storedAfterOwner.readiness_hex, /^[0-9a-f]+$/);

    const adminContext = await contextFor(browser, origin, sessions.admin, {
      role: 'admin-mobile-dark', viewport: { width: 390, height: 844 }, theme: 'dark',
    }, ledger);
    const adminPage = await adminContext.newPage();
    attachPage(adminPage, ledger, 'admin-mobile-dark');
    await openProfile(adminPage, origin);
    await assertReadinessAccessibility(adminPage);
    await assertNoOverflow(adminPage);
    const localeReview = adminPage.locator('[data-item-id="business_locale"] [data-readiness-action="review"]');
    await localeReview.focus();
    await adminPage.keyboard.press(' ');
    assert.strictEqual(await localeReview.getAttribute('aria-pressed'), 'true');
    const adminSave = adminPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/profileReadiness' &&
      response.request().method() === 'PUT');
    await adminPage.click('#saveProfileReadinessBtn');
    assert.strictEqual((await adminSave).status(), 200);
    assert.strictEqual(await adminPage.evaluate(() => window.__readinessXss), 0);
    await adminContext.close();

    // The owner's untouched token is now stale. Pending actions remain visible,
    // the reload control receives focus, and reload deliberately clears them.
    await ownerPage.locator('[data-item-id="active_services"] [data-readiness-action="review"]').click();
    const staleResponse = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/profileReadiness' &&
      response.request().method() === 'PUT');
    await ownerPage.click('#saveProfileReadinessBtn');
    assert.strictEqual((await staleResponse).status(), 409);
    await ownerPage.waitForFunction(() => document.activeElement && document.activeElement.id === 'reloadProfileReadinessBtn');
    assert.match(await ownerPage.locator('#profileReadinessError').textContent(), /pending readiness choices remain visible/);
    assert.strictEqual(await ownerPage.locator('[data-item-id="active_services"] .bp-readiness-pending').isVisible(), true);
    assert.strictEqual(await ownerPage.locator('#saveProfileReadinessBtn').isDisabled(), true);
    const reloadResponse = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/profileReadiness' &&
      response.request().method() === 'GET');
    await ownerPage.keyboard.press('Enter');
    assert.strictEqual((await reloadResponse).status(), 200);
    await ownerPage.waitForFunction(() => document.activeElement && document.activeElement.id === 'profileReadinessHeading');
    assert.strictEqual(await ownerPage.locator('[data-item-id="active_services"] .bp-readiness-pending').count(), 0);
    assert.strictEqual(await ownerPage.locator('#saveProfileReadinessBtn').isDisabled(), true);
    await ownerContext.close();

    // Every read-only role renders the same authority without emitting a mutation.
    for (const input of [
      { role: 'member-desktop-dark', session: sessions.member, viewport: { width: 1440, height: 900 }, theme: 'dark' },
      { role: 'viewer-mobile-light', session: sessions.viewer, viewport: { width: 390, height: 844 }, theme: 'light' },
    ]) {
      const context = await contextFor(browser, origin, input.session, input, ledger);
      const page = await context.newPage();
      attachPage(page, ledger, input.role);
      await openProfile(page, origin);
      await assertReadinessAccessibility(page);
      const actionCount = await page.locator('[data-readiness-action]').count();
      assert.ok(actionCount > 0);
      for (let index = 0; index < actionCount; index += 1) {
        assert.strictEqual(await page.locator('[data-readiness-action]').nth(index).isDisabled(), true);
      }
      assert.strictEqual(await page.locator('#saveProfileReadinessBtn').isDisabled(), true);
      assert.strictEqual(await page.locator('#saveProfileReadinessBtn').textContent(), 'Read-only readiness');
      assert.strictEqual(await page.evaluate(() => window.__readinessXss), 0);
      await assertNoOverflow(page);
      await context.close();
    }

    // Loading is independent from the main profile and remains fail closed.
    const loadingContext = await contextFor(browser, origin, sessions.owner, {
      role: 'owner-mobile-loading-dark', viewport: { width: 390, height: 844 }, theme: 'dark',
    }, ledger);
    let releaseReadiness;
    const readinessGate = new Promise(resolve => { releaseReadiness = resolve; });
    await loadingContext.route('**/api/v1/business-profile/profileReadiness', async route => {
      await readinessGate;
      await route.continue();
    });
    const loadingPage = await loadingContext.newPage();
    attachPage(loadingPage, ledger, 'owner-mobile-loading-dark');
    await loadingPage.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    await loadingPage.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'ready');
    assert.strictEqual(await loadingPage.locator('#profileReadiness').getAttribute('data-state'), 'loading');
    assert.strictEqual(await loadingPage.locator('#profileReadiness').getAttribute('aria-busy'), 'true');
    assert.strictEqual(await loadingPage.locator('#saveProfileReadinessBtn').isDisabled(), true);
    releaseReadiness();
    await loadingPage.waitForFunction(() => document.getElementById('profileReadiness').dataset.state === 'ready');
    await assertNoOverflow(loadingPage);
    await loadingContext.close();

    // A dedicated authority failure does not borrow the main profile's ready state.
    const errorContext = await contextFor(browser, origin, sessions.owner, {
      role: 'owner-desktop-error-light', viewport: { width: 1440, height: 900 }, theme: 'light',
    }, ledger);
    await errorContext.route('**/api/v1/business-profile/profileReadiness', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'TEST_UNAVAILABLE', message: 'Readiness unavailable' } }),
    }));
    const errorPage = await errorContext.newPage();
    attachPage(errorPage, ledger, 'owner-desktop-error-light');
    await errorPage.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    await errorPage.waitForFunction(() =>
      document.getElementById('businessProfileRoot').dataset.state === 'ready' &&
      document.getElementById('profileReadiness').dataset.state === 'error');
    assert.strictEqual(await errorPage.locator('#saveProfileReadinessBtn').isDisabled(), true);
    assert.match(await errorPage.locator('#profileReadinessStatus').textContent(), /unavailable/);
    await errorPage.click('#reloadProfileReadinessBtn');
    await errorPage.waitForFunction(() => document.activeElement && document.activeElement.id === 'profileReadinessError');
    assert.match(await errorPage.locator('#profileReadinessError').textContent(), /Readiness unavailable/);
    await assertNoOverflow(errorPage);
    await errorContext.close();

    // Hostile projected server strings stay text through a full rerender.
    const serverProjection = await request(app).get('/api/v1/business-profile/profileReadiness')
      .set(sessions.owner.headers);
    assert.strictEqual(serverProjection.status, 200);
    const poisonedProjection = JSON.parse(JSON.stringify(serverProjection.body));
    poisonedProjection.body = undefined;
    poisonedProjection.data.items.company_identity.label = HOSTILE;
    poisonedProjection.data.items.company_identity.help = HOSTILE;
    poisonedProjection.data.items.business_contact.recommendedReason = HOSTILE;
    const xssContext = await contextFor(browser, origin, sessions.owner, {
      role: 'owner-mobile-xss-dark', viewport: { width: 390, height: 844 }, theme: 'dark',
    }, ledger);
    await xssContext.route('**/api/v1/business-profile/profileReadiness', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: poisonedProjection.data }),
    }));
    const xssPage = await xssContext.newPage();
    attachPage(xssPage, ledger, 'owner-mobile-xss-dark');
    await openProfile(xssPage, origin);
    assert.strictEqual(await xssPage.locator('[data-item-id="company_identity"] h3').textContent(), HOSTILE);
    assert.strictEqual(await xssPage.locator('[data-item-id="company_identity"] .bp-readiness-help').textContent(), HOSTILE);
    assert.strictEqual(await xssPage.locator('#profileReadiness img,#profileReadiness svg,#profileReadiness script').count(), 0);
    assert.strictEqual(await xssPage.evaluate(() => window.__readinessXss), 0);
    await assertNoOverflow(xssPage);
    await xssContext.close();

    const otherAfter = await active(pool, ORG_B);
    assert.strictEqual(otherAfter.id, otherAuthority.id);
    assert.strictEqual(otherAfter.version, otherAuthority.versionLabel);
    assert.deepStrictEqual(ledger.providers, [], 'provider requests remain zero');
    assert.deepStrictEqual(ledger.external, [], 'unexpected external requests remain zero');
    assert.deepStrictEqual(providerActions, [], 'provider actions remain zero');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'unexpected console errors remain zero');
    assert.deepStrictEqual(ledger.pageErrors, [], 'page errors remain zero');
    assert.ok(ledger.expectedConsole.length >= 2, 'intentional stale and unavailable responses are recorded');
    assert.ok(ledger.requests.every(entry => entry.authorization === null), 'browser sends no Authorization headers');
    assert.strictEqual(ledger.requests.filter(entry =>
      (entry.role.startsWith('member') || entry.role.startsWith('viewer')) &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method)).length, 0,
    'read-only roles emit zero writes');

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      version: browser.version(),
      database: suiteDatabase.databaseName,
      databaseIdentity: identity,
      roles: ['owner', 'admin', 'member', 'viewer'],
      viewports: ['desktop', 'mobile'],
      themes: ['light', 'dark'],
      lifecycle: ['loading', 'empty', 'review', 'not_applicable', 'save', 'stale', 'reload', 'error'],
      accessibility: ['region', 'headings', 'list', 'live status', 'alert', 'keyboard', 'focus'],
      rawReadiness: 'exact JSONB hex',
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
    if (httpsSpy) https.request = httpsSpy;
    if (originalFetch === undefined) delete global.fetch;
    else global.fetch = originalFetch;
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
