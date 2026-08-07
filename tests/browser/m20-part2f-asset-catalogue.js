'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ORG_A = '85000000-0000-4000-8000-000000000001';
const ORG_B = '85000000-0000-4000-8000-000000000002';
const OWNER_A = '86000000-0000-4000-8000-000000000001';
const ADMIN_A = '86000000-0000-4000-8000-000000000002';
const VIEWER_A = '86000000-0000-4000-8000-000000000003';
const OWNER_B = '86000000-0000-4000-8000-000000000004';
const RAW_NAME = '  Mini <img src=x onerror=window.__assetXss++> Excavator 🧰  ';
const RAW_UPDATED_NAME = '  Updated </textarea><svg onload=window.__assetXss++> 🌌  ';
const RAW_REFERENCE = '  EQ-42 <A&B>  ';
const RAW_MANUFACTURER = '  Acme é  ';
const RAW_MODEL = '  X-200 <script>window.__assetXss++</script>  ';
const RAW_CONFIGURATION = '\n  Cab + thumb </textarea><svg onload=window.__assetXss++> 🌌  \n';
const RAW_SERIAL = '  SERIAL-<img src=x onerror=window.__assetXss++>  ';
const RAW_VIN = '  VIN-🌌-RAW  ';

function profileFor(name, officeId, serviceId) {
  const profile = canonicalFenceProfile({ companyName: name, serviceName: name + ' primary service' });
  profile.services[0].id = serviceId;
  profile.headquarters = {
    street: '', city: '', state: '', zip: '', country: 'US', latitude: null, longitude: null,
    additionalOffices: [{
      id: officeId, name: name + ' office', street: '', city: '', state: '', zip: '', country: 'US',
      latitude: null, longitude: null,
    }],
  };
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

async function contextFor(browser, origin, session, viewport, theme, ledger, role) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(selectedTheme => {
    window.__assetXss = 0;
    localStorage.setItem('northstar-theme', selectedTheme);
  }, theme);
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    ledger.external.push({ role, method: route.request().method(), url: route.request().url() });
    return route.fulfill({ status: 204, body: '' });
  });
  context.on('request', request => {
    const url = new URL(request.url());
    ledger.requests.push({
      role, method: request.method(), path: url.pathname, origin: url.origin,
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

async function openAssets(page, origin) {
  await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    document.documentElement.getAttribute('data-asset-catalogue-state') === 'ready' &&
    document.documentElement.getAttribute('data-northstar-navigation') === 'ready',
  null, { timeout: 15000 });
  await page.click('[data-section="vehicles"]');
  await page.waitForFunction(() => document.getElementById('section-vehicles').classList.contains('active'));
}

async function snapshot(page) {
  return page.evaluate(() => ({
    state: document.documentElement.getAttribute('data-asset-catalogue-state'),
    navigation: document.documentElement.getAttribute('data-northstar-navigation'),
    theme: document.documentElement.getAttribute('data-theme'),
    xss: window.__assetXss,
    injectedImages: document.querySelectorAll('#assetCatalogueContainer img').length,
    injectedScripts: document.querySelectorAll('#assetCatalogueContainer script').length,
    names: Array.from(document.querySelectorAll('#assetCatalogueContainer .asset-name')).map(node => node.value),
    references: Array.from(document.querySelectorAll('#assetCatalogueContainer .asset-internal-reference')).map(node => node.value),
    configurations: Array.from(document.querySelectorAll('#assetCatalogueContainer .asset-configuration')).map(node => node.value),
    addHidden: document.getElementById('addAssetButton').hidden,
    enabledControls: Array.from(document.querySelectorAll('#assetCatalogueContainer input,#assetCatalogueContainer select,#assetCatalogueContainer textarea,#assetCatalogueContainer button'))
      .filter(control => !control.disabled).length,
    duplicateIds: Array.from(document.querySelectorAll('[id]')).map(node => node.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    activeBusinessProfileLinks: document.querySelectorAll('[data-nav-id="business-profile"][aria-current="page"]').length,
    catalogueNote: document.getElementById('assetCatalogueAuthority').textContent,
  }));
}

function assertSnapshot(value, input) {
  assert.strictEqual(value.state, 'ready', input.role + ' catalogue ready');
  assert.strictEqual(value.navigation, 'ready', input.role + ' navigation ready');
  assert.strictEqual(value.theme, input.theme, input.role + ' theme retained');
  assert.strictEqual(value.xss, 0, input.role + ' persisted values execute zero times');
  assert.strictEqual(value.injectedImages, 0, input.role + ' creates no injected image nodes');
  assert.strictEqual(value.injectedScripts, 0, input.role + ' creates no injected script nodes');
  assert.ok(value.names.includes(RAW_UPDATED_NAME), input.role + ' exact updated name rendered');
  assert.ok(value.references.includes(RAW_REFERENCE), input.role + ' exact internal reference rendered');
  assert.ok(value.configurations.includes(RAW_CONFIGURATION), input.role + ' exact configuration rendered');
  assert.deepStrictEqual(value.duplicateIds, [], input.role + ' has no duplicate ids');
  assert.ok(value.scrollWidth - value.clientWidth <= 1, input.role + ' has no horizontal overflow');
  assert.strictEqual(value.activeBusinessProfileLinks, 2, input.role + ' canonical navigation active');
  assert.ok(value.catalogueNote.includes('PostgreSQL'), input.role + ' authority is explicit');
  if (input.canManage) {
    assert.strictEqual(value.addHidden, false, input.role + ' can add catalogue identity');
    assert.ok(value.enabledControls > 0, input.role + ' has enabled catalogue controls');
  } else {
    assert.strictEqual(value.addHidden, true, input.role + ' add control hidden');
    assert.strictEqual(value.enabledControls, 0, input.role + ' catalogue is read-only');
  }
}

async function lifecycle(browser, origin, session, input, ledger) {
  const context = await contextFor(browser, origin, session, input.viewport, input.theme, ledger, input.role);
  const page = await context.newPage();
  attachPage(page, ledger, input.role);
  await openAssets(page, origin);
  assertSnapshot(await snapshot(page), input);
  await page.evaluate(() => window.NorthStarAssetCatalogue.reload());
  await page.waitForFunction(() => document.documentElement.getAttribute('data-asset-catalogue-state') === 'ready');
  assertSnapshot(await snapshot(page), { ...input, role: input.role + '-rerender' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    document.documentElement.getAttribute('data-asset-catalogue-state') === 'ready' &&
    document.documentElement.getAttribute('data-northstar-navigation') === 'ready');
  await page.click('[data-section="vehicles"]');
  assertSnapshot(await snapshot(page), { ...input, role: input.role + '-reload' });
  if (input.viewport.width <= 500) {
    await page.locator('#navHamburgerBtn').focus();
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'navHamburgerBtn');
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.locator('#mobileMenu').evaluate(node => node.classList.contains('open')), true);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('#mobileMenu').evaluate(node => node.classList.contains('open')), false);
  } else {
    const target = input.canManage ? page.locator('.bp-asset-card .asset-name').first() : page.locator('.bp-nav-btn').first();
    await target.focus();
    assert.strictEqual(await target.evaluate(node => document.activeElement === node), true);
  }
  await context.close();
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
  const suiteDatabase = await createSuiteDatabase('m20-2f-assets-' + selected);
  let db;
  let server;
  let browser;
  const ledger = { requests: [], external: [], consoleErrors: [], pageErrors: [] };
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
        ($1,'M20 Asset A','m20-asset-a@example.test'),
        ($2,'M20 Asset B','m20-asset-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, name, role] of [
      [OWNER_A, ORG_A, 'Owner A', 'owner'],
      [ADMIN_A, ORG_A, 'Admin A', 'admin'],
      [VIEWER_A, ORG_A, 'Viewer A', 'viewer'],
      [OWNER_B, ORG_B, 'Owner B', 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, name, userId + '@m20-assets.test', role]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A,
      profile: profileFor('Asset A', 'Office-North', 'Fence-Repair'),
    });
    const otherProfile = await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B,
      profile: profileFor('Asset B', 'Office-Other', 'Other-Service'),
    });
    const profileBefore = (await pool.query(
      `SELECT id, version_label, normalized_profile_hash, raw_profile
         FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];
    const ownerSession = await provisionDurableSession(pool, { userId: OWNER_A, organizationId: ORG_A, role: 'owner' });
    const adminSession = await provisionDurableSession(pool, { userId: ADMIN_A, organizationId: ORG_A, role: 'admin' });
    const viewerSession = await provisionDurableSession(pool, { userId: VIEWER_A, organizationId: ORG_A, role: 'viewer' });
    await provisionDurableSession(pool, { userId: OWNER_B, organizationId: ORG_B, role: 'owner' });

    const { AssetCatalogueRepository } = require('../../src/assets/repository');
    const { AssetCatalogueService } = require('../../src/assets/service');
    const { app } = require('../../src/server');
    app.locals.assetCatalogueService = new AssetCatalogueService(new AssetCatalogueRepository(pool));
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await browserType.launch({ headless: true, executablePath });

    const ownerContext = await contextFor(
      browser, origin, ownerSession, { width: 1280, height: 900 }, 'light', ledger, 'owner-write'
    );
    const ownerPage = await ownerContext.newPage();
    attachPage(ownerPage, ledger, 'owner-write');
    await openAssets(ownerPage, origin);
    await ownerPage.click('#addAssetButton');
    const newCard = ownerPage.locator('.bp-asset-card[data-new="true"]');
    await newCard.locator('.asset-category').selectOption('equipment');
    await newCard.locator('.asset-name').fill(RAW_NAME);
    await newCard.locator('.asset-internal-reference').fill(RAW_REFERENCE);
    await newCard.locator('.asset-manufacturer').fill(RAW_MANUFACTURER);
    await newCard.locator('.asset-model').fill(RAW_MODEL);
    await newCard.locator('.asset-model-year').fill('2024');
    await newCard.locator('.asset-configuration').fill(RAW_CONFIGURATION);
    await newCard.locator('.asset-serial-number').fill(RAW_SERIAL);
    await newCard.locator('.asset-vin').fill(RAW_VIN);
    await newCard.locator('.asset-home-location').selectOption('Office-North');
    await newCard.locator('.asset-service-capabilities input[value="Fence-Repair"]').check();
    const createResponse = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/assets' && response.request().method() === 'POST'
    );
    await newCard.getByRole('button', { name: 'Save asset' }).click();
    assert.strictEqual((await createResponse).status(), 201, 'owner creates normalized asset identity');
    await ownerPage.waitForFunction(name =>
      Array.from(document.querySelectorAll('.bp-asset-card .asset-name')).some(node => node.value === name), RAW_NAME);
    const assetRow = (await pool.query(
      'SELECT id FROM tenant_assets WHERE organization_id = $1 AND internal_reference = $2',
      [ORG_A, RAW_REFERENCE]
    )).rows[0];
    assert.ok(assetRow && assetRow.id, 'created asset is durable');

    const archiveCard = ownerPage.locator('.bp-asset-card[data-asset-id="' + assetRow.id + '"]');
    const archiveResponse = ownerPage.waitForResponse(response =>
      response.url().endsWith('/api/assets/' + assetRow.id + '/catalogue-state') && response.request().method() === 'PATCH'
    );
    await archiveCard.getByRole('button', { name: 'Archive asset' }).click();
    assert.strictEqual((await archiveResponse).status(), 200, 'owner archives identity without deletion');
    const restoredCard = ownerPage.locator('.bp-asset-card[data-asset-id="' + assetRow.id + '"]');
    const restoreResponse = ownerPage.waitForResponse(response =>
      response.url().endsWith('/api/assets/' + assetRow.id + '/catalogue-state') && response.request().method() === 'PATCH'
    );
    await restoredCard.getByRole('button', { name: 'Restore asset' }).click();
    assert.strictEqual((await restoreResponse).status(), 200, 'owner restores catalogue identity');
    await ownerContext.close();

    const adminContext = await contextFor(
      browser, origin, adminSession, { width: 1280, height: 900 }, 'dark', ledger, 'admin-write'
    );
    const adminPage = await adminContext.newPage();
    attachPage(adminPage, ledger, 'admin-write');
    await openAssets(adminPage, origin);
    const adminCard = adminPage.locator('.bp-asset-card[data-asset-id="' + assetRow.id + '"]');
    await adminCard.locator('.asset-name').fill(RAW_UPDATED_NAME);
    const updateResponse = adminPage.waitForResponse(response =>
      response.url().endsWith('/api/assets/' + assetRow.id) && response.request().method() === 'PUT'
    );
    await adminCard.getByRole('button', { name: 'Save asset' }).click();
    assert.strictEqual((await updateResponse).status(), 200, 'admin updates normalized asset identity');
    await adminPage.waitForFunction(name =>
      Array.from(document.querySelectorAll('.bp-asset-card .asset-name')).some(node => node.value === name), RAW_UPDATED_NAME);
    await adminContext.close();

    const sessions = { owner: ownerSession, admin: adminSession, viewer: viewerSession };
    const viewports = [
      { name: 'desktop', value: { width: 1280, height: 900 } },
      { name: 'mobile', value: { width: 390, height: 844 } },
    ];
    for (const role of ['owner', 'admin', 'viewer']) {
      for (const viewport of viewports) {
        for (const theme of ['light', 'dark']) {
          await lifecycle(browser, origin, sessions[role], {
            role: role + '-' + viewport.name + '-' + theme,
            viewport: viewport.value,
            theme,
            canManage: role !== 'viewer',
          }, ledger);
        }
      }
    }

    const raw = await pool.query(
      `SELECT encode(convert_to(name, 'UTF8'), 'hex') AS name_hex,
              encode(convert_to(internal_reference, 'UTF8'), 'hex') AS reference_hex,
              encode(convert_to(manufacturer, 'UTF8'), 'hex') AS manufacturer_hex,
              encode(convert_to(model, 'UTF8'), 'hex') AS model_hex,
              encode(convert_to(configuration, 'UTF8'), 'hex') AS configuration_hex,
              encode(convert_to(serial_number, 'UTF8'), 'hex') AS serial_hex,
              encode(convert_to(vin, 'UTF8'), 'hex') AS vin_hex,
              home_location_id, catalogue_state, version
         FROM tenant_assets WHERE organization_id = $1 AND id = $2`,
      [ORG_A, assetRow.id]
    );
    assert.deepStrictEqual(raw.rows, [{
      name_hex: Buffer.from(RAW_UPDATED_NAME, 'utf8').toString('hex'),
      reference_hex: Buffer.from(RAW_REFERENCE, 'utf8').toString('hex'),
      manufacturer_hex: Buffer.from(RAW_MANUFACTURER, 'utf8').toString('hex'),
      model_hex: Buffer.from(RAW_MODEL, 'utf8').toString('hex'),
      configuration_hex: Buffer.from(RAW_CONFIGURATION, 'utf8').toString('hex'),
      serial_hex: Buffer.from(RAW_SERIAL, 'utf8').toString('hex'),
      vin_hex: Buffer.from(RAW_VIN, 'utf8').toString('hex'),
      home_location_id: 'Office-North', catalogue_state: 'active', version: 4,
    }]);
    const profileAfter = (await pool.query(
      `SELECT id, version_label, normalized_profile_hash, raw_profile
         FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];
    assert.deepStrictEqual(profileAfter, profileBefore, 'asset writes never copy authority into Business Profile JSON');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(profileAfter.raw_profile, 'assets'), false);
    assert.strictEqual((await pool.query(
      'SELECT count(*)::int AS count FROM tenant_assets WHERE organization_id = $1', [ORG_B]
    )).rows[0].count, 0, 'other tenant catalogue unchanged');
    assert.strictEqual((await pool.query(
      'SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B]
    )).rows[0].id, otherProfile.id, 'other tenant Business Profile unchanged');
    assert.deepStrictEqual(ledger.external, [], 'external/provider requests are intercepted and unused');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'no unexpected console errors');
    assert.deepStrictEqual(ledger.pageErrors, [], 'no page errors');
    assert.ok(ledger.requests.every(entry => entry.authorization === null), 'browser sends no Authorization headers');
    assert.strictEqual(ledger.requests.filter(entry => entry.role.startsWith('viewer') &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method)).length, 0, 'viewer writes remain zero');
    const providerPattern = /retell|stripe|twilio|resend|googleapis|maps\.google|api\.openai/i;
    assert.strictEqual(ledger.requests.filter(entry => providerPattern.test(entry.origin)).length, 0);

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      version: browser.version(),
      database: suiteDatabase.databaseName,
      roles: ['owner', 'admin', 'viewer'],
      viewports: ['desktop', 'mobile'],
      themes: ['light', 'dark'],
      cartesianCombinations: 12,
      lifecycle: ['initial', 'rerender', 'reload'],
      ownerWrites: ledger.requests.filter(entry => entry.role === 'owner-write' && ['POST', 'PUT', 'PATCH'].includes(entry.method)).length,
      adminWrites: ledger.requests.filter(entry => entry.role === 'admin-write' && ['POST', 'PUT', 'PATCH'].includes(entry.method)).length,
      viewerWrites: 0,
      providerRequests: ledger.external.length,
      providerActions: 0,
      rawPostgresBytes: 'exact',
      businessProfileCopiedAssetState: false,
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
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
