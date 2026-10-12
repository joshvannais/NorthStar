(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NorthStarPolarisQuoteJourney = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var generation = 0;
  var CAP_EDIT_DRAFT = 'customer_financial.estimate.edit_draft';
  var CAP_EDIT_OPTIONS = 'customer_financial.estimate.edit_options';

  function node(tag, text, parent, className) {
    var value = document.createElement(tag);
    if (text !== undefined) value.textContent = text;
    if (className) value.className = className;
    if (parent) parent.appendChild(value);
    return value;
  }
  function id(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
  function uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    var bytes = new Uint8Array(16); crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128; var hex = Array.prototype.map.call(bytes,
      function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function exactMoney(decimal) {
    var match = /^(0|[1-9][0-9]{0,5})(?:\.([0-9]{1,2}))?$/.exec(String(decimal || '').trim());
    if (!match) throw new Error('Enter a price from $0.00 through $100,000.00 using at most two decimal places.');
    var cents = match[1] + (match[2] || '').padEnd(2, '0');
    cents = cents.replace(/^0+(?=[0-9])/, '');
    var minor = String(BigInt(cents || '0'));
    if (BigInt(minor) > 10000000n) throw new Error('Each option must stay within the reviewed launch limit.');
    return { version: 'm27-exact-money-v1', currency: 'USD', minorUnitExponent: 2,
      minorUnits: minor, decimal: (BigInt(minor) / 100n).toString() + '.' +
        (BigInt(minor) % 100n).toString().padStart(2, '0'), exactZero: minor === '0' };
  }
  function decimal(value) {
    if (!value || !/^(0|[1-9][0-9]{0,7})$/.test(String(value.minorUnits || ''))) return '';
    var minor = BigInt(value.minorUnits); return (minor / 100n).toString() + '.' +
      (minor % 100n).toString().padStart(2, '0');
  }
  function responseData(response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (!response.ok || !body.success) throw { status: response.status,
        category: body.error && body.error.category, message: body.error && body.error.message };
      return body.data;
    });
  }
  function request(url, options) {
    return window.NorthStarAccountSession.fetch(url, options || { cache: 'no-store' }).then(responseData);
  }
  function injectStyles() {
    if (document.getElementById('polarisQuoteJourneyStyles')) return;
    var style = node('style'); style.id = 'polarisQuoteJourneyStyles';
    style.textContent = '.polaris-quote-journey{margin-top:1rem;padding:1rem;border:1px solid var(--border-color,#d6d7db);border-radius:14px;background:var(--surface,#fff);color:inherit}.polaris-quote-journey>summary{font-weight:700;cursor:pointer}.polaris-quote-intro{color:var(--text-muted,#5f6774)}.polaris-quote-option{margin:1rem 0;padding:1rem;border:1px solid var(--border-color,#d6d7db);border-radius:12px}.polaris-quote-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.polaris-quote-grid label,.polaris-quote-reason{display:grid;gap:.35rem}.polaris-quote-grid .wide{grid-column:1/-1}.polaris-quote-line{display:grid;grid-template-columns:minmax(10rem,2fr) minmax(5rem,.6fr) minmax(5rem,.7fr) minmax(7rem,.8fr) auto;gap:.5rem;align-items:end;margin:.65rem 0}.polaris-quote-line label{display:grid;gap:.3rem}.polaris-quote-actions{display:flex;flex-wrap:wrap;gap:.6rem;margin:.75rem 0}.polaris-quote-boundary{padding:.75rem;border-radius:10px;background:var(--surface-subtle,#f4f1e9)}.polaris-quote-history{margin:1rem 0;padding:.75rem;border:1px solid var(--border-color,#d6d7db);border-radius:10px}.polaris-quote-history summary{font-weight:650;cursor:pointer}.polaris-quote-history ol{padding-left:1.4rem}.polaris-quote-history li{margin:.45rem 0}.polaris-quote-status:focus{outline:3px solid var(--focus-ring,#d0a847);outline-offset:3px}@media(max-width:680px){.polaris-quote-grid{grid-template-columns:1fr}.polaris-quote-line{grid-template-columns:1fr 1fr}.polaris-quote-line label:first-child{grid-column:1/-1}.polaris-quote-line button{grid-column:1/-1;justify-self:start}.polaris-quote-actions .btn{width:100%}}';
    document.head.appendChild(style);
  }
  function grant(data, capability) { return data && data.capabilities && data.capabilities[capability]; }
  function message(error) {
    if (error && error.status === 409) return 'The quote changed. Reload the current draft before continuing.';
    if (error && error.status === 403) return 'Your current capability does not authorize this quote action.';
    if (error && error.status === 400) return error.message || 'Review every quote field and try again.';
    return 'The quote workflow is unavailable. Refresh the estimate and try again.';
  }
  function mount(review, host) {
    if (!review || !host || review.simulated) return null;
    injectStyles(); var token = ++generation;
    var section = node('details', undefined, host, 'polaris-quote-journey'); section.open = false;
    var summary = node('summary', 'Build a multi-option proposal', section);
    var intro = node('p', 'Edit every customer-facing scope, quantity, line, price, assumption and option. Prices remain human decisions under Mission 24.', section, 'polaris-quote-intro');
    var content = node('div', undefined, section); var data = null; var draft = null;
    var requestGeneration = 0;
    var route = '/api/v1/customer-financial/editable-estimates/' + encodeURIComponent(review.pins.estimateId) + '/quote-journey';
    function status(text) { var current = content.querySelector('.polaris-quote-status'); if (current) { current.textContent = text; current.focus(); } }
    function rejected(error) {
      requestGeneration += 1; data = null; draft = null; content.replaceChildren();
      var note = node('p', message(error), content, 'polaris-quote-status');
      note.setAttribute('role', 'alert'); note.tabIndex = -1; note.focus();
      var retry = node('button', 'Reload current quote', content, 'btn btn-secondary');
      retry.type = 'button'; retry.onclick = load;
    }
    function load() {
      var requestToken = ++requestGeneration; data = null; draft = null;
      content.replaceChildren(); var loading = node('p', 'Loading the current editable quote…', content, 'polaris-quote-status');
      loading.setAttribute('role', 'status'); loading.tabIndex = -1;
      return request(route, { cache: 'no-store' }).then(function (value) {
        if (token !== generation || requestToken !== requestGeneration || !section.isConnected) return;
        data = value; draft = clone(value.draft || value); render();
      }).catch(function (error) {
        if (token !== generation || requestToken !== requestGeneration) return; rejected(error);
      });
    }
    function loadHistoryPage(beforeRevision) {
      var requestToken = ++requestGeneration;
      var url = route + '?historyLimit=20' + (beforeRevision === null ? '' :
        '&historyBefore=' + encodeURIComponent(String(beforeRevision)));
      status('Loading a bounded revision-history page…');
      return request(url, { cache: 'no-store' }).then(function (value) {
        if (token !== generation || requestToken !== requestGeneration || !section.isConnected) return;
        if (!value || value.state !== 'current' || !value.draft || !value.revisionHistory ||
            value.draft.draftDigest !== draft.draftDigest || !value.sourceProposal ||
            value.sourceProposal.sourceProposalDigest !== data.sourceProposal.sourceProposalDigest ||
            value.sourceProposal.sourceProposalRevisionDigest !==
              data.sourceProposal.sourceProposalRevisionDigest) {
          return rejected({ status: 409 });
        }
        data.revisionHistory = value.revisionHistory; render();
        var target = content.querySelector('.polaris-quote-history > summary');
        if (target) target.focus();
      }).catch(function (error) {
        if (token !== generation || requestToken !== requestGeneration) return; rejected(error);
      });
    }
    function lineEditor(line, lines, index, parent) {
      var row = node('div', undefined, parent, 'polaris-quote-line');
      function field(label, value, type) { var wrap=node('label',undefined,row);node('span',label,wrap);var input=node('input',undefined,wrap);input.type=type||'text';input.value=value;input.setAttribute('aria-label',label);return input; }
      var description=field('Line item',line.description),quantity=field('Quantity',line.quantity),unit=field('Unit',line.unit),price=field('Price (USD)',decimal(line.price),'text');
      price.inputMode='decimal'; var remove=node('button','Remove line',row,'btn btn-secondary');remove.type='button';
      function sync(){line.description=description.value;line.quantity=quantity.value;line.unit=unit.value;try{line.price=exactMoney(price.value);price.setCustomValidity('');}catch(error){price.setCustomValidity(error.message);}}
      [description,quantity,unit,price].forEach(function(input){input.addEventListener('input',sync);});
      remove.onclick=function(){if(lines.length===1){status('Each option needs at least one line item.');return;}lines.splice(index,1);render();};
    }
    function optionEditor(option, index, parent) {
      var card=node('fieldset',undefined,parent,'polaris-quote-option');node('legend','Option '+(index+1),card);
      var grid=node('div',undefined,card,'polaris-quote-grid');
      function field(label,value,wide,tag){var wrap=node('label',undefined,grid,wide?'wide':'');node('span',label,wrap);var input=node(tag||'input',undefined,wrap);input.value=value;input.setAttribute('aria-label',label);return input;}
      var name=field('Option name',option.name),scope=field('Scope',option.scope,true,'textarea'),validity=field('Valid for days',String(option.validityDays));validity.type='number';validity.min='1';validity.max='30';
      var assumptions=field('Assumptions, one per line',(option.assumptions||[]).map(function(value){return value.text||value;}).join('\n'),true,'textarea');
      [name,scope,validity,assumptions].forEach(function(input){input.addEventListener('input',function(){option.name=name.value;option.scope=scope.value;option.validityDays=Number(validity.value);option.assumptions=assumptions.value.split(/\r?\n/).map(function(v){return v.trim();}).filter(Boolean);});});
      var lines=node('div',undefined,card);(option.lines||[]).forEach(function(line,lineIndex){lineEditor(line,option.lines,lineIndex,lines);});
      var actions=node('div',undefined,card,'polaris-quote-actions');var addLine=node('button','Add line item',actions,'btn btn-secondary');addLine.type='button';
      addLine.onclick=function(){if(option.lines.length>=100){status('This option has reached the 100-line launch limit.');return;}option.lines.push({id:id('line'),description:'',quantity:'1',unit:'job',price:exactMoney('0')});render();};
      if(draft.options.length>1){var remove=node('button','Remove option',actions,'btn btn-secondary');remove.type='button';remove.onclick=function(){draft.options.splice(index,1);render();};}
    }
    function collectDraft(form) {
      if (!form.reportValidity()) throw new Error('Review the highlighted quote fields.');
      draft.options.forEach(function(option){option.lines.forEach(function(line){line.price=exactMoney(decimal(line.price));});});
      return { options: draft.options.map(function(option){return {id:option.id,name:option.name,scope:option.scope,validityDays:option.validityDays,
        assumptions:(option.assumptions||[]).map(function(value){return value.text||value;}),lines:option.lines.map(function(line){return{id:line.id,description:line.description,quantity:line.quantity,unit:line.unit,price:line.price};})};}) };
    }
    function revisionHistory(parent) {
      var history=data&&data.revisionHistory;
      if(!history||history.state!=='current'||!history.sourceOriginal||!Array.isArray(history.humanRevisions))return;
      var pagination=history.pagination||{};var total=Number(pagination.total);
      if(!Number.isSafeInteger(total)||total<0||history.humanRevisions.length>20){
        setTimeout(function(){rejected({status:409});},0);return;
      }
      var details=node('details',undefined,parent,'polaris-quote-history');
      var label='Revision history · source original + '+total+' human '+
        (total===1?'revision':'revisions');
      node('summary',label,details);var list=node('ol',undefined,details);
      node('li','Source original · '+history.sourceOriginal.sourceProposalDigest.slice(0,12)+'… · '+
        history.sourceOriginal.recordedAt,list);
      history.humanRevisions.forEach(function(entry){
        node('li','Revision '+entry.revision+' · '+entry.reason+' · '+entry.recordedAt+
          ' · '+entry.snapshotDigest.slice(0,12)+'…',list);
      });
      node('p','Showing '+history.humanRevisions.length+' of '+total+
        ' human revisions in deterministic newest-first order.',details,'polaris-quote-intro');
      var historyActions=node('div',undefined,details,'polaris-quote-actions');
      if(pagination.hasEarlier===true&&Number.isSafeInteger(Number(pagination.nextCursor))){
        var earlier=node('button','Show earlier revisions',historyActions,'btn btn-secondary');earlier.type='button';
        earlier.onclick=function(){loadHistoryPage(Number(pagination.nextCursor));};
      }
      if(pagination.beforeRevision!==null&&pagination.beforeRevision!==undefined){
        var latest=node('button','Show latest revisions',historyActions,'btn btn-secondary');latest.type='button';
        latest.onclick=function(){loadHistoryPage(null);};
      }
      node('p','Mission 25 learning remains unavailable until its current tenant-private adapter and purpose permission are proven. No edit is applied automatically.',details,'polaris-quote-boundary');
      node('p','Mission 32 adapter '+history.mission32Adapter.name+' version '+
        history.mission32Adapter.compatibleSchemaVersion+' is pinned to these same estimate, option and line identities. Calculator execution remains unavailable.',details,'polaris-quote-boundary');
    }
    function render() {
      content.replaceChildren(); var form=node('form',undefined,content);form.noValidate=false;
      var heading=node('h4','Editable Polaris quote',form);heading.id='polarisQuoteHeading';
      node('p','Up to 3 options · 100 lines per option · 30-day maximum validity',form,'polaris-quote-intro');
      draft.options.forEach(function(option,index){optionEditor(option,index,form);});
      var actions=node('div',undefined,form,'polaris-quote-actions');var add=node('button','Add option',actions,'btn btn-secondary');add.type='button';add.disabled=draft.options.length>=3;
      add.onclick=function(){var source=clone(draft.options[0]);source.id=id('option');source.name='Option '+(draft.options.length+1);source.lines.forEach(function(line){line.id=id('line');});draft.options.push(source);render();};
      var reasonLabel=node('label',undefined,form,'polaris-quote-reason');node('span','Review reason',reasonLabel);var reason=node('textarea',undefined,reasonLabel);reason.setAttribute('aria-label','Review reason');reason.required=true;reason.minLength=12;reason.maxLength=1000;
      var confirmLabel=node('label',undefined,form);var confirm=node('input',undefined,confirmLabel);confirm.type='checkbox';confirm.required=true;node('span',' I reviewed every option and price in this exact draft.',confirmLabel);
      var save=node('button','Save reviewed draft',actions,'btn btn-primary');save.type='submit';
      var reload=node('button','Reload current quote',actions,'btn btn-secondary');reload.type='button';reload.onclick=load;
      var live=node('p','Ready for human review.',form,'polaris-quote-status');live.setAttribute('role','status');live.setAttribute('aria-live','polite');live.tabIndex=-1;
      if(data.sourceProposal){node('p','Current Mission 24 issued proposal '+data.sourceProposal.reference+' is pinned to source digest '+data.sourceProposal.sourceProposalDigest.slice(0,12)+'… for '+data.sourceProposal.reviewedRecipient.name+'.',form,'polaris-quote-boundary');}
      revisionHistory(form);
      node('p','Customer signature launch requires the exact current Mission 24 proposal, reviewed recipient and legal approval. It remains unavailable here and no proposal is created or delivered.',form,'polaris-quote-boundary');
      node('p','Accepted-estimate-to-work handoff is unavailable until the reviewed Mission 23 receiver exists. No scheduling, dispatch or work record is changed here.',form,'polaris-quote-boundary');
      form.onsubmit=function(event){event.preventDefault();var capability=draft.options.length>1?CAP_EDIT_OPTIONS:CAP_EDIT_DRAFT,currentGrant=grant(data,capability);if(!currentGrant){rejected({status:403});return;}var body;try{body={draft:collectDraft(form),expectedRevision:Number(draft.revision||0),capabilityGrantId:currentGrant.grantId,capabilityGrantRevision:Number(currentGrant.revision),businessPurpose:currentGrant.businessPurpose,policyVersion:currentGrant.policyVersion,reason:reason.value.trim(),confirmed:confirm.checked,confirmationVersion:'m27-polaris-quote-journey-v1'};}catch(error){status(error.message);return;}save.disabled=true;status('Saving the reviewed draft…');request(route+'/draft',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':uuid()},body:JSON.stringify(body)}).then(function(){return load();}).catch(rejected);};
    }
    summary.addEventListener('click',function(){if(!data)setTimeout(load,0);});
    return section;
  }
  function clear() { generation += 1; }
  return { mount: mount, clear: clear, exactMoney: exactMoney, decimal: decimal };
}));
