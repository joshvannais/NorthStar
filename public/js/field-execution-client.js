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

  async function collectEvidence(firstPage, nextPage, executionId) {
    var snapshot = { data: [], total: null, returned: 0, truncated: true, nextCursor: null, pages: [], complete: false };
    var current = firstPage;
    var ids = new Set();
    var cursors = new Set();
    for (var pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      if (!current || current.success !== true || !Array.isArray(current.data) ||
          !Number.isSafeInteger(current.total) || current.total < 0 ||
          current.returned !== current.data.length || current.returned > 200 ||
          typeof current.truncated !== 'boolean' ||
          (current.truncated ? typeof current.nextCursor !== 'string' || !current.nextCursor || current.nextCursor.length > 8192 : current.nextCursor !== null) ||
          (snapshot.total !== null && snapshot.total !== current.total)) return snapshot;
      snapshot.total = current.total;
      snapshot.truncated = current.truncated;
      snapshot.nextCursor = current.nextCursor;
      snapshot.pages.push({ total: current.total, returned: current.returned,
        truncated: current.truncated, nextCursor: current.nextCursor });
      for (var index = 0; index < current.data.length; index += 1) {
        var record = current.data[index];
        if (!record || !UUID.test(record.id || '') || record.executionId !== executionId || ids.has(record.id)) return snapshot;
        ids.add(record.id);
        snapshot.data.push(record);
      }
      snapshot.returned = snapshot.data.length;
      if (snapshot.returned > snapshot.total || snapshot.returned > 1000) return snapshot;
      if (!current.truncated) {
        snapshot.complete = snapshot.returned === snapshot.total;
        return snapshot;
      }
      if (!current.returned || snapshot.returned >= snapshot.total || snapshot.returned >= 1000 ||
          cursors.has(current.nextCursor) || pageNumber === 9) return snapshot;
      cursors.add(current.nextCursor);
      try { current = await nextPage(current.nextCursor); }
      catch (error) {
        if (error && (error.status === 401 || error.status === 403)) throw error;
        return snapshot;
      }
    }
    return snapshot;
  }

  function completionRequirements(snapshot) {
    if (!snapshot || snapshot.complete !== true || snapshot.truncated !== false || snapshot.nextCursor !== null ||
        !Array.isArray(snapshot.data) || snapshot.data.length !== snapshot.total) fail('WORK_EVIDENCE_INCOMPLETE');
    var records = new Map();
    var superseded = new Set();
    snapshot.data.forEach(function(record) {
      if (!record || !UUID.test(record.id || '') || !UUID.test(record.rootId || '') ||
          !Number.isSafeInteger(record.revision) || record.revision < 1 || !DIGEST.test(record.digest || '') ||
          !record.document || !['checklist', 'checklist_response', 'observation', 'note', 'file'].includes(record.document.kind) ||
          records.has(record.id)) fail('WORK_EVIDENCE_CURRENTNESS_UNAVAILABLE');
      records.set(record.id, record);
    });
    records.forEach(function(record) {
      if (record.previousRecordId === null) {
        if (record.rootId !== record.id || record.revision !== 1) fail('WORK_EVIDENCE_CURRENTNESS_UNAVAILABLE');
      } else {
        var previous = records.get(record.previousRecordId);
        if (!previous || previous.rootId !== record.rootId || previous.revision + 1 !== record.revision ||
            previous.document.kind !== record.document.kind || superseded.has(previous.id)) fail('WORK_EVIDENCE_CURRENTNESS_UNAVAILABLE');
        superseded.add(previous.id);
      }
    });
    var result = { checklists: [], inspections: [], files: [] };
    records.forEach(function(record) {
      if (superseded.has(record.id)) return;
      var kind = record.document.kind;
      var selected = kind === 'checklist' ? result.checklists : kind === 'file' ? result.files :
        kind === 'observation' && record.document.observationClass === 'inspection' ? result.inspections : null;
      if (selected) selected.push({ id: record.id, revision: record.revision, digest: record.digest });
    });
    Object.keys(result).forEach(function(kind) {
      if (result[kind].length > 20) fail('WORK_EVIDENCE_SELECTION_LIMIT');
      result[kind].sort(function(left, right) { return left.id.localeCompare(right.id); });
    });
    return result;
  }

  async function claimTabStorage(context, resume) {
    var metadataKey = 'northstar-work-tab-owner';
    var prefix = 'northstar-work-draft:';
    var stored = '';
    var persistent = true;
    try { stored = context.sessionStorage.getItem(metadataKey) || ''; }
    catch (_error) { persistent = false; }
    var navigation = context.performance && context.performance.getEntriesByType('navigation')[0];
    var restoring = resume === true || navigation && ['reload', 'back_forward'].includes(navigation.type);
    var owner = restoring && UUID.test(stored) ? stored : context.crypto.randomUUID();
    var release = function() {};
    var manager = context.navigator && context.navigator.locks;
    async function acquire(value) {
      if (!manager || typeof manager.request !== 'function') return false;
      return new Promise(function(resolve) {
        try {
          manager.request('northstar-work-tab:' + value, { mode: 'exclusive', ifAvailable: true }, function(lock) {
            if (!lock) { resolve(false); return; }
            return new Promise(function(done) { release = done; resolve(true); });
          }).catch(function() { resolve(false); });
        } catch (_error) { resolve(false); }
      });
    }
    if (!persistent || !await acquire(owner)) {
      owner = context.crypto.randomUUID();
      persistent = persistent && await acquire(owner);
    }
    if (owner !== stored || !persistent) {
      try {
        for (var index = context.sessionStorage.length - 1; index >= 0; index -= 1) {
          var key = context.sessionStorage.key(index);
          if (key && key.indexOf(prefix) === 0) context.sessionStorage.removeItem(key);
        }
      } catch (_error) { persistent = false; }
    }
    try {
      if (persistent) context.sessionStorage.setItem(metadataKey, owner);
      else context.sessionStorage.removeItem(metadataKey);
    } catch (_error) { persistent = false; }
    return { owner: owner, persistent: persistent, release: release };
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
    collectEvidence: collectEvidence,
    completionRequirements: completionRequirements,
    claimTabStorage: claimTabStorage,
  });
});
