'use strict';
const {digest,VERSION}=require('./groundedConversation');
const {createConnectedCallRepository}=require('./connectedCallRepository');
const policy=require('./connectedPolicy');
function unavailable(){throw Object.assign(new Error('Call guidance is unavailable. Ask the owner to review these details.'),{statusCode:503});}
function createProductionCallGenerate(environment=process.env,{getPool,runtime}={}){
 if(environment.POLARIS_CALL_GUIDANCE_ENABLED!=='true'||environment.POLARIS_GROUNDED_V2_ENABLED!=='true')return null;
 if(typeof getPool!=='function'||runtime?.kind!=='openai')unavailable();
 const repo=createConnectedCallRepository(getPool),controllers=new Set();let stopped=false;
 async function query(sql,args){const c=await getPool().connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5000ms'");await c.query("SET LOCAL lock_timeout='1000ms'");const r=await c.query(sql,args);await c.query('COMMIT');return r.rows[0].value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 const generate=async({question,context,signal})=>{
  if(stopped||!policy.callGuidanceEnabled||!policy.generationEnabled||signal?.aborted)unavailable();
  const identity={callId:context.callId,agentId:context.agentId},basis=digest(context);const current=await repo.loadCurrent(identity);if(digest(current)!==basis)unavailable();
  const key=digest({identity,question,basis});
  // This selected identity is private to caller validation, not a new appointment/graph.
  const envelope={purpose:'caller_guidance',schemaVersion:VERSION,requestId:key,authority:{organizationId:current.organizationId,role:'caller'},untrustedInput:{message:question,selected:{kind:'work',id:current.voiceSessionId}},groundedContext:{basisDigest:basis,evidence:current.evidence,proposals:[],allowedCards:[],trustedFacts:[]}};
  runtime.preflight(envelope);
  if(stopped||signal?.aborted||!policy.callGuidanceEnabled||!policy.generationEnabled)unavailable();
  const reservation=await query('SELECT public.canonical_call_provider_reserve($1,$2,$3) value',[current.voiceSessionId,key,basis]);
  if(!reservation.admitted)unavailable();
  const controller=new AbortController(),abort=()=>controller.abort();controllers.add(controller);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();const timer=setTimeout(abort,25000);timer.unref?.();let settled=false;
  async function settle(usage){const known=usage&&typeof usage.providerRequestId==='string'&&usage.providerRequestId;const value=known?{costNanoUsd:String(usage.costNanoUsd),inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,outcome:usage.outcomeClass}:{};const r=await query('SELECT public.canonical_call_provider_reconcile($1,$2::jsonb) value',[reservation.id,value]);settled=true;return r;}
  try{
   // Admission transaction released. Recheck after its locks before any network.
   if(stopped||controller.signal.aborted||digest(await repo.loadCurrent(identity))!==basis||!policy.callGuidanceEnabled||!policy.generationEnabled)unavailable();
   const result=await runtime.respond(envelope,{signal:controller.signal});const outcome=await settle(result.usage);
   if(outcome.state!=='completed'||controller.signal.aborted||!policy.callGuidanceEnabled||!policy.generationEnabled||digest(await repo.loadCurrent(identity))!==basis)unavailable();
   return {questions:result.response.questions,explanations:result.response.explanations,proposalIds:[],requestedCard:'none'};
  }catch(e){if(!settled)await settle(e.polarisUsage).catch(()=>{});throw e;}finally{clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',abort);controllers.delete(controller);}
 };
 generate.stop=()=>{stopped=true;for(const c of controllers)c.abort();};return generate;
}
module.exports={createProductionCallGenerate};
