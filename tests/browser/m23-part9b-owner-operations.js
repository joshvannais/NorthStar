'use strict';
const { observeUserWording } = require('../helpers/m23-user-wording');

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
  if (process.argv.includes('--database')) return durableMain();
  const selected = (process.argv.find(arg => arg.startsWith('--browser=')) || '--browser=chrome').slice(10);
  const profileArgument = process.argv.find(arg => arg.startsWith('--profile='));
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
  await observeUserWording(browser);
    ledger.version = browser.version();
    const profiles = [
      { name: '1440', width: 1440, height: 1000 },
      { name: '390', width: 390, height: 844, hasTouch: true },
      { name: '320', width: 320, height: 700, hasTouch: true },
      { name: 'reflow-200', width: 720, height: 500 },
      { name: 'reflow-400', width: 360, height: 250 },
    ].filter(profile => !profileArgument || profile.name === profileArgument.slice(10));
    assert.ok(profiles.length > 0, 'requested browser profile exists');
    ledger.profiles = profiles.map(profile => profile.name);
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
              data.records.forEach(item => {
                item.lifecycleState = state;
                if (state === 'completion_pending') {
                  item.approval.state = 'changed'; item.evidence.state = 'changed';
                  if (item.ownerDetails) item.ownerDetails.pendingProposal = {
                    id: 'f1900000-0000-4000-8000-000000000001', revision: 1, digest: 'd'.repeat(64),
                    decidedAt: '2026-09-08T11:50:00.000000Z', expiresAt: '2026-09-08T12:50:00.000000Z',
                  };
                }
              });
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

async function durableMain() {
  const selected = (process.argv.find(arg => arg.startsWith('--browser=')) || '--browser=chrome').slice(10);
  const outputArgument = process.argv.find(arg => arg.startsWith('--output='));
  assert.ok(outputArgument && process.env.M19_PG_ADMIN_URL, 'disposable PostgreSQL and new evidence output are required');
  const output = path.resolve(outputArgument.slice(9));
  assert.ok(!fs.existsSync(output), 'never overwrite database browser evidence');
  fs.mkdirSync(output, { recursive: true });
  const ledger = { browser: selected, authority: 'mounted production server, real synthetic sessions and PostgreSQL runtime role',
    cases: [], pageErrors: [], externalBlocked: [], nonReadRequests: [], requests: [], responses: [],
    providerCalls: 0, productionCalls: 0,
    zoomEvidence: 'reflow-equivalent viewports; not native browser zoom or physical devices' };
  let fixture, server, browser;
  const https = require('https');
  const originalRequest = https.request, originalGet = https.get, originalFetch = globalThis.fetch;
  const forbiddenProvider = () => { ledger.providerCalls += 1; throw new Error('External server transport is forbidden in this local browser fixture'); };
  https.request = forbiddenProvider; https.get = forbiddenProvider; globalThis.fetch = forbiddenProvider;
  try {
    fixture = await require('../helpers/m23-part9b-overview-fixture').createDatabaseFixture();
    let latest;
    for (let index = 1; index <= 26; index += 1) {
      latest = await fixture.createExecution({ title: index === 26 ? 'Owner <strong>sample</strong> work' : `Recorded work ${index}` });
    }
    await fixture.progress(latest);
    const ready = await fixture.createExecution({ title: 'Evidence ready for explicit review' });
    await fixture.completion(ready, 'propose_completion', { expiresAt: new Date(Date.now() + 600000).toISOString() });
    await fixture.createExecution({ actor: 'otherOwner', title: 'Other tenant work must stay separate' });
    server = fixture.app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runtime = resolveBrowserRuntime(selected);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
  await observeUserWording(browser);
    ledger.version = browser.version();
    const profileArgument = process.argv.find(arg => arg.startsWith('--profile='));
    const actorArgument = process.argv.find(arg => arg.startsWith('--actor='));
    const profiles = [{ name: '1440', width: 1440, height: 1000 },
      { name: '390', width: 390, height: 844, hasTouch: true }, { name: '320', width: 320, height: 700, hasTouch: true },
      { name: 'reflow-200', width: 720, height: 500 }, { name: 'reflow-400', width: 360, height: 250 }]
      .filter(profile => !profileArgument || profile.name === profileArgument.slice(10));
    const actorNames = ['owner', 'admin', 'dispatcher', 'member', 'viewer']
      .filter(name => !actorArgument || name === actorArgument.slice(8));
    assert.ok(profiles.length && actorNames.length, 'selected browser actors/profiles exist');
    ledger.profiles = profiles.map(profile => profile.name);
    for (const actorName of actorNames) {
      for (const theme of ['light', 'dark']) {
        for (const profile of profiles) {
          const label = `${actorName}-${theme}-${profile.name}`;
          const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height },
            hasTouch: Boolean(profile.hasTouch), reducedMotion: 'reduce' });
          await context.addInitScript(value => localStorage.setItem('northstar-theme', value), theme);
          await context.addCookies(Object.entries(fixture.actors[actorName].session.cookies).map(([name, value]) => ({
            name, value, url: origin, sameSite: 'Lax', httpOnly: true,
          })));
          const page = await context.newPage();
          page.on('pageerror', error => ledger.pageErrors.push({ label, message: error.message }));
          page.on('response', response => ledger.responses.push({ label, path: new URL(response.url()).pathname, status: response.status() }));
          await page.route('**/*', async route => {
            const req = route.request(), url = new URL(req.url());
            if (url.origin !== origin) { ledger.externalBlocked.push({ label, origin: url.origin }); return route.abort(); }
            if (req.method() !== 'GET') { ledger.nonReadRequests.push({ label, path: url.pathname, method: req.method() }); return route.abort(); }
            ledger.requests.push({ label, path: url.pathname, method: req.method() });
            return route.continue(); // no overview/status/authority response is faked
          });
          const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/operational-overview');
          const navigation = await page.goto(`${origin}/dashboard/operations`, { waitUntil: 'domcontentloaded' });
          assert.strictEqual(navigation.status(), 200);
          const response = await responsePromise;
          // A denied fetch intentionally has no response-body consumer in the
          // page. Use HTTP status and actual rendered state as the readiness
          // contract, rather than an unbounded protocol body-finished event.
          await page.waitForLoadState('load');
          const authorized = ['owner', 'admin', 'dispatcher'].includes(actorName);
          assert.strictEqual(response.status(), authorized ? 200 : 403);
          if (authorized) {
            const body = await response.json();
            await page.locator('[data-execution-id]').first().waitFor();
            assert.strictEqual(await page.locator('[data-execution-id]').count(), 25);
            assert.strictEqual(body.data.pagination.total, 27);
            assert.deepStrictEqual(await page.locator('[data-execution-id]').evaluateAll(nodes => nodes.map(node => node.dataset.executionId)),
              body.data.records.map(row => row.executionId));
            assert.strictEqual(await page.locator('[data-owner-details]').count(), actorName === 'dispatcher' ? 0 : 25);
            assert.match(await page.locator('#operationsScope').innerText(), actorName === 'dispatcher' ? /Dispatcher/ : /Owner and admin/);
            assert.match(await page.locator('#operationsCapacity').innerText(), /Unknown/i);
            assert.strictEqual(await page.getByRole('heading', { name: 'Owner <strong>sample</strong> work', exact: true }).count(), 1);
            assert.strictEqual(await page.locator('[data-execution-id] h2 strong').count(), 0);
            assert.strictEqual(await page.getByText('Other tenant work must stay separate', { exact: true }).count(), 0);
            if (actorName !== 'dispatcher') {
              const details = page.locator(`[data-execution-id="${latest.execution.id}"] [data-owner-details]`);
              await details.locator('summary').focus(); await page.keyboard.press('Enter');
              assert.strictEqual(await details.getAttribute('open'), '');
              assert.match(await details.innerText(), /2\.5 of 10 m2/);
            }
            if (profile.name === '1440' && theme === 'light') {
              const nextResponse = page.waitForResponse(res => new URL(res.url()).pathname === '/api/v1/operational-overview');
              await page.locator('#operationsNext').click(); assert.strictEqual((await nextResponse).status(), 200);
              await page.waitForFunction(() => document.querySelectorAll('[data-execution-id]').length === 2);
              assert.strictEqual(await page.locator('#operationsNext').isDisabled(), true);
              const previousResponse = page.waitForResponse(res => new URL(res.url()).pathname === '/api/v1/operational-overview');
              await page.locator('#operationsPrevious').click();
              const previousBody = await (await previousResponse).json();
              assert.strictEqual(previousBody.data.dataDigest, body.data.dataDigest);
              assert.notStrictEqual(previousBody.data.evaluatedAt, body.data.evaluatedAt, 'first page is freshly evaluated');
              await page.waitForFunction(() => document.querySelectorAll('[data-execution-id]').length === 25);
              await page.locator('#operationsFilter').selectOption('completion_pending');
              await page.waitForFunction(() => document.querySelectorAll('[data-execution-id]').length === 1);
              assert.match(await page.locator('[data-evidence-state]').innerText(), /Ready for review/);
              await page.locator('#operationsFilter').selectOption('completed');
              await page.waitForFunction(() => document.querySelector('#operationsStatus').dataset.state === 'empty');
              assert.strictEqual(await page.locator('[data-execution-id]').count(), 0);
              await page.locator('#operationsFilter').selectOption('active');
              await page.locator('[data-execution-id]').first().waitFor();
              await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
              assert.strictEqual(await page.locator('[data-execution-id]').count(), 0);
              await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-execution-id]').first().waitFor();
              ledger.cases.push({ name: `${label}-durable-pagination-filters-lifecycle-reload`, pass: true });
            }
          } else {
            await page.waitForFunction(() => document.querySelector('#operationsStatus').dataset.state === 'restricted');
            assert.strictEqual(await page.locator('[data-execution-id]').count(), 0);
            assert.strictEqual(await page.locator('[data-owner-details]').count(), 0);
          }
          assert.strictEqual(await page.locator('#operationsStatus').getAttribute('role'), 'status');
          assert.strictEqual(await page.locator('#operationsStatus').getAttribute('aria-live'), 'polite');
          assert.strictEqual(await page.locator('#operationsRecords').getAttribute('aria-busy'), 'false');
          await page.locator('#operationsFilter').focus(); await page.keyboard.press('Tab');
          assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'operationsRefresh');
          assert.strictEqual(await page.locator('#operationsRefresh').evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
          for (const id of ['operationsFilter', 'operationsRefresh', 'operationsPrevious', 'operationsNext']) {
            assert.ok((await page.locator('#' + id).boundingBox()).height >= 44, id + ' touch target');
          }
          const layout = await page.evaluate(() => ({ width: innerWidth, root: document.documentElement.scrollWidth,
            body: document.body.scrollWidth, theme: document.documentElement.getAttribute('data-theme') }));
          assert.ok(layout.root <= layout.width + 1 && layout.body <= layout.width + 1, 'no horizontal overflow');
          assert.strictEqual(layout.theme, theme);
          await page.screenshot({ path: path.join(output, label + '.png'), fullPage: true });
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForFunction(() => window.scrollY === 0);
          await page.screenshot({ path: path.join(output, label + '-viewport.png'), fullPage: false });
          ledger.cases.push({ name: label, pass: true, status: response.status(), layout });
          await context.close();
        }
      }
    }
    assert.strictEqual(ledger.pageErrors.length, 0); assert.strictEqual(ledger.externalBlocked.length, 0);
    assert.strictEqual(ledger.nonReadRequests.length, 0); assert.strictEqual(ledger.providerCalls, 0); ledger.pass = true;
  } catch (error) { ledger.pass = false; ledger.failure = { name: error.name, message: error.message }; throw error; }
  finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (fixture) await fixture.cleanup();
    https.request = originalRequest; https.get = originalGet; globalThis.fetch = originalFetch;
    ledger.cleanup = 'owned browser/server/database/roles closed';
    fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(ledger, null, 2));
  }
}

main().catch(error => { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 1; });
