'use strict';
const knowledge=require('../../src/knowledge/repository');
const {sha256}=require('../../src/services/businessProfileAdapter');
async function seed(f){
 const identity={manufacturer:'Fixture Workshop',model:'Fixture Auger',modelYear:'2026',series:'Fixture Series',engine:'Electric',configuration:'Standard',attachments:'none'};
 const {attachments,...publicIdentity}=identity,now=new Date();
 const research={schemaVersion:1,identity:publicIdentity,category:'equipment',categoryLabel:'Augers',specifications:[{name:'Diameter',value:'150',unit:'mm',sourceOrdinal:1}],sources:[{url:'https://manufacturer.example/manual',title:'Synthetic Specification — Not Real Research',publisher:'Fixture Workshop',sourceVersion:'fixture-v1',documentDigest:sha256(publicIdentity),accessedAt:now.toISOString()}],confidence:'high',reviewedAt:now.toISOString(),freshUntil:new Date(+now+86400000).toISOString(),state:'approved'};
 let reference=(await f.ownerPool.query('SELECT equipment_import_reviewed($1,NULL,$2,$3,$4) r',[research,'Disposable fixture reviewer',sha256('fixture review'),'Local fixture only; no real research'])).rows[0].r;
 const created=await knowledge.createInitialKnowledgeDraft(f.ownerPool,{organizationId:f.org,actorUserId:f.actors.owner.actorUserId,canonicalKey:'organization.operational-capabilities',entryType:'generated_knowledge',label:'Private Fixture Equipment Guidance',sensitivity:'restricted',reviewRequirement:'high_risk',origin:'human',applicability:{},content:{facts:{assets:[{assetId:'11111111-1111-4111-8111-111111111111',name:'Fixture Auger',modelYear:2026,configuration:'Standard'}],crews:[{crewKey:'internal_crew_key',name:'Fixture Crew',memberCount:2}]},generation:{dependencyDigest:sha256('private-generation'),generatorVersion:'internal-generator-v1'},needsReview:[],state:'ready_for_review',guidance:'Confirm site access before choosing equipment. Private fixture guidance.'},reason:'Create local equipment reference',provenance:[{sourceType:'human_input',sourceRecordId:f.org,sourceVersion:'1',sourceDigest:sha256('fixture'),jsonPointer:'/content'}]});
 async function publish(entry,previous=null){
  function target(actor,extra={}){return {organizationId:f.org,actorUserId:actor,entryId:entry.id,versionId:entry.version.id,versionNumber:entry.version.number,canonicalDigest:entry.version.canonicalDigest,expectedReviewEventId:null,reason:'Review local fixture reference',...extra};}
  const submitted=await knowledge.submitKnowledgeVersionForReview(f.ownerPool,target(f.actors.owner.actorUserId));
  const approved=await knowledge.approveKnowledgeVersion(f.ownerPool,target(f.actors.admin.actorUserId,{expectedReviewEventId:submitted.event.id}));
  return knowledge.publishKnowledgeVersion(f.ownerPool,target(f.actors.owner.actorUserId,{expectedReviewEventId:approved.event.id,expectedPublicationId:previous?.id||null,expectedPublicationNumber:previous?.number||0}));
 }
 const publication=await publish(created);
 return {identity,research,reference,created,publication,publish};
}
module.exports={seed};
