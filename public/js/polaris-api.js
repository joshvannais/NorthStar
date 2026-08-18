/** PolarisApi - compatibility shapes sourced only from canonical projections. */
window.PolarisApi = (function () {
  'use strict';

  function requireClient() {
    if (!window.CanonicalIntelligence) throw new Error('Polaris intelligence is unavailable.');
    return window.CanonicalIntelligence;
  }

  function compatibility(surface, filters) {
    return requireClient().loadCompatibility(surface, filters);
  }

  function records(surface, key, filters) {
    return compatibility(surface, filters).then(function (projection) {
      var result = {};
      result[key] = projection.records || [];
      result.count = result[key].length;
      result.total = result[key].length;
      result.metrics = projection.metrics || null;
      result.canonicalDigest = projection.digest;
      result.readModelVersion = projection.readModelVersion;
      result.authority = projection.authority;
      result.items = projection.items;
      return result;
    });
  }

  function firstValues(projection) {
    return projection.items && projection.items.length ? projection.items[0].values : null;
  }

  function actionText(action) {
    if (typeof action === 'string') return action;
    if (!action || typeof action !== 'object') return '';
    return action.action || action.title || action.description || action.reason || '';
  }

  function getCustomers(filters) { return records('customer-detail', 'customers', filters); }
  function getCommunications(filters) { return records('communications', 'communications', filters); }
  function getOpportunities(filters) { return records('leads', 'opportunities', filters); }
  function getPipeline() { return records('leads', 'opportunities'); }
  function getEstimates(filters) { return records('estimates', 'estimates', filters); }
  function getAgendaToday() { return records('calendar', 'tasks'); }

  function getFinancialMetrics() {
    return compatibility('estimates').then(function (projection) {
      return Object.assign({}, projection.metrics || {}, {
        canonicalDigest: projection.digest,
        readModelVersion: projection.readModelVersion,
        authority: projection.authority,
      });
    });
  }

  function getExecutiveSummary() {
    return compatibility('executive').then(function (projection) {
      var values = firstValues(projection);
      var metrics = projection.metrics || {};
      var recommendations = values && Array.isArray(values.recommendedActions) ? values.recommendedActions.map(function (action) {
        return { action: actionText(action), source: action };
      }) : [];
      return {
        revenue: { total: metrics.estimatedRevenue, knownGrossProfit: metrics.knownGrossProfit },
        pipeline: { activeDeals: metrics.graphCount, totalValue: metrics.estimatedRevenue },
        operations: { appointments: metrics.appointmentCount },
        recommendations: recommendations,
        canonical: window.CanonicalIntelligence.getPresentation(projection),
        canonicalDigest: projection.digest,
        readModelVersion: projection.readModelVersion,
        authority: projection.authority,
      };
    });
  }

  function getKPIs() {
    return compatibility('executive').then(function (projection) {
      return {
        kpis: projection.metrics || {},
        canonical: window.CanonicalIntelligence.getPresentation(projection),
        canonicalDigest: projection.digest,
        readModelVersion: projection.readModelVersion,
        authority: projection.authority,
      };
    });
  }

  function getDashboard() {
    return compatibility('command-center').then(function (projection) {
      return {
        summary: projection.metrics || {},
        items: projection.items,
        canonical: window.CanonicalIntelligence.getPresentation(projection),
        canonicalDigest: projection.digest,
        readModelVersion: projection.readModelVersion,
        authority: projection.authority,
      };
    });
  }

  function getAlerts() {
    return compatibility('executive').then(function (projection) {
      var values = firstValues(projection);
      return {
        alerts: values && Array.isArray(values.recommendedActions) ? values.recommendedActions : [],
        canonicalDigest: projection.digest,
        readModelVersion: projection.readModelVersion,
        authority: projection.authority,
      };
    });
  }

  function simulateLead(data) {
    data = data || {};
    var context = requireClient().synchronizeAuthority();
    if (!context.userId) return Promise.reject(new Error('Authentication is required.'));
    var key = data.idempotencyKey;
    if (!key && window.crypto && typeof window.crypto.randomUUID === 'function') key = window.crypto.randomUUID();
    if (!key) return Promise.reject(new Error('An idempotency key is required.'));
    var body = Object.assign({}, data);
    delete body.idempotencyKey;
    var headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': String(key),
    };
    if (context.sessionId) headers['X-NorthStar-Session-ID'] = context.sessionId;
    return window.NorthStarAccountSession.fetch('/api/v1/simulations/leads', {
      method: 'POST',
      headers: headers,
      credentials: 'same-origin',
      body: JSON.stringify(body),
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload && payload.error && payload.error.message || 'Simulation failed.');
        return payload;
      });
    });
  }

  function normalizeLead(record) {
    if (!record || !record.canonical || !record.canonical.values) return null;
    var values = record.canonical.values;
    var customer = record.customer || {};
    return {
      id: record.canonical.ids.opportunity,
      customerId: record.canonical.ids.customer,
      canonicalGraphId: record.canonical.ids.graph,
      callerName: customer.name,
      phone: customer.phone,
      address: customer.address,
      service: values.service && values.service.label,
      estimatedPrice: values.customerFacingPrice,
      jobDetail: values.service && values.service.scope,
      status: record.status,
      transcript: record.transcript && record.transcript.text,
      calculationVersion: record.canonical.calculationVersion,
      snapshotDigest: record.canonical.snapshotDigest,
      canonical: record.canonical,
      readOnly: true,
    };
  }

  function normalizeCommunication(record) {
    if (!record || !record.canonical || !record.canonical.ids) return null;
    var rawId = record.canonical.ids.customer;
    var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var MAX_CUSTOMER_NAME_LENGTH = 256;
    var MAX_CUSTOMER_PHONE_LENGTH = 64;
    var customer = record.customer || {};
    var name = null;
    if (typeof customer.name === 'string') {
      var trimmed = customer.name.trim();
      if (trimmed.length > 0 && trimmed.length <= MAX_CUSTOMER_NAME_LENGTH) {
        name = trimmed;
      }
    }
    var phone = null;
    if (typeof customer.phone === 'string') {
      var trimmed = customer.phone.trim();
      if (trimmed.length > 0 && trimmed.length <= MAX_CUSTOMER_PHONE_LENGTH) {
        phone = trimmed;
      }
    }
    return {
      id: record.canonical.ids.communication,
      customerId: (typeof rawId === 'string' && UUID.test(rawId)) ? rawId : null,
      customerName: name,
      customerPhone: phone,
      type: record.channel,
      direction: record.direction,
      subject: record.subject,
      content: record.transcript && record.transcript.text,
      duration: record.transcript && record.transcript.durationSeconds,
      canonical: record.canonical,
      readOnly: true,
    };
  }

  return Object.freeze({
    getCompatibility: compatibility,
    getCustomers: getCustomers,
    getCommunications: getCommunications,
    getOpportunities: getOpportunities,
    getPipeline: getPipeline,
    getEstimates: getEstimates,
    getFinancialMetrics: getFinancialMetrics,
    getExecutiveSummary: getExecutiveSummary,
    getKPIs: getKPIs,
    getDashboard: getDashboard,
    getAlerts: getAlerts,
    getAgendaToday: getAgendaToday,
    simulateLead: simulateLead,
    normalizeLead: normalizeLead,
    normalizeCommunication: normalizeCommunication,
  });
})();
