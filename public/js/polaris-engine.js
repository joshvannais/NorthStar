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
    // debug log removed for production
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


  // ═══════════════════════════════════════════════════════════════
  //  Polaris Estimating Engine — Data-Driven Configuration
  //  Load estimation data from this config object.
  //  Replace or extend at runtime via PolarisEngine.loadEstimationConfig()
  // ═══════════════════════════════════════════════════════════════

  var estimationConfig = {
    // Regional multipliers applied to labor rates (index by state or region)
    regions: {
      'default':    { label: 'National Average', laborMultiplier: 1.0, materialMultiplier: 1.0 },
      'northeast':  { label: 'Northeast',        laborMultiplier: 1.25, materialMultiplier: 1.1 },
      'midwest':    { label: 'Midwest',          laborMultiplier: 0.85, materialMultiplier: 0.95 },
      'south':      { label: 'South',            laborMultiplier: 0.9,  materialMultiplier: 0.95 },
      'west':       { label: 'West Coast',       laborMultiplier: 1.2,  materialMultiplier: 1.15 },
      'california': { label: 'California',       laborMultiplier: 1.35, materialMultiplier: 1.2 },
    },

    // Labor rates (hourly) by service type
    laborRates: {
      'HVAC Repair':        { baseHours: 2.5, hourlyRate: 95,  skillLevel: 'skilled' },
      'HVAC Installation':  { baseHours: 6.0, hourlyRate: 110, skillLevel: 'expert' },
      'Plumbing':           { baseHours: 2.0, hourlyRate: 90,  skillLevel: 'skilled' },
      'Plumbing Repair':    { baseHours: 2.0, hourlyRate: 90,  skillLevel: 'skilled' },
      'Electrical':         { baseHours: 2.0, hourlyRate: 100, skillLevel: 'expert' },
      'Electrical Repair':  { baseHours: 2.0, hourlyRate: 100, skillLevel: 'expert' },
      'Roofing':            { baseHours: 8.0, hourlyRate: 85,  skillLevel: 'skilled' },
      'Landscaping':        { baseHours: 3.0, hourlyRate: 65,  skillLevel: 'general' },
      'Tree removal':       { baseHours: 4.0, hourlyRate: 95,  skillLevel: 'expert' },
      'Chimney Service':    { baseHours: 2.0, hourlyRate: 85,  skillLevel: 'skilled' },
      'Flooring':           { baseHours: 4.0, hourlyRate: 75,  skillLevel: 'skilled' },
      'General':            { baseHours: 2.0, hourlyRate: 80,  skillLevel: 'general' },
    },

    // Default labor rate for services not explicitly listed
    defaultLabor: { baseHours: 2.0, hourlyRate: 80, skillLevel: 'general' },

    // Material cost bundles by service type (estimate averages)
    materialCosts: {
      'HVAC Repair':        { parts: 180,  supplies: 45,  equipment: 0 },
      'HVAC Installation':  { parts: 1200, supplies: 150, equipment: 350 },
      'Plumbing':           { parts: 150,  supplies: 35,  equipment: 0 },
      'Plumbing Repair':    { parts: 120,  supplies: 30,  equipment: 0 },
      'Electrical':         { parts: 85,   supplies: 25,  equipment: 0 },
      'Electrical Repair':  { parts: 65,   supplies: 20,  equipment: 0 },
      'Roofing':            { parts: 1800, supplies: 350, equipment: 0 },
      'Landscaping':        { parts: 250,  supplies: 80,  equipment: 120 },
      'Tree removal':       { parts: 0,    supplies: 50,  equipment: 200 },
      'Chimney Service':    { parts: 120,  supplies: 40,  equipment: 0 },
      'Flooring':           { parts: 600,  supplies: 100, equipment: 50 },
      'General':            { parts: 100,  supplies: 30,  equipment: 0 },
    },

    // Overhead and fees
    overhead: {
      travelFee:      { label: 'Travel Fee',          pct: 0.05,  min: 25,  description: '5% of labor for travel time' },
      disposalFee:    { label: 'Disposal Fee',        pct: 0.03,  min: 15,  description: '3% for waste disposal and recycling' },
      permitFee:      { label: 'Permit Fee',          pct: 0.02,  min: 0,   description: '2% for permits and inspections' },
      overheadPct:    0.15,   // 15% overhead on direct costs
      profitMargin:   0.20,   // 20% target profit margin
      taxRate:        0.07,   // 7% sales tax (varies by region — overrideable)
    },

    // Confidence scoring thresholds
    confidence: {
      dataRich:      { min: 80, label: 'High',   desc: 'Confidence: High — detailed lead data available' },
      dataPartial:   { min: 50, label: 'Medium', desc: 'Confidence: Medium — partial lead data' },
      dataMinimal:   { min: 0,  label: 'Low',    desc: 'Confidence: Low — estimate based on service type only' },
    },

    // Difficulty multipliers
    difficultyLevels: {
      low:    { label: 'Straightforward', laborPremium: 1.0,  materialPremium: 1.0,  complexityDesc: 'Straightforward service' },
      medium: { label: 'Moderate',        laborPremium: 1.15, materialPremium: 1.1,  complexityDesc: 'Moderate complexity project' },
      high:   { label: 'Complex',         laborPremium: 1.35, materialPremium: 1.2,  complexityDesc: 'Complex project requiring specialized expertise' },
    },
  };

  /**
   * Load a custom estimation configuration (replaces defaults).
   * @param {object} config - Partial or full estimation config to merge
   */
  function loadEstimationConfig(config) {
    if (!config) return;
    estimationConfig = deepMerge(estimationConfig, config);
    bus.emit('polaris:config-updated', {});
  }

  /** Simple deep merge helper */
  function deepMerge(target, source) {
    var result = {};
    for (var key in target) result[key] = target[key];
    for (var key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  /**
   * Determine service difficulty based on lead data.
   */
  function assessDifficulty(lead) {
    if (!lead) return 'low';
    var scope = 0;
    if (lead.description) scope += lead.description.length;
    if (lead.summary) scope += lead.summary.length;
    if (lead.jobDetail) scope += lead.jobDetail.length;
    if (scope > 200) return 'high';
    if (scope > 100) return 'medium';
    // Fall back to service-level difficulty
    var svc = lead.service || lead.serviceRequested || 'General';
    var labor = estimationConfig.laborRates[svc] || estimationConfig.defaultLabor;
    if (labor.skillLevel === 'expert') return 'medium';
    return 'low';
  }

  /**
   * Generate a complete line-item estimate for a lead.
   * @param {object} lead - Lead object from AppStore
   * @param {object} options - { region, profitMargin, taxRate } overrides
   * @returns {object} Standardized estimate
   */
  function generateEstimate(lead, options) {
    if (!lead) return null;
    options = options || {};

    var svc = lead.service || lead.serviceRequested || 'General';
    var difficulty = assessDifficulty(lead);
    var diffConfig = estimationConfig.difficultyLevels[difficulty] || estimationConfig.difficultyLevels.low;
    var region = estimationConfig.regions[options.region] || estimationConfig.regions['default'];
    var ov = estimationConfig.overhead;
    var profitPct = options.profitMargin !== undefined ? options.profitMargin : ov.profitMargin;
    var taxRate = options.taxRate !== undefined ? options.taxRate : ov.taxRate;
    var items = [];

    // ── Labor Calculation ──
    var laborConfig = estimationConfig.laborRates[svc] || estimationConfig.defaultLabor;
    var hours = options.hours || laborConfig.baseHours;
    var hourlyRate = laborConfig.hourlyRate * region.laborMultiplier * diffConfig.laborPremium;
    var laborCost = Math.round(hours * hourlyRate * 100) / 100;
    items.push({
      type: 'labor', label: 'Labor — ' + svc,
      description: hours + ' hrs @ $' + Math.round(hourlyRate) + '/hr (' + diffConfig.label + ')',
      quantity: hours, unitPrice: Math.round(hourlyRate * 100) / 100, amount: laborCost
    });

    // ── Materials Calculation ──
    var mats = estimationConfig.materialCosts[svc] || estimationConfig.materialCosts['General'];
    var materialCost = Math.round((mats.parts + mats.supplies) * region.materialMultiplier * diffConfig.materialPremium * 100) / 100;
    if (materialCost > 0) {
      items.push({
        type: 'materials', label: 'Materials',
        description: 'Parts & supplies for ' + svc,
        quantity: 1, unitPrice: materialCost, amount: materialCost
      });
    }

    // ── Equipment Cost ──
    var equipCost = Math.round(mats.equipment * region.materialMultiplier * 100) / 100;
    if (equipCost > 0) {
      items.push({
        type: 'equipment', label: 'Equipment',
        description: 'Specialized equipment rental or usage',
        quantity: 1, unitPrice: equipCost, amount: equipCost
      });
    }

    // ── Travel Fee ──
    var travelPct = ov.travelFee.pct;
    var travelCost = Math.max(Math.round(laborCost * travelPct * 100) / 100, ov.travelFee.min);
    items.push({
      type: 'travel', label: ov.travelFee.label,
      description: ov.travelFee.description,
      quantity: 1, unitPrice: travelCost, amount: travelCost
    });

    // ── Disposal Fee ──
    var disposalPct = ov.disposalFee.pct;
    var disposalCost = Math.max(Math.round((materialCost + equipCost) * disposalPct * 100) / 100, ov.disposalFee.min);
    if (disposalCost > 0) {
      items.push({
        type: 'disposal', label: ov.disposalFee.label,
        description: ov.disposalFee.description,
        quantity: 1, unitPrice: disposalCost, amount: disposalCost
      });
    }

    // ── Permit Fee ──
    var permitPct = ov.permitFee.pct;
    var permitCost = Math.round((laborCost + materialCost) * permitPct * 100) / 100;
    if (permitCost > ov.permitFee.min) {
      items.push({
        type: 'permit', label: ov.permitFee.label,
        description: ov.permitFee.description,
        quantity: 1, unitPrice: permitCost, amount: permitCost
      });
    }

    // ── Totals ──
    var subtotalBeforeOverhead = items.reduce(function(s, i) { return s + i.amount; }, 0);
    var overheadCost = Math.round(subtotalBeforeOverhead * ov.overheadPct * 100) / 100;
    items.push({
      type: 'overhead', label: 'Overhead',
      description: Math.round(ov.overheadPct * 100) + '% on direct costs for office, insurance, etc.',
      quantity: 1, unitPrice: overheadCost, amount: overheadCost
    });

    var subtotal = subtotalBeforeOverhead + overheadCost;
    var profit = Math.round(subtotal * profitPct * 100) / 100;
    items.push({
      type: 'profit', label: 'Profit Margin',
      description: Math.round(profitPct * 100) + '% target profit',
      quantity: 1, unitPrice: profit, amount: profit
    });

    var beforeTax = subtotal + profit;
    var tax = Math.round(beforeTax * taxRate * 100) / 100;
    if (tax > 0) {
      items.push({
        type: 'tax', label: 'Sales Tax',
        description: Math.round(taxRate * 100) + '% sales tax',
        quantity: 1, unitPrice: tax, amount: tax
      });
    }

    var total = beforeTax + tax;

    // ── Confidence Score ──
    var confidence = 0, confLabel = 'Low';
    var dataPoints = 0;
    if (lead.avgPrice && lead.avgPrice > 0) dataPoints++;
    if (lead.description) dataPoints++;
    if (lead.summary) dataPoints++;
    if (lead.jobDetail) dataPoints++;
    if (lead.address || lead.jobAddress) dataPoints++;
    if (lead.polarisAnalysis && lead.polarisAnalysis.confidence) dataPoints += 2;
    if (dataPoints >= 4) { confidence = 85; confLabel = 'High'; }
    else if (dataPoints >= 2) { confidence = 65; confLabel = 'Medium'; }
    else { confidence = 40; confLabel = 'Low'; }

    // ── AI Reasoning ──
    var reasoning = '';
    reasoning += 'Estimate generated for ' + svc + ' (' + diffConfig.label + ' difficulty). ';
    reasoning += 'Based on ' + hours + ' hours of labor at regional rate of $' + Math.round(hourlyRate) + '/hr. ';
    reasoning += 'Material costs calculated using ' + region.label + ' pricing multipliers. ';
    reasoning += 'Includes overhead (' + Math.round(ov.overheadPct * 100) + '%), ';
    reasoning += 'profit margin (' + Math.round(profitPct * 100) + '%), ';
    reasoning += 'and applicable taxes (' + Math.round(taxRate * 100) + '%).';
    if (difficulty === 'high') reasoning += ' Complexity premium applied for specialized work.';
    reasoning += ' Confidence: ' + confLabel + ' (' + confidence + '%).';

    // ── Upsell Recommendations ──
    var upsells = [];
    if (svc.indexOf('HVAC') >= 0) {
      upsells.push({ label: 'Preventative Maintenance Plan', amount: Math.round(total * 0.08), description: 'Annual HVAC maintenance to extend equipment life' });
    }
    if (svc.indexOf('Plumbing') >= 0) {
      upsells.push({ label: 'Water Heater Flush', amount: Math.round(total * 0.05), description: 'Extend water heater lifespan with annual flush' });
    }
    if (svc.indexOf('Roofing') >= 0) {
      upsells.push({ label: 'Gutter Guard Installation', amount: Math.round(total * 0.12), description: 'Protect roof with gutter guards — reduces maintenance' });
    }
    if (svc.indexOf('Electrical') >= 0) {
      upsells.push({ label: 'Surge Protection System', amount: Math.round(total * 0.06), description: 'Whole-home surge protection for sensitive electronics' });
    }

    var estimate = {
      leadId: lead.id,
      service: svc,
      difficulty: difficulty,
      difficultyLabel: diffConfig.label,
      region: region.label,
      items: items,
      labor: laborCost,
      materials: materialCost,
      equipment: equipCost,
      travel: travelCost,
      disposal: disposalCost,
      permit: permitCost,
      overhead: overheadCost,
      profitMargin: profit,
      taxes: tax,
      subtotal: subtotal,
      total: total,
      confidence: confidence,
      confidenceLabel: confLabel,
      confidenceDescription: dataPoints >= 4 ? 'Detailed lead data available' : dataPoints >= 2 ? 'Partial lead data' : 'Estimate based on service type only',
      reasoning: reasoning,
      upsells: upsells,
      generatedAt: new Date().toISOString(),
    };

    // Persist estimate to the lead
    if (store && typeof store.updateLead === 'function' && lead.id) {
      try { store.updateLead(lead.id, { polarisEstimate: estimate }); } catch(e) {}
    }

    bus.emit('polaris:estimate-generated', { leadId: lead.id, estimate: estimate });
    return estimate;
  }

  return { analyzeLead, capitalizeFirst, ensurePolarisAnalysis, renderPolarisCard, generateEstimate, loadEstimationConfig, assessDifficulty };

})();