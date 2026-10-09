'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm26-part12b-demo-journey-browser-20261009';
const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });
const D = value => value.repeat(64);
const runId = '11111111-1111-4111-8111-111111111111';
const originId = '22222222-2222-4222-8222-222222222222';
const nextOriginId = '33333333-3333-4333-8333-333333333333';
const org = '44444444-4444-4444-8444-444444444444';

function run() {
  return { id: runId, settings: { revision: 1, digest: D('1') },
    source: { positionId: '55555555-5555-4555-8555-555555555555',
      positionDigest: D('2'), sourceSnapshotDigest: D('3'), reportingWindowDigest: D('4'),
      featureSetDigest: D('5'), approvedPriceOriginId: originId, fictional: true },
    target: { key: 'revenue.approved_price_flow', definitionVersion: 'v1',
      semantic: 'future_human_approved_commercial_price_decisions' },
    horizon: { grain: 'month', startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z' },
    algorithm: { key: 'approved_price_carry_forward', version: 'm26-paid-approved-price-flow-v1',
      definitionDigest: D('6'), implementationDigest: D('7'), configurationDigest: D('8') },
    output: { predictionKind: 'deterministic_point', value: { amount: '2850.00' },
      unit: { key: 'money', currency: 'USD' }, uncertainty: { state: 'unquantified',
        calibratedIntervalAvailable: false }, fictional: true, digest: D('9') },
    explanation: { summary: 'This fictional example carries one exact approved price into the next review window.',
      sourceCoverage: 'One synthetic, account-free NorthStar demo estimate. It is not customer data.',
      uncertainty: 'Natural history and calibrated accuracy are unavailable.', customerSafe: true,
      advisoryOnly: true, fictional: true, digest: D('a') },
    receipt: { organizationId: org, digest: D('b'), fictional: true },
    currentness: { state: 'unchanged_candidate', revision: 1, digest: D('c'),
      adviceDisplayAuthorized: false, fictional: true },
    review: { receiverAvailability: 'unavailable', receiverReason: 'no_exact_receiving_adapter',
      receiverHref: null, history: [], advisoryOnly: true, receiverMutationCount: 0 },
    automaticActionAuthorized: false, outboundCommunicationAuthorized: false };
}
function envelope(state = 'ready', revision = 1, selectedOrigin = originId) {
  return { version: 'm26-paid-journey-v1', state, reason: null,
    run: state === 'current' ? run() : null,
    review: state === 'current' ? { availability: 'unavailable',
      reason: 'no_exact_receiving_adapter', requestReviewAvailable: true } : null,
    targetKey: 'revenue.approved_price_flow', syntheticImplementationEvidenceOnly: true,
    liveValidationAvailable: false, automaticActionAuthorized: false,
    fictionalDemo: true, accountFree: true, resettable: true, providerCallCount: 0,
    demoWorkspaceRevision: revision,
    sourceCandidate: state === 'ready' ? { approvedPriceOriginId: selectedOrigin,
      positionId: '77777777-7777-4777-8777-777777777777', positionDigest: D('d'),
      sourceSnapshotDigest: D('e'), capturedAt: '2026-10-09T17:00:00.000Z',
      cutoffAt: '2026-10-09T17:00:00.000Z', amount: '2850.00', currency: 'USD',
      label: 'Tree pruning · fictional approved-price example', fictional: true } : null };
}

const demoRuntime = `(function(){
  var current=${JSON.stringify(envelope())};
  window.demoForecastCalls=[];window.demoForecastMode='ok';window.demoResetCount=0;
  function reply(status,payload){return Promise.resolve({status:status,ok:status>=200&&status<300,
    json:function(){return Promise.resolve(payload);}});}
  window.NorthStarDemoRuntime={active:true,fetch:function(url,options){
    options=options||{};var method=options.method||'GET';
    window.demoForecastCalls.push({url:url,method:method,body:options.body,headers:options.headers});
    if(window.demoForecastMode==='failure')return reply(503,{});
    if(url==='/api/demo/forecast/journey'&&method==='GET')return reply(200,{success:true,data:current});
    if(url==='/api/demo/command-center/reset'){
      window.demoResetCount+=1;current=${JSON.stringify(envelope('ready', 1, nextOriginId))};
      return reply(200,{success:true,data:{integrity:{revision:1}}});
    }
    if(url==='/api/demo/forecast/journey/actions'){
      var sent=JSON.parse(options.body),action=sent.action;
      if(action==='issue'){current=${JSON.stringify(envelope('current', 2))};return reply(201,{success:true,data:current});}
      if(action==='rerun'){current.demoWorkspaceRevision=3;return reply(201,{success:true,data:{state:'reproduced',
        sameResults:true,storedOutputDigest:'${D('9')}',freshOutputDigest:'${D('9')}',
        fictionalDemo:true,providerCallCount:0,demoWorkspaceRevision:3}});}
      var history=current.run.review.history;
      if(action==='requested')history.push({revision:1,action:'requested',recordedAction:'requested',
        recordedAt:new Date().toISOString(),expiresAt:sent.details.expiresAt,digest:'${D('f')}'});
      else history.push({revision:2,action:'dismissed',recordedAction:'dismissed',
        recordedAt:new Date().toISOString(),expiresAt:sent.details.expiresAt,digest:'${D('0')}'});
      current.demoWorkspaceRevision=action==='requested'?4:5;
      return reply(201,{success:true,data:current});
    }
    return reply(503,{});
  },loadWorkspace:function(){dispatchEvent(new CustomEvent('northstar:demo-workspace'));
    return Promise.resolve({integrity:{revision:1}});}};
})();`;

async function main() {
  const app = require('../../src/server').app;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const runtime = resolveBrowserRuntime(process.argv.includes('--webkit') ? 'webkit' : 'chrome');
  const browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
  try {
    for (const viewport of [
      { name: 'desktop-light', width: 1280, height: 900, colorScheme: 'light' },
      { name: 'mobile-light', width: 390, height: 844, colorScheme: 'light' },
      { name: 'desktop-dark', width: 1280, height: 900, colorScheme: 'dark' },
      { name: 'mobile-dark', width: 390, height: 844, colorScheme: 'dark' },
    ]) {
      const context = await browser.newContext({ viewport: { width: viewport.width,
        height: viewport.height }, colorScheme: viewport.colorScheme, reducedMotion: 'reduce' });
      const page = await context.newPage(); const errors = []; const network = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => network.push(request.url()));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (url.pathname === '/js/demo-runtime.js') return route.fulfill({
          contentType: 'application/javascript', body: demoRuntime });
        if (url.pathname === '/js/auth-session.js') return route.fulfill({
          contentType: 'application/javascript',
          body: 'window.showToast=function(){};window.NorthStarAccountSession=undefined;' });
        if (url.pathname === '/js/nav-component.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.NavComponent={init:function(){}};' });
        if (url.pathname === '/js/workspace-form-state.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.NorthStarFormState={create:function(){return {}}};' });
        if (url.pathname === '/js/api.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.showToast=function(){};' });
        if (url.pathname.startsWith('/js/') &&
            !['/js/forecast-paid-journey.js','/js/demo-runtime.js','/js/theme.js'].includes(url.pathname)) {
          return route.fulfill({ contentType: 'application/javascript', body: '' });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: {} });
        return route.continue();
      });
      await page.goto(base + '/demo/settings');
      await page.locator('#forecastPaidJourneyStatus')
        .getByText('Fictional journey ready for review', { exact: true }).waitFor();
      assert.equal(await page.locator('#forecastPaidJourneyHeading').textContent(),
        'Fictional approved-price forecast journey');
      assert.equal(await page.locator('#forecastPaidOrigin').inputValue(), originId);
      assert.equal(await page.locator('#forecastPaidOrigin').isEditable(), false);
      assert.equal(await page.locator('#resetForecastPaidJourney').isVisible(), true);
      await page.locator('#issueForecastPaidJourney').focus(); await page.keyboard.press('Enter');
      await page.locator('#forecastPaidJourneyStatus')
        .getByText('Fictional approved-price journey is current', { exact: true }).waitFor();
      assert.equal(await page.locator('#forecastPaidJourneyValue').textContent(), '2850.00 USD');
      assert.equal(await page.locator('#forecastPaidJourneyReceipt').textContent(), D('b'));
      assert.equal(await page.locator('#forecastPaidJourneyOutput').textContent(), D('9'));
      const panel = await page.locator('#forecast-paid-journey').innerText();
      assert.match(panel, /synthetic, account-free NorthStar demo estimate/i);
      assert.match(panel, /No browser calculation, paid API, provider call, or receiving mutation occurred/i);
      assert.doesNotMatch(panel, /customer@example|\+1\d{10}|earned revenue|collected cash/i);
      assert.equal(await page.locator('#rerunForecastPaidJourney').isEnabled(), true);
      await page.locator('#rerunForecastPaidJourney').focus(); await page.keyboard.press('Enter');
      try {
        await page.locator('#forecastPaidJourneyReview')
          .getByText(/exact retained fictional inputs/i).waitFor({ timeout: 5000 });
      } catch (error) {
        const diagnostic = await page.evaluate(() => ({
          status: document.getElementById('forecastPaidJourneyStatus').textContent,
          review: document.getElementById('forecastPaidJourneyReview').textContent,
          calls: window.demoForecastCalls,
        }));
        throw new Error(error.message + '\nRerun state: ' + JSON.stringify(diagnostic) +
          '\nPage errors: ' + JSON.stringify(errors));
      }
      await page.locator('#reviewForecastPaidJourney').focus(); await page.keyboard.press('Enter');
      await page.locator('#forecastPaidJourneyHistory').getByText(/Revision 1 · requested/).waitFor();
      await page.locator('#forecastPaidJourneyHistory button').focus(); await page.keyboard.press('Enter');
      await page.locator('#forecastPaidJourneyHistory').getByText(/Revision 2 · dismissed/).waitFor();

      if (viewport.name === 'desktop-light') {
        await page.evaluate(() => { window.demoForecastMode = 'failure'; });
        await page.locator('#refreshForecastPaidJourney').focus(); await page.keyboard.press('Enter');
        await page.locator('#forecastPaidJourneyStatus')
          .getByText('Fictional forecast journey unavailable', { exact: true }).waitFor();
        assert.equal(await page.locator('#forecastPaidJourneyReceipt').textContent(), '');
        assert.equal(await page.locator('#forecastPaidJourneyOutput').textContent(), '');
        assert.equal(await page.locator('#forecastPaidJourneyHistory').innerText(), '');
        assert.equal(await page.locator('#forecastPaidJourneyCurrent').isHidden(), true);
        await page.evaluate(() => { window.demoForecastMode = 'ok'; });
        await page.locator('#refreshForecastPaidJourney').focus(); await page.keyboard.press('Enter');
        await page.locator('#forecastPaidJourneyStatus')
          .getByText('Fictional approved-price journey is current', { exact: true }).waitFor();
      }

      await page.locator('#resetForecastPaidJourney').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('#forecastPaidJourneyResetConfirm').isVisible(), true);
      await page.locator('#cancelForecastPaidJourneyReset').focus(); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#forecastPaidJourneyResetConfirm').isHidden(), true);
      await page.locator('#resetForecastPaidJourney').focus(); await page.keyboard.press('Enter');
      await page.locator('#confirmForecastPaidJourneyReset').focus(); await page.keyboard.press('Enter');
      await page.locator('#forecastPaidJourneyStatus')
        .getByText('Fictional journey ready for review', { exact: true }).waitFor();
      assert.equal(await page.locator('#forecastPaidOrigin').inputValue(), nextOriginId);
      assert.equal(await page.locator('#forecastPaidJourneyReceipt').textContent(), '');
      assert.equal(await page.locator('#forecastPaidJourneyHistory').innerText(), '');

      const calls = await page.evaluate(() => window.demoForecastCalls);
      assert.ok(calls.some(value => value.url === '/api/demo/forecast/journey'));
      assert.ok(calls.some(value => value.url === '/api/demo/command-center/reset'));
      assert.equal(calls.some(value => value.url.startsWith('/api/v1/')), false);
      assert.equal(network.some(value => !value.startsWith(base)), false);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('#forecast-paid-journey').screenshot({ path: path.join(output,
        `${viewport.name}-fictional.png`) });
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
