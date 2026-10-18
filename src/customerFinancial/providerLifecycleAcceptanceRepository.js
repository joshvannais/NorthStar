'use strict';

function bootstrapInvalid() {
  throw new Error('Provider lifecycle acceptance boundary invalid');
}

function captureRealmRuntime() {
  const functionToString = Function.prototype.toString;
  const reflectApply = Reflect.apply;
  const descriptorOf = Reflect.getOwnPropertyDescriptor;
  function sourceOf(value) { return reflectApply(functionToString, value, []); }
  function contains(haystack, needle) {
    if (typeof haystack !== 'string' || typeof needle !== 'string' ||
        needle.length === 0 || needle.length > haystack.length) return false;
    for (let start = 0; start <= haystack.length - needle.length; start += 1) {
      let equal = true;
      for (let index = 0; index < needle.length; index += 1) {
        if (haystack[start + index] !== needle[index]) { equal = false; break; }
      }
      if (equal) return true;
    }
    return false;
  }
  try {
    if (sourceOf(functionToString) !== 'function toString() { [native code] }' ||
        sourceOf(reflectApply) !== 'function apply() { [native code] }' ||
        sourceOf(descriptorOf) !==
          'function getOwnPropertyDescriptor() { [native code] }') bootstrapInvalid();
    const binding = process.binding;
    const bindingSource = sourceOf(binding);
    const natives = binding('natives');
    const realmDescriptor = descriptorOf(natives, 'internal/bootstrap/realm');
    const vmSourceDescriptor = descriptorOf(natives, 'vm');
    if (!realmDescriptor || typeof realmDescriptor.value !== 'string' ||
        !vmSourceDescriptor || typeof vmSourceDescriptor.value !== 'string' ||
        !contains(realmDescriptor.value, bindingSource)) bootstrapInvalid();
    const vmModule = require('node:vm');
    if (require('vm') !== vmModule) bootstrapInvalid();
    const runDescriptor = descriptorOf(vmModule, 'runInNewContext');
    if (!runDescriptor || runDescriptor.enumerable !== true ||
        runDescriptor.writable !== true || runDescriptor.configurable !== true ||
        typeof runDescriptor.value !== 'function' ||
        !contains(vmSourceDescriptor.value, sourceOf(runDescriptor.value))) bootstrapInvalid();
    const runInNewContext = runDescriptor.value;
    const token = Symbol('m27-part13d-clean-realm');
    if (runInNewContext('token', { __proto__: null, token }) !== token ||
        runInNewContext(
          'Object.prototype !== hostObjectPrototype && ' +
          'Array.prototype !== hostArrayPrototype && ' +
          'Object.getPrototypeOf(Object.prototype) === null',
          { __proto__: null, hostObjectPrototype: Object.prototype,
            hostArrayPrototype: Array.prototype }) !== true) bootstrapInvalid();
    const utilModule = require('node:util');
    if (require('util') !== utilModule) bootstrapInvalid();
    const typesDescriptor = descriptorOf(utilModule, 'types');
    const isProxyDescriptor = typesDescriptor &&
      descriptorOf(typesDescriptor.value, 'isProxy');
    const proxyDescriptor = descriptorOf(globalThis, 'Proxy');
    if (!typesDescriptor || typeof typesDescriptor.value !== 'object' ||
        !isProxyDescriptor || typeof isProxyDescriptor.value !== 'function' ||
        !proxyDescriptor || typeof proxyDescriptor.value !== 'function' ||
        !contains(sourceOf(isProxyDescriptor.value), '[native code]') ||
        !contains(sourceOf(proxyDescriptor.value), '[native code]')) bootstrapInvalid();
    const ordinary = {};
    const proxy = new proxyDescriptor.value(ordinary, {});
    if (isProxyDescriptor.value(ordinary) !== false ||
        isProxyDescriptor.value(proxy) !== true) bootstrapInvalid();
    return { runInNewContext, isProxy: isProxyDescriptor.value };
  } catch (error) {
    if (error && error.message === 'Provider lifecycle acceptance boundary invalid') throw error;
    bootstrapInvalid();
  }
}

const realmRuntime = captureRealmRuntime();

// The repository owns its guard and source validator. Neither comes from a
// replaceable CommonJS module record, and every inspection intrinsic comes from
// the fresh realm rather than mutable host Object static methods.
const privateSource = realmRuntime.runInNewContext(`(() => {
  const ownKeys = Reflect.ownKeys;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const getPrototypeOf = Object.getPrototypeOf;
  const arrayIsArray = Array.isArray;
  const objectIs = Object.is;
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const functionSource = value => Function.prototype.toString.call(value);
  const hostObjectPrototype = getPrototypeOf(hostObjectSample);
  const hostArrayPrototype = getPrototypeOf(hostArraySample);
  const jestHarnessSymbol = Symbol.for('$$jest-protect-from-deletion');
  const sourceKeys = Object.freeze([
    'organizationId', 'actorUserId', 'actorAccessRole', 'authSessionId',
  ]);

  function sameFunction(actual, expected) {
    if (typeof actual !== 'function' || isProxy(actual)) return false;
    try { return functionSource(actual) === functionSource(expected); }
    catch (_error) { return false; }
  }
  function sameFunctionOrUndefined(actual, expected) {
    return expected === undefined ? actual === undefined : sameFunction(actual, expected);
  }
  function sameValue(actual, expected, depth, seen, allowedHarnessSymbol) {
    if (objectIs(actual, expected)) return true;
    if (typeof expected === 'function') return sameFunction(actual, expected);
    if (expected === null || typeof expected !== 'object' ||
        actual === null || typeof actual !== 'object' || isProxy(actual) || depth > 8) {
      return false;
    }
    return sameObjectShape(actual, expected, depth + 1, seen, allowedHarnessSymbol);
  }
  function sameDescriptor(actual, expected, depth, seen, allowedHarnessSymbol) {
    if (!actual || !expected || actual.enumerable !== expected.enumerable ||
        actual.configurable !== expected.configurable) return false;
    const actualData = hasOwn(actual, 'value');
    const expectedData = hasOwn(expected, 'value');
    if (actualData !== expectedData) return false;
    if (actualData) {
      return actual.writable === expected.writable &&
        sameValue(actual.value, expected.value, depth, seen, allowedHarnessSymbol);
    }
    return sameFunctionOrUndefined(actual.get, expected.get) &&
      sameFunctionOrUndefined(actual.set, expected.set);
  }
  function sameObjectShape(actual, expected, depth, seen, allowedHarnessSymbol) {
    if (isProxy(actual) || seen.has(actual)) return false;
    seen.add(actual);
    let actualKeys = ownKeys(actual);
    const expectedKeys = ownKeys(expected);
    if (expected === Object.prototype && allowedHarnessSymbol !== null) {
      const withoutHarnessMarker = [];
      for (let index = 0; index < actualKeys.length; index += 1) {
        if (actualKeys[index] !== allowedHarnessSymbol) withoutHarnessMarker.push(actualKeys[index]);
      }
      actualKeys = withoutHarnessMarker;
    }
    if (actualKeys.length !== expectedKeys.length) return false;
    for (let index = 0; index < expectedKeys.length; index += 1) {
      if (actualKeys[index] !== expectedKeys[index] ||
          !sameDescriptor(getOwnPropertyDescriptor(actual, actualKeys[index]),
            getOwnPropertyDescriptor(expected, expectedKeys[index]), depth, seen,
            allowedHarnessSymbol)) return false;
    }
    const actualPrototype = getPrototypeOf(actual);
    const expectedPrototype = getPrototypeOf(expected);
    if (actualPrototype === null || expectedPrototype === null) {
      return actualPrototype === null && expectedPrototype === null;
    }
    return sameObjectShape(actualPrototype, expectedPrototype, depth + 1, seen,
      allowedHarnessSymbol);
  }
  function acceptedJestHarnessSymbol() {
    if (!isTest || !hasJestWorker) return null;
    const descriptor = getOwnPropertyDescriptor(hostObjectPrototype, jestHarnessSymbol);
    if (!descriptor || descriptor.enumerable || !descriptor.configurable ||
        !descriptor.writable || !hasOwn(descriptor, 'value') ||
        isProxy(descriptor.value) || !arrayIsArray(descriptor.value)) return null;
    const markerKeys = ownKeys(descriptor.value);
    const length = getOwnPropertyDescriptor(descriptor.value, 'length');
    if (markerKeys.length !== 1 || markerKeys[0] !== 'length' || !length ||
        length.value !== 0) return null;
    return jestHarnessSymbol;
  }
  function invalid() {
    return new Error('Provider lifecycle acceptance boundary invalid');
  }
  function assertCanonicalAmbientPrototypes() {
    const allowedHarnessSymbol = acceptedJestHarnessSymbol();
    if (!sameObjectShape(hostObjectPrototype, Object.prototype, 0, new Set(),
      allowedHarnessSymbol) ||
        !sameObjectShape(hostArrayPrototype, Array.prototype, 0, new Set(),
          allowedHarnessSymbol)) throw invalid();
  }
  function exactSourceRecord(value) {
    assertCanonicalAmbientPrototypes();
    if (value === null || typeof value !== 'object' || isProxy(value) ||
        arrayIsArray(value) || getPrototypeOf(value) !== hostObjectPrototype ||
        !sameObjectShape(hostObjectPrototype, Object.prototype, 0, new Set(),
          acceptedJestHarnessSymbol()) || getOwnPropertyDescriptor(value, 'toJSON')) throw invalid();
    const keys = ownKeys(value);
    if (keys.length !== sourceKeys.length) throw invalid();
    const record = Object.create(null);
    for (let index = 0; index < sourceKeys.length; index += 1) {
      let recognized = false;
      for (let allowed = 0; allowed < sourceKeys.length; allowed += 1) {
        if (keys[index] === sourceKeys[allowed]) { recognized = true; break; }
      }
      if (typeof keys[index] !== 'string' || !recognized) throw invalid();
      const key = sourceKeys[index];
      const descriptor = getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value') ||
          typeof descriptor.value !== 'string') throw invalid();
      record[key] = descriptor.value;
    }
    return record;
  }
  assertCanonicalAmbientPrototypes();
  return Object.freeze({ assertCanonicalAmbientPrototypes, exactSourceRecord,
    freeze: Object.freeze });
})()`, { __proto__: null, hostObjectSample: {}, hostArraySample: [],
  isProxy: realmRuntime.isProxy, isTest: process.env.NODE_ENV === 'test',
  hasJestWorker: !!process.env.JEST_WORKER_ID });
const { assertCanonicalAmbientPrototypes, exactSourceRecord, freeze } = privateSource;

// Reject pre-load pollution before importing any sealed upstream builder.
assertCanonicalAmbientPrototypes();

const contract = require('./providerLifecycleAcceptance');
const lifecycleRecovery = require('./providerLifecycleRecovery');
const lifecycleRecoveryRepository = require('./providerLifecycleRecoveryRepository');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restricted() {
  const error = new Error('Provider lifecycle acceptance access is restricted.');
  error.code = 'CUSTOMER_FINANCIAL_PROVIDER_ACCEPTANCE_RESTRICTED';
  error.status = 403;
  return error;
}
function stale() {
  const error = new Error('Refresh the current provider lifecycle acceptance evidence.');
  error.code = 'CUSTOMER_FINANCIAL_PROVIDER_ACCEPTANCE_STALE';
  error.status = 409;
  return error;
}
function sourceCurrent(source) {
  let exact;
  try {
    assertCanonicalAmbientPrototypes();
    exact = exactSourceRecord(source);
  } catch (_error) { return false; }
  return typeof exact.organizationId === 'string' &&
    typeof exact.actorUserId === 'string' &&
    typeof exact.authSessionId === 'string' &&
    typeof exact.actorAccessRole === 'string' &&
    UUID.test(exact.organizationId) && UUID.test(exact.actorUserId) &&
    UUID.test(exact.authSessionId) && exact.actorAccessRole === 'owner';
}
function createRepository(options) {
  assertCanonicalAmbientPrototypes();
  if (options === undefined) options = {};
  const readRecovery = options.readRecovery || lifecycleRecoveryRepository.read;
  async function snapshot(source) {
    assertCanonicalAmbientPrototypes();
    const raw = await readRecovery(source);
    contract.unavailable(raw);
    return lifecycleRecovery.project(raw);
  }
  async function read(source) {
    assertCanonicalAmbientPrototypes();
    if (!sourceCurrent(source)) throw restricted();
    const before = await snapshot(source);
    const value = contract.unavailable(before);
    const after = await snapshot(source);
    contract.unavailable(after);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw stale();
    return contract.project(value, after);
  }
  return freeze({ read });
}
const production = createRepository();
module.exports = freeze({ sourceCurrent, createRepository, read: production.read });
