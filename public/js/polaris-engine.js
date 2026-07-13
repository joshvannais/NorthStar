/**
 * PolarisEngine — Centralized Polaris™ Revenue Intelligence
 * Single source of all AI reasoning across all pages
 */
window.PolarisEngine = (function() {
  const bus = window.EventBus;
  const store = window.AppStore;

  const serviceCategories = {
    'HVAC Repair': { demand: 'high', seasonal: 'summer', margin: 'medium' },
    'HVAC Installation': { demand: 'high', seasonal: 'summer', margin: 'high' },
    'Plumbing Repair': { demand: 'high', seasonal: 'year-round', margin: 'medium' },
    'Electrical Repair': { demand: 'high', seasonal: 'year-round', margin: 'high' },
    'Roofing': { demand: 'medium', seasonal: 'fall', margin: 'high' },
    'Landscaping': { demand: 'medium', seasonal: 'spring', margin: 'low' },
    'Chimney Service': { demand: 'low', seasonal: 'fall', margin: 'medium' }
  };

  function capitalizeFirst(str) {
    if (!str) return '';
    return str.replace(/\b\w/g, c => c.toUpperCase());
  }

  function analyzeLead(lead) {
    if (!lead) return { insight: 'No lead data available.', confidence: 0 };

    const svc = lead.service || 'General Service';
    const basePrice = lead.avgPrice || 0;
    const category = serviceCategories[svc] || { demand: 'medium', seasonal: 'year-round', margin: 'medium' };
    const scope = lead.description ? lead.description.length : 50;
    const difficulty = scope > 200 ? 'high' : scope > 100 ? 'medium' : 'low';

    const demandFactors = {
      high: { multiplier: 1.3, desc: 'Strong market demand' },
      medium: { multiplier: 1.0, desc: 'Steady market demand' },
      low: { multiplier: 0.8, desc: 'Niche market service' }
    };

    const difficultyFactors = {
      high: { premium: 1.4, label: 'Complex project requiring specialized expertise' },
      medium: { premium: 1.15, label: 'Moderate complexity project' },
      low: { premium: 0.95, label: 'Straightforward service' }
    };

    const demand = demandFactors[category.demand] || demandFactors.medium;
    const diff = difficultyFactors[difficulty] || difficultyFactors.medium;
    const estimatedPrice = Math.round(basePrice * demand.multiplier * diff.premium);
    const confidence = Math.min(95, Math.round(65 + (scope > 50 ? 15 : 0) + (basePrice > 0 ? 10 : 0)));

    const upsell = scope > 150
      ? 'Consider recommending preventative maintenance package'
      : scope > 80
        ? 'Additional inspection may reveal complementary service needs'
        : 'Standard service — upsell opportunity limited';

    const insight = svc + ' — ' + diff.label + '. ' + demand.desc + '. ' +
      'Estimated market-adjusted price: $' + estimatedPrice.toLocaleString() + '. ' +
      upsell + '. Confidence: ' + confidence + '%.';

    const result = { insight, confidence, estimatedPrice, difficulty, demand: category.demand, upsell, service: svc };

    bus.emit('polaris:analysis-complete', { leadId: lead.id, result });
    // Persist analysis to the Lead in AppStore so drawer/cards read persisted data
    if (store && typeof store.updateLead === 'function' && lead && lead.id) {
      try { store.updateLead(lead.id, { polarisAnalysis: result }); } catch(e) {}
    }
    return result;
  }

  /**
   * Ensure every lead has persisted Polaris analysis.
   * Call once during initialization — does NOT re-analyze leads that already have it.
   */
  function ensurePolarisAnalysis(leads) {
    if (!leads || !store || !store.updateLead) return;
    var count = 0;
    for (var i = 0; i < leads.length; i++) {
      var lead = leads[i];
      if (lead && lead.id && !lead.polarisAnalysis) {
        analyzeLead(lead);
        count++;
      }
    }
    if (count > 0) console.log('[Polaris] Analyzed ' + count + ' leads without persisted analysis');
  }

  /**
   * Shared Polaris card renderer — single source of truth for all pages.
   * Reads from stored lead.polarisAnalysis and sets DOM elements.
   * Usage: PolarisEngine.renderPolarisCard(leads)
   */
  function renderPolarisCard(leads) {
    if (!leads || leads.length === 0) {
      setText('polarisTopOpp', '—');
      setText('polarisTopOppDesc', 'Add leads to see opportunities');
      setText('polarisPipeline', '$0');
      setText('polarisPipeConf', 'N/A');
      setClass('polarisPipeConf', 'polaris-confidence low');
      setText('polarisFocus', '—');
      setText('polarisFocusDesc', 'Simulate leads to get started');
      setText('polarisFocusConf', '—');
      setClass('polarisFocusConf', 'polaris-confidence');
      return;
    }

    // Ensure all leads have persisted analysis
    ensurePolarisAnalysis(leads);

    // Top opportunity = highest estimatedPrice from stored analysis
    var top = null, topPrice = 0;
    for (var i = 0; i < leads.length; i++) {
      var a = leads[i].polarisAnalysis;
      var p = a ? (a.estimatedPrice || 0) : (leads[i].avgPrice || 0);
      if (p > topPrice) { topPrice = p; top = leads[i]; }
    }
    if (top) {
      var topAnalysis = top.polarisAnalysis;
      setText('polarisTopOpp', top.caller || '—');
      setText('polarisTopOppDesc', '$' + Math.round(topPrice).toLocaleString() + ' — ' + (top.service || 'Service'));
      var topConf = topAnalysis ? topAnalysis.confidence || 0 : 0;
      var topConfLabel = topConf >= 80 ? 'High' : topConf >= 50 ? 'Medium' : 'Low';
      setText('polarisTopConf', topConfLabel);
      setClass('polarisTopConf', 'polaris-confidence ' + topConfLabel.toLowerCase());
    }

    // Pipeline = sum of all estimatedPrice from stored analysis
    var pipeline = 0;
    for (var j = 0; j < leads.length; j++) {
      var aj = leads[j].polarisAnalysis;
      pipeline += aj ? (aj.estimatedPrice || 0) : (leads[j].avgPrice || 0);
    }
    setText('polarisPipeline', '$' + Math.round(pipeline).toLocaleString());
    var pipeConfLabel = leads.length > 5 ? 'High' : leads.length > 2 ? 'Medium' : 'Low';
    setText('polarisPipeConf', pipeConfLabel);
    setClass('polarisPipeConf', 'polaris-confidence ' + pipeConfLabel.toLowerCase());

    // Recommended focus = highest volume service from analysis
    var svcCounts = {};
    for (var k = 0; k < leads.length; k++) {
      var svc = leads[k].polarisAnalysis ? leads[k].polarisAnalysis.service : (leads[k].service || 'Other');
      svcCounts[svc] = (svcCounts[svc] || 0) + 1;
    }
    var topSvc = '—', topSvcCount = 0;
    for (var svc in svcCounts) {
      if (svcCounts[svc] > topSvcCount) { topSvc = svc; topSvcCount = svcCounts[svc]; }
    }
    setText('polarisFocus', topSvc);
    setText('polarisFocusDesc', topSvcCount + ' lead' + (topSvcCount !== 1 ? 's' : '') + ' — highest volume service');
    var focusConfLabel = topSvcCount > 3 ? 'High' : topSvcCount > 1 ? 'Medium' : 'Low';
    setText('polarisFocusConf', focusConfLabel);
    setClass('polarisFocusConf', 'polaris-confidence ' + focusConfLabel.toLowerCase());
  }

  /** Helper: set textContent by element id */
  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  /** Helper: set className by element id */
  function setClass(id, cls) {
    var el = document.getElementById(id);
    if (el) el.className = cls;
  }

  return { analyzeLead, capitalizeFirst, ensurePolarisAnalysis, renderPolarisCard };
})();