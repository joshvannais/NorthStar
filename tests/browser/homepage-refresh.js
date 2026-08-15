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

const ROOT = path.resolve(__dirname, '..', '..');
process.chdir(ROOT);
const { app } = require('../../src/server');

const VIEWPORTS = Object.freeze([
  Object.freeze({ label: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ label: 'tablet', width: 834, height: 1112 }),
  Object.freeze({ label: 'mobile', width: 390, height: 844 }),
]);
const THEMES = Object.freeze(['light', 'dark']);
const SCENARIO_SEQUENCES = Object.freeze({
  chrome: Object.freeze([
    'emergency', 'estimate', 'price-shopper',
    'returning', 'insurance', 'scheduling-conflict',
  ]),
  webkit: Object.freeze([
    'difficult', 'billing', 'custom',
    'emergency', 'estimate', 'price-shopper',
  ]),
});

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function intersects(a, b) {
  return Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
}

async function inspectCase(browser, origin, selected, viewport, theme, scenarioKey, evidence) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  await context.addInitScript(selectedTheme => {
    localStorage.setItem('northstar-theme', selectedTheme);
    window.__northstarDialogCalls = 0;
    window.alert = function () { window.__northstarDialogCalls += 1; };
    window.__northstarThemeApplication = null;
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (this === document.documentElement && name === 'data-theme' && !window.__northstarThemeApplication) {
        window.__northstarThemeApplication = { theme: String(value), at: performance.now() };
      }
      return originalSetAttribute.apply(this, arguments);
    };
  }, theme);

  const page = await context.newPage();
  const requests = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    const startedAt = Date.now();
    const response = await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    assert.ok(response && response.status() === 200, `${selected}/${viewport.label}/${theme}: homepage response`);
    await page.waitForFunction(() => Boolean(window.NorthStarHomepageDemo), null, { timeout: 10000 });
    const moduleReadyMs = Date.now() - startedAt;
    assert.ok(moduleReadyMs <= 10000, `${selected}/${viewport.label}/${theme}: module ready within ten seconds (${moduleReadyMs}ms)`);

    const initial = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      const lockup = document.querySelector('.nav-logo').getBoundingClientRect();
      const cta = document.querySelector('.nav-links .btn-primary[href="/signup"]').getBoundingClientRect();
      const eyebrow = document.querySelector('.demo-eyebrow');
      const color = getComputedStyle(eyebrow).color;
      const background = getComputedStyle(document.body).backgroundColor;
      function rgb(value) {
        return (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      }
      function luminance(parts) {
        const normalized = parts.map(channel => {
          const value = channel / 255;
          return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * normalized[0] + 0.7152 * normalized[1] + 0.0722 * normalized[2];
      }
      const a = luminance(rgb(color));
      const b = luminance(rgb(background));
      const firstPaint = performance.getEntriesByType('paint').find(entry => entry.name === 'first-paint');
      const headNodes = Array.from(document.head.children);
      const themeScriptIndex = headNodes.findIndex(node => node.tagName === 'SCRIPT' && node.getAttribute('src') === '/js/theme.js');
      const stylesheetIndex = headNodes.findIndex(node => node.tagName === 'LINK' && node.getAttribute('rel') === 'stylesheet');
      return {
        domInteractiveMs: navigation ? navigation.domInteractive : null,
        themeApplication: window.__northstarThemeApplication,
        firstPaintMs: firstPaint ? firstPaint.startTime : null,
        themeScriptIndex,
        stylesheetIndex,
        currentTheme: document.documentElement.getAttribute('data-theme'),
        brandToken: getComputedStyle(document.documentElement).getPropertyValue('--northstar-brand-gold').trim(),
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        lockup: { width: lockup.width, height: lockup.height },
        cta: { width: cta.width, height: cta.height, visible: cta.width > 0 && cta.height > 0 },
        scenarioCount: Object.keys(window.NorthStarHomepageDemo.scenarios).length,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        chipTransition: getComputedStyle(document.querySelector('.demo-scenario-chip')).transitionDuration,
        hasPhoneField: Boolean(document.getElementById('demoPhoneNumber')),
        dialogCalls: window.__northstarDialogCalls,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    assert.ok(initial.domInteractiveMs !== null && initial.domInteractiveMs <= 10000,
      `${selected}/${viewport.label}/${theme}: DOM interactive within ten seconds`);
    assert.ok(initial.themeApplication, `${selected}/${viewport.label}/${theme}: theme applied synchronously`);
    assert.strictEqual(initial.themeApplication.theme, theme, `${selected}/${viewport.label}/${theme}: saved theme applied first`);
    if (initial.firstPaintMs !== null) {
      assert.ok(initial.themeApplication.at <= initial.firstPaintMs,
        `${selected}/${viewport.label}/${theme}: theme applied before first paint`);
    }
    assert.ok(initial.themeScriptIndex >= 0 && initial.themeScriptIndex < initial.stylesheetIndex,
      `${selected}/${viewport.label}/${theme}: theme authority precedes stylesheets`);
    assert.strictEqual(initial.currentTheme, theme, `${selected}/${viewport.label}/${theme}: persisted theme`);
    assert.strictEqual(initial.brandToken.toLowerCase(), theme === 'dark' ? '#d4af37' : '#6d5005',
      `${selected}/${viewport.label}/${theme}: accessible semantic gold`);
    assert.ok(initial.contrast >= 4.5, `${selected}/${viewport.label}/${theme}: gold contrast ${initial.contrast}`);
    assert.strictEqual(Math.round(initial.lockup.width), 148, `${selected}/${viewport.label}/${theme}: lockup width`);
    assert.strictEqual(Math.round(initial.lockup.height), 40, `${selected}/${viewport.label}/${theme}: lockup height`);
    if (initial.cta.visible) {
      assert.strictEqual(Math.round(initial.cta.width), Math.round(initial.lockup.width), `${selected}/${viewport.label}/${theme}: CTA width parity`);
      assert.strictEqual(Math.round(initial.cta.height), Math.round(initial.lockup.height), `${selected}/${viewport.label}/${theme}: CTA height parity`);
    }
    assert.strictEqual(initial.scenarioCount, 9, `${selected}/${viewport.label}/${theme}: scenario catalogue`);
    assert.strictEqual(initial.hasPhoneField, false, `${selected}/${viewport.label}/${theme}: no phone collection`);
    assert.strictEqual(initial.dialogCalls, 0, `${selected}/${viewport.label}/${theme}: no browser dialogs`);
    assert.strictEqual(initial.reducedMotion, true, `${selected}/${viewport.label}/${theme}: reduced motion emulated`);
    assert.ok(Number.parseFloat(initial.chipTransition) <= 0.001,
      `${selected}/${viewport.label}/${theme}: reduced transition ${initial.chipTransition}`);
    assert.ok(initial.overflow <= 1, `${selected}/${viewport.label}/${theme}: initial horizontal overflow ${initial.overflow}`);

    await page.click('#demoCallBtn');
    assert.match(await page.textContent('#demoFormNotice'), /business name/i,
      `${selected}/${viewport.label}/${theme}: inline validation`);
    assert.strictEqual(await page.getAttribute('#preCallModal', 'aria-hidden'), 'true',
      `${selected}/${viewport.label}/${theme}: validation precedes dialog`);

    const businessName = '<img src=x onerror="window.__homepageXss=1"> NorthStar Test';
    await page.fill('#demoBusinessName', businessName);
    await page.selectOption('#demoIndustry', 'Roofing');
    await page.click(`#scenarioChips [data-scenario="${scenarioKey}"]`);
    await page.click('#demoCallBtn');
    assert.strictEqual(await page.getAttribute('#preCallModal', 'aria-hidden'), 'false',
      `${selected}/${viewport.label}/${theme}: coaching opens`);
    assert.match(await page.textContent('#selectedScenarioContext'), new RegExp(scenarioKey.split('-')[0], 'i'),
      `${selected}/${viewport.label}/${theme}: selected context`);

    const modalBox = await page.locator('#preCallModal').boundingBox();
    assert.ok(modalBox, `${selected}/${viewport.label}/${theme}: dialog box`);
    await page.mouse.click(modalBox.x + 4, modalBox.y + 4);
    await page.waitForTimeout(30);
    assert.strictEqual(await page.getAttribute('#preCallModal', 'aria-hidden'), 'false',
      `${selected}/${viewport.label}/${theme}: outside click does not dismiss`);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.getAttribute('#preCallModal', 'aria-hidden'), 'true',
      `${selected}/${viewport.label}/${theme}: Escape dismisses deliberately`);
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.id), 'demoCallBtn',
      `${selected}/${viewport.label}/${theme}: focus returns`);

    await page.click('#demoCallBtn');
    await page.click(`#modalScenarioChips [data-scenario="${scenarioKey}"]`);
    await page.click('#modalCallBtn');
    await page.waitForSelector('#guidedPreviewActions:not([hidden])', { timeout: 10000 });
    await page.evaluate(() => document.querySelector('.footer').scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(50);

    const preview = await page.evaluate(() => {
      const transcript = document.getElementById('demoTranscriptBody');
      const footerLinks = document.querySelector('.footer-links');
      const themeControl = document.querySelector('.northstar-theme-control');
      const rect = element => element ? element.getBoundingClientRect().toJSON() : null;
      const stored = {};
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index);
        if (key.indexOf('northstar.homepage.') === 0) stored[key] = sessionStorage.getItem(key);
      }
      return {
        transcriptCount: transcript.querySelectorAll('.demo-msg').length,
        transcriptText: transcript.textContent,
        maliciousElements: transcript.querySelectorAll('img,script,svg,iframe').length,
        xss: window.__homepageXss || 0,
        status: document.getElementById('demoStatusLabel').textContent,
        booking: document.getElementById('demoBookingProb').textContent,
        notice: document.getElementById('guidedPreviewNotice').textContent,
        stored,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        footerLinks: rect(footerLinks),
        themeControl: rect(themeControl),
      };
    });
    assert.strictEqual(preview.transcriptCount, 4, `${selected}/${viewport.label}/${theme}: scenario transcript`);
    assert.ok(preview.transcriptText.length > 80, `${selected}/${viewport.label}/${theme}: meaningful transcript`);
    assert.strictEqual(preview.maliciousElements, 0, `${selected}/${viewport.label}/${theme}: safe transcript nodes`);
    assert.strictEqual(preview.xss, 0, `${selected}/${viewport.label}/${theme}: business-name payload inert`);
    assert.match(preview.status, /guided call ready/i, `${selected}/${viewport.label}/${theme}: ready state`);
    assert.strictEqual(preview.booking, 'Not calculated in guided preview', `${selected}/${viewport.label}/${theme}: no invented probability`);
    assert.match(preview.notice, /No call was placed and no data was sent or stored/i,
      `${selected}/${viewport.label}/${theme}: truthful completion`);
    assert.deepStrictEqual(Object.keys(preview.stored).sort(), [
      'northstar.homepage.industry',
      'northstar.homepage.scenario',
    ], `${selected}/${viewport.label}/${theme}: bounded session state`);
    assert.ok(!JSON.stringify(preview.stored).includes('NorthStar Test'),
      `${selected}/${viewport.label}/${theme}: business name not stored`);
    assert.ok(preview.overflow <= 1, `${selected}/${viewport.label}/${theme}: preview horizontal overflow ${preview.overflow}`);
    assert.strictEqual(intersects(preview.footerLinks, preview.themeControl), false,
      `${selected}/${viewport.label}/${theme}: footer controls do not overlap`);

    await page.click('#guidedTryAnother');
    assert.strictEqual(await page.getAttribute('#preCallModal', 'aria-hidden'), 'false',
      `${selected}/${viewport.label}/${theme}: repeat scenario shows coaching again`);
    await page.click('#modalCancelBtn');
    assert.strictEqual(await page.getAttribute('#preCallModal', 'aria-hidden'), 'true',
      `${selected}/${viewport.label}/${theme}: explicit review action closes`);

    const forbiddenRequests = requests.filter(request => {
      if (!/^https?:/i.test(request.url)) return false;
      const target = new URL(request.url);
      return request.method !== 'GET' || target.origin !== origin || target.pathname.startsWith('/api/');
    });
    assert.deepStrictEqual(forbiddenRequests, [], `${selected}/${viewport.label}/${theme}: provider-free GET-only path`);
    assert.deepStrictEqual(consoleErrors, [], `${selected}/${viewport.label}/${theme}: console errors`);
    assert.deepStrictEqual(pageErrors, [], `${selected}/${viewport.label}/${theme}: page errors`);

    evidence.cases.push({
      browser: selected,
      viewport: viewport.label,
      theme,
      scenario: scenarioKey,
      moduleReadyMs,
      domInteractiveMs: initial.domInteractiveMs,
      contrast: Number(initial.contrast.toFixed(2)),
      requests: requests.length,
      transcriptTurns: preview.transcriptCount,
      result: 'pass',
    });
  } finally {
    await page.close();
    await context.close();
  }
}

async function main() {
  const selected = process.argv[2];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'usage: node homepage-refresh.js <chrome|webkit>');
  const runtime = resolveBrowserRuntime(selected);
  const evidence = {
    browser: selected,
    executablePath: runtime.executablePath,
    executableSha256: hashFile(runtime.executablePath),
    cases: [],
  };
  let server;
  let browser;
  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    evidence.version = browser.version();
    let scenarioIndex = 0;
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        await inspectCase(browser, origin, selected, viewport, theme, SCENARIO_SEQUENCES[selected][scenarioIndex], evidence);
        scenarioIndex += 1;
      }
    }
    assert.strictEqual(evidence.cases.length, 6, `${selected}: complete viewport/theme matrix`);
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
