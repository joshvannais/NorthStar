(function(root,factory){'use strict';var value=factory();if(typeof module==='object'&&module.exports)module.exports=value;if(root)root.NorthStarLearningCenterContract=value;})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 var KEY=/^[a-z0-9][a-z0-9._-]{1,63}$/;
 var UUID=/(?:^|[^0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:$|[^0-9a-f])/i;
 var OBJECT_MARKER=/object[\s_-]*object/i;
 var CONTACT_NUMBER=/(?:^|[^0-9])(?:\+1[ .-]?)?\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}(?:$|[^0-9])|(?:^|[^0-9])[0-9]{10,15}(?:$|[^0-9])/;
 var INTERNAL_HEX=/(?:^|[^0-9a-f])[0-9a-f]{32,}(?:$|[^0-9a-f])/i;
 var PREFIXED_INTERNAL=/(?:digest|checksum|hash)[\s:=_-]+[A-Za-z0-9/+_-]{16,}|(?:request|record|database)[\s_-]*(?:id|identifier)[\s:#=_-]+[A-Za-z0-9._:-]{6,}/i;
 function object(value){return value&&typeof value==='object'&&!Array.isArray(value);}
 function integer(value){return Number.isSafeInteger(value)&&value>=0;}
 function text(value,max){return typeof value==='string'&&value.length>0&&value.length<=max;}
 function digest(value){return typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);}
 function consent(value){
  if(!object(value)||!Array.isArray(value.history)||!integer(value.total)||value.total<value.history.length)return null;
  if(value.current!==null&&(!object(value.current)||!integer(value.current.revision)||value.current.revision<1||!digest(value.current.digest)||['grant','revoke'].indexOf(value.current.action)<0))return null;
  if(typeof value.active==='boolean')return value;
  return Object.assign({},value,{active:Boolean(value.current&&value.current.action==='grant')});
 }
 function center(value){
  if(!object(value)||value.version!=='m25-learning-center-v3'||['tenant_private_postgresql','isolated_demo_postgresql'].indexOf(value.authority)<0||
    !text(value.evaluatedAt,64)||!Array.isArray(value.sources)||!integer(value.sourceTotal)||value.sourceTotal<value.sources.length||
    typeof value.sourcesTruncated!=='boolean'||!text(value.learningBoundary,1000)||!object(value.nativeLabor)||!object(value.nativeEquipment))throw new Error('Learning Center response is invalid.');
  var seen=Object.create(null);
  value.sources.forEach(function(source){
   if(!object(source)||['labor','travel','asset'].indexOf(source.sourceKind)<0||!KEY.test(source.sourceKey)||!Array.isArray(source.serviceKeys)||
     !integer(source.serviceTotal)||source.serviceTotal<source.serviceKeys.length||typeof source.servicesTruncated!=='boolean'||
     source.serviceKeys.length>50||source.serviceKeys.some(function(service){return!KEY.test(service);}))throw new Error('Learning source response is invalid.');
   var identity=source.sourceKind+':'+source.sourceKey;
   if(seen[identity])throw new Error('Learning source response is invalid.');
   seen[identity]=true;
  });
  return value;
 }
 function source(value){
  if(!object(value)||!KEY.test(value.sourceKey)||typeof value.activeConsent!=='boolean'||!Array.isArray(value.runs)||
    !integer(value.runTotal)||!Array.isArray(value.currentRecords)||!integer(value.recordTotal)||value.runTotal<value.runs.length||
    value.recordTotal<value.currentRecords.length||typeof value.runsTruncated!=='boolean'||typeof value.recordsTruncated!=='boolean')throw new Error('Learning source detail is invalid.');
  return value;
 }
 function matches(value){
  if(!object(value)||!KEY.test(value.sourceKey)||typeof value.activeConsent!=='boolean'||!Array.isArray(value.references)||
    !integer(value.referenceTotal)||value.referenceTotal<value.references.length||!Array.isArray(value.jobTargets)||
    (!Array.isArray(value.workerTargets)&&!Array.isArray(value.vehicleTargets)&&!Array.isArray(value.equipmentTargets)))throw new Error('Learning match detail is invalid.');
  return value;
 }
 function calibration(value){
  if(!object(value)||!KEY.test(value.sourceKey)||!KEY.test(value.serviceKey)||typeof value.activeConsent!=='boolean'||
    !Array.isArray(value.history)||!integer(value.total)||value.total<value.history.length)throw new Error('Learning calibration detail is invalid.');
  return value;
 }
 function health(value){
  if(!object(value)||!KEY.test(value.sourceKey)||typeof value.activeConsent!=='boolean'||!Array.isArray(value.history)||
    !integer(value.total)||value.total<value.history.length)throw new Error('Asset health detail is invalid.');
  if(value.current!==null){
   if(!object(value.current)||typeof value.current.fresh!=='boolean'||typeof value.current.advisoryAvailable!=='boolean'||!object(value.current.outcomes))throw new Error('Asset health detail is invalid.');
   ['maintenance','downtime','condition','availability'].forEach(function(key){
    var item=value.current.outcomes[key];
    if(!object(item)||['recorded','unavailable'].indexOf(item.status)<0)throw new Error('Asset health detail is invalid.');
   });
  }
  return value;
 }
 function operations(value){
  if(!object(value)||!KEY.test(value.sourceKey)||!Array.isArray(value.checkpoints)||!integer(value.activeRecordTotal)||
    !integer(value.retentionEligibleTotal)||(typeof value.deletionComplete!=='boolean'&&value.deletionComplete!==null)||!text(value.boundary,1000))throw new Error('Learning source operations response is invalid.');
  ['adapter','retention','deletion'].forEach(function(key){var item=value[key];if(item!==null&&(!object(item)||!integer(item.revision)||item.revision<1||!text(item.action,32)||!digest(item.digest)))throw new Error('Learning source operation is invalid.');});
  return value.deletionComplete===null?Object.assign({},value,{deletionComplete:false}):value;
 }
 function safeLabel(value){
  var textValue=typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
  if(!textValue||textValue.length>240||/[\u0000-\u001f\u007f]/.test(textValue)||UUID.test(textValue)||OBJECT_MARKER.test(textValue)||
    CONTACT_NUMBER.test(textValue)||INTERNAL_HEX.test(textValue)||PREFIXED_INTERNAL.test(textValue)||textValue.indexOf('@')>=0)return null;
  return textValue;
 }
 function label(value,fallback){
  var textValue=safeLabel(value);
  if(!textValue)return fallback||'Company record';
  return textValue.replace(/[._-]+/g,' ').replace(/\b[a-z]/g,function(letter){return letter.toUpperCase();});
 }
 return Object.freeze({KEY:KEY,center:center,consent:consent,source:source,matches:matches,health:health,calibration:calibration,operations:operations,safeLabel:safeLabel,label:label});
});
