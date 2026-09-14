(function () {
  'use strict';
  var groups = [['materials', 'Materials', 'cdMaterialReview'], ['labor', 'Work And Crew', 'cdLaborPlan'], ['equipment', 'Equipment', 'cdEquipmentPlan'], ['travel', 'Travel And Logistics', 'cdTravelPlan'], ['pricing', 'Price', 'cdPricingPlan']];
  function node(tag, text, parent, className) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; if (parent) parent.appendChild(e); return e; }
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function dispose(state) { if (state) { state.sequence++; clearTimeout(state.timer); } }
  function mount(review, host, previous, options) {
    dispose(previous);
    var state = previous && previous.estimateId === review.pins.estimateId ? previous : { estimateId: review.pins.estimateId, entries: {}, sequence: 0 };
    state.candidateIds=state.candidateIds||[];
    state.data = null; state.busy = false; state.acknowledged = false; state.stale = true;
    var root = node('section', null, host, 'prepared-estimate'); root.id = 'cdPreparedEstimate'; root.setAttribute('aria-labelledby', 'cdPreparedTitle');
    var header = node('div', null, root, 'prepared-heading'); node('h4', 'Prepared Estimate', header).id = 'cdPreparedTitle';
    node('p', review.simulated ? 'Simulated planning with fictional company information.' : 'A draft from your recorded job details and company planning information.', root, 'prepared-muted');
    var status = node('p', 'Preparing the estimate…', root, 'prepared-status'); status.id = 'cdPreparedStatus'; status.setAttribute('role', 'status'); status.tabIndex = -1;
    var actions = node('div', null, root, 'prepared-actions');
    function button(label, id, fn, parent) { var b = node('button', label, parent || actions, 'btn btn-secondary'); b.type = 'button'; b.id = id; b.addEventListener('click', fn); return b; }
    var refresh = button('Refresh', 'cdPreparedRefresh', function () { options.refresh(); });
    var questions = node('div', null, root); questions.id = 'cdPreparedQuestions';
    var edit = node('details', null, root, 'prepared-inputs'); var editSummary = node('summary', 'Adjust Draft Details', edit); editSummary.id = 'cdPreparedAdjust';
    node('p', 'Add technical details when you know them. These assumptions apply only to this draft.', edit, 'prepared-muted');
    var form = node('form', null, edit); form.addEventListener('submit', function (e) { e.preventDefault(); });
    var fields = node('div', null, form, 'prepared-fields'); var formActions = node('div', null, form, 'prepared-actions');
    var calculate = button('Recalculate', 'cdPreparedCalculate', function () { request(false); }, formActions);
    button('Clear Changes', 'cdPreparedClear', function () { state.entries = {};state.candidateIds=[]; invalidate('Changes cleared. ' + (state.stale ? 'Refresh before calculating again.' : 'Recalculate to use the recorded details.')); renderFields(); if(edit.hidden)status.focus();else editSummary.focus(); }, formActions);
    button('Cancel Changes', 'cdPreparedCancel', function () { state.entries = copy(state.applied || {});state.candidateIds=(state.appliedCandidates||[]).slice(); invalidate(state.stale ? 'Refresh before calculating again.' : 'Draft edits canceled. Recalculate when ready.'); renderFields(); edit.open = false; editSummary.focus(); }, formActions);
    var results = node('div', null, root, 'prepared-groups'); results.id = 'cdPreparedGroups';
    var groupHosts = {};
    groups.forEach(function (g) {
      var section = node('section', null, results, 'prepared-group'); node('h5', g[1], section); groupHosts[g[0]] = node('div', null, section);
      button('Edit ' + g[1], 'cdPreparedEdit-' + g[0], function () {
        var target = document.getElementById(g[2]); if (!target) return;
        for (var ancestor = target; ancestor; ancestor = ancestor.parentElement) if (ancestor.tagName === 'DETAILS') ancestor.open = true;
        var control = target.querySelector('summary,button,input,select'); if (control) { control.focus(); control.scrollIntoView({ block: 'nearest' }); }
      }, section);
    });
    var acknowledgment = node('label', null, root, 'prepared-ack'); var check = node('input', null, acknowledgment); check.type = 'checkbox'; check.id = 'cdPreparedAcknowledge';
    node('span', 'I have reviewed these draft assumptions. This does not approve a price or save plans.', acknowledgment);
    check.addEventListener('change', function () { state.acknowledged = check.checked; });
    node('p', 'Draft only. Saved plans and the approved price stay unchanged. Review costs already included before combining plans.', root, 'prepared-muted');
    function current() { return options.isCurrent() && root.isConnected; }
    function controls() { calculate.disabled = state.busy || state.stale || state.unmatched || !state.fields || !state.fields.length; refresh.disabled = state.busy; check.disabled = !state.data || state.stale || state.dirty || state.data.readiness === 'blocked'; check.checked = !!state.acknowledged && !check.disabled; }
    function invalidate(message) { state.sequence++; state.busy = false; state.data = null; state.dirty = true; state.acknowledged = false; clearTimeout(state.timer);var expiry=state.expiresAt;if(expiry&&Date.parse(expiry)<=Date.now())state.stale=true;else if(expiry)state.timer=setTimeout(function(){if(current()&&state.expiresAt===expiry){state.stale=true;invalidate('This draft review expired. Refresh before calculating again.');}},Date.parse(expiry)-Date.now());status.textContent = message; renderGroups(); controls(); }
    function amount(value) { return options.money(value, review.currency); }
    function row(parent, label, value) { var r = node('div', null, parent, 'prepared-row'); node('span', label, r); node('strong', value == null ? 'Not recorded' : String(value), r); }
    function renderGroups() {
      groups.forEach(function (g) {
        var target = groupHosts[g[0]]; target.replaceChildren(); var c = state.data && state.data.components.find(function (c) { return c.kind === g[0]; });
        if(state.denied){node('p','Current information is unavailable.',target,'prepared-muted');return;}
        if(g[0]==='pricing'){var decision=review.decisions&&review.decisions.current,approved=decision&&decision.action==='approve'?decision:(review.decisions&&review.decisions.history||[]).find(function(d){return d.action==='approve';});row(target,'Last approved price before tax',approved?amount(approved.priceBeforeTax):'No approved price recorded');if(approved&&approved!==decision)node('p','This approval belongs to an earlier saved review.',target,'prepared-muted');}
        if (!c) { node('p', state.stale ? 'Refresh to check current information.' : state.dirty ? 'Recalculate to update this group.' : 'More job or company information is needed.', target, 'prepared-muted'); return; }
        if (c.origin === 'current_saved_plan') node('p', 'Saved plan retained. Use Edit to review it.', target, 'prepared-muted');
        if (!c.inputs || !c.result) { node('p', 'Current information is unavailable. Review the saved plan under Edit.', target); return; }
        if (g[0] === 'materials') {
          (c.inputs.lines || []).forEach(function (l) { row(target, l.material, l.quantity + ' ' + l.unit); row(target, 'Waste allowance', l.wastePercent + '%'); }); row(target, 'Material cost', amount(c.result.total));
        } else if (g[0] === 'labor') {
          (c.result.lines || []).forEach(function (l, i) { var input = c.inputs.lines[i]; row(target, input.task, l.workerHours == null ? 'Work time needs review' : l.workerHours + ' worker-hours'); }); row(target, 'Labor cost', amount(c.result.total));
          node('p', 'Work time is not elapsed job time or a crew assignment.', target, 'prepared-muted');
          var candidates = state.data.candidates && state.data.candidates.workers || []; var details = node('details', null, target); node('summary', 'Crew Review', details);
          if (!candidates.length) node('p', 'No current crew information is available.', details);
          candidates.forEach(function (v) { node('p', v.label + ' — ' + (v.status === 'blocked' ? 'Recorded requirements or schedule conflict' : v.status === 'eligible_for_review' ? 'Review for the recorded job time; not assigned' : 'Requirements or availability need review'), details); });
        } else if (g[0] === 'equipment') {
          (c.inputs.lines || []).forEach(function (l, i) { row(target, l.task, l.identity && (l.identity.displayName || l.identity.model || l.identity.equipmentType) || 'Equipment details need review'); var result = (c.result.lines || [])[i]; node('p', result && result.status === 'matches_reviewed_requirements' ? 'Recorded specifications match the reviewed requirements. Condition and availability still need review.' : 'Confirm requirements and current equipment information.', target, 'prepared-muted'); var cost = (c.costs || []).find(function (v) { return v.lineId === l.lineId; }); row(target, 'Equipment cost', cost ? amount(cost.total) : 'Unavailable'); });
        } else if (g[0] === 'travel') {
          row(target, 'Travel and logistics cost', amount(c.result.total)); node('p', 'Declared costs do not confirm a route, crew availability or arrival time.', target, 'prepared-muted');
        } else {
          var price = c.result.result || c.result; row(target, 'Proposed price before tax', amount(price.proposedBeforeTax));
          if (price.overhead) { row(target, 'Gross overhead', amount(price.overhead.gross)); row(target, 'Already included', amount(price.overhead.alreadyIncluded)); row(target, 'Additional overhead', amount(price.overhead.incremental)); }
          node('p', 'Complete cost and margin remain unavailable until included costs are reconciled.', target, 'prepared-muted');
        }
        if (c.origin === 'current_saved_plan') node('p', "Review this saved plan's sources under Edit.", target, 'prepared-muted');
        else if (state.data.recipe) { var source = node('details', null, target); node('summary', 'Planning Source', source); node('p', state.data.recipe.label || 'Company planning information', source); node('p', 'Effective ' + state.data.recipe.effectiveOn + ' · Review by ' + state.data.recipe.reviewBy, source); }
      });
    }
    function renderQuestions() {
      questions.replaceChildren(); if (!state.data) return;
      var conflicts = state.data.conflicts || []; conflicts.forEach(function (text) { node('p', text, questions, 'prepared-status'); });
      var items = state.data.questions || []; if (!items.length) return; node('h5', 'What Needs Your Input', questions);
      function add(q, parent) { var item = node('div', null, parent, 'prepared-question'); node('strong', q.question, item); node('p', q.id==='cost_coverage'?'These draft costs remain separate. Review any costs already included before changing the price.':q.why, item, 'prepared-muted'); }
      items.slice(0, 3).forEach(function (q) { add(q, questions); }); if (items.length > 3) { var rest = node('details', null, questions); node('summary', 'More Details To Review', rest); items.slice(3).forEach(function (q) { add(q, rest); }); }
    }
    function renderFields() {
      if(state.denied){fields.replaceChildren();edit.hidden=true;return;}
      fields.replaceChildren(); var all = state.fields || [];state.unmatched=Object.keys(state.entries).some(function(id){return !all.some(function(f){return f.id===id;});})||state.candidateIds.some(function(id){return !(state.workers||[]).some(function(w){return w.id===id;});}); edit.hidden = !all.length&&!Object.keys(state.entries).length&&!state.candidateIds.length;
      if(state.unmatched)status.textContent='Some earlier edits no longer match the current planning information. Open Adjust Draft Details and use Clear Changes before recalculating.';
      all.forEach(function (f, i) {
        var wrapper = node('div', null, fields); var label = node('label', f.label + (f.unit === 'category' ? '' : ' (' + f.unit + ')'), wrapper); label.htmlFor = 'cdPreparedField-' + i;
        var input = node(f.type === 'category' ? 'select' : 'input', null, wrapper); input.id = label.htmlFor;
        if (f.type === 'category') { var blank = node('option', 'Use recorded detail', input); blank.value = ''; f.allowedValues.forEach(function (v) { var option = node('option', v, input); option.value = v; }); }
        else { input.type = 'text'; input.inputMode = 'decimal'; input.maxLength = 40; input.placeholder = 'Use recorded detail'; }
        input.value = state.entries[f.id] ? state.entries[f.id].value : '';
        var reasonLabel = node('label', 'Reason For This Assumption', wrapper); reasonLabel.htmlFor = input.id + '-reason'; var reason = node('input', null, wrapper); reason.id = reasonLabel.htmlFor; reason.type = 'text'; reason.maxLength = 500; reason.value = state.entries[f.id] ? state.entries[f.id].reason : '';
        function change() { if (input.value === '') delete state.entries[f.id]; else state.entries[f.id] = { fieldId: f.id, value: input.value, unit: f.unit, sourceKind: 'owner_assumption', reason: reason.value }; invalidate(state.stale ? 'Information changed. Refresh before calculating again.' : 'Unsaved changes. Recalculate to update the draft.'); questions.replaceChildren(); }
        input.addEventListener('input', change); input.addEventListener('change', change); reason.addEventListener('input', change);
      });
      if(all.length&&(state.workers||[]).length){var label=node('label','Crew To Review (Not Assigned)',fields);label.htmlFor='cdPreparedCrew';var select=node('select',null,label);select.id='cdPreparedCrew';var none=node('option','No crew selected',select);none.value='';state.workers.forEach(function(w){var option=node('option',w.label+(w.status==='blocked'?' — Conflict':' — Review needed'),select);option.value=w.id;});select.value=state.candidateIds[0]||'';select.addEventListener('change',function(){state.candidateIds=select.value?[select.value]:[];invalidate(state.stale?'Refresh before reviewing this crew.':'Crew choice changed. Recalculate to check the current requirements.');});}
      controls();
    }
    function request(initial) {
      if (!current()) return;if(!initial&&state.unmatched)return; if (!initial && (state.stale || Date.parse(state.expiresAt) <= Date.now())) { state.stale=true;invalidate('This draft review expired. Refresh before calculating again.');return; }
      var overrides = initial ? [] : Object.keys(state.entries).map(function (key) { return state.entries[key]; });
      if (overrides.some(function (v) { return !v.reason.trim(); })) { status.textContent = 'Add a reason for each changed detail.'; status.focus(); return; }
      var sequence = ++state.sequence, trigger = document.activeElement;
      state.busy = true; state.data = null; state.acknowledged = false; clearTimeout(state.timer); renderGroups(); controls(); status.textContent = initial ? 'Preparing the current estimate…' : 'Recalculating your draft…';
      var body = { version: 'estimate-proposal-preview-v1', selectedRevision: review.selectedRevision || null, expectedBasisDigest: initial ? null : state.basis, overrides: overrides, candidateIds: initial?[]:state.candidateIds.slice() };
      window.NorthStarAccountSession.fetch('/api/v1/canonical/estimates/' + encodeURIComponent(review.pins.estimateId) + '/proposal-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok) throw { status: r.status }; if (!b.success || !b.data || b.data.version !== 'estimate-proposal-preview-v1') throw { status: 503 }; return b.data; }); })
        .then(function (data) {
          if (!current() || state.sequence !== sequence) return;
          if (data.sourcePins.estimateId !== review.pins.estimateId || JSON.stringify(data.sourcePins) !== JSON.stringify(review.pins)) throw { status: 409 };
          if (Date.parse(data.expiresAt) <= Date.now()) throw { status: 410 };
          state.denied=false;state.data = data; state.basis = data.basisDigest; state.expiresAt=data.expiresAt; state.stale = false; state.fields = data.editableFields || (initial?[]:state.fields);state.workers=data.candidates&&data.candidates.workers||[]; state.dirty = initial && (Object.keys(state.entries).length > 0||state.candidateIds.length>0);
          if (!initial) {state.applied = copy(state.entries);state.appliedCandidates=state.candidateIds.slice();}
          status.textContent = state.dirty ? 'Current information refreshed. Your edits are retained; recalculate to apply them.' : data.readiness === 'blocked' ? 'Resolve the conflicting job details before using this draft.' : data.components.length ? 'Draft prepared. Review the assumptions and remaining questions.' : 'More information is needed. Start with the questions below.';
          renderGroups(); renderQuestions(); if (initial) renderFields();
          state.timer = setTimeout(function () { if (current() && state.expiresAt === data.expiresAt) { state.stale = true; invalidate('This draft review expired. Refresh before calculating again.'); } }, Math.max(0, Date.parse(data.expiresAt) - Date.now()));
        }).catch(function (error) {
          if (!current() || state.sequence !== sequence) return;
          state.data = null; state.acknowledged = false;state.denied=[401,403,404].indexOf(error.status)>=0; if ([401, 403, 404, 409, 410].indexOf(error.status) >= 0) state.stale = true;
          status.textContent = error.status === 409 ? 'The estimate or company information changed. Refresh before calculating again.' : error.status === 410 ? 'This review expired. Refresh to continue.' : error.status === 401 ? 'Sign in again to prepare this estimate.' : error.status === 403 ? 'Your current account cannot prepare this estimate.' : error.status === 404 ? 'This estimate is unavailable. Choose a current estimate.' : error.status === 400 ? 'Check the details, matching units and reasons, then recalculate.' : error.status === 413 ? 'Shorten the assumption notes and try again.' : error.status === 429 ? 'Preparation is temporarily limited. Wait and try again.' : 'Preparation is unavailable. Try again; no estimate changes were saved.';
          renderGroups();if(state.denied)renderFields(); questions.replaceChildren();
        }).finally(function () { if (!current() || state.sequence !== sequence) return; state.busy = false; controls(); if (document.activeElement === trigger && (trigger === refresh || trigger === calculate)) status.focus(); });
    }
    renderGroups(); renderFields(); controls();
    if (review.isCurrent === false) status.textContent = 'Choose the current estimate to prepare a new draft.'; else request(true);
    return state;
  }
  window.NorthStarPreparedEstimate = { mount: mount, dispose: dispose };
}());
