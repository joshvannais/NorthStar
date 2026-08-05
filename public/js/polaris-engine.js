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

  function valuesFrom(source) {
    return source && (source.canonicalValues || source.values || source.snapshot || source);
  }

  function money(value, round) {
    if (value === null || value === undefined) return 'Not calculated';
    return '$' + (round ? Math.round(value) : Number(value)).toLocaleString();
  }

  function selectPresentation(source) {
    var values = valuesFrom(source);
    if (!values) return null;
    var service = values.service || null;
    var confidence = values.confidence || null;
    var confidenceScore = confidence && confidence.score !== null && confidence.score !== undefined
      ? confidence.score
      : null;
    var recommendations = values.recommendedActions;
    return Object.freeze({
      values: values,
      service: service,
      serviceText: service ? (service.label || service.key || '') : '',
      customerPrice: values.customerFacingPrice,
      customerPriceText: money(values.customerFacingPrice, false),
      customerPriceRoundedText: money(values.customerFacingPrice, true),
      confidence: confidence,
      confidenceScore: confidenceScore,
      confidenceText: confidenceScore === null ? 'Not calculated' : confidenceScore + '%',
      grossProfit: values.grossProfit,
      grossProfitText: money(values.grossProfit, false),
      grossMarginPercent: values.grossMarginPercent,
      netProfit: values.netProfit,
      netMarginPercent: values.netMarginPercent,
      risk: values.risk,
      riskText: JSON.stringify(values.risk),
      recommendations: recommendations,
      recommendedActionText: actionText(recommendations && recommendations[0]),
    });
  }

  function present(item) {
    if (!item) return null;
    var selected = selectPresentation(item);
    var values = selected.values;
    return Object.freeze({
      ids: item.ids,
      calculationVersion: item.calculationVersion,
      snapshotDigest: item.snapshotDigest,
      service: selected.service,
      insight: selected.recommendedActionText,
      confidence: selected.confidenceScore,
      estimatedPrice: selected.customerPrice,
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
      grossProfit: selected.grossProfit,
      grossMarginPercent: selected.grossMarginPercent,
      netProfit: selected.netProfit,
      netMarginPercent: selected.netMarginPercent,
      risk: selected.risk,
      recommendations: selected.recommendations,
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
    var selected = selectPresentation(item);
    var metrics = current && current.metrics ? current.metrics : null;
    if (!selected) {
      ['polarisTopOpp', 'polarisTopOppDesc', 'polarisPipeline', 'polarisPipeConf', 'polarisFocus', 'polarisFocusDesc', 'polarisFocusConf'].forEach(function (id) { setText(id, '\u2014'); });
      return;
    }
    setText('polarisTopOpp', selected.service && selected.service.label);
    setText('polarisTopOppDesc', selected.customerPriceText);
    setText('polarisTopConf', selected.confidenceText);
    setText('polarisPipeline', metrics && metrics.estimatedRevenue !== null ? '$' + Number(metrics.estimatedRevenue).toLocaleString() : '\u2014');
    setText('polarisPipeConf', item.calculationVersion);
    setText('polarisFocus', selected.recommendedActionText || '\u2014');
    setText('polarisFocusDesc', item.snapshotDigest);
    setText('polarisFocusConf', selected.risk && selected.risk.emergency ? 'Emergency evidence' : 'No active emergency');
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
    selectPresentation: selectPresentation,
  });
})();
