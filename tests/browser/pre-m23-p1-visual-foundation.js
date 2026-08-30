'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const DIGEST = 'a'.repeat(64);
const HOSTILE = '<img src=x onerror="globalThis.preM23P1Compromised=true">';

function quoted(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
function roleUrl(connectionString, role) {
  const parsed = new URL(connectionString);
  parsed.username = role;
  parsed.password = '';
  return parsed.toString();
}
function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}
async function createRoles(database, matrix) {
  const suffix = `${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  const migrationRole = `northstar-p1-m-${matrix}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 63);
  const runtimeRole = `northstar-p1-r-${matrix}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 63);
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${quoted(migrationRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`CREATE ROLE ${quoted(runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`ALTER DATABASE ${quoted(database.databaseName)} OWNER TO ${quoted(migrationRole)}`);
  } finally { await admin.end(); }
  return {
    migrationRole, runtimeRole,
    migrationUrl: roleUrl(database.connectionString, migrationRole),
    runtimeUrl: roleUrl(database.connectionString, runtimeRole),
  };
}
async function dropRoles(roles) {
  if (!roles) return;
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP ROLE ${quoted(roles.runtimeRole)}`);
    await admin.query(`DROP ROLE ${quoted(roles.migrationRole)}`);
  } finally { await admin.end(); }
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
function todayData(hostile) {
  const text = hostile ? HOSTILE : '';
  return {
    version: 'm22-part6-today-v1', readOnly: true, mutationCapabilities: [],
    evaluatedAt: '2026-08-30T14:00:00.000Z',
    identity: {
      displayName: hostile ? `Alex Rivera ${text}` : 'Alex Rivera',
      operationalRole: 'technician',
    },
    day: {
      date: '2026-08-30', start: '2026-08-30T10:00:00.000Z',
      end: '2026-08-31T10:00:00.000Z', timeZone: 'Pacific/Honolulu',
    },
    count: 1, shown: 1, total: 1, truncated: false, digest: DIGEST,
    records: [{
      appointmentId: hostile ? `appointment-${text}` : 'd1600000-0000-4000-8000-000000000001',
      title: hostile ? `Kitchen drain ${text}` : 'Kitchen Sink Drain Backup',
      serviceType: 'Drain Service',
      schedule: { start: '2026-08-30T21:15:00.000Z', end: '2026-08-30T22:35:00.000Z', state: 'scheduled', spansDayBoundary: false },
      assignment: { direct: true, label: hostile ? `Alex Rivera ${text}` : 'Alex Rivera' },
      dispatch: { state: 'dispatched' },
      customer: {
        name: hostile ? `Jamie Carter ${text}` : 'Jamie Carter', phone: '+1 555 010 6005',
        serviceLocation: {
          street: hostile ? `12 Test Way ${text}` : '12 Test Way', city: 'Boston', state: 'MA', postalCode: '02110', country: 'US',
        },
      },
      instructions: { text: hostile ? `Park in the driveway. ${text}` : 'Park in the driveway and use the side entrance.', truncated: false },
      route: {
        status: 'needs_review', providerNeutral: true, providerCalls: 0,
        implications: ['Current scheduling authority needs review.'],
        uncertainty: ['No live provider lookup was performed.'],
      },
      review: { needsReview: true },
      crew: null,
      authority: { revision: 4, digest: DIGEST },
    }],
  };
}
async function assertNoOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth, root: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  assert.ok(Math.max(dimensions.body, dimensions.root) <= dimensions.viewport + 1,
    `${label} horizontally overflows: ${JSON.stringify(dimensions)}`);
}
async function renderToday(browser, origin, evidenceRoot, securityRoot, entries, securityEntries, fixture) {
  const context = await browser.newContext({ viewport: fixture.viewport, colorScheme: fixture.theme });
  await context.addInitScript(theme => {
    localStorage.setItem('northstar-theme', theme);
    globalThis.preM23P1Compromised = false;
  }, fixture.theme);
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(String(error)));
  await page.route('**/api/v1/today', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: todayData(fixture.hostile), requestId: 'pre-m23-p1-visual' }),
  }));
  await page.goto(`${origin}/dashboard/today`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.dataset.todayState === 'ready');
  assert.strictEqual(await page.locator('#todayTitle').textContent(), 'Today');
  assert.strictEqual(await page.locator('#todayAuthority').evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap');
  const fonts = await page.evaluate(() => ({
    title: getComputedStyle(document.querySelector('#todayTitle')).fontFamily,
    readOnly: getComputedStyle(document.querySelector('.today-readonly-badge')).fontFamily,
    reload: getComputedStyle(document.querySelector('#todayRefresh')).fontFamily,
    readOnlyWeight: getComputedStyle(document.querySelector('.today-readonly-badge')).fontWeight,
    reloadWeight: getComputedStyle(document.querySelector('#todayRefresh')).fontWeight,
  }));
  assert.strictEqual(fonts.readOnly, fonts.reload);
  assert.strictEqual(fonts.readOnlyWeight, fonts.reloadWeight);
  assert.match(fonts.title, /Segoe UI|BlinkMacSystemFont|-apple-system/i);
  await assertNoOverflow(page, fixture.label);
  const headerAtLoad = await page.locator('.today-header').evaluate(node => node.getBoundingClientRect().top);
  assert.ok(Math.abs(headerAtLoad) <= 1, `${fixture.label} header is not at the true top: ${headerAtLoad}`);
  await page.evaluate(() => scrollTo(0, Math.min(700, document.documentElement.scrollHeight)));
  await page.waitForTimeout(100);
  const headerAfterScroll = await page.locator('.today-header').evaluate(node => node.getBoundingClientRect().top);
  assert.ok(Math.abs(headerAfterScroll) <= 1, `${fixture.label} sticky header moved: ${headerAfterScroll}`);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(100);
  assert.ok(await page.locator('footer a[href="/privacy"]').isVisible());
  assert.ok(await page.locator('footer a[href="/terms"]').isVisible());
  assert.ok(await page.locator('footer a[href="/legal"]').isVisible());
  assert.ok(await page.locator('button.today-sign-out').count() >= 1);
  const toggle = page.locator('[data-northstar-theme-toggle]').first();
  assert.strictEqual(await toggle.getAttribute('data-current-theme'), fixture.theme);
  assert.match(await toggle.getAttribute('aria-label'), new RegExp(`Current theme: ${fixture.theme}`));
  if (fixture.hostile) {
    assert.strictEqual(await page.evaluate(() => globalThis.preM23P1Compromised), false);
    assert.strictEqual(await page.locator('#todayRecords img[src="x"]').count(), 0);
    assert.strictEqual(await page.locator('#todayRecords').evaluate(node => /onerror|globalThis/i.test(node.innerText)), false);
  }
  assert.deepStrictEqual(browserErrors, []);
  const directory = fixture.hostile ? securityRoot : evidenceRoot;
  const filename = path.join(directory, `${fixture.label}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  const entry = {
    file: path.basename(filename), sha256: sha256File(filename),
    viewport: fixture.viewport, theme: fixture.theme, fixture: fixture.hostile ? 'hostile-security' : 'ordinary-visual',
  };
  (fixture.hostile ? securityEntries : entries).push(entry);
  await context.close();
}
async function renderSharedRoute(browser, origin, evidenceRoot, entries, fixture) {
  const context = await browser.newContext({ viewport: fixture.viewport, colorScheme: fixture.theme });
  await context.addInitScript(theme => localStorage.setItem('northstar-theme', theme), fixture.theme);
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(String(error)));
  await page.goto(`${origin}${fixture.route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await assertNoOverflow(page, fixture.label);
  assert.ok(await page.locator('footer a[href="/privacy"]').count() >= 1, `${fixture.label} lacks Privacy`);
  assert.ok(await page.locator('footer a[href="/terms"]').count() >= 1, `${fixture.label} lacks Terms`);
  assert.ok(await page.locator('footer a[href="/legal"]').count() >= 1, `${fixture.label} lacks Legal`);
  assert.deepStrictEqual(browserErrors, []);
  const filename = path.join(evidenceRoot, `${fixture.label}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  entries.push({
    file: path.basename(filename), sha256: sha256File(filename), route: fixture.route,
    viewport: fixture.viewport, theme: fixture.theme, fixture: 'ordinary-visual',
  });
  await context.close();
}
async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(process.env.M19_PG_ADMIN_URL, 'M19_PG_ADMIN_URL is required');
  const evidenceRoot = path.resolve(process.env.PRE_M23_P1_EVIDENCE_DIR || 'outputs/pre-m23-p1-visual');
  const securityRoot = path.resolve(process.env.PRE_M23_P1_SECURITY_EVIDENCE_DIR || 'outputs/pre-m23-p1-security');
  assert.notStrictEqual(evidenceRoot, securityRoot, 'ordinary and hostile evidence must remain separate');
  const testedRevision = process.env.PRE_M23_P1_TESTED_REVISION || null;
  const testedTree = process.env.PRE_M23_P1_TESTED_TREE || null;
  assert.match(testedRevision || '', /^[0-9a-f]{40}$/);
  assert.match(testedTree || '', /^[0-9a-f]{40}$/);
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.mkdirSync(securityRoot, { recursive: true });
  const runtime = resolveBrowserRuntime(selected);
  const database = await createSuiteDatabase(`pre-m23-p1-${selected}`);
  let roles, db, server, browser;
  const entries = [], securityEntries = [];
  const original = Object.fromEntries(['DATABASE_URL','MIGRATION_DATABASE_URL','NODE_ENV','AUTH_ACCESS_SECRET'].map(key => [key, process.env[key]]));
  try {
    roles = await createRoles(database, selected);
    process.env.DATABASE_URL = roles.runtimeUrl;
    process.env.MIGRATION_DATABASE_URL = roles.migrationUrl;
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const mounted = require('../../src/server');
    server = await listen(mounted.app);
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    const ordinary = [
      { label: `${selected}-desktop-light-today`, viewport: { width: 1280, height: 900 }, theme: 'light', hostile: false },
      { label: `${selected}-desktop-dark-today`, viewport: { width: 1280, height: 900 }, theme: 'dark', hostile: false },
      ...[320, 375, 390, 430].flatMap(width => ['light','dark'].map(theme => ({
        label: `${selected}-mobile-${width}-${theme}-today`, viewport: { width, height: 844 }, theme, hostile: false,
      }))),
    ];
    for (const fixture of ordinary) await renderToday(browser, origin, evidenceRoot, securityRoot, entries, securityEntries, fixture);
    for (const fixture of [
      { label: `${selected}-desktop-dark-hostile-today`, viewport: { width: 1280, height: 900 }, theme: 'dark', hostile: true },
      { label: `${selected}-mobile-390-light-hostile-today`, viewport: { width: 390, height: 844 }, theme: 'light', hostile: true },
    ]) await renderToday(browser, origin, evidenceRoot, securityRoot, entries, securityEntries, fixture);
    for (const fixture of [
      { label: `${selected}-desktop-light-home`, viewport: { width: 1280, height: 900 }, theme: 'light', route: '/' },
      { label: `${selected}-mobile-390-dark-home`, viewport: { width: 390, height: 844 }, theme: 'dark', route: '/' },
      { label: `${selected}-desktop-dark-demo`, viewport: { width: 1280, height: 900 }, theme: 'dark', route: '/demo' },
      { label: `${selected}-mobile-390-light-demo`, viewport: { width: 390, height: 844 }, theme: 'light', route: '/demo' },
    ]) await renderSharedRoute(browser, origin, evidenceRoot, entries, fixture);
    const common = { testedRevision, testedTree, browser: selected, generatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(evidenceRoot, 'manifest.json'), JSON.stringify({ ...common, kind: 'ordinary-visual', screenshots: entries }, null, 2) + '\n');
    fs.writeFileSync(path.join(securityRoot, 'manifest.json'), JSON.stringify({ ...common, kind: 'hostile-security', screenshots: securityEntries }, null, 2) + '\n');
    console.log(JSON.stringify({ browser: selected, ordinaryScreenshots: entries.length, securityScreenshots: securityEntries.length,
      evidenceRoot, securityRoot, testedRevision, testedTree }, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await closeServer(server).catch(() => {});
    if (db) await db.close().catch(() => {});
    await database.cleanup().catch(() => {});
    await dropRoles(roles).catch(() => {});
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

main().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
