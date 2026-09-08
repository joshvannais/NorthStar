(function(global) {
  'use strict';

  var contract = global.NorthStarOperationsOverview;
  var generation = 0;
  var activeRequest = null;
  var currentData = null;
  var cursor = null;
  var previousCursors = [];
  var selectedState = 'active';
  var LIFECYCLE = { not_started: 'Not started', in_progress: 'In progress', paused: 'Paused',
    completion_pending: 'Completion pending', completed: 'Completed', reopened: 'Reopened', cancelled: 'Cancelled' };
  var READINESS = { not_evaluated: 'Not evaluated', ready_for_review: 'Ready for review', changed: 'Evidence changed', incomplete: 'Review required' };
  var APPROVAL = { none: 'No pending proposal', pending: 'Pending owner review', expired: 'Proposal expired', changed: 'Proposal needs refresh' };
  var COPY = {
    loading: 'Loading the current operational view.',
    empty: 'No recorded executions match this work state.',
    restricted: 'This operational view is not available for your current account or role. No records are shown.',
    stale: 'Operational records changed. Refresh the overview before continuing.',
    retry: 'The operational overview is temporarily unavailable. Refresh to try again.',
    offline: 'The connection could not be confirmed. No saved operational records are shown. Reconnect and refresh.',
    suspended: 'The view was paused. Refresh to load current operational records.',
  };

  function element(id) { return document.getElementById(id); }
  function node(tag, className, text) {
    var value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function status(state, message) {
    var target = element('operationsStatus');
    target.dataset.state = state;
    target.textContent = message || COPY[state];
    element('operationsRecords').setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
  }
  function clear() {
    currentData = null;
    element('operationsRecords').replaceChildren();
    element('operationsSummary').hidden = true;
    element('operationsNext').disabled = true;
    element('operationsPrevious').disabled = true;
    element('operationsPageDescription').textContent = 'No page loaded.';
    element('operationsScope').textContent = 'No authorized operational view loaded.';
    element('operationsSnapshot').textContent = 'No operational records loaded.';
  }
  function date(value, timeZone) {
    if (value === null) return 'Not recorded';
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: timeZone || 'UTC', timeZoneName: 'short' }).format(new Date(value));
  }
  function metric(list, label, value, attribute) {
    var group = node('div');
    group.appendChild(node('dt', '', label));
    var detail = node('dd', '', value);
    if (attribute) detail.setAttribute(attribute, '');
    group.appendChild(detail); list.appendChild(group);
  }
  function ownerDetails(record) {
    var data = record.ownerDetails;
    var details = node('details', 'operations-details');
    details.setAttribute('data-owner-details', '');
    details.appendChild(node('summary', '', 'View recorded details'));
    details.appendChild(node('h3', '', 'Current progress evidence'));
    if (data.progress.length === 0) details.appendChild(node('p', '', 'No current progress facts are recorded.'));
    else {
      var list = node('ul');
      data.progress.forEach(function(item) {
        var parts = [item.workKey];
        if (item.quantity) parts.push(item.quantity.completed + ' of ' + item.quantity.total + ' ' + item.quantity.unit);
        if (item.milestone) parts.push(item.milestone.key + ': ' + item.milestone.state.replace(/_/g, ' '));
        parts.push(item.uncertainty, item.reviewState.replace(/_/g, ' '), date(item.observedAt));
        list.appendChild(node('li', '', parts.join(' · ')));
      });
      details.appendChild(list);
    }
    if (data.progressTruncated) details.appendChild(node('p', '', 'Only the 20 most recent current progress facts are shown. This is not a complete progress record.'));
    details.appendChild(node('h3', '', 'Recorded evidence'));
    var evidence = data.evidenceCounts;
    details.appendChild(node('p', '', evidence.checklists + ' checklists · ' + evidence.inspections + ' inspections · ' +
      evidence.files + ' files · ' + evidence.notes + ' notes. Counts do not establish completion or evidence completeness.'));
    var operational = data.operationalCounts;
    details.appendChild(node('p', '', operational.laborIntervals + ' labor intervals · ' + operational.materialMovements +
      ' material movements · ' + operational.equipmentEvents + ' equipment events. Recorded activity is not a financial result.'));
    if (data.pendingProposal) {
      details.appendChild(node('h3', '', 'Pending completion record'));
      details.appendChild(node('p', '', APPROVAL[record.approval.state] + '. Proposed ' + date(data.pendingProposal.decidedAt) +
        '; expires ' + date(data.pendingProposal.expiresAt) + '.'));
    }
    details.appendChild(node('p', '', 'This overview does not approve, cancel or reopen work. Completion remains an explicit, evidence-pinned decision.'));
    return details;
  }
  function renderRecord(record, scope) {
    var article = node('article', 'operations-record');
    article.dataset.executionId = record.executionId;
    var heading = node('div', 'operations-record-heading');
    var identity = node('div');
    identity.appendChild(node('h2', '', record.title));
    identity.appendChild(node('p', 'operations-record-subtitle',
      (record.serviceType ? record.serviceType + ' · ' : '') + record.assignment.label));
    heading.appendChild(identity);
    var pill = node('span', 'operations-state-pill', LIFECYCLE[record.lifecycleState]);
    pill.dataset.state = record.lifecycleState; heading.appendChild(pill); article.appendChild(heading);
    var metrics = node('dl', 'operations-metrics');
    metric(metrics, 'Recorded schedule', record.schedule.start === null ? 'No current time recorded' :
      date(record.schedule.start, record.schedule.timeZone));
    metric(metrics, 'Assignment authority', record.assignment.current ? 'Current recorded assignment' : 'Assignment changed; review needed');
    metric(metrics, 'Progress facts', record.progress.recorded + ' recorded · ' + record.progress.needsReview + ' need review');
    metric(metrics, 'Open issues', record.blockers.open + ' blockers · ' + record.exceptions.open + ' exceptions');
    metric(metrics, 'Completion review', APPROVAL[record.approval.state]);
    metric(metrics, 'Evidence readiness', READINESS[record.evidence.state], 'data-evidence-state');
    metric(metrics, 'Work constraints', record.capacity.recordedConstraints + ' recorded · capacity unknown');
    metric(metrics, 'Execution last changed', date(record.updatedAt));
    article.appendChild(metrics);
    if (record.progress.uncertain > 0) article.appendChild(node('p', 'operations-coordination-note',
      record.progress.uncertain + ' progress facts are estimated or unknown. No overall percentage is inferred.'));
    if (scope === 'owner_admin') article.appendChild(ownerDetails(record));
    else article.appendChild(node('p', 'operations-coordination-note', 'Coordination summary only. Detailed evidence and owner decisions are not exposed in this view.'));
    return article;
  }
  function render(data) {
    currentData = data;
    element('operationsScope').textContent = data.scope === 'owner_admin' ? 'Owner and admin · tenant-wide operational view' :
      'Dispatcher · limited coordination view';
    element('operationsSnapshot').textContent = 'PostgreSQL snapshot · ' + date(data.evaluatedAt);
    var fragment = document.createDocumentFragment();
    data.records.forEach(function(record) { fragment.appendChild(renderRecord(record, data.scope)); });
    element('operationsRecords').replaceChildren(fragment);
    var page = data.pagination;
    element('operationsShown').textContent = String(page.returned);
    element('operationsPending').textContent = String(data.records.filter(function(record) { return record.approval.state === 'pending'; }).length);
    element('operationsConstraints').textContent = String(data.records.reduce(function(total, record) { return total + record.capacity.recordedConstraints; }, 0));
    element('operationsSummary').hidden = page.total === 0;
    element('operationsPageDescription').textContent = page.total === 0 ? 'No matching recorded executions.' :
      'Showing ' + (page.offset + 1) + '–' + (page.offset + page.returned) + ' of ' + page.total + ' matching recorded executions. Summary counts are for this page.';
    element('operationsNext').disabled = page.nextCursor === null;
    element('operationsPrevious').disabled = previousCursors.length === 0;
    status(page.total === 0 ? 'empty' : 'success', page.total === 0 ? null :
      'Operational view refreshed. ' + page.returned + ' recorded executions shown. No operational state was changed.');
  }
  async function load(nextCursor, action) {
    var expectedSnapshot = currentData;
    var requestGeneration = ++generation;
    if (activeRequest) activeRequest.abort();
    activeRequest = new AbortController();
    var controller = activeRequest;
    var expired = false;
    var timeout = global.setTimeout(function() { expired = true; controller.abort(); }, 10000);
    if (action === 'refresh') { nextCursor = null; cursor = null; previousCursors = []; }
    var previous = cursor;
    var requestedFilter = element('operationsFilter').value;
    if (requestedFilter !== selectedState) { nextCursor = null; cursor = null; previousCursors = []; selectedState = requestedFilter; }
    clear(); status('loading');
    var params = new URLSearchParams({ state: selectedState, limit: '25' });
    if (nextCursor) params.set('cursor', nextCursor);
    try {
      var response = await global.fetch('/api/v1/operational-overview?' + params.toString(), {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (requestGeneration !== generation) return;
      if (!response.ok) {
        var error = new Error('OPERATIONS_READ_FAILED'); error.status = response.status; throw error;
      }
      var receivedLength = response.headers.get('content-length');
      if (receivedLength && Number(receivedLength) > 1024 * 1024) throw new Error('OPERATIONS_RESPONSE_TOO_LARGE');
      var raw = await response.text();
      if (new TextEncoder().encode(raw).length > 1024 * 1024) throw new Error('OPERATIONS_RESPONSE_TOO_LARGE');
      var body = JSON.parse(raw);
      if (body.success !== true || !contract) throw new Error('OPERATIONS_RESPONSE_INVALID');
      var data = contract.validate(body.data);
      if (data.filter !== selectedState || data.pagination.limit !== 25) throw new Error('OPERATIONS_RESPONSE_INVALID');
      if (action !== 'refresh' && expectedSnapshot && (data.dataDigest !== expectedSnapshot.dataDigest ||
          data.scope !== expectedSnapshot.scope || data.evaluatedAt !== expectedSnapshot.evaluatedAt)) {
        var changed = new Error('OPERATIONS_SNAPSHOT_CHANGED'); changed.status = 409; throw changed;
      }
      if (requestGeneration !== generation) return;
      if (action === 'next') previousCursors.push(previous);
      if (action === 'previous') previousCursors.pop();
      cursor = nextCursor || null;
      render(data);
    } catch (error) {
      if (requestGeneration !== generation) return;
      clear(); cursor = null; previousCursors = [];
      if (error.status === 401 || error.status === 403) status('restricted');
      else if (error.status === 409) status('stale');
      else if (error instanceof TypeError && !expired) status('offline');
      else status('retry');
    } finally {
      global.clearTimeout(timeout);
      if (requestGeneration === generation) activeRequest = null;
    }
  }
  function suspend() {
    generation += 1;
    if (activeRequest) activeRequest.abort();
    activeRequest = null; cursor = null; previousCursors = [];
    clear(); status('suspended');
  }
  function init() {
    if (!element('operationsMain')) return;
    element('operationsRefresh').addEventListener('click', function() { load(null, 'refresh'); });
    element('operationsFilter').addEventListener('change', function() { load(null, 'refresh'); });
    element('operationsNext').addEventListener('click', function() {
      if (currentData && currentData.pagination.nextCursor) load(currentData.pagination.nextCursor, 'next');
    });
    element('operationsPrevious').addEventListener('click', function() {
      if (previousCursors.length) load(previousCursors[previousCursors.length - 1], 'previous');
    });
    global.addEventListener('pagehide', suspend);
    global.addEventListener('pageshow', function(event) { if (event.persisted) load(null, 'refresh'); });
    document.addEventListener('visibilitychange', function() { if (document.hidden) suspend(); });
    load(null, 'refresh');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(window);
