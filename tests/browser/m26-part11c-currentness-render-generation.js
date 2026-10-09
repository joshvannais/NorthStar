'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { buildPaidWorkspace } = require('../../src/commandCenter/workspace');

const engine = process.argv[2];
const output = path.resolve(process.argv[3]);
fs.mkdirSync(output, { recursive: true });

const tenantId = '114c0000-0000-4000-8000-000000000001';
const actorId = '114c0000-0000-4000-8000-000000000002';
const categories = ['unassigned', 'due', 'overdue', 'atRisk', 'conflicting'];
const scheduling = {
  version: 'm22-part5-overview-v1', timeZone: 'America/New_York', digest: 'a'.repeat(64),
  total: 0, shown: 0, page: { size: 100, shown: 0, total: 0, cursor: null, nextCursor: null },
  definitions: Object.fromEntries(categories.map(key => [key, 'Current scheduling category'])),
  categories: Object.fromEntries(categories.map(key => [key, []])),
  counts: Object.fromEntries(categories.map(key => [key, 0])), records: [],
};
const operator = {
  canRead: true, canMutate: false, reason: 'subscription_read_only', targets: [],
  digest: 'b'.repeat(64), truncated: false,
  discovery: { version: 'm22-part5-target-directory-v1',
    endpoint: '/api/v1/canonical/operator-targets', pageSize: 100,
    shown: 0, total: 0, truncated: false },
};
const workspace = buildPaidWorkspace({ context: { organizationId: tenantId }, items: [],
  schedulingOperator: operator, schedulingOverview: scheduling });
const account = {
  user: { id: actorId, name: 'Currentness Owner', email: 'owner@example.com', status: 'active' },
  organization: { id: tenantId, name: 'Currentness Business' },
  membership: { role: 'owner', status: 'active' },
};
const html = fs.readFileSync(path.resolve('public/demo-dashboard.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

function decision(state, suffix) {
  const unavailable = state === 'unavailable';
  return {
    version: 'm26-forecast-run-currentness-v1', state,
    reason: unavailable ? 'source_revoked' : 'unchanged_candidate',
    reasons: [unavailable ? 'source_revoked' : 'unchanged_candidate'],
    runId: unavailable ? null : `114c0000-0000-4000-8000-${String(suffix).padStart(12, '0')}`,
    runDigest: unavailable ? null : String(suffix).repeat(64).slice(0, 64),
    adviceDisplayAuthorized: false,
    digest: String(suffix + 4).repeat(64).slice(0, 64),
  };
}

async function main() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let page;
  const errors = [];
  const result = { engine, pass: false, cases: [],
    boundary: 'Local synthetic browser race against the production Command Center orchestrator; no provider or private-production evidence.' };
  try {
    const runtime = resolveBrowserRuntime(engine);
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/dashboard');
    await page.addScriptTag({ path: path.resolve('public/js/command-center-contract.js') });
    await page.addScriptTag({ path: path.resolve('public/js/display-projection.js') });
    await page.evaluate(({ workspace, account }) => {
      window.__forecastControllers = [];
      window.__currentnessPending = [];
      function controller(name) {
        const state = { name, kind: 'initial', ready: 0, unavailable: 0, loading: 0 };
        window.__forecastControllers.push(state);
        return {
          workspaceLoading() { state.kind = 'loading'; state.loading += 1; },
          workspaceReady() { state.kind = 'ready'; state.ready += 1; return Promise.resolve(true); },
          workspaceUnavailable() { state.kind = 'unavailable'; state.unavailable += 1; },
        };
      }
      const noOpController = () => ({
        workspaceReady() {}, workspaceUnavailable() {}, workspaceLoading() {},
      });
      window.NorthStarDemandPosition = { create: noOpController };
      window.NorthStarDemandResearch = { create: noOpController };
      window.NorthStarForecastRanges = { create: () => controller('ranges') };
      window.NorthStarForecastTimeline = { create: () => controller('timeline') };
      window.NorthStarMonthlyForecastKpis = { create: () => controller('kpis') };
      window.NorthStarForecastDrilldowns = { create: () => controller('drilldowns') };
      window.NorthStarForecastDecisionSupport = { create: () => controller('decision-support') };
      const response = data => ({ ok: true, status: 200,
        json: async () => ({ success: true, data }) });
      window.NorthStarAccountSession = {
        getAccount: () => account,
        load: async () => account,
        fetch: url => {
          if (String(url).startsWith('/api/v1/command-center/workspace')) {
            return Promise.resolve(response(workspace));
          }
          if (url === '/api/v1/forecast/runs/currentness') {
            return new Promise((resolve, reject) => {
              window.__currentnessPending.push({
                resolve: data => resolve(response(data)), reject,
              });
            });
          }
          return Promise.reject(new Error('Unexpected browser request: ' + url));
        },
      };
    }, { workspace, account });
    await page.addScriptTag({ path: path.resolve('public/js/command-center-page.js') });

    await page.waitForFunction(() => window.__currentnessPending.length === 1 &&
      !document.querySelector('#commandCenterRefresh').disabled);
    await page.locator('#commandCenterRefresh').click();
    await page.waitForFunction(() => window.__currentnessPending.length === 2 &&
      !document.querySelector('#commandCenterRefresh').disabled);
    await page.evaluate(value => window.__currentnessPending[1].resolve(value), decision('unavailable', 1));
    await page.waitForFunction(() => window.__forecastControllers.length === 5 &&
      window.__forecastControllers.every(item => item.kind === 'unavailable'));
    await page.evaluate(value => window.__currentnessPending[0].resolve(value), decision('unchanged_candidate', 2));
    await page.waitForTimeout(75);
    let states = await page.evaluate(() => structuredClone(window.__forecastControllers));
    assert.equal(states.length, 5);
    assert.ok(states.every(item => item.kind === 'unavailable' && item.ready === 0),
      `obsolete success reactivated a surface: ${JSON.stringify(states)}`);
    result.cases.push({ name: 'older-current-cannot-reactivate-newer-unavailable', states });

    await page.locator('#commandCenterRefresh').click();
    await page.waitForFunction(() => window.__currentnessPending.length === 3 &&
      !document.querySelector('#commandCenterRefresh').disabled);
    await page.locator('#commandCenterRefresh').click();
    await page.waitForFunction(() => window.__currentnessPending.length === 4 &&
      !document.querySelector('#commandCenterRefresh').disabled);
    await page.evaluate(value => window.__currentnessPending[3].resolve(value), decision('unchanged_candidate', 3));
    await page.waitForFunction(() => window.__forecastControllers.every(item => item.kind === 'ready'));
    await page.evaluate(() => window.__currentnessPending[2].reject(new Error('obsolete request failed')));
    await page.waitForTimeout(75);
    states = await page.evaluate(() => structuredClone(window.__forecastControllers));
    assert.ok(states.every(item => item.kind === 'ready' && item.ready === 1),
      `obsolete failure cleared a newer surface: ${JSON.stringify(states)}`);
    assert.deepEqual(errors, []);
    result.cases.push({ name: 'older-failure-cannot-clear-newer-current', states });
    result.pass = true;
    await context.close();
  } catch (error) {
    result.error = error.stack;
    if (page) {
      result.diagnostic = await page.evaluate(() => ({
        pending: window.__currentnessPending && window.__currentnessPending.length,
        controllers: window.__forecastControllers,
        status: document.querySelector('#commandCenterStatus') &&
          document.querySelector('#commandCenterStatus').textContent,
        refreshDisabled: document.querySelector('#commandCenterRefresh') &&
          document.querySelector('#commandCenterRefresh').disabled,
      })).catch(() => null);
      result.pageErrors = errors;
    }
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    fs.writeFileSync(path.join(output, 'RESULT.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
