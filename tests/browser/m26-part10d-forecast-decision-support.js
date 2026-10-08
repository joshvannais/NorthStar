'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const engine = process.argv[2];
const output = path.resolve(process.argv[3]);
assert.ok(!fs.existsSync(output), 'Browser evidence directory must be new');
fs.mkdirSync(output, { recursive: true });
const dashboard = fs.readFileSync(path.resolve('public/demo-dashboard.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<script\b[^>]*\/>/gi, '')
  .replace(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*>/gi, '');
const styles = ['style.css','demo-dashboard.css'].map(file =>
  fs.readFileSync(path.resolve('public/css', file), 'utf8')
    .replace(/^\s*\@import[^;]+;\s*/gm, '')).join('\n');
const TENANTS = { paid: 'a0000000-0000-4000-8000-000000000010',
  demo: 'd0000000-0000-4000-8000-000000000010' };
const ACTOR = 'a0000000-0000-4000-8000-000000000011';
const ORIGIN = '90000000-0000-4000-8000-000000000010';

async function pageFor(browser, scenario) {
  const context = await browser.newContext({ viewport: scenario.viewport,
    colorScheme: scenario.theme, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(dashboard, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ css, theme }) => {
    const style = document.createElement('style'); style.textContent = css;
    document.head.append(style); document.documentElement.dataset.theme = theme;
  }, { css: styles, theme: scenario.theme });
  await page.waitForFunction(() => getComputedStyle(document.body).margin === '0px');
  for (const file of ['command-center-monthly-forecast-kpis.js',
    'command-center-forecast-drilldowns.js','command-center-forecast-decision-support.js']) {
    await page.addScriptTag({ path: path.resolve('public/js', file) });
  }
  await page.evaluate(({ mode, tenant, origin }) => {
    window.__calls = []; window.__responses = []; window.__announcements = [];
    window.__authority = { tenantId: tenant, role: mode === 'demo' ? 'viewer' : 'owner',
      mode, fictional: mode === 'demo' };
    const status = document.getElementById('commandCenterForecastDecisionStatus');
    new MutationObserver(() => window.__announcements.push(status.textContent))
      .observe(status, { childList: true, characterData: true, subtree: true });
    window.__decisions = NorthStarForecastDecisionSupport.create({ document, mode,
      originProvider: () => origin, fetcher: async (url, options) => {
        window.__calls.push({ url, method: options.method, cache: options.cache });
        const response = window.__responses.shift();
        if (!response) throw new Error('Unexpected request');
        if (response.hold) await new Promise(resolve => { window.__releaseDecision = resolve; });
        return { ok: response.status >= 200 && response.status < 300,
          json: async () => response.payload };
      } });
  }, { mode: scenario.mode, tenant: TENANTS[scenario.mode], origin: ORIGIN });
  return { context, page, errors };
}

async function statusIsExposed(context, page) {
  const status = page.locator('#commandCenterForecastDecisionStatus');
  assert.equal(await status.getAttribute('role'), 'status');
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  assert.equal(await status.getAttribute('aria-atomic'), 'true');
  if (engine === 'chrome') {
    const session = await context.newCDPSession(page);
    const root = await session.send('DOM.getDocument');
    const target = await session.send('DOM.querySelector', {
      nodeId: root.root.nodeId, selector: '#commandCenterForecastDecisionStatus',
    });
    const tree = await session.send('Accessibility.getPartialAXTree', {
      nodeId: target.nodeId, fetchRelatives: false,
    });
    assert.ok(tree.nodes.some(node => node.role?.value === 'status' && !node.ignored));
  }
}

async function exercise(browser, scenario, result) {
  const { context, page, errors } = await pageFor(browser, scenario);
  try {
    const summary = page.locator('#commandCenterForecastDecisionDetails > summary');
    await summary.focus();
    assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    await summary.press('Enter');
    assert.notEqual(await page.locator('#commandCenterForecastDecisionDetails')
      .getAttribute('open'), null);
    assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    await statusIsExposed(context, page);

    if (scenario.mode === 'demo') {
      await page.evaluate(() => window.__decisions.workspaceReady(window.__authority));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.equal(await page.locator('#commandCenterForecastDecisionState').textContent(),
        'Fictional guard');
      assert.match(await page.locator('#commandCenterForecastDecisionExplanation').textContent(),
        /isolated fictional workspace.*no paid forecast request.*no alert.*export/i);
      assert.match(await page.locator('#commandCenterForecastExportBody').textContent(),
        /no fictional packet.*no paid evidence/i);
      await page.evaluate(() => window.__decisions.workspaceUnavailable());
      assert.equal(await page.locator('#commandCenterForecastDecisionDetails')
        .getAttribute('open'), null);
      await page.evaluate(() => window.__decisions.workspaceReady(window.__authority));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
    } else {
      const value = await page.evaluate(({ tenant, actor }) => {
        const details = NorthStarForecastDrilldowns.demoDrilldowns(tenant);
        return NorthStarForecastDecisionSupport.fromDrilldowns(details,
          { userId: actor, role: 'owner' }, false);
      }, { tenant: TENANTS.paid, actor: ACTOR });
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data }, hold: true });
        document.getElementById('commandCenterForecastAlertBody').textContent =
          'stale private positive alert';
        document.getElementById('commandCenterForecastAdviceBody').textContent =
          'stale private schedule action';
        document.getElementById('commandCenterForecastExportBody').textContent =
          'stale private download link';
        window.__pendingDecision = window.__decisions.workspaceReady(window.__authority);
      }, value);
      assert.doesNotMatch(await page.locator('#commandCenterForecastAlertBody').textContent(),
        /stale private/);
      assert.doesNotMatch(await page.locator('#commandCenterForecastAdviceBody').textContent(),
        /stale private/);
      assert.doesNotMatch(await page.locator('#commandCenterForecastExportBody').textContent(),
        /stale private/);
      await page.evaluate(() => window.__releaseDecision());
      await page.evaluate(() => window.__pendingDecision);
      assert.deepEqual(await page.evaluate(() => window.__calls), [{
        url: `/api/v1/forecast/decision-support/${ORIGIN}`, method: 'GET', cache: 'no-store',
      }]);
      assert.match(await page.locator('#commandCenterForecastDecisionAuthority').textContent(),
        /Tenant a0000000.*month.*timeline.*bundle.*accepted run.*export digests unavailable/i);

      await page.evaluate(data => {
        const stale = JSON.parse(JSON.stringify(data));
        stale.reason = 'deterministic_baseline_not_current';
        stale.anchor.period = null; stale.anchor.sourceSnapshotDigest = null;
        stale.anchor.sourceReceiptDigest = null; stale.anchor.timelineDigest = null;
        stale.anchor.bundleDigest = null; stale.alert.reason = 'source_currentness_not_available';
        stale.export.stale = true; stale.currentness.anchorCurrent = false;
        stale.currentness.correctionOrRevocationApplied = true;
        stale.digests.timeline = null; stale.digests.bundle = null;
        window.__responses.push({ status: 200, payload: { success: true, data: stale } });
        return window.__decisions.workspaceReady(window.__authority);
      }, value);
      assert.match(await page.locator('#commandCenterForecastDecisionAuthority').textContent(),
        /prior source, period and digest identities were cleared/i);
      assert.match(await page.locator('#commandCenterForecastDecisionExplanation').textContent(),
        /source anchor changed.*cleared/i);

      await page.evaluate(() => {
        window.__responses.push({ status: 503,
          payload: { success: false, error: { message: 'unavailable' } } });
        return window.__decisions.workspaceReady(window.__authority);
      });
      assert.match(await page.locator('#commandCenterForecastDecisionAuthority').textContent(),
        /No accepted run, alert policy, event, advisory, export packet or digest is retained/i);
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data } });
        return window.__decisions.workspaceReady(window.__authority);
      }, value);
      assert.equal(await page.locator('#commandCenterForecastDecisionState').textContent(),
        'Actions unavailable');
      assert.doesNotMatch(await page.locator('#commandCenterForecastDecisionExplanation')
        .textContent(), /fictional/i);

      await page.evaluate(() => window.__decisions.workspaceReady({
        tenantId: 'a0000000-0000-4000-8000-000000000010', role: 'member',
        mode: 'paid', fictional: false }));
      assert.match(await page.locator('#commandCenterForecastDecisionExplanation').textContent(),
        /current role cannot view private forecast alerts/i);
    }

    assert.equal(await page.locator('.command-center-forecast-decision-grid article').count(), 3);
    assert.equal(await page.locator('#commandCenterForecastExportButton').isDisabled(), true);
    assert.equal(await page.locator('#commandCenterForecastDecisionSupport a').count(), 0);
    for (const selector of ['#commandCenterForecastAlertBody',
      '#commandCenterForecastAdviceBody','#commandCenterForecastExportBody']) {
      const text = await page.locator(selector).textContent();
      assert.doesNotMatch(text, /\b(?:0|[1-9]\d*)(?:\.\d+)?%\b|P10|P50|P90|probability score/i);
    }
    assert.match(await page.locator('#commandCenterForecastDecisionBoundary').textContent(),
      /navigation is not approval|no probability/i);
    const inspection = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      busy: document.getElementById('commandCenterForecastDecisionSupport')
        .getAttribute('aria-busy'),
      columns: getComputedStyle(document.querySelector('.command-center-forecast-decision-grid'))
        .gridTemplateColumns.split(' ').length,
      motion: Array.from(document.querySelectorAll('#commandCenterForecastDecisionSupport *'))
        .map(node => { const style = getComputedStyle(node); return { id: node.id,
          animationDuration: style.animationDuration,
          transitionDuration: style.transitionDuration }; })
        .filter(value => parseFloat(value.animationDuration) > 0.001 ||
          parseFloat(value.transitionDuration) > 0.001),
    }));
    assert.equal(inspection.scrollWidth, inspection.clientWidth);
    assert.equal(inspection.busy, 'false'); assert.deepEqual(inspection.motion, []);
    assert.equal(inspection.columns, scenario.size === 'mobile' ? 1 : 3);
    assert.match(await page.evaluate(() => window.__announcements.at(-1)),
      /value-free|unavailable|fictional/i);
    assert.deepEqual(errors, []);
    const name = [scenario.mode, scenario.size, scenario.theme].join('-');
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    result.cases.push({ name, ownerAdminGuard: true, paidDemoIsolation: true,
      alertAdviceExportWithheld: true, noLinksOrAutomaticAction: true,
      correctionFailureAndRecovery: true, staleEvidenceCleared: true,
      keyboardAndStatusAccessible: true, responsive: true, reducedMotion: true, pass: true });
  } finally { await context.close(); }
}

(async () => {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  const result = { engine, pass: false, cases: [] };
  try {
    const scenarios = [];
    for (const mode of ['paid','demo']) for (const size of ['mobile','desktop']) {
      for (const theme of ['light','dark']) scenarios.push({ mode, size, theme,
        viewport: size === 'mobile' ? { width: 390, height: 844 } :
          { width: 1440, height: 1000 } });
    }
    for (const scenario of scenarios) await exercise(browser, scenario, result);
    result.pass = true;
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
