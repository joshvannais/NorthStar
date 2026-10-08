'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm26-part11a-settings-browser-secret-20261008';
const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });

const digest = 'a'.repeat(64);
const proof = { sourceAuthority: false, targetRegistration: false,
  algorithmPromotion: false, intervalCalibration: false, actualFinality: false,
  issuanceEligibility: false };
const authority = { version: 'm26-forecast-settings-authority-v1',
  targets: [{ key: 'demand.inbound_leads', label: 'Inbound leads',
    definitionVersion: 'v1', unit: 'count', sourceScope: 'retell_only_tenant_all',
    algorithmKey: 'retell_three_complete_month_mean',
    algorithmVersion: 'm26-retell-three-month-mean-v2',
    algorithmDefinitionDigest: 'b'.repeat(64), implementationDigest: 'c'.repeat(64),
    supportedGrains: ['month'] }],
  limits: { targets: 24, horizons: 12, periodsPerHorizon: 100 },
  preferenceProves: proof, automaticActionAuthorized: false };
const off = { enabled: false, targets: [], horizons: [], scenarioDisplay: 'withhold',
  comparisonDisplay: 'none', alertDelivery: 'off', actionPolicy: 'review_required' };
const stale = { state: 'unavailable',
  reason: 'selected_target_algorithm_or_source_authority_changed', settings: null, authority,
  targetRegistrationProvenByPreference: false,
  algorithmPromotionProvenByPreference: false,
  sourceAuthorityProvenByPreference: false,
  intervalCalibrationProvenByPreference: false,
  actualFinalityProvenByPreference: false,
  issuanceEligibilityProvenByPreference: false,
  forecastIssued: false, calibratedRangeIssued: false,
  automaticActionAuthorized: false };
function data(settings, revision, kind) {
  return { state: 'current', settings: { version: 'm26-forecast-settings-v1',
    organizationId: '55555555-5555-4555-8555-555555555555', revision,
    effectiveAt: revision ? '2026-10-08T12:00:00.000Z' : null,
    source: { kind, actorUserId: revision ?
      '66666666-6666-4666-8666-666666666666' : null,
    supersedesDigest: null }, settings, digest }, authority,
  targetRegistrationProvenByPreference: false,
  algorithmPromotionProvenByPreference: false,
  sourceAuthorityProvenByPreference: false,
  intervalCalibrationProvenByPreference: false,
  actualFinalityProvenByPreference: false,
  issuanceEligibilityProvenByPreference: false,
  forecastIssued: false, calibratedRangeIssued: false,
  automaticActionAuthorized: false };
}

async function main() {
  const app = require('../../src/server').app;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = resolveBrowserRuntime(process.argv.includes('--webkit') ? 'webkit' : 'chrome');
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  try {
    for (const viewport of [
      { name: 'desktop-light', width: 1280, height: 900, colorScheme: 'light' },
      { name: 'mobile-light', width: 390, height: 844, colorScheme: 'light' },
      { name: 'desktop-dark', width: 1280, height: 900, colorScheme: 'dark' },
      { name: 'mobile-dark', width: 390, height: 844, colorScheme: 'dark' },
    ]) {
      const context = await browser.newContext({ viewport: { width: viewport.width,
        height: viewport.height }, reducedMotion: 'reduce', colorScheme: viewport.colorScheme });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/js/auth-session.js') return route.fulfill({
          contentType: 'application/javascript', body: `
            window.showToast=function(){}; window.forecastSettingCalls=[];
            window.forecastSettingsMode='current';
            window.NorthStarAccountSession={fetch:function(url,options){
              if(url==='/api/v1/forecast/settings'){
                window.forecastSettingCalls.push({url:url,method:(options&&options.method)||'GET'});
                if(window.forecastSettingsMode==='failure') return Promise.resolve({status:503,ok:false,json:function(){return Promise.resolve({})}});
                if(window.forecastSettingsMode==='stale') return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,data:${JSON.stringify(stale)}})}});
                if(options&&options.method==='POST') return Promise.resolve({status:201,ok:true,json:function(){return Promise.resolve({success:true,data:${JSON.stringify(data({ ...off, enabled: true, targets: ['demand.inbound_leads'], horizons: [{ grain: 'month', periods: 2 }], scenarioDisplay: 'deterministic_when_eligible' }, 1, 'owner_reviewed'))}})}});
                return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,data:${JSON.stringify(data(off, 0, 'system_default'))}})}});
              }
              return Promise.resolve({status:503,ok:false,json:function(){return Promise.resolve({})}});
            }};`,
        });
        if (url.pathname === '/js/nav-component.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.NavComponent={init:function(){}};',
        });
        if (url.pathname === '/js/workspace-form-state.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.NorthStarFormState={create:function(){return {}}};',
        });
        if (url.pathname === '/js/api.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.showToast=function(){};',
        });
        if (url.pathname.startsWith('/js/') && url.pathname !== '/js/forecast-settings.js' &&
            url.pathname !== '/js/demo-runtime.js' && url.pathname !== '/js/theme.js') {
          return route.fulfill({ contentType: 'application/javascript', body: '' });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: {} });
        return route.continue();
      });
      await page.goto(origin + '/dashboard/settings');
      await page.locator('#forecastSettingsStatus').getByText('Forecast planning is off',
        { exact: true }).waitFor();
      assert.equal(await page.locator('#forecastHorizonWeek').isDisabled(), true);
      assert.equal(await page.locator('#forecastHorizonQuarter').isDisabled(), true);
      await page.locator('#forecastSettingsEnabled').check();
      await page.locator('#forecastHorizonMonth').fill('2');
      await page.locator('#forecastScenarioDisplay').selectOption('deterministic_when_eligible');
      await page.locator('#saveForecastSettings').click();
      await page.locator('#forecastSettingsStatus').getByText('Forecast preferences recorded',
        { exact: true }).waitFor();
      const panel = await page.locator('#forecast-settings').innerText();
      assert.match(panel, /do not prove source coverage/i);
      assert.match(panel, /Automatic action is never allowed/i);
      assert.doesNotMatch(panel, /forecast issued|[0-9]+% confidence/i);
      assert.deepEqual(await page.evaluate(() => window.forecastSettingCalls.map(item => item.method)),
        ['GET', 'POST']);
      if (viewport.name === 'desktop-light') {
        await page.evaluate(() => { window.forecastSettingsMode = 'failure'; });
        await page.locator('#refreshForecastSettings').click();
        await page.locator('#forecastSettingsStatus').getByText('Forecast settings unavailable',
          { exact: true }).waitFor();
        assert.equal(await page.locator('#forecastSettingsReceipt').textContent(), '');
        assert.equal(await page.locator('#forecastSettingsEnabled').isChecked(), false);
        assert.equal(await page.locator('#forecastHorizonMonth').inputValue(), '');
        await page.evaluate(() => { window.forecastSettingsMode = 'stale'; });
        await page.locator('#refreshForecastSettings').click();
        await page.locator('#forecastSettingsDetail')
          .getByText(/source permission is no longer current/i).waitFor();
        assert.equal(await page.locator('#forecastSettingsReceipt').textContent(), '');
        await page.evaluate(() => { window.forecastSettingsMode = 'current'; });
        await page.locator('#refreshForecastSettings').click();
        await page.locator('#forecastSettingsStatus').getByText('Forecast planning is off',
          { exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('#forecast-settings').screenshot({ path: path.join(output,
        `${viewport.name}-paid.png`) });
      await context.close();
    }

    const demoContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const demoPage = await demoContext.newPage();
    const requests = [], errors = [];
    demoPage.on('request', value => requests.push(new URL(value.url()).pathname));
    demoPage.on('pageerror', error => errors.push(error.message));
    await demoPage.goto(origin + '/demo/settings');
    await demoPage.locator('#forecastSettingsStatus')
      .getByText('Forecast planning is off in this fictional workspace', { exact: true }).waitFor();
    const demo = await demoPage.locator('#forecast-settings').innerText();
    assert.match(demo, /isolated demo saves nothing to a paid account/i);
    assert.match(demo, /Fictional demo · no paid settings receipt/);
    assert.equal(requests.some(value => value.startsWith('/api/v1/forecast/settings')), false);
    await demoPage.reload();
    await demoPage.locator('#forecastSettingsStatus')
      .getByText('Forecast planning is off in this fictional workspace', { exact: true }).waitFor();
    assert.equal(requests.some(value => value.startsWith('/api/v1/forecast/settings')), false);
    assert.deepEqual(errors, []);
    await demoContext.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
