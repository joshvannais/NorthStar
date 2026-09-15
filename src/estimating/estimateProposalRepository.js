'use strict';
const equipment=require('./equipmentPlanRepository');
const proposal=require('./estimateProposal');
const {sha256}=require('../services/businessProfileAdapter');

function context(raw,input,now,item=null){
 const sources=equipment.presentSources(raw,input),scope=sources.scope||{};
 const unconfirmedFields=(item?.facts||[]).filter(f=>f.status&&f.status!=='collected').map(f=>f.variable),proposalScope={...scope};for(const field of unconfirmedFields)delete proposalScope[field];
 // Only explicit quantitative facts with their recorded units enter recipes.
 // No unit is guessed from a field name, service or customer-price rule.
 const facts={};for(const [key,fact] of Object.entries(proposalScope))if(fact&&typeof fact==='object'&&!Array.isArray(fact)&&typeof fact.value==='string'&&typeof fact.unit==='string')facts[key]={value:fact.value,unit:fact.unit,source:'Recorded job detail'};
 return{...sources,facts,proposalScope,unconfirmedFields,authorityDigest:sha256({sources:sources.authorityDigest,unconfirmedFields}),geography:typeof proposalScope.proposalGeography==='string'?proposalScope.proposalGeography:null,now:new Date(now).toISOString()};
}
async function loadContext(client,input,review,item){
 let raw=await equipment.readSources(client,input);
 const initial=equipment.presentSources(raw,input),recipes=proposal.applicableRecipes({...initial,proposalScope:initial.scope||{}},item);
 if(recipes.length===1){const plan=recipes[0].recipe.components.find(c=>c.kind==='equipment');if(plan){require('./equipmentPlanContract').validate(plan.inputs);const selected=await equipment.readSources(client,input,plan.inputs);raw={...raw,references:selected.references,assets:Array.from(new Map([...raw.assets,...selected.assets].map(a=>[a.id,a])).values()),digest:sha256({initial:raw.digest,selected:selected.digest})};}}
 const resources=await require('./proposalResources').paid(client,{...input,appointmentId:item.ids.appointment||null},item.snapshot.service.key),now=new Date((await client.query('SELECT clock_timestamp() now')).rows[0].now);
 return {review,item,sources:{...context(raw,input,now,item),resources},now};
}
async function preview(client,input,review,item,body){return proposal.build(await loadContext(client,input,review,item),body);}
function demoContext(record,review,item,now=new Date(),workspace=null){
 const adapter=require('../commandCenter/demoEquipmentPlans'),raw=adapter.rawSources(record.state,item),sources=context(raw,adapter.actor(item),now,item);
 sources.resources=require('./proposalResources').demo(record.state,item.snapshot.service.key,workspace,item.ids?.estimate,now);
 // This marker exists only in new-session generated source data. Old sessions
 // are never repaired or silently given recipe facts by this read adapter.
 const seed=record.state.equipmentBasis?.proposalRecipeBasis;
 if((seed?.version==='simulated-fence-proposal-basis-v1'&&item.snapshot.service.key==='fence')||(seed?.version==='simulated-service-proposal-basis-v2'&&seed.services?.[item.snapshot.service.key])){
  sources.geography=seed.geography;
  const feet=item.snapshot.service.scope?.linearFeet;
  if(typeof feet==='number'&&Number.isFinite(feet)&&feet>=0&&!sources.unconfirmedFields.includes('linearFeet'))sources.facts.linearFeet={value:String(feet),unit:'ft',source:'Recorded simulated fence length'};
  sources.authorityDigest=sha256({equipment:sources.authorityDigest,recipeBasis:seed,scope:item.snapshot.service.scope});
 }
 return {review,item,sources,now,expiresAt:record.expiresAt,simulated:true};
}
function demo(record,review,item,body,now=new Date(),workspace=null){return proposal.build(demoContext(record,review,item,now,workspace),body);}
function failure(error){
 const status=[400,401,403,404,409,410,413,429,503].includes(error?.status||error?.statusCode)?error.status||error.statusCode:error?.code==='42501'?403:error?.code==='P0002'?404:['40001','40P01'].includes(error?.code)?409:['22023','22P02','23514'].includes(error?.code)?400:503;
 const messages={400:'Review the prepared estimate entries and company recipe.',401:'Sign in again to prepare this estimate.',403:'Your current account cannot prepare this estimate.',404:'This estimate is unavailable. Refresh and choose an available record.',409:'The estimate or its sources changed. Refresh before calculating again.',410:'This estimate review expired. Refresh to continue.',413:'Shorten the prepared estimate entries and try again.',429:'Prepared estimates are temporarily unavailable. Try again later.',503:'Prepared estimates are temporarily unavailable. Refresh and try again.'};
 return{status,message:['ESTIMATE_PROPOSAL_INVALID','PROPOSAL_RECIPE_INVALID'].includes(error?.code)?error.message:messages[status]};
}
module.exports={context,loadContext,demoContext,preview,demo,failure};
