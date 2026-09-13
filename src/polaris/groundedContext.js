'use strict';
const { digest } = require('./groundedConversation');
const { contractError } = require('./assistantContract');
function stableBasis(value) {
  if (Array.isArray(value)) return value.map(stableBasis);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'assessedAt').map(([key, child]) => [key, stableBasis(child)]));
  return value;
}
function handoffBasis(review) {
  return { decisionBasis: review.decisions?.writeBasis || null, plans: Object.fromEntries(['materialPlans','laborPlans','equipmentPlans','travelPlans','equipmentCostPlans','pricingPlans','pricingPolicies','commercialTerms'].map(key => [key, review[key]?.current?.digest || null])) };
}
function build({message, card, review = null, knowledge = null, authority }) {
  const evidence = [{ id: 'recorded_scope', label: 'Original Recorded Scope', value: card.answer, source: card.authority }];
  evidence.push(...card.evidence.map(e => ({ id: 'fact:' + e.id, label: 'Original Record: ' + e.label, value: e.value, source: e.source })));
  evidence.push(...card.unknowns.filter(e => !review || e.code !== 'customer_price_missing').map(e => ({ id: 'unknown:' + e.code, label: 'Original Record: Not Recorded', value: e.label, source: { evidenceId: 'recorded_scope' } })));
  if (knowledge) for (const [i, item] of knowledge.projection.items.entries()) {
    evidence.push({ id: 'knowledge:' + i, label: 'Published Business Guidance', value: item,
      source: knowledge.projection.sources[item.sourceIndex] });
  }
  const facts = [], proposals = [], allowedCards = [];
  if (review) {
    const b = review.capellaScenarios;
    facts.push({ label: 'Selected Estimate', value: review.selectedRevision, unit: 'revision' });
    if (b) {
      facts.push({ label: 'Known Direct Costs', value: b.directCosts, unit: b.currency });
      facts.push({ label: 'Additional Overhead', value: b.overhead?.incremental ?? null, unit: b.currency });
      for (const price of b.prices) facts.push({ label: price.label, value: price.amount, unit: b.currency });
    }
    evidence.push({ id: 'selected_estimate', label: 'Selected Estimate Review', value: {
      revision: review.selectedRevision, approval: review.approval, approvalMessage: review.approvalMessage,
      componentManifest: review.componentManifest || null, coverage: review.coverageAssessment || null,
      recommendations: review.groundedRecommendations?.items || [],
    }, source: review.pins });
    allowedCards.push('capella', 'estimate_review');
    if (review.isCurrent) for (const [field, editor, label] of [
      ['materialPlans', 'material', 'Review Material Plan'], ['laborPlans', 'labor', 'Review Labor Plan'],
      ['equipmentPlans', 'equipment', 'Review Equipment Plan'], ['travelPlans', 'travel', 'Review Travel Plan'],
    ]) {
      const plan = review[field];
      if (plan?.canMutate === true) proposals.push({ id: 'review_' + editor, editor, label,
        fields: plan.current?.action === 'save' ? plan.current.inputs : null,
        sourcePins: review.pins, planDigest: plan.current?.digest || null,
        evidenceIds: ['selected_estimate'], saveRequired: true, renewedReviewRequired: true });
    }
  }
  const proposed=require('./editorProposals').laborAssumption(message,review);
  if(proposed){evidence.push({id:'user_assumption',label:'Your Proposed Work-Time Assumption',value:{line:proposed.change.index+1,workerHours:proposed.change.value,unit:'worker-hours'},source:{kind:'explicit_user_assumption'}});proposals.unshift(proposed);proposals.splice(4);}
  if (evidence.length > 48) throw contractError('POLARIS_INPUT_TOO_LARGE', 'This record has too much supporting detail for one conversation. Review its saved details directly.', 413);
  return {
    evidence, proposals, allowedCards, trustedFacts: facts,
    basisDigest: digest(stableBasis({ authority, card, review, knowledge })),
    service: card.subtitle,
    sourceLimits: ['Recorded facts and published declarations are not independent verification.',
      'Original record facts and missing details describe the intake record; selected estimate costs and review may have changed later.',
      'Missing technical details can be supplied later by the owner or estimator.'],
  };
}
module.exports = { build, stableBasis, handoffBasis };
