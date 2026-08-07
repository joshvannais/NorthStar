'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ORG_A = '71000000-0000-4000-8000-000000000001';
const ORG_B = '71000000-0000-4000-8000-000000000002';
const OWNER_A = '72000000-0000-4000-8000-000000000001';
const ADMIN_A = '72000000-0000-4000-8000-000000000002';
const VIEWER_A = '72000000-0000-4000-8000-000000000003';
const OWNER_B = '72000000-0000-4000-8000-000000000004';
const RAW_VIEWER = '  Viewer <img src=x onerror=window.__workforceXss++> Café 🧰  ';
const RAW_SKILL = '  Emergency <Skill> ☃ é  ';
const RAW_SKILL_DESCRIPTION = '\n  <script>window.__workforceXss++</script> exact bytes.  \n';
const RAW_ADMIN_DESCRIPTION = '  Admin update </textarea><svg onload=window.__workforceXss++> 🌌  ';
const RAW_CREW = '  North <Crew> 🧰  ';
const RAW_POLICY = '  Safety <Policy> ☃  ';
const RAW_POLICY_DESCRIPTION = '\n  Policy <img src=x onerror=window.__workforceXss++> é  \n';
const RAW_INVITEE = '  Tech <img src=x onerror=window.__workforceXss++> 🧰  ';
const RAW_PHONE = ' +1 (555) 010-7878 ';

function profileFor(name, officeId) {
  const profile = canonicalFenceProfile({ companyName: name });
  profile.headquarters = {
    street: '', city: '', state: '', zip: '', country: 'US', latitude: null, longitude: null,
    additionalOffices: [{
      id: officeId,
      name: officeId === 'office-north' ? '  North <Office> 🧰  ' : 'Other tenant office',
      street: '', city: '', state: '', zip: '', country: 'US', latitude: null, longitude: null,
    }],
  };
  profile.workforce = { policies: [] };
  return profile;
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

async function contextFor(browser, origin, session, viewport, theme, ledger, role) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(selectedTheme => {
    window.__workforceXss = 0;
    localStorage.setItem('northstar-theme', selectedTheme);
  }, theme);
  if (session) {
    await context.addCookies([
      { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
      { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
    ]);
  }
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    ledger.external.push({ role, method: route.request().method(), url: route.request().url() });
    return route.fulfill({ status: 204, body: '' });
  });
  context.on('request', request => {
    const url = new URL(request.url());
    ledger.requests.push({
      role,
      method: request.method(),
      path: url.pathname,
      origin: url.origin,
      authorization: request.headers().authorization || null,
    });
  });
  return context;
}

function attachPage(page, ledger, role) {
  page.on('pageerror', error => ledger.pageErrors.push(role + ': ' + (error.stack || error.message)));
  page.on('console', message => {
    if (message.type() === 'error') ledger.consoleErrors.push(role + ': ' + message.text());
  });
}

async function waitReady(page) {
  await page.waitForFunction(() =>
    document.documentElement.getAttribute('data-workforce-state') === 'ready' &&
    document.documentElement.getAttribute('data-northstar-navigation') === 'ready',
  null, { timeout: 15000 });
}

async function mountedSnapshot(page) {
  return page.evaluate(() => ({
    state: document.documentElement.getAttribute('data-workforce-state'),
    navigation: document.documentElement.getAttribute('data-northstar-navigation'),
    theme: document.documentElement.getAttribute('data-theme'),
    xss: window.__workforceXss,
    injectedImages: document.querySelectorAll('#workforceShell img').length,
    injectedScripts: Array.from(document.querySelectorAll('#workforceShell script')).length,
    memberNames: Array.from(document.querySelectorAll('#membersList h3')).map(node => node.textContent),
    skillNames: Array.from(document.querySelectorAll('#skillsList input')).map(node => node.value),
    crewNames: Array.from(document.querySelectorAll('#crewsList input[id^="crew-name-"]')).map(node => node.value),
    policyNames: Array.from(document.querySelectorAll('#policiesList .policy-name')).map(node => node.value),
    inviteHidden: document.getElementById('invitePanel').hidden,
    skillFormHidden: document.getElementById('skillForm').hidden,
    crewFormHidden: document.getElementById('crewForm').hidden,
    policyActionsHidden: document.getElementById('policyActions').hidden,
    enabledStructureControls: Array.from(document.querySelectorAll('#membersList select,#membersList input,#skillsList input,#skillsList textarea,#skillsList select,#crewsList input,#crewsList select,#policiesList input,#policiesList textarea'))
      .filter(control => !control.disabled).length,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    duplicateIds: Array.from(document.querySelectorAll('[id]')).map(node => node.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index),
    mainLabelled: Boolean(document.getElementById('mainContent')),
    activeTeamLinks: document.querySelectorAll('[data-nav-id="team"][aria-current="page"]').length,
  }));
}

function assertSafeSnapshot(snapshot, role, theme) {
  assert.strictEqual(snapshot.state, 'ready', role + ' mounted workforce ready');
  assert.strictEqual(snapshot.navigation, 'ready', role + ' mounted navigation ready');
  assert.strictEqual(snapshot.theme, theme, role + ' theme retained');
  assert.strictEqual(snapshot.xss, 0, role + ' persisted payload executes zero times');
  assert.strictEqual(snapshot.injectedImages, 0, role + ' persisted payload creates no image nodes');
  assert.strictEqual(snapshot.injectedScripts, 0, role + ' persisted payload creates no script nodes');
  assert.deepStrictEqual(snapshot.duplicateIds, [], role + ' has no duplicate ids');
  assert.strictEqual(snapshot.mainLabelled, true, role + ' has a main-content target');
  assert.strictEqual(snapshot.activeTeamLinks, 2, role + ' has canonical desktop/mobile active links');
  assert.ok(snapshot.scrollWidth - snapshot.clientWidth <= 1, role + ' has no horizontal overflow');
  assert.ok(snapshot.memberNames.includes(RAW_VIEWER), role + ' preserves raw viewer name in text');
  assert.ok(snapshot.memberNames.includes(RAW_INVITEE), role + ' preserves raw invitee name in text');
  assert.ok(snapshot.skillNames.includes(RAW_SKILL), role + ' preserves raw skill name in value');
  assert.ok(snapshot.crewNames.includes(RAW_CREW), role + ' preserves raw crew name in value');
  assert.ok(snapshot.policyNames.includes(RAW_POLICY), role + ' preserves raw policy name in value');
  if (role.startsWith('owner')) {
    assert.strictEqual(snapshot.inviteHidden, false);
    assert.strictEqual(snapshot.skillFormHidden, false);
    assert.strictEqual(snapshot.crewFormHidden, false);
    assert.strictEqual(snapshot.policyActionsHidden, false);
    assert.ok(snapshot.enabledStructureControls > 0);
  } else if (role.startsWith('admin')) {
    assert.strictEqual(snapshot.inviteHidden, true);
    assert.strictEqual(snapshot.skillFormHidden, false);
    assert.strictEqual(snapshot.crewFormHidden, false);
    assert.strictEqual(snapshot.policyActionsHidden, false);
    assert.ok(snapshot.enabledStructureControls > 0);
  } else {
    assert.strictEqual(snapshot.inviteHidden, true);
    assert.strictEqual(snapshot.skillFormHidden, true);
    assert.strictEqual(snapshot.crewFormHidden, true);
    assert.strictEqual(snapshot.policyActionsHidden, true);
    assert.strictEqual(snapshot.enabledStructureControls, 0);
  }
}

async function lifecycle(browser, origin, session, viewport, theme, ledger, role) {
  const context = await contextFor(browser, origin, session, viewport, theme, ledger, role);
  const page = await context.newPage();
  attachPage(page, ledger, role);
  await page.goto(origin + '/dashboard/team', { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  assertSafeSnapshot(await mountedSnapshot(page), role + '-initial', theme);
  await page.evaluate(() => window.NorthStarWorkforce.reload());
  await waitReady(page);
  assertSafeSnapshot(await mountedSnapshot(page), role + '-rerender', theme);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitReady(page);
  assertSafeSnapshot(await mountedSnapshot(page), role + '-reload', theme);
  if (viewport.width <= 500) {
    await page.locator('#navHamburgerBtn').focus();
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'navHamburgerBtn', role + ' hamburger focus');
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.locator('#mobileMenu').evaluate(node => node.classList.contains('open')), true);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('#mobileMenu').evaluate(node => node.classList.contains('open')), false);
  } else {
    const first = role.startsWith('viewer')
      ? page.locator('.sidebar-nav a').first()
      : page.locator('#membersList select').first();
    await first.focus();
    assert.strictEqual(await first.evaluate(node => document.activeElement === node), true, role + ' structure control focus');
  }
  return { context, page };
}

async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  const { browserType, executablePath } = resolveBrowserRuntime(selected);
  const original = new Map();
  for (const name of [
    'DATABASE_URL', 'AUTH_ACCESS_SECRET', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
    'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  ]) original.set(name, process.env[name]);
  const suiteDatabase = await createSuiteDatabase('m20-2e-' + selected);
  let db;
  let server;
  let browser;
  const ledger = { requests: [], external: [], consoleErrors: [], pageErrors: [] };
  const capture = { messages: [] };
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    ]) delete process.env[name];

    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL must initialize');
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1,'M20 Workforce A','m20-workforce-a@example.test'),
        ($2,'M20 Workforce B','m20-workforce-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, name, role] of [
      [OWNER_A, ORG_A, 'Owner A', 'owner'],
      [ADMIN_A, ORG_A, 'Admin A', 'admin'],
      [VIEWER_A, ORG_A, RAW_VIEWER, 'viewer'],
      [OWNER_B, ORG_B, 'Owner B', 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, name, userId + '@m20-workforce.test', role]
      );
    }
    const { putBusinessProfile, getActiveBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, profile: profileFor('Workforce A', 'office-north'),
    });
    const otherProfile = await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B, profile: profileFor('Workforce B', 'office-other'),
    });
    const ownerSession = await provisionDurableSession(pool, { userId: OWNER_A, organizationId: ORG_A, role: 'owner' });
    const adminSession = await provisionDurableSession(pool, { userId: ADMIN_A, organizationId: ORG_A, role: 'admin' });
    const viewerSession = await provisionDurableSession(pool, { userId: VIEWER_A, organizationId: ORG_A, role: 'viewer' });
    await provisionDurableSession(pool, { userId: OWNER_B, organizationId: ORG_B, role: 'owner' });

    const { AccountRepository } = require('../../src/accounts/repository');
    const { WorkforceRepository } = require('../../src/workforce/repository');
    const { WorkforceService } = require('../../src/workforce/service');
    const workforceService = new WorkforceService(new WorkforceRepository(pool), {
      accountRepository: new AccountRepository(pool),
      transactionalEmail: {
        async invitation(recipient, rawToken, context, invite) {
          capture.messages.push({ recipient, rawToken, context, invite });
          return { delivered: true };
        },
      },
    });
    const { app } = require('../../src/server');
    app.locals.workforceService = workforceService;
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await browserType.launch({ headless: true, executablePath });

    const ownerContext = await contextFor(
      browser, origin, ownerSession, { width: 1280, height: 900 }, 'light', ledger, 'owner-desktop'
    );
    const ownerPage = await ownerContext.newPage();
    attachPage(ownerPage, ledger, 'owner-desktop');
    await ownerPage.goto(origin + '/dashboard/team', { waitUntil: 'domcontentloaded' });
    await waitReady(ownerPage);
    assert.ok((await mountedSnapshot(ownerPage)).memberNames.includes(RAW_VIEWER));

    await ownerPage.fill('#skillKey', 'exact-skill');
    await ownerPage.fill('#skillName', RAW_SKILL);
    await ownerPage.fill('#skillDescription', RAW_SKILL_DESCRIPTION);
    await ownerPage.selectOption('#skillService', 'fence');
    const skillResponse = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/workforce/skills' && response.request().method() === 'POST'
    );
    await ownerPage.click('#skillForm button[type="submit"]');
    assert.strictEqual((await skillResponse).status(), 201, 'owner creates skill');
    await ownerPage.waitForFunction(name =>
      Array.from(document.querySelectorAll('#skillsList input')).some(input => input.value === name), RAW_SKILL);

    await ownerPage.fill('#crewKey', 'field-crew');
    await ownerPage.fill('#crewName', RAW_CREW);
    await ownerPage.selectOption('#crewLocation', 'office-north');
    const crewCreate = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/workforce/crews' && response.request().method() === 'POST'
    );
    await ownerPage.click('#crewForm button[type="submit"]');
    assert.strictEqual((await crewCreate).status(), 201, 'owner creates crew');
    const crewCard = ownerPage.locator('#crewsList .wf-card').filter({ hasText: 'Key field-crew' });
    await crewCard.waitFor();
    const profiles = await pool.query(
      `SELECT membership.user_id, profile.id FROM workforce_profiles profile
        JOIN organization_memberships membership
          ON membership.organization_id = profile.organization_id AND membership.id = profile.membership_id
       WHERE profile.organization_id = $1`,
      [ORG_A]
    );
    const profileByUser = new Map(profiles.rows.map(row => [row.user_id, row.id]));
    await crewCard.locator('input[type="checkbox"][value="' + profileByUser.get(ADMIN_A) + '"]').check();
    await crewCard.locator('input[type="checkbox"][value="' + profileByUser.get(VIEWER_A) + '"]').check();
    await crewCard.locator('input[type="radio"][value="' + profileByUser.get(ADMIN_A) + '"]').check();
    const crewUpdate = ownerPage.waitForResponse(response =>
      response.url().startsWith(origin + '/api/workforce/crews/') && response.request().method() === 'PUT'
    );
    await crewCard.getByRole('button', { name: 'Save crew' }).click();
    assert.strictEqual((await crewUpdate).status(), 200, 'owner saves crew membership');

    await ownerPage.click('#addPolicy');
    const policyCard = ownerPage.locator('#policiesList .wf-card').last();
    await policyCard.locator('.policy-name').fill(RAW_POLICY);
    await policyCard.locator('.policy-description').fill(RAW_POLICY_DESCRIPTION);
    const policySave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/workforce' && response.request().method() === 'PUT'
    );
    await ownerPage.click('#savePolicies');
    assert.strictEqual((await policySave).status(), 200, 'owner saves versioned workforce policy');

    await ownerPage.fill('#inviteName', RAW_INVITEE);
    await ownerPage.fill('#inviteEmail', 'browser-tech@example.test');
    await ownerPage.fill('#invitePhone', RAW_PHONE);
    await ownerPage.selectOption('#inviteAccessRole', 'member');
    await ownerPage.selectOption('#inviteOperationalRole', 'technician');
    await ownerPage.selectOption('#inviteLocation', 'office-north');
    await ownerPage.locator('#inviteSkills label', { hasText: RAW_SKILL }).locator('input').check();
    const inviteResponse = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/workforce/invitations' && response.request().method() === 'POST'
    );
    await ownerPage.click('#inviteForm button[type="submit"]');
    assert.strictEqual((await inviteResponse).status(), 202, 'owner invites individual account');
    assert.strictEqual(capture.messages.length, 1, 'one intercepted transactional delivery');
    await ownerPage.waitForFunction(name =>
      Array.from(document.querySelectorAll('#membersList h3')).some(node => node.textContent === name), RAW_INVITEE);

    const acceptanceContext = await contextFor(
      browser, origin, null, { width: 390, height: 844 }, 'dark', ledger, 'invitee-mobile'
    );
    const acceptancePage = await acceptanceContext.newPage();
    attachPage(acceptancePage, ledger, 'invitee-mobile');
    await acceptancePage.goto(origin + '/accept-invitation?token=' + capture.messages[0].rawToken, { waitUntil: 'domcontentloaded' });
    assert.strictEqual(acceptancePage.url(), origin + '/accept-invitation', 'invitation token is stripped from URL');
    await acceptancePage.fill('#password', 'Private-browser-workforce-1!');
    await acceptancePage.fill('#confirmPassword', 'Private-browser-workforce-1!');
    const acceptanceResponse = acceptancePage.waitForResponse(response =>
      response.url() === origin + '/api/workforce/invitations/accept' && response.request().method() === 'POST'
    );
    await acceptancePage.click('#invitationForm button[type="submit"]');
    assert.strictEqual((await acceptanceResponse).status(), 200, 'invitee activates individual account');
    await acceptancePage.waitForFunction(() => document.getElementById('invitationForm').hidden);
    assert.strictEqual(await acceptancePage.locator('#invitationStatus').textContent(),
      'Invitation accepted. Sign in with your new password.');
    assert.strictEqual(await acceptancePage.evaluate(() => window.__workforceXss), 0);
    assert.ok((await acceptancePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
    await acceptanceContext.close();

    await ownerPage.evaluate(() => window.NorthStarWorkforce.reload());
    await waitReady(ownerPage);
    assertSafeSnapshot(await mountedSnapshot(ownerPage), 'owner-desktop-rerender', 'light');
    await ownerPage.reload({ waitUntil: 'domcontentloaded' });
    await waitReady(ownerPage);
    assertSafeSnapshot(await mountedSnapshot(ownerPage), 'owner-desktop-reload', 'light');
    await ownerContext.close();

    const adminContext = await contextFor(
      browser, origin, adminSession, { width: 1280, height: 900 }, 'dark', ledger, 'admin-desktop'
    );
    const adminPage = await adminContext.newPage();
    attachPage(adminPage, ledger, 'admin-desktop');
    await adminPage.goto(origin + '/dashboard/team', { waitUntil: 'domcontentloaded' });
    await waitReady(adminPage);
    assertSafeSnapshot(await mountedSnapshot(adminPage), 'admin-desktop-initial', 'dark');
    const skillCard = adminPage.locator('#skillsList .wf-card').filter({ hasText: 'Key exact-skill' });
    await skillCard.locator('textarea').fill(RAW_ADMIN_DESCRIPTION);
    const adminSave = adminPage.waitForResponse(response =>
      response.url().startsWith(origin + '/api/workforce/skills/') && response.request().method() === 'PUT'
    );
    await skillCard.getByRole('button', { name: 'Save skill' }).click();
    assert.strictEqual((await adminSave).status(), 200, 'admin saves permitted structure');
    await adminPage.evaluate(() => window.NorthStarWorkforce.reload());
    await waitReady(adminPage);
    assertSafeSnapshot(await mountedSnapshot(adminPage), 'admin-desktop-rerender', 'dark');
    await adminPage.reload({ waitUntil: 'domcontentloaded' });
    await waitReady(adminPage);
    assertSafeSnapshot(await mountedSnapshot(adminPage), 'admin-desktop-reload', 'dark');
    await adminContext.close();

    for (const run of [
      { role: 'owner-mobile', session: ownerSession, viewport: { width: 390, height: 844 }, theme: 'light' },
      { role: 'admin-mobile', session: adminSession, viewport: { width: 390, height: 844 }, theme: 'dark' },
      { role: 'viewer-desktop', session: viewerSession, viewport: { width: 1280, height: 900 }, theme: 'light' },
      { role: 'viewer-mobile', session: viewerSession, viewport: { width: 390, height: 844 }, theme: 'dark' },
    ]) {
      const mounted = await lifecycle(browser, origin, run.session, run.viewport, run.theme, ledger, run.role);
      await mounted.context.close();
    }

    const active = await getActiveBusinessProfile(pool, ORG_A);
    const raw = await pool.query(
      `SELECT
         encode(convert_to(account.name, 'UTF8'), 'hex') AS invitee_name_hex,
         encode(convert_to(account.phone, 'UTF8'), 'hex') AS invitee_phone_hex,
         encode(convert_to(skill.name, 'UTF8'), 'hex') AS skill_name_hex,
         encode(convert_to(skill.description, 'UTF8'), 'hex') AS skill_description_hex,
         encode(convert_to(crew.name, 'UTF8'), 'hex') AS crew_name_hex,
         encode(convert_to(profile.raw_profile #>> '{workforce,policies,0,name}', 'UTF8'), 'hex') AS policy_name_hex,
         encode(convert_to(profile.raw_profile #>> '{workforce,policies,0,description}', 'UTF8'), 'hex') AS policy_description_hex
       FROM users account
       JOIN workforce_skills skill ON skill.organization_id = account.organization_id AND skill.skill_key = 'exact-skill'
       JOIN workforce_crews crew ON crew.organization_id = account.organization_id AND crew.crew_key = 'field-crew'
       JOIN canonical_business_profiles profile ON profile.organization_id = account.organization_id AND profile.id = $2
       WHERE account.organization_id = $1 AND account.email = 'browser-tech@example.test'`,
      [ORG_A, active.id]
    );
    assert.deepStrictEqual(raw.rows, [{
      invitee_name_hex: Buffer.from(RAW_INVITEE, 'utf8').toString('hex'),
      invitee_phone_hex: Buffer.from(RAW_PHONE, 'utf8').toString('hex'),
      skill_name_hex: Buffer.from(RAW_SKILL, 'utf8').toString('hex'),
      skill_description_hex: Buffer.from(RAW_ADMIN_DESCRIPTION, 'utf8').toString('hex'),
      crew_name_hex: Buffer.from(RAW_CREW, 'utf8').toString('hex'),
      policy_name_hex: Buffer.from(RAW_POLICY, 'utf8').toString('hex'),
      policy_description_hex: Buffer.from(RAW_POLICY_DESCRIPTION, 'utf8').toString('hex'),
    }]);
    assert.strictEqual((await getActiveBusinessProfile(pool, ORG_B)).id, otherProfile.id, 'other tenant unchanged');
    assert.deepStrictEqual(ledger.external, [], 'external/provider requests are intercepted and unused');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'no unexpected console errors');
    assert.deepStrictEqual(ledger.pageErrors, [], 'no page errors');
    assert.ok(ledger.requests.every(entry => entry.authorization === null), 'browser sends no Authorization headers');
    const providerPattern = /retell|stripe|twilio|resend|googleapis|maps\.google|api\.openai/i;
    assert.strictEqual(ledger.requests.filter(entry => providerPattern.test(entry.origin)).length, 0, 'provider requests remain zero');

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      version: browser.version(),
      database: suiteDatabase.databaseName,
      roles: ['owner', 'admin', 'viewer'],
      viewports: ['desktop', 'mobile'],
      themes: ['light', 'dark'],
      lifecycle: ['initial', 'rerender', 'reload'],
      ownerWrites: ledger.requests.filter(entry => entry.role === 'owner-desktop' && ['POST', 'PUT', 'PATCH'].includes(entry.method)).length,
      adminWrites: ledger.requests.filter(entry => entry.role === 'admin-desktop' && ['POST', 'PUT', 'PATCH'].includes(entry.method)).length,
      viewerWrites: ledger.requests.filter(entry => entry.role.startsWith('viewer') && ['POST', 'PUT', 'PATCH'].includes(entry.method)).length,
      providerRequests: ledger.external.length,
      providerActions: 0,
      transactionalBoundary: 'intercepted in memory',
      rawPostgresBytes: 'exact',
      xssExecutions: 0,
      unexpectedConsoleErrors: ledger.consoleErrors.length,
      pageErrors: ledger.pageErrors.length,
      physicalSafari: false,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db && db.getPool()) await db.getPool().end();
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await suiteDatabase.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
