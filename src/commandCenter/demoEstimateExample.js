'use strict';

const {calculateCanonicalPolaris, CALCULATION_VERSION}=require('../services/canonicalPolarisCalculation');
const {sha256,stableValue}=require('../services/businessProfileAdapter');
const {v5:uuidv5}=require('uuid');
const {packs,questionsFor}=require('./industryIntelligence');

// New/reset and simulated demo jobs share an explicitly fictional cost example.
// Store the shared calculator's output once; existing saved demo graphs stay unchanged.
function addRecordedCostExample(tenantId, graph) {
  const key=graph.lead.serviceType;
  const pack=packs[key];
  const scope=pack?{...graph.polaris.snapshot.service.scope,assessmentQuestions:questionsFor(key,graph.polaris.snapshot.service.scope.jobType)}:{...graph.polaris.snapshot.service.scope,laborHours:8,equipmentReference:'fictional-shared-equipment'};
  const profile={version:'fictional-cost-example-v1',company:{name:graph.businessProfile.company,currency:'USD'},
    crew:{defaultCrewSize:2,averageHourlyRate:50},
    canonicalPricing:{customerMarkupPercent:0,travelCustomerChargePerMile:0,emergencyMultiplier:1,taxRatePercent:0},
    canonicalCosts:{overheadPercent:10,travelCostPerMile:0.6,materialCostByService:{[key+':'+String(scope.material||'').toLowerCase()]:500},equipmentCostByReference:{'fictional-shared-equipment':100}},
    services:[{id:key,name:graph.lead.serviceLabel,crewSize:2,equipmentReference:'fictional-shared-equipment',canonicalPricing:{requiredScope:['laborHours','equipmentReference'],rangePercent:10,lineItems:[
      {code:'fictional-labor',label:'Illustrative labor charge',category:'labor',type:'fixed',amount:graph.estimate.customerPrice-750},
      {code:'fictional-materials',label:'Illustrative material charge',category:'materials',type:'fixed',amount:600},
      {code:'fictional-equipment',label:'Illustrative equipment charge',category:'equipment',type:'fixed',amount:150},
    ]}}]};
  if(pack){
    // A typed canonical example is not evidence for a production crew, yield or rate.
    profile.version='fictional-provisional-industry-v1';
    profile.crew={};profile.canonicalCosts={};
    profile.services=[{id:key,name:graph.lead.serviceLabel,canonicalPricing:{requiredScope:['requestedWork'],rangePercent:10,lineItems:[{code:'fictional-consideration',label:'Illustrative amount for practicing review',category:'labor',type:'fixed',amount:graph.estimate.customerPrice}]}}];
  }
  const input={organizationId:tenantId,customerId:graph.ids.customer,opportunityId:graph.ids.lead,calculationVersion:CALCULATION_VERSION,
    service:{key,scope},facts:pack?graph.polaris.facts:[],transcript:pack?graph.communication.transcript:[],businessProfile:profile,
    businessProfileAuthority:{id:uuidv5('fictional-cost-example-profile',graph.ids.graph),versionLabel:profile.version,profileHash:sha256(profile)},
    travel:pack?null:{distanceMiles:10,minutes:20,source:'fictional_demo_example'},callDurationSeconds:null};
  const snapshot=calculateCanonicalPolaris(input);
  const result={...graph,
    estimate:{...graph.estimate,customerPrice:snapshot.customerFacingPrice,lineItems:snapshot.pricingLineItems},
    polaris:{...graph.polaris,calculationVersion:CALCULATION_VERSION,snapshot,snapshotDigest:sha256(snapshot),
      syntheticCalculation:{contract:'NorthStarFictionalCostExample/v1',input,note:pack?'Fictional review amount only. Job costs, crew, equipment, duration and travel are unknown until assessed.':'Illustrative cost inputs for practicing estimate review. These are not researched prices or a real job forecast.'}}};
  delete result.projectionDigest; result.projectionDigest=sha256(result);
  return stableValue(result);
}
module.exports={addRecordedCostExample};
