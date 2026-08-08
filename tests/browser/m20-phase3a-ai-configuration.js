'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

const ROOT = path.resolve(__dirname, '..', '..');
const ORG_A = '8c000000-0000-4000-8000-000000000001';
const ORG_B = '8c000000-0000-4000-8000-000000000002';
const OWNER_A = '8d000000-0000-4000-8000-000000000001';
const ADMIN_A = '8d000000-0000-4000-8000-000000000002';
const MEMBER_A = '8d000000-0000-4000-8000-000000000003';
const VIEWER_A = '8d000000-0000-4000-8000-000000000004';
const OWNER_B = '8d000000-0000-4000-8000-000000000005';
const COMPANY_NAME = 'Legacy <img src=x onerror=window.__voiceXss++> Company 🧭';
const SETTINGS_GREETING = '  Legacy settings greeting <literal>\r\nKeep e\u0301 bytes.  ';
const LEGACY = Object.freeze({
  assistantName: 'LEGACY ASSISTANT REMAINS EFFECTIVE',
  voiceStyle: 'LEGACY STYLE REMAINS EFFECTIVE',
  greetingTemplate: 'LEGACY GREETING REMAINS EFFECTIVE',
  privateProviderByte: 'PRESERVE EXACT',
});

function baseProfile(name) {
  const value = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({ companyName: name });
  value.company = { ...value.company, ...canonical.company, name };
  value.services = canonical.services;
  value.canonicalPricing = canonical.canonicalPricing;
  value.canonicalCosts = canonical.canonicalCosts;
  value.retell = { ...LEGACY };
  delete value.voiceAssistant;
  return value;
}

function configuredVoice(greeting) {
  return {
    name: '  Canonical <Guide> 🧭  ',
    style: '  Calm guidance\nKeep markup literal.  ',
    greeting,
    personality: 'friendly',
    conversationStyle: 'consultative',
    escalationRules: {
      rules: [{
        id: 'voice-rule-browser',
        enabled: true,
        when: '  Caller says </textarea><svg onload=window.__voiceXss++>.  ',
        action: 'transfer_if_available',
        fallbackAction: 'request_callback',
      }],
    },
  };
}

function hex(value) {
  return Buffer.from(value, 'utf8').toString('hex');
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

async function contextFor(browser, origin, session, input, ledger) {
  const context = await browser.newContext({ viewport: input.viewport });
  await context.addInitScript(theme => {
    window.__voiceXss = 0;
    localStorage.setItem('northstar-theme', theme);
  }, input.theme);
  await context.addCookies([
    { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (/fonts\.googleapis|fonts\.gstatic/.test(url.hostname)) {
      return route.fulfill({ status: 200, contentType: url.hostname.includes('googleapis') ? 'text/css' : 'font/woff2', body: '' });
    }
    const entry = { role: input.role, method: route.request().method(), url: route.request().url() };
    if (/retell|stripe|twilio|resend|openai|provider/i.test(url.hostname)) ledger.providers.push(entry);
    else ledger.external.push(entry);
    return route.fulfill({ status: 204, body: '' });
  });
  context.on('request', browserRequest => {
    const url = new URL(browserRequest.url());
    ledger.requests.push({
      role: input.role,
      method: browserRequest.method(),
      origin: url.origin,
      path: url.pathname,
      authorization: browserRequest.headers().authorization || null,
    });
  });
  return context;
}

function attachPage(page, ledger, role) {
  page.on('pageerror', error => ledger.pageErrors.push(role + ': ' + error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (role === 'owner-desktop-light' && /status of 409 \(Conflict\)/.test(message.text())) {
      ledger.expectedConflictConsole.push(role + ': ' + message.text());
      return;
    }
    ledger.consoleErrors.push(role + ': ' + message.text());
  });
}

async function openVoiceEditor(page, origin) {
  await page.goto(origin + '/dashboard/business-profile?section=retell#voice-assistant-configuration', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'ready');
  await page.waitForFunction(() => document.getElementById('section-retell').classList.contains('active'));
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
  const suiteDatabase = await createSuiteDatabase('m20-phase3a-browser-' + selected);
  let db;
  let server;
  let browser;
  const ledger = { requests: [], providers: [], external: [], consoleErrors: [], expectedConflictConsole: [], pageErrors: [] };
  try {
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    ]) delete process.env[name];

    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL initializes');
    const pool = db.getPool();
    const identity = (await pool.query("SELECT current_setting('server_version') AS version, current_setting('TimeZone') AS timezone, current_setting('data_checksums') AS checksums")).rows[0];
    assert.deepStrictEqual(identity, { version: '18.4', timezone: 'UTC', checksums: 'on' });
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
       ($1,'Phase 3A browser A','phase3a-browser-a@example.test'),
       ($2,'Phase 3A browser B','phase3a-browser-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, `${role}-${userId.slice(-4)}@phase3a-browser.test`, role]
      );
    }
    await pool.query(
      `INSERT INTO notification_preferences (
         organization_id, email_new_lead, email_call_summary, email_appointment,
         sms_new_lead, sms_urgent, notification_email, notification_phone
       ) VALUES ($1,TRUE,FALSE,TRUE,FALSE,TRUE,'owner@example.test','+1 860 555 0100'),
                ($2,FALSE,TRUE,FALSE,TRUE,FALSE,'other@example.test','+1 212 555 0100')`,
      [ORG_A, ORG_B]
    );
    await pool.query(
      `INSERT INTO organization_account_preferences (organization_id, preferences)
       VALUES ($1,jsonb_build_object('greeting',$3::text,'companyInfo','legacy info')),($2,'{}'::jsonb)`,
      [ORG_A, ORG_B, SETTINGS_GREETING]
    );
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: OWNER_A, profile: baseProfile(COMPANY_NAME) });
    const otherAuthority = await putBusinessProfile(pool, { organizationId: ORG_B, userId: OWNER_B, profile: baseProfile('Other Tenant') });
    const sessions = {};
    for (const [role, userId, organizationId] of [
      ['owner', OWNER_A, ORG_A], ['admin', ADMIN_A, ORG_A], ['member', MEMBER_A, ORG_A],
      ['viewer', VIEWER_A, ORG_A], ['otherOwner', OWNER_B, ORG_B],
    ]) {
      sessions[role] = await provisionDurableSession(pool, { userId, organizationId, role: role === 'otherOwner' ? 'owner' : role });
    }
    const { app } = require('../../src/server');
    const { AssetCatalogueRepository } = require('../../src/assets/repository');
    const { AssetCatalogueService } = require('../../src/assets/service');
    app.locals.assetCatalogueService = new AssetCatalogueService(new AssetCatalogueRepository(pool));
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await browserType.launch({ headless: true, executablePath });

    const ownerContext = await contextFor(browser, origin, sessions.owner, {
      role: 'owner-desktop-light', viewport: { width: 1440, height: 900 }, theme: 'light',
    }, ledger);
    const ownerPage = await ownerContext.newPage();
    attachPage(ownerPage, ledger, 'owner-desktop-light');
    await openVoiceEditor(ownerPage, origin);
    assert.match(await ownerPage.locator('#voiceAssistantAuthorityStatus').textContent(), /Legacy compatibility remains in effect/);
    assert.strictEqual(await ownerPage.inputValue('#voice-assistant-name'), '', 'legacy values are not copied into neutral controls');
    assert.strictEqual((await pool.query("SELECT raw_profile ? 'voiceAssistant' AS present FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE", [ORG_A])).rows[0].present, false);

    await ownerPage.click('[data-section="company"]');
    await ownerPage.fill('#company-dba', 'Unrelated saved DBA');
    const unrelatedSave = ownerPage.waitForResponse(response => response.url() === origin + '/api/v1/business-profile' && response.request().method() === 'PUT');
    await ownerPage.click('#saveBtn');
    assert.strictEqual((await unrelatedSave).status(), 200);
    assert.strictEqual((await pool.query("SELECT raw_profile ? 'voiceAssistant' AS present FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE", [ORG_A])).rows[0].present, false, 'unrelated browser save preserves neutral absence');

    await ownerPage.click('[data-section="retell"]');
    const literalGreeting = 'Hello, ' + COMPANY_NAME;
    await ownerPage.fill('#voice-assistant-name', '  Canonical <Guide> 🧭  ');
    await ownerPage.fill('#voice-assistant-style', '  Calm guidance\nKeep markup literal.  ');
    await ownerPage.selectOption('#voice-assistant-personality', 'friendly');
    await ownerPage.selectOption('#voice-assistant-conversation-style', 'consultative');
    await ownerPage.fill('#voice-assistant-greeting', 'Hello, ');
    await ownerPage.locator('#voice-assistant-greeting').evaluate(element => {
      element.setSelectionRange(element.value.length, element.value.length);
    });
    await ownerPage.click('#insert-saved-company-name');
    assert.strictEqual(await ownerPage.locator('#voice-assistant-greeting-preview').textContent(), literalGreeting);
    assert.strictEqual(await ownerPage.locator('#voiceAssistantEditor img,#voiceAssistantEditor svg,#voiceAssistantEditor script').count(), 0);
    assert.strictEqual(await ownerPage.evaluate(() => window.__voiceXss), 0);
    await ownerPage.click('#add-voice-escalation-rule');
    const rule = ownerPage.locator('#voice-escalation-rules .bp-rule-card');
    await rule.locator('.voice-rule-enabled').check();
    await rule.locator('.voice-rule-when').fill('  Caller says </textarea><svg onload=window.__voiceXss++>.  ');
    await rule.locator('.voice-rule-action').selectOption('transfer_if_available');
    await rule.locator('.voice-rule-fallbackAction').selectOption('request_callback');
    const voiceResponsePromise = ownerPage.waitForResponse(response => response.url() === origin + '/api/v1/business-profile/voiceAssistant' && response.request().method() === 'PUT');
    await ownerPage.click('#saveVoiceAssistantBtn');
    const voiceResponse = await voiceResponsePromise;
    assert.strictEqual(voiceResponse.status(), 200);
    const voiceBody = voiceResponse.request().postDataJSON();
    assert.deepStrictEqual(Object.keys(voiceBody).sort(), ['expectedVersion', 'value']);
    assert.match(voiceBody.expectedVersion, /^org-profile-v[1-9][0-9]*$/);
    const durableVoice = voiceBody.value;
    assert.strictEqual(durableVoice.greeting, literalGreeting);
    assert.match(durableVoice.escalationRules.rules[0].id, /^voice-rule-[A-Za-z0-9._:-]+$/);
    const stored = (await pool.query(
      `SELECT encode(convert_to(raw_profile #>> '{voiceAssistant,greeting}', 'UTF8'), 'hex') AS greeting_hex,
              encode(convert_to(raw_profile #>> '{voiceAssistant,escalationRules,rules,0,when}', 'UTF8'), 'hex') AS when_hex,
              raw_profile -> 'retell' AS retell
         FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];
    assert.deepStrictEqual(stored, {
      greeting_hex: hex(literalGreeting),
      when_hex: hex(durableVoice.escalationRules.rules[0].when),
      retell: LEGACY,
    });

    const current = await request(app).get('/api/v1/business-profile').set(sessions.admin.headers);
    const winner = configuredVoice('Concurrent winner greeting');
    const advanced = await request(app).put('/api/v1/business-profile/voiceAssistant').set(sessions.admin.headers).send({
      expectedVersion: current.body.data.canonicalAuthority.version,
      value: winner,
    });
    assert.strictEqual(advanced.status, 200);
    await ownerPage.fill('#voice-assistant-greeting', 'Unsaved stale browser draft');
    const conflictPromise = ownerPage.waitForResponse(response => response.url() === origin + '/api/v1/business-profile/voiceAssistant' && response.request().method() === 'PUT');
    await ownerPage.click('#saveVoiceAssistantBtn');
    assert.strictEqual((await conflictPromise).status(), 409);
    await ownerPage.waitForFunction(() => /unsaved AI configuration remains/i.test(document.getElementById('voiceAssistantError').textContent));
    assert.match(await ownerPage.locator('#voiceAssistantError').textContent(), /unsaved AI configuration remains/i);
    assert.strictEqual(await ownerPage.locator('#reloadVoiceAssistantBtn').isVisible(), true);
    await ownerPage.waitForFunction(() => document.activeElement && document.activeElement.id === 'reloadVoiceAssistantBtn');
    assert.strictEqual(await ownerPage.locator('#reloadVoiceAssistantBtn').evaluate(element => document.activeElement === element), true);
    const conflictWrites = ledger.requests.filter(entry =>
      entry.role === 'owner-desktop-light' && entry.method === 'PUT' &&
      entry.path === '/api/v1/business-profile/voiceAssistant').length;
    await ownerPage.fill('#voice-assistant-greeting', 'Edited draft still requires an explicit reload');
    assert.strictEqual(await ownerPage.locator('#saveVoiceAssistantBtn').isDisabled(), true);
    assert.strictEqual(await ownerPage.locator('#reloadVoiceAssistantBtn').isVisible(), true);
    assert.match(await ownerPage.locator('#voiceAssistantError').textContent(), /unsaved AI configuration remains/i);
    assert.strictEqual(ledger.requests.filter(entry =>
      entry.role === 'owner-desktop-light' && entry.method === 'PUT' &&
      entry.path === '/api/v1/business-profile/voiceAssistant').length, conflictWrites);
    const reloadPromise = ownerPage.waitForResponse(response => response.url() === origin + '/api/v1/business-profile' && response.request().method() === 'GET');
    await ownerPage.click('#reloadVoiceAssistantBtn');
    await reloadPromise;
    await ownerPage.waitForFunction(value => document.getElementById('voice-assistant-greeting').value === value, winner.greeting);

    await ownerPage.goto(origin + '/dashboard/ai-settings', { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForFunction(() => document.documentElement.getAttribute('data-northstar-navigation') === 'ready');
    assert.strictEqual(await ownerPage.locator('#mainContent input,#mainContent select,#mainContent textarea').count(), 0);
    assert.strictEqual((await ownerPage.locator('body').textContent()).includes('Coming Soon'), false);
    await ownerPage.locator('#openCanonicalAiSettings').focus();
    await ownerPage.keyboard.press('Enter');
    await ownerPage.waitForURL(/\/dashboard\/business-profile\?section=retell#voice-assistant-configuration/);
    await ownerPage.waitForFunction(() => document.getElementById('section-retell').classList.contains('active'));

    await ownerPage.goto(origin + '/dashboard/settings', { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForFunction(() => document.getElementById('notificationPreferencesAuthority').dataset.state === 'ready');
    assert.strictEqual(await ownerPage.locator('#greeting').count(), 0);
    assert.strictEqual((await ownerPage.locator('body').textContent()).includes('Rachel ('), false);
    assert.strictEqual(await ownerPage.locator('#canonicalAiConfigurationLink').getAttribute('href'), '/dashboard/business-profile?section=retell#voice-assistant-configuration');
    await ownerPage.fill('#companyInfoAiContext', 'unrelated settings browser edit');
    const settingsSave = ownerPage.waitForResponse(response => response.url() === origin + '/api/account/preferences' && response.request().method() === 'PUT');
    await ownerPage.click('#saveSettingsBtn');
    assert.strictEqual((await settingsSave).status(), 200);
    const settingsHex = (await pool.query(
      "SELECT encode(convert_to(preferences ->> 'greeting', 'UTF8'), 'hex') AS greeting_hex FROM organization_account_preferences WHERE organization_id = $1",
      [ORG_A]
    )).rows[0].greeting_hex;
    assert.strictEqual(settingsHex, hex(SETTINGS_GREETING));
    await ownerContext.close();

    for (const [role, session] of [['member', sessions.member], ['viewer', sessions.viewer]]) {
      const readOnlyContext = await contextFor(browser, origin, session, {
        role: role + '-mobile-dark', viewport: { width: 390, height: 844 }, theme: 'dark',
      }, ledger);
      const page = await readOnlyContext.newPage();
      attachPage(page, ledger, role + '-mobile-dark');
      await openVoiceEditor(page, origin);
      assert.strictEqual(await page.locator('#saveVoiceAssistantBtn').isDisabled(), true);
      assert.strictEqual(await page.locator('#add-voice-escalation-rule').isDisabled(), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'ready');
      assert.strictEqual(await page.locator('#saveVoiceAssistantBtn').isDisabled(), true);
      await readOnlyContext.close();
    }

    assert.strictEqual((await pool.query('SELECT id FROM canonical_business_profiles WHERE organization_id = $1 AND is_active = TRUE', [ORG_B])).rows[0].id, otherAuthority.id);
    assert.deepStrictEqual(ledger.providers, [], 'provider requests remain zero');
    assert.deepStrictEqual(ledger.external, [], 'unexpected external requests remain zero');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'unexpected console errors remain zero');
    assert.strictEqual(ledger.expectedConflictConsole.length, 1, 'the one intentional stale write reports one expected 409 resource error');
    assert.deepStrictEqual(ledger.pageErrors, [], 'page errors remain zero');
    assert.ok(ledger.requests.every(entry => entry.authorization === null), 'browser sends no Authorization headers');
    assert.strictEqual(ledger.requests.filter(entry =>
      (entry.role.startsWith('member') || entry.role.startsWith('viewer')) &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method)).length, 0, 'read-only roles emit zero writes');

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      version: browser.version(),
      database: suiteDatabase.databaseName,
      databaseIdentity: identity,
      roles: ['owner', 'admin', 'member', 'viewer'],
      viewports: ['desktop', 'mobile'],
      themes: ['light', 'dark'],
      lifecycle: ['initial', 'rerender', 'reload'],
      legacyCutover: 'intentional_only',
      conflict: '409_reload_required',
      settingsGreetingBytes: 'exact',
      providerRequests: 0,
      xssExecutions: 0,
      physicalSafari: false,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db && db.getPool()) await db.getPool().end();
    await suiteDatabase.cleanup();
    for (const [name, value] of original.entries()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
