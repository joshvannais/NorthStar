'use strict';
const {createHash}=require('node:crypto');
const {canonicalStringify}=require('./contract');
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const BEGIN='[NORTHSTAR_PUBLISHED_KNOWLEDGE_BEGIN]',END='[NORTHSTAR_PUBLISHED_KNOWLEDGE_END]';
function fail(category='integrity_failure'){throw Object.assign(new Error('Knowledge delivery requires exact target reconciliation.'),{category});}
function split(prompt){
 if(typeof prompt!=='string'||Buffer.byteLength(prompt)>65536||prompt.split(BEGIN).length!==2||prompt.split(END).length!==2)fail();
 const start=prompt.indexOf(BEGIN),end=prompt.indexOf(END);if(end<start)fail();
 return {base:prompt.slice(0,start)+BEGIN+END+prompt.slice(end+END.length),prefix:prompt.slice(0,start)+BEGIN,suffix:END+prompt.slice(end+END.length),block:prompt.slice(start+BEGIN.length,end)};
}
function createRetellProjectionTransport({client,resolveBinding}){
 if(!client?.llm||typeof client.llm.retrieve!=='function'||typeof client.llm.update!=='function'||typeof resolveBinding!=='function')throw new TypeError('A reviewed dedicated Retell target is required.');
 return {async applyProjection(request,{signal:upstreamSignal}={}){
  const controller=new AbortController(),abort=()=>controller.abort(upstreamSignal?.reason),timer=setTimeout(()=>controller.abort(new Error('Knowledge transport deadline exceeded')),10000);timer.unref?.();
  upstreamSignal?.addEventListener('abort',abort,{once:true});if(upstreamSignal?.aborted)abort();
  const signal=controller.signal,check=()=>{if(signal.aborted)fail('transport_timeout');};
  try {
  check();const binding=await resolveBinding(request);check();
  function checkBinding(value){if(!value||value.organizationId!==request.organizationId||value.targetId!==request.targetId||value.targetRevision!==request.targetRevision||value.exclusive!==true||typeof value.llmId!=='string'||!value.llmId||!Number.isSafeInteger(value.llmVersion)||value.llmVersion<0||!/^[a-f0-9]{64}$/.test(value.basePromptDigest))fail();}
  checkBinding(binding);
  if(!Number.isSafeInteger(request.targetSequence)||request.targetSequence<1||typeof request.idempotencyKey!=='string'||!request.idempotencyKey||request.idempotencyKey.length>200||/[\u0000-\u001f]/.test(request.idempotencyKey))fail();
  if(request.consumer!=='voice_runtime'||request.audience!=='customer'||request.projection?.audience!=='customer'||request.projection?.consumer!=='voice_runtime'||request.projection.truncated===true||!Number.isSafeInteger(request.attemptCount)||request.attemptCount<1||hash(request.canonicalProjection)!==request.projectionDigest||canonicalStringify(request.projection)!==request.canonicalProjection)fail();
  if(request.canonicalProjection.includes(BEGIN)||request.canonicalProjection.includes(END)||Buffer.byteLength(request.canonicalProjection)>16000)fail();
  const block=canonicalStringify({version:'northstar-retell-knowledge-block-v1',organizationId:request.organizationId,targetId:request.targetId,sequence:request.targetSequence,idempotencyKey:request.idempotencyKey,projectionDigest:request.projectionDigest,projection:request.projection});
  const options={signal,maxRetries:0};
  const before=await client.llm.retrieve(binding.llmId,{version:binding.llmVersion},options);check();if(before.llm_id!==binding.llmId||before.version!==binding.llmVersion)fail();
  const parts=split(before.general_prompt);if(hash(parts.base)!==binding.basePromptDigest)fail();
  let previous=null;if(parts.block){try{previous=JSON.parse(parts.block);}catch(_){fail();}if(previous.version!=='northstar-retell-knowledge-block-v1'||!previous.projection||hash(canonicalStringify(previous.projection))!==previous.projectionDigest||typeof previous.idempotencyKey!=='string'||!previous.idempotencyKey||previous.organizationId!==request.organizationId||previous.targetId!==request.targetId||!Number.isSafeInteger(previous.sequence)||previous.sequence>request.targetSequence)fail();}
  const expected=parts.prefix+block+parts.suffix;
  if(before.general_prompt!==expected){
   if(request.attemptCount!==1||(previous&&previous.sequence===request.targetSequence))fail('provider_failure');
   const current=await resolveBinding(request);check();checkBinding(current);if(canonicalStringify(current)!==canonicalStringify(binding))fail();
   if(signal?.aborted)fail('transport_timeout');
   // One supported update only. A lost response is reconciled by a later GET;
   // a later attempt never blindly sends this mutation again.
   await client.llm.update(binding.llmId,{version:binding.llmVersion,general_prompt:expected},options);check();
  }
  const observed=await client.llm.retrieve(binding.llmId,{version:binding.llmVersion},options);check();
  const current=await resolveBinding(request);check();checkBinding(current);
  if(canonicalStringify(current)!==canonicalStringify(binding)||observed.llm_id!==binding.llmId||observed.version!==binding.llmVersion||observed.general_prompt!==expected)fail();
  const withoutPrompt=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['general_prompt','last_modification_timestamp'].includes(key)));
  if(canonicalStringify(withoutPrompt(before))!==canonicalStringify(withoutPrompt(observed)))fail();
  return {accepted:true,observedProjectionDigest:request.projectionDigest};
  } finally {clearTimeout(timer);upstreamSignal?.removeEventListener('abort',abort);controller.abort();}
 }};
}
module.exports={BEGIN,END,split,createRetellProjectionTransport};
