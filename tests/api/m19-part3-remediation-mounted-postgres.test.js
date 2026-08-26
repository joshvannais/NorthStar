'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');
const { provisionDurableSession } = require('../helpers/account-session-fixture');

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
const MOUNTED_WEBHOOK_SECRET = 'm19-mounted-local-webhook-secret';
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

const profile = canonicalFenceProfile({
  companyName: 'Mounted Test Company',
  materialRates: { cedar: 123, pine: 71, vinyl: 137, 'chain-link': 149 },
  gateRates: { walk: 777, drive: 4321 },
});
Object.assign(profile.company, {
  industry: 'fencing',
  ownerName: 'Mounted Owner',
  description: 'Persisted mounted canonical profile.',
  website: 'https://mounted.example.test',
  email: 'voice@mounted.example.test',
  phone: '+15555553090',
  timeZone: 'UTC',
});
profile.hours = { monday: { open: '08:00', close: '17:00' } };
profile.emergencyPolicy = 'Human confirmation is required for emergencies.';
profile.serviceArea = { counties: ['Mounted County'] };
profile.faq = ['Site review is required before quoting.'];
profile.policies = { warranty: 'Written agreement controls.' };
profile.companyValues = ['Accuracy', 'Safety'];
profile.customPrompt = 'Use only the persisted mounted profile.';
profile.retell = {
  assistantName: 'Mounted Assistant',
  voiceStyle: 'direct and calm',
  greetingTemplate: 'Thank you for calling Mounted Test Company.',
};
profile.financial = {
  desiredGrossMargin: 40,
  markup: 1.3,
  emergencyMarkup: 1.5,
  travelCharge: 0.58,
};
profile.scheduling = { maxJobsPerDay: 4, workDayLength: 8 };

const otherProfile = canonicalFenceProfile({
  companyName: 'Other Company',
  laborPerFoot: 7,
  materialRates: { cedar: 11, pine: 13, vinyl: 17, 'chain-link': 19 },
  permitCharge: 23,
  gateRates: { walk: 29, drive: 31 },
  removalPerFoot: 37,
});
otherProfile.company.timeZone = 'UTC';
otherProfile.financial = {
  desiredGrossMargin: 33,
  markup: 1.1,
  emergencyMarkup: 1.2,
  travelCharge: 0.25,
};

realPostgres('Mission 19 Part 3 corrected real server mount', () => {
  let suiteDatabase;
  let db;
  let app;
  let authHeaders;
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

  function auth(userId) {
    return authHeaders.get(userId) || {};
  }

  function postSignedWebhook(route, payload) {
    const raw = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const digest = crypto.createHmac('sha256', MOUNTED_WEBHOOK_SECRET)
      .update(raw)
      .update(timestamp, 'ascii')
      .digest('hex');
    return request(app)
      .post(route)
      .set('Content-Type', 'application/json')
      .set('X-Retell-Signature', `v=${timestamp},d=${digest}`)
      .send(raw);
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
    process.env.RETELL_API_KEY = MOUNTED_WEBHOOK_SECRET;
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
    profileAuthorityA = await putBusinessProfile(pool, {
      organizationId: ORG_A, userId: USERS.owner, expectedVersion: null, profile,
    });
    profileAuthorityB = await putBusinessProfile(pool, {
      organizationId: ORG_B,
      userId: USERS.other,
      expectedVersion: null,
      profile: otherProfile,
    });
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
    authHeaders = new Map();
    for (const [userId, organizationId, role, membershipStatus] of [
      [USERS.owner, ORG_A, 'owner', 'active'],
      [USERS.admin, ORG_A, 'admin', 'active'],
      [USERS.member, ORG_A, 'member', 'active'],
      [USERS.viewer, ORG_A, 'viewer', 'active'],
      [USERS.inactive, ORG_A, 'member', 'suspended'],
      [USERS.other, ORG_B, 'owner', 'active'],
    ]) {
      const session = await provisionDurableSession(pool, {
        userId, organizationId, role, membershipStatus,
      });
      authHeaders.set(userId, session.headers);
    }
    voiceSessions = require('../../src/services/voiceSessionAuthority');
    retell = require('../../src/retell/client');
    ({ app } = require('../../src/server'));
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
      [USERS.missing, 401],
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

  test('missing durable authority and repository outage fail closed through the mounted app with zero mutation', async () => {
    const pool = db.getPool();
    const before = (await pool.query('SELECT count(*)::int AS count FROM canonical_operations')).rows[0].count;
    const repository = require('../../src/accounts/repository').AccountRepository.prototype;
    const authority = jest.spyOn(repository, 'sessionAuthority').mockResolvedValueOnce(null);
    const missing = await request(app)
      .post('/api/leads').set(auth(USERS.owner)).set('Idempotency-Key', 'missing-authority')
      .send({ customerName: 'Missing', service: 'general' });
    authority.mockRejectedValueOnce(new Error('authorization database unavailable'));
    const unavailable = await request(app)
      .post('/api/leads').set(auth(USERS.owner)).set('Idempotency-Key', 'unavailable')
      .send({ customerName: 'Unavailable', service: 'general' });
    authority.mockRestore();
    expect(missing.status).toBe(401);
    expect(missing.body.code).toBe('session_inactive');
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.code).toBe('authorization_unavailable');
    expect((await pool.query('SELECT count(*)::int AS count FROM canonical_operations')).rows[0].count).toBe(before);
  });

  test('simulation and appointment mutations apply persisted RBAC and cross-organization IDs do not disclose', async () => {
    const memberSimulation = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth(USERS.member))
      .set('Idempotency-Key', 'mounted-simulation-member')
      .send({
        name: 'Simulation Member',
        service: 'fence',
        phone: '+15555551104',
        pricing: { laborPerFoot: 1, taxRatePercent: 99 },
        businessProfile: otherProfile,
      });
    expect(memberSimulation.status).toBe(201);
    expect(memberSimulation.body.polaris.customerFacingPrice).toBe(68597);
    expect(memberSimulation.body.polaris.businessProfileInputId).toBe(profileAuthorityA.id);
    expect(memberSimulation.body.polaris.businessProfileInputVersion).toBe(profileAuthorityA.versionLabel);
    expect(memberSimulation.body.polaris.businessProfileInputHash).toBe(profileAuthorityA.profileHash);
    expect(memberSimulation.body.polaris.pricingLineItems).toEqual([
      expect.objectContaining({ code: 'profile-profile-labor', customerCharge: 24750 }),
      expect.objectContaining({ code: 'profile-profile-material', customerCharge: 17750 }),
      expect.objectContaining({ code: 'profile-profile-permit', customerCharge: 9999 }),
      expect.objectContaining({ code: 'profile-profile-gates', customerCharge: 5098 }),
      expect.objectContaining({ code: 'profile-profile-removal', customerCharge: 11000 }),
    ]);
    expect(memberSimulation.body.summary.estimatedValue).toBe(memberSimulation.body.polaris.customerFacingPrice);
    const simulatedAgentText = memberSimulation.body.transcript
      .filter(turn => turn.speaker === 'ai')
      .map(turn => turn.text)
      .join('\n');
    expect(simulatedAgentText).toContain('provide the written estimate before any work begins');
    expect(simulatedAgentText).not.toMatch(/\$|price range|typically looking in the range/i);

    const otherSimulation = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth(USERS.other))
      .set('Idempotency-Key', 'mounted-simulation-other')
      .send({ name: 'Simulation Member', service: 'fence', phone: '+15555551104' });
    expect(otherSimulation.status).toBe(201);
    expect(otherSimulation.body.polaris.businessProfileInputId).toBe(profileAuthorityB.id);
    expect(otherSimulation.body.polaris.businessProfileInputHash).toBe(profileAuthorityB.profileHash);
    const otherScope = otherSimulation.body.polaris.service.scope;
    const otherItems = Object.fromEntries(
      otherSimulation.body.polaris.pricingLineItems.map(item => [item.code, item.customerCharge])
    );
    expect(otherItems['profile-profile-labor']).toBe(otherScope.linearFeet * 7);
    expect(otherItems['profile-profile-material']).toBe(
      otherScope.linearFeet * { cedar: 11, pine: 13, vinyl: 17, 'chain-link': 19 }[otherScope.material]
    );
    expect(otherItems['profile-profile-permit']).toBe(otherScope.permitsRequired ? 23 : undefined);
    expect(otherItems['profile-profile-gates']).toBe(
      otherScope.gates.reduce((sum, gate) => sum + { walk: 29, drive: 31 }[gate.type], 0)
    );
    expect(otherItems['profile-profile-removal']).toBe(otherScope.removalRequired
      ? otherScope.linearFeet * 37
      : undefined);
    expect(otherSimulation.body.polaris.customerFacingPrice)
      .not.toBe(memberSimulation.body.polaris.customerFacingPrice);
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
    const assignment = (await db.getPool().query(
      `SELECT revision, canonical_digest FROM canonical_schedule_assignments
        WHERE organization_id = $1 AND appointment_id = $2`,
      [ORG_A, memberSimulation.body.ids.appointment]
    )).rows[0];
    const missingApproval = await request(app)
      .patch('/api/v1/canonical/appointments/' + memberSimulation.body.ids.appointment)
      .set(auth(USERS.owner))
      .set('X-NorthStar-Session-ID', memberSimulation.body.sessionId)
      .send({ status: 'scheduled' });
    expect(missingApproval.status).toBe(428);
    expect(missingApproval.body.error.code).toBe('M22_APPROVAL_REQUIRED');
    const memberPatch = await request(app)
      .patch('/api/v1/canonical/appointments/' + memberSimulation.body.ids.appointment)
      .set(auth(USERS.member))
      .set('X-NorthStar-Session-ID', memberSimulation.body.sessionId)
      .set('Idempotency-Key', 'm22-mounted-member-update-0001')
      .send({
        status: 'scheduled',
        expectedRevision: Number(assignment.revision),
        expectedDigest: assignment.canonical_digest.trim(),
        expectedTimeZone: 'UTC',
        action: 'calendar_edit',
        organizationId: ORG_B,
        actorUserId: USERS.owner,
        actorAccessRole: 'owner',
        authSessionId: USERS.owner,
      });
    expect(memberPatch.status).toBe(403);
    expect(memberPatch.body.error.code).toBe('M22_APPROVAL_FORBIDDEN');
    const ownerBody = {
      status: 'scheduled',
      expectedRevision: Number(assignment.revision),
      expectedDigest: assignment.canonical_digest.trim(),
      expectedTimeZone: 'UTC',
      action: 'calendar_edit',
    };
    const ownerPatch = await request(app)
      .patch('/api/v1/canonical/appointments/' + memberSimulation.body.ids.appointment)
      .set(auth(USERS.owner))
      .set('X-NorthStar-Session-ID', memberSimulation.body.sessionId)
      .set('Idempotency-Key', 'm22-mounted-appointment-update-0001')
      .send(ownerBody);
    expect(ownerPatch.status).toBe(200);
    expect(ownerPatch.body.data.scheduleAuthority).toMatchObject({
      revision: 2,
      targetState: 'unassigned',
      scheduleState: 'unscheduled',
      dispatchState: 'not_dispatched',
      needsReview: true,
      reviewReasons: ['conflict_evaluation_not_available'],
    });
    const replay = await request(app)
      .patch('/api/v1/canonical/appointments/' + memberSimulation.body.ids.appointment)
      .set(auth(USERS.owner))
      .set('X-NorthStar-Session-ID', memberSimulation.body.sessionId)
      .set('Idempotency-Key', 'm22-mounted-appointment-update-0001')
      .send(ownerBody);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(ownerPatch.body);
    const collision = await request(app)
      .patch('/api/v1/canonical/appointments/' + memberSimulation.body.ids.appointment)
      .set(auth(USERS.owner))
      .set('X-NorthStar-Session-ID', memberSimulation.body.sessionId)
      .set('Idempotency-Key', 'm22-mounted-appointment-update-0001')
      .send({ ...ownerBody, reason: 'Divergent replay.' });
    expect(collision.status).toBe(409);
    expect(collision.body.error.code).toBe('M22_IDEMPOTENCY_CONFLICT');
    const stale = await request(app)
      .patch('/api/v1/canonical/appointments/' + memberSimulation.body.ids.appointment)
      .set(auth(USERS.owner))
      .set('X-NorthStar-Session-ID', memberSimulation.body.sessionId)
      .set('Idempotency-Key', 'm22-mounted-stale-update-0001')
      .send(ownerBody);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('M22_STALE_APPROVAL');
    await db.getPool().query(
      `UPDATE workforce_profiles profile
          SET operational_role = 'dispatcher', updated_at = NOW()
         FROM organization_memberships membership
        WHERE profile.organization_id = membership.organization_id
          AND profile.membership_id = membership.id
          AND membership.organization_id = $1
          AND membership.user_id = $2`,
      [ORG_A, USERS.member]
    );
    const dispatcherAuthority = (await db.getPool().query(
      `SELECT revision, canonical_digest FROM canonical_schedule_assignments
        WHERE organization_id = $1 AND appointment_id = $2`,
      [ORG_A, memberSimulation.body.ids.appointment]
    )).rows[0];
    const dispatcherBody = {
      scheduledStart: '2027-05-01T13:00:00Z',
      scheduledEnd: '2027-05-01T14:00:00Z',
      status: 'scheduled',
      expectedRevision: Number(dispatcherAuthority.revision),
      expectedDigest: dispatcherAuthority.canonical_digest.trim(),
      expectedTimeZone: 'UTC',
      action: 'calendar_edit',
      reason: 'Active dispatcher approved this exact schedule.',
    };
    const dispatcherPatch = await request(app)
      .patch('/api/v1/canonical/appointments/' + memberSimulation.body.ids.appointment)
      .set(auth(USERS.member))
      .set('X-NorthStar-Session-ID', memberSimulation.body.sessionId)
      .set('Idempotency-Key', 'm22-mounted-dispatcher-update-0001')
      .send(dispatcherBody);
    expect(dispatcherPatch.status).toBe(200);
    expect(dispatcherPatch.body.data.scheduleAuthority).toMatchObject({ revision: 3, scheduleState: 'scheduled' });
    await db.getPool().query(
      `UPDATE workforce_profiles profile
          SET operational_role = 'employee', updated_at = NOW()
         FROM organization_memberships membership
        WHERE profile.organization_id = membership.organization_id
          AND profile.membership_id = membership.id
          AND membership.organization_id = $1
          AND membership.user_id = $2`,
      [ORG_A, USERS.member]
    );
    const downgradedReplay = await request(app)
      .patch('/api/v1/canonical/appointments/' + memberSimulation.body.ids.appointment)
      .set(auth(USERS.member))
      .set('X-NorthStar-Session-ID', memberSimulation.body.sessionId)
      .set('Idempotency-Key', 'm22-mounted-dispatcher-update-0001')
      .send(dispatcherBody);
    expect(downgradedReplay.status).toBe(403);
    expect(downgradedReplay.body.error.code).toBe('M22_APPROVAL_FORBIDDEN');
    const evidence = await db.getPool().query(
      `SELECT
         (SELECT count(*)::int FROM canonical_schedule_approvals approval
           WHERE approval.organization_id = assignment.organization_id
             AND approval.assignment_id = assignment.id) AS approvals,
         (SELECT count(*)::int FROM canonical_schedule_audit_events audit
           WHERE audit.organization_id = assignment.organization_id
             AND audit.assignment_id = assignment.id) AS audits,
         (SELECT count(*)::int FROM canonical_schedule_idempotency replay
           WHERE replay.organization_id = assignment.organization_id
             AND replay.assignment_id = assignment.id) AS idempotency
       FROM canonical_schedule_assignments assignment
      WHERE assignment.organization_id = $1 AND assignment.appointment_id = $2`,
      [ORG_A, memberSimulation.body.ids.appointment]
    );
    expect(evidence.rows).toEqual([{ approvals: 2, audits: 2, idempotency: 2 }]);
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
    const first = await postSignedWebhook('/api/retell/webhook', event);
    expect(first.status).toBe(201);
    const replayPayload = {
      ...event, event: 'call_analyzed', event_id: 'evt-mounted-retell-2', call: { ...event.call, transcript_object: undefined },
    };
    const replay = await postSignedWebhook('/api/retell/webhook', replayPayload);
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
    const unknown = await postSignedWebhook('/api/retell/webhook', {
      ...event, call: { ...event.call, call_id: 'unknown-call', agent_id: 'unknown-agent' },
    });
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
    const response = await postSignedWebhook('/api/v1/voice/webhook', payload);
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

  test('missing and unsupported simulation services fail before every durable or external side effect', async () => {
    const pool = db.getPool();
    const tables = ['canonical_operations', 'canonical_customers', 'canonical_opportunities',
      'canonical_estimates', 'canonical_polaris_snapshots'];
    async function counts() {
      const values = {};
      for (const table of tables) {
        values[table] = (await pool.query('SELECT count(*)::int AS count FROM ' + table)).rows[0].count;
      }
      return values;
    }
    const before = await counts();
    const bytesBefore = directoryDigest(process.env.NORTHSTAR_DATA_DIR);
    const provider = jest.spyOn(retell, 'createCall');
    try {
      for (const [service, code] of [
        [undefined, 'service_required'],
        ['', 'service_required'],
        ['   ', 'service_required'],
        ['definitely-unsupported-widget', 'unsupported_service'],
      ]) {
        const body = {
          name: 'Rejected Simulation',
          pricing: { customerFacingPrice: 77777 },
          businessProfile: { services: [{ id: 'definitely-unsupported-widget', price: 77777 }] },
        };
        if (service !== undefined) body.service = service;
        const response = await request(app)
          .post('/api/v1/simulations/leads')
          .set(auth(USERS.member))
          .set('Idempotency-Key', 'rejected-' + code + '-' + String(service))
          .send(body);
        expect(response.status).toBe(422);
        expect(response.body).toEqual({
          success: false,
          error: { code, message: code === 'service_required'
            ? 'A supported service is required.' : 'The requested service is not supported.' },
        });
        expect(JSON.stringify(response.body)).not.toContain('77777');
      }
      expect(await counts()).toEqual(before);
      expect(directoryDigest(process.env.NORTHSTAR_DATA_DIR)).toBe(bytesBefore);
      expect(provider).not.toHaveBeenCalled();

      const normalized = await request(app)
        .post('/api/v1/simulations/leads')
        .set(auth(USERS.member))
        .set('Idempotency-Key', 'case-normalized-fence')
        .send({ name: 'Case Normalized', service: '  FeNcE  ' });
      expect(normalized.status).toBe(201);
      expect(normalized.body.snapshot.service.key).toBe('fence');

      const absentFromProfile = await request(app)
        .post('/api/v1/simulations/leads')
        .set(auth(USERS.member))
        .set('Idempotency-Key', 'supported-profile-absent')
        .send({ name: 'Absent Profile Service', service: 'plumbing' });
      expect(absentFromProfile.status).toBe(201);
      expect(absentFromProfile.body.snapshot.service.key).toBe('plumbing');
      expect(absentFromProfile.body.snapshot.service.unpricedReason).toBe('service_not_configured');
      expect(absentFromProfile.body.snapshot.notCalculated).toContainEqual({
        field: 'customerFacingPrice', reason: 'service_not_configured',
      });
      expect(absentFromProfile.body.snapshot.customerFacingPrice).toBeNull();
    } finally {
      provider.mockRestore();
    }
  });

  test('both tenant call routes create the pinned canonical session before the provider boundary and ignore caller authority', async () => {
    const pool = db.getPool();
    const observed = [];
    const retellConfig = require('../../src/config');
    const originalKey = retellConfig.retell.apiKey;
    const originalPhone = retellConfig.retell.phoneNumber;
    const originalFetch = global.fetch;
    try {
      retellConfig.retell.apiKey = 'intercepted-mounted-key';
      retellConfig.retell.phoneNumber = '+15555553099';
      global.fetch = jest.fn(async (_url, options) => {
        const body = JSON.parse(options.body);
        const pending = await pool.query(
          `SELECT organization_id, business_profile_id, business_profile_version,
                  business_profile_hash, status, metadata
             FROM canonical_voice_sessions
            WHERE to_number = $1 AND external_session_id LIKE 'pending-%'`,
          [body.to_number]
        );
        expect(pending.rows).toHaveLength(1);
        observed.push({ body, pending: pending.rows[0] });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            call_id: 'provider-' + observed.length,
            call_status: 'registered',
          }),
        };
      });
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
        expect(Object.keys(call.body).sort()).toEqual([
          'agent_id', 'from_number', 'retell_llm_dynamic_variables', 'to_number',
        ]);
        expect(call.body.agent_id).toBe('agent-mounted-a');
        expect(call.body.from_number).toBe('+15555553099');
        expect(call.pending.organization_id).toBe(ORG_A);
        expect(call.pending.business_profile_id).toBe(profileAuthorityA.id);
        expect(call.pending.business_profile_version).toBe(profileAuthorityA.versionLabel);
        expect(call.pending.business_profile_hash).toBe(profileAuthorityA.profileHash);
        expect(Object.keys(call.body.retell_llm_dynamic_variables).sort()).toEqual(
          [...retell.PROMPT_VARIABLE_KEYS].sort()
        );
        expect(call.body.retell_llm_dynamic_variables).toMatchObject({
          assistant_name: 'Mounted Assistant',
          company_name: 'Mounted Test Company',
          business_email: 'voice@mounted.example.test',
          scheduling_rules: JSON.stringify({ maxJobsPerDay: 4, workDayLength: 8 }),
        });
        expect(call.body.retell_llm_dynamic_variables.pricing_rules).toContain('tax_rate=0 (configured)');
        expect(call.body.retell_llm_dynamic_variables.pricing_rules).not.toMatch(/tax_rate=7|minimum_job_price=150/);
        expect(JSON.stringify(call.body)).not.toMatch(
          /Caller Controlled|Scenario Customer|getFAQ|retell_llm_tools|mcp|webhook_url|callback|businessProfile\.json/
        );
      }
    } finally {
      global.fetch = originalFetch;
      retellConfig.retell.apiKey = originalKey;
      retellConfig.retell.phoneNumber = originalPhone;
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

  test('absent demo authority cannot reopen the retired public outbound endpoint', async () => {
    const pool = db.getPool();
    delete process.env.NORTHSTAR_DEMO_ORGANIZATION_ID;
    const provider = jest.spyOn(retell, 'createCall');
    const before = await pool.query(
      "SELECT count(*)::int AS count FROM canonical_voice_sessions WHERE external_session_id LIKE 'demo-%'"
    );
    try {
      const retired = await request(app)
        .post('/api/demo/call')
        .send({ businessName: 'Caller Business', industry: 'General Contracting', phoneNumber: '+15555553201' });
      expect(retired.status).toBe(410);
      expect(retired.body).toEqual({
        success: false,
        error: { code: 'demo_external_action_retired', message: 'Public demo outbound calls are unavailable.' },
      });
      expect(provider).not.toHaveBeenCalled();
      const after = await pool.query(
        "SELECT count(*)::int AS count FROM canonical_voice_sessions WHERE external_session_id LIKE 'demo-%'"
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);
    } finally {
      provider.mockRestore();
    }
  });

  test('persisted demo authority and caller-forged tenant/profile fields cannot reopen the retired endpoint', async () => {
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO canonical_demo_authority (organization_id, status)
       VALUES ($1, 'active') ON CONFLICT (organization_id) DO UPDATE SET status = 'active'`,
      [ORG_B]
    );
    process.env.NORTHSTAR_DEMO_ORGANIZATION_ID = ORG_B;
    const provider = jest.spyOn(retell, 'createCall');
    const before = await pool.query(
      "SELECT count(*)::int AS count FROM canonical_voice_sessions WHERE external_session_id LIKE 'demo-%'"
    );
    try {
      const retired = await request(app)
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
      expect(retired.status).toBe(410);
      expect(retired.body.error.code).toBe('demo_external_action_retired');
      expect(provider).not.toHaveBeenCalled();
      const after = await pool.query(
        "SELECT count(*)::int AS count FROM canonical_voice_sessions WHERE external_session_id LIKE 'demo-%'"
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);
    } finally {
      provider.mockRestore();
    }
  });

  test('provider failure configuration remains unreachable behind the retired public endpoint', async () => {
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO canonical_demo_authority (organization_id, status)
       VALUES ($1, 'active') ON CONFLICT (organization_id) DO UPDATE SET status = 'active'`,
      [ORG_B]
    );
    process.env.NORTHSTAR_DEMO_ORGANIZATION_ID = ORG_B;
    const failure = Object.assign(new Error('intercepted public demo provider failure'), {
      code: 'RETELL_INTERCEPTED_FAILURE', status: 502,
    });
    const provider = jest.spyOn(retell, 'createCall').mockRejectedValue(failure);
    const before = await pool.query(
      "SELECT count(*)::int AS count FROM canonical_voice_sessions WHERE external_session_id LIKE 'demo-%'"
    );
    try {
      const retired = await request(app).post('/api/demo/call').send({
        industry: 'fence', contactName: 'Provider Failure', phoneNumber: '+15555553203',
      });
      expect(retired.status).toBe(410);
      expect(retired.body.error.code).toBe('demo_external_action_retired');
      expect(provider).not.toHaveBeenCalled();
      const after = await pool.query(
        "SELECT count(*)::int AS count FROM canonical_voice_sessions WHERE external_session_id LIKE 'demo-%'"
      );
      expect(after.rows[0].count).toBe(before.rows[0].count);
    } finally {
      provider.mockRestore();
    }
  });

  test('unknown, foreign, and expired demo identifiers share one non-disclosing response', async () => {
    const pool = db.getPool();
    await pool.query(
      `INSERT INTO canonical_demo_authority (organization_id, status)
       VALUES ($1, 'active') ON CONFLICT (organization_id) DO UPDATE SET status = 'active'`,
      [ORG_B]
    );
    process.env.NORTHSTAR_DEMO_ORGANIZATION_ID = ORG_B;
    const foreignId = 'demo-10000000-0000-4000-8000-000000000001';
    const expiredId = 'demo-10000000-0000-4000-8000-000000000002';
    await voiceSessions.createSession(pool, {
      organizationId: ORG_A,
      externalSessionId: foreignId,
      provider: 'retell',
      integrationOwnershipId: integrationAuthorityA.id,
      profileId: profileAuthorityA.id,
      profileVersion: profileAuthorityA.versionLabel,
      profileHash: profileAuthorityA.profileHash,
      metadata: { source: 'public-demo' },
    });
    await voiceSessions.createSession(pool, {
      organizationId: ORG_B,
      externalSessionId: expiredId,
      provider: 'retell',
      integrationOwnershipId: integrationAuthorityB.id,
      profileId: profileAuthorityB.id,
      profileVersion: profileAuthorityB.versionLabel,
      profileHash: profileAuthorityB.profileHash,
      metadata: { source: 'public-demo' },
    });
    await pool.query(
      "UPDATE canonical_voice_sessions SET started_at = NOW() - INTERVAL '25 hours' WHERE organization_id = $1 AND external_session_id = $2",
      [ORG_B, expiredId]
    );
    for (const identifier of [
      'demo-10000000-0000-4000-8000-000000000099', foreignId, expiredId, 'not-a-demo-id',
    ]) {
      const response = await request(app).get('/api/demo/' + identifier + '/status');
      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        success: false,
        error: { code: 'demo_session_not_found', message: 'Demo session not found.' },
      });
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
    const fixture = await request(app)
      .post('/api/leads')
      .set(auth(USERS.owner))
      .set('Idempotency-Key', 'self-contained-canonical-read')
      .send({ customerName: 'Self Contained Read', email: 'self-contained-read@example.test', service: 'general' });
    expect(fixture.status).toBe(201);
    const list = await request(app).get('/api/leads').set(auth(USERS.owner));
    expect(list.status).toBe(200);
    expect(list.body.items.some(item => item.id === fixture.body.ids.opportunity)).toBe(true);
    expect(list.body.items.every(item => item.canonical && item.canonical.snapshotDigest)).toBe(true);
    const csv = await request(app).get('/api/leads/export').set(auth(USERS.owner));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('customerId');

    const pool = db.getPool();
    const originalQuery = pool.query.bind(pool);
    pool.query = async function (statement, values) {
      if (/canonical_/i.test(String(statement)) && !/FROM public\.auth_sessions/i.test(String(statement))) {
        throw new Error('connection unavailable');
      }
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
    const pool = db.getPool();
    const originalQuery = pool.query.bind(pool);
    const originalRead = fs.readFileSync;
    const originalWrite = fs.writeFileSync;
    const originalAppend = fs.appendFileSync;
    const isolatedRoot = path.resolve(process.env.NORTHSTAR_DATA_DIR) + path.sep;
    let membershipLookups = 0;
    pool.query = async function (statement, values) {
      if (/FROM public\.auth_sessions/i.test(String(statement))) membershipLookups += 1;
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
      pool.query = originalQuery;
      fs.readFileSync = originalRead;
      fs.writeFileSync = originalWrite;
      fs.appendFileSync = originalAppend;
    }
  });

  test('Business Profile authority is organization-scoped, RBAC protected, and graph provenance references the exact version', async () => {
    const graph = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth(USERS.owner))
      .set('Idempotency-Key', 'self-contained-profile-provenance')
      .send({ name: 'Self Contained Provenance', service: 'fence', phone: '+15555553991' });
    expect(graph.status).toBe(201);
    expect(graph.body.businessProfile).toEqual({
      id: profileAuthorityA.id,
      version: profileAuthorityA.versionLabel,
      hash: profileAuthorityA.profileHash,
    });
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
          AND ps.id = $2`,
      [ORG_A, graph.body.ids.polarisSnapshot]
    );
    expect(provenance.rows).toHaveLength(1);
    expect(provenance.rows[0]).toMatchObject({
      organization_id: ORG_A,
      business_profile_version: provenance.rows[0].version_label,
      business_profile_hash: provenance.rows[0].normalized_profile_hash,
    });
  });

  test('mounted live simulation retains its generated flow and returns the persisted post-call Polaris calculation', async () => {
    const liveRequest = {
      name: 'Avery Live Simulation',
      phone: '+15555550101',
      email: 'avery.live@example.test',
      service: 'fence',
      description: 'Existing live simulation request.',
      sessionId: 'm19-part3-live-session',
      estimatedValue: 999999,
      transcript: [{ speaker: 'customer', text: 'THIS INPUT MUST NOT REPLACE THE GENERATED TRANSCRIPT' }],
      facts: [{ variable: 'linearFeet', normalizedValue: 9999 }],
      scope: { linearFeet: 9999, material: 'not-a-generated-material' },
      travel: { source: 'not-a-live-input', minutes: 999, distanceMiles: 999 },
      callDurationSeconds: 999,
      externalTranscriptId: 'not-a-live-input',
    };
    const first = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth(USERS.owner))
      .set('Idempotency-Key', 'm19-part3-live-flow-001')
      .send(liveRequest);
    expect(first.status).toBe(201);
    expect(first.body.sessionId).toBe(liveRequest.sessionId);
    expect(first.body.snapshot.service.key).toBe('fence');
    expect(first.body.snapshot.service.scope).not.toEqual(liveRequest.scope);
    expect(first.body.snapshot.travel).toEqual({
      minutes: null,
      distanceMiles: null,
      source: null,
      customerCharge: null,
      knownInternalCost: null,
    });
    expect(first.body.snapshot.callDurationSeconds).toBeNull();
    expect(first.body.transcript).not.toContainEqual(liveRequest.transcript[0]);
    expect(first.body.transcript.map(turn => turn.text).join('\n')).not.toContain('THIS INPUT MUST NOT REPLACE');
    expect(first.body.summary.estimatedValue).toBe(first.body.snapshot.customerFacingPrice);
    expect(first.body.polaris.customerFacingPrice).toBe(first.body.snapshot.customerFacingPrice);
    expect(first.body.snapshot.customerFacingPrice).not.toBe(liveRequest.estimatedValue);

    const replay = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth(USERS.owner))
      .set('Idempotency-Key', 'm19-part3-live-flow-001')
      .send(liveRequest);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);

    const ignoredInputChange = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth(USERS.owner))
      .set('Idempotency-Key', 'm19-part3-live-flow-001')
      .send({ ...liveRequest, scope: { linearFeet: 1 }, callDurationSeconds: 1 });
    expect(ignoredInputChange.status).toBe(201);
    expect(ignoredInputChange.body).toEqual(first.body);

    const conflict = await request(app)
      .post('/api/v1/simulations/leads')
      .set(auth(USERS.owner))
      .set('Idempotency-Key', 'm19-part3-live-flow-001')
      .send({ ...liveRequest, name: 'Changed Accepted Live Name' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_FINGERPRINT_CONFLICT');

    const persisted = await db.getPool().query(
      `SELECT t.external_call_id, t.external_transcript_id, t.occurred_at,
               cm.external_communication_id, cm.duration_seconds,
               a.external_appointment_id,
               e.calculation_output, e.snapshot_digest AS estimate_digest,
               ps.snapshot, ps.snapshot_digest
          FROM canonical_transcripts t
          JOIN canonical_communications cm
            ON cm.organization_id = t.organization_id AND cm.operation_id = t.operation_id
          JOIN canonical_appointments a
            ON a.organization_id = t.organization_id AND a.operation_id = t.operation_id
          JOIN canonical_estimates e
            ON e.organization_id = t.organization_id AND e.operation_id = t.operation_id
          JOIN canonical_polaris_snapshots ps
            ON ps.organization_id = t.organization_id AND ps.operation_id = t.operation_id
         WHERE t.organization_id = $1 AND t.graph_id = $2`,
      [ORG_A, first.body.graphId]
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      external_call_id: liveRequest.sessionId + ':call',
      external_transcript_id: liveRequest.sessionId + ':transcript',
      external_communication_id: liveRequest.sessionId + ':communication',
      external_appointment_id: liveRequest.sessionId + ':appointment',
      duration_seconds: null,
    });
    expect(persisted.rows[0].snapshot).toEqual(first.body.snapshot);
    expect(persisted.rows[0].calculation_output).toEqual(first.body.snapshot);
    expect(persisted.rows[0].estimate_digest).toBe(first.body.snapshotDigest);
    expect(persisted.rows[0].snapshot_digest).toBe(first.body.snapshotDigest);
  });
});
