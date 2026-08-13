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
const ORG_A = '75000000-0000-0000-0000-000000000001';
const ORG_B = '75000000-0000-0000-0000-000000000002';
const OWNER_A = '76000000-0000-0000-0000-000000000001';
const VIEWER_A = '76000000-0000-0000-0000-000000000002';
const OWNER_B = '76000000-0000-0000-0000-000000000003';
const INITIAL_NAME = '  Fence <Initial> \u2603  ';
const EDITED_NAME = '  Fence <Edited> \ud83c\udf0c  ';
const EDITED_EQUIPMENT = '  Mini-excavator <A&B>\nTrailer  ';
const EDITED_LABEL = '  Permit <review> "raw"  ';
const NEW_NAME = '  New <Service> e\u0301  ';

function pricing(label) {
  return {
    requiredScope: [],
    allowedScopeValues: { jobType: ['replace', 'install'] },
    rangePercent: 0,
    lineItems: [{ code: 'permit', label, category: 'serviceCharge', type: 'fixed', amount: 0 }],
  };
}

function profileFor(companyName) {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({ companyName });
  profile.company = { ...profile.company, name: companyName };
  profile.services = [{
    ...canonical.services[0],
    id: 'fence',
    name: INITIAL_NAME,
    confidence: 0,
    equipment: '  Initial <equipment>  ',
    legacyNote: '  preserve unknown metadata  ',
    canonicalPricing: pricing('  Initial <label>  '),
  }];
  profile.canonicalPricing = canonical.canonicalPricing;
  profile.canonicalCosts = canonical.canonicalCosts;
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
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function contextFor(browser, origin, session, viewport, externalRequests, theme) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((selectedTheme) => {
    localStorage.setItem('northstar-theme', selectedTheme);
  }, theme);
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    externalRequests.push({ method: route.request().method(), url: route.request().url() });
    return route.fulfill({ status: 204, body: '' });
  });
  return context;
}

async function waitForServices(page, count) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll('#servicesContainer .bp-service-card').length === expected,
    count,
    { timeout: 15000 }
  );
}

async function serviceSnapshot(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.bp-service-card')).map((card) => ({
    id: card.querySelector('.svc-id').value,
    idReadOnly: card.querySelector('.svc-id').readOnly,
    name: card.querySelector('.svc-name').value,
    equipment: card.querySelector('.svc-equipment').value,
    confidence: card.querySelector('.svc-confidence').value,
    pricing: card.querySelector('.svc-pricing').value ? JSON.parse(card.querySelector('.svc-pricing').value) : null,
  })));
}

async function authoritySnapshot(pool, organizationId) {
  const result = await pool.query(
    `SELECT
       id::text AS id,
       organization_id::text AS organization_id,
       version_number::text AS version_number,
       encode(convert_to(version_label, 'UTF8'), 'hex') AS version_label_hex,
       encode(convert_to(raw_profile::text, 'UTF8'), 'hex') AS raw_profile_hex,
       encode(convert_to(COALESCE(raw_profile -> 'services', 'null'::jsonb)::text, 'UTF8'), 'hex') AS services_hex,
       encode(convert_to(normalized_profile::text, 'UTF8'), 'hex') AS normalized_profile_hex,
       normalized_profile_hash,
       is_active::text AS is_active,
       COALESCE(created_by::text, '') AS created_by,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS created_at_utc,
       COALESCE(to_char(retired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '') AS retired_at_utc
     FROM canonical_business_profiles
     WHERE organization_id = $1
     ORDER BY version_number, id`,
    [organizationId]
  );
  const bytes = Buffer.from(JSON.stringify(result.rows), 'utf8');
  return {
    rows: result.rows,
    bytesHex: bytes.toString('hex'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

async function assertViewerSaveDisabled(page, label) {
  const state = await page.locator('#saveBtn').evaluate((button) => ({
    disabled: button.disabled,
    hasDisabledAttribute: button.hasAttribute('disabled'),
    activeElementId: document.activeElement && document.activeElement.id,
    theme: document.documentElement.getAttribute('data-theme'),
  }));
  assert.strictEqual(state.disabled, true, label + ': Save is natively disabled');
  assert.strictEqual(state.hasDisabledAttribute, true, label + ': Save retains its native disabled attribute');
  return state;
}

function roleRequestLedger(requests, origin, role) {
  return requests
    .filter((entry) => entry.role === role && new URL(entry.url).origin === origin)
    .map((entry) => ({ method: entry.method, path: new URL(entry.url).pathname }));
}

async function exerciseViewerSaveGuard({ page, role, theme, requests, origin, pool, organizationId }) {
  const label = role + '/' + theme;
  await page.locator('[data-section="services"]').click();
  await page.locator('.bp-service-card').first().locator('.svc-name').fill('Forbidden viewer edit');
  const beforeAuthority = await authoritySnapshot(pool, organizationId);
  const beforeLedger = roleRequestLedger(requests, origin, role);
  assert.deepStrictEqual(
    beforeLedger.filter((entry) => entry.method !== 'GET'),
    [],
    label + ': automatic viewer requests are GET-only before interaction'
  );
  const save = page.locator('#saveBtn');
  await assertViewerSaveDisabled(page, label + '/before-attempts');

  const box = await save.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, label + ': disabled Save remains visibly present');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await save.press('Enter');
  await save.press('Space');
  await page.waitForTimeout(150);

  await assertViewerSaveDisabled(page, label + '/after-attempts');
  const afterLedger = roleRequestLedger(requests, origin, role);
  assert.deepStrictEqual(
    afterLedger.filter((entry) => entry.method !== 'GET'),
    [],
    label + ': trusted mouse and keyboard attempts emit zero non-GET requests'
  );
  assert.strictEqual(
    afterLedger.filter((entry) => entry.method === 'PUT').length,
    0,
    label + ': trusted mouse and keyboard attempts emit exactly zero PUT requests'
  );
  const afterAuthority = await authoritySnapshot(pool, organizationId);
  assert.deepStrictEqual(afterAuthority, beforeAuthority, label + ': PostgreSQL authority bytes and digest stay exact');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await assertPersistedCatalogue(page);
  assert.strictEqual(
    await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
    theme,
    label + ': theme survives the persistence check reload'
  );
  assert.deepStrictEqual(
    roleRequestLedger(requests, origin, role).filter((entry) => entry.method !== 'GET'),
    [],
    label + ': reload remains GET-only'
  );
  return { authoritySha256: beforeAuthority.sha256, nonGetRequests: 0, putRequests: 0 };
}

async function assertPersistedCatalogue(page) {
  await waitForServices(page, 2);
  await page.waitForFunction((expectedName) => {
    const cards = Array.from(document.querySelectorAll('#servicesContainer .bp-service-card'));
    return cards.length === 2 && cards.every((card) => card.querySelector('.svc-id').readOnly) &&
      cards[0].querySelector('.svc-name').value === expectedName;
  }, EDITED_NAME, { timeout: 15000 });
  const services = await serviceSnapshot(page);
  assert.strictEqual(services[0].id, 'fence');
  assert.strictEqual(services[0].idReadOnly, true);
  assert.strictEqual(services[0].name, EDITED_NAME);
  assert.strictEqual(services[0].equipment, EDITED_EQUIPMENT);
  assert.strictEqual(services[0].confidence, '0');
  assert.deepStrictEqual(services[0].pricing, pricing(EDITED_LABEL));
  assert.ok(/^service-[A-Za-z0-9._:-]+$/.test(services[1].id));
  assert.strictEqual(services[1].idReadOnly, true);
  assert.strictEqual(services[1].name, NEW_NAME);
  assert.strictEqual(services[1].pricing, null);
}

async function verifyLifecycle(browser, origin, session, viewport, role, theme, ledger, externalRequests) {
  const context = await contextFor(browser, origin, session, viewport, externalRequests, theme);
  const page = await context.newPage();
  ledger.attach(page, role);
  await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
  await assertPersistedCatalogue(page);
  assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme,
    role + '/initial uses the selected theme');
  if (role.startsWith('viewer')) await assertViewerSaveDisabled(page, role + '/initial');
  await page.evaluate(() => renderProfile(profileData));
  await assertPersistedCatalogue(page);
  assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme,
    role + '/rerender uses the selected theme');
  if (role.startsWith('viewer')) await assertViewerSaveDisabled(page, role + '/rerender');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await assertPersistedCatalogue(page);
  assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme,
    role + '/reload uses the selected theme');
  if (role.startsWith('viewer')) await assertViewerSaveDisabled(page, role + '/reload');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, role + ' has no horizontal overflow');
  return { context, page, overflow, theme };
}

async function main() {
  const selected = (process.argv.find((value) => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  const { browserType, executablePath } = resolveBrowserRuntime(selected);
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
  const originalRetellKey = process.env.RETELL_API_KEY;
  const suiteDatabase = await createSuiteDatabase('m20-2d-' + selected);
  let db;
  let server;
  let browser;
  const requests = [];
  const externalRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.RETELL_API_KEY = '';
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL must initialize');
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1, 'M20 Services Organization A', 'm20-services-a@test.invalid'),
        ($2, 'M20 Services Organization B', 'm20-services-b@test.invalid')`,
      [ORG_A, ORG_B]
    );
    for (const user of [[OWNER_A, ORG_A, 'owner'], [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner']]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [user[0], user[1], user[0], user[0] + '@m20-services.test', user[2]]
      );
    }
    const { putBusinessProfile, getActiveBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, expectedVersion: null, profile: profileFor('Service Editor A') });
    const originalB = await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, expectedVersion: null, profile: profileFor('Other Tenant') });
    const ownerSession = await provisionDurableSession(pool, { userId: OWNER_A, organizationId: ORG_A, role: 'owner' });
    const viewerSession = await provisionDurableSession(pool, { userId: VIEWER_A, organizationId: ORG_A, role: 'viewer' });
    const { app } = require('../../src/server');
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await browserType.launch({ headless: true, executablePath });

    const ledger = {
      attach(page, role) {
        page.on('request', (entry) => requests.push({
          role, method: entry.method(), url: entry.url(), authorization: entry.headers().authorization || null,
        }));
        page.on('console', (message) => {
          if (message.type() !== 'error') return;
          consoleErrors.push(role + ': ' + message.text());
        });
        page.on('pageerror', (error) => pageErrors.push(role + ': ' + error.message));
      },
    };

    const ownerContext = await contextFor(
      browser, origin, ownerSession, { width: 1280, height: 900 }, externalRequests, 'light'
    );
    const ownerPage = await ownerContext.newPage();
    ledger.attach(ownerPage, 'owner-desktop');
    await ownerPage.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    await waitForServices(ownerPage, 1);
    let initial = await serviceSnapshot(ownerPage);
    assert.strictEqual(initial[0].name, INITIAL_NAME);
    assert.strictEqual(initial[0].id, 'fence');
    assert.strictEqual(initial[0].idReadOnly, true);
    await ownerPage.evaluate(() => renderProfile(profileData));
    initial = await serviceSnapshot(ownerPage);
    assert.strictEqual(initial[0].name, INITIAL_NAME);
    await ownerPage.locator('[data-section="services"]').click();
    await ownerPage.locator('.bp-service-card').first().locator('.svc-name').fill(EDITED_NAME);
    await ownerPage.locator('.bp-service-card').first().locator('.svc-equipment').fill(EDITED_EQUIPMENT);
    await ownerPage.locator('.bp-service-card').first().locator('.svc-confidence').fill('0');
    await ownerPage.locator('.bp-service-card').first().locator('.svc-pricing').fill(JSON.stringify(pricing(EDITED_LABEL), null, 2));
    await ownerPage.locator('#addServiceButton').click();
    await waitForServices(ownerPage, 2);
    const newCard = ownerPage.locator('.bp-service-card').nth(1);
    await newCard.locator('.svc-name').fill(NEW_NAME);
    await newCard.locator('.svc-description').fill('  New raw <description>  ');
    const ownerSave = ownerPage.waitForResponse((response) =>
      response.url() === origin + '/api/v1/business-profile' && response.request().method() === 'PUT'
    );
    await ownerPage.locator('#saveBtn').click();
    assert.strictEqual((await ownerSave).status(), 200, 'owner save must persist');
    await assertPersistedCatalogue(ownerPage);
    await ownerPage.reload({ waitUntil: 'domcontentloaded' });
    await assertPersistedCatalogue(ownerPage);

    const stored = await getActiveBusinessProfile(pool, ORG_A);
    const raw = await pool.query(
      `SELECT
         encode(convert_to(raw_profile #>> '{services,0,name}', 'UTF8'), 'hex') AS name_hex,
         encode(convert_to(raw_profile #>> '{services,0,equipment}', 'UTF8'), 'hex') AS equipment_hex,
         encode(convert_to(raw_profile #>> '{services,0,canonicalPricing,lineItems,0,label}', 'UTF8'), 'hex') AS label_hex,
         raw_profile #>> '{services,0,canonicalPricing,lineItems,0,amount}' AS amount,
         raw_profile #>> '{services,0,confidence}' AS confidence,
         raw_profile #>> '{services,0,legacyNote}' AS legacy_note
       FROM canonical_business_profiles WHERE id = $1`,
      [stored.id]
    );
    assert.deepStrictEqual(raw.rows[0], {
      name_hex: Buffer.from(EDITED_NAME, 'utf8').toString('hex'),
      equipment_hex: Buffer.from(EDITED_EQUIPMENT, 'utf8').toString('hex'),
      label_hex: Buffer.from(EDITED_LABEL, 'utf8').toString('hex'),
      amount: '0', confidence: '0', legacy_note: '  preserve unknown metadata  ',
    });

    const putsBeforeMalformed = requests.filter((entry) => entry.role === 'owner-desktop' && entry.method === 'PUT').length;
    await ownerPage.locator('[data-section="services"]').click();
    await ownerPage.locator('.bp-service-card').first().locator('.svc-pricing').fill('{not json');
    await ownerPage.locator('#saveBtn').click();
    await ownerPage.waitForTimeout(100);
    assert.strictEqual(
      requests.filter((entry) => entry.role === 'owner-desktop' && entry.method === 'PUT').length,
      putsBeforeMalformed,
      'malformed pricing JSON must be blocked before transmission'
    );
    assert.strictEqual(await ownerPage.locator('#serviceCatalogError').isVisible(), true);
    assert.strictEqual((await getActiveBusinessProfile(pool, ORG_A)).id, stored.id);
    await ownerContext.close();

    const ownerMobile = await verifyLifecycle(
      browser, origin, ownerSession, { width: 390, height: 844 }, 'owner-mobile', 'dark', ledger, externalRequests
    );
    await ownerMobile.context.close();
    const viewerDesktop = await verifyLifecycle(
      browser, origin, viewerSession, { width: 1280, height: 900 }, 'viewer-desktop', 'light', ledger, externalRequests
    );
    const viewerAuthorityBefore = await authoritySnapshot(pool, ORG_A);
    const viewerDesktopGuard = await exerciseViewerSaveGuard({
      page: viewerDesktop.page, role: 'viewer-desktop', theme: 'light', requests, origin, pool, organizationId: ORG_A,
    });
    assert.strictEqual((await getActiveBusinessProfile(pool, ORG_A)).id, stored.id);
    await viewerDesktop.context.close();
    const viewerMobile = await verifyLifecycle(
      browser, origin, viewerSession, { width: 390, height: 844 }, 'viewer-mobile', 'dark', ledger, externalRequests
    );
    const viewerMobileGuard = await exerciseViewerSaveGuard({
      page: viewerMobile.page, role: 'viewer-mobile', theme: 'dark', requests, origin, pool, organizationId: ORG_A,
    });
    await viewerMobile.context.close();
    assert.deepStrictEqual(
      await authoritySnapshot(pool, ORG_A),
      viewerAuthorityBefore,
      'all viewer viewport/theme attempts preserve the PostgreSQL authority bytes and digest'
    );
    const viewerRequestLedger = requests.filter((entry) => entry.role.startsWith('viewer'));
    assert.strictEqual(viewerRequestLedger.filter((entry) => entry.method === 'PUT').length, 0,
      'viewer UI request ledger contains exactly zero PUT requests');
    assert.deepStrictEqual(viewerRequestLedger.filter((entry) => entry.method !== 'GET'), [],
      'viewer UI request ledger contains exactly zero non-GET requests');

    assert.strictEqual((await getActiveBusinessProfile(pool, ORG_B)).id, originalB.id, 'other tenant remains unchanged');
    assert.deepStrictEqual(externalRequests, [], 'all external/provider boundaries are intercepted and unused');
    assert.deepStrictEqual(consoleErrors, [], 'unexpected console errors');
    assert.deepStrictEqual(pageErrors, [], 'page errors');
    assert.ok(requests.every((entry) => entry.authorization === null), 'browser sends no Authorization headers');

    console.log(JSON.stringify({
      browser: selected,
      version: browser.version(),
      database: suiteDatabase.databaseName,
      lifecycle: ['initial', 'rerender', 'reload'],
      viewports: ['desktop', 'mobile'],
      themes: ['light', 'dark'],
      roles: ['owner', 'viewer'],
      rawAuthority: 'byte_exact',
      ownerSuccessfulMutations: 1,
      viewerSuccessfulMutations: 0,
      viewerPutRequests: viewerRequestLedger.filter((entry) => entry.method === 'PUT').length,
      viewerNonGetRequests: viewerRequestLedger.filter((entry) => entry.method !== 'GET').length,
      viewerAuthoritySha256: viewerAuthorityBefore.sha256,
      viewerGuards: { desktop: viewerDesktopGuard, mobile: viewerMobileGuard },
      providerRequests: externalRequests.length,
      unexpectedConsoleErrors: consoleErrors.length,
      pageErrors: pageErrors.length,
      overflow: { ownerMobile: ownerMobile.overflow, viewerDesktop: viewerDesktop.overflow, viewerMobile: viewerMobile.overflow },
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db && db.getPool()) await db.getPool().end();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalAccessSecret === undefined) delete process.env.AUTH_ACCESS_SECRET;
    else process.env.AUTH_ACCESS_SECRET = originalAccessSecret;
    if (originalRetellKey === undefined) delete process.env.RETELL_API_KEY;
    else process.env.RETELL_API_KEY = originalRetellKey;
    await suiteDatabase.cleanup();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
