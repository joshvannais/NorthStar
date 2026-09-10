'use strict';

const {calculateCanonicalPolaris, CALCULATION_VERSION}=require('../services/canonicalPolarisCalculation');
const {sha256,stableValue}=require('../services/businessProfileAdapter');
const {v5:uuidv5}=require('uuid');

// One ordinary new/reset demo job has a complete, explicitly fictional cost example.
// Store the shared calculator's output once; existing saved demo graphs stay unchanged.
function addRecordedCostExample(tenantId, graph) {
  const scope={...graph.polaris.snapshot.service.scope,laborHours:8,equipmentReference:'fictional-shared-equipment'};
  const key=graph.lead.serviceType;
  const profile={version:'fictional-cost-example-v1',company:{name:graph.businessProfile.company,currency:'USD'},
    crew:{defaultCrewSize:2,averageHourlyRate:50},
    canonicalPricing:{customerMarkupPercent:0,travelCustomerChargePerMile:0,emergencyMultiplier:1,taxRatePercent:0},
    canonicalCosts:{overheadPercent:10,travelCostPerMile:0.6,materialCostByService:{[key+':'+String(scope.material||'').toLowerCase()]:500},equipmentCostByReference:{'fictional-shared-equipment':100}},
    services:[{id:key,name:graph.lead.serviceLabel,crewSize:2,equipmentReference:'fictional-shared-equipment',canonicalPricing:{requiredScope:['laborHours','equipmentReference'],rangePercent:10,lineItems:[
      {code:'fictional-labor',label:'Illustrative labor charge',category:'labor',type:'fixed',amount:graph.estimate.customerPrice-750},
      {code:'fictional-materials',label:'Illustrative material charge',category:'materials',type:'fixed',amount:600},
      {code:'fictional-equipment',label:'Illustrative equipment charge',category:'equipment',type:'fixed',amount:150},
    ]}}]};
  const input={organizationId:tenantId,customerId:graph.ids.customer,opportunityId:graph.ids.lead,calculationVersion:CALCULATION_VERSION,
    service:{key,scope},facts:[],transcript:[],businessProfile:profile,
    businessProfileAuthority:{id:uuidv5('fictional-cost-example-profile',graph.ids.graph),versionLabel:profile.version,profileHash:sha256(profile)},
    travel:{distanceMiles:10,minutes:20,source:'fictional_demo_example'},callDurationSeconds:null};
  const snapshot=calculateCanonicalPolaris(input);
  const result={...graph,
    estimate:{...graph.estimate,customerPrice:snapshot.customerFacingPrice,lineItems:snapshot.pricingLineItems},
    polaris:{...graph.polaris,calculationVersion:CALCULATION_VERSION,snapshot,snapshotDigest:sha256(snapshot),
      syntheticCalculation:{contract:'NorthStarFictionalCostExample/v1',input,note:'Illustrative cost inputs for practicing estimate review. These are not researched prices or a real job forecast.'}}};
  delete result.projectionDigest; result.projectionDigest=sha256(result);
  return stableValue(result);
}
module.exports={addRecordedCostExample};
