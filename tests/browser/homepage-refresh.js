'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

[
  'DATABASE_URL', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
  'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
].forEach(name => { delete process.env[name]; });
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'homepage-browser-test-secret-'.padEnd(64, 'x');

const ROOT = path.resolve(__dirname, '..', '..');
process.chdir(ROOT);
const { app } = require('../../src/server');

const CONSENT_PHRASE = 'I consent to this AI demo and temporary recording';
const VIEWPORTS = Object.freeze([
  Object.freeze({ label: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ label: 'mobile', width: 390, height: 844 }),
]);
const SCREENSHOT_DIR = process.env.HOMEPAGE_SCREENSHOT_DIR
  ? path.resolve(process.env.HOMEPAGE_SCREENSHOT_DIR) : null;

function screenshotPath(selected, viewport, state) {
  if (!SCREENSHOT_DIR) return null;
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  return path.join(SCREENSHOT_DIR, `${selected}-${viewport.label}-${state}.png`);
}

const FAKE_SDK = `
export class RetellWebClient {
  constructor() {
    this.handlers = new Map();
    this.connected = false;
    window.__retellTestClient = this;
  }
  on(name, handler) {
    const list = this.handlers.get(name) || [];
    list.push(handler);
    this.handlers.set(name, list);
    return this;
  }
  emit(name, value) {
    (this.handlers.get(name) || []).forEach(handler => handler(value));
  }
  async startCall(options) {
    window.__webCallAccessToken = options.accessToken;
    window.__webCallSequence.push('sdk-start');
    if (window.__retellSdkStartDelayMs) {
      await new Promise(resolve => setTimeout(resolve, window.__retellSdkStartDelayMs));
    }
    this.connected = true;
    this.emit('call_started');
    this.emit('call_ready');
  }
  stopCall() {
    window.__retellStopCalls = (window.__retellStopCalls || 0) + 1;
    if (!this.connected) return;
    this.connected = false;
    this.emit('call_ended');
  }
  pushTranscript(transcript) {
    this.emit('update', { event_type: 'update', transcript });
  }
}
`;

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readyStatus() {
  return {
    success: true,
    webCall: {
      available: true,
      state: 'ready',
      missing: [],
      storageRequirement: 'basic_attributes_only',
      retentionRequirementDays: 1,
      disclosureVersion: 'attorney-gated-draft-v1',
    },
    transcriptPersistence: 'none',
    resultPersistence: 'browser-memory-only',
    providerActivationChanged: false,
  };
}

function polarisResult() {
  return {
    contract: 'NorthStarHomepageCanonicalPolaris/v1',
    persistence: 'browser-memory-only',
    profile: {
      kind: 'fictional-demo-business-profile',
      version: 'homepage-fictional-profile-v1',
      hash: 'a'.repeat(64),
      pricingNotice: 'Illustrative output from a fictional demo Business Profile; not a quote.',
    },
    service: { key: 'roofing', label: 'Roofing fictional demo service', supported: true },
    pricing: {
      status: 'calculated',
      customerFacingPrice: 9000,
      preliminaryRange: { low: 7650, high: 10350 },
      tax: 0,
      totalIncludingTax: 9000,
      notCalculated: [],
    },
    confidence: { score: 100, factors: [] },
    risk: { emergency: false },
    recommendedActions: [{ code: 'review-estimate', label: 'Review and follow up on the preliminary estimate', priority: 'medium' }],
    facts: [
      { variable: 'Roof Area', displayValue: '2000 sq ft', extractionConfidence: 0.95 },
      { variable: 'Roof Age', displayValue: '20 years old', extractionConfidence: 0.9 },
    ],
    qualification: {
      captured: 2,
      expected: 4,
      preferredPricingVariable: 'Roof Area',
      preferredPricingVariableCaptured: true,
    },
    provenance: {
      calculationVersion: 'canonical-polaris-v1',
      normalizedInputFingerprint: 'b'.repeat(64),
      businessProfileInputHash: 'a'.repeat(64),
    },
  };
}

async function installPageHarness(page, origin, options = {}) {
  const evidence = {
    requests: [],
    bodies: [],
    disclosureBeforeCreate: false,
    deleteAttempts: 0,
  };
  await page.addInitScript((sdkStartDelayMs) => {
    window.__webCallSequence = [];
    window.__spokenDisclosures = [];
    window.__homepageXss = 0;
    window.__retellStopCalls = 0;
    window.__retellSdkStartDelayMs = sdkStartDelayMs;
    const TestUtterance = function (text) {
      this.text = text;
      this.rate = 1;
      this.onend = null;
      this.onerror = null;
    };
    const testSynthesis = {
      cancel() {},
      speak(utterance) {
        window.__spokenDisclosures.push(utterance.text);
        window.__webCallSequence.push('audible-disclosure');
        setTimeout(() => utterance.onend && utterance.onend(), 0);
      },
    };
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: testSynthesis });
  }, Number(options.sdkStartDelayMs) || 0);
  await page.route('**/js/vendor/retell-web-client.mjs', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: FAKE_SDK,
  }));
  await page.route('**/api/demo/homepage/**', async route => {
    const request = route.request();
    const target = new URL(request.url());
    evidence.requests.push({ method: request.method(), path: target.pathname });
    if (target.pathname === '/api/demo/homepage/status' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(options.unavailable ? {
        success: true,
        webCall: { available: false, state: 'approval_or_configuration_required', missing: ['attorney_approval'] },
        transcriptPersistence: 'none',
        resultPersistence: 'browser-memory-only',
        providerActivationChanged: false,
      } : readyStatus()) });
    }
    let body = null;
    try { body = request.postDataJSON(); } catch (_error) {}
    evidence.bodies.push({ method: request.method(), path: target.pathname, body });
    if (target.pathname === '/api/demo/homepage/web-call' && request.method() === 'POST') {
      evidence.disclosureBeforeCreate = await page.evaluate(() => window.__webCallSequence[0] === 'audible-disclosure');
      if (options.createDelayMs) await new Promise(resolve => setTimeout(resolve, options.createDelayMs));
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
        success: true,
        data: {
          callId: 'call_homepage_browser_1',
          accessToken: 'temporary-access-token',
          purgeToken: 'signed-purge-token',
          storage: 'basic_attributes_only',
          retentionDays: 1,
          verbalConsentPhrase: CONSENT_PHRASE,
        },
      }) });
    }
    if (target.pathname === '/api/demo/homepage/polaris/call_homepage_browser_1' && request.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: polarisResult() }) });
    }
    if (target.pathname === '/api/demo/homepage/web-call/call_homepage_browser_1' && request.method() === 'DELETE') {
      evidence.deleteAttempts += 1;
      if (options.failFirstDelete && evidence.deleteAttempts === 1) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
          success: false,
          error: { code: 'homepage_provider_deletion_unverified', message: 'Deletion could not be verified.' },
        }) });
      }
      await new Promise(resolve => setTimeout(resolve, 120));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        success: true,
        data: { providerDeletionVerified: true, northstarPurged: true, retainedContent: false },
      }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false }) });
  });
  return evidence;
}

async function assertContainment(page, viewport, label) {
  const result = await page.evaluate(() => {
    const selectors = [
      '.nav-inner', '#demoPreCallView', '.demo-form-card', '#preCallModal .demo-modal-card',
      '#demoLiveView .demo-transcript-panel', '#demoLiveView .demo-insights-panel',
      '#demoPostCallView .demo-polaris-report', '#demoPostCallView .demo-post-actions',
    ];
    const visible = selectors.map(selector => {
      const element = document.querySelector(selector);
      if (!element) return { selector, missing: true };
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return { selector, hidden: true };
      const box = element.getBoundingClientRect();
      return { selector, left: box.left, right: box.right, width: box.width };
    });
    const themeControl = document.querySelector('.northstar-theme-control');
    const nav = document.querySelector('.nav');
    const navBox = nav ? nav.getBoundingClientRect() : null;
    const navChildren = Array.from(document.querySelectorAll('.nav-inner > *'))
      .filter(element => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map(element => {
        const box = element.getBoundingClientRect();
        return { className: element.className, top: box.top, bottom: box.bottom };
      });
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      visible,
      navBox: navBox && { top: navBox.top, bottom: navBox.bottom },
      navChildren,
      themeParent: themeControl && themeControl.parentElement && themeControl.parentElement.hasAttribute('data-northstar-theme-slot'),
      themePosition: themeControl ? getComputedStyle(themeControl).position : null,
    };
  });
  assert.ok(result.scrollWidth <= result.clientWidth + 1, `${label}: no horizontal overflow (${result.scrollWidth}/${result.clientWidth})`);
  result.visible.filter(item => !item.hidden && !item.missing).forEach(item => {
    assert.ok(item.left >= -1, `${label}: ${item.selector} left contained (${item.left})`);
    assert.ok(item.right <= viewport.width + 1, `${label}: ${item.selector} right contained (${item.right}/${viewport.width})`);
    assert.ok(item.width <= viewport.width + 1, `${label}: ${item.selector} width contained (${item.width})`);
  });
  assert.ok(result.navBox, `${label}: navigation is present`);
  result.navChildren.forEach(item => {
    assert.ok(item.top >= result.navBox.top - 1, `${label}: ${item.className} starts inside navigation`);
    assert.ok(item.bottom <= result.navBox.bottom + 1, `${label}: ${item.className} ends inside navigation`);
  });
  assert.strictEqual(result.themeParent, true, `${label}: theme control is mounted in the header slot`);
  assert.strictEqual(result.themePosition, 'static', `${label}: theme control does not float over content`);
}

async function runSuccessfulCase(browser, origin, selected, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const harness = await installPageHarness(page, origin);
  try {
    const response = await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    assert.ok(response && response.status() === 200, `${selected}/${viewport.label}: homepage response`);
    await page.waitForFunction(() => window.NorthStarHomepageDemo && window.NorthStarHomepageDemo.getState().availabilityChecked, null, { timeout: 10000 });
    assert.strictEqual(await page.isEnabled('#demoCallBtn'), true, `${selected}/${viewport.label}: approved call button enabled`);
    await assertContainment(page, viewport, `${selected}/${viewport.label}/pre`);
    if (screenshotPath(selected, viewport, 'pre')) await page.screenshot({ path: screenshotPath(selected, viewport, 'pre'), fullPage: true });

    await page.fill('#demoBusinessName', '<img src=x onerror="window.__homepageXss=1"> NorthStar Test');
    await page.selectOption('#demoIndustry', 'Roofing');
    await page.check('#demoConsentCheckbox');
    await page.click('#demoCallBtn');
    await page.waitForSelector('#preCallModal[aria-hidden="false"]');
    await assertContainment(page, viewport, `${selected}/${viewport.label}/modal`);
    if (screenshotPath(selected, viewport, 'modal')) await page.screenshot({ path: screenshotPath(selected, viewport, 'modal'), fullPage: false });
    assert.match(await page.textContent('#demoDisclosureCopy'), /AI demonstration[\s\S]*recorded temporarily[\s\S]*I consent to this AI demo/i,
      `${selected}/${viewport.label}: explicit audible disclosure copy`);
    await page.click('#modalCallBtn');
    try {
      await page.waitForFunction(() => window.__retellTestClient && window.__webCallAccessToken === 'temporary-access-token', null, { timeout: 10000 });
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        sequence: window.__webCallSequence,
        notice: document.getElementById('guidedPreviewNotice') && document.getElementById('guidedPreviewNotice').textContent,
        formNotice: document.getElementById('demoFormNotice') && document.getElementById('demoFormNotice').textContent,
        state: window.NorthStarHomepageDemo && window.NorthStarHomepageDemo.getState(),
      }));
      throw new Error(error.message + '\n' + JSON.stringify({ diagnostics, pageErrors, consoleErrors, requests: harness.requests }, null, 2));
    }
    assert.strictEqual(harness.disclosureBeforeCreate, true, `${selected}/${viewport.label}: disclosure precedes provider creation`);
    assert.match((await page.evaluate(() => window.__spokenDisclosures[0])), /NorthStar AI demonstration[\s\S]*recorded temporarily/i,
      `${selected}/${viewport.label}: disclosure was audible`);

    await page.evaluate(phrase => {
      window.__retellTestClient.pushTranscript([
        { role: 'agent', content: 'Please say the consent phrase.' },
        { role: 'user', content: phrase },
        { role: 'agent', content: 'Please describe the fictional roofing work.' },
        { role: 'user', content: 'I need a roof replacement for a 2000 square foot roof. <img src=x onerror="window.__homepageXss=1">' },
      ]);
    }, CONSENT_PHRASE);
    await page.evaluate(() => {
      window.__retellTestClient.pushTranscript([
        { role: 'user', content: 'I need a roof replacement for a 2000 square foot roof. <img src=x onerror="window.__homepageXss=1">' },
        { role: 'agent', content: 'How old is the fictional roof?' },
        { role: 'user', content: 'It is twenty years old.' },
      ]);
    });
    await page.waitForFunction(() => window.NorthStarHomepageDemo.getState().consented === true && window.NorthStarHomepageDemo.getState().transcriptTurns >= 3);
    const live = await page.evaluate(() => ({
      transcript: document.getElementById('demoTranscriptBody').textContent,
      images: document.getElementById('demoTranscriptBody').querySelectorAll('img,script,svg,iframe').length,
      xss: window.__homepageXss,
      storage: Object.keys(sessionStorage).concat(Object.keys(localStorage)).filter(key => key.startsWith('northstar.homepage.')),
    }));
    assert.match(live.transcript, /2000 square foot roof[\s\S]*twenty years old/i, `${selected}/${viewport.label}: variable conversation rendered`);
    assert.doesNotMatch(live.transcript, new RegExp(CONSENT_PHRASE, 'i'), `${selected}/${viewport.label}: consent phrase not retained as job content`);
    assert.strictEqual(live.images, 0, `${selected}/${viewport.label}: transcript DOM is text-only`);
    assert.strictEqual(live.xss, 0, `${selected}/${viewport.label}: transcript payload inert`);
    assert.deepStrictEqual(live.storage, [], `${selected}/${viewport.label}: no homepage storage`);
    await assertContainment(page, viewport, `${selected}/${viewport.label}/live`);
    if (screenshotPath(selected, viewport, 'live')) await page.screenshot({ path: screenshotPath(selected, viewport, 'live'), fullPage: true });

    await page.click('#demoHangupBtn');
    await page.waitForTimeout(30);
    assert.strictEqual(await page.isVisible('#demoPostCallView'), false, `${selected}/${viewport.label}: result withheld before deletion response`);
    await page.waitForSelector('#demoPostCallView', { state: 'visible', timeout: 10000 });
    await assertContainment(page, viewport, `${selected}/${viewport.label}/post`);
    if (screenshotPath(selected, viewport, 'post')) await page.screenshot({ path: screenshotPath(selected, viewport, 'post'), fullPage: true });
    assert.strictEqual(await page.textContent('#reportRevenue'), '$9,000', `${selected}/${viewport.label}: canonical price`);
    assert.match(await page.textContent('#reportExecBody'), /Canonical Polaris processed 2 of 4 supported estimating facts/i,
      `${selected}/${viewport.label}: mounted canonical result`);
    assert.match(await page.textContent('#demoPurgeReceipt'), /Verified deletion complete[\s\S]*transcript, token/i,
      `${selected}/${viewport.label}: verified purge receipt`);
    const terminal = await page.evaluate(() => window.NorthStarHomepageDemo.getState());
    assert.deepStrictEqual(terminal, {
      available: true,
      availabilityChecked: true,
      active: false,
      consented: false,
      transcriptTurns: 0,
      deletionState: 'verified',
      resultVisible: true,
      persistence: 'browser-memory-only',
    }, `${selected}/${viewport.label}: terminal in-memory state`);

    const serializedBodies = JSON.stringify(harness.bodies);
    assert.ok(!serializedBodies.includes('NorthStar Test'), `${selected}/${viewport.label}: browser-only business name never sent`);
    assert.ok(!JSON.stringify(harness.bodies.filter(entry => !entry.path.includes('/polaris/'))).includes('<img'),
      `${selected}/${viewport.label}: transient transcript reaches only the ephemeral Polaris endpoint after consent`);
    const createBody = harness.bodies.find(entry => entry.path === '/api/demo/homepage/web-call').body;
    assert.deepStrictEqual(createBody, { consentAcknowledged: true, industry: 'Roofing' }, `${selected}/${viewport.label}: exact create body`);
    const polarisBody = harness.bodies.find(entry => entry.path.includes('/polaris/')).body;
    assert.ok(Array.isArray(polarisBody.transcript) && polarisBody.transcript.length >= 3, `${selected}/${viewport.label}: consented transcript projected once`);
    assert.ok(harness.bodies.some(entry => entry.method === 'DELETE'), `${selected}/${viewport.label}: provider deletion requested`);
    assert.deepStrictEqual(pageErrors, [], `${selected}/${viewport.label}: no page errors`);
    assert.deepStrictEqual(consoleErrors, [], `${selected}/${viewport.label}: no console errors`);
    return { viewport: viewport.label, deletionAttempts: harness.deleteAttempts, transcriptTurns: polarisBody.transcript.length };
  } finally {
    await page.close();
    await context.close();
  }
}

async function runCancellationCase(browser, origin, selected) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  const harness = await installPageHarness(page, origin, { createDelayMs: 1500 });
  try {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => window.NorthStarHomepageDemo && window.NorthStarHomepageDemo.getState().available);
    await page.fill('#demoBusinessName', 'Cancellation Boundary Test');
    await page.selectOption('#demoIndustry', 'Roofing');
    await page.check('#demoConsentCheckbox');
    await page.click('#demoCallBtn');
    const createRequest = page.waitForRequest(request =>
      new URL(request.url()).pathname === '/api/demo/homepage/web-call' && request.method() === 'POST');
    await page.click('#modalCallBtn');
    await page.waitForFunction(() => window.__webCallSequence.includes('audible-disclosure'));
    await createRequest;
    await page.click('#demoWithdrawBtn');
    await page.waitForFunction(() => window.NorthStarHomepageDemo.getState().active === false &&
      window.NorthStarHomepageDemo.getState().deletionState === 'verified', null, { timeout: 10000 });
    assert.strictEqual(harness.deleteAttempts, 1, `${selected}: cancellation after creation verifies deletion`);
    assert.strictEqual(await page.evaluate(() => window.__webCallSequence.includes('sdk-start')), false,
      `${selected}: cancellation before microphone access never starts the SDK`);
    assert.strictEqual(await page.isVisible('#demoPostCallView'), false, `${selected}: cancelled start creates no result`);
  } finally {
    await page.close();
    await context.close();
  }
}

async function runConnectionCancellationCase(browser, origin, selected) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  const harness = await installPageHarness(page, origin, { sdkStartDelayMs: 1200 });
  try {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => window.NorthStarHomepageDemo && window.NorthStarHomepageDemo.getState().available);
    await page.fill('#demoBusinessName', 'Connection Withdrawal Test');
    await page.selectOption('#demoIndustry', 'Roofing');
    await page.check('#demoConsentCheckbox');
    await page.click('#demoCallBtn');
    await page.click('#modalCallBtn');
    await page.waitForFunction(() => window.__webCallSequence.includes('sdk-start'));
    await page.click('#demoWithdrawBtn');
    await page.waitForFunction(() => window.NorthStarHomepageDemo.getState().active === false &&
      window.NorthStarHomepageDemo.getState().deletionState === 'verified', null, { timeout: 10000 });
    await page.waitForTimeout(1400);
    const terminal = await page.evaluate(() => ({
      connected: Boolean(window.__retellTestClient && window.__retellTestClient.connected),
      stopCalls: window.__retellStopCalls,
      state: window.NorthStarHomepageDemo.getState(),
    }));
    assert.strictEqual(harness.deleteAttempts, 1, `${selected}: connection withdrawal verifies provider deletion`);
    assert.strictEqual(terminal.connected, false, `${selected}: late SDK connection is stopped after withdrawal`);
    assert.ok(terminal.stopCalls >= 2, `${selected}: SDK stop is retried after its connection promise settles`);
    assert.strictEqual(terminal.state.active, false, `${selected}: late SDK events cannot reactivate the deleted call`);
    assert.strictEqual(terminal.state.resultVisible, false, `${selected}: connection withdrawal creates no result`);
  } finally {
    await page.close();
    await context.close();
  }
}

async function runFailureCase(browser, origin, selected) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  const harness = await installPageHarness(page, origin, { failFirstDelete: true });
  try {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => window.NorthStarHomepageDemo && window.NorthStarHomepageDemo.getState().available);
    await page.fill('#demoBusinessName', 'Deletion Boundary Test');
    await page.selectOption('#demoIndustry', 'Roofing');
    await page.check('#demoConsentCheckbox');
    await page.click('#demoCallBtn');
    await page.click('#modalCallBtn');
    await page.waitForFunction(() => window.__retellTestClient);
    await page.evaluate(phrase => window.__retellTestClient.pushTranscript([
      { role: 'user', content: phrase },
      { role: 'agent', content: 'Describe a fictional roof.' },
      { role: 'user', content: 'It is 2000 square feet.' },
    ]), CONSENT_PHRASE);
    await page.waitForFunction(() => window.NorthStarHomepageDemo.getState().consented);
    await page.click('#demoHangupBtn');
    await page.waitForSelector('#demoRetryDeleteBtn', { state: 'visible', timeout: 10000 });
    assert.strictEqual(await page.isVisible('#demoPostCallView'), false, `${selected}: failed deletion withholds results`);
    const failed = await page.evaluate(() => window.NorthStarHomepageDemo.getState());
    assert.strictEqual(failed.deletionState, 'unverified', `${selected}: deletion state fails closed`);
    assert.strictEqual(failed.transcriptTurns, 0, `${selected}: transcript cleared on delete failure`);
    assert.strictEqual(failed.resultVisible, false, `${selected}: result cleared on delete failure`);
    await page.click('#demoRetryDeleteBtn');
    await page.waitForFunction(() => window.NorthStarHomepageDemo.getState().active === false);
    assert.strictEqual(harness.deleteAttempts, 2, `${selected}: one deliberate retry`);
  } finally {
    await page.close();
    await context.close();
  }
}

async function runUnavailableCase(browser, origin, selected) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const harness = await installPageHarness(page, origin, { unavailable: true });
  try {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => window.NorthStarHomepageDemo && window.NorthStarHomepageDemo.getState().availabilityChecked);
    assert.strictEqual(await page.isEnabled('#demoCallBtn'), false, `${selected}: production activation remains disabled`);
    assert.match(await page.textContent('#demoFormNotice'), /not active[\s\S]*attorney and Retell privacy approval/i,
      `${selected}: user-visible hard gate`);
    assert.deepStrictEqual(harness.requests, [{ method: 'GET', path: '/api/demo/homepage/status' }], `${selected}: locked state makes no provider request`);
  } finally {
    await page.close();
    await context.close();
  }
}

async function runVendorBoundaryCase(browser, origin, selected) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const consoleMessages = [];
  page.on('console', message => consoleMessages.push({ type: message.type(), text: message.text() }));
  try {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    consoleMessages.length = 0;
    const exported = await page.evaluate(async () => {
      const module = await import('/js/vendor/retell-web-client.mjs');
      return typeof module.RetellWebClient;
    });
    await page.waitForTimeout(50);
    assert.strictEqual(exported, 'function', `${selected}: pinned Retell browser bundle exports the client`);
    assert.deepStrictEqual(consoleMessages, [], `${selected}: importing the ephemeral transport emits no browser log`);
  } finally {
    await page.close();
    await context.close();
  }
}

async function main() {
  const selected = process.argv[2];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'usage: node homepage-refresh.js <chrome|webkit>');
  const runtime = resolveBrowserRuntime(selected);
  let server;
  let browser;
  const evidence = {
    browser: selected,
    executablePath: runtime.executablePath,
    executableSha256: hashFile(runtime.executablePath),
    cases: [],
  };
  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    evidence.version = browser.version();
    for (const viewport of VIEWPORTS) evidence.cases.push(await runSuccessfulCase(browser, origin, selected, viewport));
    await runCancellationCase(browser, origin, selected);
    await runConnectionCancellationCase(browser, origin, selected);
    await runFailureCase(browser, origin, selected);
    await runUnavailableCase(browser, origin, selected);
    await runVendorBoundaryCase(browser, origin, selected);
    evidence.failureBoundary = 'pass';
    evidence.cancellationBoundary = 'pass';
    evidence.connectionCancellationBoundary = 'pass';
    evidence.sourceDisabledBoundary = 'pass';
    evidence.vendorLogBoundary = 'pass';
    process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
