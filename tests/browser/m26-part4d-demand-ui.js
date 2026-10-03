'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const engine = process.argv[2];
const output = path.resolve(process.argv[3]);
fs.mkdirSync(output, { recursive: true });
const html = fs.readFileSync(path.resolve('public/demo-dashboard.html'), 'utf8');
const start = html.indexOf('<section class="demo-panel command-center-demand-outlook"');
const end = html.indexOf('<section class="demo-panel command-center-resource-outlook"', start);
assert(start > 0 && end > start);
const fragment = html.slice(start, end);

const snapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 'm26-current-backlog-position-v1',
  personPlanCompositionVersion: 'm26-current-backlog-person-plan-composition-v1',
  targetKey: 'demand.current_backlog_position.v1', state: 'descriptive_subset',
  reason: null, capturedAt: '2026-09-30T12:00:00.000000Z',
  approvedUnscheduledCount: 1, approvedScheduledCount: 2, workInProgressCount: 1,
  completedCount: 0, unresolvedLinkageCount: 0, knownBacklogCount: 4,
  plannedPersonMinutes: '780.000000', backlogHoursState: 'available',
  backlogHoursReason: null, sourceDigest: 'a'.repeat(64), snapshotDigest: 'b'.repeat(64),
  sourceAuthority: 'northstar_authenticated_booking_schedule_and_execution_current_position',
  sourceAuthenticated: true, knownSubsetOnly: true, sourceCoverageComplete: false,
  offPlatformCoverageVerified: false, providerCoverageVerified: false,
  probabilityCalibrated: false, forecastIssued: false, paidNumericServing: false,
};
const fact = { state: 'backlog_fact_saved', id: '22222222-2222-4222-8222-222222222222',
  backlogSnapshotId: snapshot.id, factDigest: 'c'.repeat(64), replayed: false,
  knownSubsetOnly: true, wholeBusinessCoverageVerified: false,
  researchOnly: true, forecastIssued: false };

(async () => {
  let browser;
  const result = { engine, pass: false, cases: [],
    boundary: 'Local browser render of the production Part4D component with explicit fictional responses; no provider or production authority evidence.' };
  try {
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    for (const missingDependency of ['demand', 'research', 'contract', 'session']) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 900 } });
      const page = await context.newPage();
      const dashboard = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      await page.setContent(dashboard);
      await page.evaluate(missing => {
        window.__calls = [];
        if (missing !== 'contract') {
          window.NorthStarCommandCenterContract = {
            modeForPath: () => 'paid', routeForPath: () => '/api/v1/command-center/workspace',
            destinationPath: value => '/' + value, validateWorkspace: value => value,
          };
        }
        if (missing !== 'session') {
          window.NorthStarAccountSession = {
            fetch: async (url, options) => {
              window.__calls.push({ url, method: options && options.method });
              throw new Error('No request is permitted with a missing workspace dependency.');
            },
          };
        }
      }, missingDependency);
      if (missingDependency !== 'demand') {
        await page.addScriptTag({ path: path.resolve('public/js/command-center-demand-position.js') });
      }
      if (missingDependency !== 'research') {
        await page.addScriptTag({ path: path.resolve('public/js/command-center-demand-research.js') });
      }
      await page.addScriptTag({ path: path.resolve('public/js/command-center-page.js') });
      assert.equal(await page.getByRole('button', { name: 'Capture current backlog', exact: true }).isDisabled(), true);
      assert.equal(await page.locator('#commandCenterBacklogRead').isDisabled(), true);
      assert.match(await page.locator('.command-center-demand-outlook').innerText(), /Workspace unavailable/);
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      result.cases.push({ mode: 'paid', width: 1024, theme: 'light',
        missingDependency, requests: [], pass: true });
      await context.close();
    }
    for (const item of [
      { mode: 'paid', width: 1440, theme: 'light' },
      { mode: 'paid', width: 1024, theme: 'light', dependenciesReady: false },
      { mode: 'demo', width: 390, theme: 'dark' },
    ]) {
      const context = await browser.newContext({ viewport: { width: item.width, height: 900 } });
      const page = await context.newPage();
      await page.setContent('<!doctype html><html><head></head><body><main class="demo-dashboard-main"></main></body></html>');
      for (const file of ['style.css', 'demo-dashboard.css']) {
        await page.addStyleTag({ content: fs.readFileSync(path.resolve('public/css', file), 'utf8') });
      }
      await page.evaluate(({ fragment, theme }) => {
        document.documentElement.dataset.theme = theme;
        document.querySelector('main').innerHTML = fragment;
      }, { fragment, theme: item.theme });
      await page.addScriptTag({ path: path.resolve('public/js/command-center-demand-position.js') });
      await page.addScriptTag({ path: path.resolve('public/js/command-center-demand-research.js') });
      await page.evaluate(({ mode, snapshot, fact, dependenciesReady }) => {
        window.__calls = [];
        window.__controller = NorthStarDemandPosition.create({ mode, document,
          workspaceAvailable: dependenciesReady !== false,
          idempotency: () => 'browser-part4d-capture-key',
          fetcher: async (url, options) => {
            window.__calls.push({ url, method: options.method });
            return { ok: true, status: options.method === 'POST' ? 201 : 200,
              json: async () => ({ success: true,
                data: options.method === 'POST' ? fact : snapshot }) };
          } });
        window.__research = NorthStarDemandResearch.create({ mode, document,
          workspaceAvailable: dependenciesReady !== false,
          idempotency: () => 'browser-part4d-research-key',
          fetcher: async () => { throw new Error('No research request expected in this component case.'); } });
      }, { mode: item.mode, snapshot, fact, dependenciesReady: item.dependenciesReady });
      assert.equal(await page.evaluate(() => window.__calls.length), 0);
      if (item.dependenciesReady === false) {
        assert.equal(await page.getByRole('button', { name: 'Capture current backlog', exact: true }).isDisabled(), true);
        await page.evaluate(() => window.__controller.capture());
        assert.equal(await page.evaluate(() => window.__calls.length), 0);
        assert.match(await page.locator('.command-center-demand-outlook').innerText(), /Workspace unavailable/);
      } else if (item.mode === 'paid') {
        assert.match(await page.locator('.command-center-demand-outlook').innerText(), /Nothing is captured on page load/);
        await page.getByRole('button', { name: 'Capture current backlog', exact: true }).click();
        await page.waitForFunction(() => window.__controller.state().kind === 'available');
        assert.equal(await page.evaluate(() => window.__calls.length), 2);
        assert.match(await page.locator('.command-center-demand-outlook').innerText(), /13 person-hours/);
        assert.match(await page.locator('.command-center-demand-outlook').innerText(), /Demand forecast/);
      } else {
        assert.equal(await page.locator('#commandCenterBacklogActions').isHidden(), true);
        assert.match(await page.locator('.command-center-demand-outlook').innerText(), /Fictional isolated demo/);
        assert.match(await page.locator('.command-center-demand-outlook').innerText(), /13 person-hours/);
        await page.evaluate(async () => {
          await window.__research.action('transition-review-approve');
          window.__research.demoAdvance();
        });
        assert.match(await page.locator('.command-center-demand-outlook').innerText(), /Fictional origins saved/);
        const firstTransition = await page.locator('#commandCenterResearchTransitionId').inputValue();
        await page.getByRole('button', { name: 'Reject method', exact: true }).click();
        await page.locator('#commandCenterDemandState').getByText('Fictional source changed').waitFor();
        await page.getByRole('button', { name: 'Recover with new origins', exact: true }).click();
        assert.equal(await page.locator('#commandCenterResearchTransitionEvaluationId').inputValue(), '');
        await page.getByRole('button', { name: 'Approve method', exact: true }).click();
        await page.getByRole('button', { name: 'Recover with new origins', exact: true }).click();
        const recoveredTransition = await page.locator('#commandCenterResearchTransitionId').inputValue();
        assert.notEqual(recoveredTransition, firstTransition);
        await page.getByRole('button', { name: 'Advance recovered horizon', exact: true }).click();
        await page.locator('#commandCenterDemandState').getByText('Fictional evaluations ready').waitFor();
        const evaluation = await page.locator('#commandCenterResearchTransitionEvaluationId').inputValue();
        assert.match(evaluation, /^[0-9a-f-]{36}$/);
        await page.getByRole('button', { name: 'Reject method', exact: true }).click();
        await page.locator('#commandCenterDemandState').getByText('Fictional source changed').waitFor();
        await page.evaluate(async () => {
          await window.__research.action('transition-load');
          await window.__research.action('transition-evaluation-load');
        });
        assert.match(await page.locator('#commandCenterResearchTransitions').innerText(), /stale/i);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const tag = `${item.mode}-${item.width}-${item.theme}` +
        (item.dependenciesReady === false ? '-dependencies-unavailable' : '');
      await page.locator('.command-center-demand-outlook').screenshot({ path: path.join(output, `${tag}.png`) });
      result.cases.push({ ...item, requests: await page.evaluate(() => window.__calls), pass: true });
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
})();
