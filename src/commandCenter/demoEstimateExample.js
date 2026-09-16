'use strict';

const {calculateCanonicalPolaris, CALCULATION_VERSION}=require('../services/canonicalPolarisCalculation');
const {sha256,stableValue}=require('../services/businessProfileAdapter');
const {v5:uuidv5}=require('uuid');
const {packs,questionsFor}=require('./industryIntelligence');
const treeProfiles=require('./demoTreeBusinessProfiles');

function round(value){return Math.round(Number(value)*100)/100;}
function concreteExample(graph,baseScope) {
  const squareFeet=Math.max(1,Number(baseScope.squareFeet)||1);
  const companyProfile=graph.businessProfile&&graph.businessProfile.industryProfiles&&graph.businessProfile.industryProfiles.concrete||require('./demoConcreteBusinessProfile').create();
  const slabThicknessInches=companyProfile.defaults.slabThicknessInches,wastePercent=companyProfile.defaults.wastePercent;
  const concreteOrderCubicYards=round(squareFeet*(slabThicknessInches/12)/27*(1+wastePercent/100));
  // The fictional company rate is anchored to public supplier price sheets, then
  // recorded as a dated profile input. It is a demo benchmark, not a local quote.
  const readyMixInternalRate=companyProfile.materials.readyMixInternalRatePerCubicYard,materialMarkupPercent=companyProfile.materials.customerMarkupPercent;
  const readyMixCustomerRate=round(readyMixInternalRate*(1+materialMarkupPercent/100));
  const supportingMaterialInternalRate=companyProfile.materials.supportingMaterialInternalRatePerSquareFoot,supportingMaterialCustomerRate=round(supportingMaterialInternalRate*(1+materialMarkupPercent/100));
  const readyMixDeliveryCost=companyProfile.materials.readyMixDeliveryFee;
  const hasRemoval=baseScope.existingRemoval===true;
  const crewSize=companyProfile.workforce.crewSize,productionHours=hasRemoval?16:10,averageHourlyCost=companyProfile.workforce.averageLoadedHourlyCost;
  const equipmentReference=hasRemoval?'concrete-removal-and-finishing':'concrete-placement-and-finishing';
  const internalMaterial=round(concreteOrderCubicYards*readyMixInternalRate+readyMixDeliveryCost+squareFeet*supportingMaterialInternalRate);
  const internalEquipment=hasRemoval?companyProfile.equipment.withRemovalInternalCost:companyProfile.equipment.placementInternalCost;
  const crewMobilizationHours=companyProfile.logistics.crewMobilizationHours,customerLaborMultiplier=companyProfile.logistics.customerLaborMultiplier,equipmentTransportCharge=companyProfile.equipment.transportCustomerCharge;
  const mobilizationCharge=round(readyMixDeliveryCost+crewSize*crewMobilizationHours*averageHourlyCost*customerLaborMultiplier+equipmentTransportCharge);
  const scope={...baseScope,slabThicknessInches,wastePercent,concreteOrderCubicYards,
    laborHours:productionHours,equipmentReference,plannedCrewSize:crewSize,
    estimateBasis:`${squareFeet} square feet at an assumed ${slabThicknessInches}-inch slab depth, including ${wastePercent}% order allowance${hasRemoval?', existing-concrete removal':''}.`};
  const finish=String(baseScope.finish||'standard').replace(/_/g,' ');
  const profile={version:'fictional-concrete-cost-profile-v2',company:{name:graph.businessProfile.company,currency:'USD'},
    crew:{defaultCrewSize:crewSize,averageHourlyRate:averageHourlyCost},
    canonicalPricing:{customerMarkupPercent:0,travelCustomerChargePerMile:0,emergencyMultiplier:1,taxRatePercent:0,defaultRangePercent:10},
    canonicalCosts:{overheadPercent:12,travelCostPerMile:.85,
      materialCostByService:{'concrete:':internalMaterial},
      equipmentCostByReference:{[equipmentReference]:internalEquipment}},
    services:[{id:'concrete',name:graph.lead.serviceLabel,crewSize,equipmentReference,canonicalPricing:{
      requiredScope:['squareFeet','concreteOrderCubicYards'],rangePercent:10,lineItems:[
        {code:'concrete-ready-mix',label:`Ready-mix concrete · ${concreteOrderCubicYards} yd³ at $${readyMixCustomerRate}/yd³`,category:'materials',type:'perUnit',quantityField:'concreteOrderCubicYards',unitRate:readyMixCustomerRate},
        {code:'concrete-supporting-materials',label:`Reinforcement, base, forms, joints and curing supplies · $${supportingMaterialCustomerRate}/sq ft`,category:'materials',type:'perUnit',quantityField:'squareFeet',unitRate:supportingMaterialCustomerRate},
        {code:'concrete-preparation-and-placement',label:`Site preparation, placement and ${finish} finishing · $${Number(companyProfile.pricing.laborCustomerRatePerSquareFoot).toFixed(2)}/sq ft`,category:'labor',type:'perUnit',quantityField:'squareFeet',unitRate:companyProfile.pricing.laborCustomerRatePerSquareFoot},
        {code:'concrete-removal-equipment',label:'Existing concrete removal equipment',category:'equipment',type:'fixed',amount:companyProfile.equipment.removalCustomerCharge,when:{field:'existingRemoval',equals:true}},
        {code:'concrete-finishing-equipment',label:'Compaction, placement and finishing equipment',category:'equipment',type:'fixed',amount:companyProfile.equipment.finishingCustomerCharge},
        {code:'concrete-delivery-mobilization',label:'Concrete delivery, equipment transport and crew mobilization',category:'travel',type:'fixed',amount:mobilizationCharge},
        {code:'concrete-removal-disposal',label:'Removal hauling and disposal',category:'travel',type:'fixed',amount:companyProfile.pricing.removalAndDisposalCharge,when:{field:'existingRemoval',equals:true}},
      ]}}]};
  return {scope,profile,travel:{distanceMiles:Number(baseScope.customerDistanceMiles)||10,minutes:25,source:'fictional_demo_distance'},details:{
    squareFeet,slabThicknessInches,wastePercent,concreteOrderCubicYards,crewSize,productionHours,internalMaterial,internalEquipment,
    businessRateBasis:{profileVersion:companyProfile.version,materialMarkupPercent,supportingMaterialInternalRate,averageHourlyCost,crewMobilizationHours,customerLaborMultiplier,equipmentTransportCharge,removalAndDisposalCharge:hasRemoval?companyProfile.pricing.removalAndDisposalCharge:0},
    researchBasis:{accessedOn:'2026-09-15',geography:'US public supplier benchmarks',sources:companyProfile.sources},note:'Fictional business-profile assumptions are explicit and replace the former flat material placeholder. Local supplier quotes still control a real estimate.'}};
}
function treeScale(scope) {
  const sizes={small:.7,medium:1,large:1.35,'very large':1.75,'not yet assessed':1};
  const access={'open yard access':.9,'moderate backyard access':1.05,'restricted access':1.28};
  const condition={'routine condition':1,'declining or damaged':1.12,'high-risk condition':1.35,'requires onsite assessment':1};
  const disposal={'leave usable wood':.92,'chip branches onsite':1.02,'haul all debris':1.14,'not selected':1};
  const count=Math.max(1,Number(scope.treeCount)||1);
  const countScale=1+(count-1)*.62;
  const proximity=scope.nearStructure===true?1.12:1;
  return round((sizes[scope.sizeClass]||1)*(access[scope.accessClass]||1)*(condition[scope.conditionClass]||1)*(disposal[scope.disposalChoice]||1)*countScale*proximity);
}

function treeExample(graph,baseScope) {
  const operation=baseScope.jobType&&treeProfiles.OPERATIONS[baseScope.jobType]?baseScope.jobType:'visit';
  baseScope={...treeProfiles.scenarioFactors(graph.ids.graph,operation),...baseScope};
  const definition=treeProfiles.OPERATIONS[operation];
  const treeProfile=graph.businessProfile&&graph.businessProfile.industryProfiles&&graph.businessProfile.industryProfiles.tree||treeProfiles.create(graph.ids.graph);
  const scale=treeScale(baseScope);
  const crewSize=Math.max(1,treeProfile.workforce.people);
  const plannedCrewHours=round(Math.max(1,definition.workerHours/crewSize*scale));
  const equipment=treeProfiles.equipmentFor(treeProfile,operation);
  const equipmentBundle=treeProfiles.equipmentBundleFor(treeProfile,operation);
  const vehiclePlan=treeProfiles.vehiclePlanFor(treeProfile,operation);
  const averageHourlyCost=round((treeProfile.workforce.labor.crewLeadLoadedHourlyCost+
    (treeProfile.workforce.hasQualifiedClimber?treeProfile.workforce.labor.climberLoadedHourlyCost:treeProfile.workforce.labor.groundWorkerLoadedHourlyCost)+
    Math.max(0,crewSize-2)*treeProfile.workforce.labor.groundWorkerLoadedHourlyCost)/crewSize);
  const internalMaterial=round(definition.materialCost*scale);
  const internalEquipment=round(equipmentBundle.reduce((total,item)=>total+treeProfiles.perJobEquipmentCost(item,plannedCrewHours),0));
  const basePrice=round(definition.basePrice*scale);
  const laborCharge=round(basePrice*.58),materialCharge=round(basePrice*.08),equipmentCharge=round(basePrice*.24);
  const mobilizationCharge=round(basePrice-laborCharge-materialCharge-equipmentCharge);
  const scope={...baseScope,laborHours:plannedCrewHours,equipmentReference:equipment.key,
    plannedCrewSize:crewSize,equipmentName:equipment.name,crewProfile:treeProfile.label,
    equipmentPlan:equipmentBundle.map(item=>item.name),vehiclePlan,inventoryPlan:equipmentBundle.filter(item=>(treeProfile.inventory||[]).some(tool=>tool.key===item.key)).map(item=>item.name),
    estimateBasis:`${baseScope.treeCount||1} ${baseScope.sizeClass||''} ${operation} job; ${baseScope.accessClass||'access pending'}; ${baseScope.conditionClass||'condition pending'}; ${baseScope.disposalChoice||'disposal pending'}.`};
  const materialKey='tree:'+operation;
  const profile={version:treeProfile.version,company:{name:graph.businessProfile.company,currency:'USD'},
    crew:{defaultCrewSize:crewSize,averageHourlyRate:averageHourlyCost},
    canonicalPricing:{customerMarkupPercent:0,travelCustomerChargePerMile:1.15,emergencyMultiplier:operation==='storm'?1.18:1,taxRatePercent:0,defaultRangePercent:operation==='visit'?5:12},
    canonicalCosts:{overheadPercent:12,travelCostPerMile:.72,materialCostByService:{[materialKey]:internalMaterial},equipmentCostByReference:{[equipment.key]:internalEquipment}},
    services:[{id:'tree',name:graph.lead.serviceLabel,crewSize,equipmentReference:equipment.key,canonicalPricing:{requiredScope:['requestedWork','treeCount','sizeClass','accessClass','conditionClass','disposalChoice'],rangePercent:operation==='visit'?5:12,lineItems:[
      {code:'tree-labor',label:definition.laborTask,category:'labor',type:'fixed',amount:laborCharge},
      {code:'tree-materials',label:definition.material,category:'materials',type:'fixed',amount:materialCharge},
      {code:'tree-equipment',label:'Equipment, tools and jobsite machinery',category:'equipment',type:'fixed',amount:equipmentCharge},
      {code:'tree-mobilization',label:'Mobilization and disposal planning',category:'serviceCharge',type:'fixed',amount:mobilizationCharge},
    ]}}]};
  scope.material=operation;
  return {scope,profile,travel:{distanceMiles:Number(baseScope.customerDistanceMiles)||0,minutes:null,source:'fictional_demo_distance'},details:{operation,scale,crewSize,plannedCrewHours,equipment:equipmentBundle.map(item=>item.name),vehicles:vehiclePlan,internalMaterial,internalEquipment,averageHourlyCost,profile:treeProfile.label}};
}

// New/reset and simulated demo jobs share an explicitly fictional cost example.
// Store the shared calculator's output once; existing saved demo graphs stay unchanged.
function addRecordedCostExample(tenantId, graph) {
  const key=graph.lead.serviceType;
  const pack=packs[key];
  const tree=key==='tree'?treeExample(graph,graph.polaris.snapshot.service.scope):null;
  const concrete=key==='concrete'?concreteExample(graph,graph.polaris.snapshot.service.scope):null;
  const scope=tree?{...tree.scope,assessmentQuestions:questionsFor(key,tree.scope.jobType)}:concrete?concrete.scope:pack?{...graph.polaris.snapshot.service.scope,assessmentQuestions:questionsFor(key,graph.polaris.snapshot.service.scope.jobType)}:{...graph.polaris.snapshot.service.scope,laborHours:8,equipmentReference:'fictional-shared-equipment'};
  let profile=tree?tree.profile:concrete?concrete.profile:{version:'fictional-cost-example-v1',company:{name:graph.businessProfile.company,currency:'USD'},
    crew:{defaultCrewSize:2,averageHourlyRate:50},
    canonicalPricing:{customerMarkupPercent:0,travelCustomerChargePerMile:0,emergencyMultiplier:1,taxRatePercent:0},
    canonicalCosts:{overheadPercent:10,travelCostPerMile:0.6,materialCostByService:{[key+':'+String(scope.material||'').toLowerCase()]:500},equipmentCostByReference:{'fictional-shared-equipment':100}},
    services:[{id:key,name:graph.lead.serviceLabel,crewSize:2,equipmentReference:'fictional-shared-equipment',canonicalPricing:{requiredScope:['laborHours','equipmentReference'],rangePercent:10,lineItems:[
      {code:'fictional-labor',label:'Illustrative labor charge',category:'labor',type:'fixed',amount:graph.estimate.customerPrice-750},
      {code:'fictional-materials',label:'Illustrative material charge',category:'materials',type:'fixed',amount:600},
      {code:'fictional-equipment',label:'Illustrative equipment charge',category:'equipment',type:'fixed',amount:150},
    ]}}]};
  if(pack&&!tree){
    // A typed canonical example is not evidence for a production crew, yield or rate.
    profile.version='fictional-provisional-industry-v1';
    profile.crew={};profile.canonicalCosts={};
    profile.services=[{id:key,name:graph.lead.serviceLabel,canonicalPricing:{requiredScope:['requestedWork'],rangePercent:10,lineItems:[{code:'fictional-consideration',label:'Illustrative amount for practicing review',category:'labor',type:'fixed',amount:graph.estimate.customerPrice}]}}];
  }
  const input={organizationId:tenantId,customerId:graph.ids.customer,opportunityId:graph.ids.lead,calculationVersion:CALCULATION_VERSION,
    service:{key,scope},facts:pack?graph.polaris.facts:[],transcript:pack?graph.communication.transcript:[],businessProfile:profile,
    businessProfileAuthority:{id:uuidv5('fictional-cost-example-profile',graph.ids.graph),versionLabel:profile.version,profileHash:sha256(profile)},
    travel:tree?tree.travel:concrete?concrete.travel:pack?null:{distanceMiles:10,minutes:20,source:'fictional_demo_example'},callDurationSeconds:null};
  const snapshot=calculateCanonicalPolaris(input);
  const result={...graph,
    estimate:{...graph.estimate,customerPrice:snapshot.customerFacingPrice,lineItems:snapshot.pricingLineItems},
    polaris:{...graph.polaris,calculationVersion:CALCULATION_VERSION,snapshot,snapshotDigest:sha256(snapshot),
      syntheticCalculation:{contract:'NorthStarFictionalCostExample/v1',input,details:tree&&tree.details||concrete&&concrete.details||null,note:tree?'Fictional tree estimate calculated from the simulated transcript scope and simulated tree-business profile. Onsite verification remains required.':concrete?'Fictional concrete estimate calculated from recorded area and finish plus explicit simulated business-profile assumptions for depth, waste, crew, materials, equipment and mobilization.':'Illustrative cost inputs for practicing estimate review. These are not researched prices or a real job forecast.'}}};
  delete result.projectionDigest; result.projectionDigest=sha256(result);
  return stableValue(result);
}
module.exports={addRecordedCostExample,concreteExample};
