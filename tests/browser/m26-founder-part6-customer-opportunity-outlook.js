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
const marker = 'id="commandCenterCustomerOpportunityOutlook"';
const markerIndex = dashboard.indexOf(marker);
const start = dashboard.lastIndexOf('<section', markerIndex);
const end = dashboard.indexOf('</section>', markerIndex) + '</section>'.length;
assert.ok(start > 0 && markerIndex > start && end > markerIndex,
  'Customer and opportunity insight must stay embedded in Command Center');
const fragment = dashboard.slice(start, end);
const styles = ['style.css', 'demo-dashboard.css'].map(file =>
  fs.readFileSync(path.resolve('public/css', file), 'utf8')).join('\n');

async function pageFor(browser, configuration) {
  const context = await browser.newContext({ viewport: { width: configuration.width, height: 900 },
    colorScheme: configuration.theme });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><head></head><body><main></main></body></html>');
  await page.evaluate(({ fragment, styles, theme }) => {
    const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
    document.documentElement.dataset.theme = theme;
    document.querySelector('main').innerHTML = fragment;
  }, { fragment, styles, theme: configuration.theme });
  await page.addScriptTag({ path: path.resolve(
    'public/js/command-center-customer-opportunity-outlook.js') });
  await page.evaluate(mode => {
    window.__calls = []; window.__responses = [];
    window.__outlook = NorthStarCustomerOpportunityOutlook.create({ document, mode,
      fetcher: async (url, options) => {
        window.__calls.push({ url, method: options.method, cache: options.cache });
        const response = window.__responses.shift();
        if (!response) throw new Error('Unexpected request');
        return { ok: response.status >= 200 && response.status < 300,
          json: async () => response.payload };
      } });
  }, configuration.mode);
  return { context, page, errors };
}

(async () => {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  const result = { engine, pass: false, cases: [] };
  try {
    for (const configuration of [
      { name: 'demo-mobile-dark', width: 390, theme: 'dark', mode: 'demo' },
      { name: 'paid-desktop-light', width: 1280, theme: 'light', mode: 'paid' },
    ]) {
      const { context, page, errors } = await pageFor(browser, configuration);
      if (configuration.mode === 'paid') {
        const data = await page.evaluate(() => {
          const value = NorthStarCustomerOpportunityOutlook.demoOutlook();
          value.fictional = false;
          value.scope.label = 'Current NorthStar-recorded customer and reviewed opportunity records';
          return value;
        });
        await page.evaluate(value => window.__responses.push({ status: 200,
          payload: { success: true, data: value } }), data);
      }
      await page.evaluate(() => window.__outlook.workspaceReady());
      assert.equal(await page.locator('#commandCenterCustomerOpportunityOutlook .btn-primary').count(), 1);
      assert.equal(await page.locator('#commandCenterCustomerOpportunityDetails').getAttribute('open'), null);
      assert.match(await page.locator('#commandCenterCustomerOpportunityAnswer').innerText(),
        /qualified opportunities need an estimate review/i);
      assert.equal(await page.locator('#commandCenterCustomerOpportunityAction').innerText(),
        'Review estimate requests');
      await page.locator('#commandCenterCustomerOpportunityDetails').evaluate(node => { node.open = true; });
      const text = await page.locator('#commandCenterCustomerOpportunityOutlook').innerText();
      assert.match(text, /Current records only/);
      assert.match(text, /does not predict who will book/i);
      assert.doesNotMatch(text, /probability|lifetime value|health score/i);
      await page.locator('#commandCenterCustomerOpportunityDetails > summary').focus();
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Review details');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      await page.locator('#commandCenterCustomerOpportunityOutlook').screenshot({
        path: path.join(output, configuration.name + '.png') });
      result.cases.push({ name: configuration.name,
        paidRequests: await page.evaluate(() => window.__calls.length), pass: true });
      await context.close();
    }
    result.pass = true;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
