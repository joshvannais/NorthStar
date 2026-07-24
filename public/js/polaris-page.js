/**
 * Polaris page canonical-intelligence renderer.
 *
 * Keeps the page usable in every API state and renders only the canonical
 * object persisted by the universal simulation pipeline.
 */
window.PolarisPage = (function() {
  'use strict';

  function byId(id) {
    return document.getElementById(id);
  }

  function canonicalFrom(record) {
    if (!record) return null;
    if (record.canonicalPolaris) return record.canonicalPolaris;
    return record.metadata && record.metadata.polarisIntelligence
      ? record.metadata.polarisIntelligence
      : null;
  }

  function setText(id, value, fallback) {
    var element = byId(id);
    if (!element) return;
    element.textContent = value == null || value === '' ? fallback : String(value);
  }

  function formatMoney(value) {
    if (value == null || value === '') return 'Requires assessment';
    var amount = Number(value);
    if (!isFinite(amount)) return 'Requires assessment';
    return '$' + amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function formatList(value) {
    if (!Array.isArray(value) || value.length === 0) return 'None identified';
    return value.map(function(item) {
      return typeof item === 'string' ? item : JSON.stringify(item);
    }).join('; ');
  }

  function formatScope(scope) {
    if (!scope || typeof scope !== 'object' || Object.keys(scope).length === 0) {
      return 'No supported scope captured';
    }
    return Object.keys(scope).map(function(key) {
      return key + ': ' + String(scope[key]);
    }).join('; ');
  }

  function setState(state) {
    var root = byId('polarisRoot');
    var panel = byId('polarisIntelligencePanel');
    if (root) root.setAttribute('data-render-state', state);
    if (panel) panel.setAttribute('data-state', state);
  }

  function renderCanonical(canonical) {
    var action = canonical.recommendedAction || {};
    setText('polarisCanonicalService', canonical.service, 'Unclassified service');
    setText('polarisCanonicalPrice', formatMoney(canonical.customerFacingPrice), 'Requires assessment');
    setText('polarisCanonicalConfidence', canonical.confidenceScore == null
      ? 'Not available'
      : canonical.confidenceScore + '%', 'Not available');
    setText('polarisCanonicalAction', action.action, 'Human review required');
    setText('polarisCanonicalScope', formatScope(canonical.scope), 'No supported scope captured');
    setText('polarisCanonicalMissing', formatList(canonical.missingInformation), 'None identified');
    setText('polarisCanonicalAssumptions', formatList(canonical.assumptions), 'None identified');
    setState('canonical');
    return canonical;
  }

  function renderEmpty() {
    setState('empty');
    return null;
  }

  function renderError() {
    setState('error');
    return null;
  }

  function init(api) {
    api = api || window.PolarisApi;
    setState('loading');
    if (!api || typeof api.getOpportunities !== 'function') {
      renderError();
      return Promise.resolve(null);
    }

    return api.getOpportunities({ limit: 50 }).then(function(result) {
      var opportunities = result && Array.isArray(result.opportunities)
        ? result.opportunities
        : [];
      var canonical = null;
      for (var i = 0; i < opportunities.length && !canonical; i += 1) {
        canonical = canonicalFrom(opportunities[i]);
      }
      return canonical ? renderCanonical(canonical) : renderEmpty();
    }).catch(function() {
      return renderError();
    });
  }

  return {
    canonicalFrom: canonicalFrom,
    init: init,
    renderCanonical: renderCanonical,
    renderEmpty: renderEmpty,
    renderError: renderError,
    setState: setState,
  };
})();
