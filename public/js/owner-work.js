(function () {
  'use strict';
  var root=document.getElementById('ownerWork');if(!root)return;
  var demo=/^\/demo(?:\/|$)/.test(location.pathname),model=null,serial=0,pending=false,uncertain=null,returnFocus=null;
  var states={not_started:'Not Started',in_progress:'In Progress',paused:'Paused',completion_pending:'Completion Pending',completed:'Completed',reopened:'Reopened',cancelled:'Cancelled'};
  var labels={initialize:'Open Work',start:'Start Work',pause:'Pause Work',resume:'Resume Work',progress:'Record Progress Or An Issue',evidence:'Add Supporting Evidence',propose_completion:'Request Completion Review',withdraw_completion:'Withdraw Completion Request'};
  var units={ea:'Items',m:'Metres',m2:'Square Metres',m3:'Cubic Metres',ft:'Feet',ft2:'Square Feet',ft3:'Cubic Feet',yd3:'Cubic Yards',kg:'Kilograms',lb:'Pounds',l:'Litres',gal:'Gallons'};
  var select=root.querySelector('select'),status=root.querySelector('[role=status]'),content=root.querySelector('[data-work-content]'),formHost=root.querySelector('[data-work-form]');
  function node(tag,text){var e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
  function button(text,action){var e=node('button',text);e.type='button';e.className='operations-button';e.addEventListener('click',action);return e;}
  function pin(r){return{id:r.id,revision:r.revision,digest:r.digest};}
  function field(form,name,label,type,value,required){var wrap=node('label'),caption=node('span',label),input=node(type==='textarea'?'textarea':'input');input.name=name;input.id='ownerWork-'+name;if(type!=='textarea')input.type=type||'text';input.value=value==null?'':String(value);input.required=required!==false;wrap.append(caption,input);form.append(wrap);return input;}
  function choice(form,name,label,values,current){var wrap=node('label'),input=node('select');input.name=name;input.id='ownerWork-'+name;Object.keys(values).forEach(function(key){var option=node('option',values[key]);option.value=key;input.append(option);});if(current!==undefined)input.value=current;wrap.append(node('span',label),input);form.append(wrap);return input;}
  function checkbox(form,name,label,checked){var wrap=node('label');wrap.className='owner-work-check';var input=node('input');input.type='checkbox';input.name=name;input.checked=checked===true;wrap.append(input,node('span',label));form.append(wrap);return input;}
  function latest(records){return records.filter(function(r){return!records.some(function(n){return n.previousRecordId===r.id;});});}
  function pins(transition){var e=model.execution,a=model.assignment;return Object.assign({},e?(transition?{expectedRevision:e.revision,expectedDigest:e.digest}:{expectedExecutionRevision:e.revision,expectedExecutionDigest:e.digest}):{},{expectedAssignmentRevision:a.revision,expectedAssignmentDigest:a.digest});}
  async function json(path,options){var r=await (demo?window.NorthStarDemoRuntime.fetch:window.fetch)(path,Object.assign({credentials:'same-origin',cache:'no-store'},options||{})),body=await r.json();if(!r.ok)throw Object.assign(new Error(({400:'Check the required fields and selected records before continuing.',401:'Sign in again before continuing.',403:'Your current access does not allow this update.',404:'This work is no longer available. Refresh the job list.',409:'The work or supporting information changed, or a required step is incomplete. Refresh and review the current work before trying again.',410:'This review has expired. Refresh and review the current work.',429:'Too many requests. Wait briefly, then try again.',503:'Work updates are temporarily unavailable. Refresh to check the saved work.'})[r.status]||'Work details are unavailable. Refresh before continuing.'),{status:r.status});return body;}
  function close(){formHost.replaceChildren();if(returnFocus&&returnFocus.isConnected)returnFocus.focus();}
  async function load(){if(pending)return;var generation=++serial;close();model=null;content.replaceChildren();status.textContent='Loading Current Work…';
    try{var r=await json('/api/v1/field-executions/owner-work/appointments/'+encodeURIComponent(select.value));if(generation!==serial)return;model=r.data;
      if(!model||model.version!=='owner-work-detail-v1'||model.authority!==(demo?'isolated_demo_postgresql':'postgresql')||model.appointmentId!==select.value)throw new Error('The selected job changed. Refresh before continuing.');
      render();status.textContent=uncertain?'The previous outcome is unconfirmed. Retry that same update before making another change.':'Current Work Loaded.';
    }catch(e){if(generation===serial)status.textContent=e.status?e.message:'Work details could not be loaded. Refresh and try again.';}}
  function render(){content.replaceChildren();var heading=node('h3',model.title);content.append(heading,node('p',model.execution?states[model.execution.lifecycleState]:'No Work Opened Yet'));
    if(model.schedulingBasis)content.append(node('p',model.schedulingBasis));
    if(model.unavailable)content.append(node('p',model.unavailable));
    var actions=node('div');actions.className='owner-work-actions';
    if(!uncertain)model.allowedActions.forEach(function(action){var b=button(labels[action],function(){returnFocus=b;open(action);});actions.append(b);});
    if(model.execution){var link=node('a','Completion Review And History');link.href=(demo?'/demo':'/dashboard')+'/completion-review?executionId='+encodeURIComponent(model.execution.id);link.className='operations-button';actions.append(link);}content.append(actions);
    if(uncertain){var retry=button('Retry Same Update',function(){save(uncertain);});content.append(retry);}
    if(model.evidenceLimit){var limits=node('details');limits.append(node('summary','About These Records'),node('p',model.evidenceLimit));content.append(limits);}
    if(model.progress.length){var section=node('details');section.open=true;section.append(node('summary','Progress And Issues'));
      latest(model.progress).forEach(function(record){var d=record.document,article=node('article');article.append(node('p',d.description),node('p',d.reviewState==='owner_confirmed'?'Owner Reviewed':d.reviewState==='disputed'?'Disputed':'Review Required'));
        if(d.quantity)article.append(node('p',d.quantity.completed+' Of '+d.quantity.total+' '+(units[d.quantity.unit]||d.quantity.unit)));
        if(!uncertain&&model.allowedActions.includes('progress')){[['review','Review'],['correct','Correct']].concat(d.kind==='progress'?[['update_progress','Update Progress']]:['blocker','exception'].includes(d.kind)?[['issue_state','Update Issue']]:[]).forEach(function(pair){var b=button(pair[1],function(){returnFocus=b;open('progress',record,pair[0]);});article.append(b);});}section.append(article);});content.append(section);}
    if(model.field.length){var evidence=node('details');evidence.open=true;evidence.append(node('summary','Supporting Evidence'));latest(model.field).forEach(function(record){var d=record.document,article=node('article');article.append(node('p',d.note||d.observation||'Checklist'));
      if(d.kind==='checklist')d.items.forEach(function(item){var b=button('Record Result: '+item.prompt,function(){returnFocus=b;open('evidence',record,'respond_item',item);});b.disabled=uncertain||!model.allowedActions.includes('evidence');article.append(b);});
      else if(['note','observation','checklist_response'].includes(d.kind)&&model.allowedActions.includes('evidence')&&!uncertain){var b=button('Correct Evidence',function(){returnFocus=b;open('evidence',record,'correct');});article.append(b);}evidence.append(article);});content.append(evidence);}
  }
  function observedDefault(){var t=window.NorthStarSchedulingTime.formatInstant(model.evaluatedAt,model.timeZoneAuthority.timeZone);return t.date+'T'+t.time.slice(0,5);}
  function observed(value){var p=value.split('T'),r=window.NorthStarSchedulingTime.resolveWallTime(p[0],p[1],model.timeZoneAuthority.timeZone);if(r.status!=='unique')throw new Error('Choose an observed time with one clear time-zone offset.');return r.candidates[0].rfc3339;}
  function open(family,record,action,item){if(!model||pending||uncertain)return;formHost.replaceChildren();var form=node('form'),fields=node('div');fields.className='owner-work-fields';form.append(node('h3',labels[family]||'Review Work Update'),fields);
    if(['progress','propose_completion'].includes(family)){var zoneLabel=new Intl.DateTimeFormat('en-US',{timeZone:model.timeZoneAuthority.timeZone,timeZoneName:'long'}).formatToParts(new Date(model.evaluatedAt)).find(function(part){return part.type==='timeZoneName';});fields.append(node('p','Times Use '+(zoneLabel?zoneLabel.value:'Business Local Time')+'.'));}
    var original=record&&record.document,kind=action||family,selectAction;
    if(family==='progress'&&!record)selectAction=choice(fields,'action','Record Type',{record_progress:'Progress',record_blocker:'Blocker',record_exception:'Exception',record_change:'Change'});
    if(family==='evidence'&&!record)selectAction=choice(fields,'action','Evidence Type',{record_note:'Note',record_observation:'Inspection Or Observation',create_checklist:'Original Checklist'});
    var dynamic=node('div');dynamic.className='owner-work-fields';fields.append(dynamic);
    function bodyFields(){dynamic.replaceChildren();kind=action||(selectAction?selectAction.value:family);var d=original||{};
      if(['progress','evidence'].includes(family)){var people={};model.performers.forEach(function(p){people[p.id]=p.name;});choice(dynamic,'performer','Person Who Did The Work',people,record?(record.performedBy||record.performedByProfileId):undefined);}
      if(family==='progress'){
        if(kind==='review'){choice(dynamic,'outcome','Review Outcome',{owner_confirmed:'Owner Reviewed',disputed:'Disputed',needs_review:'Needs Review'});return;}
        if(kind==='issue_state'){choice(dynamic,'issueState','Issue Status',{open:'Open',investigating:'Investigating',awaiting_follow_up:'Awaiting Follow-Up',resolved:'Resolved'},d.state);field(dynamic,'resolution','Resolution Details','textarea','',false);field(dynamic,'observedAt','Resolution Observed At','datetime-local',observedDefault());addEvidenceChoices(dynamic);return;}
        field(dynamic,'description','What Was Observed','textarea',d.description);field(dynamic,'observedAt','Observed At','datetime-local',observedDefault());
        var category=d.kind||(kind==='record_progress'?'progress':kind==='record_blocker'?'blocker':kind==='record_exception'?'exception':'field_change');
        if(category==='progress'){
          field(dynamic,'workName','Work Item','text',d.workKey||'');choice(dynamic,'uncertainty','Basis',{measured:'Measured',estimated:'Estimated',unknown:'Unknown'},d.uncertainty||'measured');
          field(dynamic,'completed','Completed Quantity','number',d.quantity&&d.quantity.completed,false).step='any';field(dynamic,'total','Total Quantity','number',d.quantity&&d.quantity.total,false).step='any';choice(dynamic,'unit','Unit',units,d.quantity&&d.quantity.unit||'ea');field(dynamic,'uncertaintyReason','What Is Uncertain','textarea',d.uncertaintyReason,false);
        }else if(category==='blocker'||category==='exception'){
          choice(dynamic,'category','Category',{access:'Access',weather:'Weather',material:'Material',equipment:'Equipment',scope:'Scope',quality:'Quality',coordination:'Coordination',other:'Other'},d.category);
          choice(dynamic,'impact','Work Impact',{prevents_work:'Prevents Work',constrains_work:'Constrains Work',no_current_constraint:'No Current Constraint',unknown:'Unknown'},d.impact);
          choice(dynamic,'severity','Severity',{low:'Low',moderate:'Moderate',high:'High',unknown:'Unknown'},d.severity);field(dynamic,'followUp','Follow-Up Action','textarea',d.followUp&&d.followUp.action);
        }else{choice(dynamic,'difference','Change Basis',{observed:'Observed',requested:'Requested'},d.difference);choice(dynamic,'initiator','Reported By',{owner:'Owner',worker:'Worker',customer_reported:'Customer',other_reported:'Other',unknown:'Unknown'},d.initiator&&d.initiator.source);field(dynamic,'initiatorDescription','Source Details','text',d.initiator&&d.initiator.description);field(dynamic,'affectedWork','Affected Work','textarea',d.affectedWork);field(dynamic,'scheduleImplications','Effect On Schedule','textarea',d.scheduleImplications);field(dynamic,'resourceImplications','Effect On Resources','textarea',d.resourceImplications);}
      }else if(family==='evidence'){
        if(kind==='record_note'||kind==='correct'&&d.kind==='note'){field(dynamic,'note','Note','textarea',d.note);return;}
        if(kind==='create_checklist'){for(var i=1;i<=3;i++){field(dynamic,'item'+i,'Checklist Item '+i,'text','',i===1);checkbox(dynamic,'required'+i,'Required For Completion',true);}return;}
        if(kind!=='respond_item'&&d.kind!=='checklist_response')choice(dynamic,'observationClass','Observation Type',{inspection:'Inspection',quality:'Quality',field_observation:'Field Observation'},d.observationClass);
        choice(dynamic,'resultType','Result',{pass:'Pass',fail:'Fail',needs_review:'Needs Review',observation:'Observation',measurement:'Measurement',unavailable:'Unavailable'},d.resultType);
        field(dynamic,'observation','Observed Result','textarea',d.observation);field(dynamic,'measurement','Measurement Value','number',d.measurement&&d.measurement.value,false).step='any';choice(dynamic,'measurementUnit','Measurement Unit',units,d.measurement&&d.measurement.unit||'ea');
      }else if(family==='propose_completion'){
        field(dynamic,'expiresAt','Review Deadline','datetime-local',observedDefault());
        dynamic.append(node('p','Choose which saved checklists and inspections this request requires. Missing or failed required evidence prevents completion.'));
        latest(model.field).filter(function(r){return r.document.kind==='checklist'||r.document.kind==='file'||r.document.observationClass==='inspection';}).forEach(function(r){checkbox(dynamic,'required-'+r.id,r.document.note||r.document.observation||'Checklist',false);});
      }
    }
    function addEvidenceChoices(target){target.append(node('p','Choose Supporting Evidence For A Resolution'));latest(model.field).forEach(function(r){checkbox(target,'support-'+r.id,r.document.note||r.document.observation||'Checklist',false);});}
    bodyFields();if(selectAction)selectAction.addEventListener('change',bodyFields);
    field(fields,'reason','Reason For This Update','textarea','');
    var confirmation=checkbox(form,'confirmed','I Reviewed These Details And Want To Save This Work Update.',false);
    var error=node('p');error.className='owner-work-error';error.setAttribute('role','alert');form.append(error);
    var actions=node('div');actions.className='owner-work-actions';var saveButton=node('button','Save Reviewed Update');saveButton.type='submit';saveButton.className='operations-button operations-button-primary';var cancel=button('Cancel',close);actions.append(saveButton,cancel);form.append(actions);
    form.addEventListener('input',function(e){if(e.target!==confirmation)confirmation.checked=false;});
    form.addEventListener('submit',function(e){e.preventDefault();if(!confirmation.checked){error.textContent='Review And Confirm The Update Before Saving.';confirmation.focus();return;}
      try{var values=new FormData(form),get=function(k){return String(values.get(k)||'').trim();};var body=Object.assign(pins(['start','pause','resume'].includes(family)),{reason:get('reason')});var domain=['start','pause','resume'].includes(family)?'transition':family==='propose_completion'||family==='withdraw_completion'?'completion':family;
        if(domain==='transition')body.action=family;
        if(domain==='progress'){
          body.action=kind;body.performerProfileId=get('performer');if(record)Object.assign(body,{recordId:record.id,expectedRecordRevision:record.revision,expectedRecordDigest:record.digest});
          if(kind==='review')body.document={outcome:get('outcome')};
          else if(kind==='issue_state')body.document={state:get('issueState'),resolution:get('issueState')==='resolved'?{description:get('resolution'),observedAt:observed(get('observedAt')),evidence:latest(model.field).filter(function(r){return values.has('support-'+r.id);}).map(pin)}:null};
          else{var doc={kind:original?original.kind:kind==='record_progress'?'progress':kind==='record_blocker'?'blocker':kind==='record_exception'?'exception':'field_change',description:get('description'),observedAt:observed(get('observedAt')),timeZoneAuthority:model.timeZoneAuthority,evidence:original?original.evidence:[]};
            if(doc.kind==='progress'){var workKey=original?original.workKey:get('workName').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,64);Object.assign(doc,{workKey:workKey,quantity:get('uncertainty')==='unknown'?null:{completed:get('completed'),total:get('total'),unit:get('unit')},milestone:get('uncertainty')==='unknown'?{key:get('workName')||workKey,state:'unavailable',checklist:null}:null,uncertainty:get('uncertainty'),uncertaintyReason:get('uncertaintyReason')||null});}
            else if(['blocker','exception'].includes(doc.kind))Object.assign(doc,{category:get('category'),impact:get('impact'),severity:get('severity'),followUp:{profileId:get('performer'),action:get('followUp')},state:original?original.state:'open',resolution:original?original.resolution:null});
            else Object.assign(doc,{difference:get('difference'),initiator:{source:get('initiator'),description:get('initiatorDescription')},affectedWork:get('affectedWork'),scheduleImplications:get('scheduleImplications'),resourceImplications:get('resourceImplications')});body.document=doc;}
        }else if(domain==='evidence'){
          body.action=kind;body.performerProfileId=get('performer');var replacement;
          if(kind==='record_note'||kind==='correct'&&original.kind==='note')replacement={kind:'note',note:get('note'),caption:null};
          else if(kind==='create_checklist'){body.template=null;body.items=[1,2,3].filter(function(i){return get('item'+i);}).map(function(i){return{key:'item-'+i,prompt:get('item'+i),required:values.has('required'+i)};});}
          else{replacement={kind:kind==='respond_item'?'checklist_response':original?original.kind:'observation',resultType:get('resultType'),observation:get('observation'),measurement:get('resultType')==='measurement'?{value:get('measurement'),unit:get('measurementUnit')}:null,exception:null,supportingEvidenceIds:[]};if(replacement.kind==='observation')replacement.observationClass=get('observationClass');else{replacement.checklistId=kind==='respond_item'?record.id:original.checklistId;replacement.itemKey=kind==='respond_item'?item.key:original.itemKey;}}
          if(kind==='correct'){Object.assign(body,{evidenceId:record.id,expectedEvidenceRevision:record.revision,expectedEvidenceDigest:record.digest,replacement:replacement});}
          else if(replacement){delete replacement.kind;Object.assign(body,replacement);if(kind==='respond_item')Object.assign(body,{expectedChecklistRevision:record.revision,expectedChecklistDigest:record.digest});}
        }else if(domain==='completion'){
          body.action=family;if(family==='withdraw_completion')body.proposal=pin(model.completion.activeProposal);
          else{body.expiresAt=observed(get('expiresAt'));body.gateRequirements={checklists:[],inspections:[],files:[]};latest(model.field).filter(function(r){return values.has('required-'+r.id);}).forEach(function(r){body.gateRequirements[r.document.kind==='checklist'?'checklists':r.document.kind==='file'?'files':'inspections'].push(pin(r));});}
        }
        var descriptor={appointmentId:model.appointmentId,executionId:model.execution&&model.execution.id,family:domain,body:body,revision:model.demoWorkspaceRevision,key:crypto.randomUUID()};save(descriptor);
      }catch(err){error.textContent=err.message||'Check The Work Details Before Saving.';}});
    formHost.append(form);(form.querySelector('input,select,textarea')||cancel).focus();
  }
  async function save(descriptor){if(pending)return;pending=true;formHost.querySelectorAll('button,input,select,textarea').forEach(function(e){e.disabled=true;});status.textContent='Saving Your Reviewed Update…';
    var headers={'Content-Type':'application/json','Idempotency-Key':descriptor.key},path,body=descriptor.body;
    if(demo){path='/api/demo/command-center/operations/appointments/'+descriptor.appointmentId+'/actions';headers['X-NorthStar-Demo-Intent']='owner-operations';headers['X-NorthStar-Demo-Revision']=String(descriptor.revision);body={family:descriptor.family,body:body};}
    else{var csrf=document.cookie.split(';').map(function(s){return s.trim();}).find(function(s){return s.startsWith('northstar_csrf=');});if(csrf)headers['X-CSRF-Token']=decodeURIComponent(csrf.slice(15));var base='/api/v1/field-executions/';path=descriptor.family==='initialize'?base+'appointments/'+descriptor.appointmentId:base+descriptor.executionId+'/'+({transition:'transitions',progress:'progress-actions',evidence:'field-evidence-actions',completion:'completion-actions'}[descriptor.family]);}
    try{var result=await json(path,{method:'POST',headers:headers,body:JSON.stringify(body)});if(result.success!==true)throw new Error('The update outcome is not confirmed.');uncertain=null;pending=false;await load();status.textContent='Reviewed Update Saved.';root.querySelector('[data-work-refresh]').focus();window.dispatchEvent(new Event('northstar:owner-work-saved'));}
    catch(error){pending=false;if(!error.status||(error.status>=500&&error.status!==503)){uncertain=descriptor;close();render();status.textContent='The Update Outcome Is Unconfirmed. Retry The Same Update To Resolve It.';}
      else{uncertain=null;await load();status.textContent=error.message;root.querySelector('[data-work-refresh]').focus();}}
  }
  root.querySelector('[data-work-refresh]').addEventListener('click',load);select.addEventListener('change',load);
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!pending&&formHost.childElementCount){e.preventDefault();close();}});
  json('/api/v1/field-executions/owner-work').then(function(response){var value=response.data;if(!value||value.authority!==(demo?'isolated_demo_postgresql':'postgresql'))throw new Error('Owner Work Is Unavailable.');select.replaceChildren();value.records.forEach(function(r){var o=node('option',r.title);o.value=r.appointmentId;select.append(o);});var requested=new URLSearchParams(location.search).get('appointmentId');if(requested&&value.records.some(function(r){return r.appointmentId===requested;}))select.value=requested;if(select.value)load();else status.textContent='No Eligible Jobs Are Available. Schedule Existing Work Before Opening Its Work Details.';}).catch(function(e){status.textContent=e.status?e.message:'The job list could not be loaded. Refresh and try again.';});
})();
