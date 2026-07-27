/**
 * CanonicalIntelligence - presentation-only access to Mission 19 Part 3 data.
 *
 * Durable business state lives in PostgreSQL. This module keeps only a
 * freshly authorized, in-memory projection. Browser storage is used solely
 * for authentication/session metadata and is never read for business values.
 */
(function (global) {
  'use strict';

  var READ_MODEL_VERSION = 'm19-part3-read-v1';
  var DIGEST = /^[0-9a-f]{64}$/i;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var ALLOWED_SURFACES = {
    'customer-detail': true,
    leads: true,
    communications: true,
    calendar: true,
    'command-center': true,
    polaris: true,
    executive: true,
    estimates: true,
  };
  var state = {
    authorityKey: null,
    generation: 0,
    requestVersions: Object.create(null),
    projections: Object.create(null),
    pending: Object.create(null),
  };

  function safeStorage(storage, key) {
    try { return storage ? storage.getItem(key) : null; } catch (_error) { return null; }
  }

  function randomMetadataId() {
    var bytes = new Uint8Array(16);
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      global.crypto.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    }
    return String(Date.now()) + '-' + String(global.performance && global.performance.now ? global.performance.now() : 0).replace('.', '-');
  }

  function ensureSessionMetadata() {
    var tabPrefix = 'northstar-tab:';
    var tabId = String(global.name || '');
    if (tabId.indexOf(tabPrefix) !== 0) {
      tabId = tabPrefix + randomMetadataId();
      global.name = tabId;
    }
    var owner = safeStorage(global.sessionStorage, 'northstarSessionOwner');
    var sessionId = safeStorage(global.sessionStorage, 'northstarSessionId');
    if (owner !== tabId || !sessionId) {
      sessionId = 'sim_' + randomMetadataId();
      try {
        global.sessionStorage.setItem('northstarSessionOwner', tabId);
        global.sessionStorage.setItem('northstarSessionId', sessionId);
      } catch (_storageError) {}
    }
    global.SIM_SESSION_ID = sessionId;
  }

  function parseUser(value) {
    if (!value) return null;
    try {
      var user = JSON.parse(value);
      return user && typeof user === 'object' ? user : null;
    } catch (_error) {
      return null;
    }
  }

  function authorityContext() {
    var token = safeStorage(global.localStorage, 'token');
    var user = parseUser(safeStorage(global.localStorage, 'user'));
    var sessionId = safeStorage(global.sessionStorage, 'northstarSessionId');
    var userId = user && (user.id || user.userId || user.user_id);
    var organizationId = user && (user.organizationId || user.organization_id || user.orgId || user.org_id);
    return {
      token: token ? String(token) : null,
      userId: userId ? String(userId) : null,
      organizationId: organizationId ? String(organizationId) : null,
      sessionId: sessionId ? String(sessionId) : null,
    };
  }

  function contextKey(context) {
    return JSON.stringify([
      context.token || null,
      context.userId || null,
      context.organizationId || null,
      context.sessionId || null,
    ]);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return value;
  }

  function emit(name, detail) {
    try {
      if (global.EventBus && typeof global.EventBus.emit === 'function') {
        global.EventBus.emit(name, detail);
      }
    } catch (_eventBusError) {}
    try {
      global.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (_customEventError) {}
  }

  function setDocumentState(status, projection) {
    if (!global.document || !global.document.documentElement) return;
    var root = global.document.documentElement;
    root.dataset.canonicalAuthority = status;
    if (!projection) {
      delete root.dataset.canonicalDigest;
      delete root.dataset.canonicalVersion;
      delete root.dataset.canonicalGraphId;
      var old = global.document.getElementById('northstarCanonicalProjection');
      if (old) old.remove();
      return;
    }
    root.dataset.canonicalDigest = projection.digest;
    root.dataset.canonicalVersion = projection.readModelVersion;
    root.dataset.canonicalGraphId = projection.items.length ? projection.items[0].ids.graph : '';
    var marker = global.document.getElementById('northstarCanonicalProjection');
    if (!marker) {
      marker = global.document.createElement('script');
      marker.id = 'northstarCanonicalProjection';
      marker.type = 'application/json';
      marker.setAttribute('data-authority', 'server');
      (global.document.head || global.document.documentElement).appendChild(marker);
    }
    marker.textContent = JSON.stringify(presentation(projection));
  }

  function clear(reason) {
    state.generation += 1;
    state.requestVersions = Object.create(null);
    state.projections = Object.create(null);
    state.pending = Object.create(null);
    state.authorityKey = contextKey(authorityContext());
    setDocumentState('rejected', null);
    emit('canonical:rejected', { reason: reason || 'authority-cleared' });
  }

  function synchronizeAuthority() {
    var key = contextKey(authorityContext());
    if (state.authorityKey === null) {
      state.authorityKey = key;
    } else if (state.authorityKey !== key) {
      clear('authority-rotated');
    }
    return authorityContext();
  }

  function validateAuthority(authority, context) {
    if (!authority || typeof authority !== 'object') throw new Error('Canonical response has no authority attestation.');
    if (!authority.organizationId || !authority.userId || !authority.sessionId) {
      throw new Error('Canonical response authority is incomplete.');
    }
    if (String(authority.userId) !== context.userId) throw new Error('Canonical response user does not match the active user.');
    if (context.organizationId && String(authority.organizationId) !== context.organizationId) {
      throw new Error('Canonical response organization does not match the active organization.');
    }
    if (context.sessionId && String(authority.sessionId) !== context.sessionId) {
      throw new Error('Canonical response session does not match the active session.');
    }
  }

  function validateItem(item) {
    if (!item || typeof item !== 'object' || !item.ids || typeof item.ids !== 'object') {
      throw new Error('Canonical item is malformed.');
    }
    if (!UUID.test(String(item.ids.graph || ''))) throw new Error('Canonical graph ID is malformed.');
    if (!item.calculationVersion || !DIGEST.test(String(item.snapshotDigest || '')) ||
        !DIGEST.test(String(item.projectionDigest || '')) || !item.values || typeof item.values !== 'object' || Array.isArray(item.values)) {
      throw new Error('Canonical snapshot metadata is malformed.');
    }
    return clone(item);
  }

  function validateProjection(surface, data, context) {
    if (!data || typeof data !== 'object' || data.surface !== surface) throw new Error('Canonical surface does not match the request.');
    if (data.readModelVersion !== READ_MODEL_VERSION || !DIGEST.test(String(data.digest || '')) || !Array.isArray(data.items)) {
      throw new Error('Canonical projection envelope is malformed.');
    }
    validateAuthority(data.authority, context);
    var byGraph = Object.create(null);
    var order = [];
    data.items.forEach(function (candidate) {
      var item = validateItem(candidate);
      var graphId = String(item.ids.graph);
      if (!Object.prototype.hasOwnProperty.call(byGraph, graphId)) order.push(graphId);
      // A server-returned record replaces any prior duplicate. Browser or
      // storage records are never considered candidates.
      byGraph[graphId] = item;
    });
    var projection = clone(data);
    projection.items = order.map(function (graphId) { return byGraph[graphId]; });
    if (Array.isArray(data.records)) projection.records = clone(data.records);
    if (data.metrics && typeof data.metrics === 'object') projection.metrics = clone(data.metrics);
    return deepFreeze(projection);
  }

  function queryString(filters) {
    if (!filters || typeof filters !== 'object') return '';
    var pairs = [];
    ['limit', 'status', 'customerId'].forEach(function (key) {
      if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
        pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(filters[key])));
      }
    });
    return pairs.length ? '?' + pairs.join('&') : '';
  }

  function request(surface, compatibility, filters) {
    if (!ALLOWED_SURFACES[surface]) return Promise.reject(new Error('Unsupported canonical surface.'));
    var context = synchronizeAuthority();
    if (!context.token || !context.userId) {
      clear('authentication-required');
      return Promise.reject(new Error('A current authenticated user is required.'));
    }
    var initialKey = contextKey(context);
    var generation = state.generation;
    var suffix = queryString(filters);
    var requestKey = (compatibility ? 'compat:' : 'surface:') + surface + suffix;
    if (state.pending[requestKey]) return state.pending[requestKey];
    var version = (state.requestVersions[requestKey] || 0) + 1;
    state.requestVersions[requestKey] = version;
    var headers = { Authorization: 'Bearer ' + context.token, Accept: 'application/json' };
    if (context.sessionId) headers['X-NorthStar-Session-ID'] = context.sessionId;
    var prefix = compatibility ? '/api/v1/canonical/compat/' : '/api/v1/canonical/surfaces/';
    var pending = global.fetch(prefix + encodeURIComponent(surface) + suffix, {
      method: 'GET',
      headers: headers,
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(function (response) {
      if (!response.ok) throw new Error('Canonical request rejected with HTTP ' + response.status + '.');
      return response.json();
    }).then(function (body) {
      if (!body || body.success !== true) throw new Error('Canonical request was rejected.');
      var current = synchronizeAuthority();
      if (generation !== state.generation || initialKey !== contextKey(current) || state.requestVersions[requestKey] !== version) {
        throw new Error('Stale canonical response rejected.');
      }
      var projection = validateProjection(surface, body.data, current);
      state.projections[requestKey] = projection;
      state.projections[surface] = projection;
      state.authorityKey = initialKey;
      setDocumentState('server', projection);
      emit('canonical:loaded', {
        from: 'server',
        surface: surface,
        compatibility: compatibility,
        digest: projection.digest,
        readModelVersion: projection.readModelVersion,
        authority: projection.authority,
      });
      return projection;
    }).catch(function (error) {
      clear(error && error.message ? error.message : 'canonical-request-failed');
      throw error;
    }).finally(function () {
      if (state.pending[requestKey] === pending) delete state.pending[requestKey];
    });
    state.pending[requestKey] = pending;
    return pending;
  }

  function loadSurface(surface, filters) { return request(surface, false, filters); }
  function loadCompatibility(surface, filters) { return request(surface, true, filters); }

  function getProjection(surface) {
    synchronizeAuthority();
    return state.projections[surface] || null;
  }

  function presentation(projectionOrSurface) {
    var projection = typeof projectionOrSurface === 'string' ? getProjection(projectionOrSurface) : projectionOrSurface;
    if (!projection) return null;
    var item = projection.items && projection.items.length ? projection.items[0] : null;
    var values = item ? item.values : null;
    return deepFreeze({
      surface: projection.surface,
      authority: projection.authority,
      readModelVersion: projection.readModelVersion,
      digest: projection.digest,
      ids: item ? item.ids : null,
      calculationVersion: item ? item.calculationVersion : null,
      snapshotDigest: item ? item.snapshotDigest : null,
      price: values ? values.customerFacingPrice : null,
      tax: values ? {
        ratePercent: values.taxRatePercent,
        amount: values.tax,
        totalIncludingTax: values.totalIncludingTax,
        disposition: values.taxDisposition,
      } : null,
      scope: values && values.service ? values.service.scope : null,
      labor: values ? { charge: values.laborCharge, hours: values.laborHours, knownInternalCost: values.knownInternalLaborCost } : null,
      duration: values ? { callSeconds: values.callDurationSeconds, productionHours: values.estimatedProductionDurationHours } : null,
      travel: values ? values.travel : null,
      profit: values ? { gross: values.grossProfit, grossMarginPercent: values.grossMarginPercent, net: values.netProfit, netMarginPercent: values.netMarginPercent } : null,
      confidence: values ? values.confidence : null,
      risk: values ? values.risk : null,
      recommendations: values ? values.recommendedActions : null,
      notCalculated: values ? values.notCalculated : null,
      values: values,
      metrics: projection.metrics || null,
    });
  }

  function declaredSurfaces() {
    if (!global.document) return [];
    var meta = global.document.querySelector('meta[name="northstar-canonical-surfaces"]');
    var declared = meta ? meta.getAttribute('content') : '';
    return String(declared || '').split(/[\s,]+/).filter(function (surface) { return ALLOWED_SURFACES[surface]; });
  }

  function loadDeclared() {
    var surfaces = declaredSurfaces();
    return Promise.all(surfaces.map(function (surface) { return loadCompatibility(surface); }));
  }

  ensureSessionMetadata();

  global.addEventListener('storage', function (event) {
    if (event.key === 'token' || event.key === 'user' || event.key === 'northstarSessionId' || event.key === null) {
      synchronizeAuthority();
    }
  });
  global.addEventListener('pageshow', synchronizeAuthority);
  global.addEventListener('popstate', synchronizeAuthority);
  global.setInterval(function () {
    if (Object.keys(state.projections).length) synchronizeAuthority();
  }, 250);
  if (global.document) {
    global.document.addEventListener('visibilitychange', function () {
      if (!global.document.hidden) synchronizeAuthority();
    });
  }

  global.CanonicalIntelligence = Object.freeze({
    READ_MODEL_VERSION: READ_MODEL_VERSION,
    clear: clear,
    synchronizeAuthority: synchronizeAuthority,
    loadSurface: loadSurface,
    loadCompatibility: loadCompatibility,
    loadDeclared: loadDeclared,
    getProjection: getProjection,
    getPresentation: presentation,
  });

  function autoLoad() {
    if (declaredSurfaces().length) loadDeclared().catch(function () {});
  }
  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', autoLoad);
  } else {
    autoLoad();
  }
})(window);
