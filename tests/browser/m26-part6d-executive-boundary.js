'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { MISSION_26_FIVE_LAYOUTS, auditRenderedPage, exerciseSkipLink } =
  require('../helpers/m26-part12d-rendered-review');

const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });

async function main() {
  const app = require('../../src/server').app;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = resolveBrowserRuntime(process.argv.includes('--webkit') ? 'webkit' : 'chrome');
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  try {
    for (const scenario of [
      { name: 'priced', total: 11200 }, { name: 'unknown', total: 0 },
      { name: 'failure', total: null, failure: true },
    ]) for (const viewport of MISSION_26_FIVE_LAYOUTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
        colorScheme: viewport.colorScheme, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      const outsideRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { outsideRequests.push(url.href); return route.abort(); }
        if (url.pathname === '/js/polaris-api.js') return route.fulfill({
          contentType: 'application/javascript', body: `window.PolarisApi = {
            getExecutiveSummary: () => ${scenario.failure ?
              "Promise.reject(new Error('internal_provider_payload_7f3a'))" : `Promise.resolve({
              revenue: { total: ${scenario.total} }, pipeline: { activeDeals: 2 },
              recommendations: [{ title: 'Review the estimate', priority: 'medium',
                confidence: 85, businessImpact: 'Revenue', explanation: 'Check the scope.' }],
            })`}, getDashboard: () => Promise.resolve({}),
            getCustomers: () => Promise.resolve({ customers: [] }),
            getPipeline: () => Promise.resolve([]),
          };`,
        });
        if (url.pathname === '/js/auth-session.js') return route.fulfill({
          contentType: 'application/javascript', body: `window.NorthStarAccountSession={
            load:function(){return Promise.resolve({mode:'paid',
              navigation:[{id:'command-center',href:'/dashboard'}]});}};`,
        });
        if (url.pathname === '/js/command-center-contract.js' ||
            url.pathname === '/js/nav-component.js') return route.continue();
        if (url.pathname === '/js/theme.js') return route.continue();
        if (url.pathname.startsWith('/js/')) return route.fulfill({
          contentType: 'application/javascript', body: '',
        });
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
        return route.continue();
      });
      await page.goto(origin + '/dashboard/executive-brief');
      if (scenario.failure) {
        await page.locator('#ebLoading').getByText('Executive Brief could not be updated.',
          { exact: true }).waitFor();
      } else {
        await page.locator('#ebRevenue').getByText('Original Estimate Guidance',
          { exact: true }).waitFor();
      }
      const summary = await page.locator('#ebSummary').innerText();
      const revenue = await page.locator('#ebRevenue').innerText();
      const full = await page.locator('#ebContent').innerText();
      if (scenario.name === 'priced') {
        assert.match(summary, /Original estimate guidance totals \$11\.2k/);
        assert.match(summary, /not approved or earned revenue/);
      } else if (scenario.name === 'unknown') {
        assert.doesNotMatch(summary, /guidance totals|\$0/);
        assert.match(revenue, /Not available\s+Original Estimate Guidance/i);
      } else {
        assert.match(summary, /temporarily unavailable/i);
        assert.match(full, /Estimate and revenue status is unavailable/i);
        assert.match(full, /Recommended actions are unavailable/i);
        assert.doesNotMatch(full, /Loading\.\.\.|internal_provider_payload|7f3a/i);
        assert.equal(await page.locator('#executiveBrief').getAttribute('aria-busy'), 'false');
        assert.equal(await page.locator('#ebAvailability').textContent(), 'Unavailable');
      }
      if (!scenario.failure) {
        assert.match(revenue, /Not available\s+Approved Price/i);
        assert.match(revenue, /Cash Received/);
        assert.doesNotMatch(revenue, /Total Revenue|Weighted Forecast|\$0/);
        assert.doesNotMatch(full, /Confidence:\s*85%|Projected revenue|stage probabilities/);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(outsideRequests, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await auditRenderedPage(page, { mainSelector: '#mainContent', layout: viewport });
      await page.locator('#ebRevenue').screenshot({ path: path.join(output,
        `${scenario.name}-${viewport.name}-revenue-status.png`) });
      await page.screenshot({ path: path.join(output,
        `${scenario.name}-${viewport.name}-full.png`), fullPage: true });
      await exerciseSkipLink(page, { mainSelector: '#mainContent' });
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
