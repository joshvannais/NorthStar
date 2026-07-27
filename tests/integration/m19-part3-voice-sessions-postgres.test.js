'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { bindIntegrationOwner, putBusinessProfile } = require('../../src/services/organizationAuthority');
const voice = require('../../src/services/voiceSessionAuthority');
const { ingestRetellPayload } = require('../../src/services/canonicalRetellIngestion');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const migrationDir = path.resolve(__dirname, '../../migrations');
const ORG_A = '31000000-0000-0000-0000-000000000001';
const ORG_B = '31000000-0000-0000-0000-000000000002';
const USER_A = '32000000-0000-0000-0000-000000000001';
const USER_B = '32000000-0000-0000-0000-000000000002';

const PROFILE = {
  company: { name: 'Voice Authority', currency: 'USD' },
  crew: { defaultCrewSize: 2, averageHourlyRate: 40, overtimeMultiplier: 1.5 },
  services: [],
};

realPostgres('canonical PostgreSQL voice session authority', () => {
  let database;
  let pool;
  let profileA;
  let profileB;
  let integrationA;
  let integrationB;

  beforeAll(async () => {
    database = await createSuiteDatabase('voice-authority');
    pool = new Pool({ connectionString: database.connectionString });
    for (const filename of fs.readdirSync(migrationDir).filter(name => /^\d+_.*\.sql$/.test(name)).sort()) {
      await pool.query(fs.readFileSync(path.join(migrationDir, filename), 'utf8'));
    }
    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1, 'Voice A', 'voice-a@m19.test'), ($2, 'Voice B', 'voice-b@m19.test')`,
      [ORG_A, ORG_B]
    );
    await pool.query(
      `INSERT INTO users (id, organization_id, name, email, password_hash, role, status) VALUES
        ($1,$2,'Voice A','voice-user-a@m19.test','unused','owner','active'),
        ($3,$4,'Voice B','voice-user-b@m19.test','unused','owner','active')`,
      [USER_A, ORG_A, USER_B, ORG_B]
    );
    profileA = await putBusinessProfile(pool, { organizationId: ORG_A, userId: USER_A, profile: PROFILE });
    profileB = await putBusinessProfile(pool, { organizationId: ORG_B, userId: USER_B, profile: { ...PROFILE, company: { name: 'Voice B', currency: 'USD' } } });
    integrationA = await bindIntegrationOwner(pool, { organizationId: ORG_A, userId: USER_A, provider: 'retell', externalIntegrationId: 'voice-agent-a' });
    integrationB = await bindIntegrationOwner(pool, { organizationId: ORG_B, userId: USER_B, provider: 'retell', externalIntegrationId: 'voice-agent-b' });
  }, 60000);

  afterEach(() => voice.clearRuntimeHandlesForTests());

  afterAll(async () => {
    if (pool) await pool.end();
    if (database) await database.cleanup();
  });

  function create(organizationId, integration, profile, externalSessionId, runtimeOwned) {
    return voice.createSession(pool, {
      organizationId,
      externalSessionId,
      provider: 'retell',
      integrationOwnershipId: integration.id,
      profileId: profile.id,
      profileVersion: profile.versionLabel,
      profileHash: profile.profileHash,
      direction: 'inbound',
      runtimeOwned,
    });
  }

  test('identical provider IDs remain isolated by organization and cross-tenant reads disclose nothing', async () => {
    await create(ORG_A, integrationA, profileA, 'shared-call-id', false);
    await create(ORG_B, integrationB, profileB, 'shared-call-id', false);
    await create(ORG_A, integrationA, profileA, 'only-in-a', false);
    expect((await voice.listSessions(pool, ORG_A, true).then(items => items.map(item => item.organizationId)))).toEqual([ORG_A, ORG_A]);
    expect((await voice.listSessions(pool, ORG_B, true)).map(item => item.organizationId)).toEqual([ORG_B]);
    await expect(voice.getSession(pool, ORG_A, 'missing-call')).rejects.toMatchObject({ status: 404, code: 'VOICE_SESSION_NOT_FOUND' });
    await expect(voice.getSession(pool, ORG_B, 'only-in-a')).rejects.toMatchObject({ status: 404, code: 'VOICE_SESSION_NOT_FOUND' });
  });

  test('timeline replay is durable and provider event identity is idempotent', async () => {
    await create(ORG_A, integrationA, profileA, 'timeline-call', false);
    const first = await voice.appendEvent(pool, {
      organizationId: ORG_A,
      externalSessionId: 'timeline-call',
      externalEventId: 'provider-event-1',
      eventType: 'transcript',
      payload: { segments: [{ speaker: 'customer', text: 'Need service' }] },
    });
    const replay = await voice.appendEvent(pool, {
      organizationId: ORG_A,
      externalSessionId: 'timeline-call',
      externalEventId: 'provider-event-1',
      eventType: 'transcript',
      payload: { segments: [{ speaker: 'customer', text: 'different replay' }] },
    });
    expect(first.inserted).toBe(true);
    expect(replay.inserted).toBe(false);
    expect(await voice.timeline(pool, ORG_A, 'timeline-call')).toHaveLength(1);
  });

  test('handoff and cancel require this process live handle while persisted reads survive restart', async () => {
    await create(ORG_A, integrationA, profileA, 'runtime-call', true);
    const actions = [];
    voice.registerRuntimeHandle(ORG_A, 'runtime-call', {
      async handoff(reason) { actions.push(['handoff', reason]); },
      async cancel(reason) { actions.push(['cancel', reason]); },
    });
    const handoff = await voice.performRuntimeAction(pool, {
      organizationId: ORG_A, externalSessionId: 'runtime-call', action: 'handoff', reason: 'operator', userId: USER_A,
    });
    expect(handoff.session.status).toBe('escalating');
    expect(actions).toEqual([['handoff', 'operator']]);

    await create(ORG_A, integrationA, profileA, 'cancel-call', true);
    voice.registerRuntimeHandle(ORG_A, 'cancel-call', {
      async cancel(reason) { actions.push(['cancel', reason]); },
    });
    const cancelled = await voice.performRuntimeAction(pool, {
      organizationId: ORG_A, externalSessionId: 'cancel-call', action: 'cancel', reason: 'owner request', userId: USER_A,
    });
    expect(cancelled.session.status).toBe('cancelled');
    expect(actions).toContainEqual(['cancel', 'owner request']);

    voice.clearRuntimeHandlesForTests();
    expect((await voice.getSession(pool, ORG_A, 'runtime-call')).status).toBe('escalating');
    await expect(voice.performRuntimeAction(pool, {
      organizationId: ORG_A, externalSessionId: 'runtime-call', action: 'cancel', userId: USER_A,
    })).rejects.toMatchObject({ status: 503, code: 'VOICE_RUNTIME_UNAVAILABLE' });
  });

  test('completion and replay use the profile pinned when the session was created', async () => {
    const pinned = await create(ORG_A, integrationA, profileA, 'pinned-call', false);
    const newer = await putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: USER_A,
      profile: { ...PROFILE, company: { name: 'Newer Voice Profile', currency: 'USD' } },
    });
    expect(newer.id).not.toBe(pinned.profile.id);
    const payload = {
      event: 'call_ended',
      event_id: 'pinned-event-1',
      call: {
        call_id: 'pinned-call',
        agent_id: 'voice-agent-a',
        from_number: '+15555550199',
        transcript_object: [{ role: 'user', words: 'I need general service.' }],
        call_analysis: { customer_name: 'Pinned Customer', service_requested: 'general' },
      },
    };
    const completed = await ingestRetellPayload(payload, { pool, ingestionSource: 'voice' });
    expect(completed.status).toBe(201);
    expect(completed.body.businessProfile).toEqual(pinned.profile);
    const replayed = await ingestRetellPayload({ ...payload, event_id: 'pinned-event-2' }, { pool, ingestionSource: 'voice' });
    expect(replayed.status).toBe(201);
    expect(replayed.replayed).toBe(true);
    expect(replayed.body.businessProfile).toEqual(pinned.profile);
    const session = await voice.getSession(pool, ORG_A, 'pinned-call');
    expect(session.status).toBe('completed');
    expect(session.profile).toEqual(pinned.profile);
  });
});
