'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

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
      { name: 'default', revision: 0, kind: 'system_default', status: 200,
        expected: 'Forecast planning is off' },
      { name: 'owner-off', revision: 1, kind: 'owner_reviewed', status: 200,
        expected: 'Forecast planning is off by saved workspace preference' },
      { name: 'restricted', revision: 0, kind: 'system_default', status: 403,
        expected: 'Access restricted' },
      { name: 'unavailable', revision: 0, kind: 'system_default', status: 503,
        expected: 'Forecast status unavailable' },
      { name: 'invalid', revision: 0, kind: 'system_default', status: 200,
        invalid: true, expected: 'Forecast status unavailable' },
    ]) for (const viewport of [
      { name: 'desktop', width: 1280, height: 800 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/js/auth-session.js') return route.fulfill({
          contentType: 'application/javascript', body: `window.showToast = function () {};
          window.forecastStatusCalls = 0;
          window.NorthStarAccountSession = {
            fetch: function (url) {
              if (url !== '/api/v1/forecast/settings') return Promise.reject(new Error('Other account settings unavailable in isolated view'));
              var status = ${scenario.status} === 503 && window.forecastStatusCalls++ > 0 ? 200 : ${scenario.status};
              return Promise.resolve({ status: status, ok: status === 200,
                json: function () { return Promise.resolve({ success: true, data: {
                  settings: { revision: ${scenario.revision}, digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', source: { kind: '${scenario.kind}' }, settings: { enabled: false } },
                  forecastIssued: ${scenario.invalid ? 'true' : 'false'}, sourceEligibilityVerified: false,
                } }); } });
            }
          };`,
        });
        if (url.pathname === '/js/nav-component.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.NavComponent = { init: function () {} };',
        });
        if (url.pathname === '/js/workspace-form-state.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.NorthStarFormState = { create: function () { return {}; } };',
        });
        if (url.pathname === '/js/api.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.showToast = function () {};',
        });
        if (url.pathname === '/js/forecast-settings-status.js') return route.continue();
        if (url.pathname.startsWith('/js/')) return route.fulfill({
          contentType: 'application/javascript', body: '',
        });
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
        return route.continue();
      });
      await page.goto(origin + '/dashboard/settings');
      await page.locator('#forecastSettingsStatus').getByText(scenario.expected,
        { exact: true }).waitFor();
      const panel = await page.locator('#forecast-settings').innerText();
      assert.match(panel, /A preference does not issue a forecast/);
      assert.doesNotMatch(panel, /[0-9]+%|forecast issued|source coverage verified|\$0/i);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('#forecast-settings').screenshot({ path: path.join(output,
        `${scenario.name}-${viewport.name}-settings.png`) });
      if (scenario.name === 'unavailable') {
        await page.getByRole('button', { name: 'Refresh forecast status' }).click();
        await page.locator('#forecastSettingsStatus').getByText('Forecast planning is off',
          { exact: true }).waitFor();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
