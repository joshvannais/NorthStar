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
    ui: {
      selectedLeadId: null,
      drawerOpen: false,
      currentFilters: {},
      currentSearch: '',
      currentSort: '',
      mobileMenuOpen: false
    }
  };

  // --- Leads ---
  function addLead(leadData) {
    const lead = leadData instanceof window.Models.Lead ? leadData : new window.Models.Lead(leadData);
    state.leads.unshift(lead);
    bus.emit('lead:created', lead);
    bus.emit('store:changed', { type: 'lead', action: 'created', data: lead });
    saveToSession();
    return lead;
  }

  function updateLead(id, updates) {
    const idx = state.leads.findIndex(l => l.id === id);
    if (idx === -1) return null;
    Object.assign(state.leads[idx], updates, { updatedAt: new Date().toISOString() });
    bus.emit('lead:updated', state.leads[idx]);
    bus.emit('store:changed', { type: 'lead', action: 'updated', data: state.leads[idx] });
    saveToSession();
    return state.leads[idx];
  }

  function removeLead(id) {
    const idx = state.leads.findIndex(l => l.id === id);
    if (idx === -1) return;
    const removed = state.leads.splice(idx, 1)[0];
    bus.emit('lead:deleted', removed);
    bus.emit('store:changed', { type: 'lead', action: 'deleted' });
    saveToSession();
  }

  function getLeads(filter) {
    if (!filter) return state.leads;
    return state.leads.filter(filter);
  }

  function getLead(id) {
    return state.leads.find(l => l.id === id) || null;
  }

  // --- KPIs (computed from leads) ---
  function getKpis() {
    const leads = state.leads;
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
      var sessionLeads = state.leads.filter(function(lead) {
        return isSimulationLead(lead) && leadSessionId(lead) === sessionId;
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
      const sessionId = activeSessionId();
      const key = sessionStorageKey();
      if (!sessionId || !key) return [];
      sessionStorage.removeItem('northstar_calls');
      removeInactiveSessionEnvelopes(key);
      const saved = sessionStorage.getItem(key);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.version === 2 && parsed.sessionId === sessionId && Array.isArray(parsed.leads)) {
          var scoped = parsed.leads.filter(function(lead) {
            return isSimulationLead(lead) && leadSessionId(lead) === sessionId;
          });
          state.leads = scoped;
          bus.emit('store:loaded', { from: 'session', count: scoped.length });
          return scoped;
        }
      }
    } catch(e) {}
    return [];
  }

  // --- Backend Sync ---
  var syncInProgress = false;

  async function loadFromServer() {
    if (syncInProgress) return;
    syncInProgress = true;
    try {
      if (typeof API !== 'undefined' && API.getLeads) {
        const result = await API.getLeads();
        if (result && Array.isArray(result.items)) {
          var sessionLeads = state.leads.filter(function(lead) {
            return isSimulationLead(lead) && leadSessionId(lead) === activeSessionId();
          });
          var byId = new Map();
          var serverLeads = result.items.filter(function(lead) {
            return !isSimulationLead(lead) || leadSessionId(lead) === activeSessionId();
          });
          serverLeads.concat(sessionLeads).forEach(function(lead) {
            if (lead && lead.id !== undefined && lead.id !== null) byId.set(String(lead.id), lead);
          });
          state.leads = Array.from(byId.values());
          bus.emit('store:loaded', { from: 'server', count: state.leads.length });
        }
      }
    } catch(e) {
      // Backend not available — use session data
      loadFromSession();
    }
    syncInProgress = false;
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
    if (typeof API !== 'undefined' && API.createLead) {
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

  return { addLead, updateLead, removeLead, getLeads, getLead, getKpis, setSetting, getSetting, setUi, getUi, getState: () => state, loadFromSession, saveToSession, loadFromServer };
})();
