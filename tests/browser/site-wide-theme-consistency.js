'use strict';

const assert = require('assert');
const { app } = require('../../src/server');
const {
  buildDemoWorkspace,
  createInitialDemoState,
} = require('../../src/commandCenter/workspace');
const { navigationFixture } = require('../helpers/navigation-fixture');
const { MOUNTED_THEME_PAGES } = require('../helpers/site-theme-pages');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const {
  assertAccessibilityAudit,
  auditInteractiveStates,
  auditMountedAccessibility,
  interactiveTransitionFractions,
  setInteractiveTransitionProgress,
  releaseInteractiveState,
} = require('../helpers/theme-accessibility-audit');

const VIEWPORTS = Object.freeze([
  { label: '1440x900', width: 1440, height: 900 },
  { label: '390x844', width: 390, height: 844 },
]);
const THEMES = Object.freeze(['dark', 'light']);
const INTERNAL_LANGUAGE = /\bPR (?:A|B1|B2)\b|PR #|pull request|phase B[12]\b|internal phase|development milestone|implementation availability/i;
const RESET_TOKEN = 'T'.repeat(43);
const COMMUNICATIONS_EXPECTED_REQUESTS = Object.freeze([
  Object.freeze({ method: 'GET', pathname: '/api/v1/canonical/compat/communications', search: '' }),
  Object.freeze({ method: 'GET', pathname: '/api/v1/canonical/compat/communications', search: '?limit=50' }),
]);
const DEMO_THEME_TENANT_ID = '00000000-0000-4000-8000-000000000301';
const DEMO_THEME_SESSION_ID = '00000000-0000-4000-8000-000000000302';

function demoWorkspaceFixture() {
  return buildDemoWorkspace({
    tenantId: DEMO_THEME_TENANT_ID,
    sessionId: DEMO_THEME_SESSION_ID,
    state: createInitialDemoState(DEMO_THEME_TENANT_ID, new Date('2026-08-03T12:00:00.000Z')),
    revision: 1,
    simulationCount: 0,
    persisted: false,
    expiresAt: new Date('2099-08-04T12:00:00.000Z'),
  });
}

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
      navigation: navigationFixture(),
      memberships: [{ role: 'owner' }],
      onboarding: { status: 'complete' },
      subscription: pending
        ? { safe: true, state: 'pending_verification', readOnly: true, showTrialBanner: true }
        : { safe: true, state: 'active', readOnly: false, showTrialBanner: false },
    },
  };
}

function communicationsRequestIdentity(request) {
  const url = new URL(request.url());
  return Object.freeze({
    method: request.method(),
    origin: url.origin,
    pathname: url.pathname,
    search: url.search,
    key: `${request.method()} ${url.pathname}${url.search}`,
  });
}

function createCommunicationsResponseGate(origin) {
  const expectedKeys = COMMUNICATIONS_EXPECTED_REQUESTS
    .map(identity => `${identity.method} ${identity.pathname}${identity.search}`)
    .sort();
  const observed = new Map();
  const late = [];
  let firstRequestedResolve;
  let allRequestedResolve;
  let releaseResolve;
  let active = false;
  let released = false;
  const firstRequested = new Promise(resolve => { firstRequestedResolve = resolve; });
  const allRequested = new Promise(resolve => { allRequestedResolve = resolve; });
  const release = new Promise(resolve => { releaseResolve = resolve; });

  function snapshot() {
    const observedKeys = [...observed.keys()].sort();
    return {
      expectedKeys: expectedKeys.slice(),
      observedKeys,
      missingKeys: expectedKeys.filter(key => !observed.has(key)),
      lateKeys: late.map(identity => identity.key),
      requestCount: observedKeys.length,
      pendingCount: released ? 0 : observedKeys.length,
      released,
    };
  }

  async function boundedWait(signal, description, timeoutMs = 3000) {
    let timeout;
    try {
      await Promise.race([
        signal,
        new Promise((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`${description}: ${JSON.stringify(snapshot())}`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  function releaseWithoutCompletenessCheck() {
    if (released) return;
    released = true;
    releaseResolve();
  }

  return {
    activate() { active = true; },
    async hold(request) {
      assert.strictEqual(active, true, 'communications response gate must be route-scoped');
      const identity = communicationsRequestIdentity(request);
      assert.strictEqual(identity.origin, origin, `communications request escaped loopback: ${identity.origin}`);
      assert.ok(expectedKeys.includes(identity.key), `unexpected communications request identity: ${identity.key}`);
      if (released) {
        late.push(identity);
        throw new Error(`communications request arrived after release: ${identity.key}`);
      }
      assert.strictEqual(observed.has(identity.key), false, `duplicate communications request identity: ${identity.key}`);
      observed.set(identity.key, identity);
      firstRequestedResolve();
      if (observed.size === expectedKeys.length) allRequestedResolve();
      await release;
    },
    async waitForObservedCount(count) {
      assert.strictEqual(count, 1, 'only the late-second negative control may wait for a partial request set');
      await boundedWait(firstRequested, 'first communications request did not become pending');
      assert.strictEqual(snapshot().requestCount, 1, `expected one pending request: ${JSON.stringify(snapshot())}`);
      return snapshot();
    },
    async waitForExpectedRequests() {
      await boundedWait(allRequested, 'complete communications request set did not become pending');
      const state = snapshot();
      assert.deepStrictEqual(state.observedKeys, expectedKeys, 'communications pending request identities');
      assert.strictEqual(state.pendingCount, expectedKeys.length, 'both communications reads must remain pending');
      return state;
    },
    release() {
      if (released) return;
      const state = snapshot();
      assert.deepStrictEqual(
        state.observedKeys,
        expectedKeys,
        `refusing communications release before the complete expected set: ${JSON.stringify(state)}`
      );
      releaseWithoutCompletenessCheck();
    },
    forceLegacyReleaseForNegativeControl() { releaseWithoutCompletenessCheck(); },
    cancel() { releaseWithoutCompletenessCheck(); },
    snapshot,
    get active() { return active; },
    get requestCount() { return observed.size; },
  };
}

function canonicalFixture(request, surface) {
  const sessionId = request.headers()['x-northstar-session-id'];
  assert.ok(sessionId, `${surface} fixture requires the mounted session header`);
  return {
    success: true,
    data: {
      surface,
      readModelVersion: 'm19-part3-read-v1',
      digest: 'c'.repeat(64),
      items: [],
      records: [],
      metrics: { graphCount: 0, appointmentCount: 0, estimatedRevenue: null },
      authority: {
        userId: '00000000-0000-4000-8000-000000000101',
        organizationId: '00000000-0000-4000-8000-000000000201',
        sessionId,
      },
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

    const communicationsAudit = framePath === '/dashboard/communications'
      && options.communicationsGate && options.communicationsGate.active;
    if (request.method() === 'GET' && communicationsAudit
      && url.pathname === '/api/v1/canonical/compat/leads') {
      return route.fulfill(jsonResponse(canonicalFixture(request, 'leads')));
    }
    if (request.method() === 'GET' && communicationsAudit
      && url.pathname === '/api/v1/canonical/compat/communications') {
      await options.communicationsGate.hold(request);
      return route.fulfill(jsonResponse(canonicalFixture(request, 'communications')));
    }

    if (request.method() === 'GET' && url.pathname === '/api/demo/command-center') {
      return route.fulfill(jsonResponse({ success: true, data: demoWorkspaceFixture() }));
    }
    const demoCompatibility = url.pathname.match(/^\/api\/demo\/command-center\/canonical\/compat\/([^/]+)$/);
    if (request.method() === 'GET' && demoCompatibility) {
      return route.fulfill(jsonResponse(canonicalFixture(request, decodeURIComponent(demoCompatibility[1]))));
    }

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

async function settleFiniteDocumentAnimations(page) {
  return page.evaluate(() => {
    let settled = 0;
    for (const animation of document.getAnimations()) {
      const timing = animation.effect && animation.effect.getComputedTiming();
      if (!timing || !Number.isFinite(Number(timing.endTime))) continue;
      animation.pause();
      animation.currentTime = Number(timing.endTime);
      settled += 1;
    }
    getComputedStyle(document.body).color;
    return settled;
  });
}

async function assertDashboardQuickActionTimeline(page, label) {
  const actions = page.locator('a[data-command-destination]');
  const count = await actions.count();
  assert.strictEqual(count, 4, `${label} Command Center action count`);
  const hrefs = [];
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const action = actions.nth(index);
    hrefs.push(await action.getAttribute('href'));
    await releaseInteractiveState(page, action);
    await action.hover({ force: true });
    const fractions = await interactiveTransitionFractions(action);
    assert.deepStrictEqual(fractions, [0, 0.25, 0.5, 0.75, 1], `${label} quick action ${index} timeline`);
    const actionSamples = [];
    for (const fraction of fractions) {
      const transition = await setInteractiveTransitionProgress(action, fraction);
      const contrast = await computedContrast(action);
      actionSamples.push({
        fraction,
        animations: transition.animations,
        ratio: Number(contrast.ratio.toFixed(3)),
        foreground: contrast.foreground,
        background: contrast.background,
      });
      assert.ok(contrast.ratio >= 4.5, `${label} quick action ${index} at ${fraction}: ${JSON.stringify({ contrast, transition })}`);
    }
    samples.push(actionSamples);
    await releaseInteractiveState(page, action);
  }
  assert.deepStrictEqual(
    hrefs.slice().sort(),
    ['/dashboard/calendar', '/dashboard/leads', '/dashboard/leads', '/dashboard/polaris'],
    `${label} canonical Command Center destinations exercised`
  );
  return {
    actions: count,
    frames: samples.reduce((total, actionSamples) => total + actionSamples.length, 0),
    minimumRatio: Math.min(...samples.flat().map(sample => sample.ratio)),
    settledMinimumRatio: Math.min(...samples.map(actionSamples => actionSamples[actionSamples.length - 1].ratio)),
  };
}

async function executiveBriefFocusGeometry(page, label) {
  const selector = 'aside.sidebar [data-account-logout]';
  const target = page.locator(selector);
  await target.waitFor({ state: 'visible' });
  assert.strictEqual(await target.getAttribute('tabindex'), '0', `${label} explicit WebKit keyboard order`);
  const geometry = () => target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const outlineWidth = parseFloat(style.outlineWidth) || 0;
    const outlineOffset = parseFloat(style.outlineOffset) || 0;
    return {
      active: document.activeElement === element,
      focusVisible: element.matches(':focus-visible'),
      bottom: Number(rect.bottom.toFixed(3)),
      outlineWidth,
      outlineOffset,
      visualTop: Number((rect.top - outlineWidth - outlineOffset).toFixed(3)),
      visualRight: Number((rect.right + outlineWidth + outlineOffset).toFixed(3)),
      visualBottom: Number((rect.bottom + outlineWidth + outlineOffset).toFixed(3)),
      visualLeft: Number((rect.left - outlineWidth - outlineOffset).toFixed(3)),
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    };
  });
  const assertInside = (value, mode) => {
    assert.strictEqual(value.active, true, `${label} ${mode} active target`);
    assert.strictEqual(value.focusVisible, true, `${label} ${mode} focus-visible`);
    assert.ok(value.visualTop >= -0.5, `${label} ${mode} top clearance: ${JSON.stringify(value)}`);
    assert.ok(value.visualLeft >= -0.5, `${label} ${mode} left clearance: ${JSON.stringify(value)}`);
    assert.ok(value.visualRight <= value.viewportWidth + 0.5, `${label} ${mode} right clearance: ${JSON.stringify(value)}`);
    assert.ok(value.visualBottom <= value.viewportHeight + 0.5, `${label} ${mode} bottom clearance: ${JSON.stringify(value)}`);
  };

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    scrollTo(0, 0);
  });
  const focusableCount = await page.locator('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])').count();
  let tabStops = 0;
  while (tabStops <= (focusableCount * 3) + 3 && !(await target.evaluate(element => document.activeElement === element))) {
    await page.keyboard.press('Tab');
    tabStops += 1;
  }
  assert.ok(tabStops <= (focusableCount * 3) + 3, `${label} natural traversal reaches Sign Out`);
  const natural = await geometry();
  assertInside(natural, 'natural');

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    scrollTo(0, 0);
  });
  await target.focus();
  const direct = await geometry();
  assertInside(direct, 'direct');
  await target.evaluate(element => element.blur());
  return { tabStops, focusableCount, natural, direct };
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

async function readCommunicationsRenderState(page) {
  return page.evaluate(() => ({
    authority: document.documentElement.dataset.canonicalAuthority || null,
    kpiCards: document.querySelectorAll('#kpiGrid .ds-kpi-card').length,
    gridBusy: document.getElementById('kpiGrid')?.getAttribute('aria-busy') || null,
    listBusy: document.getElementById('callHistoryList')?.getAttribute('aria-busy') || null,
    loadingHeading: document.querySelector('#callHistoryList .communications-loading-state h3')?.textContent.trim() || '',
    emptyHeading: document.querySelector('#callHistoryList .empty-state:not(.communications-loading-state) h3')?.textContent.trim() || '',
  }));
}

async function auditCommunicationsReadiness(page, gate, label) {
  const preReleaseRequests = await gate.waitForExpectedRequests();
  await settleFiniteDocumentAnimations(page);
  const initialState = await readCommunicationsRenderState(page);
  assert.strictEqual(initialState.kpiCards, 8, `${label} controlled initial state reserves KPI geometry`);
  assert.strictEqual(initialState.gridBusy, 'true', `${label} KPI loading state is explicit`);
  assert.strictEqual(initialState.listBusy, 'true', `${label} history loading state is explicit`);
  assert.strictEqual(initialState.loadingHeading, 'Loading communications\u2026', `${label} truthful initial loading presentation`);
  assert.strictEqual(initialState.emptyHeading, '', `${label} empty state is not claimed before authority settles`);
  const initialAccessibility = await auditMountedAccessibility(page);
  assert.deepStrictEqual(
    gate.snapshot(),
    preReleaseRequests,
    `${label} complete request set must remain pending throughout the initial audit`
  );

  gate.release();
  await page.waitForFunction(() => (
    document.documentElement.dataset.canonicalAuthority === 'server'
      && document.querySelectorAll('#kpiGrid .ds-kpi-card').length === 8
      && document.querySelector('#callHistoryList .empty-state h3')?.textContent.trim() === 'No communications yet'
  ), null, { timeout: 5000 });
  await settleFiniteDocumentAnimations(page);

  const settledState = await readCommunicationsRenderState(page);
  const settledAccessibility = await auditMountedAccessibility(page);
  assert.deepStrictEqual(settledState, {
    authority: 'server',
    kpiCards: 8,
    gridBusy: 'false',
    listBusy: 'false',
    loadingHeading: '',
    emptyHeading: 'No communications yet',
  }, `${label} completed communications render`);
  const completedRequests = gate.snapshot();
  assert.deepStrictEqual(completedRequests.observedKeys, preReleaseRequests.expectedKeys, `${label} completed request identities`);
  assert.deepStrictEqual(completedRequests.lateKeys, [], `${label} no communications request may arrive after release`);
  assert.strictEqual(completedRequests.requestCount, 2, `${label} expected declared and filtered communications reads`);
  assert.ok(settledAccessibility.auditedTextElements >= initialAccessibility.auditedTextElements,
    `${label} settled accessibility coverage must not shrink`);
  return {
    initialAccessibility,
    settledAccessibility,
    initialState,
    settledState,
    preReleaseRequests,
    completedRequests,
    missedByPreCompletionAudit: Math.max(0, settledAccessibility.auditedTextElements - initialAccessibility.auditedTextElements),
    requestCount: gate.requestCount,
  };
}

async function assertMountedTheme(page, route, expectedTheme, options = {}) {
  const expectedPath = new URL(route).pathname;
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
  if (expectedPath === '/demo' || expectedPath.startsWith('/demo/')) {
    await page.waitForFunction(() => (
      document.documentElement.dataset.demoWorkspace === 'ready'
        && document.documentElement.dataset.northstarNavigation === 'ready'
    ), null, { timeout: 5000 });
  }
  if (expectedPath === '/demo') {
    await page.waitForFunction(() => (
      document.getElementById('commandCenterContent')?.getAttribute('aria-busy') === 'false'
    ), null, { timeout: 5000 });
  }
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
  let asyncReadiness = null;
  let accessibility;
  if (options.communicationsGate) {
    asyncReadiness = await auditCommunicationsReadiness(page, options.communicationsGate, `${route} ${expectedTheme}`);
    accessibility = asyncReadiness.settledAccessibility;
  } else {
    // Seek finite source-owned entrance transitions to their deterministic end state.
    await settleFiniteDocumentAnimations(page);
    accessibility = await auditMountedAccessibility(page);
  }
  const interactiveStates = await auditInteractiveStates(page);
  assert.strictEqual(
    new URL(page.url()).pathname,
    expectedPath,
    `${route} must remain mounted throughout its interaction audit`
  );

  const toggledTheme = expectedTheme === 'dark' ? 'light' : 'dark';
  await page.evaluate(() => {
    window.__northstarThemeClickDiagnostic = { clicks: 0, changes: [] };
    const button = document.querySelector('[data-northstar-theme-toggle]');
    button?.addEventListener('click', () => { window.__northstarThemeClickDiagnostic.clicks += 1; });
    window.addEventListener('northstar:themechange', event => {
      window.__northstarThemeClickDiagnostic.changes.push(event.detail || null);
    });
  });
  await page.locator('[data-northstar-theme-toggle]').click();
  assert.strictEqual(
    new URL(page.url()).pathname,
    expectedPath,
    `${route} must remain mounted after its theme transition`
  );
  const actualToggledTheme = await page.evaluate(() => NorthStarTheme.getTheme());
  if (actualToggledTheme !== toggledTheme) {
    const diagnostic = await page.evaluate(() => ({
      theme: NorthStarTheme.getTheme(),
      clicks: window.__northstarThemeClickDiagnostic?.clicks || 0,
      changes: window.__northstarThemeClickDiagnostic?.changes || [],
      toggleCount: document.querySelectorAll('[data-northstar-theme-toggle]').length,
      controlCount: document.querySelectorAll('[data-northstar-theme-control]').length,
      connected: Boolean(document.querySelector('[data-northstar-theme-toggle]')?.isConnected),
      ariaPressed: document.querySelector('[data-northstar-theme-toggle]')?.getAttribute('aria-pressed') || null,
    }));
    assert.fail(`${route} theme toggle must transition from ${expectedTheme} to ${toggledTheme}: ${JSON.stringify(diagnostic)}`);
  }
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

  return { ...result, accessibility, interactiveStates, asyncReadiness };
}

async function runMountedMatrix(engine, viewport, origin) {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
  const evidence = [];
  const accessibilityFailures = [];
  const quickActionTimelines = [];
  const executiveFocusChecks = [];
  try {
    const selectedThemes = process.env.NORTHSTAR_THEME_ONLY
      ? THEMES.filter(theme => theme === process.env.NORTHSTAR_THEME_ONLY)
      : THEMES;
    assert.ok(selectedThemes.length > 0, 'NORTHSTAR_THEME_ONLY must be dark or light');
    for (const theme of selectedThemes) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const inventory = { requests: [], api: [] };
      const communicationsGate = createCommunicationsResponseGate(origin);
      const pageErrors = [];
      const consoleErrors = [];
      try {
        await installThemeInstrumentation(context, theme);
        await installLocalApiBoundary(context, origin, inventory, { communicationsGate });
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
          const isCommunications = mounted.route === '/dashboard/communications';
          if (isCommunications) communicationsGate.activate();
          const result = await assertMountedTheme(page, `${origin}${mounted.route}`, theme, {
            communicationsGate: isCommunications ? communicationsGate : null,
          });
          const label = `${engine} ${viewport.label} ${theme} ${mounted.route}`;
          if (mounted.route === '/dashboard') {
            quickActionTimelines.push({
              theme,
              ...await assertDashboardQuickActionTimeline(page, label),
            });
          }
          if (mounted.route === '/dashboard/executive-brief' && viewport.label === '1440x900') {
            executiveFocusChecks.push({
              theme,
              ...await executiveBriefFocusGeometry(page, label),
            });
          }
          evidence.push({
            route: mounted.route,
            theme,
            background: result.background,
            color: result.color,
            auditedTextElements: result.accessibility.auditedTextElements,
            interactiveStateGroups: result.interactiveStates.groups,
            visibleControlContexts: result.interactiveStates.visibleControlContexts,
            interactiveHoverFrames: result.interactiveStates.hoverFrames,
            interactiveFocusFrames: result.interactiveStates.focusFrames,
            asyncReadiness: result.asyncReadiness && {
              initialAuditedTextElements: result.asyncReadiness.initialAccessibility.auditedTextElements,
              settledAuditedTextElements: result.asyncReadiness.settledAccessibility.auditedTextElements,
              missedByPreCompletionAudit: result.asyncReadiness.missedByPreCompletionAudit,
              requestCount: result.asyncReadiness.requestCount,
              preReleaseRequestIdentities: result.asyncReadiness.preReleaseRequests.observedKeys,
              postReleaseLateRequestIdentities: result.asyncReadiness.completedRequests.lateKeys,
              completionAuthority: result.asyncReadiness.settledState.authority,
              completedKpiCards: result.asyncReadiness.settledState.kpiCards,
            },
          });
          const accessibilityStates = [
            { state: 'settled', audit: result.accessibility },
            ...(result.asyncReadiness ? [{ state: 'initial', audit: result.asyncReadiness.initialAccessibility }] : []),
          ];
          for (const accessibilityState of accessibilityStates) {
            const audit = accessibilityState.audit;
            const isSettled = accessibilityState.state === 'settled';
            if (audit.contrastFailures.length || audit.uiFailures.length || audit.overlaps.length
              || audit.clipped.length
              || isSettled && (result.interactiveStates.hoverFailures.length || result.interactiveStates.focusFailures.length)) {
              accessibilityFailures.push({
                route: mounted.route,
                theme,
                state: accessibilityState.state,
                contrastFailures: audit.contrastFailures,
                uiFailures: audit.uiFailures,
                overlaps: audit.overlaps,
                clipped: audit.clipped,
                hoverFailures: isSettled ? result.interactiveStates.hoverFailures : [],
                focusFailures: isSettled ? result.interactiveStates.focusFailures : [],
              });
            }
          }
        }
        assert.deepStrictEqual(pageErrors, []);
        assert.deepStrictEqual(consoleErrors, []);
        assert.strictEqual(inventory.requests.some(item => !['GET'].includes(item.method)), false);
        assert.strictEqual(inventory.api.some(item => item.method !== 'GET'), false);
      } finally {
        communicationsGate.cancel();
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const accessibilityDiagnostic = accessibilityFailures.map(failure => ({
    route: failure.route,
    theme: failure.theme,
    state: failure.state,
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
    visibleControlContexts: evidence.reduce((total, item) => total + item.visibleControlContexts, 0),
    interactiveHoverFrames: evidence.reduce((total, item) => total + item.interactiveHoverFrames, 0),
    interactiveFocusFrames: evidence.reduce((total, item) => total + item.interactiveFocusFrames, 0),
    asyncRouteStates: evidence.filter(item => item.asyncReadiness).map(item => ({
      route: item.route,
      theme: item.theme,
      ...item.asyncReadiness,
    })),
    quickActionTimelines,
    executiveFocusChecks,
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
    await page.setContent(`<!doctype html><html><head><style>
      .context-action { color:#0b0d17; background:#f2c94c; border:2px solid #7a5c08; }
      .context-dark .context-action:hover { color:#f1f2f6; background:#131624; }
      .context-light .context-action:hover { color:rgb(200,155,44); background:#f8fafc; }
      .timing { color:#0b0d17; background:#f2c94c; border:2px solid #7a5c08; transition:color .12s linear; }
      .timing:hover { color:rgb(200,155,44); }
      :where(button):focus-visible { outline:3px solid #f2c94c; outline-offset:3px; }
    </style></head><body style="margin:0;box-sizing:border-box;background:#0b0d17;color:#f1f2f6;min-height:100vh">
      <div style="background:transparent"><span id="hiddenContrast" style="color:#131624">Unreadable nested text</span></div>
      <input id="weakBoundary" aria-label="Fixture field" style="border:1px solid #131624;background:#0b0d17;color:#f1f2f6">
      <button id="overlap" style="position:fixed;right:10px;bottom:10px;width:60px;height:50px">Action</button>
      <div class="context-dark" style="background:#0b0d17"><button class="context-action">Context action</button></div>
      <div class="context-light" style="background:#f8fafc"><button class="context-action">Context action</button></div>
      <button class="timing">Transition action</button>
      <details><summary>Closed fixture</summary><button id="closedDetailsAction">Closed action</button></details>
      <details open><summary>Open fixture</summary><button id="openDetailsAction">Open action</button></details>
      <div data-northstar-theme-control style="position:fixed;right:10px;bottom:10px"><button data-northstar-theme-toggle aria-label="Fixture theme" style="width:44px;height:44px">T</button></div>
    </body></html>`);
    const audit = await auditMountedAccessibility(page);
    assert.strictEqual(audit.contrastFailures.some(failure => failure.path === '#hiddenContrast' && failure.ratio < 1.2), true);
    assert.strictEqual(audit.uiFailures.some(failure => failure.path === '#weakBoundary'), true);
    assert.strictEqual(audit.overlaps.some(overlap => overlap.path === '#overlap'), true);

    const interaction = await auditInteractiveStates(page);
    const contextualFailures = interaction.hoverFailures.filter(failure =>
      failure.signature.includes('context-action')
      && failure.contrastFailures.some(item => item.path.includes('context-light'))
    );
    const timingFailures = interaction.hoverFailures.filter(failure =>
      failure.signature.includes('timing')
      && failure.contrastFailures.some(item => item.path.includes('timing'))
    );
    assert.strictEqual(interaction.visibleControlContexts >= 6, true, 'every visible fixture context is exercised');
    assert.strictEqual(
      interaction.contextSignatures.some(signature => signature.includes('closedDetailsAction')),
      false,
      'controls inside a closed details panel are not treated as visible'
    );
    assert.strictEqual(
      interaction.contextSignatures.some(signature => signature.includes('openDetailsAction')),
      true,
      'controls inside an open details panel remain in the interactive audit'
    );
    assert.strictEqual(contextualFailures.some(failure => failure.signature.includes('context-light')), true, 'effective light background failure is retained');
    assert.strictEqual(
      timingFailures.some(failure => failure.phase !== 'hover-0'),
      true,
      'intermediate or settled transition failure is sampled'
    );

    await page.setContent(`<!doctype html><html><head><style>
      .mobile-header { position:fixed; inset:0 0 auto; height:64px; z-index:400; background:#0b0d17; }
      .mobile-header-actions { position:absolute; inset:0 0 auto auto; width:96px; height:64px; }
    </style></head><body style="margin:0;background:#0b0d17;color:#f1f2f6;min-height:100vh">
      <button id="occludedDocumentAction" aria-label="Occluded document action" style="position:fixed;right:10px;top:10px;width:60px;height:44px">D</button>
      <button id="aboveHeaderOverlap" aria-label="Higher-layer document action" style="position:fixed;right:10px;top:10px;width:60px;height:44px;z-index:401">A</button>
      <header class="mobile-header">
        <div class="mobile-header-actions">
          <button id="sameHeaderOverlap" aria-label="Overlapping header action" style="position:absolute;right:10px;top:10px;width:60px;height:44px">H</button>
          <span class="northstar-theme-slot">
            <div data-northstar-theme-control style="position:absolute;right:10px;top:10px">
              <button data-northstar-theme-toggle aria-label="Fixture mobile theme" style="width:44px;height:44px">T</button>
            </div>
          </span>
        </div>
      </header>
    </body></html>`);
    const mobileHeaderAudit = await auditMountedAccessibility(page);
    assert.strictEqual(
      mobileHeaderAudit.overlaps.some(overlap => overlap.path === '#sameHeaderOverlap'),
      true,
      'same-mobile-header collisions remain detectable'
    );
    assert.strictEqual(
      mobileHeaderAudit.overlaps.some(overlap => overlap.path === '#occludedDocumentAction'),
      false,
      'document controls occluded beneath the fixed mobile header are excluded'
    );
    assert.strictEqual(
      mobileHeaderAudit.overlaps.some(overlap => overlap.path === '#aboveHeaderOverlap'),
      true,
      'higher-layer controls outside the mobile header remain detectable'
    );

    await page.setContent(`<!doctype html><html><head><style>
      .nav { position:fixed; inset:0 0 auto; height:64px; z-index:500; background:#0b0d17; }
      .nav-inner { position:relative; height:64px; }
    </style></head><body class="homepage-refresh" style="margin:0;background:#0b0d17;color:#f1f2f6;min-height:100vh">
      <button id="homepageOccludedAction" aria-label="Occluded homepage action" style="position:fixed;right:10px;top:10px;width:60px;height:44px">D</button>
      <button id="homepageAboveNavAction" aria-label="Higher-layer homepage action" style="position:fixed;right:10px;top:10px;width:60px;height:44px;z-index:501">A</button>
      <nav class="nav">
        <div class="nav-inner">
          <button id="homepageSameNavAction" aria-label="Overlapping homepage navigation action" style="position:absolute;right:10px;top:10px;width:60px;height:44px">H</button>
          <span class="northstar-theme-slot">
            <div data-northstar-theme-control style="position:absolute;right:10px;top:10px">
              <button data-northstar-theme-toggle aria-label="Fixture homepage theme" style="width:44px;height:44px">T</button>
            </div>
          </span>
        </div>
      </nav>
    </body></html>`);
    const homepageNavAudit = await auditMountedAccessibility(page);
    assert.strictEqual(
      homepageNavAudit.overlaps.some(overlap => overlap.path === '#homepageSameNavAction'),
      true,
      'same-homepage-navigation collisions remain detectable'
    );
    assert.strictEqual(
      homepageNavAudit.overlaps.some(overlap => overlap.path === '#homepageOccludedAction'),
      false,
      'document controls occluded beneath the fixed homepage navigation are excluded'
    );
    assert.strictEqual(
      homepageNavAudit.overlaps.some(overlap => overlap.path === '#homepageAboveNavAction'),
      true,
      'higher-layer controls outside the homepage navigation remain detectable'
    );
    return {
      engine,
      inheritedBackgroundContrast: true,
      componentBoundary: true,
      exactToggleOverlap: true,
      sameHeaderOverlap: true,
      occludedDocumentControlExcluded: true,
      aboveHeaderOverlap: true,
      homepageSameNavOverlap: true,
      homepageOccludedDocumentControlExcluded: true,
      homepageAboveNavOverlap: true,
      contextualControls: {
        contexts: interaction.visibleControlContexts,
        failures: contextualFailures.length,
      },
      transitionTimeline: {
        frames: interaction.hoverFrames,
        failures: timingFailures.length,
      },
    };
  } finally {
    await browser.close();
  }
}

async function runCommunicationsReleaseSequencingNegativeControl(engine, origin) {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const gate = createCommunicationsResponseGate(origin);
  const evidence = { requests: [], api: [] };
  let lateFailure = '';
  gate.activate();
  try {
    await context.route('**/api/v1/canonical/compat/communications**', async route => {
      try {
        await gate.hold(route.request());
        await route.fulfill(jsonResponse({ success: true }));
      } catch (error) {
        lateFailure = String(error && error.message || error);
        await route.abort('failed');
      }
    });
    installRequestInventory(context, origin, evidence);
    const page = await context.newPage();
    await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const firstRequest = page.evaluate(() => fetch('/api/v1/canonical/compat/communications')
      .then(response => response.status)
      .catch(() => 0));
    const onePending = await gate.waitForObservedCount(1);
    let earlyReleaseFailure = '';
    try {
      gate.release();
    } catch (error) {
      earlyReleaseFailure = String(error && error.message || error);
    }
    assert.match(earlyReleaseFailure, /refusing communications release before the complete expected set/);
    assert.deepStrictEqual(onePending.missingKeys, ['GET /api/v1/canonical/compat/communications?limit=50']);

    // Recreate the superseded early-release sequence only inside this negative
    // control. The real mounted path has no access to this test-only bypass.
    gate.forceLegacyReleaseForNegativeControl();
    assert.strictEqual(await firstRequest, 200);
    const lateSecondOutcome = await page.evaluate(() => fetch('/api/v1/canonical/compat/communications?limit=50')
      .then(() => 'unexpected_success')
      .catch(() => 'network_failure'));
    assert.strictEqual(lateSecondOutcome, 'network_failure');
    assert.match(lateFailure, /communications request arrived after release/);

    const finalState = gate.snapshot();
    assert.deepStrictEqual(finalState.observedKeys, ['GET /api/v1/canonical/compat/communications']);
    assert.deepStrictEqual(finalState.lateKeys, ['GET /api/v1/canonical/compat/communications?limit=50']);
    const requests = evidence.requests
      .filter(item => item.path === '/api/v1/canonical/compat/communications')
      .map(item => `${item.method} ${item.path}`);
    assert.deepStrictEqual(requests, [
      'GET /api/v1/canonical/compat/communications',
      'GET /api/v1/canonical/compat/communications',
    ]);
    return {
      engine,
      preReleaseRequestCount: onePending.requestCount,
      missingBeforeRelease: onePending.missingKeys,
      earlyReleaseRejected: true,
      postReleaseSecondRejected: true,
      lateRequestIdentities: finalState.lateKeys,
      methods: ['GET', 'GET'],
      loopbackOnly: true,
      authorizationHeaders: 0,
    };
  } finally {
    gate.cancel();
    await context.close();
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
        await page.fill('#password', 'short7!');
        await page.fill('#confirmPassword', 'short7!');
        await page.locator('#resetForm').evaluate(form => form.requestSubmit());
        assert.strictEqual(evidence.api.length, weakStart, 'weak password creates no reset request');
        assert.strictEqual(await page.locator('#password').evaluate(input => input.matches(':invalid')), true);
      }
      await page.fill('#password', 'NorthStar-theme-fixture-123!');
      await page.fill('#confirmPassword', 'NorthStar-theme-fixture-123!');
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
  const readinessSequencingNegativeControls = [];
  try {
    for (const engine of engines) {
      if (phase === 'all' || phase === 'matrix') {
        for (const viewport of selectedViewports) matrix.push(await runMountedMatrix(engine, viewport, origin));
      }
      if (phase === 'all' || phase === 'preference') preferences.push(await runPreferenceMatrix(engine, origin));
      if (phase === 'all' || phase === 'matrix') auditNegativeControls.push(await runAccessibilityAuditNegativeControl(engine));
      if (phase === 'all' || phase === 'matrix') {
        readinessSequencingNegativeControls.push(await runCommunicationsReleaseSequencingNegativeControl(engine, origin));
      }
      if (phase === 'all' || phase === 'recovery') {
        for (const viewport of selectedViewports) {
          for (const theme of THEMES) recovery.push(await runRecoveryMatrix(engine, viewport, theme, origin));
        }
      }
    }
    const asyncReadinessNegativeControls = matrix.flatMap(result => result.asyncRouteStates.map(state => ({
      engine: result.engine,
      viewport: result.viewport,
      route: state.route,
      theme: state.theme,
      preCompletionAuditedTextElements: state.initialAuditedTextElements,
      settledAuditedTextElements: state.settledAuditedTextElements,
      omittedByPreCompletionAudit: state.missedByPreCompletionAudit,
      productionObservableCompletion: {
        authority: state.completionAuthority,
        kpiCards: state.completedKpiCards,
      },
      requestCount: state.requestCount,
      preReleaseRequestIdentities: state.preReleaseRequestIdentities,
      postReleaseLateRequestIdentities: state.postReleaseLateRequestIdentities,
    })));
    if ((phase === 'all' || phase === 'matrix')
      && (!process.env.NORTHSTAR_THEME_ROUTE || process.env.NORTHSTAR_THEME_ROUTE === '/dashboard/communications')) {
      const selectedThemeCount = process.env.NORTHSTAR_THEME_ONLY ? 1 : THEMES.length;
      assert.strictEqual(
        asyncReadinessNegativeControls.length,
        engines.length * selectedViewports.length * selectedThemeCount,
        'every selected engine, viewport, and theme must exercise communications initial and settled readiness'
      );
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
      asyncReadinessNegativeControls,
      readinessSequencingNegativeControls,
    })}\n`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
});
