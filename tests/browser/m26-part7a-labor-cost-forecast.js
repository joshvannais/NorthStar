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
  'Labor forecast must stay inside the existing Command Center cost insight');
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
  await page.addScriptTag({ path: path.resolve('public/js/command-center-labor-cost-forecast.js') });
  await page.evaluate(modeValue => {
    window.__calls = []; window.__responses = [];
    window.__forecast = NorthStarLaborCostForecast.create({ document, mode: modeValue,
      fetcher: async (url, options) => {
        window.__calls.push({ url, method: options.method, cache: options.cache });
        const response = window.__responses.shift();
        if (!response) throw new Error('Unexpected request');
        if (response.hold) await new Promise(resolve => { window.__releaseForecast = resolve; });
        return { ok: response.status >= 200 && response.status < 300,
          json: async () => response.payload };
      } } );
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
      await page.locator('#commandCenterCostRiskDetails').evaluate(node => { node.open = true; });
      assert.match(await page.locator('#commandCenterLaborForecast').innerText(),
        /\$4,320 for 96 planned hours/);
      const contextText = await page.locator('#commandCenterLaborForecastContext').innerText();
      assert.match(contextText, /3 scheduled jobs in the next 30 days/);
      assert.match(contextText, /payroll, attendance, whole-business coverage, probability, and calibrated ranges are not verified/i);
      assert.equal(await page.locator('#commandCenterCostRiskOutlook .btn-primary').count(), 1);
      await page.locator('#commandCenterCostRiskDetails > summary').focus();
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Review details');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      await page.locator('#commandCenterCostRiskOutlook').screenshot({
        path: path.join(output, 'demo-mobile-dark.png') });
      result.cases.push({ name: 'demo-mobile-dark', paidRequests: 0,
        collapsedByDefault: true, oneExistingAction: true, pass: true });
      await context.close();
    }
    {
      const { context, page, errors } = await pageFor(browser,
        { width: 1280, theme: 'light', mode: 'paid' });
      const paid = await page.evaluate(() => {
        const value = NorthStarLaborCostForecast.demoForecast();
        value.fictional = false;
        value.scope.label = 'Next 30 days of authenticated NorthStar scheduled backlog';
        value.work = { state: 'current', scheduledCount: 1, unscheduledCount: 0,
          outsideWindowCount: 0 };
        value.plannedLabor = { state: 'current', coveredCount: 1,
          personHours: '1.000000', cost: '50.00', reason: null };
        return value;
      });
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data }, hold: true });
        window.__pending = window.__forecast.workspaceReady();
      }, paid);
      assert.match(await page.locator('#commandCenterLaborForecast').textContent(), /Checking planned work/);
      assert.equal(await page.locator('#commandCenterLaborForecastContext').textContent(), '');
      await page.evaluate(() => window.__releaseForecast());
      await page.evaluate(() => window.__pending);
      await page.locator('#commandCenterCostRiskDetails').evaluate(node => { node.open = true; });
      assert.equal(await page.locator('#commandCenterLaborForecast').innerText(),
        '$50 for 1 planned hour');
      assert.deepEqual(await page.evaluate(() => window.__calls), [
        { url: '/api/v1/forecast/labor-cost/current', method: 'GET', cache: 'no-store' },
      ]);
      await page.locator('#commandCenterCostRiskOutlook').screenshot({
        path: path.join(output, 'paid-desktop-light.png') });
      await page.evaluate(() => {
        window.__responses.push({ status: 503, payload: { success: false } });
        return window.__forecast.workspaceReady();
      });
      assert.equal(await page.locator('#commandCenterLaborForecast').innerText(), 'Not available');
      assert.match(await page.locator('#commandCenterLaborForecastContext').innerText(),
        /evidence is incomplete/i);
      assert.doesNotMatch(await page.locator('#commandCenterLaborForecastContext').innerText(), /\$0/);
      await page.evaluate(() => window.__forecast.workspaceUnavailable());
      assert.equal(await page.locator('#commandCenterLaborForecast').innerText(), 'Not available');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      result.cases.push({ name: 'paid-desktop-light', paidRequests: 2,
        loadingClearedPriorFacts: true, failClosed: true, pass: true });
      await context.close();
    }
    result.pass = true;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
