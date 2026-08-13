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
const ORGANIZATION_ID = '61000000-0000-0000-0000-000000000001';
const OWNER_ID = '62000000-0000-0000-0000-000000000001';
const VIEWER_ID = '62000000-0000-0000-0000-000000000002';
const HOUR_OPEN = '\"><img data-m20-hours src=/m20-hours onerror=window.__m20Hours=1>';
const HOUR_CLOSE = '\"><svg data-m20-hours-close onload=window.y=1>';
const SERVICE_NAME = '<img data-m20-service src=/m20-service onerror=window.__m20Service=1>';
const SERVICE_EQUIPMENT = '\"><img data-m20-equipment src=/m20-equipment onerror=window.__m20Equipment=1>';
const CONTACT_NAME = '<img data-m20-contact-name src=/m20-contact onerror=window.__m20ContactName=1>';
const CONTACT_PHONE = '<svg data-m20-phone onload=window.x=1>';
const VIEWPORTS = Object.freeze({
  desktop: Object.freeze({ width: 1280, height: 900 }),
  mobile: Object.freeze({ width: 390, height: 844 }),
});

function dataDigest() {
  const root = path.join(ROOT, 'data');
  const hash = crypto.createHash('sha256');
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    fs.readdirSync(directory, { withFileTypes: true }).sort(function (left, right) {
      return left.name.localeCompare(right.name);
    }).forEach(function (entry) {
      const absolute = path.join(directory, entry.name);
      hash.update(entry.isDirectory() ? 'directory:' : 'file:');
      hash.update(path.relative(root, absolute).replace(/\\/g, '/'));
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
    });
  }
  visit(root);
  return hash.digest('hex');
}

function completeProfile() {
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({ companyName: 'Mission 20 Render Safety' });
  base.company.name = 'Mission 20 Render Safety';
  base.hours.monday = { open: '08:00', close: '17:00', emergency: true };
  base.hours.tuesday = { open: HOUR_OPEN, close: HOUR_CLOSE, emergency: false };
  base.services = [{
    ...base.services[0],
    id: 'm20-render-safety-service',
    name: SERVICE_NAME,
    equipment: SERVICE_EQUIPMENT,
  }];
  base.canonicalPricing = canonical.canonicalPricing;
  base.canonicalCosts = canonical.canonicalCosts;
  return base;
}

function preferences() {
  return {
    emailEnabled: false,
    emailCallSummary: false,
    emailAppointment: false,
    smsEnabled: false,
    smsUrgent: false,
    emailAddress: '',
    smsNumber: '',
    contacts: [{ name: CONTACT_NAME, phone: CONTACT_PHONE }],
  };
}

function utf8Hex(value) {
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
  if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function seedOrganization(pool) {
  await pool.query(
    `INSERT INTO organizations (id, name, email)
     VALUES ($1, 'Mission 20 Render Safety', 'm20-render-safety@example.test')`,
    [ORGANIZATION_ID]
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
     VALUES
       ($1,$3,'Mission 20 Owner','m20-owner@example.test','not-used','owner','active'),
       ($2,$3,'Mission 20 Viewer','m20-viewer@example.test','not-used','viewer','active')`,
    [OWNER_ID, VIEWER_ID, ORGANIZATION_ID]
  );
  await pool.query(
    `INSERT INTO notification_preferences (organization_id, notification_email, notification_phone)
     VALUES ($1, '', '')`,
    [ORGANIZATION_ID]
  );
  await pool.query(
    `INSERT INTO organization_account_preferences (organization_id, preferences)
     VALUES ($1, '{}'::jsonb)`,
    [ORGANIZATION_ID]
  );
}

async function assertPersistentAuthority(app, pool, ownerSession, viewerSession) {
  const profile = completeProfile();
  const writableProfile = JSON.parse(JSON.stringify(profile));
  writableProfile.hours.tuesday = { open: '09:00', close: '18:00', emergency: false };
  const profileBeforeWrite = await request(app)
    .get('/api/v1/business-profile')
    .set(ownerSession.headers);
  assert.strictEqual(profileBeforeWrite.status, 200);
  const profileWrite = await request(app)
    .put('/api/v1/business-profile')
    .set(ownerSession.headers)
    .send({
      expectedVersion: profileBeforeWrite.body.data.canonicalAuthority.version,
      value: writableProfile,
    });
  assert.strictEqual(profileWrite.status, 200, 'owner writes through mounted Business Profile route');
  assert.strictEqual(profileWrite.body.data.hours.tuesday.open, '09:00');
  assert.strictEqual(profileWrite.body.data.hours.tuesday.close, '18:00');
  assert.strictEqual(profileWrite.body.data.services[0].name, SERVICE_NAME);
  assert.strictEqual(profileWrite.body.data.services[0].equipment, SERVICE_EQUIPMENT);

  // Accepted server validation rejects new non-HH:mm hour writes. Preserve the
  // original Part 2A regression purpose by exercising historically persisted
  // raw bytes through the canonical authority, then mounting the real GET/UI
  // consumers below. This does not weaken or copy the production validator.
  const { putBusinessProfile } = require('../../src/services/organizationAuthority');
  const legacyAuthority = await putBusinessProfile(pool, {
    organizationId: ORGANIZATION_ID,
    userId: OWNER_ID,
    profile,
    expectedVersion: profileWrite.body.data.canonicalAuthority.version,
  });

  const preferenceWrite = await request(app)
    .put('/api/account/preferences')
    .set(ownerSession.headers)
    .send(preferences());
  assert.strictEqual(preferenceWrite.status, 200, 'owner writes through mounted preferences route');
  assert.deepStrictEqual(preferenceWrite.body.preferences.contacts, preferences().contacts);

  const viewerProfileWrite = await request(app)
    .put('/api/v1/business-profile')
    .set(viewerSession.headers)
    .send({ expectedVersion: legacyAuthority.versionLabel, value: profile });
  assert.strictEqual(viewerProfileWrite.status, 403, 'viewer cannot mutate Business Profile authority');
  const viewerPreferenceWrite = await request(app)
    .put('/api/account/preferences')
    .set(viewerSession.headers)
    .send(preferences());
  assert.strictEqual(viewerPreferenceWrite.status, 403, 'viewer cannot mutate account preferences');

  for (const session of [ownerSession, viewerSession]) {
    const loadedProfile = await request(app)
      .get('/api/v1/business-profile')
      .set(session.headers)
      .expect(200);
    assert.strictEqual(loadedProfile.body.data.services[0].name, SERVICE_NAME);
    assert.strictEqual(loadedProfile.body.data.services[0].equipment, SERVICE_EQUIPMENT);
    assert.strictEqual(loadedProfile.body.data.hours.tuesday.open, HOUR_OPEN);
    assert.strictEqual(loadedProfile.body.data.hours.tuesday.close, HOUR_CLOSE);
    const loadedPreferences = await request(app)
      .get('/api/account/preferences')
      .set(session.headers)
      .expect(200);
    assert.deepStrictEqual(loadedPreferences.body.preferences.contacts, preferences().contacts);
  }

  const durable = await pool.query(
    `SELECT
       encode(convert_to(profile.raw_profile #>> '{services,0,name}', 'UTF8'), 'hex') AS service_name_hex,
       encode(convert_to(profile.raw_profile #>> '{services,0,equipment}', 'UTF8'), 'hex') AS equipment_hex,
       encode(convert_to(profile.raw_profile #>> '{hours,tuesday,open}', 'UTF8'), 'hex') AS hour_open_hex,
       encode(convert_to(profile.raw_profile #>> '{hours,tuesday,close}', 'UTF8'), 'hex') AS hour_close_hex,
       profile.version_number,
       encode(convert_to(account.preferences #>> '{contacts,0,name}', 'UTF8'), 'hex') AS contact_name_hex,
       encode(convert_to(account.preferences #>> '{contacts,0,phone}', 'UTF8'), 'hex') AS contact_phone_hex
     FROM canonical_business_profiles profile
     JOIN organization_account_preferences account
       ON account.organization_id = profile.organization_id
     WHERE profile.organization_id = $1 AND profile.is_active = TRUE`,
    [ORGANIZATION_ID]
  );
  assert.deepStrictEqual(durable.rows, [{
    service_name_hex: utf8Hex(SERVICE_NAME),
    equipment_hex: utf8Hex(SERVICE_EQUIPMENT),
    hour_open_hex: utf8Hex(HOUR_OPEN),
    hour_close_hex: utf8Hex(HOUR_CLOSE),
    version_number: '3',
    contact_name_hex: utf8Hex(CONTACT_NAME),
    contact_phone_hex: utf8Hex(CONTACT_PHONE),
  }]);
}

async function snapshotBusinessProfile(page) {
  await page.waitForSelector('#servicesContainer .bp-service-card', { state: 'attached' });
  return page.evaluate(function () {
    const container = document.getElementById('servicesContainer');
    const row = container.querySelector('.bp-service-card');
    const equipment = row.querySelector('.svc-equipment');
    return {
      nameText: row.querySelector('.bp-repeat-title').textContent,
      equipmentValue: equipment.value,
      legitimateOpen: document.querySelector('.hours-open[data-day="monday"]').value,
      legitimateClose: document.querySelector('.hours-close[data-day="monday"]').value,
      adversarialOpen: document.querySelector('.hours-open[data-day="tuesday"]').value,
      adversarialClose: document.querySelector('.hours-close[data-day="tuesday"]').value,
      injectedNodes: document.querySelectorAll('[data-m20-service],[data-m20-equipment],[data-m20-hours],[data-m20-hours-close]').length,
      equipmentHandler: equipment.getAttribute('onerror') || equipment.getAttribute('onfocus'),
      flags: [window.__m20Service || 0, window.__m20Equipment || 0, window.__m20Hours || 0, window.y || 0],
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function snapshotSettings(page) {
  await page.waitForSelector('#contactsList .integration-card', { state: 'attached' });
  return page.evaluate(function () {
    const list = document.getElementById('contactsList');
    const card = list.querySelector('.integration-card');
    return {
      nameText: card.querySelector('.info h4').textContent,
      phoneText: card.querySelector('.info p').textContent,
      injectedNodes: list.querySelectorAll('[data-m20-contact-name],[data-m20-phone]').length,
      flags: [window.__m20ContactName || 0, window.x || 0],
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

function inspectSnapshot(findings, label, snapshot, expected) {
  if (snapshot.nameText !== expected.nameText) findings.push(`${label}: name text changed`);
  if (expected.equipmentValue !== undefined && snapshot.equipmentValue !== expected.equipmentValue) {
    findings.push(`${label}: equipment value changed`);
  }
  if (expected.phoneText !== undefined && snapshot.phoneText !== expected.phoneText) {
    findings.push(`${label}: phone text changed`);
  }
  if (snapshot.legitimateOpen !== undefined && (snapshot.legitimateOpen !== '08:00' || snapshot.legitimateClose !== '17:00')) {
    findings.push(`${label}: legitimate business hours changed`);
  }
  if (snapshot.adversarialOpen !== undefined &&
      !['', HOUR_OPEN].includes(snapshot.adversarialOpen)) {
    findings.push(`${label}: persisted opening hours were reinterpreted`);
  }
  if (snapshot.adversarialClose !== undefined &&
      !['', HOUR_CLOSE].includes(snapshot.adversarialClose)) {
    findings.push(`${label}: persisted closing hours were reinterpreted`);
  }
  if (snapshot.injectedNodes !== 0) findings.push(`${label}: persisted markup created ${snapshot.injectedNodes} DOM node(s)`);
  if (snapshot.equipmentHandler) findings.push(`${label}: persisted equipment created an event handler`);
  if (snapshot.flags.some(Boolean)) findings.push(`${label}: persisted markup executed`);
  if (snapshot.overflow > 1) findings.push(`${label}: horizontal overflow ${snapshot.overflow}px`);
}

async function exerciseRole(browser, origin, role, session, viewport, requestLedger, findings, consoleErrors, pageErrors) {
  const context = await browser.newContext({ viewport });
  try {
    await context.addCookies([
      { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
      { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
    ]);
    await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await context.route('https://fonts.gstatic.com/**', route => route.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
    await context.route('**/m20-*', route => route.fulfill({
      status: 200,
      contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64'),
    }));
    const page = await context.newPage();
    page.on('request', browserRequest => {
      requestLedger.push({ role, method: browserRequest.method(), url: browserRequest.url() });
    });
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(`${role}: ${message.text()}`);
    });
    page.on('pageerror', error => pageErrors.push(`${role}: ${error.message}`));

    const profileResponse = await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(profileResponse.status(), 200);
    inspectSnapshot(findings, `${role} Business Profile initial`, await snapshotBusinessProfile(page), {
      nameText: SERVICE_NAME,
      equipmentValue: SERVICE_EQUIPMENT,
    });
    await page.evaluate(function () {
      renderHours(profileData.hours);
      renderServices(profileData.services);
    });
    inspectSnapshot(findings, `${role} Business Profile rerender`, await snapshotBusinessProfile(page), {
      nameText: SERVICE_NAME,
      equipmentValue: SERVICE_EQUIPMENT,
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    inspectSnapshot(findings, `${role} Business Profile reload`, await snapshotBusinessProfile(page), {
      nameText: SERVICE_NAME,
      equipmentValue: SERVICE_EQUIPMENT,
    });

    const settingsResponse = await page.goto(origin + '/dashboard/settings', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(settingsResponse.status(), 200);
    inspectSnapshot(findings, `${role} Settings initial`, await snapshotSettings(page), {
      nameText: CONTACT_NAME,
      phoneText: CONTACT_PHONE,
    });
    await page.evaluate(function () { renderContacts(); });
    inspectSnapshot(findings, `${role} Settings rerender`, await snapshotSettings(page), {
      nameText: CONTACT_NAME,
      phoneText: CONTACT_PHONE,
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    inspectSnapshot(findings, `${role} Settings reload`, await snapshotSettings(page), {
      nameText: CONTACT_NAME,
      phoneText: CONTACT_PHONE,
    });
    if (role === 'owner') {
      const removalResponse = page.waitForResponse(response =>
        response.url() === origin + '/api/account/preferences' && response.request().method() === 'PUT'
      );
      await page.locator('#contactsList button', { hasText: 'Remove' }).click();
      assert.strictEqual((await removalResponse).status(), 200, 'owner removes a contact through the mounted UI');
      await page.waitForFunction(function () {
        const empty = document.querySelector('#contactsList .empty-state p');
        return empty && empty.textContent === 'No contacts added yet. Add family, team members, or regular customers below.';
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#contactsList .empty-state', { state: 'attached' });
      assert.strictEqual(await page.locator('#contactsList .empty-state p').textContent(),
        'No contacts added yet. Add family, team members, or regular customers below.');
    }
  } finally {
    await context.close();
  }
}

async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  const viewportName = (process.argv.find(value => value.startsWith('--viewport=')) || '--viewport=desktop').split('=')[1];
  assert.ok(VIEWPORTS[viewportName], 'viewport must be desktop or mobile');
  const { browserType, executablePath } = resolveBrowserRuntime(selected);
  const beforeData = dataDigest();
  const original = {
    databaseUrl: process.env.DATABASE_URL,
    accessSecret: process.env.AUTH_ACCESS_SECRET,
    retellKey: process.env.RETELL_API_KEY,
  };
  const suiteDatabase = await createSuiteDatabase(`m20-render-${selected}-${viewportName}`);
  let db;
  let server;
  let browser;
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.RETELL_API_KEY = '';
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL must initialize');
    const pool = db.getPool();
    const identity = await pool.query(
      `SELECT current_setting('server_version') AS version,
              current_setting('TimeZone') AS timezone,
              current_setting('data_checksums') AS checksums`
    );
    assert.match(identity.rows[0].version, /^18\.4(?:\s|$)/);
    assert.strictEqual(identity.rows[0].timezone, 'UTC');
    assert.strictEqual(identity.rows[0].checksums, 'on');
    await seedOrganization(pool);
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORGANIZATION_ID,
      userId: OWNER_ID,
      profile: completeProfile(),
      expectedVersion: null,
    });
    const ownerSession = await provisionDurableSession(pool, {
      userId: OWNER_ID,
      organizationId: ORGANIZATION_ID,
      role: 'owner',
    });
    const viewerSession = await provisionDurableSession(pool, {
      userId: VIEWER_ID,
      organizationId: ORGANIZATION_ID,
      role: 'viewer',
    });
    const { app } = require('../../src/server');
    await assertPersistentAuthority(app, pool, ownerSession, viewerSession);
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await browserType.launch({ headless: true, executablePath });

    const requestLedger = [];
    const findings = [];
    const consoleErrors = [];
    const pageErrors = [];
    for (const [role, session] of [['viewer', viewerSession], ['owner', ownerSession]]) {
      await exerciseRole(
        browser,
        origin,
        role,
        session,
        VIEWPORTS[viewportName],
        requestLedger,
        findings,
        consoleErrors,
        pageErrors
      );
    }
    const nonReadBrowserRequests = requestLedger.filter(entry => !['GET', 'HEAD', 'OPTIONS'].includes(entry.method));
    const providerRequests = requestLedger.filter(entry => /retell|twilio|stripe|provider/i.test(new URL(entry.url).hostname));
    assert.deepStrictEqual(nonReadBrowserRequests.map(entry => ({
      role: entry.role,
      method: entry.method,
      path: new URL(entry.url).pathname,
    })), [{ role: 'owner', method: 'PUT', path: '/api/account/preferences' }],
    'only the explicit owner remove action may mutate during the browser matrix');
    assert.deepStrictEqual(providerRequests, [], 'browser render matrix must not contact providers');
    assert.deepStrictEqual(findings, [], 'persisted values must remain text/value-only across every render');
    assert.deepStrictEqual(pageErrors, [], 'browser page errors');
    assert.deepStrictEqual(consoleErrors, [], 'browser console errors');
    console.log(JSON.stringify({
      browser: selected,
      version: browser.version(),
      viewport: viewportName,
      roles: ['owner', 'viewer'],
      surfaces: ['business-profile', 'settings'],
      renderPhases: ['initial', 'rerender', 'reload'],
      postgres: identity.rows[0],
      rawAuthority: 'byte_exact',
      writerUiMutations: 1,
      viewerUiMutations: 0,
      providerRequests: 0,
      findings: 0,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db) await db.close();
    if (original.databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original.databaseUrl;
    if (original.accessSecret === undefined) delete process.env.AUTH_ACCESS_SECRET;
    else process.env.AUTH_ACCESS_SECRET = original.accessSecret;
    if (original.retellKey === undefined) delete process.env.RETELL_API_KEY;
    else process.env.RETELL_API_KEY = original.retellKey;
    await suiteDatabase.cleanup();
    assert.strictEqual(dataDigest(), beforeData, 'browser matrix must not change repository data');
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
