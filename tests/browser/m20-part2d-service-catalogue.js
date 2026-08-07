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

async function contextFor(browser, origin, session, viewport, externalRequests) {
  const context = await browser.newContext({ viewport });
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

async function verifyLifecycle(browser, origin, session, viewport, role, ledger, externalRequests) {
  const context = await contextFor(browser, origin, session, viewport, externalRequests);
  const page = await context.newPage();
  ledger.attach(page, role);
  await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
  await assertPersistedCatalogue(page);
  await page.evaluate(() => renderProfile(profileData));
  await assertPersistedCatalogue(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await assertPersistedCatalogue(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, role + ' has no horizontal overflow');
  return { context, page, overflow };
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
  const expectedViewerForbidden = [];
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
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, profile: profileFor('Service Editor A') });
    const originalB = await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, profile: profileFor('Other Tenant') });
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
          if (role.startsWith('viewer') && /403 \(Forbidden\)/.test(message.text())) {
            expectedViewerForbidden.push(message.text());
            return;
          }
          consoleErrors.push(role + ': ' + message.text());
        });
        page.on('pageerror', (error) => pageErrors.push(role + ': ' + error.message));
      },
    };

    const ownerContext = await contextFor(browser, origin, ownerSession, { width: 1280, height: 900 }, externalRequests);
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
      browser, origin, ownerSession, { width: 390, height: 844 }, 'owner-mobile', ledger, externalRequests
    );
    await ownerMobile.context.close();
    const viewerDesktop = await verifyLifecycle(
      browser, origin, viewerSession, { width: 1280, height: 900 }, 'viewer-desktop', ledger, externalRequests
    );
    await viewerDesktop.page.locator('[data-section="services"]').click();
    await viewerDesktop.page.locator('.bp-service-card').first().locator('.svc-name').fill('Forbidden viewer edit');
    const viewerSave = viewerDesktop.page.waitForResponse((response) =>
      response.url() === origin + '/api/v1/business-profile' && response.request().method() === 'PUT'
    );
    await viewerDesktop.page.locator('#saveBtn').click();
    assert.strictEqual((await viewerSave).status(), 403, 'viewer save must be rejected');
    assert.strictEqual((await getActiveBusinessProfile(pool, ORG_A)).id, stored.id);
    await viewerDesktop.context.close();
    const viewerMobile = await verifyLifecycle(
      browser, origin, viewerSession, { width: 390, height: 844 }, 'viewer-mobile', ledger, externalRequests
    );
    await viewerMobile.context.close();

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
      roles: ['owner', 'viewer'],
      rawAuthority: 'byte_exact',
      ownerSuccessfulMutations: 1,
      viewerSuccessfulMutations: 0,
      viewerRejectedWrites: requests.filter((entry) => entry.role === 'viewer-desktop' && entry.method === 'PUT').length,
      providerRequests: externalRequests.length,
      unexpectedConsoleErrors: consoleErrors.length,
      expectedViewerForbiddenConsole: expectedViewerForbidden.length,
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
