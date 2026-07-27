'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');

jest.mock('../../src/leads/store', () => {
  const actual = jest.requireActual('../../src/leads/store');
  return {
    ...actual,
    addLead: jest.fn(() => { throw new Error('legacy lead writer invoked'); }),
    updateLead: jest.fn(() => { throw new Error('legacy lead writer invoked'); }),
    removeLead: jest.fn(() => { throw new Error('legacy lead writer invoked'); }),
  };
});

jest.mock('../../src/sheets/client', () => ({
  appendLead: jest.fn(async () => { throw new Error('Sheets projection invoked'); }),
}));

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const ORG_A = '10000000-0000-0000-0000-000000000001';
const ORG_B = '10000000-0000-0000-0000-000000000002';
const USERS = {
  owner: '20000000-0000-0000-0000-000000000001',
  admin: '20000000-0000-0000-0000-000000000002',
  member: '20000000-0000-0000-0000-000000000003',
  viewer: '20000000-0000-0000-0000-000000000004',
  inactive: '20000000-0000-0000-0000-000000000005',
  other: '20000000-0000-0000-0000-000000000006',
  missing: '20000000-0000-0000-0000-000000000099',
};

function directoryDigest(root) {
  const hash = crypto.createHash('sha256');
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      hash.update((entry.isDirectory() ? 'd:' : 'f:') + path.relative(root, absolute).replace(/\\/g, '/'));
      if (entry.isDirectory()) visit(absolute);
      else hash.update(fs.readFileSync(absolute));
    }
  }
  visit(root);
  return hash.digest('hex');
}

const profile = {
  company: { name: 'Mounted Test Company', currency: 'USD' },
  headquarters: {},
  crew: { defaultCrewSize: 2, maxCrewSize: 6, averageHourlyRate: 42, overtimeMultiplier: 1.5 },
  financial: { desiredGrossMargin: 40, markup: 1.3, emergencyMarkup: 1.5, travelCharge: 0.58 },
  canonicalPricing: { customerMarkupPercent: 50, taxRatePercent: 0 },
  scheduling: { maxJobsPerDay: 4, workDayLength: 8 },
  services: [],
};

realPostgres('Mission 19 Part 3 corrected real server mount', () => {
  let suiteDatabase;
  let db;
  let app;
  let generateToken;
  let putBusinessProfile;
  let bindIntegrationOwner;
  let voiceSessions;
  let profileAuthorityA;
  let profileAuthorityB;
  let integrationAuthorityA;
  let integrationAuthorityB;
  let leadStore;
  let sheets;
  let originalDatabaseUrl;
  let originalOpenAiKey;
  let originalRetellKey;
  let originalRetellWebhookSecret;
  let originalDemoOrganizationId;
  let retell;
  let dataBefore;
  let legacyCountsBefore;

  function token(userId) {
    return generateToken({ id: userId, email: userId + '@m19.test', name: userId });
  }

  function auth(userId) {
    return { Authorization: 'Bearer ' + token(userId) };
  }

  beforeAll(async () => {
    dataBefore = directoryDigest(process.env.NORTHSTAR_DATA_DIR);
    suiteDatabase = await createSuiteDatabase('remediation-mounted');
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalOpenAiKey = process.env.OPENAI_API_KEY;
    originalRetellKey = process.env.RETELL_API_KEY;
    originalRetellWebhookSecret = process.env.RETELL_WEBHOOK_SECRET;
    originalDemoOrganizationId = process.env.NORTHSTAR_DEMO_ORGANIZATION_ID;
    process.env.DATABASE_URL = suiteDatabase.connectionString;
    delete process.env.OPENAI_API_KEY;
    delete process.env.RETELL_API_KEY;
    delete process.env.RETELL_WEBHOOK_SECRET;
    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1, 'Mounted Organization A', 'mounted-a@m19.test'),
        ($2, 'Mounted Organization B', 'mounted-b@m19.test')`,
      [ORG_A, ORG_B]
    );
    const userRows = [
      [USERS.owner, ORG_A, 'owner', 'active'],
      [USERS.admin, ORG_A, 'admin', 'active'],
      [USERS.member, ORG_A, 'member', 'active'],
      [USERS.viewer, ORG_A, 'viewer', 'active'],
      [USERS.inactive, ORG_A, 'member', 'disabled'],
      [USERS.other, ORG_B, 'owner', 'active'],
    ];
    for (const row of userRows) {
      await pool.query(
        `INSERT INTO users (id, organization_id, name, email, password_hash, role, status)
         VALUES ($1,$2,$3,$4,'not-used',$5,$6)`,
        [row[0], row[1], row[2], row[0] + '@m19.test', row[2], row[3]]
      );
    }
    ({ putBusinessProfile, bindIntegrationOwner } = require('../../src/services/organizationAuthority'));
    profileAuthorityA = await putBusinessProfile(pool, { organizationId: ORG_A, userId: USERS.owner, profile });
    profileAuthorityB = await putBusinessProfile(pool, { organizationId: ORG_B, userId: USERS.other, profile: { ...profile, company: { name: 'Other Company', currency: 'USD' } } });
    integrationAuthorityA = await bindIntegrationOwner(pool, {
      organizationId: ORG_A,
      userId: USERS.owner,
      provider: 'retell',
      externalIntegrationId: 'agent-mounted-a',
      metadata: { source: 'mounted-test' },
    });
    integrationAuthorityB = await bindIntegrationOwner(pool, {
      organizationId: ORG_B,
      userId: USERS.other,
      provider: 'retell',
      externalIntegrationId: 'agent-mounted-b',
      metadata: { source: 'mounted-test' },
    });
    voiceSessions = require('../../src/services/voiceSessionAuthority');
    retell = require('../../src/retell/client');
    ({ app } = require('../../src/server'));
    ({ generateToken } = require('../../src/auth/middleware'));
    leadStore = require('../../src/leads/store');
    sheets = require('../../src/sheets/client');
    legacyCountsBefore = (await pool.query(
      `SELECT (SELECT count(*)::int FROM leads) AS leads,
              (SELECT count(*)::int FROM call_records) AS calls`
    )).rows[0];
  }, 60000);

  afterAll(async () => {
    try {
      expect(directoryDigest(process.env.NORTHSTAR_DATA_DIR)).toBe(dataBefore);
      if (db && db.getPool()) await db.getPool().end();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiKey;
      if (originalRetellKey === undefined) delete process.env.RETELL_API_KEY;
      else process.env.RETELL_API_KEY = originalRetellKey;
      if (originalRetellWebhookSecret === undefined) delete process.env.RETELL_WEBHOOK_SECRET;
      else process.env.RETELL_WEBHOOK_SECRET = originalRetellWebhookSecret;
      if (originalDemoOrganizationId === undefined) delete process.env.NORTHSTAR_DEMO_ORGANIZATION_ID;
      else process.env.NORTHSTAR_DEMO_ORGANIZATION_ID = originalDemoOrganizationId;
      if (suiteDatabase) await suiteDatabase.cleanup();
    }
  });

  test('owner, admin, and member can create canonical leads while viewer and invalid memberships mutate nothing', async () => {
    const pool = db.getPool();
    const before = (await pool.query("SELECT count(*)::int AS count FROM canonical_operations WHERE state = 'completed'")).rows[0].count;
    for (const role of ['owner', 'admin', 'member']) {
      const response = await request(app)
        .post('/api/leads')
        .set(auth(USERS[role]))
        .set('Idempotency-Key', 'mounted-' + role)
        .send({ customerName: role + ' Customer', phone: '+15555551' + (role === 'owner' ? '101' : role === 'admin' ? '102' : '103'), service: 'general' });
      expect(response.status).toBe(201);
      expect(response.body.lead.canonical).toBe(true);
    }
    const afterAllowed = (await pool.query("SELECT count(*)::int AS count FROM canonical_operations WHERE state = 'completed'")).rows[0].count;
    expect(afterAllowed - before).toBe(3);

    const denied = [
      [USERS.viewer, 403],
      [USERS.inactive, 403],
      [USERS.missing, 403],
    ];
    for (const [userId, expected] of denied) {
      const response = await request(app)
        .post('/api/leads')
        .set(auth(userId))
        .set('Idempotency-Key', 'denied-' + userId)
        .send({ customerName: 'Denied', phone: '+15555551999', service: 'general' });
      expect(response.status).toBe(expected);
    }
    const afterDenied = (await pool.query("SELECT count(*)::int AS count FROM canonical_operations WHERE state = 'completed'")).rows[0].count;
    expect(afterDenied).toBe(afterAllowed);
  });

  test('ambiguous and unavailable authorization fail closed through the mounted app with zero mutation', async () => {
    const pool = db.getPool();
    const before = (await pool.query('SELECT count(*)::int AS count FROM canonical_operations')).rows[0].count;
    const originalQuery = db.query;
    db.query = async function (statement, values) {
      if (/FROM users/i.test(statement)) {
        const row = { id: USERS.owner, organization_id: ORG_A, role: 'owner', status: 'active', email: 'owner@m19.test', name: 'Owner' };
        return { rows: [row, { ...row }] };
      }
      return originalQuery(statement, values);
    };
    const ambiguous = await request(app)
      .post('/api/leads').set(auth(USERS.owner)).set('Idempotency-Key', 'ambiguous')
      .send({ customerName: 'Ambiguous', service: 'general' });
    db.query = async function () { throw new Error('authorization database unavailable'); };
    const unavailable = await request(app)
      .post('/api/leads').set(auth(USERS.owner)).set('Idempotency-Key', 'unavailable')
      .send({ customerName: 'Unavailable', service: 'general' });
    db.query = originalQuery;
    expect(ambiguous.status).toBe(403);
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.code).toBe('authorization_unavailable');
    expect((await pool.query('SELECT count(*)::int AS count FROM canonical_operations')).rows[0].count).toBe(before);
  });

  test('simulation and appointment mutations apply persisted RBAC and cross-organization IDs do not disclose', async () => {
    const memberSimulation = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth(USERS.member))
      .set('Idempotency-Key', 'mounted-simulation-member')
      .send({ name: 'Simulation Member', service: 'fence', phone: '+15555551104' });
    expect(memberSimulation.status).toBe(201);
    const canonicalMarkup = memberSimulation.body.polaris.pricingLineItems.find(item => item.code === 'configured-markup');
    const canonicalBase = memberSimulation.body.polaris.pricingLineItems
      .filter(item => item.code !== 'configured-markup')
      .reduce((sum, item) => sum + item.customerCharge, 0);
    expect(canonicalMarkup.customerCharge).toBe(canonicalBase * 0.5);
    expect(memberSimulation.body.summary.estimatedValue).toBe(memberSimulation.body.polaris.customerFacingPrice);
    const simulatedAgentText = memberSimulation.body.transcript
      .filter(turn => turn.speaker === 'ai')
      .map(turn => turn.text)
      .join('\n');
    expect(simulatedAgentText).toContain('provide the written estimate before any work begins');
    expect(simulatedAgentText).not.toMatch(/\$|price range|typically looking in the range/i);
    const viewerSimulation = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth(USERS.viewer))
      .set('Idempotency-Key', 'mounted-simulation-viewer')
      .send({ name: 'Simulation Viewer', service: 'fence' });
    expect(viewerSimulation.status).toBe(403);

    const viewerPatch = await request(app)
      .patch('/api/v1/canonical/appointments/' + memberSimulation.body.ids.appointment)
      .set(auth(USERS.viewer))
      .set('X-NorthStar-Session-ID', memberSimulation.body.sessionId)
      .send({ status: 'scheduled' });
    expect(viewerPatch.status).toBe(403);
    const ownerPatch = await request(app)
      .patch('/api/v1/canonical/appointments/' + memberSimulation.body.ids.appointment)
      .set(auth(USERS.owner))
      .set('X-NorthStar-Session-ID', memberSimulation.body.sessionId)
      .send({ status: 'scheduled' });
    expect(ownerPatch.status).toBe(200);
    const crossOrganization = await request(app)
      .patch('/api/v1/canonical/appointments/' + memberSimulation.body.ids.appointment)
      .set(auth(USERS.other))
      .set('X-NorthStar-Session-ID', memberSimulation.body.sessionId)
      .send({ status: 'cancelled' });
    expect(crossOrganization.status).toBe(404);
  });

  test('one mounted Retell event commits exactly one graph and invokes zero legacy, file, or Sheets writers', async () => {
    const pool = db.getPool();
    const bytesBefore = directoryDigest(process.env.NORTHSTAR_DATA_DIR);
    const event = {
      event: 'call_ended',
      event_id: 'evt-mounted-retell-1',
      call: {
        call_id: 'call-mounted-retell-1',
        agent_id: 'agent-mounted-a',
        from_number: '(555) 555-1200',
        transcript_object: [
          { role: 'agent', words: 'How can I help?' },
          { role: 'user', words: 'I need plumbing help. My name is Riley.' },
        ],
        call_analysis: { customer_name: 'Riley Retell', service_requested: 'plumbing' },
      },
    };
    const first = await request(app).post('/api/retell/webhook').send(event);
    expect(first.status).toBe(201);
    const replay = await request(app).post('/api/retell/webhook').send({
      ...event, event: 'call_analyzed', event_id: 'evt-mounted-retell-2', call: { ...event.call, transcript_object: undefined },
    });
    expect(replay.status).toBe(201);
    expect(replay.body.replayed).toBe(true);
    const graphs = await pool.query(
      `SELECT count(*)::int AS count FROM canonical_operations o
        JOIN canonical_transcripts t ON t.operation_id = o.id
       WHERE o.organization_id = $1 AND t.external_call_id = $2 AND o.state = 'completed'`,
      [ORG_A, 'call-mounted-retell-1']
    );
    expect(graphs.rows[0].count).toBe(1);
    expect(leadStore.addLead).not.toHaveBeenCalled();
    expect(leadStore.updateLead).not.toHaveBeenCalled();
    expect(leadStore.removeLead).not.toHaveBeenCalled();
    expect(sheets.appendLead).not.toHaveBeenCalled();
    expect(directoryDigest(process.env.NORTHSTAR_DATA_DIR)).toBe(bytesBefore);
    expect((await pool.query(
      `SELECT (SELECT count(*)::int FROM leads) AS leads,
              (SELECT count(*)::int FROM call_records) AS calls`
    )).rows[0]).toEqual(legacyCountsBefore);

    const beforeUnknown = (await pool.query('SELECT count(*)::int AS count FROM canonical_operations')).rows[0].count;
    const unknown = await request(app).post('/api/retell/webhook').send({ ...event, call: { ...event.call, call_id: 'unknown-call', agent_id: 'unknown-agent' } });
    expect(unknown.status).toBe(404);
    expect((await pool.query('SELECT count(*)::int AS count FROM canonical_operations')).rows[0].count).toBe(beforeUnknown);
  });

  test('the mounted signed-voice path uses the same persisted ownership and canonical transaction', async () => {
    const payload = {
      event: 'call_ended',
      event_id: 'evt-mounted-voice-1',
      timestamp: Math.floor(Date.now() / 1000),
      call: {
        call_id: 'call-mounted-voice-1',
        agent_id: 'agent-mounted-a',
        from_number: '+15555551201',
        transcript_object: [
          { role: 'agent', words: 'How can I help?' },
          { role: 'user', words: 'I need electrical service.' },
        ],
        call_analysis: { customer_name: 'Voice Customer', service_requested: 'electrical' },
      },
    };
    const response = await request(app)
      .post('/api/v1/voice/webhook')
      .set('X-Retell-Timestamp', String(payload.timestamp))
      .send(payload);
    expect(response.status).toBe(201);
    const stored = await db.getPool().query(
      `SELECT t.source, count(*)::int AS count
         FROM canonical_operations o
         JOIN canonical_transcripts t ON t.operation_id = o.id
        WHERE o.organization_id = $1 AND t.external_call_id = $2
        GROUP BY t.source`,
      [ORG_A, 'call-mounted-voice-1']
    );
    expect(stored.rows).toEqual([{ source: 'voice', count: 1 }]);
    expect(leadStore.addLead).not.toHaveBeenCalled();
    expect(sheets.appendLead).not.toHaveBeenCalled();
  });

  test('both tenant call routes create the pinned canonical session before the provider boundary and ignore caller authority', async () => {
    const pool = db.getPool();
    const observed = [];
    const provider = jest.spyOn(retell, 'createCall').mockImplementation(async (phoneNumber, agentId, options) => {
      const pending = await pool.query(
        `SELECT organization_id, business_profile_id, business_profile_version,
                business_profile_hash, status, metadata
           FROM canonical_voice_sessions
          WHERE to_number = $1 AND external_session_id LIKE 'pending-%'`,
        [phoneNumber]
      );
      expect(pending.rows).toHaveLength(1);
      observed.push({
        phoneNumber,
        agentId,
        options,
        pending: pending.rows[0],
        variables: retell.mapExecutiveContextToVariables(options.executiveContext),
      });
      return { call_id: 'provider-' + observed.length, call_status: 'registered' };
    });
    try {
      for (const route of ['/api/v1/voice/call', '/api/retell/create-call']) {
        const response = await request(app)
          .post(route)
          .set(auth(USERS.member))
          .send({
            phoneNumber: '+1555555300' + (observed.length + 1),
            service: 'Fence',
            caller: 'Scenario Customer',
            organizationId: ORG_B,
            businessName: 'Caller Controlled Company',
            profile: { company: { name: 'Caller Controlled Company' } },
            pricing: { minimumJobPrice: 1 },
          });
        expect(response.status).toBe(200);
        expect(response.body.session.organizationId).toBe(ORG_A);
        expect(response.body.profile).toEqual({
          id: profileAuthorityA.id,
          version: profileAuthorityA.versionLabel,
          hash: profileAuthorityA.profileHash,
        });
      }
      expect(observed).toHaveLength(2);
      for (const call of observed) {
        expect(call.agentId).toBe('agent-mounted-a');
        expect(call.pending.organization_id).toBe(ORG_A);
        expect(call.pending.business_profile_id).toBe(profileAuthorityA.id);
        expect(call.pending.business_profile_version).toBe(profileAuthorityA.versionLabel);
        expect(call.pending.business_profile_hash).toBe(profileAuthorityA.profileHash);
        expect(call.options.executiveContext.businessProfile.company.name).toBe('Mounted Test Company');
        expect(call.options.executiveContext.businessProfile.company.name).not.toBe('Caller Controlled Company');
        expect(call.variables).toMatchObject({
          minimum_job_price: 'not_configured',
          emergency_markup: '1.5',
          travel_charge: '0.58',
          tax_rate: '0',
        });
        expect(call.variables.pricing_rules).toContain('tax_rate=0 (configured)');
        expect(call.variables.pricing_rules).not.toMatch(/tax_rate=7|minimum_job_price=150/);
      }
    } finally {
      provider.mockRestore();
    }
  });

  test('tenant call RBAC fails closed and provider failure leaves a durable failed session', async () => {
    const pool = db.getPool();
    const failure = Object.assign(new Error('intercepted provider failure'), {
      code: 'RETELL_INTERCEPTED_FAILURE',
      status: 502,
    });
    const provider = jest.spyOn(retell, 'createCall').mockRejectedValue(failure);
    try {
      const viewer = await request(app)
        .post('/api/retell/create-call')
        .set(auth(USERS.viewer))
        .send({ phoneNumber: '+15555553101' });
      expect(viewer.status).toBe(403);
      expect(provider).not.toHaveBeenCalled();

      const failed = await request(app)
        .post('/api/retell/create-call')
        .set(auth(USERS.owner))
        .send({ phoneNumber: '+15555553102' });
      expect(failed.status).toBe(502);
      expect(failed.body.error.code).toBe('RETELL_INTERCEPTED_FAILURE');
      const durable = await pool.query(
        `SELECT status, completed_at, metadata
           FROM canonical_voice_sessions
          WHERE organization_id = $1 AND to_number = $2`,
        [ORG_A, '+15555553102']
      );
      expect(durable.rows).toHaveLength(1);
      expect(durable.rows[0].status).toBe('failed');
      expect(durable.rows[0].completed_at).not.toBeNull();
      expect(durable.rows[0].metadata.source).toBe('api-retell-create-call');
    } finally {
      provider.mockRestore();
    }
  });

  test('public demo is safely unavailable unless server-owned persisted demo authority is provisioned', async () => {
    delete process.env.NORTHSTAR_DEMO_ORGANIZATION_ID;
    const provider = jest.spyOn(retell, 'createCall');
    try {
      const unavailable = await request(app)
        .post('/api/demo/call')
        .send({ businessName: 'Caller Business', industry: 'General Contracting', phoneNumber: '+15555553201' });
      expect(unavailable.status).toBe(503);
      expect(unavailable.body.error).toEqual({ code: 'demo_unavailable', message: 'The public demo is unavailable.' });
      expect(provider).not.toHaveBeenCalled();
    } finally {
      provider.mockRestore();
    }
  });

  test('provisioned public demo uses only the isolated server-owned organization, profile, integration, and PostgreSQL session', async () => {
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO canonical_demo_authority (organization_id, status)
       VALUES ($1, 'active') ON CONFLICT (organization_id) DO UPDATE SET status = 'active'`,
      [ORG_B]
    );
    process.env.NORTHSTAR_DEMO_ORGANIZATION_ID = ORG_B;
    let providerContext;
    const provider = jest.spyOn(retell, 'createCall').mockImplementation(async (_phone, agentId, options) => {
      providerContext = { agentId, options };
      const pending = await pool.query(
        `SELECT organization_id, business_profile_id FROM canonical_voice_sessions
          WHERE organization_id = $1 AND external_session_id LIKE 'pending-%'`,
        [ORG_B]
      );
      expect(pending.rows).toHaveLength(1);
      expect(pending.rows[0].business_profile_id).toBe(profileAuthorityB.id);
      return { call_id: 'provider-demo-isolated', call_status: 'registered' };
    });
    try {
      const response = await request(app)
        .post('/api/demo/call')
        .send({
          businessName: 'Mounted Test Company',
          organizationId: ORG_A,
          profile: profile,
          pricing: { taxRate: 99 },
          industry: 'General Contracting',
          contactName: 'Bounded Scenario',
          phoneNumber: '+15555553202',
        });
      expect(response.status).toBe(200);
      expect(response.body.callId).toBe('provider-demo-isolated');
      expect(response.body.profile.id).toBe(profileAuthorityB.id);
      expect(providerContext.agentId).toBe('agent-mounted-b');
      expect(providerContext.options.executiveContext.businessProfile.company.name).toBe('Other Company');
      expect(require('../../src/routes/demo').demoSessions.has('provider-demo-isolated')).toBe(false);
      const persisted = await pool.query(
        `SELECT organization_id, business_profile_id, external_session_id
           FROM canonical_voice_sessions WHERE external_session_id = $1`,
        ['provider-demo-isolated']
      );
      expect(persisted.rows).toEqual([{
        organization_id: ORG_B,
        business_profile_id: profileAuthorityB.id,
        external_session_id: 'provider-demo-isolated',
      }]);
    } finally {
      provider.mockRestore();
    }
  });

  test('voice sessions enforce the persisted role matrix, tenant boundary, and live-runtime boundary', async () => {
    const pool = db.getPool();
    async function createVoiceSession(organizationId, integration, profileRecord, externalSessionId, runtimeOwned) {
      return voiceSessions.createSession(pool, {
        organizationId,
        externalSessionId,
        provider: 'retell',
        integrationOwnershipId: integration.id,
        profileId: profileRecord.id,
        profileVersion: profileRecord.versionLabel,
        profileHash: profileRecord.profileHash,
        direction: 'inbound',
        runtimeOwned,
      });
    }

    const sharedA = await createVoiceSession(ORG_A, integrationAuthorityA, profileAuthorityA, 'mounted-shared-voice', false);
    const sharedB = await createVoiceSession(ORG_B, integrationAuthorityB, profileAuthorityB, 'mounted-shared-voice', false);
    await createVoiceSession(ORG_A, integrationAuthorityA, profileAuthorityA, 'mounted-only-a', false);
    await createVoiceSession(ORG_A, integrationAuthorityA, profileAuthorityA, 'mounted-runtime', true);
    await createVoiceSession(ORG_A, integrationAuthorityA, profileAuthorityA, 'mounted-runtime-missing', true);

    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      const list = await request(app).get('/api/v1/voice/sessions?all=true').set(auth(USERS[role]));
      expect(list.status).toBe(200);
      expect(list.body.sessions.every(session => session.organizationId === ORG_A)).toBe(true);
      const detail = await request(app).get('/api/v1/voice/sessions/mounted-shared-voice').set(auth(USERS[role]));
      expect(detail.status).toBe(200);
      expect(detail.body.session.id).toBe(sharedA.id);
      expect(detail.body.session.profile.id).toBe(profileAuthorityA.id);
    }

    const otherShared = await request(app).get('/api/v1/voice/sessions/mounted-shared-voice').set(auth(USERS.other));
    expect(otherShared.status).toBe(200);
    expect(otherShared.body.session.id).toBe(sharedB.id);
    expect(otherShared.body.session.profile.id).toBe(profileAuthorityB.id);
    const crossTenantMissing = await request(app).get('/api/v1/voice/sessions/mounted-only-a').set(auth(USERS.other));
    expect(crossTenantMissing.status).toBe(404);
    expect(crossTenantMissing.body.error.code).toBe('VOICE_SESSION_NOT_FOUND');

    const deniedEventCount = (await pool.query(
      `SELECT count(*)::int AS count FROM canonical_voice_session_events e
        JOIN canonical_voice_sessions s ON s.id = e.voice_session_id AND s.organization_id = e.organization_id
       WHERE s.organization_id = $1 AND s.external_session_id = 'mounted-runtime'`,
      [ORG_A]
    )).rows[0].count;
    for (const role of ['member', 'viewer']) {
      const denied = await request(app)
        .post('/api/v1/voice/sessions/mounted-runtime/handoff')
        .set(auth(USERS[role]))
        .set('Idempotency-Key', 'denied-runtime-' + role)
        .send({ reason: role + ' request' });
      expect(denied.status).toBe(403);
      expect(denied.body.required).toEqual({ resource: 'calls', action: 'update' });
    }
    expect((await pool.query(
      `SELECT count(*)::int AS count FROM canonical_voice_session_events e
        JOIN canonical_voice_sessions s ON s.id = e.voice_session_id AND s.organization_id = e.organization_id
       WHERE s.organization_id = $1 AND s.external_session_id = 'mounted-runtime'`,
      [ORG_A]
    )).rows[0].count).toBe(deniedEventCount);

    const actions = [];
    voiceSessions.registerRuntimeHandle(ORG_A, 'mounted-runtime', {
      async handoff(reason) { actions.push(['handoff', reason]); },
      async cancel(reason) { actions.push(['cancel', reason]); },
    });
    const ownerHandoff = await request(app)
      .post('/api/v1/voice/sessions/mounted-runtime/handoff')
      .set(auth(USERS.owner))
      .set('Idempotency-Key', 'owner-runtime-handoff')
      .send({ reason: 'owner request' });
    expect(ownerHandoff.status).toBe(200);
    expect(ownerHandoff.body.session.status).toBe('escalating');
    const adminCancel = await request(app)
      .post('/api/v1/voice/sessions/mounted-runtime/cancel')
      .set(auth(USERS.admin))
      .set('Idempotency-Key', 'admin-runtime-cancel')
      .send({ reason: 'admin request' });
    expect(adminCancel.status).toBe(200);
    expect(adminCancel.body.session.status).toBe('cancelled');
    expect(actions).toEqual([['handoff', 'owner request'], ['cancel', 'admin request']]);

    const unavailable = await request(app)
      .post('/api/v1/voice/sessions/mounted-runtime-missing/cancel')
      .set(auth(USERS.owner))
      .set('Idempotency-Key', 'missing-runtime-cancel')
      .send({ reason: 'no process handle' });
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('VOICE_RUNTIME_UNAVAILABLE');
  });

  test('read then committed write then immediate read observes the new graph', async () => {
    const before = await request(app).get('/api/leads').set(auth(USERS.owner));
    expect(before.status).toBe(200);
    const created = await request(app)
      .post('/api/leads')
      .set(auth(USERS.owner))
      .set('Idempotency-Key', 'cache-visible-write')
      .send({ customerName: 'Cache Visible', email: 'cache-visible@example.test', service: 'general' });
    expect(created.status).toBe(201);
    const after = await request(app).get('/api/leads').set(auth(USERS.owner));
    expect(after.status).toBe(200);
    expect(after.body.items.some(item => item.id === created.body.ids.opportunity)).toBe(true);
    expect(after.body.items.length).toBe(before.body.items.length + 1);
  });

  test('/api/leads reads and exports canonical projections and PostgreSQL outage returns retryable 503', async () => {
    const list = await request(app).get('/api/leads').set(auth(USERS.owner));
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.every(item => item.canonical && item.canonical.snapshotDigest)).toBe(true);
    const csv = await request(app).get('/api/leads/export').set(auth(USERS.owner));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('customerId');

    const pool = db.getPool();
    const originalQuery = pool.query.bind(pool);
    pool.query = async function (statement, values) {
      if (/canonical_/i.test(String(statement))) throw new Error('connection unavailable');
      return originalQuery(statement, values);
    };
    const unavailable = await request(app).get('/api/leads').set(auth(USERS.owner));
    pool.query = originalQuery;
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('CANONICAL_PERSISTENCE_UNAVAILABLE');
  });

  test('retired Polaris authority is exact while the voice route remains reachable', async () => {
    const publicStatus = await request(app).get('/api/v1/polaris/status');
    expect(publicStatus.status).toBe(410);
    expect(publicStatus.body.error.code).toBe('LEGACY_AUTHORITY_RETIRED');
    const chat = await request(app).post('/api/v1/polaris/chat').set(auth(USERS.owner)).send({ message: 'status' });
    expect(chat.status).toBe(410);
    expect(chat.body.error.code).toBe('LEGACY_AUTHORITY_RETIRED');
    const voice = await request(app).get('/api/v1/voice/status').set(auth(USERS.owner));
    expect(voice.status).toBe(200);
  });

  test('retired method ownership performs one membership lookup and never touches repository data', async () => {
    const originalQuery = db.query;
    const originalRead = fs.readFileSync;
    const originalWrite = fs.writeFileSync;
    const originalAppend = fs.appendFileSync;
    const isolatedRoot = path.resolve(process.env.NORTHSTAR_DATA_DIR) + path.sep;
    let membershipLookups = 0;
    db.query = async function (statement, values) {
      if (/FROM users/i.test(String(statement))) membershipLookups += 1;
      return originalQuery(statement, values);
    };
    function rejectRepositoryAccess(target) {
      if (path.resolve(String(target)).startsWith(isolatedRoot)) throw new Error('retired route accessed repository data');
    }
    fs.readFileSync = function (target, ...args) { rejectRepositoryAccess(target); return originalRead.call(fs, target, ...args); };
    fs.writeFileSync = function (target, ...args) { rejectRepositoryAccess(target); return originalWrite.call(fs, target, ...args); };
    fs.appendFileSync = function (target, ...args) { rejectRepositoryAccess(target); return originalAppend.call(fs, target, ...args); };
    try {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const before = membershipLookups;
        const response = await request(app)[method]('/api/v1/assets/historical-id').set(auth(USERS.owner)).send({ ignored: true });
        expect(response.status).toBe(410);
        expect(response.body.error.code).toBe('LEGACY_AUTHORITY_RETIRED');
        expect(membershipLookups - before).toBe(1);
      }
      const beforeOptions = membershipLookups;
      const options = await request(app).options('/api/v1/assets/historical-id');
      expect(options.status).toBe(204);
      expect(membershipLookups).toBe(beforeOptions);
    } finally {
      db.query = originalQuery;
      fs.readFileSync = originalRead;
      fs.writeFileSync = originalWrite;
      fs.appendFileSync = originalAppend;
    }
  });

  test('Business Profile authority is organization-scoped, RBAC protected, and graph provenance references the exact version', async () => {
    const profileA = await request(app).get('/api/v1/business-profile').set(auth(USERS.owner));
    const profileB = await request(app).get('/api/v1/business-profile').set(auth(USERS.other));
    expect(profileA.status).toBe(200);
    expect(profileB.status).toBe(200);
    expect(profileA.body.data.company.name).toBe('Mounted Test Company');
    expect(profileB.body.data.company.name).toBe('Other Company');
    expect(profileA.body.data.canonicalAuthority.id).not.toBe(profileB.body.data.canonicalAuthority.id);
    const viewerWrite = await request(app).put('/api/v1/business-profile').set(auth(USERS.viewer)).send(profile);
    expect(viewerWrite.status).toBe(403);

    const provenance = await db.getPool().query(
      `SELECT ps.business_profile_id, ps.business_profile_version, ps.business_profile_hash,
              bp.organization_id, bp.version_label, bp.normalized_profile_hash
         FROM canonical_polaris_snapshots ps
         JOIN canonical_business_profiles bp
           ON bp.organization_id = ps.organization_id AND bp.id = ps.business_profile_id
        WHERE ps.organization_id = $1
        ORDER BY ps.created_at DESC LIMIT 1`,
      [ORG_A]
    );
    expect(provenance.rows).toHaveLength(1);
    expect(provenance.rows[0]).toMatchObject({
      organization_id: ORG_A,
      business_profile_version: provenance.rows[0].version_label,
      business_profile_hash: provenance.rows[0].normalized_profile_hash,
    });
  });
});
