'use strict';

const express = require('express');
const { MAXIMUM_BODY_BYTES } = require('./approvalContract');
const {
  DuplicateJsonKeyError,
  contentEncodingAllowed,
  contentTypeAllowed,
  parseUnambiguousJson,
  rawRequestPath,
} = require('./recommendationHttpBoundary');
const { securityHeaders } = require('../middleware/security');

const APPROVAL_PATH = /^\/api\/v1\/canonical\/appointments\/([^/]+)\/(mutation-previews|mutation-approvals)\/?$/i;
const RAW_TARGET_CANDIDATE = Symbol('m22ApprovalRawTargetCandidate');
const BODY_VALIDATED = Symbol('m22ApprovalBodyValidated');
const rawApprovalBody = express.raw({
  inflate: false,
  limit: MAXIMUM_BODY_BYTES,
  type() { return true; },
});

function boundaryError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isApprovalRequest(req) {
  if (String(req.method || '').toUpperCase() !== 'POST') return false;
  const match = APPROVAL_PATH.exec(rawRequestPath(req));
  if (!match) return false;
  try {
    decodeURIComponent(match[1]);
    return true;
  } catch (_) {
    return false;
  }
}

function normalizeRawParserError(error) {
  if (error && error.type === 'entity.too.large') {
    return boundaryError(413, 'M22_APPROVAL_BODY_TOO_LARGE',
      'Human approval request exceeds the 65536-byte limit.');
  }
  return boundaryError(400, 'INVALID_MUTATION_APPROVAL', 'Human approval request is invalid.');
}

function approvalBodyBoundary(req, res, next) {
  if (!isApprovalRequest(req)) return next();
  return securityHeaders(req, res, function afterApprovalSecurityHeaders() {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    Object.defineProperty(req, RAW_TARGET_CANDIDATE, {
      value: true, enumerable: false, configurable: false, writable: false,
    });
    if (!contentTypeAllowed(req)) {
      return next(boundaryError(415, 'M22_APPROVAL_MEDIA_TYPE_UNSUPPORTED',
        'Human approval requests require application/json with UTF-8 encoding.'));
    }
    if (!contentEncodingAllowed(req)) {
      return next(boundaryError(415, 'M22_APPROVAL_CONTENT_ENCODING_UNSUPPORTED',
        'Compressed human approval request bodies are not supported.'));
    }
    return rawApprovalBody(req, res, function parseApprovalBody(error) {
      if (error) return next(normalizeRawParserError(error));
      try {
        if (!Buffer.isBuffer(req.body)) throw new SyntaxError('Raw human approval body is unavailable');
        const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(req.body);
        req.rawBody = source;
        req.body = parseUnambiguousJson(source);
        Object.defineProperty(req, BODY_VALIDATED, {
          value: true, enumerable: false, configurable: false, writable: false,
        });
        return next();
      } catch (parseError) {
        const code = parseError instanceof DuplicateJsonKeyError
          ? 'M22_APPROVAL_AMBIGUOUS_JSON'
          : 'INVALID_MUTATION_APPROVAL';
        return next(boundaryError(400, code, 'Human approval request is invalid.'));
      }
    });
  });
}

function requireApprovalBodyBoundary(req, _res, next) {
  if (req[RAW_TARGET_CANDIDATE] === true && req[BODY_VALIDATED] === true) return next();
  return next(boundaryError(500, 'M22_APPROVAL_BODY_BOUNDARY_UNAVAILABLE',
    'Human approval request validation is unavailable.'));
}

module.exports = {
  APPROVAL_PATH,
  BODY_VALIDATED,
  approvalBodyBoundary,
  isApprovalRequest,
  requireApprovalBodyBoundary,
};
