/**
 * Retell AI Provider — Implements the CommunicationsEngine Provider Interface.
 *
 * Provider Interface contract:
 *   {
 *     name: string,
 *     connect(config) → Promise<void>,
 *     disconnect() → Promise<void>,
 *     initiateCall(phoneNumber, options) → Promise<Conversation>,
 *     sendSMS(phoneNumber, message) → Promise<{success, id}>,
 *     getStatus() → {connected, providerName}
 *   }
 *
 * This provider communicates with the Retell AI API for AI-powered call handling.
 * It registers itself with CommunicationsEngine when loaded.
 */
window.RetellProvider = (function() {
  'use strict';
  var bus = window.EventBus || { on: function(){}, emit: function(){} };

  var config = {
    apiKey: '',
    agentId: '',
    apiBase: '/api'
  };
  var connected = false;

  // ──────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────
  function apiPost(endpoint, body) {
    return fetch(config.apiBase + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r) { return r.json(); });
  }

  // ──────────────────────────────────────────────
  // Provider API implementation
  // ──────────────────────────────────────────────

  function connect(opts) {
    opts = opts || {};
    config.apiKey = opts.apiKey || config.apiKey;
    config.agentId = opts.agentId || config.agentId;
    config.apiBase = opts.apiBase || config.apiBase;

    if (!config.apiKey && !config.agentId) {
      // No credentials yet — stay in disconnected state
      // This is the "configure later" path
      connected = false;
      return Promise.resolve();
    }

    // Try to verify connection via backend
    return apiPost('/retell/verify', { apiKey: config.apiKey })
      .then(function(result) {
        connected = result && result.success !== false;
        bus.emit('communications:provider-connected', {
          name: 'retell',
          connected: connected
        });
        return;
      })
      .catch(function() {
        connected = false;
        return;
      });
  }

  function disconnect() {
    connected = false;
    bus.emit('communications:provider-disconnected', { name: 'retell' });
    return Promise.resolve();
  }

  function initiateCall(phoneNumber, options) {
    options = options || {};
    if (!connected) {
      return Promise.reject(new Error('Retell provider not connected'));
    }
    return apiPost('/retell/create-call', {
      phoneNumber: phoneNumber,
      agentId: config.agentId,
      service: options.service || 'General',
      caller: options.caller || ''
    }).then(function(result) {
      // Convert to normalized Conversation
      var conv = {
        id: result.callId || 'retell_' + Date.now().toString(36),
        provider: 'retell',
        type: 'outbound',
        channel: 'call',
        status: result.status || 'in-progress',
        caller: options.caller || 'Outbound Call',
        callerName: options.caller || '',
        phone: phoneNumber,
        phoneNumber: phoneNumber,
        service: options.service || 'General',
        duration: 0,
        durationFormatted: '—',
        transcript: result.transcript || '',
        summary: result.summary || '',
        receivedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        outcome: result.outcome || '',
        avgPrice: result.estimatedPrice || 0,
        polarisAnalysis: null,
        jobAddress: '',
        address: '',
        raw: result
      };
      // Store via AppStore
      var store = window.AppStore;
      if (store && store.addLead) {
        var lead = store.addLead({
          caller: conv.caller,
          phone: conv.phone,
          phoneNumber: conv.phone,
          service: conv.service,
          status: conv.status,
          type: 'outbound',
          receivedAt: conv.receivedAt,
          summary: conv.summary,
          transcript: conv.transcript
        });
        conv.id = lead.id;
      }
      return conv;
    });
  }

  function sendSMS(phoneNumber, message) {
    if (!connected) {
      return Promise.resolve({ success: false, message: 'Retell provider not connected' });
    }
    // Retell may not support SMS directly — route through backend
    return apiPost('/retell/send-sms', {
      phoneNumber: phoneNumber,
      message: message
    }).then(function(result) {
      return { success: true, id: result.id || Date.now().toString(36) };
    }).catch(function() {
      return { success: false, message: 'SMS via Retell failed' };
    });
  }

  function getStatus() {
    return {
      connected: connected,
      providerName: 'retell',
      hasApiKey: !!config.apiKey,
      hasAgentId: !!config.agentId
    };
  }

  // ──────────────────────────────────────────────
  // Registration with CommunicationsEngine
  // ──────────────────────────────────────────────

  var provider = {
    name: 'retell',
    connect: connect,
    disconnect: disconnect,
    initiateCall: initiateCall,
    sendSMS: sendSMS,
    getStatus: getStatus
  };

  // Register when engine is available
  function register() {
    var engine = window.CommunicationsEngine;
    if (engine && engine.registerProvider) {
      engine.registerProvider(provider);
      bus.emit('retell:registered', {});
    } else {
      // Engine not loaded yet — retry
      setTimeout(register, 100);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(register, 0);
  } else {
    document.addEventListener('DOMContentLoaded', register);
  }

  return {
    connect: connect,
    disconnect: disconnect,
    initiateCall: initiateCall,
    sendSMS: sendSMS,
    getStatus: getStatus
  };
})();
