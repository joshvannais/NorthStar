/** PolarisEngine - presentation selectors for persisted canonical snapshots. */
window.PolarisEngine = (function () {
  'use strict';

  function projection() {
    return window.CanonicalIntelligence ?
      (window.CanonicalIntelligence.getProjection('leads') ||
       window.CanonicalIntelligence.getProjection('command-center') ||
       window.CanonicalIntelligence.getProjection('customer-detail')) : null;
  }

  function itemFor(candidate) {
    var current = projection();
    if (!current || !current.items || !current.items.length) return null;
    if (!candidate) return current.items[0];
    var ids = [candidate.id, candidate.canonicalGraphId, candidate.customerId, candidate.canonicalSnapshotId];
    return current.items.find(function (item) {
      return Object.keys(item.ids).some(function (key) { return ids.indexOf(item.ids[key]) >= 0; });
    }) || null;
  }

  function actionText(action) {
    if (typeof action === 'string') return action;
    if (!action || typeof action !== 'object') return '';
    return action.action || action.title || action.description || action.reason || '';
  }

  function present(item) {
    if (!item) return null;
    var values = item.values;
    return Object.freeze({
      ids: item.ids,
      calculationVersion: item.calculationVersion,
      snapshotDigest: item.snapshotDigest,
      service: values.service,
      insight: actionText(values.recommendedActions && values.recommendedActions[0]),
      confidence: values.confidence ? values.confidence.score : null,
      estimatedPrice: values.customerFacingPrice,
      total: values.totalIncludingTax,
      subtotalBeforeTax: values.subtotalBeforeTax,
      tax: values.tax,
      taxRatePercent: values.taxRatePercent,
      taxDisposition: values.taxDisposition,
      items: values.pricingLineItems,
      labor: values.laborCharge,
      materials: values.materialsCharge,
      equipment: values.equipmentCharge,
      travel: values.travel,
      grossProfit: values.grossProfit,
      grossMarginPercent: values.grossMarginPercent,
      netProfit: values.netProfit,
      netMarginPercent: values.netMarginPercent,
      risk: values.risk,
      recommendations: values.recommendedActions,
      notCalculated: values.notCalculated,
      canonicalValues: values,
    });
  }

  function analyzeLead(lead) { return present(itemFor(lead)); }
  function generateEstimate(lead) { return present(itemFor(lead)); }
  function ensurePolarisAnalysis() { return false; }
  function loadEstimationConfig() { return false; }
  function assessDifficulty() { return null; }

  function fetchM13Intelligence(lead) {
    if (!window.CanonicalIntelligence) return Promise.resolve(null);
    return window.CanonicalIntelligence.loadCompatibility('customer-detail').then(function () {
      return present(itemFor(lead));
    });
  }

  function setText(id, value) {
    var element = document.getElementById(id);
    if (element) element.textContent = value === null || value === undefined || value === '' ? '\u2014' : String(value);
  }

  function renderPolarisCard() {
    var current = projection();
    var item = current && current.items && current.items.length ? current.items[0] : null;
    var values = item ? item.values : null;
    var metrics = current && current.metrics ? current.metrics : null;
    if (!values) {
      ['polarisTopOpp', 'polarisTopOppDesc', 'polarisPipeline', 'polarisPipeConf', 'polarisFocus', 'polarisFocusDesc', 'polarisFocusConf'].forEach(function (id) { setText(id, '\u2014'); });
      return;
    }
    setText('polarisTopOpp', values.service && values.service.label);
    setText('polarisTopOppDesc', values.customerFacingPrice === null ? 'Not calculated' : '$' + Number(values.customerFacingPrice).toLocaleString());
    setText('polarisTopConf', values.confidence && values.confidence.score !== null ? values.confidence.score + '%' : 'Not calculated');
    setText('polarisPipeline', metrics && metrics.estimatedRevenue !== null ? '$' + Number(metrics.estimatedRevenue).toLocaleString() : '\u2014');
    setText('polarisPipeConf', item.calculationVersion);
    setText('polarisFocus', actionText(values.recommendedActions && values.recommendedActions[0]) || '\u2014');
    setText('polarisFocusDesc', item.snapshotDigest);
    setText('polarisFocusConf', values.risk && values.risk.emergency ? 'Emergency evidence' : 'No active emergency');
  }

  if (window.addEventListener) {
    window.addEventListener('canonical:loaded', function () { renderPolarisCard(); });
  }

  return Object.freeze({
    analyzeLead: analyzeLead,
    capitalizeFirst: function (value) { return value || ''; },
    ensurePolarisAnalysis: ensurePolarisAnalysis,
    renderPolarisCard: renderPolarisCard,
    generateEstimate: generateEstimate,
    loadEstimationConfig: loadEstimationConfig,
    assessDifficulty: assessDifficulty,
    fetchM13Intelligence: fetchM13Intelligence,
  });
})();
