'use strict';
const { resolveIntegrationOwner, getActiveBusinessProfile } = require('../services/organizationAuthority');
const voices = require('../services/voiceSessionAuthority');
const { projectSubscription, canPerformExternal } = require('../accounts/subscriptionPolicy');
const { digest } = require('./groundedConversation');
const policy = require('./connectedPolicy');
function denied(status=403){throw Object.assign(new Error('Current call guidance is unavailable. The owner can review the job details.'),{statusCode:status,code:'POLARIS_CALL_UNAVAILABLE'});}
function createConnectedCallRepository(getPool){
 async function transaction(write,fn){const client=await getPool().connect();try{await client.query(write?'BEGIN ISOLATION LEVEL SERIALIZABLE':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL statement_timeout='5000ms'");await client.query("SET LOCAL lock_timeout='1000ms'");const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
 async function current(client,identity,write=false){
  if(!policy.callGuidanceEnabled)denied(503);
  const ownership=await resolveIntegrationOwner(client,'retell',identity.agentId);
  if(write){const locked=await client.query("SELECT id FROM canonical_integration_ownership WHERE id=$1 AND status='active' FOR SHARE",[ownership.id]);if(locked.rowCount!==1)denied();}
  const session=(await client.query('SELECT * FROM canonical_voice_sessions WHERE organization_id=$1 AND external_session_id=$2'+(write?' FOR UPDATE':''),[ownership.organizationId,identity.callId])).rows[0];
  if(!session||session.integration_ownership_id!==ownership.id||session.provider!=='retell'||session.provider_session_id!==identity.callId||session.status!=='active'||session.canonical_operation_id)denied();
  const now=(await client.query('SELECT clock_timestamp() now')).rows[0].now;
  const expiresAt=new Date(session.started_at).getTime()+2*60*60*1000;if(expiresAt<=new Date(now).getTime())denied();
  const subscription=(await client.query('SELECT plan_type,status subscription_status,trial_started_at,trial_ends_at,clock_timestamp() server_now FROM subscriptions WHERE organization_id=$1',[ownership.organizationId])).rows[0];
  if(!canPerformExternal(projectSubscription(subscription))||!['Growth','Complete'].includes(subscription?.plan_type))denied();
  const profile=await getActiveBusinessProfile(client,ownership.organizationId);
  if(profile.id!==session.business_profile_id||profile.profileHash!==session.business_profile_hash)denied(409);
  let projection;await client.query('SAVEPOINT caller_knowledge');
  try{projection=(await client.query("SELECT public.canonical_knowledge_sync_expected_projection($1,'voice_runtime','customer',$2::jsonb,16,8192,'latest','[]'::jsonb) value",[ownership.organizationId,JSON.stringify(['identity','services','customer_guidance','voice_guidance'])])).rows[0].value;await client.query('RELEASE SAVEPOINT caller_knowledge');}
  catch(e){if(e.constraint!=='canonical_knowledge_sync_projection_complete')throw e;await client.query('ROLLBACK TO SAVEPOINT caller_knowledge');await client.query('RELEASE SAVEPOINT caller_knowledge');projection={items:[],sources:[],missing:true};}
  const evidence=(projection.items||[]).map((item,i)=>({id:'published_'+i,label:'Published Caller Guidance',value:item,source:projection.sources}));
  if(projection.missing)evidence.push({id:'knowledge_unknown',label:'Business Guidance Not Recorded',value:'Complete published caller guidance is unavailable. Ask the owner for technical details; do not infer business capabilities.',source:{state:'unknown'}});
  const turns=(await client.query("SELECT id,payload FROM canonical_voice_session_events WHERE organization_id=$1 AND voice_session_id=$2 AND event_type IN('transcript','transcript_ready') ORDER BY occurred_at DESC,id DESC LIMIT 8",[ownership.organizationId,session.id])).rows;
  // Exact same-call transcript facts remain untrusted data, never authorization.
  for(const turn of turns){const text=turn.payload&&turn.payload.text;if(typeof text==='string'&&text.length<=1500)evidence.push({id:'call_'+turn.id,label:'This Caller’s Recorded Words',value:text,source:{voiceSessionId:session.id,eventId:turn.id}});}
  if(expiresAt<=new Date((await client.query('SELECT clock_timestamp() now')).rows[0].now).getTime())denied();
  return {organizationId:ownership.organizationId,voiceSessionId:session.id,callId:identity.callId,agentId:identity.agentId,audience:'caller',state:'active',expiresAt,ownershipId:ownership.id,profile:{id:profile.id,hash:profile.profileHash},subscription:{plan:subscription.plan_type,state:subscription.subscription_status,trialEnd:subscription.trial_ends_at},evidence};
 }
 async function loadCurrent(identity){return transaction(false,client=>current(client,identity));}
 async function readRecorded({identity,key,basis}){return transaction(false,async client=>{const context=await current(client,identity);if(digest(context)!==basis)denied(409);const row=(await client.query("SELECT payload FROM canonical_voice_session_events WHERE organization_id=$1 AND voice_session_id=$2 AND external_event_id=$3 AND event_type='grounded_tool'",[context.organizationId,context.voiceSessionId,'grounded:'+key])).rows[0];if(!row){const count=(await client.query("SELECT count(*)::int n FROM canonical_voice_session_events WHERE organization_id=$1 AND voice_session_id=$2 AND event_type='grounded_tool'",[context.organizationId,context.voiceSessionId])).rows[0].n;if(count>=32)denied(429);}return row?.payload?.response||null;});}
 async function record(input){return transaction(true,async client=>{const context=await current(client,input.identity,true);if(digest(context)!==input.basis)denied(409);const payload={basis:input.basis,requestDigest:input.requestDigest,response:input.response};if(Buffer.byteLength(JSON.stringify(payload))>16384)denied(413);
  const existing=await client.query('SELECT id FROM canonical_voice_session_events WHERE organization_id=$1 AND voice_session_id=$2 AND external_event_id=$3',[context.organizationId,context.voiceSessionId,'grounded:'+input.key]);
  const count=(await client.query("SELECT count(*)::int n FROM canonical_voice_session_events WHERE organization_id=$1 AND voice_session_id=$2 AND event_type='grounded_tool'",[context.organizationId,context.voiceSessionId])).rows[0].n;if(!existing.rowCount&&count>=32)denied(429);
  await voices.appendEventWithClient(client,{organizationId:context.organizationId,externalSessionId:context.callId,externalEventId:'grounded:'+input.key,eventType:'grounded_tool',payload,requireSemanticMatch:true});
 });}
 return {loadCurrent,readRecorded,record};
}
module.exports={createConnectedCallRepository};
