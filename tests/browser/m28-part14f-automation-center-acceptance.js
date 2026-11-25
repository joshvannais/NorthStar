'use strict';

// Genuine Part 14F browser acceptance. This script deliberately uses the
// canonical local server, disposable PostgreSQL, real account sessions/CSRF,
// and ordinary browser networking. It never installs a request/response route
// or substitutes a browser response.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = process.env.AUTH_ACCESS_SECRET ||
  'm28-part14f-local-only-secret-at-least-thirty-two-characters';
for (const key of ['OPENAI_API_KEY', 'RETELL_API_KEY', 'STRIPE_SECRET_KEY']) delete process.env[key];

const engine = process.argv[2];
const outputRoot = path.resolve(process.argv[3]);
assert.ok(['chrome', 'webkit'].includes(engine), 'Part 14F requires Chrome or Playwright WebKit');
assert.ok(process.env.M19_PG_ADMIN_URL, 'M19_PG_ADMIN_URL is required');
fs.mkdirSync(outputRoot, { recursive: true });

const { createDatabaseFixture } = require('../helpers/m23-part9b-overview-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const result = {
  contract: 'mission28.part14f.automation-center-browser-acceptance.v1',
  engine, pass: false, requestInterception: false, responseInterception: false,
  providerCalls: 0, realRecipients: 0, externalEffects: 0, moneyEffects: 0,
  cases: [], requests: [], responses: [], pageErrors: [], consoleErrors: [], expectedConsoleErrors: [], screenshots: [],
  unavailable: ['physical Safari', 'physical devices', 'manual assistive technology',
    'founder visual approval', 'provider sandbox or live evidence', 'private production evidence'],
};
let fixture, server, browser, lastPage, heldLock;

function cookieEntries(session, origin) {
  return Object.entries(session.cookies).map(([name, value]) => ({
    name, value, url: origin, sameSite: 'Lax', httpOnly: name !== 'northstar_csrf',
  }));
}
function observe(page, label, origin) {
  page.on('pageerror', error => result.pageErrors.push(`${label}: ${error.message}`));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    var value = `${label}: ${message.text()}`;
    if (/Failed to load resource:[\s\S]*\b(?:403|409|503)\b/.test(value)) {
      result.expectedConsoleErrors.push(value); return;
    }
    result.consoleErrors.push(value);
  });
  page.on('request', request => {
    const url = new URL(request.url());
    result.requests.push({ label, method: request.method(), origin: url.origin, path: url.pathname });
    assert.equal(url.origin, origin, `unexpected external request: ${request.url()}`);
  });
  page.on('response', response => {
    const url = new URL(response.url());
    result.responses.push({ label, method: response.request().method(), path: url.pathname,
      status: response.status() });
  });
}
async function settled(page) {
  await page.locator('#automationMain').waitFor();
  await page.waitForFunction(() => document.querySelector('#automationMain')?.getAttribute('aria-busy') === 'false');
  await page.waitForFunction(() => document.querySelector('#automationStatus')?.dataset.state !== 'loading');
}
async function renderedAudit(page, mode) {
  const audit = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll('[id]')).map(node => node.id);
    const controls = Array.from(document.querySelectorAll('button,input,select,textarea'));
    const visible = node => !node.hidden && node.getClientRects().length > 0;
    const unlabeled = controls.filter(control => visible(control) && !control.disabled &&
      !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby') &&
      !(control.labels && control.labels.length) && !(control.textContent || '').trim()).map(node => node.id);
    const tooSmall = controls.filter(control => visible(control) && !control.disabled).map(control => {
      const box = control.getBoundingClientRect(); return { id: control.id || control.textContent.trim(),
        width: box.width, height: box.height };
    }).filter(box => box.height < 44 || box.width < 44);
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4')).map(node => ({
      level: Number(node.tagName.slice(1)), text: node.textContent.trim(), visible: visible(node),
    })).filter(item => item.visible);
    return {
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index), unlabeled, tooSmall,
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      headings, mainRole: document.querySelectorAll('main').length,
      statusRole: document.querySelector('#automationStatus')?.getAttribute('role'),
      statusLive: document.querySelector('#automationStatus')?.getAttribute('aria-live'),
      pageTheme: document.documentElement.dataset.theme,
      summaryHidden: document.querySelector('#automationSummary')?.hidden,
      automationText: document.querySelector('#automationMain')?.innerText || '',
    };
  });
  assert.deepEqual(audit.duplicateIds, []);
  assert.deepEqual(audit.unlabeled, []);
  assert.deepEqual(audit.tooSmall, []);
  assert.ok(audit.horizontalOverflow <= 1, `horizontal overflow ${audit.horizontalOverflow}px`);
  assert.equal(audit.mainRole, 1);
  assert.equal(audit.statusRole, 'status');
  assert.equal(audit.statusLive, 'polite');
  assert.equal(audit.pageTheme, mode.theme);
  assert.equal(audit.summaryHidden, false);
  assert.equal(audit.headings[0]?.level, 1);
  assert.doesNotMatch(audit.automationText,
    /(?:unavailable_[a-z_]+|\b(?:lease|fence|action-control|authority-class)\b)/i);
  const aria = await page.locator('#automationMain').ariaSnapshot();
  assert.match(aria, /heading "Automation Center" \[level=1\]/);
  assert.match(aria, /heading "Choose what you want NorthStar to prepare" \[level=2\]/);
  return { ...audit, ariaLines: aria.split(/\r?\n/).length };
}
async function keyboardAndPreview(page) {
  const skip = page.locator('.automation-skip');
  assert.equal(await skip.evaluate(node => node.tabIndex), 0);
  await skip.focus();
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('automation-skip')), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automationMain');
  const disclosure = page.locator('#customSetupDisclosure summary');
  await disclosure.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#customSetupDisclosure').getAttribute('open'), '');
  const previewResponse = page.waitForResponse(response =>
    response.request().method() === 'POST' && /automation-center\/preview$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Preview this setup' }).first().click();
  const response = await previewResponse;
  assert.equal(response.status(), 200);
  await page.locator('#automationPreview').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'automationPreview');
  assert.match(await page.locator('#previewBoundary').innerText(), /not saved or active/i);
  assert.match(await page.locator('#automationStatus').innerText(), /Nothing was saved, activated, queued, sent, or charged/i);
  return { skipLinkMovedFocusToMain: true, previewFocused: true, noEffectBoundaryRendered: true };
}
async function action(page, actionName) {
  const button = page.locator(`[data-automation-demo-action="${actionName}"]`);
  assert.equal(await button.isEnabled(), true, `${actionName} should be available`);
  const pending = page.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/demo/automation-center/actions');
  await button.click();
  const response = await pending;
  assert.ok([200, 201].includes(response.status()), `${actionName}: ${response.status()}`);
  await settled(page);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.ok(Object.values(body.demo.zeroEffects).every(value => value === 0));
  return body;
}
async function reset(page) {
  if (await page.locator('[data-automation-demo-action="reset_automation"]').isEnabled()) {
    await action(page, 'reset_automation');
  }
}
async function demoWorkflows(page) {
  const preview = await keyboardAndPreview(page);
  const executed = [];
  const run = async name => { await action(page, name); executed.push(name); };
  await reset(page); await run('source_change'); await run('source_correct');
  await reset(page); await run('pause'); await run('resume');
  await reset(page); await run('suppress'); await run('recover');
  await reset(page); await run('advance_time');
  await reset(page); await run('provider_step'); await run('provider_step');
  await reset(page); await run('stop');
  assert.match(await page.locator('#stopState').innerText(), /^stopped$/i);
  const nonResetControlsDisabled = await page.locator('[data-automation-demo-action]:not([data-automation-demo-action="reset_automation"])')
    .evaluateAll(buttons => buttons.every(button => button.disabled));
  assert.equal(nonResetControlsDisabled, true);
  assert.equal(await page.locator('[data-automation-demo-action="reset_automation"]').isEnabled(), true);
  await run('reset_automation');
  assert.deepEqual(executed, ['source_change', 'source_correct', 'pause', 'resume', 'suppress',
    'recover', 'advance_time', 'provider_step', 'provider_step', 'stop', 'reset_automation']);
  return { preview, executed, stoppedControlsDisabled: true, resetRecovered: true };
}
async function staleConflict(context, origin) {
  const first = await context.newPage(), stale = await context.newPage();
  observe(first, 'demo-stale-current', origin); observe(stale, 'demo-stale-old', origin);
  await first.goto(`${origin}/demo/automation`, { waitUntil: 'networkidle' }); await settled(first);
  await stale.goto(`${origin}/demo/automation`, { waitUntil: 'networkidle' }); await settled(stale);
  await action(first, 'source_change');
  const conflict = stale.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/demo/automation-center/actions');
  await stale.locator('[data-automation-demo-action="source_change"]').click();
  assert.equal((await conflict).status(), 409);
  await stale.waitForFunction(() => document.querySelector('#automationStatus')?.dataset.state === 'conflict');
  assert.equal(await stale.locator('#automationSummary').isHidden(), true);
  assert.equal(await stale.locator('#automationDemoControls').isHidden(), true);
  await first.close(); await stale.close();
  return { conflictStatus: 409, staleSummaryCleared: true, staleControlsCleared: true };
}
async function delayedRead(page) {
  heldLock = await fixture.ownerPool.connect(); await heldLock.query('BEGIN');
  await heldLock.query('LOCK TABLE public.demo_command_center_sessions IN ACCESS EXCLUSIVE MODE');
  const click = page.locator('#automationRefresh').click();
  await page.waitForFunction(() => document.querySelector('#automationStatus')?.dataset.state === 'loading');
  assert.equal(await page.locator('#automationSummary').isHidden(), true);
  await page.waitForTimeout(150);
  await heldLock.query('ROLLBACK'); heldLock.release(); heldLock = null;
  await click; await settled(page);
  assert.equal(await page.locator('#automationSummary').isVisible(), true);
  return { loadingClearedPriorSummary: true, recoveredAfterLockRelease: true };
}
async function databaseErrorAndRecovery(page) {
  const saved = fixture.runtimeProcess.env.DATABASE_URL;
  const unavailable = new URL(saved); unavailable.hostname = '127.0.0.1'; unavailable.port = '1';
  await fixture.db.close(); fixture.runtimeProcess.env.DATABASE_URL = unavailable.toString();
  try {
    const degraded = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/demo/command-center' && response.status() === 503);
    await page.locator('#automationRefresh').click(); await degraded;
    await page.waitForFunction(() => document.querySelector('#automationStatus')?.dataset.state === 'unavailable');
    assert.equal(await page.locator('#automationSummary').isHidden(), true);
  } finally {
    await fixture.db.close(); fixture.runtimeProcess.env.DATABASE_URL = saved;
    assert.equal(await fixture.db.initDatabase(), true);
  }
  await page.locator('#automationRefresh').click(); await settled(page);
  assert.equal(await page.locator('#automationSummary').isVisible(), true);
  return { unavailableClearedPriorSummary: true, explicitPoolRecoveryRendered: true };
}
async function paidAuthorityLossAndRecovery(page) {
  await fixture.ownerPool.query("UPDATE organization_memberships SET role='member' WHERE id=$1",
    [fixture.actors.owner.actorUserId]);
  try {
    const denied = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/v1/automation-center' && response.status() === 403);
    await page.locator('#automationRefresh').click(); await denied;
    await page.waitForFunction(() => document.querySelector('#automationStatus')?.dataset.state === 'error');
    assert.equal(await page.locator('#automationSummary').isHidden(), true);
  } finally {
    await fixture.ownerPool.query("UPDATE organization_memberships SET role='owner' WHERE id=$1",
      [fixture.actors.owner.actorUserId]);
  }
  await page.locator('#automationRefresh').click(); await settled(page);
  assert.equal(await page.locator('#automationSummary').isVisible(), true);
  return { forbiddenClearedPriorTenantData: true, restoredOwnerRecovered: true };
}

(async () => {
  try {
    fixture = await createDatabaseFixture();
    server = fixture.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    const modes = [
      { name: 'desktop-light', width: 1440, height: 1000, theme: 'light' },
      { name: 'desktop-dark', width: 1440, height: 1000, theme: 'dark' },
      { name: 'mobile-light', width: 390, height: 844, theme: 'light', isMobile: true },
      { name: 'mobile-dark', width: 390, height: 844, theme: 'dark', isMobile: true },
    ];
    for (const mode of modes) {
      for (const surface of ['paid', 'demo']) {
        const label = `${engine}-${surface}-${mode.name}`;
        const context = await browser.newContext({ viewport: { width: mode.width, height: mode.height },
          isMobile: Boolean(mode.isMobile), hasTouch: Boolean(mode.isMobile),
          reducedMotion: 'reduce', colorScheme: mode.theme });
        await context.addInitScript(theme => localStorage.setItem('northstar-theme', theme), mode.theme);
        if (surface === 'paid') await context.addCookies(cookieEntries(fixture.actors.owner.session, origin));
        const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(30000); observe(page, label, origin);
        const route = surface === 'paid' ? '/dashboard/automation' : '/demo/automation';
        await page.goto(`${origin}${route}#automationEvidence`, { waitUntil: 'networkidle' }); await settled(page);
        assert.equal(new URL(page.url()).hash, '#automationEvidence');
        const first = await renderedAudit(page, mode);
        let workflowReceipts;
        if (surface === 'paid') {
          workflowReceipts = { preview: await keyboardAndPreview(page),
            authority: await paidAuthorityLossAndRecovery(page) };
        } else {
          workflowReceipts = { demo: await demoWorkflows(page), delayed: await delayedRead(page),
            database: await databaseErrorAndRecovery(page), conflict: await staleConflict(context, origin) };
          await page.reload({ waitUntil: 'networkidle' }); await settled(page); await reset(page);
          workflowReceipts.conflictRecovery = { reloadedCurrentRevision: true, resetRecovered: true };
        }
        await page.goto(`${origin}${route}#automationEvidence`, { waitUntil: 'networkidle' }); await settled(page);
        await page.reload({ waitUntil: 'networkidle' }); await settled(page);
        await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' }); await settled(page);
        await page.goBack({ waitUntil: 'networkidle' }); await settled(page);
        await page.goForward({ waitUntil: 'networkidle' }); await settled(page);
        await page.goBack({ waitUntil: 'networkidle' }); await settled(page);
        assert.equal(new URL(page.url()).hash, '#automationEvidence');
        const second = await renderedAudit(page, mode);
        const shot = path.join(outputRoot, `${label}.png`); await page.screenshot({ path: shot, fullPage: true });
        result.screenshots.push(shot);
        result.cases.push({ label, direct: true, reload: true, backForward: true, deepLink: true,
          responsive: true, theme: mode.theme, accessibility: true, ariaLines: second.ariaLines,
          firstStatus: first.summaryHidden ? 'hidden' : 'rendered', finalStatus: second.summaryHidden ? 'hidden' : 'rendered',
          workflowReceipts });
        await context.close();
      }
    }
    assert.deepEqual(result.pageErrors, []);
    assert.deepEqual(result.consoleErrors, []);
    assert.ok(result.requests.length > 0 && result.responses.length > 0);
    assert.equal(result.requests.some(item => item.origin !== origin), false);
    result.pass = true;
  } catch (error) {
    result.error = error.stack; process.exitCode = 1;
    if (lastPage && !lastPage.isClosed()) {
      await lastPage.screenshot({ path: path.join(outputRoot, `${engine}-failure.png`), fullPage: true }).catch(() => {});
    }
  } finally {
    if (heldLock) { await heldLock.query('ROLLBACK').catch(() => {}); heldLock.release(); heldLock = null; }
    fs.writeFileSync(path.join(outputRoot, `${engine}-result.json`), JSON.stringify(result, null, 2));
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (fixture) await fixture.cleanup();
  }
})().then(() => process.exit(process.exitCode || 0)).catch(error => {
  console.error(error); process.exit(1);
});
