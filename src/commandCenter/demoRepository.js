'use strict';

const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');
const db = require('../db');
const { sha256, stableValue } = require('../services/businessProfileAdapter');
const {
  buildSimulatedGraph,
  createInitialDemoState,
  tenantIdFromTokenHash,
} = require('./workspace');

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const SIMULATION_COOLDOWN_MS = 750;
const MAX_MUTATIONS = 24;
const EXPIRED_CLEANUP_LIMIT = 100;
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
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 ||
      !Array.isArray(value.graphs) || typeof value.createdAt !== 'string') {
    fail(503, 'DEMO_STATE_INVALID', 'The isolated demo state is unavailable.');
  }
  return stableValue(value);
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
    if (typeof input.serviceKey !== 'string' || input.serviceKey !== input.serviceKey.trim().toLowerCase()) {
      fail(422, 'DEMO_SCENARIO_INVALID', 'A supported fictional demo scenario is required.');
    }
    normalized.serviceKey = input.serviceKey;
  }
  normalized.requestDigest = sha256({
    operation: normalized.operation,
    expectedRevision: normalized.expectedRevision,
    serviceKey: normalized.serviceKey || null,
  });
  return normalized;
}

function recordFromRow(row, token, persisted) {
  if (!row) {
    return {
      token,
      tenantId: token.tenantId,
      sessionId: token.sessionId,
      state: createInitialDemoState(token.tenantId, token.issuedAt),
      revision: 1,
      simulationCount: 0,
      mutationCount: 0,
      persisted: false,
      expiresAt: token.expiresAt,
      lastSimulatedAt: null,
    };
  }
  if (String(row.token_hash).trim() !== token.tokenHash || String(row.tenant_id) !== token.tenantId ||
      String(row.id) !== token.sessionId) {
    fail(503, 'DEMO_STATE_INVALID', 'The isolated demo authority is unavailable.');
  }
  return {
    token,
    tenantId: token.tenantId,
    sessionId: token.sessionId,
    state: state(row.state),
    revision: revision(row.revision),
    simulationCount: count(row.simulation_count, 12),
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
    const result = await this.pool().query(
      `SELECT id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
              last_simulated_at, expires_at
         FROM demo_command_center_sessions
        WHERE token_hash = $1 AND expires_at > $2`,
      [token.tokenHash, this.clock()]
    );
    return recordFromRow(result.rows[0] || null, token, Boolean(result.rows[0]));
  }

  async mutate(token, rawInput) {
    const input = mutationInput(rawInput);
    const pool = this.pool();
    const client = await pool.connect();
    let open = false;
    try {
      await client.query('BEGIN');
      open = true;
      const now = date(this.clock());
      await client.query(
        `DELETE FROM demo_command_center_sessions
          WHERE id IN (
            SELECT id
             FROM demo_command_center_sessions
             WHERE expires_at <= $1
             ORDER BY expires_at, id
             LIMIT $2
             FOR UPDATE SKIP LOCKED
          )`,
        [now, EXPIRED_CLEANUP_LIMIT]
      );
      const initial = createInitialDemoState(token.tenantId, token.issuedAt);
      await client.query(
        `INSERT INTO demo_command_center_sessions
           (id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
            created_at, updated_at, expires_at)
         VALUES ($1,$2,$3,$4,1,0,0,$5,$5,$6)
         ON CONFLICT (token_hash) DO NOTHING`,
        [token.sessionId, token.tenantId, token.tokenHash, initial, token.issuedAt, token.expiresAt]
      );
      const locked = await client.query(
        `SELECT id, tenant_id, token_hash, state, revision, simulation_count, mutation_count,
                last_simulated_at, expires_at
           FROM demo_command_center_sessions
          WHERE token_hash = $1
          FOR UPDATE`,
        [token.tokenHash]
      );
      const current = recordFromRow(locked.rows[0] || null, token, true);
      if (current.expiresAt.getTime() <= now.getTime()) {
        fail(410, 'DEMO_SESSION_EXPIRED', 'This demo session expired. Refresh to start a new isolated preview.');
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
        const graph = buildSimulatedGraph({
          tenantId: current.tenantId,
          key,
          serviceKey: input.serviceKey,
          createdAt: now,
        });
        nextState = stableValue({ ...current.state, graphs: [graph].concat(current.state.graphs) });
        nextSimulationCount += 1;
        lastSimulatedAt = now;
      } else {
        nextState = createInitialDemoState(current.tenantId, now);
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

module.exports = {
  DemoCommandCenterError,
  DemoCommandCenterRepository,
  EXPIRED_CLEANUP_LIMIT,
  MAX_MUTATIONS,
  SIMULATION_COOLDOWN_MS,
  TOKEN_LIFETIME_MS,
  issueToken,
  normalizeToken,
};
