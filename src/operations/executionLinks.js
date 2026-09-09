'use strict';
const { normalizeOverviewRead, validateOverviewResponse } = require('./overviewContract');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = 'm23-part9-execution-link-v1';
function linkError(status = 503) {
  return Object.assign(new Error(status === 403 ? 'Execution review is restricted to current owners and administrators.' :
    status === 400 ? 'The execution link request is invalid.' : 'This execution link is temporarily unavailable.'),
  { status, statusCode:status, code:status === 403 ? 'EXECUTION_LINK_RESTRICTED' : status === 400 ? 'INVALID_EXECUTION_LINK' : 'EXECUTION_LINK_UNAVAILABLE' });
}
function normalizeLinkRead(appointmentId, query) {
  if (!query || Array.isArray(query) || Object.keys(query).length !== 2 ||
    Object.keys(query).some(key => !['graphId','customerId'].includes(key)) ||
    [appointmentId,query.graphId,query.customerId].some(value => typeof value !== 'string' || !UUID.test(value))) throw linkError(400);
  return {appointmentId,graphId:query.graphId,customerId:query.customerId};
}
function projection(input, record) {
  return {version:VERSION, state:record ? 'available' : 'unavailable', appointmentId:input.appointmentId,
    graphId:input.graphId, customerId:input.customerId, executionId:record ? record.executionId : null,
    href:record ? '/dashboard/completion-review?executionId=' + record.executionId : null};
}
async function readExecutionLink(pool, input) {
  if (!input || !['owner','admin'].includes(input.actorAccessRole)) throw linkError(403);
  normalizeLinkRead(input.appointmentId,{graphId:input.graphId,customerId:input.customerId});
  if (!pool || typeof pool.connect !== 'function') throw linkError();
  let client;
  try {
    client=await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='2000ms'");
    await client.query("SET LOCAL lock_timeout='1000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='3000ms'");
    await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
    const deadline=Date.now()+8000;
    let query={state:'all',limit:100,cursor:null}, associated=false;
    for(let page=0;page<10 && Date.now()<deadline;page+=1) {
      // Existing SECURITY DEFINER entry revalidates the actor before any
      // association disclosure. Never SELECT private execution tables/helpers.
      const result=await client.query(`SELECT public.canonical_operational_overview_read(
        $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::integer,$7::jsonb) AS result`,
      [input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,
        query.state,query.limit,query.cursor === null ? null : JSON.stringify(query.cursor)]);
      const overview=validateOverviewResponse(result.rows[0] && result.rows[0].result,input.actorAccessRole,query);
      if(page===0) {
        const context=await client.query(`SELECT appointment.id AS appointment_id,appointment.graph_id,customer.id AS customer_id
          FROM public.canonical_appointments appointment
          JOIN public.canonical_opportunities opportunity ON opportunity.organization_id=appointment.organization_id
            AND opportunity.id=appointment.opportunity_id AND opportunity.operation_id=appointment.operation_id
            AND opportunity.graph_id=appointment.graph_id
          JOIN public.canonical_customers customer ON customer.organization_id=opportunity.organization_id
            AND customer.id=opportunity.customer_id
          WHERE appointment.organization_id=$1::uuid AND appointment.id=$2::uuid
            AND appointment.graph_id=$3::uuid AND customer.id=$4::uuid`,
        [input.organizationId,input.appointmentId,input.graphId,input.customerId]);
        associated=context.rowCount===1 && context.rows[0].appointment_id===input.appointmentId &&
          context.rows[0].graph_id===input.graphId && context.rows[0].customer_id===input.customerId;
      }
      const matches=associated ? overview.records.filter(record=>record.appointmentId===input.appointmentId) : [];
      if(matches.length>1) throw linkError();
      if(matches.length===1 || !associated || overview.pagination.nextCursor===null) {
        await client.query('COMMIT'); return projection(input,matches[0] && matches[0].assignment.current ? matches[0] : null);
      }
      query=normalizeOverviewRead({state:'all',limit:'100',cursor:overview.pagination.nextCursor});
    }
    // A bounded miss is not evidence that an execution does not exist.
    await client.query('COMMIT'); return projection(input,null);
  } catch(error) {
    if(client) await client.query('ROLLBACK').catch(()=>{});
    throw linkError(error && (error.code==='42501' || error.status===403) ? 403 : 503);
  } finally {if(client)client.release();}
}
module.exports={normalizeLinkRead,readExecutionLink};
