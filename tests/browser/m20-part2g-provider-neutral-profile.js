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
const ORG_A = '89000000-0000-4000-8000-000000000001';
const ORG_B = '89000000-0000-4000-8000-000000000002';
const OWNER_A = '8a000000-0000-4000-8000-000000000001';
const ADMIN_A = '8a000000-0000-4000-8000-000000000002';
const MEMBER_A = '8a000000-0000-4000-8000-000000000003';
const VIEWER_A = '8a000000-0000-4000-8000-000000000004';
const OWNER_B = '8a000000-0000-4000-8000-000000000005';

const INITIAL = Object.freeze({
  industry: '  Home services <industry> 🏠  ',
  ownerName: '  Owner </input><svg onload=window.__profileXss++> 🧱  ',
  businessDescription: '\n  Initial description e\u0301 <literal>.  \n',
  emergencyPolicy: '  Human confirmation required.\r\nNo arrival promise.  ',
  faq: [
    '  Q: Is a phone quote final?\nA: Written scope controls.  ',
    '  <img src=x onerror=window.__profileXss++> is literal FAQ data.  ',
  ],
  companyValues: ['  Accuracy  ', '  Safety & care <literal>  '],
  customPrompt: '  Use verified facts only.\r\nKeep every byte.  ',
  name: '  NorthStar Guide <name> 🧭  ',
  style: '  Warm, concise, and professional.\nNever invent availability.  ',
  greeting: '  Thank you for calling <NorthStar>. How may we help? 🌌  ',
  personality: 'professional',
  conversationStyle: 'direct',
  rules: [
    { id: 'voice-rule-alpha', enabled: true, when: '  Initial urgent <rule>.  ', action: 'transfer_if_available', fallbackAction: 'request_callback' },
    { id: 'voice-rule-beta', enabled: false, when: '  Initial message rule.  ', action: 'take_message', fallbackAction: 'take_message' },
  ],
});

const EDITED = Object.freeze({
  industry: '  Edited industry </option> 🌳  ',
  ownerName: '  Edited owner <literal> 🧰  ',
  businessDescription: '\n  Edited description </textarea><script>window.__profileXss++</script>  \n',
  emergencyPolicy: '  Edited emergency guidance.\r\nHuman review remains required.  ',
  faq: [
    '  Edited FAQ one <literal>.\nSecond line.  ',
    '  Edited FAQ two </textarea><svg onload=window.__profileXss++>.  ',
  ],
  companyValues: ['  Edited accuracy  ', '  Edited safety <literal>  '],
  customPrompt: '  Edited operating guidance.\r\nDo not infer missing facts.  ',
  name: '  Edited Guide <name> 🌌  ',
  style: '  Edited calm style.\nKeep the response concise.  ',
  greeting: '  Admin greeting <literal>. How can we help? 🧭  ',
  personality: 'consultative',
  conversationStyle: 'warm',
  rules: [
    { id: 'voice-rule-beta', enabled: true, when: '  Edited beta </textarea><svg onload=window.__profileXss++>.  ', action: 'request_callback', fallbackAction: 'take_message' },
    { id: 'voice-rule-alpha', enabled: false, when: '  Edited alpha e\u0301.\nLiteral markup <img>.  ', action: 'take_message', fallbackAction: 'request_callback' },
  ],
});

const LEGACY = Object.freeze({
  assistantName: 'LEGACY ASSISTANT MUST NOT WIN',
  voiceStyle: 'LEGACY STYLE MUST NOT WIN',
  greetingTemplate: 'LEGACY GREETING MUST NOT WIN',
  providerPrivateField: 'PRESERVE RAW LEGACY BYTES',
});

function profileFor(name, values) {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({ companyName: name });
  profile.company = { ...profile.company, ...canonical.company, name };
  profile.services = canonical.services;
  profile.canonicalPricing = canonical.canonicalPricing;
  profile.canonicalCosts = canonical.canonicalCosts;
  profile.industry = values.industry;
  profile.ownerName = values.ownerName;
  profile.businessDescription = values.businessDescription;
  profile.emergencyPolicy = values.emergencyPolicy;
  profile.faq = [...values.faq];
  profile.companyValues = [...values.companyValues];
  profile.customPrompt = values.customPrompt;
  profile.voiceAssistant = {
    name: values.name,
    style: values.style,
    greeting: values.greeting,
    personality: values.personality,
    conversationStyle: values.conversationStyle,
    escalationRules: { rules: values.rules.map(rule => ({ ...rule })) },
  };
  profile.retell = { ...LEGACY };
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

async function contextFor(browser, origin, session, input, ledger) {
  const context = await browser.newContext({ viewport: input.viewport });
  await context.addInitScript(theme => {
    window.__profileXss = 0;
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
      return route.fulfill({ status: 200, contentType: requestUrl.hostname.includes('googleapis') ? 'text/css' : 'font/woff2', body: '' });
    }
    const entry = { role: input.role, method: route.request().method(), url: route.request().url() };
    if (/retell|stripe|twilio|resend|openai|provider/i.test(requestUrl.hostname)) ledger.providers.push(entry);
    else ledger.external.push(entry);
    return route.fulfill({ status: 204, body: '' });
  });
  context.on('request', request => {
    const requestUrl = new URL(request.url());
    ledger.requests.push({
      role: input.role,
      method: request.method(),
      origin: requestUrl.origin,
      path: requestUrl.pathname,
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

async function openNeutralProfile(page, origin, expectedName, navigate = true) {
  if (navigate) await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(name => document.querySelector('#company-name') && document.querySelector('#company-name').value === name,
    expectedName, { timeout: 15000 });
  await page.click('[data-section="retell"]');
  await page.waitForFunction(() => document.getElementById('section-retell').classList.contains('active'));
  await page.waitForFunction(() => document.querySelector('#voice-assistant-name'));
  await page.waitForLoadState('networkidle');
}

async function snapshot(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    navigation: document.documentElement.getAttribute('data-northstar-navigation'),
    industry: document.getElementById('profile-industry').value,
    ownerName: document.getElementById('profile-ownerName').value,
    businessDescription: document.getElementById('profile-businessDescription').value,
    emergencyPolicy: document.getElementById('profile-emergencyPolicy').value,
    faq: Array.from(document.querySelectorAll('#faqContainer .faq-value')).map(node => node.value),
    companyValues: Array.from(document.querySelectorAll('#companyValuesContainer .company-value')).map(node => node.value),
    customPrompt: document.getElementById('profile-customPrompt').value,
    name: document.getElementById('voice-assistant-name').value,
    style: document.getElementById('voice-assistant-style').value,
    greeting: document.getElementById('voice-assistant-greeting').value,
    personality: document.getElementById('voice-assistant-personality').value,
    conversationStyle: document.getElementById('voice-assistant-conversation-style').value,
    rules: Array.from(document.querySelectorAll('#voice-escalation-rules .bp-rule-card')).map(card => ({
      id: card.dataset.ruleId,
      enabled: card.querySelector('.voice-rule-enabled').checked,
      when: card.querySelector('.voice-rule-when').value,
      action: card.querySelector('.voice-rule-action').value,
      fallbackAction: card.querySelector('.voice-rule-fallbackAction').value,
    })),
    greetingPreview: document.getElementById('voice-assistant-greeting-preview').textContent,
    xss: window.__profileXss,
    injectedNodes: document.querySelectorAll('#providerNeutralKnowledge img,#providerNeutralKnowledge script,#providerNeutralKnowledge svg,#voiceAssistantEditor img,#voiceAssistantEditor script,#voiceAssistantEditor svg').length,
    legacyControls: document.querySelectorAll('#ret-voicePersonality,#ret-conversationStyle,#ret-maxConversationLength,#ret-questionStrategy,#ret-confirmationStyle,#ret-emergencyWorkflow').length,
    duplicateIds: Array.from(document.querySelectorAll('[id]')).map(node => node.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    activeBusinessProfileLinks: document.querySelectorAll('[data-nav-id="business-profile"][aria-current="page"]').length,
    authorityText: document.getElementById('providerNeutralAuthority').textContent,
    voiceAuthorityText: document.getElementById('voiceAssistantAuthorityStatus').textContent,
  }));
}

function assertSnapshot(value, input) {
  const domText = raw => raw.replace(/\r\n?/g, '\n');
  assert.strictEqual(value.theme, input.theme, input.role + ' theme retained');
  assert.strictEqual(value.navigation, 'ready', input.role + ' navigation ready');
  assert.strictEqual(value.industry, input.expected.industry, input.role + ' industry exact');
  assert.strictEqual(value.ownerName, input.expected.ownerName, input.role + ' owner exact');
  assert.strictEqual(value.businessDescription, domText(input.expected.businessDescription), input.role + ' description DOM-normalized');
  assert.strictEqual(value.emergencyPolicy, domText(input.expected.emergencyPolicy), input.role + ' emergency policy DOM-normalized');
  assert.deepStrictEqual(value.faq, input.expected.faq.map(domText), input.role + ' FAQ DOM-normalized');
  assert.deepStrictEqual(value.companyValues, input.expected.companyValues, input.role + ' values exact');
  assert.strictEqual(value.customPrompt, domText(input.expected.customPrompt), input.role + ' guidance DOM-normalized');
  assert.strictEqual(value.name, input.expected.name, input.role + ' assistant name exact');
  assert.strictEqual(value.style, domText(input.expected.style), input.role + ' style DOM-normalized');
  assert.strictEqual(value.greeting, domText(input.expected.greeting), input.role + ' greeting DOM-normalized');
  assert.strictEqual(value.personality, input.expected.personality, input.role + ' personality exact');
  assert.strictEqual(value.conversationStyle, input.expected.conversationStyle, input.role + ' conversation style exact');
  assert.deepStrictEqual(value.rules, input.expected.rules.map(rule => ({ ...rule, when: domText(rule.when) })), input.role + ' ordered escalation rules exact');
  assert.strictEqual(value.greetingPreview, domText(input.expected.greeting), input.role + ' literal greeting preview exact');
  assert.strictEqual(value.xss, 0, input.role + ' executes no persisted markup');
  assert.strictEqual(value.injectedNodes, 0, input.role + ' creates no injected nodes');
  assert.strictEqual(value.legacyControls, 0, input.role + ' provider-specific placeholder controls retired');
  assert.deepStrictEqual(value.duplicateIds, [], input.role + ' has no duplicate ids');
  assert.ok(value.scrollWidth - value.clientWidth <= 1, input.role + ' has no horizontal overflow');
  assert.strictEqual(value.activeBusinessProfileLinks, 2, input.role + ' canonical navigation active');
  assert.match(value.authorityText, /provider-neutral/i, input.role + ' authority is explicit');
  assert.match(value.voiceAuthorityText, /versioned provider-neutral/i, input.role + ' voice authority is explicit');
}

async function lifecycle(browser, origin, session, input, ledger) {
  const context = await contextFor(browser, origin, session, input, ledger);
  const page = await context.newPage();
  attachPage(page, ledger, input.role);
  await openNeutralProfile(page, origin, 'Provider Neutral Company');
  assertSnapshot(await snapshot(page), input);
  await page.evaluate(() => renderProfile(profileData));
  assertSnapshot(await snapshot(page), { ...input, role: input.role + '-rerender' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openNeutralProfile(page, origin, 'Provider Neutral Company', false);
  assertSnapshot(await snapshot(page), { ...input, role: input.role + '-reload' });
  if (input.viewport.width <= 500) {
    await page.locator('#navHamburgerBtn').focus();
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'navHamburgerBtn');
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.locator('#mobileMenu').evaluate(node => node.classList.contains('open')), true);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('#mobileMenu').evaluate(node => node.classList.contains('open')), false);
  } else {
    await page.locator('#voice-assistant-name').focus();
    assert.strictEqual(await page.locator('#voice-assistant-name').evaluate(node => document.activeElement === node), true);
  }
  await context.close();
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
  const suiteDatabase = await createSuiteDatabase('m20-part2g-provider-neutral-' + selected);
  let db;
  let server;
  let browser;
  const ledger = { requests: [], providers: [], external: [], consoleErrors: [], pageErrors: [] };
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
        ($1,'Provider Neutral A','provider-neutral-a@example.test'),
        ($2,'Provider Neutral B','provider-neutral-b@example.test')`,
      [ORG_A, ORG_B]
    );
    for (const [userId, organizationId, role] of [
      [OWNER_A, ORG_A, 'owner'], [ADMIN_A, ORG_A, 'admin'], [MEMBER_A, ORG_A, 'member'],
      [VIEWER_A, ORG_A, 'viewer'], [OWNER_B, ORG_B, 'owner'],
    ]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, organizationId, role, userId + '@m20-part2g.test', role]
      );
    }
    const { putBusinessProfile, getActiveBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: OWNER_A, expectedVersion: null,
      profile: profileFor('Provider Neutral Company', INITIAL),
    });
    const otherAuthority = await putBusinessProfile(pool, {
      organizationId: ORG_B, userId: OWNER_B, expectedVersion: null,
      profile: profileFor('Other Tenant Company', INITIAL),
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
    browser = await browserType.launch({ headless: true, executablePath });

    const ownerInput = { role: 'owner-write', viewport: { width: 1280, height: 900 }, theme: 'light' };
    const ownerContext = await contextFor(browser, origin, sessions.owner, ownerInput, ledger);
    const ownerPage = await ownerContext.newPage();
    attachPage(ownerPage, ledger, ownerInput.role);
    await openNeutralProfile(ownerPage, origin, 'Provider Neutral Company');
    await ownerPage.locator('#profile-industry').fill(EDITED.industry);
    await ownerPage.locator('#profile-ownerName').fill(EDITED.ownerName);
    await ownerPage.locator('#profile-businessDescription').fill(EDITED.businessDescription);
    await ownerPage.locator('#profile-emergencyPolicy').fill(EDITED.emergencyPolicy);
    const faqFields = ownerPage.locator('#faqContainer .faq-value');
    await faqFields.nth(0).fill(EDITED.faq[0]);
    await faqFields.nth(1).fill(EDITED.faq[1]);
    const valueFields = ownerPage.locator('#companyValuesContainer .company-value');
    await valueFields.nth(0).fill(EDITED.companyValues[0]);
    await valueFields.nth(1).fill(EDITED.companyValues[1]);
    await ownerPage.locator('#profile-customPrompt').fill(EDITED.customPrompt);
    await ownerPage.locator('#voice-assistant-name').fill(EDITED.name);
    await ownerPage.locator('#voice-assistant-style').fill(EDITED.style);
    await ownerPage.locator('#voice-assistant-greeting').fill(INITIAL.greeting);
    await ownerPage.locator('#voice-assistant-personality').selectOption(EDITED.personality);
    await ownerPage.locator('#voice-assistant-conversation-style').selectOption(EDITED.conversationStyle);
    for (const rule of EDITED.rules) {
      const card = ownerPage.locator(`#voice-escalation-rules [data-rule-id="${rule.id}"]`);
      await card.locator('.voice-rule-enabled').setChecked(rule.enabled);
      await card.locator('.voice-rule-when').fill(rule.when);
      await card.locator('.voice-rule-action').selectOption(rule.action);
      await card.locator('.voice-rule-fallbackAction').selectOption(rule.fallbackAction);
    }
    await ownerPage.locator('#voice-escalation-rules [data-rule-id="voice-rule-alpha"] [data-rule-action="down"]').click();
    const ownerVoiceSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/voiceAssistant' && response.request().method() === 'PUT');
    await ownerPage.locator('#saveVoiceAssistantBtn').click();
    const ownerVoiceResponse = await ownerVoiceSave;
    assert.strictEqual(ownerVoiceResponse.status(), 200, 'owner saves versioned voice authority');
    const ownerVoiceBody = ownerVoiceResponse.request().postDataJSON();
    assert.deepStrictEqual(Object.keys(ownerVoiceBody).sort(), ['expectedVersion', 'value']);
    assert.match(ownerVoiceBody.expectedVersion, /^org-profile-v[1-9][0-9]*$/);
    assert.deepStrictEqual(ownerVoiceBody.value, {
      name: EDITED.name,
      style: EDITED.style,
      greeting: INITIAL.greeting,
      personality: EDITED.personality,
      conversationStyle: EDITED.conversationStyle,
      escalationRules: { rules: EDITED.rules },
    });
    const ownerProfileSave = ownerPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile' && response.request().method() === 'PUT');
    await ownerPage.locator('#saveBtn').click();
    assert.strictEqual((await ownerProfileSave).status(), 200, 'owner saves preserved non-voice authority');
    await ownerContext.close();

    const adminInput = { role: 'admin-write', viewport: { width: 1280, height: 900 }, theme: 'dark' };
    const adminContext = await contextFor(browser, origin, sessions.admin, adminInput, ledger);
    const adminPage = await adminContext.newPage();
    attachPage(adminPage, ledger, adminInput.role);
    await openNeutralProfile(adminPage, origin, 'Provider Neutral Company');
    await adminPage.locator('#voice-assistant-greeting').fill(EDITED.greeting);
    const adminSave = adminPage.waitForResponse(response =>
      response.url() === origin + '/api/v1/business-profile/voiceAssistant' && response.request().method() === 'PUT');
    await adminPage.locator('#saveVoiceAssistantBtn').click();
    assert.strictEqual((await adminSave).status(), 200, 'admin saves versioned voice authority');
    await adminContext.close();

    const viewports = [
      { name: 'desktop', value: { width: 1280, height: 900 } },
      { name: 'mobile', value: { width: 390, height: 844 } },
    ];
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      for (const viewport of viewports) {
        for (const theme of ['light', 'dark']) {
          await lifecycle(browser, origin, sessions[role], {
            role: role + '-' + viewport.name + '-' + theme,
            viewport: viewport.value,
            theme,
            expected: EDITED,
          }, ledger);
        }
      }
    }

    const authority = await getActiveBusinessProfile(pool, ORG_A);
    const raw = await pool.query(
      `SELECT
         encode(convert_to(raw_profile ->> 'industry', 'UTF8'), 'hex') AS industry_hex,
         encode(convert_to(raw_profile ->> 'ownerName', 'UTF8'), 'hex') AS owner_hex,
         encode(convert_to(raw_profile ->> 'businessDescription', 'UTF8'), 'hex') AS description_hex,
         encode(convert_to(raw_profile ->> 'emergencyPolicy', 'UTF8'), 'hex') AS emergency_hex,
         encode(convert_to(raw_profile #>> '{faq,0}', 'UTF8'), 'hex') AS faq0_hex,
         encode(convert_to(raw_profile #>> '{faq,1}', 'UTF8'), 'hex') AS faq1_hex,
         encode(convert_to(raw_profile #>> '{companyValues,0}', 'UTF8'), 'hex') AS value0_hex,
         encode(convert_to(raw_profile #>> '{companyValues,1}', 'UTF8'), 'hex') AS value1_hex,
         encode(convert_to(raw_profile ->> 'customPrompt', 'UTF8'), 'hex') AS prompt_hex,
         encode(convert_to(raw_profile #>> '{voiceAssistant,name}', 'UTF8'), 'hex') AS assistant_hex,
         encode(convert_to(raw_profile #>> '{voiceAssistant,style}', 'UTF8'), 'hex') AS style_hex,
         encode(convert_to(raw_profile #>> '{voiceAssistant,greeting}', 'UTF8'), 'hex') AS greeting_hex,
         raw_profile #>> '{voiceAssistant,personality}' AS personality,
         raw_profile #>> '{voiceAssistant,conversationStyle}' AS conversation_style,
         raw_profile #> '{voiceAssistant,escalationRules,rules}' AS escalation_rules,
         encode(convert_to(raw_profile #>> '{voiceAssistant,escalationRules,rules,0,when}', 'UTF8'), 'hex') AS escalation_when_hex,
         raw_profile -> 'retell' AS legacy_retell
       FROM canonical_business_profiles WHERE id = $1`,
      [authority.id]
    );
    assert.deepStrictEqual(raw.rows, [{
      industry_hex: Buffer.from(EDITED.industry, 'utf8').toString('hex'),
      owner_hex: Buffer.from(EDITED.ownerName, 'utf8').toString('hex'),
      description_hex: Buffer.from(EDITED.businessDescription, 'utf8').toString('hex'),
      emergency_hex: Buffer.from(EDITED.emergencyPolicy, 'utf8').toString('hex'),
      faq0_hex: Buffer.from(EDITED.faq[0], 'utf8').toString('hex'),
      faq1_hex: Buffer.from(EDITED.faq[1], 'utf8').toString('hex'),
      value0_hex: Buffer.from(EDITED.companyValues[0], 'utf8').toString('hex'),
      value1_hex: Buffer.from(EDITED.companyValues[1], 'utf8').toString('hex'),
      prompt_hex: Buffer.from(EDITED.customPrompt, 'utf8').toString('hex'),
      assistant_hex: Buffer.from(EDITED.name, 'utf8').toString('hex'),
      style_hex: Buffer.from(EDITED.style, 'utf8').toString('hex'),
      greeting_hex: Buffer.from(EDITED.greeting, 'utf8').toString('hex'),
      personality: EDITED.personality,
      conversation_style: EDITED.conversationStyle,
      escalation_rules: EDITED.rules,
      escalation_when_hex: Buffer.from(EDITED.rules[0].when, 'utf8').toString('hex'),
      legacy_retell: LEGACY,
    }]);
    assert.strictEqual((await getActiveBusinessProfile(pool, ORG_B)).id, otherAuthority.id, 'other tenant unchanged');
    assert.deepStrictEqual(ledger.providers, [], 'provider requests remain zero');
    assert.deepStrictEqual(ledger.external, [], 'unexpected external requests remain zero');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'unexpected console errors remain zero');
    assert.deepStrictEqual(ledger.pageErrors, [], 'page errors remain zero');
    assert.ok(ledger.requests.every(entry => entry.authorization === null), 'browser sends no Authorization headers');
    assert.strictEqual(ledger.requests.filter(entry =>
      (entry.role.startsWith('member') || entry.role.startsWith('viewer')) &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method)).length, 0, 'read-only role writes remain zero');

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      version: browser.version(),
      database: suiteDatabase.databaseName,
      roles: ['owner', 'admin', 'member', 'viewer'],
      viewports: ['desktop', 'mobile'],
      themes: ['light', 'dark'],
      cartesianCombinations: 16,
      lifecycle: ['initial', 'rerender', 'reload'],
      ownerWrites: ledger.requests.filter(entry => entry.role === 'owner-write' && entry.method === 'PUT').length,
      adminWrites: ledger.requests.filter(entry => entry.role === 'admin-write' && entry.method === 'PUT').length,
      memberWrites: 0,
      viewerWrites: 0,
      providerRequests: ledger.providers.length,
      providerActions: 0,
      rawPostgresBytes: 'exact',
      legacyProviderSection: 'preserved_read_only',
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
