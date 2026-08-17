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

  function recommendationText(action) {
    if (typeof action === 'string') return action;
    if (!isRecord(action)) return null;
    var fields = ['action', 'title', 'description', 'reason', 'label'];
    for (var index = 0; index < fields.length; index += 1) {
      var value = action[fields[index]];
      if (value) return typeof value === 'string' ? value : null;
    }
    return null;
  }

  function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function valuesFrom(source) {
    if (!isRecord(source)) return null;
    if (hasOwn(source, 'canonicalValues')) return source.canonicalValues;
    if (hasOwn(source, 'values')) return source.values;
    if (hasOwn(source, 'snapshot')) return source.snapshot;
    return source;
  }

  function finiteOrNull(value) {
    return value === null || (typeof value === 'number' && Number.isFinite(value));
  }

  function validService(service) {
    if (service === null) return true;
    if (!isRecord(service) || (!hasOwn(service, 'key') && !hasOwn(service, 'label'))) return false;
    if (hasOwn(service, 'key') && typeof service.key !== 'string') return false;
    if (hasOwn(service, 'label') && service.label !== null && typeof service.label !== 'string') return false;
    return true;
  }

  function validConfidence(confidence) {
    return confidence === null ||
      (isRecord(confidence) && hasOwn(confidence, 'score') && finiteOrNull(confidence.score));
  }

  function validRisk(risk) {
    return risk === null ||
      (isRecord(risk) && hasOwn(risk, 'emergency') && typeof risk.emergency === 'boolean');
  }

  function validRecommendation(action) {
    return recommendationText(action) !== null;
  }

  function validValues(values) {
    if (!isRecord(values)) return false;
    if (hasOwn(values, 'contract') && values.contract !== 'CanonicalPolarisOutput') return false;

    var required = [
      'service',
      'customerFacingPrice',
      'confidence',
      'grossProfit',
      'grossMarginPercent',
      'netProfit',
      'netMarginPercent',
      'risk',
      'recommendedActions',
    ];
    if (!required.every(function (key) { return hasOwn(values, key); })) return false;

    var numeric = [
      'customerFacingPrice',
      'grossProfit',
      'grossMarginPercent',
      'netProfit',
      'netMarginPercent',
      'estimatedRevenue',
      'subtotalBeforeTax',
      'taxRatePercent',
      'tax',
      'totalIncludingTax',
      'materialsCharge',
      'knownDirectMaterialCost',
      'laborCharge',
      'laborHours',
      'knownInternalLaborCost',
      'equipmentCharge',
      'knownEquipmentCost',
      'callDurationSeconds',
      'estimatedProductionDurationHours',
      'knownDirectCosts',
      'overhead',
    ];
    if (numeric.some(function (key) { return hasOwn(values, key) && !finiteOrNull(values[key]); })) return false;
    if (!validService(values.service)) return false;
    if (!validConfidence(values.confidence)) return false;
    if (!validRisk(values.risk)) return false;
    if (values.recommendedActions !== null && !Array.isArray(values.recommendedActions)) return false;
    if (Array.isArray(values.recommendedActions) && !values.recommendedActions.every(validRecommendation)) return false;
    return true;
  }

  function money(value, round) {
    if (value === null || value === undefined) return 'Not calculated';
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not calculated';
    return '$' + (round ? Math.round(value) : value).toLocaleString();
  }

  function readable(value, fallback, key, depth) {
    var formatter = window.NorthStarPresentationFormat;
    if (formatter && typeof formatter.describe === 'function') {
      return formatter.describe(value, { fallback: fallback, key: key });
    }
    var level = depth || 0;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value) && level < 3) {
      var list = value.map(function(item) { return readable(item, '', key, level + 1); }).filter(Boolean);
      return list.length ? list.join('; ') : fallback;
    }
    if (isRecord(value) && level < 3) {
      var parts = Object.keys(value).filter(function(field) {
        return !/(^|_)(id|uuid|digest|hash|version|contract|source|token|key)$/i.test(field);
      }).map(function(field) {
        var text = readable(value[field], '', field, level + 1);
        var title = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
        return text ? title.charAt(0).toUpperCase() + title.slice(1) + ': ' + text : '';
      }).filter(Boolean);
      return parts.length ? parts.join('; ') : fallback;
    }
    return fallback;
  }

  function selectPresentation(source) {
    var values = valuesFrom(source);
    if (!validValues(values)) return null;
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
      riskText: readable(values.risk, 'No specific risk is supported by the current recorded inputs.', 'risk'),
      recommendations: recommendations,
      recommendedActionText: recommendationText(recommendations && recommendations[0]) || '',
    });
  }

  function present(item) {
    if (!item) return null;
    var selected = selectPresentation(item);
    if (!selected) return null;
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
      ['polarisTopOpp', 'polarisTopOppDesc', 'polarisTopConf', 'polarisPipeline', 'polarisPipeConf', 'polarisFocus', 'polarisFocusDesc', 'polarisFocusConf'].forEach(function (id) { setText(id, '\u2014'); });
      return;
    }
    setText('polarisTopOpp', selected.serviceText);
    setText('polarisTopOppDesc', selected.customerPriceText);
    setText('polarisTopConf', selected.confidenceText);
    setText('polarisPipeline', metrics && metrics.estimatedRevenue !== null ? '$' + Number(metrics.estimatedRevenue).toLocaleString() : '\u2014');
    setText('polarisPipeConf', 'Role-authorized values');
    setText('polarisFocus', selected.recommendedActionText || '\u2014');
    setText('polarisFocusDesc', 'Based on the latest role-authorized customer and work evidence');
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
