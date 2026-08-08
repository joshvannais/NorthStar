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
const ORG_A = '43000000-0000-0000-0000-000000000001';
const ORG_B = '43000000-0000-0000-0000-000000000002';
const OWNER_A = '44000000-0000-0000-0000-000000000001';
const OWNER_B = '44000000-0000-0000-0000-000000000002';

function completeProfile(companyName, overrides) {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({
    companyName,
    materialRates: { cedar: 123, pine: 71, vinyl: 83, 'chain-link': 47 },
    ...(overrides || {}),
  });
  base.company.name = companyName;
  base.services = canonical.services;
  base.canonicalPricing = canonical.canonicalPricing;
  base.canonicalCosts = canonical.canonicalCosts;
  base.financial = {
    ...base.financial,
    markup: 9.99,
    taxRate: 77,
    emergencyMarkup: 8.88,
    travelCharge: 7.77,
    minimumJobPrice: 999,
  };
  return base;
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

async function waitForValue(page, selector, expected) {
  await page.waitForFunction(
    ({ selector: selected, expected: value }) => document.querySelector(selected) && document.querySelector(selected).value === value,
    { selector, expected },
    { timeout: 15000 }
  );
}

async function main() {
  const selected = (process.argv.find((value) => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  const { browserType, executablePath } = resolveBrowserRuntime(selected);

  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
  const originalRetellKey = process.env.RETELL_API_KEY;
  const suiteDatabase = await createSuiteDatabase('profile-browser-' + selected);
  let db;
  let server;
  let browser;
  const requestLedger = [];
  const consoleErrors = [];
  const pageErrors = [];
  let providerBoundaryRequests = 0;
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.RETELL_API_KEY = '';
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL must initialize');
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1, 'Profile Browser Organization A', 'profile-browser-a@m19.test'),
        ($2, 'Profile Browser Organization B', 'profile-browser-b@m19.test')`,
      [ORG_A, ORG_B]
    );
    for (const user of [[OWNER_A, ORG_A], [OWNER_B, ORG_B]]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used','owner','active')`,
        [user[0], user[1], user[0], user[0] + '@profile-browser.test']
      );
    }

    const { putBusinessProfile, getActiveBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: OWNER_A,
      profile: completeProfile('Canonical Browser A'),
    });
    const originalB = await putBusinessProfile(pool, {
      organizationId: ORG_B,
      userId: OWNER_B,
      profile: completeProfile('Canonical Browser B', {
        taxRatePercent: 4,
        emergencyMultiplier: 2,
        travelCustomerChargePerMile: 3,
      }),
    });
    const { app } = require('../../src/server');
    const ownerASession = await provisionDurableSession(pool, {
      userId: OWNER_A, organizationId: ORG_A, role: 'owner',
    });
    const ownerAAuth = ownerASession.headers;
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;

    browser = await browserType.launch({
      headless: true,
      executablePath,
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([
      { name: 'northstar_access', value: ownerASession.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
      { name: 'northstar_csrf', value: ownerASession.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
    ]);
    await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await context.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));

    const page = await context.newPage();
    page.on('request', (browserRequest) => {
      requestLedger.push({
        method: browserRequest.method(),
        url: browserRequest.url(),
        authorization: browserRequest.headers().authorization || null,
      });
      if (/retell|twilio|provider/i.test(browserRequest.url())) providerBoundaryRequests += 1;
    });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const pageResponse = await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    assert.match(pageResponse.headers()['content-security-policy'], /^default-src /, 'CSP uses browser-recognized directive names');
    await waitForValue(page, '#fin-taxRatePercent', '0');
    assert.strictEqual(await page.locator('#fin-emergencyMultiplier').inputValue(), '1');
    assert.strictEqual(await page.locator('#fin-travelCustomerChargePerMile').inputValue(), '0');
    assert.deepStrictEqual(
      requestLedger.filter((entry) => !['GET', 'HEAD', 'OPTIONS'].includes(entry.method)),
      [],
      'normal page load must be read-only'
    );

    await page.locator('[data-section="financial"]').click();
    await page.locator('#fin-taxRatePercent').fill('9');
    await page.locator('#fin-emergencyMultiplier').fill('0');
    await page.locator('#fin-travelCustomerChargePerMile').fill('0');
    await page.locator('#fin-minimumJobPrice').fill('0');
    await page.locator('#cost-overheadPercent').fill('0');
    await page.locator('#cost-travelCostPerMile').fill('0');
    const saveResponse = page.waitForResponse((response) =>
      response.url() === origin + '/api/v1/business-profile/financialConfiguration' && response.request().method() === 'PUT'
    );
    await page.locator('#saveFinancialConfigurationBtn').click();
    assert.strictEqual((await saveResponse).status(), 200, 'explicit Save must persist');
    await waitForValue(page, '#fin-taxRatePercent', '9');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForValue(page, '#fin-taxRatePercent', '9');
    assert.strictEqual(await page.locator('#fin-emergencyMultiplier').inputValue(), '0');
    assert.strictEqual(await page.locator('#fin-travelCustomerChargePerMile').inputValue(), '0');
    assert.strictEqual(await page.locator('#fin-minimumJobPrice').inputValue(), '0');
    assert.strictEqual(await page.locator('#cost-overheadPercent').inputValue(), '0');
    assert.strictEqual(await page.locator('#cost-travelCostPerMile').inputValue(), '0');

    const configured = await getActiveBusinessProfile(pool, ORG_A);
    assert.deepStrictEqual(configured.rawProfile.canonicalPricing, {
      customerMarkupPercent: 0,
      desiredGrossMarginPercent: 40,
      desiredNetMarginPercent: 20,
      emergencyMultiplier: 0,
      maximumDiscountPercent: 15,
      minimumJobPrice: 0,
      taxRatePercent: 9,
      travelCustomerChargePerMile: 0,
    });
    assert.strictEqual(configured.rawProfile.financial.taxRate, 77, 'dedicated save does not create a canonical-to-legacy mirror write');
    assert.strictEqual(configured.rawProfile.financial.emergencyMarkup, 8.88, 'recognized legacy bytes remain untouched');
    assert.strictEqual(configured.rawProfile.financial.travelCharge, 7.77, 'recognized legacy bytes remain untouched');

    const graph = await request(app)
      .post('/api/v1/simulations/leads')
      .set(ownerAAuth)
      .set('Idempotency-Key', 'browser-profile-nine-zero-' + selected)
      .send({ name: 'Browser Canonical Customer', service: 'fence', phone: '+15555554301' });
    assert.strictEqual(graph.status, 201);
    assert.strictEqual(graph.body.polaris.taxRatePercent, 9);
    assert.strictEqual(graph.body.polaris.tax, Math.round(graph.body.polaris.customerFacingPrice * 9) / 100);
    assert.strictEqual(graph.body.polaris.businessProfileInputId, configured.id);
    assert.strictEqual(graph.body.polaris.businessProfileInputHash, configured.profileHash);
    assert.ok(graph.body.polaris.businessProfileFieldsUsed.includes('canonicalPricing.emergencyMultiplier'));
    assert.ok(graph.body.polaris.businessProfileFieldsUsed.includes('canonicalPricing.travelCustomerChargePerMile'));

    const putsBeforeMalformed = requestLedger.filter((entry) => entry.method === 'PUT').length;
    await page.locator('[data-section="financial"]').click();
    await page.locator('#fin-taxRatePercent').fill('101');
    await page.locator('#saveFinancialConfigurationBtn').click();
    await page.locator('#canonicalFinancialError.show').waitFor({ state: 'visible' });
    assert.match(await page.locator('#canonicalFinancialError').textContent(), /Tax Rate.*0 through 100/i);
    assert.strictEqual(requestLedger.filter((entry) => entry.method === 'PUT').length, putsBeforeMalformed, 'malformed input must not be transmitted');
    assert.strictEqual((await getActiveBusinessProfile(pool, ORG_A)).id, configured.id, 'malformed UI input must not advance profile authority');

    await page.locator('#fin-taxRatePercent').fill('');
    await page.locator('#fin-emergencyMultiplier').fill('');
    await page.locator('#fin-travelCustomerChargePerMile').fill('');
    const missingResponse = page.waitForResponse((response) =>
      response.url() === origin + '/api/v1/business-profile/financialConfiguration' && response.request().method() === 'PUT'
    );
    await page.locator('#saveFinancialConfigurationBtn').click();
    assert.strictEqual((await missingResponse).status(), 200, 'explicit missing configuration must save without defaults');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#fin-taxRatePercent') && document.querySelector('#fin-taxRatePercent').dataset.authorityState === 'missing');
    assert.strictEqual(await page.locator('#fin-taxRatePercent').inputValue(), '');
    assert.strictEqual(await page.locator('#fin-emergencyMultiplier').inputValue(), '');
    assert.strictEqual(await page.locator('#fin-travelCustomerChargePerMile').inputValue(), '');
    const missing = await getActiveBusinessProfile(pool, ORG_A);
    assert.ok(!Object.prototype.hasOwnProperty.call(missing.rawProfile.canonicalPricing, 'taxRatePercent'));
    assert.strictEqual(missing.rawProfile.financial.taxRate, 77, 'blank deletes canonical authority without rewriting retained legacy bytes');
    assert.strictEqual((await getActiveBusinessProfile(pool, ORG_B)).id, originalB.id, 'organization B remains unchanged');

    const bodyText = await page.locator('body').innerText();
    assert.ok(!bodyText.includes('[object Object]'), 'page must not render object coercions');
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(desktopOverflow <= 1, 'desktop has no horizontal overflow');
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(mobileOverflow <= 1, 'mobile has no horizontal overflow');
    assert.deepStrictEqual(pageErrors, [], 'page errors');
    assert.deepStrictEqual(consoleErrors, [], 'console errors');
    assert.strictEqual(providerBoundaryRequests, 0, 'provider boundary is never contacted');
    assert.ok(requestLedger.every(entry => entry.authorization === null), 'browser sends no Authorization headers');

    const result = {
      browser: selected,
      version: browser.version(),
      database: suiteDatabase.databaseName,
      pageLoadMutations: 0,
      explicitSaveWrites: requestLedger.filter((entry) => entry.method === 'PUT').length,
      taxRatePercent: graph.body.polaris.taxRatePercent,
      emergencyMultiplier: configured.rawProfile.canonicalPricing.emergencyMultiplier,
      travelCustomerChargePerMile: configured.rawProfile.canonicalPricing.travelCustomerChargePerMile,
      missingDisposition: 'not_configured',
      malformedDisposition: 'blocked_before_write',
      providerBoundaryRequests,
      consoleErrors: consoleErrors.length,
      pageErrors: pageErrors.length,
      overflow: { desktop: desktopOverflow, mobile: mobileOverflow },
    };
    console.log(JSON.stringify(result));
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
