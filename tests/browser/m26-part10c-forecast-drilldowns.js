'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const engine = process.argv[2];
const output = path.resolve(process.argv[3]);
assert.ok(!fs.existsSync(output), 'Browser evidence directory must be new');
fs.mkdirSync(output, { recursive: true });
const dashboard = fs.readFileSync(path.resolve('public/demo-dashboard.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<script\b[^>]*\/>/gi, '')
  .replace(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*>/gi, '');
const styles = ['style.css','demo-dashboard.css'].map(file =>
  fs.readFileSync(path.resolve('public/css', file), 'utf8')
    .replace(/^\s*\@import[^;]+;\s*/gm, '')).join('\n');
const TENANTS = { paid: 'a0000000-0000-4000-8000-000000000010',
  demo: 'd0000000-0000-4000-8000-000000000010' };
const ORIGIN = '90000000-0000-4000-8000-000000000010';
const SUFFIXES = ['Revenue','OperatingCost','Profit','Margin','Demand','Capacity'];
const FIELDS = ['Coverage','Assumptions','Confidence','Uncertainty','Stale','Change','Error','Cause'];

async function pageFor(browser, scenario) {
  const context = await browser.newContext({ viewport: scenario.viewport,
    colorScheme: scenario.theme, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(dashboard, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ css, theme }) => {
    const style = document.createElement('style'); style.textContent = css;
    document.head.append(style); document.documentElement.dataset.theme = theme;
  }, { css: styles, theme: scenario.theme });
  await page.waitForFunction(() => getComputedStyle(document.body).margin === '0px');
  await page.addScriptTag({ path: path.resolve(
    'public/js/command-center-monthly-forecast-kpis.js') });
  await page.addScriptTag({ path: path.resolve(
    'public/js/command-center-forecast-drilldowns.js') });
  await page.evaluate(({ mode, tenant, origin }) => {
    window.__calls = []; window.__responses = []; window.__announcements = [];
    window.__authority = { tenantId: tenant, role: mode === 'demo' ? 'viewer' : 'owner',
      mode, fictional: mode === 'demo' };
    const status = document.getElementById('commandCenterForecastDrilldownsStatus');
    new MutationObserver(() => window.__announcements.push(status.textContent))
      .observe(status, { childList: true, characterData: true, subtree: true });
    window.__details = NorthStarForecastDrilldowns.create({ document, mode,
      originProvider: () => origin, fetcher: async (url, options) => {
        window.__calls.push({ url, method: options.method, cache: options.cache });
        const response = window.__responses.shift();
        if (!response) throw new Error('Unexpected request');
        if (response.hold) await new Promise(resolve => { window.__releaseDetails = resolve; });
        return { ok: response.status >= 200 && response.status < 300,
          json: async () => response.payload };
      } });
  }, { mode: scenario.mode, tenant: TENANTS[scenario.mode], origin: ORIGIN });
  return { context, page, errors };
}

async function statusIsExposed(context, page) {
  const status = page.locator('#commandCenterForecastDrilldownsStatus');
  assert.equal(await status.getAttribute('role'), 'status');
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  assert.equal(await status.getAttribute('aria-atomic'), 'true');
  if (engine === 'chrome') {
    const session = await context.newCDPSession(page);
    const root = await session.send('DOM.getDocument');
    const target = await session.send('DOM.querySelector', {
      nodeId: root.root.nodeId, selector: '#commandCenterForecastDrilldownsStatus',
    });
    const tree = await session.send('Accessibility.getPartialAXTree', {
      nodeId: target.nodeId, fetchRelatives: false,
    });
    assert.ok(tree.nodes.some(node => node.role?.value === 'status' && !node.ignored));
  }
}

async function exercise(browser, scenario, result) {
  const { context, page, errors } = await pageFor(browser, scenario);
  try {
    const summary = page.locator('#commandCenterForecastDrilldowns > summary');
    await summary.focus();
    assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    await summary.press('Enter');
    assert.notEqual(await page.locator('#commandCenterForecastDrilldowns').getAttribute('open'), null);
    assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    await statusIsExposed(context, page);

    if (scenario.mode === 'demo') {
      await page.evaluate(() => window.__details.workspaceReady(window.__authority));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.equal(await page.locator('#commandCenterForecastDrilldownsState').textContent(),
        'Fictional guard');
      assert.match(await page.locator('#commandCenterForecastDrilldownsExplanation').textContent(),
        /isolated fictional example.*no paid request.*no invented evidence/i);
      await page.evaluate(() => window.__details.workspaceUnavailable());
      assert.equal(await page.locator('#commandCenterForecastDrilldownsState').textContent(),
        'Workspace unavailable');
      assert.equal(await page.locator('#commandCenterForecastDrilldowns').getAttribute('open'), null);
      await page.evaluate(() => window.__details.workspaceReady(window.__authority));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
    } else {
      const value = await page.evaluate(tenant =>
        NorthStarForecastDrilldowns.demoDrilldowns(tenant), TENANTS.paid);
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data }, hold: true });
        document.getElementById('commandCenterForecastDrilldownProfitCause').textContent =
          'stale private cause';
        document.getElementById('commandCenterForecastDrilldownsAuthority').textContent =
          'stale private identity';
        window.__pendingDetails = window.__details.workspaceReady(window.__authority);
      }, value);
      assert.doesNotMatch(await page.locator('#commandCenterForecastDrilldownProfitCause').textContent(),
        /stale private cause/);
      assert.doesNotMatch(await page.locator('#commandCenterForecastDrilldownsAuthority').textContent(),
        /stale private identity/);
      await page.evaluate(() => window.__releaseDetails());
      await page.evaluate(() => window.__pendingDetails);
      assert.deepEqual(await page.evaluate(() => window.__calls), [{
        url: `/api/v1/forecast/drilldowns/${ORIGIN}`, method: 'GET', cache: 'no-store',
      }]);
      assert.match(await page.locator('#commandCenterForecastDrilldownsAuthority').textContent(),
        /Tenant a0000000.*month.*timeline.*bundle.*run and drilldown receipts unavailable/i);

      await page.evaluate(data => {
        const stale = JSON.parse(JSON.stringify(data));
        stale.reason = stale.bundle.reason = 'deterministic_baseline_not_current';
        stale.period = stale.bundle.anchor = stale.bundle.month = stale.bundle.graph.month = null;
        stale.digests.bundle = stale.bundle.digests.bundle = null;
        stale.digests.timeline = null; stale.bundle.anchorSourceAuthenticated = false;
        stale.currentness.anchorCurrent = stale.bundle.currentness.anchorCurrent = false;
        stale.currentness.correctionOrRevocationApplied =
          stale.bundle.currentness.correctionOrRevocationApplied = true;
        stale.slots.forEach(slot => { slot.reason = stale.reason; });
        stale.bundle.slots.forEach(slot => { slot.reason = stale.reason; });
        stale.bundle.graph.reason = stale.reason;
        window.__responses.push({ status: 200, payload: { success: true, data: stale } });
        return window.__details.workspaceReady(window.__authority);
      }, value);
      assert.match(await page.locator('#commandCenterForecastDrilldownsAuthority').textContent(),
        /prior source, month and digest identities were cleared/i);
      assert.match(await page.locator('#commandCenterForecastDrilldownsExplanation').textContent(),
        /source anchor changed/i);

      await page.evaluate(() => {
        window.__responses.push({ status: 503,
          payload: { success: false, error: { message: 'unavailable' } } });
        return window.__details.workspaceReady(window.__authority);
      });
      assert.match(await page.locator('#commandCenterForecastDrilldownsAuthority').textContent(),
        /No authenticated run, period or drilldown identity is retained/i);
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data } });
        return window.__details.workspaceReady(window.__authority);
      }, value);
      assert.equal(await page.locator('#commandCenterForecastDrilldownsState').textContent(),
        'Details unavailable');
      assert.doesNotMatch(await page.locator('#commandCenterForecastDrilldownsExplanation').textContent(),
        /fictional/i);
    }

    for (const suffix of SUFFIXES) for (const field of FIELDS) {
      const text = await page.locator(
          `#commandCenterForecastDrilldown${suffix}${field}`).textContent();
      assert.match(text, /^(Not available|Unknown)/);
      assert.doesNotMatch(text, /\b(?:0|[1-9]\d*)(?:\.\d+)?%\b|P10|P50|P90|probability score/i);
    }
    assert.match(await page.locator('#commandCenterForecastDrilldownDemandConfidence').textContent(),
      /no reviewed evaluation.*probability.*calibration.*confidence percentage/i);
    assert.match(await page.locator('#commandCenterForecastDrilldownDemandCause').textContent(),
      /no authenticated source, feature, assumption, configuration or algorithm difference/i);
    assert.equal(await page.locator('.command-center-forecast-drilldown-grid article').count(), 6);

    const inspection = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      busy: document.getElementById('commandCenterForecastDrilldowns').getAttribute('aria-busy'),
      columns: getComputedStyle(document.querySelector('.command-center-forecast-drilldown-grid'))
        .gridTemplateColumns.split(' ').length,
      motion: Array.from(document.querySelectorAll('#commandCenterForecastDrilldowns *')).map(node => {
        const style = getComputedStyle(node); return { id: node.id,
          animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
      }).filter(value => parseFloat(value.animationDuration) > 0.001 ||
        parseFloat(value.transitionDuration) > 0.001),
    }));
    assert.equal(inspection.scrollWidth, inspection.clientWidth);
    assert.equal(inspection.busy, 'false'); assert.deepEqual(inspection.motion, []);
    assert.equal(inspection.columns, scenario.size === 'mobile' ? 1 : 2);
    assert.match(await page.evaluate(() => window.__announcements.at(-1)),
      /Six forecast drilldowns remain value-free and unavailable/i);
    assert.deepEqual(errors, []);
    const name = [scenario.mode, scenario.size, scenario.theme].join('-');
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    result.cases.push({ name, paidDemoIsolation: true, evidenceWithheld: true,
      correctionFailureAndRecovery: true, staleDetailsCleared: true,
      zeroDistinctFromUnavailable: true, keyboardAndStatusAccessible: true,
      responsiveDrilldowns: true, reducedMotion: true, pass: true });
  } finally { await context.close(); }
}

(async () => {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  const result = { engine, pass: false, cases: [] };
  try {
    const scenarios = [];
    for (const mode of ['paid','demo']) for (const size of ['mobile','desktop']) {
      for (const theme of ['light','dark']) scenarios.push({ mode, size, theme,
        viewport: size === 'mobile' ? { width: 390, height: 844 } :
          { width: 1440, height: 1000 } });
    }
    for (const scenario of scenarios) await exercise(browser, scenario, result);
    result.pass = true;
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
