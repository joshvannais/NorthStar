'use strict';
const knowledge=require('../../src/knowledge/repository'),{sha256}=require('../../src/services/businessProfileAdapter');
async function seed(f,transformRecipe=null){
 const equipment=await require('./m24-equipment-sources').seed(f),state=require('../../src/commandCenter/demoEquipmentPlans').create('paid-proposal-fixture',new Date().toISOString());
 const item={snapshot:{service:{key:'fence',scope:{}}}},recipe=require('../../src/commandCenter/demoEquipmentPlans').sources({equipmentBasis:state},item).knowledge.find(k=>k.content.estimateProposalRecipe).content.estimateProposalRecipe;
 recipe.fields[0].id='measuredFenceLength';recipe.steps[0].fieldId='measuredFenceLength';recipe.components.find(c=>c.kind==='equipment').inputs.lines[0].assetId=null;recipe.components.find(c=>c.kind==='equipment').inputs.lines[0].identity=equipment.identity;
 if(transformRecipe)transformRecipe(recipe);
 const created=await knowledge.createInitialKnowledgeDraft(f.ownerPool,{organizationId:f.org,actorUserId:f.actors.owner.actorUserId,canonicalKey:'organization.services',entryType:'generated_knowledge',label:'Explicit Local Fence Recipe',sensitivity:'restricted',reviewRequirement:'high_risk',origin:'human',applicability:{},content:{estimateProposalRecipe:recipe},reason:'Local source-bound recipe proof',provenance:[{sourceType:'human_input',sourceRecordId:f.org,sourceVersion:'1',sourceDigest:sha256(recipe),jsonPointer:'/content'}]});
 function target(actor,extra={}){return{organizationId:f.org,actorUserId:actor,entryId:created.id,versionId:created.version.id,versionNumber:created.version.number,canonicalDigest:created.version.canonicalDigest,expectedReviewEventId:null,reason:'Review local recipe',...extra};}
 const submitted=await knowledge.submitKnowledgeVersionForReview(f.ownerPool,target(f.actors.owner.actorUserId));
 const approved=await knowledge.approveKnowledgeVersion(f.ownerPool,target(f.actors.admin.actorUserId,{expectedReviewEventId:submitted.event.id}));
 const publication=await knowledge.publishKnowledgeVersion(f.ownerPool,target(f.actors.owner.actorUserId,{expectedReviewEventId:approved.event.id,expectedPublicationId:null,expectedPublicationNumber:0}));
 async function retire(){
  const tombstone=await knowledge.createKnowledgeTombstone(f.ownerPool,{organizationId:f.org,actorUserId:f.actors.owner.actorUserId,entryId:created.id,expectedVersionId:created.version.id,expectedVersionNumber:created.version.number,expectedCanonicalDigest:created.version.canonicalDigest,reason:'Retire the local recipe for current-source proof'});
  const target=(actor,extra={})=>({organizationId:f.org,actorUserId:actor,entryId:created.id,versionId:tombstone.version.id,versionNumber:tombstone.version.number,canonicalDigest:tombstone.version.canonicalDigest,expectedReviewEventId:null,reason:'Retire local recipe',...extra});
  const submitted=await knowledge.submitKnowledgeVersionForReview(f.ownerPool,target(f.actors.owner.actorUserId));
  const approved=await knowledge.approveKnowledgeVersion(f.ownerPool,target(f.actors.admin.actorUserId,{expectedReviewEventId:submitted.event.id}));
  return knowledge.publishKnowledgeVersion(f.ownerPool,target(f.actors.owner.actorUserId,{expectedReviewEventId:approved.event.id,expectedPublicationId:publication.id,expectedPublicationNumber:publication.number}));
 }
 return{created,publication,retire};
}
module.exports={seed};
