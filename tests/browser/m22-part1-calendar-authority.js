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
const { normalizeScheduleMutation } = require('../../src/scheduling/contract');
const { updateAppointmentSchedule } = require('../../src/scheduling/repository');

const ROOT = path.resolve(__dirname, '..', '..');
const ORGANIZATION_ID = '81000000-0000-4000-8000-000000000001';
const OWNER_ID = '82000000-0000-4000-8000-000000000001';

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(String(value)), 'utf8').digest('hex');
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

function installSessionMetadata(sessionId) {
  window.name = 'northstar-tab:m22-part1-' + sessionId;
  sessionStorage.setItem('northstarSessionOwner', window.name);
  sessionStorage.setItem('northstarSessionId', sessionId);
}

async function main() {
  const selected = (process.argv.find((value) => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  assert.ok(process.env.M19_PG_ADMIN_URL, 'M19_PG_ADMIN_URL must identify disposable PostgreSQL');
  const runtime = resolveBrowserRuntime(selected);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p1-calendar-'));
  assert.notStrictEqual(path.resolve(dataRoot), ROOT, 'test data root must remain outside the checkout');
  const evidenceRoot = process.env.M22_CORRECTION_EVIDENCE_DIR
    ? path.resolve(process.env.M22_CORRECTION_EVIDENCE_DIR) : null;
  if (evidenceRoot) {
    assert.strictEqual(evidenceRoot.startsWith(ROOT + path.sep), false, 'browser evidence stays outside the checkout');
    fs.mkdirSync(evidenceRoot, { recursive:true });
  }
  async function screenshot(page, label) {
    if (!evidenceRoot) return;
    await page.screenshot({
      path: path.join(evidenceRoot, selected + '-' + label + '.png'),
      fullPage: true,
    });
  }

  const originalEnvironment = {};
  for (const key of [
    'DATABASE_URL', 'NODE_ENV', 'AUTH_ACCESS_SECRET', 'NORTHSTAR_DATA_DIR',
    'OPENAI_API_KEY', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
    'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
    'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    'GOOGLE_CALENDAR_CREDENTIALS', 'GOOGLE_SHEETS_CLIENT_EMAIL',
    'GOOGLE_SHEETS_PRIVATE_KEY', 'GOOGLE_SHEETS_SPREADSHEET_ID',
  ]) originalEnvironment[key] = process.env[key];

  const suiteDatabase = await createSuiteDatabase('m22-p1-calendar-' + selected);
  let db;
  let server;
  let browser;
  const externalRequests = [];
  const scheduleRequests = [];
  const pageErrors = [];
  const consoleErrors = [];
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.NORTHSTAR_DATA_DIR = dataRoot;
    for (const key of [
      'OPENAI_API_KEY', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
      'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
      'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
      'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
      'GOOGLE_CALENDAR_CREDENTIALS', 'GOOGLE_SHEETS_CLIENT_EMAIL',
      'GOOGLE_SHEETS_PRIVATE_KEY', 'GOOGLE_SHEETS_SPREADSHEET_ID',
    ]) process.env[key] = '';

    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'mounted production migrations initialize');
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email)
       VALUES ($1, 'Mission 22 Browser Tenant', 'm22-browser@example.test')`,
      [ORGANIZATION_ID]
    );
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
       VALUES ($1,$2,'Mission 22 Owner','m22-owner@example.test','not-used','owner','active')`,
      [OWNER_ID, ORGANIZATION_ID]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORGANIZATION_ID,
      userId: OWNER_ID,
      expectedVersion: null,
      profile: canonicalFenceProfile({ companyName: 'Mission 22 Browser Tenant' }),
    });
    const auth = await provisionDurableSession(pool, {
      userId: OWNER_ID,
      organizationId: ORGANIZATION_ID,
      role: 'owner',
    });
    const simulationSession = 'sim_m22_part1_calendar_' + selected;
    const { app } = require('../../src/server');
    const created = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth.headers)
      .set('X-NorthStar-Session-ID', simulationSession)
      .set('Idempotency-Key', 'm22-part1-browser-graph-' + selected)
      .send({
        name: 'Calendar <img src=x onerror="globalThis.m22CalendarCompromised=true"> Customer',
        service: 'fence',
        phone: '+15555558101',
        sessionId: simulationSession,
      });
    assert.strictEqual(created.status, 201, 'mounted production simulation creates the canonical appointment');
    const appointmentId = created.body.ids.appointment;

    const initial = (await pool.query(
      `SELECT revision, canonical_digest
         FROM canonical_schedule_assignments
        WHERE organization_id = $1 AND appointment_id = $2`,
      [ORGANIZATION_ID, appointmentId]
    )).rows[0];
    assert.strictEqual(Number(initial.revision), 1, 'appointment creation initializes revision one');
    assert.match(initial.canonical_digest.trim(), /^[0-9a-f]{64}$/);

    const weekStart = new Date();
    weekStart.setUTCHours(0, 0, 0, 0);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const scheduledDay = new Date(weekStart);
    scheduledDay.setUTCDate(weekStart.getUTCDate() + 3);
    const movedDay = new Date(weekStart);
    movedDay.setUTCDate(weekStart.getUTCDate() + 4);
    const scheduledDate = scheduledDay.toISOString().slice(0, 10);
    const movedDate = movedDay.toISOString().slice(0, 10);
    const fixtureStart = scheduledDate + 'T10:00:00.000Z';
    const fixtureEnd = scheduledDate + 'T11:00:00.000Z';
    const fixture = normalizeScheduleMutation({
      organizationId: ORGANIZATION_ID,
      actorUserId: OWNER_ID,
      actorAccessRole: 'owner',
      authSessionId: auth.sessionId,
      appointmentId,
      explicitSession: simulationSession,
      idempotencyKey: 'm22-calendar-visible-fixture-' + selected,
      body: {
        scheduledStart: fixtureStart,
        scheduledEnd: fixtureEnd,
        status: 'scheduled',
        expectedRevision: 1,
        expectedDigest: initial.canonical_digest.trim(),
        action: 'calendar_edit',
        reason: 'Create visible browser schedule fixture through canonical approval.',
      },
    });
    const fixtureResult = await updateAppointmentSchedule(pool, fixture);
    assert.strictEqual(fixtureResult.body.data.scheduleAuthority.revision, 2);

    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    const patchUrl = origin + '/api/v1/canonical/appointments/' + appointmentId;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });

    async function configureContext(context) {
      await context.addCookies([
        { name: 'northstar_access', value: auth.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
        { name: 'northstar_csrf', value: auth.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
      ]);
      await context.addInitScript(installSessionMetadata, simulationSession);
      await context.route('**/*', async (route) => {
        const target = new URL(route.request().url());
        if (target.origin !== origin) {
          externalRequests.push({ method: route.request().method(), url: route.request().url() });
          await route.abort();
          return;
        }
        await route.continue();
      });
    }

    function watchPage(page) {
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('request', (browserRequest) => {
        if (browserRequest.method() === 'PATCH' && browserRequest.url() === patchUrl) {
          scheduleRequests.push({
            url: browserRequest.url(),
            method: browserRequest.method(),
            headers: browserRequest.headers(),
            body: browserRequest.postDataJSON(),
          });
        }
      });
    }

    async function waitForRevision(page, revision) {
      await page.waitForFunction(({ expectedId, expectedRevision }) => {
        return document.documentElement.dataset.canonicalAuthority === 'server' &&
          window.calState && window.calState.events.length === 1 &&
          window.calState.events[0].id === expectedId &&
          window.calState.events[0].scheduleAuthority &&
          window.calState.events[0].scheduleAuthority.revision === expectedRevision;
      }, { expectedId: appointmentId, expectedRevision: revision }, { timeout: 15000 });
    }

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      timezoneId: 'UTC',
      colorScheme: 'light',
      serviceWorkers: 'block',
    });
    await configureContext(context);

    const page = await context.newPage();
    watchPage(page);
    let desktopPatchMode = 'stale';
    await page.route(patchUrl, async (route) => {
      if (desktopPatchMode === 'stale') {
        desktopPatchMode = 'normal';
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code:'M22_STALE_APPROVAL', error:{ message:'Schedule authority changed; refresh before approving again.' } }),
        });
        return;
      }
      if (desktopPatchMode === 'service_error') {
        desktopPatchMode = 'normal';
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ code:'CANONICAL_PERSISTENCE_UNAVAILABLE', error:{ message:'Schedule service unavailable.' } }),
        });
        return;
      }
      if (desktopPatchMode === 'delay') {
        desktopPatchMode = 'normal';
        await new Promise(resolve => setTimeout(resolve, 180));
      }
      await route.continue();
    });

    const response = await page.goto(origin + '/dashboard/calendar', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(response.status(), 200, 'mounted Calendar page loads');
    try {
      await waitForRevision(page, 2);
    } catch (error) {
      const state = await page.evaluate(() => ({
        authority: document.documentElement.dataset.canonicalAuthority || null,
        events: window.calState && window.calState.events,
        projection: window.CanonicalIntelligence && window.CanonicalIntelligence.getProjection('calendar'),
      }));
      throw new Error('Calendar authority did not settle: ' + JSON.stringify({ state, pageErrors, consoleErrors }) + '\n' + error.message);
    }

    const before = await page.evaluate(() => ({
      model: window.CanonicalIntelligence.getProjection('calendar').readModelVersion,
      authority: window.calState.events[0].scheduleAuthority,
    }));
    assert.strictEqual(before.model, 'm22-part1-read-v1', 'browser accepts the Part 1 read model');
    assert.strictEqual(before.authority.revision, 2, 'browser pins the fixture authority revision');
    assert.strictEqual(await page.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches), true);

    await page.getByRole('button', { name:'Agenda' }).click();
    assert.match(await page.locator('.cal-agenda-event-title').textContent(), /<img src=x onerror=/, 'hostile stored title remains literal text');
    assert.strictEqual(await page.locator('.cal-agenda-event-title img').count(), 0, 'hostile stored title creates no DOM sink');
    assert.strictEqual(await page.evaluate(() => globalThis.m22CalendarCompromised), undefined);
    let editButton = page.locator('.cal-agenda-event[data-calendar-event-action="edit"]');
    await editButton.focus();
    await editButton.press('Enter');
    let dialog = page.getByRole('dialog', { name:'Edit schedule' });
    await dialog.waitFor({ state:'visible' });
    await screenshot(page, 'desktop-light-edit-dialog');
    assert.ok((await page.locator('#calScheduleCurrent').textContent()).includes('Current schedule:'));
    assert.strictEqual(await page.locator('#calScheduleApprove').isDisabled(), true, 'approval begins disabled');
    await page.getByRole('button', { name:'Cancel', exact:true }).focus();
    await page.keyboard.press('Tab');
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('cal-modal-close')), true, 'Tab wraps from the last enabled control');
    await page.locator('.cal-modal-close').focus();
    await page.keyboard.press('Shift+Tab');
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim()), 'Cancel', 'Shift+Tab wraps from the first control');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.dataset.calendarEventAction), 'edit', 'Escape restores focus');

    await editButton.press('Enter');
    await page.locator('#calEventDate').fill(scheduledDate);
    await page.locator('#calEventTime').fill('11:00');
    await page.locator('#calEventEndDate').fill(scheduledDate);
    await page.locator('#calEventEndTime').fill('12:00');
    await page.locator('#calScheduleConfirmed').check();
    await page.locator('#calScheduleApprove').click();
    await page.locator('#calScheduleStatus[role="alert"]').waitFor({ state:'visible' });
    assert.match(await page.locator('#calScheduleStatus').textContent(), /changed before approval/i);
    await screenshot(page, 'desktop-light-stale-state');
    assert.strictEqual(await page.locator('#calScheduleApprove').isDisabled(), true, 'stale approval requires fresh confirmation');

    await page.locator('#calEventDate').fill(scheduledDate);
    await page.locator('#calEventTime').fill('11:00');
    await page.locator('#calEventEndDate').fill(scheduledDate);
    await page.locator('#calEventEndTime').fill('12:00');
    await page.locator('#calScheduleConfirmed').check();
    desktopPatchMode = 'delay';
    await page.locator('#calScheduleApprove').click();
    await page.locator('.cal-modal[aria-busy="true"]').waitFor({ state:'visible' });
    assert.strictEqual(await page.locator('#calScheduleApprove').isDisabled(), true, 'loading state prevents repeat confirmation');
    await page.locator('#calModalOverlay').waitFor({ state:'detached' });
    await waitForRevision(page, 3);

    editButton = page.locator('.cal-agenda-event[data-calendar-event-action="edit"]');
    await editButton.click();
    await page.locator('#calScheduleConfirmed').check();
    desktopPatchMode = 'service_error';
    await page.locator('#calScheduleApprove').click();
    await page.locator('#calScheduleStatus[role="alert"]').waitFor({ state:'visible' });
    assert.match(await page.locator('#calScheduleStatus').textContent(), /unavailable/i);
    await page.getByRole('button', { name:'Cancel', exact:true }).click();
    await waitForRevision(page, 3);

    await page.getByRole('button', { name:'Week' }).click();
    let weekEvent = page.locator('.cal-week-event[data-calendar-event-action="edit"]');
    const dropCell = page.locator(`.cal-week-cell[data-calendar-drop-date="${movedDate}"][data-calendar-drop-hour="12"]`);
    await weekEvent.dragTo(dropCell);
    await page.getByRole('dialog', { name:'Confirm moved schedule' }).waitFor({ state:'visible' });
    assert.strictEqual(await page.locator('#calEventDate').inputValue(), movedDate);
    assert.strictEqual(await page.locator('#calEventTime').inputValue(), '12:00');
    await page.locator('#calScheduleConfirmed').check();
    await page.locator('#calScheduleApprove').click();
    await page.locator('#calModalOverlay').waitFor({ state:'detached' });
    await waitForRevision(page, 4);

    const resizeHandle = page.locator('.cal-week-resize[data-calendar-event-action="resize"]');
    const resizeBox = await resizeHandle.boundingBox();
    assert.ok(resizeBox, 'visible resize handle has pointer geometry');
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2 + 28, { steps:4 });
    await page.mouse.up();
    await page.getByRole('dialog', { name:'Confirm resized schedule' }).waitFor({ state:'visible' });
    assert.strictEqual(await page.locator('#calEventEndTime').inputValue(), '13:30', 'pointer resize proposes a bounded extension');
    await screenshot(page, 'desktop-light-pointer-resize');
    await page.getByRole('button', { name:'Cancel', exact:true }).click();
    assert.strictEqual(scheduleRequests.length, 4, 'cancelled pointer resize sends no mutation');

    await page.reload({ waitUntil:'domcontentloaded' });
    await waitForRevision(page, 4);
    await context.close();

    const mobileContext = await browser.newContext({
      viewport: { width:390, height:844 },
      hasTouch: true,
      isMobile: true,
      timezoneId: 'UTC',
      colorScheme: 'dark',
      serviceWorkers: 'block',
    });
    await configureContext(mobileContext);
    const mobile = await mobileContext.newPage();
    watchPage(mobile);
    let mobilePatchMode = 'forbidden';
    await mobile.route(patchUrl, async (route) => {
      if (mobilePatchMode === 'forbidden') {
        mobilePatchMode = 'normal';
        await route.fulfill({
          status:403,
          contentType:'application/json',
          body:JSON.stringify({ code:'M22_APPROVAL_FORBIDDEN', error:{ message:'Current schedule approval authority is unavailable.' } }),
        });
        return;
      }
      await route.continue();
    });
    const mobileResponse = await mobile.goto(origin + '/dashboard/calendar', { waitUntil:'domcontentloaded' });
    assert.strictEqual(mobileResponse.status(), 200);
    await waitForRevision(mobile, 4);
    assert.strictEqual(await mobile.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), true);
    assert.strictEqual(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'mobile schedule does not overflow');
    await mobile.getByRole('button', { name:'Agenda' }).tap();
    await mobile.locator('.cal-agenda-resize[data-calendar-event-action="resize"]').tap();
    await mobile.getByRole('dialog', { name:'Confirm resized schedule' }).waitFor({ state:'visible' });
    await mobile.locator('#calEventEndTime').fill('13:30');
    await mobile.locator('#calScheduleConfirmed').check();
    await mobile.locator('#calScheduleApprove').tap();
    await mobile.locator('#calScheduleStatus[role="alert"]').waitFor({ state:'visible' });
    assert.match(await mobile.locator('#calScheduleStatus').textContent(), /no longer have permission/i);
    await screenshot(mobile, 'mobile-dark-forbidden-resize');
    await mobile.locator('#calScheduleApprove').tap();
    await mobile.locator('#calModalOverlay').waitFor({ state:'detached' });
    await waitForRevision(mobile, 5);
    await mobile.reload({ waitUntil:'domcontentloaded' });
    await waitForRevision(mobile, 5);
    await mobileContext.close();

    assert.strictEqual(scheduleRequests.length, 6, 'only explicit visible approvals emit the six expected attempts');
    assert.deepStrictEqual(scheduleRequests.map(item => item.body.action), [
      'calendar_edit', 'calendar_edit', 'calendar_edit',
      'calendar_drag_drop', 'calendar_resize', 'calendar_resize',
    ]);
    assert.deepStrictEqual(scheduleRequests.map(item => item.body.expectedRevision), [2, 2, 3, 3, 4, 4]);
    for (const submitted of scheduleRequests) {
      assert.strictEqual(submitted.headers['x-northstar-session-id'], simulationSession);
      assert.strictEqual(submitted.headers['x-csrf-token'], auth.csrfToken);
      assert.match(submitted.headers['idempotency-key'], /^calendar-(?:edit|drag-drop|resize)-[0-9a-f-]{36}$/);
      assert.match(submitted.body.expectedDigest, /^[0-9a-f]{64}$/);
      assert.ok(submitted.body.reason, 'every UI approval supplies a human reason');
    }

    const durable = (await pool.query(
      `SELECT assignment.revision, assignment.canonical_digest,
              assignment.scheduled_start, assignment.scheduled_end,
              appointment.scheduled_start AS appointment_start,
              appointment.scheduled_end AS appointment_end,
              approval.expected_revision, approval.expected_digest,
              approval.action_code, approval.auth_session_id,
              approval.idempotency_key_hash,
              (SELECT count(*)::int FROM canonical_schedule_approvals a
                WHERE a.assignment_id = assignment.id) AS approvals,
              (SELECT count(*)::int FROM canonical_schedule_assignment_revisions r
                WHERE r.assignment_id = assignment.id) AS revisions,
              (SELECT count(*)::int FROM canonical_schedule_audit_events e
                WHERE e.assignment_id = assignment.id) AS audits,
              (SELECT count(*)::int FROM canonical_schedule_idempotency i
                WHERE i.organization_id = assignment.organization_id
                  AND i.actor_user_id = $3) AS idempotency_rows
         FROM canonical_schedule_assignments assignment
         JOIN canonical_appointments appointment
           ON appointment.organization_id = assignment.organization_id
          AND appointment.id = assignment.appointment_id
         JOIN canonical_schedule_approvals approval
           ON approval.id = assignment.last_approval_id
        WHERE assignment.organization_id = $1 AND assignment.appointment_id = $2`,
      [ORGANIZATION_ID, appointmentId, OWNER_ID]
    )).rows[0];
    assert.strictEqual(Number(durable.revision), 5);
    assert.strictEqual(durable.scheduled_start.toISOString(), movedDate + 'T12:00:00.000Z');
    assert.strictEqual(durable.scheduled_end.toISOString(), movedDate + 'T13:30:00.000Z');
    assert.strictEqual(durable.appointment_start.toISOString(), durable.scheduled_start.toISOString());
    assert.strictEqual(durable.appointment_end.toISOString(), durable.scheduled_end.toISOString());
    assert.strictEqual(Number(durable.expected_revision), 4);
    assert.strictEqual(durable.action_code, 'calendar_resize');
    assert.strictEqual(durable.auth_session_id, auth.sessionId);
    assert.strictEqual(durable.idempotency_key_hash.trim(), sha256(scheduleRequests[5].headers['idempotency-key']));
    assert.deepStrictEqual({
      approvals: durable.approvals,
      revisions: durable.revisions,
      audits: durable.audits,
      idempotency: durable.idempotency_rows,
    }, { approvals: 4, revisions: 5, audits: 4, idempotency: 4 });
    const durableActions = (await pool.query(
      `SELECT action_code FROM public.canonical_schedule_approvals
        WHERE organization_id=$1 AND appointment_id=$2 ORDER BY approved_at, id`,
      [ORGANIZATION_ID, appointmentId]
    )).rows.map(row => row.action_code);
    assert.deepStrictEqual(durableActions, ['calendar_edit','calendar_edit','calendar_drag_drop','calendar_resize']);
    assert.deepStrictEqual(pageErrors, [], 'no uncaught Calendar page errors');
    const unexpectedConsoleErrors = consoleErrors.filter(message =>
      !/Failed to load resource: the server responded with a status of (409|503|403)/.test(message)
    );
    assert.deepStrictEqual(unexpectedConsoleErrors, [], 'no unexpected Calendar console errors');
    assert.deepStrictEqual(externalRequests, [], 'no external provider or asset requests');

    console.log(JSON.stringify({
      engine: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      browserVersion: browser.version(),
      postgresVersion: (await pool.query('SHOW server_version')).rows[0].server_version,
      timezone: (await pool.query('SHOW TimeZone')).rows[0].TimeZone,
      readModelVersion: before.model,
      appointmentId,
      beforeRevision: 1,
      afterRevision: 5,
      approvalRows: durable.approvals,
      revisionRows: durable.revisions,
      auditRows: durable.audits,
      idempotencyRows: durable.idempotency_rows,
      scheduleRequests: scheduleRequests.length,
      externalRequests: externalRequests.length,
      providerActions: 0,
      physicalSafari: false,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db && db.getPool()) await db.getPool().end();
    await suiteDatabase.cleanup();
    fs.rmSync(dataRoot, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
