'use strict';

const crypto = require('node:crypto');
const { types } = require('node:util');

const MAX_BYTES = 65_536;
const MAX_DEPTH = 24;
const MAX_NODES = 2_048;
const MAX_OBJECT_KEYS = 128;
const MAX_ARRAY_ITEMS = 256;
const MAX_KEY_BYTES = 128;
const MAX_STRING_BYTES = 8_192;

function reject(message = 'Mission 28 canonical data is invalid') {
  throw new TypeError(message);
}

function validateUnicodeScalarString(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) reject(`Mission 28 canonical ${label} contains an unsupported null scalar`);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF))
        reject(`Mission 28 canonical ${label} contains an unpaired surrogate`);
      index += 1;
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
      reject(`Mission 28 canonical ${label} contains an unpaired surrogate`);
    }
  }
}

function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, value => value.codePointAt(0));
  const rightPoints = Array.from(right, value => value.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function inspect(value, state, depth) {
  if (depth > MAX_DEPTH) reject('Mission 28 canonical data exceeds the depth bound');
  state.nodes += 1;
  if (state.nodes > MAX_NODES) reject('Mission 28 canonical data exceeds the node bound');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    validateUnicodeScalarString(value, 'string');
    if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) reject('Mission 28 canonical string exceeds the bound');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) reject('Mission 28 canonical number is not a safe integer');
    return;
  }
  if (typeof value !== 'object' || types.isProxy(value)) reject();
  if (state.seen.has(value)) reject('Mission 28 canonical aliases and cycles are denied');
  state.seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (prototype !== Array.prototype || keys.length !== value.length + 1 ||
        keys.at(-1) !== 'length' || value.length > MAX_ARRAY_ITEMS) reject('Mission 28 canonical array shape is invalid');
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable ||
          descriptor.get || descriptor.set) reject('Mission 28 canonical array descriptor is invalid');
      inspect(descriptor.value, state, depth + 1);
    }
  } else {
    if (prototype !== Object.prototype || keys.length > MAX_OBJECT_KEYS) reject('Mission 28 canonical object shape is invalid');
    for (const key of keys) {
      if (typeof key !== 'string' || Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) reject('Mission 28 canonical key is invalid');
      validateUnicodeScalarString(key, 'key');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable ||
          !descriptor.configurable || !descriptor.writable || descriptor.get || descriptor.set) {
        reject('Mission 28 canonical object descriptor is invalid');
      }
      inspect(descriptor.value, state, depth + 1);
    }
  }
}

function encode(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
  return `{${Object.keys(value).sort(compareUnicodeCodePoints)
    .map(key => `${JSON.stringify(key)}:${encode(value[key])}`).join(',')}}`;
}

function canonicalize(value) {
  inspect(value, { nodes: 0, seen: new Set() }, 0);
  const encoded = encode(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_BYTES) reject('Mission 28 canonical document exceeds the byte bound');
  return encoded;
}

function digest(namespace, value) {
  if (typeof namespace !== 'string' || !namespace.endsWith('\n') ||
      Buffer.byteLength(namespace, 'utf8') > 128) reject('Mission 28 canonical namespace is invalid');
  return `sha256:${crypto.createHash('sha256').update(namespace, 'utf8').update(canonicalize(value), 'utf8').digest('hex')}`;
}

function parseCanonical(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES) reject();
  let value;
  try { value = JSON.parse(text); } catch (_) { reject(); }
  if (canonicalize(value) !== text) reject('Mission 28 canonical text is not exact');
  return value;
}

const api = Object.create(null);
Object.defineProperties(api, {
  limits: { value: Object.freeze({
    maxBytes: MAX_BYTES, maxDepth: MAX_DEPTH, maxNodes: MAX_NODES,
    maxObjectKeys: MAX_OBJECT_KEYS, maxArrayItems: MAX_ARRAY_ITEMS,
    maxKeyBytes: MAX_KEY_BYTES, maxStringBytes: MAX_STRING_BYTES,
  }), enumerable: true },
  canonicalize: { value: canonicalize, enumerable: true },
  digest: { value: digest, enumerable: true },
  parseCanonical: { value: parseCanonical, enumerable: true },
});
module.exports = Object.freeze(api);
