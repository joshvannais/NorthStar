'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const ORG = '87000000-0000-4000-8000-000000000001';
const OWNER = '88000000-0000-4000-8000-000000000001';
const DISPATCHER = '88000000-0000-4000-8000-000000000002';
const TECHNICIAN = '88000000-0000-4000-8000-000000000003';
const PEOPLE = Object.freeze([
  Object.freeze({ id: OWNER, name: 'Lane 3 Owner', access: 'owner', operational: 'owner' }),
  Object.freeze({ id: DISPATCHER, name: 'Legacy Dispatcher', access: 'dispatcher', operational: 'dispatcher' }),
  Object.freeze({ id: TECHNICIAN, name: 'Legacy Technician', access: 'tech', operational: 'technician' }),
]);

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

async function contextFor(browser, origin, session, viewport, theme, ledger, identity) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(selectedTheme => localStorage.setItem('northstar-theme', selectedTheme), theme);
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    ledger.external.push({ identity, method: request.method(), url: request.url() });
    return route.fulfill({ status: 204, body: '' });
  });
  context.on('request', request => {
    const url = new URL(request.url());
    ledger.requests.push({
      identity,
      method: request.method(),
      origin: url.origin,
      path: url.pathname,
      authorization: request.headers().authorization || null,
    });
  });
  return context;
}

async function inspectMemberPage(page, expected, ownerView, profiles, theme) {
  await page.waitForFunction(() =>
    document.documentElement.getAttribute('data-workforce-state') === 'ready' &&
    document.documentElement.getAttribute('data-northstar-navigation') === 'ready',
  null, { timeout: 15000 });

  const account = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { method: 'GET', credentials: 'same-origin' });
    return { status: response.status, body: await response.json() };
  });
  assert.strictEqual(account.status, 200, expected.name + ' account read');
  assert.strictEqual(account.body.account.membership.role, expected.id === OWNER ? 'owner' : 'member');

  const snapshot = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    legacyCopy: document.body.textContent.includes('(legacy)'),
    duplicateIds: Array.from(document.querySelectorAll('[id]')).map(node => node.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index),
    invitationsHidden: document.getElementById('invitationsPanel').hidden,
    inviteHidden: document.getElementById('invitePanel').hidden,
    enabledStructureControls: Array.from(document.querySelectorAll('#membersList select,#membersList input'))
      .filter(control => !control.disabled).length,
  }));
  assert.strictEqual(snapshot.theme, theme);
  assert.ok(snapshot.overflow <= 1, expected.name + ' has no horizontal overflow');
  assert.strictEqual(snapshot.legacyCopy, false, 'legacy access copy is absent');
  assert.deepStrictEqual(snapshot.duplicateIds, []);

  for (const person of PEOPLE.slice(1)) {
    const profileId = profiles.get(person.id);
    const jobRole = page.locator('#member-role-' + profileId);
    assert.strictEqual(await jobRole.inputValue(), person.operational, person.name + ' operational identity');
    if (!ownerView) assert.strictEqual(await jobRole.isDisabled(), true, 'member cannot edit structure');
    const card = page.locator('[data-profile-id="' + profileId + '"]');
    assert.strictEqual(await card.locator('h3').textContent(), person.name);
    if (ownerView) {
      const access = card.locator('select[aria-label^="Access role"]');
      assert.deepStrictEqual(await access.locator('option').evaluateAll(options => options.map(option => ({
        value: option.value, text: option.textContent,
      }))), [
        { value: 'admin', text: 'Admin' },
        { value: 'member', text: 'Member' },
        { value: 'viewer', text: 'Viewer' },
      ]);
      assert.strictEqual(await access.inputValue(), 'member');
      assert.strictEqual(await access.isDisabled(), false);
    } else {
      assert.strictEqual(await card.locator('select[aria-label^="Access role"]').count(), 0);
    }
  }
  if (ownerView) {
    assert.strictEqual(snapshot.invitationsHidden, false);
    assert.strictEqual(snapshot.inviteHidden, false);
    assert.ok(snapshot.enabledStructureControls > 0);
  } else {
    assert.strictEqual(snapshot.invitationsHidden, true);
    assert.strictEqual(snapshot.inviteHidden, true);
    assert.strictEqual(snapshot.enabledStructureControls, 0);
  }
}

async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  const { browserType, executablePath } = resolveBrowserRuntime(selected);
  const original = new Map();
  const boundedEnvironment = [
    'DATABASE_URL', 'AUTH_ACCESS_SECRET', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
    'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
  ];
  for (const name of boundedEnvironment) original.set(name, process.env[name]);
  const suiteDatabase = await createSuiteDatabase('m20-p7-l3-' + selected);
  const preRoleDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m20-p7-l3-browser-pre-'));
  let bootstrapPool;
  let db;
  let server;
  let browser;
  const ledger = { requests: [], external: [], consoleErrors: [], pageErrors: [] };
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of boundedEnvironment.slice(2)) delete process.env[name];
    for (const filename of fs.readdirSync(MIGRATIONS).filter(name =>
      /^\d{3}_[a-z0-9_]+\.sql$/.test(name) && name !== '020_canonical_workforce_access_roles.sql')) {
      fs.copyFileSync(path.join(MIGRATIONS, filename), path.join(preRoleDirectory, filename));
    }

    db = require('../../src/db');
    bootstrapPool = new Pool({ connectionString: suiteDatabase.connectionString });
    assert.strictEqual(await db.runMigrations({
      pool: bootstrapPool, migrationsDirectory: preRoleDirectory,
    }), true, 'pre-Lane3 schema must initialize');
    await bootstrapPool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1,'Lane 3 Browser Tenant','lane3-browser@example.test')`,
      [ORG]
    );
    for (const person of PEOPLE) {
      await bootstrapPool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [person.id, ORG, person.name, `${person.id}@lane3-browser.test`, person.access]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(bootstrapPool, {
      organizationId: ORG,
      userId: OWNER,
      expectedVersion: null,
      profile: canonicalFenceProfile({ companyName: 'Lane 3 Browser Tenant' }),
    });
    const sessions = new Map();
    for (const person of PEOPLE) {
      sessions.set(person.id, await provisionDurableSession(bootstrapPool, {
        userId: person.id, organizationId: ORG, role: person.access,
      }));
    }
    const before = await bootstrapPool.query(
      `SELECT membership.user_id, membership.role, profile.operational_role
         FROM organization_memberships membership
         JOIN workforce_profiles profile ON profile.membership_id = membership.id
        WHERE membership.user_id IN ($1,$2)
        ORDER BY membership.user_id`,
      [DISPATCHER, TECHNICIAN]
    );
    assert.deepStrictEqual(before.rows, [
      { user_id: DISPATCHER, role: 'dispatcher', operational_role: 'dispatcher' },
      { user_id: TECHNICIAN, role: 'tech', operational_role: 'technician' },
    ]);
    assert.strictEqual(await db.runMigrations({ pool: bootstrapPool, migrationsDirectory: MIGRATIONS }), true);
    const profiles = new Map((await bootstrapPool.query(
      `SELECT membership.user_id, profile.id
         FROM organization_memberships membership
         JOIN workforce_profiles profile ON profile.membership_id = membership.id
        WHERE membership.organization_id = $1`,
      [ORG]
    )).rows.map(row => [row.user_id, row.id]));
    await bootstrapPool.end();
    bootstrapPool = null;

    assert.strictEqual(await db.initDatabase(), true, 'post-Lane3 schema must initialize');
    const originalFetch = global.fetch;
    global.fetch = async () => { throw new Error('provider fetch must remain unused'); };
    const { app } = require('../../src/server');
    global.fetch = originalFetch;
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await browserType.launch({ headless: true, executablePath });
    const browserVersion = browser.version();
    if (selected === 'chrome') assert.match(browserVersion, /^150\./, 'Chrome for Testing 150 is required');
    else assert.strictEqual(browserVersion, '26.5', 'actual Playwright WebKit 26.5 is required');

    const runs = [
      { person: PEOPLE[0], viewport: { width: 1280, height: 900 }, theme: 'light', ownerView: true },
      { person: PEOPLE[0], viewport: { width: 390, height: 844 }, theme: 'dark', ownerView: true },
      { person: PEOPLE[1], viewport: { width: 1280, height: 900 }, theme: 'dark', ownerView: false },
      { person: PEOPLE[1], viewport: { width: 390, height: 844 }, theme: 'light', ownerView: false },
      { person: PEOPLE[2], viewport: { width: 1280, height: 900 }, theme: 'light', ownerView: false },
      { person: PEOPLE[2], viewport: { width: 390, height: 844 }, theme: 'dark', ownerView: false },
    ];
    for (const run of runs) {
      const identity = `${run.person.operational}-${run.viewport.width === 390 ? 'mobile' : 'desktop'}`;
      const context = await contextFor(
        browser, origin, sessions.get(run.person.id), run.viewport, run.theme, ledger, identity
      );
      const page = await context.newPage();
      page.on('pageerror', error => ledger.pageErrors.push(identity + ': ' + (error.stack || error.message)));
      page.on('console', message => {
        if (message.type() === 'error') ledger.consoleErrors.push(identity + ': ' + message.text());
      });
      await page.goto(origin + '/dashboard/team', { waitUntil: 'domcontentloaded' });
      await inspectMemberPage(page, run.person, run.ownerView, profiles, run.theme);
      await page.evaluate(() => window.NorthStarWorkforce.reload());
      await inspectMemberPage(page, run.person, run.ownerView, profiles, run.theme);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await inspectMemberPage(page, run.person, run.ownerView, profiles, run.theme);
      await context.close();
    }

    assert.deepStrictEqual(ledger.external, [], 'all external/provider requests are intercepted and absent');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'no browser console errors');
    assert.deepStrictEqual(ledger.pageErrors, [], 'no browser page errors');
    assert.ok(ledger.requests.every(entry => entry.authorization === null), 'cookies only; no Authorization headers');
    assert.ok(ledger.requests.every(entry => entry.method === 'GET'), 'focused browser acceptance is GET-only');
    const authority = await db.getPool().query(
      `SELECT membership.user_id, membership.role, profile.operational_role, session.status AS session_status
         FROM organization_memberships membership
         JOIN workforce_profiles profile ON profile.membership_id = membership.id
         JOIN auth_sessions session ON session.membership_id = membership.id
        WHERE membership.user_id IN ($1,$2)
        ORDER BY membership.user_id`,
      [DISPATCHER, TECHNICIAN]
    );
    assert.deepStrictEqual(authority.rows, [
      { user_id: DISPATCHER, role: 'member', operational_role: 'dispatcher', session_status: 'active' },
      { user_id: TECHNICIAN, role: 'member', operational_role: 'technician', session_status: 'active' },
    ]);

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      version: browserVersion,
      database: suiteDatabase.databaseName,
      identities: ['owner', 'member/dispatcher', 'member/technician'],
      viewports: ['desktop', 'mobile'],
      lifecycle: ['initial', 'rerender', 'reload'],
      requests: ledger.requests.length,
      writes: ledger.requests.filter(entry => entry.method !== 'GET').length,
      providerRequests: ledger.external.length,
      consoleErrors: ledger.consoleErrors.length,
      pageErrors: ledger.pageErrors.length,
      physicalSafari: false,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (bootstrapPool) await bootstrapPool.end();
    if (db && db.getPool()) await db.getPool().end();
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    if (path.resolve(preRoleDirectory).startsWith(path.resolve(os.tmpdir()))) {
      fs.rmSync(preRoleDirectory, { recursive: true, force: true });
    }
    await suiteDatabase.cleanup();
  }
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error.stack || error.message);
    process.exit(1);
  }
);
