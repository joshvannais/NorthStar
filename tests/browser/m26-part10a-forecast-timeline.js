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
const styles = ['style.css', 'demo-dashboard.css'].map(file =>
  fs.readFileSync(path.resolve('public/css', file), 'utf8')
    .replace(/^\s*\@import[^;]+;\s*/gm, '')).join('\n');
const TENANTS = { paid: 'a0000000-0000-4000-8000-000000000010',
  demo: 'd0000000-0000-4000-8000-000000000010' };

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
  await page.addScriptTag({ path: path.resolve('public/js/command-center-forecast-timeline.js') });
  await page.evaluate(({ mode, tenant }) => {
    window.__calls = []; window.__responses = []; window.__announcements = [];
    window.__authority = { tenantId: tenant, role: mode === 'demo' ? 'viewer' : 'owner',
      mode, fictional: mode === 'demo' };
    const status = document.getElementById('commandCenterForecastTimelineStatus');
    new MutationObserver(() => window.__announcements.push(status.textContent))
      .observe(status, { childList: true, characterData: true, subtree: true });
    window.__timeline = NorthStarForecastTimeline.create({ document, mode,
      originProvider: () => '90000000-0000-4000-8000-000000000010',
      fetcher: async (url, options) => {
        window.__calls.push({ url, method: options.method, cache: options.cache });
        const response = window.__responses.shift();
        if (!response) throw new Error('Unexpected request');
        if (response.hold) await new Promise(resolve => { window.__releaseTimeline = resolve; });
        return { ok: response.status >= 200 && response.status < 300,
          json: async () => response.payload };
      } });
  }, { mode: scenario.mode, tenant: TENANTS[scenario.mode] });
  return { context, page, errors };
}

async function statusIsExposed(context, page) {
  const status = page.locator('#commandCenterForecastTimelineStatus');
  assert.equal(await status.getAttribute('role'), 'status');
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  assert.equal(await status.getAttribute('aria-atomic'), 'true');
  if (engine === 'chrome') {
    const session = await context.newCDPSession(page);
    const root = await session.send('DOM.getDocument');
    const target = await session.send('DOM.querySelector', {
      nodeId: root.root.nodeId, selector: '#commandCenterForecastTimelineStatus',
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
    const summary = page.locator('#commandCenterForecastTimeline details summary');
    await summary.focus(); assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    await summary.press('Enter');
    assert.notEqual(await summary.locator('..').getAttribute('open'), null);
    assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    await statusIsExposed(context, page);

    if (scenario.mode === 'demo') {
      await page.evaluate(() => window.__timeline.workspaceReady(window.__authority));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.equal(await page.locator('#commandCenterForecastTimelineState').innerText(),
        'Fictional guard');
      assert.match(await page.locator('#commandCenterForecastTimelineExplanation').innerText(),
        /isolated fictional example.*does not call paid forecast routes/i);
      await page.evaluate(() => window.__timeline.workspaceUnavailable());
      assert.equal(await page.locator('#commandCenterForecastTimelineState').innerText(),
        'Workspace unavailable');
      await page.evaluate(() => window.__timeline.workspaceReady(window.__authority));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
    } else {
      const value = await page.evaluate(tenant => NorthStarForecastTimeline.demoTimeline(tenant),
        TENANTS.paid);
      await page.evaluate(data => {
        window.__responses.push({ status: 200,
          payload: { success: true, data }, hold: true });
        document.getElementById('commandCenterForecastTimelineWeekCurrent').textContent =
          'stale private value';
        document.getElementById('commandCenterForecastTimelineAuthority').textContent =
          'stale private identity';
        window.__pendingTimeline = window.__timeline.workspaceReady(window.__authority);
      }, value);
      assert.equal(await page.locator('#commandCenterForecastTimelineWeekCurrent').innerText(),
        'Not available');
      assert.doesNotMatch(await page.locator('#commandCenterForecastTimelineAuthority').innerText(),
        /stale private identity/);
      await page.evaluate(() => window.__releaseTimeline());
      await page.evaluate(() => window.__pendingTimeline);
      assert.deepEqual(await page.evaluate(() => window.__calls), [{
        url: '/api/v1/forecast/timelines/90000000-0000-4000-8000-000000000010',
        method: 'GET', cache: 'no-store',
      }]);
      assert.match(await page.locator('#commandCenterForecastTimelineAuthority').innerText(),
        /Tenant a0000000.*demand\.inbound_leads@v1.*America\/New_York/i);

      await page.evaluate(data => {
        const stale = JSON.parse(JSON.stringify(data));
        stale.reason = 'deterministic_baseline_not_current'; stale.subject = null;
        stale.digests.timeline = null; stale.sourceAuthenticated = false;
        stale.currentness.baselineCurrent = false;
        stale.currentness.correctionOrRevocationApplied = true;
        stale.periods.forEach(period => { period.reason = stale.reason; });
        window.__responses.push({ status: 200, payload: { success: true, data: stale } });
        return window.__timeline.workspaceReady(window.__authority);
      }, value);
      assert.match(await page.locator('#commandCenterForecastTimelineAuthority').innerText(),
        /prior authenticated subject was cleared/i);
      assert.match(await page.locator('#commandCenterForecastTimelineExplanation').innerText(),
        /source or profile changed/i);

      await page.evaluate(() => {
        window.__responses.push({ status: 503,
          payload: { success: false, error: { message: 'unavailable' } } });
        return window.__timeline.workspaceReady(window.__authority);
      });
      assert.equal(await page.locator('#commandCenterForecastTimelineWeekCurrent').innerText(),
        'Not available');
      assert.match(await page.locator('#commandCenterForecastTimelineAuthority').innerText(),
        /No authenticated timeline identity is retained/i);

      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data } });
        return window.__timeline.workspaceReady(window.__authority);
      }, value);
      assert.equal(await page.locator('#commandCenterForecastTimelineState').innerText(),
        'Timeline unavailable');
      assert.doesNotMatch(await page.locator('#commandCenterForecastTimelineExplanation').innerText(),
        /fictional/i);
    }

    for (const grain of ['Week', 'Month', 'Quarter']) {
      assert.equal(await page.locator(`#commandCenterForecastTimeline${grain}State`).innerText(),
        'UNAVAILABLE');
      for (const kind of ['Current', 'Prior', 'Actual']) {
        const text = await page.locator(
          `#commandCenterForecastTimeline${grain}${kind}`).innerText();
        assert.equal(text, 'Not available');
        assert.doesNotMatch(text, /\b0(?:\.0+)?\b|%|confidence|probability/i);
      }
    }
    assert.match(await page.locator('#commandCenterForecastTimelineBoundary').innerText(),
      /actually issued compatible run.*earlier issued run.*later-finalized source outcome.*never zero/i);
    assert.equal(await page.locator('.command-center-forecast-timeline-table caption').count(), 1);
    assert.equal(await page.locator('.command-center-forecast-timeline-table th[scope="row"]').count(), 3);
    assert.equal(await page.locator('.command-center-forecast-timeline-table th[scope="col"]').count(), 4);

    const inspection = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      busy: document.getElementById('commandCenterForecastTimeline').getAttribute('aria-busy'),
      motion: Array.from(document.querySelectorAll('#commandCenterForecastTimeline *')).map(node => {
        const style = getComputedStyle(node); return { id: node.id,
          animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
      }).filter(value => parseFloat(value.animationDuration) > 0.001 ||
        parseFloat(value.transitionDuration) > 0.001),
      tableScrollContained: (() => { const wrapper = document.querySelector(
        '.command-center-forecast-timeline-table-wrap');
      return wrapper.scrollWidth >= wrapper.clientWidth &&
        getComputedStyle(wrapper).overflowX === 'auto'; })(),
    }));
    assert.equal(inspection.scrollWidth, inspection.clientWidth);
    assert.equal(inspection.busy, 'false'); assert.deepEqual(inspection.motion, []);
    assert.equal(inspection.tableScrollContained, true);
    assert.match(await page.evaluate(() => window.__announcements.at(-1)),
      /Weekly, monthly and quarterly comparisons remain unavailable/i);
    assert.deepEqual(errors, []);
    const name = [scenario.mode, scenario.size, scenario.theme].join('-');
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    result.cases.push({ name, paidDemoIsolation: true, completeInventoryWithheld: true,
      correctionFailureAndRecovery: true, staleValuesCleared: true,
      zeroDistinctFromUnavailable: true, keyboardAndStatusAccessible: true,
      allThreeGrains: true, responsiveTable: true, reducedMotion: true, pass: true });
  } finally { await context.close(); }
}

(async () => {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  const result = { engine, pass: false, cases: [] };
  try {
    const scenarios = [];
    for (const mode of ['paid', 'demo']) for (const size of ['mobile', 'desktop']) {
      for (const theme of ['light', 'dark']) scenarios.push({ mode, size, theme,
        viewport: size === 'mobile' ? { width: 390, height: 844 } :
          { width: 1440, height: 1000 } });
    }
    for (const scenario of scenarios) await exercise(browser, scenario, result);
    result.pass = true;
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
