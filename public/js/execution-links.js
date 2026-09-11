(function(root,factory){
  'use strict';
  if(typeof module==='object' && module.exports) module.exports=factory();
  else root.NorthStarExecutionLinks=factory();
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  var UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  function identity(value){return Boolean(value && ['appointmentId','graphId','customerId'].every(function(key){return typeof value[key]==='string' && UUID.test(value[key]);}));}
  function validate(value,expected){
    if(!identity(expected) || !value || value.version!=='m23-part9-execution-link-v1' ||
      Object.keys(value).sort().join(',')!=='appointmentId,customerId,executionId,graphId,href,state,version' ||
      ['appointmentId','graphId','customerId'].some(function(key){return value[key]!==expected[key];})) throw new Error('Execution association changed.');
    if(value.state==='unavailable' && value.executionId===null && value.href===null)return value;
    if(value.state!=='available' || typeof value.executionId!=='string' || !UUID.test(value.executionId) ||
      value.href!=='/dashboard/completion-review?executionId='+value.executionId)throw new Error('Execution destination unavailable.');
    return value;
  }
  function clear(container){
    if(!container)return;
    Array.prototype.forEach.call(container.querySelectorAll('.execution-link'),function(node){if(node.executionLinkDispose)node.executionLinkDispose();});
  }
  function mount(container,expected,options){
    options=options||{};
    var details=document.createElement('details');details.className='execution-link';
    var summary=document.createElement('summary');summary.textContent=options.summaryLabel || 'Work details';
    var body=document.createElement('div');body.className='execution-link-content';
    var status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    body.appendChild(status);details.append(summary,body);container.appendChild(details);
    var serial=0,controller=null,timer=null,disposed=false;
    var demo=options.demo===true || /^\/demo(?:\/|$|-)/.test(window.location.pathname);
    var initial=identity(expected)?'Open to check the work details available for this job.':'Work details could not be linked to this job. Review the job in Operations.';
    status.textContent=initial;
    function reset(){serial+=1;if(controller)controller.abort();controller=null;if(timer)clearTimeout(timer);timer=null;body.replaceChildren(status);status.textContent=initial;body.removeAttribute('aria-busy');}
    function invalidate(){reset();details.open=false;}
    function dispose(){invalidate();disposed=true;window.removeEventListener('pagehide',invalidate);window.removeEventListener('northstar:auth-generation',invalidate);}
    details.executionLinkDispose=dispose;window.addEventListener('pagehide',invalidate);window.addEventListener('northstar:auth-generation',invalidate);
    async function load(){
      reset();if(disposed || !identity(expected))return;
      var generation=serial;controller=new AbortController();timer=setTimeout(function(){if(controller)controller.abort();},12000);
      status.textContent='Checking access to this job’s work details…';body.setAttribute('aria-busy','true');
      try {
        if(demo){
          var checked=await window.fetch('/api/demo/command-center/operations/appointments/'+expected.appointmentId,{cache:'no-store',signal:controller.signal});
          if(!checked.ok)throw new Error('Work unavailable');var detail=(await checked.json()).data;
          if(disposed||generation!==serial||!details.isConnected||!details.open)return;
          if(!detail||detail.authority!=='isolated_demo_postgresql'||detail.appointmentId!==expected.appointmentId||detail.graphId!==expected.graphId||detail.customerId!==expected.customerId)throw new Error('Work association changed');
          status.textContent=detail.execution?'Recorded simulated work is available.':'No work has been opened for this simulated job yet.';
          var workLink=document.createElement('a');workLink.className='btn btn-secondary btn-sm';workLink.textContent='Open Work Details';workLink.href='/demo/operations?appointmentId='+encodeURIComponent(expected.appointmentId);body.appendChild(workLink);return;
        }
        if(!window.NorthStarAccountSession || typeof window.NorthStarAccountSession.fetch!=='function')throw new Error('Session unavailable');
        var response=await window.NorthStarAccountSession.fetch('/api/v1/field-executions/links/appointments/'+expected.appointmentId+
          '?graphId='+expected.graphId+'&customerId='+expected.customerId,{method:'GET',cache:'no-store',signal:controller.signal});
        if(disposed || generation!==serial || !details.isConnected || !details.open)return;
        if(response.status===401 || response.status===403){status.textContent='Completion review is available only to an owner or administrator. Your account cannot review completion here.';return;}
        if(!response.ok)throw new Error('Read unavailable');
        var envelope=await response.json();var value=validate(envelope && envelope.success===true && envelope.data,expected);
        if(disposed || generation!==serial || !details.isConnected || !details.open)return;
        if(value.state!=='available'){status.textContent='Work details could not be found or confirmed. The work may not have been opened yet, or its details may have changed. Refresh this page or review Operations.';return;}
        status.textContent='Open this job’s completion review. NorthStar will check your current access and which decisions are available.';
        var link=document.createElement('a');link.className='btn btn-secondary btn-sm';link.textContent='Review completion';link.href=value.href;body.appendChild(link);
      }catch(_error){
        if(disposed || generation!==serial || !details.isConnected || !details.open)return;
        status.textContent='Work details could not be checked. Try again.';
        var retry=document.createElement('button');retry.type='button';retry.className='btn btn-secondary btn-sm';retry.textContent='Try again';retry.addEventListener('click',load);body.appendChild(retry);
      }finally{if(generation===serial){if(timer)clearTimeout(timer);timer=null;controller=null;body.removeAttribute('aria-busy');}}
    }
    details.addEventListener('toggle',function(){if(details.open)load();else reset();});
    return details;
  }
  return Object.freeze({mount:mount,clear:clear,validate:validate});
});
