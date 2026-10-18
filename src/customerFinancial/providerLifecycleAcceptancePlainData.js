'use strict';

function bootstrapInvalid() {
  throw new Error('Provider lifecycle acceptance boundary invalid');
}

// See the Part 13D architecture note for the explicit supported-Node bootstrap
// assumption. This boundary uses fixed manifests, not process.binding or vm.
function captureBoundaryRuntime() {
  const ownKeys = Reflect.ownKeys;
  const descriptorOf = Reflect.getOwnPropertyDescriptor;
  const getPrototypeOf = Reflect.getPrototypeOf;
  const defineProperty = Reflect.defineProperty;
  const preventExtensions = Reflect.preventExtensions;
  const reflectApply = Reflect.apply;
  const functionToString = Function.prototype.toString;
  const arrayIsArray = Array.isArray;
  const numberIsFinite = Number.isFinite;
  const objectIs = Object.is;
  const hostObjectPrototype = Object.prototype;
  const hostArrayPrototype = Array.prototype;
  const jestHarnessSymbol = Symbol.for('$$jest-protect-from-deletion');
  const objectFunctions = [
    ['constructor', 'Object'], ['__defineGetter__', '__defineGetter__'],
    ['__defineSetter__', '__defineSetter__'], ['hasOwnProperty', 'hasOwnProperty'],
    ['__lookupGetter__', '__lookupGetter__'], ['__lookupSetter__', '__lookupSetter__'],
    ['isPrototypeOf', 'isPrototypeOf'], ['propertyIsEnumerable', 'propertyIsEnumerable'],
    ['toString', 'toString'], ['valueOf', 'valueOf'],
    ['toLocaleString', 'toLocaleString'],
  ];
  const arrayFunctionNames = [
    'constructor', 'at', 'concat', 'copyWithin', 'fill', 'find', 'findIndex',
    'findLast', 'findLastIndex', 'lastIndexOf', 'pop', 'push', 'reverse', 'shift',
    'unshift', 'slice', 'sort', 'splice', 'includes', 'indexOf', 'join', 'keys',
    'entries', 'values', 'forEach', 'filter', 'flat', 'flatMap', 'map', 'every',
    'some', 'reduce', 'reduceRight', 'toReversed', 'toSorted', 'toSpliced', 'with',
    'toLocaleString', 'toString',
  ];
  const unscopableNames = [
    'at', 'copyWithin', 'entries', 'fill', 'find', 'findIndex', 'findLast',
    'findLastIndex', 'flat', 'flatMap', 'includes', 'keys', 'toReversed',
    'toSorted', 'toSpliced', 'values',
  ];

  function hasOwn(value, key) { return descriptorOf(value, key) !== undefined; }
  function sourceOf(value) { return reflectApply(functionToString, value, []); }
  function nativeSource(name) { return `function ${name}() { [native code] }`; }
  function nativeDataDescriptor(value, expectedName) {
    const descriptor = descriptorOf(value.owner, value.key);
    return Boolean(descriptor && descriptor.enumerable === false &&
      descriptor.configurable === true && descriptor.writable === true &&
      typeof descriptor.value === 'function' &&
      sourceOf(descriptor.value) === nativeSource(expectedName));
  }
  function acceptedHarnessSymbol() {
    if (process.env.NODE_ENV !== 'test' || !process.env.JEST_WORKER_ID) return null;
    const descriptor = descriptorOf(hostObjectPrototype, jestHarnessSymbol);
    if (!descriptor || descriptor.enumerable || !descriptor.configurable ||
        !descriptor.writable || !hasOwn(descriptor, 'value') ||
        !arrayIsArray(descriptor.value)) {
      return null;
    }
    const keys = ownKeys(descriptor.value);
    const length = descriptorOf(descriptor.value, 'length');
    return keys.length === 1 && keys[0] === 'length' && length &&
      length.value === 0 ? jestHarnessSymbol : null;
  }
  function objectPrototypeMatches(allowedHarnessSymbol) {
    if (getPrototypeOf(hostObjectPrototype) !== null) return false;
    const keys = ownKeys(hostObjectPrototype);
    let expectedIndex = 0;
    for (let index = 0; index < keys.length; index += 1) {
      if (keys[index] === allowedHarnessSymbol && allowedHarnessSymbol !== null) continue;
      const expectedKey = expectedIndex === 10 ? '__proto__' :
        objectFunctions[expectedIndex < 10 ? expectedIndex : expectedIndex - 1]?.[0];
      if (keys[index] !== expectedKey) return false;
      expectedIndex += 1;
    }
    if (expectedIndex !== 12) return false;
    for (let index = 0; index < 10; index += 1) {
      if (!nativeDataDescriptor({ owner: hostObjectPrototype,
        key: objectFunctions[index][0] }, objectFunctions[index][1])) return false;
    }
    if (!nativeDataDescriptor({ owner: hostObjectPrototype,
      key: 'toLocaleString' }, 'toLocaleString')) return false;
    const proto = descriptorOf(hostObjectPrototype, '__proto__');
    return Boolean(proto && proto.enumerable === false && proto.configurable === true &&
      !hasOwn(proto, 'value') && typeof proto.get === 'function' &&
      typeof proto.set === 'function' &&
      sourceOf(proto.get) === 'function get __proto__() { [native code] }' &&
      sourceOf(proto.set) === 'function set __proto__() { [native code] }');
  }
  function unscopablesMatch(value) {
    if (value === null || typeof value !== 'object' || getPrototypeOf(value) !== null) return false;
    const keys = ownKeys(value);
    if (keys.length !== unscopableNames.length) return false;
    for (let index = 0; index < keys.length; index += 1) {
      if (keys[index] !== unscopableNames[index]) return false;
      const descriptor = descriptorOf(value, keys[index]);
      if (!descriptor || descriptor.value !== true || descriptor.enumerable !== true ||
          descriptor.configurable !== true || descriptor.writable !== true) return false;
    }
    return true;
  }
  function arrayPrototypeMatches() {
    if (!arrayIsArray(hostArrayPrototype) ||
        getPrototypeOf(hostArrayPrototype) !== hostObjectPrototype) return false;
    const expectedKeys = ['length'];
    for (let index = 0; index < arrayFunctionNames.length; index += 1) {
      expectedKeys.push(arrayFunctionNames[index]);
    }
    expectedKeys.push(Symbol.iterator, Symbol.unscopables);
    const keys = ownKeys(hostArrayPrototype);
    if (keys.length !== expectedKeys.length) return false;
    for (let index = 0; index < keys.length; index += 1) {
      if (keys[index] !== expectedKeys[index]) return false;
    }
    const length = descriptorOf(hostArrayPrototype, 'length');
    if (!length || length.value !== 0 || length.enumerable || length.configurable ||
        length.writable !== true) return false;
    for (let index = 0; index < arrayFunctionNames.length; index += 1) {
      const key = arrayFunctionNames[index];
      const expectedName = key === 'constructor' ? 'Array' : key;
      if (!nativeDataDescriptor({ owner: hostArrayPrototype, key }, expectedName)) return false;
    }
    if (!nativeDataDescriptor({ owner: hostArrayPrototype,
      key: Symbol.iterator }, 'values')) return false;
    const unscopables = descriptorOf(hostArrayPrototype, Symbol.unscopables);
    return Boolean(unscopables && unscopables.enumerable === false &&
      unscopables.configurable === true && unscopables.writable === false &&
      unscopablesMatch(unscopables.value));
  }
  function assertCanonicalAmbientPrototypes() {
    const harness = acceptedHarnessSymbol();
    if (!objectPrototypeMatches(harness) || !arrayPrototypeMatches()) bootstrapInvalid();
  }

  // This is the first executable boundary. It runs before node:util, any Part
  // 13 dependency, serializer, digest, default builder or source read.
  assertCanonicalAmbientPrototypes();

  const utilModule = require('node:util');
  const typesDescriptor = descriptorOf(utilModule, 'types');
  const proxyDescriptor = descriptorOf(globalThis, 'Proxy');
  const isProxyDescriptor = typesDescriptor && descriptorOf(typesDescriptor.value, 'isProxy');
  if (!typesDescriptor || typeof typesDescriptor.value !== 'object' ||
      !isProxyDescriptor || typeof isProxyDescriptor.value !== 'function' ||
      !proxyDescriptor || typeof proxyDescriptor.value !== 'function') bootstrapInvalid();
  const isProxy = isProxyDescriptor.value;
  const ordinary = {};
  const proxy = new proxyDescriptor.value(ordinary, {});
  if (isProxy(ordinary) !== false || isProxy(proxy) !== true) bootstrapInvalid();

  function freeze(value) {
    const keys = ownKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      const descriptor = descriptorOf(value, keys[index]);
      descriptor.configurable = false;
      if (hasOwn(descriptor, 'writable')) descriptor.writable = false;
      if (!defineProperty(value, keys[index], descriptor)) bootstrapInvalid();
    }
    if (!preventExtensions(value)) bootstrapInvalid();
    return value;
  }
  function create(prototype) {
    if (prototype !== null) bootstrapInvalid();
    return { __proto__: null };
  }
  function defineProperties(target, descriptors) {
    const keys = ownKeys(descriptors);
    for (let index = 0; index < keys.length; index += 1) {
      const holder = descriptorOf(descriptors, keys[index]);
      if (!holder || !hasOwn(holder, 'value') ||
          !defineProperty(target, keys[index], holder.value)) bootstrapInvalid();
    }
    return target;
  }
  function assertStrictPlainData(value, invalidFactory = bootstrapInvalid,
      maximumDepth = 32, maximumNodes = 8192) {
    assertCanonicalAmbientPrototypes();
    const visited = new Set();
    let nodes = 0;
    function reject() { throw invalidFactory(); }
    function visit(current, depth) {
      nodes += 1;
      if (nodes > maximumNodes || depth > maximumDepth) reject();
      if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
      if (typeof current === 'number') {
        if (!numberIsFinite(current) || objectIs(current, -0)) reject();
        return;
      }
      if (typeof current !== 'object' || isProxy(current) || visited.has(current)) reject();
      visited.add(current);
      const isArray = arrayIsArray(current);
      if (getPrototypeOf(current) !== (isArray ? hostArrayPrototype : hostObjectPrototype) ||
          descriptorOf(current, 'toJSON')) reject();
      const keys = ownKeys(current);
      for (let index = 0; index < keys.length; index += 1) {
        if (typeof keys[index] !== 'string') reject();
      }
      if (isArray) {
        const length = descriptorOf(current, 'length');
        if (!length || typeof length.value !== 'number' || length.enumerable ||
            keys.length !== length.value + 1) reject();
        for (let index = 0; index < length.value; index += 1) {
          const descriptor = descriptorOf(current, String(index));
          if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) reject();
          visit(descriptor.value, depth + 1);
        }
        return;
      }
      for (let index = 0; index < keys.length; index += 1) {
        const descriptor = descriptorOf(current, keys[index]);
        if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) reject();
        visit(descriptor.value, depth + 1);
      }
    }
    visit(value, 0);
  }
  function sameStrictPlainData(left, right) {
    try { assertStrictPlainData(left); assertStrictPlainData(right); }
    catch (_error) { return false; }
    function same(leftValue, rightValue) {
      if (objectIs(leftValue, rightValue)) return true;
      if (leftValue === null || rightValue === null ||
          typeof leftValue !== 'object' || typeof rightValue !== 'object' ||
          arrayIsArray(leftValue) !== arrayIsArray(rightValue)) return false;
      const leftKeys = ownKeys(leftValue);
      const rightKeys = ownKeys(rightValue);
      if (leftKeys.length !== rightKeys.length) return false;
      for (let index = 0; index < leftKeys.length; index += 1) {
        if (leftKeys[index] !== rightKeys[index]) return false;
        const leftDescriptor = descriptorOf(leftValue, leftKeys[index]);
        const rightDescriptor = descriptorOf(rightValue, rightKeys[index]);
        if (!leftDescriptor || !rightDescriptor || !hasOwn(leftDescriptor, 'value') ||
            !hasOwn(rightDescriptor, 'value') ||
            !same(leftDescriptor.value, rightDescriptor.value)) return false;
      }
      return true;
    }
    return same(left, right);
  }
  function exactSourceRecord(value) {
    assertStrictPlainData(value);
    if (arrayIsArray(value)) bootstrapInvalid();
    const sourceKeys = ['organizationId', 'actorUserId', 'actorAccessRole', 'authSessionId'];
    const keys = ownKeys(value);
    if (keys.length !== sourceKeys.length) bootstrapInvalid();
    const record = create(null);
    for (let index = 0; index < sourceKeys.length; index += 1) {
      let recognized = false;
      for (let allowed = 0; allowed < sourceKeys.length; allowed += 1) {
        if (keys[index] === sourceKeys[allowed]) { recognized = true; break; }
      }
      const descriptor = descriptorOf(value, sourceKeys[index]);
      if (!recognized || !descriptor || !descriptor.enumerable ||
          !hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') bootstrapInvalid();
      record[sourceKeys[index]] = descriptor.value;
    }
    return record;
  }
  function createBoundary() {
    const api = create(null);
    const values = {
      __proto__: null,
      assertCanonicalAmbientPrototypes, assertStrictPlainData, sameStrictPlainData,
      exactSourceRecord, freeze, ownKeys, getOwnPropertyDescriptor: descriptorOf,
      getPrototypeOf, create, defineProperties, preventExtensions, defineProperty,
      arrayIsArray, numberIsFinite, objectIs, hasOwn, jestHarnessSymbol,
      matchesCanonicalPrototype(value, isArray, allowedHarnessSymbol) {
        return isArray ? value === hostArrayPrototype && arrayPrototypeMatches() :
          value === hostObjectPrototype && objectPrototypeMatches(allowedHarnessSymbol);
      },
    };
    const keys = ownKeys(values);
    for (let index = 0; index < keys.length; index += 1) api[keys[index]] = values[keys[index]];
    return api;
  }
  return { createBoundary, isProxy };
}

const realmRuntime = captureBoundaryRuntime();

// The fixed manifest rejects ambient prototype pollution before this private
// capability object is constructed.
const pristine = realmRuntime.createBoundary();

const HOST_OBJECT_PROTOTYPE = pristine.getPrototypeOf({});
const HOST_ARRAY_PROTOTYPE = pristine.getPrototypeOf([]);

function acceptedJestHarnessSymbol() {
  if (process.env.NODE_ENV !== 'test' || !process.env.JEST_WORKER_ID) return null;
  const descriptor = pristine.getOwnPropertyDescriptor(
    HOST_OBJECT_PROTOTYPE, pristine.jestHarnessSymbol);
  if (!descriptor || descriptor.enumerable || !descriptor.configurable ||
      !descriptor.writable || !pristine.hasOwn(descriptor, 'value') ||
      realmRuntime.isProxy(descriptor.value) || !pristine.arrayIsArray(descriptor.value)) return null;
  const markerKeys = pristine.ownKeys(descriptor.value);
  const length = pristine.getOwnPropertyDescriptor(descriptor.value, 'length');
  if (markerKeys.length !== 1 || markerKeys[0] !== 'length' || !length || length.value !== 0) {
    return null;
  }
  return pristine.jestHarnessSymbol;
}

function defaultInvalid() {
  return new Error('Provider lifecycle acceptance boundary invalid');
}

function assertCanonicalAmbientPrototypes() {
  const allowedHarnessSymbol = acceptedJestHarnessSymbol();
  if (!pristine.matchesCanonicalPrototype(
    HOST_OBJECT_PROTOTYPE, false, allowedHarnessSymbol) ||
      !pristine.matchesCanonicalPrototype(
        HOST_ARRAY_PROTOTYPE, true, allowedHarnessSymbol)) {
    throw defaultInvalid();
  }
}

// Reject polluted prototypes before executing any host-realm construction.
assertCanonicalAmbientPrototypes();

function assertStrictPlainData(value, invalid = defaultInvalid,
    maximumDepth = 32, maximumNodes = 8192) {
  assertCanonicalAmbientPrototypes();
  const visited = new Set();
  let nodes = 0;

  function reject() { throw invalid(); }
  function visit(current, depth) {
    nodes += 1;
    if (nodes > maximumNodes || depth > maximumDepth) reject();
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number') {
      if (!pristine.numberIsFinite(current) || pristine.objectIs(current, -0)) reject();
      return;
    }
    if (typeof current !== 'object' || realmRuntime.isProxy(current) || visited.has(current)) reject();
    visited.add(current);

    const isArray = pristine.arrayIsArray(current);
    const prototype = pristine.getPrototypeOf(current);
    const expectedPrototype = isArray ? HOST_ARRAY_PROTOTYPE : HOST_OBJECT_PROTOTYPE;
    if (prototype !== expectedPrototype ||
        !pristine.matchesCanonicalPrototype(
          prototype, isArray, acceptedJestHarnessSymbol()) ||
        pristine.getOwnPropertyDescriptor(current, 'toJSON')) reject();

    const ownKeys = pristine.ownKeys(current);
    for (let index = 0; index < ownKeys.length; index += 1) {
      if (typeof ownKeys[index] !== 'string') reject();
    }

    if (isArray) {
      if (ownKeys.length !== current.length + 1) reject();
      const lengthDescriptor = pristine.getOwnPropertyDescriptor(current, 'length');
      if (!lengthDescriptor || lengthDescriptor.enumerable ||
          !pristine.hasOwn(lengthDescriptor, 'value') ||
          typeof lengthDescriptor.value !== 'number') reject();
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = pristine.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !descriptor.enumerable ||
            !pristine.hasOwn(descriptor, 'value')) reject();
        visit(descriptor.value, depth + 1);
      }
      return;
    }

    for (let index = 0; index < ownKeys.length; index += 1) {
      const descriptor = pristine.getOwnPropertyDescriptor(current, ownKeys[index]);
      if (!descriptor || !descriptor.enumerable || !pristine.hasOwn(descriptor, 'value')) reject();
      visit(descriptor.value, depth + 1);
    }
  }

  visit(value, 0);
}

function sameStrictPlainData(left, right) {
  try { assertCanonicalAmbientPrototypes(); }
  catch (_error) { return false; }
  if (pristine.objectIs(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object' ||
      pristine.arrayIsArray(left) !== pristine.arrayIsArray(right)) return false;
  const leftKeys = pristine.ownKeys(left);
  const rightKeys = pristine.ownKeys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index]) return false;
    const leftDescriptor = pristine.getOwnPropertyDescriptor(left, leftKeys[index]);
    const rightDescriptor = pristine.getOwnPropertyDescriptor(right, rightKeys[index]);
    if (!leftDescriptor || !rightDescriptor ||
        !pristine.hasOwn(leftDescriptor, 'value') ||
        !pristine.hasOwn(rightDescriptor, 'value') ||
        !sameStrictPlainData(leftDescriptor.value, rightDescriptor.value)) return false;
  }
  return true;
}

function exactPlainRecord(value, orderedKeys, invalid = defaultInvalid) {
  assertCanonicalAmbientPrototypes();
  assertStrictPlainData(value, invalid);
  const keys = pristine.ownKeys(value);
  if (keys.length !== orderedKeys.length) throw invalid();
  const record = pristine.create(null);
  for (let index = 0; index < orderedKeys.length; index += 1) {
    const key = orderedKeys[index];
    let recognized = false;
    for (let allowedIndex = 0; allowedIndex < orderedKeys.length; allowedIndex += 1) {
      if (keys[index] === orderedKeys[allowedIndex]) { recognized = true; break; }
    }
    if (typeof keys[index] !== 'string' || !recognized) throw invalid();
    const descriptor = pristine.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !pristine.hasOwn(descriptor, 'value')) throw invalid();
    record[key] = descriptor.value;
  }
  return record;
}

// The fixed schema remains inside this closure. Consumers receive only
// immutable callable capabilities on a null-prototype object. The Module's
// exports slot is also sealed so an earlier importer cannot replace the API
// before the Part 13D contract captures it from the CommonJS cache.
const publicApi = pristine.create(null);
const publicDescriptors = pristine.create(null);
for (const [name, capability] of [
  ['assertCanonicalAmbientPrototypes', assertCanonicalAmbientPrototypes],
  ['assertStrictPlainData', assertStrictPlainData],
  ['sameStrictPlainData', sameStrictPlainData],
  ['exactPlainRecord', exactPlainRecord],
]) {
  pristine.freeze(capability);
  const descriptor = pristine.create(null);
  descriptor.value = capability;
  descriptor.enumerable = true;
  descriptor.writable = false;
  descriptor.configurable = false;
  publicDescriptors[name] = descriptor;
}
pristine.defineProperties(publicApi, publicDescriptors);
pristine.preventExtensions(publicApi);
const exportsDescriptor = pristine.create(null);
exportsDescriptor.value = publicApi;
exportsDescriptor.enumerable = true;
exportsDescriptor.writable = false;
exportsDescriptor.configurable = false;
pristine.defineProperty(module, 'exports', exportsDescriptor);
