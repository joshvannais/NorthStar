(function() {
  'use strict';
  var contract = window.NorthStarCompletionReview, client = window.NorthStarFieldExecutionClient;
  var selectedId, model = null, selection = null, confirmation = null, outcome = null, pending = false, generation = 0;
  var controllers = new Set(), restoreFocus = null;
  var LABELS = { approve_completion: 'Approve completion', cancel_execution: 'Cancel recorded work', reopen_execution: 'Reopen completed work',
    resume_reopened: 'Resume reopened work', correct_completion: 'Add correction note' };
  var COPY = { approve_completion: 'Approve this proposal and mark the work complete if its evidence is still current and its approval deadline has not passed.',
    cancel_execution: 'Mark this work as cancelled. This does not cancel its appointment or delete its history.',
    reopen_execution: 'Reopen this completed work and record the next action. Work does not resume automatically.',
    resume_reopened: 'Resume this reopened work. Its schedule stays the same.',
    correct_completion: 'Add a correction note to the selected record. The original decision and work status stay the same.' };
  var STATES = { not_started: 'Not started', in_progress: 'In progress', paused: 'Paused', completion_pending: 'Completion pending', completed: 'Completed', reopened: 'Reopened', cancelled: 'Cancelled' };
  var GATES = { required_checklists: 'Required checklists', required_inspections: 'Required inspections', required_files: 'Required files',
    unresolved_blockers_or_exceptions: 'Unresolved blockers or exceptions', progress_review: 'Progress review', open_labor_timers: 'Open labor timers',
    labor_review: 'Labor review', material_review: 'Material review', equipment_checkout: 'Equipment checkout', equipment_downtime: 'Equipment downtime', field_evidence_review: 'Field evidence review' };
  var KINDS = { proposal: 'Proposal', approval: 'Approval', withdrawal: 'Withdrawal', cancellation: 'Cancellation', reopening: 'Reopening', resumption: 'Resumption', correction: 'Correction note' };
  function byId(id) { return document.getElementById(id); }
  function node(tag, className, text) { var element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
  function date(value) { return new Date(value).toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC'; }
  function status(state, text, focus) { var element = byId('completionStatus'); element.dataset.state = state; element.textContent = text; if (focus) element.focus(); }
  function lock() {
    document.querySelectorAll('[data-action]').forEach(function(button) { button.disabled = pending || Boolean(outcome); });
    byId('completionRefresh').disabled = pending || !selectedId;
    byId('completionRetry').hidden = !outcome || outcome.kind !== 'uncertain'; byId('completionRetry').disabled = pending;
    byId('completionPrepare').disabled = pending || Boolean(outcome);
    byId('completionConfirmButton').disabled = pending;
  }
  function closeForm() {
    byId('completionForm').hidden = true; byId('completionForm').reset(); byId('completionFormError').textContent = '';
    byId('completionConfirmReason').textContent = ''; byId('completionConfirmDetails').replaceChildren();
    selection = null; confirmation = null;
    if (byId('completionConfirm').open) byId('completionConfirm').close();
  }
  function clear() {
    if (window.NorthStarDownstreamHandoffs) window.NorthStarDownstreamHandoffs.clear();
    if (window.NorthStarOperationalIntelligence) window.NorthStarOperationalIntelligence.clear();
    model = null; restoreFocus = null; closeForm(); byId('completionTitle').textContent = 'Completion review';
    byId('completionLifecycle').textContent = 'Not loaded'; byId('completionLifecycle').dataset.state = 'unavailable';
    byId('completionSnapshot').textContent = ''; byId('completionAssignment').hidden = true;
    byId('completionProposal').hidden = true; byId('completionProposalBody').replaceChildren();
    byId('completionHistory').hidden = true; byId('completionHistorySummary').textContent = ''; byId('completionHistoryRecords').replaceChildren();
    byId('completionActions').replaceChildren(); byId('completionAvailability').textContent = 'Load the latest work details before making a decision.';
  }
  function actionButton(command, target) {
    var button = node('button', '', LABELS[command.action]); button.type = 'button'; button.dataset.action = command.action;
    if (target) button.dataset.targetId = target;
    button.addEventListener('click', function() {
      if (!model || pending || outcome) return;
      closeForm();
      selection = { action: command.action, target: target || null }; restoreFocus = button;
      byId('completionForm').hidden = false; byId('completionFormTitle').textContent = LABELS[command.action];
      var next = ['reopen_execution', 'correct_completion'].includes(command.action), correction = command.action === 'correct_completion';
      byId('completionNextActionField').hidden = !next; byId('completionNextAction').disabled = !next;
      byId('completionNextAction').required = command.action === 'reopen_execution';
      byId('completionNextActionOptional').hidden = !correction;
      byId('completionNoteField').hidden = !correction; byId('completionNote').disabled = !correction; byId('completionNote').required = correction;
      byId('completionFormError').textContent = ''; byId('completionReason').focus();
    });
    return button;
  }
  function render(value) {
    if (window.NorthStarDownstreamHandoffs) window.NorthStarDownstreamHandoffs.mount(byId('completionHandoffsHost'), value.execution.id);
    if (window.NorthStarOperationalIntelligence) window.NorthStarOperationalIntelligence.mount(byId('completionIntelligenceHost'), value.execution.id);
    model = value; closeForm(); byId('completionTitle').textContent = value.title;
    byId('completionLifecycle').textContent = STATES[value.execution.lifecycleState]; byId('completionLifecycle').dataset.state = value.execution.lifecycleState;
    byId('completionSnapshot').textContent = 'Last checked · ' + date(value.evaluatedAt);
    byId('completionAssignment').hidden = !value.execution.assignment.changed;
    byId('completionAssignment').textContent = 'The assignment has changed. Review the latest assignment and completion evidence before approving.';
    byId('completionAvailability').textContent = value.readOnlyReason === 'onboarding_incomplete' ? 'Account onboarding is incomplete. Recorded decisions remain read-only.' :
      value.readOnlyReason === 'subscription_read_only' ? 'Current account access is read-only. No decision can be submitted.' :
        value.commands.some(function(command) { return command.action !== 'correct_completion'; })
          ? 'Choose a decision and provide a reason. NorthStar checks your access and the latest work details before saving.'
          : 'No work-status changes are available here. You can add correction notes to the recorded decisions below when your access allows it.';
    byId('completionActions').replaceChildren();
    value.commands.filter(function(command) { return command.action !== 'correct_completion'; }).forEach(function(command) { byId('completionActions').appendChild(actionButton(command)); });
    byId('completionProposal').hidden = !value.proposal; byId('completionProposalBody').replaceChildren();
    if (value.proposal) {
      var proposal = value.proposal, content = byId('completionProposalBody');
      content.appendChild(node('p', '', proposal.reason));
      content.appendChild(node('p', '', 'Proposed ' + date(proposal.decidedAt) + '; expires ' + date(proposal.expiresAt) + '. ' + (proposal.expired ? 'Expired — approval is unavailable.' : 'Expiry is rechecked when approving.')));
      content.appendChild(node('p', 'completion-muted', 'These details were recorded when completion was proposed. If the work or evidence changes, review a new proposal before approving.'));
      var list = node('ul'); proposal.gates.forEach(function(gate) { list.appendChild(node('li', '', GATES[gate.code] + ': ' + (gate.passed ? 'Passed at proposal' : 'Not passed at proposal') + (gate.count === null ? '' : ' · ' + gate.count + ' recorded'))); }); content.appendChild(list);
      var counts = proposal.evidenceCounts;
      content.appendChild(node('p', 'completion-muted', 'Required evidence: ' + counts.checklists + ' checklists, ' + counts.inspections + ' inspections, ' + counts.files + ' files. Recorded work: ' + counts.labor + ' labor, ' + counts.materials + ' material, ' + counts.progress + ' progress, ' + counts.fieldEvidence + ' field-evidence and ' + counts.equipment + ' equipment records. Counts do not establish customer acceptance or financial results.'));
    }
    byId('completionHistory').hidden = false;
    byId('completionHistorySummary').textContent = value.history.records.length + ' of ' + value.history.total + ' recorded decisions shown.' +
      (value.history.truncated ? ' Only part of the history is shown. Corrections are unavailable while this history is incomplete. Older records are kept.' : ' Original decisions are kept; corrections are separate notes.');
    var history = byId('completionHistoryRecords'); history.replaceChildren();
    value.history.records.forEach(function(record) {
      var article = node('article', 'completion-record');
      article.appendChild(node('h3', '', KINDS[record.kind]));
      article.appendChild(node('p', 'completion-muted', date(record.decidedAt) + ' · ' + STATES[record.lifecycleBefore] + ' → ' + STATES[record.lifecycleAfter]));
      article.appendChild(node('p', '', record.reason));
      if (record.note) article.appendChild(node('p', '', 'Correction note: ' + record.note));
      if (record.nextAction) article.appendChild(node('p', '', 'Next action: ' + record.nextAction));
      var command = value.commands.find(function(item) { return item.action === 'correct_completion' && item.target.id === record.id; });
      if (command) article.appendChild(actionButton(command, record.id)); history.appendChild(article);
    }); lock();
  }
  async function request(path, options) {
    var controller = new AbortController(); controllers.add(controller);
    var timer = setTimeout(function() { controller.abort(); }, options && options.method === 'POST' ? 30000 : 15000);
    try {
      var response = await fetch(path, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options || {}, { signal: controller.signal }));
      var text = await response.text();
      if (new TextEncoder().encode(text).length > 1048576) throw new Error('RESPONSE_LIMIT');
      return { ok: response.ok, status: response.status, body: JSON.parse(text) };
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  function readPath() { return '/api/v1/field-executions/' + encodeURIComponent(selectedId) + '/completion-review'; }
  async function load(message) {
    var token = ++generation; clear(); lock(); status('loading', 'Loading the current recorded work…');
    try {
      var response = await request(readPath()); if (token !== generation) return false;
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) { outcome = null; status('restricted', 'This completion review is not available to the current signed-in account.'); lock(); return false; }
        throw new Error('READ_UNAVAILABLE');
      }
      var value = contract.validate(response.body.data);
      if (value.execution.id !== selectedId || outcome && outcome.scope !== value.scopeDigest) throw new Error('SCOPE_CHANGED');
      if (outcome && outcome.kind === 'applied') outcome = null;
      render(value);
      status(outcome ? 'uncertain' : 'success', outcome ? 'The previous decision outcome is not confirmed. Retry that same decision to resolve it before another action.' : message || 'Current recorded work loaded. No new decision has been submitted.'); lock(); return true;
    } catch (_error) {
      if (token !== generation) return false;
      clear(); status(outcome && outcome.kind === 'applied' ? 'applied-refresh-failed' : 'unavailable', outcome && outcome.kind === 'applied'
        ? 'The decision was recorded, but the current state could not be reloaded. Reload the review; do not submit that decision again.'
        : 'Current completion review is unavailable. Reload before making a decision.'); lock(); return false;
    }
  }
  async function submit(descriptor) {
    if (pending || !descriptor || descriptor.scope !== (model && model.scopeDigest)) return;
    var retrying = Boolean(outcome && outcome.kind === 'uncertain');
    var token = generation; pending = true; closeForm(); lock(); status('pending', 'Saving your reviewed decision. Wait for confirmation before continuing.');
    var headers = { 'Content-Type': 'application/json', 'Idempotency-Key': descriptor.key };
    var csrf = client.cookie(document.cookie, 'northstar_csrf'); if (csrf) headers['X-CSRF-Token'] = csrf;
    try {
      var response = await request('/api/v1/field-executions/' + encodeURIComponent(selectedId) + '/completion-actions', { method: 'POST', headers: headers, body: JSON.stringify(descriptor.body) });
      if (token !== generation) return;
      if (!response.ok) {
        pending = false;
        if ([401, 403, 404].includes(response.status)) {
          outcome = null; clear(); status('restricted', retrying
            ? 'Current access cannot resolve the earlier decision. Its outcome is not confirmed. Reopen the review with authorized access before continuing.'
            : 'Your access no longer allows this decision. Reload the review before continuing.', true); lock(); return;
        }
        // A refusal of a retry says nothing conclusive about the original
        // uncertain request. Keep its exact key/body and suppress other work.
        if (retrying || response.status >= 500) {
          outcome = { kind: 'uncertain', scope: descriptor.scope, request: descriptor };
          status('uncertain', 'The earlier decision outcome is still not confirmed. Retry this same decision when service is available; other decisions remain unavailable.', true); lock(); return;
        }
        outcome = null;
        await load(response.status === 409 ? 'The decision was not saved because access, evidence or the approval deadline changed. Review the latest details before trying again.' : 'The decision was not accepted. Current recorded work has been reloaded.'); return;
      }
      if (!response.body || response.body.success !== true || !response.body.data || response.body.data.id !== selectedId) throw new Error('RESULT_UNCONFIRMED');
      outcome = { kind: 'applied', scope: descriptor.scope }; pending = false;
      await load('Decision saved. The latest work details are shown.'); byId('completionStatus').focus();
    } catch (_error) {
      if (token !== generation) return;
      outcome = { kind: 'uncertain', scope: descriptor.scope, request: descriptor };
      status('uncertain', 'The decision outcome is not confirmed. Retry this same decision to resolve it. Other decisions remain unavailable.', true);
    } finally { if (token === generation || !pending) { pending = false; lock(); } }
  }
  byId('completionForm').addEventListener('submit', function(event) {
    event.preventDefault(); if (!selection || !model || pending || outcome) return;
    try {
      var body = contract.actionBody(model, selection.action, selection.target, { reason: byId('completionReason').value, nextAction: byId('completionNextAction').value, note: byId('completionNote').value });
      confirmation = { key: 'm23-owner-completion-' + crypto.randomUUID(), body: body, scope: model.scopeDigest };
      byId('completionConfirmTitle').textContent = LABELS[selection.action]; byId('completionConfirmDescription').textContent = COPY[selection.action];
      byId('completionConfirmReason').textContent = 'Reason: ' + body.reason;
      var details = byId('completionConfirmDetails'); details.replaceChildren();
      details.appendChild(node('p', 'completion-muted', 'NorthStar will check the latest work and assignment before saving this decision.'));
      var target = body.proposal || body.completion || body.reopening || body.record;
      if (target) details.appendChild(node('p', 'completion-muted', 'This decision applies to the work record you selected.'));
      if (body.nextAction) details.appendChild(node('p', '', 'Next action: ' + body.nextAction));
      if (body.annotation) {
        details.appendChild(node('p', '', 'Correction note: ' + body.annotation.note));
        if (body.annotation.nextAction) details.appendChild(node('p', '', 'Next action: ' + body.annotation.nextAction));
      }
      byId('completionConfirm').showModal(); byId('completionCancelButton').focus();
    } catch (_error) { byId('completionFormError').textContent = 'Enter a short explanation using ordinary text, without links or formatting, before reviewing this decision.'; byId('completionReason').focus(); }
  });
  byId('completionConfirmButton').addEventListener('click', function() { var descriptor = confirmation; submit(descriptor); });
  byId('completionCancelButton').addEventListener('click', function() { confirmation = null; byId('completionConfirm').close(); byId('completionPrepare').focus(); });
  byId('completionConfirm').addEventListener('cancel', function() { confirmation = null; byId('completionPrepare').focus(); });
  byId('completionFormCancel').addEventListener('click', function() { closeForm(); if (restoreFocus && restoreFocus.isConnected) restoreFocus.focus(); });
  byId('completionRefresh').addEventListener('click', function() { if (!pending) load(); });
  byId('completionRetry').addEventListener('click', async function() {
    if (pending || !outcome || outcome.kind !== 'uncertain') return;
    var descriptor = outcome.request;
    // Revalidate scope before retry, but preserve the exact old request even
    // when it was applied and current pins advanced. PostgreSQL owns replay.
    if (await load() && outcome && outcome.kind === 'uncertain' && model.scopeDigest === descriptor.scope) await submit(descriptor);
  });
  window.addEventListener('pagehide', function() { generation += 1; controllers.forEach(function(controller) { controller.abort(); }); controllers.clear(); pending = false; outcome = null; clear(); lock(); });
  window.addEventListener('pageshow', function(event) { if (event.persisted && selectedId) load(); });
  try { selectedId = contract.parseSelector(location.search); load(); }
  catch (_error) { clear(); status('restricted', 'Choose a job from Operations to review its completion.'); lock(); }
})();
