'use strict';

const express = require('express');
const { MAXIMUM_BODY_BYTES } = require('./contract');
const {
  DuplicateJsonKeyError,
  contentEncodingAllowed,
  contentTypeAllowed,
  parseUnambiguousJson,
  rawRequestPath,
} = require('../scheduling/recommendationHttpBoundary');
const { securityHeaders } = require('../middleware/security');

const INITIALIZE_PATH = /^\/api\/v1\/field-executions\/appointments\/([^/]+)\/?$/i;
const TRANSITION_PATH = /^\/api\/v1\/field-executions\/([^/]+)\/transitions\/?$/i;
const RAW_TARGET_CANDIDATE = Symbol('m23ExecutionRawTargetCandidate');
const BODY_VALIDATED = Symbol('m23ExecutionBodyValidated');
const rawExecutionBody = express.raw({
  inflate: false,
  limit: MAXIMUM_BODY_BYTES,
  type() { return true; },
});

function boundaryError(statusCode, code, message) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isExecutionMutationRequest(req) {
  if (String(req && req.method || '').toUpperCase() !== 'POST') return false;
  const target = rawRequestPath(req);
  const match = INITIALIZE_PATH.exec(target) || TRANSITION_PATH.exec(target);
  if (!match) return false;
  try {
    decodeURIComponent(match[1]);
    return true;
  } catch (_error) {
    return false;
  }
}

function normalizeRawParserError(error) {
  if (error && error.type === 'entity.too.large') {
    return boundaryError(413, 'M23_EXECUTION_BODY_TOO_LARGE',
      'Field execution request exceeds the 32768-byte limit.');
  }
  return boundaryError(400, 'INVALID_EXECUTION_REQUEST', 'Field execution request is invalid.');
}

function executionBodyBoundary(req, res, next) {
  if (!isExecutionMutationRequest(req)) return next();
  return securityHeaders(req, res, function afterSecurityHeaders() {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    Object.defineProperty(req, RAW_TARGET_CANDIDATE, {
      value: true, enumerable: false, configurable: false, writable: false,
    });
    if (!contentTypeAllowed(req)) {
      return next(boundaryError(415, 'M23_EXECUTION_MEDIA_TYPE_UNSUPPORTED',
        'Field execution mutations require application/json with UTF-8 encoding.'));
    }
    if (!contentEncodingAllowed(req)) {
      return next(boundaryError(415, 'M23_EXECUTION_CONTENT_ENCODING_UNSUPPORTED',
        'Compressed field execution request bodies are not supported.'));
    }
    return rawExecutionBody(req, res, function parseExecutionBody(error) {
      if (error) return next(normalizeRawParserError(error));
      try {
        if (!Buffer.isBuffer(req.body)) throw new SyntaxError('Raw field execution body is unavailable');
        const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(req.body);
        req.rawBody = source;
        req.body = parseUnambiguousJson(source);
        Object.defineProperty(req, BODY_VALIDATED, {
          value: true, enumerable: false, configurable: false, writable: false,
        });
        return next();
      } catch (parseError) {
        const code = parseError instanceof DuplicateJsonKeyError
          ? 'M23_EXECUTION_AMBIGUOUS_JSON'
          : 'INVALID_EXECUTION_REQUEST';
        return next(boundaryError(400, code, 'Field execution request is invalid.'));
      }
    });
  });
}

function requireExecutionBodyBoundary(req, _res, next) {
  if (req[RAW_TARGET_CANDIDATE] === true && req[BODY_VALIDATED] === true) return next();
  return next(boundaryError(500, 'M23_EXECUTION_BODY_BOUNDARY_UNAVAILABLE',
    'Field execution request validation is unavailable.'));
}

module.exports = {
  BODY_VALIDATED,
  INITIALIZE_PATH,
  TRANSITION_PATH,
  executionBodyBoundary,
  isExecutionMutationRequest,
  requireExecutionBodyBoundary,
};
