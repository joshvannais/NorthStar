'use strict';
const crypto=require('node:crypto');
const {EquipmentRepository}=require('../../src/equipment/repository');
async function createReadinessAsset(f){
 const now=new Date(),identity={manufacturer:'Example Manufacturer',model:'Readiness Test Auger',modelYear:'2026',series:'Fixture',engine:'Electric',configuration:'Standard'};
 const research={schemaVersion:1,identity,category:'equipment',categoryLabel:'Test Equipment',specifications:[{name:'Bit diameter',value:'150',unit:'mm',sourceOrdinal:1},{name:'reviewed_attachment_configuration',value:'150 mm bit',unit:'',sourceOrdinal:1}],sources:[{url:'https://manufacturer.example/manual',title:'Disposable Local Fixture Only',publisher:'Example Manufacturer',sourceVersion:'readiness-test-v1',documentDigest:'a'.repeat(64),accessedAt:now.toISOString()}],confidence:'high',reviewedAt:now.toISOString(),freshUntil:new Date(now.getTime()+86400000).toISOString(),state:'approved'};
 await f.ownerPool.query('SELECT equipment_import_reviewed($1,NULL,$2,$3,$4)',[research,'Local fixture reviewer','b'.repeat(64),'No external source access; disposable verification only']);
 const a=f.actors.owner,actor={organizationId:f.org,userId:a.actorUserId,role:'owner',sessionId:a.authSessionId,csrfToken:a.csrfToken},repo=new EquipmentRepository(f.runtimePool);
 const draft=await repo.mutate(actor,null,crypto.randomUUID(),{entryPath:'business_profile',message:'',identifiers:{...identity,attachments:'150 mm bit',accessType:'owned'},useContext:'Disposable readiness verification'});
 await repo.mutate(actor,draft.data.id,crypto.randomUUID(),{action:'confirm',expectedRevision:draft.data.revision,expectedDigest:draft.data.digest,confirmation:'save_reviewed_asset'});
 let asset=(await repo.read(actor)).assets.find(v=>v.model===identity.model);
 if(!asset||asset.reviewState!=='reviewed'||!asset.knowledgeVersionId)throw Error('Local exact reviewed configuration was not created');
 const work=await f.createExecution();
 const performer=(await f.ownerPool.query('SELECT workforce_profile_id AS id FROM canonical_schedule_assignments WHERE organization_id=$1 AND id=$2',[f.org,work.assignment.id])).rows[0].id;
 function body(kind,extra={}){return {action:'record',assetId:asset.id,assetVersion:Number(asset.version),assetDigest:asset.assetDigest,knowledgeVersionId:asset.knowledgeVersionId,knowledgeDigest:asset.knowledgeDigest,expectedExecutionRevision:Number(work.execution.revision),expectedExecutionDigest:work.execution.digest,expectedAssignmentRevision:Number(work.assignment.revision),expectedAssignmentDigest:work.assignment.digest,expectedAssetRevision:Number(asset.operationRevision),expectedAssetDigest:asset.operationDigest,performerProfileId:performer,kind,observedAt:new Date().toISOString(),meterKey:null,reading:null,unit:null,description:'Observed disposable test fact',reason:'Verify complete recorded equipment evidence',correctsEventId:null,...extra};}
 async function record(kind,extra={}){const input=body(kind,extra),key=crypto.randomUUID();const result=await repo.mutate(actor,work.execution.id,key,input,true);asset=(await repo.read(actor)).assets.find(v=>v.id===asset.id);return{result,input,key};}
 return {repo,actor,work,identity:{...identity,attachments:'150 mm bit'},get asset(){return asset;},body,record};
}
module.exports={createReadinessAsset};
