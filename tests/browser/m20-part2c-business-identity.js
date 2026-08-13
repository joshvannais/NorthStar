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
const ORG_A = '73000000-0000-0000-0000-000000000001';
const ORG_B = '73000000-0000-0000-0000-000000000002';
const OWNER_A = '74000000-0000-0000-0000-000000000001';
const VIEWER_A = '74000000-0000-0000-0000-000000000002';
const OWNER_B = '74000000-0000-0000-0000-000000000003';

const INITIAL = Object.freeze({
  company: '  Identity <Company> Caf\u00e9  ',
  office: '  North <Office> \ud83e\uddf0  ',
  territory: '  Greater Boston\nNorth Shore e\u0301  ',
  holiday: '  Winter <Holiday> \u2603  ',
  policy: '  Written terms <b>control</b>.\nSecond line.  ',
});

const EDITED = Object.freeze({
  company: '  Edited <Company> \ud83c\udf0c  ',
  office: '  Edited <Office> \ud83d\ude9a  ',
  territory: '  Edited territory\nKeep whitespace.  ',
  holiday: '  Edited <Holiday> \ud83c\udf84  ',
  policy: '  Edited policy <literal>.\nKeep every line.  ',
});

function profileFor(companyName) {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({ companyName });
  profile.company = {
    ...profile.company,
    name: companyName,
    email: 'dispatch@example.com',
    website: 'https://example.com',
    logo: 'https://example.com/logo.svg',
    timeZone: 'America/New_York',
    currency: 'USD',
  };
  profile.headquarters = {
    street: '10 Main St', city: 'Boston', state: 'MA', zip: '02108', country: 'US',
    latitude: 42.3601, longitude: -71.0589,
    additionalOffices: [{
      id: 'office-north', name: INITIAL.office, street: '20 North St', city: 'Lowell',
      state: 'MA', zip: '01852', country: 'US', latitude: null, longitude: null,
    }],
  };
  profile.serviceArea = {
    maxRadiusMiles: 75,
    maxTravelMinutes: 90,
    primaryTerritory: INITIAL.territory,
    polygon: [[42.1, -71.4], [42.7, -71.4], [42.7, -70.7]],
  };
  profile.hours.monday = {
    ...profile.hours.monday,
    lunch: '12:00-13:00',
    emergency: false,
    afterHours: true,
  };
  profile.hours.holidays = [{
    id: 'holiday-2026-12-25', name: INITIAL.holiday, date: '2026-12-25',
    closed: true, open: '', close: '',
  }];
  profile.policies = { warranty: INITIAL.policy };
  profile.services = canonical.services;
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

async function contextFor(browser, origin, session, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
  return context;
}

async function waitForCompany(page, expected) {
  await page.waitForFunction(
    (value) => document.querySelector('#company-name') && document.querySelector('#company-name').value === value,
    expected,
    { timeout: 15000 }
  );
}

async function policyValue(page, key) {
  return page.evaluate((selected) => {
    const row = Array.from(document.querySelectorAll('.bp-policy-row')).find((candidate) =>
      candidate.querySelector('.policy-key') && candidate.querySelector('.policy-key').value === selected
    );
    return row && row.querySelector('.policy-value').value;
  }, key);
}

async function setPolicyValue(page, key, value) {
  await page.evaluate(({ selected, next }) => {
    const row = Array.from(document.querySelectorAll('.bp-policy-row')).find((candidate) =>
      candidate.querySelector('.policy-key') && candidate.querySelector('.policy-key').value === selected
    );
    if (!row) throw new Error('Policy row missing: ' + selected);
    const field = row.querySelector('.policy-value');
    field.value = next;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, { selected: key, next: value });
}

async function assertRendered(page, expected) {
  assert.strictEqual(await page.locator('#company-name').inputValue(), expected.company);
  assert.strictEqual(await page.locator('.office-name').inputValue(), expected.office);
  assert.strictEqual(await page.locator('#sa-primaryTerritory').inputValue(), expected.territory);
  assert.deepStrictEqual(JSON.parse(await page.locator('#sa-polygon').inputValue()), [[42.1, -71.4], [42.7, -71.4], [42.7, -70.7]]);
  assert.strictEqual(await page.locator('.hours-lunch[data-day="monday"]').inputValue(), '12:00-13:00');
  assert.strictEqual(await page.locator('.hours-afterHours[data-day="monday"]').isChecked(), true);
  assert.strictEqual(await page.locator('.holiday-name').inputValue(), expected.holiday);
  assert.strictEqual(await policyValue(page, 'warranty'), expected.policy);
}

async function authoritySnapshot(pool, organizationId) {
  const result = await pool.query(
    `SELECT
       id::text AS id,
       organization_id::text AS organization_id,
       version_number::text AS version_number,
       encode(convert_to(version_label, 'UTF8'), 'hex') AS version_label_hex,
       encode(convert_to(raw_profile::text, 'UTF8'), 'hex') AS raw_profile_hex,
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
  }));
  assert.strictEqual(state.disabled, true, label + ': Save is natively disabled');
  assert.strictEqual(state.hasDisabledAttribute, true, label + ': Save retains its native disabled attribute');
}

function viewerRequestLedger(requests, origin) {
  return requests
    .filter((entry) => entry.role === 'viewer' && new URL(entry.url).origin === origin)
    .map((entry) => ({ method: entry.method, path: new URL(entry.url).pathname }));
}

async function main() {
  const selected = (process.argv.find((value) => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  const { browserType, executablePath } = resolveBrowserRuntime(selected);
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalAccessSecret = process.env.AUTH_ACCESS_SECRET;
  const originalRetellKey = process.env.RETELL_API_KEY;
  const suiteDatabase = await createSuiteDatabase('m20-2c-' + selected);
  let db;
  let server;
  let browser;
  const requests = [];
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
        ($1, 'M20 Identity Organization A', 'm20-identity-a@test.invalid'),
        ($2, 'M20 Identity Organization B', 'm20-identity-b@test.invalid')`,
      [ORG_A, ORG_B]
    );
    for (const user of [[OWNER_A, ORG_A, 'owner'], [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner']]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [user[0], user[1], user[0], user[0] + '@m20-identity.test', user[2]]
      );
    }
    const { putBusinessProfile, getActiveBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, expectedVersion: null, profile: profileFor(INITIAL.company) });
    const originalB = await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, expectedVersion: null, profile: profileFor('Other Tenant') });
    const ownerSession = await provisionDurableSession(pool, { userId: OWNER_A, organizationId: ORG_A, role: 'owner' });
    const viewerSession = await provisionDurableSession(pool, { userId: VIEWER_A, organizationId: ORG_A, role: 'viewer' });
    const { app } = require('../../src/server');
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await browserType.launch({ headless: true, executablePath });

    const attachPageLedger = (page, role) => {
      page.on('request', (entry) => {
        requests.push({ role, method: entry.method(), url: entry.url(), authorization: entry.headers().authorization || null });
        if (/retell|twilio|provider/i.test(entry.url())) providerBoundaryRequests += 1;
      });
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        consoleErrors.push(role + ': ' + message.text());
      });
      page.on('pageerror', (error) => pageErrors.push(role + ': ' + error.message));
    };

    const ownerContext = await contextFor(browser, origin, ownerSession, { width: 1280, height: 900 });
    const ownerPage = await ownerContext.newPage();
    attachPageLedger(ownerPage, 'owner');
    await ownerPage.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    await waitForCompany(ownerPage, INITIAL.company);
    await assertRendered(ownerPage, INITIAL);
    await ownerPage.evaluate(() => renderProfile(profileData));
    await assertRendered(ownerPage, INITIAL);

    await ownerPage.locator('#company-name').fill(EDITED.company);
    await ownerPage.locator('[data-section="headquarters"]').click();
    await ownerPage.locator('.office-name').fill(EDITED.office);
    await ownerPage.locator('[data-section="serviceArea"]').click();
    await ownerPage.locator('#sa-primaryTerritory').fill(EDITED.territory);
    await ownerPage.locator('[data-section="hours"]').click();
    await ownerPage.locator('.holiday-name').fill(EDITED.holiday);
    await ownerPage.locator('[data-section="policies"]').click();
    await setPolicyValue(ownerPage, 'warranty', EDITED.policy);
    const ownerSave = ownerPage.waitForResponse((response) =>
      response.url() === origin + '/api/v1/business-profile' && response.request().method() === 'PUT'
    );
    await ownerPage.locator('#saveBtn').click();
    assert.strictEqual((await ownerSave).status(), 200, 'owner save must persist');
    await waitForCompany(ownerPage, EDITED.company);
    await assertRendered(ownerPage, EDITED);
    await ownerPage.reload({ waitUntil: 'domcontentloaded' });
    await waitForCompany(ownerPage, EDITED.company);
    await assertRendered(ownerPage, EDITED);

    const stored = await getActiveBusinessProfile(pool, ORG_A);
    const rawBytes = await pool.query(
      `SELECT
         encode(convert_to(raw_profile #>> '{company,name}', 'UTF8'), 'hex') AS company_hex,
         encode(convert_to(raw_profile #>> '{headquarters,additionalOffices,0,name}', 'UTF8'), 'hex') AS office_hex,
         encode(convert_to(raw_profile #>> '{serviceArea,primaryTerritory}', 'UTF8'), 'hex') AS territory_hex,
         encode(convert_to(raw_profile #>> '{hours,holidays,0,name}', 'UTF8'), 'hex') AS holiday_hex,
         encode(convert_to(raw_profile #>> '{policies,warranty}', 'UTF8'), 'hex') AS policy_hex
       FROM canonical_business_profiles WHERE id = $1`,
      [stored.id]
    );
    assert.deepStrictEqual(rawBytes.rows[0], {
      company_hex: Buffer.from(EDITED.company, 'utf8').toString('hex'),
      office_hex: Buffer.from(EDITED.office, 'utf8').toString('hex'),
      territory_hex: Buffer.from(EDITED.territory, 'utf8').toString('hex'),
      holiday_hex: Buffer.from(EDITED.holiday, 'utf8').toString('hex'),
      policy_hex: Buffer.from(EDITED.policy, 'utf8').toString('hex'),
    });

    const ownerPutsBeforeMalformed = requests.filter((entry) => entry.role === 'owner' && entry.method === 'PUT').length;
    await ownerPage.locator('[data-section="serviceArea"]').click();
    await ownerPage.locator('#sa-polygon').fill('{not json');
    await ownerPage.locator('#saveBtn').click();
    await ownerPage.waitForTimeout(100);
    assert.strictEqual(
      requests.filter((entry) => entry.role === 'owner' && entry.method === 'PUT').length,
      ownerPutsBeforeMalformed,
      'malformed polygon must be blocked before transmission'
    );
    assert.strictEqual((await getActiveBusinessProfile(pool, ORG_A)).id, stored.id, 'malformed owner input must not advance authority');
    await ownerPage.locator('#sa-polygon').fill(JSON.stringify([[42.1, -71.4], [42.7, -71.4], [42.7, -70.7]]));

    const desktopOverflow = await ownerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(desktopOverflow <= 1, 'owner desktop has no horizontal overflow');
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    const ownerMobileOverflow = await ownerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(ownerMobileOverflow <= 1, 'owner mobile has no horizontal overflow');

    const viewerContext = await contextFor(browser, origin, viewerSession, { width: 1280, height: 900 });
    const viewerPage = await viewerContext.newPage();
    attachPageLedger(viewerPage, 'viewer');
    await viewerPage.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    await waitForCompany(viewerPage, EDITED.company);
    await assertRendered(viewerPage, EDITED);
    await assertViewerSaveDisabled(viewerPage, 'viewer/initial');
    await viewerPage.evaluate(() => renderProfile(profileData));
    await assertRendered(viewerPage, EDITED);
    await assertViewerSaveDisabled(viewerPage, 'viewer/rerender');
    await viewerPage.locator('#company-name').fill('Forbidden viewer mutation');
    const viewerAuthorityBefore = await authoritySnapshot(pool, ORG_A);
    assert.deepStrictEqual(
      viewerRequestLedger(requests, origin).filter((entry) => entry.method !== 'GET'),
      [],
      'automatic viewer requests are GET-only before interaction'
    );
    const viewerSave = viewerPage.locator('#saveBtn');
    const viewerSaveBox = await viewerSave.boundingBox();
    assert.ok(viewerSaveBox && viewerSaveBox.width > 0 && viewerSaveBox.height > 0,
      'disabled viewer Save remains visibly present');
    await viewerPage.mouse.click(
      viewerSaveBox.x + viewerSaveBox.width / 2,
      viewerSaveBox.y + viewerSaveBox.height / 2
    );
    await viewerSave.press('Enter');
    await viewerSave.press('Space');
    await viewerPage.waitForTimeout(150);
    await assertViewerSaveDisabled(viewerPage, 'viewer/after-attempts');
    const viewerMethods = viewerRequestLedger(requests, origin);
    assert.deepStrictEqual(viewerMethods.filter((entry) => entry.method !== 'GET'), [],
      'trusted viewer mouse and keyboard attempts emit zero non-GET requests');
    assert.strictEqual(viewerMethods.filter((entry) => entry.method === 'PUT').length, 0,
      'trusted viewer mouse and keyboard attempts emit exactly zero PUT requests');
    assert.deepStrictEqual(await authoritySnapshot(pool, ORG_A), viewerAuthorityBefore,
      'viewer attempts preserve PostgreSQL authority bytes and protected digest');
    assert.strictEqual((await getActiveBusinessProfile(pool, ORG_A)).id, stored.id, 'viewer must not advance authority');
    await viewerPage.reload({ waitUntil: 'domcontentloaded' });
    await waitForCompany(viewerPage, EDITED.company);
    await assertRendered(viewerPage, EDITED);
    await assertViewerSaveDisabled(viewerPage, 'viewer/reload');
    assert.deepStrictEqual(await authoritySnapshot(pool, ORG_A), viewerAuthorityBefore,
      'viewer reload confirms unchanged PostgreSQL authority bytes and protected digest');
    await viewerPage.setViewportSize({ width: 390, height: 844 });
    const viewerMobileOverflow = await viewerPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(viewerMobileOverflow <= 1, 'viewer mobile has no horizontal overflow');

    assert.strictEqual((await getActiveBusinessProfile(pool, ORG_B)).id, originalB.id, 'other tenant remains unchanged');
    assert.strictEqual(providerBoundaryRequests, 0, 'provider boundary is never contacted');
    assert.deepStrictEqual(consoleErrors, [], 'console errors');
    assert.deepStrictEqual(pageErrors, [], 'page errors');
    assert.ok(requests.every((entry) => entry.authorization === null), 'browser sends no Authorization headers');

    console.log(JSON.stringify({
      browser: selected,
      version: browser.version(),
      database: suiteDatabase.databaseName,
      rawAuthority: 'byte_exact',
      ownerMutations: requests.filter((entry) => entry.role === 'owner' && entry.method === 'PUT').length,
      viewerMutations: 0,
      viewerPutRequests: viewerMethods.filter((entry) => entry.method === 'PUT').length,
      viewerNonGetRequests: viewerMethods.filter((entry) => entry.method !== 'GET').length,
      viewerAuthoritySha256: viewerAuthorityBefore.sha256,
      providerBoundaryRequests,
      consoleErrors: consoleErrors.length,
      pageErrors: pageErrors.length,
      overflow: { desktop: desktopOverflow, ownerMobile: ownerMobileOverflow, viewerMobile: viewerMobileOverflow },
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
