'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm26-part11a-demo-browser-isolated-secret-20260923';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY',
  'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];

const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });

async function main() {
  const fixture = await require('../helpers/m23-part9b-overview-fixture').createDatabaseFixture();
  const server = fixture.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = resolveBrowserRuntime(process.argv.includes('--webkit') ? 'webkit' : 'chrome');
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  try {
    for (const viewport of [
      { name: 'desktop', width: 1280, height: 800 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push({ path: new URL(request.url()).pathname,
        method: request.method() }));
      await page.goto(origin + '/demo/settings');
      await page.locator('#forecastSettingsStatus').getByText('Off in this sample workspace', { exact: true })
        .waitFor({ timeout: 10000 }).catch(async () => {
          throw new Error('Demo settings did not render: ' + page.url() + ' ' +
            (await page.locator('body').innerText()).slice(0, 500) +
            ' | script errors: ' + errors.join('; '));
        });
      const content = await page.locator('#forecast-settings').innerText();
      assert.match(content, /This is a fictional preview/);
      assert.match(content, /no forecast has been issued/i);
      assert.doesNotMatch(content, /live price|forecast issued|[0-9]+% confidence/i);
      assert.equal(requests.some(item => item.path.startsWith('/api/v1/forecast/')), false);
      assert.equal(requests.some(item => item.method === 'POST'), false);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('#forecast-settings').screenshot({ path: path.join(output,
        `${viewport.name}-demo-settings.png`) });
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    await fixture.cleanup();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
