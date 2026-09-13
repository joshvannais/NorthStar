'use strict';
const {digest}=require('../polaris/groundedConversation');
const {publicContext,createTaxSourceAcquisition,approvedUrl}=require('./taxSourceAcquisition');
const {createTaxSourceTransport}=require('./taxSourceTransport');
const registry=require('./taxSourceRegistry');
function invalid(){throw new Error('The reviewed tax source registry is unavailable.');}
function day(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
function validateRegistry(value){
 if(!value||value.version!=='tax-source-registry-v1'||!Array.isArray(value.entries)||value.entries.length>32)invalid();
 const keys=new Set();for(const e of value.entries){
  if(!e||Object.keys(e).sort().join('|')!==['context','documents','review'].sort().join('|'))invalid();
  const context=publicContext(e.context);if(Object.keys(e.context).length!==6)invalid();const key=digest(context);if(keys.has(key))invalid();keys.add(key);
  if(!e.review||Object.keys(e.review).sort().join('|')!==['accessBasis','expiresOn','reviewedBy','reviewedOn'].sort().join('|')||typeof e.review.reviewedBy!=='string'||!e.review.reviewedBy.trim()||e.review.reviewedBy.length>200||typeof e.review.accessBasis!=='string'||!e.review.accessBasis.trim()||e.review.accessBasis.length>2000||!day(e.review.reviewedOn)||!day(e.review.expiresOn)||e.review.expiresOn<e.review.reviewedOn)invalid();
  if(!Array.isArray(e.documents)||!e.documents.length||e.documents.length>8)invalid();for(const d of e.documents){
   if(!d||Object.keys(d).sort().join('|')!==['url','allowedOrigins','effectiveOn','endsOn','coverage','exclusions',...(Object.hasOwn(d,'documentType')?['documentType']:[])].sort().join('|')||Object.hasOwn(d,'documentType')&&d.documentType!=='pdf'||!Array.isArray(d.allowedOrigins)||!d.allowedOrigins.length||d.allowedOrigins.length>4)invalid();
   for(const origin of d.allowedOrigins){let u;try{u=new URL(origin);}catch(_){invalid();}if(u.origin!==origin||u.protocol!=='https:'||u.port&&u.port!=='443')invalid();}
   approvedUrl(d.url,new Set(d.allowedOrigins));for(const k of ['effectiveOn','endsOn'])if(d[k]!==null&&!day(d[k]))invalid();if(d.effectiveOn&&d.endsOn&&d.endsOn<d.effectiveOn)invalid();for(const k of ['coverage','exclusions'])if(typeof d[k]!=='string'||d[k].length>2000)invalid();
  }
 }
 return value;
}
function createProductionTaxAcquisition(environment=process.env,{getRegistry=()=>registry,transportFactory=createTaxSourceTransport,clock=()=>new Date()}={}){
 if(environment.TAX_SOURCE_ACQUISITION_ENABLED!=='true')return null;
 const initial=validateRegistry(getRegistry());if(!initial.entries.length)return null;
 const current=()=>validateRegistry(getRegistry());
 const eligible=(pack,context)=>pack.entries.find(e=>digest(publicContext(e.context))===digest(context)&&e.review.reviewedOn<=clock().toISOString().slice(0,10)&&e.review.expiresOn>=clock().toISOString().slice(0,10));
 const acquire=async(input,{signal}={})=>{
  const context=publicContext(input),pack=current(),identity=digest(pack),entry=eligible(pack,context);
  if(!entry)return {version:'tax-source-candidate-v1',state:'unsupported',context,candidates:[]};
  const origins=new Set(entry.documents.flatMap(d=>d.allowedOrigins));const transport=transportFactory({documents:()=>entry.documents,allowedOrigins:origins,timeoutMs:8000});
  const answer=await createTaxSourceAcquisition({transport,allowedOrigins:origins,clock})(context,{signal});
  if(signal?.aborted||digest(current())!==identity||!eligible(current(),context))invalid();
  return {...answer,candidates:answer.candidates.map(c=>({...c,sourceRegistryDigest:identity,sourceAccessReview:entry.review}))};
 };
 acquire.isCurrent=result=>{const pack=current();return result&&result.candidates?.every(c=>c.sourceRegistryDigest===digest(pack)&&Boolean(eligible(pack,publicContext(c.context))));};
 return acquire;
}
// Read-only status uses the same current factory, registry and clock; never transport.
function createTaxAcquisitionStatus(environment=process.env,{getRegistry=()=>registry,getAcquire,clock=()=>new Date()}={}){
 return contexts=>{
  if(environment.TAX_SOURCE_ACQUISITION_ENABLED!=='true')return {acquisitionEnabled:false,acquisitionState:'disabled'};
  try{
   const pack=validateRegistry(getRegistry());if(!pack.entries.length)return {acquisitionEnabled:false,acquisitionState:'empty'};
   if(typeof getAcquire!=='function'||typeof getAcquire()!=='function')return {acquisitionEnabled:false,acquisitionState:'disconnected'};
   const inputs=(contexts||[]).map(publicContext),today=clock().toISOString().slice(0,10);
   const matched=inputs.map(c=>pack.entries.find(e=>digest(publicContext(e.context))===digest(c)));
   const current=matched.filter(e=>e&&e.review.reviewedOn<=today&&e.review.expiresOn>=today).length;
   const state=inputs.length&&current===inputs.length?'matched':current?'partial':matched.some(Boolean)?'expired':'unmatched';
   return {acquisitionEnabled:true,acquisitionState:state};
  }catch(_){return {acquisitionEnabled:false,acquisitionState:'unavailable'};}
 };
}
module.exports={validateRegistry,createProductionTaxAcquisition,createTaxAcquisitionStatus};
