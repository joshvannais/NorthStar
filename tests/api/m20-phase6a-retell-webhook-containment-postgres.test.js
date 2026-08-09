'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

const ORG_A = '66000000-0000-0000-0000-000000000001';
const ORG_B = '66000000-0000-0000-0000-000000000002';
const TEST_SECRET = 'phase6a-local-hmac-secret-not-a-provider-value';
const FORBIDDEN_AGENT = 'phase6a-forbidden-agent-identifier';
const FORBIDDEN_PHONE = '+15555556666';
const FORBIDDEN_API_KEY = 'phase6a-forbidden-api-key';

const AUTHORITY_TABLES = [
  'organizations',
  'users',
  'subscriptions',
  'canonical_integration_ownership',
  'canonical_business_profiles',
  'canonical_voice_sessions',
  'canonical_voice_session_events',
  'canonical_operations',
  'canonical_customers',
  'canonical_opportunities',
  'canonical_estimates',
  'canonical_polaris_snapshots',
  'canonical_transcripts',
  'canonical_communications',
  'canonical_appointments',
  'leads',
  'call_records',
  'audit_logs',
];

const GRAPH_TABLES = [
  'canonical_operations',
  'canonical_customers',
  'canonical_opportunities',
  'canonical_estimates',
  'canonical_polaris_snapshots',
  'canonical_transcripts',
  'canonical_communications',
  'canonical_appointments',
];

function sign(raw) {
  return crypto.createHmac('sha256', TEST_SECRET).update(raw).digest('hex');
}

function terminalEvent(suffix, agentId = 'phase6a-agent-a', callId = 'phase6a-call-' + suffix) {
  return {
    event: 'call_ended',
    event_id: 'phase6a-event-' + suffix,
    call: {
      call_id: callId,
      agent_id: agentId,
      from_number: '+15555550123',
      transcript_object: [
        { role: 'agent', words: 'How may I help?' },
        { role: 'user', words: 'I need safe plumbing service. My name is Casey.' },
      ],
      call_analysis: {
        customer_name: 'Casey Phase Six',
        service_requested: 'plumbing',
      },
    },
  };
}

function nonterminalEvent(suffix, agentId = 'phase6a-agent-a', callId = 'phase6a-call-' + suffix) {
  return {
    event: 'call_started',
    event_id: 'phase6a-event-' + suffix,
    call: {
      call_id: callId,
      agent_id: agentId,
      from_number: '+15555550124',
    },
  };
}

function collectKeysAndStrings(value, output = { keys: [], strings: [] }) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeysAndStrings(item, output));
    return output;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      output.keys.push(key);
      collectKeysAndStrings(item, output);
    });
    return output;
  }
  if (typeof value === 'string') output.strings.push(value);
  return output;
}

realPostgres('Mission 20 Phase 6A Retell webhook containment', () => {
  let suiteDatabase;
  let db;
  let app;
  let runtimeRoot;
  let originalFetch;
  let voiceWebhook;
  const originalEnvironment = new Map();
  const environmentNames = [
    'DATABASE_URL',
    'NORTHSTAR_DATA_DIR',
    'RETELL_WEBHOOK_SECRET',
    'RETELL_API_KEY',
    'RETELL_AGENT_ID',
    'RETELL_PHONE_NUMBER',
    'STRIPE_SECRET_KEY',
    'TWILIO_AUTH_TOKEN',
  ];

  async function settleAudit() {
    await new Promise((resolve) => setTimeout(resolve, 75));
  }

  async function tableState(tables = AUTHORITY_TABLES) {
    await settleAudit();
    const state = {};
    for (const table of tables) {
      const result = await db.getPool().query(
        `SELECT count(*)::int AS count,
                COALESCE(md5(string_agg(row_value, '|' ORDER BY row_value)), md5('')) AS hash
           FROM (SELECT to_jsonb(source_row)::text AS row_value FROM ${table} source_row) rows`
      );
      state[table] = result.rows[0];
    }
    return state;
  }

  async function sendRaw(route, raw, options = {}) {
    let pending = request(app)
      .post(route)
      .set('Content-Type', options.contentType || 'application/json');
    if (options.timestamp !== undefined) {
      pending = pending.set('X-Retell-Timestamp', String(options.timestamp));
    }
    if (options.signature !== undefined) {
      pending = pending.set('X-Retell-Signature', options.signature);
    }
    return pending.send(raw);
  }

  async function expectRejectedWithoutMutation({
    route = '/api/retell/webhook',
    raw,
    timestamp,
    signature,
    status,
    code,
    contentType,
  }) {
    const before = await tableState();
    const response = await sendRaw(route, raw, { timestamp, signature, contentType });
    expect(response.status).toBe(status);
    if (code) expect(response.body.error.code).toBe(code);
    expect(await tableState()).toEqual(before);
    return response;
  }

  beforeAll(async () => {
    environmentNames.forEach((name) => originalEnvironment.set(name, process.env[name]));
    suiteDatabase = await createSuiteDatabase('m20_phase6a_webhook');
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m20-phase6a-'));

    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.NORTHSTAR_DATA_DIR = runtimeRoot;
    process.env.RETELL_WEBHOOK_SECRET = TEST_SECRET;
    process.env.RETELL_API_KEY = FORBIDDEN_API_KEY;
    process.env.RETELL_AGENT_ID = FORBIDDEN_AGENT;
    process.env.RETELL_PHONE_NUMBER = FORBIDDEN_PHONE;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.TWILIO_AUTH_TOKEN;

    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => {
      throw new Error('Provider/network boundary must remain unused');
    });

    jest.resetModules();
    db = require('../../src/db');
    expect(await db.initDatabase()).toBe(true);
    const pool = db.getPool();

    await pool.query(
      `INSERT INTO organizations (id, name, email) VALUES
        ($1, 'Phase 6A Organization A', 'phase6a-a@example.test'),
        ($2, 'Phase 6A Organization B', 'phase6a-b@example.test')`,
      [ORG_A, ORG_B]
    );
    await pool.query(
      `INSERT INTO subscriptions (id, organization_id, plan_type, status)
       VALUES
         ('66000000-0000-0000-0000-000000000011', $1, 'Professional', 'active'),
         ('66000000-0000-0000-0000-000000000012', $2, 'Professional', 'active')`,
      [ORG_A, ORG_B]
    );

    const { putBusinessProfile, bindIntegrationOwner } = require('../../src/services/organizationAuthority');
    await putBusinessProfile(pool, {
      organizationId: ORG_A,
      profile: canonicalFenceProfile({ companyName: 'Phase 6A Company A' }),
    });
    await putBusinessProfile(pool, {
      organizationId: ORG_B,
      profile: canonicalFenceProfile({ companyName: 'Phase 6A Company B' }),
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_A,
      provider: 'retell',
      externalIntegrationId: 'phase6a-agent-a',
      metadata: { source: 'phase6a-local-test' },
    });
    await bindIntegrationOwner(pool, {
      organizationId: ORG_B,
      provider: 'retell',
      externalIntegrationId: 'phase6a-agent-b',
      metadata: { source: 'phase6a-local-test' },
    });

    voiceWebhook = require('../../src/voice/webhook');
    ({ app } = require('../../src/server'));
  }, 60000);

  afterAll(async () => {
    try {
      await settleAudit();
      if (voiceWebhook) voiceWebhook.shutdown();
      if (db && db.getPool()) await db.getPool().end();
    } finally {
      if (suiteDatabase) await suiteDatabase.cleanup();
      if (runtimeRoot && fs.existsSync(runtimeRoot)) {
        fs.rmSync(runtimeRoot, { recursive: true, force: true });
      }
      global.fetch = originalFetch;
      environmentNames.forEach((name) => {
        const value = originalEnvironment.get(name);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      });
    }
  }, 60000);

  test('public diagnostics and config expose only static protocol facts and no config-presence oracle', async () => {
    const before = await tableState();
    const diagnostics = await request(app).get('/api/retell/webhook/diagnostics');
    const configuration = await request(app).get('/api/retell/webhook/config');

    expect(diagnostics.status).toBe(200);
    expect(configuration.status).toBe(200);
    expect(diagnostics.headers['cache-control']).toMatch(/no-store/);
    expect(configuration.headers['cache-control']).toMatch(/no-store/);

    for (const body of [diagnostics.body, configuration.body]) {
      const inventory = collectKeysAndStrings(body);
      expect(inventory.keys.join('|')).not.toMatch(/agent|phone|secret|api.?key|configured|environment|metadata|tenant|recent.?event/i);
      const serialized = JSON.stringify(body);
      for (const forbidden of [TEST_SECRET, FORBIDDEN_AGENT, FORBIDDEN_PHONE, FORBIDDEN_API_KEY]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
    expect(await tableState()).toEqual(before);
  });

  test.each([
    ['missing signature', undefined, () => String(Math.floor(Date.now() / 1000)), 401, 'INVALID_SIGNATURE'],
    ['invalid signature', '0'.repeat(64), () => String(Math.floor(Date.now() / 1000)), 401, 'INVALID_SIGNATURE'],
    ['malformed signature', 'not-hex', () => String(Math.floor(Date.now() / 1000)), 401, 'INVALID_SIGNATURE'],
    ['missing timestamp', 'valid', () => undefined, 400, 'INVALID_TIMESTAMP'],
    ['partially numeric timestamp', 'valid', () => '123abc', 400, 'INVALID_TIMESTAMP'],
    ['decimal timestamp', 'valid', () => String(Date.now() / 1000), 400, 'INVALID_TIMESTAMP'],
    ['expired timestamp', 'valid', () => String(Math.floor((Date.now() - 6 * 60 * 1000) / 1000)), 400, 'INVALID_TIMESTAMP'],
    ['future timestamp', 'valid', () => String(Math.floor((Date.now() + 6 * 60 * 1000) / 1000)), 400, 'INVALID_TIMESTAMP'],
  ])('%s is rejected before every PostgreSQL mutation', async (label, signatureKind, timestampFactory, status, code) => {
    const raw = JSON.stringify(nonterminalEvent('negative-' + label.replace(/\s+/g, '-')));
    const signature = signatureKind === 'valid' ? sign(raw) : signatureKind;
    await expectRejectedWithoutMutation({
      raw,
      timestamp: timestampFactory(),
      signature,
      status,
      code,
    });
  });

  test('missing validation material fails closed with the same non-oracular signature response', async () => {
    const raw = JSON.stringify(nonterminalEvent('missing-validation-material'));
    const savedSecret = process.env.RETELL_WEBHOOK_SECRET;
    const savedApiKey = process.env.RETELL_API_KEY;
    delete process.env.RETELL_WEBHOOK_SECRET;
    delete process.env.RETELL_API_KEY;
    try {
      await expectRejectedWithoutMutation({
        raw,
        timestamp: Math.floor(Date.now() / 1000),
        signature: sign(raw),
        status: 401,
        code: 'INVALID_SIGNATURE',
      });
    } finally {
      process.env.RETELL_WEBHOOK_SECRET = savedSecret;
      process.env.RETELL_API_KEY = savedApiKey;
    }
  });

  test('malformed JSON is rejected only after transport verification and before PostgreSQL mutation', async () => {
    const raw = '{\r\n  "event": "call_started",\r\n  "call": ';
    await expectRejectedWithoutMutation({
      raw,
      timestamp: Math.floor(Date.now() / 1000),
      signature: sign(raw),
      status: 400,
      code: 'INVALID_WEBHOOK_BODY',
    });
  });

  test('the bounded raw parser rejects bodies above 1 MiB with zero database or audit changes', async () => {
    const raw = 'x'.repeat(1024 * 1024 + 1);
    await expectRejectedWithoutMutation({
      raw,
      timestamp: Math.floor(Date.now() / 1000),
      signature: sign(raw),
      status: 413,
    });
  });

  test('the legacy URL accepts exact signed UTF-8/CRLF bytes once as Retell and rejects exact replay before PostgreSQL', async () => {
    const payload = terminalEvent('legacy-positive');
    const raw = JSON.stringify(payload, null, 2).replace(/\n/g, '\r\n').replace('safe plumbing', 'safe caf\u00e9 plumbing');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(raw);
    const before = await tableState();

    const first = await sendRaw('/api/retell/webhook', raw, { timestamp, signature });
    expect(first.status).toBe(201);
    expect(first.body.received).toBe(true);
    const stored = await db.getPool().query(
      `SELECT t.source, count(*)::int AS count
         FROM canonical_operations o
         JOIN canonical_transcripts t ON t.operation_id = o.id
        WHERE o.organization_id = $1 AND t.external_call_id = $2
        GROUP BY t.source`,
      [ORG_A, payload.call.call_id]
    );
    expect(stored.rows).toEqual([{ source: 'retell', count: 1 }]);
    const afterFirst = await tableState();
    expect(afterFirst).not.toEqual(before);
    expect(afterFirst.audit_logs.count - before.audit_logs.count).toBe(1);

    const replay = await sendRaw('/api/retell/webhook', raw, { timestamp, signature });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('WEBHOOK_REPLAYED');
    expect(await tableState()).toEqual(afterFirst);
  });

  test('concurrent identical signed deliveries use one atomic replay claim', async () => {
    const payload = nonterminalEvent('concurrent');
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(raw);
    const before = await tableState();

    const responses = await Promise.all([
      sendRaw('/api/retell/webhook', raw, { timestamp, signature }),
      sendRaw('/api/retell/webhook', raw, { timestamp, signature }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    expect(responses.find((response) => response.status === 409).body.error.code).toBe('WEBHOOK_REPLAYED');

    const after = await tableState();
    expect(after.canonical_voice_sessions.count - before.canonical_voice_sessions.count).toBe(1);
    expect(after.canonical_voice_session_events.count - before.canonical_voice_session_events.count).toBe(1);
    expect(after.audit_logs.count - before.audit_logs.count).toBe(1);
  });

  test('a distinct signed provider event for the same completed call retains downstream durable graph idempotency', async () => {
    const firstPayload = terminalEvent('durable-first', 'phase6a-agent-a', 'phase6a-call-durable');
    const firstRaw = JSON.stringify(firstPayload);
    const firstTimestamp = String(Math.floor(Date.now() / 1000));
    const first = await sendRaw('/api/retell/webhook', firstRaw, {
      timestamp: firstTimestamp,
      signature: sign(firstRaw),
    });
    expect(first.status).toBe(201);

    const graphState = await tableState(GRAPH_TABLES);
    const duplicatePayload = {
      ...firstPayload,
      event: 'call_analyzed',
      event_id: 'phase6a-event-durable-second',
    };
    const duplicateRaw = JSON.stringify(duplicatePayload);
    const duplicate = await sendRaw('/api/retell/webhook', duplicateRaw, {
      timestamp: String(Math.floor(Date.now() / 1000)),
      signature: sign(duplicateRaw),
    });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.replayed).toBe(true);
    expect(await tableState(GRAPH_TABLES)).toEqual(graphState);
  });

  test('the existing voice URL keeps its signed canonical voice source and replay response contract', async () => {
    const payload = terminalEvent('voice-positive');
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(raw);
    const response = await sendRaw('/api/v1/voice/webhook', raw, {
      timestamp,
      signature,
      contentType: 'application/vnd.retell+json',
    });
    expect(response.status).toBe(201);
    const stored = await db.getPool().query(
      `SELECT t.source, count(*)::int AS count
         FROM canonical_operations o
         JOIN canonical_transcripts t ON t.operation_id = o.id
        WHERE o.organization_id = $1 AND t.external_call_id = $2
        GROUP BY t.source`,
      [ORG_A, payload.call.call_id]
    );
    expect(stored.rows).toEqual([{ source: 'voice', count: 1 }]);

    const after = await tableState();
    const replay = await sendRaw('/api/v1/voice/webhook', raw, { timestamp, signature });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('WEBHOOK_REPLAYED');
    expect(await tableState()).toEqual(after);
  });

  test('unknown ownership and cross-tenant session poison fail closed without PostgreSQL mutation', async () => {
    const unknown = terminalEvent('unknown-owner', 'phase6a-agent-unknown');
    const unknownRaw = JSON.stringify(unknown);
    await expectRejectedWithoutMutation({
      raw: unknownRaw,
      timestamp: Math.floor(Date.now() / 1000),
      signature: sign(unknownRaw),
      status: 404,
      code: 'INTEGRATION_OWNERSHIP_UNKNOWN',
    });

    const tenantB = nonterminalEvent('poison-owner-b', 'phase6a-agent-b', 'phase6a-shared-poison-call');
    const tenantBRaw = JSON.stringify(tenantB);
    const tenantBResponse = await sendRaw('/api/retell/webhook', tenantBRaw, {
      timestamp: Math.floor(Date.now() / 1000),
      signature: sign(tenantBRaw),
    });
    expect(tenantBResponse.status).toBe(202);

    const poison = terminalEvent('poison-owner-a', 'phase6a-agent-a', 'phase6a-shared-poison-call');
    const poisonRaw = JSON.stringify(poison);
    await expectRejectedWithoutMutation({
      raw: poisonRaw,
      timestamp: Math.floor(Date.now() / 1000),
      signature: sign(poisonRaw),
      status: 409,
      code: 'INTEGRATION_OWNERSHIP_CONFLICT',
    });
  });

  test('provider and external network boundaries remain unused', () => {
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
