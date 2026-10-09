'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm26-part11b-runs-browser-secret-20261009';
const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });
const D = character => character.repeat(64);
const ids = ['d0000000-0000-4000-8000-000000000021',
  'd0000000-0000-4000-8000-000000000022'];
function run(index, amount) {
  const character = index ? '3' : '2';
  const day = index ? '01' : '02';
  return { state: 'current', receipt: { version: 'm26-forecast-run-receipt-v2',
    id: ids[index], organizationId: '55555555-5555-4555-8555-555555555555',
    asOf: `2026-10-${day}T12:00:00.000Z`,
    createdAt: `2026-10-${day}T12:00:01.000Z`,
    settings: { revision: 1, digest: D('a') }, sourceSnapshotDigest: D('b'),
    reportingWindowDigest: D('c'), featureSetDigest: D('d'),
    algorithm: { key: 'retell_three_complete_month_mean',
      version: 'm26-retell-three-month-mean-v2', definitionDigest: D('e'),
      implementationDigest: D('f'), buildDigest: D('1') },
    calculationVersion: 'm26-retell-three-month-mean-v2',
    outputContractVersion: 'm26-forecast-output-v1',
    outputs: [{ targetKey: 'demand.inbound_leads', targetVersion: 'v1',
      outputDigest: D(character) }], supersedes: null, supersessionReason: null,
    inputDigest: D(character), resultDigest: D(character), digest: D(character) },
    values: [{ targetKey: 'demand.inbound_leads', targetVersion: 'v1',
      unit: { key: 'count', currency: null }, value: { kind: 'point', amount },
      outputDigest: D(character) }], currentness: { sourceCurrent: true,
      algorithmCurrent: true, settingsRecorded: true, refreshRequired: false },
    historyPosition: { latest: index === 0, superseded: false } };
}
const authority = { version: 'm26-forecast-settings-authority-v1',
  targets: [{ key: 'demand.inbound_leads', supportedGrains: ['month'] }],
  limits: { targets: 24, horizons: 12, periodsPerHorizon: 100 },
  automaticActionAuthorized: false };
const settings = { state: 'current', settings: { version: 'm26-forecast-settings-v1',
  organizationId: '55555555-5555-4555-8555-555555555555', revision: 1,
  effectiveAt: '2026-10-01T12:00:00.000Z', digest: D('a'),
  source: { kind: 'owner_reviewed', actorUserId: '66666666-6666-4666-8666-666666666666',
    supersedesDigest: null }, settings: { enabled: true,
    targets: ['demand.inbound_leads'], horizons: [{ grain: 'month', periods: 3 }],
    scenarioDisplay: 'deterministic_when_eligible', comparisonDisplay: 'prior',
    alertDelivery: 'off', actionPolicy: 'review_required' } }, authority,
  targetRegistrationProvenByPreference: false, algorithmPromotionProvenByPreference: false,
  sourceAuthorityProvenByPreference: false, intervalCalibrationProvenByPreference: false,
  actualFinalityProvenByPreference: false, issuanceEligibilityProvenByPreference: false,
  forecastIssued: false, calibratedRangeIssued: false, automaticActionAuthorized: false };
const demoRuntimeScript = `(function(){
  var active=location.pathname.indexOf('/demo/')===0;
  if(!active){window.NorthStarDemoRuntime={active:false};return;}
  function workspace(action,expired,lifetime){return {
    session:{id:'demo-run-session',expiresAt:new Date(Date.now()+(expired?-1000:(lifetime||60000))).toISOString()},
    integrity:{revision:action==='demo_reset'?2:1,digest:'9'.repeat(64),lastAction:action||'demo_loaded'}
  };}
  var current=workspace('demo_loaded',false,4000);
  window.NorthStarDemoRuntime={active:true,loadWorkspace:function(){return Promise.resolve(current);}};
  window.recoverForecastDemo=function(){current=workspace('demo_recovered',false);
    dispatchEvent(new CustomEvent('northstar:demo-workspace',{detail:current}));};
  window.resetForecastDemo=function(){current=workspace('demo_reset',false);
    dispatchEvent(new CustomEvent('northstar:demo-workspace',{detail:current}));};
})();`;

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
        height: viewport.height }, colorScheme: viewport.colorScheme, reducedMotion: 'reduce' });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === '/js/auth-session.js') return route.fulfill({
          contentType: 'application/javascript', body: `
            window.showToast=function(){};window.runCalls=[];window.runMode='empty';
            window.runs=${JSON.stringify([run(0, '0'), run(1, '21.5')])};
            window.NorthStarAccountSession={fetch:function(url,options){
              var method=(options&&options.method)||'GET';
              if(url==='/api/v1/forecast/settings')return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,data:${JSON.stringify(settings)}})}});
              if(url.indexOf('/api/v1/forecast/runs')===0){
                window.runCalls.push({url:url,method:method});
                if(window.runMode==='failure')return Promise.resolve({status:503,ok:false,json:function(){return Promise.resolve({error:{category:'FORECAST_RUN_UNAVAILABLE'}})}});
                if(window.runMode==='stale'&&method==='GET')return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,data:{state:'unavailable',reason:'source_or_algorithm_not_current',runs:null}})}});
                if(window.runMode==='settingsStale'&&method==='GET')return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,data:{state:'unavailable',reason:'settings_not_current',runs:null}})}});
                if(url.indexOf('/compare/')>=0)return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,data:{state:'input_changed',leftRunId:window.runs[1].receipt.id,rightRunId:window.runs[0].receipt.id,leftRunDigest:window.runs[1].receipt.digest,rightRunDigest:window.runs[0].receipt.digest,sameInputs:false,sameResults:false,digest:'4'.repeat(64)}})}});
                if(url.indexOf('/controlled-rerun')>=0)return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,data:{state:'reproduced',runId:window.runs[0].receipt.id,runDigest:window.runs[0].receipt.digest,storedResultDigest:window.runs[0].receipt.resultDigest,freshResultDigest:window.runs[0].receipt.resultDigest,sameResults:true,automaticActionAuthorized:false}})}});
                if(method==='POST'){window.runMode='history';return Promise.resolve({status:201,ok:true,json:function(){return Promise.resolve({success:true,data:window.runs[0]})}});}
                var list=window.runMode==='empty'?[]:window.runs;
                return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,data:{state:'current',runs:list}})}});
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
        if (url.pathname === '/js/demo-runtime.js') return route.fulfill({
          contentType: 'application/javascript', body: demoRuntimeScript,
        });
        if (url.pathname.startsWith('/js/') && !['/js/forecast-settings.js','/js/forecast-runs.js',
          '/js/theme.js'].includes(url.pathname)) {
          return route.fulfill({ contentType: 'application/javascript', body: '' });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: {} });
        return route.continue();
      });
      await page.goto(origin + '/dashboard/settings');
      await page.locator('#forecastRunsStatus').getByText('No forecast runs issued', { exact: true }).waitFor();
      assert.equal(await page.locator('#forecastRunMonth').inputValue(), '');
      assert.equal(await page.locator('#forecastRunCurrent').isHidden(), true);
      await page.locator('#forecastRunMonth').fill('2026-11');
      await page.locator('#issueForecastRun').click();
      await page.locator('#forecastRunsStatus').getByText('Forecast run receipts are current', { exact: true }).waitFor();
      assert.equal(await page.locator('#forecastRunValue').textContent(), '0');
      assert.match(await page.locator('#forecastRunCurrent').innerText(), /Point forecast · count/);
      assert.doesNotMatch(await page.locator('#forecast-runs').innerText(), /confidence percent|automatic action authorized/i);
      await page.locator('#rerunForecastRun').click();
      await page.locator('#forecastRerunResult').getByText(/Reproduced from retained authorized inputs/).waitFor();
      await page.locator('#compareForecastRuns').click();
      await page.locator('#forecastRunComparison').getByText(/Input changed/).waitFor();
      if (viewport.name === 'desktop-light') {
        await page.evaluate(() => { window.runMode = 'stale'; });
        await page.locator('#refreshForecastRuns').click();
        await page.locator('#forecastRunsStatus').getByText('Forecast run evidence unavailable', { exact: true }).waitFor();
        assert.equal(await page.locator('#forecastRunCurrent').isHidden(), true);
        assert.equal(await page.locator('#forecastRunHistory').innerText(), '');
        assert.equal(await page.locator('#forecastRunComparison').innerText(), '');
        await page.evaluate(() => { window.runMode = 'history'; });
        await page.locator('#refreshForecastRuns').click();
        await page.locator('#forecastRunsStatus').getByText('Forecast run receipts are current', { exact: true }).waitFor();
        await page.evaluate(() => { window.runMode = 'settingsStale'; });
        await page.locator('#refreshForecastRuns').click();
        await page.locator('#forecastRunsDetail').getByText(/Forecast settings changed/).waitFor();
        assert.equal(await page.locator('#forecastRunCurrent').isHidden(), true);
        assert.equal(await page.locator('#forecastRunHistory').innerText(), '');
        await page.evaluate(() => { window.runMode = 'history'; });
        await page.locator('#refreshForecastRuns').click();
        await page.locator('#forecastRunsStatus').getByText('Forecast run receipts are current', { exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('#forecast-runs').screenshot({ path: path.join(output, `${viewport.name}-paid.png`) });
      await context.close();
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage(); const requests = [], errors = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/js/demo-runtime.js*', route => route.fulfill({
      contentType: 'application/javascript', body: demoRuntimeScript,
    }));
    await page.goto(origin + '/demo/settings');
    await page.locator('#forecastRunsStatus').getByText('Fictional forecast receipts', { exact: true }).waitFor();
    assert.match(await page.locator('#forecast-runs').innerText(), /isolated demo uses synthetic evidence/i);
    assert.equal(requests.some(value => value.startsWith('/api/v1/forecast/runs')), false);
    assert.equal(requests.some(value => value.startsWith('/api/v1/forecast/settings')), false);
    await page.locator('#compareForecastRuns').click();
    await page.locator('#forecastRunComparison').getByText(/fictional reporting window/).waitFor();
    await page.locator('#forecastRunsStatus').getByText('Fictional forecast receipts expired', { exact: true }).waitFor();
    assert.equal(await page.locator('#forecastRunCurrent').isHidden(), true);
    assert.equal(await page.locator('#forecastRunHistory').innerText(), '');
    assert.equal(await page.locator('#forecastRunComparison').innerText(), '');
    assert.equal(await page.locator('#forecastRunDigest').innerText(), '');
    assert.equal(await page.locator('#forecastRunOutputDigest').innerText(), '');
    await page.evaluate(() => window.recoverForecastDemo());
    await page.locator('#forecastRunsStatus').getByText('Fictional forecast receipts', { exact: true }).waitFor();
    assert.equal(await page.locator('#forecastRunValue').textContent(), '19');
    await page.locator('#compareForecastRuns').click();
    await page.locator('#forecastRunComparison').getByText(/fictional reporting window/).waitFor();
    await page.evaluate(() => window.resetForecastDemo());
    assert.equal(await page.locator('#forecastRunComparison').innerText(), '');
    assert.equal(await page.locator('#forecastRunValue').textContent(), '19');
    assert.deepEqual(errors, []);
    assert.equal(requests.some(value => value.startsWith('/api/v1/forecast/runs')), false);
    assert.equal(requests.some(value => value.startsWith('/api/v1/forecast/settings')), false);
    await page.locator('#forecast-runs').screenshot({ path: path.join(output, 'mobile-demo.png') });
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
