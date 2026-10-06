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
const start = dashboard.indexOf('<section class="demo-panel command-center-range-outlook');
const end = dashboard.indexOf('</section>', start) + '</section>'.length;
assert.ok(start > 0 && end > start, 'Revenue and cash insight must stay embedded in Command Center');
const fragment = dashboard.slice(start, end);
const styles = ['style.css', 'demo-dashboard.css'].map(file =>
  fs.readFileSync(path.resolve('public/css', file), 'utf8')).join('\n');

async function pageFor(browser, { width, theme, mode, reducedMotion = false }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
  const page = await context.newPage();
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
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
  await page.addScriptTag({ path: path.resolve('public/js/command-center-revenue-cash-outlook.js') });
  await page.evaluate(modeValue => {
    window.__calls = [];
    window.__responses = [];
    window.__outlook = NorthStarRevenueCashOutlook.create({
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
        { width: 390, theme: 'dark', mode: 'demo', reducedMotion: true });
      await page.evaluate(() => window.__outlook.workspaceReady());
      assert.equal(await page.evaluate(() => window.__calls.length), 0,
        'Fictional demo must not call the paid endpoint');
      assert.match(await page.locator('#commandCenterRevenueCashAnswer').innerText(),
        /owner-confirmed booked work/i);
      assert.equal(await page.locator('#commandCenterRevenueCashDetails').getAttribute('open'), null);
      assert.equal(await page.locator('#commandCenterRevenueCashOutlook .btn-primary').count(), 1);
      assert.equal(await page.locator('#commandCenterRevenueCashAction').innerText(),
        'Review estimates and leads');
      await page.locator('#commandCenterRevenueCashDetails').evaluate(node => { node.open = true; });
      const text = await page.locator('#commandCenterRevenueCashOutlook').innerText();
      assert.match(text, /Planning only/);
      assert.match(text, /Earned revenue[\s\S]*Not available/);
      assert.match(text, /Cash timing[\s\S]*Not available/);
      assert.doesNotMatch(text, /confidence|probability forecast|\$0[^0-9]/i);
      await page.locator('#commandCenterRevenueCashDetails > summary').focus();
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Review details');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      await page.locator('#commandCenterRevenueCashOutlook').screenshot({
        path: path.join(output, 'demo-mobile-dark.png') });
      result.cases.push({ name: 'demo-mobile-dark', paidRequests: 0, pass: true });
      await context.close();
    }
    {
      const { context, page, errors } = await pageFor(browser,
        { width: 1280, theme: 'light', mode: 'paid' });
      const demo = await page.evaluate(() => NorthStarRevenueCashOutlook.demoOutlook());
      demo.fictional = false;
      demo.scope.label = 'Current supported NorthStar commercial records';
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data }, hold: true });
        window.__pending = window.__outlook.workspaceReady();
      }, demo);
      assert.equal(await page.locator('#commandCenterRevenueCashOutlook').getAttribute('aria-busy'), 'true');
      await page.evaluate(() => window.__releaseOutlook());
      await page.evaluate(() => window.__pending);
      assert.equal(await page.locator('#commandCenterRevenueCashState').innerText(), 'Current');
      assert.equal(await page.locator('#commandCenterRevenueCashOutlook .btn-primary').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      await page.locator('#commandCenterRevenueCashOutlook').screenshot({
        path: path.join(output, 'paid-desktop-light.png') });

      await page.evaluate(data => {
        document.querySelector('#commandCenterRevenueCashDetails').open = true;
        window.__responses.push({ status: 200, payload: { success: true, data }, hold: true });
        window.__refreshPending = window.__outlook.workspaceReady();
      }, demo);
      const loadingState = await page.evaluate(() => ({
        busy: document.querySelector('#commandCenterRevenueCashOutlook').getAttribute('aria-busy'),
        scope: document.querySelector('#commandCenterRevenueCashScope').textContent,
        checkedAt: document.querySelector('#commandCenterRevenueCashCheckedAt').textContent,
        facts: ['Authorized', 'Approved', 'Booked', 'ApprovedOpen', 'Preliminary', 'Earned', 'Cash']
          .map(suffix => document.querySelector('#commandCenterRevenueCash' + suffix).textContent),
        detailsBody: document.querySelector('#commandCenterRevenueCashDetailsBody').textContent,
        detailsOpen: document.querySelector('#commandCenterRevenueCashDetails').open,
        text: document.querySelector('#commandCenterRevenueCashOutlook').innerText,
      }));
      assert.equal(loadingState.busy, 'true');
      assert.equal(loadingState.scope, 'Checking current scope');
      assert.equal(loadingState.checkedAt, 'Checking now');
      assert.deepEqual(loadingState.facts, ['', '', '', '', '', '', '']);
      assert.equal(loadingState.detailsBody, '');
      assert.equal(loadingState.detailsOpen, false);
      assert.doesNotMatch(loadingState.text, /\$[0-9]|[0-9]+ open/i,
        'Refresh loading must not retain prior commercial facts');
      await page.evaluate(() => window.__releaseOutlook());
      await page.evaluate(() => window.__refreshPending);
      assert.deepEqual(await page.evaluate(() => window.__calls), [
        { url: '/api/v1/forecast/revenue-cash-outlook/current', method: 'GET', cache: 'no-store' },
        { url: '/api/v1/forecast/revenue-cash-outlook/current', method: 'GET', cache: 'no-store' },
      ]);
      result.cases.push({ name: 'paid-desktop-light', paidRequests: 2,
        refreshClearedPriorFacts: true, pass: true });

      await page.evaluate(() => {
        window.__responses.push({ status: 503, payload: { success: false } });
        return window.__outlook.workspaceReady();
      });
      const unavailable = await page.locator('#commandCenterRevenueCashOutlook').innerText();
      assert.match(unavailable, /Unavailable/);
      assert.doesNotMatch(unavailable, /\$0/);
      assert.equal(await page.locator('#commandCenterRevenueCashOutlook').getAttribute('aria-busy'), 'false');
      result.cases.push({ name: 'paid-fail-closed', pass: true });
      await context.close();
    }
    result.pass = true;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
