'use strict';

const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');
const db = require('../db');
const safeLogger = require('../observability/safeLogger');
const { sha256, stableValue } = require('../services/businessProfileAdapter');
const {
  buildSimulatedGraph,
  createInitialDemoState,
  tenantIdFromTokenHash,
} = require('./workspace');
const {
  FIXTURE_CONTRACT,
  createDemoWorkspaceFixture,
  validateDemoGraphAgainstWorkspace,
  validateDemoWorkspaceFixture,
} = require('./demoWorkspaceGenerator');
const { DEFAULT_SELECTION, normalizeSelection } = require('./scenarioSpace');

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const SIMULATION_COOLDOWN_MS = 750;
const MAX_MUTATIONS = 24;
const EXPIRED_CLEANUP_LIMIT = 100;
const ADMISSION_HISTORY_MS = 2 * 60 * 60 * 1000;
const ADMISSION_LOCK_KEY = '718842570021';
const GLOBAL_ADMISSION_HASH = '0'.repeat(64);
const MAX_ACTIVE_SESSIONS = 4096;
const MAX_GLOBAL_CREATIONS_PER_MINUTE = 120;
const MAX_SOURCE_CREATIONS_PER_MINUTE = 30;
const DEFAULT_HOUSEKEEPING_INTERVAL_MS = 60 * 1000;
const DEFAULT_HOUSEKEEPING_MAX_BATCHES = 10;
const TOKEN = /^[A-Za-z0-9_-]{43}\.[0-9]{10}$/;

class DemoCommandCenterError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'DemoCommandCenterError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new DemoCommandCenterError(status, code, message);
}

function date(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail(503, 'DEMO_STATE_INVALID', 'The isolated demo state is unavailable.');
  return parsed;
}

function state(value) {
  const seeded = value && value.schemaVersion === 2 && /^[0-9a-f]{64}$/.test(String(value.seed || '')) &&
    Number.isSafeInteger(value.generation) && value.generation >= 1 && value.workspace &&
    value.workspace.contract === FIXTURE_CONTRACT;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !seeded ||
      !Array.isArray(value.graphs) || typeof value.createdAt !== 'string') {
    fail(503, 'DEMO_STATE_INVALID', 'The isolated demo state is unavailable.');
  }
  try {
    const createdAt = date(value.createdAt);
    validateDemoWorkspaceFixture(value.workspace);
    const expectedWorkspace = createDemoWorkspaceFixture({
      seedDigest: value.seed,
      anchorTime: createdAt,
    });
    if (sha256(expectedWorkspace) !== sha256(value.workspace)) {
      throw new Error('The persisted demo workspace disagrees with its seed authority.');
    }
    if (value.graphs.length < 3 || value.graphs.length > 15) {
      throw new Error('The persisted demo graph count is outside the bounded lifecycle.');
    }
    value.graphs.forEach(graph => validateDemoGraphAgainstWorkspace(graph, value.workspace));
    const graphIds = value.graphs.map(graph => graph.ids.graph);
    if (new Set(graphIds).size !== graphIds.length) {
      throw new Error('The persisted demo state contains duplicate graph authority.');
    }
  } catch (_error) {
    fail(503, 'DEMO_STATE_INVALID', 'The isolated demo state is unavailable.');
  }
  return stableValue(value);
}

function legacyState(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    value.schemaVersion === 1 && typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) && Array.isArray(value.graphs));
}

function workspaceSeedForToken(tokenHash) {
  return sha256({ contract: 'northstar_demo_workspace_admission_seed_v1', tokenHash: digest(tokenHash) });
}

function nextWorkspaceSeed(currentState, idempotencyHash) {
  const priorSeed = currentState && /^[0-9a-f]{64}$/.test(String(currentState.seed || ''))
    ? currentState.seed : sha256({ legacyCreatedAt: currentState && currentState.createdAt || null });
  return sha256({
    contract: 'northstar_demo_workspace_reset_seed_v1',
    priorSeed,
    idempotencyHash: digest(idempotencyHash),
  });
}

function revision(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(503, 'DEMO_STATE_INVALID', 'The isolated demo revision is unavailable.');
  return number;
}

function digest(value) {
  const normalized = String(value || '').trim();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    fail(503, 'DEMO_STATE_INVALID', 'The isolated demo digest is unavailable.');
  }
  return normalized;
}

function count(value, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
    fail(503, 'DEMO_STATE_INVALID', 'The isolated demo counter is unavailable.');
  }
  return number;
}

function boundedOption(value, minimum, maximum, fallback) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function admission(value) {
  const sourceHash = value && typeof value.sourceHash === 'string' ? value.sourceHash : '';
  if (!/^[0-9a-f]{64}$/.test(sourceHash)) {
    fail(503, 'DEMO_ADMISSION_UNAVAILABLE', 'The isolated demo admission authority is unavailable.');
  }
  return { sourceHash };
}

function normalizeToken(raw, now) {
  const token = typeof raw === 'string' ? raw : '';
  if (!TOKEN.test(token)) return null;
  const issuedSeconds = Number(token.slice(token.lastIndexOf('.') + 1));
  if (!Number.isSafeInteger(issuedSeconds)) return null;
  const issuedAt = new Date(issuedSeconds * 1000);
  const current = date(now);
  if (issuedAt.getTime() > current.getTime() + 5 * 60 * 1000) return null;
  const expiresAt = new Date(issuedAt.getTime() + TOKEN_LIFETIME_MS);
  if (expiresAt.getTime() <= current.getTime()) return null;
  const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const tenantId = tenantIdFromTokenHash(tokenHash);
  return {
    token,
    tokenHash,
    issuedAt,
    expiresAt,
    tenantId,
    sessionId: uuidv5('command-center-demo-session', tenantId),
  };
}

function issueToken(now = new Date()) {
  const current = date(now);
  const random = crypto.randomBytes(32).toString('base64url');
  const issuedSeconds = Math.floor(current.getTime() / 1000);
  const token = random + '.' + String(issuedSeconds);
  const normalized = normalizeToken(token, current);
  if (!normalized) throw new Error('Failed to issue a bounded demo token.');
  return normalized;
}

function mutationInput(input) {
  if (!input || typeof input !== 'object' || !['simulate_lead', 'reset'].includes(input.operation)) {
    fail(400, 'DEMO_MUTATION_INVALID', 'The demo action is invalid.');
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
    fail(409, 'DEMO_REVISION_REQUIRED', 'Refresh the demo before trying that action again.');
  }
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) {
    fail(400, 'DEMO_IDEMPOTENCY_REQUIRED', 'A bounded idempotency key is required.');
  }
  const normalized = {
    operation: input.operation,
    expectedRevision: input.expectedRevision,
    idempotencyHash: sha256(input.idempotencyKey),
  };
  if (input.operation === 'simulate_lead') {
    const fallback = typeof input.serviceKey === 'string'
      ? { ...DEFAULT_SELECTION, service: input.serviceKey }
      : null;
    const scenarioSelection = normalizeSelection(input.scenarioSelection || fallback);
    if (!scenarioSelection) {
      fail(422, 'DEMO_SCENARIO_INVALID', 'A supported fictional demo scenario is required.');
    }
    normalized.scenarioSelection = scenarioSelection;
  }
  normalized.requestDigest = sha256({
    operation: normalized.operation,
    expectedRevision: normalized.expectedRevision,
    scenarioSelection: normalized.scenarioSelection || null,
  });
  return normalized;
}

function assertRowAuthority(row, token) {
  if (!row || String(row.token_hash).trim() !== token.tokenHash ||
      String(row.tenant_id) !== token.tenantId || String(row.id) !== token.sessionId) {
    fail(503, 'DEMO_STATE_INVALID', 'The isolated demo authority is unavailable.');
  }
}

function recordFromRow(row, token, persisted) {
  if (!row) {
    return {
      token,
      tenantId: token.tenantId,
      sessionId: token.sessionId,
      state: createInitialDemoState(token.tenantId, token.issuedAt, {
        seed: workspaceSeedForToken(token.tokenHash),
      }),
      revision: 1,
      simulationCount: 0,
      mutationCount: 0,
      persisted: false,
      expiresAt: token.expiresAt,
      lastSimulatedAt: null,
    };
  }
  assertRowAuthority(row, token);
  const parsedState = state(row.state);
  const simulationCount = count(row.simulation_count, 12);
  if (parsedState.graphs.length !== simulationCount + 3) {
    fail(503, 'DEMO_STATE_INVALID', 'The isolated demo graph count is unavailable.');
  }
  return {
    token,
    tenantId: token.tenantId,
    sessionId: token.sessionId,
    state: parsedState,
    revision: revision(row.revision),
    simulationCount,
    mutationCount: count(row.mutation_count, MAX_MUTATIONS),
    persisted: persisted !== false,
    expiresAt: date(row.expires_at),
    lastSimulatedAt: row.last_simulated_at ? date(row.last_simulated_at) : null,
  };
}

class DemoCommandCenterRepository {
  constructor(poolProvider = () => db.getPool(), options = {}) {
    this.poolProvider = poolProvider;
    this.clock = typeof options.clock === 'function' ? options.clock : () => new Date();
    this.maxActiveSessions = boundedOption(
      options.maxActiveSessions, 1, MAX_ACTIVE_SESSIONS, MAX_ACTIVE_SESSIONS
    );
    this.maxGlobalCreationsPerMinute = boundedOption(
      options.maxGlobalCreationsPerMinute, 1, MAX_GLOBAL_CREATIONS_PER_MINUTE,
      MAX_GLOBAL_CREATIONS_PER_MINUTE
    );
    this.maxSourceCreationsPerMinute = boundedOption(
      options.maxSourceCreationsPerMinute, 1, MAX_SOURCE_CREATIONS_PER_MINUTE,
      MAX_SOURCE_CREATIONS_PER_MINUTE
    );
  }

  pool() {
    const pool = this.poolProvider();
    if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
      fail(503, 'DEMO_COMMAND_CENTER_UNAVAILABLE', 'The isolated demo is temporarily unavailable.');
    }
    return pool;
  }

  token(raw) {
    return normalizeToken(raw, this.clock());
  }

  issue() {
    return issueToken(this.clock());
  }

  async read(token) {
    const now = date(this.clock());
    const initial = await this.pool().query(
      `SELECT id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
              last_simulated_at, expires_at
         FROM demo_command_center_sessions
        WHERE token_hash = $1 AND expires_at > $2`,
      [token.tokenHash, now]
    );
    if (!initial.rows[0] || !legacyState(initial.rows[0].state)) {
      return recordFromRow(initial.rows[0] || null, token, Boolean(initial.rows[0]));
    }
    const client = await this.pool().connect();
    let open = false;
    try {
      await client.query('BEGIN');
      open = true;
      const result = await client.query(
        `SELECT id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
                last_simulated_at, expires_at
           FROM demo_command_center_sessions
          WHERE token_hash = $1 AND expires_at > $2
          FOR UPDATE`,
        [token.tokenHash, now]
      );
      const normalized = result.rows[0]
        ? await this.normalizePersistedRow(client, result.rows[0], token, now)
        : { row: null, migrated: false };
      const record = recordFromRow(normalized.row, token, Boolean(normalized.row));
      await client.query('COMMIT');
      open = false;
      return record;
    } catch (error) {
      if (open) {
        try { await client.query('ROLLBACK'); } catch (_) {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async normalizePersistedRow(client, row, token, now) {
    assertRowAuthority(row, token);
    if (!legacyState(row.state)) {
      state(row.state);
      return { row, migrated: false };
    }
    const currentRevision = revision(row.revision);
    if (currentRevision >= Number.MAX_SAFE_INTEGER) {
      fail(503, 'DEMO_STATE_INVALID', 'The isolated demo revision is unavailable.');
    }
    const migratedState = createInitialDemoState(token.tenantId, token.issuedAt, {
      seed: workspaceSeedForToken(token.tokenHash),
    });
    await client.query(
      'DELETE FROM demo_command_center_mutations WHERE session_id = $1',
      [token.sessionId]
    );
    const updated = await client.query(
      `UPDATE demo_command_center_sessions
          SET state = $2, revision = $3, simulation_count = 0,
              last_simulated_at = NULL, updated_at = $4
        WHERE id = $1 AND revision = $5 AND state ->> 'schemaVersion' = '1'
        RETURNING id, tenant_id, token_hash, state, revision, simulation_count,
                  mutation_count, last_simulated_at, expires_at`,
      [token.sessionId, migratedState, currentRevision + 1, now, currentRevision]
    );
    if (updated.rowCount !== 1) {
      fail(503, 'DEMO_STATE_INVALID', 'The isolated demo state could not be migrated.');
    }
    state(updated.rows[0].state);
    return { row: updated.rows[0], migrated: true };
  }

  async deleteExpiredBatch(client, now, batchSize) {
    const expiredSessions = await client.query(
      `WITH expired AS (
         SELECT id
           FROM demo_command_center_sessions
          WHERE expires_at <= $1
          ORDER BY expires_at, id
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM demo_command_center_sessions sessions
        USING expired
        WHERE sessions.id = expired.id
       RETURNING sessions.id`,
      [now, batchSize]
    );
    const admissionCutoff = new Date(now.getTime() - ADMISSION_HISTORY_MS);
    const expiredWindows = await client.query(
      `WITH expired AS (
         SELECT window_start, scope, subject_hash
           FROM demo_command_center_admission_windows
          WHERE window_start < $1
          ORDER BY window_start, scope, subject_hash
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM demo_command_center_admission_windows windows
        USING expired
        WHERE windows.window_start = expired.window_start
          AND windows.scope = expired.scope
          AND windows.subject_hash = expired.subject_hash
       RETURNING windows.subject_hash`,
      [admissionCutoff, batchSize]
    );
    return { sessions: expiredSessions.rowCount, admissionWindows: expiredWindows.rowCount };
  }

  async expire(options = {}) {
    const batchSize = boundedOption(options.batchSize, 1, 1000, EXPIRED_CLEANUP_LIMIT);
    const client = await this.pool().connect();
    let open = false;
    try {
      await client.query('BEGIN');
      open = true;
      const result = await this.deleteExpiredBatch(client, date(this.clock()), batchSize);
      await client.query('COMMIT');
      open = false;
      return result;
    } catch (error) {
      if (open) {
        try { await client.query('ROLLBACK'); } catch (_) {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async claimAdmission(client, now, scope, subjectHash, limit) {
    const claimed = await client.query(
      `INSERT INTO demo_command_center_admission_windows
         (window_start, scope, subject_hash, request_count, created_at, updated_at)
       VALUES (date_trunc('minute', $1::timestamptz), $2, $3, 1, $1, $1)
       ON CONFLICT (window_start, scope, subject_hash) DO UPDATE
         SET request_count = demo_command_center_admission_windows.request_count + 1,
             updated_at = EXCLUDED.updated_at
       WHERE demo_command_center_admission_windows.request_count < $4
       RETURNING request_count`,
      [now, scope, subjectHash, limit]
    );
    if (claimed.rowCount !== 1) {
      const code = scope === 'source' ? 'DEMO_SOURCE_RATE_LIMIT' : 'DEMO_GLOBAL_RATE_LIMIT';
      fail(429, code, 'The bounded demo action limit was reached. Try again later.');
    }
  }

  async insertNewSession(client, token, now, sourceHash) {
    await this.deleteExpiredBatch(client, now, EXPIRED_CLEANUP_LIMIT);
    await this.claimAdmission(
      client, now, 'source', sourceHash, this.maxSourceCreationsPerMinute
    );
    await this.claimAdmission(
      client, now, 'global', GLOBAL_ADMISSION_HASH, this.maxGlobalCreationsPerMinute
    );
    const active = await client.query(
      `SELECT count(*)::int AS count
         FROM demo_command_center_sessions
        WHERE expires_at > $1`,
      [now]
    );
    const activeCount = Number(active.rows[0] && active.rows[0].count);
    if (!Number.isSafeInteger(activeCount) || activeCount < 0) {
      fail(503, 'DEMO_STATE_INVALID', 'The isolated demo capacity is unavailable.');
    }
    if (activeCount >= this.maxActiveSessions) {
      fail(429, 'DEMO_CAPACITY_LIMIT', 'The bounded account-free demo is at capacity. Try again later.');
    }
    const initial = createInitialDemoState(token.tenantId, token.issuedAt, {
      seed: workspaceSeedForToken(token.tokenHash),
    });
    await client.query(
      `INSERT INTO demo_command_center_sessions
         (id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
          created_at, updated_at, expires_at)
       VALUES ($1,$2,$3,$4,1,0,0,$5,$5,$6)`,
      [token.sessionId, token.tenantId, token.tokenHash, initial, token.issuedAt, token.expiresAt]
    );
  }

  async mutate(token, rawInput, rawAdmission) {
    const input = mutationInput(rawInput);
    const admitted = admission(rawAdmission);
    const pool = this.pool();
    const client = await pool.connect();
    let open = false;
    try {
      await client.query('BEGIN');
      open = true;
      const now = date(this.clock());
      let locked = await client.query(
        `SELECT id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
                last_simulated_at, expires_at
           FROM demo_command_center_sessions
          WHERE token_hash = $1
          FOR UPDATE`,
        [token.tokenHash]
      );
      if (!locked.rows.length) {
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [ADMISSION_LOCK_KEY]);
        locked = await client.query(
          `SELECT id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
                  last_simulated_at, expires_at
             FROM demo_command_center_sessions
            WHERE token_hash = $1
            FOR UPDATE`,
          [token.tokenHash]
        );
        if (!locked.rows.length) {
          await this.insertNewSession(client, token, now, admitted.sourceHash);
          locked = await client.query(
            `SELECT id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
                    last_simulated_at, expires_at
               FROM demo_command_center_sessions
              WHERE token_hash = $1
              FOR UPDATE`,
            [token.tokenHash]
          );
        }
      }
      const lockedRow = locked.rows[0] || null;
      if (!lockedRow) fail(503, 'DEMO_COMMAND_CENTER_UNAVAILABLE', 'The isolated demo is temporarily unavailable.');
      assertRowAuthority(lockedRow, token);
      if (date(lockedRow.expires_at).getTime() <= now.getTime()) {
        fail(410, 'DEMO_SESSION_EXPIRED', 'This demo session expired. Refresh to start a new isolated preview.');
      }
      const normalized = await this.normalizePersistedRow(client, lockedRow, token, now);
      const current = recordFromRow(normalized.row, token, true);
      if (normalized.migrated) {
        await client.query('COMMIT');
        open = false;
        fail(409, 'DEMO_REVISION_CONFLICT', 'The demo was refreshed to the current fictional workspace. Refresh before trying that action again.');
      }
      const replay = await client.query(
        `SELECT operation, request_digest, response_revision, response_digest
           FROM demo_command_center_mutations
          WHERE session_id = $1 AND idempotency_hash = $2`,
        [current.sessionId, input.idempotencyHash]
      );
      if (replay.rows.length) {
        if (replay.rows[0].operation !== input.operation ||
            digest(replay.rows[0].request_digest) !== input.requestDigest) {
          fail(409, 'DEMO_IDEMPOTENCY_CONFLICT', 'That demo action key was already used for a different action.');
        }
        const replayRevision = revision(replay.rows[0].response_revision);
        const currentDigest = sha256({ state: current.state, revision: current.revision });
        if (replayRevision !== current.revision || digest(replay.rows[0].response_digest) !== currentDigest) {
          fail(409, 'DEMO_IDEMPOTENCY_STALE', 'That demo action was already completed on an earlier workspace revision.');
        }
        await client.query('COMMIT');
        open = false;
        return { record: current, replayed: true };
      }
      if (current.revision !== input.expectedRevision) {
        fail(409, 'DEMO_REVISION_CONFLICT', 'The demo changed in another tab. Refresh before trying that action again.');
      }
      if (current.mutationCount >= MAX_MUTATIONS) {
        fail(429, 'DEMO_SESSION_LIMIT', 'This demo session reached its bounded action limit.');
      }

      let nextState;
      let nextSimulationCount = current.simulationCount;
      let lastSimulatedAt = current.lastSimulatedAt;
      if (input.operation === 'simulate_lead') {
        if (current.simulationCount >= 12) fail(429, 'DEMO_SIMULATION_LIMIT', 'This demo session reached its lead limit.');
        if (lastSimulatedAt && now.getTime() - lastSimulatedAt.getTime() < SIMULATION_COOLDOWN_MS) {
          fail(429, 'DEMO_SIMULATION_RATE_LIMIT', 'Wait briefly before simulating another lead.');
        }
        const key = 'session-lead-' + String(current.revision + 1) + '-' + input.idempotencyHash.slice(0, 12);
        const seededWorkspace = current.state.workspace && current.state.workspace.contract === FIXTURE_CONTRACT
          ? current.state.workspace : null;
        const graph = buildSimulatedGraph({
          tenantId: seededWorkspace ? seededWorkspace.tenant.id : current.tenantId,
          workspace: seededWorkspace,
          key,
          scenarioSelection: input.scenarioSelection,
          createdAt: now,
        });
        nextState = stableValue({ ...current.state, graphs: [graph].concat(current.state.graphs) });
        nextSimulationCount += 1;
        lastSimulatedAt = now;
      } else {
        nextState = createInitialDemoState(current.tenantId, now, {
          seed: nextWorkspaceSeed(current.state, input.idempotencyHash),
          generation: Number.isSafeInteger(current.state.generation) ? current.state.generation + 1 : 2,
        });
        nextSimulationCount = 0;
        lastSimulatedAt = null;
      }
      const nextRevision = current.revision + 1;
      const nextMutationCount = current.mutationCount + 1;
      const responseDigest = sha256({ state: nextState, revision: nextRevision });
      const updated = await client.query(
        `UPDATE demo_command_center_sessions
            SET state = $2, revision = $3, simulation_count = $4, mutation_count = $5,
                last_simulated_at = $6, updated_at = $7
          WHERE id = $1
          RETURNING id, tenant_id, token_hash, state, revision, simulation_count,
                    mutation_count, last_simulated_at, expires_at`,
        [current.sessionId, nextState, nextRevision, nextSimulationCount, nextMutationCount, lastSimulatedAt, now]
      );
      if (updated.rowCount !== 1) fail(503, 'DEMO_COMMAND_CENTER_UNAVAILABLE', 'The isolated demo could not be updated.');
      await client.query(
        `INSERT INTO demo_command_center_mutations
           (session_id, idempotency_hash, operation, request_digest, response_revision, response_digest)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [current.sessionId, input.idempotencyHash, input.operation, input.requestDigest, nextRevision, responseDigest]
      );
      await client.query('COMMIT');
      open = false;
      return { record: recordFromRow(updated.rows[0], token, true), replayed: false };
    } catch (error) {
      if (open) {
        try { await client.query('ROLLBACK'); } catch (_) {}
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

class DemoCommandCenterHousekeepingWorker {
  constructor(options = {}) {
    this.repository = options.repository || new DemoCommandCenterRepository();
    this.intervalMs = boundedOption(
      options.intervalMs, 10000, 3600000, DEFAULT_HOUSEKEEPING_INTERVAL_MS
    );
    this.batchSize = boundedOption(options.batchSize, 1, 1000, EXPIRED_CLEANUP_LIMIT);
    this.maxBatches = boundedOption(
      options.maxBatches, 1, 25, DEFAULT_HOUSEKEEPING_MAX_BATCHES
    );
    this.timer = null;
    this.running = false;
    this.stopped = false;
  }

  async drainOnce() {
    let sessions = 0;
    let admissionWindows = 0;
    for (let batch = 0; batch < this.maxBatches; batch += 1) {
      const expired = await this.repository.expire({ batchSize: this.batchSize });
      if (!expired || !Number.isInteger(expired.sessions) || !Number.isInteger(expired.admissionWindows) ||
          expired.sessions < 0 || expired.sessions > this.batchSize ||
          expired.admissionWindows < 0 || expired.admissionWindows > this.batchSize) {
        throw new Error('Demo command center housekeeping returned invalid counts');
      }
      sessions += expired.sessions;
      admissionWindows += expired.admissionWindows;
      if (expired.sessions < this.batchSize && expired.admissionWindows < this.batchSize) break;
    }
    return { sessions, admissionWindows };
  }

  async tick() {
    if (this.running || this.stopped) return false;
    this.running = true;
    try {
      await this.drainOnce();
    } catch (_error) {
      safeLogger.warn('observability', 'demo_housekeeping_failed');
    } finally {
      this.running = false;
    }
    return true;
  }

  start() {
    if (this.timer || this.stopped) return false;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    void this.tick();
    return true;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  ADMISSION_HISTORY_MS,
  DEFAULT_HOUSEKEEPING_INTERVAL_MS,
  DEFAULT_HOUSEKEEPING_MAX_BATCHES,
  DemoCommandCenterError,
  DemoCommandCenterHousekeepingWorker,
  DemoCommandCenterRepository,
  EXPIRED_CLEANUP_LIMIT,
  MAX_ACTIVE_SESSIONS,
  MAX_GLOBAL_CREATIONS_PER_MINUTE,
  MAX_MUTATIONS,
  MAX_SOURCE_CREATIONS_PER_MINUTE,
  SIMULATION_COOLDOWN_MS,
  TOKEN_LIFETIME_MS,
  issueToken,
  normalizeToken,
  nextWorkspaceSeed,
  workspaceSeedForToken,
};
