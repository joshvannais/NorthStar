(function (global) {
  'use strict';

  var active = null;
  var ACTION_LABELS = {
    assign: 'Assign', reassign: 'Reassign', unassign: 'Unassign',
    schedule: 'Schedule', reschedule: 'Reschedule', dispatch: 'Dispatch',
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function value(value, fallback) {
    return typeof value === 'string' && value ? value : (fallback || 'Unavailable');
  }

  function authority(record) {
    return record && (record.authority || record.scheduleAuthority) || null;
  }

  function targetForAuthority(current) {
    if (!current || current.targetState === 'unassigned') return { kind: 'unassigned', id: null };
    if (current.workforceProfileId) return { kind: 'profile', id: current.workforceProfileId };
    return { kind: 'crew', id: current.workforceCrewId };
  }

  function textForEvidence(entry) {
    if (typeof entry === 'string') return entry.slice(0, 1000);
    if (!entry || typeof entry !== 'object') return 'Evidence is unavailable.';
    var parts = ['code', 'label', 'message', 'reason', 'description', 'status'].map(function (key) {
      return typeof entry[key] === 'string' ? entry[key] : '';
    }).filter(Boolean);
    if (parts.length) return parts.join(' — ').slice(0, 1000);
    try { return JSON.stringify(entry).slice(0, 1000); } catch (_error) { return 'Evidence is unavailable.'; }
  }

  function targetLabel(target, directory) {
    if (!target || target.kind === 'unassigned') return 'Unassigned';
    var match = (directory && Array.isArray(directory.targets) ? directory.targets : []).find(function (entry) {
      return entry.kind === target.kind && entry.id === target.id;
    });
    return match ? match.label : target.kind + ' ' + target.id;
  }

  function formatInstant(instant, timeZone) {
    if (!instant) return 'Unscheduled';
    try {
      return new Date(instant).toLocaleString([], {
        timeZone: timeZone, dateStyle: 'medium', timeStyle: 'short',
      }) + ' (' + timeZone + ')';
    } catch (_error) { return 'Schedule unavailable'; }
  }

  function setStatus(message, state, focus) {
    if (!active || !active.status) return;
    active.status.textContent = message;
    active.status.dataset.state = state || 'ready';
    if (focus) active.status.focus({ preventScroll: true });
  }

  function appendTerm(list, term, description) {
    list.append(el('dt', '', term), el('dd', '', description));
  }

  function responseFailure(response, body) {
    var code = body && body.error && body.error.code || body && body.code || '';
    var supplied = body && body.error && body.error.message || body && body.message;
    var messages = {
      401: 'Your signed-in session is no longer current. Sign in again; no change was applied.',
      403: 'Your role, membership, subscription, or session no longer authorizes this action. No change was applied.',
      409: 'Current scheduling authority or evidence changed. Refresh and request a new preview.',
      410: 'This preview expired. Request a new preview before approving.',
      422: 'The proposal cannot be approved because current scheduling evidence rejects it.',
      428: 'Exact preview or approval evidence is missing. Refresh and begin again.',
    };
    var message = supplied || messages[response.status] ||
      (response.status >= 500 ? 'Scheduling is temporarily unavailable. No change was applied.' : 'The request was rejected. No change was applied.');
    var error = new Error(message);
    error.status = response.status;
    error.code = code;
    return error;
  }

  function jsonRequest(url, options) {
    if (!global.NorthStarAccountSession || typeof global.NorthStarAccountSession.fetch !== 'function') {
      return Promise.reject(new Error('Current signed-in session authority is unavailable.'));
    }
    return global.NorthStarAccountSession.fetch(url, options).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (body) {
        if (!response.ok || !body || body.success !== true) throw responseFailure(response, body);
        return body;
      });
    }).catch(function (error) {
      if (error && (error.status || /unavailable|authority|expired|changed|rejected/i.test(error.message))) throw error;
      throw new Error('The network is offline or unavailable. No change was applied.');
    });
  }

  function resolveSchedule() {
    var current = active.current;
    if (!['schedule', 'reschedule'].includes(active.action)) {
      return {
        start: current.scheduledStart ? global.NorthStarSchedulingTime.formatInstant(current.scheduledStart, active.timeZone).rfc3339 : null,
        end: current.scheduledEnd ? global.NorthStarSchedulingTime.formatInstant(current.scheduledEnd, active.timeZone).rfc3339 : null,
      };
    }
    var contract = global.NorthStarSchedulingTime;
    if (!contract) throw new Error('Tenant scheduling time authority is unavailable.');
    var start = contract.resolveWallTime(active.startDate.value, active.startTime.value, active.timeZone);
    var end = active.preserveElapsedDuration ? null
      : contract.resolveWallTime(active.endDate.value, active.endTime.value, active.timeZone);
    if (start.status === 'gap' || end && end.status === 'gap') {
      throw new Error('That wall clock falls in a daylight-saving gap. Choose a valid local time.');
    }
    function candidate(resolution, select, label) {
      var previous = select.value;
      select.replaceChildren();
      if (resolution.status !== 'ambiguous') {
        select.hidden = true;
        select.removeAttribute('required');
        return resolution.candidates[0];
      }
      select.hidden = false;
      select.required = true;
      select.append(el('option', '', 'Choose ' + label + ' occurrence'));
      select.options[0].value = '';
      resolution.candidates.forEach(function (entry) {
        var option = el('option', '', (entry.occurrence === 'first' ? 'First occurrence ' : 'Second occurrence ') + entry.offset);
        option.value = entry.rfc3339;
        select.appendChild(option);
      });
      if (resolution.candidates.some(function (entry) { return entry.rfc3339 === previous; })) select.value = previous;
      if (select.value) return resolution.candidates.find(function (entry) { return entry.rfc3339 === select.value; }) || null;
      return null;
    }
    var selectedStart = candidate(start, active.startOccurrence, 'start');
    var selectedEnd;
    if (active.preserveElapsedDuration) {
      if (!selectedStart) throw new Error('Choose the explicit daylight-saving occurrence for the moved start.');
      var derived = contract.formatInstant(selectedStart.epochMilliseconds + active.elapsedMilliseconds, active.timeZone);
      active.endDate.value = derived.date;
      active.endTime.value = derived.time;
      active.endOccurrence.hidden = true;
      active.endOccurrence.removeAttribute('required');
      selectedEnd = contract.validateRfc3339InZone(derived.rfc3339, active.timeZone);
    } else {
      selectedEnd = candidate(end, active.endOccurrence, 'end');
    }
    if (!selectedStart || !selectedEnd) throw new Error('Choose the explicit daylight-saving occurrence for each ambiguous wall clock.');
    if (selectedEnd.epochMilliseconds <= selectedStart.epochMilliseconds) throw new Error('Schedule end must be after schedule start.');
    return {
      start: selectedStart.rfc3339 || selectedStart.raw,
      end: selectedEnd.rfc3339 || selectedEnd.raw,
    };
  }

  function proposedTarget() {
    if (active.action === 'unassign') return { kind: 'unassigned', id: null };
    if (!['assign', 'reassign'].includes(active.action)) return targetForAuthority(active.current);
    var selected = active.target.value.split(':');
    if (selected.length !== 2 || !selected[1]) throw new Error('Choose a current active worker or crew.');
    return { kind: selected[0], id: selected[1] };
  }

  function previewPayload() {
    var schedule = resolveSchedule();
    var reason = active.reason.value.trim();
    if (!reason) throw new Error('Provide a human approval reason.');
    return {
      expectedRevision: active.current.revision,
      expectedDigest: active.current.digest,
      expectedTimeZone: active.timeZone,
      action: active.action,
      target: proposedTarget(),
      scheduledStart: schedule.start,
      scheduledEnd: schedule.end,
      appointmentStatus: active.current.appointmentStatus,
      reason: reason,
    };
  }

  function evidenceSection(title, entries, className) {
    var section = el('section', className || '');
    section.appendChild(el('h3', '', title));
    var list = el('ul', 'm22-evidence-list');
    (entries || []).forEach(function (entry) { list.appendChild(el('li', '', textForEvidence(entry))); });
    if (!entries || !entries.length) list.appendChild(el('li', '', 'None.'));
    section.appendChild(list);
    return section;
  }

  function renderAcknowledgements(preview) {
    active.review.replaceChildren();
    var summary = el('section', 'm22-dialog-summary');
    summary.appendChild(el('h3', '', 'Exact preview — review before approval'));
    var terms = el('dl');
    appendTerm(terms, 'Action', ACTION_LABELS[preview.action] || preview.action);
    appendTerm(terms, 'Appointment', active.title);
    appendTerm(terms, 'Target', targetLabel(preview.proposal.target, active.directory));
    appendTerm(terms, 'Schedule', formatInstant(preview.proposal.scheduledStart, active.timeZone) + ' to ' + formatInstant(preview.proposal.scheduledEnd, active.timeZone));
    appendTerm(terms, 'Tenant time zone', active.timeZone);
    appendTerm(terms, 'Current revision', String(active.current.revision));
    appendTerm(terms, 'Proposed states', preview.proposal.scheduleState + ' · ' + preview.proposal.dispatchState + ' · ' + preview.proposal.appointmentStatus);
    appendTerm(terms, 'Preview expires', formatInstant(preview.expiresAt, active.timeZone));
    appendTerm(terms, 'Reason', active.reason.value.trim());
    summary.appendChild(terms);
    active.review.appendChild(summary);

    if (active.current.dispatchState === 'dispatched' && ['reassign', 'unassign', 'reschedule'].includes(active.action)) {
      active.review.appendChild(el('p', 'm22-dispatch-warning', 'Approval revokes the current dispatch. A new human dispatch approval will be required.'));
    }
    var conflicts = preview.conflicts || {};
    active.review.appendChild(evidenceSection('Hard conflicts', conflicts.hardConflicts || [],
      conflicts.hardConflicts && conflicts.hardConflicts.length ? 'm22-hard-block' : ''));
    active.review.appendChild(evidenceSection('Soft warnings', conflicts.warnings || []));
    active.review.appendChild(evidenceSection('Needs-review reasons', conflicts.reviewReasons || []));
    var recommendation = preview.recommendation || {};
    active.review.appendChild(evidenceSection('Route and recommendation evidence and uncertainty',
      (recommendation.candidates || recommendation.alternatives || []).concat(recommendation.reviewReasons || recommendation.uncertainty || [])));

    var acknowledgements = el('section');
    acknowledgements.appendChild(el('h3', '', 'Required exact acknowledgements'));
    var list = el('ul', 'm22-ack-list');
    var all = [];
    (preview.warningDigests || []).forEach(function (digest, index) {
      all.push({ digest: digest, label: 'Acknowledge warning ' + (index + 1) + ': ' + textForEvidence((conflicts.warnings || [])[index]) });
    });
    (preview.reviewReasonDigests || []).forEach(function (digest, index) {
      all.push({ digest: digest, label: 'Acknowledge review reason ' + (index + 1) + ': ' + textForEvidence((conflicts.reviewReasons || [])[index]) });
    });
    all.forEach(function (entry) {
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.digest = entry.digest;
      checkbox.addEventListener('change', updateApprovalState);
      var label = document.createElement('label');
      label.append(checkbox, el('span', '', entry.label));
      var item = document.createElement('li');
      item.appendChild(label);
      list.appendChild(item);
    });
    if (!all.length) list.appendChild(el('li', '', 'No warning or review-reason acknowledgement is required.'));
    acknowledgements.appendChild(list);
    active.review.appendChild(acknowledgements);
    active.preview = preview;
    active.form.hidden = true;
    active.review.hidden = false;
    active.back.hidden = false;
    active.previewButton.hidden = true;
    active.approve.hidden = false;
    updateApprovalState();
  }

  function updateApprovalState() {
    if (!active || !active.preview) return;
    var hard = active.preview.conflicts && active.preview.conflicts.hardConflicts || [];
    var checks = Array.from(active.review.querySelectorAll('input[type="checkbox"]'));
    var expired = new Date(active.preview.expiresAt).getTime() <= Date.now();
    active.approve.disabled = hard.length > 0 || expired || checks.some(function (entry) { return !entry.checked; });
    if (expired) setStatus('This preview expired. Return and request a current preview.', 'error', false);
  }

  function requestPreview() {
    var payload;
    try { payload = previewPayload(); } catch (error) { setStatus(error.message, 'error', true); return; }
    active.previewButton.disabled = true;
    setStatus('Creating a 15-minute non-capability preview from current authority…', 'pending', false);
    jsonRequest('/api/v1/canonical/appointments/' + encodeURIComponent(active.appointmentId) + '/mutation-previews', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (body) {
      if (!active) return;
      renderAcknowledgements(body.data);
      setStatus('Preview created. It grants no mutation; review every item before approving.', 'ready', false);
      active.approve.focus();
    }).catch(function (error) {
      if (!active) return;
      setStatus(error.message, 'error', true);
    }).finally(function () { if (active) active.previewButton.disabled = false; });
  }

  function appliedAuthority(body) {
    var data = body && body.data;
    var current = data && data.scheduleAuthority;
    if (!current || !Number.isSafeInteger(current.revision) || !/^[0-9a-f]{64}$/.test(current.digest || '')) {
      throw new Error('The approval response did not include exact durable revision evidence. Reload before any further action.');
    }
    return Object.freeze({
      appointmentId: active.appointmentId,
      revision: current.revision,
      digest: current.digest,
      humanApprovalId: data.humanApproval && data.humanApproval.id || null,
      idempotencyKey: active.idempotencyKey,
    });
  }

  function verifiedRefresh(result, applied) {
    return Boolean(result && result.success === true && result.appointmentId === applied.appointmentId &&
      result.observedRevision === applied.revision && result.observedDigest === applied.digest);
  }

  function showRefreshFailure(error) {
    if (!active || !active.applied) return;
    active.approve.disabled = true;
    active.back.hidden = true;
    active.retry.hidden = false;
    active.reload.hidden = false;
    active.cancel.hidden = true;
    active.closeButton.hidden = true;
    setStatus('Approval applied durably at revision ' + active.applied.revision +
      ', but authoritative refresh failed. Do not approve again. Retry refresh or reload this page. ' +
      (error && error.message ? error.message : ''), 'applied-refresh-failed', true);
    active.retry.focus();
  }

  function refreshApplied() {
    if (!active || !active.applied) return Promise.resolve(false);
    var callback = active.onApplied;
    active.retry.disabled = true;
    setStatus('Approval applied durably at revision ' + active.applied.revision +
      '. Verifying that exact authoritative revision…', 'pending', false);
    return Promise.resolve(callback && callback(active.applied)).then(function (result) {
      if (!active) return false;
      if (!verifiedRefresh(result, active.applied)) {
        throw new Error('The refreshed projection did not prove the exact applied revision and digest.');
      }
      setStatus('Authoritative server state refreshed at revision ' + active.applied.revision + '.', 'success', false);
      active.retry.hidden = true;
      active.reload.hidden = true;
      global.setTimeout(close, 500);
      return true;
    }).catch(function (error) {
      showRefreshFailure(error);
      return false;
    }).finally(function () { if (active) active.retry.disabled = false; });
  }

  function approve() {
    if (!active || !active.preview || active.approve.disabled) return;
    if (!global.crypto || typeof global.crypto.randomUUID !== 'function') {
      setStatus('Secure idempotency identity is unavailable. No approval was sent.', 'error', true);
      return;
    }
    if (!active.idempotencyKey) active.idempotencyKey = 'm22-part5-human-' + global.crypto.randomUUID();
    var reason = active.reason.value.trim();
    var payload = {
      previewId: active.preview.id,
      previewDigest: active.preview.previewDigest,
      acknowledgedWarningDigests: (active.preview.warningDigests || []).slice(),
      acknowledgedReviewReasonDigests: (active.preview.reviewReasonDigests || []).slice(),
      reason: reason,
    };
    active.approve.disabled = true;
    setStatus('Atomically rechecking current authority and applying this human approval…', 'pending', false);
    jsonRequest('/api/v1/canonical/appointments/' + encodeURIComponent(active.appointmentId) + '/mutation-approvals', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': active.idempotencyKey },
      body: JSON.stringify(payload),
    }).then(function (body) {
      if (!active) return;
      active.applied = appliedAuthority(body);
      active.cancel.hidden = true;
      active.closeButton.hidden = true;
      active.back.hidden = true;
      return refreshApplied();
    }).catch(function (error) {
      if (!active) return;
      if (active.applied) { showRefreshFailure(error); return; }
      setStatus(error.message, 'error', true);
      active.approve.disabled = false;
      if ([409, 410, 428].includes(error.status)) active.back.hidden = false;
    });
  }

  function back() {
    if (!active) return;
    active.preview = null;
    active.idempotencyKey = null;
    active.form.hidden = false;
    active.review.hidden = true;
    active.back.hidden = true;
    active.previewButton.hidden = false;
    active.approve.hidden = true;
    active.previewButton.disabled = false;
    setStatus('Review the proposal and request a new current preview.', 'ready', false);
  }

  function close() {
    if (!active) return;
    var focus = active.returnFocus;
    active.layer.remove();
    document.removeEventListener('keydown', active.keydown);
    active = null;
    if (focus && document.contains(focus)) focus.focus();
  }

  function trap(event) {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (active.applied) { setStatus('This approval is durable. Retry refresh or reload before leaving the stale view.', 'applied-refresh-failed', true); return; }
      close(); return;
    }
    if (event.key !== 'Tab') return;
    var focusable = Array.from(active.dialog.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden])'));
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function scheduleFields(form, current, proposal, timeZone) {
    if (!['schedule', 'reschedule'].includes(active.action)) return;
    var contract = global.NorthStarSchedulingTime;
    var existingStart = current.scheduledStart ? contract.formatInstant(current.scheduledStart, timeZone) : null;
    var existingEnd = current.scheduledEnd ? contract.formatInstant(current.scheduledEnd, timeZone) : null;
    var startDate = document.createElement('input'); startDate.type = 'date'; startDate.required = true;
    var startTime = document.createElement('input'); startTime.type = 'time'; startTime.required = true;
    var endDate = document.createElement('input'); endDate.type = 'date'; endDate.required = true;
    var endTime = document.createElement('input'); endTime.type = 'time'; endTime.required = true;
    startDate.value = proposal.date || existingStart && existingStart.date || '';
    startTime.value = proposal.time || existingStart && existingStart.time || '09:00';
    endDate.value = proposal.endDate || existingEnd && existingEnd.date || startDate.value;
    endTime.value = proposal.endTime || existingEnd && existingEnd.time || '10:00';
    if (active.preserveElapsedDuration) {
      endDate.readOnly = true;
      endTime.readOnly = true;
      try {
        var proposedStart = contract.resolveWallTime(startDate.value, startTime.value, timeZone);
        if (proposedStart.status === 'unique') {
          var derived = contract.formatInstant(
            proposedStart.candidates[0].epochMilliseconds + active.elapsedMilliseconds, timeZone
          );
          endDate.value = derived.date;
          endTime.value = derived.time;
        }
      } catch (_error) { /* The explicit preview validation reports invalid wall time. */ }
    }
    function field(labelText, input) { var field = el('div', 'm22-dialog-field'); var label = el('label', '', labelText); label.appendChild(input); field.appendChild(label); return field; }
    var grid = el('div', 'm22-dialog-grid');
    grid.append(field('Start date', startDate), field('Start time', startTime), field('End date', endDate), field('End time', endTime));
    var startOccurrence = document.createElement('select'); startOccurrence.setAttribute('aria-label', 'Start daylight-saving occurrence'); startOccurrence.hidden = true;
    var endOccurrence = document.createElement('select'); endOccurrence.setAttribute('aria-label', 'End daylight-saving occurrence'); endOccurrence.hidden = true;
    grid.append(field('Start occurrence when repeated', startOccurrence), field('End occurrence when repeated', endOccurrence));
    form.appendChild(grid);
    active.startDate = startDate; active.startTime = startTime; active.endDate = endDate; active.endTime = endTime;
    active.startOccurrence = startOccurrence; active.endOccurrence = endOccurrence;
  }

  function targetField(form, directory) {
    if (!['assign', 'reassign'].includes(active.action)) return;
    var wrapper = el('div', 'm22-dialog-field');
    var label = el('label', '', active.action === 'assign' ? 'Assign to active worker or crew' : 'Reassign to a different active worker or crew');
    var select = document.createElement('select'); select.required = true;
    var placeholder = el('option', '', 'Choose a current target'); placeholder.value = ''; select.appendChild(placeholder);
    (directory.targets || []).filter(function (entry) { return entry.kind !== 'unassigned'; }).forEach(function (entry) {
      var option = el('option', '', entry.label + ' — ' + entry.kind); option.value = entry.kind + ':' + entry.id; select.appendChild(option);
    });
    label.appendChild(select); wrapper.appendChild(label); form.appendChild(wrapper); active.target = select;
  }

  function open(options) {
    if (active) close();
    var record = options && options.record;
    var current = authority(record);
    var directory = options && options.directory;
    var action = options && options.action;
    var appointmentId = record && (record.appointmentId || record.id);
    if (!current || !directory || directory.canMutate !== true || !ACTION_LABELS[action] || !appointmentId ||
        !Number.isSafeInteger(current.revision) || !/^[0-9a-f]{64}$/.test(current.digest || '')) {
      throw new Error('Current operator scheduling authority is unavailable. Refresh before acting.');
    }
    var allowed = Array.isArray(record.allowedActions) ? record.allowedActions : options.allowedActions;
    if (Array.isArray(allowed) && !allowed.includes(action)) throw new Error('That action is not available for the current appointment state.');
    var timeZone = options.timeZone || current.timeZone || record.timeZone;
    if (!global.NorthStarSchedulingTime || !global.NorthStarSchedulingTime.isValidTimeZone(timeZone)) {
      throw new Error('Current tenant IANA time-zone authority is unavailable.');
    }

    var layer = el('div', 'm22-dialog-layer');
    var dialog = el('section', 'm22-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'm22DialogTitle');
    var header = el('header', 'm22-dialog-header');
    var title = el('h2', '', ACTION_LABELS[action] + ' appointment'); title.id = 'm22DialogTitle';
    var closeButton = el('button', 'm22-dialog-close', '×'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Cancel scheduling action'); closeButton.addEventListener('click', close);
    header.append(title, closeButton);
    var body = el('div', 'm22-dialog-body');
    var currentSummary = el('section', 'm22-dialog-summary'); currentSummary.appendChild(el('h3', '', 'Current canonical authority'));
    var terms = el('dl');
    var appointmentTitle = value(record.work && record.work.title || record.title, 'Appointment');
    appendTerm(terms, 'Appointment', appointmentTitle);
    appendTerm(terms, 'Customer', value(record.customer && record.customer.name, 'Customer unavailable'));
    appendTerm(terms, 'Target', targetLabel(targetForAuthority(current), directory));
    appendTerm(terms, 'Schedule', formatInstant(current.scheduledStart, timeZone) + ' to ' + formatInstant(current.scheduledEnd, timeZone));
    appendTerm(terms, 'States', current.targetState + ' · ' + current.scheduleState + ' · ' + current.dispatchState + (current.needsReview ? ' · needs review' : ''));
    appendTerm(terms, 'Revision', String(current.revision));
    currentSummary.appendChild(terms); body.appendChild(currentSummary);
    if (current.dispatchState === 'dispatched' && ['reassign', 'unassign', 'reschedule'].includes(action)) {
      body.appendChild(el('p', 'm22-dispatch-warning', 'If approved, this action revokes current dispatch and requires a new human dispatch approval.'));
    }
    var form = el('div');
    var review = el('div'); review.hidden = true;
    body.append(form, review);
    var footer = el('footer', 'm22-dialog-footer');
    var cancel = el('button', '', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', close);
    var footerActions = el('div', 'm22-record-actions');
    var backButton = el('button', '', 'Change proposal'); backButton.type = 'button'; backButton.hidden = true; backButton.addEventListener('click', back);
    var previewButton = el('button', '', 'Create non-capability preview'); previewButton.type = 'button'; previewButton.dataset.kind = 'approve'; previewButton.addEventListener('click', requestPreview);
    var approveButton = el('button', '', 'Approve current preview'); approveButton.type = 'button'; approveButton.dataset.kind = 'approve'; approveButton.hidden = true; approveButton.addEventListener('click', approve);
    var retryButton = el('button', '', 'Retry authoritative refresh'); retryButton.type = 'button'; retryButton.hidden = true; retryButton.addEventListener('click', refreshApplied);
    var reloadButton = el('button', '', 'Reload page'); reloadButton.type = 'button'; reloadButton.hidden = true; reloadButton.addEventListener('click', function () { global.location.reload(); });
    footerActions.append(backButton, previewButton, approveButton, retryButton, reloadButton); footer.append(cancel, footerActions);
    var status = el('p', 'm22-dialog-status', 'Review the current state and prepare a proposal.'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.tabIndex = -1;
    body.appendChild(status); dialog.append(header, body, footer); layer.appendChild(dialog); document.body.appendChild(layer);
    active = {
      layer: layer, dialog: dialog, form: form, review: review, status: status,
      back: backButton, previewButton: previewButton, approve: approveButton,
      retry: retryButton, reload: reloadButton, cancel: cancel, closeButton: closeButton,
      record: record, current: current, directory: directory, action: action,
      appointmentId: appointmentId, title: appointmentTitle, timeZone: timeZone,
      returnFocus: options.returnFocus || document.activeElement,
      onApplied: options.onApplied, keydown: trap, preview: null, idempotencyKey: null,
      preserveElapsedDuration: options.preserveElapsedDuration === true &&
        Number.isFinite(options.elapsedMilliseconds) && options.elapsedMilliseconds > 0,
      elapsedMilliseconds: Number.isFinite(options.elapsedMilliseconds) && options.elapsedMilliseconds > 0
        ? options.elapsedMilliseconds : null,
      applied: null,
    };
    targetField(form, directory);
    scheduleFields(form, current, options.proposal || {}, timeZone);
    var reasonWrapper = el('div', 'm22-dialog-field');
    var reasonLabel = el('label', '', 'Human approval reason');
    var reason = document.createElement('textarea'); reason.maxLength = 1000; reason.required = true;
    reason.value = value(options.reason, 'Human-approved ' + action + ' from ' + value(options.source, 'operator scheduling') + '.');
    reasonLabel.appendChild(reason); reasonWrapper.appendChild(reasonLabel); form.appendChild(reasonWrapper); active.reason = reason;
    document.addEventListener('keydown', trap);
    reason.focus();
    return true;
  }

  global.NorthStarSchedulingApproval = Object.freeze({ open: open, close: close });
})(window);
