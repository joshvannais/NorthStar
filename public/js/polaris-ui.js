/** PolarisUI - renders persisted canonical values without recalculation. */
window.PolarisUI = (function () {
  'use strict';
  function escapeHtml(value) {
    var element = document.createElement('span');
    element.textContent = value === null || value === undefined ? '' : String(value);
    return element.innerHTML;
  }
  function money(value) { return value === null || value === undefined ? 'Not calculated' : '$' + Number(value).toLocaleString(); }
  function actionText(action) {
    if (typeof action === 'string') return action;
    if (!action || typeof action !== 'object') return '';
    return action.action || action.title || action.description || action.reason || '';
  }
  function valuesFrom(data) { return data && (data.canonicalValues || data.values || data.snapshot || data); }
  function render(container, data) {
    if (!container) return;
    var values = valuesFrom(data);
    if (!values || !values.service) {
      container.innerHTML = '<div class="polaris-card"><div class="polaris-section-heading">Canonical intelligence unavailable</div></div>';
      return;
    }
    var confidence = values.confidence && values.confidence.score !== null ? values.confidence.score + '%' : 'Not calculated';
    var recommendation = actionText(values.recommendedActions && values.recommendedActions[0]) || 'No recommendation recorded';
    container.innerHTML = '<div class="polaris-card" data-canonical-presentation="true">' +
      '<div class="polaris-section-heading">POLARIS&trade; Canonical Intelligence</div>' +
      '<div class="polaris-grid">' +
        '<div><div class="polaris-metric-label">Service</div><div class="polaris-metric-value">' + escapeHtml(values.service.label || values.service.key) + '</div></div>' +
        '<div><div class="polaris-metric-label">Customer Price</div><div class="polaris-metric-value gold">' + escapeHtml(money(values.customerFacingPrice)) + '</div></div>' +
        '<div><div class="polaris-metric-label">Confidence</div><div class="polaris-metric-value">' + escapeHtml(confidence) + '</div></div>' +
        '<div><div class="polaris-metric-label">Gross Profit</div><div class="polaris-metric-value">' + escapeHtml(money(values.grossProfit)) + '</div></div>' +
      '</div>' +
      '<div class="polaris-reasoning"><strong>Recommended action:</strong> ' + escapeHtml(recommendation) + '</div>' +
    '</div>';
  }
  return Object.freeze({ render: render });
})();
