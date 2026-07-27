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
  let leadStore;
  let sheets;
  let originalDatabaseUrl;
  let originalOpenAiKey;
  let originalRetellKey;
  let originalRetellWebhookSecret;
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
    await putBusinessProfile(pool, { organizationId: ORG_A, userId: USERS.owner, profile });
    await putBusinessProfile(pool, { organizationId: ORG_B, userId: USERS.other, profile: { ...profile, company: { name: 'Other Company', currency: 'USD' } } });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_A,
      userId: USERS.owner,
      provider: 'retell',
      externalIntegrationId: 'agent-mounted-a',
      metadata: { source: 'mounted-test' },
    });
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
    await require('../../src/cache/client').invalidateOrg(ORG_A);
    const unavailable = await request(app).get('/api/leads').set(auth(USERS.owner));
    pool.query = originalQuery;
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.code).toBe('CANONICAL_PERSISTENCE_UNAVAILABLE');
  });

  test('compatibility fallthrough leaves downstream Polaris and voice routes reachable without repeated auth', async () => {
    const publicStatus = await request(app).get('/api/v1/polaris/status');
    expect(publicStatus.status).toBe(200);
    expect(publicStatus.body.engine).toBe('Polaris Intelligence Engine');
    const chat = await request(app).post('/api/v1/polaris/chat').set(auth(USERS.owner)).send({ message: 'status' });
    expect(chat.status).toBe(500);
    expect(chat.body.error.code).toBe('CONFIGURATION_ERROR');
    const voice = await request(app).get('/api/v1/voice/status').set(auth(USERS.owner));
    expect(voice.status).toBe(200);
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
