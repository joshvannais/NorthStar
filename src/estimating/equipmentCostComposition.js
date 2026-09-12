'use strict';
// Version two is explicit: version-one readers/calculations retain their bytes.
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const previous=require('./costAdoptionContract');
const legacy=require('./materialAdoptionContract');
const equipment=require('./equipmentCostPlanContract');
const VERSION='estimate-cost-adoption-v2',MAX=99999999999999n;
function fail(message,status=400){throw Object.assign(new Error(message),{status,code:'COST_ADOPTION_INVALID'});}
function reference(plan){return plan?{...previous.reference(plan),...(plan.calculationVersion===equipment.VERSION?{equipmentBasis:plan.inputs.equipmentBasis}:{})}:{kind:'original'};}
function plans(selection){return{...previous.plans(selection),equipment:selection?.selected?.equipmentCostPlan||null};}
function manifest(p){return stableValue({material:reference(p.material),labor:reference(p.labor),equipment:reference(p.equipment)});}
function components(selection){const s=selection?.selected;if(s?.calculationVersion===VERSION)return stableValue(s.componentManifest);return stableValue({...previous.components(selection),equipment:{kind:'original'}});}
function compose(selection,component,plan){if(!['material','labor','equipment'].includes(component))fail('Choose the cost plan to apply.');return{...plans(selection),[component]:plan};}
function outsideBasis(selection,item){return stableValue({operator:components(selection).labor,travel:{kind:'original',originalSourcePins:selection?.selected?.originalSourcePins||item.sourcePins||null}});}
function calculate(item,pair){
 // Reuse the immutable v1 calculation for material/labor and original travel.
 // Its aggregate may be incomplete solely because original equipment was unknown.
 const e=pair.equipment;
 // Exclude the component being replaced before the legacy aggregate bounds
 // check. A large original equipment value cannot block a smaller replacement.
 const base=previous.calculate(e?{...item,snapshot:{...item.snapshot,knownEquipmentCost:0}}:item,pair);
 if(e&&(e.action!=='save'||e.currency!==base.currency||e.calculationVersion!==equipment.VERSION))fail('The saved equipment cost plan is unavailable.');
 const er=e?equipment.calculate(e.inputs,e.currency):null;
 if(er&&!er.complete)fail('Resolve the missing equipment costs and outside-cost coverage before applying this plan.');
 const values={material:legacy.cents(base.knownDirectMaterialCost),labor:legacy.cents(base.knownInternalLaborCost),equipment:e?legacy.cents(er.total):legacy.cents(base.knownEquipmentCost),travel:legacy.cents(base.knownTravelInternalCost)};
 const applicability={...base.applicability,equipment:e?true:base.applicability.equipment};
 const changedCoverage=[];
 if(e){const originalPins={...e.sourcePins};delete originalPins.revision;const expected={operator:reference(pair.labor),travel:{kind:'original',originalSourcePins:originalPins}};
  for(const line of e.inputs.lines){const charges=[line.rental?.charge,line.allocation?.pool,...(line.allocation?.additionalCosts||[]).map(c=>c.charge),...[line.operating?.allIn,line.operating?.fuelEnergy,line.operating?.consumables,line.operating?.maintenance].map(c=>c?.rate)].filter(Boolean);
   for(const charge of charges)if(charge.scope==='mixed')for(const kind of ['operator','travel']){const share=legacy.cents(charge.split[kind]),coverage=charge.split[kind+'Coverage'];if(share!==null&&share>0n&&coverage.status==='covered'&&sha256(coverage.basis)!==sha256(expected[kind])&&!changedCoverage.includes(kind))changedCoverage.push(kind);}
  }
 }
 const complete=changedCoverage.length===0&&item.snapshot.service?.supported===true&&Object.values(applicability).every(v=>v!==null)&&Object.keys(values).every(k=>applicability[k]!==true||values[k]!==null);
 const total=complete?Object.keys(values).reduce((n,k)=>n+(applicability[k]===true?values[k]:0n),0n):null;
 if(total!==null&&total>MAX)fail('Combined costs are too large. Review the plans.');
 return stableValue({...base,calculationVersion:VERSION,equipment:er,knownEquipmentCost:legacy.decimal(values.equipment),knownDirectCosts:legacy.decimal(total),applicability,changedEquipmentCoverage:changedCoverage});
}
function normalize(body){
 if(body?.confirmationVersion!==VERSION||!['material','labor','equipment'].includes(body.changedComponent))fail('Review the selected cost plan and estimate change.');
 // Validate the common envelope through v1 without changing its accepted domain.
 const normalized=previous.normalize({...body,confirmationVersion:previous.VERSION,changedComponent:body.changedComponent==='equipment'?'labor':body.changedComponent});
 if(!body.expectedComponents||Object.keys(body.expectedComponents).length!==3||!['material','labor','equipment'].every(k=>Object.hasOwn(body.expectedComponents,k)))fail('Refresh the estimate comparison before continuing.',409);
 return stableValue({...normalized,confirmationVersion:VERSION,changedComponent:body.changedComponent});
}
function checkBasis(body,review,selection,plan){
 const d=review.decisions.writeBasis;
 if(review.isCurrent===false||!plan||plan.action!=='save'||plan.currency!==review.currency||body.expectedPlanId!==plan.id||body.expectedPlanRevision!==plan.revision||body.expectedPlanDigest!==plan.digest||sha256(plan.sourcePins)!==sha256(review.pins)||sha256(body.sourcePins)!==sha256(review.pins)||body.expectedDecisionRevision!==d.revision||body.expectedDecisionDigest!==d.digest||sha256(body.expectedComponents)!==sha256(components(selection)))fail('The estimate, cost plan or price review changed. Refresh and review again.',409);
 if(components(selection)[body.changedComponent]?.id===plan.id)fail('This cost plan is already included in the estimate.',409);
}
function assessment(pair,serviceKey,now){return stableValue({...previous.assessment(pair,serviceKey,now),equipmentSource:pair.equipment?equipment.sourceAssessment(pair.equipment.inputs,now):null});}
function preview(item,selection,review,plan,component,now){if(!plan)fail('Save a current cost plan before applying it.');const pair=compose(selection,component,plan);return stableValue({result:calculate(item,pair),sourcePins:review.pins,planId:plan.id,planDigest:plan.digest,decisionBasis:review.decisions.writeBasis,expectedComponents:components(selection),componentManifest:manifest(pair),assessment:assessment(pair,review.materialSourceContext.serviceKey,now)});}
function checkEvidence(item,selection,review,body,plan,now){checkBasis(body,review,selection,plan);if(body.changedComponent==='material'&&['estimate-material-plan-v3','estimate-material-plan-v4'].includes(plan.calculationVersion))require('./materialPlanContract').checkEvidence(plan.inputs,plan.currency,plan.calculationVersion,{now,serviceKey:review.materialSourceContext.serviceKey},true);if(body.changedComponent==='labor'&&plan.inputs.serviceKey!==review.materialSourceContext.serviceKey)fail('The service changed. Review the labor plan again.',409);if(body.changedComponent==='equipment')equipment.checkCoverage(plan.inputs,outsideBasis(selection,{...item,sourcePins:selection.originalPins}));const p=preview(item,selection,review,plan,body.changedComponent,now);if(sha256(body.assessment)!==sha256(p.assessment))fail('Cost source information changed. Refresh the comparison and confirm again.',409);return p;}
module.exports={VERSION,reference,plans,manifest,components,compose,outsideBasis,calculate,normalize,checkBasis,assessment,preview,checkEvidence};
