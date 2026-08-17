'use strict';

const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const safeLogger = require('../observability/safeLogger');
const {
  HomepageWebCallError,
  TOKEN_LIFETIME_MS,
  VERIFIED_PURGE_RECEIPT_LIFETIME_MS,
} = require('./homepageWebCall');

const SOURCE_CALLS_PER_HOUR = 3;
const GLOBAL_CALLS_PER_MINUTE = 12;
const PROJECTION_CALLS_PER_SOURCE_MINUTE = 12;
const PROJECTION_CALLS_GLOBAL_PER_MINUTE = 120;
const PURGE_CALLS_PER_SOURCE_MINUTE = 12;
const PURGE_CALLS_GLOBAL_PER_MINUTE = 120;
const PURGE_ATTEMPTS_PER_CAPABILITY = 3;
const PURGE_LEASE_MS = 2 * 60 * 1000;
const HISTORY_MS = 2 * 60 * 60 * 1000;
const CLEANUP_LIMIT = 256;
const DEFAULT_HOUSEKEEPING_INTERVAL_MS = 60 * 1000;
const DEFAULT_HOUSEKEEPING_MAX_BATCHES = 10;
const GLOBAL_HASH = crypto.createHash('sha256').update('northstar:homepage-web-call:global:v1').digest('hex');
const PROJECTION_GLOBAL_HASH = crypto.createHash('sha256').update('northstar:homepage-polaris:global:v1').digest('hex');
const PURGE_GLOBAL_HASH = crypto.createHash('sha256').update('northstar:homepage-web-call:purge:global:v1').digest('hex');

function failUnavailable() {
  throw new HomepageWebCallError(
    503,
    'homepage_admission_unavailable',
    'The Web Call admission authority is unavailable.'
  );
}

function failVerifiedPurgeRequired() {
  throw new HomepageWebCallError(
    403,
    'homepage_verified_purge_required',
    'A current, unused, same-call verified-deletion receipt is required before Polaris can calculate a result.'
  );
}

function exactHash(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{64}$/.test(normalized)) failUnavailable();
  return normalized;
}

function exactDate(value) {
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(result.getTime())) failUnavailable();
  return result;
}

function boundedOption(value, minimum, maximum, fallback) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function sourceHash(source, secret) {
  const value = typeof source === 'string' ? source.trim() : '';
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 ||
      !value || Buffer.byteLength(value, 'utf8') > 128) {
    throw new HomepageWebCallError(503, 'homepage_admission_unavailable', 'The Web Call admission authority is unavailable.');
  }
  return crypto.createHmac('sha256', secret)
    .update('northstar:homepage-web-call:source:v1\0', 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

class HomepageDemoAdmissionRepository {
  constructor(options = {}) {
    this.pool = options.pool || db.getPool();
    this.now = options.now || function () { return new Date(); };
  }

  requirePool() {
    if (!this.pool || typeof this.pool.connect !== 'function') failUnavailable();
    return this.pool;
  }

  async deleteExpiredBatch(client, now, batchSize) {
    const expiredWindows = await client.query(
      `WITH expired AS (
         SELECT window_start, scope, subject_hash
           FROM homepage_demo_admission_windows
          WHERE window_start < $1
          ORDER BY window_start, scope, subject_hash
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM homepage_demo_admission_windows windows
        USING expired
        WHERE windows.window_start = expired.window_start
          AND windows.scope = expired.scope
          AND windows.subject_hash = expired.subject_hash
       RETURNING windows.subject_hash`,
      [new Date(now.getTime() - HISTORY_MS), batchSize]
    );
    const expiredOperations = await client.query(
      `WITH expired AS (
         SELECT capability_hash
           FROM homepage_demo_purge_operations
          WHERE retire_at <= $1
          ORDER BY retire_at, capability_hash
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM homepage_demo_purge_operations operations
        USING expired
        WHERE operations.capability_hash = expired.capability_hash
       RETURNING operations.capability_hash`,
      [now, batchSize]
    );
    return {
      admissionWindows: expiredWindows.rowCount,
      purgeOperations: expiredOperations.rowCount,
    };
  }

  async expire(options = {}) {
    const batchSize = boundedOption(options.batchSize, 1, 1000, CLEANUP_LIMIT);
    const client = await this.requirePool().connect();
    let open = false;
    try {
      await client.query('BEGIN');
      open = true;
      const result = await this.deleteExpiredBatch(client, exactDate(this.now()), batchSize);
      await client.query('COMMIT');
      open = false;
      return result;
    } catch (error) {
      if (open) {
        try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(client, now, granularity, scope, subjectHash, limit) {
    const result = await client.query(
      `INSERT INTO homepage_demo_admission_windows
         (window_start, scope, subject_hash, request_count, created_at, updated_at)
       VALUES (date_trunc($1, $2::timestamptz), $3, $4, 1, $2, $2)
       ON CONFLICT (window_start, scope, subject_hash) DO UPDATE
         SET request_count = homepage_demo_admission_windows.request_count + 1,
             updated_at = EXCLUDED.updated_at
       WHERE homepage_demo_admission_windows.request_count < $5
       RETURNING request_count`,
      [granularity, now, scope, subjectHash, limit]
    );
    if (result.rowCount !== 1) {
      throw new HomepageWebCallError(429, 'homepage_web_call_rate_limited', 'The bounded Web Call limit was reached. Try again later.');
    }
  }

  async admitClaims(subjectHash, claims) {
    exactHash(subjectHash);
    const client = await this.requirePool().connect();
    let open = false;
    const now = exactDate(this.now());
    try {
      await client.query('BEGIN');
      open = true;
      await this.deleteExpiredBatch(client, now, CLEANUP_LIMIT);
      for (const claim of claims) {
        await this.claim(client, now, claim.granularity, claim.scope, claim.subjectHash, claim.limit);
      }
      await client.query('COMMIT');
      open = false;
      return true;
    } catch (error) {
      if (open) {
        try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async admit(subjectHash) {
    return this.admitClaims(subjectHash, [
      { granularity: 'hour', scope: 'source_hour', subjectHash, limit: SOURCE_CALLS_PER_HOUR },
      { granularity: 'minute', scope: 'global_minute', subjectHash: GLOBAL_HASH, limit: GLOBAL_CALLS_PER_MINUTE },
    ]);
  }

  async admitProjection(subjectHash) {
    return this.admitClaims(subjectHash, [
      {
        granularity: 'minute', scope: 'projection_source_minute', subjectHash,
        limit: PROJECTION_CALLS_PER_SOURCE_MINUTE,
      },
      {
        granularity: 'minute', scope: 'projection_global_minute', subjectHash: PROJECTION_GLOBAL_HASH,
        limit: PROJECTION_CALLS_GLOBAL_PER_MINUTE,
      },
    ]);
  }

  async beginPurge(subjectHashValue, capabilityHashValue, authorityExpiresAtValue,
    projectionRequestedValue) {
    const subjectHash = exactHash(subjectHashValue);
    const capabilityHash = exactHash(capabilityHashValue);
    if (typeof projectionRequestedValue !== 'boolean') failUnavailable();
    const projectionRequested = projectionRequestedValue === true;
    const now = exactDate(this.now());
    if (!Number.isSafeInteger(authorityExpiresAtValue)) failUnavailable();
    const authorityExpiresAt = exactDate(authorityExpiresAtValue);
    if (authorityExpiresAt <= now || authorityExpiresAt.getTime() > now.getTime() + TOKEN_LIFETIME_MS) {
      failUnavailable();
    }
    const leaseExpiresAt = new Date(now.getTime() + PURGE_LEASE_MS);
    const retireAt = new Date(authorityExpiresAt.getTime() + PURGE_LEASE_MS);
    const client = await this.requirePool().connect();
    let open = false;
    try {
      await client.query('BEGIN');
      open = true;
      await this.deleteExpiredBatch(client, now, CLEANUP_LIMIT);
      const inserted = await client.query(
        `INSERT INTO homepage_demo_purge_operations
           (capability_hash, state, attempt_count, lease_expires_at,
            authority_expires_at, retire_at, verified_at, created_at, updated_at,
            projection_permitted)
         VALUES ($1, 'in_progress', 1, $2, $3, $4, NULL, $5, $5, $6)
         ON CONFLICT (capability_hash) DO NOTHING
         RETURNING state, attempt_count, lease_expires_at, authority_expires_at,
                   verified_at, projection_permitted`,
        [capabilityHash, leaseExpiresAt, authorityExpiresAt, retireAt, now, projectionRequested]
      );
      let operation = inserted.rows[0] || null;
      if (!operation) {
        const existing = await client.query(
          `SELECT state, attempt_count, lease_expires_at, authority_expires_at,
                  verified_at, projection_permitted
             FROM homepage_demo_purge_operations
            WHERE capability_hash = $1
            FOR UPDATE`,
          [capabilityHash]
        );
        operation = existing.rows[0] || null;
        if (!operation || exactDate(operation.authority_expires_at).getTime() !== authorityExpiresAt.getTime()) {
          failUnavailable();
        }
        const attemptCount = Number(operation.attempt_count);
        if (!Number.isSafeInteger(attemptCount) || attemptCount < 1 ||
            attemptCount > PURGE_ATTEMPTS_PER_CAPABILITY) {
          failUnavailable();
        }
        if (operation.projection_permitted === true && projectionRequested === false) {
          const revoked = await client.query(
            `UPDATE homepage_demo_purge_operations
                SET projection_permitted = FALSE, updated_at = $2
              WHERE capability_hash = $1
                AND projection_permitted = TRUE
              RETURNING capability_hash`,
            [capabilityHash, now]
          );
          if (revoked.rowCount !== 1) failUnavailable();
          operation = Object.assign({}, operation, { projection_permitted: false });
        }
        if (operation.state === 'verified' || operation.state === 'consumed') {
          await client.query('COMMIT');
          open = false;
          return {
            execute: false,
            verified: true,
            consumed: operation.state === 'consumed',
            attemptCount,
            verifiedAt: exactDate(operation.verified_at).getTime(),
            projectionPermitted: operation.projection_permitted === true,
          };
        }
        if (operation.state !== 'in_progress') failUnavailable();
        if (exactDate(operation.lease_expires_at) > now) {
          throw new HomepageWebCallError(
            409,
            'homepage_purge_in_progress',
            'Verified deletion is already in progress.'
          );
        }
        if (attemptCount >= PURGE_ATTEMPTS_PER_CAPABILITY) {
          throw new HomepageWebCallError(
            429,
            'homepage_purge_retry_limit_reached',
            'The bounded verified deletion retry limit was reached.'
          );
        }
        const retried = await client.query(
          `UPDATE homepage_demo_purge_operations
              SET attempt_count = attempt_count + 1,
                  lease_expires_at = $2,
                  updated_at = $3
            WHERE capability_hash = $1
              AND state = 'in_progress'
            RETURNING attempt_count`,
          [capabilityHash, leaseExpiresAt, now]
        );
        if (retried.rowCount !== 1) failUnavailable();
        operation = Object.assign({}, operation, { attempt_count: retried.rows[0].attempt_count });
      }
      const nextAttemptCount = Number(operation.attempt_count);
      await this.claim(
        client, now, 'minute', 'purge_source_minute', subjectHash, PURGE_CALLS_PER_SOURCE_MINUTE
      );
      await this.claim(
        client, now, 'minute', 'purge_global_minute', PURGE_GLOBAL_HASH, PURGE_CALLS_GLOBAL_PER_MINUTE
      );
      await client.query('COMMIT');
      open = false;
      return {
        execute: true,
        verified: false,
        attemptCount: nextAttemptCount,
        projectionPermitted: operation.projection_permitted === true,
      };
    } catch (error) {
      if (open) {
        try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async completePurge(capabilityHashValue, attemptCount) {
    const capabilityHash = exactHash(capabilityHashValue);
    if (!Number.isInteger(attemptCount) || attemptCount < 1 ||
        attemptCount > PURGE_ATTEMPTS_PER_CAPABILITY) failUnavailable();
    const now = exactDate(this.now());
    const client = await this.requirePool().connect();
    let open = false;
    try {
      await client.query('BEGIN');
      open = true;
      const operation = await client.query(
        `SELECT state, attempt_count, retire_at, verified_at,
                authority_expires_at, projection_permitted
           FROM homepage_demo_purge_operations
          WHERE capability_hash = $1
          FOR UPDATE`,
        [capabilityHash]
      );
      const row = operation.rows[0];
      if (!row || Number(row.attempt_count) !== attemptCount || exactDate(row.retire_at) <= now) {
        failUnavailable();
      }
      if (row.state === 'verified' || row.state === 'consumed') {
        await client.query('COMMIT');
        open = false;
        return {
          verified: true,
          consumed: row.state === 'consumed',
          verifiedAt: exactDate(row.verified_at).getTime(),
          authorityExpiresAt: exactDate(row.authority_expires_at).getTime(),
          projectionPermitted: row.projection_permitted === true,
        };
      }
      if (row.state !== 'in_progress') failUnavailable();
      const completed = await client.query(
        `UPDATE homepage_demo_purge_operations
            SET state = 'verified', lease_expires_at = NULL,
                verified_at = $3, updated_at = $3
          WHERE capability_hash = $1
            AND state = 'in_progress'
            AND attempt_count = $2
          RETURNING verified_at, authority_expires_at, projection_permitted`,
        [capabilityHash, attemptCount, now]
      );
      if (completed.rowCount !== 1) failUnavailable();
      await client.query('COMMIT');
      open = false;
      return {
        verified: true,
        consumed: false,
        verifiedAt: exactDate(completed.rows[0].verified_at).getTime(),
        authorityExpiresAt: exactDate(completed.rows[0].authority_expires_at).getTime(),
        projectionPermitted: completed.rows[0].projection_permitted === true,
      };
    } catch (error) {
      if (open) {
        try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async consumeVerifiedPurgeProjection(subjectHashValue, capabilityHashValue,
    verifiedAtValue, receiptExpiresAtValue) {
    const subjectHash = exactHash(subjectHashValue);
    const capabilityHash = exactHash(capabilityHashValue);
    const now = exactDate(this.now());
    const verifiedAt = exactDate(verifiedAtValue);
    const receiptExpiresAt = exactDate(receiptExpiresAtValue);
    if (verifiedAt > now || receiptExpiresAt <= now || receiptExpiresAt <= verifiedAt ||
        receiptExpiresAt.getTime() - verifiedAt.getTime() > VERIFIED_PURGE_RECEIPT_LIFETIME_MS) {
      failVerifiedPurgeRequired();
    }
    const client = await this.requirePool().connect();
    let open = false;
    try {
      await client.query('BEGIN');
      open = true;
      await this.deleteExpiredBatch(client, now, CLEANUP_LIMIT);
      const consumed = await client.query(
        `UPDATE homepage_demo_purge_operations
            SET state = 'consumed', updated_at = $4
          WHERE capability_hash = $1
            AND state = 'verified'
            AND projection_permitted = TRUE
            AND verified_at = $2
            AND authority_expires_at >= $3
            AND retire_at > $4
          RETURNING capability_hash`,
        [capabilityHash, verifiedAt, receiptExpiresAt, now]
      );
      if (consumed.rowCount !== 1) failVerifiedPurgeRequired();
      await this.claim(
        client, now, 'minute', 'projection_source_minute', subjectHash,
        PROJECTION_CALLS_PER_SOURCE_MINUTE
      );
      await this.claim(
        client, now, 'minute', 'projection_global_minute', PROJECTION_GLOBAL_HASH,
        PROJECTION_CALLS_GLOBAL_PER_MINUTE
      );
      await client.query('COMMIT');
      open = false;
      return true;
    } catch (error) {
      if (open) {
        try { await client.query('ROLLBACK'); } catch (_rollbackError) {}
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async releasePurge(capabilityHashValue, attemptCount) {
    const capabilityHash = exactHash(capabilityHashValue);
    if (!Number.isInteger(attemptCount) || attemptCount < 1 ||
        attemptCount > PURGE_ATTEMPTS_PER_CAPABILITY) failUnavailable();
    const now = exactDate(this.now());
    const client = await this.requirePool().connect();
    try {
      const result = await client.query(
        `UPDATE homepage_demo_purge_operations
            SET lease_expires_at = $3, updated_at = $3
          WHERE capability_hash = $1
            AND state = 'in_progress'
            AND attempt_count = $2
          RETURNING capability_hash`,
        [capabilityHash, attemptCount, now]
      );
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  }
}

class HomepageDemoAdmissionHousekeepingWorker {
  constructor(options = {}) {
    this.repository = options.repository || new HomepageDemoAdmissionRepository();
    this.intervalMs = boundedOption(
      options.intervalMs, 10000, 3600000, DEFAULT_HOUSEKEEPING_INTERVAL_MS
    );
    this.batchSize = boundedOption(options.batchSize, 1, 1000, CLEANUP_LIMIT);
    this.maxBatches = boundedOption(
      options.maxBatches, 1, 25, DEFAULT_HOUSEKEEPING_MAX_BATCHES
    );
    this.timer = null;
    this.running = false;
    this.stopped = false;
  }

  async drainOnce() {
    let admissionWindows = 0;
    let purgeOperations = 0;
    for (let batch = 0; batch < this.maxBatches; batch += 1) {
      const expired = await this.repository.expire({ batchSize: this.batchSize });
      if (!expired || !Number.isInteger(expired.admissionWindows) ||
          !Number.isInteger(expired.purgeOperations) || expired.admissionWindows < 0 ||
          expired.admissionWindows > this.batchSize || expired.purgeOperations < 0 ||
          expired.purgeOperations > this.batchSize) {
        throw new Error('Homepage demo admission housekeeping returned invalid counts');
      }
      admissionWindows += expired.admissionWindows;
      purgeOperations += expired.purgeOperations;
      if (expired.admissionWindows < this.batchSize && expired.purgeOperations < this.batchSize) break;
    }
    return { admissionWindows, purgeOperations };
  }

  async tick() {
    if (this.running || this.stopped) return false;
    this.running = true;
    try {
      await this.drainOnce();
    } catch (_error) {
      safeLogger.warn('observability', 'homepage_demo_admission_housekeeping_failed');
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

function configuredSourceHash(source) {
  return sourceHash(source, config.auth.accessSecret);
}

module.exports = {
  CLEANUP_LIMIT,
  DEFAULT_HOUSEKEEPING_INTERVAL_MS,
  DEFAULT_HOUSEKEEPING_MAX_BATCHES,
  GLOBAL_CALLS_PER_MINUTE,
  HISTORY_MS,
  HomepageDemoAdmissionHousekeepingWorker,
  HomepageDemoAdmissionRepository,
  SOURCE_CALLS_PER_HOUR,
  PROJECTION_CALLS_GLOBAL_PER_MINUTE,
  PROJECTION_CALLS_PER_SOURCE_MINUTE,
  PURGE_CALLS_GLOBAL_PER_MINUTE,
  PURGE_CALLS_PER_SOURCE_MINUTE,
  PURGE_ATTEMPTS_PER_CAPABILITY,
  PURGE_LEASE_MS,
  configuredSourceHash,
  sourceHash,
};
