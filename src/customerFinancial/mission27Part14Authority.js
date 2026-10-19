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
const OBJECT_CREATE = requireNative(Object.create, 'function create() { [native code] }');
const OBJECT_DEFINE_PROPERTY = requireNative(
  Object.defineProperty, 'function defineProperty() { [native code] }');
const OBJECT_DEFINE_PROPERTIES = requireNative(
  Object.defineProperties, 'function defineProperties() { [native code] }');
const STRING_CHAR_CODE_AT = requireNative(
  String.prototype.charCodeAt, 'function charCodeAt() { [native code] }');
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

// Capture the standard Node hashing implementation without retaining its mutable
// module object. The supported bootstrap contract is the same ordinary native
// Node startup required above. Two independently created hashes must expose the
// same concrete prototype and method identities and pass a known-answer test.
// Every later hash validates that those prototype descriptors are still exact,
// then calls only the private captured functions through private Reflect.apply.
const HASH_CAPABILITIES = (() => {
  const cryptoModule = require('node:crypto');
  const createDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(cryptoModule, 'createHash');
  const createHash = createDescriptor?.value;
  const createSource = typeof createHash === 'function' ?
    FUNCTION_TO_STRING.call(createHash) : '';
  if (createSource !==
      'function createHash(algorithm, options) {\n  return new Hash(algorithm, options);\n}' &&
      createSource !==
      'function createHash(algorithm, options) {\r\n  return new Hash(algorithm, options);\r\n}') {
    throw bootstrapInvalid();
  }
  if (createDescriptor.enumerable !== true || createDescriptor.writable !== true ||
      createDescriptor.configurable !== true) throw bootstrapInvalid();

  const first = REFLECT_APPLY(createHash, undefined, ['sha256']);
  const second = REFLECT_APPLY(createHash, undefined, ['sha256']);
  if (IS_PROXY(first) || IS_PROXY(second)) throw bootstrapInvalid();
  const instancePrototype = OBJECT_GET_PROTOTYPE_OF(first);
  if (instancePrototype === null || OBJECT_GET_PROTOTYPE_OF(second) !== instancePrototype) {
    throw bootstrapInvalid();
  }
  const methodPrototype = instancePrototype;
  const parentPrototype = OBJECT_GET_PROTOTYPE_OF(instancePrototype);
  if (parentPrototype === null) throw bootstrapInvalid();
  const updateDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(methodPrototype, 'update');
  const digestDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(methodPrototype, 'digest');
  if (!updateDescriptor || !digestDescriptor ||
      typeof updateDescriptor.value !== 'function' || typeof digestDescriptor.value !== 'function' ||
      updateDescriptor.enumerable !== true || updateDescriptor.writable !== true ||
      updateDescriptor.configurable !== true || digestDescriptor.enumerable !== true ||
      digestDescriptor.writable !== true || digestDescriptor.configurable !== true ||
      updateDescriptor.get !== undefined || updateDescriptor.set !== undefined ||
      digestDescriptor.get !== undefined || digestDescriptor.set !== undefined) {
    throw bootstrapInvalid();
  }
  const update = updateDescriptor.value;
  const digest = digestDescriptor.value;
  if (OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    OBJECT_GET_PROTOTYPE_OF(second), 'update')?.value !== update ||
      OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
        OBJECT_GET_PROTOTYPE_OF(second), 'digest')?.value !== digest) {
    throw bootstrapInvalid();
  }
  if (REFLECT_APPLY(update, first, ['abc', 'utf8']) !== first ||
      REFLECT_APPLY(digest, first, ['hex']) !==
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
    throw bootstrapInvalid();
  }
  return OBJECT_FREEZE({
    createHash, instancePrototype, methodPrototype, parentPrototype, update, digest,
    updateEnumerable:updateDescriptor.enumerable,
    updateWritable:updateDescriptor.writable,
    updateConfigurable:updateDescriptor.configurable,
    digestEnumerable:digestDescriptor.enumerable,
    digestWritable:digestDescriptor.writable,
    digestConfigurable:digestDescriptor.configurable,
  });
})();

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
  let normalized = '';
  let utf8Bytes = 0;
  let lineCount = 1;
  for (let index = 0; index < value.length; index += 1) {
    const code = REFLECT_APPLY(STRING_CHAR_CODE_AT, value, [index]);
    if (code === 0) throw invalid();
    if (code === 13) {
      if (index + 1 >= value.length ||
          REFLECT_APPLY(STRING_CHAR_CODE_AT, value, [index + 1]) !== 10) throw invalid();
      normalized += '\n';
      utf8Bytes += 1;
      lineCount += 1;
      index += 1;
      continue;
    }
    normalized += value[index];
    if (code === 10) lineCount += 1;
    if (code <= 0x7f) utf8Bytes += 1;
    else if (code <= 0x7ff) utf8Bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = REFLECT_APPLY(STRING_CHAR_CODE_AT, value, [index + 1]);
      if (next >= 0xdc00 && next <= 0xdfff) {
        normalized += value[index + 1];
        utf8Bytes += 4;
        index += 1;
      } else utf8Bytes += 3;
    } else utf8Bytes += 3;
  }
  return {normalized, utf8Bytes, lineCount};
}

function documentDigest(value) {
  const capabilities = HASH_CAPABILITIES;
  if (OBJECT_GET_PROTOTYPE_OF(capabilities.instancePrototype) !==
      capabilities.parentPrototype) throw invalid();
  const updateDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    capabilities.methodPrototype, 'update');
  const digestDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    capabilities.methodPrototype, 'digest');
  if (!updateDescriptor || updateDescriptor.value !== capabilities.update ||
      updateDescriptor.enumerable !== capabilities.updateEnumerable ||
      updateDescriptor.writable !== capabilities.updateWritable ||
      updateDescriptor.configurable !== capabilities.updateConfigurable ||
      updateDescriptor.get !== undefined || updateDescriptor.set !== undefined ||
      !digestDescriptor || digestDescriptor.value !== capabilities.digest ||
      digestDescriptor.enumerable !== capabilities.digestEnumerable ||
      digestDescriptor.writable !== capabilities.digestWritable ||
      digestDescriptor.configurable !== capabilities.digestConfigurable ||
      digestDescriptor.get !== undefined || digestDescriptor.set !== undefined) throw invalid();
  const hash = REFLECT_APPLY(capabilities.createHash, undefined, ['sha256']);
  if (IS_PROXY(hash) || OBJECT_GET_PROTOTYPE_OF(hash) !== capabilities.instancePrototype) {
    throw invalid();
  }
  if (REFLECT_APPLY(capabilities.update, hash, [value, 'utf8']) !== hash) throw invalid();
  const digest = REFLECT_APPLY(capabilities.digest, hash, ['hex']);
  if (typeof digest !== 'string' || digest.length !== 64) throw invalid();
  return digest;
}

function validateDocument(name, value) {
  const expected = CANONICAL_DOCUMENTS[name];
  const result = normalizeDocument(value);
  const digest = documentDigest(result.normalized);
  if (digest !== expected.normalizedSha256 ||
      result.utf8Bytes !== expected.normalizedUtf8Bytes ||
      result.lineCount !== expected.normalizedLineCount) throw invalid();
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

// Repository inventory has no production runtime importer for this ratification
// package: it is an executable release-authority gate. Supported gate consumers
// capture this finalized API once at their own module initialization. Sealing the
// original Module.exports slot prevents replacement through the original cache
// record. Whole require.cache replacement can affect a later hostile direct
// require, so it is deliberately outside the supported consumer contract and is
// tested without claiming global CommonJS cache immutability.
const API = OBJECT_CREATE(null);
OBJECT_DEFINE_PROPERTIES(API, {
  PART14_SCOPES:{value:PART14_SCOPES, enumerable:true, writable:false, configurable:false},
  PART13_RELEASE:{value:PART13_RELEASE, enumerable:true, writable:false, configurable:false},
  LATER_LEDGER_ROWS:{value:LATER_LEDGER_ROWS, enumerable:true, writable:false, configurable:false},
  CANONICAL_DOCUMENTS:{value:CANONICAL_DOCUMENTS, enumerable:true, writable:false, configurable:false},
  validate:{value:validate, enumerable:true, writable:false, configurable:false},
});
OBJECT_FREEZE(API);
OBJECT_DEFINE_PROPERTY(module, 'exports', {
  value:API, enumerable:true, writable:false, configurable:false,
});
