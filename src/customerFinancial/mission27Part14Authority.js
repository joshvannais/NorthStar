'use strict';

const FUNCTION_TO_STRING = Function.prototype.toString;

function bootstrapInvalid() {
  return new Error('Mission 27 Part 14 authority bootstrap invalid');
}

// The first bootstrap step assumes the standard Node reflection intrinsics are
// intact. That is the declared supported process boundary; arbitrary earlier
// same-process replacement is not claimed. Authenticate the two roots against
// their native identities, then perform every later source read with the private
// captured Reflect.apply rather than mutable Function.prototype.call.
const REFLECT_APPLY = Reflect.apply;
if (typeof FUNCTION_TO_STRING !== 'function' || FUNCTION_TO_STRING.name !== 'toString' ||
    FUNCTION_TO_STRING.length !== 0 ||
    typeof REFLECT_APPLY !== 'function' || REFLECT_APPLY.name !== 'apply' ||
    REFLECT_APPLY.length !== 3 ||
    REFLECT_APPLY(FUNCTION_TO_STRING, FUNCTION_TO_STRING, []) !==
      'function toString() { [native code] }' ||
    REFLECT_APPLY(FUNCTION_TO_STRING, REFLECT_APPLY, []) !==
      'function apply() { [native code] }') {
  throw bootstrapInvalid();
}

function functionSource(fn) {
  return REFLECT_APPLY(FUNCTION_TO_STRING, fn, []);
}

function requireNative(fn, source) {
  if (typeof fn !== 'function' || functionSource(fn) !== source) {
    throw bootstrapInvalid();
  }
  return fn;
}

// The supported bootstrap boundary is an ordinary Node startup with its native
// reflection and util proxy-detection intrinsics intact when this module loads.
// Capture them before any caller input exists; later ambient replacement cannot
// change the private capabilities used by validate().
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
const FUNCTION_PROTOTYPE = Function.prototype;
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

const functionToStringDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
  FUNCTION_PROTOTYPE, 'toString');
if (!functionToStringDescriptor || functionToStringDescriptor.value !== FUNCTION_TO_STRING ||
    functionToStringDescriptor.enumerable !== false ||
    functionToStringDescriptor.writable !== true ||
    functionToStringDescriptor.configurable !== true || IS_PROXY(FUNCTION_TO_STRING) ||
    OBJECT_GET_PROTOTYPE_OF(FUNCTION_TO_STRING) !== FUNCTION_PROTOTYPE) {
  throw bootstrapInvalid();
}

const nodeVersion = process.versions && process.versions.node;
if (typeof nodeVersion !== 'string' || nodeVersion[0] !== '2' ||
    (nodeVersion[1] !== '2' && nodeVersion[1] !== '4') || nodeVersion[2] !== '.') {
  throw bootstrapInvalid();
}

function canonicalFunctionSource(fn) {
  const source = functionSource(fn);
  let normalized = '';
  for (let index = 0; index < source.length; index += 1) {
    const code = REFLECT_APPLY(STRING_CHAR_CODE_AT, source, [index]);
    if (code === 13) {
      if (index + 1 >= source.length ||
          REFLECT_APPLY(STRING_CHAR_CODE_AT, source, [index + 1]) !== 10) {
        throw bootstrapInvalid();
      }
      normalized += '\n';
      index += 1;
    } else normalized += source[index];
  }
  return normalized;
}

const CREATE_HASH_SOURCE = 'function createHash(algorithm, options) {\n' +
  '  return new Hash(algorithm, options);\n}';
const HASH_UPDATE_SOURCE = 'function update(data, encoding) {\n' +
  '  const state = this[kState];\n' +
  '  if (state[kFinalized])\n' +
  '    throw new ERR_CRYPTO_HASH_FINALIZED();\n\n' +
  "  if (typeof data === 'string') {\n" +
  '    validateEncoding(data, encoding);\n' +
  '  } else if (!isArrayBufferView(data)) {\n' +
  '    throw new ERR_INVALID_ARG_TYPE(\n' +
  "      'data', ['string', 'Buffer', 'TypedArray', 'DataView'], data);\n" +
  '  }\n\n' +
  '  if (!this[kHandle].update(data, encoding))\n' +
  '    throw new ERR_CRYPTO_HASH_UPDATE_FAILED();\n' +
  '  return this;\n}';
const HASH_DIGEST_SOURCE = 'function digest(outputEncoding) {\n' +
  '  const state = this[kState];\n' +
  '  if (state[kFinalized])\n' +
  '    throw new ERR_CRYPTO_HASH_FINALIZED();\n\n' +
  '  // Explicit conversion of truthy values for backward compatibility.\n' +
  '  const ret = this[kHandle].digest(outputEncoding && `${outputEncoding}`);\n' +
  '  state[kFinalized] = true;\n' +
  '  return ret;\n}';

function exactFunctionPrototype(functionPrototype) {
  if (typeof functionPrototype !== 'function' || IS_PROXY(functionPrototype) ||
      canonicalFunctionSource(functionPrototype) !== 'function () { [native code] }') return false;
  const keys = REFLECT_OWN_KEYS(functionPrototype);
  const names = ['length', 'name', 'arguments', 'caller', 'constructor', 'apply', 'bind',
    'call', 'toString'];
  if (keys.length !== 10 || typeof keys[9] !== 'symbol') return false;
  for (let index = 0; index < names.length; index += 1) {
    if (keys[index] !== names[index]) return false;
  }
  const lengths = [0, '', null, null, 1, 2, 1, 1, 0];
  for (let index = 0; index < names.length; index += 1) {
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(functionPrototype, names[index]);
    if (!descriptor || descriptor.enumerable !== false || descriptor.configurable !== true) {
      return false;
    }
    if (index < 2) {
      if (descriptor.value !== lengths[index] || descriptor.writable !== false ||
          descriptor.get !== undefined || descriptor.set !== undefined) return false;
    } else if (index < 4) {
      if (descriptor.value !== undefined || typeof descriptor.get !== 'function' ||
          typeof descriptor.set !== 'function' || IS_PROXY(descriptor.get) ||
          IS_PROXY(descriptor.set) ||
          canonicalFunctionSource(descriptor.get) !== 'function () { [native code] }' ||
          canonicalFunctionSource(descriptor.set) !== 'function () { [native code] }') return false;
    } else {
      if (typeof descriptor.value !== 'function' || descriptor.writable !== true ||
          descriptor.get !== undefined || descriptor.set !== undefined ||
          IS_PROXY(descriptor.value) || descriptor.value.length !== lengths[index] ||
          canonicalFunctionSource(descriptor.value) !==
            `function ${names[index] === 'constructor' ? 'Function' : names[index]}() { [native code] }`) {
        return false;
      }
    }
  }
  const hasInstanceDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(functionPrototype, keys[9]);
  return Boolean(hasInstanceDescriptor && typeof hasInstanceDescriptor.value === 'function' &&
    !IS_PROXY(hasInstanceDescriptor.value) &&
    hasInstanceDescriptor.value.name === '[Symbol.hasInstance]' &&
    hasInstanceDescriptor.value.length === 1 && hasInstanceDescriptor.writable === false &&
    hasInstanceDescriptor.enumerable === false && hasInstanceDescriptor.configurable === false &&
    hasInstanceDescriptor.get === undefined && hasInstanceDescriptor.set === undefined &&
    canonicalFunctionSource(hasInstanceDescriptor.value) ===
      'function [Symbol.hasInstance]() { [native code] }');
}

function exactFunctionShape(fn, name, length, expectedSource, expectedFunctionPrototype) {
  if (typeof fn !== 'function' || IS_PROXY(fn) ||
      OBJECT_GET_PROTOTYPE_OF(fn) !== expectedFunctionPrototype ||
      canonicalFunctionSource(fn) !== expectedSource) return false;
  const keys = REFLECT_OWN_KEYS(fn);
  if (keys.length !== 3 || keys[0] !== 'length' || keys[1] !== 'name' ||
      keys[2] !== 'prototype') return false;
  const lengthDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(fn, 'length');
  const nameDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(fn, 'name');
  const prototypeDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(fn, 'prototype');
  if (!lengthDescriptor || lengthDescriptor.value !== length ||
      lengthDescriptor.writable !== false || lengthDescriptor.enumerable !== false ||
      lengthDescriptor.configurable !== true || !nameDescriptor ||
      nameDescriptor.value !== name || nameDescriptor.writable !== false ||
      nameDescriptor.enumerable !== false || nameDescriptor.configurable !== true ||
      !prototypeDescriptor || prototypeDescriptor.writable !== true ||
      prototypeDescriptor.enumerable !== false || prototypeDescriptor.configurable !== false ||
      prototypeDescriptor.get !== undefined || prototypeDescriptor.set !== undefined) return false;
  const functionPrototypeObject = prototypeDescriptor.value;
  if (functionPrototypeObject === null || typeof functionPrototypeObject !== 'object' ||
      IS_PROXY(functionPrototypeObject) ||
      OBJECT_GET_PROTOTYPE_OF(functionPrototypeObject) !==
        OBJECT_GET_PROTOTYPE_OF(expectedFunctionPrototype)) return false;
  const prototypeKeys = REFLECT_OWN_KEYS(functionPrototypeObject);
  if (prototypeKeys.length !== 1 || prototypeKeys[0] !== 'constructor') return false;
  const constructorDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(
    functionPrototypeObject, 'constructor');
  return Boolean(constructorDescriptor && constructorDescriptor.value === fn &&
    constructorDescriptor.writable === true && constructorDescriptor.enumerable === false &&
    constructorDescriptor.configurable === true && constructorDescriptor.get === undefined &&
    constructorDescriptor.set === undefined);
}

function exactHashPrototype(hashPrototype, expectedFunctionPrototype) {
  if (hashPrototype === null || typeof hashPrototype !== 'object' || IS_PROXY(hashPrototype)) {
    return false;
  }
  const keys = REFLECT_OWN_KEYS(hashPrototype);
  const names = ['constructor', 'copy', '_transform', '_flush', 'update', 'digest'];
  const functionNames = ['Hash', 'copy', '_transform', '_flush', 'update', 'digest'];
  const lengths = [2, 1, 3, 1, 2, 1];
  for (let index = 0; index < names.length; index += 1) {
    if (keys[index] !== names[index]) return false;
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(hashPrototype, names[index]);
    if (!descriptor || typeof descriptor.value !== 'function' ||
        IS_PROXY(descriptor.value) ||
        descriptor.writable !== true || descriptor.enumerable !== (index !== 0) ||
        descriptor.configurable !== true || descriptor.get !== undefined ||
        descriptor.set !== undefined || descriptor.value.name !== functionNames[index] ||
        descriptor.value.length !== lengths[index] ||
        (index !== 0 &&
          OBJECT_GET_PROTOTYPE_OF(descriptor.value) !== expectedFunctionPrototype)) return false;
  }
  if (keys.length !== names.length) return false;
  const parent = OBJECT_GET_PROTOTYPE_OF(hashPrototype);
  if (parent === null || typeof parent !== 'object' || IS_PROXY(parent)) return false;
  const parentKeys = REFLECT_OWN_KEYS(parent);
  if (parentKeys.length !== 3 || parentKeys[0] !== 'constructor' ||
      parentKeys[1] !== '_readableState' || parentKeys[2] !== '_writableState') return false;
  const parentConstructor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(parent, 'constructor');
  if (!parentConstructor || typeof parentConstructor.value !== 'function' ||
      IS_PROXY(parentConstructor.value) ||
      parentConstructor.value.name !== 'LazyTransform' || parentConstructor.value.length !== 1 ||
      parentConstructor.writable !== true || parentConstructor.enumerable !== false ||
      parentConstructor.configurable !== true ||
      canonicalFunctionSource(parentConstructor.value) !==
        'function LazyTransform(options) {\n  this._options = options;\n}') return false;
  const hashConstructor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(hashPrototype, 'constructor');
  if (!hashConstructor ||
      OBJECT_GET_PROTOTYPE_OF(hashConstructor.value) !== parentConstructor.value) return false;
  for (const key of ['_readableState', '_writableState']) {
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(parent, key);
    if (!descriptor || typeof descriptor.get !== 'function' ||
        typeof descriptor.set !== 'function' || descriptor.enumerable !== true ||
        descriptor.configurable !== true || descriptor.value !== undefined ||
        IS_PROXY(descriptor.get) || IS_PROXY(descriptor.set)) return false;
  }
  return true;
}

function exactHashObject(hash, hashPrototype, expectedKeys, expectedStatePrototype) {
  if (hash === null || typeof hash !== 'object' || IS_PROXY(hash) ||
      OBJECT_GET_PROTOTYPE_OF(hash) !== hashPrototype) return false;
  const keys = REFLECT_OWN_KEYS(hash);
  if (keys.length !== 3 || keys[0] !== '_options' || typeof keys[1] !== 'symbol' ||
      typeof keys[2] !== 'symbol' || keys[1] === keys[2] ||
      (expectedKeys && (keys[1] !== expectedKeys[1] || keys[2] !== expectedKeys[2]))) return false;
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(hash, keys[index]);
    if (!descriptor || descriptor.writable !== true || descriptor.enumerable !== true ||
        descriptor.configurable !== true || descriptor.get !== undefined ||
        descriptor.set !== undefined) return false;
    if (index === 0 && descriptor.value !== undefined) return false;
    if (index > 0 && (descriptor.value === null || typeof descriptor.value !== 'object' ||
        IS_PROXY(descriptor.value))) return false;
  }
  const stateDescriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(hash, keys[2]);
  return Boolean(stateDescriptor &&
    OBJECT_GET_PROTOTYPE_OF(stateDescriptor.value) === expectedStatePrototype);
}

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
  const cryptoFunctionPrototype = typeof createHash === 'function' ?
    OBJECT_GET_PROTOTYPE_OF(createHash) : null;
  if (typeof createHash !== 'function' || IS_PROXY(createHash) ||
      !exactFunctionPrototype(cryptoFunctionPrototype) ||
      canonicalFunctionSource(createHash) !== CREATE_HASH_SOURCE) {
    throw bootstrapInvalid();
  }
  if (createDescriptor.enumerable !== true || createDescriptor.writable !== true ||
      createDescriptor.configurable !== true) throw bootstrapInvalid();

  const first = REFLECT_APPLY(createHash, undefined, ['sha256']);
  const second = REFLECT_APPLY(createHash, undefined, ['sha256']);
  const instancePrototype = OBJECT_GET_PROTOTYPE_OF(first);
  if (instancePrototype === null || OBJECT_GET_PROTOTYPE_OF(second) !== instancePrototype) {
    throw bootstrapInvalid();
  }
  if (!exactHashPrototype(instancePrototype, cryptoFunctionPrototype)) throw bootstrapInvalid();
  const firstKeys = REFLECT_OWN_KEYS(first);
  const firstState = firstKeys.length === 3 ?
    OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(first, firstKeys[2])?.value : null;
  const statePrototype = firstState !== null && typeof firstState === 'object' &&
    !IS_PROXY(firstState) ? OBJECT_GET_PROTOTYPE_OF(firstState) : null;
  if (statePrototype === null || IS_PROXY(statePrototype) ||
      OBJECT_GET_PROTOTYPE_OF(statePrototype) !== null ||
      !exactHashObject(first, instancePrototype, firstKeys, statePrototype) ||
      !exactHashObject(second, instancePrototype, firstKeys, statePrototype)) {
    throw bootstrapInvalid();
  }
  const hashKeys = OBJECT_FREEZE([firstKeys[0], firstKeys[1], firstKeys[2]]);
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
  if (!exactFunctionShape(update, 'update', 2, HASH_UPDATE_SOURCE, cryptoFunctionPrototype) ||
      !exactFunctionShape(digest, 'digest', 1, HASH_DIGEST_SOURCE, cryptoFunctionPrototype)) {
    throw bootstrapInvalid();
  }
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
    createHash, cryptoFunctionPrototype, instancePrototype, methodPrototype, parentPrototype,
    hashKeys, statePrototype, update, digest,
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

const PART14A_RELEASE = OBJECT_FREEZE({
  head: '48906ed5205a489a3c0ca88a22dc47012257ae7b',
  tree: '69dd1d1ea3465e7577edc2bfd174cdb5747c5de4',
  main: 'db18448606db66e8ca131cba6d245f8f5e0e28d7',
  pr: 'PR #534', deployment: 'a3e010ea-6585-4c0f-8c60-b02a62fec372',
  image: 'sha256:ba113884bc4daea2261e6dd74fe6cf96783796375bd0009f89ee9b1a14ee36e2',
  node: '22.23.3',
});

const LATER_LEDGER_ROWS = OBJECT_FREEZE([
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
    normalizedSha256: 'f2a27937dd3cf4bc3ebe20ace540f4e2aa82fcad6c3f88993281496fcb315198',
    normalizedUtf8Bytes: 72404,
    normalizedLineCount: 349,
  }),
  ledger: OBJECT_FREEZE({
    path: 'docs/roadmap/MISSION_27_ACCEPTANCE_LEDGER.md',
    normalizedSha256: '239c167cb5a65cc52631895c8204ba89e88780f15c0b0733db52206e30611b60',
    normalizedUtf8Bytes: 95930,
    normalizedLineCount: 138,
  }),
  architecture14A: OBJECT_FREEZE({
    path: 'docs/architecture/MISSION_27_PART14A_PAID_PROVIDER_DISABLED_JOURNEY.md',
    normalizedSha256: '841189a5e1e03e9d6c54579a043847e87a3ae80e8c93a46dd9f975bb9843144c',
    normalizedUtf8Bytes: 6338,
    normalizedLineCount: 59,
  }),
  architecture14B: OBJECT_FREEZE({
    path: 'docs/architecture/MISSION_27_PART14B_RESETTABLE_FICTIONAL_DEMO_JOURNEY.md',
    normalizedSha256: '14cf342eba3d656e70565685ddf10e4c634cb8b90dbc3c7aeff33ad713ef49ef',
    normalizedUtf8Bytes: 9316,
    normalizedLineCount: 35,
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
  if (!exactFunctionPrototype(capabilities.cryptoFunctionPrototype) ||
      !exactHashPrototype(capabilities.instancePrototype, capabilities.cryptoFunctionPrototype) ||
      OBJECT_GET_PROTOTYPE_OF(capabilities.instancePrototype) !==
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
  if (!exactHashObject(hash, capabilities.instancePrototype, capabilities.hashKeys,
    capabilities.statePrototype)) {
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
  if (keys.length !== 4) throw invalid();
  let roadmap; let ledger; let architecture14A; let architecture14B;
  let hasRoadmap = false; let hasLedger = false;
  let hasArchitecture14A = false; let hasArchitecture14B = false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== 'string') throw invalid();
    const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(input, key);
    if (!descriptor || descriptor.enumerable !== true || descriptor.writable !== true ||
        descriptor.configurable !== true || !('value' in descriptor) ||
        typeof descriptor.value !== 'string') throw invalid();
    if (key === 'roadmap' && !hasRoadmap) { roadmap = descriptor.value; hasRoadmap = true; }
    else if (key === 'ledger' && !hasLedger) { ledger = descriptor.value; hasLedger = true; }
    else if (key === 'architecture14A' && !hasArchitecture14A) {
      architecture14A = descriptor.value; hasArchitecture14A = true;
    } else if (key === 'architecture14B' && !hasArchitecture14B) {
      architecture14B = descriptor.value; hasArchitecture14B = true;
    } else throw invalid();
  }
  if (!hasRoadmap || !hasLedger || !hasArchitecture14A || !hasArchitecture14B) throw invalid();
  return [roadmap, ledger, architecture14A, architecture14B];
}

const VALIDATED_AUTHORITY = OBJECT_FREEZE({
  contractVersion: 'm27-part14b-authority-ratification-v1',
  releasedPart13Head: PART13_RELEASE.head,
  releasedPart14AHead: PART14A_RELEASE.head,
  currentSlice: '14B', currentStatus: 'candidate',
  laterSlices: OBJECT_FREEZE(['14C','14D','14E','14F','14G']),
  migrationLatest: 272, migration273Present: false,
});

function validate(input) {
  const values = readCanonicalInput(input);
  validateDocument('roadmap', values[0]);
  validateDocument('ledger', values[1]);
  validateDocument('architecture14A', values[2]);
  validateDocument('architecture14B', values[3]);
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
  PART14A_RELEASE:{value:PART14A_RELEASE, enumerable:true, writable:false, configurable:false},
  LATER_LEDGER_ROWS:{value:LATER_LEDGER_ROWS, enumerable:true, writable:false, configurable:false},
  CANONICAL_DOCUMENTS:{value:CANONICAL_DOCUMENTS, enumerable:true, writable:false, configurable:false},
  validate:{value:validate, enumerable:true, writable:false, configurable:false},
});
OBJECT_FREEZE(API);
OBJECT_DEFINE_PROPERTY(module, 'exports', {
  value:API, enumerable:true, writable:false, configurable:false,
});
