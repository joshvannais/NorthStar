'use strict';
const assert = require('node:assert/strict');
async function assertDrawerHierarchy(page, label) {
  const state = await page.evaluate(() => {
    const q = selector => document.querySelector(selector);
    const before = (a,b) => Boolean(q(a).compareDocumentPosition(q(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      headings: Array.from(q('#cdCustomerDrawer').querySelectorAll('h3,summary')).map(e=>e.textContent.trim()),
      order: before('.drawer-header','.drawer-primary-actions') && before('.drawer-primary-actions','#cdEstimateHub') && before('#cdEstimateHub','#cdPolarisInsight') && before('#cdPolarisInsight','#cdEstimateDetails') && before('#cdEstimateDetails','#cdCustomerWorkArea') && before('#cdCustomerWorkArea','#cdCustomerActivityArea'),
      description: q('#cdJobDescription').textContent.trim(),
      descriptionFollowsTitle: q('#cdPolarisInsight > h3').nextElementSibling === q('#cdJobDescription'),
      scopeInsidePolaris: q('#cdPolarisInsight').contains(q('.drawer-polaris-analysis')) && q('#cdPolarisInsight').contains(q('#cdTravelDetails')) && q('#cdPolarisInsight').contains(q('#cdChargeDetails')),
      attentionInsidePolaris: q('#cdPolarisInsight').contains(q('#cdAttentionSection')),
      pricingInsideEstimate: q('#cdEstimateDetails').contains(q('.drawer-polaris-pricing')),
      capellaInsideEstimate: q('#cdEstimateDetails').contains(q('#cdCapellaReview')),
      backgroundRetained: q('#cdCustomerActivityArea').contains(q('.drawer-customer-background')) && q('.drawer-customer-background').contains(q('#cdProfileStatus')) && !q('.drawer-customer-background').textContent.includes('Contact Information'),
      actions: ['cdBtnAskPolaris','cdBtnSchedule','cdBtnContact'].every(id=>q('.drawer-primary-actions').contains(q('#'+id))),
      scopeFacts: q('#cdDescription').children.length
    };
  });
  for (const heading of ['Scope Details','Edit Travel And Work Time','Original Charge Details','Estimate Details','Schedule & Work','Activity','Customer History']) assert.ok(state.headings.includes(heading),label+' retains '+heading);
  assert.ok(state.order && state.actions,label+' keeps actions, estimate, intelligence, work and activity in the approved order');
  assert.ok(state.description && state.descriptionFollowsTitle && state.scopeFacts,label+' keeps readable description directly beneath Polaris and structured facts below');
  assert.ok(state.scopeInsidePolaris && state.attentionInsidePolaris,label+' keeps scope and attention inside Polaris');
  assert.ok(state.pricingInsideEstimate && state.capellaInsideEstimate && state.backgroundRetained,label+' keeps estimate review together and customer history inside Activity');
}
module.exports = { assertDrawerHierarchy };
