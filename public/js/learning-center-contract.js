(function(root,factory){'use strict';var value=factory();if(typeof module==='object'&&module.exports)module.exports=value;if(root)root.NorthStarLearningCenterContract=value;})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 var KEY=/^[a-z0-9][a-z0-9._-]{1,63}$/;
 function object(value){return value&&typeof value==='object'&&!Array.isArray(value);}
 function integer(value){return Number.isSafeInteger(value)&&value>=0;}
 function text(value,max){return typeof value==='string'&&value.length>0&&value.length<=max;}
 function digest(value){return typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);}
 function consent(value){
  if(!object(value)||typeof value.active!=='boolean'||!Array.isArray(value.history)||!integer(value.total)||value.total<value.history.length)return null;
  if(value.current!==null&&(!object(value.current)||!integer(value.current.revision)||value.current.revision<1||!digest(value.current.digest)||['grant','revoke'].indexOf(value.current.action)<0))return null;
  return value;
 }
 function center(value){
  if(!object(value)||value.version!=='m25-learning-center-v1'||['tenant_private_postgresql','isolated_demo_postgresql'].indexOf(value.authority)<0||
    !text(value.evaluatedAt,64)||!Array.isArray(value.sources)||!integer(value.sourceTotal)||value.sourceTotal<value.sources.length||
    typeof value.sourcesTruncated!=='boolean'||!text(value.learningBoundary,1000)||!object(value.nativeLabor))throw new Error('Learning Center response is invalid.');
  var seen=Object.create(null);
  value.sources.forEach(function(source){
   if(!object(source)||!KEY.test(source.sourceKey)||seen[source.sourceKey]||!Array.isArray(source.serviceKeys)||
     !integer(source.serviceTotal)||source.serviceTotal<source.serviceKeys.length||typeof source.servicesTruncated!=='boolean'||
     source.serviceKeys.length>50||source.serviceKeys.some(function(service){return!KEY.test(service);}))throw new Error('Learning source response is invalid.');
   seen[source.sourceKey]=true;
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
    !integer(value.referenceTotal)||value.referenceTotal<value.references.length||!Array.isArray(value.workerTargets)||!Array.isArray(value.jobTargets))throw new Error('Learning match detail is invalid.');
  return value;
 }
 function calibration(value){
  if(!object(value)||!KEY.test(value.sourceKey)||!KEY.test(value.serviceKey)||typeof value.activeConsent!=='boolean'||
    !Array.isArray(value.history)||!integer(value.total)||value.total<value.history.length)throw new Error('Learning calibration detail is invalid.');
  return value;
 }
 function label(value){return String(value||'').replace(/[._-]+/g,' ').replace(/\b[a-z]/g,function(letter){return letter.toUpperCase();});}
 return Object.freeze({KEY:KEY,center:center,consent:consent,source:source,matches:matches,calibration:calibration,label:label});
});
