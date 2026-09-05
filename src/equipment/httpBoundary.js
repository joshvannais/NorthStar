'use strict';

const express = require('express');
const { contentEncodingAllowed, contentTypeAllowed, parseUnambiguousJson, rawRequestPath } = require('../scheduling/recommendationHttpBoundary');
const { securityHeaders } = require('../middleware/security');
const { error } = require('./contract');
const VALIDATED = Symbol('equipmentBodyValidated');
const raw = express.raw({ inflate: false, limit: 32768, type: () => true });
function equipmentBodyBoundary(req, res, next) {
  if (req.method !== 'POST' || !/^\/api\/equipment\/(?:drafts(?:\/[^/]+\/actions)?|executions\/[^/]+\/actions)\/?$/i.test(rawRequestPath(req))) return next();
  return securityHeaders(req, res, () => {
    res.set('Cache-Control', 'no-store, private');
    if (!contentTypeAllowed(req) || !contentEncodingAllowed(req)) return next(error(415, 'EQUIPMENT_MEDIA_INVALID', 'Use uncompressed UTF-8 JSON.'));
    raw(req, res, failure => {
      if (failure) return next(error(failure.type === 'entity.too.large' ? 413 : 400, 'EQUIPMENT_BODY_INVALID', 'Equipment request is invalid.'));
      try {
        const source = new TextDecoder('utf-8', { fatal: true }).decode(req.body);
        req.body = parseUnambiguousJson(source);
        Object.defineProperty(req, VALIDATED, { value: true });
        return next();
      } catch (_) { return next(error(400, 'EQUIPMENT_BODY_INVALID', 'Equipment request is invalid.')); }
    });
  });
}
function requireBody(req, _res, next) {
  return req[VALIDATED] === true ? next() : next(error(500, 'EQUIPMENT_BOUNDARY_UNAVAILABLE', 'Equipment validation is unavailable.'));
}
module.exports = { equipmentBodyBoundary, requireBody };
