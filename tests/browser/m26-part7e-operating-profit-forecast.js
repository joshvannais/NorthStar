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
  await page.waitForFunction(() => getComputedStyle(document.body).margin === '0px' &&
    document.body.getBoundingClientRect().left === 0);
  await page.addScriptTag({ path: path.resolve(
    'public/js/command-center-operating-profit-forecast.js') });
  await page.evaluate(mode => {
    window.__calls = []; window.__responses = []; window.__announcements = [];
    const status = document.getElementById('commandCenterOperatingProfitStatus');
    new MutationObserver(function () {
      const message = status.textContent;
      if (window.__announcements.at(-1) !== message) window.__announcements.push(message);
    }).observe(status, { childList: true, characterData: true, subtree: true });
    window.__forecast = NorthStarOperatingProfitForecast.create({ document, mode,
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
  const status = page.locator('#commandCenterOperatingProfitStatus');
  assert.equal(await status.getAttribute('role'), 'status');
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  assert.equal(await status.getAttribute('aria-atomic'), 'true');
  if (engine === 'chrome') {
    const session = await context.newCDPSession(page);
    const documentNode = await session.send('DOM.getDocument');
    const target = await session.send('DOM.querySelector', {
      nodeId: documentNode.root.nodeId, selector: '#commandCenterOperatingProfitStatus',
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
    const details = page.locator('#commandCenterOperatingProfitDetails');
    const summary = details.locator('summary');
    assert.equal(await details.getAttribute('open'), null);
    await summary.focus(); assert.equal(await summary.evaluate(n => document.activeElement === n), true);
    await summary.press('Enter'); assert.notEqual(await details.getAttribute('open'), null);
    assert.equal(await summary.evaluate(n => document.activeElement === n), true);
    await statusIsExposed(context, page);
    if (scenario.mode === 'demo') {
      await page.evaluate(() => window.__forecast.workspaceReady());
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.equal(await page.locator('#commandCenterOperatingProfitState').innerText(),
        'Fictional example');
      await page.evaluate(() => window.__forecast.workspaceUnavailable());
      assert.equal(await page.locator('#commandCenterOperatingProfitState').innerText(), 'Unavailable');
      assert.equal(await page.locator('#commandCenterOperatingProfitGraphPlot').innerHTML(), '');
      assert.equal(await page.locator('#commandCenterOperatingProfitCash').innerText(), 'Not available');
      await page.evaluate(() => window.__forecast.workspaceReady());
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.equal(await page.locator('#commandCenterOperatingProfitState').innerText(),
        'Fictional example');
    } else {
      const paid = await page.evaluate(() => {
        const value = NorthStarOperatingProfitForecast.demoForecast(); value.fictional = false;
        value.costs.datedCashObligations = '0.01'; return value;
      });
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data }, hold: true });
        window.__pending = window.__forecast.workspaceReady();
      }, paid);
      assert.equal(await page.locator('#commandCenterOperatingCostKpi').innerText(), 'Not available');
      assert.equal(await page.locator('#commandCenterOperatingProfitGraphPlot').innerHTML(), '');
      await page.evaluate(() => window.__releaseForecast()); await page.evaluate(() => window.__pending);
      assert.equal(await page.locator('#commandCenterOperatingProfitCash').innerText(),
        '$0.01 kept outside profit');
      await page.evaluate(() => {
        window.__responses.push({ status: 503, payload: { success: false } });
        return window.__forecast.workspaceReady();
      });
      assert.equal(await page.locator('#commandCenterOperatingProfitState').innerText(), 'Unavailable');
      assert.equal(await page.locator('#commandCenterOperatingProfitGraphPlot').innerHTML(), '');
      assert.equal(await page.locator('#commandCenterOperatingProfitCash').innerText(), 'Not available');
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data } });
        return window.__forecast.workspaceReady();
      }, paid);
      assert.equal(await page.locator('#commandCenterOperatingProfitState').innerText(), 'Current');
      assert.equal((await page.evaluate(() => window.__calls)).length, 3);
    }
    assert.equal(await page.locator('#commandCenterOperatingCostKpi').innerText(), '$18,000.00');
    assert.equal(await page.locator('#commandCenterOperatingProfitKpi').innerText(),
      '$4,800.00–$7,500.00');
    assert.equal(await page.locator('#commandCenterOperatingMarginKpi').innerText(),
      '18.82%–29.41%');
    assert.ok(await page.locator('#commandCenterOperatingProfitGraphPlot > *').count() >= 7);
    assert.match(await page.locator('#commandCenterOperatingProfitGraphDescription').textContent(),
      /2026-10: \$2,788\.00 to \$4,420\.00/);
    assert.match(await page.locator('#commandCenterOperatingProfitExplanation').innerText(),
      /Dated overhead and financing cash stay outside profit/);
    assert.match(await page.locator('#commandCenterOperatingProfitBoundary').innerText(),
      /Company overhead cash, financing cash, earned revenue, invoices, collections, and actual payment remain distinct/);
    const inspection = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: Array.from(document.querySelectorAll('body *')).map(node => {
        const rect = node.getBoundingClientRect();
        return { id: node.id, className: String(node.className?.baseVal || node.className || ''),
          left: rect.left, right: rect.right };
      }).filter(value => value.left < 0 || value.right > document.documentElement.clientWidth),
      busy: document.getElementById('commandCenterOperatingProfit').getAttribute('aria-busy'),
      motion: Array.from(document.querySelectorAll('#commandCenterOperatingProfit *')).map(node => {
        const style = getComputedStyle(node);
        return { id: node.id, className: String(node.className?.baseVal || node.className || ''),
          animationDuration: style.animationDuration,
          transitionDuration: style.transitionDuration };
      }).filter(value => parseFloat(value.animationDuration) > 0.001 ||
        parseFloat(value.transitionDuration) > 0.001),
      svgRole: document.getElementById('commandCenterOperatingProfitGraph').getAttribute('role'),
      labelledBy: document.getElementById('commandCenterOperatingProfitGraph')
        .getAttribute('aria-labelledby'),
      contrast: ['commandCenterOperatingProfitTitle', 'commandCenterOperatingCostKpi',
        'commandCenterOperatingProfitKpi', 'commandCenterOperatingMarginKpi',
        'commandCenterOperatingProfitExplanation', 'commandCenterOperatingProfitBoundary']
        .map(id => {
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
          const foregroundValue = luminance(getComputedStyle(node).color);
          const backgroundValue = luminance(background ? getComputedStyle(background).backgroundColor :
            'rgb(255, 255, 255)');
          return { id, ratio: (Math.max(foregroundValue, backgroundValue) + 0.05) /
            (Math.min(foregroundValue, backgroundValue) + 0.05) };
        }),
    }));
    assert.equal(inspection.scrollWidth, inspection.clientWidth, JSON.stringify(inspection.offenders));
    assert.equal(inspection.busy, 'false'); assert.deepEqual(inspection.motion, []);
    assert.equal(inspection.svgRole, 'img');
    assert.equal(inspection.labelledBy,
      'commandCenterOperatingProfitGraphTitle commandCenterOperatingProfitGraphDescription');
    assert.ok(inspection.contrast.every(value => value.ratio >= 4.5),
      JSON.stringify(inspection.contrast));
    const announcement = await page.evaluate(() => window.__announcements.at(-1));
    assert.match(announcement, /Operating cost \$18,000\.00/);
    assert.match(announcement, /Margin range 18\.82%–29\.41%/);
    assert.deepEqual(errors, []);
    const name = [scenario.mode, scenario.size, scenario.theme].join('-');
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    result.cases.push({ name, fullPage: true, paidDemoIsolation: true,
      staleValuesCleared: true, exactRecovery: true,
      keyboardAndFocus: true, statusAndGraphAccessible: true,
      reducedMotion: true, noHorizontalOverflow: true, pass: true });
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
        viewport: size === 'mobile' ? { width: 390, height: 844 } :
          { width: 1440, height: 1000 } });
    }
    for (const scenario of scenarios) await exercise(browser, scenario, result);
    assert.equal(result.cases.length, 8); result.pass = true;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
