'use strict';
const assert = require('node:assert/strict');
// Check rendered product copy and accessible names, not source code, data
// attributes or hidden internal request pins. Synthetic business content only.
async function assertUserWording(page, label) {
  const shown = await page.evaluate(() => {
    const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const attributes = [...document.querySelectorAll('[aria-label],[title],[placeholder]')].filter(visible)
      .flatMap(e => ['aria-label','title','placeholder'].map(a => e.getAttribute(a) || ''));
    return [document.body.innerText,...attributes].join('\n');
  });
  const implementation = /\b(?:PostgreSQL|SHA-?256|digest|idempotency|canonical|tenant|runtime|payload|schema|endpoint|SQL|API|HTTP|server-owned|server snapshot|execution revision|assignment revision|source pins?|immutable history|fieldEvidence)\b|\/api\/|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{64}\b/i;
  assert.doesNotMatch(shown, implementation, label + ': implementation wording or identifiers reached a user surface');
  return { label, visibleTextAndAccessibleNamesChecked: true };
}
module.exports = { assertUserWording };
