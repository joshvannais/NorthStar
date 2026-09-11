'use strict';
// Real page, account and demo adapters mounted on disposable PostgreSQL.
// Only navigation/read operations: no scheduling or work mutations.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
process.env.NODE_ENV = 'test'; process.env.AUTH_ACCESS_SECRET = 'owner-navigation-entry-disposable-fixture-only';
for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','OPENAI_API_KEY','RETELL_API_KEY','STRIPE_SECRET_KEY']) delete process.env[key];
const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const arg = name => process.argv.find(x => x.startsWith('--' + name + '=')).slice(name.length + 3);
const engine = arg('browser'), out = path.resolve(arg('output'));
assert.ok(!fs.existsSync(out)); fs.mkdirSync(out, {recursive:true});
(async () => {
  let fixture, server, browser, current;
  const ledger = {engine, cases:[], blockedWrites:[], errors:[]};
  try {
    fixture = await createDatabaseFixture(); server = fixture.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({headless:true, executablePath:runtime.executablePath});
    for (const mode of ['demo','paid']) for (const [width,theme] of [[1440,'light'],[390,'dark']]) {
      const context = await browser.newContext({viewport:{width,height:1000}, reducedMotion:'reduce'});
      await context.addInitScript(t => localStorage.setItem('northstar-theme', t), theme);
      if (mode === 'paid') await context.addCookies(Object.entries(fixture.actors.owner.session.cookies).map(([name,value]) => ({name,value,url:origin,sameSite:'Lax',httpOnly:name !== 'northstar_csrf'})));
      await context.route('**/*', route => {
        if (!['GET','HEAD','OPTIONS'].includes(route.request().method())) {
          ledger.blockedWrites.push(new URL(route.request().url()).pathname); return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage(); current = page;
      const privateReads = [];
      page.on('pageerror', error => ledger.errors.push(error.message));
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/v1/')) privateReads.push(new URL(request.url()).pathname); });
      const prefix = mode === 'demo' ? '/demo' : '/dashboard';
      await page.goto(origin + prefix);
      await page.waitForFunction(() => document.documentElement.getAttribute('data-northstar-navigation') === 'ready');
      assert.equal(new URL(page.url()).pathname, prefix);
      const quickStart = page.locator('#northstarQuickStartDialog[open]');
      if (await quickStart.count()) await quickStart.getByRole('button', {name:'Close quick start',exact:true}).click();
      assert.equal(await page.locator('.sidebar a[data-nav-id="operations"]').getAttribute('href'), prefix + '/operations');
      await page.screenshot({path:path.join(out, mode + '-' + width + '-entry.png'),fullPage:true});
      if (width < 600) await page.locator('#navHamburgerBtn').click();
      await page.locator((width < 600 ? '#mobileMenu' : '.sidebar') + ' a[data-nav-id="calendar"]').click();
      await page.waitForFunction(() => document.documentElement.getAttribute('data-northstar-navigation') === 'ready');
      assert.equal(new URL(page.url()).pathname, prefix + '/calendar');
      await page.waitForFunction(() => window.calRenderer && !window.calRenderer.loading);
      if (width < 600) await page.locator('#navHamburgerBtn').click();
      await page.locator((width < 600 ? '#mobileMenu' : '.sidebar') + ' a[data-nav-id="operations"]').click();
      await page.locator('#ownerWork select').waitFor();
      assert.equal(new URL(page.url()).pathname, prefix + '/operations');
      await page.screenshot({path:path.join(out, mode + '-' + width + '-operations.png'),fullPage:true});
      if (mode === 'demo') assert.deepEqual(privateReads, []);
      ledger.cases.push({mode,width,theme,entry:true,calendar:true,operations:true,demoPrivateRequests:mode === 'demo' ? privateReads : null});
      await context.close();
    }
    const context = await browser.newContext(); const page = await context.newPage(); current = page;
    await page.goto(origin + '/dashboard'); await page.waitForURL('**/login');
    ledger.cases.push({unauthenticatedPaidStillRedirects:true}); await context.close();
  } catch (error) {
    ledger.failure = error.stack; process.exitCode = 1;
    if (current && !current.isClosed()) await current.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(() => {});
  } finally {
    fs.writeFileSync(path.join(out,'ledger.json'),JSON.stringify(ledger,null,2));
    if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); if (fixture) await fixture.cleanup();
  }
})();



