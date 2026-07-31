'use strict';

const crypto = require('crypto');
const db = require('../db');
const { hasPermission } = require('../auth/permissions');

const STATE_BYTES = 32;
const STATE_LENGTH = 43;
const STATE_TTL_MS = 10 * 60 * 1000;
const CONSUMED_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_LIMIT = 100;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

class OAuthStatePersistenceError extends Error {
  constructor(cause) {
    super('OAuth authorization state is temporarily unavailable');
    this.name = 'OAuthStatePersistenceError';
    this.code = 'integration_state_unavailable';
    this.cause = cause;
  }
}

function isCanonicalState(value) {
  if (typeof value !== 'string' || value.length !== STATE_LENGTH || !STATE_PATTERN.test(value)) {
    return false;
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length === STATE_BYTES && decoded.toString('base64url') === value;
  } catch (_error) {
    return false;
  }
}

function validateProvider(provider) {
  return typeof provider === 'string' && PROVIDER_PATTERN.test(provider);
}

function hashState(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function newState() {
  return crypto.randomBytes(STATE_BYTES).toString('base64url');
}

function currentExternalAuthority(row) {
  return Boolean(row &&
    row.session_status === 'active' &&
    row.session_revoked_at === null &&
    row.access_current === true &&
    row.refresh_current === true &&
    row.user_status === 'active' &&
    row.membership_status === 'active' &&
    row.onboarding_status === 'complete' &&
    hasPermission(row.role, 'integrations', 'update'));
}

async function cleanup(client) {
  await client.query(
    `WITH stale AS (
       SELECT id
         FROM oauth_authorization_states
        WHERE (status = 'pending' AND expires_at <= NOW())
           OR (status = 'consumed' AND consumed_at <= NOW() - ($1 * INTERVAL '1 millisecond'))
        ORDER BY COALESCE(consumed_at, expires_at), id
        LIMIT $2
        FOR UPDATE SKIP LOCKED
     )
     DELETE FROM oauth_authorization_states state
      USING stale
      WHERE state.id = stale.id`,
    [CONSUMED_RETENTION_MS, CLEANUP_LIMIT]
  );
}

async function withTransaction(work) {
  if (!db.isAvailable()) throw new OAuthStatePersistenceError();
  const pool = db.getPool();
  if (!pool) throw new OAuthStatePersistenceError();
  let client;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;
    const value = await work(client);
    await client.query('COMMIT');
    transactionOpen = false;
    return value;
  } catch (error) {
    if (client && transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* Preserve the original failure. */ }
    }
    if (error instanceof OAuthStatePersistenceError) throw error;
    throw new OAuthStatePersistenceError(error);
  } finally {
    if (client) client.release();
  }
}

async function loadBoundAuthority(client, binding) {
  const result = await client.query(
    `SELECT session.id AS session_id,
            session.user_id,
            session.organization_id,
            session.status AS session_status,
            session.revoked_at AS session_revoked_at,
            (session.access_expires_at > NOW()) AS access_current,
            (session.refresh_expires_at > NOW()) AS refresh_current,
            users.status AS user_status,
            membership.status AS membership_status,
            membership.role,
            onboarding.status AS onboarding_status
       FROM auth_sessions session
       JOIN users
         ON users.id = session.user_id
        AND users.organization_id = session.organization_id
       JOIN organization_memberships membership
         ON membership.id = session.membership_id
        AND membership.user_id = session.user_id
        AND membership.organization_id = session.organization_id
       JOIN organization_onboarding onboarding
         ON onboarding.organization_id = session.organization_id
      WHERE session.id = $1
        AND session.user_id = $2
        AND session.organization_id = $3
      FOR UPDATE OF session, users, membership, onboarding`,
    [binding.sessionId, binding.userId, binding.organizationId]
  );
  return result.rows[0] || null;
}

async function issueAuthorizationState(binding) {
  if (!binding || !validateProvider(binding.provider)) return null;
  const rawState = newState();
  const stateHash = hashState(rawState);
  const issued = await withTransaction(async client => {
    await cleanup(client);
    const authority = await loadBoundAuthority(client, binding);
    if (!currentExternalAuthority(authority)) return false;
    await client.query(
      `INSERT INTO oauth_authorization_states (
         provider, organization_id, user_id, auth_session_id, state_hash
       ) VALUES ($1, $2, $3, $4, $5)`,
      [binding.provider, authority.organization_id, authority.user_id, authority.session_id, stateHash]
    );
    return true;
  });
  return issued ? rawState : null;
}

async function consumeAuthorizationState(input) {
  if (!input || !validateProvider(input.provider) || !isCanonicalState(input.rawState)) return null;
  const stateHash = hashState(input.rawState);
  return withTransaction(async client => {
    await cleanup(client);
    const result = await client.query(
      `SELECT state.id,
              state.provider,
              state.organization_id,
              state.user_id,
              state.auth_session_id AS session_id,
              state.status AS state_status,
              (state.expires_at > NOW()) AS state_current,
              session.status AS session_status,
              session.revoked_at AS session_revoked_at,
              (session.access_expires_at > NOW()) AS access_current,
              (session.refresh_expires_at > NOW()) AS refresh_current,
              users.status AS user_status,
              membership.status AS membership_status,
              membership.role,
              onboarding.status AS onboarding_status
         FROM oauth_authorization_states state
         JOIN auth_sessions session
           ON session.id = state.auth_session_id
          AND session.user_id = state.user_id
          AND session.organization_id = state.organization_id
         JOIN users
           ON users.id = session.user_id
          AND users.organization_id = session.organization_id
         JOIN organization_memberships membership
           ON membership.id = session.membership_id
          AND membership.user_id = session.user_id
          AND membership.organization_id = session.organization_id
         JOIN organization_onboarding onboarding
           ON onboarding.organization_id = session.organization_id
        WHERE state.state_hash = $1
        FOR UPDATE OF state, session, users, membership, onboarding`,
      [stateHash]
    );
    const row = result.rows[0];
    if (!row || row.provider !== input.provider || row.state_status !== 'pending' ||
        row.state_current !== true || row.session_id !== input.sessionId ||
        row.user_id !== input.userId || row.organization_id !== input.organizationId ||
        !currentExternalAuthority(row)) {
      return null;
    }
    const consumed = await client.query(
      `UPDATE oauth_authorization_states
          SET status = 'consumed', consumed_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING user_id, organization_id, auth_session_id`,
      [row.id]
    );
    if (consumed.rowCount !== 1) return null;
    return Object.freeze({
      userId: consumed.rows[0].user_id,
      organizationId: consumed.rows[0].organization_id,
      sessionId: consumed.rows[0].auth_session_id,
    });
  });
}

module.exports = {
  CLEANUP_LIMIT,
  CONSUMED_RETENTION_MS,
  OAuthStatePersistenceError,
  STATE_LENGTH,
  STATE_TTL_MS,
  consumeAuthorizationState,
  isCanonicalState,
  issueAuthorizationState,
};
