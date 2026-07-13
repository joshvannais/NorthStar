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

    const insight = `${svc} — ${diff.label}. ${demand.desc}. ` +
      `Estimated market-adjusted price: $${estimatedPrice.toLocaleString()}. ` +
      `${upsell}. Confidence: ${confidence}%.`;

    const result = { insight, confidence, estimatedPrice, difficulty, demand: category.demand, upsell, service: svc };

    bus.emit('polaris:analysis-complete', { leadId: lead.id, result });
    // Persist analysis to the Lead in AppStore so drawer/cards read persisted data
    if (store && typeof store.updateLead === 'function' && lead && lead.id) {
      try { store.updateLead(lead.id, { polarisAnalysis: result }); } catch(e) {}
    }
    return result;
  }

  return { analyzeLead, capitalizeFirst };
})();
