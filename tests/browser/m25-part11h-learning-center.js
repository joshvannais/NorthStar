'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm25-part11h-learning-center-browser-secret';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const engine = process.argv[2], output = path.resolve(process.argv[3]), captureRoot = path.resolve(process.argv[4]);
const layouts = [
  { name: 'phone-narrow-dark', width: 360, height: 800, theme: 'dark' },
  { name: 'phone-light', width: 390, height: 844, theme: 'light' },
  { name: 'tablet-portrait-dark', width: 768, height: 1024, theme: 'dark' },
  { name: 'tablet-landscape-light', width: 1024, height: 768, theme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' },
];
const forbidden = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\[object Object\]|\bM25_[A-Z0-9_]+|request\s+id\b/i;
const ledger = { engine, layouts: [], cases: [], pageErrors: [], externalRequests: [], pass: false };
let browser, server, fixture;
(async () => {
  try {
    fs.mkdirSync(captureRoot, { recursive: true });
    fixture = await createDatabaseFixture();
    server = fixture.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runtime = resolveBrowserRuntime(engine); browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath }); ledger.browserVersion = browser.version();
    for (const layout of layouts) {
      const context = await browser.newContext({ viewport: { width: layout.width, height: layout.height }, reducedMotion: 'reduce' });
      await context.addInitScript(theme => localStorage.setItem('northstar-theme', theme), layout.theme);
      await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin !== origin) { ledger.externalRequests.push(url.href); return route.abort(); } return route.continue(); });
      const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => ledger.pageErrors.push(`${layout.name}: ${error.message}`));
      await page.goto(`${origin}/demo/learning-center`, { waitUntil: 'networkidle' });
      await page.locator('#learningStatus').filter({ hasText: 'Showing isolated demo records' }).waitFor();
      await page.getByRole('button', { name: /Materials Demo, Material source/i }).click();
      await page.locator('#learningDetailTitle').filter({ hasText: 'Materials Demo · Material' }).waitFor();
      const body = await page.locator('body').innerText();
      for (const phrase of ['Materials Used', 'Quantity And Waste Comparisons', 'Cost And Purchasing Comparisons', 'What Polaris Has Learned About Materials', 'Total Material Use', 'Material Waste', 'Unavailable', 'Legal And Audit Hold']) assert.match(body, new RegExp(phrase, 'i'));
      assert.doesNotMatch(body, forbidden); assert.equal(await page.locator('#learningConsentCards button:not([disabled])').count(), 0);
      const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, busy: document.querySelector('#learningMain').getAttribute('aria-busy') }));
      assert.ok(geometry.scrollWidth <= geometry.width, JSON.stringify(geometry)); assert.equal(geometry.busy, 'false');
      const capture = path.join(captureRoot, `${engine}-${layout.name}.png`); await page.screenshot({ path: capture, fullPage: true }); ledger.layouts.push({ ...layout, capture, scrollWidth: geometry.scrollWidth });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.reload({ waitUntil: 'networkidle' }); await page.locator('#learningStatus').filter({ hasText: 'Showing isolated demo records' }).waitFor(); assert.equal(await page.evaluate(() => scrollY), 0);
      const errorPage = await context.newPage(); errorPage.on('pageerror', error => ledger.pageErrors.push(`${layout.name}-error: ${error.message}`));
      await errorPage.route('**/api/v1/learning/center', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'M25_PRIVATE_INTERNAL', message: 'private failure' }, requestId: '123e4567-e89b-42d3-a456-426614174000' }) }));
      await context.addCookies(Object.entries(fixture.actors.owner.session.cookies).map(([name,value]) => ({ name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf' })));
      await errorPage.goto(`${origin}/dashboard/learning-center`, { waitUntil: 'networkidle' }); await errorPage.locator('#learningStatus').filter({ hasText: 'Learning Center is temporarily unavailable. Refresh and try again.' }).waitFor(); assert.doesNotMatch(await errorPage.locator('body').innerText(), forbidden); await errorPage.close();
      await context.close();
    }
    ledger.cases.push('Five isolated demo layouts show material permissions, evidence, unavailable measures, lifecycle controls and planning suggestions without overflow or internal identifiers.');
    ledger.cases.push('Every required layout converts a structured server failure into one plain recovery message without exposing backend codes or request identifiers.');

    const paid = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await paid.addCookies(Object.entries(fixture.actors.owner.session.cookies).map(([name,value]) => ({ name,value,url:origin,sameSite:'Lax',httpOnly:name!=='northstar_csrf' })));
    const page = await paid.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => ledger.pageErrors.push(`paid: ${error.message}`));
    await page.goto(`${origin}/dashboard/learning-center`, { waitUntil: 'networkidle' }); await page.locator('#learningStatus').filter({ hasText: /Learning Center is (ready|current)/ }).waitFor();
    await page.locator('#learningSourceKind').selectOption('material'); await page.locator('#learningSourceKey').fill('materials.browser');
    const grant = page.waitForResponse(response => response.url().endsWith('/external-material-sources/materials.browser/consent') && response.request().method()==='POST'); await page.locator('#learningSourceAdd').click(); assert.equal((await grant).status(), 201);
    await page.locator('#learningDetailTitle').filter({ hasText: 'Materials Browser · Material' }).waitFor(); assert.equal(await page.locator('#learningConsentCards .learning-consent-card').count(), 4);
    const place = page.waitForResponse(response => response.url().endsWith('/external-material-sources/materials.browser/hold') && response.request().method()==='POST'); await page.getByRole('button',{name:'Place hold'}).click(); assert.equal((await place).status(),201);
    await page.getByText(/Cleanup is paused by the active legal hold/i).waitFor(); assert.equal(await page.getByRole('button',{name:'Process eligible records'}).isDisabled(),true);
    assert.doesNotMatch(await page.locator('body').innerText(), forbidden); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    ledger.cases.push('Paid owner flow creates a tenant-private material source, exposes four separate permissions, and blocks cleanup while a legal hold is active.');
    await paid.close(); assert.deepEqual(ledger.pageErrors, []); assert.deepEqual(ledger.externalRequests, []); ledger.pass = true;
  } catch (error) { ledger.error = error.stack; process.exitCode = 1; }
  finally { fs.writeFileSync(output, JSON.stringify(ledger,null,2)); await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await fixture?.cleanup(); }
})();
