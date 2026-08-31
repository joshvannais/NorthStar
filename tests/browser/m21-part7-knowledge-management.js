'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { provisionDurableSession } = require('../helpers/account-session-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { buildDemoWorkspace, createInitialDemoState } = require('../../src/commandCenter/workspace');

const ROOT = path.resolve(__dirname, '..', '..');
const ORG = '73000000-0000-4000-8000-000000000001';
const OWNER = '74000000-0000-4000-8000-000000000001';
const MEMBER = '74000000-0000-4000-8000-000000000002';
const HOSTILE = '</script><img src=x onerror="window.__part7Xss++">\u202eKnowledge';

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function profileFor(name) {
  const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'business-profile.json'), 'utf8'));
  const canonical = canonicalFenceProfile({ companyName: name });
  profile.company = {
    ...profile.company,
    ...canonical.company,
    name,
    email: 'owner@part7-browser.test',
    phone: '(555) 010-7000',
    timeZone: 'America/New_York',
    currency: 'USD',
  };
  profile.industry = 'Home services';
  profile.businessDescription = 'Mission 21 Part 7 browser authority.';
  profile.headquarters = {
    street: '7 NorthStar Way', city: 'Asheville', state: 'NC', zip: '28801', country: 'US',
    latitude: 35.5951, longitude: -82.5515, additionalOffices: [],
  };
  profile.routing = { dispatchFrom: 'headquarters', trafficEnabled: false };
  profile.serviceArea = { maxRadiusMiles: 30, maxTravelMinutes: null, primaryTerritory: '', polygon: [] };
  profile.hours = { monday: { open: '08:00', close: '17:00' }, holidays: [] };
  profile.services = canonical.services;
  profile.canonicalPricing = canonical.canonicalPricing;
  profile.canonicalCosts = canonical.canonicalCosts;
  profile.crew = { ...profile.crew, ...canonical.crew };
  profile.voiceAssistant = {
    name: 'NorthStar Office Manager', greeting: 'Thank you for calling.', personality: 'professional',
  };
  return profile;
}

function draft(actorUserId, canonicalKey, options = {}) {
  return {
    organizationId: ORG,
    actorUserId,
    canonicalKey,
    entryType: options.entryType || 'fact',
    label: options.label || canonicalKey,
    sensitivity: options.sensitivity || 'internal',
    reviewRequirement: options.reviewRequirement || 'standard',
    origin: options.origin || 'human',
    applicability: options.applicability || { projection: { audiences: ['customer'] } },
    content: options.content || { state: 'ready', facts: { value: canonicalKey } },
    reason: options.reason || `Create ${canonicalKey} for the Part 7 browser matrix.`,
    provenance: options.provenance || [{
      sourceType: options.sourceType || 'human_input',
      sourceRecordId: `m21-p7-browser:${canonicalKey}`,
      sourceVersion: '1',
      sourceDigest: sha256(`m21-p7-browser:${canonicalKey}:1`),
      jsonPointer: '',
    }],
  };
}

function workflow(created, actorUserId, reason, overrides = {}) {
  return {
    organizationId: ORG,
    actorUserId,
    entryId: created.id,
    versionId: created.version.id,
    versionNumber: created.version.number,
    canonicalDigest: created.version.canonicalDigest,
    expectedReviewEventId: null,
    reason,
    ...overrides,
  };
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

function demoWorkspace() {
  const createdAt = new Date('2026-08-25T14:00:00.000Z');
  const tenantId = '75000000-0000-4000-8000-000000000001';
  return buildDemoWorkspace({
    tenantId,
    sessionId: '76000000-0000-4000-8000-000000000001',
    state: createInitialDemoState(tenantId, createdAt),
    revision: 7,
    expiresAt: new Date('2026-08-26T14:00:00.000Z'),
    simulationCount: 0,
    persisted: true,
  });
}

async function contextFor(browser, origin, session, input, ledger, demo = false) {
  const context = await browser.newContext({ viewport: input.viewport, colorScheme: input.theme });
  await context.addInitScript(theme => {
    window.__part7Xss = 0;
    localStorage.setItem('northstar-theme', theme);
  }, input.theme);
  if (session) {
    await context.addCookies([
      { name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
      { name: 'northstar_csrf', value: session.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
    ]);
  }
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (demo && request.method() === 'GET' && url.pathname === '/api/demo/command-center') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ success: true, data: demoWorkspace() }),
      });
    }
    if (url.origin === origin) return route.continue();
    if (/fonts\.googleapis|fonts\.gstatic/.test(url.hostname)) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    }
    ledger.external.push({ role: input.role, method: request.method(), url: request.url() });
    return route.fulfill({ status: 204, body: '' });
  });
  context.on('request', request => {
    const url = new URL(request.url());
    ledger.requests.push({
      role: input.role,
      method: request.method(),
      path: url.pathname,
      authorization: request.headers().authorization || null,
    });
  });
  return context;
}

function attachPage(page, ledger, role) {
  page.on('response', response => {
    if (response.status() >= 400) console.error(`${role} response ${response.status()}: ${response.url()}`);
  });
  page.on('pageerror', error => {
    ledger.pageErrors.push(`${role}: ${error.message}`);
    console.error(`${role} pageerror: ${error.message}`);
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (/409 \(Conflict\)/.test(message.text())) ledger.expectedConsole.push(`${role}: ${message.text()}`);
    else ledger.consoleErrors.push(`${role}: ${message.text()}`);
  });
}

async function waitForKnowledge(page) {
  try {
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-knowledge-management]');
      return root && root.dataset.state === 'ready' && root.querySelector('[data-km-detail] h3');
    });
  } catch (error) {
    const diagnostic = await page.evaluate(() => {
      const root = document.querySelector('[data-knowledge-management]');
      return root ? { state: root.dataset.state, text: root.textContent.slice(0, 1000) } : { state: 'missing' };
    });
    throw new Error(`${error.message}; knowledge diagnostic: ${JSON.stringify(diagnostic)}`);
  }
}

async function openSettings(page, origin, demo = false) {
  await page.goto(origin + (demo ? '/demo/settings' : '/dashboard/settings'), { waitUntil: 'domcontentloaded' });
  await waitForKnowledge(page);
  await page.locator('[data-knowledge-management]').scrollIntoViewIfNeeded();
}

async function openProfile(page, origin, demo = false) {
  await page.goto(origin + (demo ? '/demo/business-profile' : '/dashboard/business-profile') +
    '?section=knowledge#knowledge-management', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const profile = document.getElementById('businessProfileRoot');
    const section = document.getElementById('section-knowledge');
    const root = document.querySelector('[data-knowledge-management]');
    return profile && profile.dataset.state === 'ready' && section && section.classList.contains('active') &&
      root && root.dataset.state === 'ready' && root.querySelector('[data-km-detail] h3');
  });
  await page.locator('[data-knowledge-management]').scrollIntoViewIfNeeded();
}

async function assertNoOverflow(page) {
  const overflow = await page.evaluate(() => {
    const root = document.querySelector('[data-knowledge-management]');
    return {
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      knowledge: root.scrollWidth - root.clientWidth,
    };
  });
  assert.ok(overflow.document <= 1, `document horizontal overflow: ${overflow.document}`);
  assert.ok(overflow.knowledge <= 1, `knowledge horizontal overflow: ${overflow.knowledge}`);
}

async function assertTextContrast(page, selector, label) {
  const sample = await page.locator(selector).first().evaluate(element => {
    const parse = value => {
      const match = String(value).match(/^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?\)$/);
      if (!match) throw new Error(`Unsupported computed color: ${value}`);
      return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
    };
    const blend = (foreground, background) => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      return [0, 1, 2].map(index => (
        foreground[index] * foreground[3] + background[index] * background[3] * (1 - foreground[3])
      ) / alpha).concat(alpha);
    };
    let background = [255, 255, 255, 1];
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) ancestors.push(node);
    for (const node of ancestors.reverse()) {
      const layer = parse(getComputedStyle(node).backgroundColor);
      if (layer[3] > 0) background = blend(layer, background);
    }
    const foreground = blend(parse(getComputedStyle(element).color), background);
    const component = value => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = rgb => 0.2126 * component(rgb[0]) + 0.7152 * component(rgb[1]) + 0.0722 * component(rgb[2]);
    const first = luminance(foreground);
    const second = luminance(background);
    return {
      foreground: foreground.slice(0, 3),
      background: background.slice(0, 3),
      ratio: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
    };
  });
  assert.ok(sample.ratio >= 4.5, `${label} contrast ${sample.ratio}`);
  return sample;
}

async function assertReducedMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.strictEqual(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  const transitionDuration = await page.locator('.km-item-button').first().evaluate(element =>
    getComputedStyle(element).transitionDuration
  );
  assert.match(transitionDuration, /^(0s(?:, 0s)*)$/);
}

async function selectItem(page, label) {
  const button = page.locator('.km-item-button').filter({ hasText: label }).first();
  await button.click();
  await page.waitForFunction(expected => {
    const heading = document.querySelector('[data-km-detail] h3');
    return heading && heading.textContent === expected;
  }, label);
  return button;
}

async function openAdvancedEvidence(page) {
  const disclosure = page.locator('.km-advanced-evidence');
  if (!(await disclosure.getAttribute('open'))) {
    await disclosure.getByText('Advanced evidence', { exact: true }).click();
  }
  await page.getByRole('tab').first().waitFor({ state: 'visible' });
}

async function openDialogWithReorderedDetail(page, staleEntryId, targetLabel, actionName, prepare) {
  let release;
  let observed;
  const gate = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { observed = resolve; });
  const stalePath = `/api/v1/knowledge-management/items/${staleEntryId}`;
  await page.route(url => new URL(url).pathname === stalePath, async route => {
    observed();
    await gate;
    await route.continue();
  }, { times: 1 });
  await page.locator(`.km-item-button[data-entry-id="${staleEntryId}"]`).click();
  await seen;
  const targetButton = await selectItem(page, targetLabel);
  await openAdvancedEvidence(page);
  if (prepare) await prepare();
  const opener = page.getByRole('button', { name: actionName, exact: true }).first();
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible' });
  const staleResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === stalePath && response.request().method() === 'GET');
  release();
  assert.strictEqual((await staleResponse).status(), 200);
  await page.waitForTimeout(25);
  assert.strictEqual(await targetButton.getAttribute('aria-current'), 'true');
  assert.strictEqual(await page.locator('[data-km-detail] h3').textContent(), targetLabel);
  const evidenceLabel = targetLabel === 'Business identity' ? 'Generated business identity' : targetLabel;
  assert.match(await dialog.textContent(), new RegExp(evidenceLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return dialog;
}

async function activateTab(page, name) {
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await page.waitForFunction(expected => Array.from(document.querySelectorAll('[role="tab"]')).some(element =>
    element.textContent.trim() === expected && element.getAttribute('aria-selected') === 'true'
  ), name);
  assert.strictEqual(await tab.getAttribute('aria-selected'), 'true');
  return tab;
}

async function screenshot(page, directory, filename) {
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, filename), fullPage: true, animations: 'disabled' });
}

async function assertP4OwnerSurfaces(page, origin, directory, browserName) {
  await page.goto(origin + '/dashboard/ai-settings', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/dashboard\/settings#ai-settings$/);
  await page.waitForFunction(() => document.getElementById('settingsRoleBadge').textContent.includes('Owner'));
  assert.strictEqual(await page.locator('.notification-preference-grid').evaluate(element =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  ), 2);
  assert.strictEqual(await page.locator('#saveSettingsBtn').isDisabled(), true);
  await page.locator('.integration-card').filter({ has: page.locator('#emailEnabled') }).locator('label.toggle').click();
  assert.strictEqual(await page.locator('#northstarStickySaveBar').isVisible(), true);
  assert.match(await page.locator('#northstarStickySaveBar').textContent(), /Unsaved changes.*Editable.*Owner/s);
  await screenshot(page, directory, `${browserName}-settings-owner-dirty.png`);
  await page.evaluate(async () => {
    const current = await NorthStarAccountSession.json('/api/account/preferences', { method: 'GET' });
    const preferences = current.preferences;
    await NorthStarAccountSession.json('/api/account/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailEnabled: preferences.emailEnabled,
        emailCallSummary: !preferences.emailCallSummary,
        emailAppointment: preferences.emailAppointment,
        smsEnabled: preferences.smsEnabled,
        smsUrgent: preferences.smsUrgent,
        emailAddress: preferences.emailAddress,
        smsNumber: preferences.smsNumber,
        expectedVersion: current.version,
      }),
    });
  });
  await page.locator('#saveSettingsBtn').click();
  await page.waitForFunction(() => document.getElementById('settingsDirtyStatus').dataset.state === 'conflict');
  assert.strictEqual(await page.locator('#reloadSettingsBtn').isVisible(), true);
  assert.match(await page.locator('#northstarStickySaveBar').textContent(), /Conflict detected.*reload.*Editable.*Owner/s);
  await screenshot(page, directory, `${browserName}-settings-owner-conflict.png`);

  await page.goto(origin + '/dashboard/my-number', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/dashboard\/business-profile\?section=company#business-number$/);
  await page.waitForFunction(() => document.getElementById('businessProfileRoot').dataset.state === 'ready');
  assert.strictEqual(await page.locator('.bp-nav-group').count(), 7);
  assert.strictEqual(await page.locator('.bp-title').textContent(), 'Business Profile');
  assert.match(await page.locator('#businessProfileRole').textContent(), /Editable.*Owner/);
  assert.strictEqual(await page.locator('#business-number').evaluate(element => element === document.activeElement), true);
  await page.getByLabel('Find a setup section in the checklist').fill('knowledge');
  const visibleSetupMatches = await page.locator('.bp-nav-btn:not([hidden])').allTextContents();
  assert.ok(visibleSetupMatches.length >= 1 && visibleSetupMatches.every(value => /knowledge/i.test(value)));
  await screenshot(page, directory, `${browserName}-business-profile-seven-group-search.png`);

  await page.goto(origin + '/dashboard/integrations', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('integrationCatalogueRoot').dataset.state === 'ready' &&
    document.getElementById('mapPreferencesRoot').dataset.state === 'ready');
  assert.strictEqual(await page.locator('.integration-category-details').count(), 7);
  assert.strictEqual(await page.locator('.map-preference-scope').count(), 2);
  const planned = page.locator('.integration-category[data-availability="planned"]');
  assert.ok(await planned.count() >= 1);
  assert.strictEqual(await planned.locator('details').first().getAttribute('open'), null);
  await planned.locator('summary').first().click();
  assert.notStrictEqual(await planned.locator('details').first().getAttribute('open'), null);
  assert.strictEqual(await page.locator('#mapPreferencesOrganization').getAttribute('open') !== null, true);
  assert.strictEqual(await page.locator('#mapPreferencesUser').getAttribute('open') !== null, true);
  await screenshot(page, directory, `${browserName}-integrations-disclosures.png`);

  await page.goto(origin + '/dashboard/team', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('workforceSummary').textContent.includes('People'));
  assert.strictEqual(await page.locator('#workforceSummary').count(), 1);
  assert.ok(await page.locator('.wf-shell').evaluate(element =>
    element.getBoundingClientRect().width / element.parentElement.getBoundingClientRect().width >= 0.9
  ));
  await screenshot(page, directory, `${browserName}-team-summary-full-width.png`);
}

async function run() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  const evidenceDirectory = process.env.M21_PART7_EVIDENCE_DIR || '';
  const p4EvidenceDirectory = process.env.PRE_M23_P4_EVIDENCE_DIR || '';
  const { browserType, executablePath } = resolveBrowserRuntime(selected);
  const original = new Map();
  for (const name of [
    'DATABASE_URL', 'NODE_ENV', 'AUTH_ACCESS_SECRET', 'RETELL_API_KEY', 'RETELL_AGENT_ID',
    'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY',
    'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  ]) original.set(name, process.env[name]);
  const suiteDatabase = await createSuiteDatabase(`m21-p7-browser-${selected}`);
  let browser;
  let server;
  let db;
  let originalFetch;
  let originalHttpsRequest;
  const providerActions = [];
  const ledger = { requests: [], external: [], consoleErrors: [], expectedConsole: [], pageErrors: [] };
  try {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.AUTH_ACCESS_SECRET = crypto.randomBytes(48).toString('hex');
    for (const name of [
      'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
      'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
    ]) delete process.env[name];
    originalFetch = global.fetch;
    global.fetch = function () {
      providerActions.push('fetch');
      throw new Error('Provider transport reached during Part 7 browser validation.');
    };
    originalHttpsRequest = https.request;
    https.request = function () {
      providerActions.push('https.request');
      throw new Error('Provider HTTPS reached during Part 7 browser validation.');
    };

    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true);
    const pool = db.getPool();
    const databaseIdentity = (await pool.query(
      "SELECT current_setting('server_version') AS version, current_setting('TimeZone') AS timezone, current_setting('data_checksums') AS checksums"
    )).rows[0];
    assert.deepStrictEqual(databaseIdentity, { version: '18.4', timezone: 'UTC', checksums: 'on' });
    await pool.query(
      "INSERT INTO organizations(id,name,email) VALUES ($1,'Part 7 Browser Company','part7-browser@example.test')",
      [ORG]
    );
    for (const [userId, role] of [[OWNER, 'owner'], [MEMBER, 'member']]) {
      await pool.query(
        `INSERT INTO users(id,organization_id,name,email,password_hash,role,status)
         VALUES ($1,$2,$3,$4,'not-used',$5,'active')`,
        [userId, ORG, `Part 7 ${role}`, `${role}@part7-browser.test`, role]
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG,
      userId: OWNER,
      profile: profileFor('Part 7 Browser Company'),
      expectedVersion: null,
    });
    const sessions = {
      owner: await provisionDurableSession(pool, { userId: OWNER, organizationId: ORG, role: 'owner' }),
      member: await provisionDurableSession(pool, { userId: MEMBER, organizationId: ORG, role: 'member' }),
    };
    await pool.query(
      `INSERT INTO notification_preferences(
         id, organization_id, email_new_lead, email_call_summary,
         email_appointment, sms_new_lead, sms_urgent,
         notification_email, notification_phone
       ) VALUES ($1,$2,FALSE,FALSE,FALSE,FALSE,FALSE,$3,$4)`,
      [crypto.randomUUID(), ORG, 'owner@part7-browser.test', '(555) 010-7000']
    );
    await pool.query(
      `INSERT INTO organization_account_preferences(organization_id, preferences)
       VALUES ($1, $2::jsonb)`,
      [ORG, JSON.stringify({ companyName: 'Part 7 Browser Company', companyInfo: 'Mounted paid preferences.' })]
    );

    const knowledge = require('../../src/knowledge/repository');
    const identity = await knowledge.createInitialKnowledgeDraft(pool, draft(OWNER, 'organization.identity', {
      label: 'Generated business identity',
      origin: 'generated',
      sourceType: 'business_profile',
      content: { state: 'ready', facts: { company: { name: 'Part 7 Browser Company' } } },
    }));
    const identitySubmitted = await knowledge.submitKnowledgeVersionForReview(
      pool, workflow(identity, OWNER, 'Review initial browser identity.')
    );
    const identityApproved = await knowledge.approveKnowledgeVersion(
      pool, workflow(identity, OWNER, 'Approve initial browser identity.', { expectedReviewEventId: identitySubmitted.event.id })
    );
    const identityPublication = await knowledge.publishKnowledgeVersion(
      pool, workflow(identity, OWNER, 'Publish initial browser identity.', {
        expectedReviewEventId: identityApproved.event.id,
        expectedPublicationId: null,
        expectedPublicationNumber: 0,
      })
    );
    const { KnowledgeSynchronizationRepository } = require('../../src/knowledge/synchronizationRepository');
    const sync = new KnowledgeSynchronizationRepository(pool);
    const configured = await sync.configureTarget({
      organizationId: ORG,
      actorUserId: OWNER,
      providerKey: 'intercepted.part7-browser-preview',
      consumer: 'voice_runtime',
      audience: 'customer',
      capabilities: ['identity'],
      maximumEntries: 8,
      maximumBytes: 32768,
      staleAfterSeconds: 300,
    });
    const claimed = (await sync.claimJobs({ batchSize: 1, leaseSeconds: 30 }))[0];
    assert.ok(claimed && claimed.claimToken);
    const verified = await sync.verifyJobProjection({ organizationId: ORG, id: claimed.id, claimToken: claimed.claimToken });
    assert.ok(verified);
    const drifted = await sync.finalizeJob({
      organizationId: ORG,
      id: claimed.id,
      claimToken: claimed.claimToken,
      accepted: true,
      observedProjectionDigest: 'f'.repeat(64),
    });
    assert.strictEqual(drifted.drift, true);
    const identityRevision = await knowledge.createKnowledgeRevision(pool, {
      ...draft(OWNER, 'organization.identity', {
        label: 'Generated business identity',
        origin: 'generated',
        sourceType: 'business_profile',
        content: { state: 'ready', facts: { company: { name: `Part 7 ${HOSTILE}` } } },
        provenance: [{
          sourceType: 'business_profile', sourceRecordId: 'm21-p7-browser:profile',
          sourceVersion: 'org-profile-v1', sourceDigest: sha256('m21-p7-browser:profile:v1'),
          jsonPointer: '/company/name',
        }],
      }),
      entryId: identity.id,
      expectedVersionId: identity.version.id,
      expectedVersionNumber: identity.version.number,
      expectedCanonicalDigest: identity.version.canonicalDigest,
      reason: 'Generate a deterministic identity revision.',
    });
    const lifecycle = await knowledge.createInitialKnowledgeDraft(pool, draft(OWNER, 'human.workflow', {
      label: 'Workflow lifecycle item',
      entryType: 'faq',
      content: { state: 'ready', facts: { answer: 'A durable human answer.' } },
    }));
    const stale = await knowledge.createInitialKnowledgeDraft(pool, draft(OWNER, 'human.stale', {
      label: 'Stale conflict item', entryType: 'guidance',
    }));
    const changesRace = await knowledge.createInitialKnowledgeDraft(pool, draft(OWNER, 'human.changes-race', {
      label: 'Changes request race item', entryType: 'guidance',
    }));
    await knowledge.submitKnowledgeVersionForReview(
      pool, workflow(changesRace, OWNER, 'Submit the changes-request race item.')
    );
    const revisionRace = await knowledge.createInitialKnowledgeDraft(pool, draft(OWNER, 'human.revision-race', {
      label: 'Direct revision race item', entryType: 'faq',
    }));
    const unresolved = await knowledge.createInitialKnowledgeDraft(pool, draft(OWNER, 'generated.unresolved', {
      label: 'Unresolved evidence item',
      entryType: 'guidance',
      origin: 'generated',
      sourceType: 'system_generation',
      content: { state: 'needs_review', facts: { guidance: 'Evidence is unresolved.' } },
    }));
    await knowledge.createInitialKnowledgeDraft(pool, draft(OWNER, 'organization.legal-disclosure', {
      label: 'Attorney-gated disclosure',
      entryType: 'disclosure',
      sensitivity: 'legal',
      reviewRequirement: 'attorney_gated',
      content: { state: 'ready', facts: { disclosure: 'Protected legal bytes.' } },
    }));
    const retryConfigured = await sync.configureTarget({
      organizationId: ORG,
      actorUserId: OWNER,
      providerKey: 'intercepted.part7-browser-retry',
      consumer: 'voice_runtime',
      audience: 'customer',
      capabilities: ['identity'],
      maximumEntries: 8,
      maximumBytes: 32768,
      staleAfterSeconds: 300,
    });
    const retryJobs = await sync.claimJobs({ batchSize: 10, leaseSeconds: 30 });
    const retryJob = retryJobs.find(job => job.targetId === retryConfigured.target.id);
    assert.ok(retryJob && retryJob.claimToken);
    const retryState = await sync.finalizeJob({
      organizationId: ORG,
      id: retryJob.id,
      claimToken: retryJob.claimToken,
      accepted: false,
      diagnosticCategory: 'provider_unavailable',
    });
    assert.strictEqual(retryState.state, 'retry');
    assert.strictEqual(retryState.job.diagnosticCategory, 'provider_unavailable');

    const { app } = require('../../src/server');
    server = await listen(app);
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await browserType.launch({ headless: true, executablePath });

    const ownerLightContext = await contextFor(browser, origin, sessions.owner, {
      role: 'paid-owner-desktop-light', viewport: { width: 1440, height: 1000 }, theme: 'light',
    }, ledger);
    const ownerLight = await ownerLightContext.newPage();
    attachPage(ownerLight, ledger, 'paid-owner-desktop-light');
    await openSettings(ownerLight, origin);
    assert.strictEqual(await ownerLight.locator('[data-km-mode]').isHidden(), true);
    assert.strictEqual((await ownerLight.locator('[data-knowledge-management]').textContent()).includes('Demo preview'), false);
    assert.strictEqual(await ownerLight.locator('.km-item-button').count(), 7);
    assert.strictEqual(await ownerLight.evaluate(() => window.__part7Xss), 0);
    await assertNoOverflow(ownerLight);
    await screenshot(ownerLight, evidenceDirectory, `${selected}-settings-desktop-light-main.png`);

    await selectItem(ownerLight, 'Business identity');
    await openAdvancedEvidence(ownerLight);
    const tabs = ownerLight.getByRole('tab');
    await tabs.first().focus();
    await ownerLight.keyboard.press('End');
    assert.strictEqual(await tabs.last().getAttribute('aria-selected'), 'true');
    assert.strictEqual(await tabs.last().evaluate(element => element === document.activeElement), true);
    await activateTab(ownerLight, 'Changes & provenance');
    assert.match(await ownerLight.locator('[role="tabpanel"]:visible').textContent(), /Deterministic comparison/);
    assert.match(await ownerLight.locator('[role="tabpanel"]:visible').textContent(), /Pinned provenance/);
    await screenshot(ownerLight, evidenceDirectory, `${selected}-settings-desktop-light-diff-provenance.png`);
    await activateTab(ownerLight, 'Lifecycle history');
    assert.match(await ownerLight.locator('[role="tabpanel"]:visible').textContent(), /Version 1/);
    assert.match(await ownerLight.locator('[role="tabpanel"]:visible').textContent(), /Version 2/);
    await screenshot(ownerLight, evidenceDirectory, `${selected}-settings-desktop-light-lifecycle.png`);
    let dialog = await openDialogWithReorderedDetail(
      ownerLight, stale.id, 'Business identity', 'Reconcile exact target',
      async () => activateTab(ownerLight, 'Synchronization')
    );
    assert.match(await ownerLight.locator('[role="tabpanel"]:visible').textContent(), /Drift detected/);
    assert.match(await ownerLight.locator('[role="tabpanel"]:visible').textContent(), /intercepted\.part7-browser-preview/);
    assert.match(await dialog.textContent(), /does not call a provider now or claim a live connection/);
    const reconcileResponse = ownerLight.waitForResponse(response =>
      response.url().includes('/synchronization/') && response.url().endsWith('/reconcile') &&
      response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Queue reconciliation' }).click();
    assert.strictEqual((await reconcileResponse).status(), 201);
    await ownerLight.waitForFunction(() => !document.querySelector('dialog.km-dialog'));
    const reconciledState = await sync.getTargetState({ organizationId: ORG, actorUserId: OWNER, targetId: configured.target.id });
    assert.ok(['drift', 'pending', 'retry'].includes(reconciledState.state.status));

    dialog = await openDialogWithReorderedDetail(
      ownerLight, stale.id, 'Business identity', 'Retry exact target',
      async () => activateTab(ownerLight, 'Synchronization')
    );
    const retryResponse = ownerLight.waitForResponse(response =>
      response.url().includes(`/synchronization/${retryConfigured.target.id}/retry`) &&
      response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Queue retry' }).click();
    assert.strictEqual((await retryResponse).status(), 201);
    await ownerLight.waitForFunction(() => !document.querySelector('dialog.km-dialog'));

    dialog = await openDialogWithReorderedDetail(
      ownerLight, stale.id, 'Changes request race item', 'Request changes'
    );
    await dialog.getByLabel('Reason').fill('Request exact changes without accepting a stale detail response.');
    const changesResponse = ownerLight.waitForResponse(value =>
      value.url().endsWith(`/items/${changesRace.id}/changes`) && value.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Request changes' }).click();
    assert.strictEqual((await changesResponse).status(), 201);
    await ownerLight.waitForFunction(() => !document.querySelector('dialog.km-dialog'));

    dialog = await openDialogWithReorderedDetail(
      ownerLight, stale.id, 'Direct revision race item', 'Create revision'
    );
    await dialog.getByLabel('Reason').fill('Create the exact captured revision without stale retargeting.');
    await dialog.getByLabel('Revised knowledge content (JSON)').fill(JSON.stringify({
      state: 'ready', facts: { answer: 'Captured revision remains on the intended item.' },
    }));
    await dialog.getByLabel('Human source record ID').fill('m21-p7-browser:revision-race:2');
    await dialog.getByLabel('Human source version').fill('2');
    await dialog.getByLabel('Human source SHA-256 digest').fill(sha256('m21-p7-browser:revision-race:2'));
    const revisionResponse = ownerLight.waitForResponse(value =>
      value.url().endsWith(`/items/${revisionRace.id}/revise`) && value.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Create an immutable revision' }).click();
    assert.strictEqual((await revisionResponse).status(), 201);
    await ownerLight.waitForFunction(() => !document.querySelector('dialog.km-dialog'));

    await selectItem(ownerLight, 'Unresolved evidence item');
    await openAdvancedEvidence(ownerLight);
    assert.match(await ownerLight.locator('[data-km-detail]').textContent(),
      /Direct revision is disabled for generated or authoritative-source content/);
    assert.strictEqual(await ownerLight.getByRole('button', { name: 'Create revision' }).count(), 0);

    dialog = await openDialogWithReorderedDetail(
      ownerLight, stale.id, 'Workflow lifecycle item', 'Submit exact version for review'
    );
    const submitReview = ownerLight.getByRole('button', { name: 'Submit exact version for review' });
    await ownerLight.waitForFunction(() => document.activeElement && document.activeElement.id.startsWith('km-dialog-reason-'));
    assert.strictEqual(await dialog.getByLabel('Reason').evaluate(element => element === document.activeElement), true);
    await dialog.getByLabel('Reason').fill('Browser submits the exact immutable version for review.');
    const reviewWritesBeforeDivergence = ledger.requests.filter(entry =>
      entry.path.endsWith(`/items/${lifecycle.id}/review`) && entry.method === 'POST').length;
    await ownerLight.locator('[data-km-detail]').evaluate(element => {
      element.dataset.targetKey = 'deliberately-diverged-browser-regression';
    });
    await dialog.getByRole('button', { name: 'Submit for review' }).click();
    await ownerLight.getByRole('alert').waitFor();
    assert.match(await ownerLight.getByRole('alert').textContent(), /selection changed|reload/i);
    const reviewWritesAfterDivergence = ledger.requests.filter(entry =>
      entry.path.endsWith(`/items/${lifecycle.id}/review`) && entry.method === 'POST').length;
    assert.strictEqual(reviewWritesAfterDivergence, reviewWritesBeforeDivergence);
    await ownerLight.keyboard.press('Escape');
    dialog = await openDialogWithReorderedDetail(
      ownerLight, stale.id, 'Workflow lifecycle item', 'Submit exact version for review'
    );
    await dialog.getByLabel('Reason').fill('Browser submits the exact immutable version for review.');
    let response = ownerLight.waitForResponse(value => value.url().endsWith(`/items/${lifecycle.id}/review`) && value.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Submit for review' }).click();
    assert.strictEqual((await response).status(), 201);
    await ownerLight.waitForFunction(() => document.querySelector('[data-km-detail] .km-badge').textContent === 'In review');
    dialog = await openDialogWithReorderedDetail(
      ownerLight, stale.id, 'Workflow lifecycle item', 'Approve exact version'
    );
    await dialog.getByLabel('Reason').fill('Browser approves the exact standard version.');
    response = ownerLight.waitForResponse(value => value.url().endsWith(`/items/${lifecycle.id}/approve`) && value.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Approve exact version' }).click();
    assert.strictEqual((await response).status(), 201);
    await ownerLight.waitForFunction(() => document.querySelector('[data-km-detail] .km-badge').textContent === 'Approved');
    dialog = await openDialogWithReorderedDetail(
      ownerLight, stale.id, 'Workflow lifecycle item', 'Publish exact approved version'
    );
    await dialog.getByLabel('Reason').fill('Browser publishes the exact approved version.');
    response = ownerLight.waitForResponse(value => value.url().endsWith(`/items/${lifecycle.id}/publish`) && value.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Publish exact approved version' }).click();
    assert.strictEqual((await response).status(), 201);
    await ownerLight.waitForFunction(() => document.querySelector('[data-km-detail] .km-badge').textContent === 'Published');
    const workflowEvidence = await pool.query(
      'SELECT count(*)::int AS count FROM canonical_knowledge_publications WHERE organization_id = $1 AND entry_id = $2',
      [ORG, lifecycle.id]
    );
    assert.strictEqual(workflowEvidence.rows[0].count, 1);

    const tombstoneOpener = ownerLight.getByRole('button', { name: 'Create tombstone version' });
    dialog = await openDialogWithReorderedDetail(
      ownerLight, stale.id, 'Workflow lifecycle item', 'Create tombstone version'
    );
    assert.match(await dialog.textContent(), /prior bytes remain immutable/i);
    await screenshot(ownerLight, evidenceDirectory, `${selected}-settings-desktop-light-tombstone-confirmation.png`);
    await ownerLight.keyboard.press('Escape');
    await ownerLight.waitForFunction(element => document.activeElement === element, await tombstoneOpener.elementHandle());
    assert.strictEqual(await tombstoneOpener.evaluate(element => element === document.activeElement), true);
    dialog = await openDialogWithReorderedDetail(
      ownerLight, stale.id, 'Workflow lifecycle item', 'Create tombstone version'
    );
    await dialog.getByLabel('Reason').fill('Browser creates an immutable deletion marker.');
    response = ownerLight.waitForResponse(value => value.url().endsWith(`/items/${lifecycle.id}/tombstone`) && value.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Create a tombstone version' }).click();
    assert.strictEqual((await response).status(), 201);
    await ownerLight.waitForFunction(() => Array.from(document.querySelectorAll('[data-km-detail] dt')).some(label =>
      label.textContent === 'Version number' && label.nextElementSibling && label.nextElementSibling.textContent === '2'
    ));
    dialog = await openDialogWithReorderedDetail(
      ownerLight, stale.id, 'Workflow lifecycle item', 'Rollback as new version'
    );
    await dialog.getByLabel('Reason').fill('Browser restores the prior value as a new immutable version.');
    response = ownerLight.waitForResponse(value => value.url().endsWith(`/items/${lifecycle.id}/rollback`) && value.request().method() === 'POST');
    const rollbackDetailResponse = ownerLight.waitForResponse(value =>
      new URL(value.url()).pathname.endsWith(`/items/${lifecycle.id}`) && value.request().method() === 'GET');
    await dialog.getByRole('button', { name: 'Rollback as a new version' }).click();
    assert.strictEqual((await response).status(), 201);
    const rollbackDetail = await rollbackDetailResponse;
    if (rollbackDetail.status() !== 200) {
      throw new Error(`Rollback detail refresh failed: ${rollbackDetail.status()} ${await rollbackDetail.text()}`);
    }
    await ownerLight.waitForFunction(() => Array.from(document.querySelectorAll('[data-km-detail] dt')).some(label =>
      label.textContent === 'Version number' && label.nextElementSibling && label.nextElementSibling.textContent === '3'
    ));
    const lifecycleEvidence = await pool.query(
      'SELECT version_number, lifecycle_action FROM canonical_knowledge_versions WHERE organization_id = $1 AND entry_id = $2 ORDER BY version_number',
      [ORG, lifecycle.id]
    );
    assert.deepStrictEqual(lifecycleEvidence.rows.map(row => [Number(row.version_number), row.lifecycle_action]), [
      [1, 'initial'], [2, 'tombstone'], [3, 'rollback'],
    ]);
    const staleRetargetWrites = ledger.requests.filter(entry =>
      entry.path.startsWith(`/api/v1/knowledge-management/items/${stale.id}/`) && entry.method === 'POST');
    assert.deepStrictEqual(staleRetargetWrites, []);

    await selectItem(ownerLight, 'Stale conflict item');
    await openAdvancedEvidence(ownerLight);
    const staleRevision = await knowledge.createKnowledgeRevision(pool, {
      ...draft(OWNER, 'human.stale', {
        label: 'Stale conflict item',
        entryType: 'guidance',
        content: { state: 'ready', facts: { value: 'Changed behind the stale browser detail.' } },
      }),
      entryId: stale.id,
      expectedVersionId: stale.version.id,
      expectedVersionNumber: stale.version.number,
      expectedCanonicalDigest: stale.version.canonicalDigest,
      reason: 'Change authority behind the stale browser detail.',
    });
    assert.strictEqual(staleRevision.version.number, 2);
    const staleOpener = ownerLight.getByRole('button', { name: 'Submit exact version for review' });
    await staleOpener.click();
    dialog = ownerLight.getByRole('dialog');
    await dialog.getByLabel('Reason').fill('This request must fail against the stale immutable version.');
    response = ownerLight.waitForResponse(value => value.url().endsWith(`/items/${stale.id}/review`) && value.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Submit for review' }).click();
    assert.strictEqual((await response).status(), 409);
    const dialogError = dialog.locator('[role="alert"]');
    await dialogError.waitFor({ state: 'visible' });
    assert.strictEqual(await dialogError.evaluate(element => element === document.activeElement), true);
    assert.match(await dialogError.textContent(), /reload the exact item/i);
    await screenshot(ownerLight, evidenceDirectory, `${selected}-settings-desktop-light-stale-error.png`);
    await ownerLight.keyboard.press('Escape');
    await ownerLight.waitForFunction(element => document.activeElement === element, await staleOpener.elementHandle());
    assert.strictEqual(await staleOpener.evaluate(element => element === document.activeElement), true);
    await assertP4OwnerSurfaces(ownerLight, origin, p4EvidenceDirectory, selected);
    await ownerLightContext.close();

    for (let index = 0; index < 202; index += 1) {
      const suffix = String(index).padStart(3, '0');
      const imported = index >= 199;
      await knowledge.createInitialKnowledgeDraft(pool, draft(OWNER, `browser.pagination.${suffix}`, {
        label: imported ? `ZZZ Browser pagination ${suffix}` : `Paged browser knowledge ${suffix}`,
        entryType: imported ? 'faq' : 'fact',
        sourceType: imported ? 'imported_record' : 'human_input',
        applicability: { projection: { audiences: [imported ? 'integration_adapter' : 'customer'] } },
      }));
    }
    for (const index of [25, 75, 125, 175]) {
      await knowledge.createInitialKnowledgeDraft(pool, draft(OWNER, `browser.pagination.protected.${index}`, {
        label: `Paged browser knowledge ${String(index).padStart(3, '0')}.5 protected`,
        sensitivity: 'restricted',
      }));
    }

    const ownerDarkContext = await contextFor(browser, origin, sessions.owner, {
      role: 'paid-owner-desktop-dark', viewport: { width: 1440, height: 1000 }, theme: 'dark',
    }, ledger);
    const ownerDark = await ownerDarkContext.newPage();
    attachPage(ownerDark, ledger, 'paid-owner-desktop-dark');
    await openProfile(ownerDark, origin);
    await selectItem(ownerDark, 'Business identity');
    await openAdvancedEvidence(ownerDark);
    await activateTab(ownerDark, 'Changes & provenance');
    await assertNoOverflow(ownerDark);
    await screenshot(ownerDark, evidenceDirectory, `${selected}-business-profile-desktop-dark-diff.png`);
    assert.strictEqual(await ownerDark.locator('[data-km-mode]').isHidden(), true);
    assert.strictEqual((await ownerDark.locator('[data-knowledge-management]').textContent()).includes('simulated'), false);
    await ownerDarkContext.close();

    const memberContext = await contextFor(browser, origin, sessions.member, {
      role: 'paid-member-mobile-dark', viewport: { width: 390, height: 844 }, theme: 'dark',
    }, ledger);
    const memberPage = await memberContext.newPage();
    attachPage(memberPage, ledger, 'paid-member-mobile-dark');
    await openProfile(memberPage, origin);
    assert.match(await memberPage.locator('[data-km-mode]').textContent(), /Read-only membership/);
    assert.match(await memberPage.locator('[data-km-detail]').textContent(), /Read-only membership/);
    assert.strictEqual((await memberPage.locator('[data-knowledge-management]').textContent()).includes('Protected legal bytes'), false);
    assert.strictEqual(await memberPage.locator('.km-actions button').count(), 0);
    const correction = memberPage.locator('.km-correction-link');
    assert.match(await correction.getAttribute('href'), /^\/dashboard\/business-profile\?section=/);
    await assertNoOverflow(memberPage);
    await screenshot(memberPage, evidenceDirectory, `${selected}-business-profile-mobile-dark-readonly.png`);
    await memberPage.goto(origin + '/dashboard/settings', { waitUntil: 'domcontentloaded' });
    await memberPage.waitForFunction(() => document.getElementById('settingsRoleBadge').textContent.includes('Read only'));
    assert.strictEqual(await memberPage.locator('#saveSettingsBtn').isDisabled(), true);
    assert.strictEqual(await memberPage.locator('.notification-preference-grid').evaluate(element =>
      getComputedStyle(element).gridTemplateColumns.split(' ').length
    ), 1);
    const paidMemberWrites = ledger.requests.filter(entry => entry.role === 'paid-member-mobile-dark' &&
      entry.path.startsWith('/api/v1/knowledge-management') &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method));
    assert.deepStrictEqual(paidMemberWrites, []);
    await memberContext.close();

    const mobileLightContext = await contextFor(browser, origin, sessions.owner, {
      role: 'paid-owner-mobile-light', viewport: { width: 390, height: 844 }, theme: 'light',
    }, ledger);
    const mobileLight = await mobileLightContext.newPage();
    attachPage(mobileLight, ledger, 'paid-owner-mobile-light');
    await openSettings(mobileLight, origin);
    assert.strictEqual(await mobileLight.locator('.km-item-button').count(), 200);
    assert.match(await mobileLight.locator('[data-km-status]').textContent(), /200 of \d+ matching knowledge items are loaded/);
    await mobileLight.getByRole('button', { name: 'Load more knowledge items' }).click();
    await mobileLight.waitForFunction(() => {
      const root = document.querySelector('[data-knowledge-management]');
      return root && root.dataset.state === 'ready' && !root.querySelector('.km-list-continuation button');
    });
    assert.ok(await mobileLight.locator('.km-item-button').count() > 200);
    await mobileLight.locator('.km-list-evidence').getByText('Advanced list filters and counts', { exact: true }).click();
    await mobileLight.locator('[data-filter="source"]').selectOption('imported_record');
    await mobileLight.waitForFunction(() => {
      const root = document.querySelector('[data-knowledge-management]');
      return root && root.dataset.state === 'ready' && root.querySelectorAll('.km-item-button').length === 3;
    });
    assert.deepStrictEqual(await mobileLight.locator('.km-item-title').allTextContents(), [
      'ZZZ Browser pagination 199', 'ZZZ Browser pagination 200', 'ZZZ Browser pagination 201',
    ]);
    assert.match(await mobileLight.locator('[data-km-status]').textContent(), /3 of \d+ visible knowledge items match/);
    await assertNoOverflow(mobileLight);
    await screenshot(mobileLight, evidenceDirectory, `${selected}-settings-mobile-light-main.png`);
    await mobileLightContext.close();

    await pool.query(
      "UPDATE subscriptions SET status='expired', updated_at=statement_timestamp() WHERE organization_id=$1",
      [ORG]
    );
    const subscriptionReadOnlyContext = await contextFor(browser, origin, sessions.owner, {
      role: 'paid-owner-subscription-readonly-desktop-light',
      viewport: { width: 1440, height: 1000 }, theme: 'light',
    }, ledger);
    const subscriptionReadOnly = await subscriptionReadOnlyContext.newPage();
    attachPage(subscriptionReadOnly, ledger, 'paid-owner-subscription-readonly-desktop-light');
    await openSettings(subscriptionReadOnly, origin);
    assert.match(await subscriptionReadOnly.locator('#northstar-trial-status').textContent(), /restricted read-only mode/);
    assert.match(await subscriptionReadOnly.locator('[data-km-mode]').textContent(), /Read-only subscription/);
    assert.match(await subscriptionReadOnly.locator('[data-km-detail]').textContent(), /Read-only subscription/);
    assert.strictEqual(await subscriptionReadOnly.locator('.km-actions button').count(), 0);
    await assertNoOverflow(subscriptionReadOnly);
    await assertReducedMotion(subscriptionReadOnly);
    const subscriptionModeContrast = await assertTextContrast(
      subscriptionReadOnly, '[data-km-mode]', 'subscription read-only mode'
    );
    const subscriptionHeadingContrast = await assertTextContrast(
      subscriptionReadOnly, '[data-km-detail] h3', 'subscription read-only detail heading'
    );
    await screenshot(
      subscriptionReadOnly,
      evidenceDirectory,
      `${selected}-settings-desktop-light-subscription-readonly.png`
    );
    await subscriptionReadOnly.setViewportSize({ width: 320, height: 800 });
    await assertNoOverflow(subscriptionReadOnly);
    assert.strictEqual(await subscriptionReadOnly.locator('.km-actions button').count(), 0);
    await screenshot(
      subscriptionReadOnly,
      evidenceDirectory,
      `${selected}-settings-reflow-320-subscription-readonly.png`
    );
    const subscriptionWrites = ledger.requests.filter(entry =>
      entry.role === 'paid-owner-subscription-readonly-desktop-light' &&
      entry.path.startsWith('/api/v1/knowledge-management') &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method)
    );
    assert.deepStrictEqual(subscriptionWrites, []);
    await subscriptionReadOnlyContext.close();

    const demoDarkContext = await contextFor(browser, origin, null, {
      role: 'demo-mobile-dark', viewport: { width: 390, height: 844 }, theme: 'dark',
    }, ledger, true);
    const demoDark = await demoDarkContext.newPage();
    attachPage(demoDark, ledger, 'demo-mobile-dark');
    await openSettings(demoDark, origin, true);
    assert.match(await demoDark.locator('[data-km-mode]').textContent(), /isolated shared demo authority is simulated and read-only/);
    assert.strictEqual(await demoDark.locator('#settingsRoleBadge').textContent(), 'Demo preview · Read only');
    assert.strictEqual(await demoDark.locator('#saveSettingsBtn').isDisabled(), true);
    assert.strictEqual((await demoDark.locator('[data-knowledge-management]').textContent()).includes('Part 7 Browser Company'), false);
    assert.strictEqual(await demoDark.locator('.km-actions button').count(), 0);
    assert.match(await demoDark.locator('.km-correction-link').getAttribute('href'), /^\/demo\/business-profile\?section=/);
    await selectItem(demoDark, 'Customer and workforce guidance');
    await openAdvancedEvidence(demoDark);
    await activateTab(demoDark, 'Synchronization');
    assert.match(await demoDark.locator('[role="tabpanel"]:visible').textContent(), /Drift detected/);
    assert.match(await demoDark.locator('[role="tabpanel"]:visible').textContent(), /No live provider connection is claimed|demo_voice_preview/);
    await assertNoOverflow(demoDark);
    await screenshot(demoDark, evidenceDirectory, `${selected}-demo-settings-mobile-dark-sync-readonly.png`);
    const demoWrites = ledger.requests.filter(entry => entry.role === 'demo-mobile-dark' &&
      entry.path.startsWith('/api/v1/knowledge-management') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method));
    assert.deepStrictEqual(demoWrites, []);
    await demoDark.goto(origin + '/demo/team', { waitUntil: 'domcontentloaded' });
    await demoDark.waitForFunction(() => document.getElementById('workforceSummary').textContent.includes('Demo preview'));
    assert.strictEqual(await demoDark.locator('#inviteForm').isHidden(), true);
    assert.strictEqual(await demoDark.locator('#crewForm').isHidden(), true);
    await screenshot(demoDark, p4EvidenceDirectory, `${selected}-demo-team-summary-readonly.png`);
    await demoDarkContext.close();

    const demoLightContext = await contextFor(browser, origin, null, {
      role: 'demo-desktop-light', viewport: { width: 1440, height: 1000 }, theme: 'light',
    }, ledger, true);
    const demoLight = await demoLightContext.newPage();
    attachPage(demoLight, ledger, 'demo-desktop-light');
    await openProfile(demoLight, origin, true);
    assert.match(await demoLight.locator('[data-km-mode]').textContent(), /Demo preview/);
    await assertNoOverflow(demoLight);
    await screenshot(demoLight, evidenceDirectory, `${selected}-demo-business-profile-desktop-light-main.png`);
    await demoLightContext.close();

    const protectedMember = ledger.requests.filter(entry => entry.role.startsWith('paid-member') &&
      entry.path.startsWith('/api/v1/knowledge-management') &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method));
    assert.deepStrictEqual(protectedMember, []);
    assert.deepStrictEqual(ledger.external, []);
    assert.deepStrictEqual(providerActions, []);
    assert.deepStrictEqual(ledger.pageErrors, []);
    assert.deepStrictEqual(ledger.consoleErrors, []);
    assert.ok(ledger.expectedConsole.length >= 1);
    assert.ok(ledger.requests.every(entry => entry.authorization === null));
    assert.strictEqual(identityPublication.versionId, identity.version.id);
    assert.strictEqual(identityRevision.version.number, 2);

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'Chrome' : 'actual Playwright WebKit',
      version: browser.version(),
      database: suiteDatabase.databaseName,
      databaseIdentity,
      paidSurfaces: ['Settings', 'Business Profile'],
      demoSurfaces: ['Settings', 'Business Profile'],
      themes: ['light', 'dark'],
      viewports: ['1440x1000', '390x844', '320x800 reflow equivalent'],
      filters: true,
      exactWorkflow: ['review', 'changes', 'approve', 'publish'],
      exactLifecycle: ['revise', 'tombstone', 'rollback-as-new-version'],
      synchronization: ['drift', 'reconciliation', 'retry'],
      delayedDetailOrdering: ['review', 'changes', 'approve', 'publish', 'revise', 'tombstone', 'rollback', 'reconcile', 'retry'],
      accessibility: ['headings', 'labels', 'tabs', 'keyboard', 'dialog', 'Escape', 'focus restoration', 'alert focus', 'reduced motion', 'contrast', '320px reflow'],
      contrast: { subscriptionMode: subscriptionModeContrast, subscriptionHeading: subscriptionHeadingContrast },
      boundaries: ['paid tenant authority', 'isolated simulated demo', 'read-only member', 'subscription read-only', 'no provider transport'],
      xssExecutions: 0,
      overflow: 0,
      evidenceDirectory: evidenceDirectory || null,
      physicalSafari: false,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db) await db.close();
    if (originalHttpsRequest) https.request = originalHttpsRequest;
    if (originalFetch === undefined) delete global.fetch;
    else global.fetch = originalFetch;
    await suiteDatabase.cleanup();
    for (const [name, value] of original.entries()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

run().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
