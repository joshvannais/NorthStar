'use strict';

const db = require('../../db');

const OPERATION_STATES = Object.freeze({
  CLAIMED: 'claimed',
  COMPLETED: 'completed',
  RETRYABLE_FAILED: 'retryable_failed',
  PERMANENT_FAILED: 'permanent_failed',
});

function assertHexDigest(value, name) {
  if (!/^[0-9a-f]{64}$/.test(String(value || ''))) {
    throw new TypeError(`${name} must be a lowercase SHA-256 digest`);
  }
}

function assertUuid(value, name) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))) {
    throw new TypeError(`${name} must be a UUID`);
  }
}

function resolvePool(pool) {
  const resolved = pool || db.getPool();
  if (!resolved || typeof resolved.query !== 'function') {
    const error = new Error('Canonical PostgreSQL persistence is unavailable');
    error.code = 'persistence_unavailable';
    throw error;
  }
  return resolved;
}

async function begin(client) {
  await client.query('BEGIN');
}

async function commit(client) {
  await client.query('COMMIT');
}

async function rollback(client) {
  await client.query('ROLLBACK');
}

async function withTransaction(pool, work) {
  const source = resolvePool(pool);
  const client = typeof source.connect === 'function' ? await source.connect() : source;
  const shouldRelease = client !== source && typeof client.release === 'function';
  try {
    await begin(client);
    const result = await work(client);
    await commit(client);
    return result;
  } catch (error) {
    try {
      await rollback(client);
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}

function leaseDeadline(now, leaseMs) {
  const duration = Number(leaseMs);
  if (!Number.isFinite(duration) || duration < 1000 || duration > 15 * 60 * 1000) {
    throw new TypeError('leaseMs must be between 1000 and 900000 milliseconds');
  }
  return new Date(now.getTime() + duration);
}

async function claimOperation(pool, input) {
  const organizationId = input.organizationId;
  const keyHash = input.keyHash;
  const payloadFingerprint = input.payloadFingerprint;
  const leaseOwner = input.leaseOwner;
  const now = input.now instanceof Date ? input.now : new Date();
  assertUuid(organizationId, 'organizationId');
  assertUuid(leaseOwner, 'leaseOwner');
  assertHexDigest(keyHash, 'keyHash');
  assertHexDigest(payloadFingerprint, 'payloadFingerprint');
  const leaseExpiresAt = leaseDeadline(now, input.leaseMs || 30000);

  return withTransaction(pool, async client => {
    const inserted = await client.query(
      `INSERT INTO canonical_operations
        (organization_id, idempotency_key_hash, payload_fingerprint, state,
         attempt_count, lease_owner, lease_expires_at, claimed_at, expires_at)
       VALUES ($1, $2, $3, 'claimed', 1, $4, $5, $6, $7)
       ON CONFLICT (organization_id, idempotency_key_hash) DO NOTHING
       RETURNING *`,
      [organizationId, keyHash, payloadFingerprint, leaseOwner, leaseExpiresAt, now, input.expiresAt || null]
    );
    if (inserted.rows.length === 1) {
      return { kind: 'claimed', operation: inserted.rows[0] };
    }

    const selected = await client.query(
      `SELECT * FROM canonical_operations
        WHERE organization_id = $1 AND idempotency_key_hash = $2
        FOR UPDATE`,
      [organizationId, keyHash]
    );
    if (selected.rows.length !== 1) {
      const error = new Error('Operation disappeared during claim');
      error.code = 'persistence_unavailable';
      throw error;
    }
    const existing = selected.rows[0];
    if (existing.payload_fingerprint !== payloadFingerprint) {
      return { kind: 'conflict', operation: existing };
    }
    if (existing.state === OPERATION_STATES.COMPLETED) {
      return { kind: 'replay', operation: existing };
    }
    if (existing.state === OPERATION_STATES.PERMANENT_FAILED) {
      return { kind: 'permanent_failure', operation: existing };
    }
    if (existing.state === OPERATION_STATES.CLAIMED && new Date(existing.lease_expires_at) > now) {
      return { kind: 'active', operation: existing };
    }

    const takeover = await client.query(
      `UPDATE canonical_operations
          SET state = 'claimed',
              attempt_count = attempt_count + 1,
              lease_owner = $3,
              lease_expires_at = $4,
              claimed_at = $5,
              safe_error_code = NULL,
              updated_at = $5
        WHERE organization_id = $1
          AND idempotency_key_hash = $2
          AND payload_fingerprint = $6
          AND (state = 'retryable_failed' OR (state = 'claimed' AND lease_expires_at <= $5))
       RETURNING *`,
      [organizationId, keyHash, leaseOwner, leaseExpiresAt, now, payloadFingerprint]
    );
    if (takeover.rows.length === 1) {
      return { kind: 'claimed', takeover: true, operation: takeover.rows[0] };
    }
    return { kind: 'active', operation: existing };
  });
}

async function completeOperation(client, input) {
  assertUuid(input.organizationId, 'organizationId');
  assertUuid(input.operationId, 'operationId');
  assertUuid(input.leaseOwner, 'leaseOwner');
  const result = await client.query(
    `UPDATE canonical_operations
        SET state = 'completed', result_status = $4, result_body = $5::jsonb,
            completed_at = $6, lease_expires_at = $6, updated_at = $6,
            safe_error_code = NULL
      WHERE organization_id = $1 AND id = $2 AND lease_owner = $3 AND state = 'claimed'
      RETURNING *`,
    [input.organizationId, input.operationId, input.leaseOwner, input.resultStatus,
     JSON.stringify(input.resultBody), input.completedAt || new Date()]
  );
  if (result.rows.length !== 1) {
    const error = new Error('Operation completion ownership mismatch');
    error.code = 'operation_ownership_mismatch';
    throw error;
  }
  return result.rows[0];
}

async function failOperation(pool, input) {
  const state = input.retryable ? OPERATION_STATES.RETRYABLE_FAILED : OPERATION_STATES.PERMANENT_FAILED;
  return withTransaction(pool, async client => {
    const result = await client.query(
      `UPDATE canonical_operations
          SET state = $4, safe_error_code = $5, lease_expires_at = $6, updated_at = $6
        WHERE organization_id = $1 AND id = $2 AND lease_owner = $3 AND state = 'claimed'
        RETURNING *`,
      [input.organizationId, input.operationId, input.leaseOwner, state,
       input.safeErrorCode || 'operation_failed', input.failedAt || new Date()]
    );
    if (result.rows.length !== 1) {
      const error = new Error('Operation failure ownership mismatch');
      error.code = 'operation_ownership_mismatch';
      throw error;
    }
    return result.rows[0];
  });
}

async function getOperation(pool, organizationId, operationId) {
  const result = await resolvePool(pool).query(
    `SELECT * FROM canonical_operations WHERE organization_id = $1 AND id = $2`,
    [organizationId, operationId]
  );
  return result.rows[0] || null;
}

async function getGraphByOperationId(pool, organizationId, operationId) {
  const result = await resolvePool(pool).query(
    `SELECT o.id AS operation_id, o.graph_id, o.state AS operation_state,
            c.id AS customer_id, t.id AS transcript_id, cm.id AS communication_id,
            op.id AS opportunity_id, e.id AS estimate_id, a.id AS appointment_id,
            ps.id AS polaris_snapshot_id, ps.calculation_version, ps.snapshot_digest,
            ps.snapshot
       FROM canonical_operations o
       LEFT JOIN canonical_customers c
         ON c.organization_id = o.organization_id AND c.operation_id = o.id
       LEFT JOIN canonical_transcripts t
         ON t.organization_id = o.organization_id AND t.operation_id = o.id
       LEFT JOIN canonical_communications cm
         ON cm.organization_id = o.organization_id AND cm.operation_id = o.id
       LEFT JOIN canonical_opportunities op
         ON op.organization_id = o.organization_id AND op.operation_id = o.id
       LEFT JOIN canonical_estimates e
         ON e.organization_id = o.organization_id AND e.operation_id = o.id
       LEFT JOIN canonical_appointments a
         ON a.organization_id = o.organization_id AND a.operation_id = o.id
       LEFT JOIN canonical_polaris_snapshots ps
         ON ps.organization_id = o.organization_id AND ps.operation_id = o.id
      WHERE o.organization_id = $1 AND o.id = $2`,
    [organizationId, operationId]
  );
  return result.rows[0] || null;
}

module.exports = {
  OPERATION_STATES,
  begin,
  commit,
  rollback,
  withTransaction,
  claimOperation,
  completeOperation,
  failOperation,
  getOperation,
  getGraphByOperationId,
};
