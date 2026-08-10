'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ROOT = path.resolve(__dirname, '..', '..');
const ORG_A = '8d000000-0000-4000-8000-000000000001';
const ORG_B = '8d000000-0000-4000-8000-000000000002';
const OWNER_A = '8e000000-0000-4000-8000-000000000001';
const ADMIN_A = '8e000000-0000-4000-8000-000000000002';
const MEMBER_A = '8e000000-0000-4000-8000-000000000003';
const VIEWER_A = '8e000000-0000-4000-8000-000000000004';
const OWNER_B = '8e000000-0000-4000-8000-000000000005';
const EXPECTED_CATEGORIES = Object.freeze([
  'communications_ai',
  'calendar_scheduling',
  'accounting_payments',
  'field_service_crm',
  'workflow_data',
  'maps_navigation',
  'enterprise_assets_inventory',
]);
const EXPECTED_PROVIDERS = Object.freeze([
  'retell', 'voice', 'twilio', 'openai', 'elevenlabs', 'email',
  'google_calendar', 'microsoft_calendar', 'apple_calendar',
  'quickbooks', 'stripe', 'square',
  'jobber', 'housecall_pro', 'servicetitan', 'salesforce',
  'google_sheets', 'zapier',
  'google_maps', 'apple_maps', 'waze',
  'procore', 'netsuite', 'dynamics_365', 'samsara', 'fleetio',
]);

const LEGACY_INTEGRATIONS = Object.freeze({
  retell: Object.freeze({ enabled: false, label: '  </span><img src=x onerror=window.__integrationXss++>  ' }),
  stripe: Object.freeze({ enabled: true, label: '  LEGACY STRIPE MUST NOT CONNECT  ' }),
  googleCalendar: Object.freeze({ enabled: true, calendar: '  legacy-calendar\r\nbytes  ' }),
});

function profileFor(name) {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({ companyName: name });
  profile.company = { ...profile.company, ...canonical.company, name };
  profile.services = canonical.services;
  profile.canonicalPricing = canonical.canonicalPricing;
  profile.canonicalCosts = canonical.canonicalCosts;
  profile.integrations = JSON.parse(JSON.stringify(LEGACY_INTEGRATIONS));
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
  const context = await browser.newContext({ viewport: input.viewport });
  let catalogueRequestCount = 0;
  await context.addInitScript(theme => {
    window.__integrationXss = 0;
    localStorage.setItem('northstar-theme', theme);
  }, input.theme);
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('**/*', route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === origin) {
      if (requestUrl.pathname === '/api/v1/integrations/catalogue') {
        catalogueRequestCount += 1;
        const override = input.catalogueResponses && input.catalogueResponses[
          Math.min(catalogueRequestCount - 1, input.catalogueResponses.length - 1)
        ];
        if (override && override !== 'continue') {
          return route.fulfill({
            status: override.status,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify(override.body),
          });
        }
        if (input.delayCatalogueMs) {
          return new Promise(resolve => setTimeout(resolve, input.delayCatalogueMs))
            .then(() => route.continue());
        }
      }
      return route.continue();
    }
    if (/fonts\.googleapis|fonts\.gstatic/.test(requestUrl.hostname)) {
      return route.fulfill({
        status: 200,
        contentType: requestUrl.hostname.includes('googleapis') ? 'text/css' : 'font/woff2',
        body: '',
      });
    }
    const entry = { role: input.role, method: route.request().method(), url: route.request().url() };
    if (/retell|stripe|twilio|resend|openai|provider|jobber|googleapis/i.test(requestUrl.hostname)) {
      ledger.providers.push(entry);
    } else {
      ledger.external.push(entry);
    }
    return route.fulfill({ status: 204, body: '' });
  });
  context.on('request', request => {
    const requestUrl = new URL(request.url());
    ledger.requests.push({
      role: input.role,
      method: request.method(),
      origin: requestUrl.origin,
      path: requestUrl.pathname,
      authorization: request.headers().authorization || null,
    });
  });
  return context;
}

function attachPage(page, ledger, role) {
  page.on('pageerror', error => ledger.pageErrors.push(role + ': ' + (error.stack || error.message)));
  page.on('console', message => {
    if (message.type() === 'error') ledger.consoleErrors.push(role + ': ' + message.text());
  });
}

async function waitForReady(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('integrationCatalogueRoot');
    return root && root.dataset.state === 'ready';
  }, null, { timeout: 15000 });
}

async function authorityDigest(pool) {
  const profiles = await pool.query(
    `SELECT organization_id, id, version_number, is_active, raw_profile
       FROM canonical_business_profiles
      ORDER BY organization_id, id`
  );
  const ownership = await pool.query(
    `SELECT organization_id, id, provider, external_integration_id, status, metadata
       FROM canonical_integration_ownership
      ORDER BY organization_id, id`
  );
  return crypto.createHash('sha256')
    .update(JSON.stringify({ profiles: profiles.rows, ownership: ownership.rows }))
    .digest('hex');
}

async function integrationSnapshot(page) {
  return page.evaluate(() => ({
    state: document.getElementById('integrationCatalogueRoot').dataset.state,
    authority: document.getElementById('integrationAuthority').textContent,
    retell: document.getElementById('integration-provider-retell-status').textContent.trim(),
    retellState: document.getElementById('integration-provider-retell-status').dataset.status,
    voice: document.getElementById('integration-provider-voice-status').textContent.trim(),
    voiceState: document.getElementById('integration-provider-voice-status').dataset.status,
    jobber: document.getElementById('integration-provider-jobber-status').textContent.trim(),
    jobberState: document.getElementById('integration-provider-jobber-status').dataset.status,
    stripe: document.getElementById('integration-provider-stripe-status').textContent.trim(),
    stripeState: document.getElementById('integration-provider-stripe-status').dataset.status,
    categoryKeys: Array.from(document.querySelectorAll('[data-category-key]'), node => node.dataset.categoryKey),
    providerKeys: Array.from(document.querySelectorAll('[data-provider-key]'), node => node.dataset.providerKey),
    detailCount: document.querySelectorAll('.integration-details').length,
    providerActions: document.querySelectorAll('[data-provider-key] button,[data-provider-key] a[href],form').length,
    modalCount: document.querySelectorAll('.modal-overlay,#connectModal').length,
    inputCount: document.querySelectorAll('main input').length,
    injectedNodes: document.querySelectorAll('#integrationCatalogueRoot img,#integrationCatalogueRoot script,#integrationCatalogueRoot svg').length,
    xss: window.__integrationXss,
    poisonVisible: /LEGACY STRIPE MUST NOT CONNECT|legacy-calendar|onerror=/.test(document.body.textContent),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
}

function assertIntegrationSnapshot(value, label) {
  assert.strictEqual(value.state, 'ready', label + ': status is ready');
  assert.match(value.authority, /northstar_integration_catalogue_v1/i, label + ': catalogue authority is explicit');
  assert.deepStrictEqual([value.retellState, value.retell], ['connected', 'Connected'], label + ': Retell reflects canonical active ownership');
  assert.deepStrictEqual([value.voiceState, value.voice], ['disconnected', 'Disconnected'], label + ': voice reflects explicit canonical inactivity');
  assert.deepStrictEqual([value.jobberState, value.jobber], ['coming_soon', 'Coming soon'], label + ': source-disabled Jobber is not presented as connected or disconnected');
  assert.deepStrictEqual([value.stripeState, value.stripe], ['requires_provider_approval', 'Requires provider approval'], label + ': subscription is not provider connection authority');
  assert.deepStrictEqual(value.categoryKeys, EXPECTED_CATEGORIES, label + ': exact stable category order');
  assert.deepStrictEqual(value.providerKeys, EXPECTED_PROVIDERS, label + ': exact stable provider order');
  assert.strictEqual(value.detailCount, EXPECTED_PROVIDERS.length, label + ': every provider exposes read-only authority detail');
  assert.strictEqual(value.providerActions, 0, label + ': provider cards expose no actions or forms');
  assert.strictEqual(value.modalCount, 0, label + ': decorative connection modal is retired');
  assert.strictEqual(value.inputCount, 0, label + ': no credentials or decorative values are collected');
  assert.strictEqual(value.injectedNodes, 0, label + ': legacy profile markup is not rendered');
  assert.strictEqual(value.xss, 0, label + ': no legacy markup executes');
  assert.strictEqual(value.poisonVisible, false, label + ': legacy profile flags are not status input');
  assert.strictEqual(value.overflow, false, label + ': no responsive overflow');
}

async function activeFocus(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    return {
      id: active && active.id ? active.id : '',
      hidden: Boolean(active && (active.hidden || active.closest('[hidden]'))),
      focusVisible: Boolean(active && active.matches(':focus-visible')),
    };
  });
}

async function exerciseCell(browser, origin, session, input, ledger) {
  const context = await contextFor(browser, origin, session, input, ledger);
  const page = await context.newPage();
  attachPage(page, ledger, input.role);
  await page.goto(origin + '/dashboard/integrations', { waitUntil: 'domcontentloaded' });
  await waitForReady(page);
  assertIntegrationSnapshot(await integrationSnapshot(page), input.role + '/initial');
  assert.notStrictEqual((await activeFocus(page)).id, 'integrationCatalogueHeading', input.role + ': initial load does not steal focus');

  await page.locator('#refreshIntegrationsBtn').focus();
  await page.evaluate(() => window.NorthStarIntegrations.reload());
  await waitForReady(page);
  assertIntegrationSnapshot(await integrationSnapshot(page), input.role + '/rerender');
  assert.notStrictEqual((await activeFocus(page)).id, 'integrationCatalogueHeading', input.role + ': programmatic rerender does not redirect focus to results');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForReady(page);
  assertIntegrationSnapshot(await integrationSnapshot(page), input.role + '/reload');
  assert.notStrictEqual((await activeFocus(page)).id, 'integrationCatalogueHeading', input.role + ': reload does not steal focus');

  await page.locator('#refreshIntegrationsBtn').focus();
  assert.strictEqual(await page.locator('#refreshIntegrationsBtn').evaluate(node => document.activeElement === node), true);
  await page.keyboard.press('Enter');
  await waitForReady(page);
  assert.notStrictEqual((await activeFocus(page)).id, 'integrationCatalogueHeading', input.role + ': keyboard refresh does not redirect focus to results');
  const firstDetails = page.locator('.integration-details').first();
  await firstDetails.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert.strictEqual(await firstDetails.evaluate(node => node.open), true, input.role + ': provider detail expands from the keyboard');
  if (input.viewport.width <= 500) {
    await page.locator('#navHamburgerBtn').focus();
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.locator('#mobileMenu').evaluate(node => node.classList.contains('open')), true);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('#mobileMenu').evaluate(node => node.classList.contains('open')), false);
  }
  await context.close();
}

async function exerciseRetryFocusCell(browser, origin, session, input, ledger) {
  const failure = { status: 503, body: { success: false, error: { code: 'CANONICAL_PERSISTENCE_UNAVAILABLE' } } };
  const context = await contextFor(browser, origin, session, {
    ...input,
    catalogueResponses: [
      failure, 'continue', 'continue', 'continue', failure, 'continue',
      failure, 'continue', failure, 'continue', failure, failure,
    ],
  }, ledger);
  const page = await context.newPage();
  attachPage(page, ledger, input.role);
  await page.goto(origin + '/dashboard/integrations', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('integrationCatalogueRoot')?.dataset.state === 'error');
  assert.notStrictEqual((await activeFocus(page)).id, 'integrationCatalogueHeading', input.role + ': initial failure does not focus results');

  await page.locator('#retryIntegrationsBtn').focus();
  await page.keyboard.press(input.activationKey);
  await waitForReady(page);
  const keyboardRecoveryFocus = await activeFocus(page);
  assert.deepStrictEqual(keyboardRecoveryFocus, {
    id: 'integrationCatalogueHeading', hidden: false, focusVisible: true,
  }, input.role + ': keyboard retry success moves focus to visible catalogue results');
  assertIntegrationSnapshot(await integrationSnapshot(page), input.role + '/keyboard-recovery');

  await page.locator('#refreshIntegrationsBtn').focus();
  await page.evaluate(() => window.NorthStarIntegrations.reload());
  await waitForReady(page);
  assert.notStrictEqual((await activeFocus(page)).id, 'integrationCatalogueHeading', input.role + ': rerender does not reuse retry focus intent');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForReady(page);
  assert.notStrictEqual((await activeFocus(page)).id, 'integrationCatalogueHeading', input.role + ': reload does not reuse retry focus intent');

  await page.evaluate(() => window.NorthStarIntegrations.reload());
  await page.waitForFunction(() => document.getElementById('integrationCatalogueRoot')?.dataset.state === 'error');
  await page.locator('#retryIntegrationsBtn').click();
  await waitForReady(page);
  assert.notStrictEqual((await activeFocus(page)).id, 'integrationCatalogueHeading', input.role + ': mouse retry does not steal focus');

  await page.evaluate(() => window.NorthStarIntegrations.reload());
  await page.waitForFunction(() => document.getElementById('integrationCatalogueRoot')?.dataset.state === 'error');
  await page.locator('#retryIntegrationsBtn').focus();
  const focusedSyntheticEvent = await page.evaluate(() => new Promise((resolve) => {
    const retryButton = document.getElementById('retryIntegrationsBtn');
    retryButton.addEventListener('click', (event) => {
      resolve({ isTrusted: event.isTrusted, detail: event.detail });
    }, { once: true });
    retryButton.click();
  }));
  assert.deepStrictEqual(focusedSyntheticEvent, { isTrusted: false, detail: 0 }, input.role + ': programmatic click is untrusted even when Retry has focus');
  await waitForReady(page);
  assert.notStrictEqual((await activeFocus(page)).id, 'integrationCatalogueHeading', input.role + ': focused programmatic retry does not impersonate keyboard focus intent');

  await page.evaluate(() => window.NorthStarIntegrations.reload());
  await page.waitForFunction(() => document.getElementById('integrationCatalogueRoot')?.dataset.state === 'error');
  await page.locator('#mainContent').focus();
  const outsideSyntheticEvent = await page.evaluate(() => new Promise((resolve) => {
    const retryButton = document.getElementById('retryIntegrationsBtn');
    retryButton.addEventListener('click', (event) => {
      resolve({ isTrusted: event.isTrusted, detail: event.detail });
    }, { once: true });
    retryButton.click();
  }));
  assert.deepStrictEqual(outsideSyntheticEvent, { isTrusted: false, detail: 0 }, input.role + ': outside-focus programmatic click remains untrusted');
  await waitForReady(page);
  assert.strictEqual((await activeFocus(page)).id, 'mainContent', input.role + ': outside-focus programmatic retry preserves unrelated visible focus');

  await page.evaluate(() => window.NorthStarIntegrations.reload());
  await page.waitForFunction(() => document.getElementById('integrationCatalogueRoot')?.dataset.state === 'error');
  await page.locator('#retryIntegrationsBtn').focus();
  await page.keyboard.press(input.activationKey);
  await page.waitForFunction(() => (
    document.getElementById('integrationCatalogueRoot')?.dataset.state === 'error' &&
    document.getElementById('integrationCatalogueRoot')?.getAttribute('aria-busy') === 'false'
  ));
  const failedRetryFocus = await activeFocus(page);
  assert.strictEqual(failedRetryFocus.id, 'integrationErrorState', input.role + ': failed retry retains the established error-panel focus');
  assert.strictEqual(failedRetryFocus.hidden, false, input.role + ': failed retry focus remains visible');
  assert.notStrictEqual(failedRetryFocus.id, 'integrationCatalogueHeading', input.role + ': failed retry never focuses results');
  await context.close();
}

async function exerciseCatalogueStates(browser, origin, session, ledger) {
  const loadingContext = await contextFor(browser, origin, session, {
    role: 'owner-loading', viewport: { width: 390, height: 844 }, theme: 'dark', delayCatalogueMs: 180,
  }, ledger);
  const loadingPage = await loadingContext.newPage();
  attachPage(loadingPage, ledger, 'owner-loading');
  await loadingPage.goto(origin + '/dashboard/integrations', { waitUntil: 'domcontentloaded' });
  assert.strictEqual(await loadingPage.getAttribute('#integrationCatalogueRoot', 'data-state'), 'loading');
  assert.strictEqual(await loadingPage.getAttribute('#integrationCatalogueRoot', 'aria-busy'), 'true');
  assert.strictEqual(await loadingPage.locator('.integration-loading-card').count(), 3, 'loading skeleton is visible');
  await waitForReady(loadingPage);
  await loadingContext.close();

  const emptyResponse = {
    status: 200,
    body: {
      success: true,
      data: { authority: 'northstar_integration_catalogue_v1', version: 1, readOnly: true, categories: [] },
      requestId: 'browser-empty',
    },
  };
  const emptyContext = await contextFor(browser, origin, session, {
    role: 'owner-empty', viewport: { width: 1280, height: 900 }, theme: 'light', catalogueResponses: [emptyResponse],
  }, ledger);
  const emptyPage = await emptyContext.newPage();
  attachPage(emptyPage, ledger, 'owner-empty');
  await emptyPage.goto(origin + '/dashboard/integrations', { waitUntil: 'domcontentloaded' });
  await emptyPage.waitForFunction(() => document.getElementById('integrationCatalogueRoot')?.dataset.state === 'empty');
  assert.strictEqual(await emptyPage.locator('#integrationEmptyState').isVisible(), true, 'bounded empty state is visible');
  assert.match(await emptyPage.textContent('#integrationStatusMessage'), /catalogue is empty/i);
  await emptyContext.close();

  const failure = { status: 503, body: { success: false, error: { code: 'CANONICAL_PERSISTENCE_UNAVAILABLE' } } };
  const errorContext = await contextFor(browser, origin, session, {
    role: 'owner-error-retry', viewport: { width: 390, height: 844 }, theme: 'light',
    catalogueResponses: [failure, 'continue'],
  }, ledger);
  const errorPage = await errorContext.newPage();
  attachPage(errorPage, ledger, 'owner-error-retry');
  await errorPage.goto(origin + '/dashboard/integrations', { waitUntil: 'domcontentloaded' });
  await errorPage.waitForFunction(() => document.getElementById('integrationCatalogueRoot')?.dataset.state === 'error');
  assert.strictEqual(await errorPage.locator('#integrationErrorState').isVisible(), true, 'fail-closed error state is visible');
  assert.match(await errorPage.textContent('#integrationStatusMessage'), /No connection status was inferred/i);
  await errorPage.locator('#retryIntegrationsBtn').focus();
  await errorPage.keyboard.press('Enter');
  await waitForReady(errorPage);
  assertIntegrationSnapshot(await integrationSnapshot(errorPage), 'owner/error-recovery');
  await errorContext.close();
}

async function inspectBusinessProfile(browser, origin, ownerSession, viewerSession, pool, ledger) {
  const ownerContext = await contextFor(browser, origin, ownerSession, {
    role: 'owner-profile', viewport: { width: 1280, height: 900 }, theme: 'light',
  }, ledger);
  const ownerPage = await ownerContext.newPage();
  attachPage(ownerPage, ledger, 'owner-profile');
  await ownerPage.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
  await ownerPage.waitForFunction(() => document.getElementById('company-name').value === 'Integration Presentation A');
  await ownerPage.click('[data-section="integrations"]');
  const presentation = await ownerPage.evaluate(() => ({
    controls: document.querySelectorAll('#section-integrations [id^="int-"],#section-integrations input').length,
    link: document.getElementById('canonicalIntegrationsLink').getAttribute('href'),
    note: document.getElementById('legacyIntegrationsAuthority').textContent,
    integrations: collectProfile().integrations,
    xss: window.__integrationXss,
  }));
  assert.strictEqual(presentation.controls, 0, 'Business Profile decorative integration controls are retired');
  assert.strictEqual(presentation.link, '/dashboard/integrations', 'Business Profile links to canonical presentation');
  assert.match(presentation.note, /preserved.*ignored|ignored.*preserved/i, 'legacy raw bytes are preserved but non-authoritative');
  assert.deepStrictEqual(presentation.integrations, LEGACY_INTEGRATIONS, 'collectProfile preserves legacy bytes without rewriting them');
  assert.strictEqual(presentation.xss, 0);

  await ownerContext.close();

  const stored = await pool.query(
    `SELECT raw_profile -> 'integrations' AS integrations
       FROM canonical_business_profiles
      WHERE organization_id = $1 AND is_active = TRUE`,
    [ORG_A]
  );
  assert.deepStrictEqual(stored.rows, [{ integrations: LEGACY_INTEGRATIONS }], 'raw PostgreSQL integration bytes remain exact JSON values');

  const viewerContext = await contextFor(browser, origin, viewerSession, {
    role: 'viewer-profile', viewport: { width: 390, height: 844 }, theme: 'dark',
  }, ledger);
  const viewerPage = await viewerContext.newPage();
  attachPage(viewerPage, ledger, 'viewer-profile');
  await viewerPage.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
  await viewerPage.waitForFunction(() => document.getElementById('company-name').value === 'Integration Presentation A');
  await viewerPage.click('[data-section="integrations"]');
  assert.strictEqual(await viewerPage.locator('#canonicalIntegrationsLink').getAttribute('href'), '/dashboard/integrations');
  assert.strictEqual(await viewerPage.locator('#saveBtn').isDisabled(), true, 'viewer remains read only');
  await viewerContext.close();
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
  const suiteDatabase = await createSuiteDatabase('m20-part2h-integrations-' + selected);
  let db;
  let server;
  let browser;
  const ledger = { requests: [], providers: [], external: [], consoleErrors: [], pageErrors: [] };
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    ]) delete process.env[name];

    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL must initialize');
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1,'Integration Presentation A','integration-presentation-a@example.test'),
        ($2,'Integration Presentation B','integration-presentation-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, userId + '@m20-part2h.test', role]
      );
    }
    const { putBusinessProfile, bindIntegrationOwner } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, profile: profileFor('Integration Presentation A') });
    const otherProfile = await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, profile: profileFor('Integration Presentation B') });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_A, userId: OWNER_A, provider: 'retell',
      externalIntegrationId: 'browser-private-retell-a', metadata: { privateMarker: 'BROWSER PRIVATE A' },
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_A, userId: OWNER_A, provider: 'voice', status: 'inactive',
      externalIntegrationId: 'browser-private-voice-a', metadata: { privateMarker: 'BROWSER PRIVATE VOICE' },
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_B, userId: OWNER_B, provider: 'retell',
      externalIntegrationId: 'browser-private-retell-b', metadata: { privateMarker: 'BROWSER PRIVATE B' },
    });

    const sessions = {};
    for (const [role, userId] of [
      ['owner', OWNER_A], ['admin', ADMIN_A], ['member', MEMBER_A], ['viewer', VIEWER_A],
    ]) {
      sessions[role] = await provisionDurableSession(pool, { userId, organizationId: ORG_A, role });
    }

    const { app } = require('../../src/server');
    const { AssetCatalogueRepository } = require('../../src/assets/repository');
    const { AssetCatalogueService } = require('../../src/assets/service');
    app.locals.assetCatalogueService = new AssetCatalogueService(new AssetCatalogueRepository(pool));
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await browserType.launch(executablePath ? { executablePath } : {});
    const authorityDigestBefore = await authorityDigest(pool);

    const viewports = [
      { label: 'desktop', width: 1280, height: 900 },
      { label: 'mobile', width: 390, height: 844 },
    ];
    const themes = ['light', 'dark'];
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      for (const viewport of viewports) {
        for (const theme of themes) {
          await exerciseCell(browser, origin, sessions[role], {
            role, viewport: { width: viewport.width, height: viewport.height }, theme,
          }, ledger);
        }
      }
    }

    for (const role of ['owner', 'member']) {
      for (const viewport of viewports) {
        for (const theme of themes) {
          await exerciseRetryFocusCell(browser, origin, sessions[role], {
            role: role + '-focus-' + viewport.label + '-' + theme,
            viewport: { width: viewport.width, height: viewport.height },
            theme,
            activationKey: (viewport.label === 'desktop') === (theme === 'light') ? 'Enter' : 'Space',
          }, ledger);
        }
      }
    }

    await exerciseCatalogueStates(browser, origin, sessions.owner, ledger);
    await inspectBusinessProfile(browser, origin, sessions.owner, sessions.viewer, pool, ledger);
    assert.strictEqual((await pool.query(
      'SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B]
    )).rows[0].id, otherProfile.id, 'other tenant profile is unchanged');
    assert.deepStrictEqual(ledger.providers, [], 'provider requests remain zero');
    assert.deepStrictEqual(ledger.external, [], 'unexpected external requests remain zero');
    assert.strictEqual(ledger.pageErrors.length, 0, ledger.pageErrors.join('\n'));
    const expectedConsoleErrors = ledger.consoleErrors.filter(entry => (
      (entry.startsWith('owner-error-retry:') || /(?:owner|member)-focus-(?:desktop|mobile)-(?:light|dark):/.test(entry)) &&
      entry.includes('503')
    ));
    const unexpectedConsoleErrors = ledger.consoleErrors.filter(entry => !expectedConsoleErrors.includes(entry));
    assert.strictEqual(unexpectedConsoleErrors.length, 0, unexpectedConsoleErrors.join('\n'));
    assert.ok(ledger.requests.filter(entry => entry.path === '/api/v1/integrations/catalogue').length >= 16 * 4,
      'every lifecycle consumes only the mounted catalogue route');
    assert.strictEqual(ledger.requests.filter(entry => entry.path === '/api/v1/integrations/status').length, 0,
      'catalogue page never consumes the legacy status route');
    assert.strictEqual(ledger.requests.filter(entry => entry.path === '/api/integrations/jobber/status').length, 0,
      'catalogue page never consumes a provider-specific route');
    assert.ok(ledger.requests.filter(entry => entry.path.includes('/integrations') && entry.method !== 'GET').length === 0,
      'Integrations page performs no mutation');
    assert.ok(ledger.requests.every(entry => entry.authorization === null), 'browser never sends bearer authorization');
    assert.strictEqual(await authorityDigest(pool), authorityDigestBefore, 'browser catalogue reads preserve exact persisted authority bytes');

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      version: browser.version(),
      database: suiteDatabase.databaseName,
      roles: ['owner', 'admin', 'member', 'viewer'],
      viewports: viewports.map(value => value.label),
      themes,
      cartesianCombinations: 16,
      lifecycle: ['initial', 'rerender', 'reload'],
      states: ['loading', 'ready', 'empty', 'error', 'retry'],
      integrationPageWrites: 0,
      businessProfileWrites: 0,
      providerRequests: ledger.providers.length,
      providerActions: 0,
      rawPostgresLegacyIntegrationValues: 'exact',
      tenantIsolation: 'exact',
      xssExecutions: 0,
      expectedAuthorityConsoleErrors: expectedConsoleErrors.length,
      unexpectedConsoleErrors: unexpectedConsoleErrors.length,
      pageErrors: ledger.pageErrors.length,
      physicalSafari: false,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db && db.getPool()) await db.getPool().end();
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await suiteDatabase.cleanup();
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
