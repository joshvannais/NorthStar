'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const previous=require('./equipmentCostComposition'),old=require('./costAdoptionContract'),legacy=require('./materialAdoptionContract');
const travel=require('./travelPlanContract'),math=require('./travelCalculation'),equipment=require('./equipmentCostPlanContract');
const VERSION='estimate-cost-adoption-v3',KINDS=['material','labor','equipment','travel'];
function fail(message,status=400){throw Object.assign(new Error(message),{status,code:'TRAVEL_COVERAGE_INVALID'});}
function reference(p){return previous.reference(p);}
function plans(selection){return{...previous.plans(selection),travel:selection?.selected?.travelPlan||null};}
function manifest(p){return stableValue(Object.fromEntries(KINDS.map(k=>[k,reference(p[k])])));}
function components(selection){return selection?.selected?.calculationVersion===VERSION?stableValue(selection.selected.componentManifest):stableValue({...previous.components(selection),travel:{kind:'original'}});}
function compose(selection,component,plan){if(!KINDS.includes(component))fail('Choose the cost plan to apply.');return{...plans(selection),[component]:plan};}
function outsideShares(plan){
 if(!plan)return[];const result=[];
 for(const l of plan.inputs.lines){const sums={operator:math.rational(0n),travel:math.rational(0n)},h=math.qty(l.plannedHours);
  function include(c,n,d){if(c?.scope!=='mixed')return;for(const k of ['operator','travel']){const m=math.money(c.split[k]);if(m===null||n===null||d===null)fail('Complete the equipment bundle allocations before reviewing coverage.');sums[k]=math.add(sums[k],math.rational(m*n,d));}}
  if(l.rental)include(l.rental.charge,math.qty(l.rental.quantity),math.SCALE);
  if(l.allocation){const d=math.qty(l.allocation.usableHours);include(l.allocation.pool,h,d);for(const c of l.allocation.additionalCosts)include(c.charge,h,d);}
  for(const r of [l.operating?.allIn,l.operating?.fuelEnergy,l.operating?.consumables,l.operating?.maintenance])if(r?.status==='known')include(r.rate,h,math.SCALE);
  for(const k of ['operator','travel'])if(sums[k].n>0n)result.push({equipmentLineId:l.lineId,kind:k,amount:math.decimal(math.round(sums[k]))});
 }return result;
}
function capacity(base,pair,kind,lineId){
 if(kind==='travel'){const line=[...(base.travel?.trips||[]),...(base.travel?.logistics||[])].find(l=>l.lineId===lineId);return line?.total===null?null:legacy.cents(line?.total);}
 if(kind==='labor'||kind==='equipment'){const r=base[kind];if(pair[kind])return legacy.cents(r.lines.find(l=>l.lineId===lineId)?.total||r.lines.find(l=>l.lineId===lineId)?.knownCostSubtotal);if(lineId!=='original')return null;return legacy.cents(base[kind==='labor'?'knownInternalLaborCost':'knownEquipmentCost']);}
 return null;
}
function categoryCapacity(base,lineId,category){
 const trip=base.travel?.trips?.find(l=>l.lineId===lineId);
 if(trip){const part=trip.contributions.find(c=>c.category===category);if(!part?.exactCents)return null;return BigInt(part.exactCents.numerator)/BigInt(part.exactCents.denominator);}
 const line=base.travel?.logistics?.find(l=>l.lineId===lineId&&l.category===category);return line?.total===null?null:legacy.cents(line?.total);
}
function reconcile(base,pair,coverage){
 if(!math.exact(coverage,Object.hasOwn(coverage,'travelOutside')?['componentManifest','overlaps','equipmentOutside','travelOutside','confirmed','reason']:['componentManifest','overlaps','equipmentOutside','confirmed','reason'])||sha256(coverage.componentManifest)!==sha256(manifest(pair))||coverage.confirmed!==true||!math.text(coverage.reason,1000)||!Array.isArray(coverage.overlaps)||coverage.overlaps.length>24||!Array.isArray(coverage.equipmentOutside)||coverage.equipmentOutside.length>24)fail('Review where the travel and equipment costs are included.',409);
 const claimed=new Map(),deducted=new Map();let deduction=0n;
 function take(key,amount,limit){if(amount===null||amount<=0n||limit===null)fail('Coverage needs a known positive amount and an exact saved cost line.');const total=(claimed.get(key)||0n)+amount;if(total>limit)fail('The covered amount exceeds the saved cost. Review its allocation.');claimed.set(key,total);}
 for(const a of coverage.overlaps){if(!math.exact(a,['travelLineId','category','component','sourceLineId','amount','reason'])||!['labor','equipment'].includes(a.component)||!math.text(a.reason,500))fail('Identify the exact labor or equipment cost that already covers travel.');const amount=math.money(a.amount),t=capacity(base,pair,'travel',a.travelLineId),s=capacity(base,pair,a.component,a.sourceLineId);take('source:'+a.component+':'+a.sourceLineId,amount,s);take('travel:'+a.travelLineId,amount,t);take('category:'+a.travelLineId+':'+a.category,amount,categoryCapacity(base,a.travelLineId,a.category));deducted.set(a.travelLineId,(deducted.get(a.travelLineId)||0n)+amount);deduction+=amount;}
 const expected=outsideShares(pair.equipment),seen=new Set();
 for(const a of coverage.equipmentOutside){if(!math.exact(a,['equipmentLineId','kind','component','targetLineId','targetCategory','amount','reason'])||!['operator','travel'].includes(a.kind)||!['labor','travel'].includes(a.component)||a.kind==='operator'&&a.component!=='labor'||!math.text(a.reason,500))fail('Identify where each equipment bundle share is included.');const key=a.equipmentLineId+':'+a.kind,e=expected.find(x=>x.equipmentLineId===a.equipmentLineId&&x.kind===a.kind);if(!e||seen.has(key)||a.amount!==e.amount)fail('Review every equipment bundle share exactly once.');seen.add(key);const amount=math.money(a.amount);if(a.component==='labor'&&a.targetCategory!=='travel_labor')fail('Identify the labor allocation category.');if(a.component==='travel')take('category:'+a.targetLineId+':'+a.targetCategory,amount,categoryCapacity(base,a.targetLineId,a.targetCategory));let limit=capacity(base,pair,a.component,a.targetLineId);if(a.component==='travel'&&limit!==null)limit-=deducted.get(a.targetLineId)||0n;take('source:'+a.component+':'+a.targetLineId,amount,limit);}
 const required=(pair.travel?.inputs.trips||[]).filter(t=>t.vehicle.method==='consumption'&&t.vehicle.otherCosts.status==='included_elsewhere'),outside=coverage.travelOutside||[],outsideSeen=new Set();if(!Array.isArray(outside)||outside.length>12)fail('Review the other vehicle costs already included in equipment.');
 for(const a of outside){if(!math.exact(a,['travelLineId','component','sourceLineId','amount','reason'])||a.component!=='equipment'||!math.text(a.reason,500)||outsideSeen.has(a.travelLineId)||!required.some(t=>t.lineId===a.travelLineId))fail('Identify each trip and the equipment amount that covers its other vehicle costs.');outsideSeen.add(a.travelLineId);take('source:equipment:'+a.sourceLineId,math.money(a.amount),capacity(base,pair,'equipment',a.sourceLineId));}
 if(outsideSeen.size!==required.length)fail('Identify the recorded equipment amount covering the other vehicle costs for every fuel-only trip.');
 if(seen.size!==expected.length)fail('Some equipment bundle costs are not yet accounted for.');
 return{deduction,assessment:stableValue({componentManifest:manifest(pair),overlaps:coverage.overlaps,equipmentOutside:coverage.equipmentOutside,...(Object.hasOwn(coverage,'travelOutside')?{travelOutside:coverage.travelOutside}:{}),reason:coverage.reason,confirmed:true})};
}
function calculate(item,pair,coverage){
 const t=pair.travel,e=pair.equipment;
 // Exclude replaced original components before old aggregate bounds; old versions
 // and their immutable input objects are never modified.
 const adjusted={...item,snapshot:{...item.snapshot,...(e?{knownEquipmentCost:0}:{}),...(t?{travel:{...item.snapshot.travel,distanceMiles:0,knownInternalCost:0}}:{})}};
 const base=old.calculate(adjusted,pair);
 if(t&&(t.action!=='save'||t.currency!==base.currency||t.calculationVersion!==travel.VERSION))fail('The saved travel plan is unavailable.');
 if(e&&(e.action!=='save'||e.currency!==base.currency||e.calculationVersion!==equipment.VERSION))fail('The saved equipment plan is unavailable.');
 const tr=t?travel.calculate(t.inputs,t.currency):null,er=e?equipment.calculate(e.inputs,e.currency):null;
 if(tr&&!tr.complete)fail('Complete the missing travel costs before applying this plan.');
 if(er&&er.lines.some(l=>l.missing.length))fail('Complete the equipment costs before reviewing coverage.');
 const result={...base,travel:tr,equipment:er,knownEquipmentCost:er?er.knownCostSubtotal:base.knownEquipmentCost};
 const {deduction,assessment}=reconcile(result,pair,coverage),travelCents=t?math.money(tr.total)-deduction:legacy.cents(base.knownTravelInternalCost);
 if(travelCents!==null&&travelCents<0n)fail('Coverage cannot exceed the travel cost.');
 const values={material:legacy.cents(base.knownDirectMaterialCost),labor:legacy.cents(base.knownInternalLaborCost),equipment:legacy.cents(result.knownEquipmentCost),travel:travelCents};
 const applicability={...base.applicability,equipment:e?true:base.applicability.equipment,travel:t?true:base.applicability.travel};
 const complete=item.snapshot.service?.supported===true&&Object.values(applicability).every(v=>v!==null)&&KINDS.every(k=>applicability[k]!==true||values[k]!==null);
 const known=KINDS.reduce((n,k)=>n+(applicability[k]===true&&values[k]!==null?values[k]:0n),0n);if(known>math.MAX)fail('Combined costs are too large. Review the plans.');
 return stableValue({...result,calculationVersion:VERSION,knownTravelInternalCost:math.decimal(travelCents),travelGrossCost:tr?.total||null,travelAlreadyIncluded:math.decimal(deduction),knownDirectCosts:complete?math.decimal(known):null,knownDirectCostSubtotal:math.decimal(known),applicability,coverageAssessment:assessment,changedEquipmentCoverage:[],overhead:null,grossProfit:null,netProfit:null});
}
function normalize(body){
 if(!body||body.confirmationVersion!==VERSION||!KINDS.includes(body.changedComponent)||!body.coverage)fail('Review the travel allocation and estimate change.');const {coverage,...common}=body;
 const normalized=old.normalize({...common,confirmationVersion:old.VERSION,changedComponent:body.changedComponent==='material'?'material':'labor'});
 if(!math.exact(body.expectedComponents,KINDS))fail('Refresh the estimate comparison.',409);return stableValue({...normalized,confirmationVersion:VERSION,changedComponent:body.changedComponent,coverage});
}
function checkBasis(body,review,selection,plan){const d=review.decisions.writeBasis;if(review.isCurrent===false||!plan||plan.action!=='save'||plan.currency!==review.currency||body.expectedPlanId!==plan.id||body.expectedPlanRevision!==plan.revision||body.expectedPlanDigest!==plan.digest||sha256(plan.sourcePins)!==sha256(review.pins)||sha256(body.sourcePins)!==sha256(review.pins)||body.expectedDecisionRevision!==d.revision||body.expectedDecisionDigest!==d.digest||sha256(body.expectedComponents)!==sha256(components(selection)))fail('The estimate, plan or price review changed. Refresh and review again.',409);if(components(selection)[body.changedComponent]?.id===plan.id)fail('This plan is already included in the estimate.',409);}
function assessment(pair,serviceKey,now){return stableValue({...previous.assessment(pair,serviceKey,now),travelSource:pair.travel?travel.sourceAssessment(pair.travel.inputs,now):null});}
function preview(item,selection,review,plan,component,now,coverage){const pair=compose(selection,component,plan);return stableValue({result:calculate(item,pair,coverage),sourcePins:review.pins,planId:plan.id,planDigest:plan.digest,decisionBasis:review.decisions.writeBasis,expectedComponents:components(selection),componentManifest:manifest(pair),coverage,assessment:assessment(pair,review.materialSourceContext.serviceKey,now)});}
function checkEvidence(item,selection,review,body,plan,now){checkBasis(body,review,selection,plan);if(body.changedComponent==='material'&&['estimate-material-plan-v3','estimate-material-plan-v4'].includes(plan.calculationVersion))require('./materialPlanContract').checkEvidence(plan.inputs,plan.currency,plan.calculationVersion,{now,serviceKey:review.materialSourceContext.serviceKey},true);if(['labor','travel'].includes(body.changedComponent)&&plan.inputs.serviceKey!==review.materialSourceContext.serviceKey)fail('The service changed. Review the saved plan again.',409);const p=preview(item,selection,review,plan,body.changedComponent,now,body.coverage);if(sha256(p.assessment)!==sha256(body.assessment))fail('The cost source review changed. Refresh and confirm again.',409);return p;}
function coverageChoices(review){
 const retained={material:review.adoptedMaterialPlan||null,labor:review.adoptedLaborPlan||null,equipment:review.adoptedEquipmentCostPlan||null,travel:review.adoptedTravelPlan||null};
 const current={material:review.materialPlans?.current,labor:review.laborPlans?.current,equipment:review.equipmentCostPlans?.current,travel:review.travelPlans?.current},choices={};
 for(const kind of KINDS){if(current[kind]?.action!=='save')continue;const pair={...retained,[kind]:current[kind]};let outside;
 try{outside=outsideShares(pair.equipment);}catch(_){choices[kind]={unavailable:true};continue;}
 const costLines={};for(const k of ['labor','equipment']){const p=pair[k];costLines[k]=p?p.inputs.lines.map((l,i)=>({id:l.lineId,label:l.task||l.label||'Cost '+(i+1)})):[{id:'original',label:'Original '+k+' cost'}];}
 const t=pair.travel,tr=t?travel.calculate(t.inputs,t.currency):null;
 const travelLines=tr?[...tr.trips.map((l,i)=>({id:l.lineId,label:t.inputs.trips[i].purpose,categories:l.contributions.filter(c=>c.exactCents).map(c=>({category:c.category,amount:math.decimal(BigInt(c.exactCents.numerator)/BigInt(c.exactCents.denominator))}))})),...tr.logistics.map((l,i)=>({id:l.lineId,label:t.inputs.logistics[i].label,categories:l.total===null?[]:[{category:l.category,amount:l.total}]}))]:[];
 choices[kind]={componentManifest:manifest(pair),costLines,travelLines,travelOutside:(t?.inputs.trips||[]).filter(l=>l.vehicle.method==='consumption'&&l.vehicle.otherCosts.status==='included_elsewhere').map(l=>({travelLineId:l.lineId,label:l.purpose})),equipmentOutside:outside.map(x=>({...x,label:pair.equipment.inputs.lines.find(l=>l.lineId===x.equipmentLineId)?.label||'Equipment Cost'}))};
 }return stableValue(choices);
}
module.exports={VERSION,KINDS,coverageChoices,reference,plans,manifest,components,compose,outsideShares,reconcile,calculate,normalize,checkBasis,assessment,preview,checkEvidence};
