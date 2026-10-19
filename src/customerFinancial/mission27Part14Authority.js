'use strict';

const FUNCTION_TO_STRING = Function.prototype.toString;

function bootstrapInvalid() {
  return new Error('Mission 27 Part 14 authority bootstrap invalid');
}

function requireNative(fn, source) {
  if (typeof fn !== 'function' || FUNCTION_TO_STRING.call(fn) !== source) {
    throw bootstrapInvalid();
  }
  return fn;
}

// The supported bootstrap boundary is an ordinary Node startup with its native
// reflection and util proxy-detection intrinsics intact when this module loads.
// Capture them before any caller input exists; later ambient replacement cannot
// change the private capabilities used by validate().
const REFLECT_APPLY = requireNative(Reflect.apply, 'function apply() { [native code] }');
const REFLECT_OWN_KEYS = requireNative(Reflect.ownKeys, 'function ownKeys() { [native code] }');
const OBJECT_GET_PROTOTYPE_OF = requireNative(
  Object.getPrototypeOf, 'function getPrototypeOf() { [native code] }');
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = requireNative(
  Object.getOwnPropertyDescriptor, 'function getOwnPropertyDescriptor() { [native code] }');
const OBJECT_FREEZE = requireNative(Object.freeze, 'function freeze() { [native code] }');
const STRING_REPLACE = requireNative(
  String.prototype.replace, 'function replace() { [native code] }');
const STRING_INDEX_OF = requireNative(
  String.prototype.indexOf, 'function indexOf() { [native code] }');
const STRING_SPLIT = requireNative(
  String.prototype.split, 'function split() { [native code] }');
const OBJECT_PROTOTYPE = Object.prototype;
const initialPrototypeKeys = REFLECT_OWN_KEYS(OBJECT_PROTOTYPE);
const copiedPrototypeKeys = [];
const copiedPrototypeDescriptors = [];
for (let index = 0; index < initialPrototypeKeys.length; index += 1) {
  copiedPrototypeKeys[index] = initialPrototypeKeys[index];
  copiedPrototypeDescriptors[index] = OBJECT_FREEZE(
    OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(OBJECT_PROTOTYPE, initialPrototypeKeys[index]));
}
const OBJECT_PROTOTYPE_KEYS = OBJECT_FREEZE(copiedPrototypeKeys);
const OBJECT_PROTOTYPE_DESCRIPTORS = OBJECT_FREEZE(copiedPrototypeDescriptors);
const utilTypes = require('node:util/types');
const isProxyDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(utilTypes, 'isProxy');
const IS_PROXY = requireNative(
  isProxyDescriptor?.value, 'function () { [native code] }');
if (isProxyDescriptor.enumerable !== true || isProxyDescriptor.writable !== true ||
    isProxyDescriptor.configurable !== true || IS_PROXY({}) !== false ||
    IS_PROXY(new Proxy({}, {})) !== true) throw bootstrapInvalid();

const crypto = require('node:crypto');

const PART14_SCOPES = OBJECT_FREEZE([
  ['A', 'Complete paid-tenant production path with live capability disabled: exact launch-approved billable handoff, human invoice review/issue, secure customer delivery, deterministic in-process provider simulation, simulated settlement evidence, receipt, correction/refund, receivable update, accounting handoff, and downstream evidence. When partial or multi-invoice provider payment is launch-enabled, this path also proves exact authorized initiation, allocation, concurrency/currentness refusal, balance projection, and receipt. When offline recording is launch-enabled, it proves reviewed cash receipt and check-received-with-clearance-unknown through balance, customer receipt, accounting handoff, and reporting without implying provider or bank settlement. Actual provider-sandbox account evidence belongs to the Provider-sandbox accepted verdict.'],
  ['B', 'Complete resettable fictional demo path with realistic lifecycle states and strict isolation from paid data, credentials, providers, and money.'],
  ['C', 'Migration, restart, replay, out-of-order event, uncertain response, source correction, reopening, dispute, refund, retention, deletion, and restore journey. When offline recording is launch-enabled, the integrated journey includes duplicate-safe receipt, append-only correction/reversal, check clearance or explicit continued unknown state, returned/NSF reopening, downstream correction, and recovery.'],
  ['D', 'Tenant, role, CSRF, public-link, webhook, provider-account, direct-table, secret, PII, amount-tampering, duplicate-charge, duplicate-offline-receipt, offline-evidence tampering, and denial-of-service security acceptance.'],
  ['E', 'Mission-wide performance, observability, accessibility, keyboard, responsive, light/dark, empty/loading/error/recovery, and five-layout-per-page rendered review.'],
  ['F', 'Independent clean exact-head authority, privacy, security, accounting-boundary, provider, migration, regression, and full-scope audit with no unresolved P0-P3 findings.'],
  ['G', 'Fresh verified pre-migration backup, normal reviewed PR merge, sole automatic deployment, migration/health, production-safe rendered verification, founder visual verdict, source-linked final ledger, and the exact named verdict earned. A separately authorized controlled live canary is required only for live-payment acceptance and mission-complete status.'],
]);
for (let index = 0; index < PART14_SCOPES.length; index += 1) {
  OBJECT_FREEZE(PART14_SCOPES[index]);
}

const PART13_RELEASE = OBJECT_FREEZE({
  head: 'd465d2c0576547571aa2b6c930d22af12b723381',
  tree: '05e317ee7ef2dc8e64604839752976f93a9968cc',
  main: '4b69a1c81db0d86eaa154a489f560c0a85b8f547',
  pr: 'PR #533', deployment: '0ee0e7c1-d388-4a53-b293-50c59cbe4c7d',
});

const LATER_LEDGER_ROWS = OBJECT_FREEZE([
  ['14B','Complete resettable isolated fictional demo journey','No','No','No','—','No','N/A','No','Planned'],
  ['14C','Integrated migration/replay/correction/refund/offline-return/retention/delete/restore journey','No','No','No','—','No','No if offline enabled','N/A','Planned'],
  ['14D','Integrated tenant/role/CSRF/link/webhook/account/PII/amount/offline-evidence/abuse security','No','No','No','—','No','No if offline enabled','N/A','Planned'],
  ['14E','Performance, observability, accessibility, responsive/theme/state visual matrix','No','No','No','—','No','N/A','No','Planned'],
  ['14F','Independent exact-head authority/privacy/security/accounting/provider full audit','No','No','No','—','No','No','N/A','Planned'],
  ['14G','Backup, reviewed merge, sole deploy, health, named verdict, ledger, founder verdict','No','No','No','—','No','No','No','Planned'],
]);
for (let index = 0; index < LATER_LEDGER_ROWS.length; index += 1) {
  OBJECT_FREEZE(LATER_LEDGER_ROWS[index]);
}

// These hashes ratify the complete normalized documents rather than a finite set
// of required/forbidden phrases. Any normative drift is rejected until a later
// reviewed slice deliberately updates both its canonical document and this
// manifest. Only platform line endings are normalized; whitespace, case,
// punctuation, section/row order, and the terminal newline remain authoritative.
const CANONICAL_DOCUMENTS = OBJECT_FREEZE({
  roadmap: OBJECT_FREEZE({
    path: 'docs/roadmap/MISSION_27_CUSTOMER_FINANCIAL_LIFECYCLE.md',
    normalizedSha256: 'e65a5dcca88b16ab56e96b6c916c2304bb935dde5c36adb8c90d4dc201027fe0',
    normalizedUtf8Bytes: 66669,
    normalizedLineCount: 349,
  }),
  ledger: OBJECT_FREEZE({
    path: 'docs/roadmap/MISSION_27_ACCEPTANCE_LEDGER.md',
    normalizedSha256: '81c34304c22ab779583f8b74c616e5de0d08bf58845e67ad42dac0812fc6ba42',
    normalizedUtf8Bytes: 89744,
    normalizedLineCount: 138,
  }),
  architecture: OBJECT_FREEZE({
    path: 'docs/architecture/MISSION_27_PART14A_PAID_PROVIDER_DISABLED_JOURNEY.md',
    normalizedSha256: '841189a5e1e03e9d6c54579a043847e87a3ae80e8c93a46dd9f975bb9843144c',
    normalizedUtf8Bytes: 6338,
    normalizedLineCount: 59,
  }),
});

function invalid() { return new Error('Mission 27 Part 14 authority ratification invalid'); }

function assertCanonicalObjectPrototype() {
  const keys = REFLECT_OWN_KEYS(OBJECT_PROTOTYPE);
  if (keys.length !== OBJECT_PROTOTYPE_KEYS.length) throw invalid();
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] !== OBJECT_PROTOTYPE_KEYS[index]) throw invalid();
    const actual = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(OBJECT_PROTOTYPE, keys[index]);
    const expected = OBJECT_PROTOTYPE_DESCRIPTORS[index];
    if (!actual || actual.configurable !== expected.configurable ||
        actual.enumerable !== expected.enumerable || actual.writable !== expected.writable ||
        actual.value !== expected.value || actual.get !== expected.get ||
        actual.set !== expected.set) throw invalid();
  }
}

function normalizeDocument(value) {
  const normalized = REFLECT_APPLY(STRING_REPLACE, value, [/\r\n/g, '\n']);
  if (REFLECT_APPLY(STRING_INDEX_OF, normalized, ['\r']) !== -1 ||
      REFLECT_APPLY(STRING_INDEX_OF, normalized, ['\0']) !== -1) throw invalid();
  return normalized;
}

function validateDocument(name, value) {
  const expected = CANONICAL_DOCUMENTS[name];
  const normalized = normalizeDocument(value);
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  if (digest !== expected.normalizedSha256 ||
      Buffer.byteLength(normalized, 'utf8') !== expected.normalizedUtf8Bytes ||
      REFLECT_APPLY(STRING_SPLIT, normalized, ['\n']).length !==
        expected.normalizedLineCount) throw invalid();
}

function readCanonicalInput(input) {
  assertCanonicalObjectPrototype();
  if (input === null || typeof input !== 'object' || IS_PROXY(input) ||
      OBJECT_GET_PROTOTYPE_OF(input) !== OBJECT_PROTOTYPE) throw invalid();
  const keys = REFLECT_OWN_KEYS(input);
  if (keys.length !== 3) throw invalid();
  let roadmap; let ledger; let architecture;
  let hasRoadmap = false; let hasLedger = false; let hasArchitecture = false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string') throw invalid();
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(input, key);
    if (!descriptor || descriptor.enumerable !== true || descriptor.writable !== true ||
        descriptor.configurable !== true || !('value' in descriptor) ||
        typeof descriptor.value !== 'string') throw invalid();
    if (key === 'roadmap' && !hasRoadmap) { roadmap = descriptor.value; hasRoadmap = true; }
    else if (key === 'ledger' && !hasLedger) { ledger = descriptor.value; hasLedger = true; }
    else if (key === 'architecture' && !hasArchitecture) {
      architecture = descriptor.value; hasArchitecture = true;
    } else throw invalid();
  }
  if (!hasRoadmap || !hasLedger || !hasArchitecture) throw invalid();
  return [roadmap, ledger, architecture];
}

const VALIDATED_AUTHORITY = OBJECT_FREEZE({
  contractVersion: 'm27-part14a-authority-ratification-v2',
  releasedPart13Head: PART13_RELEASE.head,
  currentSlice: '14A', currentStatus: 'candidate',
  laterSlices: OBJECT_FREEZE(['14B','14C','14D','14E','14F','14G']),
  migrationLatest: 272, migration273Present: false,
});

function validate(input) {
  const values = readCanonicalInput(input);
  validateDocument('roadmap', values[0]);
  validateDocument('ledger', values[1]);
  validateDocument('architecture', values[2]);
  return VALIDATED_AUTHORITY;
}

module.exports = OBJECT_FREEZE({
  PART14_SCOPES, PART13_RELEASE, LATER_LEDGER_ROWS, CANONICAL_DOCUMENTS, validate,
});
