'use strict';
const {digest,VERSION}=require('./groundedConversation');
const {createConnectedCallRepository}=require('./connectedCallRepository');
const {parseCallCanaryBinding}=require('./callCanaryBinding');
const policy=require('./connectedPolicy');
function unavailable(){throw Object.assign(new Error('Call guidance is unavailable. Ask the owner to review these details.'),{statusCode:503});}
function createProductionCallGenerate(environment=process.env,{getPool,runtime}={}){
 const configuredBinding=parseCallCanaryBinding(environment.POLARIS_CALL_CANARY_BINDING);
 if(environment.POLARIS_CALL_GUIDANCE_ENABLED!=='true'||environment.POLARIS_GROUNDED_V2_ENABLED!=='true'||!configuredBinding)return null;
 if(typeof getPool!=='function'||runtime?.kind!=='openai')unavailable();
 const repo=createConnectedCallRepository(getPool),controllers=new Set();let stopped=false;
 function liveBinding(){const value=parseCallCanaryBinding(environment.POLARIS_CALL_CANARY_BINDING);return value&&value.bindingDigest===configuredBinding.bindingDigest?value:null;}
 function exactAuthority(binding,current,authority){return Boolean(binding&&current&&authority&&
  authority.bindingDigest===binding.bindingDigest&&authority.organizationId===String(current.organizationId).toLowerCase()&&
  authority.agentId===binding.agentId&&authority.agentId===current.agentId&&authority.agentVersion===binding.agentVersion&&
  authority.llmId===binding.llmId&&authority.llmVersion===binding.llmVersion&&authority.basePromptDigest===binding.basePromptDigest&&
  authority.consentVersion===binding.consentVersion&&authority.syntheticOnly===true&&authority.exclusive===true&&
  Number.isSafeInteger(authority.remainingMs)&&authority.remainingMs>0);}
 async function query(sql,args){const c=await getPool().connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5000ms'");await c.query("SET LOCAL lock_timeout='1000ms'");const r=await c.query(sql,args);await c.query('COMMIT');return r.rows[0].value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function authorize({identity,context,basis,signal}={}){
  if(stopped||!policy.callGuidanceEnabled||!policy.generationEnabled||signal?.aborted||!identity||!context||digest(context)!==basis)unavailable();
  const current=await repo.loadCurrent(identity),binding=liveBinding();if(digest(current)!==basis||!binding)unavailable();
  let authority;try{authority=await query('SELECT public.canonical_call_provider_canary_authority($1,$2) value',[current.voiceSessionId,binding.bindingDigest]);}catch(_){unavailable();}
  if(stopped||signal?.aborted||!policy.callGuidanceEnabled||!policy.generationEnabled||!exactAuthority(binding,current,authority))unavailable();
  return {current,binding,remainingMs:authority.remainingMs};
 }
 const generate=async({question,context,signal})=>{
  const identity={callId:context.callId,agentId:context.agentId},contextBasis=digest(context);
  let admission=await authorize({identity,context,basis:contextBasis,signal});const current=admission.current,binding=admission.binding;
  const basis=digest({contextBasis,callCanaryBindingDigest:binding.bindingDigest});
  const key=digest({identity,question,basis});
  const envelope={purpose:'caller_guidance',schemaVersion:VERSION,requestId:key,authority:{organizationId:current.organizationId,role:'caller'},untrustedInput:{message:question,selected:{kind:'work',id:current.voiceSessionId}},groundedContext:{basisDigest:basis,evidence:current.evidence,proposals:[],allowedCards:[],trustedFacts:[]}};
  runtime.preflight(envelope);
  admission=await authorize({identity,context,basis:contextBasis,signal});
  const reservation=await query('SELECT public.canonical_call_provider_canary_reserve($1,$2,$3,$4) value',[current.voiceSessionId,key,basis,binding.bindingDigest]);
  if(!reservation.admitted)unavailable();
  const controller=new AbortController(),abort=()=>controller.abort();controllers.add(controller);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();const timer=setTimeout(abort,Math.max(1,Math.min(25000,admission.remainingMs)));timer.unref?.();let settled=false;
  async function settle(usage){const known=usage&&typeof usage.providerRequestId==='string'&&usage.providerRequestId&&usage.accountingVersion&&usage.count&&usage.generation;const value=known?{accountingVersion:usage.accountingVersion,costNanoUsd:String(usage.costNanoUsd),inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,outcome:usage.outcomeClass,count:usage.count,generation:usage.generation}:{};const r=await query('SELECT public.canonical_call_provider_canary_reconcile($1,$2::jsonb,$3) value',[reservation.id,value,binding.bindingDigest]);settled=true;return r;}
  try{
   await authorize({identity,context,basis:contextBasis,signal:controller.signal});
   const result=await runtime.respond(envelope,{signal:controller.signal,revalidate:async()=>{await authorize({identity,context,basis:contextBasis,signal:controller.signal});}});const outcome=await settle(result.usage);
   await authorize({identity,context,basis:contextBasis,signal:controller.signal});if(outcome.state!=='completed')unavailable();
   return {questions:result.response.questions,explanations:result.response.explanations,proposalIds:[],requestedCard:'none'};
  }catch(e){if(!settled)await settle(e.polarisUsage).catch(()=>{});throw e;}finally{clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',abort);controllers.delete(controller);}
 };
 generate.authorize=authorize;
 generate.stop=()=>{stopped=true;for(const c of controllers)c.abort();};return generate;
}
module.exports={createProductionCallGenerate};
