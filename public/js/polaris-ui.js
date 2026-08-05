/** PolarisUI - renders persisted canonical values without recalculation. */
window.PolarisUI = (function () {
  'use strict';
  function escapeHtml(value) {
    var element = document.createElement('span');
    element.textContent = value === null || value === undefined ? '' : String(value);
    return element.innerHTML;
  }
  function render(container, data) {
    if (!container) return;
    var presentation = window.PolarisEngine && window.PolarisEngine.selectPresentation(data);
    if (!presentation || !presentation.service) {
      container.innerHTML = '<div class="polaris-card"><div class="polaris-section-heading">Canonical intelligence unavailable</div></div>';
      return;
    }
    var recommendation = presentation.recommendedActionText || 'No recommendation recorded';
    container.innerHTML = '<div class="polaris-card" data-canonical-presentation="true">' +
      '<div class="polaris-section-heading">POLARIS&trade; Canonical Intelligence</div>' +
      '<div class="polaris-grid">' +
        '<div><div class="polaris-metric-label">Service</div><div class="polaris-metric-value">' + escapeHtml(presentation.serviceText) + '</div></div>' +
        '<div><div class="polaris-metric-label">Customer Price</div><div class="polaris-metric-value gold">' + escapeHtml(presentation.customerPriceText) + '</div></div>' +
        '<div><div class="polaris-metric-label">Confidence</div><div class="polaris-metric-value">' + escapeHtml(presentation.confidenceText) + '</div></div>' +
        '<div><div class="polaris-metric-label">Gross Profit</div><div class="polaris-metric-value">' + escapeHtml(presentation.grossProfitText) + '</div></div>' +
      '</div>' +
      '<div class="polaris-reasoning"><strong>Recommended action:</strong> ' + escapeHtml(recommendation) + '</div>' +
    '</div>';
  }
  return Object.freeze({ render: render });
})();
