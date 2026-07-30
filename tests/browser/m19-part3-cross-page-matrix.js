'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { EXTREME_FENCE_SUBTOTAL } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');

const IDS = Object.freeze({
  operation: '10000000-0000-4000-8000-000000000001',
  graph: '10000000-0000-4000-8000-000000000002',
  customer: '10000000-0000-4000-8000-000000000003',
  transcript: '10000000-0000-4000-8000-000000000004',
  communication: '10000000-0000-4000-8000-000000000005',
  opportunity: '10000000-0000-4000-8000-000000000006',
  estimate: '10000000-0000-4000-8000-000000000007',
  appointment: '10000000-0000-4000-8000-000000000008',
  polarisSnapshot: '10000000-0000-4000-8000-000000000009',
});
const ORG_A = '20000000-0000-4000-8000-000000000001';
const ORG_B = '20000000-0000-4000-8000-000000000002';
const USER_A = '30000000-0000-4000-8000-000000000001';
const USER_B = '30000000-0000-4000-8000-000000000002';
const SESSION_A = 'm19-browser-session-a';
const DIGEST = 'a'.repeat(64);
const SNAPSHOT_DIGEST = 'b'.repeat(64);
const PROJECTION_DIGEST = 'c'.repeat(64);
const VALUES = Object.freeze({
  organizationId: ORG_A,
  customerId: IDS.customer,
  opportunityId: IDS.opportunity,
  calculationVersion: 'm19-part3-canonical-v2',
  normalizedInputFingerprint: 'd'.repeat(64),
  businessProfileInputVersion: 'fixture-v1',
  businessProfileInputHash: 'e'.repeat(64),
  service: {
    key: 'fence',
    label: 'Persisted Profile Fence',
    supported: true,
    unpricedReason: null,
    scope: { linearFeet: 100, material: 'cedar', removalRequired: true, gates: [{ type: 'walk' }], heightFeet: 6 },
  },
  customerFacingPrice: EXTREME_FENCE_SUBTOTAL,
  subtotalBeforeTax: EXTREME_FENCE_SUBTOTAL,
  taxRatePercent: 0,
  tax: 0,
  taxDisposition: { status: 'calculated', reason: null },
  totalIncludingTax: EXTREME_FENCE_SUBTOTAL,
  preliminaryRange: { low: 33638.4, high: 41113.6 },
  pricingLineItems: [
    { code: 'profile-profile-labor', label: 'Profile labor per foot', category: 'labor', customerCharge: 9900 },
    { code: 'profile-profile-material', label: 'Profile material per foot', category: 'materials', customerCharge: 12300 },
    { code: 'profile-profile-permit', label: 'Profile permit charge', category: 'serviceCharge', customerCharge: 9999 },
    { code: 'profile-profile-gates', label: 'Profile gate charge', category: 'materials', customerCharge: 777 },
    { code: 'profile-profile-removal', label: 'Profile removal per foot', category: 'labor', customerCharge: 4400 },
  ],
  materialsCharge: 13077,
  knownDirectMaterialCost: null,
  laborCharge: 14300,
  laborHours: 24,
  knownInternalLaborCost: null,
  equipmentCharge: 0,
  knownEquipmentCost: null,
  equipmentReference: null,
  travel: { minutes: 35, distanceMiles: 18, source: 'fixture-map', customerCharge: null, knownInternalCost: null },
  callDurationSeconds: 240,
  estimatedProductionDurationHours: 24,
  crewRecommendation: { size: 2, source: 'business-profile' },
  actualCrewAssignment: null,
  estimatedRevenue: EXTREME_FENCE_SUBTOTAL,
  knownDirectCosts: null,
  grossProfit: null,
  grossMarginPercent: null,
  overhead: null,
  netProfit: null,
  netMarginPercent: null,
  confidence: { score: 100, factors: [{ field: 'scope', available: true }] },
  risk: { emergency: false, signal: null, evidence: null, evidenceTurnId: null, contradictoryFactIds: [] },
  recommendedActions: ['Schedule the requested weekday-morning estimate.'],
  appointmentPreference: { dayPart: 'morning', weekdaysOnly: true },
  supportingTranscriptFactIds: ['scope-length', 'scope-material', 'scope-removal', 'scope-gate'],
  notCalculated: [
    { field: 'grossProfit', reason: 'All applicable direct-cost components must be known.' },
    { field: 'netProfit', reason: 'Net profit requires gross profit and explicit overhead.' },
  ],
});

function canonicalItem(values = VALUES) {
  return {
    ids: IDS,
    calculationVersion: values.calculationVersion,
    snapshotDigest: SNAPSHOT_DIGEST,
    projectionDigest: PROJECTION_DIGEST,
    values,
  };
}

function recordFor(surface, item) {
  const customer = { id: IDS.customer, name: 'Avery Cedar', email: 'avery@example.test', phone: '+15555550101', address: '100 North Star Way' };
  if (surface === 'customer-detail') return { ...customer, canonical: item };
  if (surface === 'leads') return { id: IDS.opportunity, status: 'open', serviceType: 'fence-installation', scope: VALUES.service.scope, customer, canonical: item };
  if (surface === 'communications') return {
    id: IDS.communication,
    channel: 'call',
    direction: 'inbound',
    subject: 'Fence estimate request',
    transcript: { id: IDS.transcript, text: 'Customer: I need a new 100-foot cedar fence.', durationSeconds: 240 },
    customer,
    canonical: item,
  };
  if (surface === 'calendar') return {
    id: IDS.appointment,
    preference: VALUES.appointmentPreference,
    scheduledStart: '2026-07-27T09:00:00.000Z',
    scheduledEnd: '2026-07-27T10:00:00.000Z',
    status: 'scheduled',
    customer,
    opportunity: { id: IDS.opportunity, status: 'open', serviceType: 'fence-installation' },
    canonical: item,
  };
  if (surface === 'estimates') return {
    id: IDS.estimate,
    currency: 'USD',
    customerPrice: VALUES.customerFacingPrice,
    lineItems: VALUES.pricingLineItems,
    canonical: item,
  };
  return item;
}

function projection(surface, sessionId, mode) {
  const serverItem = canonicalItem();
  const items = mode === 'collision'
    ? [canonicalItem({ ...VALUES, customerFacingPrice: 999999, estimatedRevenue: 999999 }), serverItem]
    : [serverItem];
  const authority = {
    organizationId: mode === 'wrong-organization' ? ORG_B : ORG_A,
    userId: USER_A,
    sessionId: mode === 'wrong-session' ? 'wrong-session' : sessionId,
    explicitSession: mode === 'wrong-session' ? 'wrong-session' : sessionId,
  };
  return {
    surface,
    authority,
    readModelVersion: 'm19-part3-read-v1',
    digest: mode === 'malformed' ? 'not-a-digest' : DIGEST,
    items,
    records: [recordFor(surface, serverItem)],
    metrics: {
      graphCount: 1,
      customerCount: 1,
      estimatedRevenue: EXTREME_FENCE_SUBTOTAL,
      knownGrossProfit: null,
      appointmentCount: 1,
      snapshotDigests: [SNAPSHOT_DIGEST],
    },
  };
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function fileForUrl(urlPath) {
  const routes = {
    '/dashboard': 'dashboard.html',
    '/dashboard/lead': 'dashboard/lead.html',
    '/dashboard/leads': 'dashboard/leads.html',
    '/dashboard/communications': 'dashboard/communications.html',
    '/dashboard/calendar': 'dashboard/calendar.html',
    '/dashboard/command-center': 'dashboard/command-center.html',
    '/dashboard/polaris': 'dashboard/polaris.html',
    '/dashboard/executive-brief': 'dashboard/executive-brief.html',
  };
  const relative = routes[urlPath] || urlPath.replace(/^\//, '');
  const resolved = path.resolve(PUBLIC, relative);
  if (resolved !== PUBLIC && !resolved.startsWith(PUBLIC + path.sep)) return null;
  return resolved;
}

async function startStaticServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const file = fileForUrl(decodeURIComponent(url.pathname));
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

function initialIdentity(options) {
  const sessionId = options.sessionId;
  const injectBusinessCache = options.injectBusinessCache;
  localStorage.setItem('token', 'fixture-token-a');
  localStorage.setItem('user', JSON.stringify({ id: '30000000-0000-4000-8000-000000000001', organizationId: '20000000-0000-4000-8000-000000000001' }));
  if (!sessionStorage.getItem('northstarSessionId')) {
    window.name = 'northstar-tab:fixture-primary';
    sessionStorage.setItem('northstarSessionOwner', window.name);
    sessionStorage.setItem('northstarSessionId', sessionId);
  }
  if (injectBusinessCache) {
    localStorage.setItem('northstarCanonicalProjection', JSON.stringify({ ids: { graph: '10000000-0000-4000-8000-000000000002' }, values: { customerFacingPrice: 999999 } }));
    sessionStorage.setItem('northstar_calls', JSON.stringify([{ id: '10000000-0000-4000-8000-000000000006', avgPrice: 999999 }]));
  }
}

async function waitForSurface(page, surface) {
  await page.waitForFunction((expected) => {
    return window.CanonicalIntelligence && window.CanonicalIntelligence.getProjection(expected);
  }, surface, { timeout: 10000 });
  return page.evaluate((expected) => JSON.parse(JSON.stringify(window.CanonicalIntelligence.getPresentation(expected))), surface);
}

async function waitForRejection(page) {
  await page.waitForFunction(() => document.documentElement.dataset.canonicalAuthority === 'rejected', null, { timeout: 10000 });
  return page.evaluate(() => ({
    authority: document.documentElement.dataset.canonicalAuthority,
    projections: ['customer-detail', 'leads', 'communications', 'calendar', 'command-center', 'polaris', 'executive', 'estimates'].filter((surface) => window.CanonicalIntelligence.getProjection(surface)),
  }));
}

async function main() {
  const selected = (process.argv.find((value) => value.startsWith('--browser=')) || '--browser=chrome').split('=')[1];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  const { browserType, executablePath } = resolveBrowserRuntime(selected);

  const { server, origin } = await startStaticServer();
  let browser;
  const requestLedger = [];
  let mode = 'normal';
  try {
    browser = await browserType.launch({ headless: true, executablePath });
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('token', 'fixture-token-a');
      localStorage.setItem('user', JSON.stringify({ id: '30000000-0000-4000-8000-000000000001', organizationId: '20000000-0000-4000-8000-000000000001' }));
    });
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const method = request.method();
      const url = new URL(request.url());
      requestLedger.push({
        method,
        path: url.pathname,
        authorization: request.headers().authorization || null,
      });
      if (method !== 'GET' && method !== 'HEAD') {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNEXPECTED_MUTATION' } }) });
        return;
      }
      const match = url.pathname.match(/^\/api\/v1\/canonical\/(compat|surfaces)\/([^/]+)$/);
      if (!match) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      if (mode === 'delay') await new Promise((resolve) => setTimeout(resolve, 500));
      if (mode === 'rejected') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'CANONICAL_PERSISTENCE_UNAVAILABLE' } }) });
        return;
      }
      const surface = decodeURIComponent(match[2]);
      const sessionId = request.headers()['x-northstar-session-id'] || null;
      const data = projection(surface, sessionId, mode);
      if (match[1] === 'surfaces') {
        delete data.records;
        delete data.metrics;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    });

    const pages = [
      { surface: 'customer-detail', url: `/dashboard/lead?id=${IDS.opportunity}`, also: 'estimates' },
      { surface: 'leads', url: '/dashboard/leads', also: 'estimates' },
      { surface: 'communications', url: '/dashboard/communications' },
      { surface: 'calendar', url: '/dashboard/calendar' },
      { surface: 'command-center', url: '/dashboard/command-center' },
      { surface: 'polaris', url: '/dashboard/polaris' },
      { surface: 'executive', url: '/dashboard/executive-brief' },
    ];
    const equality = [];
    for (const testCase of pages) {
      mode = 'normal';
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(initialIdentity, { sessionId: SESSION_A, injectBusinessCache: false });
      await page.goto(origin + testCase.url, { waitUntil: 'domcontentloaded' });
      const presented = await waitForSurface(page, testCase.surface);
      assert.deepStrictEqual(presented.ids, IDS, `${testCase.surface}: stable IDs`);
      assert.strictEqual(presented.readModelVersion, 'm19-part3-read-v1', `${testCase.surface}: read-model version`);
      assert.strictEqual(presented.calculationVersion, VALUES.calculationVersion, `${testCase.surface}: calculation version`);
      assert.strictEqual(presented.digest, DIGEST, `${testCase.surface}: projection digest`);
      assert.strictEqual(presented.snapshotDigest, SNAPSHOT_DIGEST, `${testCase.surface}: snapshot digest`);
      assert.strictEqual(presented.price, VALUES.customerFacingPrice, `${testCase.surface}: price`);
      assert.deepStrictEqual(presented.scope, VALUES.service.scope, `${testCase.surface}: scope`);
      assert.deepStrictEqual(presented.labor, { charge: VALUES.laborCharge, hours: VALUES.laborHours, knownInternalCost: VALUES.knownInternalLaborCost }, `${testCase.surface}: labor`);
      assert.deepStrictEqual(presented.duration, { callSeconds: VALUES.callDurationSeconds, productionHours: VALUES.estimatedProductionDurationHours }, `${testCase.surface}: duration`);
      assert.deepStrictEqual(presented.travel, VALUES.travel, `${testCase.surface}: travel`);
      assert.deepStrictEqual(presented.profit, { gross: null, grossMarginPercent: null, net: null, netMarginPercent: null }, `${testCase.surface}: profit`);
      assert.deepStrictEqual(presented.confidence, VALUES.confidence, `${testCase.surface}: confidence`);
      assert.deepStrictEqual(presented.risk, VALUES.risk, `${testCase.surface}: risk`);
      assert.deepStrictEqual(presented.recommendations, VALUES.recommendedActions, `${testCase.surface}: recommendations`);
      if (testCase.also) {
        const estimate = await waitForSurface(page, testCase.also);
        assert.strictEqual(estimate.snapshotDigest, SNAPSHOT_DIGEST, `${testCase.surface}: estimate snapshot equality`);
        assert.strictEqual(estimate.price, VALUES.customerFacingPrice, `${testCase.surface}: estimate price equality`);
      }
      assert.deepStrictEqual(errors, [], `${testCase.surface}: uncaught page errors`);
      equality.push({ surface: testCase.surface, graph: presented.ids.graph, digest: presented.digest, snapshotDigest: presented.snapshotDigest, price: presented.price });
      await page.close();
    }
    assert.strictEqual(new Set(equality.map((entry) => entry.graph)).size, 1, 'all seven surfaces share one graph');
    assert.strictEqual(new Set(equality.map((entry) => entry.digest)).size, 1, 'all seven surfaces share one digest');
    assert.strictEqual(new Set(equality.map((entry) => entry.snapshotDigest)).size, 1, 'all seven surfaces share one snapshot');

    mode = 'collision';
    const collisionPage = await context.newPage();
    await collisionPage.addInitScript(initialIdentity, { sessionId: SESSION_A, injectBusinessCache: true });
    await collisionPage.goto(origin + '/dashboard/leads', { waitUntil: 'domcontentloaded' });
    const collision = await waitForSurface(collisionPage, 'leads');
    assert.strictEqual(collision.price, EXTREME_FENCE_SUBTOTAL, 'server result wins storage and duplicate-ID collisions');
    const cachedPrices = await collisionPage.evaluate(() => window.AppStore.getLeads().map((lead) => lead.avgPrice));
    assert.ok(
      cachedPrices.length > 0 && cachedPrices.every((price) => price === EXTREME_FENCE_SUBTOTAL),
      'AppStore caches only the authorized server projection'
    );
    await collisionPage.close();

    for (const rejectionMode of ['wrong-organization', 'wrong-session', 'malformed', 'rejected']) {
      mode = rejectionMode;
      const page = await context.newPage();
      await page.addInitScript(initialIdentity, { sessionId: SESSION_A, injectBusinessCache: false });
      await page.goto(origin + '/dashboard/leads', { waitUntil: 'domcontentloaded' });
      const rejected = await waitForRejection(page);
      assert.deepStrictEqual(rejected.projections, [], `${rejectionMode}: no rejected projection survives`);
      await page.close();
    }

    mode = 'delay';
    const delayedPage = await context.newPage();
    await delayedPage.addInitScript(initialIdentity, { sessionId: SESSION_A, injectBusinessCache: false });
    await delayedPage.goto(origin + '/dashboard/leads', { waitUntil: 'domcontentloaded' });
    await delayedPage.evaluate(() => {
      localStorage.setItem('token', 'fixture-token-b');
      localStorage.setItem('user', JSON.stringify({ id: '30000000-0000-4000-8000-000000000002', organizationId: '20000000-0000-4000-8000-000000000002' }));
      sessionStorage.setItem('northstarSessionId', 'rotated-session');
    });
    const stale = await waitForRejection(delayedPage);
    assert.deepStrictEqual(stale.projections, [], 'delayed response is rejected after token/user/org/session rotation');
    await delayedPage.close();

    mode = 'normal';
    const navPage = await context.newPage();
    await navPage.addInitScript(initialIdentity, { sessionId: SESSION_A, injectBusinessCache: false });
    await navPage.goto(origin + '/dashboard/leads', { waitUntil: 'domcontentloaded' });
    await waitForSurface(navPage, 'leads');
    const initialSession = await navPage.evaluate(() => sessionStorage.getItem('northstarSessionId'));
    await navPage.reload({ waitUntil: 'domcontentloaded' });
    await waitForSurface(navPage, 'leads');
    assert.strictEqual(await navPage.evaluate(() => sessionStorage.getItem('northstarSessionId')), initialSession, 'reload preserves same-tab session');
    await navPage.goto(origin + '/dashboard/communications', { waitUntil: 'domcontentloaded' });
    await waitForSurface(navPage, 'communications');
    await navPage.goBack({ waitUntil: 'domcontentloaded' });
    await waitForSurface(navPage, 'leads');
    assert.strictEqual(await navPage.evaluate(() => sessionStorage.getItem('northstarSessionId')), initialSession, 'back/forward preserves same-tab session');

    const popupPromise = context.waitForEvent('page');
    await navPage.evaluate((target) => window.open(target, '_blank'), origin + '/dashboard/leads');
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await waitForSurface(popup, 'leads');
    const popupSession = await popup.evaluate(() => sessionStorage.getItem('northstarSessionId'));
    assert.notStrictEqual(popupSession, initialSession, 'opener tab receives a distinct session owner');
    await popup.close();

    const independent = await context.newPage();
    await independent.goto(origin + '/dashboard/leads', { waitUntil: 'domcontentloaded' });
    await waitForSurface(independent, 'leads');
    const independentSession = await independent.evaluate(() => sessionStorage.getItem('northstarSessionId'));
    assert.notStrictEqual(independentSession, initialSession, 'independent tab receives a distinct session owner');
    await independent.close();
    await navPage.close();

    const automaticMutations = requestLedger.filter((entry) => !['GET', 'HEAD'].includes(entry.method));
    assert.deepStrictEqual(automaticMutations, [], 'page loads issue zero automatic browser mutations');
    assert.ok(requestLedger.every((entry) => entry.authorization === null), 'stale localStorage identity never creates Authorization headers');
    console.log(JSON.stringify({ browser: selected, assertions: 127, surfaces: equality, automaticMutations: automaticMutations.length, authorizationHeaders: 0 }, null, 2));
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
