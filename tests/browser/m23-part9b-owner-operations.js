'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { overview, record } = require('../helpers/m23-part9b-overview-fixture');

process.chdir(path.resolve(__dirname, '../..'));
process.env.NODE_ENV = 'test';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'POLARIS_OPENAI_ENABLED',
  'RETELL_API_KEY', 'STRIPE_SECRET_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RESEND_API_KEY',
  'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) delete process.env[key];

async function main() {
  const selected = (process.argv.find(arg => arg.startsWith('--browser=')) || '--browser=chrome').slice(10);
  const outputArgument = process.argv.find(arg => arg.startsWith('--output='));
  assert.ok(outputArgument, 'provide a non-overwriting evidence output directory');
  const output = path.resolve(outputArgument.slice(9));
  assert.ok(!fs.existsSync(output), 'evidence directory must be new');
  fs.mkdirSync(output, { recursive: true });
  const ledger = { browser: selected, version: null, cases: [], pageErrors: [], externalBlocked: [],
    providerCalls: 0, productionCalls: 0, requests: [], nonReadIntercepts: [], presentationFixtureAuthority: 'synthetic intercepted read responses',
    zoomEvidence: 'reflow-equivalent viewports; not native browser zoom or physical devices' };
  const { app } = require('../../src/server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    const runtime = resolveBrowserRuntime(selected);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    ledger.version = browser.version();
    const profiles = [
      { name: '1440', width: 1440, height: 1000 },
      { name: '390', width: 390, height: 844, hasTouch: true },
      { name: '320', width: 320, height: 700, hasTouch: true },
      { name: 'reflow-200', width: 720, height: 500 },
      { name: 'reflow-400', width: 360, height: 250 },
    ];
    for (const scope of ['owner_admin', 'dispatcher_coordination']) {
      for (const theme of ['light', 'dark']) {
        for (const profile of profiles) {
          const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height },
            hasTouch: Boolean(profile.hasTouch), reducedMotion: 'reduce' });
          await context.addInitScript(value => localStorage.setItem('northstar-theme', value), theme);
          const page = await context.newPage();
          const label = `${scope}-${theme}-${profile.name}`;
          let mode = 'normal';
          page.on('pageerror', error => ledger.pageErrors.push({ label, message: error.message }));
          await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) { ledger.externalBlocked.push(url.origin); return route.abort(); }
            if (route.request().method() !== 'GET') {
              ledger.nonReadIntercepts.push({ path: url.pathname, method: route.request().method() });
              return route.fulfill({ status: 204 });
            }
            if (url.pathname !== '/api/v1/operational-overview') return route.continue();
            ledger.requests.push({ label, method: route.request().method(), query: url.search });
            assert.strictEqual(route.request().method(), 'GET');
            if (mode === 'restricted') return route.fulfill({ status: 403, json: { success: false, code: 'OPERATIONAL_OVERVIEW_RESTRICTED' } });
            if (mode === 'stale') return route.fulfill({ status: 409, json: { success: false, code: 'OPERATIONAL_OVERVIEW_CHANGED' } });
            if (mode === 'unavailable') return route.fulfill({ status: 503, json: { success: false, code: 'OPERATIONAL_OVERVIEW_UNAVAILABLE' } });
            if (mode === 'offline') return route.abort();
            const state = url.searchParams.get('state') || 'active';
            const second = url.searchParams.has('cursor');
            const data = overview(scope, { filter: state });
            if (mode === 'empty') { data.records = []; data.pagination = { limit: 25, offset: 0, returned: 0, total: 0, nextCursor: null }; }
            else if (mode === 'literal') data.records[0].title = '<strong>Literal service label</strong> '.repeat(8);
            else if (second) {
              data.records = [record(scope, { executionId: 'e1900000-0000-4000-8000-000000000002', title: 'Boiler inspection' })];
              data.pagination = { limit: 25, offset: 1, returned: 1, total: 2, nextCursor: null };
            } else data.pagination = { limit: 25, offset: 0, returned: 1, total: 2, nextCursor: 'c2Vjb25kLXBhZ2U' };
            if (state === 'completion_pending' || state === 'completed') {
              data.records.forEach(item => { item.lifecycleState = state; });
            }
            return route.fulfill({ status: 200, json: { success: true, data } });
          });
          const navigation = await page.goto(`${origin}/dashboard/operations`, { waitUntil: 'networkidle' });
          assert.strictEqual(navigation.status(), 200, 'mounted operations page must exist');
          await page.locator('[data-execution-id]').first().waitFor();
          assert.match(await page.locator('#operationsScope').innerText(), scope === 'owner_admin' ? /Owner and admin/ : /Dispatcher/);
          assert.strictEqual(await page.locator('[data-owner-details]').count(), scope === 'owner_admin' ? 1 : 0);
          assert.match(await page.locator('#operationsCapacity').innerText(), /Unknown|not assessed/i);
          assert.match(await page.locator('[data-evidence-state]').innerText(), /Not evaluated/i);
          assert.strictEqual(await page.locator('#operationsStatus').getAttribute('role'), 'status');
          assert.strictEqual(await page.locator('#operationsStatus').getAttribute('aria-live'), 'polite');
          await page.locator('#operationsFilter').focus();
          assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'operationsFilter');
          await page.keyboard.press('Tab');
          assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'operationsRefresh');
          assert.strictEqual(await page.locator('#operationsRefresh').evaluate(button => getComputedStyle(button).outlineStyle), 'solid');
          await page.keyboard.press('Shift+Tab');
          assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'operationsFilter');
          for (const id of ['operationsFilter', 'operationsRefresh', 'operationsPrevious', 'operationsNext']) {
            assert.ok((await page.locator(`#${id}`).boundingBox()).height >= 44, `${id} touch target`);
          }
          await page.locator('#operationsFilter').selectOption('completion_pending');
          await page.waitForFunction(() => document.querySelector('#operationsStatus').dataset.state === 'success');
          await page.locator('#operationsNext').click();
          await page.getByRole('heading', { name: 'Boiler inspection' }).waitFor();
          assert.strictEqual(await page.locator('[data-execution-id]').count(), 1);
          assert.strictEqual(await page.locator('#operationsNext').isDisabled(), true);
          await page.locator('#operationsPrevious').click();
          await page.getByRole('heading', { name: 'Kitchen sink repair' }).waitFor();
          if (scope === 'owner_admin') {
            const details = page.locator('[data-owner-details]');
            await details.locator('summary').focus();
            await page.keyboard.press('Enter');
            assert.strictEqual(await details.getAttribute('open'), '');
            assert.match(await details.innerText(), /1 of 2 ea/);
          }
          const layout = await page.evaluate(() => ({ width: innerWidth,
            root: document.documentElement.scrollWidth, body: document.body.scrollWidth,
            theme: document.documentElement.getAttribute('data-theme') }));
          assert.ok(layout.root <= layout.width + 1 && layout.body <= layout.width + 1, `no overflow: ${JSON.stringify(layout)}`);
          assert.strictEqual(layout.theme, theme);
          await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: true });
          ledger.cases.push({ name: label, pass: true, layout });
          if (profile.name === '1440' && theme === 'light') {
            await page.getByRole('button', { name: 'Switch to dark theme' }).click();
            await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
            await page.getByRole('button', { name: 'Switch to light theme' }).click();
            await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
            ledger.cases.push({ name: `${label}-theme-control-interaction`, pass: true });
            for (const [nextMode, expected] of [['empty', 'empty'], ['restricted', 'restricted'],
              ['stale', 'stale'], ['unavailable', 'retry'], ['offline', 'offline']]) {
              mode = nextMode;
              await page.locator('#operationsRefresh').click();
              await page.waitForFunction(state => document.querySelector('#operationsStatus').dataset.state === state, expected);
              assert.strictEqual(await page.locator('[data-execution-id]').count(), 0, 'old data must clear on failed authority/read');
              assert.strictEqual(await page.locator('[data-owner-details]').count(), 0);
              ledger.cases.push({ name: `${label}-${nextMode}`, pass: true });
            }
            mode = 'literal';
            await page.locator('#operationsRefresh').click();
            await page.locator('[data-execution-id]').first().waitFor();
            assert.match(await page.locator('[data-execution-id] h2').innerText(), /<strong>Literal service label<\/strong>/);
            assert.strictEqual(await page.locator('[data-execution-id] h2 strong').count(), 0);
            ledger.cases.push({ name: `${label}-literal-markup-is-text`, pass: true, class: 'benign literal text control' });
            await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
            assert.strictEqual(await page.locator('[data-execution-id]').count(), 0);
            assert.strictEqual(await page.locator('#operationsStatus').getAttribute('data-state'), 'suspended');
            mode = 'normal';
            await page.reload({ waitUntil: 'networkidle' });
            await page.getByRole('heading', { name: 'Kitchen sink repair' }).waitFor();
            ledger.cases.push({ name: `${label}-pagehide-clears-reload-revalidates`, pass: true });
          }
          await context.close();
        }
      }
    }
    assert.strictEqual(ledger.pageErrors.length, 0);
    assert.strictEqual(ledger.externalBlocked.length, 0);
    ledger.pass = true;
  } catch (error) {
    ledger.pass = false;
    ledger.failure = { name: error.name, message: error.message };
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(ledger, null, 2));
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 1; });
