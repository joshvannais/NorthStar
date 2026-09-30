(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NorthStarDemandPosition = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var FLAGS = ['sourceCoverageComplete', 'offPlatformCoverageVerified',
    'providerCoverageVerified', 'probabilityCalibrated', 'forecastIssued',
    'paidNumericServing'];
  var COUNT_KEYS = ['approvedUnscheduledCount', 'approvedScheduledCount',
    'workInProgressCount', 'completedCount', 'unresolvedLinkageCount',
    'knownBacklogCount'];
  var DIGEST = /^[0-9a-f]{64}$/;
  var DATABASE_INSTANT = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d:\d\d)$/;
  var HOURS_REASONS = ['approved_person_hour_plan_missing', 'no_active_backlog',
    'unresolved_linkage_present', 'reviewed_person_hour_plan_missing',
    'reviewed_person_hour_plan_not_current', 'source_changed_after_capture'];

  function validInstant(value) {
    var match = typeof value === 'string' ? DATABASE_INSTANT.exec(value) : null;
    if (!match) return false;
    var parts = match.slice(1, 7).map(Number), year = parts[0], month = parts[1], day = parts[2];
    if (year < 1000 || month < 1 || month > 12 || day < 1 ||
        day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
        parts[3] > 23 || parts[4] > 59 || parts[5] > 59) return false;
    if (match[8] !== 'Z') {
      var offset = /([+-])(\d\d):(\d\d)/.exec(match[8]);
      if (!offset || Number(offset[2]) > 23 || Number(offset[3]) > 59) return false;
    }
    return Number.isFinite(Date.parse(value));
  }

  function validSnapshot(value) {
    if (!value || typeof value !== 'object' || !UUID.test(value.id || '') ||
        value.version !== 'm26-current-backlog-position-v1' ||
        value.targetKey !== 'demand.current_backlog_position.v1' ||
        !['descriptive_subset', 'partial', 'unavailable', 'source_stale'].includes(value.state) ||
        value.sourceAuthority !== 'northstar_authenticated_booking_schedule_and_execution_current_position' ||
        value.knownSubsetOnly !== true || FLAGS.some(function (key) { return value[key] !== false; }) ||
        COUNT_KEYS.some(function (key) {
          return !Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 500;
        }) || !['available', 'unavailable'].includes(value.backlogHoursState) ||
        !validInstant(value.capturedAt) || !(value.plannedPersonMinutes === null ||
          /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,6})?$/.test(value.plannedPersonMinutes))) return false;
    if (value.knownBacklogCount !== value.approvedUnscheduledCount +
        value.approvedScheduledCount + value.workInProgressCount) return false;
    var total = value.approvedUnscheduledCount + value.approvedScheduledCount +
      value.workInProgressCount + value.completedCount + value.unresolvedLinkageCount;
    if (value.state === 'source_stale') {
      return value.reason === 'source_changed_after_capture' && value.sourceAuthenticated === false &&
        value.sourceDigest === null && value.snapshotDigest === null &&
        COUNT_KEYS.every(function (key) { return value[key] === 0; }) &&
        value.backlogHoursState === 'unavailable' &&
        value.backlogHoursReason === 'source_changed_after_capture';
    }
    if (value.sourceAuthenticated !== true || !DIGEST.test(value.sourceDigest || '') ||
        !DIGEST.test(value.snapshotDigest || '')) return false;
    if (value.state === 'descriptive_subset' && (value.reason !== null || total < 1 ||
        value.unresolvedLinkageCount !== 0)) return false;
    if (value.state === 'partial' && (value.reason !== 'unresolved_linkage_present' ||
        value.unresolvedLinkageCount < 1 || value.plannedPersonMinutes !== null ||
        value.backlogHoursState !== 'unavailable' ||
        value.backlogHoursReason !== 'unresolved_linkage_present')) return false;
    if (value.state === 'unavailable' &&
        (value.reason !== 'no_authenticated_approved_booking_history' ||
         COUNT_KEYS.some(function (key) { return value[key] !== 0; }))) return false;
    if (value.backlogHoursState === 'available') {
      return value.plannedPersonMinutes !== null && Number(value.plannedPersonMinutes) > 0 &&
        value.backlogHoursReason === null && value.state !== 'source_stale';
    }
    return value.plannedPersonMinutes === null && HOURS_REASONS.includes(value.backlogHoursReason);
  }

  function hours(minutes) {
    var value = Number(minutes) / 60;
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function project(value, fictional) {
    if (!validSnapshot(value)) return null;
    if (value.state === 'source_stale') return {
      kind: 'stale', badge: 'Receipt is stale', title: 'Refresh required',
      explanation: 'The saved source changed after capture. Counts and planned time are withheld.',
      metrics: [], receiptId: value.id, fictional: fictional === true,
    };
    if (value.state === 'unavailable') return {
      kind: 'missing', badge: 'No bounded backlog', title: 'No supported records yet',
      explanation: 'No authenticated approved-booking history is available for this bounded source.',
      metrics: [], receiptId: value.id, fictional: fictional === true,
    };
    var metrics = [
      ['Approved, unscheduled', value.approvedUnscheduledCount],
      ['Approved, scheduled', value.approvedScheduledCount],
      ['Work in progress', value.workInProgressCount],
      ['Known active backlog', value.knownBacklogCount],
    ];
    if (value.backlogHoursState === 'available') {
      metrics.push(['Reviewed planned time', hours(value.plannedPersonMinutes) + ' person-hours']);
    } else {
      metrics.push(['Reviewed planned time', 'Unavailable']);
    }
    var reasons = {
      reviewed_person_hour_plan_missing: 'At least one active booking does not have a reviewed current person plan.',
      reviewed_person_hour_plan_not_current: 'At least one reviewed person plan is no longer current.',
      unresolved_linkage_present: 'At least one booking has unresolved source linkage.',
      approved_person_hour_plan_missing: 'An approved person-hour plan is missing.',
      no_active_backlog: 'There is no active backlog in this bounded source.',
    };
    return {
      kind: value.state === 'partial' ? 'partial' :
        (value.backlogHoursState === 'unavailable' ? 'plan-unavailable' : 'available'),
      badge: fictional === true ? 'Fictional demo' :
        (value.state === 'partial' ? 'Bounded partial fact' :
          (value.backlogHoursState === 'unavailable' ? 'Planned time unavailable' : 'Bounded current fact')),
      title: fictional === true ? 'Example current backlog' : 'Saved current backlog',
      explanation: fictional === true
        ? 'Fictional values illustrate a bounded current-backlog fact and reviewed person plan.'
        : value.backlogHoursState === 'available'
          ? 'Counts and reviewed planned time come from this exact saved receipt.'
        : (reasons[value.backlogHoursReason] || 'Reviewed planned time is unavailable for this receipt.'),
      metrics: metrics, receiptId: value.id, fictional: fictional === true,
    };
  }

  function demoSnapshot() {
    return Object.freeze({
      id: 'de000000-0000-4000-8000-000000000026',
      version: 'm26-current-backlog-position-v1', targetKey: 'demand.current_backlog_position.v1',
      state: 'descriptive_subset', reason: null, capturedAt: '2026-09-30T12:00:00.000000Z',
      approvedUnscheduledCount: 1,
      approvedScheduledCount: 2, workInProgressCount: 1, completedCount: 0,
      unresolvedLinkageCount: 0, knownBacklogCount: 4,
      plannedPersonMinutes: '780.000000', backlogHoursState: 'available',
      backlogHoursReason: null, sourceDigest: 'd'.repeat(64), snapshotDigest: 'e'.repeat(64),
      sourceAuthority: 'northstar_authenticated_booking_schedule_and_execution_current_position',
      sourceAuthenticated: true, knownSubsetOnly: true,
      sourceCoverageComplete: false, offPlatformCoverageVerified: false,
      providerCoverageVerified: false, probabilityCalibrated: false,
      forecastIssued: false, paidNumericServing: false,
    });
  }

  function create(options) {
    var doc = options.document, mode = options.mode === 'demo' ? 'demo' : 'paid';
    var fetcher = options.fetcher, lastOperation = null, pendingCaptureKey = null;
    var operationGeneration = 0, workspaceAvailable = options.workspaceAvailable !== false;
    var current = { kind: 'initial', badge: 'Receipt required',
      title: 'Choose a saved backlog receipt',
      explanation: 'Capture a bounded current fact, or enter an exact saved receipt ID to read it. Nothing is captured on page load.',
      metrics: [] };
    function node(id) { return doc.getElementById(id); }
    function paint(model) {
      current = model;
      node('commandCenterBacklogState').textContent = model.badge;
      node('commandCenterBacklogTitle').textContent = model.title;
      node('commandCenterBacklogExplanation').textContent = model.explanation;
      node('commandCenterBacklogMetrics').replaceChildren();
      model.metrics.forEach(function (metric) {
        var item = doc.createElement('div'), label = doc.createElement('dt'), value = doc.createElement('dd');
        label.textContent = metric[0]; value.textContent = String(metric[1]); item.append(label, value);
        node('commandCenterBacklogMetrics').appendChild(item);
      });
      node('commandCenterBacklogMetrics').hidden = model.metrics.length === 0;
      node('commandCenterBacklogNotice').textContent = model.fictional === true
        ? 'Fictional isolated demo. This example does not read or write a production workspace.'
        : (model.receiptId ? 'Saved receipt ' + model.receiptId +
          '. Known NorthStar subset only; provider and off-platform coverage are not verified.' :
          'Known NorthStar subset only. Complete business and off-platform coverage are not verified; no calibrated forecast was issued.');
      node('commandCenterBacklogRetry').hidden = !['failure', 'busy', 'workspace'].includes(model.kind);
      node('commandCenterBacklogActions').hidden = mode === 'demo';
      var blocked = ['loading', 'workspace', 'restricted'].includes(model.kind);
      node('commandCenterBacklogCapture').disabled = blocked;
      node('commandCenterBacklogRead').disabled = blocked;
      node('commandCenterBacklogReceipt').disabled = blocked;
    }
    function failure(status, category) {
      var model = status === 403 ? { kind: 'restricted', badge: 'Access restricted',
        title: 'Owner or administrator access required',
        explanation: 'Your current workspace role cannot capture or read this private backlog receipt.', metrics: [] } :
        category === 'FORECAST_CURRENT_BACKLOG_OVERSIZED' ? { kind: 'oversized', badge: 'Review limit exceeded',
          title: 'Backlog is too large for this bounded view',
          explanation: 'A supported review or response-size limit was exceeded. No counts or planned time are shown.', metrics: [] } :
          category === 'FORECAST_CURRENT_BACKLOG_BUSY' ? { kind: 'busy', badge: 'Source busy',
            title: 'Current source is changing', explanation: 'Retry the same explicit action shortly. No result is assumed.', metrics: [] } :
            { kind: 'failure', badge: 'Workspace request failed', title: 'Backlog receipt unavailable',
              explanation: 'Retry the same explicit action. No result is assumed.', metrics: [] };
      paint(model);
    }
    function request(operation) {
      if (!workspaceAvailable) return Promise.resolve(null);
      var generation = ++operationGeneration;
      lastOperation = operation;
      paint({ kind: 'loading', badge: 'Loading receipt', title: 'Checking the bounded source',
        explanation: 'Counts remain hidden until the exact guarded response is verified.', metrics: [] });
      var settings = operation.kind === 'capture' ? { method: 'POST', cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          'Idempotency-Key': operation.key }, body: '{}' } : {
        method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' },
      };
      var url = '/api/v1/forecast/current-backlog/snapshots' +
        (operation.kind === 'read' ? '/' + encodeURIComponent(operation.id) : '');
      return fetcher(url, settings).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (body) {
          if (generation !== operationGeneration || !workspaceAvailable) return null;
          if (!response.ok || !body || body.success !== true || !body.data) {
            failure(response.status, body && body.error && body.error.category);
            return null;
          }
          var model = project(body.data, false);
          if (!model) {
            failure(503, 'FORECAST_CURRENT_BACKLOG_UNAVAILABLE');
            return null;
          }
          if (operation.kind === 'capture' && pendingCaptureKey === operation.key) {
            pendingCaptureKey = null;
          }
          node('commandCenterBacklogReceipt').value = body.data.id;
          paint(model);
          return model;
        });
      }).catch(function () {
        if (generation !== operationGeneration || !workspaceAvailable) return null;
        failure(0, 'WORKSPACE_FAILURE');
        return null;
      });
    }
    function capture() {
      if (mode === 'demo' || !workspaceAvailable) return Promise.resolve(null);
      if (!pendingCaptureKey) pendingCaptureKey = options.idempotency();
      return request({ kind: 'capture', key: pendingCaptureKey });
    }
    function read() {
      if (mode === 'demo' || !workspaceAvailable) return Promise.resolve(null);
      var id = String(node('commandCenterBacklogReceipt').value || '').trim().toLowerCase();
      if (!UUID.test(id)) {
        paint({ kind: 'invalid', badge: 'Receipt ID required', title: 'Enter an exact saved receipt ID',
          explanation: 'Use the UUID returned by an explicit backlog capture.', metrics: [] });
        return Promise.resolve(null);
      }
      pendingCaptureKey = null;
      return request({ kind: 'read', id: id });
    }
    function retry() {
      if (current.kind === 'workspace' && options.onWorkspaceRetry) return options.onWorkspaceRetry();
      return lastOperation ? request(lastOperation) : Promise.resolve(null);
    }
    function workspaceUnavailable() {
      workspaceAvailable = false;
      operationGeneration += 1;
      paint({ kind: 'workspace', badge: 'Workspace unavailable', title: 'Backlog view could not load',
        explanation: 'Refresh the workspace before capturing or reading a receipt. No value is shown.', metrics: [] });
    }
    function workspaceReady() {
      workspaceAvailable = true;
      if (current.kind !== 'workspace') return;
      if (mode === 'demo') {
        paint(project(demoSnapshot(), true));
        return;
      }
      if (lastOperation) {
        paint({ kind: 'failure', badge: 'Receipt result unconfirmed',
          title: 'Retry the same explicit receipt action',
          explanation: 'Workspace recovery cannot confirm the earlier result. Retry preserves its exact request identity.',
          metrics: [] });
      } else {
        paint({ kind: 'initial', badge: 'Receipt required',
          title: 'Choose a saved backlog receipt',
          explanation: 'Capture a bounded current fact, or enter an exact saved receipt ID to read it. Nothing is captured on page load.',
          metrics: [] });
      }
    }
    node('commandCenterBacklogCapture').addEventListener('click', capture);
    node('commandCenterBacklogRead').addEventListener('click', read);
    node('commandCenterBacklogRetry').addEventListener('click', retry);
    if (mode === 'demo') paint(project(demoSnapshot(), true));
    else if (!workspaceAvailable) workspaceUnavailable();
    else paint(current);
    return { capture: capture, read: read, retry: retry,
      workspaceUnavailable: workspaceUnavailable, workspaceReady: workspaceReady,
      state: function () { return current; } };
  }

  return Object.freeze({ validSnapshot: validSnapshot, project: project,
    demoSnapshot: demoSnapshot, create: create });
});
