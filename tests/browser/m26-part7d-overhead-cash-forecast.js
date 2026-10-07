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
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(dashboard, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ styles, theme }) => {
    const style = document.createElement('style'); style.textContent = styles;
    document.head.append(style); document.documentElement.dataset.theme = theme;
  }, { styles, theme: scenario.theme });
  await page.waitForFunction(() => getComputedStyle(document.body).margin === '0px' &&
    document.body.getBoundingClientRect().left === 0);
  await page.addScriptTag({ path: path.resolve('public/js/command-center-overhead-cash-forecast.js') });
  await page.evaluate(mode => {
    window.__calls = []; window.__responses = []; window.__announcements = [];
    new MutationObserver(function () {
      var status = document.getElementById('commandCenterOverheadCashForecastStatus');
      var message = status ? status.textContent : '';
      if (window.__announcements.at(-1) !== message) window.__announcements.push(message);
    }).observe(document.getElementById('commandCenterOverheadCashForecastStatus'),
      { childList: true, characterData: true, subtree: true });
    window.__forecast = NorthStarOverheadCashForecast.create({ document, mode,
      fetcher: async (url, options) => {
        window.__calls.push({ url, method: options.method, cache: options.cache });
        var response = window.__responses.shift();
        if (!response) throw new Error('Unexpected request');
        if (response.hold) await new Promise(resolve => { window.__releaseForecast = resolve; });
        return { ok: response.status >= 200 && response.status < 300,
          json: async () => response.payload };
      } });
  }, scenario.mode);
  return { context, page, errors };
}

async function assertStatusAccessibility(context, page) {
  const locator = page.locator('#commandCenterOverheadCashForecastStatus');
  await locator.waitFor();
  assert.equal(await locator.getAttribute('role'), 'status');
  assert.equal(await locator.getAttribute('aria-live'), 'polite');
  assert.equal(await locator.getAttribute('aria-atomic'), 'true');
  if (engine === 'chrome') {
    const session = await context.newCDPSession(page);
    const documentNode = await session.send('DOM.getDocument');
    const target = await session.send('DOM.querySelector', {
      nodeId: documentNode.root.nodeId, selector: '#commandCenterOverheadCashForecastStatus',
    });
    const tree = await session.send('Accessibility.getPartialAXTree', {
      nodeId: target.nodeId, fetchRelatives: false,
    });
    const status = tree.nodes.find(node => node.role && node.role.value === 'status');
    assert.ok(status && status.ignored === false, 'Collapsed status must remain exposed');
  }
}

async function exercise(browser, scenario, result) {
  const { context, page, errors } = await pageFor(browser, scenario);
  try {
    const details = page.locator('#commandCenterCostRiskDetails');
    const summary = details.locator('summary');
    assert.equal(await details.getAttribute('open'), null);
    assert.equal(await page.locator('#commandCenterOverheadCashForecastContext').isVisible(), false,
      'Collapsed private detail must be visually hidden');
    await assertStatusAccessibility(context, page);
    await summary.focus();
    assert.equal(await summary.evaluate(node => document.activeElement === node), true);
    await summary.press('Enter');
    assert.notEqual(await details.getAttribute('open'), null);
    assert.equal(await summary.evaluate(node => document.activeElement === node), true);

    if (scenario.mode === 'demo') {
      await page.evaluate(() => window.__forecast.workspaceReady());
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.equal(await page.locator('#commandCenterOverheadCashForecast').innerText(),
        '$3,200.00 overhead + $1,150.00 dated asset cash');
    } else {
      const paid = await page.evaluate(() => {
        const value = NorthStarOverheadCashForecast.demoForecast(); value.fictional = false;
        value.overhead = { state: 'current', amount: '0.01', dueCount: 2,
          scheduleCount: 1, reason: null };
        value.financedAssetCash = { state: 'current', amount: '0.01', dueCount: 1,
          obligationCount: 1, ownerMarkedSatisfiedCount: 1, canceledCount: 1, reason: null };
        return value;
      });
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data }, hold: true });
        window.__pending = window.__forecast.workspaceReady();
      }, paid);
      assert.match(await page.locator('#commandCenterOverheadCashForecast').innerText(), /^Checking/);
      assert.equal(await page.locator('#commandCenterOverheadCashForecastContext').innerText(), '');
      await page.evaluate(() => window.__releaseForecast()); await page.evaluate(() => window.__pending);
      assert.equal(await page.locator('#commandCenterOverheadCashForecast').innerText(),
        '$0.01 overhead + $0.01 dated asset cash');
      await page.evaluate(() => {
        window.__responses.push({ status: 503, payload: { success: false } });
        return window.__forecast.workspaceReady();
      });
      assert.equal(await page.locator('#commandCenterOverheadCashForecast').innerText(), 'Not available');
      assert.doesNotMatch(await page.locator('#commandCenterOverheadCashForecastContext').innerText(), /\$0/);
      await page.evaluate(data => {
        window.__responses.push({ status: 200, payload: { success: true, data } });
        return window.__forecast.workspaceReady();
      }, paid);
      assert.equal(await page.locator('#commandCenterOverheadCashForecast').innerText(),
        '$0.01 overhead + $0.01 dated asset cash');
      assert.deepEqual(await page.evaluate(() => window.__calls), [
        { url: '/api/v1/forecast/overhead-cash/current', method: 'GET', cache: 'no-store' },
        { url: '/api/v1/forecast/overhead-cash/current', method: 'GET', cache: 'no-store' },
        { url: '/api/v1/forecast/overhead-cash/current', method: 'GET', cache: 'no-store' },
      ]);
    }
    const contextText = await page.locator('#commandCenterOverheadCashForecastContext').innerText();
    const renderedAmount = await page.locator('#commandCenterOverheadCashForecast').innerText();
    const announcement = await page.evaluate(() => window.__announcements.at(-1));
    assert.ok(announcement.includes(renderedAmount));
    if (scenario.mode === 'paid') {
      assert.equal(renderedAmount, '$0.01 overhead + $0.01 dated asset cash');
      assert.ok(announcement.includes('$0.01 overhead + $0.01 dated asset cash'));
    }
    assert.match(contextText, /complete covered owner-recorded source/);
    assert.match(contextText, /Owner-marked satisfied dates are not proof of payment/);
    assert.match(contextText, /Job-cost allocation and economic depreciation stay separate/);
    assert.equal(await page.locator('#commandCenterCostRiskOutlook .btn-primary').count(), 1);
    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      offenders: Array.from(document.querySelectorAll('body *')).map(element => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, id: element.id, className: String(element.className || ''),
          left: Math.round(rect.left * 100) / 100, right: Math.round(rect.right * 100) / 100,
          scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
      }).filter(item => item.left < 0 || item.right > document.documentElement.clientWidth),
    }));
    assert.equal(layout.scrollWidth, layout.clientWidth,
      `Horizontal overflow in ${scenario.mode}-${scenario.size}-${scenario.theme}: ${JSON.stringify(layout)}`);
    assert.deepEqual(errors, []);
    const name = [scenario.mode, scenario.size, scenario.theme].join('-');
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    result.cases.push({ name, fullPage: true, collapsedPrivateDetailHidden: true,
      statusExposedWhileCollapsed: true, keyboardFocusPreserved: true,
      exactRecovery: scenario.mode === 'paid', oneExistingAction: true,
      exactCentsPreserved: true, positiveCentCase: scenario.mode === 'paid',
      noHorizontalOverflow: true, layout, pass: true });
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
    assert.equal(result.cases.length, 8); result.pass = true;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
