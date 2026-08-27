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
const EMPLOYEE_ID = 'f2100000-0000-4000-8000-000000000003';
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

async function currentPins(pool, appointmentId) {
  const row = (await pool.query(
    `SELECT revision,rtrim(canonical_digest) AS digest,target_state,workforce_profile_id,
            workforce_crew_id,scheduled_start,scheduled_end,appointment_status
       FROM public.canonical_schedule_assignments
      WHERE organization_id=$1 AND appointment_id=$2`,
    [ORGANIZATION_ID, appointmentId]
  )).rows[0];
  assert.ok(row);
  return {
    revision: Number(row.revision), digest: row.digest,
    target: row.target_state === 'unassigned' ? { kind: 'unassigned', id: null }
      : row.workforce_profile_id ? { kind: 'profile', id: row.workforce_profile_id }
        : { kind: 'crew', id: row.workforce_crew_id },
    scheduledStart: row.scheduled_start ? new Date(row.scheduled_start).toISOString() : null,
    scheduledEnd: row.scheduled_end ? new Date(row.scheduled_end).toISOString() : null,
    appointmentStatus: row.appointment_status,
  };
}

async function mountedApproval(app, pool, session, appointmentId, action, proposal) {
  const before = await currentPins(pool, appointmentId);
  const reason = 'Mounted correction setup ' + action + '.';
  const preview = await request(app)
    .post('/api/v1/canonical/appointments/' + appointmentId + '/mutation-previews')
    .set(session.headers).send({
      expectedRevision: before.revision, expectedDigest: before.digest,
      expectedTimeZone: 'America/New_York', action,
      target: proposal.target || before.target,
      scheduledStart: Object.prototype.hasOwnProperty.call(proposal, 'scheduledStart')
        ? proposal.scheduledStart : before.scheduledStart,
      scheduledEnd: Object.prototype.hasOwnProperty.call(proposal, 'scheduledEnd')
        ? proposal.scheduledEnd : before.scheduledEnd,
      appointmentStatus: before.appointmentStatus, reason,
    });
  assert.strictEqual(preview.status, 201, JSON.stringify(preview.body));
  const approved = await request(app)
    .post('/api/v1/canonical/appointments/' + appointmentId + '/mutation-approvals')
    .set(session.headers).set('Idempotency-Key', crypto.randomUUID()).send({
      previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
      acknowledgedWarningDigests: preview.body.data.warningDigests,
      acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
      reason,
    });
  assert.strictEqual(approved.status, 200, JSON.stringify(approved.body));
  return approved.body.data;
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
       VALUES ($1,$4,'Part 5 Owner','part5-owner@example.test','not-used','owner','active'),
              ($2,$4,'Part 5 Dispatcher','part5-dispatcher@example.test','not-used','member','active'),
              ($3,$4,'Part 5 Employee','part5-employee@example.test','not-used','member','active')`,
      [OWNER_ID, DISPATCHER_ID, EMPLOYEE_ID, ORGANIZATION_ID]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    const profile = canonicalFenceProfile({ companyName: 'Part 5 Browser Tenant' });
    profile.company.timeZone = 'America/New_York';
    profile.scheduling = { maxJobsPerDay: 1, workDayLength: 24, appointmentBuffer: 0, travelBuffer: 0 };
    await putBusinessProfile(pool, { organizationId: ORGANIZATION_ID, userId: OWNER_ID, expectedVersion: null, profile });
    const owner = await provisionDurableSession(pool, { userId: OWNER_ID, organizationId: ORGANIZATION_ID, membershipId: OWNER_ID, role: 'owner' });
    await provisionDurableSession(pool, { userId: DISPATCHER_ID, organizationId: ORGANIZATION_ID, membershipId: DISPATCHER_ID, role: 'member' });
    const employee = await provisionDurableSession(pool, { userId: EMPLOYEE_ID, organizationId: ORGANIZATION_ID, membershipId: EMPLOYEE_ID, role: 'member' });
    await pool.query("UPDATE workforce_profiles SET operational_role='dispatcher' WHERE organization_id=$1 AND membership_id=$2", [ORGANIZATION_ID, DISPATCHER_ID]);
    await pool.query("UPDATE workforce_profiles SET operational_role='technician' WHERE organization_id=$1 AND membership_id=$2", [ORGANIZATION_ID, EMPLOYEE_ID]);
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
    const date = schedulingTime.formatInstant(new Date(Date.now() + 2 * 86400000), 'America/New_York').date;
    const conflictSession = simulationSession + '-conflict';
    const conflictCreated = await request(app).post('/api/v1/simulations/leads')
      .set(owner.headers).set('X-NorthStar-Session-ID', conflictSession)
      .set('Idempotency-Key', 'm22-part5-browser-conflict-' + matrix)
      .send({ name: 'Part 5 actual server conflict', service: 'fence', phone: '+15555559226', sessionId: conflictSession });
    assert.strictEqual(conflictCreated.status, 201);
    const conflictAppointmentId = conflictCreated.body.ids.appointment;
    assert.strictEqual((await pool.query(
      `UPDATE canonical_transcripts SET source='manual',source_version='m22-part5-browser-conflict'
        WHERE organization_id=$1 AND operation_id=(
          SELECT operation_id FROM canonical_appointments WHERE organization_id=$1 AND id=$2
        )`, [ORGANIZATION_ID, conflictAppointmentId]
    )).rowCount, 1);
    await mountedApproval(app, pool, owner, conflictAppointmentId, 'assign', { target: { kind: 'profile', id: OWNER_ID } });
    const conflictStart = schedulingTime.resolveWallTime(date, '12:00', 'America/New_York').candidates[0].rfc3339;
    const conflictEnd = schedulingTime.resolveWallTime(date, '13:00', 'America/New_York').candidates[0].rfc3339;
    await mountedApproval(app, pool, owner, conflictAppointmentId, 'schedule', {
      scheduledStart: conflictStart, scheduledEnd: conflictEnd,
    });
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
    let expectedRevision = 3;
    if (!mobile) {
      const dropTarget = page.locator('[data-calendar-drop-date="' + date + '"][data-calendar-drop-hour="11"]');
      await visibleEvent.dragTo(dropTarget);
      await page.locator('.m22-dialog[role="dialog"]').waitFor({ state: 'visible' });
      assert.match(await page.locator('.m22-dialog textarea').inputValue(), /drag and drop/i);
      assert.deepStrictEqual({
        start: await page.getByLabel('Start time').inputValue(),
        end: await page.getByLabel('End time').inputValue(),
      }, { start: '11:00', end: '12:00' }, 'real drag preserves exact one-hour elapsed duration');
      await completeDialog();
      expectedRevision += 1;
      await waitRevision(expectedRevision);
    }
    const resizeControl = page.locator('[data-calendar-event-action="resize"][data-calendar-event-id="' + appointmentId + '"]');
    if (mobile) await resizeControl.tap(); else await resizeControl.click();
    await page.locator('.m22-dialog[role="dialog"]').waitFor({ state: 'visible' });
    assert.match(await page.locator('.m22-dialog textarea').inputValue(), /resize|touch gesture/i);
    await page.keyboard.press('Escape');

    await beginFromButton(actionButton('Dispatch'));
    await completeDialog();
    expectedRevision += 1;
    await waitRevision(expectedRevision);

    await beginFromButton(actionButton('Reassign'));
    await completeDialog(async () => {
      await page.locator('.m22-dialog select').first().selectOption('profile:' + DISPATCHER_ID);
      assert.ok((await page.locator('.m22-dispatch-warning').allTextContents()).join(' ').includes('revokes'));
    });
    expectedRevision += 1;
    await waitRevision(expectedRevision);

    await beginFromButton(actionButton('Reschedule'));
    await completeDialog(async () => { await page.getByLabel('End time').fill('11:30'); });
    expectedRevision += 1;
    await waitRevision(expectedRevision);

    await beginFromButton(actionButton('Unassign'));
    await completeDialog();
    expectedRevision += 1;
    await waitRevision(expectedRevision);

    await beginFromButton(actionButton('Reschedule'));
    await page.getByLabel('End time').fill('11:45');
    const calendarRefreshPreview = page.waitForResponse(response => /\/mutation-previews$/.test(response.url()));
    await page.getByRole('button', { name: 'Create non-capability preview' }).click();
    const calendarRefreshResponse = await calendarRefreshPreview;
    assert.strictEqual(calendarRefreshResponse.status(), 201);
    const calendarRefreshBody = await calendarRefreshResponse.json();
    await page.getByText('Exact preview — review before approval').waitFor();
    const calendarRefreshChecks = page.locator('.m22-ack-list input[type="checkbox"]');
    assert.strictEqual(await calendarRefreshChecks.count(),
      calendarRefreshBody.data.warningDigests.length + calendarRefreshBody.data.reviewReasonDigests.length);
    for (let index = 0; index < await calendarRefreshChecks.count(); index += 1) await calendarRefreshChecks.nth(index).check();
    const calendarApprovalCount = mutations.filter(entry => /mutation-approvals$/.test(entry.url)).length;
    await page.route('**/api/v1/canonical/compat/calendar?*', route => route.abort('internetdisconnected'), { times: 1 });
    await page.getByRole('button', { name: 'Approve current preview' }).click();
    await page.getByText(/Approval applied durably at revision .* authoritative refresh failed/i).waitFor();
    expectedRevision += 1;
    assert.strictEqual((await currentPins(pool, appointmentId)).revision, expectedRevision);
    assert.strictEqual(await page.locator('.m22-dialog[role="dialog"]').count(), 1);
    assert.strictEqual(await page.evaluate(() => Boolean(window.calRenderer && window.calRenderer.rejected)), true);
    assert.strictEqual(await page.evaluate(() => window.calState.events.length), 0);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('.m22-dialog[role="dialog"]').count(), 1);
    await page.getByRole('button', { name: 'Retry authoritative refresh' }).click();
    await page.locator('.m22-dialog[role="dialog"]').waitFor({ state: 'detached', timeout: 20000 });
    assert.strictEqual(mutations.filter(entry => /mutation-approvals$/.test(entry.url)).length,
      calendarApprovalCount + 1, 'Calendar retry refresh never reapplies approval');
    await waitRevision(expectedRevision);
    await screenshot('calendar-actions-complete');

    await page.goto(origin + '/dashboard', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Owner and dispatcher overview' }).waitFor();
    await page.getByRole('button', { name: /Unassigned 1/ }).click();
    const commandRecord = page.locator('#commandCenterSchedulingRecords .m22-overview-record').filter({ hasText: HOSTILE });
    assert.strictEqual(await commandRecord.count(), 1);
    await beginFromButton(commandRecord.getByRole('button', { name: 'Assign', exact: true }));
    await completeDialog(async () => { await page.locator('.m22-dialog select').first().selectOption('profile:' + OWNER_ID); });
    expectedRevision += 1;
    assert.strictEqual((await currentPins(pool, appointmentId)).revision, expectedRevision);
    await page.waitForFunction(id => {
      var workspace = document.querySelector('[data-appointment-id="' + id + '"]');
      return Boolean(workspace);
    }, appointmentId).catch(() => {});
    let mobileHeading = null;
    if (mobile) {
      mobileHeading = await page.evaluate(() => {
        const heading = document.querySelector('.demo-daily-brief .demo-panel-heading');
        const title = heading.querySelector('h2');
        const updated = heading.querySelector('.demo-updated');
        const headingBox = heading.getBoundingClientRect();
        const titleBox = title.getBoundingClientRect();
        const updatedBox = updated.getBoundingClientRect();
        const titleStyle = getComputedStyle(title);
        const lineHeight = Number.parseFloat(titleStyle.lineHeight);
        return {
          flexDirection: getComputedStyle(heading).flexDirection,
          headingWidth: headingBox.width,
          titleWidth: titleBox.width,
          titleHeight: titleBox.height,
          titleLineHeight: lineHeight,
          titleLines: lineHeight ? Math.round(titleBox.height / lineHeight) : null,
          updatedWidth: updatedBox.width,
        };
      });
      assert.strictEqual(mobileHeading.flexDirection, 'column', JSON.stringify(mobileHeading));
      assert.ok(mobileHeading.titleWidth >= 200, 'mobile Daily Brief title retains readable width: ' + JSON.stringify(mobileHeading));
      assert.ok(mobileHeading.titleLines <= 2, 'mobile Daily Brief title must not collapse vertically: ' + JSON.stringify(mobileHeading));
      assert.ok(mobileHeading.updatedWidth >= 200 && mobileHeading.updatedWidth <= mobileHeading.headingWidth + 1,
        'updated timestamp reflows within the Daily Brief: ' + JSON.stringify(mobileHeading));
    }
    await screenshot('command-center-overview');

    await page.getByRole('button', { name: /^All \d+$/ }).click();
    await commandRecord.waitFor({ state: 'visible' });
    const scheduledPins = await currentPins(pool, appointmentId);
    const displayTruth = await page.evaluate(instant => ({
      browserTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      browserLocal: new Date(instant).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
      tenantLocal: new Date(instant).toLocaleString([], {
        timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short',
      }),
    }), scheduledPins.scheduledStart);
    const commandRecordText = await commandRecord.innerText();
    assert.strictEqual(displayTruth.browserTimeZone, 'America/Los_Angeles');
    assert.ok(commandRecordText.includes(displayTruth.tenantLocal), JSON.stringify({ commandRecordText, displayTruth }));
    assert.ok(commandRecordText.includes('America/New_York'), commandRecordText);
    if (displayTruth.browserLocal !== displayTruth.tenantLocal) {
      assert.ok(!commandRecordText.includes(displayTruth.browserLocal), JSON.stringify({ commandRecordText, displayTruth }));
    }
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

    const reschedule = commandRecord.getByRole('button', { name: 'Reschedule', exact: true });
    await beginFromButton(reschedule);
    await page.getByLabel('Start time').fill('12:00');
    await page.getByLabel('End time').fill('13:00');
    const hardResponsePromise = page.waitForResponse(response => /\/mutation-previews$/.test(response.url()));
    await page.getByRole('button', { name: 'Create non-capability preview' }).click();
    const hardResponse = await hardResponsePromise;
    assert.strictEqual(hardResponse.status(), 201);
    const hardBody = await hardResponse.json();
    assert.ok(hardBody.data.conflicts.hardConflicts.length > 0, JSON.stringify(hardBody));
    await page.getByRole('heading', { name: 'Hard conflicts' }).waitFor();
    const blockedApprove = page.getByRole('button', { name: 'Approve current preview' });
    assert.strictEqual(await blockedApprove.isDisabled(), true, 'real server hard conflict has no override or approval path');
    await page.keyboard.press('Escape');

    await beginFromButton(reschedule);
    await page.getByLabel('Start time').fill('14:00');
    await page.getByLabel('End time').fill('15:00');
    const warningResponsePromise = page.waitForResponse(response => /\/mutation-previews$/.test(response.url()));
    await page.getByRole('button', { name: 'Create non-capability preview' }).click();
    const warningResponse = await warningResponsePromise;
    assert.strictEqual(warningResponse.status(), 201);
    const warningBody = await warningResponse.json();
    assert.ok(warningBody.data.conflicts.warnings.length > 0, JSON.stringify(warningBody));
    const warningApprove = page.getByRole('button', { name: 'Approve current preview' });
    assert.strictEqual(await warningApprove.isDisabled(), true, 'real warning requires exact acknowledgement');
    const warningChecks = page.locator('.m22-ack-list input[type="checkbox"]');
    for (let index = 0; index < await warningChecks.count(); index += 1) await warningChecks.nth(index).check();
    assert.strictEqual(await warningApprove.isEnabled(), true);
    await warningApprove.click();
    await page.locator('.m22-dialog[role="dialog"]').waitFor({ state: 'detached', timeout: 20000 });
    expectedRevision += 1;
    assert.strictEqual((await currentPins(pool, appointmentId)).revision, expectedRevision);

    await beginFromButton(commandRecord.getByRole('button', { name: 'Reschedule', exact: true }));
    await page.getByLabel('End time').fill('15:30');
    const refreshPreviewPromise = page.waitForResponse(response => /\/mutation-previews$/.test(response.url()));
    await page.getByRole('button', { name: 'Create non-capability preview' }).click();
    const refreshPreviewResponse = await refreshPreviewPromise;
    assert.strictEqual(refreshPreviewResponse.status(), 201);
    const refreshPreviewBody = await refreshPreviewResponse.json();
    await page.getByText('Exact preview — review before approval').waitFor();
    const refreshChecks = page.locator('.m22-ack-list input[type="checkbox"]');
    assert.strictEqual(await refreshChecks.count(),
      refreshPreviewBody.data.warningDigests.length + refreshPreviewBody.data.reviewReasonDigests.length);
    for (let index = 0; index < await refreshChecks.count(); index += 1) await refreshChecks.nth(index).check();
    const approvalCountBeforeRefreshFailure = mutations.filter(entry => /mutation-approvals$/.test(entry.url)).length;
    await page.route('**/api/v1/command-center/workspace*', route => route.abort('internetdisconnected'), { times: 1 });
    await page.getByRole('button', { name: 'Approve current preview' }).click();
    await page.getByText(/Approval applied durably at revision .* authoritative refresh failed/i).waitFor();
    expectedRevision += 1;
    assert.strictEqual((await currentPins(pool, appointmentId)).revision, expectedRevision);
    assert.strictEqual(await page.locator('.m22-dialog[role="dialog"]').count(), 1);
    assert.strictEqual(await page.getByRole('button', { name: 'Approve current preview' }).isDisabled(), true);
    assert.strictEqual(await page.getByRole('button', { name: 'Retry authoritative refresh' }).isVisible(), true);
    assert.strictEqual(await page.getByRole('button', { name: 'Reload page' }).isVisible(), true);
    assert.strictEqual(await page.getByRole('button', { name: 'Cancel' }).isVisible(), false);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('.m22-dialog[role="dialog"]').count(), 1, 'Escape cannot dismiss a durable applied stale state');
    await page.getByRole('button', { name: 'Retry authoritative refresh' }).click();
    await page.locator('.m22-dialog[role="dialog"]').waitFor({ state: 'detached', timeout: 20000 });
    assert.strictEqual(mutations.filter(entry => /mutation-approvals$/.test(entry.url)).length,
      approvalCountBeforeRefreshFailure + 1, 'retry refresh never reapplies approval');

    if (!mobile) {
      const paginationAppointments = [];
      for (let ordinal = 0; ordinal < 101; ordinal += 1) {
      const paginationSession = simulationSession + '-page-' + String(ordinal).padStart(3, '0');
      const response = await request(app).post('/api/v1/simulations/leads')
        .set(owner.headers).set('X-NorthStar-Session-ID', paginationSession)
        .set('Idempotency-Key', 'm22-part5-browser-page-' + matrix + '-' + String(ordinal).padStart(3, '0'))
        .send({ name: 'Browser pagination ' + ordinal, service: 'fence',
          phone: '+1555' + String(6000000 + ordinal), sessionId: paginationSession });
      assert.strictEqual(response.status, 201, JSON.stringify(response.body));
      paginationAppointments.push(response.body.ids.appointment);
      }
      assert.strictEqual((await pool.query(
      `UPDATE canonical_transcripts SET source='manual',source_version='m22-part5-browser-pagination'
        WHERE organization_id=$1 AND EXISTS (
          SELECT 1 FROM canonical_appointments appointment
           WHERE appointment.organization_id=canonical_transcripts.organization_id
             AND appointment.operation_id=canonical_transcripts.operation_id
             AND appointment.id=ANY($2::uuid[])
        )`, [ORGANIZATION_ID, paginationAppointments]
      )).rowCount, 101);
      await page.waitForFunction(() => !document.getElementById('commandCenterRefresh').disabled);
      const pageOneResponsePromise = page.waitForResponse(response => /\/api\/v1\/command-center\/workspace/.test(response.url()));
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      const pageOneResponse = await pageOneResponsePromise;
      assert.strictEqual(pageOneResponse.status(), 200);
      const pageOneBody = await pageOneResponse.json();
      assert.strictEqual(pageOneBody.data.schedulingOverview.total, 103);
      assert.strictEqual(pageOneBody.data.schedulingOverview.shown, 100);
      try {
      await page.waitForFunction(() => document.getElementById('commandCenterSchedulingDefinition').textContent
        .includes('Showing 100 of 103 canonical appointments in America/New_York.'), null, { timeout: 10000 });
      } catch (error) {
        const state = await page.evaluate(() => ({
        definition: document.getElementById('commandCenterSchedulingDefinition').textContent,
        status: document.getElementById('commandCenterStatus').textContent,
        }));
        throw new Error('Truthful pagination UI did not render: ' + JSON.stringify(state) + '; ' + error.message);
      }
      assert.strictEqual(await page.getByRole('button', { name: 'All 103', exact: true }).count(), 1);
      const nextPage = page.getByRole('button', { name: 'Next 100 appointments', exact: true });
      await nextPage.click();
      await page.waitForFunction(() => document.getElementById('commandCenterSchedulingDefinition').textContent
      .includes('Showing 3 of 103 canonical appointments in America/New_York.'));
      assert.strictEqual(await page.getByRole('button', { name: 'First page', exact: true }).count(), 1);
      await page.getByRole('button', { name: 'First page', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('commandCenterSchedulingDefinition').textContent
      .includes('Showing 100 of 103 canonical appointments in America/New_York.'));
    }

    await pool.query("UPDATE subscriptions SET status='past_due' WHERE organization_id=$1", [ORGANIZATION_ID]);
    if (mobile) await page.reload({ waitUntil: 'domcontentloaded' });
    else {
      await page.waitForFunction(() => !document.getElementById('commandCenterRefresh').disabled);
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    }
    await page.getByText(/Read-only: Subscription Read Only/i).first().waitFor();
    assert.strictEqual(await page.locator('#commandCenterSchedulingRecords .m22-action-button').count(), 0,
      'read-only subscription exposes no mutation control');
    assert.ok(await page.locator('#commandCenterSchedulingRecords .m22-overview-record').count() > 0,
      'read-only subscription retains safe canonical overview');

    const employeeContext = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      colorScheme: dark ? 'dark' : 'light', timezoneId: 'America/Los_Angeles',
      hasTouch: mobile, isMobile: mobile, serviceWorkers: 'block',
    });
    await employeeContext.addCookies([
      { name: 'northstar_access', value: employee.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
      { name: 'northstar_csrf', value: employee.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
    ]);
    await employeeContext.addInitScript(installSessionMetadata, 'm22-part5-employee-' + matrix);
    const employeePage = await employeeContext.newPage();
    await employeePage.goto(origin + '/dashboard/calendar', { waitUntil: 'domcontentloaded' });
    await employeePage.getByText('Detailed scheduling authority is limited to current owners, admins, and active dispatchers.').waitFor();
    assert.strictEqual(await employeePage.locator('#calendarAuthorityBoard .m22-action-button').count(), 0);
    await employeePage.goto(origin + '/dashboard', { waitUntil: 'domcontentloaded' });
    await employeePage.getByText(/Current owner or active-dispatcher scheduling authority is unavailable/).waitFor();
    assert.strictEqual(await employeePage.locator('#commandCenterSchedulingRecords .m22-action-button').count(), 0);
    for (const alias of [
      '/api/v1/canonical/graphs?limit=1', '/api/v1/canonical/dashboard?limit=1',
      '/api/v1/canonical/analytics?limit=1', '/api/v1/canonical/surfaces/calendar?limit=1',
      '/api/v1/canonical/compat/command-center?limit=1',
    ]) {
      const denied = await employeeContext.request.get(origin + alias);
      assert.strictEqual(denied.status(), 403, alias);
      assert.ok(!(await denied.text()).includes(HOSTILE), alias + ' cannot disclose stored customer bytes');
    }
    for (const alias of ['/api/v1/canonical/status', '/api/dashboard/status']) {
      const restricted = await employeeContext.request.get(origin + alias);
      assert.strictEqual(restricted.status(), 200, alias);
      const body = await restricted.json();
      const data = body.data || body;
      assert.strictEqual(data.broadSchedulingRead, false, alias);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(data, 'completedGraphs'), false, alias);
      assert.ok(!JSON.stringify(body).includes(HOSTILE), alias + ' cannot disclose stored customer bytes');
    }
    await employeeContext.close();

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
    assert.deepStrictEqual(previews.slice(0, mobile ? 6 : 7).map(entry => entry.body.action), mobile
      ? ['assign', 'schedule', 'dispatch', 'reassign', 'reschedule', 'unassign']
      : ['assign', 'schedule', 'reschedule', 'dispatch', 'reassign', 'reschedule', 'unassign']);
    assert.strictEqual(errors.length, 0, 'browser page errors: ' + JSON.stringify(errors));
    console.log(JSON.stringify({ matrix, appointmentId, previews: previews.length, approvals: approvals.length,
      revision: expectedRevision, externalCalls: 0, directPatches: 0, mobileHeading }));
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
