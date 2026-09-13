'use strict';
const {digest}=require('../polaris/groundedConversation');
const {createRetellProjectionTransport}=require('./retellProjectionTransport');
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function fail(){throw new Error('A reviewed dedicated knowledge target binding is required.');}
function parseBindings(raw){
 let entries;try{entries=JSON.parse(raw||'[]');}catch(_){fail();}if(!Array.isArray(entries)||entries.length>16)fail();
 const targets=new Set(),llms=new Set();for(const e of entries){
  if(!e||Object.keys(e).sort().join('|')!==['organizationId','targetId','targetRevision','providerKey','agentId','llmId','llmVersion','basePromptDigest','exclusive'].sort().join('|')||!UUID.test(e.organizationId)||!UUID.test(e.targetId)||!Number.isSafeInteger(e.targetRevision)||e.targetRevision<1||e.exclusive!==true||!Number.isSafeInteger(e.llmVersion)||e.llmVersion<0||!/^[a-f0-9]{64}$/.test(e.basePromptDigest))fail();
  for(const k of ['providerKey','agentId','llmId'])if(typeof e[k]!=='string'||!e[k]||e[k].length>200||/[\u0000-\u0020]/.test(e[k]))fail();
  if(targets.has(e.targetId)||llms.has(e.llmId))fail();targets.add(e.targetId);llms.add(e.llmId);
 }return entries;
}
// SDK-shaped narrow native REST client: no agent management, redirects or retries.
// Official protocols: docs.retellai.com/api-references/{get,update}-retell-llm.
function createLlmClient(key,{fetchImpl=globalThis.fetch}={}){
 if(typeof key!=='string'||!key)fail();
 async function send(id,version,prompt,options){
  if(!options?.signal||!Number.isSafeInteger(version)||version<0)fail();
  const mutation=prompt!==undefined,url='https://api.retellai.com/'+(mutation?'update':'get')+'-retell-llm/'+encodeURIComponent(id)+'?version='+version;
  const res=await fetchImpl(url,{method:mutation?'PATCH':'GET',redirect:'error',signal:options.signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(mutation?{body:JSON.stringify({general_prompt:prompt})}:{})});
  if(!res.ok||!res.body?.getReader)fail();const reader=res.body.getReader(),chunks=[];let length=0;
  try{while(true){if(options.signal.aborted)fail();const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>131072)fail();chunks.push(Buffer.from(part.value));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 }
 return {llm:{retrieve:(id,query,options)=>send(id,query.version,undefined,options),update:(id,body,options)=>send(id,body.version,body.general_prompt,options)}};
}
function createProductionKnowledgeTransports(environment=process.env,{getPool,getBindings=()=>environment.KNOWLEDGE_PROVIDER_BINDINGS,clientFactory=key=>createLlmClient(key)}={}){
 if(environment.KNOWLEDGE_PROVIDER_SYNC_ENABLED!=='true')return new Map();
 const entries=parseBindings(getBindings());if(!entries.length)return new Map();if(!environment.RETELL_API_KEY||typeof getPool!=='function')fail();const identity=digest(entries);
 const resolveBinding=async (request,{client,signal}={})=>{
  if(!client||typeof client.query!=='function'||signal?.aborted)fail();
  const current=parseBindings(getBindings());if(digest(current)!==identity)fail();const e=current.find(x=>x.targetId===request.targetId&&x.organizationId===request.organizationId&&x.targetRevision===request.targetRevision);if(!e)fail();
  const pool=client;const target=(await pool.query("SELECT provider_key,target_revision,status FROM canonical_knowledge_sync_targets WHERE organization_id=$1 AND id=$2",[e.organizationId,e.targetId])).rows[0];if(!target||target.status!=='active'||Number(target.target_revision)!==e.targetRevision||target.provider_key!==e.providerKey)fail();
  const ownership=await require('../services/organizationAuthority').resolveIntegrationOwner(pool,'retell',e.agentId);if(ownership.organizationId!==e.organizationId||signal?.aborted)fail();
  return {...e};
 };
 const transport=createRetellProjectionTransport({client:clientFactory(environment.RETELL_API_KEY),resolveBinding});return new Map([...new Set(entries.map(e=>e.providerKey))].map(key=>[key,transport]));
}
module.exports={parseBindings,createLlmClient,createProductionKnowledgeTransports};
