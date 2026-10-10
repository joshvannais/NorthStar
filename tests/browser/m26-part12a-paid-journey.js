'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { MISSION_26_FIVE_LAYOUTS, auditRenderedPage, exerciseSkipLink } =
  require('../helpers/m26-part12d-rendered-review');

process.env.NODE_ENV = 'test';
process.env.AUTH_ACCESS_SECRET = 'm26-part12a-paid-journey-browser-20261009';
const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new output directory');
fs.mkdirSync(output, { recursive: true });
const D = value => value.repeat(64);
const org = '55555555-5555-4555-8555-555555555555';
const runId = '11111111-1111-4111-8111-111111111111';
const originId = '22222222-2222-4222-8222-222222222222';
const settings = { state: 'current', settings: { revision: 1, digest: D('1'),
  settings: { enabled: true, targets: ['revenue.approved_price_flow'],
    horizons: [{ grain: 'month', periods: 1 }],
    scenarioDisplay: 'deterministic_when_eligible', comparisonDisplay: 'none',
    alertDelivery: 'off', actionPolicy: 'review_required' } } };
const run = { id: runId, settings: { revision: 1, digest: D('1') },
  source: { positionId: '33333333-3333-4333-8333-333333333333',
    positionDigest: D('2'), sourceSnapshotDigest: D('3'),
    reportingWindowDigest: D('4'), featureSetDigest: D('5') },
  target: { key: 'revenue.approved_price_flow', definitionVersion: 'v1',
    semantic: 'future_human_approved_commercial_price_decisions' },
  horizon: { grain: 'month', startsAt: '2026-10-11T00:00:00.000Z',
    endsAt: '2026-10-12T00:00:00.000Z' },
  algorithm: { key: 'approved_price_carry_forward',
    version: 'm26-paid-approved-price-flow-v1', definitionDigest: D('6'),
    implementationDigest: D('7'), configurationDigest: D('8') },
  output: { predictionKind: 'deterministic_point', value: { amount: '0.00' },
    unit: { key: 'money', currency: 'USD' }, uncertainty: {
      state: 'unquantified', calibratedIntervalAvailable: false }, digest: D('9') },
  explanation: { summary: 'A future human-approved commercial price decision carried forward from the exact pre-horizon approved-price origin.',
    sourceCoverage: 'Current NorthStar-supported commercial records at capture time.',
    uncertainty: 'A calibrated interval is unavailable.', customerSafe: true,
    advisoryOnly: true, digest: D('a') }, receipt: { organizationId: org, digest: D('b') },
  currentness: { state: 'unchanged_candidate', revision: 1, digest: D('c'),
    adviceDisplayAuthorized: false }, review: { receiverAvailability: 'unavailable',
    receiverReason: 'no_exact_receiving_adapter', receiverHref: null, history: [],
    advisoryOnly: true, receiverMutationCount: 0 },
  automaticActionAuthorized: false, outboundCommunicationAuthorized: false };
function envelope(state = 'current') {
  return { version: 'm26-paid-journey-v1', state,
    reason: state === 'current' || state === 'ready' ? null : 'source_revoked',
    run: state === 'current' ? run : null,
    review: state === 'current' ? { availability: 'unavailable',
      reason: 'no_exact_receiving_adapter', requestReviewAvailable: true } : null,
    targetKey: 'revenue.approved_price_flow',
    syntheticImplementationEvidenceOnly: true, liveValidationAvailable: false,
    automaticActionAuthorized: false };
}
const demoRuntime = `(function(){window.NorthStarDemoRuntime={active:
  location.pathname.indexOf('/demo/')===0};})();`;

async function main() {
  const app = require('../../src/server').app;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const runtime = resolveBrowserRuntime(process.argv.includes('--webkit') ? 'webkit' : 'chrome');
  const browser = await runtime.browserType.launch({ headless: true,
    executablePath: runtime.executablePath });
  const exercisedRequiredBranches = [];
  try {
    for (const viewport of MISSION_26_FIVE_LAYOUTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width,
        height: viewport.height }, colorScheme: viewport.colorScheme, reducedMotion: 'reduce' });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (url.pathname === '/js/auth-session.js') return route.fulfill({
          contentType: 'application/javascript', body: `
          window.showToast=function(){};window.paidJourneyCalls=[];
          window.paidJourneyMode='ready';window.paidJourneyDeferred=[];window.paidJourneyExpireFast=false;
          window.paidJourneySettings=${JSON.stringify(settings)};
          window.paidJourneyEnvelope=${JSON.stringify(envelope())};
          window.paidJourneyRun=window.paidJourneyEnvelope.run;
          window.resolvePaidJourneyMutation=function(success){var item=window.paidJourneyDeferred.shift();
            if(!item)throw new Error('No deferred paid mutation');item.resolve(success?
              {status:200,ok:true,json:function(){return Promise.resolve({success:true,data:{state:'requested',journey:window.paidJourneyEnvelope}})}}:
              {status:503,ok:false,json:function(){return Promise.resolve({})}});};
          window.NorthStarAccountSession={load:function(){return Promise.resolve({mode:'paid',
            navigation:[{id:'settings',href:'/dashboard/settings'}]});},
          fetch:function(url,options){var method=options&&options.method||'GET';
            window.paidJourneyCalls.push({url:url,method:method,body:options&&options.body});
            if(url==='/api/v1/forecast/settings')return Promise.resolve({status:200,ok:true,
              json:function(){return Promise.resolve({success:true,data:window.paidJourneySettings})}});
            if(window.paidJourneyMode==='failure')return Promise.resolve({status:503,ok:false,
              json:function(){return Promise.resolve({})}});
            if(method==='POST'&&window.paidJourneyMode==='delayed')return new Promise(function(resolve){
              window.paidJourneyDeferred.push({url:url,resolve:resolve});});
            if(method==='GET'){var latest=window.paidJourneyRun.review.history.slice(-1)[0];
              if(latest&&latest.action==='requested'&&Date.parse(latest.expiresAt)<=Date.now())latest.action='expired';
              var state=window.paidJourneyMode==='ready'?'ready':
              window.paidJourneyMode==='unavailable'?'unavailable':'current';
              var data=state==='current'?window.paidJourneyEnvelope:state==='ready'?
                ${JSON.stringify(envelope('ready'))}:${JSON.stringify(envelope('unavailable'))};
              return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,data:data})}});}
            if(url.indexOf('/issue')>=0){window.paidJourneyMode='current';return Promise.resolve({status:201,ok:true,
              json:function(){return Promise.resolve({success:true,data:Object.assign({},window.paidJourneyEnvelope,{replayed:false})})}});}
            if(url.indexOf('/rerun')>=0)return Promise.resolve({status:200,ok:true,json:function(){return Promise.resolve({success:true,
              data:{state:'reproduced',runId:'${runId}',runDigest:'${D('b')}',storedOutputDigest:'${D('9')}',
                freshOutputDigest:'${D('9')}',sameResults:true,automaticActionAuthorized:false}})}});
            var sent=JSON.parse(options.body);var history=window.paidJourneyRun.review.history;
            if(sent.action==='requested')history.splice(0,history.length,{revision:1,action:'requested',
              recordedAt:new Date().toISOString(),expiresAt:window.paidJourneyExpireFast?
                new Date(Date.now()+120).toISOString():sent.expiresAt,
              actorUserId:'66666666-6666-4666-8666-666666666666',digest:'${D('d')}'});
            else history.push({revision:2,action:'dismissed',recordedAt:new Date().toISOString(),
              expiresAt:sent.expiresAt,actorUserId:'66666666-6666-4666-8666-666666666666',digest:'${D('e')}'});
            return Promise.resolve({status:sent.action==='requested'?201:200,ok:true,json:function(){return Promise.resolve({success:true,
              data:{state:sent.action,journey:window.paidJourneyEnvelope}})}});
          }};`,
        });
        if (url.pathname === '/js/demo-runtime.js') return route.fulfill({
          contentType: 'application/javascript', body: demoRuntime });
        if (url.pathname === '/js/workspace-form-state.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.NorthStarFormState={create:function(){return {}}};' });
        if (url.pathname === '/js/api.js') return route.fulfill({
          contentType: 'application/javascript', body: 'window.showToast=function(){};' });
        if (url.pathname.startsWith('/js/') &&
            !['/js/forecast-paid-journey.js','/js/demo-runtime.js','/js/theme.js',
              '/js/command-center-contract.js','/js/nav-component.js'].includes(url.pathname)) {
          return route.fulfill({ contentType: 'application/javascript', body: '' });
        }
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: {} });
        return route.continue();
      });
      await page.goto(base + '/dashboard/settings');
      await page.locator('#forecastPaidJourneyStatus')
        .getByText('Paid journey ready for an exact source origin', { exact: true }).waitFor();
      await page.locator('#forecastPaidOrigin').fill(originId);
      await page.locator('#forecastPaidReason').fill('Synthetic owner-reviewed browser journey.');
      await page.locator('#issueForecastPaidJourney').focus(); await page.keyboard.press('Enter');
      await page.locator('#forecastPaidJourneyStatus')
        .getByText('Paid approved-price journey is current', { exact: true }).waitFor();
      assert.match(await page.locator('#forecastPaidJourneyValue').textContent(), /0\.00/);
      assert.equal(await page.locator('#forecastPaidJourneyReceipt').textContent(), D('b'));
      assert.equal(await page.locator('#forecastPaidJourneyOutput').textContent(), D('9'));
      const panel = await page.locator('#forecast-paid-journey').innerText();
      assert.match(panel, /Calibrated confidence.*remain unavailable/i);
      assert.match(panel, /no exact adapter exists/i);
      assert.doesNotMatch(panel, /earned revenue|collected cash|[0-9]+% confidence/i);
      await page.locator('#rerunForecastPaidJourney').click();
      await page.locator('#forecastPaidJourneyReview')
        .getByText(/Reproduced from retained authorized inputs/i).waitFor().catch(async error => {
          throw new Error(`${error.message}\nReview: ${await page.locator('#forecastPaidJourneyReview').innerText()}` +
            `\nCalls: ${JSON.stringify(await page.evaluate(() => window.paidJourneyCalls))}` +
            `\nPage errors: ${JSON.stringify(errors)}`);
        });
      await page.locator('#reviewForecastPaidJourney').focus(); await page.keyboard.press('Enter');
      await page.locator('#forecastPaidJourneyHistory').getByText(/Revision 1 · requested/).waitFor();
      await page.locator('#forecastPaidJourneyHistory button').focus(); await page.keyboard.press('Enter');
      await page.locator('#forecastPaidJourneyHistory').getByText(/Revision 2 · dismissed/).waitFor();

      if (viewport.name === 'phone-standard-light') {
        await page.evaluate(() => { window.paidJourneyExpireFast = true; });
        await page.locator('#reviewForecastPaidJourney').click();
        await page.locator('#forecastPaidJourneyHistory').getByText(/Revision 1 · expired/)
          .waitFor({ timeout: 3000 });
        assert.equal(await page.locator('#reviewForecastPaidJourney').isEnabled(), true);
        exercisedRequiredBranches.push('expiry');
        await page.evaluate(() => { window.paidJourneyExpireFast = false; });
        await page.evaluate(() => { window.paidJourneyMode = 'unavailable'; });
        await page.locator('#refreshForecastPaidJourney').click();
        await page.locator('#forecastPaidJourneyStatus').getByText(/source_revoked/).waitFor();
        assert.equal(await page.locator('#forecastPaidJourneyReceipt').textContent(), '');
        assert.equal(await page.locator('#forecastPaidJourneyOutput').textContent(), '');
        assert.equal(await page.locator('#forecastPaidJourneyHistory').innerText(), '');
        assert.equal(await page.locator('#forecastPaidJourneyCurrent').isHidden(), true);
        exercisedRequiredBranches.push('unavailable-stale-clearing');
        await page.evaluate(() => { window.paidJourneyMode = 'failure'; });
        await page.locator('#refreshForecastPaidJourney').click();
        await page.locator('#forecastPaidJourneyStatus')
          .getByText('Paid forecast journey unavailable', { exact: true }).waitFor();
        assert.equal(await page.locator('#forecastPaidJourneyReceipt').textContent(), '');
        await page.evaluate(() => { window.paidJourneyMode = 'current'; });
        await page.locator('#refreshForecastPaidJourney').click();
        await page.locator('#forecastPaidJourneyStatus')
          .getByText('Paid approved-price journey is current', { exact: true }).waitFor();
        exercisedRequiredBranches.push('failure-recovery');

        await page.evaluate(() => { window.paidJourneyMode = 'delayed'; });
        await page.locator('#reviewForecastPaidJourney').click();
        await page.evaluate(() => {
          window.paidJourneyMode = 'unavailable';
          dispatchEvent(new CustomEvent('northstar:auth-generation'));
        });
        await page.locator('#forecastPaidJourneyStatus').getByText(/source_revoked/).waitFor();
        await page.evaluate(() => window.resolvePaidJourneyMutation(true));
        await page.waitForTimeout(50);
        assert.match(await page.locator('#forecastPaidJourneyStatus').textContent(), /source_revoked/);
        assert.equal(await page.locator('#forecastPaidJourneyReceipt').textContent(), '');
        exercisedRequiredBranches.push('delayed-success-generation-guard');

        await page.evaluate(() => {
          window.paidJourneyMode = 'current';
          dispatchEvent(new CustomEvent('northstar:auth-generation'));
        });
        await page.locator('#forecastPaidJourneyStatus')
          .getByText('Paid approved-price journey is current', { exact: true }).waitFor();
        await page.evaluate(() => { window.paidJourneyMode = 'delayed'; });
        await page.locator('#reviewForecastPaidJourney').click();
        await page.evaluate(() => {
          window.paidJourneyMode = 'current';
          dispatchEvent(new CustomEvent('northstar:auth-generation'));
        });
        await page.locator('#forecastPaidJourneyStatus')
          .getByText('Paid approved-price journey is current', { exact: true }).waitFor();
        await page.evaluate(() => window.resolvePaidJourneyMutation(false));
        await page.waitForTimeout(50);
        assert.equal(await page.locator('#forecastPaidJourneyStatus').textContent(),
          'Paid approved-price journey is current');
        assert.equal(await page.locator('#forecastPaidJourneyReceipt').textContent(), D('b'));
        exercisedRequiredBranches.push('delayed-failure-generation-guard');
      }
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      if (viewport.width <= 720) {
        const gaps = await page.evaluate(() => {
          const groups = Array.from(document.querySelectorAll('#forecastPaidJourneyIssueForm .form-group'));
          const button = document.getElementById('issueForecastPaidJourney');
          const first = groups[0].getBoundingClientRect();
          const second = groups[1].getBoundingClientRect();
          const action = button.getBoundingClientRect();
          return [second.top - first.bottom, action.top - second.bottom];
        });
        gaps.forEach(gap => assert.ok(gap >= 0 && gap <= 20,
          `mobile paid journey form gap ${gap} must remain compact`));
      }
      await auditRenderedPage(page, { mainSelector: '#mainContent', layout: viewport });
      await page.locator('#forecast-paid-journey').screenshot({ path: path.join(output,
        `${viewport.name}-paid.png`) });
      await page.screenshot({ path: path.join(output, `${viewport.name}-paid-full.png`), fullPage: true });
      await exerciseSkipLink(page, { mainSelector: '#mainContent' });
      await context.close();
    }

    assert.deepEqual(exercisedRequiredBranches, [
      'expiry', 'unavailable-stale-clearing', 'failure-recovery',
      'delayed-success-generation-guard', 'delayed-failure-generation-guard',
    ]);

    const demoContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const demoPage = await demoContext.newPage(); const requests = [], errors = [];
    demoPage.on('request', value => requests.push(new URL(value.url()).pathname));
    demoPage.on('pageerror', error => errors.push(error.message));
    await demoPage.goto(base + '/demo/settings');
    await demoPage.locator('#forecastPaidJourneyStatus')
      .getByText('Fictional forecast journey unavailable', { exact: true }).waitFor();
    assert.match(await demoPage.locator('#forecast-paid-journey').innerText(),
      /No earlier values or identities remain displayed/i);
    assert.equal(requests.some(value => value.startsWith('/api/v1/forecast/paid-journey')), false);
    assert.deepEqual(errors, []); await demoContext.close();
    console.log(JSON.stringify({ layouts: MISSION_26_FIVE_LAYOUTS.length,
      requiredLayout: 'phone-standard-light', exercisedRequiredBranches }));
  } finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
