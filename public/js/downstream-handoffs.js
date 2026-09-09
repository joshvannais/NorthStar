(function(root) {
  'use strict';
  var current = null, generation = 0, controllers = new Set(), unresolved = null;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var DIGEST = /^[0-9a-f]{64}$/;
  var DOMAINS = { labor: 'Labor records', materials: 'Material records', progress: 'Progress and changes', fieldEvidence: 'Field evidence', equipment: 'Equipment events', completion: 'Completion decisions' };
  function element(tag, text, css) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (css) e.className = css; return e; }
  function validate(value, id) {
    if (!value || value.version !== 'm23-downstream-handoffs-v1' || value.executionId !== id || typeof value.sourceAvailable!=='boolean' ||
      (value.sourceAvailable ? !DIGEST.test(value.sourceDigest || '') || !value.sourceSnapshot || value.sourceSnapshot.execution?.id!==id : value.sourceDigest!==null || value.sourceSnapshot!==null) ||
      value.audience !== 'tenant_owner_admin_review' || value.consentVersion !== 'm23-internal-reference-consent-v1' ||
      value.delivery !== 'unavailable' || value.consumptionAuthorized !== false || !Array.isArray(value.receipts) || value.receipts.length > 100 ||
      !Array.isArray(value.missions) || value.missions.length !== 9) throw new Error('Invalid handoff response');
    if(value.sourceAvailable)Object.keys(DOMAINS).forEach(function(domain) { var source = value.sourceSnapshot[domain];
      if (!source || !Number.isInteger(source.count) || source.count < 0 || source.count > 1000 || !Array.isArray(source.pins) ||
        source.count !== source.pins.length || !DIGEST.test(source.digest || '')) throw new Error('Invalid handoff source');
    });
    value.receipts.forEach(function(r) {
      if (!UUID.test(r.id || '') || r.executionId !== id || !DIGEST.test(r.digest || '') || !DIGEST.test(r.sourceDigest || '') ||
        !['prepare','revoke'].includes(r.action) || !['prepared','revoked','source_changed','source_unavailable','revocation'].includes(r.status) ||
        ![24,25,26,27,28,29,30,32].includes(r.mission) || r.delivery !== 'unavailable' || r.consumptionAuthorized !== false) throw new Error('Invalid receipt');
    });
    return value;
  }
  async function request(path, options) {
    var c = new AbortController(); controllers.add(c); var timer = setTimeout(function() { c.abort(); }, 15000);
    try {
      var response = await fetch(path, Object.assign({credentials:'same-origin',cache:'no-store'},options || {},{signal:c.signal}));
      var text = await response.text(); if (new TextEncoder().encode(text).length > 524288) throw new Error('Response limit');
      return { ok:response.ok,status:response.status,body:JSON.parse(text) };
    } finally { clearTimeout(timer); controllers.delete(c); }
  }
  function clear() {
    generation++; controllers.forEach(function(c) { c.abort(); }); controllers.clear();
    if (current) { current.host.replaceChildren(); current = null; }
  }
  function mount(host, id) {
    clear(); if (!host || !UUID.test(id || '')) return;
    if (unresolved && unresolved.id !== id) unresolved = null;
    var scope = ++generation, model = null, pending = false;
    var details = element('details',undefined,'handoff-panel completion-panel'); details.id = 'downstreamHandoffs';
    var summary = element('summary','Downstream handoffs'); details.append(summary);
    var intro = element('p','Prepare an internal reference receipt for a later workflow. Current owners and administrators in your company can review it. Delivery and downstream use are unavailable.','completion-muted');
    var notice = element('p','References stay private. This does not approve a price, send a message, run learning or automation, create an invoice, or make a payment.','handoff-notice');
    var status = element('p','Open to review current source references.','handoff-status'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); status.tabIndex=-1;
    var content = element('div',undefined,'handoff-content'), controls = element('div',undefined,'completion-actions');
    var refresh = element('button','Reload handoff review'); refresh.type='button';
    var retry = element('button','Retry this same handoff'); retry.type='button'; retry.hidden=!unresolved;
    controls.append(refresh,retry); details.append(intro,notice,status,controls,content); host.replaceChildren(details); current={host:host,id:id};
    function setStatus(text, focus) { status.textContent=text; if (focus) status.focus(); }
    function lock() { details.querySelectorAll('button,select,input').forEach(function(e) { e.disabled=pending || Boolean(unresolved); }); retry.disabled=pending; retry.hidden=!unresolved; }
    function clearContent() { model=null; content.replaceChildren(); }
    async function load(message) {
      clearContent(); pending=true; lock(); setStatus('Loading current handoff references…');
      try {
        var result=await request('/api/v1/field-executions/'+id+'/handoffs'); if(scope!==generation)return;
        if(!result.ok) { if([401,403,404].includes(result.status))unresolved=null; throw new Error('Read unavailable'); }
        model=validate(result.body.data,id); render(); setStatus(message || (unresolved ? 'The earlier result is uncertain. Retry the same handoff to confirm its recorded outcome.' : model.sourceAvailable ? 'Current references are ready for review.' : 'Current references exceed this review limit. Existing consent can still be revoked.'));
      } catch(e) { if(scope!==generation)return; clearContent(); setStatus(message ? message+' Current review could not reload.' : navigator.onLine===false ? 'Offline. Reconnect and reload current handoff review.' : 'Handoff review is unavailable or access has changed.'); }
      finally { if(scope===generation){pending=false;lock();} }
    }
    function descriptor(action,mission,digest,target) { return { id:id,key:'m23-handoff-'+crypto.randomUUID(),body:{action:action,mission:mission,
      audience:model.audience,consentVersion:model.consentVersion,consentConfirmed:true,sourceDigest:digest,targetId:target || null} }; }
    async function submit(value) {
      if(pending)return; var retrying=Boolean(unresolved); unresolved=value; pending=true; lock(); setStatus('Recording your explicit handoff decision…');
      try {
        var csrf=root.NorthStarFieldExecutionClient.cookie(document.cookie,'northstar_csrf');
        var result=await request('/api/v1/field-executions/'+id+'/handoff-actions',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':value.key},body:JSON.stringify(value.body)});
        if(scope!==generation)return;
        if(!result.ok) {
          if([401,403,404].includes(result.status)){unresolved=null;clearContent();setStatus('Current access cannot confirm this decision. Reopen with authorized access.',true);return;}
          if(retrying || result.status>=500)throw new Error('Uncertain');
          unresolved=null;clearContent();setStatus('The handoff was not accepted. Reload current references before continuing.',true);return;
        }
        if(result.body?.success!==true || !UUID.test(result.body.data?.receipt?.id || '') || result.body.data.receipt.executionId!==id ||
          result.body.data.receipt.delivery!=='unavailable' || result.body.data.receipt.consumptionAuthorized!==false)throw new Error('Uncertain');
        unresolved=null;pending=false;
        await load(value.body.action==='prepare' ? 'Internal handoff recorded. Delivery and downstream use remain unavailable.' : 'Consent revoked. The original receipt remains in history.');
      } catch(e) { if(scope===generation){clearContent();setStatus('The outcome is uncertain. Retry this same handoff to confirm one recorded result.',true);} }
      finally {if(scope===generation){pending=false;lock();}}
    }
    function render() {
      content.replaceChildren();
      if(model.sourceAvailable){
      var source=element('div',undefined,'handoff-source'); source.append(element('h3','Source references'));
      source.append(element('p','Execution revision '+model.sourceSnapshot.execution.revision+' · '+model.sourceSnapshot.execution.lifecycleState.replace(/_/g,' '),'completion-muted'));
      var counts=element('dl',undefined,'handoff-counts'); Object.keys(DOMAINS).forEach(function(domain){counts.append(element('dt',DOMAINS[domain]),element('dd',String(model.sourceSnapshot[domain].count)));}); source.append(counts);
      source.append(element('p','This receipt pins the current versions for later review. Raw evidence and file contents are not copied.','completion-muted')); content.append(source);
      var form=element('form'), label=element('label','Purpose for later review'); label.htmlFor='handoffMission';
      var select=element('select');select.id='handoffMission'; model.missions.forEach(function(m){var option=element('option',m.label+(m.available===false?' — synthetic data only':''));option.value=String(m.mission);option.disabled=m.available===false;select.append(option);});
      var boundary=element('p',model.missions[0].boundary,'completion-muted');boundary.id='handoffPurpose';select.setAttribute('aria-describedby','handoffPurpose');
      var consentLabel=element('label',undefined,'handoff-consent'), consent=element('input');consent.type='checkbox';consent.id='handoffConsent';consent.required=true;
      consentLabel.append(consent,element('span','I approve saving these source references for this purpose, visible only to current owners and administrators in my company. This consent does not enable downstream use.'));
      var save=element('button','Save internal handoff','completion-primary');save.type='submit';
      form.append(label,select,boundary,consentLabel,save); select.addEventListener('change',function(){consent.checked=false;boundary.textContent=model.missions.find(function(m){return m.mission===Number(select.value);}).boundary;});
      form.addEventListener('submit',function(event){event.preventDefault();if(!pending&&!unresolved&&consent.checked)submit(descriptor('prepare',Number(select.value),model.sourceDigest));}); content.append(form);
      }
      var preparations=model.receipts.filter(function(r){return r.action==='prepare';});
      var history=element('details',undefined,'handoff-history'); history.append(element('summary','Recorded handoffs ('+preparations.length+')'));
      if(!preparations.length)history.append(element('p','No handoffs have been recorded for this work.','completion-muted'));
      preparations.forEach(function(r){
        var item=element('article',undefined,'handoff-receipt'), mission=model.missions.find(function(m){return m.mission===r.mission;});
        item.append(element('h4',mission.label),element('p',r.status==='revoked'?'Consent revoked':r.status==='source_changed'?'Source changed — prepare a new reference after review':r.status==='source_unavailable'?'Current source references unavailable':'Prepared for internal review', 'handoff-receipt-state'));
        item.append(element('p',new Date(r.createdAt).toLocaleString()+' · Delivery unavailable','completion-muted'));
        if(r.status!=='revoked'){
          var revoke=element('button','Revoke consent');revoke.type='button';
          revoke.addEventListener('click',function(){
            if(pending||unresolved)return;
            var confirmation=element('div',undefined,'handoff-revoke-confirm');confirmation.append(element('p','Revoke consent for this '+mission.label.toLowerCase()+' reference? The receipt remains in immutable history.'));
            var yes=element('button','Confirm revocation'),no=element('button','Keep consent');yes.type=no.type='button';
            yes.addEventListener('click',function(){submit(descriptor('revoke',r.mission,r.sourceDigest,r.id));});
            no.addEventListener('click',function(){confirmation.remove();revoke.hidden=false;revoke.focus();});
            confirmation.append(yes,no);revoke.hidden=true;item.append(confirmation);no.focus();
          });item.append(revoke);
        }
        history.append(item);
      });content.append(history);
    }
    refresh.addEventListener('click',function(){if(!pending&&!unresolved)load();});
    retry.addEventListener('click',function(){if(unresolved&&!pending)submit(unresolved);});
    details.addEventListener('toggle',function(){if(details.open&&!model&&!pending)load();});
  }
  root.NorthStarDownstreamHandoffs={mount:mount,clear:clear};
  root.addEventListener('pagehide',clear);
})(window);
