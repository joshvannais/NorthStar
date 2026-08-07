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
    if (requestUrl.origin === origin) return route.continue();
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
    const root = document.getElementById('integrationStatusRoot');
    return root && root.dataset.state === 'ready';
  }, null, { timeout: 15000 });
}

async function integrationSnapshot(page) {
  return page.evaluate(() => ({
    state: document.getElementById('integrationStatusRoot').dataset.state,
    authority: document.getElementById('integrationAuthority').textContent,
    retell: document.getElementById('canonical-retell-status').textContent.trim(),
    voice: document.getElementById('canonical-voice-status').textContent.trim(),
    jobber: document.getElementById('jobber-status').textContent.trim(),
    jobberDisabled: document.getElementById('jobber-btn').disabled,
    jobberButton: document.getElementById('jobber-btn').textContent.trim(),
    unavailableCards: document.querySelectorAll('[data-connector-availability="unavailable"]').length,
    unavailableActions: document.querySelectorAll('[data-connector-availability="unavailable"] button, [data-connector-availability="unavailable"] input').length,
    modalCount: document.querySelectorAll('.modal-overlay,#connectModal').length,
    inputCount: document.querySelectorAll('main input').length,
    injectedNodes: document.querySelectorAll('#integrationStatusRoot img,#integrationStatusRoot script,#integrationStatusRoot svg').length,
    xss: window.__integrationXss,
    poisonVisible: /LEGACY STRIPE MUST NOT CONNECT|legacy-calendar|onerror=/.test(document.body.textContent),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
}

function assertIntegrationSnapshot(value, label) {
  assert.strictEqual(value.state, 'ready', label + ': status is ready');
  assert.match(value.authority, /canonical_integration_ownership/i, label + ': authority is explicit');
  assert.strictEqual(value.retell, 'Active authority', label + ': Retell reflects canonical active ownership');
  assert.strictEqual(value.voice, 'Inactive', label + ': voice reflects canonical inactive ownership');
  assert.strictEqual(value.jobber, 'Unavailable', label + ': Jobber reflects separate unavailable capability');
  assert.strictEqual(value.jobberDisabled, true, label + ': unavailable Jobber action is disabled');
  assert.strictEqual(value.jobberButton, 'Unavailable', label + ': unavailable Jobber action is truthful');
  assert.ok(value.unavailableCards >= 4, label + ': unowned connectors are explicitly unavailable');
  assert.strictEqual(value.unavailableActions, 0, label + ': unowned connectors expose no simulated actions');
  assert.strictEqual(value.modalCount, 0, label + ': decorative connection modal is retired');
  assert.strictEqual(value.inputCount, 0, label + ': no credentials or decorative values are collected');
  assert.strictEqual(value.injectedNodes, 0, label + ': legacy profile markup is not rendered');
  assert.strictEqual(value.xss, 0, label + ': no legacy markup executes');
  assert.strictEqual(value.poisonVisible, false, label + ': legacy profile flags are not status input');
  assert.strictEqual(value.overflow, false, label + ': no responsive overflow');
}

async function exerciseCell(browser, origin, session, input, ledger) {
  const context = await contextFor(browser, origin, session, input, ledger);
  const page = await context.newPage();
  attachPage(page, ledger, input.role);
  await page.goto(origin + '/dashboard/integrations', { waitUntil: 'domcontentloaded' });
  await waitForReady(page);
  assertIntegrationSnapshot(await integrationSnapshot(page), input.role + '/initial');

  await page.evaluate(() => window.NorthStarIntegrations.reload());
  await waitForReady(page);
  assertIntegrationSnapshot(await integrationSnapshot(page), input.role + '/rerender');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForReady(page);
  assertIntegrationSnapshot(await integrationSnapshot(page), input.role + '/reload');

  await page.locator('#refreshIntegrationsBtn').focus();
  assert.strictEqual(await page.locator('#refreshIntegrationsBtn').evaluate(node => document.activeElement === node), true);
  await page.keyboard.press('Enter');
  await waitForReady(page);
  if (input.viewport.width <= 500) {
    await page.locator('#navHamburgerBtn').focus();
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.locator('#mobileMenu').evaluate(node => node.classList.contains('open')), true);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('#mobileMenu').evaluate(node => node.classList.contains('open')), false);
  }
  await context.close();
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

  await ownerPage.click('[data-section="company"]');
  await ownerPage.fill('#company-dba', 'Connector status presentation');
  const saveResponse = ownerPage.waitForResponse(response => response.url().endsWith('/api/v1/business-profile') && response.request().method() === 'PUT');
  await ownerPage.click('#saveBtn');
  assert.strictEqual((await saveResponse).status(), 200, 'owner saves another field without rewriting legacy integrations');
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

    await inspectBusinessProfile(browser, origin, sessions.owner, sessions.viewer, pool, ledger);
    assert.strictEqual((await pool.query(
      'SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B]
    )).rows[0].id, otherProfile.id, 'other tenant profile is unchanged');
    assert.deepStrictEqual(ledger.providers, [], 'provider requests remain zero');
    assert.deepStrictEqual(ledger.external, [], 'unexpected external requests remain zero');
    assert.strictEqual(ledger.pageErrors.length, 0, ledger.pageErrors.join('\n'));
    assert.strictEqual(ledger.consoleErrors.length, 0, ledger.consoleErrors.join('\n'));
    assert.ok(ledger.requests.filter(entry => entry.path === '/api/v1/integrations/status').length >= 16 * 3,
      'every lifecycle consumes the mounted canonical status route');
    assert.ok(ledger.requests.filter(entry => entry.path === '/api/integrations/jobber/status').length >= 16 * 3,
      'every lifecycle consumes the separate Jobber status route');
    assert.ok(ledger.requests.filter(entry => entry.path.includes('/integrations') && entry.method !== 'GET').length === 0,
      'Integrations page performs no mutation');
    assert.ok(ledger.requests.every(entry => entry.authorization === null), 'browser never sends bearer authorization');

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      version: browser.version(),
      database: suiteDatabase.databaseName,
      roles: ['owner', 'admin', 'member', 'viewer'],
      viewports: viewports.map(value => value.label),
      themes,
      cartesianCombinations: 16,
      lifecycle: ['initial', 'rerender', 'reload'],
      integrationPageWrites: 0,
      businessProfileWrites: 1,
      providerRequests: ledger.providers.length,
      providerActions: 0,
      rawPostgresLegacyIntegrationValues: 'exact',
      tenantIsolation: 'exact',
      xssExecutions: 0,
      unexpectedConsoleErrors: ledger.consoleErrors.length,
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
