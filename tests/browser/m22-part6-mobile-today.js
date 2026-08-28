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
const schedulingTime = require('../../public/js/scheduling-time-contract');
const { chooseFixturePlan, instantAt } = require('../helpers/m22-part6-browser-fixture-time');

const ORGANIZATION_ID = 'a2600000-0000-4000-8000-000000000001';
const OWNER_ID = 'b2600000-0000-4000-8000-000000000001';
const EMPLOYEE_ID = 'b2600000-0000-4000-8000-000000000002';
const TEAMMATE_ID = 'b2600000-0000-4000-8000-000000000003';
const CREW_ID = 'c2600000-0000-4000-8000-000000000001';
const HOSTILE = '<img src=x onerror="globalThis.m22Part6Compromised=true">';
let fixtureTimeZone = 'America/New_York';
const WITHHELD = Object.freeze([
  'SECRET_FINANCIAL_MARGIN', 'SECRET_INVOICE', 'SECRET_PAYROLL', 'SECRET_HISTORY',
  'SECRET-GATE', 'private-history@example.test', 'PRIVATE TRANSCRIPT',
]);
const CUSTOMER_WITHHELD = Object.freeze([
  'financials', 'billing and subscription settings', 'broad customer history',
  'other workers schedules', 'Polaris cost intelligence', 'Mission 23 controls', 'provider credentials',
]);
const NON_READY_PRESENTATION = Object.freeze({
  loading: Object.freeze({ visible: ['loading state', 'read-only shell'], withheld: ['all private work records; prior cards cleared'] }),
  error: Object.freeze({ visible: ['network error state', 'real reload control', 'read-only shell'], withheld: ['all private work records; prior cards cleared'] }),
  offline: Object.freeze({ visible: ['offline state', 'reconnect guidance', 'read-only shell'], withheld: ['all private work records; prior cards cleared'] }),
  stale: Object.freeze({ visible: ['stale authority state', 'real reload control', 'read-only shell'], withheld: ['all private work records; prior cards cleared'] }),
  restricted: Object.freeze({ visible: ['access-changed state', 'sign-in or administrator guidance', 'read-only shell'], withheld: ['all private work records; prior cards cleared'] }),
  empty: Object.freeze({ visible: ['personal no-work state', 'read-only shell'], withheld: ['all private work records; none returned'] }),
});

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
  window.name = 'northstar-tab:m22-part6-' + sessionId;
  sessionStorage.setItem('northstarSessionOwner', window.name);
  sessionStorage.setItem('northstarSessionId', sessionId);
}
async function pins(pool, appointmentId) {
  const row = (await pool.query(
    `SELECT revision,rtrim(canonical_digest) AS digest,target_state,workforce_profile_id,workforce_crew_id,
            scheduled_start,scheduled_end,appointment_status
       FROM public.canonical_schedule_assignments WHERE organization_id=$1 AND appointment_id=$2`,
    [ORGANIZATION_ID, appointmentId]
  )).rows[0];
  assert.ok(row);
  return {
    revision: Number(row.revision), digest: row.digest,
    target: row.target_state === 'unassigned' ? { kind: 'unassigned', id: null }
      : row.workforce_profile_id ? { kind: 'profile', id: row.workforce_profile_id } : { kind: 'crew', id: row.workforce_crew_id },
    scheduledStart: row.scheduled_start ? schedulingTime.formatInstant(row.scheduled_start, fixtureTimeZone).rfc3339 : null,
    scheduledEnd: row.scheduled_end ? schedulingTime.formatInstant(row.scheduled_end, fixtureTimeZone).rfc3339 : null,
    appointmentStatus: row.appointment_status,
  };
}
async function approve(app, pool, owner, appointmentId, action, proposal) {
  const before = await pins(pool, appointmentId);
  const reason = 'Part 6 disposable browser fixture exact human approval.';
  const previewBody = {
    expectedRevision: before.revision, expectedDigest: before.digest, expectedTimeZone: fixtureTimeZone, action,
    target: proposal.target || before.target,
    scheduledStart: Object.prototype.hasOwnProperty.call(proposal, 'scheduledStart') ? proposal.scheduledStart : before.scheduledStart,
    scheduledEnd: Object.prototype.hasOwnProperty.call(proposal, 'scheduledEnd') ? proposal.scheduledEnd : before.scheduledEnd,
    appointmentStatus: before.appointmentStatus, reason,
  };
  const preview = await request(app).post(`/api/v1/canonical/appointments/${appointmentId}/mutation-previews`)
    .set(owner.headers).send(previewBody);
  assert.strictEqual(preview.status, 201, JSON.stringify({ response: preview.body, request: previewBody }));
  const applied = await request(app).post(`/api/v1/canonical/appointments/${appointmentId}/mutation-approvals`)
    .set(owner.headers).set('Idempotency-Key', crypto.randomUUID()).send({
      previewId: preview.body.data.id, previewDigest: preview.body.data.previewDigest,
      acknowledgedWarningDigests: preview.body.data.warningDigests,
      acknowledgedReviewReasonDigests: preview.body.data.reviewReasonDigests, reason,
    });
  assert.strictEqual(applied.status, 200, JSON.stringify(applied.body));
}
async function createWork(app, pool, owner, ordinal) {
  const sessionId = `sim_m22_part6_browser_${ordinal}_${crypto.randomBytes(4).toString('hex')}`;
  const created = await request(app).post('/api/v1/simulations/leads')
    .set(owner.headers).set('X-NorthStar-Session-ID', sessionId)
    .set('Idempotency-Key', `m22-part6-browser-${ordinal}-${crypto.randomUUID()}`)
    .send({ name: `Browser customer ${ordinal}`, service: 'plumbing', phone: '+15550106222', sessionId });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  const ids = created.body.ids;
  assert.strictEqual((await pool.query(
    `UPDATE public.canonical_transcripts SET source='manual',source_version='m22-part6-browser'
      WHERE organization_id=$1 AND id=$2`, [ORGANIZATION_ID, ids.transcript]
  )).rowCount, 1);
  await pool.query(
    `UPDATE public.canonical_customers
        SET name=$3,email='private-history@example.test',phone='+15550106222',
            address=$4::jsonb
      WHERE organization_id=$1 AND id=$2`,
    [ORGANIZATION_ID, ids.customer, `Customer ${ordinal} ${HOSTILE}`, JSON.stringify({
      street: `12 Test Way ${HOSTILE}`, city: 'Boston', state: 'MA', postalCode: '02110', internalGateCode: 'SECRET-GATE',
    })]
  );
  await pool.query(
    `UPDATE public.canonical_opportunities
        SET service_type='Drain service',job_scope=$3::jsonb
      WHERE organization_id=$1 AND id=$2`,
    [ORGANIZATION_ID, ids.opportunity, JSON.stringify({
      jobTitle: `Kitchen drain ${ordinal} ${HOSTILE}`, instructions: `Use the side entrance for job ${ordinal}. ${HOSTILE}`,
      internalMargin: 'SECRET_FINANCIAL_MARGIN', invoiceId: 'SECRET_INVOICE', payroll: 'SECRET_PAYROLL', broadCustomerHistory: 'SECRET_HISTORY',
    })]
  );
  await pool.query(
    `UPDATE public.canonical_transcripts SET transcript_text=$3
      WHERE organization_id=$1 AND id=$2`, [ORGANIZATION_ID, ids.transcript, `PRIVATE TRANSCRIPT ${HOSTILE}`]
  );
  return ids.appointment;
}
function cookies(session, origin) {
  const values = [
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ];
  if (session.refreshToken) values.push({
    name: 'northstar_refresh', value: session.refreshToken, url: origin, httpOnly: true, sameSite: 'Lax',
  });
  return values;
}
function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}
function dateKeyInZone(value, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function quoteIdentifier(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
function roleUrl(connectionString, role) {
  const parsed = new URL(connectionString); parsed.username = role; parsed.password = ''; return parsed.toString();
}
async function createRoles(database, matrix) {
  const suffix = `${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  const migrationRole = `northstar-m22-p6b-m-${matrix}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 63);
  const runtimeRole = `northstar-m22-p6b-r-${matrix}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 63);
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${quoteIdentifier(migrationRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`ALTER DATABASE ${quoteIdentifier(database.databaseName)} OWNER TO ${quoteIdentifier(migrationRole)}`);
  } finally { await admin.end(); }
  return { migrationRole, runtimeRole, migrationUrl: roleUrl(database.connectionString, migrationRole), runtimeUrl: roleUrl(database.connectionString, runtimeRole) };
}
async function dropRoles(roles) {
  if (!roles) return;
  const admin = new Client({ connectionString: process.env.M19_PG_ADMIN_URL });
  await admin.connect();
  try { await admin.query(`DROP ROLE ${quoteIdentifier(roles.runtimeRole)}`); await admin.query(`DROP ROLE ${quoteIdentifier(roles.migrationRole)}`); }
  finally { await admin.end(); }
}

async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  const mobile = process.argv.includes('--mobile');
  const dark = process.argv.includes('--dark');
  assert.ok(['chrome', 'webkit'].includes(selected));
  assert.ok(process.env.M19_PG_ADMIN_URL, 'M19_PG_ADMIN_URL must identify disposable PostgreSQL 18');
  const runtime = resolveBrowserRuntime(selected);
  const matrix = `${selected}-${mobile ? 'mobile' : 'desktop'}-${dark ? 'dark' : 'light'}`;
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 };
  const evidenceRoot = process.env.M22_PART6_EVIDENCE_DIR ? path.resolve(process.env.M22_PART6_EVIDENCE_DIR) : null;
  const testedRevision = process.env.M22_PART6_TESTED_REVISION || null;
  const testedTree = process.env.M22_PART6_TESTED_TREE || null;
  if (evidenceRoot) {
    assert.match(testedRevision || '', /^[0-9a-f]{40}$/);
    assert.match(testedTree || '', /^[0-9a-f]{40}$/);
    fs.mkdirSync(evidenceRoot, { recursive: true });
  }
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m22-p6-browser-'));
  const environment = ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'NODE_ENV', 'AUTH_ACCESS_SECRET', 'NORTHSTAR_DATA_DIR',
    'OPENAI_API_KEY', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
    'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'GOOGLE_CALENDAR_CREDENTIALS',
    'GOOGLE_SHEETS_CLIENT_EMAIL', 'GOOGLE_SHEETS_PRIVATE_KEY', 'GOOGLE_SHEETS_SPREADSHEET_ID'];
  const original = Object.fromEntries(environment.map(key => [key, process.env[key]]));
  const suiteDatabase = await createSuiteDatabase(`m22-p6-browser-${matrix}`);
  let roles, db, server, browser, context, ownerContext, logoutContext;
  const external = [], browserErrors = [], network = [], responseBodies = [], responseInventory = [], responseCaptureTasks = [], screenshots = [];
  let sameOriginResponseEvents = 0;
  try {
    roles = await createRoles(suiteDatabase, matrix);
    process.env.DATABASE_URL = roles.runtimeUrl;
    process.env.MIGRATION_DATABASE_URL = roles.migrationUrl;
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    process.env.NORTHSTAR_DATA_DIR = dataRoot;
    environment.slice(5).forEach(key => { process.env[key] = ''; });
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const pool = db.getPool();
    await pool.query(`INSERT INTO organizations(id,name,email) VALUES ($1,'Part 6 Browser Tenant','part6-browser@example.test')`, [ORGANIZATION_ID]);
    await pool.query(
      `INSERT INTO users(id,organization_id,name,email,password_hash,role,status)
       VALUES ($1,$4,'Owner Operator','part6-owner@example.test','not-used','owner','active'),
              ($2,$4,$5,'part6-employee@example.test','not-used','member','active'),
              ($3,$4,$6,'part6-teammate@example.test','not-used','member','active')`,
      [OWNER_ID, EMPLOYEE_ID, TEAMMATE_ID, ORGANIZATION_ID, `Alex Employee ${HOSTILE}`, `Morgan Teammate ${HOSTILE}`]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    const business = canonicalFenceProfile({ companyName: 'Part 6 Browser Tenant' });
    const fixturePlan = chooseFixturePlan(new Date());
    fixtureTimeZone = fixturePlan.timeZone;
    business.company.timeZone = fixturePlan.timeZone;
    business.scheduling = { maxJobsPerDay: 100, workDayLength: 24, appointmentBuffer: 0, travelBuffer: 0 };
    business.hours = {};
    for (const weekday of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
      business.hours[weekday] = { open: '00:00', close: '23:59', lunch: '', emergency: false, afterHours: false, holiday: false };
    }
    await putBusinessProfile(pool, { organizationId: ORGANIZATION_ID, userId: OWNER_ID, expectedVersion: null, profile: business });
    const owner = await provisionDurableSession(pool, { userId: OWNER_ID, organizationId: ORGANIZATION_ID, membershipId: OWNER_ID, role: 'owner' });
    const employee = await provisionDurableSession(pool, { userId: EMPLOYEE_ID, organizationId: ORGANIZATION_ID, membershipId: EMPLOYEE_ID, role: 'member' });
    const logoutEmployee = await provisionDurableSession(pool, { userId: EMPLOYEE_ID, organizationId: ORGANIZATION_ID, membershipId: EMPLOYEE_ID, role: 'member' });
    logoutEmployee.refreshToken = crypto.randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO public.auth_refresh_tokens(id,session_id,family_id,token_hash,expires_at)
       VALUES ($1,$2,$3,$4,NOW()+INTERVAL '14 days')`,
      [crypto.randomUUID(), logoutEmployee.sessionId, crypto.randomUUID(),
        require('../../src/auth/credentials').hashToken(logoutEmployee.refreshToken)]
    );
    await provisionDurableSession(pool, { userId: TEAMMATE_ID, organizationId: ORGANIZATION_ID, membershipId: TEAMMATE_ID, role: 'member' });
    await pool.query("UPDATE workforce_profiles SET operational_role='technician' WHERE organization_id=$1 AND id IN ($2,$3)", [ORGANIZATION_ID, EMPLOYEE_ID, TEAMMATE_ID]);
    await pool.query(
      `INSERT INTO workforce_crews(id,organization_id,crew_key,name,home_location_id,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,'part6-browser-crew',$3,'headquarters',$4,$4)`, [CREW_ID, ORGANIZATION_ID, `East crew ${HOSTILE}`, OWNER_ID]
    );
    await pool.query(
      `INSERT INTO workforce_crew_members(organization_id,crew_id,profile_id,crew_role,created_by_user_id)
       VALUES ($1,$2,$3,'lead',$4),($1,$2,$4,'member',$4)`, [ORGANIZATION_ID, CREW_ID, EMPLOYEE_ID, TEAMMATE_ID]
    );
    const { app } = require('../../src/server');
    const appointmentIds = [];
    for (let ordinal = 0; ordinal < 5; ordinal += 1) appointmentIds.push(await createWork(app, pool, owner, ordinal + 1));
    const at = offset => instantAt(fixturePlan, offset);
    await approve(app, pool, owner, appointmentIds[0], 'assign', { target: { kind: 'profile', id: EMPLOYEE_ID } });
    await approve(app, pool, owner, appointmentIds[0], 'schedule', { scheduledStart: at(0), scheduledEnd: at(20) });
    await approve(app, pool, owner, appointmentIds[0], 'dispatch', {});
    await approve(app, pool, owner, appointmentIds[1], 'assign', { target: { kind: 'crew', id: CREW_ID } });
    await approve(app, pool, owner, appointmentIds[1], 'schedule', { scheduledStart: at(30), scheduledEnd: at(50) });
    await approve(app, pool, owner, appointmentIds[2], 'assign', { target: { kind: 'profile', id: EMPLOYEE_ID } });
    await approve(app, pool, owner, appointmentIds[2], 'schedule', { scheduledStart: at(60), scheduledEnd: at(80) });
    await approve(app, pool, owner, appointmentIds[2], 'dispatch', {});
    await approve(app, pool, owner, appointmentIds[2], 'reschedule', { scheduledStart: at(65), scheduledEnd: at(85) });
    await approve(app, pool, owner, appointmentIds[3], 'assign', { target: { kind: 'profile', id: TEAMMATE_ID } });
    await approve(app, pool, owner, appointmentIds[3], 'schedule', { scheduledStart: at(90), scheduledEnd: at(110) });
    server = await listen(app);
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    const version = browser.version();

    context = await browser.newContext({ viewport, colorScheme: dark ? 'dark' : 'light', timezoneId: 'America/Los_Angeles',
      hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1, serviceWorkers: 'block' });
    await context.addCookies(cookies(employee, origin));
    await context.addInitScript(installSessionMetadata, `employee-${matrix}`);
    await context.route('**/*', async route => {
      const target = new URL(route.request().url());
      if (target.origin !== origin) { external.push({ method: route.request().method(), url: target.href }); await route.abort(); return; }
      await route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('request', value => {
      const target = new URL(value.url());
      if (target.origin === origin) network.push({ method: value.method(), url: value.url(), pathname: target.pathname });
    });
    page.on('response', value => {
      const target = new URL(value.url());
      const captureResponse = (async () => {
        if (target.origin !== origin) return;
        sameOriginResponseEvents += 1;
        const headers = value.headers();
        const contentType = String(headers['content-type'] || '').toLowerCase();
        let body = null;
        if (target.pathname === '/api/telemetry' && value.status() === 202) {
          body = '';
        } else if (/(?:json|javascript|text\/|css|html)/.test(contentType)) {
          try { body = (await value.body()).toString('utf8'); } catch (_error) { body = null; }
        }
        responseInventory.push({ method: value.request().method(), pathname: target.pathname, status: value.status(),
          contentType, contentLength: headers['content-length'] || null, body });
        if (target.pathname === '/api/v1/today' && value.status() === 200 && body) {
          try { responseBodies.push(JSON.parse(body)); } catch (_error) {}
        }
      })();
      const task = Promise.race([
        captureResponse,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`response body capture timed out: ${target.pathname}`)), 10000)),
      ]);
      responseCaptureTasks.push(task);
    });

    async function capture(label, state, identity, assignmentMode, stateProvenance) {
      if (!evidenceRoot) return;
      const filename = path.join(evidenceRoot, `${matrix}-${label}.png`);
      await page.screenshot({ path: filename, fullPage: true });
      const nonReady = NON_READY_PRESENTATION[state];
      const expectedVisible = nonReady ? [...nonReady.visible] : [
        'minimum job and customer essentials', 'current assignment, schedule and dispatch truth',
        'provider-neutral route uncertainty', 'read-only state',
      ];
      const expectedWithheld = [...CUSTOMER_WITHHELD, ...(nonReady ? nonReady.withheld : [])];
      const durableSession = 'mounted real PostgreSQL cookie session; nonsecret test identity';
      screenshots.push({ filename: path.basename(filename), browser: selected,
        engineLabel: selected === 'webkit' ? 'Playwright WebKit (not physical Safari)' : 'Installed Google Chrome',
        version, viewport, theme: dark ? 'dark' : 'light', realRoleIdentity: identity, assignmentMode, state,
        testedRevision, testedTree, fixtureTenant: 'isolated disposable Part 6 Browser Tenant', fixtureTenantTimeZone: fixturePlan.timeZone,
        fixtureReferenceInstant: fixturePlan.referenceInstant,
        sessionProvenance: stateProvenance ? `${durableSession}; ${stateProvenance}` : durableSession,
        stateProvenance: stateProvenance || 'real mounted PostgreSQL authority and transport; no synthetic state injection',
        sourceRoute: '/dashboard/today', expectedVisible, expectedWithheld, withheldCategories: expectedWithheld,
        timestamp: new Date().toISOString() });
    }
    async function waitState(state) { await page.waitForFunction(expected => document.body.dataset.todayState === expected, state, { timeout: 20000 }); }

    const todayResponse = page.waitForResponse(value => value.url().includes('/api/v1/today') && value.status() === 200);
    await page.goto(origin + '/dashboard/today', { waitUntil: 'domcontentloaded' });
    const primaryResponse = await todayResponse;
    const primaryBody = await primaryResponse.json();
    await page.waitForTimeout(250);
    await Promise.all(responseCaptureTasks);
    if (await page.getAttribute('body', 'data-today-state') !== 'ready') {
      throw new Error(JSON.stringify({ state: await page.getAttribute('body', 'data-today-state'), browserErrors, primaryBody }));
    }
    await waitState('ready');
    assert.strictEqual(primaryBody.data.records.length, 3);
    assert.deepStrictEqual(primaryBody.data.records.map(record => record.appointmentId), appointmentIds.slice(0, 3));
    assert.deepStrictEqual(primaryBody.data.records.map(record => record.dispatch.state), ['dispatched', 'not_dispatched', 'revoked']);
    assert.ok(primaryBody.data.records.some(record => record.assignment.currentCrew));
    assert.ok(primaryBody.data.records.every(record => record.route.providerNeutral && record.route.providerCalls === 0));
    const serialized = JSON.stringify(primaryBody);
    WITHHELD.forEach(value => assert.ok(!serialized.includes(value), `withheld API category leaked: ${value}`));
    const pageText = await page.locator('#todayMain').innerText();
    ['Margin', 'Payroll', 'Billing', 'Subscriptions', 'Settings', 'Customer history', 'Start job', 'Arrive', 'En route', 'Complete job', 'Clock in', 'Upload photo']
      .forEach(value => assert.ok(!pageText.includes(value), `withheld DOM category leaked: ${value}`));
    assert.strictEqual(await page.locator('[data-nav-id]:not([data-nav-id="today"])').count(), 0);
    assert.strictEqual(await page.locator('#northstarQuickStartButton, #northstarQuickStartDialog').count(), 0);
    assert.strictEqual(await page.locator('#todayRecords img').count(), 0);
    assert.strictEqual(await page.evaluate(() => Boolean(globalThis.m22Part6Compromised)), false);
    assert.strictEqual(await page.getByText('Read-only', { exact: true }).count(), 1);
    assert.strictEqual(await page.getByText('Assigned to you', { exact: true }).count(), 2);
    assert.strictEqual(await page.getByText('Current crew', { exact: true }).count() >= 1, true);
    assert.deepStrictEqual(Object.keys(primaryBody.data.identity).sort(), ['displayName', 'operationalRole']);
    assert.strictEqual(network.some(entry => entry.pathname === '/api/auth/me'), false);
    const allowedEmployeePaths = new Set([
      '/dashboard/today', '/api/v1/today', '/js/theme.js', '/js/today-shell.js', '/js/today-page.js',
      '/css/style.css', '/css/homepage-refresh.css', '/css/demo-dashboard.css', '/css/today.css',
      '/css/site-professionalism.css', '/assets/logo.png',
    ]);
    network.forEach(entry => assert.ok(allowedEmployeePaths.has(entry.pathname), `unapproved employee network destination: ${JSON.stringify(entry)}`));
    const broadEmployeePaths = [
      '/api/auth/me', '/dashboard/polaris', '/dashboard/leads', '/dashboard/communications', '/dashboard/calendar',
      '/dashboard/team', '/dashboard/business-profile', '/dashboard/settings', '/dashboard/integrations',
    ];
    responseInventory.forEach(entry => {
      if (!entry.body) return;
      WITHHELD.forEach(value => assert.ok(!entry.body.includes(value), `withheld response bytes in ${entry.pathname}: ${value}`));
      broadEmployeePaths.forEach(value => assert.ok(!entry.body.includes(value), `broad response bytes in ${entry.pathname}: ${value}`));
      if (entry.pathname === '/dashboard/today' || entry.pathname === '/js/today-shell.js') {
        const lower = entry.body.toLowerCase();
        ['subscription', 'onboarding', 'organization', 'email', 'phone'].forEach(value => {
          assert.ok(!lower.includes(value), `private bootstrap field in ${entry.pathname}: ${value}`);
        });
      }
    });
    const firstDisclosure = page.locator('.today-disclosure summary').first();
    if (mobile) await firstDisclosure.tap(); else { await firstDisclosure.focus(); await page.keyboard.press('Enter'); }
    assert.strictEqual(await firstDisclosure.evaluate(node => node.parentElement.open), true);
    await capture('employee-primary', 'ready', 'active employee', 'direct-and-current-crew');
    const routeDisclosure = page.locator('.today-work-card').first().locator('.today-disclosure summary').nth(1);
    if (mobile) await routeDisclosure.tap(); else { await routeDisclosure.focus(); await page.keyboard.press('Enter'); }
    await capture('dispatched-route-and-instructions', 'ready', 'active employee', 'direct-dispatched');
    const crewDisclosure = page.locator('.today-work-card').nth(1).locator('.today-disclosure summary').last();
    if (mobile) await crewDisclosure.tap(); else { await crewDisclosure.focus(); await page.keyboard.press('Enter'); }
    await capture('current-active-crew', 'ready', 'active employee and current crew', 'crew-scheduled-not-dispatched');

    for (const scale of ['200%', '400%']) {
      await page.evaluate(value => { document.documentElement.style.fontSize = value; }, scale);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.evaluate(() => ({
        documentClient: document.documentElement.clientWidth, documentScroll: document.documentElement.scrollWidth,
        cards: Array.from(document.querySelectorAll('.today-work-card')).map(card => ({ client: card.clientWidth, scroll: card.scrollWidth, right: card.getBoundingClientRect().right })),
      }));
      assert.ok(geometry.documentScroll <= geometry.documentClient + 2, `${scale} document reflow ${JSON.stringify(geometry)}`);
      geometry.cards.forEach(card => { assert.ok(card.scroll <= card.client + 2); assert.ok(card.right <= geometry.documentClient + 2); });
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    const responsiveWidths = mobile ? [320, 375, 390] : [768, 1024, 1280];
    for (const width of responsiveWidths) {
      await page.setViewportSize({ width, height: viewport.height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const layout = await page.evaluate(() => ({
        documentClient: document.documentElement.clientWidth,
        documentScroll: document.documentElement.scrollWidth,
        visible: ['#todayMain', '.today-main', '.today-scope-note', '#todayRefresh', '.demo-dashboard-footer']
          .flatMap(selector => Array.from(document.querySelectorAll(selector)))
          .filter(node => getComputedStyle(node).display !== 'none')
          .map(node => ({ selector: node.id || node.className, rect: node.getBoundingClientRect().toJSON() })),
      }));
      assert.ok(layout.documentScroll <= layout.documentClient + 2, `${width}px document reflow ${JSON.stringify(layout)}`);
      layout.visible.forEach(node => {
        assert.ok(node.rect.left >= -2 && node.rect.right <= layout.documentClient + 2,
          `${width}px clipped ${JSON.stringify(node)}`);
      });
    }
    await page.setViewportSize(viewport);
    const refreshDiagnostic = await page.evaluate(() => {
      const node = document.getElementById('todayRefresh');
      return node ? { html: node.outerHTML, display: getComputedStyle(node).display, hidden: node.hidden,
        rect: node.getBoundingClientRect().toJSON() } : null;
    });
    assert.ok(refreshDiagnostic && refreshDiagnostic.display !== 'none' && refreshDiagnostic.rect.width >= 44 && refreshDiagnostic.rect.height >= 44,
      JSON.stringify(refreshDiagnostic));
    await page.locator('#todayRefresh').evaluate(node => node.focus());
    assert.strictEqual(await page.evaluate(() => document.activeElement === document.getElementById('todayRefresh')), true);

    logoutContext = await browser.newContext({ viewport, colorScheme: dark ? 'dark' : 'light', timezoneId: 'America/Los_Angeles',
      hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1, serviceWorkers: 'block' });
    await logoutContext.addCookies(cookies(logoutEmployee, origin));
    await logoutContext.addInitScript(installSessionMetadata, `employee-logout-${matrix}`);
    const logoutExternal = [];
    await logoutContext.route('**/*', async route => {
      const target = new URL(route.request().url());
      if (target.origin !== origin) { logoutExternal.push(target.href); await route.abort(); return; }
      await route.continue();
    });
    const logoutPage = await logoutContext.newPage();
    const logoutNetwork = [];
    logoutPage.on('request', requestValue => {
      const target = new URL(requestValue.url());
      if (target.origin === origin) logoutNetwork.push({ method: requestValue.method(), pathname: target.pathname });
    });
    await logoutPage.goto(origin + '/dashboard/today', { waitUntil: 'domcontentloaded' });
    await logoutPage.waitForFunction(() => document.body.dataset.todayState === 'ready');
    assert.strictEqual(await logoutPage.locator('.today-work-card').count(), 3);
    if (mobile) await logoutPage.locator('#todayMenuToggle').click();
    const logoutControl = mobile
      ? logoutPage.locator('#todayMobileMenu [data-today-logout]')
      : logoutPage.locator('.sidebar [data-today-logout]');
    const [logoutResult] = await Promise.all([
      logoutPage.waitForResponse(value => new URL(value.url()).pathname === '/api/auth/logout'),
      logoutControl.click(),
    ]);
    assert.strictEqual(logoutResult.status(), 200);
    await logoutPage.waitForURL(value => new URL(value).pathname === '/login');
    assert.strictEqual(logoutExternal.length, 0);
    assert.strictEqual(logoutNetwork.some(entry => entry.pathname === '/api/auth/me'), false);
    assert.strictEqual(logoutNetwork.some(entry => entry.method === 'POST' && entry.pathname === '/api/auth/logout'), true);
    assert.strictEqual((await pool.query('SELECT status FROM auth_sessions WHERE id=$1', [logoutEmployee.sessionId])).rows[0].status, 'revoked');
    assert.strictEqual(await logoutPage.locator('.today-work-card').count(), 0);
    const logoutPageContent = await logoutPage.content();
    WITHHELD.forEach(value => assert.ok(!logoutPageContent.includes(value), `cached logout page bytes: ${value}`));
    await logoutContext.close();
    logoutContext = null;

    let releaseLoading;
    const loadingGate = new Promise(resolve => { releaseLoading = resolve; });
    await page.route('**/api/v1/today', async route => { await loadingGate; await route.continue(); }, { times: 1 });
    const loadingNavigation = page.reload({ waitUntil: 'domcontentloaded' });
    await waitState('loading');
    await capture('loading', 'loading', 'active employee', 'pending-authoritative-read',
      'synthetic transport timing only: Playwright delays one real /api/v1/today request before continuing it; no durable authority claim');
    releaseLoading();
    await loadingNavigation;
    await waitState('ready');

    await page.route('**/api/v1/today', route => route.abort('internetdisconnected'), { times: 1 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitState('error');
    await capture('network-error', 'error', 'active employee', 'no-returned-records',
      'synthetic transport only: Playwright route.abort("internetdisconnected") for one /api/v1/today request; no durable authority claim');
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await waitState('ready');

    await context.setOffline(true);
    await page.locator('#todayRefresh').click();
    await waitState('offline');
    await capture('offline', 'offline', 'active employee', 'no-returned-records',
      'synthetic transport only: Playwright context.setOffline(true) for this browser context; no durable authority claim');
    await context.setOffline(false);
    // The real page listens for the online event and reloads automatically.
    await waitState('ready');

    await page.route('**/api/v1/today', route => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'M22_TODAY_STALE_RETRY', message: 'Reload.' } }),
    }), { times: 1 });
    await page.locator('#todayRefresh').click();
    await waitState('stale');
    await capture('stale-reload', 'stale', 'active employee', 'no-returned-records',
      'synthetic response only: Playwright route.fulfill injects one typed HTTP 409 stale response; no durable authority claim');
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await waitState('ready');

    await pool.query('DELETE FROM workforce_crew_members WHERE organization_id=$1 AND crew_id=$2 AND profile_id=$3', [ORGANIZATION_ID, CREW_ID, EMPLOYEE_ID]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitState('ready');
    assert.strictEqual(await page.locator('.today-work-card').count(), 2);
    assert.strictEqual((await page.locator('body').innerText()).includes('Current crew'), false);
    await capture('crew-membership-removed', 'ready', 'active employee removed from crew', 'direct-only');
    await pool.query(
      `INSERT INTO workforce_crew_members(organization_id,crew_id,profile_id,crew_role,created_by_user_id)
       VALUES ($1,$2,$3,'lead',$4)`, [ORGANIZATION_ID, CREW_ID, EMPLOYEE_ID, TEAMMATE_ID]
    );

    await pool.query("UPDATE auth_sessions SET status='revoked',revoked_at=NOW(),revoke_reason='part6_browser' WHERE id=$1", [employee.sessionId]);
    await page.locator('#todayRefresh').click();
    await waitState('restricted');
    assert.strictEqual(await page.locator('.today-work-card').count(), 0);
    await capture('session-revoked', 'restricted', 'revoked employee session', 'none',
      'real durable PostgreSQL auth session revocation; no synthetic transport or response');
    await pool.query("UPDATE auth_sessions SET status='active',revoked_at=NULL,revoke_reason=NULL WHERE id=$1", [employee.sessionId]);
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await waitState('ready');

    await approve(app, pool, owner, appointmentIds[0], 'unassign', { target: { kind: 'unassigned', id: null } });
    await approve(app, pool, owner, appointmentIds[2], 'unassign', { target: { kind: 'unassigned', id: null } });
    await pool.query('DELETE FROM workforce_crew_members WHERE organization_id=$1 AND crew_id=$2 AND profile_id=$3',
      [ORGANIZATION_ID, CREW_ID, EMPLOYEE_ID]);
    await page.locator('#todayRefresh').click();
    await waitState('empty');
    assert.strictEqual(await page.locator('.today-work-card').count(), 0);
    await capture('employee-no-work-unassigned', 'empty', 'active employee', 'unassigned-and-not-current-crew');

    ownerContext = await browser.newContext({ viewport, colorScheme: dark ? 'dark' : 'light', timezoneId: fixturePlan.timeZone,
      hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1, serviceWorkers: 'block' });
    await ownerContext.addCookies(cookies(owner, origin));
    await ownerContext.addInitScript(installSessionMetadata, `owner-${matrix}`);
    await ownerContext.route('**/*', async route => {
      const target = new URL(route.request().url());
      if (target.origin !== origin) { external.push({ method: route.request().method(), url: target.href }); await route.abort(); return; }
      await route.continue();
    });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(origin + '/dashboard/today', { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForFunction(() => document.body.dataset.todayState === 'empty');
    if (evidenceRoot) {
      const filename = path.join(evidenceRoot, `${matrix}-no-work-empty.png`);
      await ownerPage.screenshot({ path: filename, fullPage: true });
      screenshots.push({ filename: path.basename(filename), browser: selected,
        engineLabel: selected === 'webkit' ? 'Playwright WebKit (not physical Safari)' : 'Installed Google Chrome',
        version, viewport, theme: dark ? 'dark' : 'light', realRoleIdentity: 'active owner with no personal assignment',
        assignmentMode: 'none', state: 'empty', testedRevision, testedTree,
        fixtureTenant: 'isolated disposable Part 6 Browser Tenant', fixtureTenantTimeZone: fixturePlan.timeZone,
        fixtureReferenceInstant: fixturePlan.referenceInstant,
        sessionProvenance: 'mounted real PostgreSQL owner cookie session; nonsecret test identity',
        stateProvenance: 'real mounted PostgreSQL authority and transport; no synthetic state injection',
        expectedVisible: ['personal empty Today', 'read-only state'],
        expectedWithheld: ['all private work records; none returned', 'employee records', 'financials', 'Mission 23 controls'],
        withheldCategories: ['all private work records; none returned', 'employee records', 'financials', 'Mission 23 controls'],
        sourceRoute: '/dashboard/today', timestamp: new Date().toISOString() });
    }
    const commandResponse = ownerPage.waitForResponse(value => value.url().includes('/api/v1/command-center/workspace'));
    await ownerPage.goto(origin + '/dashboard', { waitUntil: 'domcontentloaded' });
    assert.strictEqual((await commandResponse).status(), 200);
    await ownerPage.getByRole('heading', { name: 'One operating view for the day ahead.' }).waitFor();
    if (evidenceRoot) {
      const filename = path.join(evidenceRoot, `${matrix}-command-center-reference.png`);
      await ownerPage.screenshot({ path: filename, fullPage: true });
      screenshots.push({ filename: path.basename(filename), browser: selected,
        engineLabel: selected === 'webkit' ? 'Playwright WebKit (not physical Safari)' : 'Installed Google Chrome',
        version, viewport, theme: dark ? 'dark' : 'light', realRoleIdentity: 'active owner reference only',
        assignmentMode: 'broad-reference-not-Today', state: 'ready', testedRevision, testedTree,
        fixtureTenant: 'isolated disposable Part 6 Browser Tenant', fixtureTenantTimeZone: fixturePlan.timeZone,
        fixtureReferenceInstant: fixturePlan.referenceInstant,
        sessionProvenance: 'mounted real PostgreSQL owner cookie session; nonsecret test identity',
        stateProvenance: 'real mounted PostgreSQL owner reference; not an employee Today authority claim',
        expectedVisible: ['Command Center design reference'],
        expectedWithheld: ['not an employee Today authority claim'], withheldCategories: ['not an employee Today authority claim'],
        sourceRoute: '/dashboard', timestamp: new Date().toISOString() });
    }

    await Promise.all(responseCaptureTasks);
    assert.strictEqual(responseInventory.length, sameOriginResponseEvents, 'every same-origin employee response event must be inventoried');
    network.forEach(entry => assert.ok(allowedEmployeePaths.has(entry.pathname), `unapproved employee network destination: ${JSON.stringify(entry)}`));
    responseInventory.forEach(entry => {
      if (!entry.body) return;
      WITHHELD.forEach(value => assert.ok(!entry.body.includes(value), `withheld response bytes in ${entry.pathname}: ${value}`));
      broadEmployeePaths.forEach(value => assert.ok(!entry.body.includes(value), `broad response bytes in ${entry.pathname}: ${value}`));
    });
    assert.strictEqual(external.length, 0, `provider/external calls: ${JSON.stringify(external)}`);
    const workerMutationNetwork = network.filter(entry => entry.method !== 'GET' && new URL(entry.url).pathname !== '/api/telemetry');
    assert.strictEqual(workerMutationNetwork.length, 0, `browser worker mutation network: ${JSON.stringify(network)}`);
    assert.strictEqual(browserErrors.length, 0, `browser errors: ${JSON.stringify(browserErrors)}`);
    responseBodies.forEach(body => WITHHELD.forEach(value => assert.ok(!JSON.stringify(body).includes(value), value)));
    if (evidenceRoot) {
      for (const entry of screenshots) entry.sha256 = sha256File(path.join(evidenceRoot, entry.filename));
      const manifest = {
        matrix, engineLabel: selected === 'webkit' ? 'Playwright WebKit (not physical Safari)' : 'Installed Google Chrome',
        browserVersion: version, viewport, theme: dark ? 'dark' : 'light', testedRevision, testedTree,
        realAuthority: 'disposable PostgreSQL cookie session',
        fixtureTenant: 'Part 6 Browser Tenant (isolated disposable test database)', fixtureTenantTimeZone: fixturePlan.timeZone,
        fixtureReferenceInstant: fixturePlan.referenceInstant, expectedVisible: [
          'job title and type', 'tenant-timezone schedule', 'direct or current-crew assignment', 'dispatch truth',
          'provider-neutral unavailable route uncertainty', 'operational instructions', 'minimum customer and current crew context',
        ], withheldCategories: ['financials and prices', 'billing and subscription settings', 'broad customer history',
          'other workers schedules', 'owner-only Polaris cost intelligence', 'Mission 23 execution controls', 'provider credentials and live calls'],
        screenshots,
      };
      fs.writeFileSync(path.join(evidenceRoot, `${matrix}-manifest.json`), JSON.stringify(manifest, null, 2) + '\n');
    }
    console.log(JSON.stringify({ matrix, version, viewport, fixtureTenantTimeZone: fixturePlan.timeZone,
      fixtureReferenceInstant: fixturePlan.referenceInstant, screenshots: screenshots.length, todayResponses: responseBodies.length,
      employeeNetworkDestinations: [...new Set(network.map(entry => entry.pathname))].sort(), employeeResponseInventory: responseInventory.length,
      externalCalls: external.length, workerMutationNetwork: workerMutationNetwork.length, browserErrors }));
  } finally {
    if (logoutContext) await logoutContext.close().catch(() => {});
    if (ownerContext) await ownerContext.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await closeServer(server).catch(() => {});
    if (db) await db.close().catch(() => {});
    await suiteDatabase.cleanup().catch(() => {});
    await dropRoles(roles).catch(() => {});
    if (path.resolve(dataRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(dataRoot, { recursive: true, force: true });
    environment.forEach(key => { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; });
  }
}

main().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
