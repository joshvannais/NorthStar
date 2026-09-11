'use strict';
const {sha256,stableValue}=require('../services/businessProfileAdapter');
const time=require('../../public/js/scheduling-time-contract');
const directory=require('../scheduling/operatorDirectory');
const VERSION='demo-workforce-evidence-v1';
function seal(value){return stableValue({...value,digest:sha256(value)});}
function create(workspace,createdAt){
 const zone=workspace.businessProfile.timeZone,date=time.formatInstant(createdAt,zone).date;
 function day(n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
 function instant(n,h){const r=time.resolveWallTime(day(n),h,zone);if(r.status!=='unique')throw new Error('Simulated working hours need review.');return r.candidates[0].rfc3339;}
 const coverageStart=instant(0,'00:00'),coverageEnd=instant(7,'00:00');
 const members=workspace.team.members.map(member=>({...member,profileId:member.id,membershipStatus:'active',userStatus:'active',homeLocationId:'headquarters',serviceIds:member.accessRole==='member'?workspace.services.map(s=>s.key):[],availability:member.accessRole==='member'?{coverageStart,coverageEnd,intervals:Array.from({length:7},(_,n)=>({kind:'available',start:instant(n,'08:00'),end:instant(n,'17:00')}))}:null}));
 const technician=members.find(m=>m.operationalRole==='Technician');if(technician&&technician.availability)technician.availability.intervals.push({kind:'unavailable',start:instant(0,'12:00'),end:instant(0,'13:00')});
 const crews=workspace.team.crews.map(crew=>({id:crew.id,name:crew.name,homeLocationId:'headquarters',memberIds:[crew.leadMemberId],leadMemberId:crew.leadMemberId}));
 return seal({version:VERSION,simulated:true,capturedAt:new Date(createdAt).toISOString(),timeZone:zone,coverageStart,coverageEnd,members,crews,serviceKeys:workspace.services.map(s=>s.key)});
}
function read(state){
 const v=state.schedulingWorkforce;if(v===undefined)return null;
 const unsigned={...v};delete unsigned.digest;
 if(!v||v.version!==VERSION||v.simulated!==true||sha256(unsigned)!==v.digest||!Array.isArray(v.members)||v.members.length>100||!Array.isArray(v.crews)||v.crews.length>100||Buffer.byteLength(JSON.stringify(v))>131072)throw new Error('Saved simulated team information could not be read.');
 const ids=new Set(v.members.map(m=>m.profileId));
 if(ids.size!==v.members.length||v.crews.some(c=>!Array.isArray(c.memberIds)||c.memberIds.length>100||c.memberIds.some(id=>!ids.has(id))))throw new Error('Saved simulated crew information could not be read.');
 return v;
}
function targets(v){return v?[...v.members.filter(m=>m.accessRole==='member'&&m.membershipStatus==='active'&&m.userStatus==='active').map(m=>({kind:'profile',id:m.profileId,label:m.name,members:[m],operationalRole:m.operationalRole,accessRole:m.accessRole})),...v.crews.filter(c=>c.memberIds.length&&c.memberIds.every(id=>v.members.some(m=>m.profileId===id&&m.membershipStatus==='active'&&m.userStatus==='active'))).map(c=>({kind:'crew',id:c.id,label:c.name,members:c.memberIds.map(id=>v.members.find(m=>m.profileId===id)),operationalRole:null,accessRole:null}))].sort((a,b)=>(a.kind==='profile'?1:2)-(b.kind==='profile'?1:2)||a.id.localeCompare(b.id)):[];}
function candidate(v,target){
 const found=targets(v).find(t=>t.kind===target.kind&&t.id===target.id);
 return found?{kind:found.kind,targetId:found.id,exists:true,locationId:'headquarters',members:found.members,membersTruncated:false,skillEvidenceTruncated:false,availabilityEvidenceTruncated:false}:null;
}
function page(v,tenantId,query){
 const parsed=directory.parseOperatorTargetRequest(query||{},tenantId),all=targets(v),datasetDigest=sha256({version:VERSION,evidence:v&&v.digest,tenantId});
 if(parsed.cursor&&parsed.cursor.datasetDigest!==datasetDigest)throw Object.assign(new Error('The team changed. Search again.'),{status:409});
 const matched=all.filter(t=>t.label.toLowerCase().includes(parsed.query.toLowerCase())||t.id===parsed.query);
 const after=parsed.cursor?matched.filter(t=>(t.kind==='profile'?1:2)>parsed.cursor.kindRank||((t.kind==='profile'?1:2)===parsed.cursor.kindRank&&t.id>parsed.cursor.id)):matched;
 const rows=after.slice(0,25),last=rows[rows.length-1],next=after.length>25?directory.encodeOperatorTargetCursor({organizationId:tenantId,query:parsed.query,datasetDigest,kindRank:last.kind==='profile'?1:2,id:last.id}):null;
 return seal({version:directory.TARGET_DIRECTORY_VERSION,canRead:true,canMutate:Boolean(v),simulated:true,query:parsed.query,targets:rows,page:{shown:rows.length,total:matched.length,datasetDigest,nextCursor:next,hasNext:Boolean(next),truncated:matched.length>rows.length}});
}
function team(v,legacy,profile){
 if(!v)return {members:legacy.members.map(m=>({...m,profileId:m.id,skillIds:[],homeLocationId:null})),crews:[],skills:[],services:profile.services,locations:[],invitations:[],policies:[],schedulingEvidenceAvailable:false};
 return {members:v.members.map(m=>({...m,skillIds:m.serviceIds})),crews:v.crews.map(c=>({...c,key:c.id,members:c.memberIds.map(id=>({profileId:id,role:id===c.leadMemberId?'lead':'member'}))})),skills:v.serviceKeys.map(key=>({id:key,key,name:(profile.services.find(s=>s.key===key)||{}).label||key,serviceId:key})),services:profile.services,locations:[{id:'headquarters',name:'Simulated Business Location'}],invitations:[],policies:[],schedulingEvidenceAvailable:true,simulated:true,availabilityCoverage:{start:v.coverageStart,end:v.coverageEnd}};
}
module.exports={VERSION,create,read,targets,candidate,page,team};
