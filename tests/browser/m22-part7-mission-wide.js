'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('pg');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { chooseFixturePlan, instantAt } = require('../helpers/m22-part6-browser-fixture-time');
const schedulingTime = require('../../public/js/scheduling-time-contract');

const ROOT = path.resolve(__dirname, '..', '..');
const ORGANIZATION_ID = 'a7700000-0000-4000-8000-000000000001';
const OWNER_ID = 'b7700000-0000-4000-8000-000000000001';
const EMPLOYEE_ID = 'b7700000-0000-4000-8000-000000000002';
const TEAMMATE_ID = 'b7700000-0000-4000-8000-000000000003';
const CREW_ID = 'c7700000-0000-4000-8000-000000000001';
const HOSTILE = '<img src=x onerror="globalThis.m22Part7Compromised=true">';
const MARKER = 'm22Part7Compromised=true';
const CUSTOMER = `Acceptance Customer ${HOSTILE}`;
const JOB = `Kitchen drain mission-wide trace ${HOSTILE}`;

function quoteIdentifier(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
function roleUrl(connectionString, role) {
  const parsed = new URL(connectionString);
  parsed.username = role;
  parsed.password = '';
  return parsed.toString();
}
async function createRoles(database, matrix) {
  const suffix = `${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  const safeMatrix = matrix.replace(/[^a-z0-9]+/gi, '_');
  const migrationRole = `northstar_m22_p7b_m_${safeMatrix}_${suffix}`.slice(0, 63);
  const runtimeRole = `northstar_m22_p7b_r_${safeMatrix}_${suffix}`.slice(0, 63);
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${quoteIdentifier(migrationRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`ALTER DATABASE ${quoteIdentifier(database.databaseName)} OWNER TO ${quoteIdentifier(migrationRole)}`);
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
    await admin.query(`DROP ROLE ${quoteIdentifier(roles.runtimeRole)}`);
    await admin.query(`DROP ROLE ${quoteIdentifier(roles.migrationRole)}`);
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
function cookies(session, origin) {
  return [
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ];
}
function installSessionMetadata(sessionId) {
  window.name = 'northstar-tab:m22-part7-' + sessionId;
  sessionStorage.setItem('northstarSessionOwner', window.name);
  sessionStorage.setItem('northstarSessionId', sessionId);
}
async function pins(pool, appointmentId, timeZone) {
  const row = (await pool.query(
    `SELECT revision,rtrim(canonical_digest) AS digest,target_state,workforce_profile_id,
            workforce_crew_id,scheduled_start,scheduled_end,appointment_status,dispatch_state
       FROM public.canonical_schedule_assignments
      WHERE organization_id=$1 AND appointment_id=$2`, [ORGANIZATION_ID, appointmentId]
  )).rows[0];
  assert.ok(row);
  return {
    revision: Number(row.revision), digest: row.digest,
    target: row.target_state === 'unassigned' ? { kind: 'unassigned', id: null }
      : row.workforce_profile_id ? { kind: 'profile', id: row.workforce_profile_id }
        : { kind: 'crew', id: row.workforce_crew_id },
    scheduledStart: row.scheduled_start ? schedulingTime.formatInstant(row.scheduled_start, timeZone).rfc3339 : null,
    scheduledEnd: row.scheduled_end ? schedulingTime.formatInstant(row.scheduled_end, timeZone).rfc3339 : null,
    appointmentStatus: row.appointment_status, dispatchState: row.dispatch_state,
  };
}
async function approve(app, pool, owner, appointmentId, timeZone, action, proposal, key) {
  const before = await pins(pool, appointmentId, timeZone);
  const reason = `Mission 22 Part 7 browser exact ${action} approval. ${HOSTILE}`;
  const previewBody = {
    expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: timeZone,
    action,
    target: Object.prototype.hasOwnProperty.call(proposal, 'target') ? proposal.target : before.target,
    scheduledStart: Object.prototype.hasOwnProperty.call(proposal, 'scheduledStart')
      ? proposal.scheduledStart : before.scheduledStart,
    scheduledEnd: Object.prototype.hasOwnProperty.call(proposal, 'scheduledEnd')
      ? proposal.scheduledEnd : before.scheduledEnd,
    appointmentStatus: before.appointmentStatus,
    reason,
  };
  const preview = await request(app)
    .post(`/api/v1/canonical/appointments/${appointmentId}/mutation-previews`)
    .set(owner.headers).send(previewBody);
  assert.strictEqual(preview.status, 201, JSON.stringify({ request: previewBody, response: preview.body }));
  const applied = await request(app)
    .post(`/api/v1/canonical/appointments/${appointmentId}/mutation-approvals`)
    .set(owner.headers).set('Idempotency-Key', key).send({
      previewId: preview.body.data.id,
      previewDigest: preview.body.data.previewDigest,
      acknowledgedWarningDigests: preview.body.data.warningDigests,
      acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests,
      reason,
    });
  assert.strictEqual(applied.status, 200, JSON.stringify(applied.body));
  return applied.body.data.scheduleAuthority;
}
function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}
function assertViewportGeometry(value) {
  assert.ok(value.documentWidth <= value.viewportWidth + 1, JSON.stringify(value));
  assert.ok(value.bodyWidth <= value.viewportWidth + 1, JSON.stringify(value));
}

async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  const mobile = process.argv.includes('--mobile');
  const dark = process.argv.includes('--dark');
  assert.ok(['chrome', 'webkit'].includes(selected));
  assert.ok(process.env.M19_PG_ADMIN_URL, 'M19_PG_ADMIN_URL must identify the disposable PostgreSQL 18 server');
  const runtime = resolveBrowserRuntime(selected);
  const matrix = `${selected}-${mobile ? 'mobile' : 'desktop'}-${dark ? 'dark' : 'light'}`;
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 };
  const evidenceRoot = process.env.M22_PART7_BROWSER_EVIDENCE_DIR
    ? path.resolve(process.env.M22_PART7_BROWSER_EVIDENCE_DIR) : null;
  const testedRevision = process.env.M22_PART7_TESTED_REVISION || null;
  const testedTree = process.env.M22_PART7_TESTED_TREE || null;
  if (evidenceRoot) {
    assert.match(testedRevision || '', /^[0-9a-f]{40}$/);
    assert.match(testedTree || '', /^[0-9a-f]{40}$/);
    fs.mkdirSync(evidenceRoot, { recursive: true });
  }
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p7-browser-'));
  const environmentKeys = [
    'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'NODE_ENV', 'AUTH_ACCESS_SECRET', 'NORTHSTAR_DATA_DIR',
    'OPENAI_API_KEY', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
    'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'GOOGLE_CALENDAR_CREDENTIALS',
    'GOOGLE_SHEETS_CLIENT_EMAIL', 'GOOGLE_SHEETS_PRIVATE_KEY', 'GOOGLE_SHEETS_SPREADSHEET_ID',
  ];
  const original = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  const suiteDatabase = await createSuiteDatabase(`m22-p7-browser-${matrix}`);
  let roles, db, server, browser, ownerContext, employeeContext;
  const external = [], pageErrors = [], network = [], screenshots = [];
  try {
    roles = await createRoles(suiteDatabase, matrix);
    process.env.DATABASE_URL = roles.runtimeUrl;
    process.env.MIGRATION_DATABASE_URL = roles.migrationUrl;
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.NORTHSTAR_DATA_DIR = dataRoot;
    environmentKeys.slice(5).forEach(key => { process.env[key] = ''; });
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const pool = db.getPool();
    const fixturePlan = chooseFixturePlan(new Date());
    await pool.query(
      `INSERT INTO public.organizations(id,name,email)
       VALUES ($1,'Mission 22 Part 7 Browser Tenant','part7-browser@example.test')`, [ORGANIZATION_ID]
    );
    await pool.query(
      `INSERT INTO public.users(id,organization_id,name,email,password_hash,role,status)
       VALUES ($1,$4,'Acceptance Owner','part7-owner@example.test','not-used','owner','active'),
              ($2,$4,$5,'part7-employee@example.test','not-used','member','active'),
              ($3,$4,$6,'part7-teammate@example.test','not-used','member','active')`,
      [OWNER_ID, EMPLOYEE_ID, TEAMMATE_ID, ORGANIZATION_ID,
        `Alex Technician ${HOSTILE}`, `Morgan Technician ${HOSTILE}`]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    const business = canonicalFenceProfile({ companyName: 'Mission 22 Part 7 Browser Tenant' });
    business.company.timeZone = fixturePlan.timeZone;
    business.scheduling = { maxJobsPerDay: 20, workDayLength: 24, appointmentBuffer: 0, travelBuffer: 0 };
    business.hours = {};
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
      business.hours[day] = { open: '00:00', close: '23:59', lunch: '', emergency: false, afterHours: false, holiday: false };
    }
    await putBusinessProfile(pool, {
      organizationId: ORGANIZATION_ID, userId: OWNER_ID, expectedVersion: null, profile: business,
    });
    const owner = await provisionDurableSession(pool, {
      userId: OWNER_ID, organizationId: ORGANIZATION_ID, membershipId: OWNER_ID, role: 'owner',
    });
    const employee = await provisionDurableSession(pool, {
      userId: EMPLOYEE_ID, organizationId: ORGANIZATION_ID, membershipId: EMPLOYEE_ID, role: 'member',
    });
    await provisionDurableSession(pool, {
      userId: TEAMMATE_ID, organizationId: ORGANIZATION_ID, membershipId: TEAMMATE_ID, role: 'member',
    });
    await pool.query(
      "UPDATE public.workforce_profiles SET operational_role='technician' WHERE organization_id=$1 AND id IN ($2,$3)",
      [ORGANIZATION_ID, EMPLOYEE_ID, TEAMMATE_ID]
    );
    await pool.query(
      `INSERT INTO public.workforce_crews(
         id,organization_id,crew_key,name,home_location_id,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,'part7-browser-crew',$3,'headquarters',$4,$4)`,
      [CREW_ID, ORGANIZATION_ID, `Acceptance Crew ${HOSTILE}`, OWNER_ID]
    );
    await pool.query(
      `INSERT INTO public.workforce_crew_members(
         organization_id,crew_id,profile_id,crew_role,created_by_user_id)
       VALUES ($1,$2,$3,'lead',$5),($1,$2,$4,'member',$5)`,
      [ORGANIZATION_ID, CREW_ID, EMPLOYEE_ID, TEAMMATE_ID, OWNER_ID]
    );
    const { app } = require('../../src/server');
    const simulationSession = `sim_m22_part7_browser_${matrix}`;
    const created = await request(app).post('/api/v1/simulations/leads')
      .set(owner.headers).set('X-NorthStar-Session-ID', simulationSession)
      .set('Idempotency-Key', `m22-part7-browser-${matrix}-${crypto.randomUUID()}`)
      .send({ name: CUSTOMER, service: 'fence', phone: '+15550107777', sessionId: simulationSession });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const appointmentId = created.body.ids.appointment;
    assert.strictEqual((await pool.query(
      `UPDATE public.canonical_transcripts
          SET source='manual',source_version='m22-part7-browser-mounted',transcript_text=$3
        WHERE organization_id=$1 AND id=$2`,
      [ORGANIZATION_ID, created.body.ids.transcript, `PRIVATE TRANSCRIPT ${HOSTILE}`]
    )).rowCount, 1);
    assert.strictEqual((await pool.query(
      `UPDATE public.canonical_customers
          SET name=$3,email='private-history@example.test',address=$4::jsonb
        WHERE organization_id=$1 AND id=$2`,
      [ORGANIZATION_ID, created.body.ids.customer, CUSTOMER, JSON.stringify({
        street: `125 Acceptance Avenue ${HOSTILE}`, city: 'Riverton', state: 'MA', postalCode: '02110',
        internalGateCode: 'SECRET-GATE',
      })]
    )).rowCount, 1);
    assert.strictEqual((await pool.query(
      `UPDATE public.canonical_opportunities
          SET service_type='Drain service',job_scope=$3::jsonb
        WHERE organization_id=$1 AND id=$2`,
      [ORGANIZATION_ID, created.body.ids.opportunity, JSON.stringify({
        jobTitle: JOB, instructions: `Use the side entrance. ${HOSTILE}`,
        internalMargin: 'SECRET_FINANCIAL_MARGIN', invoiceId: 'SECRET_INVOICE',
        payroll: 'SECRET_PAYROLL', broadCustomerHistory: 'SECRET_HISTORY',
      })]
    )).rowCount, 1);
    const at = offset => instantAt(fixturePlan, offset);
    await approve(app, pool, owner, appointmentId, fixturePlan.timeZone, 'assign',
      { target: { kind: 'profile', id: EMPLOYEE_ID } }, `m22-p7-${matrix}-assign`);
    await approve(app, pool, owner, appointmentId, fixturePlan.timeZone, 'schedule',
      { scheduledStart: at(30), scheduledEnd: at(50) }, `m22-p7-${matrix}-schedule`);
    await approve(app, pool, owner, appointmentId, fixturePlan.timeZone, 'dispatch', {}, `m22-p7-${matrix}-dispatch1`);
    await approve(app, pool, owner, appointmentId, fixturePlan.timeZone, 'reassign',
      { target: { kind: 'crew', id: CREW_ID } }, `m22-p7-${matrix}-reassign`);
    await approve(app, pool, owner, appointmentId, fixturePlan.timeZone, 'dispatch', {}, `m22-p7-${matrix}-dispatch2`);
    await approve(app, pool, owner, appointmentId, fixturePlan.timeZone, 'reschedule',
      { scheduledStart: at(65), scheduledEnd: at(85) }, `m22-p7-${matrix}-reschedule`);
    const exact = await pins(pool, appointmentId, fixturePlan.timeZone);
    assert.deepStrictEqual({ revision: exact.revision, dispatchState: exact.dispatchState, target: exact.target }, {
      revision: 7, dispatchState: 'revoked', target: { kind: 'crew', id: CREW_ID },
    });

    server = await listen(app);
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    const commonContext = {
      viewport, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce',
      timezoneId: 'America/Los_Angeles', hasTouch: mobile, isMobile: mobile,
      deviceScaleFactor: mobile ? 2 : 1, serviceWorkers: 'block',
    };
    ownerContext = await browser.newContext(commonContext);
    employeeContext = await browser.newContext(commonContext);
    await ownerContext.addCookies(cookies(owner, origin));
    await employeeContext.addCookies(cookies(employee, origin));
    await ownerContext.addInitScript(installSessionMetadata, `owner-${matrix}`);
    await employeeContext.addInitScript(installSessionMetadata, `employee-${matrix}`);
    async function intercept(context, identity) {
      await context.route('**/*', async route => {
        const target = new URL(route.request().url());
        if (target.origin !== origin) {
          external.push({ identity, method: route.request().method(), url: route.request().url() });
          await route.abort();
          return;
        }
        network.push({ identity, method: route.request().method(), path: target.pathname });
        await route.continue();
      });
    }
    await intercept(ownerContext, 'owner');
    await intercept(employeeContext, 'employee');

    async function screenshot(page, surface, state) {
      if (!evidenceRoot) return;
      const filename = `${matrix}-${surface}-${state}.png`;
      const absolute = path.join(evidenceRoot, filename);
      await page.screenshot({ path: absolute, fullPage: true });
      screenshots.push({ filename, sha256: sha256File(absolute), surface, state });
    }
    async function pageGeometry(page) {
      return page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
    }
    function attachErrors(page) { page.on('pageerror', error => pageErrors.push(error.message)); }

    const calendar = await ownerContext.newPage();
    attachErrors(calendar);
    await calendar.goto(`${origin}/dashboard/calendar`, { waitUntil: 'domcontentloaded' });
    await calendar.waitForFunction(({ id, revision }) => {
      const projection = window.CanonicalIntelligence && window.CanonicalIntelligence.getProjection('calendar');
      const record = projection && projection.schedulingOverview && projection.schedulingOverview.records
        .find(entry => entry.appointmentId === id);
      return record && record.authority.revision === revision;
    }, { id: appointmentId, revision: exact.revision });
    const calendarRecord = await calendar.evaluate(id => {
      const projection = window.CanonicalIntelligence && window.CanonicalIntelligence.getProjection('calendar');
      return projection && projection.schedulingOverview.records.find(record => record.appointmentId === id);
    }, appointmentId);
    assert.ok(calendarRecord);
    assert.strictEqual(calendarRecord.authority.revision, exact.revision);
    assert.strictEqual(calendarRecord.authority.digest, exact.digest);
    assert.strictEqual(calendarRecord.authority.dispatchState, 'revoked');
    assert.ok(JSON.stringify(calendarRecord).includes(MARKER), 'Calendar projection preserves hostile stored bytes as data');
    assert.strictEqual(await calendar.evaluate(() => Boolean(globalThis.m22Part7Compromised)), false);
    assert.strictEqual(await calendar.locator('img[src="x"]').count(), 0);
    await calendar.keyboard.press('Tab');
    assert.ok(await calendar.evaluate(() => document.activeElement && document.activeElement !== document.body));
    assertViewportGeometry(await pageGeometry(calendar));
    await screenshot(calendar, 'calendar', 'exact-revision-7');

    const commandCenter = await ownerContext.newPage();
    attachErrors(commandCenter);
    await commandCenter.goto(`${origin}/dashboard`, { waitUntil: 'domcontentloaded' });
    await commandCenter.locator('#commandCenterScheduling[aria-busy="false"]').waitFor({ state: 'visible' });
    await commandCenter.getByRole('button', { name: /^All \d+$/ }).click();
    const commandItem = commandCenter.locator(`#commandCenterSchedulingRecords [data-appointment-id="${appointmentId}"]`);
    await commandItem.waitFor({ state: 'visible' });
    const commandItemText = await commandItem.innerText();
    assert.ok(commandItemText.toLowerCase().includes(MARKER.toLowerCase()),
      `Command Center renders hostile bytes as inert text: ${JSON.stringify(commandItemText)}`);
    const commandResponse = await commandCenter.evaluate(async () => {
      const response = await fetch('/api/v1/command-center/workspace', { credentials: 'same-origin', cache: 'no-store' });
      return { status: response.status, body: await response.json() };
    });
    assert.strictEqual(commandResponse.status, 200);
    const commandRecord = commandResponse.body.data.schedulingOverview.records
      .find(record => record.appointmentId === appointmentId);
    assert.ok(commandRecord);
    assert.strictEqual(commandRecord.authority.revision, exact.revision);
    assert.strictEqual(commandRecord.authority.digest, exact.digest);
    assert.strictEqual(commandRecord.authority.dispatchState, 'revoked');
    assert.strictEqual(await commandCenter.evaluate(() => Boolean(globalThis.m22Part7Compromised)), false);
    assert.strictEqual(await commandCenter.locator('img[src="x"]').count(), 0);
    assertViewportGeometry(await pageGeometry(commandCenter));
    await screenshot(commandCenter, 'command-center-reference', 'exact-revision-7');

    const today = await employeeContext.newPage();
    attachErrors(today);
    await today.goto(`${origin}/dashboard/today`, { waitUntil: 'domcontentloaded' });
    await today.waitForFunction(() => document.body.getAttribute('data-today-state') !== 'loading');
    const todayResponse = await today.evaluate(async () => {
      const response = await fetch('/api/v1/today', { credentials: 'same-origin', cache: 'no-store' });
      return { status: response.status, body: await response.json() };
    });
    assert.strictEqual(todayResponse.status, 200);
    const todayRecord = todayResponse.body.data.records.find(record => record.appointmentId === appointmentId);
    assert.ok(todayRecord);
    assert.strictEqual(todayRecord.authority.revision, exact.revision);
    assert.strictEqual(todayRecord.authority.digest, exact.digest);
    assert.strictEqual(todayRecord.assignment.kind, 'crew');
    assert.strictEqual(todayRecord.assignment.currentCrew, true);
    assert.strictEqual(todayRecord.dispatch.state, 'revoked');
    assert.strictEqual(todayRecord.route.providerCalls, 0);
    assert.strictEqual(todayRecord.route.travelDurationMinutes, null);
    const todayItem = today.locator(`#todayRecords [data-appointment-id="${appointmentId}"]`);
    await todayItem.waitFor({ state: 'visible' });
    assert.ok((await todayItem.innerText()).toLowerCase().includes(MARKER.toLowerCase()),
      'Today renders permitted hostile bytes as inert text');
    const todayBytes = JSON.stringify(todayResponse.body);
    for (const forbidden of [
      'SECRET_FINANCIAL_MARGIN', 'SECRET_INVOICE', 'SECRET_PAYROLL', 'SECRET_HISTORY',
      'SECRET-GATE', 'private-history@example.test', 'PRIVATE TRANSCRIPT',
    ]) assert.ok(!todayBytes.includes(forbidden), forbidden);
    assert.strictEqual(await today.evaluate(() => Boolean(globalThis.m22Part7Compromised)), false);
    assert.strictEqual(await today.locator('img[src="x"]').count(), 0);
    assertViewportGeometry(await pageGeometry(today));
    if (mobile) {
      const reload = today.getByRole('button', { name: /reload/i }).first();
      if (await reload.count()) await reload.tap();
    } else {
      await today.keyboard.press('Tab');
      assert.ok(await today.evaluate(() => document.activeElement && document.activeElement !== document.body));
    }
    await screenshot(today, 'employee-today', 'crew-reschedule-dispatch-revoked');

    assert.strictEqual((await pool.query(
      `DELETE FROM public.workforce_crew_members
        WHERE organization_id=$1 AND crew_id=$2 AND profile_id=$3`,
      [ORGANIZATION_ID, CREW_ID, EMPLOYEE_ID]
    )).rowCount, 1);
    await today.reload({ waitUntil: 'domcontentloaded' });
    await today.waitForFunction(() => document.body.getAttribute('data-today-state') !== 'loading');
    const revokedResponse = await today.evaluate(async () => {
      const response = await fetch('/api/v1/today', { credentials: 'same-origin', cache: 'no-store' });
      return { status: response.status, body: await response.json() };
    });
    assert.strictEqual(revokedResponse.status, 200);
    assert.strictEqual(revokedResponse.body.data.records.some(record => record.appointmentId === appointmentId), false);
    assert.ok(!JSON.stringify(revokedResponse.body.data.records).includes(MARKER));
    assertViewportGeometry(await pageGeometry(today));
    await screenshot(today, 'employee-today', 'crew-membership-revoked');

    assert.deepStrictEqual(external, []);
    assert.deepStrictEqual(pageErrors, []);
    for (const forbiddenPath of ['/api/auth/me', '/api/v1/workforce', '/api/v1/business-profile']) {
      assert.strictEqual(network.some(entry => entry.identity === 'employee' && entry.path === forbiddenPath), false,
        `employee network requested ${forbiddenPath}`);
    }
    const evidence = {
      version: 'm22-part7-browser-trace-v1', matrix,
      browser: { requested: selected, runtimeName: runtime.name, version: browser.version(), physicalSafari: false },
      viewport, theme: dark ? 'dark' : 'light', reducedMotion: 'reduce',
      testedRevision, testedTree, appointmentId, assignmentRevision: exact.revision,
      assignmentDigest: exact.digest, target: exact.target, dispatchState: exact.dispatchState,
      surfaces: ['calendar', 'command-center-reference', 'employee-today'],
      commandCenterPrimaryThemeReference: true,
      employeeCrewRevocation: 'prior appointment absent after durable membership deletion',
      externalRequests: external, providerCalls: 0, providerCredentials: 'all omitted',
      network, pageErrors, screenshots,
      webkitIsPhysicalSafari: false,
      userVisualApproval: 'separate and unclaimed',
    };
    if (evidenceRoot) {
      fs.writeFileSync(path.join(evidenceRoot, `${matrix}-browser-trace.json`), JSON.stringify(evidence, null, 2) + '\n');
    }
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    if (employeeContext) await employeeContext.close().catch(() => {});
    if (ownerContext) await ownerContext.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await closeServer(server).catch(() => {});
    if (db) await db.close().catch(() => {});
    await suiteDatabase.cleanup().catch(() => {});
    await dropRoles(roles).catch(() => {});
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const resolved = path.resolve(dataRoot);
    const safe = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(safe) || !path.basename(resolved).startsWith('northstar-m22-p7-browser-')) {
      throw new Error('Refusing unsafe Part 7 browser data cleanup');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
