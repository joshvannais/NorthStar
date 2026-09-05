'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.chdir(path.resolve(__dirname, '../..'));
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
for (const key of ['OPENAI_API_KEY','POLARIS_OPENAI_ENABLED','RETELL_API_KEY','RETELL_AGENT_ID','RETELL_PHONE_NUMBER','RETELL_WEBHOOK_SECRET','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) delete process.env[key];
process.env.NODE_ENV = 'test';
async function main() {
  const selected = (process.argv.find(value => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  const output = path.resolve(__dirname, '../../outputs/m23-part5-writer', selected); fs.mkdirSync(output, { recursive: true });
  const fixture = await require('../helpers/m23-equipment-browser-fixture').createFixture('m23p5-browser-' + selected);
  let server, browser;
  const ledger = { browser: selected, cases: [], externalBlocked: [], pageErrors: [], httpFailures: [], providerCalls: 0, physicalSafari: 'unavailable', founderVisualApproval: 'unavailable' };
  try {
    server = fixture.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runtime = resolveBrowserRuntime(selected); browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    ledger.version = browser.version();
    async function contextFor(width, theme, session = fixture.session, extra = {}) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', ...extra });
      await context.addInitScript(value => { try { localStorage.setItem('northstar-theme', value); } catch (_) {} window.__equipmentXss = 0; }, theme);
      await context.addCookies([{ name: 'northstar_access', value: session.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' }, { name: 'northstar_csrf', value: session.csrfToken, url: origin, sameSite: 'Lax' }]);
      await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin) return route.continue(); ledger.externalBlocked.push(url.origin); return route.fulfill({ status: 204, body: '' }); });
      context.on('page', page => page.on('pageerror', error => ledger.pageErrors.push(error.message)));
      context.on('response', response => { if (response.status() >= 400) ledger.httpFailures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
      return context;
    }
    async function catalogue(page) {
      await page.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.dataset.assetCatalogueState === 'ready');
      await page.locator('[data-section="vehicles"]').click();
      await page.locator('#section-vehicles.active').waitFor();
    }
    async function create(page, entry, marker) {
      const before = (await fixture.ownerPool.query('SELECT count(*)::int AS n FROM tenant_assets WHERE organization_id=$1', [fixture.org])).rows[0].n;
      if (entry === 'business_profile') { await catalogue(page); await page.getByRole('button', { name: 'Add equipment', exact: true }).click(); }
      else {
        await page.goto(origin + '/dashboard/polaris', { waitUntil: 'domcontentloaded' });
        const input = page.locator('#polarisPromptInput'); await input.waitFor();
        await page.waitForFunction(() => !document.getElementById('polarisPromptInput').disabled);
        await input.fill('Add an exact vehicle for hauling'); await input.press('Enter');
      }
      const dialog = page.getByRole('dialog', { name: 'Add equipment' }); await dialog.waitFor();
      await dialog.locator('textarea').fill('Add exact equipment for hauling ' + marker);
      await dialog.getByRole('button', { name: 'Prepare reviewed draft' }).click();
      const answers = [...Object.values(fixture.identity), 'none', 'owned'];
      for (const answer of answers) {
        const input = dialog.locator('input'); await input.waitFor(); await input.fill(answer);
        await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
      }
      await dialog.getByRole('button', { name: 'Confirm and save equipment' }).waitFor();
      assert.strictEqual((await fixture.ownerPool.query('SELECT count(*)::int AS n FROM tenant_assets WHERE organization_id=$1', [fixture.org])).rows[0].n, before, 'draft has no asset mutation');
      await dialog.getByRole('button', { name: 'Confirm and save equipment' }).click();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      assert.strictEqual((await fixture.ownerPool.query('SELECT count(*)::int AS n FROM tenant_assets WHERE organization_id=$1', [fixture.org])).rows[0].n, before + 1);
      ledger.cases.push({ entry, explicitConfirmation: true });
    }
    const ownerContext = await contextFor(1280, 'light'); const ownerPage = await ownerContext.newPage();
    await create(ownerPage, 'business_profile', 'profile path <img src=x onerror=window.__equipmentXss++>'); await create(ownerPage, 'polaris', 'conversation path'); await ownerContext.close();
    for (const theme of ['light','dark']) for (const width of [1280,768,390,320]) {
      const context = await contextFor(width, theme, fixture.session, { hasTouch: width <= 390 }); const page = await context.newPage(); await catalogue(page);
      const groups = page.locator('.equipment-group'); assert.strictEqual(await groups.count(), 1); assert.strictEqual(await groups.first().getAttribute('open'), null);
      const summary = groups.locator('summary').first(); assert.match(await summary.textContent(), /Trucks \(2\)/); await summary.focus(); await page.keyboard.press('Enter');
      await page.getByRole('searchbox', { name: 'Search vehicles and equipment' }).fill('missing'); assert.strictEqual(await groups.count(), 0);
      await page.getByRole('searchbox', { name: 'Search vehicles and equipment' }).fill('Exact 350'); await page.locator('.equipment-group > summary').click();
      const geometry = await page.evaluate(() => {
        const host = document.getElementById('assetCatalogueContainer'); const bounds = host.getBoundingClientRect();
        const bad = [...host.querySelectorAll('button,input,select,summary,dd,h4')].filter(element => {
          const r = element.getBoundingClientRect(); return r.width && r.height && (r.left < bounds.left - 1 || r.right > bounds.right + 1);
        }).map(element => element.tagName + ':' + element.className);
        return { viewport: innerWidth, width: document.documentElement.scrollWidth, hostWidth: host.scrollWidth, clientWidth: host.clientWidth, bad, xss: window.__equipmentXss };
      });
      assert.ok(geometry.width <= geometry.viewport + 1, JSON.stringify(geometry)); assert.deepStrictEqual(geometry.bad, []); assert.strictEqual(geometry.xss, 0);
      assert.strictEqual(await page.locator('#assetCatalogueContainer img, #assetCatalogueContainer script').count(), 0);
      const semantics = await page.locator('#assetCatalogueContainer').ariaSnapshot(); assert.match(semantics, /Search vehicles and equipment/); assert.match(semantics, /Trucks \(2\)/);
      const addButton = page.getByRole('button', { name: 'Add equipment', exact: true });
      if (width <= 390) await addButton.tap(); else await addButton.click();
      try { await page.locator('.equipment-dialog[open]').waitFor({ timeout: 5000 }); }
      catch (error) { await page.screenshot({ path: path.join(output, `failed-dialog-${theme}-${width}.png`), fullPage: true }); throw error; }
      const dialog = page.getByRole('dialog'); await dialog.locator('textarea').fill('<img src=x onerror=window.__equipmentXss++>');
      await page.keyboard.press('Tab'); assert.strictEqual(await page.evaluate(() => document.querySelector('.equipment-dialog').contains(document.activeElement)), true);
      await page.keyboard.press('Escape'); assert.strictEqual(await dialog.count(), 0);
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'addAssetButton');
      await page.locator('#section-vehicles').screenshot({ path: path.join(output, `${theme}-${width}.png`) });
      ledger.cases.push({ theme, width, geometry, collapsedByDefault: true, keyboardDisclosure: true, focusReturn: true, touch: width <= 390, reducedMotion: true });
      if (width === 1280) {
        await page.evaluate(() => { document.body.style.zoom = '2'; });
        const reflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(reflow.scroll <= reflow.viewport + 1, JSON.stringify(reflow));
        ledger.cases.push({ theme, cssZoom: 200, reflow, nativeBrowserZoom: 'not claimed', narrowViewport400PercentEquivalent: 320 });
      }
      await context.close();
    }
    const restricted = await contextFor(390, 'dark', fixture.memberSession); const memberPage = await restricted.newPage(); await catalogue(memberPage);
    assert.strictEqual(await memberPage.locator('#addAssetButton').isVisible(), false); ledger.cases.push({ memberMutationHidden: true }); await restricted.close();
    // A failed read must never be represented as a successful empty catalogue.
    const failureContext = await contextFor(320, 'light'); const failurePage = await failureContext.newPage();
    await failureContext.route('**/api/equipment/catalogue', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"success":false}' }));
    await failurePage.goto(origin + '/dashboard/business-profile', { waitUntil: 'domcontentloaded' });
    await failurePage.waitForFunction(() => document.documentElement.dataset.assetCatalogueState === 'error');
    assert.match(await failurePage.locator('#assetCatalogueContainer').textContent(), /could not be loaded/); ledger.cases.push({ failedReadNotEmpty: true }); await failureContext.close();
    assert.strictEqual(ledger.pageErrors.length, 0, JSON.stringify(ledger.pageErrors));
    ledger.result = 'passed';
  } catch (error) { ledger.result = 'failed'; ledger.error = error.stack; throw error; }
  finally {
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(ledger, null, 2) + '\n');
    if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); await fixture.close();
  }
  process.stdout.write(JSON.stringify(ledger, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
