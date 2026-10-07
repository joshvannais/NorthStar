'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const engine = process.argv[2];
const output = path.resolve(process.argv[3]);
assert.ok(!fs.existsSync(output), 'Browser evidence directory must be new');
fs.mkdirSync(output, { recursive: true });
const dashboard = fs.readFileSync(path.resolve('public/demo-dashboard.html'), 'utf8');
const markerIndex = dashboard.indexOf('id="commandCenterCostRiskOutlook"');
const start = dashboard.lastIndexOf('<section', markerIndex);
const end = dashboard.indexOf('</section>', markerIndex) + '</section>'.length;
assert.ok(start > 0 && markerIndex > start && end > markerIndex,
  'Overhead and cash forecast must stay inside the existing Command Center cost insight');
const fragment = dashboard.slice(start, end);
const styles = ['style.css', 'demo-dashboard.css'].map(file =>
  fs.readFileSync(path.resolve('public/css', file), 'utf8')).join('\n');

async function pageFor(browser, { width, theme, mode }) {
  const context = await browser.newContext({ viewport: { width, height: 900 },
    colorScheme: theme, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><head></head><body><main></main></body></html>');
  await page.evaluate(({ fragment, styles, theme }) => {
    const style = document.createElement('style'); style.textContent = styles;
    document.head.append(style); document.documentElement.dataset.theme = theme;
    document.querySelector('main').innerHTML = fragment;
  }, { fragment, styles, theme });
  await page.addScriptTag({ path: path.resolve(
    'public/js/command-center-overhead-cash-forecast.js') });
  await page.evaluate(modeValue => {
    window.__calls = []; window.__responses = []; window.__announcements = [];
    new MutationObserver(function () {
      var message = document.getElementById('commandCenterOverheadCashForecastStatus').textContent;
      if (window.__announcements.at(-1) !== message) window.__announcements.push(message);
    }).observe(document.getElementById('commandCenterOverheadCashForecastStatus'),
      { childList: true, characterData: true, subtree: true });
    window.__forecast = NorthStarOverheadCashForecast.create({ document, mode: modeValue,
      fetcher: async (url, options) => {
        window.__calls.push({ url, method: options.method, cache: options.cache });
        const response = window.__responses.shift();
        if (!response) throw new Error('Unexpected request');
        if (response.hold) await new Promise(resolve => { window.__releaseForecast = resolve; });
        return { ok: response.status >= 200 && response.status < 300,
          json: async () => response.payload };
      } });
  }, mode);
  return { context, page, errors };
}

(async () => {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  const result = { engine, pass: false, cases: [] };
  try {
    {
      const { context, page, errors } = await pageFor(browser,
        { width: 390, theme: 'dark', mode: 'demo' });
      await page.evaluate(() => window.__forecast.workspaceReady());
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.equal(await page.locator('#commandCenterCostRiskDetails').getAttribute('open'), null);
      if (engine === 'chrome') {
        const session = await context.newCDPSession(page);
        const documentNode = await session.send('DOM.getDocument');
        const target = await session.send('DOM.querySelector', {
          nodeId: documentNode.root.nodeId, selector: '#commandCenterOverheadCashForecastStatus',
        });
        const tree = await session.send('Accessibility.getPartialAXTree', {
          nodeId: target.nodeId, fetchRelatives: false,
        });
        const status = tree.nodes.find(node => node.role && node.role.value === 'status');
        assert.ok(status && status.ignored === false,
          'Overhead and cash status must remain exposed while Review details is collapsed');
        assert.ok(status.properties.some(property => property.name === 'live' &&
          property.value.value === 'polite'));
      }
      await page.locator('#commandCenterCostRiskDetails').evaluate(node => { node.open = true; });
      assert.equal(await page.locator('#commandCenterOverheadCashForecast').innerText(),
        '$3,200 overhead + $1,150 dated asset cash');
      const contextText = await page.locator('#commandCenterOverheadCashForecastContext').innerText();
      assert.match(contextText, /4 scheduled due dates from the current complete owner-recorded set/);
      assert.match(contextText, /Owner-marked satisfied dates are not proof of payment/);
      assert.match(contextText, /Job-cost allocation and economic depreciation stay separate/);
      assert.equal(await page.locator('#commandCenterCostRiskOutlook .btn-primary').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      await page.locator('#commandCenterCostRiskOutlook').screenshot({
        path: path.join(output, 'demo-mobile-dark.png') });
      result.cases.push({ name: 'demo-mobile-dark', paidRequests: 0,
        collapsedByDefault: true, statusExposedWhileCollapsed: true,
        oneExistingAction: true, noHorizontalOverflow: true, pass: true });
      await context.close();
    }
    {
      const { context, page, errors } = await pageFor(browser,
        { width: 1280, theme: 'light', mode: 'paid' });
      const paid = await page.evaluate(() => {
        const value = NorthStarOverheadCashForecast.demoForecast();
        value.fictional = false;
        value.overhead = { state: 'current', amount: '1200.00', dueCount: 2,
          scheduleCount: 1, reason: null };
        value.financedAssetCash = { state: 'current', amount: '500.00', dueCount: 1,
          obligationCount: 1, ownerMarkedSatisfiedCount: 1, canceledCount: 1, reason: null };
        return value;
      });
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data }, hold: true });
        window.__pending = window.__forecast.workspaceReady();
      }, paid);
      assert.match(await page.locator('#commandCenterOverheadCashForecast').textContent(),
        /Checking owner-recorded company obligation schedules/);
      assert.equal(await page.locator('#commandCenterOverheadCashForecastContext').textContent(), '');
      await page.evaluate(() => window.__releaseForecast());
      await page.evaluate(() => window.__pending);
      await page.locator('#commandCenterCostRiskDetails').evaluate(node => { node.open = true; });
      assert.equal(await page.locator('#commandCenterOverheadCashForecast').innerText(),
        '$1,200 overhead + $500 dated asset cash');
      assert.deepEqual(await page.evaluate(() => window.__calls), [
        { url: '/api/v1/forecast/overhead-cash/current', method: 'GET', cache: 'no-store' },
      ]);
      assert.match(await page.locator('#commandCenterOverheadCashForecastStatus').textContent(),
        /Next 30-day overhead and financed-asset cash: \$1,200 overhead \+ \$500 dated asset cash/);
      await page.locator('#commandCenterCostRiskOutlook').screenshot({
        path: path.join(output, 'paid-desktop-light.png') });
      await page.evaluate(() => {
        window.__responses.push({ status: 503, payload: { success: false } });
        return window.__forecast.workspaceReady();
      });
      assert.equal(await page.locator('#commandCenterOverheadCashForecast').innerText(), 'Not available');
      const unavailable = await page.locator('#commandCenterOverheadCashForecastContext').innerText();
      assert.match(unavailable, /current complete owner-recorded schedule/i);
      assert.doesNotMatch(unavailable, /\$0/);
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data } });
        return window.__forecast.workspaceReady();
      }, paid);
      assert.equal(await page.locator('#commandCenterOverheadCashForecast').innerText(),
        '$1,200 overhead + $500 dated asset cash');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      result.cases.push({ name: 'paid-desktop-light', paidRequests: 3,
        loadingClearedPriorFacts: true, failClosed: true, recovered: true,
        atomicAnnouncements: true, noHorizontalOverflow: true, pass: true });
      await context.close();
    }
    result.pass = true;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
