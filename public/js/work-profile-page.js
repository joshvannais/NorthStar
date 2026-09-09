(function () {
  'use strict';
  var review = document.body.dataset.profileMode === 'review';
  var content = document.getElementById('profileContent'), editor = document.getElementById('profileEditor');
  var status = document.getElementById('profileStatus'), reload = document.getElementById('profileReload');
  var retry = document.getElementById('profileRetry'), directory = document.getElementById('profileDirectory');
  var confirmDialog = document.getElementById('profileConfirm'), confirmBody = null, opener = null;
  var data = null, target = null, dirty = false, busy = false, pending = null, generation = 0, expiryTimer = null;
  var labels = { empty:'Not yet shared',pending:'Awaiting review',approved:'Profile approved',rejected:'Changes requested',revoked:'Approval revoked',
    available:'Available',limited:'Limited availability',unavailable:'Unavailable',not_shared:'Not shared',expired:'Expired',
    verified:'Verified by your organization',unverified:'Unverified claim' };
  function n(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function button(text, action, primary) { var e = n('button','btn ' + (primary ? 'btn-primary' : 'btn-secondary'),text); e.type = 'button'; e.addEventListener('click',action); return e; }
  function panel(title, copy) { var e=n('section','wp-panel'); if(title)e.appendChild(n('h2','',title)); if(copy)e.appendChild(n('p','wp-muted',copy)); return e; }
  function badge(state) { var e=n('span','wp-badge',labels[state] || state); e.dataset.state=state; return e; }
  function human(value) { return String(value || '').replace(/_/g,' ').replace(/^\w/,function(c){return c.toUpperCase();}); }
  function date(value) { return value ? new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}) : 'Not recorded'; }
  function announce(text, state) { status.textContent=text; status.dataset.state=state || ''; }
  function endpoint() { return '/api/work-profiles/' + (review ? 'reviews/' + target : 'me'); }
  function csrf() { var match=document.cookie.split('; ').find(function(v){return v.startsWith('northstar_csrf=');}); return match ? decodeURIComponent(match.slice(15)) : ''; }
  function discard() { return !dirty || window.confirm('Discard your unsaved profile changes and reload?'); }
  function field(form, id, label, value, type, maximum) {
    var group=n('div'), control=n(type === 'textarea' ? 'textarea' : 'input'), text=n('label','',label);
    text.htmlFor=id; control.id=id; control.name=id; control.value=value || '';
    if(type && type!=='textarea')control.type=type; if(maximum)control.maxLength=maximum;
    group.append(text,control); form.appendChild(group); return control;
  }
  function tags(items,kind) { var list=n('ul','wp-tags'); items.forEach(function(text){var item=n('li','wp-tag',text); if(kind)item.dataset.kind=kind;list.appendChild(item);}); return list; }
  async function api(url, body, key) {
    var controller = new AbortController(), timeout = setTimeout(function(){controller.abort();},15000);
    try {
      var headers={Accept:'application/json'};
      if(body){ headers['Content-Type']='application/json';headers['X-CSRF-Token']=csrf();headers['Idempotency-Key']=key; }
      var response=await fetch(url,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:headers,
        body:body?JSON.stringify(body):undefined,signal:controller.signal});
      var payload=await response.json();
      if(!response.ok || payload.success!==true)throw Object.assign(new Error(payload.error && payload.error.message || 'Request could not be confirmed.'),{status:response.status});
      return payload.data;
    } finally { clearTimeout(timeout); }
  }
  function validate(value) {
    if(!value || value.contractVersion!=='m23-work-profile-v1' || !value.person || !value.profile || !value.availability || !value.permissions ||
      !Array.isArray(value.history) || !Array.isArray(value.certifications) || !Array.isArray(value.person.assignedSkills) ||
      !Number.isSafeInteger(value.profile.revision) || !Number.isSafeInteger(value.availability.revision) ||
      typeof value.permissions.canSubmit!=='boolean' || typeof value.permissions.canReview!=='boolean' ||
      !['empty','pending','approved','rejected','revoked'].includes(value.profile.status) ||
      !['available','limited','unavailable','not_shared','expired'].includes(value.availability.status) ||
      !Number.isFinite(Date.parse(value.serverNow)) || (review && value.person.id!==target)) throw new Error('Current profile authority is invalid.');
    value.certifications.forEach(function(cert){if(!['verified','unverified','expired','revoked'].includes(cert.state))throw new Error('Invalid certification state.');});
    return value;
  }
  function lockEditor() { editor.querySelectorAll('button,input,select,textarea').forEach(function(e){e.disabled=true;}); }
  function unavailable(error) {
    data=null;clearTimeout(expiryTimer);content.replaceChildren();content.setAttribute('aria-busy','false');
    editor.hidden=true;directory.hidden=true;
    var denied=error && [401,403,404].includes(error.status);
    var p=panel(denied?'Profile access changed':'Work profiles are unavailable',
      denied?'Your current account cannot access this profile. Reload after your access is restored.':'Your information has not been replaced. Reload to try again.');
    p.classList.add('wp-empty'); content.appendChild(p);announce(denied?'Current access could not be confirmed.':'Current profile could not be loaded.','error');
  }
  async function load(message, offset) {
    if(busy)return;
    var token=++generation; content.setAttribute('aria-busy','true');announce('Loading current profile…');
    try {
      var result=validate(await api(endpoint()+(offset?'?historyOffset='+offset:'')));
      if(token!==generation)return;
      data=result; dirty=false;pending=null;retry.hidden=true;editor.hidden=true;render();
      announce(message || 'Current profile loaded. Changes remain separate from roles and scheduling.','success');
    } catch(error) { if(token===generation)unavailable(error); }
    finally { if(token===generation)content.setAttribute('aria-busy','false'); }
  }
  async function mutate(body) {
    if(busy)return;
    if(!pending)pending={url:endpoint(),body:JSON.parse(JSON.stringify(body)),key:crypto.randomUUID()};
    busy=true;reload.disabled=true;retry.disabled=true;lockEditor();
    announce('Saving your exact request…');
    try {
      await api(pending.url,pending.body,pending.key);
      pending=null;dirty=false;busy=false;retry.hidden=true;
      await load('Saved to your organization’s profile history.');
    } catch(error) {
      if(error.status===409) {
        pending=null;data=null;retry.hidden=true;
        announce('This version changed. Your draft is still visible, but no further decision can use it. Reload to review the current version.','conflict');
        content.replaceChildren(panel('A newer version is available','Your draft has not overwritten the newer profile. Reload and compare before submitting again.'));
      } else if(error.status===401 || error.status===403 || error.status===404) {
        pending=null;dirty=false;retry.hidden=true;unavailable(error);
      } else if(error.status===400) {
        pending=null;editor.querySelectorAll('button,input,select,textarea').forEach(function(e){e.disabled=false;});
        announce(error.message+' Check field lengths, dates and reference-only document identifiers.','error');
      } else {
        retry.hidden=false;announce('Save was not confirmed. Your exact request is retained here; use Retry same request to avoid a duplicate.','error');
      }
    } finally { busy=false;reload.disabled=false;retry.disabled=false; }
  }
  function historySection() {
    var section=panel(), disclosure=n('details','wp-history'), summary=n('summary','','Profile & availability history');
    disclosure.append(summary,n('p','wp-muted','Every submission and decision is retained. Showing '+data.history.length+' of '+data.historyTotal+' records.'));
    var list=n('ol');
    data.history.forEach(function(record){
      var item=n('li'), line=n('div','wp-heading');
      line.append(n('strong','',human(record.action)+' · '+human(record.stream)+' version '+record.revision),badge(record.status));
      item.append(line,n('p','wp-muted',record.actorName+' · '+human(record.actorAccessRole)+' · '+date(record.created_at)));
      if(record.reason)item.appendChild(n('p','',record.reason));
      var details=n('details'), detailSummary=n('summary','','View exact submitted information');
      details.appendChild(detailSummary);
      if(record.stream==='profile'){
        details.append(n('p','',record.document.title),n('p','',record.document.summary));
        details.appendChild(tags(record.document.skills));
        record.document.certifications.forEach(function(c){details.appendChild(n('p','wp-muted',c.name+' · '+c.issuer+' · Expires '+(c.expiresOn || 'not specified')+' · Reference '+(c.documentReference || 'not provided')+
          (record.status==='approved' && record.verifiedCertificationIds.includes(c.id)?' · Evidence verified for this decision':'')));});
      } else details.appendChild(n('p','',human(record.document.status)+' · '+record.document.note+' · Until '+date(record.document.until)));
      details.appendChild(n('p','wp-muted','Record '+record.id+(record.previous_id?' · Previous '+record.previous_id:'')));
      item.appendChild(details);list.appendChild(item);
    });
    if(!data.history.length)disclosure.appendChild(n('p','wp-muted','Your first submission will start this history.'));
    disclosure.appendChild(list);
    var actions=n('div','wp-actions');
    if(data.historyOffset)actions.appendChild(button('Newest history',function(){load(null,0);}));
    if(data.nextHistoryOffset!==null)actions.appendChild(button('Older history',function(){load(null,data.nextHistoryOffset);}));
    disclosure.appendChild(actions);section.appendChild(disclosure);return section;
  }
  function render() {
    content.replaceChildren(); clearTimeout(expiryTimer);
    var grid=n('div','wp-grid'), main=n('div','wp-stack'), aside=n('div','wp-stack');
    var hero=panel(), copy=n('div','wp-hero-copy'), initials=data.person.name.split(/\s+/).slice(0,2).map(function(part){return part[0] || '';}).join('').toUpperCase();
    hero.classList.add('wp-hero'); copy.append(n('p','wp-kicker','Professional profile'),n('h2','',data.person.name),
      n('p','',data.profile.document ? data.profile.document.title : 'Your experience belongs here'));
    hero.append(n('span','wp-avatar',initials),copy); main.appendChild(hero);
    var about=panel(), heading=n('div','wp-heading'), left=n('div');
    left.append(n('h2','','Skills & experience'),n('p','wp-muted','Employee-submitted information'));heading.append(left,badge(data.profile.status));about.appendChild(heading);
    if(data.profile.document) {
      about.append(n('p','',data.profile.document.summary || 'No professional summary shared yet.'),tags(data.profile.document.skills,'claim'));
      if(!data.profile.document.skills.length)about.appendChild(n('p','wp-muted','No capabilities listed yet.'));
    } else about.appendChild(n('p','wp-muted','Share your professional title, practical capabilities and training. Your owner or administrator can review what you submit.'));
    if(!review && data.permissions.canSubmit)about.appendChild(button(data.profile.document?'Edit my profile':'Build my profile',editProfile,true));
    if(['rejected','revoked'].includes(data.profile.status) && data.profile.reason)about.appendChild(n('p','wp-note','Review feedback: '+data.profile.reason));
    about.appendChild(n('p','wp-note','Your title and skills are self-claims. Approval does not change your assigned job role, permissions or eligibility for a job.'));main.appendChild(about);
    var certificates=panel('Certifications','Evidence is reviewed by your organization—not checked with an external issuer.');
    var certList=n('div');data.certifications.forEach(function(cert){
      var item=n('article','wp-certificate'), head=n('div','wp-certificate-head'), label=n('div');
      label.append(n('h3','',cert.name),n('p','wp-muted',cert.issuer));head.append(label,badge(cert.state));
      item.append(head,n('p','wp-muted','Expires '+(cert.expiresOn || 'not specified')),
        n('p','wp-muted','Document reference: '+(cert.documentReference || 'Not provided')));certList.appendChild(item);
    });
    if(!data.certifications.length)certList.appendChild(n('p','wp-muted','No certifications shared yet. Add training or credentials when you have the issuer and record details.'));
    certificates.append(certList,n('p','wp-note','References are labels for records your organization holds. NorthStar does not open links, upload documents or verify legal qualifications here.'));main.appendChild(certificates);
    var role=panel(review?'Team-defined role':'Your team role','Defined by your owner or administrator.');
    [['Operational role',human(data.person.operationalRole)],['Account access',human(data.person.accessRole)],['Membership',human(data.person.membershipStatus)]].forEach(function(value){
      var fact=n('div','wp-fact');fact.append(n('span','wp-label',value[0]),n('strong','',value[1]));role.appendChild(fact);
    });
    role.append(n('span','wp-label','Assigned skill categories'),tags(data.person.assignedSkills.map(function(skill){return skill.name;})));
    if(!data.person.assignedSkills.length)role.appendChild(n('p','wp-muted','No owner-assigned categories yet.'));
    aside.appendChild(role);
    var availability=panel('Current availability','A short-lived update for your team. Not a schedule or time-off request.');
    availability.appendChild(badge(data.availability.status));
    if(data.availability.document && data.availability.status!=='expired' && data.availability.status!=='not_shared') {
      availability.append(n('p','',data.availability.document.note || 'No additional note.'),n('p','wp-muted','Until '+date(data.availability.document.until)));
      var delay=Date.parse(data.availability.document.until)-Date.parse(data.serverNow);
      if(delay>0)expiryTimer=setTimeout(function(){if(!dirty && !busy)load('Availability has expired.');else announce('Availability may have expired. Reload after finishing your draft.');},Math.min(delay+100,2147483647));
    } else availability.appendChild(n('p','wp-muted',data.availability.status==='expired'?'This update has expired. Share a new update when your availability changes.':'No current availability update.'));
    if(!review && data.permissions.canSubmit)availability.appendChild(button('Update availability',editAvailability));
    aside.appendChild(availability);
    if(data.permissions.readOnlyReason)aside.appendChild(panel('Read-only profile','Your current account or subscription allows viewing, but not new submissions or decisions.'));
    if(review) {
      var decisions=panel('Review this version','Approve the professional information, request changes, or revoke a previous approval.');
      if(data.permissions.canReview && ['pending','approved'].includes(data.profile.status)) {
        if(data.profile.status==='pending')decisions.append(button('Review & approve',function(){editReview('approve');},true),button('Request changes',function(){editReview('reject');}));
        else decisions.appendChild(button('Revoke approval',function(){editReview('revoke');}));
      } else decisions.appendChild(n('p','wp-muted',data.profile.status==='empty'?'This employee has not submitted a profile yet.':'No review decision is currently available for this version.'));
      aside.appendChild(decisions);
    }
    grid.append(main,aside); content.append(grid,historySection());
  }
  function startEditor(title) {
    if(pending || busy || !data)return null;
    editor.replaceChildren();editor.hidden=false;editor.appendChild(n('h2','',title));editor.firstChild.id='profileEditorTitle';
    var form=n('form','wp-form');editor.appendChild(form);
    form.addEventListener('input',function(){dirty=true;announce('Unsaved changes. Nothing has been submitted yet.');});
    editor.scrollIntoView({block:'start',behavior:'auto'});
    return form;
  }
  function finishEditor(form,submitLabel,handler) {
    var actions=n('div','wp-actions'), submit=n('button','btn btn-primary',submitLabel);submit.type='submit';
    actions.append(submit,button('Cancel editing',function(){if(discard()){dirty=false;editor.hidden=true;announce('Changes discarded.');}}));form.appendChild(actions);
    form.addEventListener('submit',function(event){event.preventDefault();handler(event);});
    var focus=form.querySelector('input,textarea,select');if(focus)focus.focus({preventScroll:true});
  }
  function editProfile() {
    if(!data || !data.permissions.canSubmit)return;
    var current=data.profile.document || {title:'',summary:'',skills:[],certifications:[]}, revision=data.profile.revision;
    var form=startEditor('Edit my professional profile');if(!form)return;
    var title=field(form,'profileClaimTitle','Professional title',current.title,'text',120);title.required=true;
    var summary=field(form,'profileSummary','Professional summary',current.summary,'textarea',2000);
    var skills=field(form,'profileSkills','Capabilities · one per line (up to 20)',current.skills.join('\n'),'textarea',2500);
    var certs=n('div','wp-stack');form.appendChild(certs);
    function addCertificate(value) {
      if(certs.children.length>=12)return;
      value=value || {id:crypto.randomUUID(),name:'',issuer:'',expiresOn:null,documentReference:null};
      var fs=n('fieldset'), legend=n('legend','','Certification'), fields=n('div','wp-form-grid');fs.dataset.certId=value.id;fs.append(legend,fields);
      var prefix='cert-'+value.id;
      var name=field(fields,prefix+'-name','Certification name',value.name,'text',120);name.required=true;name.dataset.certField='name';
      var issuer=field(fields,prefix+'-issuer','Issuer',value.issuer,'text',120);issuer.required=true;issuer.dataset.certField='issuer';
      field(fields,prefix+'-expiry','Expiration date (optional)',value.expiresOn,'date').dataset.certField='expiresOn';
      var ref=field(fields,prefix+'-reference','Document reference (optional)',value.documentReference,'text',80);ref.dataset.certField='documentReference';ref.pattern='[A-Za-z0-9][A-Za-z0-9._\\-]{0,79}';
      fs.append(n('p','wp-muted','Use a record identifier such as CERT-014, not a link or file path.'),button('Remove this certification',function(){fs.remove();dirty=true;}));certs.appendChild(fs);
    }
    current.certifications.forEach(addCertificate);
    form.appendChild(button('Add certification',function(){addCertificate();dirty=true;}));
    form.appendChild(n('p','wp-note','A new submission replaces the current review status with Awaiting review. Earlier submissions and decisions remain in history.'));
    finishEditor(form,'Submit for review',function(){
      var certificates=Array.from(certs.children).map(function(fs){var result={id:fs.dataset.certId};fs.querySelectorAll('[data-cert-field]').forEach(function(control){result[control.dataset.certField]=control.value || (['expiresOn','documentReference'].includes(control.dataset.certField)?null:'');});return result;});
      mutate({action:'submit',expectedRevision:revision,profile:{title:title.value,summary:summary.value,skills:skills.value.split('\n').map(function(v){return v.trim();}).filter(Boolean),certifications:certificates}});
    });
  }
  function editAvailability() {
    if(!data || !data.permissions.canSubmit)return;
    var revision=data.availability.revision,form=startEditor('Share current availability');if(!form)return;
    var group=n('div'),label=n('label','','Availability');label.htmlFor='profileAvailability';var select=n('select');select.id='profileAvailability';
    ['available','limited','unavailable','not_shared'].forEach(function(state){var option=n('option','',labels[state]);option.value=state;select.appendChild(option);});group.append(label,select);form.appendChild(group);
    var until=field(form,'profileAvailabilityUntil','Until (your local time, within seven days)','','datetime-local');until.required=true;
    var note=field(form,'profileAvailabilityNote','Note (optional)','','textarea',500);
    select.addEventListener('change',function(){var clear=select.value==='not_shared';until.disabled=clear;until.required=!clear;note.disabled=clear;});
    finishEditor(form,'Save availability',function(){mutate({action:'availability',expectedRevision:revision,availability:{status:select.value,note:select.value==='not_shared'?'':note.value,until:select.value==='not_shared'?null:new Date(until.value).toISOString()}});});
  }
  function editReview(action) {
    if(!data || !data.permissions.canReview)return;
    var revision=data.profile.revision,form=startEditor(action==='approve'?'Approve professional information':action==='reject'?'Request profile changes':'Revoke profile approval');if(!form)return;
    var reason=field(form,'profileReviewReason','Reason for this decision','','textarea',1000);reason.required=true;
    var checks=[];
    if(action==='approve') {
      var fs=n('fieldset');fs.append(n('legend','','Certification evidence reviewed'),n('p','wp-muted','Select only records your organization has actually checked. Unselected certifications remain unverified.'));
      data.certifications.forEach(function(cert){
        var label=n('label','wp-check'),checkbox=n('input');checkbox.type='checkbox';checkbox.value=cert.id;
        checkbox.disabled=!cert.documentReference || cert.state==='expired' || cert.state==='revoked';
        label.append(checkbox,n('span','',cert.name+(checkbox.disabled?' — document reference missing or evidence unavailable':'')));fs.appendChild(label);checks.push(checkbox);
      });form.appendChild(fs);
    }
    finishEditor(form,'Review decision',function(event){
      confirmBody={action:action,expectedRevision:revision,reason:reason.value};
      if(action==='approve')confirmBody.verifiedCertificationIds=checks.filter(function(c){return c.checked&&!c.disabled;}).map(function(c){return c.value;});
      document.getElementById('profileConfirmCopy').textContent=human(action)+' version '+revision+' for '+data.person.name+'. Reason: '+reason.value;
      // WebKit does not focus buttons on pointer activation. Restore the actual
      // submit control rather than whichever text field happened to retain focus.
      opener=event.submitter || form.querySelector('button[type="submit"]');confirmDialog.showModal();
    });
  }
  async function loadDirectory(after) {
    if(busy)return;
    ++generation;data=null;target=null;content.replaceChildren();editor.hidden=true;directory.hidden=false;
    announce('Loading employee work profiles…');directory.setAttribute('aria-busy','true');
    try {
      var result=await api('/api/work-profiles/reviews'+(after?'?after='+after:''));
      if(!result || result.contractVersion!=='m23-work-profile-directory-v1' || !Array.isArray(result.records))throw new Error('Invalid review directory.');
      directory.replaceChildren();var list=n('div','wp-directory');
      result.records.forEach(function(person){
        if(!/^[0-9a-f-]{36}$/.test(person.id))throw new Error('Invalid profile identity.');
        var card=button('',function(){if(!discard())return;target=person.id;directory.hidden=true;load();});card.className='wp-panel wp-directory-card';
        card.append(n('p','wp-kicker',human(person.operationalRole)),n('h2','',person.name),n('p','wp-muted','Employee-submitted professional information'),badge(person.status));
        card.setAttribute('aria-label','Review '+person.name);list.appendChild(card);
      });
      if(!result.records.length)list.appendChild(panel('No employee profiles yet','Employee profiles appear here when individual workforce accounts have been added in Team.'));
      directory.appendChild(list);
      if(result.nextAfter)directory.appendChild(button('Next employee profiles',function(){loadDirectory(result.nextAfter);}));
      if(after)directory.appendChild(button('First employee profiles',function(){loadDirectory();}));
      announce('Choose a person to review their current profile and history.');
    } catch(error) { unavailable(error); }
    finally { directory.setAttribute('aria-busy','false'); }
  }
  document.getElementById('profileConfirmCancel').addEventListener('click',function(){confirmDialog.close();});
  document.getElementById('profileConfirmAccept').addEventListener('click',function(){var body=confirmBody;confirmDialog.close();if(body)mutate(body);});
  confirmDialog.addEventListener('close',function(){confirmBody=null;if(opener && opener.isConnected)opener.focus({preventScroll:true});});
  confirmDialog.addEventListener('keydown',function(event){
    if(event.key!=='Tab')return;
    var controls=Array.from(confirmDialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled])')).filter(function(e){return e.getClientRects().length;});
    if(!controls.length)return;
    var first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
  });
  reload.addEventListener('click',function(){if(!discard())return;dirty=false;pending=null;retry.hidden=true;if(review)loadDirectory();else load();});
  retry.addEventListener('click',function(){if(pending)mutate(pending.body);});
  window.addEventListener('beforeunload',function(event){if(dirty || pending){event.preventDefault();event.returnValue='';}});
  if(review)loadDirectory();else load();
})();
