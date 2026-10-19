'use strict';

const crypto = require('node:crypto');

const PART14_SCOPES = Object.freeze([
  ['A', 'Complete paid-tenant production path with live capability disabled: exact launch-approved billable handoff, human invoice review/issue, secure customer delivery, deterministic in-process provider simulation, simulated settlement evidence, receipt, correction/refund, receivable update, accounting handoff, and downstream evidence. When partial or multi-invoice provider payment is launch-enabled, this path also proves exact authorized initiation, allocation, concurrency/currentness refusal, balance projection, and receipt. When offline recording is launch-enabled, it proves reviewed cash receipt and check-received-with-clearance-unknown through balance, customer receipt, accounting handoff, and reporting without implying provider or bank settlement. Actual provider-sandbox account evidence belongs to the Provider-sandbox accepted verdict.'],
  ['B', 'Complete resettable fictional demo path with realistic lifecycle states and strict isolation from paid data, credentials, providers, and money.'],
  ['C', 'Migration, restart, replay, out-of-order event, uncertain response, source correction, reopening, dispute, refund, retention, deletion, and restore journey. When offline recording is launch-enabled, the integrated journey includes duplicate-safe receipt, append-only correction/reversal, check clearance or explicit continued unknown state, returned/NSF reopening, downstream correction, and recovery.'],
  ['D', 'Tenant, role, CSRF, public-link, webhook, provider-account, direct-table, secret, PII, amount-tampering, duplicate-charge, duplicate-offline-receipt, offline-evidence tampering, and denial-of-service security acceptance.'],
  ['E', 'Mission-wide performance, observability, accessibility, keyboard, responsive, light/dark, empty/loading/error/recovery, and five-layout-per-page rendered review.'],
  ['F', 'Independent clean exact-head authority, privacy, security, accounting-boundary, provider, migration, regression, and full-scope audit with no unresolved P0-P3 findings.'],
  ['G', 'Fresh verified pre-migration backup, normal reviewed PR merge, sole automatic deployment, migration/health, production-safe rendered verification, founder visual verdict, source-linked final ledger, and the exact named verdict earned. A separately authorized controlled live canary is required only for live-payment acceptance and mission-complete status.'],
]);

const PART13_RELEASE = Object.freeze({
  head: 'd465d2c0576547571aa2b6c930d22af12b723381',
  tree: '05e317ee7ef2dc8e64604839752976f93a9968cc',
  main: '4b69a1c81db0d86eaa154a489f560c0a85b8f547',
  pr: 'PR #533', deployment: '0ee0e7c1-d388-4a53-b293-50c59cbe4c7d',
});

const LATER_LEDGER_ROWS = Object.freeze([
  ['14B','Complete resettable isolated fictional demo journey','No','No','No','—','No','N/A','No','Planned'],
  ['14C','Integrated migration/replay/correction/refund/offline-return/retention/delete/restore journey','No','No','No','—','No','No if offline enabled','N/A','Planned'],
  ['14D','Integrated tenant/role/CSRF/link/webhook/account/PII/amount/offline-evidence/abuse security','No','No','No','—','No','No if offline enabled','N/A','Planned'],
  ['14E','Performance, observability, accessibility, responsive/theme/state visual matrix','No','No','No','—','No','N/A','No','Planned'],
  ['14F','Independent exact-head authority/privacy/security/accounting/provider full audit','No','No','No','—','No','No','N/A','Planned'],
  ['14G','Backup, reviewed merge, sole deploy, health, named verdict, ledger, founder verdict','No','No','No','—','No','No','No','Planned'],
]);

// These hashes ratify the complete normalized documents rather than a finite set
// of required/forbidden phrases. Any normative drift is rejected until a later
// reviewed slice deliberately updates both its canonical document and this
// manifest. Only platform line endings are normalized; whitespace, case,
// punctuation, section/row order, and the terminal newline remain authoritative.
const CANONICAL_DOCUMENTS = Object.freeze({
  roadmap: Object.freeze({
    path: 'docs/roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md',
    normalizedSha256: 'e65a5dcca88b16ab56e96b6c916c2304bb935dde5c36adb8c90d4dc201027fe0',
    normalizedUtf8Bytes: 66669,
    normalizedLineCount: 349,
  }),
  ledger: Object.freeze({
    path: 'docs/roadmap/MISSION_27_ACCEPTANCE_LEDGER.md',
    normalizedSha256: '81c34304c22ab779583f8b74c616e5de0d08bf58845e67ad42dac0812fc6ba42',
    normalizedUtf8Bytes: 89744,
    normalizedLineCount: 138,
  }),
  architecture: Object.freeze({
    path: 'docs/architecture/MISSION_27_PART14A_PAID_PROVIDER_DISABLED_JOURNEY.md',
    normalizedSha256: '841189a5e1e03e9d6c54579a043847e87a3ae80e8c93a46dd9f975bb9843144c',
    normalizedUtf8Bytes: 6338,
    normalizedLineCount: 59,
  }),
});

function invalid() { return new Error('Mission 27 Part 14 authority ratification invalid'); }

function normalizeDocument(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw invalid();
  return value.replace(/\r\n?/g, '\n');
}

function validateDocument(name, value) {
  const expected = CANONICAL_DOCUMENTS[name];
  const normalized = normalizeDocument(value);
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  if (digest !== expected.normalizedSha256 ||
      Buffer.byteLength(normalized, 'utf8') !== expected.normalizedUtf8Bytes ||
      normalized.split('\n').length !== expected.normalizedLineCount) throw invalid();
}

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).length !== 3 ||
      !Object.hasOwn(input, 'roadmap') || !Object.hasOwn(input, 'ledger') ||
      !Object.hasOwn(input, 'architecture')) throw invalid();
  for (const name of Object.keys(CANONICAL_DOCUMENTS)) validateDocument(name, input[name]);
  return Object.freeze({
    contractVersion: 'm27-part14a-authority-ratification-v2',
    releasedPart13Head: PART13_RELEASE.head,
    currentSlice: '14A', currentStatus: 'candidate',
    laterSlices: Object.freeze(['14B','14C','14D','14E','14F','14G']),
    migrationLatest: 272, migration273Present: false,
  });
}

module.exports = Object.freeze({
  PART14_SCOPES, PART13_RELEASE, LATER_LEDGER_ROWS, CANONICAL_DOCUMENTS, validate,
});
