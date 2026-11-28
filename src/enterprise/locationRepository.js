'use strict';

const db = require('../db');
const { EnterpriseLocationError, normalize, uuid } = require('./locationContract');

function failure(error) {
  if (error instanceof EnterpriseLocationError) return error;
  const status = error && error.code === '42501' ? 403 : error && error.code === 'P0002' ? 404 :
    error && ['40001', '40P01', '23505'].includes(error.code) ? 409 :
      error && ['22023', '22P02', '23514', '22003', '22P05'].includes(error.code) ? 400 : error && error.code === '54000' ? 429 : 503;
  return new EnterpriseLocationError(status, status === 409 ? 'enterprise_location_changed' : 'enterprise_location_unavailable');
}
class EnterpriseLocationRepository {
  constructor(pool) { this.pool = pool || null; }
  requirePool() {
    const pool = this.pool || (db.isAvailable() ? db.getPool() : null);
    if (!pool) throw new EnterpriseLocationError(503); return pool;
  }
  async transaction(write, work) {
    let client;
    try {
      client = await this.requirePool().connect();
      await client.query(write ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='10000ms'");
      await client.query("SET LOCAL lock_timeout='2000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");
      const result = await work(client); await client.query('COMMIT'); return result;
    } catch (error) {
      let discarded = false;
      try { if (client) await client.query('ROLLBACK'); } catch (_rollbackError) { discarded = true; }
      if (client) { client.release(discarded); client = null; }
      throw error;
    } finally { if (client) client.release(); }
  }
  args(input) { return [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId]; }
  async read(input, locationId = null, mode = 'catalogue', beforeRevision = null) {
    try {
      return await this.transaction(false, async client => (await client.query(
        'SELECT public.canonical_enterprise_location_v1_read($1,$2,$3,$4,$5,$6,$7) result',
        [...this.args(input), locationId, mode, beforeRevision])).rows[0].result);
    } catch (error) { throw failure(error); }
  }
  async preview(input, raw) {
    const body = normalize(raw);
    try {
      return await this.transaction(false, async client => (await client.query(
        'SELECT public.canonical_enterprise_location_v1_preview($1,$2,$3,$4,$5,$6::jsonb) result',
        [...this.args(input), input.csrfToken, body])).rows[0].result);
    } catch (error) { throw failure(error); }
  }
  async commit(input, raw, requestKey) {
    const body = normalize(raw, true), key = uuid(requestKey);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.transaction(true, async client => (await client.query(
          'SELECT public.canonical_enterprise_location_v1_commit($1,$2,$3,$4,$5,$6,$7::jsonb) result',
          [...this.args(input), input.csrfToken, key, body])).rows[0].result);
      } catch (error) {
        // Full rollback before one bounded retry with the SAME request key.
        // A committed identical request is replayed after fresh authority checks;
        // a changed head/target/review still denies and never becomes a new write.
        if (attempt === 0 && ['40001', '40P01', '23505'].includes(error && error.code)) continue;
        throw failure(error);
      }
    }
    throw new EnterpriseLocationError(503);
  }
}

module.exports = { EnterpriseLocationRepository, failure };
