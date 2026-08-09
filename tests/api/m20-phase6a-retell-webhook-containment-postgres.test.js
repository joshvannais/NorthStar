'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const request = require('supertest');
const { createSuiteDatabase } = require('../helpers/m19-part3-postgres-database');
const { canonicalFenceProfile } = require('../helpers/m19-part3-business-profile');

const realPostgres = process.env.M19_PG_ADMIN_URL ? describe : describe.skip;

const ORG_A = '66000000-0000-0000-0000-000000000001';
const ORG_B = '66000000-0000-0000-0000-000000000002';
const ORG_C = '66000000-0000-0000-0000-000000000003';
const TEST_SECRET = 'phase6a-local-hmac-secret-not-a-provider-value';
const FORBIDDEN_AGENT = 'phase6a-forbidden-agent-identifier';
const FORBIDDEN_PHONE = '+15555556666';
const FORBIDDEN_API_KEY = 'phase6a-forbidden-api-key';
const PROCESS_WORKER = path.resolve(__dirname, '../helpers/m20-phase6a-webhook-process.js');

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
  'retell_webhook_replay_claims',
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

function sign(raw, timestamp = String(Date.now())) {
  const digest = crypto.createHmac('sha256', TEST_SECRET)
    .update(raw)
    .update(timestamp, 'ascii')
    .digest('hex');
  return `v=${timestamp},d=${digest}`;
}

function terminalEvent(suffix, agentId = 'phase6a-agent-a', callId = 'phase6a-call-' + suffix) {
  return {
    event: 'call_ended',
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

function analyzedEvent(suffix, agentId = 'phase6a-agent-a', callId = 'phase6a-call-' + suffix) {
  return {
    ...terminalEvent(suffix, agentId, callId),
    event: 'call_analyzed',
  };
}

function terminalRaceEvent(event, suffix, agentId, callId) {
  const payload = event === 'call_analyzed'
    ? analyzedEvent(suffix, agentId, callId)
    : terminalEvent(suffix, agentId, callId);
  const contactDigits = String(parseInt(
    crypto.createHash('sha256').update(suffix).digest('hex').slice(0, 8),
    16
  ) % 10000000).padStart(7, '0');
  return {
    ...payload,
    call: {
      ...payload.call,
      from_number: '+1555' + contactDigits,
      transcript_object: [
        { role: 'agent', words: 'How may I help?' },
        { role: 'user', words: `I need safe café plumbing service for ${suffix}.` },
      ],
      call_analysis: {
        ...payload.call.call_analysis,
        customer_name: 'Race Customer ' + suffix,
        customer_email: suffix + '@race.example.test',
      },
    },
  };
}

function nonterminalEvent(suffix, agentId = 'phase6a-agent-a', callId = 'phase6a-call-' + suffix) {
  return {
    event: 'call_started',
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

function startWebhookProcess(environment) {
  return new Promise((resolve, reject) => {
    const child = fork(PROCESS_WORKER, [], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, ...environment },
      silent: true,
    });
    let stderr = '';
    let settled = false;
    child.stdout.on('data', () => {});
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('message', message => {
      if (message && message.type === 'ready' && !settled) {
        settled = true;
        resolve({ child, port: message.port, stderr: () => stderr });
      } else if (message && message.type === 'error' && !settled) {
        settled = true;
        reject(new Error(`webhook process failed: ${message.code}\n${stderr}`));
      }
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (!settled) reject(new Error(`webhook process exited before ready: ${code}\n${stderr}`));
    });
  });
}

function stopWebhookProcess(worker) {
  if (!worker || worker.child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('webhook process stop timeout')), 15000);
    worker.child.once('exit', code => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`webhook process stop failed: ${code}\n${worker.stderr()}`));
    });
    worker.child.send({ type: 'stop' });
  });
}

function postRawToProcess(port, route, raw, signature) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: route, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(raw),
        'X-Retell-Signature': signature,
      },
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body), headers: res.headers }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(raw);
  });
}

realPostgres('Mission 20 Phase 6A Retell webhook containment', () => {
  let suiteDatabase;
  let db;
  let app;
  let runtimeRoot;
  let originalFetch;
  let voiceWebhook;
  let replayAuthority;
  const activeWorkers = new Set();
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
    if (options.signature !== undefined) {
      pending = pending.set('X-Retell-Signature', options.signature);
    }
    for (const [name, value] of Object.entries(options.headers || {})) {
      pending = pending.set(name, value);
    }
    return pending.send(raw);
  }

  async function expectRejectedWithoutMutation({
    route = '/api/retell/webhook',
    raw,
    signature,
    status,
    code,
    contentType,
  }) {
    const before = await tableState();
    const response = await sendRaw(route, raw, { signature, contentType });
    expect(response.status).toBe(status);
    if (code) expect(response.body.error.code).toBe(code);
    expect(await tableState()).toEqual(before);
    return response;
  }

  async function auditRowsForResponse(response) {
    await settleAudit();
    const correlationId = response.headers['x-correlation-id'];
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/i);
    const rows = await db.getPool().query(
      `SELECT organization_id, user_id, action, entity_type, entity_id, details
         FROM audit_logs
        WHERE details->>'correlationId' = $1
        ORDER BY created_at, id`,
      [correlationId]
    );
    return { correlationId, rows: rows.rows };
  }

  function expectOnlyAuditChanged(before, after, expectedAuditDelta) {
    for (const table of AUTHORITY_TABLES.filter(name => name !== 'audit_logs')) {
      expect(after[table]).toEqual(before[table]);
    }
    expect(after.audit_logs.count - before.audit_logs.count).toBe(expectedAuditDelta);
  }

  async function startTrackedWebhookProcess() {
    const worker = await startWebhookProcess({
      DATABASE_URL: suiteDatabase.connectionString,
      NORTHSTAR_DATA_DIR: runtimeRoot,
      RETELL_API_KEY: TEST_SECRET,
      RETELL_WEBHOOK_SECRET: FORBIDDEN_API_KEY,
      NODE_ENV: 'test',
    });
    activeWorkers.add(worker);
    return worker;
  }

  async function stopTrackedWebhookProcess(worker) {
    await stopWebhookProcess(worker);
    activeWorkers.delete(worker);
  }

  async function waitForLockWaiters(minimum, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await db.getPool().query(
        `SELECT count(*)::int AS count
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'`
      );
      if (result.rows[0].count >= minimum) return result.rows[0].count;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${minimum} PostgreSQL lock waiters`);
  }

  async function installTranscriptRaceGate(organizationId, callId, lockKey) {
    const pool = db.getPool();
    await pool.query(
      `CREATE TABLE phase6a_terminal_race_gate (
         organization_id UUID NOT NULL,
         external_call_id TEXT NOT NULL,
         lock_key BIGINT NOT NULL,
         PRIMARY KEY (organization_id, external_call_id)
       );
       CREATE FUNCTION phase6a_hold_terminal_transcript_insert() RETURNS trigger
         LANGUAGE plpgsql AS $trigger$
         DECLARE gate_key BIGINT;
         BEGIN
           SELECT lock_key INTO gate_key
             FROM phase6a_terminal_race_gate
            WHERE organization_id = NEW.organization_id
              AND external_call_id = NEW.external_call_id;
           IF FOUND THEN
             PERFORM pg_advisory_xact_lock(gate_key);
           END IF;
           RETURN NEW;
         END
       $trigger$;
       CREATE TRIGGER phase6a_hold_terminal_transcript_insert
         BEFORE INSERT ON canonical_transcripts
         FOR EACH ROW EXECUTE FUNCTION phase6a_hold_terminal_transcript_insert()`
    );
    await pool.query(
      `INSERT INTO phase6a_terminal_race_gate (organization_id, external_call_id, lock_key)
       VALUES ($1, $2, $3::bigint)`,
      [organizationId, callId, String(lockKey)]
    );
    const gateClient = await pool.connect();
    await gateClient.query('SELECT pg_advisory_lock($1::bigint)', [String(lockKey)]);
    let locked = true;
    return {
      async release() {
        if (!locked) return;
        await gateClient.query('SELECT pg_advisory_unlock($1::bigint)', [String(lockKey)]);
        locked = false;
        gateClient.release();
      },
      async cleanup() {
        if (locked) await this.release();
        await pool.query(
          `DROP TRIGGER phase6a_hold_terminal_transcript_insert ON canonical_transcripts;
           DROP FUNCTION phase6a_hold_terminal_transcript_insert();
           DROP TABLE phase6a_terminal_race_gate`
        );
      },
    };
  }

  function sourceForRoute(route) {
    return route === '/api/v1/voice/webhook' ? 'voice' : 'retell';
  }

  async function expectPromiseWithin(promise, timeoutMs, label) {
    let timeout;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(label + ' timed out')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function runTerminalRace({
    suffix,
    firstEvent,
    firstRoute,
    secondEvent,
    secondRoute,
    lockKey,
    multiprocess = false,
    verifyRestartReplay = false,
  }) {
    const pool = db.getPool();
    const callId = 'phase6a-race-' + suffix;
    const payloads = [
      terminalRaceEvent(firstEvent, suffix, 'phase6a-agent-a', callId),
      terminalRaceEvent(secondEvent, suffix, 'phase6a-agent-a', callId),
    ];
    const raws = [
      JSON.stringify(payloads[0], null, 2).replace(/\n/g, '\r\n'),
      JSON.stringify(payloads[1]),
    ];
    const rawBuffers = raws.map(raw => Buffer.from(raw, 'utf8'));
    expect(rawBuffers.map(raw => crypto.createHash('sha256').update(raw).digest('hex')))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/^[0-9a-f]{64}$/),
        expect.stringMatching(/^[0-9a-f]{64}$/),
      ]));
    expect(Buffer.compare(rawBuffers[0], rawBuffers[1])).not.toBe(0);

    const before = await tableState();
    const pinnedProfile = (await pool.query(
      `SELECT id, version_label, normalized_profile_hash
         FROM canonical_business_profiles
        WHERE organization_id = $1 AND is_active = TRUE`,
      [ORG_A]
    )).rows[0];
    const workers = multiprocess
      ? await Promise.all([startTrackedWebhookProcess(), startTrackedWebhookProcess()])
      : [];
    const pendingRequests = [];
    let gate;
    let responses;

    function dispatch(index, route, raw) {
      const pending = multiprocess
        ? postRawToProcess(workers[index].port, route, raw, sign(raw))
        : sendRaw(route, raw, { signature: sign(raw) }).then(response => response);
      pendingRequests.push(pending);
      return pending;
    }

    try {
      gate = await installTranscriptRaceGate(ORG_A, callId, lockKey);
      try {
        const firstRequest = dispatch(0, firstRoute, raws[0]);
        await waitForLockWaiters(1);
        const secondRequest = dispatch(1, secondRoute, raws[1]);
        await waitForLockWaiters(2);
        await gate.release();
        responses = await Promise.all([firstRequest, secondRequest]);
      } finally {
        if (gate) {
          await gate.release();
          await Promise.allSettled(pendingRequests);
          await gate.cleanup();
        }
      }

      expect(responses.map(response => response.status)).toEqual([201, 201]);
      expect(responses.every(response => response.body.received === true)).toBe(true);
      expect(responses[0].body.replayed).not.toBe(true);
      expect(responses[1].body.replayed).toBe(true);
      expect(new Set(responses.map(response => response.body.operationId)).size).toBe(1);

      const after = await tableState();
      const exactDeltas = {
        canonical_voice_sessions: 1,
        canonical_voice_session_events: 2,
        canonical_operations: 1,
        canonical_customers: 1,
        canonical_opportunities: 1,
        canonical_estimates: 1,
        canonical_polaris_snapshots: 1,
        canonical_transcripts: 1,
        canonical_communications: 1,
        canonical_appointments: 1,
        audit_logs: 2,
        retell_webhook_replay_claims: 2,
      };
      for (const [table, delta] of Object.entries(exactDeltas)) {
        expect(after[table].count - before[table].count).toBe(delta);
        expect(after[table].hash).not.toBe(before[table].hash);
      }
      for (const table of AUTHORITY_TABLES.filter(name => !(name in exactDeltas))) {
        expect(after[table]).toEqual(before[table]);
      }

      const graph = await pool.query(
        `SELECT o.id AS operation_id, o.graph_id, o.result_status,
                t.external_call_id, t.source
           FROM canonical_operations o
           JOIN canonical_transcripts t
             ON t.organization_id = o.organization_id AND t.operation_id = o.id
          WHERE o.organization_id = $1 AND t.external_call_id = $2`,
        [ORG_A, callId]
      );
      expect(graph.rows).toEqual([expect.objectContaining({
        operation_id: responses[0].body.operationId,
        graph_id: responses[0].body.graphId,
        result_status: 201,
        external_call_id: callId,
        source: sourceForRoute(firstRoute),
      })]);

      const session = await pool.query(
        `SELECT id, provider, provider_session_id, status, metadata,
                canonical_operation_id, business_profile_id,
                business_profile_version, business_profile_hash
           FROM canonical_voice_sessions
          WHERE organization_id = $1 AND external_session_id = $2`,
        [ORG_A, callId]
      );
      expect(session.rows).toEqual([expect.objectContaining({
        provider: 'retell',
        provider_session_id: callId,
        status: 'completed',
        canonical_operation_id: responses[0].body.operationId,
        business_profile_id: pinnedProfile.id,
        business_profile_version: pinnedProfile.version_label,
        business_profile_hash: pinnedProfile.normalized_profile_hash,
        metadata: expect.objectContaining({ source: sourceForRoute(firstRoute) + '-webhook' }),
      })]);

      const { providerEventIdentity } = require('../../src/services/canonicalRetellIngestion');
      const expectedEventIds = payloads.map((payload, index) => providerEventIdentity(payload, {
        organizationId: ORG_A,
        ingestionSource: sourceForRoute(index === 0 ? firstRoute : secondRoute),
      })).sort();
      const events = await pool.query(
        `SELECT external_event_id, event_type, payload
           FROM canonical_voice_session_events event_record
           JOIN canonical_voice_sessions session_record
             ON session_record.organization_id = event_record.organization_id
            AND session_record.id = event_record.voice_session_id
          WHERE session_record.organization_id = $1
            AND session_record.external_session_id = $2
          ORDER BY external_event_id`,
        [ORG_A, callId]
      );
      expect(events.rows.map(row => row.external_event_id)).toEqual(expectedEventIds);
      expect(new Set(events.rows.map(row => row.external_event_id)).size).toBe(2);
      expect(events.rows.map(row => row.event_type).sort()).toEqual(['call_analyzed', 'call_ended']);
      events.rows.forEach(row => {
        expect(row.external_event_id).toMatch(/^retell-provider-event-v2:[0-9a-f]{64}$/);
        expect(row.payload.graphStatus).toBe(201);
      });

      const expectedFingerprints = rawBuffers.map(raw => replayAuthority.requestFingerprint(raw)).sort();
      const replayRows = await pool.query(
        `SELECT request_fingerprint::text AS request_fingerprint, state
           FROM retell_webhook_replay_claims
          WHERE request_fingerprint::text = ANY($1::text[])
          ORDER BY request_fingerprint`,
        [expectedFingerprints]
      );
      expect(replayRows.rows).toEqual(expectedFingerprints.map(requestFingerprint => ({
        request_fingerprint: requestFingerprint,
        state: 'accepted',
      })));

      const audits = await Promise.all(responses.map(response => auditRowsForResponse(response)));
      expect(new Set(audits.map(item => item.correlationId)).size).toBe(2);
      audits.forEach((item, index) => {
        const route = index === 0 ? firstRoute : secondRoute;
        expect(item.rows).toEqual([expect.objectContaining({
          organization_id: ORG_A,
          user_id: null,
          action: 'retell_webhook.accepted',
          entity_type: 'canonical_voice_session',
          entity_id: session.rows[0].id,
        })]);
        expect(item.rows[0].details).toMatchObject({
          actorLabel: 'provider',
          role: 'system',
          correlationId: item.correlationId,
          afterState: {
            method: 'POST',
            path: route,
            status: 201,
            provider: 'retell',
            source: sourceForRoute(route),
            accepted: true,
          },
        });
        const auditText = JSON.stringify(item.rows[0]);
        for (const forbidden of [callId, payloads[index].call.agent_id, TEST_SECRET, FORBIDDEN_API_KEY]) {
          expect(auditText).not.toContain(forbidden);
        }
      });

      const acceptedState = await tableState();
      const repeat = multiprocess
        ? await postRawToProcess(workers[0].port, secondRoute, raws[1], sign(raws[1]))
        : await sendRaw(secondRoute, raws[1], { signature: sign(raws[1]) });
      expect(repeat.status).toBe(409);
      expect(repeat.body.error.code).toBe('WEBHOOK_REPLAYED');
      expect(await tableState()).toEqual(acceptedState);

      if (verifyRestartReplay) {
        await Promise.all(workers.splice(0).map(worker => stopTrackedWebhookProcess(worker)));
        const restarted = await startTrackedWebhookProcess();
        try {
          const replay = await postRawToProcess(restarted.port, firstRoute, raws[0], sign(raws[0]));
          expect(replay.status).toBe(409);
          expect(replay.body.error.code).toBe('WEBHOOK_REPLAYED');
        } finally {
          await stopTrackedWebhookProcess(restarted);
        }
        expect(await tableState()).toEqual(acceptedState);
      }
    } finally {
      await Promise.all(workers.splice(0).map(worker => stopTrackedWebhookProcess(worker)));
    }
  }

  beforeAll(async () => {
    environmentNames.forEach((name) => originalEnvironment.set(name, process.env[name]));
    suiteDatabase = await createSuiteDatabase('m20_phase6a_webhook');
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'northstar-m20-phase6a-'));

    process.env.DATABASE_URL = suiteDatabase.connectionString;
    process.env.NORTHSTAR_DATA_DIR = runtimeRoot;
    process.env.RETELL_WEBHOOK_SECRET = FORBIDDEN_API_KEY;
    process.env.RETELL_API_KEY = TEST_SECRET;
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
        ($2, 'Phase 6A Organization B', 'phase6a-b@example.test'),
        ($3, 'Phase 6A Organization C', 'phase6a-c@example.test')`,
      [ORG_A, ORG_B, ORG_C]
    );
    await pool.query(
      `INSERT INTO subscriptions (id, organization_id, plan_type, status)
       VALUES
         ('66000000-0000-0000-0000-000000000011', $1, 'Professional', 'active'),
         ('66000000-0000-0000-0000-000000000012', $2, 'Professional', 'active'),
         ('66000000-0000-0000-0000-000000000013', $3, 'Professional', 'active')`,
      [ORG_A, ORG_B, ORG_C]
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
    await bindIntegrationOwner(pool, {
      organizationId: ORG_C,
      provider: 'retell',
      externalIntegrationId: 'phase6a-agent-no-profile',
      metadata: { source: 'phase6a-local-test' },
    });

    voiceWebhook = require('../../src/voice/webhook');
    replayAuthority = require('../../src/retell/webhookReplayAuthority');
    ({ app } = require('../../src/server'));
  }, 60000);

  afterAll(async () => {
    try {
      await Promise.all(Array.from(activeWorkers, worker => stopWebhookProcess(worker)));
      activeWorkers.clear();
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

    const fixedProjection = {
      endpoint: { method: 'POST', path: '/api/retell/webhook' },
      verification: {
        signatureHeader: 'x-retell-signature',
        signatureFormat: 'v=<unix_ms>,d=<hex_digest>',
        timestamp: 'embedded-unix-milliseconds',
        maximumAgeSeconds: 300,
      },
    };
    expect(diagnostics.body).toEqual(fixedProjection);
    expect(configuration.body).toEqual(fixedProjection);

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
    ['/API/RETELL/WEBHOOK', 'legacy mixed case'],
    ['/api/retell/webhook/', 'legacy trailing slash'],
    ['/api/v1/Voice/Webhook', 'voice mixed case'],
    ['/api/v1/voice/webhook/', 'voice trailing slash'],
  ])('only the documented exact webhook URLs own the signed boundary: %s (%s)', async (route) => {
    const payload = nonterminalEvent('strict-route-' + crypto.randomUUID());
    const raw = JSON.stringify(payload);
    const before = await tableState();
    const response = await sendRaw(route, raw, { signature: sign(raw) });
    expect(response.status).toBe(404);

    const audit = await auditRowsForResponse(response);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      organization_id: null,
      user_id: null,
      action: 'POST 404',
      entity_type: expect.any(String),
    });
    expect(audit.rows[0].details).toMatchObject({
      actorLabel: 'anonymous',
      role: 'anonymous',
      requestId: audit.correlationId,
      correlationId: audit.correlationId,
      afterState: {
        method: 'POST',
        path: route,
        status: 404,
      },
    });
    expectOnlyAuditChanged(before, await tableState(), 1);
  });

  test.each([
    ['missing signature', () => undefined, 401, 'INVALID_SIGNATURE'],
    ['invented bare digest', (raw) => crypto.createHmac('sha256', TEST_SECRET).update(raw).digest('hex'), 401, 'INVALID_SIGNATURE'],
    ['malformed signature', () => 'not-hex', 401, 'INVALID_SIGNATURE'],
    ['missing embedded timestamp', () => `d=${'0'.repeat(64)}`, 401, 'INVALID_SIGNATURE'],
    ['partially numeric embedded timestamp', () => `v=123abc,d=${'0'.repeat(64)}`, 401, 'INVALID_SIGNATURE'],
    ['decimal embedded timestamp', () => `v=${Date.now()}.5,d=${'0'.repeat(64)}`, 401, 'INVALID_SIGNATURE'],
    ['uppercase digest', (raw) => sign(raw).toUpperCase(), 401, 'INVALID_SIGNATURE'],
    ['extra signature component', (raw) => sign(raw) + ',x=1', 401, 'INVALID_SIGNATURE'],
    ['internal signature whitespace', (raw) => sign(raw).replace(',d=', ' ,d='), 401, 'INVALID_SIGNATURE'],
    ['invalid digest', () => `v=${Date.now()},d=${'0'.repeat(64)}`, 401, 'INVALID_SIGNATURE'],
    ['expired embedded timestamp', (raw) => sign(raw, String(Date.now() - 6 * 60 * 1000)), 400, 'INVALID_TIMESTAMP'],
    ['future embedded timestamp', (raw) => sign(raw, String(Date.now() + 6 * 60 * 1000)), 400, 'INVALID_TIMESTAMP'],
    ['unsafe embedded timestamp', (raw) => sign(raw, '9007199254740992'), 400, 'INVALID_TIMESTAMP'],
  ])('%s is rejected before every PostgreSQL mutation', async (label, signatureFactory, status, code) => {
    const raw = JSON.stringify(nonterminalEvent('negative-' + label.replace(/\s+/g, '-')));
    await expectRejectedWithoutMutation({
      raw,
      signature: signatureFactory(raw),
      status,
      code,
    });
  });

  test('the invented separate timestamp header cannot substitute for the official composite header', async () => {
    const raw = JSON.stringify(nonterminalEvent('negative-separate-header'));
    const before = await tableState();
    const response = await sendRaw('/api/retell/webhook', raw, {
      headers: { 'X-Retell-Timestamp': String(Date.now()) },
    });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
    expect(await tableState()).toEqual(before);
  });

  test('missing validation material fails closed with the same non-oracular signature response', async () => {
    const raw = JSON.stringify(nonterminalEvent('missing-validation-material'));
    const savedApiKey = process.env.RETELL_API_KEY;
    delete process.env.RETELL_API_KEY;
    try {
      await expectRejectedWithoutMutation({
        raw,
        signature: sign(raw),
        status: 401,
        code: 'INVALID_SIGNATURE',
      });
    } finally {
      process.env.RETELL_API_KEY = savedApiKey;
    }
  });

  test('malformed JSON is rejected only after transport verification and before PostgreSQL mutation', async () => {
    const raw = '{\r\n  "event": "call_started",\r\n  "call": ';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectRejectedWithoutMutation({
        raw,
        signature: sign(raw),
        status: 400,
        code: 'INVALID_WEBHOOK_BODY',
      });
    }
  });

  test.each([
    ['missing', (payload) => { delete payload.event; }],
    ['unknown', (payload) => { payload.event = 'phase6a_unknown_event'; }],
  ])('authenticated %s event is rejected before canonical or audit mutation', async (_label, mutate) => {
    const payload = nonterminalEvent('unsupported-event-' + _label);
    mutate(payload);
    const raw = JSON.stringify(payload);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectRejectedWithoutMutation({
        raw,
        signature: sign(raw),
        status: 400,
        code: 'UNSUPPORTED_WEBHOOK_EVENT',
      });
    }
  });

  test('authenticated unsupported content is released and remains zero-mutation on retry', async () => {
    const raw = JSON.stringify(nonterminalEvent('unsupported-content'));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectRejectedWithoutMutation({
        raw,
        signature: sign(raw),
        contentType: 'text/plain',
        status: 415,
        code: 'UNSUPPORTED_WEBHOOK_MEDIA_TYPE',
      });
    }
  });

  test('a canonical terminal-payload rejection releases the claim and leaves every authority unchanged', async () => {
    const payload = terminalEvent('missing-transcript');
    delete payload.call.transcript_object;
    const raw = JSON.stringify(payload);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectRejectedWithoutMutation({
        raw,
        signature: sign(raw),
        status: 400,
        code: 'RETELL_TRANSCRIPT_REQUIRED',
      });
    }
  });

  test('the bounded raw parser rejects bodies above 1 MiB with zero database or audit changes', async () => {
    const raw = 'x'.repeat(1024 * 1024 + 1);
    await expectRejectedWithoutMutation({
      raw,
      signature: sign(raw),
      status: 413,
    });
  });

  test('the mounted route fails closed at the exact durable replay cap without eviction or mutation', async () => {
    const marker = new Date('2041-01-01T00:00:00.000Z');
    const pool = db.getPool();
    const existing = (await pool.query(
      'SELECT count(*)::int AS count FROM retell_webhook_replay_claims'
    )).rows[0].count;
    await pool.query(
      `INSERT INTO retell_webhook_replay_claims
        (request_fingerprint, state, claim_token, claimed_at, accepted_at, expires_at)
       SELECT md5('phase6a-http-cap-a-' || value::text) || md5('phase6a-http-cap-b-' || value::text),
              'accepted', gen_random_uuid(), $1::timestamptz, $1::timestamptz,
              $1::timestamptz + INTERVAL '24 hours'
         FROM generate_series(1, $2) value`,
      [marker, replayAuthority.MAX_REPLAY_ENTRIES - existing]
    );
    try {
      const raw = JSON.stringify(nonterminalEvent('capacity-overflow'));
      await expectRejectedWithoutMutation({
        raw,
        signature: sign(raw),
        status: 503,
        code: 'WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE',
      });
    } finally {
      await pool.query('DELETE FROM retell_webhook_replay_claims WHERE accepted_at = $1', [marker]);
    }
  }, 60000);

  test('the legacy URL accepts exact signed UTF-8/CRLF bytes once as Retell and rejects exact replay before PostgreSQL', async () => {
    const payload = terminalEvent('legacy-positive');
    const raw = JSON.stringify(payload, null, 2).replace(/\n/g, '\r\n').replace('safe plumbing', 'safe caf\u00e9 plumbing');
    const signature = sign(raw);
    const before = await tableState();

    const first = await sendRaw('/api/retell/webhook', raw, { signature });
    expect(first.status).toBe(201);
    expect(first.body.received).toBe(true);
    expect(first.body).not.toHaveProperty('auditContext');
    expect(collectKeysAndStrings(first.body).keys).not.toContain('auditContext');
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
    const acceptedAudit = await auditRowsForResponse(first);
    expect(acceptedAudit.rows).toHaveLength(1);
    const session = await db.getPool().query(
      `SELECT id FROM canonical_voice_sessions
        WHERE organization_id = $1 AND external_session_id = $2`,
      [ORG_A, payload.call.call_id]
    );
    const serializedBody = JSON.stringify(first.body);
    expect(serializedBody).not.toContain(session.rows[0].id);
    expect(serializedBody).not.toContain('retell_webhook.accepted');
    expect(serializedBody).not.toContain('canonical_voice_session');
    expect(acceptedAudit.rows[0]).toMatchObject({
      organization_id: ORG_A,
      user_id: null,
      action: 'retell_webhook.accepted',
      entity_type: 'canonical_voice_session',
      entity_id: session.rows[0].id,
    });
    expect(acceptedAudit.rows[0].details).toMatchObject({
      actorLabel: 'provider',
      role: 'system',
      requestId: acceptedAudit.correlationId,
      correlationId: acceptedAudit.correlationId,
      afterState: {
        method: 'POST',
        path: '/api/retell/webhook',
        status: 201,
        provider: 'retell',
        source: 'retell',
        accepted: true,
      },
    });
    const auditText = JSON.stringify(acceptedAudit.rows[0]);
    for (const forbidden of [payload.call.agent_id, payload.call.call_id, TEST_SECRET, FORBIDDEN_API_KEY]) {
      expect(auditText).not.toContain(forbidden);
    }

    const replay = await sendRaw('/api/retell/webhook', raw, { signature });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('WEBHOOK_REPLAYED');
    expect(await tableState()).toEqual(afterFirst);

    const crossAliasReplay = await sendRaw('/api/v1/voice/webhook', raw, { signature });
    expect(crossAliasReplay.status).toBe(409);
    expect(crossAliasReplay.body.error.code).toBe('WEBHOOK_REPLAYED');
    expect(await tableState()).toEqual(afterFirst);
  });

  test('official no-event_id lifecycle retries converge across JSON serialization variations', async () => {
    const payload = terminalEvent('official-no-event-id');
    expect(payload).not.toHaveProperty('event_id');
    const firstRaw = JSON.stringify(payload);
    const first = await sendRaw('/api/retell/webhook', firstRaw, { signature: sign(firstRaw) });
    expect(first.status).toBe(201);
    const acceptedState = await tableState();

    const durableTables = [
      ...GRAPH_TABLES,
      'canonical_voice_sessions',
      'canonical_voice_session_events',
    ];
    const afterFirst = await tableState(durableTables);
    const identity = await db.getPool().query(
      `SELECT external_event_id
         FROM canonical_voice_session_events event_record
         JOIN canonical_voice_sessions session_record
           ON session_record.organization_id = event_record.organization_id
          AND session_record.id = event_record.voice_session_id
        WHERE session_record.organization_id = $1
          AND session_record.external_session_id = $2`,
      [ORG_A, payload.call.call_id]
    );
    expect(identity.rows).toEqual([{
      external_event_id: expect.stringMatching(/^retell-provider-event-v2:[0-9a-f]{64}$/),
    }]);

    const reordered = {
      call: {
        call_analysis: {
          service_requested: payload.call.call_analysis.service_requested,
          customer_name: payload.call.call_analysis.customer_name,
        },
        transcript_object: payload.call.transcript_object.map(turn => ({ words: turn.words, role: turn.role })),
        from_number: payload.call.from_number,
        agent_id: payload.call.agent_id,
        call_id: payload.call.call_id,
      },
      event: payload.event,
    };
    const secondRaw = JSON.stringify(reordered, null, 2).replace(/\n/g, '\r\n');
    const second = await sendRaw('/api/retell/webhook', secondRaw, { signature: sign(secondRaw) });
    expect(second.status).toBe(201);
    expect(second.body.replayed).toBe(true);
    expect(await tableState(durableTables)).toEqual(afterFirst);
    const retriedState = await tableState();
    for (const table of AUTHORITY_TABLES.filter(name => !['audit_logs', 'retell_webhook_replay_claims'].includes(name))) {
      expect(retriedState[table]).toEqual(acceptedState[table]);
    }
    expect(retriedState.audit_logs.count - acceptedState.audit_logs.count).toBe(1);
    expect(retriedState.retell_webhook_replay_claims.count - acceptedState.retell_webhook_replay_claims.count).toBe(1);
  });

  test('supplied event identity converges on semantic retry and rejects changed semantics atomically', async () => {
    const payload = {
      ...terminalEvent('supplied-semantic-retry'),
      event_id: 'shared-provider-event-id',
    };
    const firstRaw = JSON.stringify(payload);
    const first = await sendRaw('/api/retell/webhook', firstRaw, { signature: sign(firstRaw) });
    expect(first.status).toBe(201);
    const afterFirst = await tableState();

    const reordered = {
      call: {
        call_analysis: {
          service_requested: payload.call.call_analysis.service_requested,
          customer_name: payload.call.call_analysis.customer_name,
        },
        transcript_object: payload.call.transcript_object.map(turn => ({ words: turn.words, role: turn.role })),
        from_number: payload.call.from_number,
        agent_id: payload.call.agent_id,
        call_id: payload.call.call_id,
      },
      event: payload.event,
      event_id: payload.event_id,
    };
    const retryRaw = JSON.stringify(reordered, null, 2).replace(/\n/g, '\r\n');
    const retry = await sendRaw('/api/retell/webhook', retryRaw, { signature: sign(retryRaw) });
    expect(retry.status).toBe(201);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.operationId).toBe(first.body.operationId);

    const afterRetry = await tableState();
    for (const table of AUTHORITY_TABLES.filter(name => !['audit_logs', 'retell_webhook_replay_claims'].includes(name))) {
      expect(afterRetry[table]).toEqual(afterFirst[table]);
    }
    expect(afterRetry.audit_logs.count - afterFirst.audit_logs.count).toBe(1);
    expect(afterRetry.retell_webhook_replay_claims.count - afterFirst.retell_webhook_replay_claims.count).toBe(1);

    const conflict = JSON.parse(JSON.stringify(reordered));
    conflict.call.transcript_object[1].words = 'I need materially different electrical service.';
    const conflictRaw = JSON.stringify(conflict);
    const conflictResponse = await sendRaw('/api/retell/webhook', conflictRaw, { signature: sign(conflictRaw) });
    expect(conflictResponse.status).toBe(409);
    expect(conflictResponse.body.error.code).toBe('VOICE_EVENT_IDENTITY_CONFLICT');
    expect(await tableState()).toEqual(afterRetry);

    const stored = await db.getPool().query(
      `SELECT event_record.external_event_id, event_record.event_type, session_record.status,
              session_record.canonical_operation_id
         FROM canonical_voice_session_events event_record
         JOIN canonical_voice_sessions session_record
           ON session_record.organization_id = event_record.organization_id
          AND session_record.id = event_record.voice_session_id
        WHERE session_record.organization_id = $1
          AND session_record.external_session_id = $2`,
      [ORG_A, payload.call.call_id]
    );
    expect(stored.rows).toEqual([expect.objectContaining({
      external_event_id: expect.stringMatching(/^retell-provider-event-v2:[0-9a-f]{64}$/),
      event_type: 'call_ended',
      status: 'completed',
      canonical_operation_id: first.body.operationId,
    })]);
    expect(stored.rows[0].external_event_id).not.toContain(payload.event_id);
  });

  test('concurrent identical signed deliveries use one atomic replay claim', async () => {
    const payload = nonterminalEvent('concurrent');
    const raw = JSON.stringify(payload);
    const signature = sign(raw);
    const before = await tableState();

    const responses = await Promise.all([
      sendRaw('/api/retell/webhook', raw, { signature }),
      sendRaw('/api/retell/webhook', raw, { signature }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    expect(responses.find((response) => response.status === 409).body.error.code).toBe('WEBHOOK_REPLAYED');

    const after = await tableState();
    expect(after.canonical_voice_sessions.count - before.canonical_voice_sessions.count).toBe(1);
    expect(after.canonical_voice_session_events.count - before.canonical_voice_session_events.count).toBe(1);
    expect(after.audit_logs.count - before.audit_logs.count).toBe(1);
  });

  test('two mounted Node processes elect one winner and a fresh process rejects the retained replay', async () => {
    const payload = nonterminalEvent('multiprocess-restart');
    const raw = JSON.stringify(payload);
    const signature = sign(raw);
    const before = await tableState();
    const workers = await Promise.all([startTrackedWebhookProcess(), startTrackedWebhookProcess()]);
    try {
      const responses = await Promise.all(workers.map(worker =>
        postRawToProcess(worker.port, '/api/retell/webhook', raw, signature)));
      expect(responses.map(response => response.status).sort()).toEqual([202, 409]);
      expect(responses.find(response => response.status === 409).body.error.code).toBe('WEBHOOK_REPLAYED');
    } finally {
      await Promise.all(workers.map(stopTrackedWebhookProcess));
    }

    const accepted = await tableState();
    expect(accepted.canonical_voice_sessions.count - before.canonical_voice_sessions.count).toBe(1);
    expect(accepted.canonical_voice_session_events.count - before.canonical_voice_session_events.count).toBe(1);
    expect(accepted.audit_logs.count - before.audit_logs.count).toBe(1);

    const restarted = await startTrackedWebhookProcess();
    try {
      const replay = await postRawToProcess(restarted.port, '/api/retell/webhook', raw, signature);
      expect(replay.status).toBe(409);
      expect(replay.body.error.code).toBe('WEBHOOK_REPLAYED');
    } finally {
      await stopTrackedWebhookProcess(restarted);
    }
    expect(await tableState()).toEqual(accepted);
  }, 60000);

  test('a distinct signed provider event for the same completed call retains downstream durable graph idempotency', async () => {
    const firstPayload = {
      ...terminalEvent('durable-first', 'phase6a-agent-a', 'phase6a-call-durable'),
      event_id: 'shared-lifecycle-provider-id',
    };
    const firstRaw = JSON.stringify(firstPayload);
    const first = await sendRaw('/api/retell/webhook', firstRaw, {
      signature: sign(firstRaw),
    });
    expect(first.status).toBe(201);

    const graphState = await tableState(GRAPH_TABLES);
    const duplicatePayload = {
      ...firstPayload,
      event: 'call_analyzed',
    };
    const duplicateRaw = JSON.stringify(duplicatePayload);
    const duplicate = await sendRaw('/api/retell/webhook', duplicateRaw, {
      signature: sign(duplicateRaw),
    });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.replayed).toBe(true);
    expect(await tableState(GRAPH_TABLES)).toEqual(graphState);
    const events = await db.getPool().query(
      `SELECT event_record.external_event_id, event_record.event_type, session_record.status
         FROM canonical_voice_session_events event_record
         JOIN canonical_voice_sessions session_record
           ON session_record.organization_id = event_record.organization_id
          AND session_record.id = event_record.voice_session_id
        WHERE session_record.organization_id = $1
          AND session_record.external_session_id = $2
        ORDER BY event_record.event_type`,
      [ORG_A, firstPayload.call.call_id]
    );
    expect(events.rows).toEqual([
      expect.objectContaining({ event_type: 'call_analyzed', status: 'completed' }),
      expect.objectContaining({ event_type: 'call_ended', status: 'completed' }),
    ]);
    expect(new Set(events.rows.map(row => row.external_event_id)).size).toBe(2);
    events.rows.forEach(row => {
      expect(row.external_event_id).toMatch(/^retell-provider-event-v2:[0-9a-f]{64}$/);
      expect(row.external_event_id).not.toContain(firstPayload.event_id);
    });
  });

  test.each([
    {
      label: 'same process call_ended then call_analyzed across Retell and Voice aliases',
      suffix: 'same-ended-analyzed',
      firstEvent: 'call_ended',
      firstRoute: '/api/retell/webhook',
      secondEvent: 'call_analyzed',
      secondRoute: '/api/v1/voice/webhook',
      lockKey: 862609200002n,
    },
    {
      label: 'same process call_analyzed then call_ended across Voice and Retell aliases',
      suffix: 'same-analyzed-ended',
      firstEvent: 'call_analyzed',
      firstRoute: '/api/v1/voice/webhook',
      secondEvent: 'call_ended',
      secondRoute: '/api/retell/webhook',
      lockKey: 862609200003n,
    },
    {
      label: 'two mounted processes call_ended then call_analyzed across Retell and Voice aliases',
      suffix: 'process-ended-analyzed',
      firstEvent: 'call_ended',
      firstRoute: '/api/retell/webhook',
      secondEvent: 'call_analyzed',
      secondRoute: '/api/v1/voice/webhook',
      lockKey: 862609200004n,
      multiprocess: true,
    },
    {
      label: 'two mounted processes call_analyzed then call_ended across Voice and Retell aliases',
      suffix: 'process-analyzed-ended',
      firstEvent: 'call_analyzed',
      firstRoute: '/api/v1/voice/webhook',
      secondEvent: 'call_ended',
      secondRoute: '/api/retell/webhook',
      lockKey: 862609200005n,
      multiprocess: true,
      verifyRestartReplay: true,
    },
  ])('serializes simultaneous distinct terminal events: $label', async fixture => {
    await runTerminalRace(fixture);
  }, 60000);

  test('terminal-call serialization remains isolated by resolved tenant and call', async () => {
    const targetCallId = 'phase6a-race-isolation-target';
    const target = terminalRaceEvent('call_ended', 'isolation-target', 'phase6a-agent-a', targetCallId);
    const sameTenantOtherCall = terminalRaceEvent(
      'call_analyzed',
      'isolation-other-call',
      'phase6a-agent-a',
      'phase6a-race-isolation-other-call'
    );
    const otherTenantOtherCall = terminalRaceEvent(
      'call_analyzed',
      'isolation-other-tenant',
      'phase6a-agent-b',
      'phase6a-race-isolation-other-tenant-call'
    );
    const targetRaw = JSON.stringify(target);
    const controls = [sameTenantOtherCall, otherTenantOtherCall].map(payload => JSON.stringify(payload));
    const before = await tableState();
    const gate = await installTranscriptRaceGate(ORG_A, targetCallId, 862609200006n);
    const requests = [];
    let targetResponse;
    let controlResponses;
    try {
      const targetRequest = sendRaw('/api/retell/webhook', targetRaw, {
        signature: sign(targetRaw),
      }).then(response => response);
      requests.push(targetRequest);
      await waitForLockWaiters(1);

      const controlPromise = Promise.all([
        sendRaw('/api/v1/voice/webhook', controls[0], { signature: sign(controls[0]) }).then(response => response),
        sendRaw('/api/retell/webhook', controls[1], { signature: sign(controls[1]) }).then(response => response),
      ]);
      requests.push(controlPromise);
      controlResponses = await expectPromiseWithin(
        controlPromise,
        5000,
        'tenant/call-isolated terminal controls'
      );
      expect(controlResponses.map(response => response.status)).toEqual([201, 201]);

      const visibleBeforeRelease = await db.getPool().query(
        `SELECT organization_id, external_call_id
           FROM canonical_transcripts
          WHERE (organization_id = $1 AND external_call_id = $2)
             OR (organization_id = $1 AND external_call_id = $3)
             OR (organization_id = $4 AND external_call_id = $5)
          ORDER BY organization_id, external_call_id`,
        [ORG_A, targetCallId, sameTenantOtherCall.call.call_id, ORG_B, otherTenantOtherCall.call.call_id]
      );
      expect(visibleBeforeRelease.rows).toEqual([
        { organization_id: ORG_A, external_call_id: sameTenantOtherCall.call.call_id },
        { organization_id: ORG_B, external_call_id: otherTenantOtherCall.call.call_id },
      ]);

      await gate.release();
      targetResponse = await targetRequest;
    } finally {
      await gate.release();
      await Promise.allSettled(requests);
      await gate.cleanup();
    }

    expect(targetResponse.status).toBe(201);
    const acceptedState = await tableState();
    const crossTenantPoison = terminalRaceEvent(
      'call_analyzed',
      'isolation-cross-tenant-poison',
      'phase6a-agent-b',
      targetCallId
    );
    const poisonRaw = JSON.stringify(crossTenantPoison);
    const poisonResponse = await sendRaw('/api/retell/webhook', poisonRaw, {
      signature: sign(poisonRaw),
    });
    expect(poisonResponse.status).toBe(409);
    expect(poisonResponse.body.error.code).toBe('INTEGRATION_OWNERSHIP_CONFLICT');
    expect(await tableState()).toEqual(acceptedState);

    const after = await tableState();
    const exactDeltas = {
      canonical_voice_sessions: 3,
      canonical_voice_session_events: 3,
      canonical_operations: 3,
      canonical_customers: 3,
      canonical_opportunities: 3,
      canonical_estimates: 3,
      canonical_polaris_snapshots: 3,
      canonical_transcripts: 3,
      canonical_communications: 3,
      canonical_appointments: 3,
      audit_logs: 3,
      retell_webhook_replay_claims: 3,
    };
    for (const [table, delta] of Object.entries(exactDeltas)) {
      expect(after[table].count - before[table].count).toBe(delta);
      expect(after[table].hash).not.toBe(before[table].hash);
    }
    for (const table of AUTHORITY_TABLES.filter(name => !(name in exactDeltas))) {
      expect(after[table]).toEqual(before[table]);
    }

    const finalRows = await db.getPool().query(
      `SELECT organization_id, external_call_id, count(*)::int AS count
         FROM canonical_transcripts
        WHERE (organization_id = $1 AND external_call_id = $2)
           OR (organization_id = $1 AND external_call_id = $3)
           OR (organization_id = $4 AND external_call_id = $5)
        GROUP BY organization_id, external_call_id
        ORDER BY organization_id, external_call_id`,
      [ORG_A, targetCallId, sameTenantOtherCall.call.call_id, ORG_B, otherTenantOtherCall.call.call_id]
    );
    expect(finalRows.rows).toEqual([
      { organization_id: ORG_A, external_call_id: sameTenantOtherCall.call.call_id, count: 1 },
      { organization_id: ORG_A, external_call_id: targetCallId, count: 1 },
      { organization_id: ORG_B, external_call_id: otherTenantOtherCall.call.call_id, count: 1 },
    ]);
  }, 60000);

  test('the existing voice URL keeps its signed canonical voice source and replay response contract', async () => {
    const payload = terminalEvent('voice-positive');
    const raw = JSON.stringify(payload);
    const signature = sign(raw);
    const response = await sendRaw('/api/v1/voice/webhook', raw, {
      signature,
      contentType: 'application/vnd.retell+json',
    });
    expect(response.status).toBe(201);
    expect(response.body).not.toHaveProperty('auditContext');
    const stored = await db.getPool().query(
      `SELECT t.source, count(*)::int AS count
         FROM canonical_operations o
         JOIN canonical_transcripts t ON t.operation_id = o.id
        WHERE o.organization_id = $1 AND t.external_call_id = $2
        GROUP BY t.source`,
      [ORG_A, payload.call.call_id]
    );
    expect(stored.rows).toEqual([{ source: 'voice', count: 1 }]);
    const acceptedAudit = await auditRowsForResponse(response);
    expect(acceptedAudit.rows).toHaveLength(1);
    expect(acceptedAudit.rows[0]).toMatchObject({
      organization_id: ORG_A,
      user_id: null,
      action: 'retell_webhook.accepted',
      entity_type: 'canonical_voice_session',
    });
    expect(acceptedAudit.rows[0].details).toMatchObject({
      actorLabel: 'provider',
      role: 'system',
      requestId: acceptedAudit.correlationId,
      correlationId: acceptedAudit.correlationId,
      afterState: {
        path: '/api/v1/voice/webhook',
        status: 201,
        provider: 'retell',
        source: 'voice',
        accepted: true,
      },
    });

    const after = await tableState();
    const replay = await sendRaw('/api/v1/voice/webhook', raw, { signature });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('WEBHOOK_REPLAYED');
    expect(await tableState()).toEqual(after);
  });

  test('the same supplied event ID is source-separated across both exact aliases', async () => {
    const payload = {
      ...nonterminalEvent('source-domain', 'phase6a-agent-a', 'phase6a-call-source-domain'),
      event_id: 'shared-source-provider-id',
    };
    const retellRaw = JSON.stringify(payload);
    const retell = await sendRaw('/api/retell/webhook', retellRaw, { signature: sign(retellRaw) });
    expect(retell.status).toBe(202);

    const reordered = {
      call: {
        from_number: payload.call.from_number,
        agent_id: payload.call.agent_id,
        call_id: payload.call.call_id,
      },
      event_id: payload.event_id,
      event: payload.event,
    };
    const voiceRaw = JSON.stringify(reordered, null, 2);
    expect(voiceRaw).not.toBe(retellRaw);
    const voice = await sendRaw('/api/v1/voice/webhook', voiceRaw, { signature: sign(voiceRaw) });
    expect(voice.status).toBe(202);

    const events = await db.getPool().query(
      `SELECT event_record.external_event_id
         FROM canonical_voice_session_events event_record
         JOIN canonical_voice_sessions session_record
           ON session_record.organization_id = event_record.organization_id
          AND session_record.id = event_record.voice_session_id
        WHERE session_record.organization_id = $1
          AND session_record.external_session_id = $2
        ORDER BY event_record.external_event_id`,
      [ORG_A, payload.call.call_id]
    );
    expect(events.rows).toHaveLength(2);
    expect(new Set(events.rows.map(row => row.external_event_id)).size).toBe(2);
    events.rows.forEach(row => expect(row.external_event_id).toMatch(/^retell-provider-event-v2:[0-9a-f]{64}$/));

    const retellAudit = await auditRowsForResponse(retell);
    const voiceAudit = await auditRowsForResponse(voice);
    expect(retellAudit.rows[0].details.afterState.source).toBe('retell');
    expect(voiceAudit.rows[0].details.afterState.source).toBe('voice');
  });

  test('supplied IDs are tenant/call separated and cannot collide with a member runtime-action key', async () => {
    const suppliedEventId = 'shared-provider-and-member-id';
    const fixtures = [
      { organizationId: ORG_A, agentId: 'phase6a-agent-a', callId: 'phase6a-domain-call-a1' },
      { organizationId: ORG_A, agentId: 'phase6a-agent-a', callId: 'phase6a-domain-call-a2' },
      { organizationId: ORG_B, agentId: 'phase6a-agent-b', callId: 'phase6a-domain-call-b1' },
    ];
    for (const fixture of fixtures) {
      const payload = {
        ...nonterminalEvent('domain', fixture.agentId, fixture.callId),
        event_id: suppliedEventId,
      };
      const raw = JSON.stringify(payload);
      const response = await sendRaw('/api/retell/webhook', raw, { signature: sign(raw) });
      expect(response.status).toBe(202);
    }

    const providerEvents = await db.getPool().query(
      `SELECT event_record.external_event_id, session_record.organization_id,
              session_record.external_session_id
         FROM canonical_voice_session_events event_record
         JOIN canonical_voice_sessions session_record
           ON session_record.organization_id = event_record.organization_id
          AND session_record.id = event_record.voice_session_id
        WHERE session_record.external_session_id = ANY($1::text[])
        ORDER BY session_record.organization_id, session_record.external_session_id`,
      [fixtures.map(fixture => fixture.callId)]
    );
    expect(providerEvents.rows).toHaveLength(3);
    expect(new Set(providerEvents.rows.map(row => row.external_event_id)).size).toBe(3);
    providerEvents.rows.forEach(row => {
      expect(row.external_event_id).toMatch(/^retell-provider-event-v2:[0-9a-f]{64}$/);
      expect(row.external_event_id).not.toBe(suppliedEventId);
    });

    const voiceSessions = require('../../src/services/voiceSessionAuthority');
    const runtimeLike = await voiceSessions.appendEvent(db.getPool(), {
      organizationId: ORG_A,
      externalSessionId: fixtures[0].callId,
      externalEventId: suppliedEventId,
      eventType: 'human_handoff',
      payload: { requestedBy: 'member-runtime-action' },
    });
    expect(runtimeLike.inserted).toBe(true);
    const sharedSessionEvents = await db.getPool().query(
      `SELECT event_record.external_event_id, event_record.event_type
         FROM canonical_voice_session_events event_record
         JOIN canonical_voice_sessions session_record
           ON session_record.organization_id = event_record.organization_id
          AND session_record.id = event_record.voice_session_id
        WHERE session_record.organization_id = $1
          AND session_record.external_session_id = $2
        ORDER BY event_record.event_type`,
      [ORG_A, fixtures[0].callId]
    );
    expect(sharedSessionEvents.rows).toEqual([
      { external_event_id: expect.stringMatching(/^retell-provider-event-v2:[0-9a-f]{64}$/), event_type: 'call_started' },
      { external_event_id: suppliedEventId, event_type: 'human_handoff' },
    ]);
  });

  test('a canonical 5xx releases the matching claim so a legitimate retry is not misclassified as replay', async () => {
    const payload = nonterminalEvent('no-profile', 'phase6a-agent-no-profile');
    const raw = JSON.stringify(payload);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectRejectedWithoutMutation({
        raw,
        signature: sign(raw),
        status: 503,
        code: 'CANONICAL_BUSINESS_PROFILE_REQUIRED',
      });
    }
  });

  test('accepted-transition failure rolls canonical and audit writes back before token-matched release', async () => {
    const pool = db.getPool();
    await pool.query(
      `CREATE FUNCTION phase6a_fail_replay_accept() RETURNS trigger
         LANGUAGE plpgsql AS $trigger$
         BEGIN
           IF NEW.state = 'accepted' AND OLD.state = 'claimed' THEN
             RAISE EXCEPTION 'phase6a injected accepted transition failure';
           END IF;
           RETURN NEW;
         END
       $trigger$;
       CREATE TRIGGER phase6a_fail_replay_accept
         BEFORE UPDATE ON retell_webhook_replay_claims
         FOR EACH ROW EXECUTE FUNCTION phase6a_fail_replay_accept()`
    );
    try {
      const payload = terminalEvent('accept-rollback');
      const raw = JSON.stringify(payload);
      await expectRejectedWithoutMutation({
        raw,
        signature: sign(raw),
        status: 503,
        code: 'WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE',
      });
    } finally {
      await pool.query('DROP TRIGGER phase6a_fail_replay_accept ON retell_webhook_replay_claims');
      await pool.query('DROP FUNCTION phase6a_fail_replay_accept()');
    }
  });

  test('accepted-audit failure rolls canonical and replay writes back before token-matched release', async () => {
    const pool = db.getPool();
    await pool.query(
      `CREATE FUNCTION phase6a_fail_webhook_audit() RETURNS trigger
         LANGUAGE plpgsql AS $trigger$
         BEGIN
           RAISE EXCEPTION 'phase6a injected accepted audit failure';
         END
       $trigger$;
       CREATE TRIGGER phase6a_fail_webhook_audit
         BEFORE INSERT ON audit_logs
         FOR EACH ROW EXECUTE FUNCTION phase6a_fail_webhook_audit()`
    );
    try {
      const payload = terminalEvent('audit-rollback');
      const raw = JSON.stringify(payload);
      await expectRejectedWithoutMutation({
        raw,
        signature: sign(raw),
        status: 503,
        code: 'WEBHOOK_REPLAY_PROTECTION_UNAVAILABLE',
      });
    } finally {
      await pool.query('DROP TRIGGER phase6a_fail_webhook_audit ON audit_logs');
      await pool.query('DROP FUNCTION phase6a_fail_webhook_audit()');
    }
  });

  test('unknown ownership and cross-tenant session poison fail closed without PostgreSQL mutation', async () => {
    const unknown = terminalEvent('unknown-owner', 'phase6a-agent-unknown');
    const unknownRaw = JSON.stringify(unknown);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectRejectedWithoutMutation({
        raw: unknownRaw,
        signature: sign(unknownRaw),
        status: 404,
        code: 'INTEGRATION_OWNERSHIP_UNKNOWN',
      });
    }

    const tenantB = nonterminalEvent('poison-owner-b', 'phase6a-agent-b', 'phase6a-shared-poison-call');
    const tenantBRaw = JSON.stringify(tenantB);
    const tenantBResponse = await sendRaw('/api/retell/webhook', tenantBRaw, {
      signature: sign(tenantBRaw),
    });
    expect(tenantBResponse.status).toBe(202);

    const poison = terminalEvent('poison-owner-a', 'phase6a-agent-a', 'phase6a-shared-poison-call');
    const poisonRaw = JSON.stringify(poison);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectRejectedWithoutMutation({
        raw: poisonRaw,
        signature: sign(poisonRaw),
        status: 409,
        code: 'INTEGRATION_OWNERSHIP_CONFLICT',
      });
    }
  });

  test('provider and external network boundaries remain unused', () => {
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
