(function(root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NorthStarSavedMaterialReview = api;
})(typeof window === 'object' ? window : this, function() {
  'use strict';
  // Display the authorized review only: no price, cost, freshness or stock calculation.
  function amount(value, currency) {
    if (!/^[A-Z]{3}$/.test(currency || '')) return 'Unavailable';
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(String(value))) value = value.toFixed(2);
    return typeof value === 'string' && /^-?(0|[1-9][0-9]{0,11})\.[0-9]{2}$/.test(value) ? currency + ' ' + value : 'Unavailable';
  }
  function date(value) {
    var d = typeof value === 'string' ? new Date(value) : null;
    return d && Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-US', {year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(d) + ' (UTC)' : 'Date Not Recorded';
  }
  function project(review) {
    if (!review || review.contract !== 'NorthStarEstimateReview/v1' || !review.pins || !review.pins.estimateId || !Array.isArray(review.rows)) throw new Error('review_unavailable');
    var adopted = review.adoptedMaterialPlan, current = review.materialPlans && review.materialPlans.current;
    var row = review.rows.find(function(r) { return r.label === 'Recorded material cost'; });
    var total = adopted ? review.financialCosts && review.financialCosts.knownDirectMaterialCost : row && row.sourceState === 'recorded' ? row.amount : null;
    var facts = [ ['Estimate', (review.selectedRevision || 1) + (review.isCurrent === false ? ' — Earlier Review' : ' — Current Review')],
      ['Recorded', date(review.recordedAt)], ['Included Material Cost', amount(total, review.currency)] ];
    if (adopted) facts.push(['Included Materials', String(adopted.inputs && Array.isArray(adopted.inputs.lines) ? adopted.inputs.lines.length : 1)]);
    var notes = [adopted ? 'This estimate includes the saved material plan. Other included costs and original price guidance keep the basis shown in this review.' : 'Material cost comes from the original estimate. A later saved plan is included only after it is used in an estimate.'];
    if (current && current.action === 'save' && (!adopted || current.id !== adopted.id)) {
      facts.push(['Latest Saved Plan', amount(current.result && current.result.total, current.currency)]);
      notes.push('The latest saved plan is separate from the material costs included in this estimate.');
    } else if (current && current.action === 'withdraw') notes.push('The latest plan was withdrawn. Earlier estimates keep their recorded material history.');
    if (adopted) {
      var source = adopted.currentSourceAssessment, availability = adopted.currentAvailabilityAssessment;
      if (adopted.inputs && adopted.inputs.sourceAssessment) notes.push('Saved Source Review: ' + date(adopted.inputs.sourceAssessment.asOfDate) + '. Current Date Check: ' + date(source && source.asOfDate) + '.');
      notes.push(!source ? 'Cost source details were not recorded with this plan.' : source.lines.some(function(l) { return l.flags.length; }) ? 'Some cost sources need review. Open the material plan for its dated cautions.' : 'Cost sources are human-recorded; supplier prices are not independently verified.');
      var shortages=availability ? availability.lines.filter(function(line){return line.currentStatus==='reported_shortage';}).length : 0;
      if(shortages) notes.push('Reported shortages affect ' + shortages + (shortages===1?' material.':' materials.') + ' Review the quantities and units in the material plan before arranging supplies.');
      notes.push(!availability ? 'Availability evidence was not recorded with this plan.' : availability.lines.some(function(l) { return l.flags.length; }) ? 'Some availability evidence needs review. Check the material plan before arranging supplies.' : 'Recorded availability is not a reservation or a purchase confirmation.');
    }
    var labor=review.adoptedLaborPlan, latestLabor=review.laborPlans&&review.laborPlans.current;
    var laborRow=review.rows.find(function(r){return r.label==='Recorded labor cost';});
    facts.push(['Included Labor Cost',amount(labor?review.financialCosts&&review.financialCosts.knownInternalLaborCost:laborRow&&laborRow.sourceState==='recorded'?laborRow.amount:null,review.currency)]);
    notes.push(labor?'Labor costs use the included saved task plan.':'Labor costs retain the original estimate basis.');
    if(labor){facts.push(['Included Worker-Hours',labor.result.workerHours]);notes.push('Task source information is human-recorded. Combined worker-hours do not establish project duration.');if(labor.currentAssessment&&labor.currentAssessment.cautions.length)notes.push('Some included labor source dates or applicability need review.');}
    if(latestLabor&&latestLabor.action==='save'&&(!labor||latestLabor.id!==labor.id)){facts.push(['Latest Saved Labor Plan',amount(latestLabor.result&&latestLabor.result.total,review.currency)]);notes.push('The latest labor plan is separate from the costs included in this estimate.');}
    if(latestLabor&&latestLabor.action==='withdraw')notes.push('The latest labor plan was withdrawn. Earlier estimates keep their included labor history.');
    var equipment=review.adoptedEquipmentCostPlan,latestEquipment=review.equipmentCostPlans&&review.equipmentCostPlans.current,equipmentRow=review.rows.find(function(r){return r.label==='Recorded equipment cost';});
    facts.push(['Included Equipment Cost',amount(equipment?review.financialCosts&&review.financialCosts.knownEquipmentCost:equipmentRow&&equipmentRow.sourceState==='recorded'?equipmentRow.amount:null,review.currency)]);
    notes.push(equipment?'Equipment costs use the included declared allocation. This does not verify ownership, supplier prices, suitability or availability.':'Equipment costs retain the original estimate basis.');
    if(latestEquipment&&latestEquipment.action==='save'&&(!equipment||latestEquipment.id!==equipment.id)){facts.push(['Latest Saved Equipment Costs',amount(latestEquipment.result&&latestEquipment.result.total,review.currency)]);notes.push('The latest equipment costs are separate from the costs included in this estimate.');}
    if(latestEquipment&&latestEquipment.action==='withdraw')notes.push('The equipment cost plan was withdrawn. Earlier estimates retain their included costs.');
    var risk = review.riskReview;
    if (risk && ['compared','shortfall'].indexOf(risk.state) >= 0) {
      facts.push(['Reviewed Price Before Tax', amount(risk.priceBeforeTax, review.currency)], ['Recorded Direct Costs', amount(risk.recordedDirectCosts, review.currency)], ['Remaining After Direct Costs', amount(risk.remainingAfterDirectCosts, review.currency)]);
      notes.push(risk.state === 'shortfall' ? 'The reviewed price is below recorded direct costs. Additional expenses may increase the shortfall.' : 'Additional expenses may reduce the amount remaining. This is not a profit forecast.');
    } else notes.push(risk && risk.state === 'costs_unavailable' ? 'Some direct costs are missing. A complete cost comparison is unavailable.' : 'A matching scope and price review is needed before comparing the reviewed price with costs.');
    if (review.simulated) notes.push('This review uses the simulated business records.');
    return {facts:facts,notes:notes};
  }
  function text(model) { return model.facts.map(function(f) { return f[0] + ': ' + f[1]; }).join('. ') + '. ' + model.notes.join(' '); }
  function render(host, model) {
    host.replaceChildren();
    var doc = host.ownerDocument, list = doc.createElement('dl');
    model.facts.forEach(function(f) { var term=doc.createElement('dt'), value=doc.createElement('dd'); term.textContent=f[0]; value.textContent=f[1]; list.append(term,value); });
    host.append(list);
    var limitation=doc.createElement('p'); limitation.textContent=model.notes.find(function(n){return /matching scope|direct costs are missing|profit forecast|shortfall/.test(n);}) || 'Review the recorded basis and cautions before relying on these costs.'; host.append(limitation);
    var notes=doc.createElement('details'), summary=doc.createElement('summary'); summary.textContent='Basis And Cautions'; notes.append(summary);
    model.notes.filter(function(note){return note!==limitation.textContent;}).forEach(function(note) { var p=doc.createElement('p'); p.textContent=note; notes.append(p); }); host.append(notes);
  }
  return {project:project,render:render,text:text,amount:amount};
});
