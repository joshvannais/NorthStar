'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { Pool } = require('pg');
const cache = require('../../src/cache/client');
const { ingestRetell, ingestSimulation, ingestVoice } = require('../../src/services/canonicalGraphService');
const { stableStringify } = require('../../src/services/businessProfileAdapter');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { EXTREME_FENCE_SUBTOTAL, canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { putBusinessProfile } = require('../../src/services/organizationAuthority');
const {
  READ_MODEL_VERSION,
  createCanonicalRouter,
  createCompatibilityRouter,
  listCanonicalGraphs,
  serviceAnalyticsProjection,
  trendProjection,
} = require('../../src/routes/canonicalPolaris');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const migrationDir = path.resolve(__dirname, '../../migrations');
const migrations = [
  '001_initial_schema.sql', '002_seed_data.sql', '003_voice_sessions.sql',
  '004_canonical_persistence_v2.sql', '005_canonical_organization_authority.sql',
  '006_canonical_voice_sessions.sql',
  '007_canonical_tax_authority.sql',
  '008_canonical_demo_authority.sql',
  '009_canonical_voice_provider_identity.sql',
  '010_account_session_authority.sql',
];
const ORG_A = '00000000-0000-0000-0000-000000000001';
const USER_A = '00000000-0000-0000-0000-000000000002';
const ORG_B = '00000000-0000-0000-0000-000000000010';
const USER_B = '00000000-0000-0000-0000-000000000011';
const RATIFICATION_KEY = 'm19-part3-fence-001';

function dataDigest() {
  const root = path.resolve(__dirname, '../../data');
  const hash = crypto.createHash('sha256');
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      hash.update(entry.isDirectory() ? 'directory:' : 'file:');
      hash.update(relative);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) hash.update(fs.readFileSync(absolute));
    }
  }
  visit(root);
  return hash.digest('hex');
}

async function applyMigrations(pool) {
  for (const filename of migrations) {
    await pool.query(fs.readFileSync(path.join(migrationDir, filename), 'utf8'));
  }
  await pool.query(
    `INSERT INTO organizations (id, name, email)
     VALUES ($1, 'Organization B', 'org-b-api@m19.test')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_B]
  );
  await pool.query(
    `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
     VALUES ($1, $2, 'User B', 'user-b-api@m19.test', 'not-used', 'owner', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [USER_B, ORG_B]
  );
  await putBusinessProfile(pool, { organizationId: ORG_A, userId: USER_A, profile: graphInput(ORG_A, 'profile-a', 'profile-a', 'Profile A').businessProfile });
  await putBusinessProfile(pool, { organizationId: ORG_B, userId: USER_B, profile: graphInput(ORG_B, 'profile-b', 'profile-b', 'Profile B').businessProfile });
}

function graphInput(organizationId, sessionId, key, customerName) {
  const businessProfile = canonicalFenceProfile({ version: 'bp-ratification-v1' });
  delete businessProfile.canonicalPricing.taxRatePercent;
  return {
    tenantContext: { organizationId, trusted: true },
    idempotencyKey: key,
    source: 'simulation',
    sourceVersion: 'api-test-v1',
    external: {
      customerId: sessionId + ':customer',
      callId: sessionId + ':call',
      transcriptId: sessionId + ':transcript',
      communicationId: sessionId + ':communication',
      appointmentId: sessionId + ':appointment',
    },
    customer: {
      name: customerName,
      phone: '+15555550100',
      email: customerName.toLowerCase().replace(' ', '.') + '@example.test',
      address: { line1: '100 Cedar Lane', city: 'Testville', state: 'NY', postalCode: '10001' },
    },
    transcript: [
      { turnId: 'turn-1', speaker: 'customer', text: 'I need a new 100-foot six-foot-high cedar fence and the existing fence removed.' },
      { turnId: 'turn-2', speaker: 'customer', text: 'Include one walk gate. Permits are required. Weekday mornings work best. This is not an emergency.' },
    ],
    facts: [
      { variable: 'linearFeet', normalizedValue: 100, evidenceText: '100-foot cedar fence', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'height', normalizedValue: 6, evidenceText: 'six-foot-high', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'material', normalizedValue: 'cedar', evidenceText: 'cedar fence', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'removalRequired', normalizedValue: true, evidenceText: 'existing fence removed', speaker: 'customer', evidenceTurnId: 'turn-1', confidence: 1 },
      { variable: 'gates', normalizedValue: [{ type: 'walk' }], evidenceText: 'one walk gate', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
      { variable: 'permitsRequired', normalizedValue: true, evidenceText: 'permits are required', speaker: 'customer', evidenceTurnId: 'turn-2', confidence: 1 },
    ],
    service: {
      key: 'fence',
      scope: {
        jobType: 'replace',
        linearFeet: 100,
        height: 6,
        material: 'cedar',
        removalRequired: true,
        gates: [{ type: 'walk' }],
        permitsRequired: true,
      },
    },
    businessProfileVersion: 'bp-ratification-v1',
    businessProfile,
    appointmentPreference: { dayPart: 'morning', days: ['weekday'] },
    callDurationSeconds: 242,
  };
}

function fakeAuth(req, _res, next) {
  const organizationId = req.get('X-Test-Organization');
  const userId = req.get('X-Test-User');
  if (organizationId && userId) {
    req.tenantContext = Object.freeze({ organizationId, userId, role: 'owner' });
    req.orgId = organizationId;
    req.userRole = 'owner';
    req.user = Object.freeze({ id: userId, organizationId, role: 'owner' });
  }
  next();
}

function headers(organizationId, userId, sessionId) {
  return {
    'X-Test-Organization': organizationId,
    'X-Test-User': userId,
    'X-NorthStar-Session-ID': sessionId,
  };
}

function createApp(poolProvider, cacheClient, auditRecorder) {
  const dependencies = {
    poolProvider,
    auth: fakeAuth,
    cache: cacheClient || cache,
    audit: auditRecorder || { record: async function () {} },
  };
  const app = express();
  app.use(function (req, _res, next) {
    req.requestId = 'request-' + Math.random().toString(36).slice(2);
    next();
  });
  app.use(express.json());
  app.use('/api/v1/canonical', createCanonicalRouter(dependencies));
  app.use('/api/v1', createCompatibilityRouter(dependencies));
  return app;
}

realPostgres('Mission 19 Part 3 organization-scoped canonical APIs', () => {
  let pool;
  let app;
  let graphA;
  let graphB;
  let dataBefore;
  let multiSourcePool;
  let multiSourceApp;
  let suiteDatabases = [];

  beforeAll(async () => {
    dataBefore = dataDigest();
    suiteDatabases.push(await createSuiteDatabase('canonical-api'));
    suiteDatabases.push(await createSuiteDatabase('canonical-api-multisource'));
    pool = new Pool({ connectionString: suiteDatabases[0].connectionString, max: 20 });
    multiSourcePool = new Pool({ connectionString: suiteDatabases[1].connectionString, max: 20 });
    await applyMigrations(pool);
    await applyMigrations(multiSourcePool);
    app = createApp(function () { return pool; });
    multiSourceApp = createApp(function () { return multiSourcePool; });
  }, 30000);

  afterAll(async () => {
    try {
      expect(dataDigest()).toBe(dataBefore);
    } finally {
      cache.setEnabled(true);
      cache.clearForTests();
      await Promise.all([pool, multiSourcePool].filter(Boolean).map(value => value.end()));
      for (const database of suiteDatabases.reverse()) await database.cleanup();
    }
  });

  beforeEach(async () => {
    cache.setEnabled(true);
    cache.clearForTests();
    await Promise.all([
      pool.query('TRUNCATE TABLE canonical_operations CASCADE; TRUNCATE TABLE audit_logs'),
      multiSourcePool.query('TRUNCATE TABLE canonical_operations CASCADE; TRUNCATE TABLE audit_logs'),
    ]);
    graphA = await ingestSimulation(pool, graphInput(ORG_A, 'session-a', RATIFICATION_KEY, 'Avery Smith'));
    graphB = await ingestSimulation(pool, graphInput(ORG_B, 'session-b', RATIFICATION_KEY, 'Blair Jones'));
    expect(graphA.status).toBe(201);
    expect(graphB.status).toBe(201);
  });

  test('controlled fence fixture has one graph, byte-equivalent replay, conflict isolation, and no raw key', async () => {
    const replay = await ingestSimulation(pool, graphInput(ORG_A, 'session-a', RATIFICATION_KEY, 'Avery Smith'));
    expect(replay).toMatchObject({ status: 201, replayed: true });
    expect(stableStringify(replay.body)).toBe(stableStringify(graphA.body));
    expect(graphA.body.snapshot).toMatchObject({
      customerFacingPrice: EXTREME_FENCE_SUBTOTAL,
      subtotalBeforeTax: EXTREME_FENCE_SUBTOTAL,
      taxRatePercent: null,
      tax: null,
      totalIncludingTax: null,
      taxDisposition: { status: 'notCalculated', reason: 'tax_configuration_unavailable' },
      calculationVersion: 'm19-part3-canonical-v2',
      service: {
        scope: {
          linearFeet: 100,
          height: 6,
          material: 'cedar',
          removalRequired: true,
          gates: [{ type: 'walk' }],
          permitsRequired: true,
        },
      },
      appointmentPreference: { dayPart: 'morning', days: ['weekday'] },
      risk: { emergency: false },
      grossProfit: null,
      netProfit: null,
    });

    const conflictInput = graphInput(ORG_A, 'session-a', RATIFICATION_KEY, 'Different Customer');
    const conflict = await ingestSimulation(pool, conflictInput);
    expect(conflict).toMatchObject({
      status: 409,
      body: { error: { code: 'IDEMPOTENCY_FINGERPRINT_CONFLICT' } },
    });

    const operations = await pool.query(
      `SELECT organization_id, graph_id, row_to_json(canonical_operations)::text AS serialized
         FROM canonical_operations
        WHERE graph_id IN ($1, $2)
        ORDER BY organization_id`,
      [graphA.body.graphId, graphB.body.graphId]
    );
    expect(operations.rows).toHaveLength(2);
    expect(new Set(operations.rows.map(row => row.organization_id))).toEqual(new Set([ORG_A, ORG_B]));
    expect(new Set(operations.rows.map(row => row.graph_id)).size).toBe(2);
    expect(operations.rows.every(row => !row.serialized.includes(RATIFICATION_KEY))).toBe(true);
  });

  test('static routes precede parameter routes and status reports no Redis requirement', async () => {
    const response = await request(app).get('/api/v1/canonical/status').set(headers(ORG_A, USER_A, 'session-a'));
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      status: 'operational',
      readModelVersion: READ_MODEL_VERSION,
      postgresAuthoritative: true,
      redisRequired: false,
    });
    expect(cache.isRedisAvailable()).toBe(false);

    const pipeline = await request(app).get('/api/v1/opportunities/pipeline').set(headers(ORG_A, USER_A, 'session-a'));
    expect(pipeline.status).toBe(200);
    expect(pipeline.body.opportunities).toHaveLength(1);
    const blockedLead = await request(app).post('/api/v1/leads/simulate').set(headers(ORG_A, USER_A, 'session-a')).send({});
    const blockedCalendar = await request(app).post('/api/v1/calendar/events').set(headers(ORG_A, USER_A, 'session-a')).send({});
    expect(blockedLead.status).toBe(409);
    expect(blockedCalendar.status).toBe(409);
    expect(blockedLead.body.error.code).toBe('LEGACY_AUTHORITY_READ_ONLY');
  });

  test('organization, user, and session matrix fails closed without disclosing identifiers', async () => {
    const listA = await request(app).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'session-a'));
    expect(listA.status).toBe(200);
    expect(listA.body.data.items).toHaveLength(1);
    expect(listA.body.data.items[0].ids.graph).toBe(graphA.body.graphId);

    const wrongSession = await request(app).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'wrong-session'));
    expect(wrongSession.status).toBe(200);
    expect(wrongSession.body.data.items).toEqual([]);

    const crossTenant = await request(app)
      .get('/api/v1/canonical/graphs/' + graphA.body.graphId)
      .set(headers(ORG_B, USER_B, 'session-a'));
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.body.error.code).toBe('NOT_FOUND');

    const wrongSessionFetch = await request(app)
      .get('/api/v1/canonical/graphs/' + graphA.body.graphId)
      .set(headers(ORG_A, USER_A, 'wrong-session'));
    expect(wrongSessionFetch.status).toBe(404);

    const tenantBWrongSession = await request(app).get('/api/v1/canonical/graphs').set(headers(ORG_B, USER_B, 'session-a'));
    expect(tenantBWrongSession.status).toBe(200);
    expect(tenantBWrongSession.body.data.items).toEqual([]);

    const listB = await request(app).get('/api/v1/canonical/graphs').set(headers(ORG_B, USER_B, 'session-b'));
    expect(listB.status).toBe(200);
    expect(listB.body.data.items).toHaveLength(1);
    expect(listB.body.data.items[0].ids.graph).toBe(graphB.body.graphId);
    expect(listB.body.data.items[0].ids.graph).not.toBe(graphA.body.graphId);

    const anonymous = await request(app).get('/api/v1/canonical/graphs');
    expect(anonymous.status).toBe(401);
  });

  test('organization-wide reads retain legitimate simulation, voice, and Retell graphs without cross-tenant disclosure', async () => {
    const simulation = await ingestSimulation(
      multiSourcePool,
      graphInput(ORG_A, 'multisource-session', 'm19-api-multisource-simulation', 'Simulation Customer')
    );
    const voice = await ingestVoice(
      multiSourcePool,
      graphInput(ORG_A, 'multisource-voice', 'm19-api-multisource-voice', 'Voice Customer')
    );
    const retell = await ingestRetell(
      multiSourcePool,
      graphInput(ORG_A, 'multisource-retell', 'm19-api-multisource-retell', 'Retell Customer')
    );
    const tenantB = await ingestSimulation(
      multiSourcePool,
      graphInput(ORG_B, 'multisource-b', 'm19-api-multisource-b', 'Tenant B Customer')
    );
    expect([simulation, voice, retell, tenantB].every(result => result.status === 201)).toBe(true);

    const organizationA = await request(multiSourceApp)
      .get('/api/v1/canonical/graphs')
      .set(headers(ORG_A, USER_A, 'multisource-session'));
    expect(organizationA.status).toBe(200);
    expect(organizationA.body.data.items).toHaveLength(3);
    expect(organizationA.body.data.items.map(item => item.source.type).sort())
      .toEqual(['retell', 'simulation', 'voice']);

    const wrongSimulationSession = await request(multiSourceApp)
      .get('/api/v1/canonical/graphs')
      .set(headers(ORG_A, USER_A, 'wrong-simulation-session'));
    expect(wrongSimulationSession.status).toBe(200);
    expect(wrongSimulationSession.body.data.items.map(item => item.source.type).sort())
      .toEqual(['retell', 'voice']);

    const organizationB = await request(multiSourceApp)
      .get('/api/v1/canonical/graphs')
      .set(headers(ORG_B, USER_B, 'multisource-b'));
    expect(organizationB.status).toBe(200);
    expect(organizationB.body.data.items).toHaveLength(1);
    expect(organizationB.body.data.items[0].ids.graph).toBe(tenantB.body.graphId);
    expect(organizationB.body.data.items[0].ids.graph).not.toBe(simulation.body.graphId);
  });

  test('canonical and compatibility projections return identical values and digests', async () => {
    const canonical = await request(app).get('/api/v1/canonical/surfaces/leads').set(headers(ORG_A, USER_A, 'session-a'));
    const compatibility = await request(app).get('/api/v1/canonical/compat/leads').set(headers(ORG_A, USER_A, 'session-a'));
    const legacyPath = await request(app).get('/api/v1/leads').set(headers(ORG_A, USER_A, 'session-a'));
    expect(canonical.status).toBe(200);
    expect(compatibility.status).toBe(200);
    expect(legacyPath.status).toBe(200);
    expect(canonical.body.data.authority).toEqual({
      organizationId: ORG_A,
      userId: USER_A,
      sessionId: 'session-a',
      explicitSession: 'session-a',
    });
    expect(compatibility.body.data.authority).toEqual(canonical.body.data.authority);
    expect(compatibility.body.data.digest).toBe(canonical.body.data.digest);
    expect(legacyPath.body.canonicalDigest).toBe(canonical.body.data.digest);
    expect(stableStringify(compatibility.body.data.items[0].values))
      .toBe(stableStringify(canonical.body.data.items[0].values));
    expect(legacyPath.body.items[0].canonical.snapshotDigest).toBe(graphA.body.snapshotDigest);
  });

  test('all Part 3 surface projections expose one graph digest and value object', async () => {
    const surfaces = ['customer-detail', 'leads', 'communications', 'calendar', 'command-center', 'polaris', 'executive', 'estimates'];
    const responses = [];
    for (const surface of surfaces) {
      responses.push(await request(app).get('/api/v1/canonical/surfaces/' + surface).set(headers(ORG_A, USER_A, 'session-a')));
    }
    expect(responses.every(response => response.status === 200)).toBe(true);
    expect(new Set(responses.map(response => response.body.data.digest)).size).toBe(1);
    expect(new Set(responses.map(response => response.body.data.items[0].snapshotDigest)).size).toBe(1);
    expect(new Set(responses.map(response => stableStringify(response.body.data.items[0].values))).size).toBe(1);
    expect(responses.every(response => response.body.data.authority.organizationId === ORG_A)).toBe(true);
    expect(responses.every(response => response.body.data.authority.userId === USER_A)).toBe(true);
    expect(responses.every(response => response.body.data.authority.sessionId === 'session-a')).toBe(true);
  });

  test('every surface exposes the persisted fact, source, profile, fingerprint, and timestamp metadata', async () => {
    const surfaces = ['customer-detail', 'leads', 'communications', 'calendar', 'command-center', 'polaris', 'executive', 'estimates'];
    const responses = [];
    for (const surface of surfaces) {
      responses.push(await request(app).get('/api/v1/canonical/surfaces/' + surface).set(headers(ORG_A, USER_A, 'session-a')));
    }
    expect(responses.every(response => response.status === 200)).toBe(true);
    const items = responses.map(response => response.body.data.items[0]);
    expect(items.every(item => stableStringify(item.ids.facts) === stableStringify(graphA.body.ids.facts))).toBe(true);
    expect(items.every(item => item.normalizedInputFingerprint === graphA.body.normalizedInputFingerprint)).toBe(true);
    expect(items.every(item => item.source.type === 'simulation')).toBe(true);
    expect(items.every(item => item.source.version === 'api-test-v1')).toBe(true);
    expect(items.every(item => item.source.externalCallId === 'session-a:call')).toBe(true);
    expect(items.every(item => item.source.externalTranscriptId === 'session-a:transcript')).toBe(true);
    expect(items.every(item => stableStringify(item.supportingTranscriptFactIds) === stableStringify(graphA.body.ids.facts))).toBe(true);
    expect(items.every(item => stableStringify(item.businessProfile) === stableStringify(graphA.body.businessProfile))).toBe(true);
    expect(items.every(item => Array.isArray(item.facts) && item.facts.length === graphA.body.ids.facts.length)).toBe(true);
    expect(items.every(item => item.facts.every((fact, index) => fact.id === graphA.body.ids.facts[index]))).toBe(true);
    expect(items.every(item => item.timestamps && item.timestamps.operationCreatedAt && item.timestamps.operationCompletedAt &&
      item.timestamps.transcriptCreatedAt && item.timestamps.estimateCreatedAt && item.timestamps.snapshotCreatedAt)).toBe(true);
    expect(new Set(items.map(item => stableStringify(item))).size).toBe(1);
  });

  test('dashboard and analytics are equal and derived from the canonical snapshot', async () => {
    const dashboard = await request(app).get('/api/v1/canonical/dashboard').set(headers(ORG_A, USER_A, 'session-a'));
    const analytics = await request(app).get('/api/v1/canonical/analytics').set(headers(ORG_A, USER_A, 'session-a'));
    expect(dashboard.status).toBe(200);
    expect(analytics.status).toBe(200);
    expect(analytics.body.data).toEqual(dashboard.body.data);
    expect(dashboard.body.data).toMatchObject({
      graphCount: 1,
      customerCount: 1,
      estimatedRevenue: EXTREME_FENCE_SUBTOTAL,
      knownGrossProfit: null,
    });
  });

  test('compatibility analytics and recommendations project persisted canonical intelligence truthfully', async () => {
    const before = await Promise.all([
      request(app).get('/api/v1/analytics/trends').set(headers(ORG_A, USER_A, 'session-a')),
      request(app).get('/api/v1/analytics/by-service').set(headers(ORG_A, USER_A, 'session-a')),
      request(app).get('/api/v1/polaris/recommendations').set(headers(ORG_A, USER_A, 'session-a')),
      request(app).get('/api/v1/opportunities/pipeline').set(headers(ORG_A, USER_A, 'session-a')),
      request(app).get('/api/v1/analytics/alerts').set(headers(ORG_A, USER_A, 'session-a')),
    ]);
    expect(before.every(response => response.status === 200)).toBe(true);

    const [trends, services, recommendations, pipeline, alerts] = before.map(response => response.body);
    expect(trends.data.projection).toEqual({ status: 'available', canonicalGraphCount: 1 });
    expect(trends.data.trend).toHaveLength(1);
    expect(trends.data.trend[0]).toMatchObject({
      graphCount: 1,
      estimatedRevenue: EXTREME_FENCE_SUBTOTAL,
      pricedGraphCount: 1,
      unpricedGraphCount: 0,
    });
    expect(trends.data.trend[0].sourceGraphs[0]).toMatchObject({
      graphId: graphA.body.graphId,
      snapshotDigest: graphA.body.snapshotDigest,
      businessProfile: {
        id: graphA.body.businessProfile.id,
        version: graphA.body.businessProfile.version,
        hash: graphA.body.businessProfile.hash,
      },
    });

    expect(services.data.projection).toEqual({ status: 'available', canonicalGraphCount: 1 });
    expect(services.data.services).toHaveLength(1);
    expect(services.data.services[0]).toMatchObject({
      serviceKey: 'fence',
      graphCount: 1,
      estimatedRevenue: EXTREME_FENCE_SUBTOTAL,
      serviceIdentity: { status: 'available' },
    });
    expect(services.data.services[0].sourceGraphs[0].graphId).toBe(graphA.body.graphId);

    expect(recommendations.projection).toEqual({ status: 'available', canonicalGraphCount: 1 });
    expect(recommendations.recommendations).toEqual(graphA.body.snapshot.recommendedActions);
    expect(recommendations.recommendationDetails.map(item => item.recommendation))
      .toEqual(graphA.body.snapshot.recommendedActions);
    expect(recommendations.recommendationDetails[0].sourceGraphs[0].graphId).toBe(graphA.body.graphId);
    expect(pipeline.projection).toEqual({ status: 'available', canonicalGraphCount: 1 });
    expect(pipeline.stages.lead).toMatchObject({ count: 1, graphIds: [graphA.body.graphId] });
    expect(alerts.projection).toEqual({ status: 'available', canonicalGraphCount: 1 });
    expect(alerts.alerts).toEqual([]);

    const replay = await ingestSimulation(pool, graphInput(ORG_A, 'session-a', RATIFICATION_KEY, 'Avery Smith'));
    expect(replay).toMatchObject({ status: 201, replayed: true });
    const after = await Promise.all([
      request(app).get('/api/v1/analytics/trends').set(headers(ORG_A, USER_A, 'session-a')),
      request(app).get('/api/v1/analytics/by-service').set(headers(ORG_A, USER_A, 'session-a')),
      request(app).get('/api/v1/polaris/recommendations').set(headers(ORG_A, USER_A, 'session-a')),
    ]);
    expect(after.map(response => response.body)).toEqual(before.slice(0, 3).map(response => response.body));
  });

  test('compatibility projections exclude other organizations and distinguish genuine empty state', async () => {
    const tenantB = await Promise.all([
      request(app).get('/api/v1/analytics/trends').set(headers(ORG_B, USER_B, 'session-b')),
      request(app).get('/api/v1/analytics/by-service').set(headers(ORG_B, USER_B, 'session-b')),
      request(app).get('/api/v1/polaris/recommendations').set(headers(ORG_B, USER_B, 'session-b')),
    ]);
    expect(tenantB.every(response => response.status === 200)).toBe(true);
    const tenantBSources = [
      tenantB[0].body.data.trend[0].sourceGraphs,
      tenantB[1].body.data.services[0].sourceGraphs,
      tenantB[2].body.recommendationDetails[0].sourceGraphs,
    ].flat();
    expect(new Set(tenantBSources.map(source => source.graphId))).toEqual(new Set([graphB.body.graphId]));
    expect(tenantBSources.some(source => source.graphId === graphA.body.graphId)).toBe(false);

    const emptyOrganization = '00000000-0000-0000-0000-000000000020';
    const emptyUser = '00000000-0000-0000-0000-000000000021';
    const empty = await Promise.all([
      request(app).get('/api/v1/analytics/trends').set(headers(emptyOrganization, emptyUser, 'empty-session')),
      request(app).get('/api/v1/analytics/by-service').set(headers(emptyOrganization, emptyUser, 'empty-session')),
      request(app).get('/api/v1/polaris/recommendations').set(headers(emptyOrganization, emptyUser, 'empty-session')),
      request(app).get('/api/v1/opportunities/pipeline').set(headers(emptyOrganization, emptyUser, 'empty-session')),
    ]);
    expect(empty.every(response => response.status === 200)).toBe(true);
    expect(empty[0].body.data).toMatchObject({
      trend: [],
      projection: { status: 'no_canonical_data', canonicalGraphCount: 0 },
      graphCount: 0,
      estimatedRevenue: null,
    });
    expect(empty[1].body.data).toMatchObject({
      services: [],
      projection: { status: 'no_canonical_data', canonicalGraphCount: 0 },
    });
    expect(empty[2].body).toMatchObject({
      recommendations: [],
      recommendationDetails: [],
      projection: { status: 'no_canonical_data', canonicalGraphCount: 0 },
    });
    expect(empty[3].body).toMatchObject({
      stages: {},
      projection: { status: 'no_canonical_data', canonicalGraphCount: 0 },
    });
  });

  test('unsupported canonical projection inputs return explicit unavailable dispositions', async () => {
    const items = await listCanonicalGraphs(pool, {
      organizationId: ORG_A,
      userId: USER_A,
      sessionId: 'session-a',
      explicitSession: 'session-a',
    }, { limit: 50, status: null, customerId: null });
    expect(items).toHaveLength(1);
    const missingService = [{ ...items[0], snapshot: { ...items[0].snapshot, service: null } }];
    const missingTimestamp = [{ ...items[0], snapshotCreatedAt: 'not-a-timestamp' }];
    expect(serviceAnalyticsProjection(missingService).services[0]).toMatchObject({
      serviceKey: null,
      serviceIdentity: { status: 'unavailable', reason: 'canonical_service_identity_unavailable' },
    });
    expect(trendProjection(missingTimestamp)).toMatchObject({
      trend: [],
      projection: {
        status: 'unavailable',
        reason: 'canonical_snapshot_timestamp_unavailable',
        canonicalGraphCount: 1,
      },
    });
  });

  test('every canonical read queries PostgreSQL while generic cache expiry remains isolated', async () => {
    cache.clearForTests();
    cache.setEnabled(true);
    let queryCount = 0;
    const countedPool = {
      query: async function (...args) {
        queryCount += 1;
        return pool.query(...args);
      },
    };
    const countedApp = createApp(function () { return countedPool; });
    const first = await request(countedApp).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'session-a'));
    const second = await request(countedApp).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'session-a'));
    expect(second.body).toEqual(first.body);
    expect(queryCount).toBe(2);

    await request(countedApp).get('/api/v1/canonical/graphs?status=lead').set(headers(ORG_A, USER_A, 'session-a'));
    await request(countedApp).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'other-session'));
    await request(countedApp).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_B, 'session-a'));
    await request(countedApp).get('/api/v1/canonical/graphs').set(headers(ORG_B, USER_B, 'session-b'));
    expect(queryCount).toBe(6);

    const genericKey = cache.buildKey('test-expiry', ORG_A);
    await cache.set(genericKey, { value: 'cached' }, 0.01);
    expect(await cache.get(genericKey)).toEqual({ value: 'cached' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(await cache.get(genericKey)).toBeNull();

    cache.setEnabled(false);
    const disabledBefore = queryCount;
    const disabledA = await request(countedApp).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'session-a'));
    const disabledB = await request(countedApp).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'session-a'));
    expect(disabledB.body).toEqual(disabledA.body);
    expect(queryCount - disabledBefore).toBe(2);
    cache.setEnabled(true);
    cache.clearForTests();
  });

  test('canonical reads never invoke an injected cache and Redis configuration is ignored', async () => {
    const failingCache = {
      wrapCanonical: async function () { throw new Error('canonical cache must not be called'); },
      invalidateOrg: async function () { throw new Error('canonical cache must not be called'); },
      isAvailable: function () { throw new Error('canonical cache must not be called'); },
    };
    const noCacheApp = createApp(function () { return pool; }, failingCache);
    const response = await request(noCacheApp).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'session-a'));
    expect(response.status).toBe(200);
    expect(response.body.data.items[0].snapshotDigest).toBe(graphA.body.snapshotDigest);
  });

  test('identifier mutation is tenant/session isolated and persists a correlated audit row', async () => {
    const auditRecorder = {
      record: async function (entry) {
        await pool.query(
          `INSERT INTO audit_logs
            (organization_id, user_id, action, entity_type, entity_id, details, ip_address)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
          [entry.organizationId, entry.userId, entry.action, entry.entityType, entry.entityId,
            JSON.stringify({ requestId: entry.correlationId, beforeState: entry.beforeState, afterState: entry.afterState }),
            entry.ipAddress || '']
        );
      },
    };
    const mutationApp = createApp(function () { return pool; }, cache, auditRecorder);
    const appointmentId = graphA.body.ids.appointment;
    const crossTenant = await request(mutationApp)
      .patch('/api/v1/canonical/appointments/' + appointmentId)
      .set(headers(ORG_B, USER_B, 'session-a'))
      .send({ status: 'scheduled', scheduledStart: '2026-07-28T13:00:00.000Z', scheduledEnd: '2026-07-28T14:00:00.000Z' });
    expect(crossTenant.status).toBe(404);

    const wrongSession = await request(mutationApp)
      .patch('/api/v1/canonical/appointments/' + appointmentId)
      .set(headers(ORG_A, USER_A, 'wrong-session'))
      .send({ status: 'scheduled' });
    expect(wrongSession.status).toBe(404);

    const updated = await request(mutationApp)
      .patch('/api/v1/canonical/appointments/' + appointmentId)
      .set(headers(ORG_A, USER_A, 'session-a'))
      .send({ status: 'scheduled', scheduledStart: '2026-07-28T13:00:00.000Z', scheduledEnd: '2026-07-28T14:00:00.000Z' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.status).toBe('scheduled');
    const auditRow = await pool.query(
      `SELECT organization_id, user_id, action, entity_type, entity_id, details
         FROM audit_logs WHERE entity_type = 'canonical_appointment' AND entity_id = $1`,
      [appointmentId]
    );
    expect(auditRow.rows).toHaveLength(1);
    expect(auditRow.rows[0]).toMatchObject({
      organization_id: ORG_A,
      user_id: USER_A,
      action: 'PATCH 200',
      entity_type: 'canonical_appointment',
      entity_id: appointmentId,
    });
    expect(auditRow.rows[0].details.requestId).toMatch(/^request-/);
  });

  test('required PostgreSQL outage returns 503 instead of empty success', async () => {
    const unavailable = createApp(function () {
      return { query: async function () { throw new Error('connection refused'); } };
    });
    const status = await request(unavailable).get('/api/v1/canonical/status').set(headers(ORG_A, USER_A, 'session-a'));
    const graphs = await request(unavailable).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'session-a'));
    const trends = await request(unavailable).get('/api/v1/analytics/trends').set(headers(ORG_A, USER_A, 'session-a'));
    expect(status.status).toBe(503);
    expect(graphs.status).toBe(503);
    expect(trends.status).toBe(503);
    expect(status.body.error.code).toBe('CANONICAL_PERSISTENCE_UNAVAILABLE');
    expect(graphs.body.error.code).toBe('CANONICAL_PERSISTENCE_UNAVAILABLE');
    expect(trends.body.error.code).toBe('CANONICAL_PERSISTENCE_UNAVAILABLE');
  });

  describe('customerId filter validation', () => {
    const validUUID = '00000000-0000-0000-0000-000000000099';

    test('missing customerId retains unfiltered organization-scoped collection', async () => {
      const res = await request(app).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('valid customerId filters normally', async () => {
      const res = await request(app).get('/api/v1/canonical/graphs?customerId=' + validUUID).set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(200);
    });

    test('empty-string customerId returns 400 INVALID_CUSTOMER_ID', async () => {
      const res = await request(app).get('/api/v1/canonical/graphs?customerId=').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CUSTOMER_ID');
    });

    test('whitespace-only customerId returns 400', async () => {
      const res = await request(app).get('/api/v1/canonical/graphs?customerId=%20%20').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CUSTOMER_ID');
    });

    test('malformed UUID returns 400 INVALID_CUSTOMER_ID', async () => {
      const res = await request(app).get('/api/v1/canonical/graphs?customerId=not-a-uuid').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CUSTOMER_ID');
    });

    test('partial UUID fails closed', async () => {
      const res = await request(app).get('/api/v1/canonical/graphs?customerId=00000000-0000').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CUSTOMER_ID');
    });

    test('malformed customerId on dashboard endpoint returns 400', async () => {
      const res = await request(app).get('/api/v1/canonical/dashboard?customerId=bad').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(400);
    });

    test('malformed customerId on surfaces endpoint returns 400', async () => {
      const res = await request(app).get('/api/v1/canonical/surfaces/customer-detail?customerId=bad').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(400);
    });

    test('malformed customerId on compat endpoint returns 400', async () => {
      const res = await request(app).get('/api/v1/canonical/compat/customer-detail?customerId=bad').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(400);
    });

    test('analytics endpoint also rejects malformed customerId', async () => {
      const res = await request(app).get('/api/v1/canonical/analytics?customerId=bad').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(400);
    });

    test('persistence outage remains 503, not 400', async () => {
      const unavailable = createApp(function () {
        return { query: async function () { throw new Error('connection refused'); } };
      });
      const res = await request(unavailable).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('CANONICAL_PERSISTENCE_UNAVAILABLE');
    });

    test('invalid filter error body includes requestId', async () => {
      const res = await request(app).get('/api/v1/canonical/graphs?customerId=bad').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('requestId');
      expect(typeof res.body.requestId).toBe('string');
      expect(res.body.requestId.length).toBeGreaterThan(0);
    });

    test('503 error body includes requestId', async () => {
      const unavailable = createApp(function () {
        return { query: async function () { throw new Error('connection refused'); } };
      });
      const res = await request(unavailable).get('/api/v1/canonical/graphs').set(headers(ORG_A, USER_A, 'session-a'));
      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty('requestId');
    });
  });
});
