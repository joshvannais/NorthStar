/**
 * AppStore — Centralized application state store
 * Single source of truth for all NorthStar data
 * Communicates via EventBus
 */
window.AppStore = (function() {
  const bus = window.EventBus;
  const state = {
    leads: [],
    customers: [],
    estimates: [],
    appointments: [],
    jobs: [],
    invoices: [],
    transcripts: [],
    polarisInsights: [],
    polarisHistory: [],
    notifications: [],
    settings: { theme: localStorage.getItem('northstar-theme') || 'light' },
    authoritativeSources: {
      leads: { kind: 'loading', status: null }
    },
    ui: {
      selectedLeadId: null,
      drawerOpen: false,
      currentFilters: {},
      currentSearch: '',
      currentSort: '',
      mobileMenuOpen: false
    }
  };
  var leadAuthorization = {
    contextKey: null,
    allowed: false,
    version: 0,
  };
  var serverAuthorizedById = new Map();
  var serverDeniedIds = new Set();
  var runtimeAuthorizedById = new Map();

  function recordId(recordOrId) {
    var value = recordOrId && typeof recordOrId === 'object'
      ? recordOrId.id
      : recordOrId;
    if (value === null || value === undefined || String(value).trim() === '') return null;
    return String(value);
  }

  function isRuntimeAuthorized(record) {
    var id = recordId(record);
    var entry = id ? runtimeAuthorizedById.get(id) : null;
    return Boolean(entry &&
      entry.record === record &&
      entry.contextKey === leadAuthorization.contextKey &&
      entry.version === leadAuthorization.version);
  }

  function clearAuthorizedRecords() {
    serverAuthorizedById = new Map();
    serverDeniedIds = new Set();
    runtimeAuthorizedById = new Map();
  }

  function markRuntimeAuthorized(record) {
    if (!leadAuthorization.allowed ||
        !state.authoritativeSources.leads ||
        state.authoritativeSources.leads.kind !== 'ready' ||
        !hasAuthenticatedRuntimeContext() ||
        !isSimulationLead(record) ||
        leadSessionId(record) !== activeSessionId()) return false;
    var id = recordId(record);
    if (!id || serverAuthorizedById.has(id) || serverDeniedIds.has(id) ||
        runtimeAuthorizedById.has(id)) return false;
    var identity = authenticatedIdentity();
    runtimeAuthorizedById.set(id, {
      record: record,
      contextKey: leadAuthorization.contextKey,
      version: leadAuthorization.version,
      sessionId: activeSessionId(),
      userId: identity.userId,
      organizationId: identity.organizationId,
    });
    return true;
  }

  function visibleAuthorizedRecords() {
    if (!leadAuthorization.allowed) return [];
    var visible = [];
    serverAuthorizedById.forEach(function (record, id) {
      if (!serverDeniedIds.has(id)) visible.push(record);
    });
    runtimeAuthorizedById.forEach(function (entry, id) {
      if (!serverAuthorizedById.has(id) &&
          !serverDeniedIds.has(id) &&
          entry.contextKey === leadAuthorization.contextKey &&
          entry.version === leadAuthorization.version) {
        visible.push(entry.record);
      }
    });
    return visible;
  }

  function recordsConflict(first, second) {
    try {
      return JSON.stringify(first) !== JSON.stringify(second);
    } catch (_error) {
      return true;
    }
  }

  function authorizeServerRecords(records) {
    clearAuthorizedRecords();
    records.forEach(function (record) {
      var id = recordId(record);
      if (!id || serverDeniedIds.has(id)) return;
      if (serverAuthorizedById.has(id)) {
        if (recordsConflict(serverAuthorizedById.get(id), record)) {
          serverAuthorizedById.delete(id);
          serverDeniedIds.add(id);
        }
        return;
      }
      serverAuthorizedById.set(id, record);
    });
  }

  // --- Leads ---
  function addLead(leadData) {
    refreshAuthorizationContext();
    const lead = leadData instanceof window.Models.Lead ? leadData : new window.Models.Lead(leadData);
    var id = recordId(lead);
    if (!id || serverDeniedIds.has(id)) return null;
    if (serverAuthorizedById.has(id)) return serverAuthorizedById.get(id);
    var existing = runtimeAuthorizedById.get(id);
    if (existing) return existing.record;
    if (!markRuntimeAuthorized(lead)) return null;
    state.leads = visibleAuthorizedRecords();
    bus.emit('lead:created', lead);
    bus.emit('store:changed', { type: 'lead', action: 'created', data: lead });
    saveToSession();
    return lead;
  }

  function updateLead(id, updates) {
    const authorized = getLeads().find(function (lead) { return lead.id === id; });
    const idx = state.leads.findIndex(function (lead) { return lead === authorized; });
    if (idx === -1) return null;
    Object.assign(state.leads[idx], updates, { updatedAt: new Date().toISOString() });
    bus.emit('lead:updated', state.leads[idx]);
    bus.emit('store:changed', { type: 'lead', action: 'updated', data: state.leads[idx] });
    saveToSession();
    return state.leads[idx];
  }

  function removeLead(id) {
    const authorized = getLeads().find(function (lead) { return lead.id === id; });
    const idx = state.leads.findIndex(function (lead) { return lead === authorized; });
    if (idx === -1) return;
    const removed = state.leads.splice(idx, 1)[0];
    bus.emit('lead:deleted', removed);
    bus.emit('store:changed', { type: 'lead', action: 'deleted' });
    saveToSession();
  }

  function getLeads(filter) {
    refreshAuthorizationContext();
    if (!leadAuthorization.allowed) return [];
    var visible = visibleAuthorizedRecords();
    if (!filter) return visible;
    return visible.filter(filter);
  }

  function getLead(id) {
    return getLeads().find(l => l.id === id) || null;
  }

  // --- KPIs (computed from leads) ---
  function getKpis() {
    const leads = getLeads();
    const total = leads.length;
    const qualified = leads.filter(l => l.status === 'scheduled' || l.status === 'contacted' || l.status === 'new' || l.status === 'qualified').length;
    const scheduled = leads.filter(l => l.status === 'scheduled').length;
    const won = leads.filter(l => l.status === 'completed' || l.outcome === 'appointment-set').length;
    const pipeline = leads.filter(l => l.status === 'new' || l.status === 'contacted' || l.status === 'qualified').length;
    const revenue = leads.filter(l => l.status === 'completed').reduce((sum, l) => sum + (l.avgPrice || 0), 0);
    const totalValue = leads.reduce((sum, l) => sum + (l.avgPrice || 0), 0);
    const conversionRate = total > 0 ? Math.round((won / total) * 100) : 0;
    const avgLeadValue = total > 0 ? Math.round(totalValue / total) : 0;
    const topOpportunity = leads.reduce((best, l) => (!best || (l.avgPrice || 0) > (best.avgPrice || 0)) ? l : best, null);
    return { total, qualified, scheduled, won, pipeline, revenue, conversionRate, avgLeadValue, topOpportunity };
  }

  // --- Settings ---
  function setSetting(key, value) {
    state.settings[key] = value;
    bus.emit('setting:changed', { key, value });
    if (key === 'theme') localStorage.setItem('northstar-theme', value);
  }

  function getSetting(key) { return state.settings[key]; }

  // --- UI State ---
  function setUi(key, value) { state.ui[key] = value; bus.emit('ui:changed', { key, value }); }
  function getUi(key) { return state.ui[key]; }

  // --- Persistence ---
  function activeSessionId() {
    return (window.NorthStarDemoSession && window.NorthStarDemoSession.id) ||
      window.SIM_SESSION_ID || null;
  }

  function storageValue(key) {
    try { return localStorage.getItem(key) || ''; } catch (_error) { return ''; }
  }

  function authenticatedIdentity() {
    var rawUser = storageValue('user');
    var user = {};
    try { user = rawUser ? JSON.parse(rawUser) : {}; } catch (_error) {}
    return {
      token: storageValue('token') || storageValue('northstar_token'),
      userId: String(user.id || user.userId || ''),
      organizationId: String(
        storageValue('organization') ||
        storageValue('organizationId') ||
        user.organizationId ||
        user.organization_id ||
        ''
      ),
    };
  }

  function hasAuthenticatedRuntimeContext() {
    var identity = authenticatedIdentity();
    return Boolean(activeSessionId() && identity.token &&
      identity.userId && identity.organizationId);
  }

  function authorizationContextKey() {
    return JSON.stringify({
      sessionId: activeSessionId() || '',
      token: storageValue('token'),
      legacyToken: storageValue('northstar_token'),
      user: storageValue('user'),
      organization: storageValue('organization') || storageValue('organizationId'),
    });
  }

  function refreshAuthorizationContext() {
    var contextKey = authorizationContextKey();
    if (leadAuthorization.contextKey !== contextKey) {
      leadAuthorization.contextKey = contextKey;
      leadAuthorization.allowed = false;
      leadAuthorization.version += 1;
      clearAuthorizedRecords();
      state.leads = [];
      state.authoritativeSources.leads = { kind: 'loading', status: null };
      syncRequest = null;
    }
    return contextKey;
  }

  function leadSessionId(lead) {
    if (!lead) return null;
    var metadata = lead.metadata || {};
    return metadata.simulationSessionId || lead.simulationSessionId || lead.demoSessionId || null;
  }

  function isSimulationLead(lead) {
    if (!lead) return false;
    var metadata = lead.metadata || {};
    return metadata.recordScope === 'simulation' || metadata.source === 'simulation' ||
      lead.recordScope === 'simulation' || lead.source === 'simulation' ||
      Boolean(leadSessionId(lead));
  }

  function sessionStorageKey() {
    var sessionId = activeSessionId();
    return sessionId ? 'northstar_calls:' + sessionId : null;
  }

  function removeInactiveSessionEnvelopes(activeKey) {
    try {
      var staleKeys = [];
      for (var i = 0; i < sessionStorage.length; i++) {
        var candidate = sessionStorage.key(i);
        if (candidate && candidate.indexOf('northstar_calls:') === 0 && candidate !== activeKey) {
          staleKeys.push(candidate);
        }
      }
      staleKeys.forEach(function(key) { sessionStorage.removeItem(key); });
    } catch (_error) {}
  }

  function saveToSession() {
    try {
      var sessionId = activeSessionId();
      var key = sessionStorageKey();
      if (!sessionId || !key) return;
      removeInactiveSessionEnvelopes(key);
      var sessionLeads = [];
      runtimeAuthorizedById.forEach(function(entry) {
        if (entry.contextKey === leadAuthorization.contextKey &&
            entry.version === leadAuthorization.version &&
            isSimulationLead(entry.record) &&
            leadSessionId(entry.record) === sessionId) {
          sessionLeads.push(entry.record);
        }
      });
      sessionStorage.setItem(key, JSON.stringify({
        version: 2,
        sessionId: sessionId,
        leads: sessionLeads,
      }));
      sessionStorage.removeItem('northstar_calls');
    } catch(e) {}
  }

  function loadFromSession() {
    try {
      refreshAuthorizationContext();
      const sessionId = activeSessionId();
      const key = sessionStorageKey();
      if (!sessionId || !key) return [];
      sessionStorage.removeItem('northstar_calls');
      removeInactiveSessionEnvelopes(key);
      // Restored browser storage is not an authorization source. Runtime
      // records are visible only in the exact in-memory request generation
      // that created them; navigation, restart, and tab restoration default
      // closed until the server authorizes a fresh payload.
      sessionStorage.removeItem(key);
    } catch(e) {}
    return [];
  }

  // --- Backend Sync ---
  var syncRequest = null;
  var AUTHORITATIVE_TIMEOUT_MS = 15000;

  function sourceStateForError(error) {
    var status = error && Number(error.status);
    return {
      kind: error && error.kind === 'malformed' ? 'malformed'
        : status === 401 ? 'authentication_required'
        : status === 403 ? 'access_denied'
        : status === 404 ? 'not_found'
        : 'unavailable',
      status: status || null,
    };
  }

  async function loadFromServer() {
    var contextKey = refreshAuthorizationContext();
    if (syncRequest && syncRequest.contextKey === contextKey) return syncRequest.promise;
    var requestVersion = leadAuthorization.version + 1;
    leadAuthorization.version = requestVersion;
    leadAuthorization.allowed = false;
    clearAuthorizedRecords();
    state.authoritativeSources.leads = { kind: 'loading', status: null };
    var timer = null;
    var promise = (async function () {
      try {
        if (typeof API === 'undefined' || !API.getLeads) {
          throw new Error('Authoritative leads client is unavailable');
        }
        const result = await Promise.race([
          Promise.resolve().then(function () { return API.getLeads(); }),
          new Promise(function (_resolve, reject) {
            timer = setTimeout(function () {
              var timeout = new Error('Authoritative leads request timed out');
              timeout.kind = 'timeout';
              reject(timeout);
            }, AUTHORITATIVE_TIMEOUT_MS);
          }),
        ]);
        if (requestVersion !== leadAuthorization.version ||
            contextKey !== authorizationContextKey()) {
          return { kind: 'superseded', status: null };
        }
        if (!result || !Array.isArray(result.items)) {
          const malformed = new Error('Malformed authoritative leads response');
          malformed.kind = 'malformed';
          malformed.status = 200;
          throw malformed;
        }
        var serverLeads = result.items.filter(function(lead) {
          return !isSimulationLead(lead) || leadSessionId(lead) === activeSessionId();
        });
        authorizeServerRecords(serverLeads);
        leadAuthorization.allowed = true;
        state.leads = visibleAuthorizedRecords();
        state.authoritativeSources.leads = { kind: 'ready', status: 200 };
        bus.emit('store:loaded', { from: 'server', count: state.leads.length });
      } catch(e) {
        if (requestVersion === leadAuthorization.version &&
            contextKey === authorizationContextKey()) {
          leadAuthorization.allowed = false;
          state.authoritativeSources.leads = sourceStateForError(e);
          bus.emit('store:load-failed', {
            from: 'server',
            source: 'leads',
            state: state.authoritativeSources.leads,
          });
        }
      } finally {
        if (timer) clearTimeout(timer);
        if (syncRequest && syncRequest.version === requestVersion) syncRequest = null;
      }
      return requestVersion === leadAuthorization.version
        ? state.authoritativeSources.leads
        : { kind: 'superseded', status: null };
    })();
    syncRequest = { contextKey: contextKey, version: requestVersion, promise: promise };
    return promise;
  }

  function getState() {
    refreshAuthorizationContext();
    return Object.assign({}, state, {
      leads: getLeads(),
      authoritativeSources: {
        leads: Object.assign({}, state.authoritativeSources.leads),
      },
      ui: Object.assign({}, state.ui),
    });
  }

  function wrapWithBackend(fn, apiCall) {
    return function() {
      var result = fn.apply(this, arguments);
      if (typeof API !== 'undefined' && apiCall) {
        try {
          apiCall(result);
        } catch(e) {
          // Backend sync failed — data still in local state
        }
      }
      return result;
    };
  }

  // Override addLead to sync to backend
  var _origAddLead = addLead;
  addLead = function(leadData) {
    var lead = _origAddLead(leadData);
    if (lead && isRuntimeAuthorized(lead) &&
        typeof API !== 'undefined' && API.createLead) {
      API.createLead(leadData).catch(function() {});
    }
    return lead;
  };

  var _origUpdateLead = updateLead;
  updateLead = function(id, updates) {
    var result = _origUpdateLead(id, updates);
    if (typeof API !== 'undefined' && API.updateLead) {
      API.updateLead(id, updates).catch(function() {});
    }
    return result;
  };

  var _origRemoveLead = removeLead;
  removeLead = function(id) {
    var result = _origRemoveLead(id);
    if (typeof API !== 'undefined' && API.deleteLead) {
      API.deleteLead(id).catch(function() {});
    }
    return result;
  };

  // Initialize — try session first (preserves simulated data across pages), fall back to server
  loadFromSession();
  loadFromServer();

  bus.on('lead:created', () => { /* trigger recalculations */ });

  return { addLead, updateLead, removeLead, getLeads, getLead, getKpis, setSetting, getSetting, setUi, getUi, getState, loadFromServer };
})();
