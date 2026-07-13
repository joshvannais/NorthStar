/**
 * CommunicationsEngine — Provider-agnostic Communications Engine
 *
 * Architecture:
 * ┌────────────┐     ┌────────────────────┐     ┌──────────────┐
 * │  Pages     │────→│ CommunicationsEngine│────→│ AppStore     │
 * │ (UI)       │←────│ (normalized API)    │←────│ (data source)│
 * └────────────┘     └────────────────────┘     └──────────────┘
 *                           │
 *                           ↓
 *                    ┌──────────────┐
 *                    │ Provider     │
 *                    │ Interface    │
 *                    │ (Retell, etc)│
 *                    └──────────────┘
 *
 * Every page communicates through this Engine — never directly to a provider.
 * Conversations are normalized objects regardless of source provider.
 *
 * Provider Interface (for external implementations):
 *   {
 *     name: string,
 *     connect(config) → Promise<void>,
 *     disconnect() → Promise<void>,
 *     initiateCall(phoneNumber, options) → Promise<Conversation>,
 *     sendSMS(phoneNumber, message) → Promise<{success, id}>,
 *     getStatus() → {connected, providerName}
 *   }
 *
 * Normalized Conversation object:
 *   {
 *     id: string,
 *     provider: 'simulated' | 'retell' | ...,
 *     type: 'inbound' | 'outbound',
 *     channel: 'call' | 'sms',
 *     status: 'ringing' | 'in-progress' | 'completed' | 'missed' | 'voicemail',
 *     caller: string,
 *     callerName: string,
 *     phone: string,
 *     phoneNumber: string,
 *     service: string,
 *     duration: number (seconds),
 *     durationFormatted: string,
 *     transcript: string,
 *     summary: string,
 *     receivedAt: string (ISO),
 *     updatedAt: string (ISO),
 *     outcome: string,
 *     avgPrice: number,
 *     polarisAnalysis: object,
 *     jobAddress: string,
 *     address: string,
 *     raw: object (provider-specific original data)
 *   }
 */
window.CommunicationsEngine = (function() {
  'use strict';
  var bus = window.EventBus || { on: function(){}, emit: function(){}, off: function(){} };
  var providers = [];
  var activeProvider = null;
  var initialized = false;

  // ──────────────────────────────────────────────
  // Normalize a lead (from AppStore) to a Conversation
  // ──────────────────────────────────────────────
  function normalizeFromLead(lead) {
    if (!lead) return null;
    return {
      id: lead.id,
      provider: 'simulated',
      type: lead.type === 'outbound' ? 'outbound' : 'inbound',
      channel: 'call',
      status: lead.status || 'completed',
      caller: lead.caller || lead.customerName || 'Unknown',
      callerName: lead.caller || lead.customerName || '',
      phone: lead.phone || lead.phoneNumber || '',
      phoneNumber: lead.phoneNumber || lead.phone || '',
      service: lead.service || lead.serviceRequested || 'General',
      duration: lead.duration ? parseDuration(lead.duration) : 0,
      durationFormatted: lead.duration || '—',
      transcript: lead.transcript || '',
      summary: lead.summary || '',
      receivedAt: lead.receivedAt || lead.time || new Date().toISOString(),
      updatedAt: lead.updatedAt || lead.receivedAt || '',
      outcome: lead.outcome || '',
      avgPrice: lead.avgPrice || 0,
      polarisAnalysis: lead.polarisAnalysis || null,
      jobAddress: lead.jobAddress || lead.address || '',
      address: lead.address || '',
      raw: lead
    };
  }

  function parseDuration(dur) {
    if (!dur || dur === '—') return 0;
    if (typeof dur === 'number') return dur;
    var parts = dur.split(':');
    if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    if (parts.length === 3) return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
    return parseInt(dur, 10) || 0;
  }

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────

  /**
   * Get all conversations, optionally filtered.
   * @param {object} filters - { status, service, search, dateFrom, dateTo, minRevenue, maxRevenue, aiAnalyzed }
   * @returns {array} Normalized Conversation objects
   */
  function getConversations(filters) {
    return getRawLeads(filters);
  }

  /**
   * Get raw leads from AppStore (backward-compatible with existing page code).
   * Returns the exact same objects as AppStore.getLeads() — no normalization.
   * All existing CustomerCard, CustomerDrawer, PolarisEngine consumers work unchanged.
   */
  function getRawLeads(filters) {
    var raw = [];
    var store = window.AppStore;
    if (store && store.getLeads) {
      raw = store.getLeads();
    }

    if (filters) {
      if (filters.status && filters.status !== 'all') {
        raw = raw.filter(function(c) { return c.status === filters.status; });
      }
      if (filters.service && filters.service !== 'all') {
        raw = raw.filter(function(c) { return (c.service || c.serviceRequested) === filters.service; });
      }
      if (filters.search) {
        var q = filters.search.toLowerCase();
        raw = raw.filter(function(c) {
          return (c.caller || c.customerName || '').toLowerCase().indexOf(q) >= 0 ||
                 (c.phone || c.phoneNumber || '').indexOf(q) >= 0 ||
                 (c.service || c.serviceRequested || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      if (filters.minRevenue !== undefined) {
        raw = raw.filter(function(c) { return (c.avgPrice || 0) >= filters.minRevenue; });
      }
      if (filters.maxRevenue !== undefined) {
        raw = raw.filter(function(c) { return (c.avgPrice || 0) <= filters.maxRevenue; });
      }
    }

    // Sort by receivedAt descending (newest first)
    raw.sort(function(a, b) {
      return new Date(b.receivedAt || b.time || 0).getTime() - new Date(a.receivedAt || a.time || 0).getTime();
    });

    return raw;
  }

  /**
   * Get normalized Conversation objects (provider-agnostic format).
   * For future use with non-simulated providers. Current pages use getConversations().
   */
  function getNormalizedConversations(filters) {
    var raw = getRawLeads(filters);
    return raw.map(normalizeFromLead).filter(Boolean);
  }

  /**
   * Get a single conversation by ID.
   */
  function getConversation(id) {
    var store = window.AppStore;
    if (store && store.getLead) {
      return store.getLead(id);
    }
    return null;
  }

  /**
   * Get conversation count with optional status filter.
   */
  function getCount(statusFilter) {
    var convs = getConversations();
    if (statusFilter) {
      return convs.filter(function(c) { return c.status === statusFilter; }).length;
    }
    return convs.length;
  }

  /**
   * Register a provider implementation.
   * @param {object} provider - { name, connect, disconnect, initiateCall, sendSMS, getStatus }
   */
  function registerProvider(provider) {
    if (!provider || !provider.name) return;
    providers = providers.filter(function(p) { return p.name !== provider.name; });
    providers.push(provider);
    bus.emit('communications:provider-registered', { name: provider.name });
  }

  /**
   * Set the active provider by name.
   */
  function setActiveProvider(name) {
    var found = providers.filter(function(p) { return p.name === name; });
    activeProvider = found.length > 0 ? found[0] : null;
    bus.emit('communications:provider-changed', { name: name, connected: !!activeProvider });
  }

  /**
   * Get the active provider.
   */
  function getActiveProvider() {
    return activeProvider;
  }

  /**
   * List registered providers.
   */
  function getProviders() {
    return providers.map(function(p) { return { name: p.name }; });
  }

  /**
   * Initiate an outbound call through the active provider.
   * Falls back to creating a simulated lead if no provider is active.
   */
  function initiateCall(phoneNumber, options) {
    options = options || {};
    if (activeProvider && activeProvider.initiateCall) {
      return activeProvider.initiateCall(phoneNumber, options);
    }
    // Fallback: create a simulated lead via AppStore
    return new Promise(function(resolve) {
      var store = window.AppStore;
      if (store && store.addLead) {
        var lead = store.addLead({
          caller: options.caller || 'Outbound Call',
          phone: phoneNumber,
          phoneNumber: phoneNumber,
          service: options.service || 'General',
          type: 'outbound',
          status: 'completed',
          outcome: 'outbound',
          duration: Math.floor(Math.random() * 600) + 30,
          receivedAt: new Date().toISOString(),
          summary: options.summary || 'Outbound call placed via CommunicationsEngine'
        });
        var conv = normalizeFromLead(lead);
        bus.emit('communications:call-initiated', conv);
        bus.emit('store:changed', store.getLeads());
        resolve(conv);
      } else {
        resolve(null);
      }
    });
  }

  /**
   * Send an SMS through the active provider.
   */
  function sendSMS(phoneNumber, message) {
    if (activeProvider && activeProvider.sendSMS) {
      return activeProvider.sendSMS(phoneNumber, message);
    }
    return Promise.resolve({ success: false, message: 'No active provider for SMS' });
  }

  /**
   * Initialize the engine — load conversations from AppStore.
   * Safe to call multiple times.
   */
  function init() {
    if (initialized) return;
    initialized = true;
    // Re-emit on store changes so pages can listen
    bus.on('store:changed', function() {
      bus.emit('communications:updated', getConversations());
    });
    bus.emit('communications:initialized', { providerCount: providers.length });
  }

  // Auto-init when AppStore is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 0);
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  return {
    getConversations: getConversations,
    getConversation: getConversation,
    getRawLeads: getRawLeads,
    getNormalizedConversations: getNormalizedConversations,
    getCount: getCount,
    registerProvider: registerProvider,
    setActiveProvider: setActiveProvider,
    getActiveProvider: getActiveProvider,
    getProviders: getProviders,
    initiateCall: initiateCall,
    sendSMS: sendSMS,
    init: init
  };
})();
