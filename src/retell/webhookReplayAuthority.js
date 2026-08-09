'use strict';

const crypto = require('crypto');
const db = require('../db');

const CLAIM_LEASE_MS = 60 * 1000;
const REPLAY_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_REPLAY_ENTRIES = 10000;
const REPLAY_LOCK_NAMESPACE = 'northstar:retell-webhook-replay:v1';
const FINGERPRINT_DOMAIN = Buffer.from('northstar:retell-webhook-replay:v1\0', 'utf8');
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class WebhookReplayPersistenceError extends Error {
  constructor(cause) {
    super('Retell webhook replay protection is unavailable');
    this.name = 'WebhookReplayPersistenceError';
    this.code = 'webhook_replay_persistence_unavailable';
    this.cause = cause;
  }
}

function requestFingerprint(rawBody) {
  if (!Buffer.isBuffer(rawBody)) throw new TypeError('rawBody must be a Buffer');
  return crypto.createHash('sha256').update(FINGERPRINT_DOMAIN).update(rawBody).digest('hex');
}

function assertFingerprint(value) {
  if (!HEX_DIGEST.test(String(value || ''))) {
    throw new TypeError('requestFingerprint must be a lowercase SHA-256 digest');
  }
}

function assertClaimToken(value) {
  if (!UUID.test(String(value || ''))) throw new TypeError('claimToken must be a UUID');
}

function resolvePool(pool) {
  const resolved = pool || db.getPool();
  if (!resolved || typeof resolved.connect !== 'function') {
    throw new WebhookReplayPersistenceError();
  }
  return resolved;
}

async function withTransaction(pool, work) {
  const client = await resolvePool(pool).connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const result = await work(client);
    await client.query('COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* Preserve the original failure. */ }
    }
    if (error instanceof WebhookReplayPersistenceError) throw error;
    throw new WebhookReplayPersistenceError(error);
  } finally {
    client.release();
  }
}

async function claimWebhookDelivery(input, options = {}) {
  const fingerprint = input && input.requestFingerprint;
  assertFingerprint(fingerprint);
  const claimToken = crypto.randomUUID();
  const pool = options.pool;

  return withTransaction(pool, async client => {
    // The durable row remembers accepted requests. This short transaction lock
    // only serializes cleanup, capacity, and claim decisions across processes.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [REPLAY_LOCK_NAMESPACE]
    );
    await client.query(
      `DELETE FROM retell_webhook_replay_claims
        WHERE expires_at <= NOW()
           OR (state = 'claimed' AND lease_expires_at <= NOW())`
    );

    const existing = await client.query(
      `SELECT state FROM retell_webhook_replay_claims
        WHERE request_fingerprint = $1`,
      [fingerprint]
    );
    if (existing.rows.length > 0) return { kind: 'replay' };

    const capacity = await client.query(
      'SELECT count(*)::int AS count FROM retell_webhook_replay_claims'
    );
    if (capacity.rows[0].count >= MAX_REPLAY_ENTRIES) return { kind: 'saturated' };

    const inserted = await client.query(
      `INSERT INTO retell_webhook_replay_claims
        (request_fingerprint, state, claim_token, claimed_at,
         lease_expires_at, expires_at, created_at, updated_at)
       VALUES
        ($1, 'claimed', $2, NOW(),
         NOW() + ($3 * INTERVAL '1 millisecond'),
         NOW() + ($4 * INTERVAL '1 millisecond'), NOW(), NOW())
       RETURNING request_fingerprint`,
      [fingerprint, claimToken, CLAIM_LEASE_MS, REPLAY_RETENTION_MS]
    );
    if (inserted.rows.length !== 1) {
      throw new WebhookReplayPersistenceError();
    }
    return { kind: 'claimed', claimToken };
  });
}

async function releaseWebhookDelivery(input, options = {}) {
  const fingerprint = input && input.requestFingerprint;
  const claimToken = input && input.claimToken;
  assertFingerprint(fingerprint);
  assertClaimToken(claimToken);
  try {
    const result = await resolvePool(options.pool).query(
      `DELETE FROM retell_webhook_replay_claims
        WHERE request_fingerprint = $1
          AND claim_token = $2
          AND state = 'claimed'`,
      [fingerprint, claimToken]
    );
    return result.rowCount === 1;
  } catch (error) {
    if (error instanceof WebhookReplayPersistenceError) throw error;
    throw new WebhookReplayPersistenceError(error);
  }
}

async function acceptWebhookDelivery(input, options = {}) {
  const fingerprint = input && input.requestFingerprint;
  const claimToken = input && input.claimToken;
  assertFingerprint(fingerprint);
  assertClaimToken(claimToken);
  try {
    const result = await resolvePool(options.pool).query(
      `UPDATE retell_webhook_replay_claims
          SET state = 'accepted',
              accepted_at = NOW(),
              lease_expires_at = NULL,
              expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
              updated_at = NOW()
        WHERE request_fingerprint = $1
          AND claim_token = $2
          AND state = 'claimed'`,
      [fingerprint, claimToken, REPLAY_RETENTION_MS]
    );
    return result.rowCount === 1;
  } catch (error) {
    if (error instanceof WebhookReplayPersistenceError) throw error;
    throw new WebhookReplayPersistenceError(error);
  }
}

module.exports = {
  CLAIM_LEASE_MS,
  MAX_REPLAY_ENTRIES,
  REPLAY_RETENTION_MS,
  WebhookReplayPersistenceError,
  acceptWebhookDelivery,
  claimWebhookDelivery,
  releaseWebhookDelivery,
  requestFingerprint,
};
