'use strict';

const { error } = require('./contract');
function mapped(cause) {
  if (cause && cause.status) return cause;
  if (cause && ['40001', '40P01', '23505'].includes(cause.code)) return error(409, 'EQUIPMENT_CONFLICT', 'Equipment or research changed. Reload and review before trying again.');
  if (cause && cause.code === '42501') return error(403, 'EQUIPMENT_FORBIDDEN', 'Current equipment access is unavailable.');
  if (cause && ['22023', '22P02', '22007', '22008', '23514'].includes(cause.code)) return error(400, 'EQUIPMENT_INPUT_INVALID', 'Equipment evidence could not be accepted. Check the fields and source versions.');
  if (cause && cause.code === '54000') return error(429, 'EQUIPMENT_LIMIT', 'The bounded equipment limit was reached. Review existing records first.');
  return error(503, 'EQUIPMENT_UNAVAILABLE', 'Equipment authority is temporarily unavailable. No success is confirmed.');
}
class EquipmentRepository {
  constructor(pool) { this.pool = pool; }
  async transaction(work, write) {
    if (!this.pool || typeof this.pool.connect !== 'function') throw mapped();
    const client = await this.pool.connect();
    let locked = false;
    try {
      await client.query("SET statement_timeout='10000ms'");
      await client.query("SET lock_timeout='2000ms'");
      await client.query("SET idle_in_transaction_session_timeout='10000ms'");
      await client.query('SELECT pg_advisory_lock_shared(230004,4)'); locked = true;
      await client.query(write ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN ISOLATION LEVEL REPEATABLE READ');
      await client.query('SET LOCAL search_path=pg_catalog,public');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => {});
      throw mapped(cause);
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(() => {});
      await client.query('RESET ALL').catch(() => {});
      client.release();
    }
  }
  values(actor) { return [actor.organizationId, actor.userId, actor.role, actor.sessionId]; }
  async mutate(actor, subjectId, key, input, operation = false, suggested = {}, admission = false) {
    return this.transaction(async client => {
      const routine = operation ? 'equipment_operation_mutate' : 'equipment_draft_mutate';
      const result = await client.query(`SELECT public.${routine}($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::text,$8::jsonb${operation ? '' : ',$9::jsonb,$10::boolean'}) AS result`,
        [...this.values(actor), actor.csrfToken, subjectId, key, JSON.stringify(input), ...(operation ? [] : [JSON.stringify(suggested), admission])]);
      return result.rows[0].result;
    }, true);
  }
  async read(actor, draftId = null, executionId = null) {
    return this.transaction(async client => {
      const result = await client.query('SELECT public.equipment_read($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::uuid) AS result',
        [...this.values(actor), draftId, executionId]);
      return result.rows[0].result;
    }, false);
  }
}
module.exports = { EquipmentRepository, mapped };
