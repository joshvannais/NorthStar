'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });

async function main() {
  const server = require('../../src/server').app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = resolveBrowserRuntime(process.argv.includes('--webkit') ? 'webkit' : 'chrome');
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  try {
    for (const scenario of ['saved', 'stale', 'ambiguous']) for (const viewport of [
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
          contentType: 'application/javascript', body: `
            window.showToast = function () {};
            window.forecastCalls = [];
            window.forecastRevision = 0;
            window.NorthStarAccountSession = { fetch: function (url, options) {
              if (url !== '/api/v1/forecast/settings') return Promise.reject(new Error('Other settings unavailable in isolated view'));
              var method = options && options.method || 'GET';
              window.forecastCalls.push({ method: method, key: options && options.headers && options.headers['Idempotency-Key'], body: options && options.body });
              var item = function () { return { revision: window.forecastRevision,
                digest: window.forecastRevision ? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' : 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                source: { kind: window.forecastRevision ? 'owner_reviewed' : 'system_default' },
                settings: { enabled: false } }; };
              if (method === 'GET') return Promise.resolve({ status: 200, ok: true,
                json: function () { return Promise.resolve({ success: true, data: {
                  settings: item(), forecastIssued: false, sourceEligibilityVerified: false } }); } });
              var request = JSON.parse(options.body);
              if (request.expectedRevision !== 0 || request.expectedDigest !== null ||
                  request.settings.enabled !== false || request.settings.actionPolicy !== 'review_required')
                return Promise.reject(new Error('Unexpected reviewed-off body'));
              if ('${scenario}' === 'stale') {
                window.forecastRevision = 1;
                return Promise.resolve({ status: 409, ok: false });
              }
              window.forecastRevision = 1;
              if ('${scenario}' === 'ambiguous') return Promise.reject(new Error('Lost response after commit'));
              return Promise.resolve({ status: 201, ok: true,
                json: function () { return Promise.resolve({ success: true, data: {
                  settings: item(), forecastIssued: false, sourceEligibilityVerified: false } }); } });
            } };`,
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
      await page.getByRole('button', { name: 'Keep forecasting off' }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Keep forecasting off' }).click();
      if (scenario === 'saved') {
        await page.locator('#forecastSettingsStatus').getByText(
          'Forecast planning is off by saved workspace preference', { exact: true }).waitFor();
      } else {
        await page.locator('#forecastSettingsStatus').getByText(
          scenario === 'stale' ? 'Preference changed' : 'Save result unconfirmed',
          { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Refresh forecast status' }).click();
        await page.locator('#forecastSettingsStatus').getByText(
          'Forecast planning is off by saved workspace preference', { exact: true }).waitFor();
      }
      assert.equal(await page.locator('#recordForecastsOff').isHidden(), true);
      const calls = await page.evaluate(() => window.forecastCalls);
      assert.equal(calls.filter(call => call.method === 'POST').length, 1);
      assert.match(calls.find(call => call.method === 'POST').key,
        /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('#forecast-settings').screenshot({ path: path.join(output,
        `${scenario}-${viewport.name}-review.png`) });
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
