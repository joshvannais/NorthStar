'use strict';

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

const FORBIDDEN = Object.freeze([
  /part 14a (?:is )?(?:accepted|released|deployed|independently audited)/i,
  /part 14[bcdefg] (?:is )?(?:complete|accepted|released|deployed)/i,
  /automatic (?:sms|charge|refund|accounting) (?:is )?authorized/i,
  /external effect (?:is )?authorized/i,
  /live payment (?:is )?accepted/i,
  /provider sandbox (?:is )?accepted/i,
  /offline check (?:is )?cleared/i,
  /check clearance (?:is )?(?:accepted|available|proven)/i,
]);

function invalid() { return new Error('Mission 27 Part 14 authority ratification invalid'); }

function rows(markdown) {
  const result = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\| (?:13D|14[A-G]) \|/.test(line)) continue;
    const fields = line.slice(1, -1).split('|').map(value => value.trim());
    if (result.has(fields[0])) throw invalid();
    result.set(fields[0], fields);
  }
  return result;
}

function validateRoadmap(roadmap) {
  if (typeof roadmap !== 'string' ||
      !roadmap.startsWith('# Mission 27 — Customer financial lifecycle') ||
      !roadmap.includes('Status: frozen plan through released complete Part 13; original Part 14A is the current implementation candidate.') ||
      !roadmap.includes(PART13_RELEASE.head) || !roadmap.includes(PART13_RELEASE.tree) ||
      !roadmap.includes(PART13_RELEASE.main) || !roadmap.includes(PART13_RELEASE.pr) ||
      !roadmap.includes(PART13_RELEASE.deployment) ||
      !roadmap.includes('founder-authorized fallback whole exact-head audit') ||
      !roadmap.includes('arbitrary earlier same-process runtime replacement remains outside this application validator') ||
      !roadmap.includes('Live-money validation was not run and remains deferred until the first real paying customer.')) {
    throw invalid();
  }
  const section = roadmap.split('## Part 14 — mission acceptance and release')[1]
    ?.split('## Named acceptance verdicts')[0];
  if (!section) throw invalid();
  const actual = [...section.matchAll(/^\| ([A-G]) \| (.*) \|$/gm)]
    .map(match => [match[1], match[2]]);
  if (JSON.stringify(actual) !== JSON.stringify(PART14_SCOPES)) throw invalid();
  if (!roadmap.includes('| 14 | Complete paid/demo journeys, migration proof, accessibility, independent audit, and release | 7 | Part 14A current |')) throw invalid();
}

function validateLedger(ledger) {
  if (typeof ledger !== 'string' || !ledger.startsWith('# Mission 27 acceptance ledger') ||
      !ledger.includes('Current implementation candidate: original Part 14A') ||
      !ledger.includes('Live-money validation was not run and remains deferred until the first real paying customer.')) throw invalid();
  const actual = rows(ledger);
  if (actual.size !== 8) throw invalid();
  const part13 = actual.get('13D');
  if (!part13 || part13.length !== 10 || part13[4] !==
      'Founder-authorized fallback whole exact-head audit accepted with no P0–P3. Practical trust boundary: supported Node startup with standard reflection intrinsics and `node:util` proxy detection; arbitrary earlier same-process runtime replacement remains outside this application validator.' ||
      part13[5] !== `\`${PART13_RELEASE.head}\` / tree \`${PART13_RELEASE.tree}\`` ||
      !part13[6].includes(PART13_RELEASE.pr) || !part13[6].includes(PART13_RELEASE.main) ||
      !part13[6].includes(PART13_RELEASE.deployment) || !part13[6].includes('migration 272') ||
      part13[9] !== 'Released') throw invalid();
  const part14 = actual.get('14A');
  if (!part14 || part14.length !== 10 ||
      part14[1] !== '[Complete paid-tenant provider-disabled journey, including exact offline cash/check semantics](../architecture/MISSION_27_PART14A_PAID_PROVIDER_DISABLED_JOURNEY.md)' ||
      !part14[2].startsWith('**Candidate, provider-disabled and production-incomplete**') ||
      !part14[2].includes('exact released production contracts') ||
      !part14[2].includes('complete production journey remains false') ||
      !part14[3].startsWith('Corrected writer evidence:') ||
      part14[4] !== 'Independent whole exact-head re-audit pending' || part14[5] !== '—' ||
      part14[6] !== 'No' || !part14[7].includes('first-paying-customer live-money validation unavailable') ||
      !part14[7].includes('zero external mutation') ||
      part14[8] !== 'N/A — Part 14A adds no rendered/public/customer/demo surface; Part 14E owns the visual matrix and founder visual verdict remains separate' ||
      part14[9] !== 'Current implementation candidate') throw invalid();
  for (const expected of LATER_LEDGER_ROWS) {
    if (JSON.stringify(actual.get(expected[0])) !== JSON.stringify(expected)) throw invalid();
  }
}

function validateArchitecture(architecture) {
  if (typeof architecture !== 'string') throw invalid();
  const required = [
    'incomplete_provider_disabled', 'required_production_stage_evidence_unavailable',
    'm27-production-contract-journey-execution-v1',
    'completeProductionJourney: false', 'check_clearance_authority_unavailable',
    'Partial provider payment | Disabled', 'Multi-invoice provider payment | Disabled',
    'Offline cash | Enabled', 'Offline check | Enabled',
    'No automatic issue, delivery, charge, refund, receipt, accounting, or downstream action is authorized.',
    'Browser/demo evidence is not applicable',
  ];
  if (required.some(value => !architecture.includes(value))) throw invalid();
  const ordered = architecture.split(/\r?\n/).filter(line => /^\d+\. `/.test(line))
    .map(line => line.match(/^\d+\. `([^`]+)`/)[1]);
  const expected = [
    'launch_approved_billable_handoff','human_invoice_review_and_issue',
    'secure_customer_delivery','deterministic_provider_payment',
    'simulated_settlement_evidence','customer_receipt','correction_and_refund',
    'receivable_update','accounting_handoff','downstream_evidence',
    'offline_cash_receipt','offline_check_received',
  ];
  if (JSON.stringify(ordered) !== JSON.stringify(expected)) throw invalid();
}

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== 3 ||
      !Object.hasOwn(input, 'roadmap') || !Object.hasOwn(input, 'ledger') ||
      !Object.hasOwn(input, 'architecture')) throw invalid();
  validateRoadmap(input.roadmap); validateLedger(input.ledger);
  validateArchitecture(input.architecture);
  const joined = `${input.roadmap}\n${input.ledger}\n${input.architecture}`;
  if (FORBIDDEN.some(pattern => pattern.test(joined))) throw invalid();
  return Object.freeze({
    contractVersion: 'm27-part14a-authority-ratification-v1',
    releasedPart13Head: PART13_RELEASE.head,
    currentSlice: '14A', currentStatus: 'candidate',
    laterSlices: Object.freeze(['14B','14C','14D','14E','14F','14G']),
    migrationLatest: 272, migration273Present: false,
  });
}

module.exports = Object.freeze({ PART14_SCOPES, PART13_RELEASE, LATER_LEDGER_ROWS, validate });
