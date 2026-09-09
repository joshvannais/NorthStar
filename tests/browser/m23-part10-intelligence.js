'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const option = (key, fallback) => (process.argv.find(value => value.startsWith('--' + key + '=')) || '--' + key + '=' + fallback).split('=').slice(1).join('=');
process.chdir(path.resolve(__dirname, '../..')); process.env.NODE_ENV = 'test';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','POLARIS_OPENAI_ENABLED','RETELL_API_KEY','STRIPE_SECRET_KEY','TWILIO_AUTH_TOKEN','RESEND_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS']) delete process.env[key];
async function main() {
  const output = path.resolve(option('output', '')), selected = option('browser', 'chrome'), hostile = process.argv.includes('--hostile');
  assert.ok(process.argv.some(v => v.startsWith('--output=')) && !fs.existsSync(output), 'new output directory required'); fs.mkdirSync(output, { recursive: true });
  const ledger = { browser: selected, version: null, authority: 'mounted production modules, disposable PostgreSQL 18.4 UTC', hostile,
    cases: [], pageErrors: [], externalBlocked: [], providerAttempts: 0, mutations: [],
    limitations: 'Actual Playwright WebKit is not physical Safari. Reflow viewports are not native OS zoom. No manual assistive technology or founder personal visual approval.' };
  let fixture, server, browser, activePage;
  const https = require('node:https'), oldRequest = https.request, oldGet = https.get, oldFetch = globalThis.fetch;
  const deny = () => { ledger.providerAttempts++; throw new Error('External transport forbidden in local intelligence validation'); };
  https.request = deny; https.get = deny; globalThis.fetch = deny;
  try {
    fixture = await require('../helpers/m23-part9b-overview-fixture').createDatabaseFixture({ operationalSchedule: true });
    const work = await fixture.createExecution({ approvedScheduling: true, title: hostile ? '<img src=x onerror=alert(1)> A long literal work title with untrusted markup-looking text' : 'Kitchen sink repair', start: new Date(Date.now() + 60000).toISOString() });
    // Genuine scheduling approval can retain acknowledged needs-review inputs.
    // Do not bypass those gates to fabricate executable progress evidence.
    server = fixture.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port, runtime = resolveBrowserRuntime(selected);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath }); ledger.version = browser.version();
    const profiles = [{ name: '1440', width: 1440, height: 1000 }, { name: '1280', width: 1280, height: 720 }, { name: '1920', width: 1920, height: 1080 },
      { name: '768', width: 768, height: 1024 }, { name: '430', width: 430, height: 932 }, { name: '390', width: 390, height: 844 },
      { name: '375', width: 375, height: 812 }, { name: '320', width: 320, height: 760 }, { name: 'reflow200', width: 720, height: 500 }, { name: 'reflow400', width: 360, height: 350 }]
      .filter(p => option('profile', 'all') === 'all' || p.name === option('profile'));
    assert.ok(profiles.length);
    for (const theme of ['light', 'dark']) for (const profile of profiles) for (const actor of ['owner', 'member']) {
      const label = `${hostile ? 'hostile' : 'ordinary'}-${theme}-${profile.name}-${actor}`;
      const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.width <= 430, reducedMotion: 'reduce' });
      await context.addInitScript(value => localStorage.setItem('northstar-theme', value), theme);
      await context.addCookies(Object.entries(fixture.actors[actor].session.cookies).map(([name, value]) => ({ name, value, url: origin, sameSite: 'Lax', httpOnly: name !== 'northstar_csrf' })));
      const page = await context.newPage(); activePage = page; page.on('pageerror', error => ledger.pageErrors.push({ label, message: error.message }));
      page.on('request', req => { if (req.method() === 'POST') ledger.mutations.push({ label, path: new URL(req.url()).pathname }); });
      await page.route('**/*', async route => { if (new URL(route.request().url()).origin !== origin) { ledger.externalBlocked.push(new URL(route.request().url()).origin); return route.abort(); } return route.continue(); });
      await page.goto(origin + (actor === 'owner' ? '/dashboard/completion-review?executionId=' + work.execution.id : '/dashboard/work?appointmentId=' + work.appointment + '&executionId=' + work.execution.id));
      const toggle = page.locator('#operationalIntelligence > summary'); await toggle.waitFor();
      assert.equal(await page.locator('#operationalIntelligence').count(), 1, 'one coherent intelligence surface');
      await toggle.focus(); await page.keyboard.press('Enter');
      await page.locator('.oi-status').filter({ hasText: 'Evidence snapshot ready' }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Plan and actual evidence', exact: true }).count(), 1);
      const missing = page.locator('.oi-missing>summary');
      if (await missing.count()) { await missing.focus(); await page.keyboard.press('Enter'); assert.equal(await page.locator('.oi-missing').getAttribute('open'), ''); await missing.click(); }
      await page.getByText('Sources, freshness and confidence', { exact: true }).focus(); await page.keyboard.press('Space');
      assert.equal(await page.locator('.oi-evidence').getAttribute('open'), '');
      await page.getByText('Sources, freshness and confidence', { exact: true }).click();
      await page.getByRole('button', { name: 'Refresh intelligence', exact: true }).click();
      await page.locator('.oi-status').filter({ hasText: 'Evidence snapshot ready' }).waitFor();
      const result = await page.evaluate(() => {
        const host = document.getElementById('operationalIntelligence');
        const visible = e => e.getClientRects().length > 0;
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          clipped: [...host.querySelectorAll('button,summary,p,h3,h4,dd,dt')].filter(visible).filter(e => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).map(e => e.tagName),
          unnamed: [...host.querySelectorAll('button,summary')].filter(e => !e.textContent.trim()).length,
          script: host.querySelectorAll('script,img,iframe,svg,a[href]').length,
          theme: document.documentElement.dataset.theme, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
      });
      assert.ok(result.scrollWidth <= result.width + 1, label + ' page overflow ' + JSON.stringify(result)); assert.deepEqual(result.clipped, [], label + ' clipped intelligence');
      assert.equal(result.unnamed, 0); assert.equal(result.script, 0); assert.equal(result.theme, theme); assert.equal(result.reduced, true);
      await page.evaluate(async () => {
        await document.fonts.ready; document.activeElement?.blur();
        document.querySelectorAll('*').forEach(e => { if (e.scrollTop || e.scrollLeft) e.scrollTo({ top: 0, left: 0, behavior: 'instant' }); });
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const headingGeometry = await page.evaluate(() => {
        const headers = [...document.querySelectorAll('header,.mobile-header')].filter(e => e.getClientRects().length && ['fixed','sticky'].includes(getComputedStyle(e).position));
        return { headingTop: document.querySelector('h1').getBoundingClientRect().top, headerBottom: Math.max(0, ...headers.map(e => e.getBoundingClientRect().bottom)) };
      });
      assert.ok(headingGeometry.headingTop >= headingGeometry.headerBottom, label + ' header overlaps title ' + JSON.stringify(headingGeometry));
      await page.screenshot({ path: path.join(output, label + '.png'), fullPage: true }); ledger.cases.push({ label, ...result, passed: true });
      await page.locator('#operationalIntelligence').screenshot({ path: path.join(output, label + '-intelligence.png') });
      if (profile.name === '390' || option('profile', 'all') !== 'all') {
        // Explicit intercepted failure fixture after a genuine mounted success.
        await page.route('**/intelligence', route => route.fulfill({ status: 403, json: { success: false } }));
        await page.getByRole('button', { name: 'Refresh intelligence', exact: true }).click();
        await page.locator('.oi-status').filter({ hasText: 'unavailable or access has changed' }).waitFor();
        assert.equal(await page.locator('.oi-body').textContent(), '');
        await page.screenshot({ path: path.join(output, label + '-denied.png'), fullPage: true });
        ledger.cases.push({ label: label + '-denied-clears-advice', interceptedFailure: true, passed: true });
        await page.unroute('**/intelligence');
        await page.getByRole('button', { name: 'Refresh intelligence', exact: true }).click();
        await page.locator('.oi-status').filter({ hasText: 'Evidence snapshot ready' }).waitFor();
        await context.setOffline(true); await page.getByRole('button', { name: 'Refresh intelligence', exact: true }).click();
        await page.locator('.oi-status').filter({ hasText: 'Offline' }).waitFor(); assert.equal(await page.locator('.oi-body').textContent(), '');
        await context.setOffline(false); ledger.cases.push({ label: label + '-offline-clears-advice', passed: true });
      }
      await context.close(); activePage = null;
    }
    assert.deepEqual(ledger.pageErrors, []); assert.equal(ledger.providerAttempts, 0); assert.deepEqual(ledger.mutations, []);
    fs.writeFileSync(path.join(output, 'ledger.json'), JSON.stringify(ledger, null, 2));
  } catch (error) {
    ledger.error = error.stack; if (activePage) await activePage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify(ledger, null, 2)); throw error;
  } finally {
    if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); if (fixture) await fixture.cleanup();
    https.request = oldRequest; https.get = oldGet; globalThis.fetch = oldFetch;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
