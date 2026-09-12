'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const contract=require('../estimating/travelPlanContract'),policy=require('../estimating/travelPlanPolicy');
function createExamples(workspace,graphs){
 const examples={};for(const graph of graphs){const scope=graph.polaris.snapshot.service.scope||{},distance=scope.customerDistanceMiles;examples[graph.ids.estimate]={version:'simulated-travel-example-v1',serviceKey:graph.polaris.snapshot.service.key,origin:workspace.territory?.headquarters?.formatted||'Simulated Operating Office',destination:typeof scope.address==='string'&&scope.address.trim()?scope.address:graph.customer.name+' Job Site',distance:typeof distance==='number'&&Number.isFinite(distance)&&distance>=0?String(distance):null,distanceBasis:'straight_line',vehicleRate:'0.60',laborRate:'30.00',note:'Simulated example rates only. Straight-line distance is not a driving route. Enter driving distance, travel time and crew size; review or replace the rates before saving.'};}return stableValue(examples);
}
function sources(state,item){
 const workspace=state.workspace,headquarters=workspace?.territory?.headquarters||workspace?.headquarters,locations=[];
 if(headquarters?.formatted&&headquarters.fictional===true)locations.push({kind:'business_location',label:headquarters.formatted,sourceId:'headquarters',sourceDigest:sha256(headquarters),latitude:headquarters.coordinates?.latitude??null,longitude:headquarters.coordinates?.longitude??null});
 const scope=item.snapshot.service.scope||{};
 if(typeof scope.address==='string'&&scope.address.trim())locations.push({kind:'recorded_job',label:scope.address,sourceId:item.ids.estimate,sourceDigest:sha256(scope),latitude:null,longitude:null});
 const raw=require('./demoEquipmentPlans').rawSources(state,item);
 const selected=state.estimateRevisions?.[item.ids.estimate]?.[0],equipmentHistory=state.equipmentPlans?.[item.ids.estimate]||[],adoptedId=selected?.equipmentCostPlan?.inputs?.equipmentBasis?.planId;
 const resourceChoices=require('../estimating/travelResourceBasis').choices([equipmentHistory[0],equipmentHistory.find(p=>p.id===adoptedId)],selected?.laborPlan,p=>p.evidence?.digest===require('./demoEquipmentPlans').rawSources(state,item,p.inputs).digest);
 const example=state.travelExamples?.[item.ids.estimate];const payload=stableValue({...(example?.version==='simulated-travel-example-v1'?{example}:{}),resourceChoices,locations,serviceKey:item.snapshot.service.key,profilePin:{id:'simulated-workspace',digest:sha256(workspace?.businessProfile||{})},serviceArea:{maxRadiusMiles:workspace?.territory?.radiusMiles??workspace?.radiusMiles??null},bufferMinutes:null,knowledgeRows:raw.knowledgeRows,scope,truncated:false,simulated:true});
 return{...payload,digest:sha256(payload)};
}
function project(state,item,review,now=new Date()){
 const history=state.travelPlans?.[item.ids.estimate]||[],raw=sources(state,item);
 const projected={...contract.project({current:history[0]||null,history,total:history.length},review,review.isCurrent&&policy.mutationsEnabled,true,!policy.mutationsEnabled,now),sources:require('../estimating/travelPlanRepository').presentSources(raw,require('./demoEquipmentPlans').actor(item))};for(const plan of [projected.current,...projected.history,review.adoptedTravelPlan].filter(Boolean))if(plan.action==='save')plan.resourceReview=require('../estimating/travelResourceBasis').review(plan.inputs,raw);return projected;
}
module.exports={sources,project,createExamples};
