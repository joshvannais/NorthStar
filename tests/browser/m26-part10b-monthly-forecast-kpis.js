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
  await page.evaluate(({ mode, tenant, origin }) => {
    window.__calls = []; window.__responses = []; window.__announcements = [];
    window.__authority = { tenantId: tenant, role: mode === 'demo' ? 'viewer' : 'owner',
      mode, fictional: mode === 'demo' };
    const status = document.getElementById('commandCenterMonthlyForecastKpisStatus');
    new MutationObserver(() => window.__announcements.push(status.textContent))
      .observe(status, { childList: true, characterData: true, subtree: true });
    window.__monthly = NorthStarMonthlyForecastKpis.create({ document, mode,
      originProvider: () => origin, fetcher: async (url, options) => {
        window.__calls.push({ url, method: options.method, cache: options.cache });
        const response = window.__responses.shift();
        if (!response) throw new Error('Unexpected request');
        if (response.hold) await new Promise(resolve => { window.__releaseMonthly = resolve; });
        return { ok: response.status >= 200 && response.status < 300,
          json: async () => response.payload };
      } });
  }, { mode: scenario.mode, tenant: TENANTS[scenario.mode], origin: ORIGIN });
  return { context, page, errors };
}

async function statusIsExposed(context, page) {
  const status = page.locator('#commandCenterMonthlyForecastKpisStatus');
  assert.equal(await status.getAttribute('role'), 'status');
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  assert.equal(await status.getAttribute('aria-atomic'), 'true');
  if (engine === 'chrome') {
    const session = await context.newCDPSession(page);
    const root = await session.send('DOM.getDocument');
    const target = await session.send('DOM.querySelector', {
      nodeId: root.root.nodeId, selector: '#commandCenterMonthlyForecastKpisStatus',
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
    const summary = page.locator('#commandCenterMonthlyForecastKpis details summary');
    await summary.focus(); assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    await summary.press('Enter');
    assert.notEqual(await summary.locator('..').getAttribute('open'), null);
    assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    await statusIsExposed(context, page);

    if (scenario.mode === 'demo') {
      await page.evaluate(() => window.__monthly.workspaceReady(window.__authority));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.equal(await page.locator('#commandCenterMonthlyForecastKpisState').innerText(),
        'Fictional guard');
      assert.match(await page.locator('#commandCenterMonthlyForecastKpisExplanation').innerText(),
        /isolated fictional example.*no paid forecast call.*no fabricated KPI value/i);
      await page.evaluate(() => window.__monthly.workspaceUnavailable());
      assert.equal(await page.locator('#commandCenterMonthlyForecastKpisState').innerText(),
        'Workspace unavailable');
      assert.equal(await page.locator('#commandCenterMonthlyForecastKpiRevenueState').innerText(),
        'Unavailable');
      await page.evaluate(() => window.__monthly.workspaceReady(window.__authority));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
    } else {
      const value = await page.evaluate(tenant => NorthStarMonthlyForecastKpis.demoBundle(tenant),
        TENANTS.paid);
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data }, hold: true });
        document.getElementById('commandCenterMonthlyForecastKpiProfitValue').textContent =
          'stale private value';
        document.getElementById('commandCenterMonthlyForecastKpisAuthority').textContent =
          'stale private identity';
        window.__pendingMonthly = window.__monthly.workspaceReady(window.__authority);
      }, value);
      assert.equal(await page.locator('#commandCenterMonthlyForecastKpiProfitValue').innerText(),
        'Not available');
      assert.doesNotMatch(await page.locator('#commandCenterMonthlyForecastKpisAuthority').innerText(),
        /stale private identity/);
      await page.evaluate(() => window.__releaseMonthly());
      await page.evaluate(() => window.__pendingMonthly);
      assert.deepEqual(await page.evaluate(() => window.__calls), [{
        url: `/api/v1/forecast/monthly-kpis/${ORIGIN}`, method: 'GET', cache: 'no-store',
      }]);
      assert.match(await page.locator('#commandCenterMonthlyForecastKpisAuthority').innerText(),
        /Tenant a0000000.*source anchor.*run and manifest identities unavailable/i);

      await page.evaluate(data => {
        const stale = JSON.parse(JSON.stringify(data));
        stale.reason = 'deterministic_baseline_not_current'; stale.anchor = null;
        stale.month = null; stale.graph.month = null; stale.digests.bundle = null;
        stale.anchorSourceAuthenticated = false; stale.currentness.anchorCurrent = false;
        stale.currentness.correctionOrRevocationApplied = true;
        stale.slots.forEach(slot => { slot.reason = stale.reason; });
        stale.graph.reason = stale.reason;
        window.__responses.push({ status: 200, payload: { success: true, data: stale } });
        return window.__monthly.workspaceReady(window.__authority);
      }, value);
      assert.match(await page.locator('#commandCenterMonthlyForecastKpisAuthority').innerText(),
        /prior source anchor was cleared/i);
      assert.match(await page.locator('#commandCenterMonthlyForecastKpisExplanation').innerText(),
        /source changed/i);
      assert.equal(await page.locator('#commandCenterMonthlyForecastKpiRevenueState').innerText(),
        'Target presence unknown; run manifest unavailable');

      await page.evaluate(() => {
        window.__responses.push({ status: 503,
          payload: { success: false, error: { message: 'unavailable' } } });
        return window.__monthly.workspaceReady(window.__authority);
      });
      assert.match(await page.locator('#commandCenterMonthlyForecastKpisAuthority').innerText(),
        /No authenticated run identity is retained/i);
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data } });
        return window.__monthly.workspaceReady(window.__authority);
      }, value);
      assert.equal(await page.locator('#commandCenterMonthlyForecastKpisState').innerText(),
        'KPIs unavailable');
      assert.doesNotMatch(await page.locator('#commandCenterMonthlyForecastKpisExplanation').innerText(),
        /fictional/i);
    }

    for (const suffix of SUFFIXES) {
      const value = await page.locator(`#commandCenterMonthlyForecastKpi${suffix}Value`).innerText();
      assert.equal(value, 'Not available');
      assert.doesNotMatch(value, /\b0(?:\.0+)?\b|%|confidence|probability/i);
      const state = await page.locator(`#commandCenterMonthlyForecastKpi${suffix}State`).innerText();
      assert.equal(state, 'Target presence unknown; run manifest unavailable');
      assert.doesNotMatch(state, /absent from authenticated run/i);
    }
    assert.match(await page.locator('#commandCenterMonthlyForecastKpiGraphPlot').innerText(),
      /points are withheld/i);
    assert.match(await page.locator('#commandCenterMonthlyForecastKpisBoundary').innerText(),
      /Each target keeps its own definition, unit, scope and applicability.*Profit and margin.*missing/i);
    assert.equal(await page.locator('.command-center-monthly-kpi-grid article').count(), 6);
    assert.equal(await page.locator('#commandCenterMonthlyForecastKpis details').count(), 1);

    const inspection = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      busy: document.getElementById('commandCenterMonthlyForecastKpis').getAttribute('aria-busy'),
      columns: getComputedStyle(document.querySelector('.command-center-monthly-kpi-grid'))
        .gridTemplateColumns.split(' ').length,
      motion: Array.from(document.querySelectorAll('#commandCenterMonthlyForecastKpis *')).map(node => {
        const style = getComputedStyle(node); return { id: node.id,
          animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
      }).filter(value => parseFloat(value.animationDuration) > 0.001 ||
        parseFloat(value.transitionDuration) > 0.001),
    }));
    assert.equal(inspection.scrollWidth, inspection.clientWidth);
    assert.equal(inspection.busy, 'false'); assert.deepEqual(inspection.motion, []);
    assert.equal(inspection.columns, scenario.size === 'mobile' ? 1 : 3);
    assert.match(await page.evaluate(() => window.__announcements.at(-1)),
      /Six monthly KPI cards and graph points remain unavailable/i);
    assert.deepEqual(errors, []);
    const name = [scenario.mode, scenario.size, scenario.theme].join('-');
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    result.cases.push({ name, paidDemoIsolation: true, sameRunValuesWithheld: true,
      correctionFailureAndRecovery: true, staleValuesCleared: true,
      zeroDistinctFromUnavailable: true, keyboardAndStatusAccessible: true,
      responsiveCards: true, reducedMotion: true, pass: true });
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
