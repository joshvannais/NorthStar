'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ROOT = path.resolve(__dirname, '..', '..');
const ORG_A = '93000000-0000-4000-8000-000000000001';
const ORG_B = '93000000-0000-4000-8000-000000000002';
const OWNER_A = '94000000-0000-4000-8000-000000000001';
const ADMIN_A = '94000000-0000-4000-8000-000000000002';
const MEMBER_A = '94000000-0000-4000-8000-000000000003';
const VIEWER_A = '94000000-0000-4000-8000-000000000004';
const OWNER_B = '94000000-0000-4000-8000-000000000005';
const EMAIL_POISON = '"><img data-m20-notification-email src=/m20-notification-email onerror=window.__notificationXss++>';
const PHONE_POISON = '<svg onload=window.__notificationXss++>';
const LEGACY_LABEL = '  </span><img data-m20-legacy-notification src=x onerror=window.__notificationXss++>\r\nlegacy bytes  ';
const LEGACY_NOTIFICATIONS = Object.freeze({
  email: false,
  sms: true,
  push: true,
  dailyExecutiveBriefing: false,
  revenueAlerts: true,
  crewAlerts: false,
  criticalAlerts: true,
  legacyLabel: LEGACY_LABEL,
});
const NOTIFICATION_TOGGLE_NAMES = Object.freeze([
  'Email for new leads',
  'Email call summaries',
  'Email appointments',
  'SMS for new leads',
  'Urgent SMS alerts',
]);
const INITIAL = Object.freeze({
  emailEnabled: true,
  emailCallSummary: false,
  emailAppointment: true,
  smsEnabled: false,
  smsUrgent: true,
  emailAddress: EMAIL_POISON,
  smsNumber: PHONE_POISON,
});

function dataDigest() {
  const root = path.join(ROOT, 'data');
  const hash = crypto.createHash('sha256');
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
      .forEach(entry => {
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

function profileFor(name, notifications) {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({ companyName: name });
  profile.company = { ...profile.company, ...canonical.company, name };
  profile.services = canonical.services;
  profile.canonicalPricing = canonical.canonicalPricing;
  profile.canonicalCosts = canonical.canonicalCosts;
  profile.notifications = JSON.parse(JSON.stringify(notifications));
  return profile;
}

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
}

async function captureEvidence(page, browserLabel, category, filename) {
  const root = process.env.P4_CORRECTION_EVIDENCE_DIR;
  if (!root) return;
  const directory = path.join(root, category, browserLabel);
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, filename), fullPage: true });
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

async function contextFor(browser, origin, session, input, ledger) {
  const context = await browser.newContext({ viewport: input.viewport });
  await context.addInitScript(theme => {
    window.__notificationXss = 0;
    localStorage.setItem('northstar-theme', theme);
  }, input.theme);
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('**/*', route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === origin) return route.continue();
    if (/fonts\.googleapis|fonts\.gstatic/.test(requestUrl.hostname)) {
      return route.fulfill({
        status: 200,
        contentType: requestUrl.hostname.includes('googleapis') ? 'text/css' : 'font/woff2',
        body: '',
      });
    }
    const entry = { role: input.role, method: route.request().method(), url: route.request().url() };
    if (/retell|stripe|twilio|resend|openai|provider|jobber|googleapis/i.test(requestUrl.hostname)) {
      ledger.providers.push(entry);
    } else {
      ledger.external.push(entry);
    }
    return route.fulfill({ status: 204, body: '' });
  });
  context.on('request', browserRequest => {
    const requestUrl = new URL(browserRequest.url());
    ledger.requests.push({
      role: input.role,
      method: browserRequest.method(),
      origin: requestUrl.origin,
      path: requestUrl.pathname,
      authorization: browserRequest.headers().authorization || null,
    });
  });
  return context;
}

function attachPage(page, ledger, role) {
  page.on('pageerror', error => {
    const detail = error.stack || error.message;
    const expectedRedirectCancellation = role === 'owner-profile'
      && /^Fetch API cannot load http:\/\/127\.0\.0\.1:\d+\/api\/v1\/business-profile\/profileReadiness due to access control checks\./.test(detail);
    (expectedRedirectCancellation ? ledger.expectedPageErrors : ledger.pageErrors).push(role + ': ' + detail);
  });
  page.on('console', message => {
    if (message.type() === 'error') ledger.consoleErrors.push(role + ': ' + message.text());
  });
}

async function waitForSettings(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('notificationPreferencesAuthority');
    return root && root.dataset.state === 'ready';
  }, null, { timeout: 15000 });
}

async function settingsSnapshot(page) {
  return page.evaluate(() => {
    const ids = [
      'emailEnabled', 'emailCallSummary', 'emailAppointment',
      'smsEnabled', 'smsUrgent', 'emailAddress', 'smsNumber',
    ];
    const values = {};
    ids.forEach(id => {
      const element = document.getElementById(id);
      values[id] = element.type === 'checkbox' ? element.checked : element.value;
    });
    const mutable = Array.from(document.querySelectorAll('[data-settings-mutable]'));
    const root = document.getElementById('notificationPreferencesAuthority');
    return {
      state: root.dataset.state,
      authority: document.getElementById('notificationPreferencesAuthorityNote').textContent,
      access: document.getElementById('settingsAccessStatus').textContent,
      values,
      canonicalControlCount: ids.length,
      mutableCount: mutable.length,
      allMutableDisabled: mutable.every(element => element.disabled),
      saveDisabled: document.getElementById('saveSettingsBtn').disabled,
      securityMandatory: root.querySelector('[aria-label="Account-security email is mandatory"] input').checked,
      securityDisabled: root.querySelector('[aria-label="Account-security email is mandatory"] input').disabled,
      injectedNodes: root.querySelectorAll('[data-m20-notification-email],[data-m20-notification-phone],script,svg,img').length,
      xss: window.__notificationXss,
      theme: document.documentElement.getAttribute('data-theme'),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
}

function assertSettingsSnapshot(snapshot, input, lifecycle) {
  const label = `${input.role}/${input.viewportLabel}/${input.theme}/${lifecycle}`;
  assert.strictEqual(snapshot.state, 'ready', label + ': canonical preferences are ready');
  assert.match(snapshot.authority, /role-authorized workspace preferences/i, label + ': workspace authority is explicit without exposing an internal table name');
  assert.doesNotMatch(snapshot.authority, /notification_preferences|postgresql/i, label + ': internal storage details stay out of user-facing copy');
  assert.match(snapshot.access, input.canEdit ? /can edit/i : /read.only/i, label + ': role presentation is explicit');
  assert.deepStrictEqual(snapshot.values, INITIAL, label + ': all seven canonical values are exact');
  assert.strictEqual(snapshot.canonicalControlCount, 7, label + ': complete canonical field set');
  assert.ok(snapshot.mutableCount >= 7, label + ': mutable controls are identified');
  assert.strictEqual(snapshot.allMutableDisabled, !input.canEdit, label + ': role controls fail closed');
  assert.strictEqual(snapshot.saveDisabled, true, label + ': save remains disabled until a real dirty state');
  assert.strictEqual(snapshot.securityMandatory, true, label + ': security email remains mandatory');
  assert.strictEqual(snapshot.securityDisabled, true, label + ': security email remains separate and read only');
  assert.strictEqual(snapshot.injectedNodes, 0, label + ': persisted values create no DOM nodes');
  assert.strictEqual(snapshot.xss, 0, label + ': persisted values do not execute');
  assert.strictEqual(snapshot.theme, input.theme, label + ': requested theme is active');
  assert.strictEqual(snapshot.overflow, false, label + ': no horizontal overflow');
}

async function assertAccessibleNotificationControls(page, input, lifecycle) {
  const label = `${input.role}/${input.viewportLabel}/${input.theme}/${lifecycle}`;
  for (const name of NOTIFICATION_TOGGLE_NAMES) {
    assert.strictEqual(await page.getByRole('checkbox', { name, exact: true }).count(), 1,
      `${label}: ${name} has one exact accessible name`);
  }
}

async function exerciseCell(browser, browserLabel, origin, session, input, ledger) {
  const context = await contextFor(browser, origin, session, input, ledger);
  try {
    const page = await context.newPage();
    attachPage(page, ledger, input.role + '/' + input.viewportLabel + '/' + input.theme);
    const response = await page.goto(origin + '/dashboard/settings', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(response.status(), 200);
    await waitForSettings(page);
    assertSettingsSnapshot(await settingsSnapshot(page), input, 'initial');
    await assertAccessibleNotificationControls(page, input, 'initial');
    if (input.role === 'owner' && input.theme === 'light' && input.viewportLabel === 'desktop') {
      await captureEvidence(page, browserLabel, 'hostile-security', 'stored-hostile-notification-text-inert.png');
    }
    if (input.role === 'owner' && input.theme === 'light' && input.viewportLabel === 'mobile') {
      await captureEvidence(page, browserLabel, 'ordinary', 'settings-clean-responsive-390.png');
    }

    await page.evaluate(() => renderSettingsState());
    assertSettingsSnapshot(await settingsSnapshot(page), input, 'rerender');
    await assertAccessibleNotificationControls(page, input, 'rerender');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSettings(page);
    assertSettingsSnapshot(await settingsSnapshot(page), input, 'reload');
    await assertAccessibleNotificationControls(page, input, 'reload');

    const themeToggle = page.locator('[data-northstar-theme-toggle]');
    await themeToggle.focus();
    assert.strictEqual(await themeToggle.evaluate(node => document.activeElement === node), true,
      input.role + ': theme control receives keyboard focus');
    if (input.canEdit) {
      const toggle = page.locator('#emailCallSummary');
      await toggle.focus();
      const before = await toggle.isChecked();
      await page.keyboard.press('Space');
      await page.keyboard.press('Space');
      assert.strictEqual(await toggle.isChecked(), before, input.role + ': canonical toggle is keyboard operable');
    } else {
      await page.keyboard.press('Tab');
      assert.strictEqual(await page.evaluate(() => {
        const active = document.activeElement;
        return !(active && active.matches('[data-settings-mutable]'));
      }), true, input.role + ': disabled mutation controls stay out of keyboard order');
    }
  } finally {
    await context.close();
  }
}

async function exerciseOwnerMutation(browser, origin, session, pool, ledger) {
  const input = { role: 'owner-mutation', viewport: { width: 1280, height: 900 }, viewportLabel: 'desktop', theme: 'light' };
  const context = await contextFor(browser, origin, session, input, ledger);
  try {
    const page = await context.newPage();
    attachPage(page, ledger, input.role);
    await page.goto(origin + '/dashboard/settings', { waitUntil: 'domcontentloaded' });
    await waitForSettings(page);
    assert.strictEqual(await page.locator('#saveSettingsBtn').isDisabled(), true,
      'owner Save starts disabled while canonical settings are clean');
    await page.route(origin + '/api/account/preferences', async route => {
      if (route.request().method() === 'PUT') await new Promise(resolve => setTimeout(resolve, 150));
      await route.continue();
    });
    await page.locator('label.toggle:has(#emailEnabled)').click();
    assert.strictEqual(await page.locator('#saveSettingsBtn').isEnabled(), true,
      'a real durable preference edit enables Save');
    assert.strictEqual(await page.locator('#northstarStickySaveBar').isVisible(), true,
      'a real durable preference edit opens the shared unsaved state');
    await page.locator('label.toggle:has(#emailCallSummary)').click();
    await page.locator('label.toggle:has(#emailAppointment)').click();
    await page.locator('label.toggle:has(#smsEnabled)').click();
    await page.locator('label.toggle:has(#smsUrgent)').click();
    await page.fill('#emailAddress', 'owner.ui@example.test');
    await page.fill('#smsNumber', '+1 860 555 0123');
    const saved = page.waitForResponse(response =>
      response.url() === origin + '/api/account/preferences' && response.request().method() === 'PUT'
    );
    await page.locator('#saveSettingsBtn').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('saveSettingsBtn').textContent === 'Saving…');
    assert.strictEqual(await page.locator('#saveSettingsBtn').isDisabled(), true,
      'Save is disabled while the mounted write is pending');
    assert.strictEqual((await saved).status(), 200, 'owner keyboard save reaches mounted canonical route');
    await page.waitForFunction(() => document.getElementById('settingsDirtyStatus').dataset.state === 'clean');
    assert.strictEqual(await page.locator('#saveSettingsBtn').isDisabled(), true,
      'Save returns to disabled after durable success');
    assert.strictEqual(await page.locator('#northstarStickySaveBar').isHidden(), true,
      'durable success clears the shared unsaved state');
    await page.unroute(origin + '/api/account/preferences');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForSettings(page);
    const values = (await settingsSnapshot(page)).values;
    assert.deepStrictEqual(values, {
      emailEnabled: false,
      emailCallSummary: true,
      emailAppointment: false,
      smsEnabled: true,
      smsUrgent: false,
      emailAddress: 'owner.ui@example.test',
      smsNumber: '+1 860 555 0123',
    });
  } finally {
    await context.close();
  }

  const stored = await pool.query(
    `SELECT email_new_lead, email_call_summary, email_appointment, sms_new_lead, sms_urgent,
            notification_email, notification_phone
       FROM notification_preferences WHERE organization_id = $1`,
    [ORG_A]
  );
  assert.deepStrictEqual(stored.rows, [{
    email_new_lead: false,
    email_call_summary: true,
    email_appointment: false,
    sms_new_lead: true,
    sms_urgent: false,
    notification_email: 'owner.ui@example.test',
    notification_phone: '+1 860 555 0123',
  }], 'owner UI writes the exact tenant row');
}

async function exerciseContactPersistence(browser, browserLabel, origin, session, pool, ledger) {
  const input = { role: 'owner-contacts', viewport: { width: 1280, height: 900 }, viewportLabel: 'desktop', theme: 'light' };
  const serialContext = await contextFor(browser, origin, session, input, ledger);
  let winnerContext;
  let staleContext;
  try {
    const page = await serialContext.newPage();
    attachPage(page, ledger, input.role);
    await page.route(origin + '/api/account/preferences', async route => {
      if (route.request().method() === 'PUT') await new Promise(resolve => setTimeout(resolve, 200));
      await route.continue();
    });
    await page.goto(origin + '/dashboard/settings', { waitUntil: 'domcontentloaded' });
    await waitForSettings(page);
    await page.fill('#contactName', 'Serial Alpha');
    await page.fill('#contactPhone', '+1 860 555 0201');
    const firstWrite = page.waitForResponse(response =>
      response.url() === origin + '/api/account/preferences' && response.request().method() === 'PUT'
    );
    await page.click('#addContactBtn');
    assert.strictEqual(await page.locator('#contactName').isDisabled(), true,
      'contact draft controls are disabled while persistence is pending');
    assert.strictEqual(await page.evaluate(() => addContact()), false,
      'a concurrent contact mutation is rejected before a second request');
    assert.strictEqual((await firstWrite).status(), 200, 'first serialized contact write persists');
    await page.waitForFunction(() => document.getElementById('contactName').value === '');
    await page.unroute(origin + '/api/account/preferences');

    await page.fill('#contactName', 'Serial Beta');
    await page.fill('#contactPhone', '+1 860 555 0202');
    const secondWrite = page.waitForResponse(response =>
      response.url() === origin + '/api/account/preferences' && response.request().method() === 'PUT'
    );
    await page.click('#addContactBtn');
    assert.strictEqual((await secondWrite).status(), 200, 'second contact write starts only after the first completed');
    await page.waitForFunction(() => document.getElementById('contactName').value === '');
    let durable = await pool.query(
      "SELECT preferences->'contacts' AS contacts FROM organization_account_preferences WHERE organization_id = $1",
      [ORG_A]
    );
    assert.deepStrictEqual(durable.rows[0].contacts.slice(-2), [
      { name: 'Serial Alpha', phone: '+1 860 555 0201' },
      { name: 'Serial Beta', phone: '+1 860 555 0202' },
    ], 'serialized winning contact bytes read back exactly from PostgreSQL');

    await page.route(origin + '/api/account/preferences', route => {
      if (route.request().method() === 'PUT') return route.abort('failed');
      return route.continue();
    });
    const failureConsoleStart = ledger.consoleErrors.length;
    await page.fill('#contactName', 'Failure Draft');
    await page.fill('#contactPhone', '+1 860 555 0203');
    const failedWrite = page.waitForEvent('requestfailed', request =>
      request.url() === origin + '/api/account/preferences' && request.method() === 'PUT'
    );
    await page.click('#addContactBtn');
    await failedWrite;
    await page.waitForFunction(() => document.getElementById('contactDraftStatus').dataset.state === 'error');
    await page.waitForTimeout(50);
    const failureDiagnostics = ledger.consoleErrors.splice(failureConsoleStart);
    assert.ok(failureDiagnostics.every(message =>
      message.startsWith(input.role + ': ') && /ERR_FAILED|Failed to load resource/.test(message)
    ), 'only the deliberately failed contact transport diagnostic is classified as expected');
    ledger.expectedConsoleErrors.push(...failureDiagnostics);
    assert.deepStrictEqual(await page.evaluate(() => ({
      name: document.getElementById('contactName').value,
      phone: document.getElementById('contactPhone').value,
    })), { name: 'Failure Draft', phone: '+1 860 555 0203' },
    'non-conflict transport failure retains exact contact draft bytes');
    await page.unroute(origin + '/api/account/preferences');
    await captureEvidence(page, browserLabel, 'hostile-security', 'settings-hostile-and-failure-retention.png');

    winnerContext = await contextFor(browser, origin, session, { ...input, role: 'owner-contact-winner' }, ledger);
    staleContext = await contextFor(browser, origin, session, { ...input, role: 'owner-contact-stale' }, ledger);
    const winner = await winnerContext.newPage();
    const stale = await staleContext.newPage();
    attachPage(winner, ledger, 'owner-contact-winner');
    attachPage(stale, ledger, 'owner-contact-stale');
    await Promise.all([
      winner.goto(origin + '/dashboard/settings', { waitUntil: 'domcontentloaded' }),
      stale.goto(origin + '/dashboard/settings', { waitUntil: 'domcontentloaded' }),
    ]);
    await Promise.all([waitForSettings(winner), waitForSettings(stale)]);
    await winner.fill('#contactName', 'Winning Contact');
    await winner.fill('#contactPhone', '+1 860 555 0204');
    const winningWrite = winner.waitForResponse(response =>
      response.url() === origin + '/api/account/preferences' && response.request().method() === 'PUT'
    );
    await winner.click('#addContactBtn');
    assert.strictEqual((await winningWrite).status(), 200, 'winning mounted contact write succeeds');
    await stale.fill('#contactName', 'Stale Recoverable Draft');
    await stale.fill('#contactPhone', '+1 860 555 0205');
    const staleConsoleStart = ledger.consoleErrors.length;
    const staleWrite = stale.waitForResponse(response =>
      response.url() === origin + '/api/account/preferences' && response.request().method() === 'PUT'
    );
    await stale.click('#addContactBtn');
    assert.strictEqual((await staleWrite).status(), 409, 'stale mounted contact write fails closed');
    await stale.waitForFunction(() => !document.getElementById('reloadSettingsBtn').hidden);
    await stale.waitForTimeout(50);
    const staleDiagnostics = ledger.consoleErrors.splice(staleConsoleStart);
    assert.ok(staleDiagnostics.every(message =>
      message.startsWith('owner-contact-stale: ') && /409 \(Conflict\)/.test(message)
    ), 'only the expected stale-write 409 diagnostic is classified as expected');
    ledger.expectedConsoleErrors.push(...staleDiagnostics);
    assert.deepStrictEqual(await stale.evaluate(() => ({
      name: document.getElementById('contactName').value,
      phone: document.getElementById('contactPhone').value,
      addDisabled: document.getElementById('addContactBtn').disabled,
    })), { name: 'Stale Recoverable Draft', phone: '+1 860 555 0205', addDisabled: true },
    '409 retains exact losing draft and blocks mutation until reload');
    await stale.click('#reloadSettingsBtn');
    await waitForSettings(stale);
    assert.deepStrictEqual(await stale.evaluate(() => ({
      name: document.getElementById('contactName').value,
      phone: document.getElementById('contactPhone').value,
      addDisabled: document.getElementById('addContactBtn').disabled,
    })), { name: 'Stale Recoverable Draft', phone: '+1 860 555 0205', addDisabled: false },
    'reload advances version authority without discarding the recoverable draft');
    const retryWrite = stale.waitForResponse(response =>
      response.url() === origin + '/api/account/preferences' && response.request().method() === 'PUT'
    );
    await stale.click('#addContactBtn');
    assert.strictEqual((await retryWrite).status(), 200, 'retained stale draft can be retried after reload');
    durable = await pool.query(
      "SELECT preferences->'contacts' AS contacts FROM organization_account_preferences WHERE organization_id = $1",
      [ORG_A]
    );
    assert.deepStrictEqual(durable.rows[0].contacts.slice(-2), [
      { name: 'Winning Contact', phone: '+1 860 555 0204' },
      { name: 'Stale Recoverable Draft', phone: '+1 860 555 0205' },
    ], 'winning and recovered losing contact bytes are both durable');
    await captureEvidence(stale, browserLabel, 'ordinary', 'contact-serialized-conflict-recovery.png');
  } finally {
    await serialContext.close();
    if (winnerContext) await winnerContext.close();
    if (staleContext) await staleContext.close();
  }
}

async function exerciseReadOnlyGuards(browser, origin, sessions, ledger) {
  for (const role of ['member', 'viewer']) {
    const input = { role: role + '-guard', viewport: { width: 390, height: 844 }, viewportLabel: 'mobile', theme: 'dark' };
    const context = await contextFor(browser, origin, sessions[role], input, ledger);
    try {
      const page = await context.newPage();
      attachPage(page, ledger, input.role);
      await page.goto(origin + '/dashboard/settings', { waitUntil: 'domcontentloaded' });
      await waitForSettings(page);
      const before = ledger.requests.filter(entry => entry.role === input.role && entry.method === 'PUT').length;
      await page.evaluate(async () => {
        saveSettings();
        saveContacts([]);
        document.getElementById('saveSettingsBtn').click();
        await new Promise(resolve => setTimeout(resolve, 50));
      });
      const after = ledger.requests.filter(entry => entry.role === input.role && entry.method === 'PUT').length;
      assert.strictEqual(after, before, role + ': guarded presentation emits no mutation request');
    } finally {
      await context.close();
    }
  }
}

async function inspectBusinessProfile(browser, browserLabel, origin, sessions, pool, ledger) {
  const input = { role: 'owner-profile', viewport: { width: 1280, height: 900 }, viewportLabel: 'desktop', theme: 'light' };
  const context = await contextFor(browser, origin, sessions.owner, input, ledger);
  try {
    const page = await context.newPage();
    attachPage(page, ledger, input.role);
    await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('company-name').value === 'Notification Presentation A');
    await page.waitForLoadState('networkidle');
    assert.strictEqual(await page.locator('.bp-nav-btn.active').getAttribute('data-section'), 'company',
      'sectionless Business Profile starts at Company');
    await page.click('[data-section="services"]');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('section') === 'services');
    await page.waitForLoadState('networkidle');
    await page.goBack();
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('section'));
    await page.waitForLoadState('networkidle');
    assert.strictEqual(await page.locator('.bp-nav-btn.active').getAttribute('data-section'), 'company',
      'Back to the sectionless canonical URL restores Company');
    await page.goto(origin + '/dashboard/business-profile?section=services', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('company-name').value === 'Notification Presentation A');
    await page.waitForLoadState('networkidle');
    assert.strictEqual(await page.locator('.bp-nav-btn.active').getAttribute('data-section'), 'services',
      'query deep link restores Services');
    await page.goto(origin + '/dashboard/business-profile?section=company#business-number', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'business-number');
    await page.waitForLoadState('networkidle');
    assert.strictEqual(await page.locator('.bp-nav-btn.active').getAttribute('data-section'), 'company',
      'hash deep link restores Company and its focus target');
    await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('company-name').value === 'Notification Presentation A');
    await page.waitForLoadState('networkidle');
    await page.fill('#businessProfileSectionSearch', 'knowledge');
    assert.strictEqual(await page.locator('#northstarStickySaveBar').isHidden(), true,
      'section search never creates a false durable dirty state');
    await page.fill('#businessProfileSectionSearch', '');
    await page.click('[data-section="company"]');
    await page.fill('#company-dba', 'Unrelated notification-safe edit');
    assert.strictEqual(await page.locator('#northstarStickySaveBar').isVisible(), true,
      'a real Business Profile field still creates the shared dirty state');
    await captureEvidence(page, browserLabel, 'ordinary', 'business-profile-search-history-and-real-dirty.png');
    await page.click('[data-section="notifications"]');
    const presentation = await page.evaluate(() => ({
      controls: document.querySelectorAll('#section-notifications input,#section-notifications select,#section-notifications textarea').length,
      link: document.getElementById('canonicalNotificationsLink').getAttribute('href'),
      note: document.getElementById('legacyNotificationsAuthority').textContent,
      notifications: collectProfile().notifications,
      injected: document.querySelectorAll('[data-m20-legacy-notification]').length,
      xss: window.__notificationXss,
    }));
    assert.strictEqual(presentation.controls, 0, 'Business Profile notification controls are retired');
    assert.strictEqual(presentation.link, '/dashboard/settings', 'Business Profile links to canonical preferences');
    assert.match(presentation.note, /preserved.*ignored|ignored.*preserved/i, 'legacy values are preserved but ignored');
    assert.deepStrictEqual(presentation.notifications, LEGACY_NOTIFICATIONS, 'collectProfile preserves untouched legacy values');
    assert.strictEqual(presentation.injected, 0);
    assert.strictEqual(presentation.xss, 0);
    await page.locator('#canonicalNotificationsLink').focus();
    assert.strictEqual(await page.locator('#canonicalNotificationsLink').evaluate(node => document.activeElement === node), true);

    await page.click('[data-section="company"]');
    const saved = page.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile' && response.request().method() === 'PUT'
    );
    await page.click('#saveBtn');
    assert.strictEqual((await saved).status(), 200, 'owner saves unrelated Business Profile field');

    await page.goto(origin + '/dashboard/ai-settings', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(new URL(page.url()).pathname + new URL(page.url()).hash, '/dashboard/settings#ai-settings',
      'paid AI Settings legacy route redirects to canonical Settings focus');
    await page.waitForLoadState('networkidle');
    await page.goto(origin + '/dashboard/my-number', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash,
      '/dashboard/business-profile?section=company#business-number',
      'paid My Number legacy route redirects to canonical Company number');
    await page.waitForLoadState('networkidle');
    await page.goto(origin + '/demo/ai-settings', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(new URL(page.url()).pathname + new URL(page.url()).hash, '/demo/settings#ai-settings',
      'demo AI Settings legacy route redirects mode-safely');
    await page.waitForLoadState('networkidle');
    await page.goto(origin + '/demo/my-number', { waitUntil: 'domcontentloaded' });
    assert.strictEqual(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash,
      '/demo/business-profile?section=company#business-number',
      'demo My Number legacy route redirects mode-safely');
    await page.waitForLoadState('networkidle');
    await page.goto(origin + '/demo/business-profile', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('businessProfileRoot').getAttribute('aria-busy') === 'false');
    await page.waitForLoadState('networkidle');
    assert.strictEqual(await page.locator('.bp-nav-btn.active').getAttribute('data-section'), 'company',
      'demo sectionless Business Profile starts at Company');
    await page.click('[data-section="services"]');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('section') === 'services');
    await page.waitForLoadState('networkidle');
    await page.goBack();
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('section'));
    await page.waitForLoadState('networkidle');
    assert.strictEqual(await page.locator('.bp-nav-btn.active').getAttribute('data-section'), 'company',
      'demo Back to sectionless Business Profile restores Company');
    await page.fill('#businessProfileSectionSearch', 'knowledge');
    assert.strictEqual(await page.locator('#northstarStickySaveBar').isHidden(), true,
      'demo section search remains navigation-only and clean');
    await page.waitForLoadState('networkidle');
  } finally {
    await context.close();
  }

  const raw = await pool.query(
    `SELECT raw_profile -> 'notifications' AS notifications,
            encode(convert_to(raw_profile #>> '{notifications,legacyLabel}', 'UTF8'), 'hex') AS legacy_hex
       FROM canonical_business_profiles
      WHERE organization_id = $1 AND is_active = TRUE`,
    [ORG_A]
  );
  assert.deepStrictEqual(raw.rows, [{ notifications: LEGACY_NOTIFICATIONS, legacy_hex: hex(LEGACY_LABEL) }],
    'unrelated profile save preserves exact legacy JSON and UTF-8 value bytes');

  const viewerInput = { role: 'viewer-profile', viewport: { width: 390, height: 844 }, viewportLabel: 'mobile', theme: 'dark' };
  const viewerContext = await contextFor(browser, origin, sessions.viewer, viewerInput, ledger);
  try {
    const page = await viewerContext.newPage();
    attachPage(page, ledger, viewerInput.role);
    await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('company-name').value === 'Notification Presentation A');
    await page.click('[data-section="notifications"]');
    assert.strictEqual(await page.locator('#saveBtn').isDisabled(), true, 'viewer profile remains read only');
    assert.strictEqual(await page.locator('#canonicalNotificationsLink').getAttribute('href'), '/dashboard/settings');
  } finally {
    await viewerContext.close();
  }
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
  const beforeData = dataDigest();
  const suiteDatabase = await createSuiteDatabase('m20-part2i-notifications-' + selected);
  let db;
  let server;
  let browser;
  const ledger = {
    requests: [], providers: [], external: [], consoleErrors: [], expectedConsoleErrors: [],
    pageErrors: [], expectedPageErrors: [],
  };
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
        ($1,'Notification Presentation A','notification-presentation-a@example.test'),
        ($2,'Notification Presentation B','notification-presentation-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, userId + '@m20-part2i.test', role]
      );
    }
    await pool.query(
      `INSERT INTO notification_preferences (
         organization_id, email_new_lead, email_call_summary, email_appointment,
         sms_new_lead, sms_urgent, notification_email, notification_phone
       ) VALUES
         ($1,TRUE,FALSE,TRUE,FALSE,TRUE,$3,$4),
         ($2,FALSE,FALSE,FALSE,FALSE,FALSE,'other-browser-tenant@example.test','+1 212 555 0199')`,
      [ORG_A, ORG_B, EMAIL_POISON, PHONE_POISON]
    );
    await pool.query(
      `INSERT INTO organization_account_preferences (organization_id, preferences)
       VALUES ($1,'{}'::jsonb),($2,'{}'::jsonb)`,
      [ORG_A, ORG_B]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, expectedVersion: null,
      profile: profileFor('Notification Presentation A', LEGACY_NOTIFICATIONS),
    });
    const otherProfile = await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B, expectedVersion: null,
      profile: profileFor('Notification Presentation B', { email: true, otherTenant: 'unchanged' }),
    });

    const sessions = {};
    for (const [role, userId] of [
      ['owner', OWNER_A], ['admin', ADMIN_A], ['member', MEMBER_A], ['viewer', VIEWER_A],
    ]) {
      sessions[role] = await provisionDurableSession(pool, { userId, organizationId: ORG_A, role });
    }

    const { app } = require('../../src/server');
    const { AssetCatalogueRepository } = require('../../src/assets/repository');
    const { AssetCatalogueService } = require('../../src/assets/service');
    app.locals.assetCatalogueService = new AssetCatalogueService(new AssetCatalogueRepository(pool));
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await browserType.launch(executablePath ? { executablePath } : {});

    const viewports = [
      { label: 'desktop', width: 1280, height: 900 },
      { label: 'mobile', width: 390, height: 844 },
    ];
    const themes = ['light', 'dark'];
    const browserLabel = selected === 'chrome' ? 'chrome' : 'webkit';
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      for (const viewport of viewports) {
        for (const theme of themes) {
          await exerciseCell(browser, browserLabel, origin, sessions[role], {
            role,
            canEdit: role === 'owner' || role === 'admin',
            viewport: { width: viewport.width, height: viewport.height },
            viewportLabel: viewport.label,
            theme,
          }, ledger);
        }
      }
    }

    await exerciseOwnerMutation(browser, origin, sessions.owner, pool, ledger);
    await exerciseContactPersistence(browser, browserLabel, origin, sessions.owner, pool, ledger);
    await exerciseReadOnlyGuards(browser, origin, sessions, ledger);
    await inspectBusinessProfile(browser, browserLabel, origin, sessions, pool, ledger);
    assert.strictEqual((await pool.query(
      'SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B]
    )).rows[0].id, otherProfile.id, 'other tenant profile remains unchanged');
    const otherPreferences = await pool.query(
      `SELECT notification_email, notification_phone FROM notification_preferences WHERE organization_id = $1`,
      [ORG_B]
    );
    assert.deepStrictEqual(otherPreferences.rows, [{
      notification_email: 'other-browser-tenant@example.test',
      notification_phone: '+1 212 555 0199',
    }], 'other tenant notification row remains unchanged');
    assert.deepStrictEqual(ledger.providers, [], 'provider requests remain zero');
    assert.deepStrictEqual(ledger.external, [], 'unexpected external requests remain zero');
    assert.strictEqual(ledger.pageErrors.length, 0, ledger.pageErrors.join('\n'));
    assert.ok(selected === 'webkit'
      ? ledger.expectedPageErrors.length <= 1
      : ledger.expectedPageErrors.length === 0,
    'only WebKit may emit at most one exact legacy-route navigation cancellation diagnostic');
    assert.strictEqual(ledger.consoleErrors.length, 0, ledger.consoleErrors.join('\n'));
    assert.ok(ledger.requests.filter(entry => entry.path === '/api/account/preferences' && entry.method === 'GET').length >= 16 * 2,
      'every initial and reload lifecycle consumes the mounted canonical preferences route');
    assert.strictEqual(ledger.requests.filter(entry => entry.path === '/api/account/preferences' && entry.method === 'PUT').length, 7,
      'only the explicit owner and contact persistence scenarios write canonical preferences');
    assert.ok(ledger.requests.every(entry => entry.authorization === null), 'browser never sends bearer authorization');
    assert.strictEqual(dataDigest(), beforeData, 'data files remain byte-identical');

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      version: browser.version(),
      database: suiteDatabase.databaseName,
      roles: ['owner', 'admin', 'member', 'viewer'],
      viewports: viewports.map(value => value.label),
      themes,
      cartesianCombinations: 16,
      lifecycle: ['initial', 'rerender', 'reload'],
      ownerPreferenceWrites: 7,
      contactPersistence: ['serialized', 'failure-retained', 'stale-409-retained', 'reload-retry-durable'],
      readOnlyPreferenceWrites: 0,
      businessProfileWrites: 1,
      providerRequests: ledger.providers.length,
      providerActions: 0,
      rawPostgresLegacyNotificationValues: 'exact',
      canonicalPostgresNotificationValues: 'exact',
      tenantIsolation: 'exact',
      xssExecutions: 0,
      unexpectedConsoleErrors: ledger.consoleErrors.length,
      expectedFailureDiagnostics: ledger.expectedConsoleErrors.length,
      expectedRedirectCancellationDiagnostics: ledger.expectedPageErrors.length,
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
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
