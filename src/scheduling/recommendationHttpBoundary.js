'use strict';

const express = require('express');
const { MAXIMUM_BODY_BYTES } = require('./recommendationContract');
const { securityHeaders } = require('../middleware/security');

// Match the exact Express route including the router's established
// case-insensitive and optional-trailing-slash spellings. Otherwise one of
// those spellings could fall through the broader parser/audit boundary before
// reaching the same handler.
const RECOMMENDATION_PATH = /^\/api\/v1\/canonical\/appointments\/[^/]+\/recommendations\/?$/i;
const ZERO_DURABLE_WRITE = Symbol('m22RecommendationZeroDurableWrite');
const BODY_VALIDATED = Symbol('m22RecommendationBodyValidated');
const rawRecommendationBody = express.raw({
  inflate: false,
  limit: MAXIMUM_BODY_BYTES,
  type() { return true; },
});

class DuplicateJsonKeyError extends Error {
  constructor() {
    super('Duplicate JSON object key');
    this.name = 'DuplicateJsonKeyError';
  }
}

function requestPath(req) {
  const target = String(req.originalUrl || req.url || '');
  if (/^https?:\/\//i.test(target)) {
    try { return new URL(target).pathname; } catch (_) { return ''; }
  }
  return target.split('?')[0];
}

function isRecommendationRequest(req) {
  return String(req.method || '').toUpperCase() === 'POST' && RECOMMENDATION_PATH.test(requestPath(req));
}

function boundaryError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function skipWhitespace(source, state) {
  while (state.index < source.length && /[\u0009\u000a\u000d\u0020]/.test(source[state.index])) {
    state.index += 1;
  }
}

function parseJsonString(source, state) {
  if (source[state.index] !== '"') throw new SyntaxError('Expected JSON string');
  const start = state.index;
  state.index += 1;
  while (state.index < source.length) {
    const code = source.charCodeAt(state.index);
    if (code === 0x22) {
      state.index += 1;
      return JSON.parse(source.slice(start, state.index));
    }
    if (code < 0x20) throw new SyntaxError('Invalid JSON string control byte');
    if (code === 0x5c) {
      state.index += 1;
      if (state.index >= source.length) throw new SyntaxError('Truncated JSON escape');
      if (source[state.index] === 'u') {
        const digits = source.slice(state.index + 1, state.index + 5);
        if (!/^[0-9a-f]{4}$/i.test(digits)) throw new SyntaxError('Invalid JSON unicode escape');
        state.index += 5;
        continue;
      }
      if (!/["\\/bfnrt]/.test(source[state.index])) throw new SyntaxError('Invalid JSON escape');
    }
    state.index += 1;
  }
  throw new SyntaxError('Unterminated JSON string');
}

function parseJsonValue(source, state) {
  skipWhitespace(source, state);
  const current = source[state.index];
  if (current === '{') return parseJsonObject(source, state);
  if (current === '[') return parseJsonArray(source, state);
  if (current === '"') {
    parseJsonString(source, state);
    return;
  }
  const remainder = source.slice(state.index);
  const token = remainder.match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
  if (!token) throw new SyntaxError('Invalid JSON value');
  state.index += token[0].length;
}

function parseJsonObject(source, state) {
  state.index += 1;
  skipWhitespace(source, state);
  const keys = new Set();
  if (source[state.index] === '}') {
    state.index += 1;
    return;
  }
  while (state.index < source.length) {
    const key = parseJsonString(source, state);
    if (keys.has(key)) throw new DuplicateJsonKeyError();
    keys.add(key);
    skipWhitespace(source, state);
    if (source[state.index] !== ':') throw new SyntaxError('Expected JSON property separator');
    state.index += 1;
    parseJsonValue(source, state);
    skipWhitespace(source, state);
    if (source[state.index] === '}') {
      state.index += 1;
      return;
    }
    if (source[state.index] !== ',') throw new SyntaxError('Expected JSON object delimiter');
    state.index += 1;
    skipWhitespace(source, state);
  }
  throw new SyntaxError('Unterminated JSON object');
}

function parseJsonArray(source, state) {
  state.index += 1;
  skipWhitespace(source, state);
  if (source[state.index] === ']') {
    state.index += 1;
    return;
  }
  while (state.index < source.length) {
    parseJsonValue(source, state);
    skipWhitespace(source, state);
    if (source[state.index] === ']') {
      state.index += 1;
      return;
    }
    if (source[state.index] !== ',') throw new SyntaxError('Expected JSON array delimiter');
    state.index += 1;
    skipWhitespace(source, state);
  }
  throw new SyntaxError('Unterminated JSON array');
}

function parseUnambiguousJson(source) {
  const state = { index: 0 };
  parseJsonValue(source, state);
  skipWhitespace(source, state);
  if (state.index !== source.length) throw new SyntaxError('Trailing JSON content');
  return JSON.parse(source);
}

function contentTypeAllowed(req) {
  const value = req.headers && req.headers['content-type'];
  return typeof value === 'string' &&
    /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(value);
}

function contentEncodingAllowed(req) {
  const value = req.headers && req.headers['content-encoding'];
  return value === undefined || /^identity$/i.test(String(value).trim());
}

function normalizeRawParserError(error) {
  if (error && error.type === 'entity.too.large') {
    return boundaryError(413, 'M22_RECOMMENDATION_BODY_TOO_LARGE',
      'Recommendation request exceeds the 65536-byte limit.');
  }
  return boundaryError(400, 'INVALID_RECOMMENDATION_REQUEST', 'Recommendation request is invalid.');
}

function recommendationBodyBoundary(req, res, next) {
  if (!isRecommendationRequest(req)) return next();
  // Parser failures occur before the application's later global header
  // middleware. Apply the same established headers here so every response from
  // this early exact boundary keeps the platform security/cache contract.
  return securityHeaders(req, res, function afterRecommendationSecurityHeaders() {
    Object.defineProperty(req, ZERO_DURABLE_WRITE, {
      value: true, enumerable: false, configurable: false, writable: false,
    });
    if (!contentTypeAllowed(req)) {
      return next(boundaryError(415, 'M22_RECOMMENDATION_MEDIA_TYPE_UNSUPPORTED',
        'Recommendation requests require application/json with UTF-8 encoding.'));
    }
    if (!contentEncodingAllowed(req)) {
      return next(boundaryError(415, 'M22_RECOMMENDATION_CONTENT_ENCODING_UNSUPPORTED',
        'Compressed recommendation request bodies are not supported.'));
    }
    return rawRecommendationBody(req, res, function parseRecommendationBody(error) {
      if (error) return next(normalizeRawParserError(error));
      try {
        if (!Buffer.isBuffer(req.body)) throw new SyntaxError('Raw recommendation body is unavailable');
        const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(req.body);
        req.rawBody = source;
        req.body = parseUnambiguousJson(source);
        Object.defineProperty(req, BODY_VALIDATED, {
          value: true, enumerable: false, configurable: false, writable: false,
        });
        return next();
      } catch (parseError) {
        const code = parseError instanceof DuplicateJsonKeyError
          ? 'M22_RECOMMENDATION_AMBIGUOUS_JSON'
          : 'INVALID_RECOMMENDATION_REQUEST';
        return next(boundaryError(400, code, 'Recommendation request is invalid.'));
      }
    });
  });
}

function requireRecommendationBodyBoundary(req, _res, next) {
  if (isRecommendationRequest(req) && req[BODY_VALIDATED] === true) return next();
  return next(boundaryError(500, 'M22_RECOMMENDATION_BODY_BOUNDARY_UNAVAILABLE',
    'Recommendation request validation is unavailable.'));
}

function isZeroDurableWriteRecommendation(req) {
  return isRecommendationRequest(req) && req[ZERO_DURABLE_WRITE] === true;
}

module.exports = {
  BODY_VALIDATED,
  DuplicateJsonKeyError,
  RECOMMENDATION_PATH,
  ZERO_DURABLE_WRITE,
  contentEncodingAllowed,
  contentTypeAllowed,
  isRecommendationRequest,
  isZeroDurableWriteRecommendation,
  parseUnambiguousJson,
  recommendationBodyBoundary,
  requireRecommendationBodyBoundary,
};
