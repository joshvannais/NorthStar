'use strict';

// Reviewed-source vocabulary is not a job assessment, credential or price authority.
// Only new fictional sessions consume this registry; historical graphs are not rewritten.
const question=(id,ask)=>({id,ask});
const operations={
  removal:{label:'Tree removal',statement:'I would like a tree removed.',scope:{requestedWork:'tree removal',siteConcern:'Tree condition and nearby structures need an onsite check.',disposalPreference:'Please explain whether the wood can remain or must be hauled away.'},questions:['Tree dimensions, condition, ownership and access need an onsite review.','Confirm felling or rigging method, qualified workers and equipment before assignment.']},
  pruning:{label:'Tree trimming and pruning',statement:'I would like the tree trimmed and pruned.',scope:{requestedWork:'tree trimming and pruning',siteConcern:'Please assess which branches should be pruned.',disposalPreference:'Please include a choice for handling the cut branches.'},questions:['Confirm the pruning objective and an appropriate arborist for the job and jurisdiction.','Do not assume removal equipment, pruning volume or a disposal load.']},
  stump:{label:'Stump grinding',statement:'I would like an existing stump ground down.',scope:{requestedWork:'stump grinding',siteConcern:'The stump size, access and buried services need checking.',disposalPreference:'Please explain whether the grindings stay and whether filling is included.'},questions:['Measure stump diameter, access width and requested grinding depth onsite.','Locate buried services and verify machine access; backfill and grindings removal are separate choices.']},
  storm:{label:'Storm and emergency assessment',statement:'I need emergency help assessing a storm-damaged tree; I am concerned it may be unsafe.',scope:{requestedWork:'storm damage assessment',siteConcern:'I cannot confirm whether the damaged tree is safe or near live wires.',disposalPreference:'Please assess the immediate concern before planning cleanup.'},questions:['Keep clear of the hazard; emergency services or the utility may need to respond.','A qualified onsite assessment must precede work, access, crew and equipment decisions.']},
  hauling:{label:'Tree debris hauling',statement:'I need existing tree debris hauled away.',scope:{requestedWork:'tree debris hauling',siteConcern:'Please check the pile, loading access and destination before quoting.',disposalPreference:'Please remove the existing debris; I am not requesting tree cutting.'},questions:['Measure debris volume and weight, current vehicle load and both payload and usable capacity.','Confirm destination acceptance, route legs, queue and unloading time, fees and who drives; hauling reduces onsite availability.']},
  visit:{label:'Tree estimate visit',statement:'I would like an estimate visit before deciding what tree work is needed.',scope:{requestedWork:'tree estimate visit',siteConcern:'I need someone to identify the work and explain the options.',disposalPreference:'No cutting, grinding or hauling has been authorized.'},questions:['The visit is for assessment only; no production crew, equipment, disposal or price is approved.']},
};
const sharedQuestions=['Worker qualifications, equipment availability, safe access and duration remain unverified.','Local permits, tree ownership, tax registration and exemptions need review.','Rates, quantities, productivity, fuel, disposal fees and travel are unknown until sourced or recorded by the owner.'];
const sources=[
  {id:'osha-tree-overview',url:'https://www.osha.gov/tree-care/',scope:'Service taxonomy and hazard review',geography:'US',accessedOn:'2026-09-15',effectiveOn:null,evidence:'official-index-excerpt',fullDocumentAccess:'unavailable-403'},
  {id:'osha-tree-inspection',url:'https://www.osha.gov/memos/2021-06-30/inspection-guidance-for-tree-care-and-tree-removal-operations',scope:'Worksite hazards and applicable training/equipment requirements depend on the work',geography:'US',accessedOn:'2026-09-15',effectiveOn:'2021-06-30',evidence:'official-index-excerpt',fullDocumentAccess:'unavailable-403'},
  {id:'ct-arborist',url:'https://portal.ct.gov/deep/pesticides/arborist/commercial-arborist-license',scope:'Connecticut arboriculture licensing; not proof any synthetic worker is licensed',geography:'US-CT',accessedOn:'2026-09-15',effectiveOn:null,sha256:'17e9052f9ee93faf17172622834c5999407a7c90ce9ad39ceb3ff51f0cfb3a41'},
  {id:'ct-tree-tax',url:'https://portal.ct.gov/-/media/sots/regulations/Title_12/4072iVpdf.pdf?la=en',scope:'Tree trimming/removal tax source candidate; no rule publication or transfer to other operations',geography:'US-CT',accessedOn:'2026-09-15',effectiveOn:'1999-04-07',sha256:'43d26dd3f75242c6d37c6a5acd1874fd19975fd3dee8c3fdb730a4bb260ca4cc'},
];
const tree={
  id:'tree',version:'tree-intelligence-v1',label:'Tree service',subject:'a tree or tree debris',
  intentJobTypes:{repair_request:'pruning',inspection:'visit',replacement_planning:'removal',tree_removal:'removal',tree_pruning:'pruning',tree_stump:'stump',tree_storm:'storm',tree_hauling:'hauling',tree_visit:'visit'},weatherSensitive:true,
  emergencyIntents:['repair_request','inspection','tree_storm'],emergencyOnlyIntents:['tree_storm'],emergencyOperation:'storm',defaultOperation:'removal',
  review:{state:'provisional',countsTowardReviewedIndustryTarget:false,reviewExpiresOn:'2026-10-15',reason:'Source vocabulary reviewed locally; job measurements, operating assumptions and independent industry validation remain open.'},
  operations,sources,sharedQuestions,
  evidenceFields:{taxonomy:'source-backed vocabulary',transcripts:'authored fictional customer declarations',measurements:'onsite unknown',materialsWaste:'operation-specific questions',machineryVehicles:'unselected; capacity and suitability unknown',workforceCredentials:'unverified; never assignment authority',productivityDuration:'unknown',schedulingSafety:'assessment required',tax:'jurisdiction and registration review required',pricing:'fictional cost example only; no market rates',geography:'fictional session location; CT sources apply only in CT',learning:'future authorized outcomes only'},
  catalog:{id:'tree',displayName:'Tree service',conversationSubject:'a tree or tree debris',jobTypes:Object.keys(operations),materials:[],classificationKeywords:['tree removal','tree trimming','pruning','stump','tree debris'],scopeSchema:{required:['jobType','requestedWork','siteConcern','disposalPreference'],recommended:[],optional:[]},questions:{discovery:[question('jobType','What tree work would you like help with?'),question('requestedWork','What should I record as the requested work?')],scope:[question('siteConcern','What would you like the team to check at the site?'),question('disposalPreference','What should happen to the wood, branches or grindings?')],scheduling:[question('timeline','When can the team contact you about an assessment?')]}},
};
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
const packs=freeze({tree});
function operationForSelection(service,selection,current){
  const pack=packs[service];if(!pack)return null;
  const explicit=pack.intentJobTypes[selection.intent];
  const id=selection.urgency==='safety_emergency'?pack.emergencyOperation:explicit||(current===pack.emergencyOperation?pack.defaultOperation:current);
  return pack.operations[id]?id:pack.defaultOperation;
}
function validSelection(selection){
 const pack=packs[selection.service];
 const intentOwner=Object.values(packs).find(p=>selection.intent.startsWith(p.id+'_'));
 if(intentOwner&&intentOwner!==pack)return false;
 if(!pack)return true;
 if(pack.emergencyOnlyIntents.includes(selection.intent)&&selection.urgency!=='safety_emergency')return false;
 return selection.urgency!=='safety_emergency'||(pack.emergencyIntents.includes(selection.intent)&&selection.outcome==='needs_information'&&selection.scheduling==='flexible');
}
function scopeFor(service,id){const pack=packs[service],op=pack&&pack.operations[id];return op?{jobType:id,...op.scope}:null;}
function questionsFor(service,id){const pack=packs[service],op=pack&&pack.operations[id];return op?[...op.questions,...pack.sharedQuestions]:[];}
module.exports={packs,operationForSelection,scopeFor,questionsFor,validSelection};
