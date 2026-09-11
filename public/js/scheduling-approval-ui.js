(function (global) {
  'use strict';

  var active = null;
  var ACTION_LABELS = {
    assign: 'Assign', reassign: 'Reassign', unassign: 'Unassign',
    schedule: 'Schedule', reschedule: 'Reschedule', dispatch: 'Dispatch',
  };
  var TARGET_DIRECTORY_ENDPOINT = '/api/v1/canonical/operator-targets';
  var TARGET_DIRECTORY_VERSION = 'm22-part5-target-directory-v1';

  function displayProjection() {
    if (!global.NorthStarDisplayProjection) {
      throw new Error('Scheduling details could not load. Refresh this page.');
    }
    return global.NorthStarDisplayProjection;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function value(value, fallback) {
    return displayProjection().text(value, fallback || 'Unavailable');
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
    var explanations={appointment_schedule_unavailable:'Choose appointment times before reviewing availability.',target_unassigned:'No worker or crew is assigned. Staffing and availability still need review.',target_unavailable:'The selected worker or crew is unavailable.',inactive_target:'The selected worker is inactive.',inactive_crew_member:'A member of this crew is inactive.',crew_membership_incomplete:'The crew membership is incomplete.',crew_membership_bounded:'Not all crew members could be checked.',required_skill_authority_missing:'Required job skills have not been confirmed.',required_skill_authority_bounded:'Some required skills could not be checked.',required_skill_mismatch:'The selected team does not have the recorded required skill.',location_scope_authority_missing:'The service location has not been confirmed.',target_location_scope_missing:'The selected team has no confirmed service location.',location_scope_mismatch:'The selected team belongs to a different service location.',working_hours_authority_incomplete:'Working hours are incomplete for these dates.',outside_working_hours:'The proposed times are outside recorded working hours.',availability_authority_bounded:'Some availability information could not be checked.',availability_authority_missing:'Availability has not been recorded.',availability_authority_stale:'Recorded availability needs to be updated.',declared_availability_incomplete:'Availability does not cover the entire proposed interval.',declared_unavailable:'The selected team is unavailable during this interval.',approved_schedule_overlap:'These times overlap another approved assignment for this team.',overlap_authority_unapproved:'These times overlap work whose scheduling approval is not recorded.',schedule_buffer_threshold:'These times leave less than the recorded gap between jobs.',workload_authority_incomplete:'Some workload information is missing.',workload_authority_unapproved:'Some workload entries have not been approved.',workload_evidence_bounded:'Not all workload entries could be checked.',max_jobs_per_day_threshold:'This would exceed the recorded daily job limit.',workday_length_threshold:'This would exceed the recorded workday length.',crew_size_threshold:'The crew size needs review for this job.',schedule_evidence_bounded:'Not all existing appointments could be checked.',conflict_evidence_bounded:'Additional scheduling checks need review.',candidate_set_bounded:'Not all workers or crews could be considered.',candidate_set_empty:'No worker or crew recommendation is available.',recommendation_evidence_incomplete:'More information is needed before recommending a team.',all_candidates_hard_conflict:'Every checked team has a scheduling conflict.',recommended_candidate_needs_review:'The suggested team still needs review.',conflict_authority_needs_review:'Scheduling checks need further review.',conflict_explanations_bounded:'Some scheduling explanations are unavailable.',candidate_origin_location_missing:'The team starting location is missing.',candidate_origin_location_authority_unavailable:'The team starting location is unconfirmed.',candidate_origin_coordinates_unavailable:'The team starting location cannot be located on the map.',appointment_destination_location_missing:'The job location is missing.',appointment_destination_location_authority_unavailable:'The job location is unconfirmed.',appointment_destination_coordinates_unavailable:'The job location cannot be located on the map.',driving_route_evidence_unavailable:'Driving time and route have not been verified.',geodesic_distance_available:'A straight-line distance is available; it is not driving distance.',geodesic_distance_unavailable:'Distance information is unavailable.',candidate_conflict_status:'Review the scheduling checks for this team.',schedule_incomplete:'Enter both the start and end of the appointment.'};
    var code=typeof entry==='string'?entry:entry&&entry.code;
    if(explanations[code])return explanations[code];
    if(entry&&entry.candidate&&entry.candidate.label)return value(entry.candidate.label,'Team name unavailable')+': '+(entry.eligibility==='ineligible'?'Scheduling conflict; cannot be selected.':entry.eligibility==='eligible'?'Review this scheduling suggestion.':'More scheduling information needs review.');
    return 'Additional scheduling information needs review. Refresh the schedule for details.';
  }

  function targetLabel(target, directory, discoveredTargets) {
    if (!target || target.kind === 'unassigned') return 'Unassigned';
    var entries = (directory && Array.isArray(directory.targets) ? directory.targets : [])
      .concat(Array.isArray(discoveredTargets) ? discoveredTargets : []);
    var match = entries.find(function (entry) {
      return entry.kind === target.kind && entry.id === target.id;
    });
    return match
      ? displayProjection().text(match.label, target.kind === 'profile' ? 'Employee name unavailable' : 'Crew name unavailable')
      : 'Selected team name unavailable';
  }

  function zoneLabel(zone){try{return new Intl.DateTimeFormat(undefined,{timeZone:zone,timeZoneName:'longGeneric'}).formatToParts(new Date()).find(function(p){return p.type==='timeZoneName';}).value;}catch(_){return 'Business time zone';}}

  function formatInstant(instant, timeZone) {
    if (!instant) return 'Unscheduled';
    try {
      return new Date(instant).toLocaleString([], {
        timeZone: timeZone, dateStyle: 'medium', timeStyle: 'short',
      }) + ' (' + zoneLabel(timeZone) + ')';
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
    var messages = {
      400: 'Check the appointment times, reason and required acknowledgements.',
      401: 'Your session ended. Sign in again or reopen the demo before continuing.',
      403: 'Your current account cannot make this scheduling change.',
      409: 'The schedule changed. Refresh and review a new preview.',
      410: 'This preview expired. Request a new preview before approving.',
      422: 'The proposed change has a scheduling conflict. Review the appointment before continuing.',
      428: 'Refresh the appointment and review a new preview before confirming.',
      429: 'The scheduling action limit was reached. Saved times remain available.',
    };
    var message = messages[response.status] || (response.status >= 500 ? 'The result could not be confirmed. Refresh to check saved times before trying again.' : 'The scheduling request could not be completed. Refresh and review the appointment.');
    var error = new Error(message);
    error.status = response.status;
    error.code = code;
    return error;
  }

  function jsonRequest(url, options) {
    if (!global.NorthStarAccountSession || typeof global.NorthStarAccountSession.fetch !== 'function') {
      return Promise.reject(new Error('Your session could not be checked. Reopen this page.'));
    }
    return global.NorthStarAccountSession.fetch(url, options).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (body) {
        if (!response.ok || !body || body.success !== true) throw responseFailure(response, body);
        return body;
      });
    }).catch(function (error) {
      if (error && (error.status || /unavailable|authority|expired|changed|rejected/i.test(error.message))) throw error;
      throw new Error('The connection was interrupted. Check the saved times before starting a different change; retrying this attempt keeps the same request.');
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
    if (!contract) throw new Error('The scheduling time zone is unavailable. Refresh before choosing times.');
    if(!active.startDate.value||!active.startTime.value||(!active.preserveElapsedDuration&&(!active.endDate.value||!active.endTime.value)))throw new Error('Enter both the start and end date and time.');
    var start = contract.resolveWallTime(active.startDate.value, active.startTime.value, active.timeZone);
    var end = active.preserveElapsedDuration ? null
      : contract.resolveWallTime(active.endDate.value, active.endTime.value, active.timeZone);
    if (start.status === 'gap' || end && end.status === 'gap') {
      throw new Error('The clocks skip that time for daylight saving. Choose another local time.');
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
    if (!selectedStart || !selectedEnd) throw new Error('That time occurs twice when the clocks change. Choose its first or second occurrence.');
    if (selectedEnd.epochMilliseconds <= selectedStart.epochMilliseconds) throw new Error('Schedule end must be after schedule start.');
    return {
      start: selectedStart.rfc3339 || selectedStart.raw,
      end: selectedEnd.rfc3339 || selectedEnd.raw,
    };
  }

  function proposedTarget() {
    if (active.action === 'unassign') return { kind: 'unassigned', id: null };
    if (!['assign', 'reassign'].includes(active.action)) return targetForAuthority(active.current);
    if (active.targetLookupBusy) throw new Error('Wait for the team search to finish.');
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
    summary.appendChild(el('h3', '', 'Review the proposed change'));
    var terms = el('dl');
    appendTerm(terms, 'Action', ACTION_LABELS[preview.action] || preview.action);
    appendTerm(terms, 'Appointment', active.title);
    appendTerm(terms, 'Target', targetLabel(preview.proposal.target, active.directory, active.targetPageTargets));
    appendTerm(terms, 'Schedule', preview.proposal.scheduledStart === null && preview.proposal.scheduledEnd === null ? 'Not yet scheduled' : formatInstant(preview.proposal.scheduledStart, active.timeZone) + ' to ' + formatInstant(preview.proposal.scheduledEnd, active.timeZone));
    appendTerm(terms, 'Time zone', zoneLabel(active.timeZone));
    appendTerm(terms, 'Preview expires', formatInstant(preview.expiresAt, active.timeZone));
    appendTerm(terms, 'Reason', displayProjection().text(active.reason.value.trim(), 'Approval reason unavailable'));
    summary.appendChild(terms);
    active.review.appendChild(summary);

    if (active.current.dispatchState === 'dispatched' && ['reassign', 'unassign', 'reschedule'].includes(active.action)) {
      active.review.appendChild(el('p', 'm22-dispatch-warning', 'Approval revokes the current dispatch. A new human dispatch approval will be required.'));
    }
    var conflicts = preview.conflicts || {};
    active.review.appendChild(evidenceSection('Issues that prevent this change', conflicts.hardConflicts || [],
      conflicts.hardConflicts && conflicts.hardConflicts.length ? 'm22-hard-block' : ''));
    active.review.appendChild(evidenceSection('Warnings', conflicts.warnings || []));
    active.review.appendChild(evidenceSection('Needs review', conflicts.reviewReasons || []));
    var recommendation = preview.recommendation || {};
    active.review.appendChild(evidenceSection('Team and travel suggestions',
      (recommendation.candidates || recommendation.alternatives || []).concat(recommendation.reviewReasons || recommendation.uncertainty || [])));

    var acknowledgements = el('section');
    acknowledgements.appendChild(el('h3', '', 'Confirm you reviewed these items'));
    var list = el('ul', 'm22-ack-list');
    var all = [];
    (preview.warningDigests || []).forEach(function (digest, index) {
      all.push({ digest: digest, label: 'Acknowledge warning ' + (index + 1) + ': ' + textForEvidence((conflicts.warnings || [])[index]) });
    });
    (preview.reviewReasonDigests || []).forEach(function (digest, index) {
      all.push({ digest: digest, label: 'I reviewed: ' + textForEvidence((conflicts.reviewReasons || [])[index]) });
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
    var requestOwner=active,headers={Accept:'application/json','Content-Type':'application/json'};
    if(active.directory.simulated){
      if(!global.crypto||typeof global.crypto.randomUUID!=='function'){setStatus('This browser could not prepare the preview. Reload before continuing.','error',true);return;}
      var fingerprint=JSON.stringify(payload);
      if(!active.previewAttempt||active.previewAttempt.fingerprint!==fingerprint)active.previewAttempt={fingerprint:fingerprint,key:crypto.randomUUID(),workspaceRevision:active.demoWorkspaceRevision};
      headers['Idempotency-Key']=active.previewAttempt.key;headers['X-NorthStar-Demo-Revision']=String(active.previewAttempt.workspaceRevision);
    }
    active.previewButton.disabled = true;
    setStatus('Checking the proposed change. This does not save the appointment yet.', 'pending', false);
    jsonRequest('/api/v1/canonical/appointments/' + encodeURIComponent(active.appointmentId) + '/mutation-previews', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: headers,
      body: JSON.stringify(payload),
    }).then(function (body) {
      if (active!==requestOwner) return;
      if(active.directory.simulated)active.demoWorkspaceRevision=body.data.demoWorkspaceRevision;
      renderAcknowledgements(body.data);
      setStatus('Review each item before confirming this change.', 'ready', false);
      var firstAcknowledgment=active.review.querySelector('input[type="checkbox"]');
      if(firstAcknowledgment)firstAcknowledgment.focus();else if(!active.approve.disabled)active.approve.focus();else active.status.focus();
    }).catch(function (error) {
      if (active!==requestOwner) return;
      setStatus(error.message, 'error', true);
    }).finally(function () { if (active===requestOwner) active.previewButton.disabled = false; });
  }

  function appliedAuthority(body) {
    var data = body && body.data;
    var current = data && data.scheduleAuthority;
    if (!current || !Number.isSafeInteger(current.revision) || !/^[0-9a-f]{64}$/.test(current.digest || '')) {
      throw new Error('The saved schedule could not be confirmed. Reload before making another change.');
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
    setStatus('The change was saved, but updated details could not load. Do not confirm it again. Retry the refresh or reload this page.', 'applied-refresh-failed', true);
    active.retry.focus();
  }

  function refreshApplied() {
    if (!active || !active.applied) return Promise.resolve(false);
    var callback = active.onApplied;
    active.retry.disabled = true;
    setStatus('The change was saved. Loading the updated appointment…', 'pending', false);
    return Promise.resolve(callback && callback(active.applied)).then(function (result) {
      if (!active) return false;
      if (!verifiedRefresh(result, active.applied)) {
        throw new Error('The updated appointment could not be confirmed.');
      }
      setStatus('The updated appointment is ready.', 'success', false);
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
      setStatus('This browser could not prepare a safe save. Reload before continuing.', 'error', true);
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
    var requestOwner=active,headers={Accept:'application/json','Content-Type':'application/json','Idempotency-Key':active.idempotencyKey};
    if(active.directory.simulated)headers['X-NorthStar-Demo-Revision']=String(active.preview.demoWorkspaceRevision);
    setStatus('Checking the latest appointment and saving your confirmed change…', 'pending', false);
    jsonRequest('/api/v1/canonical/appointments/' + encodeURIComponent(active.appointmentId) + '/mutation-approvals', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: headers,
      body: JSON.stringify(payload),
    }).then(function (body) {
      if (active!==requestOwner) return;
      active.applied = appliedAuthority(body);
      active.cancel.hidden = true;
      active.closeButton.hidden = true;
      active.back.hidden = true;
      return refreshApplied();
    }).catch(function (error) {
      if (active!==requestOwner) return;
      if (active.applied) { showRefreshFailure(error); return; }
      if ([409, 410, 428].includes(error.status)) {
        back();
        setStatus(error.message, 'error', true);
        return;
      }
      setStatus(error.message, 'error', true);
      active.approve.disabled = false;
    });
  }

  function back() {
    if (!active) return;
    active.preview = null;
    active.previewAttempt = null;
    active.idempotencyKey = null;
    active.review.replaceChildren();
    active.approve.disabled = true;
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
      if (active.applied) { setStatus('This change was saved. Refresh to see the updated appointment.', 'applied-refresh-failed', true); return; }
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
    startTime.value = proposal.time || existingStart && existingStart.time || '';
    endDate.value = proposal.endDate || existingEnd && existingEnd.date || startDate.value;
    endTime.value = proposal.endTime || existingEnd && existingEnd.time || '';
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
    var select = document.createElement('select'); select.required = true; select.setAttribute('aria-label',label.textContent);
    function replaceOptions(targets, emptyLabel) {
      var previous = select.value;
      select.replaceChildren();
      var placeholder = el('option', '', emptyLabel || 'Choose a worker or crew'); placeholder.value = ''; select.appendChild(placeholder);
      (targets || []).filter(function (entry) { return entry.kind !== 'unassigned'; }).forEach(function (entry) {
        var kind = entry.kind === 'profile' ? 'worker' : 'crew';
        var option = el('option', '', displayProjection().text(entry.label,
          entry.kind === 'profile' ? 'Employee name unavailable' : 'Crew name unavailable') + ' — ' + kind);
        option.value = entry.kind + ':' + entry.id;
        select.appendChild(option);
      });
      if (Array.from(select.options).some(function (entry) { return entry.value === previous; })) select.value = previous;
    }
    replaceOptions(directory.targets || []);
    label.appendChild(select); wrapper.appendChild(label); form.appendChild(wrapper); active.target = select;
    active.targetPageTargets = [];
    active.targetLookupBusy = false;

    var discovery = directory.discovery;
    if (!discovery || discovery.version !== TARGET_DIRECTORY_VERSION ||
        discovery.endpoint !== TARGET_DIRECTORY_ENDPOINT || !Number.isSafeInteger(discovery.pageSize) ||
        discovery.pageSize < 1 || discovery.pageSize > 100) {
      if (directory.truncated === true) {
        select.disabled = true;
        active.previewButton.disabled = true;
        setStatus('Some workers or crews could not be loaded. Refresh before continuing.', 'error', true);
      }
      return;
    }

    var lookup = el('section', 'm22-target-lookup');
    lookup.setAttribute('aria-label', 'Search workers and crews');
    var guidance = el('p', 'm22-target-lookup-guidance');
    guidance.textContent = discovery.truncated
      ? 'The initial selector is incomplete: showing ' + discovery.shown + ' of ' + discovery.total +
        ' workers and crews. Search or view the next page.'
      : 'All ' + discovery.total + ' workers and crews are shown. You can also search by name.';
    var searchLabel = el('label', '', 'Search active workers and crews');
    var search = document.createElement('input'); search.type = 'search'; search.maxLength = 100;
    search.setAttribute('autocomplete', 'off'); search.setAttribute('spellcheck', 'false');
    searchLabel.appendChild(search);
    var controls = el('div', 'm22-record-actions');
    var searchButton = el('button', 'm22-action-button', 'Search team'); searchButton.type = 'button';
    var nextButton = el('button', 'm22-action-button', 'Next page'); nextButton.type = 'button'; nextButton.hidden = true;
    var lookupStatus = el('p', 'm22-target-lookup-status', discovery.truncated
      ? 'More workers and crews are available on the next pages.'
      : 'All workers and crews are listed.');
    lookupStatus.setAttribute('role', 'status'); lookupStatus.setAttribute('aria-live', 'polite'); lookupStatus.tabIndex = -1;
    controls.append(searchButton, nextButton); lookup.append(guidance, searchLabel, controls, lookupStatus); form.appendChild(lookup);

    function setLookupStatus(message, state, focus) {
      lookupStatus.textContent = message;
      lookupStatus.dataset.state = state || 'ready';
      if (focus) lookupStatus.focus({ preventScroll: true });
    }
    function validTargetPage(page) {
      return page && page.version === TARGET_DIRECTORY_VERSION && page.canRead === true &&
        typeof page.query === 'string' && Array.isArray(page.targets) && page.targets.length <= discovery.pageSize &&
        page.page && Number.isSafeInteger(page.page.shown) && page.page.shown === page.targets.length &&
        Number.isSafeInteger(page.page.total) && page.page.total >= page.page.shown &&
        typeof page.page.datasetDigest === 'string' && /^[0-9a-f]{64}$/.test(page.page.datasetDigest) &&
        (page.page.nextCursor === null || typeof page.page.nextCursor === 'string') &&
        typeof page.digest === 'string' && /^[0-9a-f]{64}$/.test(page.digest) &&
        page.targets.every(function (entry) {
          return entry && ['profile', 'crew'].includes(entry.kind) &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry.id || '') &&
            typeof entry.label === 'string' && entry.label.length > 0;
        });
    }
    function loadTargetPage(cursor) {
      if (active.targetLookupBusy) return Promise.resolve(false);
      var query = search.value.normalize('NFC').trim();
      if (query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) {
        setLookupStatus('Use a name of 100 characters or fewer for your search.', 'error', true);
        return Promise.resolve(false);
      }
      var endpoint = TARGET_DIRECTORY_ENDPOINT + '?query=' + encodeURIComponent(query);
      if (cursor) endpoint += '&cursor=' + encodeURIComponent(cursor);
      var requestOwner = active;
      active.targetLookupBusy = true;
      search.disabled = true; select.disabled = true; searchButton.disabled = true; nextButton.disabled = true;
      setLookupStatus('Loading workers and crews…', 'pending', false);
      return jsonRequest(endpoint, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
      }).then(function (body) {
        if (active !== requestOwner) return false;
        if (!validTargetPage(body.data)) throw new Error('The team list could not be loaded. Refresh before continuing.');
        var page = body.data;
        active.targetPageTargets = page.targets.slice();
        replaceOptions(page.targets, page.targets.length ? 'Choose a worker or crew' : 'No workers or crews match this search');
        nextButton.dataset.cursor = page.page.nextCursor || '';
        nextButton.hidden = !page.page.nextCursor;
        var queryDescription = page.query ? ' matching “' + page.query + '”' : '';
        var boundedDescription = page.page.nextCursor
          ? '. Choose Next page to see more results.'
          : '. This is the last page. Search again to return to earlier results.';
        setLookupStatus(page.targets.length
          ? 'Showing ' + page.page.shown + ' of ' + page.page.total + ' workers and crews' + queryDescription +
            (page.page.truncated ? boundedDescription : '. This result is complete.')
          : 'No active workers or crews match your search.', page.targets.length ? 'ready' : 'empty', false);
        if (page.targets.length) select.focus({ preventScroll: true }); else search.focus({ preventScroll: true });
        return true;
      }).catch(function (error) {
        if (active !== requestOwner) return false;
        nextButton.hidden = true;
        nextButton.dataset.cursor = '';
        if (error && error.code === 'M22_OPERATOR_TARGET_DIRECTORY_STALE') {
          active.targetPageTargets = [];
          replaceOptions([], 'Team changed; search again');
          setLookupStatus('The team changed while you were searching. Search again before continuing.', 'error', true);
          return false;
        }
        setLookupStatus((error && error.message ? error.message : 'Team search failed.') +
          ' Search again to check the full team list.', 'error', true);
        return false;
      }).finally(function () {
        if (active !== requestOwner) return;
        active.targetLookupBusy = false;
        search.disabled = false; select.disabled = false; searchButton.disabled = false; nextButton.disabled = false;
      });
    }
    search.addEventListener('input', function () {
      nextButton.hidden = true;
      nextButton.dataset.cursor = '';
      setLookupStatus('Search text changed. Select Search team to update the results.', 'ready', false);
    });
    searchButton.addEventListener('click', function () { loadTargetPage(null); });
    nextButton.addEventListener('click', function () {
      var cursor = nextButton.dataset.cursor;
      if (cursor) loadTargetPage(cursor);
    });
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
      throw new Error('Scheduling changes are unavailable. Refresh before continuing.');
    }
    var allowed = Array.isArray(record.allowedActions) ? record.allowedActions : options.allowedActions;
    if (Array.isArray(allowed) && !allowed.includes(action)) throw new Error('That action is not available for the current appointment state.');
    var timeZone = options.timeZone || current.timeZone || record.timeZone;
    if (!global.NorthStarSchedulingTime || !global.NorthStarSchedulingTime.isValidTimeZone(timeZone)) {
      throw new Error('The business time zone is unavailable. Review business settings before scheduling.');
    }

    var layer = el('div', 'm22-dialog-layer');
    var dialog = el('section', 'm22-dialog'); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'm22DialogTitle');
    var header = el('header', 'm22-dialog-header');
    var title = el('h2', '', ACTION_LABELS[action] + ' appointment'); title.id = 'm22DialogTitle';
    var closeButton = el('button', 'm22-dialog-close', '×'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Cancel scheduling action'); closeButton.addEventListener('click', close);
    header.append(title, closeButton);
    var body = el('div', 'm22-dialog-body');
    var currentSummary = el('section', 'm22-dialog-summary'); currentSummary.appendChild(el('h3', '', 'Current scheduling record'));
    var terms = el('dl');
    var appointmentTitle = value(record.work && record.work.title || record.title, 'Job title unavailable');
    appendTerm(terms, 'Appointment', appointmentTitle);
    appendTerm(terms, 'Customer', value(record.customer && record.customer.name, 'Customer name unavailable'));
    appendTerm(terms, 'Target', targetLabel(targetForAuthority(current), directory));
    appendTerm(terms, 'Schedule', current.scheduledStart === null && current.scheduledEnd === null ? 'Not yet scheduled' : formatInstant(current.scheduledStart, timeZone) + ' to ' + formatInstant(current.scheduledEnd, timeZone));
    appendTerm(terms, 'Review', current.needsReview ? 'More scheduling information needs review.' : 'Review the recorded appointment before changing it.');
    currentSummary.appendChild(terms); body.appendChild(currentSummary);
    if(directory.simulated)body.appendChild(el('p','',directory.workforceAvailable?'Simulated team and availability only. No real worker is assigned or customer contacted. Review the proposed change before confirming.':'This older demo has no saved team details. Time changes remain available. Reset starts a new demo and clears its current changes.'));
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
    var previewButton = el('button', '', 'Preview change'); previewButton.type = 'button'; previewButton.dataset.kind = 'approve'; previewButton.addEventListener('click', requestPreview);
    var approveButton = el('button', '', 'Confirm change'); approveButton.type = 'button'; approveButton.dataset.kind = 'approve'; approveButton.hidden = true; approveButton.addEventListener('click', approve);
    var retryButton = el('button', '', 'Refresh saved appointment'); retryButton.type = 'button'; retryButton.hidden = true; retryButton.addEventListener('click', refreshApplied);
    var reloadButton = el('button', '', 'Reload page'); reloadButton.type = 'button'; reloadButton.hidden = true; reloadButton.addEventListener('click', function () { global.location.reload(); });
    footerActions.append(backButton, previewButton, approveButton, retryButton, reloadButton); footer.append(cancel, footerActions);
    var status = el('p', 'm22-dialog-status', 'Review the current state and prepare a proposal.'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.tabIndex = -1;
    body.appendChild(status); dialog.append(header, body, footer); layer.appendChild(dialog); document.body.appendChild(layer);
    active = {
      layer: layer, dialog: dialog, form: form, review: review, status: status,
      back: backButton, previewButton: previewButton, approve: approveButton,
      retry: retryButton, reload: reloadButton, cancel: cancel, closeButton: closeButton,
      record: record, current: current, directory: directory, action: action,
      demoWorkspaceRevision:record.demoWorkspaceRevision||directory.demoWorkspaceRevision,previewAttempt:null,
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
    reason.value = typeof options.reason === 'string' ? options.reason : '';
    reasonLabel.appendChild(reason); reasonWrapper.appendChild(reasonLabel); form.appendChild(reasonWrapper); active.reason = reason;
    document.addEventListener('keydown', trap);
    reason.focus();
    return true;
  }

  global.NorthStarSchedulingApproval = Object.freeze({ open: open, close: close });
})(window);
