'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const schedulingTime = require('../../public/js/scheduling-time-contract');

const ROOT = path.resolve(__dirname, '..', '..');
const ORGANIZATION_ID = 'f1100000-0000-4000-8000-000000000001';
const OWNER_ID = 'f2100000-0000-4000-8000-000000000001';
const DISPATCHER_ID = 'f2100000-0000-4000-8000-000000000002';
const HOSTILE = '<img src=x onerror="globalThis.m22Part5Compromised=true"> Part 5 customer';

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return server;
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function installSessionMetadata(sessionId) {
  window.name = 'northstar-tab:m22-part5-' + sessionId;
  sessionStorage.setItem('northstarSessionOwner', window.name);
  sessionStorage.setItem('northstarSessionId', sessionId);
}

async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  const mobile = process.argv.includes('--mobile');
  const dark = process.argv.includes('--dark');
  assert.ok(['chrome', 'webkit'].includes(selected));
  assert.ok(process.env.M19_PG_ADMIN_URL, 'M19_PG_ADMIN_URL must identify disposable PostgreSQL');
  const runtime = resolveBrowserRuntime(selected);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p5-browser-'));
  const evidenceRoot = process.env.M22_PART5_EVIDENCE_DIR ? path.resolve(process.env.M22_PART5_EVIDENCE_DIR) : null;
  if (evidenceRoot) fs.mkdirSync(evidenceRoot, { recursive: true });
  const matrix = selected + '-' + (mobile ? 'mobile' : 'desktop') + '-' + (dark ? 'dark' : 'light');
  const original = {};
  const environment = [
    'DATABASE_URL', 'NODE_ENV', 'AUTH_ACCESS_SECRET', 'NORTHSTAR_DATA_DIR',
    'OPENAI_API_KEY', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
    'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
    'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    'GOOGLE_CALENDAR_CREDENTIALS', 'GOOGLE_SHEETS_CLIENT_EMAIL',
    'GOOGLE_SHEETS_PRIVATE_KEY', 'GOOGLE_SHEETS_SPREADSHEET_ID',
  ];
  environment.forEach(key => { original[key] = process.env[key]; });
  const suiteDatabase = await createSuiteDatabase('m22-p5-browser-' + matrix);
  let db;
  let server;
  let browser;
  const external = [];
  const mutations = [];
  const errors = [];
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.NORTHSTAR_DATA_DIR = dataRoot;
    environment.slice(4).forEach(key => { process.env[key] = ''; });
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const pool = db.getPool();
    await pool.query(`INSERT INTO organizations(id,name,email) VALUES ($1,'Part 5 Browser Tenant','part5@example.test')`, [ORGANIZATION_ID]);
    await pool.query(
      `INSERT INTO users(id,organization_id,name,email,password_hash,role,status)
       VALUES ($1,$3,'Part 5 Owner','part5-owner@example.test','not-used','owner','active'),
              ($2,$3,'Part 5 Dispatcher','part5-dispatcher@example.test','not-used','member','active')`,
      [OWNER_ID, DISPATCHER_ID, ORGANIZATION_ID]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    const profile = canonicalFenceProfile({ companyName: 'Part 5 Browser Tenant' });
    profile.company.timeZone = 'America/New_York';
    await putBusinessProfile(pool, { organizationId: ORGANIZATION_ID, userId: OWNER_ID, expectedVersion: null, profile });
    const owner = await provisionDurableSession(pool, { userId: OWNER_ID, organizationId: ORGANIZATION_ID, membershipId: OWNER_ID, role: 'owner' });
    await provisionDurableSession(pool, { userId: DISPATCHER_ID, organizationId: ORGANIZATION_ID, membershipId: DISPATCHER_ID, role: 'member' });
    await pool.query("UPDATE workforce_profiles SET operational_role='dispatcher' WHERE organization_id=$1 AND membership_id=$2", [ORGANIZATION_ID, DISPATCHER_ID]);
    const { app } = require('../../src/server');
    const simulationSession = 'sim_m22_part5_' + matrix;
    const created = await request(app).post('/api/v1/simulations/leads')
      .set(owner.headers).set('X-NorthStar-Session-ID', simulationSession)
      .set('Idempotency-Key', 'm22-part5-browser-graph-' + matrix)
      .send({ name: HOSTILE, service: 'fence', phone: '+15555559225', sessionId: simulationSession });
    assert.strictEqual(created.status, 201);
    const appointmentId = created.body.ids.appointment;
    // The simulation ingestion route is reused only to create a complete,
    // provider-free canonical graph. Part 4 deliberately excludes simulation
    // sources from paid mutation, so the disposable fixture is relabelled as
    // test-owned manual ingestion before any browser authority is loaded.
    const fixtureSource = await pool.query(
      `UPDATE canonical_transcripts SET source='manual',source_version='m22-part5-browser-manual'
        WHERE organization_id=$1 AND operation_id=(
          SELECT operation_id FROM canonical_appointments WHERE organization_id=$1 AND id=$2
        )`,
      [ORGANIZATION_ID, appointmentId]
    );
    assert.strictEqual(fixtureSource.rowCount, 1);
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      colorScheme: dark ? 'dark' : 'light', timezoneId: 'America/Los_Angeles',
      hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1, serviceWorkers: 'block',
    });
    await context.addCookies([
      { name: 'northstar_access', value: owner.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
      { name: 'northstar_csrf', value: owner.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
    ]);
    await context.addInitScript(installSessionMetadata, simulationSession);
    await context.route('**/*', async route => {
      const target = new URL(route.request().url());
      if (target.origin !== origin) { external.push({ method: route.request().method(), url: route.request().url() }); await route.abort(); return; }
      await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', browserRequest => {
      const url = browserRequest.url();
      if (/\/mutation-(previews|approvals)$/.test(url) || browserRequest.method() === 'PATCH') {
        let body = null;
        try { body = browserRequest.postDataJSON(); } catch (_error) {}
        mutations.push({ method: browserRequest.method(), url, body });
      }
    });

    async function screenshot(label) {
      if (evidenceRoot) await page.screenshot({ path: path.join(evidenceRoot, matrix + '-' + label + '.png'), fullPage: true });
    }

    async function waitRevision(revision) {
      await page.waitForFunction(({ id, expected }) => {
        var projection = window.CanonicalIntelligence && window.CanonicalIntelligence.getProjection('calendar');
        var record = projection && projection.schedulingOverview && projection.schedulingOverview.records.find(entry => entry.appointmentId === id);
        return record && record.authority.revision === expected;
      }, { id: appointmentId, expected: revision }, { timeout: 20000 });
    }

    async function beginFromButton(button) {
      if (mobile) await button.tap(); else { await button.focus(); await page.keyboard.press('Enter'); }
      await page.locator('.m22-dialog[role="dialog"]').waitFor({ state: 'visible' });
    }

    async function completeDialog(configure) {
      if (configure) await configure();
      const previewResponsePromise = page.waitForResponse(response => /\/mutation-previews$/.test(response.url()));
      await page.getByRole('button', { name: 'Create non-capability preview' }).click();
      const previewResponse = await previewResponsePromise;
      if (!previewResponse.ok()) throw new Error('Visible preview failed ' + previewResponse.status() + ': ' + await previewResponse.text());
      await page.getByText('Exact preview — review before approval').waitFor({ state: 'visible' });
      const checks = page.locator('.m22-ack-list input[type="checkbox"]');
      for (let index = 0; index < await checks.count(); index += 1) await checks.nth(index).check();
      const approve = page.getByRole('button', { name: 'Approve current preview' });
      await assert.doesNotReject(async () => { assert.strictEqual(await approve.isEnabled(), true); });
      await approve.click();
      await page.locator('.m22-dialog[role="dialog"]').waitFor({ state: 'detached', timeout: 20000 });
    }

    function actionButton(name) {
      return page.locator('#calendarAuthorityBoard .m22-overview-record').filter({ hasText: HOSTILE })
        .getByRole('button', { name, exact: true });
    }

    await page.goto(origin + '/dashboard/calendar', { waitUntil: 'domcontentloaded' });
    await waitRevision(1);
    assert.strictEqual(await page.evaluate(() => Boolean(globalThis.m22Part5Compromised)), false);
    await screenshot('calendar-unassigned');

    await beginFromButton(actionButton('Assign'));
    await completeDialog(async () => {
      await page.locator('.m22-dialog select').first().selectOption('profile:' + OWNER_ID);
    });
    await waitRevision(2);

    const inTwoDays = new Date(Date.now() + 2 * 86400000);
    const date = schedulingTime.formatInstant(inTwoDays, 'America/New_York').date;
    await beginFromButton(actionButton('Schedule'));
    await completeDialog(async () => {
      await page.getByLabel('Start date').fill(date);
      await page.getByLabel('Start time').fill('10:00');
      await page.getByLabel('End date').fill(date);
      await page.getByLabel('End time').fill('11:00');
    });
    await waitRevision(3);

    await page.getByRole('button', { name: 'Week', exact: true }).click();
    const visibleEvent = page.locator('#calendarGrid [draggable="true"][data-calendar-event-id="' + appointmentId + '"]');
    await visibleEvent.waitFor({ state: 'visible' });
    if (!mobile) {
      const dropTarget = page.locator('[data-calendar-drop-date="' + date + '"][data-calendar-drop-hour="11"]');
      await visibleEvent.dragTo(dropTarget);
      await page.locator('.m22-dialog[role="dialog"]').waitFor({ state: 'visible' });
      assert.match(await page.locator('.m22-dialog textarea').inputValue(), /drag and drop/i);
      await page.keyboard.press('Escape');
    }
    const resizeControl = page.locator('[data-calendar-event-action="resize"][data-calendar-event-id="' + appointmentId + '"]');
    if (mobile) await resizeControl.tap(); else await resizeControl.click();
    await page.locator('.m22-dialog[role="dialog"]').waitFor({ state: 'visible' });
    assert.match(await page.locator('.m22-dialog textarea').inputValue(), /resize|touch gesture/i);
    await page.keyboard.press('Escape');

    await beginFromButton(actionButton('Dispatch'));
    await completeDialog();
    await waitRevision(4);

    await beginFromButton(actionButton('Reassign'));
    await completeDialog(async () => {
      await page.locator('.m22-dialog select').first().selectOption('profile:' + DISPATCHER_ID);
      assert.ok((await page.locator('.m22-dispatch-warning').allTextContents()).join(' ').includes('revokes'));
    });
    await waitRevision(5);

    await beginFromButton(actionButton('Reschedule'));
    await completeDialog(async () => { await page.getByLabel('End time').fill('11:30'); });
    await waitRevision(6);

    await beginFromButton(actionButton('Unassign'));
    await completeDialog();
    await waitRevision(7);
    await screenshot('calendar-actions-complete');

    await page.goto(origin + '/dashboard', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Owner and dispatcher overview' }).waitFor();
    await page.getByRole('button', { name: /Unassigned 1/ }).click();
    const commandRecord = page.locator('#commandCenterSchedulingRecords .m22-overview-record').filter({ hasText: HOSTILE });
    assert.strictEqual(await commandRecord.count(), 1);
    await beginFromButton(commandRecord.getByRole('button', { name: 'Assign', exact: true }));
    await completeDialog(async () => { await page.locator('.m22-dialog select').first().selectOption('profile:' + OWNER_ID); });
    await page.waitForFunction(id => {
      var workspace = document.querySelector('[data-appointment-id="' + id + '"]');
      return Boolean(workspace);
    }, appointmentId).catch(() => {});
    await screenshot('command-center-overview');

    await page.getByRole('button', { name: /^All \d+$/ }).click();
    await commandRecord.waitFor({ state: 'visible' });
    const reassign = commandRecord.getByRole('button', { name: 'Reassign', exact: true });
    const previewPattern = '**/api/v1/canonical/appointments/*/mutation-previews';
    await page.route(previewPattern, route => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'M22_STALE_PREVIEW_TEST', message: 'Current scheduling authority or evidence changed. Refresh and request a new preview.' } }),
    }), { times: 1 });
    await beginFromButton(reassign);
    await page.locator('.m22-dialog select').first().selectOption('profile:' + DISPATCHER_ID);
    const retainedReason = await page.locator('.m22-dialog textarea').inputValue();
    await page.getByRole('button', { name: 'Create non-capability preview' }).click();
    await page.getByText(/Current scheduling authority or evidence changed/).waitFor();
    assert.strictEqual(await page.locator('.m22-dialog textarea').inputValue(), retainedReason, 'stale rejection retains the proposal safely');
    assert.strictEqual(await page.getByRole('button', { name: 'Approve current preview' }).count(), 0, 'stale preview never exposes approval');
    await page.keyboard.press('Escape');

    await page.route(previewPattern, route => route.abort('internetdisconnected'), { times: 1 });
    await beginFromButton(reassign);
    await page.locator('.m22-dialog select').first().selectOption('profile:' + DISPATCHER_ID);
    await page.getByRole('button', { name: 'Create non-capability preview' }).click();
    await page.getByText(/network is offline or unavailable/i).waitFor();
    assert.strictEqual(await page.getByRole('button', { name: 'Approve current preview' }).count(), 0, 'offline preview never exposes approval');
    await page.keyboard.press('Escape');

    await page.route(previewPattern, async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.conflicts.hardConflicts = [{ code: 'M22_TEST_HARD_CONFLICT', message: 'Mounted browser hard conflict cannot be overridden.' }];
      await route.fulfill({ response, json: body });
    }, { times: 1 });
    await beginFromButton(reassign);
    await page.locator('.m22-dialog select').first().selectOption('profile:' + DISPATCHER_ID);
    await page.getByRole('button', { name: 'Create non-capability preview' }).click();
    await page.getByText(/hard conflict cannot be overridden/i).waitFor();
    const blockedApprove = page.getByRole('button', { name: 'Approve current preview' });
    assert.strictEqual(await blockedApprove.isDisabled(), true, 'hard conflict has no override or approval path');
    await page.keyboard.press('Escape');

    await page.evaluate(() => { document.documentElement.style.fontSize = '400%'; });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 2, '400% reflow must not create horizontal page overflow: ' + overflow);
    assert.strictEqual(await page.evaluate(() => Boolean(globalThis.m22Part5Compromised)), false);
    assert.strictEqual(external.length, 0, 'provider/external calls remain zero');
    assert.strictEqual(mutations.some(entry => entry.method === 'PATCH'), false, 'no direct appointment PATCH remains');
    const previews = mutations.filter(entry => /mutation-previews$/.test(entry.url));
    const approvals = mutations.filter(entry => /mutation-approvals$/.test(entry.url));
    assert.ok(previews.length >= 7, 'visible controls must create previews');
    assert.ok(approvals.length >= 7, 'visible controls must apply approvals');
    assert.deepStrictEqual(previews.slice(0, 6).map(entry => entry.body.action),
      ['assign', 'schedule', 'dispatch', 'reassign', 'reschedule', 'unassign']);
    assert.strictEqual(errors.length, 0, 'browser page errors: ' + JSON.stringify(errors));
    console.log(JSON.stringify({ matrix, appointmentId, previews: previews.length, approvals: approvals.length, revisions: 8, externalCalls: 0, directPatches: 0 }));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await closeServer(server).catch(() => {});
    if (db) await db.close().catch(() => {});
    await suiteDatabase.cleanup().catch(() => {});
    if (path.resolve(dataRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(dataRoot, { recursive: true, force: true });
    environment.forEach(key => { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; });
  }
}

main().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
