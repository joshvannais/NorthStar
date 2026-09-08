(function(root) {
  'use strict';

  var api = root.NorthStarFieldExecutionClient;
  var WORK_CAPABILITY_VERSION = 'm23-part9a-worker-actions-v1';
  var WORK_ACTIONS = ['initialize', 'start', 'pause', 'resume', 'start_timer', 'stop_timer', 'record_manual',
    'record_material', 'record_equipment', 'create_checklist', 'respond_item', 'record_observation',
    'record_note', 'record_progress', 'record_blocker', 'record_exception', 'record_change',
    'propose_completion', 'withdraw_completion'];
  var MATERIAL_KINDS = ['consumed', 'returned', 'transferred', 'waste', 'adjustment'];
  var EQUIPMENT_KINDS = ['check_out', 'use', 'check_in', 'reading', 'condition', 'fault',
    'downtime_start', 'downtime_end', 'maintenance', 'meter_reset'];
  var DRAFT_PREFIX = 'northstar-work-draft:';
  var selector;
  var loadController = null;
  var pending = false;
  var confirmation = null;
  var volatileIdempotency = Object.create(null);
  var tabStorage = null;
  var tabReady = false;
  var tabClaimGeneration = 0;
  var model = {
    today: null,
    record: null,
    execution: null,
    reads: {},
    partial: [],
    retryMutation: null,
  };

  var STATE_COPY = Object.freeze({
    loading: ['Loading current work', 'NorthStar is checking the current assignment and execution.'],
    empty: ['Work has not been opened yet', 'Create the server-owned work record before recording field activity.'],
    offline: ['You appear to be offline', 'Reconnect, then reload. NorthStar has not confirmed or recorded any new work.'],
    restricted: ['Work access changed', 'This appointment is not in your current direct or crew assignment scope.'],
    'read-only': ['Work is read-only', 'This execution can be reviewed, but its current lifecycle does not permit worker changes.'],
    stale: ['Work authority changed', 'Reload before recording anything. Browser state is not accepted as current authority.'],
    conflict: ['Work changed before your action', 'Reload the current server record, review it, and try again if the action is still appropriate.'],
    'partial-file': ['Some evidence is unavailable', 'Current work loaded, but one bounded evidence source is unavailable. No missing evidence is treated as success.'],
    retry: ['NorthStar could not confirm the action', 'Retry sends the same request and idempotency key. No success is claimed until the server confirms it.'],
    'applied-but-refresh-failed': ['Recorded; current view not confirmed', 'The server acknowledged the action, but the refreshed record could not be loaded. Reload before doing anything else.'],
    success: ['Work updated', 'The server confirmed the action and the current record was refreshed.'],
  });

  function byId(id) { return document.getElementById(id); }
  function node(tag, className, value) {
    var result = document.createElement(tag);
    if (className) result.className = className;
    if (value !== undefined && value !== null) result.textContent = String(value);
    return result;
  }
  function append(parent) {
    for (var index = 1; index < arguments.length; index += 1) {
      if (arguments[index]) parent.appendChild(arguments[index]);
    }
    return parent;
  }
  function clean(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }
  function label(value, fallback) {
    var text = clean(value, fallback || 'Unavailable').replace(/[_-]+/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  function locationText(value) {
    if (root.NorthStarDisplayProjection && typeof root.NorthStarDisplayProjection.location === 'function') {
      return root.NorthStarDisplayProjection.location(value, 'Service location unavailable');
    }
    return 'Service location unavailable';
  }
  function formatInstant(value) {
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Time unavailable';
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: model.today && model.today.businessProfile.timeZone,
        dateStyle: 'medium', timeStyle: 'short',
      }).format(date);
    } catch (_error) { return 'Time unavailable'; }
  }
  function safeArray(value) { return Array.isArray(value) ? value : []; }
  function setState(name, title, copy, retryVisible) {
    var fallback = STATE_COPY[name] || STATE_COPY.retry;
    var contentVisible = ['ready', 'success', 'partial-file', 'empty', 'read-only'].includes(name);
    document.body.dataset.workState = name;
    byId('workStateTitle').textContent = title || fallback[0];
    byId('workStateCopy').textContent = copy || fallback[1];
    byId('workStatus').textContent = copy || fallback[1];
    byId('workStatePanel').hidden = contentVisible;
    byId('workSections').hidden = !contentVisible;
    byId('workReload').hidden = byId('workStatePanel').hidden || retryVisible === false;
    byId('workReload').textContent = model.retryMutation ? 'Retry same request' : 'Reload current work';
    byId('workStateBadge').dataset.state = name;
    if (!model.execution && !['ready', 'empty'].includes(name)) byId('workStateBadge').textContent = label(name);
  }

  function validateToday(value) {
    if (!value || value.version !== 'm22-part6-today-v1' || value.readOnly !== true ||
        !Array.isArray(value.mutationCapabilities) || value.mutationCapabilities.length !== 0 ||
        !value.identity || !value.businessProfile || !api.uuid(value.identity.profileId) ||
        !api.uuid(value.businessProfile.id) || !api.revision(value.businessProfile.version) ||
        !api.digest(value.businessProfile.hash) || typeof value.businessProfile.timeZone !== 'string' ||
        !api.digest(value.scopeDigest) || !Array.isArray(value.records)) {
      throw new Error('WORK_TODAY_INVALID');
    }
    return value;
  }

  function validateRecord(value) {
    if (!value || api.uuid(value.appointmentId) !== selector.appointmentId || !value.authority ||
        !api.revision(value.authority.revision) || !api.digest(value.authority.digest) ||
        value.authority.approvedCurrent !== true) throw new Error('WORK_ASSIGNMENT_INVALID');
    var capabilities = value.workCapabilities;
    if (!capabilities || capabilities.version !== WORK_CAPABILITY_VERSION || typeof capabilities.mutable !== 'boolean' ||
        !validList(capabilities.actions, WORK_ACTIONS) || !validList(capabilities.materialMovementKinds, MATERIAL_KINDS) ||
        !validList(capabilities.equipmentKinds, EQUIPMENT_KINDS) ||
        (!capabilities.mutable && (capabilities.actions.length || capabilities.materialMovementKinds.length || capabilities.equipmentKinds.length)) ||
        (!capabilities.actions.includes('record_material') && capabilities.materialMovementKinds.length) ||
        (!capabilities.actions.includes('record_equipment') && capabilities.equipmentKinds.length)) {
      throw new Error('WORK_CAPABILITIES_INVALID');
    }
    if (value.execution) {
      api.uuid(value.execution.id);
      api.revision(value.execution.revision);
      api.digest(value.execution.digest);
      api.revision(value.execution.sourceAssignmentRevision);
      api.digest(value.execution.sourceAssignmentDigest);
      api.pins(value.execution, value);
      if (capabilities.actions.includes('initialize')) throw new Error('WORK_CAPABILITIES_INVALID');
    } else if (capabilities.actions.some(function(action) { return action !== 'initialize'; })) {
      throw new Error('WORK_CAPABILITIES_INVALID');
    }
    return value;
  }

  function validList(value, allowed) {
    return Array.isArray(value) && value.every(function(item) { return typeof item === 'string' && allowed.includes(item); }) &&
      new Set(value).size === value.length;
  }

  function allows(action) {
    return Boolean(model.record && model.record.workCapabilities && model.record.workCapabilities.actions.includes(action));
  }

  function validateExecution(value) {
    var pointer = model.record && model.record.execution;
    if (!value || !pointer || api.uuid(value.id) !== pointer.id ||
        api.uuid(value.appointmentId) !== selector.appointmentId ||
        !api.revision(value.revision) || !api.digest(value.digest) ||
        !api.revision(value.sourceAssignmentRevision) || !api.digest(value.sourceAssignmentDigest)) {
      throw new Error('WORK_EXECUTION_INVALID');
    }
    api.pins(value, model.record);
    if (value.lifecycleState !== pointer.lifecycleState ||
        value.revision !== pointer.revision || value.digest !== pointer.digest ||
        value.sourceAssignmentRevision !== pointer.sourceAssignmentRevision ||
        value.sourceAssignmentDigest !== pointer.sourceAssignmentDigest) {
      var stale = new Error('WORK_AUTHORITY_STALE');
      stale.code = 'WORK_AUTHORITY_STALE';
      throw stale;
    }
    return value;
  }

  async function responseJson(path, options, signal) {
    var response = await fetch(path, Object.assign({
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: signal,
    }, options || {}));
    var payload = await response.json().catch(function() { return null; });
    if (!response.ok || !payload || payload.success !== true) {
      var error = new Error(payload && payload.error && payload.error.message || 'NorthStar could not confirm this request.');
      error.status = response.status;
      error.code = payload && payload.error && payload.error.code || 'WORK_REQUEST_UNAVAILABLE';
      error.retryAfter = response.headers.get('Retry-After');
      throw error;
    }
    return payload;
  }

  function summary(labelText, value) {
    var item = node('div', 'work-summary');
    append(item, node('p', 'work-summary-label', labelText), node('p', 'work-summary-value', value));
    return item;
  }
  function emptyNote(value) { return node('p', 'work-empty-note', value); }
  function unavailableNote(value) { return node('p', 'work-unavailable-note', value); }
  function actionButton(labelText, id, handler, style) {
    var button = node('button', style || 'btn btn-secondary', labelText);
    button.type = 'button';
    if (id) button.id = id;
    button.disabled = pending;
    button.addEventListener('click', handler);
    return button;
  }
  function field(form, specification) {
    var wrapper = node('div', 'work-field' + (specification.wide ? ' work-field-wide' : ''));
    var id = form.id + '-' + specification.name;
    var labelNode = node('label', '', specification.label);
    labelNode.htmlFor = id;
    var control;
    if (specification.type === 'select') {
      control = document.createElement('select');
      safeArray(specification.options).forEach(function(option) {
        var item = node('option', '', option.label);
        item.value = option.value;
        control.appendChild(item);
      });
    } else if (specification.type === 'textarea') {
      control = document.createElement('textarea');
      control.rows = specification.rows || 3;
    } else {
      control = document.createElement('input');
      control.type = specification.type || 'text';
    }
    control.id = id;
    control.name = specification.name;
    control.required = specification.required !== false;
    if (specification.maxLength) control.maxLength = specification.maxLength;
    if (specification.min) control.min = specification.min;
    if (specification.step) control.step = specification.step;
    if (specification.value !== undefined) {
      control.value = specification.value;
      if ('defaultValue' in control) control.defaultValue = specification.value;
    }
    append(wrapper, labelNode, control);
    if (specification.help) wrapper.appendChild(node('p', '', specification.help));
    form.appendChild(wrapper);
    return control;
  }
  function makeForm(id, fields, submitLabel, builder, actionName) {
    var form = node('form', 'work-form');
    form.id = id;
    fields.forEach(function(specification) { field(form, specification); });
    restoreDraft(form, actionName);
    form.addEventListener('input', function() { saveDraft(form, actionName); });
    var actions = node('div', 'work-form-actions');
    var submit = node('button', 'btn btn-primary', submitLabel);
    submit.type = 'submit';
    var discard = node('button', 'btn btn-secondary', 'Discard draft');
    discard.type = 'button';
    discard.addEventListener('click', function() {
      clearDraft(actionName);
      form.reset();
      form.querySelectorAll('select').forEach(function(control) {
        control.dispatchEvent(new Event('change', { bubbles: true }));
      });
      byId('workStatus').textContent = 'Unsaved device-local draft removed. No server record changed.';
      var first = form.querySelector('input,select,textarea');
      if (first) first.focus();
    });
    append(actions, submit, discard);
    form.appendChild(actions);
    setFormHidden(form, true);
    form.addEventListener('submit', async function(event) {
      event.preventDefault();
      if (!form.reportValidity() || pending) return;
      if (actionName === 'propose_completion' && !await refreshCompletionSelection()) return;
      confirmAction({
        action: actionName,
        label: submitLabel,
        copy: actionName === 'propose_completion' ? completionSelectionCopy() :
          'Review this field evidence, then confirm it should be recorded against the current execution.',
        body: builder(new FormData(form)),
        path: mutationPath(actionName),
        form: form,
        evidenceSignature: actionName === 'propose_completion' ? completionSignature() : null,
      }, submit);
    });
    return form;
  }

  function draftAuthorityPrefix() {
    var authority = model.record.authority;
    var execution = model.execution;
    var executionScope = execution
      ? [execution.id, execution.revision, execution.digest].join(':')
      : 'uninitialized';
    return DRAFT_PREFIX + [tabStorage.owner, model.today.scopeDigest, selector.appointmentId,
      authority.revision, authority.digest, executionScope].join(':') + ':';
  }
  function draftKey(action) {
    return draftAuthorityPrefix() + action;
  }
  function pruneDrafts(removeAll) {
    var keep = removeAll ? '' : draftAuthorityPrefix();
    try {
      for (var index = root.sessionStorage.length - 1; index >= 0; index -= 1) {
        var key = root.sessionStorage.key(index);
        if (key && key.indexOf(DRAFT_PREFIX) === 0 && (!keep || key.indexOf(keep) !== 0)) {
          root.sessionStorage.removeItem(key);
        }
      }
    } catch (_error) {}
    Object.keys(volatileIdempotency).forEach(function(key) {
      if (!keep || key.indexOf(keep) !== 0) delete volatileIdempotency[key];
    });
  }

  function clearRestrictedPresentation() {
    model.today = null;
    model.record = null;
    model.execution = null;
    model.reads = {};
    model.partial = [];
    model.retryMutation = null;
    byId('workTitle').textContent = 'Work detail unavailable';
    byId('workCustomer').textContent = 'Return to Today to select current assigned work.';
    byId('workAuthority').textContent = 'Assigned work only';
    byId('workAuthority').setAttribute('aria-label', 'Assigned work only');
    var overview = byId('workOverview').querySelector('.work-overview-grid');
    if (overview) overview.remove();
    ['workLifecycleContent','workLaborContent','workMaterialsContent','workEquipmentContent',
      'workEvidenceContent','workProgressContent','workCompletionContent']
      .forEach(function(id) { byId(id).replaceChildren(); });
  }
  function saveDraft(form, action) {
    if (!tabReady || !tabStorage || !tabStorage.persistent) return;
    try {
      var fields = {};
      new FormData(form).forEach(function(value, key) {
        if (typeof value === 'string' && value.length <= 4000) fields[key] = value;
      });
      root.sessionStorage.setItem(draftKey(action), JSON.stringify({ version: 1, fields: fields }));
    } catch (_error) {}
  }
  function restoreDraft(form, action) {
    if (!tabStorage || !tabStorage.persistent) return;
    try {
      var saved = JSON.parse(root.sessionStorage.getItem(draftKey(action)) || 'null');
      if (!saved || saved.version !== 1 || !saved.fields || typeof saved.fields !== 'object') return;
      Object.keys(saved.fields).forEach(function(name) {
        var control = form.elements.namedItem(name);
        if (control && typeof saved.fields[name] === 'string') control.value = saved.fields[name];
      });
    } catch (_error) {}
  }
  function clearDraft(action) {
    try { root.sessionStorage.removeItem(draftKey(action)); } catch (_error) {}
  }
  function idempotencyStorageKey(action) { return draftKey(action) + ':idempotency'; }
  function idempotencyFor(action) {
    var storageKey = idempotencyStorageKey(action);
    var key = '';
    try { if (tabStorage.persistent) key = root.sessionStorage.getItem(storageKey) || ''; } catch (_error) {}
    if (!key) key = volatileIdempotency[storageKey] || '';
    if (key.indexOf('m23-part9a-' + action + '-') !== 0) {
      var seed = root.crypto && typeof root.crypto.randomUUID === 'function' ? root.crypto.randomUUID() : '';
      key = api.idempotencyKey(action, seed);
      try { if (tabStorage.persistent) root.sessionStorage.setItem(storageKey, key); } catch (_error) {}
    }
    volatileIdempotency[storageKey] = key;
    return key;
  }
  function clearIdempotency(action) {
    var storageKey = idempotencyStorageKey(action);
    try { root.sessionStorage.removeItem(storageKey); } catch (_error) {}
    delete volatileIdempotency[storageKey];
  }

  function executionPins() { return api.pins(model.execution, model.record); }
  function commonBody(action, reason) {
    return Object.assign({ action: action, performerProfileId: model.today.identity.profileId }, executionPins(), { reason: reason });
  }
  function zoneAuthority() {
    return {
      businessProfileId: model.today.businessProfile.id,
      version: model.today.businessProfile.version,
      hash: model.today.businessProfile.hash,
      timeZone: model.today.businessProfile.timeZone,
    };
  }
  function mutationPath(action) {
    var paths = api.paths({ appointmentId: selector.appointmentId, executionId: model.execution && model.execution.id });
    if (['start_timer', 'stop_timer', 'record_manual'].includes(action)) return paths.laborActions;
    if (action === 'record_material') return paths.materialActions;
    if (action === 'record_equipment') return paths.equipmentActions;
    if (['create_checklist', 'respond_item', 'record_observation', 'record_note'].includes(action)) return paths.evidenceActions;
    if (['record_progress', 'record_blocker', 'record_exception', 'record_change'].includes(action)) return paths.progressActions;
    if (['propose_completion', 'withdraw_completion'].includes(action)) return paths.completionActions;
    if (['start', 'pause', 'resume'].includes(action)) return paths.transitions;
    if (action === 'initialize') return paths.initialize;
    throw new Error('WORK_ACTION_INVALID');
  }

  function lifecycleDescriptor(action, button) {
    var names = { start: 'Start work', pause: 'Pause work', resume: 'Resume work' };
    var reasons = {
      start: 'Start the current assigned work.',
      pause: 'Pause the current assigned work.',
      resume: 'Resume the current assigned work.',
    };
    var pins = executionPins();
    confirmAction({
      action: action, label: names[action],
      copy: 'NorthStar will record this lifecycle change against the exact execution and assignment versions shown now.',
      path: mutationPath(action),
      body: {
        action: action,
        expectedRevision: pins.expectedExecutionRevision,
        expectedDigest: pins.expectedExecutionDigest,
        expectedAssignmentRevision: pins.expectedAssignmentRevision,
        expectedAssignmentDigest: pins.expectedAssignmentDigest,
        reason: reasons[action],
      },
    }, button);
  }

  function renderOverview() {
    byId('workTitle').textContent = clean(model.record.title, 'Job title unavailable');
    byId('workCustomer').textContent = clean(model.record.customer && model.record.customer.name, 'Customer unavailable') +
      ' · ' + locationText(model.record.customer && model.record.customer.serviceLocation);
    var role = label(model.today.identity.operationalRole, 'Worker');
    var authority = clean(model.today.identity.displayName, 'Workforce member') + ' · ' + role + ' · Assigned work only';
    byId('workAuthority').textContent = authority;
    byId('workAuthority').setAttribute('aria-label', authority);
    var content = byId('workOverview');
    var oldGrid = content.querySelector('.work-overview-grid');
    if (oldGrid) oldGrid.remove();
    var grid = node('div', 'work-overview-grid');
    append(grid,
      summary('Schedule', formatInstant(model.record.schedule && model.record.schedule.start)),
      summary('Assignment', clean(model.record.assignment && model.record.assignment.label, 'Assignment unavailable')),
      summary('Dispatch', label(model.record.dispatch && model.record.dispatch.state)),
      summary('Instructions', clean(model.record.instructions && model.record.instructions.text, 'No current instructions'))
    );
    content.appendChild(grid);
  }

  function renderLifecycle() {
    var content = byId('workLifecycleContent');
    content.replaceChildren();
    if (!model.execution) {
      byId('workStateBadge').textContent = 'Not opened';
      byId('workStateBadge').dataset.state = 'empty';
      content.appendChild(emptyNote('No field execution exists for this current approved assignment.'));
      if (allows('initialize')) {
        content.appendChild(actionButton('Open work record', 'workLifecyclePrimary', function(event) {
          var recordPins = model.record.authority;
          confirmAction({ action: 'initialize', label: 'Open work record',
            copy: 'NorthStar will create one server-owned field execution for this exact current assignment.',
            path: mutationPath('initialize'), body: {
              expectedAssignmentRevision: recordPins.revision,
              expectedAssignmentDigest: recordPins.digest,
              reason: 'Open the current assigned work detail.',
            } }, event.currentTarget);
        }, 'btn btn-primary'));
      } else {
        content.appendChild(unavailableNote('The server did not authorize opening work from this current record.'));
      }
      return;
    }
    var state = model.execution.lifecycleState;
    byId('workStateBadge').textContent = label(state);
    byId('workStateBadge').dataset.state = state;
    var grid = node('div', 'work-summary-grid');
    append(grid, summary('Current state', label(state)), summary('Last action', label(model.execution.lastAction)));
    content.appendChild(grid);
    var actions = node('div', 'work-actions');
    var nextAction = ['start', 'pause', 'resume'].find(allows);
    var next = nextAction ? [nextAction, { start: 'Start work', pause: 'Pause work', resume: 'Resume work' }[nextAction]] : null;
    if (next) {
      var button = actionButton(next[1], 'workLifecyclePrimary', function(event) {
        lifecycleDescriptor(next[0], event.currentTarget);
      }, 'btn btn-primary');
      actions.appendChild(button);
    } else {
      actions.appendChild(unavailableNote(['completed', 'cancelled'].includes(state)
        ? 'This durable execution is read-only. An owner or administrator controls reopening.'
        : state === 'completion_pending'
          ? 'Completion is awaiting explicit review. You may withdraw your active proposal below.'
          : 'This lifecycle is read-only from the worker experience.'));
    }
    content.appendChild(actions);
  }

  function renderLabor() {
    var content = byId('workLaborContent');
    content.replaceChildren();
    var data = model.reads.labor;
    if (!data) { content.appendChild(unavailableNote('Time evidence could not be loaded. No time is inferred.')); return; }
    var intervals = safeArray(data.intervals);
    var summaries = safeArray(data.summaries);
    if (!intervals.length) content.appendChild(emptyNote('No time evidence has been recorded for this work.'));
    else {
      var list = node('ul', 'work-record-list');
      intervals.slice(0, 8).forEach(function(interval) {
        var item = node('li');
        append(item, node('p', 'work-record-title', label(interval.category, 'Time interval')),
          node('p', '', formatInstant(interval.observedStart) + ' — ' + (interval.observedEnd ? formatInstant(interval.observedEnd) : 'Timer running')));
        list.appendChild(item);
      });
      content.appendChild(list);
    }
    if (summaries.length) content.appendChild(node('p', '', summaries.map(function(item) {
      return label(item.category) + ': ' + Math.round(Number(item.observedSeconds || 0) / 60) + ' minutes';
    }).join(' · ')));
    content.appendChild(node('p', '', clean(data.interpretation, 'Operational time evidence only; not payroll.')));
    if (!['start_timer', 'stop_timer', 'record_manual'].some(allows)) return;
    var categories = safeArray(data.categoryContract && data.categoryContract.categories).map(function(value) { return { value: value, label: label(value) }; });
    var open = intervals.find(function(interval) { return !interval.observedEnd && interval.reviewState !== 'rejected'; });
    var actions = node('div', 'work-actions');
    if (allows('start_timer')) actions.appendChild(actionButton('Start timer', '', function() { toggleForm('workLaborStart'); }));
    if (allows('stop_timer') && open) actions.appendChild(actionButton('Stop timer', '', function(event) {
      var body = commonBody('stop_timer', 'Stop the current field-work timer.');
      Object.assign(body, {
        categoryContractVersion: data.categoryContract.version,
        categoryContractDigest: data.categoryContract.digest,
        businessProfileId: model.today.businessProfile.id,
        businessProfileVersion: model.today.businessProfile.version,
        businessProfileHash: model.today.businessProfile.hash,
        timeZone: model.today.businessProfile.timeZone,
        intervalId: open.id, expectedIntervalRevision: open.revision, expectedIntervalDigest: open.digest,
      });
      confirmAction({ action: 'stop_timer', label: 'Stop timer', copy: 'Confirm the running timer should stop now.',
        path: mutationPath('stop_timer'), body: body }, event.currentTarget);
    }, 'btn btn-primary'));
    if (allows('stop_timer') && !open) content.appendChild(unavailableNote('The server authorized a timer stop, but the pinned running interval was not returned. Reload before acting.'));
    if (allows('record_manual')) actions.appendChild(actionButton('Add manual time', '', function() { toggleForm('workLaborManual'); }));
    content.appendChild(actions);
    if (allows('start_timer')) content.appendChild(makeForm('workLaborStart', [
      { name: 'category', label: 'Time category', type: 'select', options: categories },
    ], 'Record timer start', function(values) {
      var body = commonBody('start_timer', 'Start a field-work timer in the selected category.');
      return Object.assign(body, {
        category: values.get('category'), categoryContractVersion: data.categoryContract.version,
        categoryContractDigest: data.categoryContract.digest, businessProfileId: model.today.businessProfile.id,
        businessProfileVersion: model.today.businessProfile.version, businessProfileHash: model.today.businessProfile.hash,
        timeZone: model.today.businessProfile.timeZone,
      });
    }, 'start_timer'));
    if (allows('record_manual')) content.appendChild(makeForm('workLaborManual', [
      { name: 'category', label: 'Time category', type: 'select', options: categories },
      { name: 'observedStart', label: 'Started', type: 'datetime-local' },
      { name: 'observedEnd', label: 'Ended', type: 'datetime-local' },
    ], 'Record manual time', function(values) {
      var body = commonBody('record_manual', 'Record manually observed field-work time.');
      return Object.assign(body, {
        category: values.get('category'), categoryContractVersion: data.categoryContract.version,
        categoryContractDigest: data.categoryContract.digest, businessProfileId: model.today.businessProfile.id,
        businessProfileVersion: model.today.businessProfile.version, businessProfileHash: model.today.businessProfile.hash,
        timeZone: model.today.businessProfile.timeZone,
        observedStart: new Date(values.get('observedStart')).toISOString(),
        observedEnd: new Date(values.get('observedEnd')).toISOString(),
      });
    }, 'record_manual'));
  }

  function renderMaterials() {
    var content = byId('workMaterialsContent');
    content.replaceChildren();
    var data = model.reads.materials;
    if (!data) { content.appendChild(unavailableNote('Material evidence could not be loaded. No stock level is inferred.')); return; }
    var movements = safeArray(data.movements);
    if (!movements.length) content.appendChild(emptyNote('No material movement has been recorded for this work.'));
    else {
      var list = node('ul', 'work-record-list');
      movements.slice(0, 8).forEach(function(item) {
        var row = node('li');
        append(row, node('p', 'work-record-title', clean(item.description, label(item.movementKind, 'Material evidence'))),
          node('p', '', clean(item.quantity, 'Quantity unavailable') + ' ' + clean(item.unitCode, '') + ' · ' + label(item.reviewState)));
        list.appendChild(row);
      });
      content.appendChild(list);
    }
    content.appendChild(node('p', '', clean(data.interpretation, 'Recorded movement evidence only. Current stock is not inferred.')));
    if (!allows('record_material')) return;
    var materialKinds = model.record.workCapabilities.materialMovementKinds;
    if (!materialKinds.length) {
      content.appendChild(unavailableNote('The server did not return any material movement kind for this action.'));
      return;
    }
    content.appendChild(actionButton('Record material', '', function() { toggleForm('workMaterialForm'); }));
    var materialForm = makeForm('workMaterialForm', [
      { name: 'movementKind', label: 'Movement', type: 'select', options: materialKinds.map(function(value) { return { value: value, label: label(value) }; }) },
      { name: 'itemKey', label: 'Material key', maxLength: 64, help: 'Use a stable short key such as copper.pipe.' },
      { name: 'description', label: 'What was recorded', maxLength: 1000, wide: true },
      { name: 'quantity', label: 'Quantity', type: 'number', min: '0.000001', step: '0.000001' },
      { name: 'unitCode', label: 'Unit key', maxLength: 64, value: 'each' },
      { name: 'locationKey', label: 'Location key (optional)', required: false, maxLength: 64 },
      { name: 'destinationLocationKey', label: 'Destination location key (transfer only)', required: false, maxLength: 64 },
      { name: 'lotCode', label: 'Lot key (optional)', required: false, maxLength: 64 },
      { name: 'adjustmentDirection', label: 'Adjustment direction', type: 'select', required: false, options: [
        { value: '', label: 'Not an adjustment' }, { value: 'increase', label: 'Increase' }, { value: 'decrease', label: 'Decrease' },
      ] },
    ], 'Record material evidence', function(values) {
      var body = commonBody('record', 'Record the observed material movement for this work.');
      Object.assign(body, {
        movementKind: values.get('movementKind'), itemKey: values.get('itemKey'), description: values.get('description'),
        quantity: values.get('quantity'), unitCode: values.get('unitCode'),
        unitContractVersion: data.unitContract.version, unitContractDigest: data.unitContract.digest,
      });
      if (values.get('locationKey')) body.locationKey = values.get('locationKey');
      if (values.get('lotCode')) body.lotCode = values.get('lotCode');
      if (body.movementKind === 'transferred' && values.get('destinationLocationKey')) {
        body.destinationLocationKey = values.get('destinationLocationKey');
      }
      if (body.movementKind === 'adjustment') body.adjustmentDirection = values.get('adjustmentDirection');
      return body;
    }, 'record_material');
    var materialKind = materialForm.elements.namedItem('movementKind');
    var locationKey = materialForm.elements.namedItem('locationKey');
    var destinationLocationKey = materialForm.elements.namedItem('destinationLocationKey');
    var adjustmentDirection = materialForm.elements.namedItem('adjustmentDirection');
    function updateMaterialFields() {
      var transferred = materialKind.value === 'transferred';
      var adjustment = materialKind.value === 'adjustment';
      locationKey.required = transferred;
      destinationLocationKey.required = transferred;
      destinationLocationKey.closest('.work-field').hidden = !transferred;
      adjustmentDirection.required = adjustment;
      adjustmentDirection.closest('.work-field').hidden = !adjustment;
    }
    materialKind.addEventListener('change', updateMaterialFields);
    updateMaterialFields();
    content.appendChild(materialForm);
  }

  function renderEquipment() {
    var content = byId('workEquipmentContent');
    content.replaceChildren();
    var events = model.reads.equipment && safeArray(model.reads.equipment.events);
    var assets = model.reads.catalogue && safeArray(model.reads.catalogue.assets).filter(function(asset) { return asset.reviewState === 'reviewed'; });
    if (!model.reads.equipment || !model.reads.catalogue) {
      content.appendChild(unavailableNote('Equipment evidence or the tenant catalogue could not be loaded. No equipment status is inferred.'));
      return;
    }
    if (!events.length) content.appendChild(emptyNote('No equipment event has been recorded for this work.'));
    else {
      var list = node('ul', 'work-record-list');
      events.slice(0, 8).forEach(function(event) {
        var item = node('li');
        append(item, node('p', 'work-record-title', label(event.document && event.document.kind, 'Equipment event')),
          node('p', '', clean(event.document && event.document.description, 'Description unavailable')));
        list.appendChild(item);
      });
      content.appendChild(list);
    }
    if (!assets.length) { content.appendChild(unavailableNote('No reviewed tenant equipment is currently available to record here.')); return; }
    if (!allows('record_equipment')) return;
    var equipmentKinds = model.record.workCapabilities.equipmentKinds;
    if (!equipmentKinds.length) {
      content.appendChild(unavailableNote('The server did not return any equipment event kind for this action.'));
      return;
    }
    content.appendChild(actionButton('Record equipment use', '', function() { toggleForm('workEquipmentForm'); }));
    var equipmentForm = makeForm('workEquipmentForm', [
      { name: 'assetId', label: 'Reviewed asset', type: 'select', options: assets.map(function(asset) {
        return { value: asset.id, label: clean(asset.name, 'Unnamed asset') + ' · ' + clean(asset.categoryLabel, 'Category unavailable') };
      }) },
      { name: 'kind', label: 'Event', type: 'select', options: equipmentKinds.map(function(value) { return { value: value, label: label(value) }; }) },
      { name: 'observedAt', label: 'Observed at', type: 'datetime-local' },
      { name: 'meterKey', label: 'Meter key', required: false, maxLength: 80 },
      { name: 'reading', label: 'Meter reading', type: 'number', required: false, min: '0', step: '0.001' },
      { name: 'unit', label: 'Reading unit', type: 'select', required: false,
        options: ['hours','km','mi','percent','litres','gallons','count'].map(function(value) { return { value: value, label: label(value) }; }) },
      { name: 'description', label: 'Observed equipment event', type: 'textarea', maxLength: 1000, wide: true },
    ], 'Record equipment evidence', function(values) {
      var asset = assets.find(function(candidate) { return candidate.id === values.get('assetId'); });
      if (!asset) throw new Error('WORK_EQUIPMENT_AUTHORITY_STALE');
      var metered = ['reading', 'meter_reset'].includes(values.get('kind'));
      return Object.assign(commonBody('record', 'Record the observed equipment event for this work.'), {
        assetId: asset.id, assetVersion: asset.version, assetDigest: asset.assetDigest,
        knowledgeVersionId: asset.knowledgeVersionId, knowledgeDigest: asset.knowledgeDigest,
        expectedAssetRevision: asset.operationRevision, expectedAssetDigest: asset.operationDigest,
        kind: values.get('kind'), observedAt: new Date(values.get('observedAt')).toISOString(),
        meterKey: metered ? values.get('meterKey') : null,
        reading: metered ? values.get('reading') : null,
        unit: metered ? values.get('unit') : null,
        description: values.get('description'), correctsEventId: null,
      });
    }, 'record_equipment');
    var equipmentKind = equipmentForm.elements.namedItem('kind');
    function updateMeterFields() {
      var metered = ['reading', 'meter_reset'].includes(equipmentKind.value);
      ['meterKey', 'reading', 'unit'].forEach(function(name) {
        var control = equipmentForm.elements.namedItem(name);
        control.required = metered;
        control.closest('.work-field').hidden = !metered;
      });
    }
    equipmentKind.addEventListener('change', updateMeterFields);
    updateMeterFields();
    content.appendChild(equipmentForm);
  }

  function evidenceRecords() {
    return model.reads.evidence ? safeArray(model.reads.evidence.data) : [];
  }
  function openChecklistItems(records) {
    var answered = new Set(records.filter(function(record) {
      return record.document && record.document.kind === 'checklist_response';
    }).map(function(record) { return record.document.checklistId + ':' + record.document.itemKey; }));
    var result = [];
    records.filter(function(record) { return record.document && record.document.kind === 'checklist'; })
      .forEach(function(checklist) {
        safeArray(checklist.document.items).forEach(function(item) {
          if (!answered.has(checklist.id + ':' + item.key)) result.push({ checklist: checklist, item: item });
        });
      });
    return result.slice(0, 100);
  }
  function renderEvidence() {
    var content = byId('workEvidenceContent');
    content.replaceChildren();
    var records = evidenceRecords();
    if (!model.reads.evidence) { content.appendChild(unavailableNote('Field evidence could not be loaded. No evidence is inferred.')); return; }
    if (!model.reads.evidence.complete) content.appendChild(unavailableNote('The evidence history is incomplete. Completion proposals are unavailable until the current evidence can be reviewed.'));
    if (!records.length && model.reads.evidence.complete) content.appendChild(emptyNote('No checklist, observation, note, or file evidence is recorded for this work.'));
    else {
      var list = node('ul', 'work-record-list');
      records.slice(0, 10).forEach(function(record) {
        var documentValue = record.document || record;
        var item = node('li');
        append(item, node('p', 'work-record-title', label(documentValue.kind, 'Field evidence')),
          node('p', '', clean(documentValue.note || documentValue.observation || documentValue.caption, 'Recorded evidence')));
        list.appendChild(item);
      });
      content.appendChild(list);
    }
    content.appendChild(unavailableNote('File capture is not offered here because durable field-file storage is not confirmed. No upload was attempted.'));
    if (!['create_checklist', 'respond_item', 'record_note', 'record_observation'].some(allows)) return;
    var checklistItems = openChecklistItems(records);
    var actions = node('div', 'work-actions');
    if (allows('create_checklist')) actions.appendChild(actionButton('Create checklist', '', function() { toggleForm('workEvidenceChecklist'); }));
    if (allows('respond_item') && checklistItems.length) actions.appendChild(actionButton('Respond to checklist', '', function() { toggleForm('workEvidenceResponse'); }));
    if (allows('record_note')) actions.appendChild(actionButton('Add note', '', function() { toggleForm('workEvidenceNote'); }));
    if (allows('record_observation')) actions.appendChild(actionButton('Record observation', '', function() { toggleForm('workEvidenceObservation'); }));
    content.appendChild(actions);
    if (allows('create_checklist')) content.appendChild(makeForm('workEvidenceChecklist', [
      { name: 'key', label: 'Checklist item key', maxLength: 64, value: 'inspection.item' },
      { name: 'prompt', label: 'Checklist item', type: 'textarea', maxLength: 500, wide: true },
      { name: 'required', label: 'Required item', type: 'select', options: [
        { value: 'true', label: 'Required' }, { value: 'false', label: 'Optional' },
      ] },
    ], 'Create checklist', function(values) {
      return Object.assign(commonBody('create_checklist', 'Create one ad-hoc worker checklist.'), {
        template: null,
        items: [{ key: values.get('key'), prompt: values.get('prompt'), required: values.get('required') === 'true' }],
      });
    }, 'create_checklist'));
    if (allows('respond_item') && checklistItems.length) content.appendChild(makeForm('workEvidenceResponse', [
      { name: 'item', label: 'Checklist item', type: 'select', options: checklistItems.map(function(entry, index) {
        return { value: String(index), label: clean(entry.item.prompt, entry.item.key) };
      }) },
      { name: 'resultType', label: 'Result', type: 'select', options: [
        { value: 'pass', label: 'Pass' }, { value: 'fail', label: 'Fail' },
        { value: 'observation', label: 'Observation' }, { value: 'unavailable', label: 'Unavailable' },
        { value: 'needs_review', label: 'Needs review' },
      ] },
      { name: 'observation', label: 'Observed result', type: 'textarea', maxLength: 2000, wide: true },
      { name: 'exception', label: 'Exception detail (optional)', type: 'textarea', required: false, maxLength: 1000, wide: true },
    ], 'Record checklist response', function(values) {
      var selected = checklistItems[Number(values.get('item'))];
      if (!selected || !selected.checklist || !selected.item) throw new Error('WORK_CHECKLIST_AUTHORITY_STALE');
      return Object.assign(commonBody('respond_item', 'Record one response to the current checklist item.'), {
        checklistId: selected.checklist.id,
        expectedChecklistRevision: selected.checklist.revision,
        expectedChecklistDigest: selected.checklist.digest,
        itemKey: selected.item.key,
        resultType: values.get('resultType'), observation: values.get('observation'), measurement: null,
        exception: values.get('exception') || null, supportingEvidenceIds: [],
      });
    }, 'respond_item'));
    if (allows('record_note')) content.appendChild(makeForm('workEvidenceNote', [
      { name: 'note', label: 'Field note', type: 'textarea', maxLength: 4000, wide: true },
      { name: 'caption', label: 'Short caption (optional)', required: false, maxLength: 500, wide: true },
    ], 'Record field note', function(values) {
      var body = commonBody('record_note', 'Record a worker field note.');
      body.note = values.get('note'); body.caption = values.get('caption') || null; return body;
    }, 'record_note'));
    if (allows('record_observation')) content.appendChild(makeForm('workEvidenceObservation', [
      { name: 'observationClass', label: 'Observation class', type: 'select', options: [
        { value: 'field_observation', label: 'Field observation' }, { value: 'inspection', label: 'Inspection' }, { value: 'quality', label: 'Quality' },
      ] },
      { name: 'resultType', label: 'Result', type: 'select', options: [
        { value: 'observation', label: 'Observation' }, { value: 'pass', label: 'Pass' }, { value: 'fail', label: 'Fail' },
        { value: 'unavailable', label: 'Unavailable' }, { value: 'needs_review', label: 'Needs review' },
      ] },
      { name: 'observation', label: 'What you observed', type: 'textarea', maxLength: 2000, wide: true },
      { name: 'exception', label: 'Exception detail (optional)', type: 'textarea', required: false, maxLength: 1000, wide: true },
    ], 'Record observation', function(values) {
      var body = commonBody('record_observation', 'Record an observed field fact.');
      return Object.assign(body, { observationClass: values.get('observationClass'), resultType: values.get('resultType'),
        observation: values.get('observation'), measurement: null, exception: values.get('exception') || null,
        supportingEvidenceIds: [] });
    }, 'record_observation'));
  }

  function progressDocument(kind, values) {
    var base = { kind: kind, description: values.get('description'), observedAt: new Date().toISOString(),
      timeZoneAuthority: zoneAuthority(), evidence: [] };
    if (kind === 'progress') return Object.assign(base, {
      workKey: values.get('workKey'), quantity: { completed: values.get('completed'), total: values.get('total'), unit: values.get('unit') },
      milestone: null, uncertainty: values.get('uncertainty'),
      uncertaintyReason: values.get('uncertainty') === 'measured' ? null : values.get('uncertaintyReason'),
    });
    if (kind === 'blocker' || kind === 'exception') return Object.assign(base, {
      category: values.get('category'), impact: values.get('impact'), severity: values.get('severity'),
      followUp: { profileId: model.today.identity.profileId, action: values.get('followUp') }, state: 'open', resolution: null,
    });
    return Object.assign(base, {
      difference: values.get('difference'), initiator: { source: 'worker', description: values.get('initiator') },
      affectedWork: values.get('affectedWork'), scheduleImplications: values.get('scheduleImplications'),
      resourceImplications: values.get('resourceImplications'),
    });
  }
  function progressBody(action, documentValue) {
    return Object.assign(commonBody(action, 'Record the observed operational field fact.'), { document: documentValue });
  }
  function renderProgress() {
    var content = byId('workProgressContent');
    content.replaceChildren();
    var data = model.reads.progress;
    var records = data && safeArray(data.records || data);
    if (!data) { content.appendChild(unavailableNote('Progress and issue facts could not be loaded. No progress is inferred.')); return; }
    if (!records.length) content.appendChild(emptyNote('No progress, blocker, exception, or field-change fact has been recorded.'));
    else {
      var list = node('ul', 'work-record-list');
      records.slice(0, 10).forEach(function(record) {
        var documentValue = record.document || {};
        var item = node('li');
        append(item, node('p', 'work-record-title', label(documentValue.kind, 'Operational fact')),
          node('p', '', clean(documentValue.description, 'Description unavailable') + ' · ' + label(documentValue.reviewState, 'Needs review')));
        list.appendChild(item);
      });
      content.appendChild(list);
    }
    if (!['record_progress', 'record_blocker', 'record_exception', 'record_change'].some(allows)) return;
    var actions = node('div', 'work-actions');
    [['workProgressForm', 'Progress', 'record_progress'], ['workBlockerForm', 'Blocker', 'record_blocker'],
      ['workExceptionForm', 'Exception', 'record_exception'], ['workChangeForm', 'Field change', 'record_change']]
      .filter(function(item) { return allows(item[2]); })
      .forEach(function(item) { actions.appendChild(actionButton('Record ' + item[1].toLowerCase(), '', function() { toggleForm(item[0]); })); });
    content.appendChild(actions);
    if (allows('record_progress')) content.appendChild(makeForm('workProgressForm', [
      { name: 'description', label: 'Progress description', type: 'textarea', maxLength: 1000, wide: true },
      { name: 'workKey', label: 'Work key', value: 'current.work', maxLength: 64 },
      { name: 'completed', label: 'Completed quantity', type: 'number', min: '0', step: '0.000001' },
      { name: 'total', label: 'Planned quantity', type: 'number', min: '0.000001', step: '0.000001' },
      { name: 'unit', label: 'Unit', type: 'select', options: ['ea','m','m2','m3','ft','ft2','ft3','yd3','kg','lb','l','gal'].map(function(value) { return { value: value, label: value }; }) },
      { name: 'uncertainty', label: 'Evidence quality', type: 'select', options: [
        { value: 'measured', label: 'Measured' }, { value: 'estimated', label: 'Estimated' },
      ] },
      { name: 'uncertaintyReason', label: 'Estimate reason (if estimated)', required: false, maxLength: 1000, wide: true },
    ], 'Record progress', function(values) { return progressBody('record_progress', progressDocument('progress', values)); }, 'record_progress'));
    ['blocker', 'exception'].filter(function(kind) { return allows('record_' + kind); }).forEach(function(kind) {
      content.appendChild(makeForm(kind === 'blocker' ? 'workBlockerForm' : 'workExceptionForm', [
        { name: 'description', label: label(kind) + ' description', type: 'textarea', maxLength: 1000, wide: true },
        { name: 'category', label: 'Category', type: 'select', options: ['access','weather','material','equipment','scope','quality','coordination','other'].map(function(value) { return { value: value, label: label(value) }; }) },
        { name: 'impact', label: 'Impact', type: 'select', options: ['prevents_work','constrains_work','no_current_constraint','unknown'].map(function(value) { return { value: value, label: label(value) }; }) },
        { name: 'severity', label: 'Severity', type: 'select', options: ['low','moderate','high','unknown'].map(function(value) { return { value: value, label: label(value) }; }) },
        { name: 'followUp', label: 'Next follow-up', maxLength: 1000, wide: true },
      ], 'Record ' + kind, function(values) { return progressBody('record_' + kind, progressDocument(kind, values)); }, 'record_' + kind));
    });
    if (allows('record_change')) content.appendChild(makeForm('workChangeForm', [
      { name: 'description', label: 'Change description', type: 'textarea', maxLength: 1000, wide: true },
      { name: 'difference', label: 'Difference', type: 'select', options: [{ value: 'observed', label: 'Observed' }, { value: 'requested', label: 'Requested' }] },
      { name: 'initiator', label: 'How the change arose', maxLength: 1000 },
      { name: 'affectedWork', label: 'Affected work', maxLength: 1000 },
      { name: 'scheduleImplications', label: 'Schedule implications', maxLength: 1000 },
      { name: 'resourceImplications', label: 'Resource implications', maxLength: 1000 },
    ], 'Record field change', function(values) { return progressBody('record_change', progressDocument('field_change', values)); }, 'record_change'));
  }

  function completionSignature() {
    return JSON.stringify({ total: model.reads.evidence.total, requirements: api.completionRequirements(model.reads.evidence) });
  }
  function completionSelectionCopy() {
    var selected = api.completionRequirements(model.reads.evidence);
    return 'This proposal includes all ' + selected.checklists.length + ' current checklists, ' +
      selected.inspections.length + ' current inspections and ' + selected.files.length +
      ' current files from the complete evidence history. Other completion checks and owner or administrator approval still apply.';
  }
  async function collectEvidenceResponse(first, signal) {
    var location = api.paths(selector).evidence;
    return api.collectEvidence(first, function(cursor) {
      return responseJson(location + '?cursor=' + encodeURIComponent(cursor), null, signal);
    }, selector.executionId);
  }
  async function refreshCompletionSelection(expectedSignature) {
    var previous;
    try { previous = expectedSignature || completionSignature(); }
    catch (_error) { renderCompletion(); return false; }
    var generation = loadController;
    var today = model.today;
    var execution = model.execution;
    var owner = tabStorage;
    function currentContext() {
      return tabReady && owner === tabStorage && generation === loadController &&
        today === model.today && execution === model.execution;
    }
    function focusSelection() {
      byId('workCompletionContent').tabIndex = -1;
      byId('workCompletionContent').focus({ preventScroll: true });
    }
    setPending(true);
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 12000);
    try {
      var first = await responseJson(api.paths(selector).evidence, null, controller.signal);
      var snapshot = await collectEvidenceResponse(first, controller.signal);
      if (!currentContext()) return false;
      model.reads.evidence = snapshot;
      var current = completionSignature();
      if (current !== previous) {
        renderCompletion();
        var changed = 'The evidence changed. Review the current selection before proposing completion.';
        byId('workCompletionContent').prepend(unavailableNote(changed));
        byId('workStatus').textContent = changed;
        focusSelection();
        return false;
      }
      return true;
    } catch (error) {
      if (!currentContext()) return false;
      if (error.status === 401 || error.status === 403) {
        pruneDrafts(true); clearRestrictedPresentation(); setState('restricted');
      } else {
        if (!error.code || !error.code.startsWith('WORK_EVIDENCE_')) model.reads.evidence = null;
        renderCompletion();
        byId('workStatus').textContent = 'Current evidence could not be confirmed. No completion proposal was sent.';
        focusSelection();
      }
      return false;
    } finally { clearTimeout(timeout); setPending(false); }
  }
  function renderCompletion() {
    var content = byId('workCompletionContent');
    content.replaceChildren();
    var data = model.reads.completion;
    if (!data) { content.appendChild(unavailableNote('Completion authority could not be loaded. No completion is inferred.')); return; }
    content.appendChild(node('p', '', clean(data.interpretation, 'Completion requires an explicit proposal and authorized approval.')));
    var records = safeArray(data.records);
    if (records.length) {
      var list = node('ul', 'work-record-list');
      records.slice(0, 8).forEach(function(record) {
        var item = node('li');
        append(item, node('p', 'work-record-title', label(record.recordKind, 'Completion record')),
          node('p', '', label(record.lifecycleAfter, 'Recorded') + ' · ' + formatInstant(record.decidedAt)));
        list.appendChild(item);
      });
      content.appendChild(list);
    }
    if (allows('withdraw_completion') && data.activeProposal) {
      content.appendChild(actionButton('Withdraw completion proposal', '', function(event) {
        var body = executionPins();
        Object.assign(body, { action: 'withdraw_completion', reason: 'Withdraw the current completion proposal.', proposal: {
          id: data.activeProposal.id, revision: data.activeProposal.revision, digest: data.activeProposal.digest,
        } });
        confirmAction({ action: 'withdraw_completion', label: 'Withdraw completion proposal',
          copy: 'This returns the execution to its explicit pre-proposal state. It does not delete completion history.',
          path: mutationPath('withdraw_completion'), body: body }, event.currentTarget);
      }));
    } else if (allows('propose_completion')) {
      try { api.completionRequirements(model.reads.evidence); }
      catch (error) {
        content.appendChild(unavailableNote(error.code === 'WORK_EVIDENCE_SELECTION_LIMIT'
          ? 'The current evidence exceeds the 20-per-kind selection limit for this view. No records have been omitted; a completion proposal cannot be prepared here.'
          : 'The complete, current evidence selection could not be confirmed. Reload current work before proposing completion.'));
        content.appendChild(actionButton('Reload current work', '', function() { load(); }));
        return;
      }
      content.appendChild(node('p', '', completionSelectionCopy()));
      content.appendChild(actionButton('Propose completion', '', function() { toggleForm('workCompletionForm'); }, 'btn btn-primary'));
      var tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      var localDefault = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      content.appendChild(makeForm('workCompletionForm', [
        { name: 'expiresAt', label: 'Proposal expires', type: 'datetime-local', value: localDefault,
          help: 'An owner or administrator must explicitly review before this time.' },
      ], 'Propose completion', function(values) {
        return Object.assign(executionPins(), { action: 'propose_completion',
          reason: 'Propose explicit completion for authorized review.', expiresAt: new Date(values.get('expiresAt')).toISOString(),
          gateRequirements: api.completionRequirements(model.reads.evidence),
        });
      }, 'propose_completion'));
    } else {
      content.appendChild(unavailableNote(['completed', 'cancelled'].includes(model.execution.lifecycleState)
        ? 'This execution has a durable terminal state. Only authorized owner or administrator actions can change it.'
        : 'Start or resume work before proposing completion.'));
    }
  }

  function setFormHidden(form, value) {
    form.hidden = value;
    form.querySelectorAll('button,input,select,textarea').forEach(function(control) { control.hidden = value; });
  }
  function toggleForm(id) {
    var target = byId(id);
    if (!target) return;
    var willShow = target.hidden;
    document.querySelectorAll('.work-form').forEach(function(form) { setFormHidden(form, true); });
    setFormHidden(target, !willShow);
    if (willShow) {
      var first = target.querySelector('input,select,textarea');
      if (first) first.focus();
    }
  }

  function renderReady(announcement) {
    renderOverview();
    renderLifecycle();
    if (model.execution) {
      renderLabor(); renderMaterials(); renderEquipment(); renderEvidence(); renderProgress(); renderCompletion();
    } else {
      ['workLaborContent','workMaterialsContent','workEquipmentContent','workEvidenceContent','workProgressContent','workCompletionContent']
        .forEach(function(id) { byId(id).replaceChildren(unavailableNote('Open the server-owned work record to use this section.')); });
    }
    var pageState = model.partial.length ? 'partial-file' : announcement ? 'success' :
      !model.execution ? 'empty' : model.record.workCapabilities.mutable ? 'ready' : 'read-only';
    setState(pageState, '', announcement || (model.partial.length ? STATE_COPY['partial-file'][1] :
      pageState === 'ready' ? 'Current server-owned work detail is ready.' : ''));
    if (tabStorage && !tabStorage.persistent) {
      byId('workStatus').textContent += ' Draft and retry storage is unavailable in this tab. Reloading removes unconfirmed local state.';
    }
  }

  async function load(options) {
    if (!tabReady) return false;
    options = options || {};
    if (loadController) loadController.abort();
    var controller = new AbortController();
    loadController = controller;
    var timeout = setTimeout(function() { controller.abort(); }, 12000);
    if (!options.preserveApplied) setState('loading');
    model.partial = [];
    try {
      var todayPayload = await responseJson('/api/v1/today', null, controller.signal);
      if (loadController !== controller) return false;
      model.today = validateToday(todayPayload.data);
      var selected = model.today.records.find(function(record) { return record.appointmentId === selector.appointmentId; });
      if (!selected) {
        pruneDrafts(true);
        clearRestrictedPresentation();
        setState('restricted', '', '', true); return false;
      }
      model.record = validateRecord(selected);
      if (selector.executionId && (!selected.execution || selected.execution.id !== selector.executionId)) {
        pruneDrafts(true);
        setState('stale', '', 'The selected execution is no longer the current execution for this assigned appointment.', true);
        return false;
      }
      if (!selected.execution) {
        model.execution = null; model.reads = {};
        pruneDrafts(false);
        renderReady(options.announcement); return true;
      }
      selector.executionId = selected.execution.id;
      var paths = api.paths(selector);
      var names = ['execution','labor','materials','equipment','catalogue','evidence','progress','completion'];
      var locations = [paths.execution,paths.labor,paths.materials,paths.equipment,paths.equipmentCatalogue,
        paths.evidence,paths.progress,paths.completion];
      var settled = await Promise.allSettled(locations.map(function(path) { return responseJson(path, null, controller.signal); }));
      if (settled[0].status !== 'fulfilled') throw settled[0].reason;
      var authorityFailure = settled.slice(1).find(function(result) {
        return result.status === 'rejected' && result.reason &&
          (result.reason.status === 401 || result.reason.status === 403);
      });
      if (authorityFailure) throw authorityFailure.reason;
      if (settled[5].status === 'fulfilled') {
        settled[5].value = { data: await collectEvidenceResponse(settled[5].value, controller.signal) };
      }
      if (loadController !== controller) return false;
      model.execution = validateExecution(settled[0].value.data);
      pruneDrafts(false);
      model.reads = {};
      settled.slice(1).forEach(function(result, index) {
        var name = names[index + 1];
        if (result.status === 'fulfilled') {
          model.reads[name] = result.value.data;
          if (name === 'evidence' && !result.value.data.complete) model.partial.push(name);
        } else model.partial.push(name);
      });
      renderReady(options.announcement);
      if (options.focusId) {
        var target = byId(options.focusId);
        if (target) target.focus({ preventScroll: true });
      }
      return true;
    } catch (error) {
      if (loadController !== controller) return false;
      var offline = root.navigator && root.navigator.onLine === false;
      if (offline || error.name === 'AbortError' && root.navigator && root.navigator.onLine === false) setState('offline');
      else if (error.status === 401 || error.status === 403) {
        pruneDrafts(true);
        clearRestrictedPresentation();
        setState('restricted');
      }
      else if (error.status === 409 || /STALE|CONFLICT/.test(error.code || '')) setState(error.status === 409 ? 'conflict' : 'stale');
      else setState(options.preserveApplied ? 'applied-but-refresh-failed' : 'retry');
      return false;
    } finally { clearTimeout(timeout); }
  }

  function confirmAction(descriptor, trigger) {
    if (pending) return;
    confirmation = { descriptor: descriptor, trigger: trigger };
    byId('workConfirmTitle').textContent = 'Confirm ' + descriptor.label;
    byId('workConfirmCopy').textContent = descriptor.copy;
    byId('workConfirmAction').textContent = 'Confirm ' + descriptor.label;
    byId('workConfirmDialog').showModal();
    byId('workConfirmCancel').focus();
  }

  function setPending(value) {
    pending = value || !tabReady;
    document.querySelectorAll('#workMain button, #workConfirmDialog button').forEach(function(button) { button.disabled = pending; });
  }

  async function sendMutation(descriptor, trigger) {
    if (pending) return;
    if (descriptor.action === 'propose_completion' && !model.retryMutation &&
        !await refreshCompletionSelection(descriptor.evidenceSignature)) return;
    var focusId = trigger && trigger.id || 'workMain';
    setPending(true);
    var key = idempotencyFor(descriptor.action);
    var headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': key };
    var csrf = api.cookie(document.cookie, 'northstar_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 15000);
    try {
      await responseJson(descriptor.path, { method: 'POST', headers: headers, body: JSON.stringify(descriptor.body) }, controller.signal);
      clearIdempotency(descriptor.action);
      clearDraft(descriptor.action);
      model.retryMutation = null;
      var refreshed = await load({ preserveApplied: true, announcement: descriptor.label + ' was recorded and refreshed.',
        focusId: focusId });
      if (!refreshed) setState('applied-but-refresh-failed');
    } catch (error) {
      var definitive = Number.isInteger(error.status);
      var retryable = error.status === 429 || error.status >= 500;
      if (definitive && !retryable) {
        model.retryMutation = null;
        clearIdempotency(descriptor.action);
        if (error.status === 401 || error.status === 403) {
          pruneDrafts(true);
          clearRestrictedPresentation();
          setState('restricted');
        }
        else if (error.status === 409 || /STALE|CONFLICT/.test(error.code || '')) setState('conflict');
        else if (error.code === 'M23_FIELD_STORAGE_UNAVAILABLE') setState('partial-file');
        else setState('retry', 'Action was not accepted', clean(error.message, 'Review the current fields and try again.'));
      } else {
        model.retryMutation = { descriptor: descriptor, trigger: trigger };
        var retryCopy = error.retryAfter
          ? 'Retry the same request after ' + clean(error.retryAfter, 'the server delay') + '. No success is claimed yet.'
          : STATE_COPY.retry[1];
        setState(root.navigator && root.navigator.onLine === false ? 'offline' : 'retry', '', retryCopy);
      }
    } finally {
      clearTimeout(timeout);
      setPending(false);
      var focusTarget = byId(focusId);
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }
  }

  byId('workConfirmDialog').addEventListener('close', function() {
    var current = confirmation;
    confirmation = null;
    if (!current) return;
    if (byId('workConfirmDialog').returnValue === 'default') sendMutation(current.descriptor, current.trigger);
    else if (current.trigger) current.trigger.focus({ preventScroll: true });
  });
  byId('workReload').addEventListener('click', function() {
    if (model.retryMutation) sendMutation(model.retryMutation.descriptor, model.retryMutation.trigger);
    else load();
  });
  root.addEventListener('online', function() {
    if (document.body.dataset.workState === 'offline' && !model.retryMutation) load();
  });

  try { selector = api.parseSelector(root.location.search); }
  catch (_error) {
    setState('restricted', 'Work link is invalid', 'Return to Today and open one current assigned appointment.', false);
    return;
  }
  function activateTab(resume) {
    var generation = ++tabClaimGeneration;
    setPending(true);
    setState('loading');
    api.claimTabStorage(root, resume).then(function(claim) {
      if (generation !== tabClaimGeneration) { claim.release(); return; }
      tabStorage = claim;
      tabReady = true;
      setPending(false);
      load();
    }).catch(function() {
      if (generation === tabClaimGeneration) {
        setState('restricted', 'Work could not be opened', 'Reload this tab before recording any field activity.');
      }
    });
  }
  root.addEventListener('pagehide', function() {
    tabClaimGeneration += 1;
    tabReady = false;
    setPending(true);
    if (loadController) loadController.abort();
    if (tabStorage) tabStorage.release();
  });
  root.addEventListener('pageshow', function(event) { if (event.persisted) activateTab(true); });
  activateTab(false);
})(window);
