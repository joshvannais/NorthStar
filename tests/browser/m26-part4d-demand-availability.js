'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { navigationFixture } = require('../helpers/navigation-fixture');
const { MISSION_26_FIVE_LAYOUTS, auditRenderedPage, exerciseSkipLink } =
  require('../helpers/m26-part12d-rendered-review');
const builder = require('../../src/commandCenter/workspace');

const output = process.argv.find(value => value.startsWith('--output='))?.slice(9);
assert.ok(output && !fs.existsSync(output), 'Supply a new --output directory');
fs.mkdirSync(output, { recursive: true });
const id = n => `e4910000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const categories = ['unassigned', 'due', 'overdue', 'atRisk', 'conflicting'];
const scheduling = {
  version: 'm22-part5-overview-v1', timeZone: 'America/New_York', digest: 'a'.repeat(64),
  total: 0, shown: 0, page: { size: 100, shown: 0, total: 0, cursor: null, nextCursor: null },
  definitions: Object.fromEntries(categories.map(key => [key, 'Fictional current scheduling category'])),
  categories: Object.fromEntries(categories.map(key => [key, []])),
  counts: Object.fromEntries(categories.map(key => [key, 0])), records: [],
};
const operator = {
  canRead: true, canMutate: false, reason: 'subscription_read_only', targets: [],
  digest: 'c'.repeat(64), truncated: false,
  discovery: { version: 'm22-part5-target-directory-v1', endpoint: '/api/v1/canonical/operator-targets',
    pageSize: 100, shown: 0, total: 0, truncated: false },
};
const paid = builder.buildPaidWorkspace({ context: { organizationId: id(1) }, items: [],
  schedulingOperator: operator, schedulingOverview: scheduling });
const demo = builder.buildDemoWorkspace({ tenantId: id(1), sessionId: id(3),
  state: builder.createInitialDemoState(id(1), new Date('2026-09-09T12:00:00Z')),
  revision: 1, simulationCount: 0, persisted: false, expiresAt: new Date('2099-09-09T12:00:00Z') });
const account = { account: {
  user: { id: id(2), name: 'Fictional Owner', email: 'owner@example.com', status: 'active' },
  organization: { id: id(1), name: 'Fictional Business' }, navigation: navigationFixture(),
  membership: { role: 'owner', status: 'active' }, memberships: [{ role: 'owner', status: 'active' }],
  onboarding: { status: 'complete' }, subscription: {
    plan: 'Complete', safe: true, state: 'active', readOnly: false, showTrialBanner: false,
  },
} };
const originId = id(41), evaluationId = id(42);
const flags = { researchOnly: true, forecastIssued: false,
  paidNumericServing: false, forecastServingEnabled: false };
const prerequisites = { state: 'demand_ui_prerequisites_current',
  profile: { state: 'current', anchorId: id(40) },
  seasonal: { purpose: 'seasonal_inbound', targetKey: 'demand.inbound_leads',
    targetVersion: 'v1', calculationVersion: 'm26-seasonal-two-cycle-open-minute-v1',
    method: { expectedRevision: 1, expectedDigest: 'd'.repeat(64), action: 'approve', approved: true },
    epoch: { state: 'current', id: id(43), revision: 1, installedAt: '2026-10-03T12:00:00.000000Z' } },
  pipeline: { purpose: 'pipeline_first_booking',
    targetKey: 'demand.pipeline_first_accepted_bookings', targetVersion: 'v1',
    calculationVersion: 'm26-pipeline-first-booking-pooled-v1',
    method: { expectedRevision: 1, expectedDigest: 'e'.repeat(64), action: 'approve', approved: true },
    epoch: { state: 'current', id: id(44), revision: 1, installedAt: '2026-10-03T12:00:00.000000Z' } },
  automaticActionTaken: false, ...flags };
const pipelineSaved = { state: 'pipeline_origin_saved', id: originId,
  predictionCutoffAt: '2026-10-03T12:00:00.000000Z',
  horizonEndsAt: '2026-11-02T12:00:00.000000Z', countWithheld: true,
  outputDigestWithheld: true, replayed: false, ...flags };
const pipelineCurrent = { ...pipelineSaved, state: 'pipeline_origin_current' };
delete pipelineCurrent.replayed;
const pipelineEvaluationSaved = { state: 'pipeline_evaluation_saved', id: evaluationId,
  originId, revision: 1, replayed: false, metricsWithheld: true, ...flags };
const pipelineEvaluationCurrent = { state: 'pipeline_evaluation_current', id: evaluationId,
  originId, revision: 1, evaluatedAt: '2026-11-03T12:00:00.000000Z',
  metricsWithheld: true, ...flags };
const revenueOutlook = {
  version: 'm26-revenue-cash-outlook-v1', state: 'current', reason: null,
  fictional: false, checkedAt: '2026-10-06T12:00:00.000Z', currency: 'USD',
  scope: { label: 'Current supported NorthStar commercial records', wholeBusinessCoverageVerified: false },
  authorizedEstimate: { state: 'current', amountBeforeTax: '18600.00' },
  approvedPrice: { state: 'current', amountBeforeTax: '12400.00' },
  bookedWork: { state: 'current', amountBeforeTax: '7200.00', classification: 'committed' },
  planning: { state: 'current', reason: null, snapshotMode: 'current_at_read',
    capturedAt: '2026-10-06T12:00:00.000Z', horizonStartsAt: '2026-11-01T00:00:00.000Z',
    horizonEndsAt: '2026-12-01T00:00:00.000Z',
    approvedNotBooked: { state: 'current', count: 2, amountBeforeTax: '5200.00', committed: false },
    preliminaryEstimate: { state: 'current', count: 3, amountBeforeTax: '6200.00', committed: false },
    weightsWithheld: true, weightsAreScenarioAssumptions: true,
    probability: { state: 'unavailable', reason: 'calibrated_probability_authority_unavailable' },
    forecastIssued: false },
  earnedRevenue: { state: 'unavailable', amount: null, reason: 'recognition_authority_unavailable' },
  cashTiming: { state: 'unavailable', amount: null, reason: 'financial_period_coverage_unavailable' },
  forecastIssued: false, automaticActionAuthorized: false,
};

async function main() {
  const app = require('../../src/server').app;
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const runtime = resolveBrowserRuntime(process.argv.includes('--webkit') ? 'webkit' : 'chrome');
  const browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
  const results = [];
  try {
    for (const mode of ['paid', 'demo']) for (const viewport of MISSION_26_FIVE_LAYOUTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
        colorScheme: viewport.colorScheme, reducedMotion: 'reduce' });
      await context.addInitScript(() => localStorage.setItem('northstar-quick-start-seen', 'true'));
      const page = await context.newPage();
      const errors = [];
      const outsideRequests = [];
      const forecastRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      let failedWorkspace = false;
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { outsideRequests.push(url.href); return route.abort(); }
        const json = (data, status = 200) => route.fulfill({ status, json: data });
        if (url.pathname === '/api/auth/me') return json(account);
        if (url.pathname === '/api/account/subscription') return json({ subscription: account.account.subscription });
        if (url.pathname === '/api/v1/command-center/workspace') {
          return failedWorkspace ? json({ success: false, error: { message: 'Workspace unavailable.' } }, 503)
            : json({ success: true, data: mode === 'demo' ? demo : paid });
        }
        if (url.pathname === '/api/demo/command-center') {
          return failedWorkspace ? json({ success: false, error: { message: 'Workspace unavailable.' } }, 503)
            : json({ success: true, data: demo });
        }
        if (url.pathname.startsWith('/api/v1/forecast/')) {
          forecastRequests.push({ path: url.pathname, method: route.request().method() });
          if (url.pathname === '/api/v1/forecast/revenue-cash-outlook/current') {
            return json({ success: true, data: revenueOutlook });
          }
          if (url.pathname === '/api/v1/forecast/demand-to-schedule/prerequisites/current') {
            return json({ success: true, data: prerequisites });
          }
          if (url.pathname === '/api/v1/forecast/demand-to-schedule/pipeline-origins') {
            return json({ success: true, data: pipelineSaved }, 201);
          }
          if (url.pathname === `/api/v1/forecast/demand-to-schedule/pipeline-origins/${originId}`) {
            return json({ success: true, data: pipelineCurrent });
          }
          if (url.pathname === `/api/v1/forecast/demand-to-schedule/pipeline-origins/${originId}/evaluations`) {
            return json({ success: true, data: pipelineEvaluationSaved }, 201);
          }
          if (url.pathname === `/api/v1/forecast/demand-to-schedule/pipeline-evaluations/${evaluationId}`) {
            return json({ success: true, data: pipelineEvaluationCurrent });
          }
          return json({ success: false, error: { message: 'Unexpected research route.' } }, 500);
        }
        if (url.pathname.startsWith('/api/')) return json({ success: true, data: {}, items: [], records: [] });
        return route.continue();
      });
      await page.goto(origin + (mode === 'demo' ? '/demo' : '/dashboard'));
      await page.locator('#commandCenterDemandState').getByText(
        mode === 'demo' ? 'Fictional research ready' : 'Research only').waitFor();
      await page.locator('#northstarQuickStartDialog[open]').waitFor({ timeout: 2000 }).catch(() => {});
      if (await page.locator('#northstarQuickStartDialog[open]').count()) {
        await page.locator('#northstarQuickStartDialog .northstar-quick-start-close').click();
      }
      const panel = page.locator('.command-center-demand-outlook');
      const resource = page.locator('.command-center-resource-outlook');
      const range = page.locator('#commandCenterRevenueCashOutlook');
      const text = await panel.innerText();
      assert.match(text, mode === 'demo' ? /fictional isolated demo/i : /guarded research receipts/i);
      assert.match(text, /do(?:es)? not issue a production forecast/i);
      if (mode === 'paid') {
        await page.locator('.command-center-research-setup > summary').click();
        await page.getByRole('button', { name: 'Check current prerequisites', exact: true }).click();
        await page.locator('#commandCenterResearchSetup').getByText('Prerequisites loaded').waitFor({ timeout: 5000 })
          .catch(async error => { throw new Error(`${error.message}\nSetup: ${await page.locator('#commandCenterResearchSetup').innerText()}\nRequests: ${JSON.stringify(forecastRequests)}`); });
        await page.getByRole('button', { name: 'Save pipeline origin', exact: true }).click();
        await page.locator('#commandCenterResearchPipeline').getByText('Research origin saved').waitFor();
        assert.equal(await page.locator('#commandCenterResearchPipelineId').inputValue(), originId);
        await page.getByRole('button', { name: 'Load origin', exact: true }).last().click();
        await page.locator('#commandCenterResearchPipeline').getByText('Evidence is current').waitFor();
        await page.getByRole('button', { name: 'Evaluate after horizon', exact: true }).last().click();
        await page.waitForFunction(expected =>
          document.querySelector('#commandCenterResearchPipelineEvaluationId').value === expected,
        evaluationId).catch(async error => { throw new Error(`${error.message}\nPipeline: ${await page.locator('#commandCenterResearchPipeline').innerText()}\nRequests: ${JSON.stringify(forecastRequests)}`); });
        assert.equal(await page.locator('#commandCenterResearchPipelineEvaluationId').inputValue(), evaluationId);
        await page.getByRole('button', { name: 'Load evaluation', exact: true }).last().click();
        await page.locator('#commandCenterResearchPipeline').getByText('Evidence is current').waitFor();
        assert.equal((await panel.innerText()).includes('0.25'), false);
      } else {
        assert.equal(forecastRequests.length, 0);
        await page.getByRole('button', { name: 'Approve method', exact: true }).click();
        await page.locator('#commandCenterResearchTransitions')
          .getByText('Fictional method approved').waitFor();
        const action = page.locator('#commandCenterResearchDemoAction');
        await action.focus(); assert.equal(await action.evaluate(node => node === document.activeElement), true);
        await page.keyboard.press('Enter');
        await page.locator('#commandCenterDemandState').getByText('Fictional origins saved').waitFor();
        await action.click();
        await page.locator('#commandCenterDemandState').getByText('Fictional evaluations ready').waitFor();
        await action.click();
        await page.locator('#commandCenterDemandState').getByText('Fictional source changed').waitFor();
        await action.click();
        await page.locator('#commandCenterDemandState').getByText('Recovered with new origins').waitFor();
        const recoveredId = await page.locator('#commandCenterResearchPipelineId').inputValue();
        assert.match(recoveredId, /^[0-9a-f-]{36}$/);
        await page.getByRole('button', { name: 'Load origin', exact: true }).last().click();
        await page.locator('#commandCenterResearchPipeline').getByText('Fictional origin loaded').waitFor();
        await page.locator('#commandCenterResearchDemoReset').click();
        await page.locator('#commandCenterDemandState').getByText('Fictional research ready').waitFor();
        assert.equal(await page.locator('#commandCenterResearchPipelineId').inputValue(), '');
        assert.equal(forecastRequests.length, 0);
      }
      await page.locator('#commandCenterResourceState').getByText(
        mode === 'demo' ? 'Fictional example' : 'Unavailable', { exact: true }).waitFor()
        .catch(async error => { throw new Error(`${error.message}\nResource: ${await resource.innerText()}\nPage errors: ${JSON.stringify(errors)}\nMode/layout: ${mode}/${viewport.name}`); });
      assert.match(await resource.innerText(), mode === 'demo' ? /fictional position/i : /authenticated complete-as-of/i);
      assert.match(await resource.innerText(), /Demand is not inventory/i);
      assert.match(await resource.innerText(), /No shortage, reorder, service date, downtime, fuel, capacity, probability, recommendation or automatic action is inferred/i);
      await page.locator('#commandCenterRevenueCashState').getByText(
        mode === 'demo' ? 'Fictional example' : 'Current').waitFor();
      assert.match(await range.innerText(), /owner-confirmed booked work/i);
      assert.match(await range.innerText(), /Planning only/i);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const keyboardTarget = mode === 'demo' ? page.locator('#commandCenterResearchDemoAction') :
        page.getByRole('button', { name: 'Load evaluation', exact: true }).last();
      await keyboardTarget.focus();
      assert.equal(await keyboardTarget.evaluate(node => node === document.activeElement), true);
      const fullReadyScreenshot = path.join(output, `${mode}-${viewport.name}-full-ready.png`);
      await page.screenshot({ path: fullReadyScreenshot, fullPage: true });
      const readyScreenshot = path.join(output, `${mode}-${viewport.name}-unavailable.png`);
      await panel.screenshot({ path: readyScreenshot });
      const resourceReadyScreenshot = path.join(output, `${mode}-${viewport.name}-resource-unavailable.png`);
      await page.locator('.command-center-outlook-grid').screenshot({ path: resourceReadyScreenshot });
      const rangeReadyScreenshot = path.join(output, `${mode}-${viewport.name}-range-unavailable.png`);
      await range.screenshot({ path: rangeReadyScreenshot });
      await page.waitForFunction(() => !document.querySelector('#commandCenterRefresh').disabled);
      failedWorkspace = true;
      if (mode === 'demo') await page.reload();
      else await page.locator('#commandCenterRefresh').evaluate(button => button.click());
      await page.locator('#commandCenterDemandState').getByText('Workspace unavailable').waitFor();
      await page.locator('#commandCenterResourceState').getByText('Workspace unavailable').waitFor();
      await page.locator('#commandCenterRevenueCashState').getByText('Unavailable').waitFor();
      if (await page.locator('#northstarQuickStartDialog[open]').count()) await page.keyboard.press('Escape');
      assert.match(await panel.innerText(), /Refresh the workspace before/i);
      assert.match(await resource.innerText(), /Refresh to retry loading current resource positions/);
      assert.match(await range.innerText(), /Refresh Command Center to try again/);
      const failedScreenshot = path.join(output, `${mode}-${viewport.name}-workspace-failed.png`);
      await panel.screenshot({ path: failedScreenshot });
      failedWorkspace = false;
      if (mode === 'demo') await page.reload();
      else await page.locator('#commandCenterRefresh').evaluate(button => button.click());
      await page.locator('#commandCenterDemandState').getByText(
        mode === 'demo' ? 'Fictional research ready' : 'Research only').waitFor();
      await page.locator('#commandCenterResourceState').getByText(
        mode === 'demo' ? 'Fictional example' : 'Unavailable', { exact: true }).waitFor();
      await page.locator('#commandCenterRevenueCashState').getByText(
        mode === 'demo' ? 'Fictional example' : 'Current').waitFor();
      if (await page.locator('#northstarQuickStartDialog[open]').count()) await page.keyboard.press('Escape');
      assert.match(await panel.innerText(), mode === 'demo' ? /fictional isolated demo/i : /guarded research receipts/i);
      assert.match(await resource.innerText(), mode === 'demo' ? /fictional position/i : /authenticated complete-as-of/i);
      assert.match(await range.innerText(), /owner-confirmed booked work/i);
      assert.equal(errors.length, 0, errors.join('\n'));
      assert.deepEqual(outsideRequests, []);
      const renderedAudit = await auditRenderedPage(page, {
        mainSelector: '#commandCenterMain', layout: viewport,
      });
      await exerciseSkipLink(page, { mainSelector: '#commandCenterMain' });
      const recoveredScreenshot = path.join(output, `${mode}-${viewport.name}-recovered.png`);
      await page.screenshot({ path: recoveredScreenshot, fullPage: true });
      results.push({ mode, viewport: viewport.name, success: true, readyScreenshot,
        fullReadyScreenshot, resourceReadyScreenshot, rangeReadyScreenshot,
        failedScreenshot, recoveredScreenshot, renderedAudit, outsideRequests,
        forecastRequests: forecastRequests.slice() });
      await context.close();
    }
    const sourceFiles = ['public/demo-dashboard.html',
      'public/js/command-center-demand-research.js',
      'public/js/command-center-demand-position.js',
      'public/js/command-center-page.js', 'public/css/demo-dashboard.css',
      'tests/helpers/m26-part12d-rendered-review.js'];
    const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' }).trim();
    const captures = fs.readdirSync(output).filter(file => file.endsWith('.png'))
      .sort().map(file => ({ file, sha256: sha256(path.join(output, file)) }));
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({
      capturedAt: new Date().toISOString(), head, tree, worktreeStatus: status,
      sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, sha256(file)])),
      captures,
      browser: process.argv.includes('--webkit') ? 'Playwright WebKit' : 'Chrome', results,
      limits: 'Synthetic intercepted sources; no live provider, private production, calibrated forecast or physical Safari evidence.',
    }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ cases: results.length, success: true }));
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
