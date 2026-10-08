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
  await page.addScriptTag({ path: path.resolve('public/js/command-center-resource-risk-outlook.js') });
  await page.evaluate(mode => {
    window.__calls = []; window.__responses = []; window.__announcements = [];
    window.__authority = { tenantId: mode === 'demo' ? 'tenant-demo-browser' : 'tenant-paid-browser',
      role: mode === 'demo' ? 'viewer' : 'owner', mode, fictional: mode === 'demo' };
    const status = document.getElementById('commandCenterResourceStatus');
    new MutationObserver(() => {
      if (window.__announcements.at(-1) !== status.textContent) {
        window.__announcements.push(status.textContent);
      }
    }).observe(status, { childList: true, characterData: true, subtree: true });
    window.__resource = NorthStarResourceRiskOutlook.create({ document, mode,
      fetcher: async (url, options) => {
        window.__calls.push({ url, method: options.method, cache: options.cache });
        const response = window.__responses.shift();
        if (!response) throw new Error('Unexpected request');
        if (response.hold) await new Promise(resolve => { window.__releaseResource = resolve; });
        return { ok: response.status >= 200 && response.status < 300,
          json: async () => response.payload };
      } });
  }, scenario.mode);
  return { context, page, errors };
}

async function statusIsExposed(context, page) {
  const status = page.locator('#commandCenterResourceStatus');
  assert.equal(await status.getAttribute('role'), 'status');
  assert.equal(await status.getAttribute('aria-live'), 'polite');
  assert.equal(await status.getAttribute('aria-atomic'), 'true');
  if (engine === 'chrome') {
    const session = await context.newCDPSession(page);
    const root = await session.send('DOM.getDocument');
    const target = await session.send('DOM.querySelector', {
      nodeId: root.root.nodeId, selector: '#commandCenterResourceStatus',
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
    const details = page.locator('#commandCenterResourceDetails');
    const summary = details.locator('summary');
    assert.equal(await details.getAttribute('open'), null);
    await summary.focus(); assert.equal(await summary.evaluate(n => document.activeElement === n), true);
    await summary.press('Enter'); assert.notEqual(await details.getAttribute('open'), null);
    assert.equal(await summary.evaluate(n => document.activeElement === n), true);
    await statusIsExposed(context, page);
    if (scenario.mode === 'demo') {
      await page.evaluate(() => window.__resource.workspaceReady(window.__authority));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.equal(await page.locator('#commandCenterResourceState').innerText(), 'Fictional example');
      await page.evaluate(() => window.__resource.workspaceUnavailable());
      assert.equal(await page.locator('#commandCenterResourceState').innerText(), 'Workspace unavailable');
      assert.equal(await page.locator('#commandCenterResourceGraphBars').innerHTML(), '');
      assert.equal(await page.locator('#commandCenterResourceAssetValue').innerText(), 'Not available');
      await page.evaluate(() => window.__resource.workspaceReady(window.__authority));
      assert.equal(await page.locator('#commandCenterResourceState').innerText(), 'Fictional example');
    } else {
      const bundle = await page.evaluate(() => {
        const value = NorthStarResourceRiskOutlook.demoBundle();
        value.material.fictional = false; value.asset.fictional = false; value.route.fictional = false;
        return value;
      });
      await page.evaluate(data => {
        window.__responses.push(
          { status: 200, payload: { success: true, data: data.material }, hold: true },
          { status: 200, payload: { success: true, data: data.asset } },
          { status: 200, payload: { success: true, data: data.route } });
        document.getElementById('commandCenterResourceAuthority').textContent = 'private stale tenant';
        window.__pending = window.__resource.workspaceReady(window.__authority);
      }, bundle);
      assert.equal(await page.locator('#commandCenterResourceMaterialValue').innerText(), 'Not available');
      assert.equal(await page.locator('#commandCenterResourceGraphBars').innerHTML(), '');
      assert.doesNotMatch(await page.locator('#commandCenterResourceAuthority').innerText(), /private stale tenant/);
      await page.evaluate(() => window.__releaseResource()); await page.evaluate(() => window.__pending);
      assert.equal(await page.locator('#commandCenterResourceState').innerText(), 'Current');
      await page.evaluate(data => {
        const asset = JSON.parse(JSON.stringify(data.asset));
        const reason = 'current_adopted_equipment_composition_unavailable';
        asset.state = 'unavailable'; asset.reason = reason; asset.sources = null; asset.assets = null;
        Object.keys(asset.sourceCoverage).forEach(key => {
          if (!['state', 'completeAsOf', 'hasMore', 'reason'].includes(key)) asset.sourceCoverage[key] = null;
        });
        Object.assign(asset.sourceCoverage, { state: 'unavailable', completeAsOf: false,
          hasMore: null, reason });
        Object.keys(asset.evidence).forEach(key => { asset.evidence[key] = false; });
        asset.learnedOutcomes = { state: 'unavailable', applicableValueCount: null,
          applied: false, reason };
        asset.run.sourceDigest = null; asset.run.digest = null;
        Object.keys(asset).filter(key => /ForecastIssued$/.test(key) || key === 'forecastIssued')
          .forEach(key => { asset[key] = false; });
        asset.utilization = { state: 'unavailable', assetCount: null, useCount: null,
          claimedOperatingHours: null, operatingTimeVerified: false, checkoutDurationUsed: false, reason };
        window.__responses.push(
          { status: 200, payload: { success: true, data: data.material } },
          { status: 200, payload: { success: true, data: asset } },
          { status: 200, payload: { success: true, data: data.route } });
        return window.__resource.workspaceReady(window.__authority);
      }, bundle);
      assert.equal(await page.locator('#commandCenterResourceState').innerText(), 'Partial');
      assert.equal(await page.locator('#commandCenterResourceAssetValue').innerText(), 'Not available');
      assert.equal(await page.locator('#commandCenterResourceGraphBars > *').count(), 2);
      assert.match(await page.locator('#commandCenterResourceAssetContext').innerText(),
        /current_adopted_equipment_composition_unavailable/);
      assert.match(await page.locator('#commandCenterResourceAssetDetails').innerText(),
        /Coverage complete As Of\s+No/i);
      await page.evaluate(data => {
        data.material.sources[0].materialPlan.digest = 'f'.repeat(64);
        window.__responses.push(
          { status: 200, payload: { success: true, data: data.material } },
          { status: 200, payload: { success: true, data: data.asset } },
          { status: 200, payload: { success: true, data: data.route } });
        return window.__resource.workspaceReady(window.__authority);
      }, bundle);
      assert.equal(await page.locator('#commandCenterResourceState').innerText(), 'Current');
      assert.equal(await page.evaluate(() => window.__calls.length), 9);
    }
    assert.equal(await page.locator('#commandCenterResourceMaterialValue').innerText(), '2 material groups');
    assert.equal(await page.locator('#commandCenterResourceAssetValue').innerText(), '1 asset · 2 claimed h');
    assert.equal(await page.locator('#commandCenterResourceRouteValue').innerText(), '1 route line');
    assert.equal(await page.locator('#commandCenterResourceGraphBars > *').count(), 3);
    assert.match(await page.locator('#commandCenterResourceMaterialDetails').innerText(), /110 ft/);
    assert.match(await page.locator('#commandCenterResourceMaterialDetails').innerText(), /24 ea/);
    assert.match(await page.locator('#commandCenterResourceRouteDetails').innerText(),
      /40 mi declared vehicle-leg distance/);
    const authorityText = await page.locator('#commandCenterResourceAuthority').innerText();
    assert.match(authorityText, scenario.mode === 'demo'
      ? /Authenticated tenant\s+tenant-demo-browser[\s\S]*Authenticated role\s+viewer/
      : /Authenticated tenant\s+tenant-paid-browser[\s\S]*Authenticated role\s+owner/);
    const materialText = await page.locator('#commandCenterResourceMaterialDetails').innerText();
    const assetText = await page.locator('#commandCenterResourceAssetDetails').innerText();
    const routeText = await page.locator('#commandCenterResourceRouteDetails').innerText();
    assert.match(materialText, /Checked at\s+2026-10-08T12:00:00.000Z/i);
    assert.match(materialText, /Source as of\s+2026-10-08T12:00:01.000Z/i);
    assert.match(materialText, /Coverage complete As Of\s+Yes/i);
    assert.match(materialText, /Coverage has More\s+No/i);
    assert.match(materialText, /Coverage component Line Count\s+2/i);
    assert.match(materialText, /Business time zone\s+America\/New_York/i);
    assert.match(materialText, /Assignment id\s+10000000-0000-4000-8000-000000000002/i);
    assert.match(materialText, /Booking confirmation id\s+10000000-0000-4000-8000-000000000004/i);
    assert.match(materialText, /Composition id\s+10000000-0000-4000-8000-000000000008/i);
    assert.match(materialText, /Material Plan id\s+10000000-0000-4000-8000-000000000009/i);
    assert.match(materialText, /Exact unit\s+(ft|ea)/i);
    assert.match(assetText, /Equipment Plan id\s+10000000-0000-4000-8000-000000000023/i);
    assert.match(assetText, /Readiness Plan evidence Digest\s+8{64}/i);
    assert.match(assetText, /Meter event Revision\s+2/i);
    assert.match(assetText, /Meter reset Applied\s+Yes/i);
    assert.match(assetText, /Meter correction Applied\s+No/i);
    assert.match(assetText, /Claimed operating hours exact unit\s+hours/i);
    assert.match(routeText, /Travel Plan source Digest\s+4{64}/i);
    assert.match(routeText, /Trip id\s+10000000-0000-4000-8000-000000000037/i);
    assert.match(routeText, /Route origin Digest\s+6{64}/i);
    assert.match(routeText, /Movement reason\s+movement_class_unavailable/i);
    assert.match(routeText, /Resource reason\s+resource_identity_unavailable/i);
    assert.match(routeText, /Declared distance unit\s+mi/i);
    if (scenario.mode === 'paid') {
      assert.match(materialText, new RegExp('Material Plan digest\\s+' + 'f'.repeat(64), 'i'));
      assert.doesNotMatch(materialText, new RegExp('Material Plan digest\\s+' + 'c'.repeat(64), 'i'));
    }
    assert.match(await page.locator('#commandCenterResourceBoundary').innerText(),
      /Demand is not inventory.*Planned hours are not actual meter time.*Declared distance is not verified mileage/);
    const inspection = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: Array.from(document.querySelectorAll('body *')).map(node => {
        const rect = node.getBoundingClientRect();
        return { id: node.id, left: rect.left, right: rect.right };
      }).filter(value => value.left < 0 || value.right > document.documentElement.clientWidth),
      busy: document.getElementById('commandCenterResourceOutlook').getAttribute('aria-busy'),
      motion: Array.from(document.querySelectorAll('#commandCenterResourceOutlook *')).map(node => {
        const style = getComputedStyle(node);
        return { id: node.id, animationDuration: style.animationDuration,
          transitionDuration: style.transitionDuration };
      }).filter(value => parseFloat(value.animationDuration) > 0.001 ||
        parseFloat(value.transitionDuration) > 0.001),
      graphRole: document.getElementById('commandCenterResourceGraph').getAttribute('role'),
      labelledBy: document.getElementById('commandCenterResourceGraph').getAttribute('aria-labelledby'),
      contrast: ['commandCenterResourceTitle', 'commandCenterResourceMaterialValue',
        'commandCenterResourceAssetValue', 'commandCenterResourceRouteValue',
        'commandCenterResourceExplanation', 'commandCenterResourceBoundary'].map(id => {
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
      'commandCenterResourceGraphTitle commandCenterResourceGraphDescription');
    assert.ok(inspection.contrast.every(value => value.ratio >= 4.5),
      JSON.stringify(inspection.contrast));
    assert.match(await page.evaluate(() => window.__announcements.at(-1)),
      /Resource outlook current.*Material groups 2.*Assets 1.*Route lines 1/);
    assert.deepEqual(errors, []);
    const name = [scenario.mode, scenario.size, scenario.theme].join('-');
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    result.cases.push({ name, paidDemoIsolation: true, staleValuesCleared: true,
      partialFailureAndRecovery: true, exactUnitsAndBoundaries: true,
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
        viewport: size === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
    }
    for (const scenario of scenarios) await exercise(browser, scenario, result);
    assert.equal(result.cases.length, 8); result.pass = true;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
