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
  const implementation = /\b(?:executions?|durable|PostgreSQL|SHA-?256|digest|idempotency|canonical|tenant|runtime|payload|schema|endpoint|SQL|API|HTTP|server-owned|server snapshot|execution revision|assignment revision|source pins?|immutable history|fieldEvidence)\b|\/api\/|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{64}\b/i;
  assert.doesNotMatch(shown, implementation, label + ': implementation wording or identifiers reached a user surface');
  return { label, visibleTextAndAccessibleNamesChecked: true };
}
module.exports = { assertUserWording };

// Observe transient loading/error/dialog states as well as the final capture.
// Only ordinary synthetic fixtures use this gate; engineering request data stays internal.
async function observeUserWording(browser) {
  const original = browser.newContext.bind(browser);
  browser.newContext = async function(options) {
    const context = await original(options);
    const findings = [];
    await context.exposeBinding('__m23ReportWording', (_source, line) => { if (!findings.includes(line)) findings.push(line); });
    await context.addInitScript(() => {
      window.__m23WordingFindings = [];
      const check = () => {
        if (!document.body) return;
        const visible = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
        const attributes = [...document.querySelectorAll('[aria-label],[title],[placeholder]')].filter(visible)
          .flatMap(e => ['aria-label','title','placeholder'].map(a => e.getAttribute(a) || ''));
        const shown = [document.body.innerText,...attributes].join('\n');
        const forbidden = /\b(?:executions?|durable|PostgreSQL|SHA-?256|digest|idempotency|canonical|tenant|runtime|payload|schema|endpoint|SQL|API|HTTP|server-owned|server snapshot|execution revision|assignment revision|source pins?|immutable history|fieldEvidence)\b|\/api\/|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{64}\b/i;
        for (const line of shown.split('\n')) if (forbidden.test(line) && !window.__m23WordingFindings.includes(line)) { window.__m23WordingFindings.push(line); window.__m23ReportWording(line); }
      };
      document.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(check).observe(document.body, {subtree:true,childList:true,attributes:true,characterData:true}); check();
      });
    });
    const close = context.close.bind(context);
    context.close = async function() {
      for (const page of context.pages()) if (!page.isClosed()) findings.push(...await page.evaluate(() => window.__m23WordingFindings || []).catch(() => []));
      await close();
      assert.deepEqual(findings, [], 'Rendered transient or accessible wording');
    };
    return context;
  };
}
module.exports.observeUserWording = observeUserWording;
