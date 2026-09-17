'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-part10h-learning-center-browser-secret';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];

const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { seedLearningLabels } = require('../helpers/m25-learning-label-fixture');
const engine = process.argv[2];
const output = path.resolve(process.argv[3]);
const captureRoot = path.resolve(process.argv[4]);
const layouts = [
  { name: 'phone-narrow-dark', width: 360, height: 800, theme: 'dark' },
  { name: 'phone-light', width: 390, height: 844, theme: 'light' },
  { name: 'tablet-portrait-dark', width: 768, height: 1024, theme: 'dark' },
  { name: 'tablet-landscape-light', width: 1024, height: 768, theme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
];
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const INTERNAL_CODE_PATTERN = /\b(?:M25|INTERNAL|REQUEST)_[A-Z0-9_]+\b/;
function assertSafeVisible(value) {
  assert.doesNotMatch(value, UUID_PATTERN);
  assert.doesNotMatch(value, /\[object Object\]/i);
  assert.doesNotMatch(value, /request\s+(?:id\b|[0-9a-f]{8}-)/i);
  assert.doesNotMatch(value, INTERNAL_CODE_PATTERN);
}
const presented = value => value.replace(/[._-]+/g, ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase());
const ledger = { engine, layouts: [], cases: [], pageErrors: [], externalRequests: [], pass: false };
let browser;
let server;
let fixture;
let paidLabels;

(async () => {
  try {
    fs.mkdirSync(captureRoot, { recursive: true });
    fixture = await createDatabaseFixture();
    paidLabels = await seedLearningLabels(fixture);
    server = fixture.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    ledger.browserVersion = browser.version();

    for (const layout of layouts) {
      const context = await browser.newContext({ viewport: { width: layout.width, height: layout.height }, reducedMotion: 'reduce' });
      await context.addInitScript(theme => localStorage.setItem('northstar-theme', theme), layout.theme);
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { ledger.externalRequests.push(url.href); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => ledger.pageErrors.push(`${layout.name}: ${error.message}`));
      await page.goto(`${origin}/demo/learning-center`, { waitUntil: 'networkidle' });
      await page.locator('#learningStatus').filter({ hasText: 'Showing isolated demo records' }).waitFor();
      await page.getByRole('button', { name: /Equipment Demo, Asset source/i }).click();
      await page.locator('#learningDetailTitle').filter({ hasText: 'Equipment Demo · Asset' }).waitFor();
      assert.equal(await page.locator('#assetHealthPanel').isVisible(), true);
      for (const phrase of ['Maintenance', 'Downtime', 'Condition', 'Availability', 'Not established']) assert.match(await page.locator('#learningAssetHealth').innerText(), new RegExp(phrase, 'i'));
      for (const phrase of ['Machine-hour use', 'Job operating cost', '1.1200×', '1.0700×']) assert.match(await page.locator('#learningCalibration').innerText(), new RegExp(phrase.replace('×', '\xD7'), 'i'));
      const optionLabels = await page.locator('.learning-table select option').allInnerTexts();
      for (const label of ['Tree Service Job', 'Chip Truck 2 · Ford F 550', 'Tracked Chipper 1 · Bandit 21XP']) assert.ok(optionLabels.includes(label), JSON.stringify(optionLabels));
      optionLabels.forEach(assertSafeVisible);
      assert.equal(await page.locator('.learning-table select:not([disabled])').count(), 0);
      assert.equal(await page.locator('#learningConsentCards button:not([disabled])').count(), 0);
      const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, busy: document.querySelector('#learningMain').getAttribute('aria-busy'), scrollY }));
      assert.ok(geometry.scrollWidth <= geometry.width, JSON.stringify(geometry));
      assert.equal(geometry.busy, 'false');
      const capture = path.join(captureRoot, `${engine}-${layout.name}.png`);
      await page.screenshot({ path: capture, fullPage: true });
      ledger.layouts.push({ ...layout, capture, scrollWidth: geometry.scrollWidth });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#learningStatus').filter({ hasText: 'Showing isolated demo records' }).waitFor();
      assert.equal(await page.evaluate(() => window.scrollY), 0);

      await context.addCookies(Object.entries(fixture.actors.owner.session.cookies).map(([name, value]) => ({
        name, value, url: origin, sameSite: 'Lax', httpOnly: name !== 'northstar_csrf',
      })));
      const paidLayoutPage = await context.newPage();
      paidLayoutPage.on('pageerror', error => ledger.pageErrors.push(`${layout.name}-paid: ${error.message}`));
      await paidLayoutPage.goto(`${origin}/dashboard/learning-center`, { waitUntil: 'networkidle' });
      await paidLayoutPage.locator('#learningStatus').filter({ hasText: /Learning Center is (ready|current)/ }).waitFor();
      await paidLayoutPage.getByRole('button', { name: /Crewclock Labels, Labor source/i }).click();
      await paidLayoutPage.locator('#learningDetailTitle').filter({ hasText: /Crewclock Labels · Labor/i }).waitFor();
      let options = await paidLayoutPage.locator('.learning-table select option').evaluateAll(nodes => nodes.map(option => ({ label: option.textContent, value: option.value })));
      const laborExpected = [...paidLabels.labels.workers, ...paidLabels.labels.jobs].map(presented);
      for (const label of laborExpected) assert.ok(options.some(option => option.label === label), JSON.stringify(options));
      const laborMapping = new Map(options.map(option => [option.label, option.value]));
      paidLabels.workers.forEach((target, index) => assert.equal(laborMapping.get(presented(paidLabels.labels.workers[index])), target));
      paidLabels.jobs.forEach((target, index) => assert.equal(laborMapping.get(presented(paidLabels.labels.jobs[index])), target));
      await paidLayoutPage.getByRole('button', { name: /Fleet Labels, Asset source/i }).click();
      await paidLayoutPage.locator('#learningDetailTitle').filter({ hasText: /Fleet Labels · Asset/i }).waitFor();
      options = await paidLayoutPage.locator('.learning-table select option').evaluateAll(nodes => nodes.map(option => ({ label: option.textContent, value: option.value })));
      const assetExpected = [...paidLabels.labels.jobs, ...paidLabels.labels.vehicles, ...paidLabels.labels.equipment].map(presented);
      for (const label of assetExpected) assert.ok(options.some(option => option.label === label), JSON.stringify(options));
      const assetMapping = new Map(options.map(option => [option.label, option.value]));
      paidLabels.vehicles.forEach((target, index) => assert.equal(assetMapping.get(presented(paidLabels.labels.vehicles[index])), target));
      paidLabels.equipment.forEach((target, index) => assert.equal(assetMapping.get(presented(paidLabels.labels.equipment[index])), target));
      assertSafeVisible(await paidLayoutPage.locator('body').innerText());
      const paidCapture = path.join(captureRoot, `${engine}-${layout.name}-paid.png`);
      await paidLayoutPage.screenshot({ path: paidCapture, fullPage: true });
      ledger.layouts[ledger.layouts.length - 1].paidCapture = paidCapture;
      await paidLayoutPage.close();

      const errorPage = await context.newPage();
      errorPage.on('pageerror', error => ledger.pageErrors.push(`${layout.name}-error: ${error.message}`));
      await errorPage.route('**/api/v1/learning/center', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({
        error: { message: 'private failure 123e4567-e89b-42d3-a456-426614174000', code: 'M25_PRIVATE_INTERNAL' },
        code: 'M25_PRIVATE_INTERNAL', requestId: '123e4567-e89b-42d3-a456-426614174000',
      }) }));
      await errorPage.goto(`${origin}/dashboard/learning-center`, { waitUntil: 'networkidle' });
      await errorPage.locator('#learningStatus').filter({ hasText: 'Learning Center is temporarily unavailable. Refresh and try again.' }).waitFor();
      assertSafeVisible(await errorPage.locator('body').innerText());
      await errorPage.close();
      await context.close();
    }
    ledger.cases.push('Five responsive dark and light demo layouts render company-facing job, vehicle and equipment labels without identifiers or horizontal overflow.');
    ledger.cases.push('Five paid layouts render unique worker, job, vehicle and equipment labels and preserve each intended opaque selection value without displaying it.');
    ledger.cases.push('Every required layout normalizes a structured API failure without rendering backend codes, request identifiers, UUIDs or object serialization text.');

    const paidContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await paidContext.addInitScript(() => localStorage.setItem('northstar-theme', 'dark'));
    await paidContext.addCookies(Object.entries(fixture.actors.owner.session.cookies).map(([name, value]) => ({
      name, value, url: origin, sameSite: 'Lax', httpOnly: name !== 'northstar_csrf',
    })));
    const paidPage = await paidContext.newPage();
    paidPage.setDefaultTimeout(20000);
    paidPage.on('pageerror', error => ledger.pageErrors.push(`paid: ${error.message}`));
    await paidPage.goto(`${origin}/dashboard/learning-center`, { waitUntil: 'networkidle' });
    await paidPage.locator('#learningStatus').filter({ hasText: /Learning Center is (ready|current)/ }).waitFor();
    await paidPage.locator('#learningSourceKind').selectOption('asset');
    await paidPage.locator('#learningSourceKey').fill('fleet.browser');
    const grantResponse = paidPage.waitForResponse(response => response.url().endsWith('/external-asset-sources/fleet.browser/consent') && response.request().method() === 'POST');
    await paidPage.locator('#learningSourceAdd').click();
    assert.equal((await grantResponse).status(), 201);
    await paidPage.locator('#learningDetailTitle').filter({ hasText: 'Fleet Browser · Asset' }).waitFor();
    await paidPage.locator('#learningStatus').filter({ hasText: 'Learning Center is current' }).waitFor();
    assert.equal(await paidPage.locator('#learningConsentCards .learning-consent-card').count(), 4);
    assert.equal(await paidPage.locator('#assetHealthPanel').isVisible(), true);
    assert.match(await paidPage.locator('#learningAssetHealth').innerText(), /Review and link a vehicle or equipment reference/i);
    assert.equal(await paidPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    ledger.cases.push('The paid owner route creates and reads a distinct tenant-private vehicle and equipment source through guarded APIs.');

    const operations = await paidContext.request.get(`${origin}/api/v1/learning/external-asset-sources/fleet.browser/operations`);
    assert.equal(operations.status(), 200); const currentOperations = (await operations.json()).data;
    const deletionResponse = await paidContext.request.post(`${origin}/api/v1/learning/external-asset-sources/fleet.browser/deletion`, {
      headers: { 'X-CSRF-Token': fixture.actors.owner.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
      data: { action: 'request', expectedRevision: 0, expectedDigest: 'none', confirmed: true },
    });
    assert.equal(deletionResponse.status(), 201, JSON.stringify(await deletionResponse.json()));
    assert.equal(currentOperations.deletion, null);
    await paidPage.reload({ waitUntil: 'networkidle' });
    await paidPage.locator('#learningStatus').filter({ hasText: 'Learning Center is current' }).waitFor();
    const blockedGrant = paidPage.getByRole('button', { name: 'Cancel deletion first' });
    assert.equal(await blockedGrant.isDisabled(), true);
    const cancelResponse = paidPage.waitForResponse(response => response.url().endsWith('/external-asset-sources/fleet.browser/deletion') && response.request().method() === 'POST');
    await paidPage.getByRole('button', { name: 'Cancel request' }).click();
    assert.equal((await cancelResponse).status(), 201);
    const sourceAllow = paidPage.locator('#learningConsentCards .learning-consent-card').first().getByRole('button', { name: 'Allow', exact: true });
    await sourceAllow.waitFor();
    const regrantResponse = paidPage.waitForResponse(response => response.url().endsWith('/external-asset-sources/fleet.browser/consent') && response.request().method() === 'POST');
    await sourceAllow.click();
    assert.equal((await regrantResponse).status(), 201);
    await paidPage.locator('#learningStatus').filter({ hasText: 'Learning Center is current' }).waitFor();
    ledger.cases.push('An active deletion blocks source permission until explicit cancellation and a separate new consent period.');

    assert.equal(await paidPage.locator('#learningMain').getAttribute('aria-busy'), 'false');
    assert.deepEqual(ledger.pageErrors, []);
    assert.deepEqual(ledger.externalRequests, []);
    await paidContext.close();
    ledger.cases.push('Loaded states are keyboard-labeled, request-contained, error-free and recover to the top after reload.');
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
