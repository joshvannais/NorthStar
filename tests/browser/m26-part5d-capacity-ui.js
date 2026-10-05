'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const capacity = require('../../public/js/command-center-capacity-research');

const engine = process.argv[2];
const output = path.resolve(process.argv[3]);
assert.ok(!fs.existsSync(output), 'Browser evidence directory must be new');
fs.mkdirSync(output, { recursive: true });
const dashboard = fs.readFileSync(path.resolve('public/demo-dashboard.html'), 'utf8');
const start = dashboard.indexOf('<section class="demo-panel command-center-capacity"');
const end = dashboard.indexOf('<section class="demo-panel command-center-resource-outlook"', start);
assert.ok(start > 0 && end > start, 'Capacity component must stay mounted in the existing dashboard');
const fragment = dashboard.slice(start, end);

function response(status, data) {
  return { status, data: data || null };
}

(async () => {
  let browser;
  const result = {
    engine,
    pass: false,
    cases: [],
    boundary: 'Local synthetic browser evidence for the shared Part 5D production UI engine. It is not provider, private-production, physical Safari/device, complete accessibility or founder visual evidence.',
  };
  try {
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });

    async function makePage({ width, height = 1050, theme = 'light', mode = 'paid', reducedMotion = false }) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
      const page = await context.newPage();
      if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setContent('<!doctype html><html><head></head><body><main></main></body></html>');
      const styles = ['style.css', 'demo-dashboard.css'].map(file =>
        fs.readFileSync(path.resolve('public/css', file), 'utf8')).join('\n');
      await page.evaluate(({ fragment, theme, styles }) => {
        const style = document.createElement('style'); style.textContent = styles; document.head.append(style);
        document.documentElement.dataset.theme = theme;
        document.querySelector('main').innerHTML = fragment;
      }, { fragment, theme, styles });
      await page.addScriptTag({ path: path.resolve('public/js/command-center-capacity-research.js') });
      await page.evaluate(({ mode }) => {
        window.__calls = [];
        window.__responses = [];
        window.__controller = NorthStarCapacityResearch.create({
          mode,
          document,
          idempotency: () => 'm26-part5d-browser-exact-key',
          fetcher: async (url, options) => {
            window.__calls.push({ url, method: options.method, body: options.body || null,
              idempotencyKey: options.headers && options.headers['Idempotency-Key'] || null });
            const next = window.__responses.shift();
            if (!next) throw new Error('Unexpected capacity request');
            if (next.reject) throw new Error('Synthetic connection failure');
            return { ok: next.status >= 200 && next.status < 300, status: next.status,
              json: async () => next.status >= 200 && next.status < 300
                ? { success: true, data: next.data }
                : { success: false, error: 'Generic failure' } };
          },
        });
      }, { mode });
      return { context, page };
    }

    {
      const { context, page } = await makePage({ width: 1440, theme: 'light', reducedMotion: true });
      assert.equal(await page.evaluate(() => window.__calls.length), 0, 'Page construction must perform no request');
      await page.evaluate(journey => {
        window.__responses.push({ status: 200, data: journey });
        return window.__controller.workspaceReady('paid:tenant:revision:digest:session:generation:expiry');
      }, capacity.demoJourney(5));
      const text = await page.locator('#commandCenterCapacityRoot').innerText();
      for (const copy of ['Accepted work demand', 'Work expected to remain', 'Role capacity available',
        'Crew', 'Skill', 'Working hours', 'Location', 'Travel', 'Vehicle', 'Equipment',
        'Bottleneck', 'Backlog pressure', 'Overtime pressure', 'Contractor attention', 'Hiring attention',
        'Authenticated zero', 'must never be added together', 'Continuation activated']) assert.match(text, new RegExp(copy));
      const historyText = await page.locator('#commandCenterCapacityHistory').textContent();
      assert.match(historyText, /capacity advisory continuation missed/i);
      assert.match(historyText, /33333333-3333-4333-8333-333333333338/);
      assert.match(historyText, /33333333-3333-4333-8333-333333333339/);
      assert.equal(await page.evaluate(() => window.__calls.map(item => item.method).join(',')), 'GET');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const reduced = await page.locator('#commandCenterCapacityState').evaluate(element =>
        Number.parseFloat(getComputedStyle(element).transitionDuration || '0') <= 0.001);
      assert.equal(reduced, true, 'Reduced-motion media rule must bound transitions');
      await page.locator('#commandCenterCapacityRoot').screenshot({ path: path.join(output, 'paid-desktop-current.png') });
      result.cases.push({ name: 'paid-desktop-current', requests: ['GET'], reducedMotion: true,
        overflow: false, pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 1024, theme: 'light' });
      await page.evaluate(journey => {
        window.__responses.push({ status: 200, data: journey });
        return window.__controller.workspaceReady('paid:review');
      }, capacity.demoJourney(1));
      await page.locator('#commandCenterCapacityReason').focus();
      await page.keyboard.type('Approve this exact fictional qualitative research receipt.');
      const approve = page.getByRole('button', { name: 'Approve for review', exact: true });
      await approve.focus();
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Approve for review');
      await page.evaluate(({ decision, next }) => {
        window.__responses.push({ status: 201, data: decision }, { status: 200, data: next });
      }, { decision: { state: 'capacity_advisory_decision_recorded',
        id: '44444444-4444-4444-8444-444444444444', originId: '33333333-3333-4333-8333-333333333331',
        action: 'approve', revision: 1, researchOnly: true, automaticActionTaken: false, replayed: false },
      next: capacity.demoJourney(2) });
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__controller.inspect().journey &&
        window.__controller.inspect().journey.advisory.selectedContinuation);
      const calls = await page.evaluate(() => window.__calls);
      assert.deepEqual(calls.map(item => item.method), ['GET', 'POST', 'GET']);
      assert.match(calls[1].url, /\/safe-decisions$/);
      assert.equal(calls[1].idempotencyKey, 'm26-part5d-browser-exact-key');
      assert.deepEqual(JSON.parse(calls[1].body), {
        action: 'approve', expectedDecisionId: null, expectedDecisionRevision: 0,
        reason: 'Approve this exact fictional qualitative research receipt.', confirmed: true,
        confirmationVersion: 'm26-capacity-ui-decision-v1',
      });
      assert.match(await page.locator('#commandCenterCapacityContinuation').innerText(), /Continuation pending/);
      result.cases.push({ name: 'paid-keyboard-human-review', requests: calls.map(item => item.method), pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 1024, theme: 'light' });
      await page.evaluate(journey => {
        window.__responses.push({ status: 200, data: journey });
        return window.__controller.workspaceReady('paid:uncertain');
      }, capacity.demoJourney(3));
      await page.locator('#commandCenterCapacityReason').fill('Recover this exact accepted workload research position.');
      await page.evaluate(() => window.__responses.push({ status: 503 }));
      await page.getByRole('button', { name: 'Append recovery origin', exact: true }).first().click();
      await page.getByRole('button', { name: 'Retry exact uncertain action', exact: true }).waitFor();
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Uncertain/);
      await page.evaluate(({ mutation, next }) => window.__responses.push(
        { status: 201, data: mutation }, { status: 200, data: next }), {
        mutation: { state: 'capacity_research_action_recorded', action: 'workload_capture_origin',
          receiptId: '55555555-5555-4555-8555-555555555555', originId: '55555555-5555-4555-8555-555555555555',
          outcomeId: null, continuationId: null, revision: null, researchOnly: true,
          automaticActionTaken: false, replayed: false },
        next: capacity.demoJourney(4),
      });
      await page.getByRole('button', { name: 'Retry exact uncertain action', exact: true }).click();
      await page.waitForFunction(() => window.__controller.inspect().journey &&
        window.__controller.inspect().journey.advisory.selectedContinuation &&
        window.__controller.inspect().journey.advisory.selectedContinuation.state.endsWith('_missed'));
      const posts = (await page.evaluate(() => window.__calls)).filter(item => item.method === 'POST');
      assert.equal(posts.length, 2);
      assert.deepEqual(posts[1], posts[0], 'Uncertain retry must reuse exact endpoint, body and idempotency key');
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Recovered/);
      assert.match(await page.locator('#commandCenterCapacityContinuation').innerText(), /missed its fixed deadline/);
      result.cases.push({ name: 'paid-uncertain-exact-retry-recovery', exactRetry: true, pass: true });
      await context.close();
    }

    for (const item of [
      { name: 'restricted', status: 403, label: /Restricted/ },
      { name: 'conflict', status: 409, label: /Conflict/ },
      { name: 'uncertain', status: 503, label: /Uncertain/ },
      { name: 'known-failure', status: 400, label: /Failed/ },
      { name: 'unavailable', status: 404, label: /Unavailable/ },
    ]) {
      const { context, page } = await makePage({ width: 900 });
      await page.evaluate(status => {
        window.__responses.push({ status });
        return window.__controller.workspaceReady('paid:state:' + status);
      }, item.status);
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), item.label);
      assert.equal(await page.evaluate(() => window.__controller.inspect().journey), null);
      assert.equal(await page.getByRole('button', { name: 'Retry exact uncertain action', exact: true }).isHidden(), true,
        'Read failures and known write failures must not invent a retryable mutation');
      result.cases.push({ name: `paid-${item.name}`, status: item.status, staleClaimCleared: true, pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 900 });
      await page.evaluate(() => window.__controller.workspaceUnavailable());
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Workspace unavailable/);
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      result.cases.push({ name: 'workspace-unavailable', requests: [], pass: true });
      await context.close();
    }

    {
      const { context, page } = await makePage({ width: 390, height: 1100, theme: 'dark', mode: 'demo' });
      await page.evaluate(() => window.__controller.workspaceReady(
        'demo:tenant:revision:digest:session:generation:expiry'));
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Unavailable/);
      assert.match(await page.locator('#commandCenterCapacityTargets').innerText(), /Unavailable/);
      const demoButton = name => page.getByRole('button', { name, exact: true });
      await demoButton('Continue fictional journey').click();
      assert.match(await page.locator('#commandCenterCapacityAdvisoryState').innerText(), /Current/);
      await demoButton('Continue fictional journey').click();
      assert.match(await page.locator('#commandCenterCapacityContinuation').innerText(), /Continuation pending/);
      await demoButton('Change fictional source').click();
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Stale/);
      assert.match(await page.locator('#commandCenterCapacityContinuation').innerText(), /stale or superseded/);
      await demoButton('Recover with new receipts').click();
      assert.match(await page.locator('#commandCenterCapacityState').innerText(), /Recovered/);
      assert.match(await page.locator('#commandCenterCapacityContinuation').innerText(), /missed its fixed deadline/);
      await demoButton('Continue fictional journey').click();
      assert.match(await page.locator('#commandCenterCapacityContinuation').innerText(), /Continuation activated/);
      assert.match(await page.locator('#commandCenterCapacityHistory').textContent(), /capacity advisory continuation missed/i);
      assert.equal(await page.evaluate(() => window.__calls.length), 0, 'Demo lifecycle must make zero paid API calls');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#commandCenterCapacityRoot').screenshot({ path: path.join(output, 'demo-mobile-recovered.png') });
      await demoButton('Reset capacity research').click();
      assert.match(await page.locator('#commandCenterCapacityTargets').innerText(), /Unavailable/);
      await demoButton('Continue fictional journey').click();
      await page.evaluate(() => window.__controller.workspaceReady('demo:tenant:revision:digest:session:generation-2:expiry'));
      assert.equal(await page.evaluate(() => window.__controller.inspect().demoStage), 0,
        'Generation identity change must reset local demo state');
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      result.cases.push({ name: 'demo-mobile-isolated-lifecycle', paidApiCalls: 0,
        productionAccess: 0, reset: true, generationInvalidation: true, overflow: false, pass: true });
      await context.close();
    }

    result.pass = true;
  } catch (error) {
    result.error = error.stack;
    process.exitCode = 1;
  } finally {
    await browser?.close();
    fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
