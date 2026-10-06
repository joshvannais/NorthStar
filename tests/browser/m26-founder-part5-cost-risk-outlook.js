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
const marker = 'id="commandCenterCostRiskOutlook"';
const markerIndex = dashboard.indexOf(marker);
const start = dashboard.lastIndexOf('<section', markerIndex);
const end = dashboard.indexOf('</section>', markerIndex) + '</section>'.length;
assert.ok(start > 0 && markerIndex > start && end > markerIndex,
  'Cost and risk insight must stay embedded in Command Center');
const fragment = dashboard.slice(start, end);
const styles = ['style.css', 'demo-dashboard.css'].map(file =>
  fs.readFileSync(path.resolve('public/css', file), 'utf8')).join('\n');

async function pageFor(browser, { width, theme, mode }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><head></head><body><main></main></body></html>');
  await page.evaluate(({ fragment, styles, theme }) => {
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);
    document.documentElement.dataset.theme = theme;
    document.querySelector('main').innerHTML = fragment;
  }, { fragment, styles, theme });
  await page.addScriptTag({ path: path.resolve('public/js/command-center-cost-risk-outlook.js') });
  await page.evaluate(modeValue => {
    window.__calls = [];
    window.__responses = [];
    window.__outlook = NorthStarCostRiskOutlook.create({
      document, mode: modeValue,
      fetcher: async (url, options) => {
        window.__calls.push({ url, method: options.method, cache: options.cache });
        const response = window.__responses.shift();
        if (!response) throw new Error('Unexpected request');
        if (response.hold) await new Promise(resolve => { window.__releaseOutlook = resolve; });
        return { ok: response.status >= 200 && response.status < 300,
          json: async () => response.payload };
      },
    });
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
      await page.evaluate(() => window.__outlook.workspaceReady());
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.match(await page.locator('#commandCenterCostRiskAnswer').innerText(),
        /remains after current planned job costs/i);
      assert.equal(await page.locator('#commandCenterCostRiskDetails').getAttribute('open'), null);
      assert.equal(await page.locator('#commandCenterCostRiskOutlook .btn-primary').count(), 1);
      assert.equal(await page.locator('#commandCenterCostRiskAction').innerText(), 'Review estimates');
      await page.locator('#commandCenterCostRiskDetails').evaluate(node => { node.open = true; });
      const text = await page.locator('#commandCenterCostRiskOutlook').innerText();
      assert.match(text, /Planning only/);
      assert.match(text, /Company profit[\s\S]*Not available/);
      assert.match(text, /Delay or equipment downtime[\s\S]*Not available/);
      assert.doesNotMatch(text, /predicted|probability|failure expected/i);
      await page.locator('#commandCenterCostRiskDetails > summary').focus();
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Review details');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      await page.locator('#commandCenterCostRiskOutlook').screenshot({
        path: path.join(output, 'demo-mobile-dark.png') });
      result.cases.push({ name: 'demo-mobile-dark', paidRequests: 0, pass: true });
      await context.close();
    }
    {
      const { context, page, errors } = await pageFor(browser,
        { width: 1280, theme: 'light', mode: 'paid' });
      const demo = await page.evaluate(() => NorthStarCostRiskOutlook.demoOutlook());
      demo.fictional = false;
      demo.scope.label = 'Current owner-confirmed booked work';
      const validation = await page.evaluate(data => {
        const zeroBooked = JSON.parse(JSON.stringify(data));
        zeroBooked.bookedWork = { state: 'current', count: 1, amountBeforeTax: '0.00' };
        zeroBooked.costBasis = { state: 'current', coveredCount: 1, amount: '0.00', reason: null };
        zeroBooked.contribution = { state: 'current', amount: '0.00', reason: null };
        zeroBooked.margin = { state: 'unavailable', percent: null, reason: 'no_booked_value' };
        zeroBooked.concentration = { state: 'none', largestBookedSharePercent: '0.0',
          largestBookedAmount: '0.00', reason: null };
        const corrupt = JSON.parse(JSON.stringify(data));
        corrupt.contribution.amount = '6600.01';
        const invalidDate = JSON.parse(JSON.stringify(data));
        invalidDate.checkedAt = '2026-02-31T12:00:00.000Z';
        return {
          zeroBooked: NorthStarCostRiskOutlook.validate(zeroBooked) !== null,
          corrupt: NorthStarCostRiskOutlook.validate(corrupt) === null,
          invalidDate: NorthStarCostRiskOutlook.validate(invalidDate) === null,
        };
      }, demo);
      assert.deepEqual(validation, { zeroBooked: true, corrupt: true, invalidDate: true });
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data }, hold: true });
        window.__pending = window.__outlook.workspaceReady();
      }, demo);
      assert.equal(await page.locator('#commandCenterCostRiskOutlook').getAttribute('aria-busy'), 'true');
      await page.evaluate(() => window.__releaseOutlook());
      await page.evaluate(() => window.__pending);
      assert.equal(await page.locator('#commandCenterCostRiskState').innerText(), 'Current');
      assert.equal(await page.locator('#commandCenterCostRiskOutlook .btn-primary').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      await page.locator('#commandCenterCostRiskOutlook').screenshot({
        path: path.join(output, 'paid-desktop-light.png') });
      await page.evaluate(data => {
        document.querySelector('#commandCenterCostRiskDetails').open = true;
        window.__responses.push({ status: 200, payload: { success: true, data }, hold: true });
        window.__refreshPending = window.__outlook.workspaceReady();
      }, demo);
      const loading = await page.evaluate(() => ({
        busy: document.querySelector('#commandCenterCostRiskOutlook').getAttribute('aria-busy'),
        scope: document.querySelector('#commandCenterCostRiskScope').textContent,
        facts: ['Booked', 'Cost', 'Contribution', 'Margin', 'Concentration', 'CompanyProfit',
          'Downtime'].map(name => document.querySelector('#commandCenterCostRisk' + name).textContent),
        detailsOpen: document.querySelector('#commandCenterCostRiskDetails').open,
      }));
      assert.equal(loading.busy, 'true');
      assert.equal(loading.scope, 'Checking current scope');
      assert.deepEqual(loading.facts, ['', '', '', '', '', '', '']);
      assert.equal(loading.detailsOpen, false);
      await page.evaluate(() => window.__releaseOutlook());
      await page.evaluate(() => window.__refreshPending);
      assert.deepEqual(await page.evaluate(() => window.__calls), [
        { url: '/api/v1/forecast/cost-risk-outlook/current', method: 'GET', cache: 'no-store' },
        { url: '/api/v1/forecast/cost-risk-outlook/current', method: 'GET', cache: 'no-store' },
      ]);
      await page.evaluate(() => {
        window.__responses.push({ status: 503, payload: { success: false } });
        return window.__outlook.workspaceReady();
      });
      const unavailable = await page.locator('#commandCenterCostRiskOutlook').innerText();
      assert.match(unavailable, /Unavailable/);
      assert.doesNotMatch(unavailable, /\$0/);
      assert.equal(await page.locator('#commandCenterCostRiskOutlook').getAttribute('aria-busy'), 'false');
      result.cases.push({ name: 'paid-desktop-light', paidRequests: 3,
        refreshClearedPriorFacts: true, failClosed: true, pass: true });
      await context.close();
    }
    result.pass = true;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
