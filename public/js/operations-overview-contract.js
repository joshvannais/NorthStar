(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NorthStarOperationsOverview = factory();
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';

  var VERSION = 'm23-part9b-overview-v1';
  var STATES = ['active', 'all', 'completion_pending', 'completed'];
  var LIFECYCLES = ['not_started', 'in_progress', 'paused', 'completion_pending', 'completed', 'reopened', 'cancelled'];
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  var HASH = /^[0-9a-f]{64}$/;
  var INSTANT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$/;
  var DECIMAL = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,6})?$/;

  function invalid() { throw new Error('OPERATIONS_OVERVIEW_INVALID'); }
  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== keys.length || Object.keys(value).some(function(key) { return keys.indexOf(key) === -1; })) invalid();
  }
  function one(value, choices) { if (choices.indexOf(value) === -1) invalid(); }
  function number(value, maximum) {
    if (!Number.isSafeInteger(value) || value < 0 || value > (maximum === undefined ? 1000000000 : maximum)) invalid();
  }
  function text(value, maximum, nullable) {
    if (nullable && value === null) return;
    if (typeof value !== 'string' || value.length === 0 || Array.from(value).length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid();
  }
  function match(value, pattern) { if (typeof value !== 'string' || !pattern.test(value)) invalid(); }
  function instant(value, nullable) {
    if (nullable && value === null) return;
    match(value, INSTANT);
    if (!Number.isFinite(Date.parse(value)) || /T24:|:60(?:\.|Z)/.test(value)) invalid();
  }
  function bool(value) { if (typeof value !== 'boolean') invalid(); }
  function countObject(value, keys) { exact(value, keys); keys.forEach(function(key) { number(value[key]); }); }
  function validateProgress(value) {
    exact(value, ['workKey', 'quantity', 'milestone', 'uncertainty', 'observedAt', 'reviewState']);
    text(value.workKey, 64); instant(value.observedAt);
    one(value.uncertainty, ['measured', 'estimated', 'unknown']);
    one(value.reviewState, ['needs_review', 'owner_confirmed', 'worker_acknowledged', 'disputed']);
    if (value.quantity !== null) {
      exact(value.quantity, ['completed', 'total', 'unit']);
      match(value.quantity.completed, DECIMAL); match(value.quantity.total, DECIMAL);
      one(value.quantity.unit, ['ea', 'm', 'm2', 'm3', 'ft', 'ft2', 'ft3', 'yd3', 'kg', 'lb', 'l', 'gal']);
      if (Number(value.quantity.total) <= 0 || Number(value.quantity.completed) > Number(value.quantity.total)) invalid();
    }
    if (value.milestone !== null) {
      exact(value.milestone, ['key', 'state']); text(value.milestone.key, 64);
      one(value.milestone.state, ['not_started', 'in_progress', 'done', 'unavailable']);
    }
    if (value.quantity === null && value.milestone === null || value.uncertainty === 'unknown' &&
        (value.quantity !== null || value.milestone.state !== 'unavailable')) invalid();
  }
  function validateOwnerDetails(value, record) {
    exact(value, ['progress', 'progressTruncated', 'evidenceCounts', 'operationalCounts', 'pendingProposal']);
    if (!Array.isArray(value.progress) || value.progress.length > 20 || value.progress.length > record.progress.recorded) invalid();
    value.progress.forEach(validateProgress); bool(value.progressTruncated);
    if (value.progressTruncated !== (record.progress.recorded > value.progress.length)) invalid();
    countObject(value.evidenceCounts, ['checklists', 'inspections', 'files', 'notes']);
    countObject(value.operationalCounts, ['laborIntervals', 'materialMovements', 'equipmentEvents']);
    if (value.pendingProposal === null) {
      if (record.approval.state !== 'none') invalid();
    } else {
      exact(value.pendingProposal, ['id', 'revision', 'digest', 'decidedAt', 'expiresAt']);
      match(value.pendingProposal.id, UUID); match(value.pendingProposal.digest, HASH);
      number(value.pendingProposal.revision); if (value.pendingProposal.revision < 1 || record.approval.state === 'none') invalid();
      instant(value.pendingProposal.decidedAt); instant(value.pendingProposal.expiresAt);
    }
  }
  function validateRecord(value, scope) {
    var keys = ['executionId', 'appointmentId', 'title', 'serviceType', 'createdAt', 'updatedAt', 'lifecycleState',
      'schedule', 'assignment', 'progress', 'blockers', 'exceptions', 'approval', 'evidence', 'capacity'];
    exact(value, scope === 'owner_admin' ? keys.concat(['ownerDetails']) : keys);
    match(value.executionId, UUID); match(value.appointmentId, UUID);
    text(value.title, 500); text(value.serviceType, 200, true);
    instant(value.createdAt); instant(value.updatedAt); one(value.lifecycleState, LIFECYCLES);
    exact(value.schedule, ['state', 'start', 'end', 'timeZone']);
    one(value.schedule.state, ['unassigned', 'assigned', 'scheduled', 'dispatched', 'unavailable']);
    instant(value.schedule.start, true); instant(value.schedule.end, true);
    text(value.schedule.timeZone, 100, true);
    if (value.schedule.timeZone !== null) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: value.schedule.timeZone }); } catch (_error) { invalid(); }
    }
    if ((value.schedule.start === null) !== (value.schedule.end === null) ||
        value.schedule.start !== null && Date.parse(value.schedule.start) >= Date.parse(value.schedule.end)) invalid();
    exact(value.assignment, ['kind', 'label', 'current']);
    one(value.assignment.kind, ['worker', 'crew', 'unassigned']); text(value.assignment.label, 250); bool(value.assignment.current);
    countObject(value.progress, ['recorded', 'needsReview', 'uncertain']);
    if (value.progress.needsReview > value.progress.recorded || value.progress.uncertain > value.progress.recorded) invalid();
    countObject(value.blockers, ['open']); countObject(value.exceptions, ['open']);
    exact(value.approval, ['state']); one(value.approval.state, ['none', 'pending', 'expired', 'changed']);
    if ((value.lifecycleState === 'completion_pending') !== (value.approval.state !== 'none')) invalid();
    exact(value.evidence, ['state', 'recorded']); number(value.evidence.recorded);
    one(value.evidence.state, ['not_evaluated', 'ready_for_review', 'changed', 'incomplete']);
    if (value.evidence.state === 'ready_for_review' && (value.approval.state !== 'pending' || !value.assignment.current)) invalid();
    exact(value.capacity, ['status', 'recordedConstraints']); one(value.capacity.status, ['unknown']); number(value.capacity.recordedConstraints);
    if (scope === 'owner_admin') validateOwnerDetails(value.ownerDetails, value);
  }
  function validate(value, options) {
    exact(value, ['version', 'authority', 'readOnly', 'scope', 'evaluatedAt', 'dataDigest', 'filter', 'capacity', 'pagination', 'records']);
    one(value.version, [VERSION]); one(value.authority, [options && options.demo === true ? 'isolated_demo_postgresql' : 'postgresql']); one(value.readOnly, [true]);
    one(value.scope, ['owner_admin', 'dispatcher_coordination']); instant(value.evaluatedAt); match(value.dataDigest, HASH);
    one(value.filter, STATES); exact(value.capacity, ['status']); one(value.capacity.status, ['unknown']);
    var page = value.pagination;
    exact(page, ['limit', 'offset', 'returned', 'total', 'nextCursor']);
    number(page.limit, 100); if (page.limit < 1) invalid();
    number(page.offset); number(page.returned, page.limit); number(page.total);
    if (!Array.isArray(value.records) || value.records.length !== page.returned || page.offset + page.returned > page.total) invalid();
    if (page.nextCursor !== null) {
      text(page.nextCursor, 2048); match(page.nextCursor, /^[A-Za-z0-9_-]+$/);
      if (page.returned === 0 || page.offset + page.returned >= page.total) invalid();
    } else if (page.offset + page.returned !== page.total) invalid();
    var seen = new Set();
    value.records.forEach(function(record) {
      validateRecord(record, value.scope);
      if (value.filter === 'active' && ['completed', 'cancelled'].indexOf(record.lifecycleState) !== -1 ||
          ['completed', 'completion_pending'].indexOf(value.filter) !== -1 && record.lifecycleState !== value.filter) invalid();
      if (seen.has(record.executionId)) invalid();
      seen.add(record.executionId);
    });
    return value;
  }

  return Object.freeze({ VERSION: VERSION, STATES: Object.freeze(STATES), validate: validate });
});
