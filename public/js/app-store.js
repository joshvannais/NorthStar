/**
 * AppStore - in-memory presentation cache for authorized canonical records.
 * PostgreSQL is the only business authority. Browser storage and automatic
 * frontend mutations are deliberately unsupported.
 */
window.AppStore = (function () {
  'use strict';

  var bus = window.EventBus || { emit: function () {}, on: function () {} };
  var state = {
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
    canonical: null,
    settings: { theme: localStorage.getItem('northstar-theme') || 'light' },
    ui: {
      selectedLeadId: null,
      drawerOpen: false,
      currentFilters: {},
      currentSearch: '',
      currentSort: '',
      mobileMenuOpen: false,
    },
  };
  var activeLoad = null;

  function canonicalRecord(record) {
    if (!record || !record.canonical || !record.canonical.values || !record.canonical.ids) return null;
    var values = record.canonical.values;
    var customer = record.customer || {};
    return Object.freeze({
      id: record.canonical.ids.opportunity,
      canonicalGraphId: record.canonical.ids.graph,
      canonicalSnapshotId: record.canonical.ids.polarisSnapshot,
      customerId: record.canonical.ids.customer,
      caller: customer.name || '',
      callerName: customer.name || '',
      customerName: customer.name || '',
      phone: customer.phone || '',
      phoneNumber: customer.phone || '',
      address: customer.address || '',
      service: values.service ? values.service.label : null,
      serviceType: values.service ? values.service.key : null,
      jobDetail: values.service ? values.service.scope : null,
      description: values.service ? values.service.scope : null,
      status: record.status || null,
      outcome: record.status || null,
      avgPrice: values.customerFacingPrice,
      estimatedPrice: values.customerFacingPrice,
      duration: values.callDurationSeconds,
      receivedAt: null,
      time: null,
      calculationVersion: record.canonical.calculationVersion,
      snapshotDigest: record.canonical.snapshotDigest,
      canonical: record.canonical,
      legacy: false,
      readOnly: true,
      source: 'canonical-postgresql',
    });
  }

  function rejectMutation(action) {
    bus.emit('legacy:mutation-blocked', { action: action, reason: 'canonical-server-authority' });
    return null;
  }

  function addLead() { return rejectMutation('addLead'); }
  function updateLead() { return rejectMutation('updateLead'); }
  function removeLead() { return rejectMutation('removeLead'); }
  function convertLeadToCustomer() { return rejectMutation('convertLeadToCustomer'); }

  function getLeads(filter) {
    var values = state.leads.slice();
    return typeof filter === 'function' ? values.filter(filter) : values;
  }

  function getLead(id) {
    return state.leads.find(function (lead) {
      return lead.id === id || lead.canonicalGraphId === id || lead.customerId === id || lead.canonicalSnapshotId === id;
    }) || null;
  }

  function getCustomer(id) {
    return state.customers.find(function (customer) { return customer.id === id; }) || null;
  }

  function getKpis() {
    var metrics = state.canonical && state.canonical.metrics ? state.canonical.metrics : null;
    if (!metrics) return null;
    return Object.freeze({
      total: metrics.graphCount,
      revenue: metrics.estimatedRevenue,
      pipeline: metrics.estimatedRevenue,
      appointments: metrics.appointmentCount,
      knownGrossProfit: metrics.knownGrossProfit,
      snapshotDigests: metrics.snapshotDigests,
    });
  }

  function setSetting(key, value) {
    state.settings[key] = value;
    bus.emit('setting:changed', { key: key, value: value });
    if (key === 'theme') localStorage.setItem('northstar-theme', value);
  }
  function getSetting(key) { return state.settings[key]; }
  function setUi(key, value) { state.ui[key] = value; bus.emit('ui:changed', { key: key, value: value }); }
  function getUi(key) { return state.ui[key]; }

  // Kept as compatibility no-ops so old callers cannot revive browser data.
  function saveToSession() { return false; }
  function loadFromSession() { return false; }

  function clearCanonical(reason) {
    state.leads = [];
    state.customers = [];
    state.canonical = null;
    bus.emit('store:rejected', { reason: reason || 'canonical-projection-rejected' });
  }

  function applyProjection(projection) {
    if (!projection || projection.surface !== 'leads') return [];
    if (state.canonical === projection) return state.leads.slice();
    var records = Array.isArray(projection.records) ? projection.records : [];
    var leads = records.map(canonicalRecord).filter(Boolean);
    state.leads = leads;
    state.customers = records.map(function (record) {
      if (!record.customer || !record.canonical) return null;
      return Object.freeze(Object.assign({}, record.customer, {
        canonical: record.canonical,
        legacy: false,
        readOnly: true,
      }));
    }).filter(Boolean);
    state.canonical = projection;
    bus.emit('store:loaded', {
      from: 'server',
      count: leads.length,
      digest: projection.digest,
      readModelVersion: projection.readModelVersion,
      authority: projection.authority,
    });
    return leads.slice();
  }

  function loadFromServer() {
    if (!window.CanonicalIntelligence) {
      clearCanonical('canonical-client-unavailable');
      return Promise.reject(new Error('Canonical client is unavailable.'));
    }
    if (activeLoad) return activeLoad;
    activeLoad = window.CanonicalIntelligence.loadCompatibility('leads').then(function (projection) {
      return applyProjection(projection);
    }).catch(function (error) {
      clearCanonical(error && error.message);
      throw error;
    }).finally(function () {
      activeLoad = null;
    });
    return activeLoad;
  }

  if (window.addEventListener) {
    window.addEventListener('canonical:loaded', function (event) {
      if (!event || !event.detail || event.detail.surface !== 'leads' || !event.detail.compatibility) return;
      var projection = window.CanonicalIntelligence && window.CanonicalIntelligence.getProjection('leads');
      if (projection) applyProjection(projection);
    });
    window.addEventListener('canonical:rejected', function (event) {
      clearCanonical(event && event.detail ? event.detail.reason : 'canonical-projection-rejected');
    });
  }
  loadFromServer().catch(function () {});

  return Object.freeze({
    addLead: addLead,
    updateLead: updateLead,
    removeLead: removeLead,
    convertLeadToCustomer: convertLeadToCustomer,
    getLeads: getLeads,
    getLead: getLead,
    getCustomer: getCustomer,
    getKpis: getKpis,
    setSetting: setSetting,
    getSetting: getSetting,
    setUi: setUi,
    getUi: getUi,
    getState: function () { return state; },
    loadFromSession: loadFromSession,
    saveToSession: saveToSession,
    loadFromServer: loadFromServer,
  });
})();
