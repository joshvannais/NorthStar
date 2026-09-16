'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-part9-learning-center-browser-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];

const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const engine = process.argv[2];
const output = path.resolve(process.argv[3]);
const ledger = { engine, cases: [], pageErrors: [], requests: [], pass: false };
let browser;
let server;
let fixture;

(async () => {
  try {
    fixture = await createDatabaseFixture();
    server = fixture.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    ledger.browserVersion = browser.version();
    const viewport = engine === 'chrome' ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('northstar-theme', 'dark'));
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      ledger.requests.push({ method: request.method(), path: url.pathname });
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => ledger.pageErrors.push(error.message));

    await page.goto(`${origin}/demo/learning-center`, { waitUntil: 'networkidle' });
    await page.locator('#learningStatus').filter({ hasText: 'Showing isolated demo records' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/demo/learning-center');
    assert.equal(await page.locator('.learning-source-card').count(), 2);
    assert.equal(await page.locator('.learning-source-card[aria-pressed="true"] .learning-source-kind').innerText(), 'LABOR · TIME');
    assert.equal(await page.locator('#learningSourceKind').isDisabled(), true);
    assert.equal(await page.locator('#learningSourceKey').isDisabled(), true);
    assert.equal(await page.locator('#learningSourceAdd').isDisabled(), true);
    ledger.cases.push('The isolated demo opens at the top with explicit read-only labor and travel source choices.');

    await page.getByRole('button', { name: /Fleet Demo, Travel source/i }).click();
    await page.locator('#learningDetailTitle').filter({ hasText: 'Fleet Demo · Travel' }).waitFor();
    assert.equal(await page.locator('#calibrationTitle').innerText(), 'Travel planning calibration');
    const calibrationText = await page.locator('#learningCalibration').innerText();
    for (const phrase of ['Route duration', 'Driving distance', 'Fuel or energy quantity', 'Fuel cost', '1.0800×']) assert.match(calibrationText, new RegExp(phrase.replace('×', '\\xD7'), 'i'));
    assert.equal(await page.locator('#learningMain').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('.learning-table caption').innerText(), 'Imported reference review for Fleet Demo');
    assert.equal(await page.locator('.learning-table select:not([disabled])').count(), 0);
    ledger.cases.push('Travel evidence, vehicle and job matching, and four independent calibration dimensions render without enabling demo mutations.');

    await page.locator('#learningRefresh').click();
    await page.locator('#learningStatus').filter({ hasText: 'Showing isolated demo records' }).waitFor();
    assert.equal(await page.locator('#learningMain').getAttribute('aria-busy'), 'false');
    const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, scrollY }));
    assert.ok(layout.scrollWidth <= layout.innerWidth, JSON.stringify(layout));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#learningStatus').filter({ hasText: 'Showing isolated demo records' }).waitFor();
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    ledger.cases.push('Refresh and reload recover to a ready state at the top without horizontal overflow at the tested viewport.');

    assert.equal(ledger.requests.filter(item => item.method === 'POST').length, 0);
    await context.close();

    const paidContext = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await paidContext.addInitScript(() => localStorage.setItem('northstar-theme', 'dark'));
    await paidContext.addCookies(Object.entries(fixture.actors.owner.session.cookies).map(([name, value]) => ({
      name, value, url: origin, sameSite: 'Lax', httpOnly: name !== 'northstar_csrf',
    })));
    await paidContext.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      ledger.requests.push({ method: request.method(), path: url.pathname });
      return route.continue();
    });
    const paidPage = await paidContext.newPage();
    paidPage.setDefaultTimeout(20000);
    paidPage.on('pageerror', error => ledger.pageErrors.push(error.message));
    await paidPage.goto(`${origin}/dashboard/learning-center`, { waitUntil: 'networkidle' });
    await paidPage.locator('#learningStatus').filter({ hasText: 'No external source has been recorded' }).waitFor();
    await paidPage.locator('#learningSourceKind').selectOption('travel');
    await paidPage.locator('#learningSourceKey').fill('fleet.browser');
    const consentResponse = paidPage.waitForResponse(response => response.url().endsWith('/external-travel-sources/fleet.browser/consent') && response.request().method() === 'POST');
    await paidPage.locator('#learningSourceAdd').click();
    assert.equal((await consentResponse).status(), 201);
    await paidPage.waitForFunction(() => (document.querySelector('#learningDetailTitle').textContent === 'Fleet Browser · Travel' && document.querySelector('#learningStatus').textContent === 'Learning Center is current.') || document.querySelector('#learningStatus').dataset.tone === 'error');
    const paidReady = await paidPage.evaluate(() => ({
      title: document.querySelector('#learningDetailTitle').textContent,
      hidden: document.querySelector('#learningDetail').hidden,
      status: document.querySelector('#learningStatus').textContent,
    }));
    assert.deepEqual(paidReady, { title: 'Fleet Browser · Travel', hidden: false, status: 'Learning Center is current.' });
    assert.equal(await paidPage.locator('#learningDetailState').innerText(), 'Active');
    assert.match(await paidPage.locator('#learningOperations').innerText(), /Continuous sync/i);
    assert.equal(await paidPage.locator('#learningMain').getAttribute('aria-busy'), 'false');
    assert.equal(await paidPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    ledger.cases.push('The paid owner route creates and reads a real tenant-private travel source through the guarded consent and detail APIs.');
    await paidContext.close();

    assert.deepEqual(ledger.pageErrors, []);
    assert.deepEqual(ledger.requests.filter(item => item.method === 'POST').map(item => item.path), ['/api/v1/learning/external-travel-sources/fleet.browser/consent']);
    ledger.cases.push('The demo emitted no mutation, and the paid run emitted only its expected owner consent mutation.');
    ledger.pass = true;
  } catch (error) {
    ledger.error = error.stack;
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(output, JSON.stringify(ledger, null, 2));
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await fixture?.cleanup();
  }
})();
