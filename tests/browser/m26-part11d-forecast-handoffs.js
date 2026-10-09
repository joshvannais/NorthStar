'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm26-part11d-handoffs-browser-secret-20261009';
const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });
const D = character => character.repeat(64);
const org = '55555555-5555-4555-8555-555555555555';
const user = '66666666-6666-4666-8666-666666666666';
const runId = '11111111-1111-4111-8111-111111111111';
const proposalId = '22222222-2222-4222-8222-222222222222';
const candidate = { runId, runDigest: D('a'), targetKey: 'demand.inbound_leads',
  targetVersion: 'v1', horizon: { grain: 'month', localStart: '2026-11-01' },
  outputDigest: D('b'), currentness: { revision: 2, digest: D('c') },
  recommendation: { type: 'review_demand_capacity',
    summary: 'Review staffing and schedule capacity for the saved inbound-lead forecast.',
    evidence: { predictionKind: 'point', amount: '0', unit: 'count',
      runDigest: D('a'), outputDigest: D('b') },
    uncertainty: { state: 'unquantified', drivers: ['retell_only','uncalibrated'] },
    missingInformation: ['calibrated_interval','current_capacity_record',
      'exact_receiving_record'],
    tradeoff: 'Reviewing capacity early may expose constraints, but no exact capacity record is proven.' },
  receiver: { mission: '22', workflow: 'calendar_capacity_review', recordId: null,
    expectedRevision: null, expectedDigest: null, availability: 'unavailable',
    reason: 'exact_receiving_record_not_available', href: null },
  advisoryOnly: true, navigationIsApproval: false,
  receiverRecheckRequired: true, automaticActionAuthorized: false };
function proposal(state = 'requested') {
  const dismissed = state === 'dismissed';
  const expired = state === 'expired';
  const history = [{ revision: 1, action: 'requested',
    recordedAt: '2026-10-09T12:00:01.000Z', actorUserId: user, digest: D('d') }];
  if (dismissed) history.push({ revision: 2, action: 'dismissed',
    recordedAt: '2026-10-09T12:00:02.000Z', actorUserId: user, digest: D('e') });
  return { version: 'm26-forecast-reviewed-handoff-v1', id: proposalId,
    state, revision: dismissed ? 2 : 1, organizationId: org,
    createdAt: '2026-10-09T12:00:01.000Z',
    expiresAt: expired ? '2026-10-09T12:30:01.000Z' : '2026-10-16T12:00:01.000Z',
    reviewer: { userId: user, accessRole: 'owner' },
    run: { id: runId, digest: D('a'), targetKey: 'demand.inbound_leads',
      targetVersion: 'v1', horizon: candidate.horizon, outputDigest: D('b'),
      currentnessRevision: 2, currentnessDigest: D('c') },
    recommendation: { type: candidate.recommendation.type,
      evidence: candidate.recommendation.evidence,
      uncertainty: candidate.recommendation.uncertainty,
      missingInformation: candidate.recommendation.missingInformation,
      tradeoff: candidate.recommendation.tradeoff },
    receiver: candidate.receiver, history, advisoryOnly: true,
    navigationIsApproval: false, receiverRecheckRequired: true,
    automaticActionAuthorized: false, outboundCommunicationAuthorized: false,
    proposalDigest: D('f'), digest: dismissed ? D('2') : D('1') };
}
function envelope(proposals = []) {
  return { version: 'm26-forecast-reviewed-handoff-v1', state: 'current',
    reason: null, candidate, proposals, automaticActionAuthorized: false,
    outboundCommunicationAuthorized: false };
}
const demoRuntimeScript = `(function(){
  var active=location.pathname.indexOf('/demo/')===0;
  if(!active){window.NorthStarDemoRuntime={active:false};return;}
  function workspace(action,lifetime){return {session:{id:'demo-handoff-session',
    expiresAt:new Date(Date.now()+(lifetime||3500)).toISOString()},integrity:{revision:1,
    digest:'9'.repeat(64),lastAction:action||'demo_loaded'}};}
  var current=workspace('demo_loaded',3500);
  window.NorthStarDemoRuntime={active:true,loadWorkspace:function(){return Promise.resolve(current);}};
  window.recoverHandoffDemo=function(){current=workspace('demo_recovered',60000);
    dispatchEvent(new CustomEvent('northstar:demo-workspace',{detail:current}));};
  window.resetHandoffDemo=function(){current=workspace('demo_reset',60000);
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
            window.showToast=function(){};window.handoffCalls=[];window.handoffMode='current';
            window.handoffCandidate=${JSON.stringify(candidate)};
            window.handoffProposal=${JSON.stringify(proposal())};
            window.handoffDismissed=${JSON.stringify(proposal('dismissed'))};
            window.NorthStarAccountSession={
              load:function(){return Promise.resolve({role:'owner',email:'owner@example.test'});},
              json:function(){return Promise.resolve({preferences:{},version:'v1'});},
              fetch:function(url,options){var method=(options&&options.method)||'GET';
                window.handoffCalls.push({url:url,method:method,body:options&&options.body});
                if(window.handoffMode==='failure')return Promise.resolve({status:503,ok:false,
                  json:function(){return Promise.resolve({error:{category:'FORECAST_HANDOFF_UNAVAILABLE'}})}});
                if(method==='POST'&&url.indexOf('/dismiss')>=0){window.handoffMode='dismissed';
                  return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,
                    data:{state:'dismissed',proposal:window.handoffDismissed}})}});}
                if(method==='POST'){window.handoffMode='history';return Promise.resolve({status:201,ok:true,
                  json:function(){return Promise.resolve({success:true,data:{state:'created',proposal:window.handoffProposal}})}});}
                if(window.handoffMode==='unavailable')return Promise.resolve({status:200,ok:true,
                  json:function(){return Promise.resolve({success:true,data:{version:'m26-forecast-reviewed-handoff-v1',
                    state:'unavailable',reason:'run_stale',candidate:null,proposals:null,
                    automaticActionAuthorized:false,outboundCommunicationAuthorized:false}})}});
                var items=window.handoffMode==='history'?[window.handoffProposal]:
                  window.handoffMode==='dismissed'?[window.handoffDismissed]:[];
                items=items.filter(function(item){return Date.parse(item.expiresAt)>Date.now();});
                return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,
                  data:{version:'m26-forecast-reviewed-handoff-v1',state:'current',reason:null,
                    candidate:window.handoffCandidate,proposals:items,automaticActionAuthorized:false,
                    outboundCommunicationAuthorized:false}})}});
              }};`,
        });
        if (url.pathname === '/js/demo-runtime.js') return route.fulfill({
          contentType: 'application/javascript', body: demoRuntimeScript,
        });
        if (url.pathname === '/js/nav-component.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.NavComponent={init:function(){}};',
        });
        if (url.pathname === '/js/workspace-form-state.js') return route.fulfill({
          contentType: 'application/javascript',
          body: 'window.NorthStarFormState={create:function(){return {clear:function(){}}}};',
        });
        if (url.pathname === '/js/api.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.showToast=function(){};',
        });
        if (url.pathname.startsWith('/js/') &&
            !['/js/forecast-handoffs.js','/js/theme.js'].includes(url.pathname)) {
          return route.fulfill({ contentType: 'application/javascript', body: '' });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: {} });
        return route.continue();
      });
      await page.goto(origin + '/dashboard/settings');
      await page.locator('#forecastHandoffsStatus')
        .getByText('Reviewed handoff ready for an explicit review request', { exact: true }).waitFor();
      assert.equal(await page.locator('#forecastHandoffEvidence').textContent(),
        '0 inbound leads · point forecast · count');
      assert.match(await page.locator('#forecastHandoffReceiver').textContent(),
        /unavailable.*exact receiving record.*No link or action/i);
      assert.equal(await page.locator('#forecast-handoffs a').count(), 0);
      assert.doesNotMatch(await page.locator('#forecast-handoffs').innerText(),
        /approved|scheduled|dispatched|sent to customer/i);
      await page.locator('#requestForecastHandoff').focus();
      await page.keyboard.press('Enter');
      await page.locator('#forecastHandoffHistory').getByText('Review requested', { exact: true }).waitFor();
      assert.match(await page.locator('#forecastHandoffHistory').innerText(),
        /did not change the calendar, staffing, equipment, price, billing, or customer communication/i);
      const mutationCalls = await page.evaluate(() => window.handoffCalls
        .filter(call => call.method === 'POST'));
      assert.deepEqual(mutationCalls.map(call => call.url), ['/api/v1/forecast/handoffs']);
      await page.locator('#forecastHandoffHistory button').focus();
      await page.keyboard.press('Enter');
      await page.locator('#forecastHandoffHistory').getByText('Review dismissed', { exact: true }).waitFor();
      if (viewport.name === 'desktop-light') {
        await page.evaluate(() => { window.handoffMode = 'unavailable'; });
        await page.locator('#refreshForecastHandoffs').click();
        await page.locator('#forecastHandoffsStatus')
          .getByText('Reviewed handoff unavailable', { exact: true }).waitFor();
        assert.equal(await page.locator('#forecastHandoffCandidate').isHidden(), true);
        assert.equal(await page.locator('#forecastHandoffHistory').innerText(), '');
        assert.equal(await page.locator('#forecastHandoffEvidence').innerText(), '');
        assert.equal(await page.locator('#forecastHandoffReceiver').innerText(), '');
        await page.evaluate(() => { window.handoffMode = 'failure'; });
        await page.locator('#refreshForecastHandoffs').click();
        await page.locator('#forecastHandoffsStatus')
          .getByText('Reviewed handoffs unavailable', { exact: true }).waitFor();
        assert.equal(await page.locator('#forecastHandoffHistory').innerText(), '');
        await page.evaluate(() => { window.handoffMode = 'current'; });
        await page.locator('#refreshForecastHandoffs').click();
        await page.locator('#forecastHandoffsStatus')
          .getByText('Reviewed handoff ready for an explicit review request', { exact: true }).waitFor();
        assert.equal(await page.locator('#forecastHandoffEvidence').textContent(),
          '0 inbound leads · point forecast · count');
        await page.evaluate(() => {
          window.handoffProposal.expiresAt = new Date(Date.now() + 2000).toISOString();
          window.handoffMode = 'history';
        });
        await page.locator('#refreshForecastHandoffs').click();
        await page.locator('#forecastHandoffHistory')
          .getByText('Review requested', { exact: true }).waitFor();
        await page.waitForFunction(() =>
          document.querySelector('#forecastHandoffHistory').textContent.trim() === '');
        assert.equal(await page.locator('#forecastHandoffCandidate').isHidden(), false);
        await page.evaluate(() => { window.handoffMode = 'failure'; });
        await page.locator('#requestForecastHandoff').click();
        await page.locator('#forecastHandoffsStatus')
          .getByText('Review request unconfirmed', { exact: true }).waitFor();
        assert.equal(await page.locator('#forecastHandoffCandidate').isHidden(), true);
        assert.equal(await page.locator('#forecastHandoffEvidence').innerText(), '');
        assert.equal(await page.locator('#forecastHandoffHistory').innerText(), '');
        await page.evaluate(() => { window.handoffMode = 'current'; });
        await page.locator('#refreshForecastHandoffs').click();
        await page.locator('#forecastHandoffsStatus')
          .getByText('Reviewed handoff ready for an explicit review request', { exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.locator('#forecast-handoffs').screenshot({
        path: path.join(output, `${viewport.name}-paid.png`) });
      await context.close();
    }

    const context = await browser.newContext({ viewport: { width: 390, height: 844 },
      colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await context.newPage(); const requests = [], errors = [];
    page.on('request', request => requests.push(new URL(request.url()).pathname));
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/js/demo-runtime.js*', route => route.fulfill({
      contentType: 'application/javascript', body: demoRuntimeScript,
    }));
    await page.goto(origin + '/demo/settings');
    await page.locator('#forecastHandoffsStatus')
      .getByText('Fictional reviewed handoff', { exact: true }).waitFor();
    assert.equal(requests.some(value => value.startsWith('/api/v1/forecast/handoffs')), false);
    assert.match(await page.locator('#forecast-handoffs').innerText(), /fictional|resettable/i);
    await page.locator('#requestForecastHandoff').click();
    await page.locator('#forecastHandoffsStatus')
      .getByText('Fictional review requested', { exact: true }).waitFor();
    await page.locator('#forecastHandoffHistory button').click();
    await page.locator('#forecastHandoffsStatus')
      .getByText('Fictional review dismissed', { exact: true }).waitFor();
    await page.locator('#forecastHandoffsStatus')
      .getByText('Fictional reviewed handoff expired', { exact: true }).waitFor({ timeout: 6000 });
    assert.equal(await page.locator('#forecastHandoffCandidate').isHidden(), true);
    assert.equal(await page.locator('#forecastHandoffHistory').innerText(), '');
    assert.equal(await page.locator('#forecastHandoffEvidence').innerText(), '');
    await page.evaluate(() => window.recoverHandoffDemo());
    await page.locator('#forecastHandoffsStatus')
      .getByText('Fictional reviewed handoff', { exact: true }).waitFor();
    assert.equal(await page.locator('#forecastHandoffEvidence').textContent(),
      '19 inbound leads · point forecast · count');
    await page.locator('#requestForecastHandoff').click();
    await page.locator('#forecastHandoffHistory').getByText('Review requested', { exact: true }).waitFor();
    await page.evaluate(() => window.resetHandoffDemo());
    await page.locator('#forecastHandoffsStatus')
      .getByText('Fictional reviewed handoff', { exact: true }).waitFor();
    assert.equal(await page.locator('#forecastHandoffHistory').innerText(), '');
    assert.equal(requests.some(value => value.startsWith('/api/v1/forecast/handoffs')), false);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.locator('#forecast-handoffs').screenshot({
      path: path.join(output, 'mobile-demo.png') });
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
