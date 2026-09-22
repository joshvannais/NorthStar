'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { navigationFixture } = require('../helpers/navigation-fixture');
const builder = require('../../src/commandCenter/workspace');

const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new --output directory');
fs.mkdirSync(output, { recursive: true });
const id = n => `e4910000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const categories = ['unassigned', 'due', 'overdue', 'atRisk', 'conflicting'];
const scheduling = {
  version: 'm22-part5-overview-v1', timeZone: 'America/New_York', digest: 'a'.repeat(64),
  total: 0, shown: 0, page: { size: 100, shown: 0, total: 0, cursor: null, nextCursor: null },
  definitions: Object.fromEntries(categories.map(key => [key, 'Fictional current scheduling category'])),
  categories: Object.fromEntries(categories.map(key => [key, []])),
  counts: Object.fromEntries(categories.map(key => [key, 0])), records: [],
};
const operator = {
  canRead: true, canMutate: false, reason: 'subscription_read_only', targets: [],
  digest: 'c'.repeat(64), truncated: false,
  discovery: { version: 'm22-part5-target-directory-v1', endpoint: '/api/v1/canonical/operator-targets',
    pageSize: 100, shown: 0, total: 0, truncated: false },
};
const paid = builder.buildPaidWorkspace({ context: { organizationId: id(1) }, items: [],
  schedulingOperator: operator, schedulingOverview: scheduling });
const demo = builder.buildDemoWorkspace({ tenantId: id(1), sessionId: id(3),
  state: builder.createInitialDemoState(id(1), new Date('2026-09-09T12:00:00Z')),
  revision: 1, simulationCount: 0, persisted: false, expiresAt: new Date('2099-09-09T12:00:00Z') });
const account = { account: {
  user: { id: id(2), name: 'Fictional Owner', email: 'owner@example.com', status: 'active' },
  organization: { id: id(1), name: 'Fictional Business' }, navigation: navigationFixture(),
  membership: { role: 'owner', status: 'active' }, memberships: [{ role: 'owner', status: 'active' }],
  onboarding: { status: 'complete' }, subscription: {
    plan: 'Complete', safe: true, state: 'active', readOnly: false, showTrialBanner: false,
  },
} };

async function main() {
  const app = require('../../src/server').app;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = resolveBrowserRuntime(process.argv.includes('--webkit') ? 'webkit' : 'chrome');
  const browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
  const results = [];
  try {
    for (const mode of ['paid', 'demo']) for (const viewport of [
      { name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      await context.addInitScript(() => localStorage.setItem('northstar-quick-start-seen', 'true'));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let failedWorkspace = false;
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        const json = (data, status = 200) => route.fulfill({ status, json: data });
        if (url.pathname === '/api/auth/me') return json(account);
        if (url.pathname === '/api/account/subscription') return json({ subscription: account.account.subscription });
        if (url.pathname === '/api/v1/command-center/workspace') {
          return failedWorkspace ? json({ success: false, error: { message: 'Workspace unavailable.' } }, 503)
            : json({ success: true, data: mode === 'demo' ? demo : paid });
        }
        if (url.pathname === '/api/demo/command-center') {
          return failedWorkspace ? json({ success: false, error: { message: 'Workspace unavailable.' } }, 503)
            : json({ success: true, data: demo });
        }
        if (url.pathname.startsWith('/api/')) return json({ success: true, data: {}, items: [], records: [] });
        return route.continue();
      });
      await page.goto(origin + (mode === 'demo' ? '/demo' : '/dashboard'));
      await page.locator('#commandCenterDemandState').getByText('Forecast unavailable').waitFor();
      if (await page.locator('#northstarQuickStartDialog[open]').count()) await page.keyboard.press('Escape');
      const panel = page.locator('.command-center-demand-outlook');
      const text = await panel.innerText();
      assert.match(text, mode === 'demo' ? /fictional leads/i : /verified lead history/i);
      assert.match(text, /not a prediction of future work/i);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const readyScreenshot = path.join(output, `${mode}-${viewport.name}-unavailable.png`);
      await panel.screenshot({ path: readyScreenshot });
      await page.waitForFunction(() => !document.querySelector('#commandCenterRefresh').disabled);
      failedWorkspace = true;
      if (mode === 'demo') await page.reload();
      else await page.locator('#commandCenterRefresh').evaluate(button => button.click());
      await page.locator('#commandCenterDemandState').getByText('Workspace unavailable').waitFor();
      if (await page.locator('#northstarQuickStartDialog[open]').count()) await page.keyboard.press('Escape');
      assert.match(await panel.innerText(), /Refresh to retry loading it/);
      const failedScreenshot = path.join(output, `${mode}-${viewport.name}-workspace-failed.png`);
      await panel.screenshot({ path: failedScreenshot });
      failedWorkspace = false;
      if (mode === 'demo') await page.reload();
      else await page.locator('#commandCenterRefresh').evaluate(button => button.click());
      await page.locator('#commandCenterDemandState').getByText('Forecast unavailable').waitFor();
      if (await page.locator('#northstarQuickStartDialog[open]').count()) await page.keyboard.press('Escape');
      assert.match(await panel.innerText(), mode === 'demo' ? /fictional leads/i : /verified lead history/i);
      assert.equal(errors.length, 0, errors.join('\n'));
      const recoveredScreenshot = path.join(output, `${mode}-${viewport.name}-recovered.png`);
      await panel.screenshot({ path: recoveredScreenshot });
      results.push({ mode, viewport: viewport.name, success: true, readyScreenshot,
        failedScreenshot, recoveredScreenshot });
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({
      browser: process.argv.includes('--webkit') ? 'Playwright WebKit' : 'Chrome', results,
      limits: 'Synthetic intercepted sources; no live provider, private production, calibrated forecast or physical Safari evidence.',
    }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ cases: results.length, success: true }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
