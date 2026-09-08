(function(root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorthStarFieldExecutionClient = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var DIGEST = /^[0-9a-f]{64}$/;

  function fail(code) {
    var error = new Error(code);
    error.code = code;
    throw error;
  }

  function uuid(value, code) {
    if (typeof value !== 'string' || !UUID.test(value)) fail(code || 'WORK_ID_INVALID');
    return value.toLowerCase();
  }

  function digest(value, code) {
    if (typeof value !== 'string' || !DIGEST.test(value)) fail(code || 'WORK_DIGEST_INVALID');
    return value;
  }

  function revision(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) fail(code || 'WORK_REVISION_INVALID');
    return value;
  }

  function parseSelector(search) {
    var source = typeof search === 'string' ? search : '';
    var query = new URLSearchParams(source.charAt(0) === '?' ? source.slice(1) : source);
    var allowed = ['appointmentId', 'executionId'];
    var keys = [];
    query.forEach(function(_value, key) { keys.push(key); });
    if (!keys.length || keys.some(function(key) { return allowed.indexOf(key) === -1; }) ||
        keys.some(function(key, index) { return keys.indexOf(key) !== index; }) ||
        query.getAll('appointmentId').length !== 1 || query.getAll('executionId').length > 1) {
      fail('WORK_SELECTOR_INVALID');
    }
    var result = { appointmentId: uuid(query.get('appointmentId'), 'WORK_SELECTOR_INVALID') };
    if (query.has('executionId')) result.executionId = uuid(query.get('executionId'), 'WORK_SELECTOR_INVALID');
    return result;
  }

  function pins(execution, record) {
    if (!execution || !record || !record.authority) fail('WORK_AUTHORITY_INVALID');
    var expected = {
      expectedExecutionRevision: revision(execution.revision, 'WORK_AUTHORITY_INVALID'),
      expectedExecutionDigest: digest(execution.digest, 'WORK_AUTHORITY_INVALID'),
      expectedAssignmentRevision: revision(record.authority.revision, 'WORK_AUTHORITY_INVALID'),
      expectedAssignmentDigest: digest(record.authority.digest, 'WORK_AUTHORITY_INVALID'),
    };
    if (revision(execution.sourceAssignmentRevision, 'WORK_AUTHORITY_INVALID') !== expected.expectedAssignmentRevision ||
        digest(execution.sourceAssignmentDigest, 'WORK_AUTHORITY_INVALID') !== expected.expectedAssignmentDigest) {
      fail('WORK_AUTHORITY_STALE');
    }
    return expected;
  }

  function paths(selector) {
    if (!selector || typeof selector !== 'object') fail('WORK_SELECTOR_INVALID');
    var appointmentId = uuid(selector.appointmentId, 'WORK_SELECTOR_INVALID');
    var result = { initialize: '/api/v1/field-executions/appointments/' + appointmentId };
    if (!selector.executionId) return result;
    var executionId = uuid(selector.executionId, 'WORK_SELECTOR_INVALID');
    var base = '/api/v1/field-executions/' + executionId;
    return Object.freeze({
      initialize: result.initialize,
      execution: base,
      transitions: base + '/transitions',
      labor: base + '/labor',
      laborActions: base + '/labor-actions',
      materials: base + '/materials',
      materialActions: base + '/material-actions',
      evidence: base + '/field-evidence',
      evidenceActions: base + '/field-evidence-actions',
      files: base + '/files',
      progress: base + '/progress',
      progressActions: base + '/progress-actions',
      completion: base + '/completion',
      completionActions: base + '/completion-actions',
      equipment: '/api/equipment/executions/' + executionId,
      equipmentActions: '/api/equipment/executions/' + executionId + '/actions',
      equipmentCatalogue: '/api/equipment/catalogue',
    });
  }

  function idempotencyKey(action, seed) {
    if (typeof action !== 'string' || !/^[a-z0-9_]{1,32}$/.test(action)) fail('WORK_ACTION_INVALID');
    return 'm23-part9a-' + action + '-' + uuid(seed, 'WORK_IDEMPOTENCY_INVALID');
  }

  function cookie(source, name) {
    var prefix = name + '=';
    var parts = String(source || '').split(';');
    for (var index = 0; index < parts.length; index += 1) {
      var part = parts[index].trim();
      if (part.indexOf(prefix) !== 0) continue;
      try { return decodeURIComponent(part.slice(prefix.length)); } catch (_error) { return part.slice(prefix.length); }
    }
    return '';
  }

  return Object.freeze({
    parseSelector: parseSelector,
    pins: pins,
    paths: paths,
    idempotencyKey: idempotencyKey,
    cookie: cookie,
    uuid: uuid,
    digest: digest,
    revision: revision,
  });
});
