(function (global) {
  'use strict';

  var contract = global.NorthStarAutomationCenter;
  var session = global.NorthStarAccountSession;
  var generation = 0;
  var previewGeneration = 0;
  var actionGeneration = 0;
  var actionPending = false;
  var pendingAction = null;
  var demoRevision = null;
  var demoMode = Boolean(global.NorthStarDemoRuntime && global.NorthStarDemoRuntime.active === true);
  var DEMO_ACTIONS = Object.freeze([
    'advance_time', 'source_change', 'source_correct', 'pause', 'resume',
    'suppress', 'recover', 'provider_step', 'stop', 'reset_automation',
  ]);
  var DEMO_DISCLAIMER = 'This is fictional information only. Nothing here changes your account or contacts a real outside service or person.';

  function element(id) { return document.getElementById(id); }
  function node(tag, className, text) {
    var value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function setStatus(state, message) {
    var target = element('automationStatus');
    target.dataset.state = state;
    target.textContent = message;
    element('automationMain').setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
  }
  function empty(target, message) {
    target.replaceChildren(node('p', 'automation-empty', message));
  }
  function formatDate(value) {
    if (!value) return 'Time unavailable';
    try {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
      }).format(new Date(value));
    } catch (_error) { return 'Time unavailable'; }
  }
  function clearPreview() {
    element('automationPreview').hidden = true;
    element('previewDetails').replaceChildren();
    element('previewStops').replaceChildren();
    element('previewSummary').textContent = '';
    element('previewBoundary').textContent = '';
  }
  function clearSensitive() {
    element('automationSummary').hidden = true;
    clearPreview();
    ['automationTemplates', 'automationApprovals', 'automationOwnerWork', 'waitingRuns', 'inFlightRuns', 'attentionRuns',
      'stoppedRuns', 'finishedRuns',
      'automationPolicies', 'automationTimeline', 'automationLimits', 'automationChannels', 'automationUnavailable',
    ]
      .forEach(function (id) { element(id).replaceChildren(); });
    [
      ['summaryStatus', 'Unavailable'],
      ['summaryExplanation', 'No automation data loaded.'],
      ['summaryPolicies', '0'],
      ['summaryPolicyDetail', 'No policy data loaded'],
      ['summaryRuns', '0'],
      ['summaryRunDetail', 'No run data loaded'],
      ['summaryAttention', 'Unavailable'],
      ['approvalCount', 'Unavailable'],
      ['ownerWorkCount', 'Unavailable'],
      ['limitsState', 'Unavailable'],
      ['limitsConsumption', 'Current consumption is unavailable.'],
      ['stopState', 'Unavailable'],
      ['stopExplanation', 'Current company-wide control is unavailable.'],
      ['automationEvaluatedAt', 'Not checked.'],
      ['automationStatus', 'Automation data unavailable.'],
    ].forEach(function (entry) { element(entry[0]).textContent = entry[1]; });
    element('setupTemplateId').value = 'custom';
    element('setupName').value = '';
    element('setupDailyLimit').value = '1';
    ['setupSource', 'setupAction', 'setupRecipient', 'setupChannel', 'setupTiming']
      .forEach(function (id) { element(id).value = ''; element(id).selectedIndex = 0; });
    element('automationDemoControls').hidden = true;
    element('automationDemoGeneration').textContent = 'Not loaded';
    element('automationDemoTime').textContent = 'Unavailable';
    element('automationDemoSource').textContent = 'Unavailable';
    element('automationDemoPolicy').textContent = 'Unavailable';
    element('automationDemoProvider').textContent = 'No real outside-service calls';
    element('automationDemoBoundary').textContent = 'No fictional automation state is loaded.';
    element('automationDemoStatus').textContent = 'The isolated fictional workspace is not loaded.';
    demoRevision = null;
  }
  function invalidateAuthority(error) {
    generation += 1;
    previewGeneration += 1;
    actionGeneration += 1;
    actionPending = false;
    pendingAction = null;
    clearSensitive();
    setStatus('error', error && error.status === 401
      ? 'Your session ended. Sign in again before reopening Automation Center. No saved data is shown.'
      : 'Automation Center requires current owner or administrator access. No saved data is shown.');
  }
  function isAuthorityFailure(error) {
    return error && (error.status === 401 || error.status === 403);
  }
  function invalidateConflict(context) {
    generation += 1;
    previewGeneration += 1;
    actionGeneration += 1;
    actionPending = false;
    pendingAction = null;
    clearSensitive();
    var status = errorStatus({ status: 409 }, context);
    setStatus(status.state, status.message);
  }
  function invalidateUnavailable(message) {
    // A current load or mutation failure makes every dependent response
    // unusable. In particular, a preview that began while the failed request
    // was pending must never remount data after this fail-closed clear.
    generation += 1;
    previewGeneration += 1;
    actionGeneration += 1;
    actionPending = false;
    pendingAction = null;
    clearSensitive();
    setStatus('unavailable', message);
  }
  function errorStatus(error, context) {
    if (error && error.status === 409) return {
      state: 'conflict',
      message: context === 'preview'
        ? 'Automation records changed while this preview was prepared. No saved data is shown; refresh and review the latest exact records.'
        : 'Automation records changed while loading. No saved data is shown; refresh to review the latest exact records.',
    };
    if (context === 'preview' && error && (error.status === 400 || error.status === 422)) return {
      state: 'validation',
      message: 'The setup needs review. The prior preview was cleared and nothing was saved or activated.',
    };
    return {
      state: 'unavailable',
      message: context === 'preview'
        ? 'The setup preview is unavailable. The prior preview was cleared and nothing was saved or activated.'
        : 'Automation records are unavailable. No saved data is shown.',
    };
  }
  function definition(list, label, value) {
    var group = node('div');
    group.appendChild(node('dt', '', label));
    group.appendChild(node('dd', '', value));
    list.appendChild(group);
  }
  function listCard(title, description, metadata) {
    var card = node('article', 'automation-list-card');
    card.appendChild(node('h3', '', title));
    if (description) card.appendChild(node('p', '', description));
    if (metadata && metadata.length) {
      var meta = node('div', 'automation-list-meta');
      metadata.forEach(function (item) { meta.appendChild(node('span', '', item)); });
      card.appendChild(meta);
    }
    return card;
  }
  function populateSelect(id, values) {
    var select = element(id);
    select.replaceChildren();
    Object.keys(values).forEach(function (value) {
      var option = node('option', '', values[value]); option.value = value; select.appendChild(option);
    });
  }
  function setupForm() {
    populateSelect('setupSource', contract.SOURCE_LABELS);
    populateSelect('setupAction', contract.ACTION_LABELS);
    populateSelect('setupRecipient', contract.RECIPIENT_LABELS);
    populateSelect('setupChannel', contract.CHANNEL_LABELS);
    populateSelect('setupTiming', contract.TIMING_LABELS);
  }
  function bindButtonActivation(button, activate) {
    // Keep the semantic click path for keyboards and assistive technology, and
    // also accept the completed primary pointer/touch gesture itself. WebKit
    // can omit the synthesized follow-on click after a genuine release. The
    // per-gesture flags ensure a pointer/touch release plus click invokes the
    // bounded action once, never twice.
    var directStarted = false;
    var directHandled = false;
    var activeFamily = null;
    var activePointerId = null;
    var activeTouchId = null;
    var guarded = false;
    function family(event) { return event && event.type.indexOf('touch') === 0 ? 'touch' : 'pointer'; }
    function primary(event) {
      return (!event || event.isPrimary !== false) &&
        (!event || typeof event.button !== 'number' || event.button === 0);
    }
    function touchFrom(event) {
      var list = event && (event.changedTouches || event.touches);
      return list && list.length ? list[0] : null;
    }
    function sameGesture(event) {
      if (family(event) !== activeFamily) return false;
      if (activeFamily === 'touch') {
        var touch = touchFrom(event);
        return Boolean(touch) && touch.identifier === activeTouchId;
      }
      return event.pointerId === activePointerId;
    }
    function releaseTarget(event) {
      var touch = touchFrom(event);
      var x = touch ? touch.clientX : event.clientX;
      var y = touch ? touch.clientY : event.clientY;
      if (typeof x !== 'number' || typeof y !== 'number' ||
          typeof document.elementFromPoint !== 'function') return event.target;
      return document.elementFromPoint(x, y);
    }
    function releaseInside(event) {
      var target = releaseTarget(event);
      return Boolean(target) && (target === button || button.contains(target));
    }
    function clearGuards() {
      if (!guarded) return;
      guarded = false;
      document.removeEventListener('pointerdown', guardStart, true);
      document.removeEventListener('pointerup', guardEnd, true);
      document.removeEventListener('pointercancel', guardCancel, true);
      document.removeEventListener('touchstart', guardStart, true);
      document.removeEventListener('touchend', guardEnd, true);
      document.removeEventListener('touchcancel', guardCancel, true);
    }
    function cancel() {
      clearGuards();
      directStarted = false;
      directHandled = false;
      activeFamily = null;
      activePointerId = null;
      activeTouchId = null;
    }
    function guardStart(event) {
      if (event.target !== button && !button.contains(event.target)) cancel();
    }
    function guardEnd(event) {
      if (sameGesture(event) && !releaseInside(event)) cancel();
    }
    function guardCancel(event) {
      if (sameGesture(event)) cancel();
    }
    function installGuards() {
      if (guarded) return;
      guarded = true;
      document.addEventListener('pointerdown', guardStart, true);
      document.addEventListener('pointerup', guardEnd, true);
      document.addEventListener('pointercancel', guardCancel, true);
      document.addEventListener('touchstart', guardStart, true);
      document.addEventListener('touchend', guardEnd, true);
      document.addEventListener('touchcancel', guardCancel, true);
    }
    function start(event) {
      if (!primary(event)) return;
      cancel();
      directStarted = true;
      directHandled = false;
      activeFamily = family(event);
      if (activeFamily === 'touch') {
        var touch = touchFrom(event);
        activeTouchId = touch ? touch.identifier : null;
      } else activePointerId = event.pointerId;
      installGuards();
    }
    function finish(event) {
      if (!directStarted || directHandled || button.disabled || !primary(event) ||
          !sameGesture(event) || !releaseInside(event)) return;
      directHandled = true;
      clearGuards();
      activate(event);
    }
    button.addEventListener('pointerdown', start);
    button.addEventListener('pointerup', finish);
    button.addEventListener('pointercancel', cancel);
    button.addEventListener('touchstart', start, { passive: true });
    button.addEventListener('touchend', finish, { passive: true });
    button.addEventListener('touchcancel', cancel, { passive: true });
    button.addEventListener('click', function (event) {
      // A real compatibility click has a non-zero detail. Keyboard and
      // assistive-technology clicks use detail 0 and must remain available
      // even when WebKit omitted the prior gesture's compatibility click.
      if (directHandled && event.detail !== 0) { cancel(); return; }
      cancel();
      if (!button.disabled) activate(event);
    });
  }
  function previewInput(template) {
    return {
      templateId: template ? template.id : element('setupTemplateId').value,
      name: template ? template.name : element('setupName').value,
      sourceClassId: template ? template.sourceClassId : element('setupSource').value,
      actionFamily: template ? template.actionFamily : element('setupAction').value,
      recipientClass: template ? template.recipientClass : element('setupRecipient').value,
      channelId: template ? template.channelId : element('setupChannel').value,
      timing: template ? template.timing : element('setupTiming').value,
      dailyLimit: template ? 1 : Number(element('setupDailyLimit').value),
    };
  }
  function renderPreview(preview) {
    element('previewSummary').textContent = preview.summary;
    var details = element('previewDetails'); details.replaceChildren();
    [['Source', preview.source], ['Work', preview.action], ['For', preview.recipient], ['Channel', preview.channel],
      ['Timing', preview.timing], ['Limit', preview.limit]].forEach(function (item) { definition(details, item[0], item[1]); });
    var stops = element('previewStops'); stops.replaceChildren();
    preview.stopConditions.forEach(function (condition) { stops.appendChild(node('li', '', condition)); });
    element('previewBoundary').textContent = preview.approval + ' This preview is not saved or active and created no recipient, provider, financial, or money effect.';
    element('automationPreview').hidden = false;
    element('automationPreview').focus();
  }
  function requestPreview(input, button) {
    var request = ++previewGeneration;
    button.disabled = true;
    clearPreview();
    setStatus('loading', 'Preparing a no-effect preview.');
    return session.json('/api/v1/automation-center/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
    }).then(function (body) {
      if (request !== previewGeneration) return;
      if (!body || body.success !== true || !body.data || body.data.previewOnly !== true || body.data.saved !== false ||
          body.data.activated !== false || body.data.recipientContacted !== false || body.data.externalEffectCreated !== false ||
          body.data.moneyEffectCreated !== false) throw new Error('The no-effect preview could not be confirmed.');
      renderPreview(body.data);
      setStatus('ready', 'Preview ready. Nothing was saved, activated, queued, sent, or charged.');
    }).catch(function (error) {
      // Authorization loss invalidates every in-flight snapshot and preview,
      // even when a newer request made this response stale. A newer request
      // must not keep prior-session or prior-tenant data mounted indefinitely.
      if (isAuthorityFailure(error)) {
        invalidateAuthority(error);
        return;
      }
      // A conflict proves that the mounted snapshot/preview authority is no
      // longer current. It must clear all prior data and invalidate both
      // request classes even when a newer request made this response stale.
      // A later mounted response does not prove when an otherwise unbound
      // conflict occurred on the server. Without exact ordering evidence the
      // mounted workspace is unavailable and must clear conservatively.
      if (error && error.status === 409) {
        invalidateConflict('preview');
        return;
      }
      if (request !== previewGeneration) return;
      clearPreview();
      var status = errorStatus(error, 'preview');
      setStatus(status.state, status.message);
    }).finally(function () { button.disabled = false; });
  }
  function renderTemplates(templates) {
    var target = element('automationTemplates'); target.replaceChildren();
    templates.forEach(function (template) {
      var card = node('article', 'automation-template');
      card.appendChild(node('h3', '', template.name));
      card.appendChild(node('p', '', template.description));
      var button = node('button', 'btn btn-secondary', 'Preview this setup'); button.type = 'button';
      bindButtonActivation(button, function () { requestPreview(previewInput(template), button); });
      card.appendChild(button); target.appendChild(card);
    });
  }
  function renderSummary(data) {
    element('summaryStatus').textContent = data.status.label;
    element('summaryExplanation').textContent = data.status.explanation;
    element('summaryPolicies').textContent = String(data.counts.policies);
    element('summaryPolicyDetail').textContent = data.counts.activePolicies + ' recorded active · ' +
      data.counts.pausedPolicies + ' paused · ' + data.counts.unavailablePolicies + ' status unavailable';
    var states = data.counts.runStates;
    var attention = states.approval + states.uncertain + states.failed + states.stale + states.unavailable;
    element('summaryRuns').textContent = String(data.counts.runs);
    element('summaryRunDetail').textContent = states.queued + ' recorded queued · ' + states.in_flight +
      ' in progress · ' + attention + ' need review · ' + states.completed + ' completed internal';
    element('summaryAttention').textContent = data.counts.approvals === null || data.counts.ownerWork === null
      ? 'Unavailable'
      : String(data.counts.approvals + data.counts.ownerWork);
    element('automationSummary').hidden = false;
  }
  function renderApprovals(data) {
    element('approvalCount').textContent = data.counts.approvals === null ? 'Unavailable' : String(data.counts.approvals);
    var target = element('automationApprovals'); target.replaceChildren();
    if (data.approvals === null) {
      empty(target, 'Pending approval inbox status is unavailable. Approval requests may exist; this view does not claim there are none.');
    }
  }
  function renderOwnerWork(data) {
    element('ownerWorkCount').textContent = data.counts.ownerWork === null ? 'Unavailable' : String(data.counts.ownerWork);
    var target = element('automationOwnerWork'); target.replaceChildren();
    if (!data.ownerWork.length) {
      empty(target, 'Current owner-work status is unavailable. No historical task evidence is shown in this bounded view.');
      return;
    }
    data.ownerWork.forEach(function (item) {
      target.appendChild(listCard(item.label, item.statusLabel, [formatDate(item.recordedAt)]));
    });
  }
  function renderRuns(data) {
    var buckets = {
      waiting: element('waitingRuns'),
      progress: element('inFlightRuns'),
      attention: element('attentionRuns'),
      stopped: element('stoppedRuns'),
      finished: element('finishedRuns'),
    };
    var groups = {
      validation: 'waiting', approval: 'waiting', queued: 'waiting',
      in_flight: 'progress', recovery: 'progress',
      uncertain: 'attention', failed: 'attention', stale: 'attention', unavailable: 'attention',
      suppressed: 'stopped', paused: 'stopped', stopped: 'stopped', expired: 'stopped',
      completed: 'finished', corrected: 'finished',
    };
    Object.keys(buckets).forEach(function (key) { buckets[key].replaceChildren(); });
    data.runs.forEach(function (run) {
      var bucket = buckets[groups[run.state]] || buckets.attention;
      bucket.appendChild(listCard(run.stateLabel, run.stateExplanation,
        [run.latestEvent, run.evidenceState, formatDate(run.recordedAt)]));
    });
    Object.keys(buckets).forEach(function (key) {
      if (!buckets[key].childNodes.length) empty(buckets[key], 'No recorded run evidence in this group.');
    });
    var policies = element('automationPolicies'); policies.replaceChildren();
    if (!data.policies.length) { empty(policies, 'No policies are recorded. Preview a setup above.'); return; }
    data.policies.forEach(function (policy) {
      policies.appendChild(listCard(policy.name, policy.source + ' · ' + policy.action,
        [policy.stateLabel, policy.channel, policy.expiresAt ? 'Expires ' + formatDate(policy.expiresAt) : 'Expiry unavailable']));
    });
  }
  function renderTimeline(data) {
    var target = element('automationTimeline'); target.replaceChildren();
    if (!data.timeline.length) { var item = node('li'); item.appendChild(node('strong', '', 'No customer or document automation history is recorded.')); target.appendChild(item); return; }
    data.timeline.forEach(function (event) {
      var item = node('li'); item.appendChild(node('strong', '', event.label));
      item.appendChild(node('span', '', event.evidenceState + ' · ' + formatDate(event.recordedAt))); target.appendChild(item);
    });
  }
  function renderLimits(data) {
    element('limitsState').textContent = data.limits.label;
    element('limitsConsumption').textContent = data.limits.currentConsumptionLabel;
    var target = element('automationLimits'); target.replaceChildren();
    data.limits.boundaries.forEach(function (boundary) { target.appendChild(node('li', '', boundary)); });
  }
  function renderChannels(data) {
    var target = element('automationChannels'); target.replaceChildren();
    data.channels.forEach(function (channel) {
      target.appendChild(listCard(channel.label, channel.status, [channel.providerMode, channel.evidence]));
    });
  }
  function renderStop(data) {
    element('stopState').textContent = data.stopControl.label;
    element('stopExplanation').textContent = data.stopControl.explanation;
  }
  function renderEvidence(data) {
    var target = element('automationUnavailable'); target.replaceChildren();
    data.unavailableEvidence.forEach(function (item) { target.appendChild(node('li', '', item)); });
    element('automationEvaluatedAt').textContent = 'Checked ' + formatDate(data.evaluatedAt) + '.';
  }
  function validateDemo(meta) {
    var zero = meta && meta.zeroEffects;
    var actions = meta && meta.allowedActions;
    var parsedTime = meta && typeof meta.virtualNow === 'string' ? new Date(meta.virtualNow) : null;
    if (!meta || meta.contract !== 'mission28.part14c.isolated-automation-demo.v1' ||
        !Number.isSafeInteger(meta.generation) || meta.generation < 1 ||
        !Number.isSafeInteger(meta.workspaceRevision) || meta.workspaceRevision < 1 ||
        !Number.isSafeInteger(meta.sourceVersion) || meta.sourceVersion < 1 ||
        !Number.isSafeInteger(meta.capturedSourceVersion) || meta.capturedSourceVersion < 1 ||
        meta.capturedSourceVersion > meta.sourceVersion ||
        !Number.isSafeInteger(meta.policyVersion) || meta.policyVersion < 1 ||
        !parsedTime || !Number.isFinite(parsedTime.getTime()) || parsedTime.toISOString() !== meta.virtualNow ||
        meta.providerMode !== 'deterministic_local_simulation_no_provider' ||
        meta.disclaimer !== DEMO_DISCLAIMER || !Array.isArray(actions) ||
        new Set(actions).size !== actions.length ||
        actions.indexOf('reset_automation') < 0 ||
        actions.some(function (action) { return DEMO_ACTIONS.indexOf(action) < 0; }) || !zero ||
        Object.keys(zero).sort().join(',') !== 'external,financial,money,providerCalls,recipients' ||
        ['recipients', 'providerCalls', 'external', 'financial', 'money'].some(function (key) { return zero[key] !== 0; })) {
      throw new Error('The isolated automation demo boundary is unavailable.');
    }
    return meta;
  }
  function renderDemo(meta) {
    if (!demoMode) return;
    meta = validateDemo(meta);
    demoRevision = meta.workspaceRevision;
    element('automationDemoGeneration').textContent = 'Demo ' + meta.generation + ' · saved version ' + meta.workspaceRevision;
    element('automationDemoTime').textContent = formatDate(meta.virtualNow);
    element('automationDemoSource').textContent = 'Fictional version ' + meta.sourceVersion +
      (meta.sourceVersion === meta.capturedSourceVersion ? ' · matches this run' : ' · changed since this run began');
    element('automationDemoPolicy').textContent = 'Version ' + meta.policyVersion;
    element('automationDemoProvider').textContent = 'Controlled simulation · no real outside-service calls';
    element('automationDemoBoundary').textContent = meta.disclaimer;
    element('automationDemoStatus').textContent = 'Ready. Everything stays in this fictional demo; no one is contacted and no real account is changed.';
    element('automationDemoControls').hidden = false;
    if (typeof document.querySelectorAll === 'function') {
      var buttons = document.querySelectorAll('[data-automation-demo-action]');
      for (var index = 0; index < buttons.length; index += 1) {
        buttons[index].disabled = meta.allowedActions.indexOf(buttons[index].getAttribute('data-automation-demo-action')) < 0;
      }
    }
  }
  function render(data) {
    renderSummary(data); renderTemplates(data.templates); renderApprovals(data); renderOwnerWork(data);
    renderRuns(data); renderTimeline(data); renderLimits(data); renderChannels(data); renderStop(data); renderEvidence(data);
  }
  function actionKey() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'automation-demo-' + String(Date.now()) + '-' + String(Math.random()).slice(2);
  }
  function demoButtonsDisabled(disabled, keepResetAvailable) {
    if (typeof document.querySelectorAll !== 'function') return;
    var buttons = document.querySelectorAll('[data-automation-demo-action]');
    for (var index = 0; index < buttons.length; index += 1) {
      buttons[index].disabled = disabled && !(keepResetAvailable &&
        buttons[index].getAttribute('data-automation-demo-action') === 'reset_automation');
    }
  }
  function performDemoAction(action) {
    // Reset is the sole command allowed to supersede an older pending demo
    // command. Its generation invalidates that response client-side while the
    // server's exact revision guard still decides which mutation can commit.
    if (!demoMode || !Number.isSafeInteger(demoRevision) ||
        (actionPending && (action !== 'reset_automation' || pendingAction === 'reset_automation'))) {
      return Promise.resolve();
    }
    var request = ++actionGeneration;
    actionPending = true;
    pendingAction = action;
    generation += 1;
    previewGeneration += 1;
    demoButtonsDisabled(true, action !== 'reset_automation');
    clearPreview();
    setStatus('loading', 'Updating the isolated fictional automation state.');
    element('automationDemoStatus').textContent = 'Applying one fictional action safely.';
    var expectedRevision = demoRevision;
    return session.json('/api/v1/automation-center/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': actionKey() },
      body: JSON.stringify({ action: action, expectedRevision: expectedRevision })
    }).then(function (body) {
      if (request !== actionGeneration) return;
      if (!body || body.success !== true || !body.data || !body.demo) throw new Error('The fictional automation update is unavailable.');
      var data = contract.validateSnapshot(body.data);
      var meta = validateDemo(body.demo);
      // A preview may have started while this action was being committed.
      // Its older revision must not reappear after the newer action response.
      previewGeneration += 1;
      clearPreview();
      render(data); renderDemo(meta);
      setStatus('ready', data.status.label + '. ' + data.status.explanation);
      element('automationDemoStatus').textContent = action === 'reset_automation'
        ? 'Automation demo reset. Older pending reads and actions can no longer replace this generation.'
        : 'Fictional action recorded. No one was contacted, no outside service was called, and no real account or money changed.';
    }).catch(function (error) {
      if (isAuthorityFailure(error)) { invalidateAuthority(error); return; }
      // A later mounted action does not prove when an unbound conflict was
      // established on the server. Clear before stale-response suppression so
      // a superseded command cannot leave an obsolete workspace visible.
      if (error && error.status === 409) { invalidateConflict('load'); return; }
      if (request !== actionGeneration) return;
      invalidateUnavailable('The fictional automation action is unavailable. No prior demo state is shown; refresh to continue.');
    }).finally(function () {
      if (request === actionGeneration) {
        actionPending = false;
        pendingAction = null;
      }
    });
  }
  function load() {
    // Do not race a current mutation with a read that may have been taken just
    // before its commit. The action response carries the new exact revision.
    if (demoMode && actionPending) return Promise.resolve();
    var request = ++generation;
    previewGeneration += 1;
    actionGeneration += 1;
    clearSensitive(); setStatus('loading', 'Loading current automation records.');
    return session.json('/api/v1/automation-center').then(function (body) {
      if (request !== generation) return;
      if (!body || body.success !== true) throw new Error('The Automation Center response is unavailable.');
      var data = contract.validateSnapshot(body.data);
      render(data);
      if (demoMode) {
        renderDemo(body.demo);
      }
      var emptySnapshot = data.counts.policies === 0 && data.counts.runs === 0 && data.timeline.length === 0;
      setStatus(emptySnapshot ? 'empty' : 'ready', data.status.label + '. ' + data.status.explanation);
    }).catch(function (error) {
      // A stale GET can still be the request that proves the session or role
      // is no longer authorized. Clear and invalidate both request classes
      // before applying ordinary stale-response suppression.
      if (isAuthorityFailure(error)) {
        invalidateAuthority(error);
        return;
      }
      if (error && error.status === 409) {
        invalidateConflict('load');
        return;
      }
      if (request !== generation) return;
      invalidateUnavailable(errorStatus(error, 'load').message);
    });
  }
  function bind() {
    setupForm();
    element('automationRefresh').addEventListener('click', load);
    element('automationSetupForm').addEventListener('submit', function (event) {
      event.preventDefault(); requestPreview(previewInput(null), element('setupPreview'));
    });
    if (demoMode && typeof document.querySelectorAll === 'function') {
      var buttons = document.querySelectorAll('[data-automation-demo-action]');
      for (var index = 0; index < buttons.length; index += 1) {
        (function (button) {
          bindButtonActivation(button, function () {
            performDemoAction(button.getAttribute('data-automation-demo-action'));
          });
        })(buttons[index]);
      }
    }
    load();
  }

  if (!contract || !session) {
    document.addEventListener('DOMContentLoaded', function () {
      clearSensitive(); setStatus('error', 'Automation Center authority is unavailable. No saved data is shown.');
    });
  } else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})(window);
