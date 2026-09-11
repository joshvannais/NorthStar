'use strict';
const assert = require('node:assert/strict');
async function assertDrawerHierarchy(page, label) {
  const state = await page.evaluate(() => {
    const q = selector => document.querySelector(selector);
    const before = (a,b) => Boolean(q(a).compareDocumentPosition(q(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      headings: Array.from(q('#cdCustomerDrawer').querySelectorAll('h3,summary')).map(e=>e.textContent.trim()),
      order: before('.drawer-header','.drawer-primary-actions') && before('.drawer-primary-actions','#cdPolarisInsight') && before('#cdPolarisInsight','#cdAttentionSection') && before('#cdAttentionSection','.drawer-customer-background'),
      description: q('#cdJobDescription').textContent.trim(),
      descriptionFollowsTitle: q('#cdPolarisInsight > h3').nextElementSibling === q('#cdJobDescription'),
      pricingInside: q('#cdPolarisInsight').contains(q('.drawer-polaris-pricing')),
      backgroundRetained: q('.drawer-customer-background').contains(q('#cdProfileStatus')) && !q('.drawer-customer-background').textContent.includes('Contact Information'),
      capellaSibling: q('#cdPolarisInsight').parentElement.nextElementSibling === q('#cdCapellaReview') && !q('#cdCapellaReview').closest('details'),
      actions: ['cdBtnAskPolaris','cdBtnSchedule','cdBtnContact'].every(id=>q('.drawer-primary-actions').contains(q('#'+id))),
      scopeFacts: q('#cdDescription').children.length
    };
  });
  for (const heading of ['Scope Details','Travel And Work Time','Original Charge Details','Price Breakdown And Estimate Review','Customer History']) assert.ok(state.headings.includes(heading),label+' retains '+heading);
  assert.ok(state.order && state.actions,label+' keeps identity/actions before Polaris and history below');
  assert.ok(state.description && state.descriptionFollowsTitle && state.scopeFacts,label+' keeps readable description directly beneath Polaris and structured facts below');
  assert.ok(state.pricingInside && state.backgroundRetained && state.capellaSibling,label+' preserves review placement, independent Capella and unduplicated history');
}
module.exports = { assertDrawerHierarchy };
