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
        name: 'Calendar Authority Customer',
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

    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      timezoneId: 'UTC',
      serviceWorkers: 'block',
    });
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

    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('request', (browserRequest) => {
      if (browserRequest.method() === 'PATCH' &&
          browserRequest.url() === origin + '/api/v1/canonical/appointments/' + appointmentId) {
        scheduleRequests.push({
          url: browserRequest.url(),
          method: browserRequest.method(),
          headers: browserRequest.headers(),
          body: browserRequest.postDataJSON(),
        });
      }
    });

    const response = await page.goto(origin + '/dashboard/calendar', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(response.status(), 200, 'mounted Calendar page loads');
    try {
      await page.waitForFunction((expectedId) => {
        return document.documentElement.dataset.canonicalAuthority === 'server' &&
          window.calState && window.calState.events.length === 1 &&
          window.calState.events[0].id === expectedId &&
          window.calState.events[0].scheduleAuthority &&
          window.calState.events[0].scheduleAuthority.revision === 1;
      }, appointmentId, { timeout: 15000 });
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
    assert.strictEqual(before.authority.digest, initial.canonical_digest.trim(), 'browser pins the server revision digest');

    const update = await page.evaluate(async (id) => {
      return window.calData.updateEvent(id, {
        date: '2040-03-10',
        time: '10:00',
        endTime: '11:30',
      });
    }, appointmentId);
    assert.ok(update, 'Calendar client returns the mounted authoritative response');
    assert.strictEqual(update.scheduleAuthority.revision, 2);
    assert.strictEqual(update.scheduleAuthority.scheduleState, 'scheduled');
    assert.strictEqual(update.scheduleAuthority.scheduledStart, '2040-03-10T10:00:00.000Z');
    assert.strictEqual(update.scheduleAuthority.scheduledEnd, '2040-03-10T11:30:00.000Z');
    assert.strictEqual(scheduleRequests.length, 1, 'one human-approved Calendar mutation is emitted');

    const submitted = scheduleRequests[0];
    assert.deepStrictEqual(submitted.body, {
      scheduledStart: '2040-03-10T10:00:00.000Z',
      scheduledEnd: '2040-03-10T11:30:00.000Z',
      status: 'scheduled',
      expectedRevision: 1,
      expectedDigest: initial.canonical_digest.trim(),
      action: 'calendar_edit',
    });
    assert.strictEqual(submitted.headers['x-northstar-session-id'], simulationSession);
    assert.strictEqual(submitted.headers['x-csrf-token'], auth.csrfToken);
    assert.match(submitted.headers['idempotency-key'], /^calendar-edit-[0-9a-f-]{36}$/);

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
    assert.strictEqual(Number(durable.revision), 2);
    assert.strictEqual(durable.scheduled_start.toISOString(), '2040-03-10T10:00:00.000Z');
    assert.strictEqual(durable.scheduled_end.toISOString(), '2040-03-10T11:30:00.000Z');
    assert.strictEqual(durable.appointment_start.toISOString(), durable.scheduled_start.toISOString());
    assert.strictEqual(durable.appointment_end.toISOString(), durable.scheduled_end.toISOString());
    assert.strictEqual(Number(durable.expected_revision), 1);
    assert.strictEqual(durable.expected_digest.trim(), initial.canonical_digest.trim());
    assert.strictEqual(durable.action_code, 'calendar_edit');
    assert.strictEqual(durable.auth_session_id, auth.sessionId);
    assert.strictEqual(durable.idempotency_key_hash.trim(), sha256(submitted.headers['idempotency-key']));
    assert.deepStrictEqual({
      approvals: durable.approvals,
      revisions: durable.revisions,
      audits: durable.audits,
      idempotency: durable.idempotency_rows,
    }, { approvals: 1, revisions: 2, audits: 1, idempotency: 1 });
    assert.deepStrictEqual(pageErrors, [], 'no uncaught Calendar page errors');
    assert.deepStrictEqual(consoleErrors, [], 'no Calendar console errors');
    assert.deepStrictEqual(externalRequests, [], 'no external provider or asset requests');

    console.log(JSON.stringify({
      engine: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      browserVersion: browser.version(),
      postgresVersion: (await pool.query('SHOW server_version')).rows[0].server_version,
      timezone: (await pool.query('SHOW TimeZone')).rows[0].TimeZone,
      readModelVersion: before.model,
      appointmentId,
      beforeRevision: 1,
      afterRevision: 2,
      approvalRows: durable.approvals,
      revisionRows: durable.revisions,
      auditRows: durable.audits,
      idempotencyRows: durable.idempotency_rows,
      scheduleRequests: scheduleRequests.length,
      externalRequests: externalRequests.length,
      providerActions: 0,
      physicalSafari: false,
    }));
    await context.close();
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
