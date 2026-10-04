'use strict';

class CapacityAdvisoryContinuationWorker {
  constructor({ getPool, intervalMs = 1000, batchSize = 10 } = {}) {
    if (typeof getPool !== 'function') {
      throw new TypeError('Capacity advisory continuation worker requires a database pool getter');
    }
    this.getPool = getPool;
    this.intervalMs = Number.isInteger(intervalMs) && intervalMs >= 250 && intervalMs <= 60000
      ? intervalMs : 1000;
    this.batchSize = Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 25
      ? batchSize : 10;
    this.running = false;
    this.stopped = true;
    this.timer = null;
  }

  async transaction(callback) {
    const pool = this.getPool();
    if (!pool) return null;
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("SET LOCAL statement_timeout='15000ms'");
      await client.query("SET LOCAL lock_timeout='5000ms'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout='15000ms'");
      const value = await callback(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => { discard = true; });
      throw error;
    } finally {
      client.release(discard);
    }
  }

  async drainOnce() {
    const pool = this.getPool();
    if (!pool) return { due: 0, attempted: 0 };
    let attempted = 0;
    const excluded = [];
    for (let index = 0; index < this.batchSize; index += 1) {
      let claimed;
      try {
        claimed = await this.transaction(async client => {
          return (await client.query(
            'SELECT organization_id,continuation_id FROM public.canonical_forecast_capacity_advisory_v1_continuation_claim_due($1)',
            [excluded]
          )).rows[0] || null;
        });
        if (!claimed) break;
        excluded.push(`${claimed.organization_id}:${claimed.continuation_id}`);
        attempted += 1;
        try {
          await this.transaction(async client => {
            await client.query(
              'SELECT public.canonical_forecast_capacity_advisory_v1_continuation_activate($1,$2)',
              [claimed.organization_id, claimed.continuation_id]
            );
          });
        } catch (_error) {
          // The committed private retry lease preserves deterministic retry and
          // lets this drain continue without exposing tenant failure details.
        }
      } catch (_error) {
        // A pre-claim failure supplies no durable identity to exclude. Stop the
        // bounded drain without logging source or tenant details.
        break;
      }
    }
    return { due: attempted, attempted };
  }

  async tick() {
    if (this.running || this.stopped) return false;
    this.running = true;
    try {
      await this.drainOnce();
    } catch (_error) {
      // Durable reservations and idempotent activation preserve retry without logging tenant data.
    } finally {
      this.running = false;
    }
    return true;
  }

  start() {
    if (!this.stopped) return false;
    this.stopped = false;
    const next = async () => {
      if (this.stopped) return;
      await this.tick();
      if (!this.stopped) {
        this.timer = setTimeout(next, this.intervalMs);
        this.timer.unref?.();
      }
    };
    this.timer = setTimeout(next, this.intervalMs);
    this.timer.unref?.();
    return true;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = { CapacityAdvisoryContinuationWorker };
