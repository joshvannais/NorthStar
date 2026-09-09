(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NorthStarCompletionReview = factory();
})(typeof window === 'undefined' ? globalThis : window, function() {
  'use strict';
  var VERSION = 'm23-part9-owner-completion-v1';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  var HASH = /^[0-9a-f]{64}$/;
  var STATES = ['not_started', 'in_progress', 'paused', 'completion_pending', 'completed', 'reopened', 'cancelled'];
  var KINDS = ['proposal', 'approval', 'withdrawal', 'cancellation', 'reopening', 'resumption', 'correction'];
  var ACTIONS = ['approve_completion', 'cancel_execution', 'reopen_execution', 'resume_reopened', 'correct_completion'];
  var GATES = ['required_checklists', 'required_inspections', 'required_files', 'unresolved_blockers_or_exceptions',
    'progress_review', 'open_labor_timers', 'labor_review', 'material_review', 'equipment_checkout', 'equipment_downtime', 'field_evidence_review'];
  function invalid() { throw new Error('COMPLETION_REVIEW_INVALID'); }
  function exact(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      Object.keys(value).some(function(key) { return keys.indexOf(key) === -1; })) invalid();
  }
  function match(value, pattern) { if (typeof value !== 'string' || !pattern.test(value)) invalid(); }
  function count(value, maximum) { if (!Number.isSafeInteger(value) || value < 0 || value > (maximum || 1000000000)) invalid(); }
  function text(value, maximum, nullable) {
    if (nullable && value === null) return;
    if (typeof value !== 'string' || !value.length || Array.from(value).length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid();
  }
  function instant(value) {
    match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/);
    if (!Number.isFinite(Date.parse(value)) || /T24:|:60(?:\.|Z)/.test(value)) invalid();
  }
  function pin(value) {
    exact(value, ['id', 'revision', 'digest']); match(value.id, UUID); match(value.digest, HASH);
    count(value.revision); if (value.revision < 1) invalid();
  }
  function samePin(a, b) { return Boolean(a && b && a.id === b.id && a.revision === b.revision && a.digest === b.digest); }
  function validate(value) {
    exact(value, ['version', 'authority', 'scopeDigest', 'evaluatedAt', 'title', 'execution', 'proposal', 'history', 'commands', 'readOnlyReason']);
    if (value.version !== VERSION || value.authority !== 'postgresql') invalid();
    match(value.scopeDigest, HASH); instant(value.evaluatedAt); text(value.title, 500);
    if ([null, 'onboarding_incomplete', 'subscription_read_only'].indexOf(value.readOnlyReason) === -1) invalid();
    var execution = value.execution;
    exact(execution, ['id', 'appointmentId', 'lifecycleState', 'revision', 'digest', 'assignment']);
    pin({ id: execution.id, revision: execution.revision, digest: execution.digest }); match(execution.appointmentId, UUID);
    if (STATES.indexOf(execution.lifecycleState) === -1) invalid();
    exact(execution.assignment, ['id', 'revision', 'digest', 'changed']);
    pin({ id: execution.assignment.id, revision: execution.assignment.revision, digest: execution.assignment.digest });
    if (typeof execution.assignment.changed !== 'boolean') invalid();
    exact(value.history, ['records', 'total', 'truncated']); count(value.history.total, 2000);
    if (!Array.isArray(value.history.records) || value.history.records.length > 200 ||
      value.history.records.length > value.history.total || value.history.truncated !== (value.history.total > value.history.records.length)) invalid();
    var records = new Map();
    value.history.records.forEach(function(record) {
      exact(record, ['id', 'revision', 'digest', 'rootId', 'previousRecordId', 'kind', 'subjectKind', 'decidedAt', 'reason', 'note', 'nextAction', 'lifecycleBefore', 'lifecycleAfter']);
      pin({ id: record.id, revision: record.revision, digest: record.digest }); match(record.rootId, UUID);
      if (record.previousRecordId !== null) match(record.previousRecordId, UUID);
      if (records.has(record.id) || KINDS.indexOf(record.kind) === -1 || KINDS.indexOf(record.subjectKind) === -1 ||
        STATES.indexOf(record.lifecycleBefore) === -1 || STATES.indexOf(record.lifecycleAfter) === -1) invalid();
      instant(record.decidedAt); text(record.reason, 1000); text(record.note, 2000, true); text(record.nextAction, 1000, true);
      records.set(record.id, record);
    });
    if (value.proposal !== null) {
      var proposal = value.proposal;
      exact(proposal, ['pin', 'decidedAt', 'expiresAt', 'expired', 'reason', 'gates', 'evidenceCounts']);
      pin(proposal.pin); instant(proposal.decidedAt); instant(proposal.expiresAt); text(proposal.reason, 1000);
      if (typeof proposal.expired !== 'boolean' || execution.lifecycleState !== 'completion_pending' ||
        !Array.isArray(proposal.gates) || proposal.gates.length !== GATES.length) invalid();
      proposal.gates.forEach(function(gate, index) {
        exact(gate, ['code', 'passed', 'count']);
        if (gate.code !== GATES[index] || typeof gate.passed !== 'boolean') invalid();
        if (gate.count !== null) count(gate.count);
      });
      exact(proposal.evidenceCounts, ['checklists', 'inspections', 'files', 'labor', 'materials', 'progress', 'fieldEvidence', 'equipment']);
      Object.keys(proposal.evidenceCounts).forEach(function(key) { count(proposal.evidenceCounts[key]); });
    } else if (execution.lifecycleState === 'completion_pending') invalid();
    if (!Array.isArray(value.commands) || value.commands.length > 204 || value.readOnlyReason !== null && value.commands.length) invalid();
    var commands = new Set();
    value.commands.forEach(function(command) {
      exact(command, ['action', 'target']);
      if (ACTIONS.indexOf(command.action) === -1) invalid();
      if (command.target !== null) pin(command.target);
      var identity = command.action + ':' + (command.target ? command.target.id : '');
      if (commands.has(identity)) invalid(); commands.add(identity);
      if (command.action === 'approve_completion' && (!value.proposal || value.proposal.expired || !samePin(command.target, value.proposal.pin))) invalid();
      if (command.action === 'cancel_execution' && (['completed', 'cancelled'].indexOf(execution.lifecycleState) !== -1 ||
        (value.proposal ? !samePin(command.target, value.proposal.pin) : command.target !== null))) invalid();
      if (command.action === 'reopen_execution' && execution.lifecycleState !== 'completed' ||
        command.action === 'resume_reopened' && execution.lifecycleState !== 'reopened') invalid();
      if (['reopen_execution', 'resume_reopened', 'correct_completion'].indexOf(command.action) !== -1 &&
        (!command.target || !samePin(command.target, records.get(command.target.id)))) invalid();
      if (command.action === 'correct_completion' && (value.history.truncated || value.history.records.some(function(record) { return record.previousRecordId === command.target.id; }))) invalid();
    });
    return value;
  }
  function parseSelector(search) {
    var query = new URLSearchParams(search);
    if (Array.from(query.keys()).length !== 1 || !query.has('executionId')) invalid();
    var value = query.get('executionId'); match(value, UUID); return value;
  }
  function inputText(value, maximum, optional) {
    if (optional && (value === undefined || value === null || value === '')) return null;
    if (typeof value !== 'string') invalid();
    value = value.normalize('NFC').trim(); text(value, maximum);
    if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f<>]|(?:https?:\/\/|www\.)/i.test(value)) invalid();
    return value;
  }
  function actionBody(value, action, targetId, fields) {
    validate(value);
    var command = value.commands.find(function(item) { return item.action === action &&
      (action !== 'correct_completion' || item.target.id === targetId); });
    if (!command || !fields) invalid();
    var execution = value.execution;
    var body = { action: action, expectedExecutionRevision: execution.revision, expectedExecutionDigest: execution.digest,
      expectedAssignmentRevision: execution.assignment.revision, expectedAssignmentDigest: execution.assignment.digest,
      reason: inputText(fields.reason, 1000) };
    var target = command.target && { id: command.target.id, revision: command.target.revision, digest: command.target.digest };
    if (action === 'approve_completion' || action === 'cancel_execution') body.proposal = target;
    else if (action === 'reopen_execution') { body.completion = target; body.nextAction = inputText(fields.nextAction, 1000); }
    else if (action === 'resume_reopened') body.reopening = target;
    else { body.record = target; body.annotation = { note: inputText(fields.note, 2000), nextAction: inputText(fields.nextAction, 1000, true) }; }
    return body;
  }
  return Object.freeze({ VERSION: VERSION, GATES: Object.freeze(GATES), validate: validate, parseSelector: parseSelector, actionBody: actionBody });
});
