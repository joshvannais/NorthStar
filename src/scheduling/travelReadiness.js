'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const {geodesicDistance}=require('./routeRecommendationEvaluator');
const contract=require('../estimating/travelPlanContract');
function extra(basis,proposal,now=new Date()){
 const hardConflicts=[],reviewReasons=[],facts=[];
 if(!basis||basis.notRecorded===true)return{hardConflicts,reviewReasons,facts,digest:basis?.digest||'none'};
 if(basis.adopted){const a=extra(basis.adopted,proposal,now);hardConflicts.push(...a.hardConflicts);reviewReasons.push(...a.reviewReasons);facts.push(...a.facts);}
 if(basis.sourceChanged)reviewReasons.push({code:'travel_plan_changed'});
 if(basis.haulingNeedsReview)reviewReasons.push({code:'travel_loads_need_review'});
 if(basis.stagesNeedReview)reviewReasons.push({code:'travel_stages_need_review'});
 if(!basis.inputs)return{hardConflicts,reviewReasons,facts,digest:basis.digest};
 const today=new Date(now).toISOString().slice(0,10),source=basis.sources||{},policy=source.serviceArea||{},buffer=source.bufferMinutes;
 try{contract.checkSources(basis.inputs,source);}catch(_){reviewReasons.push({code:'travel_location_changed'});}
 const assessment=contract.sourceAssessment(basis.inputs,now);
 if(assessment.cautions.length)reviewReasons.push({code:'travel_source_needs_review'});
 for(const t of basis.inputs.trips){
  const o=t.origin,d=t.destination,coords=[o.latitude,o.longitude,d.latitude,d.longitude].every(Number.isFinite);
  if(coords){const distance=geodesicDistance(o,d);facts.push({lineId:t.lineId,kind:'straight_line',distanceMiles:distance.distanceMiles,distanceKilometers:distance.distanceKilometers});if(Number.isFinite(policy.maxRadiusMiles)&&distance.distanceMiles>policy.maxRadiusMiles)reviewReasons.push({code:'travel_outside_declared_radius',lineId:t.lineId});}
  else reviewReasons.push({code:'travel_location_coordinates_unknown',lineId:t.lineId});
  const minutes=t.time.value===null?null:Number(t.time.value)*(t.time.unit==='hour'?60:1);
  if(minutes===null)reviewReasons.push({code:'travel_duration_unknown',lineId:t.lineId});
  else{facts.push({lineId:t.lineId,kind:'declared_travel_minutes',minutes});if(Number.isFinite(policy.maxTravelMinutes)&&minutes>policy.maxTravelMinutes)reviewReasons.push({code:'travel_exceeds_declared_time',lineId:t.lineId});if(Number.isFinite(buffer)&&minutes>buffer)reviewReasons.push({code:'travel_buffer_review',lineId:t.lineId});}
  if(!source.targetOrigin||o.kind!=='business_location'||source.targetOrigin!==o.sourceId||!(source.locations||[]).some(l=>sha256(safeLocation(l))===sha256(safeLocation(o))))reviewReasons.push({code:'travel_target_origin_unknown',lineId:t.lineId});
  // Road route evidence is not produced by this declared planning feature.
  reviewReasons.push({code:'travel_driving_route_unverified',lineId:t.lineId});
 }
 const start=proposal.scheduledStart===null?null:Date.parse(proposal.scheduledStart),end=proposal.scheduledEnd===null?null:Date.parse(proposal.scheduledEnd);
 for(const a of basis.inputs.access){
  const e=a.source,current=!!e.effectiveOn&&e.effectiveOn<=today&&!!e.endsOn&&e.endsOn>=today;
  if(!current||a.appliesToJob!==true||a.start===null||a.end===null||!Number.isFinite(start)||!Number.isFinite(end)||a.status==='unknown'){reviewReasons.push({code:'travel_access_needs_review',lineId:a.lineId});continue;}
  if(a.status==='closed'&&start<Date.parse(a.end)&&end>Date.parse(a.start))hardConflicts.push({code:'travel_access_closed',lineId:a.lineId});
 }
 return stableValue({hardConflicts,reviewReasons,facts,digest:basis.digest});
}
function merge(result,addition){
 const distinct=rows=>[...new Map(rows.map(r=>[JSON.stringify(stableValue(r)),r])).entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,r])=>r);
 const hardConflicts=distinct([...result.hardConflicts,...addition.hardConflicts]),reviewReasons=distinct([...result.reviewReasons,...addition.reviewReasons]);
 if(hardConflicts.length>256||reviewReasons.length>256)throw Object.assign(new Error('There is too much travel information to review in one scheduling action. Review the travel plan first.'),{status:429,code:'TRAVEL_REVIEW_LIMIT'});
 return{...result,hardConflicts,reviewReasons,needsReview:reviewReasons.length>0,status:hardConflicts.length?'hard_conflict':reviewReasons.length?'needs_review':result.warnings.length?'warning':'clear'};
}
function sameInstant(a,b){return a===null&&b===null||a!==null&&b!==null&&Date.parse(a)===Date.parse(b);}
function cleanup(current,proposal){return current?.targetState==='assigned'&&proposal.target.kind==='unassigned'&&current.scheduleState===(proposal.scheduledStart===null?'unscheduled':'scheduled')&&sameInstant(current.scheduledStart,proposal.scheduledStart)&&sameInstant(current.scheduledEnd,proposal.scheduledEnd);}
function fromHistory(history,selected,sources,current,proposal){
 if(cleanup(current,proposal))return{notRecorded:true,digest:'none'};
 const latest=history[0],pin=selected?.componentManifest?.travel;let adopted=null;
 if(pin?.kind==='plan'){adopted=history.find(p=>p.id===pin.id&&p.revision===pin.revision&&p.digest===pin.digest&&sha256(p.sourcePins)===sha256(pin.sourcePins)&&p.action==='save');if(!adopted)throw Object.assign(new Error('The travel included in this estimate cannot be reviewed. Refresh the estimate and travel history.'),{status:409,code:'TRAVEL_BASIS_UNAVAILABLE'});}
 const make=p=>({notRecorded:false,inputs:p?.action==='save'?p.inputs:null,sourceChanged:p?.action!=='save',sources});
 const value=latest?make(latest):{notRecorded:true};if(adopted&&adopted.id!==latest?.id){value.adopted=make(adopted);value.sourceChanged=true;value.notRecorded=false;}
 value.planPin=latest?{id:latest.id,revision:latest.revision,digest:latest.digest}:null;value.adoptionPin=adopted?{id:selected.id,revision:selected.revision,digest:selected.digest,travel:pin}:null;return{...value,digest:sha256(value)};
}
function safeLocation(l){return {kind:l.kind,label:'',sourceId:l.sourceId,sourceDigest:l.sourceDigest,latitude:l.latitude,longitude:l.longitude};}
function safeSource(s){return {effectiveOn:s.effectiveOn,endsOn:s.endsOn,geography:s.geography.trim()?'Recorded':''};}
function safePlan(plan,sources,targetOrigin=null){
 if(!plan)return {notRecorded:true,digest:'none'};
 const pin={id:plan.id,revision:plan.revision,digest:plan.digest};
 if(plan.action!=='save')return {notRecorded:false,sourceChanged:true,planPin:pin};
 const inputs=plan.inputs,operations=require('../estimating/travelOperations'),resources=require('../estimating/travelResourceBasis').review(inputs,sources);
 const sourceRows=[...inputs.logistics,...inputs.hauls,...inputs.hauls.filter(h=>h.detail?.density).map(h=>({lineId:h.lineId,source:h.detail.density.source})),...(inputs.stagePlan?.resources||[]).map(x=>({...x,lineId:x.resourceId})),...(inputs.stagePlan?.stages||[]).map(x=>({...x,lineId:x.stageId}))];
 return {notRecorded:false,sourceChanged:plan.evidence?.digest!==sources.digest,planPin:pin,
 inputs:{serviceKey:inputs.serviceKey,trips:inputs.trips.map(t=>({lineId:t.lineId,origin:safeLocation(t.origin),destination:safeLocation(t.destination),distance:t.distance,time:t.time,source:safeSource(t.source)})),logistics:sourceRows.map(l=>({lineId:l.lineId,source:safeSource(l.source)})),access:inputs.access.map(a=>({lineId:a.lineId,status:a.status,start:a.start,end:a.end,appliesToJob:a.appliesToJob,source:safeSource(a.source)})),hauls:[],stagePlan:null},
 sources:{serviceKey:sources.serviceKey,locations:sources.locations.map(safeLocation),serviceArea:{maxRadiusMiles:sources.serviceArea?.maxRadiusMiles??null,maxTravelMinutes:sources.serviceArea?.maxTravelMinutes??null},bufferMinutes:sources.bufferMinutes??null,targetOrigin},
 haulingNeedsReview:!operations.bindLoads(inputs.hauls,inputs.loadBindings,inputs.trips).complete||resources.unknown.some(x=>x.kind==='haul_equipment_unknown'||x.kind==='resource_source_changed'&&inputs.hauls.length>0),stagesNeedReview:!!inputs.stagePlan&&(operations.stages(inputs.stagePlan).feasibleElapsedMinutes===null||resources.needsReview)};
}
async function read(client,input){const p=input.proposal,t=p.target;return (await client.query('SELECT public.canonical_travel_schedule_read($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[input.organizationId,input.actorUserId,input.actorAccessRole,input.authSessionId,input.appointmentId,t.kind,t.id,p.scheduledStart,p.scheduledEnd,input.expectedTimeZone])).rows[0].result;}
function demoBasis(state,item,proposal,now=new Date()){
 const saved=require('../commandCenter/demoScheduling').validateState(state).history.find(h=>h.appointmentId===item.ids.appointment)?.response.scheduleAuthority;
 if(cleanup(saved,proposal))return {notRecorded:true,digest:'none'};
 const history=state.travelPlans?.[item.ids.estimate]||[],selected=state.estimateRevisions?.[item.ids.estimate]?.[0],sources=require('../commandCenter/demoTravel').sources(state,item);
 const workforce=require('../commandCenter/demoWorkforce'),evidence=workforce.read(state),target=proposal.target;
 const eligible=workforce.candidate(evidence,target),record=eligible?(target.kind==='profile'?evidence.members.find(m=>m.profileId===target.id):evidence.crews.find(c=>c.id===target.id)):null;
 const targetOrigin=record?.homeLocationId??null;
 const raw=fromHistory(history,selected,sources,saved,proposal),latest=history[0],payload=safePlan(latest,sources,targetOrigin);
 payload.targetBasis={kind:target.kind,id:target.id,homeLocationId:targetOrigin,evidenceDigest:evidence?.digest??null};
 if(raw.adoptionPin){payload.adoptionPin=raw.adoptionPin;if(raw.adopted){const p=history.find(x=>x.id===raw.adoptionPin.travel.id);payload.adopted=safePlan(p,sources,targetOrigin);payload.notRecorded=false;payload.sourceChanged=true;}}
 return {...payload,digest:sha256(payload)};
}
module.exports={extra,merge,cleanup,fromHistory,safePlan,read,demoBasis};
