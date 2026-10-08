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
const styles = ['style.css', 'demo-dashboard.css'].map(file =>
  fs.readFileSync(path.resolve('public/css', file), 'utf8')
    .replace(/^\s*\@import[^;]+;\s*/gm, '')).join('\n');

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
  await page.addScriptTag({ path: path.resolve('public/js/command-center-forecast-ranges.js') });
  await page.evaluate(mode => {
    window.__calls = []; window.__responses = []; window.__announcements = [];
    window.__authority = { tenantId: mode === 'demo' ? 'tenant-demo-browser' : 'tenant-paid-browser',
      role: mode === 'demo' ? 'viewer' : 'owner', mode, fictional: mode === 'demo' };
    const status = document.getElementById('commandCenterForecastStatus');
    new MutationObserver(() => {
      if (window.__announcements.at(-1) !== status.textContent) {
        window.__announcements.push(status.textContent);
      }
    }).observe(status, { childList: true, characterData: true, subtree: true });
    window.__forecast = NorthStarForecastRanges.create({ document, mode,
      originProvider: () => '90000000-0000-4000-8000-000000000009',
      fetcher: async (url, options) => {
        window.__calls.push({ url, method: options.method, cache: options.cache });
        const response = window.__responses.shift();
        if (!response) throw new Error('Unexpected request');
        if (response.hold) await new Promise(resolve => { window.__releaseForecast = resolve; });
        return { ok: response.status >= 200 && response.status < 300,
          json: async () => response.payload };
      } });
  }, scenario.mode);
  return { context, page, errors };
}

async function statusIsExposed(context, page) {
  const status = page.locator('#commandCenterForecastStatus');
  assert.equal(await status.getAttribute('role'), 'status');
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  assert.equal(await status.getAttribute('aria-atomic'), 'true');
  if (engine === 'chrome') {
    const session = await context.newCDPSession(page);
    const root = await session.send('DOM.getDocument');
    const target = await session.send('DOM.querySelector', {
      nodeId: root.root.nodeId, selector: '#commandCenterForecastStatus',
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
    const details = page.locator('#commandCenterForecastDetails');
    const summary = details.locator('summary');
    assert.equal(await details.getAttribute('open'), null);
    await summary.focus(); assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    await summary.press('Enter'); assert.notEqual(await details.getAttribute('open'), null);
    assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    await statusIsExposed(context, page);

    if (scenario.mode === 'demo') {
      await page.evaluate(() => window.__forecast.workspaceReady(window.__authority));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.equal(await page.locator('#commandCenterForecastState').innerText(), 'Fictional evidence');
      assert.match(await page.locator('#commandCenterForecastExplanation').innerText(),
        /isolated fictional example.*does not call paid forecast routes/i);
      await page.evaluate(() => window.__forecast.workspaceUnavailable());
      assert.equal(await page.locator('#commandCenterForecastState').innerText(), 'Workspace unavailable');
      assert.equal(await page.locator('#commandCenterForecastEvidenceMap').innerHTML(), '');
      await page.evaluate(() => window.__forecast.workspaceReady(window.__authority));
      assert.equal(await page.locator('#commandCenterForecastState').innerText(), 'Fictional evidence');
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
    } else {
      const bundle = await page.evaluate(() => NorthStarForecastRanges.demoBundle());
      await page.evaluate(data => {
        window.__responses.push(
          { status: 200, payload: { success: true, data: data.baseline }, hold: true },
          { status: 200, payload: { success: true, data: data.range } },
          { status: 200, payload: { success: true, data: data.scenario } });
        document.getElementById('commandCenterForecastBaselineValue').textContent = 'stale private point';
        document.getElementById('commandCenterForecastAuthority').textContent = 'stale private tenant';
        window.__pendingForecast = window.__forecast.workspaceReady(window.__authority);
      }, bundle);
      assert.equal(await page.locator('#commandCenterForecastBaselineValue').innerText(), 'Not available');
      assert.equal(await page.locator('#commandCenterForecastEvidenceMap').innerHTML(), '');
      assert.doesNotMatch(await page.locator('#commandCenterForecastAuthority').innerText(),
        /stale private tenant/);
      await page.evaluate(() => window.__releaseForecast());
      await page.evaluate(() => window.__pendingForecast);
      assert.equal(await page.locator('#commandCenterForecastState').innerText(), 'Range unavailable');
      assert.equal(await page.evaluate(() => window.__calls.length), 3);
      assert.deepEqual(await page.evaluate(() => window.__calls.map(item => item.url)), [
        '/api/v1/forecast/deterministic-baselines/90000000-0000-4000-8000-000000000009',
        '/api/v1/forecast/calibrated-ranges/90000000-0000-4000-8000-000000000009',
        '/api/v1/forecast/named-pipeline-scenarios/current',
      ]);
      await page.evaluate(data => {
        const corrected = JSON.parse(JSON.stringify(data.baseline));
        corrected.reason = 'source_or_profile_changed_refresh_required';
        corrected.currentness.correctionOrRevocationApplied = true;
        window.__responses.push(
          { status: 200, payload: { success: true, data: corrected } },
          { status: 503, payload: { success: false, error: { message: 'range unavailable' } } },
          { status: 200, payload: { success: true, data: data.scenario } });
        return window.__forecast.workspaceReady(window.__authority);
      }, bundle);
      assert.equal(await page.locator('#commandCenterForecastBaselineValue').innerText(), 'Not available');
      assert.match(await page.locator('#commandCenterForecastBaselineContext').innerText(),
        /source or profile changed refresh required/i);
      assert.equal(await page.locator('#commandCenterForecastRangeValue').innerText(),
        'P10 / P50 / P90 withheld');
      assert.match(await page.locator('#commandCenterForecastRangeContext').innerText(),
        /assessment is unavailable/i);
      assert.doesNotMatch(await page.locator('#commandCenterForecastExplanation').innerText(), /fictional/i);
    }

    assert.equal(await page.locator('#commandCenterForecastRangeValue').innerText(),
      'P10 / P50 / P90 withheld');
    assert.equal(await page.locator('#commandCenterForecastEvidenceMap > *').count(), 4);
    assert.match(await page.locator('#commandCenterForecastBoundary').innerText(),
      /point baseline is not a calibrated range.*what-if assumptions.*not percentiles.*probabilities/i);
    assert.doesNotMatch(await page.locator('#commandCenterForecastRangeValue').innerText(),
      /\b0(?:\.0+)?\b|%|confidence|low risk/i);
    const authorityText = await page.locator('#commandCenterForecastAuthority').innerText();
    assert.match(authorityText, scenario.mode === 'demo'
      ? /Authenticated tenant\s+tenant-demo-browser[\s\S]*Authenticated role\s+viewer[\s\S]*Fictional isolated data\s+Yes/
      : /Authenticated tenant\s+tenant-paid-browser[\s\S]*Authenticated role\s+owner[\s\S]*Fictional isolated data\s+No/);

    const inspection = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: Array.from(document.querySelectorAll('#commandCenterForecastRanges *')).map(node => {
        const rect = node.getBoundingClientRect(); return { id: node.id, left: rect.left, right: rect.right };
      }).filter(value => value.left < 0 || value.right > document.documentElement.clientWidth),
      busy: document.getElementById('commandCenterForecastRanges').getAttribute('aria-busy'),
      motion: Array.from(document.querySelectorAll('#commandCenterForecastRanges *')).map(node => {
        const style = getComputedStyle(node); return { id: node.id,
          animationDuration: style.animationDuration, transitionDuration: style.transitionDuration };
      }).filter(value => parseFloat(value.animationDuration) > 0.001 ||
        parseFloat(value.transitionDuration) > 0.001),
      graphRole: document.getElementById('commandCenterForecastEvidence').getAttribute('role'),
      labelledBy: document.getElementById('commandCenterForecastEvidence').getAttribute('aria-labelledby'),
      contrast: ['commandCenterForecastRangesTitle', 'commandCenterForecastBaselineValue',
        'commandCenterForecastRangeValue', 'commandCenterForecastScenarioValue',
        'commandCenterForecastSensitivityValue', 'commandCenterForecastExplanation',
        'commandCenterForecastBoundary'].map(id => {
          const node = document.getElementById(id);
          const rgb = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
          const luminance = value => rgb(value).map(channel => channel / 255)
            .map(channel => channel <= 0.03928 ? channel / 12.92 :
              Math.pow((channel + 0.055) / 1.055, 2.4))
            .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
          let background = node;
          while (background && /rgba\([^)]*,\s*0\)/.test(getComputedStyle(background).backgroundColor)) {
            background = background.parentElement;
          }
          const foreground = luminance(getComputedStyle(node).color);
          const backdrop = luminance(background ? getComputedStyle(background).backgroundColor :
            'rgb(255, 255, 255)');
          return { id, ratio: (Math.max(foreground, backdrop) + 0.05) /
            (Math.min(foreground, backdrop) + 0.05) };
        }),
    }));
    assert.equal(inspection.scrollWidth, inspection.clientWidth, JSON.stringify(inspection.offenders));
    assert.equal(inspection.busy, 'false'); assert.deepEqual(inspection.motion, []);
    assert.equal(inspection.graphRole, 'img');
    assert.equal(inspection.labelledBy,
      'commandCenterForecastEvidenceTitle commandCenterForecastEvidenceDescription');
    assert.ok(inspection.contrast.every(value => value.ratio >= 4.5),
      JSON.stringify(inspection.contrast));
    assert.match(await page.evaluate(() => window.__announcements.at(-1)),
      /P10, P50 and P90 remain unavailable/);
    assert.deepEqual(errors, []);
    const name = [scenario.mode, scenario.size, scenario.theme].join('-');
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    result.cases.push({ name, paidDemoIsolation: true, rangeWithholding: true,
      correctionFailureAndRecovery: true, staleValuesCleared: true,
      zeroDistinctFromUnavailable: true, keyboardAndFocus: true,
      statusAndEvidenceMapAccessible: true, reducedMotion: true,
      noHorizontalOverflow: true, pass: true });
  } finally { await context.close(); }
}

(async () => {
  const runtime = resolveBrowserRuntime(engine);
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  const result = { engine, pass: false, cases: [] };
  try {
    const scenarios = [];
    for (const mode of ['paid', 'demo']) for (const size of ['mobile', 'desktop']) {
      for (const theme of ['light', 'dark']) scenarios.push({ mode, size, theme,
        viewport: size === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
    }
    for (const scenario of scenarios) await exercise(browser, scenario, result);
    result.pass = true; fs.writeFileSync(path.join(output, 'results.json'),
      JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
