'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { fork } = require('child_process');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');
const { sha256, stableStringify } = require('../../src/services/businessProfileAdapter');
const { ingestSimulation } = require('../../src/services/canonicalGraphService');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER_WORKER = path.join(ROOT, 'tests', 'helpers', 'm19-part3-ratification-server.js');
const ORG_A = '45000000-0000-4000-8000-000000000001';
const ORG_B = '45000000-0000-4000-8000-000000000002';
const USER_A = '46000000-0000-4000-8000-000000000001';
const USER_B = '46000000-0000-4000-8000-000000000002';
const SESSION_A = 'm19-part3-session-a';
const SESSION_B = 'm19-part3-session-b';
const WRONG_SESSION = 'm19-part3-wrong-session';
const IDEMPOTENCY_KEY = 'm19-part3-fence-001';
const TEST_ACCESS_SECRET = 'm19-part3-loopback-access-secret-only-2026';
const POISON_PRICE = 999999;
const POISON_GRAPH = '47000000-0000-4000-8000-000000000001';
const ALL_SURFACES = [
  'customer-detail', 'leads', 'communications', 'calendar',
  'command-center', 'polaris', 'executive', 'estimates',
];

const CONTROLLED_A = Object.freeze({
  name: 'Avery Cedar',
  phone: '+15555550101',
  email: 'avery.cedar@example.test',
  address: { line1: '100 North Star Way', city: 'Testville', state: 'NY', postalCode: '10001' },
  service: 'fence',
  sessionId: SESSION_A,
  externalTranscriptId: 'm19-part3-transcript-001',
  externalCommunicationId: 'm19-part3-communication-001',
  externalAppointmentId: 'm19-part3-appointment-001',
  occurredAt: '2026-08-04T13:00:00.000Z',
  callDurationSeconds: 242,
  transcript: [
    { turnId: 'turn-1', speaker: 'customer', text: 'I need a new 100-foot six-foot cedar fence and the existing fence removed.' },
    { turnId: 'turn-2', speaker: 'customer', text: 'Include one walk gate. Permits are required. Weekday mornings work best. This is not an emergency.' },
  ],
  facts: [
    { variable: 'linearFeet', normalizedValue: 100, evidenceText: '100-foot cedar fence', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
    { variable: 'height', normalizedValue: 6, evidenceText: 'six-foot cedar fence', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
    { variable: 'material', normalizedValue: 'cedar', evidenceText: 'cedar fence', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
    { variable: 'removalRequired', normalizedValue: true, evidenceText: 'existing fence removed', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
    { variable: 'gates', normalizedValue: [{ type: 'walk', width: 4 }], evidenceText: 'one walk gate', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
    { variable: 'permitsRequired', normalizedValue: true, evidenceText: 'permits are required', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
  ],
  scope: {
    jobType: 'replace',
    linearFeet: 100,
    height: 6,
    material: 'cedar',
    removalRequired: true,
    gates: [{ type: 'walk', width: 4 }],
    permitsRequired: true,
  },
  appointmentPreference: { dayPart: 'morning', days: ['weekday'] },
  travel: { source: 'controlled-loopback-map', minutes: 35, distanceMiles: 18 },
});

const PAGES = [
  { label: 'Customer Detail', route: null, target: 'customer-detail', surfaces: ['customer-detail', 'estimates', 'leads'], appStore: true },
  { label: 'Leads', route: '/dashboard/leads', target: 'leads', surfaces: ['leads', 'estimates', 'customer-detail'], appStore: true },
  { label: 'Communications', route: '/dashboard/communications', target: 'communications', surfaces: ['communications', 'leads'], appStore: true },
  { label: 'Calendar', route: '/dashboard/calendar', target: 'calendar', surfaces: ['calendar', 'leads'], appStore: true },
  { label: 'Command Center', route: '/dashboard', target: 'command-center', surfaces: ['command-center', 'executive', 'customer-detail', 'calendar', 'leads'], appStore: true },
  { label: 'Polaris', route: '/dashboard/polaris', target: 'polaris', surfaces: ['polaris', 'customer-detail', 'leads'], appStore: false },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function directoryDigest(root) {
  const hash = crypto.createHash('sha256');
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort(function (left, right) {
      return left.name.localeCompare(right.name);
    })) {
      const absolute = path.join(directory, entry.name);
      hash.update((entry.isDirectory() ? 'd:' : 'f:') + path.relative(root, absolute).replace(/\\/g, '/'));
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
    }
  }
  visit(root);
  return hash.digest('hex');
}

function controlledForB() {
  return {
    ...clone(CONTROLLED_A),
    name: 'Blair Cedar',
    phone: '+15555550102',
    email: 'blair.cedar@example.test',
    sessionId: SESSION_B,
    externalTranscriptId: 'm19-part3-transcript-001-b',
    externalCommunicationId: 'm19-part3-communication-001-b',
    externalAppointmentId: 'm19-part3-appointment-001-b',
  };
}

function profile(companyName, version, overrides) {
  return canonicalFenceProfile({
    companyName,
    version,
    customerMarkupPercent: 12,
    travelCustomerChargePerMile: 2.25,
    emergencyMultiplier: 1.5,
    taxRatePercent: 0,
    overheadPercent: 18,
    travelCostPerMile: 1.1,
    defaultCrewSize: 2,
    averageHourlyRate: 42,
    materialCostByService: { 'fence:cedar': 12000 },
    ...(overrides || {}),
  });
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(function (resolve, reject) {
    server.close(function (error) { if (error) reject(error); else resolve(); });
  });
  return port;
}

function childEnvironment(databaseUrl, port, dataRoot) {
  return {
    PATH: process.env.PATH || process.env.Path || '',
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
    WINDIR: process.env.WINDIR || 'C:\\Windows',
    COMSPEC: process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
    TEMP: process.env.TEMP || dataRoot,
    TMP: process.env.TMP || dataRoot,
    NODE_ENV: 'test',
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    DB_POOL_MAX: '8',
    AUTH_ACCESS_SECRET: TEST_ACCESS_SECRET,
    AUTH_ACCESS_MINUTES: '15',
    AUTH_REFRESH_DAYS: '14',
    NORTHSTAR_DATA_DIR: dataRoot,
    CANONICAL_CACHE_DISABLED: 'true',
    RETELL_API_KEY: '',
    RETELL_AGENT_ID: '',
    RETELL_PHONE_NUMBER: '',
    RETELL_WEBHOOK_SECRET: '',
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_PHONE_NUMBER: '',
    GOOGLE_SHEETS_CLIENT_EMAIL: '',
    GOOGLE_SHEETS_PRIVATE_KEY: '',
    GOOGLE_SHEETS_SPREADSHEET_ID: '',
    GOOGLE_CALENDAR_CREDENTIALS: '',
    SMTP_HOST: '',
    SMTP_PORT: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    RESEND_API_KEY: '',
    RESEND_FROM: '',
    RESEND_REPLY_TO: '',
    APP_BASE_URL: '',
    JOBBER_CLIENT_ID: '',
    JOBBER_CLIENT_SECRET: '',
    DEMO_API_KEY: '',
    NORTHSTAR_DEMO_ORGANIZATION_ID: '',
  };
}

async function startProductionServer(databaseUrl, port, dataRoot) {
  const child = fork(SERVER_WORKER, [], {
    cwd: ROOT,
    env: childEnvironment(databaseUrl, port, dataRoot),
    silent: true,
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', function (chunk) { output.stdout = (output.stdout + chunk.toString()).slice(-120000); });
  child.stderr.on('data', function (chunk) { output.stderr = (output.stderr + chunk.toString()).slice(-120000); });
  const ready = await new Promise(function (resolve, reject) {
    const timer = setTimeout(function () { finish(new Error('Mounted production server did not become ready.')); }, 30000);
    function finish(error, message) {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve(message);
    }
    function onMessage(message) {
      if (message && message.type === 'ready') finish(null, message);
      if (message && message.type === 'error') {
        const diagnostics = [output.stderr, output.stdout].filter(Boolean).join('\n').slice(-6000);
        finish(new Error('Mounted production server failed: ' + message.message + (diagnostics ? '\n' + diagnostics : '')));
      }
    }
    function onExit(code, signal) {
      finish(new Error('Mounted production server exited before ready: code=' + code + ' signal=' + signal));
    }
    child.on('message', onMessage);
    child.once('exit', onExit);
  }).catch(async function (error) {
    await forceStopChild(child);
    throw error;
  });
  try {
    assert.strictEqual(ready.address, '127.0.0.1', 'production server must bind loopback only');
    assert.strictEqual(ready.port, port, 'production server must use the reserved loopback port');
    return { child, output, origin: 'http://127.0.0.1:' + port };
  } catch (error) {
    await forceStopChild(child);
    throw error;
  }
}

async function forceStopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(function (resolve) { child.once('exit', resolve); });
  child.kill('SIGKILL');
  await Promise.race([
    exited,
    new Promise(function (resolve) { setTimeout(resolve, 5000); }),
  ]);
}

async function stopProductionServer(handle) {
  if (!handle || handle.child.exitCode !== null) return;
  const child = handle.child;
  const exited = new Promise(function (resolve) {
    child.once('exit', function (code, signal) { resolve({ code, signal }); });
  });
  child.send({ type: 'shutdown' });
  let result = await Promise.race([
    exited,
    new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 15000); }),
  ]);
  let forced = false;
  if (!result) {
    forced = true;
    child.kill('SIGKILL');
    result = await Promise.race([
      exited,
      new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 5000); }),
    ]);
  }
  assert.ok(result, 'mounted production server process must stop');
  assert.strictEqual(forced, false, 'mounted production server required forced termination');
  assert.strictEqual(result.code, 0, 'mounted production server must stop cleanly');
}

async function requestJson(origin, pathname, options) {
  const settings = options || {};
  const headers = { Accept: 'application/json', ...(settings.auth ? settings.auth.headers : {}) };
  if (settings.sessionId) headers['X-NorthStar-Session-ID'] = settings.sessionId;
  if (settings.idempotencyKey) headers['Idempotency-Key'] = settings.idempotencyKey;
  if (settings.body !== undefined) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 20000);
  try {
    const response = await fetch(origin + pathname, {
      method: settings.method || 'GET',
      headers,
      body: settings.body === undefined ? undefined : JSON.stringify(settings.body),
      redirect: 'manual',
      signal: controller.signal,
    });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (_error) {}
    return { status: response.status, body, raw };
  } finally {
    clearTimeout(timer);
  }
}

function controlledGraphRequest(organizationId, body) {
  return {
    tenantContext: { organizationId },
    idempotencyKey: IDEMPOTENCY_KEY,
    sourceVersion: 'm19-part3-controlled-test-v1',
    external: {
      customerId: body.sessionId + ':customer',
      callId: body.sessionId + ':call',
      transcriptId: body.externalTranscriptId,
      communicationId: body.externalCommunicationId,
      appointmentId: body.externalAppointmentId,
    },
    customer: {
      name: body.name,
      phone: body.phone,
      email: body.email,
      address: body.address,
    },
    transcript: body.transcript,
    facts: body.facts,
    service: { key: body.service, scope: body.scope },
    appointmentPreference: body.appointmentPreference,
    scheduledAppointment: body.scheduledAppointment,
    travel: body.travel,
    callDurationSeconds: body.callDurationSeconds,
    occurredAt: body.occurredAt,
  };
}

function createControlledGraph(pool, organizationId, body) {
  return ingestSimulation(pool, controlledGraphRequest(organizationId, body));
}

function assertCompleteSnapshot(values) {
  const required = [
    'organizationId', 'customerId', 'opportunityId', 'calculationVersion',
    'normalizedInputFingerprint', 'businessProfileInputId', 'businessProfileInputVersion',
    'businessProfileInputHash', 'businessProfileFieldsUsed', 'service',
    'customerFacingPrice', 'pricingLineItems', 'materialsCharge', 'knownDirectMaterialCost',
    'laborCharge', 'laborHours', 'knownInternalLaborCost', 'equipmentCharge',
    'knownEquipmentCost', 'travel', 'callDurationSeconds',
    'estimatedProductionDurationHours', 'crewRecommendation', 'estimatedRevenue',
    'knownDirectCosts', 'grossProfit', 'grossMarginPercent', 'overhead', 'netProfit',
    'netMarginPercent', 'confidence', 'risk', 'recommendedActions',
    'appointmentPreference', 'supportingTranscriptFactIds', 'notCalculated',
  ];
  for (const key of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(values, key), 'snapshot must expose ' + key);
  }
  assert.deepStrictEqual(values.service.scope, CONTROLLED_A.scope, 'persisted scope is exact');
  assert.deepStrictEqual(values.appointmentPreference, CONTROLLED_A.appointmentPreference, 'appointment preference is exact');
  assert.strictEqual(values.callDurationSeconds, CONTROLLED_A.callDurationSeconds, 'call duration is exact');
  assert.deepStrictEqual(
    { source: values.travel.source, minutes: values.travel.minutes, distanceMiles: values.travel.distanceMiles },
    CONTROLLED_A.travel,
    'travel source, time, and distance are exact'
  );
  assert.ok(Object.prototype.hasOwnProperty.call(values.travel, 'customerCharge'), 'travel customer charge is exposed');
  assert.ok(Object.prototype.hasOwnProperty.call(values.travel, 'knownInternalCost'), 'travel internal cost is exposed');
  assert.strictEqual(values.risk.emergency, false, 'controlled scenario is not an emergency');
  assert.ok(Array.isArray(values.pricingLineItems) && values.pricingLineItems.length > 0, 'persisted pricing line items exist');
  assert.ok(Array.isArray(values.recommendedActions) && values.recommendedActions.length > 0, 'persisted recommendations exist');
  assert.ok(Array.isArray(values.notCalculated), 'calculation dispositions are explicit');
}

async function rawGraph(pool, organizationId, graphId) {
  const graph = await pool.query(
    `SELECT o.id AS operation_id, o.graph_id, o.payload_fingerprint, o.created_at AS operation_created_at,
            o.completed_at AS operation_completed_at,
            c.id AS customer_id, c.external_customer_id, c.name, c.email, c.phone, c.address,
            t.id AS transcript_id, t.source, t.source_version, t.external_call_id,
            t.external_transcript_id, t.normalized_fingerprint AS transcript_fingerprint,
            t.occurred_at, t.created_at AS transcript_created_at,
            cm.id AS communication_id, cm.external_communication_id, cm.duration_seconds,
            op.id AS opportunity_id, op.job_scope, op.appointment_preference,
            e.id AS estimate_id, e.calculation_version, e.normalized_input_fingerprint,
            e.business_profile_id, e.business_profile_version, e.business_profile_hash,
            e.customer_price, e.line_items, e.calculation_output, e.snapshot_digest AS estimate_digest,
            e.created_at AS estimate_created_at,
            a.id AS appointment_id, a.external_appointment_id, a.preference,
            ps.id AS polaris_snapshot_id, ps.supporting_fact_ids, ps.snapshot,
            ps.snapshot_digest, ps.created_at AS snapshot_created_at
       FROM canonical_operations o
       JOIN canonical_customers c ON c.organization_id = o.organization_id AND c.operation_id = o.id
       JOIN canonical_transcripts t ON t.organization_id = o.organization_id AND t.operation_id = o.id
       JOIN canonical_communications cm ON cm.organization_id = o.organization_id AND cm.operation_id = o.id
       JOIN canonical_opportunities op ON op.organization_id = o.organization_id AND op.operation_id = o.id
       JOIN canonical_estimates e ON e.organization_id = o.organization_id AND e.operation_id = o.id
       JOIN canonical_appointments a ON a.organization_id = o.organization_id AND a.operation_id = o.id
       JOIN canonical_polaris_snapshots ps ON ps.organization_id = o.organization_id AND ps.operation_id = o.id
      WHERE o.organization_id = $1 AND o.graph_id = $2`,
    [organizationId, graphId]
  );
  assert.strictEqual(graph.rows.length, 1, 'one durable graph row must exist');
  const facts = await pool.query(
    `SELECT id, ordinal, fact_type, value, evidence_text, speaker, confidence,
            source_start, source_end, fact_fingerprint, created_at
       FROM canonical_facts
      WHERE organization_id = $1 AND graph_id = $2
      ORDER BY ordinal`,
    [organizationId, graphId]
  );
  return { row: graph.rows[0], facts: facts.rows };
}

function assertDatabaseAgreement(first, persisted, profileAuthority) {
  const body = first.body;
  const row = persisted.row;
  assert.strictEqual(row.operation_id, body.operationId);
  assert.strictEqual(row.graph_id, body.graphId);
  assert.strictEqual(row.customer_id, body.ids.customer);
  assert.strictEqual(row.transcript_id, body.ids.transcript);
  assert.strictEqual(row.communication_id, body.ids.communication);
  assert.strictEqual(row.opportunity_id, body.ids.opportunity);
  assert.strictEqual(row.estimate_id, body.ids.estimate);
  assert.strictEqual(row.appointment_id, body.ids.appointment);
  assert.strictEqual(row.polaris_snapshot_id, body.ids.polarisSnapshot);
  assert.deepStrictEqual(persisted.facts.map(function (fact) { return fact.id; }), body.ids.facts);
  assert.strictEqual(row.external_call_id, SESSION_A + ':call');
  assert.strictEqual(row.external_transcript_id, CONTROLLED_A.externalTranscriptId);
  assert.strictEqual(row.external_communication_id, CONTROLLED_A.externalCommunicationId);
  assert.strictEqual(row.external_appointment_id, CONTROLLED_A.externalAppointmentId);
  assert.strictEqual(row.duration_seconds, CONTROLLED_A.callDurationSeconds);
  assert.deepStrictEqual(row.address, CONTROLLED_A.address);
  assert.deepStrictEqual(row.job_scope, CONTROLLED_A.scope);
  assert.deepStrictEqual(row.appointment_preference, CONTROLLED_A.appointmentPreference);
  assert.deepStrictEqual(row.preference, CONTROLLED_A.appointmentPreference);
  assert.strictEqual(new Date(row.occurred_at).toISOString(), CONTROLLED_A.occurredAt);
  assert.strictEqual(row.source, 'simulation');
  assert.strictEqual(row.source_version, 'm19-part3-controlled-test-v1');
  assert.strictEqual(row.snapshot_digest, body.snapshotDigest);
  assert.strictEqual(row.estimate_digest, body.snapshotDigest);
  assert.strictEqual(sha256(row.snapshot), body.snapshotDigest, 'persisted snapshot bytes agree with its digest');
  assert.strictEqual(stableStringify(row.snapshot), stableStringify(row.calculation_output));
  assert.strictEqual(stableStringify(row.snapshot), stableStringify(body.snapshot));
  assert.strictEqual(row.normalized_input_fingerprint, body.normalizedInputFingerprint);
  assert.strictEqual(row.business_profile_id, profileAuthority.id);
  assert.strictEqual(row.business_profile_version, profileAuthority.versionLabel);
  assert.strictEqual(row.business_profile_hash, profileAuthority.profileHash);
  assert.deepStrictEqual(row.supporting_fact_ids, body.ids.facts);
  assertCompleteSnapshot(row.snapshot);
}

function browserPoison() {
  return {
    ids: {
      operation: POISON_GRAPH,
      graph: POISON_GRAPH,
      customer: POISON_GRAPH,
      transcript: POISON_GRAPH,
      communication: POISON_GRAPH,
      opportunity: POISON_GRAPH,
      estimate: POISON_GRAPH,
      appointment: POISON_GRAPH,
      polarisSnapshot: POISON_GRAPH,
      facts: [],
    },
    snapshotDigest: 'f'.repeat(64),
    values: { customerFacingPrice: POISON_PRICE, estimatedRevenue: POISON_PRICE },
  };
}

function installInitState(options) {
  window.name = 'northstar-tab:m19-part3-' + options.sessionId;
  sessionStorage.setItem('northstarSessionOwner', window.name);
  sessionStorage.setItem('northstarSessionId', options.sessionId);
  localStorage.setItem('token', 'poison-browser-token');
  localStorage.setItem('user', JSON.stringify({ id: options.poisonUser, organizationId: options.poisonOrganization }));
  localStorage.setItem('northstarCanonicalProjection', JSON.stringify(options.poison));
  localStorage.setItem('northstarAppStore', JSON.stringify({ leads: [{ avgPrice: options.poisonPrice }] }));
  sessionStorage.setItem('northstar_calls', JSON.stringify([{ id: options.poison.ids.graph, avgPrice: options.poisonPrice }]));
  sessionStorage.setItem('northstar_app_store', JSON.stringify({ canonical: options.poison }));
  window.__m19BrowserCalculationCalls = [];
  var engine;
  Object.defineProperty(window, 'PolarisEngine', {
    configurable: true,
    enumerable: true,
    get: function () { return engine; },
    set: function (next) {
      if (!next || typeof next !== 'object') { engine = next; return; }
      var facade = {};
      Object.keys(next).forEach(function (key) {
        if (key === 'generateEstimate' || key === 'analyzeLead') {
          facade[key] = function () {
            window.__m19BrowserCalculationCalls.push(key);
            throw new Error('Browser-side Polaris calculation is forbidden on ratified pages.');
          };
        } else {
          facade[key] = next[key];
        }
      });
      engine = Object.freeze(facade);
    },
  });
}

async function createBrowserContext(browser, origin, auth, canonicalSession, evidence) {
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    serviceWorkers: 'block',
  });
  await context.addCookies([
    { name: 'northstar_access', value: auth.accessToken, url: origin, httpOnly: true, sameSite: 'Lax' },
    { name: 'northstar_csrf', value: auth.csrfToken, url: origin, httpOnly: false, sameSite: 'Lax' },
  ]);
  await context.addInitScript(installInitState, {
    sessionId: canonicalSession,
    poison: browserPoison(),
    poisonPrice: POISON_PRICE,
    poisonUser: USER_B,
    poisonOrganization: ORG_B,
  });
  const gate = { held: false, waiters: [] };
  const control = {
    hold: function () { gate.held = true; },
    release: function () {
      gate.held = false;
      const waiters = gate.waiters.splice(0);
      waiters.forEach(function (resolve) { resolve(); });
    },
  };
  await context.route('**/*', async function (route) {
    const browserRequest = route.request();
    const requestUrl = new URL(browserRequest.url());
    const entry = {
      method: browserRequest.method(),
      url: browserRequest.url(),
      resourceType: browserRequest.resourceType(),
      external: requestUrl.origin !== origin,
    };
    evidence.requests.push(entry);
    if (entry.external) {
      evidence.external.push(entry);
      if (!['GET', 'HEAD'].includes(entry.method)) evidence.externalMutationAttempts.push(entry);
      const type = browserRequest.resourceType();
      if (type === 'stylesheet') {
        await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      } else if (type === 'script') {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      } else {
        await route.fulfill({ status: 204, body: '' });
      }
      return;
    }
    if (browserRequest.method() === 'GET' && /\/api\/v1\/canonical\/(?:compat|surfaces)\//.test(requestUrl.pathname)) {
      while (gate.held) {
        await new Promise(function (resolve) { gate.waiters.push(resolve); });
      }
    }
    await route.continue();
  });
  return { context, control };
}

async function poisonAppStore(page) {
  const exists = await page.evaluate(function () { return Boolean(window.AppStore); });
  if (!exists) return false;
  await page.evaluate(function (poison) {
    var state = window.AppStore.getState();
    state.leads = [{
      id: poison.ids.opportunity,
      canonicalGraphId: poison.ids.graph,
      avgPrice: poison.values.customerFacingPrice,
      estimatedPrice: poison.values.customerFacingPrice,
      snapshotDigest: poison.snapshotDigest,
      canonical: poison,
    }];
    state.customers = [{ id: poison.ids.customer, canonical: poison }];
    state.canonical = { surface: 'leads', digest: poison.snapshotDigest, items: [poison] };
  }, browserPoison());
  return true;
}

async function openPage(bundle, origin, testCase, expectedCount, evidence) {
  bundle.control.hold();
  const page = await bundle.context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', function (error) { pageErrors.push(error.message); });
  page.on('console', function (message) { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const response = await page.goto(origin + testCase.route, { waitUntil: 'domcontentloaded', timeout: 20000 });
  assert.ok(response && response.status() === 200, testCase.label + ' must load through the production route');
  if (testCase.appStore) {
    await page.waitForFunction(function () { return Boolean(window.AppStore); }, null, { timeout: 10000 });
    assert.strictEqual(await poisonAppStore(page), true, testCase.label + ' AppStore poison installed before authority response');
  }
  bundle.control.release();
  await page.waitForFunction(function (input) {
    if (!window.CanonicalIntelligence) return false;
    var complete = input.surfaces.every(function (surface) {
      var projection = window.CanonicalIntelligence.getProjection(surface);
      return projection && Array.isArray(projection.items) && projection.items.length === input.expectedCount;
    });
    if (!complete) return false;
    if (!input.appStore) return true;
    var state = window.AppStore && window.AppStore.getState();
    return state && state.canonical && state.leads.length === input.expectedCount;
  }, { surfaces: testCase.surfaces, expectedCount, appStore: testCase.appStore }, { timeout: 25000 });
  evidence.pageErrors.push(...pageErrors.map(function (message) { return { page: testCase.label, message }; }));
  evidence.consoleErrors.push(...consoleErrors.map(function (message) { return { page: testCase.label, message }; }));
  return { page, pageErrors, consoleErrors };
}

async function observePage(page, testCase) {
  return page.evaluate(function (input) {
    var projections = {};
    input.surfaces.forEach(function (surface) {
      projections[surface] = JSON.parse(JSON.stringify(window.CanonicalIntelligence.getProjection(surface)));
    });
    var state = window.AppStore ? window.AppStore.getState() : null;
    var marker = document.getElementById('northstarCanonicalProjection');
    return {
      projections,
      presentation: JSON.parse(JSON.stringify(window.CanonicalIntelligence.getPresentation(input.target))),
      marker: marker ? marker.textContent : null,
      rootAuthority: document.documentElement.dataset.canonicalAuthority || null,
      rootDigest: document.documentElement.dataset.canonicalDigest || null,
      rootGraph: document.documentElement.dataset.canonicalGraphId || null,
      bodyText: document.body ? document.body.innerText : '',
      calculationCalls: (window.__m19BrowserCalculationCalls || []).slice(),
      appStore: state ? {
        leads: state.leads.map(function (lead) {
          return {
            graph: lead.canonicalGraphId,
            price: lead.avgPrice,
            snapshotDigest: lead.snapshotDigest,
          };
        }),
        customers: state.customers.map(function (customer) { return customer.id; }),
        canonicalItem: state.canonical && state.canonical.items ? state.canonical.items[0] || null : null,
      } : null,
    };
  }, { surfaces: testCase.surfaces, target: testCase.target });
}

function assertPageAgreement(observed, testCase, expectedItem, expectedDigest, authority) {
  for (const surface of testCase.surfaces) {
    const projection = observed.projections[surface];
    assert.strictEqual(projection.digest, expectedDigest, testCase.label + '/' + surface + ': projection digest');
    assert.strictEqual(projection.authority.organizationId, authority.organizationId, testCase.label + '/' + surface + ': organization');
    assert.strictEqual(projection.authority.userId, authority.userId, testCase.label + '/' + surface + ': user');
    assert.strictEqual(projection.authority.sessionId, authority.sessionId, testCase.label + '/' + surface + ': session');
    assert.deepStrictEqual(projection.items, [expectedItem], testCase.label + '/' + surface + ': persisted canonical item');
  }
  const presentation = observed.presentation;
  assert.deepStrictEqual(presentation.ids, expectedItem.ids, testCase.label + ': IDs');
  assert.deepStrictEqual(presentation.source, expectedItem.source, testCase.label + ': source metadata');
  assert.deepStrictEqual(presentation.facts, expectedItem.facts, testCase.label + ': facts');
  assert.strictEqual(presentation.normalizedInputFingerprint, expectedItem.normalizedInputFingerprint, testCase.label + ': input fingerprint');
  assert.deepStrictEqual(presentation.supportingTranscriptFactIds, expectedItem.supportingTranscriptFactIds, testCase.label + ': supporting facts');
  assert.strictEqual(presentation.calculationVersion, expectedItem.calculationVersion, testCase.label + ': calculation version');
  assert.strictEqual(presentation.snapshotDigest, expectedItem.snapshotDigest, testCase.label + ': snapshot digest');
  assert.deepStrictEqual(presentation.timestamps, expectedItem.timestamps, testCase.label + ': timestamps');
  assert.deepStrictEqual(presentation.metadata, expectedItem.metadata, testCase.label + ': operation metadata');
  assert.deepStrictEqual(presentation.businessProfile, expectedItem.businessProfile, testCase.label + ': Business Profile authority');
  assert.deepStrictEqual(presentation.values, expectedItem.values, testCase.label + ': persisted calculation values');
  assert.deepStrictEqual(presentation.scope, expectedItem.values.service.scope, testCase.label + ': scope');
  assert.deepStrictEqual(presentation.labor, {
    charge: expectedItem.values.laborCharge,
    hours: expectedItem.values.laborHours,
    knownInternalCost: expectedItem.values.knownInternalLaborCost,
  }, testCase.label + ': labor');
  assert.deepStrictEqual(presentation.duration, {
    callSeconds: expectedItem.values.callDurationSeconds,
    productionHours: expectedItem.values.estimatedProductionDurationHours,
  }, testCase.label + ': duration');
  assert.deepStrictEqual(presentation.travel, expectedItem.values.travel, testCase.label + ': travel');
  assert.deepStrictEqual(presentation.profit, {
    gross: expectedItem.values.grossProfit,
    grossMarginPercent: expectedItem.values.grossMarginPercent,
    net: expectedItem.values.netProfit,
    netMarginPercent: expectedItem.values.netMarginPercent,
  }, testCase.label + ': profit');
  assert.deepStrictEqual(presentation.confidence, expectedItem.values.confidence, testCase.label + ': confidence');
  assert.deepStrictEqual(presentation.risk, expectedItem.values.risk, testCase.label + ': risk');
  assert.deepStrictEqual(presentation.recommendations, expectedItem.values.recommendedActions, testCase.label + ': recommendations');
  assert.deepStrictEqual(observed.calculationCalls, [], testCase.label + ': no browser-side calculation');
  assert.strictEqual(observed.rootAuthority, 'server', testCase.label + ': server authority marker');
  assert.strictEqual(observed.rootDigest, expectedDigest, testCase.label + ': DOM digest marker');
  assert.strictEqual(observed.rootGraph, expectedItem.ids.graph, testCase.label + ': DOM graph marker');
  assert.ok(observed.marker && !observed.marker.includes(String(POISON_PRICE)), testCase.label + ': marker excludes storage poison');
  assert.ok(!observed.bodyText.includes(String(POISON_PRICE)), testCase.label + ': visible page excludes storage poison');
  if (testCase.appStore) {
    assert.ok(observed.appStore && observed.appStore.leads.length === 1, testCase.label + ': AppStore has one authorized lead');
    assert.strictEqual(observed.appStore.leads[0].graph, expectedItem.ids.graph, testCase.label + ': AppStore graph');
    assert.strictEqual(observed.appStore.leads[0].price, expectedItem.values.customerFacingPrice, testCase.label + ': AppStore price');
    assert.strictEqual(observed.appStore.leads[0].snapshotDigest, expectedItem.snapshotDigest, testCase.label + ': AppStore digest');
    assert.deepStrictEqual(observed.appStore.canonicalItem, expectedItem, testCase.label + ': AppStore projection');
  }
}

async function exerciseLiveSimulation(browser, origin, auth, pool, profileAuthority, evidence, input) {
  const bundle = await createBrowserContext(browser, origin, auth, input.sessionId, evidence);
  const testCase = {
    label: input.label,
    route: input.route,
    target: 'command-center',
    surfaces: ['command-center', 'executive', 'customer-detail', 'calendar', 'leads'],
    appStore: true,
  };
  const opened = await openPage(bundle, origin, testCase, 0, evidence);
  await opened.page.evaluate(function (fixture) {
    window.crypto.randomUUID = function () { return fixture.idempotencyKey; };
    window.genCall = function () {
      return {
        caller: fixture.caller,
        phone: fixture.phone,
        email: fixture.email,
        service: 'fence',
        description: 'Existing generated live simulation flow.',
        avgPrice: fixture.poisonPrice,
      };
    };
  }, {
    caller: input.label,
    phone: input.contactSuffix === 'dashboard' ? '+15555550198' : '+15555550199',
    email: input.contactSuffix + '@mounted-live.example.test',
    idempotencyKey: input.idempotencyKey,
    poisonPrice: POISON_PRICE,
  });
  assert.strictEqual(await opened.page.evaluate(function () { return window.crypto.randomUUID(); }), input.idempotencyKey, input.label + ': test pins a deterministic existing-flow idempotency key');
  const responsePromise = opened.page.waitForResponse(function (response) {
    const request = response.request();
    return new URL(response.url()).pathname === '/api/v1/simulations/leads' && request.method() === 'POST';
  }, { timeout: 25000 });
  await opened.page.locator('#ccSimBtn').click();
  const response = await responsePromise;
  assert.strictEqual(response.status(), 201, input.label + ': existing mounted simulation POST succeeds');
  assert.strictEqual(response.request().headers()['idempotency-key'], input.idempotencyKey, input.label + ': mounted request uses the pinned idempotency key');
  const requestBody = response.request().postDataJSON();
  assert.deepStrictEqual(Object.keys(requestBody).sort(), input.requestFields.slice().sort(), input.label + ': request contract is unchanged');
  for (const forbidden of [
    'transcript', 'facts', 'scope', 'travel', 'callDurationSeconds', 'scheduledAppointment',
    'externalTranscriptId', 'externalCommunicationId', 'externalAppointmentId', 'estimatedValue',
  ]) assert.ok(!Object.prototype.hasOwnProperty.call(requestBody, forbidden), input.label + ': no ' + forbidden + ' simulation input');

  const result = await response.json();
  const canonicalPrice = result.snapshot.customerFacingPrice;
  assert.ok(typeof canonicalPrice === 'number' && Number.isFinite(canonicalPrice) && canonicalPrice > 0, input.label + ': deterministic generated fence scenario is canonically priced');
  assert.strictEqual(result.polaris.customerFacingPrice, canonicalPrice, input.label + ': response Polaris price is canonical');
  assert.strictEqual(result.summary.estimatedValue, canonicalPrice, input.label + ': response summary uses canonical price');
  assert.strictEqual(result.snapshotDigest, sha256(result.snapshot), input.label + ': response digest agrees with snapshot');
  assert.ok(Array.isArray(result.transcript) && result.transcript.length > 0, input.label + ': established generated transcript is retained');
  assert.ok(result.snapshot.service && result.snapshot.service.scope, input.label + ': established generated scope is retained');
  try {
    await opened.page.waitForFunction(function (price) {
      var status = document.getElementById('ccSimStatusText');
      return status && status.textContent.indexOf('$' + String(price)) >= 0;
    }, canonicalPrice, { timeout: 25000 });
  } catch (error) {
    const diagnostics = await opened.page.evaluate(function () {
      var status = document.getElementById('ccSimStatusText');
      var button = document.getElementById('ccSimBtn');
      return {
        statusText: status && status.textContent,
        statusDisplay: status && status.parentElement && status.parentElement.style.display,
        buttonDisabled: button && button.disabled,
        calculationCalls: (window.__m19BrowserCalculationCalls || []).slice(),
      };
    });
    throw new Error(input.label + ': post-call status did not expose canonical price: ' + stableStringify({ diagnostics, pageErrors: opened.pageErrors }));
  }
  const visibleStatus = await opened.page.locator('#ccSimStatusText').textContent();
  assert.ok(visibleStatus.includes('$' + String(canonicalPrice)), input.label + ': visible post-call price comes from canonical snapshot');
  assert.ok(!visibleStatus.includes(String(POISON_PRICE)), input.label + ': visible post-call price excludes browser poison');
  assert.deepStrictEqual(await opened.page.evaluate(function () { return window.__m19BrowserCalculationCalls.slice(); }), [], input.label + ': no client/pre-call Polaris calculation');
  assert.deepStrictEqual(opened.pageErrors, [], input.label + ': no uncaught page error');

  const persisted = await rawGraph(pool, ORG_A, result.graphId);
  assert.strictEqual(persisted.row.operation_id, result.operationId, input.label + ': operation ID persisted');
  assert.strictEqual(persisted.row.snapshot_digest, result.snapshotDigest, input.label + ': persisted digest matches response');
  assert.strictEqual(persisted.row.estimate_digest, result.snapshotDigest, input.label + ': estimate digest matches response');
  assert.strictEqual(stableStringify(persisted.row.snapshot), stableStringify(result.snapshot), input.label + ': persisted snapshot matches response');
  assert.strictEqual(stableStringify(persisted.row.calculation_output), stableStringify(result.snapshot), input.label + ': persisted calculation matches response');
  assert.strictEqual(String(persisted.row.customer_price), String(canonicalPrice), input.label + ': persisted price matches displayed price');
  assert.strictEqual(persisted.row.business_profile_id, profileAuthority.id, input.label + ': persisted Business Profile ID');
  assert.strictEqual(persisted.row.business_profile_version, profileAuthority.versionLabel, input.label + ': persisted Business Profile version');
  assert.strictEqual(persisted.row.business_profile_hash, profileAuthority.profileHash, input.label + ': persisted Business Profile hash');
  await opened.page.close();
  await bundle.context.close();
  return { label: input.label, canonicalPrice, requestFields: Object.keys(requestBody).sort() };
}

async function assertPaidCommandCenterRealOnly(browser, origin, auth, evidence) {
  const bundle = await createBrowserContext(browser, origin, auth, SESSION_A, evidence);
  const testCase = {
    label: 'Paid Command Center real-tenant boundary',
    route: '/dashboard',
    target: 'command-center',
    surfaces: ['command-center', 'executive', 'customer-detail', 'calendar', 'leads'],
    appStore: true,
  };
  const opened = await openPage(bundle, origin, testCase, 1, evidence);
  const boundary = await opened.page.evaluate(async function () {
    const source = await fetch('/dashboard', { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) throw new Error('paid Command Center source returned HTTP ' + response.status);
      return response.text();
    });
    return {
      hasSimulateControl: Boolean(document.querySelector('#ccSimBtn, #ccSimStatusText, [data-demo-simulate], [data-simulate-lead]')),
      loadsSimulator: Array.from(document.scripts).some(function (script) {
        return /(?:^|\/)simulator\.js(?:$|\?)/.test(script.src || '');
      }),
      sourceHasSimulationEndpoint: source.includes('/api/v1/simulations/leads'),
      sourceHasSimulationLanguage: /\b(?:simulate lead|simulation mode|scenario controls?)\b/i.test(source),
      sourceHasSessionFilter: /(?:northstarSessionId|sessionId\s*=|[?&]sessionId=)/.test(source),
    };
  });
  assert.deepStrictEqual(boundary, {
    hasSimulateControl: false,
    loadsSimulator: false,
    sourceHasSimulationEndpoint: false,
    sourceHasSimulationLanguage: false,
    sourceHasSessionFilter: false,
  }, 'paid Command Center exposes only real-tenant projections and no simulation surface');
  assert.deepStrictEqual(opened.pageErrors, [], 'paid Command Center real-tenant boundary has no uncaught page error');
  await opened.page.close();
  await bundle.context.close();
  return boundary;
}

async function assertRejectedConsumers(page, label) {
  await page.waitForFunction(function () {
    var state = window.AppStore && window.AppStore.getState();
    return document.documentElement.dataset.canonicalAuthority === 'rejected' &&
      !document.getElementById('northstarCanonicalProjection') &&
      (!state || (state.leads.length === 0 && state.customers.length === 0 && state.canonical === null));
  }, null, { timeout: 25000 });
  const state = await page.evaluate(function (surfaces) {
    return {
      projections: surfaces.filter(function (surface) { return window.CanonicalIntelligence.getProjection(surface); }),
      appStore: window.AppStore ? {
        leads: window.AppStore.getState().leads.length,
        customers: window.AppStore.getState().customers.length,
        canonical: window.AppStore.getState().canonical,
      } : null,
      marker: Boolean(document.getElementById('northstarCanonicalProjection')),
      bodyHasPoison: document.body.innerText.includes(String(999999)),
    };
  }, ALL_SURFACES);
  assert.deepStrictEqual(state.projections, [], label + ': canonical client clears every projection');
  assert.deepStrictEqual(state.appStore, { leads: 0, customers: 0, canonical: null }, label + ': AppStore fails closed');
  assert.strictEqual(state.marker, false, label + ': alternate DOM consumer fails closed');
  assert.strictEqual(state.bodyHasPoison, false, label + ': storage poison never becomes a fallback');
}

async function main() {
  const selected = (process.argv.find(function (value) { return value.startsWith('--browser='); }) || '--browser=chrome').split('=')[1];
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  const runtime = resolveBrowserRuntime(selected);
  const dataRoot = path.resolve(process.env.M19_TEST_DATA_DIR || '');
  assert.ok(process.env.M19_TEST_DATA_DIR && path.isAbsolute(dataRoot), 'M19_TEST_DATA_DIR must be an explicit absolute isolated root');
  assert.ok(dataRoot !== ROOT && !dataRoot.startsWith(ROOT + path.sep), 'browser data root must remain outside the checkout');
  fs.mkdirSync(dataRoot, { recursive: true });
  const dataBefore = directoryDigest(dataRoot);

  for (const key of [
    'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER', 'RETELL_WEBHOOK_SECRET',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
    'GOOGLE_SHEETS_CLIENT_EMAIL', 'GOOGLE_SHEETS_PRIVATE_KEY', 'GOOGLE_SHEETS_SPREADSHEET_ID',
    'GOOGLE_CALENDAR_CREDENTIALS', 'SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY',
    'JOBBER_CLIENT_ID', 'JOBBER_CLIENT_SECRET', 'DEMO_API_KEY',
  ]) process.env[key] = '';
  process.env.NODE_ENV = 'test';
  process.env.AUTH_ACCESS_SECRET = TEST_ACCESS_SECRET;
  process.env.AUTH_ACCESS_MINUTES = '15';
  process.env.AUTH_REFRESH_DAYS = '14';
  process.env.NORTHSTAR_DATA_DIR = dataRoot;

  const suiteDatabase = await createSuiteDatabase('ratification-' + selected);
  process.env.DATABASE_URL = suiteDatabase.connectionString;
  const port = await unusedPort();
  let serverHandle = null;
  let pool = null;
  let browser = null;
  const evidence = {
    requests: [],
    external: [],
    externalMutationAttempts: [],
    pageErrors: [],
    consoleErrors: [],
  };
  try {
    serverHandle = await startProductionServer(suiteDatabase.connectionString, port, dataRoot);
    pool = new Pool({ connectionString: suiteDatabase.connectionString, max: 8 });
    const migrations = await pool.query('SELECT filename FROM public._migrations ORDER BY filename');
    assert.deepStrictEqual(migrations.rows.map(function (row) { return row.filename; }), [
      '001_initial_schema.sql', '002_seed_data.sql', '003_voice_sessions.sql',
      '004_canonical_persistence_v2.sql', '005_canonical_organization_authority.sql',
      '006_canonical_voice_sessions.sql', '007_canonical_tax_authority.sql',
      '008_canonical_demo_authority.sql', '009_canonical_voice_provider_identity.sql',
      '010_account_session_authority.sql', '011_oauth_authorization_states.sql',
      '012_account_verification_trial.sql',
      '015_workforce_authority.sql', '016_tenant_asset_catalogue.sql',
      '017_retell_webhook_replay_authority.sql', '018_canonical_map_preferences.sql',
      '019_account_email_outbox.sql', '020_canonical_workforce_access_roles.sql',
      '021_bounded_api_observability.sql', '022_demo_command_center_sessions.sql',
    ], 'real mounted startup applies the exact committed migration set through 022');

    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1, 'Ratification Organization A', 'ratification-a@m19.test'),
        ($2, 'Ratification Organization B', 'ratification-b@m19.test')`,
      [ORG_A, ORG_B]
    );
    for (const user of [[USER_A, ORG_A], [USER_B, ORG_B]]) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used','owner','active')`,
        [user[0], user[1], user[0], user[0] + '@ratification.m19.test']
      );
    }
    const { putBusinessProfile } = require('../../src/services/organizationAuthority');
    const profileA = await putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: USER_A,
      expectedVersion: null,
      profile: profile('Ratification Fence A', 'm19-part3-controlled-profile-v1'),
    });
    await putBusinessProfile(pool, {
      organizationId: ORG_B,
      userId: USER_B,
      expectedVersion: null,
      profile: profile('Ratification Fence B', 'm19-part3-controlled-profile-b-v1', {
        customerMarkupPercent: 5,
        travelCustomerChargePerMile: 3,
      }),
    });
    const { provisionDurableSession } = require('../helpers/account-session-fixture');
    const authA = await provisionDurableSession(pool, { userId: USER_A, organizationId: ORG_A, role: 'owner' });
    const authB = await provisionDurableSession(pool, { userId: USER_B, organizationId: ORG_B, role: 'owner' });
    const rejectionAuth = await provisionDurableSession(pool, { userId: USER_A, organizationId: ORG_A, role: 'owner' });

    const concurrentCreates = await Promise.all(Array.from({ length: 8 }, function () {
      return createControlledGraph(pool, ORG_A, CONTROLLED_A);
    }));
    assert.ok(concurrentCreates.every(function (response) { return response.status === 201; }), 'concurrent production-service creation/replay succeeds');
    const first = concurrentCreates[0];
    const canonicalBytes = stableStringify(first.body);
    assert.ok(concurrentCreates.every(function (response) { return stableStringify(response.body) === canonicalBytes; }), 'concurrent production-service responses are byte-equivalent');
    const replay = await createControlledGraph(pool, ORG_A, CONTROLLED_A);
    assert.strictEqual(replay.status, 201);
    assert.strictEqual(stableStringify(replay.body), canonicalBytes, 'same key and fingerprint replay byte-equivalent result');
    const changed = clone(CONTROLLED_A);
    changed.scope.linearFeet = 101;
    const conflict = await createControlledGraph(pool, ORG_A, changed);
    assert.strictEqual(conflict.status, 409, 'same key with a different fingerprint conflicts');
    assert.strictEqual(conflict.body.error.code, 'IDEMPOTENCY_FINGERPRINT_CONFLICT');
    const persisted = await rawGraph(pool, ORG_A, first.body.graphId);
    assertDatabaseAgreement(first, persisted, profileA);

    await stopProductionServer(serverHandle);
    serverHandle = await startProductionServer(suiteDatabase.connectionString, port, dataRoot);
    const restartedReads = await Promise.all(Array.from({ length: 8 }, function () {
      return requestJson(serverHandle.origin, '/api/v1/canonical/graphs/' + first.body.graphId, {
        auth: authA, sessionId: SESSION_A,
      });
    }));
    assert.ok(restartedReads.every(function (response) { return response.status === 200; }), 'concurrent restart reads retain the graph');
    assert.strictEqual(new Set(restartedReads.map(function (response) { return stableStringify(response.body.data); })).size, 1, 'restart reads are identical');
    assert.strictEqual(restartedReads[0].body.data.snapshotDigest, first.body.snapshotDigest);

    const apiSurfaces = {};
    for (const surface of ALL_SURFACES) {
      const response = await requestJson(serverHandle.origin, '/api/v1/canonical/surfaces/' + surface, {
        auth: authA, sessionId: SESSION_A,
      });
      assert.strictEqual(response.status, 200, surface + ' mounted projection status');
      assert.strictEqual(response.body.data.items.length, 1, surface + ' mounted projection count');
      apiSurfaces[surface] = response.body.data;
    }
    const expectedItem = apiSurfaces.leads.items[0];
    const expectedDigest = apiSurfaces.leads.digest;
    assert.ok(ALL_SURFACES.every(function (surface) {
      return stableStringify(apiSurfaces[surface].items[0]) === stableStringify(expectedItem) &&
        apiSurfaces[surface].digest === expectedDigest;
    }), 'every mounted canonical projection shares the same item and digest');
    assert.deepStrictEqual(expectedItem.values, persisted.row.snapshot, 'API values equal raw PostgreSQL snapshot');
    assert.strictEqual(expectedItem.snapshotDigest, sha256(expectedItem.values), 'API digest equals API persisted values');
    assert.deepStrictEqual(expectedItem.ids.facts, first.body.ids.facts);
    assert.deepStrictEqual(expectedItem.supportingTranscriptFactIds, first.body.ids.facts);
    assert.strictEqual(expectedItem.businessProfile.id, profileA.id);
    assert.strictEqual(expectedItem.businessProfile.version, profileA.versionLabel);
    assert.strictEqual(expectedItem.businessProfile.hash, profileA.profileHash);
    assertCompleteSnapshot(expectedItem.values);

    const graphB = await createControlledGraph(pool, ORG_B, controlledForB());
    assert.strictEqual(graphB.status, 201, 'organization B uses its own key namespace');
    assert.notStrictEqual(graphB.body.graphId, first.body.graphId, 'organization B cannot replay organization A IDs');
    assert.notStrictEqual(graphB.body.snapshotDigest, first.body.snapshotDigest, 'organization B uses its own Business Profile authority');
    const graphBReplay = await createControlledGraph(pool, ORG_B, controlledForB());
    assert.strictEqual(stableStringify(graphBReplay.body), stableStringify(graphB.body), 'organization B replays only its own graph');
    const tenantBDirectA = await requestJson(serverHandle.origin, '/api/v1/canonical/graphs/' + first.body.graphId, {
      auth: authB, sessionId: SESSION_B,
    });
    assert.strictEqual(tenantBDirectA.status, 404, 'organization B cannot fetch organization A graph');
    const tenantBInferA = await requestJson(serverHandle.origin, '/api/v1/canonical/compat/customer-detail?customerId=' + first.body.ids.customer, {
      auth: authB, sessionId: SESSION_B,
    });
    assert.strictEqual(tenantBInferA.status, 200);
    assert.deepStrictEqual(tenantBInferA.body.data.items, [], 'organization B cannot infer organization A by customer ID');
    assert.ok(!stableStringify(tenantBInferA.body).includes(first.body.snapshotDigest), 'organization A digest is absent from tenant B responses');
    const wrongSessionList = await requestJson(serverHandle.origin, '/api/v1/canonical/surfaces/leads', {
      auth: authA, sessionId: WRONG_SESSION,
    });
    assert.strictEqual(wrongSessionList.status, 200);
    assert.deepStrictEqual(wrongSessionList.body.data.items, [], 'wrong session cannot list organization A simulation graph');
    const wrongSessionDirect = await requestJson(serverHandle.origin, '/api/v1/canonical/graphs/' + first.body.graphId, {
      auth: authA, sessionId: WRONG_SESSION,
    });
    assert.strictEqual(wrongSessionDirect.status, 404, 'wrong session cannot fetch organization A graph');
    const wrongSessionReplay = await requestJson(serverHandle.origin, '/api/v1/canonical/graphs/' + first.body.graphId, {
      auth: authA, sessionId: WRONG_SESSION,
    });
    assert.strictEqual(wrongSessionReplay.status, 404, 'wrong session cannot replay a prior graph fetch');
    assert.ok(!stableStringify(wrongSessionReplay.body).includes(first.body.snapshotDigest), 'wrong-session replay response excludes organization A digest');

    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });
    const mainBundle = await createBrowserContext(browser, serverHandle.origin, authA, SESSION_A, evidence);
    const equality = [];
    for (const testCaseSource of PAGES) {
      const testCase = { ...testCaseSource };
      if (testCase.label === 'Customer Detail') testCase.route = '/dashboard/lead?id=' + first.body.ids.opportunity;
      const opened = await openPage(mainBundle, serverHandle.origin, testCase, 1, evidence);
      const observed = await observePage(opened.page, testCase);
      assert.deepStrictEqual(opened.pageErrors, [], testCase.label + ': no uncaught page error');
      assertPageAgreement(observed, testCase, expectedItem, expectedDigest, {
        organizationId: ORG_A,
        userId: USER_A,
        sessionId: SESSION_A,
      });
      equality.push({
        page: testCase.label,
        graphId: observed.presentation.ids.graph,
        digest: observed.presentation.digest,
        snapshotDigest: observed.presentation.snapshotDigest,
        values: stableStringify(observed.presentation.values),
      });
      await opened.page.close();
    }
    assert.strictEqual(new Set(equality.map(function (entry) { return entry.graphId; })).size, 1, 'all seven surfaces share one graph');
    assert.strictEqual(new Set(equality.map(function (entry) { return entry.digest; })).size, 1, 'all seven surfaces share one projection digest');
    assert.strictEqual(new Set(equality.map(function (entry) { return entry.snapshotDigest; })).size, 1, 'all seven surfaces share one snapshot digest');
    assert.strictEqual(new Set(equality.map(function (entry) { return entry.values; })).size, 1, 'all seven surfaces share identical persisted values');
    await mainBundle.context.close();

    const tenantBBundle = await createBrowserContext(browser, serverHandle.origin, authB, SESSION_B, evidence);
    const bCase = { label: 'Tenant B control', route: '/dashboard/leads', target: 'leads', surfaces: ['leads'], appStore: true };
    const bOpened = await openPage(tenantBBundle, serverHandle.origin, bCase, 1, evidence);
    const bObserved = await observePage(bOpened.page, bCase);
    assert.strictEqual(bObserved.presentation.ids.graph, graphB.body.graphId);
    assert.notStrictEqual(bObserved.presentation.ids.graph, first.body.graphId);
    assert.ok(!stableStringify(bObserved).includes(first.body.snapshotDigest), 'tenant B browser cannot see organization A digest');
    assert.ok(!stableStringify(bObserved).includes(first.body.graphId), 'tenant B browser cannot see organization A IDs');
    assert.deepStrictEqual(bObserved.calculationCalls, [], 'tenant B browser performs no calculation');
    await bOpened.page.close();
    await tenantBBundle.context.close();

    const wrongBundle = await createBrowserContext(browser, serverHandle.origin, authA, WRONG_SESSION, evidence);
    const wrongCase = { label: 'Wrong session control', route: '/dashboard/leads', target: 'leads', surfaces: ['leads', 'estimates', 'customer-detail'], appStore: true };
    const wrongOpened = await openPage(wrongBundle, serverHandle.origin, wrongCase, 0, evidence);
    const wrongObserved = await observePage(wrongOpened.page, wrongCase);
    assert.ok(Object.values(wrongObserved.projections).every(function (projection) { return projection.items.length === 0; }));
    assert.deepStrictEqual(wrongObserved.appStore.leads, [], 'wrong-session empty projection replaces poisoned AppStore');
    assert.ok(!stableStringify(wrongObserved).includes(first.body.snapshotDigest), 'wrong-session browser cannot see authorized digest');
    assert.ok(!wrongObserved.bodyText.includes(String(POISON_PRICE)), 'wrong-session browser fails closed instead of storage fallback');
    await wrongOpened.page.close();
    await wrongBundle.context.close();

    const invalidBundle = await createBrowserContext(browser, serverHandle.origin, authA, SESSION_A, evidence);
    const invalidCase = { label: 'Invalid filter rejection', route: '/dashboard/leads', target: 'leads', surfaces: ['leads', 'estimates', 'customer-detail'], appStore: true };
    const invalidOpened = await openPage(invalidBundle, serverHandle.origin, invalidCase, 1, evidence);
    const invalidMessage = await invalidOpened.page.evaluate(async function () {
      try {
        await window.PolarisApi.getOpportunities({ customerId: 'not-a-canonical-uuid' });
        return null;
      } catch (error) {
        return error && error.message;
      }
    });
    assert.match(invalidMessage, /HTTP 400/, 'PolarisApi exposes authoritative invalid-filter rejection');
    await assertRejectedConsumers(invalidOpened.page, 'invalid-filter rejection');
    await invalidOpened.page.close();
    await invalidBundle.context.close();

    const authRejectBundle = await createBrowserContext(browser, serverHandle.origin, rejectionAuth, SESSION_A, evidence);
    const authCase = { label: 'Revoked session rejection', route: '/dashboard/leads', target: 'leads', surfaces: ['leads', 'estimates', 'customer-detail'], appStore: true };
    const authOpened = await openPage(authRejectBundle, serverHandle.origin, authCase, 1, evidence);
    await pool.query(
      "UPDATE auth_sessions SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'm19_part3_ratification' WHERE id = $1",
      [rejectionAuth.sessionId]
    );
    const authMessage = await authOpened.page.evaluate(async function () {
      try {
        await window.AppStore.loadFromServer();
        return null;
      } catch (error) {
        return error && error.message;
      }
    });
    assert.ok(authMessage, 'AppStore exposes authoritative revoked-session rejection');
    await assertRejectedConsumers(authOpened.page, 'revoked-session rejection');
    await authOpened.page.close();
    await authRejectBundle.context.close();

    const paidCommandCenter = await assertPaidCommandCenterRealOnly(browser, serverHandle.origin, authA, evidence);
    const liveSimulations = [];

    assert.deepStrictEqual(evidence.externalMutationAttempts, [], 'every external/provider mutation destination is intercepted before action');
    const browserMutations = evidence.requests.filter(function (entry) {
      return !entry.external && !['GET', 'HEAD', 'OPTIONS'].includes(entry.method);
    });
    const authRefreshAttempts = browserMutations.filter(function (entry) {
      return entry.method === 'POST' && new URL(entry.url).pathname === '/api/auth/refresh';
    });
    const liveSimulationPosts = browserMutations.filter(function (entry) {
      return entry.method === 'POST' && new URL(entry.url).pathname === '/api/v1/simulations/leads';
    });
    const businessMutations = browserMutations.filter(function (entry) {
      const pathname = new URL(entry.url).pathname;
      return !(entry.method === 'POST' && pathname === '/api/auth/refresh');
    });
    assert.strictEqual(authRefreshAttempts.length, 1, 'revoked session makes one bounded loopback auth refresh attempt');
    assert.strictEqual(liveSimulationPosts.length, 0, 'the sole mounted paid Command Center makes no simulation POST');
    assert.deepStrictEqual(businessMutations, [], 'no unbounded business mutations occur');
    assert.deepStrictEqual(evidence.pageErrors, [], 'all real pages remain free of uncaught errors');
    assert.strictEqual(directoryDigest(dataRoot), dataBefore, 'isolated file data is unchanged');

    console.log(JSON.stringify({
      browser: selected === 'chrome' ? 'installed Chrome' : 'actual Playwright WebKit',
      browserVersion: browser.version(),
      database: suiteDatabase.databaseName,
      migrations: migrations.rows.length,
      mountedServerRestarts: 1,
      controlledConcurrentRequests: concurrentCreates.length,
      controlledSeedAuthority: 'test-only harness using production ingestSimulation service',
      graphId: first.body.graphId,
      snapshotDigest: first.body.snapshotDigest,
      projectionDigest: expectedDigest,
      pages: equality.map(function (entry) { return entry.page; }),
      identicalPages: equality.length,
      wrongSession: 'list_fetch_replay_cache_blocked',
      tenantB: 'isolated',
      storageAndAppStorePoison: 'overridden_or_failed_closed',
      authoritativeRejections: ['invalid_filter_400', 'revoked_session_401'],
      externalRequestsIntercepted: evidence.external.length,
      externalMutationAttempts: evidence.externalMutationAttempts.length,
      providerActions: 0,
      authRefreshAttempts: authRefreshAttempts.length,
      paidCommandCenter,
      liveSimulations,
      businessMutations: businessMutations.length,
      pageErrors: evidence.pageErrors.length,
      consoleErrorsObserved: evidence.consoleErrors.length,
      physicalSafari: false,
    }));
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      try {
        if (serverHandle) await stopProductionServer(serverHandle);
      } finally {
        try {
          if (pool) await pool.end();
        } finally {
          await suiteDatabase.cleanup();
        }
      }
    }
  }
}

main().catch(function (error) {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
