'use strict';
const {stableValue,sha256}=require('../services/businessProfileAdapter');
const equipment=require('./equipmentPlanContract');
const VERSION='estimate-equipment-readiness-v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BODY=['action','expectedRevision','expectedDigest','sourcePins','expectedDecisionRevision','expectedDecisionDigest','inputs','currency','reason','confirmed','confirmationVersion'];
const LINE=['lineId','required','notRequiredReason','quantity','start','end','timeZone','location','source','maintenance','alternatives'];
const SOURCE=['kind','label','reference','observedAt','validUntil','quantity','start','end','condition','restrictions','location','leadTime','leadTimeUnit'];
const MAINTENANCE=['dueAt','meterKey','threshold','unit','reference'];
function fail(message='Review the equipment readiness entries.',status=400,category='readiness_input'){throw Object.assign(new Error(message),{status,code:'EQUIPMENT_READINESS_INVALID',category});}
function exact(v,keys){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));}
function text(v,n,blank=false){return typeof v==='string'&&(blank||v.trim().length>0)&&Array.from(v).length<=n&&!/[\u0000-\u001f\u007f-\u009f]/.test(v);}
function instant(v){
 if(typeof v!=='string')return false;
 const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(?:Z|([+-])(\d\d):(\d\d))$/.exec(v);
 if(!m)return false;const [,y,month,day,hour,minute,second,,offsetHour='0',offsetMinute='0']=m;
 const year=Number(y),mo=Number(month),d=Number(day),leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 return year>=1&&mo>=1&&mo<=12&&d>=1&&d<=days[mo-1]&&Number(hour)<24&&Number(minute)<60&&Number(second)<60&&Number(offsetHour)<=14&&Number(offsetMinute)<60&&(Number(offsetHour)<14||Number(offsetMinute)===0)&&Number.isFinite(Date.parse(v));
}
function dateOrUnknown(v){return v===null||instant(v);}
function pair(start,end){return (start===null&&end===null)||(instant(start)&&instant(end)&&Date.parse(end)>Date.parse(start));}
function quantity(v){return v===null||Number.isSafeInteger(v)&&v>=0&&v<=10000;}
function pin(v){return exact(v,['planId','revision','digest'])&&UUID.test(v.planId)&&Number.isSafeInteger(v.revision)&&v.revision>=1&&v.revision<=10000&&/^[a-f0-9]{64}$/.test(v.digest);}
function validate(inputs){
 if(!exact(inputs,['equipmentBasis','lines','replacement','assessment'])||!pin(inputs.equipmentBasis)||!Array.isArray(inputs.lines)||!inputs.lines.length||inputs.lines.length>12)fail('Choose a saved equipment plan and up to 12 equipment items.');
 const ids=new Set(),alternatives=new Set();
 for(const l of inputs.lines){
  if(!exact(l,LINE)||!UUID.test(l.lineId)||ids.has(l.lineId)||typeof l.required!=='boolean'||!text(l.notRequiredReason,500,l.required)||!quantity(l.quantity)||l.quantity===0||!pair(l.start,l.end)||!text(l.timeZone,100)||!text(l.location,500,true))fail('Review equipment quantities, dates and the reason for any item that is not required.');
  try{new Intl.DateTimeFormat('en',{timeZone:l.timeZone}).format();}catch(_){fail('Choose a recognized time zone.');}ids.add(l.lineId);
  const s=l.source;if(!exact(s,SOURCE)||!['my_observation','supplier_statement','company_record'].includes(s.kind)||!text(s.label,200,true)||!text(s.reference,500,true)||!dateOrUnknown(s.observedAt)||!dateOrUnknown(s.validUntil)||!quantity(s.quantity)||!pair(s.start,s.end)||!['unknown','reported_no_problem','problem_reported','out_of_service'].includes(s.condition)||!text(s.restrictions,1000,true)||!text(s.location,500,true)||!(s.leadTime===null||Number.isSafeInteger(s.leadTime)&&s.leadTime>=0&&s.leadTime<=10000)||!(s.leadTime===null?s.leadTimeUnit===null:['hours','days'].includes(s.leadTimeUnit)))fail('Review the reported equipment source, quantity and dates.');
  if(s.validUntil!==null&&(s.observedAt===null||Date.parse(s.validUntil)<=Date.parse(s.observedAt)))fail('The source end date must follow its observation date.',400,'readiness_dates');
  const m=l.maintenance;if(!exact(m,MAINTENANCE)||!dateOrUnknown(m.dueAt)||!text(m.reference,500,true)||!(m.threshold===null?m.meterKey===null&&m.unit===null:text(m.meterKey,80)&&text(m.unit,80)&&equipment.number(m.threshold)!==null))fail('Review the maintenance date or recorded meter threshold.');
  if(!Array.isArray(l.alternatives))fail();for(const a of l.alternatives){if(!exact(a,['alternativeId','assetId','identity','reason'])||!UUID.test(a.alternativeId)||alternatives.has(a.alternativeId)||!(a.assetId===null||UUID.test(a.assetId))||!text(a.reason,1000))fail('Review each distinct alternative and why it is being considered.');equipment.identity(a.identity);alternatives.add(a.alternativeId);if(alternatives.size>12)fail('Use no more than 12 alternatives across this plan.');}
 }
 const p=inputs.replacement;if(p!==null&&(!exact(p,['readinessId','equipmentBasis','lineId','alternativeId'])||!UUID.test(p.readinessId)||!pin(p.equipmentBasis)||!UUID.test(p.lineId)||!UUID.test(p.alternativeId)))fail('Review the original and replacement equipment together.');
 if(Buffer.byteLength(JSON.stringify(inputs))>32768)fail('Shorten the equipment notes before continuing.',413,'readiness_size');return inputs;
}
function normalize(body){if(!exact(body,BODY)||!['save','withdraw'].includes(body.action)||![body.expectedRevision,body.expectedDecisionRevision].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=10000)||!text(body.expectedDigest,64)||!text(body.expectedDecisionDigest,64)||!body.sourcePins||typeof body.sourcePins!=='object'||Array.isArray(body.sourcePins)||body.confirmed!==true||body.confirmationVersion!==VERSION||!text(body.reason,2000)||!['USD','CAD','EUR'].includes(body.currency))fail();if(body.action==='save')validate(body.inputs);else if(body.inputs!==null)fail();return stableValue({...body,reason:body.reason.trim()});}
function checkBasis(body,review,current){const b=review.decisions.writeBasis;if(review.isCurrent===false||body.expectedRevision!==(current?.revision||0)||body.expectedDigest!==(current?.digest||'none')||body.expectedDecisionRevision!==b.revision||body.expectedDecisionDigest!==b.digest||sha256(body.sourcePins)!==sha256(review.pins)||body.currency!==review.currency)fail('The estimate or equipment review changed. Refresh and review again.',409,'readiness_changed');}
function assessLine(line,fact,now,proposal=null){
 const hard=[],review=[],s=line.source,t=Date.parse(now);if(!Number.isFinite(t))fail('Equipment review time is unavailable.',503);
 if(s.observedAt!==null&&Date.parse(s.observedAt)>t)fail('The observation date cannot be in the future.',400,'readiness_dates');
 if(!line.required)return {lineId:line.lineId,required:false,status:'not_required',hard:[],review:[]};
 const state=fact?.state||{},complete=fact?.complete===true,current=fact?.sourceCurrent===true;
 if(state.downtime===true)hard.push('recorded_downtime');
 if(state.checkedOutExecution&&(!fact.currentJob||proposal&&fact.targetMatches!==true))hard.push('recorded_checkout');
 const declared=fact?.declaredCheckout;if(declared){if(!declared.currentJob||proposal&&declared.targetMatches!==true)hard.push('recorded_checkout');else if(!declared.executionKnown)review.push('checkout_execution_unknown');}
 if(state.recordedFault===true)review.push('recorded_fault');
 if(!complete)review.push('operational_history_unknown');if(!current)review.push('equipment_source_changed');
 if(fact?.requirementStatus==='conflicts_with_requirement')hard.push('requirement_not_met');else if(fact?.requirementStatus!=='matches_reviewed_requirements')review.push('requirements_unknown');
 const fresh=s.observedAt!==null&&s.validUntil!==null&&Date.parse(s.observedAt)<=t&&Date.parse(s.validUntil)>t;
 if(!fresh)review.push('source_date_unknown_or_expired');
 // Adverse reported restrictions remain visible when old; expiry never clears them.
 if(s.condition==='out_of_service')hard.push('reported_out_of_service');else if(s.condition!=='reported_no_problem')review.push(s.condition==='problem_reported'?'reported_condition_problem':'condition_unknown');
 const start=proposal?proposal.scheduledStart:line.start,end=proposal?proposal.scheduledEnd:line.end;
 if(!pair(start,end)||start===null)review.push('required_window_unknown');
 if(line.quantity===null||s.quantity===null)review.push('quantity_unknown');else if(fresh&&s.quantity<line.quantity)hard.push('reported_quantity_shortfall');
 if(fact?.assetId&&line.quantity!==null&&line.quantity>1)hard.push('identified_asset_quantity');
 if(s.start===null||start===null)review.push('reported_window_unknown');else if(fresh&&(Date.parse(s.start)>Date.parse(start)||Date.parse(s.end)<Date.parse(end)))hard.push('reported_window_shortfall');
 if(s.validUntil!==null&&end!==null&&Date.parse(s.validUntil)<Date.parse(end))review.push('source_expires_before_work_ends');
 if(!line.location||!s.location)review.push('location_unknown');else if(line.location.replace(/^ +| +$/g,'')!==s.location.replace(/^ +| +$/g,''))review.push('location_needs_confirmation');
 if(s.restrictions.replace(/^ +| +$/g,''))review.push('reported_restrictions');
 if(s.leadTime===null||s.observedAt===null)review.push('lead_time_unknown');else if(start!==null&&Date.parse(s.observedAt)+s.leadTime*(s.leadTimeUnit==='days'?86400000:3600000)>Date.parse(start))review.push('lead_time_after_work_start');
 const m=line.maintenance;if(m.dueAt!==null&&Date.parse(m.dueAt)<=Math.max(t,end===null?t:Date.parse(end)))review.push('maintenance_due');
 if(m.threshold!==null){const meter=state.readings?.[m.meterKey],value=equipment.number(meter?.reading);if(!complete||!meter||meter.unit!==m.unit||value===null||(fact.meterResets?.[m.meterKey]&&(s.observedAt===null||Date.parse(fact.meterResets[m.meterKey])>=Date.parse(s.observedAt)))||(!fact.meterResets&&fact.meterReset===true)||!fresh)review.push('maintenance_meter_unknown');else if(value>=equipment.number(m.threshold))review.push('maintenance_due');}
 if(fact?.basisDiverged)review.push('included_equipment_differs');
 return {lineId:line.lineId,required:true,status:hard.length?'blocked':review.length?'needs_review':'no_recorded_conflict',hard:[...new Set(hard)].sort(),review:[...new Set(review)].sort()};
}
function evaluate(inputs,evidence,now=new Date(),proposal=null){
 validate(inputs);if(!evidence||!Array.isArray(evidence.lines))fail('Equipment evidence is unavailable. Refresh and try again.',503);
 const at=new Date(now).toISOString(),lines=inputs.lines.map(l=>assessLine(l,evidence.lines.find(f=>f.lineId===l.lineId),at,proposal));
 for(let i=0;i<inputs.lines.length;i++)for(let j=i+1;j<inputs.lines.length;j++){
  const a=inputs.lines[i],b=inputs.lines[j],asset=evidence.lines.find(f=>f.lineId===a.lineId)?.assetId;
  if(!a.required||!b.required||!asset||asset!==evidence.lines.find(f=>f.lineId===b.lineId)?.assetId)continue;
  const as=proposal?proposal.scheduledStart:a.start,ae=proposal?proposal.scheduledEnd:a.end,bs=proposal?proposal.scheduledStart:b.start,be=proposal?proposal.scheduledEnd:b.end;
  const unknown=as===null||ae===null||bs===null||be===null,overlap=!unknown&&Date.parse(as)<Date.parse(be)&&Date.parse(bs)<Date.parse(ae);
  if(unknown||overlap)for(const index of [i,j]){const r=lines[index],key=overlap?'hard':'review',code=overlap?'identified_asset_overlap':'identified_asset_windows_unknown';r[key]=[...new Set([...r[key],code])].sort();r.status=r.hard.length?'blocked':'needs_review';}
 }
 return stableValue({contract:VERSION,assessedAt:at,sourcesDigest:evidence.digest||sha256(evidence),status:lines.some(l=>l.status==='blocked')?'blocked':lines.some(l=>l.status==='needs_review')?'needs_review':lines.every(l=>!l.required)?'not_required':'no_recorded_conflict',lines});
}
function assessment(result){return stableValue({sourcesDigest:result.sourcesDigest,status:result.status,lines:result.lines});}
function requireReview(inputs,evidence,now){const result=evaluate(inputs,evidence,now),a=inputs.assessment;if(!exact(a,['sourcesDigest','status','lines','acknowledged'])||a.acknowledged!==true||sha256({sourcesDigest:a.sourcesDigest,status:a.status,lines:a.lines})!==sha256(assessment(result)))fail('Refresh the equipment evidence, then review and confirm again.',409,'readiness_changed');return result;}
module.exports={VERSION,validate,normalize,checkBasis,assessLine,evaluate,assessment,requireReview,fail};
