// Simulate the PolarisEngine flow
const PolarisEngine = (function() {
  const store = { updateLead: function(id, updates) { /* no-op */ } };
  const bus = { emit: function() {} };
  const serviceCategories = {
    'HVAC Repair': { demand: 'high', seasonal: 'summer', margin: 'medium' },
    'Plumbing Repair': { demand: 'high', seasonal: 'year-round', margin: 'medium' },
    'Electrical Repair': { demand: 'high', seasonal: 'year-round', margin: 'high' },
    'Roofing': { demand: 'medium', seasonal: 'fall', margin: 'high' }
  };

  function analyzeLead(lead) {
    if (!lead) return { insight: 'No lead data available.', confidence: 0 };
    const svc = lead.service || 'General Service';
    const basePrice = lead.avgPrice || 0;
    const category = serviceCategories[svc] || { demand: 'medium', seasonal: 'year-round', margin: 'medium' };
    const scope = lead.description ? lead.description.length : 50;
    const difficulty = scope > 200 ? 'high' : scope > 100 ? 'medium' : 'low';
    const demandFactors = { high: { multiplier: 1.3, desc: 'Strong market demand' }, medium: { multiplier: 1.0, desc: 'Steady market demand' }, low: { multiplier: 0.8, desc: 'Niche market service' } };
    const difficultyFactors = { high: { premium: 1.4, label: 'Complex project requiring specialized expertise' }, medium: { premium: 1.15, label: 'Moderate complexity project' }, low: { premium: 0.95, label: 'Straightforward service' } };
    const demand = demandFactors[category.demand] || demandFactors.medium;
    const diff = difficultyFactors[difficulty] || difficultyFactors.medium;
    const estimatedPrice = Math.round(basePrice * demand.multiplier * diff.premium);
    const confidence = Math.min(95, Math.round(65 + (scope > 50 ? 15 : 0) + (basePrice > 0 ? 10 : 0)));
    const upsell = scope > 150 ? 'Consider recommending preventative maintenance package' : scope > 80 ? 'Additional inspection may reveal complementary service needs' : 'Standard service upsell opportunity limited';
    const insight = svc + ' ' + diff.label + '. ' + demand.desc + '. Estimated market-adjusted price: $' + estimatedPrice.toLocaleString() + '. ' + upsell + '. Confidence: ' + confidence + '%.';
    const result = { insight, confidence, estimatedPrice, difficulty, demand: category.demand, upsell, service: svc };
    if (store && typeof store.updateLead === 'function' && lead && lead.id) {
      try { store.updateLead(lead.id, { polarisAnalysis: result }); } catch(e) {}
    }
    return result;
  }

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
    if (count > 0) console.log('Analyzed ' + count + ' leads');
  }

  return { analyzeLead, ensurePolarisAnalysis };
})();

// Create a simulated lead (like from sessionStorage)
var leads = [
  { id: 'test1', caller: 'John Smith', service: 'HVAC Repair', avgPrice: 2500, description: 'AC unit not cooling properly after 3 days of use' },
  { id: 'test2', caller: 'Jane Doe', service: 'Plumbing Repair', avgPrice: 800, description: 'Leaky faucet' }
];

// Ensure analysis
PolarisEngine.ensurePolarisAnalysis(leads);

console.log('Lead 1 polaris:', leads[0].polarisAnalysis ? 'present' : 'null');
console.log('Lead 2 polaris:', leads[1].polarisAnalysis ? 'present' : 'null');

if (leads[0].polarisAnalysis) {
  console.log('Lead 1 estimatedPrice:', leads[0].polarisAnalysis.estimatedPrice);
  console.log('Lead 1 confidence:', leads[0].polarisAnalysis.confidence);
  console.log('Lead 1 service:', leads[0].polarisAnalysis.service);
}

// Simulate JSON round-trip (sessionStorage)
var sessionData = JSON.stringify(leads);
var loadedLeads = JSON.parse(sessionData);

console.log('\nAfter JSON round-trip:');
console.log('Lead 1 polaris:', loadedLeads[0].polarisAnalysis ? 'present' : 'null');
var check = !loadedLeads[0].polarisAnalysis;
console.log('!lead.polarisAnalysis:', check);
console.log('estimatedPrice:', loadedLeads[0].polarisAnalysis.estimatedPrice);

// Can the renderer read from it?
var top = loadedLeads[0];
var a = top.polarisAnalysis;
var p = a ? (a.estimatedPrice || 0) : (top.avgPrice || 0);
console.log('Renderer would read estimatedPrice:', p);