'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const ROOT = path.resolve(__dirname, '..', '..');
const ROUTES = Object.freeze([
  '/demo', '/demo/polaris', '/demo/leads', '/demo/communications', '/demo/my-number',
  '/demo/calendar', '/demo/team', '/demo/ai-settings', '/demo/business-profile',
  '/demo/settings', '/demo/integrations',
]);
const VIEWPORTS = Object.freeze([
  Object.freeze({ label: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ label: 'mobile', width: 390, height: 844 }),
]);
const PROVIDER_ENVIRONMENT = Object.freeze([
  'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
  'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET',
]);

function treeDigest(directory) {
  const hash = crypto.createHash('sha256');
  function visit(current) {
    if (!fs.existsSync(current)) return;
    fs.readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name)).forEach(entry => {
      const absolute = path.join(current, entry.name);
      hash.update(path.relative(directory, absolute).replace(/\\/g, '/'));
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
    });
  }
  visit(directory);
  return hash.digest('hex');
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function waitReady(page, revision) {
  await page.waitForFunction(expected => {
    const api = window.NorthStarDemoCommandCenter;
    const value = api && api.getWorkspace();
    return value && value.integrity.revision === expected &&
      document.getElementById('demoCommandContent').getAttribute('aria-busy') === 'false';
  }, revision, { timeout: 10000 });
}

async function visit(page, origin, route, revision) {
  const response = await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 10000 });
  assert.ok(response, route + ' navigation response');
  assert.ok([200, 304].includes(response.status()), route + ' shell HTTP ' + response.status());
  await waitReady(page, revision);
  const snapshot = await page.evaluate(() => ({
    active: Array.from(document.querySelectorAll('.demo-command-nav-link[aria-current="page"]')).map(node => node.dataset.navId),
    links: Array.from(document.querySelectorAll('.demo-command-nav-link')).map(node => ({ id: node.dataset.navId, href: node.getAttribute('href') })),
    workspace: window.NorthStarDemoCommandCenter.getWorkspace(),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.textContent,
  }));
  assert.strictEqual(snapshot.active.length, 1, route + ' one active route');
  assert.strictEqual(snapshot.links.length, 11, route + ' complete demo navigation');
  assert.ok(snapshot.links.every(item => item.href === '/demo' || item.href.startsWith('/demo/')), route + ' account-free destinations');
  assert.ok(snapshot.overflow <= 1, route + ' no horizontal overflow');
  assert.strictEqual(snapshot.workspace.integrity.revision, revision, route + ' shared revision');
  return snapshot;
}

async function exerciseViewport(browser, origin, viewport, ledger) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('request', request => ledger.requests.push({ viewport: viewport.label, method: request.method(), url: request.url() }));
  page.on('console', message => { if (message.type() === 'error') ledger.consoleErrors.push(viewport.label + ': ' + message.text()); });
  page.on('pageerror', error => ledger.pageErrors.push(viewport.label + ': ' + error.message));
  try {
    const initial = await visit(page, origin, '/demo', 1);
    assert.strictEqual(initial.workspace.session.durable, false, viewport.label + ' GET remains projection-only');
    assert.strictEqual(initial.workspace.graphs.length, 3, viewport.label + ' seed graph count');
    const initialConfiguration = initial.workspace.configuration;
    const initialNavigation = initial.workspace.navigation;
    const initialDigest = initial.workspace.integrity.digest;

    // The initial visit above already ratifies /demo. Avoid a consecutive
    // same-URL goto, for which WebKit correctly may return no new response.
    for (const route of ROUTES.slice(1)) {
      const snapshot = await visit(page, origin, route, 1);
      assert.strictEqual(snapshot.workspace.integrity.digest, initialDigest, route + ' exact initial digest');
    }

    await visit(page, origin, '/demo', 1);
    await page.selectOption('#demoScenario', 'fence');
    await page.click('#demoSimulateLead');
    await waitReady(page, 2);
    const simulated = await page.evaluate(() => window.NorthStarDemoCommandCenter.getWorkspace());
    assert.strictEqual(simulated.session.durable, true, viewport.label + ' explicit mutation creates durable session');
    assert.strictEqual(simulated.session.simulationCount, 1, viewport.label + ' simulation count');
    assert.strictEqual(simulated.graphs.length, 4, viewport.label + ' one added graph');
    assert.notStrictEqual(simulated.integrity.digest, initialDigest, viewport.label + ' state digest advances');
    assert.deepStrictEqual(simulated.configuration, initialConfiguration, viewport.label + ' configuration remains stable');
    assert.deepStrictEqual(simulated.navigation, initialNavigation, viewport.label + ' navigation remains stable');
    const added = simulated.graphs[0];
    assert.strictEqual(added.lead.serviceType, 'fence', viewport.label + ' selected scenario');
    assert.strictEqual(added.polaris.completeDetail, true, viewport.label + ' complete Polaris detail');
    assert.match(added.polaris.snapshotDigest, /^[0-9a-f]{64}$/, viewport.label + ' snapshot digest');

    for (const route of ['/demo', '/demo/leads', '/demo/communications', '/demo/calendar']) {
      const snapshot = await visit(page, origin, route, 2);
      assert.ok(snapshot.body.includes(added.customer.name), route + ' reads the newly committed customer');
    }
    const detailPath = '/demo/polaris?kind=lead&id=' + encodeURIComponent(added.ids.lead);
    const detail = await visit(page, origin, detailPath, 2);
    assert.ok(detail.body.includes(added.ids.customer), viewport.label + ' customer authority ID visible');
    assert.ok(detail.body.includes(added.ids.lead), viewport.label + ' lead authority ID visible');
    assert.ok(detail.body.includes(added.ids.work), viewport.label + ' work authority ID visible');
    assert.ok(detail.body.includes(added.polaris.snapshotDigest), viewport.label + ' Polaris digest visible');
    assert.ok(detail.body.includes('Supporting facts'), viewport.label + ' full supporting facts visible');
    assert.ok(detail.body.includes('Not calculated'), viewport.label + ' bounded calculation limitations visible');

    for (const route of ['/demo/team', '/demo/ai-settings', '/demo/business-profile', '/demo/settings', '/demo/integrations']) {
      const snapshot = await visit(page, origin, route, 2);
      assert.deepStrictEqual(snapshot.workspace.configuration, initialConfiguration, route + ' configuration stability');
    }

    await visit(page, origin, '/demo', 2);
    await page.click('#demoReset');
    await waitReady(page, 3);
    const reset = await page.evaluate(() => window.NorthStarDemoCommandCenter.getWorkspace());
    assert.strictEqual(reset.graphs.length, 3, viewport.label + ' reset restores seed graph count');
    assert.strictEqual(reset.session.simulationCount, 0, viewport.label + ' reset count');
    assert.deepStrictEqual(reset.configuration, initialConfiguration, viewport.label + ' reset preserves configuration');
    assert.ok(!reset.graphs.some(graph => graph.ids.graph === added.ids.graph), viewport.label + ' reset removes only session-added graph');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitReady(page, 3);
    const reloaded = await page.evaluate(() => window.NorthStarDemoCommandCenter.getWorkspace());
    assert.strictEqual(reloaded.session.durable, true, viewport.label + ' durable state survives reload');
    assert.strictEqual(reloaded.integrity.digest, reset.integrity.digest, viewport.label + ' reload digest');
    return { viewport: viewport.label, sessionId: reloaded.session.id, finalDigest: reloaded.integrity.digest };
  } finally {
    await context.close();
  }
}

async function main() {
  const selected = process.env.NORTHSTAR_BROWSER;
  assert.ok(selected === 'chrome' || selected === 'webkit', 'NORTHSTAR_BROWSER must be chrome or webkit');
  const runtime = resolveBrowserRuntime(selected);
  const suiteDatabase = await createSuiteDatabase('cc-parity-browser');
  const originalEnvironment = new Map();
  for (const name of PROVIDER_ENVIRONMENT.concat(['DATABASE_URL', 'NODE_ENV'])) originalEnvironment.set(name, process.env[name]);
  const beforeData = treeDigest(path.join(ROOT, 'data'));
  let db;
  let server;
  let browser;
  const originalFetch = global.fetch;
  try {
    for (const name of PROVIDER_ENVIRONMENT) delete process.env[name];
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.NODE_ENV = 'test';
    process.chdir(ROOT);
    db = require('../../src/db');
    assert.strictEqual(await db.initDatabase(), true, 'disposable PostgreSQL initialized');
    global.fetch = async function () { throw new Error('provider boundary must remain unused'); };
    const { app } = require('../../src/server');
    server = await listen(app);
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await runtime.browserType.launch({ executablePath: runtime.executablePath, headless: true });
    const ledger = { requests: [], consoleErrors: [], pageErrors: [] };
    const receipts = [];
    for (const viewport of VIEWPORTS) receipts.push(await exerciseViewport(browser, origin, viewport, ledger));

    const external = ledger.requests.filter(entry => new URL(entry.url).origin !== origin);
    const mutations = ledger.requests.filter(entry => entry.method !== 'GET' && entry.method !== 'HEAD' && entry.method !== 'OPTIONS');
    assert.deepStrictEqual(external, [], 'all browser traffic remains on the disposable loopback origin');
    assert.strictEqual(mutations.length, VIEWPORTS.length * 2, 'one simulate and one reset per viewport');
    assert.ok(mutations.every(entry => {
      const pathname = new URL(entry.url).pathname;
      return entry.method === 'POST' && (pathname === '/api/demo/command-center/simulations/leads' || pathname === '/api/demo/command-center/reset');
    }), 'only bounded demo mutations occur');
    assert.deepStrictEqual(ledger.consoleErrors, [], 'browser console errors');
    assert.deepStrictEqual(ledger.pageErrors, [], 'browser page errors');

    const pool = db.getPool();
    const rows = (await pool.query(
      `SELECT count(*)::int AS sessions,
              count(DISTINCT tenant_id)::int AS tenants,
              min(revision)::int AS minimum_revision,
              max(simulation_count)::int AS maximum_simulation_count,
              bool_and(token_hash ~ '^[0-9a-f]{64}$') AS token_hashes_only
         FROM demo_command_center_sessions`
    )).rows[0];
    assert.deepStrictEqual(rows, {
      sessions: VIEWPORTS.length,
      tenants: VIEWPORTS.length,
      minimum_revision: 3,
      maximum_simulation_count: 0,
      token_hashes_only: true,
    }, 'one isolated durable tenant/session per browser context');

    console.log('COMMAND_CENTER_PARITY_BROWSER_RECEIPT ' + JSON.stringify({
      browser: selected,
      version: browser.version(),
      viewports: VIEWPORTS.map(value => value.label),
      routes: ROUTES.length,
      receipts,
      requests: ledger.requests.length,
      mutations: mutations.length,
      externalRequests: external.length,
      consoleErrors: ledger.consoleErrors.length,
      pageErrors: ledger.pageErrors.length,
      postgres: rows,
    }));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
    if (db) await db.close();
    global.fetch = originalFetch;
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await suiteDatabase.cleanup();
    assert.strictEqual(treeDigest(path.join(ROOT, 'data')), beforeData, 'browser test does not alter repository data');
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
