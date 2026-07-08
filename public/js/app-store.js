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
  function saveToSession() {
    try { sessionStorage.setItem('northstar_calls', JSON.stringify(state.leads)); } catch(e) {}
  }

  function loadFromSession() {
    try {
      const saved = sessionStorage.getItem('northstar_calls');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          state.leads = parsed;
          bus.emit('store:loaded', { from: 'session', count: parsed.length });
        }
      }
    } catch(e) {}
  }

  // Initialize
  loadFromSession();
  bus.on('lead:created', () => { /* trigger recalculations */ });

  return { addLead, updateLead, removeLead, getLeads, getLead, getKpis, setSetting, getSetting, setUi, getUi, getState: () => state, loadFromSession, saveToSession };
})();
