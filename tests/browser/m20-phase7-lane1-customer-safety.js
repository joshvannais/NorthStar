'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const ROOT = path.resolve(__dirname, '..', '..');
const ORGANIZATION_ID = '7e300000-0000-4000-8000-000000000001';
const OWNER_ID = '7e400000-0000-4000-8000-000000000001';
const VIEWER_ID = '7e400000-0000-4000-8000-000000000002';
const CFT_VERSION = '150.0.7871.129';
const WEBKIT_VERSION = '26.5';
const POISON = Object.freeze({
  name: 'Customer\"><a data-phase7-name href="https://phase7.invalid/navigation" onclick="window.__phase7name=1">Poison</a><img data-phase7-name src="https://phase7.invalid/name" onerror="window.__phase7name=1">',
  phone: '555</div><svg data-phase7-phone onload="window.__phase7phone=1"></svg>',
  email: 'mail<a data-phase7-email href="https://phase7.invalid/email">@example.test</a>',
  address: '1 Main</div><iframe data-phase7-address src="https://phase7.invalid/address"></iframe>',
  service: 'repair</div><img data-phase7-service src="https://phase7.invalid/service">',
  jobDetail: 'scope</div><script data-phase7-job>window.__phase7job=1</script>',
});
const PROVIDER_ENVIRONMENT = Object.freeze([
  'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
]);
const SURFACES = Object.freeze([
  { key: 'leads', route: '/dashboard/leads', ready: '.leads-table tbody tr' },
  { key: 'communications', route: '/dashboard/communications', ready: '.call-card' },
  { key: 'command-center', route: '/dashboard', ready: '#ccCustomers .cc-cust-item' },
  { key: 'legacy-dashboard', route: '/dashboard/legacy', ready: '#ccCustomers .cc-cust-item' },
  { key: 'calendar', route: '/dashboard/calendar', ready: '.cal-layout[aria-busy="false"]' },
  { key: 'executive-brief', route: '/dashboard/executive-brief', ready: '#ebCustomers .eb-customer-item' },
  { key: 'lead-detail', route: null, ready: '#leadDetailContainer .lead-detail-header' },
]);

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

function stableJson(value) {
  return JSON.stringify(value, function (_key, item) {
    return item instanceof Date ? item.toISOString() : item;
  });
}

async function databaseDigest(pool) {
  const tables = {
    canonical_operations: 'organization_id, id',
    canonical_customers: 'organization_id, id',
    canonical_transcripts: 'organization_id, id',
    canonical_communications: 'organization_id, id',
    canonical_opportunities: 'organization_id, id',
    canonical_estimates: 'organization_id, id',
    canonical_appointments: 'organization_id, id',
    canonical_polaris_snapshots: 'organization_id, id',
    canonical_facts: 'organization_id, id',
  };
  const result = {};
  for (const [table, order] of Object.entries(tables)) {
    const rows = (await pool.query(`SELECT * FROM ${table} ORDER BY ${order}`)).rows;
    result[table] = crypto.createHash('sha256').update(stableJson(rows), 'utf8').digest('hex');
  }
  return result;
}

function utf8Hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

async function authorityReceipt(pool, ids) {
  const result = await pool.query(
    `SELECT
       encode(convert_to(c.name, 'UTF8'), 'hex') AS name_hex,
       encode(convert_to(c.phone, 'UTF8'), 'hex') AS phone_hex,
       encode(convert_to(c.email, 'UTF8'), 'hex') AS email_hex,
       encode(convert_to(c.address #>> '{}', 'UTF8'), 'hex') AS address_hex,
       encode(convert_to(o.service_type, 'UTF8'), 'hex') AS service_hex,
       encode(convert_to(o.job_scope #>> '{}', 'UTF8'), 'hex') AS job_detail_hex,
       (SELECT encode(convert_to(profile.raw_profile #>> '{services,0,name}', 'UTF8'), 'hex')
          FROM canonical_business_profiles profile
         WHERE profile.organization_id = c.organization_id AND profile.is_active = TRUE
         ORDER BY profile.created_at DESC LIMIT 1) AS profile_service_hex
     FROM canonical_customers c
     JOIN canonical_opportunities o
       ON o.organization_id = c.organization_id AND o.customer_id = c.id
     WHERE c.organization_id = $1 AND c.id = $2 AND o.id = $3`,
    [ORGANIZATION_ID, ids.customer, ids.opportunity]
  );
  assert.strictEqual(result.rows.length, 1, 'one poison authority row');
  return result.rows[0];
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

async function createContext(browser, origin, session, spec, ledger) {
  const context = await browser.newContext({ viewport: spec.viewport, colorScheme: spec.theme });
  await context.addInitScript(() => {
    window.__phase7name = 0;
    window.__phase7phone = 0;
    window.__phase7job = 0;
    window.__phase7OpenCalls = [];
    const realOpen = window.open;
    window.open = function (url, target, features) {
      window.__phase7OpenCalls.push({ url: String(url), target: String(target || ''), features: String(features || '') });
      return realOpen.call(window, url, target, features);
    };
  });
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('**/*', route => {
    const browserRequest = route.request();
    const url = new URL(browserRequest.url());
    if (url.origin === origin) return route.continue();
    ledger.externalRequests.push({ label: spec.label, method: browserRequest.method(), url: browserRequest.url() });
    return route.abort('blockedbyclient');
  });
  context.on('request', browserRequest => {
    const url = new URL(browserRequest.url());
    ledger.requests.push({ label: spec.label, method: browserRequest.method(), origin: url.origin, path: url.pathname });
  });
  context.on('page', page => {
    page.on('pageerror', error => ledger.pageErrors.push(`${spec.label}: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') ledger.consoleErrors.push(`${spec.label}: ${message.text()}`);
    });
  });
  return context;
}

async function securityState(page) {
  await page.waitForTimeout(75);
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('*'));
    const phase7Nodes = nodes.filter(node => Array.from(node.attributes || []).some(attribute =>
      attribute.name.indexOf('data-phase7') === 0 ||
      (/^(?:href|src)$/i.test(attribute.name) && /phase7\.invalid/i.test(attribute.value))
    ));
    const handlers = nodes.flatMap(node => Array.from(node.attributes || []).filter(attribute =>
      /^on/i.test(attribute.name) && /phase7/i.test(attribute.value)
    ).map(attribute => ({ tag: node.tagName, name: attribute.name, value: attribute.value })));
    const scripts = Array.from(document.scripts).filter(node =>
      String(node.type || '').toLowerCase() !== 'application/json' &&
      (/phase7/i.test(node.textContent || '') || /phase7/i.test(node.getAttribute('src') || ''))
    );
    return {
      phase7Nodes: phase7Nodes.map(node => ({ tag: node.tagName, html: node.outerHTML.slice(0, 500) })),
      handlers,
      scripts: scripts.map(node => node.outerHTML.slice(0, 500)),
      flags: {
        name: window.__phase7name || 0,
        phone: window.__phase7phone || 0,
        job: window.__phase7job || 0,
      },
      openCalls: window.__phase7OpenCalls || [],
      url: window.location.href,
    };
  });
}

function collectCheck(findings, label, condition, detail) {
  if (!condition) findings.push(`${label}: ${detail}`);
}

async function assertDrawer(page, label, findings) {
  await page.waitForSelector('#cdCustomerDrawer.open #cdDrawerContent', { state: 'attached' });
  await page.waitForFunction(() => document.getElementById('cdDrawerContent').style.display !== 'none');
  const values = await page.evaluate(() => ({
    name: document.getElementById('cdName').textContent,
    phone: document.getElementById('cdPhone').textContent,
    email: document.getElementById('cdEmail').textContent,
    address: document.getElementById('cdAddress').textContent,
    service: document.getElementById('cdService').textContent,
    navigationState: document.getElementById('cdNavigationLauncher').dataset.state,
    open: document.getElementById('cdCustomerDrawer').classList.contains('open'),
  }));
  collectCheck(findings, label, values.open, 'customer drawer did not open');
  collectCheck(findings, label, values.name === POISON.name, 'drawer name bytes/text changed');
  collectCheck(findings, label, values.phone === POISON.phone, 'drawer phone bytes/text changed');
  collectCheck(findings, label, values.email === POISON.email, 'drawer email bytes/text changed');
  collectCheck(findings, label, values.address === 'Address unavailable', 'unsafe drawer address did not fail closed');
  collectCheck(findings, label, ['unavailable', 'error'].includes(values.navigationState), 'unsafe drawer navigation did not fail closed');
  collectCheck(findings, label, values.service === POISON.service, 'drawer service bytes/text changed');
  await page.locator('#cdDrawerClose').click();
  await page.waitForFunction(() => !document.getElementById('cdCustomerDrawer').classList.contains('open'));
}

async function exerciseLeads(page, ids, findings) {
  const row = page.locator('.leads-table tbody tr').filter({ hasText: 'Customer' }).first();
  const rowText = await row.textContent();
  collectCheck(findings, 'leads', rowText.includes(POISON.name), 'name did not remain literal text');
  collectCheck(findings, 'leads', rowText.includes(POISON.phone), 'phone did not remain literal text');
  collectCheck(findings, 'leads', rowText.includes(POISON.service), 'service did not remain literal text');
  await row.click({ position: { x: 5, y: 5 } });
  await assertDrawer(page, 'leads', findings);
  const menuButton = row.locator('.more-btn');
  await menuButton.focus();
  collectCheck(findings, 'leads', await menuButton.evaluate(node => document.activeElement === node), 'actions button lost focusability');
  await menuButton.click();
  collectCheck(findings, 'leads', await row.locator('.more-dropdown').evaluate(node => node.classList.contains('open')), 'actions menu did not open');
  await row.locator('.more-dropdown-item').filter({ hasText: 'Mark Contacted' }).click();
  collectCheck(findings, 'leads', new URL(page.url()).pathname === '/dashboard/leads', 'read-only action navigated unexpectedly');
  collectCheck(findings, 'leads', Boolean(ids.customer), 'customer identifier missing');
}

async function exerciseCommunications(page, findings) {
  const card = page.locator('.call-card').filter({ hasText: 'Customer' }).first();
  const text = await card.textContent();
  collectCheck(findings, 'communications', text.includes(POISON.name), 'name did not remain literal text');
  await card.locator('.call-card-header').click();
  await assertDrawer(page, 'communications', findings);
}

async function exerciseCommandCenter(page, findings) {
  const item = page.locator('#ccCustomers .cc-cust-item').filter({ hasText: 'Customer' }).first();
  const name = await item.locator('.cc-cust-name').textContent();
  collectCheck(findings, 'command-center', name === POISON.name, 'name did not remain literal text');
  await item.locator('.cc-cust-name').click();
  await assertDrawer(page, 'command-center', findings);
}

async function exerciseLegacyDashboard(page, origin, findings) {
  const item = page.locator('#ccCustomers .cc-cust-item').filter({ hasText: 'Customer' }).first();
  const name = await item.locator('.cc-cust-name').textContent();
  collectCheck(findings, 'legacy-dashboard', name === POISON.name, 'name did not remain literal text');
  collectCheck(findings, 'legacy-dashboard', await item.getAttribute('href') === '/dashboard/polaris', 'Polaris navigation href changed');
  await item.focus();
  collectCheck(findings, 'legacy-dashboard', await item.evaluate(node => document.activeElement === node), 'Polaris navigation lost focusability');
  await item.click();
  await page.waitForURL(origin + '/dashboard/polaris');
  collectCheck(findings, 'legacy-dashboard', new URL(page.url()).pathname === '/dashboard/polaris', 'Polaris navigation did not complete');
}

async function exerciseCalendar(page, appointmentId, findings) {
  await page.waitForFunction(id => window.calState && window.calState.events.some(event => event.id === id), appointmentId);
  const monthTitle = await page.locator('.cal-month-cell-today .cal-month-event-dot').first().getAttribute('title');
  collectCheck(findings, 'calendar-month', monthTitle === POISON.name, 'month tooltip did not preserve literal name');
  await page.locator('.cal-month-cell-today').evaluate(node => node.click());
  const today = await page.evaluate(() => window.calState._formatDate(new Date()));
  collectCheck(findings, 'calendar-month', await page.evaluate(() => window.calState.selectedDate) === today, 'month day selection changed');

  for (const view of ['week', 'day', 'agenda']) {
    await page.locator('.cal-view-tab').filter({ hasText: new RegExp(`^${view}$`, 'i') }).click();
    await page.waitForFunction(expected => window.calState.view === expected, view);
    const selector = view === 'week' ? '.cal-week-event' : view === 'day' ? '.cal-day-event-card' : '.cal-agenda-event';
    const event = page.locator(selector).first();
    await event.waitFor({ state: 'attached' });
    const text = await event.textContent();
    collectCheck(findings, `calendar-${view}`, text.includes(POISON.name), `${view} event did not preserve literal name`);
    if (view === 'day') {
      collectCheck(findings, 'calendar-day', text.includes(POISON.service), 'day service did not remain literal text');
    }
    await event.evaluate(node => node.click());
    collectCheck(findings, `calendar-${view}`, await page.evaluate(id => window.calState.selectedEvent && window.calState.selectedEvent.id === id, appointmentId), 'event selection changed');
  }
  const todayItem = page.locator('#calendarEventList .cal-event-list-item').first();
  const todayText = await todayItem.textContent();
  collectCheck(findings, 'calendar-today-list', todayText.includes(POISON.name), 'today list did not preserve literal name');
  await todayItem.evaluate(node => node.click());
  collectCheck(findings, 'calendar-today-list', await page.evaluate(id => window.calState.selectedEvent && window.calState.selectedEvent.id === id, appointmentId), 'today-list selection changed');
}

async function exerciseExecutiveBrief(page, findings) {
  const name = await page.locator('#ebCustomers .eb-customer-name').filter({ hasText: 'Customer' }).first().textContent();
  collectCheck(findings, 'executive-brief', name === POISON.name, 'name did not remain literal text');
}

async function exerciseLeadDetail(page, findings) {
  const state = await page.evaluate(() => ({
    name: document.getElementById('leadCustomerName').textContent,
    subtitle: document.querySelector('.lead-detail-subtitle').textContent,
    body: document.getElementById('leadDetailContainer').textContent,
    address: document.getElementById('leadCanonicalAddress').textContent,
    navigationState: document.getElementById('leadNavigationLauncher').dataset.state,
    backHref: document.querySelector('.lead-actions a').getAttribute('href'),
    contactType: document.querySelector('.lead-actions button').tagName,
  }));
  collectCheck(findings, 'lead-detail', state.name === POISON.name, 'header name did not remain literal text');
  collectCheck(findings, 'lead-detail', state.subtitle.includes(POISON.service), 'subtitle service did not remain literal text');
  collectCheck(findings, 'lead-detail', state.subtitle.includes(POISON.phone), 'subtitle phone did not remain literal text');
  collectCheck(findings, 'lead-detail', state.body.includes(POISON.jobDetail), 'job detail did not remain literal text');
  collectCheck(findings, 'lead-detail', state.address === 'Address unavailable', 'unsafe address did not fail closed');
  collectCheck(findings, 'lead-detail', ['unavailable', 'error'].includes(state.navigationState), 'unsafe navigation did not fail closed');
  collectCheck(findings, 'lead-detail', state.backHref === '/dashboard/leads', 'back navigation href changed');
  collectCheck(findings, 'lead-detail', state.contactType === 'BUTTON', 'contact action contract changed');
  await page.locator('.lead-actions a').focus();
  collectCheck(findings, 'lead-detail', await page.locator('.lead-actions a').evaluate(node => document.activeElement === node), 'back navigation lost focusability');
}

async function exerciseSurface(page, surface, origin, ids, findings) {
  if (surface.key === 'leads') return exerciseLeads(page, ids, findings);
  if (surface.key === 'communications') return exerciseCommunications(page, findings);
  if (surface.key === 'command-center') return exerciseCommandCenter(page, findings);
  if (surface.key === 'legacy-dashboard') return exerciseLegacyDashboard(page, origin, findings);
  if (surface.key === 'calendar') return exerciseCalendar(page, ids.appointment, findings);
  if (surface.key === 'executive-brief') return exerciseExecutiveBrief(page, findings);
  if (surface.key === 'lead-detail') return exerciseLeadDetail(page, findings);
  throw new Error(`unknown surface ${surface.key}`);
}

async function exerciseRole(browser, origin, role, session, ids, ledger) {
  const spec = {
    label: `${role}-${role === 'owner' ? 'desktop-light' : 'mobile-dark'}`,
    viewport: role === 'owner' ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    theme: role === 'owner' ? 'light' : 'dark',
  };
  const context = await createContext(browser, origin, session, spec, ledger);
  const findings = [];
  try {
    for (const surface of SURFACES) {
      const page = await context.newPage();
      const route = surface.route || `/dashboard/lead?id=${encodeURIComponent(ids.opportunity)}`;
      const expectedUrl = origin + route;
      const response = await page.goto(expectedUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      assert.strictEqual(response.status(), 200, `${spec.label} ${surface.key} mounted response`);
      await page.waitForSelector(surface.ready, { state: 'attached', timeout: 20000 });
      const beforeInteraction = await securityState(page);
      collectCheck(findings, `${surface.key}-security-before`, beforeInteraction.phase7Nodes.length === 0, JSON.stringify(beforeInteraction.phase7Nodes));
      collectCheck(findings, `${surface.key}-security-before`, beforeInteraction.handlers.length === 0, JSON.stringify(beforeInteraction.handlers));
      collectCheck(findings, `${surface.key}-security-before`, beforeInteraction.scripts.length === 0, JSON.stringify(beforeInteraction.scripts));
      collectCheck(findings, `${surface.key}-security-before`, Object.values(beforeInteraction.flags).every(value => value === 0), JSON.stringify(beforeInteraction.flags));
      collectCheck(findings, `${surface.key}-security-before`, beforeInteraction.openCalls.length === 0, JSON.stringify(beforeInteraction.openCalls));
      collectCheck(findings, `${surface.key}-security-before`, beforeInteraction.url === expectedUrl, `unexpected URL ${beforeInteraction.url}`);
      await exerciseSurface(page, surface, origin, ids, findings);
      if (surface.key !== 'legacy-dashboard') {
        const afterInteraction = await securityState(page);
        collectCheck(findings, `${surface.key}-security-after`, afterInteraction.phase7Nodes.length === 0, JSON.stringify(afterInteraction.phase7Nodes));
        collectCheck(findings, `${surface.key}-security-after`, afterInteraction.handlers.length === 0, JSON.stringify(afterInteraction.handlers));
        collectCheck(findings, `${surface.key}-security-after`, afterInteraction.scripts.length === 0, JSON.stringify(afterInteraction.scripts));
        collectCheck(findings, `${surface.key}-security-after`, Object.values(afterInteraction.flags).every(value => value === 0), JSON.stringify(afterInteraction.flags));
        collectCheck(findings, `${surface.key}-security-after`, afterInteraction.openCalls.length === 0, JSON.stringify(afterInteraction.openCalls));
        collectCheck(findings, `${surface.key}-security-after`, afterInteraction.url === expectedUrl, `unexpected URL ${afterInteraction.url}`);
      }
      await page.close();
    }
  } finally {
    await context.close();
  }
  return findings.map(finding => `${spec.label}: ${finding}`);
}

async function main() {
  const selected = process.argv[2] || process.env.BROWSER || 'chrome';
  assert.ok(['chrome', 'webkit'].includes(selected), 'Usage: node tests/browser/m20-phase7-lane1-customer-safety.js chrome|webkit');
  const runtime = resolveBrowserRuntime(selected);
  const beforeData = dataDigest();
  const suiteDatabase = await createSuiteDatabase(`m20-phase7-lane1-${selected}`);
  const environmentNames = ['DATABASE_URL', 'AUTH_ACCESS_SECRET'].concat(PROVIDER_ENVIRONMENT);
  const originalEnvironment = new Map(environmentNames.map(name => [name, process.env[name]]));
  const originalFetch = global.fetch;
  process.env.DATABASE_URL = suiteDatabase.connectionString;
  process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
  PROVIDER_ENVIRONMENT.forEach(name => { delete process.env[name]; });
  global.fetch = async function () { throw new Error('provider boundary must remain unused'); };

  let db;
  let server;
  let browser;
  try {
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

    await pool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1, 'Phase 7 Lane 1 Browser', 'phase7-lane1-browser@example.test')`,
      [ORGANIZATION_ID]
    );
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
       VALUES
         ($1,$3,'Phase 7 Owner','phase7-browser-owner@example.test','not-used','owner','active'),
         ($2,$3,'Phase 7 Viewer','phase7-browser-viewer@example.test','not-used','viewer','active')`,
      [OWNER_ID, VIEWER_ID, ORGANIZATION_ID]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORGANIZATION_ID,
      userId: OWNER_ID,
      expectedVersion: null,
      profile: canonicalFenceProfile({ version: 'm20-phase7-lane1-browser-v1', serviceName: POISON.service }),
    });
    const ownerSession = await provisionDurableSession(pool, {
      userId: OWNER_ID, organizationId: ORGANIZATION_ID, role: 'owner',
    });
    const viewerSession = await provisionDurableSession(pool, {
      userId: VIEWER_ID, organizationId: ORGANIZATION_ID, role: 'viewer',
    });
    const { app } = require('../../src/server');
    const created = await request(app).post('/api/leads')
      .set(ownerSession.headers)
      .set('Idempotency-Key', 'phase7-lane1-browser-poison')
      .send({
        customerName: POISON.name,
        phone: POISON.phone,
        email: POISON.email,
        address: POISON.address,
        service: 'fence',
        scope: POISON.jobDetail,
        externalCustomerId: 'phase7-lane1-browser-poison-customer',
      });
    assert.strictEqual(created.status, 201, 'mounted owner poison write');
    const ids = created.body.ids;
    const scheduledStart = new Date();
    scheduledStart.setHours(10, 0, 0, 0);
    const scheduledEnd = new Date(scheduledStart.getTime() + 60 * 60 * 1000);
    await pool.query(
      `UPDATE canonical_opportunities
          SET job_scope = to_jsonb($3::text)
        WHERE organization_id = $1 AND id = $2`,
      [ORGANIZATION_ID, ids.opportunity, POISON.jobDetail]
    );
    await pool.query(
      `UPDATE canonical_appointments
          SET scheduled_start = $3, scheduled_end = $4, status = 'scheduled'
        WHERE organization_id = $1 AND id = $2`,
      [ORGANIZATION_ID, ids.appointment, scheduledStart, scheduledEnd]
    );

    const expectedReceipt = {
      name_hex: utf8Hex(POISON.name),
      phone_hex: utf8Hex(POISON.phone),
      email_hex: utf8Hex(POISON.email),
      address_hex: utf8Hex(POISON.address),
      service_hex: utf8Hex('fence'),
      job_detail_hex: utf8Hex(POISON.jobDetail),
      profile_service_hex: utf8Hex(POISON.service),
    };
    const beforeReceipt = await authorityReceipt(pool, ids);
    assert.deepStrictEqual(beforeReceipt, expectedReceipt, 'raw PostgreSQL poison authority bytes');
    const beforeDatabase = await databaseDigest(pool);

    server = await listen(app);
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
    if (selected === 'chrome') assert.strictEqual(browser.version(), CFT_VERSION);
    if (selected === 'webkit') assert.strictEqual(browser.version(), WEBKIT_VERSION);

    const ledger = { requests: [], externalRequests: [], pageErrors: [], consoleErrors: [] };
    const findings = [];
    for (const [role, session] of [['owner', ownerSession], ['viewer', viewerSession]]) {
      findings.push(...await exerciseRole(browser, origin, role, session, ids, ledger));
    }
    const nonReadRequests = ledger.requests.filter(entry => !['GET', 'HEAD', 'OPTIONS'].includes(entry.method));
    const providerRequests = ledger.requests.filter(entry => /retell|twilio|stripe|resend|jobber|provider/i.test(entry.origin + entry.path));
    const poisonRequests = ledger.externalRequests.filter(entry => new URL(entry.url).hostname === 'phase7.invalid');
    console.log('PHASE7_LANE1_BROWSER_RECEIPT ' + JSON.stringify({
      findings: findings.length,
      poisonRequests: poisonRequests.length,
      externalRequests: ledger.externalRequests.length,
      nonReadRequests: nonReadRequests.length,
      providerRequests: providerRequests.length,
      pageErrors: ledger.pageErrors.length,
      consoleErrors: ledger.consoleErrors.length,
    }));
    assert.deepStrictEqual(nonReadRequests, [], 'browser surface and interaction matrix is GET-only');
    assert.deepStrictEqual(providerRequests, [], 'browser matrix must not contact providers');
    assert.deepStrictEqual(poisonRequests, [], 'customer content must not trigger external requests');
    assert.deepStrictEqual(ledger.externalRequests, [], 'browser matrix must remain origin-local');
    assert.deepStrictEqual(ledger.pageErrors, [], 'browser page errors');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'browser console errors');
    assert.deepStrictEqual(findings, [], 'customer content must remain literal and inert on every mounted surface');

    const afterReceipt = await authorityReceipt(pool, ids);
    const afterDatabase = await databaseDigest(pool);
    assert.deepStrictEqual(afterReceipt, beforeReceipt, 'raw PostgreSQL authority bytes remain unchanged');
    assert.deepStrictEqual(afterDatabase, beforeDatabase, 'canonical PostgreSQL authority remains unchanged');
    console.log(JSON.stringify({
      browser: selected,
      version: browser.version(),
      postgres: identity.rows[0],
      roles: ['owner', 'viewer'],
      surfaces: SURFACES.map(surface => surface.key),
      views: ['month', 'week', 'day', 'agenda', 'today-list'],
      canonicalDigest: beforeDatabase,
      rawAuthority: 'byte_exact_before_after',
      browserMutations: 0,
      providerRequests: 0,
      externalRequests: 0,
      findings: 0,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db) await db.close();
    global.fetch = originalFetch;
    originalEnvironment.forEach((value, name) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
    await suiteDatabase.cleanup();
    assert.strictEqual(dataDigest(), beforeData, 'browser matrix must not change repository data');
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
