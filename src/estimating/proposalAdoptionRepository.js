'use strict';
const {sha256}=require('../services/businessProfileAdapter');
const contract=require('./proposalAdoptionContract'),builder=require('./proposalAdoptionReview');
const proposal=require('./estimateProposalRepository'),equipment=require('./equipmentPlanRepository');
const args=i=>[i.organizationId,i.actorUserId,i.actorAccessRole,i.authSessionId,i.estimateId];
async function authority(client,i){await client.query('SELECT public.canonical_travel_write_authority($1,$2,$3,$4,$5)',[...args(i).slice(0,4),i.csrfToken]);}
function checkPolicy(body){
 const policies=[require('./proposalAdoptionPolicy'),require('./materialAdoptionPolicy')];
 const files={materials:'materialPlanPolicy',labor:'laborPlanPolicy',equipment:'equipmentPlanPolicy',travel:'travelPlanPolicy',pricing:'pricingPlanPolicy'};
 for(const[k,file]of Object.entries(files))if(body.selection[k]==='replace')policies.push(require('./'+file));
 if(body.selection.equipment==='replace')policies.push(require('./equipmentCostPlanPolicy'));
 if(body.pricingPolicy)policies.push(require('./pricingPolicyWritePolicy'));
 if(policies.some(p=>p.mutationsEnabled!==true))contract.fail('New prepared estimates are paused. Refresh to check saved history.',503,'PROPOSAL_ADOPTION_PAUSED');
}
async function read(client,input){return(await client.query('SELECT public.canonical_proposal_adoption_read($1,$2,$3,$4,$5) result',args(input))).rows[0].result;}
async function prepare(client,input,raw,load){
 const body=contract.normalize(raw,{preview:true});await authority(client,input);checkPolicy(body);
 const {review,item}=await load(client,body.draft.selectedRevision),context=await proposal.loadContext(client,input,review,item),history=await read(client,input);
 const recipe=context.sources.knowledge.find(k=>k.content?.estimateProposalRecipe?.serviceKey===item.snapshot.service.key)?.content.estimateProposalRecipe;
 const inputs=recipe?.components.find(c=>c.kind==='equipment')?.inputs;
 const sources=inputs?equipment.presentSources(await equipment.readSources(client,input,inputs),input):context.sources;
 const prepared=builder.build(context,body,{equipmentSources:sources,history:history.history});
 const costSelection=await require('./materialAdoptionRepository').readRevisions(client,input);await authority(client,input);return{...prepared,context,equipmentSources:sources,item,loadedReview:review,costSelection};
}
function failure(e){
 if(e?.status)return e;
 const status=e?.code==='42501'?403:e?.code==='P0002'?404:['40001','40P01','23505'].includes(e?.code)?409:['22023','22P02','23514'].includes(e?.code)?400:e?.code==='54000'?429:503;
 const message=status===403?'Your current account cannot adopt this estimate.':status===404?'This estimate is unavailable. Refresh and choose an available record.':status===409?'The estimate or its sources changed. Refresh and review it again.':status===400?'Review the prepared estimate entries and confirmation.':status===429?'Saving is limited. Review the current sources and saved history before trying again.':'The save result is uncertain. Retry this same attempt or refresh to check saved history.';
 return Object.assign(new Error(message),{status,code:e?.code==='54000'&&['Aggregate history limit','Estimate history limit','Estimate revision limit','Decision limit'].includes(e.message)?'PROPOSAL_ADOPTION_HISTORY_LIMIT':'PROPOSAL_ADOPTION_UNAVAILABLE',cause:e});
}
async function mutate(pool,input,raw,load,{fault=null}={}){
 const body=contract.normalize(raw),client=await pool.connect();let locked=false,discard=false;
 try{
  await client.query("SET statement_timeout='10000ms'");await client.query("SET lock_timeout='2000ms'");
  await client.query('SELECT pg_advisory_lock_shared(230004,4)');locked=true;
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');await client.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
  await authority(client,input);checkPolicy(body);
  // Resolve historical retries before current recipe expiry. SQL compares the full
  // request again under its receipt lock; no old body can bypass current authority.
  let prepared=null;
  // The SQL entry owns replay selection. The replay probe only touches the existing transaction fence; it cannot append receipts.
  const probe=(await client.query('SELECT public.canonical_proposal_adoption_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',[...args(input),input.csrfToken,input.idempotencyKey,{request:body,replayOnly:true}])).rows[0].result;
  if(probe.replayed){await authority(client,input);await client.query('COMMIT');return probe;}
  prepared=await prepare(client,input,body,load);contract.assertCurrent(prepared.review,body,new Date((await client.query('SELECT clock_timestamp() now')).rows[0].now));
  const envelope={request:body,writes:prepared.writes,recipePin:prepared.recipePin,sourcePins:prepared.loadedReview.pins,decisionBasis:prepared.loadedReview.decisions.writeBasis,expiresAt:prepared.review.expiresAt,reviewResult:prepared.review};
  const result=(await client.query('SELECT public.canonical_proposal_adoption_mutate($1,$2,$3,$4,$5,$6,$7,$8::jsonb) result',[...args(input),input.csrfToken,input.idempotencyKey,envelope])).rows[0].result;
  if(fault)await fault('after_sql',client,result);
  if(!result.replayed)await verify(client,input,prepared,result);
  await authority(client,input);checkPolicy(body);
  if(fault)await fault('before_commit',client,result);
  // Prepare serialization before commit so a response-shaping failure rolls back.
  const response=JSON.parse(JSON.stringify({receipt:result.receipt,replayed:result.replayed}));
  await client.query('COMMIT');return response;
 }catch(e){await client.query('ROLLBACK').catch(()=>{discard=true;});throw failure(e);}
 finally{if(locked)await client.query('SELECT pg_advisory_unlock_shared(230004,4)').catch(()=>{discard=true;});await client.query('RESET ALL').catch(()=>{discard=true;});client.release(discard);}
}
async function verify(client,input,prepared,result){
 const now=new Date((await client.query('SELECT clock_timestamp() now')).rows[0].now);
 if(now>=new Date(prepared.review.expiresAt))contract.fail('This estimate review expired. Refresh to check saved history.',410);
 const selection=await require('./materialAdoptionRepository').readRevisions(client,input),childReview=require('./estimateRevisionReview').buildRevisionReview(prepared.item,selection);
 const costs=childReview.financialCosts;
 const expectedCosts={...prepared.review.financialCosts,coverageAssessment:{...prepared.review.financialCosts.coverageAssessment,componentManifest:require('./travelCostComposition').manifest(require('./travelCostComposition').plans(selection))}};
 if(sha256(costs)!==sha256(expectedCosts))contract.fail('The resulting costs changed. Refresh and review again.',409);
 const eq=result.components.equipment;
 if(eq){const raw=await equipment.readSources(client,input,eq.inputs);require('./equipmentPlanContract').requireReview(eq.inputs,equipment.presentSources(raw,input),now);if(raw.digest!==eq.evidence.digest)contract.fail('Equipment sources changed. Review again.',409);}
 const t=result.components.travel||selection.selected.travelPlan;if(t){
  const r=require('./travelPlanRepository'),current=await r.readSources(client,input),saved=result.components.travel?t.evidence:current;
  // Retained raw evidence is checked inside the private child helper. Its protected
  // projection omits that evidence; JS independently checks the current source and bindings.
  if(result.components.travel)require('./travelPlanContract').checkEvidence(t.inputs,t.currency,r.presentSources(saved,input),now);else{require('./travelPlanContract').calculate(t.inputs,t.currency);require('./travelPlanContract').assess(t.inputs,r.presentSources(current,input),now);}
  require('./travelResourceBasis').check(t.inputs,current);
  const content=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['digest','resourceChoices'].includes(k)));
  if(sha256(content(current))!==sha256(content(saved)))contract.fail('Travel source information changed. Review again.',409);
  if(result.components.travel){
  const chosen=selection.selected.laborPlan;
  const expected=require('./travelResourceBasis').choices([],chosen,()=>true).labor;
  const equipmentIds=new Set([(result.components.equipment||prepared.loadedReview.equipmentPlans?.current)?.id,selection.selected.equipmentCostPlan?.inputs.equipmentBasis.planId].filter(Boolean));
  const expectedEquipment=(saved.resourceChoices?.equipment||[]).filter(c=>equipmentIds.has(c.pin.planId));
  if(sha256(current.resourceChoices?.labor||[])!==sha256(expected)||sha256(current.resourceChoices?.equipment||[])!==sha256(expectedEquipment))contract.fail('Travel resource choices changed beyond the reviewed adoption.',409);
  }
 }
 const material=selection.selected.materialPlan;if(material&&['estimate-material-plan-v3','estimate-material-plan-v4'].includes(material.calculationVersion))require('./materialPlanContract').checkEvidence(material.inputs,material.currency,material.calculationVersion,{now,serviceKey:prepared.item.snapshot.service.key},true);
 const l=selection.selected.laborPlan;if(l)require('./laborPlanContract').checkEvidence(l.inputs,prepared.item.snapshot.service.key,now);
 const e=result.components.equipmentCost;if(e){const source=equipment.presentSources(await equipment.readSources(client,input,selection.selected.equipmentCostPlan.inputs?((await equipment.readPlans(client,input)).current.inputs):null),input);const current=(await equipment.readPlans(client,input)).current;require('./equipmentCostPlanContract').checkEvidence(e.inputs,e.currency,current,source,require('./equipmentCostComposition').outsideBasis(prepared.costSelection,{...prepared.item,sourcePins:Object.fromEntries(Object.entries(prepared.loadedReview.pins).filter(([key])=>key!=='revision'))}),now);}
 const p=result.components.pricing;if(p){const r=require('./pricingPlanRepository'),raw=await r.readSources(client,input),calculated=require('./pricingPlanContract').preview(p.inputs,p.currency,r.presentSources(raw,input),now);if(sha256(calculated.result)!==sha256(p.result)||sha256(calculated.result)!==sha256(prepared.review.price))contract.fail('Pricing changed. Review the proposed price again.',409);}
 const policy=result.components.pricingPolicy;if(policy){const r=require('./pricingPolicyRepository'),sources=r.presentSources(await r.readSources(client,input),input),calculated=require('./pricingPolicyContract').preview(policy.inputs,policy.currency,sources,now);if(sha256(calculated.result)!==sha256(policy.result)||sha256(calculated.result)!==sha256(prepared.review.policy))contract.fail('The pricing policy changed. Review again.',409);}
 const after=await proposal.loadContext(client,input,prepared.loadedReview,prepared.item);
 if(sha256(after.sources)!==sha256({...prepared.context.sources,now:after.sources.now}))contract.fail('Company or resource information changed. Review again.',409);
}
module.exports={read,prepare,mutate,verify,checkPolicy,failure};
