'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-part14b-demo-learning-browser-secret-20260918';
for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];

const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const engine = process.argv[2], output = path.resolve(process.argv[3]), captureRoot = path.resolve(process.argv[4]);
const layouts = [
  { name: 'phone-narrow-dark', width: 360, height: 800, theme: 'dark' },
  { name: 'phone-light', width: 390, height: 844, theme: 'light' },
  { name: 'tablet-portrait-dark', width: 768, height: 1024, theme: 'dark' },
  { name: 'tablet-landscape-light', width: 1024, height: 768, theme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
];
const forbidden = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\[object Object\]|\bM25_[A-Z0-9_]+|request\s+id\b|\b(?:credentials?|token|schema|digest|revision|projection|authority|idempotency|internal state)\b/i;
const ledger = { engine, layouts: [], stateCaptures: [], pageErrors: [], outsideRequests: [], cases: [], pass: false };
let browser, server, fixture;

async function waitFirstUse(page) {
  await page.getByRole('button', { name: 'Allow this demo review' }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Allow this demo review' }).count(), 2);
}

async function completeJourney(page, layout) {
  await waitFirstUse(page);
  await page.getByRole('button', { name: 'Allow this demo review' }).first().click();
  await page.getByRole('button', { name: 'Allowed for this demo' }).waitFor();
  await page.locator('#jobOutcomePermissions button:not([disabled])').click();
  await page.getByText(/This is fictional demonstration data/).waitFor();
  const choices = page.locator('.learning-cohort-option input'); assert.equal(await choices.count(), 8);
  for (let index = 0; index < 5; index += 1) await choices.nth(index).check();
  await page.getByLabel(/I selected these completed jobs/).check();
  await page.getByRole('button', { name: 'Prepare suggestion' }).click();
  await page.getByRole('button', { name: 'Review planning impact' }).waitFor();
  const prepared = path.join(captureRoot, `${engine}-${layout.name}-prepared.png`); await page.screenshot({ path: prepared, fullPage: true }); ledger.stateCaptures.push(prepared);
  await page.getByRole('button', { name: 'Review planning impact' }).click();
  await page.getByRole('button', { name: 'Save reviewed suggestion' }).waitFor();
  const review = page.locator('#jobOutcomeReview');
  for (const phrase of ['5 of 5 jobs (100.00%)', 'Median', 'Lower quartile', 'Upper quartile', 'Interquartile range', 'Unavailable', 'not a forecast or promise']) assert.match(await review.innerText(), new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  await page.getByLabel(/I reviewed the evidence/).check();
  await page.getByRole('button', { name: 'Save reviewed suggestion' }).click();
  await page.getByRole('button', { name: 'Review for adoption' }).first().click();
  const reason = page.getByRole('textbox', { name: 'Reason for this decision' }); await reason.waitFor(); await reason.focus();
  assert.equal(await page.evaluate(() => document.activeElement.labels[0].textContent.trim()), 'Reason for this decision');
  await page.getByLabel(/I understand this changes/).check();
  await page.getByRole('button', { name: 'Adopt planning value' }).click();
  await page.getByText('Current multiplier: 1.08×').waitFor();
  const adopted = path.join(captureRoot, `${engine}-${layout.name}-adopted.png`); await page.screenshot({ path: adopted, fullPage: true }); ledger.stateCaptures.push(adopted);
  await page.getByRole('button', { name: 'Review rollback' }).click();
  await page.getByLabel(/I understand this removes/).check();
  await page.getByRole('button', { name: 'Remove planning value' }).click();
  await page.getByText('No completed-job suggestion has been adopted for this service.').waitFor();
  assert.doesNotMatch(await page.locator('body').innerText(), forbidden);
}

(async () => {
  try {
    fs.mkdirSync(captureRoot, { recursive: true }); fixture = await createDatabaseFixture();
    server = fixture.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
    const runtime = resolveBrowserRuntime(engine); browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath }); ledger.browserVersion = browser.version();
    for (const layout of layouts) {
      const context = await browser.newContext({ viewport: { width: layout.width, height: layout.height }, reducedMotion: 'reduce' });
      await context.addInitScript(theme => localStorage.setItem('northstar-theme', theme), layout.theme);
      await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin !== origin) { ledger.outsideRequests.push(url.href); return route.abort(); } return route.continue(); });
      const page = await context.newPage(); page.on('pageerror', error => ledger.pageErrors.push(`${layout.name}: ${error.message}`));
      await page.goto(`${origin}/demo/learning-center`, { waitUntil: 'networkidle' }); await page.getByRole('heading', { name: 'Learning Center' }).waitFor(); assert.equal(await page.evaluate(() => scrollY), 0);
      await completeJourney(page, layout);
      const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, clippedControls: [...document.querySelectorAll('#learningMain button,#learningMain input,#learningMain select,#learningMain textarea')].filter(node => node.offsetParent !== null).filter(node => { const rect = node.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth; }).map(node => node.id || node.name || node.textContent.trim()) })); assert.ok(geometry.scrollWidth <= geometry.width, JSON.stringify(geometry)); assert.deepEqual(geometry.clippedControls, [], JSON.stringify(geometry));
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await page.reload({ waitUntil: 'networkidle' }); assert.equal(await page.evaluate(() => scrollY), 0); await page.getByText('No completed-job suggestion has been adopted for this service.').waitFor();
      await page.getByRole('button', { name: 'Reset fictional journey' }).click(); await waitFirstUse(page); assert.equal(await page.locator('#jobOutcomeReview').getByText(/Current multiplier/).count(), 0);
      const reset = path.join(captureRoot, `${engine}-${layout.name}-reset.png`); await page.screenshot({ path: reset, fullPage: true }); ledger.layouts.push({ ...layout, reset });
      await context.close();
    }
    assert.deepEqual(ledger.pageErrors, []); assert.deepEqual(ledger.outsideRequests, []);
    ledger.cases.push('Each layout completed permission, cohort selection, evidence review, save, adoption, removal, reload and reset.');
    ledger.cases.push('Every browser context received a separate account-free demo session; no provider or outside request was made.');
    ledger.pass = true;
  } catch (error) { ledger.error = error.stack; process.exitCode = 1; }
  finally { fs.writeFileSync(output, JSON.stringify(ledger, null, 2)); await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await fixture?.cleanup(); }
})();
