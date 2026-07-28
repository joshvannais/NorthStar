'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { Pool } = require('pg');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { bindIntegrationOwner, putBusinessProfile } = require('../../src/services/organizationAuthority');
const voice = require('../../src/services/voiceSessionAuthority');
const { ingestRetellPayload } = require('../../src/services/canonicalRetellIngestion');
const { createCanonicalVoiceCall, getPinnedVoiceSessionTools } = require('../../src/services/canonicalVoiceSessionCreation');
const { mapExecutiveContextToVariables } = require('../../src/retell/client');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;
const migrationDir = path.resolve(__dirname, '../../migrations');
const ORG_A = '31000000-0000-0000-0000-000000000001';
const ORG_B = '31000000-0000-0000-0000-000000000002';
const USER_A = '32000000-0000-0000-0000-000000000001';
const USER_B = '32000000-0000-0000-0000-000000000002';
const execFileAsync = promisify(execFile);

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

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE canonical_voice_session_events, canonical_voice_sessions CASCADE');
  });

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

  test('a separate process observes the same persisted organization-scoped voice session', async () => {
    const persisted = await create(ORG_A, integrationA, profileA, 'separate-process-call', false);
    const reader = path.resolve(__dirname, '../helpers/m19-part3-voice-session-reader.js');
    const child = await execFileAsync(process.execPath, [reader, ORG_A, 'separate-process-call'], {
      env: { ...process.env, DATABASE_URL: database.connectionString },
      windowsHide: true,
    });
    expect(child.stderr).toBe('');
    expect(JSON.parse(child.stdout)).toEqual([{
      organization_id: ORG_A,
      external_session_id: 'separate-process-call',
      status: 'active',
      business_profile_id: persisted.profile.id,
      business_profile_version: persisted.profile.version,
      business_profile_hash: persisted.profile.hash,
    }]);
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

  test('profile pinned when the session was created drives variables, completion, and replay across profile changes', async () => {
    const pinnedAuthority = await putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: USER_A,
      profile: {
        ...PROFILE,
        financial: { minimumJobPrice: 999, emergencyMarkup: 1.4, travelCharge: 1.1 },
        canonicalPricing: { minimumJobPrice: 275, emergencyMultiplier: 1.4, travelCustomerChargePerMile: 1.1, taxRatePercent: 8.25 },
      },
    });
    let pinnedProviderTools;
    let pinnedVariables;
    const pinnedCall = await createCanonicalVoiceCall({
      pool,
      organizationId: ORG_A,
      phoneNumber: '+15555550198',
      source: 'profile-version-test',
      createProviderCall: async (_phone, _agent, options) => {
        pinnedVariables = mapExecutiveContextToVariables(options.executiveContext);
        pinnedProviderTools = options.sessionTools;
        return { call_id: 'pinned-call', call_status: 'registered' };
      },
    });
    const newer = await putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: USER_A,
      profile: {
        ...PROFILE,
        company: { name: 'Newer Voice Profile', currency: 'USD' },
        financial: { minimumJobPrice: 999, emergencyMarkup: 0, travelCharge: 0 },
        canonicalPricing: { minimumJobPrice: 0, emergencyMultiplier: 0, travelCustomerChargePerMile: 0, taxRatePercent: 0 },
      },
    });
    let newerProviderTools;
    let newerVariables;
    const newerCall = await createCanonicalVoiceCall({
      pool,
      organizationId: ORG_A,
      phoneNumber: '+15555550197',
      source: 'profile-version-test',
      createProviderCall: async (_phone, _agent, options) => {
        newerVariables = mapExecutiveContextToVariables(options.executiveContext);
        newerProviderTools = options.sessionTools;
        return { call_id: 'newer-call', call_status: 'registered' };
      },
    });
    expect(newer.id).not.toBe(pinnedAuthority.id);
    expect(pinnedCall.session.profile).toEqual({
      id: pinnedAuthority.id,
      version: pinnedAuthority.versionLabel,
      hash: pinnedAuthority.profileHash,
    });
    expect(newerCall.session.profile.id).toBe(newer.id);
    expect(pinnedVariables).toMatchObject({
      minimum_job_price: '275', emergency_markup: '1.4', travel_charge: '1.1', tax_rate: '8.25',
    });
    expect(newerVariables).toMatchObject({
      minimum_job_price: '0', emergency_markup: '0', travel_charge: '0', tax_rate: '0',
    });
    const pinnedContext = {
      organizationId: ORG_A,
      voiceSessionId: pinnedCall.session.id,
    };
    const newerContext = {
      organizationId: ORG_A,
      voiceSessionId: newerCall.session.id,
    };
    expect(pinnedProviderTools).toBe(pinnedCall.tools);
    expect(newerProviderTools).toBe(newerCall.tools);
    expect(pinnedCall.tools.execute('getFAQ', { question: 'minimum price' }, pinnedContext)).toMatchObject({
      answer: expect.stringContaining('$275'),
      minimumJobPrice: { status: 'configured', value: 275 },
      authority: expect.objectContaining({ profileId: pinnedAuthority.id, profileHash: pinnedAuthority.profileHash }),
    });
    expect(newerCall.tools.execute('getFAQ', { question: 'minimum price' }, newerContext)).toMatchObject({
      answer: expect.stringContaining('$0'),
      minimumJobPrice: { status: 'configured', value: 0 },
      authority: expect.objectContaining({ profileId: newer.id, profileHash: newer.profileHash }),
    });
    const replayTools = await getPinnedVoiceSessionTools({
      pool,
      organizationId: ORG_A,
      externalSessionId: 'pinned-call',
    });
    expect(replayTools.execute('getFAQ', { question: 'minimum price' }, {
      organizationId: ORG_A,
      voiceSessionId: pinnedCall.session.id,
    }).answer).toContain('$275');
    let scopeError;
    try {
      replayTools.execute('getFAQ', { question: 'minimum price' }, {
        organizationId: ORG_B,
        voiceSessionId: pinnedCall.session.id,
      });
    } catch (error) {
      scopeError = error;
    }
    expect(scopeError).toMatchObject({ code: 'VOICE_TOOL_SCOPE_MISMATCH', status: 403 });
    expect(pinnedCall.tools.definitions.map(item => item.function.name)).toEqual(['getFAQ']);

    const organizationBProfile = await putBusinessProfile(pool, {
      organizationId: ORG_B,
      userId: USER_B,
      profile: {
        ...PROFILE,
        company: { name: 'Voice B Canonical Tools', currency: 'USD' },
        financial: { minimumJobPrice: 50 },
        canonicalPricing: { minimumJobPrice: 425 },
      },
    });
    let organizationBVariables;
    const organizationBCall = await createCanonicalVoiceCall({
      pool,
      organizationId: ORG_B,
      phoneNumber: '+15555550196',
      createProviderCall: async (_phone, _agent, options) => {
        organizationBVariables = mapExecutiveContextToVariables(options.executiveContext);
        return { call_id: 'organization-b-tools-call', call_status: 'registered' };
      },
    });
    expect(organizationBVariables.minimum_job_price).toBe('425');
    expect(organizationBCall.tools.execute('getFAQ', { question: 'minimum price' }, {
      organizationId: ORG_B,
      voiceSessionId: organizationBCall.session.id,
    })).toMatchObject({
      answer: expect.stringContaining('$425'),
      authority: expect.objectContaining({ profileId: organizationBProfile.id, organizationId: ORG_B }),
    });

    await putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: USER_A,
      profile: { ...PROFILE, financial: { minimumJobPrice: 650 }, canonicalPricing: {} },
    });
    let missingVariables;
    const missingCall = await createCanonicalVoiceCall({
      pool,
      organizationId: ORG_A,
      phoneNumber: '+15555550195',
      createProviderCall: async (_phone, _agent, options) => {
        missingVariables = mapExecutiveContextToVariables(options.executiveContext);
        return { call_id: 'missing-tools-call', call_status: 'registered' };
      },
    });
    expect(missingVariables.minimum_job_price).toBe('not_configured');
    expect(missingCall.tools.execute('getFAQ', { question: 'minimum price' }, {
      organizationId: ORG_A,
      voiceSessionId: missingCall.session.id,
    }).minimumJobPrice).toEqual({ status: 'not_configured', value: null });

    await putBusinessProfile(pool, {
      organizationId: ORG_A,
      userId: USER_A,
      profile: { ...PROFILE, financial: { minimumJobPrice: 650 }, canonicalPricing: { minimumJobPrice: '150' } },
    });
    let malformedVariables;
    const malformedCall = await createCanonicalVoiceCall({
      pool,
      organizationId: ORG_A,
      phoneNumber: '+15555550194',
      createProviderCall: async (_phone, _agent, options) => {
        malformedVariables = mapExecutiveContextToVariables(options.executiveContext);
        return { call_id: 'malformed-tools-call', call_status: 'registered' };
      },
    });
    expect(malformedVariables.minimum_job_price).toBe('unavailable');
    expect(malformedCall.tools.execute('getFAQ', { question: 'minimum price' }, {
      organizationId: ORG_A,
      voiceSessionId: malformedCall.session.id,
    })).toMatchObject({
      answer: expect.stringContaining('unavailable'),
      minimumJobPrice: { status: 'unavailable', value: null },
    });
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
    expect(completed.body.businessProfile).toEqual(pinnedCall.session.profile);
    const replayed = await ingestRetellPayload({ ...payload, event_id: 'pinned-event-2' }, { pool, ingestionSource: 'voice' });
    expect(replayed.status).toBe(201);
    expect(replayed.replayed).toBe(true);
    expect(replayed.body.businessProfile).toEqual(pinnedCall.session.profile);
    const session = await voice.getSession(pool, ORG_A, 'pinned-call');
    expect(session.status).toBe('completed');
    expect(session.profile).toEqual(pinnedCall.session.profile);
    expect(pinnedVariables.pricing_rules).toContain('tax_rate=8.25 (configured)');
    expect(pinnedVariables.pricing_rules).not.toBe(newerVariables.pricing_rules);
  });
});
