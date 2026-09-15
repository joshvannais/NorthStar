'use strict';
const {v5:uuidv5}=require('uuid');
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const {buildCanonicalKnowledgeDocument}=require('../knowledge/contract');
const repository=require('../estimating/equipmentPlanRepository');
const contract=require('../estimating/equipmentPlanContract');
const VERSION='demo-equipment-basis-v1';
const NAMESPACE='311d4d87-1275-441f-b054-87c03dcc8bcc';
function create(seed,createdAt){
 const id=kind=>uuidv5(String(seed)+':equipment:'+kind,NAMESPACE);
 const reviewedAt=new Date(createdAt).toISOString();
 const names={fence:'Practice Auger',roofing:'Practice Roofing Lift',hvac:'Practice HVAC Service Station',plumbing:'Practice Plumbing Service Kit',electrical:'Practice Electrical Test Station',concrete:'Practice Concrete Equipment Set'};
 const treeModule=require('./demoTreeBusinessProfiles'),treeProfile=treeModule.create(seed);
 function makeAsset(key,name,identity,publisher,costProfile=null){
  const research={state:'reviewed',simulated:true,reviewedAt,freshUntil:new Date(new Date(createdAt).getTime()+86400000*30).toISOString(),specifications:[{name:'Company service configuration',value:'1',unit:'profile',sourceOrdinal:1}],sources:[{title:'Simulated '+name+' Profile',publisher,sourceVersion:VERSION,documentDigest:sha256(identity),accessedAt:reviewedAt}],knowledgeVersionId:id(key+'-reference'),knowledgeDigest:sha256({identity,version:VERSION})};
  return{id:id(key==='fence'?'asset':key+'-asset'),name,catalogueState:'active',version:1,assetDigest:sha256(identity),privateConfiguration:identity,...(costProfile?{simulatedCostProfile:costProfile}:{}),research,reviewState:'reviewed',availability:'available',simulated:true};
 }
 const assets=Object.fromEntries(Object.entries(names).map(([serviceKey,name])=>[serviceKey,makeAsset(serviceKey,name,{manufacturer:'Demo Workshop',model:name,modelYear:'2026',series:'Training',engine:'Company profile',configuration:serviceKey+' service configuration',attachments:'Recorded service kit'},'Demo Workshop')]));
 for(const machine of treeProfile.equipment){
  const identity={manufacturer:machine.key==='avant_loader'?'Avant':'Simulated Company Fleet',model:machine.name,modelYear:'2026',series:treeProfile.label,engine:'Recorded company configuration',configuration:machine.role,attachments:machine.attachments.join(', ')||'Recorded tree-service configuration'};
  assets['tree:'+machine.key]=makeAsset('tree-'+machine.key,machine.name,identity,'Simulated Company Fleet',machine);
 }
 const document=buildCanonicalKnowledgeDocument({applicability:{},canonicalKey:'organization.operational-capabilities',content:{equipmentNote:'For this simulated business, confirm the required hole diameter and site access before choosing an auger. Ground conditions and underground services still need review.'},entryType:'generated_knowledge',label:'Simulated Equipment Planning Guidance',origin:'human',reviewRequirement:'high_risk',sensitivity:'restricted'});
 const knowledge={entry_id:id('entry'),canonical_key:'organization.operational-capabilities',entry_type:'generated_knowledge',version_id:id('version'),version_number:1,sensitivity:'restricted',review_requirement:'high_risk',canonical_document:document.canonicalDocument,canonical_digest:document.canonicalDigest,publication_id:id('publication'),publication_number:1,publication_digest:document.canonicalDigest};
 const proposal=require('./demoProposalRecipe').createAll(id,reviewedAt,assets,treeProfile);
 return stableValue({version:VERSION,createdAt:reviewedAt,assets:Object.values(assets),knowledgeRows:[knowledge,...proposal.knowledgeRows],proposalRecipeBasis:proposal.basis,industryProfiles:{tree:treeProfile}});
}
function rawSources(state,item,inputs=null){
 const basis=state.equipmentBasis?.version===VERSION?state.equipmentBasis:null;
 const assets=(basis?.assets||[]).filter(a=>!inputs||inputs.lines.some(l=>l.assetId===a.id));
 const references=(inputs?.lines||[]).filter(l=>l.assetId===null).map(l=>({identity:l.identity,research:(basis?.assets||[]).find(a=>sha256(a.privateConfiguration)===sha256(l.identity))?.research||null}));
 const knowledgeRows=(basis?.knowledgeRows||[]).filter(k=>!inputs||inputs.lines.some(l=>l.knowledgePins.includes(k.publication_id)));
 const payload=stableValue({assets,references,knowledgeRows,scope:item.snapshot.service.scope||{},serviceKey:item.snapshot.service.key,truncated:false});
 return {...payload,digest:sha256(payload)};
}
function actor(item){return {organizationId:item.organizationId||item.snapshot.organizationId||NAMESPACE,actorUserId:NAMESPACE};}
function sources(state,item,inputs=null){return repository.presentSources(rawSources(state,item,inputs),actor(item));}
function save(state,item,history,review,raw,key,now){
 const body=contract.normalize(raw),requestDigest=sha256(body),old=history.find(e=>e.requestKey===key);
 if(old){if(old.requestDigest!==requestDigest)throw Object.assign(new Error('This save attempt changed. Refresh and review again.'),{status:409});return {receipt:old,replayed:true};}
 contract.checkBasis(body,review,history[0]);
 if(body.action==='withdraw'&&history[0]?.action!=='save')throw Object.assign(new Error('There is no saved equipment plan to withdraw.'),{status:400});
 if(history.length>=20)throw Object.assign(new Error('This demo has reached its equipment-plan limit. Saved history remains available. Resetting the demo clears its practice work.'),{status:429});
 const evidence=body.action==='save'?rawSources(state,item,body.inputs):null;
 if(evidence)contract.requireReview(body.inputs,repository.presentSources(evidence,actor(item)),now);
 const receipt={id:require('node:crypto').randomUUID(),revision:(history[0]?.revision||0)+1,previousId:history[0]?.id||null,...body,calculationVersion:contract.VERSION,actorName:'Demo Reviewer',createdAt:now.toISOString(),evidence,requestKey:key,requestDigest,digest:sha256({body,evidence,previous:history[0]?.digest||null})};
 return {receipt,replayed:false};
}
async function project(state,item,review){
 const history=state.equipmentPlans?.[item.ids.estimate]||[];
 // The same history projector receives an isolated source adapter, never a paid DB client.
 return repository.project(null,{current:history[0]||null,history,total:history.length},review,rawSources(state,item),actor(item),true,new Date(),inputs=>rawSources(state,item,inputs));
}
module.exports={VERSION,create,rawSources,sources,save,project,actor};
