'use strict';

const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const { HomepageWebCallError } = require('./homepageWebCall');

const SOURCE_CALLS_PER_HOUR = 3;
const GLOBAL_CALLS_PER_MINUTE = 12;
const PROJECTION_CALLS_PER_SOURCE_MINUTE = 12;
const PROJECTION_CALLS_GLOBAL_PER_MINUTE = 120;
const PURGE_CALLS_PER_SOURCE_MINUTE = 12;
const PURGE_CALLS_GLOBAL_PER_MINUTE = 120;
const HISTORY_MS = 2 * 60 * 60 * 1000;
const CLEANUP_LIMIT = 256;
const GLOBAL_HASH = crypto.createHash('sha256').update('northstar:homepage-web-call:global:v1').digest('hex');
const PROJECTION_GLOBAL_HASH = crypto.createHash('sha256').update('northstar:homepage-polaris:global:v1').digest('hex');
const PURGE_GLOBAL_HASH = crypto.createHash('sha256').update('northstar:homepage-web-call:purge:global:v1').digest('hex');

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
    if (!this.pool || typeof this.pool.connect !== 'function' || !/^[0-9a-f]{64}$/.test(subjectHash || '')) {
      throw new HomepageWebCallError(503, 'homepage_admission_unavailable', 'The Web Call admission authority is unavailable.');
    }
    const client = await this.pool.connect();
    let open = false;
    const now = this.now();
    try {
      await client.query('BEGIN');
      open = true;
      await client.query(
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
            AND windows.subject_hash = expired.subject_hash`,
        [new Date(now.getTime() - HISTORY_MS), CLEANUP_LIMIT]
      );
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

  async admitPurge(subjectHash) {
    return this.admitClaims(subjectHash, [
      {
        granularity: 'minute', scope: 'purge_source_minute', subjectHash,
        limit: PURGE_CALLS_PER_SOURCE_MINUTE,
      },
      {
        granularity: 'minute', scope: 'purge_global_minute', subjectHash: PURGE_GLOBAL_HASH,
        limit: PURGE_CALLS_GLOBAL_PER_MINUTE,
      },
    ]);
  }
}

function configuredSourceHash(source) {
  return sourceHash(source, config.auth.accessSecret);
}

module.exports = {
  CLEANUP_LIMIT,
  GLOBAL_CALLS_PER_MINUTE,
  HISTORY_MS,
  HomepageDemoAdmissionRepository,
  SOURCE_CALLS_PER_HOUR,
  PROJECTION_CALLS_GLOBAL_PER_MINUTE,
  PROJECTION_CALLS_PER_SOURCE_MINUTE,
  PURGE_CALLS_GLOBAL_PER_MINUTE,
  PURGE_CALLS_PER_SOURCE_MINUTE,
  configuredSourceHash,
  sourceHash,
};
