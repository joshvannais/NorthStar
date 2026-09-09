'use strict';

const { buildIntelligence, intelligenceError } = require('./intelligence');

// No table/helper grant, migration, provider call, cache, or mutation is added.
// Every content read follows the existing guarded entry in one owned snapshot.
async function readOperationalIntelligence(pool, input) {
  if (!pool || typeof pool.connect !== 'function') throw intelligenceError();
  const client = await pool.connect();
  let authorityLock = false, workLock = false, discard = false;
  const identity = `${input.organizationId}:${input.executionId}`;
  const values = [input.organizationId, input.actorUserId, input.actorAccessRole, input.authSessionId, input.executionId];
  try {
    await client.query("SET statement_timeout='5000ms'");
    await client.query("SET lock_timeout='2000ms'");
    await client.query("SET idle_in_transaction_session_timeout='5000ms'");
    await client.query("SET transaction_timeout='10000ms'");
    await client.query('SELECT pg_advisory_lock_shared(230004,4)'); authorityLock = true;
    await client.query('SELECT pg_advisory_lock_shared(230007,hashtext($1))', [identity]); workLock = true;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
    const entry = async sql => (await client.query(sql, values)).rows[0].result;
    const sources = {};
    // Reauthorizes live tenant, individual account/session, assignment/crew,
    // subscription, execution and positive production transcript source first.
    sources.completion = await entry('SELECT public.canonical_completion_read($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid) AS result');
    const execution = sources.completion?.data?.execution;
    if (!execution || execution.id !== input.executionId) throw intelligenceError();
    sources.labor = await entry('SELECT public.canonical_labor_time_read($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid) AS result');
    sources.materials = await entry('SELECT public.canonical_material_inventory_read($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,0,1) AS result');
    sources.progress = await entry('SELECT public.canonical_progress_read($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,200,NULL,NULL,NULL) AS result');
    sources.fieldEvidence = await entry('SELECT public.canonical_field_evidence_read($1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,200,NULL,NULL,NULL) AS result');
    sources.equipment = await entry('SELECT public.equipment_read($1::uuid,$2::uuid,$3::text,$4::uuid,NULL,$5::uuid) AS result');
    const context = await client.query(`SELECT assignment.id,assignment.appointment_id,assignment.revision,
      rtrim(assignment.canonical_digest) AS digest,assignment.scheduled_start,assignment.scheduled_end,assignment.needs_review,
      transaction_timestamp() AS generated_at
      FROM public.canonical_schedule_assignments assignment
      JOIN public.canonical_appointments appointment ON appointment.organization_id=assignment.organization_id
       AND appointment.id=assignment.appointment_id AND appointment.operation_id=assignment.operation_id
       AND appointment.graph_id=assignment.graph_id AND appointment.opportunity_id=assignment.opportunity_id
      WHERE assignment.organization_id=$1::uuid AND assignment.id=$2::uuid AND appointment.id=$3::uuid`,
    [input.organizationId, execution.assignmentId, execution.appointmentId]);
    if (context.rowCount !== 1) throw intelligenceError();
    const result = buildIntelligence(sources, context.rows[0], input);
    await client.query('COMMIT');
    return result;
  } catch (cause) {
    await client.query('ROLLBACK').catch(() => { discard = true; });
    if (cause?.code === 'OPERATIONAL_INTELLIGENCE_UNAVAILABLE') throw cause;
    if (['42501', 'P0002'].includes(cause?.code)) throw intelligenceError(404);
    if (['40001', '40P01'].includes(cause?.code)) throw intelligenceError(409);
    throw intelligenceError();
  } finally {
    if (workLock) await client.query('SELECT pg_advisory_unlock_shared(230007,hashtext($1))', [identity]).catch(() => { discard = true; });
    if (authorityLock) await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(() => { discard = true; });
    await client.query('RESET ALL').catch(() => { discard = true; });
    client.release(discard);
  }
}

module.exports = { readOperationalIntelligence };
