'use strict';

const assert = require('assert');
const { app } = require('../../src/server');
const { MOUNTED_THEME_PAGES } = require('../helpers/site-theme-pages');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { assertAccessibilityAudit, auditInteractiveStates, auditMountedAccessibility } = require('../helpers/theme-accessibility-audit');

const VIEWPORTS = Object.freeze([
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 },
]);
const THEMES = Object.freeze(['dark', 'light']);
const INTERNAL_LANGUAGE = /\bPR (?:A|B1|B2)\b|PR #|pull request|phase B[12]\b|internal phase|development milestone|implementation availability/i;
const RESET_TOKEN = 'T'.repeat(43);

function jsonResponse(body, status = 200) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function accountFixture(pathname) {
  const pending = pathname === '/account/pending';
  return {
    account: {
      user: { id: '00000000-0000-4000-8000-000000000101', status: pending ? 'pending' : 'active', email: '' },
      organization: { id: '00000000-0000-4000-8000-000000000201', name: 'NorthStar Theme Fixture' },
      memberships: [{ role: 'owner' }],
      onboarding: { status: 'complete' },
      subscription: pending
        ? { safe: true, state: 'pending_verification', readOnly: true, showTrialBanner: true }
        : { safe: true, state: 'active', readOnly: false, showTrialBanner: false },
    },
  };
}

async function installLocalApiBoundary(context, origin, evidence, options = {}) {
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.strictEqual(url.origin, origin, `API destination escaped loopback: ${url.origin}`);
    const framePath = (() => {
      try { return new URL(request.frame().url()).pathname; } catch (_error) { return ''; }
    })();
    const referrer = request.headers().referer || '';
    evidence.api.push({ method: request.method(), path: url.pathname, referrerHasActionToken: /[?&]token=/.test(referrer) });

    if (request.method() === 'POST' && options.recovery === true) {
      const outcomes = options.outcomes || {};
      await new Promise(resolve => setTimeout(resolve, options.delayMs || 80));
      if (url.pathname === '/api/auth/forgot-password') {
        if (outcomes.forgot === 'unavailable') return route.fulfill(jsonResponse({ error: 'temporarily_unavailable' }, 503));
        return route.fulfill(jsonResponse({
          accepted: true,
          message: 'If the account is eligible, password-reset instructions will be sent.',
        }, 202));
      }
      if (url.pathname === '/api/auth/reset-password') {
        const resetStatus = { invalid: 400, expired: 410, replay: 409, unavailable: 503 }[outcomes.reset];
        if (resetStatus) return route.fulfill(jsonResponse({ error: 'reset_unavailable' }, resetStatus));
        return route.fulfill(jsonResponse({ success: true }, 200));
      }
      if (url.pathname === '/api/auth/verify-email') {
        const verifyStatus = { invalid: 400, expired: 410, replay: 409, unavailable: 503 }[outcomes.verify];
        if (verifyStatus) return route.fulfill(jsonResponse({ error: 'verification_unavailable' }, verifyStatus));
        return route.fulfill(jsonResponse({ success: true }, 200));
      }
    }

    assert.strictEqual(request.method(), 'GET', `unexpected automatic mutation ${request.method()} ${url.pathname}`);
    if (url.pathname === '/api/auth/me') return route.fulfill(jsonResponse(accountFixture(framePath)));
    if (url.pathname === '/api/account/subscription') {
      const pending = framePath === '/account/pending';
      return route.fulfill(jsonResponse({
        subscription: pending
          ? {
            safe: true, state: 'pending_verification', trialStart: null, trialEnd: null,
            serverTimestamp: '2026-08-03T12:00:00.000Z', daysRemaining: null,
            endsToday: false, readOnly: true, upgradeAvailable: false, showTrialBanner: true,
          }
          : { safe: true, state: 'active', serverTimestamp: '2026-08-03T12:00:00.000Z' },
      }));
    }
    if (url.pathname === '/api/v1/business-profile') {
      return route.fulfill(jsonResponse({ success: true, profile: null }));
    }
    if (url.pathname === '/api/health') {
      return route.fulfill(jsonResponse({ status: 'ok', database: 'healthy', persistence: 'healthy' }));
    }
    return route.fulfill(jsonResponse({ success: true, data: {}, records: [], items: [] }));
  });
}

function installRequestInventory(context, origin, evidence) {
  context.on('request', request => {
    const url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    assert.strictEqual(url.origin, origin, `external destination: ${url.origin}`);
    const headers = request.headers();
    assert.strictEqual(Object.keys(headers).some(name => name.toLowerCase() === 'authorization'), false);
    evidence.requests.push({ method: request.method(), path: url.pathname, resourceType: request.resourceType() });
    if (process.env.NORTHSTAR_THEME_PROGRESS === '1') {
      process.stderr.write(`THEME_REQUEST ${request.method()} ${url.pathname} ${request.resourceType()}\n`);
    }
  });
  if (process.env.NORTHSTAR_THEME_PROGRESS === '1') {
    context.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === origin) process.stderr.write(`THEME_RESPONSE ${response.status()} ${url.pathname}\n`);
    });
  }
}

async function computedContrast(locator) {
  return locator.evaluate(element => {
    function rgb(value) {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return match ? match.slice(1).map(Number) : null;
    }
    function luminance(values) {
      const converted = values.map(channel => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return (0.2126 * converted[0]) + (0.7152 * converted[1]) + (0.0722 * converted[2]);
    }
    const foregroundValue = getComputedStyle(element).color;
    const foreground = rgb(foregroundValue);
    let owner = element;
    let background = null;
    let backgroundValue = '';
    while (owner && !background) {
      const candidate = getComputedStyle(owner).backgroundColor;
      if (candidate !== 'rgba(0, 0, 0, 0)' && candidate !== 'transparent') {
        background = rgb(candidate);
        backgroundValue = candidate;
      }
      owner = owner.parentElement;
    }
    if (!background) {
      backgroundValue = getComputedStyle(document.body).backgroundColor;
      background = rgb(backgroundValue);
    }
    const bright = Math.max(luminance(foreground), luminance(background));
    const dark = Math.min(luminance(foreground), luminance(background));
    return { ratio: (bright + 0.05) / (dark + 0.05), foreground: foregroundValue, background: backgroundValue };
  });
}

async function installThemeInstrumentation(context, savedTheme) {
  await context.addInitScript(theme => {
    window.__northstarThemeEvidence = {
      firstFrames: [],
      storageListeners: 0,
      systemListeners: 0,
    };
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function instrumented(type, listener) {
      if (type === 'storage' && listener && listener.name === 'onStorage') {
        window.__northstarThemeEvidence.storageListeners += 1;
      }
      if (type === 'change' && listener && listener.name === 'onSystemChange') {
        window.__northstarThemeEvidence.systemListeners += 1;
      }
      return original.apply(this, arguments);
    };
    if (theme) {
      try { localStorage.setItem('northstar-theme', theme); } catch (_error) {}
    }
    requestAnimationFrame(() => {
      window.__northstarThemeEvidence.firstFrames.push(document.documentElement.getAttribute('data-theme'));
    });
  }, savedTheme);
}

async function assertMountedTheme(page, route, expectedTheme) {
  await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.locator('[data-northstar-theme-toggle]').waitFor({ state: 'visible', timeout: 5000 })
    .catch(async error => {
      const diagnostic = await page.evaluate(() => ({
        url: location.href,
        readyState: document.readyState,
        themeController: typeof window.NorthStarTheme,
        themeScripts: document.querySelectorAll('script[src="/js/theme.js"]').length,
        body: Boolean(document.body),
      })).catch(() => ({ url: page.url(), evaluation: 'unavailable' }));
      throw new Error(`${route}: ${error.message} ${JSON.stringify(diagnostic)}`);
    });
  await page.waitForFunction(() => window.__northstarThemeEvidence.firstFrames.length > 0, null, { timeout: 3000 });
  await page.waitForFunction(() => {
    const link = document.querySelector('link[href="/css/style.css"]');
    if (!link || !link.sheet) return false;
    try { return link.sheet.cssRules.length > 0; } catch (_error) { return false; }
  }, null, { timeout: 5000 }).catch(async error => {
    const stylesheets = await page.evaluate(() => Array.from(document.styleSheets).map(sheet => ({
      href: sheet.href,
      rules: (() => { try { return sheet.cssRules.length; } catch (_error) { return -1; } })(),
    }))).catch(() => []);
    throw new Error(`${route} ${expectedTheme} stylesheet unavailable: ${error.message} ${JSON.stringify(stylesheets)}`);
  });
  await page.waitForFunction(expected => {
    const match = getComputedStyle(document.body).color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return false;
    const channels = match.slice(1).map(Number);
    const brightness = (channels[0] + channels[1] + channels[2]) / (3 * 255);
    return expected === 'dark' ? brightness > 0.55 : brightness < 0.45;
  }, expectedTheme, { timeout: 3000 }).catch(async error => {
    const diagnostic = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const root = getComputedStyle(document.documentElement);
      const link = document.querySelector('link[href="/css/style.css"]');
      const rules = [];
      if (link && link.sheet) {
        try {
          for (const rule of Array.from(link.sheet.cssRules)) {
            if (rule.selectorText === 'body' || rule.selectorText === '[data-theme="dark"] body') {
              rules.push({ selector: rule.selectorText, color: rule.style.color, background: rule.style.background });
            }
          }
        } catch (_error) {}
      }
      return {
        bodyColor: body.color,
        bodyBackground: body.backgroundColor,
        rootColor: root.color,
        rootBackground: root.backgroundColor,
        neutral800: root.getPropertyValue('--neutral-800').trim(),
        themeText: root.getPropertyValue('--theme-text').trim(),
        rules,
      };
    }).catch(() => ({ unavailable: true }));
    throw new Error(`${route} ${expectedTheme} body theme unavailable: ${error.message} ${JSON.stringify(diagnostic)}`);
  });
  const result = await page.evaluate(({ expected, forbiddenSource }) => {
    const toggle = document.querySelector('[data-northstar-theme-toggle]');
    const bounds = toggle.getBoundingClientRect();
    const style = getComputedStyle(document.body);
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyBackground = style.backgroundColor;
    const resources = performance.getEntriesByType('resource');
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      colorScheme: document.documentElement.style.colorScheme,
      toggleCount: document.querySelectorAll('[data-northstar-theme-toggle]').length,
      controlCount: document.querySelectorAll('[data-northstar-theme-control]').length,
      ariaPressed: toggle.getAttribute('aria-pressed'),
      ariaLabel: toggle.getAttribute('aria-label'),
      toggleInside: bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1,
      noOverflow: document.documentElement.scrollWidth <= innerWidth,
      background: bodyBackground === 'rgba(0, 0, 0, 0)' || bodyBackground === 'transparent'
        ? rootStyle.backgroundColor
        : bodyBackground,
      color: style.color,
      rootColor: rootStyle.color,
      neutral800: rootStyle.getPropertyValue('--neutral-800').trim(),
      themeLoads: resources.filter(entry => new URL(entry.name).pathname === '/js/theme.js').length,
      externalResources: resources.filter(entry => !['data:', 'blob:'].includes(new URL(entry.name).protocol) && new URL(entry.name).origin !== location.origin).map(entry => entry.name),
      internalLanguage: new RegExp(forbiddenSource, 'i').test(document.body.innerText),
      firstFrames: window.__northstarThemeEvidence.firstFrames.slice(),
      storageListeners: window.__northstarThemeEvidence.storageListeners,
      systemListeners: window.__northstarThemeEvidence.systemListeners,
      expected,
    };
  }, { expected: expectedTheme, forbiddenSource: INTERNAL_LANGUAGE.source });

  assert.strictEqual(result.theme, expectedTheme);
  assert.strictEqual(result.colorScheme, expectedTheme);
  assert.strictEqual(result.toggleCount, 1);
  assert.strictEqual(result.controlCount, 1);
  assert.strictEqual(result.ariaPressed, expectedTheme === 'dark' ? 'true' : 'false');
  assert.strictEqual(result.ariaLabel, `Switch to ${expectedTheme === 'dark' ? 'light' : 'dark'} theme`);
  assert.strictEqual(result.toggleInside, true);
  assert.strictEqual(result.noOverflow, true);
  assert.notStrictEqual(result.background, 'rgba(0, 0, 0, 0)');
  assert.notStrictEqual(result.color, 'rgba(0, 0, 0, 0)');
  assert.strictEqual(result.themeLoads, 1);
  assert.deepStrictEqual(result.externalResources, []);
  assert.strictEqual(result.internalLanguage, false);
  assert.strictEqual(result.firstFrames[0], expectedTheme, `wrong first frame at ${route}`);
  assert.strictEqual(result.storageListeners, 1);
  assert.strictEqual(result.systemListeners, 1);
  const bodyContrast = await computedContrast(page.locator('body'));
  const toggleContrast = await computedContrast(page.locator('[data-northstar-theme-toggle]'));
  assert.ok(bodyContrast.ratio >= 4.5, `body contrast at ${route}: ${JSON.stringify({ bodyContrast, result })}`);
  assert.ok(toggleContrast.ratio >= 4.5, `toggle contrast at ${route}: ${JSON.stringify(toggleContrast)}`);
  // Let source-owned entrance transitions settle before evaluating steady-state contrast.
  await page.waitForTimeout(650);
  const accessibility = await auditMountedAccessibility(page);
  const interactiveStates = await auditInteractiveStates(page);

  const toggledTheme = expectedTheme === 'dark' ? 'light' : 'dark';
  await page.locator('[data-northstar-theme-toggle]').click();
  assert.strictEqual(await page.evaluate(() => NorthStarTheme.getTheme()), toggledTheme);
  assert.strictEqual(
    await page.locator('[data-northstar-theme-toggle]').getAttribute('aria-pressed'),
    toggledTheme === 'dark' ? 'true' : 'false'
  );
  await page.evaluate(theme => NorthStarTheme.setTheme(theme), expectedTheme);
  assert.strictEqual(await page.evaluate(() => NorthStarTheme.getTheme()), expectedTheme);

  const listenerCounts = await page.evaluate(() => {
    NorthStarTheme.init();
    NorthStarTheme.init();
    return {
      toggles: document.querySelectorAll('[data-northstar-theme-toggle]').length,
      controls: document.querySelectorAll('[data-northstar-theme-control]').length,
      storage: window.__northstarThemeEvidence.storageListeners,
      system: window.__northstarThemeEvidence.systemListeners,
    };
  });
  assert.deepStrictEqual(listenerCounts, { toggles: 1, controls: 1, storage: 1, system: 1 });

  return { ...result, accessibility, interactiveStates };
}

async function runMountedMatrix(engine, viewport, origin) {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
  const evidence = [];
  const accessibilityFailures = [];
  try {
    const selectedThemes = process.env.NORTHSTAR_THEME_ONLY
      ? THEMES.filter(theme => theme === process.env.NORTHSTAR_THEME_ONLY)
      : THEMES;
    assert.ok(selectedThemes.length > 0, 'NORTHSTAR_THEME_ONLY must be dark or light');
    for (const theme of selectedThemes) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const inventory = { requests: [], api: [] };
      const pageErrors = [];
      const consoleErrors = [];
      try {
        await installThemeInstrumentation(context, theme);
        await installLocalApiBoundary(context, origin, inventory);
        installRequestInventory(context, origin, inventory);
        const page = await context.newPage();
        page.on('pageerror', error => pageErrors.push(String(error && error.message || error)));
        page.on('console', message => {
          if (message.type() === 'error') consoleErrors.push(message.text());
        });
        const selectedPages = process.env.NORTHSTAR_THEME_ROUTE
          ? MOUNTED_THEME_PAGES.filter(pageEntry => pageEntry.route === process.env.NORTHSTAR_THEME_ROUTE)
          : MOUNTED_THEME_PAGES;
        assert.ok(selectedPages.length > 0, 'NORTHSTAR_THEME_ROUTE must be a mounted theme route');
        for (const mounted of selectedPages) {
          if (process.env.NORTHSTAR_THEME_PROGRESS === '1') {
            process.stderr.write(`THEME_PROGRESS ${engine} ${viewport.label} ${theme} ${mounted.route}\n`);
          }
          const result = await assertMountedTheme(page, `${origin}${mounted.route}`, theme);
          evidence.push({
            route: mounted.route,
            theme,
            background: result.background,
            color: result.color,
            auditedTextElements: result.accessibility.auditedTextElements,
            interactiveStateGroups: result.interactiveStates.groups,
          });
          if (result.accessibility.contrastFailures.length || result.accessibility.uiFailures.length || result.accessibility.overlaps.length || result.accessibility.clipped.length
            || result.interactiveStates.hoverFailures.length || result.interactiveStates.focusFailures.length) {
            accessibilityFailures.push({
              route: mounted.route,
              theme,
              contrastFailures: result.accessibility.contrastFailures,
              uiFailures: result.accessibility.uiFailures,
              overlaps: result.accessibility.overlaps,
              clipped: result.accessibility.clipped,
              hoverFailures: result.interactiveStates.hoverFailures,
              focusFailures: result.interactiveStates.focusFailures,
            });
          }
        }
        assert.deepStrictEqual(pageErrors, []);
        assert.deepStrictEqual(consoleErrors, []);
        assert.strictEqual(inventory.requests.some(item => !['GET'].includes(item.method)), false);
        assert.strictEqual(inventory.api.some(item => item.method !== 'GET'), false);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const accessibilityDiagnostic = accessibilityFailures.map(failure => ({
    route: failure.route,
    theme: failure.theme,
    contrastCount: failure.contrastFailures.length,
    contrastFailures: failure.contrastFailures.slice(0, 12),
    uiFailures: failure.uiFailures.slice(0, 12),
    overlaps: failure.overlaps,
    clipped: failure.clipped,
    hoverFailures: failure.hoverFailures,
    focusFailures: failure.focusFailures,
  }));
  assert.strictEqual(accessibilityFailures.length, 0, `${engine} ${viewport.label} mounted accessibility failures: ${JSON.stringify(accessibilityDiagnostic)}`);
  if (!process.env.NORTHSTAR_THEME_ONLY && !process.env.NORTHSTAR_THEME_ROUTE) {
    for (const mounted of MOUNTED_THEME_PAGES) {
      const dark = evidence.find(item => item.route === mounted.route && item.theme === 'dark');
      const light = evidence.find(item => item.route === mounted.route && item.theme === 'light');
      assert.ok(dark && light, `both themes rendered for ${mounted.route}`);
      assert.notStrictEqual(dark.background, light.background, `page background changes for ${mounted.route}`);
      assert.notStrictEqual(dark.color, light.color, `page text changes for ${mounted.route}`);
    }
  }
  return {
    engine,
    viewport: viewport.label,
    pages: evidence.length,
    auditedTextElements: evidence.reduce((total, item) => total + item.auditedTextElements, 0),
    interactiveStateGroups: evidence.reduce((total, item) => total + item.interactiveStateGroups, 0),
  };
}

async function runPreferenceMatrix(engine, origin) {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    const evidence = { requests: [], api: [] };
    await installLocalApiBoundary(context, origin, evidence);
    installRequestInventory(context, origin, evidence);
    const page = await context.newPage();
    if (process.env.NORTHSTAR_THEME_PROGRESS === '1') process.stderr.write(`THEME_PREFERENCE ${engine} system-dark\n`);
    await page.goto(`${origin}/login`);
    await page.locator('[data-northstar-theme-toggle]').waitFor();
    assert.strictEqual(await page.evaluate(() => NorthStarTheme.getTheme()), 'dark');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('northstar-theme')), null);

    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => NorthStarTheme.getTheme() === 'light', null, { timeout: 3000 });
    if (process.env.NORTHSTAR_THEME_PROGRESS === '1') process.stderr.write(`THEME_PREFERENCE ${engine} system-change\n`);
    await page.locator('[data-northstar-theme-toggle]').press('Enter');
    await page.waitForFunction(() => NorthStarTheme.getTheme() === 'dark', null, { timeout: 3000 });
    const keyboardFocus = await page.locator('[data-northstar-theme-toggle]').evaluate(element => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    assert.notStrictEqual(keyboardFocus.outlineStyle, 'none');
    assert.notStrictEqual(keyboardFocus.outlineWidth, '0px');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('northstar-theme')), 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(30);
    assert.strictEqual(await page.evaluate(() => NorthStarTheme.getTheme()), 'dark');
    await page.reload();
    assert.strictEqual(await page.evaluate(() => NorthStarTheme.getTheme()), 'dark');
    await page.goto(`${origin}/forgot-password`);
    assert.strictEqual(await page.evaluate(() => NorthStarTheme.getTheme()), 'dark');
    assert.deepStrictEqual(await page.evaluate(() => Object.keys(localStorage).sort()), ['northstar-theme']);
    await context.close();

    if (process.env.NORTHSTAR_THEME_PROGRESS === '1') process.stderr.write(`THEME_PREFERENCE ${engine} corrupt-storage\n`);
    const corrupt = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await corrupt.addInitScript(() => localStorage.setItem('northstar-theme', 'active:owner:tenant'));
    const corruptEvidence = { requests: [], api: [] };
    await installLocalApiBoundary(corrupt, origin, corruptEvidence);
    installRequestInventory(corrupt, origin, corruptEvidence);
    const corruptPage = await corrupt.newPage();
    await corruptPage.goto(`${origin}/login`);
    assert.strictEqual(await corruptPage.evaluate(() => NorthStarTheme.getTheme()), 'dark');
    assert.strictEqual(await corruptPage.evaluate(() => localStorage.getItem('northstar-theme')), 'active:owner:tenant');
    await corruptPage.locator('[data-northstar-theme-toggle]').click();
    assert.strictEqual(await corruptPage.evaluate(() => localStorage.getItem('northstar-theme')), 'light');
    await corrupt.close();

    if (process.env.NORTHSTAR_THEME_PROGRESS === '1') process.stderr.write(`THEME_PREFERENCE ${engine} unavailable-storage\n`);
    const unavailable = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await unavailable.addInitScript(() => {
      Storage.prototype.getItem = function unavailableGet() { throw new Error('unavailable'); };
      Storage.prototype.setItem = function unavailableSet() { throw new Error('unavailable'); };
    });
    const unavailableEvidence = { requests: [], api: [] };
    await installLocalApiBoundary(unavailable, origin, unavailableEvidence);
    installRequestInventory(unavailable, origin, unavailableEvidence);
    const unavailablePage = await unavailable.newPage();
    await unavailablePage.goto(`${origin}/login`);
    assert.strictEqual(await unavailablePage.evaluate(() => NorthStarTheme.getTheme()), 'dark');
    await unavailablePage.locator('[data-northstar-theme-toggle]').click();
    assert.strictEqual(await unavailablePage.evaluate(() => NorthStarTheme.getTheme()), 'light');
    await unavailable.close();
  } finally {
    await browser.close();
  }
  return { engine, systemPreference: true, systemChange: true, explicitPersistence: true, corruptStorage: true, unavailableStorage: true };
}

async function runAccessibilityAuditNegativeControl(engine) {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#0b0d17;color:#f1f2f6;min-height:100vh">
      <div style="background:transparent"><span id="hiddenContrast" style="color:#131624">Unreadable nested text</span></div>
      <input id="weakBoundary" aria-label="Fixture field" style="border:1px solid #131624;background:#0b0d17;color:#f1f2f6">
      <button id="overlap" style="position:fixed;right:10px;bottom:10px;width:60px;height:50px">Action</button>
      <div data-northstar-theme-control style="position:fixed;right:10px;bottom:10px"><button data-northstar-theme-toggle aria-label="Fixture theme" style="width:44px;height:44px">T</button></div>
    </body></html>`);
    const audit = await auditMountedAccessibility(page);
    assert.strictEqual(audit.contrastFailures.some(failure => failure.path === '#hiddenContrast' && failure.ratio < 1.2), true);
    assert.strictEqual(audit.uiFailures.some(failure => failure.path === '#weakBoundary'), true);
    assert.strictEqual(audit.overlaps.some(overlap => overlap.path === '#overlap'), true);
    return { engine, inheritedBackgroundContrast: true, componentBoundary: true, overlap: true };
  } finally {
    await browser.close();
  }
}

async function assertPresentationState(page, label, expectedTheme) {
  await page.locator('[data-northstar-theme-toggle]').waitFor({ state: 'visible', timeout: 3000 });
  assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), expectedTheme, `${label} theme`);
  assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label} horizontal overflow`);
  const audit = await auditMountedAccessibility(page);
  assertAccessibilityAudit(audit, label);
  return audit;
}

async function assertActionTokensAbsent(page, tokens, label) {
  const surfaces = await page.evaluate(values => {
    function contains(value) {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      return values.some(token => serialized.includes(token));
    }
    const globalsContainToken = Object.getOwnPropertyNames(window).some(name => {
      try { return typeof window[name] === 'string' && contains(window[name]); } catch (_error) { return false; }
    });
    return {
      visibleUrl: contains(location.href),
      dom: contains(document.documentElement.outerHTML),
      localStorage: contains(Object.fromEntries(Object.entries(localStorage))),
      sessionStorage: contains(Object.fromEntries(Object.entries(sessionStorage))),
      globals: globalsContainToken,
      resourceUrls: performance.getEntriesByType('resource').some(entry => contains(entry.name)),
    };
  }, tokens);
  assert.deepStrictEqual(surfaces, {
    visibleUrl: false,
    dom: false,
    localStorage: false,
    sessionStorage: false,
    globals: false,
    resourceUrls: false,
  }, `${label} action-token surface`);
}

async function runRecoveryMatrix(engine, viewport, theme, origin) {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: theme });
  const evidence = { requests: [], api: [] };
  const outcomes = { forgot: 'accepted', reset: 'success', verify: 'success' };
  const actionTokens = [RESET_TOKEN, 'U'.repeat(43), 'V'.repeat(43), 'W'.repeat(43), 'X'.repeat(43), 'Y'.repeat(43)];
  try {
    await installThemeInstrumentation(context, theme);
    await installLocalApiBoundary(context, origin, evidence, { recovery: true, outcomes, delayMs: 250 });
    installRequestInventory(context, origin, evidence);
    const page = await context.newPage();

    if (process.env.NORTHSTAR_THEME_PROGRESS === '1') process.stderr.write(`THEME_RECOVERY ${engine} ${viewport.label} ${theme} forgot-validation\n`);
    await page.goto(`${origin}/forgot-password`);
    assert.strictEqual(await page.locator('h1').textContent(), 'Reset your password');
    assert.strictEqual(await page.locator('#email').getAttribute('type'), 'email');
    assert.strictEqual(await page.locator('.account-auth-return a').getAttribute('href'), '/login');
    await assertPresentationState(page, `${engine} ${viewport.label} ${theme} forgot initial`, theme);
    const validationStart = evidence.api.length;
    await page.locator('#forgotForm').evaluate(form => form.requestSubmit());
    assert.strictEqual(evidence.api.length, validationStart, 'forgot validation creates no request');
    assert.strictEqual(await page.locator('#email').evaluate(input => input.matches(':invalid')), true);

    await page.fill('#email', 'theme-fixture@example.test');
    await page.locator('#forgotForm button[type="submit"]').click();
    assert.strictEqual(await page.locator('#forgotForm button[type="submit"]').isDisabled(), true);
    assert.strictEqual(await page.locator('#forgotForm').getAttribute('aria-busy'), 'true');
    await assertPresentationState(page, `${engine} ${viewport.label} ${theme} forgot loading`, theme);
    await page.waitForFunction(() => document.getElementById('forgotStatus').dataset.state === 'success', null, { timeout: 3000 });
    await page.waitForTimeout(220);
    assert.match(await page.locator('#forgotStatus').textContent(), /eligible/i);
    await assertPresentationState(page, `${engine} ${viewport.label} ${theme} forgot enumeration-safe success`, theme);

    outcomes.forgot = 'unavailable';
    await page.reload();
    await page.fill('#email', 'other-theme-fixture@example.test');
    await page.locator('#forgotForm button[type="submit"]').click();
    assert.strictEqual(await page.locator('#forgotForm button[type="submit"]').isDisabled(), true);
    await assertPresentationState(page, `${engine} ${viewport.label} ${theme} forgot unavailable loading`, theme);
    await page.waitForFunction(() => document.getElementById('forgotStatus').dataset.state === 'error', null, { timeout: 3000 });
    await page.waitForTimeout(220);
    assert.strictEqual(await page.locator('#forgotStatus').textContent(), 'The request could not be completed. Try again later.');
    await assertPresentationState(page, `${engine} ${viewport.label} ${theme} forgot unavailable`, theme);

    if (process.env.NORTHSTAR_THEME_PROGRESS === '1') process.stderr.write(`THEME_RECOVERY ${engine} ${viewport.label} ${theme} reset-missing-malformed\n`);
    const resetPostsBeforeMissing = evidence.api.filter(item => item.path === '/api/auth/reset-password').length;
    await page.goto(`${origin}/reset-password`);
    assert.strictEqual(await page.locator('#resetForm').isVisible(), false);
    assert.match(await page.locator('#resetStatus').textContent(), /invalid or expired/i);
    await assertPresentationState(page, `${engine} ${viewport.label} ${theme} reset missing`, theme);
    await page.goto(`${origin}/reset-password?token=malformed`);
    assert.strictEqual(page.url(), `${origin}/reset-password`);
    assert.strictEqual(await page.locator('#resetForm').isVisible(), false);
    assert.match(await page.locator('#resetStatus').textContent(), /invalid or expired/i);
    await assertPresentationState(page, `${engine} ${viewport.label} ${theme} reset malformed`, theme);
    assert.strictEqual(evidence.api.filter(item => item.path === '/api/auth/reset-password').length, resetPostsBeforeMissing);

    const resetCases = [
      { outcome: 'success', token: actionTokens[0], state: 'success' },
      { outcome: 'invalid', token: actionTokens[1], state: 'error' },
      { outcome: 'expired', token: actionTokens[2], state: 'error' },
      { outcome: 'replay', token: actionTokens[3], state: 'error' },
      { outcome: 'unavailable', token: actionTokens[4], state: 'error' },
    ];
    for (const resetCase of resetCases) {
      outcomes.reset = resetCase.outcome;
      if (process.env.NORTHSTAR_THEME_PROGRESS === '1') process.stderr.write(`THEME_RECOVERY ${engine} ${viewport.label} ${theme} reset-${resetCase.outcome}\n`);
      await page.goto(`${origin}/reset-password?token=${resetCase.token}`);
      assert.strictEqual(page.url(), `${origin}/reset-password`);
      assert.strictEqual(await page.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
      assert.strictEqual(await page.locator('#resetForm').isVisible(), true);
      if (resetCase.outcome === 'success') {
        const weakStart = evidence.api.length;
        await page.fill('#password', 'too-short');
        await page.locator('#resetForm').evaluate(form => form.requestSubmit());
        assert.strictEqual(evidence.api.length, weakStart, 'weak password creates no reset request');
        assert.strictEqual(await page.locator('#password').evaluate(input => input.matches(':invalid')), true);
      }
      await page.fill('#password', 'NorthStar-theme-fixture-123!');
      await page.locator('#resetForm button[type="submit"]').click();
      assert.strictEqual(await page.locator('#resetForm button[type="submit"]').isDisabled(), true);
      await assertPresentationState(page, `${engine} ${viewport.label} ${theme} reset ${resetCase.outcome} loading`, theme);
      await page.waitForFunction(expected => document.getElementById('resetStatus').dataset.state === expected, resetCase.state, { timeout: 3000 });
      await page.waitForTimeout(220);
      if (resetCase.state === 'success') assert.match(await page.locator('#resetStatus').textContent(), /Password reset/i);
      else assert.match(await page.locator('#resetStatus').textContent(), /invalid or expired/i);
      await assertPresentationState(page, `${engine} ${viewport.label} ${theme} reset ${resetCase.outcome}`, theme);
      await assertActionTokensAbsent(page, actionTokens, `reset ${resetCase.outcome}`);
    }

    if (process.env.NORTHSTAR_THEME_PROGRESS === '1') process.stderr.write(`THEME_RECOVERY ${engine} ${viewport.label} ${theme} verify-missing-malformed\n`);
    const verifyPostsBeforeMissing = evidence.api.filter(item => item.path === '/api/auth/verify-email').length;
    await page.goto(`${origin}/verify-email`);
    assert.strictEqual(await page.locator('#verifyCard').getAttribute('data-state'), 'failure');
    await assertPresentationState(page, `${engine} ${viewport.label} ${theme} verify missing`, theme);
    await page.goto(`${origin}/verify-email?token=malformed`);
    assert.strictEqual(page.url(), `${origin}/verify-email`);
    assert.strictEqual(await page.locator('#verifyCard').getAttribute('data-state'), 'failure');
    await assertPresentationState(page, `${engine} ${viewport.label} ${theme} verify malformed`, theme);
    assert.strictEqual(evidence.api.filter(item => item.path === '/api/auth/verify-email').length, verifyPostsBeforeMissing);

    const verifyCases = [
      { outcome: 'success', token: actionTokens[0], state: 'success' },
      { outcome: 'invalid', token: actionTokens[1], state: 'failure' },
      { outcome: 'expired', token: actionTokens[2], state: 'failure' },
      { outcome: 'replay', token: actionTokens[3], state: 'failure' },
      { outcome: 'unavailable', token: actionTokens[5], state: 'failure' },
    ];
    for (const verifyCase of verifyCases) {
      outcomes.verify = verifyCase.outcome;
      if (process.env.NORTHSTAR_THEME_PROGRESS === '1') process.stderr.write(`THEME_RECOVERY ${engine} ${viewport.label} ${theme} verify-${verifyCase.outcome}\n`);
      await page.goto(`${origin}/verify-email?token=${verifyCase.token}`);
      assert.strictEqual(page.url(), `${origin}/verify-email`);
      assert.strictEqual(await page.locator('meta[name="referrer"]').getAttribute('content'), 'no-referrer');
      assert.strictEqual(await page.locator('#verifyCard').getAttribute('data-state'), 'checking');
      await assertPresentationState(page, `${engine} ${viewport.label} ${theme} verify ${verifyCase.outcome} checking`, theme);
      await page.waitForFunction(expected => document.getElementById('verifyCard').dataset.state === expected, verifyCase.state, { timeout: 3000 });
      await page.waitForTimeout(220);
      if (verifyCase.state === 'success') {
        assert.strictEqual(await page.locator('#verifyTitle').textContent(), 'Email verified');
        assert.match(await page.locator('#verifyStatus').textContent(), /14-day trial/i);
      } else {
        assert.strictEqual(await page.locator('#verifyTitle').textContent(), 'Verification link unavailable');
        assert.match(await page.locator('#verifyStatus').textContent(), /invalid or expired/i);
      }
      await assertPresentationState(page, `${engine} ${viewport.label} ${theme} verify ${verifyCase.outcome}`, theme);
      await assertActionTokensAbsent(page, actionTokens, `verify ${verifyCase.outcome}`);
    }

    const postPaths = evidence.api.filter(item => item.method === 'POST').map(item => item.path);
    assert.strictEqual(postPaths.filter(path => path === '/api/auth/forgot-password').length, 2);
    assert.strictEqual(postPaths.filter(path => path === '/api/auth/reset-password').length, 5);
    assert.strictEqual(postPaths.filter(path => path === '/api/auth/verify-email').length, 5);
    assert.strictEqual(evidence.api.some(item => item.referrerHasActionToken), false);
    assert.strictEqual(evidence.requests.some(item => !['GET', 'POST'].includes(item.method)), false);
  } finally {
    await context.close();
    await browser.close();
  }
  return {
    engine,
    viewport: viewport.label,
    theme,
    forgotPosts: 2,
    resetPosts: 5,
    verifyPosts: 5,
    presentationStates: 29,
    rawTokenRetained: false,
    providerDestinations: 0,
  };
}

async function main() {
  const selection = process.env.NORTHSTAR_BROWSER || 'both';
  assert.ok(['chrome', 'webkit', 'both'].includes(selection), 'NORTHSTAR_BROWSER must be chrome, webkit, or both');
  const engines = selection === 'both' ? ['chrome', 'webkit'] : [selection];
  const selectedViewports = process.env.NORTHSTAR_THEME_VIEWPORT
    ? VIEWPORTS.filter(viewport => viewport.label === process.env.NORTHSTAR_THEME_VIEWPORT)
    : VIEWPORTS;
  assert.ok(selectedViewports.length > 0, 'NORTHSTAR_THEME_VIEWPORT must be 1440x900 or 390x844');
  const phase = process.env.NORTHSTAR_THEME_PHASE || 'all';
  assert.ok(['all', 'matrix', 'preference', 'recovery'].includes(phase), 'invalid NORTHSTAR_THEME_PHASE');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const matrix = [];
  const preferences = [];
  const recovery = [];
  const auditNegativeControls = [];
  try {
    for (const engine of engines) {
      if (phase === 'all' || phase === 'matrix') {
        for (const viewport of selectedViewports) matrix.push(await runMountedMatrix(engine, viewport, origin));
      }
      if (phase === 'all' || phase === 'preference') preferences.push(await runPreferenceMatrix(engine, origin));
      if (phase === 'all' || phase === 'matrix') auditNegativeControls.push(await runAccessibilityAuditNegativeControl(engine));
      if (phase === 'all' || phase === 'recovery') {
        for (const viewport of selectedViewports) {
          for (const theme of THEMES) recovery.push(await runRecoveryMatrix(engine, viewport, theme, origin));
        }
      }
    }
    process.stdout.write(`${JSON.stringify({
      success: true,
      engines: engines.map(engine => engine === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit'),
      physicalSafari: false,
      mountedPages: MOUNTED_THEME_PAGES.length,
      themes: THEMES,
      matrix,
      preferences,
      recovery,
      auditNegativeControls,
    })}\n`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
