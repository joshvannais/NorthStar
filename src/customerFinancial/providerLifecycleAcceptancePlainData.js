'use strict';

const vm = require('node:vm');
const { types: utilTypes } = require('node:util');

// This validator is deliberately built in a fresh realm. Its canonical
// Object/Array prototype definitions therefore cannot learn pollution that was
// installed in the application realm before this module was required.
const pristine = vm.runInNewContext(`(() => {
  const ownKeys = Reflect.ownKeys;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const getPrototypeOf = Object.getPrototypeOf;
  const arrayIsArray = Array.isArray;
  const numberIsFinite = Number.isFinite;
  const objectIs = Object.is;
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const functionSource = value => Function.prototype.toString.call(value);

  function sameFunction(actual, expected) {
    if (typeof actual !== 'function' || isProxy(actual)) return false;
    try { return functionSource(actual) === functionSource(expected); }
    catch (_error) { return false; }
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

  function sameFunctionOrUndefined(actual, expected) {
    return expected === undefined ? actual === undefined : sameFunction(actual, expected);
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

  return {
    ownKeys,
    getOwnPropertyDescriptor,
    getPrototypeOf,
    arrayIsArray,
    numberIsFinite,
    objectIs,
    hasOwn,
    jestHarnessSymbol: Symbol.for('$$jest-protect-from-deletion'),
    matchesCanonicalPrototype(actual, isArray, allowedHarnessSymbol) {
      return sameObjectShape(actual, isArray ? Array.prototype : Object.prototype,
        0, new Set(), allowedHarnessSymbol);
    },
  };
})()`, { isProxy: utilTypes.isProxy });

const HOST_OBJECT_PROTOTYPE = pristine.getPrototypeOf({});
const HOST_ARRAY_PROTOTYPE = pristine.getPrototypeOf([]);

function acceptedJestHarnessSymbol() {
  if (process.env.NODE_ENV !== 'test' || !process.env.JEST_WORKER_ID) return null;
  const descriptor = pristine.getOwnPropertyDescriptor(
    HOST_OBJECT_PROTOTYPE, pristine.jestHarnessSymbol);
  if (!descriptor || descriptor.enumerable || !descriptor.configurable ||
      !descriptor.writable || !pristine.hasOwn(descriptor, 'value') ||
      utilTypes.isProxy(descriptor.value) || !pristine.arrayIsArray(descriptor.value)) return null;
  const markerKeys = pristine.ownKeys(descriptor.value);
  const length = pristine.getOwnPropertyDescriptor(descriptor.value, 'length');
  if (markerKeys.length !== 1 || markerKeys[0] !== 'length' || !length || length.value !== 0) {
    return null;
  }
  return pristine.jestHarnessSymbol;
}

const JEST_HARNESS_SYMBOL = acceptedJestHarnessSymbol();

function defaultInvalid() {
  return new Error('Provider lifecycle acceptance boundary invalid');
}

function assertStrictPlainData(value, invalid = defaultInvalid,
    maximumDepth = 32, maximumNodes = 8192) {
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
    if (typeof current !== 'object' || utilTypes.isProxy(current) || visited.has(current)) reject();
    visited.add(current);

    const isArray = pristine.arrayIsArray(current);
    const prototype = pristine.getPrototypeOf(current);
    const expectedPrototype = isArray ? HOST_ARRAY_PROTOTYPE : HOST_OBJECT_PROTOTYPE;
    if (prototype !== expectedPrototype ||
        !pristine.matchesCanonicalPrototype(prototype, isArray, JEST_HARNESS_SYMBOL) ||
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
  assertStrictPlainData(value, invalid);
  const keys = pristine.ownKeys(value);
  if (keys.length !== orderedKeys.length) throw invalid();
  const record = Object.create(null);
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

module.exports = { assertStrictPlainData, sameStrictPlainData, exactPlainRecord };
