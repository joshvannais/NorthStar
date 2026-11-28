'use strict';

const express = require('express');
const { parseUnambiguousJson, contentTypeAllowed, contentEncodingAllowed, rawRequestPath } = require('../scheduling/recommendationHttpBoundary');
const { securityHeaders } = require('../middleware/security');
const validated = new WeakSet();
const PATH = /^\/api\/enterprise\/locations\/(preview|commit)\/?$/i;
const parser = express.raw({ limit: 32768, inflate: false, type: () => true });
function denied(res, status) {
  return res.status(status).json({ success: false, error: { code: 'enterprise_location_body_invalid',
    message: 'Location request is invalid. Refresh and review the current location again.' } });
}
function locationBodyBoundary(req, res, next) {
  if (req.method !== 'POST' || !PATH.test(rawRequestPath(req))) return next();
  return securityHeaders(req, res, () => {
    res.set('Cache-Control', 'no-store'); res.vary('Cookie');
    if (!contentTypeAllowed(req) || !contentEncodingAllowed(req)) return denied(res, 415);
    return parser(req, res, error => {
      if (error) return denied(res, error.type === 'entity.too.large' ? 413 : 400);
      try {
        if (!Buffer.isBuffer(req.body)) return denied(res, 400);
        const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(req.body);
        req.body = parseUnambiguousJson(source); validated.add(req); return next();
      } catch (_error) { return denied(res, 400); }
    });
  });
}
function requireLocationBody(req, res, next) {
  return validated.has(req) ? next() : denied(res, 503);
}

module.exports = { locationBodyBoundary, requireLocationBody };
