'use strict';
const knowledge=require('../../src/knowledge/repository'),{sha256}=require('../../src/services/businessProfileAdapter');
async function seed(f){
 const created=await knowledge.createInitialKnowledgeDraft(f.ownerPool,{organizationId:f.org,actorUserId:f.actors.owner.actorUserId,canonicalKey:'organization.financial-constraints',entryType:'generated_knowledge',label:'Private Pricing Fixture',sensitivity:'restricted',reviewRequirement:'high_risk',origin:'human',applicability:{},content:{facts:{officeExpense:'Declared internal office expense; not a supplier quote'},generation:{dependencyDigest:sha256('private-generation'),generatorVersion:'internal-generator-v1'},needsReview:[],state:'ready_for_review',guidance:'Confirm site access before choosing equipment. Private pricing fixture guidance.'},reason:'Create local equipment reference',provenance:[{sourceType:'human_input',sourceRecordId:f.org,sourceVersion:'1',sourceDigest:sha256('fixture'),jsonPointer:'/content'}]});
 async function publish(entry,previous=null){
  function target(actor,extra={}){return {organizationId:f.org,actorUserId:actor,entryId:entry.id,versionId:entry.version.id,versionNumber:entry.version.number,canonicalDigest:entry.version.canonicalDigest,expectedReviewEventId:null,reason:'Review local fixture reference',...extra};}
  const submitted=await knowledge.submitKnowledgeVersionForReview(f.ownerPool,target(f.actors.owner.actorUserId));
  const approved=await knowledge.approveKnowledgeVersion(f.ownerPool,target(f.actors.admin.actorUserId,{expectedReviewEventId:submitted.event.id}));
  return knowledge.publishKnowledgeVersion(f.ownerPool,target(f.actors.owner.actorUserId,{expectedReviewEventId:approved.event.id,expectedPublicationId:previous?.id||null,expectedPublicationNumber:previous?.number||0}));
 }
const publication=await publish(created);return{created,publication,publish};}
module.exports={seed};
